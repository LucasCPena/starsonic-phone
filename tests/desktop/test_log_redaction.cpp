// O diagnostico.log vai para o suporte (o "Enviar diagnostico"): o motor escreve as mensagens SIP inteiras no nivel 4,
// e o Authorization do REGISTER (o digest) permitiria tentar senhas fora do ar. RedactSecrets (o unico ponto, chamado
// pelo DiagLog do executavel) esconde o valor dos cabecalhos Authorization e Proxy-Authorization e deixa o resto.
//
// (0.2.0) RedactUrl: o endereco de uma navegacao ou de uma janela nova que o WebViewHost bloqueou vai ao diagnostico so
// com o esquema (e o host no http, https, ws e wss). Um arquivo solto numa janela navega para o file:// dele, com o
// nome do usuario do Windows e o do arquivo, e o diagnostico nunca leva o nome de um arquivo.
#include <string>

#include "LogRedaction.h"
#include "test_support.h"

using starsonic::RedactSecrets;
using starsonic::RedactUrl;

TEST_CASE("the diagnostics hide the Authorization and Proxy-Authorization values") {
    const std::string sent =
        "motor 4: 20:31:00.123 pjsua_core.c  .TX 612 bytes Request msg REGISTER/cseq=2 (tdta0x1) to UDP 1.2.3.4:5060:\r\n"
        "REGISTER sip:pbx.example.com SIP/2.0\r\n"
        "Via: SIP/2.0/UDP 10.0.0.2:5060;rport;branch=z9hG4bKPj1\r\n"
        "From: <sip:2001@pbx.example.com>;tag=abc\r\n"
        "Authorization: Digest username=\"2001\", realm=\"asterisk\", nonce=\"6f1c\", uri=\"sip:pbx.example.com\", "
        "response=\"0123456789abcdef0123456789abcdef\", algorithm=MD5\r\n"
        "proxy-authorization: Digest username=\"2001\", response=\"ffffffffffffffffffffffffffffffff\"\r\n"
        "Content-Length:  0\r\n"
        "\r\n";
    const std::string expected =
        "motor 4: 20:31:00.123 pjsua_core.c  .TX 612 bytes Request msg REGISTER/cseq=2 (tdta0x1) to UDP 1.2.3.4:5060:\r\n"
        "REGISTER sip:pbx.example.com SIP/2.0\r\n"
        "Via: SIP/2.0/UDP 10.0.0.2:5060;rport;branch=z9hG4bKPj1\r\n"
        "From: <sip:2001@pbx.example.com>;tag=abc\r\n"
        "Authorization: <oculto>\r\n"
        "proxy-authorization: <oculto>\r\n"
        "Content-Length:  0\r\n"
        "\r\n";
    CHECK(RedactSecrets(sent) == expected);
}

TEST_CASE("the redaction ignores case, spacing and folded lines and keeps everything else") {
    // Sem espaco depois dos dois pontos, em maiusculas, com \n sozinho.
    CHECK(RedactSecrets("AUTHORIZATION:Digest response=\"aa\"\nVia: x") == "AUTHORIZATION: <oculto>\nVia: x");
    CHECK(RedactSecrets("Proxy-Authorization :Digest response=\"aa\"") == "Proxy-Authorization : <oculto>");
    // Um cabecalho dobrado (a continuacao comeca com espaco ou tab) sai inteiro.
    CHECK(RedactSecrets("Authorization: Digest username=\"2001\",\r\n response=\"aa\",\r\n\talgorithm=MD5\r\nTo: <sip:x>\r\n") ==
          "Authorization: <oculto>\r\nTo: <sip:x>\r\n");
    // Numa linha so (o diagnostico de uma linha), o valor ate o fim dela.
    CHECK(RedactSecrets("motor 4: hdr Authorization: Digest response=\"aa\"") == "motor 4: hdr Authorization: <oculto>");
    // O desafio do servidor (sem segredo da pessoa) e os outros cabecalhos ficam.
    const std::string challenge = "WWW-Authenticate: Digest realm=\"asterisk\", nonce=\"6f1c\"\r\nX-Authorizations: 2\r\n";
    CHECK(RedactSecrets(challenge) == challenge);
    CHECK(RedactSecrets("") == "");
    CHECK(RedactSecrets("interface pronta") == "interface pronta");
    CHECK(RedactSecrets("Authorization") == "Authorization");
}

