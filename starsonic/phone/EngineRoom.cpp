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
// id da sala. E os mosaicos: quem manda o lugar dele, o vídeo da sala, o plano de cada mosaico e a prévia do mosaico de
// quem montou. Os ganchos da sala nos métodos de sempre (o Incoming, o Make, o StateChanged, o Ended, o Route, as
// pausas, o SyncVideo...) ficam no EngineCall.cpp e no EngineCallVideo.cpp. Sem o PJMEDIA_HAS_VIDEO (o Android) não há
// sala: o RoomAdd dá -1, e o resto nunca acha uma.

namespace starsonic {
#if PJMEDIA_HAS_VIDEO
namespace {

// O texto de um código do PJSIP, como no EngineCall.cpp.
std::string StatusText(pj_status_t status) { return pj::Endpoint::instance().utilStrError(status); }

}  // namespace
#endif

int CallTable::RoomAdd(pj::Account& account, const std::string& uri) {
#if PJMEDIA_HAS_VIDEO
    EngineCall* call = nullptr;
    int callId = 0;
    bool born = false;        // a sala nasce deste convidado
    int activeBefore = 0;     // a ativa de antes do nascimento, que volta se ele não sai
    int receiveOnlyBase = 0;  // a ligação de onde ela nasce, se o vídeo dela só recebe: o re-INVITE sendrecv
    RoomInfo arriving;        // o OnRoom que o traz: o Room() só o mostra se ele sai
    {
        std::lock_guard<std::mutex> lock(mutex_);
        Slot* base = nullptr;
        const char* reason = RoomAddRefusal(&base);
        if (reason) {
            Log(2, std::string("convidado da sala recusado: ") + reason);
            return -1;
        }
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
            // Sem câmera, o vídeo dela só recebe, e o pjsua guarda essa direção nas próximas ofertas: sem o re-INVITE,
            // ela nunca mandaria o mosaico dela.
            if (base->receiveOnly) receiveOnlyBase = base->callId;
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
        // sai antes do primeiro OnCallState da ligação, e some com os eventos dela se ela não sai. Até lá, o roomShown_
        // (e o Room()) segue com a sala que o listener conhece.
        dialing_ = true;
        arriving = CurrentRoom();
        Emit(callId, [arriving](EngineListener& listener) { listener.OnRoom(arriving); });
    }
    {
        // O alvo da qualidade com ele (ele já conta), antes do makeCall: a ligação dele nasce nele, sem re-INVITE por
        // esta mudança, e o SyncVideo do fim manda o de quem já estava.
        std::lock_guard<std::mutex> videoLock(videoMutex_);
        ApplyQuality();
        std::lock_guard<std::mutex> lock(mutex_);
        Slot* slot = Find(callId);
        if (slot) slot->qualitySerial = qualitySerial_;
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
    // O fim de todo makeCall (FinishDial) avisa a sala depois dele: o que mudou no meio, ou o fim dela.
    FinishDial(call, callId, made, [&](Slot*) {
        if (made) {
            roomShown_ = arriving;   // o OnRoom dele saiu, com os outros eventos dele
            return;
        }
        // O OnRoom dele sumiu com os outros eventos dele: a sala que não chegou a nascer acaba quieta (o último OnRoom
        // avisado não era dela), com a ativa de antes, e a que já estava de pé segue como o listener a conhece.
        if (born) activeId_ = Find(activeBefore) ? activeBefore : 0;
    });
    if (made && receiveOnlyBase != 0) SendReceive(receiveOnlyBase);
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

std::vector<const CallTable::Slot*> CallTable::MembersInOrder() {
    std::vector<const Slot*> members;
    for (const Slot& slot : slots_) {
        if (slot.callId != 0 && slot.member) members.push_back(&slot);
    }
    std::sort(members.begin(), members.end(), [](const Slot* a, const Slot* b) { return a->joined < b->joined; });
    return members;
}

RoomInfo CallTable::CurrentRoom() {
    RoomInfo room;
#if PJMEDIA_HAS_VIDEO
    if (roomId_ == 0) return room;
    const std::vector<const Slot*> members = MembersInOrder();
    // O mosaico de quem montou tem todos os convidados, também os chamados, na ordem de entrada (a mesma do plano dele,
    // no PlanRoom).
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
    // Durante um makeCall nada é avisado (o FinishDial avisa depois); o plano dos mosaicos, sempre.
    if (roomId_ != 0 && !dialing_) AnnounceRoom();
    PlanRoom();
#endif
}

#if PJMEDIA_HAS_VIDEO
void CallTable::AnnounceRoom() {
    const int members = Members();
    if (roomClosing_ ? members > 0 : members >= 2) {
        const RoomInfo room = CurrentRoom();
        if (!(room == roomShown_)) {
            roomShown_ = room;
            Emit(roomId_, [room](EngineListener& listener) { listener.OnRoom(room); });
        }
        // O vídeo da sala, sempre atrás de um OnRoom dela.
        const CallVideo video = CurrentRoomVideo();
        if (!(video == roomVideoShown_)) {
            roomVideoShown_ = video;
            const int roomId = roomId_;
            Emit(roomId, [roomId, video](EngineListener& listener) { listener.OnCallVideo(roomId, video); });
        }
    } else {
        // O fim: o último OnRoom, com quem ficou (fechando, ninguém), se o último avisado era desta sala, e antes dele
        // o fim do vídeo da sala.
        RoomInfo last = CurrentRoom();
        last.ended = true;
        const bool announce = roomShown_.id == roomId_;
        const bool videoShown = !(roomVideoShown_ == CallVideo());
        // Quem ficou volta a ser uma ligação comum, com o desejo da câmera da sala, e é a ativa se a sala era a ativa.
        // A qualidade dela volta à escolhida: o SyncVideo ainda confere o codificador dela uma vez
        // (ReinviteForQuality).
        for (Slot& slot : slots_) {
            if (slot.callId == 0 || !slot.member) continue;
            slot.member = false;
            slot.seat = 0;
            slot.joined = 0;
            slot.wish = roomWish_;
            slot.stayed = true;
            if (activeId_ == roomId_) activeId_ = slot.callId;
        }
        if (activeId_ == roomId_) activeId_ = 0;
        const int roomId = roomId_;
        roomId_ = 0;
        roomWish_ = false;
        roomClosing_ = false;
        roomShown_ = RoomInfo();
        roomRemote_ = false;
        roomVideoShown_ = CallVideo();
        if (announce && videoShown) {
            Emit(roomId, [roomId](EngineListener& listener) { listener.OnCallVideo(roomId, CallVideo()); });
        }
        if (announce) Emit(roomId, [last](EngineListener& listener) { listener.OnRoom(last); });
    }
}

bool CallTable::RoomMosaic() {
    if (roomId_ == 0) return false;
    int answered = 0;
    for (const Slot& slot : slots_) answered += slot.callId != 0 && slot.member && slot.confirmed ? 1 : 0;
    return answered >= 2;
}

bool CallTable::SendsSeat(const Slot& slot) {
    return slot.member && slot.confirmed && slot.videoUp && slot.canSend && RoomMosaic();
}

bool CallTable::RoomCameraWanted() {
    return RoomMosaic() && roomWish_ && !cameraPaused_ && activeId_ == roomId_;
}

CallVideo CallTable::CurrentRoomVideo() {
    CallVideo video;
    if (roomId_ == 0) return video;
    video.active = true;
    video.remote = roomRemote_;
    // A nossa câmera chegando aos convidados: no mosaico de algum que o recebe, com a prévia dela aberta para a sala;
    // ou, com um convidado só, direto na ligação dele (o camera dela).
    const bool mosaic = RoomMosaic();
    const bool cameraOpen = previewRunning_ && !cameraLost_ && RoomCameraWanted();
    for (const Slot& slot : slots_) {
        if (slot.callId == 0 || !slot.member || !slot.sending) continue;
        if (mosaic ? slot.seatSending && cameraOpen && SendsSeat(slot) : !slot.seatSending && WantsToSend(slot)) {
            video.camera = true;
        }
    }
    return video;
}

void CallTable::PlanRoom() {
    RoomPlan plan;
    if (roomId_ != 0) {
        const std::vector<const Slot*> members = MembersInOrder();
        // O mosaico de quem montou tem todos, também os chamados, na ordem de entrada: o tile de cada um no OnRoom
        // (CurrentRoom) é o quadro dele aqui.
        std::vector<int> answered;   // os que já atenderam, também os em espera, na ordem de entrada
        for (const Slot* slot : members) {
            plan.host.push_back(slot->callId);
            if (!slot->confirmed) continue;
            answered.push_back(slot->callId);
            // A imagem dele vale estando na sala (In) e chegando (o remote); senão, o fundo.
            if (!slot->remoteHold && Current(*slot).remote) plan.live.insert(slot->callId);
        }
        // O de cada convidado: a nossa câmera primeiro e os outros que já atenderam, sem ele.
        for (const Slot* slot : members) {
            if (slot->seat >= 1 && slot->seat <= kRoomMaxGuests) {
                plan.seats[slot->seat - 1] = GuestTiles(answered, slot->callId);
            }
        }
        if (RoomCameraWanted()) plan.live.insert(kHostTile);
    }
    if (plan == plan_) return;
    plan_ = plan;
    SetRoomPlan(plan_);
}

bool CallTable::SyncHostMosaic(bool restart, pjmedia_vid_dev_index host) {
    int roomId = 0;
    int bound = 0;
    pjmedia_vid_dev_index opened = PJMEDIA_VID_INVALID_DEV;
    pjmedia_vid_dev_index renderer = PJMEDIA_VID_INVALID_DEV;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        roomId = roomId_;
        bound = hostRoom_;
        opened = hostDevice_;
        renderer = renderer_;
        if (roomId == 0) hostFailed_ = false;
    }
    // A prévia fecha pelo id com que abriu (a pjsua acha a janela por ele, também depois de uma releitura): sem a sala,
    // com outra sala ou na passada da releitura.
    if (bound != 0 && (roomId != bound || restart)) {
        const pj_status_t status = pjsua_vid_preview_stop(opened);
        if (status != PJ_SUCCESS) Log(2, "parar o mosaico da sala: " + StatusText(status));
        UnbindRendererCall(bound);   // um quadro atrasado dele não sai mais
        std::lock_guard<std::mutex> lock(mutex_);
        hostRoom_ = 0;
        hostDevice_ = PJMEDIA_VID_INVALID_DEV;
        bound = 0;
    }
    // A loja só guarda imagens com a sala de pé (o tap é só daqui, com o motor de pé).
    SetRendererTap(roomId != 0 ? RoomFrameStore() : nullptr);
    if (roomId == 0 || bound != 0 || restart) return true;
    // O lugar 0 no desenhista nosso, à vista (a pjsua só liga a captura ao desenhista assim), em 1280x720 a 25 qps.
    pj_status_t status = PJMEDIA_EVID_NODEFDEV;
    if (host != PJMEDIA_VID_INVALID_DEV) {
        pjsua_vid_preview_param param;
        pjsua_vid_preview_param_default(&param);
        if (renderer != PJMEDIA_VID_INVALID_DEV) param.rend_id = renderer;
        param.show = PJ_TRUE;
        pjmedia_format_init_video(&param.format, PJMEDIA_FORMAT_I420, static_cast<unsigned>(kHostMosaicWidth),
                                  static_cast<unsigned>(kHostMosaicHeight), static_cast<unsigned>(kHostMosaicFps), 1);
        status = pjsua_vid_preview_start(host, &param);
    }
    if (status != PJ_SUCCESS) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!hostFailed_) Log(2, "o mosaico da sala nao abriu: " + StatusText(status));
        hostFailed_ = true;
        return false;
    }
    // Os quadros da janela dele saem com o id da sala.
    const pjsua_vid_win_id window = pjsua_vid_preview_get_win(host);
    pjsua_vid_win_info info;
    if (window != PJSUA_INVALID_ID && pjsua_vid_win_get_info(window, &info) == PJ_SUCCESS) {
        BindRendererStream(info.hwnd.info.window, roomId);
    } else {
        Log(2, "o mosaico da sala ficou sem a janela do desenhista");
    }
    std::lock_guard<std::mutex> lock(mutex_);
    hostRoom_ = roomId;
    hostDevice_ = host;
    hostFailed_ = false;
    return true;
}

