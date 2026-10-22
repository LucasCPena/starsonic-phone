#include "EngineEvents.h"

#include <algorithm>
#include <cctype>
#include <utility>

namespace starsonic {

namespace {

std::string Lower(std::string text) {
    std::transform(text.begin(), text.end(), text.begin(),
                   [](char c) { return static_cast<char>(std::tolower(static_cast<unsigned char>(c))); });
    return text;
}

}  // namespace

void BlfDialogs::Apply(bool full, const std::vector<std::pair<std::string, std::string>>& dialogs) {
    if (full) states_.clear();
    for (const std::pair<std::string, std::string>& dialog : dialogs) {
        const std::string state = Lower(dialog.second);
        if (state == "terminated") {
            states_.erase(dialog.first);
        } else {
            states_[dialog.first] = state;
        }
    }
}

BlfState BlfDialogs::State() const {
    bool busy = false;
    for (const auto& dialog : states_) {
        if (dialog.second == "early" || dialog.second == "proceeding" || dialog.second == "trying") {
            return BlfState::Ringing;
        }
        if (dialog.second == "confirmed") busy = true;
    }
    return busy ? BlfState::Busy : BlfState::Free;
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
