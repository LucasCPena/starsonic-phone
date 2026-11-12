#pragma once
// O controlador de ligações do app de PC (e, depois, do iPhone): as regras das ligações da 0.2 do
// Android (android/.../call/CallManager.kt), em C++ portátil, entre o motor (CallEngine), a tela, os
// Recentes, o aviso de perdida e o toque (CallControllerListener). Sem o Telecom do Android: o Dial
// chama o MakeCall direto.
//
// Concorrência (o mesmo modelo do CallManager):
// - Os eventos do motor (OnIncomingCall, OnRejectedBusy, OnCallState, OnTransfer, OnCallVideo, OnRoom) chegam na thread
//   de eventos do motor; os comandos (Dial, Answer...), na de quem chama; as tarefas do Scheduler, na dele.
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
//   MakeCall que voltou com o id, o RoomAdd que voltou com o id do convidado, e o Transfer ou o TransferAttended
//   que o motor recusou na hora (o pedido deixa de esperar o resultado).
// - Os eventos do motor também pedem coisas ao motor, na thread de eventos dele (que deixa): o Activate da
//   volta sozinha (o fim da ativa), o Hangup de uma feita desligada antes do id, o mudo que sai.
// - Exceção: o Clock e o Scheduler são chamados com a trava presa (a hora de agora; o Schedule e o Cancel
//   do aviso de fim, como no Kotlin, e os do Atender automático). O Scheduler não pode rodar a tarefa dentro
//   do Schedule nem esperar, no Cancel, uma tarefa que já está rodando (ver o Scheduler, abaixo).
// - Os callbacks do WhenIdle saem como uma publicação (na fila dos avisos, sem a trava, depois dos avisos
//   da decisão em que a última ligação acabou): podem chamar o controlador de volta e outras partes do app
//   (a troca de conta).
// - O dono destrói o controlador só quando nenhum evento do motor, comando ou tarefa do Scheduler pode
//   mais chegar a ele (o destrutor cancela as tarefas agendadas: o aviso de fim e o Atender automático).
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
// held: em espera. video: o vídeo agora (Video.h).
struct CallView {
    int id = 0;
    std::string number;
    std::string name;
    bool incoming = false;
    enum Phase { Ringing, Dialing, Active } phase = Dialing;
    int64_t activeSinceMs = 0;
    bool held = false;
    CallVideo video;   // o vídeo da ligação (o último OnCallVideo dela; o refused não fica aqui)
};

// Um convidado da sala de vídeo em grupo, para a tela: o id da ligação dele no motor, o número e o nome (como nos
// cartões), e o estado, a imagem e o quadro do último OnRoom (RoomMember, Video.h).
struct RoomMemberView {
    int id = 0;                    // o id da ligação do convidado
    std::string number;
    std::string name;              // o do contato, senão o da central; "" sem os dois
    RoomMember::State state = RoomMember::State::Calling;
    bool image = false;
    RoomTile tile;
};

// A sala de vídeo em grupo, para a tela: o id dela (o da linha dela), os convidados na ordem em que entraram, e o out
// (a nossa voz e a nossa câmera fora dela: a ligação de fora) e o full (5 convidados, contando os chamados) do último
// OnRoom.
struct RoomView {
    int id = 0;
    std::vector<RoomMemberView> members;
    bool out = false;
    bool full = false;
};

// O que a tela de chamada mostra: a de cima (top, a ativa) e, com duas, a outra (second: tocando ou em
// espera, em secondKind); nenhuma: top vazio. muted: o mudo do microfone (vale para as duas).
// conference: as duas em conferência (só com as duas de pé): top e second se ouvem e têm o som, nenhuma
// em espera (held false nas duas; secondKind fica Held, e a tela olha o conference); conferenceSinceMs é
// quando o Juntar foi pedido (0 fora dela). consulting: a transferência com consulta, com as duas de pé (o
// cliente e o colega são top e second); colleagueActive: o colega é a de cima (o cliente, então, em espera:
// "Em espera · transferência"). Fora da consulta, os dois false.
// endMessage: o aviso de agora, por 2 s ("" fora disso): o de uma feita que não completou (o
// CallEndMessage do núcleo; o do colega da consulta e o de um convidado da sala que não entrou com o nome ou o
// número dele na frente: "<nome ou número>: <motivo>"), o de discar sem registro, o da em espera que caiu
// ("<nome ou número> desligou") e o da transferência recusada. room: a sala de vídeo em grupo, com a linha dela
// (top ou second) de pé e fora da saída; nenhuma: vazio.
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
    std::optional<RoomView> room;   // com a linha da sala de pé (em cima ou a outra)
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
bool operator==(const RoomMemberView& a, const RoomMemberView& b);
bool operator==(const RoomView& a, const RoomView& b);
bool operator==(const CallSnapshot& a, const CallSnapshot& b);
bool operator==(const Recent& a, const Recent& b);
inline bool operator!=(const CallView& a, const CallView& b) { return !(a == b); }
inline bool operator!=(const RoomMemberView& a, const RoomMemberView& b) { return !(a == b); }
inline bool operator!=(const RoomView& a, const RoomView& b) { return !(a == b); }
inline bool operator!=(const CallSnapshot& a, const CallSnapshot& b) { return !(a == b); }
inline bool operator!=(const Recent& a, const Recent& b) { return !(a == b); }

