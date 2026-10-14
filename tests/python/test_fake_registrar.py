import pathlib
import re
import socket
import subprocess
import sys
import tempfile
import threading
import time
import types
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests" / "smoke"))

import fake_registrar  # noqa: E402

CLIENT = ("127.0.0.1", 5070)


def register(authorization=None, user_agent="Starsonic Phone/0.0.0", expires=300):
    lines = [
        "REGISTER sip:127.0.0.1 SIP/2.0",
        "Via: SIP/2.0/UDP 127.0.0.1:5070;rport;branch=z9hG4bKPj-ci-1",
        "Max-Forwards: 70",
        "From: <sip:2001@127.0.0.1>;tag=from-ci",
        "To: <sip:2001@127.0.0.1>",
        "Call-ID: call-ci-1",
        "CSeq: 7 REGISTER",
        "User-Agent: " + user_agent,
        "Contact: <sip:2001@127.0.0.1:5070;ob>",
        "Expires: %d" % expires,
    ]
    if authorization:
        lines.append("Authorization: " + authorization)
    lines += ["Content-Length:  0", "", ""]
    return "\r\n".join(lines).encode("utf-8")


def parse(response):
    text = response.decode("utf-8")
    head, _, _ = text.partition("\r\n\r\n")
    lines = head.split("\r\n")
    headers = {}
    for line in lines[1:]:
        name, _, value = line.partition(":")
        headers.setdefault(name.strip().lower(), []).append(value.strip())
    return lines[0], headers


def authorization(challenge, password, user="2001"):
    params = dict(re.findall(r'(\w+)="([^"]*)"', challenge))
    response = fake_registrar.digest_response(user, params["realm"], password, "REGISTER",
                                              "sip:127.0.0.1", params["nonce"])
    return ('Digest username="%s", realm="%s", nonce="%s", uri="sip:127.0.0.1", '
            'response="%s", algorithm=MD5' % (user, params["realm"], params["nonce"], response))


PHONE_SDP = ("v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=phone\r\nc=IN IP4 127.0.0.1\r\nt=0 0\r\n"
             "m=audio 4000 RTP/AVP 0 8 97 101\r\na=rtpmap:0 PCMU/8000\r\na=rtpmap:8 PCMA/8000\r\n"
             "a=rtpmap:97 speex/8000\r\na=rtpmap:101 telephone-event/8000\r\n%s\r\n")
SDP_TYPE = "Content-Type: application/sdp"


def read_message(data):
    """(primeira linha, cabecalhos em minusculas -> lista de valores, corpo) de uma mensagem SIP."""
    head, _, body = data.decode("utf-8").partition("\r\n\r\n")
    lines = head.split("\r\n")
    headers = {}
    for line in lines[1:]:
        name, _, value = line.partition(":")
        headers.setdefault(name.strip().lower(), []).append(value.strip())
    return lines[0], headers, body


def sip_message(first_line, headers, body=""):
    lines = [first_line] + list(headers) + ["Content-Length: %d" % len(body.encode("utf-8")), "", body]
    return "\r\n".join(lines)


def phone_request(method, uri, cseq=1, to_tag=None, branch=None, extra=(), body="", call_id="call-phone-1"):
    """Pedido do telefone (2001, em 127.0.0.1:5070) ao registrador."""
    to = "<%s>" % uri + (";tag=" + to_tag if to_tag else "")
    headers = [
        "Via: SIP/2.0/UDP 127.0.0.1:5070;rport;branch=" + (branch or "z9hG4bKphone%d%s" % (cseq, method)),
        "Max-Forwards: 70", "From: <sip:2001@ci>;tag=phone", "To: " + to, "Call-ID: " + call_id,
        "CSeq: %d %s" % (cseq, method), "Contact: <sip:2001@127.0.0.1:5070>",
    ] + list(extra)
    return sip_message("%s %s SIP/2.0" % (method, uri), headers, body)


def phone_response(headers, code, reason, extra=(), body="", to_tag="phone"):
    """Resposta do telefone a um pedido do registrador (copia Via, From, To, Call-ID e CSeq)."""
    to = headers["to"][0]
    if ";tag=" not in to and to_tag:
        to += ";tag=" + to_tag
    lines = ["Via: " + via for via in headers["via"]]
    lines += ["From: " + headers["from"][0], "To: " + to, "Call-ID: " + headers["call-id"][0],
              "CSeq: " + headers["cseq"][0]] + list(extra)
    return sip_message("SIP/2.0 %d %s" % (code, reason), lines, body)


def answer_with_sdp(headers):
    """200 do telefone a um INVITE do registrador."""
    return phone_response(headers, 200, "OK", [SDP_TYPE, "Contact: <sip:2001@127.0.0.1:5070>"],
                          PHONE_SDP % "a=sendrecv")


