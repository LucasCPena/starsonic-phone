// Os controles da tela da ligação, que saíram do Ligacao.tsx sem mudar para a sala de vídeo (0.4.0) usar também: o
// confirmada (a ligação atendida e confirmada pelo motor), o Avatar, o Ctrl (um controle redondo com o rótulo embaixo),
// o NoWindows (no Windows, os botões da tela da ligação ignoram o segundo clique de um clique duplo) e o RoundAction (o
// Desligar, o Recusar e os Atender). (0.4.0) O Ctrl ganhou o `descritoPor`, o texto que diz por que ele espera.
import { createContext, type ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';
import { initials } from '../format';
import { IconPhone, IconVideo } from '../icons';
import { semSegundoClique } from '../plataforma';
import type { CallCard } from '../state';

/** Em andamento e confirmada pelo motor (o Alternar, o Juntar e o Concluir só valem entre ligações assim). */
export function confirmada(card: CallCard): boolean {
  return card.phase === 'active' && card.activeSinceMs > 0;
}

export function Avatar({ card, large }: { card: CallCard; large?: boolean }) {
  return (
    <span class={large ? 'avatar avatar-lg' : 'avatar'} aria-hidden="true">
      {card.name ? initials(card.name) : <IconPhone size={large ? 'lg' : 'sm'} />}
    </span>
  );
}

export interface CtrlProps {
  /** O rótulo embaixo do círculo (também o nome do botão, sem o `nome`). */
  label: ComponentChildren;
  /** (iPhone) O nome do botão, quando o rótulo não diz tudo (o Áudio: "Áudio: <saída>"). */
  nome?: string;
  icon: ComponentChildren;
  onClick(): void;
  pressed?: boolean;
  /** (vídeo, etapa 2) Aceso como o pressionado, sem o aria-pressed: a Câmera, cujo nome já diz a ação. */
  aceso?: boolean;
  disabled?: boolean;
  popup?: boolean;
  expanded?: boolean;
  ctrlRef?: { current: HTMLButtonElement | null };
  /** (0.4.0) O id do texto que descreve o botão (o aria-describedby): o Adicionar pessoa da sala cheia diz por quê. */
  descritoPor?: string;
}

/**
 * (rc.6) A tela da ligação no Windows: os botões dela (os controles, o Desligar e os dos painéis de número) ignoram o
 * segundo clique de um clique duplo (o semSegundoClique). No iPhone, não.
 */
export const NoWindows = createContext(false);

export function Ctrl({ label, nome, icon, onClick, pressed, aceso, disabled, popup, expanded, ctrlRef, descritoPor }: CtrlProps) {
  const noWindows = useContext(NoWindows);
  const classes = ['ctrl', pressed || aceso ? 'ctrl-on' : '', disabled ? 'ctrl-off' : ''].filter(Boolean).join(' ');
  return (
    <button
      ref={ctrlRef}
      type="button"
      class={classes}
      aria-label={nome}
      aria-describedby={descritoPor}
      aria-pressed={pressed === undefined ? undefined : pressed}
      aria-haspopup={popup ? 'menu' : undefined}
      aria-expanded={popup ? expanded === true : undefined}
      disabled={disabled}
      onClick={semSegundoClique(noWindows, onClick)}
    >
      <span class="ctrl-c">{icon}</span>
      {label}
    </button>
  );
}

/**
 * Um botão redondo grande com o rótulo fora (Desligar e Recusar em vermelho, Atender em ciano). Quem usa passa o onClick
 * já com o semSegundoClique (no Windows): o núcleo age na primeira que toca, a cada comando, e o segundo clique do
 * Recusar recusaria a segunda ligação, que aparece com o botão no mesmo lugar (e o do Atender a atenderia). O Atender com
 * vídeo (`video`) é o Atender com a borda ciano e a câmera: só ele manda o `video: true`.
 */
export function RoundAction({ label, kind, onClick }: { label: string; kind: 'hang' | 'answer' | 'video'; onClick(e: MouseEvent): void }) {
  return (
    <div class="round-action">
      <button type="button" class={kind === 'hang' ? 'hang' : kind === 'video' ? 'hang answer-video' : 'hang answer'} aria-label={label} onClick={onClick}>
        {kind === 'video' ? <IconVideo size="lg" /> : <IconPhone size="lg" />}
      </button>
      <span aria-hidden="true">{label}</span>
    </div>
  );
}
