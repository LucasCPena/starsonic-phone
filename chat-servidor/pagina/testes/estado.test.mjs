// Os testes do cérebro da página da reunião (estado.js): a máquina de estados pura, sem DOM, sem rede e sem relógio.
// Cada teste parte do estado de que precisa, alcançado pelos próprios eventos, e confere o estado e os efeitos.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AVISO_CURTO_MS,
  AVISO_DA_CONEXAO_MS,
  CONTAGEM_MS,
  FIM_SEM_AVISO_MS,
  MAX_REABRIR,
  MAX_RECONECTAR,
  PRAZO_DA_MENSAGEM_MS,
  PRAZO_VOLTA_MS,
  REABRIR_MS,
  RECONECTAR_MS,
  RELIGAR_DEVAGAR_MS,
  cabecalho,
  inicial,
  nomeValido,
  paraOApp,
  podeEscrever,
  quando,
  transicao,
} from '../../internal/pagina/estatico/estado.js';

// Os dados de mentira: nada aqui é segredo.
const REUNIAO = {
  tipo: 'marcada',
  assunto: 'Planejamento de dezembro',
  inicio: new Date(2026, 10, 17, 14, 0).getTime(),
};
const ACESSO = {
  turn: { urls: ['turn:turn.exemplo.com.br:3478'], usuario: 'usuario-de-teste', senha: 'turn-de-teste' },
  video: { wss: 'wss://video.exemplo.com.br:7443/sip', uri: 'sip:reuniao@video.exemplo.com.br' },
};
const ACEITO = { tipo: 'aceito', participante: 'participante-1', senha: 'senha-1', ...ACESSO };
// O aceito de hoje traz a chave de volta, e cada voltou traz outra. O ACEITO sem ela mostra a regra de antes da chave.
const VOLTA_1 = 'volta-1';
const VOLTA_2 = 'volta-2';
const VOLTA_3 = 'volta-3';
const ACEITO_COM_CHAVE = { ...ACEITO, volta: VOLTA_1 };

// Os efeitos. O abrir leva o número dele, a abertura, e o bilhete de mentira que ele dá leva o mesmo número. As esperas
// e os prazos da volta e do religar levam a vez na chave.
const abrir = (abertura) => ({ tipo: 'abrir', abertura });
const FOCAR = { tipo: 'focar' };
const PEDIR_MIDIA = { tipo: 'pedirMidia' };
const PARAR_MIDIA = { tipo: 'pararMidia' };
const FECHAR_CANAL = { tipo: 'fecharCanal' };
const PARAR_CAPTURA = { tipo: 'pararCaptura' };
const DESLIGAR_AS_DUAS = [
  { tipo: 'desligar', qual: 'principal' },
  { tipo: 'desligar', qual: 'tela' },
];
const mandar = (m) => ({ tipo: 'mandar', m });
const esperar = (ms, chave) => ({ tipo: 'esperar', ms, chave });
const prazo = (vez) => esperar(10000, `prazo:${vez}`);
const ligar = (qual, senha) => ({ tipo: 'ligar', qual, senha });
const PEDIR = mandar({ tipo: 'pedir', nome: 'Maria Lima' });
const SENHA = mandar({ tipo: 'senha' });
const abrirCanal = (abertura) => ({ tipo: 'abrirCanal', bilhete: `bilhete-${abertura}` });
const voltar = (volta) => mandar({ tipo: 'voltar', participante: 'participante-1', volta });
// O aviso da câmera (seção 10 do protocolo): a página diz ao servidor se a câmera dela está ligada.
const camera = (ligada) => mandar({ tipo: 'camera', ligada });

// O palco do servidor, com um quadro, e o que o cérebro guarda dele (o lerPalco do palco.js: só os campos conhecidos).
const QUADRO = { quem: '0123456789abcdef', nome: 'Ana Souza', voce: false, tela: false, semCamera: false };
const PALCO = {
  tipo: 'palco',
  largura: 1920,
  altura: 1080,
  quadros: [{ ...QUADRO, x: 0, y: 0, l: 960, a: 540, extra: 'fica de fora' }],
};
const PALCO_LIDO = { largura: 1920, altura: 1080, quadros: [{ ...QUADRO, x: 0, y: 0, l: 960, a: 540 }] };

// Os eventos. O abriu e o abrirFalhou devolvem a abertura do abrir que eles respondem.
const COMECAR = { tipo: 'comecar' };
const CANAL_ABRIU = { tipo: 'canalAbriu' };
const abriu = (abertura) => ({ tipo: 'abriu', reuniao: REUNIAO, bilhete: `bilhete-${abertura}`, abertura });
const abrirFalhou = (abertura, status, esperarSegundos = 0) => ({
  tipo: 'abrirFalhou',
  status,
  esperarSegundos,
  abertura,
});
const canalFechou = (codigo) => ({ tipo: 'canalFechou', codigo });
const clique = (botao) => ({ tipo: 'clique', botao });
const mensagem = (m) => ({ tipo: 'mensagem', m });
const midia = (mic, cam) => ({ tipo: 'midia', mic, cam });
const ligacao = (qual, o, codigo = 0) => ({ tipo: 'ligacao', qual, o, codigo });
const SEM_CONEXAO = ligacao('principal', 'semConexao');
const tempo = (chave) => ({ tipo: 'tempo', chave });
const voltou = (volta) => mensagem({ tipo: 'voltou', volta });
const LIMITE = mensagem({ tipo: 'erro', erro: 'limite' });

// congelar congela o estado inteiro antes de cada passo: a transicao nunca muda o estado que recebe, e o módulo, que é
// estrito, daria erro se tentasse.
function congelar(o) {
  if (o !== null && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o).forEach(congelar);
  }
  return o;
}

const passo = (estado, evento) => transicao(congelar(estado), evento);

// rodar aplica os eventos em ordem e devolve o último passo.
function rodar(estado, ...eventos) {
  let r = { estado, efeitos: [] };
  for (const evento of eventos) r = passo(r.estado, evento);
  return r;
}

// Os estados de partida, alcançados pelos eventos. O abrir 1 é o do carregar, e o 2, o do pedido.
const naEntrada = (mic = 'ligado', cam = 'ligado') =>
  rodar(inicial(), COMECAR, abriu(1), midia(mic, cam), { tipo: 'nome', valor: '  Maria Lima  ' }).estado;
const pedindo = () => rodar(naEntrada(), clique('pedir'), abriu(2), CANAL_ABRIU).estado;
const aguardando = () => rodar(pedindo(), mensagem({ tipo: 'aguardando' })).estado;
const entrando = () => rodar(aguardando(), mensagem(ACEITO)).estado;
const naReuniao = () => rodar(entrando(), ligacao('principal', 'confirmada')).estado;
const saiu = () => rodar(naReuniao(), clique('sair')).estado;
const naReuniaoComChave = () =>
  rodar(aguardando(), mensagem(ACEITO_COM_CHAVE), ligacao('principal', 'confirmada')).estado;

// Nada muda: o mesmo estado, sem efeitos.
const semMudar = (estado, evento) => assert.deepEqual(passo(estado, evento), { estado, efeitos: [] });

// seguir dá os passos em ordem, cada um com os efeitos que ele tem de dar, e devolve o último estado. O conferir olha o
// estado depois de cada passo.
function seguir(estado, passos, conferir = () => {}) {
  for (const [evento, efeitos] of passos) {
    const r = passo(estado, evento);
    assert.deepEqual(r.efeitos, efeitos, JSON.stringify(evento));
    conferir(r.estado);
    estado = r.estado;
  }
  return estado;
}

test('o carregar abre', () => {
  assert.deepEqual(inicial(), {
    tela: 'carregando',
    aviso: null,
    esperarSegundos: 0,
    reuniao: null,
    nome: '',
    nomeRecusado: false,
    mic: 'ligado',
    cam: 'ligado',
    canal: 'fechado',
    aceito: false,
    acesso: null,
    telaCompartilhada: 'nenhuma',
    reconectando: 0,
    senhaRepetida: false,
    reabrindo: 0,
    principal: 'nenhuma',
    esperandoMidia: false,
    senhaGuardada: null,
    trocandoCamera: false,
    chave: null,
    religando: 0,
    esperandoBilhete: false,
    vez: 0,
    abertura: 0,
    partida: null,
    palco: null,
    chat: { mensagens: [], naoLidas: 0, aberto: false, seq: 0 },
    avisoCurto: null,
    avisos: 0,
    qualidade: { estado: 'medindo', perda: null, atraso: null },
    cartao: false,
    conexaoAvisada: false,
    colega: null,
    chaveDoColega: null,
    passe: null,
    semColega: false,
    windows: false,
    peloNavegador: false,
    lista: { participantes: [], pedidos: [] },
    gente: false,
    tirando: null,
    encerrando: false,
    cheiaAoAceitar: false,
    respondendo: [],
    semCuidar: false,
    reentrando: null,
    queda: false,
    noApp: false,
    aparelhos: { microfone: '', altoFalante: '', camera: '' },
    esperandoPasse: false,
    prontas: 0,
    passeRecusado: false,
    pausa: null,
    pausaPendente: null,
    vezesDesfeitas: [],
    bloqueio: null,
    cameraDeNovo: false,
    camDaLigacao: null,
  });
  const r = passo(inicial(), COMECAR);
  assert.equal(r.estado.tela, 'carregando');
  assert.deepEqual(r.efeitos, [abrir(1)]);
});

test('o abriu vai à entrada e pede a mídia', () => {
  const r = rodar(inicial(), COMECAR, abriu(1));
  assert.equal(r.estado.tela, 'entrada');
  assert.deepEqual(r.estado.reuniao, REUNIAO);
  assert.deepEqual(r.efeitos, [PEDIR_MIDIA, FOCAR]);
  // O bilhete do carregar não serve para o canal (ele vale 30 segundos), e não fica no estado.
  assert.ok(!JSON.stringify(r.estado).includes('bilhete-1'));
});

test('o 404 do abrir é o linkInvalido', () => {
  let r = rodar(inicial(), COMECAR, abrirFalhou(1, 404));
  assert.equal(r.estado.tela, 'aviso');
  assert.equal(r.estado.aviso, 'linkInvalido');
  assert.deepEqual(r.efeitos, [FOCAR]);
  // No abrir do pedido, a mídia já foi pedida: ela para.
  r = rodar(naEntrada(), clique('pedir'), abrirFalhou(2, 404));
  assert.equal(r.estado.aviso, 'linkInvalido');
  assert.deepEqual(r.efeitos, [PARAR_MIDIA, FOCAR]);
});

test('o 429 conta e libera', () => {
  assert.equal(CONTAGEM_MS, 1000);
  let r = rodar(inicial(), COMECAR, abrirFalhou(1, 429, 3));
  assert.equal(r.estado.tela, 'aviso');
  assert.equal(r.estado.aviso, 'tentativas');
  assert.equal(r.estado.esperarSegundos, 3);
  assert.deepEqual(r.efeitos, [esperar(1000, 'contagem'), FOCAR]);
  // Antes do 0, o botão está desligado.
  semMudar(r.estado, clique('tentarDeNovo'));
  for (const n of [2, 1]) {
    r = passo(r.estado, tempo('contagem'));
    assert.equal(r.estado.esperarSegundos, n);
    assert.deepEqual(r.efeitos, [esperar(1000, 'contagem')]);
  }
  r = passo(r.estado, tempo('contagem'));
  assert.equal(r.estado.esperarSegundos, 0);
  assert.deepEqual(r.efeitos, []);
  r = passo(r.estado, clique('tentarDeNovo'));
  assert.equal(r.estado.tela, 'carregando');
  assert.equal(r.estado.aviso, null);
  assert.deepEqual(r.efeitos, [abrir(2), FOCAR]);
});

test('a rede que falha no abrir é o semServidor', () => {
  for (const status of [0, 500]) {
    const r = rodar(inicial(), COMECAR, abrirFalhou(1, status));
    assert.equal(r.estado.aviso, 'semServidor');
    assert.deepEqual(r.efeitos, [FOCAR]);
  }
  // O Tentar de novo do carregar volta a carregar, e o abriu vai à entrada.
  let r = rodar(inicial(), COMECAR, abrirFalhou(1, 0), clique('tentarDeNovo'));
  assert.equal(r.estado.tela, 'carregando');
  assert.deepEqual(r.efeitos, [abrir(2), FOCAR]);
  r = passo(r.estado, abriu(2));
  assert.equal(r.estado.tela, 'entrada');
  assert.deepEqual(r.efeitos, [PEDIR_MIDIA, FOCAR]);
});

test('pedir abre de novo, abre o canal e manda o nome', () => {
  let r = passo(naEntrada(), clique('pedir'));
  assert.equal(r.estado.tela, 'pedindo');
  assert.deepEqual(r.efeitos, [abrir(2), FOCAR]);
  r = passo(r.estado, abriu(2));
  assert.equal(r.estado.canal, 'abrindo');
  assert.deepEqual(r.efeitos, [abrirCanal(2)]);
  assert.ok(!JSON.stringify(r.estado).includes('bilhete-2'));
  r = passo(r.estado, CANAL_ABRIU);
  assert.equal(r.estado.canal, 'aberto');
  assert.deepEqual(r.efeitos, [PEDIR]);
});

test('pedir sem nome válido não faz nada', () => {
  for (const valor of ['', '   ', 'a\tb', 'a'.repeat(81)]) {
    semMudar(rodar(naEntrada(), { tipo: 'nome', valor }).estado, clique('pedir'));
  }
});

test('naoComecou e aguardando vão e voltam', () => {
  let r = passo(pedindo(), mensagem({ tipo: 'naoComecou' }));
  assert.equal(r.estado.tela, 'naoComecou');
  assert.deepEqual(r.efeitos, [FOCAR]);
  r = passo(r.estado, mensagem({ tipo: 'aguardando' }));
  assert.equal(r.estado.tela, 'aguardando');
  assert.deepEqual(r.efeitos, [FOCAR]);
  r = passo(r.estado, mensagem({ tipo: 'naoComecou' }));
  assert.equal(r.estado.tela, 'naoComecou');
  assert.deepEqual(r.efeitos, [FOCAR]);
});

test('o aceito liga a principal', () => {
  // Na reunião de teste, o aceito vem logo depois do pedir, sem o aguardando.
  for (const antes of [aguardando(), pedindo()]) {
    const r = passo(antes, mensagem(ACEITO));
    assert.equal(r.estado.tela, 'entrando');
    assert.equal(r.estado.aceito, true);
    assert.deepEqual(r.estado.acesso, ACESSO);
    assert.deepEqual(r.efeitos, [ligar('principal', 'senha-1'), camera(true), FOCAR]);
  }
});

test('a principal confirmada é a reunião', () => {
  const r = passo(entrando(), ligacao('principal', 'confirmada'));
  assert.equal(r.estado.tela, 'reuniao');
  assert.deepEqual(r.efeitos, [FOCAR]);
});

test('o 403 da principal pede outra senha uma vez', () => {
  let r = passo(entrando(), ligacao('principal', 'falhou', 403));
  assert.equal(r.estado.tela, 'entrando');
  assert.equal(r.estado.senhaRepetida, true);
  assert.deepEqual(r.efeitos, [SENHA]);
  r = passo(r.estado, mensagem({ tipo: 'senha', senha: 'senha-2' }));
  assert.deepEqual(r.efeitos, [ligar('principal', 'senha-2')]);
  r = passo(r.estado, ligacao('principal', 'falhou', 403));
  assert.equal(r.estado.tela, 'aviso');
  assert.equal(r.estado.aviso, 'semServidor');
  assert.deepEqual(r.efeitos, [FOCAR]);
  // Outra falha não pede senha: é o semServidor de uma vez.
  r = passo(entrando(), ligacao('principal', 'falhou', 0));
  assert.equal(r.estado.aviso, 'semServidor');
  assert.deepEqual(r.efeitos, [FOCAR]);
});

test('cada mensagem final é o seu aviso', () => {
  let r = passo(aguardando(), mensagem({ tipo: 'recusado' }));
  assert.equal(r.estado.tela, 'aviso');
  assert.equal(r.estado.aviso, 'naoFoiPossivel');
  assert.deepEqual(r.efeitos, [PARAR_MIDIA, FOCAR]);
  r = passo(aguardando(), mensagem({ tipo: 'linkInvalido' }));
  assert.equal(r.estado.aviso, 'linkInvalido');
  assert.deepEqual(r.efeitos, [PARAR_MIDIA, FOCAR]);
  for (const tipo of ['tirado', 'encerrada']) {
    r = passo(naReuniao(), mensagem({ tipo }));
    assert.equal(r.estado.tela, 'aviso');
    assert.equal(r.estado.aviso, tipo);
    assert.deepEqual(r.efeitos, [...DESLIGAR_AS_DUAS, PARAR_MIDIA, FOCAR]);
  }
});

test('cheia, esperaCheia, servidorCheio e semServidor deixam tentar de novo', () => {
  for (const tipo of ['cheia', 'esperaCheia', 'servidorCheio', 'semServidor']) {
    // Antes do aceito, com o canal aberto: outro pedir no mesmo canal.
    let r = passo(pedindo(), mensagem({ tipo }));
    assert.equal(r.estado.tela, 'aviso');
    assert.equal(r.estado.aviso, tipo);
    assert.deepEqual(r.efeitos, [FOCAR]);
    r = passo(r.estado, clique('tentarDeNovo'));
    assert.equal(r.estado.tela, 'pedindo');
    assert.equal(r.estado.aviso, null);
    assert.deepEqual(r.efeitos, [PEDIR, FOCAR]);
    // Depois do aceito, a resposta ao senha: outro senha.
    r = rodar(entrando(), ligacao('principal', 'falhou', 403), mensagem({ tipo }));
    assert.equal(r.estado.aviso, tipo);
    r = passo(r.estado, clique('tentarDeNovo'));
    assert.equal(r.estado.tela, 'entrando');
    assert.deepEqual(r.efeitos, [SENHA, FOCAR]);
    r = passo(r.estado, mensagem({ tipo: 'senha', senha: 'senha-2' }));
    assert.deepEqual(r.efeitos, [ligar('principal', 'senha-2')]);
  }
  // Com o canal fechado, o abrir.
  let r = rodar(naEntrada(), clique('pedir'), abrirFalhou(2, 0));
  assert.equal(r.estado.aviso, 'semServidor');
  assert.equal(r.estado.canal, 'fechado');
  r = passo(r.estado, clique('tentarDeNovo'));
  assert.equal(r.estado.tela, 'pedindo');
  assert.deepEqual(r.efeitos, [abrir(3), FOCAR]);
  r = rodar(r.estado, abriu(3), CANAL_ABRIU);
  assert.deepEqual(r.efeitos, [PEDIR]);
});

test('desistir manda e volta à entrada', () => {
  const antes = rodar(naEntrada(), clique('camera'), clique('pedir'), abriu(2), CANAL_ABRIU).estado;
  for (const espera of [antes, passo(antes, mensagem({ tipo: 'aguardando' })).estado]) {
    const r = passo(espera, clique('desistir'));
    assert.equal(r.estado.tela, 'entrada');
    assert.equal(r.estado.canal, 'fechado');
    assert.equal(r.estado.nome, '  Maria Lima  ');
    assert.equal(r.estado.mic, 'ligado');
    assert.equal(r.estado.cam, 'desligado');
    assert.deepEqual(r.efeitos, [mandar({ tipo: 'desistir' }), FECHAR_CANAL, FOCAR]);
  }
});

test('o nome recusado volta à entrada', () => {
  const r = passo(pedindo(), mensagem({ tipo: 'erro', erro: 'invalido' }));
  assert.equal(r.estado.tela, 'entrada');
  assert.equal(r.estado.nomeRecusado, true);
  // O canal do pedido recusado fecha: o próximo Pedir abre outro, com um bilhete novo.
  assert.equal(r.estado.canal, 'fechado');
  assert.deepEqual(r.efeitos, [FECHAR_CANAL, FOCAR]);
  // O nome digitado de novo apaga o "Confira o seu nome.".
  assert.equal(passo(r.estado, { tipo: 'nome', valor: 'Maria' }).estado.nomeRecusado, false);
});

test('sair desliga e para a mídia', () => {
  const r = passo(naReuniao(), clique('sair'));
  assert.equal(r.estado.tela, 'aviso');
  assert.equal(r.estado.aviso, 'saiu');
  assert.equal(r.estado.canal, 'aberto');
  assert.deepEqual(r.efeitos, [...DESLIGAR_AS_DUAS, PARAR_MIDIA, FOCAR]);
});

test('entrar de novo com o canal aberto pede senha e mídia', () => {
  const r = passo(saiu(), clique('entrarDeNovo'));
  assert.equal(r.estado.tela, 'entrando');
  assert.equal(r.estado.aviso, null);
  assert.deepEqual(r.efeitos, [PEDIR_MIDIA, SENHA, FOCAR]);
  const SENHA_3 = mensagem({ tipo: 'senha', senha: 'senha-3' });
  for (const [primeiro, segundo] of [
    [midia('ligado', 'ligado'), SENHA_3],
    [SENHA_3, midia('ligado', 'ligado')],
  ]) {
    let s = passo(r.estado, primeiro);
    assert.deepEqual(s.efeitos, []);
    s = passo(s.estado, segundo);
    assert.deepEqual(s.efeitos, [ligar('principal', 'senha-3')]);
    // A senha não fica guardada depois do ligar.
    assert.ok(!JSON.stringify(s.estado).includes('senha-3'));
    s = passo(s.estado, ligacao('principal', 'confirmada'));
    assert.equal(s.estado.tela, 'reuniao');
  }
});

test('entrar de novo com o canal fechado passa pela espera', () => {
  const antes = rodar(naReuniao(), canalFechou(1006), clique('sair')).estado;
  assert.equal(antes.canal, 'fechado');
  let r = passo(antes, clique('entrarDeNovo'));
  assert.equal(r.estado.tela, 'pedindo');
  assert.equal(r.estado.aceito, false);
  assert.equal(r.estado.acesso, null);
  assert.deepEqual(r.efeitos, [PEDIR_MIDIA, abrir(3), FOCAR]);
  r = rodar(r.estado, abriu(3), CANAL_ABRIU);
  assert.deepEqual(r.efeitos, [PEDIR]);
  // Na reunião de teste, o aceito pode chegar antes da mídia: o ligar espera por ela.
  r = passo(r.estado, mensagem({ ...ACEITO, senha: 'senha-4' }));
  assert.equal(r.estado.tela, 'entrando');
  assert.deepEqual(r.efeitos, [camera(true), FOCAR]);
  r = passo(r.estado, midia('ligado', 'ligado'));
  assert.deepEqual(r.efeitos, [ligar('principal', 'senha-4')]);
});

test('a conexão que cai entra de novo até 3 vezes', () => {
  assert.deepEqual(RECONECTAR_MS, [2000, 4000, 8000]);
  assert.ok(Object.isFrozen(RECONECTAR_MS));
  assert.equal(MAX_RECONECTAR, 3);
  // Uma tentativa: a espera da vez dela, o senha com o prazo dela, e o ligar com a senha nova.
  const tentar = (estado, vez, senha) => {
    let s = passo(estado, tempo(`reconectar:${vez}`));
    assert.deepEqual(s.efeitos, [SENHA, prazo(vez)]);
    s = passo(s.estado, mensagem({ tipo: 'senha', senha }));
    assert.deepEqual(s.efeitos, [ligar('principal', senha)]);
    return s.estado;
  };
  let r = passo(naReuniao(), SEM_CONEXAO);
  assert.equal(r.estado.tela, 'reuniao');
  assert.equal(r.estado.reconectando, 1);
  assert.deepEqual(r.efeitos, [...DESLIGAR_AS_DUAS, esperar(2000, 'reconectar:1')]);
  // O fim da ligação que a página desligou não conta como falha.
  semMudar(r.estado, ligacao('principal', 'terminou'));
  r = passo(tentar(r.estado, 1, 'senha-r1'), ligacao('principal', 'falhou', 0));
  assert.equal(r.estado.reconectando, 2);
  assert.deepEqual(r.efeitos, [esperar(4000, 'reconectar:2')]);
  r = passo(tentar(r.estado, 2, 'senha-r2'), ligacao('principal', 'falhou', 0));
  assert.equal(r.estado.reconectando, 3);
  assert.deepEqual(r.efeitos, [esperar(8000, 'reconectar:3')]);
  r = passo(tentar(r.estado, 3, 'senha-r3'), ligacao('principal', 'falhou', 0));
  assert.equal(r.estado.tela, 'aviso');
  assert.equal(r.estado.aviso, 'saiu');
  assert.equal(r.estado.reconectando, 0);
  assert.deepEqual(r.efeitos, [...DESLIGAR_AS_DUAS, PARAR_MIDIA, FOCAR]);
  // Um confirmada no meio zera a conta: a próxima queda espera 2 segundos de novo, numa vez nova.
  r = passo(naReuniao(), SEM_CONEXAO);
  r = passo(tentar(r.estado, 1, 'senha-r4'), ligacao('principal', 'confirmada'));
  assert.equal(r.estado.tela, 'reuniao');
  assert.equal(r.estado.reconectando, 0);
  assert.deepEqual(r.efeitos, []);
  r = passo(r.estado, SEM_CONEXAO);
  assert.equal(r.estado.reconectando, 1);
  assert.deepEqual(r.efeitos, [...DESLIGAR_AS_DUAS, esperar(2000, 'reconectar:2')]);
});

test('o canal que cai durante a volta', () => {
  // Sem a chave de volta (um aceito sem ela). As três fases da volta: o prazo antes da tentativa, a espera da senha e o
  // ligar.
  const noPrazo = () => passo(naReuniao(), SEM_CONEXAO).estado;
  const naSenha = () => passo(noPrazo(), tempo('reconectar:1')).estado;
  const noLigar = () => passo(naSenha(), mensagem({ tipo: 'senha', senha: 'senha-r1' })).estado;
  const SAIU = [...DESLIGAR_AS_DUAS, PARAR_MIDIA, FOCAR];
  // No prazo e na espera da senha, sem o canal não há como voltar: saiu na hora.
  for (const fase of [noPrazo(), naSenha()]) {
    const r = passo(fase, canalFechou(1006));
    assert.equal(r.estado.aviso, 'saiu');
    assert.deepEqual(r.efeitos, SAIU);
  }
  // No ligar, a tentativa em curso continua, e a confirmada sem o canal ainda é a reunião.
  const semCanal = passo(noLigar(), canalFechou(1006));
  assert.equal(semCanal.estado.tela, 'reuniao');
  assert.equal(semCanal.estado.canal, 'fechado');
  assert.deepEqual(semCanal.efeitos, []);
  let r = passo(semCanal.estado, ligacao('principal', 'confirmada'));
  assert.equal(r.estado.tela, 'reuniao');
  assert.equal(r.estado.reconectando, 0);
  assert.deepEqual(r.efeitos, []);
  // A tentativa que falha sem o canal é o saiu: nenhum senha num canal fechado, nenhuma tela parada sem prazo.
  for (const o of ['falhou', 'semConexao']) {
    r = passo(semCanal.estado, ligacao('principal', o));
    assert.equal(r.estado.tela, 'aviso', o);
    assert.equal(r.estado.aviso, 'saiu');
    assert.deepEqual(r.efeitos, SAIU);
  }
  // O prazo da volta que achasse o canal fechado também dá o saiu. Os eventos não chegam a esse estado (o canal que cai
  // no prazo já é o saiu), e a guarda fica.
  r = passo({ ...noPrazo(), canal: 'fechado' }, tempo('reconectar:1'));
  assert.equal(r.estado.aviso, 'saiu');
  assert.deepEqual(r.efeitos, SAIU);
});

test('na volta, as recusas do senha são tentativas que falharam', () => {
  for (const tipo of ['semServidor', 'cheia', 'servidorCheio', 'esperaCheia']) {
    let r = rodar(naReuniao(), SEM_CONEXAO, tempo('reconectar:1'), mensagem({ tipo }));
    assert.equal(r.estado.tela, 'reuniao', tipo);
    assert.equal(r.estado.reconectando, 2);
    assert.deepEqual(r.efeitos, [esperar(4000, 'reconectar:2')]);
    r = rodar(r.estado, tempo('reconectar:2'), mensagem({ tipo }));
    assert.equal(r.estado.reconectando, 3);
    assert.deepEqual(r.efeitos, [esperar(8000, 'reconectar:3')]);
    r = rodar(r.estado, tempo('reconectar:3'), mensagem({ tipo }));
    assert.equal(r.estado.aviso, 'saiu');
    assert.deepEqual(r.efeitos, [...DESLIGAR_AS_DUAS, PARAR_MIDIA, FOCAR]);
  }
});

test('o semConexao no meio do ligar desliga a principal', () => {
  const DESLIGAR_A_PRINCIPAL = { tipo: 'desligar', qual: 'principal' };
  // Ao entrar: a ligação que perdeu a conexão desce, e é o semServidor.
  let r = passo(entrando(), SEM_CONEXAO);
  assert.equal(r.estado.aviso, 'semServidor');
  assert.deepEqual(r.efeitos, [DESLIGAR_A_PRINCIPAL, FOCAR]);
  // Na volta, com o canal aberto: ela desce, e vem a próxima tentativa.
  const SENHA_R1 = mensagem({ tipo: 'senha', senha: 'senha-r1' });
  r = rodar(naReuniao(), SEM_CONEXAO, tempo('reconectar:1'), SENHA_R1);
  r = passo(r.estado, SEM_CONEXAO);
  assert.equal(r.estado.reconectando, 2);
  assert.deepEqual(r.efeitos, [DESLIGAR_A_PRINCIPAL, esperar(4000, 'reconectar:2')]);
});

test('a ligação que termina sem aviso vira saiu', () => {
  assert.equal(FIM_SEM_AVISO_MS, 2000);
  const r = passo(naReuniao(), ligacao('principal', 'terminou'));
  assert.equal(r.estado.tela, 'reuniao');
  assert.deepEqual(r.efeitos, [esperar(2000, 'fimSemAviso')]);
  // Sem tirado nem encerrada no prazo: saiu.
  const s = passo(r.estado, tempo('fimSemAviso'));
  assert.equal(s.estado.tela, 'aviso');
  assert.equal(s.estado.aviso, 'saiu');
  assert.deepEqual(s.efeitos, [...DESLIGAR_AS_DUAS, PARAR_MIDIA, FOCAR]);
  // Com o encerrada antes, fica o encerrada.
  const e = passo(r.estado, mensagem({ tipo: 'encerrada' })).estado;
  assert.equal(e.aviso, 'encerrada');
  semMudar(e, tempo('fimSemAviso'));
  // O falhou de uma ligação que já estava no ar conta como o terminou: o mosaico nunca fica parado.
  const f = passo(naReuniao(), ligacao('principal', 'falhou', 0));
  assert.equal(f.estado.tela, 'reuniao');
  assert.deepEqual(f.efeitos, [esperar(2000, 'fimSemAviso')]);
  assert.equal(passo(f.estado, tempo('fimSemAviso')).estado.aviso, 'saiu');
});

