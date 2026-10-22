#include "LegacyImport.h"

#include <sqlite3.h>

#include <algorithm>
#include <cstdint>
#include <utility>
#include <vector>

#include "AccountPolicy.h"
#include "CallMessages.h"
#include "Text.h"

namespace starsonic {

namespace {

const char kPendingContacts[] = "contatos";
const char kPendingCalls[] = "recentes";
const char kMigratedSuffix[] = ".migrado";

// Quanto esperar por um call_log.db travado (a rc.7 gravando) antes de deixar para a proxima abertura.
const int kBusyTimeoutMs = 1000;

// ---------------------------------------------------------------- O .ini

// Uma unidade UTF-16 por vez (wchar_t de 16 bits no Windows); com wchar_t de 32 bits, o par substituto vira um
// caractere. Substituto solto vira U+FFFD.
std::wstring DecodeUtf16Le(const std::string& bytes, size_t start) {
    std::wstring text;
    text.reserve((bytes.size() - start) / 2);
    for (size_t i = start; i + 1 < bytes.size(); i += 2) {
        const unsigned unit = static_cast<unsigned char>(bytes[i]) | (static_cast<unsigned char>(bytes[i + 1]) << 8);
        if (sizeof(wchar_t) == 2) {
            text.push_back(static_cast<wchar_t>(unit));
            continue;
        }
        if (unit >= 0xd800 && unit <= 0xdbff && i + 3 < bytes.size()) {
            const unsigned low = static_cast<unsigned char>(bytes[i + 2]) | (static_cast<unsigned char>(bytes[i + 3]) << 8);
            if (low >= 0xdc00 && low <= 0xdfff) {
                text.push_back(static_cast<wchar_t>(0x10000 + ((unit - 0xd800) << 10) + (low - 0xdc00)));
                i += 2;
                continue;
            }
        }
        text.push_back(unit >= 0xd800 && unit <= 0xdfff ? static_cast<wchar_t>(0xfffd) : static_cast<wchar_t>(unit));
    }
    return text;
}

// O MicroSIP deixa o .ini em UTF-16LE com o BOM (AccountSettings::Init converte o que nao tem); sem o BOM, UTF-8.
std::wstring DecodeIniText(const std::string& bytes) {
    if (bytes.size() >= 2 && static_cast<unsigned char>(bytes[0]) == 0xff && static_cast<unsigned char>(bytes[1]) == 0xfe) {
        return DecodeUtf16Le(bytes, 2);
    }
    return Utf8ToWide(StripUtf8Bom(bytes));
}

struct IniSection {
    std::wstring name;
    std::vector<std::pair<std::wstring, std::wstring>> values;
};

bool SameIgnoringCase(const std::wstring& a, const std::wstring& b) {
    if (a.size() != b.size()) return false;
    for (size_t i = 0; i < a.size(); ++i) {
        wchar_t x = a[i];
        wchar_t y = b[i];
        if (x >= L'A' && x <= L'Z') x = static_cast<wchar_t>(x - L'A' + L'a');
        if (y >= L'A' && y <= L'Z') y = static_cast<wchar_t>(y - L'A' + L'a');
        if (x != y) return false;
    }
    return true;
}

// Como o GetPrivateProfileString le: secao "[nome]", "chave=valor" com espacos das pontas aparados e as aspas (simples
// ou duplas) em volta do valor tiradas; ';' no comeco da linha e comentario.
std::vector<IniSection> ParseIni(const std::wstring& text) {
    std::vector<IniSection> sections;
    size_t begin = 0;
    while (begin <= text.size()) {
        size_t end = text.find_first_of(L"\r\n", begin);
        if (end == std::wstring::npos) end = text.size();
        const std::wstring line = Trim(text.substr(begin, end - begin));
        begin = end + 1;
        if (line.empty() || line[0] == L';') continue;
        if (line[0] == L'[') {
            const size_t close = line.find(L']');
            IniSection section;
            section.name = Trim(line.substr(1, close == std::wstring::npos ? std::wstring::npos : close - 1));
            sections.push_back(std::move(section));
            continue;
        }
        const size_t equals = line.find(L'=');
        if (equals == std::wstring::npos || sections.empty()) continue;
        std::wstring value = Trim(line.substr(equals + 1));
        if (value.size() >= 2 && (value[0] == L'"' || value[0] == L'\'') && value.back() == value[0]) {
            value = value.substr(1, value.size() - 2);
        }
        sections.back().values.emplace_back(Trim(line.substr(0, equals)), std::move(value));
    }
    return sections;
}

// A primeira secao com esse nome (o Windows le a primeira).
const IniSection* FindSection(const std::vector<IniSection>& sections, const std::wstring& name) {
    for (const IniSection& section : sections) {
        if (SameIgnoringCase(section.name, name)) return &section;
    }
    return nullptr;
}

// O primeiro valor da chave; fallback se a secao ou a chave nao existem.
std::wstring IniValue(const IniSection* section, const std::wstring& key, const std::wstring& fallback = L"") {
    if (!section) return fallback;
    for (const auto& value : section->values) {
        if (SameIgnoringCase(value.first, key)) return value.second;
    }
    return fallback;
}

// O _wtoi: espacos, sinal e digitos do comeco; 0 sem digitos.
long long LeadingInt(const std::wstring& text) {
    size_t i = 0;
    while (i < text.size() && (text[i] == L' ' || text[i] == L'\t')) ++i;
    bool negative = false;
    if (i < text.size() && (text[i] == L'+' || text[i] == L'-')) negative = text[i++] == L'-';
    long long value = 0;
    while (i < text.size() && text[i] >= L'0' && text[i] <= L'9' && value < 1000000000LL) {
        value = value * 10 + (text[i++] - L'0');
    }
    return negative ? -value : value;
}

// As contas [Account<n>] (como o MicroSIP as carrega: AccountSectionNumbers) e a em uso ([Settings] accountId).
// false se o disco falhou no meio (o .ini fica para a proxima abertura).
bool ImportAccounts(const std::vector<IniSection>& sections, const LegacyDecryptFunction& decrypt,
                    AccountsStore& accounts, LegacyImportResult& result) {
    const IniSection* settings = FindSection(sections, L"Settings");
    long long activeNumber = LeadingInt(IniValue(settings, L"accountId"));
    // Sem accountId (ou 0) e sem a conta local ligada, o MicroSIP usa a conta 1 (AccountSettings::Init).
    if (activeNumber == 0 && LeadingInt(IniValue(settings, L"enableLocalAccount")) == 0) activeNumber = 1;

    std::vector<std::wstring> names;
    for (const IniSection& section : sections) names.push_back(section.name);
    std::string activeId;
    std::string firstId;   // a primeira que migrou: a em uso quando a do accountId nao migrou
    for (int number : AccountSectionNumbers(names)) {
        const IniSection* section = FindSection(sections, L"Account" + std::to_wstring(number));
        SavedAccount account;
        if (ValidateServerAddress(AddressFromServer(IniValue(section, L"server")), &account.address) != ServerCheck::Ok) {
            continue;
        }
        if (ValidateRamal(IniValue(section, L"username"), &account.ramal) != RamalCheck::Ok) continue;
        account.transport = TransportFromName(IniValue(section, L"transport", L"udp"), Transport::Udp);
        account.name = AccountNameFromLabel(IniValue(section, L"label"));
        const std::wstring encrypted = IniValue(section, L"password");
        if (!encrypted.empty() && decrypt) {
            const std::optional<std::wstring> password = decrypt(encrypted);
            if (password) account.senha = *password;
        }
        if (!accounts.Save(account)) return false;
        ++result.accounts;
        if (account.senha.empty()) ++result.accountsWithoutPassword;
        if (firstId.empty()) firstId = accounts.LastSavedId();
        if (number == activeNumber) activeId = accounts.LastSavedId();
    }
    // A do accountId nao migrou (servidor ou ramal que nao servem, ou a conta local da rc.7): a primeira que migrou
    // fica em uso, senao o app abriria na tela Entrar com as contas migradas.
    if (activeId.empty()) activeId = firstId;
    return activeId.empty() || accounts.Active() || accounts.SetActive(activeId);
}

// ---------------------------------------------------------------- O Contacts.xml

// Um leitor de XML do tamanho do que o CMarkup grava: o elemento raiz e os filhos dele, com os atributos. false se
// o texto nao e XML (o MicroSIP, nesse caso, mostra a agenda vazia).
class XmlReader {
public:
    struct Element {
        std::string name;
        std::vector<std::pair<std::string, std::string>> attributes;
    };

