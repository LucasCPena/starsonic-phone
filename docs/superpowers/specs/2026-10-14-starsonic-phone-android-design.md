# Starsonic Phone para Android — especificação de design

- **Data:** 14/10/2026
- **Status:** aprovada pelo responsável em 14/10/2026, com os itens novos da revisão (diagnóstico, uma ligação por vez, transferência direta, Ligar em verde, avisos de ligação não completada, reconexão a partir do primeiro desbloqueio, Opus sem G.729, Sair mantém os Recentes, botão de mostrar a senha); revisão de 15/10/2026: processador acordado com a conta conectada (decisão 6), confirmação do Sair e aviso ao ligar com uma ligação do celular em andamento
- **Subprojeto:** 2 de 2 (app de celular), **etapa 1: Android, APK de teste**. O aviso do servidor (push), a Play Store e o iPhone vêm em etapas seguintes, cada uma com especificação própria.
- **Base:** a especificação do Windows (`2026-10-11-starsonic-phone-windows-design.md`, revisão 1.4), de onde vêm as regras da tela Entrar, o perfil e as mensagens de erro.

> **Decisões do responsável** (13 a 15/10/2026):
> 1. O app de celular é para quem precisa receber as ligações do ramal a qualquer hora, com o celular no bolso e o app fechado (ex.: vendedor ou técnico na rua).
> 2. Android e iPhone; até 300 usuários no primeiro ano, começando com menos; primeira versão em poucas semanas.
> 3. Caminho escolhido: **app próprio com o motor de ligações do MicroSIP (PJSIP)**, começando pelo **Android**, distribuído como **APK de teste** pelo GitHub. Descartados: app pronto de marca branca (mensalidade), adaptar o Linphone e adaptar o baresip.
> 4. Desenho aprovado em 5 partes: o que a primeira versão faz; como toca com o app fechado; a marca; instalação e atualização; testes.
> 5. O cadastro de desenvolvedor no Google e a Play Store ficam para depois do primeiro APK.
> 6. (15/10/2026) Com a conta conectada, o app mantém o processador do celular acordado (a tela apaga normalmente), para a renovação do registro e o keep-alive não pararem com o celular no bolso; o consumo de bateria é medido no teste manual (seção 7.2, item 6).

## 1. Contexto

A Starsonic vende o **PABX em Nuvem**, que roda sobre a plataforma SIP de um fornecedor terceiro (seção 1 da especificação do Windows). O Starsonic Phone para Windows (subprojeto 1) está na versão de teste 0.0.1-rc.5.

O MicroSIP só existe para Windows. O app de celular é escrito do zero, com o mesmo motor de ligações (PJSIP 2.17) e as mesmas regras do Windows: o núcleo `starsonic/core` (perfil, tela Entrar, mensagens de erro, arquivo de versão) passa a ser compilado também para o Android.

No celular, tocar com o app fechado depende do sistema, que pausa os apps em segundo plano. Na etapa 1, o app fica conectado com um serviço em primeiro plano (notificação fixa). Na etapa 2, um servidor da Starsonic acorda o celular pelo aviso do Google (push), sem notificação fixa.

## 2. Objetivos

1. **Ramal no bolso** — o celular toca com o app fechado e a tela bloqueada.
2. **Marca própria** — o cliente vê Starsonic; "MicroSIP" não aparece.
3. **Mesma configuração do Windows** — servidor, protocolo, ramal e senha; o resto vem do perfil e fica travado.
4. **Base para as próximas etapas** — o motor de ligações fica numa camada em C++, sem nada de Android, que o push (etapa 2) e o iPhone vão reaproveitar.

## 3. Critérios de sucesso (etapa 1)

