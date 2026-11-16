#!/usr/bin/env bash
# Testa o instalar.sh e o certificado.sh: as conferências, o config.json, os donos e os modos da configuração,
# o coturn, o gancho do certificado numa raiz de mentira, a recusa do atualizar com reuniões acontecendo e a
# troca do endereço do chat. Não instala nada, não usa a rede nem o root.
# Rode: bash video-servidor/deploy/instalar-teste.sh
#
# Os stubs (chown, systemctl, getent, ip, sleep, ...) são chamados pelas funções do instalar.sh, e não
# daqui: o shellcheck não vê.
# shellcheck disable=SC2317,SC2329
set -euo pipefail

aqui=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=./instalar.sh
# shellcheck disable=SC1091
. "$aqui/instalar.sh"

falhas=0
confere() { # confere <nome> <esperado> <recebido>
  if [ "$2" = "$3" ]; then
    echo "ok   $1"
  else
    echo "ERRO $1: esperava [$2], veio [$3]"
    falhas=$((falhas + 1))
  fi
}

# aceita <função> <valor>: "sim" se a função aceita o valor, "não" se ela para com erro.
aceita() {
  if ("$1" "$2") 2>/dev/null; then echo sim; else echo não; fi
}

# modo <caminho>: as permissões, como 640.
modo() { stat -c %a "$1"; }

# Tudo o que o teste escreve fica nesta pasta, e todo caminho do instalar.sh aponta para dentro dela: nenhuma
# função chega ao sistema, nem por engano.
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
# Alguns só as funções do instalar.sh leem, e o shellcheck não vê.
# shellcheck disable=SC2034
{
  CONFIG_DIR=$T/etc/starsonic-video
  BINARIO=$T/usr/local/bin/starsonic-video
  FREESWITCH=$T/opt/starsonic-freeswitch
  UNIDADES=$T/etc/systemd/system
  GANCHO=$T/etc/letsencrypt/renewal-hooks/deploy/starsonic-video
  LETSENCRYPT=$T/etc/letsencrypt
  TURN_CONF=$T/etc/turnserver.conf
  OS_RELEASE=$T/os-release-que-nao-existe
  TMP=$T/tmp
}
mkdir -p "$TMP"

# Estes comandos, chamados sem um cenário que os espere, falham com o nome deles.
inesperado() { echo "chamada inesperada: $*" >&2; return 99; }
apt-get() { inesperado apt-get "$@"; }
certbot() { inesperado certbot "$@"; }
curl() { inesperado curl "$@"; }
journalctl() { inesperado journalctl "$@"; }
systemctl() { inesperado systemctl "$@"; }
useradd() { inesperado useradd "$@"; }

# O chown de mentira anota "<dono> <caminho>", com o caminho sem a pasta do teste: o teste não roda como root.
DONOS=$T/donos
chown() {
  local dono=$1 caminho
  shift
  for caminho in "$@"; do
    echo "$dono ${caminho#"$T"/}" >>"$DONOS"
  done
}
# dono_de <caminho sem a pasta do teste>: o último dono pedido para o caminho.
dono_de() { awk -v c="$1" '$2 == c { d = $1 } END { print d }' "$DONOS"; }

# --- o endereço do servidor de vídeo: os casos do conferir_endereco do chat ---
for e in video.exemplo.com.br video.starcloud-starsonic.com.br a.b 123.exemplo.com.br; do
  confere "endereço $e" sim "$(aceita conferir_endereco "$e")"
done
# Um número de IP, um nome sem ponto, com porta, com https, com maiúsculas, vazio.
for e in 189.0.2.10 10.0.0.1.2 video video.exemplo.com.br:8443 https://video.exemplo.com.br Video.Exemplo.com.br ""; do
  confere "endereço [$e]" não "$(aceita conferir_endereco "$e")"
done

# --- o endereço do chat: um nome, com a porta só quando o chat usa uma própria ---
for c in chat.exemplo.com.br chat.exemplo.com.br:8443 chat.exemplo.com.br:1 chat.exemplo.com.br:65535; do
  confere "chat $c" sim "$(aceita conferir_chat "$c")"
