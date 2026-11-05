// A navegação de baixo: as abas de `tabs`, uma coluna para cada. No Windows, Teclado, Atalhos, Recentes e Contatos
// (Ctrl+1 a 4, nessa ordem) e, (0.2.0) com o computador ligado ao chat, o Chat (Ctrl+5), com o número de não lidas no
// canto do ícone (o nome dele é o rótulo de leitor de tela: "Chat, 2 mensagens não lidas"); no iPhone (plataforma.ts),
// Teclado, Recentes e Contatos, sem as teclas. No Normal e no Compacto, o ícone e o rótulo de cada aba (Ruling 10 da
// rc.3); no Mínimo, só os ícones (o nome de cada aba fica no aria-label).
import { CHAT, rotuloDaAba } from '../chat/textos';
import { IconBolt, IconClock, IconContacts, IconKeypad, IconMessage } from '../icons';
import type { Tab } from '../types';

interface Props {
  /** As abas, na ordem. */
  tabs: Tab[];
  tab: Tab | null;
  onSelect(tab: Tab): void;
  /** As teclas Ctrl+1 a 5 trocam a aba (só no Windows): cada aba diz a sua no aria-keyshortcuts. */
  keyShortcuts: boolean;
  /** (0.2.0) As não lidas do chat: o número da aba Chat (0 ou nada: sem número). */
  naoLidas?: number;
}

export const TABS: Array<{ tab: Tab; label: string; Icon: typeof IconKeypad; key: string }> = [
  { tab: 'teclado', label: 'Teclado', Icon: IconKeypad, key: 'Control+1' },
  { tab: 'atalhos', label: 'Atalhos', Icon: IconBolt, key: 'Control+2' },
  { tab: 'recentes', label: 'Recentes', Icon: IconClock, key: 'Control+3' },
  { tab: 'contatos', label: 'Contatos', Icon: IconContacts, key: 'Control+4' },
  { tab: 'chat', label: CHAT, Icon: IconMessage, key: 'Control+5' },
];

export function Nav({ tabs, tab, onSelect, keyShortcuts, naoLidas = 0 }: Props) {
  return (
    <nav class="nav" aria-label="Seções" style={{ '--abas': tabs.length }}>
      {tabs.map((t) => {
        const { label, Icon, key } = TABS.find((d) => d.tab === t)!;
        const numero = t === 'chat' ? naoLidas : 0;
        return (
          <button
            type="button"
            key={t}
            class={t === tab ? `tab tab-${t} tab-on` : `tab tab-${t}`}
            aria-label={t === 'chat' ? rotuloDaAba(numero) : label}
            aria-current={t === tab ? 'page' : undefined}
            aria-keyshortcuts={keyShortcuts ? key : undefined}
            onClick={() => onSelect(t)}
          >
            <span class="tab-pill">
              <Icon />
              {numero > 0 && (
                <span class="tab-numero" aria-hidden="true">
                  {numero}
                </span>
              )}
            </span>
            <span class="tab-label">{label}</span>
          </button>
        );
      })}
      {/* O canto de arrastar o tamanho da janela (só o desenho: quem redimensiona é a borda do Windows). No iPhone, sem
          as zonas de redimensionar, o app.css o esconde. */}
      <svg class="grip" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        <path d="M11 3L3 11M11 7L7 11" />
      </svg>
    </nav>
  );
}