- Uma pessoa sem conhecimento técnico instala o APK pelo link, digita o servidor, o ramal e a senha (o Protocolo já vem marcado com o padrão do perfil) e completa uma ligação sem mexer em nenhum outro campo técnico.
- Com o app fechado (fora da tela ou tirado da lista de apps recentes), uma ligação para o ramal toca — em tela cheia com a tela bloqueada ou apagada; no alto da tela com o celular em uso — no Wi-Fi e no 4G, depois de 1 hora com o celular parado e depois de reiniciar o celular (a partir do primeiro desbloqueio), em pelo menos duas marcas de celular (ex.: Samsung e Motorola), com as permissões e a isenção de bateria concedidas.
- Na ligação, o áudio passa nos dois sentidos e funcionam mudo, viva-voz, fone Bluetooth, espera, transferir e o teclado (DTMF).
- Nenhum texto, ícone ou tela mostra "MicroSIP"; o suporte identifica o app e a versão pela tela Sobre e pelo User-Agent SIP.
- O usuário não consegue alterar nada técnico além do endereço do servidor, do protocolo e do ramal e da senha.
- Uma versão de teste nova chega como aviso no app e é instalada com a confirmação do Android.
- O consumo de bateria num dia em espera é medido no teste manual e aprovado pelo responsável.
- Cada APK publicado cumpre a GPL: o código-fonte completo fica disponível junto dele.

## 4. O que a etapa 1 entrega

### 4.1 Telas

| Tela | Conteúdo |
|------|----------|
| Entrar | Logo no cartão branco; "Servidor (endereço ou IP)" com o "Protocolo" (UDP ou TCP) ao lado; Ramal; Senha (com o botão de mostrar); botão Entrar; "Precisa de ajuda? (11) 5060-3000" — tocar abre o discador do celular com o número. |
| Teclado | Faixa azul com o logo, o status ("Conectado · 2001", "Conectando…" ou o motivo da falha) e o menu (⋮); número digitado; teclado 0–9, * e #; botão Ligar. |
| Recentes | Ligações feitas, recebidas e perdidas (até 200, das mais novas para as mais antigas), com número, data, hora e duração; tocar numa delas liga de volta. |
| Chamada | Recebida: o número (e o nome, se o PABX mandar), Recusar e Atender. Em andamento: número, tempo, Mudo, Teclado, Viva-voz (ou a escolha Celular, Viva-voz ou Bluetooth quando há fone Bluetooth), Espera, Transferir e Desligar. A tela apaga ao encostar no rosto. |
| Menu | Editar conta, Sair da conta e Sobre. |
| Sobre | "Starsonic Phone <versão>", site, WhatsApp, telefone de suporte, a licença GPL v3 com o link do código-fonte, os créditos do PJSIP e do Opus e "Enviar diagnóstico". |
| Permissões | Depois do primeiro Entrar: notificações, microfone, tela cheia (quando o Android pedir) e uso de bateria sem restrição, cada uma pela janela do próprio Android; em Xiaomi e Samsung, um passo a passo para liberar o app nos ajustes do fabricante. |

Teclado e Recentes ficam em abas na parte de baixo.

### 4.2 Decisões

- **Uma conta por celular**, sem o campo "Nome da conta" (com uma conta só, a faixa mostra o ramal).
- **Uma ligação por vez.** Com uma ligação em andamento (do ramal ou da operadora), uma nova ligação do ramal recebe "ocupado" (SIP 486) e entra no Recentes como perdida.
- **Transferir** é a transferência direta (sem consulta): digita-se o número e a ligação passa para ele.
- **Perfil igual ao do Windows** (`branding/perfil.ini`): porta, protocolo padrão, proxy, SRTP, keep-alive, STUN, codecs e DTMF (seção 6.3).
- **User-Agent:** `Starsonic Phone Android/<versão>`.
- **Idioma:** só português (Brasil).
- **Android:** 9 (API 28) ou mais novo; feito para o Android 16 (API 36), o mínimo da Play Store desde 31/08/2026.
- **Toque:** o toque de chamada do próprio celular; o app segue o modo silencioso ou vibrar e o Não perturbe do Android.

## 5. Fora do escopo da etapa 1

- Aviso do servidor (push) — etapa 2, com especificação própria, depois dos testes desta etapa.
- Play Store e cadastro de desenvolvedor no Google — depois do primeiro APK (decisão 5).
- iPhone.
- Contatos do celular, vídeo, mensagens, gravação, conferência, várias contas, nome da conta, transferência com consulta, segunda ligação em espera e TLS.
- Telas próprias para tablet, Android Auto, relógios e outros idiomas.
- Ligações do app no histórico de chamadas do próprio Android (o app tem o seu, em Recentes).

