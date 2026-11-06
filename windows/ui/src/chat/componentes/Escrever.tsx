// O lugar de escrever da conversa (os quadros Conversa e Grupo): um textarea que cresce até 5 linhas (depois, rola por
// dentro) e o Enviar. O Enter envia, e o Shift+Enter pula linha; o texto fica em até 4.000 caracteres, contados como o
// servidor conta (pontos de código: um emoji conta 1), e "Faltam <n>" aparece com 200 ou menos. Um texto só de espaços
// não sai. O foco vai ao campo quando a conversa abre e volta a ele depois do Enviar. (Task 7) O clipe e os anexos.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { limitCharacters } from '../../format';
import { IconArrowRight } from '../../icons';
import { ENVIAR, faltam } from '../textos';

/** O texto de uma mensagem tem até 4.000 caracteres (docs/chat-protocolo.md, seção 3). */
const MAX_TEXTO = 4000;
/** O "Faltam <n>" aparece com 200 ou menos. */
const FALTAM_A_PARTIR_DE = 200;
const ID_DO_FALTAM = 'escrever-faltam';

interface Props {
  /** O nome do campo para o leitor de tela ("Mensagem para Ana Souza"). */
  rotulo: string;
  placeholder: string;
  onEnviar(texto: string): void;
}

export function Escrever({ rotulo, placeholder, onEnviar }: Props) {
  const [texto, setTexto] = useState('');
  const campo = useRef<HTMLTextAreaElement>(null);
  const restam = MAX_TEXTO - [...texto].length;

  useLayoutEffect(() => {
    campo.current?.focus();
  }, []);
  // A altura acompanha o texto, até o max-height do app.css (5 linhas).
  useLayoutEffect(() => {
    const el = campo.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [texto]);

  const enviar = () => {
    if (!texto.trim()) return;
    onEnviar(texto);
    setTexto('');
  };

  return (
    <div class="escrever">
      <div class="escrever-texto">
        <textarea
          ref={campo}
          class="escrever-campo"
          rows={1}
          aria-label={rotulo}
          aria-describedby={restam <= FALTAM_A_PARTIR_DE ? ID_DO_FALTAM : undefined}
          placeholder={placeholder}
          value={texto}
          onInput={(e) => {
            const el = e.currentTarget;
            const cabe = limitCharacters(el.value, MAX_TEXTO);
            // No limite, o que passa sai também do campo (o estado igual não desenharia de novo).
            if (cabe !== el.value) el.value = cabe;
            setTexto(cabe);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
            e.preventDefault();
            enviar();
          }}
        />
        {restam <= FALTAM_A_PARTIR_DE && (
          <span id={ID_DO_FALTAM} class="escrever-faltam">
            {faltam(restam)}
          </span>
        )}
      </div>
      <button
        type="button"
        class="escrever-enviar"
        aria-label={ENVIAR}
        title={ENVIAR}
        onClick={() => {
          enviar();
          campo.current?.focus();
        }}
      >
        <IconArrowRight />
      </button>
    </div>
  );
}
