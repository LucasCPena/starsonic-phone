// Os ícones do canvas: SVG de linha 24×24, traço 2, pontas arredondadas, currentColor (o traço vem do .ic).
import type { ComponentChildren } from 'preact';

type Size = 'sm' | 'md' | 'lg';

interface IconProps {
  size?: Size;
  class?: string;
}

function svg(children: ComponentChildren) {
  return function Icon({ size = 'md', class: extra }: IconProps) {
    const classes = ['ic', size === 'sm' ? 'ic-sm' : size === 'lg' ? 'ic-lg' : '', extra ?? ''].filter(Boolean).join(' ');
    return (
      <svg class={classes} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        {children}
      </svg>
    );
  };
}

export const IconMinimize = svg(<path d="M5 12h14" />);
export const IconClose = svg(<path d="M6 6l12 12M18 6L6 18" />);
export const IconMenu = svg(
  <>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </>,
);
export const IconChevronDown = svg(<path d="M6 9l6 6 6-6" />);
/** Não perturbe. */
export const IconDnd = svg(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12h8" />
  </>,
);
/** Recebida (e Atender automático): a seta para baixo e a esquerda. */
export const IconIncoming = svg(
  <>
    <path d="M17 7L7 17" />
    <path d="M15 17H7V9" />
  </>,
);
/** Feita: a seta para cima e a direita. */
export const IconOutgoing = svg(
  <>
    <path d="M7 17L17 7" />
    <path d="M9 7h8v8" />
  </>,
);
export const IconBackspace = svg(
  <>
    <path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z" />
    <path d="M17 9l-5 5M12 9l5 5" />
  </>,
);
export const IconArrowRight = svg(
  <>
    <path d="M5 12h14" />
    <path d="M13 6l6 6-6 6" />
  </>,
);
export const IconBack = svg(
  <>
    <path d="M19 12H5" />
    <path d="M11 18l-6-6 6-6" />
  </>,
);
export const IconPhone = svg(
  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />,
);
export const IconKeypad = svg(
  <>
    <circle cx="6" cy="5" r="1.3" />
    <circle cx="12" cy="5" r="1.3" />
    <circle cx="18" cy="5" r="1.3" />
    <circle cx="6" cy="11" r="1.3" />
    <circle cx="12" cy="11" r="1.3" />
    <circle cx="18" cy="11" r="1.3" />
    <circle cx="6" cy="17" r="1.3" />
    <circle cx="12" cy="17" r="1.3" />
    <circle cx="18" cy="17" r="1.3" />
    <circle cx="12" cy="22" r="0.6" />
  </>,
);
export const IconClock = svg(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </>,
);
export const IconContacts = svg(
  <>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    <path d="M16 4.5a3.5 3.5 0 0 1 0 7" />
    <path d="M18 14c2 .7 3 2.8 3 6" />
  </>,
);
export const IconSearch = svg(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </>,
);
export const IconPlus = svg(<path d="M12 5v14M5 12h14" />);
export const IconPencil = svg(
  <>
    <path d="M4 20h4l10-10-4-4L4 16v4z" />
    <path d="M13.5 6.5l4 4" />
  </>,
);
export const IconEye = svg(
  <>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);
export const IconEyeOff = svg(
  <>
    <path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-2.9 3.8M6.6 6.6C3.6 8.5 2 12 2 12s3.6 7 10 7a10 10 0 0 0 5.4-1.6" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    <path d="M3 3l18 18" />
  </>,
);
export const IconGlobe = svg(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z" />
  </>,
);
export const IconCode = svg(
  <>
    <path d="M8 7l-5 5 5 5" />
    <path d="M16 7l5 5-5 5" />
  </>,
);
/** As opções de um contato (os três pontos). */
export const IconMore = svg(
  <>
    <circle cx="12" cy="5" r="1.2" />
    <circle cx="12" cy="12" r="1.2" />
    <circle cx="12" cy="19" r="1.2" />
  </>,
);
export const IconCheck = svg(<path d="M5 12.5l4.5 4.5L19 7.5" />);
export const IconAlert = svg(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5" />
    <path d="M12 16.5v.01" />
  </>,
);
export const IconSettings = svg(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </>,
);
export const IconInfo = svg(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5" />
    <path d="M12 7.5v.01" />
  </>,
);
export const IconExit = svg(
  <>
    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
    <path d="M10 17l-5-5 5-5" />
    <path d="M5 12h11" />
  </>,
);
export const IconMessage = svg(
  <path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.5L3 21l2-5.5A8.4 8.4 0 1 1 21 11.5z" />,
);
export const IconTrash = svg(
  <>
    <path d="M4 7h16" />
    <path d="M10 11v6M14 11v6" />
    <path d="M6 7l1 13h10l1-13" />
    <path d="M9 7V4h6v3" />
  </>,
);

// A tela da ligação (os do canvas: Chamada, Consulta e Conferência; Juntar desenhado no mesmo traço).
export const IconMic = svg(
  <>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <path d="M12 18v3" />
  </>,
);
export const IconMicOff = svg(
  <>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <path d="M12 18v3" />
    <path d="M4 4l16 16" />
  </>,
);
/** Áudio (o alto-falante com as duas ondas). */
export const IconSpeaker = svg(
  <>
    <path d="M11 5L6 9H3v6h3l5 4V5z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    <path d="M18.5 5.5a9 9 0 0 1 0 13" />
  </>,
);
/** Falando (o cartão da conferência). */
export const IconSpeaking = svg(
  <>
    <path d="M11 5L6 9H3v6h3l5 4V5z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
  </>,
);
export const IconPause = svg(<path d="M9 6v12M15 6v12" />);
/** Alternar. */
export const IconSwap = svg(
  <>
    <path d="M7 4L3 8l4 4" />
    <path d="M3 8h14" />
    <path d="M17 20l4-4-4-4" />
    <path d="M21 16H7" />
  </>,
);
/** Separar. */
export const IconSplit = svg(
  <>
    <path d="M12 20v-8" />
    <path d="M12 12L6 5" />
    <path d="M12 12l6-7" />
    <path d="M6 9V5h4" />
    <path d="M18 9V5h-4" />
  </>,
);
/** Juntar (o Separar ao contrário: as duas linhas se encontram). */
export const IconMerge = svg(
  <>
    <path d="M12 4v8" />
    <path d="M12 12l-6 7" />
    <path d="M12 12l6 7" />
    <path d="M8 7l4-4 4 4" />
  </>,
);
