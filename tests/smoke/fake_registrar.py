#!/usr/bin/env python3
"""Registrador SIP falso para os testes (UDP e TCP): REGISTER com Digest MD5 sem qop e, pela porta de
controle, ligações. Só biblioteca padrão do Python 3.

- REGISTER sem Authorization -> 401 com WWW-Authenticate: Digest realm="ci", nonce, algorithm=MD5
- REGISTER com Authorization -> 200 OK (Expires e Contact ecoados) se usuário e senha conferem,
  senão 403
- OPTIONS e outros pedidos -> 200 OK; ACK -> nada; CRLF soltos (keep-alive) -> nada
- grava o último User-Agent de REGISTER no arquivo de --log e o protocolo (udp ou tcp) do último
  REGISTER aceito no arquivo de --transport-log
- escuta UDP e TCP no mesmo endereço e porta; em TCP, a resposta volta na mesma conexão

Ligações (sem autenticação para INVITE, re-INVITE, REFER, BYE e CANCEL):
- INVITE do telefone: o usuário da Request-URI decide. 486, 404 e 480 -> essa resposta; outro ->
  100, 180 e 200 com SDP (PCMU, PCMA e telefone-event, os que a oferta trouxer, na porta 40000).
  Retransmissão do mesmo INVITE (UDP) repete a última resposta, sem ligação nova.
- re-INVITE -> 200 com a direção espelhada (sendonly <-> recvonly); REFER -> 202 e um NOTIFY com
  SIP/2.0 200 OK (sipfrag); BYE e CANCEL -> 200
- o registrador também liga (RING) e desliga (HANGUP): o INVITE vai ao contato do último REGISTER
  aceito do ramal, pelo mesmo transporte (UDP: o endereço de origem do REGISTER; TCP: a mesma conexão)

Porta de controle (--control-port N, TCP no mesmo --host; um comando por linha, resposta numa linha):
  RING <ramal>       INVITE de "Cliente Teste" <sip:3001@ci>          -> OK | ERR no-contact
  HANGUP <ramal>     BYE na ligação atendida, CANCEL se ainda toca     -> OK | ERR no-call
  PASSWORD <senha>   troca a senha aceita                              -> OK
  REGISTERS <ramal>  REGISTER aceitos com Expires > 0                  -> <n>
  LOG                o registro de ligações, uma linha cada, e END
  (comando desconhecido ou sem argumento -> ERR bad-command)
Registro de ligações (só em memória): inv-out <ramal> <código final>, ack-sent <ramal>,
  bye-out <ramal> <código>, bye-in <alvo>, cancel-in <alvo>, inv-in <alvo> <código>,
  reinv-in <alvo> <sendonly|sendrecv|inactive|recvonly>, refer-in <alvo> <ramal de destino>
  (<alvo> = usuário da Request-URI do pedido que o telefone mandou)

Uso: fake_registrar.py [--host 127.0.0.1] [--port 5060] --user 2001[,2002...] --password senha-certa
                       [--log ua.txt] [--transport-log transporte.txt] [--control-port 5070]
                       (os usuários da lista têm a mesma senha)
"""
import argparse
import hashlib
import pathlib
import re
import secrets
import socket
import socketserver
import sys
import threading
import traceback

COMPACT = {"v": "via", "f": "from", "t": "to", "i": "call-id", "m": "contact", "l": "content-length",
           "r": "refer-to"}
REASONS = {100: "Trying", 180: "Ringing", 200: "OK", 202: "Accepted", 401: "Unauthorized", 403: "Forbidden",
           404: "Not Found", 480: "Temporarily Unavailable", 486: "Busy Here", 487: "Request Terminated"}
CALLER = '"Cliente Teste" <sip:3001@ci>'
MEDIA_PORT = 40000   # nada escuta aqui: só a sinalização é de verdade
RTPMAP = {"0": "0 PCMU/8000", "8": "8 PCMA/8000", "101": "101 telephone-event/8000"}
DIRECTIONS = ("sendrecv", "sendonly", "recvonly", "inactive")
MIRROR = {"sendrecv": "sendrecv", "sendonly": "recvonly", "recvonly": "sendonly", "inactive": "inactive"}


def _md5(text):
    return hashlib.md5(text.encode("utf-8")).hexdigest()


