#include "BaresipLoop.h"

#include <re.h>
#include <baresip.h>
// O dbg da libre (dbg_init, dbg_handler_set e os níveis), fora do re.h; este arquivo não usa as macros DEBUG_*.
#define DEBUG_MODULE "starsonic"
#define DEBUG_LEVEL 0
#include <re_dbg.h>

#include <atomic>
#include <cstdint>
#include <cstring>
#include <iterator>
#include <system_error>
#include <utility>

#include "NullAudio.h"

namespace starsonic {
namespace {

// Os módulos do baresip que o laço carrega, na ordem: os da lista baresip.modules do build/deps.lock. Duas
// conferências: o teste "the baresip engine loads the modules of build/deps.lock, in order"
// (tests/phone/test_engine_baresip.cpp, em todo build) compara esta lista, pelo Modules(), com a do deps.lock, nome a
// nome e na ordem; o build/baresip/build-linux.sh compara o libstarsonic-baresip.a com o deps.lock (um módulo que falta
// ou que sobra).
const char* const kModules[] = {"g711", "libg722", "opus", "srtp", "stun", "mixminus"};

// As threads do re_thread_async, como no main.c do baresip.
const uint16_t kAsyncWorkers = 4;

// O laço de agora (um por processo): o handler do log do baresip e o do trace do SIP não recebem argumento. Escrito
// antes de a thread do laço nascer e apagado depois de ela acabar.
std::atomic<BaresipLoop*> g_loop{nullptr};

// O handler do log do baresip (o h entra no Setup) e o elo dele na lista do baresip, que é global.
struct log g_baresipLog = {LE_INIT, nullptr};

// O motivo de uma falha da libre ou do baresip: o passo e o erro.
std::string Failure(const std::string& step, int err) { return step + ": " + BaresipLoop::ErrorText(err); }

// O nível do motor (1 erro .. 4 detalhe) de uma linha do baresip.
int LevelOfBaresip(uint32_t level) {
    switch (level) {
        case LEVEL_ERROR:
            return 1;
        case LEVEL_WARN:
            return 2;
        case LEVEL_INFO:
            return 3;
        default:
            return 4;   // LEVEL_DEBUG
    }
}

// O nível do motor de uma linha da libre (de DBG_EMERG a DBG_DEBUG).
int LevelOfLibre(int level) {
    if (level <= DBG_ERR) return 1;
    if (level == DBG_WARNING) return 2;
    if (level <= DBG_INFO) return 3;   // DBG_NOTICE e DBG_INFO
    return 4;
}

// Os filtros do baresip e da libre no logLevel: uma linha acima dele nem é montada. O baresip, porém, monta sempre as
// de informação (o Setup), para o baresipLines.
enum log_level BaresipLevelFor(int logLevel) {
    if (logLevel <= 1) return LEVEL_ERROR;
    if (logLevel == 2) return LEVEL_WARN;
    if (logLevel == 3) return LEVEL_INFO;
    return LEVEL_DEBUG;
}

int LibreLevelFor(int logLevel) {
    if (logLevel <= 1) return DBG_ERR;
    if (logLevel == 2) return DBG_WARNING;
    if (logLevel == 3) return DBG_INFO;
    return DBG_DEBUG;
}

// O add_laddr_filter do net.c do baresip (static lá), o do net_alloc ao subir: o endereço de interface que o filtro do
// baresip aceita entra na lista (um que já está fica como está). false: o net_if_apply segue para o próximo.
bool AddInterfaceAddress(const char* ifname, const struct sa* sa, void* arg) {
    struct network* net = static_cast<struct network*>(arg);
    if (net_ifaddr_filter(net, ifname, sa)) (void)net_add_address_ifname(net, sa, ifname);
    return false;
}

// A configuração do baresip (o arquivo config dele), em texto: a porta SIP escolhida pelo sistema, como no PJSIP; até 8
// ligações do baresip; a ligação que chega toca até quem liga desistir, como no PJSIP (o padrão do baresip a recusa com
// 486 depois de 120 s); e, com o nullAudio, a fonte e a saída nulas. Nenhum módulo: o laço carrega os de kModules, e
// nenhum de interface (menu, account, contact).
//
// As regras das duas ligações são do motor (o 486 da terceira, com o OnRejectedBusy, no BaresipCalls::OnInvite). O
// limite do baresip conta também as ligações desligadas que ainda esperam a resposta do outro lado para o CANCEL ou o
// BYE (o waiting_ do BaresipCalls, cada uma por uma ida e volta), e o 486 "Max Calls" dele recusa a que chega antes
// de o motor vê-la: com 8, ele só viria com seis esperando ao mesmo tempo, além das duas vagas.
std::string ConfigText(bool nullAudio) {
    std::string text =
        "sip_listen 0.0.0.0:0\n"
        "call_max_calls 8\n"
        "call_local_timeout 0\n";
    if (nullAudio) {
        text += std::string("audio_player ") + kNullAudioName + ",nil\n";
        text += std::string("audio_source ") + kNullAudioName + ",nil\n";
    }
    return text;
}

}  // namespace

// As funções que a libre e o baresip chamam, na thread que escreveu (o log e o SIP) ou na do laço. Nenhuma exceção
// volta para eles, que são C: o Log e o Observe não deixam nenhuma sair, o SipMessage e o Running têm o try/catch, e o
// Stop só chama a libre.
struct BaresipLoop::Hooks {
    static void LibreLine(int level, const char* text, size_t length, void* arg) {
        static_cast<const BaresipLoop*>(arg)->Log(LevelOfLibre(level), text, length);
    }

