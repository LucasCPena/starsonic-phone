// O cérebro da página da reunião: uma máquina de estados pura. A transicao(estado, evento) devolve o estado novo e os
// efeitos, sem tocar no DOM, na rede ou no relógio; o pagina.js roda os efeitos e devolve os resultados como eventos.
// Ela nunca muda o estado que recebe: cada passo devolve um objeto novo.
//
// O estado leva o acesso do aceito (com as credenciais do TURN) e, por um instante, a senha que chegou antes da mídia;
// os efeitos levam o bilhete e as senhas. Nenhum texto daqui os leva, e o pagina.js não escreve o estado nem os efeitos
// no console.

/** O passo da contagem do 429 ("Tentar de novo em <n> s"), em ms. */
export const CONTAGEM_MS = 1000;
/** A espera antes de cada tentativa de voltar à reunião depois da conexão caída, em ms. */
export const RECONECTAR_MS = [2000, 4000, 8000];
/** A espera por um tirado ou um encerrada depois de a ligação terminar sem aviso, antes do saiu, em ms. */
export const FIM_SEM_AVISO_MS = 2000;
/** A espera antes de abrir de novo depois do 1011 do canal, em ms. */
export const REABRIR_MS = 3000;
/** As tentativas de voltar depois da conexão caída: 3, uma por espera. */
export const MAX_RECONECTAR = RECONECTAR_MS.length;
/** As aberturas de novo depois de um 1011, antes do aceito. */
export const MAX_REABRIR = 3;

const MAX_NOME = 80;

// As telas da espera: o pedido saiu, e a página espera a resposta.
const ESPERA = new Set(['pedindo', 'aguardando', 'naoComecou']);
// Os avisos com o "Tentar de novo".
const DE_NOVO = new Set(['cheia', 'esperaCheia', 'servidorCheio', 'semServidor', 'tentativas']);

const ABRIR = Object.freeze({ tipo: 'abrir' });
const FECHAR_CANAL = Object.freeze({ tipo: 'fecharCanal' });
const PEDIR_MIDIA = Object.freeze({ tipo: 'pedirMidia' });
const PARAR_MIDIA = Object.freeze({ tipo: 'pararMidia' });
const PARAR_CAPTURA = Object.freeze({ tipo: 'pararCaptura' });
const FOCAR = Object.freeze({ tipo: 'focar' });
const mandar = (m) => ({ tipo: 'mandar', m });
const ligar = (qual, senha) => ({ tipo: 'ligar', qual, senha });
const desligar = (qual) => ({ tipo: 'desligar', qual });
const esperar = (ms, chave) => ({ tipo: 'esperar', ms, chave });
const pedido = (e) => mandar({ tipo: 'pedir', nome: e.nome.trim() });

// com: o estado com as mudanças, e os efeitos. so: os efeitos, com o mesmo estado.
const com = (estado, mudancas, ...efeitos) => ({ estado: { ...estado, ...mudancas }, efeitos });
const so = (estado, ...efeitos) => ({ estado, efeitos });
const nada = (estado) => so(estado);

/** O estado do começo: a tela carregando, antes do abrir. */
export function inicial() {
  return {
    tela: 'carregando', // carregando, entrada, pedindo, aguardando, naoComecou, entrando, reuniao ou aviso
    aviso: null, // com a tela aviso, um dos 10 avisos
    esperarSegundos: 0, // a contagem do aviso tentativas
    reuniao: null, // a reuniao do abrir: {tipo, assunto, inicio}
    nome: '', // como a pessoa digitou; o pedir leva sem os espaços das pontas
    nomeRecusado: false,
    mic: 'ligado', // ligado, desligado ou indisponivel
    cam: 'ligado',
    canal: 'fechado', // fechado, abrindo ou aberto
    aceito: false,
    acesso: null, // o turn e o video do aceito
    telaCompartilhada: 'nenhuma', // nenhuma, pedindo (a senha), ligando ou noAr
    reconectando: 0, // a tentativa de voltar depois da conexão caída, de 0 a 3
    senhaRepetida: false, // o 403 da principal já pediu outra senha
    reabrindo: 0, // as aberturas de novo depois de um 1011, de 0 a 3
    // Os de dentro, que a página não desenha:
    principal: 'nenhuma', // a ligação principal: nenhuma, pedindo (a senha), ligando ou noAr
    esperandoMidia: false, // o pedirMidia saiu, e o midia ainda não chegou
    senhaGuardada: null, // a senha que chegou antes da mídia: o ligar espera as duas
  };
}

