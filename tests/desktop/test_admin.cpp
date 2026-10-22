// Testes da area do administrador (starsonic/desktop/Admin.h): a loja cifrada, a senha e o codigo de puxar.
#include <string>
#include <vector>

#include "Admin.h"
#include "Pbkdf2.h"
#include "Stores.h"
#include "nlohmann/json.hpp"
#include "test_support.h"

using namespace starsonic;

namespace {

const char* const kAdminPath = "dados/admin.json";

// O cifrador de teste: inverte os bytes e poe um prefixo (o mesmo do test_stores.cpp).
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

Profile MakeProfile() {
    Profile profile;
    profile.account.port = 5060;
    profile.account.serverPorts.push_back(ServerPort{L"starcloud1-starsonic.com.br", 35060});
    return profile;
}

// A senha do administrador nunca aparece inteira no fonte (o teste de tests/python confere): ela e montada aqui.
std::string AdminPassword() { return std::string("01422") + "@" + "Star"; }

}  // namespace

TEST_CASE("admin password accepts the right password and rejects others") {
    CHECK(CheckAdminPassword(AdminPassword()));
    CHECK_FALSE(CheckAdminPassword(""));
    const std::string right = AdminPassword();
    CHECK_FALSE(CheckAdminPassword(right.substr(0, 6) + "star"));   // outra caixa
    CHECK_FALSE(CheckAdminPassword(right + " "));
    CHECK_FALSE(CheckAdminPassword(" " + right));
    CHECK_FALSE(CheckAdminPassword(right.substr(0, right.size() - 1)));
    CHECK_FALSE(CheckAdminPassword(right + "1"));
    CHECK_FALSE(CheckAdminPassword("senha"));
    CHECK_FALSE(CheckAdminPassword(std::string(1000, 'x')));
    std::string withNul = right;
    withNul[5] = '\0';   // o NUL no meio nao corta a senha
    CHECK_FALSE(CheckAdminPassword(withNul));
}

TEST_CASE("the embedded admin hash is PBKDF2-SHA256, 100000 iterations, 16-byte salt, 32-byte key") {
    const AdminHashParams params = EmbeddedAdminHash();
    CHECK(params.iterations == 100000);
    REQUIRE(params.salt.size() == 16);
    REQUIRE(params.key.size() == 32);
    const std::string password = AdminPassword();
    const std::vector<uint8_t> derived = Pbkdf2HmacSha256(std::vector<uint8_t>(password.begin(), password.end()),
                                                          params.salt, params.iterations, 32);
    CHECK(derived == params.key);
}

TEST_CASE("pickup code replaces every ramal token") {
    CHECK(PickupNumber("**{ramal}", "2007") == "**2007");
    CHECK(PickupNumber("*8", "2007") == "*8");
    CHECK(PickupNumber("{ramal}#{ramal}", "2007") == "2007#2007");
    CHECK(PickupNumber("", "2007").empty());
    CHECK(PickupNumber("{ramal}", "").empty());
    // O que entra no lugar nao e lido de novo.
    CHECK(PickupNumber("*{ramal}", "{ramal}") == "*{ramal}");
    CHECK(PickupNumber("{ramal", "2007") == "{ramal");
}

TEST_CASE("admin store defaults come from the profile") {
    MemoryFileSystem files;
    ReversingCipher cipher;
    AdminStore store(files, cipher, kAdminPath, MakeProfile());
    REQUIRE(store.Load());   // sem arquivo: os padroes, sem erro
    const AdminConfig& config = store.Get();
    CHECK(config.mostrarNaoPerturbe);
    CHECK(config.mostrarAtenderAuto);
    CHECK_FALSE(config.blf);
    CHECK_FALSE(config.puxar);
    CHECK(config.codigoPuxar.empty());
    CHECK(config.canal.empty());
    REQUIRE(config.servidores.size() == 1);
    CHECK(config.servidores[0].address == L"starcloud1-starsonic.com.br");
    CHECK(config.servidores[0].port == 35060);
    CHECK(files.files.empty());   // so o Save grava
}

TEST_CASE("admin store round trips and the file is unreadable without the cipher") {
    MemoryFileSystem files;
    ReversingCipher cipher;
    {
        AdminStore store(files, cipher, kAdminPath, MakeProfile());
        REQUIRE(store.Load());
        AdminConfig config = store.Get();
        config.mostrarNaoPerturbe = false;
        config.mostrarAtenderAuto = false;
        config.blf = true;
        config.puxar = true;
        config.codigoPuxar = "**{ramal}";
        config.servidores = {ServerPort{L"pbx.example.com", 5070}, ServerPort{L"b.example.com", 35060}};
        config.canal = "teste";
        REQUIRE(store.Save(config));
    }

    // O arquivo vem do cifrador: nao e JSON e a senha do codigo nao aparece em claro.
    const std::string bytes = files.files.at(kAdminPath);
    CHECK(nlohmann::json::parse(bytes, nullptr, false).is_discarded());
    CHECK(bytes.find("pbx.example.com") == std::string::npos);
    CHECK(bytes.find("ramal") == std::string::npos);
    CHECK(bytes.compare(0, 4, "enc:") == 0);

    AdminStore reloaded(files, cipher, kAdminPath, MakeProfile());
    REQUIRE(reloaded.Load());
    const AdminConfig& config = reloaded.Get();
    CHECK_FALSE(config.mostrarNaoPerturbe);
    CHECK_FALSE(config.mostrarAtenderAuto);
    CHECK(config.blf);
    CHECK(config.puxar);
    CHECK(config.codigoPuxar == "**{ramal}");
    CHECK(config.canal == "teste");
    REQUIRE(config.servidores.size() == 2);
    CHECK(config.servidores[0].address == L"pbx.example.com");
    CHECK(config.servidores[0].port == 5070);
    CHECK(config.servidores[1].address == L"b.example.com");
    CHECK(config.servidores[1].port == 35060);
}

