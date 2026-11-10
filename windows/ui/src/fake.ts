// A ponte falsa: um "C++ de mentira" para abrir a interface num navegador comum e nos testes (Playwright).
// Responde ao `ready` com o estado do cenário (src/fake-scenarios.ts) e imita as respostas mais simples do
// DesktopApp. Guarda cada comando em window.__comandos; window.__fake.push(msg) manda uma mensagem à interface.
// As regras de verdade (validações, ligações) são do C++: aqui só o bastante para as telas reagirem.
// (iPhone) `?fake=<cenario>&plataforma=ios&agenda=pendente|negada|concedida` (sem `agenda`: concedida) abre o cenário no
// modo iPhone (docs/ponte-windows.md, "O modo iPhone"): o estado do contrato, a agenda de exemplo depois do estado no
// `ready` (com a permissão concedida) e nenhum toque. Com `&abrir=recentes`, o app aberto pelo aviso da perdida: o
// primeiro `ready` traz também o `abrir`, depois do estado e da agenda. A aba Contatos que abre (o `contactsOpened`) lê a
// agenda de novo, como o hospedeiro: a mesma lista, com a `vez` seguinte. O Bipe ao digitar (o `setSetting` com o
// `bipeTecla`) muda o `config.bipeTecla`; o `audioRoute` (a escolha do iPhone) e o `keyTone` (o bipe) são do hospedeiro:
// ficam só guardados, e um teste muda a `rotaAudio` pelo `push`, como o núcleo.
// (0.2.0) O chat, nos cenários do chat: `&chave=` é a chave que o C++ de mentira guarda (sem ela, o computador fica fora
// do chat), `&empresa=` a empresa dela (sem o parâmetro, ACME Comércio Ltda), `&computador=` o nome do computador (sem
// ele, RECEPCAO-01), e `&ramal=` e `&nome=` a conta em uso. O `chat=` (o endereço do chat de teste) é da interface
// (chat/endereco.ts). O chatKey responde com a chatChave, o chatLink guarda a chave e liga, o chatUnlink desliga; a
// conta que registra (a escolhida nas contas, a do Entrar) fica conectada aqui. Depois de cada `ready`, a `janela` vem
// com `frente: true`. (iPhone) Sem o chat, e os comandos dele são recusados.
// (0.3.0) O vídeo: o `video` do estado e o `video` de cada cartão seguem os comandos como o núcleo (docs/ponte-windows.md,
// "Vídeo (0.3.0)" e "O vídeo na ligação"): as escolhas do vídeo, o H.264 que baixa (1 s) e instala, o teste da câmera, o
// modo da janela, a câmera na ligação e o cartão Vídeo do administrador. O `noticeHeight` só fica no `__comandos`. O
// `__fake.mandar(comando)` manda o comando como se a página o mandasse (só dos testes da ponte falsa). No iPhone, o vídeo
// é recusado.
// (0.3.0) As memórias do vídeo, como o executável ("A memória do vídeo"): a de cada vista da página nasce no primeiro
// `videoViews` que a mostra (as vistas da outra página são ignoradas) e chega pelo `sharedbufferreceived`, depois. O evento
// leva a própria memória, sem o structuredClone das mensagens: o quadro que um teste grava depois aparece na página. O
// `__fake.quadro(vista, largura, altura, y, u, v)` grava um quadro como o escritor do executável (false enquanto a vista
// não tem memória), o `__fake.esvaziar(vista)` a esvazia, o `__fake.memoriaCrua(dados, bytes)` entrega uma memória
// qualquer e o `__fake.liberadas()` conta as que a página soltou (como no WebView2, uma memória solta fica inacessível).
import { AGENDA_DE_EXEMPLO, createScenario, entrarVazio, estadoDoIphone, PLANILHA_DA_EMPRESA, SERVIDORES_DO_PERFIL, type FakeView } from './fake-scenarios';
import { trimAscii } from './format';
import { escreverQuadro, esvaziar as esvaziarMemoria, TAMANHO_DA_MEMORIA, type Plano } from './video/memoria';
import { NENHUMA_CAMERA } from './video/textos';
import type { SharedBufferEventLike, WebviewLike } from './bridge';
import type {
  AdminAberto,
  AdminServer,
  AdminState,
  AgendaContact,
  AgendaPermission,
  AppState,
  BlfState,
  CallCard,
  CallState,
  CompanyContact,
  CompanyList,
  CodecDeVideo,
  Contact,
  IncomingMessage,
  QualidadeDeVideo,
  RingKind,
  Shortcut,
  ShortcutAction,
  UpdateChannel,
  VideoSettings,
  VistaDeVideoNome,
} from './state';

