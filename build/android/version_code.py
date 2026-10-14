#!/usr/bin/env python3
"""versionCode do app Android a partir da versão (spec 9.4).

versionCode = maior * 1.000.000 + menor * 10.000 + correção * 100 + rc, com a versão final valendo 99
no lugar do rc, para que toda versão nova tenha um código maior que a anterior
(0.1.0-rc.1 -> 10001; 0.1.0 -> 10099; 1.2.3-rc.4 -> 1020304).

Cada número precisa caber no seu lugar do código: rc de 1 a 98 (o 99 é da versão final), menor e
correção até 99, e o código até 2.100.000.000 (o máximo do Android), ou seja, maior até 2099.

Uso: version_code.py VERSAO   (X.Y.Z ou X.Y.Z-rc.N)
Imprime o versionCode; versão em outro formato -> mensagem de erro e código 2.
"""
import re
import sys

# O mesmo formato das versões do Windows (build/Build-App.ps1): números sem sinal e rc sem zero à esquerda.
VERSION = re.compile(r"([0-9]+)\.([0-9]+)\.([0-9]+)(?:-rc\.([1-9][0-9]*))?")
FINAL_RC = 99
MAX_CODE = 2100000000


def version_code(version):
    """O versionCode de X.Y.Z ou X.Y.Z-rc.N; ValueError se a versão não estiver no formato ou não couber."""
    match = VERSION.fullmatch(version)
    if not match:
        raise ValueError("versão inválida: %r (use X.Y.Z ou X.Y.Z-rc.N)" % version)
    major, minor, patch = (int(part) for part in match.group(1, 2, 3))
    rc = FINAL_RC
    if match.group(4) is not None:
        rc = int(match.group(4))
        if rc >= FINAL_RC:
            raise ValueError("versão inválida: %r (o rc vai de 1 a %d)" % (version, FINAL_RC - 1))
    if minor > 99 or patch > 99:
        raise ValueError("versão inválida: %r (menor e correção vão até 99)" % version)
    code = major * 1000000 + minor * 10000 + patch * 100 + rc
    if code > MAX_CODE:
        raise ValueError("versão inválida: %r (o versionCode passaria de %d)" % (version, MAX_CODE))
    return code


def main(argv):
    if len(argv) != 1:
        print("uso: version_code.py VERSAO   (X.Y.Z ou X.Y.Z-rc.N)", file=sys.stderr)
        return 2
    try:
        print(version_code(argv[0]))
    except ValueError as error:
        print("version_code: %s" % error, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
