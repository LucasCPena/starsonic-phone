#pragma once
// Pontos de entrada chamados pelas edicoes E1-E13 no codigo do MicroSIP.

namespace starsonic {

// E4 (microsip.cpp, logo depois de accountSettings.Init()): reaplica os perfis embutidos
// em todas as contas e trava as configuracoes globais.
void OnSettingsLoaded();

}  // namespace starsonic
