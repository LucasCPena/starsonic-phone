// Testes da loja do chat (starsonic/desktop/Chat.h, 0.2.0): a chave do computador pelo cifrador, os ramais que ja se
// conectaram a central neste computador e as conferencias da chave, da empresa e do id de um arquivo.
#include <string>

#include "Chat.h"
#include "nlohmann/json.hpp"
#include "test_support.h"

using namespace starsonic;
using nlohmann::json;

namespace {

const char* const kChatPath = "dados/chat.json";
// Uma chave inventada (43 de [A-Za-z0-9_-], o formato do servidor do chat), nunca uma de verdade.
const char* const kKey = "Chave_de-teste-inventada-0123456789-ABCDxyz";
const char* const kCompany = "ACME Com\xc3\xa9rcio Ltda";

// O cifrador de teste: "enc:" e os bytes em hexadecimal (nenhum pedaco do texto fica em claro).
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

// O chat.json decifrado, lido como JSON (o arquivo termina com um fim de linha, como o admin.json).
json Plain(const MemoryFileSystem& files, HexCipher& cipher) {
    const std::string bytes = files.files.at(kChatPath);
    REQUIRE_FALSE(bytes.empty());
    CHECK(bytes.back() == '\n');
    const std::optional<std::string> plain = cipher.Unprotect(bytes.substr(0, bytes.size() - 1));
    REQUIRE(plain.has_value());
    return json::parse(*plain);
}

}  // namespace

TEST_CASE("the chat store without a file starts empty") {
    MemoryFileSystem files;
    HexCipher cipher;
    ChatStore store(files, cipher, kChatPath);
    CHECK(store.Load());
    CHECK_FALSE(store.Link().has_value());
    CHECK_FALSE(store.HasRamal("pbx.exemplo.com", "2001"));
    CHECK(files.files.empty());   // so a gravacao escreve

    // Sem o caminho (o executavel que ainda nao o da): vazio tambem, e nada e gravado.
    ChatStore nowhere(files, cipher, "");
    CHECK(nowhere.Load());
    CHECK_FALSE(nowhere.Link().has_value());
    CHECK_FALSE(nowhere.SetLink(ChatLink{kKey, kCompany}));
    CHECK_FALSE(nowhere.Link().has_value());
    CHECK(files.files.empty());
}

TEST_CASE("the chat store saves the key through the cipher and reads it back") {
    MemoryFileSystem files;
    HexCipher cipher;
    ChatStore store(files, cipher, kChatPath);
    REQUIRE(store.Load());
    REQUIRE(store.SetLink(ChatLink{kKey, kCompany}));
    REQUIRE(store.Link().has_value());
    CHECK(store.Link()->chave == kKey);
    CHECK(store.Link()->empresa == kCompany);

    // O arquivo vem do cifrador: nem a chave nem a empresa em claro.
    const std::string bytes = files.files.at(kChatPath);
    CHECK(bytes.compare(0, 4, "enc:") == 0);
    CHECK(bytes.find(kKey) == std::string::npos);
    CHECK(bytes.find("ACME") == std::string::npos);
    CHECK(Plain(files, cipher) == json({{"v", 1}, {"chave", kKey}, {"empresa", kCompany}, {"ramais", json::array()}}));

    ChatStore reloaded(files, cipher, kChatPath);
    REQUIRE(reloaded.Load());
    REQUIRE(reloaded.Link().has_value());
    CHECK(reloaded.Link()->chave == kKey);
    CHECK(reloaded.Link()->empresa == kCompany);

    // Uma chave ou uma empresa fora da regra, o disco que recusa: false, e nada muda.
    CHECK_FALSE(reloaded.SetLink(ChatLink{"curta", kCompany}));
    CHECK_FALSE(reloaded.SetLink(ChatLink{kKey, ""}));
    files.failWrites = true;
    CHECK_FALSE(reloaded.SetLink(ChatLink{"Outra_chave-inventada-0123456789-ABCDEFGHIJ", "Outra"}));
    files.failWrites = false;
    CHECK(reloaded.Link()->chave == kKey);
    CHECK(reloaded.Link()->empresa == kCompany);
    CHECK(files.files.at(kChatPath) == bytes);
}

