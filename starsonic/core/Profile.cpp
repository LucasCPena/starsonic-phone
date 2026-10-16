#include "Profile.h"

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

// Vale para o texto vazio também: quem chama confere o tamanho quando o vazio não serve.
bool OnlyChars(const std::wstring& text, const wchar_t* allowed) {
    return text.find_first_not_of(allowed) == std::wstring::npos;
}

std::wstring InvalidValue(const std::wstring& key, const std::wstring& value, const std::wstring& options) {
    return L"valor inv\u00e1lido para " + Quoted(key) + L": " + Quoted(value) + L" (op\u00e7\u00f5es: " + options + L")";
}

std::wstring EmptyValue(const std::wstring& key) {
    return L"a chave " + Quoted(key) + L" est\u00e1 vazia";
}

enum class Section { None, Global, Account };

class Parser {
public:
    ParseResult Run(const std::wstring& text, Profile* out) {
        int line = 0;
        size_t start = 0;
        while (start <= text.size()) {
            size_t end = text.find(L'\n', start);
            if (end == std::wstring::npos) end = text.size();
            ++line;
            if (!HandleLine(line, text.substr(start, end - start))) return result_;
            start = end + 1;
        }
        if (!seenAccount_) {
            Fail(0, L"o arquivo n\u00e3o tem a se\u00e7\u00e3o [conta]");
            return result_;
        }
        const wchar_t* missing = nullptr;
        if (!hasPort_) missing = L"porta";
        else if (!hasTransport_) missing = L"transporte";
        if (missing) {
            Fail(accountLine_, L"a se\u00e7\u00e3o [conta] n\u00e3o tem a chave obrigat\u00f3ria " + Quoted(missing));
            return result_;
        }
        *out = profile_;
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
            return Fail(line, L"linha inv\u00e1lida " + Quoted(text) + L" (esperado chave=valor)");
        }
        const std::wstring key = Trim(text.substr(0, equals));
        const std::wstring value = Trim(text.substr(equals + 1));
        switch (section_) {
            case Section::None:
                return Fail(line, L"a chave " + Quoted(key) + L" aparece antes de qualquer se\u00e7\u00e3o");
            case Section::Global:
                return GlobalKey(line, key, value);
            case Section::Account:
                return AccountKey(line, key, value);
        }
        return true;
    }

    bool OpenSection(int line, const std::wstring& text) {
        if (text.size() < 2 || text[text.size() - 1] != L']') {
            return Fail(line, L"cabe\u00e7alho de se\u00e7\u00e3o inv\u00e1lido: " + Quoted(text));
        }
        const std::wstring name = text.substr(1, text.size() - 2);
        if (name == L"geral") {
            if (seenGlobal_) return Fail(line, L"se\u00e7\u00e3o repetida: [geral]");
            seenGlobal_ = true;
            section_ = Section::Global;
            return true;
        }
        if (name == L"conta") {
            if (seenAccount_) return Fail(line, L"se\u00e7\u00e3o repetida: [conta]");
            seenAccount_ = true;
            accountLine_ = line;
            section_ = Section::Account;
            return true;
        }
        return Fail(line, L"se\u00e7\u00e3o desconhecida [" + name + L"] (use [geral] e [conta])");
    }

    bool GlobalKey(int line, const std::wstring& key, const std::wstring& value) {
        GlobalProfile& global = profile_.global;
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
        if (value.empty()) return Fail(line, EmptyValue(L"codecs") + L" (op\u00e7\u00f5es: " + options + L")");
        std::vector<std::wstring> codecs;
        size_t start = 0;
        for (;;) {
            const size_t comma = value.find(L',', start);
            const size_t length = (comma == std::wstring::npos) ? std::wstring::npos : comma - start;
            const std::wstring item = Trim(value.substr(start, length));
            if (item.empty()) return Fail(line, L"item vazio na lista " + Quoted(L"codecs"));
            const wchar_t* canonical = CanonicalCodec(item);
            if (!canonical) {
                return Fail(line, L"codec desconhecido " + Quoted(item) + L" (op\u00e7\u00f5es: " + options + L")");
            }
            codecs.push_back(canonical);
            if (comma == std::wstring::npos) break;
            start = comma + 1;
        }
        *out = codecs;
        return true;
    }

    bool AccountKey(int line, const std::wstring& key, const std::wstring& value) {
        AccountProfile& account = profile_.account;
        if (key == L"proxy") {
            account.proxy = value;
            return true;
        }
        if (key == L"porta") {
            if (!ParseInt(value, 1, 65535, &account.port)) {
                return Fail(line, L"a chave \"porta\" precisa ser um n\u00famero de 1 a 65535: " + Quoted(value));
            }
            hasPort_ = true;
            return true;
        }
        if (key == L"keepalive") {
            if (!ParseInt(value, 1, 3600, &account.keepAliveSeconds)) {
                return Fail(line, L"a chave \"keepalive\" precisa ser um n\u00famero de 1 a 3600 (segundos): " +
                                      Quoted(value));
            }
            return true;
        }
        if (key == L"transporte") {
            const std::wstring lower = AsciiLower(value);
            if (lower == L"udp") account.transport = Transport::Udp;
            else if (lower == L"tcp") account.transport = Transport::Tcp;
            else return Fail(line, InvalidValue(key, value, L"udp ou tcp"));
            hasTransport_ = true;
            return true;
        }
        if (key == L"srtp") {
            const std::wstring lower = AsciiLower(value);
            if (lower == L"desativado") account.srtp = SrtpMode::Disabled;
            else if (lower == L"opcional") account.srtp = SrtpMode::Optional;
            else if (lower == L"obrigatorio") account.srtp = SrtpMode::Mandatory;
            else return Fail(line, InvalidValue(key, value, L"desativado, opcional ou obrigatorio"));
            return true;
        }
        if (key == L"ddi") {
            if (value.empty() || value.size() > 3 || !OnlyChars(value, L"0123456789")) {
                return Fail(line, L"a chave \"ddi\" precisa ter de 1 a 3 d\u00edgitos: " + Quoted(value));
            }
            account.ddi = value;
            return true;
        }
        if (key == L"prefixo_externo") {
            if (!OnlyChars(value, L"0123456789*#")) {
                return Fail(line, L"a chave \"prefixo_externo\" aceita s\u00f3 d\u00edgitos, * e #: " + Quoted(value));
            }
            account.externalPrefix = value;
            return true;
        }
        return Fail(line, L"chave desconhecida " + Quoted(key) + L" em [conta]");
    }

    Profile profile_;
    ParseResult result_;
    Section section_ = Section::None;
    bool seenGlobal_ = false;
    bool seenAccount_ = false;
    int accountLine_ = 0;
    bool hasPort_ = false;
    bool hasTransport_ = false;
};

}  // namespace

ParseResult ParseProfile(const std::wstring& text, Profile* out) {
    Parser parser;
    return parser.Run(text, out);
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
