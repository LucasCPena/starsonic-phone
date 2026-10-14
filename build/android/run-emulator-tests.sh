#!/usr/bin/env bash
# Roda uma classe de testes instrumentados do app no emulador (ou celular) que o adb enxerga.
#
# Uso: build/android/run-emulator-tests.sh APK TEST_APK CLASSE [ARGS...]
#   APK       o APK do app (app-debug.apk)
#   TEST_APK  o APK dos testes (app-debug-androidTest.apk)
#   CLASSE    a classe de testes (ex.: br.com.starsonic.phone.NativeLoadTest)
#   ARGS      vão para o `am instrument` como vieram (ex.: -e registrar 10.0.2.2 -e porta 5060)
#
# Instala os dois APKs e concede o que o app pediria à pessoa: o microfone e as notificações (só as que
# o manifesto pede; o pm recusa as outras), a tela cheia e a saída da otimização de bateria. O
# `am instrument` sai com 0 mesmo quando um teste falha, então o resultado vem do relatório dele.
# Código: 0 = todos os testes passaram; 1 = algum falhou, nenhum rodou ou algo não instalou; 2 = uso.
set -euo pipefail

PACKAGE=br.com.starsonic.phone
RUNNER="$PACKAGE.test/androidx.test.runner.AndroidJUnitRunner"

if [ "$#" -lt 3 ]; then
    echo "uso: $0 APK TEST_APK CLASSE [ARGS...]" >&2
    exit 2
fi
APK="$1"
TEST_APK="$2"
CLASS="$3"
shift 3

# Anotação do GitHub Actions (aparece no resumo do run e pela API, onde o log nem sempre chega).
annotate() {   # annotate notice|error TÍTULO TEXTO
    [ "${GITHUB_ACTIONS:-}" = "true" ] || return 0
    local text="$3"
    text="${text//'%'/'%25'}"
    text="${text//$'\r'/}"
    text="${text//$'\n'/'%0A'}"
    echo "::$1 title=$2::$text"
}

fail() {
    echo "run-emulator-tests: $*" >&2
    annotate error "Testes no emulador" "$*"
    exit 1
}

# O texto entre aspas simples para o shell do aparelho (o adb junta os argumentos com espaços).
quote() {
    printf "'%s'" "${1//\'/\'\\\'\'}"
}

grant() {   # grant PERMISSÃO
    local output
    if output="$(adb shell pm grant "$PACKAGE" "$1" 2>&1)"; then
        echo "permissão concedida: $1"
    elif grep -q "has not requested permission" <<<"$output"; then
        echo "o app não pede $1 (nada a conceder)"
    else
        fail "pm grant $1: $output"
    fi
}

adb wait-for-device
adb install -r -t "$APK" || fail "não instalou $APK"
adb install -r -t "$TEST_APK" || fail "não instalou $TEST_APK"

grant android.permission.RECORD_AUDIO
grant android.permission.POST_NOTIFICATIONS
adb shell appops set "$PACKAGE" USE_FULL_SCREEN_INTENT allow || fail "appops set $PACKAGE USE_FULL_SCREEN_INTENT allow"
adb shell dumpsys deviceidle whitelist "+$PACKAGE" || fail "dumpsys deviceidle whitelist +$PACKAGE"

command="am instrument -w -e class $(quote "$CLASS")"
for arg in "$@"; do
    command+=" $(quote "$arg")"
done
command+=" $RUNNER"

adb logcat -c || true
report="$(mktemp)"
echo "+ adb shell $command"
adb shell "$command" | tr -d '\r' | tee "$report" || true

# Passou: o resumo do JUnit diz "OK (N tests)" com N >= 1 (com falha, ele diz "FAILURES!!!"). Se o
# processo cai no meio, o resumo não sai (o am mostra só INSTRUMENTATION_RESULT: shortMsg=Process crashed.).
if grep -Eq '^OK \([1-9][0-9]* tests?\)$' "$report"; then
    annotate notice "Testes no emulador" "$CLASS: $(grep -E '^OK \(' "$report")"
    exit 0
fi

# Falhou: o relatório das falhas (ou o fim da saída) e as falhas do app no logcat viram anotações.
# Sem `| head`: no Actions o SIGPIPE vem ignorado, e quem escreve num pipe fechado sai com erro.
failures="$(awk '/^There w[a-z]* [0-9]* failure/ { on = 1 } on && n < 60 { print; n++ } /^FAILURES!!!/ { on = 0 }' "$report")"
[ -n "$failures" ] || failures="$(tail -n 40 "$report")"
annotate error "Testes no emulador: $CLASS" "$failures"
crashes="$(adb logcat -d -v brief 'AndroidRuntime:E' 'DEBUG:F' 'libc:F' '*:S' 2>/dev/null | tail -n 60 || true)"
if [ -n "$crashes" ]; then
    echo "$crashes"
    annotate error "Falhas do app no logcat" "$crashes"
fi
echo "run-emulator-tests: $CLASS falhou" >&2
exit 1
