// As zonas de redimensionar (rc.2). O WebView2 cobre o alto da área da interface e, na região de arrastar da barra de
// título, faz o papel da barra do Windows: a borda de cima e os cantos de cima não chegam à janela. O canto de baixo
// à direita (o desenho do canto) também fica em cima do WebView2. Estas zonas, fora da região de arrastar, mandam o
// `resize` com a borda no botão esquerdo apertado, e o C++ começa o redimensionar do Windows (docs/ponte-windows.md).
// A faixa de cima não passa por cima dos botões da barra (Minimizar e Fechar).
import type { Send } from '../types';

export type ResizeEdge = 'cima' | 'cima-esquerda' | 'cima-direita' | 'baixo-direita';

const ZONAS: ResizeEdge[] = ['cima', 'cima-esquerda', 'cima-direita', 'baixo-direita'];

export function ResizeZones({ send }: { send: Send }) {
  return (
    <>
      {ZONAS.map((borda) => (
        <div
          key={borda}
          class={`resize-zone resize-${borda}`}
          data-resize={borda}
          aria-hidden="true"
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            send({ cmd: 'resize', borda });
          }}
        />
      ))}
    </>
  );
}
