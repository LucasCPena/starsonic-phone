#include "ChatSave.h"

#include <windows.h>

#include "ChatFiles.h"
#include "Text.h"

namespace starsonic {

namespace {

// Quantas vezes o CREATE_NEW pega o proximo nome livre (outro arquivo com o mesmo nome chegou entre o FreeName e ele).
const int kCreateAttempts = 20;

std::wstring PathIn(const std::wstring& folder, const std::string& name) {
    std::wstring path = folder;
    if (!path.empty() && path.back() != L'\\' && path.back() != L'/') path += L'\\';
    return path + Utf8ToWide(name);
}

bool WriteAll(HANDLE file, const std::string& bytes) {
    size_t done = 0;
    while (done < bytes.size()) {
        const size_t left = bytes.size() - done;
        const DWORD chunk = left > 0x10000000u ? 0x10000000u : static_cast<DWORD>(left);
        DWORD written = 0;
        if (!WriteFile(file, bytes.data() + done, chunk, &written, nullptr) || written == 0) return false;
        done += written;
    }
    return true;
}

// O GetLastError de agora, nunca 0 (o 0 e o "gravado" do WriteText).
DWORD LastError() {
    const DWORD error = GetLastError();
    return error != 0 ? error : ERROR_GEN_FAILURE;
}

// O texto inteiro num arquivo (ou num fluxo dele, com o ":nome"), no lugar do que estava. Devolve o erro do Windows (0:
// gravado).
DWORD WriteText(const std::wstring& path, const std::string& text) {
    const HANDLE file =
        CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return LastError();
    const DWORD error = WriteAll(file, text) ? 0 : LastError();
    CloseHandle(file);
    return error;
}

}  // namespace

std::wstring SaveChatFile(const std::wstring& pasta, const std::string& nome, const std::string& bytes,
                          unsigned long* erro) {
    // (0.2.0) O codigo de erro da chamada que falhou vai para o diagnostico (ChatSave.h), e o caminho e "".
    const auto failed = [erro](DWORD error) {
        if (erro) *erro = error;
        return std::wstring();
    };
    if (erro) *erro = 0;
    // O nome limpo ja e UTF-8 valido e sem NUL: a conversao para o UTF-16 nunca o corta.
    const std::string safe = SafeDownloadName(nome);
    const auto exists = [&pasta](const std::string& candidate) {
        return GetFileAttributesW(PathIn(pasta, candidate).c_str()) != INVALID_FILE_ATTRIBUTES;
    };
    for (int attempt = 0; attempt < kCreateAttempts; ++attempt) {
        const std::string name = FreeName(safe, exists);
        if (name.empty()) return failed(ERROR_FILE_EXISTS);   // do "(2)" ao "(1000)", todos ja existem
        const std::wstring path = PathIn(pasta, name);
        // CREATE_NEW: nunca por cima de um arquivo que ja estava la.
        HANDLE file = CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
        if (file == INVALID_HANDLE_VALUE) {
            const DWORD error = LastError();
            if (error == ERROR_FILE_EXISTS || error == ERROR_ALREADY_EXISTS) continue;   // outro chegou antes
            return failed(error);
        }
        // A marca antes de qualquer byte do conteudo (ChatSave.h). Se o fluxo nao abre com o arquivo aberto (o
        // compartilhamento), o arquivo vazio fecha, o fluxo e gravado, e o arquivo abre de novo para o conteudo.
        const std::wstring stream = path + L":Zone.Identifier";
        DWORD marked = WriteText(stream, ZoneIdentifier());
        if (marked == ERROR_SHARING_VIOLATION) {
            CloseHandle(file);
            file = INVALID_HANDLE_VALUE;
            marked = WriteText(stream, ZoneIdentifier());
            if (marked == 0) {
                file = CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL,
                                   nullptr);
            }
        }
        // O erro da chamada que falhou: a marca, o arquivo que nao abriu de novo ou o conteudo (lido antes do
        // CloseHandle e do DeleteFileW, que trocam o GetLastError).
        DWORD error = marked;
        if (error == 0 && file == INVALID_HANDLE_VALUE) error = LastError();
        if (error == 0 && !WriteAll(file, bytes)) error = LastError();
        if (file != INVALID_HANDLE_VALUE) CloseHandle(file);
        if (error == 0) return path;
        DeleteFileW(path.c_str());   // sem a marca da internet, ou com o conteudo pela metade
        return failed(error);
    }
    return failed(ERROR_FILE_EXISTS);   // a cada tentativa, outro arquivo chegou antes com o nome livre
}

}  // namespace starsonic
