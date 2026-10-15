#!/usr/bin/env bash
# Confere que o app volta a registrar o ramal depois de o celular ligar (BOOT_COMPLETED), com o emulador que
# o adb enxerga e o registrador falso do CI (tests/smoke/fake_registrar.py) rodando neste computador.
#
# Uso: build/android/check-boot.sh [PORTA_DE_CONTROLE] [RAMAL]   (padrão: 5070 e 2001)
#
# O ServiceTest deixa a conta gravada no app. Aqui o serviço para (a conta sai do servidor com Expires 0,
# que o registrador não conta) e a contagem de REGISTER aceitos do ramal é tirada. A contagem não pode subir
# sozinha; depois do BOOT_COMPLETED (só o root pode mandá-lo), ela precisa subir em até 30 s. Sem o
# receptor do BOOT_COMPLETED no app, nada registra o ramal de novo e a conferência falha.
# Código: 0 = o ramal registrou de novo; 1 = não registrou, ou algo falhou.
#
# Os tempos (em segundos) mudam pelo ambiente, para os testes (tests/python/test_check_boot.py):
# CHECK_BOOT_ROOT_WAIT (60) para o adbd voltar como root, CHECK_BOOT_SETTLE (3) depois de parar o serviço,
# CHECK_BOOT_QUIET (5) sem o BOOT_COMPLETED e CHECK_BOOT_WAIT (30) depois dele.
set -euo pipefail

PACKAGE=br.com.starsonic.phone
SERVICE="$PACKAGE/.service.SipService"
PORT="${1:-5070}"
RAMAL="${2:-2001}"
ROOT_WAIT="${CHECK_BOOT_ROOT_WAIT:-60}"
SETTLE="${CHECK_BOOT_SETTLE:-3}"
QUIET="${CHECK_BOOT_QUIET:-5}"
WAIT="${CHECK_BOOT_WAIT:-30}"

# Anotação do GitHub Actions (aparece no resumo do run e pela API, onde o log nem sempre chega).
annotate() {   # annotate notice|error TEXTO
    [ "${GITHUB_ACTIONS:-}" = "true" ] || return 0
    local text="$2"
    text="${text//'%'/'%25'}"
    text="${text//$'\r'/}"
    text="${text//$'\n'/'%0A'}"
    echo "::$1 title=BOOT_COMPLETED::$text"
}

fail() {
    echo "check-boot: $*" >&2
    # O que o app e o sistema disseram (sem `| head`: no Actions o SIGPIPE vem ignorado).
    local log
    log="$(adb logcat -d -v brief 'StarsonicMotor:I' 'AndroidRuntime:E' 'ActivityManager:W' '*:S' 2>/dev/null | tail -n 40 || true)"
    [ -z "$log" ] || echo "$log" >&2
    annotate error "$*"$'\n'"$log"
    exit 1
}

# REGISTER aceitos do ramal com Expires > 0, pela porta de controle do registrador (ou o erro).
registers() {
    python3 -I - "$PORT" "$RAMAL" <<'EOF' 2>&1 || true
import socket
import sys

with socket.create_connection(("127.0.0.1", int(sys.argv[1])), timeout=5) as conn:
    conn.sendall(("REGISTERS %s\n" % sys.argv[2]).encode("ascii"))
    print(conn.makefile(encoding="utf-8").readline().strip())
EOF
}

number() {   # number TEXTO: falha se a resposta do registrador não é um número
    [[ "$1" =~ ^[0-9]+$ ]] || fail "resposta do registrador a REGISTERS $RAMAL: '$1'"
}

# O adbd volta como root (o BOOT_COMPLETED é protegido): espera ele reiniciar e responder.
adb root || fail "adb root"
root=""
for _ in $(seq "$ROOT_WAIT"); do
    root="$(adb shell id -u 2>/dev/null | tr -d '\r' || true)"
    [ "$root" = "0" ] && break
    sleep 1
done
[ "$root" = "0" ] || fail "o adbd não voltou como root (id -u: '$root')"

# Sem o serviço (o am instrument pode já ter fechado o app; aí não há o que parar).
adb shell am stopservice -n "$SERVICE" || true
sleep "$SETTLE"
before="$(registers)"
number "$before"

# Sem o BOOT_COMPLETED, nada registra o ramal (senão a conferência não provaria nada).
sleep "$QUIET"
now="$(registers)"
number "$now"
[ "$now" = "$before" ] || fail "o ramal $RAMAL registrou sem o BOOT_COMPLETED (REGISTER aceitos: $before -> $now)"

adb logcat -c || true
adb shell am broadcast -a android.intent.action.BOOT_COMPLETED -p "$PACKAGE" || fail "am broadcast BOOT_COMPLETED"
for second in $(seq "$WAIT"); do
    sleep 1
    now="$(registers)"
    number "$now"
    if [ "$now" -gt "$before" ]; then
        echo "check-boot: o ramal $RAMAL registrou de novo em $second s (REGISTER aceitos: $before -> $now)"
        annotate notice "o ramal $RAMAL registrou de novo $second s depois do BOOT_COMPLETED (REGISTER aceitos: $before -> $now)"
        exit 0
    fi
done
fail "o ramal $RAMAL não registrou em $WAIT s depois do BOOT_COMPLETED (REGISTER aceitos: $before)"
