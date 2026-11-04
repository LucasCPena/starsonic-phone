#!/usr/bin/env bash
# Instala e atualiza o Starsonic Chat numa VM Ubuntu ou Debian com systemd.
#
#   sudo bash instalar.sh instalar <endereço>     instala (o endereço é o nome do chat no DNS)
#   sudo bash instalar.sh atualizar               troca o programa pela versão deste script
#
# Este script vem na release chat-v<versão> do GitHub, com a versão já escrita abaixo. Rodado
# direto do repositório, ele pede --versao X.Y.Z.
set -euo pipefail

VERSAO="@VERSAO@"
REPOSITORIO="LucasCPena/starsonic-phone"
USUARIO=starsonic-chat
DADOS=/var/lib/starsonic-chat
CONFIG_DIR=/etc/starsonic-chat
BINARIO=/usr/local/bin/starsonic-chat
LIB_DIR=/usr/local/lib/starsonic-chat
UNIDADES=/etc/systemd/system
ARQUIVO_BINARIO=starsonic-chat-linux-amd64

falhar() {
  echo "ERRO: $*" >&2
  exit 1
}

uso() {
  cat >&2 <<'FIM'
uso: sudo bash instalar.sh instalar <endereço> [--versao X.Y.Z]
     sudo bash instalar.sh atualizar [--versao X.Y.Z]
FIM
  exit 2
}

# O endereço vira o nome do certificado e entra no arquivo de configuração: só letras minúsculas,
# números, pontos e hífens, com pelo menos um ponto.
conferir_endereco() {
  local rotulo='[a-z0-9]([a-z0-9-]*[a-z0-9])?'
  if [ "${#1}" -gt 253 ] || ! [[ "$1" =~ ^${rotulo}(\.${rotulo})+$ ]]; then
    falhar "o endereço \"$1\" não serve. Use o nome do chat no DNS, só com letras minúsculas, números, pontos e hífens, e com pelo menos um ponto. Exemplo: chat.exemplo.com.br"
  fi
}

conferir_maquina() {
  [ "$(id -u)" -eq 0 ] || falhar "rode como administrador: sudo bash instalar.sh ..."
  [ -r /etc/os-release ] || falhar "não sei qual é o sistema desta máquina. Precisa ser Ubuntu ou Debian."
  local id id_like
  # shellcheck source=/dev/null
  id=$(. /etc/os-release && echo "${ID:-}")
  # shellcheck source=/dev/null
  id_like=$(. /etc/os-release && echo "${ID_LIKE:-}")
  case "$id $id_like" in
    *ubuntu* | *debian*) ;;
    *) falhar "o sistema desta máquina é $id. Precisa ser Ubuntu ou Debian." ;;
  esac
  [ -d /run/systemd/system ] || falhar "esta máquina não usa o systemd. Precisa de um Ubuntu ou Debian comum, com systemd."
  command -v curl >/dev/null || falhar "falta o curl. Instale com: apt-get install -y curl"
  command -v sha256sum >/dev/null || falhar "falta o sha256sum."
}

conferir_portas() {
  command -v ss >/dev/null || falhar "falta o comando ss. Instale com: apt-get install -y iproute2"
  local ocupadas
  ocupadas=$(ss -H -ltn '( sport = :80 or sport = :443 )')
  if [ -n "$ocupadas" ]; then
    echo "$ocupadas" >&2
    falhar "as portas 80 e 443 têm de estar livres, e alguma está em uso (acima). Pare o programa que usa a porta e rode de novo."
  fi
}

# baixar <nome> <pasta>: baixa um arquivo da mesma release.
baixar() {
  curl -fsSL --retry 3 --connect-timeout 20 -o "$2/$1" "$BASE/$1" ||
    falhar "não consegui baixar $BASE/$1 . Confira a versão $VERSAO e a internet da máquina."
}

# baixar_tudo <pasta>: baixa o programa, o SHA-256 dele, o copia.sh e as unidades do systemd, todos
# da mesma release, e confere o SHA-256 do programa antes de qualquer instalação.
baixar_tudo() {
  local pasta=$1 f esperado real
  for f in "$ARQUIVO_BINARIO" "$ARQUIVO_BINARIO.sha256" copia.sh \
    starsonic-chat.service starsonic-chat-copia.service starsonic-chat-copia.timer; do
    baixar "$f" "$pasta"
  done
  esperado=$(cut -d' ' -f1 "$pasta/$ARQUIVO_BINARIO.sha256")
  real=$(sha256sum "$pasta/$ARQUIVO_BINARIO" | cut -d' ' -f1)
  if [ -z "$esperado" ] || [ "$esperado" != "$real" ]; then
    falhar "o SHA-256 do programa não confere. Nada foi instalado. Rode de novo; se repetir, avise quem cuida do chat."
  fi
  echo "SHA-256 conferido."
}

