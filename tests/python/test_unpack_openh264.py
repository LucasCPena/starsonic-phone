"""A descompressão do módulo H.264 da Cisco no CI (build/unpack_openh264.py, chamado pelo build/Test-OpenH264.ps1): as
mesmas regras do app (windows/app/src/Bunzip.cpp e starsonic/desktop/H264Module.cpp). Um arquivo que o app recusaria
nunca passa no CI."""
import bz2
import contextlib
import io
import pathlib
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "build"))

import unpack_openh264  # noqa: E402

DLL = b"MZ" + bytes(range(256)) * 64


class UnpackTest(unittest.TestCase):
    def test_a_whole_stream_is_unpacked(self):
        self.assertEqual(unpack_openh264.unpack(bz2.compress(DLL)), DLL)

    def test_bytes_after_the_end_of_the_stream_are_refused(self):
        packed = bz2.compress(DLL)
        with self.assertRaisesRegex(unpack_openh264.UnpackError, "13 bytes depois do fim"):
            unpack_openh264.unpack(packed + b"trailing junk")
        # Um segundo fluxo inteiro também: o Bunzip2 do app lê um fluxo só.
        with self.assertRaisesRegex(unpack_openh264.UnpackError, "depois do fim"):
            unpack_openh264.unpack(packed + packed)

    def test_a_cut_stream_is_refused(self):
        packed = bz2.compress(DLL)
        with self.assertRaisesRegex(unpack_openh264.UnpackError, "cortado"):
            unpack_openh264.unpack(packed[:len(packed) // 2])

    def test_garbage_and_empty_are_refused(self):
        with self.assertRaisesRegex(unpack_openh264.UnpackError, "bzip2"):
            unpack_openh264.unpack(b"this is not bzip2 at all")
        with self.assertRaisesRegex(unpack_openh264.UnpackError, "vazio"):
            unpack_openh264.unpack(b"")

    def test_the_limits_are_the_apps(self):
        # O fetch(url, 4194304, 60000) e o bunzip(corpo, 8388608) do H264Module.
        self.assertEqual(unpack_openh264.MAX_COMPRESSED, 4194304)
        self.assertEqual(unpack_openh264.MAX_UNPACKED, 8388608)
        exactly = b"\0" * unpack_openh264.MAX_UNPACKED
        self.assertEqual(len(unpack_openh264.unpack(bz2.compress(exactly))), unpack_openh264.MAX_UNPACKED)
        with self.assertRaisesRegex(unpack_openh264.UnpackError, "8388608"):
            unpack_openh264.unpack(bz2.compress(exactly + b"\0"))
        with self.assertRaisesRegex(unpack_openh264.UnpackError, "4194304"):
            unpack_openh264.unpack(b"\0" * (unpack_openh264.MAX_COMPRESSED + 1))


class CommandLineTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def run_main(self, data):
        source = self.dir / "openh264.dll.bz2"
        target = self.dir / "openh264.dll"
        source.write_bytes(data)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = unpack_openh264.main([str(source), str(target)])
        return code, out.getvalue(), target

    def test_the_dll_is_written(self):
        code, _, target = self.run_main(bz2.compress(DLL))
        self.assertEqual(code, 0)
        self.assertEqual(target.read_bytes(), DLL)

    def test_a_refused_file_writes_nothing_and_says_why(self):
        code, message, target = self.run_main(bz2.compress(DLL) + b"x")
        self.assertEqual(code, 1)
        self.assertFalse(target.exists())
        self.assertIn("1 bytes depois do fim do fluxo bzip2", message)

    def test_the_usage(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(unpack_openh264.main([]), 2)
        self.assertIn("uso:", out.getvalue())


if __name__ == "__main__":
    unittest.main()