## 6. Arquitetura

### 6.1 Repositório

O Android fica no mesmo repositório do Windows:

| Pasta | Conteúdo |
|-------|----------|
| `starsonic/core/` | O núcleo atual (C++14, sem dependências), sem mudar a interface; passa a ser compilado também para o Android |
| `starsonic/phone/` | **Novo.** Motor de ligações em C++ sobre o PJSIP (pjsua2): conta, registro, ligações e eventos. Sem nada de Android, para ser reaproveitado no iPhone |
| `android/` | **Novo.** Projeto Android (Gradle): app em Kotlin com Jetpack Compose e a ponte JNI para `starsonic/phone` e `starsonic/core` |
| `build/android/` | **Novo.** Script que compila para o Android o mesmo pjproject 2.17 de `build/deps.lock`, mais o Opus |
| `tests/phone/` | **Novo.** Testes do motor no Linux, contra o registrador SIP falso |
| `tests/smoke/fake_registrar.py` | Passa também a ligar (INVITE) para o ramal registrado e a responder aos INVITE do app |
| `docs/teste-manual-android.md` | **Novo.** Roteiro do teste manual |

### 6.2 Componentes

| Componente | Responsabilidade | Depende de |
|------------|------------------|-----------|
| `SipEngine` (`starsonic/phone`) | Inicia o PJSIP com o perfil; cria a conta (servidor, protocolo, ramal e senha); registra e desregistra; faz, atende, recusa, desliga, põe em espera, transfere e manda DTMF; refaz transporte e registro na troca de rede; avisa os eventos (registro, ligação recebida, estado da ligação) por uma interface de callbacks | PJSIP 2.17, `core` |
| Ponte JNI (`android/app/src/main/cpp`) | Expõe o `SipEngine` e as funções do `core` (validar servidor e ramal, mensagens de erro, perfil, arquivo de versão) ao Kotlin; entrega os eventos numa thread própria | `SipEngine`, `core` |
| `SipService` | Serviço em primeiro plano (tipo `specialUse`) que mantém o motor e o registro vivos, com a notificação fixa; durante as ligações, acrescenta os tipos `phoneCall` e `microphone` | Ponte JNI |
| `CallConnectionService` | Integra as ligações ao Android (Telecom, modo *self-managed*): notificação de ligação com tela cheia, rotas de áudio, Bluetooth e convivência com as ligações da operadora | `SipService` |
| Receptores | Ligam o serviço depois de reiniciar (`BOOT_COMPLETED`) e de atualizar (`MY_PACKAGE_REPLACED`); avisam o motor da troca de rede | `SipService` |
| Armazenamento | Conta (servidor, protocolo e ramal), senha cifrada com uma chave do Android Keystore, Recentes e log de diagnóstico | — |
| `Updater` | Procura versão nova, baixa o APK, confere o SHA-256 e abre o instalador do Android | `core` (`UpdateManifest`) |
| Telas (Compose) | Entrar, Teclado, Recentes, Chamada, Menu, Sobre e Permissões | Todos acima |

### 6.3 Perfil

O mesmo `branding/perfil.ini` vai dentro do APK e é lido pelo `ParseProfile` do núcleo. A conta é montada pelo `BuildAccount` (com o nome da conta vazio) e convertida para a configuração do pjsua2:

- identidade `sip:<ramal>@<endereço>`; registrador `sip:<endereço>:<porta>;transport=<udp|tcp>`; proxy do perfil; autenticação Digest com o ramal e a senha;
- SRTP do perfil; keep-alive UDP do perfil; renovação do registro a cada 300 s;
- codecs na ordem do perfil — no Android, o build traz G.722, PCMA, PCMU e Opus; o G.729 não entra, e um G.729 no perfil é ignorado com uma linha no log;
- DTMF pelo método do perfil; STUN do perfil.

### 6.4 Dados no celular

Tudo fica no armazenamento privado do app: a conta, a senha (cifrada com uma chave do Android Keystore, que não sai do celular), os Recentes e o log de diagnóstico (até 1 MB; o mais antigo sai primeiro; sem senhas). Nada é enviado para fora: o log só sai quando a pessoa toca em "Enviar diagnóstico" e escolhe para onde mandar. Desinstalar o app apaga tudo.

