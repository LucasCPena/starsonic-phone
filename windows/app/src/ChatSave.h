#pragma once
// O arquivo baixado do chat no disco (0.2.0; spec do chat, 6.4; so no Windows): o nome limpo (SafeDownloadName), o
// "(2)" quando ele ja existe na pasta (FreeName) e o fluxo Zone.Identifier (o "Mark of the Web", ZoneIdentifier: o
// Windows avisa antes de abrir um programa que veio do chat). As regras ficam no ChatFiles.h (portatil).
#include <string>

namespace starsonic {

// Grava os bytes na pasta, com o FreeName(SafeDownloadName(nome)) e o CREATE_NEW (se outro arquivo chegou antes com o
// mesmo nome, tenta o proximo), e o <caminho>:Zone.Identifier com o ZoneIdentifier(). Devolve o caminho, ou "" se
// falhou. O arquivo que nao foi gravado inteiro, ou que ficou sem o Zone.Identifier (um disco sem fluxos), sai da
// pasta: nenhum arquivo do chat fica (e abre) sem a marca da internet.
std::wstring SaveChatFile(const std::wstring& pasta, const std::string& nome, const std::string& bytes);

}  // namespace starsonic
