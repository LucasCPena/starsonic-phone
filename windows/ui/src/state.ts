// Os tipos da ponte, versão 1 (docs/ponte-windows.md). Uma mudança no formato muda o documento, o
// starsonic/desktop/Protocol.cpp e este arquivo juntos. A interface só desenha este estado e manda comandos.

export const PROTOCOL_VERSION = 1;

export type Protocol = 'udp' | 'tcp';
export type Screen = 'entrar' | 'principal';
export type AccountStatus = 'conectado' | 'conectando' | 'sem_conexao' | 'erro';
export type RecentKind = 'feita' | 'recebida' | 'perdida';
export type CallPhase = 'ringing' | 'dialing' | 'active';
export type SecondKind = 'none' | 'ringing' | 'held' | 'active';
/** `fim` (rc.3): o bipe do fim da ligação, uma vez (não muda o toque de agora e não volta no `ready`). */
export type RingKind = 'completo' | 'espera' | 'parar' | 'fim';
/** rc.3: o que o atalho faz (Ligar, Transferir, Transferir com consulta, Enviar teclas). */
export type ShortcutAction = 'ligar' | 'transferir' | 'consulta' | 'teclas';
/** rc.3: o BLF do ramal de um atalho. */
export type BlfState = 'livre' | 'tocando' | 'ocupado' | 'desconectado';
/** rc.3: o canal de atualização ("" = o do build). */
export type UpdateChannel = 'teste' | 'estavel' | '';
/** (iPhone) O modo iPhone (docs/ponte-windows.md, "O modo iPhone"). Sem `plataforma` no estado, a interface é a do Windows. */
export type Platform = 'ios';
/** (iPhone) O acesso aos contatos da agenda: ainda não perguntado, negado ou dado. */
export type AgendaPermission = 'pendente' | 'negada' | 'concedida';

/** (iPhone) A agenda no estado; os contatos vêm na mensagem `agenda`. */
export interface AgendaSummary {
  permissao: AgendaPermission;
  /** Sobe a cada lista nova: é a `vez` da última mensagem `agenda` (0 sem nenhuma desde a abertura do app). */
  vez: number;
  /** Os contatos da última lista. */
  quantos: number;
}

/** (0.2.0, só no Windows) O chat deste computador no estado. A chave nunca vem aqui: só na mensagem `chatChave`. */
export interface ChatSummary {
  /** Há uma chave guardada: o computador está ligado ao chat. */
  ligado: boolean;
  /** O nome da empresa guardado com a chave, ou "". */
  empresa: string;
  /** O nome do computador no Windows. */
  computador: string;
  /** A conta em uso já se conectou à central neste computador (pelo par servidor|ramal); false sem conta em uso. */
  contaConectada: boolean;
}

/** (iPhone) Um contato da agenda do iPhone (a mensagem `agenda`): só para ver e ligar. */
export interface AgendaContact {
  /** Pode ser "" (a interface mostra o primeiro número). */
  nome: string;
  /** Na ordem da agenda, sem os repetidos; nunca vazia (o contato sem número fica de fora). */
  numeros: string[];
}

/** A tela Entrar (também Adicionar e Editar conta). A senha nunca vem. */
export interface LoginForm {
  servidor: string;
  protocolo: Protocol;
  ramal: string;
  nome: string;
  /** A mensagem embaixo da senha ("" = nenhuma). */
  erro: string;
  /** Esperando o registro (ou o fim da ligação): "Conectando…", campos travados. */
  ocupado: boolean;
  /** A conta veio sem a senha: os campos vêm preenchidos e só falta a senha. */
  pedeSenha: boolean;
  /** A senha de uma troca de conta: o Cancelar (cancelLogin) volta para a conta em uso. */
  podeCancelar: boolean;
  /** A conta que a tela edita ("" = conta nova). */
  contaId: string;
}

