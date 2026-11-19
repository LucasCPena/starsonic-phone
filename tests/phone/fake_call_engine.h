#pragma once
// Os falsos do controlador de ligações (tests/phone/test_call_controller.cpp e, Ruling 2 da W1, os
// testes do app de PC): o motor, o ouvinte, o relógio com o agendador e os contatos, sem o PJSIP.
#include <algorithm>
#include <cstdint>
#include <functional>
#include <map>
#include <optional>
#include <ostream>
#include <string>
#include <utility>
#include <vector>

#include "CallController.h"
#include "CallEngine.h"

namespace phone_test {

// O motor falso: anota os pedidos. MakeCall devolve nextCallId (e o próximo sobe), ou -1 com refuse;
// duringMakeCall roda dentro dele, antes de ele voltar (um evento do motor que chega antes). RoomAdd faz o
// mesmo, com refuseRoom e duringRoomAdd (o OnRoom que traz o convidado pode chegar antes de ele voltar). CallCount
// devolve callCount, que o teste ajusta. Com refuseTransfers, Transfer e TransferAttended anotam o pedido e
// devolvem false (o motor recusou na hora: nenhum OnTransfer vem). order guarda, na ordem, os pedidos que
// mexem no som das duas: "join 10 1", "split 1 10", "hold 1 true" e "activate 1".
class FakeCallEngine : public starsonic::CallEngine {
public:
    std::vector<std::string> order;
    std::vector<std::string> made;
    std::vector<bool> madeVideo;                 // o video pedido em cada MakeCall (a mesma ordem de made)
    std::vector<std::string> roomAdds;           // os números de cada RoomAdd
    std::vector<int> answers;
    std::vector<bool> answersVideo;              // o video pedido em cada Answer (a mesma ordem de answers)
    std::vector<std::pair<int, bool>> cameras;   // os SetCamera
    std::vector<int> rejects;
    std::vector<int> hangups;
    std::vector<std::pair<int, bool>> holds;
    std::vector<int> activated;
    std::vector<bool> mutes;
    std::vector<std::pair<int, std::string>> dtmfs;
    std::vector<std::pair<int, std::string>> transfers;
    std::vector<std::pair<int, int>> attended;   // (o cliente, o colega)
    std::vector<std::pair<int, int>> joined;
    std::vector<std::pair<int, int>> split;
    int callCount = 0;
    int nextCallId = 10;
    bool refuse = false;
    bool refuseRoom = false;
    bool refuseTransfers = false;
    std::function<void(int)> duringMakeCall;
    std::function<void(int)> duringRoomAdd;

