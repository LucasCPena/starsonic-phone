#include "Planilha.h"

#include <string>
#include <vector>

#include "Text.h"
// Os nomes do zlib (compress, crc32, Byte...) ficam desligados no CMake (MINIZ_NO_ZLIB_COMPATIBLE_NAMES): do miniz.h
// so valem os nomes mz_.
#include "miniz/miniz.h"

// A escrita do exportar (spec da rc.4, secao 4.3). A leitura dos mesmos arquivos e a do Planilha.cpp.

namespace starsonic {

namespace {

// O cabecalho dos dois formatos (UTF-8): Nome, Numero, Observacao.
const char* const kHeader[3] = {"Nome", "N\xc3\xbamero", "Observa\xc3\xa7\xc3\xa3o"};

// ---------------------------------------------------------------- CSV

// Um campo do CSV: entre aspas quando o texto tem ponto e virgula, aspas, CR ou LF (a aspa de dentro vira duas); senao,
// como esta. O texto nunca muda.
std::string CsvField(const std::string& text) {
    if (text.find_first_of(";\"\r\n") == std::string::npos) return text;
    std::string quoted = "\"";
    for (const char ch : text) {
        if (ch == '"') quoted.push_back('"');
        quoted.push_back(ch);
    }
    quoted.push_back('"');
    return quoted;
}

void AppendCsvRow(std::string& csv, const std::string& name, const std::string& number, const std::string& note) {
    csv += CsvField(name);
    csv += ';';
    csv += CsvField(number);
    csv += ';';
    csv += CsvField(note);
    csv += "\r\n";
}

std::string BuildCsv(const std::vector<SheetContact>& contacts) {
    std::string csv = "\xef\xbb\xbf";   // o BOM do UTF-8: sem ele o Excel em portugues le o arquivo como Windows-1252
    AppendCsvRow(csv, kHeader[0], kHeader[1], kHeader[2]);
    for (const SheetContact& contact : contacts) {
        AppendCsvRow(csv, WideToUtf8(contact.name), contact.number, WideToUtf8(contact.note));
    }
    return csv;
}

// ---------------------------------------------------------------- XLSX

// As partes fixas do .xlsx minimo que o Excel abre, sem a declaracao do XML (o XmlPart a poe na frente).
const char kContentTypesXml[] =
    "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
    "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>"
    "<Default Extension=\"xml\" ContentType=\"application/xml\"/>"
    "<Override PartName=\"/xl/workbook.xml\" "
    "ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>"
    "<Override PartName=\"/xl/worksheets/sheet1.xml\" "
    "ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>"
    "</Types>";

const char kPackageRelsXml[] =
    "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
    "<Relationship Id=\"rId1\" "
    "Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" "
    "Target=\"xl/workbook.xml\"/></Relationships>";

// A unica aba: "Contatos".
const char kWorkbookXml[] =
    "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" "
    "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">"
    "<sheets><sheet name=\"Contatos\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>";

const char kWorkbookRelsXml[] =
    "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
    "<Relationship Id=\"rId1\" "
    "Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" "
    "Target=\"worksheets/sheet1.xml\"/></Relationships>";

const char kXmlDeclaration[] = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n";

std::string XmlPart(const char* body) { return std::string(kXmlDeclaration) + body; }

// O caractere que o XML 1.0 carrega: o TAB, o LF, o CR e tudo de U+0020 em diante, menos U+FFFE e U+FFFF. Os pares
// substitutos passam daqui: o WideToUtf8 junta o par e troca o substituto solto por U+FFFD.
bool CarriedByXml(wchar_t ch) {
    return ch == L'\t' || ch == L'\n' || ch == L'\r' || (ch >= 0x20 && ch != 0xFFFE && ch != 0xFFFF);
}

// O texto de uma celula, em UTF-8, pronto para ir entre <t> e </t>: sem os caracteres que o XML 1.0 nao carrega (os de
// controle fora o TAB, o LF e o CR, e U+FFFE e U+FFFF: o Excel nao abre a planilha que tem um deles), com & < > em
// entidades e o CR como &#13; (um XML le o CR solto como LF). O TAB e o LF ficam como estao.
std::string XmlText(const std::wstring& text) {
    std::wstring xml;
    xml.reserve(text.size());
    for (const wchar_t ch : text) {
        switch (ch) {
            case L'&': xml += L"&amp;"; break;
            case L'<': xml += L"&lt;"; break;
            case L'>': xml += L"&gt;"; break;
            case L'\r': xml += L"&#13;"; break;
            default:
                if (CarriedByXml(ch)) xml.push_back(ch);
        }
    }
    return WideToUtf8(xml);
}

// <c r="B2" t="inlineStr"><is><t xml:space="preserve">texto</t></is></c>: o texto na propria celula (nada de <v>), com
// os espacos e as quebras de linha das pontas guardados. A celula sem texto nao se escreve.
void AppendCell(std::string& xml, char column, const std::string& row, const std::string& text) {
    if (text.empty()) return;
    xml += "<c r=\"";
    xml += column;
    xml += row;
    xml += "\" t=\"inlineStr\"><is><t xml:space=\"preserve\">";
    xml += text;
    xml += "</t></is></c>";
}

// Uma linha da aba, com o numero dela (r="N") e as tres celulas (A, B e C) com a referencia de cada uma.
void AppendSheetRow(std::string& xml, size_t number, const std::string& name, const std::string& phone,
                    const std::string& note) {
    const std::string row = std::to_string(number);
    xml += "<row r=\"" + row + "\">";
    AppendCell(xml, 'A', row, name);
    AppendCell(xml, 'B', row, phone);
    AppendCell(xml, 'C', row, note);
    xml += "</row>";
}

std::string SheetXml(const std::vector<SheetContact>& contacts) {
    std::string xml = kXmlDeclaration;
    xml += "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>";
    AppendSheetRow(xml, 1, kHeader[0], kHeader[1], kHeader[2]);
    size_t row = 1;
    for (const SheetContact& contact : contacts) {
        AppendSheetRow(xml, ++row, XmlText(contact.name), XmlText(Utf8ToWide(contact.number)), XmlText(contact.note));
    }
    xml += "</sheetData></worksheet>";
    return xml;
}

// O .xlsx montado na memoria pelo escritor de zip do miniz (o "heap": o MINIZ_NO_STDIO tira o que grava arquivo); o
// miniz solta a memoria sozinho, pelo destrutor.
class ZipWriter {
public:
    ZipWriter() {
        mz_zip_zero_struct(&zip_);
        started_ = mz_zip_writer_init_heap(&zip_, 0, 0) != MZ_FALSE;
    }
    ~ZipWriter() {
        if (started_) mz_zip_writer_end(&zip_);
    }
    ZipWriter(const ZipWriter&) = delete;
    ZipWriter& operator=(const ZipWriter&) = delete;

