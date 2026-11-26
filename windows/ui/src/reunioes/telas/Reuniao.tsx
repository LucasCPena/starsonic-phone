// A vista da reunião dentro da janela do app (as telas 6 e 7 do quadro e "A reunião não abriu."): a barra do app (o
// estado e a conta à esquerda; o "Tela cheia", o minimizar e o fechar à direita) e, embaixo, o iframe da página da
// reunião. O iframe nasce com o src e o allow juntos (o src é `<chat>/r/<código>` e mais nada: o passe vai por
// mensagem, nunca no endereço), com o title "Reunião", e recebe o foco quando a vista abre; a barra vem antes dele na
// ordem do Tab. Com a fase `naoAbriu` o iframe sai e entram o título, o "Tentar de novo", o "Fechar" e o "Abrir no
// navegador"; o foco vai ao título. A vista é montada uma vez, fora da raiz de cada tela do main.tsx: a tela do iframe
// não é desmontada por uma troca de tela nem pela tela cheia (o documento da reunião fica o mesmo).
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { IconExitFullscreen, IconFullscreen } from '../../icons';
import type { Layout } from '../../layout';
import {
  A_REUNIAO_NAO_ABRIU,
  ABRIR_NO_NAVEGADOR,
  FECHAR,
  REUNIAO,
  SAIR_DA_TELA_CHEIA,
  TELA_CHEIA,
  TENTAR_DE_NOVO,
} from '../textos';
import type { ReuniaoNoApp, VistaNoApp } from '../vista';

/** A vista do controlador para as telas: a de agora, e de novo a cada mudança dele (como o usarReunioes.ts). */
export function useVistaDaReuniao(controle: ReuniaoNoApp): VistaNoApp {
  const [vista, setVista] = useState(() => controle.vista());
  useLayoutEffect(() => {
    const parar = controle.assinar(() => setVista(controle.vista()));
    // O que mudou entre o primeiro desenho e a assinatura.
    setVista(controle.vista());
    return parar;
  }, [controle]);
  return vista;
}

interface Props {
  controle: ReuniaoNoApp;
  vista: VistaNoApp;
  /** O endereço do chat: a origem dele é a do `allow` do iframe. */
  origem: string;
  /** A barra de título do app (o `barra(...)` do main.tsx), com os botões desta vista antes do minimizar. */
  barra: (acoes: ComponentChildren) => ComponentChildren;
  layout: Layout;
  plataforma: string | undefined;
  /** O aviso curto do app: a lista fica embaixo da vista, e o aviso tem de aparecer em cima dela. */
  toast: ComponentChildren;
}

export function Reuniao({ controle, vista, origem, barra, layout, plataforma, toast }: Props) {
  const quadro = useRef<HTMLIFrameElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  const comQuadro = vista.endereco !== null;
  // O Tentar de novo com o passe vindo: `aria-disabled` e o clique ignorado (um `disabled` com o foco o jogaria
  // para o fundo).
  const [tentando, setTentando] = useState(false);
  const viva = useRef(true);
  useLayoutEffect(
    () => () => {
      viva.current = false;
    },
    [],
  );
  const tentarDeNovo = async () => {
    if (tentando) return;
    setTentando(true);
    await controle.tentarDeNovo();
    if (viva.current) setTentando(false);
  };
  const telaCheia = vista.janela === 'telaCheia';
  // Um efeito de layout: o useEffect não roda com o relógio da página parado nos testes. O elemento é dito ao
  // controlador a cada documento novo (a chave do iframe é o `quadro`), e o foco vai para ele.
  useLayoutEffect(() => {
    if (!comQuadro) return;
    const el = quadro.current;
    controle.quadroMontado(el);
    el?.focus();
    return () => controle.quadroMontado(null);
  }, [controle, vista.quadro, comQuadro]);
  useLayoutEffect(() => {
    if (vista.fase === 'naoAbriu') titulo.current?.focus();
  }, [vista.fase === 'naoAbriu']);

  const acoes = (
    <button
      type="button"
      class="caption-texto"
      onClick={() => controle.telaCheia(!telaCheia)}
    >
      {telaCheia ? <IconExitFullscreen size="sm" /> : <IconFullscreen size="sm" />}
      {telaCheia ? SAIR_DA_TELA_CHEIA : TELA_CHEIA}
    </button>
  );

  return (
    <div class="reuniao-vista">
      <div
        class={`win reuniao ${telaCheia ? 'win-tela-cheia' : 'win-grande'}`}
        data-layout={layout}
        data-plataforma={plataforma}
      >
        {barra(acoes)}
        <div class="reuniao-corpo">
          {comQuadro ? (
            <iframe
              key={vista.quadro}
              ref={quadro}
              class="reuniao-quadro"
              title={REUNIAO}
              allow={['camera', 'microphone', 'display-capture', 'autoplay', 'speaker-selection']
                .map((p) => `${p} ${origem}`)
                .join('; ')}
              src={vista.endereco ?? undefined}
            />
          ) : (
            <div class="reuniao-falha">
              <h1 ref={titulo} class="reuniao-falha-titulo" tabIndex={-1}>
                {A_REUNIAO_NAO_ABRIU}
              </h1>
              <div class="reuniao-falha-botoes">
                <button
                  type="button"
                  class="btn btn-cyan"
                  aria-disabled={tentando ? 'true' : undefined}
                  onClick={() => void tentarDeNovo()}
                >
                  {TENTAR_DE_NOVO}
                </button>
                <button type="button" class="btn btn-outline" onClick={() => controle.fechar()}>
                  {FECHAR}
                </button>
                <button type="button" class="btn btn-outline" onClick={() => void controle.abrirNoNavegador()}>
                  {ABRIR_NO_NAVEGADOR}
                </button>
              </div>
            </div>
          )}
        </div>
        {toast}
      </div>
    </div>
  );
}
