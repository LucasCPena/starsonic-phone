# Notas do build no Windows

Como o Starsonic Phone é compilado e o que precisou de ajuste para o workflow ficar verde. A primeira parte é do app novo (a partir da 0.1.0: `windows/app` e `windows/ui`); a segunda, do app antigo (a série 0.0.1, o MicroSIP), que continua compilando enquanto `microsip/` existir.

## App novo (0.1.0)

### Como compilar

Pré-requisitos: Visual Studio 2022 com "Desenvolvimento para desktop com C++", Git, Node.js 22, NSIS 3 e Windows PowerShell 5.1.

```powershell
.\build\Build-Deps.ps1 -WorkDir work            # pjproject 2.17, vcpkg e o SDK do WebView2 (uma vez; demora)
cd windows\ui; npm ci; npm run build; cd ..\..    # a interface em windows\ui\dist
.\build\Build-Windows.ps1 -WorkDir work -Version 0.0.0 -Channel estavel -OutDir out-novo
.\build\Build-Installer.ps1 -Version 0.0.0 -AppDir out-novo -OutDir dist -WorkDir work
.\tests\smoke\Test-WindowsApp.ps1 -AppDir out-novo
```

No CI, o job `ui` (Linux) faz o `npm ci`, o `npm run build` e o Playwright e publica a interface como o artefato `ui-dist`; o job `windows` baixa esse artefato para `windows\ui\dist` antes do `Build-Windows.ps1`.

### Ajustes

