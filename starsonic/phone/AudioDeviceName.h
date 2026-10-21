#pragma once
// O nome de um dispositivo de som do PJSIP em UTF-8 (interno do motor).
#include <string>

namespace starsonic {

// No Windows o pjproject 2.17 escreve AudioDevInfo::name na página de código ANSI do sistema, não em
// UTF-8: wmme_dev.c (pjmedia-audiodev) preenche info.name com pj_unicode_to_ansi, que o pjlib
// (unicode_win32.c) implementa com WideCharToMultiByte(CP_ACP, ...). No Windows em português (1252),
// "Áudio" chega como o byte 0xC1, UTF-8 inválido. Aqui o nome vai de CP_ACP para UTF-16 e daí para
// UTF-8. Nas outras plataformas o PJSIP já devolve UTF-8 e os bytes ficam como estão. O caminho do
// Windows só é compilado e exercitado pelo CI do Windows; os testes do Linux cobrem o ramo portátil.
std::string DeviceNameToUtf8(const std::string& pjName);

}  // namespace starsonic
