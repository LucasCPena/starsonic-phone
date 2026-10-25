// Os cenários da ponte falsa (?fake=<nome>): o estado que o "C++ de mentira" manda no `ready`.
// Os dados imitam as telas do canvas. As datas são relativas ao momento em que a página abre (Hoje, Ontem).
import type { AdminServer, AppState, CallCard, CallState, RingKind, Shortcut } from './state';

/** A tela em que a interface abre (só na ponte falsa; o app real sempre abre no Teclado). */
export type FakeView = 'teclado' | 'atalhos' | 'recentes' | 'contatos' | 'configuracoes' | 'sobre';

/** Os servidores do perfil embutido (a lista do administrador sem o admin.json). */
export const SERVIDORES_DO_PERFIL: AdminServer[] = [
  { endereco: 'starcloud-starsonic.com.br', porta: 5060 },
  { endereco: 'starcloud1-starsonic.com.br', porta: 35060 },
];

/** Os atalhos do canvas "Atalhos · aba nova" (o BLF ligado no administrador: livre, ocupado, tocando, desconectado). */
function atalhosDoCanvas(): Shortcut[] {
  return [
    { id: '5a1c0e9b2f3d4c67', nome: 'Recepção', numero: '2000', acao: 'ligar', blf: true, estado: 'livre' },
    { id: '0b2e7d4c1a9f3e58', nome: 'Financeiro', numero: '2010', acao: 'transferir', blf: true, estado: 'ocupado' },
    { id: '7c3d9e1f5b2a4d60', nome: 'Suporte', numero: '2007', acao: 'consulta', blf: true, estado: 'tocando' },
    { id: '3e8f0a6b9c1d2e47', nome: 'Comercial', numero: '2003', acao: 'ligar', blf: true, estado: 'desconectado' },
    { id: '9d4a2b7e6f0c1a35', nome: 'Fila de espera', numero: '*88', acao: 'teclas', blf: false, estado: null },
    { id: '6f1b8c3a0d5e7f92', nome: 'Celular plantão', numero: '11988887777', acao: 'ligar', blf: false, estado: null },
  ];
}

export interface Scenario {
  state: AppState;
  /** O toque atual, mandado depois do estado em cada `ready`. */
  ring?: RingKind;
  view?: FakeView;
}

const MINUTO = 60_000;
const SEGUNDO = 1_000;

/** ms desde 1970 de `diasAtras` dias atrás, às `hora`:`minuto` (hora local). */
function quando(diasAtras: number, hora: number, minuto: number): number {
  const d = new Date();
  d.setDate(d.getDate() - diasAtras);
  d.setHours(hora, minuto, 0, 0);
  return d.getTime();
}

function entrarVazio(): AppState['entrar'] {
  return { servidor: '', protocolo: 'udp', ramal: '', nome: '', erro: '', ocupado: false, pedeSenha: false, podeCancelar: false, contaId: '' };
}

function principal(): AppState {
  return {
    tela: 'principal',
    entrar: entrarVazio(),
    conta: {
      id: '9f3c2a71b0d84e55',
      nome: 'Recepção',
      ramal: '2001',
      servidor: 'starcloud1-starsonic.com.br',
      protocolo: 'udp',
      status: 'conectado',
      texto: 'Conectado · starcloud1-starsonic.com.br',
      internet: true,
    },
    contas: [
      { id: '9f3c2a71b0d84e55', nome: 'Recepção', ramal: '2001', servidor: 'starcloud1-starsonic.com.br', protocolo: 'udp', emUso: true },
      { id: '41aa07c3d2e95b18', nome: 'Caixa 2', ramal: '2015', servidor: 'starcloud-starsonic.com.br', protocolo: 'tcp', emUso: false },
    ],
    naoPerturbe: false,
    atenderAutomatico: { on: false, segundos: 3 },
    ligacao: null,
    recentes: [
      { numero: '2003', nome: 'Ana Souza', tipo: 'perdida', inicio: quando(0, 14, 32), duracao: 0, contatoId: 'c1d2e3f4a5b60718' },
      { numero: '1150603000', nome: '', tipo: 'feita', inicio: quando(0, 11, 5), duracao: 4 * MINUTO + 18_000, contatoId: '' },
      { numero: '2010', nome: 'Financeiro', tipo: 'recebida', inicio: quando(0, 9, 47), duracao: MINUTO + 2_000, contatoId: 'd4e5f6a7b8c90122' },
      { numero: '3001', nome: '', tipo: 'perdida', inicio: quando(1, 17, 58), duracao: 0, contatoId: '' },
      { numero: '2007', nome: 'Carlos Lima', tipo: 'feita', inicio: quando(1, 16, 20), duracao: 12 * MINUTO + 40_000, contatoId: 'b7c8d9e0f1a20344' },
      { numero: '2004', nome: 'Bruno', tipo: 'recebida', inicio: quando(3, 10, 12), duracao: 35_000, contatoId: '' },
    ],
    perdidas: 2,
    contatos: [
      { id: 'c1d2e3f4a5b60718', nome: 'Ana Souza', numero: '2003', observacao: 'Comercial' },
      { id: 'e9f0a1b2c3d40566', nome: 'Atendimento Starsonic', numero: '(11) 5060-3000', observacao: '' },
      { id: 'b7c8d9e0f1a20344', nome: 'Carlos Lima', numero: '2007', observacao: 'Suporte' },
      { id: 'd4e5f6a7b8c90122', nome: 'Financeiro', numero: '2010', observacao: '' },
    ],
    audio: {
      microfones: [
        { id: 0, nome: 'Microfone (Realtek)' },
        { id: 2, nome: 'Headset USB' },
      ],
      altoFalantes: [
        { id: 1, nome: 'Alto-falantes (Realtek)' },
        { id: 3, nome: 'Headset USB' },
      ],
      microfone: 'Headset USB',
      altoFalante: 'Headset USB',
      toque: '',
      desconectados: [],
    },
    iniciarComWindows: true,
    versao: '0.1.0-rc.1',
    teclado: '',
    tecladoVez: 0,
    atalhos: atalhosDoCanvas(),
    admin: { aberto: false, naoPerturbe: true, atenderAuto: true, blf: true, puxa: false },
    entrarAdmin: { erro: '', esperaAte: 0, vez: 0 },
    config: { bipeFim: true },
  };
}

