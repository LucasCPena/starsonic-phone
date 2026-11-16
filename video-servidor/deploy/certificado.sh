#!/usr/bin/env bash
# O gancho do certbot do servidor de vídeo. Depois de cada certificado novo do Let's Encrypt (o primeiro, pelo
# instalar.sh, e cada renovação), copia o certificado para os três programas que o usam e recarrega cada um sem
# derrubar ninguém:
#   - o agente (a 443): /etc/starsonic-video/tls/certificado.pem e chave.pem. A recarga é o systemctl reload (o
#     SIGHUP), que relê o certificado e manda ao FreeSWITCH o reloadcert;
#   - o coturn (a 5349): turn-certificado.pem e turn-chave.pem, e o SIGUSR2;
#   - o FreeSWITCH (a 5061): freeswitch/tls/agent.pem (a chave e a cadeia) e cafile.pem, que ele relê no reloadcert
#     do agente. Ele não reinicia.
# Cada recarga só acontece com o serviço no ar.
#
# O certbot roda este script como root, da pasta /etc/letsencrypt/renewal-hooks/deploy/, com o RENEWED_LINEAGE (a
# pasta live/ do certificado). Todo caminho de destino fica dentro da RAIZ, vazia no servidor: o instalar-teste.sh
# usa uma pasta de teste.
set -euo pipefail

RAIZ=${RAIZ:-}
ETC=$RAIZ/etc/starsonic-video

falhar() {
  echo "ERRO: $*" >&2
  exit 1
}

[ -n "${RENEWED_LINEAGE:-}" ] || falhar "falta o RENEWED_LINEAGE (a pasta live/ do certificado). Quem roda este script é o certbot, depois de cada certificado novo."
for arquivo in fullchain.pem privkey.pem chain.pem; do
  [ -r "$RENEWED_LINEAGE/$arquivo" ] || falhar "não achei $RENEWED_LINEAGE/$arquivo. Nada mudou."
done
for pasta in "$ETC/tls" "$ETC/freeswitch/tls"; do
  [ -d "$pasta" ] || falhar "não achei a pasta $pasta. O servidor de vídeo está instalado? Nada mudou."
done

# Os arquivos ficam prontos numa pasta só do root, já com o dono e o modo certos, e só então tomam o lugar dos
# antigos, cada um de uma vez (o mv na mesma partição). Ninguém lê um arquivo pela metade, e uma chave nunca fica
# aberta a quem não deve, nem por um instante.
umask 077
PREPARO=$(mktemp -d "$ETC/.certificado.XXXXXX")
trap 'rm -rf "$PREPARO"' EXIT

# preparar <nome> <dono:grupo> <modo> <origem>...: junta as origens, em ordem, num arquivo do preparo.
preparar() {
  local nome=$1 dono=$2 modo=$3
  shift 3
  cat "$@" >"$PREPARO/$nome"
  chown "$dono" "$PREPARO/$nome"
  chmod "$modo" "$PREPARO/$nome"
}

L=$RENEWED_LINEAGE
preparar certificado.pem root:root 0644 "$L/fullchain.pem"
preparar chave.pem root:starsonic-video 0640 "$L/privkey.pem"
preparar turn-certificado.pem root:turnserver 0640 "$L/fullchain.pem"
preparar turn-chave.pem root:turnserver 0640 "$L/privkey.pem"
preparar agent.pem starsonic-freeswitch:starsonic-freeswitch 0600 "$L/privkey.pem" "$L/fullchain.pem"
preparar cafile.pem root:root 0644 "$L/chain.pem"

for nome in certificado.pem chave.pem turn-certificado.pem turn-chave.pem; do
  mv -f "$PREPARO/$nome" "$ETC/tls/$nome"
done
for nome in agent.pem cafile.pem; do
  mv -f "$PREPARO/$nome" "$ETC/freeswitch/tls/$nome"
done

# As recargas, cada uma só com o serviço no ar. Uma que falha não impede a outra.
falhou=0
if systemctl is-active --quiet starsonic-video; then
  systemctl reload starsonic-video || falhou=1
fi
if systemctl is-active --quiet coturn; then
  systemctl kill --signal=SIGUSR2 --kill-whom=main coturn || falhou=1
fi
[ "$falhou" -eq 0 ] || falhar "o certificado novo foi copiado, mas uma recarga falhou (acima). Os serviços passam a usá-lo quando reiniciarem."
