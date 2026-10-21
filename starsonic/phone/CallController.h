#pragma once
// O controlador de ligações do app de PC (e, depois, do iPhone): as regras das ligações da 0.2 do
// Android (android/.../call/CallManager.kt), em C++ portátil, entre o motor (CallEngine), a tela, os
// Recentes, o aviso de perdida e o toque (CallControllerListener). Sem o Telecom do Android: o Dial
// chama o MakeCall direto.
//
// Concorrência (o mesmo modelo do CallManager):
// - Os eventos do motor (OnIncomingCall, OnRejectedBusy, OnCallState, OnTransfer) chegam na thread de
//   eventos do motor; os comandos (Dial, Answer...), na de quem chama; as tarefas do Scheduler, na dele.
//   Tudo pode chegar ao mesmo tempo: uma trava (um std::mutex) guarda o estado.
// - Cada chamada decide com a trava presa e anota o que fazer depois: os pedidos ao motor (os efeitos)
//   e os avisos ao ouvinte (as publicações). A trava nunca fica presa numa chamada ao motor, ao ouvinte
//   ou aos contatos (ContactNames, procurados antes de pegar a trava).
// - Depois de soltar a trava, os efeitos rodam na thread de quem chamou, na ordem em que foram decididos
//   (o MakeCall roda dentro do Dial e pode demorar: os eventos dessa ligação podem chegar antes de ele
//   voltar, e o controlador os reconhece). Por último, as publicações saem, na ordem em que foram
//   decididas, uma thread por vez e sem a trava: quem chega com outra thread entregando deixa as suas
//   na fila, e ela as entrega também. O ouvinte pode chamar o controlador de volta (na mesma thread ou
//   em outra); o que essa chamada publica sai depois do aviso que está saindo. Só no Dial as publicações
//   saem antes do efeito, logo antes do MakeCall (também no Consult): a tela mostra a feita (e o Desligar
//   dela) enquanto ele demora. Nos outros (o Answer, o Hold, o Swap, o Join, o Split, a volta sozinha)
//   elas saem depois dos pedidos ao motor: um pedido que o ouvinte faz de volta nunca chega ao motor antes
//   do pedido que o provocou.
// - Um efeito pode voltar à trava depois do motor (outra decisão, com os efeitos e as publicações dela): o
//   MakeCall que voltou com o id, e o Transfer ou o TransferAttended que o motor recusou na hora (o pedido
//   deixa de esperar o resultado).
// - Os eventos do motor também pedem coisas ao motor, na thread de eventos dele (que deixa): o Activate da
//   volta sozinha (o fim da ativa), o Hangup de uma feita desligada antes do id, o mudo que sai.
// - Exceção: o Clock e o Scheduler são chamados com a trava presa (a hora de agora; o Schedule e o Cancel
//   do aviso de fim, como no Kotlin). O Scheduler não pode rodar a tarefa dentro do Schedule nem esperar,
//   no Cancel, uma tarefa que já está rodando.
// - O dono destrói o controlador só quando nenhum evento do motor, comando ou tarefa do Scheduler pode
//   mais chegar a ele (o destrutor cancela o aviso de fim agendado).
#include <atomic>
#include <cstdint>
#include <deque>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

#include "CallEngine.h"
#include "SipEngine.h"

