#pragma once
// O prazo total do HttpGetPinned (Http.cpp): o fim, contado do inicio do pedido, e o tempo de cada espera do WinHTTP.
// Os instantes sao ms de um relogio que so anda para a frente (o GetTickCount64 no Windows). Portatil, C++14 e sem o
// windows.h: testado no Linux (tests/desktop/test_http_deadline.cpp).
#include <cstdint>

namespace starsonic {

class HttpDeadline {
public:
    // totalMs <= 0: o prazo ja passou (quem chama recusa antes; um negativo nunca vira um prazo sem fim).
    HttpDeadline(uint64_t startMs, int totalMs) : endMs_(startMs + (totalMs > 0 ? static_cast<uint64_t>(totalMs) : 0)) {}

    // O prazo passou: o pedido falha com o ERROR_WINHTTP_TIMEOUT.
    bool Passed(uint64_t nowMs) const { return nowMs >= endMs_; }

    // O tempo da proxima espera (WINHTTP_OPTION_RECEIVE_TIMEOUT): o que falta, pelo menos 1 ms (no WinHTTP, 0 e sem
    // limite).
    uint32_t WaitMs(uint64_t nowMs) const {
        if (nowMs >= endMs_) return 1;
        const uint64_t left = endMs_ - nowMs;
        return left > 0x7FFFFFFFu ? 0x7FFFFFFFu : static_cast<uint32_t>(left);
    }

private:
    uint64_t endMs_;
};

}  // namespace starsonic
