#include "EngineEvents.h"

#include <algorithm>
#include <cctype>
#include <utility>

namespace starsonic {

bool BlfFromDialogInfo(bool ended, bool notified, const std::string& dialogState, BlfState* state) {
    if (ended) {
        *state = BlfState::Unknown;
        return true;
    }
    if (!notified) return false;
    std::string name = dialogState;
    std::transform(name.begin(), name.end(), name.begin(),
                   [](char c) { return static_cast<char>(std::tolower(static_cast<unsigned char>(c))); });
    if (name.empty() || name == "terminated") {
        *state = BlfState::Free;
    } else if (name == "confirmed") {
        *state = BlfState::Busy;
    } else if (name == "early" || name == "proceeding" || name == "trying") {
        *state = BlfState::Ringing;
    } else {
        *state = BlfState::Unknown;
    }
    return true;
}

EventQueue::EventQueue(EngineListener* listener) : listener_(listener), thread_([this] { Run(); }) {}

EventQueue::~EventQueue() { Stop(); }

void EventQueue::Post(Event event) {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (stopped_) return;
        queue_.push_back(std::move(event));
    }
    wake_.notify_one();
}

void EventQueue::Stop() {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        stopped_ = true;
        queue_.clear();
    }
    wake_.notify_all();
    if (thread_.joinable()) thread_.join();
}

void EventQueue::Run() {
    std::unique_lock<std::mutex> lock(mutex_);
    for (;;) {
        wake_.wait(lock, [this] { return stopped_ || !queue_.empty(); });
        if (stopped_) return;
        Event event = std::move(queue_.front());
        queue_.pop_front();
        lock.unlock();
        try {
            event(*listener_);
        } catch (...) {   // um erro do listener não derruba a thread dos eventos
        }
        event = nullptr;   // as cópias do evento saem sem a trava
        lock.lock();
    }
}

}  // namespace starsonic
