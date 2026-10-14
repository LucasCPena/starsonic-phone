#!/usr/bin/env bash
# Compila para o Android as dependências nativas do app: o pjproject (com o Oboe e o Opus), o Opus e o
# AAR do Oboe, nas três ABIs. As versões estão em build/deps.lock (chave "android").
#
# Uso: ANDROID_NDK_ROOT=<NDK do deps.lock> build/android/build-deps.sh OUT [WORKDIR]
#   OUT      pasta de saída (android-deps no CI), que o app Android consome:
#              OUT/<abi>/include/           cabeçalhos do pjproject (com o config_site.h do Android) e do Opus
#              OUT/<abi>/lib/               bibliotecas .a do pjproject e libopus.a
#              OUT/<abi>/pjproject.cflags   saída de `pkg-config --cflags libpjproject`
#              OUT/oboe/                    o AAR do Oboe aberto (prefab/modules/oboe/...)
#   WORKDIR  onde os fontes são buscados e compilados (reaproveitado se existir); sem ele, uma pasta
#            temporária apagada no fim.
# Precisa de git, curl, unzip, cmake, make, pkg-config e python3, além do NDK.
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
    echo "uso: ANDROID_NDK_ROOT=<ndk> $0 OUT [WORKDIR]" >&2
    exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLATFORM=android-28                       # minSdk 28
ABIS=(arm64-v8a armeabi-v7a x86_64)
JOBS="$(nproc 2>/dev/null || echo 2)"

mkdir -p "$1"
OUT="$(cd "$1" && pwd)"
TEMP_WORK=0
if [ "$#" -eq 2 ]; then
    mkdir -p "$2"
    WORK="$(cd "$2" && pwd)"
else
    WORK="$(mktemp -d)"
    TEMP_WORK=1
fi
LOGS="$WORK/logs"
mkdir -p "$LOGS"

# ---------------------------------------------------------------------------------------------
# Auxiliares

# Anotação do GitHub Actions (aparece no resumo do run e pela API, onde o log nem sempre chega).
annotate() {   # annotate notice|error TÍTULO TEXTO
    [ "${GITHUB_ACTIONS:-}" = "true" ] || return 0
    local text="$3"
    text="${text//'%'/'%25'}"
    text="${text//$'\r'/'%0D'}"
    text="${text//$'\n'/'%0A'}"
    echo "::$1 title=$2::$text"
}

fail() {
    echo "build-deps: $*" >&2
    annotate error build-deps "$*"
    exit 1
}

# Conferência que passou: no log e no resumo do run.
ok() {
    echo "ok: $*"
    annotate notice build-deps "$*"
}

# Roda o comando mostrando a saída, que também fica em $LOGS/NOME.log; se falhar, o fim do log vai
# para uma anotação e o script sai com o código do comando.
logged() {   # logged NOME COMANDO...
    local name="$1" status=0
    shift
    echo "+ $*"
    "$@" 2>&1 | tee "$LOGS/$name.log" || status=$?
    if [ "$status" -ne 0 ]; then
        echo "build-deps: $name falhou (código $status); o log inteiro: $LOGS/$name.log" >&2
        annotate error "build-deps $name" "$(tail -n 40 "$LOGS/$name.log")"
        exit "$status"
    fi
}

# Valor de build/deps.lock pelo caminho de chaves. Ex.: lock_value android ndk
lock_value() {
    python3 -I -c 'import json, sys
node = json.load(open(sys.argv[1], encoding="utf-8"))
for key in sys.argv[2:]:
    node = node[key]
print(node)' "$ROOT/build/deps.lock" "$@"
}

