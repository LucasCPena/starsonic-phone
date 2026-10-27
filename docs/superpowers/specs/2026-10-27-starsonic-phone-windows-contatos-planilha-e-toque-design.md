# Starsonic Phone para Windows: contatos por planilha (importar, exportar e a lista da empresa) e o toque do MicroSIP (especificação de design)

- **Data:** 27/10/2026
- **Status:** aprovada pelo responsável no chat em 27/10/2026 ("Pode seguir"), a construir.
- **Versão alvo:** 0.1.0-rc.4 (canal de teste).
- **Base:** a 0.1.0-rc.3 do Windows (a W1, `2026-10-21-starsonic-phone-windows-w1-design.md`, com a W3, `2026-10-22-starsonic-phone-windows-w3-atalhos-blf-adm-design.md`). O contrato da ponte é o `docs/ponte-windows.md`.

## 1. Objetivo

Três pedidos do responsável, todos no app do Windows:

1. Importar e exportar a lista de contatos, como no MicroSIP.
2. Uma lista de contatos da empresa, lida de uma planilha no Google Planilhas, no OneDrive/SharePoint ou numa pasta da rede. Quando alguém muda a planilha, todos os computadores recebem a lista nova.
3. A ligação recebida toca um som igual ao "chamando" das centrais do Brasil (425 Hz, 1 s ligado a cada 5 s; spec da W1, seção 9), e parece que a pessoa está ligando. Ela passa a tocar o toque do MicroSIP.

## 2. Decisões do responsável (27/10/2026)

- **Toque:** o responsável ouviu o toque de agora e três opções geradas (telefone de escritório, campainha clássica e toque suave) e não quis nenhuma delas. Ele escolheu o toque do MicroSIP, o `ringtone.wav` do pacote oficial, que está em `microsip-dist/`.
- **Onde fica a planilha:** pode estar nos três lugares, Google Planilhas, OneDrive/SharePoint e pasta da rede.
- **Quem põe o link:** qualquer pessoa, em Configurações. Não é coisa da área do administrador.
- **Plataforma:** só o Windows. O Android continua com os contatos do próprio celular.
- **Versão:** uma versão só, a 0.1.0-rc.4, com o toque e os contatos. O toque não sai antes.
- **Plano aprovado como está:**
  - o botão "⋯" com Importar e Exportar;
  - a etiqueta "Empresa" e os filtros;
  - a parte "Contatos" das Configurações;
  - a leitura ao abrir e a cada 15 minutos;
  - a última lista lida guardada, para não sumir nada;
  - a ordem dos nomes nas ligações.
- **Publicação:** o responsável publica a versão de teste pelo GitHub (Actions → release → Run workflow), porque a publicação daqui foi bloqueada pelo sistema de permissões na rc.3 do Android.

## 3. O toque da ligação recebida

- **O `completo`** (a recebida sem outra ligação) toca o toque do MicroSIP:
  - Em loop, até o `parar`. O arquivo já traz o "trrim-trrim" e o silêncio depois, uma volta a cada 3 s.
  - Sai no dispositivo de Toque das Configurações, como hoje (`setSinkId`), e troca de saída do mesmo jeito.
- **A `espera`** (o bipe da segunda ligação) **e o `fim`** (o bipe do fim da ligação) ficam como estão: 425 Hz, no alto-falante da ligação.
- **O arquivo:** vai dentro da interface, como `windows/ui/assets/toque.wav`. É uma cópia byte a byte de `microsip-dist/ringtone.wav`: 3 s, 8 kHz, 16 bits, mono, 48 KB.
  - A interface lê o arquivo e o decodifica uma vez (`decodeAudioData`).
  - Ele toca num `AudioBufferSourceNode` com `loop`, no mesmo AudioContext de hoje (o do `setSinkId`).
- **Sem o arquivo:** sem WebAudio, ou se o arquivo não carregar ou não decodificar, a recebida toca o toque de agora (425 Hz). Ela nunca fica muda.
- **Licença:** o MicroSIP é GPL v2 ou posterior, e o app é GPL v3, então o som pode vir junto. O Sobre ganha o crédito (seção 9).

## 4. Importar e exportar

### 4.1 Onde ficam

- **No alto da tela Contatos,** ao lado do "+", um botão "⋯" (nome para o leitor de tela: "Mais opções"). Ele abre um menu com:
  - "Importar planilha…";
  - "Exportar planilha…".

### 4.2 Importar

