#pragma once
// O diagnostico.log (spec 6.6): as linhas do app e do motor, cada uma com a data e a hora locais
// ("2026-10-21 19:30:00.123 <linha>"), sem senhas (quem escreve nunca manda uma: o DesktopApp e o motor ja tiram).
// Passando de 1 MB, o arquivo vira diagnostico.log.1 (o .1 de antes sai) e um novo comeca.
//
// Write pode ser chamado de qualquer thread, tambem do OnLog do motor com as travas dele presas: so pega a trava
// propria (que nunca espera outra coisa) e escreve no arquivo. Nunca chama o motor nem o DesktopApp.
#include <mutex>
#include <string>

namespace starsonic {

class DiagLog {
public:
    static constexpr long long kMaxBytes = 1024 * 1024;

    // path: o diagnostico.log (UTF-16). A pasta precisa existir.
    explicit DiagLog(std::wstring path);
    ~DiagLog();

    DiagLog(const DiagLog&) = delete;
    DiagLog& operator=(const DiagLog&) = delete;

    // Uma linha (UTF-8; as quebras de linha dentro dela viram espaco).
    void Write(const std::string& line);

    const std::wstring& Path() const { return path_; }

private:
    void OpenLocked();
    void RotateLocked();

    std::wstring path_;
    std::mutex mutex_;
    void* file_ = nullptr;   // HANDLE (sem o windows.h aqui)
    long long size_ = 0;
};

}  // namespace starsonic