    explicit XmlReader(const std::string& text) : text_(text) {}

    // A raiz e os filhos diretos dela.
    bool Read(Element& root, std::vector<Element>& children) {
        if (!SkipProlog()) return false;
        bool empty = false;
        if (!ReadStartTag(root, empty)) return false;
        if (empty) return true;
        return ReadContent(root.name, &children);
    }

private:
    bool AtEnd() const { return pos_ >= text_.size(); }
    bool StartsWith(const char* prefix) const { return text_.compare(pos_, std::char_traits<char>::length(prefix), prefix) == 0; }

    void SkipSpaces() {
        while (!AtEnd() && (text_[pos_] == ' ' || text_[pos_] == '\t' || text_[pos_] == '\r' || text_[pos_] == '\n')) {
            ++pos_;
        }
    }

    bool SkipPast(const char* marker) {
        const size_t found = text_.find(marker, pos_);
        if (found == std::string::npos) return false;
        pos_ = found + std::char_traits<char>::length(marker);
        return true;
    }

    // O que vem antes da raiz: <?xml ...?>, comentarios e <!DOCTYPE ...>.
    bool SkipProlog() {
        for (;;) {
            SkipSpaces();
            if (AtEnd()) return false;
            if (StartsWith("<?")) {
                if (!SkipPast("?>")) return false;
            } else if (StartsWith("<!--")) {
                if (!SkipPast("-->")) return false;
            } else if (StartsWith("<!")) {
                if (!SkipPast(">")) return false;
            } else {
                return text_[pos_] == '<';
            }
        }
    }

