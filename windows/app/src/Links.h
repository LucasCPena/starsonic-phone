#pragma once
// Os links tel:, sip: e callto: (spec da W1, 7.4): o instalador registra o StarsonicPhone.exe para eles, e o
// Windows abre "StarsonicPhone.exe <link>". O numero vai para o Teclado (DesktopApp::DialLink), pronto para Ligar;
// o app nunca liga sozinho por um link.
//
// C++ portatil (sem o windows.h): so le o texto.
#include <optional>
#include <string>

namespace starsonic {

// O numero de um argumento da linha de comando que e um link tel:, sip: ou callto: (o esquema sem diferenciar
// maiusculas; os %XX do navegador decodificados), pronto para o Teclado: so os digitos, o "+" do comeco, "*" e "#"
// (espacos, hifens, pontos, parenteses e barras saem; ";parametros" e "?campos" tambem). No sip:, so o usuario
// (antes do "@"). Exemplos: "tel:+55 11 5060-3000" -> "+551150603000", "sip:2003@starcloud1-starsonic.com.br" ->
// "2003", "callto:2003" -> "2003". Qualquer outro argumento (outro esquema, sem numero, letras no numero): nada.
std::optional<std::string> ParseLinkArgument(const std::wstring& argument);

}  // namespace starsonic
