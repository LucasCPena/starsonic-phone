// Testes das lojas do app de PC (starsonic/desktop/Stores.h): disco em memoria e um cifrador de brinquedo.
#include <climits>
#include <string>
#include <vector>

#include "nlohmann/json.hpp"
#include "Stores.h"
#include "test_support.h"

using namespace starsonic;

namespace {

// O cifrador de teste: inverte os bytes e poe um prefixo. Unprotect recusa o que nao tem o prefixo.
class ReversingCipher : public SecretCipher {
public:
    bool failProtect = false;

    std::optional<std::string> Protect(const std::string& utf8) override {
        if (failProtect) return std::nullopt;
        return "enc:" + std::string(utf8.rbegin(), utf8.rend());
    }

    std::optional<std::string> Unprotect(const std::string& base64) override {
        if (base64.compare(0, 4, "enc:") != 0) return std::nullopt;
        const std::string body = base64.substr(4);
        return std::string(body.rbegin(), body.rend());
    }
};

const char* const kAccountsPath = "dados/contas.json";
const char* const kContactsPath = "dados/contatos.json";
const char* const kRecentsPath = "dados/recentes.json";
const char* const kSettingsPath = "dados/config.json";

SavedAccount MakeAccount(const std::string& id, const std::wstring& ramal, const std::wstring& password) {
    SavedAccount account;
    account.id = id;
    account.address = L"pbx.example.com";
    account.transport = Transport::Tcp;
    account.ramal = ramal;
    account.senha = password;
    account.name = L"Jo\u00e3o";
    return account;
}

Contact MakeContact(const std::string& id, const std::wstring& name, const std::string& number) {
    Contact contact;
    contact.id = id;
    contact.name = name;
    contact.number = number;
    return contact;
}

Recent MakeRecent(int64_t startMs, Recent::Kind kind = Recent::Incoming, const std::string& number = "1001") {
    Recent recent;
    recent.number = number;
    recent.name = "Fulano";
    recent.kind = kind;
    recent.startMs = startMs;
    recent.durationMs = 1500;
    return recent;
}

// O operator== de Recent fica no CallController.cpp (do motor); estes testes nao o compilam.
bool SameRecents(const std::vector<Recent>& a, const std::vector<Recent>& b) {
    if (a.size() != b.size()) return false;
    for (size_t i = 0; i < a.size(); ++i) {
        if (a[i].number != b[i].number || a[i].name != b[i].name || a[i].kind != b[i].kind ||
            a[i].startMs != b[i].startMs || a[i].durationMs != b[i].durationMs) {
            return false;
        }
    }
    return true;
}

std::vector<std::wstring> Names(const std::vector<Contact>& contacts) {
    std::vector<std::wstring> names;
    for (const Contact& contact : contacts) names.push_back(contact.name);
    return names;
}

}  // namespace

TEST_CASE("accounts keep the password only protected on disk") {
    MemoryFileSystem files;
    ReversingCipher cipher;
    AccountsStore store(files, cipher, kAccountsPath);
    REQUIRE(store.Save(MakeAccount("a1", L"1001", L"segredo123")));

    const std::string json = files.files.at(kAccountsPath);
    CHECK(json.find("segredo123") == std::string::npos);
    CHECK(json.find("senha_protegida") != std::string::npos);
    CHECK(json.find("enc:321oderges") != std::string::npos);
    CHECK(files.files.count(std::string(kAccountsPath) + ".tmp") == 0);

    AccountsStore reloaded(files, cipher, kAccountsPath);
    REQUIRE(reloaded.Load());
    REQUIRE(reloaded.All().size() == 1);
    const SavedAccount account = reloaded.All()[0];
    CHECK(account.id == "a1");
    CHECK(account.senha == L"segredo123");
    CHECK(account.needsPassword == false);
    CHECK(account.address == L"pbx.example.com");
    CHECK(account.transport == Transport::Tcp);
    CHECK(account.ramal == L"1001");
    CHECK(account.name == L"Jo\u00e3o");
}

