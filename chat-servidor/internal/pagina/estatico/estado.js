// O cérebro da página da reunião: uma máquina de estados pura. A transicao(estado, evento) devolve o estado novo e os
// efeitos, sem tocar no DOM, na rede ou no relógio; o pagina.js roda os efeitos e devolve os resultados como eventos.
// Ela nunca muda o estado que recebe: cada passo devolve um objeto novo.
//
// O que o cérebro espera de quem roda os efeitos (o pagina.js, o rede.js, o midia.js e o ligacao.js):
// - depois do fecharCanal, nenhum evento daquele canal, nem o canalFechou;
// - os eventos de uma ligação depois do desligar dela chegam antes do próximo ligar;
// - o falhou e o terminou dizem que a ligação acabou; o semConexao, que ela ainda existe e desce com o desligar;
// - o midia diz ligado ou indisponivel de cada aparelho;
// - o ligar não leva o mic nem a cam: quem roda o efeito os lê do estado (a câmera desligada é o vídeo sem faixa);
// - todo abrir tem resposta, o abriu ou o abrirFalhou, também o abrir que sai na reunião para voltar com a chave, e a
//   resposta devolve a abertura que o abrir levou. Quem decide a tela é o cérebro: o abriu do voltar (na volta depois
//   da conexão caída, ou no religar) só abre o canal, e nunca leva à entrada nem pede a mídia;
// - o rede.js responde a todo abrir, e abre ou fecha todo canal, num tempo limitado. Nas tentativas da volta e do
//   religar, o prazo delas (PRAZO_VOLTA_MS) é a guarda do cérebro, se ele não responder;
// - o tempo devolve a chave do esperar como ela veio (a da volta e a do religar levam a vez, como "reconectar:3");
// - o Compartilhar a tela só vale com o canal aberto: o canal abrindo e o voltando contam como fechados;
// - nem o estado nem os efeitos vão ao console. O estado leva o acesso do aceito (com as credenciais do TURN), a chave
//   de volta, o palco (com os nomes) e, por um instante, a senha que chegou antes da mídia; os efeitos levam o bilhete,
//   as senhas e a chave.
//
// A chave de volta (seção 10 do protocolo): o aceito traz o participante e a volta, e o cérebro os guarda. Na reunião,
// com o canal fechado (o religar, com a ligação no ar; uma tentativa da volta depois da conexão caída; o confirmada de
// uma ligação que perdeu o canal no caminho), a página abre outro, e a primeira mensagem dele é o
// {tipo:'voltar', participante, volta}. Fora da reunião (no entrando, ou depois do saiu), ela nunca volta assim: o
// Entrar de novo sem o canal passa pela espera. Até a resposta, o canal está voltando, e ainda não é o da pessoa. O
// servidor responde {tipo:'voltou', volta}, com a chave nova, e o canal é de novo o da pessoa; ou responde
// {tipo:'erro', erro:'invalido'} (a chave não vale mais) ou {tipo:'linkInvalido'} (a reunião deixou de valer), e fecha
// o canal. Quem já está numa reunião que deixou de valer continua nela: com a ligação no ar, o linkInvalido (e o 404 do
// abrir) só param o religar.
//
// O palco e o aviso da câmera (seção 10 do protocolo). O servidor diz à pessoa aceita onde cada um está no mosaico (a
// mensagem palco), e o cérebro guarda o último palco que vale, para os quadros. Ele só entra depois do aceito, pelo
// canal aberto, e sai no aceito, em todo aviso, com um palco que não vale (que prova que ele ficou velho) e quando a
// página desiste do canal: o canal que fecha sem a chave, e o religar que para (a chave recusada, o linkInvalido ou o
// 404 do abrir do voltar, a terceira tentativa que falha). Ele fica enquanto a página tenta voltar (a conexão caída e o
// religar, que voltam para a mesma reunião). Um palco que chega com um aviso na tela (o canal continua aberto) fica
// guardado de novo, de propósito: ele nunca é desenhado fora da reunião, e o próximo aceito o tira. A página diz ao
// servidor se a câmera dela está ligada (o {tipo:'camera', ligada}), para o quadro de quem está sem ela: o aviso sai
// sempre que o canal passa a ser o da pessoa (o aceito, o voltou) e a cada mudança do ligado, e nunca antes do aceito
// nem com o canal voltando (o servidor responderia o erro invalido). Ele não espera resposta.
//
// O chat da reunião (seção 10 do protocolo). As mensagens vivem só aqui, enquanto a página está na reunião: a lista
// (as últimas 500), as não lidas, o painel aberto ou fechado e o aviso curto da mensagem nova. A pessoa escreve (o
// evento escrever), e a mensagem entra na lista já, indo: o {tipo:'mensagem', id, texto} sai pelo canal, e a resposta
// é a própria mensagem de volta, com o id (ou a recusa, o mensagemRecusada). Sem resposta em PRAZO_DA_MENSAGEM_MS, ela
// fica "Não enviada", e o Tentar de novo (o evento reenviar) a manda como uma mensagem nova, no fim da lista. O id é o
// "m" mais o número da mensagem, que nunca volta a zero: o mesmo canal pode servir a duas entradas. A hora de cada
// mensagem é a do evento que a trouxe (o agora, que a tela põe em todo evento): o cérebro não tem relógio.
// A regra da tela da reunião fica num lugar só, no fim da transicao: fora da reunião (e da entrada nela, com a ligação
// subindo), o chat é o vazio, por qualquer fim (a pessoa saiu, foi tirada, a reunião acabou, a página desistiu de
// voltar); e o aviso curto só existe na tela da reunião. Enquanto a página tenta voltar (a conexão caída, o religar
// do canal), nada disso muda. O texto e o nome das mensagens não vão ao console, como o resto do estado.
//
// O sinalizador de qualidade (qualidade.js). O medidor da tela mede a ligação principal a cada 2 s e dá ao cérebro o
// estado mostrado (medindo, boa, instavel ou ruim) e os dois números da última medida (o evento qualidade), que o
// cérebro guarda para o botão e para o cartão. A virada para ruim mostra o aviso curto da conexão, no máximo um a cada
// AVISO_DA_CONEXAO_MS, e nunca com o cartão aberto (a pessoa já está olhando os detalhes, e o aviso não é gasto). O
// aviso curto é um só: o da mensagem toma o lugar do da conexão, e o contrário. A mesma regra da tela da reunião vale
// aqui: fora dela, o cartão fecha; sem a ligação principal no ar (fora da reunião, na conexão caída, ou nos instantes
// depois de a ligação terminar), o sinalizador volta ao começo, e as medidas que ainda chegarem ficam de fora; e o
// aviso da conexão ruim só fica enquanto o sinalizador diz ruim.
//
// O colega (o colega.js). A página que recebe um passe (o comecar com o passe) o leva no primeiro abrir, e a resposta
// que reconhece o colega dá o nome dele, até quando o link vale e a chave do colega, que toma o lugar do passe: o
// Entrar (e o Tentar de novo, o Entrar de novo e o 1011) abre de novo com ela, e o canal manda o entrar, em vez do
// pedir, sem a espera. O voltar depois de uma queda é o de hoje, sem corpo. O passe ou a chave que não vale (o 401
// passe) leva à entrada de quem é de fora, e a página nunca tenta de novo como colega. Na reunião, o colega recebe a
// lista inteira (quem está nela e quem espera) a cada mudança, e responde pelo canal: aceitar, recusar, tirar e
// encerrar. O que deu certo não tem resposta: a lista nova (ou o encerrada) diz, e o leitor de tela ouve o resultado
// (o efeito dizer). A lista, o painel e as perguntas seguem a regra da tela da reunião, como o chat. Quem é de fora
// nunca tem nada disso. A chave do colega e o passe não vão ao console, como a chave de volta.

import { LISTA_VAZIA, ditoDaResposta, lerLista, tituloDoCartao } from './colega.js';
import { MAX_MENSAGENS, textoLimpo } from './mensagens.js';
import { lerPalco } from './palco.js';

/** O passo da contagem do 429 ("Tentar de novo em <n> s"), em ms. */
export const CONTAGEM_MS = 1000;
/**
 * A espera antes de cada tentativa de voltar à reunião depois da conexão caída, em ms. O religar do canal que caiu na
 * reunião espera o mesmo.
 */
