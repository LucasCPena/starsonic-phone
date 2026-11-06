#pragma once
// O arquivo baixado do chat no disco (0.2.0; spec do chat, 6.4; so no Windows): o nome limpo (SafeDownloadName), o
// "(2)" quando ele ja existe na pasta (FreeName) e o fluxo Zone.Identifier (o "Mark of the Web", ZoneIdentifier: o
// Windows avisa antes de abrir um programa que veio do chat). As regras ficam no ChatFiles.h (portatil).
#include <string>

namespace starsonic {

// Grava os bytes na pasta, com o FreeName(SafeDownloadName(nome)) e o CREATE_NEW (se outro arquivo chegou antes com o
// mesmo nome, tenta o proximo), e o <caminho>:Zone.Identifier com o ZoneIdentifier(). Devolve o caminho, ou "" se
// falhou. A marca vem antes do conteudo: o fluxo e gravado logo depois do CREATE_NEW, antes de qualquer byte (o Stop do
// ChatDownloader nao espera a gravacao, e o logoff pode encerrar o processo no meio dela). Assim, um app que morre no
// meio deixa no maximo um arquivo incompleto que ja tem a marca (ou, antes dela, um arquivo vazio). Qualquer falha (a
// marca, como num disco sem fluxos, ou o conteudo) apaga o arquivo. (0.2.0) erro, quando vem: o codigo de erro do
// Windows da chamada que falhou (o GetLastError dela, nunca 0; o ERROR_FILE_EXISTS quando nenhum nome ficou livre), ou
// 0 com o arquivo gravado. O diagnostico leva so esse codigo (DownloadLine, ChatFiles.h).
std::wstring SaveChatFile(const std::wstring& pasta, const std::string& nome, const std::string& bytes,
                          unsigned long* erro = nullptr);

}  // namespace starsonic
