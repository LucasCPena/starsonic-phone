// O modulo H.264 da Cisco (starsonic/desktop/H264Module.h): o download fixado pelas duas impressoes (SHA-256), a
// conferencia a cada abertura e a limpeza da pasta. O disco, a rede e o bzip2 sao falsos (H264Io). C++ portatil.
#include <map>
#include <set>
#include <string>
#include <vector>

#include "H264Module.h"
#include "Pbkdf2.h"
#include "test_support.h"

using namespace starsonic;

namespace {

std::string Hex(const std::string& bytes) {
    static const char* kDigits = "0123456789abcdef";
    const std::vector<uint8_t> data(bytes.begin(), bytes.end());
    std::string out;
    for (uint8_t byte : Sha256Digest(data)) {
        out += kDigits[byte >> 4];
        out += kDigits[byte & 15];
    }
    return out;
}

const std::string kDll = "fake dll bytes";
const std::string kBz2 = "BZ:" + kDll;
#ifdef _WIN32
const std::string kFolder = "C:\\codecs";
const std::string kSep = "\\";
#else
const std::string kFolder = "/codecs";
const std::string kSep = "/";
#endif
const std::string kPath = kFolder + kSep + "openh264-2.6.0-win32.dll";

struct Fixture {
    H264Pin pin{"2.6.0", "http://ciscobinary.openh264.org/openh264-2.6.0-win32.dll.bz2", "openh264-2.6.0-win32.dll",
                Hex(kBz2), Hex(kDll)};
    std::map<std::string, std::string> files;   // o disco falso, pelo caminho inteiro
    FetchResult reply;
    int fetches = 0;
    size_t lastMax = 0;
    int lastTimeout = 0;
    std::vector<std::string> writes, removes, logs;
    bool writeOk = true;
    bool unpackOk = true;

    Fixture() {
        reply.status = 200;
        reply.body = kBz2;
    }
    H264Io Io() {
        H264Io io;
        io.read = [this](const std::string& path) -> std::optional<std::string> {
            const auto found = files.find(path);
            if (found == files.end()) return std::nullopt;
            return found->second;
        };
        io.write = [this](const std::string& path, const std::string& bytes) {
            writes.push_back(path);
            if (!writeOk) return false;
            files[path] = bytes;
            return true;
        };
        io.remove = [this](const std::string& path) {
            removes.push_back(path);
            files.erase(path);
            return true;
        };
        io.list = [this](const std::string& folder) {
            std::vector<std::string> names;
            for (const auto& entry : files) {
                if (entry.first.compare(0, folder.size() + 1, folder + kSep) == 0) {
                    names.push_back(entry.first.substr(folder.size() + 1));
                }
            }
            return names;
        };
        io.fetch = [this](const std::string&, size_t maxBytes, int timeoutMs) {
            ++fetches;
            lastMax = maxBytes;
            lastTimeout = timeoutMs;
            return reply;
        };
        io.bunzip = [this](const std::string& compressed, size_t) -> std::optional<std::string> {
            if (!unpackOk || compressed.compare(0, 3, "BZ:") != 0) return std::nullopt;
            return compressed.substr(3);
        };
        io.log = [this](const std::string& line) { logs.push_back(line); };
        return io;
    }
    bool Logged(const std::string& line) const {
        for (const auto& item : logs) {
            if (item == line) return true;
        }
        return false;
    }
};

}  // namespace

TEST_CASE("an installed module with the right print is used without downloading") {
    Fixture fx;
    fx.files[kPath] = kDll;
    H264Module module(fx.pin, kFolder, fx.Io());
    CHECK(module.Ensure() == H264State::Installed);
    CHECK(fx.fetches == 0);
    CHECK(fx.Logged("h264: instalado 2.6.0"));
}

TEST_CASE("a missing module is downloaded, checked, unpacked and saved") {
    Fixture fx;
    H264Module module(fx.pin, kFolder, fx.Io());
    CHECK(module.ModulePath() == kPath);
    CHECK(module.Ensure() == H264State::Installed);
    CHECK(fx.fetches == 1);
    REQUIRE(fx.writes.size() == 1);
    CHECK(fx.writes[0] == kPath);
    CHECK(fx.files[kPath] == kDll);
    CHECK(fx.Logged("h264: instalado 2.6.0"));
}

TEST_CASE("a download with the wrong print is refused and nothing is saved") {
    Fixture fx;
    fx.reply.body = "BZ:other bytes";
    H264Module module(fx.pin, kFolder, fx.Io());
    CHECK(module.Ensure() == H264State::Failed);
    CHECK(fx.writes.empty());
    CHECK(fx.Logged("h264: arquivo nao confere, apagado"));
}

