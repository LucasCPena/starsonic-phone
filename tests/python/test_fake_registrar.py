import pathlib
import re
import socket
import statistics
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
# Uma oferta do telefone com o vídeo, como a do PJSIP: o H.264 (com o fmtp dele) e o VP8, e a direção no fim.
VIDEO_SDP = ("v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=phone\r\nc=IN IP4 127.0.0.1\r\nt=0 0\r\n"
             "m=audio 4000 RTP/AVP 0 101\r\na=rtpmap:0 PCMU/8000\r\na=rtpmap:101 telephone-event/8000\r\na=sendrecv\r\n"
             "m=video 4002 RTP/AVP %s\r\na=rtpmap:97 H264/90000\r\n"
             "a=fmtp:97 profile-level-id=42e01f; packetization-mode=1\r\na=rtpmap:98 H264/90000\r\n"
             "a=rtpmap:100 VP8/90000\r\n%s\r\n")


def video_sdp(formats="97 100", direction="a=sendrecv", port=4002):
    """A oferta com o vídeo: os formatos do m=video, a direção dele e a porta."""
    return (VIDEO_SDP % (formats, direction)).replace("m=video 4002 ", "m=video %d " % port)


def video_section(body):
    """O trecho do m=video de um SDP (do m=video ao fim)."""
    return body[body.index("m=video"):]


