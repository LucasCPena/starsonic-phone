#pragma once
// O adaptador do H.264 da Cisco (spec da videochamada, 6.3). O openh264.cpp da PJSIP chama quatro funcoes da API do
// OpenH264: WelsCreateSVCEncoder, WelsDestroySVCEncoder, WelsCreateDecoder e WelsDestroyDecoder. O OpenH264Shim.cpp as
// define, com as assinaturas e o extern "C" do codec_api.h 2.6.0 (starsonic/third_party/openh264), e repassa cada
// chamada ao modulo da Cisco, que so e carregado em tempo de execucao (LoadOpenH264). Assim o .exe nao depende do modulo
// para abrir: o link ignora o openh264.lib que a PJSIP pede por #pragma comment (/NODEFAULTLIB, windows/app/
// CMakeLists.txt). Sem o modulo carregado, as duas Create devolvem 1 e deixam o ponteiro nulo (a PJSIP desiste do
// codec), e as duas Destroy nao fazem nada.
#include <string>

namespace starsonic {

// Carrega o modulo da Cisco pelo caminho completo (LoadLibraryExW; as dependencias dele so da pasta dele e do System32)
// e pega as quatro funcoes com o GetProcAddress. O adaptador nao confere a impressao do arquivo: quem chama confere
// antes. Com o modulo ja carregado, devolve true sem carregar de novo. false: o Windows nao abriu o modulo, ou falta
// uma das quatro funcoes nele; o motivo vai em *error (se nao for nullptr), e nada fica carregado. O modulo carregado
// fica ate o fim do processo (os codificadores que a PJSIP abriu sao dele). Pode ser chamado de qualquer thread.
bool LoadOpenH264(const std::wstring& dllPath, std::string* error);

// Um LoadOpenH264 deu certo: as quatro funcoes vao ao modulo.
bool OpenH264Loaded();

}  // namespace starsonic
