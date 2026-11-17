#!/usr/bin/env bash
# Testa as conferências do instalar.sh e o config.json que ele grava. Não instala nada, não usa a
# rede nem o root.
# Rode: bash deploy/instalar-teste.sh
#
# Os stubs (systemctl, sleep, journalctl, conferir_maquina) são chamados pelas funções do
# instalar.sh, e não daqui: o shellcheck não vê.
# shellcheck disable=SC2317,SC2329
# O CONFIG_DIR de cada cenário é de um subshell, e o de cima, o do teste: o shellcheck confunde os dois.
# shellcheck disable=SC2030,SC2031
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
# cenario_mudar <cenário> <versão do programa> <config.json no começo> <comando|argumento[|argumento]>...: roda os comandos
# um depois do outro, na mesma pasta, e para no primeiro que falha. A saída do último vai para $SAIDAS/ultima.
cenario_mudar() {
  local t_cenario=$1 t_versao=$2 t_comeco=$3
  shift 3
  local -a t_comandos=("$@")
  (
    CONFIG_DIR=$(mktemp -d)
    printf '%s\n' "$t_comeco" >"$CONFIG_DIR/config.json"
    BINARIO=$CONFIG_DIR/programa
    printf '#!/bin/sh\necho %s\n' "$t_versao" >"$BINARIO"
    chmod +x "$BINARIO"
    # Os nomes dos stubs começam com t_, para não esbarrar nos "local" do instalar.sh.
    t_estado=$CONFIG_DIR/estado
    t_reinicios=$CONFIG_DIR/reinicios
    t_chamadas=$CONFIG_DIR/restarts
    echo 0 >"$t_reinicios"
    : >"$t_chamadas"
    conferir_maquina() { :; }
    journalctl() { :; }
    # ctrl-c: a conexão cai (HUP) no meio da espera.
    sleep() { if [ "$t_cenario" = ctrl-c ]; then kill -HUP "$BASHPID"; fi; }
    systemctl() {
      case "$1" in
        restart)
          echo restart >>"$t_chamadas"
          [ "$t_cenario" != restart-falha ] || return 1
          # cai: o programa não aceita a configuração nova (a porta ou o certificadoDoVideo) e fica caindo e voltando.
          if [ "$t_cenario" = cai ] && grep -q '"porta"\|"certificadoDoVideo"' "$CONFIG_DIR/config.json"; then
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
    # O comando roda com o set -e ligado, como na VM. Dentro de um if, o bash desligaria o set -e, e um comando que
    # falha seguiria em frente.
    local t_resultado=ok t_sobra t_status t_comando t_args
    for t_comando in "${t_comandos[@]}"; do
      IFS='|' read -r -a t_args <<<"$t_comando"
      set +e
      (set -e; "${t_args[@]}") >"$SAIDAS/ultima" 2>&1
      t_status=$?
      set -e
      if [ "$t_status" -ne 0 ]; then
        t_resultado=falhou
        break
      fi
    done
    if [ -e "$CONFIG_DIR/config.json.antes" ]; then t_sobra=sobrou; else t_sobra=limpo; fi
    echo "$t_resultado|$(cat "$CONFIG_DIR/config.json")|$t_sobra"
    paste -sd ';' "$t_chamadas" >"$SAIDAS/restarts"
    rm -rf "$CONFIG_DIR"
  )
}
SAIDAS=$(mktemp -d)
trap 'rm -rf "$CONFIG_DIR" "$SAIDAS"' EXIT
cenario_porta() { # cenario_porta <cenário> <versão do programa> <porta> <config.json no começo>
  cenario_mudar "$1" "$2" "$4" "mudar_porta|$3"
}
confere "porta: troca" "ok|$com_8443|limpo" "$(cenario_porta normal 0.1.1 8443 "$inicial")"
confere "porta: volta para a 443" "ok|$inicial|limpo" "$(cenario_porta normal 0.1.1 443 "$com_8443")"
confere "porta: programa antigo" "falhou|$inicial|limpo" "$(cenario_porta normal 0.1.0 8443 "$inicial")"
confere "porta: o programa cai" "falhou|$inicial|limpo" "$(cenario_porta cai 0.1.1 8443 "$inicial")"
confere "porta: a corrida com o RestartSec" "falhou|$inicial|limpo" "$(cenario_porta corrida 0.1.1 8443 "$inicial")"
confere "porta: o restart falha" "falhou|$inicial|limpo" "$(cenario_porta restart-falha 0.1.1 8443 "$inicial")"
confere "porta: a conexão cai no meio" "falhou|$inicial|limpo" "$(cenario_porta ctrl-c 0.1.1 8443 "$inicial")"
confere "porta: com origens" "falhou|$com_origens|limpo" "$(cenario_porta normal 0.1.1 8443 "$com_origens")"