TEST_CASE("a blocked address keeps only the scheme, and the host of http, https, ws and wss") {
    // O arquivo solto numa janela: so o esquema, nunca o caminho (o usuario do Windows e o nome do arquivo).
    CHECK(RedactUrl("file:///C:/Users/x/Documents/Proposta.pdf") == "file:");
    CHECK(RedactUrl("file://servidor/compartilhada/Proposta.pdf") == "file:");

    // O http, o https, o ws e o wss ficam com o host: nunca o caminho, a consulta, o fragmento, a porta, nem o usuario
    // e a senha antes do "@".
    CHECK(RedactUrl("https://exemplo.com/a/b?c=1#d") == "https://exemplo.com");
    CHECK(RedactUrl("https://user:senha@exemplo.com/x") == "https://exemplo.com");
    CHECK(RedactUrl("https://user@exemplo.com") == "https://exemplo.com");
    CHECK(RedactUrl("https://a@b@exemplo.com/") == "https://exemplo.com");
    CHECK(RedactUrl("http://exemplo.com") == "http://exemplo.com");
    CHECK(RedactUrl("http://exemplo.com?c=1") == "http://exemplo.com");
    CHECK(RedactUrl("http://exemplo.com#d") == "http://exemplo.com");
    CHECK(RedactUrl("wss://chat.starcloud-starsonic.com.br:8443/api/v1/eventos?bilhete=abc") ==
          "wss://chat.starcloud-starsonic.com.br");
    CHECK(RedactUrl("ws://[::1]:8080/x") == "ws://[::1]");
    // O esquema vai em minusculas.
    CHECK(RedactUrl("HTTPS://exemplo.com/x") == "https://exemplo.com");
    // Um host que nao e um host (um espaco, uma quebra de linha, um acento) nao vai: so o esquema.
    CHECK(RedactUrl("https://Proposta ACME.pdf/") == "https:");
    CHECK(RedactUrl("https://exemplo.com\nnavegacao bloqueada: file:") == "https:");
    CHECK(RedactUrl("https://Relat\xc3\xb3rio.com/") == "https:");
    // Sem o host: so o esquema.
    CHECK(RedactUrl("https:exemplo.com/x") == "https:");
    CHECK(RedactUrl("https://") == "https:");
    CHECK(RedactUrl("https://user:senha@/x") == "https:");

    // Os outros esquemas: so o esquema (o blob: e o data: tambem levariam o resto).
    CHECK(RedactUrl("blob:https://app.starsonic.local/0b6f6c1e-4f6a-4a39-9d0b-2f3c1a5e7d88") == "blob:");
    CHECK(RedactUrl("data:text/plain,Bom dia! O pedido chegou.") == "data:");
    CHECK(RedactUrl("mailto:ana.souza@exemplo.com") == "mailto:");
    CHECK(RedactUrl("javascript:alert(document.title)") == "javascript:");
    CHECK(RedactUrl("about:blank") == "about:");
    // Um caminho do Windows: no maximo a letra do disco.
    CHECK(RedactUrl("C:\\Users\\x\\Proposta.pdf") == "c:");

    // Sem um esquema no comeco: o texto fixo, nunca o texto.
    CHECK(RedactUrl("Proposta ACME.pdf") == "(sem esquema)");
    CHECK(RedactUrl("") == "(sem esquema)");
    CHECK(RedactUrl("/Users/x/Proposta.pdf") == "(sem esquema)");
    CHECK(RedactUrl("2003:Ana Souza") == "(sem esquema)");
    CHECK(RedactUrl(":Proposta.pdf") == "(sem esquema)");
    CHECK(RedactUrl("Proposta ACME:pdf") == "(sem esquema)");
}