def digest_response(username, realm, password, method, uri, nonce, qop=None, nc=None, cnonce=None):
    """Resposta Digest MD5 (RFC 2617); sem qop quando qop é None."""
    ha1 = _md5("%s:%s:%s" % (username, realm, password))
    ha2 = _md5("%s:%s" % (method, uri))
    if qop:
        return _md5(":".join((ha1, nonce, nc, cnonce, qop, ha2)))
    return _md5(":".join((ha1, nonce, ha2)))


class _Message:
    """Uma mensagem SIP lida: pedido (method e uri) ou resposta (status)."""

    def __init__(self, method, uri, status, headers, body):
        self.method, self.uri, self.status, self.headers, self.body = method, uri, status, headers, body

    def first(self, name):
        values = _values(self.headers, name)
        return values[0] if values else ""


def _parse(data):
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return None
    head, _, body = text.partition("\r\n\r\n")
    lines = head.split("\r\n")
    request = re.match(r"^([A-Z]+) (\S+) SIP/2\.0$", lines[0])
    response = re.match(r"^SIP/2\.0 (\d{3})(?: .*)?$", lines[0])
    if not request and not response:
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
    if request:
        return _Message(request.group(1), request.group(2), None, headers, body)
    return _Message(None, None, int(response.group(1)), headers, body)


def _values(headers, name):
    return [value for key, value in headers if key == name]


def _uri_of(value):
    """A URI de um Contact, To, From ou Refer-To: a que está entre < > ou, sem elas, até o primeiro ';'."""
    match = re.search(r"<([^>]*)>", value)
    return match.group(1) if match else value.split(";")[0].strip()


def _uri_user(uri):
    match = re.match(r"^sips?:([^@;:]*)@", uri)
    return match.group(1) if match else ""


def _uri_host(uri):
    """host[:porta] de uma URI sip:."""
    rest = re.sub(r"^sips?:", "", uri).split("@", 1)[-1]
    return re.split(r"[;?]", rest, maxsplit=1)[0]


def _media_host(hostport):
    """O endereço IPv4 para o SDP (c= e o=); 127.0.0.1 quando o servidor foi dado por nome."""
    host = hostport.rsplit(":", 1)[0]
    return host if re.match(r"^\d+\.\d+\.\d+\.\d+$", host) else "127.0.0.1"


def _branch():
    return "z9hG4bK" + secrets.token_hex(6)


def _branch_of(via):
    match = re.search(r"branch=([^;,\s]+)", via)
    return match.group(1) if match else ""


def _sdp_offer(body):
    """(formatos do primeiro m=audio, direção): sendrecv se o SDP não disser outra."""
    sections = [[]]   # o primeiro trecho é o do SDP todo (antes de qualquer m=); cada m= abre outro
    for line in body.splitlines():
        if line.startswith("m="):
            sections.append([])
        sections[-1].append(line.strip())
    audio = next((section for section in sections[1:] if section[0].startswith("m=audio ")), [])
    direction = "sendrecv"
    for line in sections[0] + audio:   # a direção do trecho de áudio vale mais que a do SDP todo
        if line[:2] == "a=" and line[2:] in DIRECTIONS:
            direction = line[2:]
    return (audio[0].split()[3:] if audio else []), direction


def _request(method, uri, transport, hostport, branch, headers, body=""):
    """Pedido SIP que o registrador manda: Via e Max-Forwards na frente, Content-Length no fim."""
    lines = ["%s %s SIP/2.0" % (method, uri),
             "Via: SIP/2.0/%s %s;rport;branch=%s" % (transport.upper(), hostport, branch), "Max-Forwards: 70"]
    lines += ["%s: %s" % item for item in headers]
    lines += ["Content-Length: %d" % len(body.encode("utf-8")), "", body]
    return "\r\n".join(lines).encode("utf-8")


def _digest_params(value):
    if not value.lower().startswith("digest "):
        return {}
    return {key.lower(): (quoted if quoted else bare)
            for key, quoted, bare in re.findall(r'(\w+)=(?:"([^"]*)"|([^,\s]+))', value[7:])}


class _Peer:
    """Por onde chegar a quem mandou uma mensagem: um endereço UDP ou a conexão TCP dele."""

    def __init__(self, transport, address, conn=None):
        self.transport, self.address, self.conn = transport, address, conn


