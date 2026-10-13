# Starsonic Phone para Windows — especificação de design

- **Data:** 11/10/2026
- **Status:** revisão 1.2 (13/10/2026) em aprovação; a revisão 1.1 foi aprovada em 11/10/2026
- **Subprojeto:** 1 de 2 — o 2º é o app de celular (iOS e Android), com especificação própria

> **Revisão 1.2 — servidor digitado na tela Entrar** (decisão do responsável em 13/10/2026: a Starsonic tem muitos clientes, cada um em um de dois servidores):
> 1. A tela Entrar troca a lista de servidores por um campo de texto: o endereço do servidor (nome ou IP) é digitado, como no MicroSIP. O app deixa de trazer uma lista de servidores (M3) e o endereço deixa de ser travado.
> 2. `branding/servidores.ini` vira `branding/perfil.ini`, com a seção `[geral]` e uma seção `[conta]` que vale para todas as contas: UDP na porta 5060, sem proxy, SRTP opcional e keepalive de 15 s; sem STUN, codecs G722, PCMA e PCMU e DTMF RFC 2833.
> 3. As travas continuam ao abrir o app e ao ativar uma conta; da pessoa ficam só o endereço do servidor, o ramal e a senha. Conta com endereço vazio ou fora da regra é esvaziada, e a mensagem "O servidor desta conta mudou" sai.
> 4. Mensagens novas para o endereço; a mensagem de falha de rede passa a pedir para conferir o endereço.
> 5. Os testes de fumaça digitam 127.0.0.1 no build normal; saem o build separado de CI e a fase de TLS do teste de fumaça.
> 6. Riscos novos: o app funciona com qualquer servidor SIP; com UDP, a chave do SRTP vai sem proteção.

> **Revisão 1.1 — o que mudou e por quê** (fatos encontrados no código-fonte):
> 1. O MicroSIP mantém **uma conta ativa por vez**; "várias contas" significa várias configuradas, trocadas pelo menu.
> 2. No MicroSIP, **STUN, codecs e DTMF valem para todas as contas**; por isso saem do perfil de cada servidor e vão para uma seção `[geral]`.
> 3. **Licença do binário: GNU GPL v3.** MicroSIP e PJSIP são "GPL v2 ou posterior", mas o OpenSSL 3 (Apache 2.0) e o bcg729 (G.729, GPL v3) só são compatíveis com a v3.
> 4. Não existe opção de idioma nas Configurações: o MicroSIP carrega o arquivo de idioma que estiver ao lado do executável. O app é instalado só com o pt-BR.
> 5. O cliente HTTP do MicroSIP ignora erros de certificado; o atualizador usa um cliente próprio, com validação.
> 6. Item novo M10 (relatórios de falha), aprovado junto com a licença GPL v3 em 11/10/2026.

## 1. Contexto

A Starsonic (TI, telefonia e segurança para empresas em São Paulo, desde 1996) vende o **PABX em Nuvem**. Ele roda sobre a plataforma SIP de um fornecedor terceiro, distribuída em alguns servidores; cada cliente fica em um deles.

