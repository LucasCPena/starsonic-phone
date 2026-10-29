#pragma once
// As janelas de arquivo do importar e do exportar (spec da rc.4, 4.2, 4.3 e 7.4): a de abrir e a de salvar do proprio
// Windows (IFileOpenDialog e IFileSaveDialog, com as pastas da rede e o OneDrive de sempre), com a janela principal
// como dona. Os textos sao os da spec (secao 9):
// - Importar: os tipos "Planilhas (*.xlsx, *.csv)" (o padrao) e "Todos os arquivos".
// - Exportar: os tipos "Planilha do Excel (*.xlsx)" (o padrao) e "CSV (*.csv)", e o nome "Contatos Starsonic.xlsx". O
//   tipo escolhido decide o formato, e a extensao do nome segue o tipo: a janela troca a extensao quando a pessoa troca
//   o tipo, e um nome que volta com a extensao do outro tipo ganha a do escolhido no fim.
// Nada: a pessoa cancelou (ou a janela nao abriu, ou o escolhido nao e um arquivo do disco).
//
// Threads: na thread da janela, com o COM dela (STA). A janela de arquivo e modal: o Show so volta quando a pessoa
// escolhe ou cancela, e enquanto isso roda o laco de mensagens da thread (a interface continua recebendo o estado, e as
// acoes da fila da janela rodam dentro dele: tambem o Sair, que fecha a janela principal e leva a de arquivo junto; o
// Show entao volta com nada).
#include <windows.h>

#include <optional>
#include <string>

namespace starsonic {

// A janela de abrir planilha: o caminho escolhido.
std::optional<std::wstring> PickImportFile(HWND owner);

struct ExportChoice {
    std::wstring path;
    std::string format;   // "xlsx" | "csv"
};

// A janela de salvar: o caminho e o formato do tipo escolhido.
std::optional<ExportChoice> PickExportFile(HWND owner);

}  // namespace starsonic
