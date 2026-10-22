import lzma
import os
import pathlib
import random
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "build"))

import check_branding  # noqa: E402

BS = chr(92)  # barra invertida
NSIS_SIGNATURE = b"\xef\xbe\xad\xdeNullsoftInst"


def lzma_raw(data):
    """O LZMA do NSIS: as 5 bytes de propriedades e o fluxo, sem o tamanho de 8 bytes do formato .lzma."""
    alone = lzma.compress(data, format=lzma.FORMAT_ALONE)
    return alone[:5] + alone[13:]


def fake_installer(content, solid=True, offset=1024):
    """Um instalador NSIS como o makensis grava: o stub, o firstheader num múltiplo de 512 e os dados em LZMA (sólido:
    um fluxo só com todos os blocos; não sólido: cada bloco com o tamanho e o bit de comprimido)."""
    blocks = [b"cabecalho " + content, b"um arquivo"]
    if solid:
        plain = b"".join(struct.pack("<I", len(block)) + block for block in blocks)
        body = lzma_raw(plain)
    else:
        body = b""
        for block in blocks:
            packed = lzma_raw(block)
            body += struct.pack("<I", len(packed) | 0x80000000) + packed
    header = struct.pack("<I", 0) + NSIS_SIGNATURE + struct.pack("<II", len(blocks[0]), 28 + len(body) + 4)
    stub = b"MZ" + b"\x00" * (offset - 2)
    return stub + header + body + b"\x00\x00\x00\x00"


