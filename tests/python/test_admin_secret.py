"""A senha do administrador nao fica em texto no repositorio (que e publico) (spec 6.1 da rc.3).

Nada aqui, nem nos testes C++, tem a senha, inteira ou em pedacos. Dois tipos de conferencia:

- sem segredo, sempre: o resumo embutido em starsonic/desktop/Admin.cpp tem o formato certo e e o que build/admin_hash.py
  gera, e nenhum arquivo versionado tem os pedacos de uma senha montada por concatenacao (padroes abaixo);
- com a variavel de ambiente STARSONIC_ADMIN_PASSWORD (a senha de verdade, so na maquina de quem troca a senha ou num
  segredo do CI): a senha em texto nao aparece em nenhum arquivo versionado (UTF-8, UTF-16 e em minusculas) e o resumo
  embutido e o dessa senha. Sem a variavel, esses testes sao pulados.

Atencao: o build.yml roda estes testes com `env -u GITHUB_ACTIONS`, que so tira o GITHUB_ACTIONS: um segredo
passado como STARSONIC_ADMIN_PASSWORD chega aqui.
"""
import hashlib
import importlib.util
import os
import pathlib
import re
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SKIPPED_PARTS = {"node_modules", "__pycache__", ".git"}
ENV = "STARSONIC_ADMIN_PASSWORD"

# Os pedacos de uma senha montada por concatenacao de literais, vistos como padrao para este arquivo nao ter nenhum:
# os cinco digitos do inicio com no maximo aspas, virgulas, mais e espacos entre eles; e o arroba seguido de "Star" e
# nao de "Starsonic" (o nome do produto), com ou sem aspas e operadores no meio.
SEPARATORS = r"""[\s"'+,]*"""
FRAGMENT_PATTERNS = (
    re.compile(r"(?<![0-9])" + SEPARATORS.join(str(1422).zfill(5)) + r"(?![0-9])"),
    re.compile(r"@" + SEPARATORS + r"Star(?!sonic)"),
)


def tracked_files():
    """Todos os arquivos versionados (sem filtro de pasta)."""
    try:
        out = subprocess.run(["git", "-C", str(ROOT), "ls-files", "-z"], check=True, capture_output=True).stdout
        names = [name for name in out.decode("utf-8").split("\0") if name]
        return [ROOT / name for name in names if (ROOT / name).is_file()]
    except (OSError, subprocess.CalledProcessError):
        return [path for path in ROOT.rglob("*") if path.is_file() and not SKIPPED_PARTS.intersection(path.parts)]


def load_admin_hash():
    spec = importlib.util.spec_from_file_location("admin_hash", ROOT / "build" / "admin_hash.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def embedded_constants():
    text = (ROOT / "starsonic" / "desktop" / "Admin.cpp").read_text(encoding="utf-8")

    def array(name):
        match = re.search(r"const uint8_t %s\[(\d+)\] = \{([^}]*)\};" % name, text)
        assert match, name
        values = bytes(int(item, 16) for item in re.findall(r"0x([0-9a-fA-F]{2})", match.group(2)))
        assert len(values) == int(match.group(1)), name
        return values

    iterations = int(re.search(r"constexpr uint32_t kIterations = (\d+);", text).group(1))
    return iterations, array("kSalt"), array("kKey")


class AdminSecretWithoutPasswordTest(unittest.TestCase):
    def test_no_tracked_file_has_the_pieces_of_a_concatenated_password(self):
        files = tracked_files()
        self.assertGreater(len(files), 100)   # a varredura achou o repositorio
        found = []
        for path in files:
            text = path.read_bytes().decode("utf-8", errors="ignore")
            for pattern in FRAGMENT_PATTERNS:
                match = pattern.search(text)
                if match:
                    found.append("%s: %r" % (path.relative_to(ROOT), match.group(0)))
        self.assertEqual(found, [])

    def test_the_patterns_catch_what_they_are_for(self):
        # As amostras sao montadas aqui para este arquivo nao ter, ele mesmo, nenhum dos pedacos.
        digits = str(1422).zfill(5)
        at_star = chr(64) + "St" + "ar"
        caught = (digits, " + ".join('"%s"' % d for d in digits), '"%s" "%s"' % (digits[:2], digits[2:]),
                  at_star, '"' + chr(64) + '" + "' + at_star[1:] + '"', chr(64) + " , " + at_star[1:])
        for sample in caught:
            self.assertTrue(any(p.search(sample) for p in FRAGMENT_PATTERNS), sample)
        not_caught = ("Starsonic", chr(64) + "Starsonic", "1" + digits + "0", "uint8_t x = 0x01;")
        for sample in not_caught:
            self.assertFalse(any(p.search(sample) for p in FRAGMENT_PATTERNS), sample)

    def test_the_embedded_hash_has_the_agreed_format(self):
        iterations, salt, key = embedded_constants()
        self.assertEqual(iterations, load_admin_hash().ITERATIONS)
        self.assertEqual(iterations, 100000)
        self.assertEqual(len(salt), 16)
        self.assertEqual(len(key), 32)

    def test_the_script_renders_what_admin_cpp_holds(self):
        _, salt, key = embedded_constants()
        text = (ROOT / "starsonic" / "desktop" / "Admin.cpp").read_text(encoding="utf-8")
        self.assertIn(load_admin_hash().render(salt, key), text)

    def test_the_script_derives_like_hashlib(self):
        admin_hash = load_admin_hash()
        salt = bytes(range(0x10, 0x20))
        self.assertEqual(admin_hash.derive("senha-de-teste-123", salt),
                         hashlib.pbkdf2_hmac("sha256", b"senha-de-teste-123", salt, 100000, 32))
        self.assertNotEqual(admin_hash.derive("senha-de-teste-124", salt), admin_hash.derive("senha-de-teste-123", salt))


@unittest.skipUnless(os.environ.get(ENV), ENV + " nao esta definida")
class AdminSecretWithPasswordTest(unittest.TestCase):
    def test_the_source_tree_never_contains_the_admin_password_in_plain_text(self):
        secret = os.environ[ENV].lower()
        forms = [secret.encode(encoding) for encoding in ("utf-8", "utf-16-le", "utf-16-be")]
        files = tracked_files()
        self.assertGreater(len(files), 100)
        found = []
        for path in files:
            data = path.read_bytes().lower()   # sem diferenciar maiusculas de minusculas
            if any(form in data for form in forms):
                found.append(str(path.relative_to(ROOT)))
        self.assertEqual(found, [])

    def test_the_embedded_hash_is_the_one_of_that_password(self):
        admin_hash = load_admin_hash()
        iterations, salt, key = embedded_constants()
        self.assertEqual(admin_hash.derive(os.environ[ENV], salt), key)
        self.assertNotEqual(admin_hash.derive(os.environ[ENV] + "x", salt), key)


if __name__ == "__main__":
    unittest.main()