done
# Com https, sem ponto, com caminho, a 443 (a normal, sem porta), a 80 (a do certificado), portas fora da faixa ou
# com zero na frente, um IP, maiúsculas, vazio.
for c in https://chat.exemplo.com.br chat chat.exemplo.com.br/x chat.exemplo.com.br:443 chat.exemplo.com.br:80 \
  chat.exemplo.com.br:0 chat.exemplo.com.br:65536 chat.exemplo.com.br:08443 chat.exemplo.com.br: \
  chat.exemplo.com.br:8443:1 189.0.2.10 189.0.2.10:8443 Chat.Exemplo.com.br ""; do
  confere "chat [$c]" não "$(aceita conferir_chat "$c")"
done

# --- o sistema, com arquivos os-release de mentira ---
os_release() { # os_release <nome do arquivo> <linhas>...
  local arquivo=$T/$1
  shift
  printf '%s\n' "$@" >"$arquivo"
  echo "$arquivo"
}
ubuntu24=$(os_release ubuntu-24 'PRETTY_NAME="Ubuntu 24.04.1 LTS"' 'NAME="Ubuntu"' 'VERSION_ID="24.04"' \
  'VERSION="24.04.1 LTS (Noble Numbat)"' 'ID=ubuntu' 'ID_LIKE=debian')
debian12=$(os_release debian-12 'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"' 'NAME="Debian GNU/Linux"' \
  'VERSION_ID="12"' 'VERSION="12 (bookworm)"' 'ID=debian')
ubuntu22=$(os_release ubuntu-22 'PRETTY_NAME="Ubuntu 22.04.4 LTS"' 'VERSION_ID="22.04"' 'ID=ubuntu' 'ID_LIKE=debian')
debian13=$(os_release debian-13 'PRETTY_NAME="Debian GNU/Linux 13 (trixie)"' 'VERSION_ID="13"' 'ID=debian')
fedora=$(os_release fedora 'PRETTY_NAME="Fedora Linux 40 (Server Edition)"' 'VERSION_ID=40' 'ID=fedora')
confere "sistema Ubuntu 24.04" ubuntu-24.04 "$(sistema_da_maquina "$ubuntu24")"
confere "sistema Debian 12" debian-12 "$(sistema_da_maquina "$debian12")"
for f in "$ubuntu22" "$debian13" "$fedora" "$T/nao-existe"; do
  confere "sistema $(basename "$f") para" não "$(aceita sistema_da_maquina "$f")"
done
confere "o erro diz o nome do sistema" \
  "ERRO: o sistema desta máquina é Ubuntu 22.04.4 LTS. Precisa ser Ubuntu 24.04 ou Debian 12." \
  "$( (sistema_da_maquina "$ubuntu22") 2>&1)"

# --- os dois IPs, com o ip e o getent de mentira ---
confere "IP privado" 10.0.0.5 "$(
  ip() { [ "$*" = "-4 route get 1.1.1.1" ] && printf '1.1.1.1 via 10.0.0.1 dev eth0 src 10.0.0.5 uid 0 \n    cache \n'; }
  ip_privado
)"
confere "IP privado sem rota" não "$(
  ip() { echo "RTNETLINK answers: Network is unreachable" >&2; return 2; }
  aceita ip_privado x
)"
# O getent responde como o de verdade: uma linha por tipo de socket, o primeiro A antes.
getent_de_mentira() {
  [ "$1" = ahostsv4 ] || return 9
  case "$2" in
    video.exemplo.com.br) printf '203.0.113.10    STREAM video.exemplo.com.br\n203.0.113.10    DGRAM  \n203.0.113.10    RAW    \n203.0.113.20    STREAM \n' ;;
    interno.exemplo.com.br) printf '10.0.0.5        STREAM interno.exemplo.com.br\n' ;;
    hosts.exemplo.com.br) printf '127.0.1.1       STREAM hosts.exemplo.com.br\n' ;;
    cgnat.exemplo.com.br) printf '100.72.0.9      STREAM cgnat.exemplo.com.br\n' ;;
    *) return 2 ;;
  esac
}
confere "IP público" 203.0.113.10 "$(
  getent() { getent_de_mentira "$@"; }
  ip_publico video.exemplo.com.br
)"
confere "sem o registro A" \
  "ERRO: o endereço nada.exemplo.com.br ainda não aponta para nenhum IP no DNS. Crie o registro A e espere alguns minutos." \
  "$( (
    getent() { getent_de_mentira "$@"; }
    ip_publico nada.exemplo.com.br
  ) 2>&1)"
