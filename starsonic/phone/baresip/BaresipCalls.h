#pragma once
// As ligações do motor com o baresip (internas): fazer, receber, atender, recusar, desligar, pôr em espera e retomar,
// as teclas, o mudo e as transferências, com os eventos do contrato (SipEngine.h) na ordem e com os códigos do motor do
// PJSIP. Até duas ligações: a que chega com outra ainda não confirmada, ou com duas em andamento, recebe 486. O outro
// lado não troca nem transfere uma ligação daqui: o INVITE com Replaces recebe 603 (o OnInvite), e o REFER numa
// ligação, 501 (a conta não deixa o baresip aceitá-lo: o call_transfer=no do BaresipAccount).
//
// Um microfone só (o iPhone, spec 7.7), como a mesa de áudio do motor do PJSIP: uma das ligações é a ativa (a feita,
// a atendida ou a do Activate, até ela acabar), e só ela, fora da espera, fica com o áudio aberto. A outra, confirmada,
// vai para a espera (re-INVITE sendonly) com o áudio parado; se essa espera não sai (o Make, o Answer e o Activate
// seguem sem ela), ela fica só com o áudio parado. O baresip abre o áudio de uma ligação sozinho a cada SDP que
// aplica, também o de uma só de envio (a em espera): o das outras para de novo logo depois (o audioTimer_).
//
// Tudo aqui roda na thread do laço: dentro do BaresipLoop::Run, no handler dos eventos do baresip (bevent), que repassa
// ao OnEvent, ou nos temporizadores (o das que esperam para mandar o pedido do Hangup e o do áudio). Só o Count é lido
// de qualquer thread, só o WaitNegotiation espera, fora do Run, e o OnBaresipLine é chamado em qualquer thread, mas só
// age na do laço.
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
    // events: por onde saem os avisos das ligações; dura mais que o BaresipCalls. dtmf: o método das teclas do perfil,
    // o mesmo do dtmfmode da ua da conta (o BaresipAccount), que é o que o baresip usa: aqui, só para o log.
    BaresipCalls(EventQueue& events, BaresipLoop::LogSink log, DtmfMethod dtmf);

    BaresipCalls(const BaresipCalls&) = delete;
    BaresipCalls& operator=(const BaresipCalls&) = delete;

    void OnEvent(enum bevent_ev ev, struct bevent* event);   // o handler do bevent repassa aqui

    // Os pedidos que mandam re-INVITE (a espera ou a retomada): Make, Answer, Activate e SetHold. A libre recusa um
    // re-INVITE com outra oferta da mesma ligação no ar (o sipsess_modify dá EPROTO), e o call_hold do baresip, sem a
    // renegociação anterior acabada (call_refresh_allowed), marcaria a ligação sem mandar nada. Por isso, quando uma
    // ligação que o pedido renegociaria ainda espera a resposta de outra oferta, o re-INVITE dela não sai, o pedido
    // devolve false (o Make, -1) e Blocked() fica true: quem chamou espera fora do Run (WaitNegotiation) e pede de
    // novo. O Make, o Answer e o SetHold não mudam nada antes disso; o Activate já fez a escolhida a ativa, com o áudio
    // da outra parado e, se saiu, a espera dela, como o Focus do motor do PJSIP. Uma espera ou uma retomada que não
    // sai (um erro de transporte na hora, por exemplo) deixa a ligação como estava, e o pedido seguinte tenta de novo
    // (ver o Renegotiate).

    // Liga para uri (a URI inteira) pela ua da conta e devolve o id da ligação, a ativa, com o OnCallState(Calling, 0)
    // já na fila. Com uma confirmada fora da espera, ela vai para a espera antes e fica nela mesmo se a nova não sai;
    // como no motor do PJSIP, essa espera é o que se pode (ver o HoldOther): com lastTry (o prazo da espera passou) ou
    // com o re-INVITE dela que não sai, a nova sai assim mesmo. -1 (sem evento): já há duas ligações, a outra ainda
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
    // Só numa confirmada; já ativa, nada muda e nenhum re-INVITE sai. Senão, como o Focus do motor do PJSIP: ela vira a
    // ativa na hora, e a outra fica sem o áudio daqui na hora, também numa tentativa que volta Blocked (enquanto o
    // motor espera, a que o app mostra em espera já não ouve nem é ouvida). A outra, confirmada e fora da espera, vai
    // para a espera como no Make (o HoldOther: com lastTry, ou com o re-INVITE dela que não sai, segue sem ela), e esta
    // é retomada (re-INVITE sendrecv) se estava em espera. O resultado é só o dela: false com id desconhecido,
    // ligação não confirmada, Blocked ou a retomada que não sai (o log diz); então ela segue em espera, sem áudio, e o
    // Activate seguinte tenta de novo.
    bool Activate(int id, bool lastTry);
    // Só numa confirmada: true a põe em espera (re-INVITE sendonly; já em espera, nada muda), e false é o Activate
    // (com o lastTry dele). A espera: false com id desconhecido, ligação não confirmada, Blocked (no prazo, o motor
    // recusa) ou o re-INVITE que não saiu (o log diz; nada muda).
    bool SetHold(int id, bool hold, bool lastTry);
    // O último Make, Answer, Activate ou SetHold parou numa ligação que ele renegociaria e que ainda espera a resposta
    // de outra oferta (só o Activate já mudou algo; ver acima).
    bool Blocked() const;
    // Quantas negociações acabaram até agora: cada resposta a uma oferta (o BEVENT_CALL_REMOTE_SDP com answer) e cada
    // ligação que acaba. O Run do pedido lê, e o WaitNegotiation espera mudar.
    uint64_t Negotiations() const;
    // Fora do Run, de qualquer thread: espera até deadline que Negotiations() deixe de ser seen, mas só por pouco tempo
    // de cada vez (uma recusa do re-INVITE, 4xx a 6xx, acaba a renegociação sem nenhum evento do baresip; quem chamou
    // confere de novo, num Run).
    void WaitNegotiation(uint64_t seen, std::chrono::steady_clock::time_point deadline);

    // As teclas, só numa confirmada e só com 0-9, *, # e A-D (vazio ou outro caractere: false, nada sai): cada uma
    // pelo call_send_digit, seguida da soltura (KEYCODE_REL), no dtmfmode da ua (SIP INFO ou RFC 2833). O log diz
    // quantas e por qual método, sem as teclas. false também se o baresip recusa uma (o log diz; as de antes saíram).
    bool SendDtmf(int id, const std::string& digits);
    // O microfone mudo, ou não, em todas as ligações de agora (audio_mute) e nas próximas (o Bind), até trocar de novo.
    void SetMute(bool muted);
    // O REFER (call_transfer) para uri, só numa confirmada. TransferAttended: o REFER com Replaces
    // (call_replace_transfer) no diálogo de id, com o diálogo de targetId no Refer-To, as duas confirmadas e
    // diferentes. Uma transferência no ar por vez, das duas ligações (ver o OnBaresipLine): com outra esperando o
    // resultado, false. false também quando nada saiu (o baresip recusou: o log diz). Com true, o resultado chega uma
    // vez, por OnTransfer(id, código), antes de qualquer Disconnected dela: a recusa do REFER ou o NOTIFY com a falha
    // (o BEVENT_CALL_TRANSFER_FAILED), ou o fim da assinatura com um erro (o OnBaresipLine: 408 ou 503), e as ligações
    // seguem como estavam; ou o NOTIFY com 2xx, que o baresip avisa encerrando a ligação (OnTransfer(id, 200) e o
    // Disconnected(id, 200)), e na com consulta o motor desliga então o alvo (o BYE). A ligação que acaba antes do
    // resultado não o avisa. Sem nada disso (o 202 sem NOTIFY nenhum), o pedido fica no ar até a ligação acabar.
    bool Transfer(int id, const std::string& uri);
    bool TransferAttended(int id, int targetId);
    // Uma linha de log do baresip (o baresipLines do BaresipLoop), na thread que a escreveu; só age na do laço, onde a
    // libre trata o SIP e chama o handler que a escreve. Só uma importa: "call: subscription closed: <erro>", do
    // sipsub_close_handler do baresip (call.c). É o único sinal de um REFER daqui que fica sem resposta (o tempo
    // esgotado), que dá erro de transporte ou cuja assinatura acaba com um erro: nenhum evento sai. A linha não diz de
    // qual ligação ela é; por isso só uma transferência fica no ar por vez, e ela acaba com OnTransfer(408) no tempo
    // esgotado e OnTransfer(503) nos outros erros, como no motor do PJSIP. O baresip já soltou a assinatura antes da
    // linha: nada mais dela chega. Depende do texto de uma linha de informação do baresip, fixado pelo commit do
    // build/deps.lock e conferido pelo teste "a transfer whose REFER cannot reach the other side reports 503, ..."
    // (test_engine_baresip.cpp), que falha com um baresip que mude a linha.
    void OnBaresipLine(const std::string& line, bool onLoopThread);
    // O código da transferência numa linha dessas: 408 com o texto do ETIMEDOUT (o do BaresipLoop::ErrorText, o mesmo
    // %m da libre), 503 com outro; 0 se a linha é outra.
    static int SubscriptionClosedCode(const std::string& line);

    int Count() const;   // de qualquer thread; cai antes de o Disconnected chegar ao listener
    // {0} (o dispositivo de som) só para a ativa, confirmada e fora da espera; vazio para a outra, para uma que toca ou
    // chama e para um id desconhecido.
    std::vector<int> AudioLinks(int id) const;
    // Os ids das ligações com o áudio aberto (o audio_started do baresip), em ordem crescente: os testes
    // (SipEngineTestAccess).
    std::vector<int> CallsWithAudio() const;
    // Os ids das ligações com o microfone mudo (o audio_ismuted do baresip), em ordem crescente: os testes.
    std::vector<int> MutedCalls() const;
    // Os testes (SipEngineTestAccess): com on, nenhum re-INVITE com oferta sai da ligação id (0: de todas), como num
    // erro de transporte na hora (a rede fora). O aviso do SDP que o baresip monta para ele (o BEVENT_CALL_LOCAL_SDP
    // com offer, numa confirmada) recebe um erro, e o call_modify do baresip volta antes de mandar o re-INVITE e de
    // aplicar a direção nova.
    void FailReinvites(bool on, int id);

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
        bool transferring = false;   // o REFER de um Transfer ou de um TransferAttended dela, ainda sem resultado
        int transferTarget = 0;      // o alvo (o id) do TransferAttended no ar, que sai com o 2xx; 0 sem consulta
    };

    // Uma ligação que já saiu das vagas (o Disconnected já foi) e espera para mandar o pedido do Hangup: a resposta do
    // outro lado (ver o Hangup) ou, no alvo de uma com consulta que deu certo, o fim do cliente (EndTransferTarget).
    struct Waiting {
        struct call* call;
        bool ready;   // o pedido pode sair: sai no hangupTimer_
    };

    void OnInvite(const struct sip_msg* msg);   // o BEVENT_SIPSESS_CONN: toca, ou 603 (o Replaces), 486 ou 480
    // O resultado do REFER daqui, numa ligação transferring: o OnTransfer(code), a linha do log e o fim do pedido.
    // Devolve o alvo da com consulta (o id; 0 sem consulta), que sai depois dela com o 2xx.
    int Transferred(Slot& slot, int code);
    Slot* Transferring();   // a vaga com a transferência no ar (só há uma), ou nullptr
    // A ligação acaba aqui: a vaga se solta, o pedido sai (ua_hangup: o code na recusa da recebida que toca, senão o
    // CANCEL ou o BYE) ou espera na waiting_ e, com report, vem o Disconnected(code).
    void End(Slot& slot, int code, bool report);
    // O alvo de uma com consulta que deu certo, no aviso do fim do cliente: a vaga se solta e o Disconnected vem na
    // hora, como no End, mas o BYE espera na waiting_, já liberado, e sai no hangupTimer_, depois de o baresip soltar o
    // cliente (logo depois do aviso) e mandar o BYE dele, como no motor do PJSIP. Também fica fora do handler do NOTIFY
    // do cliente, que ainda está no meio.
    void EndTransferTarget(Slot& slot);
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
    // A espera da outra (other, confirmada e fora da espera) quando uma ligação vira a ativa (Make, Answer e
    // Activate): o que se pode, como no Focus do motor do PJSIP. Com a renegociação anterior dela no ar: Blocked e
    // false, ou, com lastTry, nenhuma espera. Sem a espera (essa, ou o re-INVITE dela que não saiu), o motivo vai para
    // *skipped, e o pedido segue: a outra fica fora da espera e sem áudio daqui por não ser mais a ativa. true: segue.
    bool HoldOther(Slot& other, bool lastTry, std::string* skipped);
    // A linha do log da outra que ficou fora da espera (o *skipped do HoldOther; vazio, nada), depois que a nova virou
    // a ativa: só então ela é verdade.
    void LogSkippedHold(const std::string& reason) const;
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
    const DtmfMethod dtmf_;
    Slot slots_[2];
    int nextId_ = 1;           // os ids começam em 1 e nunca se repetem no mesmo motor
    int activeId_ = 0;         // a ativa (0: nenhuma)
    bool open_ = true;         // false: a conta ou o motor saindo (HangupAll e EndAll), e as que chegam recebem 480
    bool blocked_ = false;     // o Blocked()
    bool muted_ = false;       // o SetMute: vale também para as ligações que nascerem (o Bind)
    bool failReinvites_ = false;   // o FailReinvites (os testes)
    int failReinvitesId_ = 0;      // a ligação dele, ou 0 (todas)
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
