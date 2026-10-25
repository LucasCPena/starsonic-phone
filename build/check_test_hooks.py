#!/usr/bin/env python3
"""Reprova o executável de publicação do app novo que tenha um gancho de teste (Ruling 19).

Os ganchos do build de teste (os #if STARSONIC_TEST_HOOKS do windows/app/src/main.cpp; docs/build-notes.md) mudam o
que o app faz: o STARSONIC_SENHA_ADMIN_TESTE, por exemplo, abriria a área do administrador com uma senha qualquer. O
executável de publicação não tem nenhum; se um vazar (um #if esquecido), o nome dele fica no executável, em UTF-16LE
(o nome da variável ou da opção, num L"...") ou em ASCII (uma linha do diagnóstico). O script procura cada nome nas
duas formas.

Uso: check_test_hooks.py <StarsonicPhone.exe>              (0: nenhum nome; 1: algum nome está no arquivo)
     check_test_hooks.py --presentes <StarsonicPhone.exe>  (o build de teste: 0 com todos os nomes, 1 com algum
                                                            faltando; confere que a busca acha os nomes de verdade)
O arquivo precisa ter o texto "Starsonic Phone" (em ASCII ou UTF-16LE); sem ele, ou sem o arquivo: 2.
As mensagens saem em ASCII: o Python do runner do Windows escreve na página de código do console, e um acento sairia
trocado no log do CI.
"""
import os
import pathlib
import sys

# Os ganchos do build de teste: as variáveis de ambiente e a opção que só ele lê.
HOOK_NAMES = (
    "STARSONIC_PERFIL",
    "STARSONIC_SOM_NULO",
    "STARSONIC_TRAVAR_SAIR",
    "STARSONIC_SENHA_ADMIN_TESTE",
    "STARSONIC_TESTE_DNS_MS",
    "--teste-internet",
)
MARKER = "Starsonic Phone"   # está em todo executável do app (a classe da janela, o diagnóstico)
USAGE = "uso: check_test_hooks.py [--presentes] <StarsonicPhone.exe>"


def _forms(text):
    return (text.encode("ascii"), text.encode("utf-16-le"))


def found_names(data, names=HOOK_NAMES):
    """Os nomes que aparecem nos bytes, em ASCII ou em UTF-16LE, na ordem da lista."""
    return [name for name in names if any(form in data for form in _forms(name))]


def _say(text):
    """Uma linha em ASCII (um caminho ou uma mensagem do Windows com acento sai com escapes, e nao trocada)."""
    print(text.encode("ascii", "backslashreplace").decode("ascii"))


def _error(text):
    _say("erro: " + text)
    if os.environ.get("GITHUB_ACTIONS") == "true":
        _say("::error title=ganchos de teste::" + text.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A"))


def main(argv):
    present = argv[:1] == ["--presentes"]
    paths = argv[1:] if present else argv
    if len(paths) != 1:
        _say(USAGE)
        return 2
    path = pathlib.Path(paths[0])
    try:
        data = path.read_bytes()
    except OSError as error:
        _error("nao foi possivel ler %s: %s" % (path, error))
        return 2
    if not any(form in data for form in _forms(MARKER)):
        _error("%s nao parece o executavel do app (sem o texto %r)" % (path, MARKER))
        return 2
    found = found_names(data)
    if present:
        missing = [name for name in HOOK_NAMES if name not in found]
        if missing:
            _error("o build de teste %s esta sem os ganchos: %s" % (path, ", ".join(missing)))
            return 1
        _say("ok: os %d ganchos de teste estao em %s (a busca acha os nomes)" % (len(HOOK_NAMES), path))
        return 0
    if found:
        for name in found:
            _error("o gancho de teste %s esta no executavel de publicacao %s" % (name, path))
        return 1
    _say("ok: nenhum dos %d ganchos de teste em %s" % (len(HOOK_NAMES), path))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
