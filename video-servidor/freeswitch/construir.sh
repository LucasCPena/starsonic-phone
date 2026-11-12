#!/usr/bin/env bash
# Monta o FreeSWITCH do servidor de vídeo a partir do código oficial, nas versões fixadas em
# video-servidor/deps.lock: o sofia-sip e o spandsp, e o FreeSWITCH com os nove módulos do
# modules.conf, todos em /opt/starsonic-freeswitch. Depois tira dali o que o servidor não usa, faz a
# lista dos pacotes do apt de que os programas precisam (o pacotes.txt) e monta o pacote do sistema e
# o pacote das fontes.
#
# Só para os contêineres do build (o job freeswitch do video.yml) e para uma máquina de build como a
# dos testes: ele apaga o /opt/starsonic-freeswitch antes de instalar. Nunca rode num servidor.
#
# Uso: video-servidor/freeswitch/construir.sh SISTEMA TRABALHO SAIDA
#   SISTEMA   ubuntu-24.04 ou debian-12: o desta máquina, conferido pelo /etc/os-release
#   TRABALHO  onde as fontes são buscadas e compiladas (cada projeto é reaproveitado se já estiver
#             no commit certo)
#   SAIDA     onde ficam o starsonic-freeswitch-SISTEMA-amd64.tar.gz, o .sha256 dele e o
#             starsonic-freeswitch-fontes.tar.gz
# Roda como root (escreve no /opt), com os pacotes do pacotes-de-build.txt.
set -euo pipefail
shopt -s inherit_errexit
# A ordem dos patches e do pacotes.txt não muda com a língua da máquina.
export LC_ALL=C

if [ "$#" -ne 3 ]; then
    echo "uso: $0 SISTEMA TRABALHO SAIDA" >&2
    exit 2
fi

SISTEMA="$1"
case "$SISTEMA" in
    ubuntu-24.04 | debian-12) ;;
    *)
        echo "construir: o sistema $SISTEMA não serve (use ubuntu-24.04 ou debian-12)" >&2
        exit 2
        ;;
esac

# O pacotes.txt sai com os nomes dos pacotes desta máquina: ela tem de ser do sistema pedido.
# shellcheck source=/dev/null
achado="$(. /etc/os-release && echo "${ID:-}-${VERSION_ID:-}")"
if [ "$achado" != "$SISTEMA" ]; then
    echo "construir: esta máquina é $achado, e não $SISTEMA" >&2
    exit 1
fi

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# O deps.lock fica ao lado deste script no pacote das fontes, e na pasta de cima no repositório
# (video-servidor/deps.lock). O de cá vem primeiro: a pasta de cima do pacote pode ter outro deps.lock.
LOCK="$AQUI/deps.lock"
[ -e "$LOCK" ] || LOCK="$AQUI/../deps.lock"
mkdir -p "$2" "$3"
TRABALHO="$(cd "$2" && pwd)"
SAIDA="$(cd "$3" && pwd)"
JOBS="$(nproc 2>/dev/null || echo 2)"
PREFIXO=/opt/starsonic-freeswitch
# Na ordem do build: o FreeSWITCH usa os outros dois.
PROJETOS=(sofia-sip spandsp freeswitch)
PACOTE="starsonic-freeswitch-$SISTEMA-amd64.tar.gz"
FONTES="starsonic-freeswitch-fontes.tar.gz"

# Valor do video-servidor/deps.lock pelo caminho de chaves. Ex.: lock_value freeswitch commit
lock_value() {
    python3 -I -c 'import json, sys
node = json.load(open(sys.argv[1], encoding="utf-8"))
for key in sys.argv[2:]:
    node = node[key]
print(node)' "$LOCK" "$@"
}

