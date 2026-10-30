# Starsonic Phone para iPhone 1.0 — especificação de design

- **Data:** 29/10/2026
- **Status:** desenho aprovado pelo responsável no chat em 29/10/2026, em cinco partes: o que a primeira versão faz, como o app é montado, a ligação com o app fechado, build e publicação, testes e etapas. A spec escrita foi aprovada pelo responsável em 29/10/2026. A etapa 1 (o motor com o baresip, no Linux) terminou em 30/10/2026, pelo plano `docs/superpowers/plans/2026-10-29-iphone-etapa-1-motor-baresip.md`; o que ela decidiu e o que deixou para as etapas seguintes está na seção 15, no fim. As etapas 2 a 4 ainda não começaram.
- **Versão alvo:** 1.0.0 (TestFlight, depois App Store).
- **Base:**
  - o app do Windows na 0.1.0-rc.4: as telas (`windows/ui`) e o núcleo (`starsonic/desktop`), com as specs da W1, da W3 e da rc.4 e o contrato da ponte em `docs/ponte-windows.md`;
  - o Android 0.2.0-rc.3, que define o que a primeira versão faz (specs da etapa 1, da 0.2 e do visual de 26/10/2026);
  - o contrato do motor de ligações, `starsonic/phone/SipEngine.h`.

> **Decisões do responsável** (29/10/2026):
> 1. A primeira versão do iPhone é completa e já vem com push.
> 2. O push é o da própria plataforma do PABX em Nuvem (o cadastro de push do painel dela), e não um servidor da Starsonic na frente da central.
> 3. Marca própria. No iPhone, o motor de ligações é o baresip (licença BSD) no lugar do PJSIP. A licença comercial do PJSIP, necessária para a App Store, foi cotada em 29/10/2026 e ficou cara. O teste de viabilidade do mesmo dia concluiu que o baresip faz o que o app precisa.
> 4. As telas são as do Windows, dentro do app, com um modo iPhone (caminho A). Descartados: B, telas novas em SwiftUI (tudo escrito de novo, e cada mudança dependendo do Mac), e C, as telas do Android com o Compose Multiplatform (mexeria no app do Android que já funciona).
> 5. O trabalho começa no repositório público de hoje; ele será fechado depois.
> 6. A Starsonic tem um Mac: o build e a assinatura do iPhone saem dele.

## 1. Contexto

No iPhone, o iOS congela o app poucos segundos depois de ele sair da tela, e a conexão com a central cai junto. Só o push de VoIP da Apple (PushKit) acorda o app. A regra da Apple: cada push de VoIP vira, na hora, uma ligação na tela de chamada do próprio iPhone (CallKit). Um app que recebe o push e não mostra a ligação é fechado pelo iOS, e, se isso se repete, deixa de receber os avisos.

A plataforma do PABX em Nuvem já manda push. No painel dela, em Sistema → Push, cada app tem um cadastro com:
- o certificado de push do app;
- o Apple Bundle ID com o final `.voip`;
- a Server Key do Android;
- o "Tempo em Segundos Wait PUSH";
- a opção "Aguardar Ramal Online", que segura a ligação até o aparelho voltar.

O motor de ligações do Windows e do Android é o PJSIP, sob GPL. As regras da App Store não combinam com a GPL, e a licença comercial do PJSIP ficou cara (decisão 3). O baresip e a libre, sob a licença BSD, fazem o que o motor precisa (seção 6.1).

A interface do Windows já tem o tamanho de um celular: os testes dela rodam em 400×720, 340×560 e 300×440. O Android usa o mesmo visual desde 26/10/2026.

## 2. Objetivos

1. **Ramal no bolso, no iPhone:** o iPhone toca com o app fechado e a tela bloqueada.
2. **Marca própria,** com o mesmo visual do PC e do Android.
3. **As mesmas funções do Android de hoje.**
4. **Reaproveitar:** a interface e o núcleo do Windows, o contrato do motor e os testes dele. Só o que é do iPhone fica numa camada própria, em Swift.
5. **Nenhuma licença paga de terceiros.**

## 3. Critérios de sucesso (1.0)

- Uma pessoa sem conhecimento técnico instala o app, digita o servidor, o ramal e a senha (o Protocolo já vem com o padrão do perfil) e completa uma ligação, sem mexer em mais nada técnico.
- Com o app fechado (fora da tela ou tirado da lista de apps abertos) e a tela bloqueada, uma ligação para o ramal toca na tela de chamada do iPhone e pode ser atendida, com áudio nos dois sentidos. Vale:
  - no Wi-Fi e no 4G;
  - depois de 1 hora com o iPhone parado;
  - depois de reiniciar o iPhone, a partir do primeiro desbloqueio;
  - em pelo menos dois iPhones, um com o iOS 16 e um com o iOS mais novo.
- Na ligação funcionam: mudo, teclado (DTMF), viva-voz, fone Bluetooth, espera, segunda ligação, transferência direta e com consulta e conferência a três.
- O Não perturbe e o Atender automático funcionam também com o app fechado.
- O suporte identifica o app e a versão pela tela Sobre e pelo User-Agent `Starsonic Phone iOS/<versão>`.
- A pessoa não consegue mudar nada técnico além do servidor, do protocolo, do ramal e da senha.
- O consumo de bateria num dia em espera é medido no teste manual e aprovado pelo responsável.
- O app passa na revisão da App Store.
- O motor com o baresip passa nos testes do contrato do motor (seção 11.2).

## 4. O que a 1.0 entrega

### 4.1 Telas

As telas são as do Windows, no modo iPhone (seção 8).

| Tela | Conteúdo |
|------|----------|
| Entrar | Como no Windows: servidor com o protocolo, ramal e senha (com o botão de mostrar). Em "Precisa de ajuda? (11) 5060-3000", tocar no número abre o discador do iPhone. Uma conta só, sem a lista de contas. |
| Faixa de cima | Como no Windows: a conta, a bolinha de status e os botões Não perturbe e Atender automático. |
| Teclado | Como no Windows: número, teclado, sugestões dos contatos da agenda, Rediscar e Ligar. Novo no iPhone: o bipe ao digitar, como no Android 0.2.0-rc.3. |
| Recentes | Como no Windows: feitas, recebidas e perdidas. Tocar numa delas liga de volta. |
| Contatos | Os contatos da agenda do iPhone, só para ver e ligar, como no Android: busca por nome ou número; tocar liga, e um contato com mais de um número abre a escolha. Sem o "+" e sem o "⋯". Sem a permissão, o aviso "Permita o acesso aos contatos para ligar pelo nome." e o botão Permitir. |
| Ligação (no app) | A do Windows: uma ou duas ligações, Mudo, Teclado, Áudio (iPhone, Viva-voz ou o fone Bluetooth), Espera, Transferir (direta ou com consulta), Alternar, Juntar e Separar, Desligar. A tela apaga ao encostar no rosto. |
| Tela de chamada do iPhone (CallKit) | Toda ligação recebida aparece nela, com o app aberto ou fechado. Também mostra a ligação em andamento quando o app está fora da tela. Os botões dela (atender, recusar, mudo, teclado, áudio, espera, juntar) fazem as mesmas ações do app. |
| Configurações | Ligações: o tempo do Atender automático, o bipe do fim da ligação e o bipe ao digitar. Sem dispositivos de som, sem Iniciar com o Windows, sem a planilha da empresa e sem a parte de atualização. |
| Menu da conta | Editar conta, Sair e Sobre. |
| Sobre | A versão, o site, o WhatsApp, o telefone de suporte, o Enviar diagnóstico (abre a janela de compartilhar do iPhone) e os avisos de licença (seção 10). |
| Permissões | Depois do primeiro Entrar: o microfone e as notificações, cada um pela janela do próprio iPhone. Os contatos, na primeira abertura da aba Contatos. |