TEST_CASE("an account whose password does not decrypt asks for it") {
    MemoryFileSystem files;
    ReversingCipher cipher;
    {
        AccountsStore store(files, cipher, kAccountsPath);
        REQUIRE(store.Save(MakeAccount("a1", L"1001", L"segredo123")));
        REQUIRE(store.Save(MakeAccount("a2", L"1002", L"outra")));
    }
    // Outro usuario/PC: o texto gravado da primeira conta nao decifra.
    nlohmann::json json = nlohmann::json::parse(files.files.at(kAccountsPath));
    json["contas"][0]["senha_protegida"] = "lixo";
    files.files[kAccountsPath] = json.dump();

    AccountsStore store(files, cipher, kAccountsPath);
    REQUIRE(store.Load());
    REQUIRE(store.All().size() == 2);
    CHECK(store.All()[0].needsPassword);
    CHECK(store.All()[0].senha.empty());
    CHECK(store.All()[0].ramal == L"1001");
    CHECK_FALSE(store.All()[1].needsPassword);
    CHECK(store.All()[1].senha == L"outra");

    // Gravar outra conta nao apaga o que a primeira tinha no disco.
    SavedAccount third = MakeAccount("a3", L"1003", L"x");
    REQUIRE(store.Save(third));
    CHECK(nlohmann::json::parse(files.files.at(kAccountsPath))["contas"][0]["senha_protegida"] == "lixo");
}

TEST_CASE("an account saved without a password asks for it after a reload") {
    MemoryFileSystem files;
    ReversingCipher cipher;
    AccountsStore store(files, cipher, kAccountsPath);
    REQUIRE(store.Save(MakeAccount("a1", L"1001", L"")));
    AccountsStore reloaded(files, cipher, kAccountsPath);
    REQUIRE(reloaded.Load());
    CHECK(reloaded.All()[0].needsPassword);
    CHECK(reloaded.All()[0].senha.empty());
}

TEST_CASE("the active account survives a reload") {
    MemoryFileSystem files;
    ReversingCipher cipher;
    AccountsStore store(files, cipher, kAccountsPath);
    REQUIRE(store.Save(MakeAccount("a1", L"1001", L"um")));
    REQUIRE(store.Save(MakeAccount("a2", L"1002", L"dois")));
    CHECK_FALSE(store.Active().has_value());
    REQUIRE(store.SetActive("a2"));
    CHECK(store.Active()->id == "a2");
    CHECK_FALSE(store.SetActive("nao-existe"));
    CHECK(store.Active()->id == "a2");

    AccountsStore reloaded(files, cipher, kAccountsPath);
    REQUIRE(reloaded.Load());
    REQUIRE(reloaded.Active().has_value());
    CHECK(reloaded.Active()->id == "a2");
    CHECK(reloaded.Active()->senha == L"dois");

    // Substituir a conta em uso continua em uso.
    SavedAccount edited = MakeAccount("a2", L"1002", L"tres");
    edited.name = L"Outro nome";
    REQUIRE(reloaded.Save(edited));
    CHECK(reloaded.All().size() == 2);
    CHECK(reloaded.Active()->id == "a2");
    CHECK(reloaded.Active()->name == L"Outro nome");
    CHECK(reloaded.Active()->senha == L"tres");
}

TEST_CASE("removing the active account leaves none active") {
    MemoryFileSystem files;
    ReversingCipher cipher;
    AccountsStore store(files, cipher, kAccountsPath);
    REQUIRE(store.Save(MakeAccount("a1", L"1001", L"um")));
    REQUIRE(store.Save(MakeAccount("a2", L"1002", L"dois")));
    REQUIRE(store.SetActive("a1"));
    REQUIRE(store.Remove("a1"));
    CHECK_FALSE(store.Active().has_value());
    CHECK(store.All().size() == 1);
    CHECK_FALSE(store.Remove("a1"));

    AccountsStore reloaded(files, cipher, kAccountsPath);
    REQUIRE(reloaded.Load());
    CHECK_FALSE(reloaded.Active().has_value());
    CHECK(reloaded.All().size() == 1);
    CHECK(reloaded.All()[0].id == "a2");
}

