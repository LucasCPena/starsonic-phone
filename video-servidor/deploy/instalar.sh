#!/usr/bin/env bash
# Instala e atualiza o servidor de vídeo das reuniões do Starsonic Phone numa VM Ubuntu 24.04 ou Debian 12 com
# systemd: o FreeSWITCH (o pacote da release, montado do código oficial), o coturn e o certbot do apt, e o agente
# starsonic-video.
#
#   sudo bash instalar.sh instalar <endereço> --chat <endereço do chat>   instala (o endereço é o nome do
#                                                                         servidor de vídeo no DNS)
#   sudo bash instalar.sh atualizar [--agora]                            troca tudo pela versão deste script
#   sudo bash instalar.sh chat <endereço do chat>                        troca o endereço do chat
#
# Este script vem na release video-v<versão> do GitHub, com a versão já escrita abaixo. Rodado direto do
# repositório, ele pede --versao X.Y.Z.
#
# O endereço do chat é o da página das reuniões, como o navegador a abre: o nome do chat no DNS, com a porta quando
# o chat usa uma própria (o --porta da instalação do chat). Só essa página entra nas reuniões.
#
# Uma instalação que parou no meio (o DNS que ainda não apontava, a porta 80 fechada) roda de novo com o mesmo
# comando: ela refaz o que já tinha feito. Depois que termina, o instalar recusa, e o caminho é o atualizar.
set -euo pipefail
shopt -s inherit_errexit

VERSAO="@VERSAO@"
REPOSITORIO="LucasCPena/starsonic-phone"
USUARIO=starsonic-video
USUARIO_FS=starsonic-freeswitch
CONFIG_DIR=/etc/starsonic-video
BINARIO=/usr/local/bin/starsonic-video
FREESWITCH=/opt/starsonic-freeswitch
UNIDADES=/etc/systemd/system
LETSENCRYPT=/etc/letsencrypt
GANCHO=$LETSENCRYPT/renewal-hooks/deploy/starsonic-video
TURN_CONF=/etc/turnserver.conf
OS_RELEASE=/etc/os-release
ARQUIVO_BINARIO=starsonic-video-linux-amd64

falhar() {
  echo "ERRO: $*" >&2
  exit 1
}

uso() {
  cat >&2 <<'FIM'
uso: sudo bash instalar.sh instalar <endereço> --chat <endereço do chat> [--versao X.Y.Z]
     sudo bash instalar.sh atualizar [--agora] [--versao X.Y.Z]
     sudo bash instalar.sh chat <endereço do chat>
FIM
  exit 2
}

# O endereço vira o nome do certificado e entra no arquivo de configuração: só letras minúsculas, números, pontos e
# hífens, com pelo menos um ponto (a regra do conferir_endereco do chat).
conferir_endereco() {
  local rotulo='[a-z0-9]([a-z0-9-]*[a-z0-9])?'
  if [ "${#1}" -gt 253 ] || ! [[ "$1" =~ ^${rotulo}(\.${rotulo})+$ ]]; then
    falhar "o endereço \"$1\" não serve. Use o nome do servidor de vídeo no DNS, só com letras minúsculas, números, pontos e hífens, e com pelo menos um ponto. Exemplo: video.exemplo.com.br"
  fi
  # A última parte de um nome nunca é só número. Assim fica de fora um número de IP, como 189.0.2.10: o
  # certificado é pedido para um nome, e com o IP o cadeado não sai.
  if [[ "${1##*.}" =~ ^[0-9]+$ ]]; then
    falhar "o endereço \"$1\" é um número de IP. Use o nome do servidor de vídeo no DNS, que aponta para esse IP. Exemplo: video.exemplo.com.br"
  fi
}

