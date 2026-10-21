#include "CallController.h"

#include <algorithm>
#include <utility>

#include "CallMessages.h"
#include "Text.h"

namespace starsonic {

namespace {

// Quanto tempo o aviso de fim fica na tela.
constexpr int64_t kEndMessageMs = 2000;

// O aviso de discar sem registro.
std::string NoConnectionText() {
    return WideToUtf8(L"Sem conex\u00e3o com o servidor. Tente de novo em instantes.");
}

// O aviso da transferência que o servidor recusou.
std::string TransferRefusedText() { return WideToUtf8(L"O servidor n\u00e3o aceitou a transfer\u00eancia."); }

// "Ligação perdida de <nome do contato, ou o número (ou, sem número, o nome da central)>".
std::string MissedText(const std::string& number, const std::string& name, const std::optional<std::string>& contact) {
    return WideToUtf8(L"Liga\u00e7\u00e3o perdida de ") + (contact ? *contact : (number.empty() ? name : number));
}

// O número a discar, sem os separadores (núcleo).
std::string Normalize(const std::string& raw) { return WideToUtf8(NormalizeDialString(Utf8ToWide(raw))); }

bool IsBlank(const std::string& text) {
    return std::all_of(text.begin(), text.end(), [](char ch) {
        return ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' || ch == '\v' || ch == '\f';
    });
}

Recent MakeRecent(const std::string& number, const std::string& name, Recent::Kind kind, int64_t startMs,
                  int64_t durationMs) {
    Recent recent;
    recent.number = number;
    recent.name = name;
    recent.kind = kind;
    recent.startMs = startMs;
    recent.durationMs = durationMs;
    return recent;
}

}  // namespace

bool operator==(const CallView& a, const CallView& b) {
    return a.id == b.id && a.number == b.number && a.name == b.name && a.incoming == b.incoming &&
           a.phase == b.phase && a.activeSinceMs == b.activeSinceMs && a.held == b.held;
}

bool operator==(const CallSnapshot& a, const CallSnapshot& b) {
    return a.top == b.top && a.second == b.second && a.secondKind == b.secondKind && a.muted == b.muted &&
           a.conference == b.conference && a.conferenceSinceMs == b.conferenceSinceMs &&
           a.consulting == b.consulting && a.colleagueActive == b.colleagueActive && a.endMessage == b.endMessage;
}

bool operator==(const Recent& a, const Recent& b) {
    return a.number == b.number && a.name == b.name && a.kind == b.kind && a.startMs == b.startMs &&
           a.durationMs == b.durationMs;
}

// Uma das ligações de agora: name é o nome que a central mandou (o dos Recentes), e contact, o do contato
// com o número dela (procurado uma vez, quando ela começou). Só com a trava.
struct CallController::Call {
    enum class Phase {
        Dialing,      // feita, chamando (até o outro lado atender)
        Ringing,      // recebida, tocando
        Connecting,   // recebida, atendida aqui, esperando o motor confirmar
        Active,       // em andamento (os dois lados atenderam)
    };

    Call(bool incoming, std::string number, std::string name, int64_t startMs, std::optional<std::string> contact)
        : incoming(incoming),
          number(std::move(number)),
          name(std::move(name)),
          startMs(startMs),
          contact(std::move(contact)),
          phase(incoming ? Phase::Ringing : Phase::Dialing) {}

    // O nome mostrado (tela e avisos): o do contato, se há; senão, o da central.
    const std::string& DisplayName() const { return contact ? *contact : name; }
    // O "<nome ou número>" dos avisos: o nome mostrado, ou o número sem ele.
    const std::string& Label() const { return DisplayName().empty() ? number : DisplayName(); }

    const bool incoming;
    const std::string number;
    const std::string name;
    const int64_t startMs;
    const std::optional<std::string> contact;

