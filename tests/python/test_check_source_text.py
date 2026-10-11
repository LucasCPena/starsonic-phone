import pathlib
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "build"))

import check_source_text  # noqa: E402

BS = chr(92)  # barra invertida


class CheckSourceTextTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, relative, text):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))
        return path

    def problems(self):
        return check_source_text.find_problems(self.root)

    def test_ascii_literals_and_utf8_comments_pass(self):
        self.write("starsonic/core/a.cpp", '// comentário com acento\nconst wchar_t* t = L"ok";\n/* são */ char c = \'a\';\n')
        self.assertEqual(self.problems(), [])

    def test_wide_literal_with_accent_is_reported_with_line(self):
        self.write("starsonic/core/a.cpp", 'int x;\nconst wchar_t* t = L"ação";\n')
        found = self.problems()
        self.assertEqual(len(found), 2)
        self.assertEqual(found[0][1], 2)
        self.assertIn("U+00E7", found[0][2])

    def test_fix_escapes_wide_literals(self):
        path = self.write("tests/test_a.cpp", 'auto t = L"ação\U0001F600";\n')
        self.assertEqual(check_source_text.fix(self.root), 3)
        expected = 'auto t = L"a' + BS + 'u00e7' + BS + 'u00e3o' + BS + 'U0001f600";\n'
        self.assertEqual(path.read_text(encoding="utf-8"), expected)
        self.assertEqual(self.problems(), [])

    def test_escaped_quote_does_not_end_the_literal(self):
        path = self.write("starsonic/core/a.cpp", 'auto t = L"' + BS + '"é' + BS + '"";\n')
        self.assertEqual(len(self.problems()), 1)
        check_source_text.fix(self.root)
        self.assertEqual(path.read_text(encoding="utf-8"), 'auto t = L"' + BS + '"' + BS + 'u00e9' + BS + '"";\n')

    def test_narrow_literal_is_reported_and_not_fixed(self):
        path = self.write("starsonic/core/a.cpp", 'const char* t = "aç";\n')
        self.assertEqual(check_source_text.fix(self.root), 0)
        self.assertEqual(path.read_text(encoding="utf-8"), 'const char* t = "aç";\n')
        self.assertEqual(len(self.problems()), 1)

    def test_resource_script_must_be_fully_ascii(self):
        self.write("starsonic/win/starsonic.rc", '// recurso com acento: ç\n')
        found = self.problems()
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0][1], 1)

    def test_branding_header_must_be_fully_ascii(self):
        self.write("branding/branding.h", '#define STARSONIC_COMPANY "Starsonic"\n// ç\n')
        self.assertEqual(len(self.problems()), 1)

    def test_powershell_scripts_must_be_fully_ascii(self):
        self.write("build/Build-App.ps1", "Write-Host 'ok'\n# coment\u00e1rio\n")
        self.write("tests/smoke/Common.ps1", "Write-Host 'ok'\n")
        found = self.problems()
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0][0], "build/Build-App.ps1")
        self.assertEqual(found[0][1], 2)

    def test_build_headers_must_be_fully_ascii(self):
        self.write("build/config_site.h", "/* configura\u00e7\u00e3o */\n")
        self.assertEqual(len(self.problems()), 2)

    def test_third_party_and_generated_are_ignored(self):
        self.write("starsonic/third_party/doctest/doctest.h", 'auto t = L"ç";\n')
        self.write("starsonic/generated/build_info.h", 'auto t = L"ç";\n')
        self.assertEqual(self.problems(), [])

    def test_repository_sources_follow_the_rule(self):
        found = check_source_text.find_problems(ROOT)
        self.assertEqual(found, [], "\n".join("%s:%d: %s" % item for item in found))


if __name__ == "__main__":
    unittest.main()