TEST_CASE("an unpacked module with the wrong print is refused") {
    Fixture fx;
    fx.pin.dllSha256 = Hex("another dll");
    H264Module module(fx.pin, kFolder, fx.Io());
    CHECK(module.Ensure() == H264State::Failed);
    CHECK(fx.writes.empty());
    CHECK(fx.Logged("h264: arquivo nao confere, apagado"));
}

TEST_CASE("an unpack failure and a write failure give Failed with the reason") {
    Fixture bad;
    bad.unpackOk = false;
    CHECK(H264Module(bad.pin, kFolder, bad.Io()).Ensure() == H264State::Failed);
    CHECK(bad.Logged("h264: download falhou (bzip2)"));
    CHECK(bad.writes.empty());

    Fixture full;
    full.writeOk = false;
    CHECK(H264Module(full.pin, kFolder, full.Io()).Ensure() == H264State::Failed);
    CHECK(full.Logged("h264: download falhou (gravar)"));
}

TEST_CASE("a saved module with the wrong print is removed and downloaded again") {
    Fixture fx;
    fx.files[kPath] = "corrupted";
    H264Module module(fx.pin, kFolder, fx.Io());
    CHECK(module.Ensure() == H264State::Installed);
    CHECK(fx.Logged("h264: arquivo nao confere, apagado"));
    CHECK(fx.fetches == 1);
    CHECK(fx.files[kPath] == kDll);
    CHECK(fx.Logged("h264: instalado 2.6.0"));
}

TEST_CASE("other versions and leftovers are removed") {
    Fixture fx;
    fx.files[kFolder + kSep + "openh264-2.4.1-win32.dll"] = "old";
    fx.files[kFolder + kSep + "x.part"] = "half";
    fx.files[kFolder + kSep + "notes.txt"] = "keep";
    fx.files[kPath] = kDll;
    H264Module module(fx.pin, kFolder, fx.Io());
    CHECK(module.Ensure() == H264State::Installed);
    const std::set<std::string> removed(fx.removes.begin(), fx.removes.end());
    CHECK(removed.count(kFolder + kSep + "openh264-2.4.1-win32.dll") == 1);
    CHECK(removed.count(kFolder + kSep + "x.part") == 1);
    CHECK(removed.count(kPath) == 0);
    CHECK(removed.count(kFolder + kSep + "notes.txt") == 0);
}

TEST_CASE("a failed fetch gives Failed with the code") {
    {
        Fixture fx;
        fx.reply.status = 404;
        CHECK(H264Module(fx.pin, kFolder, fx.Io()).Ensure() == H264State::Failed);
        CHECK(fx.Logged("h264: download falhou (404)"));
        CHECK(fx.writes.empty());
    }
    {
        Fixture fx;
        fx.reply.status = 301;
        CHECK(H264Module(fx.pin, kFolder, fx.Io()).Ensure() == H264State::Failed);
        CHECK(fx.Logged("h264: download falhou (301)"));
    }
    {
        Fixture fx;
        fx.reply.status = 0;
        fx.reply.error = "tempo";
        CHECK(H264Module(fx.pin, kFolder, fx.Io()).Ensure() == H264State::Failed);
        CHECK(fx.Logged("h264: download falhou (tempo)"));
    }
}

TEST_CASE("the download asks for at most 4 MiB within 60 s") {
    Fixture fx;
    H264Module module(fx.pin, kFolder, fx.Io());
    module.Ensure();
    CHECK(fx.lastMax == 4194304);
    CHECK(fx.lastTimeout == 60000);
}

TEST_CASE("Verify checks the print without downloading") {
    Fixture fx;
    H264Module module(fx.pin, kFolder, fx.Io());
    CHECK_FALSE(module.Verify());
    fx.files[kPath] = "corrupted";
    CHECK_FALSE(module.Verify());
    fx.files[kPath] = kDll;
    CHECK(module.Verify());
    CHECK(fx.fetches == 0);
    CHECK(fx.writes.empty());
    CHECK(fx.removes.empty());
}

TEST_CASE("the module path does not double a trailing separator") {
    Fixture fx;
#ifdef _WIN32
    CHECK(H264Module(fx.pin, "C:\\codecs\\", fx.Io()).ModulePath() == "C:\\codecs\\openh264-2.6.0-win32.dll");
#else
    CHECK(H264Module(fx.pin, "/codecs/", fx.Io()).ModulePath() == "/codecs/openh264-2.6.0-win32.dll");
    CHECK(H264Module(fx.pin, "/codecs", fx.Io()).ModulePath() == "/codecs/openh264-2.6.0-win32.dll");
#endif
}
