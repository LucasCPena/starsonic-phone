// Testes da leitura das planilhas de contatos (starsonic/desktop/Planilha.h; spec da rc.4, secao 6). Os .xlsx sao
// montados aqui, na memoria, com o escritor de zip do miniz, so com as partes que a leitura usa ([Content_Types].xml,
// xl/workbook.xml, xl/_rels/workbook.xml.rels, as abas e o sharedStrings); o "gravado pelo Excel" tem tambem as partes
// e os atributos que o Excel em portugues grava.
#include <chrono>
#include <string>
#include <utility>
#include <vector>

#include "Planilha.h"
#include "Text.h"
#include "test_support.h"
// Por ultimo: o miniz.h define os nomes do zlib (compress, crc32, Byte...) para o resto do arquivo.
#include "miniz/miniz.h"

using namespace starsonic;

namespace {

// Os contatos lidos, um por texto: "nome|numero|observacao".
std::vector<std::wstring> Contacts(const SheetRead& read) {
    std::vector<std::wstring> rows;
    for (const SheetContact& contact : read.contacts) {
        rows.push_back(contact.name + L"|" + Utf8ToWide(contact.number) + L"|" + contact.note);
    }
    return rows;
}

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
