#!/usr/bin/env python3
"""Teste de fumaça do app novo instalado no Windows (spec da W1, 11.2), pelo DevTools (CDP) do WebView2.

Fumaça (padrão), contra o StarsonicPhone.exe instalado do build de teste (STARSONIC_TEST_HOOKS; o mesmo instalador):
1. sobe o registrador falso (tests/smoke/fake_registrar.py, UDP e TCP na 5060, ramal 2001);
2. abre o app com WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333 (e o
   --autoplay-policy do próprio app, que a variável substitui), o perfil de teste (STARSONIC_PERFIL: o registrador
   falso na 5060 por UDP), o dispositivo de som nulo (STARSONIC_SOM_NULO: o runner não tem placa de som) e
   "--dados <pasta nova>", e liga o Playwright pelo CDP;
3. entra no registrador falso por UDP (servidor 127.0.0.1, ramal 2001) e confere "Conectado · 127.0.0.1"; captura
   janela-principal.png;
4. liga para 2002, confere "Em ligação" e o 200 no registrador; captura ligacao.png; desliga (o BYE chega);
5. minimiza a janela, o registrador manda um RING: confere o aviso (a janela "Starsonic Phone Aviso" visível, com
   "Cliente Teste") e que a janela em primeiro plano não muda só por ele aparecer; captura aviso.png; atende pelo
   aviso (o 200 chega ao registrador, a janela principal volta e mostra "Em ligação") e desliga;
6. fecha com --sair, baixa a área de trabalho para 640 lógicos (SPI_SETWORKAREA; a de um notebook de 1920x1080 a 150%
   tem uns 672) e abre de novo: a janela fica inteira dentro da área de trabalho, com 400 de largura e a altura dela,
   e o teclado, o Ligar e a navegação ficam inteiros na interface, sem um cobrir o outro; captura
   janela-principal-curta.png; a área de trabalho volta e a janela volta aos 720; fecha com --sair;
7. abre de novo e confere que a página do app leva a versão na URL (index.html?v=..., aviso.html?v=...: o cache do
   WebView2 nunca serve a interface de outra versão); manda WM_DEVICECHANGE (DBT_DEVNODES_CHANGED) três vezes seguidas
   à janela: o motor relê os dispositivos de som uma vez só ("som: os dispositivos foram relidos" no diagnostico.log);
   derruba a página (Page.crash do CDP) e depois o processo do navegador do WebView2 (o msedgewebview2.exe filho do
   app): a cada vez a interface volta ("interface pronta" de novo; no navegador, "navegador reiniciado") e um RING
   ainda mostra o aviso, recusado pelo aviso;
8. com STARSONIC_TRAVAR_SAIR (build de teste: o Sair trava a thread de comandos), o Sair do menu da interface fecha
   o app mesmo assim, em até 25 s ("fechamento forcado" no diagnostico.log, código 0), e o app abre de novo.
6b. (rc.2) o tamanho da janela: o WM_NCHITTEST nas bordas e nos cantos de baixo responde HTLEFT, HTRIGHT, HTBOTTOM,
   HTBOTTOMLEFT e HTBOTTOMRIGHT, e o canto de baixo a direita é da janela, não do WebView2 (WindowFromPoint); a faixa de
   cima e o canto do desenho (zonas da interface, em cima do WebView2) redimensionam com um arrasto de verdade do mouse
   (SendInput: o "resize" chega ao C++ e a janela muda de tamanho; se o SendInput não chegar à página no runner, um
   mousedown pelo CDP na zona e o "redimensionar: <borda>" no diagnostico.log); SetWindowPos para 340x560 e 300x440 (a área da interface): o layout Compacto e o Mínimo pelo CDP,
   com o teclado, o Rediscar, o Ligar e a navegação inteiros, e as capturas janela-compacta.png e janela-minima.png;
   abaixo de 300x440 a janela fica nos 300x440 (WM_GETMINMAXINFO); o 340x560 volta depois de fechar e abrir (o
   config.json); e volta aos 400x720;
Os itens 7 e 8 juntam o que falhou e reprovam no fim (um não esconde o outro).
Na escala de 100%, a área da interface tem 400x720 lógicos (as bordas invisíveis de redimensionar ficam fora dela). A escala de 150% de verdade (outro DPI) não dá para mudar no runner.

Ensaio da atualização (--ensaio): o app já foi aberto pelo instalador (por cima da rc.7, com a variável do CDP no
ambiente do instalador). Confere "Conectado · 127.0.0.1" (a conta e a senha que vieram da rc.7) e o contato na tela
Contatos; captura ensaio-conectado.png e ensaio-contatos.png; fecha com --sair. O registrador falso é de quem chama
(--controle: a porta de controle dele).

Grava <capturas>/resultado.json (o que foi visto) e imprime o diagnostico.log no fim. Código 0 = passou.

Uso: python tests/smoke/windows_smoke.py --exe <pasta>\\StarsonicPhone.exe --capturas capturas-windows
     python tests/smoke/windows_smoke.py --ensaio --exe <pasta>\\StarsonicPhone.exe --controle 5070
                                         --contato "Ana Ensaio" --capturas capturas-windows
Precisa do Playwright para Python (tests/smoke/requirements-windows.txt); o Chromium dele não é usado.
"""
import argparse
import json
import os
import pathlib
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
CDP_PORT = 9333
CDP_URL = "http://127.0.0.1:%d" % CDP_PORT
DEBUG_ARGUMENT = "--remote-debugging-port=%d" % CDP_PORT
# A variável WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS toma o lugar dos argumentos que o app passa ao WebView2: o do
# toque (windows/app/src/WebViewHost.cpp) vai junto, para o app rodar como roda sem a variável.
APP_ARGUMENT = "--autoplay-policy=no-user-gesture-required"
SHORT_HEIGHT = 640   # a área de trabalho baixa da fumaça, em pixels lógicos
WINDOW_CLASS = "Starsonic Phone"
NOTICE_CLASS = "Starsonic Phone Aviso"
LOGICAL_SIZE = (400, 720)
SERVER = "127.0.0.1"
RAMAL = "2001"
SENHA = "senha-certa"
DESTINO = "2002"
CALLER_NAME = "Cliente Teste"   # o RING do registrador falso
CONNECTED = "Conectado · " + SERVER
# O perfil de teste (STARSONIC_PERFIL, só no build de teste): o registrador falso na 5060 por UDP, sem STUN e sem
# SRTP, com os codecs que ele responde. STARSONIC_SOM_NULO: o dispositivo nulo do PJSIP (o runner não tem placa de som).
TEST_PROFILE = "\r\n".join([
    "[geral]", "stun=", "codecs=PCMU,PCMA", "dtmf=rfc2833", "",
    "[conta]", "porta=5060", "transporte=udp", "proxy=", "srtp=desativado", "keepalive=15", "ddi=55",
    "prefixo_externo=", "",
])
IN_CALL = "Em ligação"


class SmokeFailure(Exception):
    pass


def browser_arguments():
    """O valor de WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: o CDP na 9333 e o argumento do app."""
    return " ".join([DEBUG_ARGUMENT, APP_ARGUMENT])


def short_work_area(work, logical_height, dpi):
    """A área de trabalho (left, top, right, bottom) com a altura cortada em logical_height pixels lógicos."""
    left, top, right, bottom = work
    return (left, top, right, min(bottom, top + round(logical_height * dpi / 96.0)))


def inside(box, area):
    """A janela (x, y, largura, altura) inteira dentro da área (left, top, right, bottom)."""
    x, y, width, height = box
    left, top, right, bottom = area
    return x >= left and y >= top and x + width <= right and y + height <= bottom


