#!/usr/bin/env python3
"""Gera o versao.json de uma versão (spec 7.4), lido pelo atualizador do app.

Uso: make_manifest.py --version <X.Y.Z[-rc.N]> --installer-url <url> --sha256 <hex>
                      [--notes-file <txt>] --out versao.json

Grava exatamente as chaves versao, instalador, sha256 (minúsculas) e notas (texto do arquivo,
sem BOM e sem espaços nas pontas; vazio sem --notes-file), em UTF-8 sem escapar acentos.
Recusa (código 1, sem gravar nada) o que o app recusaria: versão fora do formato, SHA-256 que
não tem 64 dígitos hexadecimais e instalador que não é https ou que tem caracteres fora de
letras, dígitos, '.', '_', '-' e '/' (ou "..") no caminho.
"""
import argparse
import json
import pathlib
import re
import sys

VERSION_RE = re.compile(r"\A\d{1,9}\.\d{1,9}\.\d{1,9}(-rc\.[1-9]\d{0,8})?\Z")
SHA256_RE = re.compile(r"\A[0-9a-fA-F]{64}\Z")
BOM = chr(0xFEFF)
URL_RE = re.compile(r"\Ahttps://[A-Za-z0-9.-]+/[A-Za-z0-9._/-]*\Z")


def build(version, installer_url, sha256, notes=""):
    """Dicionário do versao.json; ValueError com o motivo se algum campo for inválido."""
    if not VERSION_RE.match(version):
        raise ValueError("versao invalida: %r (use X.Y.Z ou X.Y.Z-rc.N)" % version)
    if not SHA256_RE.match(sha256):
        raise ValueError("sha256 invalido: %r (64 digitos hexadecimais)" % sha256)
    if not URL_RE.match(installer_url) or ".." in installer_url:
        raise ValueError("instalador invalido: %r (https, so letras, digitos, '.', '_', '-' e '/')" % installer_url)
    return {"versao": version, "instalador": installer_url, "sha256": sha256.lower(), "notas": notes}


def read_notes(path):
    text = pathlib.Path(path).read_bytes().decode("utf-8")
    if text.startswith(BOM):
        text = text[1:]
    return text.strip()


def main(argv):
    parser = argparse.ArgumentParser(description="Gera o versao.json de uma versao.")
    parser.add_argument("--version", required=True)
    parser.add_argument("--installer-url", required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--notes-file")
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    try:
        notes = read_notes(args.notes_file) if args.notes_file else ""
        manifest = build(args.version, args.installer_url, args.sha256, notes)
    except (ValueError, OSError) as error:
        print("make_manifest: %s" % error, file=sys.stderr)
        return 1
    text = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    pathlib.Path(args.out).write_bytes(text.encode("utf-8"))
    print("versao.json: %s (%s)" % (manifest["versao"], args.out))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