### 4.2 Decisões

- **Uma conta por iPhone.** Entrar com outra conta troca a que está em uso, como no Android.
- **Duas ligações, uma ativa.** A terceira que chega recebe ocupado (486), como no Windows e no Android.
- **Ligação da operadora junto com uma do ramal:** quem decide é o iPhone, como no app Telefone. A segunda aparece com as opções do próprio iPhone (recusar, pôr a primeira em espera e atender, encerrar a primeira e atender).
- **As ligações do app ficam só nos Recentes do app.** Não entram nos Recentes do app Telefone.
- **Toque:** o do iPhone, na tela de chamada. Segue o silencioso e os modos de Foco.
- **Perfil:** o mesmo `branding/perfil.ini` do Windows e do Android: porta, protocolo, proxy, SRTP, keep-alive, STUN, codecs e DTMF. O keep-alive só vale com o app na tela.
- **Codecs:** os do perfil (G.722, PCMA e PCMU). O Opus fica disponível; não há G.729.
- **iPhone com iOS 16 ou mais novo** (do iPhone 8 em diante). Só iPhone e só português.
- **Identificação:** o User-Agent `Starsonic Phone iOS/<versão>` e o Bundle ID `br.com.starsonic.phone`, o mesmo identificador do Android.
- **Versão:** 1.0.0. Cada build de teste ganha um número próprio no TestFlight.
- **Atualização:** pela App Store (e pelo TestFlight nos testes). O app não tem o aviso de atualização do Windows e do Android.

## 5. Fora do escopo da 1.0

- Atalhos, BLF e puxar ligação, área do administrador, lista da empresa e planilhas (importar e exportar), e contatos editáveis no app, como no Android.
- Várias contas, iPad, outros idiomas, vídeo, mensagens, gravação e TLS.
- Ligar pelo app Telefone, pela Siri ou pelos Recentes do iPhone.
- Distribuição fora da App Store e do TestFlight.
- Mudanças no Windows e no Android. As partes compartilhadas mudam só atrás do modo iPhone.

## 6. Arquitetura

### 6.1 As camadas

1. **Interface:** a `windows/ui` (TypeScript e Preact), sem cópia separada, mostrada num WKWebView.
   - O estado traz `plataforma: "ios"`, e a interface entra no modo iPhone (seção 8).
   - Ponte: no começo da página, o hospedeiro injeta um objeto com a mesma forma do `window.chrome.webview` do WebView2 (o `postMessage` e o evento `message`). Assim, o `bridge.ts` não muda.
2. **Núcleo:** o `starsonic/desktop` (o `DesktopApp`), compilado para o iPhone, com um campo novo em `DesktopConfig`: a plataforma (Windows por padrão, ou iPhone). No modo iPhone:
   - **Conta única:** Entrar com outra conta troca a que está em uso.
   - **Desligado (os comandos são recusados):** atalhos, BLF, área do administrador, planilhas, lista da empresa, Iniciar com o Windows, atualização, migração da rc.7, e janela (minimizar, bandeja e redimensionar).
   - **Contatos:** vêm da agenda, entregues pelo hospedeiro e guardados só na memória. Servem para os nomes (na recebida, nos Recentes e na perdida) e para a aba Contatos.
   - **Push:** o hospedeiro entrega o token. O núcleo registra com os dados de push quando há token e o Não perturbe está desligado.
   - **Bipe ao digitar:** a configuração nova, com o som tocado pelo hospedeiro.
3. **Motor:** o `starsonic/phone` ganha uma segunda implementação do `SipEngine`, sobre o baresip e a libre (4.12 ou mais nova, versão fixa no `build/deps.lock`).
   - **O que não muda:** o `CallController` e a fila de eventos. O PJSIP continua no Windows e no Android, e o CMake escolhe um dos dois.
   - **O que a interface do motor ganha:** um método só, `SetPushData`, com os dados de push que vão nos próximos REGISTER (ou nenhum). Ele registra de novo na hora, sem mexer nas ligações em andamento. O `RegistrationPort` do núcleo ganha o mesmo método. No motor do PJSIP, ele não faz nada.
   - **Módulos:**
     - `g711`;
     - `libg722`, com a libg722 da Sippy;
     - `opus`;
     - `srtp`;
     - `audiounit`, que usa o VoiceProcessingIO, o cancelamento de eco do próprio iPhone;
     - `mixminus`, para a conferência.
   - **Fora:** o módulo `g722` (usa a spandsp, sob LGPL).
   - **No baresip:** `WatchBlf` não faz nada e não avisa. `AudioDevices` devolve só o dispositivo padrão, e `SetAudioDevices` e `RefreshAudioDevices` não fazem nada, porque quem escolhe o caminho do som é o iPhone (seção 7.7).
   - **Escrito à parte:** o leitor do XML do BLF fica no motor do PJSIP, onde já está. O baresip não precisa dele nesta versão.
4. **Hospedeiro, em Swift (`ios/`):** o equivalente ao `windows/app` do Windows. Cuida de:
   - o ciclo de vida do app;
   - o WKWebView e a ponte;
   - o CallKit (`CXProvider` e `CXCallController`);
   - o PushKit (`PKPushRegistry`, tipo VoIP);
   - a sessão de áudio (`AVAudioSession`, categoria `playAndRecord`, modo `voiceChat`) e as rotas;
   - a agenda (Contacts);
   - o cifrador do núcleo, com a chave no Keychain;
   - os arquivos na pasta do app;
   - as notificações locais;
   - o sensor de proximidade;
   - o Enviar diagnóstico;
   - os ganchos do `DesktopHooks` que valem no iPhone (`post`, `log`, `openUrl`, `quit`, `sendDiagnostics`).

### 6.2 Repositório

- `ios/`: o projeto do Xcode, o código em Swift e os testes do simulador (XCTest).
- `build/ios/build-deps.sh`: monta a libre, o baresip (com os módulos da seção 6.1), a libg722 e o Opus para o iPhone. Gera um XCFramework com o aparelho (arm64) e o simulador (arm64 e x86_64), nas versões fixas do `build/deps.lock`.
- `starsonic/phone/`: os arquivos novos da implementação com o baresip.
- `windows/ui/`: o modo iPhone. A pasta não muda de nome nesta versão.
- `docs/ponte-windows.md`: uma seção nova para o iPhone, com os campos e os comandos novos.
- `docs/teste-manual-ios.md`: o roteiro do teste manual.
- `.github/workflows/ios.yml`: o build do iPhone no Mac do GitHub, sem assinatura e sem segredos.
- O job do núcleo no Linux passa a compilar e testar também o motor com o baresip.