# instalar_arquivos <pasta>: põe o programa, o copia.sh e as unidades no lugar.
instalar_arquivos() {
  local pasta=$1 u
  install -m 0755 "$pasta/$ARQUIVO_BINARIO" "$BINARIO.novo"
  mv -f "$BINARIO.novo" "$BINARIO" # trocar o nome funciona com o programa rodando
  install -d -m 0755 "$LIB_DIR"
  install -m 0755 "$pasta/copia.sh" "$LIB_DIR/copia.sh"
  for u in starsonic-chat.service starsonic-chat-copia.service starsonic-chat-copia.timer; do
    install -m 0644 "$pasta/$u" "$UNIDADES/$u"
  done
  systemctl daemon-reload
}

instalar() {
  conferir_endereco "$1"
  local endereco=$1
  conferir_maquina
  [ ! -e "$CONFIG_DIR/config.json" ] || falhar "o chat já está instalado ($CONFIG_DIR/config.json existe). Para trocar de versão, use: sudo bash instalar.sh atualizar"
  conferir_portas

  baixar_tudo "$TMP"

  echo "Instalando o rclone e o resto..."
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq rclone ca-certificates >/dev/null

  if ! id "$USUARIO" >/dev/null 2>&1; then
    useradd --system --home-dir "$DADOS" --no-create-home --shell /usr/sbin/nologin "$USUARIO"
  fi
  install -d -o "$USUARIO" -g "$USUARIO" -m 0700 "$DADOS" "$DADOS/copias"
  install -d -m 0755 "$CONFIG_DIR"
  printf '{"endereco": "%s", "dados": "%s"}\n' "$endereco" "$DADOS" >"$CONFIG_DIR/config.json"
  chmod 0644 "$CONFIG_DIR/config.json"

  instalar_arquivos "$TMP"
  systemctl enable --now starsonic-chat.service starsonic-chat-copia.timer

  echo
  echo "Pronto: o Starsonic Chat $("$BINARIO" versao) está instalado e ligado em https://$endereco/"
  echo
  echo "Próximo passo: criar o usuário da administração. Rode (troque <usuário> pelo nome que quiser):"
  echo "  sudo -u $USUARIO $BINARIO admin-criar <usuário> --dados $DADOS"
}

atualizar() {
  conferir_maquina
  [ -x "$BINARIO" ] || falhar "o chat não está instalado aqui ($BINARIO não existe). Para instalar: sudo bash instalar.sh instalar <endereço>"
  baixar_tudo "$TMP"
  instalar_arquivos "$TMP"
  systemctl restart starsonic-chat.service
  systemctl is-active --quiet starsonic-chat.service ||
    falhar "o serviço não subiu. Veja o motivo com: journalctl -u starsonic-chat -n 50"
  echo "Pronto: o Starsonic Chat agora está na versão $("$BINARIO" versao)."
}

# --- o começo ---
[ "$#" -ge 1 ] || uso
comando=$1
shift
endereco=""
if [ "$comando" = instalar ]; then
  [ "$#" -ge 1 ] || uso
  endereco=$1
  shift
fi
while [ "$#" -gt 0 ]; do
  case "$1" in
    --versao)
      [ "$#" -ge 2 ] || uso
      VERSAO=$2
      shift 2
      ;;
    *) uso ;;
  esac
done
case "$comando" in
  instalar | atualizar) ;;
  *) uso ;;
esac

# O endereço é conferido antes de qualquer outra coisa.
[ "$comando" != instalar ] || conferir_endereco "$endereco"

case "$VERSAO" in
  @*) falhar "este script não traz a versão (é o do repositório). Rode com --versao X.Y.Z, por exemplo: --versao 0.1.0" ;;
esac
[[ "$VERSAO" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || falhar "a versão \"$VERSAO\" não está no formato X.Y.Z."
BASE="https://github.com/$REPOSITORIO/releases/download/chat-v$VERSAO"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

if [ "$comando" = instalar ]; then
  instalar "$endereco"
else
  atualizar
fi
