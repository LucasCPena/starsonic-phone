// A instancia unica do app novo (windows/app/src/SingleInstance.h): o mutex Local\<nome> e a entrega dos argumentos
// da segunda abertura por WM_COPYDATA. As duas "instancias" do teste ficam no mesmo processo, com um nome so do
// teste (nunca o do app, que pode estar aberto na maquina): a primeira escuta numa thread com o laco de mensagens.
// Entra no desktop_tests do job windows.
#include <windows.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "SingleInstance.h"
#include "test_support.h"

using starsonic::SingleInstance;

namespace {

std::wstring TestName(const wchar_t* what) {
    return std::wstring(L"StarsonicPhone.Teste.") + what + L"." + std::to_wstring(GetCurrentProcessId());
}

// A primeira instancia: numa thread propria, com o laco de mensagens (como a thread da janela do app).
class FirstInstance {
public:
    explicit FirstInstance(const std::wstring& name) {
        thread_ = std::thread([this, name] {
            SingleInstance instance(name);
            const SingleInstance::Claim claim = instance.Start({});
            const bool listening = claim == SingleInstance::Claim::First &&
                                   instance.Listen(GetModuleHandleW(nullptr), [this](const std::vector<std::wstring>& args) {
                                       std::lock_guard<std::mutex> lock(mutex_);
                                       received_.push_back(args);
                                       changed_.notify_all();
                                   });
            {
                std::lock_guard<std::mutex> lock(mutex_);
                first_ = claim == SingleInstance::Claim::First;
                listening_ = listening;
                threadId_ = GetCurrentThreadId();
                ready_ = true;
                changed_.notify_all();
            }
            MSG message;
            while (GetMessageW(&message, nullptr, 0, 0) > 0) {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        });
        std::unique_lock<std::mutex> lock(mutex_);
        changed_.wait_for(lock, std::chrono::seconds(10), [this] { return ready_; });
    }

    ~FirstInstance() {
        DWORD id = 0;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            id = threadId_;
        }
        // A thread pode ainda nao ter a fila de mensagens: tenta de novo ate ela aceitar o WM_QUIT.
        for (int i = 0; i < 100 && id != 0 && !PostThreadMessageW(id, WM_QUIT, 0, 0); ++i) Sleep(10);
        thread_.join();
    }

    bool first() {
        std::lock_guard<std::mutex> lock(mutex_);
        return first_;
    }
    bool listening() {
        std::lock_guard<std::mutex> lock(mutex_);
        return listening_;
    }
    // Os argumentos recebidos (espera ate 5 s pelo primeiro).
    std::vector<std::vector<std::wstring>> Received() {
        std::unique_lock<std::mutex> lock(mutex_);
        changed_.wait_for(lock, std::chrono::seconds(5), [this] { return !received_.empty(); });
        return received_;
    }

private:
    std::thread thread_;
    std::mutex mutex_;
    std::condition_variable changed_;
    bool ready_ = false;
    bool first_ = false;
    bool listening_ = false;
    DWORD threadId_ = 0;
    std::vector<std::vector<std::wstring>> received_;
};

}  // namespace

TEST_CASE("a second instance hands its arguments to the first") {
    const std::wstring name = TestName(L"entrega");
    FirstInstance first(name);
    REQUIRE(first.first());
    REQUIRE(first.listening());

    SingleInstance second(name);
    CHECK(second.Start({L"tel:2003"}) == SingleInstance::Claim::Delivered);

    const std::vector<std::vector<std::wstring>> received = first.Received();
    REQUIRE(received.size() == 1);
    CHECK(received[0] == std::vector<std::wstring>{L"tel:2003"});

    // Uma abertura sem argumentos (o atalho de novo) tambem chega: a primeira so vem para a frente.
    SingleInstance third(name);
    CHECK(third.Start({}) == SingleInstance::Claim::Delivered);
    // Varios argumentos, na ordem, com acento (UTF-16).
    SingleInstance fourth(name);
    CHECK(fourth.Start({L"--dados", L"C:\\Usu\u00e1rios\\teste", L"--sair"}) == SingleInstance::Claim::Delivered);
    const std::vector<std::vector<std::wstring>> all = first.Received();
    REQUIRE(all.size() == 3);
    CHECK(all[1].empty());
    CHECK(all[2] == std::vector<std::wstring>{L"--dados", L"C:\\Usu\u00e1rios\\teste", L"--sair"});
}

TEST_CASE("the first instance is the one that takes the mutex, and the next after it closes") {
    const std::wstring name = TestName(L"mutex");
    {
        SingleInstance only(name);
        CHECK(only.Start({}) == SingleInstance::Claim::First);
    }
    // A anterior fechou (o mutex saiu com ela): a proxima e a primeira de novo.
    SingleInstance again(name);
    CHECK(again.Start({}) == SingleInstance::Claim::First);
}

TEST_CASE("a second instance does not wait forever for a first that never listens") {
    const std::wstring name = TestName(L"surda");
    SingleInstance first(name);
    REQUIRE(first.Start({}) == SingleInstance::Claim::First);
    // A primeira pegou o mutex e nunca abriu a janela de mensagens.
    SingleInstance second(name);
    const auto started = std::chrono::steady_clock::now();
    CHECK(second.Start({L"tel:2003"}, 300) == SingleInstance::Claim::NotDelivered);
    CHECK(std::chrono::steady_clock::now() - started < std::chrono::seconds(5));
}
