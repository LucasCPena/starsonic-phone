#include "NetworkMonitor.h"

// O winsock2.h antes do windows.h (sozinho, o windows.h traz o winsock.h antigo).
#include <winsock2.h>
#include <windows.h>

#include <netlistmgr.h>
#include <windns.h>
#include <objbase.h>
#include <ocidl.h>
#include <wrl/client.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstdio>
#include <exception>
#include <mutex>
#include <utility>

#include "NetworkDecision.h"
#include "NetworkLoop.h"
#include "Text.h"

using Microsoft::WRL::ComPtr;

namespace starsonic {

static_assert(NetworkDecision::kIpv4Subnet == NLM_CONNECTIVITY_IPV4_SUBNET, "o NLM_CONNECTIVITY do Windows");
static_assert(NetworkDecision::kIpv4LocalNetwork == NLM_CONNECTIVITY_IPV4_LOCALNETWORK, "o NLM_CONNECTIVITY do Windows");
static_assert(NetworkDecision::kIpv4Internet == NLM_CONNECTIVITY_IPV4_INTERNET, "o NLM_CONNECTIVITY do Windows");
static_assert(NetworkDecision::kIpv6Subnet == NLM_CONNECTIVITY_IPV6_SUBNET, "o NLM_CONNECTIVITY do Windows");
static_assert(NetworkDecision::kIpv6LocalNetwork == NLM_CONNECTIVITY_IPV6_LOCALNETWORK, "o NLM_CONNECTIVITY do Windows");
static_assert(NetworkDecision::kIpv6Internet == NLM_CONNECTIVITY_IPV6_INTERNET, "o NLM_CONNECTIVITY do Windows");

struct NetworkMonitor::Shared {
    std::mutex mutex;
    std::condition_variable wake;
    bool stopping = false;
    bool windowsChanged = false;   // um aviso do Windows chegou (o monitor le a conectividade de novo)
    std::string server;            // o servidor da conta ("" sem conta)
    bool serverChanged = false;
    bool connected = false;        // a conta esta conectada
    bool connectedChanged = false;
    bool forceChanged = false;
    std::optional<bool> force;
    bool dnsDone = false;          // um teste DNS terminou e o monitor ainda nao viu
    uint64_t dnsTicket = 0;        // a vez dele
    bool dnsAnswered = false;
    long dnsStatus = 0;            // o DNS_STATUS dele (o diagnostico)

    void WindowsChanged() {
        std::lock_guard<std::mutex> lock(mutex);
        windowsChanged = true;
        wake.notify_all();
    }

    // Com a trava.
    bool Pending() const {
        return stopping || windowsChanged || serverChanged || connectedChanged || forceChanged || dnsDone;
    }
};

namespace {

using Log = std::function<void(const std::string& line)>;

std::string Hex(long value) {
    char text[16];
    std::snprintf(text, sizeof(text), "0x%08lx", static_cast<unsigned long>(value));
    return text;
}

int64_t NowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch())
        .count();
}

std::chrono::steady_clock::time_point TimeOf(int64_t ms) {
    return std::chrono::steady_clock::time_point(std::chrono::milliseconds(ms));
}

// Os avisos de conectividade do Windows: o COM chama nas threads dele, e o sink so acorda o monitor (que le a
// conectividade de agora: o argumento do aviso pode ser velho, os avisos chegam em qualquer ordem).
class ConnectivitySink final : public INetworkListManagerEvents {
public:
    explicit ConnectivitySink(std::shared_ptr<NetworkMonitor::Shared> shared) : shared_(std::move(shared)) {}

    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id, void** object) override {
        if (!object) return E_POINTER;
        if (id == __uuidof(IUnknown) || id == __uuidof(INetworkListManagerEvents)) {
            *object = static_cast<INetworkListManagerEvents*>(this);
            AddRef();
            return S_OK;
        }
        *object = nullptr;
        return E_NOINTERFACE;
    }

    ULONG STDMETHODCALLTYPE AddRef() override { return ++references_; }

    ULONG STDMETHODCALLTYPE Release() override {
        const ULONG left = --references_;
        if (left == 0) delete this;
        return left;
    }

    HRESULT STDMETHODCALLTYPE ConnectivityChanged(NLM_CONNECTIVITY) override {
        shared_->WindowsChanged();
        return S_OK;
    }

private:
    std::atomic<ULONG> references_{1};
    std::shared_ptr<NetworkMonitor::Shared> shared_;
};

