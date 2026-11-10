#pragma once
// O modulo H.264 da Cisco (OpenH264): a licenca da Cisco deixa o app baixar o binario dela para o computador da
// pessoa, nunca levar dentro do app. O download vem por HTTP (o servidor de binarios da Cisco nao tem HTTPS) e so
// vale depois de conferido pelas duas impressoes (SHA-256) fixadas: a do .bz2 e a do .dll. O disco, a rede e o bzip2
// entram por H264Io, e o codigo e portatil (testado no Linux).
#include <cstddef>
#include <functional>
#include <optional>
#include <string>
#include <vector>

struct H264Pin {
    std::string version, url, file, bz2Sha256, dllSha256;   // sha em hex minusculo
};

enum class H264State { Off, Downloading, Installed, Failed };

struct FetchResult {
    int status = 0;
    std::string body;
    std::string error;   // "tempo", "rede", "grande"...
};

struct H264Io {
    std::function<std::optional<std::string>(const std::string& path)> read;
    std::function<bool(const std::string& path, const std::string& bytes)> write;   // atomico
    std::function<bool(const std::string& path)> remove;
    std::function<std::vector<std::string>(const std::string& folder)> list;         // os nomes
    std::function<FetchResult(const std::string& url, size_t maxBytes, int timeoutMs)> fetch;
    std::function<std::optional<std::string>(const std::string& compressed, size_t maxOut)> bunzip;
    std::function<void(const std::string& line)> log;
};

class H264Module {
public:
    H264Module(H264Pin pin, std::string folder, H264Io io);
    std::string ModulePath() const;   // folder + separador + pin.file
    H264State Ensure();               // bloqueante; roda fora da fila dos comandos
    bool Verify() const;              // so confere: o arquivo existe e a impressao bate

private:
    void Log(const std::string& line) const;

    H264Pin pin_;
    std::string folder_;
    H264Io io_;
};
