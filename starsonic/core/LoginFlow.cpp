#include "LoginFlow.h"

#include "RegistrationErrors.h"

namespace starsonic {

namespace {
const int kTimeoutCode = 408;
}  // namespace

LoginState LoginFlow::State() const {
    return state_;
}

void LoginFlow::Start() {
    if (state_ == LoginState::Idle) state_ = LoginState::Pending;
}

LoginOutcome LoginFlow::OnRegistration(int sipCode, bool tlsFailure) {
    LoginOutcome outcome;
    if (state_ != LoginState::Pending) return outcome;
    if (!tlsFailure && sipCode >= 100 && sipCode <= 199) return outcome;
    if (!tlsFailure && sipCode >= 200 && sipCode <= 299) {
        outcome.commit = true;
        state_ = LoginState::Done;
        return outcome;
    }
    outcome.rollback = true;
    outcome.message = RegistrationMessage(sipCode, tlsFailure);
    state_ = LoginState::Idle;
    return outcome;
}

LoginOutcome LoginFlow::OnTimeout() {
    LoginOutcome outcome;
    if (state_ != LoginState::Pending) return outcome;
    outcome.rollback = true;
    outcome.message = RegistrationMessage(kTimeoutCode, false);
    state_ = LoginState::Idle;
    return outcome;
}

}  // namespace starsonic
