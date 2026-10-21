// Um menu suspenso (role="menu"): abre com o foco no primeiro item (ou no marcado), setas e Home/End andam,
// Esc fecha e devolve o foco ao botão, um clique fora fecha.
import type { ComponentChildren, RefObject } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

interface Props {
  label: string;
  anchor: RefObject<HTMLElement>;
  onClose(): void;
  class?: string;
  children: ComponentChildren;
}

export function Menu({ label, anchor, onClose, class: extra, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  const items = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);

  useEffect(() => {
    const lista = items();
    (lista.find((i) => i.getAttribute('aria-checked') === 'true') ?? lista[0])?.focus();
    const fora = (e: PointerEvent) => {
      const alvo = e.target as Node;
      if (!ref.current?.contains(alvo) && !anchor.current?.contains(alvo)) onClose();
    };
    document.addEventListener('pointerdown', fora, true);
    return () => document.removeEventListener('pointerdown', fora, true);
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    const lista = items();
    const atual = lista.indexOf(document.activeElement as HTMLElement);
    const ir = (i: number) => lista[(i + lista.length) % lista.length]?.focus();
    switch (e.key) {
      case 'ArrowDown':
        ir(atual + 1);
        break;
      case 'ArrowUp':
        ir(atual - 1);
        break;
      case 'Home':
        ir(0);
        break;
      case 'End':
        ir(lista.length - 1);
        break;
      case 'Escape':
        onClose();
        anchor.current?.focus();
        break;
      case 'Tab':
        onClose();
        return;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div ref={ref} role="menu" aria-label={label} class={extra ? `popover ${extra}` : 'popover'} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}