export const RECONECTAR_MS = Object.freeze([2000, 4000, 8000]);
/** A espera por um tirado ou um encerrada depois de a ligação terminar sem aviso, antes do saiu, em ms. */
export const FIM_SEM_AVISO_MS = 2000;
/** A espera antes de abrir de novo depois do 1011 do canal, em ms. */
export const REABRIR_MS = 3000;
/** As tentativas de voltar depois da conexão caída: 3, uma por espera. O religar também tenta 3 vezes. */
export const MAX_RECONECTAR = RECONECTAR_MS.length;
/**
 * O prazo de cada tentativa da volta e do religar, em ms: do começo dela até a resposta do servidor (o senha, na volta,
 * e o voltou, no religar). Sem ela, a tentativa falhou.
 */
export const PRAZO_VOLTA_MS = 10000;
/** As aberturas de novo depois de um 1011, antes do aceito. */
export const MAX_REABRIR = 3;
/** A espera pela resposta de uma mensagem do chat da reunião, em ms: sem ela, a mensagem fica "Não enviada". */
export const PRAZO_DA_MENSAGEM_MS = 10000;
/** O tempo do aviso curto na tela (o da mensagem nova e o da conexão ruim), em ms. */
export const AVISO_CURTO_MS = 5000;
/** O tempo mínimo entre dois avisos de conexão ruim, em ms: no máximo um a cada 2 minutos. */
export const AVISO_DA_CONEXAO_MS = 120000;

const MAX_NOME = 80;

// As telas da espera: o pedido saiu, e a página espera a resposta.
const ESPERA = new Set(['pedindo', 'aguardando', 'naoComecou']);
// Os avisos com o "Tentar de novo".
const DE_NOVO = new Set(['cheia', 'esperaCheia', 'servidorCheio', 'semServidor', 'tentativas']);

const FECHAR_CANAL = Object.freeze({ tipo: 'fecharCanal' });
const PEDIR_MIDIA = Object.freeze({ tipo: 'pedirMidia' });
const PARAR_MIDIA = Object.freeze({ tipo: 'pararMidia' });
const PARAR_CAPTURA = Object.freeze({ tipo: 'pararCaptura' });
const FOCAR = Object.freeze({ tipo: 'focar' });
const FOCAR_O_CAMPO = Object.freeze({ tipo: 'focarOCampo' }); // o campo de escrever do chat
const FOCAR_O_CHAT = Object.freeze({ tipo: 'focarOChat' }); // o botão Chat dos controles
const FOCAR_O_SINAL = Object.freeze({ tipo: 'focarOSinal' }); // o botão do sinalizador de qualidade
const mandar = (m) => ({ tipo: 'mandar', m });
const ligar = (qual, senha) => ({ tipo: 'ligar', qual, senha });
const desligar = (qual) => ({ tipo: 'desligar', qual });
const esperar = (ms, chave) => ({ tipo: 'esperar', ms, chave });
const abrirCanal = (bilhete) => ({ tipo: 'abrirCanal', bilhete });
const pedido = (e) => mandar({ tipo: 'pedir', nome: e.nome.trim() });
// O colega não pede: ele entra.
const ENTRAR = mandar({ tipo: 'entrar' });
const pedidoOuEntrar = (e) => (e.colega !== null ? ENTRAR : pedido(e));
const focar = (alvo) => ({ tipo: 'focar', alvo }); // os alvos do colega: participantes, cartao e encerrar
const dizer = (texto) => ({ tipo: 'dizer', texto }); // o que o leitor de tela ouve

// O chat da reunião sem nada: a lista, as não lidas, o painel fechado e o número da última mensagem.
const CHAT_VAZIO = Object.freeze({ mensagens: Object.freeze([]), naoLidas: 0, aberto: false, seq: 0 });
// O sinalizador no começo: medindo, sem número nenhum.
const QUALIDADE_DO_COMECO = Object.freeze({ estado: 'medindo', perda: null, atraso: null });
// Os estados que o sinalizador mostra.
const ESTADOS_DA_QUALIDADE = new Set(['medindo', 'boa', 'instavel', 'ruim']);
const numero = (v) => typeof v === 'number' && Number.isFinite(v);

// com: o estado com as mudanças, e os efeitos. so: os efeitos, com o mesmo estado.
const com = (estado, mudancas, ...efeitos) => ({ estado: { ...estado, ...mudancas }, efeitos });
const so = (estado, ...efeitos) => ({ estado, efeitos });
const nada = (estado) => so(estado);

// comAbrir: o com, e o abrir no fim. O abrir leva o número dele, a abertura, que o abriu e o abrirFalhou devolvem: a
// resposta de um abrir que passou fica de fora. O corpo é o do estado novo (o corpoDoAbrir).
function comAbrir(e, mudancas, ...efeitos) {
  return abrirCom(e, corpoDoAbrir({ ...e, ...mudancas }), mudancas, ...efeitos);
}

// abrirCom: o comAbrir com o corpo dado. O abrir sem corpo (null) é o de quem é de fora, letra por letra.
function abrirCom(e, corpo, mudancas, ...efeitos) {
  const abertura = e.abertura + 1;
  const abrir = corpo === null ? { tipo: 'abrir', abertura } : { tipo: 'abrir', abertura, corpo };
  return com(e, { ...mudancas, abertura }, ...efeitos, abrir);
}

// O corpo do abrir que leva à reunião: o colega reconhecido abre com a chave; antes de o passe ter resposta, com o
// passe; quem é de fora, sem corpo. O abrir do voltar nunca leva corpo: a chave de volta é que diz quem é a pessoa.
function corpoDoAbrir(e) {
  if (e.colega !== null) return { colega: e.chaveDoColega };
  if (e.passe !== null) return { passe: e.passe };
  return null;
}

// A chave de uma espera da volta e do religar leva a vez dela, como "reconectar:3": a de uma vez que passou fica de
// fora.
const daVez = (nome, vez) => `${nome}:${vez}`;
// esperaNova: a espera antes da próxima tentativa, numa vez nova. Devolve a vez e o efeito.
const esperaNova = (e, nome, ms) => ({ vez: e.vez + 1, espera: esperar(ms, daVez(nome, e.vez + 1)) });
// O prazo da tentativa, na vez dela.
const prazoDaVez = (vez) => esperar(PRAZO_VOLTA_MS, daVez('prazo', vez));

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
    canal: 'fechado', // fechado, abrindo, voltando (o voltar saiu, e o voltou não chegou) ou aberto
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
    trocandoCamera: false, // o trocarCamera da reunião saiu, e o cameraTrocada ainda não chegou
    chave: null, // a chave de volta do último aceito ou voltou, {participante, volta}: nunca num texto
    religando: 0, // a tentativa de religar o canal que caiu na reunião com a ligação no ar, de 0 a 3
    esperandoBilhete: false, // o abrir do voltar saiu, e o abriu ainda não chegou
    vez: 0, // a vez das esperas e dos prazos da volta e do religar: cada espera nova ganha a sua
    abertura: 0, // o número do último abrir
    palco: null, // o último palco que vale, depois do aceito: {largura, altura, quadros}
    // O chat da reunião: as mensagens ({n, voce, nome, texto, hora, situacao, id, motivo}), as não lidas, o painel
    // aberto e o seq, o número da última mensagem, que nunca volta a zero.
    chat: CHAT_VAZIO,
    // O aviso curto na tela: {n, tipo: 'mensagem', nome, texto}, {n, tipo: 'conexao'} ou, na página do colega, o do
    // servidor de vídeo que não respondeu a uma resposta dela, {n, tipo: 'servidor'}.
    avisoCurto: null,
    avisos: 0, // o número do último aviso curto: o tempo de um aviso que passou fica de fora
    // O sinalizador de qualidade: o estado mostrado (medindo, boa, instavel ou ruim) e os números da última medida, a
    // perda (uma fração) e o atraso (em ms), ou null para o que o navegador não deu.
    qualidade: QUALIDADE_DO_COMECO,
    cartao: false, // o cartão do sinalizador, aberto
    conexaoAvisada: false, // o aviso de conexão ruim já saiu nos últimos 2 minutos
    // O colega: quem o passe reconheceu ({nome, valeAte}, com o valeAte em ms ou null), a chave do colega que o abrir
    // deu em troca do passe (nunca num texto), o passe que ainda não teve resposta, e se o passe (ou a chave) não
    // valeu e a página seguiu como quem é de fora.
    colega: null,
    chaveDoColega: null,
    passe: null,
    semColega: false,
    // Na reunião, só para o colega: a lista ({participantes, pedidos}), o painel Participantes aberto, o id de quem
    // tem a pergunta "Tirar <Nome>?" à vista, a pergunta do Encerrar para todos à vista, a reunião cheia no último
    // aceitar, e as respostas da página que esperam a lista nova ({de, id, nome}), para o leitor de tela.
    lista: LISTA_VAZIA,
    gente: false,
    tirando: null,
    encerrando: false,
    cheiaAoAceitar: false,
    respondendo: Object.freeze([]),
  };
}