    static bool IsNameChar(char ch) {
        return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_' ||
               ch == '-' || ch == '.' || ch == ':' || static_cast<unsigned char>(ch) >= 0x80;
    }

    bool ReadName(std::string& name) {
        const size_t start = pos_;
        while (!AtEnd() && IsNameChar(text_[pos_])) ++pos_;
        name = text_.substr(start, pos_ - start);
        return !name.empty();
    }

    // "<nome atr="valor" ...>" ou "<nome .../>"; pos_ no '<'.
    bool ReadStartTag(Element& element, bool& empty) {
        ++pos_;
        if (!ReadName(element.name)) return false;
        for (;;) {
            SkipSpaces();
            if (AtEnd()) return false;
            if (StartsWith("/>")) {
                pos_ += 2;
                empty = true;
                return true;
            }
            if (text_[pos_] == '>') {
                ++pos_;
                empty = false;
                return true;
            }
            std::string name;
            if (!ReadName(name)) return false;
            SkipSpaces();
            if (AtEnd() || text_[pos_] != '=') return false;
            ++pos_;
            SkipSpaces();
            if (AtEnd() || (text_[pos_] != '"' && text_[pos_] != '\'')) return false;
            const char quote = text_[pos_++];
            const size_t close = text_.find(quote, pos_);
            if (close == std::string::npos) return false;
            element.attributes.emplace_back(name, Unescape(text_.substr(pos_, close - pos_)));
            pos_ = close + 1;
        }
    }

    // O conteudo de um elemento ate o "</nome>" dele. children: onde guardar os filhos diretos (nullptr: so pular).
    bool ReadContent(const std::string& name, std::vector<Element>* children) {
        for (;;) {
            const size_t open = text_.find('<', pos_);
            if (open == std::string::npos) return false;
            pos_ = open;
            if (StartsWith("<!--")) {
                if (!SkipPast("-->")) return false;
            } else if (StartsWith("<![CDATA[")) {
                if (!SkipPast("]]>")) return false;
            } else if (StartsWith("<?")) {
                if (!SkipPast("?>")) return false;
            } else if (StartsWith("</")) {
                pos_ += 2;
                std::string closing;
                if (!ReadName(closing) || closing != name) return false;
                SkipSpaces();
                if (AtEnd() || text_[pos_] != '>') return false;
                ++pos_;
                return true;
            } else {
                Element child;
                bool empty = false;
                if (!ReadStartTag(child, empty)) return false;
                if (!empty && !ReadContent(child.name, nullptr)) return false;
                if (children) children->push_back(std::move(child));
            }
        }
    }

