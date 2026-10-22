#pragma once
// O Endpoint do pjsua2 do motor (interno), com o aviso de quando a troca de rede termina e os temporizadores
// das contas (um trabalho que não pode correr dentro de um callback do PJSIP).
#include <pjsua2.hpp>

#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <map>
#include <mutex>

#include "EngineLog.h"

namespace starsonic {

// Quem recebe um temporizador do EngineEndpoint (uma conta).
class TimerTarget {
public:
    // Numa thread do PJSIP, sem trava do pjsua presa, com a trava dos alvos do EngineEndpoint: não pode
    // chamar AddTimerTarget nem RemoveTimerTarget.
    virtual void OnEngineTimer() = 0;

protected:
    ~TimerTarget() {}
};

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

    // O alvo id passa a receber os temporizadores pedidos com ScheduleTimer(id).
    void AddTimerTarget(int id, TimerTarget* target) {
        std::lock_guard<std::mutex> lock(targetsMutex_);
        targets_[id] = target;
    }

    // Daqui em diante o alvo id não recebe mais nada; se um temporizador dele está correndo, espera o fim.
    void RemoveTimerTarget(int id) {
        std::lock_guard<std::mutex> lock(targetsMutex_);
        targets_.erase(id);
    }

    // O OnEngineTimer do alvo id corre logo, na thread do PJSIP, fora do callback de agora. Qualquer
    // thread, com ou sem a trava do pjsua; sem o alvo na hora, nada.
    void ScheduleTimer(int id) {
        try {
            utilTimerSchedule(0, reinterpret_cast<pj::Token>(static_cast<std::intptr_t>(id)));
        } catch (const pj::Error& error) {
            Log(2, "nao foi possivel agendar o temporizador da conta: " + error.info());
        }
    }

    void onTimer(const pj::OnTimerParam& param) override {
        try {
            const int id = static_cast<int>(reinterpret_cast<std::intptr_t>(param.userData));
            std::lock_guard<std::mutex> lock(targetsMutex_);
            const auto it = targets_.find(id);
            if (it != targets_.end()) it->second->OnEngineTimer();
        } catch (...) {   // o PJSIP é C: nenhuma exceção volta para ele
        }
    }

private:
    std::mutex mutex_;
    std::condition_variable changed_;
    bool ipChangeDone_ = false;
    std::mutex targetsMutex_;   // nunca presa por quem segura a trava do pjsua
    std::map<int, TimerTarget*> targets_;
};

}  // namespace starsonic
