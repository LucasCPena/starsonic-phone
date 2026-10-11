#include "ServerProfiles.h"

#include <set>

#include "Text.h"

namespace starsonic {
namespace {

struct CodecName {
    const wchar_t* name;       // grafia aceita no arquivo
    const wchar_t* microsip;   // nome do codec no MicroSIP/PJSIP
};

const CodecName kCodecs[] = {
    {L"opus", L"opus/48000/2"},
    {L"G722", L"G722/16000/1"},
    {L"PCMA", L"PCMA/8000/1"},
    {L"PCMU", L"PCMU/8000/1"},
    {L"G729", L"G729/8000/1"},
};

std::wstring AsciiLower(const std::wstring& text) {
    std::wstring out(text);
    for (wchar_t& ch : out) {
        if (ch >= L'A' && ch <= L'Z') ch = static_cast<wchar_t>(ch - L'A' + L'a');
    }
    return out;
}

const wchar_t* CanonicalCodec(const std::wstring& name) {
    const std::wstring lower = AsciiLower(name);
    for (const CodecName& codec : kCodecs) {
        if (lower == AsciiLower(codec.name)) return codec.name;
    }
    return nullptr;
}

std::wstring Quoted(const std::wstring& text) {
    return L"\"" + text + L"\"";
}

bool IsValidId(const std::wstring& id) {
    if (id.empty()) return false;
    for (wchar_t ch : id) {
        const bool allowed = (ch >= L'a' && ch <= L'z') || (ch >= L'0' && ch <= L'9') ||
                             ch == L'_' || ch == L'-';
        if (!allowed) return false;
    }
    return true;
}

// Aceita só dígitos e um valor dentro de [lowest, highest].
bool ParseInt(const std::wstring& text, int lowest, int highest, int* out) {
    if (text.empty() || text.size() > 9) return false;
    long value = 0;
    for (wchar_t ch : text) {
        if (ch < L'0' || ch > L'9') return false;
        value = value * 10 + (ch - L'0');
    }
    if (value < lowest || value > highest) return false;
    *out = static_cast<int>(value);
    return true;
}

std::wstring InvalidValue(const std::wstring& key, const std::wstring& value, const std::wstring& options) {
    return L"valor inválido para " + Quoted(key) + L": " + Quoted(value) +
           L" (opções: " + options + L")";
}

std::wstring EmptyValue(const std::wstring& key) {
    return L"a chave " + Quoted(key) + L" está vazia";
}

enum class Section { None, Global, Server };

struct ServerDraft {
    ServerProfile profile;
    int headerLine = 0;
    bool hasName = false;
    bool hasHost = false;
    bool hasPort = false;
    bool hasTransport = false;
};

class Parser {
public:
    ParseResult Run(const std::wstring& text, Profiles* out) {
        int line = 0;
        size_t start = 0;
        while (start <= text.size()) {
            size_t end = text.find(L'\n', start);
            if (end == std::wstring::npos) end = text.size();
            ++line;
            if (!HandleLine(line, text.substr(start, end - start))) return result_;
            start = end + 1;
        }
        if (!CloseServer()) return result_;
        if (profiles_.servers.empty()) {
            Fail(0, L"o arquivo não define nenhum servidor");
            return result_;
        }
        *out = profiles_;
        result_.ok = true;
        return result_;
    }

private:
    bool Fail(int line, const std::wstring& message) {
        result_.ok = false;
        result_.errorLine = line;
        result_.errorMessage = message;
        return false;
    }

    bool HandleLine(int line, std::wstring text) {
        if (!text.empty() && text[text.size() - 1] == L'\r') text.erase(text.size() - 1);
        const size_t comment = text.find(L';');   // tudo após o primeiro ';' é comentário
        if (comment != std::wstring::npos) text.erase(comment);
        text = Trim(text);
        if (text.empty() || text[0] == L'#') return true;
        if (text[0] == L'[') return OpenSection(line, text);
        const size_t equals = text.find(L'=');
        if (equals == std::wstring::npos) {
            return Fail(line, L"linha inválida " + Quoted(text) + L" (esperado chave=valor)");
        }
        const std::wstring key = Trim(text.substr(0, equals));
        const std::wstring value = Trim(text.substr(equals + 1));
        switch (section_) {
            case Section::None:
                return Fail(line, L"a chave " + Quoted(key) + L" aparece antes de qualquer seção");
            case Section::Global:
                return GlobalKey(line, key, value);
            case Section::Server:
                return ServerKey(line, key, value);
        }
        return true;
    }

    bool OpenSection(int line, const std::wstring& text) {
        if (!CloseServer()) return false;
        if (text.size() < 2 || text[text.size() - 1] != L']') {
            return Fail(line, L"cabeçalho de seção inválido: " + Quoted(text));
        }
        const std::wstring id = text.substr(1, text.size() - 2);
        if (!IsValidId(id)) {
            return Fail(line, L"seção inválida [" + id +
                                  L"]: o id só pode ter letras minúsculas, números, \"-\" e \"_\"");
        }
        if (!seenSections_.insert(id).second) {
            return Fail(line, L"seção repetida: [" + id + L"]");
        }
        if (id == L"geral") {
            section_ = Section::Global;
            return true;
        }
        section_ = Section::Server;
        draft_ = ServerDraft();
        draft_.profile.id = id;
        draft_.headerLine = line;
        return true;
    }

