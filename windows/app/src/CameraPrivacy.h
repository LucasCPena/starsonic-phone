#pragma once
// A privacidade da camera do Windows (Configuracoes do Windows -> Privacidade e seguranca -> Camera): so escolhe o
// aviso de uma camera que nao abriu (o gancho cameraBlocked do DesktopApp). Tres chaves do ConsentStore\webcam, cada
// uma com o valor "Value" ("Allow", "Deny" ou nenhum): a do computador (HKLM), a do usuario (HKCU) e a dos apps da
// area de trabalho do usuario (HKCU ...\webcam\NonPackaged).
//
// A decisao e C++ portatil (testada tambem no Linux); a leitura do registro e so do Windows.
#include <string>

namespace starsonic {

// A camera esta negada: qualquer um dos tres valores e "Deny" (um valor que falta vem "").
bool CameraConsentDenied(const std::string& deviceWide, const std::string& user, const std::string& userDesktopApps);

#ifdef _WIN32
// Le os tres valores do registro e decide pelo CameraConsentDenied. A chave do computador e lida na vista de 64 bits do
// registro: o app e de 32 bits, e o HKLM\SOFTWARE dele iria ao WOW6432Node, que nao e onde as Configuracoes gravam. De
// qualquer thread; nunca espera.
bool CameraBlockedByWindows();
#endif

}  // namespace starsonic
