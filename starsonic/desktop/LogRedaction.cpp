#include "LogRedaction.h"

#include <cctype>

namespace starsonic {

namespace {

const char kHidden[] = " <oculto>";
const std::string kHeader = "authorization";
const std::string kProxy = "proxy-";

bool IsBlank(char ch) { return ch == ' ' || ch == '\t'; }

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

}  // namespace starsonic