def makensis():
    return os.environ.get("STARSONIC_MAKENSIS") or shutil.which("makensis")


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

    # O app novo (spec da W1, 11.2): nenhum "MicroSIP" no StarsonicPhone.exe novo, na pasta ui\ nem no instalador
    # novo, nem com o copyright ou o "Baseado no" que o app antigo podia ter.
    def test_new_app_exe_allows_no_microsip_at_all(self):
        exe = self.write("out-novo/StarsonicPhone.exe",
                         b"\x00Starsonic Phone\x00" + "Starsonic Phone/0.1.0".encode("utf-16-le") + b"\x00\x00")
        self.assertEqual(check_branding.find_strict_problems(exe), [])
        for text in ("Copyright (c) 2011-2025, MicroSIP (www.microsip.org)", "Baseado no MicroSIP", "MicroSIP"):
            for encoded in (text.encode("ascii"), text.encode("utf-16-le")):
                exe = self.write("out-novo/StarsonicPhone.exe", b"\x00" + encoded + b"\x00\x00")
                found = check_branding.find_strict_problems(exe)
                self.assertTrue(found, (text, encoded))
                self.assertEqual({item[0] for item in found}, {"StarsonicPhone.exe"})

    def test_new_app_exe_rejects_microsip_hosts_in_any_case(self):
        for host in ("update.microsip.org", "WWW.MICROSIP.ORG"):
            exe = self.write("out-novo/StarsonicPhone.exe", b"\x00" + host.encode("utf-16-le") + b"\x00\x00")
            self.assertEqual(len(check_branding.find_strict_problems(exe)), 1, host)

    def test_ui_folder_is_checked_file_by_file(self):
        ui = self.repo / "out-novo" / "ui"
        self.write("out-novo/ui/index.html", "<!doctype html><title>Starsonic Phone</title>")
        self.write("out-novo/ui/assets/logo.png", b"\x89PNG\r\n\x1a\n\x00\x00")
        self.assertEqual(check_branding.find_ui_problems(ui), [])
        self.write("out-novo/ui/app.js", 'const sobre = "Baseado no MicroSIP";\n')
        self.write("out-novo/ui/assets/fonte.woff2", b"\x00" + "MicroSIP".encode("utf-16-le") + b"\x00")
        found = sorted(item[0] for item in check_branding.find_ui_problems(ui))
        self.assertEqual(found, ["ui/app.js", "ui/assets/fonte.woff2"])

    def test_missing_ui_folder_is_a_problem(self):
        found = check_branding.find_ui_problems(self.repo / "sem-ui")
        self.assertEqual(len(found), 1)
        self.assertIn("pasta", found[0][2])

    def test_main_checks_the_new_app_the_ui_and_the_installer(self):
        exe = self.write("out-novo/StarsonicPhone.exe", b"\x00Starsonic Phone\x00")
        self.write("out-novo/ui/index.html", "<title>Starsonic Phone</title>")
        setup = self.write("dist/StarsonicPhone-0.0.0-setup.exe", fake_installer("Starsonic Phone".encode("utf-16-le")))
        args = ["--repo", str(self.repo), "--app-novo", str(exe), "--ui", str(self.repo / "out-novo" / "ui"),
                "--instalador", str(setup)]
        self.assertEqual(check_branding.main(args), 0)
        self.write("dist/StarsonicPhone-0.0.0-setup.exe", fake_installer("Desinstalar o MicroSIP".encode("utf-16-le")))
        self.assertEqual(check_branding.main(args), 1)

    # O instalador comprimido (Ruling da T13, Important 1): o texto das páginas e as caixas de mensagem ficam dentro do
    # LZMA; o check abre o instalador e procura no que está dentro, sem diferenciar maiúsculas.
    def test_compressed_installer_is_opened_and_checked(self):
        utf16 = "Desinstalar o MicroSIP".encode("utf-16-le")
        for solid in (True, False):
            setup = self.write("dist/bad.exe", fake_installer(utf16, solid=solid))
            self.assertNotIn(utf16, setup.read_bytes())   # o texto não aparece no arquivo como está
            found = check_branding.find_installer_problems(setup)
            self.assertTrue(found, solid)
            self.assertTrue(any("dentro" in item[2] for item in found), found)
            clean = self.write("dist/good.exe", fake_installer("Starsonic Phone".encode("utf-16-le"), solid=solid))
            self.assertEqual(check_branding.find_installer_problems(clean), [], solid)

    def test_installer_check_ignores_case(self):
        for text in ("microsip", "MICROSIP", "Microsip.org"):
            setup = self.write("dist/case.exe", fake_installer(text.encode("utf-16-le")))
            self.assertTrue(check_branding.find_installer_problems(setup), text)

    def test_an_installer_that_cannot_be_opened_is_a_problem(self):
        setup = self.write("dist/strange.exe", b"MZ" + b"\x00" * 2000)
        found = check_branding.find_installer_problems(setup)
        self.assertEqual(len(found), 1)
        self.assertIn("NSIS", found[0][2])
        broken = bytearray(fake_installer(b"x"))
        broken[1024 + 28:1024 + 33] = b"\xff\xff\xff\xff\xff"   # propriedades do LZMA impossíveis
        setup = self.write("dist/broken.exe", bytes(broken))
        self.assertTrue(check_branding.find_installer_problems(setup))

    def test_strict_check_ignores_case(self):
        for text in ("microsip", "MICROSIP"):
            exe = self.write("out-novo/StarsonicPhone.exe", b"\x00" + text.encode("utf-16-le") + b"\x00")
            self.assertTrue(check_branding.find_strict_problems(exe), text)
        ui = self.repo / "out-novo" / "ui"
        self.write("out-novo/ui/app.js", 'const x = "microsip";\n')
        self.assertTrue(check_branding.find_ui_problems(ui))

    # Um instalador estragado não passa como limpo: o LZMA tem de abrir até o fim e os blocos de dentro têm de bater com
    # os tamanhos do cabeçalho (Rodada 2 da T13).
    def assertUnreadable(self, data, label):
        setup = self.write("dist/estragado.exe", data)
        found = check_branding.find_installer_problems(setup)
        self.assertTrue(any("abrir o instalador" in item[2] for item in found), (label, found))

    def damaged(self, data):
        """O instalador cortado ao meio, com 150 KB trocados no meio do fluxo e com lixo depois dos primeiros 70 KB do
        fluxo (o tamanho do arquivo igual)."""
        start = data.index(NSIS_SIGNATURE) + 24
        noise = random.Random(13)
        middle = start + (len(data) - start) // 3
        corrupted = data[:middle] + noise.randbytes(150 * 1024) + data[middle + 150 * 1024:]
        tail = start + 70 * 1024
        garbage = data[:tail] + noise.randbytes(len(data) - tail)
        return {"cortado": data[:len(data) // 2], "trocado no meio": corrupted, "lixo depois de 70 KB": garbage}

    def test_a_damaged_installer_is_not_clean(self):
        payload = "Starsonic Phone ".encode("utf-16-le") + random.Random(7).randbytes(600 * 1024)
        for solid in (True, False):
            data = fake_installer(payload, solid=solid)
            self.assertEqual(check_branding.find_installer_problems(self.write("dist/bom.exe", data)), [], solid)
            for label, broken in self.damaged(data).items():
                self.assertUnreadable(broken, (solid, label))

    def make_real_setup(self, name, text, payload=None):
        lines = ["Unicode true", "SetCompressor /SOLID lzma", "RequestExecutionLevel user", 'Name "Teste"',
                 'OutFile "${OUT}"', "Section", '  MessageBox MB_OK "${TEXTO}"']
        if payload:
            lines.append('  File "%s"' % payload)
        script = self.write("instalador/%s.nsi" % name, "\r\n".join(lines + ["SectionEnd", ""]))
        out = self.repo / "instalador" / (name + "-instalador.exe")
        subprocess.run([makensis(), "-V1", "-DOUT=%s" % out, "-DTEXTO=%s" % text, str(script)], check=True)
        self.assertNotIn("MicroSIP".encode("utf-16-le"), out.read_bytes())
        return out

    @unittest.skipUnless(makensis(), "sem o makensis (o job windows do CI roda com ele)")
    def test_real_lzma_installer_with_microsip_fails(self):
        bad = check_branding.find_installer_problems(self.make_real_setup("ruim", "Desinstalar o MicroSIP"))
        self.assertTrue(bad)
        self.assertTrue(all(item[2].startswith("dentro do instalador: ") for item in bad), bad)
        self.assertTrue(any("MicroSIP" in item[2] for item in bad), bad)
        good = check_branding.find_installer_problems(self.make_real_setup("bom", "Desinstalar o Starsonic Phone"))
        self.assertEqual(good, [])

    @unittest.skipUnless(makensis(), "sem o makensis (o job windows do CI roda com ele)")
    def test_real_lzma_installer_damaged_is_not_clean(self):
        payload = self.write("instalador/carga.bin", random.Random(11).randbytes(600 * 1024))
        setup = self.make_real_setup("carga", "Desinstalar o Starsonic Phone", payload)
        data = setup.read_bytes()
        self.assertEqual(check_branding.find_installer_problems(setup), [])
        for label, broken in self.damaged(data).items():
            self.assertUnreadable(broken, label)

    def test_repository_has_no_visible_microsip(self):
        found = check_branding.find_problems(ROOT)
        self.assertEqual(found, [], "\n".join("%s:%d: %s" % item for item in found))


if __name__ == "__main__":
    unittest.main()
