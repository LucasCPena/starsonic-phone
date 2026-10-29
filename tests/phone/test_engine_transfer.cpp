#include "call_fixture.h"

#include <chrono>
#include <string>
#include <thread>
#include <vector>

#include "Profile.h"
#include "SipEngine.h"

using namespace starsonic;
using phone_test::Contains;
using phone_test::History;
using phone_test::kWaitSeconds;
using phone_test::Lines;
using phone_test::Phone;
using phone_test::RecordingListener;
using phone_test::Transfers;

TEST_CASE("outgoing call is held, resumed, sends DTMF and is transferred") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());

    const int id = phone.Dial("2002");
    REQUIRE(phone.engine->SetHold(id, true));
    CHECK(phone.registrar.WaitForLog("reinv-in 2002 sendonly", kWaitSeconds));
    REQUIRE(phone.engine->SetHold(id, false));
    CHECK(phone.registrar.WaitForLog("reinv-in 2002 sendrecv", kWaitSeconds));
    CHECK(phone.engine->HasCall());
    // Só os pedidos que o teste fez: nenhum re-INVITE a mais.
    CHECK(phone.registrar.Log() == Lines{"inv-in 2002 200", "reinv-in 2002 sendonly", "reinv-in 2002 sendrecv"});

    CHECK(phone.engine->SendDtmf(id, "12"));

    REQUIRE(phone.engine->Transfer(id, "2003"));
    CHECK(phone.registrar.WaitForLog("refer-in 2002 2003", kWaitSeconds));
    CHECK(phone.WaitState(id, CallState::Disconnected));   // o NOTIFY 200 encerra a ligação
    CHECK(phone.registrar.WaitForLog("bye-in 2002", kWaitSeconds));
    CHECK(phone.registrar.Log() == Lines{"inv-in 2002 200", "reinv-in 2002 sendonly", "reinv-in 2002 sendrecv",
                                         "refer-in 2002 2003", "bye-in 2002"});
    CHECK_FALSE(phone.engine->HasCall());
}

TEST_CASE("attended transfer sends REFER with Replaces and ends both calls") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());

    int client = 0, colleague = 0;
    phone.Consultation(&client, &colleague);

    // O REFER vai na ligação do cliente e aponta para a do colega (o Replaces traz o diálogo dela).
    REQUIRE(phone.engine->TransferAttended(client, colleague));
    CHECK(phone.registrar.WaitForLog("refer-in 2002 2003 replaces=known", kWaitSeconds));
    CHECK(phone.WaitTransfer(client));
    // O NOTIFY 200 encerra as duas: o aviso primeiro, depois o fim de cada uma.
    CHECK(phone.WaitState(client, CallState::Disconnected));
    CHECK(phone.WaitState(colleague, CallState::Disconnected));
    CHECK(phone.registrar.WaitForLog("bye-in 2002", kWaitSeconds));
    CHECK(phone.registrar.WaitForLog("bye-in 2003", kWaitSeconds));
    CHECK(phone.engine->CallCount() == 0);
    CHECK(Transfers(phone.listener.Calls(), client) == std::vector<int>{200});
    CHECK(Transfers(phone.listener.Calls(), colleague).empty());
    CHECK(Contains(History(phone.listener.Calls(), client), "Transfer/200 Disconnected/"));
}

TEST_CASE("attended transfer refused by the server keeps both calls") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());

    REQUIRE(phone.registrar.Control("REFER_REPLY 603") == Lines{"OK"});
    int client = 0, colleague = 0;
    phone.Consultation(&client, &colleague);

    REQUIRE(phone.engine->TransferAttended(client, colleague));
    CHECK(phone.registrar.WaitForLog("refer-in 2002 2003 replaces=known", kWaitSeconds));
    REQUIRE(phone.WaitTransfer(client));
    // Só o aviso, um: as duas seguem como estavam, o colega com o som e o cliente em espera.
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(Transfers(phone.listener.Calls(), client) == std::vector<int>{603});
    CHECK_FALSE(RecordingListener::StateReached(client, CallState::Disconnected)(phone.listener.Calls()));
    CHECK_FALSE(RecordingListener::StateReached(colleague, CallState::Disconnected)(phone.listener.Calls()));
    CHECK(phone.engine->CallCount() == 2);
    CHECK(phone.engine->AudioLinks(colleague) == std::vector<int>{0});
    CHECK(phone.engine->AudioLinks(client).empty());
    CHECK(phone.LogCount("bye-in 2002") == 0);
    CHECK(phone.LogCount("bye-in 2003") == 0);
}

