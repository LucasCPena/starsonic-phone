"""Testes do item 13 da fumaça do Windows (reuniao_fumaca.py): os argumentos de cada abertura, as linhas do
diagnostico.log, o portão (problems_of) e o ensaio do lado do navegador, num Chromium do Playwright no lugar do
WebView2. O ensaio pede o STARSONIC_CHAT_BIN; o navegador dele abre sem as variáveis de proxy e só conhece o nome do
chat, que leva à frente TLS no 127.0.0.1 (nenhum outro nome existe). Rodar da raiz do repositório:
STARSONIC_CHAT_BIN=$PWD/work/starsonic-chat python3 -m unittest -v tests/smoke/test_reuniao_fumaca.py"""
import os
import pathlib
import re
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import reuniao_fumaca  # noqa: E402
import reuniao_local  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]


class ArgumentsTest(unittest.TestCase):
    def test_each_opening_has_its_arguments(self):
        base = "--remote-debugging-port=9333 --autoplay-policy=no-user-gesture-required"
        fake = base + " --use-fake-device-for-media-stream"
        self.assertEqual(reuniao_fumaca.meeting_arguments(base), fake)
        self.assertEqual(reuniao_fumaca.meeting_arguments(base, "pedaco"), fake + " --auto-select-desktop-capture-source=Entire")
        # So a tentativa que capturou na prova no WebView2 de verdade ficou; as outras saíram.
        for gone in ("inteiro", "falsa"):
            with self.assertRaises(KeyError):
                reuniao_fumaca.meeting_arguments(base, gone)
        self.assertEqual(reuniao_fumaca.meeting_arguments(base, "pedaco", lna=True),
                         fake + " --auto-select-desktop-capture-source=Entire"
                         " --enable-features=LocalNetworkAccessChecks,msWebViewAllowLocalNetworkAccessChecks")


LINES = ["navegacao do quadro permitida: https://chat.starcloud-starsonic.com.br",
         "permissao permitida (quadro): 2 https://chat.starcloud-starsonic.com.br",
         "permissao negada: 2 https://app.starsonic.local",
         "navegacao bloqueada: https://chat.starcloud-starsonic.com.br",
         "captura de tela cancelada", "captura de tela permitida (quadro)",
         # As do quadro que deixa a reunião (o "saiu" com o navegou).
         "permissao negada (quadro): 2 https://chat.starcloud-starsonic.com.br",
         "captura de tela cancelada (quadro)"]
# Como o problems_of chama cada uma (as das permissões do quadro são procuradas pelo começo).
NEEDED = [LINES[0], "permissao permitida (quadro): 2 ", LINES[2], LINES[3], LINES[4], LINES[5],
          "permissao negada (quadro): 2 ", LINES[7]]


def left_meeting():
    """O record de um quadro que deixou a reunião: ele navegou, não ganhou a câmera nem a tela, e as duas linhas de
    recusa dele estão no diagnóstico das recusas."""
    record = complete()
    refused = {"erro": "NotAllowedError: Permission denied"}
    record["recusas"]["saiu"] = {"navegou": True, "camera": dict(refused), "tela": dict(refused)}
    record["recusas"]["diagnostico"] = list(LINES[2:])
    return record


