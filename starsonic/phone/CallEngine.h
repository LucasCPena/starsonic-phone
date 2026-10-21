#pragma once
// O motor de ligações como o CallController o vê: os pedidos de ligação do SipEngine, numa interface
// que os testes trocam por um motor falso (tests/phone/fake_call_engine.h), sem o PJSIP. O
// SipCallEngine repassa cada pedido ao SipEngine de verdade, sem lógica nenhuma (CallEngine.cpp, que
// só entra onde o SipEngine.cpp e o pjproject também entram).
#include <string>

#include "SipEngine.h"

namespace starsonic {

// Os contratos de cada método são os do SipEngine (SipEngine.h): os ids, os retornos e as threads.
class CallEngine {
public:
    virtual ~CallEngine() {}

    // O id da ligação (os eventos dela trazem o mesmo), ou -1: não ligou.
    virtual int MakeCall(const std::string& number) = 0;
    virtual bool Answer(int callId) = 0;
    virtual bool Reject(int callId) = 0;
    virtual bool Hangup(int callId) = 0;
    virtual bool Activate(int callId) = 0;
    virtual bool Join(int callId, int otherId) = 0;
    virtual bool Split(int callId, int otherId) = 0;
    virtual bool SetHold(int callId, bool hold) = 0;
    virtual void SetMute(bool muted) = 0;
    virtual bool SendDtmf(int callId, const std::string& digits) = 0;
    virtual bool Transfer(int callId, const std::string& number) = 0;
    virtual bool TransferAttended(int callId, int targetCallId) = 0;
    virtual int CallCount() const = 0;
};

// O SipEngine como CallEngine: cada método chama o do mesmo nome. O SipEngine precisa durar mais que
// este adaptador.
class SipCallEngine : public CallEngine {
public:
    explicit SipCallEngine(SipEngine& engine) : engine_(engine) {}

    int MakeCall(const std::string& number) override;
    bool Answer(int callId) override;
    bool Reject(int callId) override;
    bool Hangup(int callId) override;
    bool Activate(int callId) override;
    bool Join(int callId, int otherId) override;
    bool Split(int callId, int otherId) override;
    bool SetHold(int callId, bool hold) override;
    void SetMute(bool muted) override;
    bool SendDtmf(int callId, const std::string& digits) override;
    bool Transfer(int callId, const std::string& number) override;
    bool TransferAttended(int callId, int targetCallId) override;
    int CallCount() const override;

private:
    SipEngine& engine_;
};

}  // namespace starsonic