# --- o certificadoDoVideo: o IP da VM do vídeo, o config.json e o comando video ---
for ip in 10.0.0.20 10.255.255.255 172.16.0.1 172.31.255.254 192.168.1.9 10.0.0.0; do
  confere "IP $ip serve" sim "$(aceita conferir_ip_privado "$ip")"
done
# Públicos, de loopback, do CGNAT, do link local, fora da faixa, com zero na frente, e o que não é um IPv4.
for ip in 203.0.113.10 8.8.8.8 127.0.0.1 0.0.0.0 100.64.0.1 169.254.1.1 172.15.0.1 172.32.0.1 192.167.0.1 192.169.0.1 \
  10.0.0.256 10.0.0.300 10.0.0.05 010.0.0.20 10.0.20 10.0.0.20.1 10.0.0. fd00::20 ::ffff:10.0.0.20 video.interno "" " 10.0.0.20" "10.0.0.20 " 10.0.0.20x; do
  confere "IP [$ip] não serve" não "$(aceita conferir_ip_privado "$ip")"
done

escrever_config chat.exemplo.com.br 443 video.exemplo.com.br 10.0.0.20
com_video='{"endereco": "chat.exemplo.com.br", "dados": "/var/lib/starsonic-chat", "certificadoDoVideo": {"endereco": "video.exemplo.com.br", "ip": "10.0.0.20"}}'
com_8443_video='{"endereco": "chat.exemplo.com.br", "dados": "/var/lib/starsonic-chat", "porta": 8443, "certificadoDoVideo": {"endereco": "video.exemplo.com.br", "ip": "10.0.0.20"}}'
confere "config com o vídeo e a 443" "$com_video" "$(cat "$CONFIG_DIR/config.json")"
confere "config com o vídeo é JSON" sim "$(python3 -c 'import json,sys; c=json.load(open(sys.argv[1])); print("sim" if c["certificadoDoVideo"] == {"endereco": "video.exemplo.com.br", "ip": "10.0.0.20"} and "porta" not in c else "não")' "$CONFIG_DIR/config.json")"
confere "o endereço do chat, com o vídeo no config" chat.exemplo.com.br "$(ler_endereco)"
confere "o endereço do vídeo lido" video.exemplo.com.br "$(ler_video endereco)"
confere "o IP do vídeo lido" 10.0.0.20 "$(ler_video ip)"
confere "a porta lida sem a porta" 443 "$(ler_porta)"
escrever_config chat.exemplo.com.br 8443 video.exemplo.com.br 10.0.0.20
confere "config com o vídeo e a 8443" "$com_8443_video" "$(cat "$CONFIG_DIR/config.json")"
confere "config com o vídeo e a 8443 é JSON" sim "$(python3 -c 'import json,sys; c=json.load(open(sys.argv[1])); print("sim" if c["porta"] == 8443 and c["certificadoDoVideo"]["ip"] == "10.0.0.20" else "não")' "$CONFIG_DIR/config.json")"
confere "o endereço do chat, com o vídeo e a porta" chat.exemplo.com.br "$(ler_endereco)"
confere "a porta lida" 8443 "$(ler_porta)"
escrever_config chat.exemplo.com.br 8443
confere "sem o vídeo, nada é lido" "" "$(ler_video endereco)$(ler_video ip)"
confere "sem o vídeo, o config é o de antes" "$com_8443" "$(cat "$CONFIG_DIR/config.json")"

confere "video: liga o repasse" "ok|$com_video|limpo" "$(cenario_mudar normal 0.2.0 "$inicial" "mudar_video|video.exemplo.com.br|10.0.0.20")"
confere "video: um restart só" "restart" "$(cat "$SAIDAS/restarts")"
confere "video: a mensagem de sucesso" \
  "Pronto: o chat agora repassa ao servidor de vídeo video.exemplo.com.br (a VM 10.0.0.20, pela rede interna) a verificação do certificado dele, que chega na porta 80. O instalador do servidor de vídeo já pode pedir o certificado." \
  "$(cat "$SAIDAS/ultima")"