    // Acrescenta a parte; false se o miniz nao deu.
    bool Add(const char* name, const std::string& content) {
        return started_ &&
               mz_zip_writer_add_mem(&zip_, name, content.data(), content.size(), MZ_DEFAULT_LEVEL) != MZ_FALSE;
    }

    // Fecha o zip e devolve os bytes dele; vazio se o miniz nao deu.
    std::string Finish() {
        void* buffer = nullptr;
        size_t size = 0;
        if (!started_ || mz_zip_writer_finalize_heap_archive(&zip_, &buffer, &size) == MZ_FALSE) return std::string();
        std::string bytes(static_cast<const char*>(buffer), size);
        mz_free(buffer);
        return bytes;
    }

private:
    mz_zip_archive zip_;
    bool started_ = false;
};

std::string BuildXlsx(const std::vector<SheetContact>& contacts) {
    ZipWriter zip;
    if (!zip.Add("[Content_Types].xml", XmlPart(kContentTypesXml)) ||
        !zip.Add("_rels/.rels", XmlPart(kPackageRelsXml)) || !zip.Add("xl/workbook.xml", XmlPart(kWorkbookXml)) ||
        !zip.Add("xl/_rels/workbook.xml.rels", XmlPart(kWorkbookRelsXml)) ||
        !zip.Add("xl/worksheets/sheet1.xml", SheetXml(contacts))) {
        return std::string();
    }
    return zip.Finish();
}

}  // namespace

// Nunca lancam excecao: o que falha (o miniz, ou a memoria que falta) vira o arquivo vazio.
std::string WriteContactsXlsx(const std::vector<SheetContact>& contacts) {
    try {
        return BuildXlsx(contacts);
    } catch (...) {
        return std::string();
    }
}

std::string WriteContactsCsv(const std::vector<SheetContact>& contacts) {
    try {
        return BuildCsv(contacts);
    } catch (...) {
        return std::string();
    }
}

}  // namespace starsonic
