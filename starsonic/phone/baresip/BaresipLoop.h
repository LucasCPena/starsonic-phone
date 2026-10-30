#pragma once
// O laço da libre (re_main) numa thread do motor com o baresip, com o baresip montado nela, e o caminho das outras
// threads até ele (Run). Interno ao motor; este cabeçalho não inclui a libre nem o baresip.
//
// O log da libre (dbg), o do baresip e cada mensagem SIP inteira que sai e que chega (no nível 4) vão para o LogSink na
// hora, na thread que escreveu: a do laço, uma do re_thread_async ou a que está num Run. Níveis como no EngineConfig: 1
// erro, 2 aviso, 3 informação e 4 detalhe; as linhas acima do logLevel não saem. As linhas do baresip também vão, todas
// (sem esse filtro) e depois do LogSink, ao baresipLines da LoopConfig: o baresip monta pelo menos as de informação.
//
// A thread do laço é a do re_main, que trata a rede e os temporizadores. Uma que está num Run também tem a trava da
// libre, mas não é a do laço.
#include <atomic>
#include <condition_variable>
#include <cstddef>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace starsonic {

struct LoopConfig {
    std::string userAgent;
    int logLevel = 4;        // 1 erro .. 4 detalhe, como o EngineConfig
    bool nullAudio = false;  // a fonte e a saída de som nulas (NullAudio.h) no lugar das do sistema
    // Para quem precisa de uma linha do baresip que não vira evento (o BaresipCalls): cada linha de log do baresip, sem
    // o fim de linha, também as acima do logLevel, logo depois de ela ir ao log, na thread que a escreveu. onLoopThread
    // só é true na thread do laço (a do re_main); numa que está num Run, com a trava da libre, ou numa outra (a do
    // áudio), é false. Vazio: nada. Dura mais que o laço e nunca chama o Run.
    std::function<void(const std::string& line, bool onLoopThread)> baresipLines;
};

class BaresipLoop {
public:
    using LogSink = std::function<void(int level, const std::string& line)>;

    // Sobe a thread do laço e volta quando tudo subiu e o re_main já está rodando (true), ou quando falhou
    // (false, com o motivo em *error). Uma por processo.
    static std::unique_ptr<BaresipLoop> Start(const LoopConfig& config, LogSink log, std::string* error);

    // Pede o fim do laço e espera a thread dele acabar, com o baresip e a libre fechados. Nenhum Run ao mesmo tempo.
    ~BaresipLoop();

    BaresipLoop(const BaresipLoop&) = delete;
    BaresipLoop& operator=(const BaresipLoop&) = delete;

    // De qualquer thread menos a do laço: re_thread_enter, work, re_thread_leave, e true. O work é curto e nunca
    // espera a rede: quem espera uma resposta sai do Run, espera numa condition_variable que o handler (na
    // thread do laço) avisa, e volta com outro Run. Depois que o re_main voltou sozinho (o laço parou sem o pedido do
    // destrutor, com a libre e o baresip já fechando), o work não roda: false, e uma linha no log. Quem recebe false
    // não solta mais nada da libre nem do baresip (fica como está até o processo acabar).
    bool Run(const std::function<void()>& work);

    // Os módulos do baresip que o laço carrega (module_preload), na ordem: os de baresip.modules do build/deps.lock.
    static std::vector<std::string> Modules();

    // O texto de um código de erro da libre ou do baresip, com o número (o %m da libre): "Connection refused [111]".
    static std::string ErrorText(int err);

private:
    struct Hooks;   // as funções que a libre e o baresip chamam (BaresipLoop.cpp)

    enum class State { Starting, Running, Failed };

    BaresipLoop(const LoopConfig& config, LogSink log);

    void Main();                     // a thread do laço
    bool Setup(std::string* error);  // na thread do laço, até os módulos
    void Teardown();                 // na thread do laço, depois do re_main
    // Sai do Starting para o estado (e avisa o Start); false se o Start já tinha voltado.
    bool Report(State state, const std::string& error);
    void Log(int level, const char* text, size_t length) const;
    void Observe(const char* text) const;   // uma linha do baresip para o baresipLines, se há um

    const LoopConfig config_;
    const LogSink log_;
    bool libreReady_ = false;   // só na thread do laço
    bool nullAudioReady_ = false;
    std::mutex mutex_;          // o estado, para o Start
    std::condition_variable changed_;
    State state_ = State::Starting;
    std::string error_;
    std::atomic<bool> ended_{false};   // o re_main voltou (a thread do laço escreve; o Run lê)
    std::atomic<std::thread::id> loopThread_{};   // a thread do laço, que a escreve ao nascer (o Observe lê)
    std::thread thread_;        // a do laço (Start)
};

}  // namespace starsonic
