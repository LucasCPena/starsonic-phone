// Os cenários da ponte falsa (?fake=<nome>): o estado que o "C++ de mentira" manda no `ready`.
// Os dados imitam as telas do canvas. As datas são relativas ao momento em que a página abre (Hoje, Ontem).
// (iPhone) Com `&plataforma=ios`, o mesmo cenário no modo iPhone (estadoDoIphone), com a agenda de exemplo.
// (0.2.0) Os cenários do chat (chat, chat-desligado, chat-sem-conta e chat-duas-contas) abrem na aba Chat; as conversas
// vêm do servidor do chat (o de teste, pelo `chat=` da URL: fake.ts).
// (0.3.0) O vídeo: o `principal` vem com o vídeo ligado, como o app de fábrica (o H.264 e o VP8), e os cenários `video`,
// `video-voz-camera`, `video-tocando`, `video-porteiro`, `video-grande`, `sem-video` e `sem-camera`.
// (0.4.0) A sala de vídeo (o quadro "Starsonic Phone — sala de vídeo"): a sala de id 30, com os convidados em cima ou com a
// ligação de fora (`sala`, `sala-estados`, `sala-cheia`, `sala-ligacao-de-fora`, `sala-fora`, `sala-de-volta` e
// `sala-grande`), e o que um convidado vê (`sala-convidado`). Fora deles, o `ligacao.sala` é `null`, também no iPhone.
import { arrumacao } from './sala/mosaico';
import { SEM_VIDEO, VIDEO_DESLIGADO } from './video/estado';
import type {
  AdminServer,
  AgendaContact,
  AgendaPermission,
  AppState,
  CallCard,
  CallState,
  CallVideo,
  CompanyContact,
  EstadoNaSala,
  RingKind,
  SalaDaLigacao,
  Shortcut,
} from './state';

/** A tela em que a interface abre (só na ponte falsa; o app real sempre abre no Teclado). */
export type FakeView = 'teclado' | 'atalhos' | 'recentes' | 'contatos' | 'chat' | 'configuracoes' | 'sobre';

/** (0.2.0) A empresa e o nome do computador do chat, sem os parâmetros `empresa` e `computador` da URL. */
export const EMPRESA_DO_CHAT = 'ACME Comércio Ltda';
export const COMPUTADOR_DO_CHAT = 'RECEPCAO-01';

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

/**
 * (rc.4) A planilha da empresa de exemplo, na ordem da planilha: a do cenário `contatos-empresa` e a que a leitura do
 * C++ de mentira traz (setCompanyList, refreshCompanyList). A Ana Souza 2003 também é minha (aparece uma vez só). O
 * caminho é de uma pasta da rede: nenhum endereço de rede vai no app.js.
 */
export const PLANILHA_DA_EMPRESA: CompanyContact[] = [
  { nome: 'Recepção', numero: '3001', observacao: 'Térreo' },
  { nome: 'Diretoria', numero: '3000', observacao: '' },
  { nome: 'Coordenação de Logística e Transportes', numero: '3020', observacao: 'Galpão 2' },
  { nome: 'Élcio Matos', numero: '3005', observacao: 'Compras' },
  { nome: 'Beatriz Ramos', numero: '3004', observacao: 'Contabilidade' },
  { nome: 'Ana Souza', numero: '2003', observacao: 'Comercial' },
  { nome: 'Almoxarifado', numero: '3010', observacao: 'Galpão 1' },
];
const CAMINHO_DA_PLANILHA = '\\\\servidor\\contatos\\empresa.xlsx';

/**
 * (iPhone) A agenda de exemplo, na ordem em que o iPhone a entrega (a interface ordena): 8 contatos inventados, a Ana
 * Souza com o celular e o ramal, nomes com acento e a Portaria no ramal 2000.
 */