## 7. Fluxos

### 7.1 Entrar, editar e sair

1. Sem conta, o app abre na tela Entrar, com o Protocolo marcado no padrão do perfil.
2. Os campos são conferidos na mesma ordem e com as mesmas mensagens do Windows (seção 7.1 de lá), pelo mesmo código do núcleo.
3. O app registra a conta e espera o resultado por até 15 s, com o `LoginFlow` do núcleo. Registrou → a conta é gravada e abre o Teclado. Falhou ou esgotou o tempo → nada é gravado, a conta anterior volta (em Editar) e a mensagem aparece na tela.
4. Depois do primeiro Entrar, o app pede as permissões (tela Permissões). Sem notificações, microfone, tela cheia ou isenção de bateria, a faixa mostra o aviso da seção 11.1 com um botão para os ajustes do Android.
5. Editar conta abre a tela Entrar com servidor, protocolo e ramal preenchidos e a senha vazia.
6. Sair da conta pede confirmação ("Sair da conta?" — "Este celular deixa de receber as ligações do ramal. Para entrar de novo, você vai precisar da senha.", com Cancelar e Sair), desregistra, apaga a conta e a senha e volta à tela Entrar; os Recentes ficam.
7. Se o servidor recusar a senha mais tarde (401, 403 ou 407 ao renovar o registro), o app abre a tela Entrar com "Ramal ou senha incorretos."

### 7.2 Conectado em segundo plano

1. Com a conta gravada, o `SipService` fica rodando com a notificação "Starsonic Phone · Conectado (ramal <ramal>)" — ou "Conectando…", ou o motivo da falha.
2. O serviço volta sozinho depois de reiniciar o celular — a partir do primeiro desbloqueio, porque a senha fica no armazenamento cifrado do Android — e depois de uma atualização do app.
3. Na troca de rede (Wi-Fi ↔ 4G, ou uma rede nova), o motor refaz o transporte e o registro sozinho. Uma ligação em andamento pode cair nessa troca (aceito na etapa 1).
4. Sem internet, o status mostra "Sem internet", e o motor tenta de novo quando a rede volta.
5. O app pede ao Android para ficar fora da otimização de bateria; sem isso, a faixa lembra o pedido. Em Xiaomi e Samsung, um passo a passo mostra os ajustes do fabricante.
6. Com a tela apagada, o Android põe o processador para dormir, mesmo com o serviço em primeiro plano, e aí a renovação do registro e o keep-alive param. Por isso, enquanto o serviço está com a conta e há rede, o app mantém o processador acordado (a tela apaga normalmente); sem rede, depois de uma recusa do servidor que o motor não tenta de novo (a senha recusada, por exemplo: nada a renovar até a rede mudar, a conta mudar ou o próximo Entrar), ou depois de Sair, ele deixa o processador dormir. Depende da isenção de bateria (item 5): sem ela, o Android ignora o pedido no modo de economia. O consumo entra na medição de bateria do teste manual (decisão 6).

### 7.3 Ligação recebida

1. O INVITE chega ao motor, que avisa o Kotlin. O app registra a ligação no Android (Telecom) e mostra a notificação de ligação: tela cheia com a tela bloqueada ou apagada; no alto da tela com o celular em uso. Toca e vibra conforme o modo do celular.
2. Se já houver uma ligação (do ramal ou da operadora), o app responde "ocupado" (486) e anota a ligação como perdida.
3. Atender abre a tela de chamada. Recusar responde 486 e anota a perdida.
4. Ligação não atendida (o outro lado desistiu) → notificação "Ligação perdida de <número>" e entrada no Recentes.

### 7.4 Ligação feita

Do Teclado ou do Recentes, o app pede ao Android para ligar pela conta do app (Telecom), e o motor faz o INVITE. Sem registro, aparece "Sem conexão com o servidor. Tente de novo em instantes." e o app não liga. Se o outro lado recusar, a tela de chamada mostra o motivo por 2 s (seção 11.1).

### 7.5 Durante a ligação