/** Um passo: devolve {estado, efeitos}, sem mudar o estado recebido. */
export function transicao(estado, evento) {
  let r;
  switch (evento.tipo) {
    case 'comecar':
      // O passe que a página recebeu, se houver: o primeiro abrir o leva.
      r =
        estado.tela === 'carregando'
          ? comAbrir(estado, { passe: typeof evento.passe === 'string' && evento.passe !== '' ? evento.passe : null })
          : nada(estado);
      break;
    case 'abriu':
      r = evento.abertura === estado.abertura ? abriu(estado, evento) : nada(estado);
      break;
    case 'abrirFalhou':
      r = evento.abertura === estado.abertura ? abrirFalhou(estado, evento) : nada(estado);
      break;
    case 'canalAbriu':
      r = estado.canal === 'abrindo' ? canalAbriu(estado) : nada(estado);
      break;
    case 'canalFechou':
      r = canalFechou(estado, evento.codigo);
      break;
    case 'mensagem':
      if (estado.canal === 'aberto') r = mensagem(estado, evento.m ?? {}, evento.agora);
      else if (estado.canal === 'voltando') r = respostaDoVoltar(estado, evento.m ?? {});
      else r = nada(estado);
      break;
    case 'clique':
      r = clique(estado, evento.botao, evento.id);
      break;
    case 'nome':
      r = estado.tela === 'entrada' ? com(estado, { nome: evento.valor, nomeRecusado: false }) : nada(estado);
      break;
    case 'midia':
      r = midia(estado, evento);
      break;
    case 'ligacao':
      if (evento.qual === 'principal') r = ligacaoPrincipal(estado, evento.o, evento.codigo);
      else if (evento.qual === 'tela') r = ligacaoDaTela(estado, evento.o);
      else r = nada(estado); // só há a principal e a tela
      break;
    case 'telaCapturada':
      r = telaCapturada(estado, evento.ok);
      break;
    case 'cameraTrocada':
      r = cameraTrocada(estado, evento.ok);
      break;
    case 'tempo':
      r = tempo(estado, evento.chave);
      break;
    case 'escrever':
      r = escrever(estado, evento.texto, evento.agora);
      break;
    case 'reenviar':
      r = reenviar(estado, evento.n, evento.agora);
      break;
    case 'qualidade':
      r = qualidade(estado, evento);
      break;
    default:
      r = nada(estado);
  }
  // O chat, o aviso curto e o sinalizador são da tela da reunião: a regra fica só aqui, para todo fim, também os que
  // vierem depois.
  r.estado = soNaReuniao(r.estado);
  // O aviso da câmera nasce só aqui, do estado de antes e do de depois: nenhum outro ponto do cérebro o monta.
  if (avisaACamera(estado, r.estado)) r.efeitos.push(mandar({ tipo: 'camera', ligada: cameraLigada(r.estado) }));
  // A tela nova, ou o aviso novo, leva o foco ao título dela.
  if (r.estado.tela !== estado.tela || r.estado.aviso !== estado.aviso) r.efeitos.push(FOCAR);
  return r;
}

// O canal é o da pessoa: o aceito chegou nele, ou o voltou. Só ele leva o aviso da câmera.
const canalDaPessoa = (e) => e.aceito && e.canal === 'aberto';
// Para o servidor, a câmera desligada e a que falta são iguais: sem imagem. Antes de a mídia chegar, vale a escolha da
// pessoa (a ligada do começo), e o midia que chega depois acerta o aviso.
const cameraLigada = (e) => e.cam === 'ligado';
// O aviso sai quando o canal passa a ser o da pessoa, ou quando o ligado muda com ele aberto.
const avisaACamera = (antes, depois) =>
  canalDaPessoa(depois) && (!canalDaPessoa(antes) || cameraLigada(antes) !== cameraLigada(depois));

// A página está na reunião, ou entrando nela (aceita, com a ligação subindo): é quando o servidor lhe manda o chat.
const naReuniaoOuEntrando = (e) => e.aceito && (e.tela === 'reuniao' || e.tela === 'entrando');

/** A página pode escrever no chat da reunião: a tela da reunião, com o canal da pessoa aberto. */
export function podeEscrever(estado) {
  return estado.tela === 'reuniao' && canalDaPessoa(estado);
}

// A ligação principal está no ar, na tela da reunião: é quando o sinalizador mede.
const medindoALigacao = (e) => e.tela === 'reuniao' && e.principal === 'noAr';

// Fora da reunião, o chat volta ao vazio (com o seq de antes: os ids não se repetem) e o painel fecha; fora da tela
// da reunião, não há aviso curto, e o cartão do sinalizador fecha. Sem a ligação principal no ar, o sinalizador volta
// ao começo; e o aviso da conexão ruim só fica enquanto ele diz ruim. Sem nada a mudar, o estado é o mesmo.
function soNaReuniao(e) {
  let f = e;
  const { chat } = f;
  if (!naReuniaoOuEntrando(f) && (chat.mensagens.length > 0 || chat.naoLidas > 0 || chat.aberto)) {
    f = { ...f, chat: { ...CHAT_VAZIO, seq: chat.seq } };
  }
  if (f.tela !== 'reuniao' && f.avisoCurto !== null) f = { ...f, avisoCurto: null };
  if (f.tela !== 'reuniao' && f.cartao) f = { ...f, cartao: false };
  const q = f.qualidade;
  if (!medindoALigacao(f) && (q.estado !== 'medindo' || q.perda !== null || q.atraso !== null)) {
    f = { ...f, qualidade: QUALIDADE_DO_COMECO };
  }
  if (f.avisoCurto?.tipo === 'conexao' && f.qualidade.estado !== 'ruim') f = { ...f, avisoCurto: null };
  // A lista do colega é da reunião, como o chat; o painel, as perguntas e a reunião cheia são da tela dela.
  if (!naReuniaoOuEntrando(f) && (f.lista !== LISTA_VAZIA || f.respondendo.length > 0)) {
    f = { ...f, lista: LISTA_VAZIA, respondendo: [] };
  }
  if (f.tela !== 'reuniao' && (f.gente || f.tirando !== null || f.encerrando || f.cheiaAoAceitar)) {
    f = { ...f, gente: false, tirando: null, encerrando: false, cheiaAoAceitar: false };
  }
  return f;
}

// A página espera a resposta do pedido: o de quem é de fora, nas telas da espera, e o entrar do colega, na tela
// entrando, antes do aceito (o colega não passa pela espera).
const naEspera = (e) => !e.aceito && (ESPERA.has(e.tela) || (e.colega !== null && e.tela === 'entrando'));
// O abrir de um pedido (o do clique, o do Tentar de novo, o do Entrar de novo e o do 1011) roda com o canal fechado.
const esperaOAbrir = (e) => naEspera(e) && e.canal === 'fechado';
// A principal espera uma senha pelo canal.
const esperaSenha = (e) => e.principal === 'pedindo' && e.senhaGuardada === null;
const contrario = (v) => (v === 'ligado' ? 'desligado' : v === 'desligado' ? 'ligado' : v);
// O canal do voltar: o que a página abriu depois do aceito para voltar com a chave, e que ainda não voltou.
const canalDoVoltar = (e) => e.aceito && (e.canal === 'abrindo' || e.canal === 'voltando');
// O voltar em curso: o abrir dele saiu, ou o canal dele ainda não voltou.
const voltarEmCurso = (e) => e.esperandoBilhete || canalDoVoltar(e);
// A chave do aceito ou do voltou. Sem ela (um servidor de antes da chave), a página não volta sozinha.
const chaveDe = (participante, volta) => (participante && volta ? { participante, volta } : null);