- **A janela:** a de abrir arquivo do próprio Windows, com os tipos "Planilhas (*.xlsx, *.csv)" e "Todos os arquivos".
- **A leitura:** a da seção 6, a mesma da lista da empresa. Ela lê o CSV que o MicroSIP exporta.
- **Para onde vão:** os contatos entram nos meus contatos (`contatos.json`), cada um com um id novo, numa gravação só.
- **Ficam de fora:**
  - a linha sem nome ou sem número;
  - o contato igual a um que já existe (o mesmo nome, sem acento e sem caixa, e o mesmo número pelo `NormalizeDialString`);
  - o repetido dentro da própria planilha.
- **O aviso (toast):**
  - "120 contatos importados.";
  - "120 contatos importados (3 já existiam).";
  - "Nenhum contato novo na planilha.";
  - os erros da seção 6.4.
- **Cancelar a janela:** nada acontece, sem aviso.

### 4.3 Exportar

- **A janela:** a de salvar arquivo do Windows, com "Planilha do Excel (*.xlsx)" (a padrão) e "CSV (*.csv)".
  - O nome sugerido é "Contatos Starsonic.xlsx".
  - O tipo escolhido decide o formato.
- **O que vai:**
  - só os meus contatos (os da empresa já estão na planilha deles);
  - em ordem alfabética;
  - com o cabeçalho Nome, Número e Observação.
- **XLSX:**
  - uma aba, "Contatos";
  - todas as células como texto, para o Excel não mostrar o número em notação científica nem tirar o zero da frente.
- **CSV:**
  - UTF-8 com BOM, separado por ponto e vírgula, para o Excel em português abrir em colunas;
  - entre aspas quando o texto tem ponto e vírgula, aspas ou quebra de linha.
- **O aviso:**
  - "120 contatos exportados.";
  - "Não consegui salvar o arquivo." (o disco falhou, sem permissão ou o arquivo está aberto em outro programa).

## 5. A lista da empresa

### 5.1 Nas Configurações

Uma parte nova, "Contatos", depois de "Ligações":

- **"Planilha da empresa":** um campo de texto com o link ou o caminho, e o botão "Salvar".
  - Ajuda embaixo: "Cole o link do Google Planilhas ou do OneDrive/SharePoint, compartilhado para qualquer pessoa com o link, ou o caminho do arquivo na rede."
  - Salvar com o campo vazio tira a lista da empresa.
- **A situação,** numa linha embaixo:
  - "Lendo a planilha…";
  - "Atualizada às 14:32 · 230 contatos";
  - ou o erro da seção 5.4, com a hora da última leitura boa quando há uma.
- **O botão "Atualizar agora".**

### 5.2 De onde o app lê

| O que a pessoa cola | O que o app lê |
|---|---|
| Google Planilhas: `https://docs.google.com/spreadsheets/d/<id>/edit…`, também com `#gid=<aba>` ou `?gid=<aba>` | `https://docs.google.com/spreadsheets/d/<id>/export?format=csv`, com `&gid=<aba>` quando o link tem a aba (sem ela, o Google manda a primeira) |
| Google publicado na web: `https://docs.google.com/spreadsheets/d/e/<id>/pubhtml…` ou `…/pub?…` | `https://docs.google.com/spreadsheets/d/e/<id>/pub?output=csv`, com o `gid` do link quando há |
| OneDrive pessoal: `https://1drv.ms/…` ou `https://onedrive.live.com/…` | `https://api.onedrive.com/v1.0/shares/u!<o link em base64url, sem "=">/root/content` |
| OneDrive ou SharePoint do trabalho: `https://<empresa>.sharepoint.com/…` ou `https://<empresa>-my.sharepoint.com/…` | o mesmo link com `download=1` |
| Dropbox: `https://www.dropbox.com/…` | o mesmo link com `dl=1` |
| Outro `https://` | o link como está |
| Caminho: `\\servidor\pasta\arquivo`, `C:\…`, `Z:\…` ou `file:///…` | o arquivo, com o acesso do usuário do Windows |

- **Os redirecionamentos** seguem a regra do WinHTTP, que nunca desce de HTTPS para HTTP. O limite é de 10 MB.
- **`http://` sem o "s" não vale.**
- **O formato** sai do conteúdo, não da extensão: começa com `PK` → .xlsx; senão, CSV.
- **Uma página HTML** (o Google ou a Microsoft pedindo login) é o erro de link fechado da seção 5.4.

### 5.3 Quando o app lê

