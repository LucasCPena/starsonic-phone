// Testes da leitura das planilhas de contatos (starsonic/desktop/Planilha.h; spec da rc.4, secao 6). Os .xlsx sao
// montados aqui, na memoria, com o escritor de zip do miniz, so com as partes que a leitura usa ([Content_Types].xml,
// xl/workbook.xml, xl/_rels/workbook.xml.rels, as abas e o sharedStrings); o "gravado pelo Excel" tem tambem as partes
// e os atributos que o Excel em portugues grava. No fim, os testes da escrita do exportar (PlanilhaEscrita.cpp; secao
// 4.3): o que sai do WriteContactsXlsx e do WriteContactsCsv volta igual pelo ReadContactSheet.
#include <algorithm>
#include <chrono>
#include <string>
#include <utility>
#include <vector>

#include "Planilha.h"
#include "Text.h"
#include "test_support.h"
#include "miniz/miniz.h"
// O CMake desliga os nomes do zlib do miniz.h (MINIZ_NO_ZLIB_COMPATIBLE_NAMES, junto do MINIZ_NO_STDIO): sem isso o
// miniz.h poe compress, crc32, Byte, uLong... como macros e typedefs em tudo que vem depois dele. Isto falha a
// compilacao se alguem tirar o define.
#if defined(compress) || defined(crc32)
#error "Falta o MINIZ_NO_ZLIB_COMPATIBLE_NAMES: o miniz.h poe os nomes do zlib (compress, crc32...) como macros"
#endif

using namespace starsonic;