/** Um passo: devolve {estado, efeitos}, sem mudar o estado recebido. */
export function transicao(estado, evento) {
  let r;
  switch (evento.tipo) {
    case 'comecar':
      r = estado.tela === 'carregando' ? so(estado, ABRIR) : nada(estado);
      break;
    case 'abriu':
      r = abriu(estado, evento);
      break;
    case 'abrirFalhou':
      r = abrirFalhou(estado, evento);
      break;
    case 'canalAbriu':
      r = estado.canal === 'abrindo' ? com(estado, { canal: 'aberto' }, pedido(estado)) : nada(estado);
      break;
    case 'canalFechou':
      r = canalFechou(estado, evento.codigo);
      break;
    case 'mensagem':
      r = estado.canal === 'aberto' ? mensagem(estado, evento.m ?? {}) : nada(estado);
      break;
    case 'clique':
      r = clique(estado, evento.botao);
      break;
    case 'nome':
      r = estado.tela === 'entrada' ? com(estado, { nome: evento.valor, nomeRecusado: false }) : nada(estado);
      break;
    case 'midia':
      r = midia(estado, evento);
      break;
    case 'ligacao':
      r = evento.qual === 'tela' ? ligacaoDaTela(estado, evento.o) : ligacaoPrincipal(estado, evento.o, evento.codigo);
      break;
    case 'telaCapturada':
      r = telaCapturada(estado, evento.ok);
      break;
    case 'cameraTrocada':
      r = evento.ok ? nada(estado) : com(estado, { cam: contrario(estado.cam) });
      break;
    case 'tempo':
      r = tempo(estado, evento.chave);
      break;
    default:
      r = nada(estado);
  }
  // A tela nova, ou o aviso novo, leva o foco ao título dela.
  if (r.estado.tela !== estado.tela || r.estado.aviso !== estado.aviso) r.efeitos.push(FOCAR);
  return r;
}

// O abrir de um pedido (o do clique, o do Tentar de novo, o do Entrar de novo e o do 1011) roda com o canal fechado.
const esperaOAbrir = (e) => !e.aceito && ESPERA.has(e.tela) && e.canal === 'fechado';
// A principal espera uma senha pelo canal.
const esperaSenha = (e) => e.principal === 'pedindo' && e.senhaGuardada === null;
const contrario = (v) => (v === 'ligado' ? 'desligado' : v === 'desligado' ? 'ligado' : v);

// O abriu do carregar dá o cabeçalho e pede a mídia. O do pedido abre o canal com o bilhete novo, que não fica no
// estado.
function abriu(e, { reuniao, bilhete }) {
  if (e.tela === 'carregando') return com(e, { tela: 'entrada', reuniao, esperandoMidia: true }, PEDIR_MIDIA);
  if (esperaOAbrir(e)) return com(e, { reuniao, canal: 'abrindo' }, { tipo: 'abrirCanal', bilhete });
  return nada(e);
}

// O 404 é o link que não vale; o 429 conta até poder tentar de novo; o resto (a rede, o 5xx) é o semServidor.
function abrirFalhou(e, { status, esperarSegundos }) {
  if (e.tela !== 'carregando' && !esperaOAbrir(e)) return nada(e);
  if (status === 404) return terminar(e, 'linkInvalido');
  if (status !== 429) return avisar(e, 'semServidor');
  const n = Math.max(0, Math.ceil(Number(esperarSegundos) || 0));
  if (n === 0) return avisar(e, 'tentativas');
  return avisar(e, 'tentativas', { esperarSegundos: n }, esperar(CONTAGEM_MS, 'contagem'));
}