- **O SDK do WebView2 com versão fixa.** O `Build-Deps.ps1` baixa o NuGet `Microsoft.Web.WebView2` da versão do `build/deps.lock` (`webview2.version`), confere o SHA-256 do `.nupkg` (`webview2.sha256`) e guarda só os cabeçalhos e o `x86\WebView2LoaderStatic.lib` em `work\webview2`, com um arquivo `VERSION`. O `Build-Windows.ps1` recusa um `work\webview2` de outra versão. Para trocar a versão, mude as duas linhas do `deps.lock` juntas: isso refaz o cache das dependências (uns 13 minutos).
- **O bootstrapper do WebView2 com cache próprio.** O instalador leva o `MicrosoftEdgeWebview2Setup.exe` (Evergreen). O endereço curto da Microsoft (`fwlink`) troca de arquivo a cada versão, então o `deps.lock` guarda o endereço do próprio arquivo, a versão e o SHA-256 (`webview2Bootstrapper`). O `Build-Installer.ps1` baixa para `work\webview2-bootstrapper`, confere o SHA-256 e a assinatura da Microsoft e só baixa de novo se o arquivo guardado não bater. No CI, essa pasta tem um cache separado, com a chave pelo SHA-256 (`build/cache_keys.py`): assim, quando a Microsoft tira o endereço do ar, o build e o release continuam com o arquivo guardado, e trocar o bootstrapper não refaz o pjproject nem o vcpkg. Sem o cache e com o endereço fora do ar, o build para com o erro do download ou do SHA-256: ache o endereço novo (o `fwlink` leva a ele), confira a assinatura e atualize as três linhas.
- **O build de teste (`-TestHooks`).** O `Build-Windows.ps1 -TestHooks` compila com `STARSONIC_TEST_HOOKS=ON` (saída em `out-novo-teste`, e o `Build-Installer.ps1` gera dele um instalador em `dist-teste`, com o mesmo `.nsi`). Só nesse build valem: `STARSONIC_PERFIL` (o texto da variável toma o lugar do perfil embutido: o registrador falso na 5060 por UDP, sem STUN e sem SRTP, com PCMU e PCMA), `STARSONIC_SOM_NULO` (o motor no dispositivo nulo do PJSIP), `STARSONIC_TRAVAR_SAIR` (o Sair trava a thread de comandos, para conferir o fechamento com limite) e as ferramentas do desenvolvedor do WebView2. A fumaça (`Test-InstalledApp.ps1` e `windows_smoke.py`) usa esse build porque o runner do GitHub não tem placa de som: sem nenhum dispositivo, o PJSIP recusa a ligação (`PJMEDIA_EAUD_NODEFDEV`). O instalador de publicação não tem esses ganchos e é conferido pela marca estrita, pelo `Test-Installer.ps1` e pelo ensaio da rc.7.
- **O DevTools da fumaça.** A fumaça abre o app com `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333 --autoplay-policy=no-user-gesture-required` e liga o Playwright para Python pelo CDP. A variável toma o lugar dos argumentos que o app passa ao WebView2, por isso leva também o `--autoplay-policy` do app (sem ele, o toque pode sair mudo). O `setup-python` 3.12 do job `windows` é para o Playwright ter as versões de `tests/smoke/requirements-windows.txt`.
- **A conferência de marca abre o instalador por dentro.** O NSIS (`SetCompressor /SOLID lzma`) guarda os textos das páginas, as caixas de mensagem e os arquivos num bloco LZMA. Procurar "MicroSIP" nos bytes do `setup.exe` não acharia nada. O `check_branding.py --instalador` lê o cabeçalho do NSIS, descomprime o bloco inteiro (LZMA ou zlib) e procura no que está dentro; um instalador cortado, estragado no meio ou com lixo no fim reprova por não abrir. No Windows, o passo "Teste da verificação de marca com um instalador LZMA de verdade" gera instaladores pelo `makensis` (um com "MicroSIP" numa caixa de mensagem) e confere que o check reprova o certo; no Linux, sem o `makensis`, esses testes ficam de fora.
- **O pacote de fontes com os pacotes do npm.** A interface empacotada (`ui\app.js`) leva o Preact, então a GPL pede o código dele junto. O `Make-SourceBundle.ps1` põe em `npm-packages/` os `.tgz` dos pacotes do `windows/ui/package-lock.json` que não são `dev` (hoje só o `preact`), baixados do `resolved` do lock e conferidos pelo `integrity` (SHA-512). O `LEIA-ME-FONTES.txt` diz como montar o `node_modules` sem internet. O `package-lock.json` tem uma chave vazia (`""`) que o `ConvertFrom-Json` do Windows PowerShell 5.1 recusa; o script troca essa chave por `"(raiz)"` antes de ler o lock. O passo "Teste do pacote de fontes" roda o script em todo build sem versão (cerca de 1 minuto) e confere o zip pelo `Test-SourceBundle.ps1`; por isso todo build do Windows depende do registro do npm no ar.
- **`needs: ui`.** O job `windows` espera o job `ui`, porque o app novo leva a interface (o artefato `ui-dist`). Um teste do Playwright que falha (ou um instável) pula o job `windows` inteiro: um teste instável na interface tem de ser corrigido logo, senão nada do Windows roda.
- **O aviso de licença do Preact.** O `build.mjs` copia `node_modules/preact/LICENSE` para `dist/assets/preact-LICENSE.txt`, ao lado do `OFL.txt` da fonte, e o instalador leva a pasta `ui\` inteira.
- **A URL com a versão.** O `build.mjs` põe os 12 primeiros dígitos do SHA-256 do conteúdo na URL do `app.js`, do `aviso.js` e do `app.css` (`app.js?v=<hash>`), e o app abre `index.html?v=<versão>` e `aviso.html?v=<versão>`. Assim o cache do WebView2 nunca serve a interface de uma versão anterior.
- **Os literais ASCII também em `windows/`.** O `check_source_text.py` passou a conferir `windows/` (os `.cpp`, os `.h` e o `.rc`): o MSVC lê os fontes sem BOM na página de código do Windows.
- **O `LegacyCrypto.cpp` fora do app antigo.** A rotina que decifra as senhas da rc.7 mora em `starsonic/win`, mas é C++17 e só do app novo; o `starsonic/starsonic.targets` a tira do glob `win\*.cpp` do app antigo, que compila em C++14 com o cabeçalho pré-compilado.
- **O instalador antigo saiu do CI.** O job `windows` ainda compila o app antigo e roda os testes de fumaça dele, mas só gera o instalador do app novo. O `release.yml` confere que o instalador tem o `StarsonicPhone.exe`, a `ui/index.html`, a `ui/aviso.html` e o bootstrapper do WebView2 antes de publicar.
- **A publicação pelo `workflow_dispatch`.** Nas sessões do agente (o Claude Code, que sai pela internet por um proxy), o `git push` de uma tag falha. Por isso as versões saem pelo disparo à mão do `release`, que cria a tag no commit escolhido: `gh workflow run release.yml --ref main -f versao=0.1.0-rc.1`. O ensaio da atualização da rc.7 também é à mão: `gh workflow run build.yml --ref main -f ensaio-atualizacao=true`.

## App antigo (MicroSIP, série 0.0.1)

### Como compilar

Pré-requisitos: Visual Studio 2022 com "Desenvolvimento para desktop com C++" e "MFC para v143 (x86 e x64)", Git e Windows PowerShell 5.1.

```powershell
.\build\Build-Deps.ps1 -WorkDir work      # pjproject 2.17 + vcpkg (uma vez; demora)
.\build\Build-App.ps1 -WorkDir work -Version 0.0.0 -Channel estavel -ProfileFile branding\perfil.ini -OutDir out
.\tests\smoke\Test-StartStop.ps1 -AppDir out
```

As versões das dependências estão em `build/deps.lock`; a configuração do pjproject, em `build/config_site.h`.

O projeto do MicroSIP espera estar dentro da árvore do pjproject (`..\pjlib\include`, `..\build\vs\…`). Por isso o `Build-App.ps1` espelha `microsip/`, `starsonic/` e `branding/` para dentro de `work\pjproject\` antes de compilar.

### Ajustes

- **Toolset v143 na linha de comando do pjproject.** Os projetos do pjproject 2.17 fixam `PlatformToolset` v140, que não existe no VS 2022; o `Build-Deps.ps1` passa `/p:PlatformToolset=v143`, como o próprio CI do pjproject faz.
- **Cabeçalhos do vcpkg via `CL`.** O pjproject não tem como receber diretórios de include extras para OpenSSL, Opus e bcg729; o `Build-Deps.ps1` define `CL=/I<vcpkg>\installed\x86-windows-static\include` durante a compilação.
- **`chkstk_ms.lib` vazio.** O projeto do MicroSIP lista essa biblioteca do MinGW (usada pelas builds MinGW de Opus/bcg729 do MicroSIP). Com as dependências compiladas pelo MSVC ela não é necessária; o `Build-Deps.ps1` cria uma biblioteca vazia em `pjproject\third_party\lib\`.
- **`TargetName` na linha de comando.** O `starsonic.targets` entra no fim do `.vcxproj` (edição E3), depois das propriedades que derivam do nome do alvo; o `Build-App.ps1` passa `/p:TargetName=StarsonicPhone` para o nome valer desde o começo da avaliação do projeto.
- **Limpeza do cache.** Depois de compilar, o `Build-Deps.ps1` apaga as pastas `output` do pjproject e `buildtrees`/`downloads`/`packages` do vcpkg, para o cache do Actions ficar pequeno.
- **Código-fonte das dependências na publicação.** Como o cache não guarda os downloads do vcpkg, o `Make-SourceBundle.ps1` (só nas versões publicadas) baixa de novo o código-fonte das portas com `vcpkg install --only-downloads --binarysource=clear`, numa pasta de instalação vazia, sem compilar nada.
- **Instalador.** O `Build-Installer.ps1` gera a lista dos arquivos instalados a partir de `out\` (sem o PDB), para o desinstalador apagar exatamente os mesmos. O CI instala o NSIS 3.10 pelo Chocolatey só se ele não estiver na imagem.
- **`PJMEDIA_AUD_MAX_DEVS`.** O MicroSIP 3.22.16 usa o nome antigo do limite de dispositivos de áudio; no pjproject 2.17 ele se chama `PJMEDIA_AUD_DEV_MAX_DEVS`. O `config_site.h` define o nome antigo como apelido do novo (erro C2065 em `mainDlg.cpp`, `microsip.cpp` e `SettingsDlg.cpp`).