    int id = kNoId;                 // o id no motor (a feita só o ganha com o MakeCall ou o primeiro evento)
    Phase phase;
    bool hangupWhenDialed = false;   // feita desligada antes de ter o id: desliga quando ele chegar
    bool answered = false;           // recebida: atendida aqui
    bool rejected = false;           // recebida: recusada aqui
    bool localHangup = false;        // desligada aqui
    bool ending = false;             // pedida a saída: a tela já não a mostra
    bool abandoned = false;          // a conta saiu (Sair) com ela de pé
    int64_t activeSince = 0;         // quando os dois lados atenderam (0: ainda não)
    bool held = false;               // em espera: pela pessoa, ou a outra de duas
    TransferKind transferPending = TransferKind::None;   // a transferência pedida nela, até o resultado
    int transferRequest = 0;         // conta os pedidos de transferência (a recusa na hora desfaz só o dela)
};

CallController::CallController(CallEngine& engine, CallControllerListener& listener, Clock& clock,
                               Scheduler& scheduler, ContactNames& contacts,
                               std::function<std::string(std::string)> dialRule, std::function<bool()> registered)
    : engine_(engine),
      listener_(listener),
      clock_(clock),
      scheduler_(scheduler),
      contacts_(contacts),
      dialRule_(std::move(dialRule)),
      registered_(std::move(registered)) {}

CallController::~CallController() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (endTimer_ != 0) scheduler_.Cancel(endTimer_);
}

// Decide com a trava e faz o resto (o motor) depois de soltá-la, na ordem; por último, entrega as
// publicações.
template <typename Decide>
void CallController::Act(Decide&& decide) {
    Effects effects;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        decide(effects);
    }
    try {
        for (const auto& effect : effects) effect();
    } catch (...) {
        Deliver();
        throw;
    }
    Deliver();
}

void CallController::OnIncomingCall(int callId, const std::string& remoteUser, const std::string& remoteName) {
    std::optional<std::string> contact;
    if (!loggedOut_) contact = contacts_.NameFor(remoteUser);   // sem a trava: pode ler o disco
    Act([&](Effects& effects) {
        // Antes de olhar o loggedOut_: o fim de uma ligação ignorada depois de Sair nunca é tomado por uma feita.
        maxSeenId_ = std::max(maxSeenId_, callId);
        if (loggedOut_) return;
        // Até duas, e a segunda só com a outra em andamento (como no motor).
        const CallPtr other = calls_.size() == 1 ? calls_.front() : nullptr;
        const bool fits = calls_.empty() || (other && other->phase == Call::Phase::Active && !other->ending);
        if (!fits) {
            // Ocupado, e a ligação entra como perdida.
            effects.push_back([this, callId] { engine_.Reject(callId); });
            RecordMissed(MakeRecent(remoteUser, remoteName, Recent::Missed, clock_.NowMs(), 0), contact);
            return;
        }
        auto incoming = std::make_shared<Call>(true, remoteUser, remoteName, clock_.NowMs(), contact);
        incoming->id = callId;
        calls_.push_back(incoming);
        if (!active_) active_ = incoming;
        Publish();
    });
}

void CallController::OnRejectedBusy(const std::string& remoteUser, const std::string& remoteName) {
    std::optional<std::string> contact;
    if (!loggedOut_) contact = contacts_.NameFor(remoteUser);
    Act([&](Effects&) {
        if (!loggedOut_) RecordMissed(MakeRecent(remoteUser, remoteName, Recent::Missed, clock_.NowMs(), 0), contact);
    });
}

void CallController::OnCallState(int callId, CallState state, int sipCode) {
    Act([&](Effects& effects) {
        const CallPtr current = loggedOut_ ? nullptr : OwnerOf(callId);
        if (!current) {
            maxSeenId_ = std::max(maxSeenId_, callId);   // de outra ligação (ou depois de Sair): fica lembrado
            return;
        }
        if (current->id != callId) Adopt(current, callId, effects);
        if (state == CallState::Confirmed) {
            if (current->activeSince == 0) {
                current->activeSince = clock_.NowMs();
                current->phase = Call::Phase::Active;
            }
        } else if (state == CallState::Disconnected) {
            End(current, sipCode, effects);
        }
        Publish();
    });
}