confere "video: guarda a porta" "ok|$com_8443_video|limpo" "$(cenario_mudar normal 0.2.0 "$com_8443" "mudar_video|video.exemplo.com.br|10.0.0.20")"
confere "video: troca o vídeo que já estava" "ok|$com_video|limpo" \
  "$(cenario_mudar normal 0.2.0 "${com_video//10.0.0.20/10.9.9.9}" "mudar_video|video.exemplo.com.br|10.0.0.20")"
confere "video: versão 0.2.1 serve" "ok|$com_video|limpo" "$(cenario_mudar normal 0.2.1 "$inicial" "mudar_video|video.exemplo.com.br|10.0.0.20")"
confere "video: programa antigo" "falhou|$inicial|limpo" "$(cenario_mudar normal 0.1.1 "$inicial" "mudar_video|video.exemplo.com.br|10.0.0.20")"
confere "video: com origens, recusa e não muda" "falhou|$com_origens|limpo" "$(cenario_mudar normal 0.2.0 "$com_origens" "mudar_video|video.exemplo.com.br|10.0.0.20")"
confere "video: com origens, o erro diz o motivo" sim "$(if grep -q 'tem "origens"' "$SAIDAS/ultima"; then echo sim; else echo não; fi)"
confere "video: com origens, nenhum restart" "" "$(cat "$SAIDAS/restarts")"
confere "video: o nome do próprio chat" "falhou|$inicial|limpo" "$(cenario_mudar normal 0.2.0 "$inicial" "mudar_video|chat.exemplo.com.br|10.0.0.20")"
confere "video: o nome do próprio chat, nenhum restart" "" "$(cat "$SAIDAS/restarts")"
for v in https://video.exemplo.com.br video.exemplo.com.br:7443 Video.Exemplo.com.br video 203.0.113.10 video.exemplo.com.br/x; do
  confere "video: nome [$v] não serve, e nada muda" "falhou|$inicial|limpo" "$(cenario_mudar normal 0.2.0 "$inicial" "mudar_video|$v|10.0.0.20")"
done
for ip in 203.0.113.10 127.0.0.1 10.0.0.300 10.0.20 fd00::20; do
  confere "video: IP [$ip] não serve, e nada muda" "falhou|$inicial|limpo" "$(cenario_mudar normal 0.2.0 "$inicial" "mudar_video|video.exemplo.com.br|$ip")"
done
confere "video: o programa cai, e a configuração de antes volta" "falhou|$inicial|limpo" "$(cenario_mudar cai 0.2.0 "$inicial" "mudar_video|video.exemplo.com.br|10.0.0.20")"
confere "video: o programa cai: o restart da volta também acontece" "restart;restart" "$(cat "$SAIDAS/restarts")"
confere "video: a corrida com o RestartSec" "falhou|$inicial|limpo" "$(cenario_mudar corrida 0.2.0 "$inicial" "mudar_video|video.exemplo.com.br|10.0.0.20")"
confere "video: o restart falha" "falhou|$inicial|limpo" "$(cenario_mudar restart-falha 0.2.0 "$inicial" "mudar_video|video.exemplo.com.br|10.0.0.20")"
confere "video: a conexão cai no meio" "falhou|$inicial|limpo" "$(cenario_mudar ctrl-c 0.2.0 "$inicial" "mudar_video|video.exemplo.com.br|10.0.0.20")"
confere "video: com a porta, o programa cai, e a configuração de antes volta" "falhou|$com_8443|limpo" \
  "$(cenario_mudar cai 0.2.0 "$com_8443" "mudar_video|video.exemplo.com.br|10.0.0.20")"
confere "video: o rollback diz que voltou" sim "$(if grep -q 'A configuração de antes voltou' "$SAIDAS/ultima"; then echo sim; else echo não; fi)"
confere "porta e depois video: cada um guarda o outro" "ok|$com_8443_video|limpo" \
  "$(cenario_mudar normal 0.2.0 "$inicial" "mudar_porta|8443" "mudar_video|video.exemplo.com.br|10.0.0.20")"
confere "video e depois porta: cada um guarda o outro" "ok|$com_8443_video|limpo" \
  "$(cenario_mudar normal 0.2.0 "$inicial" "mudar_video|video.exemplo.com.br|10.0.0.20" "mudar_porta|8443")"
confere "video, porta e de volta para a 443: o vídeo fica" "ok|$com_video|limpo" \
  "$(cenario_mudar normal 0.2.0 "$inicial" "mudar_video|video.exemplo.com.br|10.0.0.20" "mudar_porta|8443" "mudar_porta|443")"
confere "porta com o vídeo: o rollback guarda o vídeo" "falhou|$com_video|limpo" \
  "$(cenario_mudar cai 0.2.0 "$com_video" "mudar_porta|8443")"

# As mensagens do nome do vídeo falam do vídeo, e não do chat (o nome é conferido antes de qualquer outra coisa).
ex_video="Exemplo: sudo bash instalar.sh video video.exemplo.com.br 10.0.0.20"
msg_nome='O primeiro valor é o nome do servidor de vídeo no DNS, só com letras minúsculas, números, pontos e hífens, sem https:// e sem a porta, e o segundo é o IP interno da VM de vídeo.'
for v in Video.Exemplo.com.br video.exemplo.com.br:7443 https://video.exemplo.com.br video video.exemplo.com.br/x ""; do
  confere "video: a mensagem do nome [$v]" "ERRO: o nome do vídeo \"$v\" não serve. $msg_nome $ex_video" "$( (mudar_video "$v" 10.0.0.20) 2>&1)"
done
confere "video: os dois valores trocados" \
  "ERRO: o nome do vídeo \"10.0.0.20\" é um número de IP. Parece que os dois valores estão trocados: o primeiro é o nome do servidor de vídeo no DNS, e o segundo é o IP interno da VM de vídeo. $ex_video" \
  "$( (mudar_video 10.0.0.20 video.exemplo.com.br) 2>&1)"
confere "video: nenhuma mensagem fala do nome do chat" 0 "$( ( (mudar_video Video.Exemplo.com.br 10.0.0.20; mudar_video 10.0.0.20 video.exemplo.com.br) 2>&1 || true) | grep -c 'nome do chat')"

# Um config.json mudado à mão, em outro formato, faz o porta e o video pararem antes de mudar algo.
# shellcheck disable=SC2034
{
a_mao=$'{\n  "endereco": "chat.exemplo.com.br",\n  "dados": "/var/lib/starsonic-chat"\n}'
objeto_na_linha=$'{"endereco": "chat.exemplo.com.br", "dados": "/var/lib/starsonic-chat", "certificadoDoVideo": {"endereco": "video.exemplo.com.br",\n"ip": "10.0.0.20"}}'
objeto_sem_ip='{"endereco": "chat.exemplo.com.br", "dados": "/var/lib/starsonic-chat", "certificadoDoVideo": {"endereco": "video.exemplo.com.br"}}'
}
for caso in a_mao objeto_na_linha objeto_sem_ip; do
  for cmd in "mudar_porta|8443" "mudar_video|video2.exemplo.com.br|10.0.0.21"; do
    confere "$caso: $cmd para, e o config.json fica como estava" "falhou|${!caso}|limpo" "$(cenario_mudar normal 0.2.0 "${!caso}" "$cmd")"
    confere "$caso: $cmd não reinicia nada" "" "$(cat "$SAIDAS/restarts")"
    confere "$caso: $cmd diz que foi mudado à mão" sim "$(if grep -q 'foi mudado à mão e não está na linha única que este instalador grava. Nada mudou.' "$SAIDAS/ultima"; then echo sim; else echo não; fi)"
  done
done

# O uso: o comando video com os argumentos errados.
codigo_de() { local c=0; (principal "$@") >/dev/null 2>&1 || c=$?; echo "$c"; }
confere "video sem argumentos" 2 "$(codigo_de video)"
confere "video com um argumento" 2 "$(codigo_de video video.exemplo.com.br)"
confere "video com três argumentos" 2 "$(codigo_de video video.exemplo.com.br 10.0.0.20 x)"
confere "video com o --versao" 2 "$(codigo_de video video.exemplo.com.br 10.0.0.20 --versao 0.2.0)"

[ "$falhas" -eq 0 ] || exit 1
echo "tudo certo"
