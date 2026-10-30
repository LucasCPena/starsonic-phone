// Testes da agenda do iPhone no nucleo (starsonic/desktop/Agenda.h; docs/ponte-windows.md, "O modo iPhone"; spec do
// iPhone, 6.4): o numero da agenda contra os formatos que a central manda (a Review Focus 2), a lista que o Replace
// guarda (sem o contato sem numero e sem o numero repetido) e o NameFor pelos indices, tambem numa agenda grande.
#include <chrono>
#include <optional>
#include <string>
#include <vector>

#include "Agenda.h"
#include "test_support.h"

using namespace starsonic;

namespace {

// O nome que o NameFor da, ou "<nenhum>" (a falha mostra o texto).
std::string NameOf(const AgendaStore& agenda, const std::string& number) {
    const std::optional<std::string> name = agenda.NameFor(number);
    return name ? *name : "<nenhum>";
}

// Cada contato num texto, "nome|numero|numero", na ordem.
std::vector<std::string> Flat(const std::vector<AgendaContact>& contacts) {
    std::vector<std::string> out;
    for (const AgendaContact& contact : contacts) {
        std::string line = contact.name;
        for (const std::string& number : contact.numbers) line += "|" + number;
        out.push_back(line);
    }
    return out;
}

}  // namespace

TEST_CASE("agenda numbers match the formats the PBX sends") {
    // O celular gravado com o +55, o DDD e os separadores, contra o que a central manda: com o 0 de saida, com o DDD,
    // so o numero, com o +55 e com outros separadores. Nos dois sentidos.
    const std::string saved = "+55 (11) 98888-7777";
    for (const char* sent :
         {"011988887777", "11988887777", "988887777", "+5511988887777", "55 11 98888 7777", "(11) 98888-7777"}) {
        INFO(sent);
        CHECK(SameAgendaNumber(saved, sent));
        CHECK(SameAgendaNumber(sent, saved));
    }
    // O numero local sem o 9 e o fixo: os 8 ultimos digitos batem.
    CHECK(SameAgendaNumber(saved, "8888-7777"));
    CHECK(SameAgendaNumber("(11) 3333-4040", "01133334040"));
    // Um ramal curto so bate com o mesmo numero.
    CHECK(SameAgendaNumber("2001", "2001"));
    CHECK(SameAgendaNumber("20-01", "2001"));
    CHECK_FALSE(SameAgendaNumber("2001", "+55 11 3333-2001"));
    CHECK_FALSE(SameAgendaNumber("+55 11 3333-2001", "2001"));
    CHECK_FALSE(SameAgendaNumber("2001", "2002"));
    CHECK_FALSE(SameAgendaNumber("2001", "12001"));
    // Com menos de 8 digitos de um lado, so os digitos inteiros valem.
    CHECK_FALSE(SameAgendaNumber("8887777", saved));
    CHECK_FALSE(SameAgendaNumber(saved, "98888-7776"));
    // Sem digitos, nada bate (nem com o mesmo texto).
    CHECK_FALSE(SameAgendaNumber("", ""));
    CHECK_FALSE(SameAgendaNumber("-", "-"));
    CHECK_FALSE(SameAgendaNumber("", "2001"));
    // O limite conhecido: os mesmos 8 ultimos digitos em DDDs diferentes batem (vale o primeiro na ordem da agenda).
    CHECK(SameAgendaNumber("+55 21 98888-7777", saved));
}

