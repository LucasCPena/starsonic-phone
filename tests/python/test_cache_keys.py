"""As chaves dos caches do job windows (build/cache_keys.py): a das dependências nativas (pjproject, vcpkg e o SDK do
WebView2, uns 13 minutos para refazer) não muda com o bootstrapper do WebView2, que tem um cache próprio."""
import json
import pathlib
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "build"))

import cache_keys  # noqa: E402


class CacheKeysTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self._tmp.name)
        (self.root / "build").mkdir()
        self.lock = json.loads((ROOT / "build" / "deps.lock").read_text(encoding="utf-8"))
        (self.root / "build" / "config_site.h").write_bytes(b"#define X 1\r\n")
        (self.root / "build" / "Build-Deps.ps1").write_bytes(b"Write-Host 'deps'\r\n")
        self.write_lock()

    def tearDown(self):
        self._tmp.cleanup()

    def write_lock(self):
        (self.root / "build" / "deps.lock").write_text(json.dumps(self.lock, indent=2), encoding="utf-8")

    def keys(self):
        return cache_keys.compute(self.root)

    def test_the_bootstrapper_does_not_change_the_deps_key(self):
        before = self.keys()
        self.lock["webview2Bootstrapper"] = {"version": "9.9.9.9", "url": "https://example.invalid/x.exe",
                                             "sha256": "0" * 64}
        self.write_lock()
        after = self.keys()
        self.assertEqual(before["deps"], after["deps"])
        self.assertNotEqual(before["bootstrapper"], after["bootstrapper"])
        self.assertEqual(after["bootstrapper"], "webview2-bootstrapper-" + "0" * 64)

    def test_the_deps_and_their_scripts_change_the_deps_key(self):
        before = self.keys()["deps"]
        self.assertTrue(before.startswith("deps-v2-"))
        self.lock["pjproject"]["commit"] = "1" * 40
        self.write_lock()
        changed = self.keys()["deps"]
        self.assertNotEqual(before, changed)
        (self.root / "build" / "config_site.h").write_bytes(b"#define X 2\r\n")
        self.assertNotEqual(changed, self.keys()["deps"])

    def test_line_endings_and_json_layout_do_not_matter(self):
        before = self.keys()["deps"]
        (self.root / "build" / "deps.lock").write_text(json.dumps(self.lock), encoding="utf-8")
        (self.root / "build" / "config_site.h").write_bytes(b"#define X 1\n")
        self.assertEqual(before, self.keys()["deps"])


if __name__ == "__main__":
    unittest.main()