void CallController::OnTransfer(int callId, int sipCode) {
    Act([&](Effects&) {
        if (loggedOut_) return;
        const auto it = std::find_if(calls_.begin(), calls_.end(),
                                     [callId](const CallPtr& c) { return c->id == callId && !c->ending; });
        if (it == calls_.end() || (*it)->transferPending == TransferKind::None) return;
        const CallPtr current = *it;
        const TransferKind pending = current->transferPending;
        current->transferPending = TransferKind::None;
        // Só o resultado do Concluir é da consulta (um 2xx da direta pedida antes não é).
        const bool ofConsult = pending == TransferKind::Attended && current == client_;
        if (sipCode < 200 || sipCode > 299) {
            ShowEndMessage(TransferRefusedText());
        } else if (ofConsult) {
            // O motor desliga as duas logo depois (os fins chegam por ele): elas saem já, como desligadas
            // aqui (a tela fecha), sem o aviso "desligou" e sem a volta sozinha do cliente.
            for (const CallPtr& call : {client_, colleague_}) {
                call->localHangup = true;
                call->ending = true;
            }
            Publish();
        }
        // 2xx da direta: o motor desliga a ligação logo depois, e o fim chega por ele.
    });
}

bool CallController::Dial(const std::string& raw) { return Place(raw, /*consult=*/false); }

bool CallController::Consult(const std::string& raw) { return Place(raw, /*consult=*/true); }

// A feita do Dial e do Consult (com consult, só com uma ligação em andamento, que vira o cliente).
bool CallController::Place(const std::string& raw, bool consult) {
    if (IsBlank(raw)) return false;
    if (registered_ && !registered_()) {
        Act([this](Effects&) { ShowEndMessage(NoConnectionText()); });
        return false;
    }
    const std::string number = Normalize(raw);
    if (number.empty()) return false;
    std::optional<std::string> contact;
    if (!loggedOut_) contact = contacts_.NameFor(number);   // sem a trava: pode ler o disco
    bool placed = false;
    Act([&](Effects& effects) {
        if (loggedOut_) return;
        // Sem ligação, ou com uma só em andamento (a Nova ligação).
        const CallPtr other = calls_.size() == 1 ? calls_.front() : nullptr;
        if (!calls_.empty() && (!other || other->phase != Call::Phase::Active || other->ending)) return;
        // O Consultar: só com o cliente em andamento e sem uma transferência dele esperando o resultado.
        if (consult && (!other || other->transferPending != TransferKind::None)) return;
        ClearEndMessage();
        auto dialed = std::make_shared<Call>(false, number, std::string(), clock_.NowMs(), contact);
        calls_.push_back(dialed);
        active_ = dialed;
        if (other) other->held = true;   // o motor a põe em espera no MakeCall
        if (consult) {
            client_ = other;
            colleague_ = dialed;
        }
        Publish();
        // Depois da trava: o motor liga, e os eventos da ligação podem chegar antes de o MakeCall voltar. A
        // tela recebe a feita antes (o MakeCall pode demorar, e o Desligar dela já vale: hangupWhenDialed).
        effects.push_back([this, dialed, number] {
            Deliver();
            const int id = engine_.MakeCall(number);
            Act([&](Effects& more) { OnDialed(dialed, id, more); });
        });
        placed = true;
    });
    return placed;
}

bool CallController::DialContact(const std::string& number) {
    const std::string dialed = dialRule_ ? dialRule_(number) : number;
    return !dialed.empty() && Dial(dialed);
}

void CallController::Answer() {
    Act([this](Effects& effects) {
        const CallPtr ringing = RingingCall();
        if (!ringing) return;
        ringing->answered = true;
        ringing->phase = Call::Phase::Connecting;
        const CallPtr other = OtherThan(ringing);
        active_ = ringing;
        if (other) other->held = true;   // o motor a põe em espera no Answer
        const int id = ringing->id;
        effects.push_back([this, id] { engine_.Answer(id); });
        Publish();
    });
}

void CallController::Reject() {
    Act([this](Effects& effects) {
        const CallPtr ringing = RingingCall();
        if (!ringing) return;
        RejectCall(ringing, effects);
        Publish();
    });
}

void CallController::Hangup() {
    Act([this](Effects& effects) {
        if (conference_) {
            HangupConference(effects);
            return;
        }
        if (!active_ || active_->ending) return;
        HangupCall(active_, effects);
        Publish();
    });
}