class Server:
    """O registrador de verdade (UDP, TCP e controle) em portas livres de 127.0.0.1, no processo do teste."""

    def __init__(self, password="senha-certa", users="2001,2002"):
        self.registrar = fake_registrar.Registrar(users, password)
        self.udp = fake_registrar.start_udp_server(self.registrar, "127.0.0.1", 0)
        self.tcp = fake_registrar.start_tcp_server(self.registrar, "127.0.0.1", 0)
        self.control = fake_registrar.start_control_server(self.registrar, "127.0.0.1", 0)

    def close(self):
        for server in (self.control, self.tcp, self.udp):
            server.shutdown()
            server.server_close()


class Phone:
    """Telefone SIP minimo, num socket de verdade (UDP ou TCP), para conversar com o registrador."""

    def __init__(self, server, transport="udp"):
        self.transport, self.buffer, self.pending = transport, b"", []
        if transport == "udp":
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self.sock.bind(("127.0.0.1", 0))
            self.peer = ("127.0.0.1", server.udp.server_address[1])
        else:
            self.sock = socket.create_connection(("127.0.0.1", server.tcp.server_address[1]), timeout=5)
        self.sock.settimeout(5)

    def close(self):
        self.sock.close()

    def send(self, message):
        data = message.encode("utf-8") if isinstance(message, str) else message
        if self.transport == "udp":
            self.sock.sendto(data, self.peer)
        else:
            self.sock.sendall(data)

    def receive(self):
        """Proxima mensagem recebida: (primeira linha, cabecalhos, corpo)."""
        if self.transport == "udp":
            return read_message(self.sock.recv(65535))
        while not self.pending:
            chunk = self.sock.recv(65535)
            if not chunk:
                raise ConnectionError("o registrador fechou a conexao")
            messages, self.buffer = fake_registrar.split_messages(self.buffer + chunk)
            self.pending += messages
        return read_message(self.pending.pop(0))

    def register(self, password="senha-certa", expires=300, uri="sip:127.0.0.1"):
        """REGISTER com Digest (401 e depois a resposta); devolve a primeira linha da resposta final.

        `uri` e a Request-URI: o endereco com que o telefone enxerga o servidor."""
        def message(auth=None):
            return register(auth, expires=expires).replace(
                b"REGISTER sip:127.0.0.1 SIP/2.0", b"REGISTER " + uri.encode() + b" SIP/2.0")
        self.send(message())
        _, headers, _ = self.receive()
        self.send(message(authorization(headers["www-authenticate"][0], password)))
        return self.receive()[0]


def control(server, command):
    """Manda um comando a porta de controle e devolve as linhas da resposta (a de LOG sem o END)."""
    is_log = command == "LOG"
    with socket.create_connection(("127.0.0.1", server.control.server_address[1]), timeout=5) as conn:
        conn.sendall((command + "\n").encode("utf-8"))
        with conn.makefile("rb") as reader:
            lines = []
            while True:
                raw = reader.readline()
                if not raw:
                    break
                lines.append(raw.decode("utf-8").rstrip("\r\n"))
                if not is_log or lines[-1] == "END":
                    break
    return lines[:-1] if is_log else lines


class FakeRegistrarTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.log = pathlib.Path(self._tmp.name) / "user-agent.txt"
        self.registrar = fake_registrar.Registrar(user="2001", password="senha-certa", log_path=self.log)

    def tearDown(self):
        self._tmp.cleanup()

    def challenge(self):
        status, headers = parse(self.registrar.handle(register(), CLIENT))
        self.assertTrue(status.startswith("SIP/2.0 401"))
        return headers["www-authenticate"][0]

    def test_digest_response_matches_rfc2617_example(self):
        args = ("Mufasa", "testrealm@host.com", "Circle Of Life", "GET", "/dir/index.html",
                "dcd98b7102dd2f0e8b11d0f600bfb0c093")
        self.assertEqual(fake_registrar.digest_response(*args), "670fd8c2df070c60b045671b8b24ff02")
        self.assertEqual(fake_registrar.digest_response(*args, qop="auth", nc="00000001", cnonce="0a4f113b"),
                         "6629fae49393a05397450978507c4ef1")

    def test_register_without_auth_gets_401_with_challenge(self):
        status, headers = parse(self.registrar.handle(register(), CLIENT))
        self.assertEqual(status, "SIP/2.0 401 Unauthorized")
        challenge = headers["www-authenticate"][0]
        self.assertRegex(challenge, r'^Digest realm="ci", nonce="[0-9a-f]{32}", algorithm=MD5$')
        self.assertEqual(headers["via"], ["SIP/2.0/UDP 127.0.0.1:5070;rport=5070;branch=z9hG4bKPj-ci-1;received=127.0.0.1"])
        self.assertEqual(headers["from"], ["<sip:2001@127.0.0.1>;tag=from-ci"])
        self.assertEqual(headers["to"], ["<sip:2001@127.0.0.1>;tag=ci"])
        self.assertEqual(headers["call-id"], ["call-ci-1"])
        self.assertEqual(headers["cseq"], ["7 REGISTER"])
        self.assertEqual(headers["content-length"], ["0"])

    def test_wrong_password_gets_403(self):
        challenge = self.challenge()
        status, _ = parse(self.registrar.handle(register(authorization(challenge, "errada")), CLIENT))
        self.assertEqual(status, "SIP/2.0 403 Forbidden")

    def test_unknown_user_or_nonce_gets_403(self):
        challenge = self.challenge()
        status, _ = parse(self.registrar.handle(register(authorization(challenge, "senha-certa", user="2002")), CLIENT))
        self.assertEqual(status, "SIP/2.0 403 Forbidden")
        forged = re.sub(r'nonce="[0-9a-f]+"', 'nonce="' + "0" * 32 + '"', challenge)
        status, _ = parse(self.registrar.handle(register(authorization(forged, "senha-certa")), CLIENT))
        self.assertEqual(status, "SIP/2.0 403 Forbidden")

    def test_every_listed_user_shares_the_password(self):
        registrar = fake_registrar.Registrar(user="2001,2002", password="senha-certa")
        for user in ("2001", "2002"):
            status, headers = parse(registrar.handle(register(), CLIENT))
            challenge = headers["www-authenticate"][0]
            status, _ = parse(registrar.handle(register(authorization(challenge, "senha-certa", user=user)), CLIENT))
            self.assertEqual(status, "SIP/2.0 200 OK", user)
        status, headers = parse(registrar.handle(register(), CLIENT))
        challenge = headers["www-authenticate"][0]
        status, _ = parse(registrar.handle(register(authorization(challenge, "senha-certa", user="2003")), CLIENT))
        self.assertEqual(status, "SIP/2.0 403 Forbidden")

    def test_right_password_gets_200_with_expires(self):
        challenge = self.challenge()
        status, headers = parse(self.registrar.handle(register(authorization(challenge, "senha-certa")), CLIENT))
        self.assertEqual(status, "SIP/2.0 200 OK")
        self.assertEqual(headers["expires"], ["300"])
        self.assertEqual(headers["contact"], ["<sip:2001@127.0.0.1:5070;ob>;expires=300"])
        self.assertEqual(self.log.read_text(encoding="utf-8"), "Starsonic Phone/0.0.0\n")

    def test_options_gets_200_and_ack_gets_nothing(self):
        options = register().replace(b"REGISTER sip:", b"OPTIONS sip:").replace(b"7 REGISTER", b"8 OPTIONS")
        status, _ = parse(self.registrar.handle(options, CLIENT))
        self.assertEqual(status, "SIP/2.0 200 OK")
        ack = register().replace(b"REGISTER sip:", b"ACK sip:").replace(b"7 REGISTER", b"7 ACK")
        self.assertIsNone(self.registrar.handle(ack, CLIENT))

    def test_garbage_is_ignored(self):
        self.assertIsNone(self.registrar.handle(b"\x00\x01ruido", CLIENT))

    def test_split_messages_keeps_partial_tail(self):
        first, second, third = register(), register(user_agent="B"), register(user_agent="C")
        messages, rest = fake_registrar.split_messages(first + second + third[:40])
        self.assertEqual(messages, [first, second])
        self.assertEqual(rest, third[:40])

    def test_split_messages_skips_keepalive_pings(self):
        messages, rest = fake_registrar.split_messages(b"\r\n\r\n" + register())
        self.assertEqual(messages, [register()])
        self.assertEqual(rest, b"")

    def test_split_messages_uses_compact_content_length(self):
        message = register().replace(b"Content-Length:  0", b"l: 4") + b"abcd"
        messages, rest = fake_registrar.split_messages(message + b"OPT")
        self.assertEqual(messages, [message])
        self.assertEqual(rest, b"OPT")

    def test_transport_log_records_tcp_registration(self):
        transport_log = pathlib.Path(self._tmp.name) / "transport.txt"
        registrar = fake_registrar.Registrar(user="2001", password="senha-certa", transport_log_path=transport_log)
        _, headers = parse(registrar.handle(register(), CLIENT, transport="tcp"))
        challenge = headers["www-authenticate"][0]
        status, _ = parse(registrar.handle(register(authorization(challenge, "senha-certa")), CLIENT, transport="tcp"))
        self.assertEqual(status, "SIP/2.0 200 OK")
        self.assertEqual(transport_log.read_text(encoding="utf-8"), "tcp\n")

    def test_tcp_server_answers_register_on_the_same_connection(self):
        registrar = fake_registrar.Registrar(user="2001", password="senha-certa")
        server = fake_registrar.start_tcp_server(registrar, "127.0.0.1", 0)
        try:
            with socket.create_connection(("127.0.0.1", server.server_address[1]), timeout=5) as conn:
                conn.sendall(register())
                data = b""
                while b"\r\n\r\n" not in data:
                    chunk = conn.recv(4096)
                    if not chunk:
                        break
                    data += chunk
            self.assertTrue(data.startswith(b"SIP/2.0 401"), data[:40])
        finally:
            server.shutdown()
            server.server_close()


