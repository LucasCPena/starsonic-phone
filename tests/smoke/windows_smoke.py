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
6. fecha com --sair e abre de novo com --force-device-scale-factor=1.5: a janela continua com 400x720 lógicos, o
   WebView2 desenha a 1,5 e a interface ocupa a janela inteira; captura janela-principal-150.png; fecha com --sair.
Na escala de 100%, a janela também tem 400x720 lógicos.

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
SCALE_ARGUMENT = "--force-device-scale-factor=1.5"
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


def browser_arguments(scale=False):
    """O valor de WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: o CDP na 9333, o argumento do app e, na rodada de 150%, a
    escala forçada."""
    parts = [DEBUG_ARGUMENT, APP_ARGUMENT]
    if scale:
        parts.append(SCALE_ARGUMENT)
    return " ".join(parts)


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


def find_page(browser, suffix, timeout, pump):
    def look():
        for context in browser.contexts:
            for page in context.pages:
                if page.url.split("?")[0].endswith(suffix):
                    return page
        return None

    page = wait_for(look, timeout, interval=0.5, pump=pump)
    if not page:
        urls = [page.url for context in browser.contexts for page in context.pages]
        raise SmokeFailure("a pagina %s nao abriu no WebView2 (paginas: %s)" % (suffix, urls))
    return page


class App:
    """O StarsonicPhone.exe aberto por este teste, com o CDP."""

    def __init__(self, exe, data_dir, scale=False):
        self.exe = pathlib.Path(exe)
        environment = dict(os.environ)
        environment["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = browser_arguments(scale)
        environment["STARSONIC_PERFIL"] = TEST_PROFILE
        environment["STARSONIC_SOM_NULO"] = "1"
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
        "logicos": list(logical_size(width, height, dpi)),
        "devicePixelRatio": view["dpr"],
        "viewport": [view["w"], view["h"]],
    }


def check_size(info, dpr, label):
    if not near(info["logicos"], LOGICAL_SIZE):
        raise SmokeFailure("%s: a janela tem %sx%s logicos (esperado %dx%d): %s"
                           % (label, info["logicos"][0], info["logicos"][1], LOGICAL_SIZE[0], LOGICAL_SIZE[1], info))
    if abs(info["devicePixelRatio"] - dpr) > 0.01:
        raise SmokeFailure("%s: o WebView2 desenha a %s (esperado %s): %s" % (label, info["devicePixelRatio"], dpr, info))
    # A interface ocupa a janela inteira: o viewport, na escala do WebView2, é a área cliente (sem moldura).
    drawn = [round(value * info["devicePixelRatio"]) for value in info["viewport"]]
    if not near(drawn, info["cliente"], tolerance=2):
        raise SmokeFailure("%s: a interface (%s pixels) nao ocupa a janela (%s): %s" % (label, drawn, info["cliente"], info))


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
            check_size(info, 1.0, "100%")
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

            # 4. A escala de 150% (forçada no WebView2).
            if not wait_for(lambda: webview_processes() == 0, 40, interval=1):
                raise SmokeFailure("o WebView2 da primeira abertura nao saiu")
            app = App(exe, data_dir, scale=True)
            browser = connect(pw)
            page = find_page(browser, "/index.html", 60, lambda ms: time.sleep(ms / 1000.0))
            hwnd = main_window(win, app.process.pid)
            page.get_by_text(CONNECTED).first.wait_for(timeout=40000)
            info = measure(win, hwnd, page)
            result["escala_150"] = info
            log("150%%: %s" % info)
            check_size(info, 1.5, "150%")
            screenshot(page, capturas, "janela-principal-150.png", result)
            browser.close()
            app.quit()
            app = None
            log("OK: entrou, ligou, desligou, recebeu pelo aviso e abriu a 150%")
    finally:
        if app:
            app.kill()
        registrar.stop()
        show_log(data_dir / "diagnostico.log")


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
            if registrar.command("REGISTERS " + RAMAL) == ["0"]:
                raise SmokeFailure("o registrador nao recebeu o registro do app novo")
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