namespace starsonic {

// Uma ligação, para a tela. id: o do motor (CallController::kNoId: a feita antes de o MakeCall dar o
// dela). name: o do contato com o número, se há (procurado uma vez, quando ela começa), senão o nome de
// exibição que a central mandou (pode ser vazio). phase: Ringing é a recebida tocando; Dialing, a feita
// chamando; Active, em andamento, também a recebida já atendida aqui que o motor ainda não confirmou
// (com activeSinceMs 0 até a confirmação). activeSinceMs: quando os dois lados atenderam (0: ainda não).
// held: em espera.
struct CallView {
    int id = 0;
    std::string number;
    std::string name;
    bool incoming = false;
    enum Phase { Ringing, Dialing, Active } phase = Dialing;
    int64_t activeSinceMs = 0;
    bool held = false;
};

// O que a tela de chamada mostra: a de cima (top, a ativa) e, com duas, a outra (second: tocando ou em
// espera, em secondKind); nenhuma: top vazio. muted: o mudo do microfone (vale para as duas).
// conference: as duas em conferência (só com as duas de pé): top e second se ouvem e têm o som, nenhuma
// em espera (held false nas duas; secondKind fica Held, e a tela olha o conference); conferenceSinceMs é
// quando o Juntar foi pedido (0 fora dela). consulting: a transferência com consulta, com as duas de pé (o
// cliente e o colega são top e second); colleagueActive: o colega é a de cima (o cliente, então, em espera:
// "Em espera · transferência"). Fora da consulta, os dois false.
// endMessage: o aviso de agora, por 2 s ("" fora disso): o de uma feita que não completou (o
// CallEndMessage do núcleo; o do colega da consulta com o nome ou o número dele na frente: "<nome ou
// número>: <motivo>"), o de discar sem registro, o da em espera que caiu ("<nome ou número> desligou") e o
// da transferência recusada.
struct CallSnapshot {
    std::optional<CallView> top;
    std::optional<CallView> second;
    enum SecondKind { None, Ringing, Held } secondKind = None;
    bool muted = false;
    bool conference = false;
    int64_t conferenceSinceMs = 0;
    bool consulting = false;
    bool colleagueActive = false;
    std::string endMessage;
};

// Uma ligação para os Recentes: o número, o nome que a central mandou (os Recentes procuram o contato na
// hora de mostrar), o tipo, quando ela começou e quanto durou (desde que os dois lados atenderam; 0 na
// perdida e na feita que não completou).
struct Recent {
    std::string number;
    std::string name;
    enum Kind { Outgoing, Incoming, Missed } kind = Outgoing;
    int64_t startMs = 0;
    int64_t durationMs = 0;
};

bool operator==(const CallView& a, const CallView& b);
bool operator==(const CallSnapshot& a, const CallSnapshot& b);
bool operator==(const Recent& a, const Recent& b);
inline bool operator!=(const CallView& a, const CallView& b) { return !(a == b); }
inline bool operator!=(const CallSnapshot& a, const CallSnapshot& b) { return !(a == b); }
inline bool operator!=(const Recent& a, const Recent& b) { return !(a == b); }

// O toque: Full é o de uma recebida sem outra ligação; Waiting, o bipe da segunda (a recebida que toca com
// outra em andamento); Stop, nenhum.
enum class RingKind { Full, Waiting, Stop };

// O que o controlador avisa, sempre sem a trava, na ordem, uma thread por vez (ver acima). Os textos
// em UTF-8.
class CallControllerListener {
public:
    virtual ~CallControllerListener() {}
    // O estado mudou (só quando muda).
    virtual void OnSnapshot(const CallSnapshot& snapshot) = 0;
    // Uma ligação para os Recentes (no fim dela; a perdida que recebeu ocupado, na hora).
    virtual void OnRecent(const Recent& recent) = 0;
    // "Ligação perdida de <nome do contato, ou o número (sem número, o nome da central)>": a perdida que a
    // pessoa não viu (quem ligou desistiu, ou ocupado com outra ligação).
    virtual void OnMissed(const std::string& text) = 0;
    // O toque mudou (só quando muda).
    virtual void OnRing(RingKind kind) = 0;
};

// Os milissegundos de agora (de qualquer origem fixa: só as diferenças e o activeSinceMs importam).
class Clock {
public:
    virtual ~Clock() {}
    virtual int64_t NowMs() = 0;
};

// Roda uma tarefa daqui a delayMs, em qualquer thread. Schedule devolve um id (> 0) para o Cancel, que
// tira a tarefa se ela ainda não rodou. Chamado com a trava do controlador presa: Schedule nunca roda a
// tarefa na hora, e Cancel nunca espera uma tarefa que já está rodando.
class Scheduler {
public:
    virtual ~Scheduler() {}
    virtual int Schedule(int64_t delayMs, std::function<void()> task) = 0;
    virtual void Cancel(int id) = 0;
};

// O nome do contato com o número (vazio: nenhum). Pode ler o disco; nunca é chamado com a trava.
class ContactNames {
public:
    virtual ~ContactNames() {}
    virtual std::optional<std::string> NameFor(const std::string& number) = 0;
};

// As ligações do app, até duas, uma delas a ativa (o Não perturbe na Task 5).
// - Recebida (OnIncomingCall): sem ligação, toca (OnRing(Full)); com uma só e já em andamento (em espera
//   ou não), toca como a segunda (second com secondKind Ringing, OnRing(Waiting)), e a outra fica com o
//   som até a pessoa atender. Com uma que ainda não está em andamento (tocando, atendendo, chamando) ou
//   com duas, ocupado (486) e perdida nos Recentes, com o aviso de perdida. Atender (a outra vai para a
//   espera, que o motor põe no Answer), Recusar (486, perdida sem o aviso) e a desistência de quem ligou
//   (perdida, com o aviso).
// - Feita (Dial): o número sem separadores (núcleo, NormalizeDialString); sem registro (o predicado
//   registered), o aviso "Sem conexão com o servidor. Tente de novo em instantes." e nada é discado. Com
//   uma ligação em andamento, a feita é a Nova ligação: a outra vai para a espera (o motor a põe no
//   MakeCall) e a feita é a ativa, em cima. O id da ligação vem do MakeCall, mas os eventos dela podem
//   chegar antes: o primeiro evento de uma ligação nova (id maior que todos os já vistos) é da feita. Se
//   ela não completa, o aviso do núcleo (CallEndMessage) fica em endMessage por 2 s.
// - Duas ligações: a ativa é a do som (no motor) e a de cima na tela (top); a outra (second) toca ou está
//   em espera. Swap (Alternar) troca as duas. Quando a ativa acaba (desligada aqui ou do outro lado), a em
//   espera volta sozinha (o motor a retoma: Activate). A em espera que cai do outro lado sai com o aviso
//   "<nome ou número> desligou" por 2 s, e a ativa continua.
// - Transferência com consulta (spec da 0.2, 7.3): o Consult é a Nova ligação marcada: a que estava em
//   andamento é o cliente, e a feita, o colega. CompleteTransfer (só com o colega atendido, com qualquer
//   dos dois ativo) pede ao motor o REFER com Replaces do cliente para o colega, uma vez até o resultado
//   (OnTransfer): com 2xx o motor desliga as duas, que saem como desligadas aqui (sem aviso, nem a volta
//   sozinha do cliente); com outro código, ou se o motor recusa na hora, o aviso "O servidor não aceitou a
//   transferência." por 2 s, e as duas continuam. CancelConsult desliga o colega, e o cliente volta
//   sozinho. O colega que não atende traz o cliente de volta, com o aviso "<nome ou número do colega>:
//   <CallEndMessage>"; o cliente que desliga deixa o colega como uma ligação normal ("<nome ou número>
//   desligou"); o colega que acaba com o Concluir esperando leva o pedido junto (o cliente pode ser
//   transferido de novo). Uma ligação tem no máximo um pedido de transferência esperando o resultado: com
//   ele, nem Consult nem outro Transfer nela; na consulta, o Transfer não vale (a transferência é o
//   CompleteTransfer).
// - Conferência (spec da 0.2, 7.4): Join, com as duas em andamento, sem consulta e sem transferência
//   esperando o resultado, liga as duas entre si no motor (que retoma a em espera). Split põe em espera a
//   última que entrou, e a outra fica a ativa. Hangup, com ou sem o id de qualquer uma, desliga as duas
//   (o Desligar para todos), e o Sair também; nenhuma volta sozinha. A que acaba do outro lado deixa a
//   outra como uma ligação normal, com o aviso "<nome ou número> desligou" (o motor já a deixa com o som).
//   Na conferência não há Hold, Swap, Transfer, Consult nem Nova ligação; o mudo vale para as duas, e o
//   Dtmf vai na de cima.
// - Depois de OnLogout (Sair), os eventos do motor são ignorados até o próximo OnLogin (Entrar).
class CallController {
public:
    // O id de uma feita antes de o motor dar o dela.
    static constexpr int kNoId = 0;

