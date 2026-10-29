#include "PushDataCheck.h"

#include <cstddef>

namespace starsonic {
namespace {

const size_t kMaxNameLength = 64;
const size_t kMaxValueLength = 512;

// Os cabeçalhos que o motor ou a libre já escrevem no REGISTER: um igual, vindo dos dados de push, o repetiria.
const char* const kEngineHeaders[] = {"Via", "From", "To", "Call-ID", "CSeq", "Contact", "Expires", "Max-Forwards",
                                      "Route", "Authorization", "User-Agent", "Content-Length"};

bool IsLetter(char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'); }
bool IsDigit(char c) { return c >= '0' && c <= '9'; }
bool IsHexDigit(char c) { return IsDigit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'); }

bool IsOneOf(char c, const char* set) {
    for (; *set; ++set) {
        if (*set == c) return true;
    }
    return false;
}

char AsciiLower(char c) { return (c >= 'A' && c <= 'Z') ? static_cast<char>(c - 'A' + 'a') : c; }

// Igual, sem diferença de maiúsculas (só ASCII, sem depender do locale).
bool SameName(const std::string& name, const char* other) {
    size_t i = 0;
    for (; i < name.size() && other[i]; ++i) {
        if (AsciiLower(name[i]) != AsciiLower(other[i])) return false;
    }
    return i == name.size() && !other[i];
}

// O token da RFC 3261, que serve de nome de parâmetro e de cabeçalho (sem tamanho: ver kMaxNameLength).
bool IsToken(const std::string& name) {
    for (char c : name) {
        if (!IsLetter(c) && !IsDigit(c) && !IsOneOf(c, "-.!%*_+`'~")) return false;
    }
    return true;
}

// O paramchar da RFC 3261: letras, dígitos, -_.!~*'()[]/:&+$ e o % com dois dígitos hexadecimais depois.
bool IsParamValue(const std::string& value) {
    for (size_t i = 0; i < value.size(); ++i) {
        const char c = value[i];
        if (c == '%') {
            if (i + 2 >= value.size() || !IsHexDigit(value[i + 1]) || !IsHexDigit(value[i + 2])) return false;
            i += 2;
        } else if (!IsLetter(c) && !IsDigit(c) && !IsOneOf(c, "-_.!~*'()[]/:&+$")) {
            return false;
        }
    }
    return true;
}

// ASCII visível e espaço: nada de controle (nem CR e LF, que acabariam o cabeçalho) e nada fora do ASCII.
bool IsHeaderValue(const std::string& value) {
    for (char c : value) {
        const unsigned char byte = static_cast<unsigned char>(c);
        if (byte < 0x20 || byte > 0x7e) return false;
    }
    return true;
}

bool IsEngineHeader(const std::string& name) {
    for (const char* engine : kEngineHeaders) {
        if (SameName(name, engine)) return true;
    }
    return false;
}

}  // namespace

// Os nomes entram no motivo só depois de passarem na conferência do token; os valores nunca entram.
std::string PushDataProblem(const PushData& data) {
    for (const auto& param : data.contactParams) {
        const std::string& name = param.first;
        const std::string& value = param.second;
        if (name.empty() || name.size() > kMaxNameLength) return "nome de parametro vazio ou longo demais";
        if (!IsToken(name)) return "nome de parametro com caractere invalido";
        if (SameName(name, "transport")) return "o parametro transport e do motor";
        if (value.size() > kMaxValueLength) return "valor do parametro " + name + " longo demais";
        if (!IsParamValue(value)) return "valor do parametro " + name + " com caractere invalido";
    }
    for (const auto& header : data.headers) {
        const std::string& name = header.first;
        const std::string& value = header.second;
        if (name.empty() || name.size() > kMaxNameLength) return "nome de cabecalho vazio ou longo demais";
        if (!IsToken(name)) return "nome de cabecalho com caractere invalido";
        if (IsEngineHeader(name)) return "o cabecalho " + name + " e do motor";
        if (value.empty() || value.size() > kMaxValueLength) {
            return "valor do cabecalho " + name + " vazio ou longo demais";
        }
        if (!IsHeaderValue(value)) return "valor do cabecalho " + name + " com caractere de controle ou fora do ASCII";
    }
    return std::string();
}

}  // namespace starsonic