- **Quando:**
  - ao abrir o app (depois da abertura das lojas);
  - a cada 15 minutos com o app aberto (também na bandeja);
  - no "Salvar" do link;
  - no "Atualizar agora".
- **Uma leitura por vez:** um pedido que chega durante uma leitura espera ela acabar e roda uma vez só depois.
- **Uma leitura boa:**
  - troca a lista inteira;
  - grava a lista e a hora em `contatos-empresa.json`, na pasta de dados (`{"versao":1,"atualizada":<ms>,"contatos":[{"nome","numero","observacao"}]}`, gravação atômica);
  - na próxima abertura do app, essa lista aparece na hora, antes da primeira leitura.
- **Uma leitura que falha:**
  - a lista de antes continua, na memória e no arquivo;
  - a situação mostra o erro e a hora da última leitura boa.
- **Uma planilha lida sem nenhum contato** (só o cabeçalho) é uma lista vazia válida e troca a lista. A planilha sem as colunas Nome e Número é erro e não troca nada.
- **O link apagado:** a lista e o `contatos-empresa.json` saem.
- **O link trocado:** a lista de antes fica até a primeira leitura boa do link novo.

### 5.4 Os erros (os textos da situação)

| Situação | Texto |
|---|---|
| Resposta 401, 403 ou 404, ou uma página HTML no lugar da planilha | "Não consegui abrir o link. Confira se a planilha está compartilhada para qualquer pessoa com o link." |
| Sem rede, servidor fora do ar ou tempo esgotado | "Sem conexão com a planilha. Fica a última lista." |
| O arquivo não existe ou o computador não tem acesso | "Não achei o arquivo. Confira o caminho e se este computador tem acesso à pasta." |
| O texto não é um link https nem um caminho | "Use um link https:// ou o caminho de um arquivo." |
| A planilha não tem as colunas, ou o arquivo não é planilha | "Não consegui ler a planilha. Ela precisa das colunas Nome e Número." |
| Mais de 10 MB ou de 10.000 contatos | "A planilha é grande demais (o máximo é 10.000 contatos)." |

### 5.5 Na tela Contatos

- **Uma lista só,** em ordem alfabética, com os meus contatos e os da empresa.
- **Os da empresa:**
  - têm a etiqueta "Empresa";
  - não têm o menu (Editar e Remover), porque mudam só na planilha;
  - o toque liga, pela regra dos contatos, como os meus.
- **Os filtros:** com a lista da empresa configurada, "Todos", "Meus" e "Empresa" aparecem em cima da lista, como os do Recentes. "Todos" é o padrão.
- **A busca** procura nos dois.
- **Um contato da empresa com o mesmo nome e número de um meu** aparece uma vez só, o meu.

### 5.6 Os nomes nas ligações

- **De onde vem o nome,** na recebida, no aviso do canto, nos Recentes e no toast da perdida:
  1. o meu contato com o número;
  2. se não houver, o da lista da empresa com o número;
  3. se não houver, o nome que a central mandou.
- **Comparação dos números:** como hoje, pelo `NormalizeDialString`.
- **O "Salvar contato" dos Recentes** continua aparecendo para os números que não são meus contatos, mesmo os da empresa.

## 6. A leitura das planilhas

A mesma para importar e para a lista da empresa, em C++ portátil (`starsonic/desktop`), testada no Linux.

### 6.1 Os formatos

- **XLSX:**
  - **A aba lida:** a primeira, na ordem do `workbook.xml`.
  - **As células:**
    - texto compartilhado (`sharedStrings`, também o texto com formatação, em pedaços);
    - texto na própria célula (`inlineStr`);
    - número.
  - **Os números:** um número inteiro sai sem notação científica e sem ".0". Por exemplo, `1.1999998888E10` vira "11999998888".
  - **As células vazias** ficam vazias, e as colunas seguem a referência da célula (`r="C5"`).
  - **A descompactação** é a do miniz (MIT), em `starsonic/third_party/miniz`.
- **CSV:**
  - **O texto:** UTF-8, com ou sem BOM. O que não é UTF-8 válido é lido como Windows-1252.
  - **O separador:** vírgula, ponto e vírgula ou tab, o que mais aparece na primeira linha fora das aspas.
  - **As aspas:** duplas, com `""` dentro, e com quebras de linha dentro delas.

### 6.2 As colunas

