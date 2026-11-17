// Os testes do cérebro da página da reunião (estado.js): a máquina de estados pura, sem DOM, sem rede e sem relógio.
// Cada teste parte do estado de que precisa, alcançado pelos próprios eventos, e confere o estado e os efeitos.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONTAGEM_MS,
  FIM_SEM_AVISO_MS,
  MAX_REABRIR,
  MAX_RECONECTAR,
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

// Os efeitos.
const ABRIR = { tipo: 'abrir' };
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
const ligar = (qual, senha) => ({ tipo: 'ligar', qual, senha });
const PEDIR = mandar({ tipo: 'pedir', nome: 'Maria Lima' });
const SENHA = mandar({ tipo: 'senha' });

// Os eventos.
const COMECAR = { tipo: 'comecar' };
const CANAL_ABRIU = { tipo: 'canalAbriu' };
const abriu = (bilhete) => ({ tipo: 'abriu', reuniao: REUNIAO, bilhete });
const canalFechou = (codigo) => ({ tipo: 'canalFechou', codigo });
const clique = (botao) => ({ tipo: 'clique', botao });
const mensagem = (m) => ({ tipo: 'mensagem', m });
const midia = (mic, cam) => ({ tipo: 'midia', mic, cam });
const ligacao = (qual, o, codigo = 0) => ({ tipo: 'ligacao', qual, o, codigo });
const tempo = (chave) => ({ tipo: 'tempo', chave });

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

// Os estados de partida, alcançados pelos eventos.
const naEntrada = (mic = 'ligado', cam = 'ligado') =>
  rodar(inicial(), COMECAR, abriu('bilhete-1'), midia(mic, cam), { tipo: 'nome', valor: '  Maria Lima  ' }).estado;
const pedindo = () => rodar(naEntrada(), clique('pedir'), abriu('bilhete-2'), CANAL_ABRIU).estado;
const aguardando = () => rodar(pedindo(), mensagem({ tipo: 'aguardando' })).estado;
const entrando = () => rodar(aguardando(), mensagem(ACEITO)).estado;
const naReuniao = () => rodar(entrando(), ligacao('principal', 'confirmada')).estado;
const saiu = () => rodar(naReuniao(), clique('sair')).estado;

// Nada muda: o mesmo estado, sem efeitos.
const semMudar = (estado, evento) => assert.deepEqual(passo(estado, evento), { estado, efeitos: [] });

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
  });
  const r = passo(inicial(), COMECAR);
  assert.equal(r.estado.tela, 'carregando');
  assert.deepEqual(r.efeitos, [ABRIR]);
});

test('o abriu vai à entrada e pede a mídia', () => {
  const r = rodar(inicial(), COMECAR, abriu('bilhete-1'));
  assert.equal(r.estado.tela, 'entrada');
  assert.deepEqual(r.estado.reuniao, REUNIAO);
  assert.deepEqual(r.efeitos, [PEDIR_MIDIA, FOCAR]);
  // O bilhete do carregar não serve para o canal (ele vale 30 segundos), e não fica no estado.
  assert.ok(!JSON.stringify(r.estado).includes('bilhete-1'));
});

test('o 404 do abrir é o linkInvalido', () => {
  let r = rodar(inicial(), COMECAR, { tipo: 'abrirFalhou', status: 404 });
  assert.equal(r.estado.tela, 'aviso');
  assert.equal(r.estado.aviso, 'linkInvalido');
  assert.deepEqual(r.efeitos, [FOCAR]);
  // No abrir do pedido, a mídia já foi pedida: ela para.
  r = rodar(naEntrada(), clique('pedir'), { tipo: 'abrirFalhou', status: 404 });
  assert.equal(r.estado.aviso, 'linkInvalido');
  assert.deepEqual(r.efeitos, [PARAR_MIDIA, FOCAR]);
});

test('o 429 conta e libera', () => {
  assert.equal(CONTAGEM_MS, 1000);
  let r = rodar(inicial(), COMECAR, { tipo: 'abrirFalhou', status: 429, esperarSegundos: 3 });
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
  assert.deepEqual(r.efeitos, [ABRIR, FOCAR]);
});

