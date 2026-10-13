# Notas do build no Windows

Como o Starsonic Phone é compilado e o que precisou de ajuste em relação ao build oficial do MicroSIP. Cada ajuste feito para o workflow ficar verde é registrado aqui.

## Como compilar

Pré-requisitos: Visual Studio 2022 com "Desenvolvimento para desktop com C++" e "MFC para v143 (x86 e x64)", Git e Windows PowerShell 5.1.

```powershell
.\build\Build-Deps.ps1 -WorkDir work      # pjproject 2.17 + vcpkg (uma vez; demora)
.\build\Build-App.ps1 -WorkDir work -Version 0.0.0 -Channel estavel -ProfileFile branding\perfil.ini -OutDir out
.\tests\smoke\Test-StartStop.ps1 -AppDir out
```

As versões das dependências estão em `build/deps.lock`; a configuração do pjproject, em `build/config_site.h`.

O projeto do MicroSIP espera estar dentro da árvore do pjproject (`..\pjlib\include`, `..\build\vs\…`). Por isso o `Build-App.ps1` espelha `microsip/`, `starsonic/` e `branding/` para dentro de `work\pjproject\` antes de compilar.

## Ajustes

- **Toolset v143 na linha de comando do pjproject.** Os projetos do pjproject 2.17 fixam `PlatformToolset` v140, que não existe no VS 2022; o `Build-Deps.ps1` passa `/p:PlatformToolset=v143`, como o próprio CI do pjproject faz.
- **Cabeçalhos do vcpkg via `CL`.** O pjproject não tem como receber diretórios de include extras para OpenSSL, Opus e bcg729; o `Build-Deps.ps1` define `CL=/I<vcpkg>\installed\x86-windows-static\include` durante a compilação.
- **`chkstk_ms.lib` vazio.** O projeto do MicroSIP lista essa biblioteca do MinGW (usada pelas builds MinGW de Opus/bcg729 do MicroSIP). Com as dependências compiladas pelo MSVC ela não é necessária; o `Build-Deps.ps1` cria uma biblioteca vazia em `pjproject\third_party\lib\`.
- **`TargetName` na linha de comando.** O `starsonic.targets` entra no fim do `.vcxproj` (edição E3), depois das propriedades que derivam do nome do alvo; o `Build-App.ps1` passa `/p:TargetName=StarsonicPhone` para o nome valer desde o começo da avaliação do projeto.
- **Limpeza do cache.** Depois de compilar, o `Build-Deps.ps1` apaga as pastas `output` do pjproject e `buildtrees`/`downloads`/`packages` do vcpkg, para o cache do Actions ficar pequeno.
- **Código-fonte das dependências na publicação.** Como o cache não guarda os downloads do vcpkg, o `Make-SourceBundle.ps1` (só nas versões publicadas) baixa de novo o código-fonte das portas com `vcpkg install --only-downloads --binarysource=clear`, numa pasta de instalação vazia, sem compilar nada.
- **Instalador.** O `Build-Installer.ps1` gera a lista dos arquivos instalados a partir de `out\` (sem o PDB), para o desinstalador apagar exatamente os mesmos. O CI instala o NSIS 3.10 pelo Chocolatey só se ele não estiver na imagem.
- **`PJMEDIA_AUD_MAX_DEVS`.** O MicroSIP 3.22.16 usa o nome antigo do limite de dispositivos de áudio; no pjproject 2.17 ele se chama `PJMEDIA_AUD_DEV_MAX_DEVS`. O `config_site.h` define o nome antigo como apelido do novo (erro C2065 em `mainDlg.cpp`, `microsip.cpp` e `SettingsDlg.cpp`).
