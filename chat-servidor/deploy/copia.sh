#!/usr/bin/env bash
# A cópia de segurança da noite. Quem chama é o starsonic-chat-copia.service (usuário
# starsonic-chat). Para testar na hora: sudo systemctl start starsonic-chat-copia.service
set -euo pipefail

DADOS=/var/lib/starsonic-chat
REMOTO=starsonic-chat-copia
DIAS_APAGADOS=30

# O que sai na tela vai para o journal: sudo journalctl -u starsonic-chat-copia
dizer() { echo "starsonic-chat-copia: $*"; }

# pastas_vencidas <hoje>: lê, da entrada, os nomes de pasta do apagados (um por linha, como o
# rclone lsf --dirs-only) e escreve os que são uma data AAAA-MM-DD de mais de 30 dias antes de
# <hoje> (AAAA-MM-DD, a data de Brasília). Qualquer outro nome é ignorado.
pastas_vencidas() {
  local hoje=$1 limite nome
  limite=$(date -d "$hoje -$DIAS_APAGADOS days" +%F)
  while IFS= read -r nome; do
    nome=${nome%/}
    [[ "$nome" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || continue
    [ "$(date -d "$nome" +%F 2>/dev/null)" = "$nome" ] || continue # 2020-13-45 não é data
    if [[ "$nome" < "$limite" ]]; then
      echo "$nome"
    fi
  done
}

principal() {
  local hoje remotos vencidas pasta
  hoje=$(TZ=America/Sao_Paulo date +%F)

  # 1. A cópia local. Fica no disco, mesmo que o resto falhe.
  /usr/local/bin/starsonic-chat copia --dados "$DADOS" --destino "$DADOS/copias"

  # 2. O destino remoto tem de estar configurado.
  remotos=$(rclone listremotes)
  if ! grep -qx "$REMOTO:" <<<"$remotos"; then
    dizer "ERRO: o destino $REMOTO não está configurado. A cópia ficou só neste servidor. Veja o passo 5 do guia (docs/chat-servidor.md)."
    exit 1
  fi

  # 3. O envio. Nada se perde por cima: o que o envio troca ou apaga no destino vai para
  # apagados/<data>, que fica 30 dias.
  # As cópias só sobem (copy): num servidor refeito, a pasta copias começa vazia, e um sync
  # apagaria as cópias do destino. As do destino saem pela idade, no passo 4.
  rclone copy "$DADOS/copias" "$REMOTO:copias" \
    --backup-dir "$REMOTO:apagados/$hoje/copias" --exclude ".tmp-*"

  # Os arquivos sobem com sync. Sem nenhum arquivo aqui (um servidor novo ou refeito), o sync
  # levaria tudo do destino para apagados: então pula.
  if [ -n "$(find "$DADOS/arquivos" -type f ! -name '.tmp-*' -print -quit 2>/dev/null)" ]; then
    rclone sync "$DADOS/arquivos" "$REMOTO:arquivos" \
      --backup-dir "$REMOTO:apagados/$hoje/arquivos" --exclude ".tmp-*"
  else
    dizer "a pasta de arquivos está vazia; pulei o envio dos arquivos."
  fi

  # 4. A limpeza do destino. Sem a pasta apagados, o rclone dá erro: cria antes (não muda nada
  # se já existe).
  rclone mkdir "$REMOTO:apagados"
  # O apagados sai pela data da pasta, não pela idade dos arquivos: o rclone guarda neles a
  # data de antes, e a idade apagaria na mesma noite o que chegou.
  vencidas=$(rclone lsf --dirs-only "$REMOTO:apagados" | pastas_vencidas "$hoje")
  while IFS= read -r pasta; do
    [ -n "$pasta" ] || continue
    rclone purge "$REMOTO:apagados/$pasta"
  done <<<"$vencidas"
  # Uma cópia tem a data de quando foi feita: sai pela idade.
  rclone delete --min-age 31d "$REMOTO:copias"

  dizer "pronto."
}

# Rodado direto, faz a cópia. Lido por outro script (o copia-teste.sh), só traz as funções.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  principal
fi