// O abriu do carregar dá o cabeçalho e pede a mídia. O do pedido abre o canal com o bilhete novo, que não fica no
// estado. O do voltar também abre o canal, e só: na reunião, ele não leva à entrada nem pede a mídia.
function abriu(e, { reuniao, bilhete, colega }) {
  if (e.tela === 'carregando') {
    return com(e, { tela: 'entrada', reuniao, esperandoMidia: true, ...reconhecido(e, colega) }, PEDIR_MIDIA);
  }
  if (esperaOAbrir(e)) {
    // O abrir com a chave responde o colega de novo, sem a chave: o nome e o valeAte de agora.
    const deAgora = e.colega !== null && colegaQueVale(colega) ? { colega: colegaDaResposta(colega) } : {};
    return com(e, { reuniao, canal: 'abrindo', ...deAgora }, abrirCanal(bilhete));
  }
  if (e.esperandoBilhete) return com(e, { esperandoBilhete: false, canal: 'abrindo' }, abrirCanal(bilhete));
  return nada(e);
}

// O colega que a resposta do abrir traz: o nome, e o valeAte, que é um número ou null.
const colegaQueVale = (c) => c !== null && typeof c === 'object' && typeof c.nome === 'string';
const colegaDaResposta = (c) => ({ nome: c.nome, valeAte: numero(c.valeAte) ? c.valeAte : null });

// O que o abriu do carregar diz do passe: o colega reconhecido, com a chave que vale daqui em diante, ou o passe que
// não valeu. Sem o passe, nada: quem é de fora.
function reconhecido(e, colega) {
  if (e.passe === null) return {};
  if (colegaQueVale(colega) && typeof colega.chave === 'string' && colega.chave !== '') {
    return { colega: colegaDaResposta(colega), chaveDoColega: colega.chave, passe: null };
  }
  return { passe: null, semColega: true };
}

// O 404 é o link que não vale; o 429 conta até poder tentar de novo; o resto (a rede, o 5xx) é o semServidor. No abrir
// do voltar, o 404 é a reunião que deixou de valer, e o resto é uma tentativa que falhou, sem o aviso tentativas.
// O passe (ou a chave do colega) que não vale segue como quem é de fora: no carregar, um abrir sem corpo; no Entrar,
// a entrada de quem é de fora, com o cabeçalho que a página já tem.
function abrirFalhou(e, { status, esperarSegundos, passe }) {
  if (e.esperandoBilhete) {
    const f = { ...e, esperandoBilhete: false };
    return status === 404 ? linkInvalidoDoVoltar(f) : voltarFalhou(f);
  }
  if (e.tela !== 'carregando' && !esperaOAbrir(e)) return nada(e);
  if (passe === true && corpoDoAbrir(e) !== null) {
    const semColega = { colega: null, chaveDoColega: null, passe: null, semColega: true };
    return e.tela === 'carregando' ? comAbrir(e, semColega) : com(e, { ...semColega, tela: 'entrada' });
  }
  if (status === 404) return terminar(e, 'linkInvalido');
  if (status !== 429) return avisar(e, 'semServidor');
  const n = Math.max(0, Math.ceil(Number(esperarSegundos) || 0));
  if (n === 0) return avisar(e, 'tentativas');
  return avisar(e, 'tentativas', { esperarSegundos: n }, esperar(CONTAGEM_MS, 'contagem'));
}

// O canal abriu: o do pedido manda o nome (o do colega, o entrar); o do voltar, depois do aceito, manda a chave e
// espera o voltou.
function canalAbriu(e) {
  if (!e.aceito) return com(e, { canal: 'aberto' }, pedidoOuEntrar(e));
  return com(e, { canal: 'voltando' }, mandar({ tipo: 'voltar', ...e.chave }));
}

// Na espera, o pedido sai com o canal: o 1011 (um erro do servidor) abre de novo sozinho, até 3 vezes, e o resto é o
// semServidor. Depois do aceito, o canal que cai não tira ninguém da reunião. O do voltar, que caiu antes do voltou, é
// uma tentativa que falhou, e o que esperava uma senha por ele (para entrar, ou para voltar) não a tem mais. Com a
// chave, ele volta: na próxima tentativa da volta, ou por trás, com a ligação no ar (o religar).
function canalFechou(e, codigo) {
  if (e.canal === 'fechado') return nada(e); // o que a página fechou
  const f = { ...e, canal: 'fechado' };
  if (naEspera(e)) {
    if (codigo === 1011 && e.reabrindo < MAX_REABRIR) {
      return com(f, { reabrindo: e.reabrindo + 1 }, esperar(REABRIR_MS, 'reabrir'));
    }
    return avisar(f, 'semServidor');
  }
  if (canalDoVoltar(e)) return voltarFalhou(f);
  if (esperaSenha(e)) return e.tela === 'reuniao' ? tentativaFalhou(f) : avisar(f, 'semServidor');
  if (e.principal === 'nenhuma' && e.reconectando > 0) return e.chave !== null ? nada(f) : terminar(f, 'saiu');
  // O pedido da tela, que esperava a senha por ele, para.
  const pedindoATela = e.telaCompartilhada === 'pedindo';
  const mudancas = pedindoATela ? { telaCompartilhada: 'nenhuma' } : {};
  const efeitos = pedindoATela ? [PARAR_CAPTURA] : [];
  if (e.principal === 'noAr' && e.chave !== null) return religar(f, mudancas, ...efeitos);
  // Sem a chave, o canal não volta, e nada mais acerta o palco: ele sai, e os quadros voltam ao mosaico inteiro.
  if (e.chave === null) return com(f, { ...mudancas, palco: null }, ...efeitos);
  return com(f, mudancas, ...efeitos);
}

