// Os testes do cérebro da página da reunião (estado.js): a máquina de estados pura, sem DOM, sem rede e sem relógio.
// Cada teste parte do estado de que precisa, alcançado pelos próprios eventos, e confere o estado e os efeitos.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONTAGEM_MS,
  FIM_SEM_AVISO_MS,
  MAX_REABRIR,
  MAX_RECONECTAR,
  PRAZO_VOLTA_MS,
  REABRIR_MS,
  RECONECTAR_MS,
  cabecalho,
  inicial,
  nomeValido,
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
    palco: null,
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
  // Três religares sem resposta: a reunião segue sem o canal, e o abriu que chega depois fica de fora.
  const desistiu = seguir(r.estado, [
    [tempo('religar:2'), [abrir(4), prazo(2)]],
    [tempo('prazo:2'), [esperar(8000, 'religar:3')]],
    [tempo('religar:3'), [abrir(5), prazo(3)]],
    [tempo('prazo:3'), []],
  ]);
  assert.equal(desistiu.tela, 'reuniao');
  assert.equal(desistiu.principal, 'noAr');
  semMudar(desistiu, abriu(5));
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

test('o religar do canal desiste depois de três', () => {
  // A ligação segue no ar o tempo todo, e a tela não mostra nada.
  const segueNaReuniao = (estado) => {
    assert.equal(estado.tela, 'reuniao');
    assert.equal(estado.aviso, null);
    assert.equal(estado.principal, 'noAr');
    assert.equal(estado.reconectando, 0);
  };
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
      // A terceira falha: o canal que já mandou o voltar fecha, e a reunião segue sem ele.
      [LIMITE, [FECHAR_CANAL]],
    ],
    segueNaReuniao,
  );
  assert.equal(desistiu.canal, 'fechado');
  semMudar(desistiu, tempo('prazo:3'));
  assert.deepEqual(passo(desistiu, { tipo: 'telaCapturada', ok: true }).efeitos, [PARAR_CAPTURA]);
  // Uma falha no meio com o canal do voltar aberto também o fecha, e a próxima tentativa espera mais.
  const voltando = [canalFechou(1006), tempo('religar:1'), abriu(3), CANAL_ABRIU];
  const r = rodar(naReuniaoComChave(), ...voltando, LIMITE);
  segueNaReuniao(r.estado);
  assert.equal(r.estado.canal, 'fechado');
  assert.deepEqual(r.efeitos, [FECHAR_CANAL, esperar(4000, 'religar:2')]);
  // A queda da ligação, depois, é a volta das duas: a chave ainda vale.
  seguir(desistiu, [
    [SEM_CONEXAO, [...DESLIGAR_AS_DUAS, esperar(2000, 'reconectar:4')]],
    [tempo('reconectar:4'), [abrir(6), prazo(4)]],
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
  const desistencias = {
    'o voltar respondido com o erro invalido': passo(voltando, RECUSADA),
    'o linkInvalido do voltar': passo(voltando, LINK_INVALIDO),
    'o 404 do abrir do voltar': passo(noReligar, abrirFalhou(3, 404)),
    'a terceira tentativa que falha': passo(naTerceira, tempo('prazo:3')),
    'o canal que fecha sem a chave': passo(semChave, canalFechou(1006)),
  };
  for (const [caso, r] of Object.entries(desistencias)) {
    assert.equal(r.estado.tela, 'reuniao', caso);
    assert.equal(r.estado.aviso, null, caso);
    assert.equal(r.estado.principal, 'noAr', caso);
    assert.equal(r.estado.canal, 'fechado', caso);
    assert.equal(r.estado.religando, 0, caso);
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
