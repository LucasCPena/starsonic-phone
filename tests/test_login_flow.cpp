#include "test_support.h"
#include "LoginFlow.h"
#include "RegistrationErrors.h"

using namespace starsonic;

namespace {
void CheckIgnored(const LoginOutcome& outcome) {
    CHECK_FALSE(outcome.commit);
    CHECK_FALSE(outcome.rollback);
    CHECK(outcome.message == L"");
}
}  // namespace

TEST_CASE("flow starts idle and Start makes it pending") {
    LoginFlow flow;
    CHECK(flow.State() == LoginState::Idle);
    flow.Start();
    CHECK(flow.State() == LoginState::Pending);
}

TEST_CASE("Start during pending keeps pending") {
    LoginFlow flow;
    flow.Start();
    flow.Start();
    CHECK(flow.State() == LoginState::Pending);
}

TEST_CASE("200 commits and finishes") {
    LoginFlow flow;
    flow.Start();
    const LoginOutcome outcome = flow.OnRegistration(200, false);
    CHECK(outcome.commit);
    CHECK_FALSE(outcome.rollback);
    CHECK(outcome.message == L"");
    CHECK(flow.State() == LoginState::Done);
}

TEST_CASE("403 rolls back with the password message") {
    LoginFlow flow;
    flow.Start();
    const LoginOutcome outcome = flow.OnRegistration(403, false);
    CHECK_FALSE(outcome.commit);
    CHECK(outcome.rollback);
    CHECK(outcome.message == L"Ramal ou senha incorretos.");
    CHECK(flow.State() == LoginState::Idle);
}

TEST_CASE("TLS failure rolls back even with a success code") {
    LoginFlow flow;
    flow.Start();
    const LoginOutcome outcome = flow.OnRegistration(200, true);
    CHECK_FALSE(outcome.commit);
    CHECK(outcome.rollback);
    CHECK(outcome.message == RegistrationMessage(0, true));
    CHECK(flow.State() == LoginState::Idle);
}

TEST_CASE("provisional codes keep waiting") {
    LoginFlow flow;
    flow.Start();
    CheckIgnored(flow.OnRegistration(100, false));
    CheckIgnored(flow.OnRegistration(180, false));
    CHECK(flow.State() == LoginState::Pending);
}

TEST_CASE("timeout rolls back with the server message") {
    LoginFlow flow;
    flow.Start();
    const LoginOutcome outcome = flow.OnTimeout();
    CHECK_FALSE(outcome.commit);
    CHECK(outcome.rollback);
    CHECK(outcome.message == L"N\u00e3o foi poss\u00edvel falar com o servidor. Verifique sua internet.");
    CHECK(flow.State() == LoginState::Idle);
}

TEST_CASE("late result after timeout is ignored") {
    LoginFlow flow;
    flow.Start();
    flow.OnTimeout();
    CheckIgnored(flow.OnRegistration(200, false));
    CHECK(flow.State() == LoginState::Idle);
}

TEST_CASE("result after commit is ignored") {
    LoginFlow flow;
    flow.Start();
    flow.OnRegistration(200, false);
    CheckIgnored(flow.OnRegistration(403, false));
    CheckIgnored(flow.OnTimeout());
    CHECK(flow.State() == LoginState::Done);
}

TEST_CASE("events while idle are ignored") {
    LoginFlow flow;
    CheckIgnored(flow.OnRegistration(200, false));
    CheckIgnored(flow.OnTimeout());
    CHECK(flow.State() == LoginState::Idle);
}

TEST_CASE("a new attempt can start after a failure") {
    LoginFlow flow;
    flow.Start();
    flow.OnRegistration(401, false);
    flow.Start();
    CHECK(flow.State() == LoginState::Pending);
    CHECK(flow.OnRegistration(200, false).commit);
}
