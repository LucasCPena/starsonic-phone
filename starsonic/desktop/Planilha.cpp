#include "Planilha.h"

#include <algorithm>
#include <cstring>
#include <optional>
#include <utility>

#include "CallMessages.h"   // NormalizeDialString
#include "Stores.h"         // FoldForSearch
#include "Text.h"
// Os nomes do zlib (compress, crc32, Byte...) ficam desligados no CMake (MINIZ_NO_ZLIB_COMPATIBLE_NAMES): do miniz.h
// so valem os nomes mz_.
#include "miniz/miniz.h"

namespace starsonic {

namespace {

// A leitura para no primeiro erro: o motivo sobe por excecao ate o ReadContactSheet, que o devolve no SheetRead.
struct SheetFailure {
    SheetError error;
};

[[noreturn]] void Fail(SheetError error) { throw SheetFailure{error}; }

// Os limites que a spec nao da, contra um arquivo feito para travar a leitura: as colunas vao ate a do Excel (XFD; as
// celulas depois dela ficam de fora, como no Excel), e o XML nao passa de 256 niveis nem de 256 atributos num elemento
// (o .xlsx usa uns 10 e uns 20).
constexpr size_t kMaxColumns = 16384;
constexpr size_t kMaxXmlDepth = 256;
constexpr size_t kMaxXmlAttributes = 256;

// Uma linha da planilha: as celulas com texto (UTF-8), em ordem de coluna (0 = A). As vazias nao entram.
struct Cell {
    size_t column;
    std::string text;
};
using Row = std::vector<Cell>;

bool ByColumn(const Cell& a, const Cell& b) { return a.column < b.column; }

constexpr size_t kNoColumn = static_cast<size_t>(-1);

bool IsDigit(char ch) { return ch >= '0' && ch <= '9'; }

// ---------------------------------------------------------------- As colunas (spec 6.2)

// Sem espacos nas pontas: o espaco, o tab, as quebras de linha e o espaco que nao quebra (U+00A0).
std::wstring TrimSpaces(const std::wstring& text) {
    const wchar_t* const blanks = L" \t\r\n\u00a0";
    const size_t first = text.find_first_not_of(blanks);
    if (first == std::wstring::npos) return std::wstring();
    return text.substr(first, text.find_last_not_of(blanks) - first + 1);
}

// O texto da coluna na linha, sem espacos nas pontas; vazio se a linha nao tem a celula.
std::wstring CellText(const Row& row, size_t column) {
    const auto cell = std::lower_bound(row.begin(), row.end(), column,
                                       [](const Cell& item, size_t wanted) { return item.column < wanted; });
    if (cell == row.end() || cell->column != column) return std::wstring();
    return TrimSpaces(Utf8ToWide(cell->text));
}

enum class Field { None, Name, FirstName, LastName, Number, Note };

struct Title {
    const wchar_t* text;   // sem acento e sem caixa (FoldForSearch)
    Field field;
};

const Title kTitles[] = {
    {L"nome", Field::Name},          {L"name", Field::Name},
    {L"contato", Field::Name},       {L"first name", Field::FirstName},
    {L"last name", Field::LastName}, {L"numero", Field::Number},
    {L"number", Field::Number},      {L"telefone", Field::Number},
    {L"fone", Field::Number},        {L"ramal", Field::Number},
    {L"celular", Field::Number},     {L"phone", Field::Number},
    {L"phone number", Field::Number}, {L"primary phone", Field::Number},
    {L"mobile", Field::Number},      {L"mobile number", Field::Number},
    {L"observacao", Field::Note},    {L"obs", Field::Note},
    {L"comment", Field::Note},       {L"notes", Field::Note},
    {L"setor", Field::Note},         {L"departamento", Field::Note},
    {L"empresa", Field::Note},
};

// O que e a coluna, pelo nome dela no cabecalho.
Field FieldFor(const std::string& title) {
    const std::wstring key = FoldForSearch(TrimSpaces(Utf8ToWide(title)));
    for (const Title& entry : kTitles) {
        if (key == entry.text) return entry.field;
    }
    return Field::None;
}

// A coluna B da primeira linha de uma planilha sem cabecalho: 2 digitos ou mais depois do NormalizeDialString, e
// nenhuma letra (as latinas, com ou sem acento).
bool LooksLikeNumber(const std::wstring& text) {
    size_t digits = 0;
    for (const wchar_t ch : FoldForSearch(NormalizeDialString(text))) {
        if (ch >= L'a' && ch <= L'z') return false;
        if (ch >= L'0' && ch <= L'9') ++digits;
    }
    return digits >= 2;
}

// As linhas (com as celulas em ordem de coluna) viram contatos, uma por vez: a primeira nao vazia decide as colunas (o
// cabecalho, ou A, B e C quando nao ha cabecalho), e cada linha depois dela vira um contato ou fica de fora.
class ContactRows {
public:
    void Add(const Row& row) {
        if (!started_) {
            const auto blank = [](const Cell& cell) { return TrimSpaces(Utf8ToWide(cell.text)).empty(); };
            if (std::all_of(row.begin(), row.end(), blank)) return;
            Start(row);
            if (header_) return;
        }
        AddContact(row);
    }

