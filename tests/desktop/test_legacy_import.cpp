// Testes da migracao da rc.7 (starsonic/desktop/LegacyImport.h). Os arquivos do MicroSIP 3.22 sao criados num
// diretorio temporario de verdade, porque o SQLite so abre banco do disco: o StarsonicPhone.ini em UTF-16LE com BOM
// (como o MicroSIP o deixa), o Contacts.xml em UTF-8 (como o Contacts::ContactsSave grava) e o call_log.db com o
// esquema de Data/Database.cpp. A senha e "decifrada" por uma funcao de brinquedo.
#include <sqlite3.h>

#include <algorithm>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <random>
#include <sstream>
#include <string>
#include <vector>

#include "LegacyImport.h"
#include "nlohmann/json.hpp"
#include "test_support.h"

using namespace starsonic;
namespace fs = std::filesystem;

namespace {

// O disco de verdade, com caminhos UTF-8. failRenames faz todo Rename falhar.
class DiskFileSystem : public FileSystem {
public:
    bool failRenames = false;

    std::optional<std::string> Read(const std::string& path) const override {
        std::ifstream in(fs::u8path(path), std::ios::binary);
        if (!in) return std::nullopt;
        std::ostringstream bytes;
        bytes << in.rdbuf();
        if (in.bad()) return std::nullopt;
        return bytes.str();
    }

    bool WriteAtomic(const std::string& path, const std::string& bytes) override {
        std::error_code error;
        fs::create_directories(fs::u8path(path).parent_path(), error);
        const std::string temporary = path + ".tmp";
        {
            std::ofstream out(fs::u8path(temporary), std::ios::binary | std::ios::trunc);
            if (!out) return false;
            out << bytes;
            if (!out) return false;
        }
        fs::rename(fs::u8path(temporary), fs::u8path(path), error);
        return !error;
    }

    bool Exists(const std::string& path) const override {
        std::error_code error;
        return fs::exists(fs::u8path(path), error);
    }