class CallsTest(unittest.TestCase):
    """Ligacoes e porta de controle, com telefones e sockets de verdade."""

    def setUp(self):
        self.server = Server()
        self.addCleanup(self.server.close)

    def phone(self, transport="udp"):
        phone = Phone(self.server, transport)
        self.addCleanup(phone.close)
        return phone

    def registered(self, transport="udp"):
        phone = self.phone(transport)
        self.assertEqual(phone.register(), "SIP/2.0 200 OK")
        return phone

    def command(self, line):
        return control(self.server, line)

    def log(self):
        return self.command("LOG")

    def wait_for_log(self, line):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if line in self.log():
                return
            time.sleep(0.02)
        self.fail("%r nao apareceu no LOG: %r" % (line, self.log()))

    def ring(self, phone):
        """RING 2001 e o INVITE que chega ao telefone: (primeira linha, cabecalhos, corpo)."""
        self.assertEqual(self.command("RING 2001"), ["OK"])
        message = phone.receive()
        self.assertTrue(message[0].startswith("INVITE "), message[0])
        return message

    def answered_call(self, phone):
        """RING, 180, 200 e o ACK recebido; devolve os cabecalhos do INVITE."""
        _, invite, _ = self.ring(phone)
        phone.send(phone_response(invite, 180, "Ringing"))
        phone.send(answer_with_sdp(invite))
        self.assertTrue(phone.receive()[0].startswith("ACK "))
        return invite

    def test_ring_sends_invite_to_registered_udp_contact(self):
        phone = self.registered()
        start, invite, body = self.ring(phone)
        self.assertEqual(start, "INVITE sip:2001@127.0.0.1:5070;ob SIP/2.0")   # o Contact do REGISTER
        self.assertEqual(invite["from"][0].split(";")[0], '"Cliente Teste" <sip:3001@ci>')
        self.assertEqual(invite["to"], ["<sip:2001@127.0.0.1>"])
        self.assertTrue(invite["via"][0].startswith("SIP/2.0/UDP "), invite["via"])
        self.assertEqual(invite["cseq"], ["1 INVITE"])
        for rtpmap in ("0 PCMU/8000", "8 PCMA/8000", "101 telephone-event/8000"):
            self.assertIn("a=rtpmap:" + rtpmap, body)
        phone.send(phone_response(invite, 180, "Ringing"))
        phone.send(answer_with_sdp(invite))
        start, ack, _ = phone.receive()
        self.assertEqual(start, "ACK sip:2001@127.0.0.1:5070 SIP/2.0")   # o Contact do 200: ACK novo
        self.assertEqual(ack["cseq"], ["1 ACK"])
        self.assertEqual(ack["call-id"], invite["call-id"])
        self.assertTrue(ack["to"][0].endswith(";tag=phone"), ack["to"])
        self.assertEqual(self.log(), ["inv-out 2001 200", "ack-sent 2001"])

    def test_ring_over_tcp_uses_the_registration_connection(self):
        phone = self.registered("tcp")   # nada escuta no Contact (5070): so a conexao do REGISTER serve
        _, invite, _ = self.ring(phone)
        self.assertTrue(invite["via"][0].startswith("SIP/2.0/TCP "), invite["via"])
        phone.send(answer_with_sdp(invite))
        self.assertTrue(phone.receive()[0].startswith("ACK "))
        self.assertEqual(self.log(), ["inv-out 2001 200", "ack-sent 2001"])

    def test_ring_without_registration_errors(self):
        self.assertEqual(self.command("RING 9999"), ["ERR no-contact"])

    def test_ring_after_unregistration_errors(self):
        phone = self.registered()
        self.assertEqual(phone.register(expires=0), "SIP/2.0 200 OK")
        self.assertEqual(self.command("RING 2001"), ["ERR no-contact"])

    def test_ring_advertises_the_address_the_phone_registered_with(self):
        phone = self.phone()   # o servidor que o telefone enxerga nao e o 127.0.0.1 do registrador
        self.assertEqual(phone.register(uri="sip:10.0.2.2:5060"), "SIP/2.0 200 OK")
        _, invite, body = self.ring(phone)
        self.assertEqual(invite["contact"], ["<sip:3001@10.0.2.2:5060>"])
        self.assertTrue(invite["via"][0].startswith("SIP/2.0/UDP 10.0.2.2:5060;"), invite["via"])
        self.assertIn("c=IN IP4 10.0.2.2\r\n", body)

    def test_hangup_sends_bye(self):
        phone = self.registered()
        invite = self.answered_call(phone)
        self.assertEqual(self.command("HANGUP 2001"), ["OK"])
        start, bye, _ = phone.receive()
        self.assertEqual(start, "BYE sip:2001@127.0.0.1:5070 SIP/2.0")
        self.assertEqual(bye["cseq"], ["2 BYE"])
        self.assertEqual(bye["call-id"], invite["call-id"])
        phone.send(phone_response(bye, 200, "OK"))
        self.wait_for_log("bye-out 2001 200")
        self.assertEqual(self.command("HANGUP 2001"), ["ERR no-call"])

    def test_hangup_while_ringing_sends_cancel(self):
        phone = self.registered()
        _, invite, _ = self.ring(phone)
        phone.send(phone_response(invite, 180, "Ringing"))
        self.assertEqual(self.command("HANGUP 2001"), ["OK"])
        start, cancel, _ = phone.receive()
        self.assertEqual(start, "CANCEL sip:2001@127.0.0.1:5070;ob SIP/2.0")
        self.assertEqual(cancel["via"], invite["via"])   # o CANCEL repete o branch do INVITE
        self.assertEqual(cancel["cseq"], ["1 CANCEL"])
        phone.send(phone_response(cancel, 200, "OK"))
        phone.send(phone_response(invite, 487, "Request Terminated"))
        start, ack, _ = phone.receive()   # ACK do 487: na mesma transacao, sem ack-sent
        self.assertEqual(start, "ACK sip:2001@127.0.0.1:5070;ob SIP/2.0")
        self.assertEqual(ack["via"], invite["via"])
        self.assertEqual(ack["cseq"], ["1 ACK"])
        self.wait_for_log("inv-out 2001 487")
        self.assertEqual(self.log(), ["inv-out 2001 487"])

    def test_hangup_without_a_call_errors(self):
        self.registered()
        self.assertEqual(self.command("HANGUP 2001"), ["ERR no-call"])

    def test_ring_refused_by_the_phone_is_acked_in_the_same_transaction(self):
        phone = self.registered()
        _, invite, _ = self.ring(phone)
        phone.send(phone_response(invite, 486, "Busy Here"))
        start, ack, _ = phone.receive()
        self.assertEqual(start, "ACK sip:2001@127.0.0.1:5070;ob SIP/2.0")
        self.assertEqual(ack["via"], invite["via"])
        self.assertEqual(self.log(), ["inv-out 2001 486"])
        self.assertEqual(self.command("HANGUP 2001"), ["ERR no-call"])

    def test_hangup_that_loses_the_race_to_the_answer_hangs_up_afterwards(self):
        phone = self.registered()
        _, invite, _ = self.ring(phone)
        self.assertEqual(self.command("HANGUP 2001"), ["OK"])
        _, cancel, _ = phone.receive()
        phone.send(answer_with_sdp(invite))   # o telefone ja tinha atendido quando o CANCEL chegou
        phone.send(phone_response(cancel, 481, "Call/Transaction Does Not Exist"))
        self.assertTrue(phone.receive()[0].startswith("ACK "))
        start, bye, _ = phone.receive()
        self.assertTrue(start.startswith("BYE "), start)
        phone.send(phone_response(bye, 200, "OK"))
        self.wait_for_log("bye-out 2001 200")
        self.assertEqual(self.log(), ["inv-out 2001 200", "ack-sent 2001", "bye-out 2001 200"])

    def test_second_ring_during_a_call_is_refused_and_hangup_ends_the_live_call(self):
        phone = self.registered()
        first = self.answered_call(phone)
        _, second, _ = self.ring(phone)
        self.assertNotEqual(second["call-id"], first["call-id"])
        phone.send(phone_response(second, 486, "Busy Here"))
        self.assertTrue(phone.receive()[0].startswith("ACK "))
        self.assertEqual(self.command("HANGUP 2001"), ["OK"])
        start, bye, _ = phone.receive()
        self.assertTrue(start.startswith("BYE "), start)
        self.assertEqual(bye["call-id"], first["call-id"])
        self.assertEqual(self.log(), ["inv-out 2001 200", "ack-sent 2001", "inv-out 2001 486"])

    def test_refer_inside_a_ring_call_numbers_the_notify_between_the_invite_and_the_bye(self):
        phone = self.registered()
        invite = self.answered_call(phone)   # o INVITE do RING usou o CSeq 1
        registrar_tag = re.search(r";tag=(\S+)", invite["from"][0]).group(1)
        phone.send(phone_request("REFER", invite["contact"][0].strip("<>"), to_tag=registrar_tag,
                                 call_id=invite["call-id"][0], extra=["Refer-To: <sip:2003@ci>"]))
        self.assertEqual(phone.receive()[0], "SIP/2.0 202 Accepted")
        start, notify, _ = phone.receive()
        self.assertTrue(start.startswith("NOTIFY "), start)
        self.assertEqual(notify["call-id"], invite["call-id"])
        notify_cseq = int(notify["cseq"][0].split()[0])
        # O PJSIP responde 500 "Invalid CSeq" a quem manda CSeq <= ao do INVITE que abriu o dialogo.
        self.assertGreater(notify_cseq, 1)
        phone.send(phone_response(notify, 200, "OK"))
        self.assertEqual(self.command("HANGUP 2001"), ["OK"])
        start, bye, _ = phone.receive()
        self.assertTrue(start.startswith("BYE "), start)
        self.assertGreater(int(bye["cseq"][0].split()[0]), notify_cseq)   # e o BYE que vem depois tambem
        self.assertEqual(self.log(), ["inv-out 2001 200", "ack-sent 2001", "refer-in 3001 2003"])

    def test_ring_after_the_tcp_connection_closes_errors(self):
        phone = self.registered("tcp")
        phone.close()
        deadline = time.monotonic() + 5
        while self.command("RING 2001") != ["ERR no-contact"]:   # o registrador percebe o fim da conexao
            self.assertLess(time.monotonic(), deadline, "o contato TCP nao foi esquecido")
            time.sleep(0.05)

    # --- o telefone liga para o registrador ---

    def invite(self, phone, number, call_id="call-phone-1"):
        phone.send(phone_request("INVITE", "sip:%s@ci" % number, call_id=call_id, extra=[SDP_TYPE],
                                 body=PHONE_SDP % "a=sendrecv"))

    def established_call(self, phone, number="2002"):
        """INVITE, 100, 180, 200 e ACK; devolve a tag que o registrador pos no To."""
        self.invite(phone, number)
        phone.receive()
        phone.receive()
        tag = re.search(r";tag=(\S+)", phone.receive()[1]["to"][0]).group(1)
        phone.send(phone_request("ACK", "sip:%s@ci" % number, to_tag=tag))
        return tag

    def test_invite_to_486_is_busy(self):
        phone = self.phone()
        self.invite(phone, "486")
        start, headers, _ = phone.receive()
        self.assertEqual(start, "SIP/2.0 486 Busy Here")
        self.assertEqual(headers["call-id"], ["call-phone-1"])
        self.assertIn(";tag=", headers["to"][0])
        self.assertEqual(self.log(), ["inv-in 486 486"])

    def test_invite_to_404_and_480_are_refused_the_same_way(self):
        phone = self.phone()
        for number, status in (("404", "SIP/2.0 404 Not Found"), ("480", "SIP/2.0 480 Temporarily Unavailable")):
            self.invite(phone, number, call_id="call-" + number)
            self.assertEqual(phone.receive()[0], status)
        self.assertEqual(self.log(), ["inv-in 404 404", "inv-in 480 480"])

    def test_invite_answered_with_sdp(self):
        phone = self.phone()
        self.invite(phone, "2002")
        self.assertEqual(phone.receive()[0], "SIP/2.0 100 Trying")
        self.assertEqual(phone.receive()[0], "SIP/2.0 180 Ringing")
        start, headers, body = phone.receive()
        self.assertEqual(start, "SIP/2.0 200 OK")
        self.assertEqual(headers["content-type"], ["application/sdp"])
        self.assertEqual(headers["contact"], ["<sip:2002@ci>"])   # a mesma URI com que o telefone nos achou
        # Um codec de audio so (o primeiro da oferta) e o telefone-event: com dois codecs na resposta o PJSUA
        # manda um re-INVITE para travar o codec, e o LOG ganharia reinv-in que ninguem pediu.
        self.assertIn("m=audio 40000 RTP/AVP 0 101\r\n", body)
        self.assertIn("a=rtpmap:0 PCMU/8000\r\n", body)
        self.assertIn("a=rtpmap:101 telephone-event/8000\r\n", body)
        self.assertIn("a=sendrecv\r\n", body)
        self.assertNotIn("PCMA", body)
        self.assertNotIn("speex", body)
        tag = re.search(r";tag=(\S+)", headers["to"][0]).group(1)
        phone.send(phone_request("ACK", "sip:2002@ci", to_tag=tag))
        phone.send(phone_request("BYE", "sip:2002@ci", cseq=2, to_tag=tag))
        start, headers, _ = phone.receive()
        self.assertEqual((start, headers["cseq"]), ("SIP/2.0 200 OK", ["2 BYE"]))
        self.assertEqual(self.log(), ["inv-in 2002 200", "bye-in 2002"])

    def test_answer_has_the_first_offered_audio_codec_and_telephone_event_if_offered(self):
        phone = self.phone()
        offers = (("0 8 97 101", "0 101"), ("8 0 101", "8 101"), ("97 8 0", "8"), ("0 8", "0"), ("101 8 0", "8 101"))
        for number, (formats, answered) in enumerate(offers):
            with self.subTest(formats):
                offer = ("v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=phone\r\nc=IN IP4 127.0.0.1\r\nt=0 0\r\n"
                         "m=audio 4000 RTP/AVP %s\r\n" % formats)
                phone.send(phone_request("INVITE", "sip:2002@ci", call_id="call-offer-%d" % number,
                                         extra=[SDP_TYPE], body=offer))
                phone.receive()   # 100
                phone.receive()   # 180
                self.assertIn("m=audio 40000 RTP/AVP %s\r\n" % answered, phone.receive()[2])

    def test_invite_retransmission_gets_the_last_response_not_a_second_call(self):
        phone = self.phone()
        self.invite(phone, "2002")
        phone.receive()
        phone.receive()
        final = phone.receive()
        self.invite(phone, "2002")   # mesmo Call-ID, CSeq e branch: retransmissao do UDP
        self.assertEqual(phone.receive(), final)
        self.assertEqual(self.log(), ["inv-in 2002 200"])

    def test_reinvite_logs_direction(self):
        phone = self.phone()
        tag = self.established_call(phone)
        mirrored = {"sendonly": "recvonly", "sendrecv": "sendrecv", "inactive": "inactive", "recvonly": "sendonly"}
        for cseq, (offered, answered) in enumerate(mirrored.items(), start=2):
            phone.send(phone_request("INVITE", "sip:2002@ci", cseq=cseq, to_tag=tag, extra=[SDP_TYPE],
                                     body=PHONE_SDP % ("a=" + offered)))
            start, headers, body = phone.receive()
            self.assertEqual((start, headers["cseq"]), ("SIP/2.0 200 OK", ["%d INVITE" % cseq]), offered)
            self.assertIn("a=%s\r\n" % answered, body, offered)
            phone.send(phone_request("ACK", "sip:2002@ci", cseq=cseq, to_tag=tag))
        self.assertEqual(self.log(), ["inv-in 2002 200"] + ["reinv-in 2002 " + name for name in mirrored])

    def test_reinvite_reads_codecs_and_direction_from_the_audio_section(self):
        phone = self.phone()
        tag = self.established_call(phone)
        offer = ("v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=phone\r\nc=IN IP4 127.0.0.1\r\nt=0 0\r\na=sendonly\r\n"
                 "m=video 4002 RTP/AVP 96\r\na=inactive\r\n"
                 "m=audio 4000 RTP/AVP 0\r\n"
                 "m=video 4004 RTP/AVP 97\r\na=inactive\r\n")
        phone.send(phone_request("INVITE", "sip:2002@ci", cseq=2, to_tag=tag, extra=[SDP_TYPE], body=offer))
        body = phone.receive()[2]
        self.assertIn("m=audio 40000 RTP/AVP 0\r\n", body)   # so o formato que a oferta trouxe
        self.assertIn("a=recvonly\r\n", body)                # o sendonly do SDP todo; os inactive sao dos videos
        self.assertEqual(self.log(), ["inv-in 2002 200", "reinv-in 2002 sendonly"])

    def test_refer_is_accepted_and_notified(self):
        phone = self.phone()
        tag = self.established_call(phone)
        phone.send(phone_request("REFER", "sip:2002@ci", cseq=2, to_tag=tag, extra=["Refer-To: <sip:2003@ci>"]))
        self.assertEqual(phone.receive()[0], "SIP/2.0 202 Accepted")
        start, notify, body = phone.receive()
        self.assertEqual(start, "NOTIFY sip:2001@127.0.0.1:5070 SIP/2.0")
        self.assertEqual(notify["event"], ["refer;id=2"])
        self.assertEqual(notify["subscription-state"], ["terminated;reason=noresource"])
        self.assertTrue(notify["content-type"][0].startswith("message/sipfrag"), notify["content-type"])
        self.assertEqual(body, "SIP/2.0 200 OK\r\n")
        self.assertEqual(notify["call-id"], ["call-phone-1"])
        self.assertTrue(notify["from"][0].endswith(";tag=" + tag), notify["from"])   # os papeis se invertem
        self.assertTrue(notify["to"][0].endswith(";tag=phone"), notify["to"])
        self.assertRegex(notify["cseq"][0], r"^\d+ NOTIFY$")
        phone.send(phone_response(notify, 200, "OK"))
        self.assertEqual(self.log(), ["inv-in 2002 200", "refer-in 2002 2003"])

    def test_second_refer_in_a_phone_call_gets_the_next_notify_cseq(self):
        phone = self.phone()
        tag = self.established_call(phone)
        for refer_cseq, notify_cseq in ((2, 1), (3, 2)):   # o dialogo e do telefone: o 1o pedido nosso nele leva o 1
            phone.send(phone_request("REFER", "sip:2002@ci", cseq=refer_cseq, to_tag=tag,
                                     extra=["Refer-To: <sip:2003@ci>"]))
            self.assertEqual(phone.receive()[0], "SIP/2.0 202 Accepted")
            _, notify, _ = phone.receive()
            self.assertEqual(notify["cseq"], ["%d NOTIFY" % notify_cseq])
            phone.send(phone_response(notify, 200, "OK"))
        self.assertEqual(self.log(), ["inv-in 2002 200", "refer-in 2002 2003", "refer-in 2002 2003"])

    def test_cancel_from_the_phone_is_answered_and_logged(self):
        phone = self.phone()
        phone.send(phone_request("CANCEL", "sip:2002@ci"))
        start, headers, _ = phone.receive()
        self.assertEqual((start, headers["cseq"]), ("SIP/2.0 200 OK", ["1 CANCEL"]))
        self.assertEqual(self.log(), ["cancel-in 2002"])

    def test_keepalive_crlf_is_ignored(self):
        for transport in ("udp", "tcp"):
            with self.subTest(transport):
                phone = self.phone(transport)
                phone.send(b"\r\n\r\n")
                self.assertEqual(phone.register(), "SIP/2.0 200 OK")   # a primeira mensagem de volta e o 401

    # --- porta de controle ---

    def test_password_command_changes_the_accepted_password(self):
        phone = self.phone()
        self.assertEqual(phone.register("senha-certa"), "SIP/2.0 200 OK")
        self.assertEqual(self.command("PASSWORD nova"), ["OK"])
        self.assertEqual(phone.register("senha-certa"), "SIP/2.0 403 Forbidden")
        self.assertEqual(phone.register("nova"), "SIP/2.0 200 OK")
        self.assertEqual(self.command("PASSWORD outra senha #ç"), ["OK"])   # espacos e acento passam
        self.assertEqual(phone.register("outra senha #ç"), "SIP/2.0 200 OK")

    def test_registers_counts_accepted_registrations(self):
        phone = self.phone()
        self.assertEqual(self.command("REGISTERS 2001"), ["0"])
        phone.register()
        self.assertEqual(self.command("REGISTERS 2001"), ["1"])
        self.assertEqual(phone.register("errada"), "SIP/2.0 403 Forbidden")   # recusado: nao conta
        phone.register()
        phone.register(expires=0)                                           # cancelamento: nao conta
        self.assertEqual(self.command("REGISTERS 2001"), ["2"])
        self.assertEqual(self.command("REGISTERS 2002"), ["0"])

    def test_unknown_or_incomplete_control_commands_error(self):
        for line in ("DANCE", "RING", "HANGUP", "REGISTERS", "PASSWORD", "LOG now"):
            self.assertEqual(self.command(line), ["ERR bad-command"], line)

    def test_control_connection_takes_several_commands(self):
        with socket.create_connection(("127.0.0.1", self.server.control.server_address[1]), timeout=5) as conn:
            conn.sendall(b"REGISTERS 2001\r\nLOG\nREGISTERS 2002\n")
            with conn.makefile("rb") as reader:
                self.assertEqual([reader.readline() for _ in range(3)], [b"0\n", b"END\n", b"0\n"])


