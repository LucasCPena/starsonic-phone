// O estado do ramal que o app conta ao chat (a spec do estado dos ramais, seções 4.3 e 7.3; docs/chat-protocolo.md,
// seção 5, "Dizer o estado do ramal"). Com ele, a página de administração do chat mostra se o ramal de cada pessoa está
// registrado na central. Esta peça decide quando mandar e o que mandar: ela recebe a conta em uso, com o estado dela, e
// sabe quando o canal dos eventos do chat abriu. Ela não conhece a tela nem a ponte com o C++, e nada do que faz
// aparece para a pessoa.
//
// O tempo vai junto: há quantos segundos o ramal está registrado, ou sem registrar. Quem conta é o app, e não o chat
// (um ramal que fica tentando registrar nunca mudaria de "há pouco", e um reinício do chat zeraria tudo). A conta é
// feita com um relógio que não anda para trás.
import type { AccountStatus } from '../state';

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

/** `agora` é um relógio em milissegundos que não anda para trás. */
export function criarAvisoDoRamal(o: { agora(): number; aleatorio(): number }): AvisoDoRamal {
  let conta: ContaDoRamal | null = null;
  /**
   * O instante da última passagem entre "registrado" e "sem registrar". Começa quando o app abre, e muda também quando
   * a conta em uso passa a ser outra. Uma troca entre "conectando", "erro" e "sem conexão" não mexe nele.
   */
  let desde = o.agora();
  /** O canal aberto: a pessoa da sessão (o ramal dela) e o pedido; null sem ele. */
  let canal: { ramal: string; mandar(estado: EstadoDoRamal, segundos: number): Promise<void> } | null = null;

  /** Os segundos desde o instante, para baixo, dentro do que o protocolo aceita. */
  const segundos = (): number => Math.min(MAX_SEGUNDOS, Math.max(0, Math.floor((o.agora() - desde) / 1000)));

  /** Manda o estado de agora, se o canal está aberto como a pessoa da conta em uso. */
  const mandar = (): void => {
    if (!canal || !conta || conta.ramal !== canal.ramal) return;
    // Uma falha não aparece para a pessoa.
    canal.mandar(estadoDoRamal(conta.estado), segundos()).catch(() => {});
  };

  return {
    conta(c) {
      const antes = conta;
      conta = c;
      if (c && (!antes || antes.id !== c.id || registrado(antes) !== registrado(c))) desde = o.agora();
    },
    canalAbriu(ramal, pedido) {
      canal = { ramal, mandar: pedido };
      mandar();
    },
    canalFechou() {
      canal = null;
    },
  };
}
