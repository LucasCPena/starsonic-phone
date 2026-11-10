// O prazo total do HttpGetPinned (starsonic/win/HttpDeadline.h): o fim, contado do inicio do pedido, e o tempo de
// cada espera do WinHTTP (o que falta, pelo menos 1 ms). C++ portatil, sem o windows.h.
#include <climits>
#include <cstdint>

#include "../../starsonic/win/HttpDeadline.h"
#include "test_support.h"

using starsonic::HttpDeadline;

TEST_CASE("the pinned deadline passes timeoutMs after the start") {
    const HttpDeadline deadline(1000, 60000);
    CHECK_FALSE(deadline.Passed(1000));
    CHECK_FALSE(deadline.Passed(60999));
    CHECK(deadline.Passed(61000));
    CHECK(deadline.Passed(500000));
}

TEST_CASE("each wait of the pinned download lasts at most the time left and at least 1 ms") {
    const HttpDeadline deadline(1000, 60000);
    CHECK(deadline.WaitMs(1000) == 60000u);
    CHECK(deadline.WaitMs(31000) == 30000u);
    CHECK(deadline.WaitMs(60999) == 1u);
    // Passou: 1 ms, nunca 0 (no WinHTTP, 0 e sem limite); quem chama ja falhou com o ERROR_WINHTTP_TIMEOUT.
    CHECK(deadline.WaitMs(61000) == 1u);
    CHECK(deadline.WaitMs(500000) == 1u);
}

TEST_CASE("a pinned deadline of zero or less has already passed") {
    CHECK(HttpDeadline(1000, 0).Passed(1000));
    CHECK(HttpDeadline(1000, -5).Passed(1000));
    CHECK(HttpDeadline(1000, -5).WaitMs(1000) == 1u);
    // Um negativo nunca da a volta para um prazo sem fim.
    CHECK(HttpDeadline(0, -1).Passed(0));
    CHECK(HttpDeadline(1000, INT_MIN).Passed(1000));
    CHECK(HttpDeadline(1000, INT_MIN).WaitMs(1000) == 1u);
}

TEST_CASE("before the response, resolve, connect and send of the pinned download get at most 15 s each") {
    // Com os 60 s do H264Module: 15 s cada, e as tres juntas (45 s) cabem no prazo.
    const HttpDeadline deadline(1000, 60000);
    CHECK(deadline.PhaseMs(1000) == 15000u);
    CHECK(deadline.PhaseMs(11000) == 15000u);   // faltam 50 s
    CHECK(3 * deadline.PhaseMs(1000) <= deadline.WaitMs(1000));
}

TEST_CASE("the three phases before the response fit in the time left") {
    // As tres acontecem uma depois da outra dentro do WinHttpSendRequest: cada uma fica com um terco do que falta,
    // quando ele e menor que 45 s.
    const HttpDeadline deadline(1000, 60000);
    CHECK(deadline.PhaseMs(21000) == 13333u);   // faltam 40 s
    CHECK(deadline.PhaseMs(60970) == 10u);      // faltam 30 ms
    CHECK(deadline.PhaseMs(60999) == 1u);       // falta 1 ms: pelo menos 1 ms (no WinHTTP, 0 e sem limite)
    CHECK(deadline.PhaseMs(61000) == 1u);       // passou: quem chama ja falhou com o ERROR_WINHTTP_TIMEOUT
    CHECK(HttpDeadline(0, 9000).PhaseMs(0) == 3000u);
    for (uint64_t now = 1000; now < 61000; now += 997) {
        CHECK(3 * deadline.PhaseMs(now) <= deadline.WaitMs(now));
    }
}

TEST_CASE("the pinned deadline uses the 64-bit clock") {
    // O GetTickCount64 passa dos 32 bits depois de 49,7 dias ligado: a conta nao pode dar a volta ali.
    const uint64_t start = 0xFFFFFFFFull - 10;
    const HttpDeadline deadline(start, 60000);
    CHECK_FALSE(deadline.Passed(start + 59999));
    CHECK(deadline.Passed(start + 60000));
    CHECK(deadline.WaitMs(start + 20) == 59980u);
}
