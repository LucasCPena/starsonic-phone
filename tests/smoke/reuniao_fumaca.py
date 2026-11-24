"""O item 13 da fumaça do Windows: a página da reunião num iframe da janela do app instalado, no WebView2 de verdade.

A fumaça põe o quadro na página do app ela mesma (a vista da reunião é do plano seguinte), com o chat de teste da
máquina atrás da frente TLS (reuniao_local.py), e confere o que o executável deixa e o que ele recusa pelas linhas do
diagnostico.log. As partes portáteis (os argumentos, as linhas, o portão e as sondas da página) têm os testes em
test_reuniao_fumaca.py; o run_meeting só roda no Windows. Este módulo não importa o windows_smoke: quem o chama passa o
módulo dele (o smoke). Nada daqui leva o código da reunião, um passe, a chave do computador nem o código de vínculo ao
registro do teste, ao console ou ao resultado-fumaca.json."""
import http.client
import pathlib
import re
import shutil
import socket
import ssl
import subprocess
import tempfile
import time

import reuniao_local
from reuniao_local import CHAT_ORIGIN

PERSON = "Ana Souza"
COMPANY = "Empresa Fumaça"
COMPUTER = "FUMACA-01"
RAMAL = "2001"
SUBJECT = "Planejamento"
ALLOW = "; ".join("%s %s" % (feature, CHAT_ORIGIN)
                  for feature in ("camera", "microphone", "display-capture", "autoplay", "speaker-selection"))

FAKE_DEVICES = "--use-fake-device-for-media-stream"
# A tabela "Os argumentos do WebView2 na fumaça" do plano.
CAPTURE_ARGUMENTS = {
    None: "",
    "pedaco": "--auto-select-desktop-capture-source=Entire",
    "inteiro": '--auto-select-desktop-capture-source="Entire screen"',
    "falsa": "--use-fake-ui-for-media-stream",
}
LNA_ARGUMENT = "--enable-features=LocalNetworkAccessChecks,msWebViewAllowLocalNetworkAccessChecks"

FRAME_ID = "reuniao-da-fumaca"
REFUSED_ID = "recusado-da-fumaca"
SCREEN_BUTTON_ID = "sonda-da-tela"
REFUSED_WAIT_MS = 3000
LEFT_WAIT_MS = 3000

# O começo de cada linha do diagnostico.log ("AAAA-MM-DD HH:MM:SS.mmm ") e as linhas das regras do quadro.
LOG_TIME = re.compile(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} ")
LOG_PREFIXES = ("permissao ", "captura de tela", "navegacao ", "o quadro nao carregou", "quadro fora da regra")
# As linhas que o portão procura em todos os diagnósticos juntos: (a linha, procurada pelo começo).
NEEDED_LINES = [
    ("navegacao do quadro permitida: https://chat.starcloud-starsonic.com.br", False),
    ("permissao permitida (quadro): 2 ", True),
    ("permissao negada: 2 https://app.starsonic.local", False),
    ("navegacao bloqueada: https://chat.starcloud-starsonic.com.br", False),
    ("captura de tela cancelada", False),
    ("captura de tela permitida (quadro)", False),
]
# As que faltam só quando o quadro deixou a reunião (o "saiu" com o navegou): ele pediu e não levou.
LEFT_MEETING_LINES = [
    ("permissao negada (quadro): 2 ", True),
    ("captura de tela cancelada (quadro)", False),
]
TRACKS = ["audio:live", "video:live"]

# ---- os scripts da página ----

# O estado da fumaça na página do app: as mensagens do quadro e as recusas da regra de segurança. Fica de uma abertura
# do quadro para a outra (o mesmo documento).
STATE_SCRIPT = """() => {
  if (window.__reuniao) return;
  const state = { mensagens: [], csp: [] };
  window.__reuniao = state;
  document.addEventListener('securitypolicyviolation',
    (e) => state.csp.push(e.violatedDirective + ' ' + e.blockedURI));
}"""

# O quadro da reunião: o endereço e o allow juntos, antes de o quadro entrar no documento; fixo, do tamanho da janela,
# por cima de tudo. Só vale a mensagem do quadro, da origem do chat, com o starsonic: 1.
OPEN_SCRIPT = """([id, origin, code, allow]) => {
  const state = window.__reuniao;
  const frame = document.createElement('iframe');
  frame.id = id;
  frame.title = 'Reunião';
  frame.allow = allow;
  frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;z-index:2147483647;background:#fff';
  frame.src = origin + '/r/' + code;
  addEventListener('message', (e) => {
    if (e.source !== frame.contentWindow || e.origin !== origin) return;
    const m = e.data;
    if (m === null || typeof m !== 'object' || m.starsonic !== 1) return;
    state.mensagens.push(m);
  });
  state.mandar = (tipo, campos) => frame.contentWindow.postMessage({ ...campos, starsonic: 1, tipo }, origin);
  document.body.append(frame);
}"""

