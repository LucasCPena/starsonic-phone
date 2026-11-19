// O estado do ramal que o app conta ao chat (a spec do estado dos ramais, seções 4.3 e 7.3; docs/chat-protocolo.md,
// seção 5, "Dizer o estado do ramal"). Com ele, a página de administração do chat mostra se o ramal de cada pessoa está
// registrado na central. Esta peça decide quando mandar e o que mandar: ela recebe a conta em uso, com o estado dela, e
// sabe quando o canal dos eventos do chat abriu. Ela não conhece a tela nem a ponte com o C++, e nada do que faz
// aparece para a pessoa.
//
// O tempo vai junto: há quantos segundos o ramal está registrado, ou sem registrar. Quem conta é o app, e não o chat
// (um ramal que fica tentando registrar nunca mudaria de "há pouco", e um reinício do chat zeraria tudo). A conta é
// feita com um relógio que não anda para trás.
//
// As falhas: o chat que ainda não tem a operação (404), ou que recusa o pedido de um jeito que outra tentativa não muda
// (400, 401, 409 `pessoa`), faz a peça parar até a próxima abertura do canal. O limite (429) espera o que o chat pede.
// O resto (o 409 `semLigacao`, um 5xx, a rede, o prazo) tenta de novo, com as esperas que o chat do app já usa. Toda
// tentativa leva o valor e os segundos daquela hora.
import type { AccountStatus } from '../state';
import { ErroChat } from './api';
import { esperaDaVez, esperaDoLimite } from './eventos';

/** O estado do ramal como o protocolo o leva. */
export type EstadoDoRamal = 'conectado' | 'conectando' | 'erro' | 'semConexao';

/** `conectado`, `conectando` e `erro` vão como estão; `sem_conexao` vira `semConexao`. */
export function estadoDoRamal(status: AccountStatus): EstadoDoRamal {
  return status === 'sem_conexao' ? 'semConexao' : status;
}

/** Uma mudança espera isto antes de ir, e só a última vai. */
export const ESPERA_DA_MUDANCA_MS = 2000;
/** O maior `segundos` que o protocolo aceita (um ano). */
export const MAX_SEGUNDOS = 31_536_000;

/** A conta em uso, para o estado do ramal. */
export interface ContaDoRamal {
  id: string;
  ramal: string;
  estado: AccountStatus;
}

export interface AvisoDoRamal {
  /** A conta em uso, ou o estado dela, mudou (null: sem conta em uso). */
  conta(c: ContaDoRamal | null): void;
  /** O canal dos eventos abriu (a primeira vez e cada volta), como a pessoa do `ramal`. O `mandar` é o pedido dessa sessão. */
  canalAbriu(ramal: string, mandar: (estado: EstadoDoRamal, segundos: number) => Promise<void>): void;
  /** O canal caiu, ou a sessão do chat parou: nada vai até o próximo `canalAbriu`. */
  canalFechou(): void;
}

/** O ramal está registrado na central (um lado), ou sem registrar (o outro: conectando, com erro ou sem conexão). */
const registrado = (c: ContaDoRamal): boolean => c.estado === 'conectado';

/** O que o chat ouve: de qual conta é o ramal, e o estado dele. */
interface Valor {
  conta: string;
  estado: EstadoDoRamal;
}

const mesmoValor = (a: Valor | null, b: Valor | null): boolean => a === b || (a !== null && b !== null && a.conta === b.conta && a.estado === b.estado);

/** O canal aberto: a pessoa da sessão (o ramal dela) e o pedido dessa sessão. */
interface Canal {
  ramal: string;
  mandar(estado: EstadoDoRamal, segundos: number): Promise<void>;
}

