#include "BaresipCalls.h"

#include <algorithm>
#include <cerrno>
#include <cstdint>
#include <cstring>
#include <string>
#include <utility>

#include "EngineEvents.h"

namespace starsonic {
namespace {

// Uma recusa do re-INVITE (4xx a 6xx) acaba a renegociação sem nenhum evento do baresip: quem espera a renegociação
// anterior de uma ligação (WaitNegotiation) confere de novo a cada 20 ms.
const int kNegotiationRecheckMs = 20;

// Quem liga: o usuário do From (o número), sem os escapes da URI, como no motor do PJSIP, e o nome de exibição como
// veio (sem as aspas; UTF-8).
struct Party {
    std::string user;
    std::string name;
};

Party PartyOf(const struct sip_msg* msg) {
    Party party;
    char* user = nullptr;
    if (re_sdprintf(&user, "%H", uri_user_unescape, &msg->from.uri.user) == 0 && user) party.user = user;
    mem_deref(user);
    if (pl_isset(&msg->from.dname)) party.name.assign(msg->from.dname.p, msg->from.dname.l);
    return party;
}

// O 18x que o baresip avisou (BEVENT_CALL_RINGING sem SDP, BEVENT_CALL_PROGRESS com SDP), pelo estado em que ele pôs a
// ligação: CALL_STATE_EARLY no 183, CALL_STATE_RINGING no 180. Outro 18x vale como o 180.
int ProgressCode(const struct call* call) { return call_state(call) == CALL_STATE_EARLY ? 183 : 180; }

// A frase da recusa de uma recebida que toca (a do ua_hangup).
const char* ReasonOf(int code) {
    if (code == 486) return "Busy Here";
    if (code == 603) return "Decline";
    return nullptr;
}

}  // namespace

// As funções que a libre chama, na thread do laço. Nenhuma exceção volta para a libre, que é C.
struct BaresipCalls::Hooks {
    static void Hangup(void* arg) {
        try {
            static_cast<BaresipCalls*>(arg)->HangupReady();
        } catch (...) {
        }
    }

