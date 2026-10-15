"""build/android/make_source_bundle.sh com repositórios git locais no lugar do GitHub: o zip do código-fonte completo
(GPL v3, spec 10) com este repositório no commit de agora, o pjproject, o Opus e o Oboe nos commits de deps.lock e o
LEIA-ME.txt.
"""
import json
import os
import pathlib
import subprocess
import tempfile
import unittest
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "build" / "android" / "make_source_bundle.sh"
VERSION = "0.1.0-rc.1"
NAME = "StarsonicPhone-android-%s-codigo-fonte-completo" % VERSION
GIT_ENV = {"GIT_AUTHOR_NAME": "Teste", "GIT_AUTHOR_EMAIL": "teste@example.com", "GIT_COMMITTER_NAME": "Teste",
           "GIT_COMMITTER_EMAIL": "teste@example.com", "GIT_CONFIG_NOSYSTEM": "1"}


class MakeSourceBundleTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self.tmp.name)
        self.env = dict(os.environ, **GIT_ENV)
        self.env.pop("GITHUB_ACTIONS", None)
        self.deps = {
            "pjproject": self.make_repo("pjproject", {"pjlib/include/pj/config.h": "#define PJ 1\n"}),
            "opus": self.make_repo("opus", {"include/opus.h": "/* opus */\n"}),
            "oboe": self.make_repo("oboe", {"include/oboe/Oboe.h": "// oboe\n"}),
        }
        self.repo = self.make_repo("starsonic-phone", {
            "README.md": "versao do commit\n",
            "android/app/build.gradle.kts": "android {}\n",
            "build/deps.lock": self.lock_text(),
        })
        # O que não está no commit não vai: um arquivo novo e uma mudança ainda sem commit.
        (self.repo / "nao-versionado.txt").write_text("fora\n", encoding="utf-8")
        (self.repo / "README.md").write_text("mudanca sem commit\n", encoding="utf-8")
        self.out = self.dir / "dist"

    def tearDown(self):
        self.tmp.cleanup()

    def git(self, folder, *args):
        return subprocess.run(["git", "-C", str(folder)] + list(args), env=self.env, check=True, capture_output=True,
                              text=True).stdout.strip()

    def make_repo(self, name, files):
        folder = self.dir / name
        folder.mkdir()
        self.git(folder, "init", "-q")
        for path, text in files.items():
            target = folder / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text, encoding="utf-8")
        self.git(folder, "add", "-A")
        self.git(folder, "commit", "-q", "-m", "inicial")
        return folder

    def commit_of(self, folder):
        return self.git(folder, "rev-parse", "HEAD")

    def lock_text(self, **wrong_commits):
        def entry(name, **extra):
            commit = wrong_commits.get(name, self.commit_of(self.deps[name]))
            return dict({"repo": str(self.deps[name]), "commit": commit}, **extra)
        lock = {"android": {"pjproject": entry("pjproject", tag="2.17"), "opus": entry("opus", tag="v1.6.1"),
                            "oboe": entry("oboe", version="1.11.0"), "ndk": "30.0.16248370"}}
        return json.dumps(lock, indent=2) + "\n"

    def run_script(self, *args, **env):
        return subprocess.run(["bash", str(SCRIPT)] + list(args), env=dict(self.env, REPO_DIR=str(self.repo), **env),
                              capture_output=True, text=True, timeout=120)

    def test_the_bundle_has_the_repository_the_three_dependencies_and_the_readme(self):
        result = self.run_script(VERSION, str(self.out))
        self.assertEqual(result.returncode, 0, result.stderr)
        bundle = self.out / (NAME + ".zip")
        self.assertTrue(bundle.is_file(), list(self.out.iterdir()))
        with zipfile.ZipFile(bundle) as archive:
            names = set(archive.namelist())
            for expected in ("LEIA-ME.txt", "starsonic-phone/README.md", "starsonic-phone/android/app/build.gradle.kts",
                             "starsonic-phone/build/deps.lock", "pjproject-2.17/pjlib/include/pj/config.h",
                             "opus-v1.6.1/include/opus.h", "oboe-1.11.0/include/oboe/Oboe.h"):
                self.assertIn("%s/%s" % (NAME, expected), names)
            self.assertNotIn("%s/starsonic-phone/nao-versionado.txt" % NAME, names)
            self.assertFalse([name for name in names if "/.git/" in name or name.endswith("/.git")], names)
            self.assertTrue(all(name.startswith(NAME + "/") for name in names), names)
            self.assertEqual(archive.read("%s/starsonic-phone/README.md" % NAME), b"versao do commit\n")
            readme = archive.read("%s/LEIA-ME.txt" % NAME).decode("utf-8")
        self.assertIn(VERSION, readme)
        self.assertIn("GPL", readme)
        self.assertIn(self.commit_of(self.repo), readme)
        for name, folder in self.deps.items():
            self.assertIn(self.commit_of(folder), readme, name)
            self.assertIn(str(folder), readme, name)

    def test_a_second_run_replaces_the_bundle(self):
        self.assertEqual(self.run_script(VERSION, str(self.out)).returncode, 0)
        (self.repo / "README.md").write_text("segundo commit\n", encoding="utf-8")
        self.git(self.repo, "commit", "-q", "-am", "segundo")
        result = self.run_script(VERSION, str(self.out))
        self.assertEqual(result.returncode, 0, result.stderr)
        with zipfile.ZipFile(self.out / (NAME + ".zip")) as archive:
            self.assertEqual(archive.read("%s/starsonic-phone/README.md" % NAME), b"segundo commit\n")
            self.assertIn(self.commit_of(self.repo), archive.read("%s/LEIA-ME.txt" % NAME).decode("utf-8"))

    def test_a_commit_that_the_dependency_does_not_have_fails_without_a_bundle(self):
        lock = self.dir / "deps-errado.lock"
        lock.write_text(self.lock_text(opus="0123456789abcdef0123456789abcdef01234567"), encoding="utf-8")
        result = self.run_script(VERSION, str(self.out), DEPS_LOCK=str(lock))
        self.assertEqual(result.returncode, 1)
        self.assertIn("0123456789abcdef0123456789abcdef01234567", result.stderr)
        self.assertFalse((self.out / (NAME + ".zip")).exists())

    def test_invalid_versions_and_usage(self):
        for version in ("0.1", "v0.1.0", "0.1.0-rc.0", "0.1.0-beta", "0.1.0\n0.2.0"):
            with self.subTest(version=version):
                result = self.run_script(version, str(self.out))
                self.assertEqual(result.returncode, 2)
                self.assertIn("versão inválida", result.stderr)
        result = self.run_script(VERSION)
        self.assertEqual(result.returncode, 2)
        self.assertIn("uso:", result.stderr)
        self.assertFalse(self.out.exists())


if __name__ == "__main__":
    unittest.main()