    // Os contatos lidos; Unreadable se a planilha nao tinha nenhuma linha.
    std::vector<SheetContact> Take() {
        if (!started_) Fail(SheetError::Unreadable);
        return std::move(contacts_);
    }

private:
    static void Leftmost(size_t& field, size_t column) { field = std::min(field, column); }

    void Start(const Row& row) {
        started_ = true;
        for (const Cell& cell : row) {
            switch (FieldFor(cell.text)) {
                case Field::Name: Leftmost(name_, cell.column); break;
                case Field::FirstName: Leftmost(first_, cell.column); break;
                case Field::LastName: Leftmost(last_, cell.column); break;
                case Field::Number: numbers_.push_back(cell.column); break;
                case Field::Note: Leftmost(note_, cell.column); break;
                case Field::None: break;
            }
        }
        const bool named = name_ != kNoColumn || first_ != kNoColumn || last_ != kNoColumn;
        if (named && !numbers_.empty()) {
            header_ = true;
            return;
        }
        if (!LooksLikeNumber(CellText(row, 1))) Fail(SheetError::Unreadable);
        // Sem cabecalho: A, B e C, desde esta linha.
        name_ = 0;
        first_ = last_ = kNoColumn;
        numbers_.assign(1, 1);
        note_ = 2;
    }

    void AddContact(const Row& row) {
        std::wstring name = CellText(row, name_);
        if (name.empty()) {
            const std::wstring first = CellText(row, first_);
            const std::wstring last = CellText(row, last_);
            name = first.empty() || last.empty() ? first + last : first + L" " + last;
        }
        if (name.empty()) return;
        // O numero: a celula mais a esquerda numa coluna de numero cujo NormalizeDialString nao fica vazio. A linha e
        // percorrida pelas celulas que ela tem, cada uma com uma busca nas colunas de numero, e nao pelas colunas de
        // numero: um cabecalho com milhares delas nao multiplica o trabalho pelas linhas.
        std::wstring number;
        size_t previous = kNoColumn;
        for (const Cell& cell : row) {
            if (cell.column == previous) continue;   // a mesma coluna de novo (um .xlsx estragado): vale a primeira
            previous = cell.column;
            if (!std::binary_search(numbers_.begin(), numbers_.end(), cell.column)) continue;
            number = TrimSpaces(Utf8ToWide(cell.text));
            if (!NormalizeDialString(number).empty()) break;
            number.clear();
        }
        if (number.empty()) return;
        if (contacts_.size() == kSheetMaxContacts) Fail(SheetError::TooLarge);
        contacts_.push_back(SheetContact{std::move(name), WideToUtf8(number), CellText(row, note_)});
    }