class _Contact:
    """O contato do último REGISTER aceito de um ramal."""

    def __init__(self, peer, uri, aor, register_uri):
        self.peer, self.uri, self.aor, self.register_uri = peer, uri, aor, register_uri


class _Call:
    """Ligação que o registrador fez (RING): o INVITE que foi ao contato de um ramal.

    state: calling -> ringing -> answered -> ending -> ended; cancelling entre o CANCEL e o 487."""

    def __init__(self, ramal, contact, hostport):
        self.ramal, self.peer, self.server = ramal, contact.peer, hostport   # server: como o telefone nos enxerga
        self.call_id = "ci-" + secrets.token_hex(8)
        self.local = "%s;tag=%s" % (CALLER, secrets.token_hex(4))
        self.remote = "<%s>" % contact.aor   # sem tag até o telefone atender
        self.request_uri = contact.uri
        self.target = contact.uri            # para onde vão BYE e ACK: o Contact do 200
        self.branch = _branch()
        self.cseq = 1
        self.state = "calling"
        self.final = None                    # código da resposta final ao INVITE


class Registrar:
    def __init__(self, user, password, realm="ci", log_path=None, transport_log_path=None):
        self.users = set(user.split(","))   # "2001,2002": todos com a mesma senha
        self.password = password
        self.realm = realm
        self.log_path = pathlib.Path(log_path) if log_path else None
        self.transport_log_path = pathlib.Path(transport_log_path) if transport_log_path else None
        self.nonces = set()
        # O laço UDP, as conexões TCP e a porta de controle mexem no mesmo estado: tudo sob este lock.
        self.lock = threading.RLock()
        self.udp = None          # o socket UDP: por onde sai o que o registrador manda por conta própria
        self.contacts = {}       # ramal -> _Contact
        self.registers = {}      # ramal -> REGISTER aceitos com Expires > 0
        self.calls = []          # as ligações do RING
        self.answers = {}        # INVITE já respondido (Call-ID, CSeq, branch) -> respostas a repetir
        self.notifies = {}       # Call-ID -> CSeq do último NOTIFY mandado
        self.events = []         # o registro de ligações (LOG)
        self.sdp_version = 0

    def handle(self, data, source, transport="udp", conn=None):
        """Primeira resposta (bytes) para uma mensagem vinda de source=(ip, porta) por transport, ou None."""
        messages = self.dispatch(data, source, transport, conn)
        return messages[0] if messages else None

    def process(self, data, source, transport="udp", conn=None):
        """Trata uma mensagem recebida e já manda a quem a enviou tudo o que ela pede, em ordem."""
        try:
            with self.lock:
                peer = _Peer(transport, source, conn)
                for message in self.dispatch(data, source, transport, conn):
                    self._send(peer, message)
        except Exception:   # um defeito aqui não pode derrubar o registrador no meio de uma bateria de testes
            traceback.print_exc()

    def dispatch(self, data, source, transport="udp", conn=None):
        """As mensagens (bytes) que respondem a uma recebida de source, na ordem em que devem sair."""
        msg = _parse(data)
        if not msg:
            return []
        peer = _Peer(transport, source, conn)
        with self.lock:
            if msg.status is not None:
                return self._on_response(msg, peer)
            if msg.method == "ACK":
                return []
            handler = {"REGISTER": self._on_register, "INVITE": self._on_invite, "REFER": self._on_refer,
                       "BYE": self._on_bye, "CANCEL": self._on_cancel}.get(msg.method)
            if handler:
                return handler(msg, peer)
            return [self._response(200, msg.headers, source)]

    def connection_closed(self, conn):
        """A conexão TCP acabou: os contatos que dependiam dela já não alcançam ninguém."""
        with self.lock:
            for ramal in [ramal for ramal, contact in self.contacts.items() if contact.peer.conn is conn]:
                del self.contacts[ramal]

    def _on_register(self, msg, peer):
        headers, source = msg.headers, peer.address
        user_agent = _values(headers, "user-agent")
        if self.log_path and user_agent:
            self.log_path.write_text(user_agent[-1] + "\n", encoding="utf-8")
        authorization = _values(headers, "authorization")
        if not authorization:
            nonce = secrets.token_hex(16)
            self.nonces.add(nonce)
            challenge = 'Digest realm="%s", nonce="%s", algorithm=MD5' % (self.realm, nonce)
            return [self._response(401, headers, source, [("WWW-Authenticate", challenge)])]
        params = _digest_params(authorization[-1])
        username = params.get("username", "")
        expected = digest_response(username, self.realm, self.password, "REGISTER",
                                   params.get("uri", ""), params.get("nonce", ""))
        ok = (username in self.users and params.get("nonce") in self.nonces
              and params.get("response", "").lower() == expected)
        if not ok:
            return [self._response(403, headers, source)]
        if self.transport_log_path:
            self.transport_log_path.write_text(peer.transport + "\n", encoding="utf-8")
        expires = (_values(headers, "expires") or ["300"])[-1]
        self._bind(username, msg, peer, int(expires) if expires.isdigit() else 300)
        extra = [("Expires", expires)]
        extra += [("Contact", contact + ";expires=" + expires) for contact in _values(headers, "contact")]
        return [self._response(200, headers, source, extra)]

    def _bind(self, ramal, msg, peer, seconds):
        """Guarda o contato de um REGISTER aceito (e o conta); com Expires 0 o ramal deixa de ter contato."""
        if seconds == 0:
            self.contacts.pop(ramal, None)
            return
        self.registers[ramal] = self.registers.get(ramal, 0) + 1
        contact = msg.first("contact")
        if contact:
            self.contacts[ramal] = _Contact(peer, _uri_of(contact), _uri_of(msg.first("to")), msg.uri)

    def _response(self, code, headers, source, extra=(), body=""):
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
        lines += ["Content-Length: %d" % len(body.encode("utf-8")), "", body]
        return "\r\n".join(lines).encode("utf-8")

    def _send(self, peer, data):
        """Manda data a peer. False se não deu (conexão TCP caída, ou nenhum socket UDP ligado)."""
        sock = peer.conn if peer.transport == "tcp" else self.udp
        if sock is None:
            return False
        try:
            if peer.transport == "tcp":
                sock.sendall(data)
            else:
                sock.sendto(data, peer.address)
        except OSError:
            return False
        return True

    def _log(self, line):
        self.events.append(line)

    def _hostport(self, uri, peer):
        """host:porta com que o telefone enxerga este servidor: o da Request-URI dele, com a porta
        em que o pedido chegou quando a URI não traz uma (o telefone pode ver um endereço que não é o
        do socket, como o 10.0.2.2 do emulador Android)."""
        hostport = _uri_host(uri)
        if re.search(r":\d+$", hostport):
            return hostport
        sock = peer.conn if peer.transport == "tcp" else self.udp
        return "%s:%d" % (hostport, sock.getsockname()[1] if sock else 5060)

    def _sdp(self, hostport, payloads, direction):
        self.sdp_version += 1   # cada SDP novo do diálogo sobe a versão do o=
        host = _media_host(hostport)
        lines = ["v=0", "o=- 1 %d IN IP4 %s" % (self.sdp_version, host), "s=ci", "c=IN IP4 " + host, "t=0 0",
                 "m=audio %d RTP/AVP %s" % (MEDIA_PORT, " ".join(payloads))]
        lines += ["a=rtpmap:" + RTPMAP[payload] for payload in payloads]
        if "101" in payloads:
            lines.append("a=fmtp:101 0-16")
        lines.append("a=" + direction)
        return "\r\n".join(lines) + "\r\n"

    # --- o telefone liga para o registrador (e manda re-INVITE, REFER, BYE, CANCEL) ---

    def _on_invite(self, msg, peer):
        key = (msg.first("call-id"), msg.first("cseq"), _branch_of(msg.first("via")))
        if key in self.answers:   # retransmissão do UDP: nada de ligação nova, só a última resposta de novo
            return self.answers[key]
        alvo = _uri_user(msg.uri)
        payloads, direction = _sdp_offer(msg.body)
        if ";tag=" in msg.first("to"):   # re-INVITE: o diálogo já existe
            self._log("reinv-in %s %s" % (alvo, direction))
            replies = [self._accept(msg, peer, payloads, MIRROR[direction])]
        else:
            refusal = {"486": 486, "404": 404, "480": 480}.get(alvo)
            if refusal:
                replies = [self._response(refusal, msg.headers, peer.address)]
            else:
                replies = [self._response(100, msg.headers, peer.address),
                           self._response(180, msg.headers, peer.address),
                           self._accept(msg, peer, payloads, "sendrecv")]
            self._log("inv-in %s %d" % (alvo, refusal or 200))
        self.answers[key] = replies[-1:]
        return replies

    def _accept(self, msg, peer, payloads, direction):
        """200 a um INVITE: SDP com os codecs que a oferta trouxe (de PCMU, PCMA e telefone-event)."""
        payloads = [payload for payload in RTPMAP if payload in payloads] or list(RTPMAP)
        extra = [("Contact", "<%s>" % msg.uri), ("Content-Type", "application/sdp")]   # a URI com que nos acharam
        return self._response(200, msg.headers, peer.address, extra, self._sdp(_uri_host(msg.uri), payloads, direction))

    def _on_refer(self, msg, peer):
        self._log("refer-in %s %s" % (_uri_user(msg.uri), _uri_user(_uri_of(msg.first("refer-to")))))
        return [self._response(202, msg.headers, peer.address), self._notify(msg, peer)]

    def _notify(self, refer, peer):
        """O NOTIFY que fecha a assinatura do REFER dizendo que a transferência deu certo (sipfrag)."""
        call_id = refer.first("call-id")
        self.notifies[call_id] = self.notifies.get(call_id, 0) + 1
        local = refer.first("to")   # no diálogo, o To do REFER é a nossa ponta, já com a tag
        headers = [("From", local if ";tag=" in local else local + ";tag=ci"), ("To", refer.first("from")),
                   ("Call-ID", call_id), ("CSeq", "%d NOTIFY" % self.notifies[call_id]),
                   ("Contact", "<%s>" % refer.uri), ("Event", "refer;id=" + refer.first("cseq").split()[0]),
                   ("Subscription-State", "terminated;reason=noresource"),
                   ("Content-Type", "message/sipfrag;version=2.0")]
        target = _uri_of(refer.first("contact")) or refer.uri
        return _request("NOTIFY", target, peer.transport, self._hostport(refer.uri, peer), _branch(), headers,
                        "SIP/2.0 200 OK\r\n")

    def _on_bye(self, msg, peer):
        self._log("bye-in " + _uri_user(msg.uri))
        for call in self.calls:   # o telefone desligou uma ligação que o RING fez
            if call.call_id == msg.first("call-id"):
                call.state = "ended"
        return [self._response(200, msg.headers, peer.address)]

    def _on_cancel(self, msg, peer):
        self._log("cancel-in " + _uri_user(msg.uri))
        return [self._response(200, msg.headers, peer.address)]

    # --- o registrador liga para o telefone (RING) e desliga (HANGUP) ---

    def _ring(self, ramal):
        contact = self.contacts.get(ramal)
        if not contact:
            return "ERR no-contact"
        call = _Call(ramal, contact, self._hostport(contact.register_uri, contact.peer))
        ours = "sip:3001@%s%s" % (call.server, ";transport=tcp" if contact.peer.transport == "tcp" else "")
        headers = [("From", call.local), ("To", call.remote), ("Call-ID", call.call_id), ("CSeq", "1 INVITE"),
                   ("Contact", "<%s>" % ours), ("Content-Type", "application/sdp")]
        offer = self._sdp(call.server, list(RTPMAP), "sendrecv")
        self.calls.append(call)   # antes de mandar: a resposta pode chegar antes de este método voltar
        if not self._send(contact.peer, _request("INVITE", contact.uri, contact.peer.transport, call.server,
                                                 call.branch, headers, offer)):
            self.calls.remove(call)
            del self.contacts[ramal]   # a conexão TCP caiu
            return "ERR no-contact"
        return "OK"

    def _hangup(self, ramal):
        live = [call for call in self.calls if call.ramal == ramal and call.state in ("calling", "ringing", "answered")]
        if not live:
            return "ERR no-call"
        call = live[-1]
        if call.state == "answered":
            message = self._bye(call)
        else:   # ainda tocando: CANCEL, com o branch do INVITE; o 487 que vem depois é respondido com ACK
            call.state = "cancelling"
            message = self._call_request(call, "CANCEL", call.request_uri, call.cseq, call.remote, False)
        return "OK" if self._send(call.peer, message) else "ERR no-call"

    def _bye(self, call):
        call.cseq += 1
        call.state = "ending"
        return self._call_request(call, "BYE", call.target, call.cseq, call.remote, True)

    def _call_request(self, call, method, uri, cseq, to, new_branch, body=""):
        """Pedido dentro da ligação do RING. Com new_branch=False repete o branch do INVITE: é o que o
        CANCEL e o ACK de uma resposta final que não é 2xx precisam (a mesma transação)."""
        headers = [("From", call.local), ("To", to), ("Call-ID", call.call_id), ("CSeq", "%d %s" % (cseq, method))]
        return _request(method, uri, call.peer.transport, call.server, _branch() if new_branch else call.branch,
                        headers, body)

    def _on_response(self, msg, peer):
        """Resposta do telefone a um pedido do registrador (INVITE, CANCEL, BYE, NOTIFY)."""
        call_id, cseq = msg.first("call-id"), msg.first("cseq").split()
        call = next((call for call in reversed(self.calls) if call.call_id == call_id), None)
        if not call or len(cseq) != 2:
            return []
        if cseq[1] == "INVITE":
            return self._on_invite_response(call, msg)
        if cseq[1] == "BYE" and msg.status >= 200 and call.state != "ended":
            call.state = "ended"
            self._log("bye-out %s %d" % (call.ramal, msg.status))
        return []

    def _on_invite_response(self, call, msg):
        code, to = msg.status, msg.first("to")
        if code < 200:
            if code > 100 and call.state == "calling":
                call.state = "ringing"
            return []
        first = call.final is None   # o 200 volta a chegar (UDP) enquanto o ACK não chega: outro ACK, sem registro
        if first:
            call.final = code
            self._log("inv-out %s %d" % (call.ramal, code))
        if code >= 300:   # ACK da resposta final que não é 2xx: na mesma transação, repete o branch do INVITE
            call.state = "ended"
            return [self._call_request(call, "ACK", call.request_uri, call.cseq, to, False)]
        contact = msg.first("contact")
        call.target = _uri_of(contact) if contact else call.request_uri
        call.remote = to
        replies = [self._call_request(call, "ACK", call.target, call.cseq, to, True)]   # ACK do 2xx: pedido novo
        if first:
            self._log("ack-sent " + call.ramal)
            if call.state == "cancelling":   # o CANCEL perdeu a corrida para o 200: desliga em seguida
                replies.append(self._bye(call))
            else:
                call.state = "answered"
        return replies

    # --- porta de controle ---

    def command(self, line):
        """Executa um comando da porta de controle; devolve as linhas da resposta."""
        name, _, argument = line.rstrip("\r\n").partition(" ")
        name, ramal = name.upper(), argument.strip()
        with self.lock:
            if name == "RING" and ramal:
                return [self._ring(ramal)]
            if name == "HANGUP" and ramal:
                return [self._hangup(ramal)]
            if name == "PASSWORD" and ramal:
                self.password = argument   # a senha inteira, com os espaços que tiver
                return ["OK"]
            if name == "REGISTERS" and ramal:
                return [str(self.registers.get(ramal, 0))]
            if name == "LOG" and not ramal:
                return self.events + ["END"]
        return ["ERR bad-command"]


