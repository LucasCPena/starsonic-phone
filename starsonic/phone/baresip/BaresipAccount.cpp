#include "BaresipAccount.h"

#include <baresip.h>

#include <cerrno>
#include <chrono>
#include <string>
#include <utility>
#include <vector>

#include "AccountConfig.h"
#include "AccountPolicy.h"
#include "EngineEvents.h"
#include "Text.h"

namespace starsonic {
namespace {

// Os passos 2 e 3 da saída (a resposta do REGISTER a caminho e a do REGISTER com Expires 0), juntos.
const uint64_t kExitWaitMs = 3000;
// A folga do WaitRetired sobre o kExitWaitMs (o temporizador da saída roda na thread do laço).
const int kExitSlackMs = 1000;

// A renovação, como o schedule_registration do PJSIP (sip_reg.c): 5 s antes do fim
// (PJSIP_REGISTER_CLIENT_DELAY_BEFORE_REFRESH), nunca menos de 500 ms (MIN_REFRESH_MSEC).
const uint64_t kRefreshBeforeSec = 5;
const uint64_t kMinRefreshMs = 500;

// As novas tentativas, como as do pjsua com o padrão dele (reg_first_retry_interval 0, reg_retry_interval 300 e
// reg_retry_random_interval 10): a primeira em 0 a 10 s, as seguintes em 290 a 310 s, até um 2xx.
const uint32_t kFirstRetrySpreadMs = 10000;
const uint64_t kRetryMs = 290000;
const uint32_t kRetrySpreadMs = 20000;

// O proxyUri sem o parâmetro lr: a libre já o põe em cada rota (sip_dialog_alloc), também na do outbound da ua.
std::string WithoutLr(const std::string& uri) {
    std::string out = uri;
    size_t at = out.find(";lr");
    while (at != std::string::npos) {
        const size_t end = at + 3;
        if (end == out.size() || out[end] == ';') {
            out.erase(at, 3);
        } else {
            at = end;
        }
        at = out.find(";lr", at);
    }
    return out;
}

// O texto da ua (ua_alloc), sem a senha e sem o usuário da autenticação, que vão à parte: o baresip pode escrever este
// texto no log. O AOR da conta, o registro do baresip desligado, a rota do proxy, a cifra da mídia, os codecs do
// perfil, o método das teclas, o REFER que chega recusado e, com STUN no perfil, o primeiro servidor.
std::string UaText(const Profile& profile, const PjAccountSettings& settings, const std::string& route, bool tcp) {
    std::string text = "<" + settings.idUri + (tcp ? ";transport=tcp" : "") + ">;regint=0";
    if (!route.empty()) text += ";outbound=\"" + route + "\"";
    if (settings.srtpUse == 1) {
        text += ";mediaenc=srtp";
    } else if (settings.srtpUse == 2) {
        text += ";mediaenc=srtp-mand";
    }
    const std::vector<std::string> codecs = CodecIds(profile.global.codecs);
    for (size_t i = 0; i < codecs.size(); ++i) text += (i == 0 ? ";audio_codecs=" : ",") + codecs[i];
    // As teclas (o call_send_digit lê o dtmfmode da conta): info por SIP INFO; rfc2833, auto e inband por RFC 2833,
    // como no motor do PJSIP. Nunca o auto do baresip, que cai no INFO quando o outro lado não oferece o
    // telephone-event.
    text += profile.global.dtmf == DtmfMethod::SipInfo ? ";dtmfmode=info" : ";dtmfmode=rtpevent";
    // O REFER que o outro lado manda numa ligação: sem o handler de REFER do baresip na sessão, a libre responde 501 e
    // a ligação segue como estava. Com ele, o baresip aceitaria com 202 antes de qualquer aviso e deixaria a ligação
    // no estado de transferência, sem ninguém para fazer a ligação nova; o motor do PJSIP recusa com 603. O REFER
    // daqui (o call_transfer e o call_replace_transfer do Transfer e do TransferAttended) não olha esta chave.
    text += ";call_transfer=no";
    const std::vector<std::string> stun = StunServers(profile.global.stun);
    if (!stun.empty()) text += ";medianat=stun;stunserver=stun:" + stun.front();
    return text;
}

// Os dados de push no formato do REGISTER.
std::string ContactParamsOf(const std::optional<PushData>& data) {
    std::string text;
    if (!data) return text;
    for (const auto& param : data->contactParams) {
        text += ";" + param.first;
        if (!param.second.empty()) text += "=" + param.second;
    }
    return text;
}

std::string HeadersOf(const std::optional<PushData>& data) {
    std::string text;
    if (!data) return text;
    for (const auto& header : data->headers) text += header.first + ": " + header.second + "\r\n";
    return text;
}

// Depois de qual código o PJSIP tenta de novo (pjsua_acc.c): os de falha passageira. O erro de transporte chega aqui
// como 503.
bool IsRetryable(int code) {
    return code == 408 || code == 480 || code == 500 || code == 502 || code == 503 || code == 504 || code / 100 == 6;
}

// Quanto depois do 2xx sai a renovação (schedule_registration do PJSIP): granted - 5 s, mas nunca depois do tempo
// pedido; abaixo de 5 s, 5 s, a não ser que tenham sido concedidos só 5 s ou menos (aí granted - 1 s, e com 1 s, meio
// segundo); e nunca menos de meio segundo.
uint64_t RefreshDelayMs(uint32_t granted, uint32_t requested) {
    uint64_t seconds = granted > kRefreshBeforeSec ? granted - kRefreshBeforeSec : 0;
    if (requested > 0 && seconds > requested) seconds = requested;
    uint64_t ms = seconds * 1000;
    if (seconds < kRefreshBeforeSec) {
        if (granted <= kRefreshBeforeSec) {
            ms = granted > 1 ? (granted - 1) * 1000ULL : kMinRefreshMs;
        } else {
            ms = kRefreshBeforeSec * 1000;
        }
    }
    return ms < kMinRefreshMs ? kMinRefreshMs : ms;
}

// A busca do nosso Contact no 2xx (Granted).
struct ContactSearch {
    const BaresipAccount* account;
    struct pl expires;
    bool found;
};

}  // namespace

// As funções que a libre chama, na thread do laço. Nenhuma exceção volta para a libre, que é C.
struct BaresipAccount::Hooks {
    static int Credentials(char** user, char** password, const char* /*realm*/, void* arg) {
        const BaresipAccount* account = static_cast<const BaresipAccount*>(arg);
        int err = str_dup(user, account->authUser_.c_str());
        if (!err) err = str_dup(password, account->authPassword_.c_str());
        return err;
    }