def rtp(payload_type, marker, timestamp, payload, ssrc=0x01020304, sequence=7):
    """Um datagrama RTP: o cabeçalho de 12 bytes (versão 2, o bit M, o payload type, a sequência, o timestamp e o SSRC)
    e a carga."""
    return (bytes([0x80, (0x80 if marker else 0) | payload_type]) + sequence.to_bytes(2, "big") +
            timestamp.to_bytes(4, "big") + ssrc.to_bytes(4, "big") + payload)


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
    """O registrador de verdade (UDP, TCP, controle e, com video, a PORTA do vídeo) em portas livres de 127.0.0.1, no
    processo do teste."""

    def __init__(self, password="senha-certa", users="2001,2002", video=True):
        self.registrar = fake_registrar.Registrar(users, password)
        self.udp = fake_registrar.start_udp_server(self.registrar, "127.0.0.1", 0)
        self.tcp = fake_registrar.start_tcp_server(self.registrar, "127.0.0.1", 0)
        self.control = fake_registrar.start_control_server(self.registrar, "127.0.0.1", 0)
        self.video = fake_registrar.start_video_server(self.registrar, "127.0.0.1", 0) if video else None

    def close(self):
        for server in (self.control, self.tcp, self.udp, self.video):
            if server:
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
    """Manda um comando a porta de controle e devolve as linhas da resposta (a de LOG e a de VIDEO SDP sem o END)."""
    is_log = command in ("LOG", "VIDEO SDP")
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
        self.assertEqual(self.log(), ["inv-out 2001 200", "sdp-out 2001 200 video=nao", "ack-sent 2001"])

    def test_ring_over_tcp_uses_the_registration_connection(self):
        phone = self.registered("tcp")   # nada escuta no Contact (5070): so a conexao do REGISTER serve
        _, invite, _ = self.ring(phone)
        self.assertTrue(invite["via"][0].startswith("SIP/2.0/TCP "), invite["via"])
        phone.send(answer_with_sdp(invite))
        self.assertTrue(phone.receive()[0].startswith("ACK "))
        self.assertEqual(self.log(), ["inv-out 2001 200", "sdp-out 2001 200 video=nao", "ack-sent 2001"])

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
        self.assertEqual(self.log(), ["inv-out 2001 200", "sdp-out 2001 200 video=nao", "ack-sent 2001",
                                      "bye-out 2001 200"])

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
        self.assertEqual(self.log(), ["inv-out 2001 200", "sdp-out 2001 200 video=nao", "ack-sent 2001",
                                      "inv-out 2001 486"])

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
        self.assertEqual(self.log(), ["inv-out 2001 200", "sdp-out 2001 200 video=nao", "ack-sent 2001",
                                      "refer-in 3001 2003"])

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
        self.assertEqual(self.log(), ["inv-in 486 486", "video-in 486 nao"])

    def test_invite_to_404_and_480_are_refused_the_same_way(self):
        phone = self.phone()
        for number, status in (("404", "SIP/2.0 404 Not Found"), ("480", "SIP/2.0 480 Temporarily Unavailable")):
            self.invite(phone, number, call_id="call-" + number)
            self.assertEqual(phone.receive()[0], status)
        self.assertEqual(self.log(), ["inv-in 404 404", "video-in 404 nao", "inv-in 480 480", "video-in 480 nao"])

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
        self.assertEqual(self.log(), ["inv-in 2002 200", "video-in 2002 nao", "bye-in 2002"])

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

    def test_answer_echoes_the_telephone_event_payload_type_of_the_offer(self):
        # O PJSIP 2.17 oferece um telephone-event por taxa de relogio (120, 121, 122...). O de 8000 Hz e o
        # que acompanha o PCMU e o PCMA; sem ele na resposta o PJSIP nao manda DTMF por RFC 2833.
        phone = self.phone()
        offers = (
            ("9 8 0 120 121", ["120 telephone-event/16000", "121 telephone-event/8000"], ["120 0-16", "121 0-16"],
             "8 121", "121 telephone-event/8000", "121 0-16"),
            ("96 97 98 0 8 9 120 121 122",
             ["0 PCMU/8000", "120 telephone-event/16000", "121 telephone-event/8000", "122 telephone-event/32000"],
             ["120 0-16", "121 0-15", "122 0-16"],
             "0 121", "121 telephone-event/8000", "121 0-15"),
            ("8 110", ["110 TELEPHONE-EVENT/8000"], [], "8 110", "110 telephone-event/8000", "110 0-16"),
        )
        for number, (formats, rtpmaps, fmtps, answered, rtpmap, fmtp) in enumerate(offers):
            with self.subTest(formats):
                offer = ("v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=phone\r\nc=IN IP4 127.0.0.1\r\nt=0 0\r\n"
                         "m=audio 4000 RTP/AVP %s\r\n" % formats
                         + "".join("a=rtpmap:%s\r\n" % line for line in rtpmaps)
                         + "".join("a=fmtp:%s\r\n" % line for line in fmtps) + "a=sendrecv\r\n")
                phone.send(phone_request("INVITE", "sip:2002@ci", call_id="call-event-%d" % number,
                                         extra=[SDP_TYPE], body=offer))
                phone.receive()   # 100
                phone.receive()   # 180
                start, headers, body = phone.receive()
                self.assertIn("m=audio 40000 RTP/AVP %s\r\n" % answered, body)
                self.assertIn("a=rtpmap:%s\r\n" % rtpmap, body)
                self.assertIn("a=fmtp:%s\r\n" % fmtp, body)
                self.assertEqual(body.lower().count("telephone-event"), 1, body)
                # O re-INVITE (Espera) recebe a mesma escolha.
                tag = re.search(r";tag=(\S+)", headers["to"][0]).group(1)
                phone.send(phone_request("ACK", "sip:2002@ci", to_tag=tag, call_id="call-event-%d" % number))
                phone.send(phone_request("INVITE", "sip:2002@ci", cseq=2, to_tag=tag, call_id="call-event-%d" % number,
                                         extra=[SDP_TYPE], body=offer.replace("a=sendrecv", "a=sendonly")))
                body = phone.receive()[2]
                self.assertIn("m=audio 40000 RTP/AVP %s\r\n" % answered, body)
                self.assertIn("a=fmtp:%s\r\n" % fmtp, body)
                self.assertIn("a=recvonly\r\n", body)

    def test_invite_retransmission_gets_the_last_response_not_a_second_call(self):
        phone = self.phone()
        self.invite(phone, "2002")
        phone.receive()
        phone.receive()
        final = phone.receive()
        self.invite(phone, "2002")   # mesmo Call-ID, CSeq e branch: retransmissao do UDP
        self.assertEqual(phone.receive(), final)
        self.assertEqual(self.log(), ["inv-in 2002 200", "video-in 2002 nao"])

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
        reinvites = [line for name in mirrored for line in ("reinv-in 2002 " + name, "video-reinv 2002 nao")]
        self.assertEqual(self.log(), ["inv-in 2002 200", "video-in 2002 nao"] + reinvites)

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
        self.assertEqual(self.log(), ["inv-in 2002 200", "video-in 2002 nao", "reinv-in 2002 sendonly",
                                      "video-reinv 2002 nao"])

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
        self.assertEqual(self.log(), ["inv-in 2002 200", "video-in 2002 nao", "refer-in 2002 2003"])

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
        self.assertEqual(self.log(), ["inv-in 2002 200", "video-in 2002 nao", "refer-in 2002 2003",
                                      "refer-in 2002 2003"])

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

    # --- o vídeo ---

    def video_port(self):
        return self.server.video.server_address[1]

    def video_call(self, phone, number="2003", body=None, call_id="call-video-1"):
        """INVITE com o vídeo; devolve a resposta final (o 100 e o 180 ficam para trás): (primeira linha, cabecalhos,
        corpo)."""
        phone.send(phone_request("INVITE", "sip:%s@ci" % number, call_id=call_id, extra=[SDP_TYPE],
                                 body=body or video_sdp()))
        while True:
            message = phone.receive()
            if not message[0].startswith("SIP/2.0 1"):
                return message

    def video_socket(self):
        """Um socket UDP de 127.0.0.1 que fala com a PORTA do vídeo. A memória de recepção cabe uma reprodução inteira
        (os 300 datagramas guardados): com os 208 KiB de fábrica do Linux, uns 256 datagramas pequenos, um teste sem CPU
        no meio da reprodução perderia o resto."""
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1 << 20)
        sock.bind(("127.0.0.1", 0))
        sock.settimeout(2)
        self.addCleanup(sock.close)
        return sock

    def wait_for_packets(self, count):
        deadline = time.monotonic() + 5
        while self.command("VIDEO PACKETS") != [str(count)]:
            self.assertLess(time.monotonic(), deadline, self.command("VIDEO PACKETS"))
            time.sleep(0.02)

    def test_answer_puts_the_first_video_codec_of_the_offer_on_the_video_port(self):
        phone = self.phone()
        start, _, body = self.video_call(phone)
        self.assertEqual(start, "SIP/2.0 200 OK")
        self.assertIn("m=audio 40000 RTP/AVP 0 101\r\n", body)
        self.assertLess(body.index("m=audio"), body.index("m=video"))   # os trechos na ordem da oferta
        video = video_section(body)
        self.assertTrue(video.startswith("m=video %d RTP/AVP 97\r\n" % self.video_port()), video)
        self.assertIn("a=rtpmap:97 H264/90000\r\n", video)
        self.assertIn("a=fmtp:97 profile-level-id=42e01f; packetization-mode=1\r\n", video)
        self.assertIn("a=sendrecv\r\n", video)
        self.assertNotIn("VP8", body)
        self.assertEqual(self.log(), ["inv-in 2003 200", "video-in 2003 H264,VP8"])

    def test_video_in_lists_the_offered_names_in_order_without_repeating(self):
        phone = self.phone()
        cases = (("100 97 98", "VP8,H264", "100 VP8/90000"), ("98 97 100", "H264,VP8", "98 H264/90000"))
        for number, (formats, names, rtpmap) in enumerate(cases):
            with self.subTest(formats):
                body = self.video_call(phone, body=video_sdp(formats), call_id="call-names-%d" % number)[2]
                self.assertIn("a=rtpmap:%s\r\n" % rtpmap, video_section(body))   # a primeira carga da oferta
                self.assertEqual(self.log()[-1], "video-in 2003 " + names)

    def test_an_offer_without_video_or_with_port_zero_logs_nao(self):
        phone = self.phone()
        self.invite(phone, "2002")
        phone.receive()
        phone.receive()
        self.assertNotIn("m=video", phone.receive()[2])   # sem vídeo na oferta, sem vídeo na resposta
        body = self.video_call(phone, body=video_sdp(port=0), call_id="call-port-0")[2]
        self.assertIn("m=video 0 RTP/AVP 97\r\n", body)   # o trecho volta recusado, na mesma posição
        self.assertEqual(self.log(), ["inv-in 2002 200", "video-in 2002 nao", "inv-in 2003 200", "video-in 2003 nao"])

    def test_video_reject_answers_the_video_with_port_zero(self):
        phone = self.phone()
        self.assertEqual(self.command("VIDEO REJECT on"), ["OK"])
        start, _, body = self.video_call(phone)
        self.assertEqual(start, "SIP/2.0 200 OK")
        self.assertIn("m=audio 40000 RTP/AVP 0 101\r\n", body)
        self.assertTrue(video_section(body).startswith("m=video 0 RTP/AVP 97\r\n"), body)
        self.assertEqual(self.command("VIDEO REJECT off"), ["OK"])
        body = self.video_call(phone, call_id="call-video-2")[2]
        self.assertIn("m=video %d RTP/AVP 97\r\n" % self.video_port(), body)
        self.assertEqual(self.log(), ["inv-in 2003 200", "video-in 2003 H264,VP8",
                                      "inv-in 2003 200", "video-in 2003 H264,VP8"])

    def test_video_488_refuses_only_the_invites_with_video(self):
        phone = self.phone()
        self.assertEqual(self.command("VIDEO 488 on"), ["OK"])
        self.assertEqual(self.video_call(phone)[0], "SIP/2.0 488 Not Acceptable Here")
        self.invite(phone, "2002", call_id="call-voice")
        self.assertEqual([phone.receive()[0] for _ in range(3)][-1], "SIP/2.0 200 OK")
        self.assertEqual(self.command("VIDEO 488 off"), ["OK"])
        self.assertEqual(self.video_call(phone, call_id="call-video-2")[0], "SIP/2.0 200 OK")
        self.assertEqual(self.log(), ["inv-in 2003 488", "video-in 2003 H264,VP8", "inv-in 2002 200",
                                      "video-in 2002 nao", "inv-in 2003 200", "video-in 2003 H264,VP8"])

    def test_reinvite_logs_its_video_and_gets_the_same_answer_rules(self):
        phone = self.phone()
        headers = self.video_call(phone)[1]
        tag = re.search(r";tag=(\S+)", headers["to"][0]).group(1)
        phone.send(phone_request("ACK", "sip:2003@ci", to_tag=tag, call_id="call-video-1"))
        phone.send(phone_request("INVITE", "sip:2003@ci", cseq=2, to_tag=tag, call_id="call-video-1",
                                 extra=[SDP_TYPE], body=video_sdp("100 97", "a=sendonly")))
        start, _, body = phone.receive()
        self.assertEqual(start, "SIP/2.0 200 OK")
        video = video_section(body)
        self.assertTrue(video.startswith("m=video %d RTP/AVP 100\r\n" % self.video_port()), video)
        self.assertIn("a=recvonly\r\n", video)   # a direção do vídeo espelhada, como a do áudio
        phone.send(phone_request("ACK", "sip:2003@ci", cseq=2, to_tag=tag, call_id="call-video-1"))
        phone.send(phone_request("INVITE", "sip:2003@ci", cseq=3, to_tag=tag, call_id="call-video-1",
                                 extra=[SDP_TYPE], body=PHONE_SDP % "a=sendrecv"))
        self.assertNotIn("m=video", phone.receive()[2])
        self.assertEqual(self.command("VIDEO 488 on"), ["OK"])   # o re-INVITE com vídeo também leva 488
        phone.send(phone_request("INVITE", "sip:2003@ci", cseq=4, to_tag=tag, call_id="call-video-1",
                                 extra=[SDP_TYPE], body=video_sdp()))
        self.assertEqual(phone.receive()[0], "SIP/2.0 488 Not Acceptable Here")
        # O reinv-in leva a direção do áudio (sendrecv nesta oferta), e o video-reinv, os nomes do vídeo.
        self.assertEqual(self.log(), ["inv-in 2003 200", "video-in 2003 H264,VP8",
                                      "reinv-in 2003 sendrecv", "video-reinv 2003 VP8,H264",
                                      "reinv-in 2003 sendrecv", "video-reinv 2003 nao",
                                      "reinv-in 2003 sendrecv", "video-reinv 2003 H264,VP8"])

    def test_video_packets_counts_datagrams_with_payload_and_resets(self):
        sock = self.video_socket()
        self.assertEqual(self.command("VIDEO PACKETS"), ["0"])
        for size in (12, 13, 1200, 4):   # só os que passam do cabeçalho do RTP contam
            sock.sendto(b"\x80" * size, ("127.0.0.1", self.video_port()))
        self.wait_for_packets(2)
        self.assertEqual(self.command("VIDEO PACKETS reset"), ["OK"])
        self.assertEqual(self.command("VIDEO PACKETS"), ["0"])
        sock.sendto(b"\x80" * 40, ("127.0.0.1", self.video_port()))
        self.wait_for_packets(1)

    def test_video_echo_returns_each_datagram_with_another_ssrc(self):
        sock = self.video_socket()
        packet = bytes([0x80, 97, 0, 1, 0, 0, 0, 9, 1, 2, 3, 4]) + b"carga"
        self.assertEqual(self.command("VIDEO ECHO on"), ["OK"])
        sock.sendto(packet, ("127.0.0.1", self.video_port()))
        echoed, source = sock.recvfrom(65535)
        self.assertEqual(source[1], self.video_port())
        self.assertEqual(echoed, packet[:11] + bytes([5]) + b"carga")   # o bit mais baixo do SSRC invertido
        self.wait_for_packets(1)   # a contagem continua
        self.assertEqual(self.command("VIDEO ECHO off"), ["OK"])
        sock.settimeout(0.3)
        sock.sendto(packet, ("127.0.0.1", self.video_port()))
        self.wait_for_packets(2)
        with self.assertRaises(socket.timeout):
            sock.recvfrom(65535)

    def test_video_sdp_gives_the_last_sdp_the_phone_sent(self):
        self.assertEqual(self.command("VIDEO SDP"), [])   # nenhum ainda
        phone = self.registered()
        self.video_call(phone)
        self.assertEqual(self.command("VIDEO SDP"), video_sdp().splitlines())
        _, invite, _ = self.ring(phone)
        phone.send(answer_with_sdp(invite))   # a resposta do telefone ao RING também conta
        self.assertTrue(phone.receive()[0].startswith("ACK "))
        self.assertEqual(self.command("VIDEO SDP"), (PHONE_SDP % "a=sendrecv").splitlines())

    def test_ringvideo_offers_the_listed_codecs_on_the_video_port_from_the_given_user(self):
        phone = self.registered()
        self.assertEqual(self.command("RINGVIDEO 2001 9001"), ["OK"])
        start, invite, body = phone.receive()
        self.assertEqual(start, "INVITE sip:2001@127.0.0.1:5070;ob SIP/2.0")
        self.assertEqual(invite["from"][0].split(";")[0], '"Cliente Teste" <sip:9001@ci>')
        self.assertTrue(invite["contact"][0].startswith("<sip:9001@"), invite["contact"])
        self.assertIn("m=audio 40000 RTP/AVP 0 8 101\r\n", body)
        video = video_section(body)
        self.assertTrue(video.startswith("m=video %d RTP/AVP 97 100\r\n" % self.video_port()), video)
        for line in ("a=rtpmap:97 H264/90000", "a=fmtp:97 profile-level-id=42e01f;packetization-mode=1",
                     "a=rtpmap:100 VP8/90000", "a=sendrecv"):
            self.assertIn(line + "\r\n", video)
        phone.send(phone_response(invite, 486, "Busy Here"))
        self.assertTrue(phone.receive()[0].startswith("ACK "))
        self.assertEqual(self.command("RINGVIDEO 2001 9002 VP8"), ["OK"])
        _, invite, body = phone.receive()
        self.assertEqual(invite["from"][0].split(";")[0], '"Cliente Teste" <sip:9002@ci>')
        self.assertTrue(video_section(body).startswith("m=video %d RTP/AVP 100\r\n" % self.video_port()))
        self.assertNotIn("H264", body)

    def test_ringvideo_h264high_offers_an_h264_of_the_high_profile(self):
        phone = self.registered()
        self.assertEqual(self.command("RINGVIDEO 2001 9001 H264HIGH"), ["OK"])
        _, invite, body = phone.receive()
        video = video_section(body)
        self.assertTrue(video.startswith("m=video %d RTP/AVP 99\r\n" % self.video_port()), video)
        for line in ("a=rtpmap:99 H264/90000", "a=fmtp:99 profile-level-id=64001f;packetization-mode=1",
                     "a=sendrecv"):
            self.assertIn(line + "\r\n", video)
        self.assertNotIn("42e01f", body)
        phone.send(phone_response(invite, 486, "Busy Here"))
        self.assertTrue(phone.receive()[0].startswith("ACK "))
        # Com o H.264 de sempre, cada um na sua carga.
        self.assertEqual(self.command("RINGVIDEO 2001 9001 H264,H264HIGH"), ["OK"])
        _, invite, body = phone.receive()
        video = video_section(body)
        self.assertTrue(video.startswith("m=video %d RTP/AVP 97 99\r\n" % self.video_port()), video)
        for line in ("a=fmtp:97 profile-level-id=42e01f;packetization-mode=1",
                     "a=fmtp:99 profile-level-id=64001f;packetization-mode=1"):
            self.assertIn(line + "\r\n", video)
        self.assertEqual(self.command("RINGVIDEO 2001 9001 H264HIGH,H264HIGH"), ["ERR bad-command"])

    def test_ringvideo_refuses_bad_arguments_and_needs_the_video_port(self):
        for line in ("RINGVIDEO", "RINGVIDEO 2001", "RINGVIDEO 2001 9001 H263", "RINGVIDEO 2001 9001 H264,H264",
                     "RINGVIDEO 2001 9001 VP8 extra", "RINGVIDEO 2001 9001 VP8 replay extra",
                     "RINGVIDEO 2001 9001 replay VP8", "VIDEO", "VIDEO REJECT", "VIDEO REJECT maybe", "VIDEO ECHO",
                     "VIDEO PACKETS now", "VIDEO SDP now", "VIDEO 486 on"):
            with self.subTest(line):
                self.assertEqual(self.command(line), ["ERR bad-command"])
        self.assertEqual(self.command("RINGVIDEO 2001 9001"), ["ERR no-contact"])
        server = Server(video=False)
        self.addCleanup(server.close)
        phone = Phone(server)
        self.addCleanup(phone.close)
        self.assertEqual(phone.register(), "SIP/2.0 200 OK")
        self.assertEqual(control(server, "RINGVIDEO 2001 9001"), ["ERR no-video"])

    def test_sdp_out_logs_each_answer_code_with_sdp_once_with_its_video(self):
        phone = self.registered()
        self.assertEqual(self.command("RINGVIDEO 2001 9001"), ["OK"])
        _, invite, _ = phone.receive()
        phone.send(phone_response(invite, 180, "Ringing"))   # sem SDP: nada no registro
        early = phone_response(invite, 183, "Session Progress", [SDP_TYPE], video_sdp())
        phone.send(early)
        phone.send(early)   # repetido: uma linha só
        answer = phone_response(invite, 200, "OK", [SDP_TYPE, "Contact: <sip:2001@127.0.0.1:5070>"],
                                video_sdp(port=0))
        phone.send(answer)
        self.assertTrue(phone.receive()[0].startswith("ACK "))
        phone.send(answer)   # o 200 de novo (UDP): outro ACK, sem registro
        self.assertTrue(phone.receive()[0].startswith("ACK "))
        self.assertEqual(self.log(), ["sdp-out 2001 183 video=sim", "inv-out 2001 200", "sdp-out 2001 200 video=nao",
                                      "ack-sent 2001"])

    # --- a gravação e a reprodução dos pacotes (RINGVIDEO ... replay) ---

    def send_rtp(self, packets):
        """Manda à PORTA os datagramas RTP dados como (payload type, bit M, timestamp, carga), de um socket à parte."""
        sock = self.video_socket()
        for payload_type, marker, timestamp, payload in packets:
            sock.sendto(rtp(payload_type, marker, timestamp, payload), ("127.0.0.1", self.video_port()))

    def replay_call(self, phone, codecs="VP8"):
        """RINGVIDEO 2001 9001 <codecs> replay e o 183 com o SDP do telefone, com o vídeo num socket UDP de verdade;
        devolve (cabeçalhos do INVITE, o socket do vídeo do telefone)."""
        receiver = self.video_socket()
        self.assertEqual(self.command("RINGVIDEO 2001 9001 %s replay" % codecs), ["OK"])
        _, invite, _ = phone.receive()
        phone.send(phone_response(invite, 183, "Session Progress", [SDP_TYPE],
                                  video_sdp(port=receiver.getsockname()[1])))
        return invite, receiver

    def received(self, receiver, timeout=1.0):
        """Os datagramas que chegam ao socket até um silêncio de timeout segundos: (dados, origem, hora)."""
        receiver.settimeout(timeout)
        got = []
        while True:
            try:
                data, source = receiver.recvfrom(65535)
            except socket.timeout:
                return got
            got.append((data, source, time.monotonic()))

    @staticmethod
    def drain(receiver):
        """Lê, sem esperar, os datagramas que já chegaram ao socket; devolve quantos."""
        receiver.setblocking(False)
        count = 0
        try:
            while True:
                receiver.recvfrom(65535)
                count += 1
        except BlockingIOError:
            return count
        finally:
            receiver.setblocking(True)

    def test_ringvideo_replay_sends_the_kept_datagrams_frame_by_frame_with_the_offer_payload_type(self):
        phone = self.registered()
        # Três quadros (os timestamps 10, 20 e 30), o último pacote de cada um com o bit M; o de 12 bytes não fica.
        packets = [(96, False, 10, b"a1"), (96, True, 10, b"a2"), (96, True, 20, b"b1"),
                   (96, False, 30, b"c1"), (96, False, 30, b"c2"), (96, True, 30, b"c3")]
        self.send_rtp(packets)
        self.send_rtp([(96, False, 40, b"")])
        self.wait_for_packets(6)
        before = time.monotonic()   # antes do 183: a reprodução não começa antes disso
        _, receiver = self.replay_call(phone)
        got = self.received(receiver)
        self.assertEqual([data for data, _, _ in got],
                         [rtp(100, marker, timestamp, payload) for _, marker, timestamp, payload in packets])
        self.assertTrue(all(source == ("127.0.0.1", self.video_port()) for _, source, _ in got))   # da PORTA
        # Um quadro a cada 40 ms: o segundo (o pacote 2) só sai depois de uma espera, e o terceiro (o pacote 3) depois
        # de duas, contadas de antes do 183. Um atraso de quem lê só aumenta essas contas.
        times = [at for _, _, at in got]
        self.assertGreaterEqual(times[2] - before, 0.035)
        self.assertGreaterEqual(times[3] - before, 0.075)

    def test_ringvideo_replay_sends_each_frame_at_once_and_one_frame_every_40_ms(self):
        phone = self.registered()
        # Dez quadros de três pacotes (os timestamps 0 a 9), o último de cada um com o bit M.
        packets = [(96, part == 2, frame, b"%d-%d" % (frame, part)) for frame in range(10) for part in range(3)]
        self.send_rtp(packets)
        self.wait_for_packets(30)
        before = time.monotonic()
        _, receiver = self.replay_call(phone)
        got = self.received(receiver)
        self.assertEqual(len(got), 30)
        times = [at for _, _, at in got]
        # O ritmo: o último quadro só sai depois de nove esperas de 40 ms, contadas de antes do 183 (um atraso de quem
        # lê só aumenta a conta). Sem as esperas, tudo chega de uma vez.
        self.assertGreaterEqual(times[-1] - before, 0.35)
        # Os pacotes de um quadro saem juntos: os intervalos dentro de um quadro (20) são bem menores que os intervalos
        # entre os quadros (9). Pelas medianas, um atraso de quem lê ou de quem manda, numa máquina ocupada, não muda o
        # resultado.
        gaps = [later - earlier for earlier, later in zip(times, times[1:])]
        inside = [gap for index, gap in enumerate(gaps) if index % 3 != 2]
        between = [gap for index, gap in enumerate(gaps) if index % 3 == 2]
        self.assertEqual((len(inside), len(between)), (20, 9))
        self.assertLess(statistics.median(inside) * 2, statistics.median(between))

    def test_video_port_keeps_only_the_first_300_datagrams_since_the_last_reset(self):
        phone = self.registered()
        self.send_rtp([(96, False, 1, b"velho")] * 3)
        self.wait_for_packets(3)
        self.assertEqual(self.command("VIDEO PACKETS reset"), ["OK"])
        # 305 pacotes, em quadros de 50 (os timestamps 0 a 6): ficam os 300 primeiros, os seis primeiros quadros. Eles vão
        # um quadro por vez, cada um depois de a PORTA contar os anteriores: os 305 de uma vez passam da memória de
        # fábrica do socket dela (uns 256 datagramas pequenos no Linux) quando a thread dela fica sem CPU, e o sistema
        # descarta o resto antes de ela ler (a contagem parava em 256).
        packets = [(96, number % 50 == 49, number // 50, b"%03d" % number) for number in range(305)]
        for start in range(0, len(packets), 50):
            self.send_rtp(packets[start:start + 50])
            self.wait_for_packets(min(start + 50, len(packets)))
        _, receiver = self.replay_call(phone, "H264,VP8")
        got = [data for data, _, _ in self.received(receiver)]
        self.assertEqual(got, [rtp(97, marker, timestamp, payload) for _, marker, timestamp, payload in packets[:300]])

    def test_ringvideo_replay_starts_only_with_a_live_video_in_the_answer(self):
        phone = self.registered()
        self.send_rtp([(96, True, 10, b"a1")])
        self.wait_for_packets(1)
        receiver = self.video_socket()
        self.assertEqual(self.command("RINGVIDEO 2001 9001 VP8 replay"), ["OK"])
        _, invite, _ = phone.receive()
        phone.send(phone_response(invite, 180, "Ringing"))   # sem SDP
        phone.send(phone_response(invite, 183, "Session Progress", [SDP_TYPE],
                                  video_sdp(port=0)))   # o vídeo recusado
        self.assertEqual(self.received(receiver, 0.3), [])
        phone.send(phone_response(invite, 200, "OK", [SDP_TYPE, "Contact: <sip:2001@127.0.0.1:5070>"],
                                  video_sdp(port=receiver.getsockname()[1])))
        self.assertTrue(phone.receive()[0].startswith("ACK "))
        self.assertEqual([data for data, _, _ in self.received(receiver)], [rtp(100, True, 10, b"a1")])

    def test_ringvideo_replay_stops_when_the_call_ends(self):
        phone = self.registered()
        self.send_rtp([(96, True, timestamp, b"quadro") for timestamp in range(100)])   # 4 s de quadros
        self.wait_for_packets(100)
        invite, receiver = self.replay_call(phone)
        receiver.settimeout(2)
        receiver.recvfrom(65535)   # a reprodução começou
        phone.send(phone_response(invite, 486, "Busy Here"))
        self.assertTrue(phone.receive()[0].startswith("ACK "))
        time.sleep(0.2)   # o que já estava a caminho
        early = 1 + self.drain(receiver)
        self.assertEqual(self.received(receiver, 0.5), [])
        self.assertLess(early, 20)   # bem antes dos 100 quadros

    def test_ringvideo_without_replay_or_without_kept_datagrams_sends_nothing(self):
        phone = self.registered()
        _, receiver = self.replay_call(phone)   # nada guardado
        self.assertEqual(self.received(receiver, 0.5), [])
        self.send_rtp([(96, True, 10, b"a1")])
        self.wait_for_packets(1)
        receiver = self.video_socket()
        self.assertEqual(self.command("RINGVIDEO 2001 9001 VP8"), ["OK"])   # sem o replay
        _, invite, _ = phone.receive()
        phone.send(phone_response(invite, 183, "Session Progress", [SDP_TYPE],
                                  video_sdp(port=receiver.getsockname()[1])))
        self.assertEqual(self.received(receiver, 0.5), [])
        self.assertEqual(self.command("RINGVIDEO 2001 9001 replay"), ["OK"])   # os codecs de sempre, com o replay

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

    def test_video_port_counts_the_datagrams_of_the_running_process(self):
        control_port, video_port = self.free_port(), self.free_port()
        port, ready = self.start("--control-port", str(control_port), "--video-port", str(video_port))
        self.assertEqual(ready, "registrador falso em 127.0.0.1:%d (UDP e TCP), video em 127.0.0.1:%d, controle em "
                                "127.0.0.1:%d" % (port, video_port, control_port))
        where = self.endpoints(port, control_port)
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.sendto(b"\x80" * 100, ("127.0.0.1", video_port))
            deadline = time.monotonic() + 5
            while control(where, "VIDEO PACKETS") != ["1"]:
                self.assertLess(time.monotonic(), deadline, "o datagrama nao foi contado")
                time.sleep(0.02)


if __name__ == "__main__":
    unittest.main()