test('o 1011 antes do aceito abre de novo', () => {
  assert.equal(REABRIR_MS, 3000);
  assert.equal(MAX_REABRIR, 3);
  let e = aguardando();
  for (let n = 1; n <= 3; n++) {
    let r = passo(e, canalFechou(1011));
    assert.equal(r.estado.tela, 'aguardando');
    assert.equal(r.estado.canal, 'fechado');
    assert.equal(r.estado.reabrindo, n);
    assert.deepEqual(r.efeitos, [esperar(3000, 'reabrir')]);
    r = passo(r.estado, tempo('reabrir'));
    assert.deepEqual(r.efeitos, [abrir(2 + n)]);
    r = rodar(r.estado, abriu(2 + n), CANAL_ABRIU);
    assert.deepEqual(r.efeitos, [PEDIR]);
    e = passo(r.estado, mensagem({ tipo: 'aguardando' })).estado;
  }
  const r = passo(e, canalFechou(1011));
  assert.equal(r.estado.tela, 'aviso');
  assert.equal(r.estado.aviso, 'semServidor');
  assert.deepEqual(r.efeitos, [FOCAR]);
});

test('o canal que cai na reunião não tira ninguém', () => {
  // Sem a chave de volta (um aceito sem ela), o canal que cai fica fechado.
  let r = passo(naReuniao(), canalFechou(1006));
  assert.equal(r.estado.tela, 'reuniao');
  assert.equal(r.estado.canal, 'fechado');
  assert.deepEqual(r.efeitos, []);
  // Sem o canal, não há senha para voltar.
  r = passo(r.estado, SEM_CONEXAO);
  assert.equal(r.estado.tela, 'aviso');
  assert.equal(r.estado.aviso, 'saiu');
  assert.deepEqual(r.efeitos, [...DESLIGAR_AS_DUAS, PARAR_MIDIA, FOCAR]);
});

test('o canal que cai na reunião volta sozinho', () => {
  // Só o canal caiu: a ligação segue no ar, e a tela não mostra nada da volta (nem a entrada, nem a conexão caída).
  const segueNaReuniao = (estado) => {
    assert.equal(estado.tela, 'reuniao');
    assert.equal(estado.principal, 'noAr');
    assert.equal(estado.reconectando, 0);
  };
  const caiu = passo(naReuniaoComChave(), canalFechou(1006));
  assert.equal(caiu.estado.tela, 'reuniao');
  assert.equal(caiu.estado.canal, 'fechado');
  assert.deepEqual(caiu.efeitos, [esperar(2000, 'religar:1')]);
  const religado = seguir(
    caiu.estado,
    [
      [tempo('religar:1'), [abrir(3), prazo(1)]],
      [abriu(3), [abrirCanal(3)]],
      [CANAL_ABRIU, [voltar(VOLTA_1)]],
      [voltou(VOLTA_2), [camera(true)]],
    ],
    segueNaReuniao,
  );
  assert.equal(religado.canal, 'aberto');
  // A chave nova fica: a próxima volta a leva.
  seguir(
    religado,
    [
      [canalFechou(1006), [esperar(2000, 'religar:2')]],
      [tempo('religar:2'), [abrir(4), prazo(2)]],
      [abriu(4), [abrirCanal(4)]],
      [CANAL_ABRIU, [voltar(VOLTA_2)]],
    ],
    segueNaReuniao,
  );
  // O canal que cai no meio do ligar volta por trás quando a ligação confirma.
  const r = rodar(aguardando(), mensagem(ACEITO_COM_CHAVE), canalFechou(1006), ligacao('principal', 'confirmada'));
  assert.equal(r.estado.tela, 'reuniao');
  assert.equal(r.estado.canal, 'fechado');
  assert.deepEqual(r.efeitos, [esperar(2000, 'religar:1'), FOCAR]);
});

test('as duas conexões caem e a página volta sozinha', () => {
  const naTela = (estado) => assert.equal(estado.tela, 'reuniao');
  // As duas ordens da queda, e a ligação que cai no meio do religar: o voltar dele vira a primeira tentativa, com um
  // prazo só dela.
  const quedas = {
    'o canal e depois a ligação': [
      [canalFechou(1006), [esperar(2000, 'religar:1')]],
      [SEM_CONEXAO, [...DESLIGAR_AS_DUAS, esperar(2000, 'reconectar:2')]],
      [tempo('religar:1'), []],
      [tempo('reconectar:2'), [abrir(3), prazo(2)]],
    ],
    'a ligação e depois o canal': [
      [SEM_CONEXAO, [...DESLIGAR_AS_DUAS, esperar(2000, 'reconectar:1')]],
      [canalFechou(1006), []],
      [tempo('reconectar:1'), [abrir(3), prazo(1)]],
    ],
    'a ligação no meio do religar': [
      [canalFechou(1006), [esperar(2000, 'religar:1')]],
      [tempo('religar:1'), [abrir(3), prazo(1)]],
      [SEM_CONEXAO, [...DESLIGAR_AS_DUAS, prazo(2)]],
    ],
  };
  // A volta: outro canal com a chave, a senha nova e a ligação nova, com a tela da conexão caída. Nenhum pedir, nenhuma
  // entrada e nenhum pedirMidia.
  const volta = [
    [abriu(3), [abrirCanal(3)]],
    [CANAL_ABRIU, [voltar(VOLTA_1)]],
    [voltou(VOLTA_2), [SENHA, camera(true)]],
    [mensagem({ tipo: 'senha', senha: 'senha-r1' }), [ligar('principal', 'senha-r1')]],
  ];
  // A tela da conexão caída, com a conta da volta; a do religar, que a volta tomou, fica em zero.
  const caida = (estado) => {
    naTela(estado);
    assert.equal(estado.reconectando, 1);
    assert.equal(estado.religando, 0);
  };
  for (const [ordem, queda] of Object.entries(quedas)) {
    const e = seguir(seguir(naReuniaoComChave(), queda, naTela), volta, caida);
    const r = passo(e, ligacao('principal', 'confirmada'));
    assert.equal(r.estado.tela, 'reuniao', ordem);
    assert.equal(r.estado.reconectando, 0);
    assert.equal(r.estado.canal, 'aberto');
    assert.deepEqual(r.efeitos, []);
  }
  // A ligação que cai com o voltar já mandado: o voltou segue para a senha.
  const quaseVoltando = [
    [canalFechou(1006), [esperar(2000, 'religar:1')]],
    [tempo('religar:1'), [abrir(3), prazo(1)]],
    [abriu(3), [abrirCanal(3)]],
    [CANAL_ABRIU, [voltar(VOLTA_1)]],
    [SEM_CONEXAO, [...DESLIGAR_AS_DUAS, prazo(2)]],
  ];
  seguir(seguir(naReuniaoComChave(), quaseVoltando, naTela), [[voltou(VOLTA_2), [SENHA, camera(true)]]], caida);
});

test('a volta recusada vai ao saiu', () => {
  const RECUSADA = mensagem({ tipo: 'erro', erro: 'invalido' });
  // As duas caíram: a chave que não vale mais não volta, e a pessoa saiu de uma vez. O canal do voltar fecha.
  const naVolta = [SEM_CONEXAO, canalFechou(1006), tempo('reconectar:1'), abriu(3), CANAL_ABRIU];
  let r = rodar(naReuniaoComChave(), ...naVolta, RECUSADA);
  assert.equal(r.estado.tela, 'aviso');
  assert.equal(r.estado.aviso, 'saiu');
  assert.equal(r.estado.canal, 'fechado');
  assert.deepEqual(r.efeitos, [...DESLIGAR_AS_DUAS, FECHAR_CANAL, PARAR_MIDIA, FOCAR]);
  // O Entrar de novo, sem o canal, passa pela espera.
  r = passo(r.estado, clique('entrarDeNovo'));
  assert.equal(r.estado.tela, 'pedindo');
  assert.deepEqual(r.efeitos, [PEDIR_MIDIA, abrir(4), FOCAR]);
  // Só o canal caiu: o religar para, e a reunião segue sem o canal. O prazo dele fica de fora.
  r = rodar(naReuniaoComChave(), canalFechou(1006), tempo('religar:1'), abriu(3), CANAL_ABRIU, RECUSADA);
  assert.equal(r.estado.tela, 'reuniao');
  assert.equal(r.estado.principal, 'noAr');
  assert.equal(r.estado.canal, 'fechado');
  assert.deepEqual(r.efeitos, [FECHAR_CANAL]);
  semMudar(r.estado, tempo('prazo:1'));
  // Sem uma chave que valha, a queda da ligação depois é o saiu, como antes da chave.
  r = passo(r.estado, SEM_CONEXAO);
  assert.equal(r.estado.aviso, 'saiu');
  assert.deepEqual(r.efeitos, [...DESLIGAR_AS_DUAS, PARAR_MIDIA, FOCAR]);
});

test('a volta com a reunião acabada', () => {
  const LINK_INVALIDO = mensagem({ tipo: 'linkInvalido' });
  // As duas caíram: a ligação já não existe, e a reunião que deixou de valer é o fim. As duas ligações descem, o canal
  // do voltar fecha, e a mídia para.
  const naVolta = rodar(naReuniaoComChave(), SEM_CONEXAO, canalFechou(1006), tempo('reconectar:1')).estado;
  let r = rodar(naVolta, abriu(3), CANAL_ABRIU, LINK_INVALIDO);
  assert.equal(r.estado.tela, 'aviso');
  assert.equal(r.estado.aviso, 'linkInvalido');
  assert.equal(r.estado.canal, 'fechado');
  assert.deepEqual(r.efeitos, [...DESLIGAR_AS_DUAS, FECHAR_CANAL, PARAR_MIDIA, FOCAR]);
  // O 404 do abrir do voltar faz o mesmo, sem canal para fechar.
  r = passo(naVolta, abrirFalhou(3, 404));
  assert.equal(r.estado.aviso, 'linkInvalido');
  assert.deepEqual(r.efeitos, [...DESLIGAR_AS_DUAS, PARAR_MIDIA, FOCAR]);
  // Só o canal caiu, com a ligação no ar: quem está na reunião continua nela, mesmo depois do valeAte. O religar para,
  // a reunião segue sem o canal, e nada desce nem aparece.
  const noReligar = rodar(naReuniaoComChave(), canalFechou(1006), tempo('religar:1')).estado;
  for (const [eventos, efeitos] of [
    [[abriu(3), CANAL_ABRIU, LINK_INVALIDO], [FECHAR_CANAL]],
    [[abrirFalhou(3, 404)], []],
  ]) {
    r = rodar(noReligar, ...eventos);
    assert.equal(r.estado.tela, 'reuniao');
    assert.equal(r.estado.aviso, null);
    assert.equal(r.estado.principal, 'noAr');
    assert.equal(r.estado.canal, 'fechado');
    assert.deepEqual(r.efeitos, efeitos);
    semMudar(r.estado, tempo('prazo:1'));
  }
  // A chave fica: a queda da ligação, depois, chega ao fim pela volta das duas.
  const fim = seguir(r.estado, [
    [SEM_CONEXAO, [...DESLIGAR_AS_DUAS, esperar(2000, 'reconectar:2')]],
    [tempo('reconectar:2'), [abrir(4), prazo(2)]],
    [abrirFalhou(4, 404), [...DESLIGAR_AS_DUAS, PARAR_MIDIA, FOCAR]],
  ]);
  assert.equal(fim.aviso, 'linkInvalido');
  // Com a ligação que já terminou sem aviso, o linkInvalido do religar é o fim.
  r = rodar(noReligar, abriu(3), CANAL_ABRIU, ligacao('principal', 'terminou'), LINK_INVALIDO);
  assert.equal(r.estado.aviso, 'linkInvalido');
  assert.deepEqual(r.efeitos, [...DESLIGAR_AS_DUAS, FECHAR_CANAL, PARAR_MIDIA, FOCAR]);
});

test('as falhas da volta contam tentativas', () => {
  // As duas caíram, e a primeira tentativa abre outro canal.
  const primeira = () => rodar(naReuniaoComChave(), SEM_CONEXAO, canalFechou(1006), tempo('reconectar:1')).estado;
  // Nenhum aviso (nem o tentativas do 429): a tela é a da conexão caída.
  const semAviso = (estado) => {
    assert.equal(estado.tela, 'reuniao');
    assert.equal(estado.aviso, null);
    assert.equal(estado.esperarSegundos, 0);
  };
  const terceira = seguir(
    primeira(),
    [
      [abrirFalhou(3, 0), [esperar(4000, 'reconectar:2')]],
      [tempo('reconectar:2'), [abrir(4), prazo(2)]],
      [abrirFalhou(4, 429, 30), [esperar(8000, 'reconectar:3')]],
      [tempo('reconectar:3'), [abrir(5), prazo(3)]],
      [abriu(5), [abrirCanal(5)]],
    ],
    semAviso,
  );
  let r = passo(terceira, canalFechou(1006));
  assert.equal(r.estado.aviso, 'saiu');
  assert.deepEqual(r.efeitos, [...DESLIGAR_AS_DUAS, PARAR_MIDIA, FOCAR]);
  // A terceira falha com o canal do voltar aberto (o voltar já saiu) o fecha junto.
  r = rodar(terceira, CANAL_ABRIU, LIMITE);
  assert.equal(r.estado.aviso, 'saiu');
  assert.deepEqual(r.efeitos, [...DESLIGAR_AS_DUAS, FECHAR_CANAL, PARAR_MIDIA, FOCAR]);
  // Cada falha antes do voltou, na primeira tentativa: a próxima espera 4 segundos e abre outro canal. O canal que já
  // mandou o voltar fecha.
  const falhas = [
    [[abrirFalhou(3, 503)], [esperar(4000, 'reconectar:2')]],
    [[abriu(3), canalFechou(1006)], [esperar(4000, 'reconectar:2')]],
    [[abriu(3), CANAL_ABRIU, canalFechou(1011)], [esperar(4000, 'reconectar:2')]],
    [[abriu(3), CANAL_ABRIU, LIMITE], [FECHAR_CANAL, esperar(4000, 'reconectar:2')]],
  ];
  for (const [eventos, efeitos] of falhas) {
    r = rodar(primeira(), ...eventos);
    semAviso(r.estado);
    assert.equal(r.estado.reconectando, 2);
    assert.equal(r.estado.canal, 'fechado');
    assert.deepEqual(r.efeitos, efeitos);
    assert.deepEqual(passo(r.estado, tempo('reconectar:2')).efeitos, [abrir(4), prazo(2)]);
  }
  // Depois do voltou, o canal é o da pessoa: a recusa do senha e a ligação que falha contam, e a próxima tentativa pede
  // a senha nele, sem abrir outro.
  const voltou2 = rodar(primeira(), abriu(3), CANAL_ABRIU, voltou(VOLTA_2)).estado;
  for (const falha of [
    [mensagem({ tipo: 'semServidor' })],
    [mensagem({ tipo: 'senha', senha: 'senha-r1' }), ligacao('principal', 'falhou', 0)],
  ]) {
    r = rodar(voltou2, ...falha);
    assert.equal(r.estado.reconectando, 2);
    assert.deepEqual(r.efeitos, [esperar(4000, 'reconectar:2')]);
    assert.deepEqual(passo(r.estado, tempo('reconectar:2')).efeitos, [SENHA, prazo(2)]);
  }
  // O canal que cai com a senha pedida também é uma tentativa, e a próxima abre outro canal.
  r = passo(voltou2, canalFechou(1006));
  assert.equal(r.estado.reconectando, 2);
  assert.deepEqual(r.efeitos, [esperar(4000, 'reconectar:2')]);
  assert.deepEqual(passo(r.estado, tempo('reconectar:2')).efeitos, [abrir(4), prazo(2)]);
});

test('a tentativa da volta sem resposta acaba no prazo', () => {
  assert.equal(PRAZO_VOLTA_MS, 10000);
  // As duas caíram, e a primeira tentativa abre outro canal. Em cada passo dela, o prazo que vence sem a resposta do
  // servidor é uma tentativa que falhou, como o canal que cai: o canal em que ela esperava fecha, e a próxima abre
  // outro.
  const naVolta = rodar(naReuniaoComChave(), SEM_CONEXAO, canalFechou(1006), tempo('reconectar:1')).estado;
  const PROXIMA = esperar(4000, 'reconectar:2');
  const fases = [
    [[], [PROXIMA]], // o abrir
    [[abriu(3)], [FECHAR_CANAL, PROXIMA]], // o canal, abrindo
    [[abriu(3), CANAL_ABRIU], [FECHAR_CANAL, PROXIMA]], // o voltar, sem o voltou
    [[abriu(3), CANAL_ABRIU, voltou(VOLTA_2)], [FECHAR_CANAL, PROXIMA]], // o senha, depois do voltou
  ];
  for (const [eventos, efeitos] of fases) {
    const r = passo(rodar(naVolta, ...eventos).estado, tempo('prazo:1'));
    assert.equal(r.estado.tela, 'reuniao');
    assert.equal(r.estado.reconectando, 2);
    assert.equal(r.estado.canal, 'fechado');
    assert.deepEqual(r.efeitos, efeitos);
    assert.deepEqual(passo(r.estado, tempo('reconectar:2')).efeitos, [abrir(4), prazo(2)]);
  }
  // O abriu que chega depois do prazo fica de fora.
  semMudar(passo(naVolta, tempo('prazo:1')).estado, abriu(3));
  // Três tentativas sem resposta: o saiu, depois das esperas de 4 e 8 segundos.
  const fim = seguir(naVolta, [
    [tempo('prazo:1'), [PROXIMA]],
    [tempo('reconectar:2'), [abrir(4), prazo(2)]],
    [tempo('prazo:2'), [esperar(8000, 'reconectar:3')]],
    [tempo('reconectar:3'), [abrir(5), prazo(3)]],
    [abriu(5), [abrirCanal(5)]],
    [CANAL_ABRIU, [voltar(VOLTA_1)]],
    [tempo('prazo:3'), [FECHAR_CANAL, ...DESLIGAR_AS_DUAS, PARAR_MIDIA, FOCAR]],
  ]);
  assert.equal(fim.aviso, 'saiu');
  // Na volta pelo canal que ficou (sem o voltar), o senha sem resposta também vence. Com a chave, a próxima tentativa
  // abre outro canal; sem ela, sem o canal não há como voltar.
  let r = rodar(naReuniaoComChave(), SEM_CONEXAO, tempo('reconectar:1'));
  assert.deepEqual(r.efeitos, [SENHA, prazo(1)]);
  r = passo(r.estado, tempo('prazo:1'));
  assert.deepEqual(r.efeitos, [FECHAR_CANAL, PROXIMA]);
  assert.deepEqual(passo(r.estado, tempo('reconectar:2')).efeitos, [abrir(3), prazo(2)]);
  r = rodar(naReuniao(), SEM_CONEXAO, tempo('reconectar:1'), tempo('prazo:1'));
  assert.equal(r.estado.aviso, 'saiu');
  assert.deepEqual(r.efeitos, [FECHAR_CANAL, ...DESLIGAR_AS_DUAS, PARAR_MIDIA, FOCAR]);
  // Depois do senha, quem decide é a ligação, e o prazo não conta mais. O prazo de uma vez que passou também fica de
  // fora.
  const SENHA_R1 = mensagem({ tipo: 'senha', senha: 'senha-r1' });
  const ligando = rodar(naVolta, abriu(3), CANAL_ABRIU, voltou(VOLTA_2), SENHA_R1);
  assert.deepEqual(ligando.efeitos, [ligar('principal', 'senha-r1')]);
  semMudar(ligando.estado, tempo('prazo:1'));
  semMudar(rodar(naVolta, tempo('prazo:1'), tempo('reconectar:2')).estado, tempo('prazo:1'));
});

test('o religar sem resposta acaba no prazo', () => {
  // Só o canal caiu, e o voltar ficou sem resposta: o prazo fecha o canal dele, e a próxima tentativa vem na espera do
  // religar. A ligação segue no ar, e a tela não mostra nada.
  const parado = rodar(naReuniaoComChave(), canalFechou(1006), tempo('religar:1'), abriu(3), CANAL_ABRIU).estado;
  let r = passo(parado, tempo('prazo:1'));
  assert.equal(r.estado.tela, 'reuniao');
  assert.equal(r.estado.principal, 'noAr');
  assert.equal(r.estado.reconectando, 0);
  assert.equal(r.estado.canal, 'fechado');
  assert.deepEqual(r.efeitos, [FECHAR_CANAL, esperar(4000, 'religar:2')]);
  // Três religares sem resposta: a reunião segue sem o canal, o religar não desiste (a próxima tentativa espera 30 s),
  // e o abriu que chega depois fica de fora.
  const semResposta = seguir(r.estado, [
    [tempo('religar:2'), [abrir(4), prazo(2)]],
    [tempo('prazo:2'), [esperar(8000, 'religar:3')]],
    [tempo('religar:3'), [abrir(5), prazo(3)]],
    [tempo('prazo:3'), [esperar(RELIGAR_DEVAGAR_MS, 'religar:4')]],
  ]);
  assert.equal(semResposta.tela, 'reuniao');
  assert.equal(semResposta.principal, 'noAr');
  assert.equal(semResposta.religando, 4);
  semMudar(semResposta, abriu(5));
  // O voltou que chega a tempo acaba com o prazo.
  semMudar(passo(parado, voltou(VOLTA_2)).estado, tempo('prazo:1'));
  // A volta das duas que toma o voltar parado tem o prazo dela, e o do religar fica de fora.
  const tomou = passo(parado, SEM_CONEXAO);
  assert.deepEqual(tomou.efeitos, [...DESLIGAR_AS_DUAS, prazo(2)]);
  semMudar(tomou.estado, tempo('prazo:1'));
  r = passo(tomou.estado, tempo('prazo:2'));
  assert.equal(r.estado.reconectando, 2);
  assert.deepEqual(r.efeitos, [FECHAR_CANAL, esperar(4000, 'reconectar:3')]);
});

test('o religar do canal não desiste: depois de três, tenta a cada 30 s', () => {
  // A ligação segue no ar o tempo todo, e a tela não mostra nada.
  const segueNaReuniao = (estado) => {
    assert.equal(estado.tela, 'reuniao');
    assert.equal(estado.aviso, null);
    assert.equal(estado.principal, 'noAr');
    assert.equal(estado.reconectando, 0);
  };
  const tres = [canalFechou(1006), tempo('religar:1'), abrirFalhou(3, 0), tempo('religar:2'), abrirFalhou(4, 0)];
  let r = rodar(naReuniaoComChave(), ...tres, tempo('religar:3'), abrirFalhou(5, 0));
  // A terceira falha: a próxima tentativa espera 30 s, e o palco sai (sem o canal, nada o acerta).
  assert.deepEqual(r.efeitos, [esperar(RELIGAR_DEVAGAR_MS, 'religar:4')]);
  assert.equal(r.estado.religando, 4);
  assert.equal(r.estado.palco, null);
  assert.equal(r.estado.tela, 'reuniao');
  assert.equal(r.estado.principal, 'noAr');
  // Daí em diante, uma tentativa de cada vez, sempre a 30 s.
  const voltando = seguir(r.estado, [
    [tempo('religar:4'), [abrir(6), prazo(4)]],
    [tempo('religar:4'), []], // a espera repetida, com a tentativa em curso: nunca dois canais
    [abrirFalhou(6, 503), [esperar(RELIGAR_DEVAGAR_MS, 'religar:5')]],
    [tempo('religar:5'), [abrir(7), prazo(5)]],
    [abriu(7), [abrirCanal(7)]],
    [CANAL_ABRIU, [voltar(VOLTA_1)]],
  ]);
  assert.equal(voltando.religando, 4);
  // O voltou acaba com o religar: o canal é de novo o da pessoa.
  const deVolta = passo(voltando, voltou(VOLTA_2)).estado;
  assert.equal(deVolta.religando, 0);
  assert.equal(deVolta.canal, 'aberto');
  // A terceira falha com o canal do voltar aberto o fecha, e a reunião segue sem ele.
  const desistiu = seguir(
    naReuniaoComChave(),
    [
      [canalFechou(1006), [esperar(2000, 'religar:1')]],
      [tempo('religar:1'), [abrir(3), prazo(1)]],
      [abrirFalhou(3, 429, 30), [esperar(4000, 'religar:2')]],
      [tempo('religar:2'), [abrir(4), prazo(2)]],
      [abriu(4), [abrirCanal(4)]],
      [canalFechou(1006), [esperar(8000, 'religar:3')]],
      [tempo('religar:3'), [abrir(5), prazo(3)]],
      [abriu(5), [abrirCanal(5)]],
      [CANAL_ABRIU, [voltar(VOLTA_1)]],
      [LIMITE, [FECHAR_CANAL, esperar(RELIGAR_DEVAGAR_MS, 'religar:4')]],
    ],
    segueNaReuniao,
  );
  assert.equal(desistiu.canal, 'fechado');
  assert.equal(desistiu.religando, 4);
  semMudar(desistiu, tempo('prazo:3'));
  assert.deepEqual(passo(desistiu, { tipo: 'telaCapturada', ok: true }).efeitos, [PARAR_CAPTURA]);
  // Uma falha no meio com o canal do voltar aberto também o fecha, e a próxima tentativa espera mais.
  const voltandoDeNovo = [canalFechou(1006), tempo('religar:1'), abriu(3), CANAL_ABRIU];
  r = rodar(naReuniaoComChave(), ...voltandoDeNovo, LIMITE);
  segueNaReuniao(r.estado);
  assert.equal(r.estado.canal, 'fechado');
  assert.deepEqual(r.efeitos, [FECHAR_CANAL, esperar(4000, 'religar:2')]);
  // A queda da ligação, depois, é a volta das duas: a chave ainda vale, e o religar devagar acaba.
  seguir(desistiu, [
    [SEM_CONEXAO, [...DESLIGAR_AS_DUAS, esperar(2000, 'reconectar:5')]],
    [tempo('reconectar:5'), [abrir(6), prazo(5)]],
    [abriu(6), [abrirCanal(6)]],
    [CANAL_ABRIU, [voltar(VOLTA_1)]],
    [voltou(VOLTA_2), [SENHA, camera(true)]],
  ]);
});

test('o compartilhar volta com o canal', () => {
  const CAPTURADA = { tipo: 'telaCapturada', ok: true };
  // O pedido da tela que esperava a senha pelo canal que caiu para, e o canal volta por trás.
  let r = rodar(naReuniaoComChave(), CAPTURADA, canalFechou(1006));
  assert.equal(r.estado.telaCompartilhada, 'nenhuma');
  assert.deepEqual(r.efeitos, [PARAR_CAPTURA, esperar(2000, 'religar:1')]);
  // Enquanto o canal volta (no prazo, abrindo e esperando o voltou), a captura para.
  const caiu = r.estado;
  const abrindo = [tempo('religar:1'), abriu(3)];
  for (const eventos of [[], abrindo, [...abrindo, CANAL_ABRIU]]) {
    assert.deepEqual(passo(rodar(caiu, ...eventos).estado, CAPTURADA).efeitos, [PARAR_CAPTURA]);
  }
  // Depois do voltou, o compartilhar pede a senha da tela pelo canal de novo.
  r = rodar(caiu, ...abrindo, CANAL_ABRIU, voltou(VOLTA_2), CAPTURADA);
  assert.equal(r.estado.telaCompartilhada, 'pedindo');
  assert.deepEqual(r.efeitos, [mandar({ tipo: 'tela' })]);
  r = passo(r.estado, mensagem({ tipo: 'tela', senha: 'senha-tela' }));
  assert.deepEqual(r.efeitos, [ligar('tela', 'senha-tela')]);
});

test('os eventos velhos da volta não mexem', () => {
  const noReligar = passo(naReuniaoComChave(), canalFechou(1006)).estado;
  const naVolta = rodar(naReuniaoComChave(), SEM_CONEXAO, canalFechou(1006)).estado;
  // O abriu sem um abrir que espere (o abrir 2, o do pedido, já respondeu): na reunião, e nos prazos do religar e da
  // volta das duas.
  for (const e of [naReuniaoComChave(), noReligar, naVolta]) semMudar(e, abriu(2));
  // O voltou fora de um religar: no canal da pessoa, também depois de o religar voltar. A espera e o prazo dele também.
  const religado = rodar(noReligar, tempo('religar:1'), abriu(3), CANAL_ABRIU, voltou(VOLTA_2)).estado;
  for (const e of [naReuniaoComChave(), religado]) semMudar(e, voltou(VOLTA_3));
  semMudar(religado, tempo('religar:1'));
  semMudar(religado, tempo('prazo:1'));
  // Uma espera que chega de novo, com o voltar em curso, não abre outro canal: a do religar (o abrir saindo, o canal
  // abrindo e o voltar mandado), e a da volta que tomou o voltar do religar.
  const canalAbrindo = [tempo('religar:1'), abriu(3)];
  for (const eventos of [[tempo('religar:1')], canalAbrindo, [...canalAbrindo, CANAL_ABRIU]]) {
    const e = rodar(noReligar, ...eventos).estado;
    semMudar(e, tempo('religar:1'));
    semMudar(passo(e, SEM_CONEXAO).estado, tempo('reconectar:2'));
  }
  // A espera do religar depois do Sair.
  semMudar(passo(noReligar, clique('sair')).estado, tempo('religar:1'));
  // A página que desiste da volta fecha o canal do voltar, e o que ainda viesse dele fica de fora. O fim sem aviso da
  // ligação com o canal do religar abrindo:
  const abrindo = rodar(noReligar, ...canalAbrindo, ligacao('principal', 'terminou')).estado;
  let r = passo(abrindo, tempo('fimSemAviso'));
  assert.equal(r.estado.aviso, 'saiu');
  assert.deepEqual(r.efeitos, [...DESLIGAR_AS_DUAS, FECHAR_CANAL, PARAR_MIDIA, FOCAR]);
  semMudar(r.estado, CANAL_ABRIU);
  // o Sair na volta das duas, com o voltar já mandado,
  r = passo(rodar(naVolta, tempo('reconectar:1'), abriu(3), CANAL_ABRIU).estado, clique('sair'));
  assert.deepEqual(r.efeitos, [...DESLIGAR_AS_DUAS, FECHAR_CANAL, PARAR_MIDIA, FOCAR]);
  semMudar(r.estado, voltou(VOLTA_2));
  // e o Sair com o abrir saindo, sem canal para fechar.
  r = passo(passo(naVolta, tempo('reconectar:1')).estado, clique('sair'));
  assert.deepEqual(r.efeitos, [...DESLIGAR_AS_DUAS, PARAR_MIDIA, FOCAR]);
  semMudar(r.estado, abriu(3));
  semMudar(r.estado, abrirFalhou(3, 0));
});

