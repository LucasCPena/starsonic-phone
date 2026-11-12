// (0.4.0) A sala de vídeo na ponte falsa: o C++ de mentira faz o papel do núcleo na sala, no que a tela vê
// (docs/ponte-windows.md, "A sala de vídeo (0.4.0)"). O `handleCall` do fake.ts passa cada comando antes por aqui: os
// quatro da sala e os de sempre com a sala de pé; o `setCall` acerta o `fora` e o `cheia` de cada ligação com sala (o
// `acertarSala`). O outro lado de um convidado: o `180` só toca; o `486` dá ocupado em 1,5 s (o convidado sai, com o
// motivo); os outros atendem em 1,5 s e entram na sala com a imagem. O que fica sozinho ainda chamando responde do mesmo
// jeito, como uma feita. A ligação de fora feita com a sala de pé é a Nova ligação do fake.ts, só com a voz. No iPhone,
// os quatro comandos não fazem nada, e nenhuma sala fica de pé.
import { trimAscii } from './format';
import { isIos } from './plataforma';
import { foraDaSala, nomeNaSala, podeAdicionar, salaEmbaixo, salaEmCima } from './sala/estado';
import { arrumacao } from './sala/mosaico';
import { SEM_VIDEO } from './video/estado';
import type { AppState, CallCard, CallState, ParticipanteDaSala, RingKind, SalaDaLigacao } from './state';

export interface DependenciasDaSalaFalsa {
  estado(): AppState;
  /** O setCall do fake.ts. */
  mudarLigacao(l: CallState | null): void;
  toast(texto: string): void;
  /** O ring do fake.ts (nenhum toque no iPhone). */
  toque(tipo: RingKind): void;
  /** O ++proximoId do fake.ts: o id da sala e o de cada convidado. */
  novoId(): number;
  /** A Nova ligação do fake.ts (o ligarDeNovo): a de agora vai para a espera, e a nova chama, só com a voz. */
  novaLigacao(l: CallState, numero: string): void;
}

/** O número que só toca, nas ligações feitas da ponte falsa (a Nova ligação, o Consultar e os convidados da sala). */
export const SO_TOCA = '180';
const OCUPADO = '486';
/** O outro lado de uma ligação feita da ponte falsa atende (ou dá ocupado) depois disto. */
export const RESPONDE_EM_MS = 1_500;
/** Até 5 convidados, contando os chamados: com eles, a sala está cheia. */
const MAXIMO_DE_CONVIDADOS = 5;

/** O `fora` (a linha da sala embaixo, ou em cima com o held) e o `cheia` (5 convidados) de acordo com a ligação. */
export function acertarSala(l: CallState): CallState {
  if (!l.sala) return l;
  return { ...l, sala: { ...l.sala, fora: foraDaSala(l, l.sala), cheia: l.sala.participantes.length >= MAXIMO_DE_CONVIDADOS } };
}

/** A sala de pé: a ligação, a sala e a linha dela, em cima ou embaixo. */
interface SalaDePe {
  l: CallState;
  sala: SalaDaLigacao;
  linha: CallCard;
  emCima: boolean;
}

/** Cada convidado no quadro dele da arrumação do núcleo para todos (também os chamados). */
function arrumados(participantes: Array<Omit<ParticipanteDaSala, 'quadro'>>): ParticipanteDaSala[] {
  const quadros = arrumacao(participantes.length);
  return participantes.map((p, i) => ({ ...p, quadro: quadros[i] }));
}

/** O nome do contato com o número, ou "". */
function nomeDoContato(state: AppState, numero: string): string {
  return state.contatos.find((c) => c.numero === numero)?.nome ?? '';
}

/** A ligação de fora atendida agora, só com a voz (com a sala de pé, o núcleo não liga o vídeo dela). */
function atendidaSoComAVoz(card: CallCard): CallCard {
  return {
    ...card,
    phase: 'active',
    activeSinceMs: Date.now(),
    held: false,
    video: { ...SEM_VIDEO, oferece: card.video?.oferece ?? false, porteiro: card.video?.porteiro ?? false },
  };
}