    // dialRule: a regra dos números dos contatos (DialContact; ex.: ContactDialString com o ddi e o
    // prefixo do perfil). registered: a conta está registrada (o Dial confere antes de discar); vazio
    // vale como sempre registrada. Todos os objetos precisam durar mais que o controlador.
    CallController(CallEngine& engine, CallControllerListener& listener, Clock& clock, Scheduler& scheduler,
                   ContactNames& contacts, std::function<std::string(std::string)> dialRule,
                   std::function<bool()> registered = nullptr);
    ~CallController();

    CallController(const CallController&) = delete;
    CallController& operator=(const CallController&) = delete;

    // Os eventos do motor (os do EngineListener, que o dono repassa). Os textos em UTF-8.
    void OnIncomingCall(int callId, const std::string& remoteUser, const std::string& remoteName);
    void OnRejectedBusy(const std::string& remoteUser, const std::string& remoteName);
    void OnCallState(int callId, CallState state, int sipCode);
    void OnTransfer(int callId, int sipCode);

    // Liga para raw (o número como foi digitado, UTF-8): sem ligação, ou com uma em andamento (a Nova
    // ligação: ela vai para a espera e a feita é a ativa). false se não ligou: número vazio (também depois
    // de tirar os separadores), uma ligação que ainda não está em andamento, duas, depois de Sair, ou sem
    // registro (aí o aviso). O MakeCall roda aqui dentro; se ele não liga, a ligação acaba (nos Recentes
    // como feita) e a outra, se há, volta sozinha.
    bool Dial(const std::string& raw);
    // Liga para number, um número de um contato, como o Dial, depois da regra dos contatos (dialRule).
    // false se a regra não deu número, e nos casos do Dial.
    bool DialContact(const std::string& number);
    // Atende a recebida que toca; a outra ligação, se há, vai para a espera (o motor a põe no Answer).
    void Answer();
    // Recusa a recebida que toca: ocupado (486), e ela entra nos Recentes como perdida.
    void Reject();
    // Desliga a ativa: a feita que chama é cancelada, e a recebida que toca (só ela), recusada. Com a ativa
    // já saindo (um segundo clique antes do fim dela), nada: a outra só sai pelo Hangup com o id dela. Na
    // conferência, desliga as duas (as que ainda não estão saindo), e nenhuma volta sozinha.
    void Hangup();
    // Desliga a ligação callId, a ativa ou a outra (o Desligar do cartão dela); a outra acaba sem mexer na
    // ativa. kNoId é a feita mais nova (o cartão dela antes de o MakeCall dar o id). Já saindo, ou nenhuma
    // com o id, nada. Na conferência, o id de qualquer uma das duas desliga as duas, como o Hangup().
    void Hangup(int callId);
    // Alternar: com as duas ligações em andamento, a outra vira a ativa (o motor a retoma: Activate) e a
    // ativa vai para a espera. Sem as duas em andamento (uma só, ou a outra ainda toca), ou na conferência
    // (o Separar é o Split), nada. Na consulta, troca o cliente e o colega (a consulta continua).
    void Swap();
    // Põe em espera (true) ou retoma (false) a ligação ativa em andamento; sem valor, troca. Com as duas em
    // andamento, a espera da ativa é o Swap (a outra volta). Na conferência, nada.
    void Hold(std::optional<bool> on);
    // Liga (true) ou desliga (false) o mudo do microfone; sem valor, troca. Não com a recebida tocando.
    // Ele sai no fim da última ligação.
    void Mute(std::optional<bool> on);
    // Manda os dígitos (DTMF) na ligação ativa em andamento.
    void Dtmf(const std::string& digits);
    // Transfere a ligação ativa em andamento para raw (sem consulta): a ligação acaba quando a central
    // aceita (o motor a desliga); se ela recusa (OnTransfer fora de 2xx), o aviso "O servidor não aceitou a
    // transferência." por 2 s. false se não transferiu: sem a ativa em andamento, número vazio, outro pedido
    // dela esperando o resultado, na consulta (lá, a transferência é o CompleteTransfer), na conferência, ou
    // o motor recusou na hora (Transfer devolveu false: o mesmo aviso, e o pedido vale de novo).
    bool Transfer(const std::string& raw);
    // Consultar: liga para o colega raw como a Nova ligação do Dial, com a ligação em andamento (o cliente,
    // que vai para a espera), e as duas ficam marcadas como a consulta (consulting). false se não ligou:
    // sem uma ligação em andamento, com uma transferência dela esperando o resultado (o 2xx da direta
    // desligaria o cliente e deixaria o colega), e nos casos do Dial (também o aviso sem registro).
    bool Consult(const std::string& raw);
    // Concluir transferência: com o colega atendido (as duas em andamento, com qualquer uma ativa), o motor
    // manda o REFER com Replaces do cliente para o colega (TransferAttended). Um pedido por vez: outro
    // clique antes do resultado (OnTransfer) não faz nada. Se o colega acaba antes do resultado, ou se o
    // motor recusa na hora (TransferAttended devolveu false; aí com o aviso), o pedido sai, e o Concluir
    // vale de novo. Fora da consulta, nada.
    void CompleteTransfer();
    // Cancelar a consulta: o colega sai (como no Hangup), e o cliente volta sozinho quando o fim dele chega
    // (se o colega era a ativa). Fora da consulta, ou com o colega já saindo, nada.
    void CancelConsult();
    // Juntar: com as duas ligações em andamento (a ativa e a outra, em espera), sem consulta, sem uma
    // transferência de uma delas esperando o resultado e fora de uma conferência, o motor retoma a em espera
    // e liga as duas entre si e ao som (Join). As duas ficam fora da espera, e a tela mostra a conferência
    // desde agora. Senão, nada.
    void Join();
    // Separar: a última que entrou vai para a espera, e a outra fica a ativa, em cima (o motor desfaz as
    // ligações entre as duas: Split). Fora da conferência, ou com uma das duas saindo, nada.
    void Split();
    // Sair: as ligações de agora acabam (o motor as desliga), e daqui em diante os eventos do motor são
    // ignorados, até OnLogin.
    void OnLogout();
    // O próximo Entrar depois de OnLogout: os eventos do motor voltam a valer.
    void OnLogin();

private:
    struct Call;
    // O pedido de transferência esperando o resultado: a direta (Transfer) ou a com consulta (o
    // CompleteTransfer, no cliente).
    enum class TransferKind { None, Direct, Attended };
    using Effects = std::vector<std::function<void()>>;
    using CallPtr = std::shared_ptr<Call>;

