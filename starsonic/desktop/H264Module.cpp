#include "H264Module.h"

#include <utility>

#include "Pbkdf2.h"

namespace {

const size_t kMaxDownload = 4194304;    // 4 MiB comprimidos
const size_t kMaxUnpacked = 8388608;    // 8 MiB descomprimidos
const int kDownloadTimeoutMs = 60000;

std::string HexSha256(const std::string& bytes) {
    static const char* const kDigits = "0123456789abcdef";
    const std::vector<uint8_t> data(bytes.begin(), bytes.end());
    std::string out;
    for (const uint8_t byte : starsonic::Sha256Digest(data)) {
        out += kDigits[byte >> 4];
        out += kDigits[byte & 15];
    }
    return out;
}

bool StartsWith(const std::string& text, const std::string& prefix) {
    return text.compare(0, prefix.size(), prefix) == 0;
}

bool EndsWith(const std::string& text, const std::string& suffix) {
    return text.size() >= suffix.size() && text.compare(text.size() - suffix.size(), suffix.size(), suffix) == 0;
}

}  // namespace

H264Module::H264Module(H264Pin pin, std::string folder, H264Io io)
    : pin_(std::move(pin)), folder_(std::move(folder)), io_(std::move(io)) {}

void H264Module::Log(const std::string& line) const {
    if (io_.log) io_.log(line);
}

std::string H264Module::ModulePath() const {
#ifdef _WIN32
    const char separator = '\\';
    const bool ends = !folder_.empty() && (folder_.back() == '\\' || folder_.back() == '/');
#else
    const char separator = '/';
    const bool ends = !folder_.empty() && folder_.back() == '/';
#endif
    return ends ? folder_ + pin_.file : folder_ + separator + pin_.file;
}

bool H264Module::Verify() const {
    const auto bytes = io_.read(ModulePath());
    return bytes && HexSha256(*bytes) == pin_.dllSha256;
}

H264State H264Module::Ensure() {
    const std::string path = ModulePath();
    const std::string base = path.substr(0, path.size() - pin_.file.size());

    // 1. Outras versoes e restos de download ficam fora da pasta.
    for (const std::string& name : io_.list(folder_)) {
        const bool otherVersion = StartsWith(name, "openh264-") && EndsWith(name, ".dll") && name != pin_.file;
        if (otherVersion || EndsWith(name, ".part")) io_.remove(base + name);
    }

    // 2. O arquivo ja gravado: vale com a impressao certa; com outra, sai.
    if (const auto saved = io_.read(path)) {
        if (HexSha256(*saved) == pin_.dllSha256) {
            Log("h264: instalado " + pin_.version);
            return H264State::Installed;
        }
        io_.remove(path);
        Log("h264: arquivo nao confere, apagado");
    }

    // 3. O download.
    const FetchResult reply = io_.fetch(pin_.url, kMaxDownload, kDownloadTimeoutMs);
    if (reply.status != 200 || !reply.error.empty()) {
        Log("h264: download falhou (" + (reply.error.empty() ? std::to_string(reply.status) : reply.error) + ")");
        return H264State::Failed;
    }

    // 4. A impressao do .bz2, antes de qualquer descompressao.
    if (HexSha256(reply.body) != pin_.bz2Sha256) {
        Log("h264: arquivo nao confere, apagado");
        return H264State::Failed;
    }

    // 5. A descompressao, com o teto de saida.
    const auto dll = io_.bunzip(reply.body, kMaxUnpacked);
    if (!dll) {
        Log("h264: download falhou (bzip2)");
        return H264State::Failed;
    }

    // 6. A impressao do .dll.
    if (HexSha256(*dll) != pin_.dllSha256) {
        Log("h264: arquivo nao confere, apagado");
        return H264State::Failed;
    }

    // 7. A gravacao (atomica, pelo H264Io).
    if (!io_.write(path, *dll)) {
        Log("h264: download falhou (gravar)");
        return H264State::Failed;
    }

    // 8.
    Log("h264: instalado " + pin_.version);
    return H264State::Installed;
}