    bool started_ = false;   // a primeira linha nao vazia ja chegou
    bool header_ = false;    // e ela era o cabecalho
    size_t name_ = kNoColumn;
    size_t first_ = kNoColumn;
    size_t last_ = kNoColumn;
    size_t note_ = kNoColumn;
    std::vector<size_t> numbers_;   // em ordem (as celulas chegam em ordem de coluna), para a busca do AddContact
    std::vector<SheetContact> contacts_;
};

// ---------------------------------------------------------------- CSV (spec 6.1)

// Quantos bytes tem a sequencia UTF-8 bem formada que comeca em pos (um byte de 0x80 em diante); 0 se ali nao comeca
// uma. Bem formada e a que a volta pelo Utf8ToWide (que troca o que nao e UTF-8 por U+FFFD) e pelo WideToUtf8 nao
// muda: sem a forma longa, sem os substitutos (U+D800 a U+DFFF) e sem passar de U+10FFFF.
size_t Utf8SequenceSize(const std::string& text, size_t pos) {
    const unsigned char lead = static_cast<unsigned char>(text[pos]);
    size_t size = 0;
    if (lead >= 0xC2 && lead <= 0xDF) size = 2;
    else if (lead >= 0xE0 && lead <= 0xEF) size = 3;
    else if (lead >= 0xF0 && lead <= 0xF4) size = 4;
    if (size == 0 || text.size() - pos < size) return 0;
    const std::string sequence = text.substr(pos, size);
    return WideToUtf8(Utf8ToWide(sequence)) == sequence ? size : 0;
}

// O Windows-1252 de 0x80 a 0x9F (o euro, as aspas curvas, os travessoes...); o resto e o Latin-1. Os cinco codigos que
// ele nao define ficam com o caractere de controle do mesmo numero, como no Windows.
const wchar_t kWindows1252[32] = {
    0x20AC, 0x0081, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160,
    0x2039, 0x0152, 0x008D, 0x017D, 0x008F, 0x0090, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022,
    0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x009D, 0x017E, 0x0178};

// O caractere do Windows-1252 de um byte de 0x80 em diante.
wchar_t Windows1252(unsigned char byte) { return byte < 0xA0 ? kWindows1252[byte - 0x80] : static_cast<wchar_t>(byte); }

// O texto do CSV em UTF-8, uma sequencia por vez (spec 6.1): a sequencia UTF-8 bem formada fica como esta, e cada byte
// que nao comeca uma e lido como Windows-1252. Assim, um byte perdido num CSV em UTF-8 (uma linha colada de um arquivo
// em Windows-1252, o 0xE9 de "Jose") nao leva o arquivo inteiro para o Windows-1252. No arquivo todo em Windows-1252, a
// letra com acento e um byte so e quase nunca forma uma sequencia com os seguintes. O caso mais provavel e a maiuscula
// com acento (0xC2 a 0xDF) colada num simbolo de 0x80 a 0xBF (o espaco que nao quebra, as aspas curvas): esse par sai
// em UTF-8.
std::string CsvText(const std::string& bytes) {
    std::string text;
    text.reserve(bytes.size());
    for (size_t pos = 0; pos < bytes.size();) {
        const unsigned char byte = static_cast<unsigned char>(bytes[pos]);
        if (byte < 0x80) {
            text.push_back(bytes[pos++]);
            continue;
        }
        const size_t size = Utf8SequenceSize(bytes, pos);
        if (size == 0) {
            text += WideToUtf8(std::wstring(1, Windows1252(byte)));
            ++pos;
            continue;
        }
        text.append(bytes, pos, size);
        pos += size;
    }
    return text;
}

// Uma pagina HTML no lugar da planilha (o Google ou a Microsoft pedindo login).
bool LooksLikeHtml(const std::string& text) {
    const size_t start = text.find_first_not_of(" \t\r\n");
    if (start == std::string::npos) return false;
    std::string head = text.substr(start, 14);
    for (char& ch : head) {
        if (ch >= 'A' && ch <= 'Z') ch = static_cast<char>(ch - 'A' + 'a');
    }
    return head == "<!doctype html" || head.compare(0, 5, "<html") == 0;
}

// O separador: o que mais aparece fora das aspas na primeira linha com algo alem de espacos e tabs; no empate, ';',
// ',' e o tab, nessa ordem. '\0' sem nenhum: uma coluna so.
char DetectSeparator(const std::string& text) {
    const char kSeparators[] = {';', ',', '\t'};
    const size_t size = text.size();
    size_t pos = 0;
    while (pos < size) {
        size_t counts[3] = {0, 0, 0};
        bool content = false;
        bool quoted = false;
        bool fieldStart = true;   // as aspas so abrem no comeco do campo, como na leitura
        for (; pos < size; ++pos) {
            const char ch = text[pos];
            if (quoted) {
                if (ch == '"') {
                    if (pos + 1 < size && text[pos + 1] == '"') {
                        ++pos;
                    } else {
                        quoted = false;
                    }
                }
                continue;
            }
            if (ch == '\r' || ch == '\n') break;
            if (ch == '"' && fieldStart) {
                quoted = true;
                content = true;
                continue;
            }
            fieldStart = false;
            for (size_t k = 0; k < 3; ++k) {
                if (ch != kSeparators[k]) continue;
                ++counts[k];
                fieldStart = true;
            }
            if (ch != ' ' && ch != '\t') content = true;
        }
        ++pos;   // a quebra de linha
        if (!content) continue;
        size_t best = 0;
        for (size_t k = 1; k < 3; ++k) {
            if (counts[k] > counts[best]) best = k;
        }
        return counts[best] ? kSeparators[best] : '\0';
    }
    return '\0';
}

// As linhas do CSV (ja em UTF-8). As aspas so abrem no comeco do campo; dentro delas, "" e uma aspa e a quebra de
// linha fica no texto; o que vier depois da aspa do fim, ate o separador, entra no campo; sem a aspa do fim, o campo
// vai ate o fim do arquivo. A ultima linha pode nao ter a quebra.
void ReadCsvRows(const std::string& text, char separator, ContactRows& rows) {
    Row row;
    std::string field;
    size_t column = 0;
    bool fieldStart = true;
    bool inRecord = false;   // a linha tem algum caractere
    const auto endField = [&] {
        if (!field.empty() && column < kMaxColumns) row.push_back(Cell{column, std::move(field)});
        field.clear();
        ++column;
        fieldStart = true;
    };
    const auto endRecord = [&] {
        endField();
        rows.Add(row);
        row.clear();
        column = 0;
        inRecord = false;
    };
    const size_t size = text.size();
    size_t pos = 0;
    while (pos < size) {
        const char ch = text[pos++];
        if (ch == '\r' || ch == '\n') {
            if (ch == '\r' && pos < size && text[pos] == '\n') ++pos;
            endRecord();
            continue;
        }
        inRecord = true;
        if (ch == '"' && fieldStart) {
            fieldStart = false;
            while (pos < size) {
                const char inner = text[pos++];
                if (inner == '"') {
                    if (pos >= size || text[pos] != '"') break;
                    ++pos;
                }
                field.push_back(inner);
            }
        } else if (separator != '\0' && ch == separator) {
            endField();
        } else {
            fieldStart = false;
            field.push_back(ch);
        }
    }
    if (inRecord) endRecord();
}

void ReadCsv(const std::string& bytes, ContactRows& rows) {
    const std::string text = CsvText(StripUtf8Bom(bytes));
    if (LooksLikeHtml(text)) Fail(SheetError::Unreadable);
    ReadCsvRows(text, DetectSeparator(text), rows);
}

// ---------------------------------------------------------------- XML

// Um leitor de XML do tamanho do .xlsx, um evento por vez: o comeco e o fim de cada elemento (pelo nome local, sem o
// prefixo; um elemento vazio da os dois), com os atributos no comeco, e o texto entre eles. As entidades &amp; &lt;
// &gt; &quot; &apos; e as referencias &#N; e &#xH; viram o caractere; uma entidade desconhecida fica como esta. O texto
// fica com todos os espacos: e o que o xml:space="preserve" do Excel pede, e o que o XML ja faz sem ele. Os
// comentarios, o <?xml ...?> e o <!DOCTYPE> sao pulados; o CDATA e texto. O XML estragado (uma marca sem fim, um fim
// que nao fecha o elemento aberto, o arquivo que acaba com um elemento aberto) da Unreadable.
class XmlReader {
public:
    enum class Event { Start, End, Text, Finish };

