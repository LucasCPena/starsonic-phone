#pragma once
// Apoio aos testes do motor: o registrador SIP falso (tests/smoke/fake_registrar.py) como processo
// filho, com a porta de controle, e um EngineListener que guarda os eventos. Só POSIX: estes testes
// rodam no Linux.
#include <arpa/inet.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <signal.h>
#include <spawn.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <cstdlib>
#include <deque>
#include <fstream>
#include <functional>
#include <iterator>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

#include "SipEngine.h"

extern char** environ;

namespace phone_test {

// Uma porta livre em 127.0.0.1 para TCP e UDP ao mesmo tempo (o registrador usa as duas).
inline int FreePort() {
    for (int attempt = 0; attempt < 100; ++attempt) {
        sockaddr_in address;
        address.sin_family = AF_INET;
        address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        address.sin_port = 0;
        const int tcp = socket(AF_INET, SOCK_STREAM, 0);
        if (tcp < 0 || bind(tcp, reinterpret_cast<sockaddr*>(&address), sizeof(address)) != 0) {
            if (tcp >= 0) close(tcp);
            continue;
        }
        socklen_t length = sizeof(address);
        getsockname(tcp, reinterpret_cast<sockaddr*>(&address), &length);
        const int udp = socket(AF_INET, SOCK_DGRAM, 0);
        const bool udpFree = udp >= 0 && bind(udp, reinterpret_cast<sockaddr*>(&address), sizeof(address)) == 0;
        const int port = ntohs(address.sin_port);
        if (udp >= 0) close(udp);
        close(tcp);
        if (udpFree) return port;
    }
    throw std::runtime_error("sem porta livre em 127.0.0.1");
}

// Um socket TCP ligado a 127.0.0.1:port, ou -1.
inline int ConnectTcp(int port) {
    const int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return -1;
    sockaddr_in address;
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    address.sin_port = htons(static_cast<unsigned short>(port));
    if (connect(fd, reinterpret_cast<sockaddr*>(&address), sizeof(address)) != 0) {
        close(fd);
        return -1;
    }
    return fd;
}

inline std::string ReadText(const std::string& path) {
    std::ifstream file(path.c_str(), std::ios::binary);
    return std::string(std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>());
}

// Sem o fim de linha que o registrador grava nos arquivos de --log e --transport-log.
inline std::string ReadLine(const std::string& path) {
    std::string text = ReadText(path);
    while (!text.empty() && (text.back() == '\n' || text.back() == '\r')) text.pop_back();
    return text;
}

// tests/smoke/fake_registrar.py numa porta livre, com os ramais 2001 e 2002 (mesma senha) e a porta
// de controle (RING, HANGUP, LOG...) em outra porta livre. O construtor só volta quando o registrador
// avisa que está pronto (a porta de controle é a última a abrir). O destrutor mata o processo e apaga
// os arquivos.
class FakeRegistrar {
public:
    explicit FakeRegistrar(const std::string& password) : port_(FreePort()), controlPort_(FreePort()) {
        while (controlPort_ == port_) controlPort_ = FreePort();
        const char* base = std::getenv("TMPDIR");
        std::string pattern = std::string(base && *base ? base : "/tmp") + "/starsonic-phone-XXXXXX";
        std::vector<char> buffer(pattern.begin(), pattern.end());
        buffer.push_back('\0');
        if (!mkdtemp(buffer.data())) throw std::runtime_error("mkdtemp falhou");
        dir_ = buffer.data();

        const std::string script = std::string(STARSONIC_REPO_DIR) + "/tests/smoke/fake_registrar.py";
        const std::string port = std::to_string(port_);
        const std::string control = std::to_string(controlPort_);
        const std::string args[] = {"python3", script, "--host", "127.0.0.1", "--port", port,
                                    "--user", "2001,2002", "--password", password,
                                    "--log", UserAgentPath(), "--transport-log", TransportPath(),
                                    "--control-port", control};
        std::vector<char*> argv;
        for (const std::string& arg : args) argv.push_back(const_cast<char*>(arg.c_str()));
        argv.push_back(nullptr);

        // A saída do registrador vai para um arquivo: o teste não polui o terminal.
        posix_spawn_file_actions_t actions;
        posix_spawn_file_actions_init(&actions);
        posix_spawn_file_actions_addopen(&actions, 1, OutputPath().c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0600);
        posix_spawn_file_actions_adddup2(&actions, 1, 2);
        const int status = posix_spawnp(&pid_, "python3", &actions, nullptr, argv.data(), environ);
        posix_spawn_file_actions_destroy(&actions);
        if (status != 0) {
            Cleanup();
            throw std::runtime_error("nao foi possivel iniciar o python3");
        }
        if (!WaitUntilReady(10)) {
            const std::string output = ReadText(OutputPath());
            Stop();
            Cleanup();
            throw std::runtime_error("o registrador falso nao subiu: " + output);
        }
    }

