// Testes da area do administrador (starsonic/desktop/Admin.h): a loja cifrada, a senha e o codigo de puxar.
#include <cstdlib>
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

// A senha de verdade nunca esta no repositorio (ele e publico): os testes da logica usam uma senha de brinquedo com um
// resumo calculado a parte (hashlib: pbkdf2_hmac("sha256", b"senha-de-teste-123", sal, 1000, 32)), e o que confere o
// resumo embutido le a senha da variavel de ambiente STARSONIC_ADMIN_PASSWORD (sem ela, o teste so avisa e sai).
const char kTestPassword[] = "senha-de-teste-123";

AdminHashParams TestParams() {
    AdminHashParams params;
    params.iterations = 1000;
    params.salt = {0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f};
    params.key = {0xb6, 0xdd, 0x7e, 0xaf, 0xd1, 0x27, 0xdf, 0xf4, 0xb1, 0xc5, 0xa8, 0xb8, 0x21, 0xb6, 0x55, 0x01,
                  0xe4, 0xaa, 0x8b, 0x1e, 0xd9, 0x98, 0xea, 0x35, 0xa5, 0xdc, 0x15, 0x18, 0x85, 0xe1, 0x53, 0x8f};
    return params;
}

// A senha do administrador vinda do ambiente; false se a variavel nao existe ou esta vazia.
bool AdminPasswordFromEnvironment(std::string* out) {
#ifdef _MSC_VER
    char* value = nullptr;
    size_t length = 0;
    if (_dupenv_s(&value, &length, "STARSONIC_ADMIN_PASSWORD") != 0 || value == nullptr) return false;
    out->assign(value);
    std::free(value);
#else
    const char* value = std::getenv("STARSONIC_ADMIN_PASSWORD");
    if (value == nullptr) return false;
    out->assign(value);
#endif
    return !out->empty();
}

}  // namespace

TEST_CASE("password check accepts the right password and rejects others") {
    const AdminHashParams params = TestParams();
    const std::string right = kTestPassword;
    CHECK(CheckPasswordAgainst(right, params));
    CHECK_FALSE(CheckPasswordAgainst("", params));
    CHECK_FALSE(CheckPasswordAgainst("SENHA-DE-TESTE-123", params));   // outra caixa
    CHECK_FALSE(CheckPasswordAgainst("Senha-de-teste-123", params));
    CHECK_FALSE(CheckPasswordAgainst(right + " ", params));            // um espaco a mais
    CHECK_FALSE(CheckPasswordAgainst(" " + right, params));
    CHECK_FALSE(CheckPasswordAgainst(right.substr(0, right.size() - 1), params));
    CHECK_FALSE(CheckPasswordAgainst(right + "1", params));
    CHECK_FALSE(CheckPasswordAgainst(std::string(1000, 'x'), params));
    std::string withNul = right;
    withNul[5] = '\0';   // o NUL no meio nao corta a senha
    CHECK_FALSE(CheckPasswordAgainst(withNul, params));
    CHECK_FALSE(CheckPasswordAgainst(right + std::string(1, '\0'), params));
}

TEST_CASE("password check refuses a hash that is not well formed") {
    const std::string right = kTestPassword;
    AdminHashParams params = TestParams();
    params.iterations = 0;
    CHECK_FALSE(CheckPasswordAgainst(right, params));
    params = TestParams();
    params.key.clear();
    CHECK_FALSE(CheckPasswordAgainst(right, params));
    params = TestParams();
    params.key.back() ^= 1;   // um bit diferente na chave
    CHECK_FALSE(CheckPasswordAgainst(right, params));
    params = TestParams();
    params.salt.back() ^= 1;
    CHECK_FALSE(CheckPasswordAgainst(right, params));
}

TEST_CASE("the embedded admin hash is PBKDF2-SHA256, 100000 iterations, 16-byte salt, 32-byte key") {
    const AdminHashParams params = EmbeddedAdminHash();
    CHECK(params.iterations == 100000);
    CHECK(params.salt.size() == 16);
    CHECK(params.key.size() == 32);
}

