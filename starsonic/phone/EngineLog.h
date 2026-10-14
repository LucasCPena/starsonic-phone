#pragma once
// O log do motor (interno): as linhas do PJSIP e as do próprio motor vão a EngineListener::OnLog, na
// hora e na thread que as escreveu.
#include <pjsua2.hpp>

#include <string>

#include "SipEngine.h"

namespace starsonic {

// Linha do motor no mesmo log do PJSIP (mesmo formato, mesmo filtro de nível, mesmo OnLog). Só numa
// thread registrada no PJLIB.
void Log(int level, const std::string& text);

// O writer do pjsua2. O Endpoint é dono do objeto e o apaga no libDestroy.
class LogForwarder : public pj::LogWriter {
public:
    explicit LogForwarder(EngineListener* listener) : listener_(listener) {}

    void write(const pj::LogEntry& entry) override;

private:
    EngineListener* listener_;
};

// O writer só entra no libInit, e o libCreate já escreve linhas: sem isto elas iriam para o
// terminal. Enquanto o objeto existe, o PJLIB entrega as linhas ao listener, com o mesmo filtro de
// nível do writer. Um de cada vez (o Create só roda com a trava de "um motor por processo").
class EarlyLogScope {
public:
    EarlyLogScope(EngineListener* listener, int maxLevel);
    ~EarlyLogScope();

    EarlyLogScope(const EarlyLogScope&) = delete;
    EarlyLogScope& operator=(const EarlyLogScope&) = delete;
};

}  // namespace starsonic
