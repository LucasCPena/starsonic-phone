#pragma once
// Recalcula as posições quando campos da tela de Configurações são escondidos,
// para a janela não ficar com buracos (spec seção 6.2).
#include <vector>

namespace starsonic {

struct LayoutBox {
    int id;
    int left, top, right, bottom;
    bool hidden;
    bool isStaticText;
};

struct CollapseResult {
    std::vector<LayoutBox> boxes;   // mesma ordem da entrada
    int heightReduction;            // quanto a janela pode encolher
};

// Duas colunas: left < columnSplitX é a coluna 0, o resto é a coluna 1.
CollapseResult CollapseHidden(const std::vector<LayoutBox>& boxes, int columnSplitX);

}  // namespace starsonic
