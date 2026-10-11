#pragma once
// Monta e trava as contas e as configurações globais a partir dos perfis de servidor.
#include <string>

#include "ServerProfiles.h"

namespace starsonic {

// Espelha os campos de Account (microsip/global.h) que a política toca.
struct AccountFields {
    std::wstring serverId, label, server, proxy, domain, username, authId, password, displayName,
        transport, srtp, publicAddr, dialingPrefix, dialPlan, hideCid, voicemailNumber;
    int registerRefresh = 300, keepAlive = 15;
    bool publish = false, ice = false, allowRewrite = false, disableSessionTimer = false;
};

// Espelha campos de AccountSettings (microsip/settings.h).
struct GlobalFields {
    std::wstring audioCodecs, stun, updatesInterval;
    bool enableStun = false, rport = true;
    int dtmfMethod = 0, sourcePort = 0, rtpPortMin = 0, rtpPortMax = 0;
};

enum class RamalCheck { Ok, Empty, Invalid };

// Apara espaços e tabs das pontas; recusa '@', ':', espaço, tab e caracteres de controle.
// *normalized só é escrito quando o resultado é Ok.
RamalCheck ValidateRamal(const std::wstring& raw, std::wstring* normalized);

// Conta nova: perfil do servidor + ramal (usuário SIP e nome de exibição) + senha.
AccountFields BuildAccount(const ServerProfile& server, const std::wstring& ramal, const std::wstring& senha);

// Reaplica o perfil: tudo fica travado, menos username, authId, password e displayName.
// Devolve false quando o servidor da conta não existe mais; nesse caso a conta é
// esvaziada (usuário, senha, servidor, domínio e proxy) e serverId é mantido.
bool EnforceAccount(AccountFields* account, const Profiles& profiles);

// Codecs, STUN e DTMF do perfil; portas automáticas, rport ligado e verificação diária.
void EnforceGlobal(GlobalFields* globals, const GlobalProfile& profile);

}  // namespace starsonic