TEST_CASE("Replace drops contacts without numbers and repeated numbers, and NameFor uses the first match") {
    AgendaStore agenda;
    // Antes da primeira lista: pendente e vazia.
    CHECK(agenda.Permission() == AgendaPermission::Pending);
    CHECK(agenda.Count() == 0);
    CHECK(agenda.All().empty());
    CHECK(NameOf(agenda, "2003") == "<nenhum>");

    agenda.Replace(AgendaPermission::Granted,
                   {AgendaContact{"Ana Souza", {"+55 11 98888-7777", "55 (11) 98888-7777", "2003", "+5511988887777"}},
                    AgendaContact{"Sem Numero", {}},
                    AgendaContact{"So Tracos", {"", "-", " "}},
                    AgendaContact{"", {"(21) 97777-6666", "21977776666"}},
                    AgendaContact{"\xc3\x89lcio Matos", {"(11) 3333-4040", "11 3333 4040"}},
                    AgendaContact{"Bia", {"2003", "+55 21 97777-6666"}},
                    AgendaContact{"   ", {"4004"}},
                    AgendaContact{" Caio ", {"4004"}}});
    // Fora: o contato sem numero e o que so tem numeros sem digitos. Os repetidos (os mesmos digitos) ficam uma vez, o
    // primeiro, na ordem; os nomes e os numeros ficam como vieram, na ordem da agenda.
    CHECK(Flat(agenda.All()) == std::vector<std::string>{"Ana Souza|+55 11 98888-7777|2003",
                                                         "|(21) 97777-6666",
                                                         "\xc3\x89lcio Matos|(11) 3333-4040",
                                                         "Bia|2003|+55 21 97777-6666",
                                                         "   |4004",
                                                         " Caio |4004"});
    CHECK(agenda.Count() == 6);
    CHECK(agenda.Permission() == AgendaPermission::Granted);

    // O primeiro contato da agenda com o numero: o 2003 e da Ana (a Bia vem depois).
    CHECK(NameOf(agenda, "2003") == "Ana Souza");
    CHECK(NameOf(agenda, "011988887777") == "Ana Souza");
    CHECK(NameOf(agenda, "01133334040") == "\xc3\x89lcio Matos");
    // Um contato sem nome nao da nome: vale o proximo com o numero (a Bia), ou nenhum.
    CHECK(NameOf(agenda, "21977776666") == "Bia");
    CHECK(NameOf(agenda, "4004") == "Caio");   // o nome sem os espacos das pontas
    // Nenhum contato com o numero, ou um numero sem digitos.
    CHECK(NameOf(agenda, "9999") == "<nenhum>");
    CHECK(NameOf(agenda, "+55 11 3333-2003") == "<nenhum>");   // o ramal 2003 nao bate com um fixo
    CHECK(NameOf(agenda, "") == "<nenhum>");
    CHECK(NameOf(agenda, "-") == "<nenhum>");

    // Sem a permissao concedida, a lista e vazia (o que vier).
    for (const AgendaPermission permission : {AgendaPermission::Denied, AgendaPermission::Pending}) {
        agenda.Replace(permission, {AgendaContact{"Ana Souza", {"2003"}}});
        CHECK(agenda.Permission() == permission);
        CHECK(agenda.Count() == 0);
        CHECK(agenda.All().empty());
        CHECK(NameOf(agenda, "2003") == "<nenhum>");
    }

    // Uma lista nova troca a de antes inteira.
    agenda.Replace(AgendaPermission::Granted, {AgendaContact{"Ana Souza", {"2003"}}});
    agenda.Replace(AgendaPermission::Granted, {AgendaContact{"Davi", {"2004"}}});
    CHECK(Flat(agenda.All()) == std::vector<std::string>{"Davi|2004"});
    CHECK(NameOf(agenda, "2004") == "Davi");
    CHECK(NameOf(agenda, "2003") == "<nenhum>");
}

TEST_CASE("NameFor over 5000 contacts uses the index") {
    // Uma agenda grande e baguncada (a Review Focus 1): 5.000 contatos, cada um com o celular (com o +55 e o DDD), o
    // fixo e o celular de novo com outros separadores, os nomes com acento, e contatos sem numero no meio.
    std::vector<AgendaContact> contacts;
    for (int i = 0; i < 5000; ++i) {
        const std::string mobile = std::to_string(10000000 + i);   // os 8 ultimos digitos: um por contato
        AgendaContact contact;
        contact.name = (i % 3 == 0 ? std::string("Jo\xc3\xa3o ") : std::string("Contato ")) + std::to_string(i);
        contact.numbers = {"+55 (11) 9" + mobile, "(11) " + std::to_string(30000000 + i), "+55 11 9" + mobile};
        contacts.push_back(contact);
        if (i % 500 == 0) contacts.push_back(AgendaContact{"Sem numero " + std::to_string(i), {}});
    }
    AgendaStore agenda;
    const auto replaced = std::chrono::steady_clock::now();
    agenda.Replace(AgendaPermission::Granted, contacts);
    CHECK(std::chrono::duration<double>(std::chrono::steady_clock::now() - replaced).count() < 1.0);
    REQUIRE(agenda.Count() == 5000);
    const std::vector<AgendaContact> all = agenda.All();
    CHECK(all.front().numbers.size() == 2);   // o celular repetido fica uma vez
    CHECK(all.back().name == "Contato 4999");

    // 10.000 procuras, como a central manda: a metade acha (o celular com o 0 e o DDD, o fixo com o DDD), a outra
    // metade nao (uma lista percorrida iria ate o fim em cada uma).
    const auto start = std::chrono::steady_clock::now();
    int found = 0;
    int right = 0;
    for (int n = 0; n < 10000; ++n) {
        const int i = (n * 7919) % 5000;
        std::string number;
        if (n % 4 == 0) number = "0119" + std::to_string(10000000 + i);
        if (n % 4 == 1) number = "11" + std::to_string(30000000 + i);
        if (n % 4 >= 2) number = "0219" + std::to_string(20000000 + i);
        const std::optional<std::string> name = agenda.NameFor(number);
        if (!name) continue;
        ++found;
        if (*name == all[static_cast<size_t>(i)].name) ++right;
    }
    const double seconds = std::chrono::duration<double>(std::chrono::steady_clock::now() - start).count();
    CHECK(found == 5000);
    CHECK(right == 5000);
    CHECK(seconds < 1.0);
}