def complete():
    """O record de uma prova que passa: o da rodada que passou no WebView2 de verdade (o quadro que deixa a reunião
    não navegou: o bloqueio valeu, e nenhuma linha de recusa do quadro foi preciso)."""
    return {"endereco": "privado", "webview2": "Edg/154.0.0.0",
            "principal": {"argumentos": "", "mensagens": ["pronta", "estado:entrada"], "microfone": True, "quadro": True,
                          "entrada": {"nome": "Ana Souza", "largura": 1280, "imagem": "ligada", "semAcesso": False,
                                      "entrar": True},
                          "midia": {"faixas": ["audio:live", "video:live"]},
                          "alto_falante": {"saidas": 3, "ok": True, "trocou": True},
                          "console": [], "csp": [], "diagnostico": list(LINES[:2]) + [LINES[5]]},
            "tela": {"tentativas": [{"captura": "pedaco", "resultado": {"faixa": "live", "superficie": "monitor"},
                                     "diagnostico": []}], "ok": "pedaco"},
            "lna": {"argumentos": "", "quadro": True, "mensagens": ["pronta"], "console": [], "diagnostico": []},
            "recusas": {"argumentos": "",
                        "do_app": {"camera": {"erro": "NotAllowedError: Permission denied"},
                                   "tela": {"erro": "NotAllowedError: Permission denied"}},
                        "recusados": {"administracao": False, "consulta": False, "de_fora": False},
                        "saiu": {"navegou": False, "camera": None, "tela": None},
                        "csp": [], "diagnostico": list(LINES[2:5])},
            "vazou": [],
            "desfeito": {"hosts": True, "certificado": True}}


class LogTest(unittest.TestCase):
    def test_only_the_lines_of_the_frame_rules_are_kept_without_the_time(self):
        log = "\r\n".join(["2026-11-24 10:00:00.001 interface pronta",
                           "2026-11-24 10:00:01.002 permissao negada: 2 https://app.starsonic.local",
                           "2026-11-24 10:00:02.003 captura de tela cancelada",
                           "2026-11-24 10:00:03.004 navegacao bloqueada: file:",
                           "2026-11-24 10:00:04.005 o quadro nao carregou (erro 7)",
                           "2026-11-24 10:00:05.006 chat: chatKey",
                           "2026-11-24 10:00:06.007 quadro fora da regra: https://chat.starcloud-starsonic.com.br", ""])
        self.assertEqual(reuniao_fumaca.log_lines(log),
                         ["permissao negada: 2 https://app.starsonic.local", "captura de tela cancelada",
                          "navegacao bloqueada: file:", "o quadro nao carregou (erro 7)",
                          "quadro fora da regra: https://chat.starcloud-starsonic.com.br"])

    def test_a_secret_in_the_log_is_found(self):
        log = "2026-11-24 10:00:00.001 navegacao bloqueada: https://exemplo.com.br/r/k7q49xwpht"
        self.assertEqual(reuniao_fumaca.leaks(log, ["k7q49xwpht", "Ana Souza", ""]), ["k7q49xwpht"])
        self.assertEqual(reuniao_fumaca.leaks("", ["k7q49xwpht"]), [])

    def test_a_secret_is_replaced_by_its_label_at_any_depth(self):
        self.assertEqual(
            reuniao_fumaca.scrub({"console": ["GET https://x/r/k7q49xwpht 404"], "erro": "passe abc123", "n": 3},
                                 {"codigo": "k7q49xwpht", "passe": "abc123", "chave": ""}),
            {"console": ["GET https://x/r/<codigo> 404"], "erro": "passe <passe>", "n": 3})


