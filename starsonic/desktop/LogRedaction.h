#pragma once
// O diagnostico.log sem segredos (spec da W1, 6.6): a pessoa manda o arquivo ao suporte ("Enviar diagnostico"), e o
// motor escreve as mensagens SIP inteiras no nivel 4. O digest do Authorization do REGISTER (e do INVITE) permitiria
// tentar senhas fora do ar, entao o valor dos cabecalhos Authorization e Proxy-Authorization sai.
//
// C++ portatil. O executavel do Windows chama RedactSecrets no DiagLog, o unico lugar por onde passam as linhas do
// app e do motor, e (0.2.0) RedactUrl no WebViewHost, nas linhas das navegacoes bloqueadas.
#include <string>

namespace starsonic {

// O texto (UTF-8, uma ou varias linhas, \r\n ou \n) com o valor de cada cabecalho Authorization: e
// Proxy-Authorization: (sem diferenciar maiusculas; o nome no comeco da linha ou depois de um espaco) trocado por
// "<oculto>", e as linhas de continuacao dele (comecando com espaco ou tab) tiradas. O resto fica igual.
// Exemplo: "Authorization: Digest username=\"2001\", response=\"...\"" -> "Authorization: <oculto>".
std::string RedactSecrets(const std::string& text);

// (0.2.0) O endereco de uma navegacao (ou de uma janela nova) que o WebViewHost bloqueou, para o diagnostico: um
// arquivo solto numa janela navega para o file:// dele, com o nome do usuario do Windows e o do arquivo. Fica so o
// esquema, em minusculas e com os dois pontos ("file:", "blob:", "data:"), e, no http, no https, no ws e no wss, o host
// ("https://exemplo.com"): nunca o caminho, a consulta, o fragmento, a porta, nem o usuario e a senha antes do "@". Um
// host com outro caractere alem de letras, digitos, ".", "-" e "_" (ou o IPv6 entre colchetes) tambem sai. Sem um
// esquema no comeco (uma letra, depois letras, digitos, "+", "-" ou ".", e os dois pontos): "(sem esquema)", nunca o
// texto.
// Exemplo: "https://user:senha@exemplo.com/a?b=1#c" -> "https://exemplo.com".
std::string RedactUrl(const std::string& url);

}  // namespace starsonic