test('a resposta de um abrir que passou fica de fora', () => {
  // A pessoa sai com o abrir da volta ainda sem resposta, e o Entrar de novo abre outro: a resposta do de antes (o
  // abriu, ou o abrirFalhou da rede) não mexe no pedido novo.
  const SAIR = clique('sair');
  const ENTRAR_DE_NOVO = clique('entrarDeNovo');
  const r = rodar(naReuniaoComChave(), SEM_CONEXAO, canalFechou(1006), tempo('reconectar:1'), SAIR, ENTRAR_DE_NOVO);
  assert.equal(r.estado.tela, 'pedindo');
  assert.deepEqual(r.efeitos, [PEDIR_MIDIA, abrir(4), FOCAR]);
  semMudar(r.estado, abriu(3));
  semMudar(r.estado, abrirFalhou(3, 0));
  assert.deepEqual(passo(r.estado, abriu(4)).efeitos, [abrirCanal(4)]);
  // O mesmo com o Desistir e outro Pedir.
  const pedindoDeNovo = rodar(naEntrada(), clique('pedir'), clique('desistir'), clique('pedir')).estado;
  semMudar(pedindoDeNovo, abriu(2));
  semMudar(pedindoDeNovo, abrirFalhou(2, 0));
  assert.deepEqual(passo(pedindoDeNovo, abriu(3)).efeitos, [abrirCanal(3)]);
});

test('as esperas de uma vez que passou ficam de fora', () => {
  // A espera da volta que ficou para trás com o Sair: o Entrar de novo, pelo canal aberto, volta à reunião, e a ligação
  // cai de novo. A espera velha não começa a tentativa antes da hora.
  const deNovo = [clique('sair'), clique('entrarDeNovo'), midia('ligado', 'ligado')];
  const ligouDeNovo = [mensagem({ tipo: 'senha', senha: 'senha-2' }), ligacao('principal', 'confirmada')];
  let r = rodar(naReuniao(), SEM_CONEXAO, ...deNovo, ...ligouDeNovo, SEM_CONEXAO);
  assert.deepEqual(r.efeitos, [...DESLIGAR_AS_DUAS, esperar(2000, 'reconectar:2')]);
  semMudar(r.estado, tempo('reconectar:1'));
  assert.deepEqual(passo(r.estado, tempo('reconectar:2')).efeitos, [SENHA, prazo(2)]);
  // A espera do religar que a volta das duas tomou: depois da volta, o canal cai no ligar, e o religar novo (depois do
  // confirmada) não começa antes da hora com a espera velha.
  const SENHA_R1 = mensagem({ tipo: 'senha', senha: 'senha-r1' });
  const volta = [tempo('reconectar:2'), abriu(3), CANAL_ABRIU, voltou(VOLTA_2), SENHA_R1];
  r = rodar(naReuniaoComChave(), canalFechou(1006), SEM_CONEXAO, ...volta, canalFechou(1006));
  r = passo(r.estado, ligacao('principal', 'confirmada'));
  assert.deepEqual(r.efeitos, [esperar(2000, 'religar:3')]);
  semMudar(r.estado, tempo('religar:1'));
  assert.deepEqual(passo(r.estado, tempo('religar:3')).efeitos, [abrir(4), prazo(3)]);
});

test('o voltou no fim sem aviso deixa o tirado chegar', () => {
  // A ligação termina sem aviso com o religar no meio, e o voltou chega no prazo: o canal é de novo o da pessoa, e o
  // tirado chega a ela.
  const voltando = [canalFechou(1006), tempo('religar:1'), abriu(3), CANAL_ABRIU];
  let r = rodar(naReuniaoComChave(), ...voltando, ligacao('principal', 'terminou'));
  assert.deepEqual(r.efeitos, [esperar(2000, 'fimSemAviso')]);
  r = passo(r.estado, voltou(VOLTA_2));
  assert.equal(r.estado.canal, 'aberto');
  assert.deepEqual(r.efeitos, [camera(true)]);
  r = passo(r.estado, mensagem({ tipo: 'tirado' }));
  assert.equal(r.estado.aviso, 'tirado');
  assert.deepEqual(r.efeitos, [...DESLIGAR_AS_DUAS, PARAR_MIDIA, FOCAR]);
  semMudar(r.estado, tempo('fimSemAviso'));
});

test('o voltou sem a chave nova deixa a página sem chave', () => {
  // O voltou sem a volta religa o canal, mas não deixa chave: o canal que cai depois fica fechado, e a queda da ligação
  // é o saiu, como antes da chave.
  const voltando = [canalFechou(1006), tempo('religar:1'), abriu(3), CANAL_ABRIU];
  let r = rodar(naReuniaoComChave(), ...voltando, mensagem({ tipo: 'voltou' }));
  assert.equal(r.estado.canal, 'aberto');
  assert.deepEqual(r.efeitos, [camera(true)]);
  r = passo(r.estado, canalFechou(1006));
  assert.equal(r.estado.canal, 'fechado');
  assert.deepEqual(r.efeitos, []);
  r = passo(r.estado, SEM_CONEXAO);
  assert.equal(r.estado.aviso, 'saiu');
  assert.deepEqual(r.efeitos, [...DESLIGAR_AS_DUAS, PARAR_MIDIA, FOCAR]);
});

test('a chave não aparece no que a página mostra', () => {
  // A chave e o participante ficam só no campo da chave, que a página não desenha, e saem só no voltar. O bilhete da
  // volta, como o do pedido, não fica no estado.
  const segredos = ['participante-1', VOLTA_1, VOLTA_2];
  const voltares = [];
  let r = { estado: aguardando(), efeitos: [] };
  for (const evento of [
    mensagem(ACEITO_COM_CHAVE),
    ligacao('principal', 'confirmada'),
    canalFechou(1006),
    tempo('religar:1'),
    abriu(3),
    CANAL_ABRIU,
    voltou(VOLTA_2),
    SEM_CONEXAO,
    canalFechou(1006),
    tempo('reconectar:2'),
    abriu(4),
    CANAL_ABRIU,
    mensagem({ tipo: 'erro', erro: 'invalido' }),
  ]) {
    r = passo(r.estado, evento);
    const { chave, ...mostrado } = r.estado;
    const outrosEfeitos = r.efeitos.filter((efeito) => efeito.m?.tipo !== 'voltar');
    voltares.push(...r.efeitos.filter((efeito) => efeito.m?.tipo === 'voltar'));
    for (const segredo of segredos) {
      assert.ok(!JSON.stringify([mostrado, outrosEfeitos]).includes(segredo), `${segredo} em ${evento.tipo}`);
    }
    assert.ok(!JSON.stringify(r.estado).includes('bilhete-'));
  }
  // A chave foi do aceito ao primeiro voltar, e a do voltou ao segundo.
  assert.deepEqual(voltares, [voltar(VOLTA_1), voltar(VOLTA_2)]);
  // A chave recusada sai do estado.
  assert.equal(r.estado.aviso, 'saiu');
  assert.ok(!JSON.stringify(r.estado).includes(VOLTA_2));
});

test('a tela do começo ao fim', () => {
  let r = passo(naReuniao(), { tipo: 'telaCapturada', ok: true });
  assert.equal(r.estado.telaCompartilhada, 'pedindo');
  assert.deepEqual(r.efeitos, [mandar({ tipo: 'tela' })]);
  r = passo(r.estado, mensagem({ tipo: 'tela', senha: 'senha-tela' }));
  assert.equal(r.estado.telaCompartilhada, 'ligando');
  assert.deepEqual(r.efeitos, [ligar('tela', 'senha-tela')]);
  r = passo(r.estado, ligacao('tela', 'confirmada'));
  assert.equal(r.estado.telaCompartilhada, 'noAr');
  assert.deepEqual(r.efeitos, []);
  r = passo(r.estado, clique('pararDeCompartilhar'));
  assert.deepEqual(r.efeitos, [{ tipo: 'desligar', qual: 'tela' }]);
  r = passo(r.estado, ligacao('tela', 'terminou'));
  assert.equal(r.estado.telaCompartilhada, 'nenhuma');
  assert.deepEqual(r.efeitos, [PARAR_CAPTURA]);
  assert.equal(r.estado.tela, 'reuniao');
  // A escolha da tela cancelada não faz nada.
  semMudar(naReuniao(), { tipo: 'telaCapturada', ok: false });
  // Com o canal fechado, a captura para.
  const semCanal = passo(naReuniao(), canalFechou(1006)).estado;
  const capturada = passo(semCanal, { tipo: 'telaCapturada', ok: true });
  assert.deepEqual(capturada, { estado: semCanal, efeitos: [PARAR_CAPTURA] });
});

test('o tela respondido com o semServidor para a captura', () => {
  // Sem o vídeo no ar para o chat, o servidor responde o tela com o semServidor: o compartilhar para, como no erro, e a
  // reunião continua, com a principal no ar.
  const pedindoATela = passo(naReuniao(), { tipo: 'telaCapturada', ok: true }).estado;
  let r = passo(pedindoATela, mensagem({ tipo: 'semServidor' }));
  assert.equal(r.estado.telaCompartilhada, 'nenhuma');
  assert.equal(r.estado.tela, 'reuniao');
  assert.equal(r.estado.principal, 'noAr');
  assert.deepEqual(r.efeitos, [PARAR_CAPTURA]);
  // A pessoa pode compartilhar de novo.
  r = passo(r.estado, { tipo: 'telaCapturada', ok: true });
  assert.equal(r.estado.telaCompartilhada, 'pedindo');
  assert.deepEqual(r.efeitos, [mandar({ tipo: 'tela' })]);
  // Sem o pedido da tela, o semServidor na reunião continua sem efeito.
  semMudar(naReuniao(), mensagem({ tipo: 'semServidor' }));
});

test('a câmera e o microfone', () => {
  // Na entrada, o clique só troca o estado.
  let r = passo(naEntrada(), clique('camera'));
  assert.equal(r.estado.cam, 'desligado');
  assert.deepEqual(r.efeitos, []);
  r = passo(r.estado, clique('microfone'));
  assert.equal(r.estado.mic, 'desligado');
  assert.deepEqual(r.efeitos, []);
  // Na reunião, a ligação troca também.
  r = passo(naReuniao(), clique('microfone'));
  assert.equal(r.estado.mic, 'desligado');
  assert.deepEqual(r.efeitos, [{ tipo: 'trocarMicrofone', ligado: false }]);
  r = passo(naReuniao(), clique('camera'));
  assert.equal(r.estado.cam, 'desligado');
  assert.deepEqual(r.efeitos, [{ tipo: 'trocarCamera', ligada: false }, camera(false)]);
  r = rodar(r.estado, { tipo: 'cameraTrocada', ok: true }, clique('camera'));
  assert.equal(r.estado.cam, 'ligado');
  assert.deepEqual(r.efeitos, [{ tipo: 'trocarCamera', ligada: true }, camera(true)]);
  // A câmera que não ligou volta ao que era.
  r = passo(r.estado, { tipo: 'cameraTrocada', ok: false });
  assert.equal(r.estado.cam, 'desligado');
  assert.deepEqual(r.efeitos, [camera(false)]);
  semMudar(r.estado, { tipo: 'cameraTrocada', ok: true });
  // O indisponível não troca.
  const semNada = naEntrada('indisponivel', 'indisponivel');
  semMudar(semNada, clique('camera'));
  semMudar(semNada, clique('microfone'));
});

test('a câmera troca uma vez de cada vez', () => {
  // Com uma troca pendente na reunião, outro clique na Câmera fica de fora: o cameraTrocada responde ao clique
  // pendente.
  const pendente = passo(naReuniao(), clique('camera')).estado;
  semMudar(pendente, clique('camera'));
  // O Microfone não espera a câmera.
  assert.deepEqual(passo(pendente, clique('microfone')).efeitos, [{ tipo: 'trocarMicrofone', ligado: false }]);
  // A resposta que chega fora da reunião não troca a câmera: depois do Sair, depois da conexão caída (a volta liga com
  // a escolha do estado), e sem troca pendente.
  semMudar(passo(pendente, clique('sair')).estado, { tipo: 'cameraTrocada', ok: false });
  const caiu = passo(pendente, SEM_CONEXAO).estado;
  assert.equal(caiu.cam, 'desligado');
  semMudar(caiu, { tipo: 'cameraTrocada', ok: false });
  semMudar(naEntrada(), { tipo: 'cameraTrocada', ok: false });
});

// O aviso da câmera: com o estado aceito e o canal aberto, a página diz se a câmera está ligada. Ele sai quando o
// canal passa a ser o da pessoa (o aceito, o voltou) e a cada mudança do ligado; o servidor responde o erro invalido a
// um aviso antes do aceito.
test('o aceito manda a câmera', () => {
  for (const antes of [aguardando(), pedindo()]) {
    assert.deepEqual(passo(antes, mensagem(ACEITO)).efeitos, [ligar('principal', 'senha-1'), camera(true), FOCAR]);
  }
  // Com a Câmera desligada na entrada, ou faltando, ela vai desligada.
  const desligada = rodar(naEntrada(), clique('camera'), clique('pedir'), abriu(2), CANAL_ABRIU);
  assert.deepEqual(passo(desligada.estado, mensagem(ACEITO)).efeitos, [
    ligar('principal', 'senha-1'),
    camera(false),
    FOCAR,
  ]);
  const faltando = rodar(naEntrada('ligado', 'indisponivel'), clique('pedir'), abriu(2), CANAL_ABRIU);
  assert.deepEqual(passo(faltando.estado, mensagem(ACEITO)).efeitos, [
    ligar('principal', 'senha-1'),
    camera(false),
    FOCAR,
  ]);
  // A senha guardada até a mídia chegar não muda o aviso: ele sai no aceito, e a mídia que chega igual não manda outro.
  const semMidia = rodar(inicial(), COMECAR, abriu(1), { tipo: 'nome', valor: 'Maria Lima' }, clique('pedir'));
  const aceito = rodar(semMidia.estado, abriu(2), CANAL_ABRIU, mensagem(ACEITO));
  assert.deepEqual(aceito.efeitos, [camera(true), FOCAR]);
  assert.deepEqual(passo(aceito.estado, midia('ligado', 'ligado')).efeitos, [ligar('principal', 'senha-1')]);
});

test('o voltou manda a câmera de novo', () => {
  // No religar: o canal novo é o da pessoa quando o voltou chega, e o aviso vai com a câmera daquela hora.
  const caiu = passo(naReuniaoComChave(), canalFechou(1006)).estado;
  const voltando = rodar(caiu, tempo('religar:1'), abriu(3), CANAL_ABRIU).estado;
  assert.deepEqual(passo(voltando, voltou(VOLTA_2)).efeitos, [camera(true)]);
  const desligouSemCanal = rodar(caiu, clique('camera'), { tipo: 'cameraTrocada', ok: true }).estado;
  const voltandoDesligada = rodar(desligouSemCanal, tempo('religar:1'), abriu(3), CANAL_ABRIU).estado;
  assert.deepEqual(passo(voltandoDesligada, voltou(VOLTA_2)).efeitos, [camera(false)]);
  // Na volta depois das duas conexões caídas, o aviso vai depois do senha.
  const naVolta = rodar(caiu, SEM_CONEXAO, tempo('reconectar:2'), abriu(3), CANAL_ABRIU).estado;
  assert.equal(naVolta.canal, 'voltando');
  assert.deepEqual(passo(naVolta, voltou(VOLTA_2)).efeitos, [SENHA, camera(true)]);
});

test('a Câmera trocada na reunião manda na hora', () => {
  let r = passo(naReuniao(), clique('camera'));
  assert.deepEqual(r.efeitos, [{ tipo: 'trocarCamera', ligada: false }, camera(false)]);
  // A câmera que não ligou volta ao que era, e o aviso também.
  r = rodar(r.estado, { tipo: 'cameraTrocada', ok: true }, clique('camera'));
  assert.deepEqual(r.efeitos, [{ tipo: 'trocarCamera', ligada: true }, camera(true)]);
  r = passo(r.estado, { tipo: 'cameraTrocada', ok: false });
  assert.equal(r.estado.cam, 'desligado');
  assert.deepEqual(r.efeitos, [camera(false)]);
  // O cameraTrocada que dá certo não muda o ligado: nada vai.
  r = passo(naReuniao(), clique('camera'));
  assert.deepEqual(passo(r.estado, { tipo: 'cameraTrocada', ok: true }).efeitos, []);
  // O Microfone não é a câmera.
  assert.deepEqual(passo(naReuniao(), clique('microfone')).efeitos, [{ tipo: 'trocarMicrofone', ligado: false }]);
});

test('a câmera que passa a faltar manda desligada', () => {
  const r = passo(naReuniao(), midia('ligado', 'indisponivel'));
  assert.equal(r.estado.cam, 'indisponivel');
  assert.deepEqual(r.efeitos, [camera(false)]);
  // A desligada que passa a faltar continua desligada para o servidor: nada vai.
  const desligada = rodar(naReuniao(), clique('camera'), { tipo: 'cameraTrocada', ok: true }).estado;
  assert.deepEqual(passo(desligada, midia('ligado', 'indisponivel')).efeitos, []);
  // O microfone que passa a faltar também não.
  assert.deepEqual(passo(naReuniao(), midia('indisponivel', 'ligado')).efeitos, []);
});

// O microfone que a ligação trocou e que acaba sozinho: a ligação diz só o microfone, porque não sabe se a câmera sem
// faixa está desligada ou falta. A câmera fica como estava.
test('o midia só do microfone deixa a câmera como estava', () => {
  const desligada = rodar(naReuniao(), clique('camera'), { tipo: 'cameraTrocada', ok: true }).estado;
  const faltando = passo(naReuniao(), midia('ligado', 'indisponivel')).estado;
  for (const [antes, cam] of [
    [naReuniao(), 'ligado'],
    [desligada, 'desligado'],
    [faltando, 'indisponivel'],
  ]) {
    const r = passo(antes, { tipo: 'midia', mic: 'indisponivel' });
    assert.equal(r.estado.mic, 'indisponivel', cam);
    assert.equal(r.estado.cam, cam);
    assert.deepEqual(r.efeitos, [], cam);
  }
});

test('sem o canal aberto, nada vai', () => {
  const trocou = [{ tipo: 'trocarCamera', ligada: false }];
  // O canal fechado (sem a chave, ou à espera do religar), abrindo e voltando.
  const fechado = passo(naReuniao(), canalFechou(1006)).estado;
  const caiu = passo(naReuniaoComChave(), canalFechou(1006)).estado;
  const abrindo = rodar(caiu, tempo('religar:1'), abriu(3)).estado;
  const voltando = passo(abrindo, CANAL_ABRIU).estado;
  assert.deepEqual(
    [fechado, caiu, abrindo, voltando].map((e) => e.canal),
    ['fechado', 'fechado', 'abrindo', 'voltando'],
  );
  for (const e of [fechado, caiu, abrindo, voltando]) assert.deepEqual(passo(e, clique('camera')).efeitos, trocou);
  // A câmera que passa a faltar sem o canal também não manda.
  assert.deepEqual(passo(voltando, midia('ligado', 'indisponivel')).efeitos, []);
});

test('antes do aceito, nada vai', () => {
  for (const antes of [naEntrada(), pedindo(), aguardando()]) {
    const r = passo(antes, clique('camera'));
    assert.equal(r.estado.cam, 'desligado');
    assert.deepEqual(r.efeitos, []);
  }
  assert.deepEqual(passo(aguardando(), midia('ligado', 'indisponivel')).efeitos, []);
});

test('o palco fica no estado', () => {
  // O que vale, depois do aceito, fica no estado, só com os campos conhecidos, e não pede nada.
  let r = passo(entrando(), mensagem(PALCO));
  assert.deepEqual(r.estado.palco, PALCO_LIDO);
  assert.deepEqual(r.efeitos, []);
  r = passo(naReuniao(), mensagem(PALCO));
  assert.deepEqual(r.estado.palco, PALCO_LIDO);
  const comPalco = r.estado;
  // Antes do aceito, ele fica de fora.
  for (const antes of [pedindo(), aguardando()]) semMudar(antes, mensagem(PALCO));
  // O que não vale também fica de fora, e leva o anterior junto: um palco que não vale prova que o anterior ficou
  // velho.
  for (const ruim of [
    { ...PALCO, largura: 0 },
    { ...PALCO, quadros: 'nenhum' },
  ]) {
    r = passo(comPalco, mensagem(ruim));
    assert.equal(r.estado.palco, null);
    assert.deepEqual(r.efeitos, []);
  }
  // Um palco novo toma o lugar do anterior; o sem quadros também vale.
  const vazio = { tipo: 'palco', largura: 1280, altura: 720, quadros: [] };
  assert.deepEqual(passo(comPalco, mensagem(vazio)).estado.palco, { largura: 1280, altura: 720, quadros: [] });
  // O fim da reunião e todo aviso o tiram.
  for (const fim of [clique('sair'), mensagem({ tipo: 'tirado' }), mensagem({ tipo: 'encerrada' })]) {
    assert.equal(passo(comPalco, fim).estado.palco, null);
  }
  const semServidor = rodar(entrando(), mensagem(PALCO), ligacao('principal', 'falhou'));
  assert.equal(semServidor.estado.aviso, 'semServidor');
  assert.equal(semServidor.estado.palco, null);
  // O aceito seguinte começa sem palco: o do Entrar de novo pela espera, e o que chega com um palco velho no estado.
  // Os eventos o alcançam: um palco que chega com um aviso na tela fica guardado (de propósito), e, com a chave, o canal
  // que cai depois não o tira; o Tentar de novo leva a página à espera com ele.
  const deNovo = rodar(comPalco, canalFechou(1006), clique('sair'), clique('entrarDeNovo'), abriu(3), CANAL_ABRIU);
  assert.equal(passo(deNovo.estado, mensagem(ACEITO)).estado.palco, null);
  const velho = rodar(
    aguardando(),
    mensagem(ACEITO_COM_CHAVE),
    ligacao('principal', 'falhou'),
    mensagem(PALCO),
    canalFechou(1006),
    clique('tentarDeNovo'),
    abriu(3),
    CANAL_ABRIU,
  ).estado;
  assert.equal(velho.tela, 'pedindo');
  assert.equal(velho.aceito, false);
  assert.deepEqual(velho.palco, PALCO_LIDO);
  assert.equal(passo(velho, mensagem(ACEITO)).estado.palco, null);
  assert.equal(passo({ ...aguardando(), palco: PALCO_LIDO }, mensagem(ACEITO)).estado.palco, null);
  // A conexão caída não o tira: a página volta para a mesma reunião, e o canal que cai também não.
  const comChave = passo(naReuniaoComChave(), mensagem(PALCO)).estado;
  assert.equal(passo(comChave, SEM_CONEXAO).estado.palco, comChave.palco);
  assert.equal(passo(comChave, canalFechou(1006)).estado.palco, comChave.palco);
});

test('o palco sai quando a página desiste do canal e fica na reunião', () => {
  // Sem o canal, nada mais acerta o palco: quem pegasse a célula de quem saiu apareceria com o nome dele. A pessoa
  // continua na reunião, com a ligação no ar, e os quadros voltam ao mosaico inteiro.
  const RECUSADA = mensagem({ tipo: 'erro', erro: 'invalido' });
  const LINK_INVALIDO = mensagem({ tipo: 'linkInvalido' });
  const comChave = passo(naReuniaoComChave(), mensagem(PALCO)).estado;
  const semChave = passo(naReuniao(), mensagem(PALCO)).estado;
  // Enquanto a página tenta voltar, o palco fica: as tentativas costumam levar poucos segundos.
  const tentando = (estado) => assert.deepEqual(estado.palco, PALCO_LIDO);
  const noReligar = seguir(
    comChave,
    [
      [canalFechou(1006), [esperar(2000, 'religar:1')]],
      [tempo('religar:1'), [abrir(3), prazo(1)]],
    ],
    tentando,
  );
  const voltando = seguir(
    noReligar,
    [
      [abriu(3), [abrirCanal(3)]],
      [CANAL_ABRIU, [voltar(VOLTA_1)]],
    ],
    tentando,
  );
  // A terceira tentativa que falha: as duas primeiras ainda guardam o palco.
  const naTerceira = seguir(
    noReligar,
    [
      [abrirFalhou(3, 503), [esperar(4000, 'religar:2')]],
      [tempo('religar:2'), [abrir(4), prazo(2)]],
      [tempo('prazo:2'), [esperar(8000, 'religar:3')]],
      [tempo('religar:3'), [abrir(5), prazo(3)]],
    ],
    tentando,
  );
  // O religar que para fica em 0; na terceira tentativa que falha ele segue, devagar (o 4), e o palco sai assim mesmo.
  const desistencias = {
    'o voltar respondido com o erro invalido': [passo(voltando, RECUSADA), 0],
    'o linkInvalido do voltar': [passo(voltando, LINK_INVALIDO), 0],
    'o 404 do abrir do voltar': [passo(noReligar, abrirFalhou(3, 404)), 0],
    'a terceira tentativa que falha': [passo(naTerceira, tempo('prazo:3')), 4],
    'o canal que fecha sem a chave': [passo(semChave, canalFechou(1006)), 0],
  };
  for (const [caso, [r, religando]] of Object.entries(desistencias)) {
    assert.equal(r.estado.tela, 'reuniao', caso);
    assert.equal(r.estado.aviso, null, caso);
    assert.equal(r.estado.principal, 'noAr', caso);
    assert.equal(r.estado.canal, 'fechado', caso);
    assert.equal(r.estado.religando, religando, caso);
    assert.equal(r.estado.palco, null, caso);
    // Um palco que chega depois, num canal que não é o da pessoa, continua de fora.
    semMudar(r.estado, mensagem(PALCO));
  }
});

test('o erro do servidor não é resposta ao aviso da câmera', () => {
  // O aviso da câmera nunca tem resposta, nem além do limite dele (30 por minuto por canal), que o servidor ignora
  // calado. Um erro que chega depois dele é de outra coisa pendente, como hoje: o erro limite (o limite geral de 20
  // mensagens por minuto, por exemplo no pedido da tela) com a tela pedindo a senha continua parando o compartilhar, e
  // sem nada pendente ele não faz nada.
  const avisou = passo(naReuniao(), clique('camera'));
  assert.deepEqual(avisou.efeitos.at(-1), camera(false));
  semMudar(avisou.estado, LIMITE);
  const r = rodar(avisou.estado, { tipo: 'telaCapturada', ok: true }, LIMITE);
  assert.equal(r.estado.telaCompartilhada, 'nenhuma');
  assert.equal(r.estado.tela, 'reuniao');
  assert.deepEqual(r.efeitos, [PARAR_CAPTURA]);
});

test('a mídia que chega guarda a escolha da pessoa', () => {
  // A câmera desligada antes da resposta do navegador continua desligada.
  let r = rodar(inicial(), COMECAR, abriu(1), clique('camera'), midia('ligado', 'ligado'));
  assert.equal(r.estado.mic, 'ligado');
  assert.equal(r.estado.cam, 'desligado');
  // Sem a permissão, o Tentar de novo da entrada pede a mídia outra vez.
  r = passo(naEntrada('indisponivel', 'indisponivel'), clique('tentarMidia'));
  assert.deepEqual(r.efeitos, [PEDIR_MIDIA]);
  r = passo(r.estado, midia('ligado', 'indisponivel'));
  assert.equal(r.estado.mic, 'ligado');
  assert.equal(r.estado.cam, 'indisponivel');
});

test('a mídia que chega depois do fim para', () => {
  // O Entrar de novo pede a mídia, e o fim chega antes dela.
  const entrandoDeNovo = passo(saiu(), clique('entrarDeNovo')).estado;
  const semCanal = rodar(naReuniao(), canalFechou(1006), clique('sair'), clique('entrarDeNovo')).estado;
  const fins = [
    passo(entrandoDeNovo, clique('sair')).estado, // o Sair
    passo(entrandoDeNovo, mensagem({ tipo: 'linkInvalido' })).estado, // o linkInvalido em resposta ao senha
    passo(semCanal, abrirFalhou(3, 404)).estado, // o 404 do abrir, com o canal fechado
  ];
  assert.deepEqual(
    fins.map((f) => f.aviso),
    ['saiu', 'linkInvalido', 'linkInvalido'],
  );
  // A mídia que a página não quer mais para logo, e não muda a escolha da pessoa.
  for (const fim of fins) {
    const r = passo(fim, midia('indisponivel', 'indisponivel'));
    assert.equal(r.estado.aviso, fim.aviso);
    assert.equal(r.estado.mic, fim.mic);
    assert.equal(r.estado.cam, fim.cam);
    assert.deepEqual(r.efeitos, [PARAR_MIDIA]);
  }
  // Num aviso com o Tentar de novo, a mídia fica: o Tentar de novo vai precisar dela.
  const r = rodar(semCanal, abrirFalhou(3, 0), midia('ligado', 'ligado'));
  assert.equal(r.estado.aviso, 'semServidor');
  assert.deepEqual(r.efeitos, []);
});

test('o canal que cai na espera é o semServidor', () => {
  let r = passo(aguardando(), canalFechou(1006));
  assert.equal(r.estado.tela, 'aviso');
  assert.equal(r.estado.aviso, 'semServidor');
  assert.equal(r.estado.canal, 'fechado');
  assert.deepEqual(r.efeitos, [FOCAR]);
  // O canal que nem abriu (o bilhete vencido, por exemplo) também.
  r = rodar(naEntrada(), clique('pedir'), abriu(2), canalFechou(1006));
  assert.equal(r.estado.aviso, 'semServidor');
  assert.deepEqual(passo(r.estado, clique('tentarDeNovo')).efeitos, [abrir(3), FOCAR]);
});