// Na espera, o pedido sai com o canal: o 1011 (um erro do servidor) abre de novo sozinho, até 3 vezes, e o resto é o
// semServidor. Depois do aceito, o canal que cai não tira ninguém da reunião; só o que esperava uma senha por ele (para
// entrar, ou para voltar depois da conexão caída) não tem mais como.
function canalFechou(e, codigo) {
  if (e.canal === 'fechado') return nada(e); // o que a página fechou
  const f = { ...e, canal: 'fechado' };
  if (!e.aceito && ESPERA.has(e.tela)) {
    if (codigo === 1011 && e.reabrindo < MAX_REABRIR) {
      return com(f, { reabrindo: e.reabrindo + 1 }, esperar(REABRIR_MS, 'reabrir'));
    }
    return avisar(f, 'semServidor');
  }
  if (esperaSenha(e) || (e.principal === 'nenhuma' && e.reconectando > 0)) {
    return e.tela === 'reuniao' ? terminar(f, 'saiu') : avisar(f, 'semServidor');
  }
  if (e.telaCompartilhada === 'pedindo') return com(f, { telaCompartilhada: 'nenhuma' }, PARAR_CAPTURA);
  return nada(f);
}

// As mensagens do servidor (seção 10 do protocolo).
function mensagem(e, m) {
  const naEspera = !e.aceito && ESPERA.has(e.tela);
  switch (m.tipo) {
    case 'naoComecou':
    case 'aguardando':
      return naEspera ? com(e, { tela: m.tipo }) : nada(e);
    case 'aceito':
      if (!naEspera) return nada(e);
      return comSenha(e, m.senha, {
        tela: 'entrando',
        aceito: true,
        acesso: { turn: m.turn, video: m.video },
        senhaRepetida: false,
      });
    case 'senha':
      return esperaSenha(e) ? comSenha(e, m.senha) : nada(e);
    case 'tela':
      if (e.telaCompartilhada !== 'pedindo') return nada(e);
      return com(e, { telaCompartilhada: 'ligando' }, ligar('tela', m.senha));
    case 'recusado':
      return terminar(e, 'naoFoiPossivel');
    case 'linkInvalido':
    case 'tirado':
    case 'encerrada':
      return terminar(e, m.tipo);
    case 'cheia':
    case 'esperaCheia':
    case 'servidorCheio':
    case 'semServidor':
      return naEspera || esperaSenha(e) ? avisar(e, m.tipo) : nada(e);
    case 'erro':
      return erro(e, m.erro);
    default:
      return nada(e);
  }
}

// A senha da principal chegou: liga, ou a guarda até a mídia chegar.
function comSenha(e, senha, mudancas = {}) {
  if (e.esperandoMidia) return com(e, { ...mudancas, principal: 'pedindo', senhaGuardada: senha });
  return com(e, { ...mudancas, principal: 'ligando' }, ligar('principal', senha));
}

// O erro responde ao que a página pediu: a tela, uma senha ou o pedir. O pedir com o nome recusado volta à entrada, e o
// canal dele fecha: o próximo Pedir abre outro, com um bilhete novo.
function erro(e, qual) {
  if (e.telaCompartilhada === 'pedindo') return com(e, { telaCompartilhada: 'nenhuma' }, PARAR_CAPTURA);
  if (esperaSenha(e)) return e.reconectando > 0 ? tentativaFalhou(e) : avisar(e, 'semServidor');
  if (e.tela !== 'pedindo') return nada(e);
  if (qual === 'invalido') return com(e, { tela: 'entrada', nomeRecusado: true, canal: 'fechado' }, FECHAR_CANAL);
  return avisar(e, 'semServidor');
}

