// (rc.6, Windows) O painel de número pelo nome ou pelo número, que saiu do Ligacao.tsx sem mudar para a sala de vídeo
// (0.4.0) usar também: o PainelProps (o que os dois painéis de número, o do iPhone e o do Windows, recebem) e o
// PainelPorNome, com a lista dos contatos em pedaços, os ids das linhas e o linhaDoPainel. (0.4.0) Para o painel de
// adicionar (sala/PainelDeAdicionar.tsx): o Enter leva o `doContato`, como os botões, e o painel pode ter uma ajuda.
import type { ComponentChildren, VNode } from 'preact';
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { initials } from '../format';
import { buscaPor, buscar, nomeOuNumero, temLetras, type Linha } from '../lista-de-contatos';
import { semSegundoClique } from '../plataforma';
import { NoWindows } from './controlesDaLigacao';

/**
 * O que os dois painéis de número (o do iPhone e o do Windows) recebem do Transferir e da Nova ligação; (0.4.0) o do
 * Windows, também do Adicionar pessoa.
 */
export interface PainelProps {
  titulo: string;
  rotulo: string;
  onCancel(): void;
  /** Um contato escolhido, com o número dele (null: ele só preenche o número; no Windows, o painel mostra quem recebe). */
  onContact: ((numero: string) => void) | null;
  /**
   * Os botões do painel, com o número a mandar ("" sem nenhum: no Windows, um nome sem um contato escolhido não é número)
   * e `doContato`: ele é o de um contato escolhido, sem mudança depois (vai com o `contato`).
   */
  actions(numero: string, doContato: boolean): ComponentChildren;
  /** O Enter no campo sem uma linha marcada, com o número a mandar e o `doContato`, como nos botões (null: nada). */
  onEnter: ((numero: string, doContato: boolean) => void) | null;
  /** (0.4.0) Uma ajuda depois de quem recebe (o painel de adicionar: o que acontece com quem é adicionado). */
  ajuda?: string;
}

/** A lista do painel do Windows e o título que dá o nome a ela (um painel por vez). */
const LISTA_DO_PAINEL = 'painel-contatos';
const TITULO_DO_PAINEL = 'painel-titulo';
/** (0.4.0) A ajuda do painel, que descreve o campo. */
const AJUDA_DO_PAINEL = 'painel-ajuda';
const NENHUM_CONTATO = 'Nenhum contato com esse nome';
/**
 * A lista do painel vai em pedaços: as PRIMEIRO_PEDACO primeiras linhas logo, e mais um pedaço de PEDACO por tarefa,
 * cada um depois do desenho do anterior (como a agenda grande do iPhone sem o content-visibility, no Agenda.tsx). Com a
 * lista da empresa de 10.000, montar todas as linhas de uma vez travava a tela da ligação perto de 1 s; assim, o painel
 * abre e a busca responde na hora, e a lista inteira chega logo depois. Cada pedaço é montado uma vez e reaproveitado (o
 * Preact pula o mesmo vnode): o desenho de um pedaço novo não passa de novo pelas linhas dos de antes. A busca olha a
 * lista inteira, e uma busca nova é outra lista na tela, do começo e do primeiro pedaço.
 */
const PRIMEIRO_PEDACO = 100;
const PEDACO = 200;

/** As linhas em pedaços: o primeiro com PRIMEIRO_PEDACO, os outros com PEDACO. */
function emPedacos(linhas: Linha[]): Linha[][] {
  const pedacos: Linha[][] = [];
  for (let i = 0, n = PRIMEIRO_PEDACO; i < linhas.length; i += n, n = PEDACO) pedacos.push(linhas.slice(i, i + n));
  return pedacos;
}

/** O pedaço da linha de índice `i`. */
function pedacoDa(i: number): number {
  return i < PRIMEIRO_PEDACO ? 0 : 1 + Math.floor((i - PRIMEIRO_PEDACO) / PEDACO);
}

/** O id de cada linha da lista na tela (o aria-activedescendant do campo aponta a marcada). */
const IDS_DAS_LINHAS = new WeakMap<Linha, string>();
let ultimoId = 0;
function idDaLinha(l: Linha): string {
  let id = IDS_DAS_LINHAS.get(l);
  if (!id) {
    id = `painel-contato-${++ultimoId}`;
    IDS_DAS_LINHAS.set(l, id);
  }
  return id;
}

/**
 * Uma linha da lista: as iniciais, o nome (ou o número, num contato sem nome) e embaixo "Contato · <número>" (um meu) ou
 * "Empresa · <número>" (um da lista da empresa). Sem estado: um vnode, não um componente (numa lista de 10.000).
 */
