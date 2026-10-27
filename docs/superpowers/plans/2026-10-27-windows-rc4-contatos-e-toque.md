# Windows 0.1.0-rc.4: contatos por planilha e o toque do MicroSIP — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a ligação recebida do Windows toca o toque do MicroSIP, e a tela Contatos importa e exporta planilhas e mostra a lista da empresa, lida de um link ou de um caminho na rede.

**Architecture:** o toque muda só na interface (`windows/ui/src/ring.ts`, com o arquivo em `windows/ui/assets`). A leitura e a escrita das planilhas, a conversão dos links, a loja da lista da empresa e as regras (quando ler, os erros, os nomes) ficam em C++ portátil (`starsonic/desktop`), testado no Linux. O executável (`windows/app/src`) só abre as janelas de arquivo e busca os bytes (WinHTTP ou disco), por ganchos novos do `DesktopHooks`. A interface desenha a lista e as Configurações a partir do estado e da mensagem nova `contatosEmpresa`.

**Tech Stack:** C++17 (doctest, nlohmann/json, miniz 3.0.2), Win32/COM (IFileOpenDialog, WinHTTP), TypeScript + Preact (esbuild), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-27-starsonic-phone-windows-contatos-planilha-e-toque-design.md`

## Global Constraints

- Todo texto que a pessoa vê é o da spec, letra por letra (seções 4, 5, 6.4 e 9). Em C++, os literais são ASCII: um caractere fora do ASCII vai como escape UTF-8 num literal estreito (`"N\xc3\xa3o consegui..."`), como no `DesktopApp.cpp` (o `build/check_source_text.py` confere no CI).
- `starsonic/desktop` é C++ portátil: nada de cabeçalho do Windows. O que é do Windows fica em `windows/app/src`.
- Comentários em português, no estilo dos arquivos vizinhos. O repositório é público: nenhum segredo, link real de cliente ou senha em arquivo, teste ou log.
- Os limites: 10 MB por planilha (10485760 bytes), 10.000 contatos por planilha, 50 MB por parte descompactada do .xlsx (52428800 bytes); a leitura da lista da empresa a cada 15 min (900000 ms).
- O diagnóstico nunca leva o link da lista da empresa nem os nomes e números dos contatos: só o tipo da fonte (`CompanySourceName`) e as contagens.
- Mudança na ponte muda o `docs/ponte-windows.md` no mesmo commit (o cabeçalho do `Protocol.h` pede isso).
- O miniz 3.0.2 entra como veio (`miniz.c`, `miniz.h` e `LICENSE`), do zip oficial `https://github.com/richgel999/miniz/releases/download/3.0.2/miniz-3.0.2.zip` (SHA-256 `ada38db0b703a56d3dd6d57bf84a9c5d664921d870d8fea4db153979fb5332c5`; `miniz.c` `0fcdc9888cb3a29ca8f176bac087e5fe6c7258a6ab06b1c271c1e109a11d3740`, `miniz.h` `295d1a0041aea09609598c0f1f35c1977ca05ad662acbadcfdaac44c140af37b`). Uma cópia já baixada está em `/tmp/claude-0/-home-claude/62d54bdc-24b1-5e22-a5c0-39fd7d73e742/scratchpad/miniz-dl/miniz-3.0.2.zip`.
- Nada muda em `microsip/`, `microsip-dist/`, `android/` e `starsonic/phone` (o toque só é copiado de `microsip-dist/ringtone.wav`).
- Os commits vão para o `main` (como nas rcs anteriores), sem forçar push e sem ramo remoto novo, com as duas linhas do fim: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_014A5kJDot8KVFeE91pBUqgW`.
- Os testes que rodam aqui: os do app de PC (`cmake -S tests/desktop -B <build> -G Ninja && cmake --build <build> -j 8 && <build>/desktop_tests`) e os da interface (`cd windows/ui && npm run build && npx playwright test`). O build do Windows e a fumaça rodam só no CI (workflow `build`, job "Windows (Win32, Release)"): o passo que mexe no executável termina com o push e o CI verde.

## Review Focus

1. **O Excel em português de verdade.** O .xlsx com estilos, texto com formatação em pedaços, fórmula (`<f>` com o valor guardado em `<v>`), número com zero na frente guardado como texto, e a primeira aba escondida; e o CSV do "Salvar como CSV", em Windows-1252, separado por ponto e vírgula, com CRLF e colunas vazias no fim. Cada um vira contatos certos. Os testes ficam na Task 2.
2. **O Google mandando uma página de login com status 200**, quando a planilha não está aberta para qualquer pessoa. Isso é o erro de link fechado, e não "sem as colunas". O teste fica na Task 4 (`FromHttp`).
3. **Os links do OneDrive e do SharePoint.** Eles chegam com `?e=…` ou já com `download=1`, com `#` no fim, ou como "Copiar como caminho" do Explorer (entre aspas). A conversão não duplica o parâmetro e tira as aspas. Os testes ficam na Task 4.
4. **A pasta da rede fora do ar na abertura** (a VPN ainda não conectou). A lista guardada aparece, o erro também, e a leitura de 15 min depois recupera sozinha. O teste fica na Task 5.
5. **A planilha aberta no Excel enquanto o app lê.** O Excel trava a gravação, não a leitura. O app abre o arquivo com `FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE`. Fica na Task 7, com uma linha do roteiro manual (Task 8).

---

### Task 1: O toque do MicroSIP na recebida

**Files:**
- Create: `windows/ui/assets/toque.wav` (cópia byte a byte de `microsip-dist/ringtone.wav`: 48028 bytes, SHA-256 `a2efa78855ed15dd4e882e4adde00764d3ec59936ecad9fb953f0963a83ab740`)
- Modify: `windows/ui/build.mjs` (copia `toque.wav` para `dist/assets/`)
- Modify: `windows/ui/src/ring.ts`
- Modify: `windows/ui/src/screens/Sobre.tsx` (o crédito)
- Test: `windows/ui/tests/ring.spec.ts`, `windows/ui/tests/helpers.ts` (o AudioContext falso da página), e o teste do Sobre que confere o texto (procure "Licença GPL v3" em `windows/ui/tests`)

