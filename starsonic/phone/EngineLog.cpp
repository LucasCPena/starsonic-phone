#include "EngineLog.h"

#include <atomic>

namespace starsonic {
namespace {

const char kLogSender[] = "SipEngine";

// Entrega uma linha ao listener, sem o fim de linha.
void ForwardLog(EngineListener* listener, int level, std::string line) {
    while (!line.empty() && (line.back() == '\n' || line.back() == '\r')) line.pop_back();
    try {
        listener->OnLog(level, line);
    } catch (...) {   // o PJSIP é C: nenhuma exceção volta para ele
    }
}

#if PJMEDIA_HAS_VIDEO
// O texto da linha que o pjsua escreve (nível 4) a cada pedido de quadro-chave (só com o vídeo):
// "Call <id>: set video stream, op=<o número do SEND_KEYFRAME>".
const std::string& KeyframeRequestLine() {
    static const std::string line = "set video stream, op=" + std::to_string(PJSUA_CALL_VID_STRM_SEND_KEYFRAME);
    return line;
}
#endif

std::atomic<EngineListener*> g_earlyListener{nullptr};
std::atomic<int> g_earlyLevel{0};

void EarlyLog(int level, const char* data, int length) {
    EngineListener* listener = g_earlyListener.load();
    if (listener && level <= g_earlyLevel.load() && data && length > 0) {
        ForwardLog(listener, level, std::string(data, static_cast<size_t>(length)));
    }
}

}  // namespace

void Log(int level, const std::string& text) {
    try {
        pj::Endpoint::instance().utilLogWrite(level, kLogSender, text);
    } catch (...) {
    }
}

void LogForwarder::write(const pj::LogEntry& entry) {
#if PJMEDIA_HAS_VIDEO
    if (entry.msg.find(KeyframeRequestLine()) != std::string::npos) return;   // ver o EngineLog.h
#endif
    ForwardLog(listener_, entry.level, entry.msg);
}

EarlyLogScope::EarlyLogScope(EngineListener* listener, int maxLevel) {
    g_earlyLevel = maxLevel;
    g_earlyListener = listener;
    pj_log_set_log_func(&EarlyLog);
}

EarlyLogScope::~EarlyLogScope() { g_earlyListener = nullptr; }

}  // namespace starsonic