/** A conta em uso (o cabeçalho). */
export interface CurrentAccount {
  id: string;
  /** Pode ser "" (a interface mostra o ramal). */
  nome: string;
  ramal: string;
  servidor: string;
  protocolo: Protocol;
  status: AccountStatus;
  /** A linha do cabeçalho; pode ser "" com sem_conexao. */
  texto: string;
  /** (rc.3) O executável vê a internet (`true` até ele dizer o contrário). `false` vem antes de tudo na bolinha. */
  internet: boolean;
}

export interface SavedAccount {
  id: string;
  nome: string;
  ramal: string;
  servidor: string;
  protocolo: Protocol;
  emUso: boolean;
}

export interface AutoAnswer {
  on: boolean;
  /** De 0 a 30. */
  segundos: number;
}

/** (0.3.0, só no Windows) O vídeo de uma ligação (os campos `offered`, `active`, `remote`, `camera`, `early` e `doorphone` do CallVideo). */
export interface CallVideo {
  /** A recebida oferece vídeo com um codec em comum. */
  oferece: boolean;
  /** O vídeo negociado e a ligação sem pausa. */
  ativo: boolean;
  /** A imagem da outra ponta está chegando. */
  imagem: boolean;
  /** A nossa câmera está mandando. */
  camera: boolean;
  /** O 183 com imagem de um Porteiro, até o atender ou o fim. */
  cedo: boolean;
  /**
   * (0.3.0-rc.2) A recebida de um número dos Porteiros que oferece vídeo com um codec em comum, do toque ao fim, também
   * depois de atender: com outra ligação, a imagem dele segue à vista, só chegando (a decisão do responsável de
   * 11/11/2026).
   */
  porteiro: boolean;
}

/** (0.3.0) O módulo H.264 da Cisco. */
export type H264Situacao = 'desligado' | 'baixando' | 'instalado' | 'falhou';
/** (0.3.0) O modo da janela do vídeo. */
export type VideoJanela = 'normal' | 'grande' | 'telaCheia';
export type CodecDeVideo = 'h264' | 'vp8' | 'vp9';
export type QualidadeDeVideo = 'baixa' | 'media' | 'alta';
/** (0.3.0) As vistas de vídeo: o `remoto` e o `local` são da página principal, o `porteiro` é do aviso. */
export type VistaDeVideoNome = 'remoto' | 'local' | 'porteiro';
export type PaginaDeVideo = 'principal' | 'aviso';

/** (0.3.0) O bloco `video` do estado: as escolhas do vídeo, a câmera e o módulo H.264. */
export interface VideoSettings {
  ligado: boolean;
  cameras: string[];
  /** A câmera escolhida; "" é a primeira. */
  camera: string;
  cameraDesconectada: boolean;
  teste: boolean;
  h264: { cartao: boolean; pessoa: boolean; situacao: H264Situacao };
  janela: VideoJanela;
}

/** Um cartão da tela da ligação (os nomes do CallSnapshot do C++). */
export interface CallCard {
  /** O id da ligação no motor; 0 numa feita que ainda não tem id. */
  id: number;
  number: string;
  /** Já resolvido; "" sem contato nem nome da central (a interface mostra o número). */
  name: string;
  incoming: boolean;
  phase: CallPhase;
  /** ms desde 1970; 0: ainda não atendida. */
  activeSinceMs: number;
  held: boolean;
  /** (0.3.0) Sempre vem do núcleo; o `?` protege o estado montado à mão nos testes de antes. */
  video?: CallVideo;
}

/** (0.4.0) O estado de um convidado na sala. */
export type EstadoNaSala = 'chamando' | 'naSala' | 'emEspera';

/** (0.4.0) O quadro do convidado no mosaico do `remoto`, em frações de 0 a 1 da imagem. */
export interface QuadroDaSala {
  /** O canto de cima à esquerda. */
  x: number;
  y: number;
  largura: number;
  altura: number;
}

/** (0.4.0) Um convidado da sala (não é uma linha da tela). */
export interface ParticipanteDaSala {
  /** O id da ligação dele no motor (o do `salaTirar`). */
  id: number;
  numero: string;
  /** Já resolvido, como nos cartões; "" sem nenhum (a interface mostra o número). */
  nome: string;
  estado: EstadoNaSala;
  /** A imagem dele está chegando (sem ela, o quadro dele fica com o fundo). */
  imagem: boolean;
  quadro: QuadroDaSala;
}

