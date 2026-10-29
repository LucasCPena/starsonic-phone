#include "BaresipCalls.h"

#include <cerrno>
#include <cstdint>
#include <string>
#include <utility>

#include "EngineEvents.h"

namespace starsonic {
namespace {

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

BaresipCalls::BaresipCalls(EventQueue& events, BaresipLoop::LogSink log, DtmfMethod /*dtmf*/)
    : events_(events), log_(std::move(log)) {}

void BaresipCalls::OnEvent(enum bevent_ev ev, struct bevent* event) {
    if (ev == BEVENT_SIPSESS_CONN) {
        OnInvite(bevent_get_msg(event));
        return;
    }
    struct call* call = bevent_get_call(event);
    Slot* slot = call ? Find(call) : nullptr;
    if (!slot) return;   // uma que já saiu daqui (End) ou que nunca entrou (o baresip a recusou)
    switch (ev) {
        case BEVENT_CALL_RINGING:
        case BEVENT_CALL_PROGRESS:
            if (!slot->incoming && !slot->confirmed) PostState(slot->id, CallState::Early, ProgressCode(call));
            break;
        case BEVENT_CALL_ESTABLISHED:
            // A feita: o 200 chegou e o ACK saiu. A recebida: o ACK chegou (o Connecting saiu no Answer).
            if (slot->confirmed) break;
            slot->confirmed = true;
            if (!slot->incoming) PostState(slot->id, CallState::Connecting, 200);
            PostState(slot->id, CallState::Confirmed, 200);
            break;
        case BEVENT_CALL_CLOSED: {
            const int id = slot->id;
            const int code = EndCode(*slot, call, bevent_get_text(event));
            Free(*slot);   // antes do aviso: o Count cai antes de o Disconnected chegar ao listener
            PostState(id, CallState::Disconnected, code);
            break;
        }
        default:
            break;
    }
}

int BaresipCalls::Make(struct ua* ua, const std::string& uri) {
    Slot* slot = FreeSlot();
    const Slot* other = slot ? Other(*slot) : nullptr;
    if (!slot || (other && !other->confirmed)) {
        Log(2, "ligacao para " + uri + " recusada: " +
                   (slot ? "a outra ligacao nao foi confirmada" : "ja ha duas ligacoes"));
        return -1;
    }
    struct call* call = nullptr;
    const int err = ua_connect(ua, &call, nullptr, uri.c_str(), VIDMODE_OFF);
    if (err) {
        Log(2, "nao foi possivel ligar para " + uri + ": " + BaresipLoop::ErrorText(err));
        return -1;
    }
    // Nenhuma resposta é lida antes de o Run acabar: o Calling vem antes de qualquer outro estado da ligação.
    Bind(*slot, call, false);
    PostState(slot->id, CallState::Calling, 0);
    return slot->id;
}

bool BaresipCalls::Answer(int id) {
    Slot* slot = Find(id);
    if (!slot || !slot->incoming || slot->answered) return false;
    const int err = call_answer(slot->call, 200, VIDMODE_OFF);
    if (err) {
        Log(2, "nao foi possivel atender a ligacao: " + BaresipLoop::ErrorText(err));
        return false;
    }
    slot->answered = true;
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

int BaresipCalls::Count() const { return count_.load(); }

std::vector<int> BaresipCalls::AudioLinks(int id) const {
    const Slot* slot = Find(id);
    if (!slot || !slot->confirmed) return std::vector<int>();
    return std::vector<int>{0};
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
    Free(slot);   // o BEVENT_CALL_CLOSED que o ua_hangup avisa, logo abaixo, já não acha a ligação
    // A recebida que toca recebe a recusa com o código; nas outras, o baresip manda o CANCEL ou o BYE, e a libre
    // termina o pedido sozinha depois que a ligação sai (o ua_hangup a solta).
    ua_hangup(call_get_ua(call), call, static_cast<uint16_t>(code), ReasonOf(code));
    if (report) PostState(id, CallState::Disconnected, code);
}

int BaresipCalls::HangupCode(const Slot& slot) const {
    if (slot.incoming) return slot.answered ? 200 : 603;   // o BYE, ou a recusa da que toca
    return slot.confirmed ? 200 : 487;                     // o BYE, ou o CANCEL da que chama
}

int BaresipCalls::EndCode(const Slot& slot, const struct call* call, const char* text) const {
    if (slot.confirmed) return 200;                        // o BYE de qualquer lado
    if (slot.incoming && !slot.answered) return 487;       // o CANCEL de quem liga (a libre respondeu 487)
    const uint16_t scode = call_scode(call);
    if (!slot.incoming && scode >= 300) return scode;      // a feita recusada: a resposta final
    // Sem resposta final (a feita, ou a recebida atendida sem o ACK), como no motor do PJSIP: 408 com o tempo esgotado,
    // 503 nos outros erros (os de transporte). O motivo que o baresip dá é o %m do erro, às vezes seguido do Reason.
    const std::string timeout = BaresipLoop::ErrorText(ETIMEDOUT);
    return text && std::string(text).compare(0, timeout.size(), timeout) == 0 ? 408 : 503;
}

void BaresipCalls::Bind(Slot& slot, struct call* call, bool incoming) {
    slot = Slot();
    slot.call = call;
    slot.id = nextId_++;
    slot.incoming = incoming;
    Recount();
}

void BaresipCalls::Free(Slot& slot) {
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