// O toque: Full é o de uma recebida sem outra ligação; Waiting, o bipe da segunda (a recebida que toca com
// outra em andamento); Stop, nenhum.
enum class RingKind { Full, Waiting, Stop };

// Os avisos da sala de vídeo em grupo (CallControllerListener::OnRoomEvent): Started, a sala nasceu; Entered, um
// convidado atendeu; Left, um saiu (do outro lado, ou tirado daqui); Failed, um não entrou (não atendeu, ou o motor não
// ligou); Out, você saiu da sala (a ligação de fora); Back, você voltou; Ended, a sala acabou.
enum class RoomEvent { Started, Entered, Left, Failed, Out, Back, Ended };

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
    // O vídeo foi recusado: o motor avisou (o refused do OnCallVideo), ou uma ligação discada com vídeo acabou com 488
    // ou 415 e o controlador discou de novo só com a voz. Uma vez por recusa.
    virtual void OnVideoRefused() {}
    // Um aviso da sala, depois do estado que o mostra. value: os convidados que atenderam e seguem na sala (Entered,
    // Left), o código SIP do fim (Failed; 0 sem ligar), 0 nos outros.
    virtual void OnRoomEvent(RoomEvent /*event*/, int /*value*/) {}
};

// Os milissegundos de agora (de qualquer origem fixa: só as diferenças e o activeSinceMs importam).
class Clock {
public:
    virtual ~Clock() {}
    virtual int64_t NowMs() = 0;
};

// Roda uma tarefa daqui a delayMs (0: assim que der, nunca dentro do Schedule), em qualquer thread.
// Schedule devolve um id (> 0) para o Cancel, que tira a tarefa se ela ainda não rodou. Chamado com a trava
// do controlador presa: Schedule nunca roda a tarefa na hora, e Cancel nunca espera uma tarefa que já está
// rodando. A tarefa chama o controlador de volta (e pega a trava dele): um Scheduler de verdade roda as
// tarefas sem nenhuma trava que o Schedule ou o Cancel pegam (senão, a tarefa que espera a trava do
// controlador e o Schedule chamado com ela presa esperam um pelo outro para sempre). Uma tarefa que o
// Cancel não alcançou (já saiu da fila) pode rodar depois dele: o controlador a reconhece e não faz nada.
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

// As ligações do app, até duas, uma delas a ativa.
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
// - Sala de vídeo em grupo (spec do vídeo em grupo; o contrato do motor no SipEngine.h: RoomAdd, OnRoom e o id da
//   sala nos métodos de sempre): a sala é uma linha, que nasce no lugar da ligação de onde ela vem, com o id da sala,
//   em andamento e com o activeSinceMs dela, o número e o nome vazios, a espera (você fora da sala) e o vídeo do
//   OnCallVideo do id da sala. Os convidados ficam dentro dela (room, no CallSnapshot), cada um com a sua ligação, e
//   nenhum é uma linha. As regras de duas linhas dão a ligação de fora, só com a voz: ela toca como a segunda, e
//   atendida ou feita (a Nova ligação) põe a sala em espera; o RoomReturn é o Alternar para a sala, e o fim da de fora
//   traz a sala de volta (a volta sozinha). Uma terceira leva ocupado. Com a sala em cima, nem Hold, nem Transfer, nem
//   Consult, nem Dtmf; com a sala, nem Join nem Split; o Hangup dela em cima é o RoomEnd. Cada convidado entra nos
//   Recentes no fim da ligação dele (a sala não entra), e um que não entra mostra "<nome ou número>: <motivo>" por
//   2 s, como o colega da consulta. Os avisos da sala saem pelo OnRoomEvent.
// - Não perturbe e Atender automático (spec da W1, 7.3): com o Não perturbe, toda recebida leva ocupado
//   (486), não toca e entra nos Recentes como perdida, sem o aviso de perdida; as feitas funcionam. O
//   Atender automático atende, depois do tempo, a recebida que chega sem nenhuma outra ligação; com outra, a
//   segunda toca como sempre. Com os dois ligados, vale o Não perturbe.
// - WhenIdle (a troca de conta): roda o callback já, sem ligação, ou depois que a última acaba.
// - Depois de OnLogout (Sair), os eventos do motor são ignorados até o próximo OnLogin (Entrar).
class CallController {
public:
    // O id de uma feita antes de o motor dar o dela.
    static constexpr int kNoId = 0;