**Interfaces:**
- Produces: `RingOptions.loadToque?: () => Promise<ArrayBuffer | null>` (os bytes do toque; o padrão é `fetch('assets/toque.wav')` → `arrayBuffer()`, e `null` em qualquer falha). `RingAudioContext` ganha `createBufferSource?(): AudioBufferSourceNode` e `decodeAudioData?(data: ArrayBuffer): Promise<AudioBuffer>`.

- [ ] **Step 1: Escreva os testes que falham** em `ring.spec.ts`. O contexto gravado ganha `createBufferSource` (grava `buffer`, `loop`, `started`, `stopped`) e `decodeAudioData` (devolve um buffer falso e anota o `byteLength` recebido).
  - `the full ring plays the MicroSIP ringtone in a loop on the Toque device`: com `loadToque` devolvendo `new ArrayBuffer(48028)`, o `play('completo', { toque: 'saida-toque-1', altoFalante: '' })` espera e confere:
    - `sinks` igual a `['saida-toque-1']`;
    - uma fonte de buffer com `loop === true` e `started === true`;
    - nenhum oscilador ligado.
    - Depois do `stop()`: a fonte com `stopped === true` e o contexto fechado.
  - `without the ringtone file the full ring falls back to 425 Hz`: com `loadToque` devolvendo `null`, o oscilador toca a 425 Hz, com a cadência `CADENCES.completo`. O mesmo vale quando o `decodeAudioData` rejeita.
  - `the ringtone file is loaded once`: dois `completo` seguidos (com `parar` no meio) chamam o `loadToque` uma vez só.
  - `espera and fim never load the ringtone`: o `play('espera', …)` e o `play('fim', …)` não chamam o `loadToque` e usam o oscilador.
  - **Na página** (o `FakeAudioContext` de `helpers.ts` ganha os dois métodos): `the page loops assets/toque.wav on the full ring`. Depois de um `ring completo`, o falso anotou um `decodeAudioData` de 48028 bytes e uma fonte com `loop`.
  - **No Node:** `dist/assets/toque.wav is the MicroSIP ringtone`. O SHA-256 de `dist/assets/toque.wav` é igual ao de `../../microsip-dist/ringtone.wav`.
  - **Sobre:** o texto passa a ser "Licença GPL v3 · usa o PJSIP (GPL v2 ou posterior), o Opus (BSD) e o toque do MicroSIP (GPL v2 ou posterior)".
- [ ] **Step 2: Rode e veja falhar.** Rode `cd windows/ui && npm run build && npx playwright test tests/ring.spec.ts` e o teste do Sobre. O esperado é FAIL: o `loadToque` não existe, o arquivo não está no `dist` e o texto do Sobre é o antigo.
- [ ] **Step 3: Implemente.**
  - No `play` do `completo`:
    - depois do `setSinkId` e da conferência da vez, pegue o buffer;
    - o `loadToque` roda uma vez por ringer, guardando a promessa;
    - o `decodeAudioData` roda uma vez, guardando o `AudioBuffer`, que serve para os contextos seguintes;
    - confira a vez de novo.
  - **Com o buffer:** `createBufferSource`, com `buffer` e `loop = true`, ligado a um ganho de valor 1 (o toque toca como foi gravado), e `start()`.
  - **Sem o buffer:** o oscilador de hoje.
  - **O `current`** guarda o nó que toca (`AudioScheduledSourceNode`). O `stop` e o `setOutputs` seguem iguais para os dois casos.
  - **`espera` e `fim`** ficam como estão.
  - **O comentário do topo** do `ring.ts` descreve o toque novo, a falha que volta aos 425 Hz e a spec da rc.4.
  - **`build.mjs`:** `toque.wav` entra na lista dos arquivos copiados de `assets/`.
  - **`Sobre.tsx`:** o texto do Step 1.
- [ ] **Step 4: Rode e veja passar.** Rode `npm run typecheck && npm run build && npx playwright test`: a suíte inteira da interface passa.
- [ ] **Step 5: Commit.** Mensagem: `feat(windows): a recebida toca o toque do MicroSIP, no lugar dos 425 Hz do "chamando"`. Faça o push e confira o job "Interface (Playwright, Linux)" do workflow `build` verde.

### Task 2: A leitura das planilhas (CSV e .xlsx)

**Files:**
- Create: `starsonic/third_party/miniz/miniz.c`, `miniz.h`, `LICENSE` (do zip do miniz 3.0.2, veja as Global Constraints)
- Modify: `tests/desktop/CMakeLists.txt` e `windows/app/CMakeLists.txt`
  - `project(... C CXX ...)`, porque o projeto do app já tem `RC`;
  - uma biblioteca estática `miniz` só com o `miniz.c`, sem as opções de aviso do projeto;
  - `target_link_libraries` dos alvos com ela.
- Create: `starsonic/desktop/Planilha.h`, `starsonic/desktop/Planilha.cpp`
- Test: `tests/desktop/test_planilha.cpp`

**Interfaces:**
- Produces (em `Planilha.h`, namespace `starsonic`):
  ```cpp
  struct SheetContact {
      std::wstring name;
      std::string number;   // como foi escrito na planilha (UTF-8)
      std::wstring note;
  };
  enum class SheetError { None, Unreadable, TooLarge };
  struct SheetRead {
      SheetError error = SheetError::None;
      std::vector<SheetContact> contacts;
  };
  constexpr size_t kSheetMaxBytes = 10485760;
  constexpr size_t kSheetMaxContacts = 10000;
  constexpr size_t kSheetMaxPartBytes = 52428800;
  SheetRead ReadContactSheet(const std::string& bytes);
  ```
