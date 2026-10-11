#pragma once
// Perfis de servidor embutidos no app (branding/servidores.ini, spec seção 6.3).
#include <string>
#include <vector>

namespace starsonic {

enum class Transport { Udp, Tcp, Tls };
enum class SrtpMode { Disabled, Optional, Mandatory };
enum class DtmfMethod { Auto = 0, Inband = 1, Rfc2833 = 2, SipInfo = 3 };   // valores = DTMFMethod do MicroSIP

struct ServerProfile {
    std::wstring id, name, host, domain;
    int port = 0;
    Transport transport = Transport::Udp;
    std::wstring proxy;
    SrtpMode srtp = SrtpMode::Disabled;
    int keepAliveSeconds = 15;
};

// Sem a seção [geral], valem os padrões do MicroSIP.
struct GlobalProfile {
    std::wstring stun;
    std::vector<std::wstring> codecs = {L"PCMA", L"PCMU"};
    DtmfMethod dtmf = DtmfMethod::Auto;
};

struct Profiles {
    GlobalProfile global;
    std::vector<ServerProfile> servers;   // na ordem do arquivo
};

// errorLine começa em 1; 0 quando o erro é do arquivo inteiro (ex.: nenhum servidor).
struct ParseResult {
    bool ok = false;
    int errorLine = 0;
    std::wstring errorMessage;   // pt-BR, cita a chave ou o valor
};

// Em caso de erro, *out não é alterado.
ParseResult ParseProfiles(const std::wstring& text, Profiles* out);
const ServerProfile* FindServer(const Profiles& profiles, const std::wstring& id);
// Nomes normalizados (opus, G722, PCMA, PCMU, G729) → lista de codecs do MicroSIP.
std::wstring CodecsToMicrosip(const std::vector<std::wstring>& codecs);

}  // namespace starsonic
