"""Testes das ferramentas da fumaça do Windows (reuniao_local.py): os endereços, os certificados, a frente TLS e o
chat em modo de teste. Nenhum teste resolve o nome do chat: quem fala com a frente liga no 127.0.0.1 e diz o nome só
no aperto de mão TLS e no Host. Os da classe LocalChatTest pedem o STARSONIC_CHAT_BIN. Rodar da raiz do repositório:
STARSONIC_CHAT_BIN=$PWD/work/starsonic-chat python3 -m unittest -v tests/smoke/test_reuniao_local.py"""
import datetime
import http.client
import os
import pathlib
import socket
import ssl
import sys
import tempfile
import threading
import time
import unittest

from cryptography import x509

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import reuniao_local  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]


class _Echo:
    """Um servidor TCP de eco, no 127.0.0.1, numa porta livre."""

    def __init__(self):
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(8)
        self.port = self.sock.getsockname()[1]
        threading.Thread(target=self._serve, daemon=True).start()

    def _serve(self):
        while True:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            threading.Thread(target=self._echo, args=(conn,), daemon=True).start()

    @staticmethod
    def _echo(conn):
        with conn:
            try:
                while True:
                    data = conn.recv(4096)
                    if not data:
                        return
                    conn.sendall(data)
            except OSError:
                return

    def close(self):
        self.sock.close()


class AddressTest(unittest.TestCase):
    def test_only_the_three_private_ranges_count(self):
        for address in ("10.1.0.4", "172.16.0.1", "172.31.255.254", "192.168.1.20"):
            self.assertTrue(reuniao_local.is_private(address), address)
        for address in ("127.0.0.1", "172.15.0.1", "172.32.0.1", "169.254.1.1", "8.8.8.8", "192.169.1.1", "", "::1"):
            self.assertFalse(reuniao_local.is_private(address), address)

    def test_the_address_of_this_machine_says_what_it_is(self):
        address, kind = reuniao_local.private_address()
        self.assertEqual(kind, "privado" if reuniao_local.is_private(address) else "loopback")
        if kind == "loopback":
            self.assertEqual(address, "127.0.0.1")


class CertificateTest(unittest.TestCase):
    def test_the_certificate_names_the_chat_and_comes_from_the_authority(self):
        ca_pem, cert_pem, key_pem = reuniao_local.make_certificates(reuniao_local.CHAT_NAME)
        ca, cert = x509.load_pem_x509_certificate(ca_pem), x509.load_pem_x509_certificate(cert_pem)
        names = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
        self.assertEqual(names.get_values_for_type(x509.DNSName), [reuniao_local.CHAT_NAME])
        self.assertTrue(ca.extensions.get_extension_for_class(x509.BasicConstraints).value.ca)
        self.assertFalse(cert.extensions.get_extension_for_class(x509.BasicConstraints).value.ca)
        cert.verify_directly_issued_by(ca)   # a assinatura, o emissor e os identificadores de chave conferem
        for one in (ca, cert):
            self.assertLessEqual(one.not_valid_after_utc - one.not_valid_before_utc, datetime.timedelta(days=3))
        self.assertIn(b"PRIVATE KEY", key_pem)
        self.assertRegex(reuniao_local.thumbprint(ca_pem), r"^[0-9A-F]{40}$")


class TlsFrontTest(unittest.TestCase):
    def setUp(self):
        self.echo = _Echo()
        self.echo_port = self.echo.port
        self.ca_pem, cert_pem, key_pem = reuniao_local.make_certificates(reuniao_local.CHAT_NAME)
        self.front = reuniao_local.TlsFront("127.0.0.1", 0, self.echo_port, cert_pem, key_pem)
        self.front.start()
        self.addCleanup(self.echo.close)
        self.addCleanup(self.front.stop)

    def exchange(self, context):
        with socket.create_connection(("127.0.0.1", self.front.port), timeout=10) as raw:
            with context.wrap_socket(raw, server_hostname=reuniao_local.CHAT_NAME) as tls:
                tls.sendall(b"ola")
                return tls.recv(16)

    def test_a_client_that_trusts_the_authority_reaches_the_target(self):
        self.assertEqual(self.exchange(ssl.create_default_context(cadata=self.ca_pem.decode("ascii"))), b"ola")
        self.assertEqual(self.front.connections, 1)

    def test_a_client_that_does_not_trust_it_does_not_count(self):
        with self.assertRaises(ssl.SSLCertVerificationError):
            self.exchange(ssl.create_default_context())
        time.sleep(0.5)
        self.assertEqual(self.front.connections, 0)