class VerdictTest(unittest.TestCase):
    def test_a_complete_record_passes(self):
        self.assertEqual(reuniao_fumaca.problems_of(complete()), [])

    def test_each_missing_fact_fails_and_the_problem_names_it(self):
        def changed(path, value):
            record = complete()
            node = record
            for key in path[:-1]:
                node = node[key]
            node[path[-1]] = value
            return record

        cases = [
            (("endereco",), "loopback", "privado"),
            (("principal", "mensagens"), ["pronta"], "entrada"),
            (("principal", "quadro"), False, "quadro"),
            (("principal", "entrada", "nome"), "Outra Pessoa", "nome"),
            (("principal", "entrada", "largura"), 0, "imagem"),
            (("principal", "entrada", "semAcesso"), True, "acesso"),
            (("principal", "entrada", "entrar"), False, "Entrar"),
            (("principal", "midia"), {"faixas": ["audio:live"]}, "camera"),
            (("principal", "midia"), {"erro": "NotAllowedError: Permission denied"}, "camera"),
            (("principal", "alto_falante"), {"erro": "NotAllowedError: x"}, "alto-falante"),
            (("principal", "alto_falante"), {"saidas": 3, "ok": True, "trocou": False}, "alto-falante"),
            (("tela", "ok"), None, "tela"),
            (("recusas", "do_app", "camera"), {"faixas": ["video:live"]}, "pagina do app"),
            (("recusas", "do_app", "tela"), {"faixa": "live", "superficie": "monitor"}, "pagina do app"),
            (("recusas", "recusados", "administracao"), True, "administracao"),
            (("recusas", "recusados", "consulta"), True, "consulta"),
            (("recusas", "recusados", "de_fora"), True, "de_fora"),
            (("recusas", "saiu"), None, "deixa a reuniao"),
            (("vazou",), ["k7q49xwpht"], "vazou"),
            (("desfeito", "hosts"), False, "hosts"),
            (("desfeito", "certificado"), False, "certificado"),
        ]
        for path, value, word in cases:
            problems = reuniao_fumaca.problems_of(changed(path, value))
            self.assertEqual(len(problems), 1, (path, problems))
            self.assertIn(word, problems[0], path)
        for path, value, word in [(("recusas", "saiu", "camera"), {"faixas": ["video:live"]}, "fora da reuniao"),
                                  (("recusas", "saiu", "tela"), {"faixa": "live", "superficie": "monitor"},
                                   "fora da reuniao")]:
            record = left_meeting()
            record["recusas"]["saiu"][path[-1]] = value
            problems = reuniao_fumaca.problems_of(record)
            self.assertEqual(len(problems), 1, (path, problems))
            self.assertIn(word, problems[0], path)
        for line, needed in zip(LINES[:6], NEEDED[:6]):
            record = complete()
            for part in (record["principal"], record["recusas"]):
                part["diagnostico"] = [l for l in part["diagnostico"] if l != line]
            self.assertEqual(reuniao_fumaca.problems_of(record), ["falta no diagnostico: " + needed])

    def test_the_line_of_the_frame_does_not_count_as_the_line_of_the_window(self):
        record = complete()
        record["recusas"]["diagnostico"] = [l for l in LINES[2:] if l != "captura de tela cancelada"]
        self.assertEqual(reuniao_fumaca.problems_of(record), ["falta no diagnostico: captura de tela cancelada"])

    def test_the_line_of_a_screen_attempt_counts(self):
        record = complete()
        record["principal"]["diagnostico"] = list(LINES[:2])
        record["tela"]["tentativas"][0]["diagnostico"] = ["captura de tela permitida (quadro)"]
        self.assertEqual(reuniao_fumaca.problems_of(record), [])

    def test_a_frame_held_in_the_meeting_needs_no_refusal_lines(self):
        record = complete()
        self.assertEqual(record["recusas"]["saiu"], {"navegou": False, "camera": None, "tela": None})
        self.assertEqual([l for l in record["recusas"]["diagnostico"] if "(quadro)" in l], [])
        self.assertEqual(reuniao_fumaca.problems_of(record), [])

    def test_a_frame_that_left_the_meeting_needs_both_refusals(self):
        self.assertEqual(reuniao_fumaca.problems_of(left_meeting()), [])
        for line, needed in ((LINES[6], NEEDED[6]), (LINES[7], NEEDED[7])):
            record = left_meeting()
            record["recusas"]["diagnostico"] = [l for l in record["recusas"]["diagnostico"] if l != line]
            self.assertEqual(reuniao_fumaca.problems_of(record), ["falta no diagnostico: " + needed])

    def test_the_refusal_lines_of_the_frame_are_only_read_in_the_refusals_launch(self):
        record = left_meeting()
        record["principal"]["diagnostico"] += list(LINES[6:])
        record["recusas"]["diagnostico"] = list(LINES[2:5])
        self.assertEqual(reuniao_fumaca.problems_of(record),
                         ["falta no diagnostico: " + NEEDED[6], "falta no diagnostico: " + NEEDED[7]])

    def test_the_local_network_run_never_fails_the_proof(self):
        record = complete()
        record["lna"] = {"argumentos": "", "quadro": False, "mensagens": [], "console": ["x"], "diagnostico": ["y"]}
        self.assertEqual(reuniao_fumaca.problems_of(record), [])

    def test_a_partial_record_fails_without_raising(self):
        for record in ({}, {"endereco": "privado"}):
            problems = reuniao_fumaca.problems_of(record)
            self.assertIsInstance(problems, list)
            self.assertNotEqual(problems, [], record)