    static int Contact(enum sip_transp tp, struct sa* src, const struct sa* /*dst*/, struct mbuf* mb,
                       struct mbuf** /*contp*/, void* arg) {
        try {
            return static_cast<BaresipAccount*>(arg)->OnSend(tp, src, mb);
        } catch (...) {
            return ENOMEM;
        }
    }

    static void Response(int err, const struct sip_msg* msg, void* arg) {
        try {
            static_cast<BaresipAccount*>(arg)->OnResponse(err, msg);
        } catch (...) {
        }
    }

    // Um Contact do 2xx: o nosso, com expires, encerra a busca.
    static bool ContactExpires(const struct sip_hdr* hdr, const struct sip_msg* /*msg*/, void* arg) {
        ContactSearch* search = static_cast<ContactSearch*>(arg);
        struct sip_addr contact;
        if (sip_addr_decode(&contact, &hdr->val) || !search->account->IsOurContact(contact)) return false;
        if (msg_param_decode(&contact.params, "expires", &search->expires)) return false;
        search->found = true;
        return true;
    }

    static void Timer(void* arg) {
        try {
            static_cast<BaresipAccount*>(arg)->OnTimer();
        } catch (...) {
        }
    }

    static void KeepAlive(void* arg) {
        try {
            static_cast<BaresipAccount*>(arg)->OnKeepAlive();
        } catch (...) {
        }
    }