void CallTable::SendReceive(int callId) {
    bool found = true;   // a ligação seguia na sala, só recebendo, com o id no pjsua, em cada tentativa
    const pj_status_t status = RetryWhileRenegotiating([&]() -> pj_status_t {
        int pjsuaId = PJSUA_INVALID_ID;
        unsigned videoCount = 0;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            Slot* slot = Find(callId);
            if (slot && slot->member && slot->receiveOnly && slot->pjsuaId != PJSUA_INVALID_ID) {
                pjsuaId = slot->pjsuaId;
                videoCount = slot->videoCount;
                slot->askingSendRecv = true;   // antes do re-INVITE: a resposta pode chegar antes de o pjsua voltar
            }
        }
        if (pjsuaId == PJSUA_INVALID_ID) {
            found = false;
            return PJ_ENOTFOUND;
        }
        // Todas as mídias com a direção de fábrica (sendrecv): o pjsua a guarda para as próximas ofertas e respostas.
        pjsua_call_setting setting;
        pjsua_call_setting_default(&setting);
        setting.flag |= PJSUA_CALL_SET_MEDIA_DIR;
        setting.vid_cnt = videoCount;
        const pj_status_t result = pjsua_call_reinvite2(pjsuaId, &setting, nullptr);
        std::lock_guard<std::mutex> lock(mutex_);
        Slot* slot = Find(callId);
        if (slot && result == PJ_SUCCESS) {
            slot->receiveOnly = false;
        } else if (slot) {
            slot->askingSendRecv = false;
        }
        return result;
    });
    if (found && status != PJ_SUCCESS) Log(2, "o envio do mosaico da sala: " + StatusText(status));
}

