# Starsonic Phone para Windows

Softphone da Starsonic para os clientes do PABX em Nuvem: um fork do [MicroSIP](https://www.microsip.org) 3.22.16 com a marca Starsonic, tela Entrar com o endereço do servidor digitado, configurações técnicas de conta e rede travadas, atualização com um clique e instalador por usuário (sem senha de administrador). Licença GNU GPL v3.

O que o projeto faz e por quê está na [especificação de design](docs/superpowers/specs/2026-10-11-starsonic-phone-windows-design.md); como foi construído, no [plano de implementação](docs/superpowers/plans/2026-10-11-starsonic-phone-windows.md) e no [plano da revisão 1.2](docs/superpowers/plans/2026-10-13-servidor-digitado.md) (servidor digitado).

## Organização

| Pasta | Conteúdo |
|-------|----------|
| `microsip/` | Código do MicroSIP 3.22.16, idêntico ao oficial exceto pelas edições E1–E14 (tabela no plano), todas de poucas linhas e chamando `starsonic/` |
| `microsip-dist/` | Sons do pacote oficial MicroSIP Lite |
| `starsonic/core/` | Lógica nova em C++14 puro (perfis, travas, tela Entrar, mensagens de erro, arquivo de versão), testada no Linux e no Windows |
| `starsonic/win/` | Integração com o MicroSIP (MFC): tela Entrar, faixa da marca, Sobre, Configurações enxutas, atualizador |
| `branding/` | Nome, URLs, cores, perfil das contas (`perfil.ini`: porta, transporte, SRTP, codecs e DTMF), tradução pt-BR, ícones (`overlay/`), logos, imagem do instalador (`installer/`) e, em `fontes/`, o logo original e o script que gera os ícones e logos |
| `installer/` | Script do instalador (NSIS) |
| `build/` | Scripts de build, verificação e publicação |
| `tests/` | Testes do núcleo (doctest), dos scripts (Python) e de fumaça no Windows (`smoke/`) |
| `notas/` | Notas de cada versão estável (`vX.Y.Z.txt`), mostradas no aviso de atualização |
| `docs/` | Spec, plano, [notas do build](docs/build-notes.md) e [teste manual](docs/teste-manual.md) |

## Como compilar

O GitHub Actions compila e testa cada push (`.github/workflows/build.yml`) e guarda o executável e o instalador como artefatos do workflow. Para compilar num PC com Windows:

Pré-requisitos: Visual Studio 2022 com "Desenvolvimento para desktop com C++" e "MFC para v143", Git, NSIS 3 e Windows PowerShell 5.1.

```powershell
.\build\Build-Deps.ps1 -WorkDir work      # pjproject 2.17 + vcpkg (uma vez; demora)
.\build\Build-App.ps1 -WorkDir work -Version 0.0.0 -Channel estavel -ProfileFile branding\perfil.ini -OutDir out
.\build\Build-Installer.ps1 -Version 0.0.0 -AppDir out -OutDir dist
```

Testes do núcleo e dos scripts (Linux ou Windows, com CMake e Python 3):

```bash
cmake -S tests -B build-tests && cmake --build build-tests && ctest --test-dir build-tests
python3 -m unittest discover -s tests/python
python3 build/check_source_text.py
python3 build/check_branding.py --repo .
```

Os testes de fumaça da tela Entrar e das travas (`tests/smoke/Test-Login.ps1` e `Test-Policy.ps1`) conferem os valores do `branding/perfil.ini` (porta 5060, UDP e codecs) contra um registrador SIP falso que só fala UDP. Ao mudar o transporte, a porta ou os codecs do perfil, ajuste esses dois testes; para TCP ou TLS, o `tests/smoke/fake_registrar.py` também precisa falar o transporte novo.

Detalhes e ajustes do build: [docs/build-notes.md](docs/build-notes.md).

## Como lançar uma versão

As versões seguem `X.Y.Z` (estável) e `X.Y.Z-rc.N` (candidata, para teste). Quem publica é o workflow `release`:

1. **Candidata:** crie a tag `vX.Y.Z-rc.N` no commit desejado (ou, no GitHub, Actions → release → Run workflow, com a versão). O workflow compila com o canal de teste, publica o pre-release `vX.Y.Z-rc.N` e atualiza o pre-release fixo `canal-teste`, de onde as rc instaladas recebem a atualização.
2. **Teste manual:** siga o [roteiro](docs/teste-manual.md), inclusive a atualização de uma rc para a seguinte.
3. **Estável:** escreva `notas/vX.Y.Z.txt` (texto curto mostrado no aviso de atualização) e crie a tag `vX.Y.Z`. O workflow só publica se o portão de entradas passar: `python3 build/check_release_inputs.py --repo .` lista o que ainda é provisório (cores, ícones, logos, tradução, imagem do instalador).

Cada release traz `StarsonicPhone-<versão>-setup.exe`, `versao.json` (com o SHA-256 do instalador, conferido pelo app antes de instalar) e `StarsonicPhone-<versão>-codigo-fonte-completo.zip`, que cumpre a GPL: o repositório, o pjproject e o código-fonte das bibliotecas do vcpkg.

O app procura atualizações em `github.com/<STARSONIC_GITHUB_ACCOUNT>/starsonic-phone` (em `branding/branding.h`) e só aceita instaladores que comecem com esse mesmo endereço, letra por letra; o workflow recusa publicar em outro repositório.

**Não transfira o repositório para outra conta sem preparar a mudança.** O GitHub redireciona o endereço antigo, então as versões já instaladas ainda acham o `versao.json` novo. Mas o instalador dele aponta para a conta nova, e essas versões recusam o instalador para sempre. Antes da transferência, é preciso publicar uma versão-ponte que aceite os dois endereços e esperar os clientes atualizarem; isso exige uma mudança no código (`starsonic/win/Updater.cpp`).

## Como mudar o logo ou os ícones

Ícones, logos e imagem do instalador saem de `branding/fontes/gerar_marca.py`, a partir do logo original (`branding/fontes/logo-starsonic.png`). O desenho do ícone e as cores (azul `#383881` e ciano `#3DB1CC`) estão no próprio script.

1. Troque o logo ou ajuste o script.
2. Rode `python3 branding/fontes/gerar_marca.py`. Ele precisa de Python 3 com Pillow, numpy, scipy e Playwright (com o Chromium), que não fazem parte do build.
3. Faça o commit dos arquivos gerados. Se a cor principal mudar, mude também `STARSONIC_BRAND_COLOR` em `branding/branding.h` e as cores conferidas em `tests/smoke/Test-BrandUi.ps1`.

## Como trazer uma versão nova do MicroSIP

1. No GitHub, Actions → importar-microsip → Run workflow, com a versão (ex.: `3.22.17`). O workflow baixa os pacotes oficiais, atualiza `microsip/` e `microsip-dist/` no ramo `upstream`, cria a tag `microsip-<versão>` e abre um PR de `upstream` para `main`.
2. Resolva os conflitos só nas edições E1–E14 (tabela no plano), mantendo cada uma como está descrita, e confira o build verde no PR.
3. Faça o merge com merge commit (não squash): é assim que o workflow sabe, na próxima importação, que a versão já entrou.

## Segurança

O instalador ainda não é assinado; a integridade das atualizações depende da conta do GitHub (o `versao.json` e o instalador ficam no mesmo lugar). Por isso a conta dona do repositório **precisa ter verificação em duas etapas**, e o acesso de escrita ao repositório deve ficar restrito a quem publica versões.

## Licença

GNU GPL v3 ([LICENSE](LICENSE)). O Starsonic Phone é baseado no MicroSIP (© MicroSIP, GPL) e no PJSIP; os avisos de copyright originais ficam no código e no recurso de versão do executável, e a tela Sobre traz a atribuição e o link do código-fonte.
