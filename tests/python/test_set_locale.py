"""build/android/set-locale.sh com um adb falso: o emulador passa para o idioma pedido (persist.sys.locale, com
o adb como root), o Android reinicia (stop e start) e o script espera o sys.boot_completed voltar; já no idioma,
nada muda.
"""
import os
import pathlib
import subprocess
import tempfile
import textwrap
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "build" / "android" / "set-locale.sh"

# Cada chamada vai para FAKE_ADB_LOG (uma linha); as propriedades ficam em arquivos (FAKE_PROPS/<nome>).
# "id -u" responde 0 a partir da chamada FAKE_ROOT_AFTER (nunca, com 0). Depois do start, o
# sys.boot_completed volta a 1 na chamada FAKE_BOOT_AFTER do getprop dele (nunca, com 0).
FAKE_ADB = textwrap.dedent("""\
    #!/usr/bin/env bash
    printf '%s\\n' "$*" >> "$FAKE_ADB_LOG"
    case "$*" in
        "shell id -u")
            calls=$(grep -c '^shell id -u$' "$FAKE_ADB_LOG")
            if [ "${FAKE_ROOT_AFTER:-1}" -gt 0 ] && [ "$calls" -ge "${FAKE_ROOT_AFTER:-1}" ]; then echo 0; else echo 2000; fi;;
        "shell getprop sys.boot_completed")
            if grep -q '^shell start$' "$FAKE_ADB_LOG"; then
                calls=$(sed -n '/^shell start$/,$p' "$FAKE_ADB_LOG" | grep -c '^shell getprop sys.boot_completed$')
                if [ "${FAKE_BOOT_AFTER:-2}" -gt 0 ] && [ "$calls" -ge "${FAKE_BOOT_AFTER:-2}" ]; then
                    printf '1\\r\\n' > "$FAKE_PROPS/sys.boot_completed"
                fi
            fi
            printf '%s\\r\\n' "$(cat "$FAKE_PROPS/sys.boot_completed" 2>/dev/null)";;
        "shell getprop "*)
            printf '%s\\r\\n' "$(cat "$FAKE_PROPS/${3}" 2>/dev/null)";;
        "shell setprop "*)
            printf '%s' "$4" > "$FAKE_PROPS/$3";;
    esac
    exit 0
    """)


class SetLocaleTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self.tmp.name)
        bin_dir = self.dir / "bin"
        bin_dir.mkdir()
        adb = bin_dir / "adb"
        adb.write_text(FAKE_ADB, encoding="utf-8")
        adb.chmod(0o755)
        self.props = self.dir / "props"
        self.props.mkdir()
        (self.props / "persist.sys.locale").write_text("en-US", encoding="utf-8")
        (self.props / "sys.boot_completed").write_text("1", encoding="utf-8")
        self.log = self.dir / "adb.log"
        self.env = dict(os.environ, PATH="%s%s%s" % (bin_dir, os.pathsep, os.environ["PATH"]),
                        FAKE_ADB_LOG=str(self.log), FAKE_PROPS=str(self.props),
                        SET_LOCALE_ROOT_WAIT="3", SET_LOCALE_BOOT_WAIT="3", SET_LOCALE_POLL="0")
        self.env.pop("GITHUB_ACTIONS", None)

    def tearDown(self):
        self.tmp.cleanup()

    def run_script(self, *args, **env):
        result = subprocess.run(["bash", str(SCRIPT), *args], capture_output=True, text=True,
                                env=dict(self.env, **env), timeout=60)
        calls = self.log.read_text(encoding="utf-8").splitlines() if self.log.exists() else []
        return result, calls

    def test_usage_without_the_locale(self):
        result, _calls = self.run_script()
        self.assertEqual(result.returncode, 2)
        self.assertIn("uso:", result.stderr)

    def test_a_device_already_in_the_locale_is_left_alone(self):
        (self.props / "persist.sys.locale").write_text("pt-BR", encoding="utf-8")
        result, calls = self.run_script("pt-BR")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse([call for call in calls if call.startswith(("shell setprop", "shell stop", "root"))], calls)

    def test_the_locale_changes_and_the_script_waits_for_the_android(self):
        result, calls = self.run_script("pt-BR", GITHUB_ACTIONS="true")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.props / "persist.sys.locale").read_text(encoding="utf-8"), "pt-BR")
        order = [call for call in calls if call.startswith(("root", "shell setprop", "shell stop", "shell start"))]
        self.assertEqual(order, ["root", "shell setprop persist.sys.locale pt-BR", "shell setprop sys.boot_completed 0",
                                 "shell stop", "shell start"])
        # Espera o Android voltar e tira a tela de bloqueio (sem senha) que volta com ele.
        after_start = calls[calls.index("shell start"):]
        self.assertGreaterEqual(after_start.count("shell getprop sys.boot_completed"), 2)
        self.assertIn("shell input keyevent 82", after_start)
        self.assertIn("::notice title=Idioma do emulador::", result.stdout)

    def test_without_root_nothing_changes(self):
        result, calls = self.run_script("pt-BR", FAKE_ROOT_AFTER="0")
        self.assertEqual(result.returncode, 1)
        self.assertIn("root", result.stderr)
        self.assertFalse([call for call in calls if call.startswith(("shell setprop", "shell stop"))], calls)

    def test_an_android_that_does_not_come_back_fails(self):
        result, _calls = self.run_script("pt-BR", FAKE_BOOT_AFTER="0")
        self.assertEqual(result.returncode, 1)
        self.assertIn("não voltou", result.stderr)


if __name__ == "__main__":
    unittest.main()
