#pragma once
// O Endpoint do pjsua2 do motor (interno), com o aviso de quando a troca de rede termina e os temporizadores
// das contas (um trabalho que não pode correr dentro de um callback do PJSIP).
#include <pjsua2.hpp>

#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <map>
#include <mutex>
#include <set>

#include "EngineLog.h"

namespace starsonic {

// Quem recebe um temporizador do EngineEndpoint (uma conta, ou a tabela das ligações).
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

    // O OnEngineTimer do alvo id corre logo (ou depois de delayMs), na thread do PJSIP, fora do callback de agora.
    // Qualquer thread registrada no PJLIB, com ou sem a trava do pjsua; sem o alvo na hora, nada. false: o PJSIP não
    // agendou (a linha de nível 2 sai) e nada vai correr; quem marcou o temporizador como agendado desfaz a marca.
    bool ScheduleTimer(int id, unsigned delayMs = 0) {
        try {
            if (TakeScheduleFailure(id)) throw pj::Error(PJ_ENOMEM, "utilTimerSchedule()", "", __FILE__, __LINE__);
            utilTimerSchedule(delayMs, reinterpret_cast<pj::Token>(static_cast<std::intptr_t>(id)));
            return true;
        } catch (const pj::Error& error) {
            Log(2, "nao foi possivel agendar o temporizador: " + error.info());
            return false;
        }
    }

    // (Para os testes) O próximo ScheduleTimer do alvo id falha, como um utilTimerSchedule que lança: nada é agendado.
    void FailNextSchedule(int id) {
        std::lock_guard<std::mutex> lock(failuresMutex_);
        failures_.insert(id);
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
    // Uma falha pedida pelo FailNextSchedule para o alvo id: tira o pedido e diz se havia.
    bool TakeScheduleFailure(int id) {
        std::lock_guard<std::mutex> lock(failuresMutex_);
        return failures_.erase(id) != 0;
    }

    std::mutex mutex_;
    std::condition_variable changed_;
    bool ipChangeDone_ = false;
    std::mutex targetsMutex_;   // nunca presa por quem segura a trava do pjsua
    std::map<int, TimerTarget*> targets_;
    std::mutex failuresMutex_;   // a última trava: nada mais é pego com ela presa
    std::set<int> failures_;     // os alvos cujo próximo ScheduleTimer falha (FailNextSchedule)
};

}  // namespace starsonic
