// A barra de título própria (a janela não tem a moldura do Windows): arrasta a janela (app-region: drag) e tem
// Minimizar e Fechar (o fechar manda a janela para a bandeja: o app continua recebendo ligações). Na ligação, a
// barra mostra também a bolinha da conta em uso ("Ocupado · em ligação" em vermelho: o cabeçalho fica escondido).
import type { AccountDot } from '../format';
import { IconClose, IconMinimize } from '../icons';
import { ResizeZones } from './ResizeZones';
import type { Send } from '../types';

interface Props {
  send: Send;
  /** "Fechar para a bandeja" (o padrão) ou "Fechar" (a tela Entrar, como no canvas). */
  closeLabel?: string;
  /** O texto da barra ("Starsonic Phone · Recepção · 2001" na ligação); sem ele, "Starsonic Phone". */
  title?: string;
  /** A bolinha da conta e o estado (só na ligação). */
  status?: AccountDot;
}

export function TitleBar({ send, closeLabel = 'Fechar para a bandeja', title = 'Starsonic Phone', status }: Props) {
  return (
    <div class="titlebar">
      {status && (
        <span class="account-status">
          <span class={status.dot} aria-hidden="true" />
          <span class="account-status-text">{status.texto}</span>
        </span>
      )}
      <span class="titlebar-text">{title}</span>
      {/* As zonas de redimensionar da janela (a barra de título está em toda tela da janela principal). */}
      <ResizeZones send={send} />
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