TEST_CASE("admin store falls back to the defaults when the file cannot be read") {
    MemoryFileSystem files;
    ReversingCipher cipher;
    AdminStore store(files, cipher, kAdminPath, MakeProfile());
    AdminConfig config = store.Get();
    config.blf = true;
    REQUIRE(store.Save(config));

    // Um editor de texto trocou o arquivo por JSON em claro: nao decifra, valem os padroes.
    files.files[kAdminPath] = R"({"versao":1,"blf":true})";
    AdminStore tampered(files, cipher, kAdminPath, MakeProfile());
    CHECK_FALSE(tampered.Load());
    CHECK_FALSE(tampered.Get().blf);
    CHECK(tampered.Get().servidores.size() == 1);

    // Decifra, mas o conteudo nao e o esperado: tambem os padroes.
    files.files[kAdminPath] = *cipher.Protect("lixo");
    CHECK_FALSE(tampered.Load());
    files.files[kAdminPath] = *cipher.Protect(R"({"versao":2,"blf":true})");
    CHECK_FALSE(tampered.Load());
    CHECK_FALSE(tampered.Get().blf);

    // Campos que faltam ou vem do tipo errado ficam nos padroes.
    files.files[kAdminPath] = *cipher.Protect(R"({"versao":1,"blf":true,"puxar":"sim","servidores":"x"})");
    REQUIRE(tampered.Load());
    CHECK(tampered.Get().blf);
    CHECK_FALSE(tampered.Get().puxar);
    CHECK(tampered.Get().mostrarNaoPerturbe);
    CHECK(tampered.Get().servidores.size() == 1);   // sem lista valida: os do perfil
}

TEST_CASE("admin store keeps an empty server list the administrator chose") {
    MemoryFileSystem files;
    ReversingCipher cipher;
    AdminStore store(files, cipher, kAdminPath, MakeProfile());
    AdminConfig config = store.Get();
    config.servidores.clear();
    REQUIRE(store.Save(config));
    AdminStore reloaded(files, cipher, kAdminPath, MakeProfile());
    REQUIRE(reloaded.Load());
    CHECK(reloaded.Get().servidores.empty());
}

TEST_CASE("admin store drops invalid servers and refuses to save when the disk or the cipher fails") {
    MemoryFileSystem files;
    ReversingCipher cipher;
    AdminStore store(files, cipher, kAdminPath, MakeProfile());
    AdminConfig config = store.Get();
    config.servidores = {ServerPort{L"ok.example.com", 5060}, ServerPort{L"", 5060}, ServerPort{L"x.example.com", 0},
                         ServerPort{L"y.example.com", 70000}, ServerPort{L"  z.example.com ", 5062}};
    config.codigoPuxar = "  **{ramal} ";
    REQUIRE(store.Save(config));
    REQUIRE(store.Get().servidores.size() == 2);
    CHECK(store.Get().servidores[0].address == L"ok.example.com");
    CHECK(store.Get().servidores[1].address == L"z.example.com");
    CHECK(store.Get().codigoPuxar == "**{ramal}");

    const AdminConfig before = store.Get();
    AdminConfig changed = before;
    changed.blf = true;
    files.failWrites = true;
    CHECK_FALSE(store.Save(changed));
    CHECK_FALSE(store.Get().blf);
    files.failWrites = false;
    cipher.failProtect = true;
    CHECK_FALSE(store.Save(changed));
    CHECK_FALSE(store.Get().blf);
}

TEST_CASE("settings bipeFim defaults to true and persists") {
    MemoryFileSystem files;
    SettingsStore store(files, "dados/config.json");
    REQUIRE(store.Load());
    CHECK(store.Get().bipeFim);

    Settings settings = store.Get();
    settings.bipeFim = false;
    REQUIRE(store.Save(settings));
    CHECK(nlohmann::json::parse(files.files.at("dados/config.json"))["bipe_fim"] == false);

    SettingsStore reloaded(files, "dados/config.json");
    REQUIRE(reloaded.Load());
    CHECK_FALSE(reloaded.Get().bipeFim);

    // Um config.json da rc.2, sem a chave: liga.
    files.files["dados/config.json"] = R"({"versao":1,"nao_perturbe":true})";
    REQUIRE(reloaded.Load());
    CHECK(reloaded.Get().bipeFim);
    CHECK(reloaded.Get().doNotDisturb);
}
