/* Starsonic Phone: URLs dos menus, incluidas no fim de microsip/define.h (edicao E2).
   Lido tambem pelo compilador de recursos: so diretivas de pre-processador, so ASCII. */
#pragma once
#include "..\branding\branding.h"

#undef _GLOBAL_MENU_WEBSITE
#define _GLOBAL_MENU_WEBSITE STARSONIC_URL_SITE
#undef _GLOBAL_MENU_DOWNLOADS
#define _GLOBAL_MENU_DOWNLOADS STARSONIC_REPO_URL "/releases/latest"
#undef _GLOBAL_URL_CHECK_VERSION
#define _GLOBAL_URL_CHECK_VERSION STARSONIC_REPO_URL "/releases/latest"
#undef _GLOBAL_MENU_ISSUES
#define _GLOBAL_MENU_ISSUES STARSONIC_URL_SUPPORT
#undef _GLOBAL_MENU_HELP
#define _GLOBAL_MENU_HELP STARSONIC_URL_SUPPORT
#undef _GLOBAL_HELP_WEBSITE
#define _GLOBAL_HELP_WEBSITE STARSONIC_URL_SUPPORT

/* Botao Ligar na cor da marca. */
#undef _GLOBAL_DIALER_CALL_COLOR
#define _GLOBAL_DIALER_CALL_COLOR STARSONIC_BRAND_COLOR
