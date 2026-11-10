#!/usr/bin/env python3
"""Descomprime o .bz2 do módulo H.264 da Cisco no CI (build/Test-OpenH264.ps1) com as regras do app, para o CI nunca
aceitar um arquivo que o app recusaria em todo computador:

- um fluxo bzip2 só, inteiro, e nenhum byte depois do fim dele (o Bunzip2 de windows/app/src/Bunzip.cpp);
- até 4 MiB comprimidos e 8 MiB descomprimidos (o fetch e o bunzip do starsonic/desktop/H264Module.cpp).

Uso: unpack_openh264.py <arquivo.bz2> <arquivo.dll>
Sai com 0 e grava o .dll; com 1, não grava nada e diz o motivo (em ASCII, para o log do Windows).
"""
import bz2
import sys

MAX_COMPRESSED = 4194304   # o fetch(url, 4194304, 60000) do H264Module
MAX_UNPACKED = 8388608     # o bunzip(corpo, 8388608) do H264Module


class UnpackError(Exception):
    pass


def unpack(data):
    """O .dll dentro do .bz2, ou UnpackError com o motivo."""
    if not data:
        raise UnpackError("o .bz2 esta vazio")
    if len(data) > MAX_COMPRESSED:
        raise UnpackError("o .bz2 tem mais que os %d bytes que o app baixa" % MAX_COMPRESSED)
    decompressor = bz2.BZ2Decompressor()
    try:
        out = decompressor.decompress(data, MAX_UNPACKED + 1)
    except (OSError, EOFError) as error:
        raise UnpackError("o .bz2 nao e um bzip2 valido (%s)" % error)
    if len(out) > MAX_UNPACKED:
        raise UnpackError("o .dll passa dos %d bytes que o app descomprime" % MAX_UNPACKED)
    if not decompressor.eof:
        raise UnpackError("o .bz2 esta cortado: o fluxo bzip2 nao chegou ao fim")
    if decompressor.unused_data:
        raise UnpackError("o .bz2 tem %d bytes depois do fim do fluxo bzip2 (o app recusa)"
                          % len(decompressor.unused_data))
    return out


def main(argv):
    if len(argv) != 2:
        print("uso: unpack_openh264.py <arquivo.bz2> <arquivo.dll>")
        return 2
    source, target = argv
    with open(source, "rb") as handle:
        data = handle.read(MAX_COMPRESSED + 1)
    try:
        out = unpack(data)
    except UnpackError as error:
        print("openh264: %s" % error)
        return 1
    with open(target, "wb") as handle:
        handle.write(out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