# Os códigos do WM_NCHITTEST.
HIT_NAMES = {1: "HTCLIENT", 2: "HTCAPTION", 10: "HTLEFT", 11: "HTRIGHT", 12: "HTTOP", 13: "HTTOPLEFT", 14: "HTTOPRIGHT",
             15: "HTBOTTOM", 16: "HTBOTTOMLEFT", 17: "HTBOTTOMRIGHT", -1: "HTTRANSPARENT", 0: "HTNOWHERE"}


def border_points(outer, client):
    """Os pontos (da tela) das bordas e dos cantos de baixo e o código do WM_NCHITTEST esperado em cada um.

    outer: a janela (x, y, largura, altura) do GetWindowRect, com as bordas invisíveis; client: a área cliente na tela.
    Os lados e o pé ficam nas bordas invisíveis (fora da área cliente). A borda de cima fica dentro da área cliente,
    em cima do WebView2: ela vale pela zona da interface (zone_points), conferida com um arrasto de verdade."""
    x, y, width, height = outer
    right = x + width - 3
    bottom = y + height - 3
    middle_y = y + height // 2
    middle_x = x + width // 2
    return {
        "canto de baixo a direita": ((right, bottom), 17),
        "canto de baixo a esquerda": ((x + 2, bottom), 16),
        "esquerda": ((x + 2, middle_y), 10),
        "direita": ((right, middle_y), 11),
        "baixo": ((middle_x, bottom), 15),
    }


def zone_points(client):
    """Os pontos (da tela) das zonas de redimensionar da interface: o meio da faixa de cima e o canto do desenho."""
    cx, cy, cwidth, cheight = client
    return {"cima": (cx + cwidth // 2, cy + 2), "baixo-direita": (cx + cwidth - 6, cy + cheight - 6)}


def absolute_mouse(x, y, screen):
    """O ponto (x, y) da tela nas coordenadas absolutas do SendInput (0 a 65535 na tela principal)."""
    width, height = screen
    return (round(x * 65535 / max(1, width - 1)), round(y * 65535 / max(1, height - 1)))


def window_size_for(client_logical, dpi, frame):
    """O tamanho da janela (físico, para o SetWindowPos) com a área da interface de client_logical pixels lógicos.

    frame: quanto a janela tem a mais que a área cliente (largura, altura), em pixels físicos."""
    width, height = client_logical
    return (round(width * dpi / 96.0) + frame[0], round(height * dpi / 96.0) + frame[1])


def logical_size(width, height, dpi):
    """O tamanho em pixels lógicos (96 DPI = 100%) de uma janela de width x height pixels físicos."""
    if dpi <= 0:
        raise ValueError("DPI invalido: %r" % dpi)
    return (round(width * 96.0 / dpi), round(height * 96.0 / dpi))


def near(actual, expected, tolerance=1):
    return all(abs(a - e) <= tolerance for a, e in zip(actual, expected))


def has_event(events, prefix):
    return any(event == prefix or event.startswith(prefix + " ") for event in events)


def count_events(events, name):
    return sum(1 for event in events if event == name or event.startswith(name + " "))


def log(text):
    print("[fumaca] " + text, flush=True)


def wait_for(condition, timeout, interval=0.25, pump=None):
    """Repete condition() até ela devolver algo verdadeiro ou o tempo acabar; pump(ms) espera (o Playwright precisa
    receber os eventos enquanto espera)."""
    deadline = time.monotonic() + timeout
    while True:
        value = condition()
        if value:
            return value
        if time.monotonic() >= deadline:
            return value
        if pump:
            pump(int(interval * 1000))
        else:
            time.sleep(interval)


# ---- Registrador falso ----

class Registrar:
    """O registrador falso (fake_registrar.py) e a porta de controle dele."""

    def __init__(self, control_port, port=5060, python=sys.executable, start=True, log_dir=None):
        self.control_port = control_port
        self.process = None
        if start:
            log_dir = pathlib.Path(log_dir or tempfile.mkdtemp(prefix="starsonic-registrador-"))
            command = [python, str(HERE / "fake_registrar.py"), "--port", str(port), "--user", RAMAL + "," + DESTINO,
                       "--password", SENHA, "--control-port", str(control_port),
                       "--log", str(log_dir / "user-agent.txt")]
            self.process = subprocess.Popen(command)
            if not wait_for(self._listening, 15):
                self.stop()
                raise SmokeFailure("o registrador falso nao abriu a porta de controle %d" % control_port)

    def _listening(self):
        if self.process and self.process.poll() is not None:
            raise SmokeFailure("o registrador falso saiu com o codigo %s" % self.process.returncode)
        try:
            with socket.create_connection(("127.0.0.1", self.control_port), timeout=1):
                return True
        except OSError:
            return False

    def command(self, line):
        """Manda um comando e devolve as linhas da resposta (o LOG vai até o END, que fica de fora)."""
        with socket.create_connection(("127.0.0.1", self.control_port), timeout=5) as connection:
            connection.sendall((line + "\n").encode("utf-8"))
            reader = connection.makefile("r", encoding="utf-8", newline="\n")
            if line.split()[0] != "LOG":
                return [reader.readline().rstrip("\r\n")]
            lines = []
            while True:
                current = reader.readline()
                if not current or current.rstrip("\r\n") == "END":
                    return lines
                lines.append(current.rstrip("\r\n"))

    def events(self):
        return self.command("LOG")

    def stop(self):
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(10)
            except subprocess.TimeoutExpired:
                self.process.kill()


# ---- Win32 (só no Windows) ----

class Win32:
    def __init__(self):
        import ctypes
        from ctypes import wintypes
        self.ctypes = ctypes
        self.wintypes = wintypes
        self.user32 = ctypes.WinDLL("user32", use_last_error=True)
        # As medidas em pixels físicos (sem a virtualização do DPI para este processo).
        try:
            self.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))   # PER_MONITOR_AWARE_V2
        except AttributeError:
            pass
        self.user32.GetForegroundWindow.restype = wintypes.HWND
        self.user32.GetDpiForWindow.argtypes = [wintypes.HWND]
        self.user32.GetDpiForWindow.restype = wintypes.UINT
        self.enum_proc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def windows(self, class_name, pid=None):
        found = []
        wintypes = self.wintypes

        def callback(hwnd, _):
            name = self.ctypes.create_unicode_buffer(256)
            self.user32.GetClassNameW(hwnd, name, 256)
            if name.value == class_name:
                owner = wintypes.DWORD()
                self.user32.GetWindowThreadProcessId(hwnd, self.ctypes.byref(owner))
                if pid is None or owner.value == pid:
                    found.append(hwnd)
            return True

        self.user32.EnumWindows(self.enum_proc(callback), 0)
        return found

    def rect(self, hwnd):
        value = self.wintypes.RECT()
        self.user32.GetWindowRect(hwnd, self.ctypes.byref(value))
        return (value.left, value.top, value.right - value.left, value.bottom - value.top)

    def client(self, hwnd):
        value = self.wintypes.RECT()
        self.user32.GetClientRect(hwnd, self.ctypes.byref(value))
        return (value.right - value.left, value.bottom - value.top)

    def client_box(self, hwnd):
        """A área cliente na tela: (x, y, largura, altura)."""
        origin = self.wintypes.POINT(0, 0)
        self.user32.ClientToScreen(hwnd, self.ctypes.byref(origin))
        width, height = self.client(hwnd)
        return (origin.x, origin.y, width, height)

    def hit_test(self, hwnd, x, y):
        """O WM_NCHITTEST da janela no ponto (x, y) da tela."""
        result = self.ctypes.c_size_t()
        lparam = ((y & 0xFFFF) << 16) | (x & 0xFFFF)
        self.user32.SendMessageTimeoutW.argtypes = [self.wintypes.HWND, self.wintypes.UINT, self.wintypes.WPARAM,
                                                    self.wintypes.LPARAM, self.wintypes.UINT, self.wintypes.UINT,
                                                    self.ctypes.POINTER(self.ctypes.c_size_t)]
        if not self.user32.SendMessageTimeoutW(hwnd, 0x0084, 0, lparam, 0x0002, 5000, self.ctypes.byref(result)):
            return None
        value = result.value & 0xFFFFFFFF
        return value - (1 << 32) if value >= (1 << 31) else value

    def window_from_point(self, x, y):
        self.user32.WindowFromPoint.argtypes = [self.wintypes.POINT]
        self.user32.WindowFromPoint.restype = self.wintypes.HWND
        return self.user32.WindowFromPoint(self.wintypes.POINT(x, y)) or 0

    def root(self, hwnd):
        self.user32.GetAncestor.argtypes = [self.wintypes.HWND, self.wintypes.UINT]
        self.user32.GetAncestor.restype = self.wintypes.HWND
        return self.user32.GetAncestor(hwnd, 2) or 0   # GA_ROOT

    def screen_size(self):
        return (int(self.user32.GetSystemMetrics(0)), int(self.user32.GetSystemMetrics(1)))

    def mouse(self, flags, x=None, y=None):
        """Um evento do mouse pelo SendInput (MOUSEEVENTF_*); com (x, y), absoluto na tela."""
        ctypes, wintypes = self.ctypes, self.wintypes

        class MOUSEINPUT(ctypes.Structure):
            _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD),
                        ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ctypes.c_size_t)]

        class INPUT(ctypes.Structure):
            _fields_ = [("type", wintypes.DWORD), ("mi", MOUSEINPUT)]

        dx = dy = 0
        if x is not None:
            dx, dy = absolute_mouse(x, y, self.screen_size())
            flags |= 0x0001 | 0x8000   # MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE
        event = INPUT(0, MOUSEINPUT(dx, dy, 0, flags, 0, 0))   # INPUT_MOUSE
        return int(self.user32.SendInput(1, ctypes.byref(event), ctypes.sizeof(INPUT)))

    def drag(self, start, end, steps=10):
        """Um arrasto de verdade com o botão esquerdo: aperta em start, anda até end e solta."""
        sent = self.mouse(0, *start)
        time.sleep(0.3)
        sent += self.mouse(0x0002)   # MOUSEEVENTF_LEFTDOWN
        time.sleep(0.6)               # o mousedown vai pela ponte até a janela, que começa o redimensionar
        for step in range(1, steps + 1):
            x = start[0] + (end[0] - start[0]) * step // steps
            y = start[1] + (end[1] - start[1]) * step // steps
            sent += self.mouse(0, x, y)
            time.sleep(0.05)
        time.sleep(0.3)
        sent += self.mouse(0x0004)   # MOUSEEVENTF_LEFTUP
        time.sleep(0.5)
        return sent

    def set_size(self, hwnd, width, height):
        """SetWindowPos com o tamanho (físico) da janela inteira, sem mover."""
        flags = 0x0002 | 0x0004 | 0x0010   # SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE
        return bool(self.user32.SetWindowPos(hwnd, None, 0, 0, width, height, flags))

    def dpi(self, hwnd):
        return int(self.user32.GetDpiForWindow(hwnd))

    def visible(self, hwnd):
        return bool(self.user32.IsWindowVisible(hwnd))

    def minimized(self, hwnd):
        return bool(self.user32.IsIconic(hwnd))

    def foreground(self):
        return self.user32.GetForegroundWindow() or 0

    def minimize(self, hwnd):
        self.user32.ShowWindow(hwnd, 6)   # SW_MINIMIZE

    def restore(self, hwnd):
        self.user32.ShowWindow(hwnd, 9)   # SW_RESTORE

    def device_change(self, hwnd):
        """WM_DEVICECHANGE com DBT_DEVNODES_CHANGED (o que o Windows manda quando um headset entra ou sai)."""
        result = self.wintypes.DWORD()
        self.user32.SendMessageTimeoutW.argtypes = [self.wintypes.HWND, self.wintypes.UINT, self.wintypes.WPARAM,
                                                    self.wintypes.LPARAM, self.wintypes.UINT, self.wintypes.UINT,
                                                    self.ctypes.POINTER(self.wintypes.DWORD)]
        # SMTO_ABORTIFHUNG, 5 s.
        return bool(self.user32.SendMessageTimeoutW(hwnd, 0x0219, 0x0007, 0, 0x0002, 5000, self.ctypes.byref(result)))

    def work_area(self):
        value = self.wintypes.RECT()
        self.user32.SystemParametersInfoW(0x0030, 0, self.ctypes.byref(value), 0)   # SPI_GETWORKAREA
        return (value.left, value.top, value.right, value.bottom)

    def set_work_area(self, area):
        value = self.wintypes.RECT(*area)
        # SPI_SETWORKAREA, com o WM_SETTINGCHANGE para as janelas abertas (SPIF_SENDCHANGE).
        if not self.user32.SystemParametersInfoW(0x002F, 0, self.ctypes.byref(value), 0x0002):
            raise SmokeFailure("SPI_SETWORKAREA %s recusado (erro %d)" % (area, self.ctypes.get_last_error()))

    def system_dpi(self):
        try:
            return int(self.user32.GetDpiForSystem())
        except AttributeError:
            return 96

    def describe(self, hwnd):
        if not hwnd:
            return "nenhuma"
        name = self.ctypes.create_unicode_buffer(256)
        self.user32.GetClassNameW(hwnd, name, 256)
        title = self.ctypes.create_unicode_buffer(256)
        self.user32.GetWindowTextW(hwnd, title, 256)
        return "0x%x [%s] '%s'" % (hwnd, name.value, title.value)


