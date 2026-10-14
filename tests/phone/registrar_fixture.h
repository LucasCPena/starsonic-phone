#pragma once
// Apoio aos testes do motor: o registrador SIP falso (tests/smoke/fake_registrar.py) como processo
// filho e um EngineListener que guarda os eventos. Só POSIX: estes testes rodam no Linux.
#include <arpa/inet.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <signal.h>
#include <spawn.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

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

inline bool TcpAccepts(int port) {
    const int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return false;
    sockaddr_in address;
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    address.sin_port = htons(static_cast<unsigned short>(port));
    const bool accepted = connect(fd, reinterpret_cast<sockaddr*>(&address), sizeof(address)) == 0;
    close(fd);
    return accepted;
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

// tests/smoke/fake_registrar.py numa porta livre, com os ramais 2001 e 2002 (mesma senha). O
// destrutor mata o processo e apaga os arquivos.
class FakeRegistrar {
public:
    explicit FakeRegistrar(const std::string& password) : port_(FreePort()) {
        const char* base = std::getenv("TMPDIR");
        std::string pattern = std::string(base && *base ? base : "/tmp") + "/starsonic-phone-XXXXXX";
        std::vector<char> buffer(pattern.begin(), pattern.end());
        buffer.push_back('\0');
        if (!mkdtemp(buffer.data())) throw std::runtime_error("mkdtemp falhou");
        dir_ = buffer.data();

        const std::string script = std::string(STARSONIC_REPO_DIR) + "/tests/smoke/fake_registrar.py";
        const std::string port = std::to_string(port_);
        const std::string args[] = {"python3", script, "--host", "127.0.0.1", "--port", port,
                                    "--user", "2001,2002", "--password", password,
                                    "--log", UserAgentPath(), "--transport-log", TransportPath()};
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
        if (!WaitUntilListening(10)) {
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

private:
    std::string UserAgentPath() const { return dir_ + "/ua.txt"; }
    std::string TransportPath() const { return dir_ + "/transport.txt"; }
    std::string OutputPath() const { return dir_ + "/registrar.log"; }

    bool WaitUntilListening(int seconds) {
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(seconds);
        while (std::chrono::steady_clock::now() < deadline) {
            int status = 0;
            if (waitpid(pid_, &status, WNOHANG) == pid_) {
                pid_ = 0;   // morreu antes de escutar
                return false;
            }
            if (TcpAccepts(port_)) return true;
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
    std::string dir_;
    pid_t pid_ = 0;
};

struct RegistrationEvent {
    int code;
    bool active;
};

// Guarda os eventos do motor (os callbacks chegam numa thread do PJSIP) e deixa o teste esperar por
// uma condição. As ligações só entram na Task 3: por enquanto os eventos de ligação são ignorados.
class RecordingListener : public starsonic::EngineListener {
public:
    void OnRegistration(int sipCode, bool active) override {
        std::lock_guard<std::mutex> lock(mutex_);
        registrations_.push_back({sipCode, active});
        changed_.notify_all();
    }
    void OnIncomingCall(int, const std::string&, const std::string&) override {}
    void OnRejectedBusy(const std::string&, const std::string&) override {}
    void OnCallState(int, starsonic::CallState, int) override {}
    void OnLog(int, const std::string& line) override {
        std::lock_guard<std::mutex> lock(mutex_);
        log_.push_back(line);
        if (log_.size() > kMaxLogLines) log_.pop_front();
    }

    std::vector<RegistrationEvent> Registrations() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return registrations_;
    }

    // Espera até `seconds` por uma lista de registros que satisfaça `condition`.
    bool WaitFor(const std::function<bool(const std::vector<RegistrationEvent>&)>& condition, int seconds) {
        std::unique_lock<std::mutex> lock(mutex_);
        return changed_.wait_for(lock, std::chrono::seconds(seconds), [&] { return condition(registrations_); });
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
    std::deque<std::string> log_;
};

}  // namespace phone_test
