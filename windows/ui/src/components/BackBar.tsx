// A barra escura das telas de Configurações, Sobre e dos formulários: Voltar e o título. (rc.3) Com o `eyebrow`, a
// linha pequena em ciano em cima do título (a área do administrador); com o `extra`, um texto à direita (o "<n> de 8"
// da edição do atalho); com o `focarTitulo`, o foco vai ao título quando a tela abre (uma tela sem um campo a focar).
import { useEffect, useRef } from 'preact/hooks';
import { IconBack } from '../icons';

interface Props {
  title: string;
  onBack(): void;
  eyebrow?: string;
  extra?: string;
  focarTitulo?: boolean;
}

export function BackBar({ title, onBack, eyebrow, extra, focarTitulo }: Props) {
  const titulo = useRef<HTMLHeadingElement>(null);
  // O leitor de tela diz o título e a pessoa sabe onde está; o Tab seguinte vai ao primeiro controle da tela. Num efeito
  // da montagem: o `autofocus` só vale uma vez por documento.
  useEffect(() => {
    if (focarTitulo) titulo.current?.focus();
  }, []);
  const h1 = (
    <h1 ref={titulo} class="h1" tabIndex={focarTitulo ? -1 : undefined}>
      {title}
    </h1>
  );
  return (
    <div class="bar">
      <button type="button" class="icon-btn" aria-label="Voltar" title="Voltar" onClick={onBack}>
        <IconBack />
      </button>
      {eyebrow ? (
        <div class="bar-titulos">
          <p class="eyebrow bar-eyebrow">{eyebrow}</p>
          {h1}
        </div>
      ) : (
        h1
      )}
      {extra && <span class="bar-extra">{extra}</span>}
    </div>
  );
}