namespace {

// Os contatos, um por texto: "nome|numero|observacao".
std::vector<std::wstring> Contacts(const std::vector<SheetContact>& contacts) {
    std::vector<std::wstring> rows;
    for (const SheetContact& contact : contacts) {
        rows.push_back(contact.name + L"|" + Utf8ToWide(contact.number) + L"|" + contact.note);
    }
    return rows;
}

// Os contatos lidos.
std::vector<std::wstring> Contacts(const SheetRead& read) { return Contacts(read.contacts); }

using Parts = std::vector<std::pair<std::string, std::string>>;

// O zip na memoria, com as partes na ordem dada.
std::string Zip(const Parts& parts, mz_uint level = MZ_DEFAULT_LEVEL) {
    mz_zip_archive zip;
    mz_zip_zero_struct(&zip);
    REQUIRE(mz_zip_writer_init_heap(&zip, 0, 0));
    for (const auto& part : parts) {
        REQUIRE(mz_zip_writer_add_mem(&zip, part.first.c_str(), part.second.data(), part.second.size(), level));
    }
    void* buffer = nullptr;
    size_t size = 0;
    REQUIRE(mz_zip_writer_finalize_heap_archive(&zip, &buffer, &size));
    const std::string bytes(static_cast<const char*>(buffer), size);
    mz_free(buffer);
    mz_zip_writer_end(&zip);
    return bytes;
}

const char kXmlDeclaration[] = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n";
const char kMainNamespace[] = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const char kRelationshipsNamespace[] = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const char kPackageRelationships[] = "http://schemas.openxmlformats.org/package/2006/relationships";
const char kRelationshipTypes[] = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
const char kContentTypes[] = "application/vnd.openxmlformats-officedocument.spreadsheetml.";

// Uma aba do .xlsx de teste: o nome no workbook, o arquivo em xl/worksheets/ e o conteudo do <sheetData>.
struct TestSheet {
    std::string name;
    std::string file;
    std::string rows;
    bool hidden;
};

// As partes do .xlsx minimo: as abas na ordem do workbook (rId1, rId2... na mesma ordem) e, com sharedItems, o
// xl/sharedStrings.xml com esses <si>.
Parts XlsxParts(const std::vector<TestSheet>& sheets, const std::string& sharedItems) {
    std::string types = std::string(kXmlDeclaration) +
                        "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
                        "<Default Extension=\"xml\" ContentType=\"application/xml\"/>"
                        "<Override PartName=\"/xl/workbook.xml\" ContentType=\"" + kContentTypes + "sheet.main+xml\"/>";
    std::string workbook = std::string(kXmlDeclaration) + "<workbook xmlns=\"" + kMainNamespace + "\" xmlns:r=\"" +
                           kRelationshipsNamespace + "\"><sheets>";
    std::string rels = std::string(kXmlDeclaration) + "<Relationships xmlns=\"" + kPackageRelationships + "\">";
    Parts sheetParts;
    for (size_t i = 0; i < sheets.size(); ++i) {
        const TestSheet& sheet = sheets[i];
        const std::string id = "rId" + std::to_string(i + 1);
        types += "<Override PartName=\"/xl/worksheets/" + sheet.file + "\" ContentType=\"" + kContentTypes +
                 "worksheet+xml\"/>";
        workbook += "<sheet name=\"" + sheet.name + "\" sheetId=\"" + std::to_string(i + 1) + "\"" +
                    (sheet.hidden ? " state=\"hidden\"" : "") + " r:id=\"" + id + "\"/>";
        rels += "<Relationship Id=\"" + id + "\" Type=\"" + kRelationshipTypes + "worksheet\" Target=\"worksheets/" +
                sheet.file + "\"/>";
        sheetParts.emplace_back("xl/worksheets/" + sheet.file, std::string(kXmlDeclaration) + "<worksheet xmlns=\"" +
                                                                   kMainNamespace + "\"><sheetData>" + sheet.rows +
                                                                   "</sheetData></worksheet>");
    }
    if (!sharedItems.empty()) {
        types += "<Override PartName=\"/xl/sharedStrings.xml\" ContentType=\"" + std::string(kContentTypes) +
                 "sharedStrings+xml\"/>";
        rels += "<Relationship Id=\"rId" + std::to_string(sheets.size() + 1) + "\" Type=\"" + kRelationshipTypes +
                "sharedStrings\" Target=\"sharedStrings.xml\"/>";
    }
    Parts parts = {{"[Content_Types].xml", types + "</Types>"},
                   {"xl/workbook.xml", workbook + "</sheets></workbook>"},
                   {"xl/_rels/workbook.xml.rels", rels + "</Relationships>"}};
    parts.insert(parts.end(), sheetParts.begin(), sheetParts.end());
    if (!sharedItems.empty()) {
        parts.emplace_back("xl/sharedStrings.xml", std::string(kXmlDeclaration) + "<sst xmlns=\"" + kMainNamespace +
                                                       "\">" + sharedItems + "</sst>");
    }
    return parts;
}

// O .xlsx de uma aba so, "Contatos" (xl/worksheets/sheet1.xml).
std::string Xlsx(const std::string& rows, const std::string& sharedItems = std::string()) {
    return Zip(XlsxParts({{"Contatos", "sheet1.xml", rows, false}}, sharedItems));
}

// Troca (ou, com nullptr, tira) uma parte.
Parts WithPart(Parts parts, const std::string& name, const char* content) {
    for (auto it = parts.begin(); it != parts.end(); ++it) {
        if (it->first != name) continue;
        if (content) {
            it->second = content;
        } else {
            parts.erase(it);
        }
        break;
    }
    return parts;
}

// O cabecalho do CSV que o MicroSIP exporta (microsip/Service/ContactsService.cpp:91-107, ExportContactsCSV). Ele
// grava em UTF-8 com o BOM, separado por virgula, com CRLF (lib/CSVFile.cpp e lib/StdioFileEx.cpp).
const char kMicroSipHeader[] =
    "Name,Number,First Name,Last Name,Phone Number,Mobile Number,E-mail Address,Address,City,State,Postal Code,"
    "Comment,Id,Info,Presence,Directory,Starred\r\n";

// O comeco de cada aba do Excel 365 (os prefixos x14ac, xr, xr2 e xr3 aparecem nas linhas).
const char kExcelWorksheet[] =
    "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" "
    "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" "
    "xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\" mc:Ignorable=\"x14ac xr xr2 xr3\" "
    "xmlns:x14ac=\"http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac\" "
    "xmlns:xr=\"http://schemas.microsoft.com/office/spreadsheetml/2014/revision\" "
    "xmlns:xr2=\"http://schemas.microsoft.com/office/spreadsheetml/2015/revision2\" "
    "xmlns:xr3=\"http://schemas.microsoft.com/office/spreadsheetml/2016/revision3\" "
    "xr:uid=\"{00000000-0001-0000-0000-000000000000}\">";

const char kExcelPageMargins[] =
    "<pageMargins left=\"0.511811024\" right=\"0.511811024\" top=\"0.78740157499999996\" "
    "bottom=\"0.78740157499999996\" header=\"0.31496062000000002\" footer=\"0.31496062000000002\"/>";

// Um .xlsx como o Excel em portugues grava: a primeira aba ("Contatos") escondida e no sheet2.xml, a segunda
// ("Planilha1") a vista; estilos (s="..."), texto com formatacao em pedacos, numero com zero na frente guardado como
// texto, formulas com o valor guardado, uma celula so com estilo, e as partes que a leitura nao usa.
std::string ExcelWorkbook() {
    const std::string declaration = kXmlDeclaration;
    Parts parts;
    parts.emplace_back(
        "[Content_Types].xml",
        declaration +
            "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
            "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>"
            "<Default Extension=\"xml\" ContentType=\"application/xml\"/>"
            "<Override PartName=\"/xl/workbook.xml\" ContentType=\"" + kContentTypes + "sheet.main+xml\"/>"
            "<Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"" + kContentTypes + "worksheet+xml\"/>"
            "<Override PartName=\"/xl/worksheets/sheet2.xml\" ContentType=\"" + kContentTypes + "worksheet+xml\"/>"
            "<Override PartName=\"/xl/styles.xml\" ContentType=\"" + kContentTypes + "styles+xml\"/>"
            "<Override PartName=\"/xl/sharedStrings.xml\" ContentType=\"" + kContentTypes + "sharedStrings+xml\"/>"
            "</Types>");
    parts.emplace_back("_rels/.rels",
                       declaration + "<Relationships xmlns=\"" + kPackageRelationships + "\">"
                                     "<Relationship Id=\"rId1\" Type=\"" + kRelationshipTypes +
                           "officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>");
    parts.emplace_back(
        "xl/workbook.xml",
        declaration +
            "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" "
            "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" "
            "xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\" "
            "mc:Ignorable=\"x15 xr xr6 xr10 xr2\" "
            "xmlns:x15=\"http://schemas.microsoft.com/office/spreadsheetml/2010/11/main\" "
            "xmlns:xr=\"http://schemas.microsoft.com/office/spreadsheetml/2014/revision\" "
            "xmlns:xr6=\"http://schemas.microsoft.com/office/spreadsheetml/2016/revision6\" "
            "xmlns:xr10=\"http://schemas.microsoft.com/office/spreadsheetml/2016/revision10\" "
            "xmlns:xr2=\"http://schemas.microsoft.com/office/spreadsheetml/2015/revision2\">"
            "<fileVersion appName=\"xl\" lastEdited=\"7\" lowestEdited=\"7\" rupBuild=\"28526\"/>"
            "<workbookPr defaultThemeVersion=\"166925\"/>"
            "<xr:revisionPtr revIDLastSave=\"0\" documentId=\"8_{00000000-0000-0000-0000-000000000000}\" "
            "xr6:coauthVersionLast=\"47\" xr6:coauthVersionMax=\"47\" "
            "xr10:uidLastSave=\"{00000000-0000-0000-0000-000000000000}\"/>"
            "<bookViews><workbookView xWindow=\"-120\" yWindow=\"-120\" windowWidth=\"29040\" windowHeight=\"15840\" "
            "activeTab=\"1\" xr2:uid=\"{00000000-000D-0000-FFFF-FFFF00000000}\"/></bookViews>"
            "<sheets><sheet name=\"Contatos\" sheetId=\"2\" state=\"hidden\" r:id=\"rId2\"/>"
            "<sheet name=\"Planilha1\" sheetId=\"1\" r:id=\"rId1\"/></sheets>"
            "<calcPr calcId=\"191029\"/>"
            "<extLst><ext uri=\"{140A7094-0E35-4892-8432-C4D2E57EDEB5}\" "
            "xmlns:x15=\"http://schemas.microsoft.com/office/spreadsheetml/2010/11/main\">"
            "<x15:workbookPr chartTrackingRefBase=\"1\"/></ext></extLst></workbook>");
    parts.emplace_back("xl/_rels/workbook.xml.rels",
                       declaration + "<Relationships xmlns=\"" + kPackageRelationships + "\">"
                                     "<Relationship Id=\"rId3\" Type=\"" + kRelationshipTypes +
                           "styles\" Target=\"styles.xml\"/>"
                           "<Relationship Id=\"rId1\" Type=\"" + kRelationshipTypes +
                           "worksheet\" Target=\"worksheets/sheet1.xml\"/>"
                           "<Relationship Id=\"rId2\" Type=\"" + kRelationshipTypes +
                           "worksheet\" Target=\"worksheets/sheet2.xml\"/>"
                           "<Relationship Id=\"rId4\" Type=\"" + kRelationshipTypes +
                           "sharedStrings\" Target=\"sharedStrings.xml\"/></Relationships>");
    // A aba a vista: nao e a primeira do workbook, fica de fora.
    parts.emplace_back(
        "xl/worksheets/sheet1.xml",
        declaration + kExcelWorksheet +
            "<dimension ref=\"A1:B2\"/><sheetViews><sheetView tabSelected=\"1\" workbookViewId=\"0\"/></sheetViews>"
            "<sheetFormatPr defaultRowHeight=\"15\" x14ac:dyDescent=\"0.25\"/><sheetData>"
            "<row r=\"1\" spans=\"1:2\" x14ac:dyDescent=\"0.25\"><c r=\"A1\" t=\"s\"><v>0</v></c>"
            "<c r=\"B1\" t=\"s\"><v>1</v></c></row>"
            "<row r=\"2\" spans=\"1:2\" x14ac:dyDescent=\"0.25\"><c r=\"A2\" t=\"s\"><v>10</v></c>"
            "<c r=\"B2\"><v>3001</v></c></row>"
            "</sheetData>" + kExcelPageMargins + "</worksheet>");
    // A aba "Contatos", escondida.
    parts.emplace_back(
        "xl/worksheets/sheet2.xml",
        declaration + kExcelWorksheet +
            "<dimension ref=\"A1:C6\"/><sheetViews><sheetView workbookViewId=\"0\">"
            "<selection activeCell=\"B3\" sqref=\"B3\"/></sheetView></sheetViews>"
            "<sheetFormatPr defaultRowHeight=\"15\" x14ac:dyDescent=\"0.25\"/>"
            "<cols><col min=\"1\" max=\"1\" width=\"22.7109375\" customWidth=\"1\"/>"
            "<col min=\"2\" max=\"2\" width=\"16.140625\" bestFit=\"1\" customWidth=\"1\"/></cols><sheetData>"
            "<row r=\"1\" spans=\"1:3\" x14ac:dyDescent=\"0.25\"><c r=\"A1\" s=\"1\" t=\"s\"><v>0</v></c>"
            "<c r=\"B1\" s=\"1\" t=\"s\"><v>1</v></c><c r=\"C1\" s=\"1\" t=\"s\"><v>2</v></c></row>"
            "<row r=\"2\" spans=\"1:3\" x14ac:dyDescent=\"0.25\"><c r=\"A2\" t=\"s\"><v>3</v></c>"
            "<c r=\"B2\" s=\"2\" t=\"s\"><v>4</v></c><c r=\"C2\" t=\"s\"><v>5</v></c></row>"
            "<row r=\"3\" spans=\"1:3\" x14ac:dyDescent=\"0.25\"><c r=\"A3\" t=\"s\"><v>6</v></c>"
            "<c r=\"B3\" t=\"str\"><f>CONCATENATE(\"11\",\"988887777\")</f><v>11988887777</v></c>"
            "<c r=\"C3\" s=\"1\"/></row>"
            "<row r=\"4\" spans=\"1:3\" x14ac:dyDescent=\"0.25\"><c r=\"A4\" t=\"s\"><v>7</v></c>"
            "<c r=\"B4\" s=\"3\"><f>2000+4</f><v>2004</v></c></row>"
            "<row r=\"5\" spans=\"1:3\" x14ac:dyDescent=\"0.25\"><c r=\"A5\" t=\"s\"><v>8</v></c>"
            "<c r=\"B5\" s=\"3\"><v>5511999998888</v></c><c r=\"C5\" t=\"s\"><v>9</v></c></row>"
            "<row r=\"6\" spans=\"1:3\" s=\"1\" customFormat=\"1\" x14ac:dyDescent=\"0.25\"><c r=\"A6\" s=\"1\"/></row>"
            "</sheetData>" + kExcelPageMargins + "</worksheet>");
    parts.emplace_back(
        "xl/styles.xml",
        declaration + "<styleSheet xmlns=\"" + kMainNamespace + "\">"
                      "<fonts count=\"2\"><font><sz val=\"11\"/><name val=\"Calibri\"/></font>"
                      "<font><b/><sz val=\"11\"/><name val=\"Calibri\"/></font></fonts>"
                      "<fills count=\"1\"><fill><patternFill patternType=\"none\"/></fill></fills>"
                      "<borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders>"
                      "<cellXfs count=\"4\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/>"
                      "<xf numFmtId=\"0\" fontId=\"1\" fillId=\"0\" borderId=\"0\" applyFont=\"1\"/>"
                      "<xf numFmtId=\"49\" fontId=\"0\" fillId=\"0\" borderId=\"0\" applyNumberFormat=\"1\"/>"
                      "<xf numFmtId=\"1\" fontId=\"0\" fillId=\"0\" borderId=\"0\" applyNumberFormat=\"1\"/></cellXfs>"
                      "</styleSheet>");
    const std::string run = "<rPr><sz val=\"11\"/><color theme=\"1\"/><rFont val=\"Calibri\"/><family val=\"2\"/>"
                            "<scheme val=\"minor\"/></rPr>";
    parts.emplace_back(
        "xl/sharedStrings.xml",
        declaration + "<sst xmlns=\"" + kMainNamespace + "\" count=\"13\" uniqueCount=\"11\">"
                      "<si><t>Nome</t></si><si><t>Telefone</t></si><si><t>Observa\xc3\xa7\xc3\xa3o</t></si>"
                      "<si><r><rPr><b/><sz val=\"11\"/><color theme=\"1\"/><rFont val=\"Calibri\"/><family val=\"2\"/>"
                      "<scheme val=\"minor\"/></rPr><t>Ana</t></r><r>" + run +
            "<t xml:space=\"preserve\"> Souza</t></r></si>"
            "<si><t>011987654321</t></si><si><t>Cliente &amp; parceira</t></si>"
            "<si><t>Jo\xc3\xa3o</t></si><si><t>Caio</t></si><si><t>Dora</t></si>"
            "<si><t>Ger\xc3\xaancia</t></si><si><t>Outra Pessoa</t></si></sst>");
    return Zip(parts);
}

// A parte do .xlsx descompactada; vazia se o zip nao a tem.
std::string XlsxPart(const std::string& xlsx, const char* name) {
    mz_zip_archive zip;
    mz_zip_zero_struct(&zip);
    REQUIRE(mz_zip_reader_init_mem(&zip, xlsx.data(), xlsx.size(), 0));
    size_t size = 0;
    void* data = mz_zip_reader_extract_file_to_heap(&zip, name, &size, 0);
    const std::string part = data ? std::string(static_cast<const char*>(data), size) : std::string();
    mz_free(data);
    mz_zip_reader_end(&zip);
    return part;
}

// Os nomes das partes do zip, na ordem em que foram gravadas.
std::vector<std::string> PartNames(const std::string& xlsx) {
    mz_zip_archive zip;
    mz_zip_zero_struct(&zip);
    REQUIRE(mz_zip_reader_init_mem(&zip, xlsx.data(), xlsx.size(), 0));
    std::vector<std::string> names;
    for (mz_uint i = 0; i < mz_zip_reader_get_num_files(&zip); ++i) {
        mz_zip_archive_file_stat stat;
        REQUIRE(mz_zip_reader_file_stat(&zip, i, &stat));
        names.push_back(stat.m_filename);
    }
    mz_zip_reader_end(&zip);
    return names;
}

// Quantas vezes o trecho aparece no texto.
size_t Count(const std::string& text, const std::string& piece) {
    size_t count = 0;
    for (size_t at = text.find(piece); at != std::string::npos; at = text.find(piece, at + piece.size())) ++count;
    return count;
}

// A lista do exportar com o que costuma estragar: o zero da frente, o numero com parenteses, a observacao vazia, o
// acento e a quebra de linha na observacao.
std::vector<SheetContact> ExportedList() {
    return {{L"Ana Souza", "2002", L"cliente"},
            {L"Jo\u00e3o", "(11) 5060-3000", L""},
            {L"Z\u00e9", "011987654321", L"linha1\nlinha2"}};
}

// A primeira linha do CSV exportado: o BOM do UTF-8 e o cabecalho Nome, Numero, Observacao (com acento, em UTF-8).
const char kCsvHeader[] = "\xef\xbb\xbfNome;N\xc3\xbamero;Observa\xc3\xa7\xc3\xa3o\r\n";

}  // namespace