def webview_processes():
    """Quantos msedgewebview2.exe do app (a pasta de dados ...\\Starsonic Phone\\WebView2) estão abertos."""
    script = ("@(Get-CimInstance Win32_Process -Filter \"Name='msedgewebview2.exe'\" | Where-Object { "
              "$_.CommandLine -like '*Starsonic Phone\\WebView2*' }).Count")
    output = subprocess.run(["powershell", "-NoProfile", "-Command", script], capture_output=True, text=True,
                            timeout=60).stdout.strip()
    try:
        return int(output or "0")
    except ValueError:
        return 0


def count_lines(text, phrase):
    """Quantas linhas do diagnostico.log têm o texto."""
    return sum(1 for line in text.splitlines() if phrase in line)


def has_version_query(url):
    """A página do app aberta com a versão na URL (index.html?v=<versão>)."""
    query = url.split("#")[0].partition("?")[2]
    return any(part.startswith("v=") and len(part) > 2 for part in query.split("&"))


def browser_process(rows, app_pid):
    """O processo do navegador do WebView2 do app: o msedgewebview2.exe filho dele, sem --type= (os outros são os da
    página, da GPU...). rows: (pid, pid do pai, linha de comando)."""
    for pid, parent, command in rows:
        if parent == app_pid and "--type=" not in command:
            return pid
    return None


def webview_process_rows():
    """(pid, pid do pai, linha de comando) de cada msedgewebview2.exe do app."""
    script = ("Get-CimInstance Win32_Process -Filter \"Name='msedgewebview2.exe'\" | Where-Object { "
              "$_.CommandLine -like '*Starsonic Phone\\WebView2*' } | ForEach-Object { "
              "'{0}|{1}|{2}' -f $_.ProcessId, $_.ParentProcessId, $_.CommandLine }")
    output = subprocess.run(["powershell", "-NoProfile", "-Command", script], capture_output=True, text=True,
                            timeout=60).stdout
    rows = []
    for line in output.splitlines():
        parts = line.strip().split("|", 2)
        if len(parts) == 3 and parts[0].isdigit() and parts[1].isdigit():
            rows.append((int(parts[0]), int(parts[1]), parts[2]))
    return rows


