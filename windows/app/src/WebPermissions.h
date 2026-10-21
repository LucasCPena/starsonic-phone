#pragma once
// As permissoes do WebView2 (spec da W1, 6.4): so a origem do app (https://app.starsonic.local/) e so duas:
// - o microfone (os rotulos do enumerateDevices, que o Configuracoes compara com os nomes do motor; a interface nunca
//   captura som: o motor captura);
// - a reproducao automatica (o toque, que toca antes de qualquer clique, Task 10): se o runtime pedir a permissao em
//   vez de seguir o --autoplay-policy, negar deixaria o toque mudo.
// Todo o resto e negado.
//
// C++ portatil: so o texto da URL.
#include <string>

namespace starsonic {

extern const char kAppOrigin[];   // "https://app.starsonic.local"

enum class WebPermission { Microphone, Autoplay, Other };

// A URL e do app: a origem exata seguida de "/" (nunca https://app.starsonic.local.outro.com).
bool IsAppUrl(const std::string& url);

bool AllowWebPermission(WebPermission kind, const std::string& url);

}  // namespace starsonic
