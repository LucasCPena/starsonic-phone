"""build/android/run-update-test.sh com um run-emulator-tests.sh falso: o canal de teste que o servidor HTTP serve
(versao-android.json da versão 9.9.9 e um APK cujo SHA-256 não confere), o que vai para a classe UpdatePromptTest e o
servidor que sai no fim, passe ou falhe a classe.
"""
import hashlib
import json
import os
import pathlib
import socket
import subprocess
import tempfile
import textwrap
import unittest
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "build" / "android" / "run-update-test.sh"

# O run-emulator-tests.sh falso: guarda os argumentos (um por linha) e o que o servidor serve agora (o
# versao-android.json e o APK, pelo endereço que o emulador usaria, trocando 10.0.2.2 por 127.0.0.1), e sai com
# FAKE_STATUS.
FAKE_RUNNER = textwrap.dedent("""\
    #!/usr/bin/env bash
    printf '%s\\n' "$@" > "$FAKE_DIR/args.txt"
    python3 -I - "$FAKE_DIR" "$UPDATE_CHANNEL_PORT" <<'EOF'
    import json
    import pathlib
    import sys
    import urllib.request

    out, port = pathlib.Path(sys.argv[1]), sys.argv[2]
    base = "http://127.0.0.1:%s/" % port
    channel = urllib.request.urlopen(base + "versao-android.json", timeout=5).read()
    (out / "versao-android.json").write_bytes(channel)
    apk = json.loads(channel.decode("utf-8"))["instalador"].replace("10.0.2.2", "127.0.0.1")
    (out / "apk").write_bytes(urllib.request.urlopen(apk, timeout=5).read())
    EOF
    exit "${FAKE_STATUS:-0}"
    """)


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


class RunUpdateTestTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self.tmp.name)
        self.runner = self.dir / "run-emulator-tests.sh"
        self.runner.write_text(FAKE_RUNNER, encoding="utf-8")
        self.runner.chmod(0o755)
        self.port = free_port()
        self.env = dict(os.environ, RUN_EMULATOR_TESTS=str(self.runner), UPDATE_CHANNEL_PORT=str(self.port),
                        FAKE_DIR=str(self.dir))
        self.env.pop("GITHUB_ACTIONS", None)

    def tearDown(self):
        self.tmp.cleanup()

    def run_script(self, *args, status=0):
        env = dict(self.env, FAKE_STATUS=str(status))
        return subprocess.run(["bash", str(SCRIPT), *args], env=env, capture_output=True, text=True, timeout=60)

    def server_is_down(self):
        try:
            urllib.request.urlopen("http://127.0.0.1:%d/versao-android.json" % self.port, timeout=2)
        except (urllib.error.URLError, ConnectionError, OSError):
            return True
        return False

    def test_serves_the_test_channel_and_passes_it_to_the_class(self):
        result = self.run_script("app.apk", "teste.apk", "-e", "registrar", "10.0.2.2", "-e", "senha", "a b")
        self.assertEqual(result.returncode, 0, result.stderr)
        base = "http://10.0.2.2:%d/" % self.port
        args = (self.dir / "args.txt").read_text(encoding="utf-8").splitlines()
        self.assertEqual(args, ["app.apk", "teste.apk", "br.com.starsonic.phone.UpdatePromptTest",
                                "-e", "canal", base + "versao-android.json", "-e", "prefixo", base,
                                "-e", "registrar", "10.0.2.2", "-e", "senha", "a b"])
        channel = json.loads((self.dir / "versao-android.json").read_text(encoding="utf-8"))
        self.assertEqual(channel["versao"], "9.9.9")
        self.assertEqual(channel["instalador"], base + "StarsonicPhone-android-9.9.9.apk")
        self.assertEqual(channel["notas"], "Versão de teste do atualizador.")
        apk = (self.dir / "apk").read_bytes()
        self.assertGreater(len(apk), 0)
        # Um SHA-256 bem formado, mas que não é o do APK servido.
        self.assertRegex(channel["sha256"], "^[0-9a-f]{64}$")
        self.assertNotEqual(channel["sha256"], hashlib.sha256(apk).hexdigest())
        self.assertTrue(self.server_is_down(), "o servidor continua de pé")

    def test_a_failing_class_fails_and_the_server_still_goes_down(self):
        result = self.run_script("app.apk", "teste.apk", status=1)
        self.assertEqual(result.returncode, 1)
        self.assertTrue((self.dir / "apk").exists())
        self.assertTrue(self.server_is_down(), "o servidor continua de pé")

    def test_a_busy_port_fails_before_the_class(self):
        with socket.socket() as busy:
            busy.bind(("127.0.0.1", self.port))
            busy.listen(1)
            result = self.run_script("app.apk", "teste.apk")
        self.assertEqual(result.returncode, 1)
        self.assertIn("servidor", result.stderr)
        self.assertFalse((self.dir / "args.txt").exists(), "a classe rodou sem o canal")

    def test_usage(self):
        result = self.run_script("app.apk")
        self.assertEqual(result.returncode, 2)
        self.assertIn("uso:", result.stderr)


if __name__ == "__main__":
    unittest.main()
