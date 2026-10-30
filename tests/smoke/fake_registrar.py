#!/usr/bin/env python3
"""Registrador SIP falso para os testes (UDP e TCP): REGISTER com Digest MD5 sem qop e, pela porta de
controle, ligações. Só biblioteca padrão do Python 3.

- REGISTER sem Authorization -> 401 com WWW-Authenticate: Digest realm="ci", nonce, algorithm=MD5
- REGISTER com Authorization -> 200 OK (Expires e Contact ecoados) se usuário e senha conferem,
  senão 403; com o FAIL REGISTER on, todo REGISTER -> 503 (a central fora do ar ou reiniciando)
- OPTIONS e outros pedidos -> 200 OK; ACK -> nada; CRLF soltos (keep-alive) -> nada, só contados (KEEPALIVES)
- grava o último User-Agent de REGISTER no arquivo de --log e o protocolo (udp ou tcp) do último
  REGISTER aceito no arquivo de --transport-log
- guarda o último REGISTER aceito com Expires > 0 de cada ramal, para os comandos CONTACT e HEADER
- escuta UDP e TCP no mesmo endereço e porta; em TCP, a resposta volta na mesma conexão

Ligações (sem autenticação para INVITE, re-INVITE, REFER, BYE e CANCEL):
- INVITE do telefone: o usuário da Request-URI decide. 486, 404 e 480 -> essa resposta; outro ->
  100, 180 e 200 com SDP na porta 40000: um codec de áudio (o primeiro PCMU ou PCMA da oferta) e o
  telephone-event/8000 da oferta, no payload type e com o fmtp que ela deu (sem a=rtpmap, o 101).
  Retransmissão do mesmo INVITE (UDP) repete a última resposta, sem ligação nova.
- re-INVITE -> 200 com a direção espelhada (sendonly <-> recvonly); com o DROP REINVITE on, nada; BYE e
  CANCEL -> 200
- REFER -> 202 e um NOTIFY com SIP/2.0 200 OK (sipfrag), ou o que REFER_REPLY e REFER_NOTIFY mandarem
  (resposta com código >= 300: nenhum NOTIFY). Um Refer-To com Replaces (RFC 3891) vai para o registro
  de ligações com replaces=known ou replaces=unknown; o registrador não faz mais nada com ele
- o registrador também liga (RING) e desliga (HANGUP): o INVITE vai ao contato do último REGISTER
  aceito do ramal, pelo mesmo transporte (UDP: o endereço de origem do REGISTER; TCP: a mesma conexão)
- numa ligação do RING atendida, o registrador também manda um REFER (REFER) ou um INVITE novo que a troca
  (REPLACES, RFC 3891), como uma central que transfere; a resposta do telefone vai para o registro de ligações

BLF (RFC 4235, sem autenticação): SUBSCRIBE com Event: dialog ao ramal da Request-URI -> 200 (Expires
  ecoado, ou 600) e um NOTIFY application/dialog-info+xml com o estado de agora do ramal (sem diálogo
  nenhum até o primeiro BLF: livre); com Expires: 0 -> 200 e o NOTIFY final (terminated). O comando BLF
  muda o estado e manda um NOTIFY a cada assinatura do ramal: um diálogo por estado da lista (ids
  ci-<ramal>-1, -2...), todos num NOTIFY state="full"; <estado>@<n> muda só o diálogo n, num NOTIFY
  state="partial" só com ele. BLF <ramal> refuse: o próximo SUBSCRIBE leva
  403 e as assinaturas abertas acabam (NOTIFY terminated;reason=rejected). SUBSCRIBE de outro evento ->
  200 OK, como qualquer outro pedido. O NOTIFY vai ao Contact do SUBSCRIBE, pelo mesmo transporte.

Porta de controle (--control-port N, TCP no mesmo --host; um comando por linha, resposta numa linha):
  RING <ramal>       INVITE de "Cliente Teste" <sip:3001@ci>          -> OK | ERR no-contact
  HANGUP <ramal>     BYE na ligação atendida, CANCEL se ainda toca     -> OK | ERR no-call
  REFER <ramal> <destino>  REFER na última ligação do RING atendida do ramal, com Refer-To: <sip:<destino>@ci>
                     -> OK | ERR no-call
  REPLACES <ramal>   INVITE de "Cliente Teste" <sip:3001@ci> ao contato do ramal, com o Replaces da última ligação do
                     RING atendida dele e o Require: replaces          -> OK | ERR no-call | ERR no-contact
  PASSWORD <senha>   troca a senha aceita                              -> OK
  REGISTERS <ramal>  REGISTER aceitos com Expires > 0                  -> <n>
  CONTACT <ramal>    o cabeçalho Contact, como chegou, do último REGISTER aceito com Expires > 0
                     -> <valor> | ERR no-contact
  HEADER <ramal> <nome>  o último valor do cabeçalho <nome> (sem diferença de maiúsculas) nesse REGISTER
                     -> <valor> | ERR no-header | ERR no-contact (nenhum REGISTER aceito)
  KEEPALIVES         keep-alives recebidos: um datagrama UDP só com CR e LF, ou cada CRLFCRLF entre
                     mensagens no TCP                                  -> <n>
  EXPIRES <s>        o tempo que o 200 do REGISTER concede (s >= 1; padrão: o Expires pedido) -> OK
  BLF <ramal> <estado>[+<estado>...]  os diálogos do ramal para o BLF (estado: terminated, early ou
                     confirmed), ou refuse                                    -> OK
  BLF <ramal> <estado>@<n>  muda só o diálogo n (NOTIFY partial)              -> OK | ERR no-dialog
  FORGET             a central esquece as assinaturas de BLF, sem NOTIFY (como reiniciada) -> OK
  DROP REGISTER <on|off>  com on, os REGISTER somem sem resposta (pacote perdido) -> OK
  DROP REINVITE <on|off>  com on, os re-INVITE do telefone somem sem resposta e sem registro (pacote perdido); a
                     repetição de um deles, depois do off, é respondida -> OK
  FAIL REGISTER <on|off>  com on, todo REGISTER leva 503 (a central reiniciando)  -> OK
  REFER_REPLY <cod>  o código da resposta ao REFER (padrão 202)        -> OK
  REFER_NOTIFY <cod> o código do sipfrag do NOTIFY (padrão 200)        -> OK
  RESET              REFER_REPLY e REFER_NOTIFY voltam ao padrão       -> OK
  LOG                o registro de ligações, uma linha cada, e END
  (comando desconhecido, sem argumento ou com código que não é de 100 a 699 -> ERR bad-command)
Registro de ligações (só em memória): inv-out <ramal> <código final> (o INVITE do RING ou do REPLACES),
  ack-sent <ramal>, bye-out <ramal> <código>, refer-out <ramal> <código final> (o REFER do comando REFER),
  bye-in <alvo>, cancel-in <alvo>, inv-in <alvo> <código>,
  reinv-in <alvo> <sendonly|sendrecv|inactive|recvonly>, refer-in <alvo> <ramal de destino>
  [replaces=known|unknown], sub-in <alvo> <200|403> (SUBSCRIBE de dialog com Expires > 0, também a
  renovação), unsub-in <alvo> (SUBSCRIBE de dialog com Expires: 0), register-503 <ramal> (REGISTER que o
  FAIL REGISTER on recusou; <ramal> = usuário do From) (<alvo> = usuário da Request-URI do pedido que o
  telefone mandou; known = o Call-ID do Replaces é de uma ligação que o telefone fez ao registrador ou que
  o RING fez)

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
import urllib.parse

COMPACT = {"v": "via", "f": "from", "t": "to", "i": "call-id", "m": "contact", "l": "content-length",
           "r": "refer-to"}
REASONS = {100: "Trying", 180: "Ringing", 200: "OK", 202: "Accepted", 401: "Unauthorized", 403: "Forbidden",
           404: "Not Found", 480: "Temporarily Unavailable", 486: "Busy Here", 487: "Request Terminated",
           503: "Service Unavailable", 603: "Decline"}
SIPFRAG_PHRASES = {200: "OK", 486: "Busy Here", 603: "Decline"}   # a frase do sipfrag do NOTIFY; outro código: "Error"
STATUS_CODE = re.compile(r"[1-6][0-9]{2}")   # o que REFER_REPLY e REFER_NOTIFY aceitam
CALLER = '"Cliente Teste" <sip:3001@ci>'
MEDIA_PORT = 40000   # nada escuta aqui: só a sinalização é de verdade
RTPMAP = {"0": "PCMU/8000", "8": "PCMA/8000", "101": "telephone-event/8000"}   # o INVITE do RING oferece os três
FMTP = {"101": "0-16"}
AUDIO_CODECS = ("0", "8")   # PCMU e PCMA: o INVITE do RING oferece os dois, a resposta a um INVITE escolhe um
TELEPHONE_EVENT = "telephone-event/8000"
DIRECTIONS = ("sendrecv", "sendonly", "recvonly", "inactive")
MIRROR = {"sendrecv": "sendrecv", "sendonly": "recvonly", "recvonly": "sendonly", "inactive": "inactive"}
BLF_STATES = ("terminated", "early", "confirmed")   # os estados de diálogo que o comando BLF aceita
BLF_EXPIRES = 600   # o Expires do 200 a um SUBSCRIBE que não pede um


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


def _replaces_call_id(refer_to):
    """O Call-ID do Replaces de um Refer-To, ou None se ele não traz um. O Replaces (RFC 3891) vai como
    cabeçalho da URI (?Replaces=...), com o ; e o = escapados (%3B, %3D): o Call-ID é o que vem antes do
    primeiro ; depois de desescapar."""
    for item in _uri_of(refer_to).partition("?")[2].split("&"):
        name, _, value = item.partition("=")
        if name.lower() == "replaces":
            return urllib.parse.unquote(value).split(";")[0]
    return None


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


def _tag_of(value):
    """A tag de um From ou To ("" sem tag)."""
    match = re.search(r";tag=([^;,\s]+)", value)
    return match.group(1) if match else ""


def _sdp_offer(body):
    """(formatos do primeiro m=audio, direção, rtpmap, fmtp): direção sendrecv se o SDP não disser
    outra; rtpmap e fmtp são os a= desse trecho, por payload type."""
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
    rtpmap, fmtp = {}, {}
    for line in audio[1:]:
        for prefix, table in (("a=rtpmap:", rtpmap), ("a=fmtp:", fmtp)):
            if line.startswith(prefix):
                payload, _, value = line[len(prefix):].partition(" ")
                table[payload] = value.strip()
    return (audio[0].split()[3:] if audio else []), direction, rtpmap, fmtp


def _telephone_event(formats, rtpmap, fmtp):
    """(payload type, fmtp) do telephone-event/8000 da oferta, ou None. O PJSIP oferece um por taxa de
    relógio (120, 121...); o de 8000 Hz é o que vai com o PCMU e o PCMA. Sem a=rtpmap, o 101 vale como
    telephone-event, como no INVITE do RING."""
    for payload in formats:
        if rtpmap.get(payload, "").lower() == TELEPHONE_EVENT or (payload == "101" and payload not in rtpmap):
            return payload, fmtp.get(payload, FMTP["101"])
    return None


def _ours(payloads):
    """Os formatos do registrador para _sdp: (payload type, rtpmap, fmtp ou None)."""
    return [(payload, RTPMAP[payload], FMTP.get(payload)) for payload in payloads]


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


class _Subscription:
    """Uma assinatura de BLF (SUBSCRIBE com Event: dialog) aberta pelo telefone."""

    def __init__(self, ramal, peer, subscribe, hostport):
        self.ramal, self.peer, self.server = ramal, peer, hostport   # server: como o telefone nos enxerga
        self.call_id = subscribe.first("call-id")
        to = subscribe.first("to")
        self.local = to if ";tag=" in to else to + ";tag=ci"   # a mesma tag que o 200 levou (_response)
        self.remote = subscribe.first("from")
        self.target = _uri_of(subscribe.first("contact")) or subscribe.uri
        self.contact = subscribe.uri   # o nosso Contact: a URI com que o telefone nos achou
        self.entity = _uri_of(to)
        self.expires = BLF_EXPIRES
        self.version = 0               # o version do dialog-info, que sobe a cada NOTIFY


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
        self.last_register = {}  # ramal -> a mensagem do último REGISTER aceito com Expires > 0 (CONTACT e HEADER)
        self.keepalives = 0      # CRLF soltos que chegaram (KEEPALIVES)
        self.calls = []          # as ligações do RING
        self.answers = {}        # INVITE já respondido (Call-ID, CSeq, branch) -> respostas a repetir
        self.cseqs = {}          # Call-ID de diálogo aberto pelo telefone -> CSeq do último pedido que mandamos nele
        self.events = []         # o registro de ligações (LOG)
        self.sdp_version = 0
        self.expires = None      # EXPIRES: o tempo que o 200 do REGISTER concede (None: o pedido)
        self.blf = {}            # ramal -> estados dos diálogos (lista) ou "refuse" (sem entrada: nenhum, livre)
        self.drop_register = False   # DROP REGISTER on: os REGISTER somem sem resposta
        self.drop_reinvite = False   # DROP REINVITE on: os re-INVITE somem sem resposta
        self.fail_register = False   # FAIL REGISTER on: todo REGISTER leva 503
        self.subscriptions = {}  # Call-ID -> _Subscription (BLF)
        self._reset_refer()

    def _reset_refer(self):
        """Os padrões do REFER do telefone: resposta 202 e sipfrag 200 (REFER_REPLY, REFER_NOTIFY, RESET)."""
        self.refer_reply, self.refer_notify = 202, 200

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
        if transport == "udp" and data and not data.strip(b"\r\n"):   # keep-alive: um datagrama só com CR e LF
            self.count_keepalives(1)
            return []
        msg = _parse(data)
        if not msg:
            return []
        peer = _Peer(transport, source, conn)
        with self.lock:
            if msg.status is not None:
                return self._on_response(msg, peer)
            if msg.method == "ACK":
                return []
            if msg.method == "REGISTER" and self.drop_register:
                return []
            if msg.method == "REGISTER" and self.fail_register:
                self._log("register-503 " + _uri_user(_uri_of(msg.first("from"))))
                return [self._response(503, msg.headers, source)]
            handler = {"REGISTER": self._on_register, "INVITE": self._on_invite, "REFER": self._on_refer,
                       "BYE": self._on_bye, "CANCEL": self._on_cancel, "SUBSCRIBE": self._on_subscribe}.get(msg.method)
            if handler:
                return handler(msg, peer)
            return [self._response(200, msg.headers, source)]

    def count_keepalives(self, how_many):
        """Soma keep-alives (CRLF soltos, que não levam resposta): um por datagrama UDP, e um por CRLFCRLF
        entre mensagens no TCP (o _SipTcpHandler conta)."""
        with self.lock:
            self.keepalives += how_many

    def connection_closed(self, conn):
        """A conexão TCP acabou: os contatos que dependiam dela já não alcançam ninguém."""
        with self.lock:
            for ramal in [ramal for ramal, contact in self.contacts.items() if contact.peer.conn is conn]:
                del self.contacts[ramal]
            for call_id in [key for key, sub in self.subscriptions.items() if sub.peer.conn is conn]:
                del self.subscriptions[call_id]

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
        if self.expires and expires != "0":   # EXPIRES: o registrador concede outro tempo (a saída continua 0)
            expires = str(self.expires)
        extra = [("Expires", expires)]
        extra += [("Contact", contact + ";expires=" + expires) for contact in _values(headers, "contact")]
        return [self._response(200, headers, source, extra)]

    def _bind(self, ramal, msg, peer, seconds):
        """Guarda o contato de um REGISTER aceito (e o conta); com Expires 0 o ramal deixa de ter contato."""
        if seconds == 0:
            self.contacts.pop(ramal, None)
            return
        self.registers[ramal] = self.registers.get(ramal, 0) + 1
        self.last_register[ramal] = msg   # CONTACT e HEADER
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

    def _sdp(self, hostport, formats, direction):
        """SDP de áudio com formats = [(payload type, rtpmap, fmtp ou None)], nessa ordem."""
        self.sdp_version += 1   # cada SDP novo do diálogo sobe a versão do o=
        host = _media_host(hostport)
        lines = ["v=0", "o=- 1 %d IN IP4 %s" % (self.sdp_version, host), "s=ci", "c=IN IP4 " + host, "t=0 0",
                 "m=audio %d RTP/AVP %s" % (MEDIA_PORT, " ".join(payload for payload, _, _ in formats))]
        lines += ["a=rtpmap:%s %s" % (payload, rtpmap) for payload, rtpmap, _ in formats]
        lines += ["a=fmtp:%s %s" % (payload, fmtp) for payload, _, fmtp in formats if fmtp]
        lines.append("a=" + direction)
        return "\r\n".join(lines) + "\r\n"

    # --- o telefone liga para o registrador (e manda re-INVITE, REFER, BYE, CANCEL) ---

    def _on_invite(self, msg, peer):
        key = (msg.first("call-id"), msg.first("cseq"), _branch_of(msg.first("via")))
        if key in self.answers:   # retransmissão do UDP: nada de ligação nova, só a última resposta de novo
            return self.answers[key]
        alvo = _uri_user(msg.uri)
        offer = _sdp_offer(msg.body)
        direction = offer[1]   # (formatos, direção, rtpmap, fmtp)
        if ";tag=" in msg.first("to"):   # re-INVITE: o diálogo já existe
            if self.drop_reinvite:   # como um pacote perdido: nenhuma resposta guardada, e a repetição chega aqui
                return []
            self._log("reinv-in %s %s" % (alvo, direction))
            replies = [self._accept(msg, peer, offer, MIRROR[direction])]
        else:
            refusal = {"486": 486, "404": 404, "480": 480}.get(alvo)
            if refusal:
                replies = [self._response(refusal, msg.headers, peer.address)]
            else:
                replies = [self._response(100, msg.headers, peer.address),
                           self._response(180, msg.headers, peer.address),
                           self._accept(msg, peer, offer, "sendrecv")]
            self._log("inv-in %s %d" % (alvo, refusal or 200))
        self.answers[key] = replies[-1:]
        return replies

    def _accept(self, msg, peer, offer, direction):
        """200 a um INVITE: SDP com um codec de áudio só, o primeiro que a oferta trouxe (PCMU ou PCMA), e o
        telephone-event/8000 se ela o trouxe, no payload type dela. Com dois codecs na resposta o PJSUA manda
        um re-INVITE para travar o codec (lock_codec), e o LOG ganharia reinv-in que ninguém pediu."""
        payloads, _, rtpmap, fmtp = offer
        audio = next((payload for payload in payloads if payload in AUDIO_CODECS), None)
        if audio:
            answer = _ours([audio])
            event = _telephone_event(payloads, rtpmap, fmtp)
            if event:
                answer.append((event[0], TELEPHONE_EVENT, event[1]))
        else:   # a oferta não traz PCMU nem PCMA: como antes, os formatos nossos que ela trouxe, ou os três
            answer = _ours([payload for payload in RTPMAP if payload in payloads] or list(RTPMAP))
        extra = [("Contact", "<%s>" % msg.uri), ("Content-Type", "application/sdp")]   # a URI com que nos acharam
        return self._response(200, msg.headers, peer.address, extra, self._sdp(_uri_host(msg.uri), answer, direction))

    def _on_refer(self, msg, peer):
        refer_to = msg.first("refer-to")
        replaces = _replaces_call_id(refer_to)
        suffix = "" if replaces is None else " replaces=" + ("known" if self._known_dialog(replaces) else "unknown")
        self._log("refer-in %s %s%s" % (_uri_user(msg.uri), _uri_user(_uri_of(refer_to)), suffix))
        replies = [self._response(self.refer_reply, msg.headers, peer.address)]
        if self.refer_reply < 300:   # recusado o REFER, não há assinatura e nada de NOTIFY
            replies.append(self._notify(msg, peer))
        return replies

    def _known_dialog(self, call_id):
        """Se o diálogo é de uma ligação que o telefone fez ao registrador (INVITE respondido) ou que o RING fez."""
        return self._call_of(call_id) is not None or any(key[0] == call_id for key in self.answers)

    def _call_of(self, call_id):
        """A ligação do RING com esse Call-ID, ou None se o diálogo é de uma ligação do telefone."""
        return next((call for call in reversed(self.calls) if call.call_id == call_id), None)

    def _next_cseq(self, call_id):
        """O CSeq do próximo pedido nosso num diálogo em andamento. O PJSIP responde 500 "Invalid CSeq" a
        qualquer pedido com CSeq <= ao último que recebeu no diálogo; por isso, numa ligação do RING (o
        INVITE usou o 1 e o BYE usa o seguinte ao último pedido) a conta é a da própria ligação. Num diálogo
        aberto pelo telefone, o nosso primeiro pedido leva o 1."""
        call = self._call_of(call_id)
        if call:
            call.cseq += 1
            return call.cseq
        self.cseqs[call_id] = self.cseqs.get(call_id, 0) + 1
        return self.cseqs[call_id]

    def _notify(self, refer, peer):
        """O NOTIFY que fecha a assinatura do REFER com o resultado da transferência (sipfrag): o código de
        REFER_NOTIFY, 200 por padrão."""
        call_id = refer.first("call-id")
        local = refer.first("to")   # no diálogo, o To do REFER é a nossa ponta, já com a tag
        headers = [("From", local if ";tag=" in local else local + ";tag=ci"), ("To", refer.first("from")),
                   ("Call-ID", call_id), ("CSeq", "%d NOTIFY" % self._next_cseq(call_id)),
                   ("Contact", "<%s>" % refer.uri), ("Event", "refer;id=" + refer.first("cseq").split()[0]),
                   ("Subscription-State", "terminated;reason=noresource"),
                   ("Content-Type", "message/sipfrag;version=2.0")]
        target = _uri_of(refer.first("contact")) or refer.uri
        return _request("NOTIFY", target, peer.transport, self._hostport(refer.uri, peer), _branch(), headers,
                        "SIP/2.0 %d %s\r\n" % (self.refer_notify, SIPFRAG_PHRASES.get(self.refer_notify, "Error")))

    def _on_bye(self, msg, peer):
        self._log("bye-in " + _uri_user(msg.uri))
        for call in self.calls:   # o telefone desligou uma ligação que o RING fez
            if call.call_id == msg.first("call-id"):
                call.state = "ended"
        return [self._response(200, msg.headers, peer.address)]

    def _on_cancel(self, msg, peer):
        self._log("cancel-in " + _uri_user(msg.uri))
        return [self._response(200, msg.headers, peer.address)]

    # --- BLF: o telefone assina o estado de um ramal (SUBSCRIBE com Event: dialog) ---

    def _on_subscribe(self, msg, peer):
        if msg.first("event").split(";")[0].strip().lower() != "dialog":
            return [self._response(200, msg.headers, peer.address)]   # como antes: qualquer pedido -> 200
        alvo = _uri_user(msg.uri)
        expires = msg.first("expires")
        seconds = int(expires) if expires.isdigit() else BLF_EXPIRES
        call_id = msg.first("call-id")
        if seconds == 0:
            self._log("unsub-in " + alvo)
            sub = self.subscriptions.pop(call_id, None) or _Subscription(alvo, peer, msg, self._hostport(msg.uri, peer))
            sub.peer = peer
            return [self._response(200, msg.headers, peer.address, [("Expires", "0")]),
                    self._blf_notify(sub, "terminated;reason=timeout")]
        if self.blf.get(alvo) == "refuse":
            self._log("sub-in %s 403" % alvo)
            self.subscriptions.pop(call_id, None)
            return [self._response(403, msg.headers, peer.address)]
        self._log("sub-in %s 200" % alvo)
        sub = self.subscriptions.get(call_id)
        if not sub:
            sub = _Subscription(alvo, peer, msg, self._hostport(msg.uri, peer))
            self.subscriptions[call_id] = sub
        sub.peer, sub.expires = peer, seconds
        extra = [("Expires", str(seconds)), ("Contact", "<%s>" % sub.contact)]
        return [self._response(200, msg.headers, peer.address, extra),
                self._blf_notify(sub, "active;expires=%d" % seconds)]

    def _blf_notify(self, sub, state, only=None):
        """O NOTIFY com o dialog-info do ramal de agora (RFC 4235): sem <dialog> enquanto nenhum BLF o mudou.
        only=n: um NOTIFY state="partial" só com o diálogo n (contado de 1)."""
        sub.version += 1
        dialogs = self.blf.get(sub.ramal)
        dialogs = dialogs if isinstance(dialogs, list) else []
        lines = ['<?xml version="1.0"?>',
                 '<dialog-info xmlns="urn:ietf:params:xml:ns:dialog-info" version="%d" state="%s" entity="%s">'
                 % (sub.version, "full" if only is None else "partial", sub.entity)]
        for number, dialog in enumerate(dialogs, 1):
            if only is None or number == only:
                lines += ['<dialog id="ci-%s-%d" direction="recipient">' % (sub.ramal, number),
                          "<state>%s</state>" % dialog, "</dialog>"]
        lines.append("</dialog-info>")
        headers = [("From", sub.local), ("To", sub.remote), ("Call-ID", sub.call_id),
                   ("CSeq", "%d NOTIFY" % self._next_cseq(sub.call_id)), ("Contact", "<%s>" % sub.contact),
                   ("Event", "dialog"), ("Subscription-State", state),
                   ("Content-Type", "application/dialog-info+xml")]
        return _request("NOTIFY", sub.target, sub.peer.transport, sub.server, _branch(), headers,
                        "\r\n".join(lines) + "\r\n")

    def _set_blf(self, ramal, spec):
        """BLF <ramal> <estados|estado@n|refuse>: guarda os diálogos e avisa cada assinatura do ramal (refuse
        acaba com elas). None se spec não é válido."""
        only = None
        if spec == "refuse":
            state = "refuse"
        elif re.fullmatch(r"[a-z]+@[1-9][0-9]*", spec):
            dialog, _, number = spec.partition("@")
            if dialog not in BLF_STATES:
                return None
            only, current = int(number), self.blf.get(ramal)
            if not isinstance(current, list) or only > len(current):
                return "ERR no-dialog"
            state = list(current)
            state[only - 1] = dialog
        else:
            state = spec.split("+")
            if not all(dialog in BLF_STATES for dialog in state):
                return None
        self.blf[ramal] = state
        for call_id, sub in list(self.subscriptions.items()):
            if sub.ramal != ramal:
                continue
            if state == "refuse":
                del self.subscriptions[call_id]
                self._send(sub.peer, self._blf_notify(sub, "terminated;reason=rejected"))
            else:
                self._send(sub.peer, self._blf_notify(sub, "active;expires=%d" % sub.expires, only))
        return "OK"

    # --- o registrador liga para o telefone (RING), desliga (HANGUP), transfere (REFER) e troca (REPLACES) ---

    def _ring(self, ramal, replaced=None):
        """O INVITE de CALLER ao contato do ramal (RING). Com replaced (a ligação do RING atendida que a nova troca,
        REPLACES), ele leva o Replaces dela, como o telefone a vê (o to-tag é a tag dele), e o Require: replaces."""
        contact = self.contacts.get(ramal)
        if not contact:
            return "ERR no-contact"
        call = _Call(ramal, contact, self._hostport(contact.register_uri, contact.peer))
        headers = [("From", call.local), ("To", call.remote), ("Call-ID", call.call_id), ("CSeq", "1 INVITE"),
                   ("Contact", "<%s>" % self._our_contact(call)), ("Content-Type", "application/sdp")]
        if replaced:
            headers += [("Replaces", "%s;to-tag=%s;from-tag=%s" % (replaced.call_id, _tag_of(replaced.remote),
                                                                  _tag_of(replaced.local))),
                        ("Require", "replaces")]
        offer = self._sdp(call.server, _ours(list(RTPMAP)), "sendrecv")
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

    def _answered(self, ramal):
        """A última ligação do RING atendida do ramal, ou None."""
        return next((call for call in reversed(self.calls) if call.ramal == ramal and call.state == "answered"), None)

    def _our_contact(self, call):
        """O nosso Contact numa ligação do RING: a URI de quem liga, com o endereço com que o telefone nos enxerga."""
        return "sip:3001@%s%s" % (call.server, ";transport=tcp" if call.peer.transport == "tcp" else "")

    def _refer(self, ramal, destino):
        """O REFER na última ligação do RING atendida do ramal, para sip:<destino>@ci (REFER); a resposta final do
        telefone vai para o registro (refer-out)."""
        call = self._answered(ramal)
        if not call:
            return "ERR no-call"
        extra = [("Contact", "<%s>" % self._our_contact(call)), ("Refer-To", "<sip:%s@ci>" % destino),
                 ("Referred-By", "<sip:3001@ci>")]
        message = self._call_request(call, "REFER", call.target, self._next_cseq(call.call_id), call.remote, True,
                                     extra)
        return "OK" if self._send(call.peer, message) else "ERR no-call"

    def _call_request(self, call, method, uri, cseq, to, new_branch, extra=(), body=""):
        """Pedido dentro da ligação do RING, com os cabeçalhos extra depois dos do diálogo. Com new_branch=False
        repete o branch do INVITE: é o que o CANCEL e o ACK de uma resposta final que não é 2xx precisam (a mesma
        transação)."""
        headers = [("From", call.local), ("To", to), ("Call-ID", call.call_id), ("CSeq", "%d %s" % (cseq, method))]
        headers += list(extra)
        return _request(method, uri, call.peer.transport, call.server, _branch() if new_branch else call.branch,
                        headers, body)

    def _on_response(self, msg, peer):
        """Resposta do telefone a um pedido do registrador (INVITE, CANCEL, BYE, REFER, NOTIFY)."""
        call, cseq = self._call_of(msg.first("call-id")), msg.first("cseq").split()
        if not call or len(cseq) != 2:
            return []
        if cseq[1] == "INVITE":
            return self._on_invite_response(call, msg)
        if cseq[1] == "BYE" and msg.status >= 200 and call.state != "ended":
            call.state = "ended"
            self._log("bye-out %s %d" % (call.ramal, msg.status))
        if cseq[1] == "REFER" and msg.status >= 200:   # o REFER do comando REFER: a ligação segue como estiver
            self._log("refer-out %s %d" % (call.ramal, msg.status))
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
            if name == "REFER" and ramal:
                target, _, destino = ramal.partition(" ")
                if destino and " " not in destino:
                    return [self._refer(target, destino)]
            if name == "REPLACES" and ramal:
                replaced = self._answered(ramal)
                return [self._ring(ramal, replaced) if replaced else "ERR no-call"]
            if name == "PASSWORD" and ramal:
                self.password = argument   # a senha inteira, com os espaços que tiver
                return ["OK"]
            if name == "REGISTERS" and ramal:
                return [str(self.registers.get(ramal, 0))]
            if name == "CONTACT" and ramal:
                register = self.last_register.get(ramal)
                return [(register and register.first("contact")) or "ERR no-contact"]
            if name == "HEADER" and ramal:
                target, _, header = ramal.partition(" ")
                if target and header and " " not in header:
                    register = self.last_register.get(target)
                    if not register:
                        return ["ERR no-contact"]
                    header = header.lower()
                    values = _values(register.headers, COMPACT.get(header, header))
                    return [values[-1] if values else "ERR no-header"]
            if name == "KEEPALIVES" and not ramal:
                return [str(self.keepalives)]
            if name == "EXPIRES" and ramal.isdigit() and int(ramal) > 0:
                self.expires = int(ramal)
                return ["OK"]
            blf = argument.split(" ")
            if name == "BLF" and len(blf) == 2 and blf[0]:
                reply = self._set_blf(blf[0], blf[1])
                if reply:
                    return [reply]
            if name == "DROP" and len(blf) == 2 and blf[0] in ("REGISTER", "REINVITE") and blf[1] in ("on", "off"):
                if blf[0] == "REGISTER":
                    self.drop_register = blf[1] == "on"
                else:
                    self.drop_reinvite = blf[1] == "on"
                return ["OK"]
            if name == "FORGET" and not ramal:
                self.subscriptions.clear()
                return ["OK"]
            if name == "FAIL" and blf[:1] == ["REGISTER"] and len(blf) == 2 and blf[1] in ("on", "off"):
                self.fail_register = blf[1] == "on"
                return ["OK"]
            if name == "REFER_REPLY" and STATUS_CODE.fullmatch(ramal):
                self.refer_reply = int(ramal)
                return ["OK"]
            if name == "REFER_NOTIFY" and STATUS_CODE.fullmatch(ramal):
                self.refer_notify = int(ramal)
                return ["OK"]
            if name == "RESET" and not ramal:
                self._reset_refer()
                return ["OK"]
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
        loose = 0   # CR e LF soltos entre mensagens que ainda não fecham um CRLFCRLF (o ping pode vir em pedaços)
        try:
            while True:
                try:
                    chunk = self.request.recv(65535)
                except OSError:
                    return
                if not chunk:
                    return
                data = buffer + chunk
                messages, buffer = split_messages(data)
                # Contado antes das mensagens: quem manda um ping e um pedido já acha o ping contado com a resposta.
                loose += len(data) - len(buffer) - sum(len(message) for message in messages)
                if loose >= 4:
                    registrar.count_keepalives(loose // 4)
                    loose %= 4
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
    """Porta de controle (RING, HANGUP, REFER, REPLACES, PASSWORD, REGISTERS, CONTACT, HEADER, KEEPALIVES, EXPIRES,
    BLF, FORGET, DROP, FAIL, REFER_REPLY, REFER_NOTIFY, RESET, LOG), numa thread. Mesma forma de start_tcp_server."""
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