    ~FakeRegistrar() {
        Stop();
        Cleanup();
    }

    FakeRegistrar(const FakeRegistrar&) = delete;
    FakeRegistrar& operator=(const FakeRegistrar&) = delete;

    int port() const { return port_; }
    // Último User-Agent de um REGISTER (--log) e protocolo do último REGISTER aceito (--transport-log).
    std::string UserAgent() const { return ReadLine(UserAgentPath()); }
    std::string TransportUsed() const { return ReadLine(TransportPath()); }

    // Um comando na porta de controle e as linhas da resposta (a de LOG sem o END); vazio se a porta
    // não respondeu em 5 s.
    std::vector<std::string> Control(const std::string& command) const {
        std::vector<std::string> lines;
        const int fd = ConnectTcp(controlPort_);
        if (fd < 0) return lines;
        timeval timeout;
        timeout.tv_sec = 5;
        timeout.tv_usec = 0;
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
        const std::string request = command + "\n";
        // LOG responde várias linhas e END; os outros comandos, uma linha.
        const bool isLog = command == "LOG";
        bool done = send(fd, request.data(), request.size(), MSG_NOSIGNAL) != static_cast<ssize_t>(request.size());
        std::string received;
        char chunk[4096];
        while (!done) {
            const ssize_t got = recv(fd, chunk, sizeof(chunk), 0);
            if (got <= 0) break;   // fechou ou o tempo acabou
            received.append(chunk, static_cast<size_t>(got));
            size_t end;
            while (!done && (end = received.find('\n')) != std::string::npos) {
                lines.push_back(received.substr(0, end));
                received.erase(0, end + 1);
                done = !isLog || lines.back() == "END";
            }
        }
        close(fd);
        if (isLog && !lines.empty() && lines.back() == "END") lines.pop_back();
        return lines;
    }

    // O registro de ligações (inv-out, ack-sent, bye-in...).
    std::vector<std::string> Log() const { return Control("LOG"); }

    bool LogHas(const std::string& line) const {
        const std::vector<std::string> log = Log();
        return std::find(log.begin(), log.end(), line) != log.end();
    }

    // Espera até `seconds` pela linha no registro de ligações.
    bool WaitForLog(const std::string& line, int seconds) const {
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(seconds);
        while (!LogHas(line)) {
            if (std::chrono::steady_clock::now() >= deadline) return false;
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
        }
        return true;
    }

    // O registro de ligações numa linha só, para as mensagens dos testes.
    std::string LogText() const {
        std::string text;
        for (const std::string& line : Log()) text += line + "; ";
        return text;
    }

private:
    std::string UserAgentPath() const { return dir_ + "/ua.txt"; }
    std::string TransportPath() const { return dir_ + "/transport.txt"; }
    std::string OutputPath() const { return dir_ + "/registrar.log"; }

    // A linha de pronto só sai depois que UDP, TCP e a porta de controle estão abertos.
    bool WaitUntilReady(int seconds) {
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(seconds);
        while (std::chrono::steady_clock::now() < deadline) {
            int status = 0;
            if (waitpid(pid_, &status, WNOHANG) == pid_) {
                pid_ = 0;   // morreu antes de escutar
                return false;
            }
            if (ReadText(OutputPath()).find("controle em") != std::string::npos) return true;
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
        }
        return false;
    }

    void Stop() {
        if (pid_ > 0) {
            kill(pid_, SIGTERM);
            int status = 0;
            waitpid(pid_, &status, 0);
            pid_ = 0;
        }
    }

    void Cleanup() {
        if (dir_.empty()) return;
        std::remove(UserAgentPath().c_str());
        std::remove(TransportPath().c_str());
        std::remove(OutputPath().c_str());
        rmdir(dir_.c_str());
    }

    int port_;
    int controlPort_;
    std::string dir_;
    pid_t pid_ = 0;
};

struct RegistrationEvent {
    int code;
    bool active;
};

inline const char* StateName(starsonic::CallState state) {
    static const char* const kNames[] = {"Incoming", "Calling", "Early", "Connecting", "Confirmed", "Disconnected"};
    return kNames[static_cast<int>(state)];
}

// OnIncomingCall, OnRejectedBusy ou OnCallState, como chegou.
struct CallEvent {
    enum Kind { Incoming, Busy, State };
    Kind kind;
    int callId;                     // Incoming e State
    std::string user, name;         // Incoming e Busy
    starsonic::CallState state;     // State
    int code;                       // State
};

// Guarda os eventos do motor (chegam na thread de eventos do motor; OnLog, em qualquer thread) e
// deixa o teste esperar por uma condição.
class RecordingListener : public starsonic::EngineListener {
public:
    using CallCondition = std::function<bool(const std::vector<CallEvent>&)>;