READ_SCRIPT = """() => {
  const state = window.__reuniao;
  if (!state) return { mensagens: [], csp: [] };
  return { mensagens: state.mensagens.map((m) => ({ tipo: String(m.tipo),
                                                    fase: typeof m.fase === 'string' ? m.fase : null,
                                                    motivo: typeof m.motivo === 'string' ? m.motivo : null,
                                                    microfone: typeof m.microfone === 'boolean' ? m.microfone : null })),
           csp: state.csp.slice() };
}"""

PASS_SCRIPT = "(passe) => window.__reuniao.mandar('passe', { passe, aparelhos: {} })"

REMOVE_SCRIPT = "(id) => { const e = document.getElementById(id); if (e) e.remove(); }"

ENTRY_SCRIPT = """() => {
  const v = document.querySelector('section[data-tela="entrada"] video.previa');
  const c = document.querySelector('.colega');
  const nome = document.querySelector('.colega-nome');
  const aviso = document.querySelector('.aviso-acesso');
  const entrar = document.querySelector('button[data-botao="entrar"]');
  return { nome: c && !c.hidden && nome ? nome.textContent : null,
           largura: v ? v.videoWidth : 0,
           imagem: (document.querySelector('.entrada-imagem .imagem') || { dataset: {} }).dataset.imagem || null,
           semAcesso: !!aviso && !aviso.hidden,
           entrar: !!entrar && !entrar.hidden };
}"""

MEDIA_SCRIPT = """async ([audio, video]) => {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio, video });
    const faixas = s.getTracks().map((t) => t.kind + ':' + t.readyState).sort();
    s.getTracks().forEach((t) => t.stop());
    return { faixas };
  } catch (e) { return { erro: e.name + ': ' + e.message }; }
}"""

SPEAKER_SCRIPT = """async () => {
  const out = {};
  try {
    const saidas = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
    out.saidas = saidas.length;
    const outra = saidas.find((d) => d.deviceId !== 'default' && d.deviceId !== '') || saidas[0];
    const som = new Audio();
    await som.setSinkId(outra ? outra.deviceId : '');
    out.ok = true;
    out.trocou = !!outra && som.sinkId === outra.deviceId;
  } catch (e) { out.erro = e.name + ': ' + e.message; }
  return out;
}"""

# O getDisplayMedia pede um gesto do usuário: um botão no canto, por cima de tudo, e o clique de verdade nele.
SCREEN_BUTTON_SCRIPT = """(id) => {
  window.__tela = null;
  const b = document.createElement('button');
  b.id = id;
  b.textContent = 'sonda';
  b.style.cssText = 'position:fixed;left:8px;top:8px;z-index:2147483647;width:80px;height:40px';
  b.addEventListener('click', async () => {
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const t = s.getVideoTracks()[0];
      window.__tela = { faixa: t.readyState, superficie: (t.getSettings() || {}).displaySurface || null };
      s.getTracks().forEach((x) => x.stop());
    } catch (e) { window.__tela = { erro: e.name + ': ' + e.message }; }
  });
  document.body.append(b);
}"""

SCREEN_READ_SCRIPT = "() => window.__tela || null"

# Um quadro de 1 por 1, posto como o da reunião (fixo, por cima de tudo), sem o allow.
REFUSED_SCRIPT = """([id, src]) => {
  const frame = document.createElement('iframe');
  frame.id = id;
  frame.title = 'Recusado';
  frame.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;border:0;z-index:2147483647';
  frame.src = src;
  document.body.append(frame);
}"""


def meeting_arguments(base: str, capture: str | None = None, lna: bool = False) -> str:
    """O valor da WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS de uma abertura do item 13."""
    parts = [base, FAKE_DEVICES, CAPTURE_ARGUMENTS[capture]]
    if lna:
        parts.append(LNA_ARGUMENT)
    return " ".join(part for part in parts if part)


def _frame_of(page, prefix):
    return next((frame for frame in page.frames if frame.url.startswith(prefix)), None)


def _labels(messages):
    """As mensagens como "pronta", "estado:entrada", "fim:saiu"..., sem repetir a mesma duas vezes seguidas."""
    labels = []
    for message in messages:
        label = message["tipo"]
        for field in ("fase", "motivo"):
            if message.get(field):
                label += ":" + message[field]
        if not labels or labels[-1] != label:
            labels.append(label)
    return labels


def read_messages(page) -> dict:
    """{"mensagens", "microfone", "csp"}: o que a página do quadro mandou até agora, o microfone do último estado e as
    recusas da regra de segurança da página do app."""
    state = page.evaluate(READ_SCRIPT)
    microphone = None
    for message in state["mensagens"]:
        if message["tipo"] == "estado" and message["microfone"] is not None:
            microphone = message["microfone"]
    return {"mensagens": _labels(state["mensagens"]), "microfone": microphone, "csp": list(state["csp"])}


def _has(page, label):
    return label in read_messages(page)["mensagens"]