TEST_CASE("a chat file that does not decrypt loads empty and stays on disk") {
    MemoryFileSystem files;
    HexCipher cipher;
    ChatStore store(files, cipher, kChatPath);
    REQUIRE(store.Load());
    REQUIRE(store.SetLink(ChatLink{kKey, kCompany}));
    REQUIRE(store.AddRamal("pbx.exemplo.com", "2001"));
    const int writes = files.writeCount;

    // Um editor de texto trocou o arquivo por JSON em claro: nao decifra (como o de outro usuario do Windows).
    const std::string plain = std::string(R"({"v":1,"chave":")") + kKey +
                              R"(","empresa":"ACME","ramais":["pbx.exemplo.com|2001"]})";
    files.files[kChatPath] = plain;
    CHECK_FALSE(store.Load());
    CHECK_FALSE(store.Link().has_value());
    CHECK_FALSE(store.HasRamal("pbx.exemplo.com", "2001"));
    CHECK(files.files.at(kChatPath) == plain);   // o arquivo fica como estava, ate a proxima gravacao
    CHECK(files.writeCount == writes);

    // Decifra, mas nao e JSON, ou e de outra versao: tambem vazio e false.
    files.files[kChatPath] = *cipher.Protect("lixo");
    CHECK_FALSE(store.Load());
    files.files[kChatPath] = *cipher.Protect(std::string(R"({"v":2,"chave":")") + kKey +
                                             R"(","empresa":"ACME","ramais":["pbx.exemplo.com|2001"]})");
    CHECK_FALSE(store.Load());
    CHECK_FALSE(store.Link().has_value());
    CHECK_FALSE(store.HasRamal("pbx.exemplo.com", "2001"));
    CHECK(files.writeCount == writes);

    // A versao certa com uma chave fora da regra: le, sem a chave e a empresa (as duas, ou nenhuma), e com os ramais.
    files.files[kChatPath] =
        *cipher.Protect(R"({"v":1,"chave":"curta","empresa":"ACME","ramais":["pbx.exemplo.com|2001",7]})");
    CHECK(store.Load());
    CHECK_FALSE(store.Link().has_value());
    CHECK(store.HasRamal("pbx.exemplo.com", "2001"));
}

TEST_CASE("clearing the link keeps the connected ramais") {
    MemoryFileSystem files;
    HexCipher cipher;
    ChatStore store(files, cipher, kChatPath);
    REQUIRE(store.Load());
    REQUIRE(store.SetLink(ChatLink{kKey, kCompany}));
    REQUIRE(store.AddRamal("pbx.exemplo.com", "2001"));
    REQUIRE(store.ClearLink());
    CHECK_FALSE(store.Link().has_value());
    CHECK(store.HasRamal("pbx.exemplo.com", "2001"));

    // No disco tambem: sem a chave e a empresa, com os ramais.
    CHECK(Plain(files, cipher) == json({{"v", 1}, {"ramais", json::array({"pbx.exemplo.com|2001"})}}));
    ChatStore reloaded(files, cipher, kChatPath);
    REQUIRE(reloaded.Load());
    CHECK_FALSE(reloaded.Link().has_value());
    CHECK(reloaded.HasRamal("pbx.exemplo.com", "2001"));

    // O disco que recusa: false, e a chave continua.
    REQUIRE(reloaded.SetLink(ChatLink{kKey, kCompany}));
    files.failWrites = true;
    CHECK_FALSE(reloaded.ClearLink());
    files.failWrites = false;
    REQUIRE(reloaded.Link().has_value());
    CHECK(reloaded.Link()->chave == kKey);
}

