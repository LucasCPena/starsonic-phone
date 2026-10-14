import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
LOCK = ROOT / "build" / "deps.lock"
HEX40 = re.compile(r"\A[0-9a-f]{40}\Z")
HEX64 = re.compile(r"\A[0-9a-f]{64}\Z")


class AndroidKeyTest(unittest.TestCase):
    def setUp(self):
        self.lock = json.loads(LOCK.read_text(encoding="utf-8"))

    def test_android_key_has_what_the_build_script_reads(self):
        self.assertIn("android", self.lock)
        android = self.lock["android"]
        for name in ("pjproject", "opus"):
            self.assertRegex(android[name]["commit"], HEX40, name)
            self.assertTrue(android[name]["repo"].startswith("https://github.com/"), name)
            self.assertTrue(android[name]["tag"], name)
        oboe = android["oboe"]
        self.assertRegex(oboe["sha256"], HEX64)
        self.assertRegex(oboe["commit"], HEX40)
        self.assertIn("/" + oboe["version"] + "/oboe-" + oboe["version"] + ".aar", oboe["aar"])
        self.assertRegex(android["ndk"], r"\A\d+\.\d+\.\d+\Z")

    def test_android_versions_fixed_by_the_plan(self):
        android = self.lock["android"]
        self.assertEqual(android["pjproject"]["tag"], "2.17")
        self.assertEqual(android["opus"]["tag"], "v1.6.1")
        self.assertEqual(android["oboe"]["version"], "1.11.0")
        self.assertEqual(android["ndk"], "30.0.16248370")
        self.assertEqual(android["agp"], "9.4.0")
        self.assertEqual(android["gradle"], "9.6.0")
        self.assertEqual(android["composeCompilerPlugin"], "2.4.21")
        self.assertEqual(android["composeBom"], "2026.09.00")
        self.assertEqual(android["jdk"], "17")

    def test_android_builds_the_same_pjproject_as_windows(self):
        windows, android = self.lock["pjproject"], self.lock["android"]["pjproject"]
        for field in ("repo", "tag", "commit"):
            self.assertEqual(android[field], windows[field], field)


class BuildPjprojectGuardTest(unittest.TestCase):
    """build/linux/build-pjproject.sh nao pode testar um pjproject diferente do que vai no APK."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tree = pathlib.Path(self._tmp.name)
        (self.tree / "build" / "linux").mkdir(parents=True)
        shutil.copy(ROOT / "build" / "linux" / "build-pjproject.sh", self.tree / "build" / "linux")
        shutil.copy(ROOT / "build" / "linux" / "config_site.h", self.tree / "build" / "linux")
        self.lock = json.loads(LOCK.read_text(encoding="utf-8"))
        # Sem a recusa, o script so chegaria a uma busca que falha na hora (nada de rede nem de compilacao).
        self.lock["pjproject"]["repo"] = "file://" + str(self.tree / "nao-existe")

    def tearDown(self):
        self._tmp.cleanup()

    def run_script(self):
        (self.tree / "build" / "deps.lock").write_text(json.dumps(self.lock), encoding="utf-8")
        return subprocess.run(
            ["bash", str(self.tree / "build" / "linux" / "build-pjproject.sh"),
             str(self.tree / "work"), str(self.tree / "prefix")],
            capture_output=True, text=True, timeout=60)

    def test_refuses_when_android_has_another_commit(self):
        windows_commit = self.lock["pjproject"]["commit"]
        self.lock["android"]["pjproject"]["commit"] = "0" * 40
        result = self.run_script()
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("android.pjproject.commit", result.stderr)
        self.assertIn(windows_commit, result.stderr)
        self.assertIn("0" * 40, result.stderr)

    def test_same_commit_goes_on_to_fetch_the_source(self):
        # Sem diferenca nao ha recusa: o script segue e so para na busca (repositorio que nao existe).
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("android.pjproject.commit", result.stderr)


class BuildDepsGuardTest(unittest.TestCase):
    """build/android/build-deps.sh recusa um NDK errado antes de baixar ou compilar qualquer coisa."""

    def setUp(self):
        for tool in ("git", "curl", "unzip", "cmake", "make", "pkg-config"):
            if shutil.which(tool) is None:
                self.skipTest("falta o programa " + tool)
        self._tmp = tempfile.TemporaryDirectory()
        self.tree = pathlib.Path(self._tmp.name)
        (self.tree / "build" / "android").mkdir(parents=True)
        shutil.copy(ROOT / "build" / "android" / "build-deps.sh", self.tree / "build" / "android")
        shutil.copy(LOCK, self.tree / "build" / "deps.lock")
        self.ndk_version = json.loads(LOCK.read_text(encoding="utf-8"))["android"]["ndk"]

    def tearDown(self):
        self._tmp.cleanup()

    def make_ndk(self, name, revision):
        ndk = self.tree / name
        ndk.mkdir()
        (ndk / "source.properties").write_text(
            "Pkg.Desc = Android NDK\nPkg.Revision = %s\n" % revision, encoding="utf-8")
        return ndk

    def run_script(self, ndk=None):
        env = {key: value for key, value in os.environ.items() if key != "ANDROID_NDK_ROOT"}
        if ndk is not None:
            env["ANDROID_NDK_ROOT"] = str(ndk)
        return subprocess.run(
            ["bash", str(self.tree / "build" / "android" / "build-deps.sh"),
             str(self.tree / "out"), str(self.tree / "work")],
            capture_output=True, text=True, env=env, timeout=60)

    def test_refuses_without_the_ndk(self):
        result = self.run_script()
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("ANDROID_NDK_ROOT", result.stderr)

    def test_refuses_an_ndk_that_is_not_the_one_in_the_lock(self):
        result = self.run_script(self.make_ndk("ndk-27", "27.3.13750724"))
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("27.3.13750724", result.stderr)
        self.assertIn(self.ndk_version, result.stderr)

    def test_refuses_paths_with_spaces(self):
        result = self.run_script(self.make_ndk("ndk com espaco", self.ndk_version))
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("espaços", result.stderr)

    def test_the_right_ndk_gets_past_the_guards(self):
        # Sem o toolchain dentro da pasta o script para logo depois das conferências, ainda sem rede.
        result = self.run_script(self.make_ndk("ndk-certo", self.ndk_version))
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("llvm-nm", result.stderr)


if __name__ == "__main__":
    unittest.main()
