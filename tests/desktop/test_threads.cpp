// Testes das threads do app de PC (starsonic/desktop/Threads.h): a fila de comandos e o agendador de verdade do
// controlador de ligacoes. Cada espera tem um limite (2 s), para um erro nunca travar a suite.
#include <atomic>
#include <chrono>
#include <future>
#include <mutex>
#include <ostream>
#include <thread>
#include <vector>

#include "Threads.h"
#include "test_support.h"

using namespace starsonic;
using namespace std::chrono_literals;

namespace {

bool Ready(std::future<void>& future) { return future.wait_for(2s) == std::future_status::ready; }

}  // namespace

TEST_CASE("the serial executor runs the tasks in order on one thread of its own") {
    std::vector<int> order;
    std::vector<std::thread::id> threads;
    {
        SerialExecutor executor;
        for (int i = 0; i < 100; ++i) {
            CHECK(executor.Post([&order, &threads, i] {
                order.push_back(i);
                threads.push_back(std::this_thread::get_id());
            }));
        }
        executor.Stop();   // roda o que ja estava na fila
    }
    REQUIRE(order.size() == 100);
    for (int i = 0; i < 100; ++i) CHECK(order[i] == i);
    for (const auto& id : threads) {
        CHECK(id == threads.front());
        CHECK(id != std::this_thread::get_id());
    }
}

TEST_CASE("a task posted from inside a task runs after it, never inside the post") {
    std::vector<std::string> order;
    SerialExecutor executor;
    std::promise<void> done;
    executor.Post([&] {
        executor.Post([&] {
            order.push_back("inner");
            done.set_value();
        });
        order.push_back("outer");
    });
    auto future = done.get_future();
    REQUIRE(Ready(future));
    executor.Stop();
    CHECK(order == std::vector<std::string>{"outer", "inner"});
}

TEST_CASE("a stopped executor refuses new tasks, and a throwing task does not stop the queue") {
    std::atomic<int> ran{0};
    SerialExecutor executor;
    executor.Post([] { throw 1; });
    executor.Post([&ran] { ++ran; });
    executor.Stop();
    CHECK(ran == 1);
    CHECK_FALSE(executor.Post([&ran] { ++ran; }));
    CHECK(ran == 1);
}

TEST_CASE("stop from inside a task lets the queue finish without waiting for itself") {
    std::atomic<int> ran{0};
    auto executor = std::make_unique<SerialExecutor>();
    std::promise<void> done;
    executor->Post([&] {
        executor->Stop();   // nao espera a propria thread
        ++ran;
    });
    executor->Post([&] {
        ++ran;
        done.set_value();
    });
    auto future = done.get_future();
    REQUIRE(Ready(future));
    executor.reset();   // o destrutor espera a thread, de fora dela
    CHECK(ran == 2);
}

TEST_CASE("the system clock counts milliseconds since 1970") {
    SystemClock clock;
    const int64_t before = std::chrono::duration_cast<std::chrono::milliseconds>(
                               std::chrono::system_clock::now().time_since_epoch())
                               .count();
    const int64_t now = clock.NowMs();
    CHECK(now >= before);
    CHECK(now - before < 1000);
    CHECK(now > 1700000000000LL);   // depois de 2023
}

TEST_CASE("the scheduler runs a task after its delay, on its own thread") {
    ThreadScheduler scheduler;
    std::promise<void> done;
    std::thread::id ranOn;
    const auto start = std::chrono::steady_clock::now();
    std::chrono::steady_clock::time_point ranAt;
    const int id = scheduler.Schedule(40, [&] {
        ranAt = std::chrono::steady_clock::now();
        ranOn = std::this_thread::get_id();
        done.set_value();
    });
    CHECK(id > 0);
    auto future = done.get_future();
    REQUIRE(Ready(future));
    CHECK(ranAt - start >= 40ms);
    CHECK(ranOn != std::this_thread::get_id());
    CHECK(scheduler.Pending() == 0);
}

TEST_CASE("the scheduler never runs a task inside Schedule, even with no delay") {
    ThreadScheduler scheduler;
    std::promise<void> done;
    std::thread::id ranOn;
    scheduler.Schedule(0, [&] {
        ranOn = std::this_thread::get_id();
        done.set_value();
    });
    auto future = done.get_future();
    REQUIRE(Ready(future));
    CHECK(ranOn != std::this_thread::get_id());
}

TEST_CASE("a cancelled task never runs, and the others run in the order of their time") {
    ThreadScheduler scheduler;
    std::mutex mutex;
    std::vector<int> order;
    std::promise<void> done;
    auto add = [&](int value) {
        std::lock_guard<std::mutex> lock(mutex);
        order.push_back(value);
    };
    scheduler.Schedule(60, [&] {
        add(3);
        done.set_value();
    });
    const int cancelled = scheduler.Schedule(20, [&] { add(99); });
    scheduler.Schedule(30, [&] { add(2); });
    scheduler.Schedule(10, [&] { add(1); });
    scheduler.Cancel(cancelled);
    scheduler.Cancel(12345);   // um id que nao existe: nada
    auto future = done.get_future();
    REQUIRE(Ready(future));
    std::lock_guard<std::mutex> lock(mutex);
    CHECK(order == std::vector<int>{1, 2, 3});
}

// O caso do controlador: quem agenda segura a trava dele (Schedule e Cancel com a trava presa) enquanto uma tarefa
// do agendador espera essa mesma trava. Se a tarefa rodasse com a trava da fila presa, o Schedule esperaria a
// tarefa, e a tarefa esperaria quem chamou o Schedule, para sempre.
TEST_CASE("a running task can wait for a lock held by whoever calls Schedule and Cancel") {
    ThreadScheduler scheduler;
    std::mutex controllerLock;
    std::promise<void> started;
    std::promise<void> done;
    std::atomic<bool> second{false};
    std::unique_lock<std::mutex> held(controllerLock);
    scheduler.Schedule(0, [&] {
        started.set_value();
        std::lock_guard<std::mutex> lock(controllerLock);   // espera quem agenda
        scheduler.Schedule(0, [&] {
            second = true;
            done.set_value();
        });
    });
    auto running = started.get_future();
    REQUIRE(Ready(running));
    // A tarefa esta rodando e esperando a trava: o Schedule e o Cancel com ela presa voltam.
    const int other = scheduler.Schedule(1000, [] {});
    scheduler.Cancel(other);
    held.unlock();
    auto future = done.get_future();
    REQUIRE(Ready(future));
    CHECK(second);
}

TEST_CASE("stop discards the pending tasks and later ones never run") {
    std::atomic<int> ran{0};
    ThreadScheduler scheduler;
    scheduler.Schedule(200, [&ran] { ++ran; });
    CHECK(scheduler.Pending() == 1);
    scheduler.Stop();
    CHECK(scheduler.Pending() == 0);
    const int id = scheduler.Schedule(0, [&ran] { ++ran; });
    CHECK(id > 0);
    scheduler.Cancel(id);
    std::this_thread::sleep_for(50ms);
    CHECK(ran == 0);
}
