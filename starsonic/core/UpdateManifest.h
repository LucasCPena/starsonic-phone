#pragma once
// Arquivo de versão publicado em cada release (versao.json, spec seção 7.4).
#include <string>

namespace starsonic {

struct Version {
    int major = 0, minor = 0, patch = 0, rc = 0;   // rc == 0 → versão final
};

// Aceita "X.Y.Z" ou "X.Y.Z-rc.N" (N >= 1), só dígitos, até 9 por número.
bool ParseVersion(const std::string& text, Version* out);
int CompareVersions(const Version& a, const Version& b);   // <0, 0, >0; final > qualquer rc da mesma versão

struct Manifest {
    Version version;
    std::string versionText, installerUrl, sha256;   // sha256 em minúsculas
    std::wstring notes;                              // até 500 unidades + "…"
};

// O instalador precisa começar exatamente com allowedUrlPrefix e o resto só pode ter
// letras, dígitos, '.', '_', '-' e '/', sem "..". Em caso de erro, *out não muda e
// *error (se não for nulo) recebe o motivo, em ASCII, para o log.
bool ParseManifest(const std::string& utf8Json, const std::string& allowedUrlPrefix,
                   Manifest* out, std::string* error);

}  // namespace starsonic
