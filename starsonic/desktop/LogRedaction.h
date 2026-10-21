#pragma once
// O diagnostico.log sem segredos (spec da W1, 6.6): a pessoa manda o arquivo ao suporte ("Enviar diagnostico"), e o
// motor escreve as mensagens SIP inteiras no nivel 4. O digest do Authorization do REGISTER (e do INVITE) permitiria
// tentar senhas fora do ar, entao o valor dos cabecalhos Authorization e Proxy-Authorization sai.
//
// C++ portatil. O executavel do Windows chama RedactSecrets no DiagLog, o unico lugar por onde passam as linhas do
// app e do motor.
#include <string>

namespace starsonic {

// O texto (UTF-8, uma ou varias linhas, \r\n ou \n) com o valor de cada cabecalho Authorization: e
// Proxy-Authorization: (sem diferenciar maiusculas; o nome no comeco da linha ou depois de um espaco) trocado por
// "<oculto>", e as linhas de continuacao dele (comecando com espaco ou tab) tiradas. O resto fica igual.
// Exemplo: "Authorization: Digest username=\"2001\", response=\"...\"" -> "Authorization: <oculto>".
std::string RedactSecrets(const std::string& text);

}  // namespace starsonic
