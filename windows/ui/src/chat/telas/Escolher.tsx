// A escolha de pessoas do Novo grupo e do Pôr pessoas (o quadro NovoGrupo): o cartão "Pessoas · N escolhidas", a busca
// (o nome sem acento e sem caixa, ou o ramal) e uma caixa de marcar por pessoa, com as iniciais, o nome e o ramal (a
// linha inteira marca). As escolhidas continuam escolhidas fora da busca. No limite (o grupo tem até 200 pessoas), as
// outras caixas ficam desligadas e aparece "O grupo já tem 200 pessoas." (um `status`). O useEscolha guarda as
// escolhidas da tela. Os nomes vão sempre como texto.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { IconCheck, IconSearch } from '../../icons';
import { Avatar } from '../componentes/Avatar';
import { pessoasDaBusca } from '../formato';
import {
  NINGUEM_ENCONTRADO,
  nomeDaPessoa,
  O_GRUPO_JA_TEM_200,
  pessoasEscolhidas,
  PROCURAR_PELO_NOME_OU_PELO_RAMAL,
  PROCURAR_UMA_PESSOA,
  ramalN,
} from '../textos';
import type { Pessoa } from '../tipos';

/** Um grupo tem até 200 pessoas, com quem cuida (docs/chat-protocolo.md, seção 8). */
export const MAX_DO_GRUPO = 200;
const ID_DO_TITULO = 'escolher-titulo';

/**
 * As escolhidas de uma tela, no máximo `max`, entre as `pessoas` (uma que sai da lista sai das escolhidas). `naOrdem`:
 * os ids delas na ordem da lista.
 */
export function useEscolha(
  pessoas: Pessoa[] | null,
  max: number,
): { escolhidas: ReadonlySet<number>; marcar(pessoa: number, marcada: boolean): void; naOrdem: number[] } {
  const [escolhidas, setEscolhidas] = useState<ReadonlySet<number>>(() => new Set());
  useEffect(() => {
    if (!pessoas) return;
    setEscolhidas((atual) => {
      const ficam = new Set([...atual].filter((id) => pessoas.some((p) => p.id === id)));
      return ficam.size === atual.size ? atual : ficam;
    });
  }, [pessoas]);
  // Sempre sobre as escolhidas de agora: muitos cliques antes de um desenho contam todos, e nenhum passa do máximo.
  const marcar = useCallback(
    (pessoa: number, marcada: boolean) =>
      setEscolhidas((atual) => {
        if (marcada === atual.has(pessoa) || (marcada && atual.size >= max)) return atual;
        const nova = new Set(atual);
        if (marcada) nova.add(pessoa);
        else nova.delete(pessoa);
        return nova;
      }),
    [max],
  );
  const naOrdem = (pessoas ?? []).filter((p) => escolhidas.has(p.id)).map((p) => p.id);
  return { escolhidas, marcar, naOrdem };
}

interface Props {
  /** As pessoas que dá para escolher, na ordem da lista; null antes de elas chegarem. */
  pessoas: Pessoa[] | null;
  escolhidas: ReadonlySet<number>;
  /** Quantas dá para escolher: no limite, "O grupo já tem 200 pessoas.". */
  max: number;
  /** O texto da lista sem ninguém para escolher. */
  vazia: string;
  onMarcar(pessoa: number, marcada: boolean): void;
  /** O foco vai à busca quando a tela abre. */
  focarBusca?: boolean;
}

export function Escolher({ pessoas, escolhidas, max, vazia, onMarcar, focarBusca }: Props) {
  const [busca, setBusca] = useState('');
  const campo = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (focarBusca) campo.current?.focus();
  }, []);
  const cheio = escolhidas.size >= max;
  const achadas = pessoas === null ? [] : pessoasDaBusca(pessoas, busca);

  return (
    <div class="escolher">
      <h2 id={ID_DO_TITULO} class="chat-subtitulo">
        {pessoasEscolhidas(escolhidas.size)}
      </h2>
      <label class="chat-busca">
        <IconSearch size="sm" />
        <input
          ref={campo}
          type="search"
          aria-label={PROCURAR_UMA_PESSOA}
          placeholder={PROCURAR_PELO_NOME_OU_PELO_RAMAL}
          autocomplete="off"
          spellcheck={false}
          value={busca}
          onInput={(e) => setBusca(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && busca) {
              e.stopPropagation();
              setBusca('');
            }
          }}
        />
      </label>
      {/* Sempre na página, para o leitor de tela dizer o texto quando ele aparece. */}
      <p class="escolher-cheio" role="status">
        {cheio ? O_GRUPO_JA_TEM_200 : ''}
      </p>
      {pessoas !== null &&
        (achadas.length === 0 ? (
          <p class="empty">{pessoas.length === 0 ? vazia : NINGUEM_ENCONTRADO}</p>
        ) : (
          <ul class="chat-pessoas escolher-lista" aria-labelledby={ID_DO_TITULO}>
            {achadas.map((p) => {
              const marcada = escolhidas.has(p.id);
              return (
                <li key={p.id}>
                  <label class="chat-pessoa escolher-pessoa">
                    <Avatar pessoa={p} />
                    <span class="chat-pessoa-textos">
                      <span class="chat-pessoa-nome">{nomeDaPessoa(p)}</span>
                      <span class="chat-pessoa-sub">{ramalN(p.ramal)}</span>
                    </span>
                    <input
                      type="checkbox"
                      class="escolher-marca"
                      checked={marcada}
                      disabled={!marcada && cheio}
                      onChange={(e) => onMarcar(p.id, e.currentTarget.checked)}
                    />
                    <span class="escolher-caixa" aria-hidden="true">
                      <IconCheck size="sm" />
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        ))}
    </div>
  );
}
