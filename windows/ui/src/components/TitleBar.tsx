// A barra de título própria (a janela não tem a moldura do Windows): arrasta a janela (app-region: drag) e tem
// Minimizar e Fechar (o fechar manda a janela para a bandeja: o app continua recebendo ligações).
import { IconClose, IconMinimize } from '../icons';
import type { Send } from '../types';

interface Props {
  send: Send;
  /** "Fechar para a bandeja" (o padrão) ou "Fechar" (a tela Entrar, como no canvas). */
  closeLabel?: string;
  /** O texto da barra ("Starsonic Phone · Recepção · 2001" na ligação); sem ele, "Starsonic Phone". */
  title?: string;
}

export function TitleBar({ send, closeLabel = 'Fechar para a bandeja', title = 'Starsonic Phone' }: Props) {
  return (
    <div class="titlebar">
      <span class="titlebar-text">{title}</span>
      <div class="caption">
        <button type="button" aria-label="Minimizar" title="Minimizar" onClick={() => send({ cmd: 'minimize' })}>
          <IconMinimize />
        </button>
        <button type="button" class="caption-close" aria-label={closeLabel} title={closeLabel} onClick={() => send({ cmd: 'closeToTray' })}>
          <IconClose />
        </button>
      </div>
    </div>
  );
}