// O INetworkListManager e o sink dos avisos, na thread do monitor (o apartamento multithread). As linhas do diagnostico
// saem na thread do monitor, fora da trava.
class WindowsConnectivity {
public:
    WindowsConnectivity(std::shared_ptr<NetworkMonitor::Shared> shared, Log log)
        : shared_(std::move(shared)), log_(std::move(log)) {}
    ~WindowsConnectivity() { Disconnect(); }

    WindowsConnectivity(const WindowsConnectivity&) = delete;
    WindowsConnectivity& operator=(const WindowsConnectivity&) = delete;

    // A conectividade de agora. Sem o objeto, ou com ele quebrado (o servico do Windows reiniciou), cria de novo (uma
    // vez por leitura). Nada: nao deu.
    std::optional<int> Read() {
        for (int attempt = 0; attempt < 2; ++attempt) {
            if (!manager_ && !Connect()) return std::nullopt;
            NLM_CONNECTIVITY connectivity = NLM_CONNECTIVITY_DISCONNECTED;
            const HRESULT read = manager_->GetConnectivity(&connectivity);
            if (SUCCEEDED(read)) {
                failureLogged_ = false;
                return static_cast<int>(connectivity);
            }
            Disconnect();
            if (!failureLogged_) log_("rede: o GetConnectivity do Windows falhou (" + Hex(read) + "): de novo");
            failureLogged_ = true;
        }
        return std::nullopt;
    }

private:
    bool Connect() {
        const HRESULT created = CoCreateInstance(__uuidof(NetworkListManager), nullptr, CLSCTX_ALL,
                                                 __uuidof(INetworkListManager),
                                                 reinterpret_cast<void**>(manager_.ReleaseAndGetAddressOf()));
        if (FAILED(created) || !manager_) {
            manager_.Reset();
            if (!failureLogged_) {
                log_("rede: o Windows nao informa a conexao (INetworkListManager " + Hex(created) +
                     "): o intervalo tenta de novo, e o teste DNS vale");
            }
            failureLogged_ = true;
            return false;
        }
        // Os avisos: sem eles, o intervalo le de novo assim mesmo.
        ComPtr<IConnectionPointContainer> container;
        HRESULT advised = manager_.As(&container);
        if (SUCCEEDED(advised)) {
            advised = container->FindConnectionPoint(__uuidof(INetworkListManagerEvents), point_.ReleaseAndGetAddressOf());
        }
        if (SUCCEEDED(advised) && point_) {
            ConnectivitySink* sink = new ConnectivitySink(shared_);
            advised = point_->Advise(sink, &cookie_);
            sink->Release();   // o ponto de conexao guarda a referencia dele
        }
        if (FAILED(advised) || !point_) {
            point_.Reset();
            cookie_ = 0;
            log_("rede: sem os avisos de conectividade do Windows (" + Hex(advised) + "): o intervalo le de novo");
        }
        return true;
    }

    void Disconnect() {
        if (point_ && cookie_) point_->Unadvise(cookie_);
        point_.Reset();
        cookie_ = 0;
        manager_.Reset();
    }

    std::shared_ptr<NetworkMonitor::Shared> shared_;
    Log log_;
    ComPtr<INetworkListManager> manager_;
    ComPtr<IConnectionPoint> point_;
    DWORD cookie_ = 0;
    bool failureLogged_ = false;
};

// O DNS responde pelo nome do servidor (DnsQuery_W sem o cache do Windows: a pergunta vai a rede, e o arquivo hosts
// continua valendo, como para o motor). "Esse nome nao existe" e "sem endereco IPv4" tambem sao respostas do DNS: so a
// falta de resposta (o tempo esgotado, a rede fora, o servidor de DNS que falhou ou recusou) conta como falha.
bool DnsAnswers(const std::string& server, DNS_STATUS* status) {
    PDNS_RECORD records = nullptr;
    *status = DnsQuery_W(Utf8ToWide(server).c_str(), DNS_TYPE_A, DNS_QUERY_BYPASS_CACHE, nullptr, &records, nullptr);
    if (records) DnsRecordListFree(records, DnsFreeRecordList);
    return *status == ERROR_SUCCESS || *status == DNS_ERROR_RCODE_NAME_ERROR || *status == DNS_INFO_NO_RECORDS;
}

// O teste DNS numa thread solta: ninguem a espera (nem o Stop), e ela guarda o resultado (com a vez) para o monitor.
void StartDnsCheck(const std::shared_ptr<NetworkMonitor::Shared>& shared, const std::string& server, uint64_t ticket) {
    std::thread([shared, server, ticket] {
        DNS_STATUS status = 0;
        const bool answered = DnsAnswers(server, &status);
        std::lock_guard<std::mutex> lock(shared->mutex);
        shared->dnsDone = true;
        shared->dnsTicket = ticket;
        shared->dnsAnswered = answered;
        shared->dnsStatus = static_cast<long>(status);
        shared->wake.notify_all();
    }).detach();
}

}  // namespace