// ---------------------------------------------------------------- CSV

TEST_CASE("a comma separated csv reads the name, the number and the note") {
    const SheetRead read =
        ReadContactSheet("Nome,N\xc3\xbamero,Observa\xc3\xa7\xc3\xa3o\r\nAna Souza,2002,cliente\r\n");
    CHECK(read.error == SheetError::None);
    CHECK(Contacts(read) == std::vector<std::wstring>{L"Ana Souza|2002|cliente"});
}

TEST_CASE("a semicolon csv in Windows-1252 reads the accents") {
    const SheetRead read = ReadContactSheet("Nome;Telefone\r\nJo\xe3o;(11) 5060-3000\r\n");
    CHECK(read.error == SheetError::None);
    CHECK(Contacts(read) == std::vector<std::wstring>{L"Jo\u00e3o|(11) 5060-3000|"});
    REQUIRE(read.contacts.size() == 1);
    // O numero fica como foi escrito (UTF-8).
    CHECK(read.contacts[0].number == "(11) 5060-3000");
}

TEST_CASE("a utf-8 csv with the bom and tabs reads as contacts") {
    const SheetRead read = ReadContactSheet("\xef\xbb\xbfnome\ttelefone\nCarlos\t11988887777\n");
    CHECK(read.error == SheetError::None);
    CHECK(Contacts(read) == std::vector<std::wstring>{L"Carlos|11988887777|"});
}

TEST_CASE("quoted csv fields keep the separator, the quotes and the line breaks") {
    const SheetRead read =
        ReadContactSheet("Nome;Numero;Obs\n\"Silva; Ana\";2003;\"diz \"\"oi\"\"\nsegunda linha\"\n");
    CHECK(read.error == SheetError::None);
    CHECK(Contacts(read) == std::vector<std::wstring>{L"Silva; Ana|2003|diz \"oi\"\nsegunda linha"});
    // A aspa no meio do campo e so uma letra.
    CHECK(Contacts(ReadContactSheet("Nome;Numero\nAna \"Bia\" Souza;2004\n")) ==
          std::vector<std::wstring>{L"Ana \"Bia\" Souza|2004|"});
}

TEST_CASE("blank lines and empty columns at the end are left out") {
    const SheetRead read = ReadContactSheet("Nome;Numero;;\r\n\r\nAna;2002;;\r\n;;;\r\n");
    CHECK(read.error == SheetError::None);
    CHECK(Contacts(read) == std::vector<std::wstring>{L"Ana|2002|"});
}

TEST_CASE("the csv exported by MicroSIP joins the first and last names and takes the mobile number") {
    const SheetRead read = ReadContactSheet(std::string("\xef\xbb\xbf") + kMicroSipHeader +
                                            ",,Ana,Souza,,11977776666,,,,,,obs,,,0,0,0\r\n"
                                            "Bruno Lima,2003,,,,,,,,,,,,,0,0,1\r\n"
                                            ",,,Costa,2004,,,,,,,,,,0,0,0\r\n");
    CHECK(read.error == SheetError::None);
    CHECK(Contacts(read) ==
          std::vector<std::wstring>{L"Ana Souza|11977776666|obs", L"Bruno Lima|2003|", L"Costa|2004|"});
}

TEST_CASE("a csv without a header is read from the first line when column B is a number") {
    SheetRead read = ReadContactSheet("Ana;2002\nBruno;2003\n");
    CHECK(read.error == SheetError::None);
    CHECK(Contacts(read) == std::vector<std::wstring>{L"Ana|2002|", L"Bruno|2003|"});

    // A coluna C e a observacao.
    read = ReadContactSheet("Ana;(11) 2002-3000;cliente\nBruno;2003\n");
    CHECK(read.error == SheetError::None);
    CHECK(Contacts(read) == std::vector<std::wstring>{L"Ana|(11) 2002-3000|cliente", L"Bruno|2003|"});
}

TEST_CASE("a csv without the columns and without a number in column B is unreadable") {
    const SheetRead read = ReadContactSheet("Ana;Bruno\nCarla;Davi\n");
    CHECK(read.error == SheetError::Unreadable);
    CHECK(read.contacts.empty());
    // Um digito so, ou uma letra junto, nao e numero.
    CHECK(ReadContactSheet("Ana;7\nBruno;8\n").error == SheetError::Unreadable);
    CHECK(ReadContactSheet("Ana;Ramal 2002\n").error == SheetError::Unreadable);
    // Sem separador, uma coluna so: nao ha coluna B.
    CHECK(ReadContactSheet("Nome\nAna\n").error == SheetError::Unreadable);
}

TEST_CASE("a row without a name or without a number is left out") {
    const SheetRead read = ReadContactSheet("Nome;Numero\n;2002\nAna;\nBia;---\nCaio;2004\n");
    CHECK(read.error == SheetError::None);
    CHECK(Contacts(read) == std::vector<std::wstring>{L"Caio|2004|"});
}

TEST_CASE("column names are compared without accents, case and spaces at the ends") {
    const SheetRead read =
        ReadContactSheet(" NOME ;\tTELEFONE\t; Observa\xc3\xa7\xc3\xa3o \n  Ana Souza  ;  (11) 2002-3000 ;  vip  \n");
    CHECK(read.error == SheetError::None);
    CHECK(Contacts(read) == std::vector<std::wstring>{L"Ana Souza|(11) 2002-3000|vip"});

    // Cada nome de coluna da spec (6.2), como ele aparece numa planilha.
    for (const char* title : {"Nome", "NAME", "Contato"}) {
        CAPTURE(title);
        CHECK(Contacts(ReadContactSheet(std::string(title) + ";Telefone\nAna;2002\n")) ==
              std::vector<std::wstring>{L"Ana|2002|"});
    }
    for (const char* title : {"N\xc3\xbamero", "Number", "Telefone", "Fone", "Ramal", "Celular", "Phone",
                              "Phone Number", "PRIMARY PHONE", "Mobile", "Mobile Number"}) {
        CAPTURE(title);
        CHECK(Contacts(ReadContactSheet("Nome;" + std::string(title) + "\nAna;2002\n")) ==
              std::vector<std::wstring>{L"Ana|2002|"});
    }
    for (const char* title : {"Observa\xc3\xa7\xc3\xa3o", "Obs", "Comment", "Notes", "Setor", "Departamento",
                              "Empresa"}) {
        CAPTURE(title);
        CHECK(Contacts(ReadContactSheet("Nome;Telefone;" + std::string(title) + "\nAna;2002;x\n")) ==
              std::vector<std::wstring>{L"Ana|2002|x"});
    }
    // O nome e a observacao repetidos: vale a coluna mais a esquerda.
    CHECK(Contacts(ReadContactSheet("Nome;Contato;Telefone;Obs;Setor\nAna;Bia;2002;x;y\n")) ==
          std::vector<std::wstring>{L"Ana|2002|x"});
}

TEST_CASE("with several number columns the first one with a number in the row is used") {
    const SheetRead read =
        ReadContactSheet("Nome;Telefone;Celular\nAna;;11977776666\nBia;2002;11966665555\nCaio;-;2004\n");
    CHECK(read.error == SheetError::None);
    CHECK(Contacts(read) == std::vector<std::wstring>{L"Ana|11977776666|", L"Bia|2002|", L"Caio|2004|"});
}

