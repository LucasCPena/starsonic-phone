// (0.3.0) A vista de vídeo (spec do vídeo, 6.4 e 6.6): o componente que desenha toda imagem de vídeo da interface. Ela lê
// a memória da vista (video/vistas.ts) a cada quadro de tela (o requestAnimationFrame) e desenha o quadro novo no canvas
// (video/desenho.ts: o WebGL, ou o canvas 2D), encaixado e com o fundo #04060e em volta. O canvas tem o tamanho da caixa
// vezes o devicePixelRatio, e o último quadro é desenhado de novo quando ela muda de tamanho.
// O contrato da página com as memórias: a vista que monta, ou que ganha uma memória nova, só desenha um quadro com o
// `seq` maior que o da memória naquele instante (o `visto` começa no `seqDe` dela), e o `seq` 0 é vazio (só o fundo). Com
// o `desenhar` desligado, ela fica com o fundo e não lê. Montada, ela conta como à vista (o `mostrar`, que o `videoViews`
// leva ao núcleo). O `data-vista`, o `data-memoria` (a memória já chegou) e o `data-desenho` do canvas não mudam nada:
// mostram aos testes em que pé ela está.
import type { VNode } from 'preact';
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { VistaDeVideoNome } from '../state';
import { criarDesenhista, type Desenhista } from '../video/desenho';
import { lerQuadro, seqDe, type QuadroI420 } from '../video/memoria';
import { VideoContexto } from '../video/vistas';

interface Props {
  vista: VistaDeVideoNome;
  /** A imagem desta vista vale agora (a da ligação dela chegando, a câmera ligada); desligado, só o fundo. */
  desenhar: boolean;
  /** O nome para o leitor de tela. */
  rotulo: string;
  /** A sua imagem, como num espelho. */
  espelhar?: boolean;
  class?: string;
}

export function VistaDeVideo({ vista, desenhar, rotulo, espelhar, class: classe }: Props): VNode {
  const video = useContext(VideoContexto);
  const [memoria, setMemoria] = useState<ArrayBuffer | null>(() => video?.memoria(vista) ?? null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const desenhista = useRef<Desenhista | null>(null);
  // A memória que a leitura usa: troca no mesmo passo do `visto`, antes do próximo quadro de tela (a velha já foi solta).
  const lendo = useRef<ArrayBuffer | null>(null);
  // O `seq` do último quadro desenhado (ou o da memória quando ela chegou) e o próprio quadro (para o tamanho novo).
  const visto = useRef(0);
  const ultimo = useRef<QuadroI420 | null>(null);

  // À vista enquanto está montada; a memória da vista acompanha a que chega (uma pode ter chegado depois do primeiro
  // desenho, antes de ouvir).
  useEffect(() => {
    if (!video) return;
    const tirar = video.mostrar(vista);
    const parar = video.aoMudar((v) => {
      if (v === vista) setMemoria(video.memoria(vista));
    });
    setMemoria(video.memoria(vista));
    return () => {
      parar();
      tirar();
    };
  }, [video, vista]);

  // O desenho e o tamanho do canvas: a caixa vezes o devicePixelRatio, pelo ResizeObserver. Ao desmontar, o WebGL solta
  // as texturas e o contexto.
  useLayoutEffect(() => {
    const c = canvas.current!;
    const d = criarDesenhista(c);
    desenhista.current = d;
    c.dataset.desenho = d.tipo;
    d.limpar();
    const observador = new ResizeObserver(([entrada]) => {
      const largura = Math.max(1, Math.round(entrada.contentRect.width * devicePixelRatio));
      const altura = Math.max(1, Math.round(entrada.contentRect.height * devicePixelRatio));
      if (c.width === largura && c.height === altura) return;
      c.width = largura;
      c.height = altura;
      if (ultimo.current) d.desenhar(ultimo.current);
      else d.limpar();
    });
    observador.observe(c);
    return () => {
      observador.disconnect();
      desenhista.current = null;
      d.liberar();
    };
  }, []);

  // O contrato da página: ao montar e a cada memória nova, só um quadro mais novo que o dela agora. Um efeito de layout,
  // no mesmo passo em que o `data-memoria` aparece: um quadro gravado logo depois já conta como novo.
  useLayoutEffect(() => {
    lendo.current = memoria;
    visto.current = memoria ? seqDe(memoria) : 0;
    ultimo.current = null;
    desenhista.current?.limpar();
  }, [memoria]);

  // A leitura, a cada quadro de tela: o quadro novo e inteiro (o `lerQuadro` confere o `seq` antes e depois da cópia). Um
  // efeito de layout, como o de cima: o laço para (e o fundo volta) no mesmo passo do desenho que desliga o `desenhar`. Com
  // um efeito comum, que o Preact roda depois do próximo quadro de tela, o laço antigo ainda leria um quadro gravado nesse
  // meio-tempo e o marcaria como visto: na volta do `desenhar`, ele não apareceria mais.
  useLayoutEffect(() => {
    const d = desenhista.current;
    if (!d) return;
    if (!desenhar || !memoria) {
      ultimo.current = null;
      d.limpar();
      return;
    }
    let pedido = 0;
    const ler = () => {
      const m = lendo.current;
      if (m && seqDe(m) === 0) {
        // A memória esvaziou (a ligação dela mudou ou acabou): sem imagem.
        if (ultimo.current) {
          ultimo.current = null;
          d.limpar();
        }
      } else if (m) {
        const q = lerQuadro(m, visto.current);
        if (q) {
          visto.current = q.seq;
          ultimo.current = q;
          d.desenhar(q);
        }
      }
      pedido = requestAnimationFrame(ler);
    };
    pedido = requestAnimationFrame(ler);
    return () => cancelAnimationFrame(pedido);
  }, [desenhar, memoria]);

  return (
    <div class={classe ? `vista-video ${classe}` : 'vista-video'} role="img" aria-label={rotulo} data-vista={vista} data-memoria={memoria ? '' : undefined}>
      <canvas ref={canvas} style={espelhar ? { transform: 'scaleX(-1)' } : undefined} />
    </div>
  );
}