- **O cabeçalho** é a primeira linha não vazia. Os nomes das colunas são comparados sem acento, sem caixa e sem espaços nas pontas:
  - **nome:** "nome", "name", "contato";
  - **número:** "numero", "number", "telefone", "fone", "ramal", "celular", "phone", "phone number", "primary phone", "mobile", "mobile number";
  - **observação:** "observacao", "obs", "comment", "notes", "setor", "departamento", "empresa".
- **O CSV do MicroSIP:** quando não há "Name", o nome é "First Name" e "Last Name" juntos.
- **Várias colunas de número:** vale a primeira, da esquerda para a direita, que tem valor na linha.
- **Sem cabeçalho reconhecido:**
  - Se a coluna B da primeira linha tem um número (2 dígitos ou mais depois do `NormalizeDialString`, e nenhuma letra), a planilha é lida sem cabeçalho, desde a primeira linha: A é o nome, B o número e C a observação.
  - Senão, é o erro "Não consegui ler a planilha. Ela precisa das colunas Nome e Número."
- **Em cada linha:**
  - O nome, o número e a observação, sem espaços nas pontas.
  - O número fica como foi escrito na planilha, como no "Novo contato". O `NormalizeDialString` só serve para comparar e para valer: um número que fica vazio depois dele não conta.

### 6.3 Os limites

- **O arquivo:** até 10 MB.
- **Os contatos:** até 10.000 por planilha.
- **No XLSX,** cada parte descompactada tem até 50 MB. Isso protege de um arquivo feito para encher a memória.
- **Além disso:** o erro "grande demais".

### 6.4 Os erros do importar (toast)

| Situação | Texto |
|---|---|
| A planilha não tem as colunas, ou o arquivo não é planilha | "Não consegui ler a planilha. Ela precisa das colunas Nome e Número." |
| Grande demais | "A planilha é grande demais (o máximo é 10.000 contatos)." |
| O arquivo não abre (em uso, sem acesso) | "Não consegui abrir o arquivo." |

## 7. Ponte (acréscimos à versão 1, em `docs/ponte-windows.md`)

### 7.1 Estado

- **`contatos`:** continua só com os meus contatos, sem mudança.
- **`empresa`** (novo): `{link, situacao: {tipo: "nenhuma"|"lendo"|"ok"|"erro", texto, atualizadaEm}, quantos, vez}`.
  - `link`: o texto salvo.
  - `texto`: a linha da seção 5.1, pronta.
  - `atualizadaEm`: em ms desde 1970, 0 sem leitura boa.
  - `vez`: sobe a cada lista nova.

### 7.2 Mensagem nova

- **`{"v":1,"type":"contatosEmpresa","vez":N,"contatos":[{"nome","numero","observacao"}]}`:**
  - **Por que fora do `state`:** a lista pode ter 10.000 contatos, e o `state` vai inteiro a cada mudança.
  - **Quando:** no `ready` e a cada lista nova. A lista vazia vem quando o link sai.

### 7.3 Comandos

- **`importContacts`:** o C++ abre a janela de abrir arquivo; o resultado vem num toast.
- **`exportContacts`:** a janela de salvar.
- **`setCompanyList {link}`:** vazio tira a lista.
- **`refreshCompanyList`.**

### 7.4 Ganchos novos do executável (`DesktopHooks`)

- **Escolher o arquivo de importar, e o de exportar com o formato.** Eles abrem a janela na thread da janela e devolvem o caminho por um callback, que põe o resto na fila de comandos.
- **Ler a fonte da lista da empresa,** numa thread do executável, fora da thread de comandos:
  - um link `https://` pelo WinHTTP (`HttpsGet`, 10 MB);
  - um caminho pelo disco.
  - Devolve os bytes ou o tipo do erro, por callback.

## 8. Testes

### 8.1 Portáteis (C++, doctest)

- **A leitura:**
  - CSV: os três separadores, as aspas, o BOM, o Windows-1252, as linhas em branco, sem cabeçalho e o do MicroSIP;
  - XLSX montado pelo próprio teste com o miniz: texto compartilhado, texto na célula, texto em pedaços, números grandes, células vazias e a primeira aba;
  - os limites e os erros.
- **A escrita:** o XLSX e o CSV do exportar, lidos de volta pela leitura (ida e volta), com acento, ponto e vírgula, aspas e zero na frente.
- **Os links:** cada linha da tabela da seção 5.2, e o `http://` recusado.
- **O DesktopApp:**
  - o importar (os repetidos e os avisos) e o exportar;
  - o `setCompanyList`, a leitura a cada 15 min (com o agendador falso) e uma leitura por vez;
  - a falha que mantém a lista e o `contatos-empresa.json` na abertura;
  - a ordem dos nomes (meu, empresa, central);
  - o `contatosEmpresa` no `ready`.