TEST_CASE("a ramal is added once, with the server in any case") {
    MemoryFileSystem files;
    HexCipher cipher;
    ChatStore store(files, cipher, kChatPath);
    REQUIRE(store.Load());
    REQUIRE(store.AddRamal(" PBX.Exemplo.com ", "2001"));
    CHECK(files.writeCount == 1);
    CHECK(store.HasRamal("pbx.exemplo.com", "2001"));
    CHECK(store.HasRamal("PBX.EXEMPLO.COM", " 2001 "));
    CHECK_FALSE(store.HasRamal("pbx.exemplo.com", "2002"));
    CHECK_FALSE(store.HasRamal("outro.exemplo.com", "2001"));
    CHECK(Plain(files, cipher) == json({{"v", 1}, {"ramais", json::array({"pbx.exemplo.com|2001"})}}));

    // O mesmo par de novo (de qualquer jeito): true, sem gravar.
    CHECK(store.AddRamal("pbx.exemplo.com", "2001"));
    CHECK(store.AddRamal("Pbx.Exemplo.Com", "2001 "));
    CHECK(files.writeCount == 1);

    // O mesmo ramal em outro servidor e outro par; o par vazio nao entra.
    CHECK(store.AddRamal("outro.exemplo.com", "2001"));
    CHECK(files.writeCount == 2);
    CHECK_FALSE(store.AddRamal("", "2001"));
    CHECK_FALSE(store.AddRamal("pbx.exemplo.com", "  "));
    CHECK(files.writeCount == 2);

    // O disco que recusa: false, mas o par fica nesta abertura (ele se conectou), e a proxima gravacao o leva.
    files.failWrites = true;
    CHECK_FALSE(store.AddRamal("pbx.exemplo.com", "2003"));
    files.failWrites = false;
    CHECK(store.HasRamal("pbx.exemplo.com", "2003"));
    CHECK(store.AddRamal("pbx.exemplo.com", "2003"));   // ja estava: sem gravar
    CHECK(files.writeCount == 2);
    REQUIRE(store.SetLink(ChatLink{kKey, kCompany}));
    ChatStore reloaded(files, cipher, kChatPath);
    REQUIRE(reloaded.Load());
    CHECK(reloaded.HasRamal("pbx.exemplo.com", "2001"));
    CHECK(reloaded.HasRamal("outro.exemplo.com", "2001"));
    CHECK(reloaded.HasRamal("pbx.exemplo.com", "2003"));
}

TEST_CASE("the key, the company and the file id are checked") {
    const std::string key = kKey;
    REQUIRE(key.size() == 43);
    CHECK(ValidChatKey(key));
    CHECK(ValidChatKey(std::string(43, '-')));
    CHECK_FALSE(ValidChatKey(key.substr(0, 42)));
    CHECK_FALSE(ValidChatKey(key + "a"));
    CHECK_FALSE(ValidChatKey(""));
    for (const char bad : {'+', '=', '/', ' ', '.'}) {
        std::string changed = key;
        changed[20] = bad;
        INFO(bad);
        CHECK_FALSE(ValidChatKey(changed));
    }

    // De 1 a 80 pontos de codigo: com acentos, um caractere vale um (os bytes nao contam).
    std::string eighty;
    for (int i = 0; i < 40; ++i) eighty += "a\xc3\xa9";
    CHECK(ValidChatCompany(eighty));
    CHECK(ValidChatCompany(kCompany));
    CHECK(ValidChatCompany("\xf0\x9f\x93\x9e Central"));   // um emoji (4 bytes) e um caractere
    CHECK_FALSE(ValidChatCompany(""));
    CHECK_FALSE(ValidChatCompany(eighty + "x"));
    // Sem caractere de controle: o fim de linha, o tab, o NUL, o DEL e os de controle do Latin-1 (U+0080 a U+009F).
    CHECK_FALSE(ValidChatCompany("ACME\nLtda"));
    CHECK_FALSE(ValidChatCompany("ACME\tLtda"));
    CHECK_FALSE(ValidChatCompany(std::string("ACME\0Ltda", 9)));
    CHECK_FALSE(ValidChatCompany("ACME\x7fLtda"));
    CHECK_FALSE(ValidChatCompany("ACME\xc2\x85Ltda"));
    // O UTF-8 quebrado: o byte solto, a sequencia cortada, a forma longa e o substituto.
    CHECK_FALSE(ValidChatCompany("ACME \xff"));
    CHECK_FALSE(ValidChatCompany("ACME \xc3"));
    CHECK_FALSE(ValidChatCompany("ACME \xc0\xa0"));
    CHECK_FALSE(ValidChatCompany("ACME \xed\xa0\x80"));

    CHECK(ValidFileId("0123456789abcdef0123456789abcdef"));
    CHECK_FALSE(ValidFileId("0123456789ABCDEF0123456789ABCDEF"));
    CHECK_FALSE(ValidFileId("0123456789abcdef0123456789abcde"));
    CHECK_FALSE(ValidFileId("0123456789abcdef0123456789abcdef0"));
    CHECK_FALSE(ValidFileId("0123456789abcdef0123456789abcdeg"));
    CHECK_FALSE(ValidFileId(""));
}