    static void AppendUtf8(std::string& out, unsigned long code) {
        if (code == 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) code = 0xfffd;
        if (code < 0x80) {
            out.push_back(static_cast<char>(code));
        } else if (code < 0x800) {
            out.push_back(static_cast<char>(0xc0 | (code >> 6)));
            out.push_back(static_cast<char>(0x80 | (code & 0x3f)));
        } else if (code < 0x10000) {
            out.push_back(static_cast<char>(0xe0 | (code >> 12)));
            out.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3f)));
            out.push_back(static_cast<char>(0x80 | (code & 0x3f)));
        } else {
            out.push_back(static_cast<char>(0xf0 | (code >> 18)));
            out.push_back(static_cast<char>(0x80 | ((code >> 12) & 0x3f)));
            out.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3f)));
            out.push_back(static_cast<char>(0x80 | (code & 0x3f)));
        }
    }

    // &amp; &lt; &gt; &quot; &apos; &#N; &#xH;; outra coisa fica como esta.
    static std::string Unescape(const std::string& raw) {
        std::string out;
        out.reserve(raw.size());
        size_t i = 0;
        while (i < raw.size()) {
            const size_t semicolon = raw[i] == '&' ? raw.find(';', i) : std::string::npos;
            if (semicolon == std::string::npos || semicolon - i > 12) {
                out.push_back(raw[i++]);
                continue;
            }
            const std::string entity = raw.substr(i + 1, semicolon - i - 1);
            bool known = true;
            if (entity == "amp") out.push_back('&');
            else if (entity == "lt") out.push_back('<');
            else if (entity == "gt") out.push_back('>');
            else if (entity == "quot") out.push_back('"');
            else if (entity == "apos") out.push_back('\'');
            else if (entity.size() > 1 && entity[0] == '#') {
                const bool hex = entity[1] == 'x' || entity[1] == 'X';
                const std::string digits = entity.substr(hex ? 2 : 1);
                unsigned long code = 0;
                known = !digits.empty();
                for (char ch : digits) {
                    int digit = -1;
                    if (ch >= '0' && ch <= '9') digit = ch - '0';
                    else if (hex && ch >= 'a' && ch <= 'f') digit = ch - 'a' + 10;
                    else if (hex && ch >= 'A' && ch <= 'F') digit = ch - 'A' + 10;
                    if (digit < 0 || code > 0x10ffff) {
                        known = false;
                        break;
                    }
                    code = code * (hex ? 16 : 10) + static_cast<unsigned long>(digit);
                }
                if (known) AppendUtf8(out, code);
            } else {
                known = false;
            }
            if (known) {
                i = semicolon + 1;
            } else {
                out.push_back(raw[i++]);
            }
        }
        return out;
    }

    const std::string& text_;
    size_t pos_ = 0;
};

std::string Attribute(const XmlReader::Element& element, const char* name) {
    for (const auto& attribute : element.attributes) {
        if (attribute.first == name) return attribute.second;
    }
    return std::string();
}

std::wstring NormalizedNumber(const std::string& number) { return NormalizeDialString(Trim(Utf8ToWide(number))); }

// Os contatos do Contacts.xml como o Contacts::ContactsLoad os carrega: sem number, fica de fora; sem name, o nome e o
// sobrenome, ou o numero (ContactsService::ContactPrepare). A observacao e o comment.
bool ParseContactsXml(const std::string& bytes, std::vector<Contact>& contacts) {
    const std::string text = StripUtf8Bom(bytes);
    XmlReader reader(text);
    XmlReader::Element root;
    std::vector<XmlReader::Element> children;
    if (!reader.Read(root, children)) return false;
    if (root.name != "contacts") return true;
    for (const XmlReader::Element& child : children) {
        if (child.name != "contact") continue;
        Contact contact;
        contact.number = WideToUtf8(Trim(Utf8ToWide(Attribute(child, "number"))));
        if (contact.number.empty()) continue;
        contact.name = Trim(Utf8ToWide(Attribute(child, "name")));
        if (contact.name.empty()) {
            const std::wstring first = Utf8ToWide(Attribute(child, "firstname"));
            const std::wstring last = Utf8ToWide(Attribute(child, "lastname"));
            contact.name = Trim(first != last ? first + L" " + last : first);
        }
        if (contact.name.empty()) contact.name = Utf8ToWide(contact.number);
        contact.note = Trim(Utf8ToWide(Attribute(child, "comment")));
        contacts.push_back(std::move(contact));
    }
    return true;
}