TEST_CASE("the embedded admin hash matches the password from STARSONIC_ADMIN_PASSWORD") {
    std::string password;
    if (!AdminPasswordFromEnvironment(&password)) {
        MESSAGE("STARSONIC_ADMIN_PASSWORD nao esta definida: teste do resumo embutido pulado");
        return;
    }
    const AdminHashParams params = EmbeddedAdminHash();
    const std::vector<uint8_t> derived =
        Pbkdf2HmacSha256(std::vector<uint8_t>(password.begin(), password.end()), params.salt, params.iterations, 32);
    CHECK(derived == params.key);
    CHECK(CheckAdminPassword(password));
    CHECK_FALSE(CheckAdminPassword(password + "x"));
    CHECK_FALSE(CheckAdminPassword(std::string()));
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

TEST_CASE("admin store trims and refuses to save when the disk or the cipher fails") {
    MemoryFileSystem files;
    ReversingCipher cipher;
    AdminStore store(files, cipher, kAdminPath, MakeProfile());
    AdminConfig config = store.Get();
    config.servidores = {ServerPort{L"  OK.example.com ", 5060}, ServerPort{L"z.example.com", 65535}};
    config.codigoPuxar = "  **{ramal} ";
    REQUIRE(store.Save(config));
    REQUIRE(store.Get().servidores.size() == 2);
    CHECK(store.Get().servidores[0].address == L"ok.example.com");   // como o ValidateServerAddress normaliza
    CHECK(store.Get().codigoPuxar == "**{ramal}");

    AdminConfig changed = store.Get();
    changed.blf = true;
    files.failWrites = true;
    CHECK_FALSE(store.Save(changed));
    CHECK_FALSE(store.Get().blf);
    files.failWrites = false;
    cipher.failProtect = true;
    CHECK_FALSE(store.Save(changed));
    CHECK_FALSE(store.Get().blf);
}

TEST_CASE("admin store accepts only the teste and estavel channels") {
    MemoryFileSystem files;
    ReversingCipher cipher;
    AdminStore store(files, cipher, kAdminPath, MakeProfile());
    AdminConfig config = store.Get();
    for (const char* channel : {"", "teste", "estavel"}) {
        config.canal = channel;
        std::string error;
        CHECK(store.Save(config, &error));
        CHECK(error.empty());
        CHECK(store.Get().canal == channel);
    }
    for (const char* channel : {"canal-teste", "Teste", "estavel ", "beta", "x"}) {
        config.canal = channel;
        std::string error;
        CHECK_FALSE(store.Save(config, &error));
        CHECK(error == "Escolha o canal Teste ou Est\xc3\xa1vel.");
        CHECK(store.Get().canal == "estavel");   // nada mudou
    }

    // Um admin.json com outro valor (o arquivo foi trocado, ou veio de outra versao) volta ao canal de fabrica.
    files.files[kAdminPath] = *cipher.Protect(R"({"versao":1,"canal":"beta","blf":true})");
    REQUIRE(store.Load());
    CHECK(store.Get().canal.empty());
    CHECK(store.Get().blf);
    files.files[kAdminPath] = *cipher.Protect(R"({"versao":1,"canal":"teste"})");
    REQUIRE(store.Load());
    CHECK(store.Get().canal == "teste");
    files.files[kAdminPath] = *cipher.Protect(R"({"versao":1,"canal":7})");
    REQUIRE(store.Load());
    CHECK(store.Get().canal.empty());
}

TEST_CASE("admin store accepts only digits, * # + and the ramal token in the pickup code") {
    MemoryFileSystem files;
    ReversingCipher cipher;
    AdminStore store(files, cipher, kAdminPath, MakeProfile());
    AdminConfig config = store.Get();
    for (const char* code : {"", "*8", "**{ramal}", "{ramal}#{ramal}", "+55*0{ramal}#", "  *8  "}) {
        config.codigoPuxar = code;
        std::string error;
        CHECK(store.Save(config, &error));
        CHECK(error.empty());
    }
    const std::string kept = store.Get().codigoPuxar;
    const std::string message = "O c\xc3\xb3" "digo s\xc3\xb3 pode ter d\xc3\xadgitos, *, #, + e {ramal}.";
    for (const char* code : {"*8 7", "**{ramal", "{Ramal}", "{ramal}}", "{}", "{x}", "**a", "*8;", "*\n8", "*\xc3\xa3"}) {
        config.codigoPuxar = code;
        std::string error;
        CHECK_FALSE(store.Save(config, &error));
        CHECK(error == message);
        CHECK(store.Get().codigoPuxar == kept);
    }

    // Um arquivo com um codigo ruim volta a vazio ao carregar.
    files.files[kAdminPath] = *cipher.Protect(R"({"versao":1,"puxar":true,"codigo_puxar":"**a{ramal}"})");
    REQUIRE(store.Load());
    CHECK(store.Get().puxar);
    CHECK(store.Get().codigoPuxar.empty());
}

TEST_CASE("admin store validates the server addresses and ports") {
    MemoryFileSystem files;
    ReversingCipher cipher;
    AdminStore store(files, cipher, kAdminPath, MakeProfile());
    const AdminConfig original = store.Get();
    AdminConfig config = original;
    const std::string invalidAddress =
        "Digite s\xc3\xb3 o endere\xc3\xa7o do servidor, como starcloud1-starsonic.com.br.";

    // Sem espaco, sem host:porta, sem o resto que nao e nome de servidor.
    for (const wchar_t* address : {L"a b.example.com", L"pbx.example.com:5060", L"sip:pbx.example.com", L"pbx_example",
                                   L"-a.example.com", L"a..b", L"pbx.example.com/x", L"[::1]"}) {
        config.servidores = {ServerPort{address, 5060}};
        std::string error;
        CHECK_FALSE(store.Save(config, &error));
        CHECK(error == invalidAddress);
    }
    config.servidores = {ServerPort{L"", 5060}};
    std::string error;
    CHECK_FALSE(store.Save(config, &error));
    CHECK(error == "Digite o endere\xc3\xa7o do servidor.");

    // A porta fica entre 1 e 65535.
    for (int port : {0, -1, 65536, 70000}) {
        config.servidores = {ServerPort{L"pbx.example.com", port}};
        CHECK_FALSE(store.Save(config, &error));
        CHECK(error == "A porta deve ficar entre 1 e 65535.");
    }

    // Sem repetidos, sem olhar a caixa nem a porta.
    config.servidores = {ServerPort{L"pbx.example.com", 5060}, ServerPort{L"PBX.Example.com", 5070}};
    CHECK_FALSE(store.Save(config, &error));
    CHECK(error == "Esse servidor j\xc3\xa1 est\xc3\xa1 na lista.");

    CHECK(store.Get().servidores.size() == original.servidores.size());   // nada mudou
    CHECK(files.files.empty());

    // Um arquivo com servidores ruins ou repetidos fica so com os bons, o primeiro de cada.
    files.files[kAdminPath] = *cipher.Protect(
        R"({"versao":1,"servidores":[{"endereco":"a.example.com","porta":5060},{"endereco":"A.example.com","porta":1},)"
        R"({"endereco":"b c","porta":5060},{"endereco":"d.example.com:5060","porta":5060},)"
        R"({"endereco":"e.example.com","porta":0},{"endereco":"f.example.com","porta":35060},7]})");
    REQUIRE(store.Load());
    REQUIRE(store.Get().servidores.size() == 2);
    CHECK(store.Get().servidores[0].address == L"a.example.com");
    CHECK(store.Get().servidores[0].port == 5060);
    CHECK(store.Get().servidores[1].address == L"f.example.com");
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
