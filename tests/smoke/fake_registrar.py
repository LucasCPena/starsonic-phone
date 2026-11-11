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
- INVITE do telefone: o usuário da Request-URI decide. 486, 404 e 480 -> essa resposta; 180 -> o 100 e o 180
  e mais nada (um convidado que só toca: o CANCEL do telefone leva o 200 e o 487 do INVITE); outro ->
  100, 180 e 200 com SDP na porta 40000: um codec de áudio (o primeiro PCMU ou PCMA da oferta) e o
  telephone-event/8000 da oferta, no payload type e com o fmtp que ela deu (sem a=rtpmap, o 101).
  Retransmissão do mesmo INVITE (UDP) repete a última resposta, sem ligação nova.
- re-INVITE -> 200 com a direção espelhada (sendonly <-> recvonly); com o DROP REINVITE on, nada; BYE e
  CANCEL -> 200
- o vídeo (--video-port PORTA): a resposta a um INVITE ou re-INVITE do telefone tem um trecho m= por m= da oferta, na
  mesma ordem. O primeiro m=audio leva o áudio acima; o primeiro m=video com a porta diferente de zero vai na PORTA, com
  a primeira carga da oferta cujo nome no a=rtpmap é H264, VP8 ou VP9 (o a=rtpmap e o a=fmtp dela copiados) e a direção
  espelhada (a=sendrecv para uma oferta sendrecv); os outros vão com a porta 0 (também esse m=video, com o VIDEO REJECT
  on, sem a PORTA ou sem um desses codecs). Com o VIDEO 488 on, um INVITE ou re-INVITE com um m=video de porta diferente
  de zero leva 488. A PORTA conta os datagramas com carga (mais de 12 bytes, o cabeçalho do RTP), de qualquer ligação,
  guarda os primeiros 300 deles que chegam depois do último VIDEO PACKETS reset (ou da abertura), para o RINGVIDEO com
  o replay, conta os quadros-chave (VIDEO KEYFRAMES) e com o VIDEO ECHO on devolve cada datagrama a quem o mandou, com
  o bit mais baixo do último byte do SSRC invertido
- REFER -> 202 e um NOTIFY com SIP/2.0 200 OK (sipfrag), ou o que REFER_REPLY e REFER_NOTIFY mandarem
  (resposta com código >= 300, ou REFER_NOTIFY none: nenhum NOTIFY com o resultado). Um Refer-To com
  Replaces (RFC 3891) vai para o registro de ligações com replaces=known ou replaces=unknown; o registrador
  não faz mais nada com ele
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
  200 OK, como qualquer outro pedido (menos o que tira a assinatura de um REFER com o REFER_NOTIFY none:
  ver o comando). O NOTIFY vai ao Contact do SUBSCRIBE, pelo mesmo transporte. Com o participantes no fim do
  comando BLF, os <dialog> desse NOTIFY levam também o <local> (o ramal) e o <remote> (o Cliente Teste), como
  a central manda no tocando.

Porta de controle (--control-port N, TCP no mesmo --host; um comando por linha, resposta numa linha):
  RING <ramal>       INVITE de "Cliente Teste" <sip:3001@ci>          -> OK | ERR no-contact
  RINGVIDEO <ramal> <de> [<codecs>] [replay]  o RING com <de> como o usuário do From ("Cliente Teste" <sip:<de>@ci>)
                     e também um m=video na PORTA, com a=sendrecv e os codecs da lista (separados por vírgula; padrão
                     H264,VP8): o H264/90000 na carga 97, com o a=fmtp:97 profile-level-id=42e01f;packetization-mode=1,
                     o H264HIGH (um H264/90000 do perfil High, que a PJSIP recusa) na carga 99, com o a=fmtp:99
                     profile-level-id=64001f;packetization-mode=1, e o VP8/90000 na carga 100. Com o replay, depois da
                     resposta do telefone com SDP (o 183 ou o 200) com um m=video de porta diferente de zero, o
                     registrador manda ao endereço do vídeo dessa resposta, da PORTA e em ordem, os datagramas que a
                     PORTA guardou: os de um mesmo quadro (o mesmo timestamp do RTP) juntos, um quadro a cada 40 ms, com
                     o payload type trocado pelo do primeiro codec da oferta (o bit M fica). Ele para no fim dos
                     guardados ou no fim da ligação (o VIDEO REPLAYED conta os datagramas que ele mandou)
                     -> OK | ERR no-contact | ERR no-video (sem a PORTA)
  HANGUP <ramal>     BYE na ligação atendida, CANCEL se ainda toca     -> OK | ERR no-call
  REFER <ramal> <destino>  REFER na última ligação do RING atendida do ramal, com Refer-To: <sip:<destino>@ci>
                     -> OK | ERR no-call
  BYE <alvo>         BYE na ligação do telefone para o alvo (o convidado desliga)   -> OK | ERR no-call
  HOLD <alvo> <on|off>  re-INVITE na ligação do telefone para o alvo (o convidado põe em espera, ou retoma): o SDP
                     é o da nossa última resposta, com o o= subindo e cada m= com porta em a=sendonly (on) ou
                     a=sendrecv (off); o 2xx leva o ACK                           -> OK | ERR no-call
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
  BLF <ramal> <estados ou estado@n> participantes  o mesmo, com o <local> e o <remote> nos <dialog>
                                                                              -> OK | ERR no-dialog
  FORGET             a central esquece as assinaturas de BLF, sem NOTIFY (como reiniciada) -> OK
  DROP REGISTER <on|off>  com on, os REGISTER somem sem resposta (pacote perdido) -> OK
  DROP REINVITE <on|off>  com on, os re-INVITE do telefone somem sem resposta e sem registro (pacote perdido); a
                     repetição de um deles, depois do off, é respondida -> OK
  FAIL REGISTER <on|off>  com on, todo REGISTER leva 503 (a central reiniciando)  -> OK
  REFER_REPLY <cod>  o código da resposta ao REFER (padrão 202)        -> OK
  REFER_NOTIFY <cod> o código do sipfrag do NOTIFY (padrão 200); none: nenhum NOTIFY com o resultado, e a
                     assinatura só acaba no SUBSCRIBE com Expires: 0 do telefone, com o NOTIFY terminated
                     (sipfrag 100) que a RFC 6665 pede                 -> OK
  RESET              REFER_REPLY e REFER_NOTIFY voltam ao padrão       -> OK
  VIDEO REJECT <on|off>  com on, o m=video da resposta vai com a porta 0 -> OK
  VIDEO 488 <on|off> com on, um INVITE (ou re-INVITE) com vídeo leva 488; um sem vídeo segue como hoje -> OK
  VIDEO ECHO <on|off> com on, cada datagrama que chega na PORTA volta na hora para quem o mandou, com o SSRC trocado
                     (a contagem continua)                              -> OK
  VIDEO PACKETS      os datagramas com carga que chegaram na PORTA      -> <n>
  VIDEO PACKETS reset  zera as contagens (também as do VIDEO KEYFRAMES, do VIDEO REPLAYED e as de cada alvo) e esquece
                     os datagramas guardados -> OK
  VIDEO PACKETS <alvo>  os datagramas com carga que chegaram do endereço de vídeo da ligação desse alvo (o c= e a
                     porta do m=video da oferta do telefone, atualizados a cada re-INVITE; os datagramas
                     são reconhecidos pela porta de origem, já que o IP do c= pode não ser o de origem) -> <n>
  VIDEO KEYFRAMES <alvo>  os quadros-chave que chegaram desse endereço, contados como no VIDEO KEYFRAMES -> <n>
  VIDEO SOURCE <alvo> echo|none|color <Y> <U> <V>|default  a imagem do convidado <alvo> (o usuário da Request-URI do
                     INVITE do telefone; a ligação dele é a última atendida do telefone para ele). Vale para a
                     ligação de agora e para as próximas, e o default tira a escolha:
                     echo   devolve, só desse alvo, cada datagrama que chega do endereço de vídeo da ligação dele,
                            com o SSRC trocado, como o VIDEO ECHO
                     none   a resposta a um INVITE ou re-INVITE desse alvo leva o m=video com a porta 0
                     color  (cada valor de 16 a 235) depois do 200 com vídeo, a PORTA manda ao endereço de vídeo da
                            ligação, até o fim dela, uma imagem H.264 dessa cor: Constrained Baseline de 64x48, a 10
                            quadros por segundo, cada um com o SPS, o PPS e um IDR de macroblocos I_PCM (o SPS e o
                            PPS em pacotes de uma NAL só, o IDR em fragmentos FU-A de até 1200 bytes de carga, o
                            bit M só no último pacote do quadro), no payload type do H.264 da resposta (sem ele,
                            nada sai), com um SSRC sorteado por fluxo
                     -> OK | ERR bad-command (nome desconhecido, ou cor fora da faixa)
  VIDEO KEYFRAMES    os quadros-chave que chegaram na PORTA desde o último VIDEO PACKETS reset (ou da abertura), um por
                     quadro (o SSRC e o timestamp do RTP; um que começou antes do reset não conta de novo depois dele),
                     pelo codec do payload type nos m=video dos SDP que o telefone mandou: no H264, um IDR (a NAL do
                     tipo 5 sozinha, dentro de um STAP-A ou no primeiro fragmento de um FU-A; o SPS e o PPS antes dele
                     contam com ele); no VP8, o começo do quadro (o S e o PID 0 no descritor) com o P 0 no primeiro
                     byte do cabeçalho do quadro; outro codec não conta  -> <n>
  VIDEO REPLAYED     os datagramas que a reprodução do RINGVIDEO com o replay mandou ao telefone desde o último
                     VIDEO PACKETS reset (ou da abertura), de qualquer ligação  -> <n>
  VIDEO SDP          as linhas do último SDP que o telefone mandou (num pedido ou numa resposta), e END
  LOG                o registro de ligações, uma linha cada, e END
  (comando desconhecido, sem argumento ou com código que não é de 100 a 699 -> ERR bad-command)
