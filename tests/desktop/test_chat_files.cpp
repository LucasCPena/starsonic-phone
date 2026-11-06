// As regras do chat no executavel do Windows (windows/app/src/ChatFiles.h, 0.2.0): o numero no icone da barra de
// tarefas, o nome do arquivo baixado para a pasta Downloads (o nome vem de outra pessoa do chat: nunca sai da pasta,
// nunca e um nome reservado do Windows, e ganha o "(2)" quando ja existe), o Zone.Identifier (o "Mark of the Web"), o
// corte do titulo e do texto do aviso do Windows, as linhas do diagnostico do download e das falhas do aviso e do
// numero, e a chatChave so para a janela principal. C++ portatil: roda tambem no Linux.
#include <set>
#include <string>

#include "ChatFiles.h"
#include "Protocol.h"
#include "test_support.h"

using namespace starsonic;

namespace {

// Os pontos de codigo de um texto UTF-8 valido (os bytes que nao sao de continuacao).
size_t CodePoints(const std::string& utf8) {
    size_t count = 0;
    for (char ch : utf8) {
        if ((static_cast<unsigned char>(ch) & 0xC0) != 0x80) ++count;
    }
    return count;
}

std::string Repeat(const std::string& piece, int times) {
    std::string out;
    for (int i = 0; i < times; ++i) out += piece;
    return out;
}

}  // namespace

TEST_CASE("the badge text") {
    CHECK(BadgeText(0) == "");
    CHECK(BadgeText(-1) == "");
    CHECK(BadgeText(1) == "1");
    CHECK(BadgeText(9) == "9");
    CHECK(BadgeText(10) == "9+");
    CHECK(BadgeText(250) == "9+");
    // A descricao para o leitor de tela ("1 mensagem nao lida" e "12 mensagens nao lidas", com o til, em UTF-8).
    CHECK(BadgeDescription(1) == "1 mensagem n\xc3\xa3o lida");
    CHECK(BadgeDescription(12) == "12 mensagens n\xc3\xa3o lidas");
}

