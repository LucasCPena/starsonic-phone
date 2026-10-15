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
#
# APPOPS (no ambiente, opcional): "OP:MODO OP:MODO..." (ex.: REQUEST_INSTALL_PACKAGES:allow), postos com o
# appops antes dos testes. Serve para o que não pode mudar com os testes rodando: o Android 11+ fecha o app
# (e, com ele, os testes) quando a permissão de instalar apps muda. Com APPOPS, os testes esperam o processo do
# app sair (até APP_EXIT_WAIT segundos, 10).
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

app_ops=()
for op in ${APPOPS:-}; do
    if [[ ! "$op" =~ ^[A-Z_]+:[a-z]+$ ]]; then
        echo "APPOPS inválido: '$op' (use OP:MODO, como REQUEST_INSTALL_PACKAGES:allow)" >&2
        exit 2
    fi
    app_ops+=("$op")
done

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

install() {   # install APK: o motivo do adb vai junto na falha
    local output
    if output="$(adb install -r -t "$1" 2>&1)"; then
        echo "$output"
    else
        fail "não instalou $1: $output"
    fi
}

adb wait-for-device
install "$APK"
install "$TEST_APK"

grant android.permission.RECORD_AUDIO
grant android.permission.POST_NOTIFICATIONS
adb shell appops set "$PACKAGE" USE_FULL_SCREEN_INTENT allow || fail "appops set $PACKAGE USE_FULL_SCREEN_INTENT allow"
adb shell dumpsys deviceidle whitelist "+$PACKAGE" || fail "dumpsys deviceidle whitelist +$PACKAGE"
for op in "${app_ops[@]}"; do
    adb shell appops set "$PACKAGE" "${op%%:*}" "${op#*:}" || fail "appops set $PACKAGE ${op%%:*} ${op#*:}"
done
# O Android fecha o app quando a permissão de instalar apps muda (killUid), depois que o appops volta: os testes só
# começam com o processo do app fora (o MY_PACKAGE_REPLACED da instalação o abre), ou o fim dele pegaria o processo dos
# testes. Se ele continua de pé depois de APP_EXIT_WAIT segundos (10), a mudança não o fecha (o modo já era esse).
if [ "${#app_ops[@]}" -gt 0 ]; then
    alive=1
    for _ in $(seq $(( ${APP_EXIT_WAIT:-10} * 5 ))); do
        if ! adb shell pidof "$PACKAGE" > /dev/null 2>&1; then
            alive=0
            break
        fi
        sleep 0.2
    done
    if [ "$alive" = 1 ]; then
        echo "o app continua de pé depois do appops; os testes começam assim mesmo"
    fi
fi

command="am instrument -w -e class $(quote "$CLASS")"
for arg in "$@"; do
    command+=" $(quote "$arg")"
done
command+=" $RUNNER"

adb logcat -c || true
report="$(mktemp)"
echo "+ adb shell $command"
adb shell "$command" | tr -d '\r' | tee "$report" || true

# As notas dos testes (linhas "Nota do teste: ...", que um teste manda pelo sendStatus: o que não é falha, mas
# não pode passar calado, como os toques repetidos) viram uma anotação, com sucesso ou com falha.
notes="$(grep -E '^Nota do teste: ' "$report" || true)"
if [ -n "$notes" ]; then
    annotate notice "Notas dos testes: $CLASS" "$notes"
fi

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