export const AGENDA_DE_EXEMPLO: AgendaContact[] = [
  { nome: 'Otávio Nunes', numeros: ['(31) 96666-5555'] },
  { nome: 'Ana Souza', numeros: ['+55 11 98888-7777', '2003'] },
  { nome: 'Élcio Matos', numeros: ['(11) 3333-4444'] },
  { nome: 'Portaria', numeros: ['2000'] },
  { nome: 'Íris Lopes', numeros: ['+55 48 99999-1111'] },
  { nome: 'Beatriz Ramos', numeros: ['(21) 97777-6666'] },
  { nome: 'Ângela Prado', numeros: ['(11) 95555-4444'] },
  { nome: 'Cecília Duarte', numeros: ['(11) 2222-3333'] },
];

export interface Scenario {
  state: AppState;
  /** O toque atual, mandado depois do estado em cada `ready`. */
  ring?: RingKind;
  view?: FakeView;
  /** (rc.4) A lista da contatosEmpresa do `ready` (com a `vez` do `empresa.vez`), depois do estado e do toque. */
  contatosEmpresa?: CompanyContact[];
  /** (rc.4) A contatosEmpresa vem antes do primeiro estado (uma leitura que acabou com a página abrindo), e não depois. */
  empresaAntesDoEstado?: boolean;
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

export function entrarVazio(): AppState['entrar'] {
  return { servidor: '', protocolo: 'udp', ramal: '', nome: '', erro: '', ocupado: false, pedeSenha: false, podeCancelar: false, contaId: '' };
}

/**
 * (iPhone) O estado de um cenário no modo iPhone (docs/ponte-windows.md, "O modo iPhone"): os campos do iPhone (a
 * agenda, a rota de áudio "iPhone" e o Bipe ao digitar ligado) e os do PC com o valor neutro. Com a permissão
 * concedida, a agenda de exemplo é a primeira lista (`vez` 1). Nos Recentes, o `contatoId` é sempre "".
 */
export function estadoDoIphone(state: AppState, permissao: AgendaPermission): AppState {
  const concedida = permissao === 'concedida';
  // O estado do iPhone não tem o chat.
  const { chat: _semChat, ...doPC } = state;
  return {
    ...doPC,
    plataforma: 'ios',
    agenda: { permissao, vez: concedida ? 1 : 0, quantos: concedida ? AGENDA_DE_EXEMPLO.length : 0 },
    rotaAudio: 'iPhone',
    config: { ...state.config, bipeTecla: true },
    contas: state.contas.filter((c) => c.emUso),
    contatos: [],
    atalhos: [],
    iniciarComWindows: false,
    admin: { aberto: false, naoPerturbe: true, atenderAuto: true, blf: false, puxa: false },
    empresa: { link: '', situacao: 'nenhuma', erro: '', atualizadaEm: 0, quantos: 0, vez: 0 },
    audio: { microfones: [], altoFalantes: [], microfone: '', altoFalante: '', toque: '', desconectados: [] },
    recentes: state.recentes.map((r) => ({ ...r, contatoId: '' })),
    // Só o Windows tem vídeo e a sala: o vídeo do iPhone é o neutro, cada cartão da ligação vem sem vídeo, e nenhuma sala.
    video: structuredClone(VIDEO_DESLIGADO),
    ligacao: state.ligacao && {
      ...state.ligacao,
      top: { ...state.ligacao.top, video: { ...SEM_VIDEO } },
      second: state.ligacao.second && { ...state.ligacao.second, video: { ...SEM_VIDEO } },
      sala: null,
    },
  };
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
    empresa: { link: '', situacao: 'nenhuma', erro: '', atualizadaEm: 0, quantos: 0, vez: 0 },
    video: {
      ligado: true,
      cameras: ['Integrated Camera', 'Câmera USB'],
      camera: '',
      cameraDesconectada: false,
      teste: false,
      h264: { cartao: true, pessoa: true, situacao: 'instalado' },
      janela: 'normal',
    },
  };
}