TEST_CASE("the name to save") {
    // Um nome comum fica como veio, tambem com acentos ("Relatorio de producao.pdf", com os acentos, em UTF-8).
    CHECK(SafeDownloadName("Proposta ACME.pdf") == "Proposta ACME.pdf");
    const std::string accents = "Relat\xc3\xb3rio de produ\xc3\xa7\xc3\xa3o.pdf";
    CHECK(SafeDownloadName(accents) == accents);

    // Nunca fora da pasta: so a parte depois da ultima barra (as duas).
    CHECK(SafeDownloadName("../a.pdf") == "a.pdf");
    CHECK(SafeDownloadName("..\\..\\Windows\\a.pdf") == "a.pdf");
    CHECK(SafeDownloadName("..") == "arquivo");

    // O U+202E faz o "Proposta<U+202E>fdp.exe" aparecer como "Propostaexe.pdf": ele sai, e os outros controles da
    // direcao do texto tambem (U+061C, U+200E, U+200F, U+202A a U+202E e U+2066 a U+2069).
    CHECK(SafeDownloadName("Proposta\xe2\x80\xae" "fdp.exe") == "Propostafdp.exe");
    const struct {
        unsigned code;
        const char* utf8;
    } marks[] = {{0x061C, "\xd8\x9c"},     {0x200E, "\xe2\x80\x8e"}, {0x200F, "\xe2\x80\x8f"},
                 {0x202A, "\xe2\x80\xaa"}, {0x202B, "\xe2\x80\xab"}, {0x202C, "\xe2\x80\xac"},
                 {0x202D, "\xe2\x80\xad"}, {0x202E, "\xe2\x80\xae"}, {0x2066, "\xe2\x81\xa6"},
                 {0x2067, "\xe2\x81\xa7"}, {0x2068, "\xe2\x81\xa8"}, {0x2069, "\xe2\x81\xa9"}};
    for (const auto& mark : marks) {
        INFO(mark.code);
        CHECK(SafeDownloadName(std::string("a") + mark.utf8 + "b.txt") == "ab.txt");
    }

    // Os caracteres que o Windows nao aceita num nome saem (o ":" tambem abriria um fluxo do arquivo).
    CHECK(SafeDownloadName("a:b*c?.txt") == "abc.txt");
    CHECK(SafeDownloadName("<a>|\"b\".txt") == "ab.txt");

    // As chaves saem do mesmo jeito: o Windows trata a extensao ".{CLSID}" como um objeto do shell, e o arquivo que
    // abre sozinho iria para outro programa, escondendo o tipo de verdade (o nome vem de outra pessoa do chat).
    CHECK(SafeDownloadName("Proposta.pdf.{3050F4D8-98B5-11CF-BB82-00AA00BDCE0B}") ==
          "Proposta.pdf.3050F4D8-98B5-11CF-BB82-00AA00BDCE0B");
    CHECK(SafeDownloadName("{a}b{.txt") == "ab.txt");

    // Os nomes reservados do Windows (o de antes do primeiro ponto, sem caixa) ganham um "_" na frente.
    CHECK(SafeDownloadName("CON.txt") == "_CON.txt");
    CHECK(SafeDownloadName("nul") == "_nul");
    CHECK(SafeDownloadName("com1.tar.gz") == "_com1.tar.gz");
    CHECK(SafeDownloadName("Lpt9") == "_Lpt9");
    CHECK(SafeDownloadName("aux .txt") == "_aux .txt");
    CHECK(SafeDownloadName("CONSOLE.txt") == "CONSOLE.txt");
    CHECK(SafeDownloadName("COM10.txt") == "COM10.txt");

    // Os pontos e os espacos das pontas saem (o Windows os tira do fim do nome).
    CHECK(SafeDownloadName("a.pdf. ") == "a.pdf");
    CHECK(SafeDownloadName(" . a.pdf") == "a.pdf");

    // Vazio ou so de espacos: "arquivo".
    CHECK(SafeDownloadName("") == "arquivo");
    CHECK(SafeDownloadName("   ") == "arquivo");

    // 300 caracteres (o "c" com cedilha, dois bytes cada) terminando em ".xlsx": 120 pontos de codigo, com a extensao.
    const std::string longName = Repeat("\xc3\xa7", 295) + ".xlsx";
    REQUIRE(CodePoints(longName) == 300);
    const std::string cut = SafeDownloadName(longName);
    CHECK(CodePoints(cut) == 120);
    CHECK(cut == Repeat("\xc3\xa7", 115) + ".xlsx");
    CHECK(SafeDownloadName(Repeat("a", 300)) == Repeat("a", 120));

    // Os caracteres de controle saem antes de tudo, tambem o NUL: o "nota.exe<NUL>.pdf" nunca e cortado no NUL (o
    // "nota.exe"). E o tab, o fim de linha, o DEL e os de controle do Latin-1 (U+0085, U+009F).
    CHECK(SafeDownloadName(std::string("nota.exe\0.pdf", 13)) == "nota.exe.pdf");
    CHECK(SafeDownloadName("a\tb\r\n\x7f" "c.txt") == "abc.txt");
    CHECK(SafeDownloadName("a\xc2\x85" "b\xc2\x9f.txt") == "ab.txt");

    // O UTF-8 quebrado sai: o byte solto, a sequencia cortada, a forma longa (a da barra nunca separa) e o substituto.
    CHECK(SafeDownloadName("a\xff" "b.pdf") == "ab.pdf");
    CHECK(SafeDownloadName("a\xc3.pdf") == "a.pdf");
    CHECK(SafeDownloadName("..\xc0\xaf" "a.pdf") == "a.pdf");
    CHECK(SafeDownloadName("a\xed\xa0\x80" "b.pdf") == "ab.pdf");
}

