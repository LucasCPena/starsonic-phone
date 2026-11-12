#include "EngineCall.h"

#include <algorithm>
#include <iterator>
#include <string>
#include <utility>
#include <vector>

#include "EngineLog.h"
#include "RoomMosaic.h"

// A sala de vídeo em grupo na tabela das ligações (ver o topo do EngineCall.h): o RoomAdd (o nascimento e os convidados
// novos), a sala de agora (o RoomInfo, com os quadros do mosaico de quem montou), o OnRoom e o fim dela, e o Hangup do
// id da sala. Os ganchos da sala nos métodos de sempre (o Incoming, o Make, o StateChanged, o Ended, o Route, as
// pausas...) ficam no EngineCall.cpp e no EngineCallVideo.cpp. Sem o PJMEDIA_HAS_VIDEO (o Android) não há sala: o
// RoomAdd dá -1, e o resto nunca acha uma.

namespace starsonic {

int CallTable::RoomAdd(pj::Account& account, const std::string& uri) {
#if PJMEDIA_HAS_VIDEO
    EngineCall* call = nullptr;
    int callId = 0;
    bool born = false;        // a sala nasce deste convidado
    int activeBefore = 0;     // a ativa de antes do nascimento, que volta se ele não sai
    RoomInfo shownBefore;     // o último OnRoom de antes dele, que volta se ele não sai
    {
        std::lock_guard<std::mutex> lock(mutex_);
        Slot* base = nullptr;
        const char* reason = RoomAddRefusal(&base);
        if (reason) {
            Log(2, std::string("convidado da sala recusado: ") + reason);
            return -1;
        }
        shownBefore = roomShown_;
        if (roomId_ == 0) {
            // O nascimento: o id da sala vem antes do da ligação nova, e a ligação de agora é o primeiro convidado,
            // com o desejo da câmera dela. A sala é a ativa: o nosso som segue com ela.
            born = true;
            roomId_ = nextId_++;
            roomWish_ = base->wish;
            roomClosing_ = false;
            base->member = true;
            base->seat = FreeSeat();
            base->joined = ++joins_;
            activeBefore = activeId_;
            activeId_ = roomId_;
        }
        // A vaga fica com o convidado desde já. A oferta leva um vídeo, sendrecv, sem o askingVideo: um convidado que
        // responde sem o vídeo é um convidado sem vídeo, sem o refused. Nada vai para a espera.
        Slot* slot = FreeSlot();
        callId = nextId_++;
        call = new EngineCall(account, PJSUA_INVALID_ID, this);
        slot->call = call;
        slot->callId = callId;
        slot->member = true;
        slot->seat = FreeSeat();
        slot->joined = ++joins_;
        slot->videoCount = 1;
        ++alive_;
        // O OnRoom que traz o convidado (também o do nascimento) espera em held_ com o id dele, antes do makeCall: ele
        // sai antes do primeiro OnCallState da ligação, e some com os eventos dela se ela não sai.
        dialing_ = true;
        roomShown_ = CurrentRoom();
        const RoomInfo room = roomShown_;
        Emit(callId, [room](EngineListener& listener) { listener.OnRoom(room); });
    }
    bool made = true;
    try {
        pj::CallOpParam param(true);
        param.opt.videoCount = 1;
        call->makeCall(uri, param);
    } catch (const pj::Error& failure) {
        made = false;
        Log(2, "nao foi possivel ligar para o convidado da sala: " + failure.info());
    }
    bool unused = false;   // o pjsua não chegou a usar o objeto
    {
        std::lock_guard<std::mutex> lock(mutex_);
        dialing_ = false;
        std::vector<HeldEvent> held;
        held.swap(held_);
        // Como no Make: com a vaga ainda na tabela (pelo id), o Ended não apagou o objeto.
        Slot* slot = Find(callId);
        if (made) {
            if (slot) slot->pjsuaId = call->getId();
        } else {
            if (slot) {   // sem callback de fim: o objeto é nosso para apagar, e o convidado sai da sala
                *slot = Slot();
                unused = true;
            }
            roomShown_ = shownBefore;   // o OnRoom dele some, abaixo, com os outros eventos dele
        }
        for (HeldEvent& entry : held) {
            if (made || entry.callId != callId) events_->Post(std::move(entry.event));
        }
        // A sala depois do makeCall, atrás dos eventos dele: o que mudou no meio, ou o fim. A sala que não chegou a
        // nascer acaba quieta (o último OnRoom avisado não era dela), e a ativa volta a ser a de antes.
        PublishRoom();
        if (born && !made && roomId_ == 0) activeId_ = Find(activeBefore) ? activeBefore : 0;
        PublishVideo();
    }
    if (unused) {
        delete call;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            --alive_;
        }
        gone_.notify_all();
    }
    Route();
    ScheduleSync();
    return made ? callId : -1;
#else
    (void)account;
    (void)uri;
    return -1;
#endif
}

RoomInfo CallTable::Room() {
    std::lock_guard<std::mutex> lock(mutex_);
    return roomShown_;
}

