#!/usr/bin/env bash
# Põe o emulador (ou celular de testes com root) que o adb enxerga no idioma pedido e espera o Android voltar.
#
# Uso: build/android/set-locale.sh LOCALE   (ex.: pt-BR)
#
# Os botões da notificação de ligação (Atender e Recusar) são do Android, no idioma do celular: os testes do
# emulador precisam do pt-BR, como nos celulares dos clientes. O script troca persist.sys.locale (com o adb
# como root), reinicia o Android (stop e start) e espera o sys.boot_completed voltar; depois tira a tela de
# bloqueio (sem senha) que volta com ele. Num aparelho já no idioma, nada muda.
# Código: 0 = o aparelho está no idioma; 1 = não deu; 2 = uso.
#
# Os tempos (em segundos) mudam pelo ambiente, para os testes (tests/python/test_set_locale.py):
# SET_LOCALE_ROOT_WAIT (60) para o adbd voltar como root, SET_LOCALE_BOOT_WAIT (180) para o Android voltar e
# SET_LOCALE_POLL (1) entre as conferências.
set -euo pipefail

if [ "$#" -ne 1 ] || [ -z "$1" ]; then
    echo "uso: $0 LOCALE" >&2
    exit 2
fi
LOCALE="$1"
ROOT_WAIT="${SET_LOCALE_ROOT_WAIT:-60}"
BOOT_WAIT="${SET_LOCALE_BOOT_WAIT:-180}"
POLL="${SET_LOCALE_POLL:-1}"

# Anotação do GitHub Actions (aparece no resumo do run e pela API, onde o log nem sempre chega).
annotate() {   # annotate notice|error TEXTO
    [ "${GITHUB_ACTIONS:-}" = "true" ] || return 0
    local text="$2"
    text="${text//'%'/'%25'}"
    text="${text//$'\r'/}"
    text="${text//$'\n'/'%0A'}"
    echo "::$1 title=Idioma do emulador::$text"
}

fail() {
    echo "set-locale: $*" >&2
    annotate error "$*"
    exit 1
}

prop() {   # prop NOME: a propriedade do aparelho (ou vazio)
    adb shell getprop "$1" 2>/dev/null | tr -d '\r' || true
}

adb wait-for-device
before="$(prop persist.sys.locale)"
if [ "$before" = "$LOCALE" ]; then
    echo "set-locale: o aparelho já está em $LOCALE"
    exit 0
fi

# Só o sistema (ou o root) muda persist.sys.locale: o adbd volta como root.
adb root >/dev/null 2>&1 || true
root=""
for _ in $(seq "$ROOT_WAIT"); do
    adb wait-for-device
    root="$(adb shell id -u 2>/dev/null | tr -d '\r' || true)"
    [ "$root" = "0" ] && break
    sleep "$POLL"
done
[ "$root" = "0" ] || fail "o adbd não voltou como root (id -u: '$root')"

# O Android lê o idioma ao começar: reinicia, e o sys.boot_completed (zerado aqui) volta a 1 quando ele está
# pronto de novo.
adb shell setprop persist.sys.locale "$LOCALE"
adb shell setprop sys.boot_completed 0
adb shell stop
adb shell start
booted=""
for second in $(seq "$BOOT_WAIT"); do
    sleep "$POLL"
    if [ "$(prop sys.boot_completed)" = "1" ]; then
        booted="$second"
        break
    fi
done
[ -n "$booted" ] || fail "o Android não voltou em $BOOT_WAIT s depois de trocar o idioma para $LOCALE"
now="$(prop persist.sys.locale)"
[ "$now" = "$LOCALE" ] || fail "o idioma ficou '$now' (pedido: $LOCALE)"
adb shell input keyevent 82 || true
echo "set-locale: $before -> $LOCALE (o Android voltou em $booted s)"
annotate notice "$before -> $LOCALE (o Android voltou em $booted s)"