test('a rede que falha no abrir é o semServidor', () => {
  for (const status of [0, 500]) {
    const r = rodar(inicial(), COMECAR, { tipo: 'abrirFalhou', status });
    assert.equal(r.estado.aviso, 'semServidor');
    assert.deepEqual(r.efeitos, [FOCAR]);
  }
  // O Tentar de novo do carregar volta a carregar, e o abriu vai à entrada.
  let r = rodar(inicial(), COMECAR, { tipo: 'abrirFalhou', status: 0 }, clique('tentarDeNovo'));
  assert.equal(r.estado.tela, 'carregando');
  assert.deepEqual(r.efeitos, [ABRIR, FOCAR]);
  r = passo(r.estado, abriu('bilhete-1'));
  assert.equal(r.estado.tela, 'entrada');
  assert.deepEqual(r.efeitos, [PEDIR_MIDIA, FOCAR]);
});

test('pedir abre de novo, abre o canal e manda o nome', () => {
  let r = passo(naEntrada(), clique('pedir'));
  assert.equal(r.estado.tela, 'pedindo');
  assert.deepEqual(r.efeitos, [ABRIR, FOCAR]);
  r = passo(r.estado, abriu('bilhete-2'));
  assert.equal(r.estado.canal, 'abrindo');
  assert.deepEqual(r.efeitos, [{ tipo: 'abrirCanal', bilhete: 'bilhete-2' }]);
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
    assert.deepEqual(r.efeitos, [ligar('principal', 'senha-1'), FOCAR]);
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
  let r = rodar(naEntrada(), clique('pedir'), { tipo: 'abrirFalhou', status: 0 });
  assert.equal(r.estado.aviso, 'semServidor');
  assert.equal(r.estado.canal, 'fechado');
  r = passo(r.estado, clique('tentarDeNovo'));
  assert.equal(r.estado.tela, 'pedindo');
  assert.deepEqual(r.efeitos, [ABRIR, FOCAR]);
  r = rodar(r.estado, abriu('bilhete-3'), CANAL_ABRIU);
  assert.deepEqual(r.efeitos, [PEDIR]);
});

test('desistir manda e volta à entrada', () => {
  const antes = rodar(naEntrada(), clique('camera'), clique('pedir'), abriu('bilhete-2'), CANAL_ABRIU).estado;
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
  assert.deepEqual(r.efeitos, [PEDIR_MIDIA, ABRIR, FOCAR]);
  r = rodar(r.estado, abriu('bilhete-3'), CANAL_ABRIU);
  assert.deepEqual(r.efeitos, [PEDIR]);
  // Na reunião de teste, o aceito pode chegar antes da mídia: o ligar espera por ela.
  r = passo(r.estado, mensagem({ ...ACEITO, senha: 'senha-4' }));
  assert.equal(r.estado.tela, 'entrando');
  assert.deepEqual(r.efeitos, [FOCAR]);
  r = passo(r.estado, midia('ligado', 'ligado'));
  assert.deepEqual(r.efeitos, [ligar('principal', 'senha-4')]);
});

