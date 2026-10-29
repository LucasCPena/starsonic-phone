#pragma once
// A conferência dos dados de push (spec 7.3), igual para os dois motores: o que não quebra o REGISTER nem
// toma o lugar de um cabeçalho que o motor ou a libre já escrevem. Pura: sem PJSIP e sem libre.
#include <string>

#include "SipEngine.h"

namespace starsonic {

// Vazio quando os dados servem; senão, o motivo em português sem acento, numa linha de ASCII, para o log.
// O motivo nunca repete um valor (pode ser um token de push); repete só o nome, e só depois de ele passar
// na conferência.
//
// As regras:
// - nome de parâmetro e de cabeçalho: de 1 a 64 caracteres, só letras ASCII, dígitos e -.!%*_+`'~ (o token
//   da RFC 3261); o parâmetro transport (sem diferença de maiúsculas) é recusado: o motor já o escreve no TCP;
// - valor de parâmetro: até 512 caracteres, pode ser vazio (vai só ;nome), só letras ASCII, dígitos e
//   -_.!~*'()[]/:&+$, e % só seguido de dois dígitos hexadecimais (o paramchar da RFC 3261);
// - valor de cabeçalho: de 1 a 512 caracteres, só ASCII visível e espaço (nada de controle, nem CR e LF);
// - nomes de cabeçalho recusados (sem diferença de maiúsculas), porque o motor ou a libre já os escrevem: Via,
//   From, To, Call-ID, CSeq, Contact, Expires, Max-Forwards, Route, Authorization, User-Agent e Content-Length.
std::string PushDataProblem(const PushData& data);

}  // namespace starsonic
