#pragma once
// Perfis de servidor embutidos no executavel (recurso IDR_STARSONIC_SERVERS).
#include "ServerProfiles.h"

// Le e valida o recurso na primeira chamada. Arquivo invalido: mostra o erro e encerra o app.
const starsonic::Profiles& LoadedProfiles();
