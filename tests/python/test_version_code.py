"""build/android/version_code.py: o versionCode do Android a partir da versão (spec 9.4)."""
import pathlib
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "build" / "android" / "version_code.py"
sys.path.insert(0, str(ROOT / "build" / "android"))

import version_code  # noqa: E402


def run(*args):
    return subprocess.run([sys.executable, "-I", str(SCRIPT), *args], capture_output=True, text=True)


class VersionCodeTest(unittest.TestCase):
    def test_codes_from_the_spec(self):
        self.assertEqual(version_code.version_code("0.1.0-rc.1"), 10001)
        self.assertEqual(version_code.version_code("0.1.0"), 10099)
        self.assertEqual(version_code.version_code("1.2.3-rc.4"), 1020304)

    def test_each_new_version_gets_a_bigger_code(self):
        order = ["0.1.0-rc.1", "0.1.0-rc.2", "0.1.0-rc.98", "0.1.0", "0.1.1-rc.1", "0.1.1", "0.2.0", "0.99.99",
                 "1.0.0-rc.1", "1.0.0", "2099.99.99"]
        codes = [version_code.version_code(version) for version in order]
        self.assertEqual(codes, sorted(codes))
        self.assertEqual(len(set(codes)), len(codes))

    def test_versions_out_of_the_format_are_refused(self):
        # rc 99 é o lugar da versão final; menor e correção têm dois dígitos no código; acima de
        # 2099.99.99 o código passa do máximo do Android (2.100.000.000).
        for version in ("0.1.0-rc.99", "0.1.0-rc.0", "0.1.0-rc.01", "0.1", "0.1.0.1", "v0.1.0", "0.1.0-beta.1",
                        "0.100.0", "0.1.100", "2100.0.0", "", " 0.1.0", "0.1.0\n"):
            with self.subTest(version=version):
                with self.assertRaises(ValueError):
                    version_code.version_code(version)

    def test_command_prints_the_code(self):
        result = run("0.1.0-rc.1")
        self.assertEqual((result.returncode, result.stdout), (0, "10001\n"))

    def test_command_exits_with_2_on_a_bad_version(self):
        for version in ("0.1.0-rc.99", "0.1"):
            with self.subTest(version=version):
                result = run(version)
                self.assertEqual((result.returncode, result.stdout), (2, ""))
                self.assertIn(version, result.stderr)

    def test_command_exits_with_2_without_exactly_one_version(self):
        for args in ((), ("0.1.0", "0.2.0")):
            with self.subTest(args=args):
                result = run(*args)
                self.assertEqual(result.returncode, 2)
                self.assertIn("uso:", result.stderr)


if __name__ == "__main__":
    unittest.main()