# Busca só o commit fixado (sem o histórico) e deixa a pasta limpa nele.
fetch_commit() {   # fetch_commit REPO COMMIT PASTA
    local repo="$1" commit="$2" dir="$3" current=""
    mkdir -p "$dir"
    if [ -e "$dir/.git" ]; then
        current="$(git -C "$dir" rev-parse HEAD 2>/dev/null || true)"
    fi
    if [ "$current" != "$commit" ]; then
        echo "buscando $repo @ $commit"
        [ -e "$dir/.git" ] || git -C "$dir" init -q
        git -C "$dir" fetch -q --depth 1 "$repo" "$commit"
        git -C "$dir" checkout -q -f --detach FETCH_HEAD
    fi
    if [ "$(git -C "$dir" rev-parse HEAD)" != "$commit" ]; then
        fail "$dir não ficou no commit $commit"
    fi
    git -C "$dir" clean -fdxq
}

# ---------------------------------------------------------------------------------------------
# Versões e ferramentas

PJ_REPO="$(lock_value android pjproject repo)"
PJ_COMMIT="$(lock_value android pjproject commit)"
OPUS_REPO="$(lock_value android opus repo)"
OPUS_TAG="$(lock_value android opus tag)"
OPUS_COMMIT="$(lock_value android opus commit)"
OBOE_VERSION="$(lock_value android oboe version)"
OBOE_AAR="$(lock_value android oboe aar)"
OBOE_SHA256="$(lock_value android oboe sha256)"
NDK_VERSION="$(lock_value android ndk)"

for tool in git curl unzip cmake make pkg-config python3; do
    command -v "$tool" >/dev/null || fail "falta o programa $tool"
done

# O configure-android repassa os argumentos ao configure sem aspas: espaço em OUT ou WORKDIR quebraria.
case "$OUT$WORK" in
    *[[:space:]]*) fail "OUT ($OUT) e WORKDIR ($WORK) não podem ter espaços" ;;
esac

if [ -z "${ANDROID_NDK_ROOT:-}" ] || [ ! -f "$ANDROID_NDK_ROOT/source.properties" ]; then
    fail "ANDROID_NDK_ROOT tem de apontar para o NDK $NDK_VERSION (vazio, ou sem source.properties)"
fi
NDK_FOUND="$(sed -n -E 's/^Pkg\.Revision *= *([^ ]+).*/\1/p' "$ANDROID_NDK_ROOT/source.properties")"
if [ "$NDK_FOUND" != "$NDK_VERSION" ]; then
    fail "o NDK em $ANDROID_NDK_ROOT é o $NDK_FOUND; build/deps.lock pede o $NDK_VERSION"
fi
export ANDROID_NDK_ROOT