TEST_CASE("the separator is the one that appears most in the first line, outside the quotes") {
    // Fora das aspas, duas virgulas e nenhum ponto e virgula.
    CHECK(Contacts(ReadContactSheet("Nome,Telefone,\"Setor; filial; andar\"\nAna,2002,x\n")) ==
          std::vector<std::wstring>{L"Ana|2002|"});
    // Empate: o ponto e virgula ganha da virgula.
    CHECK(Contacts(ReadContactSheet("Nome;Telefone;a,b,c\nAna;2002;x,y\n")) ==
          std::vector<std::wstring>{L"Ana|2002|"});
    // As linhas em branco do comeco nao contam.
    CHECK(Contacts(ReadContactSheet("\r\n \r\nNome\tTelefone\r\nAna\t2002\r\n")) ==
          std::vector<std::wstring>{L"Ana|2002|"});
}

TEST_CASE("csv lines may end in CRLF, LF or CR, and the last one without a line break") {
    CHECK(Contacts(ReadContactSheet("Nome;Numero\rAna;2002\rBia;2003")) ==
          std::vector<std::wstring>{L"Ana|2002|", L"Bia|2003|"});
    CHECK(Contacts(ReadContactSheet("Nome;Numero\r\nAna;2002\nBia;2003\r")) ==
          std::vector<std::wstring>{L"Ana|2002|", L"Bia|2003|"});
}

TEST_CASE("a csv saved by a Portuguese Excel reads as contacts") {
    // O "Salvar como CSV" do Excel em portugues: Windows-1252 (com o euro, o travessao e as aspas curvas da faixa
    // 0x80-0x9F), ponto e virgula, CRLF e as colunas vazias no fim.
    const SheetRead read = ReadContactSheet(
        "Nome;Telefone;Observa\xe7\xe3o;;\r\n"
        "Jo\xe3o da Silva;(11) 5060-3000;Ger\xeancia;;\r\n"
        "Maria Ol\xedvia;11 98888-7777;\"Setor; vendas\";;\r\n"
        "Z\xe9 \x96 Caf\xe9;2002;\x93VIP\x94 \x80 10;;\r\n"
        ";;;;\r\n");
    CHECK(read.error == SheetError::None);
    CHECK(Contacts(read) == std::vector<std::wstring>{L"Jo\u00e3o da Silva|(11) 5060-3000|Ger\u00eancia",
                                                      L"Maria Ol\u00edvia|11 98888-7777|Setor; vendas",
                                                      L"Z\u00e9 \u2013 Caf\u00e9|2002|\u201cVIP\u201d \u20ac 10"});
}

TEST_CASE("a csv entirely in Windows-1252 reads as before even where two bytes look like utf-8") {
    // O CSV que o Excel grava (Windows-1252, sem o BOM), com o espaco que nao quebra (0xA0) de um texto colado da web,
    // de um e-mail ou do Word: o "JOSE" com o E agudo (0xC9) colado nele forma C9 A0, um UTF-8 bem formado (U+0260).
    // Uma sequencia dessas contra um byte solto (o 0xE3 de "Joao") nao e maioria, e o arquivo inteiro e Windows-1252.
    CHECK(Contacts(ReadContactSheet("Nome;Telefone\r\nJOS\xc9\xa0;2001\r\nJo\xe3o;2002\r\n")) ==
          std::vector<std::wstring>{L"JOS\u00c9|2001|", L"Jo\u00e3o|2002|"});
    // No meio da celula, o espaco que nao quebra fica, e o E agudo tambem.
    CHECK(Contacts(ReadContactSheet("Nome;Telefone\r\nJOS\xc9\xa0" "DA SILVA;2001\r\nJo\xe3o;2002\r\n")) ==
          std::vector<std::wstring>{L"JOS\u00c9\u00a0DA SILVA|2001|", L"Jo\u00e3o|2002|"});
    // O "IRMA" com o A til (0xC3) e o espaco que nao quebra, e o "ZE" entre as aspas curvas (C9 94).
    CHECK(Contacts(ReadContactSheet("Nome;Telefone\r\nIRM\xc3\xa0;2003\r\n\x93Z\xc9\x94;2004\r\nJo\xe3o;2002\r\n")) ==
          std::vector<std::wstring>{L"IRM\u00c3|2003|", L"\u201cZ\u00c9\u201d|2004|", L"Jo\u00e3o|2002|"});
}

TEST_CASE("a utf-8 csv with one byte outside utf-8 reads only that byte as Windows-1252") {
    // Uma linha colada de um arquivo em Windows-1252 (o 0xE9 do "Jose") num CSV em UTF-8: o arquivo inteiro virava
    // Windows-1252, e os nomes em UTF-8 eram importados com dois caracteres no lugar de cada acento. Com o BOM, ele e
    // lido uma sequencia por vez pelo BOM; sem o BOM, pela contagem (3 sequencias contra 1 byte solto).
    const std::string rows = "Concei\xc3\xa7\xc3\xa3o;2002\r\nJo\xc3\xa3o;2003\r\nJos\xe9;2004\r\n";
    std::string bytes;
    SUBCASE("with the bom") { bytes = "\xef\xbb\xbf" + rows; }
    SUBCASE("without the bom") { bytes = rows; }
    const SheetRead read = ReadContactSheet(bytes);
    CHECK(read.error == SheetError::None);
    CHECK(Contacts(read) ==
          std::vector<std::wstring>{L"Concei\u00e7\u00e3o|2002|", L"Jo\u00e3o|2003|", L"Jos\u00e9|2004|"});
}

TEST_CASE("a byte outside utf-8 inside a quoted csv field keeps the quotes, the separator and the utf-8 around it") {
    // O cabecalho em UTF-8 (o acento de "Observacao") poe as sequencias UTF-8 na frente, 5 contra 3 bytes soltos: o
    // arquivo e lido uma sequencia por vez, sem o BOM.
    const SheetRead read = ReadContactSheet("Nome;Telefone;Observa\xc3\xa7\xc3\xa3o\r\n"
                                            "\"Jo\xc3\xa3o\";2003;\"Ger\xc3\xaancia\"\r\n"
                                            "\"Jos\xe9 \"\"Z\xe9\"\"\";2004;\"caf\xe9; ch\xc3\xa1\"\r\n");
    CHECK(read.error == SheetError::None);
    CHECK(Contacts(read) == std::vector<std::wstring>{L"Jo\u00e3o|2003|Ger\u00eancia",
                                                      L"Jos\u00e9 \"Z\u00e9\"|2004|caf\u00e9; ch\u00e1"});
}

TEST_CASE("a csv sequence that is not well-formed utf-8 is read byte by byte as Windows-1252") {
    // Bem formada: sem a forma longa, sem os substitutos (U+D800 a U+DFFF) e sem passar de U+10FFFF. O UTF-8 de 4
    // bytes (o telefone, U+1F4DE) vale, e o 0xE9 perdido na mesma linha faz o arquivo ter os dois. Com o BOM, que
    // vale mais que a contagem: sem ele, a 1 sequencia contra os 14 bytes soltos faria o arquivo inteiro Windows-1252.
    const SheetRead read = ReadContactSheet("\xef\xbb\xbfNome;Telefone\r\n"
                                            "Jos\xe9 \xf0\x9f\x93\x9e;2001\r\n"
                                            "A\xc0\xa9;2002\r\n"           // a forma longa de 2 bytes
                                            "B\xe0\x80\xaf;2003\r\n"       // a forma longa de 3 bytes
                                            "C\xed\xa0\x80;2004\r\n"       // o substituto U+D800
                                            "D\xf4\x90\x80\x80;2005\r\n"   // acima de U+10FFFF
                                            "E\xc3;2006\r\n");             // a sequencia cortada
    CHECK(read.error == SheetError::None);
    CHECK(Contacts(read) == std::vector<std::wstring>{L"Jos\u00e9 \U0001F4DE|2001|", L"A\u00c0\u00a9|2002|",
                                                      L"B\u00e0\u20ac\u00af|2003|", L"C\u00ed\u00a0\u20ac|2004|",
                                                      L"D\u00f4\x90\u20ac\u20ac|2005|", L"E\u00c3|2006|"});
}

TEST_CASE("a sheet with only the header is an empty list, and a file without rows is unreadable") {
    SheetRead read = ReadContactSheet("Nome;Numero\r\n");
    CHECK(read.error == SheetError::None);
    CHECK(read.contacts.empty());
    read = ReadContactSheet("Nome;Numero");
    CHECK(read.error == SheetError::None);
    CHECK(read.contacts.empty());
    read = ReadContactSheet(Xlsx("<row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>Nome</t></is></c>"
                                 "<c r=\"B1\" t=\"inlineStr\"><is><t>Telefone</t></is></c></row>"));
    CHECK(read.error == SheetError::None);
    CHECK(read.contacts.empty());

    CHECK(ReadContactSheet("").error == SheetError::Unreadable);
    CHECK(ReadContactSheet("\r\n \r\n;;\r\n").error == SheetError::Unreadable);
    CHECK(ReadContactSheet(Xlsx("")).error == SheetError::Unreadable);
}

// ---------------------------------------------------------------- XLSX