def split_messages(buffer):
    """Mensagens SIP completas de um fluxo TCP, separadas pelo Content-Length (ou l:), e o resto.

    Os \r\n soltos entre mensagens (pings de keepalive) são descartados.
    """
    messages = []
    while True:
        buffer = buffer.lstrip(b"\r\n")
        end = buffer.find(b"\r\n\r\n")
        if end < 0:
            return messages, buffer
        length = 0
        for line in buffer[:end].decode("utf-8", "replace").split("\r\n")[1:]:
            name, sep, value = line.partition(":")
            if sep and name.strip().lower() in ("content-length", "l"):
                try:
                    length = int(value.strip())
                except ValueError:
                    length = 0
        total = end + 4 + length
        if len(buffer) < total:
            return messages, buffer
        messages.append(buffer[:total])
        buffer = buffer[total:]


class _SipTcpHandler(socketserver.BaseRequestHandler):
    def handle(self):
        registrar = self.server.registrar
        buffer = b""
        try:
            while True:
                try:
                    chunk = self.request.recv(65535)
                except OSError:
                    return
                if not chunk:
                    return
                messages, buffer = split_messages(buffer + chunk)
                for message in messages:
                    registrar.process(message, self.client_address, "tcp", self.request)
        finally:
            registrar.connection_closed(self.request)


