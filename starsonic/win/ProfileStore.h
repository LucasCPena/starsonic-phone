#pragma once
// Perfil embutido no executavel (recurso IDR_STARSONIC_PROFILE, gerado de branding/perfil.ini).
#include "Profile.h"

// Le e valida o recurso na primeira chamada. Perfil invalido: mostra o erro e encerra o app.
const starsonic::Profile& LoadedProfile();
