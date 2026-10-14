#pragma once
// O Endpoint do pjsua2 do motor (interno), com o aviso de quando a troca de rede termina.
#include <pjsua2.hpp>

#include <chrono>
#include <condition_variable>
#include <mutex>

namespace starsonic {

class EngineEndpoint : public pj::Endpoint {
public:
    // Chamar antes de handleIpChange: o fim da troca anterior não vale para a próxima.
    void ExpectIpChange() {
        std::lock_guard<std::mutex> lock(mutex_);
        ipChangeDone_ = false;
    }

    // true: o pjsua refez os transportes e acabou de tratar as contas (ou nem havia conta).
    bool WaitIpChange(int timeoutMs) {
        std::unique_lock<std::mutex> lock(mutex_);
        return changed_.wait_for(lock, std::chrono::milliseconds(timeoutMs), [this] { return ipChangeDone_; });
    }

    // Chamado numa thread do PJSIP (ou na de handleIpChange), com a trava do pjsua; nada aqui pode
    // chamar o motor.
    void onIpChangeProgress(pj::OnIpChangeProgressParam& param) override {
        if (param.op != PJSUA_IP_CHANGE_OP_COMPLETED) return;
        try {
            std::lock_guard<std::mutex> lock(mutex_);
            ipChangeDone_ = true;
            changed_.notify_all();
        } catch (...) {   // o PJSIP é C: nenhuma exceção volta para ele
        }
    }

private:
    std::mutex mutex_;
    std::condition_variable changed_;
    bool ipChangeDone_ = false;
};

}  // namespace starsonic
