#pragma once
// Logo da Starsonic: PNG embutido (RCDATA) ou, sem o recurso, o nome escrito em negrito.

// pngResourceId = 0 ou recurso ausente: escreve "Starsonic" em negrito com textColor.
void DrawLogo(CDC* dc, const CRect& area, UINT pngResourceId, COLORREF textColor);
