#!/usr/bin/env bash
# TESTE (descartavel): liga uma .so de teste contra android-deps, como a ponte do app vai fazer.
set -uo pipefail
NDK="${ANDROID_NDK_ROOT:?}"
BIN="$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin"
DEPS="$PWD/android-deps"
mkdir -p smoke && cd smoke
cat > smoke.cpp <<'CPP'
#include <jni.h>
#include <pjsua2.hpp>

extern "C" JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM *vm, void *) {
    pj_jni_set_jvm(vm);
    pj::Endpoint ep;
    ep.libCreate();
    pj::EpConfig cfg;
    ep.libInit(cfg);
    ep.libDestroy();
    return JNI_VERSION_1_6;
}
CPP
status=0
for pair in arm64-v8a:aarch64-linux-android28 armeabi-v7a:armv7a-linux-androideabi28 x86_64:x86_64-linux-android28; do
  abi="${pair%%:*}"; triple="${pair##*:}"
  echo; echo "=== smoke $abi ($triple)"
  CXX="$BIN/$triple-clang++"
  D="$DEPS/$abi"
  PCDIR="$D/lib/pkgconfig"
  # pkg-config --static --libs: Libs + Libs.private (inclui -loboe e o libc++_shared.so)
  LIBS="$(PKG_CONFIG_LIBDIR="$PCDIR" pkg-config --static --libs libpjproject)"
  echo "libs: $LIBS"
  # shellcheck disable=SC2086
  "$CXX" -std=c++17 -O2 -fPIC -DANDROID $(cat "$D/pjproject.cflags") -c smoke.cpp -o "smoke-$abi.o" || { echo "COMPILE FALHOU $abi"; status=1; continue; }
  # shellcheck disable=SC2086
  "$CXX" -shared -o "libsmoke-$abi.so" "smoke-$abi.o" -Wl,--no-undefined -Wl,-z,max-page-size=16384 \
      -L"$DEPS/oboe/prefab/modules/oboe/libs/android.$abi" $LIBS || { echo "LINK FALHOU $abi"; status=1; continue; }
  ls -la "libsmoke-$abi.so"
  python3 -I "$GITHUB_WORKSPACE/build/android/elf_align.py" "libsmoke-$abi.so" || status=1
  "$BIN/llvm-readelf" -d "libsmoke-$abi.so" | grep -E "NEEDED|SONAME"
  "$BIN/llvm-nm" -D --defined-only "libsmoke-$abi.so" | grep -E "JNI_OnLoad" 
done
echo; echo "SMOKE status=$status"
exit $status