# Deixa TRABALHO/<projeto> no commit fixado, com os patches de patches/<projeto>/ por cima.
preparar_fontes() {
    local projeto="$1" repo commit pasta atual patch
    repo="$(lock_value "$projeto" repo)"
    commit="$(lock_value "$projeto" commit)"
    pasta="$TRABALHO/$projeto"
    mkdir -p "$pasta"

    # Busca só o commit fixado (sem o histórico), a menos que a pasta já esteja nele.
    atual=""
    if [ -e "$pasta/.git" ]; then
        atual="$(git -C "$pasta" rev-parse HEAD 2>/dev/null || true)"
    fi
    if [ "$atual" != "$commit" ]; then
        echo "$projeto: buscando $commit"
        [ -e "$pasta/.git" ] || git -C "$pasta" init -q
        git -C "$pasta" fetch -q --depth 1 "$repo" "$commit"
        git -C "$pasta" checkout -q -f --detach FETCH_HEAD
    fi
    if [ "$(git -C "$pasta" rev-parse HEAD)" != "$commit" ]; then
        echo "$projeto: a pasta $pasta não ficou no commit $commit" >&2
        exit 1
    fi

    # Os patches vão sempre sobre a árvore do commit, na ordem dos nomes. Sem a pasta, nenhum. O clean
    # tira o que um patch criou num build anterior; sem o -x, o que o .gitignore ignora (o build) fica.
    git -C "$pasta" reset -q --hard
    git -C "$pasta" clean -q -fd
    for patch in "$AQUI/patches/$projeto"/*.patch; do
        [ -e "$patch" ] || continue
        echo "$projeto: aplicando $(basename "$patch")"
        if ! git -C "$pasta" apply "$patch"; then
            echo "$projeto: o patch $(basename "$patch") não aplica no commit $commit" >&2
            exit 1
        fi
    done
}

# Compila uma das bibliotecas (o sofia-sip ou o spandsp) e a instala no prefixo.
montar_biblioteca() {
    local projeto="$1"
    shift
    echo "$projeto: compilando"
    cd "$TRABALHO/$projeto"
    ./bootstrap.sh
    ./configure --prefix="$PREFIXO" "$@"
    make -j"$JOBS"
    make install
}

# Os arquivos ELF do prefixo (os programas e as bibliotecas), pelos quatro primeiros bytes.
elfs() {
    local arquivo
    find "$PREFIXO" -type f | sort | while IFS= read -r arquivo; do
        if [ "$(od -An -N4 -tx1 "$arquivo" | tr -d ' \n')" = 7f454c46 ]; then
            echo "$arquivo"
        fi
    done
}

# O pacote do apt que tem uma biblioteca. No Ubuntu 24.04 e no Debian 12 (o /lib é o /usr/lib), o
# ldd mostra /lib/x86_64-linux-gnu/..., e a maioria dos pacotes registra /usr/lib/x86_64-linux-gnu/...
# (a libc6 do Debian 12 faz o contrário): o dpkg é perguntado pelo caminho e depois pelo gêmeo dele.
pacote_de() {
    local caminho="$1" gemeo tentativa dono
    case "$caminho" in
        /usr/*) gemeo="${caminho#/usr}" ;;
        *) gemeo="/usr$caminho" ;;
    esac
    for tentativa in "$caminho" "$gemeo"; do
        # A linha do dono, como "libssl3t64:amd64: /usr/lib/x86_64-linux-gnu/libssl.so.3". As linhas
        # "diversion by ..." não dizem o dono: no Ubuntu 24.04, o /lib64/ld-linux-x86-64.so.2 só tem essas.
        dono="$( (dpkg -S "$tentativa" 2>/dev/null || true) | awk -v fim=": $tentativa" '
            !/^diversion by / && substr($0, length($0) - length(fim) + 1) == fim {
                print substr($0, 1, length($0) - length(fim))
                exit
            }')"
        if [ -n "$dono" ]; then
            # Um nome por linha, sem a arquitetura.
            tr ',' '\n' <<<"$dono" | sed 's/^ *//; s/:.*//'
            return 0
        fi
    done
    echo "construir: nenhum pacote do apt tem $caminho (nem $gemeo)" >&2
    exit 1
}

# 1. As fontes, todas antes de compilar: uma falha da rede para o build logo.
for projeto in "${PROJETOS[@]}"; do
    preparar_fontes "$projeto"
done

# 2. O pacote é a pasta inteira: ela começa vazia, para não levar sobras de um build anterior.
rm -rf "$PREFIXO"
mkdir -p "$PREFIXO"

montar_biblioteca sofia-sip --with-glib=no --without-doxygen
montar_biblioteca spandsp

# 3. O FreeSWITCH, com os módulos do modules.conf. Com o --prefix, o configure espalha as pastas dele
# pelo prefixo no jeito do FHS (lib/freeswitch/mod, share/freeswitch/fonts, etc/freeswitch...); com o
# --disable-fhs, elas ficam direto no prefixo (mod/, fonts/, conf/...). Sem o --enable-optimization,
# que compila para o processador desta máquina: o pacote tem de rodar em qualquer amd64.
echo "freeswitch: compilando"
cp "$AQUI/modules.conf" "$TRABALHO/freeswitch/modules.conf"
cd "$TRABALHO/freeswitch"
./bootstrap.sh -j
./configure --prefix="$PREFIXO" --disable-fhs \
    PKG_CONFIG_PATH="$PREFIXO/lib/pkgconfig" LDFLAGS="-Wl,-rpath,$PREFIXO/lib"
make -j"$JOBS"
make install

