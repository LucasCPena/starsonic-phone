#pragma once
// O monitor de rede do executavel (rc.3, spec 8 e Ruling 16): diz ao DesktopApp (hooks.changed: DesktopApp::SetInternet,
// que so poe na fila) quando a internet cai e quando volta. O que fazer a cada passo e do NetworkLoop.h (portatil e
// testado: a conectividade lida de novo a cada intervalo e a cada aviso, o teste DNS, o diagnostico); aqui ficam so a
// thread, o COM e o DNS de verdade:
// - o Windows: o INetworkListManager (o GetConnectivity, e os avisos ConnectivityChanged pelo sink do
//   INetworkListManagerEvents, que so acordam o monitor), numa thread propria no apartamento multithread; sem o objeto,
//   ou com ele quebrado (o servico do Windows reiniciou), a proxima leitura cria de novo;
// - o teste DNS do servidor da conta: o DnsQuery_W sem o cache do Windows, numa thread solta por teste, um de cada vez
//   (um DNS que demora a responder nunca segura o monitor nem o fechamento).
// O intervalo e de 30 s (o build de teste pode encurtar: STARSONIC_TESTE_DNS_MS, com cada resultado no diagnostico).
//
// Threads: Start e Stop na thread do wWinMain; SetServer e Force de qualquer thread (so guardam e acordam o monitor).
// hooks.changed e hooks.log rodam na thread do monitor, fora da trava. Stop espera so a thread do monitor (que solta o
// COM, dentro do fechamento com limite do wWinMain); um teste DNS a caminho termina sozinho, e o resultado dele e
// descartado.
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

    // O intervalo de sempre: a conectividade lida de novo e o teste DNS do servidor da conta.
    static constexpr unsigned kIntervalMs = 30000;

    // verboseDns: cada resultado do teste DNS vai ao diagnostico (so o build de teste).
    explicit NetworkMonitor(Hooks hooks, unsigned intervalMs = kIntervalMs, bool verboseDns = false);
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
    unsigned intervalMs_;
    bool verboseDns_;
    std::shared_ptr<Shared> shared_;
    std::thread thread_;
};

}  // namespace starsonic
