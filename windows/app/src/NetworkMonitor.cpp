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
#include <cstdio>
#include <deque>
#include <exception>
#include <mutex>
#include <utility>

#include "NetworkDecision.h"
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
    std::deque<int> connectivity;   // os avisos do Windows que o monitor ainda nao viu
    std::string server;             // o servidor da conta ("" sem conta)
    bool serverChanged = false;
    bool forceChanged = false;
    std::optional<bool> force;
    bool dnsRunning = false;        // um teste DNS a caminho
    bool dnsDone = false;           // um teste terminou e o monitor ainda nao viu
    std::string dnsServer;          // o servidor do teste que terminou
    bool dnsAnswered = false;
    long dnsStatus = 0;             // o DNS_STATUS dele (o diagnostico)

    void Connectivity(int value) {
        std::lock_guard<std::mutex> lock(mutex);
        connectivity.push_back(value);
        wake.notify_all();
    }

    // Com a trava.
    bool Pending() const { return stopping || !connectivity.empty() || serverChanged || forceChanged || dnsDone; }
};

namespace {

std::string Hex(long value) {
    char text[16];
    std::snprintf(text, sizeof(text), "0x%08lx", static_cast<unsigned long>(value));
    return text;
}

// Os avisos de conectividade do Windows: o COM chama nas threads dele, e o sink so guarda e acorda o monitor.
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

    HRESULT STDMETHODCALLTYPE ConnectivityChanged(NLM_CONNECTIVITY connectivity) override {
        shared_->Connectivity(static_cast<int>(connectivity));
        return S_OK;
    }

private:
    std::atomic<ULONG> references_{1};
    std::shared_ptr<NetworkMonitor::Shared> shared_;
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

// O teste DNS numa thread solta: ninguem a espera (nem o Stop), e ela guarda o resultado para o monitor.
void StartDnsCheck(const std::shared_ptr<NetworkMonitor::Shared>& shared, const std::string& server) {
    std::thread([shared, server] {
        DNS_STATUS status = 0;
        const bool answered = DnsAnswers(server, &status);
        std::lock_guard<std::mutex> lock(shared->mutex);
        shared->dnsRunning = false;
        shared->dnsDone = true;
        shared->dnsServer = server;
        shared->dnsAnswered = answered;
        shared->dnsStatus = static_cast<long>(status);
        shared->wake.notify_all();
    }).detach();
}

}  // namespace

NetworkMonitor::NetworkMonitor(Hooks hooks) : hooks_(std::move(hooks)), shared_(std::make_shared<Shared>()) {}

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

void NetworkMonitor::SetServer(const std::string& server) {
    std::lock_guard<std::mutex> lock(shared_->mutex);
    if (server == shared_->server) return;
    shared_->server = server;
    shared_->serverChanged = true;
    shared_->wake.notify_all();
}

void NetworkMonitor::Force(std::optional<bool> internet) {
    std::lock_guard<std::mutex> lock(shared_->mutex);
    shared_->force = internet;
    shared_->forceChanged = true;
    shared_->wake.notify_all();
}