for e in interno hosts cgnat; do
  confere "IP público que não é da internet ($e)" não "$(
    getent() { getent_de_mentira "$@"; }
    aceita ip_publico "$e.exemplo.com.br"
  )"
done
for ip in 10.1.2.3 172.16.0.1 172.31.255.255 192.168.0.10 100.64.0.1 100.127.255.255 127.0.0.1 169.254.169.254 0.0.0.0; do
  confere "IP $ip é reservado" sim "$(if ip_reservado "$ip"; then echo sim; else echo não; fi)"
done
for ip in 203.0.113.10 172.15.255.255 172.32.0.1 100.63.255.255 100.128.0.1 192.169.0.1 8.8.8.8; do
  confere "IP $ip é da internet" não "$(if ip_reservado "$ip"; then echo sim; else echo não; fi)"
done

# --- a senha do ESL: 32 letras e números ---
s1=$(senha_esl)
s2=$(senha_esl)
confere "senha do ESL com 32 letras e números" sim "$(if [[ "$s1" =~ ^[A-Za-z0-9]{32}$ ]]; then echo sim; else echo não; fi)"
confere "duas senhas do ESL diferentes" sim "$(if [ "$s1" != "$s2" ]; then echo sim; else echo não; fi)"

# --- o config.json: os seis campos, root:starsonic-video e 0640 ---
chave_teste=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8
mkdir -p "$CONFIG_DIR"
escrever_config video.exemplo.com.br chat.exemplo.com.br:8443 "$chave_teste" "$s1" 10.0.0.5 203.0.113.10
confere "config.json" \
  "{\"endereco\": \"video.exemplo.com.br\", \"chat\": \"chat.exemplo.com.br:8443\", \"chave\": \"$chave_teste\", \"senhaEsl\": \"$s1\", \"ipPrivado\": \"10.0.0.5\", \"ipPublico\": \"203.0.113.10\"}" \
  "$(cat "$CONFIG_DIR/config.json")"
confere "config.json é JSON" sim "$(python3 -I -c 'import json,sys; json.load(open(sys.argv[1])); print("sim")' "$CONFIG_DIR/config.json")"
confere "config.json 0640" 640 "$(modo "$CONFIG_DIR/config.json")"
confere "config.json do grupo do agente, antes de tomar o lugar" root:starsonic-video "$(dono_de etc/starsonic-video/config.json.novo)"
confere "nenhum config.json.novo sobrou" não "$(if [ -e "$CONFIG_DIR/config.json.novo" ]; then echo sim; else echo não; fi)"
confere "o campo endereco" video.exemplo.com.br "$(ler_campo endereco)"
confere "o campo chat" chat.exemplo.com.br:8443 "$(ler_campo chat)"

# --- os donos e os modos depois do configurar (M-8), e os dois pares do FreeSWITCH ---
# A pasta como o configurar a deixa: tudo do root, a pasta tls/ do FreeSWITCH com 0750. Os modos de começo são
# outros, para o teste ver que o acertar_donos os põe.
fs=$CONFIG_DIR/freeswitch
mkdir -p "$fs/tls"
chmod 0700 "$CONFIG_DIR"
chmod 0750 "$fs" "$fs/tls"
echo '<document/>' >"$fs/freeswitch.xml"
chmod 0640 "$fs/freeswitch.xml"
echo png >"$fs/sem-camera.png"
chmod 0600 "$fs/sem-camera.png"
echo turn >"$CONFIG_DIR/turnserver.conf"
chmod 0640 "$CONFIG_DIR/turnserver.conf"
chmod 0600 "$CONFIG_DIR/config.json"
# Um wss.pem que já existe fica como está; o dtls-srtp.pem, que falta, é feito.
echo antigo >"$fs/tls/wss.pem"
chmod 0644 "$fs/tls/wss.pem"
: >"$DONOS"
certificados_proprios
acertar_donos
confere "/etc/starsonic-video 0755" 755 "$(modo "$CONFIG_DIR")"
confere "/etc/starsonic-video root:root" root:root "$(dono_de etc/starsonic-video)"
confere "tls/ 0755" 755 "$(modo "$CONFIG_DIR/tls")"
confere "tls/ root:root" root:root "$(dono_de etc/starsonic-video/tls)"
confere "config.json 0640 de novo" 640 "$(modo "$CONFIG_DIR/config.json")"
confere "config.json root:starsonic-video" root:starsonic-video "$(dono_de etc/starsonic-video/config.json)"
confere "turnserver.conf do configurar 0640" 640 "$(modo "$CONFIG_DIR/turnserver.conf")"
confere "turnserver.conf do configurar root:root" root:root "$(dono_de etc/starsonic-video/turnserver.conf)"
confere "freeswitch/ 0750" 750 "$(modo "$fs")"
confere "freeswitch/ root:starsonic-freeswitch" root:starsonic-freeswitch "$(dono_de etc/starsonic-video/freeswitch)"
confere "freeswitch.xml 0640" 640 "$(modo "$fs/freeswitch.xml")"
confere "freeswitch.xml root:starsonic-freeswitch" root:starsonic-freeswitch "$(dono_de etc/starsonic-video/freeswitch/freeswitch.xml)"
confere "sem-camera.png 0644" 644 "$(modo "$fs/sem-camera.png")"
confere "sem-camera.png root:root" root:root "$(dono_de etc/starsonic-video/freeswitch/sem-camera.png)"
confere "freeswitch/tls/ 0700" 700 "$(modo "$fs/tls")"
confere "freeswitch/tls/ do FreeSWITCH" starsonic-freeswitch:starsonic-freeswitch "$(dono_de etc/starsonic-video/freeswitch/tls)"
for par in dtls-srtp.pem wss.pem; do
  confere "$par 0600" 600 "$(modo "$fs/tls/$par")"
  confere "$par do FreeSWITCH" starsonic-freeswitch:starsonic-freeswitch "$(dono_de "etc/starsonic-video/freeswitch/tls/$par")"