function semConta(entrar: AppState['entrar']): AppState {
  return { ...principal(), tela: 'entrar', entrar, conta: null, contas: [], recentes: [], perdidas: 0, contatos: [] };
}

/** Um cartão da ligação: em andamento e fora da espera, a não ser o que vier em `extra`. */
function cartao(id: number, number: string, name: string, extra: Partial<CallCard> = {}): CallCard {
  return { id, number, name, incoming: false, phase: 'active', activeSinceMs: 0, held: false, ...extra };
}

/** O `activeSinceMs` de uma ligação atendida há `haMs` ms. */
function desde(haMs: number): number {
  return Date.now() - haMs;
}

function ligacao(top: CallCard, extra: Partial<CallState> = {}): CallState {
  return {
    top,
    second: null,
    secondKind: 'none',
    muted: false,
    conference: false,
    conferenceSinceMs: 0,
    consulting: false,
    colleagueActive: false,
    ...extra,
  };
}

const ANA = { id: 11, number: '2003', name: 'Ana Souza' } as const;
const CARLOS = { id: 12, number: '2007', name: 'Carlos Lima' } as const;

/** Os cenários da tela da ligação (o canvas: Chamada, Consulta, Conferência e Recebida). */
function cenarioDeLigacao(nome: string): Scenario | undefined {
  const comLigacao = (l: CallState): AppState => ({ ...principal(), ligacao: l });
  switch (nome) {
    case 'ligacao':
      // Uma ligação com a Ana, há 3 min 12 s.
      return { state: comLigacao(ligacao(cartao(ANA.id, ANA.number, ANA.name, { activeSinceMs: desde(3 * MINUTO + 12 * SEGUNDO) }))) };
    case 'ligacao-segunda':
      // O canvas "Chamada": com a Ana (no mudo) e o Carlos tocando na faixa, com o bipe de espera.
      return {
        state: comLigacao(
          ligacao(cartao(ANA.id, ANA.number, ANA.name, { activeSinceMs: desde(3 * MINUTO + 12 * SEGUNDO) }), {
            second: cartao(CARLOS.id, CARLOS.number, CARLOS.name, { incoming: true, phase: 'ringing' }),
            secondKind: 'ringing',
            muted: true,
          }),
        ),
        ring: 'espera',
      };
    case 'duas-ligacoes':
      // Duas em andamento: o Carlos em cima, a Ana em espera.
      return {
        state: comLigacao(
          ligacao(cartao(CARLOS.id, CARLOS.number, CARLOS.name, { incoming: true, activeSinceMs: desde(41 * SEGUNDO) }), {
            second: cartao(ANA.id, ANA.number, ANA.name, { activeSinceMs: desde(8 * MINUTO + 40 * SEGUNDO), held: true }),
            secondKind: 'held',
          }),
        ),
      };
    case 'consulta':
      // O canvas "Consulta": o colega (Carlos) em cima, a cliente (Ana) em espera para a transferência.
      return {
        state: comLigacao(
          ligacao(cartao(CARLOS.id + 20, CARLOS.number, CARLOS.name, { activeSinceMs: desde(41 * SEGUNDO) }), {
            second: cartao(ANA.id, ANA.number, ANA.name, { incoming: true, activeSinceMs: desde(8 * MINUTO + 40 * SEGUNDO), held: true }),
            secondKind: 'held',
            consulting: true,
            colleagueActive: true,
          }),
        ),
      };
    case 'conferencia':
      // O canvas "Conferência": as duas falando (a segunda vem "active"), há 6 min 27 s.
      return {
        state: comLigacao(
          ligacao(cartao(ANA.id, ANA.number, ANA.name, { activeSinceMs: desde(9 * MINUTO) }), {
            second: cartao(CARLOS.id, CARLOS.number, CARLOS.name, { activeSinceMs: desde(7 * MINUTO) }),
            secondKind: 'active',
            conference: true,
            conferenceSinceMs: desde(6 * MINUTO + 27 * SEGUNDO),
          }),
        ),
      };
    case 'aviso':
      // O aviso do canto (aviso.html): a Ana ligando, com o toque completo.
      return {
        state: comLigacao(ligacao(cartao(21, ANA.number, ANA.name, { incoming: true, phase: 'ringing' }))),
        ring: 'completo',
      };
    case 'tocando-antes-de-carregar':
      // A ligação já tocava quando a página carregou: o estado e o toque só chegam como resposta ao `ready`.
      return {
        state: comLigacao(ligacao(cartao(22, CARLOS.number, CARLOS.name, { incoming: true, phase: 'ringing' }))),
        ring: 'completo',
      };
    default:
      return undefined;
  }
}