/** `agora` é um relógio em milissegundos que não anda para trás. */
export function criarAvisoDoRamal(o: { agora(): number; aleatorio(): number }): AvisoDoRamal {
  let conta: ContaDoRamal | null = null;
  /**
   * O instante da última passagem entre "registrado" e "sem registrar". Começa quando o app abre, e muda também quando
   * a conta em uso passa a ser outra. Uma troca entre "conectando", "erro" e "sem conexão" não mexe nele.
   */
  let desde = o.agora();
  /** O canal aberto; null sem ele. */
  let canal: Canal | null = null;
  /** O último valor que o chat confirmou nesta abertura do canal; null antes do primeiro. */
  let confirmado: Valor | null = null;
  /** A espera de uma mudança: ela só vai depois de 2 s sem outra. */
  let espera: ReturnType<typeof setTimeout> | undefined;
  /**
   * Um pedido está no ar: o próximo espera a resposta dele. Vale também de uma abertura do canal para a seguinte: dois
   * pedidos nunca andam juntos, e o mais velho não chega por último ao chat.
   */
  let noAr = false;
  /** O chat não aceita o pedido, e outra tentativa não muda isso: nada vai até a próxima abertura do canal. */
  let parado = false;
  /** A espera antes de tentar de novo, depois de uma falha: enquanto ela corre, nada vai. */
  let deNovo: ReturnType<typeof setTimeout> | undefined;
  /** Quantas falhas seguidas (a espera cresce com elas); volta a zero num 204 e numa abertura do canal. */
  let tentativa = 0;

  /** Os segundos desde o instante, para baixo, dentro do que o protocolo aceita. */
  const segundos = (): number => Math.min(MAX_SEGUNDOS, Math.max(0, Math.floor((o.agora() - desde) / 1000)));

  /** O valor de agora: o da conta em uso, se o canal está aberto como a pessoa dela; senão, null. */
  const valorDeAgora = (): Valor | null =>
    canal && conta && conta.ramal === canal.ramal ? { conta: conta.id, estado: estadoDoRamal(conta.estado) } : null;

  const pararAEspera = (): void => {
    clearTimeout(espera);
    espera = undefined;
  };

  const pararDeTentar = (): void => {
    clearTimeout(deNovo);
    deNovo = undefined;
  };

  /** Depois de uma falha: outra tentativa em `ms`, com o valor daquela hora. */
  const tentarEm = (ms: number): void => {
    pararDeTentar();
    deNovo = setTimeout(() => {
      deNovo = undefined;
      mandar();
    }, ms);
  };

  /** A resposta que outra tentativa pode mudar: a ligação que o chat ainda não vê, um erro dele, a rede, o prazo. */
  const passageira = (e: unknown): boolean =>
    e instanceof ErroChat && (e.status === 0 || e.status >= 500 || (e.status === 409 && e.erro === 'semLigacao'));

  /** Manda o valor de agora, se há o que dizer: só o que o chat ainda não confirmou, e um pedido de cada vez. */
  const mandar = (): void => {
    const sessao = canal;
    const valor = valorDeAgora();
    if (!sessao || !valor || parado || noAr || deNovo !== undefined || mesmoValor(valor, confirmado)) return;
    noAr = true;
    sessao.mandar(valor.estado, segundos()).then(
      () => {
        noAr = false;
        tentativa = 0;
        // A resposta de um canal que já fechou não diz o que o canal de agora sabe.
        if (canal === sessao) confirmado = valor;
        // O valor pode ter mudado com o pedido no ar. Com a espera dessa mudança ainda correndo, ela manda no fim.
        if (espera === undefined) mandar();
      },
      (e: unknown) => {
        // Uma falha não aparece para a pessoa.
        noAr = false;
        if (canal !== sessao) {
          // O canal é outro: o estado de agora ainda não foi dito nele, e a falha do canal antigo não conta.
          mandar();
          return;
        }
        // O limite: a espera que o chat pede. Um 429 sem ela (o de um proxy no caminho) espera como uma falha comum.
        const limite = e instanceof ErroChat && e.status === 429 ? esperaDoLimite(e) : 0;
        if (limite > 0) tentarEm(limite);
        else if (passageira(e) || (e instanceof ErroChat && e.status === 429)) tentarEm(esperaDaVez(tentativa++, o.aleatorio()));
        // O chat é antigo e não tem a operação (404), ou recusa o pedido (400, 401, 409 `pessoa`): outra tentativa
        // daria no mesmo. Para até o canal abrir de novo (o 401 já tira o computador do chat por outro caminho).
        else parado = true;
      },
    );
  };

  return {
    conta(c) {
      const antes = conta;
      const valorDeAntes = valorDeAgora();
      conta = c;
      if (c && (!antes || antes.id !== c.id || registrado(antes) !== registrado(c))) desde = o.agora();
      // Com o canal aberto, uma mudança da conta ou do estado dela espera 2 s, e outra mudança recomeça a espera: um
      // ramal que pisca manda só o último valor.
      if (canal && !mesmoValor(valorDeAntes, valorDeAgora())) {
        pararAEspera();
        espera = setTimeout(() => {
          espera = undefined;
          mandar();
        }, ESPERA_DA_MUDANCA_MS);
      }
    },
    canalAbriu(ramal, pedido) {
      canal = { ramal, mandar: pedido };
      confirmado = null;
      parado = false;
      tentativa = 0;
      // A abertura já diz o valor de agora: a espera que estava correndo, e a tentativa marcada, não têm mais o que mandar.
      pararAEspera();
      pararDeTentar();
      mandar();
    },
    canalFechou() {
      canal = null;
      confirmado = null;
      pararAEspera();
      pararDeTentar();
    },
  };
}
