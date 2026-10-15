#!/usr/bin/env bash
# Confere que o app volta a registrar o ramal depois de o celular ligar (BOOT_COMPLETED), com o emulador que
# o adb enxerga e o registrador falso do CI (tests/smoke/fake_registrar.py) rodando neste computador, e que o
# serviço segura o processador acordado com a conta conectada (spec 7.2, item 6: o wake lock parcial
# "starsonic:conexao").
#
# Uso: build/android/check-boot.sh [PORTA_DE_CONTROLE] [RAMAL]   (padrão: 5070 e 2001)
#
# O ServiceTest deixa a conta gravada no app. Aqui o app para à força (am force-stop: o serviço e o processo
# saem, a conta continua gravada), o script confere que o processo saiu e que o wake lock não está preso, e a
# contagem de REGISTER aceitos do ramal é tirada. A contagem não pode subir sozinha; depois do
# BOOT_COMPLETED (só o root pode mandá-lo), ela precisa subir em até 30 s, e o wake lock precisa aparecer na
# seção "Wake Locks" do dumpsys power (o histórico do dumpsys guarda os antigos e não conta). Sem o receptor
# do BOOT_COMPLETED no app, nada registra o ramal de novo e a conferência falha.
# Código: 0 = o ramal registrou de novo, com o processador acordado; 1 = não, ou algo falhou.
#
# Os tempos (em segundos) mudam pelo ambiente, para os testes (tests/python/test_check_boot.py):
# CHECK_BOOT_ROOT_WAIT (60) para o adbd voltar como root, CHECK_BOOT_SETTLE (3) depois de parar o app,
# CHECK_BOOT_QUIET (5) sem o BOOT_COMPLETED, CHECK_BOOT_WAIT (30) depois dele e CHECK_BOOT_WAKE_WAIT (10)
# para o wake lock aparecer depois do registro.
set -euo pipefail

PACKAGE=br.com.starsonic.phone
WAKE_LOCK_TAG="starsonic:conexao"
PORT="${1:-5070}"
RAMAL="${2:-2001}"
ROOT_WAIT="${CHECK_BOOT_ROOT_WAIT:-60}"
SETTLE="${CHECK_BOOT_SETTLE:-3}"
QUIET="${CHECK_BOOT_QUIET:-5}"
WAIT="${CHECK_BOOT_WAIT:-30}"
WAKE_WAIT="${CHECK_BOOT_WAKE_WAIT:-10}"

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

# A linha do wake lock da conexão na seção "Wake Locks" do dumpsys power (os presos agora), ou nada.
wake_lock() {
    local out
    out="$(adb shell dumpsys power 2>/dev/null | tr -d '\r' || true)"
    awk -v tag="'$WAKE_LOCK_TAG'" '
        /^[[:space:]]*Wake Locks: size=/ { section = 1; next }
        section && /^[[:space:]]*$/ { section = 0 }
        section && index($0, tag) { print; exit }
    ' <<<"$out"
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

# Sem o app: o serviço e o processo saem (a conta continua gravada). O --include-stopped-packages do
# broadcast leva o BOOT_COMPLETED ao app parado à força (num celular de verdade, o boot chega ao app que não
# foi parado à força).
adb shell am force-stop "$PACKAGE" || fail "am force-stop $PACKAGE"
sleep "$SETTLE"
pid="$(adb shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r' || true)"
[ -z "$pid" ] || fail "o app continua rodando depois do am force-stop (pid $pid)"
held="$(wake_lock)"
[ -z "$held" ] || fail "o wake lock $WAKE_LOCK_TAG já estava preso antes do BOOT_COMPLETED: $held"
before="$(registers)"
number "$before"

# Sem o BOOT_COMPLETED, nada registra o ramal (senão a conferência não provaria nada).
sleep "$QUIET"
now="$(registers)"
number "$now"
[ "$now" = "$before" ] || fail "o ramal $RAMAL registrou sem o BOOT_COMPLETED (REGISTER aceitos: $before -> $now)"

adb logcat -c || true
adb shell am broadcast -a android.intent.action.BOOT_COMPLETED --include-stopped-packages -p "$PACKAGE" ||
    fail "am broadcast BOOT_COMPLETED"
registered=""
for second in $(seq "$WAIT"); do
    sleep 1
    now="$(registers)"
    number "$now"
    if [ "$now" -gt "$before" ]; then
        registered="$second"
        break
    fi
done
[ -n "$registered" ] || fail "o ramal $RAMAL não registrou em $WAIT s depois do BOOT_COMPLETED (REGISTER aceitos: $before)"
echo "check-boot: o ramal $RAMAL registrou de novo em $registered s (REGISTER aceitos: $before -> $now)"

# Com a conta conectada, o processador fica acordado (o wake lock da conexão está preso).
held=""
for _ in $(seq "$WAKE_WAIT"); do
    held="$(wake_lock)"
    [ -n "$held" ] && break
    sleep 1
done
[ -n "$held" ] || fail "o wake lock $WAKE_LOCK_TAG não apareceu no dumpsys power em $WAKE_WAIT s depois do registro"
held="$(echo "$held" | sed 's/^[[:space:]]*//')"
echo "check-boot: processador acordado ($held)"
annotate notice "o ramal $RAMAL registrou de novo $registered s depois do BOOT_COMPLETED (REGISTER aceitos: $before -> $now), com o processador acordado ($held)"
exit 0
