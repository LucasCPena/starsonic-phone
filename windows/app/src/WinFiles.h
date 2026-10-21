#pragma once
// O disco do app de PC no Windows (spec 6.6): os caminhos UTF-8 do nucleo viram UTF-16 para as APIs W, e a gravacao
// atomica e o <arquivo>.tmp gravado e descarregado no disco, trocado pelo arquivo de uma vez com
// MoveFileExW(MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH): um corte de energia no meio deixa o arquivo de
// antes ou o novo, nunca um pela metade. A pasta do arquivo e criada quando falta.
#include <optional>
#include <string>

#include "Files.h"

namespace starsonic {

class WinFiles : public FileSystem {
public:
    std::optional<std::string> Read(const std::string& path) const override;
    bool WriteAtomic(const std::string& path, const std::string& bytes) override;
    bool Exists(const std::string& path) const override;
    bool Rename(const std::string& from, const std::string& to) override;
};

// A pasta (e as de cima) existe ou foi criada agora. Caminho UTF-16.
bool CreateFolderTree(const std::wstring& folder);

}  // namespace starsonic