    void OnRegistration(int sipCode, bool active) override {
        std::lock_guard<std::mutex> lock(mutex_);
        registrations_.push_back({sipCode, active});
        changed_.notify_all();
    }
    void OnIncomingCall(int callId, const std::string& user, const std::string& name) override {
        std::function<void(int)> hook;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            calls_.push_back({CallEvent::Incoming, callId, user, name, starsonic::CallState::Incoming, 0});
            hook = incomingHook_;
            changed_.notify_all();
        }
        if (hook) hook(callId);
    }
    void OnRejectedBusy(const std::string& user, const std::string& name) override {
        std::lock_guard<std::mutex> lock(mutex_);
        calls_.push_back({CallEvent::Busy, 0, user, name, starsonic::CallState::Incoming, 0});
        changed_.notify_all();
    }
    void OnCallState(int callId, starsonic::CallState state, int sipCode) override {
        std::lock_guard<std::mutex> lock(mutex_);
        calls_.push_back({CallEvent::State, callId, "", "", state, sipCode});
        changed_.notify_all();
    }
    void OnLog(int, const std::string& line) override {
        std::lock_guard<std::mutex> lock(mutex_);
        log_.push_back(line);
        if (log_.size() > kMaxLogLines) log_.pop_front();
    }

    // Chamado de dentro de OnIncomingCall, depois de guardar o evento (sem a trava do listener).
    void SetIncomingHook(std::function<void(int)> hook) {
        std::lock_guard<std::mutex> lock(mutex_);
        incomingHook_ = std::move(hook);
    }

    std::vector<RegistrationEvent> Registrations() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return registrations_;
    }

    std::vector<CallEvent> Calls() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return calls_;
    }

    // Quantos eventos (registros e ligações; o log não conta) chegaram até agora.
    size_t EventCount() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return registrations_.size() + calls_.size();
    }

    // Espera até `seconds` por uma lista de registros que satisfaça `condition`.
    bool WaitFor(const std::function<bool(const std::vector<RegistrationEvent>&)>& condition, int seconds) {
        std::unique_lock<std::mutex> lock(mutex_);
        return changed_.wait_for(lock, std::chrono::seconds(seconds), [&] { return condition(registrations_); });
    }

    // Espera até `seconds` por uma lista de eventos de ligação que satisfaça `condition`.
    bool WaitForCalls(const CallCondition& condition, int seconds) {
        std::unique_lock<std::mutex> lock(mutex_);
        return changed_.wait_for(lock, std::chrono::seconds(seconds), [&] { return condition(calls_); });
    }

    // Já chegou OnCallState(callId, state, ...).
    static CallCondition StateReached(int callId, starsonic::CallState state) {
        return [=](const std::vector<CallEvent>& events) {
            return std::any_of(events.begin(), events.end(), [&](const CallEvent& event) {
                return event.kind == CallEvent::State && event.callId == callId && event.state == state;
            });
        };
    }

    // Já chegaram `times` eventos do tipo `kind`.
    static CallCondition Count(CallEvent::Kind kind, size_t times) {
        return [=](const std::vector<CallEvent>& events) {
            return static_cast<size_t>(std::count_if(events.begin(), events.end(), [&](const CallEvent& event) {
                       return event.kind == kind;
                   })) >= times;
        };
    }

    // Os eventos de ligação numa linha só, para as mensagens dos testes.
    std::string CallsText() const {
        std::string text;
        for (const CallEvent& event : Calls()) {
            if (event.kind == CallEvent::Incoming) {
                text += "incoming(" + std::to_string(event.callId) + "," + event.user + "," + event.name + "); ";
            } else if (event.kind == CallEvent::Busy) {
                text += "busy(" + event.user + "," + event.name + "); ";
            } else {
                text += "state(" + std::to_string(event.callId) + "," + StateName(event.state) + "," +
                        std::to_string(event.code) + "); ";
            }
        }
        return text;
    }

    // Quantos registros (code, active) já chegaram.
    static std::function<bool(const std::vector<RegistrationEvent>&)> Reached(int code, bool active, size_t times) {
        return [=](const std::vector<RegistrationEvent>& events) {
            size_t seen = 0;
            for (const RegistrationEvent& event : events) {
                if (event.code == code && event.active == active) ++seen;
            }
            return seen >= times;
        };
    }

    // As últimas linhas de log do motor, para aparecer na mensagem quando um teste falha.
    std::string LogTail() const {
        std::lock_guard<std::mutex> lock(mutex_);
        std::string text;
        for (const std::string& line : log_) text += line + "\n";
        return text;
    }

private:
    static const size_t kMaxLogLines = 150;

    mutable std::mutex mutex_;
    std::condition_variable changed_;
    std::vector<RegistrationEvent> registrations_;
    std::vector<CallEvent> calls_;
    std::function<void(int)> incomingHook_;
    std::deque<std::string> log_;
};

}  // namespace phone_test