def wait_app_gone(exe, timeout=40):
    """Fecha o app aberto (o que o instalador abriu, por exemplo) e espera o WebView2 dele sair: os argumentos da
    variável só valem para um WebView2 que ainda não está aberto."""
    subprocess.run([str(exe), "--sair"], timeout=30)
    if not wait_for(lambda: webview_processes() == 0, timeout, interval=1):
        raise SmokeFailure("o WebView2 de um app anterior continua aberto")


def cdp_ready():
    try:
        with urllib.request.urlopen(CDP_URL + "/json/version", timeout=2) as response:
            return json.loads(response.read().decode("utf-8"))
    except (OSError, ValueError):
        return None


def page_url(page):
    """A URL de agora da página. O Playwright só atualiza o page.url quando processa os eventos do CDP (o time.sleep
    não processa): uma página pega no meio da navegação ficaria about:blank para sempre; o location.href pergunta à
    página."""
    try:
        return page.evaluate("() => location.href")
    except Exception:   # noqa: BLE001 - a página ainda carregando, ou caindo
        return page.url


def find_page(browser, suffix, timeout, pump):
    def look():
        for context in browser.contexts:
            for page in context.pages:
                if page.url.split("?")[0].endswith(suffix) or page_url(page).split("?")[0].endswith(suffix):
                    return page
        return None

    page = wait_for(look, timeout, interval=0.5, pump=pump)
    if not page:
        urls = [page.url for context in browser.contexts for page in context.pages]
        raise SmokeFailure("a pagina %s nao abriu no WebView2 (paginas: %s)" % (suffix, urls))
    return page


