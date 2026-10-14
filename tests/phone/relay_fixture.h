#pragma once
// Um retransmissor UDP em 127.0.0.1 entre o motor e o registrador falso, com o mesmo atraso nos dois
// sentidos: deixa um REGISTER em andamento por um tempo conhecido, sem corrida. Só POSIX.
#include <arpa/inet.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <atomic>
#include <chrono>
#include <cstring>
#include <deque>
#include <stdexcept>
#include <string>
#include <thread>

namespace phone_test {

class DelayedUdpRelay {
public:
    // targetPort: a porta UDP do registrador em 127.0.0.1. Cada pacote sai delayMs depois de chegar.
    DelayedUdpRelay(int targetPort, int delayMs) : delay_(std::chrono::milliseconds(delayMs)) {
        std::memset(&target_, 0, sizeof(target_));
        target_.sin_family = AF_INET;
        target_.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        target_.sin_port = htons(static_cast<unsigned short>(targetPort));
        std::memset(&client_, 0, sizeof(client_));

        fd_ = socket(AF_INET, SOCK_DGRAM, 0);
        if (fd_ < 0) throw std::runtime_error("socket UDP falhou");
        sockaddr_in address;
        std::memset(&address, 0, sizeof(address));
        address.sin_family = AF_INET;
        address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        address.sin_port = 0;   // o sistema escolhe
        socklen_t length = sizeof(address);
        if (bind(fd_, reinterpret_cast<sockaddr*>(&address), sizeof(address)) != 0 ||
            getsockname(fd_, reinterpret_cast<sockaddr*>(&address), &length) != 0) {
            close(fd_);
            throw std::runtime_error("nao foi possivel abrir o retransmissor UDP");
        }
        port_ = ntohs(address.sin_port);
        thread_ = std::thread([this] { Run(); });
    }

    ~DelayedUdpRelay() {
        stop_ = true;
        thread_.join();
        close(fd_);
    }

    DelayedUdpRelay(const DelayedUdpRelay&) = delete;
    DelayedUdpRelay& operator=(const DelayedUdpRelay&) = delete;

    int port() const { return port_; }

private:
    struct Packet {
        std::chrono::steady_clock::time_point due;
        std::string data;
        sockaddr_in to;
    };

    static bool SameAddress(const sockaddr_in& a, const sockaddr_in& b) {
        return a.sin_addr.s_addr == b.sin_addr.s_addr && a.sin_port == b.sin_port;
    }

    // Uma thread só: guarda o que chega (do registrador vai para o motor; do motor, para o
    // registrador) e manda cada pacote na hora dele. O atraso é o mesmo, então a fila já está em ordem.
    void Run() {
        while (!stop_) {
            const auto now = std::chrono::steady_clock::now();
            while (!queue_.empty() && queue_.front().due <= now) {
                const Packet& packet = queue_.front();
                sendto(fd_, packet.data.data(), packet.data.size(), 0,
                       reinterpret_cast<const sockaddr*>(&packet.to), sizeof(packet.to));
                queue_.pop_front();
            }
            pollfd input;
            input.fd = fd_;
            input.events = POLLIN;
            input.revents = 0;
            if (poll(&input, 1, 10) <= 0 || !(input.revents & POLLIN)) continue;   // acorda para ver a fila
            char buffer[65536];
            sockaddr_in from;
            socklen_t fromLength = sizeof(from);
            const ssize_t length =
                recvfrom(fd_, buffer, sizeof(buffer), 0, reinterpret_cast<sockaddr*>(&from), &fromLength);
            if (length <= 0) continue;
            Packet packet;
            packet.due = std::chrono::steady_clock::now() + delay_;
            packet.data.assign(buffer, static_cast<size_t>(length));
            if (SameAddress(from, target_)) {
                if (!hasClient_) continue;   // resposta sem ninguém do outro lado
                packet.to = client_;
            } else {
                client_ = from;
                hasClient_ = true;
                packet.to = target_;
            }
            queue_.push_back(packet);
        }
    }

    std::chrono::milliseconds delay_;
    sockaddr_in target_;
    sockaddr_in client_;
    bool hasClient_ = false;
    std::deque<Packet> queue_;   // só a thread do retransmissor mexe
    int fd_ = -1;
    int port_ = 0;
    std::atomic<bool> stop_{false};
    std::thread thread_;
};

}  // namespace phone_test
