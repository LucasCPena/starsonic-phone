import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
CMAKE = ROOT / "windows" / "app" / "CMakeLists.txt"
TERCEIROS = ROOT / "starsonic" / "third_party"


class H264DownloadOptionTest(unittest.TestCase):
    def test_the_download_option_is_on(self):
        texto = CMAKE.read_text(encoding="utf-8")
        opcao = re.search(r'^option\(STARSONIC_H264_DOWNLOAD\b.*\bON\)\s*$', texto, re.MULTILINE)
        self.assertIsNotNone(opcao, "o option(STARSONIC_H264_DOWNLOAD ... ON) nao esta no CMakeLists.txt")

    def test_no_build_script_turns_it_off(self):
        scripts = [p for pasta in ("build", ".github/workflows") for p in (ROOT / pasta).rglob("*") if p.is_file() and "__pycache__" not in p.parts]
        self.assertTrue(scripts)
        for script in scripts:
            texto = script.read_text(encoding="utf-8", errors="replace")
            self.assertNotIn("STARSONIC_H264_DOWNLOAD", texto, str(script.relative_to(ROOT)))

    def test_the_bsd_texts_are_in_the_repo(self):
        for peca in ("libvpx", "libyuv"):
            for nome in ("LICENSE", "PATENTS", "README.md"):
                arquivo = TERCEIROS / peca / nome
                self.assertTrue(arquivo.is_file(), str(arquivo.relative_to(ROOT)))
                self.assertGreater(arquivo.stat().st_size, 0, str(arquivo.relative_to(ROOT)))
            readme = (TERCEIROS / peca / "README.md").read_text(encoding="utf-8")
            self.assertIn("github.com/", readme, peca)
            self.assertRegex(readme, r"v1\.16\.0" if peca == "libvpx" else r"\b[0-9a-f]{40}\b", peca)


if __name__ == "__main__":
    unittest.main()
