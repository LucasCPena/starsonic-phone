#include "LogRedaction.h"

#include <algorithm>
#include <cctype>

namespace starsonic {

namespace {

const char kHidden[] = " <oculto>";
const std::string kHeader = "authorization";
const std::string kProxy = "proxy-";
// O RedactUrl de um texto sem esquema: um texto fixo, nunca o texto.
const char kNoScheme[] = "(sem esquema)";

bool IsBlank(char ch) { return ch == ' ' || ch == '\t'; }

// Os caracteres do ASCII (o std::isalpha e o std::isdigit dependem do locale).
bool IsAsciiLetter(char ch) { return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z'); }
bool IsAsciiDigit(char ch) { return ch >= '0' && ch <= '9'; }

// Um caractere do esquema de um endereco: o primeiro e uma letra; os outros, letras, digitos, "+", "-" ou ".".
bool IsSchemeChar(char ch, bool first) {
    if (IsAsciiLetter(ch)) return true;
    return !first && (IsAsciiDigit(ch) || ch == '+' || ch == '-' || ch == '.');
}

// Um host como o navegador o da (o IDN ja em punycode): letras, digitos, ".", "-" e "_", ou o IPv6 entre colchetes.
// Qualquer outro caractere (um espaco, uma quebra de linha, um byte fora do ASCII) faz o host nao ir ao diagnostico.
bool IsHost(const std::string& host) {
    if (host.size() > 2 && host.front() == '[' && host.back() == ']') {
        // O IPv6: digitos hexadecimais, ":" e "." (o IPv4 no fim).
        for (size_t i = 1; i + 1 < host.size(); ++i) {
            const char ch = host[i];
            const bool hex = IsAsciiDigit(ch) || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
            if (!hex && ch != ':' && ch != '.') return false;
        }
        return true;
    }
    for (const char ch : host) {
        if (!IsAsciiLetter(ch) && !IsAsciiDigit(ch) && ch != '.' && ch != '-' && ch != '_') return false;
    }
    return true;
}

std::string Lower(const std::string& text) {
    std::string out = text;
    for (char& ch : out) ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
    return out;
}

// Onde termina o "Authorization:" (ou "Proxy-Authorization:") desta linha, depois dos dois pontos; npos sem ele.
size_t HeaderEnd(const std::string& line) {
    const std::string lower = Lower(line);
    for (size_t at = lower.find(kHeader); at != std::string::npos; at = lower.find(kHeader, at + 1)) {
        size_t start = at;
        if (start >= kProxy.size() && lower.compare(start - kProxy.size(), kProxy.size(), kProxy) == 0) {
            start -= kProxy.size();
        }
        // O nome comeca a linha ou vem depois de um espaco (nunca o fim de outro nome, como X-Authorization).
        if (start != 0 && !IsBlank(line[start - 1])) continue;
        size_t colon = at + kHeader.size();
        while (colon < line.size() && IsBlank(line[colon])) ++colon;
        if (colon < line.size() && line[colon] == ':') return colon + 1;
    }
    return std::string::npos;
}

}  // namespace

std::string RedactSecrets(const std::string& text) {
    std::string out;
    out.reserve(text.size());
    bool folding = false;   // a linha anterior era um cabecalho escondido: as continuacoes dele saem
    size_t pos = 0;
    while (pos < text.size()) {
        size_t newline = text.find('\n', pos);
        const size_t next = newline == std::string::npos ? text.size() : newline + 1;
        size_t end = newline == std::string::npos ? text.size() : newline;
        if (end > pos && text[end - 1] == '\r') --end;
        const std::string line = text.substr(pos, end - pos);
        const std::string eol = text.substr(end, next - end);
        pos = next;
        if (folding && !line.empty() && IsBlank(line[0])) continue;
        folding = false;
        const size_t header = HeaderEnd(line);
        if (header == std::string::npos) {
            out += line;
            out += eol;
            continue;
        }
        out.append(line, 0, header);
        out += kHidden;
        out += eol;
        folding = true;
    }
    return out;
}

std::string RedactUrl(const std::string& url) {
    // O esquema (RFC 3986): uma letra, depois letras, digitos, "+", "-" ou ".", ate os dois pontos.
    size_t colon = 0;
    while (colon < url.size() && IsSchemeChar(url[colon], colon == 0)) ++colon;
    if (colon == 0 || colon >= url.size() || url[colon] != ':') return kNoScheme;
    const std::string scheme = Lower(url.substr(0, colon));
    const std::string bare = scheme + ":";
    if (scheme != "http" && scheme != "https" && scheme != "ws" && scheme != "wss") return bare;
    // O host: depois do "//", ate o fim da autoridade, sem o usuario e a senha (o que vem ate o ultimo "@") e sem a
    // porta. O "\" tambem termina a autoridade (o navegador o le como "/" nesses esquemas).
    if (url.compare(colon + 1, 2, "//") != 0) return bare;
    const size_t start = colon + 3;
    const size_t end = std::min(url.find_first_of("/?#\\", start), url.size());
    std::string host = url.substr(start, end - start);
    const size_t at = host.rfind('@');
    if (at != std::string::npos) host.erase(0, at + 1);
    // O IPv6 vem entre colchetes ("[::1]"); nos outros, a porta vem depois dos dois pontos.
    const size_t cut = (host.empty() || host[0] != '[') ? host.find(':') : host.find(']');
    if (cut != std::string::npos) host.erase(host[0] == '[' ? cut + 1 : cut);
    if (host.empty() || !IsHost(host)) return bare;
    return scheme + "://" + host;
}

}  // namespace starsonic