    bool CloseServer() {
        if (section_ != Section::Server) return true;
        section_ = Section::None;
        const wchar_t* missing = nullptr;
        if (!draft_.hasName) missing = L"nome";
        else if (!draft_.hasHost) missing = L"endereco";
        else if (!draft_.hasPort) missing = L"porta";
        else if (!draft_.hasTransport) missing = L"transporte";
        if (missing) {
            return Fail(draft_.headerLine, L"o servidor [" + draft_.profile.id +
                                               L"] não tem a chave obrigatória " + Quoted(missing));
        }
        if (draft_.profile.domain.empty()) draft_.profile.domain = draft_.profile.host;
        profiles_.servers.push_back(draft_.profile);
        return true;
    }

    bool GlobalKey(int line, const std::wstring& key, const std::wstring& value) {
        GlobalProfile& global = profiles_.global;
        if (key == L"stun") {
            global.stun = value;
            return true;
        }
        if (key == L"codecs") return ParseCodecs(line, value, &global.codecs);
        if (key == L"dtmf") {
            const std::wstring lower = AsciiLower(value);
            if (lower == L"auto") global.dtmf = DtmfMethod::Auto;
            else if (lower == L"inband") global.dtmf = DtmfMethod::Inband;
            else if (lower == L"rfc2833") global.dtmf = DtmfMethod::Rfc2833;
            else if (lower == L"info") global.dtmf = DtmfMethod::SipInfo;
            else return Fail(line, InvalidValue(key, value, L"auto, inband, rfc2833 ou info"));
            return true;
        }
        return Fail(line, L"chave desconhecida " + Quoted(key) + L" em [geral]");
    }

    bool ParseCodecs(int line, const std::wstring& value, std::vector<std::wstring>* out) {
        const std::wstring options = L"opus, G722, PCMA, PCMU ou G729";
        if (value.empty()) return Fail(line, EmptyValue(L"codecs") + L" (opções: " + options + L")");
        std::vector<std::wstring> codecs;
        size_t start = 0;
        for (;;) {
            const size_t comma = value.find(L',', start);
            const size_t length = (comma == std::wstring::npos) ? std::wstring::npos : comma - start;
            const std::wstring item = Trim(value.substr(start, length));
            if (item.empty()) return Fail(line, L"item vazio na lista " + Quoted(L"codecs"));
            const wchar_t* canonical = CanonicalCodec(item);
            if (!canonical) {
                return Fail(line, L"codec desconhecido " + Quoted(item) + L" (opções: " + options + L")");
            }
            codecs.push_back(canonical);
            if (comma == std::wstring::npos) break;
            start = comma + 1;
        }
        *out = codecs;
        return true;
    }

    bool ServerKey(int line, const std::wstring& key, const std::wstring& value) {
        ServerProfile& server = draft_.profile;
        if (key == L"nome") {
            if (value.empty()) return Fail(line, EmptyValue(key));
            server.name = value;
            draft_.hasName = true;
            return true;
        }
        if (key == L"endereco") {
            if (value.empty()) return Fail(line, EmptyValue(key));
            server.host = value;
            draft_.hasHost = true;
            return true;
        }
        if (key == L"dominio") {
            server.domain = value;   // vazio = igual ao endereço
            return true;
        }
        if (key == L"proxy") {
            server.proxy = value;
            return true;
        }
        if (key == L"porta") {
            if (!ParseInt(value, 1, 65535, &server.port)) {
                return Fail(line, L"a chave \"porta\" precisa ser um número de 1 a 65535: " + Quoted(value));
            }
            draft_.hasPort = true;
            return true;
        }
        if (key == L"keepalive") {
            if (!ParseInt(value, 1, 3600, &server.keepAliveSeconds)) {
                return Fail(line, L"a chave \"keepalive\" precisa ser um número de 1 a 3600 (segundos): " +
                                      Quoted(value));
            }
            return true;
        }
        if (key == L"transporte") {
            const std::wstring lower = AsciiLower(value);
            if (lower == L"udp") server.transport = Transport::Udp;
            else if (lower == L"tcp") server.transport = Transport::Tcp;
            else if (lower == L"tls") server.transport = Transport::Tls;
            else return Fail(line, InvalidValue(key, value, L"udp, tcp ou tls"));
            draft_.hasTransport = true;
            return true;
        }
        if (key == L"srtp") {
            const std::wstring lower = AsciiLower(value);
            if (lower == L"desativado") server.srtp = SrtpMode::Disabled;
            else if (lower == L"opcional") server.srtp = SrtpMode::Optional;
            else if (lower == L"obrigatorio") server.srtp = SrtpMode::Mandatory;
            else return Fail(line, InvalidValue(key, value, L"desativado, opcional ou obrigatorio"));
            return true;
        }
        return Fail(line, L"chave desconhecida " + Quoted(key) + L" em [" + server.id + L"]");
    }

    Profiles profiles_;
    ParseResult result_;
    Section section_ = Section::None;
    ServerDraft draft_;
    std::set<std::wstring> seenSections_;
};

}  // namespace

ParseResult ParseProfiles(const std::wstring& text, Profiles* out) {
    Parser parser;
    return parser.Run(text, out);
}

const ServerProfile* FindServer(const Profiles& profiles, const std::wstring& id) {
    for (const ServerProfile& server : profiles.servers) {
        if (server.id == id) return &server;
    }
    return nullptr;
}

std::wstring CodecsToMicrosip(const std::vector<std::wstring>& codecs) {
    std::wstring out;
    for (const std::wstring& name : codecs) {
        for (const CodecName& codec : kCodecs) {
            if (name == codec.name) {
                if (!out.empty()) out += L' ';
                out += codec.microsip;
                break;
            }
        }
    }
    return out;
}

}  // namespace starsonic
