#include "Threads.h"

#include <climits>
#include <utility>

namespace starsonic {

SerialExecutor::SerialExecutor() : worker_([this] { Run(); }) {}

SerialExecutor::~SerialExecutor() {
    Stop();
    // Stop chamado antes de dentro de uma tarefa nao esperou a thread: espera aqui (de outra thread).
    if (worker_.joinable() && !OnWorkerThread()) worker_.join();
}

bool SerialExecutor::Post(std::function<void()> task) {
    if (!task) return false;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (stopping_) return false;
        queue_.push_back(std::move(task));
    }
    wake_.notify_one();
    return true;
}

void SerialExecutor::Stop() {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        stopping_ = true;
    }
    wake_.notify_one();
    if (OnWorkerThread()) return;   // a thread termina sozinha depois da fila
    if (worker_.joinable()) worker_.join();
}

bool SerialExecutor::OnWorkerThread() const {
    return std::this_thread::get_id() == worker_.get_id();
}

void SerialExecutor::Run() {
    for (;;) {
        std::function<void()> task;
        {
            std::unique_lock<std::mutex> lock(mutex_);
            wake_.wait(lock, [this] { return stopping_ || !queue_.empty(); });
            // Parando, a fila ainda roda ate o fim (o que ja tinha entrado).
            if (queue_.empty()) return;
            task = std::move(queue_.front());
            queue_.pop_front();
        }
        try {
            task();
        } catch (...) {
            // A tarefa e descartada; a fila continua (quem posta anota o erro, se quiser).
        }
    }
}

int64_t SystemClock::NowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

ThreadScheduler::ThreadScheduler() : worker_([this] { Run(); }) {}

ThreadScheduler::~ThreadScheduler() {
    Stop();
    if (worker_.joinable() && std::this_thread::get_id() != worker_.get_id()) worker_.join();
}

int ThreadScheduler::Schedule(int64_t delayMs, std::function<void()> task) {
    if (delayMs < 0) delayMs = 0;
    int id;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        lastId_ = lastId_ == INT_MAX ? 1 : lastId_ + 1;
        id = lastId_;
        if (stopping_ || !task) return id;   // nunca roda
        const TimePoint at = std::chrono::steady_clock::now() + std::chrono::milliseconds(delayMs);
        tasks_.emplace(std::make_pair(at, id), std::move(task));
        due_[id] = at;
    }
    wake_.notify_one();
    return id;
}

void ThreadScheduler::Cancel(int id) {
    std::lock_guard<std::mutex> lock(mutex_);
    const auto found = due_.find(id);
    if (found == due_.end()) return;   // ja saiu da fila (rodou, esta rodando ou nunca entrou)
    tasks_.erase(std::make_pair(found->second, id));
    due_.erase(found);
}

void ThreadScheduler::Stop() {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        stopping_ = true;
        tasks_.clear();
        due_.clear();
    }
    wake_.notify_one();
    if (std::this_thread::get_id() == worker_.get_id()) return;
    if (worker_.joinable()) worker_.join();
}

size_t ThreadScheduler::Pending() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return tasks_.size();
}

void ThreadScheduler::Run() {
    std::unique_lock<std::mutex> lock(mutex_);
    for (;;) {
        if (stopping_) return;
        if (tasks_.empty()) {
            wake_.wait(lock);
            continue;
        }
        const auto first = tasks_.begin();
        const TimePoint at = first->first.first;
        if (std::chrono::steady_clock::now() < at) {
            // Acorda na hora da primeira, ou antes, se uma nova entra na frente (ou o Stop).
            wake_.wait_until(lock, at);
            continue;
        }
        std::function<void()> task = std::move(first->second);
        due_.erase(first->first.second);
        tasks_.erase(first);
        // A tarefa roda sem a trava da fila: ela pode chamar o Schedule e o Cancel, e pegar travas de quem os chama.
        lock.unlock();
        try {
            task();
        } catch (...) {
            // Descartada; as outras continuam.
        }
        task = nullptr;   // o que ela guardava sai sem a trava
        lock.lock();
    }
}

}  // namespace starsonic
