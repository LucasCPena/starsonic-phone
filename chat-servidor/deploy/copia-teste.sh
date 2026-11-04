#!/usr/bin/env bash
# Testa a escolha das pastas do apagados que o copia.sh apaga. Não usa rclone nem o servidor.
# Rode: bash deploy/copia-teste.sh
set -euo pipefail

aqui=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=./copia.sh
# shellcheck disable=SC1091
. "$aqui/copia.sh"

falhas=0
confere() { # confere <nome> <esperado> <recebido>
  if [ "$2" = "$3" ]; then
    echo "ok   $1"
  else
    echo "ERRO $1: esperava [$2], veio [$3]"
    falhas=$((falhas + 1))
  fi
}

entrada=$'2026-10-04/\n2026-10-05/\n2026-09-01/\n2026-11-04/\n2026-11-05/\n2020-13-45/\nnotas/\n2026-10-04\n2026-10-3/\n\n'

# Hoje é 4/11/2026: o limite é 5/10/2026. Fica de 5/10 em diante; sai o que é anterior.
confere "hoje 2026-11-04" $'2026-10-04\n2026-09-01\n2026-10-04' "$(pastas_vencidas 2026-11-04 <<<"$entrada")"
# Um dia depois, 5/10 também passa de 30 dias.
confere "hoje 2026-11-05" $'2026-10-04\n2026-10-05\n2026-09-01\n2026-10-04' "$(pastas_vencidas 2026-11-05 <<<"$entrada")"
# Virada de ano e fevereiro bissexto: 2028-03-01 menos 30 dias é 2028-01-31.
confere "virada" $'2028-01-30' "$(pastas_vencidas 2028-03-01 <<<$'2028-01-30/\n2028-01-31/\n2028-02-29/')"
confere "vazio" "" "$(pastas_vencidas 2026-11-04 <<<"")"

[ "$falhas" -eq 0 ] || exit 1
echo "tudo certo"
