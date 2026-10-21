// O diagnostico.log vai para o suporte (o "Enviar diagnostico"): o motor escreve as mensagens SIP inteiras no nivel 4,
// e o Authorization do REGISTER (o digest) permitiria tentar senhas fora do ar. RedactSecrets (o unico ponto, chamado
// pelo DiagLog do executavel) esconde o valor dos cabecalhos Authorization e Proxy-Authorization e deixa o resto.
#include <string>

#include "LogRedaction.h"
#include "test_support.h"

using starsonic::RedactSecrets;

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