/** (rc.4) A tela Contatos com a planilha da empresa lida hoje às 14:32. */
function comPlanilhaDaEmpresa(): Scenario {
  return {
    state: {
      ...principal(),
      empresa: {
        link: CAMINHO_DA_PLANILHA,
        situacao: 'ok',
        erro: '',
        atualizadaEm: quando(0, 14, 32),
        quantos: PLANILHA_DA_EMPRESA.length,
        vez: 1,
      },
    },
    view: 'contatos',
    contatosEmpresa: PLANILHA_DA_EMPRESA,
  };
}

function semConta(entrar: AppState['entrar']): AppState {
  return { ...principal(), tela: 'entrar', entrar, conta: null, contas: [], recentes: [], perdidas: 0, contatos: [] };
}

/** Um cartão da ligação: em andamento e fora da espera, a não ser o que vier em `extra`. */
function cartao(id: number, number: string, name: string, extra: Partial<CallCard> = {}): CallCard {
  return { id, number, name, incoming: false, phase: 'active', activeSinceMs: 0, held: false, video: { ...SEM_VIDEO }, ...extra };
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
    sala: null,
    ...extra,
  };
}

const ANA = { id: 11, number: '2003', name: 'Ana Souza' } as const;
const CARLOS = { id: 12, number: '2007', name: 'Carlos Lima' } as const;
// (0.4.0) Os outros convidados da sala e a ligação de fora.
const BIA = { id: 13, number: '2005', name: 'Bia Ramos' } as const;
const DAVI = { id: 14, number: '2006', name: 'Davi Nunes' } as const;
const ELISA = { id: 15, number: '2008', name: 'Elisa Prado' } as const;
const ROBERTO = { id: 16, number: '2012', name: 'Roberto Lima' } as const;

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

/** (0.3.0) Os cenários do vídeo: a ligação com a Ana (o `video`), as variações dela, a recebida e o porteiro tocando. */
function cenarioDeVideo(nome: string): Scenario | undefined {
  const emLigacao = (video: Partial<CallVideo>): AppState => ({
    ...principal(),
    ligacao: ligacao(cartao(ANA.id, ANA.number, ANA.name, { activeSinceMs: desde(3 * MINUTO + 12 * SEGUNDO), video: { ...SEM_VIDEO, ...video } })),
  });
  const comVideo = { ativo: true, imagem: true, camera: true };
  switch (nome) {
    case 'video':
      return { state: emLigacao(comVideo) };
    case 'video-voz-camera':
      // O vídeo negociado, mas a imagem da outra ponta ainda não chegou (a nossa câmera manda).
      return { state: emLigacao({ ativo: true, imagem: false, camera: true }) };
    case 'video-tocando':
      return {
        state: { ...principal(), ligacao: ligacao(cartao(21, ANA.number, ANA.name, { incoming: true, phase: 'ringing', video: { ...SEM_VIDEO, oferece: true } })) },
        ring: 'completo',
      };
    case 'video-porteiro':
      // A Portaria (um Porteiro do administrador) tocando, já com a imagem (o 183): o vídeo ativo, como no núcleo (que
      // nunca manda o `imagem` sem o `ativo`).
      return {
        state: {
          ...principal(),
          ligacao: ligacao(
            cartao(31, '1050', 'Portaria', {
              incoming: true,
              phase: 'ringing',
              video: { ...SEM_VIDEO, oferece: true, ativo: true, imagem: true, cedo: true, porteiro: true },
            }),
          ),
        },
        ring: 'completo',
      };
    case 'video-grande': {
      const state = emLigacao(comVideo);
      return { state: { ...state, video: { ...state.video!, janela: 'grande' } } };
    }
    case 'sem-video': {
      // O administrador desligou os três codecs; a chave da pessoa continua ligada.
      const state = principal();
      return { state: { ...state, video: { ...state.video!, ligado: false, h264: { cartao: false, pessoa: true, situacao: 'desligado' } } } };
    }
    case 'sem-camera': {
      const state = principal();
      return { state: { ...state, video: { ...state.video!, cameras: [] } }, view: 'configuracoes' };
    }
    default:
      return undefined;
  }
}