TEST_CASE("an account saved without an id gets a new one") {
    MemoryFileSystem files;
    ReversingCipher cipher;
    AccountsStore store(files, cipher, kAccountsPath);
    REQUIRE(store.Save(MakeAccount("", L"1001", L"um")));
    REQUIRE(store.Save(MakeAccount("", L"1002", L"dois")));
    const std::vector<SavedAccount> all = store.All();
    REQUIRE(all.size() == 2);
    CHECK(all[0].id.size() == 16);
    CHECK(all[0].id != all[1].id);
    CHECK(store.LastSavedId() == all[1].id);
    CHECK(NewStoreId() != NewStoreId());
}

TEST_CASE("accounts: a failed save changes nothing") {
    MemoryFileSystem files;
    ReversingCipher cipher;
    AccountsStore store(files, cipher, kAccountsPath);
    REQUIRE(store.Save(MakeAccount("a1", L"1001", L"um")));
    REQUIRE(store.SetActive("a1"));

    files.failWrites = true;
    CHECK_FALSE(store.Save(MakeAccount("a2", L"1002", L"dois")));
    CHECK_FALSE(store.Remove("a1"));
    CHECK(store.All().size() == 1);
    CHECK(store.Active()->id == "a1");

    files.failWrites = false;
    cipher.failProtect = true;
    CHECK_FALSE(store.Save(MakeAccount("a2", L"1002", L"dois")));
    CHECK(store.All().size() == 1);
}

TEST_CASE("accounts file format") {
    MemoryFileSystem files;
    ReversingCipher cipher;
    AccountsStore store(files, cipher, kAccountsPath);
    REQUIRE(store.Save(MakeAccount("a1", L"1001", L"ab")));
    REQUIRE(store.SetActive("a1"));
    const nlohmann::json json = nlohmann::json::parse(files.files.at(kAccountsPath));
    CHECK(json["versao"] == 1);
    REQUIRE(json["contas"].size() == 1);
    const nlohmann::json& entry = json["contas"][0];
    CHECK(entry["id"] == "a1");
    CHECK(entry["servidor"] == "pbx.example.com");
    CHECK(entry["protocolo"] == "tcp");
    CHECK(entry["ramal"] == "1001");
    CHECK(entry["senha_protegida"] == "enc:ba");
    CHECK(entry["nome"] == "Jo\xc3\xa3o");
    CHECK(entry["em_uso"] == true);
}

TEST_CASE("contacts are sorted ignoring accents and case") {
    MemoryFileSystem files;
    ContactsStore store(files, kContactsPath);
    REQUIRE(store.Save(MakeContact("c1", L"Bruno", "1003")));
    REQUIRE(store.Save(MakeContact("c2", L"ana", "1002")));
    REQUIRE(store.Save(MakeContact("c3", L"\u00c1lvaro", "1001")));
    const std::vector<std::wstring> expected = {L"\u00c1lvaro", L"ana", L"Bruno"};
    CHECK(Names(store.All()) == expected);

    ContactsStore reloaded(files, kContactsPath);
    REQUIRE(reloaded.Load());
    CHECK(Names(reloaded.All()) == expected);

    // Substituir pelo id nao duplica; remover tira.
    REQUIRE(reloaded.Save(MakeContact("c2", L"Zeca", "1002")));
    CHECK(reloaded.All().size() == 3);
    CHECK(reloaded.All().back().name == L"Zeca");
    REQUIRE(reloaded.Remove("c3"));
    CHECK_FALSE(reloaded.Remove("c3"));
    CHECK(reloaded.All().size() == 2);
}

