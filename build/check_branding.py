#!/usr/bin/env python3
"""Reprova o build se "MicroSIP" aparecer em texto visível ao usuário.

Onde procura (spec 11.2):
- literais de texto dos recursos: microsip/**/*.rc|*.rc2 e starsonic/**/*.rc;
- tradução: branding/langpack_*.txt (só as linhas de tradução, não as chaves [..]);
- instalador: installer/*.nsi|*.nsh (fora dos comentários);
- literais de texto do código novo: starsonic/**/*.cpp|*.h e branding/branding.h;
- no executável (--exe): texto ASCII e UTF-16LE.

Só "MicroSIP" exato conta (maiúsculas importam). Uma ocorrência é aceita quando vem logo
depois de "Copyright (c) 2011-2025, " (aviso de copyright do recurso de versão) ou de
"Baseado no "/"baseado no " (atribuição da tela Sobre).

Uso: check_branding.py --repo <pasta> [--exe <arquivo>]   (código 0 = ok, 1 = problemas)
"""
import argparse
import pathlib
import sys

NAME = "MicroSIP"
ALLOWED_PREFIXES = ("Copyright (c) 2011-2025, ", "Baseado no ", "baseado no ")
SKIPPED_PARTS = {"third_party", "generated"}
BS = chr(92)  # barra invertida


def _bad_occurrences(text):
    """Posições de NAME em text que não vêm depois de um prefixo permitido."""
    bad = []
    start = 0
    while True:
        index = text.find(NAME, start)
        if index < 0:
            return bad
        if not any(text[:index].endswith(prefix) for prefix in ALLOWED_PREFIXES):
            bad.append(index)
        start = index + len(NAME)


def _snippet(text, limit=120):
    text = " ".join(text.split())
    return text if len(text) <= limit else text[:limit - 3] + "..."


def _decode(data):
    if data.startswith(b"\xff\xfe") or data.startswith(b"\xfe\xff"):
        return data.decode("utf-16")
    if data.startswith(b"\xef\xbb\xbf"):
        return data[3:].decode("utf-8", errors="replace")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("cp1252", errors="replace")


def _literals(text):
    """(linha, conteúdo) de cada literal "..." de C/C++/RC, ignorando comentários."""
    found = []
    line = 1
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if text.startswith("//", i):
            end = text.find("\n", i)
            i = n if end < 0 else end
            continue
        if text.startswith("/*", i):
            end = text.find("*/", i + 2)
            end = n if end < 0 else end + 2
            line += text.count("\n", i, end)
            i = end
            continue
        if ch in "\"'":
            j = i + 1
            while j < n and text[j] != ch and text[j] != "\n":
                j += 2 if text[j] == BS else 1
            if ch == '"':
                found.append((line, text[i + 1:min(j, n)]))
            i = j + 1
            continue
        if ch == "\n":
            line += 1
        i += 1
    return found


def _check_literals(text):
    return [(number, literal) for number, literal in _literals(text) if _bad_occurrences(literal)]


def _check_langpack(text):
    problems = []
    in_body = False
    for number, line in enumerate(text.splitlines(), start=1):
        if line.startswith("["):
            in_body = True
            continue
        if not in_body or line.startswith(";"):
            continue
        if _bad_occurrences(line):
            problems.append((number, line))
    return problems


def _check_nsis(text):
    problems = []
    for number, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if stripped.startswith(";") or stripped.startswith("#"):
            continue
        if _bad_occurrences(line):
            problems.append((number, line))
    return problems


def _files(root, directory, patterns):
    base = root / directory
    if not base.is_dir():
        return []
    paths = set()
    for pattern in patterns:
        for path in base.rglob(pattern):
            if path.is_file() and not any(part in SKIPPED_PARTS for part in path.relative_to(root).parts):
                paths.add(path)
    return sorted(paths)


def find_problems(repo):
    """Lista de (caminho relativo, linha, trecho)."""
    root = pathlib.Path(repo)
    checks = []
    checks += [(path, _check_literals) for path in _files(root, "microsip", ("*.rc", "*.rc2"))]
    checks += [(path, _check_literals) for path in _files(root, "starsonic", ("*.rc", "*.cpp", "*.h"))]
    branding_header = root / "branding" / "branding.h"
    if branding_header.is_file():
        checks.append((branding_header, _check_literals))
    branding = root / "branding"
    if branding.is_dir():
        checks += [(path, _check_langpack) for path in sorted(branding.glob("langpack_*.txt"))]
    checks += [(path, _check_nsis) for path in _files(root, "installer", ("*.nsi", "*.nsh"))]
    found = []
    for path, check in checks:
        text = _decode(path.read_bytes())
        relative = path.relative_to(root).as_posix()
        found.extend((relative, number, _snippet(snippet)) for number, snippet in check(text))
    return found


def _exe_occurrences(data, encode, label):
    pattern = encode(NAME)
    prefixes = [encode(prefix) for prefix in ALLOWED_PREFIXES]
    bad = []
    start = 0
    while True:
        index = data.find(pattern, start)
        if index < 0:
            return bad
        if not any(data[:index].endswith(prefix) for prefix in prefixes):
            context = data[max(0, index - 32 * len(encode("a"))):index + len(pattern)]
            text = context.decode("utf-16-le" if label == "UTF-16LE" else "latin-1", errors="replace")
            bad.append((index, "%s: %s" % (label, _snippet(text.replace("\x00", " ")))))
        start = index + len(pattern)


def find_exe_problems(exe):
    """Lista de (nome do arquivo, posição em bytes, trecho)."""
    path = pathlib.Path(exe)
    data = path.read_bytes()
    found = _exe_occurrences(data, lambda text: text.encode("ascii"), "ASCII")
    found += _exe_occurrences(data, lambda text: text.encode("utf-16-le"), "UTF-16LE")
    return [(path.name, offset, snippet) for offset, snippet in sorted(found)]


def main(argv):
    parser = argparse.ArgumentParser(description="Procura MicroSIP em textos visíveis.")
    parser.add_argument("--repo", default=str(pathlib.Path(__file__).resolve().parent.parent))
    parser.add_argument("--exe", action="append", default=[])
    args = parser.parse_args(argv)
    found = find_problems(args.repo)
    for exe in args.exe:
        found += find_exe_problems(exe)
    for relative, number, snippet in found:
        print("%s:%d: %s" % (relative, number, snippet))
    if found:
        print("marca: %d texto(s) visivel(is) com %s" % (len(found), NAME))
        return 1
    print("ok: nenhum texto visivel com %s" % NAME)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
