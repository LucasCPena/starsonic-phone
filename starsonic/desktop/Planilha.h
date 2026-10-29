#pragma once
// As planilhas de contatos (spec da rc.4): a leitura (secao 6), a mesma para o importar e para a lista da empresa, e a
// escrita do exportar (secao 4.3), no fim deste arquivo.
// C++ portatil: nada de Windows aqui. O zip do .xlsx e o do miniz (starsonic/third_party/miniz).
//
// O formato sai do conteudo, nao da extensao: os bytes que comecam com "PK" sao um .xlsx; o resto e CSV.
// - .xlsx: a primeira aba na ordem do xl/workbook.xml (mesmo escondida), achada pelo r:id dela no
//   xl/_rels/workbook.xml.rels. As celulas: o texto compartilhado (sharedStrings, tambem o texto com formatacao, em
//   pedacos), o texto na propria celula (inlineStr) e o numero; da formula vale o valor guardado (<v>). Um numero
//   inteiro sai sem a notacao cientifica e sem ".0" (1.1999998888E10 vira "11999998888"); o numero que nao e inteiro,
//   a data e os outros tipos saem como estao no <v>. Cada celula fica na coluna da referencia dela (r="C5"): as que
//   faltam ficam vazias.
// - CSV: UTF-8, com ou sem o BOM; cada byte que nao comeca uma sequencia UTF-8 bem formada e lido como Windows-1252,
//   e o resto continua em UTF-8 (um byte perdido nao leva o arquivo inteiro). O separador e a virgula, o ponto e
//   virgula ou o tab: o que mais aparece fora das aspas na primeira linha nao vazia (no empate, ';', depois ',', depois
//   o tab; sem nenhum, uma coluna so). Aspas duplas, com "" dentro e com quebras de linha. A linha termina em CRLF, LF
//   ou CR. Uma pagina HTML (o Google ou a Microsoft pedindo login) nao e planilha.
//
// As colunas (spec 6.2). O cabecalho e a primeira linha nao vazia; os nomes das colunas sao comparados sem acento, sem
// caixa e sem espacos nas pontas:
// - nome: "nome", "name", "contato"; na linha sem o nome, "First Name" e "Last Name" juntos (o CSV do MicroSIP);
// - numero: "numero", "number", "telefone", "fone", "ramal", "celular", "phone", "phone number", "primary phone",
//   "mobile", "mobile number"; com varias, vale a primeira, da esquerda para a direita, que tem um numero na linha;
// - observacao: "observacao", "obs", "comment", "notes", "setor", "departamento", "empresa".
// Um nome repetido no cabecalho: vale a coluna mais a esquerda. Sem o nome e o numero no cabecalho: se a coluna B da
// primeira linha e um numero (2 digitos ou mais depois do NormalizeDialString, e nenhuma letra), a planilha nao tem
// cabecalho, e desde a primeira linha A e o nome, B o numero e C a observacao; senao, Unreadable.
//
// Em cada linha, o nome, o numero e a observacao saem sem espacos nas pontas. O numero fica como foi escrito, e so vale
// se o NormalizeDialString dele nao fica vazio. A linha sem nome ou sem numero fica de fora, sem erro.
#include <cstddef>
#include <string>
#include <vector>

namespace starsonic {

struct SheetContact {
    std::wstring name;
    std::string number;   // como foi escrito na planilha (UTF-8)
    std::wstring note;
};

// None: lida (a planilha so com o cabecalho e uma lista vazia valida). Unreadable: sem as colunas, ou o arquivo nao e
// planilha (um zip que nao abre ou sem o workbook.xml, um XML estragado, uma pagina HTML, um arquivo sem linhas).
// TooLarge (spec 6.3): mais de kSheetMaxBytes bytes, mais de kSheetMaxContacts contatos, ou uma parte do .xlsx com mais
// de kSheetMaxPartBytes descompactada (o tamanho e conferido antes de descompactar); e, no .xlsx, o texto das celulas
// da aba, somado, com mais de kSheetMaxPartBytes (um texto compartilhado grande, usado em muitas celulas).
enum class SheetError { None, Unreadable, TooLarge };

struct SheetRead {
    SheetError error = SheetError::None;
    std::vector<SheetContact> contacts;   // na ordem da planilha; vazia com erro
};

constexpr size_t kSheetMaxBytes = 10485760;       // 10 MB
constexpr size_t kSheetMaxContacts = 10000;
constexpr size_t kSheetMaxPartBytes = 52428800;   // 50 MB: protege de um .xlsx feito para encher a memoria

// Os contatos da planilha (os bytes do arquivo). Nunca lanca excecao: o que falha na leitura vira o erro.
SheetRead ReadContactSheet(const std::string& bytes);

// A escrita do exportar (spec 4.3), em PlanilhaEscrita.cpp: os contatos viram os bytes de um arquivo, na ordem recebida
// (a ordem alfabetica e de quem chama). Os dois formatos levam o cabecalho Nome, Numero e Observacao (com acento, em
// UTF-8), e o ReadContactSheet os le de volta como os mesmos contatos.
// - .xlsx: uma aba, "Contatos", so com as partes minimas que o Excel abre ([Content_Types].xml, _rels/.rels,
//   xl/workbook.xml, xl/_rels/workbook.xml.rels e xl/worksheets/sheet1.xml). Toda celula e texto na propria celula
//   (t="inlineStr", sem <v>), para o Excel nao mostrar o numero em notacao cientifica nem tirar o zero da frente, e
//   leva a referencia dela (A1, B1, C1...); a linha leva o numero dela (r="2"). A celula sem texto nao e escrita. O
//   texto sai sem os caracteres que o XML 1.0 nao carrega (U+0000 a U+0008, U+000B, U+000C, U+000E a U+001F, U+FFFE e
//   U+FFFF: o Excel nao abre a planilha que tem um deles), com & < > em entidades (e o CR como &#13;), e com os
//   espacos e as quebras de linha das pontas guardados (xml:space="preserve").
// - CSV: UTF-8 com BOM, separado por ponto e virgula e com CRLF, para o Excel em portugues abrir em colunas. O campo
//   vai entre aspas quando tem ponto e virgula, aspas, CR ou LF (a aspa de dentro vira duas). O texto vai como esta.
// Os dois nunca lancam excecao: devolvem vazio so se o miniz nao deu ou faltou memoria. Um arquivo exportado nunca e
// vazio (o CSV tem o BOM e o cabecalho; o .xlsx, o zip), entao vazio e a falha.
std::string WriteContactsXlsx(const std::vector<SheetContact>& contacts);
std::string WriteContactsCsv(const std::vector<SheetContact>& contacts);

}  // namespace starsonic