def open_meeting(page, origin: str, code: str, meeting_pass: str, pump, timeout: float = 30) -> dict:
    """Põe o quadro da reunião, espera o "pronta", manda o passe (com "aparelhos": {}) e espera o primeiro estado da
    entrada. Devolve o read_messages(page) mais o "quadro": o Frame do Playwright da reunião, ou None."""
    page.evaluate(STATE_SCRIPT)
    page.evaluate(OPEN_SCRIPT, [FRAME_ID, origin, code, ALLOW])
    deadline = time.monotonic() + timeout
    if _wait(lambda: _has(page, "pronta"), deadline, pump):
        page.evaluate(PASS_SCRIPT, meeting_pass)
        _wait(lambda: _has(page, "estado:entrada"), deadline, pump)
    said = read_messages(page)
    said["quadro"] = _frame_of(page, origin + "/r/")
    return said


def _wait(condition, deadline, pump, interval_ms=250):
    """Repete condition() até ela dar verdadeiro ou o prazo (time.monotonic) passar; pump(ms) espera."""
    while True:
        value = condition()
        if value or time.monotonic() >= deadline:
            return value
        pump(interval_ms)


def close_meeting(page) -> None:
    """Tira o quadro da reunião da página."""
    page.evaluate(REMOVE_SCRIPT, FRAME_ID)


def probe_entry(frame, pump, timeout: float = 15) -> dict:
    """A entrada do colega no quadro: {"nome", "largura", "imagem", "semAcesso", "entrar"}, quando o nome e a prévia
    aparecem, ou como estiver no fim do prazo."""
    deadline = time.monotonic() + timeout
    entry = _wait(lambda: (lambda e: e if e["nome"] and e["largura"] > 0 else None)(frame.evaluate(ENTRY_SCRIPT)),
                  deadline, pump)
    return entry or frame.evaluate(ENTRY_SCRIPT)


def probe_media(target, audio: bool = True, video: bool = True) -> dict:
    """O getUserMedia direto, num quadro ou na página: {"faixas": [...]} (em ordem) ou {"erro": "<nome>: <texto>"}."""
    return target.evaluate(MEDIA_SCRIPT, [audio, video])


def probe_speaker(frame) -> dict:
    """O setSinkId numa saída que não é a padrão: {"saidas", "ok", "trocou"} ou {"saidas", "erro"}."""
    return frame.evaluate(SPEAKER_SCRIPT)


def probe_screen(target, pump, timeout: float = 15) -> dict:
    """O getDisplayMedia no clique de verdade num botão posto no documento; o botão sai no fim. {"faixa",
    "superficie"}, {"erro": ...} ou, sem resposta no prazo (a janela de escolha aberta), {"erro": "sem resposta"}."""
    target.evaluate(SCREEN_BUTTON_SCRIPT, SCREEN_BUTTON_ID)
    try:
        target.locator("#" + SCREEN_BUTTON_ID).click(timeout=int(timeout * 1000))
        answer = _wait(lambda: target.evaluate(SCREEN_READ_SCRIPT), time.monotonic() + timeout, pump)
    finally:
        target.evaluate(REMOVE_SCRIPT, SCREEN_BUTTON_ID)
    return answer or {"erro": "sem resposta"}


def probe_refused_frames(page, origin: str, code: str, pump) -> dict:
    """Os três quadros que não entram, um de cada vez: 3 s depois, "carregou" é haver um quadro da página com aquele
    endereço. {"administracao", "consulta", "de_fora"}."""
    page.evaluate(STATE_SCRIPT)
    loaded = {}
    for name, src in (("administracao", origin + "/admin/entrar"),
                      ("consulta", origin + "/r/" + code + "?x=1"),
                      ("de_fora", "https://exemplo.com.br/")):
        page.evaluate(REFUSED_SCRIPT, [REFUSED_ID, src])
        try:
            pump(REFUSED_WAIT_MS)
            loaded[name] = any(frame.url == src for frame in page.frames)
        finally:
            page.evaluate(REMOVE_SCRIPT, REFUSED_ID)
    return loaded


# O quadro da reunião mandado para outro endereço (o src do elemento).
LEAVE_SCRIPT = "([id, src]) => { document.getElementById(id).src = src; }"
HREF_SCRIPT = "() => location.href"


def probe_left_meeting(page, origin: str, code: str, pump) -> dict:
    """Com o quadro da reunião aberto (open_meeting): manda esse quadro para o endereço da reunião com mais coisa
    (?x=1), espera 3 s e lê o location.href do documento que ele mostra. {"navegou", "camera", "tela"}: com o
    navegou, a câmera (só o vídeo) e a tela pedidas por esse documento; sem ele (o quadro continuou na reunião), None."""
    meeting = origin + "/r/" + code
    page.evaluate(LEAVE_SCRIPT, [FRAME_ID, meeting + "?x=1"])
    pump(LEFT_WAIT_MS)
    frame = page.locator("#" + FRAME_ID).element_handle().content_frame()
    try:
        href = frame.evaluate(HREF_SCRIPT) if frame is not None else None
    except Exception:   # noqa: BLE001 - um documento que não deixa ler (uma página de erro) não é a reunião
        href = None
    if href == meeting:
        return {"navegou": False, "camera": None, "tela": None}
    return {"navegou": True, "camera": probe_media(frame, audio=False, video=True),
            "tela": probe_screen(frame, pump)}