    explicit XmlReader(const std::string& xml) : xml_(xml) {
        if (xml_.compare(0, 3, "\xef\xbb\xbf") == 0) pos_ = 3;
    }

    Event Next() {
        if (closeEmpty_) {
            closeEmpty_ = false;
            open_.pop_back();
            return Event::End;
        }
        while (pos_ < xml_.size()) {
            if (xml_[pos_] != '<') {
                const size_t begin = pos_;
                pos_ = std::min(xml_.find('<', pos_), xml_.size());
                if (open_.empty()) continue;   // fora do elemento raiz: so as quebras de linha
                text_ = Unescape(begin, pos_);
                return Event::Text;
            }
            if (Skip("<!--", "-->") || Skip("<?", "?>")) continue;
            if (StartsWith("<![CDATA[")) {
                const size_t begin = pos_ + 9;
                pos_ = Find("]]>", begin) + 3;
                if (open_.empty()) continue;
                text_.assign(xml_, begin, pos_ - 3 - begin);
                return Event::Text;
            }
            if (Skip("<!", ">")) continue;   // o <!DOCTYPE ...>
            if (StartsWith("</")) {
                pos_ += 2;
                const std::string name = ReadName();
                SkipSpaces();
                Expect('>');
                if (open_.empty() || open_.back() != name) Fail(SheetError::Unreadable);
                open_.pop_back();
                name_ = LocalName(name);
                return Event::End;
            }
            ReadStartTag();
            return Event::Start;
        }
        if (!open_.empty()) Fail(SheetError::Unreadable);
        return Event::Finish;
    }

    // O nome local do elemento (Start e End).
    const std::string& Name() const { return name_; }
    // O texto (Text).
    const std::string& Text() const { return text_; }
    // O atributo do elemento que comecou (Start), pelo nome local; vazio se nao ha.
    std::string Attribute(const char* name) const {
        for (const auto& attribute : attributes_) {
            if (attribute.first == name) return attribute.second;
        }
        return std::string();
    }

private:
    bool StartsWith(const char* prefix) const {
        return xml_.compare(pos_, std::char_traits<char>::length(prefix), prefix) == 0;
    }

    // Onde o marcador comeca, desde from; o XML acabou antes dele: Unreadable.
    size_t Find(const char* marker, size_t from) const {
        const size_t found = xml_.find(marker, from);
        if (found == std::string::npos) Fail(SheetError::Unreadable);
        return found;
    }