    // A linha vai ao log (o Log a filtra pelo logLevel) e depois, sempre, ao baresipLines: o que o motor escreve por
    // causa dela sai no log depois dela, e um LogSink que lança não a tira do baresipLines.
    static void BaresipLine(uint32_t level, const char* text) {
        const BaresipLoop* loop = g_loop.load();
        if (!loop || !text) return;
        loop->Log(LevelOfBaresip(level), text, std::strlen(text));
        loop->Observe(text);
    }

    // Cada mensagem SIP inteira, numa linha de log só, no nível 4.
    static void SipMessage(bool tx, enum sip_transp tp, const struct sa* src, const struct sa* dst,
                           const uint8_t* pkt, size_t len, void* /*arg*/) {
        try {
            const BaresipLoop* loop = g_loop.load();
            if (!loop || loop->config_.logLevel < 4) return;
            char route[160];
            if (re_snprintf(route, sizeof(route), "%s %J -> %J", sip_transp_name(tp), src, dst) < 0) route[0] = '\0';
            std::string line = std::string(tx ? "SIP enviado (" : "SIP recebido (") + route + "):\n";
            line.append(reinterpret_cast<const char*>(pkt), len);
            loop->Log(4, line.data(), line.size());
        } catch (...) {   // sem memória para a linha: ela se perde
        }
    }

    // O temporizador de 0 ms: o re_main já está rodando.
    static void Running(void* arg) {
        try {
            static_cast<BaresipLoop*>(arg)->Report(State::Running, std::string());
        } catch (...) {
        }
    }

