#pragma once
// O endereco de uma reuniao para o navegador padrao (o hook openMeeting do DesktopApp). C++ portatil, sem o windows.h.
// Nada de uma reuniao (o codigo, o passe) vai ao diagnostico.
#include <string>

namespace starsonic {

// O endereco de uma reuniao para o navegador padrao: kChatOrigin + "/r/" + code e, com o passe, "#p=" + pass.
// "" quando o codigo, ou um passe que veio, nao tem o formato: nada abre. O passe vazio e o link sem passe.
std::string MeetingBrowserUrl(const std::string& code, const std::string& pass);

}  // namespace starsonic