- As regras são as da spec, seção 6:
  - os bytes que começam com `PK` são lidos como .xlsx, o resto como CSV;
  - o cabeçalho e as colunas, da seção 6.2;
  - linha sem nome ou sem número (o `NormalizeDialString` vazio) fica de fora, sem erro;
  - mais de `kSheetMaxContacts` contatos, ou bytes acima de `kSheetMaxBytes`, dá `TooLarge`;
  - sem as colunas, ou um arquivo que não é planilha, dá `Unreadable`.

- [ ] **Step 1: Escreva os testes que falham** (`test_planilha.cpp`). Os .xlsx são montados no teste com o escritor de zip do miniz (`mz_zip_writer_*`, na memória), com as partes mínimas: `[Content_Types].xml`, `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, as abas e o `sharedStrings` quando o caso pede. Os casos, com os valores exatos:
  - **CSV com vírgula:** `"Nome,N\xc3\xbamero,Observa\xc3\xa7\xc3\xa3o\r\nAna Souza,2002,cliente\r\n"` dá um contato, {L"Ana Souza", "2002", L"cliente"}.
  - **CSV com ponto e vírgula, em Windows-1252:** `"Nome;Telefone\r\nJo\xe3o;(11) 5060-3000\r\n"` dá {L"João", "(11) 5060-3000", L""}.
  - **CSV UTF-8 com BOM e tab:** `"\xef\xbb\xbfnome\ttelefone\nCarlos\t11988887777\n"` dá {L"Carlos", "11988887777"}.
  - **Aspas:** `"Nome;Numero;Obs\n\"Silva; Ana\";2003;\"diz \"\"oi\"\"\nsegunda linha\"\n"` dá {L"Silva; Ana", "2003", L"diz \"oi\"\nsegunda linha"}.
  - **Linhas em branco e colunas vazias no fim:** `"Nome;Numero;;\r\n\r\nAna;2002;;\r\n;;;\r\n"` dá um contato.
  - **O CSV do MicroSIP:**
    - o cabeçalho é o de `microsip/Service/ContactsService.cpp:91-107` (Name, Number, First Name, Last Name, Phone Number, Mobile Number, …, Comment, …);
    - uma linha com `Name` vazio, `First Name` "Ana", `Last Name` "Souza", `Number` vazio, `Mobile Number` "11977776666" e `Comment` "obs" dá {L"Ana Souza", "11977776666", L"obs"}.
  - **Sem cabeçalho:** `"Ana;2002\nBruno;2003\n"` dá dois contatos. `"Ana;Bruno\nCarla;Davi\n"` dá `Unreadable`.
  - **Linha sem nome ou sem número fica de fora:** `"Nome;Numero\n;2002\nAna;\nBia;---\nCaio;2004\n"` dá só Caio.
  - **.xlsx com texto compartilhado, texto na célula e texto em pedaços** (`<si><r><t>Ana </t></r><r><t>Souza</t></r></si>`): o nome sai inteiro.
  - **.xlsx com número grande:** `<c r="B2"><v>11999998888</v></c>` e `<c r="B3"><v>1.1999998888E10</v></c>` dão "11999998888" nos dois.
  - **.xlsx com fórmula:** `<c r="B2"><f>A1</f><v>2002</v></c>` dá "2002".
  - **.xlsx com células vazias no meio:** `r="A2"` e `r="C2"`, sem a B2, deixam a coluna B vazia, e a C é a observação.
  - **.xlsx com zero na frente como texto** (`t="s"` com "011987654321"): fica "011987654321".
  - **.xlsx com duas abas:** vale a primeira do `workbook.xml` (mesmo que esteja escondida e que o arquivo dela seja `sheet2.xml`).
  - **Limites:**
    - 10.001 linhas válidas dão `TooLarge`;
    - `kSheetMaxBytes + 1` bytes dão `TooLarge`;
    - um .xlsx cuja parte descompactada passa de `kSheetMaxPartBytes` dá `TooLarge`. Monte com zeros: o miniz comprime muito.
  - **Não é planilha:** `"PK"` seguido de lixo, um .xlsx sem `workbook.xml`, e `"<!DOCTYPE html><html>…"` dão `Unreadable`.
- [ ] **Step 2: Rode e veja falhar.** Rode o build dos testes do app de PC: o esperado é FAIL, porque o `Planilha.h` não existe.
- [ ] **Step 3: Implemente** `ReadContactSheet`, com o miniz no .xlsx (`mz_zip_reader_*` na memória):
  - confira o tamanho descompactado de cada parte antes de extrair;
  - leia o XML com um leitor pequeno no próprio `Planilha.cpp`: as entidades `&amp; &lt; &gt; &quot; &apos;` e `&#NNN;`, e `xml:space`;
  - o CSV segue a seção 6.1 da spec;
  - o cabeçalho e as colunas seguem a seção 6.2;
  - a comparação dos nomes das colunas usa o `FoldForSearch` (`Stores.h`) e tira os espaços das pontas.
- [ ] **Step 4: Rode e veja passar.** A suíte inteira do app de PC passa (`desktop_tests`).
- [ ] **Step 5: Commit.** Mensagem: `feat(windows): a leitura das planilhas de contatos (CSV, .xlsx e o CSV do MicroSIP)`. Faça o push: o CI do Windows compila o miniz e o `Planilha.cpp`, e o job tem que ficar verde.

### Task 3: A escrita do exportar

**Files:**
- Modify: `starsonic/desktop/Planilha.h`, `starsonic/desktop/Planilha.cpp`
- Test: `tests/desktop/test_planilha.cpp`

**Interfaces:**
- Consumes: `SheetContact`, `ReadContactSheet` (Task 2).
- Produces:
  ```cpp
  std::string WriteContactsXlsx(const std::vector<SheetContact>& contacts);   // bytes do .xlsx
  std::string WriteContactsCsv(const std::vector<SheetContact>& contacts);    // bytes do .csv
  ```