Registro de ligações (só em memória): inv-out <ramal> <código final> (o INVITE do RING, do RINGVIDEO ou do REPLACES),
  sdp-out <ramal> <código> video=<sim|nao> (cada código de resposta com SDP do telefone a esse INVITE; sim = um m=video
  com a porta diferente de zero), ack-sent <ramal>, bye-out <ramal> <código> (também o BYE <alvo>, com o alvo no lugar do ramal), hold-out <alvo>
  <on|off> <código> (o re-INVITE do HOLD), refer-out <ramal> <código final> (o REFER do comando REFER), bye-in <alvo>, cancel-in <alvo>, inv-in <alvo> <código>, video-in <alvo> <nomes|nao>
  (depois do inv-in: os nomes do a=rtpmap do primeiro m=video com porta da oferta, na ordem, sem repetir e separados
  por vírgula, como H264,VP8; nao sem esse m=video), reinv-in <alvo> <sendonly|sendrecv|inactive|recvonly>,
  video-reinv <alvo> <nomes|nao> (depois do reinv-in, como o video-in), refer-in <alvo> <ramal de destino>
  [replaces=known|unknown], sub-in <alvo> <200|403> (SUBSCRIBE de dialog com Expires > 0, também a
  renovação), unsub-in <alvo> (SUBSCRIBE de dialog com Expires: 0), register-503 <ramal> (REGISTER que o
  FAIL REGISTER on recusou; <ramal> = usuário do From) (<alvo> = usuário da Request-URI do pedido que o
  telefone mandou; known = o Call-ID do Replaces é de uma ligação que o telefone fez ao registrador ou que
  o RING fez)

Uso: fake_registrar.py [--host 127.0.0.1] [--port 5060] --user 2001[,2002...] --password senha-certa
                       [--log ua.txt] [--transport-log transporte.txt] [--control-port 5070] [--video-port 40002]
                       (os usuários da lista têm a mesma senha)