NetworkMonitor::NetworkMonitor(Hooks hooks, unsigned intervalMs, bool verboseDns)
    : hooks_(std::move(hooks)),
      intervalMs_(intervalMs > 0 ? intervalMs : kIntervalMs),
      verboseDns_(verboseDns),
      shared_(std::make_shared<Shared>()) {}

NetworkMonitor::~NetworkMonitor() { Stop(); }

void NetworkMonitor::Start() {
    if (thread_.joinable()) return;
    {
        std::lock_guard<std::mutex> lock(shared_->mutex);
        if (shared_->stopping) return;
    }
    thread_ = std::thread([this] { Run(); });
}

void NetworkMonitor::Stop() {
    {
        std::lock_guard<std::mutex> lock(shared_->mutex);
        shared_->stopping = true;
        shared_->wake.notify_all();
    }
    if (thread_.joinable()) thread_.join();
}

void NetworkMonitor::SetAccount(const std::string& server, bool connected) {
    std::lock_guard<std::mutex> lock(shared_->mutex);
    if (server != shared_->server) {
        shared_->server = server;
        shared_->serverChanged = true;
    }
    if (connected != shared_->connected) {
        shared_->connected = connected;
        shared_->connectedChanged = true;
    }
    shared_->wake.notify_all();
}

void NetworkMonitor::Force(std::optional<bool> internet) {
    std::lock_guard<std::mutex> lock(shared_->mutex);
    shared_->force = internet;
    shared_->forceChanged = true;
    shared_->wake.notify_all();
}

void NetworkMonitor::Run() {
    const Log log = [this](const std::string& line) {
        if (hooks_.log) hooks_.log(line);
    };
    // O apartamento multithread: os avisos chegam nas threads do COM, sem laco de mensagens aqui.
    const HRESULT com = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    {
        WindowsConnectivity windows(shared_, log);
        NetworkLoop loop([&windows] { return windows.Read(); }, intervalMs_, verboseDns_);
        // O que o passo pede, fora da trava.
        const auto apply = [this, &log, &loop](const NetworkLoop::Actions& actions) {
            for (const std::string& line : actions.log) log(line);
            if (actions.internet && hooks_.changed) hooks_.changed(*actions.internet);
            if (actions.dnsServer) {
                try {
                    StartDnsCheck(shared_, *actions.dnsServer, actions.dnsTicket);
                } catch (const std::exception&) {
                    loop.OnDnsNotStarted(actions.dnsTicket);   // sem thread: o proximo intervalo tenta de novo
                }
            }
        };
        apply(loop.Open(NowMs()));

        std::unique_lock<std::mutex> lock(shared_->mutex);
        for (;;) {
            shared_->wake.wait_until(lock, TimeOf(loop.WakeAtMs()), [this] { return shared_->Pending(); });
            if (shared_->stopping) break;
            const bool windowsChanged = std::exchange(shared_->windowsChanged, false);
            const bool serverChanged = std::exchange(shared_->serverChanged, false);
            const std::string server = shared_->server;
            const bool connectedChanged = std::exchange(shared_->connectedChanged, false);
            const bool connected = shared_->connected;
            const bool forceChanged = std::exchange(shared_->forceChanged, false);
            const std::optional<bool> force = shared_->force;
            const bool dnsDone = std::exchange(shared_->dnsDone, false);
            const uint64_t dnsTicket = shared_->dnsTicket;
            const bool dnsAnswered = shared_->dnsAnswered;
            const long dnsStatus = shared_->dnsStatus;
            lock.unlock();

            if (windowsChanged) apply(loop.OnWindowsChanged());
            if (serverChanged) apply(loop.OnServer(server));   // antes do conectado: a conta nova vem com o dela
            if (connectedChanged) apply(loop.OnConnected(connected));
            if (forceChanged) apply(loop.OnForce(force));
            if (dnsDone) apply(loop.OnDnsResult(dnsTicket, dnsAnswered, dnsStatus));
            const int64_t now = NowMs();
            if (now >= loop.WakeAtMs()) apply(loop.OnTimer(now));

            lock.lock();
        }
    }   // o Unadvise e o objeto do Windows saem antes do CoUninitialize
    if (SUCCEEDED(com)) CoUninitialize();
}

}  // namespace starsonic