TEST_CASE("contacts search by name and number") {
    MemoryFileSystem files;
    ContactsStore store(files, kContactsPath);
    Contact alvaro = MakeContact("c1", L"\u00c1lvaro Silva", "(11) 98888-7777");
    alvaro.note = L"cliente";
    REQUIRE(store.Save(alvaro));
    REQUIRE(store.Save(MakeContact("c2", L"Bruna", "2000")));
    REQUIRE(store.Save(MakeContact("c3", L"Carlos", "+5511977776666")));

    CHECK(Names(store.Search(L"alvaro")) == std::vector<std::wstring>{L"\u00c1lvaro Silva"});
    CHECK(Names(store.Search(L"SILVA")) == std::vector<std::wstring>{L"\u00c1lvaro Silva"});
    CHECK(Names(store.Search(L"\u00e1lv")) == std::vector<std::wstring>{L"\u00c1lvaro Silva"});
    CHECK(Names(store.Search(L"bru")) == std::vector<std::wstring>{L"Bruna"});
    CHECK(Names(store.Search(L"2000")) == std::vector<std::wstring>{L"Bruna"});
    CHECK(Names(store.Search(L"98888")) == std::vector<std::wstring>{L"\u00c1lvaro Silva"});
    CHECK(Names(store.Search(L"11 97777")) == std::vector<std::wstring>{L"Carlos"});
    CHECK(Names(store.Search(L"zzz")).empty());
    CHECK(store.Search(L"").size() == 3);
    CHECK(store.Search(L"  ").size() == 3);
}

TEST_CASE("contacts: the name for a number compares normalized numbers") {
    MemoryFileSystem files;
    ContactsStore store(files, kContactsPath);
    REQUIRE(store.Save(MakeContact("c1", L"Ana", "(11) 3333-4444")));
    REQUIRE(store.Save(MakeContact("c2", L"Bruno", "+55 11 98888-7777")));
    CHECK(store.NameFor("1133334444") == L"Ana");
    CHECK(store.NameFor("11 3333.4444") == L"Ana");
    CHECK(store.NameFor("+5511988887777") == L"Bruno");
    CHECK(store.NameFor("5511988887777").empty());
    CHECK(store.NameFor("9999").empty());
    CHECK(store.NameFor("").empty());
}

TEST_CASE("contacts need a name and a number") {
    MemoryFileSystem files;
    ContactsStore store(files, kContactsPath);
    CHECK_FALSE(store.Save(MakeContact("c1", L"  ", "1001")));
    CHECK_FALSE(store.Save(MakeContact("c1", L"Ana", " - ")));
    CHECK(store.All().empty());
    CHECK(files.files.empty());
    REQUIRE(store.Save(MakeContact("", L"  Ana ", "1001")));
    CHECK(store.All()[0].name == L"Ana");
    CHECK(store.All()[0].id.size() == 16);
}

TEST_CASE("contacts file format") {
    MemoryFileSystem files;
    ContactsStore store(files, kContactsPath);
    Contact contact = MakeContact("c1", L"\u00c1lvaro", "1001");
    contact.note = L"obs";
    REQUIRE(store.Save(contact));
    const nlohmann::json json = nlohmann::json::parse(files.files.at(kContactsPath));
    CHECK(json["versao"] == 1);
    const nlohmann::json& entry = json["contatos"][0];
    CHECK(entry["id"] == "c1");
    CHECK(entry["nome"] == "\xc3\x81lvaro");
    CHECK(entry["numero"] == "1001");
    CHECK(entry["observacao"] == "obs");
}

TEST_CASE("recents keep the newest 500") {
    MemoryFileSystem files;
    RecentsStore store(files, kRecentsPath);
    for (int i = 1; i <= 505; ++i) REQUIRE(store.Add(MakeRecent(i * 1000)));
    const std::vector<Recent> all = store.All();
    REQUIRE(all.size() == 500);
    CHECK(all.front().startMs == 505000);
    CHECK(all.back().startMs == 6000);

    RecentsStore reloaded(files, kRecentsPath);
    REQUIRE(reloaded.Load());
    REQUIRE(reloaded.All().size() == 500);
    CHECK(reloaded.All().front().startMs == 505000);
    CHECK(reloaded.All().back().startMs == 6000);

    // Uma bem antiga nao entra no lugar das novas.
    REQUIRE(reloaded.Add(MakeRecent(1)));
    CHECK(reloaded.All().size() == 500);
    CHECK(reloaded.All().back().startMs == 6000);
}

