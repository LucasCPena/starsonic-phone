#!/usr/bin/env bash
# Pacote "código-fonte completo" de uma versão do app Android (GPL v3, spec 10): este repositório no commit de agora
# (git archive do HEAD: só o que está versionado), o pjproject, o Opus e o Oboe nos commits de build/deps.lock (chave
# "android") e um LEIA-ME.txt. As dependências vêm dos repositórios do deps.lock (o GitHub), só o commit fixado.
#
# Uso: build/android/make_source_bundle.sh VERSAO OUT
#   VERSAO  X.Y.Z ou X.Y.Z-rc.N
#   OUT     pasta do pacote (criada se faltar): OUT/StarsonicPhone-android-<versão>-codigo-fonte-completo.zip
# Pelo ambiente (os testes em tests/python põem os deles): REPO_DIR, o repositório a empacotar (padrão: o deste
# script), e DEPS_LOCK, o deps.lock (padrão: o build/deps.lock do REPO_DIR).
# Precisa de git, tar, zip e python3. Código: 0 = pacote pronto; 1 = falhou (nada fica em OUT); 2 = uso.
set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "uso: $0 VERSAO OUT" >&2
    exit 2
fi
VERSION="$1"
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-rc\.[1-9][0-9]*)?$ ]]; then
    echo "make_source_bundle: versão inválida: '$VERSION' (use X.Y.Z ou X.Y.Z-rc.N)" >&2
    exit 2
fi

fail() {
    echo "make_source_bundle: $*" >&2
    if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
        local text="$*"
        text="${text//'%'/'%25'}"
        echo "::error title=make_source_bundle::${text//$'\n'/'%0A'}"
    fi
    exit 1
}

for tool in git tar zip python3; do
    command -v "$tool" >/dev/null || fail "falta o programa $tool"
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${REPO_DIR:-$(cd "$HERE/../.." && pwd)}"
LOCK="${DEPS_LOCK:-$REPO/build/deps.lock}"
[ -f "$LOCK" ] || fail "não achei o deps.lock em $LOCK"
mkdir -p "$2"
OUT="$(cd "$2" && pwd)"
NAME="StarsonicPhone-android-$VERSION-codigo-fonte-completo"
ZIP="$OUT/$NAME.zip"

# Valor do deps.lock pelo caminho de chaves. Ex.: lock_value android opus commit
lock_value() {
    python3 -I -c 'import json, sys
node = json.load(open(sys.argv[1], encoding="utf-8"))
for key in sys.argv[2:]:
    node = node[key]
print(node)' "$LOCK" "$@" || fail "o deps.lock ($LOCK) não tem ${*}"
}

PJ_REPO="$(lock_value android pjproject repo)"
PJ_TAG="$(lock_value android pjproject tag)"
PJ_COMMIT="$(lock_value android pjproject commit)"
OPUS_REPO="$(lock_value android opus repo)"
OPUS_TAG="$(lock_value android opus tag)"
OPUS_COMMIT="$(lock_value android opus commit)"
OBOE_REPO="$(lock_value android oboe repo)"
OBOE_VERSION="$(lock_value android oboe version)"
OBOE_COMMIT="$(lock_value android oboe commit)"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
TREE="$STAGE/$NAME"
mkdir -p "$TREE"

# 1. Este repositório: o que está versionado no commit de agora (sem o que mudou e não foi para o commit).
COMMIT="$(git -C "$REPO" rev-parse HEAD)" || fail "$REPO não é um repositório git"
git -C "$REPO" archive --format=tar --prefix="starsonic-phone/" HEAD | tar -x -C "$TREE" ||
    fail "o git archive de $REPO falhou"

# 2. As dependências: só o commit fixado, sem o histórico.
add_dependency() {   # add_dependency PASTA REPO COMMIT
    local folder="$1" repo="$2" commit="$3" work="$STAGE/git-$1"
    echo "buscando $repo @ $commit"
    git init -q "$work"
    git -C "$work" fetch -q --depth 1 "$repo" "$commit" || fail "não consegui buscar $repo no commit $commit"
    [ "$(git -C "$work" rev-parse FETCH_HEAD)" = "$commit" ] || fail "$repo: o que veio não é o commit $commit"
    git -C "$work" archive --format=tar --prefix="$folder/" FETCH_HEAD | tar -x -C "$TREE" ||
        fail "o git archive de $repo falhou"
    rm -rf "$work"
}
add_dependency "pjproject-$PJ_TAG" "$PJ_REPO" "$PJ_COMMIT"
add_dependency "opus-$OPUS_TAG" "$OPUS_REPO" "$OPUS_COMMIT"
add_dependency "oboe-$OBOE_VERSION" "$OBOE_REPO" "$OBOE_COMMIT"

# 3. O LEIA-ME.
cat > "$TREE/LEIA-ME.txt" <<EOF
Starsonic Phone para Android $VERSION - código-fonte completo (GNU GPL v3)

starsonic-phone/      este repositório no commit $COMMIT
                      (o app em android/, o núcleo em starsonic/core, o motor de ligações em
                      starsonic/phone, os scripts de build em build/ e os testes em tests/).
pjproject-$PJ_TAG/       PJSIP $PJ_TAG, commit $PJ_COMMIT
                      ($PJ_REPO).
opus-$OPUS_TAG/          Opus $OPUS_TAG, commit $OPUS_COMMIT
                      ($OPUS_REPO).
oboe-$OBOE_VERSION/          Oboe $OBOE_VERSION, commit $OBOE_COMMIT
                      ($OBOE_REPO); o app usa o AAR com.google.oboe:oboe:$OBOE_VERSION,
                      que o Google compila a partir deste código.

Como compilar: starsonic-phone/README.md (seção Android). O PJSIP (com o Oboe e o Opus) sai do
starsonic-phone/build/android/build-deps.sh, e o APK, do projeto Gradle em starsonic-phone/android.
As bibliotecas Java e Kotlin (AndroidX, Compose, WorkManager e Kotlin) e o NDK vêm dos repositórios do
Google, nas versões de starsonic-phone/android/gradle/libs.versions.toml e starsonic-phone/build/deps.lock.
EOF

# 4. O zip (os links simbólicos vão como links, sem seguir para fora da árvore). Só no fim ele entra em OUT.
rm -f "$ZIP"
(cd "$STAGE" && zip -q -r -X -y "$STAGE/pacote.zip" "$NAME") || fail "o zip falhou"
mv "$STAGE/pacote.zip" "$ZIP"
size="$(stat -c %s "$ZIP")"
files="$(find "$TREE" -type f | wc -l)"
echo "fontes: $ZIP ($size bytes, $files arquivos)"
if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    echo "::notice title=make_source_bundle::$NAME.zip: $size bytes, $files arquivos (starsonic-phone ${COMMIT:0:9}, pjproject-$PJ_TAG, opus-$OPUS_TAG, oboe-$OBOE_VERSION)"
fi
