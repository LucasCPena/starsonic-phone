// Testes do SHA-256 e do PBKDF2-HMAC-SHA256 portateis (starsonic/desktop/Pbkdf2.h): vetores publicados (FIPS 180-4,
// RFC 4231, RFC 7914 e os usuais do PBKDF2-HMAC-SHA256).
#include <cstdint>
#include <string>
#include <vector>

#include "Pbkdf2.h"
#include "test_support.h"

using namespace starsonic;

namespace {

std::string Hex(const std::vector<uint8_t>& bytes) {
    static const char kDigits[] = "0123456789abcdef";
    std::string out;
    for (uint8_t byte : bytes) {
        out.push_back(kDigits[byte >> 4]);
        out.push_back(kDigits[byte & 0x0F]);
    }
    return out;
}

std::vector<uint8_t> Bytes(const std::string& text) { return std::vector<uint8_t>(text.begin(), text.end()); }

}  // namespace

TEST_CASE("sha256 matches the FIPS 180-4 vectors") {
    CHECK(Hex(Sha256Digest(Bytes(""))) == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    CHECK(Hex(Sha256Digest(Bytes("abc"))) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    CHECK(Hex(Sha256Digest(Bytes("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))) ==
          "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
    // Um milhao de 'a', em pedacos de tamanhos diferentes: passa pelos limites do bloco de 64 bytes.
    Sha256 hasher;
    const std::string chunk(1000, 'a');
    for (int i = 0; i < 1000; ++i) hasher.Update(reinterpret_cast<const uint8_t*>(chunk.data()), chunk.size());
    CHECK(Hex(hasher.Final()) == "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
}

TEST_CASE("hmac sha256 matches the RFC 4231 vectors") {
    CHECK(Hex(HmacSha256(std::vector<uint8_t>(20, 0x0b), Bytes("Hi There"))) ==
          "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7");
    CHECK(Hex(HmacSha256(Bytes("Jefe"), Bytes("what do ya want for nothing?"))) ==
          "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
    // Chave maior que o bloco: entra pelo SHA-256 dela.
    CHECK(Hex(HmacSha256(std::vector<uint8_t>(131, 0xaa),
                         Bytes("Test Using Larger Than Block-Size Key - Hash Key First"))) ==
          "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54");
}

TEST_CASE("pbkdf2 matches RFC 7914 / RFC 6070-style vectors for HMAC-SHA256") {
    const std::vector<uint8_t> salt = Bytes("salt");
    CHECK(Hex(Pbkdf2HmacSha256(Bytes("password"), salt, 1, 32)) ==
          "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b");
    CHECK(Hex(Pbkdf2HmacSha256(Bytes("password"), salt, 2, 32)) ==
          "ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43");
    CHECK(Hex(Pbkdf2HmacSha256(Bytes("password"), salt, 4096, 32)) ==
          "c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a");
    // RFC 7914, secao 11: mais de um bloco de saida (64 bytes).
    CHECK(Hex(Pbkdf2HmacSha256(Bytes("passwd"), salt, 1, 64)) ==
          "55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc"
          "49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783");
    // Senha e sal maiores que o bloco do HMAC, saida que nao e multiplo de 32.
    CHECK(Hex(Pbkdf2HmacSha256(Bytes("passwordPASSWORDpassword"), Bytes("saltSALTsaltSALTsaltSALTsaltSALTsalt"), 4096,
                               40)) ==
          "348c89dbcbd32b2f32d814b8116e84cf2b17347ebc1800181c4e2a1fb8dd53e1c635518c7dac47e9");
}

TEST_CASE("pbkdf2 rejects an empty output and zero iterations") {
    CHECK(Pbkdf2HmacSha256(Bytes("p"), Bytes("s"), 0, 32).empty());
    CHECK(Pbkdf2HmacSha256(Bytes("p"), Bytes("s"), 1, 0).empty());
}
