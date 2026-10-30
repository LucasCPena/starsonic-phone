#pragma once
// As ligações do motor com o baresip (internas): fazer, receber, atender, recusar, desligar, pôr em espera e retomar,
// com os eventos do contrato (SipEngine.h) na ordem e com os códigos do motor do PJSIP. Até duas ligações: a que chega
// com outra ainda não confirmada, ou com duas em andamento, recebe 486.
//
// Um microfone só (o iPhone, spec 7.7), como a mesa de áudio do motor do PJSIP: uma das ligações é a ativa (a feita,
// a atendida ou a do Activate, até ela acabar), e só ela, fora da espera, fica com o áudio aberto. A outra, confirmada,
// vai para a espera (re-INVITE sendonly) com o áudio parado; se essa espera não sai antes de uma nova (o Make e o
// Answer), ela fica só com o áudio parado. O baresip abre o áudio de uma ligação sozinho a cada SDP que aplica, também
// o de uma só de envio (a em espera): o das outras para de novo logo depois (o audioTimer_).
//
// Tudo aqui roda na thread do laço: dentro do BaresipLoop::Run, no handler dos eventos do baresip (bevent), que repassa
// ao OnEvent, ou nos temporizadores (o das que esperam para mandar o pedido do Hangup e o do áudio). Só o Count é lido
// de qualquer thread, e só o WaitNegotiation espera, fora do Run.
// Cada ligação é do baresip (a lista da ua); o ponteiro dela fica aqui (numa vaga ou na lista das que esperam) até o
// BEVENT_CALL_CLOSED, depois do qual o baresip a solta.
#include <re.h>
#include <baresip.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <mutex>
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

    // Os pedidos que mandam re-INVITE (a espera ou a retomada): Make, Answer, Activate e SetHold. A libre recusa um
    // re-INVITE com outra oferta da mesma ligação no ar (o sipsess_modify dá EPROTO), e o call_hold do baresip, sem a
    // renegociação anterior acabada (call_refresh_allowed), marcaria a ligação sem mandar nada. Por isso, quando uma
    // ligação que o pedido renegociaria ainda espera a resposta de outra oferta, o pedido não muda nada, devolve false
    // (o Make, -1) e Blocked() fica true: quem chamou espera fora do Run (WaitNegotiation) e pede de novo. Uma espera
    // ou uma retomada que não sai (um erro de transporte na hora, por exemplo) deixa a ligação como estava, e o pedido
    // seguinte tenta de novo (ver o Renegotiate).

    // Liga para uri (a URI inteira) pela ua da conta e devolve o id da ligação, a ativa, com o OnCallState(Calling, 0)
    // já na fila. Com uma confirmada fora da espera, ela vai para a espera antes e fica nela mesmo se a nova não sai;
    // como no motor do PJSIP, essa espera é o que se pode (ver o HoldBeforeNew): com lastTry (o prazo da espera passou)
    // ou com o re-INVITE dela que não sai, a nova sai assim mesmo. -1 (sem evento): já há duas ligações, a outra ainda
    // não foi confirmada, o baresip recusou (o log diz) ou Blocked.
    int Make(struct ua* ua, const std::string& uri, bool lastTry);
    // Só numa recebida que toca: o 200 sai e vem OnCallState(Connecting, 200); ela vira a ativa. A outra, confirmada e
    // fora da espera, vai para a espera antes do 200, como no ua_hold_answer do baresip, e fica nela mesmo se o 200
    // não sai; essa espera é o que se pode, como no Make. false: não é uma recebida que toca, o 200 não saiu ou
    // Blocked.
    bool Answer(int id, bool lastTry);
    bool Reject(int id);   // só numa recebida que toca: o 486 e o Disconnected
    // Em qualquer estado: o 603 numa recebida que toca, o CANCEL numa feita sem resposta final e o BYE numa atendida.
    // A ligação sai daqui na hora, com o Disconnected na fila, e o pedido sai já, menos em dois casos, em que ele
    // espera a resposta do outro lado: a feita que ainda não teve um 18x nem o 200 (a libre não pode mandar o CANCEL
    // antes de uma resposta provisória, RFC 3261 9.1, e largaria o INVITE: o CANCEL sai no primeiro 18x, e no 200 sai o
    // BYE) e a recebida atendida que ainda não teve o ACK (o BYE de antes dele sairia uma vez só: ele sai depois do
    // ACK, como no PJSIP). Depois de mandado, a libre termina o pedido sozinha. Desligada a ativa, nenhuma é a ativa: a
    // outra segue em espera, sem áudio, até um Activate.
    bool Hangup(int id);
    // Só numa confirmada: ela vira a ativa. A outra, confirmada e fora da espera, vai para a espera, e esta é retomada
    // (re-INVITE sendrecv) se estava em espera; já ativa, nada muda e nenhum re-INVITE sai. false: id desconhecido,
    // ligação não confirmada, Blocked ou um re-INVITE que não saiu (o log diz): sem a espera da outra, nada muda; sem a
    // retomada, esta segue em espera (e a outra, se já foi, também).
    bool Activate(int id);
    // Só numa confirmada: true a põe em espera (re-INVITE sendonly; já em espera, nada muda), e false é o Activate.
    // false: id desconhecido, ligação não confirmada, Blocked ou o re-INVITE que não saiu (o log diz; nada muda).
    bool SetHold(int id, bool hold);
    // O último Make, Answer, Activate ou SetHold não mudou nada: uma ligação que ele renegociaria ainda espera a
    // resposta de outra oferta.
    bool Blocked() const;
    // Quantas negociações acabaram até agora: cada resposta a uma oferta (o BEVENT_CALL_REMOTE_SDP com answer) e cada
    // ligação que acaba. O Run do pedido lê, e o WaitNegotiation espera mudar.
    uint64_t Negotiations() const;
    // Fora do Run, de qualquer thread: espera até deadline que Negotiations() deixe de ser seen, mas só por pouco tempo
    // de cada vez (uma recusa do re-INVITE, 4xx a 6xx, acaba a renegociação sem nenhum evento do baresip; quem chamou
    // confere de novo, num Run).
    void WaitNegotiation(uint64_t seen, std::chrono::steady_clock::time_point deadline);
    int Count() const;   // de qualquer thread; cai antes de o Disconnected chegar ao listener
    // {0} (o dispositivo de som) só para a ativa, confirmada e fora da espera; vazio para a outra, para uma que toca ou
    // chama e para um id desconhecido.
    std::vector<int> AudioLinks(int id) const;
    // Os ids das ligações com o áudio aberto (o audio_started do baresip), em ordem crescente: os testes
    // (SipEngineTestAccess).
    std::vector<int> CallsWithAudio() const;
    // Os testes (SipEngineTestAccess): com on, nenhum re-INVITE com oferta sai, como num erro de transporte na hora (a
    // rede fora). O aviso do SDP que o baresip monta para ele (o BEVENT_CALL_LOCAL_SDP com offer, numa confirmada)
    // recebe um erro, e o call_modify do baresip volta antes de mandar o re-INVITE e de aplicar a direção nova.
    void FailReinvites(bool on);

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
        // Em espera daqui: o último re-INVITE que saiu foi o da espera. Só o Renegotiate muda, e só quando o re-INVITE
        // sai; a marca do baresip (call_is_onhold) anda junto.
        bool held = false;
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
    bool Silent(const Slot& slot) const;         // não pode ter o áudio aberto: não é a ativa, ou está em espera
    bool OfferPending(const Slot& slot) const;   // ainda espera a resposta de uma oferta: a libre recusaria outra
    // A espera (sendonly) ou a retomada (sendrecv), numa confirmada sem oferta no ar: 0 quando o re-INVITE sai, e então
    // o held muda; senão o erro, e tudo fica como estava. O áudio segue o held: parado se ela fica Silent (o call_hold
    // abre a fonte de som de novo ao aplicar a direção nova).
    int Renegotiate(Slot& slot, bool hold);
    // A espera da outra (other, confirmada e fora da espera) antes de uma nova virar a ativa, no Make e no Answer. Com
    // a renegociação anterior dela no ar: Blocked e false, ou, com lastTry, nenhuma espera. Sem a espera (essa, ou o
    // re-INVITE dela que não saiu), a nova sai assim mesmo, como no motor do PJSIP, e a outra fica sem áudio daqui por
    // não ser mais a ativa; o log diz. true: o pedido segue.
    bool HoldBeforeNew(Slot& other, bool lastTry);
    // No audioTimer_, depois de o baresip aplicar um SDP (ele abre o áudio depois do evento): o audio_stop das Silent.
    void StopSilentAudio();
    void Negotiated();   // uma negociação acabou: acorda quem espera (WaitNegotiation)
    void Bind(Slot& slot, struct call* call, bool incoming);
    void Free(Slot& slot);
    void Recount();   // o count_, pelas vagas ocupadas
    Slot* Find(int id);
    const Slot* Find(int id) const;
    Slot* Find(const struct call* call);
    Slot* FreeSlot();
    Slot* Other(const Slot& slot);               // a outra vaga, se está ocupada
    const Slot* Other(const Slot& slot) const;
    void PostState(int id, CallState state, int code);
    void Log(int level, const std::string& line) const;

    EventQueue& events_;
    const BaresipLoop::LogSink log_;
    Slot slots_[2];
    int nextId_ = 1;           // os ids começam em 1 e nunca se repetem no mesmo motor
    int activeId_ = 0;         // a ativa (0: nenhuma)
    bool open_ = true;         // false: a conta ou o motor saindo (HangupAll e EndAll), e as que chegam recebem 480
    bool blocked_ = false;     // o Blocked()
    bool failReinvites_ = false;   // o FailReinvites (os testes)
    std::atomic<int> count_{0};   // as vagas ocupadas, para o Count
    std::vector<Waiting> waiting_;
    // Só fica armado com alguma ligação na waiting_: elas saem dela no disparo ou no CLOSED (todas, no mais tardar, com
    // a ua da conta), e o último CLOSED o desarma. Assim nada dele sobra depois do laço.
    struct tmr hangupTimer_;
    // Armado (0 ms) no aviso de um SDP do outro lado (BEVENT_CALL_REMOTE_SDP) ou no ESTABLISHED de uma Silent; a libre
    // o dispara na mesma volta do laço, depois de o baresip aplicar o SDP. O EndAll o desarma.
    struct tmr audioTimer_;
    // As negociações acabadas (Negotiations), para quem espera fora do Run.
    mutable std::mutex negotiationMutex_;
    std::condition_variable negotiated_;
    uint64_t negotiations_ = 0;
};

}  // namespace starsonic