Mudo, viva-voz e Bluetooth pela rota de áudio do Android; Espera (re-INVITE sendonly) e retomar; Teclado (DTMF pelo método do perfil); Transferir (REFER para o número digitado; a ligação termina quando o PABX aceitar a transferência); Desligar.

### 7.6 Atualização

1. Ao abrir (se a última verificação tem mais de 24 h) e a cada 24 h, o app baixa por HTTPS o `versao-android.json` do seu canal:
   - versões estáveis: `https://github.com/{conta}/starsonic-phone/releases/download/canal-android/versao-android.json`;
   - versões de teste (`-rc`): `https://github.com/{conta}/starsonic-phone/releases/download/canal-teste-android/versao-android.json`.
2. Versão maior que a instalada → notificação e aviso "Nova versão do Starsonic Phone disponível (<versão>). Atualizar agora?", com as notas.
3. Com ligação em andamento → "Termine a chamada para atualizar." e nada acontece.
4. O APK é baixado para a pasta privada do app e o SHA-256 é conferido. Diferente ou falha no download → o arquivo é apagado e aparece "Não foi possível baixar a atualização. Tentaremos de novo mais tarde."
5. O app abre o instalador do Android, e a pessoa toca em "Atualizar". Na primeira vez, o Android pede para permitir que o Starsonic Phone instale apps.
6. Depois da atualização, o serviço volta sozinho (7.2).

### 7.7 Formato de `versao-android.json`

Igual ao `versao.json` do Windows (seção 7.4 de lá) e lido pelo mesmo `ParseManifest`, com o APK no campo `instalador`, que precisa começar com `https://github.com/{conta}/starsonic-phone/releases/download/android-v`.

## 8. Interface e marca

- **Ícone:** ícone adaptável do Android feito a partir do símbolo do Windows (círculo azul `#383881`, anel ciano `#3DB1CC` e fone branco), com a versão monocromática para os ícones temáticos e o ícone da notificação só em branco.
- **Nomes:** "Starsonic" embaixo do ícone; "Starsonic Phone" no resto (notificações, Sobre e User-Agent).
- **Cores:** azul-marinho `#383881` e ciano `#3DB1CC`. A faixa do topo é azul com o `logo-faixa.png` ("starsonic" em branco e ciano). Ligar e Atender em verde; Recusar e Desligar em vermelho.
- **Tela Entrar:** o logo completo no cartão branco (`logo-entrar.png`).
- **Abertura:** fundo azul com o ícone (tela de abertura do Android).
- **Claro e escuro:** o app segue o modo do celular; a faixa e o logo não mudam.
- **Textos:** pt-BR; "MicroSIP" não aparece em lugar nenhum (conferido nos testes, seção 11.2).
- **Formato:** telas em pé (retrato); o tamanho da letra segue o escolhido no celular.

## 9. Build e publicação

### 9.1 PJSIP para Android

O `build/android` compila o pjproject 2.17 com o NDK (versão fixa) para `arm64-v8a`, `armeabi-v7a` e `x86_64` (emulador), com o áudio Oboe, sem vídeo e sem OpenSSL — o SRTP usa a criptografia própria que vem com o PJSIP —, mais o Opus. As bibliotecas saem alinhadas a 16 KB, como o Android 15 e a Play Store exigem. O resultado fica em cache no GitHub.

### 9.2 Workflow `android` (a cada push e pull request)

1. Testes do núcleo (os mesmos do Windows) e do `SipEngine` no Linux, contra o registrador falso, por UDP e por TCP.
2. Build do APK e testes do Kotlin.
3. Emulador Android no GitHub: instala o APK e roda os testes de fumaça (seção 11.2).
4. Conferências do APK e da marca (seção 11.2).

### 9.3 Workflow `android-release` (tags `android-v*`, ou disparado à mão com a versão)

1. Build do APK assinado, do `versao-android.json` e do código-fonte completo (repositório, pjproject e Opus).
2. `android-vX.Y.Z-rc.N` → pre-release; o pre-release fixo `canal-teste-android` recebe o APK e o `versao-android.json` dessa versão.
3. `android-vX.Y.Z` → release que **não** vira o "latest" do GitHub (o Windows usa o latest para achar o `versao.json` dele); o release fixo `canal-android` recebe o APK e o `versao-android.json`. No fim, o workflow confere que o latest continua sendo uma versão do Windows.