/** (0.4.0) A sala de vídeo em grupo (docs/ponte-windows.md, "O ligacao.sala"). */
export interface SalaDaLigacao {
  /** O id da linha da sala (`top.id`, ou `second.id` com você fora). */
  id: number;
  /** Você está fora da sala (a ligação de fora): a nossa voz e a nossa câmera saíram dela. */
  fora: boolean;
  /** 5 convidados, contando os chamados: o `salaAdicionar` não faz nada. */
  cheia: boolean;
  /** Na ordem em que entraram; o primeiro é a ligação de onde a sala nasceu. Quem monta não está na lista. */
  participantes: ParticipanteDaSala[];
}

export interface CallState {
  top: CallCard;
  second: CallCard | null;
  /** Na conferência a outra vem como "active": a interface olha `conference` antes de `secondKind`. */
  secondKind: SecondKind;
  muted: boolean;
  conference: boolean;
  conferenceSinceMs: number;
  consulting: boolean;
  colleagueActive: boolean;
  /**
   * (0.4.0) A sala de pé (em cima ou em espera), ou `null`. Sempre vem do núcleo; o `?` protege o estado montado à mão
   * nos testes de antes.
   */
  sala?: SalaDaLigacao | null;
}

export interface RecentCall {
  numero: string;
  /** Já resolvido; "" = a interface mostra o número. */
  nome: string;
  tipo: RecentKind;
  /** ms desde 1970. */
  inicio: number;
  /** Desde o atendimento, em milissegundos (0 na perdida e na feita que não completou). */
  duracao: number;
  /** O contato com esse número ("" = nenhum: a linha oferece "Salvar contato"). */
  contatoId: string;
}

export interface Contact {
  id: string;
  nome: string;
  numero: string;
  observacao: string;
}

/** (rc.4) Um contato da lista da empresa (a mensagem contatosEmpresa): sem id, muda só na planilha. */
export interface CompanyContact {
  nome: string;
  numero: string;
  observacao: string;
}

/** (rc.4) A leitura da planilha da empresa: sem link, lendo, a última foi boa ou falhou. */
export type CompanyListStatus = 'nenhuma' | 'lendo' | 'ok' | 'erro';

/** (rc.4) A planilha da empresa (Configurações → Contatos). Os contatos vêm na mensagem contatosEmpresa. */
export interface CompanyList {
  /** O texto salvo (setCompanyList), sem os espaços das pontas; "" sem a lista da empresa. */
  link: string;
  situacao: CompanyListStatus;
  /** Com `situacao` "erro", o texto que a interface mostra como está; "" fora do erro. */
  erro: string;
  /** A hora da última leitura boa (ms desde 1970); 0 sem nenhuma. */
  atualizadaEm: number;
  /** Os contatos da lista de agora (a da última leitura boa). */
  quantos: number;
  /** Sobe a cada lista nova: é a `vez` da última contatosEmpresa. */
  vez: number;
}

export interface AudioDevice {
  /** Só da lista de agora: a escolha vai pelo nome. */
  id: number;
  nome: string;
}

export interface AudioSettings {
  microfones: AudioDevice[];
  altoFalantes: AudioDevice[];
  /** O nome escolhido ("" = o padrão do Windows). */
  microfone: string;
  altoFalante: string;
  /** O deviceId do toque, da interface ("" = o padrão). */
  toque: string;
  /** Os nomes escolhidos que não estão conectados agora. */
  desconectados: string[];
}

/** (rc.3) Um atalho: até 8, na ordem em que foram incluídos. */
export interface Shortcut {
  id: string;
  nome: string;
  numero: string;
  acao: ShortcutAction;
  /** A chave "Mostrar se o ramal está livre" do atalho. */
  blf: boolean;
  /** O BLF do ramal; null sem o `blf` do atalho ou sem o BLF do administrador. */
  estado: BlfState | null;
}

