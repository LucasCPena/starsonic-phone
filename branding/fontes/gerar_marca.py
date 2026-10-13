#!/usr/bin/env python3
"""Gera os arquivos da marca usados no build a partir do logo original da Starsonic.

Entrada: branding/fontes/logo-starsonic.png (logo enviado pela Starsonic, fundo transparente).
Saídas:
- branding/overlay/microsip/res/microsip.ico      ícone do app (também o da bandeja conectado)
- branding/overlay/microsip/res/tray_inactive.ico bandeja sem conexão (cinza)
- branding/overlay/microsip/res/tray_missed.ico   bandeja com chamada perdida (selo vermelho)
- branding/logo-faixa.png                         palavra "starsonic" branca e ciano, para a faixa azul
- branding/logo-entrar.png                        logo original num cartão branco (telas Entrar e Sobre)
- branding/installer/boas-vindas.bmp              imagem da tela de boas-vindas do instalador (164x314)

Precisa de Python 3 com Pillow, numpy, scipy e Playwright (com o Chromium instalado), que não
fazem parte do build: rode à mão quando mudar o logo ou o desenho do ícone.
Uso: python3 branding/fontes/gerar_marca.py
"""
import io
import pathlib
import struct

import numpy as np
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright
from scipy import ndimage

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = ROOT / "branding" / "fontes" / "logo-starsonic.png"
ICONS = ROOT / "branding" / "overlay" / "microsip" / "res"

NAVY = (0x38, 0x38, 0x81)      # azul Starsonic (STARSONIC_BRAND_COLOR)
CYAN = (0x3D, 0xB1, 0xCC)      # ciano Starsonic
WHITE = (0xFF, 0xFF, 0xFF)
GREY = (0x8C, 0x8F, 0xA3)      # sem conexão
GREY_LIGHT = (0xC3, 0xC6, 0xD1)
RED = "#E53935"                # selo de chamada perdida

APP_SIZES = [16, 20, 24, 32, 40, 48, 64, 256]
TRAY_SIZES = [16, 20, 24, 32, 40, 48]
TAGLINE_TOP = 530              # no logo original, o slogan começa abaixo desta linha


def hex_color(rgb):
    return "#%02X%02X%02X" % rgb


# ---- Ícones (SVG desenhado aqui, renderizado pelo Chromium em cada tamanho) ----

HANDSET = """
  <g transform="translate(50 50) scale(0.6) translate(-53 -48)" fill="#FFFFFF">
    <path d="M 24 20 A 56 56 0 0 0 80 76" fill="none" stroke="#FFFFFF" stroke-width="15"/>
    <rect x="14" y="8" width="33" height="24" rx="8" transform="rotate(6 30 20)"/>
    <rect x="68" y="53" width="24" height="33" rx="8" transform="rotate(-6 80 70)"/>
  </g>"""


def icon_svg(circle, ring, badge=False):
    """Círculo azul com o fone branco e um anel ciano por cima (lembra a curva do logo)."""
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
        '<circle cx="50" cy="50" r="41" fill="%s"/>' % hex_color(circle),
        '<path d="M 12.5 72 A 43.5 43.5 0 1 1 90 69" fill="none" stroke="%s" stroke-width="9" '
        'stroke-linecap="round"/>' % hex_color(ring),
        HANDSET,
    ]
    if badge:
        parts.append('<circle cx="78" cy="22" r="19" fill="%s" stroke="#FFFFFF" stroke-width="5"/>' % RED)
    parts.append("</svg>")
    return "\n".join(parts)


def render_svg(page, svg, size):
    page.set_viewport_size({"width": size, "height": size})
    sized = svg.replace("<svg ", '<svg width="%d" height="%d" ' % (size, size), 1)
    page.set_content("<html><body style='margin:0;background:transparent'>%s</body></html>" % sized)
    png = page.screenshot(omit_background=True, clip={"x": 0, "y": 0, "width": size, "height": size})
    return Image.open(io.BytesIO(png)).convert("RGBA")


