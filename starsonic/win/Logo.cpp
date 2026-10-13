#include "stdafx.h"
#include "Logo.h"

#include <gdiplus.h>
#include <shlwapi.h>

#include <algorithm>
#include <map>

#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "gdiplus.lib")

namespace {

// O GDI+ fica ligado ate o fim do processo.
bool StartGdiplus() {
    static const bool started = [] {
        ULONG_PTR token = 0;
        Gdiplus::GdiplusStartupInput input;
        return Gdiplus::GdiplusStartup(&token, &input, NULL) == Gdiplus::Ok;
    }();
    return started;
}

// Decodifica o PNG numa copia em memoria (alfa pre-multiplicado), sem depender do stream.
Gdiplus::Bitmap* Decode(IStream* stream) {
    Gdiplus::Bitmap decoded(stream, FALSE);
    if (decoded.GetLastStatus() != Gdiplus::Ok || decoded.GetWidth() == 0 || decoded.GetHeight() == 0) {
        return nullptr;
    }
    const INT width = static_cast<INT>(decoded.GetWidth());
    const INT height = static_cast<INT>(decoded.GetHeight());
    Gdiplus::Bitmap* copy = new Gdiplus::Bitmap(width, height, PixelFormat32bppPARGB);
    Gdiplus::Status status = copy->GetLastStatus();
    if (status == Gdiplus::Ok) {
        Gdiplus::Graphics graphics(copy);
        graphics.SetCompositingMode(Gdiplus::CompositingModeSourceCopy);
        status = graphics.DrawImage(&decoded, 0, 0, width, height);
    }
    if (status != Gdiplus::Ok) {
        delete copy;
        return nullptr;
    }
    return copy;
}

// Imagens ja carregadas, por id de recurso (nullptr = recurso ausente ou invalido). Ficam na memoria
// ate o fim do processo, de proposito: liberadas depois do fim do GDI+, derrubariam o app.
Gdiplus::Bitmap* LoadPng(UINT resourceId) {
    static std::map<UINT, Gdiplus::Bitmap*> cache;
    auto found = cache.find(resourceId);
    if (found != cache.end()) {
        return found->second;
    }
    Gdiplus::Bitmap* image = nullptr;
    HMODULE module = GetModuleHandle(NULL);
    HRSRC info = resourceId ? FindResource(module, MAKEINTRESOURCE(resourceId), RT_RCDATA) : NULL;
    HGLOBAL handle = info ? LoadResource(module, info) : NULL;
    const BYTE* data = handle ? static_cast<const BYTE*>(LockResource(handle)) : nullptr;
    if (data && StartGdiplus()) {
        IStream* stream = SHCreateMemStream(data, SizeofResource(module, info));
        if (stream) {
            image = Decode(stream);
            stream->Release();
        }
    }
    cache[resourceId] = image;
    return image;
}

void DrawName(CDC* dc, const CRect& area, COLORREF textColor, bool alignLeft) {
    CFont font;
    LOGFONT lf = {};
    lf.lfHeight = -(std::max)(10, area.Height() * 3 / 5);
    lf.lfWeight = FW_BOLD;
    lf.lfQuality = CLEARTYPE_QUALITY;
    wcscpy_s(lf.lfFaceName, L"Segoe UI");
    font.CreateFontIndirect(&lf);
    CFont* old = dc->SelectObject(&font);
    const int oldMode = dc->SetBkMode(TRANSPARENT);
    const COLORREF oldColor = dc->SetTextColor(textColor);
    CRect rect(area);
    const UINT horizontal = alignLeft ? DT_LEFT : DT_CENTER;
    dc->DrawText(L"Starsonic", &rect, horizontal | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
    dc->SetTextColor(oldColor);
    dc->SetBkMode(oldMode);
    dc->SelectObject(old);
}

}  // namespace

void DrawLogo(CDC* dc, const CRect& area, UINT pngResourceId, COLORREF textColor, bool alignLeft) {
    Gdiplus::Bitmap* image = LoadPng(pngResourceId);
    if (!image || area.Width() <= 0 || area.Height() <= 0) {
        DrawName(dc, area, textColor, alignLeft);
        return;
    }
    // Encaixa mantendo a proporcao, centralizado (ou encostado na esquerda).
    const INT imageWidth = static_cast<INT>(image->GetWidth());
    const INT imageHeight = static_cast<INT>(image->GetHeight());
    const double scale = (std::min)(static_cast<double>(area.Width()) / imageWidth,
                                    static_cast<double>(area.Height()) / imageHeight);
    const INT width = (std::max)(1, static_cast<INT>(imageWidth * scale + 0.5));
    const INT height = (std::max)(1, static_cast<INT>(imageHeight * scale + 0.5));
    const INT left = alignLeft ? area.left : area.left + (area.Width() - width) / 2;
    const INT top = area.top + (area.Height() - height) / 2;
    // Reducao com filtro e alfa pre-multiplicado: bordas suaves, sem o serrilhado e o halo claro do
    // AlphaBlend. TileFlipXY evita que as beiradas da imagem saiam esmaecidas.
    Gdiplus::Graphics graphics(dc->GetSafeHdc());
    graphics.SetInterpolationMode(Gdiplus::InterpolationModeHighQualityBicubic);
    graphics.SetPixelOffsetMode(Gdiplus::PixelOffsetModeHighQuality);
    graphics.SetCompositingQuality(Gdiplus::CompositingQualityHighQuality);
    Gdiplus::ImageAttributes attributes;
    attributes.SetWrapMode(Gdiplus::WrapModeTileFlipXY);
    graphics.DrawImage(image, Gdiplus::Rect(left, top, width, height), 0, 0, imageWidth, imageHeight,
                       Gdiplus::UnitPixel, &attributes);
}