### 6.3 Perfil e registro

O perfil é o mesmo do Windows e do Android. O tempo do registro com push é o maior que a plataforma aceitar (seção 12), para o registro continuar valendo com o iPhone dormindo.

### 6.4 Dados no iPhone

- **Arquivos do núcleo** (contas, Recentes, configurações): na pasta Application Support do app, com a proteção de arquivo "até o primeiro desbloqueio".
- **Senha:** fica cifrada pelo `Cipher` do núcleo, com a chave guardada no Keychain. A chave abre depois do primeiro desbloqueio, só neste aparelho, e não passa para outro iPhone por backup.
- **Contatos:** lidos da agenda a cada uso e guardados só na memória. O app não guarda cópia nem manda os contatos a lugar nenhum, como no Android.
- **Token de push:** só na memória do app e no registro na plataforma.
- **Diagnóstico:** o log do núcleo, sem senhas e sem contatos (`LogRedaction`), num arquivo da pasta do app. Ele sai do iPhone só quando a pessoa usa o Enviar diagnóstico.

## 7. Fluxos

### 7.1 Entrar, editar e sair

- O Entrar e o Editar são como no Windows: as validações, os 15 s pelo resultado e as mensagens.
- O Sair desregistra e apaga a conta. Os Recentes ficam, como no Android.
- Depois do primeiro Entrar, o app pede as permissões do microfone e das notificações.

### 7.2 Com o app na tela e fora dela

- **Na tela:** o app fica registrado como no Windows, com o keep-alive do perfil.
- **Ao sair da tela:** o app não faz nada; o iOS o congela. O registro continua valendo na plataforma até vencer. Com uma ligação em andamento, o app continua rodando.
- **Ao voltar para a tela:** o app registra de novo, com os dados de push.
- **A rede mudou** (Wi-Fi e 4G) com o app na tela: o app registra de novo.

### 7.3 O registro com push

1. Na abertura, e sempre que o iOS trocar o token, o hospedeiro pede o token de VoIP ao PushKit e o entrega ao núcleo.
2. O núcleo registra com os dados de push quando há token e o Não perturbe está desligado. Se o token ainda não chegou, registra sem eles e registra de novo quando ele chega.
3. O motor põe os dados de push no REGISTER no formato da plataforma (seção 12): parâmetros no Contact (como na RFC 8599) ou cabeçalhos próprios. O motor aceita os dois jeitos, e o formato fica numa função só.
4. Na plataforma entra um cadastro de push novo, pelo "Adicionar push":
   - o certificado de push do app;
   - o Apple Bundle ID `br.com.starsonic.phone.voip`;
   - "Aguardar Ramal Online" ligado;
   - o "Tempo em Segundos Wait PUSH" acertado no teste da etapa 3.

   O cadastro que já existe na plataforma, de outro app, fica como está.

### 7.4 Ligação recebida com o app fechado

1. A plataforma segura a ligação e manda o push.
2. O iOS acorda o app. Na hora, antes de devolver o push ao PushKit, o hospedeiro mostra a ligação na tela de chamada (CallKit), com:
   - o nome do contato da agenda, se o número do push bater com um;
   - senão, o número e o nome que vierem no push;
   - senão, "Starsonic Phone".
3. Ao mesmo tempo, o núcleo e o motor sobem e registram com os dados de push.
4. A plataforma entrega o INVITE, e o hospedeiro junta a ligação do motor com a da tela de chamada. A junção é pelo identificador da ligação que vier no push; sem ele, vale a primeira ligação recebida até o fim do tempo de espera. O tempo de espera do app é o mesmo "Tempo em Segundos Wait PUSH" do cadastro na plataforma.
5. **Atender antes de o INVITE chegar:** o app guarda o pedido e atende quando ele chega. Recusar antes funciona do mesmo jeito: o app recusa com ocupado (486) quando o INVITE chega.
6. **O áudio:** só começa quando o CallKit ativa a sessão de áudio. O motor abre o microfone e o alto-falante nessa hora.
7. **A tela de chamada fecha e a ligação entra nos Recentes como perdida** quando:
   - a ligação não chega até o fim do tempo de espera;
   - chega um CANCEL, porque quem ligou desistiu ou outro aparelho atendeu.

   Nos dois casos, sai o aviso "Ligação perdida de <nome ou número>".
8. **Push com uma ligação já em andamento:** é a segunda ligação, também pela tela de chamada.

### 7.5 Ligação recebida com o app na tela

O INVITE chega direto, porque o app está registrado. O motor responde 180, o hospedeiro mostra a ligação na tela de chamada do iPhone, e a interface mostra a ligação como no Windows.

### 7.6 Ligação feita

- **Ligar** pelo Teclado, pelos Recentes, pelos Contatos ou pelo Rediscar: o hospedeiro pede a ligação ao CallKit. Com o OK do iPhone, o motor liga, e o hospedeiro informa ao iPhone quando a ligação está conectando e quando conecta. Assim, o iPhone sabe que há uma ligação e pausa a música, por exemplo.
- As mensagens de ligação não completada são as do Windows.

### 7.7 Durante a ligação

- **Os botões da interface e os da tela do iPhone fazem as mesmas ações:** mudo, teclado, espera, juntar e separar, desligar. As duas telas mostram sempre o mesmo estado.
- **Áudio:** iPhone (o alto-falante do ouvido), Viva-voz ou o fone Bluetooth. A interface pede a escolha ao hospedeiro, que mostra a do próprio iPhone. Uma troca feita na tela do iPhone, ou ao ligar um fone, aparece na interface.
- **Proximidade:** a tela apaga ao encostar no rosto, com a ligação no alto-falante do ouvido.
- **Duas ligações:** só a ativa usa o microfone e o alto-falante. A outra fica em espera, com o áudio parado.
- **Conferência:** feita no iPhone, pelo `mixminus`. A central não fica sabendo, como no Windows e no Android.
- **Transferências:** a direta (REFER) e a com consulta (REFER com Replaces), como no Windows.

### 7.8 Não perturbe e Atender automático

- **Não perturbe ligado:** o núcleo registra sem os dados de push, e a plataforma não acorda o iPhone. Com o app na tela, as ligações recebem ocupado e entram como perdidas, sem tocar e sem aviso, como no Windows.
- **Não perturbe desligado:** o núcleo registra de novo com os dados de push.
- **Atender automático:** depois do tempo escolhido, o hospedeiro pede o atender ao CallKit, a mesma ação do botão Atender. Vale com o app aberto ou fechado.

### 7.9 Perdidas e notificações

Uma ligação recebida que acaba sem ser atendida gera o aviso "Ligação perdida de <nome ou número>", se a pessoa permitiu as notificações. Tocar no aviso abre os Recentes. A contagem de perdidas segue a do Windows.

