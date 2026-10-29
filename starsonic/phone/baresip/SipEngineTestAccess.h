#pragma once
// O que os testes do motor com o baresip (tests/phone/test_engine_baresip.cpp) leem do estado dele, além do contrato
// (o áudio aberto de cada ligação, o mudo): métodos estáticos, que entram com os testes que os usam. É amiga do
// SipEngine (o friend em SipEngine.h), e só o motor com o baresip a define; o do PJSIP nunca.
#include "SipEngine.h"

namespace starsonic {

struct SipEngineTestAccess {};

}  // namespace starsonic