    int MakeCall(const std::string& number, bool video) override {
        made.push_back(number);
        madeVideo.push_back(video);
        if (refuse) return -1;
        const int id = nextCallId++;
        if (duringMakeCall) duringMakeCall(id);
        return id;
    }
    int RoomAdd(const std::string& number) override {
        roomAdds.push_back(number);
        if (refuseRoom) return -1;
        const int id = nextCallId++;
        if (duringRoomAdd) duringRoomAdd(id);
        return id;
    }
    bool Answer(int callId, bool video) override {
        answers.push_back(callId);
        answersVideo.push_back(video);
        return true;
    }
    bool SetCamera(int callId, bool on) override {
        cameras.emplace_back(callId, on);
        return true;
    }
    bool Reject(int callId) override {
        rejects.push_back(callId);
        return true;
    }
    bool Hangup(int callId) override {
        hangups.push_back(callId);
        return true;
    }
    bool Activate(int callId) override {
        activated.push_back(callId);
        order.push_back("activate " + std::to_string(callId));
        return true;
    }
    bool Join(int callId, int otherId) override {
        joined.emplace_back(callId, otherId);
        order.push_back("join " + std::to_string(callId) + " " + std::to_string(otherId));
        return true;
    }
    bool Split(int callId, int otherId) override {
        split.emplace_back(callId, otherId);
        order.push_back("split " + std::to_string(callId) + " " + std::to_string(otherId));
        return true;
    }
    bool SetHold(int callId, bool hold) override {
        holds.emplace_back(callId, hold);
        order.push_back("hold " + std::to_string(callId) + (hold ? " true" : " false"));
        return true;
    }
    void SetMute(bool muted) override { mutes.push_back(muted); }
    bool SendDtmf(int callId, const std::string& digits) override {
        dtmfs.emplace_back(callId, digits);
        return true;
    }
    bool Transfer(int callId, const std::string& number) override {
        transfers.emplace_back(callId, number);
        return !refuseTransfers;
    }
    bool TransferAttended(int callId, int targetCallId) override {
        attended.emplace_back(callId, targetCallId);
        return !refuseTransfers;
    }
    int CallCount() const override { return callCount; }
};

// O ouvinte falso: guarda tudo o que o controlador publicou, na ordem.
class FakeCallListener : public starsonic::CallControllerListener {
public:
    std::vector<starsonic::CallSnapshot> snapshots;
    std::vector<starsonic::Recent> recents;
    std::vector<std::string> missed;
    std::vector<starsonic::RingKind> rings;
    int videoRefused = 0;   // quantas vezes o OnVideoRefused foi chamado
    std::vector<std::pair<starsonic::RoomEvent, int>> roomEvents;   // os avisos da sala, com o value, na ordem
    // Roda dentro de cada aviso, depois de guardá-lo, com o nome dele ("OnSnapshot", "OnRecent",
    // "OnMissed", "OnRing", "OnVideoRefused" ou "OnRoomEvent"): um ouvinte que olha ou chama o controlador de volta.
    std::function<void(const std::string& what)> during;

    void OnSnapshot(const starsonic::CallSnapshot& snapshot) override {
        snapshots.push_back(snapshot);
        if (during) during("OnSnapshot");
    }
    void OnRecent(const starsonic::Recent& recent) override {
        recents.push_back(recent);
        if (during) during("OnRecent");
    }
    void OnMissed(const std::string& text) override {
        missed.push_back(text);
        if (during) during("OnMissed");
    }
    void OnRing(starsonic::RingKind kind) override {
        rings.push_back(kind);
        if (during) during("OnRing");
    }
    void OnVideoRefused() override {
        ++videoRefused;
        if (during) during("OnVideoRefused");
    }
    void OnRoomEvent(starsonic::RoomEvent event, int value) override {
        roomEvents.emplace_back(event, value);
        if (during) during("OnRoomEvent");
    }

    // O último estado publicado (nenhum: o de antes da primeira ligação, vazio).
    starsonic::CallSnapshot State() const {
        return snapshots.empty() ? starsonic::CallSnapshot() : snapshots.back();
    }
    // O último toque pedido (nenhum: parado).
    starsonic::RingKind Ring() const { return rings.empty() ? starsonic::RingKind::Stop : rings.back(); }
};

// O relógio e o agendador falsos: o tempo só anda com Advance, que roda na hora as tarefas vencidas
// (a mais cedo primeiro; no mesmo instante, a agendada antes). Com lateCancel, o Cancel não tira nada: a
// tarefa que já tinha saído da fila de um Scheduler de verdade e roda depois do Cancel.
class FakeTime : public starsonic::Clock, public starsonic::Scheduler {
public:
    explicit FakeTime(int64_t now = 1000000) : now_(now) {}

    bool lateCancel = false;

    int64_t NowMs() override { return now_; }

    int Schedule(int64_t delayMs, std::function<void()> task) override {
        const int id = ++lastId_;
        tasks_.push_back(Task{id, now_ + delayMs, std::move(task)});
        return id;
    }

    void Cancel(int id) override {
        if (lateCancel) return;
        tasks_.erase(std::remove_if(tasks_.begin(), tasks_.end(), [id](const Task& t) { return t.id == id; }),
                     tasks_.end());
    }