TEST_CASE("an xlsx with shared strings, inline strings and rich text in pieces reads the whole text") {
    const SheetRead read = ReadContactSheet(Xlsx(
        "<row r=\"1\"><c r=\"A1\" t=\"s\"><v>0</v></c><c r=\"B1\" t=\"s\"><v>1</v></c>"
        "<c r=\"C1\" t=\"inlineStr\"><is><t>Observa\xc3\xa7\xc3\xa3o</t></is></c></row>"
        "<row r=\"2\"><c r=\"A2\" t=\"s\"><v>2</v></c><c r=\"B2\" t=\"inlineStr\"><is><t>2002</t></is></c>"
        "<c r=\"C2\" t=\"inlineStr\"><is><r><t>cliente</t></r><r><rPr><b/></rPr>"
        "<t xml:space=\"preserve\"> antigo</t></r></is></c></row>"
        "<row r=\"3\"><c r=\"A3\" t=\"s\"><v>3</v></c><c r=\"B3\" t=\"inlineStr\"><is><t>2003</t></is></c></row>"
        // O texto fonetico (<rPh>) nao e parte do texto da celula, no compartilhado e na celula.
        "<row r=\"4\"><c r=\"A4\" t=\"inlineStr\"><is><t>Caio</t><rPh sb=\"0\" eb=\"4\"><t>ka-i-o</t></rPh></is></c>"
        "<c r=\"B4\"><v>2004</v></c></row>",
        "<si><t>Nome</t></si><si><t>N\xc3\xbamero</t></si><si><r><t>Ana </t></r><r><t>Souza</t></r></si>"
        "<si><t>Bia</t><rPh sb=\"0\" eb=\"3\"><t>bi-a</t></rPh><phoneticPr fontId=\"1\"/></si>"));
    CHECK(read.error == SheetError::None);
    CHECK(Contacts(read) ==
          std::vector<std::wstring>{L"Ana Souza|2002|cliente antigo", L"Bia|2003|", L"Caio|2004|"});
}

TEST_CASE("a big number in an xlsx comes out without the scientific notation") {
    const SheetRead read = ReadContactSheet(Xlsx(
        "<row r=\"1\"><c r=\"A1\" t=\"s\"><v>0</v></c><c r=\"B1\" t=\"s\"><v>1</v></c></row>"
        "<row r=\"2\"><c r=\"A2\" t=\"s\"><v>2</v></c><c r=\"B2\"><v>11999998888</v></c></row>"
        "<row r=\"3\"><c r=\"A3\" t=\"s\"><v>3</v></c><c r=\"B3\"><v>1.1999998888E10</v></c></row>",
        "<si><t>Nome</t></si><si><t>Celular</t></si><si><t>Ana</t></si><si><t>Bia</t></si>"));
    CHECK(read.error == SheetError::None);
    CHECK(Contacts(read) == std::vector<std::wstring>{L"Ana|11999998888|", L"Bia|11999998888|"});
}

TEST_CASE("an integral number loses the exponent and the .0, and the other values stay as written") {
    // A observacao mostra os valores que nao sao inteiros: como estao no <v>.
    const SheetRead read = ReadContactSheet(Xlsx(
        "<row r=\"1\"><c r=\"A1\" t=\"s\"><v>0</v></c><c r=\"B1\" t=\"s\"><v>1</v></c>"
        "<c r=\"C1\" t=\"s\"><v>2</v></c></row>"
        "<row r=\"2\"><c r=\"A2\" t=\"s\"><v>3</v></c><c r=\"B2\"><v>2002.0</v></c><c r=\"C2\"><v>1.5</v></c></row>"
        "<row r=\"3\"><c r=\"A3\" t=\"s\"><v>4</v></c><c r=\"B3\"><v>1.23E2</v></c><c r=\"C3\"><v>1E-3</v></c></row>"
        "<row r=\"4\"><c r=\"A4\" t=\"s\"><v>5</v></c><c r=\"B4\" t=\"n\"><v>4E+3</v></c>"
        "<c r=\"C4\" t=\"b\"><v>1</v></c></row>"
        "<row r=\"5\"><c r=\"A5\" t=\"s\"><v>6</v></c><c r=\"B5\" t=\"str\"><f>\"20\"&amp;\"05\"</f><v>2005</v></c>"
        "<c r=\"C5\" t=\"d\"><v>2026-10-27T00:00:00</v></c></row>",
        "<si><t>Nome</t></si><si><t>Numero</t></si><si><t>Obs</t></si>"
        "<si><t>Ana</t></si><si><t>Bia</t></si><si><t>Caio</t></si><si><t>Dora</t></si>"));
    CHECK(read.error == SheetError::None);
    CHECK(Contacts(read) == std::vector<std::wstring>{L"Ana|2002|1.5", L"Bia|123|1E-3", L"Caio|4000|1",
                                                      L"Dora|2005|2026-10-27T00:00:00"});
}

TEST_CASE("an xlsx formula reads the value saved with it") {
    const SheetRead read = ReadContactSheet(Xlsx(
        "<row r=\"1\"><c r=\"A1\" t=\"s\"><v>0</v></c><c r=\"B1\" t=\"s\"><v>1</v></c></row>"
        "<row r=\"2\"><c r=\"A2\" t=\"s\"><v>2</v></c><c r=\"B2\"><f>A1</f><v>2002</v></c></row>",
        "<si><t>Nome</t></si><si><t>Ramal</t></si><si><t>Ana</t></si>"));
    CHECK(read.error == SheetError::None);
    CHECK(Contacts(read) == std::vector<std::wstring>{L"Ana|2002|"});
}

TEST_CASE("empty cells in an xlsx leave the next cells in the columns of their references") {
    const SheetRead read = ReadContactSheet(Xlsx(
        "<row r=\"1\"><c r=\"A1\" t=\"s\"><v>0</v></c><c r=\"B1\" t=\"s\"><v>1</v></c>"
        "<c r=\"C1\" t=\"s\"><v>2</v></c><c r=\"D1\" t=\"s\"><v>3</v></c></row>"
        // Sem a B2: a coluna B fica vazia, e a C e a observacao.
        "<row r=\"2\"><c r=\"A2\" t=\"s\"><v>4</v></c><c r=\"C2\" t=\"s\"><v>5</v></c>"
        "<c r=\"D2\"><v>11977776666</v></c></row>"
        // So o nome e a observacao: sem numero, fica de fora.
        "<row r=\"3\"><c r=\"A3\" t=\"s\"><v>6</v></c><c r=\"C3\"><v>2003</v></c></row>"
        // Sem a referencia, a celula vai para a coluna seguinte a da anterior.
        "<row r=\"4\"><c t=\"s\"><v>7</v></c><c><v>2004</v></c><c t=\"s\"><v>5</v></c></row>"
        "<row r=\"5\"><c r=\"A5\" t=\"s\"><v>8</v></c><c r=\"C5\" t=\"s\"><v>5</v></c><c><v>2005</v></c></row>"
        // As celulas fora de ordem ficam nas colunas delas.
        "<row r=\"6\"><c r=\"D6\"><v>2006</v></c><c r=\"A6\" t=\"s\"><v>9</v></c></row>",
        "<si><t>Nome</t></si><si><t>Telefone</t></si><si><t>Observa\xc3\xa7\xc3\xa3o</t></si><si><t>Celular</t></si>"
        "<si><t>Ana</t></si><si><t>cliente</t></si><si><t>Bruno</t></si><si><t>Caio</t></si><si><t>Dora</t></si>"
        "<si><t>Eva</t></si>"));
    CHECK(read.error == SheetError::None);
    CHECK(Contacts(read) == std::vector<std::wstring>{L"Ana|11977776666|cliente", L"Caio|2004|cliente",
                                                      L"Dora|2005|cliente", L"Eva|2006|"});
}

TEST_CASE("cells after the last Excel column are left out") {
    // A XFD (a coluna 16.384) e a ultima do Excel: o que vem depois dela fica de fora, como no Excel.
    const std::string toXfc(16382, ';');   // "Nome" na XFC, "Telefone" na XFD
    CHECK(Contacts(ReadContactSheet(toXfc + "Nome;Telefone\n" + toXfc + "Ana;2002\n")) ==
          std::vector<std::wstring>{L"Ana|2002|"});
    const std::string toXfd(16383, ';');   // "Nome" na XFD, "Telefone" depois dela
    CHECK(ReadContactSheet(toXfd + "Nome;Telefone\n" + toXfd + "Ana;2002\n").error == SheetError::Unreadable);

    const std::string name = "<row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>Nome</t></is></c>";
    const std::string ana = "<row r=\"2\"><c r=\"A2\" t=\"inlineStr\"><is><t>Ana</t></is></c>";
    CHECK(Contacts(ReadContactSheet(Xlsx(name + "<c r=\"XFD1\" t=\"inlineStr\"><is><t>Telefone</t></is></c></row>" +
                                         ana + "<c r=\"XFD2\"><v>2002</v></c></row>"))) ==
          std::vector<std::wstring>{L"Ana|2002|"});
    CHECK(ReadContactSheet(Xlsx(name + "<c r=\"XFE1\" t=\"inlineStr\"><is><t>Telefone</t></is></c></row>" + ana +
                                "<c r=\"XFE2\"><v>2002</v></c></row>"))
              .error == SheetError::Unreadable);
}

