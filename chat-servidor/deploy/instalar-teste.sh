#!/usr/bin/env bash
# Testa as conferências do instalar.sh e o config.json que ele grava. Não instala nada, não usa a
# rede nem o root.
# Rode: bash deploy/instalar-teste.sh
#
# Os stubs (systemctl, sleep, journalctl, conferir_maquina) são chamados pelas funções do
# instalar.sh, e não daqui: o shellcheck não vê.
# shellcheck disable=SC2329
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

# A versão mínima do comando porta.
for v in 0.1.1 0.1.2 0.1.10 0.2.0 1.0.0; do
  confere "versão $v serve" sim "$(if versao_ao_menos "$v" 0.1.1; then echo sim; else echo não; fi)"
done
for v in 0.1.0 0.0.9 0.1.0-rc.1; do
  confere "versão $v não serve" não "$(if versao_ao_menos "$v" 0.1.1; then echo sim; else echo não; fi)"
done

# O comando porta, com o systemctl, o sleep e o journalctl de mentira, e um programa de mentira
# que só diz a versão. Cada cenário roda num subshell, e o mudar_porta noutro, dentro dele: o
# falhar e as armadilhas (trap) ficam lá dentro. O resultado é "<ok ou falhou>|<config.json no
# fim>|<limpo, ou sobrou o config.json.antes>".
inicial='{"endereco": "chat.exemplo.com.br", "dados": "/var/lib/starsonic-chat"}'
com_8443='{"endereco": "chat.exemplo.com.br", "dados": "/var/lib/starsonic-chat", "porta": 8443}'
com_origens='{"endereco": "chat.exemplo.com.br", "dados": "/var/lib/starsonic-chat", "origens": ["https://a.exemplo.com.br"]}'
cenario_porta() { # cenario_porta <cenário> <versão do programa> <porta> <config.json no começo>
  local t_cenario=$1 t_versao=$2 t_porta=$3 t_comeco=$4
  (
    CONFIG_DIR=$(mktemp -d)
    printf '%s\n' "$t_comeco" >"$CONFIG_DIR/config.json"
    BINARIO=$CONFIG_DIR/programa
    printf '#!/bin/sh\necho %s\n' "$t_versao" >"$BINARIO"
    chmod +x "$BINARIO"
    # Os nomes dos stubs começam com t_, para não esbarrar nos "local" do instalar.sh.
    t_estado=$CONFIG_DIR/estado
    t_reinicios=$CONFIG_DIR/reinicios
    echo 0 >"$t_reinicios"
    conferir_maquina() { :; }
    journalctl() { :; }
    # ctrl-c: a conexão cai (HUP) no meio da espera.
    sleep() { if [ "$t_cenario" = ctrl-c ]; then kill -HUP "$BASHPID"; fi; }
    systemctl() {
      case "$1" in
        restart)
          [ "$t_cenario" != restart-falha ] || return 1
          # cai: o programa não aceita a porta e fica caindo e voltando.
          if [ "$t_cenario" = cai ] && grep -q '"porta"' "$CONFIG_DIR/config.json"; then
            echo caido >"$t_estado"
          else
            echo ativo >"$t_estado"
          fi
          ;;
        # corrida: a conferência cai no instante em que o programa que volta está "ativo".
        is-active) [ "$t_cenario" = corrida ] || [ "$(cat "$t_estado" 2>/dev/null)" = ativo ] ;;
        show)
          local t_n
          t_n=$(cat "$t_reinicios")
          echo "$t_n"
          if [ "$t_cenario" = corrida ]; then echo $((t_n + 1)) >"$t_reinicios"; fi
          ;;
      esac
    }
    # O mudar_porta roda com o set -e ligado, como na VM. Dentro de um if, o bash desligaria o
    # set -e, e um comando que falha seguiria em frente.
    local t_resultado t_sobra t_status
    set +e
    (set -e; mudar_porta "$t_porta") >/dev/null 2>&1
    t_status=$?
    set -e
    if [ "$t_status" -eq 0 ]; then t_resultado=ok; else t_resultado=falhou; fi
    if [ -e "$CONFIG_DIR/config.json.antes" ]; then t_sobra=sobrou; else t_sobra=limpo; fi
    echo "$t_resultado|$(cat "$CONFIG_DIR/config.json")|$t_sobra"
    rm -rf "$CONFIG_DIR"
  )
}
confere "porta: troca" "ok|$com_8443|limpo" "$(cenario_porta normal 0.1.1 8443 "$inicial")"
confere "porta: volta para a 443" "ok|$inicial|limpo" "$(cenario_porta normal 0.1.1 443 "$com_8443")"
confere "porta: programa antigo" "falhou|$inicial|limpo" "$(cenario_porta normal 0.1.0 8443 "$inicial")"
confere "porta: o programa cai" "falhou|$inicial|limpo" "$(cenario_porta cai 0.1.1 8443 "$inicial")"
confere "porta: a corrida com o RestartSec" "falhou|$inicial|limpo" "$(cenario_porta corrida 0.1.1 8443 "$inicial")"
confere "porta: o restart falha" "falhou|$inicial|limpo" "$(cenario_porta restart-falha 0.1.1 8443 "$inicial")"
confere "porta: a conexão cai no meio" "falhou|$inicial|limpo" "$(cenario_porta ctrl-c 0.1.1 8443 "$inicial")"
confere "porta: com origens" "falhou|$com_origens|limpo" "$(cenario_porta normal 0.1.1 8443 "$com_origens")"

[ "$falhas" -eq 0 ] || exit 1
echo "tudo certo"
