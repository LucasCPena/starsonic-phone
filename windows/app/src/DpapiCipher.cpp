#include "DpapiCipher.h"

#include <windows.h>
#include <wincrypt.h>

#include <vector>

namespace starsonic {

namespace {

// Separa a senha do Starsonic Phone de outros segredos do mesmo usuario (o DPAPI exige a mesma entropia para
// decifrar).
const char kEntropy[] = "Starsonic Phone/contas";

DATA_BLOB Blob(const void* data, size_t size) {
    DATA_BLOB blob;
    blob.cbData = static_cast<DWORD>(size);
    blob.pbData = static_cast<BYTE*>(const_cast<void*>(data));
    return blob;
}

std::optional<std::string> ToBase64(const BYTE* data, DWORD size) {
    const DWORD flags = CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF;
    DWORD length = 0;
    if (!CryptBinaryToStringA(data, size, flags, nullptr, &length) || length == 0) return std::nullopt;
    std::string out(length, '\0');
    if (!CryptBinaryToStringA(data, size, flags, &out[0], &length)) return std::nullopt;
    out.resize(length);   // sem o '\0' do fim
    return out;
}

bool IsBase64(const std::string& text) {
    if (text.empty() || text.size() % 4 != 0) return false;
    for (size_t i = 0; i < text.size(); ++i) {
        const char ch = text[i];
        const bool letter = (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') ||
                            ch == '+' || ch == '/';
        const bool padding = ch == '=' && i + 2 >= text.size();
        if (!letter && !padding) return false;
    }
    return true;
}

std::optional<std::vector<BYTE>> FromBase64(const std::string& text) {
    // O CryptStringToBinaryA aceita espacos e quebras no meio; o contas.json so tem o que o Protect gravou.
    if (!IsBase64(text)) return std::nullopt;
    DWORD size = 0;
    if (!CryptStringToBinaryA(text.data(), static_cast<DWORD>(text.size()), CRYPT_STRING_BASE64, nullptr, &size,
                              nullptr, nullptr) ||
        size == 0) {
        return std::nullopt;
    }
    std::vector<BYTE> out(size);
    if (!CryptStringToBinaryA(text.data(), static_cast<DWORD>(text.size()), CRYPT_STRING_BASE64, out.data(), &size,
                              nullptr, nullptr)) {
        return std::nullopt;
    }
    out.resize(size);
    return out;
}

}  // namespace

std::optional<std::string> DpapiCipher::Protect(const std::string& utf8) {
    const BYTE empty = 0;
    DATA_BLOB input = utf8.empty() ? Blob(&empty, 0) : Blob(utf8.data(), utf8.size());
    DATA_BLOB entropy = Blob(kEntropy, sizeof(kEntropy) - 1);
    DATA_BLOB output = {};
    if (!CryptProtectData(&input, L"Starsonic Phone", &entropy, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &output)) {
        return std::nullopt;
    }
    std::optional<std::string> encoded = ToBase64(output.pbData, output.cbData);
    SecureZeroMemory(output.pbData, output.cbData);
    LocalFree(output.pbData);
    return encoded;
}

std::optional<std::string> DpapiCipher::Unprotect(const std::string& base64) {
    std::optional<std::vector<BYTE>> sealed = FromBase64(base64);
    if (!sealed) return std::nullopt;
    DATA_BLOB input = Blob(sealed->data(), sealed->size());
    DATA_BLOB entropy = Blob(kEntropy, sizeof(kEntropy) - 1);
    DATA_BLOB output = {};
    if (!CryptUnprotectData(&input, nullptr, &entropy, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &output)) {
        return std::nullopt;
    }
    std::string text(reinterpret_cast<const char*>(output.pbData), output.cbData);
    SecureZeroMemory(output.pbData, output.cbData);
    LocalFree(output.pbData);
    return text;
}

}  // namespace starsonic