test('os erros do canal', () => {
  // O erro que responde ao senha da volta (o limite de 5 por minuto) é uma tentativa que falhou.
  const limite = mensagem({ tipo: 'erro', erro: 'limite' });
  let r = rodar(naReuniao(), SEM_CONEXAO, tempo('reconectar:1'), limite);
  assert.equal(r.estado.reconectando, 2);
  assert.deepEqual(r.efeitos, [esperar(4000, 'reconectar:2')]);
  // O senha recusado ao entrar é o semServidor.
  r = rodar(entrando(), ligacao('principal', 'falhou', 403), mensagem({ tipo: 'erro', erro: 'limite' }));
  assert.equal(r.estado.aviso, 'semServidor');
  assert.deepEqual(r.efeitos, [FOCAR]);
  // A tela recusada para a captura.
  r = rodar(naReuniao(), { tipo: 'telaCapturada', ok: true }, mensagem({ tipo: 'erro', erro: 'foraDaReuniao' }));
  assert.equal(r.estado.telaCompartilhada, 'nenhuma');
  assert.deepEqual(r.efeitos, [PARAR_CAPTURA]);
  // O pedir ignorado pelo limite é o semServidor.
  r = passo(pedindo(), mensagem({ tipo: 'erro', erro: 'limite' }));
  assert.equal(r.estado.aviso, 'semServidor');
  assert.deepEqual(r.efeitos, [FOCAR]);
});

test('os eventos atrasados não mudam nada', () => {
  // A principal que a página desligou ainda avisa que terminou.
  semMudar(saiu(), ligacao('principal', 'terminou'));
  // O abriu de um pedido desistido.
  semMudar(rodar(naEntrada(), clique('pedir'), clique('desistir')).estado, abriu(2));
  // O prazo do 1011 depois do desistir.
  semMudar(rodar(aguardando(), canalFechou(1011), clique('desistir')).estado, tempo('reabrir'));
  // O prazo da volta depois do Sair.
  semMudar(rodar(naReuniao(), SEM_CONEXAO, clique('sair')).estado, tempo('reconectar:1'));
});

test('o qual da ligação é principal ou tela', () => {
  // Outro qual (um erro de digitação no ligacao.js, por exemplo) fica de fora, em vez de cair na principal.
  semMudar(naReuniao(), ligacao('outra', 'terminou'));
  semMudar(entrando(), ligacao('', 'confirmada'));
});

test('nomeValido', () => {
  assert.equal(nomeValido('  Maria  '), true);
  assert.equal(nomeValido('a'.repeat(80)), true);
  for (const nome of ['', '   ', 'a\tb', 'a\u0085b', 'a\u007fb', 'a'.repeat(81)]) {
    assert.equal(nomeValido(nome), false, JSON.stringify(nome));
  }
  // 80 emojis valem: são 80 pontos de código, mesmo com 160 unidades do UTF-16.
  const emojis = '😀'.repeat(80);
  assert.equal(emojis.length, 160);
  assert.equal(nomeValido(emojis), true);
  assert.equal(nomeValido(emojis + '😀'), false);
});

test('quando', () => {
  const agora = new Date(2026, 10, 17, 10, 0).getTime();
  assert.equal(quando(new Date(2026, 10, 17, 14, 0).getTime(), agora), 'Hoje, 14:00');
  assert.equal(quando(new Date(2026, 10, 18, 9, 30).getTime(), agora), 'Amanhã, 09:30');
  assert.equal(quando(new Date(2026, 10, 20, 8, 5).getTime(), agora), '20/11, 08:05');
  assert.equal(quando(new Date(2026, 10, 16, 14, 0).getTime(), agora), '16/11, 14:00');
  // O amanhã atravessa o fim do ano.
  assert.equal(quando(new Date(2027, 0, 1, 0, 15).getTime(), new Date(2026, 11, 31, 23, 0).getTime()), 'Amanhã, 00:15');
});

test('cabecalho', () => {
  const agora = new Date(2026, 10, 17, 10, 0).getTime();
  const inicio = new Date(2026, 10, 17, 14, 0).getTime();
  const casos = [
    [{ tipo: 'marcada', assunto: 'Planejamento', inicio }, 'Reunião marcada · Hoje, 14:00', 'Planejamento'],
    [{ tipo: 'marcada', assunto: null, inicio }, 'Reunião marcada · Hoje, 14:00', 'Reunião'],
    [{ tipo: 'naHora', assunto: 'Conversa rápida', inicio: null }, 'Reunião agora', 'Conversa rápida'],
    [{ tipo: 'naHora', assunto: null, inicio: null }, 'Reunião agora', 'Reunião'],
    [{ tipo: 'teste', assunto: 'Teste do som', inicio: null }, 'Reunião de teste', 'Teste do som'],
    [{ tipo: 'teste', assunto: null, inicio: null }, 'Reunião de teste', 'Reunião'],
  ];
  for (const [reuniao, sobretitulo, titulo] of casos) {
    assert.deepEqual(cabecalho(reuniao, agora), { sobretitulo, titulo });
  }
});

// ---- O chat da reunião (seção 10 do protocolo): a lista, as não lidas, o painel e o aviso curto. ----

const FOCAR_O_CAMPO = { tipo: 'focarOCampo' };
const FOCAR_O_CHAT = { tipo: 'focarOChat' };
// O que a pessoa escreveu e mandou, e o Tentar de novo da mensagem n, na hora dada (o agora que a página põe).
const escrever = (texto, agora = 1000) => ({ tipo: 'escrever', texto, agora });
const reenviar = (n, agora = 2000) => ({ tipo: 'reenviar', n, agora });
// Uma mensagem do chat que chega pelo canal, e a recusa de uma.
const doChat = (m, agora = 1000) => ({ tipo: 'mensagem', m: { tipo: 'mensagem', ...m }, agora });
const recusada = (id, motivo) => mensagem({ tipo: 'mensagemRecusada', id, motivo });
const doCarlos = (texto, agora = 1000) =>
  doChat({ de: 'c2c2c2c2c2c2c2c2', nome: 'Carlos Lima', voce: false, texto }, agora);
// A resposta do servidor à mensagem da própria pessoa: ela volta com o id.
const deVolta = (id, texto, agora = 1000) =>
  doChat({ id, de: 'e3e3e3e3e3e3e3e3', nome: 'Maria Lima', voce: true, texto }, agora);
const mandarDoChat = (id, texto) => mandar({ tipo: 'mensagem', id, texto });
const prazoDaMensagem = (id) => esperar(10000, `mensagem:${id}`);
const tempoDoAviso = (n) => esperar(5000, `avisoCurto:${n}`);
// As mensagens, como a lista as guarda.
const minha = (n, texto, extra = {}) => ({
  n,
  voce: true,
  nome: '',
  texto,
  hora: 1000,
  situacao: 'enviando',
  id: `m${n}`,
  motivo: null,
  ...extra,
});
const deOutro = (n, texto, extra = {}) => ({
  n,
  voce: false,
  nome: 'Carlos Lima',
  texto,
  hora: 1000,
  situacao: 'enviada',
  id: null,
  motivo: null,
  ...extra,
});
const chatVazio = (seq = 0) => ({ mensagens: [], naoLidas: 0, aberto: false, seq });
// As três tentativas da volta que falham: a página desiste e mostra "Você saiu da reunião".
const desistirDeVoltar = (estado) =>
  rodar(
    estado,
    SEM_CONEXAO,
    tempo('reconectar:1'),
    mensagem({ tipo: 'senha', senha: 'senha-r1' }),
    ligacao('principal', 'falhou', 0),
    tempo('reconectar:2'),
    mensagem({ tipo: 'senha', senha: 'senha-r2' }),
    ligacao('principal', 'falhou', 0),
    tempo('reconectar:3'),
    mensagem({ tipo: 'senha', senha: 'senha-r3' }),
    ligacao('principal', 'falhou', 0),
  ).estado;

test('os valores do chat', () => {
  assert.equal(PRAZO_DA_MENSAGEM_MS, 10000);
  assert.equal(AVISO_CURTO_MS, 5000);
});

test('podeEscrever: na tela da reunião, com o canal da pessoa aberto', () => {
  assert.equal(podeEscrever(naReuniao()), true);
  assert.equal(podeEscrever(entrando()), false);
  assert.equal(podeEscrever(aguardando()), false);
  assert.equal(podeEscrever(saiu()), false);
  assert.equal(podeEscrever(passo(naReuniao(), canalFechou(1006)).estado), false);
  // O canal abrindo e o voltando ainda não são o da pessoa.
  const religando = rodar(naReuniaoComChave(), canalFechou(1006), tempo('religar:1'), abriu(3));
  assert.equal(religando.estado.canal, 'abrindo');
  assert.equal(podeEscrever(religando.estado), false);
  const voltando = passo(religando.estado, CANAL_ABRIU);
  assert.equal(voltando.estado.canal, 'voltando');
  assert.equal(podeEscrever(voltando.estado), false);
  assert.equal(podeEscrever(passo(voltando.estado, voltou(VOLTA_2)).estado), true);
  // Na conexão caída, com o canal ainda aberto, ele continua valendo: quem decide é o servidor.
  assert.equal(podeEscrever(passo(naReuniao(), SEM_CONEXAO).estado), true);
});

test('escrever manda a mensagem e a mostra indo', () => {
  const r = passo(naReuniao(), escrever('  Bom dia  ', 5000));
  assert.deepEqual(r.efeitos, [mandarDoChat('m1', 'Bom dia'), prazoDaMensagem('m1')]);
  assert.deepEqual(r.estado.chat, {
    mensagens: [minha(1, 'Bom dia', { hora: 5000 })],
    naoLidas: 0,
    aberto: false,
    seq: 1,
  });
  // A quebra de linha do meio fica.
  const s = passo(r.estado, escrever('linha 1\nlinha 2', 6000));
  assert.deepEqual(s.efeitos, [mandarDoChat('m2', 'linha 1\nlinha 2'), prazoDaMensagem('m2')]);
  assert.deepEqual(s.estado.chat.mensagens.at(-1), minha(2, 'linha 1\nlinha 2', { hora: 6000 }));
});

test('escrever manda o texto limpo: o tab vira espaço', () => {
  // O servidor recusaria o tab: o que sai, e o que a lista mostra, é o texto que ele aceita.
  const r = passo(naReuniao(), escrever('nome\tvalor\u0007', 5000));
  assert.deepEqual(r.efeitos, [mandarDoChat('m1', 'nome valor'), prazoDaMensagem('m1')]);
  assert.deepEqual(r.estado.chat.mensagens, [minha(1, 'nome valor', { hora: 5000 })]);
  // O Tentar de novo manda o mesmo texto limpo.
  const naoFoi = passo(r.estado, recusada('m1', 'limite')).estado;
  assert.deepEqual(passo(naoFoi, reenviar(1, 6000)).efeitos, [mandarDoChat('m2', 'nome valor'), prazoDaMensagem('m2')]);
});

test('o texto vazio e o de mais de 1.000 não saem', () => {
  semMudar(naReuniao(), escrever(''));
  semMudar(naReuniao(), escrever('  \n '));
  semMudar(naReuniao(), escrever('a'.repeat(1001)));
  semMudar(naReuniao(), { tipo: 'escrever', agora: 1000 });
  // O de 1.000 sai.
  assert.equal(passo(naReuniao(), escrever('a'.repeat(1000))).efeitos.length, 2);
});

test('a resposta com o id confirma', () => {
  const indo = passo(naReuniao(), escrever('Bom dia', 5000)).estado;
  const r = passo(indo, deVolta('m1', 'Bom dia', 9000));
  assert.deepEqual(r.efeitos, []);
  // A hora continua a de quando a pessoa mandou, e o id sai: a mensagem não espera mais nada.
  assert.deepEqual(r.estado.chat.mensagens, [minha(1, 'Bom dia', { hora: 5000, situacao: 'enviada', id: null })]);
  assert.equal(r.estado.chat.naoLidas, 0);
  assert.equal(r.estado.avisoCurto, null);
  // O prazo dela, que ainda chega, não muda mais nada.
  semMudar(r.estado, tempo('mensagem:m1'));
});

test('a mensagem de outra pessoa, com o chat fechado', () => {
  let r = passo(naReuniao(), doCarlos('Oi', 1000));
  assert.deepEqual(r.estado.chat, { mensagens: [deOutro(1, 'Oi')], naoLidas: 1, aberto: false, seq: 1 });
  assert.deepEqual(r.estado.avisoCurto, { n: 1, tipo: 'mensagem', nome: 'Carlos Lima', texto: 'Oi' });
  assert.equal(r.estado.avisos, 1);
  assert.deepEqual(r.efeitos, [tempoDoAviso(1)]);
  // Outra mensagem: o aviso novo toma o lugar do anterior.
  r = passo(r.estado, doCarlos('Tudo bem?', 3000));
  assert.equal(r.estado.chat.naoLidas, 2);
  assert.deepEqual(r.estado.avisoCurto, { n: 2, tipo: 'mensagem', nome: 'Carlos Lima', texto: 'Tudo bem?' });
  assert.deepEqual(r.efeitos, [tempoDoAviso(2)]);
  // O tempo do aviso que passou fica de fora; o do aviso de agora o tira. As não lidas ficam.
  semMudar(r.estado, tempo('avisoCurto:1'));
  r = passo(r.estado, tempo('avisoCurto:2'));
  assert.equal(r.estado.avisoCurto, null);
  assert.equal(r.estado.chat.naoLidas, 2);
  assert.deepEqual(r.efeitos, []);
  // Sem o nome, ele fica vazio: quem escreve "Participante" é a tela.
  r = passo(naReuniao(), doChat({ de: 'c2c2c2c2c2c2c2c2', nome: '', voce: false, texto: 'Oi' }));
  assert.equal(r.estado.chat.mensagens[0].nome, '');
  assert.equal(passo(naReuniao(), doChat({ voce: false, texto: 'Oi' })).estado.chat.mensagens[0].nome, '');
});

test('com o chat aberto, a mensagem não conta nem avisa', () => {
  const aberto = passo(naReuniao(), clique('chat')).estado;
  const r = passo(aberto, doCarlos('Oi'));
  assert.deepEqual(r.estado.chat, { mensagens: [deOutro(1, 'Oi')], naoLidas: 0, aberto: true, seq: 1 });
  assert.equal(r.estado.avisoCurto, null);
  assert.deepEqual(r.efeitos, []);
});

test('abrir zera as não lidas, tira o aviso e leva o foco ao campo', () => {
  const comDuas = rodar(naReuniao(), doCarlos('Oi'), doCarlos('Tudo bem?')).estado;
  for (const botao of ['chat', 'abrirChat']) {
    const r = passo(comDuas, clique(botao));
    assert.deepEqual(r.estado.chat, {
      mensagens: [deOutro(1, 'Oi'), deOutro(2, 'Tudo bem?')],
      naoLidas: 0,
      aberto: true,
      seq: 2,
    });
    assert.equal(r.estado.avisoCurto, null);
    assert.deepEqual(r.efeitos, [FOCAR_O_CAMPO]);
    // O tempo do aviso que saiu com o abrir não muda mais nada.
    semMudar(r.estado, tempo('avisoCurto:2'));
    // O Abrir o chat com ele já aberto não faz nada.
    semMudar(r.estado, clique('abrirChat'));
  }
});

test('fechar devolve o foco ao botão', () => {
  const aberto = passo(naReuniao(), clique('chat')).estado;
  let r = passo(aberto, clique('fecharChat'));
  assert.equal(r.estado.chat.aberto, false);
  assert.deepEqual(r.efeitos, [FOCAR_O_CHAT]);
  // O clique no próprio botão Chat fecha, e o foco já está nele.
  r = passo(aberto, clique('chat'));
  assert.equal(r.estado.chat.aberto, false);
  assert.deepEqual(r.efeitos, []);
  // Fechar o que está fechado não faz nada.
  semMudar(naReuniao(), clique('fecharChat'));
});

test('fora da tela da reunião, os cliques do chat, o escrever e o reenviar não fazem nada', () => {
  for (const estado of [naEntrada(), aguardando(), entrando(), saiu()]) {
    for (const botao of ['chat', 'abrirChat', 'fecharChat']) semMudar(estado, clique(botao));
    semMudar(estado, escrever('Bom dia'));
    semMudar(estado, reenviar(1));
  }
});

test('a recusa marca Não enviada, com o motivo', () => {
  const indo = passo(naReuniao(), escrever('Bom dia')).estado;
  for (const motivo of ['limite', 'grande', 'foraDaReuniao', 'invalida']) {
    const r = passo(indo, recusada('m1', motivo));
    assert.deepEqual(r.estado.chat.mensagens, [minha(1, 'Bom dia', { situacao: 'naoEnviada', id: null, motivo })]);
    assert.deepEqual(r.efeitos, []);
  }
  // A recusa de um id que a página não espera, e a que vem sem o id, ficam de fora.
  semMudar(indo, recusada('m7', 'limite'));
  semMudar(indo, mensagem({ tipo: 'mensagemRecusada', motivo: 'limite' }));
});

test('sem resposta em 10 s, a mensagem fica Não enviada, e a resposta atrasada ainda a confirma', () => {
  const indo = passo(naReuniao(), escrever('Bom dia', 5000)).estado;
  let r = passo(indo, tempo('mensagem:m1'));
  assert.deepEqual(r.efeitos, []);
  // O id fica: a resposta pode só ter atrasado.
  assert.deepEqual(r.estado.chat.mensagens, [
    minha(1, 'Bom dia', { hora: 5000, situacao: 'naoEnviada', motivo: 'prazo' }),
  ]);
  r = passo(r.estado, deVolta('m1', 'Bom dia', 20000));
  assert.deepEqual(r.estado.chat.mensagens, [minha(1, 'Bom dia', { hora: 5000, situacao: 'enviada', id: null })]);
  // A recusa atrasada também vale, com o motivo dela.
  r = rodar(indo, tempo('mensagem:m1'), recusada('m1', 'limite'));
  assert.deepEqual(r.estado.chat.mensagens, [
    minha(1, 'Bom dia', { hora: 5000, situacao: 'naoEnviada', id: null, motivo: 'limite' }),
  ]);
  // O prazo de um id que não existe não muda nada.
  semMudar(indo, tempo('mensagem:m9'));
});

test('o Tentar de novo manda de novo, no fim da lista', () => {
  const antes = rodar(naReuniao(), escrever('Bom dia', 5000), recusada('m1', 'limite'), doCarlos('Oi', 6000)).estado;
  assert.deepEqual(
    antes.chat.mensagens.map((m) => m.n),
    [1, 2],
  );
  const r = passo(antes, reenviar(1, 7000));
  assert.deepEqual(r.efeitos, [mandarDoChat('m3', 'Bom dia'), prazoDaMensagem('m3')]);
  assert.deepEqual(r.estado.chat.mensagens, [deOutro(2, 'Oi', { hora: 6000 }), minha(3, 'Bom dia', { hora: 7000 })]);
  assert.equal(r.estado.chat.seq, 3);
  // O que não está "Não enviada", o n que não existe, e sem o canal: nada muda.
  semMudar(antes, reenviar(2));
  semMudar(antes, reenviar(9));
  const indo = passo(naReuniao(), escrever('Bom dia')).estado;
  semMudar(indo, reenviar(1));
  const semCanal = passo(antes, canalFechou(1006)).estado;
  semMudar(semCanal, reenviar(1));
});

test('a resposta de um id que a página não espera mais vira outra mensagem', () => {
  // A resposta atrasou mais que os 10 s, a pessoa clicou em Tentar de novo, e as duas chegaram aos outros.
  const tentando = rodar(naReuniao(), escrever('Bom dia', 5000), tempo('mensagem:m1'), reenviar(1, 16000)).estado;
  assert.deepEqual(tentando.chat.mensagens, [minha(2, 'Bom dia', { hora: 16000 })]);
  let r = passo(tentando, deVolta('m1', 'Bom dia', 17000));
  assert.deepEqual(r.estado.chat.mensagens, [
    minha(2, 'Bom dia', { hora: 16000 }),
    { n: 3, voce: true, nome: 'Maria Lima', texto: 'Bom dia', hora: 17000, situacao: 'enviada', id: null, motivo: null },
  ]);
  // A da própria pessoa nunca conta como não lida, nem avisa.
  assert.equal(r.estado.chat.naoLidas, 0);
  assert.equal(r.estado.avisoCurto, null);
  assert.deepEqual(r.efeitos, []);
  r = passo(r.estado, deVolta('m2', 'Bom dia', 18000));
  assert.deepEqual(
    r.estado.chat.mensagens.map((m) => [m.n, m.situacao]),
    [
      [2, 'enviada'],
      [3, 'enviada'],
    ],
  );
});

test('sem o canal, o escrever guarda a mensagem como Não enviada', () => {
  const semCanal = passo(naReuniao(), canalFechou(1006)).estado;
  const r = passo(semCanal, escrever('Bom dia', 5000));
  assert.deepEqual(r.efeitos, []);
  assert.deepEqual(r.estado.chat.mensagens, [
    minha(1, 'Bom dia', { hora: 5000, situacao: 'naoEnviada', id: null, motivo: 'semCanal' }),
  ]);
});

test('a mensagem que estava indo quando o canal caiu fica Não enviada no prazo dela', () => {
  const r = rodar(naReuniaoComChave(), escrever('Bom dia', 5000), canalFechou(1006));
  assert.equal(r.estado.chat.mensagens[0].situacao, 'enviando');
  const depois = passo(r.estado, tempo('mensagem:m1'));
  assert.equal(depois.estado.chat.mensagens[0].situacao, 'naoEnviada');
  assert.equal(depois.estado.chat.mensagens[0].motivo, 'prazo');
});

test('a lista esvazia quando a página sai da tela da reunião', () => {
  // Três mensagens, duas não lidas e um aviso; depois, o chat aberto.
  const fechado = rodar(naReuniao(), escrever('Bom dia'), doCarlos('Oi'), doCarlos('Tudo bem?')).estado;
  assert.equal(fechado.chat.mensagens.length, 3);
  assert.notEqual(fechado.avisoCurto, null);
  const aberto = passo(fechado, clique('chat')).estado;
  const fins = [
    (e) => passo(e, clique('sair')).estado,
    (e) => passo(e, mensagem({ tipo: 'tirado' })).estado,
    (e) => passo(e, mensagem({ tipo: 'encerrada' })).estado,
    desistirDeVoltar,
  ];
  for (const [i, fim] of fins.entries()) {
    for (const antes of [fechado, aberto]) {
      const depois = fim(antes);
      assert.equal(depois.tela, 'aviso', `o fim ${i}`);
      assert.deepEqual(depois.chat, chatVazio(3), `o fim ${i}`);
      assert.equal(depois.avisoCurto, null, `o fim ${i}`);
    }
  }
  // O tempo de um aviso e o prazo de uma mensagem que chegam depois do fim não mudam nada.
  const saiuDaReuniao = passo(fechado, clique('sair')).estado;
  semMudar(saiuDaReuniao, tempo('avisoCurto:2'));
  semMudar(saiuDaReuniao, tempo('mensagem:m1'));
});

test('a lista fica enquanto a página tenta voltar', () => {
  const com = (estado) => rodar(estado, escrever('Bom dia'), deVolta('m1', 'Bom dia'), doCarlos('Oi'), clique('chat'));
  // A conexão caída: o cartão "A conexão caiu" aparece, e o chat fica como estava, até depois da volta.
  let antes = com(naReuniao()).estado;
  let r = { estado: antes };
  for (const evento of [
    SEM_CONEXAO,
    tempo('reconectar:1'),
    mensagem({ tipo: 'senha', senha: 'senha-r1' }),
    ligacao('principal', 'confirmada'),
  ]) {
    r = passo(r.estado, evento);
    assert.equal(r.estado.tela, 'reuniao');
    assert.deepEqual(r.estado.chat, antes.chat, evento.tipo);
  }
  // O canal que cai e religa por trás, com a ligação no ar.
  antes = com(naReuniaoComChave()).estado;
  r = { estado: antes };
  for (const evento of [canalFechou(1006), tempo('religar:1'), abriu(3), CANAL_ABRIU, voltou(VOLTA_2)]) {
    r = passo(r.estado, evento);
    assert.deepEqual(r.estado.chat, antes.chat, evento.tipo);
  }
  // E a página que desistiu de religar o canal (a reunião segue só com a imagem e o som) continua com as mensagens.
  const semChave = passo(com(naReuniao()).estado, canalFechou(1006));
  assert.equal(semChave.estado.tela, 'reuniao');
  assert.deepEqual(semChave.estado.chat, com(naReuniao()).estado.chat);
});

test('as mensagens que chegam com a página entrando ficam para a reunião', () => {
  let r = passo(entrando(), doCarlos('Oi'));
  assert.deepEqual(r.estado.chat, { mensagens: [deOutro(1, 'Oi')], naoLidas: 1, aberto: false, seq: 1 });
  // O aviso curto é da tela da reunião: entrando, ele não nasce.
  assert.equal(r.estado.avisoCurto, null);
  assert.deepEqual(r.efeitos, []);
  r = passo(r.estado, ligacao('principal', 'confirmada'));
  assert.equal(r.estado.tela, 'reuniao');
  assert.deepEqual(r.estado.chat, { mensagens: [deOutro(1, 'Oi')], naoLidas: 1, aberto: false, seq: 1 });
  // A entrada que não deu certo esvazia, como toda saída.
  const falhou = rodar(entrando(), doCarlos('Oi'), ligacao('principal', 'falhou', 0));
  assert.equal(falhou.estado.tela, 'aviso');
  assert.deepEqual(falhou.estado.chat, chatVazio(1));
});

test('antes do aceito e depois do fim, a mensagem do chat fica de fora', () => {
  semMudar(aguardando(), doCarlos('Oi'));
  semMudar(saiu(), doCarlos('Oi'));
  semMudar(aguardando(), recusada('m1', 'limite'));
});

test('a mensagem sem texto, ou com o texto que não é texto, fica de fora', () => {
  for (const texto of [undefined, null, '', 7, {}, ['a']]) {
    semMudar(naReuniao(), doChat({ de: 'c2c2c2c2c2c2c2c2', nome: 'Carlos Lima', voce: false, texto }));
  }
  // O nome que não é texto vira o vazio, e a mensagem vale.
  const r = passo(naReuniao(), doChat({ de: 'c2c2c2c2c2c2c2c2', nome: 7, voce: false, texto: 'Oi' }));
  assert.equal(r.estado.chat.mensagens[0].nome, '');
});

test('a página guarda as últimas 500', () => {
  let estado = naReuniao();
  for (let i = 1; i <= 501; i++) estado = passo(estado, doCarlos(`mensagem ${i}`)).estado;
  assert.equal(estado.chat.mensagens.length, 500);
  assert.equal(estado.chat.mensagens[0].n, 2);
  assert.equal(estado.chat.mensagens.at(-1).n, 501);
  assert.equal(estado.chat.seq, 501);
  // As não lidas contam todas: quem diz "9+" é a tela.
  assert.equal(estado.chat.naoLidas, 501);
  // A que saiu da lista não volta com a resposta atrasada dela, nem com o prazo.
  let r = passo(naReuniao(), escrever('a primeira', 5000));
  for (let i = 1; i <= 500; i++) r = passo(r.estado, doCarlos(`mensagem ${i}`));
  assert.equal(r.estado.chat.mensagens.some((m) => m.voce), false);
  semMudar(r.estado, tempo('mensagem:m1'));
});

test('o Entrar de novo começa vazio, e os ids não se repetem', () => {
  const fora = rodar(naReuniao(), escrever('Bom dia'), deVolta('m1', 'Bom dia'), clique('sair')).estado;
  assert.deepEqual(fora.chat, chatVazio(1));
  const dentro = rodar(
    fora,
    clique('entrarDeNovo'),
    midia('ligado', 'ligado'),
    mensagem({ tipo: 'senha', senha: 'senha-3' }),
    ligacao('principal', 'confirmada'),
  ).estado;
  assert.equal(dentro.tela, 'reuniao');
  assert.deepEqual(dentro.chat, chatVazio(1));
  const r = passo(dentro, escrever('De volta', 9000));
  assert.deepEqual(r.efeitos, [mandarDoChat('m2', 'De volta'), prazoDaMensagem('m2')]);
  // A resposta atrasada de uma mensagem da entrada anterior não confirma nada da nova: vira uma mensagem a mais.
  const s = passo(r.estado, deVolta('m1', 'Bom dia', 9500));
  assert.deepEqual(
    s.estado.chat.mensagens.map((m) => [m.n, m.situacao, m.texto]),
    [
      [2, 'enviando', 'De volta'],
      [3, 'enviada', 'Bom dia'],
    ],
  );
});

// ---- O sinalizador de qualidade: a medida, o aviso de conexão ruim e o cartão. ----

const FOCAR_O_SINAL = { tipo: 'focarOSinal' };
// O sinalizador no começo: medindo, sem número nenhum.
const NO_COMECO = { estado: 'medindo', perda: null, atraso: null };
// Uma medida do medidor: o estado mostrado, a perda (uma fração) e o atraso (em ms).
const medida = (estado, perda = 0, atraso = 45) => ({ tipo: 'qualidade', estado, perda, atraso });
const avisoDaConexao = (n) => ({ n, tipo: 'conexao' });
const tempoDaConexao = esperar(120000, 'conexaoAvisada');
// A volta da conexão caída, com o canal aberto: a espera, a senha nova e a ligação no ar de novo.
const VOLTA_DA_QUEDA = [
  tempo('reconectar:1'),
  mensagem({ tipo: 'senha', senha: 'senha-r1' }),
  ligacao('principal', 'confirmada'),
];

test('os valores do sinalizador', () => {
  assert.equal(AVISO_DA_CONEXAO_MS, 120000);
});

test('a medida guarda o estado e os números', () => {
  const antes = naReuniao();
  const r = passo(antes, medida('boa', 0, 45));
  assert.deepEqual(r.estado.qualidade, { estado: 'boa', perda: 0, atraso: 45 });
  assert.deepEqual(r.efeitos, []);
  // Só a qualidade muda.
  assert.deepEqual({ ...r.estado, qualidade: antes.qualidade }, antes);
  // O número que o navegador não dá fica null, e o que não é número também.
  assert.deepEqual(passo(antes, medida('instavel', 0.04, null)).estado.qualidade, {
    estado: 'instavel',
    perda: 0.04,
    atraso: null,
  });
  assert.deepEqual(passo(antes, { tipo: 'qualidade', estado: 'boa', atraso: 45 }).estado.qualidade, {
    estado: 'boa',
    perda: null,
    atraso: 45,
  });
  assert.deepEqual(passo(antes, medida('boa', Number.NaN, '45')).estado.qualidade, {
    estado: 'boa',
    perda: null,
    atraso: null,
  });
  // A primeira medida ainda mostra o medindo, já com os números.
  assert.deepEqual(passo(antes, medida('medindo', 0, 45)).estado.qualidade, {
    estado: 'medindo',
    perda: 0,
    atraso: 45,
  });
  // Um estado que não existe fica de fora.
  semMudar(antes, medida('otima'));
  semMudar(antes, { tipo: 'qualidade' });
});

