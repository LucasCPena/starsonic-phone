#include "stdafx.h"
#include "TlsWatch.h"

#include <atomic>

#include <pjsua-lib/pjsua.h>
#include <pjsua-lib/pjsua_internal.h>

namespace {

const pj_status_t kSslErrnoStart = PJ_ERRNO_START_USER + PJ_ERRNO_SPACE_SIZE * 6;

std::atomic<unsigned long> g_tlsFailures(0);

// Aviso que estava ligado antes do nosso (o MicroSIP 3.22.16 nao liga nenhum); chamado em seguida.
std::atomic<pjsip_tp_state_callback> g_previous(nullptr);

// Roda nas threads do PJSIP.
void OnTransportState(pjsip_transport* transport, pjsip_transport_state state,
                      const pjsip_transport_state_info* info) {
    if (state == PJSIP_TP_STATE_DISCONNECTED && info && IsTlsError(info->status)) {
        ++g_tlsFailures;
    }
    const pjsip_tp_state_callback previous = g_previous.load();
    if (previous) {
        previous(transport, state, info);
    }
}

}  // namespace

bool IsTlsError(pj_status_t status) {
    if (status >= kSslErrnoStart && status < kSslErrnoStart + PJ_ERRNO_SPACE_SIZE) {
        return true;
    }
    return (status >= PJSIP_TLS_EUNKNOWN && status <= PJSIP_TLS_ESSLCONN) || status == PJSIP_TLS_ECERTVERIF;
}

void WatchTlsFailures() {
    if (pjsua_get_state() != PJSUA_STATE_RUNNING) {
        return;
    }
    // O on_transport_state do pjsua e chamado pelo proprio callback de transporte do pjsua, sem
    // encadear de volta: trocar so este ponteiro nao cria laco com o set_tp_state_cb do pjsua.
    const pjsip_tp_state_callback current = pjsua_var.ua_cfg.cb.on_transport_state;
    if (current != &OnTransportState) {
        g_previous.store(current);
        pjsua_var.ua_cfg.cb.on_transport_state = &OnTransportState;
    }
}

unsigned long TlsFailureCount() {
    return g_tlsFailures.load();
}