// ---------------------------------------------------------------- O call_log.db

// type do MicroSIP 3.22 (Domain/Call.h): 0 feita, 1 recebida, 2 perdida, 3 atendida em outro aparelho (para quem
// estava aqui, uma recebida: nao conta como perdida).
bool KindFromCallType(int type, Recent::Kind& kind) {
    switch (type) {
        case 0: kind = Recent::Outgoing; return true;
        case 1: kind = Recent::Incoming; return true;
        case 2: kind = Recent::Missed; return true;
        case 3: kind = Recent::Incoming; return true;
        default: return false;
    }
}

std::string ColumnText(sqlite3_stmt* statement, int column) {
    const unsigned char* text = sqlite3_column_text(statement, column);
    return text ? std::string(reinterpret_cast<const char*>(text)) : std::string();
}

class Database {
public:
    explicit Database(const std::string& path) {
        if (sqlite3_open_v2(path.c_str(), &db_, SQLITE_OPEN_READONLY, nullptr) != SQLITE_OK) {
            sqlite3_close(db_);
            db_ = nullptr;
            return;
        }
        sqlite3_busy_timeout(db_, kBusyTimeoutMs);
    }
    ~Database() {
        if (db_) sqlite3_close(db_);
    }
    Database(const Database&) = delete;
    Database& operator=(const Database&) = delete;

    sqlite3* get() const { return db_; }

private:
    sqlite3* db_ = nullptr;
};

class Statement {
public:
    Statement(sqlite3* db, const char* sql) {
        if (sqlite3_prepare_v2(db, sql, -1, &statement_, nullptr) != SQLITE_OK) {
            sqlite3_finalize(statement_);
            statement_ = nullptr;
        }
    }
    ~Statement() { sqlite3_finalize(statement_); }
    Statement(const Statement&) = delete;
    Statement& operator=(const Statement&) = delete;

    sqlite3_stmt* get() const { return statement_; }

private:
    sqlite3_stmt* statement_ = nullptr;
};

// As ligacoes mais novas do call_log.db (inicio e duracao em ms). false se o banco nao abre, esta travado ou estragado.
bool ReadCallLog(const std::string& path, std::vector<Recent>& recents) {
    Database db(path);
    if (!db.get()) return false;
    {
        Statement table(db.get(), "SELECT 1 FROM sqlite_master WHERE type='table' AND name='call_log';");
        if (!table.get()) return false;
        const int step = sqlite3_step(table.get());
        if (step == SQLITE_DONE) return true;   // um banco sem a tabela: nada para migrar
        if (step != SQLITE_ROW) return false;
    }
    Statement rows(db.get(),
                   "SELECT number, name, type, time, duration FROM call_log ORDER BY time DESC, id DESC LIMIT 500;");
    if (!rows.get()) return false;
    for (;;) {
        const int step = sqlite3_step(rows.get());
        if (step == SQLITE_DONE) return true;
        if (step != SQLITE_ROW) return false;
        Recent recent;
        const int64_t seconds = sqlite3_column_int64(rows.get(), 3);
        if (!KindFromCallType(sqlite3_column_int(rows.get(), 2), recent.kind)) continue;
        // O MicroSIP recusa ligacao sem hora (CallsService::Validate).
        if (seconds <= 0 || seconds > INT64_MAX / 1000) continue;
        const int64_t duration = sqlite3_column_int64(rows.get(), 4);
        recent.number = ColumnText(rows.get(), 0);
        recent.name = ColumnText(rows.get(), 1);
        recent.startMs = seconds * 1000;
        recent.durationMs = duration > 0 && duration < INT64_MAX / 1000 ? duration * 1000 : 0;
        recents.push_back(std::move(recent));
    }
}

