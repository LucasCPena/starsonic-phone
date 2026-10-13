#!/usr/bin/env python3
"""Portão da versão estável: confere se as entradas da Starsonic (spec 12) já chegaram.

Lista o que falta e devolve 1 quando:
- branding/branding.h ainda tem a conta provisória "definir-conta" ou
  STARSONIC_BRAND_IS_PLACEHOLDER 1 (cores provisórias);
- falta algum dos arquivos de REQUIRED_FILES (ícones, logos, tradução e imagem do instalador).

Uso: check_release_inputs.py --repo <pasta>   (código 0 = tudo pronto, 1 = falta algo)
"""
import argparse
import os
import pathlib
import re
import sys

REQUIRED_FILES = (
    "branding/overlay/microsip/res/microsip.ico",
    "branding/overlay/microsip/res/tray_inactive.ico",
    "branding/overlay/microsip/res/tray_missed.ico",
    "branding/logo-faixa.png",
    "branding/logo-entrar.png",
    "branding/langpack_portuguesebr.txt",
    "branding/installer/boas-vindas.bmp",
)
PLACEHOLDER_RE = re.compile(r"^\s*#\s*define\s+STARSONIC_BRAND_IS_PLACEHOLDER\s+1\b", re.MULTILINE)


def _read(path):
    try:
        return path.read_bytes().decode("utf-8", errors="replace")
    except OSError:
        return None


def find_missing(repo):
    """Lista de textos com o que falta (vazia quando tudo está pronto)."""
    root = pathlib.Path(repo)
    missing = []
    header = _read(root / "branding" / "branding.h")
    if header is None:
        missing.append("branding/branding.h: ausente")
    else:
        if "definir-conta" in header:
            missing.append("branding/branding.h: conta do GitHub provisoria (definir-conta)")
        if PLACEHOLDER_RE.search(header):
            missing.append("branding/branding.h: cores provisorias (STARSONIC_BRAND_IS_PLACEHOLDER 1)")
    for relative in REQUIRED_FILES:
        if not (root / relative).is_file():
            missing.append("%s: ausente" % relative)
    return missing


def main(argv):
    parser = argparse.ArgumentParser(description="Confere as entradas da Starsonic antes da versao estavel.")
    parser.add_argument("--repo", default=str(pathlib.Path(__file__).resolve().parent.parent))
    args = parser.parse_args(argv)
    missing = find_missing(args.repo)
    for item in missing:
        print(item)
        if os.environ.get("GITHUB_ACTIONS") == "true":
            print("::error title=entradas::" + item.replace("%", "%25"))
    if missing:
        print("entradas: falta(m) %d item(ns) para a versao estavel" % len(missing))
        return 1
    print("ok: entradas da Starsonic completas")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