TEST_CASE("a free name gets (2), (3) and keeps the extension") {
    std::set<std::string> taken;
    const auto exists = [&taken](const std::string& name) { return taken.count(name) > 0; };
    CHECK(FreeName("a.pdf", exists) == "a.pdf");
    taken.insert("a.pdf");
    CHECK(FreeName("a.pdf", exists) == "a (2).pdf");
    taken.insert("a (2).pdf");
    CHECK(FreeName("a.pdf", exists) == "a (3).pdf");
    taken.insert("LEIAME");
    CHECK(FreeName("LEIAME", exists) == "LEIAME (2)");
    // Com acento: a mesma regra.
    taken.insert("Relat\xc3\xb3rio.xlsx");
    CHECK(FreeName("Relat\xc3\xb3rio.xlsx", exists) == "Relat\xc3\xb3rio (2).xlsx");

    // Uma pasta que diz que todo nome existe nao prende quem grava: depois do (1000), nenhum ("").
    int asked = 0;
    CHECK(FreeName("a.pdf", [&asked](const std::string&) {
              ++asked;
              return true;
          }) == "");
    CHECK(asked == 1000);
}

TEST_CASE("the zone identifier") {
    CHECK(ZoneIdentifier() ==
          "[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://chat.starcloud-starsonic.com.br:8443/\r\n");
}

TEST_CASE("the download toast") {
    // "Nao foi possivel baixar o arquivo.", com o til e o acento, em UTF-8.
    const std::string failed = "N\xc3\xa3o foi poss\xc3\xadvel baixar o arquivo.";
    // O 200 com o arquivo gravado: sem toast.
    CHECK(DownloadToast(200, true) == "");
    // O 410: o arquivo passou de 365 dias e saiu do servidor.
    CHECK(DownloadToast(410, false) == "Arquivo expirado");
    // Qualquer outra coisa: o 200 que nao foi gravado, a rede (o status 0), o 401, o 404 e o 500.
    CHECK(DownloadToast(200, false) == failed);
    CHECK(DownloadToast(0, false) == failed);
    CHECK(DownloadToast(401, false) == failed);
    CHECK(DownloadToast(404, false) == failed);
    CHECK(DownloadToast(500, false) == failed);
}

TEST_CASE("the download line says when the file that came was not saved, with the code and nothing else") {
    // A resposta do servidor: o status e o tamanho (o 200 gravado, os outros status e a rede, com o status 0).
    CHECK(DownloadLine(200, 1258291, 0) == "chat: download 200 1258291");
    CHECK(DownloadLine(410, 0, 0) == "chat: download 410 0");
    CHECK(DownloadLine(404, 12, 0) == "chat: download 404 12");
    CHECK(DownloadLine(0, 0, 0) == "chat: download 0 0");
    // O arquivo que veio e nao foi gravado (R8: sem a pasta Downloads, sem o fluxo Zone.Identifier, o caminho comprido
    // demais, o disco cheio): nunca o "chat: download 200 <bytes>" de um arquivo gravado, e sim o codigo de erro do
    // Windows da chamada que falhou, sem o nome nem o caminho.
    CHECK(DownloadLine(200, 1258291, 3) == "chat: download nao gravado (3)");        // ERROR_PATH_NOT_FOUND
    CHECK(DownloadLine(200, 1258291, 112) == "chat: download nao gravado (112)");    // ERROR_DISK_FULL
    CHECK(DownloadLine(200, 1258291, 206) == "chat: download nao gravado (206)");    // ERROR_FILENAME_EXCED_RANGE
    CHECK(DownloadLine(200, 1258291, 1) == "chat: download nao gravado (1)");        // ERROR_INVALID_FUNCTION
    // A pasta Downloads que o Windows nao deu, com um HRESULT sem um codigo da Win32 dentro: o HRESULT, em hexadecimal.
    CHECK(DownloadLine(200, 1258291, 0x80004005u) == "chat: download nao gravado (0x80004005)");
}