# conferir_chat <endereço do chat>: o nome do chat no DNS (a regra do conferir_endereco), com a porta só quando o
# chat usa uma própria: de 1 a 65535, sem zero na frente, e nem a 80 (a do certificado do chat) nem a 443 (a
# normal, que não se escreve). Sem https:// e sem caminho.
conferir_chat() {
  local nome=$1 porta=""
  local exemplo="Exemplo: chat.exemplo.com.br, ou chat.exemplo.com.br:8443 se o chat usa a porta 8443"
  if [[ "$1" == *:* ]]; then
    nome=${1%%:*}
    porta=${1#*:}
  fi
  if ! (conferir_endereco "$nome") 2>/dev/null; then
    falhar "o endereço do chat \"$1\" não serve. Escreva só o nome do chat no DNS, sem https:// e sem caminho, com a porta só se o chat usa uma própria. $exemplo"
  fi
  if [[ "$1" == *:* ]]; then
    if [ "$porta" = 443 ]; then
      falhar "o endereço do chat \"$1\" não leva a porta 443, que é a normal. Escreva só: $nome"
    fi
    if ! [[ "$porta" =~ ^[1-9][0-9]{0,4}$ ]] || [ "$porta" -gt 65535 ] || [ "$porta" -eq 80 ]; then
      falhar "a porta do chat em \"$1\" não serve. Use a porta própria do chat, de 1 a 65535 (a do --porta da instalação do chat). $exemplo"
    fi
  fi
}

# sistema_da_maquina <os-release>: ubuntu-24.04 ou debian-12, os dois sistemas que têm um pacote do FreeSWITCH.
# Outro sistema para com o nome dele.
sistema_da_maquina() {
  local arquivo=$1 sistema nome
  [ -r "$arquivo" ] || falhar "não sei qual é o sistema desta máquina ($arquivo não existe). Precisa ser Ubuntu 24.04 ou Debian 12."
  # shellcheck source=/dev/null
  sistema=$(. "$arquivo" && echo "${ID:-}-${VERSION_ID:-}")
  case "$sistema" in
    ubuntu-24.04 | debian-12) echo "$sistema" ;;
    *)
      # shellcheck source=/dev/null
      nome=$(. "$arquivo" && echo "${PRETTY_NAME:-${ID:-?} ${VERSION_ID:-}}")
      falhar "o sistema desta máquina é $nome. Precisa ser Ubuntu 24.04 ou Debian 12."
      ;;
  esac
}

