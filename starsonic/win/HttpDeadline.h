#pragma once
// O prazo total do HttpGetPinned (Http.cpp): o fim, contado do inicio do pedido, e o tempo de cada espera do WinHTTP.
// Os instantes sao ms de um relogio que so anda para a frente (o GetTickCount64 no Windows). Portatil, C++14 e sem o
// windows.h: testado no Linux (tests/desktop/test_http_deadline.cpp).
#include <cstdint>

namespace starsonic {

// O teto de cada etapa antes da resposta: o nome, a conexao e o envio do pedido.
const uint32_t kHttpPhaseMs = 15000;

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

    // O tempo de cada uma das tres etapas antes da resposta (o nome, a conexao e o envio, uma depois da outra dentro do
    // WinHttpSendRequest): ate 15 s, e as tres juntas cabem no que falta (cada uma, no maximo um terco dele); pelo
    // menos 1 ms. Com 60 s pela frente, 15 s cada.
    uint32_t PhaseMs(uint64_t nowMs) const {
        const uint32_t third = WaitMs(nowMs) / 3;
        if (third < 1) return 1;
        return third < kHttpPhaseMs ? third : kHttpPhaseMs;
    }

private:
    uint64_t endMs_;
};

}  // namespace starsonic
