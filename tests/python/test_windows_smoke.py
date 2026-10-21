"""As partes do tests/smoke/windows_smoke.py que não dependem do Windows: os argumentos do WebView2, a conta dos
pixels lógicos, a leitura do registro de ligações e a porta de controle do registrador falso de verdade."""
import pathlib
import socket
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests" / "smoke"))

import windows_smoke  # noqa: E402


def free_port(kind=socket.SOCK_STREAM):
    with socket.socket(socket.AF_INET, kind) as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


class BrowserArgumentsTest(unittest.TestCase):
    def test_debug_port_and_the_app_argument_always_go(self):
        self.assertEqual(windows_smoke.browser_arguments(),
                         "--remote-debugging-port=9333 --autoplay-policy=no-user-gesture-required")

    def test_the_150_percent_run_forces_the_scale(self):
        self.assertTrue(windows_smoke.browser_arguments(scale=True).endswith(" --force-device-scale-factor=1.5"))
        self.assertIn("--remote-debugging-port=9333", windows_smoke.browser_arguments(scale=True))


class LogicalSizeTest(unittest.TestCase):
    def test_physical_pixels_become_logical_by_the_window_dpi(self):
        self.assertEqual(windows_smoke.logical_size(400, 720, 96), (400, 720))
        self.assertEqual(windows_smoke.logical_size(600, 1080, 144), (400, 720))
        self.assertEqual(windows_smoke.logical_size(500, 900, 120), (400, 720))
        with self.assertRaises(ValueError):
            windows_smoke.logical_size(400, 720, 0)

    def test_near_allows_one_pixel(self):
        self.assertTrue(windows_smoke.near((401, 719), (400, 720)))
        self.assertFalse(windows_smoke.near((402, 720), (400, 720)))


class EventsTest(unittest.TestCase):
    EVENTS = ["inv-in 2002 200", "bye-in 2002", "inv-out 2001 200", "bye-in 3001"]

    def test_has_event_matches_whole_words(self):
        self.assertTrue(windows_smoke.has_event(self.EVENTS, "inv-in 2002 200"))
        self.assertTrue(windows_smoke.has_event(self.EVENTS, "inv-out 2001"))
        self.assertFalse(windows_smoke.has_event(self.EVENTS, "inv-in 200"))
        self.assertEqual(windows_smoke.count_events(self.EVENTS, "bye-in"), 2)
        self.assertEqual(windows_smoke.count_events(self.EVENTS, "bye"), 0)


class RegistrarControlTest(unittest.TestCase):
    """O Registrar do teste fala com o fake_registrar.py de verdade (portas livres, sem a 5060)."""

    def test_commands_and_the_call_log(self):
        registrar = windows_smoke.Registrar(free_port(), port=free_port(socket.SOCK_DGRAM))
        try:
            self.assertEqual(registrar.command("REGISTERS 2001"), ["0"])
            self.assertEqual(registrar.events(), [])
            self.assertEqual(registrar.command("RING 2001"), ["ERR no-contact"])
        finally:
            registrar.stop()
        self.assertIsNotNone(registrar.process.poll())


if __name__ == "__main__":
    unittest.main()
