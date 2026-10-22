// A linha de comando do StarsonicPhone.exe (windows/app/src/Links.h, ParseCommandLine): os links tel:/sip:/callto:
// nunca carregam opcoes. O instalador registra "<exe>" --link "%1": tudo depois do --link e o link, e um argumento
// que e um link desliga todas as opcoes. O --dados so vale como o primeiro argumento, sem link. C++ portatil:
// roda no Linux e no job windows (o CommandLineToArgvW de verdade fica no tests/win/test_links.cpp).
#include <string>
#include <vector>

#include "Links.h"
#include "test_support.h"

using starsonic::CommandLine;
using starsonic::ParseCommandLine;

namespace {

std::string Link(const CommandLine& line) { return line.link ? *line.link : std::string("(nada)"); }

bool NoOptions(const CommandLine& line) { return line.dataFolder.empty() && !line.quit && !line.tray; }

}  // namespace

TEST_CASE("the options of the command line") {
    CommandLine line = ParseCommandLine({});
    CHECK(NoOptions(line));
    CHECK(Link(line) == "(nada)");

    line = ParseCommandLine({L"--dados", L"C:\\Testes\\dados"});
    CHECK(line.dataFolder == L"C:\\Testes\\dados");
    CHECK_FALSE(line.quit);
    CHECK_FALSE(line.tray);

    line = ParseCommandLine({L"--dados", L"C:\\Testes\\dados", L"--sair"});
    CHECK(line.dataFolder == L"C:\\Testes\\dados");
    CHECK(line.quit);

    CHECK(ParseCommandLine({L"--sair"}).quit);
    CHECK(ParseCommandLine({L"--bandeja"}).tray);
    CHECK(ParseCommandLine({L"/minimized"}).tray);

    // O --dados fora do comeco nao vale (so os testes o usam, sempre primeiro).
    line = ParseCommandLine({L"--bandeja", L"--dados", L"\\\\servidor\\pasta"});
    CHECK(line.tray);
    CHECK(line.dataFolder.empty());
    CHECK(ParseCommandLine({L"--dados"}).dataFolder.empty());
}

TEST_CASE("a link never carries options") {
    // "<exe>" --link "tel:2003\" --dados x": o CommandLineToArgvW entrega o resto inteiro como o argumento do link.
    CommandLine line = ParseCommandLine({L"--link", L"tel:2003\" --dados x"});
    CHECK(NoOptions(line));
    CHECK(Link(line) == "(nada)");   // nao e um numero: nada vai para o Teclado

    // Um lancador que nao poe aspas: tudo depois do --link e o link.
    line = ParseCommandLine({L"--link", L"tel:2003", L"--dados", L"x"});
    CHECK(NoOptions(line));
    CHECK(Link(line) == "(nada)");
    line = ParseCommandLine({L"--link", L"tel:+55", L"11", L"5060-3000"});
    CHECK(NoOptions(line));
    CHECK(Link(line) == "+551150603000");

    // O caso normal.
    line = ParseCommandLine({L"--link", L"tel:2003"});
    CHECK(NoOptions(line));
    CHECK(Link(line) == "2003");
    line = ParseCommandLine({L"--link", L"sip:2003@starcloud1-starsonic.com.br"});
    CHECK(Link(line) == "2003");
    CHECK(Link(ParseCommandLine({L"--link"})) == "(nada)");

    // Opcoes antes do --link tambem nao valem.
    line = ParseCommandLine({L"--dados", L"\\\\servidor\\pasta", L"--sair", L"--link", L"tel:2003"});
    CHECK(NoOptions(line));
    CHECK(Link(line) == "2003");

    // O registro antigo ("<exe>" "%1", da instalacao anterior): um argumento que e um link desliga as opcoes.
    line = ParseCommandLine({L"tel:2003", L"--dados", L"\\\\servidor\\pasta", L"--sair", L"--bandeja"});
    CHECK(NoOptions(line));
    CHECK(Link(line) == "2003");
    line = ParseCommandLine({L"--dados", L"\\\\servidor\\pasta", L"callto:2003"});
    CHECK(NoOptions(line));
    CHECK(Link(line) == "2003");
}