    bool Rename(const std::string& from, const std::string& to) override {
        if (failRenames) return false;
        std::error_code error;
        fs::rename(fs::u8path(from), fs::u8path(to), error);
        return !error;
    }
};

// O cifrador de teste: "enc:" e os bytes em hexadecimal (o texto no JSON fica ASCII, como o base64 do DPAPI).
class HexCipher : public SecretCipher {
public:
    std::optional<std::string> Protect(const std::string& utf8) override {
        static const char digits[] = "0123456789abcdef";
        std::string out = "enc:";
        for (unsigned char ch : utf8) {
            out.push_back(digits[ch >> 4]);
            out.push_back(digits[ch & 0xf]);
        }
        return out;
    }
    std::optional<std::string> Unprotect(const std::string& sealed) override {
        if (sealed.compare(0, 4, "enc:") != 0 || sealed.size() % 2 != 0) return std::nullopt;
        std::string out;
        for (size_t i = 4; i + 1 < sealed.size(); i += 2) {
            out.push_back(static_cast<char>(std::stoi(sealed.substr(i, 2), nullptr, 16)));
        }
        return out;
    }
};

// O IniDecrypt de brinquedo: so decifra o que comeca com "cifrada:".
std::optional<std::wstring> ToyDecrypt(const std::wstring& encrypted) {
    const std::wstring prefix = L"cifrada:";
    if (encrypted.compare(0, prefix.size(), prefix) != 0) return std::nullopt;
    return encrypted.substr(prefix.size());
}

// O texto em UTF-16LE com o BOM, como o MicroSIP grava o .ini (wchar_t de 32 bits vira par substituto).
std::string Utf16LeWithBom(const std::wstring& text) {
    std::string bytes = "\xff\xfe";
    auto put = [&](unsigned unit) {
        bytes.push_back(static_cast<char>(unit & 0xff));
        bytes.push_back(static_cast<char>((unit >> 8) & 0xff));
    };
    for (wchar_t ch : text) {
        const unsigned long code = static_cast<unsigned long>(ch);
        if (code > 0xffff) {
            const unsigned long value = code - 0x10000;
            put(static_cast<unsigned>(0xd800 + (value >> 10)));
            put(static_cast<unsigned>(0xdc00 + (value & 0x3ff)));
        } else {
            put(static_cast<unsigned>(code));
        }
    }
    return bytes;
}

void WriteBytes(const std::string& path, const std::string& bytes) {
    std::ofstream out(fs::u8path(path), std::ios::binary | std::ios::trunc);
    out << bytes;
}

std::string ReadBytes(const std::string& path) {
    std::ifstream in(fs::u8path(path), std::ios::binary);
    std::ostringstream bytes;
    bytes << in.rdbuf();
    return bytes.str();
}

struct CallRow {
    std::string callId;
    std::string number;
    std::string name;
    int type;
    int64_t time;       // segundos desde 1970
    int duration;       // segundos
};

// O call_log.db como o MicroSIP 3.22 cria (Database::InitCalls) e grava (CallsRepository::Add).
void CreateCallLog(const std::string& path, const std::vector<CallRow>& rows) {
    sqlite3* db = nullptr;
    REQUIRE(sqlite3_open_v2(path.c_str(), &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nullptr) == SQLITE_OK);
    const char* schema =
        "CREATE TABLE IF NOT EXISTS call_log ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT"
        ",callId TEXT NOT NULL"
        ",number TEXT NOT NULL"
        ",name TEXT NOT NULL"
        ",type INTEGER"
        ",time INTEGER"
        ",duration INTEGER"
        ",info TEXT NOT NULL"
        ");"
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_call_log_callId_unique ON call_log(callId);";
    REQUIRE(sqlite3_exec(db, schema, nullptr, nullptr, nullptr) == SQLITE_OK);
    sqlite3_stmt* insert = nullptr;
    REQUIRE(sqlite3_prepare_v2(db,
                               "INSERT INTO call_log (callId, number, name, type, time, duration, info) "
                               "VALUES (?, ?, ?, ?, ?, ?, ?);",
                               -1, &insert, nullptr) == SQLITE_OK);
    for (const CallRow& row : rows) {
        sqlite3_bind_text(insert, 1, row.callId.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(insert, 2, row.number.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(insert, 3, row.name.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(insert, 4, row.type);
        sqlite3_bind_int64(insert, 5, row.time);
        sqlite3_bind_int(insert, 6, row.duration);
        sqlite3_bind_text(insert, 7, "", -1, SQLITE_TRANSIENT);
        REQUIRE(sqlite3_step(insert) == SQLITE_DONE);
        sqlite3_reset(insert);
    }
    sqlite3_finalize(insert);
    sqlite3_close(db);
}

// Duas contas como a rc.7 as grava (AccountSettings::AccountSave): a 1 com o rotulo automatico, a 2 com nome.
const wchar_t* const kTwoAccountsIni =
    L"[Global]\r\n"
    L"version=0.0.1-rc.7\r\n"
    L"checkUpdatesTime=1761000000\r\n"
    L"[Settings]\r\n"
    L"accountId=2\r\n"
    L"enableLocalAccount=0\r\n"
    L"[Account1]\r\n"
    L"label=1001 \u00b7 pbx.example.com\r\n"
    L"server=pbx.example.com:5060\r\n"
    L"proxy=\r\n"
    L"domain=pbx.example.com\r\n"
    L"username=1001\r\n"
    L"password=cifrada:segredo\r\n"
    L"authID=\r\n"
    L"displayName=1001\r\n"
    L"transport=udp\r\n"
    L"[Account2]\r\n"
    L"label=Escrit\u00f3rio\r\n"
    L"server=starcloud1.example.com:35060\r\n"
    L"proxy=\r\n"
    L"domain=starcloud1.example.com:35060\r\n"
    L"username=2002\r\n"
    L"password=cifrada:s\u00e9nha 2\r\n"
    L"displayName=2002\r\n"
    L"transport=tcp\r\n";

// O Contacts.xml como o Contacts::ContactsSave grava (CMarkup, UTF-8).
const char* const kContactsXml =
    "<?xml version=\"1.0\"?>\r\n"
    "<contacts>\r\n"
    "<contact name=\"\xc3\x81lvaro &amp; Cia\" number=\"(11) 98888-7777\" firstname=\"\" lastname=\"\" phone=\"\" "
    "mobile=\"\" email=\"\" address=\"\" city=\"\" state=\"\" zip=\"\" comment=\"cliente &quot;ouro&quot;\" id=\"\" "
    "info=\"\" presence=\"0\" starred=\"0\" directory=\"0\"/>\r\n"
    "<contact name=\"Recep&#xe7;&#227;o\" number=\"2000\" comment=\"\" presence=\"1\" starred=\"0\" "
    "directory=\"0\"/>\r\n"
    "<contact name=\"\" number=\"3003\" firstname=\"Maria\" lastname=\"Silva\" comment=\"\"/>\r\n"
    "<contact name=\"\" number=\"4004\" firstname=\"\" lastname=\"\" comment=\"\"/>\r\n"
    "<contact name=\"Sem numero\" number=\"\" phone=\"5555\" comment=\"\"/>\r\n"
    "</contacts>\r\n";

// 21/10/2026 12:00:00 UTC, em segundos.
const int64_t kNoon = 1792584000;

std::vector<CallRow> SampleCalls() {
    return {
        {"c1@pbx", "1001", "Fulano", 0, kNoon, 65},          // feita
        {"c2@pbx", "2002", "Recep\xc3\xa7\xc3\xa3o", 1, kNoon + 60, 12},   // recebida
        {"c3@pbx", "3003", "3003", 2, kNoon + 120, 0},       // perdida
        {"c4@pbx", "4004", "Grupo", 3, kNoon + 180, 0},      // atendida em outro aparelho
    };
}

std::string RandomSuffix() {
    std::random_device device;
    char buffer[24];
    std::snprintf(buffer, sizeof(buffer), "%08x%08x", device(), device());
    return buffer;
}

// Um diretorio com os arquivos da rc.7 e as lojas novas (na subpasta "novo").
struct Fixture {
    fs::path dir;
    DiskFileSystem files;
    HexCipher cipher;
    LegacyPaths paths;
    std::string accountsPath;
    std::string contactsPath;
    std::string recentsPath;

    Fixture() {
        dir = fs::temp_directory_path() / ("starsonic-legacy-" + RandomSuffix());
        fs::create_directories(dir);
        paths.ini = (dir / "StarsonicPhone.ini").u8string();
        paths.contactsXml = (dir / "Contacts.xml").u8string();
        paths.callsDb = (dir / "call_log.db").u8string();
        accountsPath = (dir / "novo" / "contas.json").u8string();
        contactsPath = (dir / "novo" / "contatos.json").u8string();
        recentsPath = (dir / "novo" / "recentes.json").u8string();
    }
    ~Fixture() {
        std::error_code error;
        fs::remove_all(dir, error);
    }

    void WriteIni(const std::wstring& text) const { WriteBytes(paths.ini, Utf16LeWithBom(text)); }
    void WriteContacts(const std::string& xml) const { WriteBytes(paths.contactsXml, xml); }
    void WriteCalls(const std::vector<CallRow>& rows) const { CreateCallLog(paths.callsDb, rows); }
    void WriteAll() const {
        WriteIni(kTwoAccountsIni);
        WriteContacts(kContactsXml);
        WriteCalls(SampleCalls());
    }
    bool Exists(const std::string& path) const { return fs::exists(fs::u8path(path)); }
};

// As tres lojas, carregadas do disco do fixture (como o app as abre).
struct Stores {
    AccountsStore accounts;
    ContactsStore contacts;
    RecentsStore recents;

    explicit Stores(Fixture& fixture)
        : accounts(fixture.files, fixture.cipher, fixture.accountsPath),
          contacts(fixture.files, fixture.contactsPath),
          recents(fixture.files, fixture.recentsPath) {
        REQUIRE(accounts.Load());
        REQUIRE(contacts.Load());
        REQUIRE(recents.Load());
    }
};

LegacyImportResult Import(Fixture& fixture, Stores& stores) {
    return ImportLegacy(fixture.paths, ToyDecrypt, stores.accounts, stores.contacts, stores.recents, fixture.files);
}

nlohmann::json AccountsJson(const Fixture& fixture) {
    return nlohmann::json::parse(ReadBytes(fixture.accountsPath));
}

}  // namespace

TEST_CASE("two accounts migrate with the active one in use") {
    Fixture fixture;
    fixture.WriteIni(kTwoAccountsIni);
    Stores stores(fixture);

    const LegacyImportResult result = Import(fixture, stores);
    CHECK(result.accounts == 2);
    CHECK(result.accountsWithoutPassword == 0);

    // Como o app as ve na proxima abertura: lidas de novo do contas.json.
    Stores reopened(fixture);
    const std::vector<SavedAccount> accounts = reopened.accounts.All();
    REQUIRE(accounts.size() == 2);
    CHECK(accounts[0].address == L"pbx.example.com");
    CHECK(accounts[0].transport == Transport::Udp);
    CHECK(accounts[0].ramal == L"1001");
    CHECK(accounts[0].name == L"");   // o rotulo automatico nao vira nome
    CHECK(accounts[0].senha == L"segredo");
    CHECK_FALSE(accounts[0].needsPassword);
    CHECK(accounts[1].address == L"starcloud1.example.com");
    CHECK(accounts[1].transport == Transport::Tcp);
    CHECK(accounts[1].ramal == L"2002");
    CHECK(accounts[1].name == L"Escrit\u00f3rio");
    CHECK(accounts[1].senha == L"s\u00e9nha 2");
    CHECK_FALSE(accounts[1].needsPassword);

    const std::optional<SavedAccount> active = reopened.accounts.Active();
    REQUIRE(active);
    CHECK(active->ramal == L"2002");
    CHECK(active->senha == L"s\u00e9nha 2");   // entra sem digitar a senha
    // A senha nunca vai em claro para o contas.json.
    CHECK(ReadBytes(fixture.accountsPath).find("segredo") == std::string::npos);
}

TEST_CASE("an account whose password does not decrypt migrates without it") {
    Fixture fixture;
    std::wstring ini = kTwoAccountsIni;
    const std::wstring good = L"password=cifrada:segredo";
    ini.replace(ini.find(good), good.size(), L"password=9f8e7d6c5b4a");
    fixture.WriteIni(ini);
    Stores stores(fixture);

    const LegacyImportResult result = Import(fixture, stores);
    CHECK(result.accounts == 2);
    CHECK(result.accountsWithoutPassword == 1);

    Stores reopened(fixture);
    const std::vector<SavedAccount> accounts = reopened.accounts.All();
    REQUIRE(accounts.size() == 2);
    CHECK(accounts[0].ramal == L"1001");
    CHECK(accounts[0].address == L"pbx.example.com");
    CHECK(accounts[0].senha.empty());
    CHECK(accounts[0].needsPassword);   // a tela Entrar pede so a senha
    CHECK(accounts[1].senha == L"s\u00e9nha 2");
    CHECK_FALSE(accounts[1].needsPassword);
    REQUIRE(reopened.accounts.Active());
    CHECK(reopened.accounts.Active()->ramal == L"2002");
}

TEST_CASE("contacts and calls migrate from the databases") {
    Fixture fixture;
    fixture.WriteAll();
    Stores stores(fixture);

    const LegacyImportResult result = Import(fixture, stores);
    CHECK(result.contactsDone);
    CHECK(result.callsDone);

    Stores reopened(fixture);
    const std::vector<Contact> contacts = reopened.contacts.All();
    REQUIRE(contacts.size() == 4);   // o sem numero fica de fora, como no MicroSIP
    // Na ordem da agenda (sem acento e sem caixa; os digitos antes das letras).
    CHECK(contacts[0].name == L"4004");          // sem nome nenhum: o numero (ContactPrepare)
    CHECK(contacts[0].number == "4004");
    CHECK(contacts[1].name == L"\u00c1lvaro & Cia");
    CHECK(contacts[1].number == "(11) 98888-7777");
    CHECK(contacts[1].note == L"cliente \"ouro\"");
    CHECK(contacts[2].name == L"Maria Silva");   // sem nome: o nome e o sobrenome (ContactPrepare)
    CHECK(contacts[2].number == "3003");
    CHECK(contacts[3].name == L"Recep\u00e7\u00e3o");
    CHECK(contacts[3].number == "2000");
    CHECK(contacts[3].note == L"");

    const std::vector<Recent> recents = reopened.recents.All();
    REQUIRE(recents.size() == 4);
    // A mais nova primeiro; inicio e duracao em milissegundos.
    CHECK(recents[0].number == "4004");
    CHECK(recents[0].name == "Grupo");
    CHECK(recents[0].kind == Recent::Incoming);   // atendida em outro aparelho: recebida, nao perdida
    CHECK(recents[0].startMs == (kNoon + 180) * 1000);
    CHECK(recents[1].number == "3003");
    CHECK(recents[1].kind == Recent::Missed);
    CHECK(recents[1].durationMs == 0);
    CHECK(recents[2].number == "2002");
    CHECK(recents[2].name == "Recep\xc3\xa7\xc3\xa3o");
    CHECK(recents[2].kind == Recent::Incoming);
    CHECK(recents[2].durationMs == 12000);
    CHECK(recents[3].number == "1001");
    CHECK(recents[3].kind == Recent::Outgoing);
    CHECK(recents[3].startMs == kNoon * 1000);
    CHECK(recents[3].durationMs == 65000);
    CHECK(reopened.recents.MissedCount(0) == 1);
}

TEST_CASE("migrated files are renamed and not read again") {
    Fixture fixture;
    fixture.WriteAll();
    const std::string iniBytes = ReadBytes(fixture.paths.ini);
    const std::string xmlBytes = ReadBytes(fixture.paths.contactsXml);
    const std::string dbBytes = ReadBytes(fixture.paths.callsDb);
    {
        Stores stores(fixture);
        const LegacyImportResult result = Import(fixture, stores);
        CHECK(result.accounts == 2);
    }

    // Voltar para a rc.7 e renomear de volta: os arquivos estao inteiros.
    CHECK_FALSE(fixture.Exists(fixture.paths.ini));
    CHECK_FALSE(fixture.Exists(fixture.paths.contactsXml));
    CHECK_FALSE(fixture.Exists(fixture.paths.callsDb));
    CHECK(ReadBytes(fixture.paths.ini + ".migrado") == iniBytes);
    CHECK(ReadBytes(fixture.paths.contactsXml + ".migrado") == xmlBytes);
    CHECK(ReadBytes(fixture.paths.callsDb + ".migrado") == dbBytes);
    CHECK(AccountsJson(fixture).count("migracao_pendente") == 0);

    {
        Stores stores(fixture);
        const LegacyImportResult again = Import(fixture, stores);
        CHECK(again.accounts == 0);
        CHECK_FALSE(again.contactsDone);
        CHECK_FALSE(again.callsDone);
        CHECK(stores.accounts.All().size() == 2);
        CHECK(stores.contacts.All().size() == 4);
        CHECK(stores.recents.All().size() == 4);
    }

    // Um .ini que aparece de novo (a rc.7 voltou a rodar) nao e lido: a migracao ja aconteceu.
    fixture.WriteAll();
    Stores stores(fixture);
    const LegacyImportResult third = Import(fixture, stores);
    CHECK(third.accounts == 0);
    CHECK(stores.accounts.All().size() == 2);
    CHECK(stores.contacts.All().size() == 4);
    CHECK(stores.recents.All().size() == 4);
    CHECK(fixture.Exists(fixture.paths.ini));
}

TEST_CASE("migration retries contacts and calls that could not be read") {
    Fixture fixture;
    fixture.WriteIni(kTwoAccountsIni);
    fixture.WriteContacts("isto nao e um Contacts.xml");   // ilegivel
    fixture.WriteCalls(SampleCalls());

    // A rc.7 ainda com o banco travado (uma escrita no meio).
    sqlite3* lock = nullptr;
    REQUIRE(sqlite3_open_v2(fixture.paths.callsDb.c_str(), &lock, SQLITE_OPEN_READWRITE, nullptr) == SQLITE_OK);
    REQUIRE(sqlite3_exec(lock, "BEGIN EXCLUSIVE;", nullptr, nullptr, nullptr) == SQLITE_OK);
    {
        Stores stores(fixture);
        const LegacyImportResult result = Import(fixture, stores);
        CHECK(result.accounts == 2);
        CHECK_FALSE(result.contactsDone);
        CHECK_FALSE(result.callsDone);
        CHECK(stores.contacts.All().empty());
        CHECK(stores.recents.All().empty());
    }
    // As contas estao migradas; o que falta fica anotado no contas.json, e os arquivos com o nome de antes.
    CHECK(AccountsJson(fixture)["migracao_pendente"] == nlohmann::json::array({"contatos", "recentes"}));
    CHECK_FALSE(fixture.Exists(fixture.paths.ini));
    CHECK(fixture.Exists(fixture.paths.contactsXml));
    CHECK(fixture.Exists(fixture.paths.callsDb));
    {
        Stores stores(fixture);
        REQUIRE(stores.accounts.Active());
        CHECK(stores.accounts.Active()->ramal == L"2002");
        CHECK(stores.accounts.PendingMigration() == std::vector<std::string>{"contatos", "recentes"});
    }

    // Na proxima abertura o banco esta livre e o arquivo, legivel: a migracao termina.
    REQUIRE(sqlite3_exec(lock, "COMMIT;", nullptr, nullptr, nullptr) == SQLITE_OK);
    sqlite3_close(lock);
    fixture.WriteContacts(kContactsXml);
    {
        Stores stores(fixture);
        const LegacyImportResult result = Import(fixture, stores);
        CHECK(result.accounts == 0);
        CHECK(result.contactsDone);
        CHECK(result.callsDone);
        CHECK(stores.accounts.All().size() == 2);
        CHECK(stores.contacts.All().size() == 4);
        CHECK(stores.recents.All().size() == 4);
    }
    CHECK(AccountsJson(fixture).count("migracao_pendente") == 0);
    CHECK(fixture.Exists(fixture.paths.contactsXml + ".migrado"));
    CHECK(fixture.Exists(fixture.paths.callsDb + ".migrado"));
    Stores stores(fixture);
    CHECK(stores.accounts.PendingMigration().empty());
    REQUIRE(stores.accounts.Active());
    CHECK(stores.accounts.Active()->ramal == L"2002");
}

TEST_CASE("a missing ini means nothing to migrate") {
    Fixture fixture;
    fixture.WriteContacts(kContactsXml);
    fixture.WriteCalls(SampleCalls());
    Stores stores(fixture);

    const LegacyImportResult result = Import(fixture, stores);
    CHECK(result.accounts == 0);
    CHECK(result.accountsWithoutPassword == 0);
    CHECK_FALSE(result.contactsDone);
    CHECK_FALSE(result.callsDone);
    CHECK(stores.accounts.All().empty());
    CHECK(stores.contacts.All().empty());
    CHECK(stores.recents.All().empty());
    CHECK_FALSE(fixture.Exists(fixture.accountsPath));
    CHECK(fixture.Exists(fixture.paths.contactsXml));
    CHECK(fixture.Exists(fixture.paths.callsDb));
}

// ---- Mais casos ----

TEST_CASE("the ini is read the way GetPrivateProfileString reads it") {
    Fixture fixture;
    // Secoes e chaves sem diferenciar maiusculas, espacos em volta do '=', aspas em volta do valor, comentario,
    // chave repetida (vale a primeira) e a secao [Settings] sem accountId (o MicroSIP usa a conta 1).
    fixture.WriteIni(
        L"; comentario\r\n"
        L"[settings]\r\n"
        L"[ACCOUNT1]\r\n"
        L"  Server = \"PBX.Example.com:5070\"  \r\n"
        L"USERNAME=  1001\r\n"
        L"username=9999\r\n"
        L"Password='cifrada:a b'\r\n"
        L"Transport=TCP\r\n"
        L"label=  Casa  \r\n");
    Stores stores(fixture);
    const LegacyImportResult result = Import(fixture, stores);
    CHECK(result.accounts == 1);
    const std::vector<SavedAccount> accounts = stores.accounts.All();
    REQUIRE(accounts.size() == 1);
    CHECK(accounts[0].address == L"pbx.example.com");
    CHECK(accounts[0].ramal == L"1001");
    CHECK(accounts[0].senha == L"a b");
    CHECK(accounts[0].transport == Transport::Tcp);
    CHECK(accounts[0].name == L"Casa");
    REQUIRE(stores.accounts.Active());
    CHECK(stores.accounts.Active()->ramal == L"1001");
}

TEST_CASE("an ini without the UTF-16 BOM is read as UTF-8") {
    Fixture fixture;
    WriteBytes(fixture.paths.ini,
               "[Account1]\nserver=pbx.example.com\nusername=1001\npassword=\nlabel=S\xc3\xa3o Paulo\n");
    Stores stores(fixture);
    const LegacyImportResult result = Import(fixture, stores);
    CHECK(result.accounts == 1);
    CHECK(result.accountsWithoutPassword == 1);   // sem senha gravada: pede a senha
    REQUIRE(stores.accounts.All().size() == 1);
    CHECK(stores.accounts.All()[0].name == L"S\u00e3o Paulo");
    CHECK(stores.accounts.All()[0].transport == Transport::Udp);   // sem transport: udp, como o MicroSIP
    CHECK(stores.accounts.All()[0].needsPassword);
}

TEST_CASE("accounts that cannot be used are skipped") {
    Fixture fixture;
    fixture.WriteIni(
        L"[Settings]\r\naccountId=1\r\n"
        L"[Account1]\r\nserver=servidor invalido\r\nusername=1001\r\npassword=cifrada:x\r\n"
        L"[Account2]\r\nserver=pbx.example.com\r\nusername=\r\npassword=\r\n"
        L"[Account3]\r\nserver=pbx.example.com:5060\r\nusername=3003\r\npassword=cifrada:y\r\n"
        L"[Account04]\r\nserver=pbx.example.com\r\nusername=4004\r\n");
    Stores stores(fixture);
    const LegacyImportResult result = Import(fixture, stores);
    CHECK(result.accounts == 1);
    REQUIRE(stores.accounts.All().size() == 1);
    CHECK(stores.accounts.All()[0].ramal == L"3003");
    CHECK_FALSE(stores.accounts.Active());   // a em uso (a 1) nao migrou: nenhuma em uso
    CHECK_FALSE(fixture.Exists(fixture.paths.ini));
}

TEST_CASE("an ini with no account still migrates contacts and calls") {
    Fixture fixture;
    fixture.WriteIni(L"[Global]\r\nversion=0.0.1-rc.7\r\n[Settings]\r\naccountId=0\r\n");
    fixture.WriteContacts(kContactsXml);
    fixture.WriteCalls(SampleCalls());
    Stores stores(fixture);
    const LegacyImportResult result = Import(fixture, stores);
    CHECK(result.accounts == 0);
    CHECK(result.contactsDone);
    CHECK(result.callsDone);
    CHECK(stores.contacts.All().size() == 4);
    CHECK(stores.recents.All().size() == 4);
    CHECK(fixture.Exists(fixture.paths.ini + ".migrado"));
}

TEST_CASE("missing contacts and calls files count as done") {
    Fixture fixture;
    fixture.WriteIni(kTwoAccountsIni);
    Stores stores(fixture);
    const LegacyImportResult result = Import(fixture, stores);
    CHECK(result.accounts == 2);
    CHECK(result.contactsDone);
    CHECK(result.callsDone);
    CHECK(AccountsJson(fixture).count("migracao_pendente") == 0);
}

TEST_CASE("contacts and calls are not added twice when a rename fails") {
    Fixture fixture;
    fixture.WriteIni(L"[Settings]\r\naccountId=0\r\n");
    fixture.WriteContacts(kContactsXml);
    fixture.WriteCalls(SampleCalls());
    fixture.files.failRenames = true;
    {
        Stores stores(fixture);
        const LegacyImportResult result = Import(fixture, stores);
        CHECK(result.contactsDone);
        CHECK(result.callsDone);
    }
    // Nada foi renomeado; na proxima abertura o .ini e lido de novo (nao ha contas), mas nada entra repetido.
    fixture.files.failRenames = false;
    CHECK(fixture.Exists(fixture.paths.ini));
    Stores stores(fixture);
    const LegacyImportResult again = Import(fixture, stores);
    CHECK(again.contactsDone);
    CHECK(again.callsDone);
    CHECK(stores.contacts.All().size() == 4);
    CHECK(stores.recents.All().size() == 4);
    CHECK(fixture.Exists(fixture.paths.contactsXml + ".migrado"));
}

TEST_CASE("a damaged call log or an empty database") {
    SUBCASE("a file that is not a database stays pending") {
        Fixture fixture;
        fixture.WriteIni(kTwoAccountsIni);
        WriteBytes(fixture.paths.callsDb, std::string(4096, 'x'));
        Stores stores(fixture);
        const LegacyImportResult result = Import(fixture, stores);
        CHECK(result.contactsDone);
        CHECK_FALSE(result.callsDone);
        CHECK(stores.accounts.PendingMigration() == std::vector<std::string>{"recentes"});
        CHECK(fixture.Exists(fixture.paths.callsDb));
    }
    SUBCASE("a database without the call_log table has nothing to migrate") {
        Fixture fixture;
        fixture.WriteIni(kTwoAccountsIni);
        WriteBytes(fixture.paths.callsDb, "");   // o SQLite trata o arquivo vazio como banco vazio
        Stores stores(fixture);
        const LegacyImportResult result = Import(fixture, stores);
        CHECK(result.callsDone);
        CHECK(stores.recents.All().empty());
        CHECK(stores.accounts.PendingMigration().empty());
    }
    SUBCASE("calls with an unknown type or no time are skipped") {
        Fixture fixture;
        fixture.WriteIni(kTwoAccountsIni);
        fixture.WriteCalls({{"a", "1001", "A", 7, kNoon, 1}, {"b", "1002", "B", 0, 0, 1}, {"c", "1003", "C", 1, kNoon, 5}});
        Stores stores(fixture);
        Import(fixture, stores);
        REQUIRE(stores.recents.All().size() == 1);
        CHECK(stores.recents.All()[0].number == "1003");
    }
}

TEST_CASE("only the newest 500 calls migrate") {
    Fixture fixture;
    fixture.WriteIni(kTwoAccountsIni);
    std::vector<CallRow> rows;
    for (int i = 0; i < 600; ++i) {
        rows.push_back({"id" + std::to_string(i), std::to_string(1000 + i), "N", 1, kNoon + i, 1});
    }
    fixture.WriteCalls(rows);
    Stores stores(fixture);
    Import(fixture, stores);
    const std::vector<Recent> recents = stores.recents.All();
    REQUIRE(recents.size() == RecentsStore::kMax);
    CHECK(recents.front().number == "1599");
    CHECK(recents.back().number == "1100");
}

TEST_CASE("the pending migration survives other saves of contas.json") {
    MemoryFileSystem files;
    HexCipher cipher;
    {
        AccountsStore store(files, cipher, "contas.json");
        REQUIRE(store.SetPendingMigration({"recentes"}));
        SavedAccount account;
        account.address = L"pbx.example.com";
        account.ramal = L"1001";
        REQUIRE(store.Save(account));
        REQUIRE(store.SetActive(store.LastSavedId()));
    }
    AccountsStore store(files, cipher, "contas.json");
    REQUIRE(store.Load());
    CHECK(store.PendingMigration() == std::vector<std::string>{"recentes"});
    REQUIRE(store.SetPendingMigration({}));
    CHECK(nlohmann::json::parse(files.files.at("contas.json")).count("migracao_pendente") == 0);
}
