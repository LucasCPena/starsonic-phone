"""O chat da fumaça do Windows: o programa do chat em modo de teste (LocalChat), certificados de mentira (uma
autoridade e o certificado do nome do chat) e uma frente TLS que repassa os bytes para o chat. Importa no Linux e no
Windows; o cryptography só é importado dentro das funções que o usam. Nada daqui imprime a senha, a chave nem o passe,
e nenhum pedido sai do 127.0.0.1 (sem proxy nenhum)."""
import datetime
import http.client
import ipaddress
import json
import os
import re
import secrets
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import urllib.parse

CHAT_NAME = "chat.starcloud-starsonic.com.br"
CHAT_PORT = 8443
CHAT_ORIGIN = "https://chat.starcloud-starsonic.com.br:8443"
APP_ORIGIN = "https://app.starsonic.local"
CODE_ALPHABET = "abcdefghjkmnpqrstvwxyz23456789"

_PRIVATE_RANGES = [ipaddress.ip_network(n) for n in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")]


def is_private(address: str) -> bool:
    """Vale o IPv4 das faixas 10/8, 172.16/12 e 192.168/16."""
    try:
        ip = ipaddress.IPv4Address(address)
    except ValueError:
        return False
    return any(ip in net for net in _PRIVATE_RANGES)


def private_address() -> tuple[str, str]:
    """O IPv4 privado da máquina e "privado"; sem um, ("127.0.0.1", "loopback")."""
    candidates = []
    # Um socket UDP "conectado" não manda nada: só faz o sistema escolher o endereço de saída.
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("10.255.255.255", 9))
            candidates.append(sock.getsockname()[0])
    except OSError:
        pass
    try:
        candidates += socket.gethostbyname_ex(socket.gethostname())[2]
    except OSError:
        pass
    for address in candidates:
        if is_private(address):
            return address, "privado"
    return "127.0.0.1", "loopback"