def log_lines(log_text: str) -> list[str]:
    """As linhas das regras do quadro no diagnostico.log, sem a data e a hora do começo."""
    lines = []
    for line in log_text.splitlines():
        line = LOG_TIME.sub("", line, count=1)
        if line.startswith(LOG_PREFIXES):
            lines.append(line)
    return lines


def leaks(log_text: str, secrets: list[str]) -> list[str]:
    """Quais segredos (não vazios) aparecem no texto."""
    return [secret for secret in secrets if secret and secret in log_text]


def scrub(value, secrets: dict[str, str]):
    """O valor (um texto, uma lista ou um dicionário, a qualquer profundidade) com cada segredo não vazio trocado
    pelo rótulo dele: {"codigo": "k7q..."} faz de "k7q..." o "<codigo>"."""
    if isinstance(value, str):
        # Os mais longos primeiro: um segredo que contivesse outro não deixa um pedaço para trás.
        for label, secret in sorted(secrets.items(), key=lambda item: -len(item[1] or "")):
            if secret:
                value = value.replace(secret, "<%s>" % label)
        return value
    if isinstance(value, list):
        return [scrub(item, secrets) for item in value]
    if isinstance(value, dict):
        return {key: scrub(item, secrets) for key, item in value.items()}
    return value


def _part(node, *path):
    """O dicionário em node[path...], ou {} quando falta (um record pela metade não quebra o portão)."""
    for key in path:
        node = node.get(key) if isinstance(node, dict) else None
    return node if isinstance(node, dict) else {}


def _list(node, key):
    value = node.get(key)
    return [item for item in value if isinstance(item, str)] if isinstance(value, list) else []


def problems_of(record: dict) -> list[str]:
    """O portão do item 13: [] quando a prova passa; uma frase para cada fato que falta. Um record pela metade (uma
    abertura que quebrou) reprova pelo que falta nele, sem levantar exceção."""
    problems = []
    if record.get("endereco") != "privado":
        problems.append("o chat da fumaca nao ficou num endereco privado (%s)" % record.get("endereco"))
    main = _part(record, "principal")
    messages = _list(main, "mensagens")
    if "pronta" not in messages or "estado:entrada" not in messages:
        problems.append("a pagina do quadro nao mandou o pronta e o estado:entrada (%s)" % messages)
    if main.get("quadro") is not True:
        problems.append("a pagina da reuniao nao ficou no quadro")
    entry = _part(main, "entrada")
    if entry.get("nome") != PERSON:
        problems.append("a entrada nao mostrou o nome da pessoa (%s)" % entry.get("nome"))
    if not entry.get("largura"):
        problems.append("a previa da entrada ficou sem imagem (largura %s)" % entry.get("largura"))
    if entry.get("semAcesso") is not False:
        problems.append("a entrada mostrou o aviso de sem acesso a camera (%s)" % entry.get("semAcesso"))
    if entry.get("entrar") is not True:
        problems.append("a entrada nao mostrou o botao Entrar")
    media = _part(main, "midia")
    if media.get("faixas") != TRACKS:
        problems.append("a camera e o microfone nao vieram no quadro: %s" % media)
    speaker = _part(main, "alto_falante")
    outputs = speaker.get("saidas")
    several = isinstance(outputs, int) and outputs > 1
    if speaker.get("ok") is not True or (several and speaker.get("trocou") is not True):
        problems.append("o alto-falante nao trocou no quadro: %s" % speaker)
    screen = _part(record, "tela")
    if not screen.get("ok"):
        problems.append("nenhuma tentativa capturou a tela")
    refusals = _part(record, "recusas")
    for what, name in (("camera", "a camera"), ("tela", "a tela")):
        answer = _part(refusals, "do_app", what)
        if not str(answer.get("erro", "")).startswith("NotAllowedError"):
            problems.append("a pagina do app pediu %s e nao levou um NotAllowedError: %s" % (name, answer))
    refused = _part(refusals, "recusados")
    # O "consulta" fica registrado e não é julgado (a regra final de uma navegação recusada vem na rodada seguinte).
    for name in ("administracao", "de_fora"):
        if refused.get(name) is not False:
            problems.append("um quadro recusado carregou (ou nao foi visto): %s" % name)
    left = _part(refusals, "saiu")
    needed_lines = list(NEEDED_LINES)
    if not isinstance(left.get("navegou"), bool):
        problems.append("nao se sabe se o quadro que deixa a reuniao navegou: %s" % (refusals.get("saiu"),))
    elif left["navegou"]:
        for what, name in (("camera", "a camera"), ("tela", "a tela")):
            answer = _part(left, what)
            if not str(answer.get("erro", "")).startswith("NotAllowedError"):
                problems.append("o quadro fora da reuniao pediu %s e nao levou um NotAllowedError: %s"
                                % (name, left.get(what)))
        needed_lines += LEFT_MEETING_LINES
    leaked = record.get("vazou")
    if leaked is None or leaked:
        problems.append("o diagnostico vazou (ou nao foi conferido): %s" % leaked)
    undone = _part(record, "desfeito")
    if undone.get("hosts") is not True:
        problems.append("o hosts nao voltou ao que era")
    if undone.get("certificado") is not True:
        problems.append("o certificado da fumaca ficou na lista do Windows")
    lines = _list(main, "diagnostico") + _list(refusals, "diagnostico")
    attempts = screen.get("tentativas")
    for attempt in attempts if isinstance(attempts, list) else []:
        if isinstance(attempt, dict):
            lines += _list(attempt, "diagnostico")
    for needed, by_start in needed_lines:
        if not any(line.startswith(needed) if by_start else line == needed for line in lines):
            problems.append("falta no diagnostico: " + needed)
    return problems


