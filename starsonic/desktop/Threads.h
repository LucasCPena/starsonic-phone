#pragma once
// As threads do app de PC, em C++ portatil (std::thread): a fila de comandos (SerialExecutor), onde o DesktopApp
// roda tudo o que faz, e o relogio e o agendador de verdade do controlador de ligacoes (SystemClock e
// ThreadScheduler; os contratos do Clock e do Scheduler estao no CallController.h).
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <functional>
#include <map>
#include <mutex>
#include <thread>
#include <unordered_map>

#include "CallController.h"   // Clock, Scheduler

namespace starsonic {

// Uma fila de tarefas. Post nunca roda a tarefa dentro dele (ela roda depois, na thread da fila); as tarefas rodam
// uma por vez, na ordem em que entraram. false: a fila ja parou, e a tarefa e descartada. Stop para de aceitar
// tarefas, roda as que ja estavam na fila e volta quando elas acabaram (de dentro de uma tarefa, so para de
// aceitar).
class Executor {
public:
    virtual ~Executor() = default;
    virtual bool Post(std::function<void()> task) = 0;
    virtual void Stop() = 0;
};

// A fila com uma thread so (a thread de comandos do DesktopApp). Post pode ser chamado de qualquer thread, tambem
// de dentro de uma tarefa (a nova entra no fim da fila). Uma tarefa que lanca uma excecao e descartada, e a fila
// continua.
class SerialExecutor : public Executor {
public:
    SerialExecutor();
    // Stop(). Nunca de dentro de uma tarefa.
    ~SerialExecutor() override;

    SerialExecutor(const SerialExecutor&) = delete;
    SerialExecutor& operator=(const SerialExecutor&) = delete;

    bool Post(std::function<void()> task) override;

    // Para de aceitar tarefas, roda as que ja estavam na fila e espera a thread terminar. De dentro de uma tarefa, so
    // para de aceitar (a thread termina depois da fila, e o destrutor, chamado de outra thread, espera por ela).
    void Stop() override;

    // A thread que chama e a da fila.
    bool OnWorkerThread() const;

private:
    void Run();

    mutable std::mutex mutex_;
    std::condition_variable wake_;
    std::deque<std::function<void()>> queue_;
    bool stopping_ = false;
    std::thread worker_;   // por ultimo: comeca depois dos outros membros
};

// Os milissegundos desde 1970 (o relogio do sistema): o activeSinceMs das ligacoes vai para a interface, que conta
// o tempo com o relogio dela, e o inicio de cada ligacao vai para os Recentes (recentes.json, ms desde 1970).
class SystemClock : public Clock {
public:
    int64_t NowMs() override;
};

// O Scheduler do controlador com uma thread propria: cada tarefa roda nela, delayMs depois do Schedule (medido no
// relogio monotonico, que nao anda para tras quando o relogio do sistema muda), sem nenhuma trava presa: o Schedule
// e o Cancel so pegam a trava da fila, que a tarefa nunca segura enquanto roda (o controlador chama o Schedule e o
// Cancel com a trava dele presa, e a tarefa pega a trava dele: com a trava da fila presa durante a tarefa, os dois
// esperariam um pelo outro para sempre). No mesmo instante, roda primeiro a agendada antes. Cancel nunca espera uma
// tarefa que ja esta rodando (ela pode terminar depois dele).
class ThreadScheduler : public Scheduler {
public:
    ThreadScheduler();
    // Stop(). Nunca de dentro de uma tarefa.
    ~ThreadScheduler() override;

    ThreadScheduler(const ThreadScheduler&) = delete;
    ThreadScheduler& operator=(const ThreadScheduler&) = delete;

    int Schedule(int64_t delayMs, std::function<void()> task) override;
    void Cancel(int id) override;

    // Descarta as tarefas que ainda nao rodaram e espera a que esta rodando terminar. Depois dele, Schedule devolve um
    // id que nunca roda, e Cancel nao faz nada. De dentro de uma tarefa, nao espera (o destrutor espera).
    void Stop();

    // Quantas tarefas esperam a hora delas (para os testes).
    size_t Pending() const;

private:
    using TimePoint = std::chrono::steady_clock::time_point;
    void Run();

    mutable std::mutex mutex_;
    std::condition_variable wake_;
    std::map<std::pair<TimePoint, int>, std::function<void()>> tasks_;   // por hora e, na mesma hora, pelo id
    std::unordered_map<int, TimePoint> due_;                             // a hora de cada id na fila
    int lastId_ = 0;
    bool stopping_ = false;
    std::thread worker_;   // por ultimo
};

}  // namespace starsonic
