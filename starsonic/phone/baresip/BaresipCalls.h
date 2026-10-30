#pragma once
// As ligações do motor com o baresip (internas): fazer, receber, atender, recusar e desligar, com os eventos do
// contrato (SipEngine.h) na ordem e com os códigos do motor do PJSIP. Até duas ligações: a que chega com outra ainda
// não confirmada, ou com duas em andamento, recebe 486.
//
// Tudo aqui roda na thread do laço: dentro do BaresipLoop::Run, no handler dos eventos do baresip (bevent), que repassa
// ao OnEvent, ou no temporizador das que esperam para mandar o pedido do Hangup. Só o Count é lido de qualquer thread.
// Cada ligação é do baresip (a lista da ua); o ponteiro dela fica aqui (numa vaga ou na lista das que esperam) até o
// BEVENT_CALL_CLOSED, depois do qual o baresip a solta.
#include <re.h>
#include <baresip.h>

#include <atomic>
#include <string>
#include <vector>

#include "BaresipLoop.h"
#include "Profile.h"
#include "SipEngine.h"

namespace starsonic {

class EventQueue;

class BaresipCalls {   // estado na thread do laço; Count() é lido de qualquer thread (atômico)
public:
    // events: por onde saem os avisos das ligações; dura mais que o BaresipCalls. dtmf: o método das teclas do perfil
    // (o SendDtmf, que ainda não manda nada).
    BaresipCalls(EventQueue& events, BaresipLoop::LogSink log, DtmfMethod dtmf);

    BaresipCalls(const BaresipCalls&) = delete;
    BaresipCalls& operator=(const BaresipCalls&) = delete;

    void OnEvent(enum bevent_ev ev, struct bevent* event);   // o handler do bevent repassa aqui

    // Liga para uri (a URI inteira) pela ua da conta e devolve o id da ligação, com o OnCallState(Calling, 0) já na
    // fila. -1 (sem evento): já há duas ligações, a outra ainda não foi confirmada ou o baresip recusou (o log diz).
    int Make(struct ua* ua, const std::string& uri);
    // Só numa recebida que toca: o 200 sai e vem OnCallState(Connecting, 200); ou o 486 e o Disconnected.
    bool Answer(int id);
    bool Reject(int id);
    // Em qualquer estado: o 603 numa recebida que toca, o CANCEL numa feita sem resposta final e o BYE numa atendida.
    // A ligação sai daqui na hora, com o Disconnected na fila, e o pedido sai já, menos em dois casos, em que ele
    // espera a resposta do outro lado: a feita que ainda não teve um 18x nem o 200 (a libre não pode mandar o CANCEL
    // antes de uma resposta provisória, RFC 3261 9.1, e largaria o INVITE: o CANCEL sai no primeiro 18x, e no 200 sai o
    // BYE) e a recebida atendida que ainda não teve o ACK (o BYE de antes dele sairia uma vez só: ele sai depois do
    // ACK, como no PJSIP). Depois de mandado, a libre termina o pedido sozinha.
    bool Hangup(int id);
    int Count() const;   // de qualquer thread; cai antes de o Disconnected chegar ao listener
    // {0} (o dispositivo de som) para uma ligação confirmada; vazio para uma que toca ou chama e para um id
    // desconhecido.
    std::vector<int> AudioLinks(int id) const;

    // A conta sai (a troca e a saída da conta): o Hangup de cada ligação, com os Disconnected de sempre. Daqui até o
    // Open da conta nova, as ligações que chegam recebem 480, sem evento, como no motor do PJSIP.
    void HangupAll();
    void Open();   // a conta nova: as ligações que chegam voltam a tocar
    // Só o destrutor do motor (a fila dos eventos já parou): os pedidos do Hangup (BYE, CANCEL ou 603), sem eventos;
    // as ligações que chegam daqui em diante recebem 480. O motor não espera as que ficam esperando a resposta (ver o
    // Hangup): se ela chega enquanto a conta sai, o pedido sai; senão a ligação acaba com a ua da conta, e então a
    // libre manda o CANCEL se já chegou alguma resposta provisória (o 100 Trying conta), e senão nada. Nesse caso quem
    // foi chamado toca até a central desistir, e um 200 dele fica sem o ACK (a central o repete e depois manda o BYE).
    // A recebida sem o ACK sai com a ua do mesmo jeito: a libre espera o ACK e manda o BYE, se o laço ainda roda.
    void EndAll();

private:
    struct Hooks;   // as funções que a libre chama (BaresipCalls.cpp)

    // Uma vaga; livre com id 0.
    struct Slot {
        struct call* call = nullptr;
        int id = 0;                // o id para o listener
        bool incoming = false;     // recebida (senão, feita aqui)
        bool answered = false;     // recebida: o 200 já saiu (Answer)
        bool progressed = false;   // feita: já chegou um 18x ou o 200 (o CANCEL e o BYE podem sair)
        bool confirmed = false;    // chegou ao Confirmed
    };

    // Uma ligação que já saiu das vagas (o Disconnected já foi) e espera a resposta do outro lado para mandar o pedido
    // do Hangup (ver o Hangup).
    struct Waiting {
        struct call* call;
        bool ready;   // a resposta chegou: o pedido sai no hangupTimer_
    };

    void OnInvite(const struct sip_msg* msg);   // o BEVENT_SIPSESS_CONN: toca, ou 486 ou 480
    // A ligação acaba aqui: a vaga se solta, o pedido sai (ua_hangup: o code na recusa da recebida que toca, senão o
    // CANCEL ou o BYE) ou espera na waiting_ e, com report, vem o Disconnected(code).
    void End(Slot& slot, int code, bool report);
    // Um evento de uma ligação da waiting_: o 18x ou o ESTABLISHED a liberam, e o CLOSED a tira (sem aviso). false: não
    // está lá.
    bool OnWaiting(enum bevent_ev ev, const struct call* call);
    // No hangupTimer_, fora do handler do evento que as liberou (a libre ainda está no meio da resposta): o ua_hangup
    // das liberadas.
    void HangupReady();
    int HangupCode(const Slot& slot) const;
    // O código de um fim que não saiu daqui (o BEVENT_CALL_CLOSED dela, com o motivo que o baresip deu).
    int EndCode(const Slot& slot, const struct call* call, const char* text) const;
    void Bind(Slot& slot, struct call* call, bool incoming);
    void Free(Slot& slot);
    void Recount();   // o count_, pelas vagas ocupadas
    Slot* Find(int id);
    const Slot* Find(int id) const;
    Slot* Find(const struct call* call);
    Slot* FreeSlot();
    const Slot* Other(const Slot& slot) const;   // a outra vaga, se está ocupada
    void PostState(int id, CallState state, int code);
    void Log(int level, const std::string& line) const;

    EventQueue& events_;
    const BaresipLoop::LogSink log_;
    Slot slots_[2];
    int nextId_ = 1;           // os ids começam em 1 e nunca se repetem no mesmo motor
    bool open_ = true;         // false: a conta ou o motor saindo (HangupAll e EndAll), e as que chegam recebem 480
    std::atomic<int> count_{0};   // as vagas ocupadas, para o Count
    std::vector<Waiting> waiting_;
    // Só fica armado com alguma ligação na waiting_: elas saem dela no disparo ou no CLOSED (todas, no mais tardar, com
    // a ua da conta), e o último CLOSED o desarma. Assim nada dele sobra depois do laço.
    struct tmr hangupTimer_;
};

}  // namespace starsonic