void CallController::Hangup(int callId) {
    Act([&](Effects& effects) {
        CallPtr current;
        if (callId == kNoId) {
            // A feita mais nova (o cartão dela ainda pode estar sem o id do motor).
            for (const CallPtr& call : calls_) {
                if (!call->incoming) current = call;
            }
        } else {
            const auto it = std::find_if(calls_.begin(), calls_.end(),
                                         [callId](const CallPtr& c) { return c->id == callId; });
            if (it != calls_.end()) current = *it;
        }
        if (!current || current->ending) return;
        // Na conferência, o Desligar de qualquer uma é o Desligar para todos (a tela não separa as duas).
        if (conference_) {
            HangupConference(effects);
            return;
        }
        HangupCall(current, effects);
        Publish();
    });
}

void CallController::Swap() {
    Act([this](Effects& effects) {
        if (conference_ || !active_) return;
        const CallPtr other = OtherThan(active_);
        if (other) SwapCalls(active_, other, effects);
    });
}

void CallController::Hold(std::optional<bool> on) {
    Act([&](Effects& effects) {
        if (conference_) return;
        const CallPtr current = Talking();
        if (!current) return;
        const bool target = on ? *on : !current->held;
        if (target == current->held) return;
        // Com a outra em andamento, a espera da ativa é o Alternar (a outra volta).
        const CallPtr other = OtherThan(current);
        if (target && other && other->phase == Call::Phase::Active) {
            SwapCalls(current, other, effects);
            return;
        }
        current->held = target;
        Publish();
        const int id = current->id;
        effects.push_back([this, id, target] { engine_.SetHold(id, target); });
    });
}

void CallController::Mute(std::optional<bool> on) {
    Act([&](Effects& effects) {
        const CallPtr current = Shown();
        if (!current || current->phase == Call::Phase::Ringing) return;
        const bool target = on ? *on : !muted_;
        if (target == muted_) return;
        muted_ = target;
        Publish();
        effects.push_back([this, target] { engine_.SetMute(target); });
    });
}

void CallController::Dtmf(const std::string& digits) {
    Act([&](Effects& effects) {
        const CallPtr current = Talking();
        if (!current || digits.empty()) return;
        const int id = current->id;
        effects.push_back([this, id, digits] { engine_.SendDtmf(id, digits); });
    });
}

bool CallController::Transfer(const std::string& raw) {
    const std::string number = Normalize(raw);
    if (number.empty()) return false;
    bool asked = false;
    Act([&](Effects& effects) {
        const CallPtr current = Talking();
        if (!current || client_ || conference_ || current->transferPending != TransferKind::None) return;
        current->transferPending = TransferKind::Direct;
        const int request = ++current->transferRequest;
        const int id = current->id;
        // Roda antes de o Transfer voltar (os efeitos rodam dentro do Act): o asked ainda existe.
        effects.push_back([this, current, id, number, request, &asked] {
            if (engine_.Transfer(id, number)) return;
            asked = false;
            Act([&](Effects&) { OnTransferRefusedAtOnce(current, request); });
        });
        asked = true;
    });
    return asked;
}

void CallController::CompleteTransfer() {
    Act([this](Effects& effects) {
        if (!client_) return;
        const CallPtr client = client_;
        const CallPtr colleague = colleague_;
        const bool confirmed = client->phase == Call::Phase::Active && colleague->phase == Call::Phase::Active;
        if (client->transferPending != TransferKind::None || !confirmed || client->ending || colleague->ending) return;
        client->transferPending = TransferKind::Attended;
        const int request = ++client->transferRequest;
        const int clientId = client->id;
        const int colleagueId = colleague->id;
        effects.push_back([this, client, clientId, colleagueId, request] {
            if (engine_.TransferAttended(clientId, colleagueId)) return;
            Act([&](Effects&) { OnTransferRefusedAtOnce(client, request); });
        });
    });
}

void CallController::CancelConsult() {
    Act([this](Effects& effects) {
        if (!colleague_ || colleague_->ending) return;
        HangupCall(colleague_, effects);
        Publish();
    });
}