"""
import argparse
import functools
import hashlib
import pathlib
import re
import secrets
import socket
import socketserver
import sys
import threading
import time
import traceback
import urllib.parse

COMPACT = {"v": "via", "f": "from", "t": "to", "i": "call-id", "m": "contact", "l": "content-length",
           "r": "refer-to"}
REASONS = {100: "Trying", 180: "Ringing", 200: "OK", 202: "Accepted", 401: "Unauthorized", 403: "Forbidden",
           404: "Not Found", 480: "Temporarily Unavailable", 486: "Busy Here", 487: "Request Terminated",
           488: "Not Acceptable Here", 503: "Service Unavailable", 603: "Decline"}
SIPFRAG_PHRASES = {100: "Trying", 200: "OK", 486: "Busy Here", 603: "Decline"}   # a do sipfrag; outro código: "Error"
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
VIDEO_CODECS = ("H264", "VP8", "VP9")   # os nomes de a=rtpmap que a resposta aceita no vídeo (o primeiro da oferta)
# Os codecs do m=video do RINGVIDEO: nome -> (payload type, rtpmap, fmtp ou None). O H264HIGH é um H.264 do perfil
# High (profile-level-id=64001f), que o telefone recusa: a PJSIP só casa o H.264 com o mesmo perfil (o dela é o
# Constrained Baseline, 42e01f), embora o nome do codec seja o mesmo. Com o packetization-mode=0 ela casaria: a
# negociação dela não compara o modo.
RING_VIDEO = {"H264": ("97", "H264/90000", "profile-level-id=42e01f;packetization-mode=1"),
              "H264HIGH": ("99", "H264/90000", "profile-level-id=64001f;packetization-mode=1"),
              "VP8": ("100", "VP8/90000", None)}
RTP_HEADER = 12   # os bytes do cabeçalho do RTP: um datagrama de vídeo com carga tem mais que isso
VIDEO_KEPT = 300   # quantos datagramas com carga a PORTA guarda para o RINGVIDEO com o replay
REPLAY_FRAME_SECONDS = 0.04   # o intervalo entre os quadros da reprodução (25 por segundo)
COLOR_RANGE = range(16, 236)   # os valores de Y, U e V que o VIDEO SOURCE color aceita
COLOR_FRAME_SECONDS = 0.1      # a imagem da cor: 10 quadros por segundo
COLOR_TIMESTAMP_STEP = 9000    # e +9000 (90 kHz) no timestamp de um quadro ao próximo
COLOR_MAX_PAYLOAD = 1200       # a carga de cada pacote do quadro: o FU-A tem 2 bytes de cabeçalho e o resto do IDR
COLOR_MACROBLOCKS = 12         # a imagem tem 64x48: 4 x 3 macroblocos de 16x16


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


def _sdp_sections(body):
    """Os trechos de um SDP: o primeiro é o do SDP todo (antes de qualquer m=); cada m= abre outro."""
    sections = [[]]
    for line in body.splitlines():
        if line.startswith("m="):
            sections.append([])
        sections[-1].append(line.strip())
    return sections


def _section(session, media):
    """(formatos, direção, rtpmap, fmtp) de um trecho m=: a direção do trecho vale mais que a do SDP todo (sendrecv se
    nenhum dos dois disser outra); rtpmap e fmtp são os a= do trecho, por payload type."""
    direction = "sendrecv"
    for line in session + media:
        if line[:2] == "a=" and line[2:] in DIRECTIONS:
            direction = line[2:]
    rtpmap, fmtp = {}, {}
    for line in media[1:]:
        for prefix, table in (("a=rtpmap:", rtpmap), ("a=fmtp:", fmtp)):
            if line.startswith(prefix):
                payload, _, value = line[len(prefix):].partition(" ")
                table[payload] = value.strip()
    return (media[0].split()[3:] if media else []), direction, rtpmap, fmtp


def _sdp_offer(body):
    """(formatos do primeiro m=audio, direção, rtpmap, fmtp), como em _section."""
    sections = _sdp_sections(body)
    audio = next((section for section in sections[1:] if section[0].startswith("m=audio ")), [])
    return _section(sections[0], audio)


def _live_video(section):
    """Se o trecho é um m=video com a porta diferente de zero."""
    fields = section[0].split()
    return len(fields) >= 4 and fields[0] == "m=video" and fields[1] != "0"


def _video_names(body):
    """Os nomes do a=rtpmap do primeiro m=video com porta, na ordem dos formatos e sem repetir; None sem esse
    m=video."""
    sections = _sdp_sections(body)
    video = next((section for section in sections[1:] if _live_video(section)), None)
    if video is None:
        return None
    formats, _, rtpmap, _ = _section(sections[0], video)
    names = []
    for payload in formats:
        name = rtpmap.get(payload, "").split("/")[0]
        if name and name not in names:
            names.append(name)
    return names


def _video_text(body):
    """O vídeo de um SDP para o registro de ligações: os nomes separados por vírgula (H264,VP8), ou nao."""
    names = _video_names(body)
    return ",".join(names) if names else "nao"


def _media_lines(kind, port, formats, direction=None):
    """As linhas de um trecho m= nosso: formats = [(payload type, rtpmap ou None, fmtp ou None)], nessa ordem."""
    lines = ["m=%s %d RTP/AVP %s" % (kind, port, " ".join(payload for payload, _, _ in formats))]
    lines += ["a=rtpmap:%s %s" % (payload, rtpmap) for payload, rtpmap, _ in formats if rtpmap]
    lines += ["a=fmtp:%s %s" % (payload, fmtp) for payload, _, fmtp in formats if fmtp]
    if direction:
        lines.append("a=" + direction)
    return lines


def _echoed(data):
    """O datagrama do VIDEO ECHO: o mesmo, com o bit mais baixo do último byte do SSRC (o byte 11) invertido."""
    if len(data) < RTP_HEADER:
        return data
    echoed = bytearray(data)
    echoed[11] ^= 1
    return bytes(echoed)


def _video_address(body):
    """(host, porta) do primeiro m=video com a porta diferente de zero de um SDP: o c= dele, ou o do SDP todo. None
    sem esse m=video ou sem c=."""
    sections = _sdp_sections(body)
    video = next((section for section in sections[1:] if _live_video(section)), None)
    if video is None:
        return None
    connection = next((line for line in video[1:] + sections[0] if line.startswith("c=IN IP4 ")), None)
    if connection is None:
        return None
    return connection.split()[2].split("/")[0], int(video[0].split()[1])


def _frames(packets):
    """Os datagramas RTP em quadros, na ordem: os seguidos com o mesmo timestamp (os bytes 4 a 7) ficam juntos."""
    frames = []
    for packet in packets:
        if frames and frames[-1][0][4:8] == packet[4:8]:
            frames[-1].append(packet)
        else:
            frames.append([packet])
    return frames


def _rtp_payload(data):
    """A carga de um datagrama RTP: o que vem depois do cabeçalho de 12 bytes, dos CSRC (o CC) e da extensão (o X), se
    há. None se o datagrama acaba antes disso."""
    if len(data) < RTP_HEADER:
        return None
    start = RTP_HEADER + 4 * (data[0] & 0x0F)
    if data[0] & 0x10:   # a extensão: 4 bytes de cabeçalho, com o tamanho dela em palavras de 4 bytes
        if len(data) < start + 4:
            return None
        start += 4 + 4 * int.from_bytes(data[start + 2:start + 4], "big")
    return data[start:] if len(data) >= start else None


def _keyframe_start(codec, payload):
    """Se a carga RTP (sem o cabeçalho) começa um quadro-chave do codec (o nome do a=rtpmap): no H264, um IDR (a NAL do
    tipo 5 sozinha, dentro de um STAP-A ou no primeiro fragmento de um FU-A; o SPS e o PPS que vêm antes dele contam com
    ele); no VP8, o começo do quadro (o S e o PID 0 no descritor) com o P 0 no primeiro byte do cabeçalho do quadro.
    Outro codec, ou uma carga cortada: False."""
    if not payload:
        return False
    if codec == "H264":
        nal_type = payload[0] & 0x1F
        if nal_type == 24:   # STAP-A: as NAL, cada uma depois do tamanho dela em 2 bytes
            at = 1
            while at + 2 < len(payload):
                size = int.from_bytes(payload[at:at + 2], "big")
                if size and payload[at + 2] & 0x1F == 5:
                    return True
                at += 2 + size
            return False
        if nal_type == 28:   # FU-A: o primeiro fragmento (o S) de uma NAL do tipo 5
            return len(payload) > 1 and payload[1] & 0x80 != 0 and payload[1] & 0x1F == 5
        return nal_type == 5
    if codec == "VP8":
        first = payload[0]
        if not first & 0x10 or first & 0x07:   # só o começo do quadro: o S, com o PID 0
            return False
        at = 1
        if first & 0x80:   # o X: o byte do I, do L, do T e do K, e os campos que eles ligam
            if len(payload) < 3:
                return False
            extension, at = payload[1], 2
            if extension & 0x80:   # o I: o PictureID, de 2 bytes com o M
                at += 2 if payload[at] & 0x80 else 1
            if extension & 0x40:   # o L: o TL0PICIDX
                at += 1
            if extension & 0x30:   # o T ou o K: o byte do TID e do KEYIDX
                at += 1
        return len(payload) > at and payload[at] & 0x01 == 0
    return False


def _video_payload_types(body):
    """Os payload types dos m=video com porta de um SDP, com o nome do a=rtpmap de cada um em maiúsculas
    (97 -> H264)."""
    sections = _sdp_sections(body)
    types = {}
    for video in (section for section in sections[1:] if _live_video(section)):
        _, _, rtpmap, _ = _section(sections[0], video)
        for payload, value in rtpmap.items():
            if payload.isdigit():
                types[int(payload)] = value.split("/")[0].upper()
    return types


def _with_payload_type(data, payload_type):
    """O datagrama RTP com outro payload type, o bit M como estava."""
    replaced = bytearray(data)
    replaced[1] = (replaced[1] & 0x80) | payload_type
    return bytes(replaced)


class _BitWriter:
    """Escreve os campos de uma NAL do H.264 (bits e Exp-Golomb) para o quadro da cor."""

    def __init__(self):
        self.data, self.pending, self.count = bytearray(), 0, 0   # os bits que ainda não fecharam um byte

    def u(self, bits, value):
        for shift in range(bits - 1, -1, -1):
            self.pending = (self.pending << 1) | ((value >> shift) & 1)
            self.count += 1
            if self.count == 8:
                self.data.append(self.pending)
                self.pending, self.count = 0, 0

    def ue(self, value):
        value += 1
        length = value.bit_length()
        self.u(length - 1, 0)
        self.u(length, value)

    def se(self, value):
        self.ue(2 * value - 1 if value > 0 else -2 * value)

    def align(self):
        """Completa o byte com zeros."""
        while self.count:
            self.u(1, 0)

    def raw(self, data):
        """Bytes inteiros: só com o alinhamento feito."""
        assert not self.count
        self.data += data

    def trailing(self):
        """O fim de uma NAL: o bit 1 e o alinhamento."""
        self.u(1, 1)
        self.align()


def _nal(kind, rbsp):
    """Uma NAL do H.264 com o nal_ref_idc 3, sem o código de início: o cabeçalho e a carga com a prevenção de
    emulação (um 0x03 antes de cada 0x00 0x00 seguido de 0x00 a 0x03)."""
    escaped, zeros = bytearray([0x60 | kind]), 0
    for byte in rbsp:
        if zeros >= 2 and byte <= 3:
            escaped.append(3)
            zeros = 0
        escaped.append(byte)
        zeros = zeros + 1 if byte == 0 else 0
    return bytes(escaped)


@functools.lru_cache(maxsize=64)
def color_frame(y, u, v, idr_pic_id=0):
    """As três NAL (SPS, PPS e IDR, sem o código de início) de um quadro H.264 Constrained Baseline de 64x48 de uma cor só
    (Y, U e V de 16 a 235): o IDR é feito de macroblocos I_PCM, sem predição nem transformada. O idr_pic_id (0 ou 1)
    é o que um IDR seguido de outro precisa mudar."""
    sps = _BitWriter()
    sps.u(8, 66)                       # profile_idc: Baseline
    sps.u(8, 0xC0)                     # constraint_set0 e constraint_set1 em 1, os outros e os bits reservados em 0
    sps.u(8, 31)                       # level_idc 3.1 (o 42e01f)
    sps.ue(0)                          # seq_parameter_set_id
    sps.ue(0)                          # log2_max_frame_num_minus4
    sps.ue(2)                          # pic_order_cnt_type
    sps.ue(1)                          # max_num_ref_frames
    sps.u(1, 0)                        # sem lacunas em frame_num
    sps.ue(64 // 16 - 1)               # a largura em macroblocos, menos 1
    sps.ue(48 // 16 - 1)               # a altura em macroblocos, menos 1
    sps.u(1, 1)                        # frame_mbs_only_flag
    sps.u(1, 1)                        # direct_8x8_inference_flag
    sps.u(1, 0)                        # sem corte
    sps.u(1, 0)                        # sem VUI
    sps.trailing()
    pps = _BitWriter()
    pps.ue(0)                          # pic_parameter_set_id
    pps.ue(0)                          # seq_parameter_set_id
    pps.u(1, 0)                        # CAVLC
    pps.u(1, 0)                        # bottom_field_pic_order_in_frame_present_flag
    pps.ue(0)                          # uma fatia por imagem (num_slice_groups_minus1)
    pps.ue(0)                          # num_ref_idx_l0_default_active_minus1
    pps.ue(0)                          # num_ref_idx_l1_default_active_minus1
    pps.u(1, 0)                        # sem predição ponderada
    pps.u(2, 0)                        # weighted_bipred_idc
    pps.se(0)                          # pic_init_qp_minus26
    pps.se(0)                          # pic_init_qs_minus26
    pps.se(0)                          # chroma_qp_index_offset
    pps.u(1, 1)                        # deblocking_filter_control_present_flag
    pps.u(1, 0)                        # constrained_intra_pred_flag
    pps.u(1, 0)                        # redundant_pic_cnt_present_flag
    pps.trailing()
    idr = _BitWriter()
    idr.ue(0)                          # first_mb_in_slice
    idr.ue(7)                          # slice_type: I
    idr.ue(0)                          # pic_parameter_set_id
    idr.u(4, 0)                        # frame_num
    idr.ue(idr_pic_id)
    idr.u(1, 0)                        # no_output_of_prior_pics_flag
    idr.u(1, 0)                        # long_term_reference_flag
    idr.se(0)                          # slice_qp_delta
    idr.ue(1)                          # disable_deblocking_filter_idc
    samples = bytes([y]) * 256 + bytes([u]) * 64 + bytes([v]) * 64
    for _ in range(COLOR_MACROBLOCKS):
        idr.ue(25)                     # mb_type: I_PCM
        idr.align()                    # pcm_alignment_zero_bit
        idr.raw(samples)
    idr.trailing()
    return _nal(7, bytes(sps.data)), _nal(8, bytes(pps.data)), _nal(5, bytes(idr.data))


def color_packets(nals, payload_type, ssrc, sequence, timestamp):
    """Os datagramas RTP de um quadro da cor (as três NAL de color_frame): o SPS e o PPS, cada um num pacote só, e o IDR
    em fragmentos FU-A de até COLOR_MAX_PAYLOAD bytes de carga. O mesmo timestamp no quadro todo, a sequência subindo
    1 por pacote a partir de `sequence` e o bit M só no último."""
    payloads = [nals[0], nals[1]]
    idr = nals[2]
    body, chunk = idr[1:], COLOR_MAX_PAYLOAD - 2
    pieces = [body[at:at + chunk] for at in range(0, len(body), chunk)]
    for index, piece in enumerate(pieces):
        flags = (0x80 if index == 0 else 0) | (0x40 if index == len(pieces) - 1 else 0) | (idr[0] & 0x1F)
        payloads.append(bytes([(idr[0] & 0x60) | 28, flags]) + piece)
    packets = []
    for index, payload in enumerate(payloads):
        marker = 0x80 if index == len(payloads) - 1 else 0
        packets.append(bytes([0x80, marker | payload_type]) + ((sequence + index) & 0xFFFF).to_bytes(2, "big") +
                       (timestamp & 0xFFFFFFFF).to_bytes(4, "big") + ssrc.to_bytes(4, "big") + payload)
    return packets


def _body_of(message):
    """O corpo (texto) de uma mensagem SIP já em bytes."""
    return message.partition(b"\r\n\r\n")[2].decode("utf-8")


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
    """Ligação que o registrador fez (RING ou RINGVIDEO): o INVITE que foi ao contato de um ramal.

    state: calling -> ringing -> answered -> ending -> ended; cancelling entre o CANCEL e o 487."""

    def __init__(self, ramal, contact, hostport, user="3001"):
        self.ramal, self.peer, self.server = ramal, contact.peer, hostport   # server: como o telefone nos enxerga
        self.user = user                     # o usuário do From: o 3001 do RING, ou o <de> do RINGVIDEO
        self.call_id = "ci-" + secrets.token_hex(8)
        self.local = '"Cliente Teste" <sip:%s@ci>;tag=%s' % (user, secrets.token_hex(4))
        self.remote = "<%s>" % contact.aor   # sem tag até o telefone atender
        self.request_uri = contact.uri
        self.target = contact.uri            # para onde vão BYE e ACK: o Contact do 200
        self.branch = _branch()
        self.cseq = 1
        self.state = "calling"
        self.final = None                    # código da resposta final ao INVITE
        self.sdp_codes = set()               # os códigos das respostas com SDP que já foram ao registro (sdp-out)
        self.replay = None                   # o RINGVIDEO com o replay: o payload type dos datagramas reproduzidos
        self.replaying = False               # a reprodução já começou (uma por ligação)


class _VideoCount:
    """Os datagramas de vídeo que chegaram do endereço de vídeo das ligações de um alvo (VIDEO PACKETS <alvo>)."""

    def __init__(self):
        self.packets = 0
        self.keyframes = 0
        self.seen = set()   # (SSRC, timestamp) dos quadros-chave já contados: fica no reset, como o do Registrar

    def add(self, data, codecs):
        """Conta um datagrama com carga; codecs: payload type -> nome do codec, do SDP do telefone."""
        self.packets += 1
        payload = _rtp_payload(data)
        key = (data[8:12], data[4:8])
        if payload and key not in self.seen and _keyframe_start(codecs.get(data[1] & 0x7F), payload):
            self.seen.add(key)
            self.keyframes += 1


class _PhoneCall:
    """Ligação que o telefone fez a um alvo e o registrador atendeu: o diálogo, para o BYE e a espera (HOLD) que o
    registrador manda, e o vídeo.

    state: answered -> ending -> ended."""

    def __init__(self, alvo, invite, peer, hostport):
        self.alvo, self.call_id = alvo, invite.first("call-id")
        self.peer, self.server = peer, hostport   # server: como o telefone nos enxerga
        to = invite.first("to")
        self.local = to if ";tag=" in to else to + ";tag=ci"   # a mesma tag que o 200 levou (_response)
        self.remote = invite.first("from")
        self.contact = "<%s>" % invite.uri   # o nosso Contact: a URI com que o telefone nos achou
        self.target = invite.uri             # para onde vão BYE e re-INVITE: o Contact do telefone
        self.state = "answered"
        self.sections = []                   # os trechos m= da nossa última resposta (as linhas de cada um)
        self.holds = {}                      # CSeq do re-INVITE do HOLD -> (on|off, branch)
        self.video_address = None            # (host, porta) do vídeo do telefone: a oferta dele; None sem vídeo
        self.codecs = {}                     # payload type -> nome do codec, dos m=video da oferta dele
        self.payload_type = None             # o do H.264 da nossa resposta (a imagem da cor); None se ela não o escolheu
        self.streaming = False               # a thread da imagem da cor está rodando


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
        self.video_port = None   # a PORTA do vídeo (start_video_server); sem ela, o vídeo é recusado (porta 0)
        self.video_sock = None   # o socket da PORTA: de onde sai a reprodução do RINGVIDEO com o replay
        self.video_packets = 0   # datagramas com carga que chegaram na PORTA (VIDEO PACKETS)
        self.video_kept = []     # os primeiros VIDEO_KEPT deles desde o último VIDEO PACKETS reset
        self.video_keyframes = 0   # quadros-chave que chegaram desde então (VIDEO KEYFRAMES)
        # (SSRC, timestamp) de cada quadro-chave que já chegou: fica no VIDEO PACKETS reset, e um quadro-chave cortado
        # por ele (as fatias de um IDR dos dois lados) não conta de novo depois
        self.video_keyframes_seen = set()
        self.video_codecs = {}   # payload type -> codec, dos m=video dos SDP do telefone (o VIDEO KEYFRAMES)
        self.video_replayed = 0   # datagramas que a reprodução mandou ao telefone desde então (VIDEO REPLAYED)
        self.video_reject = False    # VIDEO REJECT on: o m=video da resposta vai com a porta 0
        self.video_488 = False       # VIDEO 488 on: um INVITE com vídeo leva 488
        self.video_echo = False      # VIDEO ECHO on: cada datagrama da PORTA volta a quem o mandou
        self.last_sdp = None     # o último SDP que o telefone mandou (VIDEO SDP)
        self.phone_calls = {}    # Call-ID -> _PhoneCall: as ligações do telefone que atendemos
        self.guest_calls = {}    # alvo -> a última _PhoneCall atendida do telefone para ele
        self.ringing = {}        # Call-ID -> (INVITE, chave de self.answers) do alvo 180, que só toca
        self.video_sources = {}  # alvo -> ("echo",), ("none",) ou ("color", Y, U, V): o VIDEO SOURCE
        # A porta do vídeo de uma ligação do telefone -> a _PhoneCall. Só a porta: o telefone manda da porta que o m=video
        # dele diz, mas o IP do c= pode não ser o de origem (o motor dos testes publica o endereço da máquina e manda
        # ao registrador de 127.0.0.1).
        self.video_peers = {}
        self.guest_video = {}    # alvo -> _VideoCount
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

    def on_video(self, data, source, sock):
        """Um datagrama chegou na PORTA do vídeo: conta (e guarda, até VIDEO_KEPT) o que tem carga, conta o quadro-chave
        que ele começa (um por quadro: o SSRC e o timestamp), conta também no alvo da ligação de que ele vem e, com o
        VIDEO ECHO on (ou o VIDEO SOURCE <alvo> echo), o devolve na hora."""
        with self.lock:
            if len(data) > RTP_HEADER:
                self.video_packets += 1
                if len(self.video_kept) < VIDEO_KEPT:
                    self.video_kept.append(data)
                payload = _rtp_payload(data)
                key = (data[8:12], data[4:8])
                if (payload and key not in self.video_keyframes_seen
                        and _keyframe_start(self.video_codecs.get(data[1] & 0x7F), payload)):
                    self.video_keyframes_seen.add(key)
                    self.video_keyframes += 1
            call = self.video_peers.get(source[1])   # de qual ligação do telefone vem (a porta do m=video dela)
            if call is not None and len(data) > RTP_HEADER:
                self.guest_video.setdefault(call.alvo, _VideoCount()).add(data, call.codecs)
            echo = self.video_echo or (call is not None and self.video_sources.get(call.alvo) == ("echo",))
        if echo:
            try:
                sock.sendto(_echoed(data), source)
            except OSError:
                pass

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

    def _sdp(self, hostport, sections):
        """O SDP com os trechos m= dados (listas de linhas, como as de _media_lines), nessa ordem."""
        self.sdp_version += 1   # cada SDP novo do diálogo sobe a versão do o=
        host = _media_host(hostport)
        lines = ["v=0", "o=- 1 %d IN IP4 %s" % (self.sdp_version, host), "s=ci", "c=IN IP4 " + host, "t=0 0"]
        for section in sections:
            lines += section
        return "\r\n".join(lines) + "\r\n"

    def _video_answer(self, session, video, alvo=""):
        """O trecho de vídeo da resposta ao m=video (com porta) de uma oferta: na PORTA, com a primeira carga cujo nome
        no a=rtpmap é H264, VP8 ou VP9 (o a=rtpmap e o a=fmtp dela) e a direção espelhada; com a porta 0 se o VIDEO
        REJECT está on (ou o VIDEO SOURCE do alvo é none), se não há a PORTA ou se a oferta não tem um desses codecs."""
        formats, direction, rtpmap, fmtp = _section(session, video)
        chosen = next((payload for payload in formats
                       if rtpmap.get(payload, "").split("/")[0].upper() in VIDEO_CODECS), None)
        if chosen is None or self.video_reject or self.video_sources.get(alvo) == ("none",) or self.video_port is None:
            return ["m=video 0 %s %s" % (video[0].split()[2], chosen or formats[0])]
        return _media_lines("video", self.video_port, [(chosen, rtpmap[chosen], fmtp.get(chosen))], MIRROR[direction])

    def _phone_sdp(self, body):
        """Um SDP que o telefone mandou (num pedido ou numa resposta): guarda para o VIDEO SDP, e os payload types dos
        m=video dele, para o VIDEO KEYFRAMES saber o codec de cada datagrama da PORTA."""
        if body.strip():
            self.last_sdp = body
            self.video_codecs.update(_video_payload_types(body))

    # --- o telefone liga para o registrador (e manda re-INVITE, REFER, BYE, CANCEL) ---

    def _on_invite(self, msg, peer):
        key = (msg.first("call-id"), msg.first("cseq"), _branch_of(msg.first("via")))
        if key in self.answers:   # retransmissão do UDP: nada de ligação nova, só a última resposta de novo
            return self.answers[key]
        alvo = _uri_user(msg.uri)
        offer = _sdp_offer(msg.body)
        direction = offer[1]   # (formatos, direção, rtpmap, fmtp)
        self._phone_sdp(msg.body)
        video = _video_text(msg.body)
        # O VIDEO 488 on recusa o INVITE com um m=video de porta diferente de zero (também um re-INVITE).
        refuse_video = self.video_488 and _video_names(msg.body) is not None
        if ";tag=" in msg.first("to"):   # re-INVITE: o diálogo já existe
            if self.drop_reinvite:   # como um pacote perdido: nenhuma resposta guardada, e a repetição chega aqui
                return []
            self._log("reinv-in %s %s" % (alvo, direction))
            self._log("video-reinv %s %s" % (alvo, video))
            if refuse_video:
                replies = [self._response(488, msg.headers, peer.address)]
            else:
                replies = [self._accept(msg, peer, offer, MIRROR[direction])]
                self._track(alvo, msg, peer, replies[0])
        else:
            refusal = {"486": 486, "404": 404, "480": 480}.get(alvo) or (488 if refuse_video else None)
            if refusal:
                replies = [self._response(refusal, msg.headers, peer.address)]
            elif alvo == "180":   # só toca: o 100 e o 180, e a resposta final fica com o CANCEL do telefone
                replies = [self._response(100, msg.headers, peer.address),
                           self._response(180, msg.headers, peer.address)]
                self.ringing[msg.first("call-id")] = (msg, key)
            else:
                replies = [self._response(100, msg.headers, peer.address),
                           self._response(180, msg.headers, peer.address),
                           self._accept(msg, peer, offer, "sendrecv")]
                self._track(alvo, msg, peer, replies[-1])
            self._log("inv-in %s %d" % (alvo, refusal or (180 if alvo == "180" else 200)))
            self._log("video-in %s %s" % (alvo, video))
        self.answers[key] = replies[-1:]
        return replies

    def _track(self, alvo, msg, peer, answer):
        """O 200 (answer) a um INVITE ou re-INVITE do telefone: guarda a ligação do alvo (o diálogo, o nosso SDP e o vídeo
        do telefone, com o endereço da oferta dele) e, se a imagem da cor do alvo está escolhida, começa a mandá-la."""
        call = self.phone_calls.get(msg.first("call-id"))
        if call is None:
            call = self.phone_calls[msg.first("call-id")] = _PhoneCall(alvo, msg, peer, self._hostport(msg.uri, peer))
        call.peer = peer
        contact = msg.first("contact")
        call.target = _uri_of(contact) if contact else msg.uri
        self.guest_calls[alvo] = call
        sdp = _body_of(answer)
        call.sections = _sdp_sections(sdp)[1:]
        answered = _video_payload_types(sdp)   # o m=video da resposta, se ela o aceitou: um payload type só
        for port in [key for key, value in self.video_peers.items() if value is call]:
            del self.video_peers[port]
        call.video_address = _video_address(msg.body) if answered else None
        call.codecs = _video_payload_types(msg.body)
        call.payload_type = next((payload for payload, name in answered.items() if name == "H264"), None)
        if call.video_address:
            self.video_peers[call.video_address[1]] = call
        self._start_color(call)

    def _forget(self, call):
        """A ligação do telefone acabou: o vídeo dela deixa de ser contado, ecoado e mandado."""
        call.state = "ended"
        for port in [key for key, value in self.video_peers.items() if value is call]:
            del self.video_peers[port]

    def _color_of(self, call):
        """(Y, U, V) da imagem da cor que a ligação deve estar recebendo agora, ou None: a ligação ainda de pé, com o vídeo
        aceito no H.264, e o VIDEO SOURCE do alvo em color."""
        source = self.video_sources.get(call.alvo)
        if call.state == "answered" and source and source[0] == "color" and call.video_address and \
                call.payload_type is not None and self.video_sock:
            return source[1:]
        return None

    def _start_color(self, call):
        """Começa a thread da imagem da cor da ligação, se ela deve estar recebendo uma e ainda não está."""
        if not call.streaming and self._color_of(call):
            call.streaming = True
            threading.Thread(target=self._color_stream, args=(call,), daemon=True).start()

    def _color_stream(self, call):
        """A imagem da cor (numa thread): um quadro a cada COLOR_FRAME_SECONDS ao vídeo do telefone, até o fim da ligação
        ou até o VIDEO SOURCE do alvo deixar de ser color. Um SSRC sorteado por fluxo; a cor, o endereço e o payload
        type são os de cada quadro."""
        ssrc, sequence, timestamp, idr_pic_id = secrets.randbits(32), secrets.randbits(16), secrets.randbits(32), 0
        due = time.monotonic()
        while True:
            with self.lock:
                color = self._color_of(call)
                if color is None:
                    call.streaming = False
                    return
                address, payload_type = call.video_address, call.payload_type
            packets = color_packets(color_frame(*color, idr_pic_id), payload_type, ssrc, sequence, timestamp)
            try:
                for packet in packets:
                    self.video_sock.sendto(packet, address)
            except OSError:   # a PORTA fechou (o registrador saindo)
                with self.lock:
                    call.streaming = False
                return
            sequence = (sequence + len(packets)) & 0xFFFF
            timestamp = (timestamp + COLOR_TIMESTAMP_STEP) & 0xFFFFFFFF
            idr_pic_id ^= 1
            due += COLOR_FRAME_SECONDS
            time.sleep(max(0.0, due - time.monotonic()))

    def _accept(self, msg, peer, offer, direction):
        """200 a um INVITE: SDP com um codec de áudio só, o primeiro que a oferta trouxe (PCMU ou PCMA), e o
        telephone-event/8000 se ela o trouxe, no payload type dela. Com dois codecs na resposta o PJSUA manda
        um re-INVITE para travar o codec (lock_codec), e o LOG ganharia reinv-in que ninguém pediu. Um trecho por m= da
        oferta, na mesma ordem: o primeiro m=audio com esse áudio, o primeiro m=video com porta com o _video_answer, e
        os outros com a porta 0. Uma oferta sem m=audio leva só o áudio, como antes."""
        payloads, _, rtpmap, fmtp = offer
        audio = next((payload for payload in payloads if payload in AUDIO_CODECS), None)
        if audio:
            answer = _ours([audio])
            event = _telephone_event(payloads, rtpmap, fmtp)
            if event:
                answer.append((event[0], TELEPHONE_EVENT, event[1]))
        else:   # a oferta não traz PCMU nem PCMA: como antes, os formatos nossos que ela trouxe, ou os três
            answer = _ours([payload for payload in RTPMAP if payload in payloads] or list(RTPMAP))
        audio_lines = _media_lines("audio", MEDIA_PORT, answer, direction)
        offered = _sdp_sections(msg.body)
        if not any(section[0].startswith("m=audio ") for section in offered[1:]):
            sections = [audio_lines]
        else:
            sections, audio_done, video_done = [], False, False
            for section in offered[1:]:
                fields = section[0].split()
                if fields[0] == "m=audio" and not audio_done:
                    sections.append(audio_lines)
                    audio_done = True
                elif _live_video(section) and not video_done:
                    sections.append(self._video_answer(offered[0], section, _uri_user(msg.uri)))
                    video_done = True
                else:   # um trecho que a resposta recusa: o mesmo tipo, com a porta 0
                    sections.append(["%s 0 %s %s" % (fields[0], fields[2] if len(fields) > 2 else "RTP/AVP",
                                                     fields[3] if len(fields) > 3 else "0")])
        extra = [("Contact", "<%s>" % msg.uri), ("Content-Type", "application/sdp")]   # a URI com que nos acharam
        return self._response(200, msg.headers, peer.address, extra, self._sdp(_uri_host(msg.uri), sections))

    def _on_refer(self, msg, peer):
        refer_to = msg.first("refer-to")
        replaces = _replaces_call_id(refer_to)
        suffix = "" if replaces is None else " replaces=" + ("known" if self._known_dialog(replaces) else "unknown")
        self._log("refer-in %s %s%s" % (_uri_user(msg.uri), _uri_user(_uri_of(refer_to)), suffix))
        replies = [self._response(self.refer_reply, msg.headers, peer.address)]
        # Recusado o REFER, não há assinatura e nada de NOTIFY; com o REFER_NOTIFY none, também não.
        if self.refer_reply < 300 and self.refer_notify is not None:
            replies.append(self._notify(msg, peer, "refer;id=" + msg.first("cseq").split()[0], self.refer_notify))
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

    def _notify(self, request, peer, event, code):
        """O NOTIFY que fecha a assinatura de um REFER, no diálogo do pedido do telefone (o REFER, ou o SUBSCRIBE que
        tira a assinatura), com o Event dado e o sipfrag do código: o de REFER_NOTIFY, 200 por padrão, no REFER."""
        call_id = request.first("call-id")
        local = request.first("to")   # no diálogo, o To do pedido é a nossa ponta, já com a tag
        headers = [("From", local if ";tag=" in local else local + ";tag=ci"), ("To", request.first("from")),
                   ("Call-ID", call_id), ("CSeq", "%d NOTIFY" % self._next_cseq(call_id)),
                   ("Contact", "<%s>" % request.uri), ("Event", event),
                   ("Subscription-State", "terminated;reason=noresource"),
                   ("Content-Type", "message/sipfrag;version=2.0")]
        target = _uri_of(request.first("contact")) or request.uri
        return _request("NOTIFY", target, peer.transport, self._hostport(request.uri, peer), _branch(), headers,
                        "SIP/2.0 %d %s\r\n" % (code, SIPFRAG_PHRASES.get(code, "Error")))

    def _on_bye(self, msg, peer):
        self._log("bye-in " + _uri_user(msg.uri))
        for call in self.calls:   # o telefone desligou uma ligação que o RING fez
            if call.call_id == msg.first("call-id"):
                call.state = "ended"
        guest = self.phone_calls.get(msg.first("call-id"))   # ou uma que atendemos
        if guest:
            self._forget(guest)
        return [self._response(200, msg.headers, peer.address)]

    def _on_cancel(self, msg, peer):
        self._log("cancel-in " + _uri_user(msg.uri))
        replies = [self._response(200, msg.headers, peer.address)]
        pending = self.ringing.pop(msg.first("call-id"), None)   # o CANCEL de um INVITE ao 180 leva também o 487 dele
        if pending:
            invite, key = pending
            final = self._response(487, invite.headers, peer.address)
            self.answers[key] = [final]   # a retransmissão do INVITE depois do CANCEL repete o 487
            replies.append(final)
        return replies

    # --- BLF: o telefone assina o estado de um ramal (SUBSCRIBE com Event: dialog) ---

    def _on_subscribe(self, msg, peer):
        event = msg.first("event").split(";")[0].strip().lower()
        if event == "refer" and self.refer_notify is None and msg.first("expires") == "0":
            # Com o REFER_NOTIFY none, a assinatura do REFER só acaba quando o telefone a tira: o 200 e o NOTIFY
            # terminated que a RFC 6665 pede, ainda sem o resultado da transferência (100).
            return [self._response(200, msg.headers, peer.address, [("Expires", "0")]),
                    self._notify(msg, peer, msg.first("event"), 100)]
        if event != "dialog":
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

    def _blf_notify(self, sub, state, only=None, participants=False):
        """O NOTIFY com o dialog-info do ramal de agora (RFC 4235): sem <dialog> enquanto nenhum BLF o mudou.
        only=n: um NOTIFY state="partial" só com o diálogo n (contado de 1). participants: cada <dialog> leva
        também o <local> (o ramal) e o <remote> (o CALLER), antes do <state>, como a central manda."""
        sub.version += 1
        dialogs = self.blf.get(sub.ramal)
        dialogs = dialogs if isinstance(dialogs, list) else []
        lines = ['<?xml version="1.0"?>',
                 '<dialog-info xmlns="urn:ietf:params:xml:ns:dialog-info" version="%d" state="%s" entity="%s">'
                 % (sub.version, "full" if only is None else "partial", sub.entity)]
        caller = _uri_of(CALLER)
        for number, dialog in enumerate(dialogs, 1):
            if only is None or number == only:
                lines.append('<dialog id="ci-%s-%d" direction="recipient">' % (sub.ramal, number))
                if participants:
                    lines += ["<local>", "<identity>%s</identity>" % sub.entity, '<target uri="%s"/>' % sub.entity,
                              "</local>", "<remote>", "<identity>%s</identity>" % caller,
                              '<target uri="%s"/>' % caller, "</remote>"]
                lines += ["<state>%s</state>" % dialog, "</dialog>"]
        lines.append("</dialog-info>")
        headers = [("From", sub.local), ("To", sub.remote), ("Call-ID", sub.call_id),
                   ("CSeq", "%d NOTIFY" % self._next_cseq(sub.call_id)), ("Contact", "<%s>" % sub.contact),
                   ("Event", "dialog"), ("Subscription-State", state),
                   ("Content-Type", "application/dialog-info+xml")]
        return _request("NOTIFY", sub.target, sub.peer.transport, sub.server, _branch(), headers,
                        "\r\n".join(lines) + "\r\n")

    def _set_blf(self, ramal, spec, participants=False):
        """BLF <ramal> <estados|estado@n|refuse> [participantes]: guarda os diálogos e avisa cada assinatura do ramal
        (refuse acaba com elas); participants vai ao _blf_notify. None se spec não é válido (também o refuse com
        participants)."""
        only = None
        if spec == "refuse":
            if participants:
                return None
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
                self._send(sub.peer, self._blf_notify(sub, "active;expires=%d" % sub.expires, only, participants))
        return "OK"

    # --- o registrador liga para o telefone (RING), desliga (HANGUP), transfere (REFER) e troca (REPLACES) ---

    def _ring(self, ramal, replaced=None, user="3001", video=None, replay=False):
        """O INVITE de CALLER ao contato do ramal (RING). Com replaced (a ligação do RING atendida que a nova troca,
        REPLACES), ele leva o Replaces dela, como o telefone a vê (o to-tag é a tag dele), e o Require: replaces. Com
        video (RINGVIDEO: os nomes dos codecs, de RING_VIDEO), o From é o "Cliente Teste" <sip:<user>@ci> e a oferta
        também tem um m=video na PORTA, com esses codecs; com o replay, a resposta com o vídeo começa a reprodução dos
        datagramas guardados (_sdp_out)."""
        contact = self.contacts.get(ramal)
        if not contact:
            return "ERR no-contact"
        if video and self.video_port is None:
            return "ERR no-video"
        call = _Call(ramal, contact, self._hostport(contact.register_uri, contact.peer), user)
        if video and replay:
            call.replay = int(RING_VIDEO[video[0]][0])
        headers = [("From", call.local), ("To", call.remote), ("Call-ID", call.call_id), ("CSeq", "1 INVITE"),
                   ("Contact", "<%s>" % self._our_contact(call)), ("Content-Type", "application/sdp")]
        if replaced:
            headers += [("Replaces", "%s;to-tag=%s;from-tag=%s" % (replaced.call_id, _tag_of(replaced.remote),
                                                                  _tag_of(replaced.local))),
                        ("Require", "replaces")]
        sections = [_media_lines("audio", MEDIA_PORT, _ours(list(RTPMAP)), "sendrecv")]
        if video:
            sections.append(_media_lines("video", self.video_port, [RING_VIDEO[name] for name in video], "sendrecv"))
        offer = self._sdp(call.server, sections)
        self.calls.append(call)   # antes de mandar: a resposta pode chegar antes de este método voltar
        if not self._send(contact.peer, _request("INVITE", contact.uri, contact.peer.transport, call.server,
                                                 call.branch, headers, offer)):
            self.calls.remove(call)
            del self.contacts[ramal]   # a conexão TCP caiu
            return "ERR no-contact"
        return "OK"

    def _guest_call(self, alvo):
        """A ligação do telefone ao alvo que ainda está de pé (a última atendida), ou None."""
        call = self.guest_calls.get(alvo)
        return call if call and call.state == "answered" else None

    def _guest_request(self, call, method, extra=(), body=""):
        """Pedido nosso no diálogo da ligação do telefone: o From e o To dele trocados, e o CSeq seguinte do diálogo.
        (mensagem, CSeq, branch)"""
        cseq, branch = self._next_cseq(call.call_id), _branch()
        headers = [("From", call.local), ("To", call.remote), ("Call-ID", call.call_id),
                   ("CSeq", "%d %s" % (cseq, method))] + list(extra)
        return _request(method, call.target, call.peer.transport, call.server, branch, headers, body), cseq, branch

    def _guest_bye(self, alvo):
        """BYE <alvo>: o convidado desliga a ligação do telefone."""
        call = self._guest_call(alvo)
        if not call:
            return "ERR no-call"
        message = self._guest_request(call, "BYE")[0]
        call.state = "ending"   # a imagem da cor para já; o bye-out sai com a resposta do telefone
        return "OK" if self._send(call.peer, message) else "ERR no-call"

    def _guest_hold(self, alvo, state):
        """HOLD <alvo> on|off: o re-INVITE do convidado, com o nosso último SDP: cada m= com porta em a=sendonly (on) ou
        a=sendrecv (off)."""
        call = self._guest_call(alvo)
        if not call:
            return "ERR no-call"
        direction = "sendonly" if state == "on" else "sendrecv"
        sections = []
        for section in call.sections:
            if section[0].split()[1] != "0":
                section = [line for line in section if line[2:] not in DIRECTIONS or line[:2] != "a="] + ["a=" + direction]
            sections.append(section)
        message, cseq, branch = self._guest_request(
            call, "INVITE", [("Contact", call.contact), ("Content-Type", "application/sdp")],
            self._sdp(call.server, sections))
        call.holds[cseq] = (state, branch)
        if self._send(call.peer, message):
            return "OK"
        del call.holds[cseq]
        return "ERR no-call"

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
        return "sip:%s@%s%s" % (call.user, call.server, ";transport=tcp" if call.peer.transport == "tcp" else "")

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
        if len(cseq) != 2:
            return []
        if not call:   # a resposta a um pedido nosso numa ligação do telefone (BYE e HOLD)
            guest = self.phone_calls.get(msg.first("call-id"))
            return self._on_guest_response(guest, msg, cseq) if guest else []
        if cseq[1] == "INVITE":
            return self._on_invite_response(call, msg)
        if cseq[1] == "BYE" and msg.status >= 200 and call.state != "ended":
            call.state = "ended"
            self._log("bye-out %s %d" % (call.ramal, msg.status))
        if cseq[1] == "REFER" and msg.status >= 200:   # o REFER do comando REFER: a ligação segue como estiver
            self._log("refer-out %s %d" % (call.ramal, msg.status))
        return []

    def _on_guest_response(self, call, msg, cseq):
        """Resposta do telefone a um BYE ou ao re-INVITE do HOLD, numa ligação do telefone: o registro (bye-out e hold-out) e,
        ao re-INVITE com resposta final, o ACK (de um 2xx, um pedido novo; de outra, na mesma transação)."""
        number, method = cseq
        if method == "BYE" and msg.status >= 200 and call.state != "ended":
            self._forget(call)
            self._log("bye-out %s %d" % (call.alvo, msg.status))
        if method == "INVITE" and msg.status >= 200 and number.isdigit():
            hold = call.holds.pop(int(number), None)
            if hold:
                state, branch = hold
                self._log("hold-out %s %s %d" % (call.alvo, state, msg.status))
                headers = [("From", call.local), ("To", msg.first("to")), ("Call-ID", call.call_id),
                           ("CSeq", "%s ACK" % number)]
                return [_request("ACK", call.target, call.peer.transport, call.server,
                                 _branch() if msg.status < 300 else branch, headers)]
        return []

    def _sdp_out(self, call, msg):
        """Uma resposta do telefone ao INVITE do RING: o SDP dela fica para o VIDEO SDP, e cada código com SDP vai uma
        vez ao registro (sdp-out), com o vídeo dele. No RINGVIDEO com o replay, a primeira com o vídeo começa a
        reprodução."""
        if not msg.body.strip():
            return
        self._phone_sdp(msg.body)
        if msg.status not in call.sdp_codes:
            call.sdp_codes.add(msg.status)
            self._log("sdp-out %s %d video=%s" % (call.ramal, msg.status,
                                                   "nao" if _video_names(msg.body) is None else "sim"))
        address = _video_address(msg.body)
        if call.replay is not None and not call.replaying and address and self.video_sock:
            call.replaying = True
            threading.Thread(target=self._replay, args=(call, address), daemon=True).start()

    def _replay(self, call, address):
        """A reprodução do RINGVIDEO com o replay (numa thread): os datagramas guardados, um quadro a cada
        REPLAY_FRAME_SECONDS, ao vídeo do telefone, até o fim deles ou da ligação."""
        with self.lock:
            frames = _frames(self.video_kept)
        for frame in frames:
            with self.lock:
                if call.state not in ("calling", "ringing", "answered"):
                    return
            for packet in frame:
                try:
                    self.video_sock.sendto(_with_payload_type(packet, call.replay), address)
                except OSError:   # a PORTA fechou (o registrador saindo)
                    return
                with self.lock:
                    self.video_replayed += 1
            time.sleep(REPLAY_FRAME_SECONDS)

    def _on_invite_response(self, call, msg):
        code, to = msg.status, msg.first("to")
        if code < 200:
            if code > 100 and call.state == "calling":
                call.state = "ringing"
            self._sdp_out(call, msg)
            return []
        first = call.final is None   # o 200 volta a chegar (UDP) enquanto o ACK não chega: outro ACK, sem registro
        if first:
            call.final = code
            self._log("inv-out %s %d" % (call.ramal, code))
        self._sdp_out(call, msg)
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
            words = argument.split()
            if name == "RINGVIDEO" and len(words) in (2, 3, 4):
                replay = len(words) > 2 and words[-1] == "replay"
                rest = words[2:len(words) - 1] if replay else words[2:]
                codecs = (rest[0] if rest else "H264,VP8").split(",")
                if (len(rest) <= 1 and all(codec in RING_VIDEO for codec in codecs) and
                        len(set(codecs)) == len(codecs)):
                    return [self._ring(words[0], user=words[1], video=codecs, replay=replay)]
            if name == "VIDEO":
                reply = self._video_command(words)
                if reply:
                    return reply
            if name == "HANGUP" and ramal:
                return [self._hangup(ramal)]
            if name == "BYE" and ramal and len(words) == 1:
                return [self._guest_bye(ramal)]
            if name == "HOLD" and len(words) == 2 and words[1] in ("on", "off"):
                return [self._guest_hold(words[0], words[1])]
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
            if name == "BLF" and len(blf) in (2, 3) and blf[0] and blf[2:] in ([], ["participantes"]):
                reply = self._set_blf(blf[0], blf[1], len(blf) == 3)
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
            if name == "REFER_NOTIFY" and (STATUS_CODE.fullmatch(ramal) or ramal == "none"):
                self.refer_notify = None if ramal == "none" else int(ramal)
                return ["OK"]
            if name == "RESET" and not ramal:
                self._reset_refer()
                return ["OK"]
            if name == "LOG" and not ramal:
                return self.events + ["END"]
        return ["ERR bad-command"]

    def _video_source(self, alvo, spec):
        """VIDEO SOURCE <alvo> echo|none|color <Y> <U> <V>|default: guarda a escolha (a imagem da cor da ligação de agora
        começa na hora) e devolve OK, ou ERR bad-command."""
        if spec == ["default"]:
            self.video_sources.pop(alvo, None)
        elif spec in (["echo"], ["none"]):
            self.video_sources[alvo] = (spec[0],)
        elif (len(spec) == 4 and spec[0] == "color" and
              all(re.fullmatch(r"[0-9]{1,3}", value) and int(value) in COLOR_RANGE for value in spec[1:])):
            self.video_sources[alvo] = ("color",) + tuple(int(value) for value in spec[1:])
            call = self.guest_calls.get(alvo)
            if call:
                self._start_color(call)
        else:
            return ["ERR bad-command"]
        return ["OK"]

    def _video_command(self, words):
        """VIDEO REJECT|488|ECHO <on|off>, VIDEO PACKETS [reset|<alvo>], VIDEO KEYFRAMES [<alvo>], VIDEO SOURCE, VIDEO
        REPLAYED e VIDEO SDP: as linhas da resposta, ou None se o comando não é um desses (com o lock)."""
        if len(words) == 2 and words[0] in ("REJECT", "488", "ECHO") and words[1] in ("on", "off"):
            setattr(self, {"REJECT": "video_reject", "488": "video_488", "ECHO": "video_echo"}[words[0]],
                    words[1] == "on")
            return ["OK"]
        if words == ["PACKETS"]:
            return [str(self.video_packets)]
        if words == ["PACKETS", "reset"]:
            self.video_packets = 0
            self.video_kept = []
            self.video_keyframes = 0
            self.video_replayed = 0
            for count in self.guest_video.values():
                count.packets = count.keyframes = 0
            return ["OK"]
        if len(words) == 2 and words[0] in ("PACKETS", "KEYFRAMES"):   # <alvo>
            count = self.guest_video.get(words[1])
            return [str(getattr(count, words[0].lower()) if count else 0)]
        if len(words) >= 2 and words[0] == "SOURCE":
            return self._video_source(words[1], words[2:])
        if words == ["KEYFRAMES"]:
            return [str(self.video_keyframes)]
        if words == ["REPLAYED"]:
            return [str(self.video_replayed)]
        if words == ["SDP"]:
            lines = self.last_sdp.splitlines() if self.last_sdp else []
            return lines + ["END"]
        return None


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
    """Porta de controle (RING, RINGVIDEO, HANGUP, BYE, HOLD, REFER, REPLACES, PASSWORD, REGISTERS, CONTACT, HEADER, KEEPALIVES,
    EXPIRES, BLF, FORGET, DROP, FAIL, REFER_REPLY, REFER_NOTIFY, RESET, VIDEO, LOG), numa thread. Mesma forma de
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


