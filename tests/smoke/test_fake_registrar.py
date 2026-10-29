"""Testes do registrador falso, em processo e sem rede: as mensagens são montadas e entregues direto aos
tratadores (_on_invite, _on_refer) e à porta de controle (command). Rodar da raiz do repositório:
python3 -m unittest tests/smoke/test_fake_registrar.py"""
import pathlib
import socket
import sys
import time
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import fake_registrar  # noqa: E402

PHONE = fake_registrar._Peer("udp", ("127.0.0.1", 5070))
CONTACT = "<sip:2001@127.0.0.1:5070>"
OFFER = ("v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=phone\r\nc=IN IP4 127.0.0.1\r\nt=0 0\r\n"
         "m=audio 4000 RTP/AVP 0 101\r\na=rtpmap:0 PCMU/8000\r\na=rtpmap:101 telephone-event/8000\r\n")


def phone_request(method, uri, call_id, extra=(), body="", cseq=1, to_tag=None, contact=CONTACT):
    """Pedido do telefone (2001, em 127.0.0.1:5070), lido pelo próprio analisador do registrador."""
    lines = ["%s %s SIP/2.0" % (method, uri),
             "Via: SIP/2.0/UDP 127.0.0.1:5070;rport;branch=z9hG4bK%s%d" % (call_id, cseq),
             "Max-Forwards: 70", "From: <sip:2001@ci>;tag=phone",
             "To: <%s>%s" % (uri, ";tag=" + to_tag if to_tag else ""),
             "Call-ID: " + call_id, "CSeq: %d %s" % (cseq, method), "Contact: " + contact]
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


def subscribe(alvo, call_id="sub-2007", expires=None, event="dialog", cseq=1, to_tag=None):
    """SUBSCRIBE do telefone ao estado do ramal `alvo` (BLF, RFC 4235)."""
    extra = ["Event: " + event, "Accept: application/dialog-info+xml"]
    if expires is not None:
        extra.append("Expires: %d" % expires)
    return phone_request("SUBSCRIBE", "sip:%s@ci" % alvo, call_id, extra, cseq=cseq, to_tag=to_tag)


def register(registrar, nonce="nonce-1", contact=CONTACT, extra=(), expires=300, password=None):
    """REGISTER de 2001 já com o Digest certo para a senha do registrador (ou para `password`). `contact` é o
    Contact e `extra`, os cabeçalhos a mais."""
    registrar.nonces.add(nonce)
    uri = "sip:127.0.0.1"
    response = fake_registrar.digest_response("2001", "ci", password or registrar.password, "REGISTER", uri, nonce)
    authorization = ('Digest username="2001", realm="ci", nonce="%s", uri="%s", response="%s", algorithm=MD5'
                     % (nonce, uri, response))
    return phone_request("REGISTER", uri, "reg-2001",
                         ["Expires: %d" % expires, "Authorization: " + authorization] + list(extra), contact=contact)