TEST_CASE("a number with a leading zero saved as text keeps the zero") {
    const SheetRead read = ReadContactSheet(Xlsx(
        "<row r=\"1\"><c r=\"A1\" t=\"s\"><v>0</v></c><c r=\"B1\" t=\"s\"><v>1</v></c></row>"
        "<row r=\"2\"><c r=\"A2\" t=\"s\"><v>2</v></c><c r=\"B2\" t=\"s\"><v>3</v></c></row>",
        "<si><t>Nome</t></si><si><t>Telefone</t></si><si><t>Ana</t></si><si><t>011987654321</t></si>"));
    CHECK(read.error == SheetError::None);
    CHECK(Contacts(read) == std::vector<std::wstring>{L"Ana|011987654321|"});
}

TEST_CASE("the first sheet of the workbook is read, even hidden and saved as sheet2.xml") {
    const std::string header = "<row r=\"1\"><c r=\"A1\" t=\"s\"><v>0</v></c><c r=\"B1\" t=\"s\"><v>1</v></c></row>";
    const SheetRead read = ReadContactSheet(Zip(XlsxParts(
        {{"Contatos", "sheet2.xml",
          header + "<row r=\"2\"><c r=\"A2\" t=\"s\"><v>2</v></c><c r=\"B2\"><v>2002</v></c></row>", true},
         {"Planilha1", "sheet1.xml",
          header + "<row r=\"2\"><c r=\"A2\" t=\"s\"><v>3</v></c><c r=\"B2\"><v>2003</v></c></row>", false}},
        "<si><t>Nome</t></si><si><t>Telefone</t></si><si><t>Ana</t></si><si><t>Bruno</t></si>")));
    CHECK(read.error == SheetError::None);
    CHECK(Contacts(read) == std::vector<std::wstring>{L"Ana|2002|"});
}

TEST_CASE("an xlsx saved by a Portuguese Excel reads as contacts") {
    const SheetRead read = ReadContactSheet(ExcelWorkbook());
    CHECK(read.error == SheetError::None);
    CHECK(Contacts(read) == std::vector<std::wstring>{L"Ana Souza|011987654321|Cliente & parceira",
                                                      L"Jo\u00e3o|11988887777|", L"Caio|2004|",
                                                      L"Dora|5511999998888|Ger\u00eancia"});
}

TEST_CASE("xml entities and character references are decoded") {
    const SheetRead read = ReadContactSheet(Xlsx(
        "<row r=\"1\"><c r=\"A1\" t=\"s\"><v>0</v></c><c r=\"B1\" t=\"s\"><v>1</v></c>"
        "<c r=\"C1\" t=\"s\"><v>2</v></c></row>"
        "<row r=\"2\"><c r=\"A2\" t=\"s\"><v>3</v></c><c r=\"B2\" t=\"inlineStr\"><is><t>&#50;&#x30;02</t></is></c>"
        "<c r=\"C2\" t=\"s\"><v>4</v></c></row>"
        "<row r=\"3\"><c r=\"A3\" t=\"inlineStr\"><is><t><![CDATA[Bia <Lima>]]></t></is></c>"
        "<c r=\"B3\"><v>2003</v></c></row>",
        "<si><t>Nome</t></si><si><t>Telefone</t></si><si><t>Obs</t></si><si><t>Ana &amp; Bia</t></si>"
        "<si><t>&lt;vip&gt; &quot;sim&quot; &apos;ok&apos; caf&#233; ma&#xE7;&#xe3; &#128222; &nbsp; a & b</t></si>"));
    CHECK(read.error == SheetError::None);
    CHECK(Contacts(read) ==
          std::vector<std::wstring>{
              L"Ana & Bia|2002|<vip> \"sim\" 'ok' caf\u00e9 ma\u00e7\u00e3 \U0001F4DE &nbsp; a & b",
              L"Bia <Lima>|2003|"});
}

// ---------------------------------------------------------------- Limites

TEST_CASE("more than 10000 contacts is too large") {
    std::string csv = "Nome;Numero\n";
    for (size_t i = 0; i < kSheetMaxContacts; ++i) {
        csv += "Contato " + std::to_string(i) + ";" + std::to_string(100000 + i) + "\n";
    }
    // As linhas que nao viram contato nao contam.
    csv += ";2002\nSem numero;\n";
    const SheetRead full = ReadContactSheet(csv);
    CHECK(full.error == SheetError::None);
    CHECK(full.contacts.size() == kSheetMaxContacts);

    csv += "Mais um;2002\n";
    const SheetRead over = ReadContactSheet(csv);
    CHECK(over.error == SheetError::TooLarge);
    CHECK(over.contacts.empty());
}

TEST_CASE("a file over 10 MB is too large") {
    std::string csv = "Nome;Numero\nAna;2002\n";
    csv.resize(kSheetMaxBytes, ' ');
    CHECK(ReadContactSheet(csv).error == SheetError::None);
    csv.push_back(' ');
    const SheetRead read = ReadContactSheet(csv);
    CHECK(read.error == SheetError::TooLarge);
    CHECK(read.contacts.empty());
}

TEST_CASE("an xlsx part over 50 MB uncompressed is too large") {
    // Zeros: o miniz comprime muito, e o .xlsx fica pequeno.
    const std::string zeros(kSheetMaxPartBytes + 1, '0');
    const std::string bytes =
        Zip(WithPart(XlsxParts({{"Contatos", "sheet1.xml", "", false}}, ""), "xl/worksheets/sheet1.xml",
                     zeros.c_str()),
            MZ_BEST_SPEED);
    CHECK(bytes.size() < kSheetMaxBytes);
    CHECK(ReadContactSheet(bytes).error == SheetError::TooLarge);
}

TEST_CASE("a big shared string used in many cells is too large") {
    // Um texto compartilhado de 1 MB em 60 celulas: o .xlsx e pequeno, mas o texto das celulas passa de 50 MB.
    std::string cells;
    for (int i = 0; i < 60; ++i) cells += "<c t=\"s\"><v>2</v></c>";
    const std::string bytes = Xlsx(
        "<row r=\"1\"><c r=\"A1\" t=\"s\"><v>0</v></c><c r=\"B1\" t=\"s\"><v>1</v></c></row><row r=\"2\">" + cells +
            "</row>",
        "<si><t>Nome</t></si><si><t>Telefone</t></si><si><t>" + std::string(1048576, 'x') + "</t></si>");
    CHECK(bytes.size() < kSheetMaxBytes);
    CHECK(ReadContactSheet(bytes).error == SheetError::TooLarge);
}

TEST_CASE("xml nested too deep or with too many attributes in one element is unreadable") {
    // O .xlsx usa uns 10 niveis e uns 20 atributos num elemento: o limite e 256 de cada.
    const auto sheet = [](size_t depth, size_t attributes) {
        std::string xml = "<worksheet";
        for (size_t i = 0; i < attributes; ++i) xml += " a" + std::to_string(i) + "=\"\"";
        xml += "><sheetData><row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>Nome</t></is></c>"
               "<c r=\"B1\" t=\"inlineStr\"><is><t>Telefone</t></is></c></row>"
               "<row r=\"2\"><c r=\"A2\" t=\"inlineStr\"><is><t>Ana</t></is></c><c r=\"B2\"><v>2002</v></c></row>"
               "</sheetData>";
        for (size_t i = 0; i < depth; ++i) xml += "<x>";
        for (size_t i = 0; i < depth; ++i) xml += "</x>";
        return xml + "</worksheet>";
    };
    const Parts parts = XlsxParts({{"Contatos", "sheet1.xml", "", false}}, "");
    const char* const part = "xl/worksheets/sheet1.xml";
    // A raiz e mais 255 niveis, e 256 atributos: ainda le.
    CHECK(ReadContactSheet(Zip(WithPart(parts, part, sheet(255, 256).c_str()))).contacts.size() == 1);
    CHECK(ReadContactSheet(Zip(WithPart(parts, part, sheet(256, 0).c_str()))).error == SheetError::Unreadable);
    CHECK(ReadContactSheet(Zip(WithPart(parts, part, sheet(0, 257).c_str()))).error == SheetError::Unreadable);
}

TEST_CASE("thousands of number columns do not multiply the work by the rows") {
    // Um cabecalho com 16.000 colunas de numero e 100.000 linhas so com o nome: cada linha olha so as celulas que tem.
    // Uma busca por coluna de numero em cada linha seriam 1,6 bilhao de buscas (dezenas de segundos), e a lista da
    // empresa e lida de novo a cada 15 minutos.
    std::string csv = "Nome";
    for (int i = 0; i < 16000; ++i) csv += ";Fone";
    csv += "\n";
    for (int i = 0; i < 100000; ++i) csv += "a\n";
    // A primeira coluna de numero com um numero, da esquerda para a direita, continua valendo.
    csv += "Caio;2004" + std::string(15998, ';') + "2005\n";
    csv += "Bia" + std::string(15999, ';') + "-;2002;2003\n";
    const auto start = std::chrono::steady_clock::now();
    const SheetRead read = ReadContactSheet(csv);
    const double seconds = std::chrono::duration<double>(std::chrono::steady_clock::now() - start).count();
    CHECK(read.error == SheetError::None);
    CHECK(Contacts(read) == std::vector<std::wstring>{L"Caio|2004|", L"Bia|2002|"});
    CHECK(seconds < 2.0);
}