// A ligação principal. Os eventos de uma ligação que a página desligou chegam com a principal em nenhuma, e ficam de
// fora.
function ligacaoPrincipal(e, o, codigo) {
  if (e.principal === 'ligando') {
    if (o === 'confirmada') {
      return com(e, { tela: 'reuniao', principal: 'noAr', reconectando: 0, senhaRepetida: false });
    }
    if (e.reconectando > 0) return tentativaFalhou(e);
    // A senha pode ter vencido no caminho: o primeiro 403 pede outra.
    if (o === 'falhou' && codigo === 403 && !e.senhaRepetida && e.canal === 'aberto') {
      return com(e, { principal: 'pedindo', senhaRepetida: true }, mandar({ tipo: 'senha' }));
    }
    return avisar(e, 'semServidor');
  }
  if (e.principal !== 'noAr') return nada(e);
  if (o === 'semConexao') {
    // A conexão caiu: as duas descem, e a página volta com uma senha nova. Sem o canal, não há senha.
    if (e.canal !== 'aberto') return terminar(e, 'saiu');
    const { mudancas, efeitos } = desligarAsDuas(e);
    return com(e, { ...mudancas, reconectando: 1 }, ...efeitos, esperar(RECONECTAR_MS[0], 'reconectar'));
  }
  // O servidor terminou a ligação: um tirado ou um encerrada pode chegar logo depois; sem ele, é o saiu.
  if (o === 'terminou') return com(e, { principal: 'nenhuma' }, esperar(FIM_SEM_AVISO_MS, 'fimSemAviso'));
  return nada(e);
}

// Uma tentativa de voltar falhou: a próxima espera mais; depois da terceira, a pessoa saiu.
function tentativaFalhou(e) {
  if (e.reconectando >= MAX_RECONECTAR) return terminar(e, 'saiu');
  const espera = esperar(RECONECTAR_MS[e.reconectando], 'reconectar');
  return com(e, { principal: 'nenhuma', reconectando: e.reconectando + 1 }, espera);
}

// A ligação da tela compartilhada. A que falhou, terminou ou perdeu a conexão acaba com a captura.
function ligacaoDaTela(e, o) {
  const s = e.telaCompartilhada;
  if (s !== 'ligando' && s !== 'noAr') return nada(e);
  if (o === 'confirmada') return s === 'ligando' ? com(e, { telaCompartilhada: 'noAr' }) : nada(e);
  const efeitos = o === 'semConexao' ? [desligar('tela'), PARAR_CAPTURA] : [PARAR_CAPTURA];
  return com(e, { telaCompartilhada: 'nenhuma' }, ...efeitos);
}

// A captura nasce no clique (o Safari e o Firefox só a deixam dentro do gesto). Ela vira a ligação da tela só na
// reunião, com o canal aberto; fora disso, ela para.
function telaCapturada(e, ok) {
  if (!ok) return nada(e);
  if (e.principal === 'noAr' && e.canal === 'aberto' && e.telaCompartilhada === 'nenhuma') {
    return com(e, { telaCompartilhada: 'pedindo' }, mandar({ tipo: 'tela' }));
  }
  return so(e, PARAR_CAPTURA);
}

function clique(e, botao) {
  switch (botao) {
    case 'pedir':
      if (e.tela !== 'entrada' || !nomeValido(e.nome)) return nada(e);
      return com(e, { tela: 'pedindo', nomeRecusado: false, reabrindo: 0 }, ABRIR);
    case 'desistir':
      return desistir(e);
    case 'tentarDeNovo':
      return tentarDeNovo(e);
    case 'tentarMidia':
      return e.tela === 'entrada' ? com(e, { esperandoMidia: true }, PEDIR_MIDIA) : nada(e);
    case 'sair':
      return e.tela === 'reuniao' || e.tela === 'entrando' ? terminar(e, 'saiu') : nada(e);
    case 'entrarDeNovo':
      return entrarDeNovo(e);
    case 'microfone':
      return trocar(e, 'mic');
    case 'camera':
      return trocar(e, 'cam');
    case 'pararDeCompartilhar':
      return pararDeCompartilhar(e);
    default:
      return nada(e);
  }
}

