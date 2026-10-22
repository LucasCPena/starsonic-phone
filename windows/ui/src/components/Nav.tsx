// A navegação de baixo: Teclado, Recentes e Contatos (Ctrl+1, 2 e 3). No layout Mínimo, só os ícones (o nome de
// cada aba fica no aria-label).
import { IconClock, IconContacts, IconKeypad } from '../icons';
import type { Tab } from '../types';

interface Props {
  tab: Tab | null;
  onSelect(tab: Tab): void;
}

const TABS: Array<{ tab: Tab; label: string; Icon: typeof IconKeypad; key: string }> = [
  { tab: 'teclado', label: 'Teclado', Icon: IconKeypad, key: 'Control+1' },
  { tab: 'recentes', label: 'Recentes', Icon: IconClock, key: 'Control+2' },
  { tab: 'contatos', label: 'Contatos', Icon: IconContacts, key: 'Control+3' },
];

export function Nav({ tab, onSelect }: Props) {
  return (
    <nav class="nav" aria-label="Seções">
      {TABS.map(({ tab: t, label, Icon, key }) => (
        <button
          type="button"
          key={t}
          class={t === tab ? 'tab tab-on' : 'tab'}
          aria-label={label}
          aria-current={t === tab ? 'page' : undefined}
          aria-keyshortcuts={key}
          onClick={() => onSelect(t)}
        >
          <span class="tab-pill">
            <Icon />
          </span>
          <span class="tab-label">{label}</span>
        </button>
      ))}
      {/* O canto de arrastar o tamanho da janela (só o desenho: quem redimensiona é a borda do Windows). */}
      <svg class="grip" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        <path d="M11 3L3 11M11 7L7 11" />
      </svg>
    </nav>
  );
}
