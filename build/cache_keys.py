#!/usr/bin/env python3
"""As chaves dos caches do job windows do build.yml.

- deps: as dependências nativas (work/pjproject, work/vcpkg e work/webview2, uns 13 minutos para refazer): o
  build/deps.lock sem a chave webview2Bootstrapper, o build/config_site.h e o build/Build-Deps.ps1. O bootstrapper do
  WebView2 não entra: trocar a versão dele não refaz o pjproject nem o vcpkg.
- bootstrapper: o MicrosoftEdgeWebview2Setup.exe (work/webview2-bootstrapper), pelo SHA-256 dele no deps.lock. Com o
  cache, o build continua quando o endereço da Microsoft do deps.lock sai do ar.

O JSON é comparado pelo conteúdo (sem a formatação) e os textos sem a diferença de fim de linha (CRLF/LF).
Uso: cache_keys.py [--repo <pasta>] [--github-output <arquivo>]   (sem --github-output, imprime "nome=valor")
"""
import argparse
import hashlib
import json
import pathlib
import sys

BOOTSTRAPPER = "webview2Bootstrapper"


def compute(repo):
    build = pathlib.Path(repo) / "build"
    lock = json.loads((build / "deps.lock").read_text(encoding="utf-8"))
    bootstrapper = lock.pop(BOOTSTRAPPER, {}) or {}
    digest = hashlib.sha256()
    digest.update(json.dumps(lock, sort_keys=True, separators=(",", ":")).encode("utf-8"))
    for name in ("config_site.h", "Build-Deps.ps1"):
        digest.update(b"\0" + name.encode("ascii") + b"\0")
        digest.update((build / name).read_bytes().replace(b"\r\n", b"\n"))
    return {
        "deps": "deps-v2-" + digest.hexdigest(),
        "bootstrapper": "webview2-bootstrapper-" + str(bootstrapper.get("sha256", "nenhum")),
    }


def main(argv):
    parser = argparse.ArgumentParser(description="Chaves dos caches do job windows.")
    parser.add_argument("--repo", default=str(pathlib.Path(__file__).resolve().parent.parent))
    parser.add_argument("--github-output")
    args = parser.parse_args(argv)
    lines = ["%s=%s" % item for item in sorted(compute(args.repo).items())]
    if args.github_output:
        with open(args.github_output, "a", encoding="utf-8") as output:
            output.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