// Desistir retira o pedido: com o canal aberto, o desistir vai antes de fechar. O nome e a mídia ficam.
function desistir(e) {
  if (!ESPERA.has(e.tela)) return nada(e);
  const efeitos =
    e.canal === 'aberto' ? [mandar({ tipo: 'desistir' }), FECHAR_CANAL] : e.canal === 'abrindo' ? [FECHAR_CANAL] : [];
  return com(e, { tela: 'entrada', canal: 'fechado' }, ...efeitos);
}

// O Tentar de novo: com o canal aberto, outro pedir (antes do aceito) ou outro senha (depois). Com ele fechado, o abrir
// de novo, que volta a carregar quando o abrir do começo nem deu certo.
function tentarDeNovo(e) {
  if (e.tela !== 'aviso' || !DE_NOVO.has(e.aviso) || e.esperarSegundos > 0) return nada(e);
  const volta = { aviso: null, reabrindo: 0 };
  if (e.canal !== 'aberto') {
    return com(e, { ...volta, tela: e.reuniao ? 'pedindo' : 'carregando', aceito: false, acesso: null }, ABRIR);
  }
  if (!e.aceito) return com(e, { ...volta, tela: 'pedindo' }, pedido(e));
  return com(e, { ...volta, tela: 'entrando', principal: 'pedindo', senhaRepetida: false }, mandar({ tipo: 'senha' }));
}

// O Entrar de novo depois do saiu. Com o canal aberto: uma senha nova para o mesmo participante e a mídia de novo, e o
// ligar sai quando as duas chegarem. Com o canal fechado, o pedido passa pela espera outra vez.
function entrarDeNovo(e) {
  if (e.aviso !== 'saiu') return nada(e);
  const volta = { aviso: null, esperandoMidia: true };
  if (e.canal === 'aberto') {
    const mudancas = { ...volta, tela: 'entrando', principal: 'pedindo', senhaRepetida: false };
    return com(e, mudancas, PEDIR_MIDIA, mandar({ tipo: 'senha' }));
  }
  return com(e, { ...volta, tela: 'pedindo', aceito: false, acesso: null, reabrindo: 0 }, PEDIR_MIDIA, ABRIR);
}

// O Microfone e a Câmera. Na reunião, a ligação troca junto. Antes dela, só o estado muda, e o ligar leva a escolha.
// Com a ligação nascendo (ligando), o clique fica de fora: a oferta já saiu com a escolha de antes.
function trocar(e, qual) {
  if (e[qual] === 'indisponivel' || e.principal === 'ligando') return nada(e);
  const ligado = e[qual] !== 'ligado';
  const mudancas = { [qual]: ligado ? 'ligado' : 'desligado' };
  if (e.principal !== 'noAr') return com(e, mudancas);
  const troca = qual === 'mic' ? { tipo: 'trocarMicrofone', ligado } : { tipo: 'trocarCamera', ligada: ligado };
  return com(e, mudancas, troca);
}

// O Parar de compartilhar: a ligação da tela desce, e o terminou dela para a captura. Antes da senha, ela para já.
function pararDeCompartilhar(e) {
  switch (e.telaCompartilhada) {
    case 'pedindo':
      return com(e, { telaCompartilhada: 'nenhuma' }, PARAR_CAPTURA);
    case 'ligando':
    case 'noAr':
      return so(e, desligar('tela'));
    default:
      return nada(e);
  }
}

// A mídia que o navegador deu: o que falta fica indisponível, e o que a pessoa desligou continua desligado. Com uma
// senha guardada, o ligar sai agora.
const escolha = (atual, veio) => (veio === 'ligado' && atual === 'desligado' ? 'desligado' : veio);

function midia(e, { mic, cam }) {
  const mudancas = { mic: escolha(e.mic, mic), cam: escolha(e.cam, cam), esperandoMidia: false };
  if (e.senhaGuardada === null) return com(e, mudancas);
  return com(e, { ...mudancas, principal: 'ligando', senhaGuardada: null }, ligar('principal', e.senhaGuardada));
}