class FakeRegistrarBlfTest(unittest.TestCase):
    def setUp(self):
        self.registrar = fake_registrar.Registrar("2001", "senha-certa")
        self.registrar.udp = RingSocket()

    def log(self):
        return self.registrar.command("LOG")[:-1]

    def answer(self, message):
        """As respostas (analisadas) do registrador a um pedido do telefone."""
        return [fake_registrar._parse(data) for data in self.registrar.dispatch(
            _raw(message), ("127.0.0.1", 5070))]

    def sent(self):
        """O que o registrador mandou por conta própria (os NOTIFY dos comandos BLF), analisado."""
        return [fake_registrar._parse(data) for data, _ in self.registrar.udp.sent]

    def test_subscribe_dialog_answers_200_and_notifies_no_dialog(self):
        replies = self.answer(subscribe("2007", expires=600))
        self.assertEqual([reply.status or reply.method for reply in replies], [200, "NOTIFY"])
        response, notify = replies
        self.assertEqual(response.first("expires"), "600")
        self.assertIn(";tag=", response.first("to"))
        self.assertEqual(notify.uri, "sip:2001@127.0.0.1:5070")   # o Contact do SUBSCRIBE
        self.assertEqual(notify.first("event"), "dialog")
        self.assertEqual(notify.first("subscription-state"), "active;expires=600")
        self.assertEqual(notify.first("content-type"), "application/dialog-info+xml")
        self.assertEqual(notify.first("call-id"), "sub-2007")
        self.assertEqual(notify.first("from"), response.first("to"))   # a mesma tag do 200
        self.assertEqual(notify.first("to"), "<sip:2001@ci>;tag=phone")
        self.assertIn('entity="sip:2007@ci"', notify.body)
        self.assertNotIn("<dialog ", notify.body)   # ninguém ligou ainda: nenhum diálogo, o ramal está livre
        self.assertEqual(self.log(), ["sub-in 2007 200"])

    def test_blf_command_notifies_each_state(self):
        self.answer(subscribe("2007"))
        cseqs = []
        for state in ("early", "confirmed", "terminated"):
            with self.subTest(state=state):
                self.assertEqual(self.registrar.command("BLF 2007 " + state), ["OK"])
                notify = self.sent()[-1]
                self.assertEqual(notify.method, "NOTIFY")
                self.assertIn("<state>%s</state>" % state, notify.body)
                self.assertTrue(notify.first("subscription-state").startswith("active"))
                cseqs.append(int(notify.first("cseq").split()[0]))
        self.assertEqual(cseqs, sorted(set(cseqs)))   # o CSeq sobe a cada NOTIFY do diálogo
        self.assertEqual(len(self.sent()), 3)

    def test_blf_state_holds_for_a_new_subscription(self):
        self.assertEqual(self.registrar.command("BLF 2007 confirmed"), ["OK"])   # ninguém assina ainda
        self.assertEqual(self.sent(), [])
        notify = self.answer(subscribe("2007"))[1]
        self.assertIn("<state>confirmed</state>", notify.body)

    def test_blf_refuse_rejects_new_subscriptions(self):
        self.assertEqual(self.registrar.command("BLF 2007 refuse"), ["OK"])
        replies = self.answer(subscribe("2007"))
        self.assertEqual([reply.status for reply in replies], [403])   # nenhum NOTIFY
        self.assertEqual(self.log(), ["sub-in 2007 403"])

    def test_blf_refuse_ends_an_active_subscription(self):
        self.answer(subscribe("2007"))
        self.assertEqual(self.registrar.command("BLF 2007 refuse"), ["OK"])
        notify = self.sent()[-1]
        self.assertEqual(notify.first("subscription-state"), "terminated;reason=rejected")
        self.registrar.command("BLF 2007 early")   # a assinatura acabou: nada mais vai ao telefone
        self.assertEqual(len(self.sent()), 1)

    def test_unsubscribe_ends_the_subscription(self):
        self.answer(subscribe("2007"))
        replies = self.answer(subscribe("2007", expires=0, cseq=2, to_tag="ci"))
        self.assertEqual([reply.status or reply.method for reply in replies], [200, "NOTIFY"])
        self.assertTrue(replies[1].first("subscription-state").startswith("terminated"))
        self.assertEqual(self.log(), ["sub-in 2007 200", "unsub-in 2007"])
        self.registrar.command("BLF 2007 early")
        self.assertEqual(self.sent(), [])

    def test_refresh_keeps_the_subscription(self):
        self.answer(subscribe("2007"))
        replies = self.answer(subscribe("2007", expires=600, cseq=2, to_tag="ci"))
        self.assertEqual([reply.status or reply.method for reply in replies], [200, "NOTIFY"])
        self.assertEqual(self.log(), ["sub-in 2007 200", "sub-in 2007 200"])
        self.registrar.command("BLF 2007 early")
        self.assertEqual(len(self.sent()), 1)   # uma assinatura só, não duas

    def test_other_subscribe_events_keep_the_plain_200(self):
        replies = self.answer(subscribe("2007", event="presence"))
        self.assertEqual([reply.status for reply in replies], [200])
        self.assertEqual(self.log(), [])

    def test_blf_command_refuses_bad_arguments(self):
        for command in ("BLF", "BLF 2007", "BLF 2007 ringing", "BLF 2007 early now", "BLF  early"):
            with self.subTest(command=command):
                self.assertEqual(self.registrar.command(command), ["ERR bad-command"])

    def test_blf_two_dialogs_go_in_one_full_notify(self):
        self.answer(subscribe("2007"))
        self.assertEqual(self.registrar.command("BLF 2007 confirmed+early"), ["OK"])
        notify = self.sent()[-1]
        self.assertIn('state="full"', notify.body)
        self.assertIn('<dialog id="ci-2007-1" direction="recipient">\r\n<state>confirmed</state>', notify.body)
        self.assertIn('<dialog id="ci-2007-2" direction="recipient">\r\n<state>early</state>', notify.body)

    def test_blf_partial_update_changes_one_dialog(self):
        self.answer(subscribe("2007"))
        self.registrar.command("BLF 2007 confirmed+early")
        self.assertEqual(self.registrar.command("BLF 2007 terminated@2"), ["OK"])
        notify = self.sent()[-1]
        self.assertIn('state="partial"', notify.body)
        self.assertIn('<dialog id="ci-2007-2" direction="recipient">\r\n<state>terminated</state>', notify.body)
        self.assertNotIn("ci-2007-1", notify.body)
        # Uma assinatura nova recebe tudo de uma vez, com a mudança.
        full = self.answer(subscribe("2007", call_id="sub-2007-b"))[1]
        self.assertIn('state="full"', full.body)
        self.assertIn("<state>confirmed</state>", full.body)
        self.assertIn("<state>terminated</state>", full.body)

    def test_blf_partial_update_needs_the_dialog(self):
        self.assertEqual(self.registrar.command("BLF 2007 early@1"), ["ERR no-dialog"])
        self.registrar.command("BLF 2007 confirmed")
        self.assertEqual(self.registrar.command("BLF 2007 early@2"), ["ERR no-dialog"])
        self.assertEqual(self.registrar.command("BLF 2007 early@1"), ["OK"])

    def test_blf_dialog_lists_refuse_bad_arguments(self):
        for command in ("BLF 2007 early+", "BLF 2007 +early", "BLF 2007 early+ringing", "BLF 2007 refuse+early",
                        "BLF 2007 early@0", "BLF 2007 early@x", "BLF 2007 refuse@1", "BLF 2007 early+early@1"):
            with self.subTest(command=command):
                self.assertEqual(self.registrar.command(command), ["ERR bad-command"])

    def test_drop_register_ignores_registers_while_on(self):
        self.assertEqual(self.registrar.command("DROP REGISTER on"), ["OK"])
        self.assertEqual(self.answer(register(self.registrar)), [])   # nenhuma resposta: como um pacote perdido
        self.assertEqual(self.registrar.command("REGISTERS 2001"), ["0"])
        self.assertEqual(self.answer(subscribe("2007"))[0].status, 200)   # o resto continua respondendo
        self.assertEqual(self.registrar.command("DROP REGISTER off"), ["OK"])
        self.assertEqual(self.answer(register(self.registrar, "nonce-2"))[0].status, 200)
        for command in ("DROP", "DROP REGISTER", "DROP INVITE on", "DROP REGISTER maybe"):
            with self.subTest(command=command):
                self.assertEqual(self.registrar.command(command), ["ERR bad-command"])

    def test_forget_drops_the_subscriptions_without_any_notify(self):
        self.answer(subscribe("2007"))
        self.assertEqual(self.registrar.command("FORGET"), ["OK"])
        self.registrar.command("BLF 2007 early")   # a central reiniciada nao lembra de ninguem: nenhum NOTIFY
        self.assertEqual(self.sent(), [])
        notify = self.answer(subscribe("2007", call_id="sub-2007-b"))[1]   # uma assinatura nova volta a valer
        self.assertIn("<state>early</state>", notify.body)
        self.assertEqual(self.registrar.command("FORGET now"), ["ERR bad-command"])

    def test_fail_register_answers_503_while_on(self):
        self.assertEqual(self.registrar.command("FAIL REGISTER on"), ["OK"])
        self.assertEqual([reply.status for reply in self.answer(register(self.registrar))], [503])
        self.assertEqual(self.registrar.command("REGISTERS 2001"), ["0"])
        self.assertEqual(self.log(), ["register-503 2001"])   # cada REGISTER recusado vai ao registro
        self.assertEqual(self.answer(subscribe("2007"))[0].status, 200)   # o resto continua respondendo
        self.assertEqual(self.registrar.command("FAIL REGISTER off"), ["OK"])
        self.assertEqual(self.answer(register(self.registrar, "nonce-2"))[0].status, 200)
        self.assertEqual(self.registrar.command("REGISTERS 2001"), ["1"])
        for command in ("FAIL", "FAIL REGISTER", "FAIL INVITE on", "FAIL REGISTER maybe"):
            with self.subTest(command=command):
                self.assertEqual(self.registrar.command(command), ["ERR bad-command"])

    def test_expires_command_sets_the_granted_registration_time(self):
        response = self.answer(register(self.registrar))[0]
        self.assertEqual(response.first("expires"), "300")   # o padrão: o que o telefone pediu
        self.assertEqual(self.registrar.command("EXPIRES 2"), ["OK"])
        response = self.answer(register(self.registrar, "nonce-2"))[0]
        self.assertEqual(response.status, 200)
        self.assertEqual(response.first("expires"), "2")
        self.assertTrue(response.first("contact").endswith(";expires=2"))
        self.assertEqual(self.registrar.command("REGISTERS 2001"), ["2"])
        for command in ("EXPIRES", "EXPIRES 0", "EXPIRES abc"):
            with self.subTest(command=command):
                self.assertEqual(self.registrar.command(command), ["ERR bad-command"])


