#!/usr/bin/env bash
# Confere a configuração que o starsonic-video configurar --teste gera num FreeSWITCH de verdade, o de
# um pacote do construir.sh (o starsonic-freeswitch-<sistema>-amd64.tar.gz), num contêiner limpo do
# mesmo sistema:
#   - instala o pacote como o conferir-pacote.sh: extrai no / e instala só os pacotes do pacotes.txt;
#   - escreve um config.json de teste, com o IP desta máquina, e roda o configurar --teste;
#   - sobe o FreeSWITCH com as pastas como as da unidade do systemd, com a saída num arquivo, e espera
#     o ESL por até 30 segundos;
#   - confere, pelo fs_cli, que os perfis navegador e tls estão RUNNING e que o mod_conference carregou;
#   - desliga o FreeSWITCH e falha se a saída dele tiver uma linha [ERR], [CRIT] ou [ALERT], menos as
#     seis que ele escreve a cada partida com a base interna nova (o passo 6).
#
# Uso: video-servidor/freeswitch/conferir-configuracao.sh STARSONIC-VIDEO PACOTE
#   STARSONIC-VIDEO  o programa do agente (o artefato starsonic-video-linux-amd64)
#   PACOTE           o pacote do FreeSWITCH deste sistema
# Roda como root, num contêiner limpo (o job freeswitch-configuracao do video.yml) ou numa máquina de
# build: ele escreve no /opt e instala pacotes. Usa as portas 5061, 5066, 5070, 5080 e 8021 e a faixa
# da mídia, e desliga o FreeSWITCH no fim, também quando falha.
set -euo pipefail
shopt -s inherit_errexit
export LC_ALL=C

if [ "$#" -ne 2 ]; then
    echo "uso: $0 STARSONIC-VIDEO PACOTE" >&2
    exit 2
fi

AGENTE="$(realpath "$1")"
PACOTE="$(realpath "$2")"
PREFIXO=/opt/starsonic-freeswitch

falhar() {
    echo "conferir: $*" >&2
    exit 1
}

TRABALHO="$(mktemp -d)"
SAIDA_FS="$TRABALHO/freeswitch.log"
FS_PID=""

# No fim, também numa falha: desliga o FreeSWITCH que ficou de pé, mostra a saída dele quando algo
# falhou e apaga a pasta de trabalho.
no_fim() {
    local codigo=$?
    if [ -n "$FS_PID" ] && kill -0 "$FS_PID" 2>/dev/null; then
        kill -TERM "$FS_PID" 2>/dev/null || true
        for _ in $(seq 1 20); do
            kill -0 "$FS_PID" 2>/dev/null || break
            sleep 1
        done
        kill -KILL "$FS_PID" 2>/dev/null || true
        wait "$FS_PID" 2>/dev/null || true
    fi
    if [ "$codigo" -ne 0 ] && [ -s "$SAIDA_FS" ]; then
        echo "--- a saída do FreeSWITCH ---" >&2
        cat "$SAIDA_FS" >&2
        echo "---" >&2
    fi
    rm -rf "$TRABALHO"
}
trap no_fim EXIT

# 1. O pacote no /, e os pacotes do apt da lista dele, só eles.
tar -xzf "$PACOTE" -C /
[ -s "$PREFIXO/pacotes.txt" ] || falhar "o pacote não tem o pacotes.txt"
apt-get update -q
DEBIAN_FRONTEND=noninteractive xargs -a "$PREFIXO/pacotes.txt" \
    apt-get install -y -q --no-install-recommends

