#include "FilePicker.h"

#include <objbase.h>
#include <shobjidl.h>
#include <wrl/client.h>

#include <utility>

namespace starsonic {

namespace {

using Microsoft::WRL::ComPtr;

// Os tipos e o nome da spec da rc.4 (secao 9). Os indices dos tipos comecam em 1.
const COMDLG_FILTERSPEC kImportTypes[] = {
    {L"Planilhas (*.xlsx, *.csv)", L"*.xlsx;*.csv"},
    {L"Todos os arquivos", L"*.*"},
};
const COMDLG_FILTERSPEC kExportTypes[] = {
    {L"Planilha do Excel (*.xlsx)", L"*.xlsx"},
    {L"CSV (*.csv)", L"*.csv"},
};
const UINT kExportCsvType = 2;   // o "CSV (*.csv)"; o 1 e o .xlsx
const wchar_t kExportName[] = L"Contatos Starsonic.xlsx";

// O texto termina com tail, sem caixa (".XLSX" e ".xlsx").
bool EndsWithNoCase(const std::wstring& text, const std::wstring& tail) {
    if (text.size() < tail.size()) return false;
    return CompareStringOrdinal(text.c_str() + (text.size() - tail.size()), static_cast<int>(tail.size()), tail.c_str(),
                                static_cast<int>(tail.size()), TRUE) == CSTR_EQUAL;
}

// Mostra a janela (modal, com a dona) e devolve o caminho no disco do escolhido. Nada: a pessoa cancelou (o Show volta
// com HRESULT_FROM_WIN32(ERROR_CANCELLED)), a janela nao abriu ou saiu junto com a dona, ou o escolhido nao tem
// caminho.
std::optional<std::wstring> Run(IFileDialog* dialog, HWND owner) {
    if (FAILED(dialog->Show(owner))) return std::nullopt;
    ComPtr<IShellItem> item;
    if (FAILED(dialog->GetResult(item.GetAddressOf())) || !item) return std::nullopt;
    PWSTR path = nullptr;
    if (FAILED(item->GetDisplayName(SIGDN_FILESYSPATH, &path)) || !path) return std::nullopt;
    std::wstring out(path);
    CoTaskMemFree(path);
    if (out.empty()) return std::nullopt;
    return out;
}

}  // namespace

std::optional<std::wstring> PickImportFile(HWND owner) {
    ComPtr<IFileOpenDialog> dialog;
    const HRESULT created =
        CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(dialog.GetAddressOf()));
    if (FAILED(created) || !dialog) return std::nullopt;
    // So arquivos do disco (tambem os da pasta da rede), e que existem.
    DWORD options = 0;
    if (SUCCEEDED(dialog->GetOptions(&options))) dialog->SetOptions(options | FOS_FORCEFILESYSTEM | FOS_FILEMUSTEXIST);
    dialog->SetFileTypes(static_cast<UINT>(ARRAYSIZE(kImportTypes)), kImportTypes);
    dialog->SetFileTypeIndex(1);
    return Run(dialog.Get(), owner);
}

std::optional<ExportChoice> PickExportFile(HWND owner) {
    ComPtr<IFileSaveDialog> dialog;
    const HRESULT created =
        CoCreateInstance(CLSID_FileSaveDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(dialog.GetAddressOf()));
    if (FAILED(created) || !dialog) return std::nullopt;
    // So arquivos do disco; o arquivo que ja existe pergunta antes de ser trocado; o nome sai com a extensao de um dos
    // tipos.
    DWORD options = 0;
    if (SUCCEEDED(dialog->GetOptions(&options))) {
        dialog->SetOptions(options | FOS_FORCEFILESYSTEM | FOS_OVERWRITEPROMPT | FOS_STRICTFILETYPES);
    }
    dialog->SetFileTypes(static_cast<UINT>(ARRAYSIZE(kExportTypes)), kExportTypes);
    dialog->SetFileTypeIndex(1);
    // Antes do Show: a janela troca a extensao do nome quando a pessoa troca o tipo.
    dialog->SetDefaultExtension(L"xlsx");
    dialog->SetFileName(kExportName);
    std::optional<std::wstring> path = Run(dialog.Get(), owner);
    if (!path) return std::nullopt;
    UINT type = 1;
    if (FAILED(dialog->GetFileTypeIndex(&type))) type = 1;
    const bool csv = type == kExportCsvType;
    ExportChoice choice;
    choice.format = csv ? "csv" : "xlsx";
    choice.path = std::move(*path);
    // O tipo decide o formato, e a extensao segue o tipo: o nome que voltou com a do outro (digitada) ganha a deste.
    const std::wstring extension = csv ? L".csv" : L".xlsx";
    if (!EndsWithNoCase(choice.path, extension)) choice.path += extension;
    return choice;
}

}  // namespace starsonic
