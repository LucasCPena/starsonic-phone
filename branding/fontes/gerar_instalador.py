#!/usr/bin/env python3
"""Gera as imagens das páginas do instalador novo (spec da W1, canvas "Instalador") a partir do logo negativo e do
gradient-hero do design system Starsonic.

Entradas (as mesmas da interface do app novo):
- windows/ui/assets/starsonic-logo-negativo.png   logo oficial para fundo escuro (2560x777)
- windows/ui/assets/PlusJakartaSans-Variable.woff2 a fonte da marca (OFL)
Saídas (BMP de 24 bits, o que o NSIS lê):
- branding/installer/lateral.bmp    164x314: a lateral das páginas de boas-vindas e de fim (MUI2), no gradient-hero,
                                    com o brilho ciano do canto, o logo, "Starsonic Phone" e a frase do canvas
- branding/installer/cabecalho.bmp  150x57: a imagem do cabeçalho das outras páginas, com o logo

Precisa de Python 3 com Pillow e Playwright (com o Chromium instalado), que não fazem parte do build: rode à mão
quando mudar o logo ou o desenho. Uso: python3 branding/fontes/gerar_instalador.py
"""
import base64
import io
import pathlib

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
ASSETS = ROOT / "windows" / "ui" / "assets"
OUT = ROOT / "branding" / "installer"

# Os tokens do design system (windows/ui/src/app.css).
GRADIENT_HERO = "linear-gradient(150deg, #070b18 0%, #0a1330 48%, #0c2671 100%)"
CYAN = "#00c2cb"
GLOW = "radial-gradient(circle, rgba(0, 194, 203, 0.22), rgba(0, 194, 203, 0) 62%)"

STYLE = """
@font-face { font-family: 'Plus Jakarta Sans'; src: url('%(font)s') format('woff2'); font-weight: 300 800; }
* { box-sizing: border-box; margin: 0; }
html, body { background: #070b18; }
body { font-family: 'Plus Jakarta Sans', sans-serif; -webkit-font-smoothing: antialiased; }
.panel { position: relative; overflow: hidden; background: %(hero)s; color: #ffffff; }
.glow { position: absolute; border-radius: 50%%; background: %(glow)s; pointer-events: none; }
.logo { position: relative; z-index: 1; display: block; height: auto; }
.eyebrow { display: flex; align-items: center; gap: 7px; font-size: 8.5px; font-weight: 700; letter-spacing: 0.14em;
           text-transform: uppercase; color: %(cyan)s; }
.eyebrow::before { content: ""; width: 18px; height: 2px; border-radius: 2px; background: %(cyan)s; flex: none; }
.headline { font-size: 17px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.15; color: #ffffff; }
.headline em { font-style: normal; color: %(cyan)s; }
"""

SIDE = """
<div id="arte" class="panel" style="width: 164px; height: 314px; display: flex; flex-direction: column;
     justify-content: space-between; padding: 24px 16px 20px;">
  <div class="glow" style="width: 360px; height: 360px; left: -210px; bottom: -200px;"></div>
  <img class="logo" src="%(logo)s" style="width: 128px;">
  <div style="position: relative; z-index: 1; display: flex; flex-direction: column; gap: 8px;">
    <span class="eyebrow">Starsonic Phone</span>
    <span class="headline">Seu ramal no computador, <em>em qualquer lugar.</em></span>
  </div>
</div>
"""

HEADER = """
<div id="arte" class="panel" style="width: 150px; height: 57px; display: flex; align-items: center;
     justify-content: center;">
  <div class="glow" style="width: 160px; height: 160px; left: -96px; bottom: -110px;"></div>
  <img class="logo" src="%(logo)s" style="width: 112px;">
</div>
"""


def data_uri(path, kind):
    """O arquivo dentro da página (a página do set_content não abre file://)."""
    return "data:%s;base64,%s" % (kind, base64.b64encode(path.read_bytes()).decode("ascii"))


def render(page, body, size):
    values = {"logo": data_uri(ASSETS / "starsonic-logo-negativo.png", "image/png")}
    style = STYLE % {"font": data_uri(ASSETS / "PlusJakartaSans-Variable.woff2", "font/woff2"), "hero": GRADIENT_HERO,
                     "glow": GLOW, "cyan": CYAN}
    page.set_content("<!doctype html><html lang='pt-BR'><head><meta charset='utf-8'><style>%s</style></head>"
                     "<body>%s</body></html>" % (style, body % values))
    page.evaluate("document.fonts.ready")
    page.wait_for_function("Array.from(document.images).every((img) => img.complete && img.naturalWidth > 0)")
    png = page.locator("#arte").screenshot()
    image = Image.open(io.BytesIO(png)).convert("RGB")
    if image.size != size:
        raise SystemExit("tamanho %s, esperado %s" % (image.size, size))
    return image


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(device_scale_factor=1, viewport={"width": 400, "height": 400})
        render(page, SIDE, (164, 314)).save(OUT / "lateral.bmp", "BMP")
        render(page, HEADER, (150, 57)).save(OUT / "cabecalho.bmp", "BMP")
        browser.close()
    for name in ("lateral.bmp", "cabecalho.bmp"):
        print("gerado: %s" % (OUT / name).relative_to(ROOT))


if __name__ == "__main__":
    main()
