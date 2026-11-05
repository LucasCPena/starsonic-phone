#include "ChatFiles.h"

namespace starsonic {

namespace {

// Uma sequencia que nao e UTF-8 (nunca um ponto de codigo: o maior e U+10FFFF).
constexpr char32_t kInvalid = 0xFFFFFFFF;
constexpr char32_t kReplacement = 0xFFFD;
// O nome do arquivo: ate 120 pontos de codigo, como o servidor do chat (docs/chat-protocolo.md, secao 3).
constexpr size_t kMaxNameChars = 120;
constexpr int kMaxCopy = 1000;   // o FreeName para no "(1000)"
const char kDefaultName[] = "arquivo";
const char kEllipsis[] = "\xe2\x80\xa6";   // U+2026

// Os pontos de codigo do texto UTF-8. Uma sequencia invalida (o byte solto, a sequencia cortada, a forma longa, o
// substituto, acima de U+10FFFF) vira um kInvalid, e a leitura recomeca no byte que a quebrou: a regra do Utf8ToWide
// (Text.cpp), que troca cada uma por um U+FFFD.
std::u32string Decode(const std::string& utf8) {
    std::u32string out;
    out.reserve(utf8.size());
    const size_t size = utf8.size();
    size_t i = 0;
    while (i < size) {
        const unsigned char lead = static_cast<unsigned char>(utf8[i]);
        if (lead < 0x80) {
            out.push_back(static_cast<char32_t>(lead));
            ++i;
            continue;
        }
        int extra = 0;           // os bytes de continuacao esperados
        char32_t code = 0;
        unsigned low = 0x80;     // a faixa valida do segundo byte
        unsigned high = 0xBF;
        if (lead >= 0xC2 && lead <= 0xDF) {
            extra = 1;
            code = static_cast<char32_t>(lead & 0x1F);
        } else if (lead >= 0xE0 && lead <= 0xEF) {
            extra = 2;
            code = static_cast<char32_t>(lead & 0x0F);
            if (lead == 0xE0) low = 0xA0;         // forma longa
            else if (lead == 0xED) high = 0x9F;   // os substitutos U+D800 a U+DFFF
        } else if (lead >= 0xF0 && lead <= 0xF4) {
            extra = 3;
            code = static_cast<char32_t>(lead & 0x07);
            if (lead == 0xF0) low = 0x90;         // forma longa
            else if (lead == 0xF4) high = 0x8F;   // acima de U+10FFFF
        } else {
            out.push_back(kInvalid);
            ++i;
            continue;
        }
        size_t j = i + 1;
        bool valid = true;
        for (int k = 0; k < extra; ++k, ++j) {
            if (j >= size) {
                valid = false;
                break;
            }
            const unsigned next = static_cast<unsigned char>(utf8[j]);
            const unsigned lowest = k == 0 ? low : 0x80u;
            const unsigned highest = k == 0 ? high : 0xBFu;
            if (next < lowest || next > highest) {
                valid = false;
                break;
            }
            code = static_cast<char32_t>((code << 6) | (next & 0x3F));
        }
        out.push_back(valid ? code : kInvalid);
        i = j;
    }
    return out;
}

void AppendUtf8(std::string& out, char32_t code) {
    if (code < 0x80) {
        out.push_back(static_cast<char>(code));
    } else if (code < 0x800) {
        out.push_back(static_cast<char>(0xC0 | (code >> 6)));
        out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
    } else if (code < 0x10000) {
        out.push_back(static_cast<char>(0xE0 | (code >> 12)));
        out.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
    } else {
        out.push_back(static_cast<char>(0xF0 | (code >> 18)));
        out.push_back(static_cast<char>(0x80 | ((code >> 12) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
    }
}

// O texto em UTF-8 (o kInvalid vira o U+FFFD).
std::string Encode(const std::u32string& text) {
    std::string out;
    out.reserve(text.size());
    for (const char32_t code : text) AppendUtf8(out, code == kInvalid ? kReplacement : code);
    return out;
}

// Os de controle (a categoria Cc do Unicode): U+0000 a U+001F, o U+007F e U+0080 a U+009F.
bool IsControl(char32_t code) { return code < 0x20 || (code >= 0x7F && code <= 0x9F); }

// Os controles da direcao do texto (a propriedade Bidi_Control do Unicode).
bool IsBidiControl(char32_t code) {
    return code == 0x061C || code == 0x200E || code == 0x200F || (code >= 0x202A && code <= 0x202E) ||
           (code >= 0x2066 && code <= 0x2069);
}

// Os que o Windows nao aceita num nome de arquivo, menos as barras (que separam a pasta).
bool IsForbidden(char32_t code) {
    return code == U':' || code == U'*' || code == U'?' || code == U'"' || code == U'<' || code == U'>' || code == U'|';
}

bool IsDotOrSpace(char32_t code) { return code == U'.' || code == U' '; }

std::u32string TrimDotsAndSpaces(const std::u32string& text) {
    size_t first = 0;
    size_t last = text.size();
    while (first < last && IsDotOrSpace(text[first])) ++first;
    while (last > first && IsDotOrSpace(text[last - 1])) --last;
    return text.substr(first, last - first);
}

// Ate max pontos de codigo, mantendo a extensao (a do ultimo ponto, menos o do comeco, quando ela e menor que max), e
// sem os pontos e os espacos das pontas: a regra do servidor do chat (o NomeArquivo de chat-servidor/internal/regras).
std::u32string Limit(const std::u32string& name, size_t max) {
    if (name.size() <= max) return name;
    const size_t dot = name.rfind(U'.');
    std::u32string out;
    if (dot != std::u32string::npos && dot > 0 && name.size() - dot < max) {
        out = name.substr(0, max - (name.size() - dot)) + name.substr(dot);
    } else {
        out = name.substr(0, max);
    }
    return TrimDotsAndSpaces(out);
}

// Um nome reservado do Windows: o de antes do primeiro ponto, sem os espacos do fim (o Windows os ignora: o "CON .txt"
// e o CON) e sem caixa.
bool IsReserved(const std::u32string& name) {
    std::u32string stem = name.substr(0, name.find(U'.'));
    while (!stem.empty() && stem.back() == U' ') stem.pop_back();
    for (char32_t& code : stem) {
        if (code >= U'a' && code <= U'z') code = static_cast<char32_t>(code - U'a' + U'A');
    }
    if (stem == U"CON" || stem == U"PRN" || stem == U"AUX" || stem == U"NUL" || stem == U"CONIN$" ||
        stem == U"CONOUT$") {
        return true;
    }
    if (stem.size() != 4) return false;
    const std::u32string device = stem.substr(0, 3);
    const char32_t digit = stem[3];
    // De 0 a 9, e o 1, o 2 e o 3 sobrescritos (U+00B9, U+00B2 e U+00B3).
    const bool number = (digit >= U'0' && digit <= U'9') || digit == 0x00B9 || digit == 0x00B2 || digit == 0x00B3;
    return number && (device == U"COM" || device == U"LPT");
}

}  // namespace

std::string BadgeText(int n) {
    if (n <= 0) return std::string();
    if (n >= 10) return "9+";
    return std::to_string(n);
}

std::string BadgeDescription(int n) {
    if (n <= 0) return std::string();
    // "1 mensagem nao lida" e "<n> mensagens nao lidas", com o til (UTF-8).
    if (n == 1) return "1 mensagem n\xc3\xa3o lida";
    return std::to_string(n) + " mensagens n\xc3\xa3o lidas";
}

std::string SafeDownloadName(const std::string& nome) {
    std::u32string name;
    for (const char32_t code : Decode(nome)) {
        // Antes de tudo (e antes do UTF-16): o UTF-8 quebrado, os de controle (tambem o NUL) e os da direcao do texto.
        if (code == kInvalid || IsControl(code) || IsBidiControl(code)) continue;
        if (code == U'/' || code == U'\\') {
            name.clear();   // so a parte depois da ultima barra
            continue;
        }
        if (!IsForbidden(code)) name.push_back(code);
    }
    name = Limit(TrimDotsAndSpaces(name), kMaxNameChars);
    if (name.empty()) return kDefaultName;
    // O "_" na frente nunca e de um nome reservado (e o corte mantem o comeco).
    if (IsReserved(name)) name = Limit(U"_" + name, kMaxNameChars);
    return Encode(name);
}

std::string FreeName(const std::string& nome, const std::function<bool(const std::string&)>& exists) {
    if (!exists(nome)) return nome;
    // A extensao e a do ultimo ponto (no UTF-8, o "." e sempre um byte so), menos o do comeco.
    const size_t dot = nome.rfind('.');
    const bool extension = dot != std::string::npos && dot > 0;
    const std::string stem = extension ? nome.substr(0, dot) : nome;
    const std::string suffix = extension ? nome.substr(dot) : std::string();
    for (int copy = 2; copy <= kMaxCopy; ++copy) {
        const std::string candidate = stem + " (" + std::to_string(copy) + ")" + suffix;
        if (!exists(candidate)) return candidate;
    }
    return std::string();
}

std::string ZoneIdentifier() { return std::string("[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=") + kChatOrigin + "/\r\n"; }

std::string FitNoticeText(const std::string& utf8, size_t maxUtf16Units) {
    const std::u32string text = Decode(utf8);
    // Fora do plano basico, um par substituto (duas unidades); o kInvalid e o U+FFFD (uma).
    const auto units = [](char32_t code) -> size_t { return code != kInvalid && code > 0xFFFF ? 2 : 1; };
    size_t total = 0;
    for (const char32_t code : text) total += units(code);
    if (total <= maxUtf16Units) return utf8;
    if (maxUtf16Units == 0) return std::string();
    // O U+2026 e uma unidade: o resto vai em pontos de codigo inteiros ate o limite menos ela.
    std::u32string kept;
    size_t used = 0;
    for (const char32_t code : text) {
        if (used + units(code) > maxUtf16Units - 1) break;
        kept.push_back(code);
        used += units(code);
    }
    return Encode(kept) + kEllipsis;
}

}  // namespace starsonic
