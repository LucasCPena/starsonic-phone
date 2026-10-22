#include "Links.h"

#include <cwctype>

namespace starsonic {

namespace {

const wchar_t* const kSchemes[] = {L"tel:", L"sip:", L"callto:"};

bool StartsWithNoCase(const std::wstring& text, const wchar_t* prefix) {
    size_t i = 0;
    for (; prefix[i]; ++i) {
        if (i >= text.size() || std::towlower(text[i]) != std::towlower(prefix[i])) return false;
    }
    return true;
}

int HexValue(wchar_t ch) {
    if (ch >= L'0' && ch <= L'9') return ch - L'0';
    if (ch >= L'a' && ch <= L'f') return ch - L'a' + 10;
    if (ch >= L'A' && ch <= L'F') return ch - L'A' + 10;
    return -1;
}

// Os %XX do navegador (so os de um byte ASCII: um numero nao tem outros). false: um % sem dois digitos depois.
bool PercentDecode(const std::wstring& text, std::wstring* out) {
    out->clear();
    for (size_t i = 0; i < text.size(); ++i) {
        if (text[i] != L'%') {
            out->push_back(text[i]);
            continue;
        }
        if (i + 2 >= text.size()) return false;
        const int high = HexValue(text[i + 1]);
        const int low = HexValue(text[i + 2]);
        if (high < 0 || low < 0) return false;
        out->push_back(static_cast<wchar_t>(high * 16 + low));
        i += 2;
    }
    return true;
}

std::wstring Trim(const std::wstring& text) {
    size_t start = 0;
    size_t end = text.size();
    while (start < end && std::iswspace(text[start])) ++start;
    while (end > start && std::iswspace(text[end - 1])) --end;
    return text.substr(start, end - start);
}

bool IsSeparator(wchar_t ch) {
    return ch == L' ' || ch == L'\t' || ch == L'-' || ch == L'.' || ch == L'(' || ch == L')' || ch == L'/';
}

}  // namespace

std::optional<std::string> ParseLinkArgument(const std::wstring& argument) {
    const std::wstring text = Trim(argument);
    const wchar_t* scheme = nullptr;
    for (const wchar_t* candidate : kSchemes) {
        if (StartsWithNoCase(text, candidate)) {
            scheme = candidate;
            break;
        }
    }
    if (!scheme) return std::nullopt;
    const bool sip = scheme == kSchemes[1];
    std::wstring rest = text.substr(std::wstring(scheme).size());
    // callto://2003 e tel://2003.
    while (!rest.empty() && rest[0] == L'/') rest.erase(0, 1);
    // Os ";parametros" e os "?campos" ficam de fora (o tel:2003;phone-context=..., o sip:...;transport=udp).
    const size_t extra = rest.find_first_of(L";?");
    if (extra != std::wstring::npos) rest.erase(extra);
    // No sip:, o usuario (antes do "@"); o resto e o servidor.
    if (sip) {
        const size_t at = rest.find(L'@');
        if (at != std::wstring::npos) rest.erase(at);
    }
    std::wstring decoded;
    if (!PercentDecode(rest, &decoded)) return std::nullopt;

    std::string number;
    for (const wchar_t ch : decoded) {
        if (IsSeparator(ch)) continue;
        if (ch >= L'0' && ch <= L'9') {
            number.push_back(static_cast<char>(ch));
        } else if (ch == L'*' || ch == L'#') {
            number.push_back(static_cast<char>(ch));
        } else if (ch == L'+' && number.empty()) {
            number.push_back('+');
        } else {
            return std::nullopt;   // letras, um "+" no meio, um "@" que sobrou: nao e um numero
        }
    }
    if (number.empty() || number == "+") return std::nullopt;
    return number;
}

CommandLine ParseCommandLine(const std::vector<std::wstring>& raw) {
    CommandLine arguments;
    // "<exe>" --link "%1" (o registro dos links): tudo depois do --link e o link, e nada vale como opcao. Um lancador
    // que nao escapa as aspas, ou que nao as poe, nunca injeta um --dados ou um --sair.
    for (size_t i = 0; i < raw.size(); ++i) {
        if (raw[i] != L"--link") continue;
        std::wstring link;
        for (size_t j = i + 1; j < raw.size(); ++j) link += (j > i + 1 ? L" " : L"") + raw[j];
        arguments.link = ParseLinkArgument(link);
        return arguments;
    }
    // Um argumento que e um link (o registro antigo, "<exe>" "%1"): so o link, sem as opcoes.
    for (const std::wstring& item : raw) {
        const std::optional<std::string> link = ParseLinkArgument(item);
        if (link) {
            arguments.link = link;
            return arguments;
        }
    }
    // O --dados (os testes) so como o primeiro argumento.
    size_t i = 0;
    if (raw.size() >= 2 && raw[0] == L"--dados") {
        arguments.dataFolder = raw[1];
        i = 2;
    }
    for (; i < raw.size(); ++i) {
        if (raw[i] == L"--sair") {
            arguments.quit = true;
        } else if (raw[i] == L"--bandeja" || raw[i] == L"/minimized") {
            arguments.tray = true;
        }
    }
    return arguments;
}

}  // namespace starsonic