def dib(image):
    """Imagem de ícone em DIB de 32 bits (BGRA de baixo para cima + máscara AND)."""
    width, height = image.size
    pixels = np.array(image)
    header = struct.pack("<IiiHHIIiiII", 40, width, 2 * height, 1, 32, 0, 0, 0, 0, 0, 0)
    xor = pixels[::-1, :, [2, 1, 0, 3]].tobytes()
    row_bytes = ((width + 31) // 32) * 4
    mask = bytearray()
    for row in pixels[::-1]:
        bits = np.packbits(row[:, 3] == 0)
        mask += bits.tobytes() + b"\0" * (row_bytes - len(bits))
    return header + xor + bytes(mask)


def write_ico(path, images):
    """.ico com DIB de 32 bits até 128 px e PNG em 256 px (o formato que o Windows e o NSIS leem)."""
    blobs = []
    for image in images:
        if image.width >= 256:
            buffer = io.BytesIO()
            image.save(buffer, "PNG")
            blobs.append(buffer.getvalue())
        else:
            blobs.append(dib(image))
    header = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    entries = b""
    for image, blob in zip(images, blobs):
        side = 0 if image.width >= 256 else image.width
        entries += struct.pack("<BBBBHHII", side, side, 0, 0, 1, 32, len(blob), offset)
        offset += len(blob)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(header + entries + b"".join(blobs))


def make_icons():
    variants = [
        ("microsip.ico", icon_svg(NAVY, CYAN), APP_SIZES),
        ("tray_inactive.ico", icon_svg(GREY, GREY_LIGHT), TRAY_SIZES),
        ("tray_missed.ico", icon_svg(NAVY, CYAN, badge=True), TRAY_SIZES),
    ]
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(device_scale_factor=1)
        for name, svg, sizes in variants:
            write_ico(ICONS / name, [render_svg(page, svg, size) for size in sizes])
        browser.close()


# ---- Logos (recortados e recoloridos do logo original) ----

def logo_layers():
    """Logo original e máscaras: palavra azul ("star"), palavra ciano ("sonic" e o ponto), curva e slogan."""
    image = np.array(Image.open(SOURCE).convert("RGBA")).astype(float)
    rgb, alpha = image[..., :3], image[..., 3]
    ink = alpha > 0
    near_navy = np.linalg.norm(rgb - np.array(NAVY, float), axis=2)
    near_cyan = np.linalg.norm(rgb - np.array(CYAN, float), axis=2)
    navy = ink & (near_navy <= near_cyan)
    cyan = ink & (near_cyan < near_navy)
    labels, count = ndimage.label(cyan, structure=np.ones((3, 3)))
    sizes = ndimage.sum(cyan, labels, range(1, count + 1))
    swoosh = labels == (int(np.argmax(sizes)) + 1)          # a curva é o maior traço ciano
    rows = np.arange(alpha.shape[0])[:, None]
    tagline = navy & (rows > TAGLINE_TOP)
    return image, alpha, navy & ~tagline, cyan & ~swoosh, swoosh, tagline


def paint(image, alpha, layers):
    """RGBA com cada máscara pintada numa cor (None = cor original)."""
    out = np.zeros_like(image)
    for mask, color in layers:
        if color is None:
            out[mask] = image[mask]
        else:
            out[mask, :3] = color
            out[mask, 3] = alpha[mask]
    return Image.fromarray(out.astype(np.uint8), "RGBA")


def fit(image, width, height):
    scale = min(width / image.width, height / image.height)
    return image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.LANCZOS)


def make_logos():
    image, alpha, word_navy, word_cyan, swoosh, tagline = logo_layers()
    # Faixa: só a palavra, "star" em branco e "sonic" em ciano, sobre o fundo azul da faixa.
    word = paint(image, alpha, [(word_navy, WHITE), (word_cyan, None)])
    band = word.crop(word.getbbox())
    band = band.resize((round(band.width * 96 / band.height), 96), Image.LANCZOS)
    band.save(ROOT / "branding" / "logo-faixa.png")

    # Telas Entrar e Sobre: logo original completo num cartão branco (vale no tema claro e no escuro).
    full = paint(image, alpha, [(word_navy, None), (word_cyan, None), (swoosh, None), (tagline, None)])
    full = full.crop(full.getbbox())
    card = Image.new("RGBA", (740, 200), (0, 0, 0, 0))
    ImageDraw.Draw(card).rounded_rectangle((0, 0, 739, 199), radius=28, fill=WHITE + (255,))
    logo = fit(full, 740 - 32, 200 - 32)
    card.alpha_composite(logo, ((740 - logo.width) // 2, (200 - logo.height) // 2))
    card.save(ROOT / "branding" / "logo-entrar.png")

    # Instalador: faixa azul com o logo branco e ciano (164x314, BMP de 24 bits para o NSIS).
    white = paint(image, alpha, [(word_navy, WHITE), (word_cyan, None), (swoosh, None), (tagline, WHITE)])
    white = white.crop(white.getbbox())
    welcome = Image.new("RGBA", (164, 314), NAVY + (255,))
    logo = fit(white, 150, 200)
    welcome.alpha_composite(logo, ((164 - logo.width) // 2, (314 - logo.height) // 2 - 20))
    target = ROOT / "branding" / "installer" / "boas-vindas.bmp"
    target.parent.mkdir(parents=True, exist_ok=True)
    welcome.convert("RGB").save(target)


def main():
    make_icons()
    make_logos()
    print("ok: ícones, logos e imagem do instalador gerados")


if __name__ == "__main__":
    main()
