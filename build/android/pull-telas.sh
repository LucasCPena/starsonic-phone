#!/usr/bin/env bash
# As fotos das telas que os testes do visual tiram (R19): a pasta telas do app, no armazenamento externo do emulador,
# vem para $RUNNER_TEMP/telas (a pasta junta as das classes que já rodaram). Sem o adb pull, ela sai pelo run-as e o
# tar; sem as fotos, só um aviso do GitHub Actions. Nunca falha: a linha do android.yml que chama este script depois
# de uma classe sai com o resultado da classe (…; s=$?; bash build/android/pull-telas.sh; exit $s).
#
# Uso: build/android/pull-telas.sh (com o adb vendo o emulador e o RUNNER_TEMP do GitHub Actions)
set -u

PACKAGE=br.com.starsonic.phone
FILES="/sdcard/Android/data/$PACKAGE/files"
DEST="${RUNNER_TEMP:?o RUNNER_TEMP do GitHub Actions}"

adb pull "$FILES/telas" "$DEST/" \
    || { adb exec-out run-as "$PACKAGE" tar cf - -C "$FILES" telas | tar xf - -C "$DEST"; } \
    || echo "::warning title=Fotos das telas::a pasta telas não saiu do emulador"
exit 0