    static void StopAudio(void* arg) {
        try {
            static_cast<BaresipCalls*>(arg)->StopSilentAudio();
        } catch (...) {
        }
    }
};

BaresipCalls::BaresipCalls(EventQueue& events, BaresipLoop::LogSink log, DtmfMethod /*dtmf*/)
    : events_(events), log_(std::move(log)) {
    tmr_init(&hangupTimer_);
    tmr_init(&audioTimer_);
}

void BaresipCalls::OnEvent(enum bevent_ev ev, struct bevent* event) {
    if (ev == BEVENT_SIPSESS_CONN) {
        OnInvite(bevent_get_msg(event));
        return;
    }
    struct call* call = bevent_get_call(event);
    if (!call || OnWaiting(ev, call)) return;
    Slot* slot = Find(call);
    if (!slot) return;   // uma que já saiu daqui (End) ou que nunca entrou (o baresip a recusou)
    switch (ev) {
        case BEVENT_CALL_RINGING:
        case BEVENT_CALL_PROGRESS:
            if (slot->incoming || slot->confirmed) break;
            slot->progressed = true;
            PostState(slot->id, CallState::Early, ProgressCode(call));
            break;
        case BEVENT_CALL_ESTABLISHED:
            // A feita: o 200 chegou e o ACK saiu. A recebida: o ACK chegou (o Connecting saiu no Answer), e o baresip
            // acabou de abrir o áudio dela.
            if (slot->confirmed) break;
            slot->progressed = true;
            slot->confirmed = true;
            if (!slot->incoming) PostState(slot->id, CallState::Connecting, 200);
            PostState(slot->id, CallState::Confirmed, 200);
            if (Silent(*slot)) tmr_start(&audioTimer_, 0, Hooks::StopAudio, this);
            break;
        case BEVENT_CALL_REMOTE_SDP: {
            // Um SDP do outro lado, que o baresip aplica depois deste aviso (update_media): com ele, abre de novo o
            // áudio, também o de uma ligação só de envio. A resposta a uma oferta (answer) acaba a negociação dela.
            const char* text = bevent_get_text(event);
            if (text && std::strcmp(text, "answer") == 0) Negotiated();
            if (Silent(*slot)) tmr_start(&audioTimer_, 0, Hooks::StopAudio, this);
            break;
        }
        case BEVENT_CALL_CLOSED: {
            const int id = slot->id;
            const int code = EndCode(*slot, call, bevent_get_text(event));
            Free(*slot);   // antes do aviso: o Count cai antes de o Disconnected chegar ao listener
            PostState(id, CallState::Disconnected, code);
            Negotiated();   // quem espera a renegociação dela não espera mais
            break;
        }
        default:
            break;
    }
}

int BaresipCalls::Make(struct ua* ua, const std::string& uri) {
    blocked_ = false;
    Slot* slot = FreeSlot();
    Slot* other = slot ? Other(*slot) : nullptr;
    if (!slot || (other && !other->confirmed)) {
        Log(2, "ligacao para " + uri + " recusada: " +
                   (slot ? "a outra ligacao nao foi confirmada" : "ja ha duas ligacoes"));
        return -1;
    }
    if (other && !Held(*other)) {
        if (OfferPending(*other)) {
            blocked_ = true;
            return -1;
        }
        (void)Renegotiate(*other, true);   // antes da nova, e fica em espera mesmo se a nova não sai
    }
    struct call* call = nullptr;
    const int err = ua_connect(ua, &call, nullptr, uri.c_str(), VIDMODE_OFF);
    if (err) {
        Log(2, "nao foi possivel ligar para " + uri + ": " + BaresipLoop::ErrorText(err));
        return -1;
    }
    // Nenhuma resposta é lida antes de o Run acabar: o Calling vem antes de qualquer outro estado da ligação.
    Bind(*slot, call, false);
    activeId_ = slot->id;
    PostState(slot->id, CallState::Calling, 0);
    return slot->id;
}

bool BaresipCalls::Answer(int id) {
    blocked_ = false;
    Slot* slot = Find(id);
    if (!slot || !slot->incoming || slot->answered) return false;
    Slot* other = Other(*slot);
    if (other && other->confirmed && !Held(*other)) {
        if (OfferPending(*other)) {
            blocked_ = true;
            return false;
        }
        (void)Renegotiate(*other, true);   // o re-INVITE da espera sai antes do 200
    }
    const int err = call_answer(slot->call, 200, VIDMODE_OFF);
    if (err) {
        Log(2, "nao foi possivel atender a ligacao: " + BaresipLoop::ErrorText(err));
        return false;
    }
    slot->answered = true;
    activeId_ = id;
    PostState(id, CallState::Connecting, 200);
    return true;
}

bool BaresipCalls::Reject(int id) {
    Slot* slot = Find(id);
    if (!slot || !slot->incoming || slot->answered) return false;
    End(*slot, 486, true);
    return true;
}

bool BaresipCalls::Hangup(int id) {
    Slot* slot = Find(id);
    if (!slot) return false;
    End(*slot, HangupCode(*slot), true);
    return true;
}

bool BaresipCalls::Activate(int id) {
    blocked_ = false;
    Slot* slot = Find(id);
    if (!slot || !slot->confirmed) return false;
    Slot* other = Other(*slot);
    const bool holdOther = other && other->confirmed && !Held(*other);
    const bool resume = Held(*slot);
    const bool wasActive = activeId_ == id;
    if (wasActive && !holdOther && !resume) return true;   // já é a ativa: nenhum re-INVITE
    if ((holdOther && OfferPending(*other)) || (resume && OfferPending(*slot))) {
        blocked_ = true;
        return false;
    }
    activeId_ = id;
    if (holdOther) (void)Renegotiate(*other, true);   // a outra vai para a espera antes, como no motor do PJSIP
    if (resume) return Renegotiate(*slot, false);
    if (!wasActive) {
        // Confirmada fora da espera sem ser a ativa (a outra virou a ativa antes de esta ser confirmada): o áudio dela
        // parou, e volta agora, sem re-INVITE.
        const int err = audio_update(call_audio(slot->call));
        if (err) Log(2, "o audio da ligacao nao voltou: " + BaresipLoop::ErrorText(err));
    }
    return true;
}

bool BaresipCalls::SetHold(int id, bool hold) {
    if (!hold) return Activate(id);   // retomar é tornar a ativa
    blocked_ = false;
    Slot* slot = Find(id);
    if (!slot || !slot->confirmed) return false;
    if (Held(*slot)) return true;   // já em espera: nenhum re-INVITE
    if (OfferPending(*slot)) {
        blocked_ = true;
        return false;
    }
    return Renegotiate(*slot, true);
}

bool BaresipCalls::Blocked() const { return blocked_; }

uint64_t BaresipCalls::Negotiations() const {
    std::lock_guard<std::mutex> lock(negotiationMutex_);
    return negotiations_;
}

void BaresipCalls::WaitNegotiation(uint64_t seen, std::chrono::steady_clock::time_point deadline) {
    const auto until =
        std::min(deadline, std::chrono::steady_clock::now() + std::chrono::milliseconds(kNegotiationRecheckMs));
    std::unique_lock<std::mutex> lock(negotiationMutex_);
    negotiated_.wait_until(lock, until, [this, seen] { return negotiations_ != seen; });
}

int BaresipCalls::Count() const { return count_.load(); }

std::vector<int> BaresipCalls::AudioLinks(int id) const {
    const Slot* slot = Find(id);
    if (!slot || !slot->confirmed || Silent(*slot)) return std::vector<int>();
    return std::vector<int>{0};
}

std::vector<int> BaresipCalls::CallsWithAudio() const {
    std::vector<int> ids;
    for (const Slot& slot : slots_) {
        if (slot.id != 0 && audio_started(call_audio(slot.call))) ids.push_back(slot.id);
    }
    std::sort(ids.begin(), ids.end());
    return ids;
}

void BaresipCalls::HangupAll() {
    open_ = false;
    for (Slot& slot : slots_) {
        if (slot.id != 0) End(slot, HangupCode(slot), true);
    }
}

void BaresipCalls::Open() { open_ = true; }

void BaresipCalls::EndAll() {
    open_ = false;
    for (Slot& slot : slots_) {
        if (slot.id != 0) End(slot, HangupCode(slot), false);
    }
    tmr_cancel(&audioTimer_);   // sem ligações, nada a parar: nada dele sobra depois do laço
}

void BaresipCalls::OnInvite(const struct sip_msg* msg) {
    if (!msg) return;
    const Party party = PartyOf(msg);
    Slot* slot = FreeSlot();
    const Slot* other = slot ? Other(*slot) : nullptr;
    // Toca sem ligação nenhuma ou com uma só, já confirmada (a segunda ligação). Duas ligações, ou uma que ainda não
    // foi confirmada: 486. A conta ou o motor saindo: 480, sem aviso.
    if (!open_ || !slot || (other && !other->confirmed)) {
        const uint16_t code = open_ ? 486 : 480;
        Log(3, "ligacao de " + party.user + " recusada (" + std::to_string(code) + ")");
        (void)sip_treply(nullptr, uag_sip(), msg, code, open_ ? "Busy Here" : "Temporarily Unavailable");
        if (open_) {
            events_.Post([party](EngineListener& listener) { listener.OnRejectedBusy(party.user, party.name); });
        }
        return;
    }
    // O baresip cria a ligação e já responde 180 (call_accept). Quando ele mesmo a recusa (sem codec em comum, por
    // exemplo), a resposta já saiu e a ligação não fica na lista da ua: nada chega ao listener.
    struct ua* ua = uag_find_msg(msg);
    const int err = ua_accept(ua, msg);
    struct call* call = err ? nullptr : ua_find_call_msg(ua, msg);
    if (!call) {
        Log(2, "a ligacao de " + party.user + " nao foi aceita pelo baresip" +
                   (err ? ": " + BaresipLoop::ErrorText(err) : std::string()));
        return;
    }
    Bind(*slot, call, true);
    const int id = slot->id;
    events_.Post([id, party](EngineListener& listener) { listener.OnIncomingCall(id, party.user, party.name); });
    PostState(id, CallState::Incoming, 100);
    PostState(id, CallState::Early, 180);   // o 180 que já saiu
}

void BaresipCalls::End(Slot& slot, int code, bool report) {
    struct call* call = slot.call;
    const int id = slot.id;
    // Agora, o ua_hangup largaria o INVITE da feita que ainda não teve resposta provisória (a libre não pode mandar o
    // CANCEL e solta a transação) e mandaria uma vez só o BYE da recebida atendida que ainda não teve o ACK (o
    // sipsess_abort solta o pedido com a sessão): as duas esperam a resposta (o OnWaiting).
    const bool wait = slot.incoming ? slot.answered && !slot.confirmed : !slot.progressed;
    Free(slot);   // o BEVENT_CALL_CLOSED que o ua_hangup avisa, logo abaixo, já não acha a ligação
    if (wait) {
        waiting_.push_back(Waiting{call, false});
    } else {
        // A recebida que toca recebe a recusa com o código; nas outras, o baresip manda o CANCEL ou o BYE, e a libre
        // termina o pedido sozinha depois que a ligação sai (o ua_hangup a solta).
        ua_hangup(call_get_ua(call), call, static_cast<uint16_t>(code), ReasonOf(code));
    }
    if (report) PostState(id, CallState::Disconnected, code);
}

bool BaresipCalls::OnWaiting(enum bevent_ev ev, const struct call* call) {
    for (auto it = waiting_.begin(); it != waiting_.end(); ++it) {
        if (it->call != call) continue;
        switch (ev) {
            case BEVENT_CALL_RINGING:
            case BEVENT_CALL_PROGRESS:
            case BEVENT_CALL_ESTABLISHED:
                // O 18x (a feita pode mandar o CANCEL), o 200 da feita (a libre já mandou o ACK) ou o ACK da recebida:
                // o pedido sai no temporizador, depois que a libre acabar de tratar a resposta.
                it->ready = true;
                tmr_start(&hangupTimer_, 0, Hooks::Hangup, this);
                break;
            case BEVENT_CALL_CLOSED:
                // Acabou sozinha (uma recusa, o tempo esgotado, o BYE do outro lado ou a ua que saiu): nada a mandar.
                waiting_.erase(it);
                if (waiting_.empty()) tmr_cancel(&hangupTimer_);
                break;
            default:
                break;
        }
        return true;
    }
    return false;
}

void BaresipCalls::HangupReady() {
    // Saem da lista antes: o ua_hangup avisa o BEVENT_CALL_CLOSED delas na hora.
    std::vector<struct call*> ready;
    for (auto it = waiting_.begin(); it != waiting_.end();) {
        if (it->ready) {
            ready.push_back(it->call);
            it = waiting_.erase(it);
        } else {
            ++it;
        }
    }
    // Agora o baresip manda o CANCEL (a libre já teve a resposta provisória) ou o BYE (a ligação chegou ao
    // ESTABLISHED), e a libre o termina sozinha.
    for (struct call* call : ready) ua_hangup(call_get_ua(call), call, 0, nullptr);
}

int BaresipCalls::HangupCode(const Slot& slot) const {
    if (slot.incoming) return slot.answered ? 200 : 603;   // o BYE, ou a recusa da que toca
    return slot.confirmed ? 200 : 487;                     // o BYE, ou o CANCEL da que chama
}

int BaresipCalls::EndCode(const Slot& slot, const struct call* call, const char* text) const {
    if (slot.confirmed) return 200;                        // o BYE de qualquer lado
    if (slot.incoming && !slot.answered) return 487;       // o CANCEL de quem liga (a libre respondeu 487)
    // O tempo esgotado, como no motor do PJSIP, dá 408. O motivo que o baresip dá é o %m do erro, às vezes seguido do
    // Reason.
    const std::string timeout = BaresipLoop::ErrorText(ETIMEDOUT);
    const bool timedOut = text && std::string(text).compare(0, timeout.size(), timeout) == 0;
    // A recebida atendida e ainda sem o ACK: o BYE de quem ligou, ou o ACK que não veio (a libre manda o BYE).
    if (slot.incoming) return timedOut ? 408 : 200;
    const uint16_t scode = call_scode(call);
    if (scode >= 300) return scode;                        // a feita recusada: a resposta final
    // A feita sem resposta final, como no motor do PJSIP: 408 com o tempo esgotado, 503 nos outros erros (os de
    // transporte).
    return timedOut ? 408 : 503;
}

bool BaresipCalls::Held(const Slot& slot) const { return call_is_onhold(slot.call); }

bool BaresipCalls::Silent(const Slot& slot) const { return slot.id != activeId_ || Held(slot); }

bool BaresipCalls::OfferPending(const Slot& slot) const { return !call_refresh_allowed(slot.call); }

bool BaresipCalls::Renegotiate(Slot& slot, bool hold) {
    const int err = call_hold(slot.call, hold);
    if (err) Log(2, std::string(hold ? "espera: " : "retomar: ") + BaresipLoop::ErrorText(err));
    if (Silent(slot)) audio_stop(call_audio(slot.call));
    return err == 0;
}

void BaresipCalls::StopSilentAudio() {
    for (const Slot& slot : slots_) {
        if (slot.id != 0 && Silent(slot)) audio_stop(call_audio(slot.call));
    }
}

void BaresipCalls::Negotiated() {
    {
        std::lock_guard<std::mutex> lock(negotiationMutex_);
        ++negotiations_;
    }
    negotiated_.notify_all();
}

void BaresipCalls::Bind(Slot& slot, struct call* call, bool incoming) {
    slot = Slot();
    slot.call = call;
    slot.id = nextId_++;
    slot.incoming = incoming;
    Recount();
}

void BaresipCalls::Free(Slot& slot) {
    if (slot.id == activeId_) activeId_ = 0;   // a outra não vira a ativa sozinha: só com um Activate
    slot = Slot();
    Recount();
}

void BaresipCalls::Recount() {
    int busy = 0;
    for (const Slot& slot : slots_) busy += slot.id != 0 ? 1 : 0;
    count_.store(busy);
}

BaresipCalls::Slot* BaresipCalls::Find(int id) {
    if (id <= 0) return nullptr;
    for (Slot& slot : slots_) {
        if (slot.id == id) return &slot;
    }
    return nullptr;
}

const BaresipCalls::Slot* BaresipCalls::Find(int id) const {
    if (id <= 0) return nullptr;
    for (const Slot& slot : slots_) {
        if (slot.id == id) return &slot;
    }
    return nullptr;
}

BaresipCalls::Slot* BaresipCalls::Find(const struct call* call) {
    for (Slot& slot : slots_) {
        if (slot.id != 0 && slot.call == call) return &slot;
    }
    return nullptr;
}

BaresipCalls::Slot* BaresipCalls::FreeSlot() {
    for (Slot& slot : slots_) {
        if (slot.id == 0) return &slot;
    }
    return nullptr;
}

BaresipCalls::Slot* BaresipCalls::Other(const Slot& slot) {
    Slot* other = &slot == &slots_[0] ? &slots_[1] : &slots_[0];
    return other->id != 0 ? other : nullptr;
}

const BaresipCalls::Slot* BaresipCalls::Other(const Slot& slot) const {
    const Slot* other = &slot == &slots_[0] ? &slots_[1] : &slots_[0];
    return other->id != 0 ? other : nullptr;
}

void BaresipCalls::PostState(int id, CallState state, int code) {
    events_.Post([id, state, code](EngineListener& listener) { listener.OnCallState(id, state, code); });
}

void BaresipCalls::Log(int level, const std::string& line) const {
    if (log_) log_(level, line);
}

}  // namespace starsonic