- **A ponte:** os quatro comandos e o `empresa` no estado.

### 8.2 Interface (Playwright)

- **Contatos:**
  - o "⋯" com os dois itens;
  - a etiqueta "Empresa" e os filtros;
  - a busca nos dois;
  - o da empresa sem menu, e o repetido uma vez só.
- **Configurações → Contatos:** as quatro situações e o Salvar.
- **O toque:** o `completo` em loop no dispositivo de Toque, e os 425 Hz quando o arquivo não carrega.
- **O resto:** o axe, os dois temas, as três larguras e as capturas.

### 8.3 Windows (CI) e manual

- **Windows (CI, fumaça):** a lista da empresa de um arquivo num caminho local aparece nos Contatos, e o nome dela aparece numa recebida do registrador falso.
- **Manual (`docs/teste-manual.md`):**
  - a lista da empresa: Google Planilhas, OneDrive pessoal, SharePoint do trabalho e uma pasta da rede;
  - importar o CSV do MicroSIP e uma planilha do Excel;
  - exportar e abrir no Excel;
  - o toque no dispositivo de Toque.

## 9. Textos novos (para aprovar)

- **Contatos:**
  - o botão e o menu: "Mais opções", "Importar planilha…", "Exportar planilha…";
  - a lista: "Empresa", "Todos", "Meus";
  - os avisos: "<n> contatos importados.", "<n> contatos importados (<m> já existiam).", "Nenhum contato novo na planilha.", "<n> contatos exportados.", "Não consegui salvar o arquivo.", "Não consegui abrir o arquivo.";
  - as janelas do Windows: "Planilhas (*.xlsx, *.csv)", "Todos os arquivos", "Planilha do Excel (*.xlsx)", "CSV (*.csv)", "Contatos Starsonic.xlsx".
- **Configurações:**
  - a parte e o campo: "Contatos", "Planilha da empresa", "Salvar", "Atualizar agora";
  - a ajuda: "Cole o link do Google Planilhas ou do OneDrive/SharePoint, compartilhado para qualquer pessoa com o link, ou o caminho do arquivo na rede.";
  - a situação: "Lendo a planilha…", "Atualizada às <hora> · <n> contatos" e os erros da seção 5.4.
- **Sobre:** "Licença GPL v3 · usa o PJSIP (GPL v2 ou posterior), o Opus (BSD) e o toque do MicroSIP (GPL v2 ou posterior)".

## 10. Riscos

| Risco | Tratamento |
|---|---|
| O SharePoint da empresa não deixar o link "qualquer pessoa com o link" | O erro diz o que fazer, e a pasta da rede fica como alternativa. Entrar com a conta da Microsoft fica para depois (seção 11). |
| O Google ou a Microsoft mudarem os endereços de baixar | O erro aparece e a lista de antes fica. O "publicado na web" do Google e o caminho de rede ficam como alternativas. A conversão é uma função pura, simples de ajustar. |
| Alguém esvaziar a planilha por engano | Todos ficam sem a lista, que é o pedido ("atualiza para todos"). A planilha sem as colunas não apaga nada. |
| Uma planilha grande deixar o app pesado | Os limites de 10 MB e de 10.000 contatos. A lista vai à interface numa mensagem só dela, só quando muda. |
| O link do Google ou do OneDrive ser uma chave de acesso | Ele fica só no `config.json` do usuário. O diagnóstico mostra só o tipo da fonte (Google, OneDrive, SharePoint, Dropbox, link, caminho), nunca o link. |
| Muitos contatos importados de uma vez | Eles vão no `state` como os de hoje. O limite de 10.000 por planilha vale também no importar. |
| A licença do toque | O MicroSIP é GPL v2 ou posterior, com o crédito no Sobre. O miniz é MIT, com a licença junto das outras. |

## 11. Fora do escopo

- Entrar com a conta do Google ou da Microsoft, para planilhas que não estão abertas para qualquer pessoa com o link.
- Mudar a lista da empresa pelo app.
- Mais de uma lista da empresa.
- A lista da empresa no Android.
- Escolher outro arquivo de toque.
- O XML do MicroSIP, no importar e no exportar.
- Um intervalo de leitura diferente dos 15 minutos.
