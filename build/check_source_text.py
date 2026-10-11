#!/usr/bin/env python3
"""Confere se os literais de texto do C++ do projeto são ASCII.

O compilador da Microsoft lê fonte sem BOM na página de código do Windows; um
acento dentro de um literal vira lixo na tela. Por isso:

- em starsonic/ e tests/ (*.cpp, *.h), caractere fora do ASCII dentro de um
  literal precisa ser escrito como escape (barra invertida + u + 4 dígitos);
  comentários podem ter acentos;
- starsonic/**/*.rc, branding/branding.h, build/*.h, build/*.ps1 e
  tests/smoke/*.ps1 precisam ser só ASCII (o compilador de recursos e o
  Windows PowerShell 5.1 leem esses arquivos na página de código do Windows).

Uso: check_source_text.py [--fix] [raiz]
--fix troca os caracteres dos literais largos (L"...", u"...", U"...") pelos
escapes; literais estreitos são só apontados (corrija à mão com bytes UTF-8).
"""
import pathlib
import sys

BS = chr(92)  # barra invertida
CPP_DIRS = ("starsonic", "tests")
CPP_SUFFIXES = (".cpp", ".h", ".hpp")
SKIPPED_PARTS = {"third_party", "generated"}
FIXABLE_PREFIXES = {"L", "u", "U", "u8"}


def _escape(ch):
    code = ord(ch)
    if code <= 0xFFFF:
        return BS + "u%04x" % code
    return BS + "U%08x" % code


def _literal_prefix(text, quote_index):
    start = quote_index
    while start > 0 and (text[start - 1].isalnum() or text[start - 1] == "_"):
        start -= 1
    return text[start:quote_index]


def _process_cpp(text):
    """Devolve (problemas, texto_corrigido, quantos_corrigidos)."""
    out = []
    problems = []
    fixed = 0
    line = 1
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if text.startswith("//", i):
            end = text.find("\n", i)
            end = n if end == -1 else end
            out.append(text[i:end])
            i = end
            continue
        if text.startswith("/*", i):
            end = text.find("*/", i + 2)
            end = n if end == -1 else end + 2
            chunk = text[i:end]
            out.append(chunk)
            line += chunk.count("\n")
            i = end
            continue
        if ch in "\"'":
            fixable = _literal_prefix(text, i) in FIXABLE_PREFIXES
            out.append(ch)
            j = i + 1
            while j < n and text[j] != ch and text[j] != "\n":
                c = text[j]
                if c == BS and j + 1 < n:
                    out.append(text[j:j + 2])
                    if text[j + 1] == "\n":
                        line += 1
                    j += 2
                    continue
                if ord(c) > 0x7F:
                    problems.append((line, "caractere fora do ASCII em literal: U+%04X" % ord(c)))
                    if fixable:
                        out.append(_escape(c))
                        fixed += 1
                        j += 1
                        continue
                out.append(c)
                j += 1
            if j < n and text[j] == ch:
                out.append(ch)
                j += 1
            i = j
            continue
        if ord(ch) > 0x7F:
            problems.append((line, "caractere fora do ASCII no código: U+%04X" % ord(ch)))
        if ch == "\n":
            line += 1
        out.append(ch)
        i += 1
    return problems, "".join(out), fixed


def _ascii_only_problems(text):
    problems = []
    for number, content in enumerate(text.split("\n"), start=1):
        for ch in content:
            if ord(ch) > 0x7F:
                problems.append((number, "arquivo deve ser só ASCII: U+%04X" % ord(ch)))
    return problems


def _is_skipped(path, root):
    return any(part in SKIPPED_PARTS for part in path.relative_to(root).parts)


def _cpp_files(root):
    for directory in CPP_DIRS:
        base = root / directory
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*")):
            if path.is_file() and path.suffix in CPP_SUFFIXES and not _is_skipped(path, root):
                yield path


def _ascii_only_files(root):
    base = root / "starsonic"
    if base.is_dir():
        for path in sorted(base.rglob("*.rc")):
            if not _is_skipped(path, root):
                yield path
    branding = root / "branding" / "branding.h"
    if branding.is_file():
        yield branding
    # O Windows PowerShell 5.1 lê .ps1 sem BOM na página de código do Windows.
    for directory, pattern in (("build", "*.ps1"), ("build", "*.h"), ("tests/smoke", "*.ps1")):
        base = root / directory
        if base.is_dir():
            for path in sorted(base.glob(pattern)):
                yield path


def _read(path):
    try:
        return path.read_bytes().decode("utf-8"), None
    except UnicodeDecodeError:
        return None, "arquivo não está em UTF-8"


def find_problems(root):
    """Lista de (caminho relativo, linha, mensagem)."""
    root = pathlib.Path(root)
    found = []
    ascii_only = set(_ascii_only_files(root))
    for path in sorted(set(_cpp_files(root)) | ascii_only):
        relative = path.relative_to(root).as_posix()
        text, error = _read(path)
        if error:
            found.append((relative, 1, error))
            continue
        problems = _ascii_only_problems(text) if path in ascii_only else _process_cpp(text)[0]
        found.extend((relative, number, message) for number, message in problems)
    return found


def fix(root):
    """Troca caracteres de literais largos por escapes; devolve quantos trocou."""
    root = pathlib.Path(root)
    ascii_only = set(_ascii_only_files(root))
    total = 0
    for path in _cpp_files(root):
        if path in ascii_only:
            continue
        text, error = _read(path)
        if error:
            continue
        _, new_text, fixed = _process_cpp(text)
        if fixed:
            path.write_bytes(new_text.encode("utf-8"))
            total += fixed
    return total


def main(argv):
    args = list(argv)
    do_fix = "--fix" in args
    args = [a for a in args if a != "--fix"]
    root = pathlib.Path(args[0]) if args else pathlib.Path(__file__).resolve().parent.parent
    if do_fix:
        print("escapes aplicados: %d" % fix(root))
    found = find_problems(root)
    for relative, number, message in found:
        print("%s:%d: %s" % (relative, number, message))
    if found:
        return 1
    print("ok: literais em ASCII")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
