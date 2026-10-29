#!/usr/bin/env bash
# Compila no Linux a libre, o baresip e a libg722 fixados em build/deps.lock (a chave "baresip"), estáticos, para os
# testes do motor de ligações com o baresip (tests/phone, o alvo phone_tests_baresip).
#
# Uso: build/baresip/build-linux.sh WORKDIR PREFIX
#   WORKDIR  onde os três projetos são buscados e compilados (cada um reaproveitado se já estiver no commit certo)
#   PREFIX   onde ficam:
#            - include/re/ (a libre), include/baresip.h e os cabeçalhos da libg722;
#            - lib/libre.a, lib/libg722.a e lib/libstarsonic-baresip.a (o baresip com os módulos do deps.lock);
#            - lib/starsonic-baresip-libs.txt, as bibliotecas do sistema para ligar.
# Precisa de git, cmake, gcc, make, python3, binutils (ar e nm), libssl-dev, libopus-dev e zlib1g-dev.
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

# Valor de build/deps.lock pelo caminho de chaves; uma lista sai com um item por linha. Ex.: lock_value baresip re commit
lock_value() {
    python3 -I -c 'import json, sys
node = json.load(open(sys.argv[1], encoding="utf-8"))
for key in sys.argv[2:]:
    node = node[key]
print("\n".join(node) if isinstance(node, list) else node)' "$ROOT/build/deps.lock" "$@"
}

# Busca só o commit fixado de baresip.<nome> (sem o histórico) em WORKDIR/<nome>, a menos que já esteja nele, e confere
# o hash do que ficou.
fetch() {
    local name="$1" repo commit dir current=""
    repo="$(lock_value baresip "$name" repo)"
    commit="$(lock_value baresip "$name" commit)"
    dir="$WORKDIR/$name"
    mkdir -p "$dir"
    if [ -e "$dir/.git" ]; then
        current="$(git -C "$dir" rev-parse HEAD 2>/dev/null || true)"
    fi
    if [ "$current" != "$commit" ]; then
        echo "$name: buscando $commit"
        [ -e "$dir/.git" ] || git -C "$dir" init -q
        git -C "$dir" fetch -q --depth 1 "$repo" "$commit"
        git -C "$dir" checkout -q -f --detach FETCH_HEAD
    fi
    if [ "$(git -C "$dir" rev-parse HEAD)" != "$commit" ]; then
        echo "$name: o WORKDIR não ficou no commit $commit" >&2
        exit 1
    fi
}

fetch re
fetch baresip
fetch libg722
MODULES_TEXT="$(lock_value baresip modules)"   # fora do mapfile: um erro do python para o script
mapfile -t MODULES <<<"$MODULES_TEXT"
MODULE_LIST="$(IFS=';'; echo "${MODULES[*]}")"

# Cada build começa do zero: um cache do CMake de outra versão ou de outras opções não fica valendo.
BUILD="$WORKDIR/build"
rm -rf "$BUILD"
COMMON=(-DCMAKE_BUILD_TYPE=Release -DCMAKE_POSITION_INDEPENDENT_CODE=ON -DCMAKE_INSTALL_PREFIX="$PREFIX")

# A libg722 só estática, sem os programas de teste.
cmake -S "$WORKDIR/libg722" -B "$BUILD/libg722" "${COMMON[@]}" \
    -DENABLE_SHARED_LIB=OFF -DENABLE_STATIC_LIB=ON -DG722_BUILD_TEST_PROGRAMS=OFF -DBUILD_TESTING=OFF
cmake --build "$BUILD/libg722" -j "$JOBS"
cmake --install "$BUILD/libg722"

# A libre só estática, sem BFCP, PCP e RTMP; com o OpenSSL (o SRTP usa o AES dele). O lib fixo: sem ele, o
# GNUInstallDirs escolhe lib64 em alguns Linux.
cmake -S "$WORKDIR/re" -B "$BUILD/re" "${COMMON[@]}" -DCMAKE_INSTALL_LIBDIR=lib \
    -DLIBRE_BUILD_SHARED=OFF -DLIBRE_BUILD_STATIC=ON -DUSE_BFCP=OFF -DUSE_PCP=OFF -DUSE_RTMP=OFF -DUSE_OPENSSL=ON
cmake --build "$BUILD/re" -j "$JOBS"
cmake --install "$BUILD/re"

# O baresip estático, só com os módulos do deps.lock, com a libre e a libg722 do PREFIX. Só a biblioteca: o install
# do baresip pede o executável e os testes dele, que o motor não usa.
cmake -S "$WORKDIR/baresip" -B "$BUILD/baresip" "${COMMON[@]}" \
    -DSTATIC=ON -DMODULES="$MODULE_LIST" \
    -Dre_DIR="$PREFIX/lib/cmake/re" -DRE_INCLUDE_DIR="$PREFIX/include/re" -DRE_LIBRARY="$PREFIX/lib/libre.a" \
    -DLIBG722_INCLUDE_DIR="$PREFIX/include" -DLIBG722_LIBRARY="$PREFIX/lib/libg722.a"
cmake --build "$BUILD/baresip" -j "$JOBS" --target baresip

# O arquivo do motor: o baresip e os módulos num .a só. No STATIC do baresip 4.12 cada módulo é uma biblioteca OBJECT do
# CMake, cujos objetos já vão dentro do libbaresip.a (o g711, o libg722...); o ar -M o copia inteiro, com os dois
# sdp.c.o (o do baresip e o do opus). O script do ar -M não aceita espaços nos caminhos: ele roda na pasta do build.
LIB="$PREFIX/lib/libstarsonic-baresip.a"
rm -f "$LIB" "$BUILD/baresip/libstarsonic-baresip.a"
(cd "$BUILD/baresip" && printf 'CREATE libstarsonic-baresip.a\nADDLIB libbaresip.a\nSAVE\nEND\n' | ar -M)
mv "$BUILD/baresip/libstarsonic-baresip.a" "$LIB"
install -m 644 "$WORKDIR/baresip/include/baresip.h" "$PREFIX/include/baresip.h"
echo "ssl crypto opus z pthread m dl" > "$PREFIX/lib/starsonic-baresip-libs.txt"

# Os módulos do arquivo são os do deps.lock, nem mais nem menos: o baresip deixa de fora, sem erro, um módulo que não
# acha a biblioteca dele (o opus sem o libopus-dev, o libg722 sem a libg722), e nenhum outro (o g722, sob a LGPL da
# spandsp) pode entrar.
FOUND="$(nm --defined-only "$LIB" | awk '$3 ~ /^exports_/ { print substr($3, 9) }' | sort -u)"
for module in "${MODULES[@]}"; do
    if ! grep -qx "$module" <<<"$FOUND"; then
        echo "baresip: o módulo $module não está em $LIB (falta a biblioteca dele?)" >&2
        exit 1
    fi
done
for module in $FOUND; do
    if ! printf '%s\n' "${MODULES[@]}" | grep -qx "$module"; then
        echo "baresip: o módulo $module está em $LIB, mas não no build/deps.lock" >&2
        exit 1
    fi
done
echo "baresip: instalado em $PREFIX (módulos: ${MODULES[*]})"
