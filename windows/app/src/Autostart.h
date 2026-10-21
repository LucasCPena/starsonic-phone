#pragma once
// "Iniciar com o Windows" (spec da W1, 7.4): o valor "Starsonic Phone" em HKCU\Software\Microsoft\Windows\
// CurrentVersion\Run com "<exe>" --bandeja (o app abre na bandeja). O mesmo nome de valor da rc.7, que gravava
// "<exe>" /minimized: o app novo entende os dois.
#include <optional>
#include <string>

namespace starsonic {

extern const wchar_t kRunKey[];          // Software\Microsoft\Windows\CurrentVersion\Run
extern const wchar_t kAutostartValue[];  // Starsonic Phone

// "\"<exe>\" --bandeja"
std::wstring AutostartCommand(const std::wstring& exePath);

// Liga (grava o comando) ou desliga (apaga o valor). runKey: a chave em HKCU (os testes usam outra). false: o registro
// recusou (desligar sem o valor gravado e sucesso).
bool SetAutostart(bool on, const std::wstring& exePath, const std::wstring& runKey = kRunKey);

// O comando gravado, ou nada sem o valor.
std::optional<std::wstring> ReadAutostart(const std::wstring& runKey = kRunKey);

}  // namespace starsonic