/** Monta o cenário na hora (as datas valem a partir de agora). `undefined` para um nome desconhecido. */
export function createScenario(nome: string): Scenario | undefined {
  switch (nome) {
    case 'entrar':
      return { state: semConta(entrarVazio()) };
    case 'entrar-erro':
      return {
        state: semConta({
          ...entrarVazio(),
          servidor: 'starcloud1-starsonic.com.br',
          ramal: '2001',
          nome: 'Recepção',
          erro: 'Ramal ou senha incorretos.',
        }),
      };
    case 'entrar-pede-senha': {
      // A conta veio da rc.7 sem a senha (não decifrou): os campos vêm preenchidos e só falta a senha.
      const migrada = { id: '7d1e0c55a9b34f20', nome: 'Recepção', ramal: '2001', servidor: 'starcloud1-starsonic.com.br', protocolo: 'tcp' } as const;
      return {
        state: {
          ...semConta({
            servidor: migrada.servidor,
            protocolo: migrada.protocolo,
            ramal: migrada.ramal,
            nome: migrada.nome,
            erro: 'Digite a senha de novo para continuar.',
            ocupado: false,
            pedeSenha: true,
            podeCancelar: false,
            contaId: migrada.id,
          }),
          contas: [{ ...migrada, emUso: true }],
        },
      };
    }
    case 'troca-pede-senha': {
      // A troca para a Caixa 2, que está sem a senha: a tela Entrar pede a senha dela, e a Recepção continua em uso
      // (registrada) até o Entrar; o Cancelar volta para ela.
      const state = principal();
      const caixa = state.contas[1];
      return {
        state: {
          ...state,
          tela: 'entrar',
          entrar: {
            servidor: caixa.servidor,
            protocolo: caixa.protocolo,
            ramal: caixa.ramal,
            nome: caixa.nome,
            erro: 'Digite a senha de novo para continuar.',
            ocupado: false,
            pedeSenha: true,
            podeCancelar: true,
            contaId: caixa.id,
          },
        },
      };
    }
    case 'principal':
      return { state: principal() };
    case 'atalhos':
      return { state: principal(), view: 'atalhos' };
    case 'recentes':
      return { state: principal(), view: 'recentes' };
    case 'contatos':
      return { state: { ...principal(), atenderAutomatico: { on: true, segundos: 3 } }, view: 'contatos' };
    case 'configuracoes': {
      const state = principal();
      state.audio = { ...state.audio, altoFalante: 'Fone Bluetooth', desconectados: ['Fone Bluetooth'] };
      return { state, view: 'configuracoes' };
    }
    case 'sobre':
      return { state: principal(), view: 'sobre' };
    case 'nao-perturbe':
      return { state: { ...principal(), naoPerturbe: true } };
    default:
      return cenarioDeLigacao(nome);
  }
}

export const SCENARIO_NAMES = [
  'entrar',
  'entrar-erro',
  'entrar-pede-senha',
  'troca-pede-senha',
  'principal',
  'atalhos',
  'recentes',
  'contatos',
  'configuracoes',
  'sobre',
  'nao-perturbe',
  'ligacao',
  'ligacao-segunda',
  'duas-ligacoes',
  'consulta',
  'conferencia',
  'aviso',
  'tocando-antes-de-carregar',
] as const;