    // Decide com a trava (decide(effects)) e depois roda os efeitos e entrega as publicações.
    template <typename Decide>
    void Act(Decide&& decide);
    void Deliver();

    bool Place(const std::string& raw, bool consult);

    // Com a trava.
    void OnDialed(const CallPtr& dialed, int id, Effects& effects);
    void OnTransferRefusedAtOnce(const CallPtr& call, int request);
    CallPtr OwnerOf(int callId) const;
    void Adopt(const CallPtr& call, int id, Effects& effects);
    void RejectCall(const CallPtr& call, Effects& effects);
    void HangupCall(const CallPtr& call, Effects& effects);
    void HangupConference(Effects& effects);
    void SwapCalls(const CallPtr& from, const CallPtr& to, Effects& effects);
    void ResumeNext(Effects& effects);
    void StayAfterConference();
    void Separate(const CallPtr& first, const CallPtr& last, Effects& effects);
    bool Members(CallPtr& first, CallPtr& last) const;
    bool LeaveConsult(const CallPtr& call);
    bool LeaveConference();
    void End(const CallPtr& call, int sipCode, Effects& effects, bool quiet = false);
    void RecordMissed(const Recent& recent, const std::optional<std::string>& contact);
    void Record(const Recent& recent);
    void ShowEndMessage(const std::string& text);
    void ClearEndMessage();
    void Publish();
    CallPtr Shown() const;
    CallPtr Talking() const;
    CallPtr OtherThan(const CallPtr& call) const;
    CallPtr RingingCall() const;
    CallView ViewOf(const Call& call) const;