    void Advance(int64_t ms) {
        now_ += ms;
        for (;;) {
            auto due = tasks_.end();
            for (auto it = tasks_.begin(); it != tasks_.end(); ++it) {
                if (it->at <= now_ && (due == tasks_.end() || it->at < due->at)) due = it;
            }
            if (due == tasks_.end()) return;
            std::function<void()> task = std::move(due->task);
            tasks_.erase(due);
            task();
        }
    }

    size_t Pending() const { return tasks_.size(); }

private:
    struct Task {
        int id;
        int64_t at;
        std::function<void()> task;
    };
    int64_t now_;
    int lastId_ = 0;
    std::vector<Task> tasks_;
};

// Os contatos falsos: o nome de cada número em names; lookups guarda os números procurados.
class FakeContactNames : public starsonic::ContactNames {
public:
    std::map<std::string, std::string> names;
    std::vector<std::string> lookups;

    std::optional<std::string> NameFor(const std::string& number) override {
        lookups.push_back(number);
        auto it = names.find(number);
        if (it == names.end()) return std::nullopt;
        return it->second;
    }
};

}  // namespace phone_test

// Para as mensagens do doctest quando uma comparação falha.
namespace starsonic {

inline std::ostream& operator<<(std::ostream& out, const CallView& view) {
    static const char* const kPhases[] = {"Ringing", "Dialing", "Active"};
    return out << "{id " << view.id << ", " << view.number << ", '" << view.name << "', "
               << (view.incoming ? "incoming" : "outgoing") << ", " << kPhases[view.phase] << ", since "
               << view.activeSinceMs << (view.held ? ", held" : "") << "}";
}

inline std::ostream& operator<<(std::ostream& out, const std::optional<CallView>& view) {
    if (!view) return out << "none";
    return out << *view;
}

inline std::ostream& operator<<(std::ostream& out, const RoomMemberView& member) {
    static const char* const kStates[] = {"Calling", "In", "Held"};
    return out << "{guest " << member.id << ", " << member.number << ", '" << member.name << "', "
               << kStates[static_cast<int>(member.state)] << (member.image ? ", image" : "") << ", tile "
               << member.tile.x << " " << member.tile.y << " " << member.tile.width << " " << member.tile.height
               << "}";
}

inline std::ostream& operator<<(std::ostream& out, const RoomView& room) {
    out << "{room " << room.id << (room.out ? ", out" : "") << (room.full ? ", full" : "");
    for (const RoomMemberView& member : room.members) out << ", " << member;
    return out << "}";
}

inline std::ostream& operator<<(std::ostream& out, const std::optional<RoomView>& room) {
    if (!room) return out << "none";
    return out << *room;
}

inline std::ostream& operator<<(std::ostream& out, const CallSnapshot& s) {
    static const char* const kKinds[] = {"None", "Ringing", "Held"};
    out << "{top " << s.top << ", second " << s.second << " (" << kKinds[s.secondKind] << ")"
        << (s.muted ? ", muted" : "");
    if (s.conference) out << ", conference since " << s.conferenceSinceMs;
    if (s.consulting) out << ", consulting" << (s.colleagueActive ? " (colleague active)" : " (client active)");
    if (s.room) out << ", " << *s.room;
    return out << ", message '" << s.endMessage << "'}";
}

inline std::ostream& operator<<(std::ostream& out, const Recent& r) {
    static const char* const kKinds[] = {"Outgoing", "Incoming", "Missed"};
    return out << "{" << r.number << ", '" << r.name << "', " << kKinds[r.kind] << ", " << r.startMs << ", "
               << r.durationMs << " ms}";
}

inline std::ostream& operator<<(std::ostream& out, RingKind kind) {
    switch (kind) {
        case RingKind::Full:
            return out << "Full";
        case RingKind::Waiting:
            return out << "Waiting";
        case RingKind::Stop:
            break;
    }
    return out << "Stop";
}

inline std::ostream& operator<<(std::ostream& out, RoomEvent event) {
    static const char* const kEvents[] = {"Started", "Entered", "Left", "Failed", "Out", "Back", "Ended"};
    return out << kEvents[static_cast<int>(event)];
}

}  // namespace starsonic
