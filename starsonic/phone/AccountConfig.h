#pragma once
// Da conta do núcleo (AccountFields, montada por BuildAccount) para o que o pjsua2 recebe, e dos
// codecs do perfil para os nomes do pjsua (spec 6.3). Sem PJSIP aqui: tudo em texto UTF-8 e números.
#include <string>
#include <vector>

#include "AccountPolicy.h"

namespace starsonic {

struct PjAccountSettings {
    std::string idUri;          // sip:<usuário>@<domínio>
    std::string registrarUri;   // sip:<servidor>;transport=<udp|tcp>
    std::string proxyUri;       // "" ou sip:<proxy>;lr;transport=<udp|tcp>
    std::string authUser;       // o auth id da conta, ou o usuário quando não há
    std::string authPassword;
    std::string transport;      // udp | tcp
    int srtpUse = 0;            // 0 desativado, 1 opcional, 2 obrigatório (pjmedia_srtp_use)
    int udpKeepAliveSec = 0;
    int regTimeoutSec = 0;
};

// Os textos saem em UTF-8 (WideToUtf8); o pjsua2 não converte nada.
PjAccountSettings ToPjAccount(const AccountFields& account);

// Os nomes do pjsua (id do codec: nome/taxa/canais) na ordem do perfil, pela mesma tabela de
// CodecsToMicrosip; nomes fora da tabela ficam de fora. Não olha o que o build do PJSIP traz.
std::vector<std::string> CodecIds(const std::vector<std::wstring>& profileCodecs);

}  // namespace starsonic