def make_certificates(name: str) -> tuple[bytes, bytes, bytes]:
    """(a autoridade, o certificado do nome, a chave dele), em PEM; os dois certificados valem 2 dias."""
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

    now = datetime.datetime.now(datetime.timezone.utc)
    start, end = now - datetime.timedelta(minutes=10), now + datetime.timedelta(days=2)

    ca_key = ec.generate_private_key(ec.SECP256R1())
    ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Autoridade da fumaca")])
    ca = (x509.CertificateBuilder().subject_name(ca_name).issuer_name(ca_name)
          .public_key(ca_key.public_key()).serial_number(x509.random_serial_number())
          .not_valid_before(start).not_valid_after(end)
          .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
          .add_extension(x509.KeyUsage(digital_signature=True, content_commitment=False, key_encipherment=False,
                                       data_encipherment=False, key_agreement=False, key_cert_sign=True,
                                       crl_sign=True, encipher_only=False, decipher_only=False), critical=True)
          .add_extension(x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()), critical=False)
          .sign(ca_key, hashes.SHA256()))

    key = ec.generate_private_key(ec.SECP256R1())
    cert = (x509.CertificateBuilder()
            .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, name)])).issuer_name(ca_name)
            .public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(start).not_valid_after(end)
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(x509.SubjectAlternativeName([x509.DNSName(name)]), critical=False)
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
            .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
            .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
            .sign(ca_key, hashes.SHA256()))

    pem = serialization.Encoding.PEM
    key_pem = key.private_bytes(pem, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    return ca.public_bytes(pem), cert.public_bytes(pem), key_pem


def thumbprint(cert_pem: bytes) -> str:
    """O SHA-1 do certificado, 40 hexadecimais maiúsculos (o que o certutil mostra)."""
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes

    return x509.load_pem_x509_certificate(cert_pem).fingerprint(hashes.SHA1()).hex().upper()


class TlsFront:
    """TLS em (host, port) -> TCP no 127.0.0.1:target_port. O aperto de mão TLS é feito na thread de cada conexão."""

    def __init__(self, host: str, port: int, target_port: int, cert_pem: bytes, key_pem: bytes):
        self.host = host
        self.port = port
        self.target_port = target_port
        self.connections = 0
        self._cert_pem, self._key_pem = cert_pem, key_pem
        self._lock = threading.Lock()
        self._stopped = threading.Event()
        self._listener = None
        self._context = None
        self._open = set()

    def start(self) -> None:
        # O load_cert_chain só lê arquivos: uma pasta temporária, apagada logo depois (a chave não fica no disco).
        with tempfile.TemporaryDirectory() as folder:
            cert_file, key_file = os.path.join(folder, "cert.pem"), os.path.join(folder, "key.pem")
            with open(cert_file, "wb") as f:
                f.write(self._cert_pem)
            with open(key_file, "wb") as f:
                f.write(self._key_pem)
            self._context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            self._context.load_cert_chain(cert_file, key_file)
        self._listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._listener.bind((self.host, self.port))
        self._listener.listen(32)
        self._listener.settimeout(0.2)
        self.port = self._listener.getsockname()[1]
        threading.Thread(target=self._accept_loop, daemon=True).start()

    def stop(self) -> None:
        self._stopped.set()
        if self._listener is not None:
            self._listener.close()
        with self._lock:
            sockets = list(self._open)
        for sock in sockets:
            try:
                sock.close()
            except OSError:
                pass

    def _accept_loop(self) -> None:
        while not self._stopped.is_set():
            try:
                raw, _ = self._listener.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            threading.Thread(target=self._serve, args=(raw,), daemon=True).start()

    def _serve(self, raw: socket.socket) -> None:
        upstream = None
        try:
            raw.settimeout(10)
            tls = self._context.wrap_socket(raw, server_side=True)   # um cliente que recusa o certificado cai aqui
            with self._lock:
                self.connections += 1
                self._open.add(tls)
            raw = tls
            upstream = socket.create_connection(("127.0.0.1", self.target_port), timeout=10)
            with self._lock:
                self._open.add(upstream)
            tls.settimeout(None)
            upstream.settimeout(None)
            back = threading.Thread(target=self._pump, args=(upstream, tls), daemon=True)
            back.start()
            self._pump(tls, upstream)
            back.join()
        except (OSError, ssl.SSLError):
            pass
        finally:
            for sock in (raw, upstream):
                if sock is not None:
                    with self._lock:
                        self._open.discard(sock)
                    try:
                        sock.close()
                    except OSError:
                        pass

    @staticmethod
    def _pump(source, sink) -> None:
        try:
            while True:
                data = source.recv(65536)
                if not data:
                    break
                sink.sendall(data)
        except (OSError, ssl.SSLError):
            pass
        # Fecha o outro lado para a outra direção terminar.
        for sock in (source, sink):
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except (OSError, ssl.SSLError):
                pass


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class LocalChat:
    """O programa do chat em modo de teste (servir --teste), numa porta livre do 127.0.0.1, guiado pelas páginas de
    administração e pela API."""

    def __init__(self, binary, data_dir, origins: list[str]):
        self.binary = str(binary)
        self.data_dir = str(data_dir)
        self.origins = list(origins)
        self.port = 0
        self.log_file = os.path.join(self.data_dir, "chat.log")
        self._data = os.path.join(self.data_dir, "dados")
        self._password = secrets.token_urlsafe(24)
        self._process = None
        self._log = None
        self._cookies = {}
        self._signed_in = False

    # --- o programa ---------------------------------------------------------------------------------------------

    def start(self) -> None:
        os.makedirs(self._data, exist_ok=True)
        created = subprocess.run(
            [self.binary, "admin-criar", "teste", "--dados", self._data],
            input=(self._password + "\n") * 2, text=True, capture_output=True, timeout=60)
        if created.returncode != 0:
            raise RuntimeError("o admin-criar falhou (status %d)" % created.returncode)
        self.port = _free_port()
        command = [self.binary, "servir", "--teste", "--escutar", "127.0.0.1:%d" % self.port, "--dados", self._data]
        for origin in self.origins:
            command += ["--origem", origin]
        self._log = open(self.log_file, "wb")
        self._process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=self._log, stderr=subprocess.STDOUT)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if self._process.poll() is not None:
                raise RuntimeError("o chat saiu ao subir (status %d)" % self._process.returncode)
            try:
                if self._request("GET", "/admin/entrar")[0] == 200:
                    return
            except OSError:
                pass
            time.sleep(0.1)
        self.stop()
        raise RuntimeError("o chat não subiu em 30 s")

    def stop(self) -> None:
        if self._process is not None:
            self._process.terminate()
            try:
                self._process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self._process.kill()
                self._process.wait()
            self._process = None
        if self._log is not None:
            self._log.close()
            self._log = None

    # --- os pedidos: direto ao 127.0.0.1, sem proxy, sem seguir redirecionamento ---------------------------------

    def _request(self, method, path, body=None, headers=None):
        """(status, cabeçalhos, corpo em bytes). O http.client nunca olha as variáveis de proxy."""
        headers = dict(headers or {})
        if self._cookies:
            headers["Cookie"] = "; ".join("%s=%s" % pair for pair in self._cookies.items())
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        try:
            conn.request(method, path, body=body, headers=headers)
            response = conn.getresponse()
            data = response.read()
            for line in response.msg.get_all("Set-Cookie") or []:
                pair, *attributes = [part.strip() for part in line.split(";")]
                name, _, value = pair.partition("=")
                gone = value == "" or any(re.fullmatch(r"max-age=(0|-\d+)", a, re.I) for a in attributes)
                if gone:
                    self._cookies.pop(name, None)
                else:
                    self._cookies[name] = value
            return response.status, response, data
        finally:
            conn.close()

    def _form_page(self, path):
        status, _, data = self._request("GET", path)
        match = re.search(r'name="csrf" value="([^"]+)"', data.decode("utf-8", errors="replace"))
        if not match:
            raise RuntimeError("a página %s veio sem o csrf (status %d)" % (path, status))
        return match.group(1)

    def _admin_form(self, page, action, fields):
        """O POST de um formulário da administração, com o csrf da página. (status, Location, corpo)."""
        if not self._signed_in:
            csrf = self._form_page("/admin/entrar")
            status, _, _ = self._post_form("/admin/entrar", {"csrf": csrf, "usuario": "teste", "senha": self._password})
            if status != 303:
                raise RuntimeError("a entrada na administração respondeu %d" % status)
            self._signed_in = True
        csrf = self._form_page(page)
        status, response, data = self._post_form(action, dict(csrf=csrf, **fields))
        return status, response.getheader("Location") or "", data.decode("utf-8", errors="replace")

    def _post_form(self, path, fields):
        return self._request("POST", path, body=urllib.parse.urlencode(fields).encode("ascii"),
                             headers={"Content-Type": "application/x-www-form-urlencoded"})

    def _api(self, path, payload=None, key=None, expected=200):
        headers = {"Content-Type": "application/json"} if payload is not None else {}
        if key:
            headers["Authorization"] = "Bearer " + key
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        # A API não usa os cookies da administração.
        cookies, self._cookies = self._cookies, {}
        try:
            status, _, data = self._request("POST", path, body=body, headers=headers)
        finally:
            self._cookies = cookies
        try:
            answer = json.loads(data) if data else {}
        except ValueError:
            answer = {}
        if status != expected:
            # Só o status e o código do erro: nunca o corpo do pedido.
            error = answer.get("erro") if isinstance(answer, dict) else None
            raise RuntimeError("a API respondeu %d%s" % (status, " (%s)" % error if isinstance(error, str) else ""))
        return answer

    # --- o que a fumaça faz ------------------------------------------------------------------------------------

    def company_with_meetings(self, name: str) -> str:
        status, location, _ = self._admin_form("/admin/empresas/nova", "/admin/empresas", {"nome": name})
        found = re.fullmatch(r"/admin/empresas/(\d+)", location)
        if status != 303 or not found:
            raise RuntimeError("criar a empresa respondeu %d" % status)
        company_id = found.group(1)
        status, _, _ = self._admin_form("/admin/reunioes", "/admin/reunioes/empresas/" + company_id, {"liberar": "1"})
        if status != 303:
            raise RuntimeError("liberar as reuniões da empresa respondeu %d" % status)
        page = self._request("GET", "/admin/empresas/" + company_id)[2].decode("utf-8", errors="replace")
        code = re.search(r"STAR-[A-Z0-9]{4}-[A-Z0-9]{4}", page)
        if not code:
            raise RuntimeError("a página da empresa não mostra o código")
        return code.group(0)

    def link_computer(self, code: str, computer: str) -> str:
        answer = self._api("/api/v1/computadores", {"codigo": code, "computador": computer}, expected=201)
        return answer["chave"]

    def enter_person(self, key: str, ramal: str, name: str) -> None:
        self._api("/api/v1/pessoas/eu", {"ramal": ramal, "nome": name}, key=key)

    def schedule_meeting(self, key: str, subject: str) -> str:
        """Começa daqui a 1 h e vale até 2 h depois do início."""
        start = int((time.time() + 3600) * 1000)
        answer = self._api("/api/v1/reunioes", {"assunto": subject, "inicio": start, "valeAte": start + 2 * 3600 * 1000},
                           key=key, expected=201)
        return answer["reuniao"]["codigo"]

    def meeting_pass(self, key: str, code: str) -> str:
        return self._api("/api/v1/reunioes/%s/passe" % code, key=key)["passe"]

    def open_as_colleague(self, code: str, meeting_pass: str) -> dict:
        return self._api("/api/v1/pagina/reunioes/" + code, {"passe": meeting_pass})