### 9.4 Versões

O Android tem numeração própria, começando em `0.1.0-rc.1`. O número interno do Android (`versionCode`) é calculado da versão — maior × 1.000.000 + menor × 10.000 + correção × 100 + rc, com a versão final valendo 99 no lugar do rc — para que toda versão nova seja maior que a anterior (ex.: `0.1.0-rc.1` → 10001; `0.1.0` → 10099).

### 9.5 Assinatura

Uma chave de assinatura é criada uma vez e guardada cifrada nos segredos do GitHub; a Starsonic guarda uma cópia de segurança fora do GitHub. Sem ela, nenhuma atualização instala por cima — cada pessoa teria que desinstalar e instalar de novo. A mesma chave serve depois para o cadastro no Google e para a Play Store.

## 10. Licença (GPL v3)

O PJSIP é "GPL v2 ou posterior"; o app é distribuído sob a **GNU GPL v3**, como o Windows, e cada APK sai com o código-fonte completo. A tela Sobre mostra a licença, o link do código-fonte e os créditos do PJSIP e do Opus.

Para as próximas etapas: a biblioteca de push do Google (etapa 2) e a App Store (iPhone) têm termos que não combinam bem com a GPL. Antes delas, avaliar a licença comercial do PJSIP.

## 11. Erros e testes

### 11.1 Mensagens

Tela Entrar e registro: as mesmas da tabela 11.1 do Windows, menos a de TLS. Novas no Android:

| Situação | O que o usuário vê |
|----------|--------------------|
| Sem rede | "Sem internet" no status |
| Ligar sem estar conectado | Sem conexão com o servidor. Tente de novo em instantes. |
| Ligar com uma ligação do celular (operadora) em andamento: o Android não deixa | Termine a ligação do celular para ligar pelo ramal. (por 2 s) |
| Ligação recusada: 486 ou 600 | Ocupado |
| Ligação recusada: 404, 484 ou 604 | Número não encontrado |
| Ligação recusada: 408 ou 480 | Não atendeu |
| Ligação recusada: outros códigos | Não foi possível completar a ligação (código <n>). |
| Notificações negadas | Na faixa: "Permita as notificações para receber ligações." |
| Microfone negado | Na faixa: "Permita o microfone para fazer e receber ligações." |
| Tela cheia negada (Android 14 ou mais novo) | Na faixa: "Permita a tela cheia para ver as ligações com o celular bloqueado." |
| Otimização de bateria ativa | Na faixa: "Libere o uso de bateria para receber ligações com o app fechado." |
| Atualização | As mesmas do Windows (seção 11.1 de lá) |

Cada aviso da faixa traz um botão que abre o ajuste certo do Android.

### 11.2 Testes automáticos (a cada build)

- **Unitários do núcleo** (os do Windows) e **do `SipEngine` no Linux**, contra o registrador falso, por UDP e por TCP: registro aceito e recusado (com a mensagem certa), User-Agent, ligação recebida (INVITE do registrador) atendida e desligada, ligação feita recusada com ocupado, conta montada a partir do perfil e codecs na ordem do perfil.
- **Kotlin** (na JVM): estados das telas, cálculo do `versionCode` e decisão de atualizar.
- **Emulador Android no GitHub**, com o registrador falso no runner (`10.0.2.2` no emulador):
  - a tela Entrar recusa servidor e ramal inválidos;
  - senha errada mostra "Ramal ou senha incorretos.";
  - entrar por UDP e por TCP mostra "Conectado · 2001" e a notificação fixa;
  - o registrador recebe o User-Agent `Starsonic Phone Android/<versão>`;
  - com o app fora da tela, uma ligação do registrador mostra a notificação de ligação, é atendida e desligada.
- **APK:** assinado com o certificado esperado, bibliotecas alinhadas a 16 KB, nenhum texto com "MicroSIP", ícones (adaptável, monocromático e da notificação) presentes e o nome "Starsonic" no ícone.

