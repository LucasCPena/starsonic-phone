"""Testes do registrador falso, em processo e sem rede: as mensagens são montadas e entregues direto aos
tratadores (_on_invite, _on_refer) e à porta de controle (command). Rodar da raiz do repositório:
python3 -m unittest tests/smoke/test_fake_registrar.py"""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import fake_registrar  # noqa: E402

PHONE = fake_registrar._Peer("udp", ("127.0.0.1", 5070))
OFFER = ("v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=phone\r\nc=IN IP4 127.0.0.1\r\nt=0 0\r\n"
         "m=audio 4000 RTP/AVP 0 101\r\na=rtpmap:0 PCMU/8000\r\na=rtpmap:101 telephone-event/8000\r\n")


def phone_request(method, uri, call_id, extra=(), body="", cseq=1, to_tag=None):
    """Pedido do telefone (2001, em 127.0.0.1:5070), lido pelo próprio analisador do registrador."""
    lines = ["%s %s SIP/2.0" % (method, uri),
             "Via: SIP/2.0/UDP 127.0.0.1:5070;rport;branch=z9hG4bK%s%d" % (call_id, cseq),
             "Max-Forwards: 70", "From: <sip:2001@ci>;tag=phone",
             "To: <%s>%s" % (uri, ";tag=" + to_tag if to_tag else ""),
             "Call-ID: " + call_id, "CSeq: %d %s" % (cseq, method), "Contact: <sip:2001@127.0.0.1:5070>"]
    lines += list(extra)
    lines += ["Content-Length: %d" % len(body.encode("utf-8")), "", body]
    return fake_registrar._parse("\r\n".join(lines).encode("utf-8"))


def invite(alvo, call_id):
    return phone_request("INVITE", "sip:%s@ci" % alvo, call_id, ["Content-Type: application/sdp"], OFFER)


def refer(alvo, destino, call_id="call-to-2002", replaces=None):
    """REFER do telefone na ligação com `alvo`; `replaces` é o texto já escapado do parâmetro Replaces."""
    refer_to = "<sip:%s@ci%s>" % (destino, "?Replaces=" + replaces if replaces else "")
    return phone_request("REFER", "sip:%s@ci" % alvo, call_id, ["Refer-To: " + refer_to], cseq=2, to_tag="ci")


def replaces_of(call_id):
    """O Replaces de um Refer-To como o telefone o manda: Call-ID e tags, com ; e = escapados."""
    return call_id + "%3Bto-tag%3Dci%3Bfrom-tag%3Dphone"


class RingSocket:
    """No lugar do socket UDP do registrador: guarda o que o RING mandou ao telefone."""

    def __init__(self):
        self.sent = []

    def sendto(self, data, address):
        self.sent.append((data, address))

    def getsockname(self):
        return ("127.0.0.1", 5060)


class FakeRegistrarReferTest(unittest.TestCase):
    def setUp(self):
        self.registrar = fake_registrar.Registrar("2001", "senha-certa")

    def log(self):
        lines = self.registrar.command("LOG")
        self.assertEqual(lines[-1], "END")
        return lines[:-1]

    def reply(self, replaces=None):
        """O REFER para 2002 e as mensagens (analisadas) com que o registrador responde."""
        replies = self.registrar._on_refer(refer("2002", "2003", replaces=replaces), PHONE)
        return [fake_registrar._parse(data) for data in replies]

    def sipfrag(self):
        """O corpo do NOTIFY que o registrador manda a um REFER."""
        return self.reply()[1].body

    def test_refer_with_replaces_logs_known_dialog(self):
        self.registrar._on_invite(invite("2003", "call-to-2003"), PHONE)
        self.reply(replaces_of("call-to-2003"))
        self.assertEqual(self.log(), ["inv-in 2003 200", "refer-in 2002 2003 replaces=known"])

    def test_refer_with_replaces_of_a_ring_call_logs_known_dialog(self):
        self.registrar.udp = RingSocket()
        self.registrar.contacts["2001"] = fake_registrar._Contact(
            PHONE, "sip:2001@127.0.0.1:5070", "sip:2001@ci", "sip:127.0.0.1")
        self.assertEqual(self.registrar.command("RING 2001"), ["OK"])
        ring = fake_registrar._parse(self.registrar.udp.sent[0][0])
        self.reply(replaces_of(ring.first("call-id")))
        self.assertEqual(self.log(), ["refer-in 2002 2003 replaces=known"])

    def test_refer_with_unknown_replaces_logs_unknown(self):
        self.registrar._on_invite(invite("2003", "call-to-2003"), PHONE)   # há um diálogo, mas não é este
        self.reply(replaces_of("call-inventado"))
        self.assertEqual(self.log(), ["inv-in 2003 200", "refer-in 2002 2003 replaces=unknown"])

    def test_refer_reply_command_changes_the_response(self):
        self.assertEqual(self.registrar.command("REFER_REPLY 603"), ["OK"])
        replies = self.reply()
        self.assertEqual([reply.status for reply in replies], [603])   # nenhum NOTIFY
        self.assertEqual(self.registrar.command("RESET"), ["OK"])
        replies = self.reply()
        self.assertEqual([reply.status or reply.method for reply in replies], [202, "NOTIFY"])

    def test_refer_notify_command_changes_the_sipfrag(self):
        self.assertEqual(self.registrar.command("REFER_NOTIFY 486"), ["OK"])
        response, notify = self.reply()
        self.assertEqual(response.status, 202)
        self.assertEqual(notify.method, "NOTIFY")
        self.assertEqual(notify.body, "SIP/2.0 486 Busy Here\r\n")
        self.assertEqual(notify.first("subscription-state"), "terminated;reason=noresource")

    def test_notify_sipfrag_has_the_phrase_of_the_code(self):
        self.assertEqual(self.sipfrag(), "SIP/2.0 200 OK\r\n")   # o padrão
        for code, line in ((603, "603 Decline"), (404, "404 Error"), (500, "500 Error")):
            with self.subTest(code=code):
                self.registrar.command("REFER_NOTIFY %d" % code)
                self.assertEqual(self.sipfrag(), "SIP/2.0 %s\r\n" % line)
        self.registrar.command("RESET")
        self.assertEqual(self.sipfrag(), "SIP/2.0 200 OK\r\n")

    def test_refer_commands_refuse_what_is_not_a_status_code(self):
        for command in ("REFER_REPLY", "REFER_REPLY abc", "REFER_REPLY 99", "REFER_NOTIFY 7000",
                        "REFER_NOTIFY 2x0", "RESET now"):
            with self.subTest(command=command):
                self.assertEqual(self.registrar.command(command), ["ERR bad-command"])
        self.assertEqual([reply.status or reply.method for reply in self.reply()], [202, "NOTIFY"])


if __name__ == "__main__":
    unittest.main()
