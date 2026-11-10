// A lista de escolha das Configurações (o Microfone, o Alto-falante, o Toque, o tempo para atender e, 0.3.0, a Câmera):
// o <select> sem a borda, com o texto à direita e a seta. Desativado (`disabled`), fica com uma opção só, como a Câmera
// sem câmeras.
import { IconChevronDown } from '../icons';

export interface Opcao {
  valor: string;
  texto: string;
}

interface Props {
  id: string;
  value: string;
  options: Opcao[];
  onChange(v: string): void;
  disabled?: boolean;
}

export function Select({ id, value, options, onChange, disabled }: Props) {
  return (
    <span class="select">
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.currentTarget.value)}>
        {options.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.texto}
          </option>
        ))}
      </select>
      <IconChevronDown size="sm" />
    </span>
  );
}