    // dialRule: a regra dos números dos contatos (DialContact, TransferContact e ConsultContact; ex.:
    // ContactDialString com o ddi e o prefixo do perfil). registered: a conta está registrada (o Dial confere
    // antes de discar); vazio vale como sempre registrada. Todos os objetos precisam durar mais que o
    // controlador.
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
    // O vídeo da ligação callId mudou (CallView::video). Com o refused, chama o OnVideoRefused do ouvinte, uma vez.
    // O de um convidado da sala fica com ele (para quando ele volta a ser uma linha), sem o OnVideoRefused; o do id da
    // sala é o da linha dela. Uma ligação que o controlador não conhece (de outra, ou depois do Sair): nada.
    void OnCallVideo(int callId, const CallVideo& video);
    // A sala mudou (o OnRoom do motor: a sala inteira, a cada mudança). O nascimento: a linha cujo id está nos members
    // vira a linha da sala, no mesmo lugar (a ativa, se ela era) e com a espera dela, e a ligação dela vai para dentro,
    // como o primeiro convidado (OnRoomEvent Started). A cada um: o estado, a imagem e o quadro de cada convidado, o
    // convidado que o RoomAdd chama entrando (ver RoomAdd), e o out que muda (Out ou Back). O último (ended): quem
    // ficou volta a ser a linha, no lugar da sala, com a espera dela; sem ninguém, a linha da sala sai, sem Recentes
    // nem aviso, e a outra volta sozinha se a sala era a ativa (Ended). Depois de Sair, nada.
    void OnRoom(const RoomInfo& room);

