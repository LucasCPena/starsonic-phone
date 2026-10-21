#!/usr/bin/env python3
"""Reprova o build se "MicroSIP" aparecer em texto visível ao usuário.

Onde procura (spec 11.2):
- literais de texto dos recursos: microsip/**/*.rc|*.rc2 e starsonic/**/*.rc;
- tradução: branding/langpack_*.txt (só as linhas de tradução, não as chaves [..]);
- instalador: installer/*.nsi|*.nsh (fora dos comentários);
- literais de texto do código novo: starsonic/**/*.cpp|*.h e branding/branding.h;
- no executável (--exe): texto ASCII e UTF-16LE.
- no app novo (spec da W1, 11.2), sem nenhuma exceção: o StarsonicPhone.exe novo (--app-novo), cada
  arquivo da pasta ui (--ui) e o instalador novo (--instalador), em ASCII/UTF-8 e UTF-16LE.

Só "MicroSIP" exato conta (maiúsculas importam). No app antigo, uma ocorrência é aceita quando vem
logo depois de "Copyright (c) 2011-2025, " (aviso de copyright do recurso de versão) ou de
"Baseado no "/"baseado no " (atribuição da tela Sobre); no app novo, nenhuma.

No executável, também reprova endereços do MicroSIP ("microsip.org", sem diferenciar
maiúsculas) fora do aviso "MicroSIP (www.microsip.org)" do copyright (M10: o app não fala
com os servidores do MicroSIP).

Uso: check_branding.py --repo <pasta> [--exe <arquivo>] [--app-novo <exe>] [--ui <pasta>] [--instalador <exe>]
     (código 0 = ok, 1 = problemas)
"""
import argparse
import os
import pathlib
import sys

NAME = "MicroSIP"
ALLOWED_PREFIXES = ("Copyright (c) 2011-2025, ", "Baseado no ", "baseado no ")
HOST = "microsip.org"
ALLOWED_HOST_TEXT = "MicroSIP (www.microsip.org)"   # aviso de copyright do recurso de versão
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


def _exe_host_occurrences(data, encode, label):
    pattern = encode(HOST)
    allowed = encode(ALLOWED_HOST_TEXT)
    allowed_offset = len(encode(ALLOWED_HOST_TEXT[:ALLOWED_HOST_TEXT.lower().index(HOST)]))
    lowered = data.lower()   # só letras ASCII mudam, também dentro do UTF-16LE
    unit = len(encode("a"))
    bad = []
    start = 0
    while True:
        index = lowered.find(pattern, start)
        if index < 0:
            return bad
        begin = index - allowed_offset
        if begin < 0 or data[begin:begin + len(allowed)] != allowed:
            context = data[max(0, index - 32 * unit):index + len(pattern)]
            text = context.decode("utf-16-le" if label == "UTF-16LE" else "latin-1", errors="replace")
            bad.append((index, "%s: %s" % (label, _snippet(text.replace("\x00", " ")))))
        start = index + len(pattern)


def find_exe_host_problems(exe):
    """Endereços do MicroSIP (microsip.org, sem diferenciar maiúsculas) no executável, fora do
    aviso de copyright: o app não pode falar com os servidores do MicroSIP (atualização,
    relatório de falha). Lista de (nome do arquivo, posição em bytes, trecho)."""
    path = pathlib.Path(exe)
    data = path.read_bytes()
    found = _exe_host_occurrences(data, lambda text: text.encode("ascii"), "ASCII")
    found += _exe_host_occurrences(data, lambda text: text.encode("utf-16-le"), "UTF-16LE")
    return [(path.name, offset, snippet) for offset, snippet in sorted(found)]


def _strict_occurrences(data, encode, label):
    """Todas as posições de NAME (exato) e de HOST (sem diferenciar maiúsculas) em data."""
    unit = len(encode("a"))
    bad = []
    for pattern, haystack in ((encode(NAME), data), (encode(HOST), data.lower())):
        start = 0
        while True:
            index = haystack.find(pattern, start)
            if index < 0:
                break
            context = data[max(0, index - 32 * unit):index + len(pattern)]
            text = context.decode("utf-16-le" if label == "UTF-16LE" else "latin-1", errors="replace")
            bad.append((index, "%s: %s" % (label, _snippet(text.replace("\x00", " ")))))
            start = index + len(pattern)
    return bad


def _strict_bytes(data):
    found = _strict_occurrences(data, lambda text: text.encode("ascii"), "ASCII")
    found += _strict_occurrences(data, lambda text: text.encode("utf-16-le"), "UTF-16LE")
    return sorted(found)


def find_strict_problems(path):
    """O app novo e o instalador novo: nenhum "MicroSIP" nem "microsip.org", sem exceção (nem o copyright
    nem o "Baseado no" do app antigo). Lista de (nome do arquivo, posição em bytes, trecho)."""
    path = pathlib.Path(path)
    return [(path.name, offset, snippet) for offset, snippet in _strict_bytes(path.read_bytes())]


def find_ui_problems(folder):
    """Cada arquivo da pasta ui\\ do app novo (HTML, JavaScript, CSS, imagens e fonte), como bytes: o texto em
    UTF-8 e em UTF-16LE. Lista de (ui/<caminho>, posição em bytes, trecho); a pasta que falta também é um problema."""
    folder = pathlib.Path(folder)
    if not folder.is_dir():
        return [(folder.name or str(folder), 0, "a pasta da interface nao existe: %s" % folder)]
    found = []
    for path in sorted(item for item in folder.rglob("*") if item.is_file()):
        relative = pathlib.PurePosixPath(folder.name, path.relative_to(folder).as_posix()).as_posix()
        found.extend((relative, offset, snippet) for offset, snippet in _strict_bytes(path.read_bytes()))
    return found


def main(argv):
    parser = argparse.ArgumentParser(description="Procura MicroSIP em textos visíveis.")
    parser.add_argument("--repo", default=str(pathlib.Path(__file__).resolve().parent.parent))
    parser.add_argument("--exe", action="append", default=[])
    parser.add_argument("--app-novo", action="append", default=[], help="StarsonicPhone.exe do app novo (sem exceções)")
    parser.add_argument("--ui", action="append", default=[], help="pasta ui\\ do app novo (sem exceções)")
    parser.add_argument("--instalador", action="append", default=[], help="instalador novo (sem exceções)")
    args = parser.parse_args(argv)
    found = find_problems(args.repo)
    for exe in args.exe:
        found += find_exe_problems(exe)
        found += find_exe_host_problems(exe)
    for exe in args.app_novo + args.instalador:
        found += find_strict_problems(exe)
    for folder in args.ui:
        found += find_ui_problems(folder)
    for relative, number, snippet in found:
        print("%s:%d: %s" % (relative, number, snippet))
    if found and os.environ.get("GITHUB_ACTIONS") == "true":
        for relative, number, snippet in found[:10]:
            text = ("%s:%d: %s" % (relative, number, snippet)).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
            print("::error title=marca::" + text)
    if found:
        print("marca: %d texto(s) visivel(is) com %s" % (len(found), NAME))
        return 1
    print("ok: nenhum texto visivel com %s" % NAME)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
