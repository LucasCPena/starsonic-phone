"""O passo do CI que procura os ganchos de teste no executável de publicação (build/check_test_hooks.py, Ruling 19)."""
import contextlib
import io
import pathlib
import re
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "build"))

import check_test_hooks  # noqa: E402

MARKER = "Starsonic Phone".encode("utf-16-le")   # a classe da janela, como no exe de verdade


class CheckTestHooksTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def exe(self, *parts):
        """Um executável de amostra: um cabeçalho, o texto da marca e os pedaços dados, separados por zeros."""
        path = self.dir / "StarsonicPhone.exe"
        path.write_bytes(b"MZ\x90\x00" + MARKER + b"\x00\x00" + b"\x00\x00".join(parts) + b"\x00\x00")
        return path

    def run_main(self, *args):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = check_test_hooks.main([str(arg) for arg in args])
        return code, out.getvalue()

    def test_a_release_exe_without_any_hook_name_passes(self):
        exe = self.exe(b"rede: conectividade do Windows", "bandeja: ".encode("utf-16-le"), b"STARSONIC_VERSION")
        code, out = self.run_main(exe)
        self.assertEqual(code, 0, out)

    def test_each_hook_name_fails_in_ascii_and_in_utf16(self):
        for name in check_test_hooks.HOOK_NAMES:
            for encoding in ("ascii", "utf-16-le"):
                with self.subTest(name=name, encoding=encoding):
                    code, out = self.run_main(self.exe(b"antes", name.encode(encoding), b"depois"))
                    self.assertEqual(code, 1, out)
                    self.assertIn(name, out)

    def test_the_names_the_task_named_are_in_the_list(self):
        for name in ("STARSONIC_SENHA_ADMIN_TESTE", "STARSONIC_TESTE_DNS_MS", "--teste-internet", "STARSONIC_PERFIL",
                     "STARSONIC_SOM_NULO", "STARSONIC_TRAVAR_SAIR"):
            with self.subTest(name=name):
                self.assertIn(name, check_test_hooks.HOOK_NAMES)

    def test_present_mode_needs_every_name(self):
        # O build de teste: a busca acha os nomes de verdade (em ASCII ou em UTF-16LE, cada um numa forma).
        parts = [name.encode("utf-16-le" if index % 2 else "ascii")
                 for index, name in enumerate(check_test_hooks.HOOK_NAMES)]
        code, out = self.run_main("--presentes", self.exe(*parts))
        self.assertEqual(code, 0, out)
        code, out = self.run_main("--presentes", self.exe(*parts[1:]))
        self.assertEqual(code, 1, out)
        self.assertIn(check_test_hooks.HOOK_NAMES[0], out)

    def test_a_file_that_is_not_the_exe_or_that_is_missing_is_an_error(self):
        other = self.dir / "outro.bin"
        other.write_bytes(b"nada aqui")
        self.assertEqual(self.run_main(other)[0], 2)
        self.assertEqual(self.run_main(self.dir / "nao-existe.exe")[0], 2)
        self.assertEqual(self.run_main()[0], 2)
        self.assertEqual(self.run_main("--presentes")[0], 2)

    def test_the_list_has_every_hook_of_the_test_build_blocks(self):
        # Os nomes dos ganchos (as variaveis STARSONIC_* e as opcoes --*) nos #if STARSONIC_TEST_HOOKS do executavel.
        found = set()
        for source in sorted((ROOT / "windows" / "app" / "src").glob("*.cpp")):
            text = source.read_text(encoding="utf-8")
            for block in re.findall(r"#if STARSONIC_TEST_HOOKS[^\n]*\n(.*?)\n\s*#\s*(?:else|endif)", text, re.S):
                found.update(re.findall(r'L"(STARSONIC_[A-Z0-9_]+|--[a-z][a-z-]*)"', block))
        self.assertIn("STARSONIC_SENHA_ADMIN_TESTE", found)   # a busca nos blocos funciona
        self.assertEqual(sorted(found - set(check_test_hooks.HOOK_NAMES)), [])

    def test_the_build_notes_name_every_hook(self):
        notes = (ROOT / "docs" / "build-notes.md").read_text(encoding="utf-8")
        for name in check_test_hooks.HOOK_NAMES:
            with self.subTest(name=name):
                self.assertTrue("`%s" % name in notes, "docs/build-notes.md sem o gancho %s" % name)


if __name__ == "__main__":
    unittest.main()