    // Liga para raw (o número como foi digitado, UTF-8): sem ligação, ou com uma em andamento (a Nova
    // ligação: ela vai para a espera e a feita é a ativa). false se não ligou: número vazio (também depois
    // de tirar os separadores), uma ligação que ainda não está em andamento, duas, depois de Sair, ou sem
    // registro (aí o aviso). O MakeCall roda aqui dentro; se ele não liga, a ligação acaba (nos Recentes
    // como feita) e a outra, se há, volta sozinha. Com video, a ligação oferece vídeo; se ela acaba antes de
    // confirmada com 488 ou 415 (a outra ponta não aceita o vídeo), o controlador disca o mesmo número de novo, uma
    // vez, só com a voz, e chama o OnVideoRefused: o cartão segue "Chamando" (com o id da nova), e o fim da primeira
    // tentativa não leva aviso nem entra nos Recentes. A nova que acaba com 488 ou 415 termina como qualquer outra.
    // Com a sala de pé, a feita é a ligação de fora, só com a voz (o motor recebe o video false).
    bool Dial(const std::string& raw, bool video = false);
    // Liga para number, um número de um contato, como o Dial, depois da regra dos contatos (dialRule).
    // false se a regra não deu número, e nos casos do Dial.
    bool DialContact(const std::string& number, bool video = false);
    // Atende a recebida que toca (com video, aceitando o vídeo dela); a outra ligação, se há, vai para a espera (o
    // motor a põe no Answer). Com a sala de pé, a recebida é a ligação de fora, só com a voz (o video false).
    void Answer(bool video = false);
    // Liga (on) ou desliga a nossa câmera na ligação de cima (a da tela). Sem ela, ou antes de ter o id do motor, nada.
    void Camera(bool on);
    // Recusa a recebida que toca: ocupado (486), e ela entra nos Recentes como perdida.
    void Reject();
    // Desliga a ativa: a feita que chama é cancelada, e a recebida que toca (só ela), recusada. Com a ativa
    // já saindo (um segundo clique antes do fim dela), nada: a outra só sai pelo Hangup com o id dela. Na
    // conferência, desliga as duas (as que ainda não estão saindo), e nenhuma volta sozinha. Com a sala em
    // cima, é o RoomEnd.
    void Hangup();
    // Desliga a ligação callId, a ativa ou a outra (o Desligar do cartão dela); a outra acaba sem mexer na
    // ativa. kNoId é a feita mais nova (o cartão dela antes de o MakeCall dar o id). Já saindo, ou nenhuma
    // com o id, nada. Na conferência, o id de qualquer uma das duas desliga as duas, como o Hangup(). O id da
    // sala é o RoomEnd; o de um convidado não é uma linha: nada (o "Tirar da sala" é o RoomRemove).
    void Hangup(int callId);
    // Alternar: com as duas ligações em andamento, a outra vira a ativa (o motor a retoma: Activate) e a
    // ativa vai para a espera. Sem as duas em andamento (uma só, ou a outra ainda toca), ou na conferência
    // (o Separar é o Split), nada. Na consulta, troca o cliente e o colega (a consulta continua).
    void Swap();
    // Põe em espera (true) ou retoma (false) a ligação ativa em andamento; sem valor, troca. Com as duas em
    // andamento, a espera da ativa é o Swap (a outra volta). Na conferência, e com a sala em cima, nada.
    void Hold(std::optional<bool> on);
    // Liga (true) ou desliga (false) o mudo do microfone; sem valor, troca. Não com a recebida tocando.
    // Ele sai no fim da última ligação.
    void Mute(std::optional<bool> on);
    // Manda os dígitos (DTMF) na ligação ativa em andamento. Com a sala em cima, nada.
    void Dtmf(const std::string& digits);
    // Transfere a ligação ativa em andamento para raw (sem consulta): a ligação acaba quando a central
    // aceita (o motor a desliga); se ela recusa (OnTransfer fora de 2xx), o aviso "O servidor não aceitou a
    // transferência." por 2 s. false se não transferiu: sem a ativa em andamento, número vazio, outro pedido
    // dela esperando o resultado, na consulta (lá, a transferência é o CompleteTransfer), na conferência, com a
    // sala em cima, ou o motor recusou na hora (Transfer devolveu false: o mesmo aviso, e o pedido vale de novo).
    bool Transfer(const std::string& raw);
    // Transfere para number, um número de um contato, como o Transfer, depois da regra dos contatos
    // (dialRule). false se a regra não deu número, e nos casos do Transfer.
    bool TransferContact(const std::string& number);
    // Consultar: liga para o colega raw como a Nova ligação do Dial, com a ligação em andamento (o cliente,
    // que vai para a espera), e as duas ficam marcadas como a consulta (consulting). false se não ligou:
    // sem uma ligação em andamento, com uma transferência dela esperando o resultado (o 2xx da direta
    // desligaria o cliente e deixaria o colega), com a sala em cima, e nos casos do Dial (também o aviso sem
    // registro).
    bool Consult(const std::string& raw);
    // Consulta number, um número de um contato, como o Consult, depois da regra dos contatos (dialRule).
    // false se a regra não deu número, e nos casos do Consult.
    bool ConsultContact(const std::string& number);
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
    // desde agora. Senão (também com a sala), nada.
    void Join();
    // Separar: a última que entrou vai para a espera, e a outra fica a ativa, em cima (o motor desfaz as
    // ligações entre as duas: Split). Fora da conferência, com uma das duas saindo, ou com a sala, nada.
    void Split();
    // Põe raw (o número como foi digitado, UTF-8) na sala: o motor liga para ele (RoomAdd, aqui dentro). Sem sala, ela
    // nasce da ligação de agora, que precisa ser a única, em andamento, fora da espera e da saída, sem consulta,
    // conferência ou transferência esperando o resultado, e com o vídeo ativo; com sala, a linha dela precisa estar em
    // cima, fora da espera e sem o full. O convidado entra na sala com o primeiro OnRoom que traz um id desconhecido,
    // ou que traz o id que o RoomAdd devolveu, o que vier antes (como a feita, cujos eventos podem chegar antes de o
    // MakeCall voltar); o id do RoomAdd vale mais (o de outro, tomado antes, sai). Se o motor não liga (-1), ele entra
    // nos Recentes como feita, com o Failed (0), sem aviso. false se não pediu ao motor: número vazio (também depois de
    // tirar os separadores), os casos acima, outro RoomAdd cujo convidado ainda não entrou, depois de Sair, ou sem
    // registro (aí o aviso, como no Dial).
    bool RoomAdd(const std::string& raw);
    // Põe number, um número de um contato, na sala, como o RoomAdd, depois da regra dos contatos (dialRule). false
    // se a regra não deu número, e nos casos do RoomAdd.
    bool RoomAddContact(const std::string& number);
    // Tirar da sala: o convidado callId sai (o motor o desliga), e o fim dele dá o Left, sem aviso. Sem convidado com
    // o id, ou já saindo, nada.
    void RoomRemove(int callId);
    // Encerrar a sala, em cima ou em espera: o motor desliga todos (o Hangup do id dela), e o fim de cada convidado dá
    // o Left, sem aviso. A tela já não a mostra; a outra linha, se a sala era a ativa, volta sozinha quando o fim dela
    // chega. Se o motor já tinha acabado a sala sozinho e devolve quem ficou como uma linha, ela sai também. Sem sala,
    // ou com ela saindo, nada.
    void RoomEnd();
    // Voltar para a sala: com a sala fora (em espera aqui, ou ainda fora no motor: o out do último OnRoom), é o
    // Alternar da ligação de fora para a sala (a de fora vai para a espera); sem a de fora, só o Activate do id dela.
    // Senão, nada.
    void RoomReturn();
    // Sair: as ligações de agora acabam (o motor as desliga; a sala, pelo Hangup do id dela, com os Recentes de
    // cada convidado, sem avisos), e daqui em diante os eventos do motor são ignorados, até OnLogin.
    void OnLogout();
    // O próximo Entrar depois de OnLogout: os eventos do motor voltam a valer.
    void OnLogin();
    // Liga (true) ou desliga o Não perturbe: as recebidas que chegam daqui em diante levam ocupado (486), não
    // tocam e entram nos Recentes como perdidas, sem o aviso de perdida (também as que o motor recusou
    // sozinho, OnRejectedBusy). As feitas funcionam. A recebida que já toca continua tocando, mas o Atender
    // automático dela é cancelado. Começa desligado.
    void SetDoNotDisturb(bool on);
    // Liga (enabled) ou desliga o Atender automático: a recebida que chega sem nenhuma outra ligação (nem
    // saindo) é atendida delayMs depois de chegar (de 0 a 30 000: fora disso, o mais perto), se ainda toca
    // sozinha. Ele se decide na chegada: a segunda, que chega com outra, toca normalmente (o bipe), também
    // depois que a primeira acaba; e ligá-lo não atende a que já toca. Cancelado quando quem ligou desiste,
    // quando ela é atendida, recusada ou desligada por qualquer caminho, no Sair, ao desligá-lo e ao ligar o
    // Não perturbe (que vale mais). Começa desligado, com 3 000 ms.
    void SetAutoAnswer(bool enabled, int delayMs);
    // Há uma ligação (tocando, chamando, em andamento ou saindo, até o fim dela chegar do motor).
    bool HasCalls() const;
    // Roda callback quando não houver ligação (HasCalls false): já, se não há, ou depois que a última acaba
    // (também a que o Sair encerra). Os pedidos na fila rodam uma vez cada, na ordem em que foram feitos; cada
    // um só roda sem ligação, então um que liga (Dial) faz os seguintes esperarem o fim dessa ligação. Roda
    // como uma publicação (ver acima): sem a trava, depois dos avisos que já estão na fila (o estado sem a
    // ligação e os Recentes dela), uma thread por vez; "já" é antes de o WhenIdle voltar, a menos que outra
    // thread esteja entregando avisos (aí ela o roda, logo depois dos dela) ou que o WhenIdle venha de dentro
    // de um aviso (aí ele roda logo depois desse aviso).
    void WhenIdle(std::function<void()> callback);

private:
    struct Call;
    struct Room;
    // O pedido de transferência esperando o resultado: a direta (Transfer) ou a com consulta (o
    // CompleteTransfer, no cliente).
    enum class TransferKind { None, Direct, Attended };
    using Effects = std::vector<std::function<void()>>;
    using CallPtr = std::shared_ptr<Call>;