Este subprojeto cria o **Starsonic Phone para Windows**: um fork do [MicroSIP](https://www.microsip.org) 3.22.16 — softphone open source para Windows, em C/C++ com MFC sobre a pilha PJSIP — com a marca da Starsonic e configurações técnicas embutidas e travadas; o endereço do servidor é digitado na tela Entrar.

## 2. Objetivos

1. **Marca própria** — o cliente vê Starsonic, nunca MicroSIP.
2. **Configuração fácil** — o usuário digita o servidor, o ramal e a senha e liga.
3. **Controle e suporte** — configurações técnicas padronizadas e travadas; atualizações controladas pela Starsonic.

**Regra do projeto:** o comportamento padrão é o do MicroSIP. Qualquer mudança além das listadas na seção 4 precisa de aprovação prévia.

## 3. Critérios de sucesso

- Um usuário sem conhecimento técnico instala o app, digita o servidor que a Starsonic informou, o ramal e a senha e completa uma ligação sem ver nenhum outro campo técnico.
- Nenhum texto, ícone ou janela mostra "MicroSIP", exceto a atribuição na tela Sobre e os avisos de copyright e licença.
- O usuário não consegue alterar as configurações de conta e rede além do endereço do servidor — nem pela interface, nem editando o arquivo de configuração.
- Uma versão nova chega como aviso no app e é instalada com um clique, sem pedir senha de administrador.
- O suporte identifica o app e a versão pela tela Sobre e pelo User-Agent SIP.
- Cada versão publicada cumpre a GPL: o código-fonte completo fica disponível junto do instalador.

## 4. Mudanças em relação ao MicroSIP padrão (aprovadas)

| # | Mudança | Decisão |
|---|---------|---------|
| M1 | Edição | Somente áudio (a edição "Lite" do MicroSIP, sem vídeo) |
| M2 | Acesso | Tela **Entrar** (servidor digitado + ramal + senha) no lugar da janela de conta padrão; a mesma tela serve para adicionar e editar contas. A conta "Local" (ligação por IP) continua com a janela original |
| M3 | Perfil | Um perfil embutido no app vale para todas as contas (porta, transporte, proxy, SRTP e keepalive), junto com STUN, codecs e DTMF; o endereço do servidor é digitado na tela Entrar (revisão 1.2; antes, lista de servidores embutida) |
| M4 | Marca | Nome **Starsonic Phone**, ícones, logo, textos, links de menu e tela Sobre próprios; versão própria a partir de 1.0.0 |
| M5 | Tema | Faixa superior (logo + status) e botões **Ligar** e **Entrar** na cor da marca; o resto da interface continua nativo |
| M6 | User-Agent | `Starsonic Phone/<versão>` no lugar de `MicroSIP/<versão>` |
| M7 | Travas | Campos de conta e rede e a verificação de atualizações ficam travados e somem da tela de Configurações; da pessoa ficam só o endereço do servidor, o ramal e a senha |
| M8 | Instalação | Instalador próprio, por usuário, sem privilégio de administrador; pasta e configurações próprias |
| M9 | Atualização | Aviso no app e "baixar e instalar" com um clique, a partir dos releases do GitHub |
| M10 | Relatórios de falha | Não enviar para `crash-report2.microsip.org`; o arquivo de diagnóstico continua sendo gravado no PC (aprovado em 11/10/2026) |

**Continua como no MicroSIP:** várias contas configuradas com uma ativa por vez (troca pelo menu), conta Local, discador, histórico, contatos, transferência, espera, DTMF, encaminhamento, atendimento automático, não perturbe, atalhos, log, exportar/importar, o mecanismo de tradução, o tratamento de links de discagem (registrado com o nome Starsonic Phone), a arquitetura do executável (Win32), os sons e o prazo de validade embutido (o app avisa 1,5 e 2 anos após o build e para de abrir após 2,5 anos — contados a partir do build da Starsonic). Qualquer opção não citada nesta especificação também continua como no MicroSIP.

## 5. Fora do escopo

- Recursos que o MicroSIP não tem (integrações com WhatsApp, IA, CRM etc.).
- Vídeo.
- Assinatura de código do instalador — fica para quando a Starsonic comprar o certificado (ver seção 13).
- Perfil baixado da internet e provisionamento remoto.
- Tema completo da interface — só os três elementos de M5.
- App de celular (subprojeto 2).
- Windows anterior ao 10.

## 6. Arquitetura

### 6.1 Repositório

Repositório **público** `starsonic-phone` no GitHub, por enquanto na conta pessoal do responsável. A conta é a constante `STARSONIC_GITHUB_ACCOUNT` em `branding/branding.h` e aparece nas URLs abaixo como `{conta}`.

Ramos:

- `upstream` — o MicroSIP exatamente como publicado em microsip.org: `microsip/` com o pacote de código-fonte e `microsip-dist/` com os arquivos de execução que só existem no pacote "Lite" portátil (sons `.wav` e, se houver, a tradução pt-BR). Cada versão importada é um commit com a tag `microsip-<versão>`; a primeira é `microsip-3.22.16`.
- `main` — `upstream` + as mudanças da Starsonic. Trazer uma versão nova do MicroSIP = importar no `upstream` e fazer merge no `main`. A diferença `upstream..main` mostra tudo o que a Starsonic mudou.

Pastas do `main`, além das do `upstream`:

| Pasta | Conteúdo |
|-------|----------|
| `branding/` | Marca e dados da Starsonic: `branding.h` (nome, URLs, cores, conta do GitHub), `perfil.ini`, tradução pt-BR revisada, ícones e logos |
| `starsonic/core/` | Lógica nova em C++17 sem MFC nem Windows — testável no Linux e no Windows |
| `starsonic/win/` | Integração com a interface do MicroSIP (MFC) |
| `tests/` | Testes unitários do `core` e testes de fumaça da interface |
| `installer/` | Script NSIS do instalador |
| `build/` | Scripts de dependências e de build; `deps.lock` com versões fixas |
| `.github/workflows/` | Importação do upstream, build e publicação |
| `docs/` | Especificações, planos e checklist de testes manuais |

**Princípio:** as edições em arquivos do próprio MicroSIP são mínimas — pontos de entrada que chamam `starsonic/`. Ícones são substituídos no momento do build (sem editar os arquivos do upstream). Isso mantém pequenos os merges de versões novas.

### 6.2 Componentes

| Módulo | Responsabilidade | Depende de |
|--------|------------------|------------|
| `Profile` (core) | Lê `perfil.ini` e devolve as seções `[geral]` e `[conta]` | — |
| `AccountPolicy` (core) | Valida o endereço do servidor e o ramal; monta contas a partir do perfil + endereço + credenciais; reaplica o perfil sobre contas existentes e as configurações globais travadas | `Profile` |
| `RegistrationErrors` (core) | Traduz o código SIP ou a falha de TLS do registro em mensagem pt-BR | — |
| `LoginFlow` (core) | Máquina de estados da tela Entrar: enviar, resultado do registro, tempo esgotado | `RegistrationErrors` |
| `UpdateManifest` (core) | Interpreta `versao.json` e compara versões | — |
| `LayoutCollapse` (core) | Recalcula posições quando linhas da tela de Configurações são escondidas, para não deixar buracos | — |
| `LoginDialog` (win) | Tela Entrar; usada no primeiro acesso e em Adicionar/Editar conta | core |
| `BrandBand`, `AboutDialog` (win) | Faixa superior e tela Sobre | `branding/` |
| `SettingsFilter` (win) | Esconde os campos travados e aplica `LayoutCollapse` | `LayoutCollapse` |
| `Updater` (win) | Verificação, download com validação de certificado, SHA-256 e instalação silenciosa | `UpdateManifest` |

### 6.3 Perfil (`branding/perfil.ini`)

```ini
[geral]                   ; vale para todas as contas (no MicroSIP, STUN, codecs e DTMF são globais)
stun=                     ; vazio = sem STUN
codecs=G722,PCMA,PCMU     ; ordem de preferência; opções: opus, G722, PCMA, PCMU, G729
dtmf=rfc2833              ; auto | inband | rfc2833 | info

[conta]                   ; vale para toda conta; o endereço do servidor é digitado na tela Entrar
porta=5060
transporte=udp            ; udp | tcp | tls
proxy=                    ; vazio = sem proxy
srtp=opcional             ; desativado | opcional | obrigatorio
keepalive=15              ; segundos
```

São os valores reais, informados pela Starsonic em 13/10/2026. Os servidores da Starsonic hoje são `starcloud-starsonic.com.br` e `starcloud1-starsonic.com.br` (cada cliente usa um deles) e não ficam no app: o suporte informa o endereço a cada cliente. Regras: o arquivo só tem as seções `[geral]` (opcional; sem ela valem os padrões do MicroSIP) e `[conta]` (obrigatória); seção desconhecida ou repetida, chave desconhecida (inclusive as antigas `nome`, `endereco` e `dominio`), campo obrigatório ausente (`porta`, `transporte`) ou valor fora das opções invalida o arquivo — e o build falha, porque os testes leem o arquivo real de `branding/`.

### 6.4 Arquivos no PC do usuário

- Programa: `%LOCALAPPDATA%\Starsonic Phone\` (`StarsonicPhone.exe`, sons, tradução, `Uninstall.exe`) — o mesmo esquema por usuário do instalador do MicroSIP.
- Configurações: `%APPDATA%\Starsonic Phone\StarsonicPhone.ini`, no formato do MicroSIP. O endereço do servidor fica nos campos de servidor (`<endereço>:<porta>`) e domínio da conta, como no MicroSIP; a chave `starsonicServer` das contas gravadas antes da revisão 1.2 é ignorada. A senha é guardada como o MicroSIP já guarda.
- Instância única e classe de janela próprias, sem conflito com um MicroSIP instalado no mesmo PC.

## 7. Fluxos

### 7.1 Entrar, adicionar e editar conta

1. Sem conta ativa, o app abre a tela Entrar ao iniciar. A mesma tela abre em Contas → Adicionar e Contas → Editar (com servidor e ramal preenchidos) e quando o servidor recusa a senha.
2. O usuário digita o endereço do servidor, o ramal e a senha e clica Entrar. O campo Servidor começa vazio, menos em Editar. O app apara espaços e tabs das pontas do endereço e o passa para minúsculas. O endereço vale se tiver até 253 caracteres, em partes separadas por ponto, cada uma com 1 a 63 letras (a–z), dígitos ou hífens e sem hífen nas pontas — o que inclui IPs como `200.100.50.10` (IPv6 não é aceito). Os campos são conferidos nesta ordem, na hora:
   - servidor vazio → "Digite o endereço do servidor.";
   - servidor fora da regra (espaço, porta, `@`, `/`, acento etc.) → "Digite só o endereço do servidor, como starcloud1-starsonic.com.br.";
   - ramal vazio ou com espaço, `@` ou `:` → "Digite só o número do ramal.";
   - senha vazia → "Digite a senha."
3. `AccountPolicy` monta a conta: perfil + endereço (servidor `<endereço>:<porta>` e domínio `<endereço>`) + ramal (usuário SIP e nome de exibição) + senha. O rótulo da conta, usado no menu de contas e na faixa superior, é `<ramal> · <endereço>`.
4. A conta candidata vira a conta ativa e o app espera o resultado do registro por até 15 s.
5. Registrou → a conta é gravada no INI, a tela fecha e a faixa superior mostra "Conectado · <ramal> · <endereço>".
   Falhou ou esgotou o tempo → a conta não é gravada, a conta ativa anterior volta (se havia) e a tela continua aberta com a mensagem de `RegistrationErrors`. Resultados que chegam depois do tempo esgotado são ignorados.
6. Remover a última conta volta à tela Entrar.

### 7.2 Inicialização

1. O app lê o INI.
2. `AccountPolicy` reaplica o perfil em cada conta e as configurações globais travadas. O endereço de cada conta é o do seu campo de servidor, sem a porta; a conta volta a ter servidor `<endereço>:<porta do perfil>`, domínio `<endereço>` e rótulo `<ramal> · <endereço>`. Com endereço vazio ou fora da regra de 7.1, a conta é esvaziada (usuário, senha, servidor, domínio e proxy) e, se era a ativa, o app abre a tela Entrar. O perfil também é reaplicado quando uma conta é ativada com o app aberto (troca pelo menu, importação, `/account:N`), antes de registrar.
3. A conta ativa é registrada; daí em diante vale o comportamento padrão do MicroSIP.

### 7.3 Atualização

1. Ao abrir (quando a última verificação tem mais de 24 h — regra do MicroSIP) e a cada 24 h com o app aberto, `Updater` baixa `versao.json` por HTTPS **com validação de certificado**, seguindo redirecionamentos:
   - versões estáveis: `https://github.com/{conta}/starsonic-phone/releases/latest/download/versao.json` — sempre aponta para o release mais recente que não é pre-release e não usa a API do GitHub, então não tem limite de consultas;
   - builds de teste: `https://github.com/{conta}/starsonic-phone/releases/download/canal-teste/versao.json` — pre-release fixo `canal-teste`, que o pipeline sobrescreve a cada versão candidata.
2. Se a versão do arquivo for maior que a instalada, o app pergunta "Nova versão do Starsonic Phone disponível (<versão>). Atualizar agora?", mostrando as notas.
3. Atualizar com chamada em andamento → "Termine a chamada para atualizar." e nada acontece.
4. O instalador é baixado para a pasta temporária e o SHA-256 é conferido com o do arquivo de versão. Diferente ou download com falha → o arquivo é apagado e aparece "Não foi possível baixar a atualização. Tentaremos de novo mais tarde."
5. O app inicia o instalador em modo silencioso e se fecha. O instalador fecha o app se ainda estiver aberto, atualiza os arquivos (preservando as configurações) e abre o app de novo.

### 7.4 Formato de `versao.json`

```json
{
  "versao": "1.0.1",
  "instalador": "https://github.com/{conta}/starsonic-phone/releases/download/v1.0.1/StarsonicPhone-1.0.1-setup.exe",
  "sha256": "<64 caracteres hexadecimais>",
  "notas": "Texto curto mostrado no aviso."
}
```

- `versao` segue `MAJOR.MINOR.PATCH` ou `MAJOR.MINOR.PATCH-rc.N`; uma versão final é maior que qualquer `rc` do mesmo número.
- `instalador` precisa começar com `https://github.com/{conta}/starsonic-phone/releases/download/`.
- JSON inválido ou campo obrigatório ausente → o arquivo é ignorado, nenhum aviso aparece e o erro vai para o log.
- `notas` é opcional; acima de 500 caracteres, é cortada com "…".
- Leitura com nlohmann/json (cabeçalho único, licença MIT).

## 8. Interface

### 8.1 Tela Entrar

Logo; campos "Servidor (endereço ou IP)" (texto livre), Ramal e Senha; botão Entrar na cor da marca; linha "Precisa de ajuda? (11) 5060-3000". Mensagens de erro aparecem abaixo da senha, em vermelho. Na edição de uma conta existente aparece também o link "Remover conta".

### 8.2 Janela principal

Igual à do MicroSIP, com as duas diferenças de M5: faixa superior na cor da marca com o logo e a linha de status da conta ativa ("Conectado · 2001 · starcloud1-starsonic.com.br", cortada com "…" quando não cabe), e botão Ligar na cor da marca.

### 8.3 Configurações

Somem da tela (M7), e as linhas de baixo sobem para não deixar buracos: listas de codecs e sua ordem, porta de origem, rport, portas de RTP, STUN, método de DTMF e a frequência de verificação de atualizações (fixa: diária).

Continuam visíveis todas as demais, como dispositivos de áudio, toque, iniciar com o Windows, atendimento automático, não perturbe, encaminhamento, gravação, DNS SRV, VAD, cancelamento de eco e log.

### 8.4 Tela Sobre

Item novo no menu principal, "Sobre o Starsonic Phone": logo; "Starsonic Phone <versão> (baseado no MicroSIP <versão upstream>)"; site, WhatsApp e telefone da Starsonic; e a linha "Baseado no MicroSIP — software livre sob a GNU GPL v3 — código-fonte: https://github.com/{conta}/starsonic-phone".

### 8.5 Textos e marca

- Nome **Starsonic Phone** em títulos de janela, bandeja, barra de tarefas, atalhos, instalador e "Aplicativos instalados".
- Tradução pt-BR do MicroSIP instalada ao lado do executável, revisada para trocar o nome. Textos novos da Starsonic já são escritos em português.
- Links de menu: "Visitar site" → https://starsonic.com.br/; "Ajuda" e páginas de problema → WhatsApp da Starsonic (https://wa.me/551150603000).
- User-Agent SIP: `Starsonic Phone/<versão>`.

## 9. Build e publicação

GitHub Actions no runner `windows-2022`, que já traz Visual Studio 2022 com MFC, NSIS 3.10, 7-Zip e vcpkg ([lista de software da imagem](https://github.com/actions/runner-images/blob/main/images/windows/Windows2022-Readme.md)).

**Dependências** (versões fixas em `build/deps.lock`): PJSIP (pjproject) 2.17; via vcpkg, no triplet `x86-windows-static`: OpenSSL, Opus, bcg729, SQLite e SQLiteCpp. O build monta uma pasta de trabalho com o pjproject e copia `microsip/`, `starsonic/` e `branding/` para dentro dela, porque o projeto do MicroSIP espera estar dentro da árvore do pjproject.

### 9.1 Workflow `importar-microsip` (manual)

Entrada: versão do MicroSIP (ex.: `3.22.16`). Baixa `MicroSIP-<versão>-src.7z` e `MicroSIP-Lite-<versão>.zip` de microsip.org, extrai o código para `microsip/` e os sons (e a tradução pt-BR, se o pacote trouxer) para `microsip-dist/`, faz commit no ramo `upstream`, cria a tag `microsip-<versão>` e abre um pull request de `upstream` para `main`. Roda no GitHub porque o ambiente de desenvolvimento do Claude não acessa microsip.org.

### 9.2 Workflow `build` (a cada push e pull request)

1. Compila as dependências (com cache).
2. Compila o app em Release Win32.
3. Roda os testes unitários.
4. Roda a varredura de marca (seção 11.2).
5. Gera o instalador NSIS.
6. Instala e desinstala em modo silencioso, conferindo arquivos, atalhos e chaves de registro.
7. Roda os testes de fumaça da interface.
8. Guarda o instalador como artefato do workflow.

### 9.3 Workflow `release` (tags)

- Tag `vX.Y.Z` → release estável com:
  - `StarsonicPhone-X.Y.Z-setup.exe`;
  - `versao.json`, com o SHA-256 calculado no próprio workflow;
  - `StarsonicPhone-X.Y.Z-codigo-fonte-completo.zip` — o repositório mais o código-fonte de todas as dependências usadas no build.
- Tag `vX.Y.Z-rc.N` → build com a URL de teste (seção 7.3), publicado como pre-release `vX.Y.Z-rc.N`. O instalador e o `versao.json` dessa versão também são publicados no pre-release fixo `canal-teste`, substituindo os anteriores.

### 9.4 Versões

- App: `MAJOR.MINOR.PATCH`, começando em 1.0.0, no recurso de versão do executável e do instalador; a versão vem da tag.
- Base: a versão do MicroSIP fica registrada em `branding/branding.h` e aparece na tela Sobre.

### 9.5 Instalador (NSIS)

- Por usuário (`RequestExecutionLevel user`), em `%LOCALAPPDATA%\Starsonic Phone\`.
- Atalho no menu Iniciar; atalho na área de trabalho e "Iniciar com o Windows" como opções do instalador, marcadas por padrão. Na atualização silenciosa, os atalhos existentes são mantidos.
- Desinstalador `Uninstall.exe` registrado em "Aplicativos instalados" (chave em HKCU); as configurações do usuário ficam preservadas, como no MicroSIP.
- Modo silencioso (`/S`), usado pelas atualizações: fecha o app (`/exit`), atualiza, preserva as configurações e reabre o app.
- Nome, ícone e logo da Starsonic.

## 10. Licença (GPL v3)

- MicroSIP e PJSIP são "GPL v2 ou posterior"; como o binário inclui OpenSSL 3 (Apache 2.0) e bcg729 (GPL v3), o Starsonic Phone é distribuído sob a **GNU GPL v3**. Os avisos de copyright originais ficam no código e no recurso de versão do executável.
- Repositório público, com o texto da GPL v3 em `LICENSE`.
- Cada release traz o código-fonte completo correspondente, inclusive das bibliotecas de terceiros, no mesmo lugar do instalador.
- Tela Sobre com a linha de atribuição e o link do código-fonte.
- O nome "MicroSIP" não aparece na interface nem em material de divulgação, exceto como atribuição.
- Bibliotecas novas só com licença compatível com a GPL v3 (nlohmann/json e doctest são MIT).

## 11. Erros e testes

### 11.1 Mensagens de erro

| Situação | O que o usuário vê |
|----------|--------------------|
| SIP 401, 403 ou 407 no registro | Ramal ou senha incorretos. |
| SIP 404 | Ramal não encontrado neste servidor. |
| Tempo esgotado, SIP 408 ou 5xx, sem resposta, falha de DNS ou de rede | Não foi possível falar com o servidor. Confira o endereço e a sua internet. |
| Falha de TLS | Não foi possível estabelecer uma conexão segura com o servidor. |
| Outros códigos | Não foi possível entrar (código <n>). Fale com o suporte da Starsonic. |
| Servidor vazio | Digite o endereço do servidor. |
| Servidor fora da regra de 7.1 (espaço, porta, `@`, `/`, acento etc.) | Digite só o endereço do servidor, como starcloud1-starsonic.com.br. |
| Ramal vazio ou com espaço, `@` ou `:` | Digite só o número do ramal. |
| Senha vazia | Digite a senha. |
| Atualizar com chamada em andamento | Termine a chamada para atualizar. |
| Download da atualização falhou ou SHA-256 diferente | Não foi possível baixar a atualização. Tentaremos de novo mais tarde. |
| Sem internet ao verificar atualização | Nada; nova tentativa no próximo ciclo e registro no log |
| Falha do instalador na atualização | Nada; o app continua na versão atual e o erro vai para o log |

Depois que a conta está registrada, quedas e reconexões seguem o comportamento padrão do MicroSIP (reconexão automática), refletidas na linha de status da faixa superior.

### 11.2 Testes automáticos (a cada build)

- **Unitários** do `starsonic/core`, escritos antes do código (TDD), com doctest — rodam no Linux e no Windows.
- **Varredura de marca:** reprova o build se "MicroSIP" aparecer em textos visíveis — recursos (.rc/.rc2), tradução pt-BR, textos do instalador e textos do código novo —, exceto na linha de atribuição da tela Sobre e no aviso de copyright do recurso de versão.
- **Instalador:** instalação e desinstalação silenciosas no runner, conferindo arquivos, atalhos e chaves de registro.
- **Fumaça da interface**, no mesmo build que vai para o instalador: o app abre e fecha; no primeiro acesso aparece a tela Entrar com o campo Servidor vazio; com um registrador SIP falso local (endereço `127.0.0.1` digitado), endereço inválido e ramal inválido são recusados, senha errada mostra "Ramal ou senha incorretos." e senha certa conecta; uma conta adulterada no INI registra pelo perfil; a tela Sobre mostra versão e licença; as Configurações não mostram os campos travados. Enquanto o perfil usar UDP, a mensagem de falha de TLS só é coberta pelos testes unitários; se o perfil passar para TLS, o teste manual passa a cobri-la.

### 11.3 Teste manual (checklist em `docs/teste-manual.md`, antes de cada versão estável)

Em Windows 10 e Windows 11, com um ramal de teste em cada servidor da Starsonic (`starcloud-starsonic.com.br` e `starcloud1-starsonic.com.br`):

- Instalar a partir do download pelo navegador (com o alerta esperado por falta de assinatura).
- Entrar com senha certa, senha errada e endereço de servidor errado, nos dois servidores.
- Ligar, receber, colocar em espera, transferir e enviar DTMF numa URA.
- Duas contas configuradas; trocar a ativa pelo menu; remover a última conta volta à tela Entrar.
- Conferir que "MicroSIP" não aparece, a tela Sobre e que o servidor aceita o User-Agent.
- Conviver com um MicroSIP instalado no mesmo PC.
- Atualização: um build `rc` instalado recebe a `rc` seguinte pelo `canal-teste` com um clique; com chamada em andamento, a atualização é bloqueada.
- Desinstalar.

## 12. Entradas necessárias da Starsonic

| Item | Para quê |
|------|----------|
| Usuário do GitHub dono do repositório (e o GitHub conectado à sessão do Claude) | `STARSONIC_GITHUB_ACCOUNT`; publicar o repositório e rodar o build |
| Logo em alta resolução (SVG ou PNG com 1024 px ou mais) e símbolo quadrado | Tela Entrar, faixa superior, Sobre, instalador e ícones de 16 a 256 px |
| Cores oficiais em hex: cor principal e cor do texto sobre ela | Tema (M5) |
| Porta, transporte, proxy, criptografia e keepalive das contas; STUN, codecs e DTMF — recebidos em 13/10/2026 (seção 6.3) | `perfil.ini` |
| Um ramal de teste por servidor (fica fora do repositório) | Testes manuais |
| Tradução pt-BR do MicroSIP, se o pacote "Lite" não a trouxer (exportada em microsip.org/translation) | Idioma do app |

## 13. Riscos

| Risco | Mitigação |
|-------|-----------|
| As bibliotecas de terceiros não vêm no pacote do MicroSIP, e o código pode depender de ajustes privados do autor no PJSIP | Primeira entrega de build: compilar o MicroSIP original contra o pjproject 2.17 oficial. Se faltar algo que exija mudar código do MicroSIP, paramos e decidimos juntos |
| Sem assinatura, o Windows mostra o alerta de "editor desconhecido" ao instalar pelo navegador | Aceito nesta fase; com o certificado, a assinatura entra como um passo novo no workflow `release` |
| Sem assinatura, a integridade das atualizações depende só da conta do GitHub (arquivo de versão e instalador no mesmo lugar) | Conta do GitHub com verificação em duas etapas; acesso de escrita ao repositório restrito |
| A plataforma do fornecedor filtrar o User-Agent | Testado em cada servidor; se filtrar, volta o User-Agent do MicroSIP |
| Com o endereço digitado, o app funciona com qualquer servidor SIP, não só os da Starsonic | Aceito na revisão 1.2: a marca e as travas técnicas continuam, e o suporte informa o endereço certo a cada cliente |
| Com UDP, a chave do SRTP opcional vai sem proteção na sinalização: quem capturar a sinalização consegue decifrar a chamada | Aceito na revisão 1.2; trocar para `transporte=tls` (porta 5061) no `perfil.ini` resolve com uma versão nova, sem mudar o código |
| Proteção contra força bruta nos servidores | É do fornecedor da plataforma; confirmar com ele |
| Repositório migrar da conta pessoal para uma organização | O GitHub redireciona os links antigos; nunca recriar um repositório com o mesmo nome na conta antiga |
| O tema e os ganchos conflitarem com versões novas do MicroSIP | Edições no código do MicroSIP limitadas à lista do plano, cada uma de poucas linhas, chamando `starsonic/` |

## 14. Próximos passos

1. Plano de implementação da revisão 1.2 (skill writing-plans); o da revisão 1.1 já foi executado.
2. Versão candidata nova para o teste manual (seção 11.3).
3. Depois do Windows: brainstorming do subprojeto 2 (celular).
