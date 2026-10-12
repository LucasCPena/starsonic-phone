import pathlib
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "build"))

import check_branding  # noqa: E402

BS = chr(92)  # barra invertida


class CheckBrandingTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = pathlib.Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, relative, data):
        path = self.repo / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(data, str):
            data = data.encode("utf-8")
        path.write_bytes(data)
        return path

    def problems(self):
        return check_branding.find_problems(self.repo)

    def test_rc_literal_with_microsip_fails(self):
        self.write("microsip/res/dialog.rc2", 'IDD_ABOUT DIALOGEX 0, 0, 100, 50\r\nCAPTION "MicroSIP"\r\n')
        found = self.problems()
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0][0], "microsip/res/dialog.rc2")
        self.assertEqual(found[0][1], 2)
        self.assertIn("MicroSIP", found[0][2])

    def test_legal_copyright_line_is_allowed(self):
        self.write("microsip/res/main.rc2",
                   '            VALUE "LegalCopyright", "Copyright (c) 2011-2025, MicroSIP (www.microsip.org). All rights reserved."\r\n')
        self.assertEqual(self.problems(), [])

    def test_lowercase_or_comment_mentions_in_rc_are_ignored(self):
        self.write("microsip/main.rc", '// MicroSIP resource file\r\nIDI_X ICON "res' + BS + BS + 'microsip.ico"\r\n')
        self.assertEqual(self.problems(), [])

    def test_langpack_translation_fails_but_key_is_ignored(self):
        self.write("branding/langpack_portuguesebr.txt",
                   "; Language Pack\r\n; MicroSIP translation\r\n[Visit MicroSIP]\r\nVisitar MicroSIP\r\n[Online]\r\nConectado\r\n")
        found = self.problems()
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0][0], "branding/langpack_portuguesebr.txt")
        self.assertEqual(found[0][1], 4)

    def test_langpack_in_utf16_is_read(self):
        text = "[Visit MicroSIP]\r\nVisitar MicroSIP\r\n"
        self.write("branding/langpack_portuguesebr.txt", b"\xff\xfe" + text.encode("utf-16-le"))
        self.assertEqual(len(self.problems()), 1)

    def test_nsi_and_new_code_literals_are_checked(self):
        self.write("installer/starsonic.nsi", '; instalador baseado no do MicroSIP\r\nName "MicroSIP"\r\n')
        self.write("starsonic/win/LoginDialog.cpp",
                   '// texto antigo do MicroSIP\nconst wchar_t* kTitle = L"Entrar no MicroSIP";\nint microsip_id = 1;\n')
        self.write("starsonic/core/Thing.h", 'const char* kName = "MicroSIP";\n')
        self.write("branding/branding.h", '#define STARSONIC_APP_NAME "MicroSIP"\n')
        found = sorted((item[0], item[1]) for item in self.problems())
        self.assertEqual(found, [
            ("branding/branding.h", 1),
            ("installer/starsonic.nsi", 2),
            ("starsonic/core/Thing.h", 1),
            ("starsonic/win/LoginDialog.cpp", 2),
        ])

    def test_about_attribution_is_allowed(self):
        self.write("starsonic/win/AboutDialog.cpp",
                   'const wchar_t kAttribution[] = L"Baseado no MicroSIP ' + BS + 'u2014 software livre sob a GNU GPL v3";\n'
                   'version = L"Starsonic Phone " + v + L" (baseado no MicroSIP " + up + L")";\n')
        self.assertEqual(self.problems(), [])

    def test_exe_allows_only_copyright_and_attribution(self):
        good = (b"\x00\x01" + "Copyright (c) 2011-2025, MicroSIP (www.microsip.org)".encode("utf-16-le")
                + b"\x00\x00" + "Baseado no MicroSIP".encode("utf-16-le")
                + b"\x00" + b"Copyright (c) 2011-2025, MicroSIP" + b"\x00")
        exe = self.write("out/good.exe", good)
        self.assertEqual(check_branding.find_exe_problems(exe), [])
        bad = good + "Janela do MicroSIP".encode("utf-16-le") + b"\x00\x00" + b"MicroSIP\x00"
        exe = self.write("out/bad.exe", bad)
        self.assertEqual(len(check_branding.find_exe_problems(exe)), 2)

    def test_exe_match_is_case_sensitive(self):
        exe = self.write("out/case.exe", b"update.microsip.org\x00" + "MICROSIP".encode("utf-16-le"))
        self.assertEqual(check_branding.find_exe_problems(exe), [])

    def test_exe_must_not_contact_microsip_hosts(self):
        copyright_ = "Copyright (c) 2011-2025, MicroSIP (www.microsip.org). All rights reserved."
        good = b"\x00" + copyright_.encode("utf-16-le") + b"\x00\x00" + copyright_.encode("ascii") + b"\x00"
        exe = self.write("out/good.exe", good)
        self.assertEqual(check_branding.find_exe_host_problems(exe), [])
        for host in ("crash-report2.microsip.org", "update.microsip.org", "WWW.MICROSIP.ORG"):
            for encoded in (host.encode("ascii"), host.encode("utf-16-le")):
                exe = self.write("out/bad.exe", good + b"\x00" + encoded + b"\x00")
                found = check_branding.find_exe_host_problems(exe)
                self.assertEqual(len(found), 1, (host, encoded))
                self.assertIn(host.lower(), found[0][2].lower())

    def test_main_reports_microsip_hosts_in_exe(self):
        exe = self.write("out/app.exe", b"\x00crash-report2.microsip.org\x00")
        self.assertEqual(check_branding.main(["--repo", str(self.repo), "--exe", str(exe)]), 1)
        exe = self.write("out/app.exe", b"\x00Copyright (c) 2011-2025, MicroSIP (www.microsip.org)\x00")
        self.assertEqual(check_branding.main(["--repo", str(self.repo), "--exe", str(exe)]), 0)

    def test_main_returns_one_and_lists_problems(self):
        self.write("microsip/res/menu.rc2", 'MENUITEM "Sobre o MicroSIP", 1\r\n')
        self.assertEqual(check_branding.main(["--repo", str(self.repo)]), 1)
        self.write("microsip/res/menu.rc2", 'MENUITEM "Sobre o Starsonic Phone", 1\r\n')
        self.assertEqual(check_branding.main(["--repo", str(self.repo)]), 0)

    def test_repository_has_no_visible_microsip(self):
        found = check_branding.find_problems(ROOT)
        self.assertEqual(found, [], "\n".join("%s:%d: %s" % item for item in found))


if __name__ == "__main__":
    unittest.main()