test('a conexão que cai entra de novo até 3 vezes', () => {
  assert.deepEqual(RECONECTAR_MS, [2000, 4000, 8000]);
  assert.ok(Object.isFrozen(RECONECTAR_MS));
  assert.equal(MAX_RECONECTAR, 3);
  // Uma tentativa: o prazo, o senha, e o ligar com a senha nova.
  const tentar = (estado, senha) => {
    let s = passo(estado, tempo('reconectar'));
    assert.deepEqual(s.efeitos, [SENHA]);
    s = passo(s.estado, mensagem({ tipo: 'senha', senha }));
    assert.deepEqual(s.efeitos, [ligar('principal', senha)]);
    return s.estado;
  };
  let r = passo(naReuniao(), ligacao('principal', 'semConexao'));
  assert.equal(r.estado.tela, 'reuniao');
  assert.equal(r.estado.reconectando, 1);
  assert.deepEqual(r.efeitos, [...DESLIGAR_AS_DUAS, esperar(2000, 'reconectar')]);
  // O fim da ligação que a página desligou não conta como falha.
  semMudar(r.estado, ligacao('principal', 'terminou'));
  r = passo(tentar(r.estado, 'senha-r1'), ligacao('principal', 'falhou', 0));
  assert.equal(r.estado.reconectando, 2);
  assert.deepEqual(r.efeitos, [esperar(4000, 'reconectar')]);
  r = passo(tentar(r.estado, 'senha-r2'), ligacao('principal', 'falhou', 0));
  assert.equal(r.estado.reconectando, 3);
  assert.deepEqual(r.efeitos, [esperar(8000, 'reconectar')]);
  r = passo(tentar(r.estado, 'senha-r3'), ligacao('principal', 'falhou', 0));
  assert.equal(r.estado.tela, 'aviso');
  assert.equal(r.estado.aviso, 'saiu');
  assert.equal(r.estado.reconectando, 0);
  assert.deepEqual(r.efeitos, [...DESLIGAR_AS_DUAS, PARAR_MIDIA, FOCAR]);
  // Um confirmada no meio zera a conta: a próxima queda espera 2 segundos de novo.
  r = passo(naReuniao(), ligacao('principal', 'semConexao'));
  r = passo(tentar(r.estado, 'senha-r4'), ligacao('principal', 'confirmada'));
  assert.equal(r.estado.tela, 'reuniao');
  assert.equal(r.estado.reconectando, 0);
  assert.deepEqual(r.efeitos, []);
  r = passo(r.estado, ligacao('principal', 'semConexao'));
  assert.equal(r.estado.reconectando, 1);
  assert.deepEqual(r.efeitos, [...DESLIGAR_AS_DUAS, esperar(2000, 'reconectar')]);
});

test('o canal que cai durante a volta', () => {
  // As três fases da volta: o prazo antes da tentativa, a espera da senha e o ligar.
  const noPrazo = () => passo(naReuniao(), ligacao('principal', 'semConexao')).estado;
  const naSenha = () => passo(noPrazo(), tempo('reconectar')).estado;
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
  r = passo({ ...noPrazo(), canal: 'fechado' }, tempo('reconectar'));
  assert.equal(r.estado.aviso, 'saiu');
  assert.deepEqual(r.efeitos, SAIU);
});

test('na volta, as recusas do senha são tentativas que falharam', () => {
  for (const tipo of ['semServidor', 'cheia', 'servidorCheio', 'esperaCheia']) {
    let r = rodar(naReuniao(), ligacao('principal', 'semConexao'), tempo('reconectar'), mensagem({ tipo }));
    assert.equal(r.estado.tela, 'reuniao', tipo);
    assert.equal(r.estado.reconectando, 2);
    assert.deepEqual(r.efeitos, [esperar(4000, 'reconectar')]);
    r = rodar(r.estado, tempo('reconectar'), mensagem({ tipo }));
    assert.equal(r.estado.reconectando, 3);
    assert.deepEqual(r.efeitos, [esperar(8000, 'reconectar')]);
    r = rodar(r.estado, tempo('reconectar'), mensagem({ tipo }));
    assert.equal(r.estado.aviso, 'saiu');
    assert.deepEqual(r.efeitos, [...DESLIGAR_AS_DUAS, PARAR_MIDIA, FOCAR]);
  }
});

test('o semConexao no meio do ligar desliga a principal', () => {
  const DESLIGAR_A_PRINCIPAL = { tipo: 'desligar', qual: 'principal' };
  // Ao entrar: a ligação que perdeu a conexão desce, e é o semServidor.
  let r = passo(entrando(), ligacao('principal', 'semConexao'));
  assert.equal(r.estado.aviso, 'semServidor');
  assert.deepEqual(r.efeitos, [DESLIGAR_A_PRINCIPAL, FOCAR]);
  // Na volta, com o canal aberto: ela desce, e vem a próxima tentativa.
  const SENHA_R1 = mensagem({ tipo: 'senha', senha: 'senha-r1' });
  r = rodar(naReuniao(), ligacao('principal', 'semConexao'), tempo('reconectar'), SENHA_R1);
  r = passo(r.estado, ligacao('principal', 'semConexao'));
  assert.equal(r.estado.reconectando, 2);
  assert.deepEqual(r.efeitos, [DESLIGAR_A_PRINCIPAL, esperar(4000, 'reconectar')]);
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
  for (let vez = 1; vez <= 3; vez++) {
    let r = passo(e, canalFechou(1011));
    assert.equal(r.estado.tela, 'aguardando');
    assert.equal(r.estado.canal, 'fechado');
    assert.equal(r.estado.reabrindo, vez);
    assert.deepEqual(r.efeitos, [esperar(3000, 'reabrir')]);
    r = passo(r.estado, tempo('reabrir'));
    assert.deepEqual(r.efeitos, [ABRIR]);
    r = rodar(r.estado, abriu(`bilhete-r${vez}`), CANAL_ABRIU);
    assert.deepEqual(r.efeitos, [PEDIR]);
    e = passo(r.estado, mensagem({ tipo: 'aguardando' })).estado;
  }
  const r = passo(e, canalFechou(1011));
  assert.equal(r.estado.tela, 'aviso');
  assert.equal(r.estado.aviso, 'semServidor');
  assert.deepEqual(r.efeitos, [FOCAR]);
});