/** (rc.3) Um servidor da tabela de portas do administrador (UDP e TCP). */
export interface AdminServer {
  endereco: string;
  porta: number;
}

/** O que a interface precisa da área do administrador também com ela fechada: esconder os botões e o BLF. */
interface AdminVisible {
  /** O botão Não perturbe aparece (false: escondido, e desligado). */
  naoPerturbe: boolean;
  /** O botão Atender automático aparece (false: escondido, e desligado). */
  atenderAuto: boolean;
  /** O BLF nos atalhos. */
  blf: boolean;
  /** O clique num atalho com o BLF `tocando` puxa a ligação: o BLF, o puxar e um código ligados (não é sensível). */
  puxa: boolean;
}

/** (rc.3) A área do administrador: completa só com `aberto`. */
export type AdminState =
  | ({ aberto: false } & AdminVisible)
  | ({
      aberto: true;
      puxar: boolean;
      codigoPuxar: string;
      servidores: AdminServer[];
      canal: UpdateChannel;
      /** (0.3.0) O cartão Vídeo. */
      videoH264: boolean;
      videoVp8: boolean;
      videoVp9: boolean;
      videoPrimeiro: CodecDeVideo;
      videoQualidade: QualidadeDeVideo;
      porteiros: string[];
    } & AdminVisible);
export type AdminAberto = Extract<AdminState, { aberto: true }>;

/** (rc.3) O resultado do último adminLogin. */
export interface AdminLoginResult {
  /** "Senha incorreta." ou "" (o da última tentativa). */
  erro: string;
  /** Até quando (ms desde 1970) o adminLogin é recusado; 0 sem espera. */
  esperaAte: number;
  /** Sobe a cada adminLogin respondido: só quando ela muda o `erro` vale para a tentativa que a interface mandou. */
  vez: number;
}

export interface AppState {
  tela: Screen;
  entrar: LoginForm;
  conta: CurrentAccount | null;
  contas: SavedAccount[];
  naoPerturbe: boolean;
  atenderAutomatico: AutoAnswer;
  ligacao: CallState | null;
  /** A mais nova primeiro. */
  recentes: RecentCall[];
  perdidas: number;
  /** Em ordem alfabética (sem acento e sem caixa). */
  contatos: Contact[];
  audio: AudioSettings;
  iniciarComWindows: boolean;
  versao: string;
  teclado: string;
  tecladoVez: number;
  /** (rc.3) */
  atalhos: Shortcut[];
  admin: AdminState;
  entrarAdmin: AdminLoginResult;
  /** `bipeTecla` (iPhone): o "Bipe ao digitar". */
  config: { bipeFim: boolean; bipeTecla?: boolean };
  /** (rc.4) */
  empresa: CompanyList;
  /** (0.2.0) Só no Windows: o estado do iPhone vem sem o campo. */
  chat?: ChatSummary;
  /** (0.3.0) As escolhas do vídeo; sempre vem do núcleo (neutro no iPhone), o `?` protege o estado montado à mão. */
  video?: VideoSettings;
  /** (iPhone) Os campos abaixo só vêm no modo iPhone. */
  plataforma?: Platform;
  agenda?: AgendaSummary;
  /** A saída de som de agora: "iPhone", "Viva-voz" ou o nome do fone; "" sem saber. */
  rotaAudio?: string;
}