test('virar ruim avisa, no máximo uma vez a cada 2 minutos', () => {
  const boa = passo(naReuniao(), medida('boa')).estado;
  let r = passo(boa, medida('ruim', 0.12, 640));
  assert.deepEqual(r.estado.qualidade, { estado: 'ruim', perda: 0.12, atraso: 640 });
  assert.deepEqual(r.estado.avisoCurto, avisoDaConexao(1));
  assert.equal(r.estado.avisos, 1);
  assert.equal(r.estado.conexaoAvisada, true);
  assert.deepEqual(r.efeitos, [tempoDoAviso(1), tempoDaConexao]);
  // Outra medida ruim não avisa de novo: o aviso é o mesmo, e os números andam.
  r = passo(r.estado, medida('ruim', 0.2, 700));
  assert.deepEqual(r.estado.avisoCurto, avisoDaConexao(1));
  assert.deepEqual(r.estado.qualidade, { estado: 'ruim', perda: 0.2, atraso: 700 });
  assert.deepEqual(r.efeitos, []);
  // Os 5 s do aviso: ele sai, e o um-a-cada-2-minutos continua gasto.
  r = passo(r.estado, tempo('avisoCurto:1'));
  assert.equal(r.estado.avisoCurto, null);
  assert.equal(r.estado.conexaoAvisada, true);
  // De volta a boa e a ruim dentro dos 2 minutos: nenhum aviso.
  r = rodar(r.estado, medida('boa'), medida('ruim'));
  assert.equal(r.estado.qualidade.estado, 'ruim');
  assert.equal(r.estado.avisoCurto, null);
  assert.equal(r.estado.avisos, 1);
  assert.deepEqual(r.efeitos, []);
  // Passados os 2 minutos, o tempo sozinho não avisa (a conexão já estava ruim): só a próxima virada.
  r = passo(r.estado, tempo('conexaoAvisada'));
  assert.equal(r.estado.conexaoAvisada, false);
  assert.equal(r.estado.avisoCurto, null);
  assert.deepEqual(r.efeitos, []);
  r = passo(r.estado, medida('ruim'));
  assert.equal(r.estado.avisoCurto, null);
  assert.deepEqual(r.efeitos, []);
  r = rodar(r.estado, medida('instavel'), medida('ruim'));
  assert.deepEqual(r.estado.avisoCurto, avisoDaConexao(2));
  assert.equal(r.estado.conexaoAvisada, true);
  assert.deepEqual(r.efeitos, [tempoDoAviso(2), tempoDaConexao]);
  // O tempo dos 2 minutos sem aviso nenhum gasto não muda nada.
  semMudar(naReuniao(), tempo('conexaoAvisada'));
});

test('a primeira medida ruim, logo depois do medindo, também avisa', () => {
  const r = passo(naReuniao(), medida('ruim', 0.3, null));
  assert.deepEqual(r.estado.avisoCurto, avisoDaConexao(1));
  assert.deepEqual(r.efeitos, [tempoDoAviso(1), tempoDaConexao]);
  // As outras viradas não avisam: para boa, para instável e para o medindo.
  for (const estado of ['boa', 'instavel', 'medindo']) {
    const s = passo(naReuniao(), medida(estado));
    assert.equal(s.estado.avisoCurto, null, estado);
    assert.equal(s.estado.conexaoAvisada, false, estado);
    assert.deepEqual(s.efeitos, [], estado);
  }
});

test('o cartão do sinalizador abre e fecha', () => {
  // O botão do sinalizador abre e fecha; o foco já está nele.
  let r = passo(naReuniao(), clique('qualidade'));
  assert.equal(r.estado.cartao, true);
  assert.deepEqual(r.efeitos, []);
  const aberto = r.estado;
  r = passo(aberto, clique('qualidade'));
  assert.equal(r.estado.cartao, false);
  assert.deepEqual(r.efeitos, []);
  // O Esc e o clique fora (o fecharCartao) fecham, e o foco fica onde está.
  r = passo(aberto, clique('fecharCartao'));
  assert.equal(r.estado.cartao, false);
  assert.deepEqual(r.efeitos, []);
  semMudar(naReuniao(), clique('fecharCartao'));
  // Com o cartão aberto, as medidas continuam chegando a ele.
  assert.deepEqual(passo(aberto, medida('boa', 0, 45)).estado.qualidade, { estado: 'boa', perda: 0, atraso: 45 });
  assert.equal(passo(aberto, medida('boa', 0, 45)).estado.cartao, true);
});

test('abrir o cartão tira o aviso da conexão, e o Ver os detalhes leva o foco ao sinalizador', () => {
  const avisado = passo(naReuniao(), medida('ruim', 0.12, 640)).estado;
  assert.deepEqual(avisado.avisoCurto, avisoDaConexao(1));
  let r = passo(avisado, clique('qualidade'));
  assert.equal(r.estado.cartao, true);
  assert.equal(r.estado.avisoCurto, null);
  assert.deepEqual(r.efeitos, []);
  // O Ver os detalhes do aviso: o botão some com o aviso, e o foco vai ao botão do sinalizador.
  r = passo(avisado, clique('verDetalhes'));
  assert.equal(r.estado.cartao, true);
  assert.equal(r.estado.avisoCurto, null);
  assert.deepEqual(r.efeitos, [FOCAR_O_SINAL]);
  // O tempo do aviso que saiu com o cartão não muda mais nada, e o um-a-cada-2-minutos continua gasto.
  semMudar(r.estado, tempo('avisoCurto:1'));
  assert.equal(r.estado.conexaoAvisada, true);
  // O aviso de uma mensagem não é do sinalizador: ele fica.
  const comMensagem = passo(naReuniao(), doCarlos('Oi')).estado;
  r = passo(comMensagem, clique('qualidade'));
  assert.equal(r.estado.cartao, true);
  assert.deepEqual(r.estado.avisoCurto, { n: 1, tipo: 'mensagem', nome: 'Carlos Lima', texto: 'Oi' });
});

test('com o cartão aberto, virar ruim não avisa e não gasta o aviso', () => {
  const aberto = rodar(naReuniao(), medida('boa'), clique('qualidade')).estado;
  let r = passo(aberto, medida('ruim', 0.12, 640));
  assert.deepEqual(r.estado.qualidade, { estado: 'ruim', perda: 0.12, atraso: 640 });
  assert.equal(r.estado.avisoCurto, null);
  assert.equal(r.estado.avisos, 0);
  assert.equal(r.estado.conexaoAvisada, false);
  assert.deepEqual(r.efeitos, []);
  // Fechar o cartão com a conexão ainda ruim não avisa: o aviso é da virada.
  r = passo(r.estado, clique('fecharCartao'));
  assert.equal(r.estado.avisoCurto, null);
  assert.deepEqual(passo(r.estado, medida('ruim')).efeitos, []);
  // A próxima virada, com o cartão fechado, avisa: o aviso não tinha sido gasto.
  r = rodar(r.estado, medida('boa'), medida('ruim'));
  assert.deepEqual(r.estado.avisoCurto, avisoDaConexao(1));
  assert.deepEqual(r.efeitos, [tempoDoAviso(1), tempoDaConexao]);
});

test('o aviso da mensagem toma o lugar do da conexão, e o contrário', () => {
  // Um só por vez: o da mensagem chega com o da conexão na tela.
  let r = rodar(naReuniao(), medida('ruim'), doCarlos('Oi'));
  assert.deepEqual(r.estado.avisoCurto, { n: 2, tipo: 'mensagem', nome: 'Carlos Lima', texto: 'Oi' });
  assert.deepEqual(r.efeitos, [tempoDoAviso(2)]);
  // O tempo do aviso da conexão, que deu lugar ao da mensagem, fica de fora.
  semMudar(r.estado, tempo('avisoCurto:1'));
  // O contrário: o da conexão chega com o da mensagem na tela. A mensagem continua contando como não lida.
  r = rodar(naReuniao(), doCarlos('Oi'), medida('ruim'));
  assert.deepEqual(r.estado.avisoCurto, avisoDaConexao(2));
  assert.equal(r.estado.chat.naoLidas, 1);
  assert.deepEqual(r.efeitos, [tempoDoAviso(2), tempoDaConexao]);
  semMudar(r.estado, tempo('avisoCurto:1'));
  // Abrir o chat tira o aviso da mensagem, e não o da conexão.
  r = passo(r.estado, clique('chat'));
  assert.equal(r.estado.chat.aberto, true);
  assert.deepEqual(r.estado.avisoCurto, avisoDaConexao(2));
  // Com o chat aberto, a conexão que vira ruim avisa também.
  r = rodar(naReuniao(), clique('chat'), medida('ruim'));
  assert.deepEqual(r.estado.avisoCurto, avisoDaConexao(1));
});

test('com a conexão caída, o sinalizador mede de novo', () => {
  // A conexão ruim, com o aviso dela ainda na tela.
  const ruim = rodar(naReuniao(), medida('boa'), medida('ruim', 0.12, 640)).estado;
  assert.deepEqual(ruim.avisoCurto, avisoDaConexao(1));
  let r = passo(ruim, SEM_CONEXAO);
  assert.equal(r.estado.tela, 'reuniao');
  assert.deepEqual(r.estado.qualidade, NO_COMECO);
  // O aviso "Sua conexão está ruim" sai junto: o sinalizador não diz mais ruim, e vale o cartão "A conexão caiu".
  assert.equal(r.estado.avisoCurto, null);
  // A medida que chega com a ligação fora do ar não muda nada.
  semMudar(r.estado, medida('boa'));
  semMudar(r.estado, medida('ruim'));
  // Na volta, o sinalizador continua medindo até a medida seguinte.
  for (const evento of VOLTA_DA_QUEDA) {
    r = passo(r.estado, evento);
    assert.deepEqual(r.estado.qualidade, NO_COMECO, evento.tipo);
  }
  assert.equal(r.estado.principal, 'noAr');
  r = passo(r.estado, medida('boa', 0, 45));
  assert.deepEqual(r.estado.qualidade, { estado: 'boa', perda: 0, atraso: 45 });
  // O cartão aberto continua aberto na queda e na volta, mostrando o medindo.
  r = rodar(naReuniao(), medida('boa'), clique('qualidade'), SEM_CONEXAO, ...VOLTA_DA_QUEDA);
  assert.equal(r.estado.cartao, true);
  assert.deepEqual(r.estado.qualidade, NO_COMECO);
  // A ligação que o servidor terminou sem aviso (os 2 s antes do saiu): o sinalizador também volta ao começo.
  r = rodar(naReuniao(), medida('boa'), ligacao('principal', 'terminou'));
  assert.equal(r.estado.tela, 'reuniao');
  assert.deepEqual(r.estado.qualidade, NO_COMECO);
  // O medindo que já tinha os números da primeira medida os perde também.
  r = rodar(naReuniao(), medida('medindo', 0, 45), SEM_CONEXAO);
  assert.deepEqual(r.estado.qualidade, NO_COMECO);
});

test('o aviso da conexão ruim sai quando o sinalizador deixa de dizer ruim', () => {
  // Duas medidas sem número levam o medidor de volta ao medindo, em 4 s: antes dos 5 s do aviso.
  const avisado = passo(naReuniao(), medida('ruim', 0.12, 640)).estado;
  const r = passo(avisado, medida('medindo', null, null));
  assert.deepEqual(r.estado.qualidade, NO_COMECO);
  assert.equal(r.estado.avisoCurto, null);
  assert.deepEqual(r.efeitos, []);
  // O aviso da mensagem não depende do sinalizador.
  const s = rodar(naReuniao(), medida('ruim'), doCarlos('Oi'), medida('medindo', null, null));
  assert.deepEqual(s.estado.avisoCurto, { n: 2, tipo: 'mensagem', nome: 'Carlos Lima', texto: 'Oi' });
});

test('fora da tela da reunião, o cartão fecha e o sinalizador volta ao começo', () => {
  const dentro = rodar(naReuniao(), medida('instavel', 0.04, 210), clique('qualidade')).estado;
  assert.equal(dentro.cartao, true);
  const fins = [
    (e) => passo(e, clique('sair')).estado,
    (e) => passo(e, mensagem({ tipo: 'tirado' })).estado,
    (e) => passo(e, mensagem({ tipo: 'encerrada' })).estado,
    desistirDeVoltar,
  ];
  for (const [i, fim] of fins.entries()) {
    const depois = fim(dentro);
    assert.equal(depois.tela, 'aviso', `o fim ${i}`);
    assert.equal(depois.cartao, false, `o fim ${i}`);
    assert.deepEqual(depois.qualidade, NO_COMECO, `o fim ${i}`);
  }
  // Fora da reunião, os cliques do sinalizador e as medidas não fazem nada.
  for (const estado of [naEntrada(), aguardando(), entrando(), saiu()]) {
    for (const botao of ['qualidade', 'verDetalhes', 'fecharCartao']) semMudar(estado, clique(botao));
    semMudar(estado, medida('ruim'));
  }
});

test('o um-a-cada-2-minutos vale também para quem sai e entra de novo', () => {
  const fora = rodar(naReuniao(), medida('ruim'), clique('sair')).estado;
  assert.equal(fora.avisoCurto, null);
  assert.equal(fora.conexaoAvisada, true);
  const deNovo = [
    clique('entrarDeNovo'),
    midia('ligado', 'ligado'),
    mensagem({ tipo: 'senha', senha: 'senha-3' }),
    ligacao('principal', 'confirmada'),
  ];
  // Dentro dos 2 minutos, a virada para ruim da entrada nova não avisa.
  let r = rodar(fora, ...deNovo, medida('ruim'));
  assert.equal(r.estado.tela, 'reuniao');
  assert.equal(r.estado.qualidade.estado, 'ruim');
  assert.equal(r.estado.avisoCurto, null);
  // O tempo dos 2 minutos chega com a pessoa fora da reunião, e vale: a entrada seguinte avisa.
  r = passo(fora, tempo('conexaoAvisada'));
  assert.equal(r.estado.conexaoAvisada, false);
  assert.deepEqual(r.efeitos, []);
  r = rodar(r.estado, ...deNovo, medida('ruim'));
  assert.deepEqual(r.estado.avisoCurto, avisoDaConexao(2));
});

// A partida do servidor do chat (seção 10 do protocolo): muda quando ele reinicia.
const comPartida = (evento, partida = 'partida-1') => ({ ...evento, partida });

test('a partida do servidor fica no estado, e o abrir de uma entrada a troca', () => {
  assert.equal(inicial().partida, null);
  let r = rodar(inicial(), COMECAR, comPartida(abriu(1)), midia('ligado', 'ligado'));
  assert.equal(r.estado.partida, 'partida-1');
  r = rodar(r.estado, { tipo: 'nome', valor: 'Maria Lima' }, clique('pedir'), comPartida(abriu(2), 'partida-2'));
  assert.equal(r.estado.partida, 'partida-2');
  assert.deepEqual(r.efeitos, [abrirCanal(2)]);
  // Sem a partida na resposta (um servidor de antes dela), a que a página tem fica.
  assert.equal(rodar(naEntrada(), clique('pedir'), abriu(2)).estado.partida, null);
});

// ---- O colega ----

// O colega de mentira: o passe do endereço, a chave que o abrir com ele dá e até quando o link vale.
const PASSE = 'p'.repeat(43);
const CHAVE_DO_COLEGA = 'c'.repeat(43);
const VALE_ATE = new Date(2026, 10, 23, 23, 59).getTime();
const COLEGA = { nome: 'Júlia Martins', chave: CHAVE_DO_COLEGA, valeAte: VALE_ATE };
// O abrir com a chave responde o colega sem a chave: ela só vem na troca do passe.
const COLEGA_SEM_CHAVE = { nome: 'Júlia Martins', valeAte: VALE_ATE };
const COMECAR_COM_PASSE = { tipo: 'comecar', passe: PASSE };
const abrirCom = (abertura, corpo) => ({ tipo: 'abrir', abertura, corpo });
const abrirDoColega = (abertura) => abrirCom(abertura, { colega: CHAVE_DO_COLEGA });
const abriuColega = (abertura, colega = COLEGA_SEM_CHAVE) => ({ ...abriu(abertura), colega });
const passeRecusado = (abertura) => ({ ...abrirFalhou(abertura, 401), passe: true });
const ENTRAR = mandar({ tipo: 'entrar' });
const dizer = (texto) => ({ tipo: 'dizer', texto });
// A faixa do passe que não valeu, que o leitor de tela ouve quando ela aparece.
const FAIXA =
  'Não foi possível reconhecer você como colega. Abra a reunião de novo pelo app, ou entre como convidado.';
const focar = (alvo) => ({ tipo: 'focar', alvo });
const focarEm = (alvo, id) => ({ tipo: 'focar', alvo, id });
const cliqueEm = (botao, id) => ({ tipo: 'clique', botao, id });

// A lista da reunião: a própria pessoa, um de fora e dois pedidos.
const EU = { id: 'b000000000000001', nome: 'Júlia Martins', deFora: false, tela: false, voce: true };
const PEDRO = { id: 'b000000000000002', nome: 'Pedro Nunes', deFora: true, tela: false, voce: false };
const MARIA_NA_REUNIAO = { id: 'b000000000000003', nome: 'Maria Lima', deFora: true, tela: false, voce: false };
const MARIA = { id: 'a000000000000001', nome: 'Maria Lima' };
const BIA = { id: 'a000000000000002', nome: 'Bia Ramos' };
const lista = (participantes, pedidos) => mensagem({ tipo: 'participantes', participantes, pedidos });
const recusa = (de, motivo) => mensagem({ tipo: 'recusa', de, motivo });

// Os estados de partida do colega. O abrir 1 é o do carregar, com o passe, e o 2, o do Entrar, com a chave.
const colegaNaEntrada = () =>
  rodar(inicial(), COMECAR_COM_PASSE, abriuColega(1, COLEGA), midia('ligado', 'ligado')).estado;
const colegaEntrando = () => rodar(colegaNaEntrada(), clique('entrar'), abriuColega(2), CANAL_ABRIU).estado;
const colegaNaReuniao = () =>
  rodar(colegaEntrando(), mensagem(ACEITO_COM_CHAVE), ligacao('principal', 'confirmada')).estado;
const colegaComLista = () => passo(colegaNaReuniao(), lista([EU, PEDRO], [MARIA, BIA])).estado;

// Todos os efeitos dos passos, em ordem.
function efeitosDe(estado, ...eventos) {
  const todos = [];
  for (const evento of eventos) {
    const r = passo(estado, evento);
    todos.push(...r.efeitos);
    estado = r.estado;
  }
  return { estado, efeitos: todos };
}

test('o passe vai no primeiro abrir', () => {
  const r = passo(inicial(), COMECAR_COM_PASSE);
  assert.equal(r.estado.tela, 'carregando');
  assert.equal(r.estado.passe, PASSE);
  assert.deepEqual(r.efeitos, [abrirCom(1, { passe: PASSE })]);
  // Sem o passe (ausente, ou null), o abrir é o de hoje, sem corpo.
  for (const comecar of [COMECAR, { tipo: 'comecar', passe: null }]) {
    const s = passo(inicial(), comecar);
    assert.equal(s.estado.passe, null);
    assert.deepEqual(s.efeitos, [abrir(1)]);
  }
});

test('o colega reconhecido vê a entrada dele', () => {
  const r = rodar(inicial(), COMECAR_COM_PASSE, abriuColega(1, COLEGA));
  assert.equal(r.estado.tela, 'entrada');
  assert.deepEqual(r.estado.colega, { nome: 'Júlia Martins', valeAte: VALE_ATE });
  assert.equal(r.estado.chaveDoColega, CHAVE_DO_COLEGA);
  assert.equal(r.estado.passe, null);
  assert.equal(r.estado.semColega, false);
  assert.deepEqual(r.efeitos, [PEDIR_MIDIA, FOCAR]);
  // Na reunião na hora, o link não tem fim marcado.
  const s = rodar(inicial(), COMECAR_COM_PASSE, abriuColega(1, { ...COLEGA, valeAte: null }));
  assert.deepEqual(s.estado.colega, { nome: 'Júlia Martins', valeAte: null });
});

test('o Entrar do colega abre de novo com a chave', () => {
  let r = passo(colegaNaEntrada(), clique('entrar'));
  assert.equal(r.estado.tela, 'entrando');
  assert.deepEqual(r.efeitos, [abrirDoColega(2), FOCAR]);
  r = passo(r.estado, abriuColega(2));
  assert.equal(r.estado.canal, 'abrindo');
  assert.equal(r.estado.chaveDoColega, CHAVE_DO_COLEGA);
  assert.deepEqual(r.efeitos, [abrirCanal(2)]);
  r = passo(r.estado, CANAL_ABRIU);
  assert.equal(r.estado.canal, 'aberto');
  assert.equal(r.estado.tela, 'entrando');
  assert.equal(r.estado.aceito, false);
  assert.deepEqual(r.efeitos, [ENTRAR]);
});

test('o colega nunca manda o pedir', () => {
  const entrou = [colegaNaEntrada(), clique('entrar'), abriuColega(2), CANAL_ABRIU];
  const caminhos = [
    // O Pedir para entrar não vale na entrada do colega.
    [colegaNaEntrada(), clique('pedir')],
    [...entrou, mensagem({ tipo: 'cheia' }), clique('tentarDeNovo')],
    [...entrou, mensagem({ tipo: 'erro', erro: 'invalido' }), clique('tentarDeNovo')],
    [...entrou, canalFechou(1011), tempo('reabrir'), abriu(3), CANAL_ABRIU],
    [colegaNaEntrada(), clique('entrar'), abrirFalhou(2, 0), clique('tentarDeNovo'), abriu(3), CANAL_ABRIU],
    [colegaNaReuniao(), canalFechou(1006), clique('sair'), clique('entrarDeNovo'), abriu(3), CANAL_ABRIU],
    [colegaEntrando(), clique('sair'), clique('entrarDeNovo'), abriu(3), CANAL_ABRIU],
  ];
  for (const [estado, ...eventos] of caminhos) {
    const { efeitos } = efeitosDe(estado, ...eventos);
    assert.ok(!efeitos.some((x) => x.tipo === 'mandar' && x.m.tipo === 'pedir'), JSON.stringify(eventos));
  }
  // O 1011 abre de novo com a chave, e o canal novo manda o entrar.
  const { efeitos } = efeitosDe(colegaEntrando(), canalFechou(1011), tempo('reabrir'), abriu(3), CANAL_ABRIU);
  assert.deepEqual(efeitos, [esperar(REABRIR_MS, 'reabrir'), abrirDoColega(3), abrirCanal(3), ENTRAR]);
});

test('o aceito do colega segue o de hoje', () => {
  const r = passo(colegaEntrando(), mensagem(ACEITO_COM_CHAVE));
  assert.equal(r.estado.tela, 'entrando');
  assert.equal(r.estado.aceito, true);
  assert.deepEqual(r.estado.acesso, ACESSO);
  assert.deepEqual(r.estado.chave, { participante: 'participante-1', volta: VOLTA_1 });
  // Os efeitos do aceito de quem é de fora; a tela já era a entrando, e o foco fica.
  const deFora = passo(aguardando(), mensagem(ACEITO_COM_CHAVE));
  assert.deepEqual(r.efeitos, [ligar('principal', 'senha-1'), camera(true)]);
  assert.deepEqual(
    r.efeitos,
    deFora.efeitos.filter((x) => x.tipo !== 'focar'),
  );
  const s = passo(r.estado, ligacao('principal', 'confirmada'));
  assert.equal(s.estado.tela, 'reuniao');
  assert.deepEqual(s.efeitos, [FOCAR]);
});

test('cheia e servidor cheio no entrar', () => {
  for (const tipo of ['cheia', 'servidorCheio']) {
    let r = passo(colegaEntrando(), mensagem({ tipo }));
    assert.equal(r.estado.tela, 'aviso');
    assert.equal(r.estado.aviso, tipo);
    assert.deepEqual(r.efeitos, [FOCAR]);
    r = passo(r.estado, clique('tentarDeNovo'));
    assert.equal(r.estado.tela, 'entrando');
    assert.equal(r.estado.aviso, null);
    assert.deepEqual(r.efeitos, [ENTRAR, FOCAR]);
  }
  // Com o canal fechado, o abrir de novo leva a chave.
  let r = rodar(colegaNaEntrada(), clique('entrar'), abrirFalhou(2, 0));
  assert.equal(r.estado.aviso, 'semServidor');
  r = passo(r.estado, clique('tentarDeNovo'));
  assert.equal(r.estado.tela, 'entrando');
  assert.deepEqual(r.efeitos, [abrirDoColega(3), FOCAR]);
  r = rodar(r.estado, abriu(3), CANAL_ABRIU);
  assert.deepEqual(r.efeitos, [ENTRAR]);
});

test('o passe que não vale, no navegador', () => {
  let r = rodar(inicial(), COMECAR_COM_PASSE, passeRecusado(1));
  assert.equal(r.estado.tela, 'carregando');
  assert.equal(r.estado.semColega, true);
  assert.equal(r.estado.passe, null);
  assert.equal(r.estado.colega, null);
  assert.deepEqual(r.efeitos, [abrir(2)]);
  r = passo(r.estado, abriu(2));
  assert.equal(r.estado.tela, 'entrada');
  assert.equal(r.estado.colega, null);
  assert.deepEqual(r.efeitos, [PEDIR_MIDIA, FOCAR, dizer(FAIXA)]);
  // A entrada é a de quem é de fora: o nome e o Pedir para entrar.
  r = rodar(r.estado, midia('ligado', 'ligado'), { tipo: 'nome', valor: 'Maria Lima' }, clique('pedir'));
  assert.deepEqual(r.efeitos, [abrir(3), FOCAR]);
  r = rodar(r.estado, abriu(3), CANAL_ABRIU);
  assert.deepEqual(r.efeitos, [PEDIR]);
  // O 401 sem o passe, ou no abrir sem corpo, é o de hoje.
  r = rodar(inicial(), COMECAR, passeRecusado(1));
  assert.equal(r.estado.aviso, 'semServidor');
  assert.equal(r.estado.semColega, false);
});

test('a chave que deixou de valer, no navegador', () => {
  let r = rodar(colegaNaEntrada(), clique('entrar'), passeRecusado(2));
  assert.equal(r.estado.tela, 'entrada');
  assert.equal(r.estado.semColega, true);
  assert.equal(r.estado.colega, null);
  assert.equal(r.estado.chaveDoColega, null);
  assert.equal(r.estado.canal, 'fechado');
  assert.deepEqual(r.efeitos, [FOCAR, dizer(FAIXA)]);
  r = rodar(r.estado, { tipo: 'nome', valor: 'Maria Lima' }, clique('pedir'));
  assert.deepEqual(r.efeitos, [abrir(3), FOCAR]);
  // A chave recusada no Entrar de novo também.
  r = rodar(colegaEntrando(), clique('sair'), clique('entrarDeNovo'), passeRecusado(3));
  assert.equal(r.estado.tela, 'entrada');
  assert.equal(r.estado.semColega, true);
  assert.equal(r.estado.colega, null);
});

test('o voltar do colega abre sem corpo', () => {
  const caiu = passo(colegaNaReuniao(), canalFechou(1006));
  assert.deepEqual(caiu.efeitos, [esperar(2000, 'religar:1')]);
  const e = seguir(caiu.estado, [
    [tempo('religar:1'), [abrir(3), prazo(1)]],
    [abriu(3), [abrirCanal(3)]],
    [CANAL_ABRIU, [voltar(VOLTA_1)]],
    [voltou(VOLTA_2), [camera(true)]],
  ]);
  assert.equal(e.canal, 'aberto');
  // A conexão caída também volta sem corpo.
  const r = rodar(colegaNaReuniao(), canalFechou(1006), SEM_CONEXAO);
  assert.deepEqual(passo(r.estado, tempo('reconectar:2')).efeitos, [abrir(3), prazo(2)]);
});

test('a lista chega e o número aparece', () => {
  const r = passo(colegaNaReuniao(), lista([EU, PEDRO], [MARIA, BIA]));
  assert.deepEqual(r.estado.lista, { participantes: [EU, PEDRO], pedidos: [MARIA, BIA] });
  assert.equal(r.estado.lista.pedidos.length, 2);
  // A lista que não vale fica de fora.
  semMudar(r.estado, mensagem({ tipo: 'participantes', pedidos: [] }));
  // Ela sai com a reunião.
  assert.deepEqual(passo(r.estado, clique('sair')).estado.lista, { participantes: [], pedidos: [] });
});

test('o painel e o chat não ficam abertos juntos', () => {
  let r = passo(colegaComLista(), clique('chat'));
  assert.equal(r.estado.chat.aberto, true);
  // O botão Participantes abre o painel com o foco no título dele.
  r = passo(r.estado, clique('participantes'));
  assert.equal(r.estado.gente, true);
  assert.equal(r.estado.chat.aberto, false);
  assert.deepEqual(r.efeitos, [focar('gente')]);
  r = passo(r.estado, clique('chat'));
  assert.equal(r.estado.chat.aberto, true);
  assert.equal(r.estado.gente, false);
  assert.deepEqual(r.efeitos, [FOCAR_O_CAMPO]);
  // O Ver os pedidos do cartão abre o painel, com o foco em quem espera.
  r = passo(r.estado, clique('verPedidos'));
  assert.equal(r.estado.gente, true);
  assert.equal(r.estado.chat.aberto, false);
  assert.deepEqual(r.efeitos, [focar('cartao')]);
  // O Abrir o chat do aviso curto também fecha o painel.
  r = passo(r.estado, clique('abrirChat'));
  assert.equal(r.estado.chat.aberto, true);
  assert.equal(r.estado.gente, false);
  // O botão Participantes abre e fecha; o fechar do painel devolve o foco ao botão.
  r = rodar(r.estado, clique('participantes'), clique('participantes'));
  assert.equal(r.estado.gente, false);
  assert.deepEqual(r.efeitos, []);
  r = rodar(r.estado, clique('participantes'), clique('fecharParticipantes'));
  assert.equal(r.estado.gente, false);
  assert.deepEqual(r.efeitos, [focar('participantes')]);
});

