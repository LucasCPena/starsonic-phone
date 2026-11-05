#!/usr/bin/env bash
# Instala e atualiza o Starsonic Chat numa VM Ubuntu ou Debian com systemd.
#
#   sudo bash instalar.sh instalar <endereço> [--porta N]   instala (o endereço é o nome do chat no DNS)
#   sudo bash instalar.sh atualizar                         troca o programa pela versão deste script
#   sudo bash instalar.sh porta <N>                         troca a porta pública do HTTPS
#
# Este script vem na release chat-v<versão> do GitHub, com a versão já escrita abaixo. Rodado
# direto do repositório, ele pede --versao X.Y.Z.
#
# A porta: o chat escuta sempre na 80 e na 443 da VM. Quando a VM fica atrás de um roteador
# (NAT) e a 443 pública já é de outro servidor, o roteador traduz outra porta pública (por
# exemplo a 8443) para a 443 da VM. O --porta diz ao chat qual é essa porta, para a 80 levar
# quem chega para ela.
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
PORTA=443

falhar() {
  echo "ERRO: $*" >&2
  exit 1
}

uso() {
  cat >&2 <<'FIM'
uso: sudo bash instalar.sh instalar <endereço> [--porta N] [--versao X.Y.Z]
     sudo bash instalar.sh atualizar [--versao X.Y.Z]
     sudo bash instalar.sh porta <N>
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
  # A última parte de um nome nunca é só número. Assim fica de fora um número de IP, como
  # 189.0.2.10: o certificado é pedido para um nome, e com o IP o cadeado não sai.
  if [[ "${1##*.}" =~ ^[0-9]+$ ]]; then
    falhar "o endereço \"$1\" é um número de IP. Use o nome do chat no DNS, que aponta para esse IP. Exemplo: chat.exemplo.com.br"
  fi
}

# A porta pública do HTTPS: de 1 a 65535, sem zero na frente, e não a 80, que é a do desafio do
# certificado e do desvio para o HTTPS.
conferir_porta() {
  if ! [[ "$1" =~ ^[1-9][0-9]{0,4}$ ]] || [ "$1" -gt 65535 ] || [ "$1" -eq 80 ]; then
    falhar "a porta \"$1\" não serve. Use um número de 1 a 65535, menos o 80 (a 80 é a do certificado). Exemplo: 8443"
  fi
}

# escrever_config <endereço> <porta>: grava o config.json do serviço. A porta só entra quando não
# é a 443.
escrever_config() {
  if [ "$2" = 443 ]; then
    printf '{"endereco": "%s", "dados": "%s"}\n' "$1" "$DADOS" >"$CONFIG_DIR/config.json"
  else
    printf '{"endereco": "%s", "dados": "%s", "porta": %s}\n' "$1" "$DADOS" "$2" >"$CONFIG_DIR/config.json"
  fi
  chmod 0644 "$CONFIG_DIR/config.json"
}

# ler_endereco: o endereço do config.json que este script gravou.
ler_endereco() {
  sed -n 's/.*"endereco": *"\([^"]*\)".*/\1/p' "$CONFIG_DIR/config.json"
}

# endereco_publico <endereço> <porta>: como se chega no chat de fora.
endereco_publico() {
  if [ "$2" = 443 ]; then
    echo "https://$1/"
  else
    echo "https://$1:$2/"
  fi
}

# avisar_roteador <porta>: com uma porta que não é a 443, diz as duas regras do roteador.
avisar_roteador() {
  if [ "$1" != 443 ]; then
    echo
    echo "No roteador, deixe as duas regras para esta VM, sempre ligadas: a porta 80 pública vai para a porta 80 desta VM (é por ela que o cadeado se renova), e a porta $1 pública vai para a porta 443 desta VM."
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
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq rclone ca-certificates tzdata >/dev/null

  if ! id "$USUARIO" >/dev/null 2>&1; then
    useradd --system --home-dir "$DADOS" --no-create-home --shell /usr/sbin/nologin "$USUARIO"
  fi
  install -d -o "$USUARIO" -g "$USUARIO" -m 0700 "$DADOS" "$DADOS/copias"
  install -d -m 0755 "$CONFIG_DIR"
  escrever_config "$endereco" "$PORTA"

  instalar_arquivos "$TMP"
  systemctl enable --now starsonic-chat.service starsonic-chat-copia.timer

  echo
  echo "Pronto: o Starsonic Chat $("$BINARIO" versao) está instalado e ligado em $(endereco_publico "$endereco" "$PORTA")"
  avisar_roteador "$PORTA"
  echo
  echo "Próximo passo: criar o usuário da administração. Rode (troque <usuário> pelo nome que quiser):"
  echo "  sudo -u $USUARIO $BINARIO admin-criar <usuário> --dados $DADOS"
}