/** C++ → interface. */
export type IncomingMessage =
  | { v: number; type: 'state'; state: AppState }
  | { v: number; type: 'toast'; texto: string }
  | { v: number; type: 'ring'; tipo: RingKind }
  | { v: number; type: 'update'; versao: string; notas: string }
  /** (rc.4) A lista da empresa inteira, na ordem da planilha: no `ready` (com `vez` > 0) e a cada lista nova. Fica a de
   *  `vez` mais alta; ela pode chegar antes do `state` com essa `vez`. */
  | { v: number; type: 'contatosEmpresa'; vez: number; contatos: CompanyContact[] }
  /** (iPhone) A agenda do iPhone inteira: no `ready` (com `vez` > 0) e a cada lista nova. Fica a de `vez` mais alta,
   *  como na contatosEmpresa. */
  | { v: number; type: 'agenda'; vez: number; contatos: AgendaContact[] }
  /** (iPhone) A pessoa tocou no aviso da perdida: a interface vai para os Recentes. */
  | { v: number; type: 'abrir'; tela: 'recentes' }
  /** (0.2.0) A resposta ao `chatKey`: "" e "" com o computador fora do chat. A chave nunca vem no estado. */
  | { v: number; type: 'chatChave'; chave: string; empresa: string }
  /** (0.2.0) A janela principal está na frente (visível, sem minimizar e ativa, com a sessão do Windows desbloqueada e
   *  conectada): depois do estado a cada `ready` e a cada mudança. Antes da primeira, `false`. */
  | { v: number; type: 'janela'; frente: boolean }
  /** (0.2.0) A pessoa clicou no aviso do chat: a conversa dele (0: a aba Chat). */
  | { v: number; type: 'abrir'; tela: 'chat'; conversa: number };

