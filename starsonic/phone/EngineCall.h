#pragma once
// As ligações do motor (internas). EngineCall é a ligação do pjsua2, que recebe os callbacks do
// PJSIP; CallTable guarda as ligações (até duas, uma delas a ativa) e faz o que a API pede a elas.
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

// Só a ligação ativa fica ligada ao dispositivo de som; a outra fica em espera (re-INVITE sendonly)
// ou, se ainda não foi atendida, sem som.
class CallTable {
public:
    CallTable(EventQueue* events, DtmfMethod dtmf);

    CallTable(const CallTable&) = delete;
    CallTable& operator=(const CallTable&) = delete;

    // Do PJSIP. Incoming vem de EngineAccount::onIncomingCall; accepting = false recusa com 480.
    void Incoming(pj::Account& account, int pjsuaId, bool accepting);
    void StateChanged(EngineCall* call, CallState state, int sipCode);
    // A mídia da ligação mudou: o dispositivo de som fica com ela só se ela é a ativa.
    void MediaChanged(EngineCall* call);
    // O fim da ligação: o último evento dela e o fim do objeto (delete).
    void Ended(EngineCall* call, int sipCode);
    // O resultado de uma transferência pedida em call: o aviso e, com 2xx, o fim dela (e o do colega,
    // na consulta). Pode apagar call: quem chama não mexe nele depois.
    void Transferred(EngineCall* call, int sipCode);

    // Da API: thread registrada no PJLIB, um pedido por vez (o motor serializa). uri é a URI SIP inteira.
    int Make(pj::Account& account, const std::string& uri);
    bool Answer(int callId);
    bool Reject(int callId);
    bool Hangup(int callId);
    bool Activate(int callId);
    bool SetHold(int callId, bool hold);
    bool SendDtmf(int callId, const std::string& digits);
    bool Transfer(int callId, const std::string& uri);
    bool TransferAttended(int callId, int targetCallId);
    std::vector<int> AudioLinks(int callId);
    int CallCount();

    // Desliga as ligações e espera até timeoutMs que os objetos delas sumam. false: não sumiram.
    bool End(int timeoutMs);
    // Daqui em diante nenhuma ligação nova (o motor está saindo): MakeCall dá -1 e as que chegam, 480.
    void Close();

private:
    // Uma vaga da tabela; livre com callId 0.
    struct Slot {
        EngineCall* call = nullptr;
        int callId = 0;                   // o id para o listener
        int pjsuaId = PJSUA_INVALID_ID;   // o id no pjsua (numa ligação feita, só depois do makeCall)
        bool held = false;                // posta em espera por aqui
        bool confirmed = false;           // já chegou ao Confirmed
        int transferTarget = 0;           // o colega (callId) da transferência com consulta em andamento
    };

    // Com mutex_ preso. A vaga de callId (ou de call), ou nullptr.
    Slot* Find(int callId);
    Slot* Find(const EngineCall* call);
    // Com mutex_ preso. Uma vaga livre, ou nullptr; a outra vaga, se está ocupada, ou nullptr.
    Slot* FreeSlot();
    Slot* Other(const Slot* slot);
    // O id no pjsua da ligação callId, se ela está na tabela; senão PJSUA_INVALID_ID.
    int PjsuaId(int callId);
    // callId vira a ativa: a outra, confirmada e fora da espera, vai para a espera, e o dispositivo de
    // som fica só com callId.
    void Focus(int callId);
    // Põe em espera (re-INVITE sendonly) ou retoma (sendrecv), esperando a renegociação anterior.
    bool Renegotiate(int callId, bool hold);
    // Com mutex_ preso: o evento sai na hora ou, durante o makeCall de Make, espera em held_.
    void Emit(int callId, EventQueue::Event event);

    struct HeldEvent {
        int callId;
        EventQueue::Event event;
    };

    EventQueue* events_;
    const DtmfMethod dtmf_;
    std::mutex mutex_;
    std::condition_variable gone_;
    Slot slots_[2];
    int activeId_ = 0;                // a ligação ativa (0: nenhuma)
    int alive_ = 0;                   // objetos EngineCall que ainda não se apagaram
    int nextId_ = 1;
    bool dialing_ = false;            // Make está dentro do makeCall: os eventos esperam em held_
    std::vector<HeldEvent> held_;
    bool closed_ = false;
};

}  // namespace starsonic
