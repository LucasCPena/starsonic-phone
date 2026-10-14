import contextlib
import io
import pathlib
import struct
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "build" / "android"))

import elf_align  # noqa: E402

PT_NULL, PT_LOAD, PT_DYNAMIC = 0, 1, 2
KB4, KB16, KB64 = 0x1000, 0x4000, 0x10000


def make_elf(segments, bits=64, little=True):
    """ELF sintético: só o cabeçalho e a tabela de programas; segments = [(p_type, p_align), ...]."""
    e = "<" if little else ">"
    ident = b"\x7fELF" + bytes([2 if bits == 64 else 1, 1 if little else 2, 1]) + bytes(9)
    if bits == 64:
        ehsize, phentsize = 64, 56
        header = struct.pack(e + "HHIQQQIHHHHHH", 3, 183, 1, 0, ehsize, 0, 0, ehsize, phentsize, len(segments), 0, 0, 0)
    else:
        ehsize, phentsize = 52, 32
        header = struct.pack(e + "HHIIIIIHHHHHH", 3, 40, 1, 0, ehsize, 0, 0, ehsize, phentsize, len(segments), 0, 0, 0)
    table = b""
    for p_type, p_align in segments:
        if bits == 64:
            # p_type, p_flags, p_offset, p_vaddr, p_paddr, p_filesz, p_memsz, p_align
            table += struct.pack(e + "IIQQQQQQ", p_type, 5, 0, 0, 0, 0, 0, p_align)
        else:
            # p_type, p_offset, p_vaddr, p_paddr, p_filesz, p_memsz, p_flags, p_align
            table += struct.pack(e + "IIIIIIII", p_type, 0, 0, 0, 0, 0, 5, p_align)
    return ident + header + table


class ElfAlignTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, name, data):
        path = self.dir / name
        path.write_bytes(data)
        return path

    def run_main(self, *paths):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = elf_align.main([str(p) for p in paths])
        return code, out.getvalue(), err.getvalue()

    def test_elf64_with_4k_load_is_misaligned(self):
        path = self.write("libruim.so", make_elf([(PT_LOAD, KB4)]))
        self.assertEqual(elf_align.load_alignments(path), [4096])
        code, out, _ = self.run_main(path)
        self.assertEqual(code, 1)
        self.assertIn(str(path), out)

    def test_elf64_with_16k_load_is_aligned(self):
        path = self.write("libboa.so", make_elf([(PT_LOAD, KB16)]))
        self.assertEqual(elf_align.load_alignments(path), [16384])
        code, out, _ = self.run_main(path)
        self.assertEqual(code, 0)
        self.assertIn("ok:", out)
        self.assertIn(str(path), out)

    def test_elf32_with_4k_load_is_misaligned(self):
        path = self.write("libruim32.so", make_elf([(PT_LOAD, KB4)], bits=32))
        self.assertEqual(elf_align.load_alignments(path), [4096])
        self.assertEqual(self.run_main(path)[0], 1)

    def test_elf32_with_16k_load_is_aligned(self):
        path = self.write("libboa32.so", make_elf([(PT_LOAD, KB16)], bits=32))
        self.assertEqual(elf_align.load_alignments(path), [16384])
        self.assertEqual(self.run_main(path)[0], 0)

    def test_every_load_segment_is_reported_and_other_segments_are_ignored(self):
        for bits in (64, 32):
            segments = [(PT_LOAD, KB16), (PT_DYNAMIC, 8), (PT_LOAD, KB64), (PT_NULL, 0)]
            path = self.write("libvarios%d.so" % bits, make_elf(segments, bits=bits))
            self.assertEqual(elf_align.load_alignments(path), [16384, 65536], bits)
            self.assertEqual(self.run_main(path)[0], 0, bits)

    def test_one_misaligned_load_among_aligned_ones_fails(self):
        for bits in (64, 32):
            path = self.write("libmisto%d.so" % bits, make_elf([(PT_LOAD, KB16), (PT_LOAD, KB4)], bits=bits))
            self.assertEqual(elf_align.load_alignments(path), [16384, 4096], bits)
            self.assertEqual(self.run_main(path)[0], 1, bits)

    def test_main_lists_only_the_misaligned_files(self):
        good = self.write("libboa.so", make_elf([(PT_LOAD, KB16)]))
        bad = self.write("libruim.so", make_elf([(PT_LOAD, KB4)]))
        code, out, _ = self.run_main(good, bad)
        self.assertEqual(code, 1)
        failures = [line for line in out.splitlines() if not line.startswith("ok:")]
        self.assertEqual(len(failures), 1, out)
        self.assertIn(str(bad), failures[0])
        self.assertNotIn(str(good), failures[0])
        self.assertIn(str(good), "\n".join(line for line in out.splitlines() if line.startswith("ok:")))

    def test_no_alignment_requirement_counts_as_misaligned(self):
        # p_align 0 ou 1 = "sem exigência": o carregador de páginas de 16 KB precisa de 16384 declarado.
        for align in (0, 1):
            path = self.write("libsem%d.so" % align, make_elf([(PT_LOAD, align)]))
            self.assertEqual(self.run_main(path)[0], 1, align)

    def test_file_that_is_not_elf_is_a_clear_error(self):
        path = self.write("texto.so", b"isto nao e um ELF, e so texto\n" * 8)
        with self.assertRaises(ValueError) as caught:
            elf_align.load_alignments(path)
        self.assertIn("ELF", str(caught.exception))
        self.assertIn(str(path), str(caught.exception))
        code, out, err = self.run_main(path)
        self.assertEqual(code, 1)
        self.assertIn("ELF", err)
        self.assertNotIn("ok:", out)

    def test_empty_and_tiny_files_are_not_elf(self):
        for name, data in (("vazio.so", b""), ("pequeno.so", b"\x7fELF")):
            path = self.write(name, data)
            with self.assertRaises(ValueError, msg=name):
                elf_align.load_alignments(path)
            self.assertEqual(self.run_main(path)[0], 1, name)

    def test_big_endian_elf_is_refused(self):
        path = self.write("libbig.so", make_elf([(PT_LOAD, KB16)], little=False))
        with self.assertRaises(ValueError) as caught:
            elf_align.load_alignments(path)
        self.assertIn("little-endian", str(caught.exception))

    def test_truncated_program_header_table_is_a_clear_error(self):
        data = make_elf([(PT_LOAD, KB16), (PT_LOAD, KB16)])
        path = self.write("libcortada.so", data[:-20])
        with self.assertRaises(ValueError) as caught:
            elf_align.load_alignments(path)
        self.assertIn("truncad", str(caught.exception))
        self.assertEqual(self.run_main(path)[0], 1)

    def test_elf_without_load_segments_is_an_error(self):
        path = self.write("libvazia.so", make_elf([(PT_DYNAMIC, 8)]))
        self.assertEqual(elf_align.load_alignments(path), [])
        code, out, err = self.run_main(path)
        self.assertEqual(code, 1)
        self.assertIn("PT_LOAD", out + err)

    def test_missing_file_is_a_failure_not_a_crash(self):
        code, out, err = self.run_main(self.dir / "nao-existe.so")
        self.assertEqual(code, 1)
        self.assertIn("nao-existe.so", out + err)

    def test_without_arguments_it_asks_for_files(self):
        code, _, err = self.run_main()
        self.assertEqual(code, 2)
        self.assertIn("uso:", err)


if __name__ == "__main__":
    unittest.main()