TEST_CASE("recents are newest first and round trip every field") {
    MemoryFileSystem files;
    RecentsStore store(files, kRecentsPath);
    Recent first = MakeRecent(1000, Recent::Outgoing, "2000");
    Recent second = MakeRecent(3000, Recent::Missed, "3000");
    second.name = "Jos\xc3\xa9";
    second.durationMs = 0;
    Recent third = MakeRecent(2000, Recent::Incoming, "4000");
    third.durationMs = 123456;
    REQUIRE(store.Add(first));
    REQUIRE(store.Add(second));
    REQUIRE(store.Add(third));
    const std::vector<Recent> expected = {second, third, first};
    CHECK(SameRecents(store.All(), expected));

    RecentsStore reloaded(files, kRecentsPath);
    REQUIRE(reloaded.Load());
    CHECK(SameRecents(reloaded.All(), expected));

    const nlohmann::json json = nlohmann::json::parse(files.files.at(kRecentsPath));
    CHECK(json["versao"] == 1);
    CHECK(json["recentes"][0]["numero"] == "3000");
    CHECK(json["recentes"][0]["nome"] == "Jos\xc3\xa9");
    CHECK(json["recentes"][0]["tipo"] == "perdida");
    CHECK(json["recentes"][0]["inicio"] == 3000);
    CHECK(json["recentes"][0]["duracao"] == 0);
    CHECK(json["recentes"][1]["tipo"] == "recebida");
    CHECK(json["recentes"][2]["tipo"] == "feita");
}

TEST_CASE("recents count the missed calls since a time") {
    MemoryFileSystem files;
    RecentsStore store(files, kRecentsPath);
    REQUIRE(store.Add(MakeRecent(1000, Recent::Missed)));
    REQUIRE(store.Add(MakeRecent(2000, Recent::Incoming)));
    REQUIRE(store.Add(MakeRecent(3000, Recent::Missed)));
    REQUIRE(store.Add(MakeRecent(4000, Recent::Missed)));
    CHECK(store.MissedCount(0) == 3);
    CHECK(store.MissedCount(1000) == 2);
    CHECK(store.MissedCount(3000) == 1);
    CHECK(store.MissedCount(4000) == 0);
}

TEST_CASE("recents: a recent with bytes that are not UTF-8 is still saved") {
    MemoryFileSystem files;
    RecentsStore store(files, kRecentsPath);
    Recent recent = MakeRecent(1000);
    recent.name = "Jos\xe9";   // Latin-1 vindo da central
    REQUIRE(store.Add(recent));
    RecentsStore reloaded(files, kRecentsPath);
    REQUIRE(reloaded.Load());
    REQUIRE(reloaded.All().size() == 1);
    CHECK(reloaded.All()[0].number == "1001");
}

TEST_CASE("settings clamp auto answer seconds to 0..30") {
    MemoryFileSystem files;
    SettingsStore store(files, kSettingsPath);
    Settings settings;
    settings.autoAnswerSeconds = 99;
    REQUIRE(store.Save(settings));
    CHECK(store.Get().autoAnswerSeconds == 30);
    settings.autoAnswerSeconds = -4;
    REQUIRE(store.Save(settings));
    CHECK(store.Get().autoAnswerSeconds == 0);
    settings.autoAnswerSeconds = 12;
    REQUIRE(store.Save(settings));
    SettingsStore reloaded(files, kSettingsPath);
    REQUIRE(reloaded.Load());
    CHECK(reloaded.Get().autoAnswerSeconds == 12);

    // Um arquivo editado a mao tambem e limitado ao ler.
    nlohmann::json json = nlohmann::json::parse(files.files.at(kSettingsPath));
    json["atender_segundos"] = 500;
    files.files[kSettingsPath] = json.dump();
    REQUIRE(reloaded.Load());
    CHECK(reloaded.Get().autoAnswerSeconds == 30);
}