std::vector<int> CallTable::CloseRoom(int callId) {
    std::vector<int> pjsuaIds;
    std::lock_guard<std::mutex> lock(mutex_);
    if (callId == 0 || callId != roomId_) return pjsuaIds;
    // A sala fecha: o fim de cada convidado só a arruma, e ela acaba sem ninguém (PublishRoom).
    roomClosing_ = true;
    for (const Slot& slot : slots_) {
        if (slot.callId != 0 && slot.member && slot.pjsuaId != PJSUA_INVALID_ID) pjsuaIds.push_back(slot.pjsuaId);
    }
    return pjsuaIds;
}

int CallTable::Members() {
    int count = 0;
    for (const Slot& slot : slots_) count += slot.callId != 0 && slot.member ? 1 : 0;
    return count;
}

int CallTable::FreeSeat() {
    for (int seat = 1; seat <= kRoomMaxGuests; ++seat) {
        const bool taken = std::any_of(std::begin(slots_), std::end(slots_), [seat](const Slot& slot) {
            return slot.callId != 0 && slot.member && slot.seat == seat;
        });
        if (!taken) return seat;
    }
    return 0;
}

const char* CallTable::RoomAddRefusal(Slot** base) {
    *base = nullptr;
    if (closed_) return "o motor esta saindo";
    if (!VideoEnabled(settings_)) return "nenhum codec de video nas escolhas";
    if (roomId_ != 0) {
        if (roomClosing_) return "a sala esta acabando";
        if (activeId_ != roomId_) return "voce esta fora da sala";
        if (Members() >= kRoomMaxGuests) return "a sala esta cheia";
        return FreeSlot() ? nullptr : "nenhuma vaga livre";
    }
    // Sem sala, ela nasce da ligação de agora: a única, confirmada, com o vídeo negociado, fora da espera, da
    // conferência e de uma transferência.
    if (Occupied() != 1) return Occupied() == 0 ? "nenhuma ligacao" : "mais de uma ligacao";
    Slot* call = nullptr;
    for (Slot& slot : slots_) {
        if (slot.callId != 0) call = &slot;
    }
    if (!call->confirmed) return "a ligacao nao foi confirmada";
    if (!call->videoUp) return "a ligacao nao tem video";
    if (call->held) return "a ligacao esta em espera";
    if (conference_) return "a ligacao esta na conferencia";
    if (call->transferring || call->transferTarget != 0) return "a ligacao tem uma transferencia em andamento";
    *base = call;
    return nullptr;
}

RoomInfo CallTable::CurrentRoom() {
    RoomInfo room;
#if PJMEDIA_HAS_VIDEO
    if (roomId_ == 0) return room;
    std::vector<const Slot*> members;
    for (const Slot& slot : slots_) {
        if (slot.callId != 0 && slot.member) members.push_back(&slot);
    }
    std::sort(members.begin(), members.end(), [](const Slot* a, const Slot* b) { return a->joined < b->joined; });
    // O mosaico de quem montou tem todos os convidados, também os chamados, na ordem de entrada.
    const std::vector<PixelRect> cells =
        MosaicCells(static_cast<int>(members.size()), kHostMosaicWidth, kHostMosaicHeight);
    room.id = roomId_;
    for (size_t index = 0; index < members.size(); ++index) {
        const Slot& slot = *members[index];
        RoomMember member;
        member.callId = slot.callId;
        member.state = !slot.confirmed ? RoomMember::State::Calling
                       : slot.remoteHold ? RoomMember::State::Held
                                         : RoomMember::State::In;
        member.image = Current(slot).remote;
        if (index < cells.size()) member.tile = UnitTile(cells[index], kHostMosaicWidth, kHostMosaicHeight);
        room.members.push_back(member);
    }
    room.out = activeId_ != roomId_;
    room.full = static_cast<int>(members.size()) >= kRoomMaxGuests;
#endif
    return room;
}

void CallTable::PublishRoom() {
#if PJMEDIA_HAS_VIDEO
    if (roomId_ == 0 || dialing_) return;
    const int members = Members();
    if (roomClosing_ ? members > 0 : members >= 2) {
        const RoomInfo room = CurrentRoom();
        if (room == roomShown_) return;
        roomShown_ = room;
        Emit(roomId_, [room](EngineListener& listener) { listener.OnRoom(room); });
        return;
    }
    // O fim: o último OnRoom, com quem ficou (fechando, ninguém), se o último avisado era desta sala.
    RoomInfo last = CurrentRoom();
    last.ended = true;
    const bool announce = roomShown_.id == roomId_;
    // Quem ficou volta a ser uma ligação comum, com o desejo da câmera da sala, e é a ativa se a sala era a ativa.
    for (Slot& slot : slots_) {
        if (slot.callId == 0 || !slot.member) continue;
        slot.member = false;
        slot.seat = 0;
        slot.joined = 0;
        slot.wish = roomWish_;
        if (activeId_ == roomId_) activeId_ = slot.callId;
    }
    if (activeId_ == roomId_) activeId_ = 0;
    const int roomId = roomId_;
    roomId_ = 0;
    roomWish_ = false;
    roomClosing_ = false;
    roomShown_ = RoomInfo();
    if (announce) Emit(roomId, [last](EngineListener& listener) { listener.OnRoom(last); });
#endif
}

}  // namespace starsonic
