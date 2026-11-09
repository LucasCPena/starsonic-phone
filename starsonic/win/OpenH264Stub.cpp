// Win32 puro (sem MFC): compilado sem o cabecalho pre-compilado do MicroSIP (starsonic.targets).
// O app antigo (o MicroSIP, edicao Lite: sem video) com a PJSIP do video (build/config_site.h): o openh264.cpp da PJSIP
// chama quatro funcoes do OpenH264 e pede o openh264.lib por #pragma comment, que o starsonic.targets manda o link
// ignorar. O app antigo nunca carrega o modulo da Cisco: como o adaptador do app novo sem o modulo
// (windows/app/src/OpenH264Shim.cpp), as duas Create devolvem 1 e deixam o ponteiro nulo (a PJSIP desiste do H.264), e
// as duas Destroy nao fazem nada.
#include <wels/codec_api.h>

extern "C" {

int WelsCreateSVCEncoder(ISVCEncoder** ppEncoder) {
    if (ppEncoder) *ppEncoder = nullptr;
    return 1;
}

void WelsDestroySVCEncoder(ISVCEncoder*) {}

long WelsCreateDecoder(ISVCDecoder** ppDecoder) {
    if (ppDecoder) *ppDecoder = nullptr;
    return 1;
}

void WelsDestroyDecoder(ISVCDecoder*) {}

}  // extern "C"
