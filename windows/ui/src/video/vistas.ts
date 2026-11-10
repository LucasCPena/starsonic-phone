// As vistas de vídeo de uma página (docs/ponte-windows.md, "A memória do vídeo"): guarda a memória de cada vista, a que
// chegou por último pela ponte (a nova de uma vista solta a velha), e diz ao núcleo as vistas à vista (o `videoViews`).
// Cada vista de vídeo montada conta (o `mostrar`), e a mesma vista pode estar em dois lugares: ela sai da lista quando
// a última sai. O `videoViews` leva a lista inteira, em ordem alfabética, na microtarefa seguinte e só quando ela mudou
// (montar e desmontar no mesmo desenho não manda nada). A página nunca escreve numa memória.
import { createContext, type Context } from 'preact';
import type { Bridge } from '../bridge';
import type { PaginaDeVideo, VistaDeVideoNome } from '../state';

export interface VideoDaPagina {
  /** A memória de agora da vista; `null` antes de a primeira chegar. */
  memoria(vista: VistaDeVideoNome): ArrayBuffer | null;
  /** Uma memória chegou ou trocou; devolve a função que para de ouvir. */
  aoMudar(ouvinte: (vista: VistaDeVideoNome) => void): () => void;
  /** Conta a vista como à vista; devolve o tirar (que vale uma vez). */
  mostrar(vista: VistaDeVideoNome): () => void;
}

export function criarVideoDaPagina(bridge: Bridge, pagina: PaginaDeVideo): VideoDaPagina {
  const memorias = new Map<VistaDeVideoNome, ArrayBuffer>();
  const ouvintes = new Set<(vista: VistaDeVideoNome) => void>();
  const contagem = new Map<VistaDeVideoNome, number>();
  // A última lista mandada (no começo, nenhuma vista à vista).
  let mandada = '[]';
  let marcada = false;

  bridge.subscribeBuffers((vista, buffer) => {
    const velha = memorias.get(vista);
    if (velha === buffer) return;
    memorias.set(vista, buffer);
    for (const o of [...ouvintes]) o(vista);
    if (velha) bridge.releaseBuffer(velha);
  });

  const mandar = () => {
    marcada = false;
    const vistas = [...contagem.keys()].sort();
    const lista = JSON.stringify(vistas);
    if (lista === mandada) return;
    mandada = lista;
    bridge.send({ cmd: 'videoViews', pagina, vistas });
  };
  const mudou = () => {
    if (marcada) return;
    marcada = true;
    queueMicrotask(mandar);
  };

  return {
    memoria: (vista) => memorias.get(vista) ?? null,
    aoMudar(ouvinte) {
      ouvintes.add(ouvinte);
      return () => ouvintes.delete(ouvinte);
    },
    mostrar(vista) {
      contagem.set(vista, (contagem.get(vista) ?? 0) + 1);
      mudou();
      let tirada = false;
      return () => {
        if (tirada) return;
        tirada = true;
        const n = (contagem.get(vista) ?? 1) - 1;
        if (n > 0) contagem.set(vista, n);
        else contagem.delete(vista);
        mudou();
      };
    },
  };
}

/** As vistas de vídeo da página (o main.tsx o dá; sem ele, uma vista fica só com o fundo). */
export const VideoContexto: Context<VideoDaPagina | null> = createContext<VideoDaPagina | null>(null);