void CallController::Join() {
    Act([this](Effects& effects) {
        if (conference_ || client_) return;
        const CallPtr current = Talking();
        if (!current) return;
        const CallPtr other = OtherThan(current);
        if (!other || other->phase != Call::Phase::Active) return;
        if (current->transferPending != TransferKind::None || other->transferPending != TransferKind::None) return;
        conference_ = true;
        conferenceSince_ = clock_.NowMs();
        current->held = false;   // o motor retoma a em espera no Join
        other->held = false;
        Publish();
        const int id = current->id;
        const int otherId = other->id;
        effects.push_back([this, id, otherId] { engine_.Join(id, otherId); });
    });
}

void CallController::Split() {
    Act([this](Effects& effects) {
        CallPtr first;
        CallPtr last;
        if (Members(first, last)) Separate(first, last, effects);
    });
}

void CallController::OnLogout() {
    Act([this](Effects& effects) {
        loggedOut_ = true;
        ClearEndMessage();
        const std::vector<CallPtr> current = calls_;
        for (const CallPtr& call : current) {
            call->abandoned = true;
            const int id = call->id;
            if (id != kNoId) effects.push_back([this, id] { engine_.Hangup(id); });
            End(call, 0, effects, /*quiet=*/true);
        }
        Publish();
    });
}

void CallController::OnLogin() {
    std::lock_guard<std::mutex> lock(mutex_);
    loggedOut_ = false;
}

void CallController::Deliver() {
    for (;;) {
        std::function<void()> next;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            if (delivering_ || publications_.empty()) return;
            delivering_ = true;
            next = std::move(publications_.front());
            publications_.pop_front();
        }
        try {
            next();
        } catch (...) {
            std::lock_guard<std::mutex> lock(mutex_);
            delivering_ = false;
            throw;
        }
        std::lock_guard<std::mutex> lock(mutex_);
        delivering_ = false;
    }
}

// Com a trava: o MakeCall da feita dialed voltou com id (-1: não ligou). O id do MakeCall vale mais que
// o de um evento tomado antes dele (de outra ligação, que então sai).
void CallController::OnDialed(const CallPtr& dialed, int id, Effects& effects) {
    if (std::find(calls_.begin(), calls_.end(), dialed) == calls_.end()) {
        // Ela já acabou: a conta saiu, ou um fim chegou antes de o MakeCall voltar. Se o fim era de outra
        // ligação (o id tomado não é o do MakeCall), a do motor ficou sem dono: sai também.
        if (id > 0 && (dialed->abandoned || dialed->id != id)) effects.push_back([this, id] { engine_.Hangup(id); });
        return;
    }
    if (id <= 0) {
        End(dialed, 0, effects);
    } else if (dialed->id == kNoId) {
        Adopt(dialed, id, effects);
    } else if (dialed->id != id) {
        const int other = dialed->id;
        dialed->id = kNoId;
        dialed->phase = Call::Phase::Dialing;   // o que veio da outra não vale
        dialed->activeSince = 0;
        // Desligada enquanto tinha o id da outra: o pedido vale para esta (o Adopt a desliga).
        if (dialed->localHangup) dialed->hangupWhenDialed = true;
        Adopt(dialed, id, effects);
        effects.push_back([this, other] { engine_.Hangup(other); });
    }
    Publish();
}

// Com a trava: o motor recusou na hora (Transfer ou TransferAttended devolveu false, e nenhum OnTransfer
// vem) o pedido request da ligação call: ele deixa de esperar, com o aviso, e vale de novo. Nada se ela
// já acabou ou se o pedido já saiu (o colega acabou antes).
void CallController::OnTransferRefusedAtOnce(const CallPtr& call, int request) {
    if (std::find(calls_.begin(), calls_.end(), call) == calls_.end() || call->ending) return;
    if (call->transferRequest != request || call->transferPending == TransferKind::None) return;
    call->transferPending = TransferKind::None;
    ShowEndMessage(TransferRefusedText());
}

// Com a trava: a ligação do evento de callId: a que tem o id, ou a feita sem id (o MakeCall ainda não
// voltou), se o id é de uma ligação nova; nullptr: de outra ligação.
CallController::CallPtr CallController::OwnerOf(int callId) const {
    for (const CallPtr& call : calls_) {
        if (call->id == callId) return call;
    }
    if (callId <= maxSeenId_) return nullptr;
    for (const CallPtr& call : calls_) {
        if (!call->incoming && call->id == kNoId) return call;
    }
    return nullptr;
}

