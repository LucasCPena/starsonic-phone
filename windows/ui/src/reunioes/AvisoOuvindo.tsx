// A frase "A reunião no navegador continua ouvindo você…" (spec 7.9), a mesma em toda tela de ligação: a tela comum, o
// grande e a tela cheia, a faixa da ligação com a conversa do chat e a sala de vídeo. A região fica sempre na página,
// vazia sem a frase (o leitor de tela diz o texto quando ele aparece).
import { NAVEGADOR_CONTINUA_OUVINDO } from './textos';

export function AvisoOuvindo({ ouvindo, fora = false }: { ouvindo: boolean; fora?: boolean }) {
  return (
    <p class={fora ? 'call-ouvindo call-ouvindo-fora' : 'call-ouvindo'} role="status">
      {ouvindo ? NAVEGADOR_CONTINUA_OUVINDO : ''}
    </p>
  );
}
