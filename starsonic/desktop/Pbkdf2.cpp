#include "Pbkdf2.h"

#include <cstring>

namespace starsonic {

namespace {

const uint32_t kRoundConstants[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2};

inline uint32_t RotateRight(uint32_t value, unsigned bits) { return (value >> bits) | (value << (32u - bits)); }

}  // namespace

Sha256::Sha256() { Reset(); }

void Sha256::Reset() {
    state_[0] = 0x6a09e667;
    state_[1] = 0xbb67ae85;
    state_[2] = 0x3c6ef372;
    state_[3] = 0xa54ff53a;
    state_[4] = 0x510e527f;
    state_[5] = 0x9b05688c;
    state_[6] = 0x1f83d9ab;
    state_[7] = 0x5be0cd19;
    std::memset(buffer_, 0, sizeof(buffer_));
    buffered_ = 0;
    totalBytes_ = 0;
}

void Sha256::Compress(const uint8_t* block) {
    uint32_t w[64];
    for (size_t i = 0; i < 16; ++i) {
        w[i] = (static_cast<uint32_t>(block[i * 4]) << 24) | (static_cast<uint32_t>(block[i * 4 + 1]) << 16) |
               (static_cast<uint32_t>(block[i * 4 + 2]) << 8) | static_cast<uint32_t>(block[i * 4 + 3]);
    }
    for (size_t i = 16; i < 64; ++i) {
        const uint32_t s0 = RotateRight(w[i - 15], 7) ^ RotateRight(w[i - 15], 18) ^ (w[i - 15] >> 3);
        const uint32_t s1 = RotateRight(w[i - 2], 17) ^ RotateRight(w[i - 2], 19) ^ (w[i - 2] >> 10);
        w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    uint32_t a = state_[0], b = state_[1], c = state_[2], d = state_[3];
    uint32_t e = state_[4], f = state_[5], g = state_[6], h = state_[7];
    for (size_t i = 0; i < 64; ++i) {
        const uint32_t s1 = RotateRight(e, 6) ^ RotateRight(e, 11) ^ RotateRight(e, 25);
        const uint32_t choice = (e & f) ^ (~e & g);
        const uint32_t temp1 = h + s1 + choice + kRoundConstants[i] + w[i];
        const uint32_t s0 = RotateRight(a, 2) ^ RotateRight(a, 13) ^ RotateRight(a, 22);
        const uint32_t majority = (a & b) ^ (a & c) ^ (b & c);
        const uint32_t temp2 = s0 + majority;
        h = g;
        g = f;
        f = e;
        e = d + temp1;
        d = c;
        c = b;
        b = a;
        a = temp1 + temp2;
    }
    state_[0] += a;
    state_[1] += b;
    state_[2] += c;
    state_[3] += d;
    state_[4] += e;
    state_[5] += f;
    state_[6] += g;
    state_[7] += h;
}

void Sha256::Update(const uint8_t* data, size_t size) {
    totalBytes_ += size;
    while (size > 0) {
        if (buffered_ == 0 && size >= kBlockSize) {
            Compress(data);
            data += kBlockSize;
            size -= kBlockSize;
            continue;
        }
        size_t take = kBlockSize - buffered_;
        if (take > size) take = size;
        std::memcpy(buffer_ + buffered_, data, take);
        buffered_ += take;
        data += take;
        size -= take;
        if (buffered_ == kBlockSize) {
            Compress(buffer_);
            buffered_ = 0;
        }
    }
}

std::vector<uint8_t> Sha256::Final() {
    const uint64_t bitLength = totalBytes_ * 8u;
    uint8_t padding[kBlockSize * 2] = {0x80};
    // O preenchimento leva o total a 56 modulo 64; depois, o tamanho em bits em 8 bytes (big endian).
    const size_t padLength = (buffered_ < 56) ? (56 - buffered_) : (120 - buffered_);
    for (size_t i = 0; i < 8; ++i) {
        padding[padLength + i] = static_cast<uint8_t>(bitLength >> (56 - 8 * i));
    }
    Update(padding, padLength + 8);
    std::vector<uint8_t> digest(kDigestSize);
    for (size_t i = 0; i < 8; ++i) {
        digest[i * 4] = static_cast<uint8_t>(state_[i] >> 24);
        digest[i * 4 + 1] = static_cast<uint8_t>(state_[i] >> 16);
        digest[i * 4 + 2] = static_cast<uint8_t>(state_[i] >> 8);
        digest[i * 4 + 3] = static_cast<uint8_t>(state_[i]);
    }
    return digest;
}

std::vector<uint8_t> Sha256Digest(const std::vector<uint8_t>& data) {
    Sha256 hasher;
    if (!data.empty()) hasher.Update(data.data(), data.size());
    return hasher.Final();
}

namespace {

// O HMAC com os dois blocos (chave xor ipad / opad) ja absorvidos: o PBKDF2 repete o HMAC milhares de vezes com a
// mesma chave e so refaz as duas ultimas compressoes.
struct HmacKey {
    Sha256 inner;
    Sha256 outer;
};

HmacKey MakeHmacKey(const std::vector<uint8_t>& key) {
    uint8_t block[Sha256::kBlockSize] = {0};
    if (key.size() > Sha256::kBlockSize) {
        const std::vector<uint8_t> hashed = Sha256Digest(key);
        std::memcpy(block, hashed.data(), hashed.size());
    } else if (!key.empty()) {
        std::memcpy(block, key.data(), key.size());
    }
    uint8_t inner[Sha256::kBlockSize];
    uint8_t outer[Sha256::kBlockSize];
    for (size_t i = 0; i < Sha256::kBlockSize; ++i) {
        inner[i] = static_cast<uint8_t>(block[i] ^ 0x36);
        outer[i] = static_cast<uint8_t>(block[i] ^ 0x5c);
    }
    HmacKey result;
    result.inner.Update(inner, sizeof(inner));
    result.outer.Update(outer, sizeof(outer));
    return result;
}

std::vector<uint8_t> HmacWith(const HmacKey& key, const uint8_t* message, size_t size) {
    Sha256 inner = key.inner;
    if (size > 0) inner.Update(message, size);
    const std::vector<uint8_t> innerDigest = inner.Final();
    Sha256 outer = key.outer;
    outer.Update(innerDigest.data(), innerDigest.size());
    return outer.Final();
}

}  // namespace

std::vector<uint8_t> HmacSha256(const std::vector<uint8_t>& key, const std::vector<uint8_t>& message) {
    const HmacKey prepared = MakeHmacKey(key);
    return HmacWith(prepared, message.data(), message.size());
}

std::vector<uint8_t> Pbkdf2HmacSha256(const std::vector<uint8_t>& password, const std::vector<uint8_t>& salt,
                                      uint32_t iterations, size_t dkLen) {
    if (iterations == 0 || dkLen == 0) return {};
    const uint64_t blocks = (static_cast<uint64_t>(dkLen) + Sha256::kDigestSize - 1) / Sha256::kDigestSize;
    if (blocks > 0xFFFFFFFFull) return {};
    const HmacKey key = MakeHmacKey(password);
    std::vector<uint8_t> derived;
    derived.reserve(static_cast<size_t>(blocks) * Sha256::kDigestSize);
    for (uint32_t index = 1; index <= blocks; ++index) {
        // U1 = HMAC(senha, sal || INT(index)); Ui = HMAC(senha, Ui-1); T = U1 xor U2 xor ... xor Uc.
        std::vector<uint8_t> message = salt;
        message.push_back(static_cast<uint8_t>(index >> 24));
        message.push_back(static_cast<uint8_t>(index >> 16));
        message.push_back(static_cast<uint8_t>(index >> 8));
        message.push_back(static_cast<uint8_t>(index));
        std::vector<uint8_t> u = HmacWith(key, message.data(), message.size());
        std::vector<uint8_t> t = u;
        for (uint32_t i = 1; i < iterations; ++i) {
            u = HmacWith(key, u.data(), u.size());
            for (size_t j = 0; j < t.size(); ++j) t[j] = static_cast<uint8_t>(t[j] ^ u[j]);
        }
        derived.insert(derived.end(), t.begin(), t.end());
    }
    derived.resize(dkLen);
    return derived;
}

}  // namespace starsonic
