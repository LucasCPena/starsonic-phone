#pragma once
// O disco, visto pelas lojas do app de PC (spec 6.6). O app de PC tem a implementacao do Windows
// (arquivo temporario + MoveFileEx); aqui ficam so a interface e uma implementacao em memoria, para os testes.
// Os caminhos sao UTF-8.
#include <map>
#include <optional>
#include <string>

namespace starsonic {

class FileSystem {
public:
    virtual ~FileSystem() = default;

    // Os bytes do arquivo, ou nullopt se ele nao existe ou nao pode ser lido.
    virtual std::optional<std::string> Read(const std::string& path) const = 0;

    // Grava <path>.tmp e troca <path> por ele de uma vez: um corte no meio nunca deixa o arquivo pela metade.
    // false se nao gravou (o arquivo de antes continua como estava).
    virtual bool WriteAtomic(const std::string& path, const std::string& bytes) = 0;

    virtual bool Exists(const std::string& path) const = 0;

    // Renomeia (e troca o destino, se ele existir). false se nao renomeou.
    virtual bool Rename(const std::string& from, const std::string& to) = 0;
};

// Um disco na memoria, para os testes. failWrites faz toda gravacao e todo Rename falharem.
class MemoryFileSystem : public FileSystem {
public:
    std::map<std::string, std::string> files;
    bool failWrites = false;
    int writeCount = 0;   // quantas gravacoes deram certo

    std::optional<std::string> Read(const std::string& path) const override {
        const auto found = files.find(path);
        if (found == files.end()) return std::nullopt;
        return found->second;
    }

    bool WriteAtomic(const std::string& path, const std::string& bytes) override {
        if (failWrites) return false;
        files[path + ".tmp"] = bytes;
        if (!Rename(path + ".tmp", path)) return false;
        ++writeCount;
        return true;
    }

    bool Exists(const std::string& path) const override { return files.count(path) != 0; }

    bool Rename(const std::string& from, const std::string& to) override {
        if (failWrites) return false;
        const auto found = files.find(from);
        if (found == files.end()) return false;
        std::string bytes = found->second;
        files.erase(found);
        files[to] = std::move(bytes);
        return true;
    }
};

}  // namespace starsonic
