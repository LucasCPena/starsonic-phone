// A linha de comando do StarsonicPhone.exe (windows/app/src/Links.h, ParseCommandLine): os links tel:/sip:/callto:
// nunca carregam opcoes. O instalador registra "<exe>" --link "%1": tudo depois do --link e o link, e um argumento
// que e um link desliga todas as opcoes. O --dados so vale como o primeiro argumento, sem link. C++ portatil:
// roda no Linux e no job windows (o CommandLineToArgvW de verdade fica no tests/win/test_links.cpp).
#include <optional>
#include <string>
#include <vector>

#include "Links.h"
#include "test_support.h"

using starsonic::CommandLine;
using starsonic::ParseCommandLine;
using starsonic::ParseMeetingLink;

namespace {

std::string Link(const CommandLine& line) { return line.link ? *line.link : std::string("(nada)"); }

std::string Meeting(const std::wstring& argument) {
    const std::optional<std::string> code = ParseMeetingLink(argument);
    return code ? *code : std::string("(nada)");
}
std::string Meeting(const CommandLine& line) { return line.meeting ? *line.meeting : std::string("(nada)"); }

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

TEST_CASE("MeetingLink accepts the exact form") {
    CHECK(Meeting(L"starsonic://reuniao/abcdefghjk") == "abcdefghjk");
    CHECK(Meeting(L"STARSONIC://reuniao/ABCDEFGHJK") == "abcdefghjk");
    CHECK(Meeting(L"starsonic://reuniao/abcde%20fghjk") == "abcdefghjk");
    CHECK(Meeting(L"starsonic://reuniao/%41bcdefghjk") == "abcdefghjk");
    CHECK(Meeting(L"  starsonic://reuniao/abcdefghjk  ") == "abcdefghjk");
}

TEST_CASE("MeetingLink refuses everything else") {
    CHECK(Meeting(L"starsonic://reuniao/abcdefghjk/") == "(nada)");
    CHECK(Meeting(L"starsonic://reuniao/abcdefghjk?x=1") == "(nada)");
    CHECK(Meeting(L"starsonic://reuniao/abcdefghjk#p=x") == "(nada)");
    CHECK(Meeting(L"starsonic://outra/abcdefghjk") == "(nada)");
    CHECK(Meeting(L"starsonic://REUNIAO/abcdefghjk") == "(nada)");
    CHECK(Meeting(L"starsonic://reuniao/abcdefghj") == "(nada)");     // 9
    CHECK(Meeting(L"starsonic://reuniao/abcdefghjkm") == "(nada)");   // 11
    CHECK(Meeting(L"starsonic://reuniao/abcdefghji") == "(nada)");    // um 'i'
    CHECK(Meeting(L"starsonic://reuniao/abcdefghj0") == "(nada)");    // um '0'
    CHECK(Meeting(L"starsonic://reuniao/abcdefghj%") == "(nada)");
    CHECK(Meeting(L"starsonic://reuniao/") == "(nada)");
    CHECK(Meeting(L"starsonic:reuniao/abcdefghjk") == "(nada)");
    CHECK(Meeting(L"tel:2003") == "(nada)");
    CHECK(Meeting(L"") == "(nada)");
}

TEST_CASE("a meeting link is a link of the command line") {
    // Tudo depois do --link e o link (como no tel:): o --sair que vem junto estraga o link, e nenhuma opcao vale.
    CommandLine line = ParseCommandLine({L"--link", L"starsonic://reuniao/abcdefghjk", L"--sair"});
    CHECK(Meeting(line) == "(nada)");
    CHECK(NoOptions(line));

    line = ParseCommandLine({L"--link", L"starsonic://reuniao/abcdefghjk"});
    CHECK(Meeting(line) == "abcdefghjk");
    CHECK_FALSE(line.link.has_value());

    // O registro antigo: o argumento sozinho, e as opcoes dele desligadas.
    line = ParseCommandLine({L"starsonic://reuniao/abcdefghjk"});
    CHECK(Meeting(line) == "abcdefghjk");
    CHECK_FALSE(line.link.has_value());
    line = ParseCommandLine({L"--sair", L"--bandeja", L"starsonic://reuniao/abcdefghjk"});
    CHECK(Meeting(line) == "abcdefghjk");
    CHECK(NoOptions(line));

    // Um argumento e um tel: ou um starsonic:, nunca os dois.
    line = ParseCommandLine({L"tel:2003", L"starsonic://reuniao/abcdefghjk"});
    CHECK(Link(line) == "2003");
    CHECK(Meeting(line) == "(nada)");
    line = ParseCommandLine({L"starsonic://reuniao/abcdefghjk", L"tel:2003"});
    CHECK(Link(line) == "(nada)");
    CHECK(Meeting(line) == "abcdefghjk");

    // Um starsonic: que nao vale tambem desliga as opcoes (--link).
    line = ParseCommandLine({L"--link", L"starsonic://reuniao/abcdefghjk\" --dados x"});
    CHECK(NoOptions(line));
    CHECK(Meeting(line) == "(nada)");
}