QualityValues CallTable::TargetQuality() {
    // A ligação de fora não conta: só os convidados, também os chamados.
    return roomId_ != 0 ? RoomQuality(settings_.quality, Members()) : ValuesOf(settings_.quality);
}

bool CallTable::ReinviteForQuality() {
    std::vector<std::pair<int, int>> calls;   // o id e o id no pjsua de cada uma que recebe o re-INVITE
    int serial = 0;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (closed_) return false;
        serial = qualitySerial_;
        for (Slot& slot : slots_) {
            if (slot.callId == 0 || !(slot.member || slot.stayed)) continue;
            // Chamando ou sem o vídeo, nada a refazer: o stream dela nasce com os parâmetros de quando ela atender.
            const bool encoderOff = slot.width != quality_.width || slot.height != quality_.height ||
                                    slot.fps != quality_.fps;
            if (slot.confirmed && slot.videoUp && slot.pjsuaId != PJSUA_INVALID_ID && slot.qualitySerial != serial &&
                encoderOff) {
                calls.emplace_back(slot.callId, slot.pjsuaId);
            } else {
                slot.stayed = false;   // a que ficou segue como uma ligação comum
                slot.reinviteBusySince = {};
            }
        }
    }
    // O re-INVITE com o vídeo, sem esperar: a pjsua refaz o stream, porque o codificador dos parâmetros de agora é
    // outro.
    std::vector<pj_status_t> results;
    for (const auto& call : calls) {
        pjsua_call_setting setting;
        pjsua_call_setting_default(&setting);
        setting.vid_cnt = 1;
        results.push_back(pjsua_call_reinvite2(call.second, &setting, nullptr));
    }
    bool busy = false;
    const auto now = std::chrono::steady_clock::now();
    std::lock_guard<std::mutex> lock(mutex_);
    for (size_t index = 0; index < calls.size(); ++index) {
        Slot* slot = Find(calls[index].first);
        if (!slot) continue;
        const pj_status_t result = results[index];
        if (result == PJ_EINVALIDOP) {
            // Outro re-INVITE em andamento na ligação: a passada de daqui a pouco tenta de novo, até
            // kRenegotiationWaitMs depois do primeiro que o encontrou (o tempo do RetryWhileRenegotiating). Depois, ela
            // fica para a próxima mudança do alvo.
            if (slot->reinviteBusySince == std::chrono::steady_clock::time_point()) slot->reinviteBusySince = now;
            if (now - slot->reinviteBusySince < std::chrono::milliseconds(kRenegotiationWaitMs)) {
                busy = true;
                continue;
            }
            Log(2, "o re-INVITE da qualidade da sala ficou para a proxima mudanca: outro re-INVITE nao terminou");
        } else if (result != PJ_SUCCESS) {
            Log(2, "o re-INVITE da qualidade da sala: " + StatusText(result));
        }
        slot->qualitySerial = serial;   // um por mudança do alvo, também o que não saiu
        slot->stayed = false;
        slot->reinviteBusySince = {};
    }
    return busy;
}
#endif

}  // namespace starsonic
