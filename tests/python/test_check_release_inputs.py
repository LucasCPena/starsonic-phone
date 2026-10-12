import pathlib
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "build"))

import check_release_inputs  # noqa: E402

BRANDING_H = (
    '#define STARSONIC_GITHUB_ACCOUNT "starsonic"\n'
    "#define STARSONIC_BRAND_COLOR RGB(0x12,0x34,0x56)\n"
    "#define STARSONIC_BRAND_IS_PLACEHOLDER 0\n"
)
SERVERS = (
    "[geral]\r\ncodecs=G722,PCMA\r\n"
    "[sp1]                     ; id do servidor\r\nnome=Servidor 1\r\nendereco=sip1.starsonic.com.br\r\n"
)


class CheckReleaseInputsTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = pathlib.Path(self._tmp.name)
        self.write("branding/branding.h", BRANDING_H)
        self.write("branding/servidores.ini", SERVERS)
        for relative in check_release_inputs.REQUIRED_FILES:
            self.write(relative, b"x")

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, relative, data):
        path = self.repo / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data.encode("utf-8") if isinstance(data, str) else data)

    def missing(self):
        return check_release_inputs.find_missing(self.repo)

    def test_passes_with_every_input_present(self):
        self.assertEqual(self.missing(), [])
        self.assertEqual(check_release_inputs.main(["--repo", str(self.repo)]), 0)

    def test_required_files_are_the_starsonic_inputs(self):
        self.assertEqual(sorted(check_release_inputs.REQUIRED_FILES), sorted([
            "branding/overlay/microsip/res/microsip.ico",
            "branding/overlay/microsip/res/tray_inactive.ico",
            "branding/overlay/microsip/res/tray_missed.ico",
            "branding/logo-faixa.png",
            "branding/logo-entrar.png",
            "branding/langpack_portuguesebr.txt",
            "branding/installer/boas-vindas.bmp",
        ]))

    def test_each_missing_file_is_listed(self):
        for relative in check_release_inputs.REQUIRED_FILES:
            (self.repo / relative).unlink()
            found = self.missing()
            self.assertEqual(len(found), 1, relative)
            self.assertIn(relative, found[0])
            self.write(relative, b"x")

    def test_placeholder_account_fails(self):
        self.write("branding/branding.h", BRANDING_H.replace('"starsonic"', '"definir-conta"'))
        found = self.missing()
        self.assertEqual(len(found), 1)
        self.assertIn("definir-conta", found[0])

    def test_placeholder_colors_fail(self):
        self.write("branding/branding.h", BRANDING_H.replace("PLACEHOLDER 0", "PLACEHOLDER 1"))
        found = self.missing()
        self.assertEqual(len(found), 1)
        self.assertIn("STARSONIC_BRAND_IS_PLACEHOLDER", found[0])

    def test_example_server_address_fails_but_comment_does_not(self):
        self.write("branding/servidores.ini", SERVERS + "; exemplo: sip1.exemplo.invalid\r\n")
        self.assertEqual(self.missing(), [])
        self.write("branding/servidores.ini", SERVERS.replace("sip1.starsonic.com.br", "sip1.exemplo.invalid"))
        found = self.missing()
        self.assertEqual(len(found), 1)
        self.assertIn(".invalid", found[0])

    def test_main_lists_what_is_missing(self):
        (self.repo / "branding/logo-faixa.png").unlink()
        self.assertEqual(check_release_inputs.main(["--repo", str(self.repo)]), 1)


if __name__ == "__main__":
    unittest.main()