    CallEngine& engine_;
    CallControllerListener& listener_;
    Clock& clock_;
    Scheduler& scheduler_;
    ContactNames& contacts_;
    const std::function<std::string(std::string)> dialRule_;
    const std::function<bool()> registered_;

    std::mutex mutex_;
    std::vector<CallPtr> calls_;   // as ligações de agora (até duas), na ordem em que começaram
    CallPtr active_;               // a ativa, uma de calls_: a do som e a de cima na tela (nullptr: nenhuma)
    CallPtr client_;               // na consulta, o cliente (o que vai ser transferido), uma de calls_
    CallPtr colleague_;            // na consulta, o colega (a feita pelo Consult); os dois nullptr sem consulta
    bool conference_ = false;      // as duas de calls_ em conferência; sai com o Split ou o fim de uma
    int64_t conferenceSince_ = 0;  // quando o Join foi pedido (a tela conta o tempo desde ele)
    bool muted_ = false;           // o mudo do microfone (vale para as duas); sai com a última
    int maxSeenId_ = 0;            // o maior id de ligação do motor já visto
    std::string endMessage_;       // o aviso de agora ("" fora dele)
    int endTimer_ = 0;             // a tarefa do Scheduler que apaga o aviso (0: nenhuma)
    int endToken_ = 0;             // muda a cada aviso: a tarefa de um aviso antigo não apaga o novo
    CallSnapshot published_;       // o último estado posto na fila (OnSnapshot só quando muda)
    RingKind ring_ = RingKind::Stop;   // o último toque posto na fila
    std::deque<std::function<void()>> publications_;   // os avisos ao ouvinte, na ordem
    bool delivering_ = false;      // uma thread está entregando as publicações
    std::atomic<bool> loggedOut_{false};   // lido sem a trava antes de procurar o contato
};

}  // namespace starsonic
