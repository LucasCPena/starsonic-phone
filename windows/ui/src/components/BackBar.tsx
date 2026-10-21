// A barra escura das telas de Configurações, Sobre e dos formulários: Voltar e o título.
import { IconBack } from '../icons';

interface Props {
  title: string;
  onBack(): void;
}

export function BackBar({ title, onBack }: Props) {
  return (
    <div class="bar">
      <button type="button" class="icon-btn" aria-label="Voltar" title="Voltar" onClick={onBack}>
        <IconBack />
      </button>
      <h1 class="h1">{title}</h1>
    </div>
  );
}