conferir_maquina() {
  [ "$(id -u)" -eq 0 ] || falhar "rode como administrador: sudo bash instalar.sh ..."
  [ -d /run/systemd/system ] || falhar "esta máquina não usa o systemd. Precisa de um Ubuntu 24.04 ou Debian 12 comum, com systemd."
  local item comando pacote
  for item in curl:curl sha256sum:coreutils tar:tar ss:iproute2 ip:iproute2 getent:libc-bin; do
    comando=${item%%:*}
    pacote=${item#*:}
    command -v "$comando" >/dev/null || falhar "falta o comando $comando. Instale com: sudo apt-get install -y $pacote"
  done
}

# conferir_portas: as portas do servidor de vídeo estão livres. As linhas do ss dizem qual programa usa cada uma.
conferir_portas() {
  local ocupadas
  ocupadas=$(
    ss -H -ltnp '( sport = :80 or sport = :443 or sport = :5061 or sport = :5349 )'
    ss -H -lunp '( sport = :3478 )'
  )
  if [ -n "$ocupadas" ]; then
    echo "$ocupadas" >&2
    falhar "as portas TCP 80, 443, 5061 e 5349 e a UDP 3478 têm de estar livres, e alguma está em uso (acima). Pare o programa que usa a porta e rode de novo."
  fi
}

# ip_reservado <IPv4>: verdade para um IP que não é da internet: a rede interna (10/8, 172.16/12 e 192.168/16), o
# CGNAT das operadoras (100.64/10), a própria máquina (127/8), o link local (169.254/16) e o 0/8.
ip_reservado() {
  local a b
  IFS=. read -r a b _ <<<"$1"
  [ "$a" -eq 10 ] || [ "$a" -eq 127 ] || [ "$a" -eq 0 ] ||
    { [ "$a" -eq 172 ] && [ "$b" -ge 16 ] && [ "$b" -le 31 ]; } ||
    { [ "$a" -eq 192 ] && [ "$b" -eq 168 ]; } ||
    { [ "$a" -eq 100 ] && [ "$b" -ge 64 ] && [ "$b" -le 127 ]; } ||
    { [ "$a" -eq 169 ] && [ "$b" -eq 254 ]; }
}

# ip_publico <endereço>: o primeiro IPv4 que o endereço dá no DNS, o IP público da VM (ou o do roteador na frente
# dela). O FreeSWITCH e o coturn o dão a quem entra numa reunião, e um IP da rede interna deixaria todos de fora.
ip_publico() {
  local respostas ip
  respostas=$(getent ahostsv4 "$1") || respostas=""
  ip=$(awk 'NR == 1 { print $1 }' <<<"$respostas")
  if ! [[ "$ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
    falhar "o endereço $1 ainda não aponta para nenhum IP no DNS. Crie o registro A e espere alguns minutos."
  fi
  if ip_reservado "$ip"; then
    falhar "o endereço $1 aponta para $ip, que não é um IP da internet. O registro A tem de apontar para o IP público da VM (ou o do roteador na frente dela). Se o DNS público já mostra o IP certo, o nome está no /etc/hosts desta VM (tire-o de lá) ou num DNS interno (lá, ele também tem de apontar para o IP público). Depois, rode de novo."
  fi
  echo "$ip"
}

# ip_privado: o IPv4 desta máquina na rede dela, o de onde ela sai para a internet (o src da rota). O FreeSWITCH e
# o coturn escutam nele.
ip_privado() {
  local rota ip
  rota=$(ip -4 route get 1.1.1.1 2>/dev/null) || rota=""
  ip=$(awk '{ for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit } }' <<<"$rota")
  [[ "$ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] ||
    falhar "não achei o IP desta máquina na rede (o ip -4 route get 1.1.1.1 não mostrou a rota). Confira a rede da VM e a internet dela."
  echo "$ip"
}

# pacote_freeswitch <sistema>: o nome do pacote do FreeSWITCH do sistema, na release.
pacote_freeswitch() { echo "starsonic-freeswitch-$1-amd64.tar.gz"; }

# baixar <nome> <pasta>: baixa um arquivo da mesma release, só por https, também nos redirecionamentos. Uma
# transferência parada (menos de 1 KB/s por 60 s) desiste, em vez de prender a instalação.
baixar() {
  curl -fsSL --proto =https --proto-redir =https --retry 3 --connect-timeout 20 --speed-limit 1024 --speed-time 60 \
    -o "$2/$1" "$BASE/$1" ||
    falhar "não consegui baixar $BASE/$1 . Confira a versão $VERSAO e a internet da máquina."
}

# conferir_sha256 <pasta> <nome>: o arquivo bate com o .sha256 dele, da mesma release.
conferir_sha256() {
  local esperado real
  esperado=$(cut -d' ' -f1 "$1/$2.sha256")
  real=$(sha256sum "$1/$2" | cut -d' ' -f1)
  if [ -z "$esperado" ] || [ "$esperado" != "$real" ]; then
    falhar "o SHA-256 de $2 não confere. Nada foi instalado. Rode de novo; se repetir, avise quem cuida do servidor de vídeo."
  fi
}

# baixar_tudo <pasta> <sistema>: baixa o programa, o FreeSWITCH do sistema, os SHA-256 dos dois, as unidades do
# systemd e o gancho do certificado, todos da mesma release, e confere os dois SHA-256 antes de qualquer instalação.
baixar_tudo() {
  local pasta=$1 pacote f
  pacote=$(pacote_freeswitch "$2")
  for f in "$ARQUIVO_BINARIO" "$ARQUIVO_BINARIO.sha256" "$pacote" "$pacote.sha256" \
    starsonic-video.service starsonic-freeswitch.service certificado.sh; do
    baixar "$f" "$pasta"
  done
  conferir_sha256 "$pasta" "$ARQUIVO_BINARIO"
  conferir_sha256 "$pasta" "$pacote"
  echo "SHA-256 conferido."
}

# ler_pacotes <pacotes.txt>: os pacotes do apt de que o FreeSWITCH precisa, um por linha.
ler_pacotes() { sed '/^[[:space:]]*$/d' "$1"; }

# instalar_pacotes <pacote>...: o apt-get update e o install, com a saída guardada e mostrada só num erro. Numa VM
# nova, a atualização automática do sistema pode estar usando o apt: ele espera até 10 minutos.
instalar_pacotes() {
  local saida=$TMP/apt.txt
  if ! {
    apt-get -o DPkg::Lock::Timeout=600 update -q &&
      DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=600 install -y -q --no-install-recommends "$@"
  } >"$saida" 2>&1; then
    cat "$saida" >&2
    falhar "o apt não instalou os pacotes (a mensagem dele está acima). Confira a internet da máquina e rode o mesmo comando de novo."
  fi
}

# criar_usuarios: os usuários de sistema do agente e do FreeSWITCH, sem shell e sem pasta.
criar_usuarios() {
  local u
  for u in "$USUARIO" "$USUARIO_FS"; do
    if ! id "$u" >/dev/null 2>&1; then
      useradd --system --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin "$u" ||
        falhar "não consegui criar o usuário de sistema $u."
    fi
  done
}

# instalar_programa <pasta>: põe o agente no lugar.
instalar_programa() {
  install -m 0755 "$1/$ARQUIVO_BINARIO" "$BINARIO.novo"
  mv -fT "$BINARIO.novo" "$BINARIO" # trocar o nome funciona com o programa rodando
}

# instalar_unidades <pasta>: põe as duas unidades do systemd no lugar.
instalar_unidades() {
  local u
  for u in starsonic-video.service starsonic-freeswitch.service; do
    install -m 0644 "$1/$u" "$UNIDADES/$u"
  done
  systemctl daemon-reload
}

# instalar_gancho <pasta>: o certificado.sh vai para a pasta dos ganchos do certbot, que roda os dessa pasta
# depois de cada certificado novo.
instalar_gancho() {
  install -d -m 0755 "$(dirname "$GANCHO")"
  install -m 0755 "$1/certificado.sh" "$GANCHO.novo"
  mv -fT "$GANCHO.novo" "$GANCHO"
}

# senha_esl: 32 letras e números sorteados, a senha do ESL do FreeSWITCH. Só letras e números: o FreeSWITCH lê a
# configuração por um pré-processador que mexe com outros sinais.
senha_esl() {
  local senha=""
  while [ "${#senha}" -lt 32 ]; do
    senha+=$(head -c 64 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9')
  done
  echo "${senha:0:32}"
}

# escrever_config <endereço> <chat> <chave> <senha do ESL> <IP privado> <IP público>: grava o config.json do agente.
# Ele leva a chave e a senha: nasce só do root e fica root:starsonic-video, 0640, antes de tomar o lugar do antigo.
escrever_config() {
  local destino=$CONFIG_DIR/config.json
  rm -f "$destino.novo"
  (umask 077 && printf '{"endereco": "%s", "chat": "%s", "chave": "%s", "senhaEsl": "%s", "ipPrivado": "%s", "ipPublico": "%s"}\n' "$@" >"$destino.novo")
  chown "root:$USUARIO" "$destino.novo"
  chmod 0640 "$destino.novo"
  mv -fT "$destino.novo" "$destino"
}

# ler_campo <campo>: o valor de um campo de texto do config.json que este script gravou.
ler_campo() {
  sed -n 's/.*"'"$1"'": *"\([^"]*\)".*/\1/p' "$CONFIG_DIR/config.json"
}

# certificados_proprios: os dois pares autoassinados do FreeSWITCH, na pasta tls/ dele, só os que faltam: o
# dtls-srtp.pem (o DTLS do WebRTC) e o wss.pem. Sem eles, o FreeSWITCH faria um par novo de 4096 bits a cada
# partida, sem conseguir guardá-lo (a /etc é só de leitura para ele). A chave e o certificado ficam no mesmo arquivo.
# A pasta tls/ é do usuário do FreeSWITCH: só um arquivo comum conta como um par que já existe, e um link simbólico
# no lugar dele é trocado por um par novo (o mv -T troca o nome, e não segue o link).
certificados_proprios() {
  local pasta=$CONFIG_DIR/freeswitch/tls nome preparo
  for nome in dtls-srtp.pem wss.pem; do
    if [ -f "$pasta/$nome" ] && [ ! -L "$pasta/$nome" ]; then
      continue
    fi
    preparo=$(mktemp -d "$CONFIG_DIR/.par.XXXXXX")
    if ! openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj /CN=starsonic-video \
      -keyout "$preparo/chave" -out "$preparo/certificado" >/dev/null 2>&1; then
      rm -rf "$preparo"
      falhar "o openssl não fez o $nome do FreeSWITCH."
    fi
    (umask 077 && cat "$preparo/chave" "$preparo/certificado" >"$preparo/par")
    chown "$USUARIO_FS:$USUARIO_FS" "$preparo/par"
    chmod 0600 "$preparo/par"
    if ! mv -fT "$preparo/par" "$pasta/$nome"; then
      rm -rf "$preparo"
      falhar "não consegui pôr o $nome no lugar: $pasta/$nome tem de ser um arquivo comum."
    fi
    rm -rf "$preparo"
  done
}

# dono <dono:grupo> <modo> <caminho>: o dono e o modo, sem nunca seguir um link simbólico. Um link no lugar de um
# arquivo da configuração para a instalação, com o nome dele.
dono() {
  [ ! -L "$3" ] || falhar "$3 é um link simbólico, e não um arquivo comum. A instalação não segue links: apague-o e rode o mesmo comando de novo."
  chown -h "$1" "$3"
  chmod "$2" "$3"
}

# acertar_donos: os donos e os modos da configuração, depois de cada configurar, que escreve tudo como do root. O
# FreeSWITCH lê a pasta freeswitch/ pelo grupo, e a tls/ dela é só dele. A tls/ de cima tem os arquivos do agente
# e os do coturn, cada um com o seu grupo (o certificado.sh os escreve).
acertar_donos() {
  local fs=$CONFIG_DIR/freeswitch nome
  mkdir -p "$CONFIG_DIR/tls"
  dono root:root 0755 "$CONFIG_DIR"
  dono root:root 0755 "$CONFIG_DIR/tls"
  dono "root:$USUARIO" 0640 "$CONFIG_DIR/config.json"
  dono root:root 0640 "$CONFIG_DIR/turnserver.conf"
  dono "root:$USUARIO_FS" 0750 "$fs"
  dono "root:$USUARIO_FS" 0640 "$fs/freeswitch.xml"
  dono root:root 0644 "$fs/sem-camera.png"
  dono "$USUARIO_FS:$USUARIO_FS" 0700 "$fs/tls"
  for nome in dtls-srtp.pem wss.pem; do
    [ ! -e "$fs/tls/$nome" ] || dono "$USUARIO_FS:$USUARIO_FS" 0600 "$fs/tls/$nome"
  done
}

# instalar_turn: a configuração do coturn, a que o configurar escreveu, no lugar da do pacote. A do pacote fica, uma
# vez só, em /etc/turnserver.conf.original.
instalar_turn() {
  if [ -e "$TURN_CONF" ] && [ ! -e "$TURN_CONF.original" ]; then
    cp -p "$TURN_CONF" "$TURN_CONF.original"
  fi
  rm -f "$TURN_CONF.novo"
  (umask 077 && cp "$CONFIG_DIR/turnserver.conf" "$TURN_CONF.novo")
  chown root:turnserver "$TURN_CONF.novo"
  chmod 0640 "$TURN_CONF.novo"
  mv -fT "$TURN_CONF.novo" "$TURN_CONF"
}

# configurar_tudo: a configuração do FreeSWITCH e do coturn, escrita de novo pelo configurar a partir do config.json,
# com os pares do FreeSWITCH, os donos e os modos, e a cópia para o coturn.
configurar_tudo() {
  "$BINARIO" configurar --config "$CONFIG_DIR/config.json" --saida "$CONFIG_DIR" ||
    falhar "o starsonic-video configurar não escreveu a configuração (o erro está acima)."
  certificados_proprios
  acertar_donos
  instalar_turn
}

# configurar_novo <endereço> <chat> <IP privado> <IP público>: a chave e a senha do ESL novas, o config.json e a
# configuração dos três programas. Numa instalação que parou no meio e roda de novo, tudo é refeito: a chave só
# aparece no fim, e ninguém a viu ainda.
configurar_novo() {
  local chave senha
  mkdir -p "$CONFIG_DIR"
  chave=$("$BINARIO" chave)
  senha=$(senha_esl)
  escrever_config "$1" "$2" "$chave" "$senha" "$3" "$4"
  configurar_tudo
}

# tirar_certificado <endereço>: o certificado do Let's Encrypt, pela porta 80 (o certbot escuta nela só durante o
# pedido). A saída do certbot só aparece num erro. Um certificado que já existe e ainda vale fica como está.
tirar_certificado() {
  if ! certbot certonly --standalone --non-interactive --agree-tos --register-unsafely-without-email \
    --preferred-challenges http -d "$1" >"$TMP/certbot.txt" 2>&1; then
    cat "$TMP/certbot.txt" >&2
    falhar "o certificado não saiu: confira o DNS e a porta 80 (veja \"O certificado não sai\", no guia)."
  fi
}

# rodar_gancho <endereço>: roda o gancho do certificado à mão, como o certbot o roda depois de uma renovação.
rodar_gancho() {
  RENEWED_LINEAGE="$LETSENCRYPT/live/$1" "$GANCHO" ||
    falhar "o certificado não chegou aos serviços (o erro está acima)."
}

# servicos_firmes <unidade>...: logo depois de ligar ou reiniciar, diz se as unidades ficaram de pé. O agente e o
# FreeSWITCH, quando caem, voltam sozinhos 5 s depois (RestartSec=5), e o coturn logo depois. Então, 3 s depois, um
# programa que caiu ainda não voltou (não está ativo), ou já voltou e deixou o NRestarts maior. O NRestarts é lido
# aqui, depois do restart: um restart à mão o zera.
servicos_firmes() {
  local unidade i=0 reinicios=()
  for unidade in "$@"; do
    reinicios+=("$(systemctl show -p NRestarts --value "$unidade")")
  done
  sleep 3
  for unidade in "$@"; do
    systemctl is-active --quiet "$unidade" || return 1
    [ "$(systemctl show -p NRestarts --value "$unidade")" = "${reinicios[$i]}" ] || return 1
    i=$((i + 1))
  done
}

# conferir_servicos: para, com as últimas linhas do registro, se o FreeSWITCH, o agente ou o coturn não ficaram de pé.
conferir_servicos() {
  if ! servicos_firmes starsonic-freeswitch.service starsonic-video.service coturn.service; then
    journalctl -u starsonic-freeswitch -u starsonic-video -u coturn -n 30 --no-pager >&2 || true
    falhar "o servidor de vídeo não ficou de pé (as últimas linhas do registro estão acima). Para tentar de novo: sudo bash instalar.sh atualizar"
  fi
}

# ligar_servicos: as unidades no lugar, o FreeSWITCH e o agente ligados, e o coturn, enfim com a nossa
# configuração.
ligar_servicos() {
  instalar_unidades "$TMP"
  systemctl --quiet enable --now starsonic-freeswitch.service starsonic-video.service || true
  systemctl --quiet unmask coturn.service
  systemctl --quiet enable coturn.service
  systemctl restart coturn.service || true
  conferir_servicos
}

# reiniciar_servicos: os três reiniciam com a versão e a configuração novas. O FreeSWITCH reiniciado encerra as
# reuniões que estavam acontecendo.
reiniciar_servicos() {
  systemctl restart starsonic-freeswitch.service starsonic-video.service coturn.service || true
  conferir_servicos
}

# conferir_instalado: a instalação chegou ao fim. A unidade do agente só é posta no último passo.
conferir_instalado() {
  if [ ! -e "$UNIDADES/starsonic-video.service" ] || [ ! -x "$BINARIO" ] || [ ! -e "$CONFIG_DIR/config.json" ]; then
    falhar "o servidor de vídeo não está instalado aqui, ou a instalação parou no meio. Para instalar, ou terminar uma instalação que parou: sudo bash instalar.sh instalar <endereço> --chat <endereço do chat>"
  fi
}

# conferir_reunioes <agora>: pergunta ao agente quantas reuniões estão acontecendo. Com alguma, só segue com o
# --agora (o 1), porque reiniciar o FreeSWITCH as encerra. Sem resposta do agente, segue com um aviso: atualizar é
# também o jeito de consertar um agente parado.
conferir_reunioes() {
  local n
  if ! n=$("$BINARIO" reunioes --config "$CONFIG_DIR/config.json" 2>/dev/null) || ! [[ "$n" =~ ^[0-9]+$ ]]; then
    echo "O agente não respondeu; não dá para saber se há reuniões agora. Seguindo com a atualização." >&2
    return 0
  fi
  if [ "$n" -gt 0 ] && [ "$1" != 1 ]; then
    falhar "Há $n reunião(ões) acontecendo agora. Atualize quando elas acabarem, ou rode de novo com --agora, que as encerra."
  fi
}

# trocar_freeswitch <pacote>: o FreeSWITCH novo vai para /opt/starsonic-freeswitch.novo, com os pacotes do apt da
# lista dele, e só então toma o lugar do antigo, que fica em .antigo até os serviços voltarem. O que está rodando
# não percebe: os arquivos dele continuam abertos.
trocar_freeswitch() {
  local -a pacotes
  rm -rf "$FREESWITCH.novo" "$FREESWITCH.antigo"
  mkdir -m 0755 "$FREESWITCH.novo"
  tar -xzf "$1" -C "$FREESWITCH.novo" --strip-components=2 || falhar "não consegui extrair o FreeSWITCH novo."
  if [ ! -x "$FREESWITCH.novo/bin/freeswitch" ] || [ ! -s "$FREESWITCH.novo/pacotes.txt" ]; then
    falhar "o pacote do FreeSWITCH não tem o bin/freeswitch e o pacotes.txt. Nada mudou."
  fi
  mapfile -t pacotes < <(ler_pacotes "$FREESWITCH.novo/pacotes.txt")
  instalar_pacotes "${pacotes[@]}"
  if [ -e "$FREESWITCH" ]; then
    mv -T "$FREESWITCH" "$FREESWITCH.antigo"
  fi
  mv -T "$FREESWITCH.novo" "$FREESWITCH"
}

instalar() {
  local endereco=$1 chat=$2 sistema ip_pub ip_priv
  local -a pacotes
  conferir_maquina
  sistema=$(sistema_da_maquina "$OS_RELEASE")
  if [ -e "$UNIDADES/starsonic-video.service" ]; then
    falhar "o servidor de vídeo já está instalado ($UNIDADES/starsonic-video.service existe). Para trocar de versão: sudo bash instalar.sh atualizar . Para trocar o endereço do chat: sudo bash instalar.sh chat <endereço do chat> . Para ver a chave de novo: sudo starsonic-video mostrar-chave"
  fi
  conferir_portas
  ip_pub=$(ip_publico "$endereco")
  ip_priv=$(ip_privado)

  baixar_tudo "$TMP" "$sistema"

  echo "Instalando o FreeSWITCH, o coturn e o certbot (leva alguns minutos)..."
  tar -xzf "$TMP/$(pacote_freeswitch "$sistema")" -C / || falhar "não consegui extrair o FreeSWITCH."
  [ -s "$FREESWITCH/pacotes.txt" ] || falhar "o pacote do FreeSWITCH não tem o pacotes.txt."
  # O coturn do apt sobe sozinho logo que é instalado, com a configuração de exemplo, que faz relay para qualquer
  # um. Mascarado, ele não sobe: liga só no fim, já com a nossa configuração.
  systemctl --quiet mask coturn.service
  mapfile -t pacotes < <(ler_pacotes "$FREESWITCH/pacotes.txt")
  instalar_pacotes certbot coturn ca-certificates openssl "${pacotes[@]}"
  criar_usuarios
  instalar_programa "$TMP"
  configurar_novo "$endereco" "$chat" "$ip_priv" "$ip_pub"

  echo "Pedindo o certificado ao Let's Encrypt (pela porta 80)..."
  instalar_gancho "$TMP"
  tirar_certificado "$endereco"
  # Os arquivos dos três programas existem antes de eles subirem.
  rodar_gancho "$endereco"

  echo "Ligando os serviços..."
  ligar_servicos

  echo
  echo "Pronto: o servidor de vídeo $("$BINARIO" versao) está no ar em https://$endereco/."
  echo
  echo 'A chave do servidor de vídeo (cole no cartão "Reuniões" da administração do chat):'
  "$BINARIO" mostrar-chave --config "$CONFIG_DIR/config.json"
}

atualizar() {
  local agora=$1 sistema
  conferir_maquina
  sistema=$(sistema_da_maquina "$OS_RELEASE")
  conferir_instalado
  baixar_tudo "$TMP" "$sistema"
  conferir_reunioes "$agora"

  echo "Trocando o FreeSWITCH, o agente e a configuração..."
  trocar_freeswitch "$TMP/$(pacote_freeswitch "$sistema")"
  instalar_programa "$TMP"
  instalar_unidades "$TMP"
  instalar_gancho "$TMP"
  configurar_tudo
  # O gancho novo copia o certificado de novo: uma versão nova pode pô-lo em outro lugar.
  rodar_gancho "$(ler_campo endereco)"
  # Os dois são seguros de repetir: se uma instalação parou no último passo, a atualização termina.
  systemctl --quiet unmask coturn.service
  systemctl --quiet enable starsonic-freeswitch.service starsonic-video.service coturn.service
  reiniciar_servicos
  rm -rf "$FREESWITCH.antigo"
  echo "Pronto: o servidor de vídeo agora está na versão $("$BINARIO" versao)."
}

# voltar_chat: põe de volta o config.json de antes do mudar_chat e reinicia o agente com ele.
voltar_chat() {
  if [ -e "$CONFIG_DIR/config.json.antes" ]; then
    mv -fT "$CONFIG_DIR/config.json.antes" "$CONFIG_DIR/config.json"
    systemctl restart starsonic-video.service || true
    echo "A configuração de antes voltou, e o agente foi reiniciado com ela." >&2
  fi
}

# mudar_chat <endereço do chat>: troca o endereço do chat no config.json, sem baixar nada, e reinicia o agente. Se
# o agente não ficar de pé, ou se o comando parar no meio (um erro, um Ctrl+C, a conexão que cai), a configuração
# de antes volta.
mudar_chat() {
  local chat=$1 config=$CONFIG_DIR/config.json
  conferir_chat "$chat"
  conferir_maquina
  conferir_instalado
  grep -q '"chat": *"[^"]*"' "$config" || falhar "não achei o \"chat\" em $config. Nada mudou."
  cp -p "$config" "$config.antes"
  # Daqui até o fim, qualquer saída antes da hora põe a configuração de antes de volta.
  trap voltar_chat EXIT
  trap 'exit 130' INT HUP TERM
  rm -f "$config.novo"
  (umask 077 && sed 's/"chat": *"[^"]*"/"chat": "'"$chat"'"/' "$config" >"$config.novo")
  chown "root:$USUARIO" "$config.novo"
  chmod 0640 "$config.novo"
  mv -fT "$config.novo" "$config"
  systemctl restart starsonic-video.service || true
  if ! servicos_firmes starsonic-video.service; then
    journalctl -u starsonic-video -n 20 --no-pager >&2 || true
    falhar "o agente não ficou de pé com o endereço novo do chat (as últimas linhas do registro estão acima)."
  fi
  rm -f "$config.antes"
  trap - EXIT INT HUP TERM
  echo "Pronto: o servidor de vídeo agora aceita a página de https://$chat."
}

# --- o começo ---
principal() {
  [ "$#" -ge 1 ] || uso
  local comando=$1 endereco="" chat="" agora=0
  shift
  case "$comando" in
    instalar)
      [ "$#" -ge 1 ] || uso
      endereco=$1
      shift
      ;;
    chat)
      [ "$#" -eq 1 ] || uso
      chat=$1
      shift
      ;;
    atualizar) ;;
    *) uso ;;
  esac
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --chat)
        if [ "$comando" != instalar ] || [ "$#" -lt 2 ]; then uso; fi
        chat=$2
        shift 2
        ;;
      --agora)
        [ "$comando" = atualizar ] || uso
        agora=1
        shift
        ;;
      --versao)
        if [ "$comando" = chat ] || [ "$#" -lt 2 ]; then uso; fi
        VERSAO=$2
        shift 2
        ;;
      *) uso ;;
    esac
  done

  # O endereço do chat muda sem baixar nada, então não precisa da versão.
  if [ "$comando" = chat ]; then
    mudar_chat "$chat"
    return
  fi

  # Os endereços são conferidos antes de qualquer outra coisa.
  if [ "$comando" = instalar ]; then
    [ -n "$chat" ] || uso
    conferir_endereco "$endereco"
    conferir_chat "$chat"
  fi

  case "$VERSAO" in
    @*) falhar "este script não traz a versão (é o do repositório). Rode com --versao X.Y.Z, por exemplo: --versao 0.1.0" ;;
  esac
  [[ "$VERSAO" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || falhar "a versão \"$VERSAO\" não está no formato X.Y.Z."
  BASE="https://github.com/$REPOSITORIO/releases/download/video-v$VERSAO"

  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT

  if [ "$comando" = instalar ]; then
    instalar "$endereco" "$chat"
  else
    atualizar "$agora"
  fi
}

# Rodado direto, faz o que o comando pede. Lido por outro script (o instalar-teste.sh), só traz as funções.
if [ "${BASH_SOURCE[0]:-$0}" = "$0" ]; then
  principal "$@"
fi
