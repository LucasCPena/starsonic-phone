// O painel Atalhos da tela da ligação (rc.3, spec 3.1): os mesmos atalhos da aba, cada um com o que faz durante a
// ligação (Nova ligação, Transferir, Consulta, Enviar as teclas) e o BLF. O clique manda o useShortcut e fecha o
// painel; o Fechar atalhos (e o Esc, na tela da ligação) fecha sem usar nada; nos dois casos o foco volta ao botão
// Atalhos (Ligacao.tsx). O foco começa no Fechar: um Enter de quem estava nos controles nunca transfere a ligação.
// Com uma segunda ligação, Ligar e Consulta ficam travados (shortcutUsable); com só uma recebida tocando, nenhum
// atalho vale (o painel nem fica aberto).
import { useEffect, useRef } from 'preact/hooks';
import { shortcutCallLine, shortcutUsable } from '../format';
import { IconClose, ShortcutActionIcon } from '../icons';
import type { CallState, Shortcut } from '../state';
import type { Send } from '../types';
import { BlfBadge } from './Blf';

interface Props {
  atalhos: Shortcut[];
  ligacao: CallState;
  send: Send;
  /** Fechar atalhos (e o Esc). */
  onClose(): void;
  /** Um atalho usado: o painel fecha. */
  onUsed(): void;
}

export function AtalhosPainel({ atalhos, ligacao, send, onClose, onUsed }: Props) {
  const fechar = useRef<HTMLButtonElement>(null);
  useEffect(() => fechar.current?.focus(), []);
  return (
    <section class="atalhos-painel" aria-labelledby="atalhos-painel-titulo">
      <div class="atalhos-painel-topo">
        <h2 class="atalhos-painel-titulo" id="atalhos-painel-titulo">
          Atalhos
        </h2>
        <button ref={fechar} type="button" class="round-sm round-xs atalhos-fechar" aria-label="Fechar atalhos" title="Fechar atalhos" onClick={onClose}>
          <IconClose size="sm" />
        </button>
      </div>
      <div class="atalhos-lista">
        {atalhos.map((a) => {
          const usavel = shortcutUsable(a.acao, ligacao);
          return (
            <button
              type="button"
              key={a.id}
              class="atalho-linha"
              aria-disabled={usavel ? undefined : 'true'}
              onClick={() => {
                if (!usavel) return;
                send({ cmd: 'useShortcut', id: a.id });
                onUsed();
              }}
            >
              <span class="tile" aria-hidden="true">
                <ShortcutActionIcon acao={a.acao} naLigacao size="sm" />
              </span>
              <span class="row-main">
                <span class="row-title">{a.nome}</span>
                <span class="row-sub">{shortcutCallLine(a)}</span>
              </span>
              {a.estado !== null && <BlfBadge estado={a.estado} />}
            </button>
          );
        })}
      </div>
    </section>
  );
}
