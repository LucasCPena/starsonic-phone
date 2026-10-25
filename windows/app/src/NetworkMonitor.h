#pragma once
// O monitor de rede do executavel (rc.3, spec 8): diz ao DesktopApp (hooks.changed: DesktopApp::SetInternet, que so poe
// na fila) quando a internet cai e quando volta, pela decisao do NetworkDecision.h:
// - o Windows: o INetworkListManager (COM), lido na abertura e a cada aviso ConnectivityChanged (o sink do
//   INetworkListManagerEvents), numa thread propria no apartamento multithread (os avisos chegam nas threads do COM);
// - a cada 30 s, com a internet do Windows e uma conta (SetServer), um teste DNS do servidor da conta (GetAddrInfoW),
//   numa thread solta por teste: um nome que demora a responder nunca segura o monitor nem o fechamento.
// Sem o INetworkListManager (o servico do Windows fora), so o teste DNS vale. O valor so vai ao hooks.changed quando
// muda (o DesktopApp comeca com internet).
//
// Threads: Start e Stop na thread do wWinMain; SetServer e Force de qualquer thread (so guardam e acordam o monitor).
// hooks.changed e hooks.log rodam na thread do monitor. Stop espera so a thread do monitor (que solta o COM, dentro do
// fechamento com limite do wWinMain); um teste DNS a caminho termina sozinho, e o resultado dele e descartado.
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <thread>

namespace starsonic {

class NetworkMonitor {
public:
    struct Hooks {
        std::function<void(bool internet)> changed;   // DesktopApp::SetInternet
        std::function<void(const std::string& line)> log;
    };

    // O intervalo do teste DNS do servidor da conta.
    static constexpr unsigned kDnsIntervalMs = 30000;

    explicit NetworkMonitor(Hooks hooks);
    ~NetworkMonitor();   // Stop()

    NetworkMonitor(const NetworkMonitor&) = delete;
    NetworkMonitor& operator=(const NetworkMonitor&) = delete;

    // Comeca a thread do monitor (uma vez).
    void Start();
    // Para a thread do monitor (e solta o COM). Depois dele, nenhum gancho.
    void Stop();
    // O servidor da conta em uso (conta.servidor; "" sem conta: sem o teste DNS).
    void SetServer(const std::string& server);
    // So o gancho de teste do build de teste chama (o --teste-internet off|on da fumaca): forca a internet que vale
    // (nada: a visao de verdade de novo).
    void Force(std::optional<bool> internet);

    struct Shared;   // o estado dividido com o sink do COM e os testes DNS (NetworkMonitor.cpp)

private:
    void Run();

    Hooks hooks_;
    std::shared_ptr<Shared> shared_;
    std::thread thread_;
};

}  // namespace starsonic
