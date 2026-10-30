#pragma once
// O que os testes do motor com o baresip (tests/phone/test_engine_baresip.cpp) leem do estado dele, além do contrato
// (o áudio aberto de cada ligação, o mudo, a mistura da conferência), e o que eles simulam da rede (o re-INVITE que não
// sai, a lista de endereços que ficou da rede de antes): métodos estáticos, que entram com os testes que os usam. É
// amiga do SipEngine (o friend em SipEngine.h), e só o motor com o baresip a define; o do PJSIP nunca.
#include <vector>

#include "SipEngine.h"

namespace starsonic {

struct SipEngineTestAccess {
    // Os ids das ligações com o áudio aberto (o audio_started do baresip), em ordem crescente.
    static std::vector<int> CallsWithAudio(const SipEngine& engine);
    // Quantas fontes de som (os microfones) estão abertas agora, somando as ligações: as do dispositivo nulo do
    // nullAudio dos testes. O baresip abre de novo a fonte de uma ligação só de envio (a em espera) ao aplicar cada SDP
    // dela, e o audio_started dela continua false: só esta conta mostra esse microfone. Não espera um pedido em
    // andamento: lê também enquanto outro, como o Activate, espera uma renegociação.
    static int OpenMicrophones(const SipEngine& engine);
    // Com on, nenhum re-INVITE com oferta sai da ligação callId (0: de todas), como num erro de transporte na hora (a
    // rede fora no meio de uma troca de Wi-Fi para 4G): a espera e a retomada dela falham sem mandar nada, até o off.
    static void FailReinvites(SipEngine& engine, bool on, int callId = 0);
    // Os ids das ligações com o microfone mudo (o audio_ismuted do baresip), em ordem crescente.
    static std::vector<int> MutedCalls(const SipEngine& engine);
    // Os ids das ligações na mistura da conferência (o audio_is_conference do baresip, que o mixminus lê), em ordem
    // crescente. O AudioLinks sai do estado do motor; só esta leitura mostra o que o baresip mistura.
    static std::vector<int> ConferenceCalls(const SipEngine& engine);
    // Esvazia a lista dos endereços locais do baresip (o net_flush_addresses), de onde o uag_reset_transp abre os
    // transportes SIP: como a lista que ficou da rede de antes depois de uma troca de rede de verdade (o Wi-Fi para o
    // 4G), sem nenhum endereço de agora. Os transportes abertos não mudam; só o HandleIpChange seguinte os refaz.
    static void FlushLocalAddresses(SipEngine& engine);
};

}  // namespace starsonic
