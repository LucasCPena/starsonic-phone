// O Bunzip2 (windows/app/src/Bunzip.h) com a libbz2 de verdade: o buffer comprimido no proprio teste.
#include <bzlib.h>

#include <string>

#include "Bunzip.h"
#include "test_support.h"

namespace {

std::string Compress(const std::string& data) {
    unsigned int size = static_cast<unsigned int>(data.size() + data.size() / 100 + 600);
    std::string out(size, '\0');
    std::string copy = data;
    REQUIRE(BZ2_bzBuffToBuffCompress(&out[0], &size, &copy[0], static_cast<unsigned int>(copy.size()), 9, 0, 0) ==
            BZ_OK);
    out.resize(size);
    return out;
}

std::string Sample(size_t size) {
    std::string out;
    for (size_t i = 0; i < size; ++i) out += static_cast<char>('a' + (i * 7 + i / 13) % 26);
    return out;
}

}  // namespace

TEST_CASE("Bunzip2 unpacks a bzip2 buffer") {
    const std::string data = Sample(100000);
    const auto out = Bunzip2(Compress(data), 1 << 20);
    REQUIRE(out.has_value());
    CHECK(*out == data);
    // Exatamente no limite ainda passa.
    CHECK(Bunzip2(Compress(data), data.size()).has_value());
}

TEST_CASE("Bunzip2 refuses garbage") {
    CHECK_FALSE(Bunzip2("this is not bzip2 at all", 1 << 20).has_value());
    CHECK_FALSE(Bunzip2("", 1 << 20).has_value());
    const std::string packed = Compress(Sample(5000));
    CHECK_FALSE(Bunzip2(packed.substr(0, packed.size() / 2), 1 << 20).has_value());   // cortado
    CHECK_FALSE(Bunzip2(packed + "junk", 1 << 20).has_value());                       // lixo depois do fim
}

TEST_CASE("Bunzip2 refuses an output bigger than the limit") {
    const std::string data(2 * 1024 * 1024, 'x');   // comprime a quase nada: uma bomba
    const std::string packed = Compress(data);
    CHECK(packed.size() < 1000);
    CHECK_FALSE(Bunzip2(packed, 1024 * 1024).has_value());
    CHECK_FALSE(Bunzip2(packed, data.size() - 1).has_value());
}
