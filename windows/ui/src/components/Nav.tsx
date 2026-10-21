// A navegação de baixo: Teclado, Recentes e Contatos (Ctrl+1, 2 e 3).
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
          aria-current={t === tab ? 'page' : undefined}
          aria-keyshortcuts={key}
          onClick={() => onSelect(t)}
        >
          <span class="tab-pill">
            <Icon />
          </span>
          {label}
        </button>
      ))}
    </nav>
  );
}