class CommandLineTest(unittest.TestCase):
    """O fake_registrar.py como processo, do jeito que os testes do motor e do Android o sobem."""

    @staticmethod
    def free_port():
        for _ in range(50):
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as tcp:
                tcp.bind(("127.0.0.1", 0))
                port = tcp.getsockname()[1]
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as udp:
                    try:
                        udp.bind(("127.0.0.1", port))
                    except OSError:
                        continue
                return port
        raise RuntimeError("sem porta livre")

    def start(self, *extra):
        port = self.free_port()
        proc = subprocess.Popen(
            [sys.executable, str(ROOT / "tests" / "smoke" / "fake_registrar.py"), "--host", "127.0.0.1",
             "--port", str(port), "--user", "2001", "--password", "senha-certa", *extra],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

        def stop():
            proc.terminate()
            proc.wait(timeout=10)
            proc.stdout.close()
        self.addCleanup(stop)
        watchdog = threading.Timer(15, proc.kill)
        watchdog.start()
        try:
            ready = proc.stdout.readline()
        finally:
            watchdog.cancel()
        return port, ready.rstrip("\r\n")

    @staticmethod
    def endpoints(port, control_port=None):
        def at(number):
            return types.SimpleNamespace(server_address=("127.0.0.1", number))
        return types.SimpleNamespace(udp=at(port), tcp=at(port), control=at(control_port or 0))

    def test_without_control_port_nothing_changes(self):
        port, ready = self.start()
        self.assertEqual(ready, "registrador falso em 127.0.0.1:%d (UDP e TCP)" % port)
        for transport in ("udp", "tcp"):
            phone = Phone(self.endpoints(port), transport)
            self.addCleanup(phone.close)
            self.assertEqual(phone.register(), "SIP/2.0 200 OK", transport)

    def test_control_port_drives_calls_on_the_running_process(self):
        control_port = self.free_port()
        port, ready = self.start("--control-port", str(control_port))
        self.assertTrue(ready.startswith("registrador falso em 127.0.0.1:%d (UDP e TCP)" % port), ready)
        where = self.endpoints(port, control_port)
        self.assertEqual(control(where, "REGISTERS 2001"), ["0"])
        phone = Phone(where)
        self.addCleanup(phone.close)
        self.assertEqual(phone.register(), "SIP/2.0 200 OK")
        self.assertEqual(control(where, "REGISTERS 2001"), ["1"])
        self.assertEqual(control(where, "RING 2001"), ["OK"])
        self.assertTrue(phone.receive()[0].startswith("INVITE sip:2001@127.0.0.1:5070"))


if __name__ == "__main__":
    unittest.main()
