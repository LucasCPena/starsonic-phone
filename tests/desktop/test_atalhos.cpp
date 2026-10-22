// Testes da loja dos atalhos (starsonic/desktop/Atalhos.h): disco em memoria.
#include <string>
#include <vector>

#include "Atalhos.h"
#include "nlohmann/json.hpp"
#include "test_support.h"

using namespace starsonic;

namespace {

const char* const kPath = "dados/atalhos.json";

Atalho Make(const std::string& nome, const std::string& numero, Atalho::Acao acao = Atalho::Ligar, bool blf = false) {
    Atalho atalho;
    atalho.nome = nome;
    atalho.numero = numero;
    atalho.acao = acao;
    atalho.blf = blf;
    return atalho;
}

}  // namespace

TEST_CASE("atalhos store caps at 8 and validates fields") {
    MemoryFileSystem files;
    AtalhosStore store(files, kPath);
    REQUIRE(store.Load());

    std::string error;
    for (int i = 0; i < 8; ++i) {
        const std::string id = store.Save(Make("Ramal " + std::to_string(i), "200" + std::to_string(i)), &error);
        INFO(error);
        CHECK_FALSE(id.empty());
    }
    CHECK(store.All().size() == 8);

    // O 9o e recusado, com a mensagem em portugues; nada muda no disco.
    const int writes = files.writeCount;
    error.clear();
    CHECK(store.Save(Make("Nono", "2999"), &error).empty());
    CHECK(error == "Voc\xc3\xaa j\xc3\xa1 tem 8 atalhos. Remova um para adicionar outro.");
    CHECK(store.All().size() == 8);
    CHECK(files.writeCount == writes);

    // Editar um dos 8 continua valendo.
    Atalho edited = store.All()[3];
    edited.nome = "Recepcao";
    CHECK(store.Save(edited, &error) == edited.id);
    CHECK(store.All()[3].nome == "Recepcao");
    CHECK(store.All().size() == 8);
}

TEST_CASE("atalhos store validates the name, the number and the action") {
    MemoryFileSystem files;
    AtalhosStore store(files, kPath);
    std::string error;

    CHECK(store.Save(Make("", "2007"), &error).empty());
    CHECK(error == "Digite o nome do atalho.");
    CHECK(store.Save(Make("   ", "2007"), &error).empty());
    CHECK(error == "Digite o nome do atalho.");

    // 24 caracteres cabem; 25 nao. O limite conta caracteres, nao bytes (cada "a" com til tem 2 bytes em UTF-8).
    CHECK_FALSE(store.Save(Make(std::string(24, 'a'), "2007"), &error).empty());
    CHECK(store.Save(Make(std::string(25, 'a'), "2007"), &error).empty());
    CHECK(error == "O nome pode ter at\xc3\xa9 24 caracteres.");
    std::string accents;
    for (int i = 0; i < 24; ++i) accents += "\xc3\xa3";
    CHECK_FALSE(store.Save(Make(accents, "2007"), &error).empty());
    CHECK(store.Save(Make(accents + "\xc3\xa3", "2007"), &error).empty());

    // Nada abaixo de U+0020 no nome (TAB, quebra de linha, ESC...).
    for (const char* bad : {"A\tB", "A\nB", "A\x01" "B", "A\x1b" "B", "A\rB", "A\x1f"}) {
        error.clear();
        CHECK(store.Save(Make(bad, "2007"), &error).empty());
        CHECK(error == "O nome n\xc3\xa3o pode ter caracteres de controle.");
    }
    CHECK_FALSE(store.Save(Make("Jos\xc3\xa9 da Silva", "2007"), &error).empty());   // espaco e acento valem

    CHECK(store.Save(Make("Fulano", ""), &error).empty());
    CHECK(error == "Digite o n\xc3\xbamero do atalho.");
    for (const char* bad : {"20 07", "20a7", "2007;", "\xc3\xa3"}) {
        error.clear();
        CHECK(store.Save(Make("Fulano", bad), &error).empty());
        CHECK(error == "O n\xc3\xbamero s\xc3\xb3 pode ter d\xc3\xadgitos, *, # e +.");
    }
    CHECK(store.Save(Make("Fulano", std::string(33, '1')), &error).empty());
    CHECK(error == "O n\xc3\xbamero pode ter at\xc3\xa9 32 caracteres.");
    CHECK_FALSE(store.Save(Make("Fulano", std::string(32, '1')), &error).empty());
    CHECK_FALSE(store.Save(Make("Codigo", "*8#+0123456789"), &error).empty());

    // Um id que nao existe nao vira um atalho novo.
    Atalho ghost = Make("Fantasma", "2007");
    ghost.id = "naoexiste";
    error.clear();
    CHECK(store.Save(ghost, &error).empty());
    CHECK(error == "Esse atalho n\xc3\xa3o existe mais.");

    // Sem ponteiro de erro tambem funciona.
    CHECK(store.Save(Make("", "1"), nullptr).empty());
}

TEST_CASE("atalhos store trims the name and the number") {
    MemoryFileSystem files;
    AtalhosStore store(files, kPath);
    const std::string id = store.Save(Make("  Joao  ", " 2007 "), nullptr);
    REQUIRE_FALSE(id.empty());
    CHECK(store.All()[0].nome == "Joao");
    CHECK(store.All()[0].numero == "2007");
}

