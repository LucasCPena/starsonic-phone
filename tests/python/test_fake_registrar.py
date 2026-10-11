import pathlib
import re
import sys
import tempfile
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


if __name__ == "__main__":
    unittest.main()
