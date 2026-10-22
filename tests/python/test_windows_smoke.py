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



class WorkAreaTest(unittest.TestCase):
    def test_the_short_work_area_keeps_the_top_and_cuts_the_height(self):
        self.assertEqual(windows_smoke.short_work_area((0, 0, 1024, 728), 640, 96), (0, 0, 1024, 640))
        self.assertEqual(windows_smoke.short_work_area((0, 40, 1920, 1080), 640, 144), (0, 40, 1920, 1000))
        # Uma área que já é mais baixa fica como está.
        self.assertEqual(windows_smoke.short_work_area((0, 0, 800, 560), 640, 96), (0, 0, 800, 560))

    def test_inside_means_the_whole_window(self):
        self.assertTrue(windows_smoke.inside((312, 0, 400, 640), (0, 0, 1024, 640)))
        self.assertFalse(windows_smoke.inside((312, 4, 400, 720), (0, 0, 1024, 640)))
        self.assertFalse(windows_smoke.inside((-1, 0, 400, 600), (0, 0, 1024, 640)))


class KeypadLayoutTest(unittest.TestCase):
    def layout(self, **changes):
        keys = [[20 + 120 * (i % 3), 300 + 50 * (i // 3), 113, 40] for i in range(12)]
        layout = {"viewport": [400, 640], "keys": keys, "middle": [20, 300, 360, 190], "middleScrolls": False,
                  "call": [88, 500, 292, 56], "redial": [20, 500, 56, 56], "nav": [0, 565, 400, 75]}
        layout.update(changes)
        return layout

    def test_a_keypad_that_fits_passes(self):
        windows_smoke.check_keypad_layout(self.layout(), "teste")

    def test_overlap_scroll_or_cut_fails(self):
        for changes in ({"call": [88, 470, 292, 56]}, {"middleScrolls": True}, {"nav": [0, 600, 400, 75]},
                        {"call": [88, 530, 292, 56]}, {"redial": [20, 530, 56, 56]}, {"redial": [60, 500, 56, 56]},
                        {"redial": None}):
            with self.assertRaises(windows_smoke.SmokeFailure, msg=changes):
                windows_smoke.check_keypad_layout(self.layout(**changes), "teste")


class ResizeTest(unittest.TestCase):
    def test_the_border_points_and_the_hit_codes_they_expect(self):
        # A janela (x, y, largura, altura) com as bordas invisiveis de 8 px dos lados e embaixo, a area cliente na tela.
        points = windows_smoke.border_points((92, 100, 416, 728), (100, 100, 400, 720))
        self.assertEqual(points["canto de baixo a direita"], ((92 + 416 - 3, 100 + 728 - 3), 17))   # HTBOTTOMRIGHT
        self.assertEqual(points["canto de baixo a esquerda"], ((92 + 2, 100 + 728 - 3), 16))         # HTBOTTOMLEFT
        self.assertEqual(points["esquerda"], ((92 + 2, 100 + 364), 10))                               # HTLEFT
        self.assertEqual(points["direita"], ((92 + 416 - 3, 100 + 364), 11))                          # HTRIGHT
        self.assertEqual(points["baixo"], ((92 + 208, 100 + 728 - 3), 15))                            # HTBOTTOM
        # A borda de cima fica dentro da area cliente (o WebView2): ela e conferida com um arrasto de verdade.
        self.assertNotIn("cima", points)
        self.assertEqual(set(windows_smoke.HIT_NAMES.values()) >= {"HTBOTTOMRIGHT", "HTCLIENT", "HTCAPTION"}, True)

    def test_the_drag_points_are_on_the_interface_zones(self):
        # A faixa de cima (5 px no alto da area cliente, no meio) e o canto de baixo a direita (16x16), na tela.
        points = windows_smoke.zone_points((100, 50, 400, 720))
        self.assertEqual(points["cima"], (300, 52))
        self.assertEqual(points["baixo-direita"], (100 + 400 - 6, 50 + 720 - 6))

    def test_absolute_mouse_coordinates_cover_the_screen(self):
        self.assertEqual(windows_smoke.absolute_mouse(0, 0, (1024, 768)), (0, 0))
        self.assertEqual(windows_smoke.absolute_mouse(1023, 767, (1024, 768)), (65535, 65535))
        self.assertEqual(windows_smoke.absolute_mouse(512, 384, (1024, 768)), (32800, 32810))

    def test_the_window_size_for_a_client_size_adds_the_frame(self):
        # A borda e a diferenca entre a janela e a area cliente (fisicos); o tamanho pedido e logico.
        self.assertEqual(windows_smoke.window_size_for((340, 560), 96, (16, 8)), (356, 568))
        self.assertEqual(windows_smoke.window_size_for((300, 440), 144, (22, 11)), (472, 671))


class TestProfileTest(unittest.TestCase):
    def test_the_test_profile_points_to_the_fake_registrar_by_udp(self):
        lines = windows_smoke.TEST_PROFILE.split("\r\n")
        for line in ("[geral]", "stun=", "[conta]", "porta=5060", "transporte=udp", "srtp=desativado"):
            self.assertIn(line, lines)


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


class RecoveryHelpersTest(unittest.TestCase):
    def test_count_lines_counts_the_lines_with_the_text(self):
        text = "2026-10-22 interface pronta\n2026-10-22 navegador reiniciado\n2026-10-22 interface pronta\n"
        self.assertEqual(windows_smoke.count_lines(text, "interface pronta"), 2)
        self.assertEqual(windows_smoke.count_lines(text, "fechamento forcado"), 0)
        self.assertEqual(windows_smoke.count_lines("", "interface pronta"), 0)

    def test_the_page_carries_the_version(self):
        self.assertTrue(windows_smoke.has_version_query("https://app.starsonic.local/index.html?v=0.1.0-rc.1"))
        self.assertTrue(windows_smoke.has_version_query("https://app.starsonic.local/aviso.html?x=1&v=0.0.0#a"))
        self.assertFalse(windows_smoke.has_version_query("https://app.starsonic.local/index.html"))
        self.assertFalse(windows_smoke.has_version_query("https://app.starsonic.local/index.html?v="))
        self.assertFalse(windows_smoke.has_version_query("https://app.starsonic.local/index.html?fake=principal"))

    def test_the_browser_process_is_the_child_of_the_app_without_a_type(self):
        rows = [
            (300, 200, '"msedgewebview2.exe" --type=renderer --user-data-dir="C:\\x\\Starsonic Phone\\WebView2"'),
            (200, 100, '"msedgewebview2.exe" --embedded-browser-webview=1 --user-data-dir="C:\\x\\Starsonic Phone\\WebView2"'),
            (400, 200, '"msedgewebview2.exe" --type=gpu-process'),
        ]
        self.assertEqual(windows_smoke.browser_process(rows, 100), 200)
        self.assertIsNone(windows_smoke.browser_process(rows, 999))
        self.assertIsNone(windows_smoke.browser_process([], 100))