/**
 * Os comandos da sala e os de sempre com a sala de pé (o hangup, o answer, o swap e o hold, e também o transfer, o dial,
 * o consult, o dtmf, o join, o split e o camera, que o núcleo recusa ou muda com a sala); true quando tratou.
 */
export function criarSalaFalsa(d: DependenciasDaSalaFalsa): { comando(command: Record<string, unknown>): boolean } {
  /** Quando cada convidado chamado daqui atendeu: o tempo dele, se a sala acaba com ele. */
  const atendidos = new Map<number, number>();

  /** A sala de agora com a linha dela, ou `null`: sem ligação, sem sala ou no iPhone. */
  const deAgora = (): SalaDePe | null => {
    const state = d.estado();
    const l = state.ligacao;
    if (!l?.sala || isIos(state)) return null;
    const emCima = salaEmCima(l, l.sala);
    const linha = emCima ? l.top : salaEmbaixo(l, l.sala) ? l.second : null;
    return linha ? { l, sala: l.sala, linha, emCima } : null;
  };

  /** A ligação de fora: a de baixo com a sala em cima, ou a de cima com ela embaixo. */
  const deForaDe = ({ l, emCima }: SalaDePe): CallCard | null => (emCima ? l.second : l.top);

  /** A sala troca de lugar com a ligação de fora (o Alternar): a de cima vai para a espera e a outra volta. */
  const trocar = (l: CallState) => {
    if (l.second) d.mudarLigacao({ ...l, top: { ...l.second, held: false }, second: { ...l.top, held: true }, secondKind: 'held' });
  };

  /** O fim da ligação de fora: a sala volta sozinha, em cima e fora da espera; a que tocava leva o toque junto. */
  const fimDaDeFora = ({ l, linha }: SalaDePe, deFora: CallCard) => {
    d.mudarLigacao({ ...l, top: { ...linha, held: false }, second: null, secondKind: 'none' });
    if (deFora.phase === 'ringing') d.toque('parar');
  };

  /**
   * Só a outra ligação fica (`null`: nenhuma): sozinha em cima, fora da espera e sem a sala, e a que ainda toca passa ao
   * toque completo. Sem ela, nenhuma ligação.
   */
  const ficaSo = (l: CallState, outra: CallCard | null) => {
    if (!outra) {
      d.mudarLigacao(null);
      return;
    }
    d.mudarLigacao({ ...l, top: { ...outra, held: false }, second: null, secondKind: 'none', sala: null });
    if (outra.phase === 'ringing') d.toque('completo');
  };

  /** O fim da sala (o Encerrar, o Desligar dela, ou ninguém nela): a ligação de fora, se há, fica sozinha. */
  const acabarSala = (sp: SalaDePe) => ficaSo(sp.l, deForaDe(sp));

  /**
   * Com um convidado só (contando os chamados), a sala acaba: ele volta a ser a ligação, no lugar da linha da sala (em
   * cima, ou em espera embaixo), com o id, o número, o nome e a imagem dele e a câmera da sala, em qualquer estado (o
   * desejo da câmera da sala passa a ele). O que já atendeu volta com o vídeo ativo, também o que pôs você em espera (a
   * espera do outro lado não pausa o vídeo aqui); o que ainda era chamado volta como uma feita que chama, ainda sem o
   * vídeo (ele só vem com o atender). Em espera embaixo, o vídeo fica sem a pausa, como o de toda ligação em espera da
   * ponte falsa (quem pausa é a tela).
   */
  const comQuemFicou = ({ l, linha, emCima }: SalaDePe, p: ParticipanteDaSala): CallState => {
    const atendeu = p.estado !== 'chamando';
    const ligacao: CallCard = {
      id: p.id,
      number: p.numero,
      name: p.nome,
      incoming: false,
      phase: atendeu ? 'active' : 'dialing',
      activeSinceMs: atendeu ? (atendidos.get(p.id) ?? linha.activeSinceMs) : 0,
      held: linha.held,
      video: { ...SEM_VIDEO, ativo: atendeu, imagem: p.imagem, camera: linha.video?.camera ?? false },
    };
    return emCima ? { ...l, top: ligacao, sala: null } : { ...l, second: ligacao, sala: null };
  };

  /** O convidado sai: os outros vão para a arrumação nova, e com um só a sala acaba. */
  const sair = (sp: SalaDePe, id: number) => {
    const ficam = sp.sala.participantes.filter((p) => p.id !== id);
    if (ficam.length >= 2) d.mudarLigacao({ ...sp.l, sala: { ...sp.sala, participantes: arrumados(ficam) } });
    else if (ficam.length === 1) d.mudarLigacao(comQuemFicou(sp, ficam[0]));
    else acabarSala(sp);
  };

  /**
   * O outro lado do convidado chamado responde: atende (na sala, com a imagem) ou dá ocupado (sai, com o motivo). Se a
   * sala acabou com ele ainda chamando, ele já é a ligação (em cima, ou em espera embaixo) e responde como uma feita:
   * atende com o vídeo, ou acaba com o `Ocupado` de uma feita que não completou (sem o nome, que só o convidado e o colega
   * da consulta levam). Tirado, ou já desligado, nada.
   */
  const responder = (id: number, ocupado: boolean) => {
    const sp = deAgora();
    const p = sp?.sala.participantes.find((x) => x.id === id && x.estado === 'chamando');
    if (sp && p) {
      if (ocupado) {
        sair(sp, id);
        d.toast(`${nomeNaSala(p)}: Ocupado`);
        return;
      }
      atendidos.set(id, Date.now());
      const participantes = sp.sala.participantes.map((x): ParticipanteDaSala => (x.id === id ? { ...x, estado: 'naSala', imagem: true } : x));
      d.mudarLigacao({ ...sp.l, sala: { ...sp.sala, participantes } });
      return;
    }
    const l = d.estado().ligacao;
    const sozinho = l && [l.top, l.second].find((c) => c?.id === id && c.phase === 'dialing');
    if (!l || !sozinho) return;
    if (ocupado) {
      ficaSo(l, l.top.id === id ? l.second : l.top);
      d.toast('Ocupado');
      return;
    }
    const atendido: CallCard = {
      ...sozinho,
      phase: 'active',
      activeSinceMs: Date.now(),
      video: { ...(sozinho.video ?? SEM_VIDEO), ativo: true, imagem: true },
    };
    d.mudarLigacao(l.top.id === id ? { ...l, top: atendido } : { ...l, second: atendido });
  };

  /**
   * O Adicionar à sala, nas regras do Adicionar pessoa. Sem sala, ela nasce no lugar da ligação de cima, com o tempo dela,
   * e a ligação entra como o primeiro convidado. O convidado novo entra chamando, sem imagem.
   */
  const adicionar = (command: Record<string, unknown>) => {
    const state = d.estado();
    const l = state.ligacao;
    const numero = trimAscii(String(command.numero ?? ''));
    if (!l || numero === '' || !podeAdicionar(state, l)) return;
    const chamado = (id: number): Omit<ParticipanteDaSala, 'quadro'> => ({ id, numero, nome: nomeDoContato(state, numero), estado: 'chamando', imagem: false });
    let convidado: Omit<ParticipanteDaSala, 'quadro'>;
    if (l.sala) {
      convidado = chamado(d.novoId());
      d.mudarLigacao({ ...l, sala: { ...l.sala, participantes: arrumados([...l.sala.participantes, convidado]) } });
    } else {
      const id = d.novoId();
      convidado = chamado(d.novoId());
      const daLigacao: Omit<ParticipanteDaSala, 'quadro'> = {
        id: l.top.id,
        numero: l.top.number,
        nome: l.top.name,
        estado: 'naSala',
        imagem: l.top.video?.imagem ?? false,
      };
      const linha: CallCard = {
        id,
        number: '',
        name: '',
        incoming: false,
        phase: 'active',
        activeSinceMs: l.top.activeSinceMs,
        held: l.top.held,
        // O vídeo da sala: o mosaico chegando ao `remoto` e a nossa câmera, a da ligação, chegando aos convidados.
        video: { ...SEM_VIDEO, ativo: true, imagem: true, camera: l.top.video?.camera ?? false },
      };
      d.mudarLigacao({ ...l, top: linha, sala: { id, fora: false, cheia: false, participantes: arrumados([daLigacao, convidado]) } });
    }
    if (numero === SO_TOCA) return;
    const id = convidado.id;
    setTimeout(() => responder(id, numero === OCUPADO), RESPONDE_EM_MS);
  };

  /**
   * O Voltar para a sala: a ligação de fora atendida vai para a espera e a sala volta para cima; a que você fez e ainda
   * chama não vai para a espera, é desligada (sem aviso), e a sala volta sozinha. Já na sala, nada.
   */
  const voltar = (sp: SalaDePe) => {
    const { l, linha, emCima } = sp;
    if (emCima) {
      // Em cima ainda em espera (a de fora acabando): ela sai da espera.
      if (linha.held) d.mudarLigacao({ ...l, top: { ...linha, held: false } });
      return;
    }
    if (!l.top.incoming && l.top.phase === 'dialing') fimDaDeFora(sp, l.top);
    else trocar(l);
  };

  /** Os comandos de sempre com a sala de pé (os outros seguem para o fake.ts). */
  const deSempre = (sp: SalaDePe, command: Record<string, unknown>): boolean => {
    const { l, sala, emCima } = sp;
    const deFora = deForaDe(sp);
    switch (command.cmd) {
      case 'answer':
        // A ligação de fora que toca: só com a voz (também com o `video: true`), e a sala vai para a espera.
        if (emCima && l.second && l.secondKind === 'ringing') {
          d.mudarLigacao({ ...l, top: atendidaSoComAVoz(l.second), second: { ...l.top, held: true }, secondKind: 'held' });
          d.toque('parar');
        }
        return true;
      case 'hangup': {
        // Sem id, a de cima. O da sala é o Encerrar; o de um convidado não é uma linha (o Tirar da sala é o salaTirar).
        const id = typeof command.id === 'number' ? command.id : l.top.id;
        if (id === sala.id) acabarSala(sp);
        else if (deFora && id === deFora.id) fimDaDeFora(sp, deFora);
        return true;
      }
      case 'swap':
        // O Alternar, só com as duas atendidas (não com a de fora tocando ou chamando).
        if (l.second && l.secondKind === 'held' && l.top.phase === 'active' && l.second.phase === 'active') trocar(l);
        return true;
      case 'hold':
        // A sala em cima não vai para a espera; a espera da de fora atendida, com a sala embaixo, é o Alternar.
        if (!emCima && l.top.phase === 'active' && command.on !== false) trocar(l);
        return true;
      case 'transfer':
        // A da de fora atendida: a central aceita, e só ela acaba. Com a sala em cima, nada.
        if (!emCima && l.top.phase === 'active') fimDaDeFora(sp, l.top);
        return true;
      case 'dial': {
        // A ligação de fora é a Nova ligação de sempre (a sala vai para a espera), só com a sala sozinha em cima: uma
        // ligação de fora por vez.
        const numero = trimAscii(String(command.numero ?? ''));
        if (emCima && !l.second && numero !== '') d.novaLigacao(l, numero);
        return true;
      }
      case 'camera':
        // Com a sala de pé, a câmera é a da sala: com a ligação de fora em cima, o motor recusa o `camera` (o SetCamera
        // de outro id); com a sala em cima, o de sempre liga ou desliga a câmera dela.
        return !emCima;
      case 'consult':
      case 'dtmf':
        // Com a sala em cima, nada (os dígitos não têm para quem ir); com a de fora em cima, os de sempre.
        return emCima;
      case 'join':
      case 'split':
      case 'completeTransfer':
      case 'cancelConsult':
        // Com a sala de pé, nem conferência nem consulta.
        return true;
      default:
        return false;
    }
  };

  return {
    comando(command) {
      switch (command.cmd) {
        case 'salaAdicionar':
          adicionar(command);
          return true;
        case 'salaTirar': {
          const sp = deAgora();
          const id = command.id;
          if (sp && typeof id === 'number' && sp.sala.participantes.some((p) => p.id === id)) sair(sp, id);
          return true;
        }
        case 'salaEncerrar': {
          const sp = deAgora();
          if (sp) acabarSala(sp);
          return true;
        }
        case 'salaVoltar': {
          const sp = deAgora();
          if (sp) voltar(sp);
          return true;
        }
        default: {
          const sp = deAgora();
          return sp !== null && deSempre(sp, command);
        }
      }
    },
  };
}