# ---- o item 13 (só no Windows) ----

NOT_THROUGH_FRONT = "a pagina da reuniao nao veio pela frente da fumaca"
LAUNCH_FOLDER_PREFIX = "starsonic-fumaca-reuniao-"
WEBVIEW_GONE_SECONDS = 40
SCREENSHOT = "reuniao-entrada.png"


def _certutil(*arguments) -> int:
    """O código de saída do certutil, na lista de autoridades da máquina (nunca a do usuário: ela abre uma janela)."""
    return subprocess.run(["certutil", *arguments], capture_output=True, timeout=60).returncode


def _captured(answer) -> bool:
    return isinstance(answer, dict) and answer.get("faixa") == "live"


class _Item:
    """O estado do item 13: o chat, a frente, os segredos (só para tirá-los do que sai) e a abertura de agora."""

    def __init__(self, smoke, pw, exe, capturas, result, problems, record):
        self.smoke, self.pw, self.exe, self.capturas = smoke, pw, exe, capturas
        self.result, self.problems, self.record = result, problems, record
        self.chat = self.front = None
        self.key = self.code = None
        self.secrets = {}
        self.passes = []
        self.raw_logs = []
        self.folders = []
        self.current = {}

    def clean(self, value):
        value = scrub(value, self.secrets)
        for one in self.passes:
            value = scrub(value, {"passe": one})
        return value

    def say(self, text):
        self.smoke.log("reuniao: " + self.clean(text))

    def folder(self, prefix):
        path = pathlib.Path(tempfile.mkdtemp(prefix=prefix))
        self.folders.append(path)
        return path

    def new_pass(self):
        # O passe vale uma vez e 120 s: um novo logo antes de cada abertura do quadro.
        one = self.chat.meeting_pass(self.key, self.code)
        self.passes.append(one)
        return one

    def close(self):
        """browser.close() e o --sair; se o --sair falhar, o app é morto. True se o --sair fechou o app com 0."""
        browser, app = self.current.pop("browser", None), self.current.pop("app", None)
        if browser is not None:
            try:
                browser.close()
            except Exception:   # noqa: BLE001 - o navegador do CDP já caído não impede o --sair
                pass
        if app is None:
            return False
        try:
            app.quit()
            return True
        except Exception:   # noqa: BLE001 - o --sair que falha ou demora: o app é morto e a prova segue
            app.kill()
            return False

    def launch(self, which, part, capture, lna, body, console=False):
        """Uma abertura do app, no try dela: o erro fica na parte dela e em problems, e a próxima abertura roda. Só a
        página que não veio pela frente para o item."""
        smoke = self.smoke
        part["argumentos"] = meeting_arguments(smoke.browser_arguments(), capture, lna)
        data_dir = self.folder(LAUNCH_FOLDER_PREFIX)
        lines = []
        try:
            try:
                self.say("abertura %s: %s" % (which, part["argumentos"]))
                # Os argumentos da variável só valem para um WebView2 que ainda não está aberto.
                if not smoke.wait_for(lambda: smoke.webview_processes() == 0, WEBVIEW_GONE_SECONDS, interval=1):
                    raise smoke.SmokeFailure("o WebView2 da abertura anterior nao saiu")
                self.current["app"] = smoke.App(self.exe, data_dir,
                                                {"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": part["argumentos"]})
                browser = self.current["browser"] = smoke.connect(self.pw)
                if self.record.get("webview2") is None:
                    self.record["webview2"] = (smoke.cdp_ready() or {}).get("Browser")
                page = smoke.find_page(browser, "/index.html", 60, lambda ms: time.sleep(ms / 1000.0))
                # A página do app pronta antes de tudo: a pasta de dados nova abre na tela Entrar.
                page.locator("#entrar-servidor").wait_for(timeout=60000)
                page.on("console", lambda message: lines.append("%s: %s" % (message.type, message.text)))
                page.on("pageerror", lambda error: lines.append("pageerror: %s" % error))
                # O app abre na tela Entrar e ninguém entra: o quadro vai por cima dela.
                body(page, page.wait_for_timeout)
            finally:
                part.setdefault("fechou", self.close())
                if console:
                    part["console"] = self.clean(lines)
                text = smoke.read_log(data_dir)
                self.raw_logs.append(text)
                part["diagnostico"] = self.clean(log_lines(text))
                self.say("abertura %s: fechou %s; diagnostico %s" % (which, part["fechou"], part["diagnostico"]))
                self.show_log(data_dir / "diagnostico.log", text)
        except Exception as error:   # noqa: BLE001 - uma abertura que quebra não esconde as outras
            text = self.clean("%s: %s" % (type(error).__name__, error))
            if NOT_THROUGH_FRONT in text:
                raise
            part["erro"] = text
            self.problems.append("reuniao, abertura %s: %s" % (which, text))
            self.say("abertura %s quebrou: %s" % (which, text))

    def show_log(self, path, text):
        """O diagnostico.log da abertura no registro do job, como o show_log do smoke, mas sem os segredos (o registro
        do job é público; o vazou procura no texto cru)."""
        print("--- %s ---" % path, flush=True)
        print(self.clean(text) if text else "(sem o log)", flush=True)
        print("--- fim do diagnostico.log ---", flush=True)

    def open_frame(self, page, pump, part, before=None):
        """O quadro da reunião, com um passe novo. Um quadro que carregou sem a frente ver uma ligação fecha o app e
        para o item: a página não veio do chat da fumaça. before: a contagem da frente de antes do primeiro quadro do
        chat desta abertura (o navegador guarda a ligação aberta e a usa de novo no quadro seguinte); sem ele, a de
        agora."""
        if before is None:
            before = self.front.connections
        opened = open_meeting(page, CHAT_ORIGIN, self.code, self.new_pass(), pump)
        frame = opened.pop("quadro")
        if frame is not None and self.front.connections <= before:
            part["fechou"] = self.close()
            raise self.smoke.SmokeFailure(NOT_THROUGH_FRONT)
        said = self.clean(opened)
        self.say("quadro %s; mensagens %s; microfone %s; csp %s"
                 % ("aberto" if frame is not None else "ausente", said["mensagens"], said["microfone"], said["csp"]))
        return frame, said

    # --- os passos ------------------------------------------------------------------------------------------------

    def start(self, chat_binary):
        """1. O chat, os certificados, a frente, a autoridade na lista do Windows e o nome no hosts."""
        smoke = self.smoke
        self.chat = reuniao_local.LocalChat(chat_binary, self.folder("starsonic-fumaca-chat-"),
                                            [reuniao_local.APP_ORIGIN, CHAT_ORIGIN])
        self.chat.start()
        self.say("o chat de teste subiu no 127.0.0.1:%d" % self.chat.port)
        address, kind = reuniao_local.private_address()
        self.record["endereco"] = kind
        ca_pem, cert_pem, key_pem = reuniao_local.make_certificates(reuniao_local.CHAT_NAME)
        self.thumbprint = reuniao_local.thumbprint(ca_pem)
        self.front = reuniao_local.TlsFront(address, reuniao_local.CHAT_PORT, self.chat.port, cert_pem, key_pem)
        self.front.start()
        self.say("a frente TLS escuta no endereco %s (%s), porta %d" % (kind, address, self.front.port))
        ca_file = self.folder("starsonic-fumaca-autoridade-") / "autoridade.pem"
        ca_file.write_bytes(ca_pem)
        self.ca_added = True   # antes do certutil: o finally tira a autoridade mesmo se ele quebrar no meio
        code = _certutil("-addstore", "-f", "Root", str(ca_file))
        if code != 0:
            raise smoke.SmokeFailure("certutil -addstore Root terminou com o codigo %d" % code)
        self.say("a autoridade da fumaca entrou na lista do Windows (%s)" % self.thumbprint)
        self.original_hosts = smoke.HOSTS_FILE.read_bytes()
        self.hosts_written = True
        smoke.HOSTS_FILE.write_bytes(smoke.hosts_with(self.original_hosts, address, reuniao_local.CHAT_NAME))
        smoke.flush_dns()
        self.say("o nome %s foi para o hosts" % reuniao_local.CHAT_NAME)
        self.address, self.ca_pem = address, ca_pem

    def check_name(self):
        """2. O nome do chat leva só à frente da fumaça, e a autoridade está onde o WebView2 olha. Sem isso, o app não
        abre: nenhum pedido do teste pode chegar ao chat de verdade."""
        smoke = self.smoke
        name, port = reuniao_local.CHAT_NAME, reuniao_local.CHAT_PORT
        try:
            found = {info[4][0] for info in socket.getaddrinfo(name, port, type=socket.SOCK_STREAM)}
        except OSError as error:
            raise smoke.SmokeFailure("o nome do chat nao resolveu (%s)" % type(error).__name__)
        if found != {self.address}:
            raise smoke.SmokeFailure("o nome do chat nao leva so a frente da fumaca: %d endereco(s), %s o da frente"
                                     % (len(found), "com" if self.address in found else "sem"))
        # Só a autoridade da fumaça vale aqui: um servidor que não é a frente não completa o aperto de mão.
        context = ssl.create_default_context(cadata=self.ca_pem.decode("ascii"))
        before = self.front.connections
        connection = http.client.HTTPSConnection(name, port, context=context, timeout=20)   # sem proxy nenhum
        try:
            connection.request("GET", "/admin/entrar")
            response = connection.getresponse()
            response.read()
            status = response.status
        except (OSError, http.client.HTTPException) as error:
            raise smoke.SmokeFailure("o pedido https pelo nome do chat falhou: %s: %s" % (type(error).__name__, error))
        finally:
            connection.close()
        if status != 200 or self.front.connections <= before:
            raise smoke.SmokeFailure("o pedido https pelo nome do chat respondeu %d, com %d ligacao(oes) na frente"
                                     % (status, self.front.connections - before))
        if _certutil("-store", "Root", self.thumbprint) != 0:
            raise smoke.SmokeFailure("o certutil -store Root nao acha a autoridade da fumaca")
        self.say("o nome leva a frente (%d endereco), o pedido https respondeu 200 por ela e a autoridade esta na "
                 "lista do Windows" % len(found))

    def prepare(self):
        """3. A empresa, o computador, a pessoa e a reunião."""
        link = self.chat.company_with_meetings(COMPANY)
        self.secrets["vinculo"] = link
        self.key = self.chat.link_computer(link, COMPUTER)
        self.secrets["chave"] = self.key
        self.chat.enter_person(self.key, RAMAL, PERSON)
        self.code = self.chat.schedule_meeting(self.key, SUBJECT)
        self.secrets["codigo"] = self.code
        self.say("a empresa, o computador, a pessoa e a reuniao estao no chat de teste")

    def run_main(self):
        """4. A abertura principal: o quadro, a entrada, a mídia, o alto-falante, a captura e, por último, a tela."""
        main, screen = self.record["principal"], self.record["tela"]
        attempt = {"captura": "pedaco"}
        screen["tentativas"].append(attempt)

        def body(page, pump):
            frame, said = self.open_frame(page, pump, main)
            main["quadro"] = frame is not None
            main.update({"mensagens": said["mensagens"], "microfone": said["microfone"], "csp": said["csp"]})
            if frame is None:
                return
            main["entrada"] = self.clean(probe_entry(frame, pump))
            self.say("entrada: %s" % main["entrada"])
            said = self.clean(read_messages(page))
            main.update({"mensagens": said["mensagens"], "microfone": said["microfone"], "csp": said["csp"]})
            main["midia"] = self.clean(probe_media(frame))
            self.say("camera e microfone: %s" % main["midia"])
            main["alto_falante"] = self.clean(probe_speaker(frame))
            self.say("alto-falante: %s" % main["alto_falante"])
            self.smoke.screenshot(page, self.capturas, SCREENSHOT, self.result)
            # A tela por último: uma janela de escolha que ficasse aberta não atrapalha o resto.
            attempt["resultado"] = self.clean(probe_screen(frame, pump))
            self.say("tela (pedaco): %s" % attempt["resultado"])

        self.launch("principal", main, "pedaco", False, body, console=True)
        attempt["diagnostico"] = [line for line in main.get("diagnostico", []) if line.startswith("captura de tela")]
        if _captured(attempt.get("resultado")):
            screen["ok"] = "pedaco"

    def run_screen_attempts(self):
        """5. As outras tentativas da tela, só se a anterior não capturou (e a principal teve o quadro)."""
        screen = self.record["tela"]
        for capture in ("inteiro", "falsa"):
            if screen["ok"] or self.record["principal"].get("quadro") is not True:
                return
            attempt = {"captura": capture}
            screen["tentativas"].append(attempt)

            def body(page, pump, attempt=attempt):
                frame, _ = self.open_frame(page, pump, attempt)
                attempt["resultado"] = self.clean(probe_screen(frame, pump)) if frame is not None else {
                    "erro": "sem o quadro"}
                self.say("tela (%s): %s" % (attempt["captura"], attempt["resultado"]))

            self.launch("tela " + capture, attempt, capture, False, body)
            if _captured(attempt.get("resultado")):
                screen["ok"] = capture

    def run_local_network(self):
        """6. A proteção Local Network Access ligada: o quadro e as mensagens, só para registrar."""
        part = self.record["lna"]

        def body(page, pump):
            frame, said = self.open_frame(page, pump, part)
            part["quadro"] = frame is not None
            part["mensagens"] = said["mensagens"]

        self.launch("lna", part, "pedaco", True, body, console=True)

    def run_refusals(self):
        """7. Por último: o que a página do app pede e não leva, os três quadros que não entram e o quadro que
        deixa a reunião."""
        part = self.record["recusas"]

        def body(page, pump):
            # Antes dos quadros do chat desta abertura: o da reunião, depois deles, pode vir por uma ligação deles.
            before = self.front.connections
            part["do_app"] = {}
            part["do_app"]["camera"] = self.clean(probe_media(page, audio=False, video=True))
            part["do_app"]["tela"] = self.clean(probe_screen(page, pump))
            self.say("a pagina do app pediu: %s" % part["do_app"])
            part["recusados"] = probe_refused_frames(page, CHAT_ORIGIN, self.code, pump)
            part["csp"] = self.clean(read_messages(page)["csp"])
            self.say("quadros recusados (carregou?): %s; csp %s" % (part["recusados"], part["csp"]))
            # O quadro que deixa a reunião: só um documento de reunião ganha a câmera e a tela.
            frame, _ = self.open_frame(page, pump, part, before)
            part["saiu"] = (self.clean(probe_left_meeting(page, CHAT_ORIGIN, self.code, pump)) if frame is not None
                            else {"erro": "sem o quadro"})
            self.say("o quadro que deixa a reuniao: %s" % part["saiu"])

        self.launch("recusas", part, "pedaco", False, body)

    def find_leaks(self):
        """8. O que vazou para os diagnósticos (no texto cru), pelo rótulo."""
        found = []
        for label, values in (("codigo", [self.code]), ("passe", self.passes), ("chave", [self.key]),
                              ("pessoa", [PERSON]), ("empresa", [COMPANY]), ("assunto", [SUBJECT])):
            if any(leaks(text, [value for value in values if value]) for text in self.raw_logs):
                found.append(label)
        self.record["vazou"] = found
        self.say("vazou: %s" % found)

    def undo(self):
        """9. Tudo de volta, cada passo no try dele; o desfeito confere o hosts e a lista do Windows."""
        smoke = self.smoke
        steps = [("o app", self.close)]
        if getattr(self, "hosts_written", False):
            steps.append(("o hosts", lambda: (smoke.HOSTS_FILE.write_bytes(self.original_hosts), smoke.flush_dns())))
        if getattr(self, "ca_added", False):
            steps.append(("a autoridade", lambda: _certutil("-delstore", "Root", self.thumbprint)))
        if self.front is not None:
            steps.append(("a frente", self.front.stop))
        if self.chat is not None:
            steps.append(("o chat", self.chat.stop))
        steps.append(("as pastas", lambda: [shutil.rmtree(path, ignore_errors=True) for path in self.folders]))
        for name, step in steps:
            try:
                step()
            except Exception as error:   # noqa: BLE001 - um passo que falha não impede os outros
                self.say("desfazer %s falhou: %s" % (name, type(error).__name__))
        undone = self.record["desfeito"]
        try:
            undone["hosts"] = (not getattr(self, "hosts_written", False)
                               or smoke.HOSTS_FILE.read_bytes() == self.original_hosts)
        except OSError:
            undone["hosts"] = False
        try:
            undone["certificado"] = (getattr(self, "thumbprint", None) is None
                                     or _certutil("-store", "Root", self.thumbprint) != 0)
        except (OSError, subprocess.SubprocessError):
            undone["certificado"] = False
        self.say("desfeito: %s" % undone)