done
confere "wss.pem que já existia não mudou" antigo "$(cat "$fs/tls/wss.pem")"
confere "dtls-srtp.pem: o certificado é o do starsonic-video" "subject=CN=starsonic-video" \
  "$(openssl x509 -noout -subject <"$fs/tls/dtls-srtp.pem" 2>&1 | sed 's/ //g')"
confere "dtls-srtp.pem: a chave RSA de 2048 bits, no mesmo arquivo" 2048 \
  "$(openssl pkey -in "$fs/tls/dtls-srtp.pem" -noout -text 2>/dev/null | sed -n 's/.*Private-Key: (\([0-9]*\) bit.*/\1/p')"
confere "dtls-srtp.pem: a chave é a do certificado" sim "$(
  a=$(openssl pkey -in "$fs/tls/dtls-srtp.pem" -pubout 2>/dev/null)
  b=$(openssl x509 -in "$fs/tls/dtls-srtp.pem" -noout -pubkey 2>/dev/null)
  if [ -n "$a" ] && [ "$a" = "$b" ]; then echo sim; else echo não; fi
)"
antes=$(sha256sum "$fs/tls/dtls-srtp.pem")
certificados_proprios
confere "o dtls-srtp.pem só é feito uma vez" "$antes" "$(sha256sum "$fs/tls/dtls-srtp.pem")"
confere "nenhuma pasta de preparo sobrou" "" "$(find "$CONFIG_DIR" -maxdepth 1 -name '.*' -printf '%f\n')"

# --- o turnserver.conf do coturn: o nosso no lugar, e o original guardado uma vez ---
echo "# o do pacote" >"$TURN_CONF"
echo "# o nosso" >"$CONFIG_DIR/turnserver.conf"
: >"$DONOS"
instalar_turn
confere "turnserver.conf é o nosso" "# o nosso" "$(cat "$TURN_CONF")"
confere "turnserver.conf 0640" 640 "$(modo "$TURN_CONF")"
confere "turnserver.conf root:turnserver" root:turnserver "$(dono_de etc/turnserver.conf.novo)"
confere "o original guardado" "# o do pacote" "$(cat "$TURN_CONF.original")"
echo "# o nosso, de novo" >"$CONFIG_DIR/turnserver.conf"
instalar_turn
confere "o original guardado só uma vez" "# o do pacote" "$(cat "$TURN_CONF.original")"
confere "turnserver.conf trocado de novo" "# o nosso, de novo" "$(cat "$TURN_CONF")"