@unittest.skipUnless(os.environ.get("STARSONIC_CHAT_BIN"), "falta o STARSONIC_CHAT_BIN")
class LocalChatTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.tmp.cleanup)
        cls.chat = reuniao_local.LocalChat(
            os.environ["STARSONIC_CHAT_BIN"], cls.tmp.name, [reuniao_local.APP_ORIGIN, reuniao_local.CHAT_ORIGIN])
        cls.chat.start()
        cls.addClassCleanup(cls.chat.stop)
        cls.ca_pem, cert_pem, key_pem = reuniao_local.make_certificates(reuniao_local.CHAT_NAME)
        cls.front = reuniao_local.TlsFront("127.0.0.1", 0, cls.chat.port, cert_pem, key_pem)
        cls.front.start()
        cls.addClassCleanup(cls.front.stop)

    def get_through_the_front(self, path):
        """GET https pela frente (ligando no 127.0.0.1; o nome só no aperto de mão e no Host)."""
        context = ssl.create_default_context(cadata=self.ca_pem.decode("ascii"))
        with socket.create_connection(("127.0.0.1", self.front.port), timeout=10) as raw:
            with context.wrap_socket(raw, server_hostname=reuniao_local.CHAT_NAME) as tls:
                conn = http.client.HTTPConnection("127.0.0.1")
                conn.sock = tls
                conn.putrequest("GET", path, skip_host=True)
                conn.putheader("Host", "%s:%d" % (reuniao_local.CHAT_NAME, reuniao_local.CHAT_PORT))
                conn.endheaders()
                response = conn.getresponse()
                response.read()
                return response.status, dict(response.getheaders())

    def test_a_company_a_computer_a_person_a_meeting_and_a_pass(self):
        code = self.chat.company_with_meetings("Empresa Fumaça")
        self.assertRegex(code, r"^STAR-[A-Z0-9]{4}-[A-Z0-9]{4}$")
        key = self.chat.link_computer(code, "FUMACA-01")
        self.assertRegex(key, r"^[A-Za-z0-9_-]{43}$")
        self.chat.enter_person(key, "2001", "Ana Souza")
        meeting = self.chat.schedule_meeting(key, "Planejamento")
        self.assertRegex(meeting, "^[%s]{10}$" % reuniao_local.CODE_ALPHABET)
        meeting_pass = self.chat.meeting_pass(key, meeting)
        self.assertRegex(meeting_pass, r"^[A-Za-z0-9_-]{43}$")
        opened = self.chat.open_as_colleague(meeting, meeting_pass)
        self.assertEqual(opened["colega"]["nome"], "Ana Souza")
        # O passe vale uma vez só: o segundo abrir com ele não reconhece ninguém.
        with self.assertRaises(RuntimeError):
            self.chat.open_as_colleague(meeting, meeting_pass)
        # Pela frente, com o nome do chat: a página vem, e só o app (e as origens de teste) pode mostrá-la num quadro.
        status, headers = self.get_through_the_front("/r/" + meeting)   # https, o Host CHAT_NAME:8443, a autoridade
        self.assertEqual(status, 200)
        self.assertIn("frame-ancestors https://app.starsonic.local", headers["Content-Security-Policy"])
        # Nada disso foi para o registro do chat.
        log = pathlib.Path(self.chat.log_file).read_text(encoding="utf-8", errors="replace")
        for secret in (meeting, meeting_pass, key, "Ana Souza", "Planejamento"):
            self.assertNotIn(secret, log)


class FailedStartTest(unittest.TestCase):
    """Um chat que sai ao subir não deixa nada para trás. O programa de mentira é um script com #! e o bit de execução:
    estes testes rodam no Linux (aqui e no GitHub), e não precisam do STARSONIC_CHAT_BIN."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.binary = os.path.join(self.tmp.name, "chat-de-mentira")
        with open(self.binary, "w", encoding="ascii") as f:
            f.write('#!/bin/sh\nif [ "$1" = "admin-criar" ]; then cat >/dev/null; exit 0; fi\n'
                    'echo "segredo-do-registro"; exit 3\n')
        os.chmod(self.binary, 0o755)
        self.chat = reuniao_local.LocalChat(self.binary, os.path.join(self.tmp.name, "chat"), [])
        os.makedirs(self.chat.data_dir, exist_ok=True)

    def assert_nothing_left(self):
        self.assertIsNone(self.chat._log)        # o registro foi fechado
        self.assertIsNone(self.chat._process)    # o processo foi esperado

    def test_a_chat_that_exits_while_starting_leaves_nothing_behind(self):
        with self.assertRaises(RuntimeError) as raised:
            self.chat.start()
        self.assertEqual(str(raised.exception), "o chat saiu ao subir (status 3)")
        self.assert_nothing_left()
        with open(self.chat.log_file, "ab"):     # o registro abre de novo para escrita
            pass

    def test_a_failed_start_can_be_followed_by_stop_and_by_another_start_attempt(self):
        with self.assertRaises(RuntimeError):
            self.chat.start()
        self.chat.stop()
        self.assert_nothing_left()
        with self.assertRaises(RuntimeError) as raised:
            self.chat.start()
        self.assertEqual(str(raised.exception), "o chat saiu ao subir (status 3)")
        self.assert_nothing_left()


class NamesTest(unittest.TestCase):
    def test_the_chat_address_is_the_one_of_the_app(self):
        for path in ("windows/app/src/ChatFiles.h", "windows/ui/src/chat/endereco.ts"):
            self.assertIn(reuniao_local.CHAT_ORIGIN, (ROOT / path).read_text(encoding="utf-8"), path)