TEST_CASE("attended transfer that fails in the NOTIFY keeps both calls") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());

    REQUIRE(phone.registrar.Control("REFER_NOTIFY 486") == Lines{"OK"});
    int client = 0, colleague = 0;
    phone.Consultation(&client, &colleague);

    // O REFER é aceito (202) e o NOTIFY diz que a transferência não deu certo.
    REQUIRE(phone.engine->TransferAttended(client, colleague));
    CHECK(phone.registrar.WaitForLog("refer-in 2002 2003 replaces=known", kWaitSeconds));
    REQUIRE(phone.WaitTransfer(client));
    // Só o aviso, um: as duas seguem como estavam.
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(Transfers(phone.listener.Calls(), client) == std::vector<int>{486});
    CHECK_FALSE(RecordingListener::StateReached(client, CallState::Disconnected)(phone.listener.Calls()));
    CHECK_FALSE(RecordingListener::StateReached(colleague, CallState::Disconnected)(phone.listener.Calls()));
    CHECK(phone.engine->CallCount() == 2);
    CHECK(phone.engine->AudioLinks(colleague) == std::vector<int>{0});
}

TEST_CASE("direct transfer reports its result") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());

    // Aceita: o aviso com o código do NOTIFY e o fim da ligação. O REFER vai sem Replaces.
    const int id = phone.Dial("2002");
    REQUIRE(phone.engine->Transfer(id, "2003"));
    CHECK(phone.registrar.WaitForLog("refer-in 2002 2003", kWaitSeconds));
    CHECK(phone.WaitTransfer(id));
    CHECK(phone.WaitState(id, CallState::Disconnected));
    CHECK(phone.registrar.WaitForLog("bye-in 2002", kWaitSeconds));
    CHECK(Transfers(phone.listener.Calls(), id) == std::vector<int>{200});
    CHECK(Contains(History(phone.listener.Calls(), id), "Transfer/200 Disconnected/"));

    // Recusada pelo servidor: o aviso com o código da resposta ao REFER, e a ligação continua.
    REQUIRE(phone.registrar.Control("REFER_REPLY 603") == Lines{"OK"});
    const int other = phone.Dial("2002");
    REQUIRE(phone.WaitLinks(other, {0}));
    REQUIRE(phone.engine->Transfer(other, "2003"));
    CHECK(phone.WaitForLogCount("refer-in 2002 2003", 2));
    REQUIRE(phone.WaitTransfer(other));
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(Transfers(phone.listener.Calls(), other) == std::vector<int>{603});
    CHECK_FALSE(RecordingListener::StateReached(other, CallState::Disconnected)(phone.listener.Calls()));
    CHECK(phone.engine->CallCount() == 1);
    CHECK(phone.engine->AudioLinks(other) == std::vector<int>{0});
    CHECK(phone.LogCount("bye-in 2002") == 1);   // só o da primeira
}

TEST_CASE("TransferAttended with one call is refused") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());

    CHECK_FALSE(phone.engine->TransferAttended(1, 2));   // nenhuma ligação

    // Uma ligação confirmada: ela mesma ou um id que não existe não servem de alvo.
    const int id = phone.Answered();
    CHECK_FALSE(phone.engine->TransferAttended(id, id));
    CHECK_FALSE(phone.engine->TransferAttended(id, id + 100));
    CHECK_FALSE(phone.engine->TransferAttended(id + 100, id));

    // A segunda ligação ainda toca (não confirmada): também não.
    const int ringing = phone.Ring();
    CHECK_FALSE(phone.engine->TransferAttended(id, ringing));
    CHECK_FALSE(phone.engine->TransferAttended(ringing, id));

    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    for (const std::string& line : phone.registrar.Log()) CHECK_FALSE(Contains(line, "refer-in"));
    CHECK(Transfers(phone.listener.Calls(), id).empty());
    CHECK(phone.engine->CallCount() == 2);
}

TEST_CASE("SendDtmf uses the DTMF method of the profile") {
    DtmfMethod method = DtmfMethod::Rfc2833;
    std::string expected = "using RFC2833 method";
    SUBCASE("rfc2833") { method = DtmfMethod::Rfc2833; }
    SUBCASE("auto goes by RFC 2833") { method = DtmfMethod::Auto; }
    SUBCASE("inband goes by RFC 2833") { method = DtmfMethod::Inband; }
    SUBCASE("info goes by SIP INFO") {
        method = DtmfMethod::SipInfo;
        expected = "using SIP INFO method";
    }

    Phone phone(Transport::Udp, [method](Profile& profile) { profile.global.dtmf = method; });
    INFO(phone.listener.LogTail());

    const int id = phone.Dial("2002");
    CHECK(phone.engine->SendDtmf(id, "1"));
    // O pjsua escreve o método que usou; no INFO, o corpo da mensagem que saiu.
    CHECK(Contains(phone.listener.LogTail(), expected));
    if (method == DtmfMethod::SipInfo) {
        CHECK(Contains(phone.listener.LogTail(), "Signal=1"));
    }
}
