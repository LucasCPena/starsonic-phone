#include "Reunioes.h"

#include <algorithm>
#include <cstring>

namespace starsonic {

namespace {

constexpr size_t kCodeLength = 10;
constexpr size_t kPassLength = 43;
constexpr size_t kRequestIdLength = 16;
const char kCodeAlphabet[] = "abcdefghjkmnpqrstvwxyz23456789";

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

}  // namespace starsonic
