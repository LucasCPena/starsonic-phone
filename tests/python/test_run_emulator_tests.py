"""build/android/run-emulator-tests.sh com um adb falso: o que ele manda ao aparelho e como lê o resultado.

O `am instrument` sai com 0 mesmo quando um teste falha; o script decide pelo resumo do JUnit.
"""
import os
import pathlib
import subprocess
import tempfile
import textwrap
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "build" / "android" / "run-emulator-tests.sh"
CLASS = "br.com.starsonic.phone.NativeLoadTest"
RUNNER = "br.com.starsonic.phone.test/androidx.test.runner.AndroidJUnitRunner"

# Cada chamada vai para FAKE_ADB_LOG (uma linha); "am instrument" responde com FAKE_INSTRUMENT_OUTPUT.
FAKE_ADB = textwrap.dedent("""\
    #!/usr/bin/env bash
    printf '%s\\n' "$*" >> "$FAKE_ADB_LOG"
    if [ "$1" = install ] && [ "${!#}" = "${FAKE_INSTALL_FAILS:-}" ]; then
        echo "Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]"; exit 1
    fi
    if [ "$1" = shell ]; then
        shift
        command="$*"
        case "$command" in
            "pm grant "*)
                permission="${command##* }"
                if [[ " ${FAKE_NOT_REQUESTED:-} " == *" $permission "* ]]; then
                    echo "Exception occurred while executing 'grant':" >&2
                    echo "java.lang.SecurityException: Package br.com.starsonic.phone has not requested permission $permission" >&2
                    exit 255
                fi
                if [ "$permission" = "${FAKE_GRANT_ERROR:-}" ]; then
                    echo "java.lang.IllegalArgumentException: Unknown package: br.com.starsonic.phone" >&2
                    exit 255
                fi;;
            "am instrument"*) cat "$FAKE_INSTRUMENT_OUTPUT";;
        esac
    fi
    if [ "$1" = logcat ] && [ "$2" = -d ]; then
        echo "E/AndroidRuntime( 4242): FATAL EXCEPTION: main"
    fi
    exit 0
    """)

PASSED = "br.com.starsonic.phone.NativeLoadTest:.....\n\nTime: 0.031\n\nOK (5 tests)\n\n\n"
FAILED = textwrap.dedent("""\
    br.com.starsonic.phone.NativeLoadTest:..E...
    Time: 0.04
    There was 1 failure:
    1) registrationMessageComesFromTheCore(br.com.starsonic.phone.NativeLoadTest)
    org.junit.ComparisonFailure: expected:<Ramal ou senha incorretos[.]> but was:<Ramal ou senha incorretos[]>
    \tat org.junit.Assert.assertEquals(Assert.java:117)

    FAILURES!!!
    Tests run: 5,  Failures: 1


    """)
CRASHED = "INSTRUMENTATION_RESULT: shortMsg=Process crashed.\nINSTRUMENTATION_CODE: 0\n"
NO_TESTS = "\nTime: 0.001\n\nOK (0 tests)\n\n\n"


class RunEmulatorTestsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self.tmp.name)
        bin_dir = self.dir / "bin"
        bin_dir.mkdir()
        adb = bin_dir / "adb"
        adb.write_text(FAKE_ADB, encoding="utf-8")
        adb.chmod(0o755)
        self.log = self.dir / "adb.log"
        self.output = self.dir / "instrument.txt"
        self.env = dict(os.environ, PATH="%s%s%s" % (bin_dir, os.pathsep, os.environ["PATH"]),
                        FAKE_ADB_LOG=str(self.log), FAKE_INSTRUMENT_OUTPUT=str(self.output))
        self.env.pop("GITHUB_ACTIONS", None)

    def tearDown(self):
        self.tmp.cleanup()

    def run_script(self, output, *extra, **env):
        self.output.write_text(output, encoding="utf-8")
        # Como no GitHub Actions (o runner é Node): o script roda com o SIGPIPE ignorado, e quem escreve
        # num pipe já fechado recebe EPIPE em vez de morrer calado.
        result = subprocess.run(["bash", str(SCRIPT), "app.apk", "testes.apk", CLASS, *extra],
                                capture_output=True, text=True, env=dict(self.env, **env), timeout=60,
                                restore_signals=False)
        calls = self.log.read_text(encoding="utf-8").splitlines() if self.log.exists() else []
        return result, calls

    def instrument_calls(self, calls):
        return [call for call in calls if call.startswith("shell am instrument")]

    def test_usage_without_the_three_arguments(self):
        result = subprocess.run(["bash", str(SCRIPT), "app.apk", "testes.apk"], capture_output=True, text=True,
                                env=self.env, timeout=60)
        self.assertEqual(result.returncode, 2)
        self.assertIn("uso:", result.stderr)

    def test_passing_tests_install_grant_and_run_the_class(self):
        result, calls = self.run_script(PASSED)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([call for call in calls if call.startswith("install")],
                         ["install -r -t app.apk", "install -r -t testes.apk"])
        for expected in ("shell pm grant br.com.starsonic.phone android.permission.RECORD_AUDIO",
                         "shell pm grant br.com.starsonic.phone android.permission.POST_NOTIFICATIONS",
                         "shell appops set br.com.starsonic.phone USE_FULL_SCREEN_INTENT allow",
                         "shell dumpsys deviceidle whitelist +br.com.starsonic.phone"):
            self.assertIn(expected, calls)
        self.assertEqual(self.instrument_calls(calls), ["shell am instrument -w -e class '%s' %s" % (CLASS, RUNNER)])
        # Tudo é concedido antes de os testes rodarem.
        self.assertGreater(calls.index(self.instrument_calls(calls)[0]),
                           calls.index("shell dumpsys deviceidle whitelist +br.com.starsonic.phone"))

    def test_extra_arguments_reach_am_instrument_quoted_for_the_device_shell(self):
        result, calls = self.run_script(PASSED, "-e", "registrar", "10.0.2.2", "-e", "senha", "it's #1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.instrument_calls(calls), [
            "shell am instrument -w -e class '%s' '-e' 'registrar' '10.0.2.2' '-e' 'senha' 'it'\\''s #1' %s"
            % (CLASS, RUNNER)])

    def test_a_failing_test_fails_the_script(self):
        result, _calls = self.run_script(FAILED)
        self.assertEqual(result.returncode, 1)

    def test_a_crash_fails_the_script(self):
        result, _calls = self.run_script(CRASHED)
        self.assertEqual(result.returncode, 1)

    def test_no_test_run_fails_the_script(self):
        result, _calls = self.run_script(NO_TESTS)
        self.assertEqual(result.returncode, 1)

    def test_permissions_the_app_does_not_request_are_skipped(self):
        result, calls = self.run_script(
            PASSED, FAKE_NOT_REQUESTED="android.permission.RECORD_AUDIO android.permission.POST_NOTIFICATIONS")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("o app não pede android.permission.RECORD_AUDIO", result.stdout)
        self.assertIn("o app não pede android.permission.POST_NOTIFICATIONS", result.stdout)
        self.assertEqual(len(self.instrument_calls(calls)), 1)

    def test_another_grant_error_stops_before_the_tests(self):
        result, calls = self.run_script(PASSED, FAKE_GRANT_ERROR="android.permission.RECORD_AUDIO")
        self.assertEqual(result.returncode, 1)
        self.assertIn("Unknown package", result.stderr)
        self.assertEqual(self.instrument_calls(calls), [])

    def test_an_install_failure_stops_before_the_tests(self):
        for apk in ("app.apk", "testes.apk"):
            with self.subTest(apk=apk):
                self.log.unlink(missing_ok=True)
                result, calls = self.run_script(PASSED, FAKE_INSTALL_FAILS=apk)
                self.assertEqual(result.returncode, 1)
                self.assertIn("não instalou %s" % apk, result.stderr)
                # O motivo do adb vai junto (o log do Actions nem sempre chega a quem acompanha o run).
                self.assertIn("INSTALL_FAILED_INSUFFICIENT_STORAGE", result.stderr)
                self.assertEqual(self.instrument_calls(calls), [])

    def test_a_long_failure_report_is_annotated_too(self):
        # Mais de 64 KB de falhas (o tamanho do pipe): o relatório é cortado sem quebrar o script.
        trace = "".join("\tat br.com.starsonic.phone.Frame%d(NativeLoadTest.kt:%d)\n" % (i, i) for i in range(3000))
        result, _calls = self.run_script(FAILED.replace("\tat org.junit", trace + "\tat org.junit"),
                                         GITHUB_ACTIONS="true")
        self.assertEqual(result.returncode, 1, result.stderr)
        annotations = [line for line in result.stdout.splitlines() if line.startswith("::error ")]
        self.assertEqual(len(annotations), 2, result.stderr)
        self.assertLessEqual(annotations[0].count("%0A"), 60)

    def test_failures_and_crashes_become_annotations_in_github_actions(self):
        result, _calls = self.run_script(FAILED, GITHUB_ACTIONS="true")
        self.assertEqual(result.returncode, 1)
        annotations = [line for line in result.stdout.splitlines() if line.startswith("::error ")]
        self.assertEqual(len(annotations), 2, result.stdout)
        self.assertTrue(annotations[0].startswith(
            "::error title=Testes no emulador: %s::There was 1 failure:%%0A1) registrationMessage" % CLASS))
        self.assertIn("FAILURES!!!", annotations[0])
        self.assertIn("FATAL EXCEPTION", annotations[1])


if __name__ == "__main__":
    unittest.main()