TEST_CASE("the chat key goes only to the main window, never to the call notice") {
    // A chatChave (a resposta ao chatKey, com a chave e a empresa) vai so para a interface da janela principal, que a
    // pediu: nunca para o aviso de ligacao recebida (aviso.html), que so le o estado.
    const std::string company = "ACME Com\xc3\xa9rcio Ltda";   // com o acento, em UTF-8
    CHECK_FALSE(NoticeMayGet(ChatKeyMessage("Chave_de-teste-inventada-0123456789-ABCDxyz", company)));
    CHECK_FALSE(NoticeMayGet(ChatKeyMessage("", "")));
    CHECK_FALSE(NoticeMayGet(R"({ "type" : "chatChave", "v" : 1, "chave" : "x" })"));
    // Um texto que cita a chatChave e nao se le: tambem fica.
    CHECK_FALSE(NoticeMayGet(R"({"v":1,"type":"chatChave","chave":"Chave_de-teste)"));
    // As outras vao as duas janelas, como sempre (o estado e o que o aviso le), tambem com "chatChave" num texto.
    CHECK(NoticeMayGet(R"({"v":1,"type":"state","state":{"ligacao":null}})"));
    CHECK(NoticeMayGet(R"({"v":1,"type":"state","state":{"conta":{"nome":"chatChave"}}})"));
    CHECK(NoticeMayGet(R"({"v":1,"type":"ring","toque":"recebida"})"));
    CHECK(NoticeMayGet(R"({"v":1,"type":"toast","texto":"Arquivo expirado"})"));
    CHECK(NoticeMayGet(R"({"v":1,"type":"janela","frente":true})"));
    CHECK(NoticeMayGet(R"({"v":1,"type":"abrir","tela":"chat","conversa":7})"));
}

TEST_CASE("a notice or badge failure of Windows leaves one line with the operation and the HRESULT") {
    // O aviso do chat (o Shell_NotifyIconW da Tray) e o numero no icone (o ITaskbarList3 do TaskbarBadge): o nome da
    // operacao e o HRESULT em hexadecimal, com os 8 digitos, e nada mais.
    CHECK(ShellFailureLine("aviso", "Shell_NotifyIconW", 0x80004005u) ==
          "aviso: Shell_NotifyIconW falhou (0x80004005)");
    CHECK(ShellFailureLine("numero no icone", "CoCreateInstance", 0x80040154u) ==
          "numero no icone: CoCreateInstance falhou (0x80040154)");
    CHECK(ShellFailureLine("numero no icone", "HrInit", 0x8007000Eu) == "numero no icone: HrInit falhou (0x8007000e)");
    CHECK(ShellFailureLine("numero no icone", "SetOverlayIcon", 0x800705B4u) ==
          "numero no icone: SetOverlayIcon falhou (0x800705b4)");
    CHECK(ShellFailureLine("aviso", "Shell_NotifyIconW", 0x1u) == "aviso: Shell_NotifyIconW falhou (0x00000001)");
}

TEST_CASE("the notice text is cut in UTF-16 without splitting a pair") {
    const std::string ellipsis = "\xe2\x80\xa6";   // U+2026
    const std::string emoji = "\xf0\x9f\x98\x80";  // U+1F600: um par substituto (duas unidades) no UTF-16

    // Um texto curto fica como veio, tambem no limite exato (um acento e uma unidade, nao os dois bytes dele).
    CHECK(FitNoticeText("Bom dia! O pedido chegou.", 255) == "Bom dia! O pedido chegou.");
    CHECK(FitNoticeText(Repeat("\xc3\xa9", 63), 63) == Repeat("\xc3\xa9", 63));
    CHECK(FitNoticeText(Repeat("a", 61) + emoji, 63) == Repeat("a", 61) + emoji);

    // Um texto comprido termina em U+2026, com no maximo o limite.
    CHECK(FitNoticeText(Repeat("a", 300), 63) == Repeat("a", 62) + ellipsis);
    CHECK(FitNoticeText(Repeat("\xc3\xa9", 300), 255) == Repeat("\xc3\xa9", 254) + ellipsis);

    // O emoji na fronteira sai inteiro, ou fica de fora: nunca a metade do par.
    CHECK(FitNoticeText(Repeat("a", 61) + emoji + "bbb", 63) == Repeat("a", 61) + ellipsis);
    CHECK(FitNoticeText(Repeat("a", 60) + emoji + "bbb", 63) == Repeat("a", 60) + emoji + ellipsis);
    CHECK(FitNoticeText(Repeat(emoji, 40), 63) == Repeat(emoji, 31) + ellipsis);

    // Os limites pequenos: so o U+2026, ou nada.
    CHECK(FitNoticeText("abc", 1) == ellipsis);
    CHECK(FitNoticeText("abc", 0) == "");
}
