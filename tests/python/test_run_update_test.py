"""build/android/run-update-test.sh com um run-emulator-tests.sh falso: o canal de teste que o servidor HTTP serve
(versao-android.json da versão 9.9.9 e um APK cujo SHA-256 não confere), as duas rodadas da classe UpdatePromptTest
(com a permissão de instalar apps, e só o teste sem ela: o Android 11+ fecha o app quando ela muda) e o servidor que
sai no fim, passem ou falhem as rodadas.
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
CLASS = "br.com.starsonic.phone.UpdatePromptTest"
WITHOUT_PERMISSION = CLASS + "#withoutPermissionToInstallAppsUpdateOpensTheAndroidSetting"

# O run-emulator-tests.sh falso: cada rodada vira uma linha JSON em runs.jsonl (os argumentos e o APPOPS) e baixa o
# que o servidor serve agora (o versao-android.json e o APK, pelo endereço que o emulador usaria, trocando 10.0.2.2
# por 127.0.0.1). A rodada FAKE_FAIL_RUN (1 ou 2) sai com 1.
FAKE_RUNNER = textwrap.dedent("""\
    #!/usr/bin/env bash
    python3 -I - "$FAKE_DIR" "$UPDATE_CHANNEL_PORT" "${APPOPS:-}" "$@" <<'EOF'
    import json
    import pathlib
    import sys
    import urllib.request

    out, port, appops, args = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4:]
    with open(out / "runs.jsonl", "a", encoding="utf-8") as runs:
        runs.write(json.dumps({"args": args, "appops": appops}) + "\\n")
    base = "http://127.0.0.1:%s/" % port
    channel = urllib.request.urlopen(base + "versao-android.json", timeout=5).read()
    (out / "versao-android.json").write_bytes(channel)
    apk = json.loads(channel.decode("utf-8"))["instalador"].replace("10.0.2.2", "127.0.0.1")
    (out / "apk").write_bytes(urllib.request.urlopen(apk, timeout=5).read())
    EOF
    runs=$(wc -l < "$FAKE_DIR/runs.jsonl")
    if [ "$runs" = "${FAKE_FAIL_RUN:-0}" ]; then exit 1; fi
    exit 0
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
        for name in ("GITHUB_ACTIONS", "APPOPS", "FAKE_FAIL_RUN"):
            self.env.pop(name, None)

    def tearDown(self):
        self.tmp.cleanup()

    def run_script(self, *args, **env):
        return subprocess.run(["bash", str(SCRIPT), *args], env=dict(self.env, **env), capture_output=True, text=True,
                              timeout=60)

    def runs(self):
        path = self.dir / "runs.jsonl"
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]

    def server_is_down(self):
        try:
            urllib.request.urlopen("http://127.0.0.1:%d/versao-android.json" % self.port, timeout=2)
        except (urllib.error.URLError, ConnectionError, OSError):
            return True
        return False

    def test_serves_the_test_channel_and_runs_the_class_with_and_without_the_permission(self):
        result = self.run_script("app.apk", "teste.apk", "-e", "registrar", "10.0.2.2", "-e", "senha", "a b")
        self.assertEqual(result.returncode, 0, result.stderr)
        base = "http://10.0.2.2:%d/" % self.port
        channel_args = ["-e", "canal", base + "versao-android.json", "-e", "prefixo", base]
        extra = ["-e", "registrar", "10.0.2.2", "-e", "senha", "a b"]
        self.assertEqual(self.runs(), [
            {"args": ["app.apk", "teste.apk", CLASS, "-e", "notClass", WITHOUT_PERMISSION] + channel_args + extra,
             "appops": "REQUEST_INSTALL_PACKAGES:allow"},
            {"args": ["app.apk", "teste.apk", WITHOUT_PERMISSION] + channel_args + extra,
             "appops": "REQUEST_INSTALL_PACKAGES:deny"},
        ])
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

    def test_a_failing_run_fails_the_script_after_both_runs_and_the_server_goes_down(self):
        for failing in ("1", "2"):
            with self.subTest(failing=failing):
                (self.dir / "runs.jsonl").unlink(missing_ok=True)
                result = self.run_script("app.apk", "teste.apk", FAKE_FAIL_RUN=failing)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(len(self.runs()), 2)
                self.assertTrue(self.server_is_down(), "o servidor continua de pé")

    def test_a_busy_port_fails_before_the_class(self):
        with socket.socket() as busy:
            busy.bind(("127.0.0.1", self.port))
            busy.listen(1)
            result = self.run_script("app.apk", "teste.apk")
        self.assertEqual(result.returncode, 1)
        self.assertIn("servidor", result.stderr)
        self.assertEqual(self.runs(), [], "a classe rodou sem o canal")

    def test_usage(self):
        result = self.run_script("app.apk")
        self.assertEqual(result.returncode, 2)
        self.assertIn("uso:", result.stderr)


if __name__ == "__main__":
    unittest.main()