/** Interface → C++ (sem o `v`, que a ponte acrescenta). */
export type Command =
  | { cmd: 'ready' }
  | { cmd: 'minimize' }
  | { cmd: 'closeToTray' }
  | { cmd: 'quit' }
  | { cmd: 'sendDiagnostics' }
  | { cmd: 'openExternal'; url: ExternalUrl }
  | {
      cmd: 'login';
      servidor: string;
      protocolo: Protocol;
      ramal: string;
      senha: string;
      nome?: string;
      contaId?: string;
    }
  | { cmd: 'selectAccount'; contaId: string }
  | { cmd: 'removeAccount'; contaId: string }
  | { cmd: 'dial'; numero: string; contato?: boolean; video?: boolean }
  | { cmd: 'answer'; video?: boolean }
  | { cmd: 'reject' }
  | { cmd: 'hangup'; id?: number }
  | { cmd: 'hold'; on?: boolean }
  | { cmd: 'mute'; on?: boolean }
  | { cmd: 'dtmf'; digitos: string }
  /** `contato`: o número de um contato, com a regra dos contatos, como no `dial` (o de uma sugestão do Transferir). */
  | { cmd: 'transfer'; numero: string; contato?: boolean }
  | { cmd: 'consult'; numero: string; contato?: boolean }
  | { cmd: 'completeTransfer' }
  | { cmd: 'cancelConsult' }
  | { cmd: 'swap' }
  | { cmd: 'join' }
  | { cmd: 'split' }
  | { cmd: 'setDnd'; on: boolean }
  | { cmd: 'setAutoAnswer'; on: boolean; segundos?: number }
  | { cmd: 'setAudio'; microfone?: string; altoFalante?: string; toque?: string }
  /** `bipeTecla` só no modo iPhone (o Windows recusa). */
  | { cmd: 'setSetting'; chave: 'iniciarComWindows' | 'bipeFim' | 'bipeTecla'; valor: boolean }
  | { cmd: 'saveContact'; id?: string; nome: string; numero: string; observacao?: string }
  | { cmd: 'removeContact'; id: string }
  | { cmd: 'viewRecents' }
  | { cmd: 'updateNow' }
  | { cmd: 'updateLater' }
  | { cmd: 'cancelLogin' }
  /** rc.2: a interface pegou uma zona de redimensionar (o C++ começa o redimensionar do Windows). */
  | { cmd: 'resize'; borda: 'cima' | 'cima-esquerda' | 'cima-direita' | 'baixo-direita' }
  /** rc.3: os atalhos (sem `id`, um novo) e a área do administrador. */
  | { cmd: 'saveShortcut'; id?: string; nome: string; numero: string; acao: ShortcutAction; blf: boolean }
  | { cmd: 'removeShortcut'; id: string }
  | { cmd: 'useShortcut'; id: string }
  | { cmd: 'adminLogin'; senha: string }
  | { cmd: 'adminLogout' }
  | {
      cmd: 'adminSet';
      naoPerturbe?: boolean;
      atenderAuto?: boolean;
      blf?: boolean;
      puxar?: boolean;
      codigoPuxar?: string;
      servidores?: AdminServer[];
      canal?: UpdateChannel;
      /** (0.3.0) O cartão Vídeo. */
      videoH264?: boolean;
      videoVp8?: boolean;
      videoVp9?: boolean;
      videoPrimeiro?: CodecDeVideo;
      videoQualidade?: QualidadeDeVideo;
      porteiros?: string[];
    }
  /** rc.4: Importar e Exportar planilha (as janelas do Windows; o resultado vem num toast) e a planilha da empresa
   *  (`link` "" tira a lista; "Atualizar agora" lê de novo). */
  | { cmd: 'importContacts' }
  | { cmd: 'exportContacts' }
  | { cmd: 'setCompanyList'; link: string }
  | { cmd: 'refreshCompanyList' }
  /** (iPhone; o Windows recusa) A aba Contatos abriu; o Permitir do aviso dela; o botão Áudio da ligação; o bipe de uma
   *  tecla (`0-9`, `*` ou `#`), só com `config.bipeTecla`. */
  | { cmd: 'contactsOpened' }
  | { cmd: 'allowContacts' }
  | { cmd: 'audioRoute' }
  | { cmd: 'keyTone'; tecla: string }
  /** (0.2.0; o iPhone recusa) O chat: pedir a chave (a resposta vem na `chatChave`), ligar e desligar o computador, o
   *  aviso do Windows (`conversa` 0: o clique abre a aba Chat), o número no ícone da barra de tarefas e o download de
   *  um arquivo com a chave guardada. Os limites são do docs/ponte-windows.md ("Os comandos do chat"). */
  | { cmd: 'chatKey' }
  | { cmd: 'chatLink'; chave: string; empresa: string }
  | { cmd: 'chatUnlink' }
  | { cmd: 'chatNotify'; conversa: number; titulo: string; texto: string }
  | { cmd: 'chatBadge'; n: number }
  | { cmd: 'chatDownload'; arquivo: string; nome: string }
  /** (0.3.0; o iPhone recusa) O vídeo: a nossa câmera na ligação, a câmera e o H.264 das Configurações, o teste da câmera,
   *  as vistas à vista de cada página, o modo da janela, o novo download do H.264 e a altura do aviso. */
  | { cmd: 'camera'; on: boolean }
  | { cmd: 'setVideo'; camera?: string; h264?: boolean }
  | { cmd: 'cameraTest'; on: boolean }
  | { cmd: 'videoViews'; pagina: PaginaDeVideo; vistas: VistaDeVideoNome[] }
  | { cmd: 'videoWindow'; modo: VideoJanela }
  | { cmd: 'h264Retry' }
  | { cmd: 'noticeHeight'; altura: number }
  /** (0.4.0; o iPhone recusa) A sala: o Adicionar à sala (`contato`: o número de um contato, com a regra dos contatos,
   *  como no `dial`), o Tirar da sala (o `id` de um convidado), o Encerrar a sala e o Voltar para a sala. */
  | { cmd: 'salaAdicionar'; numero: string; contato?: boolean }
  | { cmd: 'salaTirar'; id: number }
  | { cmd: 'salaEncerrar' }
  | { cmd: 'salaVoltar' };

/**
 * Os únicos endereços que o openExternal aceita. O `suporte` (o discador do iPhone) só vale no modo iPhone: no Windows o
 * app é o tratador do tel:, e o C++ o recusa.
 */
export const EXTERNAL_URLS = {
  site: 'https://starsonic.com.br',
  whatsapp: 'https://wa.me/551150603000',
  codigo: 'https://github.com/LucasCPena/starsonic-phone',
  suporte: 'tel:+551150603000',
} as const;
export type ExternalUrl = (typeof EXTERNAL_URLS)[keyof typeof EXTERNAL_URLS] | 'https://starsonic.com.br/';
