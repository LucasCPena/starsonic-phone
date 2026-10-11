/* Starsonic Phone: marca e versao, incluidas no fim de microsip/const.h (edicao E1).
   Lido tambem pelo compilador de recursos: so diretivas de pre-processador, so ASCII.
   Os caminhos "..\" funcionam tanto a partir de starsonic\ quanto de microsip\. */
#pragma once
#include "..\branding\branding.h"
#include "..\starsonic\generated\build_info.h"

/* Edicao Lite: sem video. */
#undef _GLOBAL_VIDEO

#undef _GLOBAL_NAME
#define _GLOBAL_NAME STARSONIC_APP_NAME
#undef _GLOBAL_COMPANY
#define _GLOBAL_COMPANY STARSONIC_COMPANY
#undef _GLOBAL_VERSION
#define _GLOBAL_VERSION STARSONIC_VERSION
#undef _GLOBAL_VERSION_COMMA
#define _GLOBAL_VERSION_COMMA STARSONIC_VERSION_COMMA
#undef _GLOBAL_TIMESTAMP
#define _GLOBAL_TIMESTAMP STARSONIC_BUILD_TIMESTAMP
