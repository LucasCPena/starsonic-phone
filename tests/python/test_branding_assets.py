"""Formato dos arquivos da marca que entram no build (ícones, logos e imagem do instalador).

Os arquivos são gerados por branding/fontes/gerar_marca.py; o teste só lê cabeçalhos
(biblioteca padrão), para rodar no CI sem dependências.
"""
import pathlib
import struct
import unittest
import xml.etree.ElementTree as ElementTree

ROOT = pathlib.Path(__file__).resolve().parents[2]
ICONS = ROOT / "branding" / "overlay" / "microsip" / "res"
ANDROID_RES = ROOT / "android" / "app" / "src" / "main" / "res"
ANDROID_NS = "{http://schemas.android.com/apk/res/android}"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def ico_entries(path):
    """Lista de (largura, altura, é_png, bits) de cada imagem de um .ico."""
    data = path.read_bytes()
    reserved, kind, count = struct.unpack_from("<HHH", data, 0)
    if reserved != 0 or kind != 1:
        raise ValueError("%s não é um .ico" % path)
    entries = []
    for index in range(count):
        width, height, _colors, _reserved, _planes, bits, size, offset = struct.unpack_from(
            "<BBBBHHII", data, 6 + 16 * index)
        image = data[offset:offset + size]
        is_png = image.startswith(PNG_SIGNATURE)
        if not is_png:
            header_size, dib_width, dib_height, _planes2, dib_bits = struct.unpack_from("<IiiHH", image, 0)
            if header_size != 40 or dib_width != (width or 256) or dib_height != 2 * (height or 256):
                raise ValueError("%s: cabeçalho DIB inesperado na imagem %d" % (path, index))
            bits = dib_bits
        entries.append((width or 256, height or 256, is_png, bits))
    return entries


def png_header(path):
    """(largura, altura, profundidade, tipo de cor) do IHDR de um .png."""
    data = path.read_bytes()
    if not data.startswith(PNG_SIGNATURE) or data[12:16] != b"IHDR":
        raise ValueError("%s não é um .png" % path)
    return struct.unpack_from(">IIBB", data, 16)


def vector_colors(path):
    """Cores (fillColor e strokeColor, em maiúsculas) de um vetor do Android; ValueError se não for <vector>."""
    root = ElementTree.parse(path).getroot()
    if root.tag != "vector":
        raise ValueError("%s não é um <vector> (é <%s>)" % (path, root.tag))
    colors = set()
    for element in root.iter():
        for attribute in ("fillColor", "strokeColor"):
            value = element.get(ANDROID_NS + attribute)
            if value:
                colors.add(value.upper())
    return colors


class BrandingAssetsTest(unittest.TestCase):
    def assert_icon(self, name, required_sizes):
        entries = ico_entries(ICONS / name)
        sizes = {width for width, height, _png, _bits in entries}
        self.assertTrue(set(required_sizes) <= sizes, "%s tem %s" % (name, sorted(sizes)))
        for width, height, is_png, bits in entries:
            self.assertEqual(width, height, name)
            if width < 256:
                # Imagens pequenas em DIB de 32 bits: o NSIS e o Windows antigo não leem PNG nelas.
                self.assertFalse(is_png, "%s %dpx em PNG" % (name, width))
                self.assertEqual(bits, 32, "%s %dpx com %d bits" % (name, width, bits))

    def test_app_icon_has_every_size_the_windows_shell_asks_for(self):
        self.assert_icon("microsip.ico", [16, 20, 24, 32, 40, 48, 64, 256])
        big = [entry for entry in ico_entries(ICONS / "microsip.ico") if entry[0] == 256]
        self.assertTrue(big[0][2], "a imagem de 256 px deve ser PNG")

    def test_tray_icons_have_small_sizes(self):
        for name in ("tray_inactive.ico", "tray_missed.ico"):
            self.assert_icon(name, [16, 20, 24, 32])

    def test_band_logo_is_a_wide_transparent_png(self):
        width, height, depth, color = png_header(ROOT / "branding" / "logo-faixa.png")
        self.assertEqual((depth, color), (8, 6), "logo da faixa precisa ser RGBA de 8 bits")
        # A faixa desenha o logo com até 5x a altura de largura.
        self.assertTrue(4.0 <= width / height <= 5.0, "proporção %.2f" % (width / height))
        self.assertGreaterEqual(height, 64)

    def test_login_logo_fills_the_login_screen_area(self):
        width, height, depth, color = png_header(ROOT / "branding" / "logo-entrar.png")
        self.assertEqual((depth, color), (8, 6), "logo da tela Entrar precisa ser RGBA de 8 bits")
        # Área do logo na tela Entrar: 160x40 DLU, cerca de 3,7 vezes mais larga que alta.
        self.assertTrue(3.4 <= width / height <= 4.0, "proporção %.2f" % (width / height))
        self.assertGreaterEqual(height, 130)

    def test_installer_welcome_bitmap_is_164x314(self):
        data = (ROOT / "branding" / "installer" / "boas-vindas.bmp").read_bytes()
        self.assertEqual(data[:2], b"BM")
        width, height, _planes, bits = struct.unpack_from("<iiHH", data, 18)
        self.assertEqual((width, abs(height)), (164, 314))
        self.assertEqual(bits, 24)


class AndroidBrandingTest(unittest.TestCase):
    """Ícone adaptável (fundo, primeiro plano e monocromático), ícone da notificação e logos do app Android."""

    def drawable(self, name):
        return ANDROID_RES / "drawable" / (name + ".xml")

    def test_icon_layers_and_notification_icon_are_vectors(self):
        for name in ("ic_launcher_foreground", "ic_launcher_background", "ic_launcher_monochrome",
                     "ic_stat_starsonic"):
            with self.subTest(name=name):
                self.assertTrue(self.drawable(name).is_file(), "falta %s" % self.drawable(name))
                vector_colors(self.drawable(name))

    def test_background_is_starsonic_blue(self):
        self.assertIn("#383881", vector_colors(self.drawable("ic_launcher_background")))

    def test_foreground_has_the_cyan_ring_and_the_white_handset(self):
        self.assertLessEqual({"#3DB1CC", "#FFFFFF"}, vector_colors(self.drawable("ic_launcher_foreground")))

    def test_notification_icon_is_white_only(self):
        self.assertEqual(vector_colors(self.drawable("ic_stat_starsonic")), {"#FFFFFF"})

    def test_logos_are_copies_of_the_branding_ones(self):
        # Nome de recurso do Android não aceita hífen: logo-faixa.png vira logo_faixa.png.
        for source, copy in (("logo-faixa.png", "logo_faixa.png"), ("logo-entrar.png", "logo_entrar.png")):
            with self.subTest(copy=copy):
                target = ANDROID_RES / "drawable-nodpi" / copy
                self.assertTrue(target.is_file(), "falta %s" % target)
                self.assertEqual(target.read_bytes(), (ROOT / "branding" / source).read_bytes(),
                                 "%s difere de branding/%s (rode gerar_marca.py)" % (copy, source))


if __name__ == "__main__":
    unittest.main()
