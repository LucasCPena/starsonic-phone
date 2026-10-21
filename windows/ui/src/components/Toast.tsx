// O aviso de 2 s (o `toast` da ponte). A região fica sempre na página para o leitor de tela anunciar o texto.
interface Props {
  texto: string | null;
  /** Muda a cada toast (um novo toma o lugar do que está na tela). */
  vez: number;
}

export function Toast({ texto, vez }: Props) {
  return (
    <div class="toast" role="status" aria-live="polite">
      {texto ? (
        <div class="toast-box" key={vez}>
          {texto}
        </div>
      ) : null}
    </div>
  );
}
