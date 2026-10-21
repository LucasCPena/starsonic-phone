#include "CallEngine.h"

namespace starsonic {

int SipCallEngine::MakeCall(const std::string& number) { return engine_.MakeCall(number); }

bool SipCallEngine::Answer(int callId) { return engine_.Answer(callId); }

bool SipCallEngine::Reject(int callId) { return engine_.Reject(callId); }

bool SipCallEngine::Hangup(int callId) { return engine_.Hangup(callId); }

bool SipCallEngine::Activate(int callId) { return engine_.Activate(callId); }

bool SipCallEngine::Join(int callId, int otherId) { return engine_.Join(callId, otherId); }

bool SipCallEngine::Split(int callId, int otherId) { return engine_.Split(callId, otherId); }

bool SipCallEngine::SetHold(int callId, bool hold) { return engine_.SetHold(callId, hold); }

void SipCallEngine::SetMute(bool muted) { engine_.SetMute(muted); }

bool SipCallEngine::SendDtmf(int callId, const std::string& digits) { return engine_.SendDtmf(callId, digits); }

bool SipCallEngine::Transfer(int callId, const std::string& number) { return engine_.Transfer(callId, number); }

bool SipCallEngine::TransferAttended(int callId, int targetCallId) {
    return engine_.TransferAttended(callId, targetCallId);
}

int SipCallEngine::CallCount() const { return engine_.CallCount(); }

}  // namespace starsonic