// Com a trava: a feita call ganha o id do motor.
void CallController::Adopt(const CallPtr& call, int id, Effects& effects) {
    call->id = id;
    maxSeenId_ = std::max(maxSeenId_, id);
    if (call->hangupWhenDialed) {
        call->hangupWhenDialed = false;
        effects.push_back([this, id] { engine_.Hangup(id); });
    }
}

// Com a trava: a recebida call recebe ocupado (486); o fim dela chega pelo motor.
void CallController::RejectCall(const CallPtr& call, Effects& effects) {
    call->rejected = true;
    call->ending = true;
    const int id = call->id;
    effects.push_back([this, id] { engine_.Reject(id); });
}

// Com a trava: desliga call. A recebida que toca é recusada; a feita sem id é desligada quando o id chegar.
void CallController::HangupCall(const CallPtr& call, Effects& effects) {
    if (call->incoming && call->phase == Call::Phase::Ringing) {
        RejectCall(call, effects);
        return;
    }
    call->localHangup = true;
    call->ending = true;
    const int id = call->id;
    if (id != kNoId) {
        effects.push_back([this, id] { engine_.Hangup(id); });
    } else {
        call->hangupWhenDialed = true;
    }
}

// Com a trava: o Desligar da conferência (o da tela, ou o Hangup com o id de qualquer uma): as que ainda não
// estão saindo saem, e nenhuma volta sozinha.
void CallController::HangupConference(Effects& effects) {
    std::vector<CallPtr> members;
    for (const CallPtr& call : calls_) {
        if (!call->ending) members.push_back(call);
    }
    if (members.empty()) return;
    for (const CallPtr& member : members) HangupCall(member, effects);
    Publish();
}

// Com a trava: o Alternar, de from (a ativa) para to (a outra), só com as duas em andamento. O motor troca
// (Activate: a ativa vai para a espera e a outra é retomada).
void CallController::SwapCalls(const CallPtr& from, const CallPtr& to, Effects& effects) {
    if (from->ending || from->phase != Call::Phase::Active || to->phase != Call::Phase::Active) return;
    from->held = true;
    to->held = false;
    active_ = to;
    Publish();
    const int id = to->id;
    effects.push_back([this, id] { engine_.Activate(id); });
}

// Com a trava: a ativa acabou (e não estava em espera): a outra, a ativa agora, se está em andamento, volta
// sozinha (o motor a retoma). Nada depois de Sair, nem com ela tocando ou saindo.
void CallController::ResumeNext(Effects& effects) {
    const CallPtr next = active_;
    if (!next || loggedOut_ || next->phase != Call::Phase::Active || next->ending) return;
    next->held = false;
    const int id = next->id;
    effects.push_back([this, id] { engine_.Activate(id); });
}

// Com a trava: a outra da conferência que acabou (a ativa agora) segue como uma ligação normal: o motor já a
// deixa com o som (nada de Activate). Não se ela também está saindo (Desligar), nem depois de Sair.
void CallController::StayAfterConference() {
    const CallPtr next = active_;
    if (!next || loggedOut_ || next->phase != Call::Phase::Active || next->ending) return;
    next->held = false;
}

// Com a trava: o Separar das duas da conferência: ela acaba, last (a última que entrou) vai para a espera e
// first fica a ativa, em cima. O motor desfaz as ligações entre as duas e põe last em espera (Split).
void CallController::Separate(const CallPtr& first, const CallPtr& last, Effects& effects) {
    conference_ = false;
    conferenceSince_ = 0;
    active_ = first;
    first->held = false;
    last->held = true;
    Publish();
    const int firstId = first->id;
    const int lastId = last->id;
    effects.push_back([this, firstId, lastId] { engine_.Split(firstId, lastId); });
}

// Com a trava: as duas da conferência, na ordem em que entraram (first e last), com as duas de pé; false
// fora da conferência ou com uma delas saindo.
bool CallController::Members(CallPtr& first, CallPtr& last) const {
    if (!conference_ || calls_.size() != 2) return false;
    if (calls_[0]->ending || calls_[1]->ending) return false;
    first = calls_[0];
    last = calls_[1];
    return true;
}

