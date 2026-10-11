#include "test_support.h"
#include "Sha256.h"

#include <string>

TEST_CASE("Sha256Hex matches the FIPS 180-2 examples") {
    CHECK(Sha256Hex("") == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    CHECK(Sha256Hex("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
}

TEST_CASE("Sha256Hex hashes binary data with zero bytes") {
    const std::string data("a\0b", 3);
    CHECK(Sha256Hex(data).size() == 64);
    CHECK(Sha256Hex(data) != Sha256Hex("ab"));
}
