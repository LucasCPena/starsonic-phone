#pragma once
// As reunioes no app de PC (docs/ponte-windows.md, os comandos das reunioes): as conferencias dos tres valores que a
// interface manda ao nucleo. C++ portatil: nada de Windows aqui. Nada de uma reuniao (o codigo, o passe, o id de um
// pedido, o nome, o assunto) vai ao diagnostico.
#include <string>

namespace starsonic {

// O codigo de uma reuniao: 10 caracteres de "abcdefghjkmnpqrstvwxyz23456789" (minusculas, sem i, l, o, u, 0 e 1).
bool ValidMeetingCode(const std::string& code);
// O passe: 43 caracteres de [A-Za-z0-9_-].
bool ValidMeetingPass(const std::string& pass);
// O id de um pedido para entrar: 16 caracteres hexadecimais, em minusculas.
bool ValidMeetingRequestId(const std::string& id);

// {"v":1,"type":"abrir","tela":"reuniao","codigo":"<codigo>"}: o link starsonic://reuniao/<codigo> (ja conferido),
// so para a interface da janela principal.
std::string OpenMeetingMessage(const std::string& code);

}  // namespace starsonic
