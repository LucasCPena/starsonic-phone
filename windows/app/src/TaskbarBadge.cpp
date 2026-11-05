#include "TaskbarBadge.h"

#include <cstring>
#include <string>
#include <vector>

#include "ChatFiles.h"
#include "Text.h"

namespace starsonic {

namespace {

// Cada pixel do icone e desenhado em kSamples x kSamples pontos, e a media de cada bloco da a borda suave do circulo e
// do texto (o GDI nao suaviza a borda do Ellipse).
const int kSamples = 4;
// As cores do numero, em R, G e B: o circulo #00C2CB e o texto #03222A.
const BYTE kCircle[3] = {0x00, 0xC2, 0xCB};
const BYTE kText[3] = {0x03, 0x22, 0x2A};
const wchar_t kFontFace[] = L"Segoe UI";

// Um bitmap de 32 bits de cima para baixo, com os pixels em bits (cada um um DWORD 0xAARRGGBB).
HBITMAP CreateCanvas(int width, int height, void** bits) {
    BITMAPINFO info = {};
    info.bmiHeader.biSize = sizeof(info.bmiHeader);
    info.bmiHeader.biWidth = width;
    info.bmiHeader.biHeight = -height;
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    info.bmiHeader.biCompression = BI_RGB;
    *bits = nullptr;
    const HBITMAP bitmap = CreateDIBSection(nullptr, &info, DIB_RGB_COLORS, bits, nullptr, 0);
    if (bitmap && !*bits) {
        DeleteObject(bitmap);
        return nullptr;
    }
    return bitmap;
}

// Quanto de cada pixel do icone o desenho (branco no preto, no bitmap kSamples vezes maior) cobre, de 0 a 255: a media
// do azul do bloco dele.
std::vector<BYTE> Coverage(const DWORD* pixels, int size) {
    const size_t side = static_cast<size_t>(size);
    const size_t samples = static_cast<size_t>(kSamples);
    const size_t big = side * samples;
    std::vector<BYTE> out(side * side);
    for (size_t y = 0; y < side; ++y) {
        for (size_t x = 0; x < side; ++x) {
            size_t sum = 0;
            for (size_t dy = 0; dy < samples; ++dy) {
                const DWORD* row = pixels + (y * samples + dy) * big + x * samples;
                for (size_t dx = 0; dx < samples; ++dx) sum += row[dx] & 0xFF;
            }
            out[y * side + x] = static_cast<BYTE>(sum / (samples * samples));
        }
    }
    return out;
}

HFONT CreateBadgeFont(int height) {
    // Sem a suavizacao do Windows (so o branco e o preto): a borda suave vem dos kSamples.
    return CreateFontW(-height, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS,
                       CLIP_DEFAULT_PRECIS, NONANTIALIASED_QUALITY, DEFAULT_PITCH | FF_SWISS, kFontFace);
}

// A letra do numero num circulo de box pontos: 3/4 dele de altura, e menor quando o texto (o "9+") passaria de 13/16
// da largura.
HFONT BadgeFont(HDC dc, const std::wstring& text, int box) {
    const int height = box * 3 / 4;
    HFONT font = CreateBadgeFont(height);
    if (!font) return nullptr;
    SIZE extent = {};
    const HGDIOBJ previous = SelectObject(dc, font);
    const BOOL measured = GetTextExtentPoint32W(dc, text.c_str(), static_cast<int>(text.size()), &extent);
    SelectObject(dc, previous);
    const int widest = box * 13 / 16;
    const int width = static_cast<int>(extent.cx);
    if (measured && width > widest) {
        DeleteObject(font);
        font = CreateBadgeFont(MulDiv(height, widest, width));
    }
    return font;
}

// O icone de 32 bits (o alfa sem pre-multiplicar, como num .ico): a cor do circulo, misturada com a do texto onde ele
// cobre, e a transparencia da borda do circulo. A mascara (para quem desenha sem o alfa) e o que fica fora do circulo.
HICON MakeIcon(const std::vector<BYTE>& circle, const std::vector<BYTE>& letters, int size) {
    void* bits = nullptr;
    const HBITMAP color = CreateCanvas(size, size, &bits);
    if (!color) return nullptr;
    DWORD* pixels = static_cast<DWORD*>(bits);
    const size_t side = static_cast<size_t>(size);
    // As linhas da mascara de 1 bit vao em palavras de 16 bits (a regra do CreateBitmap); o bit 1 e o fundo.
    const size_t stride = (side + 15) / 16 * 2;
    std::vector<BYTE> mask(stride * side, 0);
    for (size_t y = 0; y < side; ++y) {
        for (size_t x = 0; x < side; ++x) {
            const size_t at = y * side + x;
            const unsigned alpha = circle[at];
            if (alpha == 0) {
                pixels[at] = 0;
                BYTE& bitsOfRow = mask[y * stride + x / 8];
                bitsOfRow = static_cast<BYTE>(bitsOfRow | (0x80u >> (x % 8)));
                continue;
            }
            const unsigned cover = letters[at];
            const auto mix = [cover](BYTE back, BYTE front) {
                return (back * (255u - cover) + front * cover + 127u) / 255u;
            };
            pixels[at] = (alpha << 24) | (mix(kCircle[0], kText[0]) << 16) | (mix(kCircle[1], kText[1]) << 8) |
                         mix(kCircle[2], kText[2]);
        }
    }
    const HBITMAP maskBitmap = CreateBitmap(size, size, 1, 1, mask.data());
    HICON icon = nullptr;
    if (maskBitmap) {
        ICONINFO info = {};
        info.fIcon = TRUE;
        info.hbmMask = maskBitmap;
        info.hbmColor = color;
        icon = CreateIconIndirect(&info);   // copia os dois bitmaps
        DeleteObject(maskBitmap);
    }
    DeleteObject(color);
    return icon;
}

// O icone do numero: o circulo com o texto no meio, de size x size pixels.
HICON DrawBadge(const std::wstring& text, int size) {
    if (size <= 0) return nullptr;
    const int big = size * kSamples;
    const HDC dc = CreateCompatibleDC(nullptr);
    if (!dc) return nullptr;
    void* bits = nullptr;
    const HBITMAP canvas = CreateCanvas(big, big, &bits);
    HICON icon = nullptr;
    if (canvas) {
        const HGDIOBJ previousBitmap = SelectObject(dc, canvas);
        const size_t bytes = static_cast<size_t>(big) * static_cast<size_t>(big) * sizeof(DWORD);
        const DWORD* pixels = static_cast<const DWORD*>(bits);
        // O circulo, branco no preto. Sem a caneta, o Ellipse deixa a ultima linha e a ultima coluna de fora: o +1.
        std::memset(bits, 0, bytes);
        const HGDIOBJ previousBrush = SelectObject(dc, GetStockObject(WHITE_BRUSH));
        const HGDIOBJ previousPen = SelectObject(dc, GetStockObject(NULL_PEN));
        Ellipse(dc, 0, 0, big + 1, big + 1);
        GdiFlush();
        const std::vector<BYTE> circle = Coverage(pixels, size);
        // O texto, branco no preto, no meio.
        std::memset(bits, 0, bytes);
        const HFONT font = BadgeFont(dc, text, big);
        const HGDIOBJ previousFont = font ? SelectObject(dc, font) : nullptr;
        SetBkMode(dc, TRANSPARENT);
        SetTextColor(dc, RGB(0xFF, 0xFF, 0xFF));
        RECT box = {0, 0, big, big};
        DrawTextW(dc, text.c_str(), static_cast<int>(text.size()), &box,
                  DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
        GdiFlush();
        const std::vector<BYTE> letters = Coverage(pixels, size);
        if (previousFont) SelectObject(dc, previousFont);
        if (font) DeleteObject(font);
        SelectObject(dc, previousPen);
        SelectObject(dc, previousBrush);
        SelectObject(dc, previousBitmap);
        icon = MakeIcon(circle, letters, size);
    }
    if (canvas) DeleteObject(canvas);
    DeleteDC(dc);
    return icon;
}

}  // namespace

TaskbarBadge::~TaskbarBadge() { Detach(); }

UINT TaskbarBadge::ButtonCreatedMessage() {
    static const UINT message = RegisterWindowMessageW(L"TaskbarButtonCreated");
    return message;
}

void TaskbarBadge::Attach(HWND window) { window_ = window; }

void TaskbarBadge::Detach() {
    taskbar_.Reset();
    window_ = nullptr;
}

void TaskbarBadge::OnButtonCreated() {
    if (!window_) return;
    // Um ITaskbarList3 novo a cada botao: o de antes pode falar com o Explorer que saiu.
    taskbar_.Reset();
    Microsoft::WRL::ComPtr<ITaskbarList3> taskbar;
    if (FAILED(CoCreateInstance(CLSID_TaskbarList, nullptr, CLSCTX_INPROC_SERVER,
                                IID_PPV_ARGS(taskbar.GetAddressOf()))) ||
        FAILED(taskbar->HrInit())) {
        return;
    }
    taskbar_ = taskbar;
    Apply();
}

void TaskbarBadge::Set(int n) {
    count_ = n > 0 ? n : 0;
    Apply();
}

void TaskbarBadge::Apply() {
    if (!taskbar_ || !window_) return;
    if (count_ == 0) {
        taskbar_->SetOverlayIcon(window_, nullptr, nullptr);
        return;
    }
    UINT dpi = GetDpiForWindow(window_);
    if (dpi == 0) dpi = 96;
    const HICON icon = DrawBadge(Utf8ToWide(BadgeText(count_)), GetSystemMetricsForDpi(SM_CXSMICON, dpi));
    const std::wstring description = Utf8ToWide(BadgeDescription(count_));
    // A barra de tarefas guarda uma copia: o icone sai logo depois.
    taskbar_->SetOverlayIcon(window_, icon, description.c_str());
    if (icon) DestroyIcon(icon);
}

}  // namespace starsonic
