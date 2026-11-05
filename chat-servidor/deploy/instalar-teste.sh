#!/usr/bin/env bash
# Testa as conferências do instalar.sh e o config.json que ele grava. Não instala nada, não usa a
# rede nem o root.
# Rode: bash deploy/instalar-teste.sh
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

for e in chat.exemplo.com.br chat.starcloud-starsonic.com.br a.b 123.exemplo.com.br; do
  confere "endereço $e" sim "$(aceita conferir_endereco "$e")"
done
# Um número de IP, um nome sem ponto, com porta, com https, com maiúsculas, vazio.
for e in 189.0.2.10 10.0.0.1.2 chat chat.exemplo.com.br:8443 https://chat.exemplo.com.br Chat.Exemplo.com.br ""; do
  confere "endereço [$e]" não "$(aceita conferir_endereco "$e")"
done

for p in 443 8443 1 65535; do
  confere "porta $p" sim "$(aceita conferir_porta "$p")"
done
for p in 80 0 65536 99999 08443 abc "" -1 8443x; do
  confere "porta [$p]" não "$(aceita conferir_porta "$p")"
done

# O config.json: sem a porta quando ela é a 443, com ela quando não é; o JSON vale; e o endereço
# é lido de volta pelo comando porta.
CONFIG_DIR=$(mktemp -d)
trap 'rm -rf "$CONFIG_DIR"' EXIT

escrever_config chat.exemplo.com.br 443
confere "config com a 443" '{"endereco": "chat.exemplo.com.br", "dados": "/var/lib/starsonic-chat"}' "$(cat "$CONFIG_DIR/config.json")"
confere "endereço lido (443)" chat.exemplo.com.br "$(ler_endereco)"

escrever_config chat.exemplo.com.br 8443
confere "config com a 8443" '{"endereco": "chat.exemplo.com.br", "dados": "/var/lib/starsonic-chat", "porta": 8443}' "$(cat "$CONFIG_DIR/config.json")"
confere "endereço lido (8443)" chat.exemplo.com.br "$(ler_endereco)"
confere "JSON válido (8443)" sim "$(python3 -c 'import json,sys; json.load(open(sys.argv[1])); print("sim")' "$CONFIG_DIR/config.json")"

confere "endereço público com a 443" https://chat.exemplo.com.br/ "$(endereco_publico chat.exemplo.com.br 443)"
confere "endereço público com a 8443" https://chat.exemplo.com.br:8443/ "$(endereco_publico chat.exemplo.com.br 8443)"

[ "$falhas" -eq 0 ] || exit 1
echo "tudo certo"
