#!/usr/bin/env python3
"""Registrador SIP falso para os testes de fumaça (só UDP, só REGISTER com Digest MD5 sem qop).

- REGISTER sem Authorization -> 401 com WWW-Authenticate: Digest realm="ci", nonce, algorithm=MD5
- REGISTER com Authorization -> 200 OK (Expires e Contact ecoados) se usuário e senha conferem,
  senão 403
- OPTIONS e outros pedidos -> 200 OK; ACK -> nada
- grava o último User-Agent de REGISTER no arquivo de --log

Uso: fake_registrar.py [--host 127.0.0.1] [--port 5060] --user 2001 --password senha-certa --log ua.txt
"""
import argparse
import hashlib
import pathlib
import re
import secrets
import socket
import sys

COMPACT = {"v": "via", "f": "from", "t": "to", "i": "call-id", "m": "contact", "l": "content-length"}
REASONS = {200: "OK", 401: "Unauthorized", 403: "Forbidden"}


def _md5(text):
    return hashlib.md5(text.encode("utf-8")).hexdigest()


def digest_response(username, realm, password, method, uri, nonce, qop=None, nc=None, cnonce=None):
    """Resposta Digest MD5 (RFC 2617); sem qop quando qop é None."""
    ha1 = _md5("%s:%s:%s" % (username, realm, password))
    ha2 = _md5("%s:%s" % (method, uri))
    if qop:
        return _md5(":".join((ha1, nonce, nc, cnonce, qop, ha2)))
    return _md5(":".join((ha1, nonce, ha2)))


def _parse(data):
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return None
    head = text.split("\r\n\r\n", 1)[0]
    lines = head.split("\r\n")
    request = re.match(r"^([A-Z]+) (\S+) SIP/2\.0$", lines[0])
    if not request:
        return None
    headers = []
    for line in lines[1:]:
        if line[:1] in (" ", "\t") and headers:
            headers[-1] = (headers[-1][0], headers[-1][1] + " " + line.strip())
            continue
        name, sep, value = line.partition(":")
        if not sep:
            continue
        name = name.strip().lower()
        headers.append((COMPACT.get(name, name), value.strip()))
    return request.group(1), headers


def _values(headers, name):
    return [value for key, value in headers if key == name]


def _digest_params(value):
    if not value.lower().startswith("digest "):
        return {}
    return {key.lower(): (quoted if quoted else bare)
            for key, quoted, bare in re.findall(r'(\w+)=(?:"([^"]*)"|([^,\s]+))', value[7:])}


class Registrar:
    def __init__(self, user, password, realm="ci", log_path=None):
        self.user = user
        self.password = password
        self.realm = realm
        self.log_path = pathlib.Path(log_path) if log_path else None
        self.nonces = set()

    def handle(self, data, source):
        """Resposta (bytes) para um pacote vindo de source=(ip, porta), ou None."""
        parsed = _parse(data)
        if not parsed:
            return None
        method, headers = parsed
        if method == "ACK":
            return None
        if method != "REGISTER":
            return self._response(200, headers, source)
        user_agent = _values(headers, "user-agent")
        if self.log_path and user_agent:
            self.log_path.write_text(user_agent[-1] + "\n", encoding="utf-8")
        authorization = _values(headers, "authorization")
        if not authorization:
            nonce = secrets.token_hex(16)
            self.nonces.add(nonce)
            challenge = 'Digest realm="%s", nonce="%s", algorithm=MD5' % (self.realm, nonce)
            return self._response(401, headers, source, [("WWW-Authenticate", challenge)])
        params = _digest_params(authorization[-1])
        expected = digest_response(self.user, self.realm, self.password, "REGISTER",
                                   params.get("uri", ""), params.get("nonce", ""))
        ok = (params.get("username") == self.user and params.get("nonce") in self.nonces
              and params.get("response", "").lower() == expected)
        if not ok:
            return self._response(403, headers, source)
        expires = (_values(headers, "expires") or ["300"])[-1]
        extra = [("Expires", expires)]
        extra += [("Contact", contact + ";expires=" + expires) for contact in _values(headers, "contact")]
        return self._response(200, headers, source, extra)

    def _response(self, code, headers, source, extra=()):
        lines = ["SIP/2.0 %d %s" % (code, REASONS.get(code, "OK"))]
        vias = _values(headers, "via")
        for index, via in enumerate(vias):
            if index == 0:
                via = re.sub(r";rport(?=;|$)", ";rport=%d" % source[1], via)
                if ";rport=" in via and ";received=" not in via:
                    via += ";received=" + source[0]
            lines.append("Via: " + via)
        for name, title in (("from", "From"), ("to", "To"), ("call-id", "Call-ID"), ("cseq", "CSeq")):
            for value in _values(headers, name):
                if name == "to" and ";tag=" not in value:
                    value += ";tag=ci"
                lines.append("%s: %s" % (title, value))
        lines += ["%s: %s" % item for item in extra]
        lines += ["Content-Length: 0", "", ""]
        return "\r\n".join(lines).encode("utf-8")


def main(argv):
    parser = argparse.ArgumentParser(description="Registrador SIP falso para testes.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5060)
    parser.add_argument("--user", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--log")
    args = parser.parse_args(argv)
    registrar = Registrar(args.user, args.password, log_path=args.log)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((args.host, args.port))
    print("registrador falso em %s:%d" % (args.host, args.port), flush=True)
    while True:
        data, source = sock.recvfrom(65535)
        response = registrar.handle(data, source)
        if response:
            sock.sendto(response, source)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