// ---------------------------------------------------------------- Cada arquivo

void RenameMigrated(FileSystem& files, const std::string& path) {
    // Se nao renomear, o arquivo e lido de novo na proxima vez, mas o que ja esta nas lojas nao entra repetido.
    files.Rename(path, path + kMigratedSuffix);
}

// true: lido (ou nao havia o arquivo).
bool ImportContacts(const std::string& path, ContactsStore& store, FileSystem& files) {
    if (path.empty() || !files.Exists(path)) return true;
    const std::optional<std::string> bytes = files.Read(path);
    if (!bytes) return false;
    std::vector<Contact> parsed;
    if (!ParseContactsXml(*bytes, parsed)) return false;
    const std::vector<Contact> existing = store.All();
    std::vector<Contact> fresh;
    for (Contact& contact : parsed) {
        const std::wstring number = NormalizedNumber(contact.number);
        const bool known = std::any_of(existing.begin(), existing.end(), [&](const Contact& other) {
            return other.name == contact.name && NormalizedNumber(other.number) == number;
        });
        if (!known) fresh.push_back(std::move(contact));
    }
    if (!fresh.empty() && !store.AddAll(std::move(fresh))) return false;
    RenameMigrated(files, path);
    return true;
}

bool ImportCalls(const std::string& path, RecentsStore& store, FileSystem& files) {
    if (path.empty() || !files.Exists(path)) return true;
    std::vector<Recent> parsed;
    if (!ReadCallLog(path, parsed)) return false;
    const std::vector<Recent> existing = store.All();
    std::vector<Recent> fresh;
    for (Recent& recent : parsed) {
        const bool known = std::any_of(existing.begin(), existing.end(), [&](const Recent& other) {
            return other.number == recent.number && other.startMs == recent.startMs && other.kind == recent.kind;
        });
        if (!known) fresh.push_back(std::move(recent));
    }
    if (!fresh.empty() && !store.AddAll(fresh)) return false;
    RenameMigrated(files, path);
    return true;
}

bool Contains(const std::vector<std::string>& items, const char* item) {
    return std::find(items.begin(), items.end(), item) != items.end();
}

}  // namespace

LegacyImportResult ImportLegacy(const LegacyPaths& paths, LegacyDecryptFunction decrypt, AccountsStore& accounts,
                                ContactsStore& contacts, RecentsStore& recents, FileSystem& files) {
    LegacyImportResult result;
    const std::vector<std::string> pending = accounts.PendingMigration();
    bool fromIni = false;
    bool accountsOk = true;
    bool wantContacts = Contains(pending, kPendingContacts);
    bool wantCalls = Contains(pending, kPendingCalls);

    if (accounts.All().empty() && !paths.ini.empty() && files.Exists(paths.ini)) {
        const std::optional<std::string> bytes = files.Read(paths.ini);
        if (!bytes) return result;   // travado ou ilegivel: fica para a proxima abertura
        fromIni = true;
        wantContacts = true;
        wantCalls = true;
        accountsOk = ImportAccounts(ParseIni(DecodeIniText(*bytes)), decrypt, accounts, result);
    }
    if (!fromIni && !wantContacts && !wantCalls) return result;

    std::vector<std::string> remaining;
    if (wantContacts) {
        result.contactsDone = ImportContacts(paths.contactsXml, contacts, files);
        if (!result.contactsDone) remaining.push_back(kPendingContacts);
    }
    if (wantCalls) {
        result.callsDone = ImportCalls(paths.callsDb, recents, files);
        if (!result.callsDone) remaining.push_back(kPendingCalls);
    }
    const bool pendingOk = remaining == pending || accounts.SetPendingMigration(remaining);
    // O .ini so sai quando as contas e o que ficou pendente estao no contas.json; senao, tudo de novo na proxima.
    if (fromIni && accountsOk && pendingOk) RenameMigrated(files, paths.ini);
    return result;
}

}  // namespace starsonic