# --- o certificado.sh numa RAIZ de mentira, com um lineage de mentira ---
# O chown e o systemctl de mentira ficam no PATH: o certificado.sh roda como o certbot o roda, noutro processo.
falsos=$T/falsos
mkdir -p "$falsos"
cat >"$falsos/chown" <<'FIM'
#!/usr/bin/env bash
dono=$1
shift
for caminho in "$@"; do echo "$dono $(basename "$caminho")"; done >>"$T_DONOS"
FIM
cat >"$falsos/systemctl" <<'FIM'
#!/usr/bin/env bash
if [ "$1" = is-active ]; then
  case " $T_ATIVOS " in *" ${!#} "*) exit 0 ;; *) exit 3 ;; esac
fi
echo "$*" >>"$T_SYSTEMCTL"
if [ "$1" = reload ] && [ -n "${T_RELOAD_FALHA:-}" ]; then exit 1; fi
exit 0
FIM
chmod +x "$falsos/chown" "$falsos/systemctl"

# cenario_gancho <nome> <serviços ativos> [sem-lineage | sem-chain | reload-falha]: roda o certificado.sh numa
# raiz nova e escreve "<código de saída>|<recargas pedidas>".
cenario_gancho() {
  local raiz=$T/gancho-$1 jeito=${3:-} lineage codigo=0
  lineage=$raiz/etc/letsencrypt/live/video.exemplo.com.br
  mkdir -p "$lineage" "$raiz/etc/starsonic-video/tls" "$raiz/etc/starsonic-video/freeswitch/tls"
  printf 'CERTIFICADO\nINTERMEDIARIO\n' >"$lineage/fullchain.pem"
  printf 'CHAVE\n' >"$lineage/privkey.pem"
  printf 'INTERMEDIARIO\n' >"$lineage/chain.pem"
  if [ "$jeito" = sem-chain ]; then rm "$lineage/chain.pem"; fi
  if [ "$jeito" = sem-lineage ]; then lineage=""; fi
  : >"$raiz/donos"
  : >"$raiz/systemctl"
  local ambiente=(PATH="$falsos:$PATH" RAIZ="$raiz" T_DONOS="$raiz/donos" T_SYSTEMCTL="$raiz/systemctl" T_ATIVOS="$2")
  if [ -n "$lineage" ]; then ambiente+=(RENEWED_LINEAGE="$lineage"); fi
  if [ "$jeito" = reload-falha ]; then ambiente+=(T_RELOAD_FALHA=1); fi
  env -u RENEWED_LINEAGE -u T_RELOAD_FALHA "${ambiente[@]}" bash "$aqui/certificado.sh" >"$raiz/saida" 2>&1 || codigo=$?
  echo "$codigo|$(paste -sd ';' "$raiz/systemctl")"
}

recargas="reload starsonic-video;kill --signal=SIGUSR2 --kill-whom=main coturn"
confere "gancho com os dois serviços no ar" "0|$recargas" "$(cenario_gancho ativos 'starsonic-video coturn')"
r=$T/gancho-ativos/etc/starsonic-video
confere "o certificado do agente é o fullchain" "$(printf 'CERTIFICADO\nINTERMEDIARIO')" "$(cat "$r/tls/certificado.pem")"
confere "a chave do agente é o privkey" CHAVE "$(cat "$r/tls/chave.pem")"
confere "o certificado do coturn é o fullchain" "$(printf 'CERTIFICADO\nINTERMEDIARIO')" "$(cat "$r/tls/turn-certificado.pem")"
confere "a chave do coturn é o privkey" CHAVE "$(cat "$r/tls/turn-chave.pem")"
confere "o agent.pem é o privkey e o fullchain" "$(printf 'CHAVE\nCERTIFICADO\nINTERMEDIARIO')" "$(cat "$r/freeswitch/tls/agent.pem")"
confere "o cafile.pem é o chain" INTERMEDIARIO "$(cat "$r/freeswitch/tls/cafile.pem")"
for par in "tls/certificado.pem 644 root:root" "tls/chave.pem 640 root:starsonic-video" \
  "tls/turn-certificado.pem 640 root:turnserver" "tls/turn-chave.pem 640 root:turnserver" \
  "freeswitch/tls/agent.pem 600 starsonic-freeswitch:starsonic-freeswitch" "freeswitch/tls/cafile.pem 644 root:root"; do
  read -r arquivo esperado dono <<<"$par"
  confere "$arquivo $esperado" "$esperado" "$(modo "$r/$arquivo")"
  confere "$arquivo $dono" "$dono" "$(awk -v n="$(basename "$arquivo")" '$2 == n { d = $1 } END { print d }' "$T/gancho-ativos/donos")"