// Com a trava: call acabou; se era da consulta, ela acaba aí (o cliente volta pela volta sozinha do End, e o
// colega que fica é uma ligação normal). true se call era o colega: o aviso de fim dele leva o nome ou o
// número na frente. O colega que acaba com o Concluir esperando o resultado leva o pedido do cliente junto:
// o motor recusa o REFER sem o colega, o resultado (OnTransfer) nunca chega, e o cliente pode ser
// transferido de novo.
bool CallController::LeaveConsult(const CallPtr& call) {
    if (!client_ || (call != client_ && call != colleague_)) return false;
    const bool wasColleague = call == colleague_;
    if (wasColleague && client_->transferPending == TransferKind::Attended) {
        client_->transferPending = TransferKind::None;
    }
    client_ = nullptr;
    colleague_ = nullptr;
    return wasColleague;
}

// Com a trava: uma ligação da conferência acabou (do outro lado, desligada aqui ou com Sair): a conferência
// acaba aí. true se havia conferência.
bool CallController::LeaveConference() {
    if (!conference_) return false;
    conference_ = false;
    conferenceSince_ = 0;
    return true;
}

// Com a trava: a ligação call acabou com o código sipCode: Recentes, o aviso de perdida e o aviso de fim.
// quiet (Sair): sem avisos. Se era a ativa, a outra (se há) passa a ser, e volta sozinha (ResumeNext). A
// outra que cai do outro lado, já em andamento e com a ativa continuando, deixa o aviso "<nome ou número>
// desligou", como qualquer uma das duas da conferência. Com ela, a consulta (LeaveConsult) e a
// conferência (LeaveConference) acabam; a outra da conferência fica como uma ligação normal
// (StayAfterConference).
void CallController::End(const CallPtr& call, int sipCode, Effects& effects, bool quiet) {
    const bool wasActive = call == active_;
    const bool colleague = LeaveConsult(call);
    const bool fromConference = LeaveConference();
    calls_.erase(std::remove(calls_.begin(), calls_.end(), call), calls_.end());
    if (wasActive) active_ = calls_.empty() ? nullptr : calls_.front();
    const bool received = call->activeSince > 0;
    const int64_t durationMs = received ? clock_.NowMs() - call->activeSince : 0;
    Recent::Kind kind;
    if (call->incoming) {
        kind = received ? Recent::Incoming : Recent::Missed;
        // A perdida que a pessoa não viu (quem ligou desistiu) ganha o aviso.
        const bool unseen = !call->answered && !call->rejected;
        if (!received && unseen && !quiet) {
            const std::string text = MissedText(call->number, call->name, call->contact);
            publications_.push_back([this, text] { listener_.OnMissed(text); });
        }
    } else {
        kind = Recent::Outgoing;
        // O aviso é só da feita que não completou: o código de uma desligada aqui é a resposta daqui, e uma
        // atendida que caiu (ex.: 408 depois de uma troca de rede) completou.
        if (!call->localHangup && !quiet && !received) {
            const std::string message = WideToUtf8(CallEndMessage(sipCode));
            // O colega da consulta que não atendeu: "<nome ou número>: <motivo>" (o cliente já volta, abaixo).
            if (!message.empty()) ShowEndMessage(colleague ? call->Label() + ": " + message : message);
        }
    }
    const bool othersStay =
        std::any_of(calls_.begin(), calls_.end(), [](const CallPtr& c) { return !c->ending; });
    if ((!wasActive || fromConference) && received && !call->localHangup && !quiet && othersStay) {
        ShowEndMessage(call->Label() + " desligou");
    }
    if (muted_ && calls_.empty()) {
        muted_ = false;
        effects.push_back([this] { engine_.SetMute(false); });
    }
    Record(MakeRecent(call->number, call->name, kind, call->startMs, durationMs));
    if (fromConference) {
        StayAfterConference();
    } else if (wasActive && !call->held) {
        ResumeNext(effects);
    }
}

// Com a trava: uma perdida que a pessoa não viu (ocupado): Recentes e o aviso.
void CallController::RecordMissed(const Recent& recent, const std::optional<std::string>& contact) {
    Record(recent);
    const std::string text = MissedText(recent.number, recent.name, contact);
    publications_.push_back([this, text] { listener_.OnMissed(text); });
}