TEST_CASE("settings round trip and defaults") {
    MemoryFileSystem files;
    SettingsStore empty(files, kSettingsPath);
    REQUIRE(empty.Load());   // sem arquivo: os padroes
    const Settings defaults = empty.Get();
    CHECK(defaults.captureDevice == -1);
    CHECK(defaults.playbackDevice == -1);
    CHECK(defaults.ringDeviceId.empty());
    CHECK_FALSE(defaults.doNotDisturb);
    CHECK_FALSE(defaults.autoAnswer);
    CHECK(defaults.autoAnswerSeconds == 3);
    CHECK(defaults.startWithWindows);
    CHECK(defaults.windowX == INT_MIN);
    CHECK(defaults.windowY == INT_MIN);
    CHECK(defaults.windowW == 0);
    CHECK(defaults.windowH == 0);

    Settings settings;
    settings.captureDevice = 2;
    settings.playbackDevice = 3;
    settings.ringDeviceId = "{0.0.0.00000000}.{abc}";
    settings.doNotDisturb = true;
    settings.autoAnswer = true;
    settings.autoAnswerSeconds = 7;
    settings.startWithWindows = false;
    settings.windowX = -1200;
    settings.windowY = 80;
    settings.windowW = 340;
    settings.windowH = 560;
    settings.captureName = "Microfone (USB)";
    settings.playbackName = "Alto-falantes \xc3\xa1";
    REQUIRE(empty.Save(settings));

    SettingsStore reloaded(files, kSettingsPath);
    REQUIRE(reloaded.Load());
    const Settings loaded = reloaded.Get();
    CHECK(loaded.captureDevice == 2);
    CHECK(loaded.playbackDevice == 3);
    CHECK(loaded.ringDeviceId == "{0.0.0.00000000}.{abc}");
    CHECK(loaded.doNotDisturb);
    CHECK(loaded.autoAnswer);
    CHECK(loaded.autoAnswerSeconds == 7);
    CHECK_FALSE(loaded.startWithWindows);
    CHECK(loaded.windowX == -1200);
    CHECK(loaded.windowY == 80);
    CHECK(loaded.windowW == 340);
    CHECK(loaded.windowH == 560);
    CHECK(nlohmann::json::parse(files.files.at(kSettingsPath))["janela_largura"] == 340);
    CHECK(nlohmann::json::parse(files.files.at(kSettingsPath))["janela_altura"] == 560);
    CHECK(loaded.captureName == "Microfone (USB)");
    CHECK(loaded.playbackName == "Alto-falantes \xc3\xa1");

    // Sem posicao de janela, as chaves nem vao ao disco.
    settings.windowX = INT_MIN;
    settings.windowY = INT_MIN;
    settings.windowW = 0;
    settings.windowH = 0;
    REQUIRE(reloaded.Save(settings));
    const nlohmann::json json = nlohmann::json::parse(files.files.at(kSettingsPath));
    CHECK(json["versao"] == 1);
    CHECK_FALSE(json.contains("janela_x"));
    CHECK_FALSE(json.contains("janela_y"));
    CHECK_FALSE(json.contains("janela_largura"));
    CHECK_FALSE(json.contains("janela_altura"));
    CHECK(json["nao_perturbe"] == true);
    SettingsStore again(files, kSettingsPath);
    REQUIRE(again.Load());
    CHECK(again.Get().windowX == INT_MIN);
    CHECK(again.Get().windowW == 0);
}

TEST_CASE("settings: missing or mistyped keys keep the defaults") {
    MemoryFileSystem files;
    files.files[kSettingsPath] = R"({"versao":1,"microfone":"x","atender_automatico":true,"janela_x":1.5,"janela_largura":"340","janela_altura":-5})";
    SettingsStore store(files, kSettingsPath);
    REQUIRE(store.Load());
    CHECK(store.Get().captureDevice == -1);
    CHECK(store.Get().autoAnswer);
    CHECK(store.Get().windowX == INT_MIN);
    // O tamanho da janela que nao e um inteiro positivo: sem tamanho guardado (o padrao).
    CHECK(store.Get().windowW == 0);
    CHECK(store.Get().windowH == 0);
    CHECK(store.Get().autoAnswerSeconds == 3);
}