test('aceitar e recusar', () => {
  const e = colegaComLista();
  let r = passo(e, cliqueEm('aceitar', MARIA.id));
  assert.deepEqual(r.efeitos, [mandar({ tipo: 'aceitar', pedido: MARIA.id })]);
  r = passo(e, cliqueEm('recusar', BIA.id));
  assert.deepEqual(r.efeitos, [mandar({ tipo: 'recusar', pedido: BIA.id })]);
  // Um pedido que não está na lista fica de fora. Sem o canal da pessoa, nada sai, e o aviso do servidor aparece (os
  // testes "sem o canal", abaixo).
  semMudar(e, cliqueEm('aceitar', 'a00000000000000f'));
  semMudar(e, clique('aceitar'));
  assert.deepEqual(passo(passo(e, canalFechou(1006)).estado, cliqueEm('aceitar', MARIA.id)).estado.avisoCurto, {
    n: 1,
    tipo: 'servidor',
  });
});

test('o Tirar pede o segundo clique', () => {
  const e = colegaComLista();
  // A pergunta leva o foco ao Voltar dela, a escolha que não tira ninguém.
  const r = passo(e, cliqueEm('tirar', PEDRO.id));
  assert.equal(r.estado.tirando, PEDRO.id);
  assert.deepEqual(r.efeitos, [focarEm('naoTirar', PEDRO.id)]);
  let s = passo(r.estado, cliqueEm('tirarMesmo', PEDRO.id));
  assert.deepEqual(s.efeitos, [mandar({ tipo: 'tirar', participante: PEDRO.id })]);
  assert.equal(s.estado.tirando, null);
  // O Voltar desfaz a pergunta, e o foco volta ao Tirar daquela pessoa.
  s = passo(r.estado, clique('naoTirar'));
  assert.equal(s.estado.tirando, null);
  assert.deepEqual(s.efeitos, [focarEm('tirar', PEDRO.id)]);
  // A lista nova sem aquela pessoa desfaz a pergunta; com ela, a pergunta fica.
  assert.equal(passo(r.estado, lista([EU], [MARIA])).estado.tirando, null);
  assert.equal(passo(r.estado, lista([EU, PEDRO], [])).estado.tirando, PEDRO.id);
  // A própria pessoa não é tirada, e o tirarMesmo só vale com a pergunta daquela pessoa.
  semMudar(e, cliqueEm('tirar', EU.id));
  semMudar(e, cliqueEm('tirar', 'b00000000000000f'));
  semMudar(e, cliqueEm('tirarMesmo', PEDRO.id));
  semMudar(r.estado, cliqueEm('tirarMesmo', EU.id));
});

test('o Encerrar pergunta', () => {
  const e = colegaComLista();
  // A pergunta começa no Voltar, a escolha que não encerra.
  const r = passo(e, clique('encerrar'));
  assert.equal(r.estado.encerrando, true);
  assert.deepEqual(r.efeitos, [focar('naoEncerrar')]);
  let s = passo(r.estado, clique('encerrarMesmo'));
  assert.deepEqual(s.efeitos, [mandar({ tipo: 'encerrar' })]);
  assert.equal(s.estado.encerrando, false);
  s = passo(r.estado, clique('naoEncerrar'));
  assert.equal(s.estado.encerrando, false);
  assert.deepEqual(s.efeitos, [focar('encerrar')]);
  // Sem a pergunta, o encerrarMesmo não faz nada; o encerrada que chega é o fim de hoje.
  semMudar(e, clique('encerrarMesmo'));
  s = passo(r.estado, mensagem({ tipo: 'encerrada' }));
  assert.equal(s.estado.aviso, 'encerrada');
  assert.equal(s.estado.encerrando, false);
});

test('o Encerrar para todos não abre a pergunta antes de a lista chegar', () => {
  semMudar(colegaNaReuniao(), cliqueEm('encerrar'));
  assert.equal(passo(colegaComLista(), cliqueEm('encerrar')).estado.encerrando, true);
});

test('a recusa cheia aparece, e a jaRespondido não', () => {
  const e = colegaComLista();
  // A frase aparece no cartão e no painel, e o leitor de tela a ouve.
  const r = rodar(e, cliqueEm('aceitar', MARIA.id), recusa('aceitar', 'cheia'));
  assert.equal(r.estado.cheiaAoAceitar, true);
  assert.deepEqual(r.efeitos, [dizer('A reunião está cheia: ninguém mais entra agora.')]);
  // A cada vez que ela aparece de novo.
  const outra = rodar(r.estado, cliqueEm('aceitar', MARIA.id), recusa('aceitar', 'cheia'));
  assert.deepEqual(outra.efeitos, [dizer('A reunião está cheia: ninguém mais entra agora.')]);
  // Ela sai com a lista nova, ou quando a pessoa responde de novo.
  assert.equal(passo(r.estado, lista([EU, PEDRO], [MARIA, BIA])).estado.cheiaAoAceitar, false);
  assert.equal(passo(r.estado, cliqueEm('recusar', BIA.id)).estado.cheiaAoAceitar, false);
  for (const motivo of ['jaRespondido', 'naoEncontrado', 'foraDaReuniao']) {
    semMudar(e, recusa('aceitar', motivo));
    const s = rodar(e, cliqueEm('aceitar', MARIA.id), recusa('aceitar', motivo));
    assert.equal(s.estado.cheiaAoAceitar, false);
    assert.equal(s.estado.avisoCurto, null);
    assert.deepEqual(s.efeitos, []);
  }
});

test('a recusa servidorVideo mostra o aviso curto do servidor', () => {
  const e = colegaComLista();
  const r = rodar(e, cliqueEm('tirar', PEDRO.id), cliqueEm('tirarMesmo', PEDRO.id), recusa('tirar', 'servidorVideo'));
  assert.deepEqual(r.estado.avisoCurto, { n: 1, tipo: 'servidor' });
  assert.deepEqual(r.efeitos, [tempoDoAviso(1), dizer('O servidor de reuniões não respondeu')]);
  // O aviso vive os 5 segundos dos outros.
  assert.equal(passo(r.estado, tempo('avisoCurto:1')).estado.avisoCurto, null);
  // O encerrar recusado também.
  const s = rodar(e, clique('encerrar'), clique('encerrarMesmo'), recusa('encerrar', 'servidorVideo'));
  assert.deepEqual(s.estado.avisoCurto, { n: 1, tipo: 'servidor' });
});

// O colega na reunião sem o canal: o religar em curso (o canal caiu, e a ligação segue no ar), e o colega que deixou
// de cuidar da reunião (a chave recusada no religar: o canal não volta mais, e a lista sai).
const RECUSADA_NO_RELIGAR = mensagem({ tipo: 'erro', erro: 'invalido' });
const colegaSemCanal = () => ({
  religando: passo(colegaComLista(), canalFechou(1006)).estado,
  semCuidar: rodar(colegaComLista(), canalFechou(1006), tempo('religar:1'), abriu(3), CANAL_ABRIU, RECUSADA_NO_RELIGAR)
    .estado,
});
// A resposta que não sai é como a recusa servidorVideo: nada vai ao canal, e o aviso curto do servidor aparece e é dito.
function comOAvisoDoServidor(antes, r) {
  const n = antes.avisos + 1;
  assert.deepEqual(r.estado.avisoCurto, { n, tipo: 'servidor' });
  assert.deepEqual(r.efeitos, [tempoDoAviso(n), dizer('O servidor de reuniões não respondeu')]);
  assert.deepEqual(r.estado.respondendo, []);
}
// Quem deixou de cuidar não tem mais ninguém na lista, nem o Encerrar para todos: o clique não faz nada.
function semCuidarNaoFazNada(e, ...cliques) {
  assert.equal(e.semCuidar, true);
  assert.deepEqual(e.lista, { participantes: [], pedidos: [] });
  for (const c of cliques) semMudar(e, c);
}

test('o aceitar sem o canal mostra o aviso do servidor', () => {
  for (const [quando, e] of Object.entries(colegaSemCanal())) assert.notEqual(e.canal, 'aberto', quando);
  const { religando, semCuidar } = colegaSemCanal();
  comOAvisoDoServidor(religando, passo(religando, cliqueEm('aceitar', MARIA.id)));
  semCuidarNaoFazNada(semCuidar, cliqueEm('aceitar', MARIA.id));
});

test('o recusar sem o canal mostra o aviso do servidor', () => {
  const { religando, semCuidar } = colegaSemCanal();
  comOAvisoDoServidor(religando, passo(religando, cliqueEm('recusar', BIA.id)));
  semCuidarNaoFazNada(semCuidar, cliqueEm('recusar', BIA.id));
});

test('o tirar sem o canal mostra o aviso do servidor, e a pergunta se desfaz', () => {
  const { religando, semCuidar } = colegaSemCanal();
  const perguntando = passo(religando, cliqueEm('tirar', PEDRO.id)).estado;
  const r = passo(perguntando, cliqueEm('tirarMesmo', PEDRO.id));
  comOAvisoDoServidor(perguntando, r);
  assert.equal(r.estado.tirando, null);
  // Sem a linha de Pedro, a pergunta nem abre.
  semCuidarNaoFazNada(semCuidar, cliqueEm('tirar', PEDRO.id), cliqueEm('tirarMesmo', PEDRO.id));
});

test('o encerrar sem o canal mostra o aviso do servidor, e o diálogo fecha', () => {
  const { religando, semCuidar } = colegaSemCanal();
  const perguntando = passo(religando, clique('encerrar')).estado;
  const r = passo(perguntando, clique('encerrarMesmo'));
  comOAvisoDoServidor(perguntando, r);
  assert.equal(r.estado.encerrando, false);
  // Com o semCuidar, o Encerrar para todos não abre a pergunta, e sem ela o encerrarMesmo não manda nada.
  semCuidarNaoFazNada(semCuidar, clique('encerrar'), clique('encerrarMesmo'));
});

const feito = (de, id) => mensagem({ tipo: 'feito', de, id });

test('o resultado de cada resposta é dito', () => {
  const e = colegaComLista();
  let r = rodar(e, cliqueEm('aceitar', MARIA.id), feito('aceitar', MARIA.id));
  assert.deepEqual(r.efeitos, [dizer('O pedido de Maria Lima foi aceito')]);
  // Uma vez só.
  assert.deepEqual(passo(r.estado, feito('aceitar', MARIA.id)).efeitos, []);
  r = rodar(e, cliqueEm('recusar', BIA.id), feito('recusar', BIA.id));
  assert.deepEqual(r.efeitos, [dizer('O pedido de Bia Ramos foi recusado')]);
  r = rodar(e, cliqueEm('tirar', PEDRO.id), cliqueEm('tirarMesmo', PEDRO.id), feito('tirar', PEDRO.id));
  assert.deepEqual(r.efeitos, [dizer('Pedro Nunes saiu da reunião')]);
  // A lista, com o pedido fora ou dentro, não diz o resultado: só o feito diz.
  r = rodar(e, cliqueEm('recusar', BIA.id), lista([EU, PEDRO], [MARIA]));
  assert.deepEqual(r.efeitos, []);
  r = rodar(e, cliqueEm('tirar', PEDRO.id), cliqueEm('tirarMesmo', PEDRO.id), lista([EU], [MARIA, BIA]));
  assert.deepEqual(r.efeitos, []);
  // Com um recusa no meio, nada é dito, mesmo com o feito de outra resposta que não é a dela.
  r = rodar(e, cliqueEm('aceitar', MARIA.id), recusa('aceitar', 'jaRespondido'), lista([EU, PEDRO], [BIA]));
  assert.deepEqual(r.efeitos, []);
  r = rodar(e, cliqueEm('aceitar', MARIA.id), recusa('aceitar', 'cheia'), lista([EU, PEDRO], [BIA]));
  assert.deepEqual(r.efeitos, []);
});

test('o resultado de uma resposta é dito quando o servidor a confirma', () => {
  const respondeu = passo(colegaComLista(), cliqueEm('aceitar', MARIA.id));
  assert.deepEqual(respondeu.efeitos, [mandar({ tipo: 'aceitar', pedido: MARIA.id })]);
  // A lista nova, sem o pedido, não diz nada sozinha: outro colega pode ter respondido antes.
  const semMaria = passo(respondeu.estado, lista([EU, PEDRO, MARIA_NA_REUNIAO], [BIA]));
  assert.deepEqual(semMaria.efeitos, []);
  assert.deepEqual(semMaria.estado.respondendo, [{ de: 'aceitar', id: MARIA.id, nome: 'Maria Lima' }]);
  // O feito diz, antes ou depois da lista.
  for (const antes of [respondeu.estado, semMaria.estado]) {
    const r = passo(antes, feito('aceitar', MARIA.id));
    assert.deepEqual(r.efeitos, [dizer('O pedido de Maria Lima foi aceito')]);
    assert.deepEqual(r.estado.respondendo, []);
  }
  // A recusa (outro colega respondeu antes) não diz nada, mesmo com a lista já sem o pedido.
  const perdeu = passo(semMaria.estado, recusa('aceitar', 'jaRespondido'));
  assert.deepEqual(perdeu.efeitos, []);
  assert.deepEqual(perdeu.estado.respondendo, []);
  // O feito de outra resposta, de outro pedido, ou sem resposta esperando, fica de fora.
  semMudar(respondeu.estado, feito('recusar', MARIA.id));
  semMudar(respondeu.estado, feito('aceitar', BIA.id));
  semMudar(colegaComLista(), feito('aceitar', MARIA.id));
});

test('o segundo clique na mesma resposta não manda de novo', () => {
  const respondeu = passo(colegaComLista(), cliqueEm('aceitar', MARIA.id)).estado;
  semMudar(respondeu, cliqueEm('aceitar', MARIA.id));
  // Outra resposta ao mesmo pedido sai: a pessoa mudou de ideia, e o servidor decide qual vale.
  const outra = passo(respondeu, cliqueEm('recusar', MARIA.id));
  assert.deepEqual(outra.efeitos, [mandar({ tipo: 'recusar', pedido: MARIA.id })]);
});

test('as respostas que esperavam saem com o canal que cai', () => {
  const r = rodar(colegaComLista(), cliqueEm('aceitar', MARIA.id), canalFechou(1006));
  assert.deepEqual(r.estado.respondendo, []);
});

test('o pedido que chega é dito', () => {
  const e = passo(colegaNaReuniao(), lista([EU], [])).estado;
  let r = passo(e, lista([EU], [MARIA]));
  assert.deepEqual(r.efeitos, [dizer('Maria Lima quer entrar')]);
  // O mesmo pedido não é dito de novo; o próximo que chega, é.
  r = passo(r.estado, lista([EU, PEDRO], [MARIA]));
  assert.deepEqual(r.efeitos, []);
  r = passo(r.estado, lista([EU, PEDRO], [MARIA, BIA]));
  assert.deepEqual(r.efeitos, [dizer('Bia Ramos quer entrar')]);
});

// A região que o leitor de tela ouve guarda um texto só: o que um passo diz sai num dizer, os textos na ordem.
test('o que um passo diz sai junto', () => {
  const e = passo(colegaNaReuniao(), lista([EU], [])).estado;
  // Dois pedidos na mesma lista.
  assert.deepEqual(passo(e, lista([EU], [MARIA, BIA])).efeitos, [
    dizer('Maria Lima quer entrar. Bia Ramos quer entrar'),
  ]);
  // O resultado de uma resposta vem no feito, num passo à parte da lista com o pedido novo.
  const ROBERTO = { id: 'a000000000000003', nome: 'Roberto Alves' };
  const r = rodar(colegaComLista(), cliqueEm('aceitar', MARIA.id), lista([EU, PEDRO, MARIA_NA_REUNIAO], [BIA, ROBERTO]));
  assert.deepEqual(r.efeitos, [dizer('Roberto Alves quer entrar')]);
  assert.deepEqual(passo(r.estado, feito('aceitar', MARIA.id)).efeitos, [dizer('O pedido de Maria Lima foi aceito')]);
});

test('quem é de fora ignora o que é do colega', () => {
  const e = naReuniao();
  semMudar(e, lista([EU], [MARIA]));
  semMudar(e, recusa('aceitar', 'cheia'));
  semMudar(e, recusa('tirar', 'servidorVideo'));
  for (const botao of ['participantes', 'fecharParticipantes', 'verPedidos', 'naoTirar', 'encerrar']) {
    semMudar(e, clique(botao));
  }
  for (const botao of ['encerrarMesmo', 'naoEncerrar', 'entrar']) semMudar(e, clique(botao));
  for (const botao of ['aceitar', 'recusar', 'tirar', 'tirarMesmo']) semMudar(e, cliqueEm(botao, MARIA.id));
  // Na entrada de quem é de fora, o Entrar não faz nada.
  semMudar(naEntrada(), clique('entrar'));
});

test('o Entrar de novo do colega', () => {
  // A página de quem é de fora, com o canal fechado, faria o abrir sem corpo e o pedir novo.
  const antes = rodar(colegaNaReuniao(), canalFechou(1006), clique('sair')).estado;
  assert.equal(antes.canal, 'fechado');
  let r = passo(antes, clique('entrarDeNovo'));
  assert.equal(r.estado.tela, 'entrando');
  assert.equal(r.estado.aceito, false);
  assert.deepEqual(r.efeitos, [PEDIR_MIDIA, abrirDoColega(3), FOCAR]);
  r = rodar(r.estado, abriu(3), CANAL_ABRIU);
  assert.deepEqual(r.efeitos, [ENTRAR]);
  r = passo(r.estado, mensagem({ ...ACEITO_COM_CHAVE, senha: 'senha-2' }));
  assert.equal(r.estado.aceito, true);
  // O colega que sai antes do aceito larga o canal do entrar, e o Entrar de novo abre outro.
  r = passo(colegaEntrando(), clique('sair'));
  assert.equal(r.estado.aviso, 'saiu');
  assert.equal(r.estado.canal, 'fechado');
  assert.deepEqual(r.efeitos, [FECHAR_CANAL, PARAR_MIDIA, FOCAR]);
  r = passo(r.estado, clique('entrarDeNovo'));
  assert.deepEqual(r.efeitos, [PEDIR_MIDIA, abrirDoColega(3), FOCAR]);
});

test('o estado nunca muda no lugar', () => {
  // O passo congela o estado antes de cada evento: um evento que o mudasse no lugar daria erro.
  const r = rodar(
    inicial(),
    COMECAR_COM_PASSE,
    abriuColega(1, COLEGA),
    midia('ligado', 'ligado'),
    clique('entrar'),
    abriuColega(2),
    CANAL_ABRIU,
    mensagem(ACEITO_COM_CHAVE),
    ligacao('principal', 'confirmada'),
    lista([EU, PEDRO], [MARIA, BIA]),
    clique('chat'),
    clique('participantes'),
    clique('verPedidos'),
    cliqueEm('aceitar', MARIA.id),
    recusa('aceitar', 'cheia'),
    cliqueEm('recusar', BIA.id),
    lista([EU, PEDRO], [MARIA]),
    cliqueEm('tirar', PEDRO.id),
    clique('naoTirar'),
    cliqueEm('tirar', PEDRO.id),
    cliqueEm('tirarMesmo', PEDRO.id),
    recusa('tirar', 'servidorVideo'),
    lista([EU], [MARIA]),
    clique('fecharParticipantes'),
    clique('encerrar'),
    clique('naoEncerrar'),
    clique('encerrar'),
    clique('encerrarMesmo'),
    tempo('avisoCurto:1'),
    mensagem({ tipo: 'encerrada' }),
  );
  assert.equal(r.estado.aviso, 'encerrada');
  rodar(inicial(), COMECAR_COM_PASSE, passeRecusado(1), abriu(2));
  rodar(colegaNaEntrada(), clique('entrar'), passeRecusado(2));
});

test('o link que não vale tira o passe do estado', () => {
  // O 404 do primeiro abrir é o fim: o passe que ele levava não fica para nada.
  const r = rodar(inicial(), COMECAR_COM_PASSE, abrirFalhou(1, 404));
  assert.equal(r.estado.aviso, 'linkInvalido');
  assert.equal(r.estado.passe, null);
  assert.ok(!JSON.stringify(r.estado).includes(PASSE));
});

// ---- A tela "o app ou o navegador" ----

// A página no Windows, sem o passe; a reunião na hora e a de teste.
const COMECAR_NO_WINDOWS = { tipo: 'comecar', passe: null, windows: true };
const NA_HORA = { tipo: 'naHora', assunto: 'Conversa rápida', inicio: null };
const DE_TESTE = { tipo: 'teste', assunto: null, inicio: null };
const abriuA = (abertura, reuniao) => ({ ...abriu(abertura), reuniao });
const NOME = { tipo: 'nome', valor: 'Maria Lima' };

test('a escolha no Windows', () => {
  for (const reuniao of [REUNIAO, NA_HORA]) {
    const r = rodar(inicial(), COMECAR_NO_WINDOWS, abriuA(1, reuniao));
    assert.equal(r.estado.tela, 'escolha');
    assert.deepEqual(r.estado.reuniao, reuniao);
    // A mídia não é pedida: só a entrada a pede.
    assert.equal(r.estado.esperandoMidia, false);
    assert.deepEqual(r.efeitos, [FOCAR]);
    assert.equal(r.estado.semColega, false);
  }
  // O passe que não vale, no Windows: a escolha, com a faixa do colega que não foi reconhecido.
  const r = rodar(inicial(), { ...COMECAR_NO_WINDOWS, passe: PASSE }, passeRecusado(1), abriu(2));
  assert.equal(r.estado.tela, 'escolha');
  assert.equal(r.estado.semColega, true);
  assert.equal(r.estado.colega, null);
  assert.deepEqual(r.efeitos, [FOCAR, dizer(FAIXA)]);
  // Na escolha, o que é da entrada não faz nada.
  for (const evento of [NOME, clique('pedir'), clique('entrar'), clique('tentarMidia')]) semMudar(r.estado, evento);
});

test('sem escolha', () => {
  // Na reunião de teste, mesmo no Windows.
  let r = rodar(inicial(), COMECAR_NO_WINDOWS, abriuA(1, DE_TESTE));
  assert.equal(r.estado.tela, 'entrada');
  assert.deepEqual(r.efeitos, [PEDIR_MIDIA, FOCAR]);
  // Fora do Windows: o windows falso, ausente, ou que não é o true.
  const foraDoWindows = [COMECAR, { tipo: 'comecar', passe: null, windows: false }, { tipo: 'comecar', windows: 'sim' }];
  for (const comecar of foraDoWindows) {
    r = rodar(inicial(), comecar, abriu(1));
    assert.equal(r.estado.tela, 'entrada', JSON.stringify(comecar));
    assert.deepEqual(r.efeitos, [PEDIR_MIDIA, FOCAR]);
  }
  // Com o colega reconhecido, no Windows: a entrada dele.
  r = rodar(inicial(), { ...COMECAR_NO_WINDOWS, passe: PASSE }, abriuColega(1, COLEGA));
  assert.equal(r.estado.tela, 'entrada');
  assert.deepEqual(r.estado.colega, { nome: 'Júlia Martins', valeAte: VALE_ATE });
  assert.deepEqual(r.efeitos, [PEDIR_MIDIA, FOCAR]);
});

test('Entrar pelo navegador', () => {
  const naEscolha = rodar(inicial(), COMECAR_NO_WINDOWS, abriu(1)).estado;
  // A entrada de quem é de fora, e a mídia é pedida só aqui.
  let r = passo(naEscolha, clique('peloNavegador'));
  assert.equal(r.estado.tela, 'entrada');
  assert.equal(r.estado.colega, null);
  assert.equal(r.estado.esperandoMidia, true);
  assert.equal(r.estado.peloNavegador, true);
  assert.deepEqual(r.efeitos, [PEDIR_MIDIA, FOCAR]);
  // O nome e o Pedir para entrar de hoje: o abrir sem corpo, e o pedir.
  r = rodar(r.estado, midia('ligado', 'ligado'), NOME, clique('pedir'));
  assert.deepEqual(r.efeitos, [abrir(2), FOCAR]);
  r = rodar(r.estado, abriu(2), CANAL_ABRIU);
  assert.deepEqual(r.efeitos, [PEDIR]);
  // A faixa do passe que não valeu fica na entrada.
  r = rodar(inicial(), { ...COMECAR_NO_WINDOWS, passe: PASSE }, passeRecusado(1), abriu(2), clique('peloNavegador'));
  assert.equal(r.estado.tela, 'entrada');
  assert.equal(r.estado.semColega, true);
  // Fora da escolha, o clique não faz nada.
  semMudar(naEntrada(), clique('peloNavegador'));
  semMudar(passo(inicial(), COMECAR_NO_WINDOWS).estado, clique('peloNavegador'));
  semMudar(naReuniao(), clique('peloNavegador'));
});

test('os avisos passam na frente', () => {
  for (const [falha, aviso] of [
    [abrirFalhou(1, 404), 'linkInvalido'],
    [abrirFalhou(1, 0), 'semServidor'],
    [abrirFalhou(1, 429, 5), 'tentativas'],
  ]) {
    const r = rodar(inicial(), COMECAR_NO_WINDOWS, falha);
    assert.equal(r.estado.tela, 'aviso');
    assert.equal(r.estado.aviso, aviso);
  }
  // O Tentar de novo volta a carregar, e a escolha só vem com o abriu.
  let r = rodar(inicial(), COMECAR_NO_WINDOWS, abrirFalhou(1, 0), clique('tentarDeNovo'));
  assert.equal(r.estado.tela, 'carregando');
  assert.deepEqual(r.efeitos, [abrir(2), FOCAR]);
  r = passo(r.estado, abriu(2));
  assert.equal(r.estado.tela, 'escolha');
  assert.deepEqual(r.efeitos, [FOCAR]);
});

test('a escolha não volta', () => {
  const pelaEscolha = rodar(
    inicial(),
    COMECAR_NO_WINDOWS,
    abriu(1),
    clique('peloNavegador'),
    midia('ligado', 'ligado'),
    NOME,
  ).estado;
  // O Tentar de novo: o pedido que falhou abre de novo, e segue na espera.
  let r = rodar(pelaEscolha, clique('pedir'), abrirFalhou(2, 0), clique('tentarDeNovo'), abriu(3));
  assert.equal(r.estado.tela, 'pedindo');
  assert.equal(r.estado.canal, 'abrindo');
  // A volta: na reunião, o canal cai e volta por trás com o abrir do voltar.
  r = rodar(
    pelaEscolha,
    clique('pedir'),
    abriu(2),
    CANAL_ABRIU,
    mensagem(ACEITO_COM_CHAVE),
    ligacao('principal', 'confirmada'),
    canalFechou(1006),
    tempo('religar:1'),
    abriu(3),
  );
  assert.equal(r.estado.tela, 'reuniao');
  assert.deepEqual(r.efeitos, [abrirCanal(3)]);
  // E um abriu do carregar, na mesma página, vai direto à entrada.
  r = passo({ ...pelaEscolha, tela: 'carregando', abertura: 4 }, abriu(4));
  assert.equal(r.estado.tela, 'entrada');
  assert.deepEqual(r.efeitos, [PEDIR_MIDIA, FOCAR]);
});

const SEM_CUIDAR =
  'Você deixou de cuidar desta reunião. Para aceitar pedidos ou encerrar, saia e abra a reunião de novo pelo app.';
// O colega na reunião, com a partida do servidor no estado e a lista: no navegador e dentro do app.
const colegaComPartida = () =>
  rodar(inicial(), COMECAR_COM_PASSE, comPartida(abriuColega(1, COLEGA)), midia('ligado', 'ligado'), clique('entrar'),
    comPartida(abriuColega(2)), CANAL_ABRIU, mensagem(ACEITO_COM_CHAVE), ligacao('principal', 'confirmada'),
    lista([EU, PEDRO], [MARIA, BIA])).estado;
const noAppComPartida = () =>
  rodar(inicial(), COMECAR_NO_APP, passeDoApp(), comPartida(abriuColega(1, COLEGA)), midia('ligado', 'ligado'),
    clique('entrar'), comPartida(abriuColega(2)), CANAL_ABRIU, mensagem(ACEITO_COM_CHAVE),
    ligacao('principal', 'confirmada'), lista([EU, PEDRO], [MARIA, BIA])).estado;
const deForaComPartida = () =>
  rodar(inicial(), COMECAR, comPartida(abriu(1)), midia('ligado', 'ligado'), { tipo: 'nome', valor: 'Maria Lima' },
    clique('pedir'), comPartida(abriu(2)), CANAL_ABRIU, mensagem({ tipo: 'aguardando' }), mensagem(ACEITO_COM_CHAVE),
    ligacao('principal', 'confirmada')).estado;
// O canal caiu, o religar abriu de novo, e o abrir respondeu com outra partida: o chat reiniciou.
const REINICIOU = [canalFechou(1006), tempo('religar:1'), comPartida(abriu(3), 'partida-2')];

test('o chat reiniciou com o colega na reunião, no navegador: ele deixa de cuidar', () => {
  const r = rodar(colegaComPartida(), ...REINICIOU);
  // O voltar não sai e o canal não abre: o chat não conhece mais a pessoa.
  assert.deepEqual(r.efeitos, [dizer(SEM_CUIDAR)]);
  assert.equal(r.estado.semCuidar, true);
  assert.equal(r.estado.tela, 'reuniao');
  assert.equal(r.estado.principal, 'noAr');
  assert.equal(r.estado.canal, 'fechado');
  assert.equal(r.estado.religando, 0);
  assert.equal(r.estado.chave, null);
  assert.equal(r.estado.partida, 'partida-2');
  assert.deepEqual(r.estado.lista, { participantes: [], pedidos: [] });
  assert.deepEqual(r.estado.respondendo, []);
  assert.equal(r.estado.palco, null);
  // Nada mais tenta voltar, e o bilhete daquele abrir não é usado.
  semMudar(r.estado, CANAL_ABRIU);
  semMudar(r.estado, tempo('prazo:1'));
  semMudar(r.estado, tempo('religar:1'));
});

test('o abrir do voltar com a mesma partida, ou sem partida, segue como hoje', () => {
  const mesma = rodar(colegaComPartida(), canalFechou(1006), tempo('religar:1'), comPartida(abriu(3)));
  assert.deepEqual(mesma.efeitos, [abrirCanal(3)]);
  assert.equal(mesma.estado.semCuidar, false);
  // A resposta sem a partida, e o estado sem ela (um servidor de antes dela).
  const semNaResposta = rodar(colegaComPartida(), canalFechou(1006), tempo('religar:1'), abriu(3));
  assert.deepEqual(semNaResposta.efeitos, [abrirCanal(3)]);
  assert.deepEqual(rodar(colegaComLista(), ...REINICIOU).efeitos, [abrirCanal(3)]);
});

