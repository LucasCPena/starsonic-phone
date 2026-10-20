#pragma once
// Monta e trava as contas e as configurações globais a partir do perfil embutido (spec 6.3 e 7).
#include <string>
#include <vector>

#include "Profile.h"

namespace starsonic {

// Espelha os campos de Account (microsip/global.h) que a política toca.
struct AccountFields {
    std::wstring label, server, proxy, domain, username, authId, password, displayName,
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

enum class ServerCheck { Ok, Empty, Invalid };

// Endereço do servidor digitado na tela Entrar (spec 7.1): apara espaços e tabs das pontas e passa
// A-Z para minúsculas; vale um nome de até 253 caracteres, em partes separadas por ponto, cada uma
// com 1 a 63 letras a-z, dígitos ou hífens, sem hífen nas pontas (o que inclui IPv4; IPv6 não).
// *normalized só é escrito quando o resultado é Ok.
ServerCheck ValidateServerAddress(const std::wstring& raw, std::wstring* normalized);

// Avisos da tela Entrar (tabela 11.1 do Windows) para o resultado de ValidateServerAddress e de
// ValidateRamal; L"" quando é Ok. Os mesmos textos no Windows e no Android.
std::wstring ServerCheckMessage(ServerCheck check);
std::wstring RamalCheckMessage(RamalCheck check);

// Endereço guardado no campo server de uma conta: o texto sem o ":<1 a 5 dígitos>" do fim.
std::wstring AddressFromServer(const std::wstring& server);

// Nome da conta (spec 7.1, revisão 1.4): opcional; vai só no rótulo (menu de contas e faixa).
const size_t kMaxAccountNameLength = 40;

// Apara espaços e tabs das pontas e guarda até kMaxAccountNameLength unidades UTF-16, sem partir
// um par substituto no corte.
std::wstring NormalizeAccountName(const std::wstring& raw);

// Nome guardado no rótulo de uma conta: "" quando o rótulo é vazio ou automático (<ramal> ·
// <endereço>, com ramal e endereço válidos); senão, o rótulo normalizado.
std::wstring AccountNameFromLabel(const std::wstring& label);

// Protocolo guardado no campo transport de uma conta: udp ou tcp (sem diferenciar maiúsculas,
// aparado); qualquer outro valor devolve fallback.
Transport TransportFromName(const std::wstring& name, Transport fallback);

// A porta do servidor [address] (já validado): a da seção [portas] do perfil para esse endereço exato,
// senão a da [conta]. Vale para UDP e TCP.
int PortForServer(const AccountProfile& profile, const std::wstring& address);

// Conta nova: perfil + endereço do servidor (já validado) + protocolo + ramal (usuário SIP e nome
// de exibição) + senha + nome da conta. server = <endereço>:<porta> (PortForServer), domínio = <endereço>,
// rótulo = o nome (normalizado) ou, sem nome, <ramal> · <endereço>.
AccountFields BuildAccount(const AccountProfile& profile, const std::wstring& address, const std::wstring& ramal,
                           const std::wstring& senha, Transport transport, const std::wstring& accountName);

// Reaplica o perfil: o endereço vem do campo server (sem a porta, normalizado por
// ValidateServerAddress), o protocolo do campo transport (UDP ou TCP; outro valor volta ao padrão
// do perfil) e o nome do rótulo (AccountNameFromLabel); o resto fica travado, menos username,
// authId, password e displayName. Devolve false quando o endereço está vazio ou é inválido; nesse
// caso a conta é esvaziada (usuário, senha, servidor, domínio e proxy).
bool EnforceAccount(AccountFields* account, const AccountProfile& profile);

// Codecs, STUN e DTMF do perfil; portas automáticas, rport ligado e verificação diária.
void EnforceGlobal(GlobalFields* globals, const GlobalProfile& profile);

// Números n >= 1 das seções [Account<n>] entre os nomes de seção de um INI (sem diferenciar
// maiúsculas, sem zeros à esquerda, até 9 dígitos), em ordem crescente e sem repetição: as
// contas que o MicroSIP carregaria com AccountLoad(n), inclusive depois de um buraco.
std::vector<int> AccountSectionNumbers(const std::vector<std::wstring>& sectionNames);

// false nas linhas de comando em que o MicroSIP não carrega as configurações ou só repassa um
// comando e sai (/reset, /resetnoask, /exit, comparadas ao pé da letra, como ele faz): reaplicar
// o perfil e salvar ali gravaria valores vazios por cima das configurações.
bool ShouldEnforceAtStartup(const std::wstring& commandLine);

}  // namespace starsonic