done
confere "nenhuma pasta de preparo sobrou do gancho" "" "$(find "$r" -maxdepth 1 -name '.*' -printf '%f\n')"
confere "gancho com os serviços parados não recarrega nada" "0|" "$(cenario_gancho parados '')"
confere "os arquivos saem também com os serviços parados" CHAVE "$(cat "$T/gancho-parados/etc/starsonic-video/tls/chave.pem")"
confere "gancho só com o coturn no ar" "0|kill --signal=SIGUSR2 --kill-whom=main coturn" "$(cenario_gancho so-coturn coturn)"
confere "uma recarga que falha não impede a outra" "1|$recargas" "$(cenario_gancho reload-falha 'starsonic-video coturn' reload-falha)"
confere "sem o RENEWED_LINEAGE, para" "1|" "$(cenario_gancho sem-lineage 'starsonic-video coturn' sem-lineage)"
confere "sem o RENEWED_LINEAGE, nada é escrito" "" "$(find "$T/gancho-sem-lineage/etc/starsonic-video" -type f)"
confere "sem o RENEWED_LINEAGE, o erro diz o que falta" sim \
  "$(if grep -q RENEWED_LINEAGE "$T/gancho-sem-lineage/saida"; then echo sim; else echo não; fi)"
confere "um lineage sem o chain.pem para" "1|" "$(cenario_gancho sem-chain 'starsonic-video coturn' sem-chain)"
confere "um lineage sem o chain.pem não escreve nada" "" "$(find "$T/gancho-sem-chain/etc/starsonic-video" -type f)"

# --- a pasta como a instalação a deixa, para o atualizar e o chat ---
# instalado <pasta>: o programa de mentira, a unidade e o config.json, como depois de uma instalação.
instalado() {
  local raiz=$1
  CONFIG_DIR=$raiz/etc/starsonic-video
  BINARIO=$raiz/usr/local/bin/starsonic-video
  UNIDADES=$raiz/etc/systemd/system
  FREESWITCH=$raiz/opt/starsonic-freeswitch
  TMP=$raiz/tmp
  mkdir -p "$CONFIG_DIR" "$(dirname "$BINARIO")" "$UNIDADES" "$FREESWITCH" "$TMP"
  : >"$UNIDADES/starsonic-video.service"
  # O programa de mentira responde o reunioes com o T_N e o T_CODIGO, como o de verdade: o número na saída, ou
  # um erro e o código 1.
  cat >"$BINARIO" <<'FIM'
#!/usr/bin/env bash
case "$1" in
  reunioes)
    if [ "$T_CODIGO" = 0 ]; then echo "$T_N"; else echo "Erro: o agente não respondeu" >&2; fi
    exit "$T_CODIGO"
    ;;
  versao) echo 0.2.0 ;;
  *) exit 9 ;;
esac
FIM
  chmod +x "$BINARIO"
  DONOS=$raiz/donos
  : >"$DONOS"
  escrever_config video.exemplo.com.br chat.exemplo.com.br "$chave_teste" "$s1" 10.0.0.5 203.0.113.10
}

