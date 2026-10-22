// A barra escura das telas de Configurações, Sobre e dos formulários: Voltar e o título. (rc.3) Com o `eyebrow`, a
// linha pequena em ciano em cima do título (a área do administrador); com o `extra`, um texto à direita (o "<n> de 8"
// da edição do atalho).
import { IconBack } from '../icons';

interface Props {
  title: string;
  onBack(): void;
  eyebrow?: string;
  extra?: string;
}

export function BackBar({ title, onBack, eyebrow, extra }: Props) {
  return (
    <div class="bar">
      <button type="button" class="icon-btn" aria-label="Voltar" title="Voltar" onClick={onBack}>
        <IconBack />
      </button>
      {eyebrow ? (
        <div class="bar-titulos">
          <p class="eyebrow bar-eyebrow">{eyebrow}</p>
          <h1 class="h1">{title}</h1>
        </div>
      ) : (
        <h1 class="h1">{title}</h1>
      )}
      {extra && <span class="bar-extra">{extra}</span>}
    </div>
  );
}
