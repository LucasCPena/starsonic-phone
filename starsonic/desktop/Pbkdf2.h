#pragma once
// SHA-256 (FIPS 180-4), HMAC-SHA256 (RFC 2104) e PBKDF2-HMAC-SHA256 (RFC 8018) portateis: C++ puro, sem Windows, sem
// OpenSSL. Servem so a senha da area do administrador (Admin.h); nao ha aqui nada que dependa de tempo constante,
// fora a comparacao do CheckAdminPassword.
#include <cstddef>
#include <cstdint>
#include <vector>

namespace starsonic {

class Sha256 {
public:
    static constexpr size_t kDigestSize = 32;
    static constexpr size_t kBlockSize = 64;

    Sha256();
    void Update(const uint8_t* data, size_t size);
    // O resumo de tudo o que entrou. Depois dele o objeto nao serve mais (Reset volta ao inicio).
    std::vector<uint8_t> Final();
    void Reset();

private:
    void Compress(const uint8_t* block);

    uint32_t state_[8];
    uint8_t buffer_[kBlockSize];
    size_t buffered_;
    uint64_t totalBytes_;
};

std::vector<uint8_t> Sha256Digest(const std::vector<uint8_t>& data);
std::vector<uint8_t> HmacSha256(const std::vector<uint8_t>& key, const std::vector<uint8_t>& message);

// A chave derivada de dkLen bytes. Vazia se iterations ou dkLen forem zero (ou dkLen passar de 32 * (2^32 - 1)).
std::vector<uint8_t> Pbkdf2HmacSha256(const std::vector<uint8_t>& password, const std::vector<uint8_t>& salt,
                                      uint32_t iterations, size_t dkLen);

}  // namespace starsonic