test('o chat reiniciou com quem é de fora na reunião: segue como hoje, sem o voltar e sem aviso', () => {
  const r = rodar(deForaComPartida(), ...REINICIOU);
  assert.deepEqual(r.efeitos, []);
  assert.equal(r.estado.semCuidar, false);
  assert.equal(r.estado.religando, 0);
  assert.equal(r.estado.chave, null);
  assert.equal(r.estado.principal, 'noAr');
  semMudar(r.estado, CANAL_ABRIU);
});

test('o chat reiniciou e a ligação também caiu: é o saiu, sem o voltar', () => {
  for (const partida of [colegaComPartida, noAppComPartida, deForaComPartida]) {
    const caiu = [canalFechou(1006), ligacao('principal', 'semConexao'), tempo('reconectar:2')];
    const r = rodar(partida(), ...caiu, comPartida(abriu(3), 'partida-2'));
    assert.equal(r.estado.aviso, 'saiu');
    assert.equal(r.estado.queda, true);
    assert.deepEqual(r.efeitos.filter((x) => x.tipo === 'mandar' || x.tipo === 'abrirCanal'), []);
  }
});

test('a chave recusada e o link que deixou de valer, no religar do colega, são o deixou de cuidar', () => {
  const voltando = [canalFechou(1006), tempo('religar:1'), abriu(3), CANAL_ABRIU];
  for (const resposta of [RECUSADA_NO_RELIGAR, mensagem({ tipo: 'linkInvalido' })]) {
    const r = rodar(colegaComLista(), ...voltando, resposta);
    assert.deepEqual(r.efeitos, [FECHAR_CANAL, dizer(SEM_CUIDAR)]);
    assert.equal(r.estado.semCuidar, true);
    assert.deepEqual(r.estado.lista, { participantes: [], pedidos: [] });
    // Quem é de fora segue como hoje.
    const fora = rodar(naReuniaoComChave(), ...voltando, resposta);
    assert.deepEqual(fora.efeitos, [FECHAR_CANAL]);
    assert.equal(fora.estado.semCuidar, false);
  }
  // O 404 do abrir do voltar é o mesmo link que deixou de valer.
  const semLink = rodar(colegaComLista(), canalFechou(1006), tempo('religar:1'), abrirFalhou(3, 404));
  assert.deepEqual(semLink.efeitos, [dizer(SEM_CUIDAR)]);
  assert.equal(semLink.estado.semCuidar, true);
});

test('o deixou de cuidar acaba com a saída da reunião', () => {
  const sem = rodar(colegaComPartida(), ...REINICIOU).estado;
  // Sem a lista não há o que responder, e o Encerrar para todos não abre a pergunta.
  semMudar(sem, cliqueEm('encerrar'));
  assert.equal(passo(sem, clique('sair')).estado.semCuidar, false);
  // A ligação que cai depois é o saiu: sem o canal e sem a chave, não há como voltar.
  const caiu = passo(sem, ligacao('principal', 'semConexao')).estado;
  assert.equal(caiu.aviso, 'saiu');
  assert.equal(caiu.semCuidar, false);
});

test('o chat reiniciou com o colega na reunião, dentro do app: a página entra de novo sozinha', () => {
  const OUTRO_PASSE = 'q'.repeat(43);
  const OUTRA_CHAVE = 'd'.repeat(43);
  const ACEITO_2 = { ...ACEITO, participante: 'participante-2', senha: 'senha-2', volta: VOLTA_2 };
  let estado = seguir(
    noAppComPartida(),
    [
      [canalFechou(1006), [esperar(2000, 'religar:1')]],
      [tempo('religar:1'), [abrir(3), prazo(1)]],
      // Outra partida: o voltar não sai, e a página pede outro passe ao app. A ligação de antes segue no ar.
      [comPartida(abriu(3), 'partida-2'), [PRONTA, prazoDoPasse(2)]],
      [passeDoApp(OUTRO_PASSE), [abrirCom(4, { passe: OUTRO_PASSE }), prazo(2)]],
      [comPartida(abriuColega(4, { ...COLEGA, chave: OUTRA_CHAVE }), 'partida-2'), [abrirCanal(4)]],
      [CANAL_ABRIU, [ENTRAR]],
    ],
    (e) => {
      assert.equal(e.tela, 'reuniao');
      assert.equal(e.principal, 'noAr');
      assert.equal(e.semCuidar, false);
    },
  );
  assert.equal(estado.reentrando, 'entrando');
  assert.equal(estado.chaveDoColega, OUTRA_CHAVE);
  assert.equal(estado.partida, 'partida-2');
  assert.deepEqual(estado.lista, { participantes: [], pedidos: [] });
  // O aceito do canal novo: as duas ligações de antes descem, e a volta de hoje sobe a nova, com uma senha nova.
  let r = passo(estado, mensagem(ACEITO_2));
  assert.deepEqual(r.efeitos, [...DESLIGAR_AS_DUAS, esperar(2000, 'reconectar:3'), camera(true)]);
  assert.equal(r.estado.reentrando, null);
  assert.equal(r.estado.reconectando, 1);
  assert.equal(r.estado.canal, 'aberto');
  assert.deepEqual(r.estado.chave, { participante: 'participante-2', volta: VOLTA_2 });
  estado = seguir(r.estado, [
    [tempo('reconectar:3'), [SENHA, prazo(3)]],
    [mensagem({ tipo: 'senha', senha: 'senha-3' }), [ligar('principal', 'senha-3')]],
  ]);
  r = passo(estado, ligacao('principal', 'confirmada'));
  assert.equal(r.estado.tela, 'reuniao');
  assert.equal(r.estado.principal, 'noAr');
  assert.equal(r.estado.reconectando, 0);
  // O microfone e a câmera ficam como estavam, e a lista nova chega pelo canal novo.
  assert.equal(r.estado.mic, 'ligado');
  assert.equal(r.estado.cam, 'ligado');
  assert.deepEqual(passo(r.estado, lista([EU], [])).estado.lista, { participantes: [EU], pedidos: [] });
});

test('a volta sozinha que não dá certo é o deixou de cuidar, com a ligação de antes no ar', () => {
  const pedindo = rodar(noAppComPartida(), ...REINICIOU).estado;
  const abrindo = passo(pedindo, passeDoApp('q'.repeat(43))).estado;
  const entrando = rodar(abrindo, comPartida(abriuColega(4, COLEGA), 'partida-2'), CANAL_ABRIU).estado;
  const falhas = [
    [pedindo, tempo('passe:2'), []], // o app não mandou o passe
    [abrindo, abrirFalhou(4, 0), []], // a rede
    [abrindo, abrirFalhou(4, 429, 30), []],
    [abrindo, abrirFalhou(4, 404), []], // o link deixou de valer: quem está na reunião continua nela
    [abrindo, tempo('prazo:2'), []],
    [abrindo, comPartida(abriu(4), 'partida-2'), []], // o abrir que não reconheceu o colega
    [entrando, mensagem({ tipo: 'cheia' }), [FECHAR_CANAL]],
    [entrando, mensagem({ tipo: 'semServidor' }), [FECHAR_CANAL]],
    [entrando, mensagem({ tipo: 'linkInvalido' }), [FECHAR_CANAL]],
    [entrando, mensagem({ tipo: 'erro', erro: 'invalido' }), [FECHAR_CANAL]],
    [entrando, canalFechou(1006), []],
    [entrando, tempo('prazo:2'), [FECHAR_CANAL]],
  ];
  for (const [antes, evento, antesDoAviso] of falhas) {
    const r = passo(antes, evento);
    assert.deepEqual(r.efeitos, [...antesDoAviso, dizer(SEM_CUIDAR)], JSON.stringify(evento));
    assert.equal(r.estado.semCuidar, true);
    assert.equal(r.estado.reentrando, null);
    assert.equal(r.estado.principal, 'noAr');
    assert.equal(r.estado.canal, 'fechado');
    assert.equal(r.estado.esperandoPasse, false);
    assert.equal(r.estado.passe, null);
  }
});

test('na volta sozinha, o primeiro passe que não vale pede outro, e o segundo é o deixou de cuidar', () => {
  const abrindo = rodar(noAppComPartida(), ...REINICIOU, passeDoApp('q'.repeat(43))).estado;
  let r = passo(abrindo, passeRecusado(4));
  assert.deepEqual(r.efeitos, [PRONTA, prazoDoPasse(3)]);
  assert.equal(r.estado.reentrando, 'passe');
  r = rodar(r.estado, passeDoApp('r'.repeat(43)), passeRecusado(5));
  assert.deepEqual(r.efeitos, [dizer(SEM_CUIDAR)]);
  assert.equal(r.estado.semCuidar, true);
});

test('a chave recusada sem o chat ter reiniciado nunca entra de novo sozinha', () => {
  // A mesma partida: um colega tirou a pessoa, ou o servidor a esqueceu por outro motivo. Dentro do app, nada de
  // pronta.
  const voltando = [canalFechou(1006), tempo('religar:1'), comPartida(abriu(3)), CANAL_ABRIU];
  const r = rodar(noAppComPartida(), ...voltando, RECUSADA_NO_RELIGAR);
  assert.deepEqual(doAppNos(r.efeitos), []);
  assert.equal(r.estado.reentrando, null);
  assert.equal(r.estado.semCuidar, true);
});

test('quem sai no meio da volta sozinha não vira de fora quando o prazo do passe vence', () => {
  const pedindo = rodar(noAppComPartida(), ...REINICIOU).estado;
  const fora = passo(pedindo, clique('sair')).estado;
  assert.equal(fora.reentrando, null);
  assert.equal(fora.esperandoPasse, false);
  semMudar(fora, tempo('passe:2'));
  assert.notEqual(fora.colega, null);
});

// ---- A conversa com o app ----

// A página dentro do iframe do app (o comecar com o noApp): o passe chega por mensagem, com os nomes dos aparelhos das
// Configurações do app.
const COMECAR_NO_APP = { tipo: 'comecar', passe: null, windows: false, noApp: true };
const doApp = (m) => ({ tipo: 'app', m: { starsonic: 1, ...m } });
const PASSE_2 = 'q'.repeat(43);
const CHAVE_2 = 'd'.repeat(43);
const APARELHOS = { microfone: 'Microfone USB', altoFalante: 'Fone Bluetooth', camera: 'Câmera HD' };
const passeDoApp = (passe = PASSE, aparelhos = APARELHOS) => doApp({ tipo: 'passe', passe, aparelhos });
const SAIR_DO_APP = doApp({ tipo: 'sair' });
const avisarApp = (m) => ({ tipo: 'avisarApp', m });
const PRONTA = avisarApp({ tipo: 'pronta' });
const fim = (motivo) => avisarApp({ tipo: 'fim', motivo });
const prazoDoPasse = (n) => esperar(15000, `passe:${n}`);
const doAppNos = (efeitos) => efeitos.filter((x) => x.tipo === 'avisarApp');

// Os estados de partida do colega no app. O abrir 1 é o do passe que o app mandou, e o 2, o do Entrar, com a chave.
const noAppNaEntrada = () =>
  rodar(inicial(), COMECAR_NO_APP, passeDoApp(), abriuColega(1, COLEGA), midia('ligado', 'ligado')).estado;
const noAppEntrando = () => rodar(noAppNaEntrada(), clique('entrar'), abriuColega(2), CANAL_ABRIU).estado;
const noAppNaReuniao = () =>
  rodar(noAppEntrando(), mensagem(ACEITO_COM_CHAVE), ligacao('principal', 'confirmada')).estado;

test('dentro do app, a página pede o passe', () => {
  const r = passo(inicial(), COMECAR_NO_APP);
  assert.equal(r.estado.tela, 'carregando');
  assert.equal(r.estado.noApp, true);
  assert.equal(r.estado.esperandoPasse, true);
  // O pronta, e o prazo de 15 s: nenhum abrir antes do passe.
  assert.deepEqual(r.efeitos, [PRONTA, prazoDoPasse(1)]);
  // O passe do endereço não vale dentro do app: o passe é o da mensagem.
  const s = passo(inicial(), { ...COMECAR_NO_APP, passe: PASSE });
  assert.equal(s.estado.passe, null);
  assert.deepEqual(s.efeitos, [PRONTA, prazoDoPasse(1)]);
});

test('o passe do app começa tudo', () => {
  let r = rodar(inicial(), COMECAR_NO_APP, passeDoApp());
  assert.equal(r.estado.passe, PASSE);
  assert.equal(r.estado.esperandoPasse, false);
  assert.deepEqual(r.estado.aparelhos, APARELHOS);
  assert.deepEqual(r.efeitos, [abrirCom(1, { passe: PASSE })]);
  r = passo(r.estado, abriuColega(1, COLEGA));
  assert.equal(r.estado.tela, 'entrada');
  assert.deepEqual(r.estado.colega, { nome: 'Júlia Martins', valeAte: VALE_ATE });
  assert.equal(r.estado.chaveDoColega, CHAVE_DO_COLEGA);
  assert.deepEqual(r.efeitos, [PEDIR_MIDIA, FOCAR]);
  // O prazo do pronta que vence depois, e outro passe que chega sem um pronta, não mudam nada.
  semMudar(r.estado, tempo('passe:1'));
  semMudar(r.estado, passeDoApp(PASSE_2));
  // Um nome que falta, ou vazio, é o padrão do sistema.
  const s = rodar(inicial(), COMECAR_NO_APP, passeDoApp(PASSE, { microfone: 'Microfone USB', camera: '' }));
  assert.deepEqual(s.estado.aparelhos, { microfone: 'Microfone USB', altoFalante: '', camera: '' });
  // O maior nome que vale: 200 caracteres.
  const longo = 'ã'.repeat(200);
  const t = rodar(inicial(), COMECAR_NO_APP, passeDoApp(PASSE, { camera: longo }));
  assert.equal(t.estado.aparelhos.camera, longo);
});

test('sem o passe em 15 s', () => {
  let r = rodar(inicial(), COMECAR_NO_APP, tempo('passe:1'));
  assert.equal(r.estado.tela, 'carregando');
  assert.equal(r.estado.semColega, true);
  assert.equal(r.estado.esperandoPasse, false);
  assert.deepEqual(r.efeitos, [abrir(1)]);
  r = passo(r.estado, abriu(1));
  assert.equal(r.estado.tela, 'entrada');
  assert.equal(r.estado.colega, null);
  assert.deepEqual(r.efeitos, [PEDIR_MIDIA, FOCAR, dizer(FAIXA)]);
  // O passe que chega depois fica de fora.
  semMudar(r.estado, passeDoApp());
  // O prazo de outro pronta também.
  semMudar(passo(inicial(), COMECAR_NO_APP).estado, tempo('passe:2'));
});

test('o passe que não valeu, dentro do app', () => {
  // O passe venceu antes de a página carregar: ela diz pronta de novo, uma vez.
  let r = rodar(inicial(), COMECAR_NO_APP, passeDoApp(), passeRecusado(1));
  assert.equal(r.estado.tela, 'carregando');
  assert.equal(r.estado.semColega, false);
  assert.equal(r.estado.passe, null);
  assert.deepEqual(r.efeitos, [PRONTA, prazoDoPasse(2)]);
  // O prazo do primeiro pronta não vale mais.
  semMudar(r.estado, tempo('passe:1'));
  r = passo(r.estado, passeDoApp(PASSE_2));
  assert.deepEqual(r.efeitos, [abrirCom(2, { passe: PASSE_2 })]);
  // O segundo passe que vale: o colega.
  const ok = passo(r.estado, abriuColega(2, COLEGA));
  assert.equal(ok.estado.tela, 'entrada');
  assert.deepEqual(ok.estado.colega, { nome: 'Júlia Martins', valeAte: VALE_ATE });
  // O segundo que também não vale: o abrir sem corpo, e a entrada de quem é de fora, com a faixa.
  r = passo(r.estado, passeRecusado(2));
  assert.equal(r.estado.semColega, true);
  assert.equal(r.estado.passe, null);
  assert.deepEqual(r.efeitos, [abrir(3)]);
  r = passo(r.estado, abriu(3));
  assert.equal(r.estado.tela, 'entrada');
  assert.equal(r.estado.colega, null);
  assert.deepEqual(r.efeitos, [PEDIR_MIDIA, FOCAR, dizer(FAIXA)]);
  assert.ok(!JSON.stringify(r.estado).includes(PASSE_2));
});

test('o Entrar de novo com a chave vencida, dentro do app', () => {
  // O chat reiniciou, e a chave do colega não vale mais: a página pede outro passe sozinha, na tela entrando.
  let r = rodar(noAppNaEntrada(), clique('entrar'), passeRecusado(2));
  assert.equal(r.estado.tela, 'entrando');
  assert.equal(r.estado.semColega, false);
  assert.equal(r.estado.chaveDoColega, null);
  assert.deepEqual(r.efeitos, [PRONTA, prazoDoPasse(2)]);
  r = passo(r.estado, passeDoApp(PASSE_2));
  assert.deepEqual(r.efeitos, [abrirCom(3, { passe: PASSE_2 })]);
  r = passo(r.estado, abriuColega(3, { ...COLEGA, chave: CHAVE_2 }));
  assert.equal(r.estado.chaveDoColega, CHAVE_2);
  assert.equal(r.estado.passe, null);
  assert.deepEqual(r.efeitos, [abrirCanal(3)]);
  // O canal de colega, e o entrar, sem outro clique.
  r = passo(r.estado, CANAL_ABRIU);
  assert.equal(r.estado.tela, 'entrando');
  assert.deepEqual(r.efeitos, [ENTRAR]);
  // A chave nova que deixa de valer depois pede outro passe de novo.
  const outra = rodar(r.estado, mensagem({ tipo: 'cheia' }), canalFechou(1000), clique('tentarDeNovo'), passeRecusado(4));
  assert.deepEqual(outra.efeitos, [PRONTA, prazoDoPasse(3)]);

  // O Entrar de novo depois do Sair, com o canal caído: o mesmo caminho.
  const deNovo = rodar(noAppNaReuniao(), canalFechou(1006), clique('sair'), clique('entrarDeNovo'));
  assert.deepEqual(deNovo.efeitos, [PEDIR_MIDIA, abrirDoColega(3), FOCAR]);
  const e = seguir(deNovo.estado, [
    [passeRecusado(3), [PRONTA, prazoDoPasse(2)]],
    [passeDoApp(PASSE_2), [abrirCom(4, { passe: PASSE_2 })]],
    [abriuColega(4, { ...COLEGA, chave: CHAVE_2 }), [abrirCanal(4)]],
    [CANAL_ABRIU, [ENTRAR]],
  ]);
  assert.equal(e.chaveDoColega, CHAVE_2);

  // O passe novo que também não vale: a entrada de quem é de fora, com a faixa.
  r = rodar(noAppNaEntrada(), clique('entrar'), passeRecusado(2), passeDoApp(PASSE_2), passeRecusado(3));
  assert.equal(r.estado.tela, 'entrada');
  assert.equal(r.estado.semColega, true);
  assert.equal(r.estado.colega, null);
  assert.deepEqual(r.efeitos, [FOCAR, dizer(FAIXA)]);
  // O prazo que vence sem o passe novo, também.
  r = rodar(noAppNaEntrada(), clique('entrar'), passeRecusado(2), tempo('passe:2'));
  assert.equal(r.estado.tela, 'entrada');
  assert.equal(r.estado.semColega, true);
  assert.deepEqual(r.efeitos, [FOCAR, dizer(FAIXA)]);
});

test('o estado vai ao app quando muda', () => {
  // Carregando, nada.
  assert.equal(paraOApp(inicial()), null);
  assert.equal(paraOApp(passo(inicial(), COMECAR_NO_APP).estado), null);
  // A entrada, e o microfone que os outros ouvem.
  const entrada = noAppNaEntrada();
  assert.deepEqual(paraOApp(entrada), { fase: 'entrada', microfone: true });
  assert.deepEqual(paraOApp(passo(entrada, clique('microfone')).estado), { fase: 'entrada', microfone: false });
  // Os avisos de antes de entrar, e a tela entrando.
  for (const e of [
    rodar(noAppNaEntrada(), clique('entrar'), abrirFalhou(2, 0)).estado,
    rodar(inicial(), COMECAR_NO_APP, passeDoApp(), abrirFalhou(1, 404)).estado,
    noAppEntrando(),
  ]) {
    assert.deepEqual(paraOApp(e), { fase: 'entrada', microfone: true });
  }
  // A reunião, também com a conexão caída.
  const reuniao = noAppNaReuniao();
  assert.deepEqual(paraOApp(reuniao), { fase: 'naReuniao', microfone: true });
  assert.deepEqual(paraOApp(passo(reuniao, clique('microfone')).estado), { fase: 'naReuniao', microfone: false });
  assert.deepEqual(paraOApp(passo(reuniao, SEM_CONEXAO).estado), { fase: 'naReuniao', microfone: true });
  // A queda: o "Você saiu da reunião" sem o Sair é o fora; o do Sair é a entrada.
  const caiu = rodar(reuniao, ligacao('principal', 'terminou'), tempo('fimSemAviso')).estado;
  assert.equal(caiu.aviso, 'saiu');
  assert.deepEqual(paraOApp(caiu), { fase: 'fora', microfone: true });
  const saiuPeloBotao = passo(reuniao, clique('sair')).estado;
  assert.equal(saiuPeloBotao.aviso, 'saiu');
  assert.deepEqual(paraOApp(saiuPeloBotao), { fase: 'entrada', microfone: true });
  // O Entrar de novo depois da queda volta à entrada.
  assert.deepEqual(paraOApp(passo(caiu, clique('entrarDeNovo')).estado), { fase: 'entrada', microfone: true });
});

test('o fim de cada jeito', () => {
  const e = noAppNaReuniao();
  let r = passo(e, clique('sair'));
  assert.equal(r.estado.aviso, 'saiu');
  assert.deepEqual(doAppNos(r.efeitos), [fim('saiu')]);
  for (const [m, motivo] of [
    [{ tipo: 'tirado' }, 'tirado'],
    [{ tipo: 'encerrada' }, 'acabou'],
    [{ tipo: 'linkInvalido' }, 'linkInvalido'],
  ]) {
    r = passo(e, mensagem(m));
    assert.equal(r.estado.aviso, m.tipo);
    assert.deepEqual(doAppNos(r.efeitos), [fim(motivo)], motivo);
  }
  // O linkInvalido de antes de entrar não é um fim.
  r = rodar(inicial(), COMECAR_NO_APP, passeDoApp(), abrirFalhou(1, 404));
  assert.equal(r.estado.aviso, 'linkInvalido');
  assert.deepEqual(doAppNos(r.efeitos), []);
  // A queda não é um fim: é o fora do estado.
  r = rodar(e, ligacao('principal', 'terminou'), tempo('fimSemAviso'));
  assert.equal(r.estado.aviso, 'saiu');
  assert.deepEqual(doAppNos(efeitosDe(e, ligacao('principal', 'terminou'), tempo('fimSemAviso')).efeitos), []);
  // Fora do app, nenhum fim.
  assert.deepEqual(doAppNos(passo(naReuniao(), clique('sair')).efeitos), []);
  assert.deepEqual(doAppNos(passo(naReuniao(), mensagem({ tipo: 'tirado' })).efeitos), []);
});

test('o sair do app', () => {
  // Na reunião, o mesmo que o clique Sair, com o fim.
  const e = noAppNaReuniao();
  const r = passo(e, SAIR_DO_APP);
  assert.deepEqual(r, passo(e, clique('sair')));
  assert.equal(r.estado.aviso, 'saiu');
  assert.deepEqual(doAppNos(r.efeitos), [fim('saiu')]);
  // Entrando, também.
  assert.deepEqual(passo(noAppEntrando(), SAIR_DO_APP), passo(noAppEntrando(), clique('sair')));
  // Antes de entrar: a página fica, e o fim responde.
  for (const antes of [noAppNaEntrada(), passo(inicial(), COMECAR_NO_APP).estado]) {
    assert.deepEqual(passo(antes, SAIR_DO_APP), { estado: antes, efeitos: [fim('saiu')] });
  }
  // Na espera (quem é de fora, depois da faixa): o Desistir de hoje, e o fim.
  const esperando = rodar(
    inicial(),
    COMECAR_NO_APP,
    tempo('passe:1'),
    abriu(1),
    midia('ligado', 'ligado'),
    NOME,
    clique('pedir'),
    abriu(2),
    CANAL_ABRIU,
  ).estado;
  const s = passo(esperando, SAIR_DO_APP);
  const desistiu = passo(esperando, clique('desistir'));
  assert.deepEqual(s.estado, desistiu.estado);
  assert.deepEqual(
    s.efeitos.filter((x) => x.tipo !== 'avisarApp'),
    desistiu.efeitos,
  );
  assert.deepEqual(doAppNos(s.efeitos), [fim('saiu')]);
});

test('os aparelhos trocados no meio', () => {
  const OUTROS = { microfone: 'Headset Bluetooth', altoFalante: 'Headset Bluetooth', camera: 'Câmera do notebook' };
  const trocar = doApp({ tipo: 'aparelhos', aparelhos: OUTROS });
  const e = noAppNaReuniao();
  // Na reunião: a troca do microfone e a da câmera de hoje, com os nomes novos.
  let r = passo(e, trocar);
  assert.deepEqual(r.estado.aparelhos, OUTROS);
  assert.equal(r.estado.trocandoCamera, true);
  assert.deepEqual(r.efeitos, [
    { tipo: 'trocarMicrofone', ligado: true, nome: 'Headset Bluetooth' },
    { tipo: 'trocarCamera', ligada: true, nome: 'Câmera do notebook' },
  ]);
  r = passo(r.estado, { tipo: 'cameraTrocada', ok: true });
  assert.equal(r.estado.cam, 'ligado');
  assert.equal(r.estado.trocandoCamera, false);
  // O microfone desligado continua desligado; a câmera desligada só guarda o nome (o ligar dela usa o novo).
  r = rodar(e, clique('microfone'), clique('camera'), { tipo: 'cameraTrocada', ok: true }, trocar);
  assert.deepEqual(r.efeitos, [{ tipo: 'trocarMicrofone', ligado: false, nome: 'Headset Bluetooth' }]);
  assert.deepEqual(r.estado.aparelhos, OUTROS);
  // Só o alto-falante: nenhum efeito do cérebro (o desenho o acerta).
  r = passo(e, doApp({ tipo: 'aparelhos', aparelhos: { ...APARELHOS, altoFalante: 'Caixa de som' } }));
  assert.deepEqual(r.efeitos, []);
  assert.equal(r.estado.aparelhos.altoFalante, 'Caixa de som');
  // Os mesmos nomes não mudam nada.
  semMudar(e, doApp({ tipo: 'aparelhos', aparelhos: APARELHOS }));
  // Na entrada, a câmera e o microfone são pedidos de novo, com os nomes novos.
  r = passo(noAppNaEntrada(), trocar);
  assert.equal(r.estado.esperandoMidia, true);
  assert.deepEqual(r.efeitos, [PEDIR_MIDIA]);
});

test('um campo que não vale', () => {
  const esperando = passo(inicial(), COMECAR_NO_APP).estado;
  // O passe que não é um texto de 43 caracteres base64url.
  for (const passe of ['p'.repeat(42), 'p'.repeat(44), `${'p'.repeat(42)}=`, `${'p'.repeat(42)}+`, 43, null, [PASSE]]) {
    semMudar(esperando, doApp({ tipo: 'passe', passe, aparelhos: APARELHOS }));
  }
  semMudar(esperando, doApp({ tipo: 'passe', aparelhos: APARELHOS }));
  const e = noAppNaReuniao();
  // Os aparelhos que não são um objeto, ou com um nome que não vale, leem como os padrões do sistema, que não são os
  // nomes em uso: uma troca de verdade, com o microfone e a câmera ligados trocados para o padrão.
  const padroes = { microfone: '', altoFalante: '', camera: '' };
  const ruins = [undefined, null, 'Microfone USB', ['Microfone USB'], 7, { microfone: 7 }, { camera: 'x'.repeat(201) }];
  for (const aparelhos of ruins) {
    const r = passo(e, doApp({ tipo: 'aparelhos', aparelhos }));
    assert.deepEqual(r.estado.aparelhos, padroes, JSON.stringify(aparelhos));
    assert.deepEqual(
      r.efeitos,
      [{ tipo: 'trocarMicrofone', ligado: true, nome: '' }, { tipo: 'trocarCamera', ligada: true, nome: '' }],
      JSON.stringify(aparelhos),
    );
    assert.equal(r.estado.trocandoCamera, true);
  }
  // Sem o m, ou um tipo que o cérebro não conhece.
  semMudar(e, { tipo: 'app' });
  semMudar(e, doApp({ tipo: 'abrir' }));
});

test('um nome de aparelho que não serve é o padrão do sistema, e o passe vale', () => {
  const esperando = rodar(inicial(), COMECAR_NO_APP).estado;
  const ruins = [undefined, null, 'texto', 7, [], { microfone: 7, altoFalante: 'x'.repeat(201), camera: 'Câmera HD' }];
  for (const aparelhos of ruins) {
    const r = passo(esperando, doApp({ tipo: 'passe', passe: PASSE, aparelhos }));
    assert.deepEqual(r.efeitos, [abrirCom(1, { passe: PASSE })], JSON.stringify(aparelhos));
  }
  const r = passo(esperando, doApp({ tipo: 'passe', passe: PASSE, aparelhos: ruins.at(-1) }));
  assert.deepEqual(r.estado.aparelhos, { microfone: '', altoFalante: '', camera: 'Câmera HD' });
  // O passe continua recusado pelo que é dele: a forma.
  semMudar(esperando, doApp({ tipo: 'passe', passe: 'curto', aparelhos: {} }));
});

test('a troca de aparelhos com um nome que não serve usa o padrão para ele', () => {
  const r = passo(noAppNaEntrada(), doApp({ tipo: 'aparelhos', aparelhos: { ...APARELHOS, microfone: 7 } }));
  assert.deepEqual(r.estado.aparelhos, { ...APARELHOS, microfone: '' });
  assert.deepEqual(r.efeitos, [PEDIR_MIDIA]);
});