def run_meeting(smoke, pw, win, exe, capturas, result, problems, chat_binary) -> None:
    """O item 13: a página da reunião num iframe da janela do app instalado. O record vai a result["reuniao"] desde o
    começo e se enche no caminho; o que falta nele reprova pelo problems_of, no fim. Uma falha antes da primeira
    abertura (o chat, a frente, a conferência do nome) e a página que não veio pela frente levantam SmokeFailure."""
    record = result["reuniao"] = {"endereco": None, "webview2": None, "principal": {},
                                  "tela": {"tentativas": [], "ok": None}, "lna": {}, "recusas": {}, "vazou": None,
                                  "desfeito": {"hosts": None, "certificado": None}}
    item = _Item(smoke, pw, exe, capturas, result, problems, record)
    try:
        try:
            item.start(chat_binary)
            item.check_name()
            item.prepare()
            item.run_main()
            item.run_screen_attempts()
            item.run_local_network()
            item.run_refusals()
            item.find_leaks()
        finally:
            item.undo()
    except Exception as error:   # noqa: BLE001 - o texto que sai daqui vai ao registro público do job
        text = str(error) if isinstance(error, smoke.SmokeFailure) else "%s: %s" % (type(error).__name__, error)
        raise smoke.SmokeFailure("reuniao: " + item.clean(text)) from None
    problems.extend(problems_of(record))
