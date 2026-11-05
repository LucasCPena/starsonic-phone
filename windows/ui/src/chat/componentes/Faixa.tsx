// A faixa de aviso do chat, de ponta a ponta embaixo do cabeçalho (o quadro SemConexao): "Sem conexão com o chat.
// Tentando de novo…" e, com o "×" ("Fechar o aviso"), o computador novo. É um `status`: o leitor de tela diz o texto.
import type { ComponentChildren } from 'preact';
import { IconClose } from '../../icons';
import { FECHAR_O_AVISO } from '../textos';

interface Props {
  icone?: ComponentChildren;
  /** O "×": sem ele, a faixa fica até o motivo dela passar. */
  onFechar?(): void;
  /** O texto (sempre como texto). */
  children: ComponentChildren;
}

export function Faixa({ icone, onFechar, children }: Props) {
  return (
    <div class={onFechar ? 'faixa faixa-fechavel' : 'faixa'} role="status">
      {icone}
      <span class="faixa-texto">{children}</span>
      {onFechar && (
        <button type="button" class="faixa-fechar" aria-label={FECHAR_O_AVISO} title={FECHAR_O_AVISO} onClick={onFechar}>
          <IconClose size="sm" />
        </button>
      )}
    </div>
  );
}