class App:
    """O StarsonicPhone.exe aberto por este teste, com o CDP."""

    def __init__(self, exe, data_dir, extra_environment=None):
        self.exe = pathlib.Path(exe)
        environment = dict(os.environ)
        environment["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = browser_arguments()
        environment["STARSONIC_PERFIL"] = TEST_PROFILE
        environment["STARSONIC_SOM_NULO"] = "1"
        environment.update(extra_environment or {})
        log("abrindo %s --dados %s (%s)" % (self.exe, data_dir, environment["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"]))
        self.process = subprocess.Popen([str(self.exe), "--dados", str(data_dir)], env=environment,
                                        cwd=str(self.exe.parent))

    def quit(self):
        result = subprocess.run([str(self.exe), "--sair"], timeout=30)
        if result.returncode != 0:
            raise SmokeFailure("--sair terminou com o codigo %d" % result.returncode)
        try:
            code = self.process.wait(30)
        except subprocess.TimeoutExpired:
            raise SmokeFailure("o app nao fechou 30 s depois do --sair")
        if code != 0:
            raise SmokeFailure("o app fechou com o codigo %d" % code)

    def kill(self):
        if self.process.poll() is None:
            self.process.kill()


def connect(pw, timeout=90):
    if not wait_for(cdp_ready, timeout, interval=0.5):
        raise SmokeFailure("o DevTools do WebView2 nao respondeu em %s (%d s)" % (CDP_URL, timeout))
    log("CDP: %s" % cdp_ready().get("Browser"))
    return pw.chromium.connect_over_cdp(CDP_URL, timeout=30000)


def screenshot(page, folder, name, result):
    path = pathlib.Path(folder) / name
    page.screenshot(path=str(path), timeout=20000)
    result.setdefault("capturas", []).append(name)
    log("captura %s" % path)


def measure(win, hwnd, page):
    x, y, width, height = win.rect(hwnd)
    dpi = win.dpi(hwnd)
    client = win.client(hwnd)
    view = page.evaluate("() => ({dpr: window.devicePixelRatio, w: window.innerWidth, h: window.innerHeight})")
    return {
        "janela": [width, height],
        "posicao": [x, y],
        "cliente": list(client),
        "dpi": dpi,
        # O tamanho da janela é o da área da interface (a área cliente): as bordas de redimensionar ficam fora dela.
        "logicos": list(logical_size(client[0], client[1], dpi)),
        "area_cliente": list(win.client_box(hwnd)),
        "devicePixelRatio": view["dpr"],
        "viewport": [view["w"], view["h"]],
    }


def check_size(info, label, logical=LOGICAL_SIZE):
    if not near(info["logicos"], logical):
        raise SmokeFailure("%s: a janela tem %sx%s logicos (esperado %dx%d): %s"
                           % (label, info["logicos"][0], info["logicos"][1], logical[0], logical[1], info))
    # A interface ocupa a janela inteira: o viewport, na escala do WebView2, é a área cliente (sem moldura).
    drawn = [round(value * info["devicePixelRatio"]) for value in info["viewport"]]
    if not near(drawn, info["cliente"], tolerance=2):
        raise SmokeFailure("%s: a interface (%s pixels) nao ocupa a janela (%s): %s" % (label, drawn, info["cliente"], info))


LAYOUT_SCRIPT = """() => {
  const box = (e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; };
  const keys = Array.from(document.querySelectorAll('.keys .key')).map(box);
  const middle = document.querySelector('.teclado-meio');
  return {
    viewport: [innerWidth, innerHeight],
    keys,
    middle: box(middle),
    middleScrolls: middle.scrollHeight > middle.clientHeight + 0.5,
    call: box(document.querySelector('button.btn-call')),
    redial: document.querySelector('button.btn-redial') ? box(document.querySelector('button.btn-redial')) : null,
    layout: document.querySelector('.win').dataset.layout || null,
    nav: box(document.querySelector('nav.nav')),
  };
}"""


def check_keypad_layout(layout, label):
    """As 12 teclas, o Rediscar, o Ligar e a navegação inteiros na interface, nessa ordem, sem um cobrir o outro."""
    width, height = layout["viewport"]

    def visible(box):
        x, y, w, h = box
        return x >= -0.5 and y >= -0.5 and x + w <= width + 0.5 and y + h <= height + 0.5

    keys = layout["keys"]
    if len(keys) != 12 or not all(visible(key) for key in keys):
        raise SmokeFailure("%s: as teclas nao estao inteiras na interface: %s" % (label, layout))
    if layout["middleScrolls"]:
        raise SmokeFailure("%s: as teclas so aparecem rolando: %s" % (label, layout))
    for name in ("call", "redial", "nav"):
        if not layout.get(name) or not visible(layout[name]):
            raise SmokeFailure("%s: %s fora da interface: %s" % (label, name, layout))
    keys_bottom = max(key[1] + key[3] for key in keys)
    call, redial, nav = layout["call"], layout["redial"], layout["nav"]
    if keys_bottom > call[1] + 0.5 or call[1] + call[3] > nav[1] + 0.5:
        raise SmokeFailure("%s: o teclado, o Ligar e a navegacao se cobrem: %s" % (label, layout))
    if keys_bottom > redial[1] + 0.5 or redial[1] + redial[3] > nav[1] + 0.5 or redial[0] + redial[2] > call[0] + 0.5:
        raise SmokeFailure("%s: o Rediscar cobre o teclado, o Ligar ou a navegacao: %s" % (label, layout))


def main_window(win, pid, timeout=30):
    hwnd = wait_for(lambda: next(iter(win.windows(WINDOW_CLASS, pid)), None), timeout)
    if not hwnd:
        raise SmokeFailure("a janela de classe '%s' nao apareceu" % WINDOW_CLASS)
    return hwnd


def run_smoke(args, result):
    from playwright.sync_api import sync_playwright

    win = Win32()
    exe = pathlib.Path(args.exe).resolve()
    if not (exe.parent / "ui" / "index.html").is_file():
        raise SmokeFailure("a interface nao foi instalada: falta %s" % (exe.parent / "ui" / "index.html"))
    data_dir = pathlib.Path(tempfile.mkdtemp(prefix="starsonic-fumaca-"))
    result["dados"] = str(data_dir)
    capturas = pathlib.Path(args.capturas)
    wait_app_gone(exe)
    registrar = Registrar(args.controle, python=args.python)
    app = None
    try:
        with sync_playwright() as pw:
            # 1. Primeira abertura, a 100%.
            app = App(exe, data_dir)
            browser = connect(pw)
            page = find_page(browser, "/index.html", 60, lambda ms: time.sleep(ms / 1000.0))
            context_pump = page.wait_for_timeout
            hwnd = main_window(win, app.process.pid)
            result["janela"] = win.describe(hwnd)

            page.locator("#entrar-servidor").wait_for(timeout=60000)
            page.locator("#entrar-servidor").fill(SERVER)
            page.locator("#entrar-ramal").fill(RAMAL)
            page.locator("#entrar-senha").fill(SENHA)
            page.locator("form button[type=submit]").click()
            page.get_by_text(CONNECTED).first.wait_for(timeout=40000)
            log("entrou: '%s'" % CONNECTED)
            info = measure(win, hwnd, page)
            result["escala_100"] = info
            log("100%%: %s" % info)
            check_size(info, "100%")
            check_keypad_layout(page.evaluate(LAYOUT_SCRIPT), "100%")
            screenshot(page, capturas, "janela-principal.png", result)

            # 2. Ligação feita para 2002.
            page.locator('input[aria-label="Número"]').fill(DESTINO)
            page.locator("button.btn-call").click()
            page.get_by_text(IN_CALL, exact=True).first.wait_for(timeout=30000)
            if not wait_for(lambda: has_event(registrar.events(), "inv-in %s 200" % DESTINO), 20, pump=context_pump):
                raise SmokeFailure("o registrador nao atendeu a ligacao para %s: %s" % (DESTINO, registrar.events()))
            page.wait_for_timeout(1500)   # o cronômetro da ligação já corre
            screenshot(page, capturas, "ligacao.png", result)
            page.get_by_role("button", name="Desligar", exact=True).click()
            if not wait_for(lambda: count_events(registrar.events(), "bye-in") >= 1, 20, pump=context_pump):
                raise SmokeFailure("o BYE da ligacao para %s nao chegou: %s" % (DESTINO, registrar.events()))
            page.locator("button.btn-call").wait_for(timeout=20000)
            log("ligacao para %s: Em ligacao, o 200 e o BYE" % DESTINO)

            # 3. Ligação recebida com a janela minimizada: o aviso, o foco e o Atender do aviso.
            notice_page = find_page(browser, "/aviso.html", 30, context_pump)
            win.minimize(hwnd)
            if not wait_for(lambda: win.minimized(hwnd), 10, pump=context_pump):
                raise SmokeFailure("a janela principal nao minimizou")
            page.wait_for_timeout(1000)
            before = win.foreground()
            reply = registrar.command("RING " + RAMAL)
            if reply != ["OK"]:
                raise SmokeFailure("RING %s: %s" % (RAMAL, reply))
            notice = wait_for(lambda: next((h for h in win.windows(NOTICE_CLASS, app.process.pid) if win.visible(h)),
                                           None), 20, pump=context_pump)
            if not notice:
                raise SmokeFailure("o aviso de ligacao recebida nao apareceu")
            notice_page.locator('[role="alertdialog"]').wait_for(timeout=15000)
            name = notice_page.locator(".aviso-nome").inner_text()
            if name != CALLER_NAME:
                raise SmokeFailure("o aviso mostra '%s' (esperado '%s')" % (name, CALLER_NAME))
            page.wait_for_timeout(1000)
            after = win.foreground()
            notice_rect = win.rect(notice)
            result["aviso"] = {
                "janela": win.describe(notice),
                "posicao_tamanho": list(notice_rect),
                "primeiro_plano_antes": win.describe(before),
                "primeiro_plano_com_o_aviso": win.describe(after),
            }
            log("aviso %s em %s; primeiro plano antes %s, com o aviso %s"
                % (win.describe(notice), notice_rect, win.describe(before), win.describe(after)))
            if after != before:
                raise SmokeFailure("o aviso mudou a janela em primeiro plano: antes %s, depois %s"
                                   % (win.describe(before), win.describe(after)))
            screenshot(notice_page, capturas, "aviso.png", result)
            notice_page.get_by_role("button", name="Atender").click()
            if not wait_for(lambda: has_event(registrar.events(), "inv-out %s 200" % RAMAL), 20, pump=context_pump):
                raise SmokeFailure("a ligacao recebida nao foi atendida pelo aviso: %s" % registrar.events())
            restored = wait_for(lambda: win.visible(hwnd) and not win.minimized(hwnd), 10, pump=context_pump)
            page.get_by_text(IN_CALL, exact=True).first.wait_for(timeout=20000)
            hidden = wait_for(lambda: not win.visible(notice), 10, pump=context_pump)
            answered = win.foreground()
            result["aviso"].update({
                "primeiro_plano_depois_de_atender": win.describe(answered),
                "janela_principal_na_frente": answered == hwnd,
                "janela_principal_restaurada": bool(restored),
                "aviso_escondido_depois_de_atender": bool(hidden),
            })
            log("depois do Atender: primeiro plano %s, principal restaurada %s, aviso escondido %s"
                % (win.describe(answered), bool(restored), bool(hidden)))
            if not restored:
                raise SmokeFailure("a janela principal nao voltou depois do Atender do aviso")
            if not hidden:
                raise SmokeFailure("o aviso continua visivel depois do Atender")
            page.get_by_role("button", name="Desligar", exact=True).click()
            if not wait_for(lambda: count_events(registrar.events(), "bye-in") >= 2, 20, pump=context_pump):
                raise SmokeFailure("o BYE da ligacao recebida nao chegou: %s" % registrar.events())
            page.locator("button.btn-call").wait_for(timeout=20000)
            result["registrador"] = registrar.events()
            browser.close()
            app.quit()
            log("fechou com --sair")

            # 4. A área de trabalho baixa (a de 1920x1080 a 150% tem uns 672 lógicos; aqui, 640): a janela cabe nela.
            if not wait_for(lambda: webview_processes() == 0, 40, interval=1):
                raise SmokeFailure("o WebView2 da primeira abertura nao saiu")
            original = win.work_area()
            short = short_work_area(original, SHORT_HEIGHT, win.system_dpi())
            try:
                win.set_work_area(short)
                log("area de trabalho %s -> %s" % (original, win.work_area()))
                app = App(exe, data_dir)
                browser = connect(pw)
                page = find_page(browser, "/index.html", 60, lambda ms: time.sleep(ms / 1000.0))
                hwnd = main_window(win, app.process.pid)
                page.get_by_text(CONNECTED).first.wait_for(timeout=40000)
                page.wait_for_timeout(500)
                info = measure(win, hwnd, page)
                layout = page.evaluate(LAYOUT_SCRIPT)
                result["area_curta"] = dict(info, area_de_trabalho=list(short), interface=layout)
                log("area curta: %s" % info)
                if not inside(tuple(info["area_cliente"]), short):
                    raise SmokeFailure("a janela %s nao cabe na area de trabalho %s" % (info, short))
                check_size(info, "area curta", (LOGICAL_SIZE[0], SHORT_HEIGHT))
                check_keypad_layout(layout, "area curta")
                screenshot(page, capturas, "janela-principal-curta.png", result)
                # A área de trabalho volta (o WM_SETTINGCHANGE): a janela volta aos 720.
                win.set_work_area(original)
                if not wait_for(lambda: near(logical_size(*win.client(hwnd), win.dpi(hwnd)), LOGICAL_SIZE), 10,
                                pump=page.wait_for_timeout):
                    raise SmokeFailure("a janela nao voltou aos 720 com a area de trabalho de volta: %s"
                                       % measure(win, hwnd, page))
                page.wait_for_timeout(500)
                info = measure(win, hwnd, page)
                result["area_restaurada"] = info
                log("area de volta: %s" % info)
                check_size(info, "area de volta")
            finally:
                win.set_work_area(original)
            browser.close()
            app.quit()
            app = None
            log("OK: entrou, ligou, desligou, recebeu pelo aviso e coube na area de trabalho baixa")

            # 6b. O tamanho da janela (rc.2).
            problems = []
            run_resize(pw, win, exe, data_dir, capturas, result, problems)
            if problems:
                raise SmokeFailure("; ".join(problems))
            log("OK: as bordas redimensionam, o Compacto e o Minimo cabem, o minimo segura e o tamanho volta")

            # 7 e 8. A recuperação do WebView2, os dispositivos de som e o fechamento com o Sair travado.
            app = run_recovery(pw, win, exe, data_dir, registrar, capturas, result, problems)
            app = None
            if problems:
                raise SmokeFailure("; ".join(problems))
            log("OK: versao na URL, dispositivos relidos, o WebView2 voltou duas vezes e o Sair travado fechou")
    finally:
        if app:
            app.kill()
        registrar.stop()
        show_log(data_dir / "diagnostico.log")


PAGE_STATE_SCRIPT = """() => ({
  url: location.href,
  viewport: [innerWidth, innerHeight],
  dpr: devicePixelRatio,
  layout: (document.querySelector('.win') || {dataset: {}}).dataset.layout || null,
  pronto: document.body.dataset.pronto || null,
  texto: (document.querySelector('header') || document.body).innerText.slice(0, 300),
})"""


def wait_connected(page, capturas, result, label, timeout=40000):
    """Espera o "Conectado" na interface; sem ele, guarda o que a página mostrava (e uma captura) antes de falhar."""
    try:
        page.get_by_text(CONNECTED).first.wait_for(timeout=timeout)
    except Exception:
        try:
            state = page.evaluate(PAGE_STATE_SCRIPT)
        except Exception as error:   # noqa: BLE001
            state = {"erro": str(error)}
        result.setdefault("sem_conectado", {})[label] = state
        log("%s: sem '%s' na interface: %s" % (label, CONNECTED, state))
        try:
            screenshot(page, capturas, "sem-conectado-%s.png" % label.replace(" ", "-"), result)
        except Exception:   # noqa: BLE001
            pass
        raise


def resize_to(win, hwnd, page, client_logical):
    """Muda a janela para a área da interface de client_logical lógicos e espera o viewport seguir."""
    x, y, width, height = win.rect(hwnd)
    client = win.client(hwnd)
    frame = (width - client[0], height - client[1])
    target = window_size_for(client_logical, win.dpi(hwnd), frame)
    if not win.set_size(hwnd, *target):
        raise SmokeFailure("SetWindowPos %s recusado" % (target,))
    wanted = list(client_logical)
    wait_for(lambda: near(measure(win, hwnd, page)["viewport"], wanted), 10, pump=page.wait_for_timeout)
    page.wait_for_timeout(700)   # o layout novo e o tamanho gravado (500 ms depois do último WM_SIZE)
    return measure(win, hwnd, page)


def drag_zone(win, hwnd, page, data_dir, edge, delta, record, problems):
    """Arrasta a zona `edge` da interface por `delta` pixels e confere que a janela mudou de tamanho.

    Se o SendInput nem chega à página (nenhum "redimensionar: <borda>" no diagnóstico), o mousedown vai pelo CDP na
    zona e só a chegada do "resize" ao C++ é conferida (o tamanho não muda sem o botão apertado de verdade)."""
    client = win.client_box(hwnd)
    start = zone_points(client)[edge]
    end = (start[0] + delta[0], start[1] + delta[1])
    owner = win.window_from_point(*start)
    line = "redimensionar: %s" % edge
    before = count_lines(read_log(data_dir), line)
    sent = win.drag(start, end)
    page.wait_for_timeout(500)
    after = win.client_box(hwnd)
    reached = count_lines(read_log(data_dir), line) > before
    info = {"ponto": list(start), "janela_no_ponto": win.describe(owner), "da_janela": win.root(owner) == hwnd,
            "sendinput": sent, "antes": list(client), "depois": list(after), "resize_chegou": reached}
    record[edge] = info
    log("arrasto %s: %s" % (edge, info))
    if win.root(owner) != hwnd:
        problems.append("o ponto da zona %s %s e de %s, nao da janela do app" % (edge, start, win.describe(owner)))
    changed_width = abs(after[2] - client[2]) >= 20
    changed_height = abs(after[3] - client[3]) >= 20
    changed = changed_height if edge == "cima" else (changed_width and changed_height)
    if reached:
        if not changed:
            problems.append("o arrasto na zona %s chegou ao C++ e a janela nao mudou de tamanho: %s -> %s"
                            % (edge, client, after))
        return
    # O SendInput não chegou à página no runner: o mousedown pelo CDP.
    zone = page.locator('[data-resize="%s"]' % edge)
    box = zone.bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    page.mouse.up()
    arrived = wait_for(lambda: count_lines(read_log(data_dir), line) > before, 10, pump=page.wait_for_timeout)
    info.update({"pelo_cdp": True, "resize_chegou_pelo_cdp": bool(arrived)})
    log("arrasto %s: o SendInput nao chegou a pagina; pelo CDP: %s" % (edge, bool(arrived)))
    if not arrived:
        problems.append("o mousedown na zona %s nao mandou o resize ao C++ ('%s' no diagnostico.log)" % (edge, line))


def run_resize(pw, win, exe, data_dir, capturas, result, problems):
    """O item 6b: as bordas, os layouts Compacto e Mínimo, o mínimo e o tamanho gravado. Os problemas vão para
    problems."""
    sleep = lambda ms: time.sleep(ms / 1000.0)   # noqa: E731
    resize = result.setdefault("tamanho", {})
    app = App(exe, data_dir)
    try:
        browser = connect(pw)
        page = find_page(browser, "/index.html", 60, sleep)
        hwnd = main_window(win, app.process.pid)
        page.get_by_text(CONNECTED).first.wait_for(timeout=40000)
        page.wait_for_timeout(500)

        # As bordas e os cantos: o WM_NCHITTEST e quem está no canto de baixo a direita.
        outer = win.rect(hwnd)
        client = win.client_box(hwnd)
        hits = {}
        for name, ((x, y), expected) in border_points(outer, client).items():
            code = win.hit_test(hwnd, x, y)
            hits[name] = HIT_NAMES.get(code, str(code))
            if code != expected:
                problems.append("WM_NCHITTEST %s (%d, %d): %s (esperado %s)"
                                % (name, x, y, hits[name], HIT_NAMES[expected]))
        corner = border_points(outer, client)["canto de baixo a direita"][0]
        owner = win.window_from_point(*corner)
        resize["bordas"] = dict(hits, janela=list(outer), area_cliente=list(client),
                                canto_de_baixo_a_direita=win.describe(owner))
        log("bordas: %s" % resize["bordas"])
        if owner != hwnd:
            problems.append("o canto de baixo a direita e de %s, nao da janela %s (o WebView2 engole a borda)"
                            % (win.describe(owner), win.describe(hwnd)))

        # A faixa de cima e o canto do desenho: zonas da interface, em cima do WebView2, com um arrasto de verdade.
        resize["arrastos"] = {}
        for edge, delta in (("cima", (0, 50)), ("baixo-direita", (-40, -40))):
            drag_zone(win, hwnd, page, data_dir, edge, delta, resize["arrastos"], problems)
        resize_to(win, hwnd, page, LOGICAL_SIZE)

        # O Compacto e o Mínimo.
        for size, expected, name in (((340, 560), "compacto", "janela-compacta.png"),
                                     ((300, 440), "minimo", "janela-minima.png")):
            info = resize_to(win, hwnd, page, size)
            layout = page.evaluate(LAYOUT_SCRIPT)
            resize["%dx%d" % size] = dict(info, interface=layout)
            log("%dx%d: %s, layout %s" % (size[0], size[1], info, layout.get("layout")))
            if not near(info["logicos"], size):
                problems.append("a janela pedida em %dx%d ficou com %s logicos" % (size[0], size[1], info["logicos"]))
            if layout.get("layout") != expected:
                problems.append("em %dx%d o layout e %s (esperado %s)" % (size[0], size[1], layout.get("layout"), expected))
            try:
                check_keypad_layout(layout, "%dx%d" % size)
            except SmokeFailure as error:
                problems.append(str(error))
            screenshot(page, capturas, name, result)

        # Abaixo do mínimo: a janela fica nos 300x440.
        info = resize_to(win, hwnd, page, (200, 300))
        resize["abaixo_do_minimo"] = info
        log("pedido 200x300: %s" % info)
        if not near(info["logicos"], (300, 440)):
            problems.append("a janela foi abaixo do minimo de 300x440: %s logicos" % info["logicos"])

        # O tamanho gravado volta depois de fechar e abrir.
        resize_to(win, hwnd, page, (340, 560))
        page.wait_for_timeout(1000)
        browser.close()
        app.quit()
        app = None
        if not wait_for(lambda: webview_processes() == 0, 40, interval=1):
            problems.append("o WebView2 antes de abrir de novo nao saiu")
        app = App(exe, data_dir)
        browser = connect(pw)
        page = find_page(browser, "/index.html", 60, sleep)
        hwnd = main_window(win, app.process.pid)
        page.get_by_text(CONNECTED).first.wait_for(timeout=40000)
        page.wait_for_timeout(500)
        info = measure(win, hwnd, page)
        resize["depois_de_abrir_de_novo"] = info
        log("aberto de novo: %s" % info)
        if not near(info["logicos"], (340, 560)):
            problems.append("o tamanho gravado (340x560) nao voltou: %s logicos" % info["logicos"])
        # De volta ao padrão para o resto da fumaça.
        info = resize_to(win, hwnd, page, LOGICAL_SIZE)
        if not near(info["logicos"], LOGICAL_SIZE):
            problems.append("a janela nao voltou aos 400x720: %s" % info["logicos"])
        page.wait_for_timeout(1000)
        browser.close()
        app.quit()
        app = None
        if not wait_for(lambda: webview_processes() == 0, 40, interval=1):
            problems.append("o WebView2 do teste do tamanho nao saiu")
    finally:
        if app:
            app.kill()


def read_log(data_dir):
    try:
        return (pathlib.Path(data_dir) / "diagnostico.log").read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def ring_and_reject(win, hwnd, browser, registrar, pump, label, problems):
    """Um RING com a janela minimizada: o aviso aparece e o Recusar dele recusa (486). False se nao deu."""
    notice_page = find_page(browser, "/aviso.html", 30, pump)
    win.minimize(hwnd)
    wait_for(lambda: win.minimized(hwnd), 10, pump=pump)
    refused_before = count_events(registrar.events(), "inv-out %s 486" % RAMAL)
    reply = registrar.command("RING " + RAMAL)
    if reply != ["OK"]:
        problems.append("%s: RING %s: %s" % (label, RAMAL, reply))
        return False
    notice = wait_for(lambda: next((h for h in win.windows(NOTICE_CLASS) if win.visible(h)), None), 20, pump=pump)
    if not notice:
        problems.append("%s: o aviso de ligacao recebida nao apareceu" % label)
        return False
    try:
        notice_page.locator('[role="alertdialog"]').wait_for(timeout=15000)
        notice_page.get_by_role("button", name="Recusar").click(timeout=10000)
    except Exception as error:   # noqa: BLE001
        problems.append("%s: o aviso nao recusou: %s" % (label, error))
        return False
    if not wait_for(lambda: count_events(registrar.events(), "inv-out %s 486" % RAMAL) > refused_before, 20, pump=pump):
        problems.append("%s: o Recusar do aviso nao chegou ao registrador: %s" % (label, registrar.events()))
        return False
    wait_for(lambda: not win.visible(notice), 10, pump=pump)
    # A janela volta do minimizado: o WebView2 que abrir depois (o navegador novo) pega o tamanho de verdade da área
    # da interface, e não o da janela minimizada (com ele, a interface cairia no layout Mínimo).
    win.restore(hwnd)
    wait_for(lambda: not win.minimized(hwnd), 10, pump=pump)
    log("%s: o RING mostrou o aviso e o Recusar dele recusou" % label)
    return True


def wait_interface_again(data_dir, ready_before, timeout):
    """Espera o diagnostico.log ter mais um "interface pronta" que antes."""
    return wait_for(lambda: count_lines(read_log(data_dir), "interface pronta") > ready_before, timeout, interval=0.5)


def run_recovery(pw, win, exe, data_dir, registrar, capturas, result, problems):
    """Os itens 7 e 8 da fumaça. Os problemas vão para problems; devolve None (o app já fechou)."""
    sleep = lambda ms: time.sleep(ms / 1000.0)   # noqa: E731
    recovery = result.setdefault("recuperacao", {})
    app = App(exe, data_dir)
    try:
        browser = connect(pw)
        page = find_page(browser, "/index.html", 60, sleep)
        hwnd = main_window(win, app.process.pid)
        page.get_by_text(CONNECTED).first.wait_for(timeout=40000)
        notice_page = find_page(browser, "/aviso.html", 30, page.wait_for_timeout)
        recovery["urls"] = [page.url, notice_page.url]
        log("paginas: %s" % recovery["urls"])
        for url in recovery["urls"]:
            if not has_version_query(url):
                problems.append("a pagina %s abriu sem a versao na URL (?v=)" % url)

        # Os dispositivos de som: tres avisos seguidos viram uma releitura so, fora da thread da janela.
        before = count_lines(read_log(data_dir), "som: os dispositivos foram relidos")
        for _ in range(3):
            if not win.device_change(hwnd):
                problems.append("WM_DEVICECHANGE nao foi entregue a janela")
            page.wait_for_timeout(200)
        page.wait_for_timeout(3000)
        rereads = count_lines(read_log(data_dir), "som: os dispositivos foram relidos") - before
        recovery["releituras_de_som"] = rereads
        log("WM_DEVICECHANGE x3: %d releitura(s) dos dispositivos de som" % rereads)
        if rereads != 1:
            problems.append("tres WM_DEVICECHANGE seguidos releram os dispositivos de som %d vez(es) (esperado 1)"
                            % rereads)

        # A pagina cai (o processo dela): ela volta e o aviso ainda aparece.
        ready_before = count_lines(read_log(data_dir), "interface pronta")
        try:
            page.context.new_cdp_session(page).send("Page.crash")
        except Exception as error:   # noqa: BLE001 - a sessao cai junto com a pagina
            log("Page.crash: %s" % type(error).__name__)
        if not wait_interface_again(data_dir, ready_before, 45):
            problems.append("a interface nao voltou depois de a pagina cair (Page.crash)")
        else:
            # A pagina que caiu fica marcada no Playwright: liga de novo pelo CDP para ver a que voltou.
            try:
                browser.close()
            except Exception:   # noqa: BLE001
                pass
            browser = connect(pw)
            page = find_page(browser, "/index.html", 30, sleep)
            page.get_by_text(CONNECTED).first.wait_for(timeout=30000)
            recovery["pagina_caiu"] = ring_and_reject(win, hwnd, browser, registrar, page.wait_for_timeout,
                                                      "depois do Page.crash", problems)

        # O navegador do WebView2 sai (o processo morto): o app abre outro, e a interface e o aviso voltam.
        rows = webview_process_rows()
        pid = browser_process(rows, app.process.pid)
        recovery["navegador"] = pid
        if not pid:
            problems.append("o processo do navegador do WebView2 do app nao foi achado: %s" % rows)
        else:
            ready_before = count_lines(read_log(data_dir), "interface pronta")
            restarts_before = count_lines(read_log(data_dir), "navegador reiniciado")
            try:
                browser.close()
            except Exception:   # noqa: BLE001
                pass
            subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True, timeout=30)
            log("navegador do WebView2 (PID %d) encerrado" % pid)
            back = wait_for(lambda: count_lines(read_log(data_dir), "navegador reiniciado") > restarts_before and
                            count_lines(read_log(data_dir), "interface pronta") > ready_before, 60, interval=0.5)
            if not back:
                problems.append("a interface nao voltou depois de o navegador do WebView2 sair")
            elif app.process.poll() is not None:
                problems.append("o app fechou depois de o navegador do WebView2 sair (codigo %s)" % app.process.returncode)
            else:
                browser = connect(pw)
                page = find_page(browser, "/index.html", 60, sleep)
                wait_connected(page, capturas, result, "navegador novo")
                if not has_version_query(page.url):
                    problems.append("depois do navegador novo, a pagina abriu sem a versao na URL: %s" % page.url)
                recovery["navegador_saiu"] = ring_and_reject(win, hwnd, browser, registrar, page.wait_for_timeout,
                                                             "depois do navegador novo", problems)
                screenshot(page, capturas, "navegador-reiniciado.png", result)
        try:
            browser.close()
        except Exception:   # noqa: BLE001
            pass
        app.quit()
        log("fechou com --sair")

        # 8. O Sair do menu da interface com a thread de comandos travada: o app fecha mesmo assim.
        if not wait_for(lambda: webview_processes() == 0, 40, interval=1):
            problems.append("o WebView2 da abertura anterior nao saiu")
        forced_before = count_lines(read_log(data_dir), "fechamento forcado")
        app = App(exe, data_dir, {"STARSONIC_TRAVAR_SAIR": "1"})
        browser = connect(pw)
        page = find_page(browser, "/index.html", 60, sleep)
        page.get_by_text(CONNECTED).first.wait_for(timeout=40000)
        page.locator('button[aria-label="Menu"]').click()
        page.get_by_role("menuitem", name="Sair").click()
        started = time.monotonic()
        try:
            code = app.process.wait(40)
        except subprocess.TimeoutExpired:
            code = None
        took = time.monotonic() - started
        recovery["sair_travado"] = {"codigo": code, "segundos": round(took, 1)}
        log("Sair com a thread de comandos travada: codigo %s em %.1f s" % (code, took))
        try:
            browser.close()
        except Exception:   # noqa: BLE001
            pass
        if code is None:
            problems.append("o app nao fechou 40 s depois do Sair com a thread de comandos travada")
            app.kill()
            app.process.wait(30)
        else:
            if code != 0:
                problems.append("o Sair travado fechou com o codigo %s" % code)
            if took > 25:
                problems.append("o Sair travado levou %.1f s para fechar (limite 25)" % took)
        if count_lines(read_log(data_dir), "fechamento forcado") <= forced_before:
            problems.append("o diagnostico.log nao tem o 'fechamento forcado' do Sair travado")
        # Abre de novo: o mutex saiu junto com o processo.
        if not wait_for(lambda: webview_processes() == 0, 40, interval=1):
            problems.append("o WebView2 do app travado nao saiu")
        app = App(exe, data_dir)
        browser = connect(pw)
        page = find_page(browser, "/index.html", 60, sleep)
        page.get_by_text(CONNECTED).first.wait_for(timeout=40000)
        log("o app abriu de novo depois do Sair travado")
        browser.close()
        app.quit()
        app = None
    finally:
        if app:
            app.kill()
    return None