    // O retorno do re_thread_async_main do destrutor, na thread do laço.
    static void Stop(int /*err*/, void* /*arg*/) { re_cancel(); }
};

BaresipLoop::BaresipLoop(const LoopConfig& config, LogSink log) : config_(config), log_(std::move(log)) {}

std::unique_ptr<BaresipLoop> BaresipLoop::Start(const LoopConfig& config, LogSink log, std::string* error) {
    std::string ignored;
    std::string& reason = error ? *error : ignored;
    std::unique_ptr<BaresipLoop> loop(new BaresipLoop(config, std::move(log)));
    BaresipLoop* none = nullptr;
    if (!g_loop.compare_exchange_strong(none, loop.get())) {
        reason = "ja ha um laco do baresip neste processo";
        return nullptr;
    }
    try {
        BaresipLoop* self = loop.get();
        loop->thread_ = std::thread([self] { self->Main(); });
    } catch (const std::system_error& failure) {
        reason = std::string("a thread do laco nao nasceu: ") + failure.what();
        return nullptr;   // o destrutor apaga o g_loop
    }
    std::unique_lock<std::mutex> lock(loop->mutex_);
    loop->changed_.wait(lock, [&loop] { return loop->state_ != State::Starting; });
    if (loop->state_ == State::Failed) {
        reason = loop->error_;
        lock.unlock();
        loop->thread_.join();   // a thread já fechou o que tinha aberto
        return nullptr;
    }
    return loop;
}

BaresipLoop::~BaresipLoop() {
    if (thread_.joinable()) {
        // O re_cancel só vale na thread do laço, e um re_thread_enter daqui não a acordaria: o retorno do
        // re_thread_async_main roda nela e chama o re_cancel.
        const int err = re_thread_async_main(nullptr, Hooks::Stop, nullptr);
        if (err) {
            const std::string line = Failure("o fim do laco do baresip nao foi pedido: re_thread_async_main", err);
            Log(1, line.data(), line.size());
        }
        thread_.join();
    }
    BaresipLoop* self = this;
    g_loop.compare_exchange_strong(self, nullptr);
}

bool BaresipLoop::Run(const std::function<void()>& work) {
    // Com o re_main parado, o re_thread_enter não trava nada, e o work correria contra o fechamento da libre.
    if (ended_) {
        static const char kLine[] = "o laco do baresip parou: o pedido nao foi feito";
        Log(1, kLine, sizeof(kLine) - 1);
        return false;
    }
    // O re_thread_leave também sai se o work lançar uma exceção.
    struct Entered {
        Entered() { re_thread_enter(); }
        ~Entered() { re_thread_leave(); }
    } entered;
    work();
    return true;
}

std::vector<std::string> BaresipLoop::Modules() {
    return std::vector<std::string>(std::begin(kModules), std::end(kModules));
}

std::string BaresipLoop::ErrorText(int err) {
    char text[128];   // o %m já leva o número entre colchetes
    if (re_snprintf(text, sizeof(text), "%m", err) < 0) return "erro " + std::to_string(err);
    return text;
}

void BaresipLoop::Main() {
    loopThread_.store(std::this_thread::get_id());   // antes de qualquer linha do baresip
    std::string error;
    if (!Setup(&error)) {
        Teardown();
        Report(State::Failed, error);
        return;
    }
    // O re_thread_enter não trava nada antes de o re_main rodar: o Start só volta quando este temporizador dispara, já
    // dentro do re_main.
    struct tmr running;
    tmr_init(&running);
    tmr_start(&running, 0, Hooks::Running, this);
    const int err = re_main(nullptr);
    ended_ = true;   // daqui em diante o Run não roda nada
    tmr_cancel(&running);
    if (err) {
        // Antes de o Start voltar, é a falha dele; depois, o laço parou sem o pedido do destrutor.
        const std::string reason = Failure("re_main", err);
        if (!Report(State::Failed, reason)) {
            const std::string line = "o laco do baresip parou: " + reason;
            Log(1, line.data(), line.size());
        }
    }
    Teardown();
}

bool BaresipLoop::Setup(std::string* error) {
    int err = libre_init();
    if (err) {
        *error = Failure("libre_init", err);
        return false;
    }
    libreReady_ = true;

    // Os desvios do log, antes de qualquer módulo: com eles, nada vai para o terminal.
    dbg_init(LibreLevelFor(config_.logLevel), DBG_NONE);
    dbg_handler_set(Hooks::LibreLine, this);
    g_baresipLog.h = Hooks::BaresipLine;
    log_enable_stdout(false);
    // Pelo menos as de informação: o baresipLines precisa de uma delas com qualquer logLevel (o BaresipCalls lê a do
    // fim da assinatura de uma transferência). As acima do logLevel param no Log, e o log do motor fica como era.
    const enum log_level baresipLevel = BaresipLevelFor(config_.logLevel);
    log_level_set(baresipLevel < LEVEL_INFO ? baresipLevel : LEVEL_INFO);
    log_register_handler(&g_baresipLog);

    // Sem o async, o re_thread_leave não acorda o laço, e um temporizador criado fora dele (a retransmissão de um
    // pedido, por exemplo) atrasa.
    err = re_thread_async_init(kAsyncWorkers);
    if (err) {
        *error = Failure("re_thread_async_init", err);
        return false;
    }

    const std::string text = ConfigText(config_.nullAudio);
    err = conf_configure_buf(reinterpret_cast<const uint8_t*>(text.data()), text.size());
    if (err) {
        *error = Failure("conf_configure_buf", err);
        return false;
    }
    err = baresip_init(conf_config());
    if (err) {
        *error = Failure("baresip_init", err);
        return false;
    }
    // O net_alloc (no baresip_init) já leu os endereços das interfaces; o loopback entra antes do ua_init, que abre os
    // transportes SIP em cada endereço da lista, como no selftest do baresip.
    FillLocalAddresses();
    err = ua_init(config_.userAgent.c_str(), true, true, false);   // UDP e TCP, sem TLS
    if (err) {
        *error = Failure("ua_init", err);
        return false;
    }
    sip_set_trace_handler(uag_sip(), Hooks::SipMessage);

    for (const char* module : kModules) {
        err = module_preload(module);
        if (err) {
            *error = Failure(std::string("module_preload ") + module, err);
            return false;
        }
    }
    if (config_.nullAudio) {
        err = RegisterNullAudio();
        if (err) {
            *error = Failure("RegisterNullAudio", err);
            return false;
        }
        nullAudioReady_ = true;
    }
    return true;
}

void BaresipLoop::FillLocalAddresses() {
    struct network* net = baresip_network();
    int err = net_if_apply(AddInterfaceAddress, net);
    if (err) {   // para o diagnóstico: sem eles, os transportes SIP só abrem no loopback
        const std::string line = Failure("os enderecos das interfaces nao foram lidos: net_if_apply", err);
        Log(2, line.data(), line.size());
    }
    // O filtro do baresip deixa o loopback de fora, e sem ele uma ligação com um servidor no próprio aparelho (o
    // 127.0.0.1 dos testes) não acha o endereço da mídia ("ua: no laddr for"). Sem ele, só essas ligações falham.
    struct sa loopback;
    err = sa_set_str(&loopback, "127.0.0.1", 0);
    if (!err) err = net_add_address(net, &loopback);
    if (err) {
        const std::string line = Failure("o loopback ficou fora dos enderecos locais: net_add_address", err);
        Log(2, line.data(), line.size());
    }
}

void BaresipLoop::RefreshNetwork() {
    struct network* net = baresip_network();
    (void)net_flush_addresses(net);   // os da rede de antes saem: o FillLocalAddresses só acrescenta
    FillLocalAddresses();
    net_dns_refresh(net);
}

void BaresipLoop::Teardown() {
    if (libreReady_) {
        // Uma sessão SIP que ainda espera uma resposta (o BYE ou o CANCEL de uma ligação que acabou, o 200 que espera o
        // ACK) segura o socket das sessões, que a guarda, e com ele a pilha SIP inteira: o ua_close sozinho não as
        // solta. Sem nenhuma ua (as ligações saem com a ua da conta), elas e os pedidos fecham à força, como no
        // ua_stop_all forçado do baresip; o outro lado não recebe mais nada deles.
        if (list_isempty(uag_list())) {
            sipsess_close_all(uag_sipsess_sock());
            sip_close(uag_sip(), true);
        }
        ua_close();
        if (nullAudioReady_) UnregisterNullAudio();
        nullAudioReady_ = false;
        conf_close();
        baresip_close();
        mod_close();
        re_thread_async_close();
        libre_close();
        libreReady_ = false;
    }
    // Os desvios do log saem por último: a libre ainda pode escrever ao fechar.
    log_unregister_handler(&g_baresipLog);
    dbg_handler_set(nullptr, nullptr);
}

bool BaresipLoop::Report(State state, const std::string& error) {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (state_ != State::Starting) return false;
        state_ = state;
        error_ = error;
    }
    changed_.notify_all();
    return true;
}

void BaresipLoop::Log(int level, const char* text, size_t length) const {
    if (level > config_.logLevel || !log_) return;
    while (length > 0 && (text[length - 1] == '\n' || text[length - 1] == '\r')) --length;
    if (length == 0) return;
    // Nenhuma exceção sai daqui (o LogSink, ou a falta de memória para a linha): os ganchos da libre e do baresip, que
    // são C, e o destrutor chamam o Log. A linha se perde.
    try {
        log_(level, std::string(text, length));
    } catch (...) {
    }
}

void BaresipLoop::Observe(const char* text) const {
    if (!config_.baresipLines) return;
    // Nenhuma exceção volta para o baresip, que é C (o baresipLines muda o estado do motor): a linha se perde.
    try {
        size_t length = std::strlen(text);
        while (length > 0 && (text[length - 1] == '\n' || text[length - 1] == '\r')) --length;
        config_.baresipLines(std::string(text, length), std::this_thread::get_id() == loopThread_.load());
    } catch (...) {
    }
}

}  // namespace starsonic
