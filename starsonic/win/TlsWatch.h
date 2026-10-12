#pragma once
// Falhas de TLS vistas pelos transportes do PJSIP. O resultado do registro so traz o 503 do erro
// de transporte (reg_last_err fica PJ_SUCCESS), sem o erro do TLS; a tela Entrar compara este
// contador no comeco e no fim de cada tentativa (spec 11.1).
#include <pj/types.h>

// Liga o aviso de estado de transporte do pjsua (on_transport_state). Chamar antes de cada
// tentativa: o MicroSIP recria o pjsua quando as configuracoes mudam e o aviso se perde.
void WatchTlsFailures();

// Quantas desconexoes por erro de TLS ja foram vistas.
unsigned long TlsFailureCount();

// Erro do OpenSSL (faixa PJ_SSL_ERRNO_START, privada no ssl_sock_ossl.c) ou do transporte TLS do
// PJSIP que nao seja de entrada e saida (certificado, cifra, metodo, contexto).
bool IsTlsError(pj_status_t status);