/** A senha que a área do administrador da ponte falsa aceita: só de teste (a de verdade nunca fica no repositório). */
const SENHA_DE_TESTE = 'senha-de-teste';
const ACOES: ShortcutAction[] = ['ligar', 'transferir', 'consulta', 'teclas'];
const CODECS: CodecDeVideo[] = ['h264', 'vp8', 'vp9'];
const QUALIDADES: QualidadeDeVideo[] = ['baixa', 'media', 'alta'];
const MAXIMO_DE_PORTEIROS = 20;
const CODIGO_DE_PUXAR = /^(?:[0-9*#+]|\{ramal\})*$/;
/** (0.2.0) A chave do chat que o chatLink aceita (docs/ponte-windows.md, "Os comandos do chat"). */
const CHAVE_DO_CHAT = /^[A-Za-z0-9_-]{43}$/;

type Listener = (event: { data: unknown }) => void;
type OuvinteDeMemoria = (event: SharedBufferEventLike) => void;

export interface FakeHooks {
  push(message: unknown): void;
  state(): AppState;
  /** Segura o que o C++ de mentira manda de volta a um comando (o estado, o aviso e o toque) até o `soltar()`: o C++ lento. */
  segurar(): void;
  soltar(): void;
  /** (0.3.0) O comando como se a página o mandasse (guardado em `__comandos`); só dos testes da ponte falsa. */
  mandar(comando: Record<string, unknown>): void;
  /** (0.3.0) Grava um quadro na memória da vista, como o escritor do executável; `false` enquanto ela não tem memória. */
  quadro(vista: VistaDeVideoNome, largura: number, altura: number, y: Plano, u: Plano, v: Plano): boolean;
  /** (0.3.0) Esvazia a memória da vista (o `seq` volta a 0), como o executável quando a ligação dela muda ou acaba. */
  esvaziar(vista: VistaDeVideoNome): void;
  /** (0.3.0) Entrega à página uma memória qualquer de `bytes` bytes, com este `additionalData`. */
  memoriaCrua(dados: unknown, bytes: number): void;
  /** (0.3.0) Quantas memórias a página soltou (o `releaseBuffer`). */
  liberadas(): number;
}

declare global {
  interface Window {
    __comandos?: Array<Record<string, unknown>>;
    __fake?: FakeHooks;
  }
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function sortContacts(list: Contact[]): Contact[] {
  return [...list].sort((a, b) => fold(a.nome).localeCompare(fold(b.nome)));
}

const PERMISSOES: AgendaPermission[] = ['pendente', 'negada', 'concedida'];

/** `null` para um cenário que não existe (a interface mostra o erro, não um cenário qualquer). */
export function createFakeWebview(name: string): { webview: WebviewLike; view: FakeView | undefined } | null {
  const scenario = createScenario(name);
  if (!scenario) return null;
  const parametros = new URLSearchParams(location.search);
  const ios = parametros.get('plataforma') === 'ios';
  const permissao = PERMISSOES.find((p) => p === parametros.get('agenda')) ?? 'concedida';
  // (iPhone) Um `abrir` pedido antes do `ready`: vai uma vez, no primeiro.
  let abrirNoReady = ios && parametros.get('abrir') === 'recentes';
  let state: AppState = structuredClone(ios ? estadoDoIphone(scenario.state, permissao) : scenario.state);
  // (0.2.0) A chave do chat que o C++ de mentira guarda ("" fora do chat): só na chatChave, nunca no estado.
  let chaveDoChat = '';
  if (state.chat) {
    chaveDoChat = state.chat.ligado ? (parametros.get('chave') ?? '') : '';
    const ligado = chaveDoChat !== '';
    state.chat = {
      ...state.chat,
      ligado,
      empresa: ligado ? (parametros.get('empresa') ?? state.chat.empresa) : '',
      computador: parametros.get('computador') ?? state.chat.computador,
    };
    const ramal = parametros.get('ramal');
    const nome = parametros.get('nome');
    if (state.conta && (ramal !== null || nome !== null)) {
      const conta = { ...state.conta, ramal: ramal ?? state.conta.ramal, nome: nome ?? state.conta.nome };
      state.conta = conta;
      state.contas = state.contas.map((c) => (c.id === conta.id ? { ...c, ramal: conta.ramal, nome: conta.nome } : c));
    }
  }
  // (iPhone) A última lista da agenda (vazia sem a permissão concedida). A que um teste manda pelo `push`, como o núcleo,
  // passa a ser ela: é a que o `contactsOpened` lê de novo.
  let agendaAtual: { vez: number; contatos: AgendaContact[] } = {
    vez: state.agenda?.vez ?? 0,
    contatos: state.agenda?.permissao === 'concedida' ? AGENDA_DE_EXEMPLO : [],
  };
  const listeners = new Set<Listener>();
  const sent: Array<Record<string, unknown>> = [];
  window.__comandos = sent;
  // (0.3.0) As memórias do vídeo: a de cada vista (do primeiro `videoViews` que a mostra) e quantas a página soltou.
  const ouvintesDeMemoria = new Set<OuvinteDeMemoria>();
  const memorias = new Map<VistaDeVideoNome, ArrayBuffer>();
  let liberadas = 0;
  /** Assíncrono, como o PostSharedBufferToScript; o evento leva a própria memória (não uma cópia). */
  const entregarMemoria = (memoria: ArrayBuffer, dados: unknown) => {
    setTimeout(() => {
      for (const l of [...ouvintesDeMemoria]) l({ additionalData: structuredClone(dados), getBuffer: () => memoria });
    }, 0);
  };
  /** A memória da vista que a página ainda lê (uma que ela soltou fica sem o conteúdo: o escritor não a alcança mais). */
  const memoriaDaVista = (vista: VistaDeVideoNome) => {
    const memoria = memorias.get(vista);
    return memoria && memoria.byteLength > 0 ? memoria : null;
  };

  // O C++ lento (segurar/soltar): as respostas aos comandos esperam, na ordem; o `push` do teste passa direto.
  let segurando = false;
  const presas: unknown[] = [];
  const deliver = (message: unknown, direto = false) => {
    if (segurando && !direto) {
      presas.push(message);
      return;
    }
    // Assíncrono, como o PostWebMessageAsJson.
    setTimeout(() => {
      for (const l of [...listeners]) l({ data: structuredClone(message) });
    }, 0);
  };
  const publish = () => deliver({ v: 1, type: 'state', state } satisfies IncomingMessage);
  const change = (next: Partial<AppState>) => {
    state = { ...state, ...next };
    publish();
  };

  window.__fake = {
    push(message) {
      if (typeof message === 'object' && message !== null && (message as { type?: string }).type === 'state') {
        state = structuredClone((message as { state: AppState }).state);
      }
      if (typeof message === 'object' && message !== null && (message as { type?: string }).type === 'agenda') {
        const agenda = message as { vez: number; contatos: AgendaContact[] };
        if (agenda.vez > agendaAtual.vez) agendaAtual = { vez: agenda.vez, contatos: structuredClone(agenda.contatos) };
      }
      deliver(message, true);
    },
    state: () => structuredClone(state),
    segurar() {
      segurando = true;
    },
    soltar() {
      segurando = false;
      for (const message of presas.splice(0)) deliver(message);
    },
    mandar: (comando) => webview.postMessage({ v: 1, ...comando }),
    quadro(vista, largura, altura, y, u, v) {
      const memoria = memoriaDaVista(vista);
      if (!memoria) return false;
      escreverQuadro(memoria, largura, altura, y, u, v);
      return true;
    },
    esvaziar(vista) {
      const memoria = memoriaDaVista(vista);
      if (memoria) esvaziarMemoria(memoria);
    },
    memoriaCrua(dados, bytes) {
      entregarMemoria(new ArrayBuffer(bytes), dados);
    },
    liberadas: () => liberadas,
  };

  // (iPhone) Nenhum toque: quem toca é a tela de chamada do iPhone.
  const ring = (tipo: RingKind) => {
    if (!ios) deliver({ v: 1, type: 'ring', tipo } satisfies IncomingMessage);
  };
  const toast = (texto: string) => deliver({ v: 1, type: 'toast', texto } satisfies IncomingMessage);
  // Quando a última ligação acaba, a janela do vídeo volta a `normal` (o núcleo).
  const setCall = (ligacao: CallState | null) =>
    change({ ligacao, ...(ligacao === null && state.video && state.video.janela !== 'normal' ? { video: { ...state.video, janela: 'normal' as const } } : {}) });

  // (rc.4) A planilha da empresa do C++ de mentira: o link salvo é lido ("lendo") e, um instante depois, a leitura é boa
  // e traz a planilha de exemplo; a que volta depois de o link mudar é descartada. O link vazio tira a lista. Como no
  // C++, a contatosEmpresa sai antes do estado com a `vez` nova.
  const empresaNoReady = () =>
    deliver({ v: 1, type: 'contatosEmpresa', vez: state.empresa.vez, contatos: scenario.contatosEmpresa ?? [] } satisfies IncomingMessage);
  const novaListaDaEmpresa = (contatos: CompanyContact[], empresa: Partial<CompanyList>) => {
    const vez = state.empresa.vez + 1;
    deliver({ v: 1, type: 'contatosEmpresa', vez, contatos } satisfies IncomingMessage);
    change({ empresa: { ...state.empresa, ...empresa, vez } });
  };
  const lerPlanilha = (link: string) => {
    change({ empresa: { ...state.empresa, link, situacao: 'lendo', erro: '' } });
    setTimeout(() => {
      if (state.empresa.link !== link) return;
      novaListaDaEmpresa(PLANILHA_DA_EMPRESA, { situacao: 'ok', erro: '', atualizadaEm: Date.now(), quantos: PLANILHA_DA_EMPRESA.length });
    }, 1000);
  };

  // (iPhone) A agenda inteira (vazia sem a permissão concedida). Uma lista nova sai antes do estado com a `vez` nova,
  // como no núcleo; no `ready`, depois do estado.
  const mandarAgenda = (vez: number, contatos: AgendaContact[]) => {
    agendaAtual = { vez, contatos };
    deliver({ v: 1, type: 'agenda', vez, contatos } satisfies IncomingMessage);
  };
  /** A `vez` de uma lista nova: depois da do estado e da última lista (a de um teste pode ter vindo sem o estado). */
  const vezSeguinte = () => Math.max(state.agenda?.vez ?? 0, agendaAtual.vez) + 1;

  // A área do administrador do C++ de mentira: a senha de teste, a espera de 30 s depois de 5 erradas seguidas e o
  // que a área guarda além do que a interface vê com ela fechada (o admin.json).
  let erradas = 0;
  // O cartão Vídeo parte dos padrões do app de fábrica (o H.264 e o VP8 ligados, o VP9 desligado, o H.264 primeiro, a
  // qualidade média, nenhum porteiro), mas com desligado o que o estado do cenário já mostra desligado (o `sem-video`).
  let guardado: Omit<AdminAberto, 'aberto' | 'naoPerturbe' | 'atenderAuto' | 'blf' | 'puxa'> = {
    puxar: false,
    codigoPuxar: '',
    servidores: structuredClone(SERVIDORES_DO_PERFIL),
    canal: '',
    videoH264: state.video?.h264.cartao ?? false,
    videoVp8: state.video?.ligado ?? false,
    videoVp9: false,
    videoPrimeiro: 'h264',
    videoQualidade: 'media',
    porteiros: [],
  };
  // O clique num atalho tocando puxa a ligação só com o BLF, o puxar e um código ligados (o `admin.puxa` do C++).
  const puxa = (blf: boolean) => blf && guardado.puxar && guardado.codigoPuxar !== '';
  const visivel = () => ({
    naoPerturbe: state.admin.naoPerturbe,
    atenderAuto: state.admin.atenderAuto,
    blf: state.admin.blf,
    puxa: puxa(state.admin.blf),
  });
  const adminAberto = (): AdminState => ({ aberto: true, ...visivel(), ...guardado });
  // O último BLF que o servidor deu a cada atalho (volta quando o administrador liga o BLF de novo).
  const blfVisto = new Map<string, BlfState | null>(state.atalhos.map((a) => [a.id, a.estado]));
  const estadoDoBlf = (a: Shortcut, blfDoAdmin: boolean): BlfState | null => (a.blf && blfDoAdmin ? (blfVisto.get(a.id) ?? 'desconectado') : null);

  /** O que a loja dos atalhos do C++ recusa (o motivo vai num toast e nada é gravado). */
  const recusaDoAtalho = (command: Record<string, unknown>): string => {
    const editando = typeof command.id === 'string';
    if (editando && !state.atalhos.some((a) => a.id === command.id)) return 'Esse atalho não existe mais.';
    if (!editando && state.atalhos.length >= 8) return 'Você já tem 8 atalhos. Remova um para adicionar outro.';
    if (trimAscii(String(command.nome ?? '')) === '') return 'Digite o nome do atalho.';
    // Nada abaixo de U+0020 no nome (um tab no meio dele, por exemplo; os das pontas a loja já tirou).
    if (/[\u0000-\u001f]/.test(trimAscii(String(command.nome)))) return 'O nome não pode ter caracteres de controle.';
    if (trimAscii(String(command.numero ?? '')) === '') return 'Digite o número do atalho.';
    return '';
  };

  /** A tabela de portas como a loja do administrador grava (o endereço sem espaços e em minúsculas), ou o motivo da recusa. */
  const servidoresGravados = (lista: unknown): AdminServer[] | string => {
    const gravados: AdminServer[] = [];
    for (const item of Array.isArray(lista) ? (lista as AdminServer[]) : []) {
      const endereco = String(item.endereco ?? '').trim().toLowerCase();
      if (!Number.isInteger(item.porta) || item.porta < 1 || item.porta > 65535) return 'A porta deve ficar entre 1 e 65535.';
      if (gravados.some((s) => s.endereco === endereco)) return 'Esse servidor já está na lista.';
      gravados.push({ endereco, porta: item.porta });
    }
    return gravados;
  };
  // O vídeo do núcleo: o `ligado` é o VP8 ou o VP9 do cartão, ou o H.264 do cartão com a chave da pessoa.
  const mudarVideo = (mudar: (v: VideoSettings) => VideoSettings) => {
    if (state.video) change({ video: mudar(state.video) });
  };
  const comLigado = (v: VideoSettings): VideoSettings => ({
    ...v,
    ligado: guardado.videoVp8 || guardado.videoVp9 || (v.h264.cartao && v.h264.pessoa),
  });
  /** O H.264 ligado (o cartão e a pessoa) e ainda não instalado baixa e, 1 s depois, instala. */
  const baixarH264 = () => {
    mudarVideo((v) => ({ ...v, h264: { ...v.h264, situacao: 'baixando' } }));
    setTimeout(() => {
      if (state.video?.h264.situacao === 'baixando') mudarVideo((v) => ({ ...v, h264: { ...v.h264, situacao: 'instalado' } }));
    }, 1000);
  };
  /** O cartão ou a pessoa desliga o H.264: `desligado`; se voltou e o módulo não está instalado, baixa. */
  const acertarH264 = (instalavel: boolean) => {
    const v = state.video;
    if (!v) return;
    if (!instalavel) mudarVideo((x) => ({ ...x, h264: { ...x.h264, situacao: 'desligado' } }));
    else if (v.h264.situacao === 'desligado') baixarH264();
  };
  /** A recusa da lista dos Porteiros do núcleo (a quantidade, os dígitos, o tamanho e a repetição), ou a lista gravada. */
  const porteirosGravados = (lista: unknown): string[] | string => {
    const itens = Array.isArray(lista) ? lista : [];
    if (itens.length > MAXIMO_DE_PORTEIROS) return 'No máximo 20 porteiros.';
    const gravados: string[] = [];
    for (const item of itens) {
      const ramal = trimAscii(String(item));
      if (!/^[0-9]*$/.test(ramal)) return 'Cada porteiro só pode ter dígitos.';
      if (ramal.length < 1 || ramal.length > 15) return 'Cada porteiro precisa ter de 1 a 15 dígitos.';
      if (gravados.includes(ramal)) return 'Esse porteiro já está na lista.';
      gravados.push(ramal);
    }
    return gravados;
  };
  /** O cartão da ligação atendida: a câmera só liga com o `video`, e o vídeo da outra ponta segue a oferta. */
  const atendida = (card: CallCard, video: boolean): CallCard => ({
    ...card,
    phase: 'active',
    activeSinceMs: Date.now(),
    video: { oferece: card.video?.oferece ?? false, ativo: card.video?.oferece ?? false, imagem: card.video?.oferece ?? false, camera: video, cedo: false },
  });

  let proximoId = 40;
  /** A segunda ligação feita (Nova ligação ou Consultar): a de agora vai para a espera e a nova chama. */
  const ligarDeNovo = (l: CallState, numero: string, consulta: boolean) => {
    const contato = state.contatos.find((c) => c.numero === numero);
    const nova: CallCard = { id: ++proximoId, number: numero, name: contato?.nome ?? '', incoming: false, phase: 'dialing', activeSinceMs: 0, held: false };
    setCall({ ...l, top: nova, second: { ...l.top, held: true }, secondKind: 'held', consulting: consulta, colleagueActive: consulta });
    // O outro lado atende logo depois.
    setTimeout(() => {
      const agora = state.ligacao;
      if (agora?.top.id === nova.id && agora.top.phase === 'dialing') {
        setCall({ ...agora, top: { ...agora.top, phase: 'active', activeSinceMs: Date.now() } });
      }
    }, 1500);
  };
  /** As ligações do C++ de mentira: só o bastante para a tela da ligação seguir os botões. */
  const handleCall = (command: Record<string, unknown>): boolean => {
    const l = state.ligacao;
    switch (command.cmd) {
      case 'answer':
        // (0.3.0) Só com o `video: true` a nossa câmera liga; a imagem da outra ponta segue a oferta.
        if (l?.top.phase === 'ringing') {
          setCall({ ...l, top: atendida(l.top, command.video === true && !ios) });
          ring('parar');
        } else if (l?.second && l.secondKind === 'ringing') {
          setCall({ ...l, top: atendida(l.second, command.video === true && !ios), second: { ...l.top, held: true }, secondKind: 'held' });
          ring('parar');
        }
        return true;
      case 'camera': {
        // A câmera da ligação de cima: com o id do motor e fora do toque; sem ligação, nada.
        if (ios || typeof command.on !== 'boolean' || !l || l.top.id <= 0 || l.top.phase === 'ringing' || !l.top.video) return true;
        const on = command.on;
        setCall({ ...l, top: { ...l.top, video: { ...l.top.video, camera: on, ativo: on ? true : l.top.video.ativo } } });
        return true;
      }
      case 'reject':
        if (l?.top.phase === 'ringing') {
          setCall(null);
          ring('parar');
        } else if (l?.second && l.secondKind === 'ringing') {
          setCall({ ...l, second: null, secondKind: 'none' });
          ring('parar');
        }
        return true;
      case 'hangup': {
        if (!l) return true;
        const id = typeof command.id === 'number' ? command.id : l.top.id;
        const semConsulta = { consulting: false, colleagueActive: false };
        if (l.conference) setCall(null);
        else if (l.top.id === id && l.second && l.secondKind === 'held') {
          // A em espera volta sozinha.
          setCall({ ...l, ...semConsulta, top: { ...l.second, held: false }, second: null, secondKind: 'none' });
        } else if (l.top.id === id) setCall(null);
        else if (l.second?.id === id) setCall({ ...l, ...semConsulta, second: null, secondKind: 'none' });
        return true;
      }
      case 'hold':
        if (l && !l.conference) setCall({ ...l, top: { ...l.top, held: typeof command.on === 'boolean' ? command.on : !l.top.held } });
        return true;
      case 'mute':
        if (l) setCall({ ...l, muted: typeof command.on === 'boolean' ? command.on : !l.muted });
        return true;
      case 'swap':
        if (l?.second && l.secondKind === 'held') {
          setCall({
            ...l,
            top: { ...l.second, held: false },
            second: { ...l.top, held: true },
            colleagueActive: l.consulting ? !l.colleagueActive : false,
          });
        }
        return true;
      case 'join':
        if (l?.second && l.secondKind === 'held' && !l.consulting) {
          setCall({ ...l, top: { ...l.top, held: false }, second: { ...l.second, held: false }, secondKind: 'active', conference: true, conferenceSinceMs: Date.now() });
        }
        return true;
      case 'split':
        if (l?.conference && l.second) {
          setCall({ ...l, second: { ...l.second, held: true }, secondKind: 'held', conference: false, conferenceSinceMs: 0 });
        }
        return true;
      case 'consult':
        if (l && !l.second) ligarDeNovo(l, String(command.numero ?? ''), true);
        return true;
      case 'cancelConsult':
        if (l?.consulting && l.second) {
          const cliente = l.colleagueActive ? l.second : l.top;
          setCall({ ...l, top: { ...cliente, held: false }, second: null, secondKind: 'none', consulting: false, colleagueActive: false });
        }
        return true;
      case 'completeTransfer':
      case 'transfer':
        if (l) setCall(null);
        return true;
      case 'dial':
        // Com uma ligação, a Nova ligação; sem nenhuma, nada muda (as specs do Teclado só olham o comando).
        if (l && !l.second) ligarDeNovo(l, String(command.numero ?? ''), false);
        return true;
      case 'dtmf':
        return true;
      default:
        return false;
    }
  };

  const handle = (command: Record<string, unknown>) => {
    if (handleCall(command)) return;
    switch (command.cmd) {
      case 'ready':
        // (iPhone) O estado, a agenda (com uma lista desde a abertura: `vez` > 0) e o `abrir` pedido antes, nesta ordem;
        // nada de toque nem da lista da empresa.
        if (ios) {
          publish();
          if (state.agenda && state.agenda.vez > 0) mandarAgenda(state.agenda.vez, agendaAtual.contatos);
          if (abrirNoReady) {
            abrirNoReady = false;
            deliver({ v: 1, type: 'abrir', tela: 'recentes' } satisfies IncomingMessage);
          }
          break;
        }
        // (rc.4) A lista da empresa vem depois do estado e do toque (com uma lista desde a abertura: `vez` > 0); no
        // cenário da leitura que acabou com a página abrindo, só antes do primeiro estado.
        if (scenario.empresaAntesDoEstado) empresaNoReady();
        // (0.3.0) O `ready` da janela principal (não o do aviso) desliga o teste da câmera que estava ligado.
        if (state.video?.teste && !location.pathname.endsWith('aviso.html')) state = { ...state, video: { ...state.video, teste: false } };
        publish();
        if (scenario.ring) deliver({ v: 1, type: 'ring', tipo: scenario.ring });
        if (!scenario.empresaAntesDoEstado && state.empresa.vez > 0) empresaNoReady();
        // (0.2.0) A janela principal na frente, no fim das mensagens do `ready`.
        deliver({ v: 1, type: 'janela', frente: true } satisfies IncomingMessage);
        break;
      case 'chatKey':
        // (0.2.0) A chave guardada, só na resposta ("" e "" fora do chat).
        if (ios || !state.chat) break;
        deliver({ v: 1, type: 'chatChave', chave: chaveDoChat, empresa: chaveDoChat ? state.chat.empresa : '' } satisfies IncomingMessage);
        break;
      case 'chatLink':
        // Como o C++: a chave de 43 caracteres de [A-Za-z0-9_-] e a empresa de 1 a 80, no lugar das de antes.
        if (ios || !state.chat || !CHAVE_DO_CHAT.test(String(command.chave)) || typeof command.empresa !== 'string') break;
        if ([...command.empresa].length < 1 || [...command.empresa].length > 80) break;
        chaveDoChat = String(command.chave);
        change({ chat: { ...state.chat, ligado: true, empresa: command.empresa } });
        break;
      case 'chatUnlink':
        if (ios || !state.chat) break;
        chaveDoChat = '';
        change({ chat: { ...state.chat, ligado: false, empresa: '' } });
        break;
      case 'setVideo': {
        // (0.3.0) A câmera escolhida (uma que não está na lista fica gravada, e `cameraDesconectada` liga) e a chave da
        // pessoa para o H.264 (as outras opções não mudam).
        const v = state.video;
        if (ios || !v) break;
        if (typeof command.camera === 'string') {
          const camera = command.camera;
          mudarVideo((x) => ({ ...x, camera, cameraDesconectada: camera !== '' && !x.cameras.includes(camera) }));
        }
        if (typeof command.h264 === 'boolean') {
          const pessoa = command.h264;
          mudarVideo((x) => comLigado({ ...x, h264: { ...x.h264, pessoa } }));
          acertarH264(pessoa && v.h264.cartao);
        }
        break;
      }
      case 'cameraTest':
        // (0.3.0) Sem câmeras, o motor avisa e o teste fica desligado.
        if (ios || !state.video || typeof command.on !== 'boolean') break;
        if (command.on && state.video.cameras.length === 0) toast(NENHUMA_CAMERA);
        else mudarVideo((v) => ({ ...v, teste: command.on === true }));
        break;
      case 'videoWindow':
        if (ios || !state.video || !['normal', 'grande', 'telaCheia'].includes(String(command.modo))) break;
        mudarVideo((v) => ({ ...v, janela: command.modo as VideoSettings['janela'] }));
        break;
      case 'h264Retry':
        if (state.video?.h264.situacao === 'falhou') baixarH264();
        break;
      case 'videoViews': {
        // A memória de cada vista da página nasce no primeiro `videoViews` que a mostra; uma vista que não é da página
        // (a `principal` tem o `remoto` e o `local`, o `aviso`, o `porteiro`) é ignorada.
        if (ios || !Array.isArray(command.vistas)) break;
        const daPagina: VistaDeVideoNome[] = command.pagina === 'aviso' ? ['porteiro'] : command.pagina === 'principal' ? ['remoto', 'local'] : [];
        for (const vista of daPagina) {
          if (!command.vistas.includes(vista) || memorias.has(vista)) continue;
          const memoria = new ArrayBuffer(TAMANHO_DA_MEMORIA);
          memorias.set(vista, memoria);
          entregarMemoria(memoria, { v: 1, type: 'videoBuffer', vista, bytes: TAMANHO_DA_MEMORIA });
        }
        break;
      }
      case 'noticeHeight':
        // A altura do aviso é do executável: as specs só olham o comando.
        break;
      case 'chatNotify':
      case 'chatBadge':
      case 'chatDownload':
        // O aviso do Windows, o número no ícone e o download são do executável: as specs só olham o comando.
        break;
      case 'importContacts':
      case 'exportContacts':
        // As janelas do Windows e o aviso do resultado são do C++: as specs só olham o comando.
        break;
      case 'allowContacts': {
        // (iPhone) O Permitir: a pessoa deixa, e a agenda de exemplo chega.
        if (!ios) break;
        const vez = vezSeguinte();
        mandarAgenda(vez, AGENDA_DE_EXEMPLO);
        change({ agenda: { permissao: 'concedida', vez, quantos: AGENDA_DE_EXEMPLO.length } });
        break;
      }
      case 'contactsOpened': {
        // (iPhone) A aba Contatos abriu: com a permissão, o hospedeiro lê a agenda de novo (aqui, a mesma lista) e ela vem
        // com a `vez` seguinte. Sem ela, nada: com a pendente, o iPhone pergunta na janela dele, que a ponte falsa não tem
        // (o aviso fica, e o Permitir dá a permissão); com a negada, só os Ajustes do iPhone mudam isso.
        if (!ios || state.agenda?.permissao !== 'concedida') break;
        const vez = vezSeguinte();
        mandarAgenda(vez, agendaAtual.contatos);
        change({ agenda: { ...state.agenda, vez, quantos: agendaAtual.contatos.filter((c) => c.numeros.length > 0).length } });
        break;
      }
      case 'setCompanyList': {
        const link = String(command.link ?? '').trim();
        if (link === '') novaListaDaEmpresa([], { link: '', situacao: 'nenhuma', erro: '', atualizadaEm: 0, quantos: 0 });
        else lerPlanilha(link);
        break;
      }
      case 'refreshCompanyList':
        if (state.empresa.link !== '') lerPlanilha(state.empresa.link);
        break;
      case 'setDnd':
        // Escondido pelo administrador, ligar é recusado (como no C++).
        if (command.on === true && !state.admin.naoPerturbe) break;
        change({ naoPerturbe: command.on === true });
        break;
      case 'setAutoAnswer':
        if (command.on === true && !state.admin.atenderAuto) break;
        change({
          atenderAutomatico: {
            on: command.on === true,
            segundos: typeof command.segundos === 'number' ? Math.min(30, command.segundos) : state.atenderAutomatico.segundos,
          },
        });
        break;
      case 'setSetting':
        if (command.chave === 'iniciarComWindows') change({ iniciarComWindows: command.valor === true });
        else if (command.chave === 'bipeFim') change({ config: { ...state.config, bipeFim: command.valor === true } });
        // (iPhone) O Bipe ao digitar; o Windows o recusa.
        else if (command.chave === 'bipeTecla' && ios) change({ config: { ...state.config, bipeTecla: command.valor === true } });
        break;
      case 'saveShortcut': {
        if (!ACOES.includes(command.acao as ShortcutAction)) break;
        const recusa = recusaDoAtalho(command);
        if (recusa) {
          toast(recusa);
          break;
        }
        const id = typeof command.id === 'string' ? command.id : Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10);
        const atalho: Shortcut = {
          id,
          // Como a loja do C++: só o espaço, o tab e as quebras de linha das pontas saem.
          nome: trimAscii(String(command.nome)),
          numero: trimAscii(String(command.numero)),
          acao: command.acao as ShortcutAction,
          blf: command.blf === true,
          estado: null,
        };
        atalho.estado = estadoDoBlf(atalho, state.admin.blf);
        const existe = state.atalhos.some((a) => a.id === id);
        change({ atalhos: existe ? state.atalhos.map((a) => (a.id === id ? atalho : a)) : [...state.atalhos, atalho] });
        break;
      }
      case 'removeShortcut':
        change({ atalhos: state.atalhos.filter((a) => a.id !== command.id) });
        break;
      case 'useShortcut':
        // O que o atalho faz (e o puxar ligação) é do C++: as specs só olham o comando.
        break;
      case 'adminLogin': {
        const agora = Date.now();
        const vez = state.entrarAdmin.vez + 1;
        // Na espera depois de 5 erradas: recusado, também com a senha certa.
        if (state.entrarAdmin.esperaAte !== 0 && agora < state.entrarAdmin.esperaAte) {
          change({ entrarAdmin: { ...state.entrarAdmin, erro: 'Senha incorreta.', vez } });
          break;
        }
        if (command.senha === SENHA_DE_TESTE) {
          erradas = 0;
          change({ admin: adminAberto(), entrarAdmin: { erro: '', esperaAte: 0, vez } });
          break;
        }
        erradas += 1;
        const espera = erradas >= 5;
        if (espera) erradas = 0;
        change({ entrarAdmin: { erro: 'Senha incorreta.', esperaAte: espera ? agora + 30_000 : 0, vez } });
        break;
      }
      case 'adminLogout':
        change({ admin: { aberto: false, ...visivel() } });
        break;
      case 'adminSet': {
        if (!state.admin.aberto) break;
        if (typeof command.canal === 'string' && !['', 'teste', 'estavel'].includes(command.canal)) {
          toast('Escolha o canal Teste ou Estável.');
          break;
        }
        if (typeof command.codigoPuxar === 'string' && !CODIGO_DE_PUXAR.test(command.codigoPuxar.trim())) {
          toast('O código só pode ter dígitos, *, #, + e {ramal}.');
          break;
        }
        let servidores = guardado.servidores;
        if (command.servidores !== undefined) {
          const gravados = servidoresGravados(command.servidores);
          if (typeof gravados === 'string') {
            toast(gravados);
            break;
          }
          servidores = gravados;
        }
        let porteiros = guardado.porteiros;
        if (command.porteiros !== undefined) {
          const gravados = porteirosGravados(command.porteiros);
          if (typeof gravados === 'string') {
            toast(gravados);
            break;
          }
          porteiros = gravados;
        }
        const naoPerturbe = typeof command.naoPerturbe === 'boolean' ? command.naoPerturbe : state.admin.naoPerturbe;
        const atenderAuto = typeof command.atenderAuto === 'boolean' ? command.atenderAuto : state.admin.atenderAuto;
        const blf = typeof command.blf === 'boolean' ? command.blf : state.admin.blf;
        guardado = {
          puxar: typeof command.puxar === 'boolean' ? command.puxar : guardado.puxar,
          codigoPuxar: typeof command.codigoPuxar === 'string' ? command.codigoPuxar.trim() : guardado.codigoPuxar,
          servidores,
          canal: typeof command.canal === 'string' ? (command.canal as UpdateChannel) : guardado.canal,
          videoH264: typeof command.videoH264 === 'boolean' ? command.videoH264 : guardado.videoH264,
          videoVp8: typeof command.videoVp8 === 'boolean' ? command.videoVp8 : guardado.videoVp8,
          videoVp9: typeof command.videoVp9 === 'boolean' ? command.videoVp9 : guardado.videoVp9,
          // Um codec ou uma qualidade que não existe é ignorado.
          videoPrimeiro: CODECS.find((c) => c === command.videoPrimeiro) ?? guardado.videoPrimeiro,
          videoQualidade: QUALIDADES.find((q) => q === command.videoQualidade) ?? guardado.videoQualidade,
          porteiros,
        };
        // O cartão decide o `ligado` e a chave `cartao` do H.264.
        const h264Antes = state.video?.h264.cartao ?? false;
        mudarVideo((v) => comLigado({ ...v, h264: { ...v.h264, cartao: guardado.videoH264 } }));
        if (state.video && guardado.videoH264 !== h264Antes) acertarH264(guardado.videoH264 && state.video.h264.pessoa);
        change({
          admin: { aberto: true, naoPerturbe, atenderAuto, blf, puxa: puxa(blf), ...guardado },
          // Escondido, o botão fica desligado na hora (e mostrar de novo não liga de volta).
          naoPerturbe: naoPerturbe ? state.naoPerturbe : false,
          atenderAutomatico: atenderAuto ? state.atenderAutomatico : { ...state.atenderAutomatico, on: false },
          atalhos: state.atalhos.map((a) => ({ ...a, estado: estadoDoBlf(a, blf) })),
        });
        break;
      }
      case 'setAudio': {
        const audio = { ...state.audio };
        if (typeof command.microfone === 'string') audio.microfone = command.microfone;
        if (typeof command.altoFalante === 'string') audio.altoFalante = command.altoFalante;
        if (typeof command.toque === 'string') audio.toque = command.toque;
        const nomes = new Set([...audio.microfones, ...audio.altoFalantes].map((d) => d.nome));
        audio.desconectados = [audio.microfone, audio.altoFalante].filter((n) => n !== '' && !nomes.has(n));
        change({ audio });
        break;
      }
      case 'viewRecents':
        change({ perdidas: 0 });
        break;
      case 'selectAccount': {
        const conta = state.contas.find((c) => c.id === command.contaId);
        if (!conta) break;
        change({
          contas: state.contas.map((c) => ({ ...c, emUso: c.id === conta.id })),
          conta: { ...conta, status: 'conectado', texto: `Conectado · ${conta.servidor}`, internet: true },
          // (0.2.0) A conta registrou neste computador: conectada aqui.
          ...(state.chat ? { chat: { ...state.chat, contaConectada: true } } : {}),
        });
        break;
      }
      case 'saveContact': {
        const contato: Contact = {
          id: typeof command.id === 'string' ? command.id : Math.random().toString(16).slice(2, 18),
          nome: String(command.nome ?? ''),
          numero: String(command.numero ?? ''),
          observacao: String(command.observacao ?? ''),
        };
        change({ contatos: sortContacts([...state.contatos.filter((c) => c.id !== contato.id), contato]) });
        break;
      }
      case 'removeContact':
        change({ contatos: state.contatos.filter((c) => c.id !== command.id) });
        break;
      case 'removeAccount':
        // (iPhone) O Sair: a conta em uso sai e volta a tela Entrar (os Recentes ficam).
        if (ios && command.contaId === state.conta?.id) {
          change({ tela: 'entrar', entrar: entrarVazio(), conta: null, contas: [] });
          break;
        }
        change({ contas: state.contas.filter((c) => c.id !== command.contaId) });
        break;
      case 'cancelLogin':
        // A troca para a conta sem senha sai: a conta em uso continua.
        if (state.entrar.podeCancelar) {
          change({
            tela: 'principal',
            entrar: { servidor: '', protocolo: 'udp', ramal: '', nome: '', erro: '', ocupado: false, pedeSenha: false, podeCancelar: false, contaId: '' },
          });
        }
        break;
      case 'login': {
        const servidor = String(command.servidor ?? '');
        const ramal = String(command.ramal ?? '');
        const nome = String(command.nome ?? '');
        const protocolo = command.protocolo === 'tcp' ? 'tcp' : 'udp';
        const contaId = typeof command.contaId === 'string' ? command.contaId : '';
        change({ entrar: { ...state.entrar, servidor, ramal, nome, protocolo, contaId, erro: '', ocupado: true } });
        // O registro demora um pouco; a senha "errada" imita o 401.
        setTimeout(() => {
          if (command.senha === 'errada') {
            change({ entrar: { ...state.entrar, ocupado: false, erro: 'Ramal ou senha incorretos.' } });
            return;
          }
          const id = contaId || Math.random().toString(16).slice(2, 18);
          const salva = { id, nome, ramal, servidor, protocolo, emUso: true } as const;
          const outras = state.contas.filter((c) => c.id !== id).map((c) => ({ ...c, emUso: false }));
          change({
            tela: 'principal',
            entrar: { servidor: '', protocolo: 'udp', ramal: '', nome: '', erro: '', ocupado: false, pedeSenha: false, podeCancelar: false, contaId: '' },
            contas: [...outras, salva],
            conta: { id, nome, ramal, servidor, protocolo, status: 'conectado', texto: `Conectado · ${servidor}`, internet: true },
            // (0.2.0) A conta registrou neste computador: conectada aqui.
            ...(state.chat ? { chat: { ...state.chat, contaConectada: true } } : {}),
          });
        }, 1500);
        break;
      }
      default:
        break;
    }
  };

  const webview: WebviewLike = {
    postMessage(message) {
      const command = structuredClone(message) as Record<string, unknown>;
      sent.push(command);
      handle(command);
    },
    addEventListener(type: string, listener: Listener | OuvinteDeMemoria) {
      if (type === 'sharedbufferreceived') ouvintesDeMemoria.add(listener as OuvinteDeMemoria);
      else listeners.add(listener as Listener);
    },
    removeEventListener(type: string, listener: Listener | OuvinteDeMemoria) {
      if (type === 'sharedbufferreceived') ouvintesDeMemoria.delete(listener as OuvinteDeMemoria);
      else listeners.delete(listener as Listener);
    },
    releaseBuffer(buffer) {
      liberadas += 1;
      // Como o WebView2: a memória solta fica "detached" na página, e cada acesso a ela dá um TypeError.
      structuredClone(buffer, { transfer: [buffer] });
    },
  };
  return { webview, view: scenario.view };
}
