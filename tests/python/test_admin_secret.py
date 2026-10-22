"""A senha do administrador nunca fica em texto no codigo (spec 6.1 da rc.3).

Decisao: este teste e o teste C++ (tests/desktop/test_admin.cpp) montam a senha de pedacos em tempo de execucao, em vez de
lerem uma variavel de ambiente no CI. Assim o teste roda igual em qualquer maquina e o texto inteiro nao aparece em
nenhum arquivo (nem neste). Os documentos de planejamento (docs/, .superpowers/) citam a senha de proposito e ficam
fora da varredura, que cobre o que vira programa: codigo, scripts, testes, interface, recursos e fluxos do CI.
"""
import importlib.util
import pathlib
import re
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCANNED_DIRS = ("starsonic", "windows", "android", "microsip", "tests", "build", "branding", "installer", ".github")
SKIPPED_PARTS = {"node_modules", "__pycache__", ".git", "third_party"}


def password():
    return "".join(("01422", "@", "Star"))


def tracked_files():
    try:
        out = subprocess.run(["git", "-C", str(ROOT), "ls-files", "-z", "--", *SCANNED_DIRS], check=True,
                             capture_output=True).stdout
        return [ROOT / name for name in out.decode("utf-8").split("\0") if name]
    except (OSError, subprocess.CalledProcessError):
        return [path for name in SCANNED_DIRS if (ROOT / name).is_dir() for path in (ROOT / name).rglob("*")
                if path.is_file() and not SKIPPED_PARTS.intersection(path.parts)]


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


class AdminSecretTest(unittest.TestCase):
    def test_the_source_tree_never_contains_the_admin_password_in_plain_text(self):
        secret = password()
        forms = {
            "utf-8": secret.encode("utf-8"),
            "utf-16le": secret.encode("utf-16-le"),
            "utf-16be": secret.encode("utf-16-be"),
        }
        files = tracked_files()
        self.assertGreater(len(files), 100)   # a varredura achou o repositorio
        found = []
        for path in files:
            try:
                data = path.read_bytes()
            except OSError:
                continue
            for label, needle in forms.items():
                if needle in data:
                    found.append("%s (%s)" % (path.relative_to(ROOT), label))
        self.assertEqual(found, [])

    def test_the_embedded_hash_is_the_one_the_script_derives(self):
        admin_hash = load_admin_hash()
        iterations, salt, key = embedded_constants()
        self.assertEqual(iterations, admin_hash.ITERATIONS)
        self.assertEqual(iterations, 100000)
        self.assertEqual(len(salt), 16)
        self.assertEqual(len(key), 32)
        self.assertEqual(admin_hash.derive(password(), salt), key)
        self.assertNotEqual(admin_hash.derive(password() + "x", salt), key)

    def test_the_script_renders_what_admin_cpp_holds(self):
        admin_hash = load_admin_hash()
        _, salt, key = embedded_constants()
        text = (ROOT / "starsonic" / "desktop" / "Admin.cpp").read_text(encoding="utf-8")
        self.assertIn(admin_hash.render(salt, key), text)


if __name__ == "__main__":
    unittest.main()