function linhaDoPainel(l: Linha, marcada: boolean, escolher: (l: Linha) => void): VNode {
  return (
    <div
      key={l.key}
      id={idDaLinha(l)}
      role="option"
      aria-selected={marcada}
      class="suggest call-suggest"
      onClick={() => escolher(l)}
    >
      <span class="avatar" aria-hidden="true">
        {initials(l.nome)}
      </span>
      <span class="row-main">
        <span class="row-title">{l.nome || l.numero}</span>
        <span class="row-sub">{`${l.meu ? 'Contato' : 'Empresa'} · ${l.numero}`}</span>
      </span>
    </div>
  );
}

/**
 * (rc.6, Windows) O Transferir (com o Consultar) e a Nova ligação pelo nome ou pelo número. O campo aceita letras; embaixo
 * dele, a lista dos meus contatos e dos da lista da empresa (`lista`): com o campo vazio, todos; digitando, os que batem
 * na busca de ligar (a do Teclado: com letras, só o nome; sem elas, os dígitos do número; nunca a observação). Ela fica
 * com o espaço que sobra e rola sozinha. É o padrão da lista com a opção marcada: as setas para baixo e para cima marcam
 * uma linha (o aria-activedescendant do campo), e o Enter nela ou o clique escolhem o contato. Na Nova ligação, o
 * escolhido liga (o `onContact`); no Transferir, o número dele vai para o campo e o painel mostra quem vai receber
 * ("Para: <nome> · <número>"), até o campo mudar. Letras sem um contato escolhido não são número: os botões ficam
 * desligados, e sem nenhum contato que bata aparece "Nenhum contato com esse nome". Só com números, como antes: o número
 * digitado, sem o `contato`. O Esc cancela. (0.4.0) O Adicionar pessoa é como o Transferir, com o Enter que adiciona (o
 * `onEnter`, com o `doContato` do escolhido) e a ajuda embaixo de quem entra.
 */