# --- o atualizar com reuniões acontecendo, com o starsonic-video reunioes de mentira ---
# cenario_atualizar <nome> <reuniões> <código do reunioes> [--agora]: "<código de saída>|<passos>|<saída>". Os
# nomes que os stubs leem começam com t_, para não esbarrar nos "local" do instalar.sh.
cenario_atualizar() {
  local t_nome=$1 t_agora=0
  [ "${4:-}" != --agora ] || t_agora=1
  (
    t_raiz=$T/atualizar-$t_nome
    instalado "$t_raiz"
    export T_N=$2 T_CODIGO=$3
    t_passos=$t_raiz/passos
    : >"$t_passos"
    conferir_maquina() { :; }
    sistema_da_maquina() { echo ubuntu-24.04; }
    baixar_tudo() { echo baixar >>"$t_passos"; }
    # Como o de verdade, deixa o FreeSWITCH antigo ao lado, para o atualizar apagar no fim.
    trocar_freeswitch() {
      echo trocar_freeswitch >>"$t_passos"
      mkdir -p "$FREESWITCH.antigo"
    }
    instalar_programa() { echo instalar_programa >>"$t_passos"; }
    instalar_unidades() { echo instalar_unidades >>"$t_passos"; }
    instalar_gancho() { echo instalar_gancho >>"$t_passos"; }
    configurar_tudo() { echo configurar_tudo >>"$t_passos"; }
    rodar_gancho() { echo "rodar_gancho $1" >>"$t_passos"; }
    systemctl() { echo "systemctl $*" >>"$t_passos"; }
    reiniciar_servicos() { echo reiniciar_servicos >>"$t_passos"; }
    local t_codigo=0
    set +e
    (set -e; atualizar "$t_agora") >"$t_raiz/saida" 2>&1
    t_codigo=$?
    set -e
    echo "$t_codigo|$(paste -sd ';' "$t_passos")|$(cat "$t_raiz/saida")"
  )
}
recusa="ERRO: Há 1 reunião(ões) acontecendo agora. Atualize quando elas acabarem, ou rode de novo com --agora, que as encerra."
confere "atualizar com 1 reunião para, e nada muda" "1|baixar|$recusa" "$(cenario_atualizar uma 1 0)"
tudo="baixar;trocar_freeswitch;instalar_programa;instalar_unidades;instalar_gancho;configurar_tudo"
tudo+=";rodar_gancho video.exemplo.com.br;systemctl --quiet unmask coturn.service"
tudo+=";systemctl --quiet enable starsonic-freeswitch.service starsonic-video.service coturn.service;reiniciar_servicos"
pronto="Trocando o FreeSWITCH, o agente e a configuração...
Pronto: o servidor de vídeo agora está na versão 0.2.0."
confere "atualizar com 1 reunião e o --agora segue" "0|$tudo|$pronto" "$(cenario_atualizar agora 1 0 --agora)"
confere "atualizar sem reunião segue" "0|$tudo|$pronto" "$(cenario_atualizar nenhuma 0 0)"
aviso="O agente não respondeu; não dá para saber se há reuniões agora. Seguindo com a atualização."
confere "atualizar sem resposta do agente segue com o aviso" "0|$tudo|$aviso
$pronto" "$(cenario_atualizar sem-agente '' 1)"
confere "atualizar apaga o FreeSWITCH antigo no fim" não \
  "$(if [ -e "$T/atualizar-nenhuma/opt/starsonic-freeswitch.antigo" ]; then echo sim; else echo não; fi)"
confere "atualizar sem a instalação para" "1|" "$(
  raiz=$T/atualizar-sem-instalacao
  instalado "$raiz"
  rm "$UNIDADES/starsonic-video.service"
  conferir_maquina() { :; }
  sistema_da_maquina() { echo ubuntu-24.04; }
  baixar_tudo() { echo baixar; }
  codigo=0
  saida=$( (atualizar 0) 2>/dev/null) || codigo=$?
  echo "$codigo|$saida"
)"

# --- o chat: troca só o endereço do chat, e volta o de antes se o agente não ficar de pé ---
# cenario_chat <nome> <firme ou cai> <endereço do chat>: "<código>|<config.json no fim>|<saída>|<sobra>".
cenario_chat() {
  local t_nome=$1 t_jeito=$2 t_chat=$3
  (
    t_raiz=$T/chat-$t_nome
    instalado "$t_raiz"
    : >"$t_raiz/systemctl"
    conferir_maquina() { :; }
    sleep() { :; }
    journalctl() { :; }
    systemctl() {
      case "$1" in
        restart) echo "restart $2" >>"$t_raiz/systemctl" ;;
        show) echo 0 ;;
        is-active) [ "$t_jeito" = firme ] ;;
        *) return 9 ;;
      esac
    }
    local t_codigo=0 t_sobra=limpo
    set +e
    (set -e; mudar_chat "$t_chat") >"$t_raiz/saida" 2>&1
    t_codigo=$?
    set -e
    if [ -e "$CONFIG_DIR/config.json.antes" ] || [ -e "$CONFIG_DIR/config.json.novo" ]; then t_sobra=sobrou; fi
    echo "$t_codigo|$(cat "$CONFIG_DIR/config.json")|$(tail -n 1 "$t_raiz/saida")|$t_sobra|$(paste -sd ';' "$t_raiz/systemctl")"
  )
}
config_com() { # config_com <chat>: o config.json do instalado, com esse chat.
  echo "{\"endereco\": \"video.exemplo.com.br\", \"chat\": \"$1\", \"chave\": \"$chave_teste\", \"senhaEsl\": \"$s1\", \"ipPrivado\": \"10.0.0.5\", \"ipPublico\": \"203.0.113.10\"}"
}
confere "chat: troca o endereço e reinicia o agente" \
  "0|$(config_com chat2.exemplo.com.br:8443)|Pronto: o servidor de vídeo agora aceita a página de https://chat2.exemplo.com.br:8443.|limpo|restart starsonic-video.service" \
  "$(cenario_chat troca firme chat2.exemplo.com.br:8443)"
