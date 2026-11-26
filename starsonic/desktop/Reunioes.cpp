#include "Reunioes.h"

#include <algorithm>
#include <cstring>

#include "nlohmann/json.hpp"

namespace starsonic {

namespace {

constexpr size_t kCodeLength = 10;
constexpr size_t kPassLength = 43;
constexpr size_t kRequestIdLength = 16;
const char kCodeAlphabet[] = "abcdefghjkmnpqrstvwxyz23456789";
constexpr size_t kMaxLinkChars = 2048;

// Os pontos de codigo de um texto UTF-8 (o JSON lido ja e UTF-8 valido).
size_t CountCodePoints(const std::string& utf8) {
    return static_cast<size_t>(std::count_if(utf8.begin(), utf8.end(),
                                             [](char ch) { return (static_cast<unsigned char>(ch) & 0xC0) != 0x80; }));
}

// U+0000 a U+001F e U+007F a U+009F (o C1 tem dois bytes: 0xC2 e depois 0x80 a 0x9F).
bool HasControl(const std::string& utf8) {
    for (size_t i = 0; i < utf8.size(); ++i) {
        const unsigned char ch = static_cast<unsigned char>(utf8[i]);
        if (ch < 0x20 || ch == 0x7F) return true;
        if (ch == 0xC2 && i + 1 < utf8.size()) {
            const unsigned char next = static_cast<unsigned char>(utf8[i + 1]);
            if (next >= 0x80 && next <= 0x9F) return true;
        }
    }
    return false;
}

bool StartsWithIgnoringCase(const std::string& text, const char* prefix) {
    const size_t length = std::strlen(prefix);
    if (text.size() < length) return false;
    for (size_t i = 0; i < length; ++i) {
        const char ch = text[i];
        if ((ch >= 'A' && ch <= 'Z' ? static_cast<char>(ch + 32) : ch) != prefix[i]) return false;
    }
    return true;
}

}  // namespace

bool ValidMeetingCode(const std::string& code) {
    return code.size() == kCodeLength && std::all_of(code.begin(), code.end(), [](char ch) {
               return ch != '\0' && std::strchr(kCodeAlphabet, ch) != nullptr;
           });
}

bool ValidMeetingPass(const std::string& pass) {
    return pass.size() == kPassLength && std::all_of(pass.begin(), pass.end(), [](char ch) {
               return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '_' ||
                      ch == '-';
           });
}

bool ValidMeetingRequestId(const std::string& id) {
    return id.size() == kRequestIdLength && std::all_of(id.begin(), id.end(), [](char ch) {
               return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f');
           });
}

bool ValidMeetingLinkUrl(const std::string& url) {
    size_t start = 0;
    if (StartsWithIgnoringCase(url, "https://")) {
        start = 8;
    } else if (StartsWithIgnoringCase(url, "http://")) {
        start = 7;
    } else {
        return false;
    }
    // Um servidor depois do esquema: nada de "https://" nem de "https:///x".
    if (url.size() == start || url[start] == '/' || url[start] == '?' || url[start] == '#') return false;
    if (url.find(' ') != std::string::npos || HasControl(url)) return false;
    return CountCodePoints(url) <= kMaxLinkChars;
}

std::string SessionMessage(bool locked) {
    return nlohmann::ordered_json({{"v", 1}, {"type", "sessao"}, {"bloqueada", locked}}).dump();
}

std::string OpenMeetingMessage(const std::string& code) {
    return nlohmann::ordered_json({{"v", 1}, {"type", "abrir"}, {"tela", "reuniao"}, {"codigo", code}}).dump();
}

}  // namespace starsonic
