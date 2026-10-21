#pragma once
// "Enviar diagnostico" (Sobre; spec da W1, 6.6): uma copia do diagnostico.log em
// %TEMP%\Starsonic Phone diagnostico <data>.log e o Explorer aberto com ela selecionada, para a pessoa anexar no
// e-mail ou no WhatsApp do suporte. A copia leva antes o diagnostico.log.1 (a parte mais antiga, da rotacao de
// 1 MB), se houver: um arquivo so, na ordem. O diagnostico.log nunca tem senhas nem o Authorization (DiagLog).
#include <windows.h>

#include <optional>
#include <string>

namespace starsonic {

// "Starsonic Phone diagnostico 2026-10-21 19-30-05.log" (a hora local; sem ":", que o Windows nao aceita).
std::wstring DiagnosticsCopyName(const SYSTEMTIME& now);

// Copia o .1 (se houver) e o diagnostico.log (logPath) para folder\DiagnosticsCopyName(now). Le com o app escrevendo
// nele. Devolve o caminho da copia, ou nada (sem o diagnostico.log, ou o disco recusou).
std::optional<std::wstring> CopyDiagnostics(const std::wstring& logPath, const std::wstring& folder,
                                            const SYSTEMTIME& now);

// A pasta temporaria do usuario (%TEMP%, sem a barra do fim); "" sem ela.
std::wstring TempFolder();

// O Explorer com o arquivo selecionado. Na thread da janela (o ShellExecute).
void ShowInExplorer(const std::wstring& path);

}  // namespace starsonic