confere "chat: o config.json continua 0640" 640 "$(modo "$T/chat-troca/etc/starsonic-video/config.json")"
confere "chat: o config.json continua do grupo do agente" root:starsonic-video \
  "$(awk '$2 ~ /config\.json\.novo$/ { d = $1 } END { print d }' "$T/chat-troca/donos")"
confere "chat: o agente não fica de pé, e a configuração de antes volta" \
  "1|$(config_com chat.exemplo.com.br)|ERRO: o agente não ficou de pé com o endereço novo do chat (as últimas linhas do registro estão acima). A configuração de antes voltou.|limpo|restart starsonic-video.service;restart starsonic-video.service" \
  "$(cenario_chat cai cai chat2.exemplo.com.br)"
confere "chat: um endereço que não serve não muda nada" "1|$(config_com chat.exemplo.com.br)" "$(
  cenario_chat invalido firme https://chat2.exemplo.com.br | cut -d'|' -f1,2
)"

# --- o servicos_firmes: o serviço ficou de pé depois do restart ---
# cenario_firme <jeito>: firme, caido (não está ativo depois da espera) ou voltou (caiu e voltou na espera: o
# NRestarts cresceu). O NRestarts é lido depois do restart, que o zera.
cenario_firme() {
  (
    t_jeito=$1
    t_reinicios=$T/reinicios-$t_jeito
    echo 0 >"$t_reinicios"
    sleep() { if [ "$t_jeito" = voltou ]; then echo 1 >"$t_reinicios"; fi; }
    systemctl() {
      case "$1" in
        show) cat "$t_reinicios" ;;
        is-active) [ "$t_jeito" != caido ] ;;
        *) return 9 ;;
      esac
    }
    if servicos_firmes starsonic-video starsonic-freeswitch; then echo firme; else echo caiu; fi
  )
}
confere "serviços firmes" firme "$(cenario_firme firme)"
confere "serviço caído" caiu "$(cenario_firme caido)"
confere "serviço que caiu e voltou na espera" caiu "$(cenario_firme voltou)"

# --- o uso: os comandos e as opções que não existem ---
codigo_de() { local c=0; (principal "$@") >/dev/null 2>&1 || c=$?; echo "$c"; }
confere "sem comando" 2 "$(codigo_de)"
confere "instalar sem o --chat" 2 "$(codigo_de instalar video.exemplo.com.br)"
confere "instalar sem o endereço" 2 "$(codigo_de instalar)"
confere "instalar com o --agora" 2 "$(codigo_de instalar video.exemplo.com.br --chat chat.exemplo.com.br --agora)"
confere "atualizar com o --chat" 2 "$(codigo_de atualizar --chat chat.exemplo.com.br)"
confere "chat sem o endereço" 2 "$(codigo_de chat)"
confere "chat com dois endereços" 2 "$(codigo_de chat chat.exemplo.com.br chat2.exemplo.com.br)"
confere "chat com o --versao" 2 "$(codigo_de chat chat.exemplo.com.br --versao 0.1.0)"
confere "comando que não existe" 2 "$(codigo_de porta 8443)"
# Os argumentos certos passam pelo uso e param na versão, que o script do repositório não traz.
confere "instalar do repositório pede a versão" \
  "ERRO: este script não traz a versão (é o do repositório). Rode com --versao X.Y.Z, por exemplo: --versao 0.1.0" \
  "$( (principal instalar video.exemplo.com.br --chat chat.exemplo.com.br) 2>&1)"
confere "um endereço que não serve para antes da versão" 1 "$(codigo_de instalar https://video.exemplo.com.br --chat chat.exemplo.com.br)"
confere "uma versão fora do formato" 1 "$(codigo_de atualizar --versao 1.0)"

[ "$falhas" -eq 0 ] || exit 1
echo "tudo certo"
