// (iPhone) Os avisos de licença (spec do iPhone, 10), abertos pela linha "Avisos de licença" do Sobre: o nome, a versão e
// o texto inteiro da licença de cada peça de terceiros do app do iPhone, como estão em assets/licencas-ios.txt (o mesmo
// arquivo vai no pacote do app). O texto vem pelo fetch do mesmo lugar, que a CSP deixa (connect-src 'self'); ele rola
// também pelo teclado (a região recebe o foco). Sem o arquivo (o pacote quebrado), o "Reinstale o Starsonic Phone." das
// outras telas da interface.
import type { VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { BackBar } from '../components/BackBar';

const TITULO = 'Avisos de licença';
const ARQUIVO = 'assets/licencas-ios.txt';

export function Licencas({ onBack }: { onBack(): void }): VNode {
  // null: lendo; false: o arquivo não veio.
  const [texto, setTexto] = useState<string | false | null>(null);
  useEffect(() => {
    let aberta = true;
    fetch(ARQUIVO)
      .then((resposta) => (resposta.ok ? resposta.text() : Promise.reject(new Error(`HTTP ${resposta.status}`))))
      .then(
        (lido) => aberta && setTexto(lido),
        () => aberta && setTexto(false),
      );
    return () => {
      aberta = false;
    };
  }, []);
  return (
    <>
      <BackBar title={TITULO} onBack={onBack} />
      <div class="body scroll licencas" role="region" aria-label={TITULO} tabIndex={0}>
        {texto === false ? (
          <p class="empty" role="alert">
            Reinstale o Starsonic Phone.
          </p>
        ) : (
          texto !== null && <pre class="licencas-texto">{texto}</pre>
        )}
      </div>
    </>
  );
}