# 4. O que o servidor não usa: os cabeçalhos e as bibliotecas estáticas; a configuração, as páginas,
# os sons e os scripts de exemplo (a configuração vem do starsonic-video configurar); as pastas das
# gravações e dos CDR (nada é gravado); e, no bin/, os programas que não são o freeswitch e o fs_cli
# (os outros do FreeSWITCH e os do sofia-sip).
rm -rf "$PREFIXO/include" "$PREFIXO/lib/pkgconfig" "$PREFIXO/conf" "$PREFIXO/htdocs" \
    "$PREFIXO/sounds" "$PREFIXO/grammar" "$PREFIXO/scripts" "$PREFIXO/recordings" "$PREFIXO/log/xml_cdr"
find "$PREFIXO" -type f \( -name '*.a' -o -name '*.la' \) -delete
find "$PREFIXO/bin" -mindepth 1 -maxdepth 1 ! -name freeswitch ! -name fs_cli -exec rm -rf {} +
LISTA_ELF="$(elfs)"
while IFS= read -r arquivo; do
    strip --strip-unneeded "$arquivo"
done <<<"$LISTA_ELF"

# 5. O pacotes.txt: os pacotes das bibliotecas de fora do prefixo que o ldd mostra, um por linha.
# Uma biblioteca que o ldd não acha para o build.
CAMINHOS="$(
    while IFS= read -r arquivo; do
        if ! saida="$(ldd "$arquivo" 2>&1)"; then
            # Um ELF estático não pede biblioteca nenhuma.
            if grep -q 'not a dynamic executable' <<<"$saida"; then
                continue
            fi
            echo "construir: o ldd não leu $arquivo: $saida" >&2
            exit 1
        fi
        if grep -q 'not found' <<<"$saida"; then
            echo "construir: o ldd de $arquivo não acha:" >&2
            grep 'not found' <<<"$saida" >&2
            exit 1
        fi
        # "libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x...)" ou "/lib64/ld-linux-x86-64.so.2 (0x...)";
        # o linux-vdso.so.1 não é arquivo.
        awk -v prefixo="$PREFIXO/" '{ caminho = ($2 == "=>") ? $3 : $1 }
            caminho ~ /^\// && index(caminho, prefixo) != 1 { print caminho }' <<<"$saida"
    done <<<"$LISTA_ELF" | sort -u
)"
PACOTES="$(
    while IFS= read -r caminho; do
        pacote_de "$caminho"
    done <<<"$CAMINHOS" | sort -u
)"
printf '%s\n' "$PACOTES" >"$PREFIXO/pacotes.txt"
echo "pacotes.txt:"
cat "$PREFIXO/pacotes.txt"

# 6. O VERSOES.txt e o pacote do sistema, com o SHA-256.
for projeto in freeswitch sofia-sip spandsp; do
    echo "$projeto $(lock_value "$projeto" tag) $(lock_value "$projeto" commit)"
done >"$PREFIXO/VERSOES.txt"
rm -f "$SAIDA/$PACOTE" "$SAIDA/$PACOTE.sha256"
tar --sort=name --owner=0 --group=0 --numeric-owner -czf "$SAIDA/$PACOTE" -C / "${PREFIXO#/}"
(cd "$SAIDA" && sha256sum "$PACOTE" >"$PACOTE.sha256")

# 7. As fontes: a MPL do FreeSWITCH e a LGPL do sofia-sip e do spandsp pedem o código junto com os
# binários. Cada projeto como está no commit, e o que diz como montar o pacote com eles.
pasta_fontes="$TRABALHO/pacote-das-fontes"
rm -rf "$pasta_fontes"
mkdir -p "$pasta_fontes"
for projeto in "${PROJETOS[@]}"; do
    git -C "$TRABALHO/$projeto" archive --format=tar --prefix="$projeto/" HEAD | tar -x -C "$pasta_fontes"
done
cp "$LOCK" "$AQUI/construir.sh" "$AQUI/modules.conf" "$AQUI/pacotes-de-build.txt" \
    "$AQUI/LEIA-ME-FONTES.txt" "$pasta_fontes/"
itens=(LEIA-ME-FONTES.txt deps.lock construir.sh modules.conf pacotes-de-build.txt "${PROJETOS[@]}")
if [ -d "$AQUI/patches" ]; then
    cp -R "$AQUI/patches" "$pasta_fontes/"
    itens+=(patches)
fi
rm -f "$SAIDA/$FONTES"
tar --sort=name --owner=0 --group=0 --numeric-owner -czf "$SAIDA/$FONTES" -C "$pasta_fontes" "${itens[@]}"
rm -rf "$pasta_fontes"

"$PREFIXO/bin/freeswitch" -version
echo "construir: $SAIDA/$PACOTE e $SAIDA/$FONTES"