void NetworkMonitor::Run() {
    const auto log = [this](const std::string& line) {
        if (hooks_.log) hooks_.log(line);
    };
    NetworkDecision decision;
    // O que vale mudou: vai ao DesktopApp (fora da trava).
    const auto report = [this, &log](const char* why, std::optional<bool> internet) {
        if (!internet) return;
        log(std::string("rede: ") + (*internet ? "com internet" : "sem internet") + " (" + why + ")");
        if (hooks_.changed) hooks_.changed(*internet);
    };

    // O Windows: a conectividade de agora e os avisos dela (o apartamento multithread: os avisos chegam nas threads do
    // COM, sem laco de mensagens aqui).
    const HRESULT com = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    ComPtr<INetworkListManager> manager;
    ComPtr<IConnectionPoint> point;
    DWORD cookie = 0;
    const HRESULT created = CoCreateInstance(__uuidof(NetworkListManager), nullptr, CLSCTX_ALL,
                                             __uuidof(INetworkListManager),
                                             reinterpret_cast<void**>(manager.ReleaseAndGetAddressOf()));
    if (FAILED(created) || !manager) {
        log("rede: o Windows nao informa a conexao (INetworkListManager " + Hex(created) + "): so o teste DNS vale");
    } else {
        ComPtr<IConnectionPointContainer> container;
        HRESULT advised = manager.As(&container);
        if (SUCCEEDED(advised)) {
            advised = container->FindConnectionPoint(__uuidof(INetworkListManagerEvents), point.ReleaseAndGetAddressOf());
        }
        if (SUCCEEDED(advised) && point) {
            ConnectivitySink* sink = new ConnectivitySink(shared_);
            advised = point->Advise(sink, &cookie);
            sink->Release();   // o ponto de conexao guarda a referencia dele
        }
        if (FAILED(advised) || !point) {
            point.Reset();
            cookie = 0;
            log("rede: sem os avisos de conectividade do Windows (" + Hex(advised) + ")");
        }
        NLM_CONNECTIVITY connectivity = NLM_CONNECTIVITY_DISCONNECTED;
        const HRESULT read = manager->GetConnectivity(&connectivity);
        if (SUCCEEDED(read)) {
            log("rede: conectividade do Windows " + Hex(static_cast<long>(connectivity)));
            report("o Windows", decision.OnConnectivity(static_cast<int>(connectivity)));
        } else {
            log("rede: a conectividade do Windows nao foi lida (" + Hex(read) + ")");
        }
    }

    using Clock = std::chrono::steady_clock;
    const std::chrono::milliseconds interval(kDnsIntervalMs);
    Clock::time_point nextDns = Clock::now() + interval;
    std::unique_lock<std::mutex> lock(shared_->mutex);
    for (;;) {
        shared_->wake.wait_until(lock, nextDns, [this] { return shared_->Pending(); });
        if (shared_->stopping) break;
        std::deque<int> connectivity;
        connectivity.swap(shared_->connectivity);
        const bool serverChanged = shared_->serverChanged;
        shared_->serverChanged = false;
        const bool forceChanged = shared_->forceChanged;
        shared_->forceChanged = false;
        const std::optional<bool> force = shared_->force;
        // O resultado de um teste do servidor de antes (a conta mudou no meio) nao conta.
        const bool dnsCurrent = shared_->dnsDone && shared_->dnsServer == shared_->server;
        shared_->dnsDone = false;
        const bool answered = shared_->dnsAnswered;
        const long dnsStatus = shared_->dnsStatus;
        const std::string server = shared_->server;
        lock.unlock();

        for (const int value : connectivity) {
            log("rede: conectividade do Windows " + Hex(value));
            report("o Windows", decision.OnConnectivity(value));
        }
        if (serverChanged) report("outra conta", decision.OnServerChanged(server));
        if (forceChanged) report("forcado", decision.Force(force));
        if (dnsCurrent) {
            if (!answered && decision.Internet()) {
                log("rede: o DNS nao respondeu pelo servidor " + server + " (" + std::to_string(dnsStatus) + ")");
            }
            report(answered ? "o DNS respondeu pelo servidor da conta"
                            : "o DNS nao respondeu pelo servidor da conta duas vezes seguidas",
                   decision.OnDnsResult(answered));
        }

        lock.lock();
        // O teste DNS: a cada 30 s, ou na hora quando a rede mudou. So com um servidor com nome e alguma rede.
        const Clock::time_point now = Clock::now();
        const bool tick = now >= nextDns;
        if (tick) nextDns = now + interval;
        if ((tick || decision.DnsCheckNow()) && decision.DnsCheckUseful() && !shared_->server.empty() &&
            !shared_->dnsRunning && !shared_->stopping) {
            if (!tick) log("rede: a rede mudou: teste DNS de " + shared_->server + " agora");
            nextDns = now + interval;
            decision.DnsCheckStarted();
            shared_->dnsRunning = true;
            try {
                StartDnsCheck(shared_, shared_->server);
            } catch (const std::exception&) {
                shared_->dnsRunning = false;   // sem thread: tenta de novo daqui a 30 s
            }
        }
    }
    lock.unlock();

    if (point && cookie) point->Unadvise(cookie);
    point.Reset();
    manager.Reset();
    if (SUCCEEDED(com)) CoUninitialize();
}

}  // namespace starsonic