## 8. Interface e marca

- **Visual:** o do Windows (manual de identidade): as cores, a fonte, os componentes e os temas claro e escuro, que seguem o tema do iPhone.
- **O modo iPhone na interface:**
  - esconde o que está fora da 1.0 (seção 5), a lista de contas, os dispositivos de som, o Iniciar com o Windows e a atualização;
  - a aba Contatos mostra a agenda, só para ver e ligar, com o aviso de permissão;
  - a tela respeita a área segura do iPhone (o entalhe e a barra de baixo);
  - tocar e segurar faz o que o botão direito faz no PC;
  - os atalhos de teclado do PC e as zonas de redimensionar a janela saem;
  - o botão de áudio da ligação abre a escolha do iPhone.
- **Ícone do app:** o da marca, o mesmo do Android, em todos os tamanhos do iPhone.
- **Tela de abertura:** o logo.
- **Na tela de chamada do iPhone:** o nome "Starsonic Phone" e o ícone da marca em modelo.
- **Textos novos para aprovar:**
  - "Permita o acesso aos contatos para ligar pelo nome." e "Permitir" (os mesmos do Android);
  - "Ligação perdida de <nome ou número>";
  - "Starsonic Phone" na tela de chamada, quando o push não traz número;
  - o pedido do microfone: "O Starsonic Phone usa o microfone nas ligações.";
  - o pedido dos contatos: "Para ligar pelo nome e mostrar quem está ligando.";
  - sem microfone: "Sem acesso ao microfone. Libere em Ajustes → Starsonic Phone.";
  - as opções de áudio: "iPhone", "Viva-voz" e o nome do fone Bluetooth.

## 9. Build e publicação

### 9.1 As bibliotecas

O `build/ios/build-deps.sh` baixa as versões fixas e confere o SHA-256 de cada uma, como o `build/android/build-deps.sh` faz. Depois, monta o XCFramework com a libre, o baresip, a libg722 e o Opus. Ele roda no Mac e no workflow `ios`.

### 9.2 O app

- O projeto do Xcode compila o núcleo (`starsonic/core`, `starsonic/phone` com o baresip e `starsonic/desktop`) e o hospedeiro em Swift.
- Ele roda o `npm run build` da `windows/ui` e põe a interface pronta dentro do app.
- No `Info.plist`:
  - os modos de segundo plano `voip` e `audio`;
  - os textos de permissão (seção 8);
  - `ITSAppUsesNonExemptEncryption` com a resposta da seção 12.
- O direito de push (`aps-environment`) fica no arquivo de direitos do app.

### 9.3 GitHub (workflow `ios`)

A cada push e pull request, num Mac do GitHub (grátis enquanto o repositório for público), o workflow:
- monta as bibliotecas;
- compila o app para o simulador;
- roda os testes do XCTest.

Ele não assina nada e não usa segredos. O workflow `build` de hoje passa a compilar e testar o motor com o baresip no Linux (seção 11.2).

### 9.4 Assinatura e certificado de push

- **Só no Mac da Starsonic,** nunca no GitHub. O Xcode cuida da assinatura sozinho, com a conta da Apple da Starsonic.
- **Na conta da Apple:** o identificador `br.com.starsonic.phone`, com push.
- **O certificado de push de VoIP do app:** cadastrado na plataforma (seção 7.3). Ele tem data de validade, e a Starsonic renova antes de vencer.
- **Nada disso entra no repositório.**

### 9.5 TestFlight e App Store

- **Envio:** do Mac para o App Store Connect.
- **TestFlight:** primeiro para a equipe da Starsonic (até 100 pessoas, sem revisão da Apple). Depois, um grupo de clientes, com a revisão de teste da Apple.
- **App Store:** pública, com o nome Starsonic Phone. Quem não tem ramal não consegue entrar.
- **Na revisão,** a Apple recebe:
  - um ramal de teste só para ela (servidor, ramal e senha);
  - uma nota explicando que o app é o ramal de uma central da Starsonic.
- **Na App Store Connect:**
  - a política de privacidade, publicada no site da Starsonic;
  - a declaração dos dados que o app usa: o ramal, o número de quem liga, o código de push e o diagnóstico, quando a pessoa manda.

## 10. Licenças

- **Peças de terceiros no app do iPhone:**
  - baresip e libre (BSD de 3 cláusulas);
  - libg722 (o código da CMU, de uso livre; a parte de Steve Underwood, em domínio público; e a da Sippy, BSD);
  - Opus (BSD);
  - Plus Jakarta Sans (OFL);
  - Preact (MIT);
  - nlohmann/json (MIT);
  - miniz (MIT), se o núcleo a levar junto.
- **Os avisos de cada uma** ficam na tela Sobre e no pacote do app.
- **Nenhuma peça de terceiros sob GPL ou LGPL entra no app do iPhone:** nem o PJSIP, nem o bcg729, nem o módulo `g722` do baresip (que usa a spandsp).
- **O código da Starsonic:** é da Starsonic. A publicação do app do iPhone na App Store não depende de licença de terceiros.

## 11. Erros e testes

### 11.1 Mensagens

As do Windows (Entrar, registro, ligação não completada), mais as da seção 8.

### 11.2 Testes automáticos (a cada build)

- **Motor com o baresip** (Linux, com o registrador falso `tests/smoke/fake_registrar.py`; o executável `phone_tests_baresip`, no job `core-tests` do workflow `build`):
  - passa nos testes do contrato, os mesmos do motor do PJSIP, um arquivo por assunto em `tests/phone/`: `test_engine_setup.cpp`, `test_engine_register.cpp`, `test_engine_network.cpp`, `test_engine_calls.cpp`, `test_engine_hold.cpp` (com o 486 na terceira ligação), `test_engine_transfer.cpp` e `test_engine_conference.cpp`, e nos que não usam o motor, `test_push_data.cpp` e `test_account_config.cpp`;
  - os que ficam só para o PJSIP: a escolha de dispositivos de som (`test_engine_audio.cpp`), o BLF (`test_engine_blf.cpp`) e os do próprio PJSIP (`test_engine_pjsip.cpp`);
  - os só do motor com o baresip, no `test_engine_baresip.cpp`:
    - os dados de push no REGISTER, nos dois formatos, e o registro sem eles;
    - o `SetPushData` registrando de novo sem derrubar uma ligação em andamento;
    - a troca de rede: os endereços locais lidos de novo e o REGISTER a caminho no TCP;
    - o áudio só na ativa, e nas duas na conferência (seção 7.7), pelo `SipEngineTestAccess`;
    - os módulos contra o `build/deps.lock`, o keep-alive, o motor destruído com um REGISTER a caminho e criado de novo no mesmo processo;
    - o que este motor faz de diferente do PJSIP (seção 15) e o `OnLog` que lança.
- **Núcleo no modo iPhone** (doctest):
  - a conta única;
  - os comandos do PC recusados;
  - os nomes vindos da agenda;
  - o registro com e sem os dados de push (com e sem token, Não perturbe ligado e desligado);
  - a configuração do bipe ao digitar.

  O modo Windows continua passando em todos os testes de hoje.
