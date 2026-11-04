#!/usr/bin/env bash
# A cópia de segurança da noite. Quem chama é o starsonic-chat-copia.service (usuário
# starsonic-chat). Para testar na hora: sudo systemctl start starsonic-chat-copia.service
set -euo pipefail

DADOS=/var/lib/starsonic-chat
REMOTO=starsonic-chat-copia

# O que sai na tela vai para o journal: journalctl -u starsonic-chat-copia
dizer() { echo "starsonic-chat-copia: $*"; }

# 1. A cópia local. Fica no disco, mesmo que o resto falhe.
/usr/local/bin/starsonic-chat copia --dados "$DADOS" --destino "$DADOS/copias"

# 2. O destino remoto tem de estar configurado.
if ! rclone listremotes | grep -qx "$REMOTO:"; then
  dizer "ERRO: o destino $REMOTO não está configurado. A cópia ficou só neste servidor. Veja o passo 5 do guia (docs/chat-servidor.md)."
  exit 1
fi

# 3. O envio. As cópias só sobem (copy): num servidor refeito, a pasta copias começa vazia, e um
# sync apagaria as cópias do destino. As do destino saem pela idade, no passo 4.
rclone copy "$DADOS/copias" "$REMOTO:copias" --exclude ".tmp-*"

# Os arquivos sobem com sync, e o que some daqui vai para apagados/<data> em vez de sumir. Sem
# nenhum arquivo aqui (um servidor novo ou refeito), o sync levaria tudo do destino para
# apagados: então pula.
if [ -n "$(find "$DADOS/arquivos" -type f ! -name '.tmp-*' -print -quit 2>/dev/null)" ]; then
  rclone sync "$DADOS/arquivos" "$REMOTO:arquivos" \
    --backup-dir "$REMOTO:apagados/$(TZ=America/Sao_Paulo date +%F)" --exclude ".tmp-*"
else
  dizer "a pasta de arquivos está vazia; pulei o envio dos arquivos."
fi

# 4. A limpeza do destino por idade.
rclone delete --min-age 30d "$REMOTO:apagados"
rclone delete --min-age 31d "$REMOTO:copias"

dizer "pronto."