    // Se o texto comeca com open, pula ate depois do close.
    bool Skip(const char* open, const char* close) {
        if (!StartsWith(open)) return false;
        pos_ = Find(close, pos_ + std::char_traits<char>::length(open)) + std::char_traits<char>::length(close);
        return true;
    }

    void SkipSpaces() {
        while (pos_ < xml_.size()) {
            const char ch = xml_[pos_];
            if (ch != ' ' && ch != '\t' && ch != '\r' && ch != '\n') break;
            ++pos_;
        }
    }

    void Expect(char ch) {
        if (pos_ >= xml_.size() || xml_[pos_] != ch) Fail(SheetError::Unreadable);
        ++pos_;
    }

    std::string ReadName() {
        const size_t begin = pos_;
        while (pos_ < xml_.size()) {
            const char ch = xml_[pos_];
            const bool nameChar = (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || IsDigit(ch) || ch == '_' ||
                                  ch == '-' || ch == '.' || ch == ':' || static_cast<unsigned char>(ch) >= 0x80;
            if (!nameChar) break;
            ++pos_;
        }
        if (pos_ == begin) Fail(SheetError::Unreadable);
        return xml_.substr(begin, pos_ - begin);
    }

    static std::string LocalName(const std::string& name) {
        const size_t colon = name.rfind(':');
        return colon == std::string::npos ? name : name.substr(colon + 1);
    }

    // <nome atributo="valor" ...> ou <nome .../>, com pos_ no '<'.
    void ReadStartTag() {
        ++pos_;
        const std::string name = ReadName();
        attributes_.clear();
        for (;;) {
            SkipSpaces();
            if (StartsWith("/>")) {
                pos_ += 2;
                closeEmpty_ = true;
                break;
            }
            if (pos_ < xml_.size() && xml_[pos_] == '>') {
                ++pos_;
                break;
            }
            std::string attribute = LocalName(ReadName());
            SkipSpaces();
            Expect('=');
            SkipSpaces();
            if (pos_ >= xml_.size() || (xml_[pos_] != '"' && xml_[pos_] != '\'')) Fail(SheetError::Unreadable);
            const size_t begin = pos_ + 1;
            pos_ = Find(xml_[pos_] == '"' ? "\"" : "'", begin);
            if (attributes_.size() == kMaxXmlAttributes) Fail(SheetError::Unreadable);
            attributes_.emplace_back(std::move(attribute), Unescape(begin, pos_));
            ++pos_;
        }
        if (open_.size() == kMaxXmlDepth) Fail(SheetError::Unreadable);
        open_.push_back(name);
        name_ = LocalName(name);
    }

    // O texto de xml_[begin, end), com as entidades trocadas.
    std::string Unescape(size_t begin, size_t end) const {
        std::string out;
        out.reserve(end - begin);
        while (begin < end) {
            const void* found = std::memchr(xml_.data() + begin, '&', end - begin);
            const size_t amp = found ? static_cast<size_t>(static_cast<const char*>(found) - xml_.data()) : end;
            out.append(xml_, begin, amp - begin);
            if (amp == end) break;
            size_t semicolon = amp + 1;
            while (semicolon < end && semicolon - amp <= 10 && xml_[semicolon] != ';') ++semicolon;
            if (semicolon < end && xml_[semicolon] == ';' &&
                AppendEntity(xml_.substr(amp + 1, semicolon - amp - 1), out)) {
                begin = semicolon + 1;
            } else {
                out.push_back('&');
                begin = amp + 1;
            }
        }
        return out;
    }

    // A entidade (sem o & e o ;) no fim de out; false se nao e conhecida.
    static bool AppendEntity(const std::string& entity, std::string& out) {
        if (entity == "amp") out.push_back('&');
        else if (entity == "lt") out.push_back('<');
        else if (entity == "gt") out.push_back('>');
        else if (entity == "quot") out.push_back('"');
        else if (entity == "apos") out.push_back('\'');
        else {
            const bool hex = entity.size() > 1 && (entity[1] == 'x' || entity[1] == 'X');
            const size_t first = hex ? 2 : 1;
            if (entity.size() <= first || entity[0] != '#') return false;
            unsigned long code = 0;
            for (size_t i = first; i < entity.size(); ++i) {
                const char ch = entity[i];
                unsigned long digit = 0;
                if (IsDigit(ch)) digit = static_cast<unsigned long>(ch - '0');
                else if (hex && ch >= 'a' && ch <= 'f') digit = static_cast<unsigned long>(ch - 'a' + 10);
                else if (hex && ch >= 'A' && ch <= 'F') digit = static_cast<unsigned long>(ch - 'A' + 10);
                else return false;
                code = code * (hex ? 16 : 10) + digit;
            }
            // Em UTF-8 pelo WideToUtf8 (com o par substituto quando o wchar_t tem 16 bits): o 0, um substituto e o que
            // passa de U+10FFFF viram U+FFFD.
            if (code == 0 || code > 0x10FFFF) code = 0xFFFD;
            std::wstring wide;
            if (sizeof(wchar_t) == 2 && code > 0xFFFF) {
                wide.push_back(static_cast<wchar_t>(0xD800 + ((code - 0x10000) >> 10)));
                wide.push_back(static_cast<wchar_t>(0xDC00 + ((code - 0x10000) & 0x3FF)));
            } else {
                wide.push_back(static_cast<wchar_t>(code));
            }
            out += WideToUtf8(wide);
        }
        return true;
    }

    const std::string& xml_;
    size_t pos_ = 0;
    std::vector<std::string> open_;   // os elementos abertos (o nome com o prefixo)
    std::string name_;
    std::string text_;
    std::vector<std::pair<std::string, std::string>> attributes_;
    bool closeEmpty_ = false;   // o Start foi de um elemento vazio: o proximo evento e o End dele
};

using Event = XmlReader::Event;

// ---------------------------------------------------------------- XLSX (spec 6.1)

// O numero de uma celula como texto: o inteiro sai sem a notacao cientifica e sem ".0" ("1.1999998888E10" vira
// "11999998888", "2002.0" vira "2002"); o que nao e inteiro, ou nao e numero, sai como esta no <v>.
std::string NumberText(const std::string& value) {
    const size_t size = value.size();
    size_t i = 0;
    const bool negative = size > 0 && value[0] == '-';
    if (size > 0 && (value[0] == '-' || value[0] == '+')) ++i;
    std::string digits;         // os digitos, sem o ponto
    size_t integerDigits = 0;   // quantos vem antes do ponto
    for (; i < size && IsDigit(value[i]); ++i, ++integerDigits) digits.push_back(value[i]);
    if (i < size && value[i] == '.') {
        for (++i; i < size && IsDigit(value[i]); ++i) digits.push_back(value[i]);
    }
    if (digits.empty()) return value;
    long long exponent = 0;
    if (i < size && (value[i] == 'e' || value[i] == 'E')) {
        const bool negativeExponent = i + 1 < size && value[i + 1] == '-';
        if (i + 1 < size && (value[i + 1] == '-' || value[i + 1] == '+')) ++i;
        if (++i == size) return value;
        for (; i < size && IsDigit(value[i]); ++i) {
            exponent = exponent * 10 + (value[i] - '0');
            if (exponent > 1000) return value;   // longe demais para ser um telefone
        }
        if (negativeExponent) exponent = -exponent;
    }
    if (i != size) return value;
    // O ponto fica depois de 'point' digitos: e inteiro se depois dele so ha zeros.
    const size_t point = static_cast<size_t>(std::max(static_cast<long long>(integerDigits) + exponent, 0LL));
    if (point < digits.size() && digits.find_first_not_of('0', point) != std::string::npos) return value;
    std::string integer = digits.substr(0, point);
    integer.resize(point, '0');
    const size_t nonzero = integer.find_first_not_of('0');
    if (nonzero == std::string::npos) return "0";
    return (negative ? "-" : "") + integer.substr(nonzero);
}

// A coluna da referencia da celula (r="C5" -> 2). Sem a referencia, ou com mais de 3 letras, a coluna seguinte a da
// celula anterior.
size_t ColumnOf(const std::string& reference, size_t next) {
    size_t column = 0;
    size_t letters = 0;
    for (char ch : reference) {
        if (ch >= 'a' && ch <= 'z') ch = static_cast<char>(ch - 'a' + 'A');
        if (ch < 'A' || ch > 'Z') break;
        if (++letters > 3) return next;
        column = column * 26 + static_cast<size_t>(ch - 'A' + 1);
    }
    return letters > 0 ? column - 1 : next;
}

// O texto compartilhado, todo num texto so (um .xlsx pode ter milhoes de <si>): o item i termina em ends[i] e comeca
// onde o anterior termina.
struct SharedStrings {
    std::string text;
    std::vector<size_t> ends;
};

// Cada <si>, com os <t> dele juntos (o texto com formatacao vem em pedacos, um <r> por pedaco). O texto fonetico
// (<rPh>) nao e parte do texto, como no Excel.
SharedStrings ReadSharedStrings(const std::string& xml) {
    SharedStrings strings;
    XmlReader reader(xml);
    bool inItem = false;
    bool inText = false;
    int phonetic = 0;
    for (Event event = reader.Next(); event != Event::Finish; event = reader.Next()) {
        if (event == Event::Text) {
            if (inItem && inText && phonetic == 0) strings.text += reader.Text();
            continue;
        }
        const bool start = event == Event::Start;
        if (reader.Name() == "si") {
            if (!start) strings.ends.push_back(strings.text.size());
            inItem = start;
        } else if (inItem && reader.Name() == "rPh") {
            phonetic += start ? 1 : -1;
        } else if (inItem && reader.Name() == "t") {
            inText = start;
        }
    }
    return strings;
}

// O texto da celula pelo tipo (t): o texto compartilhado (s, o indice no <v>; fora da lista, vazio), o texto na
// celula (inlineStr), o numero (sem t, ou n); dos outros (str, o texto de uma formula; b; e; d) o <v> como esta.
std::string CellValue(const std::string& type, const std::string& value, const std::string& inlineText,
                      const SharedStrings& shared) {
    if (type == "inlineStr") return inlineText;
    if (type.empty() || type == "n") return NumberText(value);
    if (type != "s") return value;
    if (value.empty() || value.size() > 9) return std::string();
    size_t index = 0;
    for (const char ch : value) {
        if (!IsDigit(ch)) return std::string();
        index = index * 10 + static_cast<size_t>(ch - '0');
    }
    if (index >= shared.ends.size()) return std::string();
    const size_t begin = index == 0 ? 0 : shared.ends[index - 1];
    return shared.text.substr(begin, shared.ends[index] - begin);
}

// A aba: cada <row> e uma linha, e cada <c> fica na coluna da referencia dela. Da formula vale o valor guardado (<v>):
// o <f> nao e lido. O texto na celula (<is>) sao os <t> dele juntos, sem o texto fonetico. O texto das celulas da aba,
// somado (cada uso de um texto compartilhado conta de novo), vai ate kSheetMaxPartBytes: um texto compartilhado grande,
// usado em muitas celulas, faria de um .xlsx pequeno um que enche a memoria (TooLarge).
void ReadSheetRows(const std::string& xml, const SharedStrings& shared, ContactRows& rows) {
    XmlReader reader(xml);
    Row row;
    bool inRow = false;
    bool inCell = false;
    bool inValue = false;
    bool inInline = false;
    bool inText = false;
    int phonetic = 0;
    size_t column = 0;
    size_t next = 0;   // a coluna da celula sem referencia
    size_t budget = kSheetMaxPartBytes;
    std::string type;
    std::string value;
    std::string inlineText;
    for (Event event = reader.Next(); event != Event::Finish; event = reader.Next()) {
        if (event == Event::Text) {
            if (inValue) value += reader.Text();
            if (inText && phonetic == 0) inlineText += reader.Text();
            continue;
        }
        const bool start = event == Event::Start;
        const std::string& name = reader.Name();
        if (name == "row") {
            if (!start) {
                // As celulas fora de ordem (um .xlsx que nao veio do Excel) vao para a ordem das colunas.
                if (!std::is_sorted(row.begin(), row.end(), ByColumn)) {
                    std::stable_sort(row.begin(), row.end(), ByColumn);
                }
                rows.Add(row);
            }
            row.clear();
            next = 0;
            inRow = start;
        } else if (inRow && name == "c") {
            if (start) {
                column = ColumnOf(reader.Attribute("r"), next);
                type = reader.Attribute("t");
                value.clear();
                inlineText.clear();
            } else if (column < kMaxColumns) {
                std::string text = CellValue(type, value, inlineText, shared);
                if (text.size() > budget) Fail(SheetError::TooLarge);
                budget -= text.size();
                if (!text.empty()) row.push_back(Cell{column, std::move(text)});
            }
            if (!start) next = column + 1;
            inCell = start;
        } else if (inCell && name == "v") {
            inValue = start;
        } else if (inCell && name == "is") {
            inInline = start;
        } else if (inInline && name == "rPh") {
            phonetic += start ? 1 : -1;
        } else if (inInline && name == "t") {
            inText = start;
        }
    }
}

// O caminho da parte no zip, pelo Target do xl/_rels/workbook.xml.rels: relativo a xl/, ou desde a raiz com '/' na
// frente.
std::string PartPath(const std::string& target) {
    return !target.empty() && target[0] == '/' ? target.substr(1) : "xl/" + target;
}

// O r:id da primeira aba, na ordem do workbook.xml (mesmo escondida).
std::string FirstSheetId(const std::string& xml) {
    XmlReader reader(xml);
    bool inSheets = false;
    for (Event event = reader.Next(); event != Event::Finish; event = reader.Next()) {
        if (event == Event::Text) continue;
        if (reader.Name() == "sheets") {
            inSheets = event == Event::Start;
        } else if (inSheets && event == Event::Start && reader.Name() == "sheet") {
            const std::string id = reader.Attribute("id");
            if (id.empty()) break;
            return id;
        }
    }
    Fail(SheetError::Unreadable);
}

struct WorkbookParts {
    std::string sheet;
    std::string sharedStrings = "xl/sharedStrings.xml";   // o lugar de sempre, quando o .rels nao diz
};

// A aba (pelo r:id dela) e o texto compartilhado (pelo tipo), no xl/_rels/workbook.xml.rels.
WorkbookParts ReadWorkbookRels(const std::string& xml, const std::string& sheetId) {
    const std::string sharedStringsType = "/sharedStrings";
    WorkbookParts parts;
    XmlReader reader(xml);
    for (Event event = reader.Next(); event != Event::Finish; event = reader.Next()) {
        if (event != Event::Start || reader.Name() != "Relationship") continue;
        if (reader.Attribute("TargetMode") == "External") continue;
        const std::string type = reader.Attribute("Type");
        if (reader.Attribute("Id") == sheetId) {
            parts.sheet = PartPath(reader.Attribute("Target"));
        } else if (type.size() >= sharedStringsType.size() &&
                   type.compare(type.size() - sharedStringsType.size(), std::string::npos, sharedStringsType) == 0) {
            parts.sharedStrings = PartPath(reader.Attribute("Target"));
        }
    }
    return parts;
}

// O .xlsx aberto na memoria pelo leitor de zip do miniz; fecha sozinho.
class ZipReader {
public:
    explicit ZipReader(const std::string& bytes) {
        mz_zip_zero_struct(&zip_);
        if (!mz_zip_reader_init_mem(&zip_, bytes.data(), bytes.size(), 0)) Fail(SheetError::Unreadable);
    }
    ~ZipReader() { mz_zip_reader_end(&zip_); }
    ZipReader(const ZipReader&) = delete;
    ZipReader& operator=(const ZipReader&) = delete;