class _VideoServer(_UdpServer):
    """A PORTA do vídeo (--video-port): um socket UDP cujos datagramas vão ao Registrar.on_video. Liga a porta ao
    Registrar (video_port), que a põe nas respostas e no RINGVIDEO, e o socket (video_sock), de onde sai a reprodução
    do RINGVIDEO com o replay."""

    def __init__(self, registrar, host, port):
        self.registrar = registrar
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind((host, port))
        self.sock.settimeout(0.1)   # acorda de tempos em tempos para ver se pediram para parar
        self.server_address = self.sock.getsockname()
        self._stopped = threading.Event()
        self._thread = None
        registrar.video_port = self.server_address[1]
        registrar.video_sock = self.sock

    def serve_forever(self):
        while not self._stopped.is_set():
            try:
                data, source = self.sock.recvfrom(65535)
            except socket.timeout:
                continue
            except ConnectionResetError:   # o Windows avisa assim que um eco nosso não achou ninguém
                continue
            except OSError:
                if self._stopped.is_set() or self.sock.fileno() == -1:   # fechado de propósito
                    return
                raise
            self.registrar.on_video(data, source, self.sock)


def start_video_server(registrar, host, port):
    """A PORTA do vídeo, numa thread. Devolve o servidor (porta 0 = o sistema escolhe; server_address traz a porta)."""
    return _VideoServer(registrar, host, port).start()


def main(argv):
    parser = argparse.ArgumentParser(description="Registrador SIP falso para testes.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5060)
    parser.add_argument("--user", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--log")
    parser.add_argument("--transport-log")
    parser.add_argument("--control-port", type=int, help="porta TCP (no mesmo --host) dos comandos RING, HANGUP...")
    parser.add_argument("--video-port", type=int,
                        help="porta UDP (no mesmo --host) do vídeo das respostas e do RINGVIDEO")
    args = parser.parse_args(argv)
    registrar = Registrar(args.user, args.password, log_path=args.log, transport_log_path=args.transport_log)
    udp = _UdpServer(registrar, args.host, args.port)   # antes dos outros: o que chegar já fica na fila do socket
    start_tcp_server(registrar, args.host, args.port)
    ready = "registrador falso em %s:%d (UDP e TCP)" % (args.host, args.port)
    if args.video_port is not None:
        start_video_server(registrar, args.host, args.video_port)
        ready += ", video em %s:%d" % (args.host, args.video_port)
    if args.control_port is not None:
        start_control_server(registrar, args.host, args.control_port)
        ready += ", controle em %s:%d" % (args.host, args.control_port)
    print(ready, flush=True)
    udp.serve_forever()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