def run_rehearsal(args, result):
    from playwright.sync_api import sync_playwright

    exe = pathlib.Path(args.exe).resolve()
    data_dir = pathlib.Path(os.environ["APPDATA"]) / "Starsonic Phone"
    capturas = pathlib.Path(args.capturas)
    registrar = Registrar(args.controle, start=False)
    try:
        with sync_playwright() as pw:
            browser = connect(pw, timeout=120)
            page = find_page(browser, "/index.html", 60, lambda ms: time.sleep(ms / 1000.0))
            page.get_by_text(CONNECTED).first.wait_for(timeout=60000)
            log("o app novo abriu '%s' com a conta da rc.7" % CONNECTED)
            # O registro do app novo (os de antes, args.registros_antes, são da rc.7).
            if not wait_for(lambda: int(registrar.command("REGISTERS " + RAMAL)[0]) > args.registros_antes, 30,
                            pump=page.wait_for_timeout):
                raise SmokeFailure("o registrador nao recebeu o registro do app novo (so os %d da rc.7)"
                                   % args.registros_antes)
            screenshot(page, capturas, "ensaio-conectado.png", result)
            page.locator("nav.nav button", has_text="Contatos").click()
            page.get_by_text(args.contato, exact=True).first.wait_for(timeout=20000)
            log("o contato '%s' veio da rc.7" % args.contato)
            screenshot(page, capturas, "ensaio-contatos.png", result)
            result["ensaio"] = {"conectado": True, "contato": args.contato,
                                "registros": registrar.command("REGISTERS " + RAMAL)[0]}
            browser.close()
        result_quit = subprocess.run([str(exe), "--sair"], timeout=30)
        if result_quit.returncode != 0:
            raise SmokeFailure("--sair terminou com o codigo %d" % result_quit.returncode)
    finally:
        show_log(data_dir / "diagnostico.log")


