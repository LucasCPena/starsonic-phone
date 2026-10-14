#pragma once
// Um servidor STUN falso em 127.0.0.1 (UDP), para provar que o motor usa o STUN do perfil sem sair da
// máquina. Responde a todo Binding Request dizendo que o endereço de fora é 203.0.113.9:40000 (faixa
// de documentação, RFC 5737): se o motor anuncia esse endereço, ele falou com este servidor. Só POSIX.
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>

#include <atomic>
#include <cstdint>
#include <cstring>
#include <stdexcept>
#include <thread>

namespace phone_test {

class FakeStunServer {
public:
    // O endereço que o servidor diz ao cliente, como o pjsua o escreve no log.
    static const char* MappedAddress() { return "203.0.113.9:40000"; }

    FakeStunServer() {
        fd_ = socket(AF_INET, SOCK_DGRAM, 0);
        if (fd_ < 0) throw std::runtime_error("socket UDP falhou");
        sockaddr_in address;
        std::memset(&address, 0, sizeof(address));
        address.sin_family = AF_INET;
        address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        address.sin_port = 0;   // o sistema escolhe
        timeval timeout;
        timeout.tv_sec = 0;
        timeout.tv_usec = 100 * 1000;   // o recvfrom acorda para o destrutor poder parar a thread
        socklen_t length = sizeof(address);
        if (bind(fd_, reinterpret_cast<sockaddr*>(&address), sizeof(address)) != 0 ||
            getsockname(fd_, reinterpret_cast<sockaddr*>(&address), &length) != 0 ||
            setsockopt(fd_, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout)) != 0) {
            close(fd_);
            throw std::runtime_error("nao foi possivel abrir o servidor STUN falso");
        }
        port_ = ntohs(address.sin_port);
        thread_ = std::thread([this] { Serve(); });
    }

    ~FakeStunServer() {
        stop_ = true;
        thread_.join();
        close(fd_);
    }

    FakeStunServer(const FakeStunServer&) = delete;
    FakeStunServer& operator=(const FakeStunServer&) = delete;

    int port() const { return port_; }
    // Quantos Binding Requests chegaram (o pjsua manda um para testar o servidor e outro pelo socket SIP).
    int Requests() const { return requests_; }

private:
    static const std::uint32_t kCookie = 0x2112A442;   // RFC 5389
    static const std::uint16_t kMappedPort = 40000;
    static const std::uint32_t kMappedIp = (203u << 24) | (0u << 16) | (113u << 8) | 9u;

    static void Put16(unsigned char* at, std::uint16_t value) {
        at[0] = static_cast<unsigned char>(value >> 8);
        at[1] = static_cast<unsigned char>(value);
    }

    static void Put32(unsigned char* at, std::uint32_t value) {
        Put16(at, static_cast<std::uint16_t>(value >> 16));
        Put16(at + 2, static_cast<std::uint16_t>(value));
    }

    void Serve() {
        while (!stop_) {
            unsigned char request[512];
            sockaddr_in from;
            socklen_t fromLength = sizeof(from);
            const ssize_t length =
                recvfrom(fd_, request, sizeof(request), 0, reinterpret_cast<sockaddr*>(&from), &fromLength);
            if (length < 20 || request[0] != 0x00 || request[1] != 0x01) continue;   // timeout ou outra coisa
            ++requests_;

            // Binding Success Response com um XOR-MAPPED-ADDRESS. Bytes 4 a 19 (cookie e id da transação)
            // voltam como vieram: o cliente reconhece a resposta por eles.
            unsigned char reply[32];
            std::memset(reply, 0, sizeof(reply));
            Put16(reply, 0x0101);
            Put16(reply + 2, 12);   // um atributo: 4 de cabeçalho e 8 de valor
            std::memcpy(reply + 4, request + 4, 16);
            Put16(reply + 20, 0x0020);   // XOR-MAPPED-ADDRESS
            Put16(reply + 22, 8);
            reply[25] = 0x01;   // IPv4
            Put16(reply + 26, static_cast<std::uint16_t>(kMappedPort ^ (kCookie >> 16)));
            Put32(reply + 28, kMappedIp ^ kCookie);
            sendto(fd_, reply, sizeof(reply), 0, reinterpret_cast<sockaddr*>(&from), fromLength);
        }
    }

    int fd_ = -1;
    int port_ = 0;
    std::atomic<bool> stop_{false};
    std::atomic<int> requests_{0};
    std::thread thread_;
};

}  // namespace phone_test
