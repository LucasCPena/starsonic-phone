#!/usr/bin/env bash
# O teste do atualizador no emulador (UpdatePromptTest, spec 7.6): um `python3 -m http.server` neste computador serve
# um canal de teste, com o versao-android.json da versão 9.9.9 e um APK qualquer (64 KiB de zeros), cujo SHA-256 não
# confere; a classe roda pelo run-emulator-tests.sh, e o servidor sai no fim, passe ou falhe. O emulador vê este
# computador em 10.0.2.2, e o app de debug só deixa o HTTP sem TLS para esse endereço.
#
# A classe roda em duas vezes, porque o Android 11+ fecha o app (e os testes com ele) quando a permissão de instalar
# apps muda: primeiro, com a permissão, todos os testes menos o sem ela; depois, sem a permissão, só esse.
#
# Uso: build/android/run-update-test.sh APK TEST_APK [ARGS...]
#   APK, TEST_APK  como no run-emulator-tests.sh
#   ARGS           vão para o `am instrument` depois do canal e do prefixo (ex.: -e registrar 10.0.2.2 -e porta 5070)
#
# Pelo ambiente: UPDATE_CHANNEL_PORT, a porta do servidor (padrão 8000), e RUN_EMULATOR_TESTS, o script que roda a
# classe (padrão: o run-emulator-tests.sh ao lado; os testes em tests/python põem um falso).
# Código: 0 se as duas vezes passaram; 1 se alguma falhou (as duas rodam) ou se o servidor não subiu; 2 = uso.
set -euo pipefail

if [ "$#" -lt 2 ]; then
    echo "uso: $0 APK TEST_APK [ARGS...]" >&2
    exit 2
fi
APK="$1"
TEST_APK="$2"
shift 2

HERE="$(cd "$(dirname "$0")" && pwd)"
PORT="${UPDATE_CHANNEL_PORT:-8000}"
RUNNER="${RUN_EMULATOR_TESTS:-$HERE/run-emulator-tests.sh}"
CLASS=br.com.starsonic.phone.UpdatePromptTest
WITHOUT_PERMISSION="$CLASS#withoutPermissionToInstallAppsUpdateOpensTheAndroidSetting"
VERSION=9.9.9
BASE="http://10.0.2.2:$PORT/"
APK_NAME="StarsonicPhone-android-$VERSION.apk"
# O SHA-256 de um arquivo vazio: bem formado, e nunca o do APK servido.
WRONG_SHA256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

channel="$(mktemp -d)"
server_log="$(mktemp)"
server=""
cleanup() {
    if [ -n "$server" ]; then
        kill "$server" 2>/dev/null || true
        wait "$server" 2>/dev/null || true
    fi
    rm -rf "$channel" "$server_log"
}
trap cleanup EXIT

head -c 65536 /dev/zero > "$channel/$APK_NAME"
cat > "$channel/versao-android.json" <<EOF
{"versao": "$VERSION", "instalador": "$BASE$APK_NAME", "sha256": "$WRONG_SHA256", "notas": "Versão de teste do atualizador."}
EOF

python3 -I -m http.server "$PORT" --bind 127.0.0.1 --directory "$channel" > "$server_log" 2>&1 &
server=$!

# Espera o servidor responder (até 10 s); se ele sai antes (a porta ocupada), falha na hora.
ready=0
for _ in $(seq 50); do
    if ! kill -0 "$server" 2>/dev/null; then
        break
    fi
    if python3 -I -c 'import sys, urllib.request; urllib.request.urlopen(sys.argv[1], timeout=1).read()' \
        "http://127.0.0.1:$PORT/versao-android.json" 2>/dev/null; then
        ready=1
        break
    fi
    sleep 0.2
done
if [ "$ready" != 1 ]; then
    echo "run-update-test: o servidor do canal não subiu na porta $PORT: $(tr '\n' ' ' < "$server_log")" >&2
    exit 1
fi

channel_args=(-e canal "${BASE}versao-android.json" -e prefixo "$BASE")
status=0
APPOPS="REQUEST_INSTALL_PACKAGES:allow" bash "$RUNNER" "$APK" "$TEST_APK" "$CLASS" -e notClass "$WITHOUT_PERMISSION" \
    "${channel_args[@]}" "$@" || status=1
APPOPS="REQUEST_INSTALL_PACKAGES:deny" bash "$RUNNER" "$APK" "$TEST_APK" "$WITHOUT_PERMISSION" \
    "${channel_args[@]}" "$@" || status=1
exit "$status"