test('o canal que cai na reunião não tira ninguém', () => {
  let r = passo(naReuniao(), canalFechou(1006));
  assert.equal(r.estado.tela, 'reuniao');
  assert.equal(r.estado.canal, 'fechado');
  assert.deepEqual(r.efeitos, []);
  // Sem o canal, não há senha para voltar.
  r = passo(r.estado, ligacao('principal', 'semConexao'));
  assert.equal(r.estado.tela, 'aviso');
  assert.equal(r.estado.aviso, 'saiu');
  assert.deepEqual(r.efeitos, [...DESLIGAR_AS_DUAS, PARAR_MIDIA, FOCAR]);
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
  assert.deepEqual(r.efeitos, [{ tipo: 'trocarCamera', ligada: false }]);
  r = rodar(r.estado, { tipo: 'cameraTrocada', ok: true }, clique('camera'));
  assert.equal(r.estado.cam, 'ligado');
  assert.deepEqual(r.efeitos, [{ tipo: 'trocarCamera', ligada: true }]);
  // A câmera que não ligou volta ao que era.
  r = passo(r.estado, { tipo: 'cameraTrocada', ok: false });
  assert.equal(r.estado.cam, 'desligado');
  assert.deepEqual(r.efeitos, []);
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
  const caiu = passo(pendente, ligacao('principal', 'semConexao')).estado;
  assert.equal(caiu.cam, 'desligado');
  semMudar(caiu, { tipo: 'cameraTrocada', ok: false });
  semMudar(naEntrada(), { tipo: 'cameraTrocada', ok: false });
});

test('a mídia que chega guarda a escolha da pessoa', () => {
  // A câmera desligada antes da resposta do navegador continua desligada.
  let r = rodar(inicial(), COMECAR, abriu('bilhete-1'), clique('camera'), midia('ligado', 'ligado'));
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
    passo(semCanal, { tipo: 'abrirFalhou', status: 404 }).estado, // o 404 do abrir, com o canal fechado
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
  const r = rodar(semCanal, { tipo: 'abrirFalhou', status: 0 }, midia('ligado', 'ligado'));
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
  r = rodar(naEntrada(), clique('pedir'), abriu('bilhete-2'), canalFechou(1006));
  assert.equal(r.estado.aviso, 'semServidor');
  assert.deepEqual(passo(r.estado, clique('tentarDeNovo')).efeitos, [ABRIR, FOCAR]);
});

test('os erros do canal', () => {
  // O erro que responde ao senha da volta (o limite de 5 por minuto) é uma tentativa que falhou.
  const limite = mensagem({ tipo: 'erro', erro: 'limite' });
  let r = rodar(naReuniao(), ligacao('principal', 'semConexao'), tempo('reconectar'), limite);
  assert.equal(r.estado.reconectando, 2);
  assert.deepEqual(r.efeitos, [esperar(4000, 'reconectar')]);
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
  semMudar(rodar(naEntrada(), clique('pedir'), clique('desistir')).estado, abriu('bilhete-2'));
  // O prazo do 1011 depois do desistir.
  semMudar(rodar(aguardando(), canalFechou(1011), clique('desistir')).estado, tempo('reabrir'));
  // O prazo da volta depois do Sair.
  semMudar(rodar(naReuniao(), ligacao('principal', 'semConexao'), clique('sair')).estado, tempo('reconectar'));
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