TEST_CASE("a column repeated in an xlsx row counts only its first cell") {
    // Um .xlsx estragado, com duas celulas na coluna B: vale a primeira, como no nome e na observacao.
    const SheetRead read = ReadContactSheet(Xlsx(
        "<row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>Nome</t></is></c>"
        "<c r=\"B1\" t=\"inlineStr\"><is><t>Telefone</t></is></c>"
        "<c r=\"C1\" t=\"inlineStr\"><is><t>Celular</t></is></c></row>"
        "<row r=\"2\"><c r=\"A2\" t=\"inlineStr\"><is><t>Ana</t></is></c>"
        "<c r=\"B2\" t=\"inlineStr\"><is><t>-</t></is></c><c r=\"B2\"><v>2002</v></c>"
        "<c r=\"C2\"><v>3003</v></c></row>"));
    CHECK(read.error == SheetError::None);
    CHECK(Contacts(read) == std::vector<std::wstring>{L"Ana|3003|"});
}

// ---------------------------------------------------------------- O que nao e planilha

TEST_CASE("bytes that are not a sheet are unreadable") {
    CHECK(ReadContactSheet("PK").error == SheetError::Unreadable);
    CHECK(ReadContactSheet("PK isto nao e um zip, so parece").error == SheetError::Unreadable);
    CHECK(ReadContactSheet("PK\x03\x04 lixo").error == SheetError::Unreadable);

    const Parts parts = XlsxParts(
        {{"Contatos", "sheet1.xml",
          "<row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>Nome</t></is></c>"
          "<c r=\"B1\" t=\"inlineStr\"><is><t>Telefone</t></is></c></row>"
          "<row r=\"2\"><c r=\"A2\" t=\"inlineStr\"><is><t>Ana</t></is></c><c r=\"B2\"><v>2002</v></c></row>",
          false}},
        "");
    REQUIRE(ReadContactSheet(Zip(parts)).contacts.size() == 1);
    // Um zip que nao e um .xlsx: sem o workbook.xml, ou sem a aba que ele aponta.
    CHECK(ReadContactSheet(Zip(WithPart(parts, "xl/workbook.xml", nullptr))).error == SheetError::Unreadable);
    CHECK(ReadContactSheet(Zip(WithPart(parts, "xl/worksheets/sheet1.xml", nullptr))).error ==
          SheetError::Unreadable);
    CHECK(ReadContactSheet(Zip({{"word/document.xml", "<w:document/>"}})).error == SheetError::Unreadable);
    // O XML estragado.
    CHECK(ReadContactSheet(Zip(WithPart(parts, "xl/worksheets/sheet1.xml",
                                        "<worksheet><sheetData><row r=\"1\"><c r=\"A1\""))).error ==
          SheetError::Unreadable);
    CHECK(ReadContactSheet(Zip(WithPart(parts, "xl/worksheets/sheet1.xml",
                                        "<worksheet><sheetData><row></sheetData></worksheet>"))).error ==
          SheetError::Unreadable);
    CHECK(ReadContactSheet(Zip(WithPart(parts, "xl/workbook.xml", "<workbook><sheets></workbook>"))).error ==
          SheetError::Unreadable);
    // Um fim que nao fecha o elemento aberto, mesmo com as contas certas no fim.
    CHECK(ReadContactSheet(Zip(WithPart(parts, "xl/worksheets/sheet1.xml",
                                        "<worksheet><sheetData><row r=\"1\">"
                                        "<c r=\"A1\" t=\"inlineStr\"><is><t>Nome</t></is></c>"
                                        "<c r=\"B1\" t=\"inlineStr\"><is><t>Telefone</t></is></c></row>"
                                        "<row r=\"2\"><c r=\"A2\" t=\"inlineStr\"><is><t>Ana</t></is></c>"
                                        "<c r=\"B2\"><v>2002</v></x></row></sheetData></worksheet>"))).error ==
          SheetError::Unreadable);

    // A pagina HTML (o Google ou a Microsoft pedindo login), mesmo quando a primeira linha pareceria uma linha sem
    // cabecalho.
    CHECK(ReadContactSheet("<!DOCTYPE html><html><head><title>Fazer login</title></head><body>\xe2\x80\xa6").error ==
          SheetError::Unreadable);
    CHECK(ReadContactSheet("\xef\xbb\xbf\r\n  <HTML lang=\"pt-BR\">;2002\nAna;2003\n").error ==
          SheetError::Unreadable);
}

// ---------------------------------------------------------------- O exportar (spec 4.3)

TEST_CASE("the exported csv opens in columns in a Portuguese Excel") {
    // O BOM do UTF-8, o ponto e virgula, o CRLF e o cabecalho Nome, Numero, Observacao.
    const std::string header = "\xef\xbb\xbfNome;N\xc3\xbamero;Observa\xc3\xa7\xc3\xa3o\r\n";
    const std::vector<SheetContact> list = {{L"Silva; Ana", "011 2002", L"diz \"oi\""}};
    const std::string csv = WriteContactsCsv(list);
    CHECK(csv.compare(0, header.size(), header) == 0);
    // O que tem ponto e virgula, aspas, CR ou LF vai entre aspas, e a aspa de dentro vira duas.
    CHECK(csv == header + "\"Silva; Ana\";011 2002;\"diz \"\"oi\"\"\"\r\n");
}

TEST_CASE("the exported csv quotes only the text with a semicolon, a quote or a line break") {
    const std::vector<SheetContact> list = {{L"Silva, Ana", "(11) 5060-3000", L"d'\u00e1gua"},
                                            {L"Bia;Lima", "2003", L""},
                                            {L"Caio", "2004", L"linha1\nlinha2"},
                                            {L"Dora", "2005", L"linha1\r\nlinha2"},
                                            {L"Eva", "2006", L"um\rdois"},
                                            {L"Jo\u00e3o \"Z\"", "2007", L"\"\""},
                                            {L"Fabio", "2008;3", L"x"}};
    const std::string csv = WriteContactsCsv(list);
    CHECK(csv == kCsvHeader + std::string("Silva, Ana;(11) 5060-3000;d'\xc3\xa1gua\r\n"
                                          "\"Bia;Lima\";2003;\r\n"
                                          "Caio;2004;\"linha1\nlinha2\"\r\n"
                                          "Dora;2005;\"linha1\r\nlinha2\"\r\n"
                                          "Eva;2006;\"um\rdois\"\r\n"
                                          "\"Jo\xc3\xa3o \"\"Z\"\"\";2007;\"\"\"\"\"\"\r\n"
                                          "Fabio;\"2008;3\";x\r\n"));
    // O leitor le tudo de volta como os mesmos contatos, com as aspas e as quebras de linha.
    const SheetRead read = ReadContactSheet(csv);
    CHECK(read.error == SheetError::None);
    CHECK(Contacts(read) == Contacts(list));
}

TEST_CASE("the exported xlsx and csv read back as the same contacts") {
    const std::vector<SheetContact> list = ExportedList();
    const std::string xlsx = WriteContactsXlsx(list);
    const std::string csv = WriteContactsCsv(list);
    REQUIRE_FALSE(xlsx.empty());
    REQUIRE_FALSE(csv.empty());
    const auto readsBack = [&](const char* format, const std::string& bytes) {
        CAPTURE(format);
        const SheetRead read = ReadContactSheet(bytes);
        CHECK(read.error == SheetError::None);
        CHECK(Contacts(read) == Contacts(list));
        // O numero volta como foi escrito, com o zero da frente, e a observacao vazia volta vazia.
        REQUIRE(read.contacts.size() == 3);
        CHECK(read.contacts[1].number == "(11) 5060-3000");
        CHECK(read.contacts[1].note.empty());
        CHECK(read.contacts[2].number == "011987654321");
        CHECK(read.contacts[2].note == L"linha1\nlinha2");
    };
    readsBack("xlsx", xlsx);
    readsBack("csv", csv);
}

TEST_CASE("the exported xlsx keeps numbers as text") {
    const std::string sheet = XlsxPart(WriteContactsXlsx(ExportedList()), "xl/worksheets/sheet1.xml");
    REQUIRE_FALSE(sheet.empty());
    // Toda celula e texto na propria celula (t="inlineStr"), e nenhuma guarda um valor (<v>: numero ou texto
    // compartilhado): o Excel nao mostra o numero em notacao cientifica nem tira o zero da frente.
    CHECK(Count(sheet, "<c ") == 11);
    CHECK(Count(sheet, " t=\"inlineStr\"") == 11);
    CHECK(sheet.find("<v") == std::string::npos);
    // Cada linha leva o numero dela (r="N") e cada celula, a referencia dela (A1, B1, C1...).
    CHECK(Count(sheet, "<row ") == 4);
    CHECK(sheet.find("<row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t xml:space=\"preserve\">Nome</t></is></c>"
                     "<c r=\"B1\" t=\"inlineStr\"><is><t xml:space=\"preserve\">N\xc3\xbamero</t></is></c>"
                     "<c r=\"C1\" t=\"inlineStr\"><is><t xml:space=\"preserve\">Observa\xc3\xa7\xc3\xa3o</t></is></c>"
                     "</row>") != std::string::npos);
    CHECK(sheet.find("<row r=\"4\"><c r=\"A4\" t=\"inlineStr\"><is><t xml:space=\"preserve\">Z\xc3\xa9</t></is></c>"
                     "<c r=\"B4\" t=\"inlineStr\"><is><t xml:space=\"preserve\">011987654321</t></is></c>"
                     "<c r=\"C4\" t=\"inlineStr\"><is><t xml:space=\"preserve\">linha1\nlinha2</t></is></c></row>") !=
          std::string::npos);
    // A celula sem texto (a observacao do Joao) nao e escrita: fica em branco de verdade no Excel.
    CHECK(sheet.find("r=\"C3\"") == std::string::npos);
    CHECK(sheet.find("<row r=\"3\"><c r=\"A3\" t=\"inlineStr\"><is><t xml:space=\"preserve\">Jo\xc3\xa3o</t></is></c>"
                     "<c r=\"B3\" t=\"inlineStr\"><is><t xml:space=\"preserve\">(11) 5060-3000</t></is></c></row>") !=
          std::string::npos);
}

