#!/usr/bin/env bash
# Compila no Linux o pjproject fixado em build/deps.lock, para os testes do motor de ligações
# (tests/phone). Sem vídeo, som, SSL nem codecs extras: o registro SIP e os codecs G.722, PCMA e
# PCMU bastam.
#
# Uso: build/linux/build-pjproject.sh WORKDIR PREFIX
#   WORKDIR  onde o pjproject é buscado e compilado (reaproveitado se já estiver no commit certo)
#   PREFIX   onde o `make install` põe cabeçalhos, bibliotecas e o libpjproject.pc
# Precisa de git, g++, make, python3, pkg-config e uuid-dev (libuuid).
set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "uso: $0 WORKDIR PREFIX" >&2
    exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mkdir -p "$1" "$2"
WORKDIR="$(cd "$1" && pwd)"
PREFIX="$(cd "$2" && pwd)"
JOBS="$(nproc 2>/dev/null || echo 2)"

# Repositório e commit do pjproject: os mesmos do Windows.
lock_value() {
    python3 -I -c 'import json, sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["pjproject"][sys.argv[2]])' \
        "$ROOT/build/deps.lock" "$1"
}
PJ_REPO="$(lock_value repo)"
PJ_COMMIT="$(lock_value commit)"

# Busca só o commit fixado (sem o histórico), a menos que o WORKDIR já esteja nele.
current=""
if [ -e "$WORKDIR/.git" ]; then
    current="$(git -C "$WORKDIR" rev-parse HEAD 2>/dev/null || true)"
fi
if [ "$current" != "$PJ_COMMIT" ]; then
    echo "pjproject: buscando $PJ_COMMIT"
    [ -e "$WORKDIR/.git" ] || git -C "$WORKDIR" init -q
    git -C "$WORKDIR" fetch -q --depth 1 "$PJ_REPO" "$PJ_COMMIT"
    git -C "$WORKDIR" checkout -q -f --detach FETCH_HEAD
fi
if [ "$(git -C "$WORKDIR" rev-parse HEAD)" != "$PJ_COMMIT" ]; then
    echo "pjproject: o WORKDIR não ficou no commit $PJ_COMMIT" >&2
    exit 1
fi

cp "$ROOT/build/linux/config_site.h" "$WORKDIR/pjlib/include/pj/config_site.h"

cd "$WORKDIR"
./configure --prefix="$PREFIX" \
    --disable-video --disable-sound --disable-ssl --disable-opencore-amr --disable-silk \
    --disable-libwebrtc --disable-libyuv --disable-bcg729 --disable-ilbc-codec \
    --disable-gsm-codec --disable-g7221-codec --disable-l16-codec \
    CFLAGS="-O2 -fPIC" CXXFLAGS="-O2 -fPIC"
make dep
make -j"$JOBS"
make install
echo "pjproject: instalado em $PREFIX"