/** (0.4.0) O id da linha da sala nos cenários (do mesmo contador das ligações). */
const ID_DA_SALA = 30;

/**
 * (0.4.0) A linha da sala, atendida há `haMs` ms: o número e o nome vazios, e o vídeo da sala (o mosaico chegando ao
 * `remoto` e a nossa câmera chegando aos convidados).
 */
function linhaDaSala(haMs: number, extra: Partial<CallCard> = {}): CallCard {
  return cartao(ID_DA_SALA, '', '', { activeSinceMs: desde(haMs), video: { ...SEM_VIDEO, ativo: true, imagem: true, camera: true }, ...extra });
}

type Convidado = [pessoa: { id: number; number: string; name: string }, estado: EstadoNaSala, imagem: boolean];

/** (0.4.0) A sala de id 30 com os convidados, na ordem, cada um no quadro dele da arrumação do núcleo. */
function salaCom(convidados: Convidado[], extra: Partial<Pick<SalaDaLigacao, 'fora' | 'cheia'>> = {}): SalaDaLigacao {
  const quadros = arrumacao(convidados.length);
  return {
    id: ID_DA_SALA,
    fora: false,
    cheia: false,
    participantes: convidados.map(([p, estado, imagem], i) => ({ id: p.id, numero: p.number, nome: p.name, estado, imagem, quadro: quadros[i] })),
    ...extra,
  };
}

/**
 * (0.4.0) Os cenários da sala, como os quadros Sala, SalaEstados, SalaCheia, LigacaoDeFora, ForaDaSala, Grande e
 * Convidado: os tempos são os deles. A ligação de fora é o Roberto, só com a voz.
 */
function cenarioDaSala(nome: string): Scenario | undefined {
  const comLigacao = (l: CallState): AppState => ({ ...principal(), ligacao: l });
  const naSala = (p: Convidado[0]): Convidado => [p, 'naSala', true];
  const anaECarlos = [naSala(ANA), naSala(CARLOS)];
  switch (nome) {
    case 'sala':
      return { state: comLigacao(ligacao(linhaDaSala(5 * MINUTO + 41 * SEGUNDO), { sala: salaCom(anaECarlos) })) };
    case 'sala-estados':
      // Um convidado de cada jeito: com a imagem, ainda chamando, sem vídeo e em espera.
      return {
        state: comLigacao(
          ligacao(linhaDaSala(8 * MINUTO + 20 * SEGUNDO), {
            sala: salaCom([naSala(ANA), [CARLOS, 'chamando', false], [BIA, 'naSala', false], [DAVI, 'emEspera', false]]),
          }),
        ),
      };
    case 'sala-cheia':
      return {
        state: comLigacao(
          ligacao(linhaDaSala(12 * MINUTO + 5 * SEGUNDO), { sala: salaCom([ANA, CARLOS, BIA, DAVI, ELISA].map(naSala), { cheia: true }) }),
        ),
      };
    case 'sala-ligacao-de-fora':
      // O Roberto tocando como a segunda, com o bipe de espera.
      return {
        state: comLigacao(
          ligacao(linhaDaSala(6 * MINUTO + 58 * SEGUNDO), {
            second: cartao(ROBERTO.id, ROBERTO.number, ROBERTO.name, { incoming: true, phase: 'ringing' }),
            secondKind: 'ringing',
            sala: salaCom(anaECarlos),
          }),
        ),
        ring: 'espera',
      };
    case 'sala-fora':
      // O Roberto atendido em cima, e você fora da sala: ela em espera embaixo.
      return {
        state: comLigacao(
          ligacao(cartao(ROBERTO.id, ROBERTO.number, ROBERTO.name, { incoming: true, activeSinceMs: desde(42 * SEGUNDO) }), {
            second: linhaDaSala(7 * MINUTO + 12 * SEGUNDO, { held: true }),
            secondKind: 'held',
            sala: salaCom(anaECarlos, { fora: true }),
          }),
        ),
      };
    case 'sala-de-volta':
      // De volta à sala, com o Roberto em espera.
      return {
        state: comLigacao(
          ligacao(linhaDaSala(7 * MINUTO + 30 * SEGUNDO), {
            second: cartao(ROBERTO.id, ROBERTO.number, ROBERTO.name, { incoming: true, activeSinceMs: desde(MINUTO + 5 * SEGUNDO), held: true }),
            secondKind: 'held',
            sala: salaCom(anaECarlos),
          }),
        ),
      };
    case 'sala-grande': {
      const state = comLigacao(ligacao(linhaDaSala(9 * MINUTO + 12 * SEGUNDO), { sala: salaCom([ANA, CARLOS, BIA].map(naSala)) }));
      return { state: { ...state, video: { ...state.video!, janela: 'grande' } } };
    }
    case 'sala-convidado': {
      // O que o convidado vê: a conta da Ana Souza numa videochamada comum com a Recepção, que montou a sala e ligou
      // para ela (só quem monta tem o `ligacao.sala`).
      const state = principal();
      const conta = { ...state.conta!, nome: 'Ana Souza', ramal: '2003' };
      return {
        state: {
          ...state,
          conta,
          contas: state.contas.map((c) => (c.id === conta.id ? { ...c, nome: conta.nome, ramal: conta.ramal } : c)),
          ligacao: ligacao(
            cartao(11, '2001', 'Recepção', {
              incoming: true,
              activeSinceMs: desde(5 * MINUTO + 41 * SEGUNDO),
              video: { ...SEM_VIDEO, ativo: true, imagem: true, camera: true },
            }),
          ),
        },
      };
    }
    default:
      return undefined;
  }
}