TEST_CASE("atalhos store round trips through atalhos.json") {
    MemoryFileSystem files;
    {
        AtalhosStore store(files, kPath);
        REQUIRE(store.Load());   // sem arquivo: vazio, sem erro
        CHECK(store.All().empty());
        REQUIRE_FALSE(store.Save(Make("Recepcao", "2001", Atalho::Ligar, true), nullptr).empty());
        REQUIRE_FALSE(store.Save(Make("Transf", "2002", Atalho::Transferir), nullptr).empty());
        REQUIRE_FALSE(store.Save(Make("Consulta", "*8", Atalho::Consulta), nullptr).empty());
        REQUIRE_FALSE(store.Save(Make("Senha", "1234#", Atalho::Teclas), nullptr).empty());
    }
    const nlohmann::json json = nlohmann::json::parse(files.files.at(kPath));
    CHECK(json["versao"] == 1);
    REQUIRE(json["atalhos"].size() == 4);
    CHECK(json["atalhos"][0]["nome"] == "Recepcao");
    CHECK(json["atalhos"][0]["numero"] == "2001");
    CHECK(json["atalhos"][0]["acao"] == "ligar");
    CHECK(json["atalhos"][0]["blf"] == true);
    CHECK(json["atalhos"][1]["acao"] == "transferir");
    CHECK(json["atalhos"][2]["acao"] == "consulta");
    CHECK(json["atalhos"][3]["acao"] == "teclas");
    CHECK(json["atalhos"][3]["blf"] == false);

    AtalhosStore reloaded(files, kPath);
    REQUIRE(reloaded.Load());
    REQUIRE(reloaded.All().size() == 4);
    const Atalho& first = reloaded.All()[0];
    CHECK_FALSE(first.id.empty());
    CHECK(first.nome == "Recepcao");
    CHECK(first.numero == "2001");
    CHECK(first.acao == Atalho::Ligar);
    CHECK(first.blf);
    CHECK(reloaded.All()[1].acao == Atalho::Transferir);
    CHECK(reloaded.All()[2].acao == Atalho::Consulta);
    CHECK(reloaded.All()[3].acao == Atalho::Teclas);
    CHECK_FALSE(reloaded.All()[3].blf);
    // Os ids sao distintos.
    CHECK(reloaded.All()[0].id != reloaded.All()[1].id);
}

TEST_CASE("atalhos store removes and keeps the order") {
    MemoryFileSystem files;
    AtalhosStore store(files, kPath);
    const std::string a = store.Save(Make("A", "1"), nullptr);
    const std::string b = store.Save(Make("B", "2"), nullptr);
    const std::string c = store.Save(Make("C", "3"), nullptr);
    CHECK_FALSE(store.Remove("nao"));
    CHECK(store.Remove(b));
    REQUIRE(store.All().size() == 2);
    CHECK(store.All()[0].id == a);
    CHECK(store.All()[1].id == c);
    AtalhosStore reloaded(files, kPath);
    REQUIRE(reloaded.Load());
    REQUIRE(reloaded.All().size() == 2);
    CHECK(reloaded.All()[1].nome == "C");

    // Disco falhando: nada muda, na memoria e no disco.
    files.failWrites = true;
    CHECK_FALSE(store.Remove(a));
    CHECK(store.All().size() == 2);
    std::string error;
    CHECK(store.Save(Make("D", "4"), &error).empty());
    CHECK(error == "N\xc3\xa3o foi poss\xc3\xadvel gravar os atalhos.");
    CHECK(store.All().size() == 2);
}

TEST_CASE("atalhos store loads what it can from a damaged file") {
    MemoryFileSystem files;
    files.files[kPath] = "isto nao e json";
    AtalhosStore store(files, kPath);
    CHECK_FALSE(store.Load());
    CHECK(store.All().empty());
    CHECK(files.files[kPath] == "isto nao e json");   // nao e tocado ate o proximo Save

    files.files[kPath] = R"({"versao":2,"atalhos":[]})";
    CHECK_FALSE(store.Load());

    // Entradas ruins ficam de fora; as boas ficam; passam so os 8 primeiros.
    nlohmann::json root = {{"versao", 1}, {"atalhos", nlohmann::json::array()}};
    root["atalhos"].push_back({{"id", "a"}, {"nome", "Bom"}, {"numero", "2001"}, {"acao", "ligar"}, {"blf", true}});
    root["atalhos"].push_back({{"id", "b"}, {"nome", ""}, {"numero", "2002"}, {"acao", "ligar"}});          // sem nome
    root["atalhos"].push_back({{"id", "c"}, {"nome", "X"}, {"numero", "2x3"}, {"acao", "ligar"}});          // numero ruim
    root["atalhos"].push_back({{"id", "d"}, {"nome", "X"}, {"numero", "2003"}, {"acao", "voar"}});          // acao ruim
    root["atalhos"].push_back({{"id", "a"}, {"nome", "Repetido"}, {"numero", "2004"}, {"acao", "ligar"}});  // id repetido
    root["atalhos"].push_back({{"nome", "SemId"}, {"numero", "2005"}, {"acao", "ligar"}});                   // sem id
    root["atalhos"].push_back({{"id", "e"}, {"nome", "A\tB"}, {"numero", "2006"}, {"acao", "ligar"}});     // controle
    root["atalhos"].push_back(42);
    for (int i = 0; i < 9; ++i) {
        root["atalhos"].push_back({{"id", "n" + std::to_string(i)}, {"nome", "N"}, {"numero", "3"}, {"acao", "teclas"}});
    }
    files.files[kPath] = root.dump();
    REQUIRE(store.Load());
    REQUIRE(store.All().size() == 8);
    CHECK(store.All()[0].id == "a");
    CHECK(store.All()[0].nome == "Bom");
    CHECK(store.All()[0].blf);
    CHECK(store.All()[1].id == "n0");
}
