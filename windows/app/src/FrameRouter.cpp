#include "FrameRouter.h"

namespace starsonic {

namespace {

bool Shown(const RouteState& state, ViewName view) { return state.visible.count(view) != 0; }

}  // namespace

const char* ViewKey(ViewName view) {
    switch (view) {
        case ViewName::Remoto:
            return "remoto";
        case ViewName::Local:
            return "local";
        case ViewName::Porteiro:
            return "porteiro";
    }
    return "";
}

std::vector<ViewName> RouteRemote(const RouteState& state, int callId) {
    std::vector<ViewName> views;
    if (callId <= 0) return views;   // nenhuma ligacao: nunca casa com um topCallId ou noticeCallId vazio
    if (callId == state.topCallId && Shown(state, ViewName::Remoto) && !state.minimized) {
        views.push_back(ViewName::Remoto);
    }
    if (callId == state.noticeCallId && Shown(state, ViewName::Porteiro)) views.push_back(ViewName::Porteiro);
    return views;
}

std::vector<ViewName> RouteLocal(const RouteState& state) {
    std::vector<ViewName> views;
    if (Shown(state, ViewName::Local) && !state.minimized) views.push_back(ViewName::Local);
    return views;
}

}  // namespace starsonic