    // Decide com a trava (decide(effects)) e depois roda os efeitos e entrega as publicações.
    template <typename Decide>
    void Act(Decide&& decide);
    void Deliver();

    bool Place(const std::string& raw, bool consult, bool video);
    std::string ContactNumber(const std::string& number) const;

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
    void AnswerRinging(const CallPtr& ringing, Effects& effects, bool video = false);
    bool RedialAsVoice(const CallPtr& call, int sipCode, Effects& effects);
    void StartAutoAnswer(const CallPtr& call);
    void CancelAutoAnswer();
    void QueueIdleCallbacks();
    void RunIdleCallbacks();
    CallPtr Shown() const;
    CallPtr Talking() const;
    CallPtr OtherThan(const CallPtr& call) const;
    CallPtr RingingCall() const;
    CallView ViewOf(const Call& call) const;

    // Com a trava: a sala.
    void OnRoomAdded(const CallPtr& guest, int id, Effects& effects);
    bool RoomCanGrow() const;
    CallPtr BearRoom(const RoomInfo& room);
    CallPtr TakePending(Call& line, int id);
    void EndRoom(const CallPtr& line, const RoomInfo& room, Effects& effects);
    void EndRoomLine(const CallPtr& line, Effects& effects);
    void OnGuestState(const CallPtr& guest, CallState state, int sipCode);
    void EndGuest(const CallPtr& guest, int sipCode);
    Recent GuestRecent(const Call& guest);
    int AnsweredGuests() const;
    void PublishRoomEvent(RoomEvent event, int value);
    CallPtr RoomLine() const;
    CallPtr GuestOf(int callId) const;
    RoomView RoomViewOf(const Call& line) const;