- **Interface no modo iPhone** (Playwright):
  - as fotos das telas nos tamanhos do iPhone (375×667, 390×844 e 430×932), nos temas claro e escuro;
  - a conferência de acessibilidade (axe);
  - o que fica escondido;
  - a aba Contatos com e sem a permissão.
- **Hospedeiro** (XCTest, no simulador):
  - a ponte;
  - a ligação entre o CallKit e o motor, com um motor falso;
  - os casos do push: atender antes do INVITE, recusar antes do INVITE, INVITE que não chega, CANCEL e push com uma ligação em andamento;
  - o Não perturbe tirando os dados de push.

### 11.3 Teste manual (`docs/teste-manual-ios.md`)

Num iPhone de verdade, antes de cada versão:
- **Os casos da seção 3:**
  - receber com o app aberto, em segundo plano, tirado da lista e com a tela bloqueada;
  - no Wi-Fi e no 4G;
  - depois de 1 hora parado;
  - depois de reiniciar.
- **Atender e recusar antes de a ligação chegar,** quem ligou desistir e outro aparelho atender.
- **Na ligação:**
  - o áudio nos dois sentidos, o mudo e o teclado (a URA entende cada tecla uma vez);
  - o viva-voz, o fone Bluetooth e a proximidade;
  - a espera, a segunda ligação (só a ativa com áudio) e a ligação da operadora junto;
  - as duas transferências e a conferência.
- **Com o app fechado:** o Não perturbe e o Atender automático.
- **A bateria** num dia em espera.
- **Os aparelhos:** pelo menos dois iPhones, um com o iOS 16 e um com o iOS mais novo.

## 12. Entradas necessárias da Starsonic

1. **A conta de desenvolvedor da Apple, em nome da Starsonic,** com o número D-U-N-S, e o nome de quem fica responsável por ela.
2. **O manual do push da plataforma:**
   - o formato dos dados de push no REGISTER;
   - o que vem no push (o número, o nome e o identificador da ligação);
   - o máximo do "Wait PUSH" e o que o "Aguardar Ramal Online" faz;
   - o tempo máximo de registro, e o que acontece com o registro quando a conexão cai;
   - se a plataforma manda o push para o ambiente de teste da Apple ou só para o de produção.
3. **O Mac com o Xcode atualizado.** De preferência, ligado ao Claude pelo app do Claude no Mac, para os builds rodarem lá direto.
4. **Os aparelhos e o ramal de teste:** dois iPhones de teste (um com iOS 16 e um com o iOS mais novo) e um ramal de teste no servidor que já está na versão nova da plataforma.
5. **O ramal da revisão da Apple:** um ramal de teste só para ela.
6. **A política de privacidade,** publicada no site da Starsonic.
7. **As imagens da App Store:** as fotos de tela e o texto da página do app. Eu preparo um rascunho para aprovar.
8. **A resposta sobre criptografia** para a Apple: o app usa só a criptografia padrão (SRTP e a autenticação SIP). Eu preparo a resposta para aprovar.
9. **A aprovação dos textos novos** da seção 8.

## 13. Riscos

| Risco | O que fazer |
|------|-------------|
| Áudio no iPhone com duas ligações: o baresip abre o áudio por ligação, e o iPhone tem um microfone só. | O motor para o áudio da ligação que vai para a espera e o retoma na volta. Teste no aparelho na etapa 2. |
| O áudio começar antes de o CallKit liberar a sessão (som mudo ou cortado). | O motor só abre o áudio depois do `didActivate`. Teste no aparelho nas etapas 2 e 3. |
| O formato de push da plataforma não servir para um app de fora, ou o registro vencer com o iPhone dormindo e o push parar. | Combinar com o fornecedor da plataforma. Em último caso, a Starsonic põe um servidor SIP próprio, com push, na frente da central. |
| Dois motores (PJSIP e baresip) com comportamentos diferentes. | A mesma bateria de testes do contrato para os dois. |
| A revisão da Apple recusar (app que parece site, ou VoIP fora das regras do CallKit). | A integração nativa (CallKit, PushKit, áudio, agenda), o ramal de teste e a nota para a revisão. |
| O certificado de push vencer. | Um lembrete antes da data de validade (seção 9.4). |
| O repositório público mostrar o trabalho do iPhone. | Decisão do responsável (decisão 5). Antes de fechar o repositório, as atualizações do Windows e do Android precisam passar a vir de outro lugar. |

## 14. Etapas e próximos passos

Cada etapa termina com algo que dá para testar.

1. **O motor com o baresip, no Linux:** passa nos testes da seção 11.2. Não precisa do Mac nem da Apple. Se der muito errado, a licença comercial do PJSIP volta a ser a saída. Feita em 30/10/2026 (seção 15).
2. **O app no iPhone, com o app aberto:** entra, liga, recebe e faz todas as funções da seção 4. Instalado pelo Xcode num iPhone de teste, pode começar antes da conta paga da Apple.
3. **O push:** a ligação com o app fechado (seção 7.4). Precisa da conta da Apple, do certificado e do manual da plataforma. O teste vai pelo TestFlight.
4. **A publicação:** a revisão da Apple e a App Store.

O plano de implementação da etapa 1 vem primeiro. As etapas 2 a 4 ganham plano próprio quando as entradas da seção 12 chegarem.

## 15. Como ficou (etapa 1)

A etapa 1 terminou em 30/10/2026, pelo plano `docs/superpowers/plans/2026-10-29-iphone-etapa-1-motor-baresip.md`. O motor com o baresip (`starsonic/phone/baresip/`) passa no Linux, contra o registrador falso, nos testes do contrato do motor e nos só dele (seção 11.2), também com o ASan, o UBSan e o TSan. Aqui ficam as decisões tomadas durante a construção, com o que cada uma custa se estiver errada, o que ficou de fora e o que as etapas 2 e 3 precisam conferir. Onde o contrato (`starsonic/phone/SipEngine.h`) não diz, a referência foi o motor do PJSIP.

### 15.1 O registro

- **O cliente de REGISTER é do próprio motor,** sobre a pilha SIP da libre (`sip_drequestf`), e não o `sipreg` da libre. O `sipreg` não deixa saber se há um REGISTER a caminho, não para as novas tentativas sem tirar o registro do servidor e manda a saída sozinho quando é destruído; o contrato pede o contrário nos três casos. O registro do baresip fica desligado (`regint=0`), e a conta do baresip serve só às ligações.
- **O REGISTER:**
  - o `Expires` vai no cabeçalho, porque o registrador falso e muitas centrais só leem ele;
  - o Contact é escrito na hora do envio, com o endereço local do socket que manda o pedido;
  - um 401 ou 407 leva o Digest, e o pedido sai de novo uma vez; um 423 também sai de novo uma vez, com o `Min-Expires` da resposta, que passa a ser o tempo pedido da conta;
  - o tempo concedido é o `expires` do nosso Contact no 2xx; sem ele, o `Expires` do 2xx; sem os dois, o pedido.
