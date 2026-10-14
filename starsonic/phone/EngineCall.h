#pragma once
// As ligações do motor (internas). EngineCall é a ligação do pjsua2, que recebe os callbacks do
// PJSIP; CallTable guarda a ligação de agora (uma por vez) e faz o que a API pede a ela.
//
// Vida de um EngineCall: a tabela cria o objeto (MakeCall ou ligação que chega) e ele se apaga no
// próprio último callback, o do fim da ligação, quando o pjsua2 já o desligou da ligação do PJSIP
// (nenhum callback chega a ele depois). Fora dos callbacks dele ninguém usa o objeto: a API fala com o
// PJSIP pelo id da ligação no pjsua. Apagar o objeto mais tarde seria pior: o destrutor do pj::Call
// mexe na vaga da ligação no pjsua, que a essa altura pode ser de outra ligação.
#include <pjsua2.hpp>

#include <condition_variable>
#include <mutex>
#include <string>
#include <vector>

#include "EngineEvents.h"
#include "Profile.h"
#include "SipEngine.h"

namespace starsonic {

class CallTable;

// Os callbacks chegam numa thread do PJSIP, ou na que chamou o PJSIP, sempre com a trava do diálogo
// da ligação.
class EngineCall : public pj::Call {
public:
    EngineCall(pj::Account& account, int pjsuaId, CallTable* table);

    void onCallState(pj::OnCallStateParam& param) override;
    void onCallMediaState(pj::OnCallMediaStateParam& param) override;
    void onCallTransferStatus(pj::OnCallTransferStatusParam& param) override;
    void onCallTransferRequest(pj::OnCallTransferRequestParam& param) override;
    void onCallReplaceRequest(pj::OnCallReplaceRequestParam& param) override;

private:
    CallTable* table_;
};

class CallTable {
public:
    CallTable(EventQueue* events, DtmfMethod dtmf);

    CallTable(const CallTable&) = delete;
    CallTable& operator=(const CallTable&) = delete;

    // Do PJSIP. Incoming vem de EngineAccount::onIncomingCall; accepting = false recusa com 480.
    void Incoming(pj::Account& account, int pjsuaId, bool accepting);
    void StateChanged(EngineCall* call, CallState state, int sipCode);
    // O fim da ligação: o último evento dela e o fim do objeto (delete).
    void Ended(EngineCall* call, int sipCode);

    // Da API: thread registrada no PJLIB, um pedido por vez (o motor serializa). uri é a URI SIP inteira.
    int Make(pj::Account& account, const std::string& uri);
    bool Answer(int callId);
    bool Reject(int callId);
    bool Hangup(int callId);
    bool SetHold(int callId, bool hold);
    bool SendDtmf(int callId, const std::string& digits);
    bool Transfer(int callId, const std::string& uri);
    bool HasCall();

    // Desliga a ligação de agora e espera até timeoutMs que o objeto dela suma. false: não sumiu.
    bool End(int timeoutMs);
    // Daqui em diante nenhuma ligação nova (o motor está saindo): MakeCall dá -1 e as que chegam, 480.
    void Close();

private:
    // O id no pjsua da ligação callId, se ela é a de agora; senão PJSUA_INVALID_ID.
    int PjsuaId(int callId);
    // Com mutex_ preso: o evento sai na hora ou, durante o makeCall de Make, espera em held_.
    void Emit(EventQueue::Event event);

    EventQueue* events_;
    const DtmfMethod dtmf_;
    std::mutex mutex_;
    std::condition_variable gone_;
    EngineCall* call_ = nullptr;      // a ligação de agora
    int callId_ = 0;                  // o id dela para o listener (0: nenhuma)
    int pjsuaId_ = PJSUA_INVALID_ID;  // o id dela no pjsua
    int alive_ = 0;                   // objetos EngineCall que ainda não se apagaram
    int nextId_ = 1;
    bool dialing_ = false;            // Make está dentro do makeCall: os eventos esperam em held_
    std::vector<EventQueue::Event> held_;
    bool closed_ = false;
};

}  // namespace starsonic
