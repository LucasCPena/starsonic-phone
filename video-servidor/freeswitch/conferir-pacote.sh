#!/usr/bin/env bash
# Confere um pacote do FreeSWITCH (o starsonic-freeswitch-<sistema>-amd64.tar.gz do construir.sh)
# num contêiner limpo do mesmo sistema, como o instalador o usa: extrai o pacote no /, instala só os
# pacotes do apt do pacotes.txt dele e falha se
#   - o ldd de algum ELF do /opt/starsonic-freeswitch disser "not found";
#   - o freeswitch -version não mostrar a versão do video-servidor/deps.lock;
#   - as correções do VERSOES.txt dele não forem exatamente as da pasta patches/ ao lado deste script, pelo
#     nome e pelo SHA-256 de cada arquivo;
#   - a pasta mod/ não tiver exatamente os .so dos módulos do modules.conf;
#   - faltar a fonte do quadro (a reunião não escreve mais o nome no mosaico, mas a fonte continua no pacote).
#
# Uso: video-servidor/freeswitch/conferir-pacote.sh PACOTE
# Roda como root, num contêiner limpo (o job freeswitch-conferir do video.yml) ou numa máquina de
# build: ele escreve no /opt e instala pacotes. Não usa o file, o git nem o python3, que o contêiner
# limpo não tem.
set -euo pipefail
shopt -s inherit_errexit
export LC_ALL=C

if [ "$#" -ne 1 ]; then
    echo "uso: $0 PACOTE" >&2
    exit 2
fi

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIXO=/opt/starsonic-freeswitch
# A reunião não escreve mais o nome no mosaico (o agente não põe o video_banner_text: quem escreve os
# nomes é a página), mas a fonte continua no pacote. A fonte padrão do FreeSWITCH é a FreeSans.ttf da
# pasta fonts/ (src/switch_core_video.c).
FONTE="$PREFIXO/fonts/FreeSans.ttf"

falhar() {
    echo "conferir: $*" >&2
    exit 1
}

# As linhas "patch <projeto> <arquivo> <sha256>" do VERSOES.txt ($1) são exatamente as dos arquivos
# <projeto>/*.patch da pasta ($2). É a conta do linhas_das_correcoes do construir.sh, escrita aqui de novo de
# propósito: se uma mudar e a outra não, esta conferência falha em todo build.
conferir_correcoes() {
    local versoes="$1" pasta="$2" patch esperadas achadas
    esperadas="$(
        for patch in "$pasta"/*/*.patch; do
            [ -e "$patch" ] || continue
            echo "patch $(basename "$(dirname "$patch")") $(basename "$patch") $(sha256sum "$patch" | cut -d' ' -f1)"
        done | sort
    )"
    achadas="$( (grep '^patch ' "$versoes" || true) | sort)"
    if [ "$achadas" != "$esperadas" ]; then
        printf 'esperadas:\n%s\nno pacote:\n%s\n' "$esperadas" "$achadas" >&2
        falhar "as correções do pacote não são as da pasta patches/"
    fi
    if [ -z "$esperadas" ]; then
        echo "conferir: nenhuma correção na pasta patches/, e nenhuma no pacote"
    else
        echo "conferir: as correções do pacote são as da pasta patches/ ($(wc -l <<<"$esperadas"))"
    fi
}

# 1. O pacote no /, e os pacotes do apt da lista dele, só eles.
tar -xzf "$1" -C /
[ -s "$PREFIXO/pacotes.txt" ] || falhar "o pacote não tem o pacotes.txt"
apt-get update -q
DEBIAN_FRONTEND=noninteractive xargs -a "$PREFIXO/pacotes.txt" \
    apt-get install -y -q --no-install-recommends

# 2. Cada ELF acha as bibliotecas dele. Os ELF são achados pelos quatro primeiros bytes.
arquivos="$(find "$PREFIXO" -type f | sort)"
elfs=0
faltando=""
while IFS= read -r arquivo; do
    if [ "$(od -An -N4 -tx1 "$arquivo" | tr -d ' \n')" != 7f454c46 ]; then
        continue
    fi
    elfs=$((elfs + 1))
    if ! saida="$(ldd "$arquivo" 2>&1)"; then
        # Um ELF estático não pede biblioteca nenhuma.
        if grep -q 'not a dynamic executable' <<<"$saida"; then
            continue
        fi
        falhar "o ldd não leu $arquivo: $saida"
    fi
    if grep -q 'not found' <<<"$saida"; then
        faltando+="$arquivo:"$'\n'"$(grep 'not found' <<<"$saida")"$'\n'
    fi
done <<<"$arquivos"
if [ -n "$faltando" ]; then
    printf '%s' "$faltando" >&2
    falhar "faltam bibliotecas: o pacotes.txt não tem todos os pacotes"
fi
[ "$elfs" -gt 0 ] || falhar "o pacote não tem nenhum ELF"
echo "conferir: os $elfs ELF acham todas as bibliotecas"

# 3. A versão: a tag do FreeSWITCH no deps.lock, sem o "v" (o JSON é lido sem o python3).
versao="$(tr -d '\n' <"$AQUI/../deps.lock" |
    sed -n 's/.*"freeswitch": *{[^}]*"tag": *"v\([^"]*\)".*/\1/p')"
[ -n "$versao" ] || falhar "não achei a tag do freeswitch no deps.lock"
mostrada="$("$PREFIXO/bin/freeswitch" -version)"
echo "$mostrada"
case "$mostrada" in
    *"FreeSWITCH version: $versao-"*) ;;
    *) falhar "o freeswitch -version não mostra a $versao" ;;
esac

# 4. As correções: as que o pacote diz que leva são as da pasta patches/.
[ -s "$PREFIXO/VERSOES.txt" ] || falhar "o pacote não tem o VERSOES.txt"
conferir_correcoes "$PREFIXO/VERSOES.txt" "$AQUI/patches"

# 5. Os módulos: os .so da pasta mod/ são exatamente os do modules.conf.
[ -d "$PREFIXO/mod" ] || falhar "o pacote não tem a pasta mod/"
esperados="$(sed 's|.*/||; s|$|.so|' "$AQUI/modules.conf" | sort)"
achados="$(find "$PREFIXO/mod" -maxdepth 1 -name '*.so' -printf '%f\n' | sort)"
if [ "$achados" != "$esperados" ]; then
    printf 'esperados:\n%s\nno pacote:\n%s\n' "$esperados" "$achados" >&2
    falhar "a pasta mod/ não tem exatamente os módulos do modules.conf"
fi
echo "conferir: os $(wc -l <<<"$achados") módulos do modules.conf"

# 6. A fonte do quadro.
[ -s "$FONTE" ] || falhar "o pacote não tem a fonte do nome no quadro ($FONTE)"
echo "conferir: o pacote está completo"