- **A renovação é a do PJSIP, linha a linha,** e não o "concedido menos 5 s" do resumo do plano: com 6 a 9 s concedidos, ela sai aos 5 s. Custo se errado: nenhum.
- **As novas tentativas são as do PJSIP:** depois de 408, 480, 500, 502, 503, 504, 6xx ou um erro de transporte, a primeira em 0 a 10 s e as seguintes a cada 290 a 310 s, até um 2xx; depois de outro código (403, 404...), nenhuma.
- **O pedido a caminho:** um REGISTER pedido com outro a caminho (o `Reregister`, o `SetPushData`, a rede que volta, a troca de rede) sai logo depois da resposta dele, e essa resposta nunca vira evento. O PJSIP aceita o 2xx do pedido a caminho como a renovação. A regra única é mais simples, e nenhum teste do contrato distingue as duas. Custo se errado: um REGISTER a mais nesses casos.
- **O `SetPushData`, com conta e rede, registra de novo na hora também com a conta sem registro** (depois de uma falha, ou depois do pedido a caminho). Custo se errado: um REGISTER a mais numa conta que já falhou.
- **A saída de uma conta sem registro** (a última resposta foi uma falha, ou nenhuma chegou) não manda o REGISTER com Expires 0, como no PJSIP, que nesse caso recusa a saída. O `OnRegistration(200, false, id)` chega do mesmo jeito, uma vez. Custo se errado: a central não recebe uma saída de um registro que ela não tinha.
- **O `SetAccount` e o `RemoveAccount` desligam as ligações com o `Disconnected` de sempre,** como o contrato diz. Só o destrutor as encerra sem eventos, porque a fila dos eventos já parou. Aqui cada ligação sai das vagas dentro do `Run`, então não há a espera de até 2 s do PJSIP. Custo se errado: nenhum, o contrato manda.
- **Com a conta saindo, a ligação que chega recebe 480, sem evento,** como no PJSIP.

### 15.2 A troca de rede

- **O `HandleIpChange` lê de novo os endereços locais antes de refazer os transportes.** O baresip só lê os endereços das interfaces ao subir, e o `uag_reset_transp` abre os transportes SIP nos endereços dessa lista. O plano mandava só o `uag_reset_transp(false, false)`: numa troca do Wi-Fi para o 4G, os transportes voltariam no endereço da rede de antes, e a conta ficaria sem registro até o app reiniciar. A revisão final achou a falta, e o motor segue agora a receita do módulo `netroam` do próprio baresip, num `Run` só:
  1. esvazia a lista;
  2. põe nela os endereços de agora das interfaces, pelo filtro do baresip, e o 127.0.0.1 dos testes, com o mesmo código da subida;
  3. lê de novo os servidores de DNS do sistema (`net_dns_refresh`);
  4. refaz os transportes e registra, como antes.

  No Linux, o teste simula a lista velha com a lista vazia (`SipEngineTestAccess::FlushLocalAddresses`): depois do `HandleIpChange`, a conta registra de novo, e uma ligação recebida e uma feita funcionam, em UDP e em TCP. A troca de verdade fica para o aparelho (15.10). Custo se errado: umas 15 linhas que o Linux só exercita por simulação.
- **O hospedeiro chama o `HandleIpChange` a cada troca de caminho** (do Wi-Fi para o 4G e de volta, ou uma rede nova), e não só o `SetNetworkAvailable(true)`. Só o `HandleIpChange` lê os endereços de novo, refaz os transportes e tira do caminho o REGISTER que ia pela conexão TCP de antes. O `Reregister`, o `SetPushData` e a rede que volta, com um pedido a caminho numa conexão TCP morta, esperam o Timer F da libre (32 s).
- **No TCP, o REGISTER a caminho é largado na troca de rede,** e o novo sai na hora. O `uag_reset_transp` fecha a conexão sem avisar a transação do pedido, que só acabaria no Timer F, com o REGISTER da troca esperando atrás dela pela regra do pedido a caminho. As contas da central usam TCP, e o iPhone troca de rede o tempo todo: 32 s sem registro é ligação perdida. A resposta do pedido largado não vira evento. No UDP, as repetições do pedido já saem pelo socket novo, e a regra do pedido a caminho segue. Custo se errado: umas linhas e um teste.
- **A ligação em andamento não manda re-INVITE na troca de rede** (`uag_reset_transp(…, reinvite=false)`): o outro lado continua mandando o áudio para o endereço de antes. O PJSIP, no padrão dele, manda o re-INVITE com o endereço novo. A etapa 2 decide no aparelho.

### 15.3 A conexão TCP

- **Uma conexão que o servidor fecha só é notada na renovação seguinte.** A libre só avisa o fim de uma conexão pelo keep-alive da RFC 5626 (`sip_keepalive_start`), que pede a resposta do servidor. O PJSIP percebe na hora.
- **O keep-alive do motor (`\r\n\r\n`) numa conexão morta abre outra, sem registro e sem aviso,** porque a libre conecta de novo para mandar. O registro só volta a valer na conexão nova na renovação seguinte.
- **A libre fecha a conexão TCP que fica 900 s sem nada chegar.** Isso pesa na etapa 3: o tempo do registro com push vai ao máximo da plataforma (seção 6.3), e talvez a plataforma não responda ao keep-alive.

### 15.4 As ligações

- **Os módulos no Linux** são os da lista `baresip.modules` do `build/deps.lock`: `g711`, `libg722`, `opus`, `srtp`, `stun` e `mixminus`. O `stun` entrou para o STUN da mídia do perfil; o `audiounit` (6.1) é da etapa 2, no iPhone. O `phone_tests_baresip` confere a lista do motor contra a do `deps.lock`, nome a nome e na ordem, em todo build: o script do baresip só roda no CI quando falta o cache. Custo se errado: um teste e uma função a mais.
- **O `AudioDevices` devolve a lista vazia** (com o `nullAudio` dos testes, só o dispositivo nulo), e não "só o dispositivo padrão" (6.1): o padrão do sistema é o -1, que o contrato não põe na lista e o `SetAudioDevices` aceita.
- **O 127.0.0.1 entra na lista dos endereços locais do baresip,** que o filtro dele deixa de fora: sem ele, nenhuma ligação com o registrador falso, no 127.0.0.1, acha o endereço da mídia. No iPhone ele só abre um transporte SIP a mais no 127.0.0.1, que nenhum destino de verdade escolhe. Ele é IPv4, e numa rede só IPv6 não atrapalha.
- **A ligação que chega toca até quem liga desistir** (`call_local_timeout 0`), como no PJSIP: o padrão do baresip a recusa com 486 depois de 120 s.
- **O limite de ligações do próprio baresip é 8** (`call_max_calls`). Uma ligação desligada que ainda espera a resposta do outro lado (o CANCEL de uma feita que não teve 18x, o BYE de uma atendida que não teve o ACK) conta nesse limite. Com o 4 de antes, uma ligação que chegasse nessa hora levava o 486 do próprio baresip, sem passar pelo motor e sem o `OnRejectedBusy`. A regra das duas ligações continua do motor, com o 486 e o `OnRejectedBusy` da terceira. Custo se errado: nenhum; o motor nunca passa de duas.
- **O `Hangup` que precisa da resposta do outro lado espera por ela.** O de uma feita antes de qualquer 18x manda o CANCEL quando o 18x chega: antes dele, a libre larga o INVITE sem cancelar, e um 200 que viesse depois ficaria sem ACK e sem BYE. O de uma recebida atendida antes do ACK manda o BYE depois do ACK, para ele poder ser repetido. O `Disconnected` sai na hora. O BYE de quem ligou, antes do ACK dele, dá `Disconnected/200`, como o BYE de qualquer lado. Custo se errado: umas linhas a mais.
- **Uma ligação que acaba sem resposta final** dá 408 com o tempo esgotado e 503 nos outros erros, os códigos do PJSIP.

