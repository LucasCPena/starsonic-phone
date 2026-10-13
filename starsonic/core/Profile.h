#pragma once
// Perfil embutido no app (branding/perfil.ini, spec seção 6.3): vale para todas as contas; o
// endereço do servidor é digitado na tela Entrar.
#include <string>
#include <vector>

namespace starsonic {

enum class Transport { Udp, Tcp, Tls };
enum class SrtpMode { Disabled, Optional, Mandatory };
enum class DtmfMethod { Auto = 0, Inband = 1, Rfc2833 = 2, SipInfo = 3 };   // valores = DTMFMethod do MicroSIP

// Seção [conta]: o que toda conta recebe, além do endereço, do ramal e da senha.
struct AccountProfile {
    int port = 0;
    Transport transport = Transport::Udp;
    std::wstring proxy;
    SrtpMode srtp = SrtpMode::Disabled;
    int keepAliveSeconds = 15;
};

// Seção [geral]. Sem ela, valem os padrões do MicroSIP.
struct GlobalProfile {
    std::wstring stun;
    std::vector<std::wstring> codecs = {L"PCMA", L"PCMU"};
    DtmfMethod dtmf = DtmfMethod::Auto;
};

struct Profile {
    GlobalProfile global;
    AccountProfile account;
};

// errorLine começa em 1; 0 quando o erro é do arquivo inteiro (ex.: sem [conta]).
struct ParseResult {
    bool ok = false;
    int errorLine = 0;
    std::wstring errorMessage;   // pt-BR, cita a seção, a chave ou o valor
};

// Só as seções [geral] (opcional) e [conta] (obrigatória). Em caso de erro, *out não é alterado.
ParseResult ParseProfile(const std::wstring& text, Profile* out);
// Nomes normalizados (opus, G722, PCMA, PCMU, G729) → lista de codecs do MicroSIP.
std::wstring CodecsToMicrosip(const std::vector<std::wstring>& codecs);

}  // namespace starsonic