    // A parte descompactada; nada se o zip nao a tem. O tamanho descompactado e conferido antes: acima de
    // kSheetMaxPartBytes, TooLarge (o miniz nao passa do tamanho que o zip declara). Unreadable se nao descompacta.
    std::optional<std::string> Part(const std::string& name) {
        const int index = mz_zip_reader_locate_file(&zip_, name.c_str(), nullptr, 0);
        if (index < 0) return std::nullopt;
        mz_zip_archive_file_stat stat;
        if (!mz_zip_reader_file_stat(&zip_, static_cast<mz_uint>(index), &stat) || stat.m_is_directory) {
            Fail(SheetError::Unreadable);
        }
        if (stat.m_uncomp_size > kSheetMaxPartBytes) Fail(SheetError::TooLarge);
        std::string data(static_cast<size_t>(stat.m_uncomp_size), '\0');
        if (!data.empty() &&
            !mz_zip_reader_extract_to_mem(&zip_, static_cast<mz_uint>(index), &data[0], data.size(), 0)) {
            Fail(SheetError::Unreadable);
        }
        return data;
    }

private:
    mz_zip_archive zip_;
};

void ReadXlsx(const std::string& bytes, ContactRows& rows) {
    ZipReader zip(bytes);
    const std::optional<std::string> workbook = zip.Part("xl/workbook.xml");
    const std::optional<std::string> rels = zip.Part("xl/_rels/workbook.xml.rels");
    if (!workbook || !rels) Fail(SheetError::Unreadable);
    const WorkbookParts parts = ReadWorkbookRels(*rels, FirstSheetId(*workbook));
    if (parts.sheet.empty()) Fail(SheetError::Unreadable);
    SharedStrings shared;
    if (const std::optional<std::string> xml = zip.Part(parts.sharedStrings)) shared = ReadSharedStrings(*xml);
    const std::optional<std::string> sheet = zip.Part(parts.sheet);
    if (!sheet) Fail(SheetError::Unreadable);
    ReadSheetRows(*sheet, shared, rows);
}

}  // namespace

SheetRead ReadContactSheet(const std::string& bytes) {
    SheetRead read;
    if (bytes.size() > kSheetMaxBytes) {
        read.error = SheetError::TooLarge;
        return read;
    }
    try {
        ContactRows rows;
        if (bytes.compare(0, 2, "PK") == 0) {
            ReadXlsx(bytes, rows);
        } else {
            ReadCsv(bytes, rows);
        }
        read.contacts = rows.Take();
    } catch (const SheetFailure& failure) {
        read.error = failure.error;
    } catch (...) {
        // Qualquer outra falha no meio da leitura (sem memoria, por exemplo): a planilha nao foi lida.
        read.error = SheetError::Unreadable;
    }
    return read;
}

}  // namespace starsonic
