#pragma once
// Para onde vai cada quadro do video (spec da videochamada, 6.4; docs/ponte-windows.md, "A memoria do video"): a
// imagem da outra ponta vai a vista remoto da janela principal (a ligacao de cima) ou a do porteiro do aviso (a
// recebida tocando), e a da nossa camera a vista local. C++ portatil: o main.cpp monta o RouteState na thread da
// janela, e o VideoSink decide com ele a cada quadro.
#include <set>
#include <vector>

namespace starsonic {

enum class ViewName { Remoto, Local, Porteiro };

// O nome da vista na ponte: "remoto", "local" ou "porteiro".
const char* ViewKey(ViewName view);

// O que decide a rota. O id 0 e nenhuma ligacao (o id do motor comeca em 1).
struct RouteState {
    std::set<ViewName> visible;   // as vistas que as paginas mostram agora (o videoViews das duas)
    int topCallId = 0;            // a ligacao de cima, na janela principal
    int noticeCallId = 0;         // a recebida tocando, que o aviso mostra
    bool minimized = false;       // a janela principal minimizada ou na bandeja
};

// As vistas de um quadro da outra ponta da ligacao callId:
// - o remoto, quando ela e a de cima, a vista esta a vista e a janela nao esta minimizada;
// - o porteiro, quando ela e a recebida tocando e a vista esta a vista, tambem com a janela minimizada (o aviso
//   aparece justamente com ela fora da frente);
// - nenhuma para uma ligacao que nao e nenhuma das duas (desconhecida, ou que acabou) e para o id 0.
std::vector<ViewName> RouteRemote(const RouteState& state, int callId);

// As vistas de um quadro da nossa camera: o local, a vista e sem minimizar (com ou sem ligacao: o teste da camera).
std::vector<ViewName> RouteLocal(const RouteState& state);

}  // namespace starsonic
