"""build/android/check-boot.sh com um adb falso e uma porta de controle falsa: o BOOT_COMPLETED só passa
se a contagem de REGISTER do ramal sobe depois dele, e não antes, e se o processador fica acordado (o wake
lock da conexão aparece na seção "Wake Locks" do dumpsys power só depois dele).
"""
import os
import pathlib
import socketserver
import subprocess
import tempfile
import textwrap
import threading
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "build" / "android" / "check-boot.sh"
FORCE_STOP = "shell am force-stop br.com.starsonic.phone"
PIDOF = "shell pidof br.com.starsonic.phone"
DUMPSYS = "shell dumpsys power"
BROADCAST = ("shell am broadcast -a android.intent.action.BOOT_COMPLETED --include-stopped-packages "
             "-p br.com.starsonic.phone")

# Cada chamada vai para FAKE_ADB_LOG (uma linha). "id -u" responde 0 a partir da chamada FAKE_ROOT_AFTER
# (nunca, com 0); com FAKE_RECEIVER=1, o broadcast faz o app registrar (a contagem em FAKE_COUNT sobe) e,
# com FAKE_WAKE=1 (o padrão), segurar o wake lock da conexão. FAKE_STOP_FAILS=1 faz o force-stop falhar;
# FAKE_PIDOF é o pid do app que continua rodando; FAKE_STALE_WAKE=1 mostra o wake lock preso desde o começo.
# O dumpsys power falso traz sempre o histórico com a etiqueta (como o de verdade, que guarda os antigos).
FAKE_ADB = textwrap.dedent("""\
    #!/usr/bin/env bash
    printf '%s\\n' "$*" >> "$FAKE_ADB_LOG"
    case "$*" in
        "shell id -u")
            calls=$(grep -c '^shell id -u$' "$FAKE_ADB_LOG")
            if [ "${FAKE_ROOT_AFTER:-1}" -gt 0 ] && [ "$calls" -ge "${FAKE_ROOT_AFTER:-1}" ]; then echo 0; else echo 2000; fi;;
        "shell am force-stop"*)
            [ "${FAKE_STOP_FAILS:-0}" = 1 ] && exit 1;;
        "shell pidof"*)
            [ -n "${FAKE_PIDOF:-}" ] || exit 1
            echo "$FAKE_PIDOF";;
        "shell am broadcast"*)
            echo "Broadcast completed: result=0"
            if [ "${FAKE_RECEIVER:-0}" = 1 ]; then echo $(( $(cat "$FAKE_COUNT") + 1 )) > "$FAKE_COUNT"; fi;;
        "shell dumpsys power")
            held=0
            [ "${FAKE_STALE_WAKE:-0}" = 1 ] && held=1
            if [ "${FAKE_RECEIVER:-0}" = 1 ] && [ "${FAKE_WAKE:-1}" = 1 ] && grep -q '^shell am broadcast' "$FAKE_ADB_LOG"; then
                held=1
            fi
            printf 'POWER MANAGER (dumpsys power)\\r\\n\\r\\nPower Manager State:\\r\\n  mWakefulness=Awake\\r\\n\\r\\n'
            if [ "$held" = 1 ]; then
                printf "Wake Locks: size=1\\r\\n  PARTIAL_WAKE_LOCK              'starsonic:conexao' ACQ=-1s200ms (uid=10190 pid=4380)\\r\\n\\r\\n"
            else
                printf 'Wake Locks: size=0\\r\\n\\r\\n'
            fi
            printf 'Suspend Blockers: size=1\\r\\n  PowerManagerService.Display: ref count=1\\r\\n\\r\\n'
            printf "Wake Lock Log:\\r\\n  10-15 04:20:01.123 - 10190 - ACQ 'starsonic:conexao' (partial)\\r\\n";;
    esac
    exit 0
    """)


class FakeControl(socketserver.ThreadingTCPServer):
    """A porta de controle do registrador: REGISTERS <ramal> responde o número do arquivo de contagem (com
    rising, a contagem sobe a cada pergunta: um registro que não depende do BOOT_COMPLETED)."""
    daemon_threads = True

    def __init__(self, count_path):
        self.count_path = count_path
        self.rising = False
        self.reply = None
        super().__init__(("127.0.0.1", 0), ControlHandler)

    def answer(self):
        if self.reply is not None:
            return self.reply
        count = int(self.count_path.read_text(encoding="utf-8"))
        if self.rising:
            self.count_path.write_text(str(count + 1), encoding="utf-8")
        return str(count)


class ControlHandler(socketserver.StreamRequestHandler):
    def handle(self):
        line = self.rfile.readline().decode("utf-8").strip()
        reply = self.server.answer() if line == "REGISTERS 2001" else "ERR bad-command"
        self.wfile.write((reply + "\n").encode("utf-8"))


class CheckBootTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self.tmp.name)
        bin_dir = self.dir / "bin"
        bin_dir.mkdir()
        adb = bin_dir / "adb"
        adb.write_text(FAKE_ADB, encoding="utf-8")
        adb.chmod(0o755)
        self.log = self.dir / "adb.log"
        self.count = self.dir / "count"
        self.count.write_text("7", encoding="utf-8")
        self.control = FakeControl(self.count)
        threading.Thread(target=self.control.serve_forever, daemon=True).start()
        self.env = dict(os.environ, PATH="%s%s%s" % (bin_dir, os.pathsep, os.environ["PATH"]),
                        FAKE_ADB_LOG=str(self.log), FAKE_COUNT=str(self.count), CHECK_BOOT_ROOT_WAIT="5",
                        CHECK_BOOT_SETTLE="0", CHECK_BOOT_QUIET="0", CHECK_BOOT_WAIT="2",
                        CHECK_BOOT_WAKE_WAIT="2")
        self.env.pop("GITHUB_ACTIONS", None)

    def tearDown(self):
        self.control.shutdown()
        self.control.server_close()
        self.tmp.cleanup()

    def run_script(self, **env):
        result = subprocess.run(["bash", str(SCRIPT), str(self.control.server_address[1]), "2001"],
                                capture_output=True, text=True, env=dict(self.env, **env), timeout=60,
                                restore_signals=False)
        calls = self.log.read_text(encoding="utf-8").splitlines() if self.log.exists() else []
        return result, calls

    def test_a_new_register_after_boot_completed_passes(self):
        result, calls = self.run_script(FAKE_RECEIVER="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("registrou de novo", result.stdout)
        self.assertIn("processador acordado", result.stdout)
        # Como root, o app para à força (e é conferido) antes do BOOT_COMPLETED; o wake lock é conferido antes
        # (solto) e depois (preso).
        self.assertEqual(calls[0], "root")
        self.assertLess(calls.index(FORCE_STOP), calls.index(PIDOF))
        self.assertLess(calls.index(PIDOF), calls.index(BROADCAST))
        self.assertLess(calls.index(DUMPSYS), calls.index(BROADCAST))
        self.assertGreater(len(calls) - 1 - calls[::-1].index(DUMPSYS), calls.index(BROADCAST))

    def test_a_failed_force_stop_fails(self):
        result, calls = self.run_script(FAKE_RECEIVER="1", FAKE_STOP_FAILS="1")
        self.assertEqual(result.returncode, 1)
        self.assertIn("am force-stop", result.stderr)
        self.assertNotIn(BROADCAST, calls)

    def test_an_app_still_running_after_force_stop_fails(self):
        result, calls = self.run_script(FAKE_RECEIVER="1", FAKE_PIDOF="4321")
        self.assertEqual(result.returncode, 1)
        self.assertIn("continua rodando", result.stderr)
        self.assertNotIn(BROADCAST, calls)

    def test_no_wake_lock_after_boot_completed_fails(self):
        # O app registra, mas não segura o processador (spec 7.2, item 6).
        result, calls = self.run_script(FAKE_RECEIVER="1", FAKE_WAKE="0")
        self.assertEqual(result.returncode, 1)
        self.assertIn("starsonic:conexao", result.stderr)
        self.assertIn(BROADCAST, calls)

    def test_a_wake_lock_held_before_boot_completed_fails(self):
        # Preso antes do broadcast: a conferência do wake lock não provaria nada.
        result, calls = self.run_script(FAKE_RECEIVER="1", FAKE_STALE_WAKE="1")
        self.assertEqual(result.returncode, 1)
        self.assertIn("antes do BOOT_COMPLETED", result.stderr)
        self.assertNotIn(BROADCAST, calls)

    def test_no_register_after_boot_completed_fails(self):
        # Sem o receptor no app: o broadcast não registra nada.
        result, calls = self.run_script(FAKE_RECEIVER="0")
        self.assertEqual(result.returncode, 1)
        self.assertIn("não registrou em 2 s depois do BOOT_COMPLETED", result.stderr)
        self.assertIn(BROADCAST, calls)

    def test_a_register_without_boot_completed_fails(self):
        # Algo registra o ramal sem o broadcast: a conferência não provaria nada.
        self.control.rising = True
        result, calls = self.run_script(FAKE_RECEIVER="1")
        self.assertEqual(result.returncode, 1)
        self.assertIn("registrou sem o BOOT_COMPLETED", result.stderr)
        self.assertNotIn(BROADCAST, calls)

    def test_waits_for_adbd_to_come_back_as_root(self):
        result, calls = self.run_script(FAKE_RECEIVER="1", FAKE_ROOT_AFTER="3")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls.count("shell id -u"), 3)

    def test_adbd_that_never_comes_back_as_root_fails(self):
        result, calls = self.run_script(FAKE_RECEIVER="1", FAKE_ROOT_AFTER="0", CHECK_BOOT_ROOT_WAIT="2")
        self.assertEqual(result.returncode, 1)
        self.assertIn("não voltou como root", result.stderr)
        self.assertNotIn(BROADCAST, calls)

    def test_a_bad_registrar_reply_fails(self):
        self.control.reply = "ERR no-such-thing"
        result, calls = self.run_script(FAKE_RECEIVER="1")
        self.assertEqual(result.returncode, 1)
        self.assertIn("ERR no-such-thing", result.stderr)
        self.assertNotIn(BROADCAST, calls)

    def test_failures_become_annotations_in_github_actions(self):
        result, _calls = self.run_script(FAKE_RECEIVER="0", GITHUB_ACTIONS="true")
        self.assertEqual(result.returncode, 1)
        annotations = [line for line in result.stdout.splitlines() if line.startswith("::error ")]
        self.assertEqual(len(annotations), 1, result.stdout)
        self.assertTrue(annotations[0].startswith("::error title=BOOT_COMPLETED::o ramal 2001 não registrou"))


if __name__ == "__main__":
    unittest.main()