class _ControlHandler(socketserver.StreamRequestHandler):
    """Porta de controle: um comando por linha, a resposta de volta em uma ou mais linhas."""

    def handle(self):
        try:
            for raw in self.rfile:
                line = raw.decode("utf-8", "replace").rstrip("\r\n")
                if line.strip():
                    reply = "".join(text + "\n" for text in self.server.registrar.command(line))
                    self.wfile.write(reply.encode("utf-8"))
        except OSError:
            return


class _SipTcpServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def _start_tcp(handler, registrar, host, port):
    server = _SipTcpServer((host, port), handler)
    server.registrar = registrar
    # poll_interval curto: o shutdown() espera por ele, e os testes sobem e derrubam o servidor o tempo todo
    threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()
    return server


def start_tcp_server(registrar, host, port):
    """Lado TCP do registrador, numa thread; cada conexão tem a sua. Devolve o servidor
    (server_address traz a porta usada; porta 0 = o sistema escolhe)."""
    return _start_tcp(_SipTcpHandler, registrar, host, port)


def start_control_server(registrar, host, port):
    """Porta de controle (RING, HANGUP, PASSWORD, REGISTERS, LOG), numa thread. Mesma forma de
    start_tcp_server."""
    return _start_tcp(_ControlHandler, registrar, host, port)