NM=("$ANDROID_NDK_ROOT"/toolchains/llvm/prebuilt/*/bin/llvm-nm)
[ -x "${NM[0]}" ] || fail "llvm-nm não encontrado no NDK $ANDROID_NDK_ROOT"

echo "NDK $NDK_VERSION, plataforma $PLATFORM, ABIs: ${ABIS[*]}"
echo "saída: $OUT; trabalho: $WORK"

# ---------------------------------------------------------------------------------------------
# Fontes e Oboe

echo; echo "== Oboe $OBOE_VERSION"
curl -fsSL --retry 3 --retry-delay 5 -o "$WORK/oboe.aar" "$OBOE_AAR"
OBOE_FOUND="$(sha256sum "$WORK/oboe.aar" | cut -d' ' -f1)"
[ "$OBOE_FOUND" = "$OBOE_SHA256" ] || fail "o AAR do Oboe tem SHA-256 $OBOE_FOUND; build/deps.lock pede $OBOE_SHA256"
rm -rf "$OUT/oboe"
unzip -q "$WORK/oboe.aar" -d "$OUT/oboe"
[ -f "$OUT/oboe/prefab/modules/oboe/include/oboe/Oboe.h" ] || fail "o AAR do Oboe não traz os cabeçalhos em prefab/modules/oboe/include"
OBOE_LIBS=()
for abi in "${ABIS[@]}"; do
    oboe_lib="$OUT/oboe/prefab/modules/oboe/libs/android.$abi/liboboe.so"
    [ -f "$oboe_lib" ] || fail "o AAR do Oboe não traz o liboboe.so de $abi"
    OBOE_LIBS+=("$oboe_lib")
done

echo; echo "== Fontes"
PJ="$WORK/pjproject"
OPUS="$WORK/opus"
fetch_commit "$PJ_REPO" "$PJ_COMMIT" "$PJ"
fetch_commit "$OPUS_REPO" "$OPUS_COMMIT" "$OPUS"
# O CMake do Opus tira a versão de `git describe --tags`; o clone raso não traz a tag.
git -C "$OPUS" tag -f "$OPUS_TAG" "$OPUS_COMMIT" >/dev/null

# ---------------------------------------------------------------------------------------------
# Uma ABI

build_opus() {   # build_opus ABI  -> $WORK/opus-ABI (include/opus e lib/libopus.a)
    local abi="$1" build="$WORK/opus-build-$1" prefix="$WORK/opus-$1"
    rm -rf "$build" "$prefix"
    logged "opus-$abi-configure" cmake -S "$OPUS" -B "$build" \
        -DCMAKE_TOOLCHAIN_FILE="$ANDROID_NDK_ROOT/build/cmake/android.toolchain.cmake" \
        -DANDROID_ABI="$abi" -DANDROID_PLATFORM="$PLATFORM" \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_INSTALL_PREFIX="$prefix" -DCMAKE_INSTALL_LIBDIR=lib \
        -DBUILD_SHARED_LIBS=OFF -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
        -DOPUS_BUILD_PROGRAMS=OFF -DOPUS_BUILD_TESTING=OFF \
        -DOPUS_INSTALL_PKG_CONFIG_MODULE=OFF -DOPUS_INSTALL_CMAKE_CONFIG_MODULE=OFF
    logged "opus-$abi-build" cmake --build "$build" -j"$JOBS"
    logged "opus-$abi-install" cmake --install "$build"
    [ -f "$prefix/lib/libopus.a" ] || fail "$abi: o Opus não gerou $prefix/lib/libopus.a"
}

build_pjproject() {   # build_pjproject ABI  -> $OUT/ABI
    local abi="$1" prefix="$OUT/$1" opus="$WORK/opus-$1" configure_log="$LOGS/pjproject-$1-configure.log"
    rm -rf "$prefix"
    mkdir -p "$prefix"
    cp "$ROOT/build/android/config_site.h" "$PJ/pjlib/include/pj/config_site.h"
    (
        cd "$PJ"
        # O configure-android junta o CFLAGS, o LDFLAGS... do ambiente aos que tira do ndk-build.
        unset CC CXX CPP AR RANLIB CFLAGS CXXFLAGS CPPFLAGS LDFLAGS LIBS
        export APP_PLATFORM="$PLATFORM" TARGET_ABI="$abi"
        logged "pjproject-$abi-configure" ./configure-android --use-ndk-cflags \
            --prefix="$prefix" --with-oboe="$OUT/oboe" --with-opus="$opus" \
            --disable-video --disable-ssl --disable-opencore-amr --disable-silk --disable-bcg729 \
            --disable-ilbc-codec --disable-gsm-codec --disable-g7221-codec --disable-l16-codec \
            --disable-libyuv --disable-android-mediacodec

        # O configure-android sai com 0 mesmo quando não consegue configurar (NDK inválido, por exemplo).
        [ -f config.status ] || fail "$abi: o configure-android não configurou o pjproject"
        # E o configure só avisa, sem parar, quando o Oboe ou o Opus não servem: o som ficaria sem
        # backend, ou sem codec, e só se descobriria no aparelho.
        if grep -q "unrecognized options" "$configure_log"; then
            fail "$abi: o configure não reconheceu alguma opção: $(grep "unrecognized options" "$configure_log")"
        fi
        grep -q "Checking sound device backend... Oboe" "$configure_log" ||
            fail "$abi: o configure não ligou o backend de som Oboe: $(grep -i -E "oboe|sound device backend" "$configure_log" | tr '\n' ' ')"
        grep -q "OPUS library found, OPUS support enabled" "$configure_log" ||
            fail "$abi: o configure não achou o Opus em $opus: $(grep -i "opus" "$configure_log" | tr '\n' ' ')"

        logged "pjproject-$abi-dep" make dep
        # Só as bibliotecas (make lib): o make inteiro também liga os programas de teste e de exemplo,
        # que não vão para o app. O que `make install` instala é o mesmo.
        logged "pjproject-$abi-make" make -j"$JOBS" lib
        logged "pjproject-$abi-install" make install
        logged "pjproject-$abi-distclean" make distclean
    )
    mkdir -p "$prefix/include" "$prefix/lib"
    cp -R "$opus/include/opus" "$prefix/include/"
    cp "$opus/lib/libopus.a" "$prefix/lib/"
    PKG_CONFIG_LIBDIR="$prefix/lib/pkgconfig" pkg-config --cflags libpjproject > "$prefix/pjproject.cflags"
}

# Confere o que saiu da ABI. Cada falha aqui seria um erro de link (ou de som) só no app.
verify_abi() {   # verify_abi ABI
    local abi="$1" prefix="$OUT/$1" symbols="$WORK/symbols-$1.txt" pjsua2
    pjsua2=("$prefix"/lib/libpjsua2-*.a)
    [ "${#pjsua2[@]}" -eq 1 ] && [ -f "${pjsua2[0]}" ] || fail "$abi: esperava um libpjsua2-*.a em $prefix/lib"
    for file in lib/libopus.a include/opus/opus.h include/pj/config_site.h; do
        [ -f "$prefix/$file" ] || fail "$abi: falta $prefix/$file"
    done
    cmp -s "$ROOT/build/android/config_site.h" "$prefix/include/pj/config_site.h" ||
        fail "$abi: o config_site.h instalado não é o de build/android"
    [ -s "$prefix/pjproject.cflags" ] || fail "$abi: pjproject.cflags está vazio"

    "${NM[0]}" --defined-only "$prefix"/lib/libpj*.a > "$symbols"
    grep -q ' T pjmedia_android_oboe_factory$' "$symbols" ||
        fail "$abi: o backend do Oboe não entrou no libpjmedia-audiodev"
    grep -q ' T pjmedia_codec_opus_init$' "$symbols" ||
        fail "$abi: o codec Opus não entrou no libpjmedia-codec"
    grep -q ' T webrtc_aec_create$' "$symbols" ||
        fail "$abi: o cancelador de eco do WebRTC não entrou no libpjmedia"
    if grep -q ' T JNI_OnLoad$' "$symbols"; then
        fail "$abi: o PJLIB define o JNI_OnLoad, que é da ponte do app (PJ_JNI_HAS_JNI_ONLOAD deve ser 0)"
    fi
    ok "$abi: $(basename "${pjsua2[0]}"), libopus.a, Oboe, Opus, WebRTC AEC e sem JNI_OnLoad no PJLIB ($(du -sh "$prefix" | cut -f1))"
}

# ---------------------------------------------------------------------------------------------
# Tudo

for abi in "${ABIS[@]}"; do
    started=$SECONDS
    echo; echo "== $abi: Opus $OPUS_TAG"
    build_opus "$abi"
    echo; echo "== $abi: PJSIP ${PJ_COMMIT:0:9}"
    build_pjproject "$abi"
    echo "== $abi: pronto em $((SECONDS - started)) s"
done

echo; echo "== Conferência"
for abi in "${ABIS[@]}"; do
    verify_abi "$abi"
done
logged oboe-align python3 -I "$ROOT/build/android/elf_align.py" "${OBOE_LIBS[@]}"
ok "liboboe.so de ${ABIS[*]} com os segmentos PT_LOAD alinhados a 16 KB ou mais"

echo; echo "android-deps pronto em $OUT ($SECONDS s)"

if [ "$TEMP_WORK" -eq 1 ]; then
    rm -rf "$WORK"
fi
