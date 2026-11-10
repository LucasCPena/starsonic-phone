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

TEST_CASE("the pinned deadline uses the 64-bit clock") {
    // O GetTickCount64 passa dos 32 bits depois de 49,7 dias ligado: a conta nao pode dar a volta ali.
    const uint64_t start = 0xFFFFFFFFull - 10;
    const HttpDeadline deadline(start, 60000);
    CHECK_FALSE(deadline.Passed(start + 59999));
    CHECK(deadline.Passed(start + 60000));
    CHECK(deadline.WaitMs(start + 20) == 59980u);
}
