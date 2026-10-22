// A confirmação antes de remover (um <dialog> modal: o foco fica nele e Esc cancela). O botão de confirmar é o azul
// (o vermelho da marca é só do Desligar, do Recusar e da perdida, e o branco nele não chega a 4,5:1).
import { useEffect, useRef } from 'preact/hooks';

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm(): void;
  onCancel(): void;
}

export function Confirm({ title, message, confirmLabel, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialogo = ref.current!;
    if (!dialogo.open) dialogo.showModal();
    const cancelar = (e: Event) => {
      e.preventDefault();
      onCancel();
    };
    dialogo.addEventListener('cancel', cancelar);
    return () => dialogo.removeEventListener('cancel', cancelar);
  }, []);
  return (
    <dialog ref={ref} class="dialog" aria-labelledby="confirm-title" aria-describedby="confirm-text">
      <h2 id="confirm-title">{title}</h2>
      <p id="confirm-text">{message}</p>
      <div class="dialog-actions">
        <button type="button" class="btn btn-outline mini" autofocus onClick={onCancel}>
          Cancelar
        </button>
        <button type="button" class="btn btn-blue mini" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