TEST_CASE("a corrupt file loads as empty and is not overwritten until the next save") {
    const std::string garbage = "{ isto nao e json";
    MemoryFileSystem files;
    ReversingCipher cipher;

    SUBCASE("accounts") {
        files.files[kAccountsPath] = garbage;
        AccountsStore store(files, cipher, kAccountsPath);
        CHECK_FALSE(store.Load());
        CHECK(store.All().empty());
        CHECK_FALSE(store.Active().has_value());
        CHECK(files.files[kAccountsPath] == garbage);
        REQUIRE(store.Save(MakeAccount("a1", L"1001", L"x")));
        CHECK(files.files[kAccountsPath] != garbage);
        AccountsStore reloaded(files, cipher, kAccountsPath);
        CHECK(reloaded.Load());
        CHECK(reloaded.All().size() == 1);
    }
    SUBCASE("contacts") {
        files.files[kContactsPath] = garbage;
        ContactsStore store(files, kContactsPath);
        CHECK_FALSE(store.Load());
        CHECK(store.All().empty());
        CHECK(files.files[kContactsPath] == garbage);
        REQUIRE(store.Save(MakeContact("c1", L"Ana", "1001")));
        CHECK(files.files[kContactsPath] != garbage);
    }
    SUBCASE("recents") {
        files.files[kRecentsPath] = garbage;
        RecentsStore store(files, kRecentsPath);
        CHECK_FALSE(store.Load());
        CHECK(store.All().empty());
        CHECK(files.files[kRecentsPath] == garbage);
        REQUIRE(store.Add(MakeRecent(1000)));
        CHECK(files.files[kRecentsPath] != garbage);
    }
    SUBCASE("settings") {
        files.files[kSettingsPath] = garbage;
        SettingsStore store(files, kSettingsPath);
        CHECK_FALSE(store.Load());
        CHECK(store.Get().autoAnswerSeconds == 3);
        CHECK(files.files[kSettingsPath] == garbage);
        REQUIRE(store.Save(Settings()));
        CHECK(files.files[kSettingsPath] != garbage);
    }
}

TEST_CASE("a file of another version or shape loads as empty") {
    MemoryFileSystem files;
    ReversingCipher cipher;
    files.files[kContactsPath] = R"({"versao":2,"contatos":[{"id":"c1","nome":"Ana","numero":"1"}]})";
    ContactsStore future(files, kContactsPath);
    CHECK_FALSE(future.Load());
    CHECK(future.All().empty());

    files.files[kContactsPath] = R"([1,2,3])";
    ContactsStore array(files, kContactsPath);
    CHECK_FALSE(array.Load());

    files.files[kContactsPath] = R"({"contatos":[]})";
    ContactsStore noVersion(files, kContactsPath);
    CHECK_FALSE(noVersion.Load());

    // Uma entrada estragada fica de fora; as outras entram.
    files.files[kContactsPath] =
        R"({"versao":1,"contatos":[{"id":"c1","nome":"Ana","numero":"1001"},{"nome":"sem id"},5,{"id":"c1","nome":"Repetido","numero":"2"}]})";
    ContactsStore partial(files, kContactsPath);
    CHECK(partial.Load());
    REQUIRE(partial.All().size() == 1);
    CHECK(partial.All()[0].name == L"Ana");
}

TEST_CASE("a file with a UTF-8 BOM loads") {
    MemoryFileSystem files;
    files.files[kContactsPath] = "\xEF\xBB\xBF" R"({"versao":1,"contatos":[{"id":"c1","nome":"Ana","numero":"1001"}]})";
    ContactsStore store(files, kContactsPath);
    CHECK(store.Load());
    CHECK(store.All().size() == 1);
}

TEST_CASE("loading a missing file is not an error") {
    MemoryFileSystem files;
    ReversingCipher cipher;
    AccountsStore accounts(files, cipher, kAccountsPath);
    ContactsStore contacts(files, kContactsPath);
    RecentsStore recents(files, kRecentsPath);
    CHECK(accounts.Load());
    CHECK(contacts.Load());
    CHECK(recents.Load());
    CHECK(files.files.empty());
}

TEST_CASE("fold removes accents and case") {
    CHECK(FoldForSearch(L"\u00c1lvaro \u00c7e\u00e7\u00edlia \u00d1andu \u0141\u00f3d\u017a") == L"alvaro cecilia nandu lodz");
    CHECK(FoldForSearch(L"ABC 123") == L"abc 123");
}