    // Os ~3 s da saída acabaram sem resposta: nada mais do pedido chega, e a conta sai assim mesmo.
    static void ExitTimeout(void* arg) {
        try {
            BaresipAccount* account = static_cast<BaresipAccount*>(arg);
            account->req_ = static_cast<struct sip_request*>(mem_deref(account->req_));
            account->Log(2, "sem resposta do servidor: a conta sai assim mesmo");
            account->Finish();
        } catch (...) {
        }
    }
};

BaresipAccount::BaresipAccount(EventQueue& events, BaresipLoop::LogSink log) : events_(events), log_(std::move(log)) {
    tmr_init(&timer_);
    tmr_init(&keepAliveTimer_);
    tmr_init(&exitTimer_);
    sa_init(&laddr_, AF_UNSPEC);
    sa_init(&keepAliveDst_, AF_UNSPEC);
}

BaresipAccount::~BaresipAccount() {
    tmr_cancel(&timer_);
    tmr_cancel(&exitTimer_);
    StopKeepAlive();
    // Um pedido a caminho, solto antes do fim: a libre não chama mais o Contact nem o Response dele.
    mem_deref(req_);
    mem_deref(dlg_);
    mem_deref(auth_);
    mem_deref(ua_);
}

int BaresipAccount::Start(const Profile& profile, const AccountInput& input, int accountId, bool networkAvailable) {
    id_ = accountId;
    paused_ = !networkAvailable;
    AccountProfile accountProfile = profile.account;
    if (input.serverPorts) accountProfile.serverPorts = *input.serverPorts;
    const AccountFields fields =
        BuildAccount(accountProfile, input.address, input.ramal, input.senha, input.transport, L"");
    const PjAccountSettings settings = ToPjAccount(fields);
    user_ = WideToUtf8(fields.username);
    idUri_ = settings.idUri;
    registrarUri_ = settings.registrarUri;
    route_ = WithoutLr(settings.proxyUri);
    authUser_ = settings.authUser;
    authPassword_ = settings.authPassword;
    callHost_ = WideToUtf8(fields.domain);   // o domínio já leva a porta fora da 5060 (BuildAccount)
    tcp_ = settings.transport == "tcp";
    keepAliveSec_ = settings.udpKeepAliveSec > 0 ? static_cast<uint32_t>(settings.udpKeepAliveSec) : 0;
    expires_ = static_cast<uint32_t>(settings.regTimeoutSec);

    const std::string text = UaText(profile, settings, route_, tcp_);
    int err = ua_alloc(&ua_, text.c_str());
    if (err) {
        Log(1, "o baresip recusou a conta " + idUri_ + ": " + BaresipLoop::ErrorText(err));
        return err;
    }
    struct account* acc = ua_account(ua_);
    err = account_set_auth_user(acc, authUser_.c_str());
    if (!err) err = account_set_auth_pass(acc, authPassword_.c_str());
    if (err) {
        Log(1, "a autenticacao da conta " + idUri_ + " nao entrou no baresip: " + BaresipLoop::ErrorText(err));
        return err;
    }
    const char* routes[] = {route_.c_str()};
    err = sip_dialog_alloc(&dlg_, registrarUri_.c_str(), idUri_.c_str(), nullptr, idUri_.c_str(), routes,
                           route_.empty() ? 0 : 1);
    if (!err) err = sip_auth_alloc(&auth_, Hooks::Credentials, this, false);
    if (err) {
        Log(1, "o cliente de REGISTER da conta " + idUri_ + " nao foi criado: " + BaresipLoop::ErrorText(err));
        return err;
    }
    if (paused_) {
        Log(3, "conta " + idUri_ + " sem rede: registra quando ela voltar");
    } else {
        Begin();
    }
    return 0;
}

void BaresipAccount::Retire(bool reportExit) {
    if (exit_ != Exit::None) return;
    reportExit_ = reportExit;
    tmr_cancel(&timer_);
    retrying_ = false;
    pending_ = false;
    StopKeepAlive();
    if (!dlg_) {   // o Start não chegou ao cliente de REGISTER: nada foi pedido ao servidor
        Finish();
        return;
    }
    tmr_start(&exitTimer_, kExitWaitMs, Hooks::ExitTimeout, this);
    if (req_) {
        // Sem esperar, o servidor ficaria com o registro que ele ainda vai aceitar: a saída vai depois da resposta.
        exit_ = Exit::Waiting;
        Log(3, "REGISTER em andamento: a saida espera a resposta dele");
        return;
    }
    Leave();
}

bool BaresipAccount::WaitRetired() {
    std::unique_lock<std::mutex> lock(exitMutex_);
    return exitChanged_.wait_for(lock, std::chrono::milliseconds(kExitWaitMs + kExitSlackMs),
                                 [this] { return retired_; });
}

void BaresipAccount::Refresh() { Begin(); }

void BaresipAccount::SetNetworkAvailable(bool available) {
    if (!available) {
        paused_ = true;
        pending_ = false;
        if (retrying_) {   // depois de uma falha, nenhuma nova tentativa; a renovação segue no relógio dela
            tmr_cancel(&timer_);
            retrying_ = false;
        }
        StopKeepAlive();
        return;
    }
    paused_ = false;
    Begin();
}

void BaresipAccount::SetPushData(const std::optional<PushData>& data) {
    contactParams_ = ContactParamsOf(data);
    pushHeaders_ = HeadersOf(data);
    if (dlg_ && !paused_) Begin();
}

void BaresipAccount::OnIpChange() {
    StopKeepAlive();   // a conexão e o endereço do último 2xx são de antes da troca
    if (req_ && tcp_) {
        // No TCP, o REGISTER a caminho ia pela conexão que o uag_reset_transp fechou sem avisar o pedido: a resposta
        // dele não chega mais, e a libre só o daria por perdido no Timer F (32 s), com o REGISTER da troca esperando
        // atrás dele. Ele sai do caminho sem virar evento (a libre não chama mais os handlers dele). No UDP, as
        // repetições já saem pelo socket novo.
        req_ = static_cast<struct sip_request*>(mem_deref(req_));
        pending_ = false;
    }
    if (!paused_) Begin();
}

struct ua* BaresipAccount::Ua() const { return ua_; }

std::string BaresipAccount::CallHost() const { return callHost_; }

bool BaresipAccount::Tcp() const { return tcp_; }

void BaresipAccount::Begin() {
    if (!dlg_ || exit_ != Exit::None) return;
    if (req_) {
        // Um REGISTER (uma renovação, também uma que saiu sem rede e ficou sem resposta) ainda está a caminho: o pedido
        // vai logo depois da resposta dele, que não vira evento (é de antes do pedido).
        if (!pending_) Log(3, "um pedido de registro em andamento: o registro novo vai logo depois da resposta dele");
        pending_ = true;
        return;
    }
    tmr_cancel(&timer_);
    retrying_ = false;
    authRetried_ = false;
    intervalRetried_ = false;
    const int err = Send(expires_);
    if (err) Conclude(err, nullptr);
}

int BaresipAccount::Send(uint32_t expires) {
    sending_ = expires;
    // O Expires vai no cabeçalho, porque o registrador falso e muitas centrais só leem ele; o Contact sai no
    // Hooks::Contact, com o endereço local do socket que manda o pedido; o User-Agent, a libre põe (o do ua_init).
    return sip_drequestf(&req_, uag_sip(), true, "REGISTER", dlg_, 0, auth_, Hooks::Contact, Hooks::Response, this,
                         "Expires: %u\r\n"
                         "%s"
                         "Content-Length: 0\r\n"
                         "\r\n",
                         expires, pushHeaders_.c_str());
}

int BaresipAccount::OnSend(enum sip_transp tp, const struct sa* src, struct mbuf* mb) {
    tp_ = tp;
    laddr_ = *src;
    return mbuf_printf(mb, "Contact: <sip:%s@%J%s%s>\r\n", user_.c_str(), src, sip_transp_param(tp),
                       contactParams_.c_str());
}

void BaresipAccount::OnResponse(int err, const struct sip_msg* msg) {
    if (!err && msg && msg->scode < 200) return;   // provisória
    if (!err && msg) {
        const uint16_t code = msg->scode;
        bool again = false;
        if ((code == 401 || code == 407) && !authRetried_) {
            // A resposta do Digest e o mesmo REGISTER de novo, uma vez; outro 401 ou 407 em seguida é a resposta final.
            authRetried_ = true;
            sip_auth_reset(auth_);
            again = sip_auth_authenticate(auth_, msg) == 0;
        } else if (code == 423 && !intervalRetried_ && sending_ > 0) {
            // O tempo pedido é curto demais para o servidor: de novo, uma vez, com o Min-Expires da resposta.
            const struct sip_hdr* minimum = sip_msg_hdr(msg, SIP_HDR_MIN_EXPIRES);
            const uint32_t seconds = minimum ? pl_u32(&minimum->val) : 0;
            if (seconds > 0) {
                intervalRetried_ = true;
                expires_ = seconds;
                again = true;
            }
        }
        if (again) {
            const int sendErr = Send(code == 423 ? expires_ : sending_);
            if (!sendErr) return;
            Conclude(sendErr, nullptr);
            return;
        }
    }
    Conclude(err, msg);
}

void BaresipAccount::Conclude(int err, const struct sip_msg* msg) {
    const bool noAnswer = err || !msg;
    // Sem resposta: tempo esgotado (408) ou erro de transporte (503: conexão recusada, rede ou endereço inalcançável).
    const int code = noAnswer ? (err == ETIMEDOUT ? 408 : 503) : msg->scode;
    const uint32_t granted = !noAnswer && code / 100 == 2 && sending_ > 0 ? Granted(msg) : 0;
    const bool active = granted > 0;
    registered_ = active;
    if (!active) StopKeepAlive();
    const std::string result = noAnswer ? std::to_string(code) + " (sem resposta do servidor: " +
                                              BaresipLoop::ErrorText(err) + ")"
                                        : std::to_string(code);

    if (exit_ == Exit::Waiting) {   // a resposta do REGISTER que estava a caminho: agora a saída
        Leave();
        return;
    }
    if (exit_ == Exit::Leaving) {
        if (code / 100 == 2) {
            Log(3, "a conta saiu do servidor");
        } else if (noAnswer) {
            Log(2, "sem resposta do servidor: a conta sai assim mesmo");
        } else {
            Log(2, "o servidor respondeu " + result + " ao pedido de saida: a conta sai assim mesmo");
        }
        Finish();
        return;
    }
    if (exit_ == Exit::Done) return;

    if (pending_) {
        // Um REGISTER foi pedido com este a caminho: ele sai agora, e esta resposta, de antes do pedido, não vira
        // evento.
        pending_ = false;
        if (active) retries_ = 0;
        Log(3, "registro: " + result + " (de antes do pedido novo, que sai agora)");
        Begin();
        return;
    }
    if (active) {
        retries_ = 0;
        const uint64_t delay = RefreshDelayMs(granted, sending_);
        Schedule(delay, false);
        if (!paused_) StartKeepAlive(msg);
        Log(3, "registro: " + result + ", por " + std::to_string(granted) + " s; renova em " +
                   std::to_string(delay / 1000) + " s" + (paused_ ? " (sem rede: sem aviso)" : ""));
    } else if (!paused_ && IsRetryable(code)) {
        const uint64_t delay =
            retries_ == 0 ? rand_u32() % kFirstRetrySpreadMs : kRetryMs + rand_u32() % kRetrySpreadMs;
        Schedule(delay, true);
        Log(3, "registro: " + result + "; nova tentativa em " + std::to_string(delay / 1000) + " s");
    } else {
        Log(3, "registro: " + result + (paused_ ? " (sem rede: sem aviso e sem nova tentativa)" : ""));
    }
    if (!paused_) Post(code, active);   // sem rede, nenhuma resposta vira evento
}

uint32_t BaresipAccount::Granted(const struct sip_msg* msg) const {
    // O expires do nosso Contact; sem ele, o Expires do 2xx; sem os dois, o pedido.
    ContactSearch search = {this, PL_INIT, false};
    sip_msg_hdr_apply(msg, true, SIP_HDR_CONTACT, Hooks::ContactExpires, &search);
    if (search.found) return pl_u32(&search.expires);
    if (pl_isset(&msg->expires)) return pl_u32(&msg->expires);
    return sending_;
}

bool BaresipAccount::IsOurContact(const struct sip_addr& contact) const {
    // O do último REGISTER: o mesmo usuário, o mesmo endereço local (com a porta) e o mesmo transporte.
    if (pl_strcmp(&contact.uri.user, user_.c_str())) return false;
    struct sa host;
    if (sa_set(&host, &contact.uri.host, contact.uri.port) || !sa_cmp(&host, &laddr_, SA_ALL)) return false;
    struct pl transport;
    if (msg_param_decode(&contact.uri.params, "transport", &transport)) pl_set_str(&transport, "udp");
    return sip_transp_decode(&transport) == tp_;
}

void BaresipAccount::Schedule(uint64_t delayMs, bool retry) {
    retrying_ = retry;
    tmr_start(&timer_, delayMs, Hooks::Timer, this);
}

void BaresipAccount::OnTimer() {
    if (retrying_) ++retries_;
    Begin();
}

void BaresipAccount::StartKeepAlive(const struct sip_msg* msg) {
    StopKeepAlive();
    if (keepAliveSec_ == 0) return;
    keepAliveDst_ = msg->src;
    keepAliveTp_ = msg->tp;
    // No TCP, pela conexão do 2xx (a libre só a fecha depois do último mem_deref); no UDP, pelo socket que a libre
    // escolher para o servidor (o do REGISTER).
    if (msg->tp != SIP_TRANSP_UDP) keepAliveSock_ = mem_ref(msg->sock);
    tmr_start(&keepAliveTimer_, keepAliveSec_ * 1000ULL, Hooks::KeepAlive, this);
}

void BaresipAccount::StopKeepAlive() {
    tmr_cancel(&keepAliveTimer_);
    keepAliveSock_ = mem_deref(keepAliveSock_);
}

void BaresipAccount::OnKeepAlive() {
    // CRLF no UDP e CRLFCRLF no TCP (o ping da RFC 5626), sem esperar resposta.
    struct mbuf* mb = mbuf_alloc(4);
    if (mb) {
        int err = mbuf_write_str(mb, keepAliveTp_ == SIP_TRANSP_UDP ? "\r\n" : "\r\n\r\n");
        mb->pos = 0;
        if (!err) err = sip_send(uag_sip(), keepAliveSock_, keepAliveTp_, &keepAliveDst_, mb);
        if (err) Log(4, "keep-alive nao saiu: " + BaresipLoop::ErrorText(err));
        mem_deref(mb);
    }
    tmr_start(&keepAliveTimer_, keepAliveSec_ * 1000ULL, Hooks::KeepAlive, this);
}

void BaresipAccount::Leave() {
    if (!registered_) {   // o último pedido falhou ou não teve resposta: nada a retirar
        Log(3, "a conta nao estava registrada: nada a retirar do servidor");
        Finish();
        return;
    }
    exit_ = Exit::Leaving;
    authRetried_ = false;
    intervalRetried_ = false;
    const int err = Send(0);
    if (err) {
        Log(2, "o pedido de saida nao saiu (" + BaresipLoop::ErrorText(err) + "): a conta sai assim mesmo");
        Finish();
    }
}

void BaresipAccount::Finish() {
    tmr_cancel(&exitTimer_);
    exit_ = Exit::Done;
    if (reportExit_) Post(200, false);
    {
        std::lock_guard<std::mutex> lock(exitMutex_);
        retired_ = true;
    }
    exitChanged_.notify_all();
}

void BaresipAccount::Post(int code, bool active) {
    const int id = id_;
    events_.Post([code, active, id](EngineListener& listener) { listener.OnRegistration(code, active, id); });
}

void BaresipAccount::Log(int level, const std::string& line) const {
    if (log_) log_(level, line);
}

}  // namespace starsonic