### 15.5 Duas ligações e um microfone só

- **Um microfone só:** o baresip abre o áudio por ligação, e o motor para o áudio de toda ligação que não é a ativa (`audio_stop`) logo depois de cada SDP aplicado, num temporizador de 0 ms, porque o baresip abre de novo a fonte de som de uma ligação em espera a cada SDP dela. A fonte da em espera ainda abre por um instante a cada renegociação, e nenhum RTP sai durante a espera. A ideia do revisor, uma fonte de silêncio só para a em espera (`audio_set_source`), fica para a etapa 2, com o `audiounit` de verdade. Custo se errado: retrabalho na etapa 2, que é onde o áudio de verdade entra.
- **A ativa é uma marca do motor,** como no PJSIP, e não "a confirmada fora da espera": uma ligação confirmada quando a outra já é a ativa fica sem o áudio até um `Activate`.
- **O `Activate` é o `Focus` do PJSIP:** a escolhida vira a ativa e a outra perde o áudio na hora; a espera da outra é de boa vontade; o resultado é só o da retomada da escolhida, e, nos dois motores, uma retomada que não sai dá false, com a escolhida ainda em espera. Antes, com a espera da outra presa numa renegociação, a ligação que o app já mostrava em espera seguia com o microfone. Custo se errado: umas linhas e dois testes.
- **Um pedido que manda re-INVITE espera até ~2 s a renegociação anterior da ligação** (`MakeCall`, `Answer`, `Activate`, `SetHold`, `Join` e `Split`), conferindo a cada 20 ms, porque a recusa de um re-INVITE não vira evento do baresip. Passado o prazo, o `MakeCall` e o `Answer` seguem assim mesmo, e a outra fica fora da espera e sem o áudio daqui, como no PJSIP: atender é o principal do app. Custo se errado: umas linhas.
- **Cada pedido começa limpo,** e a espera da outra que não sai é tentada e escrita no log uma vez por pedido. O `Activate` só volta sem fazer nada quando a escolhida já é a ativa com o áudio aberto; sem o áudio, ele o devolve sem re-INVITE.

### 15.6 Teclas, mudo e transferências

- **Uma transferência no ar por vez, nas duas ligações juntas:** o `Transfer` e o `TransferAttended` são recusados com outra ainda sem resultado, também da outra ligação. No PJSIP, só o `CallController` impede o segundo pedido.
- **A transferência que acaba com erro avisa o `OnTransfer`:** 408 com o tempo esgotado e 503 nos outros erros, como no PJSIP. O baresip só escreve a linha de informação `call: subscription closed: <erro>`, sem evento, e o motor a lê no gancho das linhas do baresip, que monta pelo menos as de informação em qualquer nível do log. A linha não diz de qual ligação ela é: daí a regra de uma por vez. Um teste pina o texto. Custo se errado: código preso ao texto de uma linha do baresip (o do commit do `deps.lock`) e uma segunda transferência simultânea recusada.
- **O 202 sem NOTIFY nenhum deixa a transferência pendente até a ligação acabar,** como no PJSIP: nenhum dos dois tem prazo para o NOTIFY. Um prazo do motor erraria com o colega ainda tocando, porque nem o 202 nem os NOTIFY 1xx chegam ao motor. Custo se errado: com uma central que não manda o NOTIFY, a transferência fica pendente até a ligação acabar e segura as da outra ligação.
- **O REFER que chega é recusado com 501,** pela chave `call_transfer=no` da conta: com ela, a libre responde 501; sem ela, o baresip aceitaria com 202 antes de qualquer evento. O PJSIP recusa com 603. As duas recusam só a transação, e a ligação segue igual. Custo se errado: a central vê 501 em vez de 603.
- **O INVITE com Replaces é recusado com 603** antes de o baresip aceitar a ligação (o aceite dele fecharia a ligação trocada), sem evento e sem mexer na ligação de agora, como no PJSIP.
- **Diferenças do PJSIP que ficam,** e que o app não usa: todo INVITE com Replaces leva 603 (o PJSIP dá 481 quando nenhum diálogo casa); as teclas `a` a `d` minúsculas são recusadas (o PJSIP as aceita, e o app só manda `0-9*#`); o `Allow` sai sem o REFER, coerente com a recusa. Custo se errado: nenhum para quem usa.
- **Os testes do REFER e do Replaces recebidos ficam no `test_engine_baresip.cpp`,** com comandos novos no registrador falso; o motor do PJSIP não ganhou teste do 603. Custo se errado: o PJSIP segue sem esse teste, como antes.
- **O mudo** é a marca `audio_mute` de cada ligação, de agora e das próximas; na conferência, como no PJSIP, os dois do outro lado continuam se ouvindo.

### 15.7 A conferência

- **A mesa é o `mixminus`,** ligado pela marca `audio_set_conference` de cada ligação. O motor não usa o comando `conference` do módulo, que retomaria todas as ligações por conta própria.
- **Na conferência as duas ligações ficam com o áudio aberto:** duas fontes e duas saídas, que a etapa 2 confere no aparelho. Se o RTP de uma para no meio, o `mixminus` atrasa o som que sai para a outra em até ~19 ms por quadro. Os testes conferem só as marcas e o estado, porque o áudio nulo não manda amostras.
- **O `SetHold` de uma delas** a tira do som e da mistura, e a conferência segue com a outra, como no PJSIP; só o `Activate` (ou o `SetHold(false)`) a desfaz.
- **Duas diferenças do PJSIP no `Join`:** com as duas em espera, o motor confere as duas ofertas antes de mudar algo; e quando uma ligação acaba durante a espera do `Join`, a outra fica como estava (a em espera segue em espera, até um `Activate`). Quem usa ouve o mesmo nos dois motores: silêncio até um `Activate`. Custo se errado: uma diferença do PJSIP que nenhum teste do contrato confere.

### 15.8 Mídia, o log e os dados de push