TEST_CASE("an empty list exports only the header") {
    const std::vector<SheetContact> none;
    const std::string csv = WriteContactsCsv(none);
    CHECK(csv == kCsvHeader);
    const std::string xlsx = WriteContactsXlsx(none);
    REQUIRE_FALSE(xlsx.empty());
    const std::string sheet = XlsxPart(xlsx, "xl/worksheets/sheet1.xml");
    CHECK(Count(sheet, "<row ") == 1);
    CHECK(Count(sheet, "<c ") == 3);
    CHECK(sheet.find("<row r=\"1\">") != std::string::npos);
    // Uma planilha so com o cabecalho e uma lista vazia valida, nos dois formatos.
    for (const std::string& bytes : {csv, xlsx}) {
        const SheetRead read = ReadContactSheet(bytes);
        CHECK(read.error == SheetError::None);
        CHECK(read.contacts.empty());
    }
}

TEST_CASE("the exported xlsx has the parts Excel needs and one sheet named Contatos") {
    const std::string xlsx = WriteContactsXlsx(ExportedList());
    const std::vector<std::string> names = PartNames(xlsx);
    CHECK(names.size() == 5);
    for (const char* part : {"[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels",
                             "xl/worksheets/sheet1.xml"}) {
        CAPTURE(part);
        CHECK(std::find(names.begin(), names.end(), part) != names.end());
        // Cada parte e um XML em UTF-8, com a declaracao.
        CHECK(XlsxPart(xlsx, part).rfind("<?xml version=\"1.0\" encoding=\"UTF-8\"", 0) == 0);
    }
    // Os tipos que o Excel confere: o workbook e a aba.
    const std::string types = XlsxPart(xlsx, "[Content_Types].xml");
    CHECK(types.find("<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package."
                     "relationships+xml\"/>") != std::string::npos);
    CHECK(types.find("<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-"
                     "officedocument.spreadsheetml.sheet.main+xml\"/>") != std::string::npos);
    CHECK(types.find("<Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-"
                     "officedocument.spreadsheetml.worksheet+xml\"/>") != std::string::npos);
    // A raiz do pacote aponta para o workbook; o workbook, para a aba "Contatos"; e o .rels dele, para a parte da aba.
    CHECK(XlsxPart(xlsx, "_rels/.rels")
              .find("<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/"
                    "relationships/officeDocument\" Target=\"xl/workbook.xml\"/>") != std::string::npos);
    const std::string workbook = XlsxPart(xlsx, "xl/workbook.xml");
    CHECK(Count(workbook, "<sheet ") == 1);
    CHECK(workbook.find("<sheet name=\"Contatos\" sheetId=\"1\" r:id=\"rId1\"/>") != std::string::npos);
    CHECK(XlsxPart(xlsx, "xl/_rels/workbook.xml.rels")
              .find("<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/"
                    "relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>") != std::string::npos);
}

TEST_CASE("the exported xlsx escapes the markup and keeps the spaces and the line breaks") {
    const std::vector<SheetContact> list = {{L"  Ana & Bia <vip>  ", "2002 & <3>", L"\nx > y ]]> z\n"}};
    const std::string xlsx = WriteContactsXlsx(list);
    const std::string sheet = XlsxPart(xlsx, "xl/worksheets/sheet1.xml");
    CHECK(sheet.find("<t xml:space=\"preserve\">  Ana &amp; Bia &lt;vip&gt;  </t>") != std::string::npos);
    CHECK(sheet.find("<t xml:space=\"preserve\">2002 &amp; &lt;3&gt;</t>") != std::string::npos);
    CHECK(sheet.find("<t xml:space=\"preserve\">\nx &gt; y ]]&gt; z\n</t>") != std::string::npos);
    // Todo <t> leva o xml:space="preserve": os espacos e as quebras das pontas ficam no arquivo.
    CHECK(Count(sheet, "<t>") == 0);
    CHECK(Count(sheet, "<t xml:space=\"preserve\">") == Count(sheet, "<c "));
    // O leitor tira os espacos e as quebras das pontas (spec 6.2), e o resto volta igual.
    const SheetRead read = ReadContactSheet(xlsx);
    CHECK(read.error == SheetError::None);
    CHECK(Contacts(read) == std::vector<std::wstring>{L"Ana & Bia <vip>|2002 & <3>|x > y ]]> z"});
}

TEST_CASE("an xlsx cell loses a control character that XML cannot carry, and the csv keeps the text") {
    const std::vector<SheetContact> list = {{L"Ana", "2002", L"cliente\x01 antigo"}};
    const std::string xlsx = WriteContactsXlsx(list);
    const SheetRead read = ReadContactSheet(xlsx);
    CHECK(read.error == SheetError::None);
    CHECK(Contacts(read) == std::vector<std::wstring>{L"Ana|2002|cliente antigo"});
    // No CSV o texto vai como esta.
    const std::string csv = WriteContactsCsv(list);
    CHECK(csv.find("cliente\x01 antigo") != std::string::npos);
    CHECK(Contacts(ReadContactSheet(csv)) == Contacts(list));
}

TEST_CASE("the exported xlsx drops every character XML 1.0 forbids and keeps the TAB, the LF and the CR") {
    // U+0000 a U+0008, U+000B, U+000C, U+000E a U+001F, U+FFFE e U+FFFF: o Excel nao abre a planilha que tem um deles.
    std::wstring forbidden;
    for (wchar_t ch = 0; ch < 0x20; ++ch) {
        if (ch != L'\t' && ch != L'\n' && ch != L'\r') forbidden.push_back(ch);
    }
    forbidden.push_back(static_cast<wchar_t>(0xFFFE));
    forbidden.push_back(static_cast<wchar_t>(0xFFFF));
    const std::vector<SheetContact> list = {{L"Ana" + forbidden + L" Souza", "20" + WideToUtf8(forbidden) + "02",
                                             L"a" + forbidden + L"b\tc\nd\re" + forbidden}};
    const std::string xlsx = WriteContactsXlsx(list);
    const std::string sheet = XlsxPart(xlsx, "xl/worksheets/sheet1.xml");
    REQUIRE_FALSE(sheet.empty());
    // Na aba toda: nenhum caractere de controle fora o TAB e o LF (o CR vai como &#13;, porque um XML le o CR solto
    // como LF), e nem U+FFFE nem U+FFFF (EF BF BE e EF BF BF em UTF-8).
    const bool clean = std::all_of(sheet.begin(), sheet.end(), [](char ch) {
        const unsigned char byte = static_cast<unsigned char>(ch);
        return byte >= 0x20 || byte == '\t' || byte == '\n';
    });
    CHECK(clean);
    CHECK(sheet.find("\xef\xbf\xbe") == std::string::npos);
    CHECK(sheet.find("\xef\xbf\xbf") == std::string::npos);
    CHECK(sheet.find("b\tc\nd&#13;e") != std::string::npos);
    // O resto do texto volta intacto: o TAB, o LF e o CR no meio da observacao (as pontas o leitor tira).
    const SheetRead read = ReadContactSheet(xlsx);
    CHECK(read.error == SheetError::None);
    CHECK(Contacts(read) == std::vector<std::wstring>{L"Ana Souza|2002|ab\tc\nd\re"});
}

TEST_CASE("the exported files carry accents and characters outside the basic plane as UTF-8") {
    const std::vector<SheetContact> list = {
        {L"Jos\u00e9 \U0001F4DE", "+55 11 98888-7777", L"Ger\u00eancia \u2013 caf\u00e9 \u20ac"}};
    const std::string xlsx = WriteContactsXlsx(list);
    const std::string csv = WriteContactsCsv(list);
    CHECK(csv == kCsvHeader + std::string("Jos\xc3\xa9 \xf0\x9f\x93\x9e;+55 11 98888-7777;"
                                          "Ger\xc3\xaancia \xe2\x80\x93 caf\xc3\xa9 \xe2\x82\xac\r\n"));
    const std::string sheet = XlsxPart(xlsx, "xl/worksheets/sheet1.xml");
    CHECK(sheet.find("<t xml:space=\"preserve\">Jos\xc3\xa9 \xf0\x9f\x93\x9e</t>") != std::string::npos);
    for (const std::string& bytes : {xlsx, csv}) {
        const SheetRead read = ReadContactSheet(bytes);
        CHECK(read.error == SheetError::None);
        CHECK(Contacts(read) == Contacts(list));
    }
}

TEST_CASE("an export with the most contacts a sheet can have reads back whole in both formats") {
    std::vector<SheetContact> list;
    for (size_t i = 0; i < kSheetMaxContacts; ++i) {
        list.push_back(SheetContact{L"Contato " + std::to_wstring(i), std::to_string(100000 + i),
                                    i % 2 == 0 ? L"nota; " + std::to_wstring(i) : std::wstring()});
    }
    const std::vector<std::wstring> expected = Contacts(list);
    for (const std::string& bytes : {WriteContactsXlsx(list), WriteContactsCsv(list)}) {
        REQUIRE_FALSE(bytes.empty());
        const SheetRead read = ReadContactSheet(bytes);
        CHECK(read.error == SheetError::None);
        CHECK(read.contacts.size() == kSheetMaxContacts);
        const bool same = Contacts(read) == expected;
        CHECK(same);
    }
}