def read_response(conn):
    """A resposta SIP que chega por uma conexão TCP, até o fim do cabeçalho."""
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = conn.recv(4096)
        if not chunk:
            break
        data += chunk
    return data


def wait_for(check, seconds=5):
    """Espera até `seconds` que check() fique verdadeiro; devolve o último valor."""
    deadline = time.monotonic() + seconds
    while not check() and time.monotonic() < deadline:
        time.sleep(0.01)
    return check()


class FakeRegistrarRegisterTest(unittest.TestCase):
    """O que o registrador guarda do último REGISTER aceito (CONTACT e HEADER) e os keep-alives (KEEPALIVES)."""

    def setUp(self):
        self.registrar = fake_registrar.Registrar("2001", "senha-certa")

    def answer(self, message):
        """O código da primeira resposta do registrador a um pedido do telefone."""
        replies = self.registrar.dispatch(_raw(message), ("127.0.0.1", 5070))
        return fake_registrar._parse(replies[0]).status

    def keepalives(self):
        return self.registrar.command("KEEPALIVES")

    def tcp_connection(self):
        """Uma conexão com o lado TCP do registrador, numa porta livre; tudo se fecha no fim do teste."""
        server = fake_registrar.start_tcp_server(self.registrar, "127.0.0.1", 0)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        conn = socket.create_connection(("127.0.0.1", server.server_address[1]), timeout=5)
        self.addCleanup(conn.close)
        return conn

    def test_contact_reports_the_contact_of_the_last_register(self):
        self.assertEqual(self.registrar.command("CONTACT 2001"), ["ERR no-contact"])
        contact = "<sip:2001@127.0.0.1:5070;pn-provider=apns;pn-prid=abc>"
        self.assertEqual(self.answer(register(self.registrar, contact=contact)), 200)
        self.assertEqual(self.registrar.command("CONTACT 2001"), [contact])
        self.assertEqual(self.registrar.command("CONTACT 2002"), ["ERR no-contact"])   # outro ramal: nenhum REGISTER
        # O cabeçalho inteiro, como chegou: com os parâmetros do próprio Contact, depois da URI.
        whole = '<sip:2001@127.0.0.1:5070;ob>;reg-id=1;+sip.instance="<urn:uuid:00000000-0000-4000-8000-000000000001>"'
        self.assertEqual(self.answer(register(self.registrar, "nonce-2", contact=whole)), 200)
        self.assertEqual(self.registrar.command("CONTACT 2001"), [whole])

    def test_header_reports_a_header_of_the_last_register(self):
        self.assertEqual(self.registrar.command("HEADER 2001 x-push-token"), ["ERR no-contact"])   # nenhum REGISTER
        self.assertEqual(self.answer(register(self.registrar, extra=["X-Push-Token: abc"])), 200)
        self.assertEqual(self.registrar.command("HEADER 2001 x-push-token"), ["abc"])
        self.assertEqual(self.registrar.command("HEADER 2001 X-PUSH-TOKEN"), ["abc"])   # sem diferença de maiúsculas
        self.assertEqual(self.registrar.command("HEADER 2001 X-Outro"), ["ERR no-header"])
        self.assertEqual(self.registrar.command("HEADER 2002 x-push-token"), ["ERR no-contact"])
        # Um cabeçalho que vem mais de uma vez vale pelo último valor.
        both = ["X-Push-Token: abc", "X-Push-Token: def"]
        self.assertEqual(self.answer(register(self.registrar, "nonce-2", extra=both)), 200)
        self.assertEqual(self.registrar.command("HEADER 2001 x-push-token"), ["def"])

    def test_contact_and_header_follow_only_the_register_accepted_with_expires(self):
        first = "<sip:2001@127.0.0.1:5070;pn-prid=um>"
        self.assertEqual(self.answer(register(self.registrar, contact=first, extra=["X-Push-Token: um"])), 200)
        # O desafio (401), a senha errada (403) e a saída (Expires: 0, aceita) não trocam o que vale.
        challenge = phone_request("REGISTER", "sip:127.0.0.1", "reg-2001", ["Expires: 300", "X-Push-Token: dois"],
                                  contact="<sip:2001@127.0.0.1:5070;pn-prid=dois>")
        self.assertEqual(self.answer(challenge), 401)
        wrong = register(self.registrar, "nonce-2", contact="<sip:2001@127.0.0.1:5070;pn-prid=tres>",
                         extra=["X-Push-Token: tres"], password="errada")
        self.assertEqual(self.answer(wrong), 403)
        leaving = register(self.registrar, "nonce-3", contact="<sip:2001@127.0.0.1:5070;pn-prid=quatro>",
                           extra=["X-Push-Token: quatro"], expires=0)
        self.assertEqual(self.answer(leaving), 200)
        self.assertEqual(self.registrar.command("REGISTERS 2001"), ["1"])
        self.assertEqual(self.registrar.command("CONTACT 2001"), [first])
        self.assertEqual(self.registrar.command("HEADER 2001 X-Push-Token"), ["um"])
        # O REGISTER aceito seguinte, com Expires > 0, toma o lugar.
        second = "<sip:2001@127.0.0.1:5070;pn-prid=cinco>"
        self.assertEqual(self.answer(register(self.registrar, "nonce-4", contact=second,
                                              extra=["X-Push-Token: cinco"])), 200)
        self.assertEqual(self.registrar.command("CONTACT 2001"), [second])
        self.assertEqual(self.registrar.command("HEADER 2001 X-Push-Token"), ["cinco"])

    def test_contact_header_and_keepalives_refuse_bad_arguments(self):
        for command in ("CONTACT", "HEADER", "HEADER 2001", "HEADER 2001 a b", "HEADER  x-push-token",
                        "KEEPALIVES now"):
            with self.subTest(command=command):
                self.assertEqual(self.registrar.command(command), ["ERR bad-command"])

    def test_keepalives_counts_crlf_pings_over_udp_and_tcp(self):
        self.assertEqual(self.keepalives(), ["0"])
        self.registrar.process(b"\r\n", ("127.0.0.1", 5070))   # o caminho do UDP: um datagrama só com CR e LF
        self.assertEqual(self.keepalives(), ["1"])
        conn = self.tcp_connection()
        # O ping do TCP e, atrás dele, um pedido que tem resposta: com o 200 na mão, o ping já foi lido.
        conn.sendall(b"\r\n\r\n" + _raw(phone_request("OPTIONS", "sip:2001@ci", "options-1")))
        self.assertTrue(read_response(conn).startswith(b"SIP/2.0 200"))
        self.assertEqual(self.keepalives(), ["2"])

    def test_keepalives_over_tcp_count_each_double_crlf_between_messages(self):
        conn = self.tcp_connection()
        options = _raw(phone_request("OPTIONS", "sip:2001@ci", "options-1"))
        conn.sendall(b"\r\n\r\n\r\n\r\n" + options)   # dois pings seguidos e um pedido (que não conta)
        self.assertTrue(read_response(conn).startswith(b"SIP/2.0 200"))
        self.assertEqual(self.keepalives(), ["2"])
        conn.sendall(b"\r\n")   # um ping que chega em dois pedaços
        time.sleep(0.1)
        conn.sendall(b"\r\n")
        self.assertTrue(wait_for(lambda: self.keepalives() == ["3"]), self.keepalives())
        conn.sendall(options + b"\r\n\r\n")   # um ping depois do pedido, sem nenhum pedido atrás dele
        self.assertTrue(read_response(conn).startswith(b"SIP/2.0 200"))
        self.assertTrue(wait_for(lambda: self.keepalives() == ["4"]), self.keepalives())

    def test_keepalives_ignore_everything_that_is_not_a_crlf_datagram(self):
        for data in (b"", b"\x00\x01ruido", b"\r\nruido\r\n", _raw(register(self.registrar))):
            self.registrar.process(data, ("127.0.0.1", 5070))
        self.assertEqual(self.keepalives(), ["0"])
        self.registrar.process(b"\r\n\r\n", ("127.0.0.1", 5070))   # um datagrama, vários CRLF: um keep-alive
        self.assertEqual(self.keepalives(), ["1"])


def _raw(message):
    """Os bytes de uma mensagem já analisada (o registrador as lê de novo em dispatch)."""
    lines = ["%s %s SIP/2.0" % (message.method, message.uri)]
    lines += ["%s: %s" % (name, value) for name, value in message.headers if name != "content-length"]
    lines += ["Content-Length: %d" % len(message.body.encode("utf-8")), "", message.body]
    return "\r\n".join(lines).encode("utf-8")


if __name__ == "__main__":
    unittest.main()