class _UdpServer:
    """Lado UDP do registrador, com a forma dos servidores do socketserver (server_address, shutdown,
    server_close). Liga o socket ao Registrar, que o usa para mandar INVITE, BYE e CANCEL."""

    def __init__(self, registrar, host, port):
        self.registrar = registrar
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind((host, port))
        self.sock.settimeout(0.1)   # acorda de tempos em tempos para ver se pediram para parar
        self.server_address = self.sock.getsockname()
        self._stopped = threading.Event()
        self._thread = None
        registrar.udp = self.sock

    def serve_forever(self):
        while not self._stopped.is_set():
            try:
                data, source = self.sock.recvfrom(65535)
            except socket.timeout:
                continue
            except ConnectionResetError:   # o Windows avisa assim que um UDP nosso não achou ninguém
                continue
            except OSError:
                if self._stopped.is_set() or self.sock.fileno() == -1:   # fechado de propósito
                    return
                raise
            self.registrar.process(data, source)

    def start(self):
        self._thread = threading.Thread(target=self.serve_forever, daemon=True)
        self._thread.start()
        return self

    def shutdown(self):
        self._stopped.set()
        if self._thread:
            self._thread.join()

    def server_close(self):
        self.sock.close()


def start_udp_server(registrar, host, port):
    """Lado UDP do registrador, numa thread. Devolve o servidor (porta 0 = o sistema escolhe)."""
    return _UdpServer(registrar, host, port).start()


def main(argv):
    parser = argparse.ArgumentParser(description="Registrador SIP falso para testes.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5060)
    parser.add_argument("--user", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--log")
    parser.add_argument("--transport-log")
    parser.add_argument("--control-port", type=int, help="porta TCP (no mesmo --host) dos comandos RING, HANGUP...")
    args = parser.parse_args(argv)
    registrar = Registrar(args.user, args.password, log_path=args.log, transport_log_path=args.transport_log)
    udp = _UdpServer(registrar, args.host, args.port)   # antes dos outros: o que chegar já fica na fila do socket
    start_tcp_server(registrar, args.host, args.port)
    ready = "registrador falso em %s:%d (UDP e TCP)" % (args.host, args.port)
    if args.control_port is not None:
        start_control_server(registrar, args.host, args.control_port)
        ready += ", controle em %s:%d" % (args.host, args.control_port)
    print(ready, flush=True)
    udp.serve_forever()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