    CallEngine& engine_;
    CallControllerListener& listener_;
    Clock& clock_;
    Scheduler& scheduler_;
    ContactNames& contacts_;
    const std::function<std::string(std::string)> dialRule_;
    const std::function<bool()> registered_;

    mutable std::mutex mutex_;
    std::vector<CallPtr> calls_;   // as ligações de agora (até duas; a sala é uma), na ordem em que começaram
    CallPtr active_;               // a ativa, uma de calls_: a do som e a de cima na tela (nullptr: nenhuma)
    CallPtr client_;               // na consulta, o cliente (o que vai ser transferido), uma de calls_
    CallPtr colleague_;            // na consulta, o colega (a feita pelo Consult); os dois nullptr sem consulta
    bool conference_ = false;      // as duas de calls_ em conferência; sai com o Split ou o fim de uma
    int64_t conferenceSince_ = 0;  // quando o Join foi pedido (a tela conta o tempo desde ele)
    bool muted_ = false;           // o mudo do microfone (vale para as duas); sai com a última
    int maxSeenId_ = 0;            // o maior id de ligação do motor já visto (também os da sala e dos convidados)
    CallPtr pendingGuest_;         // o convidado do RoomAdd que nenhum OnRoom trouxe ainda (nullptr: nenhum)
    std::string endMessage_;       // o aviso de agora ("" fora dele)
    int endTimer_ = 0;             // a tarefa do Scheduler que apaga o aviso (0: nenhuma)
    int endToken_ = 0;             // muda a cada aviso: a tarefa de um aviso antigo não apaga o novo
    CallSnapshot published_;       // o último estado posto na fila (OnSnapshot só quando muda)
    RingKind ring_ = RingKind::Stop;   // o último toque posto na fila
    std::deque<std::function<void()>> publications_;   // os avisos ao ouvinte, na ordem
    bool delivering_ = false;      // uma thread está entregando as publicações
    std::atomic<bool> loggedOut_{false};   // lido sem a trava antes de procurar o contato
    bool doNotDisturb_ = false;    // o Não perturbe
    bool autoAnswer_ = false;      // o Atender automático
    int64_t autoAnswerMs_ = 3000;  // o tempo dele (de 0 a 30 000)
    CallPtr autoCall_;             // a recebida que ele vai atender (nullptr: nenhuma)
    int autoTimer_ = 0;            // a tarefa do Scheduler que a atende (0: nenhuma)
    int autoToken_ = 0;            // muda a cada cancelamento: a tarefa antiga não atende
    std::deque<std::function<void()>> idleCallbacks_;   // os do WhenIdle, na ordem
    bool idleQueued_ = false;      // a entrega deles está na fila das publicações (ou rodando)
};

}  // namespace starsonic
