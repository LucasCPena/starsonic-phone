# Starsonic Phone para Windows — especificação de design

- **Data:** 11/10/2026
- **Status:** design aprovado no brainstorming; aguardando revisão desta especificação
- **Subprojeto:** 1 de 2 — o 2º é o app de celular (iOS e Android), com especificação própria

## 1. Contexto

A Starsonic (TI, telefonia e segurança para empresas em São Paulo, desde 1996) vende o **PABX em Nuvem**. Ele roda sobre a plataforma SIP de um fornecedor terceiro, distribuída em alguns servidores; cada cliente fica em um deles.

Este subprojeto cria o **Starsonic Phone para Windows**: um fork do [MicroSIP](https://www.microsip.org) — softphone open source para Windows, em C/C++ com MFC sobre a pilha PJSIP, licença GNU GPL v2 — com a marca da Starsonic, servidores embutidos e configurações travadas.

## 2. Objetivos

1. **Marca própria** — o cliente vê Starsonic, nunca MicroSIP.
2. **Configuração fácil** — o usuário escolhe o servidor, digita ramal e senha e liga.
3. **Controle e suporte** — configurações técnicas padronizadas e travadas; atualizações controladas pela Starsonic.

**Regra do projeto:** o comportamento padrão é o do MicroSIP. Qualquer mudança além das listadas na seção 4 precisa de aprovação prévia.

## 3. Critérios de sucesso

- Um usuário sem conhecimento técnico instala o app, escolhe o servidor, digita ramal e senha e completa uma ligação sem ver nenhum campo técnico.
- Nenhum texto, ícone ou janela mostra "MicroSIP", exceto a linha de atribuição da GPL na tela Sobre.
- O usuário não consegue alterar as configurações de conta e rede — nem pela interface, nem editando o arquivo de configuração.
- Uma versão nova chega como aviso no app e é instalada com um clique, sem pedir senha de administrador.
- O suporte identifica o app e a versão pela tela Sobre e pelo User-Agent SIP.
- Cada versão publicada cumpre a GPL v2: o código-fonte completo fica disponível junto do instalador.

## 4. Mudanças em relação ao MicroSIP padrão (aprovadas)

| # | Mudança | Decisão |
|---|---------|---------|
| M1 | Edição | Somente áudio (sem vídeo) |
| M2 | Acesso | Tela **Entrar** (servidor + ramal + senha) no lugar da janela de conta padrão; a mesma tela serve para adicionar e editar contas |
| M3 | Servidores | Perfis de servidor embutidos no app; mudar a lista exige versão nova |
| M4 | Marca | Nome **Starsonic Phone**, ícones, logo, textos, links de menu e tela Sobre próprios; versão própria a partir de 1.0.0 |
| M5 | Tema | Faixa superior (logo + status) e botões **Ligar** e **Entrar** na cor da marca; o resto da interface continua nativo |
| M6 | User-Agent | `Starsonic Phone/<versão>` no lugar de `MicroSIP/<versão>` |
| M7 | Travas | Campos de conta e rede e a verificação de atualizações ficam travados e somem da tela de Configurações |
| M8 | Instalação | Instalador próprio, por usuário, sem privilégio de administrador; pasta e configurações próprias |
| M9 | Atualização | Aviso no app e "baixar e instalar" com um clique, a partir dos releases do GitHub |

**Continua como no MicroSIP:** várias contas por instalação, idiomas, discador, histórico, contatos, transferência, espera, DTMF, encaminhamento, atendimento automático, não perturbe, atalhos, log, o tratamento de links de discagem que o MicroSIP já oferece (registrado com o nome Starsonic Phone), a arquitetura do executável e as bibliotecas de áudio. Qualquer opção não citada nesta especificação também continua como no MicroSIP.

## 5. Fora do escopo

- Recursos que o MicroSIP não tem (integrações com WhatsApp, IA, CRM etc.).
- Vídeo.
- Assinatura de código do instalador — fica para quando a Starsonic comprar o certificado (ver seção 13).
- Lista de servidores baixada da internet e provisionamento remoto.
- Tema completo da interface — só os três elementos de M5.
- App de celular (subprojeto 2).
- Windows anterior ao 10.

## 6. Arquitetura

### 6.1 Repositório

Repositório **público** `starsonic-phone` no GitHub, por enquanto na conta pessoal do responsável. A conta é a constante `GITHUB_CONTA` em `branding/` (valor na seção 12) e aparece nas URLs abaixo como `{conta}`.

Ramos:

- `upstream` — o código do MicroSIP exatamente como publicado em microsip.org. Cada versão importada é um commit com a tag `microsip-<versão>`; a primeira é `microsip-3.22.16`.
- `main` — `upstream` + as mudanças da Starsonic. Trazer uma versão nova do MicroSIP = importar no `upstream` e fazer merge no `main`. A diferença `upstream..main` mostra tudo o que a Starsonic mudou.

Pastas do `main`, além do código do MicroSIP:

| Pasta | Conteúdo |
|-------|----------|
| `branding/` | Tudo o que é marca e dado da Starsonic: nome, versão, ícones, logo, cores, textos, perfis de servidor (`servidores.ini`), conta do GitHub e URLs |
| `starsonic/` | Código novo, em módulos pequenos e testáveis (seção 6.2) |
| `tests/` | Testes unitários do código em `starsonic/` |
| `installer/` | Script NSIS do instalador |
| `build/` | Scripts de dependências e de build; `deps.lock` com a versão fixa de cada biblioteca |
| `.github/workflows/` | Importação do upstream, build e publicação |
| `docs/` | Especificações, planos e checklist de testes manuais |

**Princípio:** as edições em arquivos do próprio MicroSIP são mínimas — pontos de entrada que chamam os módulos de `starsonic/`. Isso mantém pequenos os merges de versões novas.

### 6.2 Componentes

| Módulo | Responsabilidade | Depende de |
|--------|------------------|------------|
| `ServerProfiles` | Lê `servidores.ini` (embutido no executável como recurso) e devolve os perfis; busca por id | — |
| `AccountPolicy` | Monta contas a partir de perfil + credenciais; ao iniciar, reaplica o perfil sobre cada conta lida do INI (sobrescreve os campos travados) e desativa contas cujo servidor não existe mais | `ServerProfiles` |
| `LoginDialog` | Tela Entrar: servidor, ramal e senha; usada no primeiro acesso e em Adicionar/Editar conta | `ServerProfiles`, `AccountPolicy`, `RegistrationErrors` |
| `RegistrationErrors` | Traduz o código SIP ou o erro de transporte do registro em mensagem pt-BR | — |
| `UpdateManifest` | Interpreta `versao.json` e compara versões | — |
| `Updater` | Agenda a verificação, baixa o instalador, confere o SHA-256 e roda o instalador silencioso | `UpdateManifest` |
| `BrandTheme` | Desenha a faixa superior (logo + status) e os botões Ligar e Entrar na cor da marca | `branding/` |
| `SettingsFilter` | Esconde da tela de Configurações os campos travados | — |

`ServerProfiles`, `AccountPolicy` (montagem e reaplicação), `RegistrationErrors` e `UpdateManifest` são lógica pura — texto ou dados entram, dados saem — e concentram o que é testável. Os demais são camadas finas sobre a interface do MicroSIP.

### 6.3 Perfil de servidor (`branding/servidores.ini`)

Um bloco por servidor. O id do bloco é gravado em cada conta, então nunca muda depois de publicado.

```ini
[sp1]
nome=Servidor 1
endereco=sip1.exemplo.invalid
porta=5060
transporte=udp            ; udp | tcp | tls
proxy=                    ; vazio = sem proxy
stun=                     ; vazio = sem STUN
srtp=desativado           ; desativado | opcional | obrigatorio
codecs=G722,PCMA,PCMU     ; ordem de preferência
dtmf=rfc2833              ; rfc2833 | inband | info
keepalive=15              ; segundos
```

Os valores acima só ilustram o formato; os reais vêm do fornecedor da plataforma (seção 12). Regras de leitura: id duplicado, campo obrigatório ausente (`nome`, `endereco`, `porta`, `transporte`) ou valor fora das opções invalida o arquivo inteiro — e o build falha, porque os testes leem o arquivo real de `branding/`.

### 6.4 Arquivos no PC do usuário

- Programa: `%LOCALAPPDATA%\Starsonic Phone\`
- Configurações: `%APPDATA%\Starsonic Phone\`, no mesmo formato INI do MicroSIP, acrescido do id do servidor em cada conta. A senha é guardada como o MicroSIP já guarda.
- Instância única com identificador próprio, sem conflito com um MicroSIP instalado no mesmo PC.

## 7. Fluxos

### 7.1 Entrar, adicionar e editar conta

1. Sem contas configuradas, o app abre a tela Entrar. A mesma tela abre em Contas → Adicionar e Contas → Editar (com os dados atuais preenchidos).
2. O usuário escolhe o servidor (o primeiro da lista vem selecionado), digita ramal e senha e clica Entrar.
3. `AccountPolicy` monta a conta: perfil do servidor + ramal (como usuário SIP e login) + senha; nome de exibição = ramal.
4. O app tenta registrar a conta e espera o resultado por até 15 s.
5. Registrou → a conta é gravada no INI, a tela fecha e a faixa superior mostra "Conectado · <ramal> · <servidor>".
   Falhou → a conta não é gravada (na edição, a versão anterior continua valendo); a tela continua aberta com a mensagem de `RegistrationErrors` para o usuário corrigir.
6. Remover a última conta volta à tela Entrar.

### 7.2 Inicialização

1. O app lê o INI.
2. `AccountPolicy` reaplica o perfil em cada conta. Conta com servidor desconhecido fica desativada, e o app abre a tela Entrar com o aviso "O servidor desta conta mudou. Entre novamente."
3. As contas ativas são registradas; daí em diante vale o comportamento padrão do MicroSIP.

### 7.3 Atualização

1. Ao abrir e a cada 24 h, `Updater` baixa `versao.json` (HTTPS, seguindo redirecionamentos) da URL definida em `branding/`:
   - versões estáveis: `https://github.com/{conta}/starsonic-phone/releases/latest/download/versao.json` — sempre aponta para o release mais recente que não é pre-release e não usa a API do GitHub, então não tem limite de consultas;
   - builds de teste: `https://github.com/{conta}/starsonic-phone/releases/download/canal-teste/versao.json` — pre-release fixo `canal-teste`, que o pipeline sobrescreve a cada versão candidata.
2. Se a versão do arquivo for maior que a instalada, o app mostra o aviso "Nova versão do Starsonic Phone disponível", com as notas e o botão Atualizar.
3. Atualizar com chamada em andamento → "Termine a chamada para atualizar." e nada acontece.
4. O instalador é baixado para uma pasta temporária e o SHA-256 é conferido com o do arquivo de versão. Diferente ou download com falha → o arquivo é apagado e aparece "Não foi possível baixar a atualização. Tentaremos de novo mais tarde."
5. O app inicia o instalador em modo silencioso e se fecha. O instalador espera o app fechar, atualiza os arquivos (preservando as configurações) e abre o app de novo.

### 7.4 Formato de `versao.json`

```json
{
  "versao": "1.0.1",
  "instalador": "https://github.com/{conta}/starsonic-phone/releases/download/v1.0.1/StarsonicPhone-1.0.1-setup.exe",
  "sha256": "<64 caracteres hexadecimais>",
  "notas": "Texto curto mostrado no aviso."
}
```

- `versao` segue `MAJOR.MINOR.PATCH`; a comparação é numérica, campo a campo.
- JSON inválido ou campo ausente → o arquivo é ignorado, nenhum aviso aparece e o erro vai para o log.
- Leitura com a biblioteca nlohmann/json (cabeçalho único, licença MIT).

## 8. Interface

### 8.1 Tela Entrar

Logo; campos Servidor (lista suspensa), Ramal e Senha; botão Entrar na cor da marca; linha "Precisa de ajuda? (11) 5060-3000". Mensagens de erro aparecem abaixo da senha, em vermelho.

### 8.2 Janela principal

Igual à do MicroSIP, com as duas diferenças de M5: faixa superior na cor da marca com o logo e a linha de status ("Conectado · 2001 · Servidor 1"), e botão Ligar na cor da marca. Com várias contas, a linha de status segue a conta usada para discar.

### 8.3 Configurações

Somem da tela (M7): servidor, proxy, domínio, usuário e login técnicos, transporte, portas locais e de RTP, endereço público, STUN, ICE, TLS/SRTP, codecs e sua ordem, método de DTMF, keep-alive e a frequência de verificação de atualizações (fixa: ao abrir e a cada 24 h).

Continuam visíveis: idioma, dispositivos de áudio, toque, iniciar com o Windows, atendimento automático, não perturbe, encaminhamento, atalhos, log e as demais opções não citadas nesta especificação.

### 8.4 Tela Sobre

Logo; "Starsonic Phone <versão> (baseado no MicroSIP <versão upstream>)"; site, WhatsApp e telefone da Starsonic; e a linha "Baseado no MicroSIP — software livre sob a GNU GPL v2 — código-fonte: <URL do repositório>".

### 8.5 Textos e marca

- Nome **Starsonic Phone** em títulos de janela, bandeja, barra de tarefas, atalhos, instalador e "Aplicativos instalados".
- Português do Brasil como idioma padrão; a tradução pt-BR do MicroSIP é revisada para trocar o nome.
- Links de menu (site e ajuda) apontam para starsonic.com.br e para o WhatsApp da Starsonic.
- User-Agent SIP: `Starsonic Phone/<versão>`.

## 9. Build e publicação

GitHub Actions no runner `windows-2022`, que já traz Visual Studio 2022 com MFC, NSIS 3.10 e 7-Zip ([lista de software da imagem](https://github.com/actions/runner-images/blob/main/images/windows/Windows2022-Readme.md)).

### 9.1 Workflow `importar-microsip` (manual)

Entrada: versão do MicroSIP (ex.: `3.22.16`). Baixa `MicroSIP-<versão>-src.7z` de microsip.org, extrai, faz commit no ramo `upstream`, cria a tag `microsip-<versão>` e abre um pull request de `upstream` para `main`. Roda no GitHub porque o ambiente de desenvolvimento do Claude não acessa microsip.org.

### 9.2 Workflow `build` (a cada push e pull request)

1. Restaura do cache, ou compila, as dependências nas versões de `build/deps.lock` — as mesmas que o MicroSIP 3.22.16 usa, sem as de vídeo.
2. Compila o app em Release, na mesma arquitetura do build oficial do MicroSIP.
3. Roda os testes unitários.
4. Roda a varredura de marca (seção 11.2).
5. Gera o instalador NSIS.
6. Instala e desinstala em modo silencioso, conferindo arquivos, atalhos e chaves de registro.
7. Guarda o instalador como artefato do workflow.

### 9.3 Workflow `release` (tags)

- Tag `vX.Y.Z` → release estável com:
  - `StarsonicPhone-X.Y.Z-setup.exe`;
  - `versao.json`, com o SHA-256 calculado no próprio workflow;
  - `StarsonicPhone-X.Y.Z-codigo-fonte-completo.zip` — o repositório mais o código-fonte de todas as dependências usadas no build.
- Tag `vX.Y.Z-rc.N` → build com a URL de teste (seção 7.3), publicado como pre-release `vX.Y.Z-rc.N` e copiado para o pre-release fixo `canal-teste`.

### 9.4 Versões

- App: `MAJOR.MINOR.PATCH`, começando em 1.0.0, no recurso de versão do executável e do instalador.
- Base: a versão do MicroSIP fica registrada em `branding/` e aparece na tela Sobre.

### 9.5 Instalador (NSIS)

- Por usuário (`RequestExecutionLevel user`), em `%LOCALAPPDATA%\Starsonic Phone\`.
- Atalho no menu Iniciar; atalho na área de trabalho opcional.
- Desinstalador registrado em "Aplicativos instalados" (chave em HKCU).
- Modo silencioso (`/S`), usado pelas atualizações: espera o app fechar, atualiza, preserva as configurações e reabre o app.
- Nome, ícone e logo da Starsonic.

## 10. Licença (GPL v2)

- O código do MicroSIP e as mudanças da Starsonic seguem sob a GNU GPL v2, a mesma licença do upstream; os avisos de copyright originais ficam no código.
- Repositório público.
- Cada release traz o código-fonte completo correspondente, inclusive das bibliotecas de terceiros, no mesmo lugar do instalador.
- Tela Sobre com a linha de atribuição e o link do código-fonte.
- O nome "MicroSIP" não aparece na interface nem em material de divulgação, exceto como atribuição.
- Bibliotecas novas só com licença compatível com a GPL v2 (nlohmann/json e doctest são MIT).

## 11. Erros e testes

### 11.1 Mensagens de erro

| Situação | O que o usuário vê |
|----------|--------------------|
| SIP 401 ou 403 no registro | Ramal ou senha incorretos. |
| SIP 404 | Ramal não encontrado neste servidor. |
| Tempo esgotado, SIP 408 ou 5xx, falha de DNS ou de rede | Não foi possível falar com o servidor. Verifique sua internet. |
| Falha de TLS | Não foi possível estabelecer uma conexão segura com o servidor. |
| Outros códigos | Não foi possível entrar (código <n>). Fale com o suporte da Starsonic. |
| Conta com servidor removido da lista | O servidor desta conta mudou. Entre novamente. |
| Atualizar com chamada em andamento | Termine a chamada para atualizar. |
| Download da atualização falhou ou SHA-256 diferente | Não foi possível baixar a atualização. Tentaremos de novo mais tarde. |
| Sem internet ao verificar atualização | Nada; nova tentativa no próximo ciclo e registro no log |
| Falha do instalador na atualização | Nada; o app continua na versão atual e o erro vai para o log |

Depois que a conta está registrada, quedas e reconexões seguem o comportamento padrão do MicroSIP (reconexão automática), refletidas na linha de status da faixa superior.

### 11.2 Testes automáticos (a cada build)

- **Unitários**, escritos antes do código (TDD), com doctest:
  - `ServerProfiles`: leitura válida, campo obrigatório ausente, id duplicado, valor fora das opções, e o `servidores.ini` real de `branding/`;
  - `AccountPolicy`: montagem da conta, sobrescrita dos campos travados, servidor desconhecido;
  - `RegistrationErrors`: cada linha de registro da tabela 11.1;
  - `UpdateManifest`: comparação de versões, JSON inválido, campos ausentes;
  - verificação de SHA-256.
- **Varredura de marca:** reprova o build se "MicroSIP" aparecer em recursos (.rc), traduções ou textos do instalador, exceto na linha de atribuição da tela Sobre e nos avisos de licença.
- **Instalador:** instalação e desinstalação silenciosas no runner, conferindo arquivos, atalhos e chaves de registro.

### 11.3 Teste manual (checklist em `docs/`, antes de cada versão estável)

Em Windows 10 e Windows 11, com um ramal de teste em cada servidor:

- Instalar a partir do download pelo navegador (com o alerta esperado por falta de assinatura).
- Entrar com senha certa, senha errada e servidor errado.
- Ligar, receber, colocar em espera, transferir e enviar DTMF numa URA.
- Duas contas ao mesmo tempo; remover a última conta volta à tela Entrar.
- Conferir que "MicroSIP" não aparece, a tela Sobre e que o servidor aceita o User-Agent.
- Conviver com um MicroSIP instalado no mesmo PC.
- Atualização: um build `rc` instalado recebe a `rc` seguinte pelo `canal-teste` com um clique; com chamada em andamento, a atualização é bloqueada.
- Desinstalar.

## 12. Entradas necessárias da Starsonic

| Item | Para quê |
|------|----------|
| Usuário do GitHub dono do repositório | Constante `GITHUB_CONTA` (URLs do repositório e do arquivo de versão) |
| Logo em alta resolução (SVG ou PNG com 1024 px ou mais) e símbolo quadrado | Tela Entrar, faixa superior, Sobre, instalador e ícones de 16 a 256 px |
| Cores oficiais em hex: cor principal e cor do texto sobre ela | Tema (M5) |
| Por servidor: nome amigável, endereço, porta, transporte, proxy, STUN, criptografia e codecs recomendados pelo fornecedor | `servidores.ini` |
| Um ramal de teste por servidor (fica fora do repositório) | Testes manuais |

## 13. Riscos

| Risco | Mitigação |
|-------|-----------|
| As bibliotecas de terceiros não vêm no pacote de código-fonte do MicroSIP e não são documentadas | Primeira tarefa do plano: importar o código, identificar as dependências e fixar as versões em `deps.lock`, antes de qualquer mudança |
| Sem assinatura, o Windows mostra o alerta de "editor desconhecido" ao instalar pelo navegador | Aceito nesta fase; com o certificado, a assinatura entra como um passo novo no workflow `release` |
| Sem assinatura, a integridade das atualizações depende só da conta do GitHub (arquivo de versão e instalador no mesmo lugar) | Conta do GitHub com verificação em duas etapas; acesso de escrita ao repositório restrito |
| A plataforma do fornecedor filtrar o User-Agent | Testado em cada servidor; se filtrar, volta o User-Agent do MicroSIP |
| Endereços dos servidores ficam públicos no repositório (já estariam no executável) | Proteção contra força bruta nos servidores é do fornecedor; confirmar com ele |
| Repositório migrar da conta pessoal para uma organização | O GitHub redireciona os links antigos; nunca recriar um repositório com o mesmo nome na conta antiga, para não quebrar o redirecionamento usado pelas versões já instaladas |
| O tema conflitar com versões novas do MicroSIP | Limitado aos três elementos de M5, isolado em `BrandTheme`, com edição mínima nos arquivos do MicroSIP |

## 14. Próximos passos

1. Revisão desta especificação.
2. Plano de implementação (skill writing-plans).
3. Depois do Windows: brainstorming do subprojeto 2 (celular).