### 11.3 Teste manual (`docs/teste-manual-android.md`, antes de cada versão estável)

Em pelo menos duas marcas (ex.: Samsung e Motorola; Xiaomi, se houver), no Wi-Fi e no 4G:

1. Instalação pelo link e permissões.
2. Entrar por UDP e por TCP; mensagens de erro.
3. Ligar e receber com o app aberto, fora da tela, tirado da lista de apps recentes e com a tela bloqueada; depois de 1 hora parado; depois de reiniciar e desbloquear.
4. Troca Wi-Fi ↔ 4G sem ligação (continua recebendo) e com ligação (anotar o que acontece).
5. Mudo, viva-voz, Bluetooth, espera, transferir e teclado (numa URA).
6. Ligação perdida; ocupado durante outra ligação, do ramal e da operadora.
7. Atualização de uma versão de teste para a seguinte.
8. Bateria: consumo em 24 h de espera, anotado por aparelho.
9. Sobre: versão, links e licença; "Enviar diagnóstico".

## 12. Entradas necessárias da Starsonic

| Item | Para quê |
|------|----------|
| Dois celulares Android de teste, de marcas diferentes (o primeiro APK já pode ser testado com um só) | Teste manual (seção 3 pede duas marcas) |
| Dois ramais de teste: um num servidor por UDP e um num servidor por TCP (ficam fora do repositório) | Teste manual; um liga para o outro |
| Guardar a cópia de segurança da chave de assinatura | Atualizações (9.5) |
| Depois do primeiro APK: número D-U-N-S e conta de desenvolvedor no Google | Cadastro do app e Play Store (decisão 5; seção 13) |

## 13. Riscos

| Risco | Mitigação |
|-------|-----------|
| O Android ou o fabricante parar o app em segundo plano e a ligação não tocar | Serviço em primeiro plano, processador acordado com a conta conectada (7.2, item 6), isenção de bateria, passo a passo por fabricante e o teste de 1 hora parado; o push da etapa 2 resolve de vez |
| Bateria alta com o keep-alive UDP de 15 s e o processador acordado | Medir no teste manual; se ficar alto, avaliar o TCP para quem usa celular ou um keep-alive próprio do celular no perfil (decisão do responsável) |
| Eco ou áudio ruim em alguns aparelhos; Bluetooth | Cancelamento de eco do aparelho e do PJSIP; teste em duas marcas ou mais |
| Ligação cair na troca Wi-Fi ↔ 4G | Aceito na etapa 1; o registro volta sozinho |
| Verificação de desenvolvedores do Google: desde 30/09/2026, no Brasil, só para apps de lojas participantes; o APK baixado direto ainda não é afetado, mas passa a ser em 2027 | Cadastrar a Starsonic e o app antes da regra global (decisão 5); o D-U-N-S pode levar até 28 dias |
| Aviso de "app desconhecido" do Google na instalação | Explicado no roteiro e no material para os clientes |
| Perder a chave de assinatura | Cópia de segurança fora do GitHub (9.5) |
| Um release do Android virar o "latest" do GitHub e o Windows deixar de achar o `versao.json` | Releases do Android sem "latest" e conferência automática no workflow (9.3) |
| A plataforma do fornecedor filtrar o User-Agent do Android | Testado no roteiro; se filtrar, usar o do Windows (`Starsonic Phone/<versão>`) |
| Compilar o PJSIP para o Android (NDK, 16 KB) | Versões fixas e cache; o build do PJSIP é a primeira tarefa do plano |
| O ambiente de desenvolvimento não alcança os servidores do Google | Builds e testes do Android rodam no GitHub, como os do Windows |
| Licença: push do Google e App Store com a GPL | Avaliar a licença comercial do PJSIP antes da etapa 2 |
| Só uma ligação por vez | Aceito na etapa 1 |

## 14. Próximos passos

1. Plano de implementação (skill writing-plans).
2. Implementação e o primeiro APK de teste (`0.1.0-rc.1`), com o roteiro manual.
3. Rodadas de teste em celulares de verdade e ajustes.
4. Especificação da etapa 2 (push).
5. Cadastro no Google e Play Store, depois do primeiro APK.
6. iPhone.