// Com a trava.
void CallController::Record(const Recent& recent) {
    publications_.push_back([this, recent] { listener_.OnRecent(recent); });
}

// Com a trava: text por 2 s.
void CallController::ShowEndMessage(const std::string& text) {
    if (endTimer_ != 0) scheduler_.Cancel(endTimer_);
    const int token = ++endToken_;
    endMessage_ = text;
    Publish();
    endTimer_ = scheduler_.Schedule(kEndMessageMs, [this, token] {
        Act([this, token](Effects&) {
            if (endToken_ != token) return;
            endTimer_ = 0;
            endMessage_.clear();
            Publish();
        });
    });
}

// Com a trava.
void CallController::ClearEndMessage() {
    if (endTimer_ != 0) scheduler_.Cancel(endTimer_);
    endTimer_ = 0;
    ++endToken_;
    endMessage_.clear();
    Publish();
}

// Com a trava: o estado de agora e o toque vão à fila das publicações, se mudaram: a ligação da tela e,
// com duas, a outra, a consulta e a conferência (só com as duas de pé: com uma saindo, a tela já mostra a
// outra sozinha).
void CallController::Publish() {
    CallSnapshot snapshot;
    const CallPtr main = Shown();
    if (main) {
        snapshot.top = ViewOf(*main);
        const CallPtr other = OtherThan(main);
        if (other) {
            snapshot.second = ViewOf(*other);
            snapshot.secondKind = other->phase == Call::Phase::Ringing ? CallSnapshot::Ringing : CallSnapshot::Held;
            if (conference_) {
                snapshot.conference = true;
                snapshot.conferenceSinceMs = conferenceSince_;
            }
        }
        if (client_ && !client_->ending && !colleague_->ending) {
            snapshot.consulting = true;
            snapshot.colleagueActive = colleague_ == active_;
        }
        snapshot.muted = muted_;
    }
    snapshot.endMessage = endMessage_;
    if (snapshot != published_) {
        published_ = snapshot;
        publications_.push_back([this, snapshot] { listener_.OnSnapshot(snapshot); });
    }
    RingKind ring = RingKind::Stop;
    const CallPtr ringing = RingingCall();
    if (ringing) ring = OtherThan(ringing) ? RingKind::Waiting : RingKind::Full;
    if (ring != ring_) {
        ring_ = ring;
        publications_.push_back([this, ring] { listener_.OnRing(ring); });
    }
}

// Com a trava: a ligação da tela: a ativa, ou a outra enquanto a ativa sai (nullptr: nenhuma).
CallController::CallPtr CallController::Shown() const {
    if (active_ && !active_->ending) return active_;
    for (const CallPtr& call : calls_) {
        if (!call->ending) return call;
    }
    return nullptr;
}

// Com a trava: a ativa, se está em andamento (os dois lados atenderam) e não está saindo.
CallController::CallPtr CallController::Talking() const {
    if (active_ && active_->phase == Call::Phase::Active && !active_->ending) return active_;
    return nullptr;
}

// Com a trava: a outra ligação que não call (nullptr: não há, ou ela está saindo).
CallController::CallPtr CallController::OtherThan(const CallPtr& call) const {
    for (const CallPtr& other : calls_) {
        if (other != call && !other->ending) return other;
    }
    return nullptr;
}

// Com a trava: a recebida que toca (só uma toca por vez).
CallController::CallPtr CallController::RingingCall() const {
    for (const CallPtr& call : calls_) {
        if (call->incoming && call->phase == Call::Phase::Ringing && !call->ending) return call;
    }
    return nullptr;
}

CallView CallController::ViewOf(const Call& call) const {
    CallView view;
    view.id = call.id;
    view.number = call.number;
    view.name = call.DisplayName();
    view.incoming = call.incoming;
    switch (call.phase) {
        case Call::Phase::Ringing:
            view.phase = CallView::Ringing;
            break;
        case Call::Phase::Dialing:
            view.phase = CallView::Dialing;
            break;
        case Call::Phase::Connecting:
        case Call::Phase::Active:
            view.phase = CallView::Active;
            break;
    }
    view.activeSinceMs = call.activeSince;
    view.held = call.held;
    return view;
}

}  // namespace starsonic
