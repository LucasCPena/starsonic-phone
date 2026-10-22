#!/usr/bin/env python3
"""Gera o sal e a chave PBKDF2-HMAC-SHA256 da senha do administrador (spec 6.1) para o starsonic/desktop/Admin.cpp.

A senha nunca fica no repositorio: ela vem da variavel de ambiente STARSONIC_ADMIN_PASSWORD ou e digitada (sem eco).
A saida sao as duas constantes do C++ (sal de 16 bytes, chave de 32 bytes, 100 000 iteracoes); cole-as em Admin.cpp.

Uso:
    STARSONIC_ADMIN_PASSWORD=... python3 build/admin_hash.py          # sal novo, ao acaso
    STARSONIC_ADMIN_PASSWORD=... python3 build/admin_hash.py --salt <32 hex>   # sal fixo (para conferir)
"""
import argparse
import getpass
import hashlib
import os
import secrets
import sys

ITERATIONS = 100000
SALT_BYTES = 16
KEY_BYTES = 32


def derive(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ITERATIONS, KEY_BYTES)


def _array(name, data):
    lines = []
    for start in range(0, len(data), 8):
        lines.append("    " + ", ".join("0x%02x" % byte for byte in data[start:start + 8]) + ",")
    return "const uint8_t %s[%d] = {\n%s\n};" % (name, len(data), "\n".join(lines))


def render(salt, key):
    return "constexpr uint32_t kIterations = %d;\n%s\n%s\n" % (
        ITERATIONS, _array("kSalt", salt), _array("kKey", key))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--salt", help="o sal em hexadecimal (32 digitos); sem ele, um sal novo ao acaso")
    args = parser.parse_args(argv)
    password = os.environ.get("STARSONIC_ADMIN_PASSWORD")
    if not password:
        password = getpass.getpass("Senha do administrador: ")
    if not password:
        print("Senha vazia.", file=sys.stderr)
        return 1
    if args.salt:
        salt = bytes.fromhex(args.salt)
        if len(salt) != SALT_BYTES:
            print("O sal tem de ter %d bytes." % SALT_BYTES, file=sys.stderr)
            return 1
    else:
        salt = secrets.token_bytes(SALT_BYTES)
    sys.stdout.write(render(salt, derive(password, salt)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
