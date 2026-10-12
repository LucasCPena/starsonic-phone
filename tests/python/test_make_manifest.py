import json
import pathlib
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "build"))

import make_manifest  # noqa: E402

PREFIX = "https://github.com/LucasCPena/starsonic-phone/releases/download/"
SHA = "AB" * 32


class MakeManifestTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def run_main(self, *extra, version="1.0.1", url=PREFIX + "v1.0.1/StarsonicPhone-1.0.1-setup.exe", sha=SHA):
        out = self.dir / "versao.json"
        args = ["--version", version, "--installer-url", url, "--sha256", sha, "--out", str(out)] + list(extra)
        return make_manifest.main(args), out

    def test_writes_exactly_the_four_keys_in_utf8(self):
        notes = self.dir / "notas.txt"
        notes.write_bytes(b"\xef\xbb\xbf" + "Correção de áudio nas chamadas.\r\n".encode("utf-8"))
        code, out = self.run_main("--notes-file", str(notes))
        self.assertEqual(code, 0)
        data = out.read_bytes()
        self.assertIn("Correção de áudio".encode("utf-8"), data)   # sem \\u escapes
        manifest = json.loads(data.decode("utf-8"))
        self.assertEqual(sorted(manifest), ["instalador", "notas", "sha256", "versao"])
        self.assertEqual(manifest["versao"], "1.0.1")
        self.assertEqual(manifest["instalador"], PREFIX + "v1.0.1/StarsonicPhone-1.0.1-setup.exe")
        self.assertEqual(manifest["sha256"], "ab" * 32)
        self.assertEqual(manifest["notas"], "Correção de áudio nas chamadas.")

    def test_notes_are_empty_without_notes_file(self):
        code, out = self.run_main(version="1.0.1-rc.2", url=PREFIX + "v1.0.1-rc.2/StarsonicPhone-1.0.1-rc.2-setup.exe")
        self.assertEqual(code, 0)
        manifest = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual(manifest["versao"], "1.0.1-rc.2")
        self.assertEqual(manifest["notas"], "")

    def test_rejects_invalid_versions(self):
        for version in ("1.0", "v1.0.0", "1.0.0-beta", "1.0.0-rc.0", "1.0.0-rc.", "1.0.0 ", "1.0.0-rc.1-rc.2"):
            code, out = self.run_main(version=version)
            self.assertEqual(code, 1, version)
            self.assertFalse(out.exists(), version)

    def test_rejects_invalid_sha256(self):
        for sha in ("a" * 63, "a" * 65, "g" * 64, ""):
            code, out = self.run_main(sha=sha)
            self.assertEqual(code, 1, sha)
            self.assertFalse(out.exists(), sha)

    def test_rejects_installer_url_the_app_would_refuse(self):
        for url in ("http://github.com/LucasCPena/starsonic-phone/releases/download/v1.0.1/x.exe",
                    "https://github.com/LucasCPena/starsonic-phone/releases/download/../x.exe",
                    "https://github.com/LucasCPena/starsonic-phone/releases/download/v1.0.1/x y.exe",
                    "ftp://example.com/x.exe"):
            code, out = self.run_main(url=url)
            self.assertEqual(code, 1, url)
            self.assertFalse(out.exists(), url)


if __name__ == "__main__":
    unittest.main()
