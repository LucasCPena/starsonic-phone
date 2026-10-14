#pragma once
// A fila dos eventos do motor (interna): os callbacks do PJSIP só põem o evento na fila, e uma thread
// do motor o entrega ao EngineListener, um de cada vez, na ordem em que entraram e sem trava nenhuma
// presa durante o aviso. Assim o listener pode chamar o motor, e nenhuma trava do PJSIP fica presa
// esperando o app.
#include <condition_variable>
#include <deque>
#include <functional>
#include <mutex>
#include <thread>

#include "SipEngine.h"

namespace starsonic {

class EventQueue {
public:
    using Event = std::function<void(EngineListener&)>;

    explicit EventQueue(EngineListener* listener);
    ~EventQueue();   // Stop()

    EventQueue(const EventQueue&) = delete;
    EventQueue& operator=(const EventQueue&) = delete;

    // Põe o evento no fim da fila; depois de Stop, descarta. Qualquer thread, com ou sem travas.
    void Post(Event event);

    // Para de entregar: espera o evento que está com o listener e descarta os que ainda esperam. Não
    // pode ser chamado de dentro de um evento.
    void Stop();

private:
    void Run();

    EngineListener* listener_;
    std::mutex mutex_;
    std::condition_variable wake_;
    std::deque<Event> queue_;
    bool stopped_ = false;
    std::thread thread_;   // o último campo: a thread começa com os outros prontos
};

}  // namespace starsonic
