// (iPhone) Os avisos de licença (spec do iPhone, 10), abertos pela linha "Avisos de licença" do Sobre: o nome, a versão e
// o texto inteiro da licença de cada peça de terceiros do app do iPhone, como estão em assets/licencas-ios.txt (o mesmo
// arquivo vai no pacote do app). O texto vem pelo fetch do mesmo lugar, que a CSP deixa (connect-src 'self'), e a tela o
// mostra arrumado, sem mudar uma palavra: cada peça com o nome e a versão num título (no arquivo, a linha sublinhada com
// "="); em cada parágrafo, as linhas comuns juntas, quebrando na largura da tela (no arquivo, elas quebram em umas 78
// colunas); e como estão no arquivo, com os espaços, as linhas das caixas de "*" (a libg722), as linhas com recuo e os
// traços. Uma linha comum começa outra linha da tela quando abre um aviso de copyright, um item de lista ("1.", "1)" ou
// "- "), um endereço da web ou um título em maiúsculas ("PREAMBLE"). A região rola também pelo teclado (ela recebe o
// foco). Sem o arquivo (o pacote quebrado), o "Reinstale o Starsonic Phone." das outras telas da interface.
import type { VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { BackBar } from '../components/BackBar';

const TITULO = 'Avisos de licença';
const ARQUIVO = 'assets/licencas-ios.txt';

/** Uma linha da tela: as linhas comuns de um parágrafo, juntas, ou (`fixa`) uma linha como está no arquivo. */
interface Linha {
  texto: string;
  fixa: boolean;
}

/** Uma peça: o nome e a versão ("" num arquivo sem os títulos) e a licença, nos parágrafos do arquivo. */
interface Peca {
  titulo: string;
  paragrafos: Linha[][];
}

/** O título de uma peça: o nome e a versão, a linha de "=" do mesmo tamanho embaixo e uma linha em branco. */
const TITULO_DA_PECA = /^(\S.*)\n(=+)\n\n/gm;
/** Fica como está: com recuo, numa caixa de "*", ou só traços. */
const FIXA = /^\s|^\*|^[-=_~#]{3,}\s*$/;
/** Começa outra linha da tela: um aviso de copyright, "All rights reserved", um endereço da web ou um item de lista. */
const NOVA_LINHA = /^(Copyright\s+(\([cC]\)|©|\d)|All rights reserved|https?:\/\/|(\d+[.)]|[-•]|\([a-z0-9]+\))\s)/i;

/** Um título dentro da licença ("PREAMBLE", "PERMISSION & CONDITIONS"): curto, em maiúsculas e sem pontuação no fim. */
function tituloInterno(linha: string): boolean {
  return linha.length <= 40 && /[A-Z]/.test(linha) && linha === linha.toUpperCase() && !/[.:;,!?]$/.test(linha);
}

/** Os parágrafos de uma licença (separados por linhas em branco), com as linhas da tela de cada um. */
function paragrafosDe(licenca: string): Linha[][] {
  const paragrafos: Linha[][] = [];
  let atual: Linha[] = [];
  // A última linha da tela: uma comum, que pode receber a próxima, ou outra (uma fixa, um título).
  let junta = false;
  for (const linha of licenca.split('\n')) {
    if (linha.trim() === '') {
      if (atual.length > 0) paragrafos.push(atual);
      atual = [];
      junta = false;
    } else if (FIXA.test(linha)) {
      atual.push({ texto: linha, fixa: true });
      junta = false;
    } else {
      const comum = linha.trim();
      const titulo = tituloInterno(comum);
      if (junta && !titulo && !NOVA_LINHA.test(comum)) atual[atual.length - 1].texto += ` ${comum}`;
      else atual.push({ texto: comum, fixa: false });
      junta = !titulo;
    }
  }
  if (atual.length > 0) paragrafos.push(atual);
  return paragrafos;
}

/** As peças do arquivo, na ordem dele. */
function pecasDe(arquivo: string): Peca[] {
  const titulos = Array.from(arquivo.matchAll(TITULO_DA_PECA)).filter((m) => m[1].length === m[2].length);
  if (titulos.length === 0) return [{ titulo: '', paragrafos: paragrafosDe(arquivo) }];
  return titulos.map((m, i) => ({
    titulo: m[1],
    paragrafos: paragrafosDe(arquivo.slice(m.index! + m[0].length, i + 1 < titulos.length ? titulos[i + 1].index : arquivo.length)),
  }));
}

export function Licencas({ onBack }: { onBack(): void }): VNode {
  // null: lendo; false: o arquivo não veio.
  const [pecas, setPecas] = useState<Peca[] | false | null>(null);
  useEffect(() => {
    let aberta = true;
    fetch(ARQUIVO)
      .then((resposta) => (resposta.ok ? resposta.text() : Promise.reject(new Error(`HTTP ${resposta.status}`))))
      .then(
        (lido) => aberta && setPecas(pecasDe(lido)),
        () => aberta && setPecas(false),
      );
    return () => {
      aberta = false;
    };
  }, []);
  return (
    <>
      <BackBar title={TITULO} onBack={onBack} />
      <div class="body scroll licencas" role="region" aria-label={TITULO} tabIndex={0}>
        {pecas === false ? (
          <p class="empty" role="alert">
            Reinstale o Starsonic Phone.
          </p>
        ) : (
          pecas?.map((peca, i) => (
            <section key={i} class="licenca">
              {peca.titulo && <h2>{peca.titulo}</h2>}
              {peca.paragrafos.map((paragrafo, j) => (
                <p key={j}>
                  {paragrafo.map((linha, k) => (
                    <span key={k} class={linha.fixa ? 'licenca-linha licenca-fixa' : 'licenca-linha'}>
                      {linha.texto}
                    </span>
                  ))}
                </p>
              ))}
            </section>
          ))
        )}
      </div>
    </>
  );
}