def show_log(path):
    path = pathlib.Path(path)
    print("--- %s ---" % path, flush=True)
    try:
        print(path.read_text(encoding="utf-8", errors="replace"), flush=True)
    except OSError as error:
        print("(sem o log: %s)" % error, flush=True)
    print("--- fim do diagnostico.log ---", flush=True)


def main(argv):
    parser = argparse.ArgumentParser(description="Fumaca do app novo pelo CDP do WebView2.")
    parser.add_argument("--exe", required=True, help="o StarsonicPhone.exe instalado")
    parser.add_argument("--capturas", default="capturas-windows")
    parser.add_argument("--controle", type=int, default=5070, help="porta de controle do registrador falso")
    parser.add_argument("--python", default=sys.executable, help="o Python que roda o registrador falso")
    parser.add_argument("--ensaio", action="store_true", help="o ensaio da atualizacao da rc.7 (app ja aberto)")
    parser.add_argument("--contato", default="Ana Ensaio", help="no ensaio: o contato que veio da rc.7")
    parser.add_argument("--registros-antes", type=int, default=0,
                        help="no ensaio: quantos REGISTER do ramal o registrador aceitou antes do app novo (os da rc.7)")
    args = parser.parse_args(argv)
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")   # o console do Windows pode não ter os acentos
        except AttributeError:
            pass
    pathlib.Path(args.capturas).mkdir(parents=True, exist_ok=True)
    result = {"modo": "ensaio" if args.ensaio else "fumaca"}
    code = 0
    try:
        (run_rehearsal if args.ensaio else run_smoke)(args, result)
        result["ok"] = True
    except Exception as error:   # noqa: BLE001 - qualquer falha reprova o teste com a mensagem
        result["ok"] = False
        result["erro"] = "%s: %s" % (type(error).__name__, error)
        print("FALHOU: " + result["erro"], flush=True)
        if os.environ.get("GITHUB_ACTIONS") == "true":
            text = str(error).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
            print("::error title=windows_smoke::" + text, flush=True)
        code = 1
    (pathlib.Path(args.capturas) / ("resultado-%s.json" % result["modo"])).write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