test('dentro do app não há escolha', () => {
  // Também no Windows (o WebView2 do app diz que é o Windows): a entrada, pelo passe que faltou ou que não valeu.
  for (const comecar of [COMECAR_NO_APP, { ...COMECAR_NO_APP, windows: true }]) {
    let r = rodar(inicial(), comecar, tempo('passe:1'), abriu(1));
    assert.equal(r.estado.tela, 'entrada');
    r = rodar(inicial(), comecar, passeDoApp(), passeRecusado(1), passeDoApp(PASSE_2), passeRecusado(2), abriu(3));
    assert.equal(r.estado.tela, 'entrada');
    assert.equal(r.estado.semColega, true);
    r = rodar(inicial(), comecar, passeDoApp(), abriuColega(1, COLEGA));
    assert.equal(r.estado.tela, 'entrada');
  }
});

test('fora do app, nada do app vale', () => {
  const mensagens = [
    { tipo: 'passe', passe: PASSE, aparelhos: APARELHOS },
    { tipo: 'aparelhos', aparelhos: APARELHOS },
    { tipo: 'sair' },
    { tipo: 'pausar' },
    { tipo: 'retomar' },
    { tipo: 'bloqueio', ligado: true },
  ];
  const estados = [inicial(), passo(inicial(), COMECAR).estado, naEntrada(), naReuniao(), colegaNaReuniao()];
  for (const e of estados) {
    for (const m of mensagens) semMudar(e, doApp(m));
    semMudar(e, tempo('passe:1'));
  }
});

test('a faixa do colega não reconhecido é dita', () => {
  // No navegador: o passe que não valeu leva à entrada de quem é de fora, e a faixa é dita quando aparece.
  let r = rodar(inicial(), COMECAR_COM_PASSE, passeRecusado(1));
  assert.ok(!r.efeitos.some((x) => x.tipo === 'dizer'));
  r = passo(r.estado, abriu(2));
  assert.deepEqual(r.efeitos, [PEDIR_MIDIA, FOCAR, dizer(FAIXA)]);
  // Uma vez: o Desistir que volta à entrada não a diz de novo.
  r = rodar(r.estado, midia('ligado', 'ligado'), NOME, clique('pedir'), abriu(3), CANAL_ABRIU, clique('desistir'));
  assert.equal(r.estado.tela, 'entrada');
  assert.ok(!r.efeitos.some((x) => x.tipo === 'dizer'));
  // A chave que deixou de valer no Entrar.
  r = rodar(colegaNaEntrada(), clique('entrar'), passeRecusado(2));
  assert.deepEqual(r.efeitos, [FOCAR, dizer(FAIXA)]);
  // No Windows, na escolha; e a entrada depois dela não a diz de novo.
  r = rodar(inicial(), { ...COMECAR_NO_WINDOWS, passe: PASSE }, passeRecusado(1), abriu(2));
  assert.deepEqual(r.efeitos, [FOCAR, dizer(FAIXA)]);
  assert.deepEqual(passo(r.estado, clique('peloNavegador')).efeitos, [PEDIR_MIDIA, FOCAR]);
});

test('o sair do app com o passe pedido de novo', () => {
  // A chave do colega não valeu no Entrar, e a página pediu outro passe ao app: o sair do app, nessa hora, acaba a
  // espera do passe, e o prazo dela, depois, não leva à entrada de quem é de fora.
  const pedindo = rodar(noAppNaEntrada(), clique('entrar'), passeRecusado(2)).estado;
  assert.equal(pedindo.esperandoPasse, true);
  const r = passo(pedindo, SAIR_DO_APP);
  assert.equal(r.estado.aviso, 'saiu');
  assert.equal(r.estado.esperandoPasse, false);
  semMudar(r.estado, tempo('passe:2'));
});

// ---- A pausa (as seções 7.8 e 7.9 da spec) ----

const PAUSAR = doApp({ tipo: 'pausar' });
const RETOMAR = doApp({ tipo: 'retomar' });
const bloqueio = (ligado) => doApp({ tipo: 'bloqueio', ligado });
const pausa = (pausada, vez = 'v1') => mensagem({ tipo: 'pausa', pausada, vez });
const calar = (calado) => ({ tipo: 'calar', calado });
const trocarMicrofone = (ligado) => ({ tipo: 'trocarMicrofone', ligado });
const trocarCamera = (ligada) => ({ tipo: 'trocarCamera', ligada });
const CAMERA_TROCADA = { tipo: 'cameraTrocada', ok: true };
const FRASE_DA_PAUSA = 'Você está numa ligação no Starsonic Phone. A reunião não ouve nem vê você.';

// A tela compartilhada no ar, na reunião.
const compartilhando = (e) =>
  rodar(
    e,
    { tipo: 'telaCapturada', ok: true },
    mensagem({ tipo: 'tela', senha: 'senha-da-tela' }),
    ligacao('tela', 'confirmada'),
  ).estado;
// A página aceita, com a ligação principal subindo: no app e no navegador.
const noAppAceito = () => passo(noAppEntrando(), mensagem(ACEITO_COM_CHAVE)).estado;
const colegaAceito = () => passo(colegaEntrando(), mensagem(ACEITO_COM_CHAVE)).estado;

test('a pausa desliga tudo', () => {
  const e = compartilhando(noAppNaReuniao());
  assert.equal(e.telaCompartilhada, 'noAr');
  let r = passo(e, PAUSAR);
  // Os caminhos de hoje do Microfone, da Câmera e do Parar de compartilhar; o aviso da câmera; e o som calado.
  assert.deepEqual(r.efeitos, [
    trocarMicrofone(false),
    trocarCamera(false),
    { tipo: 'desligar', qual: 'tela' },
    camera(false),
    calar(true),
  ]);
  assert.equal(r.estado.mic, 'desligado');
  assert.equal(r.estado.cam, 'desligado');
  assert.deepEqual(r.estado.pausa, { origem: 'app', vez: null, mic: 'ligado', cam: 'ligado' });
  assert.equal(r.estado.tela, 'reuniao');
  // O app sabe que os outros não ouvem a pessoa.
  assert.deepEqual(paraOApp(r.estado), { fase: 'naReuniao', microfone: false });
  // A ligação da tela desce, e a captura para.
  r = passo(r.estado, ligacao('tela', 'terminou'));
  assert.equal(r.estado.telaCompartilhada, 'nenhuma');
  assert.deepEqual(r.efeitos, [PARAR_CAPTURA]);
  // O pedido da tela que esperava a senha para já.
  r = rodar(noAppNaReuniao(), { tipo: 'telaCapturada', ok: true }, PAUSAR);
  assert.equal(r.estado.telaCompartilhada, 'nenhuma');
  assert.ok(r.efeitos.some((x) => x.tipo === 'pararCaptura'));

  // A câmera que ainda estava ligando (o clique de antes da pausa): ela apaga assim que a troca responder.
  const ligando = rodar(noAppNaReuniao(), clique('camera'), CAMERA_TROCADA, clique('camera')).estado;
  assert.equal(ligando.trocandoCamera, true);
  r = passo(ligando, PAUSAR);
  assert.equal(r.estado.cam, 'desligado');
  assert.deepEqual(r.estado.pausa.cam, 'ligado');
  assert.deepEqual(r.efeitos, [trocarMicrofone(false), camera(false), calar(true)]);
  r = passo(r.estado, CAMERA_TROCADA);
  assert.deepEqual(r.efeitos, [trocarCamera(false)]);
  assert.equal(r.estado.trocandoCamera, true);
  r = passo(r.estado, CAMERA_TROCADA);
  assert.deepEqual(r.efeitos, []);
  assert.equal(r.estado.trocandoCamera, false);
  assert.equal(r.estado.cam, 'desligado');
  // A troca que não deu certo na pausa não acende a câmera.
  r = rodar(noAppNaReuniao(), PAUSAR, { tipo: 'cameraTrocada', ok: false });
  assert.equal(r.estado.cam, 'desligado');
  assert.equal(r.estado.trocandoCamera, false);

  // Com a conexão caída, só o estado muda: o ligar da volta lê o fluxo.
  const caiu = passo(noAppNaReuniao(), SEM_CONEXAO).estado;
  r = passo(caiu, PAUSAR);
  assert.deepEqual(r.efeitos, [camera(false), calar(true)]);
  assert.equal(r.estado.mic, 'desligado');
  assert.equal(r.estado.cam, 'desligado');
  // Com a ligação da volta subindo, o microfone vai à ligação também (o mute dela); a câmera, ao fluxo.
  const subindo = rodar(caiu, tempo('reconectar:1'), mensagem({ tipo: 'senha', senha: 'senha-2' })).estado;
  assert.equal(subindo.principal, 'ligando');
  assert.deepEqual(passo(subindo, PAUSAR).efeitos, [trocarMicrofone(false), camera(false), calar(true)]);
});

test('a volta devolve o que era', () => {
  // O microfone desligado e a câmera ligada antes da pausa.
  const e = rodar(noAppNaReuniao(), clique('microfone'), PAUSAR, CAMERA_TROCADA).estado;
  assert.deepEqual(e.pausa, { origem: 'app', vez: null, mic: 'desligado', cam: 'ligado' });
  const r = passo(e, RETOMAR);
  assert.equal(r.estado.mic, 'desligado');
  assert.equal(r.estado.cam, 'ligado');
  assert.equal(r.estado.pausa, null);
  assert.deepEqual(r.efeitos, [trocarCamera(true), camera(true), calar(false)]);
  // O contrário: o microfone ligado e a câmera desligada.
  const outro = rodar(noAppNaReuniao(), clique('camera'), CAMERA_TROCADA, PAUSAR, RETOMAR);
  assert.equal(outro.estado.mic, 'ligado');
  assert.equal(outro.estado.cam, 'desligado');
  assert.deepEqual(outro.efeitos, [trocarMicrofone(true), calar(false)]);
  assert.deepEqual(paraOApp(outro.estado), { fase: 'naReuniao', microfone: true });
  // A câmera que ainda estava apagando quando a pausa acabou acende assim que a troca responder.
  let v = rodar(noAppNaReuniao(), PAUSAR, RETOMAR);
  assert.deepEqual(v.efeitos, [trocarMicrofone(true), camera(true), calar(false)]);
  assert.equal(v.estado.cam, 'ligado');
  v = passo(v.estado, CAMERA_TROCADA);
  assert.deepEqual(v.efeitos, [trocarCamera(true)]);
  v = passo(v.estado, CAMERA_TROCADA);
  assert.deepEqual(v.efeitos, []);
  assert.equal(v.estado.trocandoCamera, false);
  // O aparelho que saiu durante a pausa continua faltando.
  const semMic = rodar(noAppNaReuniao(), PAUSAR, CAMERA_TROCADA, midia('indisponivel', 'ligado'), RETOMAR);
  assert.equal(semMic.estado.mic, 'indisponivel');
  assert.equal(semMic.estado.cam, 'ligado');
});

test('a tela compartilhada não volta', () => {
  const r = rodar(compartilhando(noAppNaReuniao()), PAUSAR, ligacao('tela', 'terminou'), CAMERA_TROCADA, RETOMAR);
  assert.equal(r.estado.telaCompartilhada, 'nenhuma');
  assert.ok(!r.efeitos.some((x) => x.tipo === 'ligar' || (x.tipo === 'mandar' && x.m.tipo === 'tela')));
});

test('a pausa pelo canal', () => {
  const e = colegaNaReuniao();
  let r = passo(e, pausa(true, 'v1'));
  assert.deepEqual(r.estado.pausa, { origem: 'canal', vez: 'v1', mic: 'ligado', cam: 'ligado' });
  assert.equal(r.estado.mic, 'desligado');
  assert.equal(r.estado.cam, 'desligado');
  // O cartão aparece, e o leitor de tela ouve a frase dele.
  assert.deepEqual(r.efeitos, [
    trocarMicrofone(false),
    trocarCamera(false),
    camera(false),
    calar(true),
    dizer(FRASE_DA_PAUSA),
  ]);
  r = rodar(r.estado, CAMERA_TROCADA, pausa(false, 'v1'));
  assert.equal(r.estado.pausa, null);
  assert.equal(r.estado.mic, 'ligado');
  assert.equal(r.estado.cam, 'ligado');
  assert.deepEqual(r.efeitos, [trocarMicrofone(true), trocarCamera(true), camera(true), calar(false)]);
  // A mensagem que não vale: o pausada que não é um sim ou não, e o vez que não é de 1 a 32 letras ou números.
  for (const m of [
    { tipo: 'pausa', pausada: 'sim', vez: 'v1' },
    { tipo: 'pausa', vez: 'v1' },
    { tipo: 'pausa', pausada: true },
    { tipo: 'pausa', pausada: true, vez: '' },
    { tipo: 'pausa', pausada: true, vez: 'v'.repeat(33) },
    { tipo: 'pausa', pausada: true, vez: 'v-1' },
    { tipo: 'pausa', pausada: true, vez: 7 },
  ]) {
    semMudar(e, mensagem(m));
  }
  assert.equal(passo(e, pausa(true, 'V'.repeat(32))).estado.pausa.vez, 'V'.repeat(32));
});

test('o Voltar para a reunião', () => {
  const e = passo(colegaNaReuniao(), pausa(true, 'v1')).estado;
  let r = rodar(e, CAMERA_TROCADA, clique('voltarDaPausa'));
  assert.equal(r.estado.pausa, null);
  assert.deepEqual(r.estado.vezesDesfeitas, ['v1']);
  assert.equal(r.estado.mic, 'ligado');
  assert.equal(r.estado.cam, 'ligado');
  assert.deepEqual(r.efeitos, [trocarMicrofone(true), trocarCamera(true), camera(true), calar(false)]);
  // A repetição da mesma vez não pausa de novo; outra vez pausa.
  const voltou = r.estado;
  semMudar(voltou, pausa(true, 'v1'));
  r = passo(voltou, pausa(true, 'v2'));
  assert.deepEqual(r.estado.pausa, { origem: 'canal', vez: 'v2', mic: 'ligado', cam: 'ligado' });
  // A página lembra as últimas 8 vezes desfeitas.
  let f = rodar(voltou, CAMERA_TROCADA).estado;
  for (let i = 2; i <= 9; i++) {
    f = rodar(f, pausa(true, `v${i}`), CAMERA_TROCADA, clique('voltarDaPausa'), CAMERA_TROCADA).estado;
  }
  assert.deepEqual(f.vezesDesfeitas, ['v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9']);
  assert.equal(passo(f, pausa(true, 'v1')).estado.pausa?.vez, 'v1');
  semMudar(f, pausa(true, 'v9'));
  // Sem pausa, ou com a pausa do app (que não tem o cartão), o clique não muda nada.
  semMudar(colegaNaReuniao(), clique('voltarDaPausa'));
  semMudar(passo(noAppNaReuniao(), PAUSAR).estado, clique('voltarDaPausa'));
});

test('pausa em cima de pausa', () => {
  // O segundo pausar não muda nada: a volta devolve o de antes do primeiro.
  const e = rodar(noAppNaReuniao(), clique('microfone'), PAUSAR, CAMERA_TROCADA).estado;
  semMudar(e, PAUSAR);
  let r = passo(e, RETOMAR);
  assert.equal(r.estado.mic, 'desligado');
  assert.equal(r.estado.cam, 'ligado');
  // A repetição do pausa, a cada 10 s, não muda nada; uma ligação nova (outra vez) só troca a vez.
  const c = rodar(colegaNaReuniao(), clique('camera'), CAMERA_TROCADA, pausa(true, 'v1')).estado;
  semMudar(c, pausa(true, 'v1'));
  r = passo(c, pausa(true, 'v2'));
  assert.deepEqual(r.efeitos, []);
  assert.deepEqual(r.estado.pausa, { origem: 'canal', vez: 'v2', mic: 'ligado', cam: 'desligado' });
  r = passo(r.estado, clique('voltarDaPausa'));
  assert.deepEqual(r.estado.vezesDesfeitas, ['v2']);
  assert.equal(r.estado.mic, 'ligado');
  assert.equal(r.estado.cam, 'desligado');
});

test('o retomar sem pausa', () => {
  semMudar(noAppNaReuniao(), RETOMAR);
  semMudar(colegaNaReuniao(), pausa(false, 'v1'));
  // A volta da pausa já desfeita também não muda nada.
  const voltou = rodar(colegaNaReuniao(), pausa(true, 'v1'), CAMERA_TROCADA, clique('voltarDaPausa'), CAMERA_TROCADA);
  semMudar(voltou.estado, pausa(false, 'v1'));
});

test('a pausa com a página entrando', () => {
  // No app: o pausar vale na hora (o microfone vai à ligação subindo, e o som cala), e fica guardado.
  const e = noAppAceito();
  assert.equal(e.tela, 'entrando');
  let r = passo(e, PAUSAR);
  assert.deepEqual(r.efeitos, [trocarMicrofone(false), camera(false), calar(true)]);
  assert.deepEqual(r.estado.pausaPendente, { origem: 'app', vez: null, mic: 'ligado', cam: 'ligado' });
  assert.equal(r.estado.pausa, null);
  assert.equal(r.estado.mic, 'desligado');
  assert.equal(r.estado.cam, 'desligado');
  // A página entra com tudo desligado e o som já calado; a câmera que subiu com a ligação é desligada nela.
  r = passo(r.estado, ligacao('principal', 'confirmada'));
  assert.equal(r.estado.tela, 'reuniao');
  assert.equal(r.estado.pausaPendente, null);
  assert.deepEqual(r.estado.pausa, { origem: 'app', vez: null, mic: 'ligado', cam: 'ligado' });
  assert.equal(r.estado.mic, 'desligado');
  assert.equal(r.estado.cam, 'desligado');
  assert.deepEqual(r.efeitos, [trocarCamera(false), FOCAR]);
  // O retomar antes disso a apaga: a página entra como entraria.
  assert.deepEqual(
    rodar(e, PAUSAR, RETOMAR, ligacao('principal', 'confirmada')),
    passo(e, ligacao('principal', 'confirmada')),
  );
  // No navegador, o pausa do canal: vale na hora e fica guardado, e o cartão aparece quando a página entra.
  r = passo(colegaAceito(), pausa(true, 'v1'));
  assert.deepEqual(r.efeitos, [trocarMicrofone(false), camera(false), calar(true)]);
  assert.deepEqual(r.estado.pausaPendente, { origem: 'canal', vez: 'v1', mic: 'ligado', cam: 'ligado' });
  semMudar(r.estado, pausa(true, 'v1'));
  r = passo(r.estado, ligacao('principal', 'confirmada'));
  assert.deepEqual(r.estado.pausa, { origem: 'canal', vez: 'v1', mic: 'ligado', cam: 'ligado' });
  assert.deepEqual(r.efeitos, [trocarCamera(false), FOCAR, dizer(FRASE_DA_PAUSA)]);
  // O pausada falso antes disso também a apaga; a repetição com outra vez fica com a vez nova.
  const c = colegaAceito();
  assert.deepEqual(
    rodar(c, pausa(true, 'v1'), pausa(false, 'v1'), ligacao('principal', 'confirmada')),
    passo(c, ligacao('principal', 'confirmada')),
  );
  const outraVez = rodar(c, pausa(true, 'v1'), pausa(true, 'v2')).estado;
  assert.deepEqual(outraVez.pausaPendente, { origem: 'canal', vez: 'v2', mic: 'ligado', cam: 'ligado' });
  // A pausa guardada some com a saída: o som volta, e o microfone e a câmera ficam como ela os deixou.
  r = rodar(e, PAUSAR, clique('sair'));
  assert.equal(r.estado.pausaPendente, null);
  assert.deepEqual(r.efeitos.filter((x) => x.tipo === 'calar'), [calar(false)]);
  assert.equal(r.estado.mic, 'desligado');
  assert.equal(r.estado.cam, 'desligado');
});

test('a pausa que chega com a página entrando cala e desliga na hora', () => {
  let r = passo(noAppAceito(), PAUSAR);
  assert.deepEqual(r.efeitos, [trocarMicrofone(false), camera(false), calar(true)]);
  assert.equal(r.estado.mic, 'desligado');
  assert.equal(r.estado.cam, 'desligado');
  assert.deepEqual(r.estado.pausaPendente, { origem: 'app', vez: null, mic: 'ligado', cam: 'ligado' });
  // Ao entrar, a pausa vale com o que era antes dela, e a câmera que subiu com a ligação é desligada nela.
  r = passo(r.estado, ligacao('principal', 'confirmada'));
  assert.deepEqual(r.estado.pausa, { origem: 'app', vez: null, mic: 'ligado', cam: 'ligado' });
  assert.equal(r.estado.pausaPendente, null);
  assert.deepEqual(r.efeitos.filter((x) => x.tipo === 'trocarCamera'), [trocarCamera(false)]);
  assert.equal(r.estado.trocandoCamera, true);
  assert.deepEqual(r.efeitos.filter((x) => x.tipo === 'calar'), []); // já estava calado
  // O retomar devolve os dois.
  r = rodar(r.estado, CAMERA_TROCADA, RETOMAR);
  assert.equal(r.estado.mic, 'ligado');
  assert.equal(r.estado.cam, 'ligado');
});

test('o retomar antes de entrar devolve o que a pausa guardada desligou', () => {
  const r = rodar(noAppAceito(), PAUSAR, RETOMAR);
  assert.equal(r.estado.pausaPendente, null);
  assert.equal(r.estado.mic, 'ligado');
  assert.equal(r.estado.cam, 'ligado');
  assert.deepEqual(r.efeitos, [trocarMicrofone(true), camera(true), calar(false)]);
  // A ligação subiu com a câmera, e o estado a quer ligada: nada a acertar ao entrar.
  const dentro = passo(r.estado, ligacao('principal', 'confirmada'));
  assert.deepEqual(dentro.efeitos.filter((x) => x.tipo === 'trocarCamera'), []);
});

test('o bloqueio que chega com a página entrando desliga a câmera, e ela volta ao desbloquear', () => {
  let r = passo(noAppAceito(), bloqueio(true));
  assert.equal(r.estado.cam, 'desligado');
  assert.deepEqual(r.estado.bloqueio, { cam: 'ligado' });
  r = passo(r.estado, ligacao('principal', 'confirmada'));
  assert.deepEqual(r.efeitos.filter((x) => x.tipo === 'trocarCamera'), [trocarCamera(false)]);
  r = rodar(r.estado, CAMERA_TROCADA, bloqueio(false));
  assert.equal(r.estado.cam, 'ligado');
  assert.deepEqual(r.efeitos.filter((x) => x.tipo === 'trocarCamera'), [trocarCamera(true)]);
});

test('a câmera que mudou com a ligação da volta subindo é acertada quando ela entra', () => {
  // Na volta depois da conexão caída, em pausa: a ligação sobe sem a câmera, e o retomar chega com ela subindo.
  const queda = [
    ligacao('principal', 'semConexao'),
    tempo('reconectar:1'),
    mensagem({ tipo: 'senha', senha: 'senha-r1' }),
  ];
  const subindo = rodar(noAppNaReuniao(), PAUSAR, CAMERA_TROCADA, ...queda);
  assert.deepEqual(subindo.efeitos, [ligar('principal', 'senha-r1')]);
  let r = passo(subindo.estado, RETOMAR);
  assert.equal(r.estado.cam, 'ligado');
  r = passo(r.estado, ligacao('principal', 'confirmada'));
  assert.deepEqual(r.efeitos.filter((x) => x.tipo === 'trocarCamera'), [trocarCamera(true)]);
  assert.equal(r.estado.trocandoCamera, true);
});

test('dentro do app, a pausa do canal não vale', () => {
  semMudar(noAppNaReuniao(), pausa(true, 'v1'));
  semMudar(noAppAceito(), pausa(true, 'v1'));
  // A pausa do app continua só dele.
  const e = passo(noAppNaReuniao(), PAUSAR).estado;
  semMudar(e, pausa(false, 'v1'));
  semMudar(e, pausa(true, 'v1'));
});

test('os botões na pausa', () => {
  for (const e of [passo(noAppNaReuniao(), PAUSAR).estado, passo(colegaNaReuniao(), pausa(true, 'v1')).estado]) {
    const f = passo(e, CAMERA_TROCADA).estado;
    semMudar(f, clique('microfone'));
    semMudar(f, clique('camera'));
    // A captura da tela que chega na pausa para, e nada vai ao canal.
    assert.deepEqual(passo(f, { tipo: 'telaCapturada', ok: true }), { estado: f, efeitos: [PARAR_CAPTURA] });
  }
});

test('fora da reunião, a pausa não faz nada', () => {
  // Na entrada, e antes dela.
  for (const e of [noAppNaEntrada(), passo(inicial(), COMECAR_NO_APP).estado]) {
    for (const m of [PAUSAR, RETOMAR, bloqueio(true), bloqueio(false)]) semMudar(e, m);
  }
  semMudar(colegaNaEntrada(), pausa(true, 'v1'));
  // Nos avisos, também com o canal ainda aberto (o do saiu, para o Entrar de novo).
  const avisos = [
    passo(noAppNaReuniao(), clique('sair')).estado,
    passo(noAppNaReuniao(), mensagem({ tipo: 'tirado' })).estado,
    passo(noAppAceito(), ligacao('principal', 'falhou', 500)).estado,
  ];
  for (const e of avisos) {
    assert.equal(e.tela, 'aviso');
    for (const m of [PAUSAR, RETOMAR, bloqueio(true), bloqueio(false)]) semMudar(e, m);
  }
  const saiu = passo(colegaNaReuniao(), clique('sair')).estado;
  assert.equal(saiu.canal, 'aberto');
  semMudar(saiu, pausa(true, 'v1'));
  semMudar(saiu, clique('voltarDaPausa'));
});

test('a pausa não segura a saída', () => {
  const e = passo(noAppNaReuniao(), PAUSAR).estado;
  for (const evento of [mensagem({ tipo: 'tirado' }), mensagem({ tipo: 'encerrada' }), clique('sair'), SAIR_DO_APP]) {
    const r = passo(e, evento);
    assert.equal(r.estado.tela, 'aviso', JSON.stringify(evento));
    assert.equal(r.estado.pausa, null);
    // O som da reunião volta a valer para a próxima entrada.
    assert.ok(r.efeitos.some((x) => x.tipo === 'calar' && x.calado === false));
    // O resto é o de hoje.
    const semPausa = passo(noAppNaReuniao(), evento);
    assert.equal(r.estado.aviso, semPausa.estado.aviso);
    assert.deepEqual(
      r.efeitos.filter((x) => x.tipo !== 'calar'),
      semPausa.efeitos,
    );
  }
  // A queda que não volta, também; e o cartão do canal some com a saída.
  let r = rodar(e, ligacao('principal', 'terminou'), tempo('fimSemAviso'));
  assert.equal(r.estado.aviso, 'saiu');
  assert.equal(r.estado.pausa, null);
  r = rodar(colegaNaReuniao(), pausa(true, 'v1'), clique('sair'));
  assert.equal(r.estado.pausa, null);
  // O Entrar de novo não traz a pausa de volta.
  r = passo(r.estado, clique('entrarDeNovo'));
  assert.equal(r.estado.pausa, null);
  assert.ok(!r.efeitos.some((x) => x.tipo === 'calar'));
});

test('o bloqueio', () => {
  const e = noAppNaReuniao();
  // Ligado, só a câmera desliga; desligado, ela volta.
  let r = passo(e, bloqueio(true));
  assert.deepEqual(r.efeitos, [trocarCamera(false), camera(false)]);
  assert.equal(r.estado.cam, 'desligado');
  assert.equal(r.estado.mic, 'ligado');
  assert.deepEqual(r.estado.bloqueio, { cam: 'ligado' });
  assert.equal(r.estado.pausa, null);
  r = rodar(r.estado, CAMERA_TROCADA, bloqueio(false));
  assert.deepEqual(r.efeitos, [trocarCamera(true), camera(true)]);
  assert.equal(r.estado.cam, 'ligado');
  assert.equal(r.estado.bloqueio, null);
  // A câmera desligada antes continua desligada; o bloqueio repetido não muda nada.
  const semCam = rodar(e, clique('camera'), CAMERA_TROCADA).estado;
  r = passo(semCam, bloqueio(true));
  assert.deepEqual(r.efeitos, []);
  semMudar(r.estado, bloqueio(true));
  r = passo(r.estado, bloqueio(false));
  assert.equal(r.estado.cam, 'desligado');
  assert.deepEqual(r.efeitos, []);
  semMudar(e, bloqueio(false));
  // O bloqueio sem o ligado não muda nada.
  for (const ligado of [undefined, 'sim', 1, null]) semMudar(e, doApp({ tipo: 'bloqueio', ligado }));
  semMudar(e, doApp({ tipo: 'bloqueio' }));

  // Junto com a pausa: a volta de um não desfaz o outro. O bloqueio primeiro.
  let f = seguir(e, [
    [bloqueio(true), [trocarCamera(false), camera(false)]],
    [CAMERA_TROCADA, []],
    [PAUSAR, [trocarMicrofone(false), calar(true)]],
    [RETOMAR, [trocarMicrofone(true), calar(false)]],
  ]);
  assert.equal(f.cam, 'desligado');
  f = seguir(f, [[bloqueio(false), [trocarCamera(true), camera(true)]]]);
  assert.equal(f.cam, 'ligado');
  // A pausa primeiro.
  f = seguir(e, [
    [PAUSAR, [trocarMicrofone(false), trocarCamera(false), camera(false), calar(true)]],
    [CAMERA_TROCADA, []],
    [bloqueio(true), []],
    [bloqueio(false), []],
  ]);
  assert.equal(f.cam, 'desligado');
  assert.equal(f.bloqueio, null);
  f = seguir(f, [
    [bloqueio(true), []],
    [RETOMAR, [trocarMicrofone(true), calar(false)]],
  ]);
  assert.equal(f.cam, 'desligado');
  assert.equal(f.mic, 'ligado');
  f = seguir(f, [[bloqueio(false), [trocarCamera(true), camera(true)]]]);
  assert.equal(f.cam, 'ligado');
  // No bloqueio, a Câmera não muda nada; o Microfone, sim.
  const bloqueada = rodar(e, bloqueio(true), CAMERA_TROCADA).estado;
  semMudar(bloqueada, clique('camera'));
  assert.deepEqual(passo(bloqueada, clique('microfone')).efeitos, [trocarMicrofone(false)]);
  // O bloqueio some com a saída.
  assert.equal(passo(bloqueada, clique('sair')).estado.bloqueio, null);
});

test('quem é de fora', () => {
  semMudar(naReuniao(), pausa(true, 'v1'));
  semMudar(naReuniao(), pausa(false, 'v1'));
  semMudar(naReuniao(), clique('voltarDaPausa'));
});
