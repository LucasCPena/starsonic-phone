#pragma once
// O laço da libre (re_main) numa thread do motor com o baresip, com o baresip montado nela, e o caminho das outras threads
// até ele (Run). Interno ao motor; este cabeçalho não inclui a libre nem o baresip.
//
// O log da libre (dbg), o do baresip e cada mensagem SIP inteira que sai e que chega (no nível 4) vão para o LogSink na
// hora, na thread que escreveu: a do laço, uma do re_thread_async ou a que está num Run. Níveis como no EngineConfig: 1
// erro, 2 aviso, 3 informação e 4 detalhe; as linhas acima do logLevel não saem.
#include <condition_variable>
#include <cstddef>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <thread>

namespace starsonic {

struct LoopConfig {
    std::string userAgent;
    int logLevel = 4;        // 1 erro .. 4 detalhe, como o EngineConfig
    bool nullAudio = false;  // a fonte e a saída de som nulas (NullAudio.h) no lugar das do sistema
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

    // De qualquer thread menos a do laço: re_thread_enter, work, re_thread_leave. O work é curto e nunca
    // espera a rede: quem espera uma resposta sai do Run, espera numa condition_variable que o handler (na
    // thread do laço) avisa, e volta com outro Run.
    void Run(const std::function<void()>& work);

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

    const LoopConfig config_;
    const LogSink log_;
    bool libreReady_ = false;   // só na thread do laço
    bool nullAudioReady_ = false;
    std::mutex mutex_;          // o estado, para o Start
    std::condition_variable changed_;
    State state_ = State::Starting;
    std::string error_;
    std::thread thread_;        // a do laço (Start)
};

}  // namespace starsonic
