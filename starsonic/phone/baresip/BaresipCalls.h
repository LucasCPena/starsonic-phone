#pragma once
// As ligações do motor com o baresip (internas): fazer, receber, atender, recusar e desligar, com os eventos do
// contrato (SipEngine.h) na ordem e com os códigos do motor do PJSIP. Até duas ligações: a que chega com outra ainda
// não confirmada, ou com duas em andamento, recebe 486.
//
// Tudo aqui roda na thread do laço: dentro do BaresipLoop::Run ou no handler dos eventos do baresip (bevent), que
// repassa ao OnEvent. Só o Count é lido de qualquer thread. Cada ligação é do baresip (a lista da ua); o ponteiro dela
// fica aqui até o BEVENT_CALL_CLOSED, depois do qual o baresip a solta.
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
    // A ligação acaba aqui mesmo, com o Disconnected na fila; a libre termina o pedido sozinha.
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
    // as ligações que chegam daqui em diante recebem 480.
    void EndAll();

private:
    // Uma vaga; livre com id 0.
    struct Slot {
        struct call* call = nullptr;
        int id = 0;               // o id para o listener
        bool incoming = false;    // recebida (senão, feita aqui)
        bool answered = false;    // recebida: o 200 já saiu (Answer)
        bool confirmed = false;   // chegou ao Confirmed
    };

    void OnInvite(const struct sip_msg* msg);   // o BEVENT_SIPSESS_CONN: toca, ou 486 ou 480
    // A ligação acaba aqui: a vaga se solta, o pedido sai (ua_hangup: o code na recusa da recebida que toca, senão o
    // CANCEL ou o BYE) e, com report, vem o Disconnected(code).
    void End(Slot& slot, int code, bool report);
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
};

}  // namespace starsonic
