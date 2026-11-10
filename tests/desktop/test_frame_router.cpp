// Para onde vai cada quadro do video (windows/app/src/FrameRouter.h): a imagem da outra ponta vai a vista remoto da
// janela principal ou a do porteiro do aviso, e a da nossa camera a vista local. C++ portatil: roda tambem no Linux.
#include <string>
#include <vector>

#include "FrameRouter.h"
#include "test_support.h"

using namespace starsonic;

namespace {

const std::vector<ViewName> kNone;

RouteState AllVisible() {
    RouteState state;
    state.visible = {ViewName::Remoto, ViewName::Local, ViewName::Porteiro};
    return state;
}

}  // namespace

TEST_CASE("a remote frame of the top call goes to the visible remote view") {
    RouteState state = AllVisible();
    state.topCallId = 7;
    CHECK(RouteRemote(state, 7) == std::vector<ViewName>{ViewName::Remoto});
    // So o remoto a vista: o mesmo.
    state.visible = {ViewName::Remoto};
    CHECK(RouteRemote(state, 7) == std::vector<ViewName>{ViewName::Remoto});
}

TEST_CASE("a frame of an unknown or ended call goes nowhere") {
    RouteState state = AllVisible();
    state.topCallId = 7;
    state.noticeCallId = 8;
    CHECK(RouteRemote(state, 42) == kNone);
    // Sem nenhuma ligacao (os dois ids 0): a ligacao que acabou nao alimenta nenhuma vista.
    CHECK(RouteRemote(AllVisible(), 42) == kNone);
    // O id 0 e nenhuma ligacao: nunca casa com o topCallId ou o noticeCallId vazios.
    CHECK(RouteRemote(AllVisible(), 0) == kNone);
}

TEST_CASE("the ringing call in the notice feeds the doorphone view even minimized") {
    RouteState state;
    state.visible = {ViewName::Porteiro};
    state.noticeCallId = 9;
    state.minimized = true;
    CHECK(RouteRemote(state, 9) == std::vector<ViewName>{ViewName::Porteiro});
    state.minimized = false;
    CHECK(RouteRemote(state, 9) == std::vector<ViewName>{ViewName::Porteiro});
    // A de cima tocando (a mesma nas duas paginas): as duas vistas; minimizada, so a do aviso.
    state = AllVisible();
    state.topCallId = 9;
    state.noticeCallId = 9;
    CHECK(RouteRemote(state, 9) == std::vector<ViewName>{ViewName::Remoto, ViewName::Porteiro});
    state.minimized = true;
    CHECK(RouteRemote(state, 9) == std::vector<ViewName>{ViewName::Porteiro});
    // A segunda tocando com a de cima em andamento: cada uma na sua vista.
    state = AllVisible();
    state.topCallId = 7;
    state.noticeCallId = 9;
    CHECK(RouteRemote(state, 7) == std::vector<ViewName>{ViewName::Remoto});
    CHECK(RouteRemote(state, 9) == std::vector<ViewName>{ViewName::Porteiro});
}

TEST_CASE("hidden views and a minimized window get no frames") {
    RouteState state;
    state.topCallId = 7;
    state.noticeCallId = 8;
    // Nenhuma vista a vista.
    CHECK(RouteRemote(state, 7) == kNone);
    CHECK(RouteRemote(state, 8) == kNone);
    CHECK(RouteLocal(state) == kNone);
    // O remoto e o local a vista, mas a janela minimizada (ou na bandeja).
    state.visible = {ViewName::Remoto, ViewName::Local};
    state.minimized = true;
    CHECK(RouteRemote(state, 7) == kNone);
    CHECK(RouteLocal(state) == kNone);
    // A recebida tocando sem a vista do porteiro: nada, tambem sem minimizar.
    state.minimized = false;
    CHECK(RouteRemote(state, 8) == kNone);
    // So o porteiro a vista: a de cima nao vai a ele.
    state.visible = {ViewName::Porteiro};
    CHECK(RouteRemote(state, 7) == kNone);
}

TEST_CASE("the local frame goes to the local view only when visible and not minimized") {
    RouteState state;
    state.visible = {ViewName::Local};
    CHECK(RouteLocal(state) == std::vector<ViewName>{ViewName::Local});
    // Sem ligacao tambem (o teste da camera).
    CHECK(state.topCallId == 0);
    state.minimized = true;
    CHECK(RouteLocal(state) == kNone);
    state.minimized = false;
    state.visible = {ViewName::Remoto, ViewName::Porteiro};
    CHECK(RouteLocal(state) == kNone);
}

TEST_CASE("the views have the bridge names") {
    CHECK(std::string(ViewKey(ViewName::Remoto)) == "remoto");
    CHECK(std::string(ViewKey(ViewName::Local)) == "local");
    CHECK(std::string(ViewKey(ViewName::Porteiro)) == "porteiro");
}
