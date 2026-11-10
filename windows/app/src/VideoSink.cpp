#include "VideoSink.h"

#include <algorithm>
#include <utility>

namespace starsonic {

namespace {

const ViewName kViews[] = {ViewName::Remoto, ViewName::Local, ViewName::Porteiro};

// A vista e da pagina do aviso (o porteiro) ou da janela principal (o remoto e o local).
bool NoticeView(ViewName view) { return view == ViewName::Porteiro; }

}  // namespace

VideoSink::VideoSink(SharedMemoryPages& pages, std::function<int64_t()> nowMs)
    : pages_(pages), nowMs_(std::move(nowMs)) {}

VideoSink::Slot& VideoSink::SlotOf(ViewName view) { return slots_[static_cast<int>(view)]; }

void VideoSink::SetRouteState(const RouteState& state) {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (closed_) return;
        // A memoria nao leva o id da ligacao: quando a ligacao de uma vista muda (ou acaba), a vista esvazia aqui, com a
        // trava (nenhum quadro no meio), e a pagina nunca mostra o ultimo quadro da ligacao de antes na vista da
        // proxima. O local (a nossa camera) esvazia quando deixa de receber quadros (escondido ou minimizado): a
        // proxima vez que ele aparece comeca vazio.
        if (state.topCallId != state_.topCallId) ClearView(ViewName::Remoto);
        if (state.noticeCallId != state_.noticeCallId) ClearView(ViewName::Porteiro);
        if (!RouteLocal(state_).empty() && RouteLocal(state).empty()) ClearView(ViewName::Local);
        state_ = state;
    }
    GiveMemories(true);
}

void VideoSink::ClearView(ViewName view) {
    Slot& slot = SlotOf(view);
    if (slot.writer) slot.writer->Clear();
}

void VideoSink::PageReady(bool noticePage) {
    std::vector<ViewName> ready;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (closed_) return;
        for (ViewName view : kViews) {
            if (NoticeView(view) == noticePage && SlotOf(view).memory) ready.push_back(view);
        }
    }
    for (ViewName view : ready) pages_.Post(view);
}

void VideoSink::BrowserRestarted() {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (closed_) return;
        DropMemories();
    }
    // As memorias do ambiente velho saem so depois de nenhum quadro poder chegar a elas.
    pages_.ReleaseAll();
    GiveMemories(false);
}

void VideoSink::Close() {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (closed_) return;
        closed_ = true;
        DropMemories();
    }
    pages_.ReleaseAll();
}

void VideoSink::DropMemories() {
    for (Slot& slot : slots_) slot = Slot();
}

void VideoSink::GiveMemories(bool post) {
    std::vector<ViewName> missing;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (closed_) return;
        for (ViewName view : state_.visible) {
            if (!SlotOf(view).memory) missing.push_back(view);
        }
    }
    // O Create e o Post sem a trava (os quadros nunca esperam o WebView2). So a thread da janela muda as memorias: a
    // vista continua sem memoria ate ela ganhar a sua aqui.
    for (ViewName view : missing) {
        uint8_t* memory = pages_.Create(view, FrameBufferBytes());
        if (!memory) continue;   // fica sem memoria: o proximo SetRouteState (ou o navegador refeito) tenta de novo
        {
            std::lock_guard<std::mutex> lock(mutex_);
            Slot& slot = SlotOf(view);
            slot = Slot();   // o credito comeca cheio com a memoria nova
            slot.memory = memory;
            slot.writer.emplace(memory, FrameBufferBytes());   // o cabecalho vazio: a marca e o seq 0
        }
        if (post) pages_.Post(view);
    }
}

void VideoSink::Write(const std::vector<ViewName>& views, const I420Frame& frame, int64_t now) {
    for (ViewName view : views) {
        Slot& slot = SlotOf(view);
        if (!slot.writer) continue;   // a vista sem memoria: o quadro e descartado
        if (slot.lastMs) {
            // O tempo desde o quadro anterior (o relogio que volta conta 0), cortado em 2000 ms antes da conta: bem mais
            // que os 67 ms que enchem o credito, e a multiplicacao nunca estoura.
            const int64_t elapsed = std::min<int64_t>(std::max<int64_t>(0, now - *slot.lastMs), 2000);
            slot.credit = std::min(kMaxCredit, slot.credit + elapsed * kCreditPerMs);
        }
        slot.lastMs = now;
        if (slot.credit < kFrameCost) continue;   // mais de 30 quadros por segundo: descartado
        if (slot.writer->Write(frame)) slot.credit -= kFrameCost;
    }
}

void VideoSink::OnRemoteFrame(int callId, const I420Frame& frame) {
    const int64_t now = nowMs_ ? nowMs_() : 0;
    std::lock_guard<std::mutex> lock(mutex_);
    Write(RouteRemote(state_, callId), frame, now);
}

void VideoSink::OnLocalFrame(const I420Frame& frame) {
    const int64_t now = nowMs_ ? nowMs_() : 0;
    std::lock_guard<std::mutex> lock(mutex_);
    Write(RouteLocal(state_), frame, now);
}

}  // namespace starsonic
