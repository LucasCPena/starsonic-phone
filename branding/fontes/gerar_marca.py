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
- android/app/src/main/res/drawable/ic_launcher_background.xml   ícone adaptável do Android: fundo azul
- android/app/src/main/res/drawable/ic_launcher_foreground.xml   ícone adaptável: o símbolo do Windows
- android/app/src/main/res/drawable/ic_launcher_monochrome.xml   ícone temático (Android 13+): anel e fone
- android/app/src/main/res/drawable/ic_stat_starsonic.xml        ícone da notificação: anel e fone brancos
- android/app/src/main/res/drawable-nodpi/logo_faixa.png e logo_entrar.png   cópias dos logos acima

Precisa de Python 3 com Pillow, numpy, scipy e Playwright (com o Chromium instalado), que não
fazem parte do build: rode à mão quando mudar o logo ou o desenho do ícone.
Uso: python3 branding/fontes/gerar_marca.py
"""
import io
import pathlib
import shutil
import struct

import numpy as np
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright
from scipy import ndimage

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = ROOT / "branding" / "fontes" / "logo-starsonic.png"
ICONS = ROOT / "branding" / "overlay" / "microsip" / "res"
ANDROID_RES = ROOT / "android" / "app" / "src" / "main" / "res"

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


# ---- Geometria do símbolo, num quadro de 100 x 100 (a mesma no Windows e no Android) ----

CIRCLE = (50, 50, 41)                                 # círculo azul: centro e raio
RING = ("M 12.5 72 A 43.5 43.5 0 1 1 90 69", 9)       # anel por cima (lembra a curva do logo): caminho e espessura
HANDSET_PIVOT = (53, 48)                              # o fone é desenhado em torno deste ponto, que vai para o
HANDSET_SCALE = 0.6                                   # centro do círculo, reduzido a 60%
HANDSET_CORD = ("M 24 20 A 56 56 0 0 0 80 76", 15)    # o arco entre as duas pontas: caminho e espessura
HANDSET_ENDS = [                                      # as pontas: (x, y, largura, altura, raio), (giro, cx, cy)
    ((14, 8, 33, 24, 8), (6, 30, 20)),
    ((68, 53, 24, 33, 8), (-6, 80, 70)),
]


# ---- Ícones do Windows (SVG desenhado aqui, renderizado pelo Chromium em cada tamanho) ----

def handset_svg():
    lines = [
        "",
        '  <g transform="translate(%g %g) scale(%g) translate(%g %g)" fill="#FFFFFF">'
        % (CIRCLE[0], CIRCLE[1], HANDSET_SCALE, -HANDSET_PIVOT[0], -HANDSET_PIVOT[1]),
        '    <path d="%s" fill="none" stroke="#FFFFFF" stroke-width="%g"/>' % HANDSET_CORD,
    ]
    for (x, y, width, height, radius), (angle, cx, cy) in HANDSET_ENDS:
        lines.append('    <rect x="%g" y="%g" width="%g" height="%g" rx="%g" transform="rotate(%g %g %g)"/>'
                     % (x, y, width, height, radius, angle, cx, cy))
    lines.append("  </g>")
    return "\n".join(lines)


def icon_svg(circle, ring, badge=False):
    """Círculo azul com o fone branco e um anel ciano por cima (lembra a curva do logo)."""
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
        '<circle cx="%g" cy="%g" r="%g" fill="%s"/>' % (CIRCLE + (hex_color(circle),)),
        '<path d="%s" fill="none" stroke="%s" stroke-width="%g" stroke-linecap="round"/>'
        % (RING[0], hex_color(ring), RING[1]),
        handset_svg(),
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


# ---- Android (VectorDrawable com a geometria acima; o sistema desenha em qualquer tamanho) ----

# Ícone adaptável: camadas de 108 dp, das quais a máscara do celular mostra no máximo o miolo de 72 dp e,
# com certeza, só o círculo de 66 dp do centro (a zona segura). O anel vai até 48,8 do centro no quadro
# de 100; com 0,66 ele fica a 32,2 dp do centro, dentro da zona segura.
ADAPTIVE_DP, ADAPTIVE_SCALE = 108, 0.66
# Notificação: 24 dp, com o desenho nos 20 dp do meio (2 dp de margem, como pede o Material).
STATUS_DP, STATUS_SCALE = 24, 0.2

VECTOR_HEADER = """<?xml version="1.0" encoding="utf-8"?>
<!-- Gerado por branding/fontes/gerar_marca.py (a geometria do ícone do Windows). Não edite à mão. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="%(size)ddp"
    android:height="%(size)ddp"
    android:viewportWidth="%(size)d"
    android:viewportHeight="%(size)d">"""


def circle_path(cx, cy, radius):
    return "M %g %g A %g %g 0 1 0 %g %g A %g %g 0 1 0 %g %g Z" % (
        cx - radius, cy, radius, radius, cx + radius, cy, radius, radius, cx - radius, cy)


def rounded_rect_path(x, y, width, height, radius):
    """O <rect rx> do SVG como caminho (o VectorDrawable só desenha caminhos)."""
    right, bottom = x + width, y + height
    return ("M %g %g H %g A %g %g 0 0 1 %g %g V %g A %g %g 0 0 1 %g %g "
            "H %g A %g %g 0 0 1 %g %g V %g A %g %g 0 0 1 %g %g Z" % (
                x + radius, y, right - radius, radius, radius, right, y + radius,
                bottom - radius, radius, radius, right - radius, bottom,
                x + radius, radius, radius, x, bottom - radius,
                y + radius, radius, radius, x + radius, y))


def symbol_vector(size, scale, ring, handset, circle=None):
    """O símbolo (círculo opcional, anel e fone) no centro de um quadro de size dp, na escala pedida.

    Os grupos repetem as transformações do SVG: o VectorDrawable aplica em cada grupo
    (p - pivô) * escala, girado, + pivô + deslocamento.
    """
    offset = size / 2 - CIRCLE[0] * scale
    pivot_x, pivot_y = HANDSET_PIVOT
    lines = [
        VECTOR_HEADER % {"size": size},
        '    <group android:scaleX="%g" android:scaleY="%g" android:translateX="%g" android:translateY="%g">'
        % (scale, scale, offset, offset),
    ]
    if circle is not None:
        lines.append('        <path android:fillColor="%s" android:pathData="%s"/>'
                     % (hex_color(circle), circle_path(*CIRCLE)))
    lines += [
        '        <path android:strokeColor="%s" android:strokeWidth="%g" android:strokeLineCap="round" '
        'android:pathData="%s"/>' % (hex_color(ring), RING[1], RING[0]),
        # translate(50 50) scale(0.6) translate(-53 -48) do SVG = pivô no (53, 48), escala 0,6 e o pivô
        # levado ao centro do círculo.
        '        <group android:pivotX="%g" android:pivotY="%g" android:scaleX="%g" android:scaleY="%g" '
        'android:translateX="%g" android:translateY="%g">'
        % (pivot_x, pivot_y, HANDSET_SCALE, HANDSET_SCALE, CIRCLE[0] - pivot_x, CIRCLE[1] - pivot_y),
        '            <path android:strokeColor="%s" android:strokeWidth="%g" android:pathData="%s"/>'
        % (hex_color(handset), HANDSET_CORD[1], HANDSET_CORD[0]),
    ]
    for (x, y, width, height, radius), (angle, cx, cy) in HANDSET_ENDS:
        lines += [
            '            <group android:pivotX="%g" android:pivotY="%g" android:rotation="%g">' % (cx, cy, angle),
            '                <path android:fillColor="%s" android:pathData="%s"/>'
            % (hex_color(handset), rounded_rect_path(x, y, width, height, radius)),
            "            </group>",
        ]
    lines += ["        </group>", "    </group>", "</vector>", ""]
    return "\n".join(lines)


def background_vector(size, color):
    return "\n".join([
        VECTOR_HEADER % {"size": size},
        '    <path android:fillColor="%s" android:pathData="M 0 0 H %d V %d H 0 Z"/>' % (hex_color(color), size, size),
        "</vector>",
        "",
    ])


def make_android():
    drawables = {
        # Fundo azul inteiro (a máscara do celular recorta a forma); por cima, o símbolo do Windows.
        "ic_launcher_background": background_vector(ADAPTIVE_DP, NAVY),
        "ic_launcher_foreground": symbol_vector(ADAPTIVE_DP, ADAPTIVE_SCALE, CYAN, WHITE, circle=NAVY),
        # Ícone temático e notificação: o Android usa só a transparência e pinta com a cor dele.
        "ic_launcher_monochrome": symbol_vector(ADAPTIVE_DP, ADAPTIVE_SCALE, WHITE, WHITE),
        "ic_stat_starsonic": symbol_vector(STATUS_DP, STATUS_SCALE, WHITE, WHITE),
    }
    folder = ANDROID_RES / "drawable"
    folder.mkdir(parents=True, exist_ok=True)
    for name, text in drawables.items():
        (folder / (name + ".xml")).write_text(text, encoding="utf-8", newline="\n")
    # Nome de recurso do Android não aceita hífen.
    logos = ANDROID_RES / "drawable-nodpi"
    logos.mkdir(parents=True, exist_ok=True)
    for name in ("logo-faixa.png", "logo-entrar.png"):
        shutil.copyfile(ROOT / "branding" / name, logos / name.replace("-", "_"))


def main():
    make_icons()
    make_logos()
    make_android()
    print("ok: ícones, logos, imagem do instalador e marca do Android gerados")


if __name__ == "__main__":
    main()