- **O STUN aqui é só da mídia** (`medianat=stun`, com o primeiro servidor do perfil como o `stunserver` da conta), nunca o Contact do SIP.
- **O SRTP opcional do perfil é o `srtp` do baresip:** a resposta leva o `a=crypto` num `RTP/AVP` também quando a oferta não trouxe nenhum (o "melhor esforço" do módulo). A etapa 2 confere como a central lida com isso.
- **O registrador falso nunca pede autenticação num INVITE,** nos dois motores: o 401 e o 407 das ligações ficam para o teste no aparelho.
- **Nenhuma exceção volta para a libre e o baresip, que são C,** e um `OnLog` que lança (um `bad_alloc` no app) só perde a linha: os ganchos do log, do trace do SIP e dos eventos têm o `try/catch`, e o log do próprio motor também. Antes da revisão final, o do motor não tinha, e um `OnLog` que lançasse no resultado de uma transferência deixava uma vaga com a ligação que o baresip solta logo depois do aviso. Custo se errado: nenhum, só a linha perdida.
- **O laço que para sozinho:** depois que o `re_main` volta sem o pedido do destrutor, o `BaresipLoop::Run` não roda mais nada (escreve no log e devolve false), e o motor não solta mais nada da libre. Custo se errado: umas linhas a mais.
- **Os dados de push** (o `PushDataProblem`, o mesmo nos dois motores) também recusam os nomes de cabeçalho de uma letra só, que são a forma compacta de outro cabeçalho (o `m` seria um segundo Contact), o `Proxy-Authorization`, que a libre escreve depois de um 407, e os nomes com `` ` `` ou `%`, que o nome de um parâmetro do Contact não aceita soltos. Os nomes vêm do código do app, e não da rede, e o Windows e o Android não chamam o `SetPushData`. Custo se errado: um nome de push desses recusado.

### 15.9 Falhas conhecidas

- **Uma falha assíncrona de um re-INVITE** (um erro de transporte no TCP, ou o DNS que falha depois) deixa a libre com a oferta no ar para sempre, porque só o tempo esgotado a desfaz: aquela ligação não vai mais para a espera nem volta dela (cada pedido espera os ~2 s e é recusado), e o `CallController` mostra o estado errado.
- **Uma feita que só teve o 100 Trying espera o 18x para mandar o CANCEL** do `Hangup`, porque o baresip não avisa o 100. Com uma central, o 18x vem logo depois.
- **O pedido largado na troca de rede** (15.2) deixa uns 2,4 KB na lista de pedidos da libre até o fim do SIP. Um largado ainda no DNS (só com o servidor por nome) segue e manda depois um REGISTER sem Contact, cuja resposta é ignorada.
- **O `SendDtmf` devolve true quando as teclas do RFC 2833 não saem agora:** numa ligação em espera, ou sem o áudio daqui, elas esperam na fila e saem na retomada (o app só manda teclas para a ativa); sem o `telephone-event` na resposta do outro lado, elas se perdem, e o PJSIP devolve erro.
- **O NOTIFY final com `Subscription-State: terminated` e um sipfrag 1xx** termina a assinatura do REFER sem erro e sem linha do baresip: nenhum `OnTransfer`. Raro.
- **Uma assinatura velha da outra ligação** que falhe mais tarde conta contra a transferência no ar, porque a linha do baresip não diz a ligação. Pede um outro lado que mantenha a assinatura depois de uma falha final.
- **O motor destruído logo depois do fim de uma ligação cujo REFER ainda espera o NOTIFY final** deixa uns 48 KB da pilha SIP sem soltar, uma vez.
- **Se o pedido de fim do laço falhar no destrutor** (`re_thread_async_main`, só sem memória), a espera pela thread do laço não acaba.

### 15.10 O que a etapa 2 confere no aparelho

O Linux não troca de rede, não tem rede só IPv6 e não tem o áudio do iPhone. Por isso, no iPhone:

1. **A troca de rede de verdade,** do Wi-Fi para o 4G e de volta, em UDP e em TCP, com e sem ligação: a conta volta a registrar em poucos segundos, e o diagnóstico mostra o REGISTER saindo do endereço novo. O hospedeiro chama o `HandleIpChange` a cada troca (15.2). É também onde se decide o re-INVITE da ligação em andamento.
2. **Uma rede só IPv6** (NAT64 e DNS64), que a revisão da Apple exige.
3. **A central pelo nome** depois de uma troca, com os servidores de DNS da rede nova.
4. **O áudio com o `audiounit`:** só a ativa com o microfone, a fonte da em espera que abre por um instante a cada renegociação (e a ideia da fonte de silêncio), as duas fontes e as duas saídas da conferência, e o áudio só depois do `didActivate` do CallKit.
5. **A central de verdade:** o `a=crypto` nas respostas `RTP/AVP` com o SRTP opcional e o 401 e o 407 nos INVITE.
6. **A espera e a retomada durante uma troca de rede no TCP** (a falha assíncrona do re-INVITE, 15.9) e o CANCEL depois de um 100 Trying sem 18x.

### 15.11 Para depois

- **Antes da etapa 3,** o registrador falso ganha os comandos do 423 (`Min-Expires`) e do 407, com testes dos dois caminhos do motor, que hoje foram conferidos só à mão. O 423 pesa na etapa 3, quando o tempo do registro com push vai ao máximo da plataforma. O proxy de saída e o formato do STUN na conta (`;medianat=stun;stunserver=stun:<servidor>`) também foram conferidos só à mão e ganham testes junto.
- **Da camada do app:** o `CallController` ignora o retorno do `Activate`, do `SetHold` e do `Join`, nos dois motores. Uma espera que não sai aparece como em espera, com o microfone aberto para o outro lado, e uma retomada que não sai aparece como ativa. Quando uma ligação acaba durante a espera do `Join`, o app mostra a que fica em andamento sem chamar o `Activate`.

### 15.12 O processo

- O trabalho foi direto no `main`, sem ramo, que é a regra do responsável para este repositório. Custo se errado: um revert no `main`.
- O CI de cada tarefa foi conferido pelo controlador em paralelo com a revisão, e a tarefa só fechou com ele verde. Custo se errado: nenhum.
- O `Co-Authored-By` de cada commit nomeia o modelo que o escreveu. Custo se errado: só a linha de atribuição.
- Um caso de `test_engine_network.cpp` ficou fora do `phone_tests_baresip` da Task 3 até a Task 4, porque precisava das ligações. Custo se errado: um caso fora por uma tarefa.
- As quatro células do `docs/teste-manual-android.md` que apontavam para testes que mudaram de arquivo foram corrigidas na Task 1. Custo se errado: nenhum.
- A Task 7 juntou às dela os minors da Task 6 e dois do `Activate` da Task 5, e a rodada de correção dela juntou mais quatro achados pequenos: nenhum teste que falha ao acaso, nenhuma exceção que volta para o C e nenhuma ligação que fica muda ficaram para depois. Custo se errado: um diff maior para a revisão.
- A revisão final pediu as correções que esta seção já descreve (a troca de rede, o log do motor, o limite de ligações do baresip, os nomes dos dados de push e os comentários do `SipEngine.h`) antes de dar a etapa por feita, e elas entraram numa onda só. Custo se errado: uma onda um pouco maior.
- O TSan roda com uma libre montada sobre as pthreads: com as threads do C11 da glibc, o TSan do GCC 13 não enxerga a trava da libre e acusa corridas que não existem.
