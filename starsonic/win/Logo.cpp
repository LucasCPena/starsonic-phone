#include "stdafx.h"
#include "Logo.h"

#include <atlimage.h>
#include <shlwapi.h>

#include <algorithm>
#include <map>
#include <memory>

#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "gdiplus.lib")

namespace {

// Imagens ja carregadas, por id de recurso (nullptr = recurso ausente ou invalido).
CImage* LoadPng(UINT resourceId) {
    static std::map<UINT, std::unique_ptr<CImage>> cache;
    auto found = cache.find(resourceId);
    if (found != cache.end()) {
        return found->second.get();
    }
    std::unique_ptr<CImage> image;
    HMODULE module = GetModuleHandle(NULL);
    HRSRC info = resourceId ? FindResource(module, MAKEINTRESOURCE(resourceId), RT_RCDATA) : NULL;
    HGLOBAL handle = info ? LoadResource(module, info) : NULL;
    const BYTE* data = handle ? static_cast<const BYTE*>(LockResource(handle)) : nullptr;
    if (data) {
        IStream* stream = SHCreateMemStream(data, SizeofResource(module, info));
        if (stream) {
            image.reset(new CImage());
            if (FAILED(image->Load(stream))) {
                image.reset();
            }
            stream->Release();
        }
    }
    CImage* result = image.get();
    cache[resourceId] = std::move(image);
    return result;
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
    CImage* image = LoadPng(pngResourceId);
    if (!image || image->GetWidth() <= 0 || image->GetHeight() <= 0) {
        DrawName(dc, area, textColor, alignLeft);
        return;
    }
    // Encaixa mantendo a proporcao, centralizado.
    const double scale = (std::min)(static_cast<double>(area.Width()) / image->GetWidth(),
                             static_cast<double>(area.Height()) / image->GetHeight());
    const int width = static_cast<int>(image->GetWidth() * scale);
    const int height = static_cast<int>(image->GetHeight() * scale);
    const int left = alignLeft ? area.left : area.left + (area.Width() - width) / 2;
    const int top = area.top + (area.Height() - height) / 2;
    const int oldMode = dc->SetStretchBltMode(HALFTONE);
    image->Draw(dc->GetSafeHdc(), left, top, width, height);
    dc->SetStretchBltMode(oldMode);
}