class _Handle:
    def content_frame(self):
        return None


class _Locator:
    def element_handle(self):
        return _Handle()


class _PageWithoutFrame:
    """Uma página sem o documento do quadro da reunião (content_frame() dá None)."""

    def evaluate(self, *_):
        return None

    def locator(self, _):
        return _Locator()


class LeftMeetingProbeTest(unittest.TestCase):
    def test_a_frame_that_cannot_be_reached_is_reported_as_not_seen(self):
        answer = reuniao_fumaca.probe_left_meeting(_PageWithoutFrame(), reuniao_local.CHAT_ORIGIN, "k7q49xwpht",
                                                   lambda ms: None)
        self.assertEqual(answer, {"erro": "sem o quadro"})


def _csp_meta():
    """A meta da regra de segurança da página do app, lida do windows/ui/index.html (não uma cópia)."""
    html = (ROOT / "windows" / "ui" / "index.html").read_text(encoding="utf-8")
    found = re.search(r'<meta http-equiv="Content-Security-Policy"[^>]*>', html)
    if not found:
        raise AssertionError("o windows/ui/index.html nao tem a meta da regra de seguranca")
    return found.group(0)


@unittest.skipUnless(os.environ.get("STARSONIC_CHAT_BIN"), "falta o STARSONIC_CHAT_BIN")
class RehearsalTest(unittest.TestCase):
    """O item 13 sem o app: o chat de teste atrás da frente TLS, e a janela de cima, na origem do app, servida pela
    rota do teste, com a regra de segurança do windows/ui/index.html."""

    def setUp(self):
        from playwright.sync_api import sync_playwright

        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.chat = reuniao_local.LocalChat(os.environ["STARSONIC_CHAT_BIN"], tmp.name,
                                            [reuniao_local.APP_ORIGIN, reuniao_local.CHAT_ORIGIN])
        self.chat.start()
        self.addCleanup(self.chat.stop)
        _, cert_pem, key_pem = reuniao_local.make_certificates(reuniao_local.CHAT_NAME)
        self.front = reuniao_local.TlsFront("127.0.0.1", 0, self.chat.port, cert_pem, key_pem)
        self.front.start()
        self.addCleanup(self.front.stop)

        link = self.chat.company_with_meetings(reuniao_fumaca.COMPANY)
        self.key = self.chat.link_computer(link, reuniao_fumaca.COMPUTER)
        self.chat.enter_person(self.key, reuniao_fumaca.RAMAL, reuniao_fumaca.PERSON)
        self.code = self.chat.schedule_meeting(self.key, reuniao_fumaca.SUBJECT)
        self.meeting_pass = self.chat.meeting_pass(self.key, self.code)
        self.meeting_passes = [self.meeting_pass]

        pw = sync_playwright().start()
        self.addCleanup(pw.stop)
        # Sem as variáveis de proxy (elas sequestram o https por nome), e só o nome do chat existe: ele vai à frente.
        clean = {k: v for k, v in os.environ.items() if "proxy" not in k.lower()}
        browser = pw.chromium.launch(env=clean, args=[
            "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
            "--disable-features=LocalNetworkAccessChecks",
            "--host-resolver-rules=MAP %s 127.0.0.1:%d, MAP * ~NOTFOUND" % (reuniao_local.CHAT_NAME, self.front.port)])
        self.addCleanup(browser.close)
        context = browser.new_context(ignore_https_errors=True)
        self.page = context.new_page()
        self.console = []
        self.page.on("console", lambda message: self.console.append((message.type, message.text)))
        self.page.on("pageerror", lambda error: self.console.append(("error", str(error))))
        top = ('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">%s<title>Starsonic Phone</title></head>'
               '<body></body></html>' % _csp_meta())
        self.page.route(reuniao_local.APP_ORIGIN + "/**",
                        lambda route: route.fulfill(content_type="text/html; charset=utf-8", body=top))
        self.page.goto(reuniao_local.APP_ORIGIN + "/index.html")
        self.pump = self.page.wait_for_timeout

    def test_the_page_opens_in_a_frame_of_a_window_with_the_origin_of_the_app(self):
        opened = reuniao_fumaca.open_meeting(self.page, reuniao_local.CHAT_ORIGIN, self.code, self.meeting_pass, self.pump)
        self.assertGreater(self.front.connections, 0)
        frame = opened["quadro"]
        self.assertIsNotNone(frame)
        entry = reuniao_fumaca.probe_entry(frame, self.pump)
        self.assertEqual((entry["nome"], entry["imagem"], entry["semAcesso"], entry["entrar"]),
                         ("Ana Souza", "ligada", False, True))
        self.assertGreater(entry["largura"], 0)
        said = reuniao_fumaca.read_messages(self.page)
        self.assertEqual(said["mensagens"], ["pronta", "estado:entrada"])
        self.assertIs(said["microfone"], True)
        self.assertEqual(said["csp"], [])
        self.assertEqual(reuniao_fumaca.probe_media(frame), {"faixas": ["audio:live", "video:live"]})
        self.assertIs(reuniao_fumaca.probe_speaker(frame).get("ok"), True)
        self.assertEqual(reuniao_fumaca.probe_screen(frame, self.pump).get("faixa"), "live")
        reuniao_fumaca.close_meeting(self.page)
        self.assertEqual([f.url for f in self.page.frames if f.url.startswith(reuniao_local.CHAT_ORIGIN)], [])
        # A reunião no quadro não deixa erro no console (lido antes dos quadros recusados: cada recusa deixa o dela).
        errors = [text for kind, text in self.console if kind == "error" and "speaker-selection" not in text]
        self.assertEqual(errors, [])
        # O quadro de fora, quem recusa aqui é a regra de segurança da página do app (os dois do chat são do Windows).
        refused = reuniao_fumaca.probe_refused_frames(self.page, reuniao_local.CHAT_ORIGIN, self.code, self.pump)
        self.assertIs(refused["de_fora"], False)
        # Aqui nenhum executável recusa: o quadro do chat com mais coisa no endereço carrega, e a sonda o vê.
        self.assertIs(refused["consulta"], True)
        # O quadro que deixa a reunião: aqui ele navega, e a câmera dada a ele aparece na sonda.
        second_pass = self.chat.meeting_pass(self.key, self.code)
        self.meeting_passes.append(second_pass)
        reuniao_fumaca.open_meeting(self.page, reuniao_local.CHAT_ORIGIN, self.code, second_pass, self.pump)
        left = reuniao_fumaca.probe_left_meeting(self.page, reuniao_local.CHAT_ORIGIN, self.code, self.pump)
        self.assertIs(left["navegou"], True)
        self.assertEqual(left["camera"], {"faixas": ["video:live"]})
        log = pathlib.Path(self.chat.log_file).read_text(encoding="utf-8", errors="replace")
        self.assertEqual(reuniao_fumaca.leaks(log, [self.code, "Ana Souza"] + self.meeting_passes), [])


if __name__ == "__main__":
    unittest.main()
