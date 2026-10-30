#pragma once
// O que os testes do motor com o baresip (tests/phone/test_engine_baresip.cpp) leem do estado dele, além do contrato
// (o áudio aberto de cada ligação, o mudo): métodos estáticos, que entram com os testes que os usam. É amiga do
// SipEngine (o friend em SipEngine.h), e só o motor com o baresip a define; o do PJSIP nunca.
#include <vector>

#include "SipEngine.h"

namespace starsonic {

struct SipEngineTestAccess {
    // Os ids das ligações com o áudio aberto (o audio_started do baresip), em ordem crescente.
    static std::vector<int> CallsWithAudio(const SipEngine& engine);
    // Quantas fontes de som (os microfones) estão abertas agora, somando as ligações: as do dispositivo nulo do
    // nullAudio dos testes. O baresip abre de novo a fonte de uma ligação só de envio (a em espera) ao aplicar cada SDP
    // dela, e o audio_started dela continua false: só esta conta mostra esse microfone.
    static int OpenMicrophones(const SipEngine& engine);
};

}  // namespace starsonic
