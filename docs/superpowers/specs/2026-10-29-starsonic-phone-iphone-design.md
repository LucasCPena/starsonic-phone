# Starsonic Phone para iPhone 1.0 — especificação de design

- **Data:** 29/10/2026
- **Status:** desenho aprovado pelo responsável no chat em 29/10/2026, em cinco partes: o que a primeira versão faz, como o app é montado, a ligação com o app fechado, build e publicação, testes e etapas. Esta spec aguarda a revisão escrita.
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

- **Motor com o baresip** (Linux, com o registrador falso `tests/smoke/fake_registrar.py`):
  - passa nos testes do contrato que já existem (`tests/phone/test_engine_register.cpp` e `test_engine_calls.cpp`, os mesmos do motor do PJSIP);
  - os que ficam só para o PJSIP: a escolha de dispositivos de som (`test_engine_audio.cpp`) e o BLF (`test_engine_blf.cpp`);
  - testes novos:
    - os dados de push no REGISTER, nos dois formatos;
    - o `SetPushData` registrando de novo sem derrubar uma ligação em andamento;
    - o registro sem os dados de push;
    - o 486 na terceira ligação.
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

1. **O motor com o baresip, no Linux:** passa nos testes da seção 11.2. Não precisa do Mac nem da Apple. Se der muito errado, a licença comercial do PJSIP volta a ser a saída.
2. **O app no iPhone, com o app aberto:** entra, liga, recebe e faz todas as funções da seção 4. Instalado pelo Xcode num iPhone de teste, pode começar antes da conta paga da Apple.
3. **O push:** a ligação com o app fechado (seção 7.4). Precisa da conta da Apple, do certificado e do manual da plataforma. O teste vai pelo TestFlight.
4. **A publicação:** a revisão da Apple e a App Store.

O plano de implementação da etapa 1 vem primeiro. As etapas 2 a 4 ganham plano próprio quando as entradas da seção 12 chegarem.