/**
 * (0.2.0) Os cenários do chat, na aba Chat, com a conta em uso só: o computador ligado ao chat (a chave é o parâmetro
 * `chave`: sem ela, ele fica fora, como o C++ sem chave guardada) ou não (`chat-desligado`), e a conta em uso já conectada
 * aqui, ou ainda não (`chat-sem-conta`). No `chat-duas-contas`, a Caixa 2 (2015) é a segunda conta, também conectada.
 */
function cenarioDoChat(nome: string): Scenario | undefined {
  const base = principal();
  const comChat = (ligado: boolean, contaConectada: boolean): AppState => ({
    ...base,
    contas: base.contas.filter((c) => c.emUso),
    chat: { ligado, empresa: ligado ? EMPRESA_DO_CHAT : '', computador: COMPUTADOR_DO_CHAT, contaConectada },
  });
  switch (nome) {
    case 'chat':
      return { state: comChat(true, true), view: 'chat' };
    case 'chat-desligado':
      return { state: comChat(false, true), view: 'chat' };
    case 'chat-sem-conta':
      return { state: comChat(true, false), view: 'chat' };
    case 'chat-duas-contas':
      return { state: { ...comChat(true, true), contas: base.contas }, view: 'chat' };
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
    case 'contatos-empresa':
      return comPlanilhaDaEmpresa();
    case 'empresa-antes-do-estado':
      return { ...comPlanilhaDaEmpresa(), empresaAntesDoEstado: true };
    default:
      return cenarioDeLigacao(nome) ?? cenarioDeVideo(nome) ?? cenarioDaSala(nome) ?? cenarioDoChat(nome);
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
  'contatos-empresa',
  'empresa-antes-do-estado',
  'ligacao',
  'ligacao-segunda',
  'duas-ligacoes',
  'consulta',
  'conferencia',
  'aviso',
  'tocando-antes-de-carregar',
  'video',
  'video-voz-camera',
  'video-tocando',
  'video-porteiro',
  'video-grande',
  'sem-video',
  'sem-camera',
  'sala',
  'sala-estados',
  'sala-cheia',
  'sala-ligacao-de-fora',
  'sala-fora',
  'sala-de-volta',
  'sala-grande',
  'sala-convidado',
  'chat',
  'chat-desligado',
  'chat-sem-conta',
  'chat-duas-contas',
] as const;
