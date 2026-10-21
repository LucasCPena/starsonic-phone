#pragma once
// "Iniciar com o Windows" (spec da W1, 7.4): o valor "Starsonic Phone" em HKCU\Software\Microsoft\Windows\
// CurrentVersion\Run com "<exe>" --bandeja (o app abre na bandeja). O mesmo nome de valor da rc.7, que gravava
// "<exe>" /minimized: o app novo entende os dois. Na abertura o executavel le o registro (ObserveAutostart) e ele
// vale mais que o config.json; ligado, o valor e regravado com o caminho e o --bandeja de agora.
#include <optional>
#include <string>

namespace starsonic {

extern const wchar_t kRunKey[];          // Software\Microsoft\Windows\CurrentVersion\Run
extern const wchar_t kApprovedKey[];     // Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run
extern const wchar_t kAutostartValue[];  // Starsonic Phone

// "\"<exe>\" --bandeja"
std::wstring AutostartCommand(const std::wstring& exePath);

// Liga (grava o comando e tira a entrada do StartupApproved: um "Desabilitado" do Gerenciador de Tarefas deixaria o
// Windows sem abrir o app) ou desliga (apaga o valor do Run). runKey e approvedKey: as chaves em HKCU (os testes usam
// outras). false: o registro recusou (desligar sem o valor gravado e sucesso).
bool SetAutostart(bool on, const std::wstring& exePath, const std::wstring& runKey = kRunKey,
                  const std::wstring& approvedKey = kApprovedKey);

// O comando gravado, ou nada sem o valor.
std::optional<std::wstring> ReadAutostart(const std::wstring& runKey = kRunKey);

// O app abre com o Windows de verdade: o valor no Run, e nao desligado no Gerenciador de Tarefas (no StartupApproved,
// o primeiro byte 0x03 e "Desabilitado"; sem a entrada, habilitado). O registro vale mais que o config.json.
bool ObserveAutostart(const std::wstring& runKey = kRunKey, const std::wstring& approvedKey = kApprovedKey);

}  // namespace starsonic