// As mensagens do servidor (seção 10 do protocolo). O agora é a hora em que a mensagem chegou.
function mensagem(e, m, agora) {
  const esperando = naEspera(e);
  switch (m.tipo) {
    case 'naoComecou':
    case 'aguardando':
      return esperando ? com(e, { tela: m.tipo }) : nada(e);
    case 'aceito':
      if (!esperando) return nada(e);
      return comSenha(e, m.senha, {
        tela: 'entrando',
        aceito: true,
        acesso: { turn: m.turn, video: m.video },
        chave: chaveDe(m.participante, m.volta),
        senhaRepetida: false,
        palco: null,
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
      // O semServidor que responde ao tela (o vídeo fora do ar para o chat) para o compartilhar, como o erro.
      if (m.tipo === 'semServidor' && e.telaCompartilhada === 'pedindo') {
        return com(e, { telaCompartilhada: 'nenhuma' }, PARAR_CAPTURA);
      }
      // Na volta, a recusa do senha é uma tentativa que falhou, como o erro.
      if (esperaSenha(e) && e.reconectando > 0) return tentativaFalhou(e);
      return esperando || esperaSenha(e) ? avisar(e, m.tipo) : nada(e);
    case 'erro':
      return erro(e, m.erro);
    case 'palco':
      return e.aceito ? guardarOPalco(e, m) : nada(e);
    case 'mensagem':
      return mensagemDoChat(e, m, agora);
    case 'mensagemRecusada':
      return mensagemRecusada(e, m);
    case 'participantes':
      return lista(e, m);
    case 'recusa':
      return recusa(e, m);
    default:
      return nada(e);
  }
}

// ---- O chat da reunião ----

// O chat com as mudanças, e os efeitos.
const comChat = (e, mudancas, ...efeitos) => com(e, { chat: { ...e.chat, ...mudancas } }, ...efeitos);
// A lista com mais uma mensagem no fim, sem passar das últimas MAX_MENSAGENS.
const maisUma = (lista, m) => [...lista, m].slice(-MAX_MENSAGENS);
// A lista com a mensagem nova no lugar da antiga.
const noLugar = (lista, antiga, nova) => lista.map((x) => (x === antiga ? nova : x));

// A mensagem da própria pessoa entra no fim da lista (a lista dada, que no Tentar de novo já vem sem a antiga), com a
// hora de agora, e sai pelo canal, com o prazo da resposta. Sem o canal da pessoa, ela entra como "Não enviada": o
// texto nunca se perde.
function enviar(e, lista, texto, agora) {
  const n = e.chat.seq + 1;
  const minha = { n, voce: true, nome: '', texto, hora: agora, situacao: 'enviando', id: `m${n}`, motivo: null };
  if (!podeEscrever(e)) {
    const semCanal = { ...minha, situacao: 'naoEnviada', id: null, motivo: 'semCanal' };
    return comChat(e, { seq: n, mensagens: maisUma(lista, semCanal) });
  }
  return comChat(
    e,
    { seq: n, mensagens: maisUma(lista, minha) },
    mandar({ tipo: 'mensagem', id: minha.id, texto }),
    esperar(PRAZO_DA_MENSAGEM_MS, `mensagem:${minha.id}`),
  );
}

// A pessoa escreveu e mandou. O texto vazio, ou grande demais, não sai (o campo já não deixa).
function escrever(e, texto, agora) {
  if (e.tela !== 'reuniao') return nada(e);
  const limpo = textoLimpo(texto);
  return limpo === null ? nada(e) : enviar(e, e.chat.mensagens, limpo, agora);
}

// O Tentar de novo de uma mensagem "Não enviada": ela sai do lugar antigo e vai de novo, como uma mensagem nova.
function reenviar(e, n, agora) {
  if (!podeEscrever(e)) return nada(e);
  const antiga = e.chat.mensagens.find((m) => m.n === n);
  if (!antiga || antiga.situacao !== 'naoEnviada') return nada(e);
  return enviar(
    e,
    e.chat.mensagens.filter((m) => m !== antiga),
    antiga.texto,
    agora,
  );
}

// Uma mensagem do chat chegou. A que traz o id de uma que a página espera (indo, ou "Não enviada" pelo prazo) é a
// resposta dela, e a confirma. Qualquer outra entra no fim da lista: a de outra pessoa e, também, a da própria pessoa
// cujo id a página não espera mais (a resposta que atrasou e chegou depois do Tentar de novo: os outros viram as duas).
// A de outra pessoa, com o chat fechado, conta como não lida e, na tela da reunião, mostra o aviso curto.
function mensagemDoChat(e, m, agora) {
  if (!naReuniaoOuEntrando(e) || typeof m.texto !== 'string' || m.texto === '') return nada(e);
  const voce = m.voce === true;
  if (voce && typeof m.id === 'string') {
    const esperada = e.chat.mensagens.find((x) => x.id === m.id);
    if (esperada) {
      const confirmada = { ...esperada, situacao: 'enviada', id: null, motivo: null };
      return comChat(e, { mensagens: noLugar(e.chat.mensagens, esperada, confirmada) });
    }
  }
  const n = e.chat.seq + 1;
  const nome = typeof m.nome === 'string' ? m.nome : '';
  const nova = { n, voce, nome, texto: m.texto, hora: agora, situacao: 'enviada', id: null, motivo: null };
  const mensagens = maisUma(e.chat.mensagens, nova);
  if (voce || e.chat.aberto) return comChat(e, { seq: n, mensagens });
  const chat = { ...e.chat, seq: n, mensagens, naoLidas: e.chat.naoLidas + 1 };
  if (e.tela !== 'reuniao') return com(e, { chat });
  const aviso = e.avisos + 1;
  return com(
    e,
    { chat, avisos: aviso, avisoCurto: { n: aviso, tipo: 'mensagem', nome, texto: m.texto } },
    esperar(AVISO_CURTO_MS, `avisoCurto:${aviso}`),
  );
}

// A recusa de uma mensagem que a página espera: ela fica "Não enviada", com o motivo, e não espera mais nada.
function mensagemRecusada(e, m) {
  if (typeof m.id !== 'string') return nada(e);
  const esperada = e.chat.mensagens.find((x) => x.id === m.id);
  if (!esperada) return nada(e);
  const motivo = typeof m.motivo === 'string' ? m.motivo : null;
  const recusada = { ...esperada, situacao: 'naoEnviada', id: null, motivo };
  return comChat(e, { mensagens: noLugar(e.chat.mensagens, esperada, recusada) });
}

// O prazo de uma mensagem venceu sem a resposta: ela fica "Não enviada". O id fica: a resposta que só atrasou ainda a
// confirma.
function prazoDaMensagem(e, id) {
  const indo = e.chat.mensagens.find((x) => x.id === id && x.situacao === 'enviando');
  if (!indo) return nada(e);
  return comChat(e, { mensagens: noLugar(e.chat.mensagens, indo, { ...indo, situacao: 'naoEnviada', motivo: 'prazo' }) });
}

// O chat abre: as não lidas zeram, o aviso curto da mensagem sai, e o foco vai ao campo de escrever.
function abrirOChat(e) {
  const avisoCurto = e.avisoCurto?.tipo === 'mensagem' ? null : e.avisoCurto;
  return com(e, { chat: { ...e.chat, aberto: true, naoLidas: 0 }, avisoCurto, gente: false }, FOCAR_O_CAMPO);
}

// ---- O colega na reunião ----

// A página do colega na reunião, ou entrando nela: só ela recebe a lista e responde aos pedidos.
const colegaNaReuniao = (e) => e.colega !== null && naReuniaoOuEntrando(e);
// As respostas mandam pelo canal da pessoa, na tela da reunião.
const podeResponder = (e) => e.colega !== null && podeEscrever(e);
// Quem a resposta procura na lista: o pedido, no aceitar e no recusar; o participante, no tirar.
const daResposta = (l, de) => (de === 'tirar' ? l.participantes : l.pedidos);

// A lista inteira chegou (a mensagem participantes): ela toma o lugar da anterior. A resposta da página cujo pedido
// (ou participante) saiu da lista deu certo, e o leitor de tela ouve o resultado; o pedido que a lista anterior não
// tinha, ele ouve que chegou. Tudo o que a lista diz sai num dizer só, os textos na ordem: a região que o leitor de
// tela ouve guarda um texto de cada vez, e dois dizer no mesmo passo deixariam só o último. A pergunta do Tirar de
// quem já saiu se desfaz, e a reunião cheia do último aceitar sai.
function lista(e, m) {
  if (!colegaNaReuniao(e)) return nada(e);
  const nova = lerLista(m);
  if (nova === null) return nada(e);
  const ditos = [];
  const respondendo = e.respondendo.filter((r) => {
    if (daResposta(nova, r.de).some((x) => x.id === r.id)) return true;
    ditos.push(ditoDaResposta(r.de, r.nome));
    return false;
  });
  for (const p of nova.pedidos) {
    // O que o leitor de tela ouve quando um pedido chega é o título do cartão dele sozinho: "<Nome> quer entrar".
    if (!e.lista.pedidos.some((x) => x.id === p.id)) ditos.push(tituloDoCartao([p]));
  }
  const tirando = nova.participantes.some((x) => x.id === e.tirando) ? e.tirando : null;
  const efeitos = ditos.length > 0 ? [dizer(ditos.join('. '))] : [];
  return com(e, { lista: nova, respondendo, tirando, cheiaAoAceitar: false }, ...efeitos);
}

// Uma resposta da página não deu certo (o recusa, com o de e o motivo): ela não espera mais a lista, e nada é dito
// dela. O servidor responde na ordem em que recebe: a recusa é da mais antiga daquele tipo. A reunião cheia aparece no
// cartão e no painel; o servidor de vídeo fora do ar, no aviso curto. Os outros motivos (a resposta de outro colega
// chegou antes, a pessoa já saiu, ou a página não está mais na reunião para o chat) não mostram nada: a lista nova diz.
function recusa(e, { de, motivo }) {
  if (!colegaNaReuniao(e)) return nada(e);
  const i = e.respondendo.findIndex((r) => r.de === de);
  const mudancas = i < 0 ? {} : { respondendo: e.respondendo.filter((_, j) => j !== i) };
  if (motivo === 'cheia' && de === 'aceitar') return com(e, { ...mudancas, cheiaAoAceitar: true });
  if (motivo === 'servidorVideo' && e.tela === 'reuniao') {
    const aviso = e.avisos + 1;
    return com(
      e,
      { ...mudancas, avisos: aviso, avisoCurto: { n: aviso, tipo: 'servidor' } },
      esperar(AVISO_CURTO_MS, `avisoCurto:${aviso}`),
      dizer('O servidor de reuniões não respondeu'),
    );
  }
  return i < 0 ? nada(e) : com(e, mudancas);
}

// Uma resposta sai pelo canal e espera a lista nova: {de, id, nome}. Responder de novo tira a reunião cheia.
function responder(e, de, id, nome, m, mudancas = {}) {
  const respondendo = [...e.respondendo, { de, id, nome }];
  return com(e, { ...mudancas, respondendo, cheiaAoAceitar: false }, mandar(m));
}

// Os cliques do colega na reunião. O painel Participantes fica no lugar do chat: abrir um fecha o outro. O Tirar e o
// Encerrar para todos pedem o segundo clique. Quem é de fora não tem nada disso.
function cliqueDoColega(e, botao, id) {
  if (e.colega === null || e.tela !== 'reuniao') return nada(e);
  const comPainel = { gente: true, chat: { ...e.chat, aberto: false } };
  switch (botao) {
    case 'participantes':
      // O botão abre e fecha. Ao fechar por ele, o foco já está nele.
      return com(e, e.gente ? { gente: false } : comPainel);
    case 'fecharParticipantes':
      // O fechar do painel (o botão dele e o Esc) devolve o foco ao botão Participantes.
      return e.gente ? com(e, { gente: false }, focar('participantes')) : nada(e);
    case 'verPedidos':
      // O Ver os pedidos do cartão abre o painel, com o foco no cartão de quem espera.
      return com(e, comPainel, focar('cartao'));
    case 'aceitar':
    case 'recusar': {
      const p = e.lista.pedidos.find((x) => x.id === id);
      if (!p || !podeResponder(e)) return nada(e);
      return responder(e, botao, p.id, p.nome, { tipo: botao, pedido: p.id });
    }
    case 'tirar': {
      const p = e.lista.participantes.find((x) => x.id === id);
      return p && !p.voce ? com(e, { tirando: p.id }) : nada(e);
    }
    case 'tirarMesmo': {
      const p = e.lista.participantes.find((x) => x.id === id);
      if (!p || e.tirando !== p.id || !podeResponder(e)) return nada(e);
      return responder(e, 'tirar', p.id, p.nome, { tipo: 'tirar', participante: p.id }, { tirando: null });
    }
    case 'naoTirar':
      return e.tirando !== null ? com(e, { tirando: null }) : nada(e);
    case 'encerrar':
      return e.encerrando ? nada(e) : com(e, { encerrando: true });
    case 'encerrarMesmo':
      // O encerrar não espera resposta na lista: o encerrada é o fim, e a recusa mostra o aviso.
      if (!e.encerrando || !podeResponder(e)) return nada(e);
      return com(e, { encerrando: false }, mandar({ tipo: 'encerrar' }));
    case 'naoEncerrar':
      // O Voltar da pergunta devolve o foco ao Encerrar para todos.
      return e.encerrando ? com(e, { encerrando: false }, focar('encerrar')) : nada(e);
    default:
      return nada(e);
  }
}

// ---- O sinalizador de qualidade ----

// Uma medida do medidor: o estado mostrado e os números dela. A virada para ruim (de qualquer outro estado, também do
// medindo) mostra o aviso curto da conexão, que toma o lugar do aviso de uma mensagem. Ele não nasce com o cartão
// aberto, nem se outro já saiu nos últimos 2 minutos: o tempo que o libera é o conexaoAvisada.
function qualidade(e, { estado, perda, atraso }) {
  if (!medindoALigacao(e) || !ESTADOS_DA_QUALIDADE.has(estado)) return nada(e);
  const nova = { estado, perda: numero(perda) ? perda : null, atraso: numero(atraso) ? atraso : null };
  const virouRuim = estado === 'ruim' && e.qualidade.estado !== 'ruim';
  if (!virouRuim || e.cartao || e.conexaoAvisada) return com(e, { qualidade: nova });
  const aviso = e.avisos + 1;
  return com(
    e,
    { qualidade: nova, avisos: aviso, avisoCurto: { n: aviso, tipo: 'conexao' }, conexaoAvisada: true },
    esperar(AVISO_CURTO_MS, `avisoCurto:${aviso}`),
    esperar(AVISO_DA_CONEXAO_MS, 'conexaoAvisada'),
  );
}

// O cartão do sinalizador abre: o aviso da conexão, que levava a ele, sai. O de uma mensagem fica.
function abrirOCartao(e, ...efeitos) {
  const avisoCurto = e.avisoCurto?.tipo === 'conexao' ? null : e.avisoCurto;
  return com(e, { cartao: true, avisoCurto }, ...efeitos);
}

// O palco que vale toma o lugar do anterior. O que não vale fica de fora e leva o anterior junto: ele prova que o
// anterior ficou velho, e sem palco os quadros voltam ao mosaico inteiro.
function guardarOPalco(e, m) {
  return com(e, { palco: lerPalco(m) });
}

// A resposta ao voltar, no canal do voltar. O servidor manda o voltou antes de qualquer outra mensagem, e fecha o canal
// depois do erro e do linkInvalido.
function respostaDoVoltar(e, m) {
  switch (m.tipo) {
    case 'voltou':
      return voltou(e, m.volta);
    case 'linkInvalido':
      return linkInvalidoDoVoltar(e);
    case 'erro':
      // O invalido é a chave que não vale mais, e tentar de novo não adianta; outro erro é uma tentativa que falhou.
      return m.erro === 'invalido' ? chaveRecusada(e) : voltarFalhou(e);
    default:
      return nada(e);
  }
}

// O voltou: o canal é de novo o da pessoa, com a chave nova. Na volta depois da conexão caída, a tentativa segue com o
// senha; no religar, ele acabou.
function voltou(e, volta) {
  const mudancas = { canal: 'aberto', chave: chaveDe(e.chave.participante, volta) };
  if (e.reconectando > 0) return com(e, { ...mudancas, principal: 'pedindo' }, mandar({ tipo: 'senha' }));
  return com(e, { ...mudancas, religando: 0 });
}

// A chave recusada sai do estado. Na volta depois da conexão caída, a pessoa saiu; no religar, a reunião segue sem o
// canal, e uma queda da ligação, depois, é o saiu.
function chaveRecusada(e) {
  const f = { ...e, chave: null };
  return e.reconectando > 0 ? terminar(f, 'saiu') : pararDeReligar(f);
}

// O linkInvalido do voltar (a resposta, ou o 404 do abrir dele): a reunião deixou de valer, mas quem já está nela
// continua, mesmo depois do valeAte. Com a ligação no ar, o religar para, a reunião segue sem o canal, e a ligação
// decide o fim; a chave fica para a volta das duas. Sem a ligação, é o fim.
function linkInvalidoDoVoltar(e) {
  return e.principal === 'noAr' ? pararDeReligar(e) : terminar(e, 'linkInvalido');
}

// A senha da principal chegou: liga, ou a guarda até a mídia chegar.
function comSenha(e, senha, mudancas = {}) {
  if (e.esperandoMidia) return com(e, { ...mudancas, principal: 'pedindo', senhaGuardada: senha });
  return com(e, { ...mudancas, principal: 'ligando' }, ligar('principal', senha));
}

// O erro responde ao que a página pediu: a tela, uma senha ou o pedir. O do senha da volta (o limite de 5 por minuto,
// por exemplo) é uma tentativa que falhou. O pedir com o nome recusado volta à entrada, e o canal dele fecha: o próximo
// Pedir abre outro, com um bilhete novo.
function erro(e, qual) {
  if (e.telaCompartilhada === 'pedindo') return com(e, { telaCompartilhada: 'nenhuma' }, PARAR_CAPTURA);
  if (esperaSenha(e)) return e.reconectando > 0 ? tentativaFalhou(e) : avisar(e, 'semServidor');
  // O entrar do colega não tem nome a corrigir: o erro é o semServidor.
  if (naEspera(e) && e.tela === 'entrando') return avisar(e, 'semServidor');
  if (e.tela !== 'pedindo') return nada(e);
  if (qual === 'invalido') return com(e, { tela: 'entrada', nomeRecusado: true, canal: 'fechado' }, FECHAR_CANAL);
  return avisar(e, 'semServidor');
}

// A ligação principal. Os eventos de uma ligação que a página desligou chegam com a principal em nenhuma, e ficam de
// fora.
function ligacaoPrincipal(e, o, codigo) {
  if (e.principal === 'ligando') {
    if (o === 'confirmada') {
      const mudancas = { tela: 'reuniao', principal: 'noAr', reconectando: 0, senhaRepetida: false };
      // O canal que caiu no meio do ligar volta por trás, com a chave.
      return e.canal === 'fechado' && e.chave !== null ? religar(e, mudancas) : com(e, mudancas);
    }
    // A ligação que perdeu a conexão no meio do ligar ainda existe: ela desce.
    const desce = o === 'semConexao' ? [desligar('principal')] : [];
    if (e.reconectando > 0) return tentativaFalhou(e, ...desce);
    // A senha pode ter vencido no caminho: o primeiro 403 pede outra.
    if (o === 'falhou' && codigo === 403 && !e.senhaRepetida && e.canal === 'aberto') {
      return com(e, { principal: 'pedindo', senhaRepetida: true }, mandar({ tipo: 'senha' }));
    }
    return avisar(e, 'semServidor', {}, ...desce);
  }
  if (e.principal !== 'noAr') return nada(e);
  if (o === 'semConexao') {
    // A conexão caiu: as duas descem, e a página volta com uma senha nova. Sem o canal, a chave abre outro, e o voltar
    // do religar em curso vira a primeira tentativa, com um prazo só dela; sem o canal e sem a chave, não há senha.
    if (e.canal !== 'aberto' && e.chave === null) return terminar(e, 'saiu');
    const { mudancas, efeitos } = desligarAsDuas(e);
    const { vez, espera } = esperaNova(e, 'reconectar', RECONECTAR_MS[0]);
    const proxima = voltarEmCurso(e) ? prazoDaVez(vez) : espera;
    return com(e, { ...mudancas, reconectando: 1, religando: 0, vez }, ...efeitos, proxima);
  }
  // O servidor terminou a ligação (o falhou de uma ligação no ar conta igual, e o mosaico nunca fica parado): um tirado
  // ou um encerrada pode chegar logo depois; sem ele, é o saiu.
  if (o === 'terminou' || o === 'falhou') {
    return com(e, { principal: 'nenhuma', trocandoCamera: false }, esperar(FIM_SEM_AVISO_MS, 'fimSemAviso'));
  }
  return nada(e);
}

// Uma tentativa de voltar falhou: a próxima espera mais, e o canal do voltar que ela abriu fecha (sem o canal, a
// próxima abre outro com a chave). Depois da terceira, ou sem o canal e sem a chave para pedir a senha, a pessoa saiu
// (o terminar já desliga as duas e fecha o canal do voltar).
function tentativaFalhou(e, ...efeitos) {
  if (e.reconectando >= MAX_RECONECTAR || (e.canal !== 'aberto' && e.chave === null)) return terminar(e, 'saiu');
  const canal = fecharCanalDoVoltar(e);
  const { vez, espera } = esperaNova(e, 'reconectar', RECONECTAR_MS[e.reconectando]);
  const mudancas = { ...canal.mudancas, principal: 'nenhuma', reconectando: e.reconectando + 1, vez };
  return com(e, mudancas, ...efeitos, ...canal.efeitos, espera);
}

// Uma tentativa do voltar falhou: a da volta depois da conexão caída conta no reconectando, e a do religar, no
// religando.
function voltarFalhou(e) {
  if (e.reconectando > 0) return tentativaFalhou(e);
  return e.religando > 0 ? religarFalhou(e) : nada(e);
}

// O religar: na reunião, com a ligação no ar, o canal que caiu volta por trás com a chave, sem nada na tela. A primeira
// tentativa espera 2 segundos.
function religar(e, mudancas, ...efeitos) {
  const { vez, espera } = esperaNova(e, 'religar', RECONECTAR_MS[0]);
  return com(e, { ...mudancas, religando: 1, vez }, ...efeitos, espera);
}

// Uma tentativa de religar falhou: a próxima espera mais, e o canal do voltar que ela abriu fecha. Depois da terceira,
// a reunião segue sem o canal, como antes da chave; uma queda da ligação, depois, ainda volta com ela.
function religarFalhou(e) {
  if (e.religando >= MAX_RECONECTAR) return pararDeReligar(e);
  const { mudancas, efeitos } = fecharCanalDoVoltar(e);
  const { vez, espera } = esperaNova(e, 'religar', RECONECTAR_MS[e.religando]);
  return com(e, { ...mudancas, religando: e.religando + 1, vez }, ...efeitos, espera);
}

// O religar para: o canal do voltar fecha, e a reunião segue sem o canal. O palco sai junto: sem o canal, nada mais o
// acerta, e os quadros voltam ao mosaico inteiro.
function pararDeReligar(e) {
  const { mudancas, efeitos } = fecharCanalDoVoltar(e);
  return com(e, { ...mudancas, religando: 0, palco: null }, ...efeitos);
}

// O voltar começa pelo abrir, que dá o bilhete do canal novo, e o prazo da tentativa começa junto.
function abrirParaVoltar(e) {
  const { estado, efeitos } = abrirCom(e, null, { esperandoBilhete: true }); // sem corpo: a chave de volta basta
  return so(estado, ...efeitos, prazoDaVez(e.vez));
}

// A tentativa ainda espera o servidor: o voltar em curso (o abrir, o canal e o voltou) ou, na volta, o senha. Depois
// do senha, quem decide é a ligação.
const esperaOServidor = (e) => voltarEmCurso(e) || (e.reconectando > 0 && esperaSenha(e));

// O prazo venceu sem a resposta do servidor: a tentativa falhou, como se o canal em que ela esperava caísse, e a página
// o fecha. Sem o canal (o abrir ainda não respondeu), o abriu que vier fica de fora.
function prazoVenceu(e) {
  if (e.canal === 'fechado') return voltarFalhou({ ...e, esperandoBilhete: false });
  const r = canalFechou(e);
  return so(r.estado, FECHAR_CANAL, ...r.efeitos);
}

// O canal do voltar não serve para mais nada quando a tentativa dele para (o voltar só vale como a primeira mensagem do
// canal): ele fecha, e o próximo abre com outro bilhete.
function fecharCanalDoVoltar(e) {
  if (!canalDoVoltar(e)) return { mudancas: {}, efeitos: [] };
  return { mudancas: { canal: 'fechado' }, efeitos: [FECHAR_CANAL] };
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

function clique(e, botao, id) {
  switch (botao) {
    case 'pedir':
      if (e.tela !== 'entrada' || e.colega !== null || !nomeValido(e.nome)) return nada(e);
      return comAbrir(e, { tela: 'pedindo', nomeRecusado: false, reabrindo: 0 });
    case 'entrar':
      // O Entrar do colega: o abrir com a chave dá o bilhete de um canal de colega, e ele entra sem a espera.
      if (e.tela !== 'entrada' || e.colega === null) return nada(e);
      return comAbrir(e, { tela: 'entrando', reabrindo: 0 });
    case 'desistir':
      return desistir(e);
    case 'tentarDeNovo':
      return tentarDeNovo(e);
    case 'tentarMidia':
      return e.tela === 'entrada' ? com(e, { esperandoMidia: true }, PEDIR_MIDIA) : nada(e);
    case 'sair':
      return sair(e);
    case 'entrarDeNovo':
      return entrarDeNovo(e);
    case 'microfone':
      return trocar(e, 'mic');
    case 'camera':
      return trocar(e, 'cam');
    case 'pararDeCompartilhar':
      return pararDeCompartilhar(e);
    case 'chat':
      // O botão Chat dos controles abre e fecha. Ao fechar por ele, o foco já está nele.
      if (e.tela !== 'reuniao') return nada(e);
      return e.chat.aberto ? comChat(e, { aberto: false }) : abrirOChat(e);
    case 'abrirChat':
      return e.tela === 'reuniao' && !e.chat.aberto ? abrirOChat(e) : nada(e);
    case 'fecharChat':
      // O fechar do painel (o botão dele e o Esc) devolve o foco ao botão Chat.
      return e.tela === 'reuniao' && e.chat.aberto ? comChat(e, { aberto: false }, FOCAR_O_CHAT) : nada(e);
    case 'qualidade':
      // O botão do sinalizador abre e fecha o cartão dele. O foco já está no botão. Fora da tela da reunião o cartão
      // não fica aberto: quem o fecha é a regra do fim da transicao.
      return e.cartao ? com(e, { cartao: false }) : abrirOCartao(e);
    case 'verDetalhes':
      // O Ver os detalhes do aviso da conexão abre o cartão. O botão some com o aviso: o foco vai ao do sinalizador.
      return e.tela === 'reuniao' ? abrirOCartao(e, FOCAR_O_SINAL) : nada(e);
    case 'fecharCartao':
      // O Esc e o clique fora do sinalizador fecham o cartão, e o foco fica onde está.
      return e.cartao ? com(e, { cartao: false }) : nada(e);
    default:
      return cliqueDoColega(e, botao, id);
  }
}

// Sair: da reunião, ou da tela entrando. O colega que sai antes do aceito larga o canal do entrar (o servidor ainda
// não o ligou a nada): o Entrar de novo abre outro, com a chave.
function sair(e) {
  if (e.tela !== 'reuniao' && e.tela !== 'entrando') return nada(e);
  if (e.aceito || e.canal === 'fechado') return terminar(e, 'saiu');
  const r = terminar({ ...e, canal: 'fechado' }, 'saiu');
  return so(r.estado, FECHAR_CANAL, ...r.efeitos);
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
  // O colega volta à tela entrando, e não à espera.
  const doPedido = e.colega !== null ? 'entrando' : 'pedindo';
  if (e.canal !== 'aberto') {
    return comAbrir(e, { ...volta, tela: e.reuniao ? doPedido : 'carregando', aceito: false, acesso: null });
  }
  if (!e.aceito) return com(e, { ...volta, tela: doPedido }, pedidoOuEntrar(e));
  return com(e, { ...volta, tela: 'entrando', principal: 'pedindo', senhaRepetida: false }, mandar({ tipo: 'senha' }));
}

// O Entrar de novo depois do saiu. Com o canal aberto: uma senha nova para o mesmo participante e a mídia de novo, e o
// ligar sai quando as duas chegarem. Com o canal fechado, o pedido passa pela espera outra vez; o do colega abre com a
// chave e entra direto.
function entrarDeNovo(e) {
  if (e.aviso !== 'saiu') return nada(e);
  const volta = { aviso: null, esperandoMidia: true };
  if (e.canal === 'aberto') {
    const mudancas = { ...volta, tela: 'entrando', principal: 'pedindo', senhaRepetida: false };
    return com(e, mudancas, PEDIR_MIDIA, mandar({ tipo: 'senha' }));
  }
  const tela = e.colega !== null ? 'entrando' : 'pedindo';
  return comAbrir(e, { ...volta, tela, aceito: false, acesso: null, reabrindo: 0 }, PEDIR_MIDIA);
}

// O Microfone e a Câmera. Na reunião, a ligação troca junto. Antes dela, só o estado muda, e quem roda o ligar lê a
// escolha do estado. Com a ligação nascendo (ligando), o clique fica de fora: a oferta já saiu com a escolha de antes.
// Na reunião, a câmera troca uma vez de cada vez: o cameraTrocada que chegar responde ao clique pendente.
function trocar(e, qual) {
  if (e[qual] === 'indisponivel' || e.principal === 'ligando') return nada(e);
  const ligado = e[qual] !== 'ligado';
  const mudancas = { [qual]: ligado ? 'ligado' : 'desligado' };
  if (e.principal !== 'noAr') return com(e, mudancas);
  if (qual === 'mic') return com(e, mudancas, { tipo: 'trocarMicrofone', ligado });
  if (e.trocandoCamera) return nada(e);
  return com(e, { ...mudancas, trocandoCamera: true }, { tipo: 'trocarCamera', ligada: ligado });
}

// A resposta à troca da câmera na reunião: a que não deu certo volta a câmera ao que era. Sem troca pendente (fora da
// reunião, ou de uma ligação que já desceu), ela fica de fora.
function cameraTrocada(e, ok) {
  if (!e.trocandoCamera) return nada(e);
  return com(e, ok ? { trocandoCamera: false } : { trocandoCamera: false, cam: contrario(e.cam) });
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
// senha guardada, o ligar sai agora. Num aviso sem o Tentar de novo (o fim, depois do pararMidia dele), a página não a
// quer mais: ela para logo, sem mudar a escolha da pessoa.
const escolha = (atual, veio) => (veio === 'ligado' && atual === 'desligado' ? 'desligado' : veio);

function midia(e, { mic, cam }) {
  if (e.tela === 'aviso' && !DE_NOVO.has(e.aviso)) return com(e, { esperandoMidia: false }, PARAR_MIDIA);
  const mudancas = { mic: escolha(e.mic, mic), cam: escolha(e.cam, cam), esperandoMidia: false };
  if (e.senhaGuardada === null) return com(e, mudancas);
  return com(e, { ...mudancas, principal: 'ligando', senhaGuardada: null }, ligar('principal', e.senhaGuardada));
}

// Os prazos que o esperar marcou. O que chega depois de a página mudar de rumo fica de fora, e a espera da volta e do
// religar de uma vez que passou também.
function tempo(e, chave) {
  const [nome, vez] = String(chave).split(':');
  const daVezAtual = Number(vez) === e.vez;
  switch (nome) {
    case 'contagem': {
      if (e.aviso !== 'tentativas' || e.esperarSegundos === 0) return nada(e);
      const n = e.esperarSegundos - 1;
      return n > 0 ? com(e, { esperarSegundos: n }, esperar(CONTAGEM_MS, 'contagem')) : com(e, { esperarSegundos: 0 });
    }
    case 'reconectar':
      if (!daVezAtual || e.tela !== 'reuniao' || e.reconectando === 0) return nada(e);
      // Uma espera repetida, com a tentativa em curso, também fica de fora: nunca dois canais.
      if (e.principal !== 'nenhuma' || voltarEmCurso(e)) return nada(e);
      if (e.canal === 'aberto') return com(e, { principal: 'pedindo' }, mandar({ tipo: 'senha' }), prazoDaVez(e.vez));
      // Sem o canal, a chave abre outro; sem ela, não há senha: nenhum mandar num canal fechado.
      return e.chave !== null ? abrirParaVoltar(e) : terminar(e, 'saiu');
    case 'religar':
      if (!daVezAtual || e.religando === 0) return nada(e);
      return e.canal === 'fechado' && !e.esperandoBilhete ? abrirParaVoltar(e) : nada(e);
    case 'prazo':
      return daVezAtual && esperaOServidor(e) ? prazoVenceu(e) : nada(e);
    case 'fimSemAviso':
      return e.tela === 'reuniao' && e.principal === 'nenhuma' && e.reconectando === 0 ? terminar(e, 'saiu') : nada(e);
    case 'reabrir':
      return esperaOAbrir(e) && e.reabrindo > 0 ? comAbrir(e, {}) : nada(e);
    case 'mensagem':
      return prazoDaMensagem(e, vez); // a segunda parte da chave é o id da mensagem
    case 'avisoCurto':
      // O tempo de um aviso que já saiu, ou que deu lugar a outro, fica de fora.
      return e.avisoCurto !== null && Number(vez) === e.avisoCurto.n ? com(e, { avisoCurto: null }) : nada(e);
    case 'conexaoAvisada':
      // Os 2 minutos do último aviso de conexão ruim passaram, com a pessoa na reunião ou fora dela: a próxima virada
      // para ruim avisa de novo.
      return e.conexaoAvisada ? com(e, { conexaoAvisada: false }) : nada(e);
    default:
      return nada(e);
  }
}

// avisar: a tela do aviso. A principal fica sem nada pendente, e a volta e o religar param (o abriu que ainda vier fica
// de fora); o canal e a mídia ficam, para o Tentar de novo. O palco sai: ele era da reunião que acabou. Um palco que
// chegue depois, com o aviso na tela e o canal aberto, fica guardado de novo (de propósito), e o próximo aceito o tira.
function avisar(e, aviso, mudancas = {}, ...efeitos) {
  const limpo = { principal: 'nenhuma', reconectando: 0, senhaRepetida: false, senhaGuardada: null, palco: null };
  const semVoltar = { religando: 0, esperandoBilhete: false };
  return com(e, { tela: 'aviso', aviso, esperarSegundos: 0, ...limpo, ...semVoltar, ...mudancas }, ...efeitos);
}

// terminar: o fim da entrada (os avisos sem o Tentar de novo, e o saiu). Depois do aceito, as duas ligações descem, e o
// canal do voltar, que ainda não voltou, fecha. A mídia para, e a luz da câmera apaga; no carregar, ela nem foi pedida.
// O Entrar de novo do saiu a pede outra vez.
function terminar(e, aviso) {
  const ligacoes = e.aceito ? desligarAsDuas(e) : { mudancas: {}, efeitos: [] };
  const canal = fecharCanalDoVoltar(e);
  const efeitos = [...ligacoes.efeitos, ...canal.efeitos];
  if (e.tela !== 'carregando') efeitos.push(PARAR_MIDIA);
  return avisar(e, aviso, { ...ligacoes.mudancas, ...canal.mudancas }, ...efeitos);
}

// As duas ligações descem de propósito, e a captura da tela, se houver, para junto. A troca da câmera pendente era da
// ligação que desceu.
function desligarAsDuas(e) {
  const efeitos = [desligar('principal'), desligar('tela')];
  if (e.telaCompartilhada !== 'nenhuma') efeitos.push(PARAR_CAPTURA);
  return { mudancas: { principal: 'nenhuma', telaCompartilhada: 'nenhuma', trocandoCamera: false }, efeitos };
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