export function PainelPorNome({ titulo, rotulo, lista, onCancel, onContact, actions, onEnter, ajuda }: PainelProps & { lista: Linha[] }) {
  const noWindows = useContext(NoWindows);
  const [texto, setTexto] = useState('');
  // O contato escolhido (no Transferir e no Adicionar pessoa: na Nova ligação, ele liga), até o campo mudar.
  const [escolhido, setEscolhido] = useState<Linha | null>(null);
  // A linha marcada pelas setas (a chave dela: numa lista nova, a marca segue o contato).
  const [marcada, setMarcada] = useState<string | null>(null);
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => campo.current?.focus(), []);

  const achadas = useMemo(() => buscar(lista, buscaPor(texto, { paraLigar: true })), [lista, texto]);
  const comLetras = temLetras(texto);
  const mostrarLista = escolhido === null && achadas.length > 0;
  const nenhum = escolhido === null && comLetras && achadas.length === 0;
  const indice = mostrarLista && marcada !== null ? achadas.findIndex((l) => l.key === marcada) : -1;
  // O número que os botões mandam: o do escolhido; com letras sem escolha, nenhum; só números, o digitado.
  const numero = escolhido ? escolhido.numero : comLetras ? '' : texto;

  const escolher = (l: Linha) => {
    if (onContact) {
      onContact(l.numero);
      return;
    }
    setTexto(l.numero);
    setEscolhido(l);
    setMarcada(null);
    campo.current?.focus();
  };
  const escolherAgora = useRef(escolher);
  escolherAgora.current = escolher;

  // A lista na tela, em pedaços (PRIMEIRO_PEDACO). Umas achadas novas (outra busca, outra lista, também a volta ao campo
  // vazio) são outra lista na tela (a `vez`): do começo, e com o primeiro pedaço; os outros vêm um por tarefa. O pedaço da
  // linha marcada está sempre nela.
  const pedacos = useMemo(() => emPedacos(achadas), [achadas]);
  const vez = useRef({ de: achadas, n: 0 });
  if (vez.current.de !== achadas) vez.current = { de: achadas, n: vez.current.n + 1 };
  const [naTela, setNaTela] = useState({ vez: 0, quantos: 1 });
  const quantos = Math.max(naTela.vez === vez.current.n ? naTela.quantos : 1, indice >= 0 ? pedacoDa(indice) + 1 : 0);
  useEffect(() => {
    if (!mostrarLista || quantos >= pedacos.length) return;
    const desta = vez.current.n;
    const seguinte = setTimeout(() => setNaTela({ vez: desta, quantos: quantos + 1 }), 0);
    return () => clearTimeout(seguinte);
  }, [achadas, quantos, mostrarLista]);

  // A linha de cada contato e cada pedaço, montados uma vez (o clique chama o escolher de agora); o pedaço da marcada, de
  // novo a cada marca. A lista também: o relógio da ligação redesenha a tela a cada segundo, e ela fica como está.
  const prontas = useMemo(() => ({ linhas: new WeakMap<Linha, VNode>(), pedacos: new WeakMap<Linha[], VNode>() }), []);
  const listaNaTela = useMemo(() => {
    if (!mostrarLista) return null;
    const aoEscolher = (l: Linha) => escolherAgora.current(l);
    const linhaDe = (l: Linha): VNode => {
      if (l.key === marcada) return linhaDoPainel(l, true, aoEscolher);
      let pronta = prontas.linhas.get(l);
      if (!pronta) {
        pronta = linhaDoPainel(l, false, aoEscolher);
        prontas.linhas.set(l, pronta);
      }
      return pronta;
    };
    const comMarca = indice >= 0 ? pedacoDa(indice) : -1;
    // Cada pedaço numa caixa própria (sem papel para o leitor de tela: as linhas são da lista): o navegador põe e pinta
    // um pedaço novo sem passar de novo pelas linhas dos de antes.
    const pedacoDe = (p: Linha[], k: number): VNode => {
      const novo = () => (
        <div key={k} role="none" class="call-pedaco">
          {p.map(linhaDe)}
        </div>
      );
      if (k === comMarca) return novo();
      let pronto = prontas.pedacos.get(p);
      if (!pronto) {
        pronto = novo();
        prontas.pedacos.set(p, pronto);
      }
      return pronto;
    };
    return (
      <div key={vez.current.n} class="call-suggestions call-lista" id={LISTA_DO_PAINEL} role="listbox" aria-labelledby={TITULO_DO_PAINEL}>
        {pedacos.slice(0, quantos).map(pedacoDe)}
      </div>
    );
  }, [pedacos, quantos, marcada, mostrarLista]);

  // A marcada fica à vista na lista, já no desenho dela: também numa lista nova com ela (a planilha relida com o painel
  // aberto), que volta para o começo.
  useLayoutEffect(() => {
    if (indice >= 0) document.getElementById(idDaLinha(achadas[indice]))?.scrollIntoView({ block: 'nearest' });
  }, [marcada, achadas]);

  // O painel ocupa a parte do meio inteira (o call-panel-nome do app.css): o campo em cima, a lista com o espaço que sobra
  // (no de adicionar, a ajuda logo depois dela) e os botões embaixo, parados enquanto a busca muda e depois da escolha.
  return (
    <div class="call-panel call-panel-nome">
      <h2 class="call-panel-title" id={TITULO_DO_PAINEL}>
        {titulo}
      </h2>
      <input
        ref={campo}
        class="call-number"
        type="text"
        role="combobox"
        aria-label={rotulo}
        aria-autocomplete="list"
        aria-expanded={mostrarLista}
        aria-controls={mostrarLista ? LISTA_DO_PAINEL : undefined}
        aria-activedescendant={indice >= 0 ? idDaLinha(achadas[indice]) : undefined}
        aria-describedby={ajuda ? AJUDA_DO_PAINEL : undefined}
        placeholder="Digite o nome ou o número"
        autocomplete="off"
        spellcheck={false}
        value={texto}
        onInput={(e) => {
          const valor = nomeOuNumero(e.currentTarget.value);
          if (valor !== e.currentTarget.value) e.currentTarget.value = valor;
          setTexto(valor);
          setEscolhido(null);
          setMarcada(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (!mostrarLista) return;
            e.preventDefault();
            // Para baixo: a primeira, depois a seguinte, até a última. Para cima: a anterior, e da primeira, nenhuma.
            const nova = e.key === 'ArrowDown' ? Math.min(indice + 1, achadas.length - 1) : indice - 1;
            setMarcada(nova >= 0 ? achadas[nova].key : null);
          } else if (e.key === 'Enter') {
            if (indice >= 0) {
              e.preventDefault();
              escolher(achadas[indice]);
            } else if (onEnter && numero) {
              e.preventDefault();
              onEnter(numero, escolhido !== null);
            }
          }
        }}
      />
      {listaNaTela}
      {/* Quem vai receber (o escolhido) ou o nada achado, no lugar da lista; sem nenhum dos dois, só a região que o leitor
          de tela anuncia. */}
      <p class={escolhido ? 'call-para' : nenhum ? 'call-vazio' : 'sr-only'} role="status">
        {escolhido ? (
          <>
            <span>Para: </span>
            <b>{escolhido.nome || escolhido.numero}</b>
            {escolhido.nome && <span>{` · ${escolhido.numero}`}</span>}
          </>
        ) : nenhum ? (
          NENHUM_CONTATO
        ) : (
          ''
        )}
      </p>
      {ajuda && (
        <p class="call-ajuda" id={AJUDA_DO_PAINEL}>
          {ajuda}
        </p>
      )}
      <div class="call-panel-actions">{actions(numero, escolhido !== null)}</div>
      <button type="button" class="btn btn-ghost-dark" onClick={semSegundoClique(noWindows, onCancel)}>
        Cancelar
      </button>
    </div>
  );
}