// Os prazos que o esperar marcou. O que chega depois de a página mudar de rumo fica de fora.
function tempo(e, chave) {
  switch (chave) {
    case 'contagem': {
      if (e.aviso !== 'tentativas' || e.esperarSegundos === 0) return nada(e);
      const n = e.esperarSegundos - 1;
      return n > 0 ? com(e, { esperarSegundos: n }, esperar(CONTAGEM_MS, 'contagem')) : com(e, { esperarSegundos: 0 });
    }
    case 'reconectar':
      if (e.tela !== 'reuniao' || e.reconectando === 0 || e.principal !== 'nenhuma') return nada(e);
      return com(e, { principal: 'pedindo' }, mandar({ tipo: 'senha' }));
    case 'fimSemAviso':
      return e.tela === 'reuniao' && e.principal === 'nenhuma' && e.reconectando === 0 ? terminar(e, 'saiu') : nada(e);
    case 'reabrir':
      return esperaOAbrir(e) && e.reabrindo > 0 ? so(e, ABRIR) : nada(e);
    default:
      return nada(e);
  }
}

// avisar: a tela do aviso. A principal fica sem nada pendente; o canal e a mídia ficam, para o Tentar de novo.
function avisar(e, aviso, mudancas = {}, ...efeitos) {
  const limpo = { principal: 'nenhuma', reconectando: 0, senhaRepetida: false, senhaGuardada: null };
  return com(e, { tela: 'aviso', aviso, esperarSegundos: 0, ...limpo, ...mudancas }, ...efeitos);
}

// terminar: o fim da entrada (os avisos sem o Tentar de novo, e o saiu). Depois do aceito, as duas ligações descem. A
// mídia para, e a luz da câmera apaga; no carregar, ela nem foi pedida. O Entrar de novo do saiu a pede outra vez.
function terminar(e, aviso) {
  const { mudancas, efeitos } = e.aceito ? desligarAsDuas(e) : { mudancas: {}, efeitos: [] };
  if (e.tela !== 'carregando') efeitos.push(PARAR_MIDIA);
  return avisar(e, aviso, mudancas, ...efeitos);
}

// As duas ligações descem de propósito, e a captura da tela, se houver, para junto.
function desligarAsDuas(e) {
  const efeitos = [desligar('principal'), desligar('tela')];
  if (e.telaCompartilhada !== 'nenhuma') efeitos.push(PARAR_CAPTURA);
  return { mudancas: { principal: 'nenhuma', telaCompartilhada: 'nenhuma' }, efeitos };
}

/**
 * O nome de uma pessoa (seção 3 do protocolo): sem os espaços das pontas, de 1 a 80 pontos de código, sem caracteres de
 * controle (C0, DEL e C1).
 */
export function nomeValido(nome) {
  if (typeof nome !== 'string') return false;
  const s = nome.trim();
  const n = [...s].length;
  return n >= 1 && n <= MAX_NOME && !/[\u0000-\u001f\u007f-\u009f]/.test(s);
}

const dois = (n) => String(n).padStart(2, '0');
const mesmoDia = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Hoje, 14:00", "Amanhã, 09:30" ou "18/11, 14:00", na hora local. */
export function quando(inicioMs, agoraMs) {
  const inicio = new Date(inicioMs);
  const agora = new Date(agoraMs);
  const hora = `${dois(inicio.getHours())}:${dois(inicio.getMinutes())}`;
  if (mesmoDia(inicio, agora)) return `Hoje, ${hora}`;
  if (mesmoDia(inicio, new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + 1))) return `Amanhã, ${hora}`;
  return `${dois(inicio.getDate())}/${dois(inicio.getMonth() + 1)}, ${hora}`;
}

/** O cabeçalho da reunião: {sobretitulo, titulo}. O título é o assunto, ou "Reunião" sem ele. */
export function cabecalho(reuniao, agoraMs) {
  const titulo = reuniao.assunto || 'Reunião';
  switch (reuniao.tipo) {
    case 'marcada':
      return { sobretitulo: `Reunião marcada · ${quando(reuniao.inicio, agoraMs)}`, titulo };
    case 'naHora':
      return { sobretitulo: 'Reunião agora', titulo };
    default: // teste
      return { sobretitulo: 'Reunião de teste', titulo };
  }
}