# 2. A configuração de teste. O primeiro IPv4 desta máquina é o IP privado e o público, e a senha do
# ESL é sorteada (32 caracteres hexadecimais).
IP=""
for endereco in $(hostname -I); do
    if [[ "$endereco" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        IP="$endereco"
        break
    fi
done
[ -n "$IP" ] || falhar "esta máquina não tem um IPv4 (hostname -I: $(hostname -I))"
SENHA="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
CHAVE="$("$AGENTE" chave)"
cat >"$TRABALHO/config.json" <<FIM
{"endereco": "video.exemplo.com.br", "chat": "chat.exemplo.com.br", "chave": "$CHAVE",
 "senhaEsl": "$SENHA", "ipPrivado": "$IP", "ipPublico": "$IP"}
FIM
"$AGENTE" configurar --config "$TRABALHO/config.json" --saida "$TRABALHO/etc" --teste
echo "conferir: o configurar --teste escreveu a configuração, com o IP $IP"

# 3. O FreeSWITCH, com as pastas como as da unidade do systemd: o -log, o -db, o -run e o -temp juntos
# (lá, o /run/starsonic-freeswitch), e o certificado da 5061 na pasta tls/ da configuração.
CONF="$TRABALHO/etc/freeswitch"
RUN="$TRABALHO/run"
mkdir -p "$RUN"
"$PREFIXO/bin/freeswitch" -c -nonat -conf "$CONF" -log "$RUN" -db "$RUN" -run "$RUN" -temp "$RUN" \
    -certs "$CONF/tls" </dev/null >"$SAIDA_FS" 2>&1 &
FS_PID=$!

fs_cli() {
    "$PREFIXO/bin/fs_cli" -H 127.0.0.1 -P 8021 -p "$SENHA" -T 2000 -t 10000 -x "$1"
}

limite=$((SECONDS + 30))
until fs_cli status >/dev/null 2>&1; do
    kill -0 "$FS_PID" 2>/dev/null || falhar "o FreeSWITCH saiu antes de o ESL responder"
    [ "$SECONDS" -lt "$limite" ] || falhar "o ESL não respondeu em 30 segundos"
    sleep 1
done
echo "conferir: o ESL respondeu"

# 4. Os dois perfis do sofia, numa linha como "tls  profile  sip:mod_sofia@<IP>:5061  RUNNING (0) (TLS)".
# Um perfil pode levar um instante para subir depois do ESL.
perfil_no_ar() {
    awk -v perfil="$1" '$1 == perfil && $2 == "profile" && $4 == "RUNNING" { achou = 1 } END { exit !achou }' <<<"$2"
}
limite=$((SECONDS + 10))
while :; do
    status="$(fs_cli 'sofia status')"
    if perfil_no_ar navegador "$status" && perfil_no_ar tls "$status"; then
        break
    fi
    if [ "$SECONDS" -ge "$limite" ]; then
        echo "$status" >&2
        falhar "os perfis navegador e tls não estão os dois RUNNING"
    fi
    sleep 1
done
echo "$status"
[ "$(fs_cli 'module_exists mod_conference' | tr -d '[:space:]')" = true ] || falhar "o mod_conference não carregou"
echo "conferir: os perfis navegador e tls estão RUNNING, e o mod_conference carregou"

# 5. Desliga, e espera o FreeSWITCH sair.
fs_cli shutdown >/dev/null 2>&1 || true
limite=$((SECONDS + 30))
while kill -0 "$FS_PID" 2>/dev/null; do
    [ "$SECONDS" -lt "$limite" ] || falhar "o FreeSWITCH não desligou em 30 segundos"
    sleep 1
done
saiu=0
wait "$FS_PID" || saiu=$?
FS_PID=""
[ "$saiu" -eq 0 ] || falhar "o FreeSWITCH saiu com o código $saiu"
echo "conferir: o FreeSWITCH desligou"

# 6. A saída dele. Sem o mapa "all" do console.conf, o mod_console não escreve nada, e a conferência
# dos erros não veria nada: a linha do último módulo carregado mostra que ele escreveu.
grep -q 'Successfully Loaded \[mod_opus\]' "$SAIDA_FS" || falhar "o mod_console não escreveu na saída do FreeSWITCH"
# Só estas seis linhas de erro não contam: o FreeSWITCH as escreve a cada partida com a base interna nova
# (o -db no /run). Com a base interna, o switch_core_sqldb_start (src/switch_core_sqldb.c) apaga as
# tabelas channels, calls, interfaces e tasks e as vistas detailed_calls e basic_calls da partida
# anterior sem conferir se existem, e cada uma que falta sai no nível ERROR, com o "drop ..." na linha
# seguinte, que não tem nível. Qualquer outra linha [ERR], [CRIT] ou [ALERT] falha.
ESPERADAS='\[ERR\] switch_core_sqldb\.c:[0-9]+ \[db="core",type="core_db"\] NATIVE SQL ERR \[no such (table: (channels|calls|interfaces|tasks)|view: (detailed_calls|basic_calls))\]$'
if grep -E '\[(ERR|CRIT|ALERT)\]' "$SAIDA_FS" | grep -Ev "$ESPERADAS" >&2; then
    falhar "o FreeSWITCH escreveu as linhas de erro acima"
fi
echo "conferir: os avisos do FreeSWITCH:"
grep -F '[WARNING]' "$SAIDA_FS" || true
echo "conferir: a configuração está certa"