- **Os dois formatos:**
  - ambos com o cabeçalho "Nome", "Número", "Observação", na ordem recebida;
  - **XLSX:** uma aba "Contatos", todas as células como `inlineStr`, partes mínimas que o Excel abre (`[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, `xl/worksheets/sheet1.xml`);
  - **CSV:** BOM UTF-8, `;`, CRLF, e aspas quando o texto tem `;`, `"`, CR ou LF.

- [ ] **Step 1: Escreva os testes que falham.**
  - **`the exported csv opens in columns in a Portuguese Excel`:** os bytes começam com `"\xef\xbb\xbfNome;N\xc3\xbamero;Observa\xc3\xa7\xc3\xa3o\r\n"`. A linha {L"Silva; Ana", "011 2002", L"diz \"oi\""} sai `"\"Silva; Ana\";011 2002;\"diz \"\"oi\"\"\"\r\n"`.
  - **`the exported xlsx and csv read back as the same contacts`:** a lista {Ana Souza 2002 cliente; João (11) 5060-3000 ""; Zé 011987654321 "linha1\nlinha2"}, depois de `ReadContactSheet(Write…(lista))`, volta igual nos dois formatos.
  - **`the exported xlsx keeps numbers as text`:** a aba tem `t="inlineStr"` em todas as células e nenhum `<v>`.
  - **`an empty list exports only the header`.**
- [ ] **Step 2: Rode e veja falhar.**
- [ ] **Step 3: Implemente,** com o escritor de zip do miniz.
- [ ] **Step 4: Rode e veja passar** a suíte inteira.
- [ ] **Step 5: Commit.** Mensagem: `feat(windows): o exportar dos contatos em .xlsx e CSV`. Faça o push com o CI verde.

### Task 4: A fonte e a loja da lista da empresa

**Files:**
- Create: `starsonic/desktop/ListaEmpresa.h`, `starsonic/desktop/ListaEmpresa.cpp`
- Test: `tests/desktop/test_lista_empresa.cpp`

**Interfaces:**
- Consumes: `SheetContact` (Task 2), `FileSystem` (`Files.h`), `NormalizeDialString` (`CallMessages.h`).
- Produces:
  ```cpp
  enum class CompanySourceKind { Google, GooglePublished, OneDrive, SharePoint, Dropbox, Link, Path };
  struct CompanySource {
      CompanySourceKind kind = CompanySourceKind::Link;
      std::string location;   // a URL https a buscar, ou o caminho do arquivo (UTF-8)
  };
  // O link colado (sem espaços nas pontas e sem as aspas do "Copiar como caminho"); nada se não é https:// nem caminho.
  std::optional<CompanySource> CompanySourceFor(const std::string& link);
  // Para o diagnóstico: "Google", "Google (publicado)", "OneDrive", "SharePoint", "Dropbox", "link", "caminho".
  const char* CompanySourceName(CompanySourceKind kind);

  enum class CompanyFetchError { None, Closed, Offline, NotFound, TooLarge };
  struct CompanyFetch {
      CompanyFetchError error = CompanyFetchError::None;
      std::string bytes;
  };
  // A resposta HTTP já lida: 200 com corpo que não é HTML -> bytes; 401/403/404 ou HTML -> Closed; tooLarge -> TooLarge;
  // networkError (ou 5xx, ou outro status) -> Offline.
  CompanyFetch FromHttp(int status, bool networkError, bool tooLarge, std::string body);

  // contatos-empresa.json: {"versao":1,"atualizada":<ms>,"contatos":[{"nome","numero","observacao"}]}
  class CompanyListStore {
  public:
      CompanyListStore(FileSystem& files, std::string path);
      bool Load();                                   // sem arquivo: vazia (true); ilegível: vazia (false)
      std::vector<SheetContact> All() const;
      int64_t UpdatedMs() const;                     // 0: nenhuma leitura boa
      bool Replace(std::vector<SheetContact> contacts, int64_t updatedMs);   // false: o disco falhou, nada muda
      bool Clear();                                  // a lista vazia e atualizada 0, gravadas
      std::wstring NameFor(const std::string& number) const;   // pelo NormalizeDialString; vazio se não há
  };
  ```
  - A loja tem uma trava. O `NameFor` é chamado pelo controlador de ligações, na thread do motor, como o do `ContactsStore`.

- [ ] **Step 1: Escreva os testes que falham.**
  - **As conversões, uma por linha** (a entrada e a saída esperada):
    - `https://docs.google.com/spreadsheets/d/1AbC_dEf-123/edit#gid=456` → Google, `https://docs.google.com/spreadsheets/d/1AbC_dEf-123/export?format=csv&gid=456`
    - `https://docs.google.com/spreadsheets/d/1AbC_dEf-123/edit?usp=sharing` → `https://docs.google.com/spreadsheets/d/1AbC_dEf-123/export?format=csv`
    - `https://docs.google.com/spreadsheets/d/1AbC/edit?gid=789#gid=789` → `https://docs.google.com/spreadsheets/d/1AbC/export?format=csv&gid=789`
    - `https://docs.google.com/spreadsheets/d/e/2PACX-1vXyz/pubhtml` → GooglePublished, `https://docs.google.com/spreadsheets/d/e/2PACX-1vXyz/pub?output=csv`
    - `https://docs.google.com/spreadsheets/d/e/2PACX-1vXyz/pub?gid=0&single=true&output=xlsx` → `https://docs.google.com/spreadsheets/d/e/2PACX-1vXyz/pub?output=csv&gid=0&single=true`
    - `https://1drv.ms/x/s!AbCdEf123` → OneDrive, `https://api.onedrive.com/v1.0/shares/u!aHR0cHM6Ly8xZHJ2Lm1zL3gvcyFBYkNkRWYxMjM/root/content`
    - `https://onedrive.live.com/edit?id=ABC123%21105&resid=ABC123%21105&authkey=!XyZ` → `https://api.onedrive.com/v1.0/shares/u!aHR0cHM6Ly9vbmVkcml2ZS5saXZlLmNvbS9lZGl0P2lkPUFCQzEyMyUyMTEwNSZyZXNpZD1BQkMxMjMlMjExMDUmYXV0aGtleT0hWHla/root/content`
    - `https://empresa.sharepoint.com/:x:/s/Comercial/EaBcD?e=Xy12` → SharePoint, `https://empresa.sharepoint.com/:x:/s/Comercial/EaBcD?e=Xy12&download=1`
    - `https://empresa-my.sharepoint.com/:x:/g/personal/ana_empresa_com/EaBc#x` → `https://empresa-my.sharepoint.com/:x:/g/personal/ana_empresa_com/EaBc?download=1`
    - `https://empresa.sharepoint.com/:x:/s/C/EaB?download=1` → como está
    - `https://www.dropbox.com/scl/fi/abc/contatos.xlsx?rlkey=k1&dl=0` → Dropbox, `https://www.dropbox.com/scl/fi/abc/contatos.xlsx?rlkey=k1&dl=1`
    - `https://www.dropbox.com/s/abc/contatos.csv` → `https://www.dropbox.com/s/abc/contatos.csv?dl=1`
    - `https://intranet.empresa.com.br/contatos.csv#topo` → Link, `https://intranet.empresa.com.br/contatos.csv`
    - `  \\\\servidor\\pasta\\contatos.xlsx  ` → Path, `\\\\servidor\\pasta\\contatos.xlsx`
    - `"C:\\Users\\Ana\\contatos.csv"` (com as aspas) → Path, `C:\\Users\\Ana\\contatos.csv`
    - `Z:/lista.xlsx` → Path, `Z:/lista.xlsx`
    - `file:///C:/Users/Ana/Meus%20contatos.csv` → Path, `C:\\Users\\Ana\\Meus contatos.csv`
    - `file://servidor/pasta/x.xlsx` → Path, `\\\\servidor\\pasta\\x.xlsx`
    - nada: `http://intranet/contatos.csv`, `""`, `"contatos"`, `ftp://x/y.csv`, `https://`
  - **`FromHttp`:**
    - (200, false, false, "Nome;Numero\n") → None com os bytes;
    - (200, …, "<!DOCTYPE html>…") e (200, …, "  <html>") → Closed;
    - 401, 403 e 404 → Closed;
    - 500 e 503 → Offline;
    - networkError → Offline;
    - tooLarge → TooLarge.
  - **A loja:**
    - `Replace` grava o formato exato, e o `Load` de outra loja no mesmo disco lê igual;
    - o arquivo ilegível vale como vazio, e o `Load` devolve false;
    - o `Replace` com `failWrites` deixa a lista de antes;
    - o `Clear` grava a lista vazia com `atualizada` 0;
    - o `NameFor` compara pelo `NormalizeDialString`, como o `ContactsStore::NameFor`: o "11 5060 3000" acha o contato gravado como "(11) 5060-3000".
- [ ] **Step 2: Rode e veja falhar.**
- [ ] **Step 3: Implemente.** O base64url é do link inteiro, como foi colado (sem as aspas e sem espaços), e sem o `=` do fim. A decodificação dos `%XX` do `file://` é UTF-8.
- [ ] **Step 4: Rode e veja passar** a suíte inteira.
- [ ] **Step 5: Commit.** Mensagem: `feat(windows): a fonte e a loja da lista de contatos da empresa`. Faça o push com o CI verde.

### Task 5: O app de PC: importar, exportar, a lista da empresa e a ponte

**Files:**
- Modify: `starsonic/desktop/Stores.h` e `Stores.cpp` (o `Settings::companyListLink`, chave `planilha_empresa` do `config.json`, padrão `""`)
- Modify: `starsonic/desktop/DesktopApp.h` e `DesktopApp.cpp`
- Modify: `starsonic/desktop/Protocol.h` e `Protocol.cpp`
- Modify: `docs/ponte-windows.md`
- Test: `tests/desktop/test_desktop_app.cpp`, `tests/desktop/test_protocol.cpp`, `tests/desktop/test_stores.cpp`

**Interfaces:**
- Consumes: Tasks 2 a 4.
- Produces:
  - **`DesktopPaths::companyList`:** `contatos-empresa.json`.
  - **`DesktopHooks`** (todos chamados na thread de comandos; o callback pode vir de qualquer thread e só põe na fila):
    ```cpp
    // A janela de abrir planilha; o callback leva o caminho (UTF-8), ou "" se a pessoa cancelou.
    std::function<void(std::function<void(const std::string& path)>)> pickImportFile;
    // A janela de salvar; o callback leva o caminho e o formato ("xlsx" | "csv"), ou "" se cancelou.
    std::function<void(std::function<void(const std::string& path, const std::string& format)>)> pickExportFile;
    // Lê a fonte fora da thread de comandos; o callback leva o resultado.
    std::function<void(const CompanySource& source, std::function<void(const CompanyFetch& result)>)> fetchCompanyList;
    ```
  - **`CommandKind`:**
    - `ImportContacts` (`importContacts`) e `ExportContacts` (`exportContacts`), sem campos;
    - `SetCompanyList` (`setCompanyList`), com `link` (texto, obrigatório, pode ser vazio), em `Command::link`;
    - `RefreshCompanyList` (`refreshCompanyList`).
  - **`BridgeState::company`** (`empresa`): `{link, situacao: "nenhuma"|"lendo"|"ok"|"erro", erro, atualizadaEm, quantos, vez}`. Veja a spec, seção 7.1.
  - **`std::string CompanyContactsMessage(int seq, const std::vector<SheetContact>& contacts)`:** a mensagem `{"v":1,"type":"contatosEmpresa","vez":<seq>,"contatos":[{"nome","numero","observacao"}]}`.
- **As regras** são as da spec, seções 4.2, 4.3, 5.3, 5.4 e 5.6:
  - **O importar:**
    - lê o arquivo pelo `FileSystem::Read`; `nullopt` dá "Não consegui abrir o arquivo.";
    - os repetidos se comparam pelo `FoldForSearch` do nome e pelo `NormalizeDialString` do número, contra os meus e dentro da planilha (como o `LegacyImport.cpp:516-522`);
    - grava com `ContactsStore::AddAll`.
  - **O exportar:** grava com `FileSystem::WriteAtomic`.
  - **A lista da empresa:**
    - ao abrir, depois das lojas, lê o `contatos-empresa.json` e, com link, já pede uma leitura;
    - uma tarefa do agendador a cada 900000 ms, com o link salvo; ela só põe na fila, e o destrutor a cancela (como o `loginTimer_`);
    - um pedido no meio de uma leitura marca "de novo" e roda uma vez quando a leitura volta;
    - o `vez` sobe só com uma lista nova;
    - o `contatosEmpresa` sai no `ready` (depois do estado) e a cada lista nova;
    - os nomes: o `Names::NameFor` e os Recentes do `BuildState` procuram nos meus, depois na `CompanyListStore` (o `contatoId` fica `""`).

- [ ] **Step 1: Escreva os testes que falham.**
  - **O `Harness`** ganha:
    - os três ganchos, que guardam os pedidos e os callbacks: `importPicks`, `exportPicks` e `fetches` (com a fonte), para o teste responder quando quiser;
    - o `paths.companyList = "dados/contatos-empresa.json"`.
  - **`test_desktop_app.cpp`:**
    - **`importContacts adds the new contacts and says how many already existed`:**
      - um contato meu, Ana Souza 2002;
      - o arquivo `importar/c.csv` = `"Nome;Numero\nAna Souza;2002\nBruno;2003\nBruno;2003\nCaio;2004\n"`;
      - o gancho responde `"importar/c.csv"`;
      - o toast é "2 contatos importados (1 j\xc3\xa1 existiam).";
      - o `contatos.json` tem os três.
    - **`importContacts with the window cancelled does nothing`:** sem toast e sem gravação.
    - **`importContacts of a file that is not a sheet`:** o toast é "N\xc3\xa3o consegui ler a planilha. Ela precisa das colunas Nome e N\xc3\xbamero."
    - **`importContacts of a file that does not open`:** o toast é "N\xc3\xa3o consegui abrir o arquivo."
    - **`importContacts with nothing new`:** o toast é "Nenhum contato novo na planilha."
    - **`importContacts of a sheet that is too large`:** o toast é "A planilha \xc3\xa9 grande demais (o m\xc3\xa1ximo \xc3\xa9 10.000 contatos)."
    - **`exportContacts writes the chosen format`:**
      - "xlsx": os bytes começam com "PK" e o toast é "3 contatos exportados.";
      - "csv": os bytes começam com o BOM;
      - com `files.failWrites`: o toast é "N\xc3\xa3o consegui salvar o arquivo.";
      - cancelado: nada.
    - **`setCompanyList saves the link and reads the converted source`:**
      - o link é um do Google;
      - o `fetches` tem a URL de export;
      - o callback com o CSV de dois contatos deixa `empresa.situacao` "ok", `quantos` 2, `vez` 1 e `atualizadaEm` na hora do relógio falso;
      - um `contatosEmpresa` com os dois;
      - o `contatos-empresa.json` gravado;
      - o `config.json` com `planilha_empresa`.
    - **`the company list is read again every 15 minutes`:** `time.Advance(899999)` não pede; mais 1 ms pede.
    - **`a failed read keeps the list and shows the error`:** um `Offline` depois de uma lista boa dá "erro", com o texto "Sem conex\xc3\xa3o com a planilha. Fica a \xc3\xbaltima lista.". O `quantos`, o `vez` e o arquivo ficam iguais.
    - **`one read at a time`:**
      - dois `refreshCompanyList` com uma leitura aberta pedem uma leitura só;
      - quando ela volta, sai mais uma;
      - mais nenhuma depois.
    - **`opening the app shows the saved list first`:**
      - com o `contatos-empresa.json` e o `config.json` semeados, depois do `Start` e de um `ready`;
      - o `contatosEmpresa` com a lista guardada;
      - `empresa.situacao` "lendo", `atualizadaEm` o do arquivo;
      - um pedido em `fetches`.
    - **`a closed link and a missing file show their messages`:**
      - Closed: "N\xc3\xa3o consegui abrir o link. Confira se a planilha est\xc3\xa1 compartilhada para qualquer pessoa com o link.";
      - NotFound: "N\xc3\xa3o achei o arquivo. Confira o caminho e se este computador tem acesso \xc3\xa0 pasta.";
      - os bytes que não são planilha: o texto de `Unreadable` da spec, seção 5.4;
      - TooLarge: o texto de grande demais.
    - **`an invalid link is saved but not read`:**
      - o `http://intranet/x.csv` dá "erro" com "Use um link https:// ou o caminho de um arquivo.";
      - nenhum pedido em `fetches`.
    - **`clearing the link removes the list`:**
      - `setCompanyList` com `""` dá `contatosEmpresa` vazio (o `vez` sobe) e `situacao` "nenhuma";
      - o arquivo fica com a lista vazia;
      - nenhum pedido novo;
      - a tarefa de 15 min não pede mais.
    - **`names come from my contacts first, then from the company list`:**
      - o número 3001 está na lista da empresa como "Empresa Teste";
      - uma recebida do 3001 mostra "Empresa Teste" no `ligacao`, e o Recente dela também, com `contatoId` `""`;
      - com um contato meu 3001 "Meu Contato", vale ele.
    - **`the link never goes to the diagnostics`:** nenhum `logs` contém o texto do link, e há uma linha com "Google".
  - **`test_protocol.cpp`:**
    - os quatro comandos lidos;
    - `setCompanyList` sem `link`, ou com `link` que não é texto, é erro;
    - o `empresa` do `StateMessage` com as seis chaves e os valores;
    - o `CompanyContactsMessage` exato para dois contatos com acento.
  - **`test_stores.cpp`:** o `planilha_empresa` gravado e lido; um `config.json` antigo, sem ela, dá `""`.
- [ ] **Step 2: Rode e veja falhar.**
- [ ] **Step 3: Implemente.**
  - **Os textos:** os da spec, como `const char k…[]` com escapes UTF-8, perto dos outros do `DesktopApp.cpp`.
  - **O diagnóstico:**
    - "lista da empresa: lendo (<CompanySourceName>)";
    - "lista da empresa: <n> contatos";
    - "lista da empresa: erro <tipo>";
    - "importar: <n> novos, <m> repetidos, <k> fora";
    - "exportar: <n> (<formato>)".
  - **O `docs/ponte-windows.md`:**
    - os comandos novos na tabela "Contatos e Recentes";
    - o `empresa` no estado, com a tabela dos campos;
    - a mensagem `contatosEmpresa`, com um exemplo.
- [ ] **Step 4: Rode e veja passar** a suíte inteira do app de PC.
- [ ] **Step 5: Commit.** Mensagem: `feat(windows): importar, exportar e a lista da empresa no app de PC e na ponte`. Faça o push com o CI verde. O executável ainda não liga os ganchos novos: sem eles, os comandos só deixam uma linha no diagnóstico.

### Task 6: A interface: Contatos e Configurações

**Files:**
- Modify:
  - `windows/ui/src/state.ts` (`CompanyContact`, `CompanyList`, `AppState.empresa`, a mensagem `contatosEmpresa` e os quatro comandos);
  - `windows/ui/src/main.tsx` (guarda a lista pela `vez` e a passa aos Contatos);
  - `windows/ui/src/screens/Contatos.tsx`;
  - `windows/ui/src/screens/Configuracoes.tsx`;
  - `windows/ui/src/format.ts` (a hora: "às 14:32" ou "em 26/10 às 14:32");
  - `windows/ui/src/fake.ts` e `fake-scenarios.ts` (um cenário com a lista da empresa, para as capturas);
  - `windows/ui/src/app.css` (a etiqueta, só se as classes de hoje não servirem).
- Test: `windows/ui/tests/contatos.spec.ts` (novo) e `windows/ui/tests/screens.spec.ts` (as capturas e o axe)

**Interfaces:**
- Consumes: a ponte da Task 5.
- **Contatos:**
  - **O botão "⋯"** ao lado do "+": `aria-label="Mais opções"`, com `title` igual, e o `Menu` de hoje com "Importar planilha…" e "Exportar planilha…", que mandam `importContacts` e `exportContacts`.
  - **A lista:** os meus mais os da empresa, em ordem alfabética (o `fold` da busca). Some o da empresa com o mesmo `fold(nome)` e o mesmo `digitsOnly(numero)` de um meu.
  - **Os da empresa:**
    - a etiqueta "Empresa" na linha do nome;
    - sem o botão de menu;
    - o toque na linha e o botão de ligar mandam `dial` com `contato: true`.
  - **Os filtros:** com `empresa.link` não vazio, "Todos", "Meus" e "Empresa", com as classes `pill`/`pill-on` e o `aria-pressed` do Recentes.
  - **A lista vazia por filtro:** "Nenhum contato da empresa." e "Nenhum contato seu ainda.".
- **Configurações**, a parte "Contatos" depois de "Ligações":
  - o rótulo "Planilha da empresa", o campo (`id="cfg-planilha"`, o texto do `empresa.link`) e o "Salvar" (`setCompanyList {link}`, também com Enter no campo);
  - a ajuda, da spec, seção 5.1;
  - a linha da situação:
    - "Lendo a planilha…";
    - "Atualizada às 14:32 · 230 contatos" (1 é "1 contato");
    - ou o `erro` e, com `atualizadaEm > 0`, a linha "Última lista: às 14:32 · 230 contatos";
    - nada em "nenhuma";
  - "Atualizar agora" (`refreshCompanyList`), desligado sem link ou com "lendo".

- [ ] **Step 1: Escreva os testes que falham** (`contatos.spec.ts`), com o estado de mentira e os helpers de hoje (`abrir`, `empurrar`, `esperarComando`). Mande a mensagem `contatosEmpresa` pela mesma ponte de mentira.
  - `the more button offers import and export` (os dois comandos saem).
  - `company contacts show the Empresa tag and have no menu`.
  - `the filters show only when a company list is set, and filter`.
  - `a company contact that is also mine shows once`.
  - `search finds company contacts`.
  - `tapping a company contact dials it as a contact`.
  - Em Configurações:
    - `the company sheet field saves the link` (também com Enter, e vazio);
    - `the status line shows reading, updated, error with the last list, and nothing`, com os textos exatos e um `atualizadaEm` de hoje e de outro dia (o relógio do teste fixo);
    - `refresh now is disabled without a link and while reading`.
  - Em `screens.spec.ts`: as capturas de Contatos com a lista da empresa e das Configurações com a parte nova, nos dois temas e nas três larguras, e o axe sem violações sérias.
- [ ] **Step 2: Rode e veja falhar.**
- [ ] **Step 3: Implemente.**
- [ ] **Step 4: Rode e veja passar.** `npm run typecheck && npm run build && npx playwright test`: a suíte inteira.
- [ ] **Step 5: Commit.** Mensagem: `feat(windows): a lista da empresa, o importar e o exportar na tela Contatos e nas Configurações`. Faça o push com o CI verde e confira as capturas.

### Task 7: O executável: as janelas de arquivo e a leitura da fonte

**Files:**
- Create: `windows/app/src/FilePicker.h` e `.cpp`, `windows/app/src/CompanyFetcher.h` e `.cpp`
- Modify: `windows/app/src/main.cpp` (os ganchos e o `config.paths.companyList = data + "\\contatos-empresa.json"`)
- Test: `tests/smoke/windows_smoke.py` (um passo novo na fumaça do app instalado), e o `tests/desktop/CMakeLists.txt` se uma parte portátil nova entrar

**Interfaces:**
- Consumes: os ganchos da Task 5, `HttpsGet` (`starsonic/win/Http.h`), `FromHttp` e `kSheetMaxBytes`.
- Produces:
  ```cpp
  // Na thread da janela (COM já iniciado nela).
  std::optional<std::wstring> PickImportFile(HWND owner);
  struct ExportChoice { std::wstring path; std::string format; };   // "xlsx" | "csv"
  std::optional<ExportChoice> PickExportFile(HWND owner);
  // Uma thread própria: os pedidos na ordem; Stop() espera a leitura de agora e descarta o resto.
  class CompanyFetcher {
  public:
      CompanyFetcher(std::wstring userAgent, std::function<void(const std::string&)> log);
      ~CompanyFetcher();   // Stop()
      void Fetch(const starsonic::CompanySource& source,
                 std::function<void(const starsonic::CompanyFetch&)> done);
      void Stop();
  };
  ```
- **As janelas:**
  - `IFileOpenDialog` com os filtros "Planilhas (*.xlsx, *.csv)" (`*.xlsx;*.csv`) e "Todos os arquivos" (`*.*`);
  - `IFileSaveDialog` com "Planilha do Excel (*.xlsx)" e "CSV (*.csv)", o nome "Contatos Starsonic.xlsx" e a extensão que segue o tipo escolhido;
  - o dono é a janela principal.
- **A leitura de um caminho:**
  - `CreateFileW` com `GENERIC_READ` e `FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE` (o arquivo aberto no Excel);
  - o tamanho conferido antes de ler (`> kSheetMaxBytes` dá `TooLarge`);
  - não achar o arquivo, ou não ter acesso, dá `NotFound`.
- **A leitura de um link:** `HttpsGet(url, kSheetMaxBytes, userAgent)`, com `FromHttp(status, error != 0 && error != ERROR_FILE_TOO_LARGE, error == ERROR_FILE_TOO_LARGE, body)`.
- **No fechamento:** o `CompanyFetcher` é criado antes do `DesktopApp` e o `Stop()` roda antes do `app.Shutdown()`. Nenhum callback chega a um `DesktopApp` destruído.

- [ ] **Step 1: Escreva o teste que falha,** na fumaça do app instalado (`windows_smoke.py`), seguindo o jeito dos passos que já existem:
  - grave `contatos-empresa-teste.csv` numa pasta temporária, com `"Nome;N\u00famero\r\nEmpresa Teste;3001\r\n"` em UTF-8;
  - em Configurações → Contatos, escreva o caminho em "Planilha da empresa" e clique em "Salvar";
  - espere "Atualizada às";
  - na aba Contatos, "Empresa Teste" aparece, com a etiqueta "Empresa";
  - um `RING 2001` do registrador falso (que liga como o 3001) mostra "Empresa Teste" na recebida.
  - Faça também a captura da tela Contatos com a lista da empresa (`capturas-windows`).
- [ ] **Step 2: Veja falhar no CI.** O push deixa a fumaça vermelha nesse passo (a interface da Task 6 já está lá; falta o executável).
- [ ] **Step 3: Implemente** as janelas, o `CompanyFetcher` e os ganchos no `main.cpp`:
  - `pickImportFile` e `pickExportFile` pelo `window.RunOnWindow`;
  - `fetchCompanyList` pelo `CompanyFetcher`.
- [ ] **Step 4: Veja passar no CI:** a fumaça e o resto do workflow `build`, com a captura nova.
- [ ] **Step 5: Commit.** Mensagem: `feat(windows): as janelas de importar e exportar e a leitura da planilha da empresa no executável`.

### Task 8: Roteiro, notas e a revisão final

**Files:**
- Modify:
  - `docs/teste-manual.md` (a seção 19 nova e os critérios da rc.4);
  - a spec (a seção "Como ficou");
  - `README.md` (uma frase na linha do Windows, se couber).
- Create: `notas/v0.1.0-rc.4.txt`

- [ ] **Step 1: O roteiro manual,** a seção "19. Contatos por planilha e o toque (rc.4)". As linhas:
  - o toque numa recebida, no dispositivo de Toque, e a segunda ligação com o bipe de espera;
  - importar o CSV do MicroSIP e uma planilha do Excel;
  - exportar em .xlsx e em CSV e abrir no Excel;
  - a lista da empresa:
    - do Google Planilhas (aberta para qualquer pessoa) e fechada (o erro);
    - do OneDrive pessoal e do SharePoint do trabalho;
    - de uma pasta da rede, e com o arquivo aberto no Excel;
  - a planilha mudada, que chega em até 15 min ou no "Atualizar agora";
  - sem internet, a lista que fica;
  - o nome da empresa numa recebida;
  - o link apagado;
  - a letra grande (o zoom do Windows em 150%).
- [ ] **Step 2: As notas** (`notas/v0.1.0-rc.4.txt`, o texto curto do aviso de atualização):
  - o toque novo;
  - o importar e o exportar;
  - a lista da empresa;
  - "Esta é uma versão de teste.".
- [ ] **Step 3: A seção "Como ficou" da spec,** com as decisões tomadas na construção e os textos novos fora da seção 9.
- [ ] **Step 4: A revisão final do ramo inteiro** (`superpowers:requesting-code-review`, no modelo mais capaz), com um passe só de correções para o que for Crítico ou Importante.
- [ ] **Step 5: Commit, push e CI verde.** Avise o responsável que a rc.4 está pronta para ele publicar: GitHub → Actions → release → Run workflow → versão `0.1.0-rc.4`. Depois de publicada, confira o release e o canal de teste e deixe a entrega no Projeto.
