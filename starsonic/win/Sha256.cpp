// Win32 puro (sem MFC): compilado sem o cabecalho pre-compilado do MicroSIP (starsonic.targets).
#include "Sha256.h"

#include <windows.h>
#include <bcrypt.h>

#include <algorithm>
#include <vector>

#pragma comment(lib, "bcrypt.lib")

#ifndef BCRYPT_SUCCESS
#define BCRYPT_SUCCESS(status) (((NTSTATUS)(status)) >= 0)
#endif

namespace {

// Fecha o algoritmo e o hash na saida de qualquer caminho.
struct BcryptHandles {
    BCRYPT_ALG_HANDLE algorithm = NULL;
    BCRYPT_HASH_HANDLE hash = NULL;
    ~BcryptHandles() {
        if (hash) BCryptDestroyHash(hash);
        if (algorithm) BCryptCloseAlgorithmProvider(algorithm, 0);
    }
};

}  // namespace

std::string Sha256Hex(const std::string& bytes) {
    BcryptHandles handles;
    if (!BCRYPT_SUCCESS(BCryptOpenAlgorithmProvider(&handles.algorithm, BCRYPT_SHA256_ALGORITHM, NULL, 0))) {
        return std::string();
    }
    DWORD objectSize = 0;
    DWORD hashSize = 0;
    ULONG written = 0;
    if (!BCRYPT_SUCCESS(BCryptGetProperty(handles.algorithm, BCRYPT_OBJECT_LENGTH,
                                          reinterpret_cast<PUCHAR>(&objectSize), sizeof(objectSize), &written, 0)) ||
        !BCRYPT_SUCCESS(BCryptGetProperty(handles.algorithm, BCRYPT_HASH_LENGTH,
                                          reinterpret_cast<PUCHAR>(&hashSize), sizeof(hashSize), &written, 0))) {
        return std::string();
    }
    std::vector<UCHAR> object(objectSize);
    if (!BCRYPT_SUCCESS(BCryptCreateHash(handles.algorithm, &handles.hash, object.data(), objectSize, NULL, 0, 0))) {
        return std::string();
    }
    // BCryptHashData recebe ULONG: arquivos grandes vao em blocos.
    const size_t kChunk = static_cast<size_t>(1) << 30;
    for (size_t offset = 0; offset < bytes.size();) {
        const ULONG size = static_cast<ULONG>((std::min)(bytes.size() - offset, kChunk));
        PUCHAR data = reinterpret_cast<PUCHAR>(const_cast<char*>(bytes.data() + offset));
        if (!BCRYPT_SUCCESS(BCryptHashData(handles.hash, data, size, 0))) {
            return std::string();
        }
        offset += size;
    }
    std::vector<UCHAR> digest(hashSize);
    if (!BCRYPT_SUCCESS(BCryptFinishHash(handles.hash, digest.data(), hashSize, 0))) {
        return std::string();
    }
    static const char kHex[] = "0123456789abcdef";
    std::string result;
    result.reserve(digest.size() * 2);
    for (UCHAR byte : digest) {
        result += kHex[byte >> 4];
        result += kHex[byte & 0x0F];
    }
    return result;
}