atualizar() {
  conferir_maquina
  [ -x "$BINARIO" ] || falhar "o chat não está instalado aqui ($BINARIO não existe). Para instalar: sudo bash instalar.sh instalar <endereço>"
  baixar_tudo "$TMP"
  instalar_arquivos "$TMP"
  # Os dois são seguros de repetir: se uma instalação parou no meio, a atualização termina.
  systemctl enable starsonic-chat.service
  systemctl enable --now starsonic-chat-copia.timer
  systemctl restart starsonic-chat.service
  # O restart volta assim que o programa começa: espera um pouco para ver se ele se mantém.
  sleep 5
  if ! systemctl is-active --quiet starsonic-chat.service; then
    journalctl -u starsonic-chat -n 20 --no-pager >&2 || true
    falhar "o serviço não subiu (as últimas linhas do registro estão acima). Veja mais com: sudo journalctl -u starsonic-chat -n 50"
  fi
  echo "Pronto: o Starsonic Chat agora está na versão $("$BINARIO" versao)."
}

# mudar_porta <N>: troca a porta pública numa instalação que já existe, sem baixar nada, e
# reinicia o serviço. Se o serviço não subir com a porta nova (um programa de antes da 0.1.1 não
# conhece a "porta"), a configuração de antes volta.
mudar_porta() {
  conferir_porta "$1"
  conferir_maquina
  [ -e "$CONFIG_DIR/config.json" ] || falhar "o chat não está instalado aqui ($CONFIG_DIR/config.json não existe). Para instalar: sudo bash instalar.sh instalar <endereço> --porta $1"
  local endereco
  endereco=$(ler_endereco)
  [ -n "$endereco" ] || falhar "não consegui ler o endereço em $CONFIG_DIR/config.json."
  conferir_endereco "$endereco"

  cp -p "$CONFIG_DIR/config.json" "$CONFIG_DIR/config.json.antes"
  escrever_config "$endereco" "$1"
  systemctl restart starsonic-chat.service
  # O restart volta assim que o programa começa: espera um pouco para ver se ele se mantém.
  sleep 5
  if ! systemctl is-active --quiet starsonic-chat.service; then
    mv -f "$CONFIG_DIR/config.json.antes" "$CONFIG_DIR/config.json"
    systemctl restart starsonic-chat.service || true
    falhar "o chat não subiu com a porta $1, e a configuração de antes voltou. Se o chat for de antes da versão 0.1.1, atualize primeiro (sudo bash instalar.sh atualizar) e rode este comando de novo. O registro: sudo journalctl -u starsonic-chat -n 30"
  fi
  rm -f "$CONFIG_DIR/config.json.antes"
  echo "Pronto: o chat agora está em $(endereco_publico "$endereco" "$1")"
  avisar_roteador "$1"
}

# --- o começo ---
principal() {
  [ "$#" -ge 1 ] || uso
  local comando=$1 endereco="" porta_nova=""
  shift
  case "$comando" in
    instalar)
      [ "$#" -ge 1 ] || uso
      endereco=$1
      shift
      ;;
    porta)
      [ "$#" -eq 1 ] || uso
      porta_nova=$1
      shift
      ;;
    atualizar) ;;
    *) uso ;;
  esac
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --versao)
        [ "$#" -ge 2 ] || uso
        VERSAO=$2
        shift 2
        ;;
      --porta)
        if [ "$comando" != instalar ] || [ "$#" -lt 2 ]; then
          uso
        fi
        PORTA=$2
        shift 2
        ;;
      *) uso ;;
    esac
  done

  # A porta muda sem baixar nada, então não precisa da versão.
  if [ "$comando" = porta ]; then
    mudar_porta "$porta_nova"
    return
  fi

  # O endereço e a porta são conferidos antes de qualquer outra coisa.
  if [ "$comando" = instalar ]; then
    conferir_endereco "$endereco"
    conferir_porta "$PORTA"
  fi

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
}

# Rodado direto, faz o que o comando pede. Lido por outro script (o instalar-teste.sh), só traz
# as funções.
if [ "${BASH_SOURCE[0]:-$0}" = "$0" ]; then
  principal "$@"
fi
