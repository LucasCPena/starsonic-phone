#!/usr/bin/env bash
# SONDA TEMPORARIA (branch t4-probe): coleta fatos do ambiente de CI. Nao vai para o main.
set -uo pipefail
section() { printf '\n\n########## %s\n' "$*"; }

section "Ferramentas e variaveis"
uname -a; nproc; free -g | head -2; df -h . | tail -1
for t in cmake ninja make pkg-config jq unzip curl git python3 java sha256sum shellcheck; do
  printf '%-12s ' "$t"; (command -v "$t" && "$t" --version 2>&1 | head -1) || echo "AUSENTE"
done
echo "ANDROID_HOME=${ANDROID_HOME:-} ANDROID_SDK_ROOT=${ANDROID_SDK_ROOT:-}"
echo "ANDROID_NDK_ROOT=${ANDROID_NDK_ROOT:-} ANDROID_NDK=${ANDROID_NDK:-} ANDROID_NDK_HOME=${ANDROID_NDK_HOME:-} ANDROID_NDK_LATEST_HOME=${ANDROID_NDK_LATEST_HOME:-}"
echo "JAVA_HOME=${JAVA_HOME:-}"
ls "$ANDROID_HOME" "$ANDROID_HOME/ndk" "$ANDROID_HOME/cmdline-tools" 2>&1 | head -40
echo "sdkmanager: $(command -v sdkmanager || echo 'fora do PATH')"
ls "$ANDROID_HOME/cmdline-tools/latest/bin" 2>&1 | head
head -3 /etc/os-release

section "NDKs que o sdkmanager oferece"
SDKM="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
"$SDKM" --list 2>&1 | grep -i -E "ndk" | head -40
echo "--- 30.0.16248370 ?"
"$SDKM" --list 2>&1 | grep -F "30.0.16248370" || echo "NAO ENCONTRADO"

section "Instalar o NDK"
time ("$SDKM" --install "ndk;30.0.16248370" 2>&1 | tail -15)
ls "$ANDROID_HOME/ndk"

section "Estrutura do NDK"
NDK="$ANDROID_HOME/ndk/30.0.16248370"
cat "$NDK/source.properties"
ls "$NDK"
echo "--- platforms.json"; head -c 600 "$NDK/meta/platforms.json"; echo
ls -la "$NDK/ndk-build" "$NDK/build/ndk-build" "$NDK/build/cmake/android.toolchain.cmake" 2>&1
ls "$NDK/toolchains/llvm/prebuilt/"
ls "$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin" | grep -E "^(clang|clang\+\+|llvm-ar|llvm-nm|llvm-ranlib|llvm-readelf|ld|ld.lld)" | head -40
"$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/clang" --version | head -2
ls "$NDK/toolchains/llvm/prebuilt/linux-x86_64/sysroot/usr/lib/aarch64-linux-android/" | grep -E "c\+\+|libc\.|liblog|libOpenSLES" | head

section "AAR do Oboe"
mkdir -p "$RUNNER_TEMP/oboe" && cd "$RUNNER_TEMP/oboe" || exit 1
URL="https://dl.google.com/dl/android/maven2/com/google/oboe/oboe/1.11.0/oboe-1.11.0.aar"
curl -fsSL --retry 3 -o oboe.aar "$URL"
ls -la oboe.aar; sha256sum oboe.aar
for ext in sha256 sha1 md5 sha512; do
  printf 'sidecar .%s: ' "$ext"; curl -fsSL "$URL.$ext" 2>&1 | head -c 200 || echo "(nao existe)"; echo
done
mkdir x && cd x && unzip -q ../oboe.aar && find . -type f | sort | head -80
echo "--- prefab.json"; cat prefab/prefab.json 2>&1 | head -20
echo "--- module.json"; cat prefab/modules/oboe/module.json 2>&1 | head -20
for d in prefab/modules/oboe/libs/*/; do echo "--- $d"; cat "$d/abi.json" 2>&1; echo; done
echo "--- alinhamento de todos os liboboe.so do AAR"
python3 -I "$GITHUB_WORKSPACE/build/android/elf_align.py" prefab/modules/oboe/libs/*/liboboe.so
echo "--- readelf NEEDED"
for so in prefab/modules/oboe/libs/*/liboboe.so; do
  echo "$so"; "$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-readelf" -d "$so" | grep -E "NEEDED|SONAME"
done

section "ndk-build -n do exemplo do pjproject (o que configure-android le)"
mkdir -p "$RUNNER_TEMP/pj" && cd "$RUNNER_TEMP/pj" || exit 1
git init -q && git fetch -q --depth 1 https://github.com/pjsip/pjproject 5a457451fa2712ba18e12b01738e8ff3af2b26fd && git checkout -q --detach FETCH_HEAD
cat pjsip-apps/src/samples/android_sample/jni/Application.mk
for abi in arm64-v8a armeabi-v7a x86_64; do
  echo "=================== $abi"
  "$NDK/ndk-build" -n -C pjsip-apps/src/samples/android_sample APP_PLATFORM=android-28 APP_ABI=$abi 2>&1 | head -60
done
echo; echo "SONDA CONCLUIDA"
