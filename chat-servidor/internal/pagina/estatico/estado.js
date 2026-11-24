// O cérebro da página da reunião: uma máquina de estados pura. A transicao(estado, evento) devolve o estado novo e os
// efeitos, sem tocar no DOM, na rede ou no relógio; o pagina.js roda os efeitos e devolve os resultados como eventos.
// Ela nunca muda o estado que recebe: cada passo devolve um objeto novo.
//
// O que o cérebro espera de quem roda os efeitos (o pagina.js, o rede.js, o midia.js e o ligacao.js):
// - depois do fecharCanal, nenhum evento daquele canal, nem o canalFechou;
// - os eventos de uma ligação depois do desligar dela chegam antes do próximo ligar;
// - o falhou e o terminou dizem que a ligação acabou; o semConexao, que ela ainda existe e desce com o desligar;
// - o midia diz ligado ou indisponivel de cada aparelho, ou só do microfone (a câmera, então, fica como estava);
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
// abrir) só param o religar; o colega, além disso, deixa de cuidar dela (a seção "O chat que reinicia").
//
// O palco e o aviso da câmera (seção 10 do protocolo). O servidor diz à pessoa aceita onde cada um está no mosaico (a
// mensagem palco), e o cérebro guarda o último palco que vale, para os quadros. Ele só entra depois do aceito, pelo
// canal aberto, e sai no aceito, em todo aviso, com um palco que não vale (que prova que ele ficou velho) e quando a
// página deixa o canal sem ele: o canal que fecha sem a chave, o religar que para (a chave recusada, o linkInvalido, o
// 404 do abrir do voltar ou o chat que reiniciou) e a terceira tentativa do religar que falha (o religar segue,
// devagar, mas sem o canal nada acerta o palco). Ele fica enquanto a página tenta voltar (a conexão caída e o
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
// encerrar. O que deu certo é confirmado pelo feito (ou pelo encerrada, que é o fim), e o leitor de tela ouve o
// resultado (o efeito dizer). A resposta que não pode sair (o canal no religar) é como a recusa servidorVideo: o aviso
// curto do servidor. A lista, o painel e as perguntas seguem a regra da tela da reunião, como o chat. Quem é de fora
// nunca tem nada disso. A chave do colega e o passe não vão ao console, como a chave de volta.
//
// O chat que reinicia. O servidor do chat esquece quem estava nele quando reinicia, e o abrir diz a partida dele, que
// muda a cada vez que ele sobe; o cérebro guarda a do último abrir que não foi o de um voltar. O abrir do voltar que
// responde com outra partida diz que o chat reiniciou: o bilhete não serve (o voltar seria recusado), a chave de volta
// sai, e a partida nova fica. Com a ligação também caída, é o saiu, como a chave recusada da volta; com ela no ar, quem
// é de fora segue na reunião sem o canal, como hoje. O colega, com a ligação no ar, deixa de cuidar da reunião (o
// semCuidar): o canal dele não volta mais, e sem ele não há como aceitar, recusar, tirar nem encerrar. A lista sai, as
// perguntas fecham, e o leitor de tela ouve o aviso; a ligação e o painel aberto ficam. O mesmo vale para a chave
// recusada no religar e para o link que deixou de valer no voltar (a resposta, ou o 404 do abrir). Com o semCuidar, o
// Encerrar para todos não abre a pergunta, como antes de a primeira lista chegar. Ele acaba com a saída da tela da
// reunião, por qualquer fim.
// Dentro do app, o chat que reiniciou com o colega na reunião e a ligação no ar não é o semCuidar: a página entra de
// novo sozinha (o reentrando). A lista, as perguntas e o palco saem, sem o aviso; ela pede outro passe ao app, abre
// com ele, e o canal novo manda o entrar, e não o voltar. Até o aceito, a ligação de antes segue no ar, e o canal novo
// ainda não é o da pessoa. O aceito troca a ligação pela volta de hoje (as duas descem, e uma senha nova sobe a nova),
// com o microfone e a câmera como estavam; a tela compartilhada não volta sozinha, e a senha do aceito não é usada.
// Tudo o que falha antes do aceito (o passe que não chega, o abrir que falha ou não reconhece o colega, o segundo
// passe seguido que não vale, o canal que fecha, o prazo e a recusa do entrar) é o semCuidar, com a ligação de antes no
// ar. A saída da tela da reunião, no meio disso, a interrompe, e o passe esperado é esquecido.
//
// A tela "o app ou o navegador" (a escolha). No Windows (o comecar com o windows), o abriu do carregar de quem a página
// não reconheceu como colega leva à escolha, e não à entrada: o "Abrir no app" é um link, e a página fica nela; o
// "Entrar pelo navegador" (o clique peloNavegador) leva à entrada de quem é de fora, que pede a mídia. A reunião de
// teste nunca pergunta, e a escolha vale para a página inteira: depois dela, nenhum abrir mostra a escolha de novo.
//
// O app (o app.js, a seção 7.5 da spec). Dentro do iframe do app (o comecar com o noApp), a página não abre nada antes
// do passe: ela diz pronta ao app (o efeito avisarApp) e espera o passe por mensagem (o evento app), até
// PRAZO_DO_PASSE_MS. O passe que não chega a tempo, ou o segundo seguido que não vale, leva à entrada de quem é de
// fora, com a faixa; o primeiro que não vale (o passe que venceu antes de a página carregar, ou a chave do colega que
// deixou de valer porque o chat reiniciou) pede outro, e a página segue sozinha com ele, sem outro clique. O passe
// leva os nomes dos aparelhos das Configurações do app, que o midia.js procura no navegador; a troca deles na reunião
// troca o microfone e a câmera da ligação. O app fica sabendo da fase (o paraOApp, que a tela manda quando muda), do
// fim de quem tinha entrado (o avisarApp com o fim) e, pelo sair, a página sai e responde o fim. Dentro do app não há
// a tela "o app ou o navegador", e quem não está no app nunca tem nada disso.
//
// A pausa (as seções 7.8 e 7.9 da spec). Enquanto a pessoa está numa ligação no Starsonic Phone, a reunião não a ouve
// nem a vê: a página desliga o microfone e a câmera (os caminhos de hoje do clique, e o aviso da câmera ao canal),
// cala o som da reunião (o efeito calar) e para a tela compartilhada; a pessoa continua na reunião. A volta devolve o
// microfone e a câmera como eram na primeira pausa (uma pausa em cima de outra não muda o que ela guardou), e o som; a
// tela compartilhada não volta sozinha. Dentro do app, a pausa chega pelo app (o pausar e o retomar), sem o cartão:
// quem mostra a ligação é o app. No navegador, ela chega pelo canal do colega (a mensagem pausa, com a vez da ligação,
// que o app repete a cada 10 s), e o cartão "Você está numa ligação…" aparece por cima da reunião, com o Voltar para a
// reunião: ele desfaz a pausa ali mesmo, e as repetições daquela vez ficam de fora (a página lembra as últimas
// MAX_VEZES_DESFEITAS). A página dentro do app ignora a pausa do canal, e a de quem é de fora também. O bloqueio da
// sessão do Windows (o bloqueio do app) desliga só a câmera, e a volta de um não desfaz o outro. Na pausa, o
// Microfone, a Câmera e o Compartilhar a tela não fazem nada. A pausa que chega com a página entrando fica guardada e
// vale assim que ela entra; fora da reunião, a pausa não faz nada, e a saída (por qualquer fim) a desfaz.

import { AVISO_SEM_CUIDAR, LISTA_VAZIA, ditoDaResposta, lerLista, tituloDoCartao } from './colega.js';
import { MAX_MENSAGENS, textoLimpo } from './mensagens.js';
import { lerPalco } from './palco.js';

/** O passo da contagem do 429 ("Tentar de novo em <n> s"), em ms. */
export const CONTAGEM_MS = 1000;
/**
 * A espera antes de cada tentativa de voltar à reunião depois da conexão caída, em ms. O religar do canal que caiu na
 * reunião espera o mesmo.
 */
export const RECONECTAR_MS = Object.freeze([2000, 4000, 8000]);
/**
 * A espera de cada tentativa de religar o canal depois das três primeiras, em ms. O religar não desiste: com a ligação
 * no ar, ele tenta de novo a cada 30 s.
 */
export const RELIGAR_DEVAGAR_MS = 30000;
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
/** A espera pelo passe do app depois do pronta, em ms: sem ele, a página abre como quem é de fora. */
export const PRAZO_DO_PASSE_MS = 15000;

const MAX_NOME = 80;
// O nome de um aparelho nas Configurações do app: até 200 caracteres.
const MAX_NOME_DO_APARELHO = 200;
// O passe que o app manda: 43 caracteres base64url (32 bytes).
const PASSE_QUE_VALE = /^[A-Za-z0-9_-]{43}$/;
// Os aparelhos do padrão do sistema: nenhum nome.
const APARELHOS_PADRAO = Object.freeze({ microfone: '', altoFalante: '', camera: '' });
// A faixa do passe que não valeu, no alto da entrada de quem é de fora e da escolha: o leitor de tela a ouve também.
const FAIXA_SEM_COLEGA =
  'Não foi possível reconhecer você como colega. Abra a reunião de novo pelo app, ou entre como convidado.';
// A frase do cartão da pausa que chega pelo canal: o leitor de tela a ouve quando ele aparece.
const FRASE_DA_PAUSA = 'Você está numa ligação no Starsonic Phone. A reunião não ouve nem vê você.';
// A vez da pausa (a ligação no app): de 1 a 32 letras ou números.
const VEZ_QUE_VALE = /^[A-Za-z0-9]{1,32}$/;
// As vezes de pausa que o Voltar para a reunião desfez e que a página lembra: as últimas 8.
const MAX_VEZES_DESFEITAS = 8;
// O motivo do fim que o app recebe, pelo aviso do fim de quem tinha entrado. O saiu é só o do Sair (e o do sair do
// app): o saiu de uma queda é o fora do paraOApp.
const FIM_DO_AVISO = new Map([
  ['tirado', 'tirado'],
  ['encerrada', 'acabou'],
  ['linkInvalido', 'linkInvalido'],
]);

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
// Os alvos do foco do colega: o botão participantes, o título do painel (gente), o primeiro de quem espera (cartao), o
// Encerrar para todos (encerrar) e o Voltar da pergunta dele (naoEncerrar); com o id da linha, o Tirar dela (tirar) e o
// Voltar da pergunta "Tirar <Nome>?" (naoTirar).
const focar = (alvo, id) => (id === undefined ? { tipo: 'focar', alvo } : { tipo: 'focar', alvo, id });
const dizer = (texto) => ({ tipo: 'dizer', texto }); // o que o leitor de tela ouve
const avisarApp = (m) => ({ tipo: 'avisarApp', m }); // a mensagem ao app: o tipo e os campos
const fim = (motivo) => avisarApp({ tipo: 'fim', motivo });

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

// O corpo do abrir que leva à reunião: antes de o passe ter resposta, com o passe; o colega reconhecido abre com a
// chave; quem é de fora, sem corpo. O abrir do voltar nunca leva corpo: a chave de volta é que diz quem é a pessoa.
// (Só dentro do app o colega reconhecido tem um passe: o passe novo que toma o lugar da chave que não valeu.)
function corpoDoAbrir(e) {
  if (e.passe !== null) return { passe: e.passe };
  if (e.colega !== null) return { colega: e.chaveDoColega };
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
    tela: 'carregando', // carregando, escolha, entrada, pedindo, aguardando, naoComecou, entrando, reuniao ou aviso
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
    religando: 0, // a tentativa de religar o canal que caiu na reunião com a ligação no ar, de 0 a 4 (a 4 é a devagar)
    esperandoBilhete: false, // o abrir do voltar saiu, e o abriu ainda não chegou
    vez: 0, // a vez das esperas e dos prazos da volta e do religar: cada espera nova ganha a sua
    abertura: 0, // o número do último abrir
    partida: null, // a partida do servidor do chat no último abrir que não foi o do voltar: muda quando ele reinicia
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
    // A escolha: o navegador está no Windows, e a pessoa já escolheu o navegador nesta página.
    windows: false,
    peloNavegador: false,
    // Na reunião, só para o colega: a lista ({participantes, pedidos}), o painel Participantes aberto, o id de quem
    // tem a pergunta "Tirar <Nome>?" à vista, a pergunta do Encerrar para todos à vista, a reunião cheia no último
    // aceitar, e as respostas da página que esperam o feito ({de, id, nome}), para o leitor de tela.
    lista: LISTA_VAZIA,
    gente: false,
    tirando: null,
    encerrando: false,
    cheiaAoAceitar: false,
    respondendo: Object.freeze([]),
    semCuidar: false, // o colega continua na reunião, mas o canal dele não volta mais: o aviso está à vista
    // A entrada de novo sozinha, dentro do app: passe (o pronta saiu), abrindo (o abrir com o passe saiu, ou o canal
    // abre) ou entrando (o entrar saiu); fora dela, null.
    reentrando: null,
    queda: false, // o aviso saiu veio de uma queda, e não do Sair
    // O app: a página está no iframe dele, os nomes dos aparelhos das Configurações dele ({microfone, altoFalante,
    // camera}, vazio é o padrão do sistema), o pronta que espera o passe, o número do último pronta (o prazo de um
    // pronta que passou fica de fora) e o passe anterior que não valeu (o seguinte que não vale leva à entrada de quem
    // é de fora).
    noApp: false,
    aparelhos: APARELHOS_PADRAO,
    esperandoPasse: false,
    prontas: 0,
    passeRecusado: false,
    // A pausa: a de agora ({origem: 'app' ou 'canal', vez, mic, cam}, com o microfone e a câmera de antes dela; a vez
    // é null na do app), a que chegou com a página entrando ({origem, vez}), as últimas vezes desfeitas pelo Voltar
    // para a reunião, e o bloqueio da sessão do Windows ({cam}, a câmera de antes dele). O cameraDeNovo: a câmera
    // mudou com uma troca dela no caminho, e outra troca a acerta quando aquela responder.
    pausa: null,
    pausaPendente: null,
    vezesDesfeitas: Object.freeze([]),
    bloqueio: null,
    cameraDeNovo: false,
  };
}

/** Um passo: devolve {estado, efeitos}, sem mudar o estado recebido. */
export function transicao(estado, evento) {
  let r;
  switch (evento.tipo) {
    case 'comecar':
      r = estado.tela === 'carregando' ? comecar(estado, evento) : nada(estado);
      break;
    case 'app':
      r = estado.noApp ? doApp(estado, evento.m ?? {}) : nada(estado);
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
  // O som da reunião cala com a pausa e volta sem ela, por qualquer caminho (também a saída).
  if (calado(estado) !== calado(r.estado)) r.efeitos.push({ tipo: 'calar', calado: calado(r.estado) });
  // A tela nova, ou o aviso novo, leva o foco ao título dela.
  if (r.estado.tela !== estado.tela || r.estado.aviso !== estado.aviso) r.efeitos.push(FOCAR);
  // O leitor de tela ouve a faixa do passe que não valeu quando ela aparece.
  if (aFaixaAparece(estado, r.estado)) r.efeitos.push(dizer(FAIXA_SEM_COLEGA));
  // O fim de quem tinha entrado, pelo aviso, vai ao app: o app fecha a vista.
  const motivo = r.estado.aviso !== estado.aviso ? FIM_DO_AVISO.get(r.estado.aviso) : undefined;
  if (r.estado.noApp && estado.aceito && r.estado.tela === 'aviso' && motivo) r.efeitos.push(fim(motivo));
  // O leitor de tela ouve a frase do cartão da pausa quando ele aparece.
  if (!comOCartaoDaPausa(estado) && comOCartaoDaPausa(r.estado)) r.efeitos.push(dizer(FRASE_DA_PAUSA));
  return r;
}

// A faixa do passe que não valeu está à vista: a da entrada de quem é de fora e a da escolha.
const comAFaixa = (e) => e.semColega && (e.tela === 'entrada' || e.tela === 'escolha');
// Ela aparece pela primeira vez: o passe acabou de não valer, ou a tela que a mostra chegou depois do carregar. A
// entrada que volta (o Desistir) e a escolha que dá lugar à entrada não a dizem de novo.
const aFaixaAparece = (antes, depois) =>
  !comAFaixa(antes) && comAFaixa(depois) && (!antes.semColega || antes.tela === 'carregando');

// O começo. No navegador, o passe que a página recebeu no endereço, se houver, vai no primeiro abrir; e se o navegador
// está no Windows. Dentro do app, a página pede o passe ao app, e não abre nada antes dele: o passe do endereço não
// vale ali.
function comecar(e, { passe, windows, noApp }) {
  const noWindows = windows === true;
  if (noApp === true) return pedirOPasse(e, { noApp: true, windows: noWindows });
  return comAbrir(e, { passe: typeof passe === 'string' && passe !== '' ? passe : null, windows: noWindows });
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
  // O deixou de cuidar é da tela da reunião: a próxima entrada começa sem ele.
  if (f.tela !== 'reuniao' && f.semCuidar) f = { ...f, semCuidar: false };
  // A entrada de novo sozinha também: a saída (a pessoa saiu, a ligação caiu) a interrompe, e o passe que ela esperava
  // é esquecido, para o prazo dele não levar ninguém à entrada de quem é de fora.
  if (f.tela !== 'reuniao' && f.reentrando !== null) f = { ...f, reentrando: null, esperandoPasse: false };
  // A pausa e o bloqueio são da tela da reunião; a pausa guardada, também da tela entrando. O microfone e a câmera
  // ficam como a pausa os deixou: a próxima entrada começa com eles desligados.
  if (f.tela !== 'reuniao' && (f.pausa !== null || f.bloqueio !== null)) f = { ...f, pausa: null, bloqueio: null };
  if (f.tela !== 'reuniao' && f.tela !== 'entrando' && f.pausaPendente !== null) f = { ...f, pausaPendente: null };
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

// O abriu do carregar dá o cabeçalho e pede a mídia; no Windows, quem a página não reconheceu vai antes à escolha,
// sem a mídia. O do pedido abre o canal com o bilhete novo, que não fica no estado. O do voltar também abre o canal, e
// só: na reunião, ele não leva à entrada nem pede a mídia.
function abriu(e, { reuniao, bilhete, colega, partida }) {
  // A partida que a resposta traz; sem ela (um servidor de antes dela), fica a que a página tem.
  const dela = typeof partida === 'string' ? { partida } : {};
  if (e.tela === 'carregando') {
    const f = { ...e, reuniao, ...dela, ...reconhecido(e, colega) };
    if (vaiAEscolha(f)) return com(f, { tela: 'escolha' });
    return com(f, { tela: 'entrada', esperandoMidia: true }, PEDIR_MIDIA);
  }
  if (esperaOAbrir(e) && e.passe !== null) {
    // O passe novo do app, no lugar da chave que não valeu: a chave nova, e o canal de colega. Sem o colega na
    // resposta, a página segue como quem é de fora, e o bilhete não serve.
    const r = reconhecido(e, colega);
    if (r.semColega) return com(e, { ...r, reuniao, ...dela, colega: null, chaveDoColega: null, tela: 'entrada' });
    return com(e, { reuniao, ...dela, canal: 'abrindo', ...r }, abrirCanal(bilhete));
  }
  if (esperaOAbrir(e)) {
    // O abrir com a chave responde o colega de novo, sem a chave: o nome e o valeAte de agora.
    const deAgora = e.colega !== null && colegaQueVale(colega) ? { colega: colegaDaResposta(colega) } : {};
    return com(e, { reuniao, ...dela, canal: 'abrindo', ...deAgora }, abrirCanal(bilhete));
  }
  if (e.reentrando === 'abrindo' && e.canal === 'fechado') {
    // O abrir com o passe da entrada de novo: o colega reconhecido abre um canal de colega novo; sem ele, não há volta.
    const r = reconhecido(e, colega);
    if (r.colega === undefined) return deixarDeCuidar({ ...e, ...dela });
    return com(e, { ...dela, ...r, canal: 'abrindo' }, abrirCanal(bilhete));
  }
  if (e.esperandoBilhete) {
    if (reiniciou(e, partida)) return chatReiniciou(e, partida);
    return com(e, { esperandoBilhete: false, canal: 'abrindo' }, abrirCanal(bilhete));
  }
  return nada(e);
}

// O abrir do voltar respondeu com outra partida: o chat reiniciou desde o último abrir. Sem a partida, na resposta ou
// no estado (um servidor de antes dela), nada se sabe, e o voltar segue.
const reiniciou = (e, partida) => typeof partida === 'string' && e.partida !== null && partida !== e.partida;

// O chat reiniciou e não conhece mais a chave de volta: o bilhete não é usado, e a chave sai. Na volta depois da
// conexão caída, a pessoa saiu; com a ligação no ar, o colega entra de novo sozinho dentro do app e, no navegador,
// deixa de cuidar da reunião; quem é de fora segue sem o canal.
function chatReiniciou(e, partida) {
  const f = { ...e, esperandoBilhete: false, chave: null, partida };
  if (e.reconectando > 0) return terminar(f, 'saiu');
  if (e.colega !== null && e.principal === 'noAr') return e.noApp ? reentrar(f) : deixarDeCuidar(f);
  return pararDeReligar(f);
}

// A escolha aparece no Windows, para quem a página não reconheceu, fora da reunião de teste e do app, e só até a pessoa
// escolher o navegador.
const vaiAEscolha = (e) =>
  e.windows && !e.noApp && e.colega === null && e.reuniao?.tipo !== 'teste' && !e.peloNavegador;

// O colega que a resposta do abrir traz: o nome, e o valeAte, que é um número ou null.
const colegaQueVale = (c) => c !== null && typeof c === 'object' && typeof c.nome === 'string';
const colegaDaResposta = (c) => ({ nome: c.nome, valeAte: numero(c.valeAte) ? c.valeAte : null });

// O que o abriu do carregar diz do passe: o colega reconhecido, com a chave que vale daqui em diante, ou o passe que
// não valeu. Sem o passe, nada: quem é de fora.
function reconhecido(e, colega) {
  if (e.passe === null) return {};
  if (colegaQueVale(colega) && typeof colega.chave === 'string' && colega.chave !== '') {
    return { colega: colegaDaResposta(colega), chaveDoColega: colega.chave, passe: null, passeRecusado: false };
  }
  return { passe: null, semColega: true };
}

// O 404 é o link que não vale; o 429 conta até poder tentar de novo; o resto (a rede, o 5xx) é o semServidor. No abrir
// do voltar, o 404 é a reunião que deixou de valer, e o resto é uma tentativa que falhou, sem o aviso tentativas.
// O passe (ou a chave do colega) que não vale segue como quem é de fora (o comoDeFora). Dentro do app, o primeiro que
// não vale pede outro passe ao app, na mesma tela; o nome do colega fica para a tela entrando.
function abrirFalhou(e, { status, esperarSegundos, passe }) {
  if (e.esperandoBilhete) {
    const f = { ...e, esperandoBilhete: false };
    return status === 404 ? linkInvalidoDoVoltar(f) : voltarFalhou(f);
  }
  if (e.reentrando === 'abrindo' && e.canal === 'fechado') {
    // Na entrada de novo, o primeiro passe que não vale pede outro, como na entrada; o resto não tem volta.
    if (passe === true && !e.passeRecusado) {
      return pedirOPasse(e, { passe: null, passeRecusado: true, reentrando: 'passe' });
    }
    return deixarDeCuidar(e);
  }
  if (e.tela !== 'carregando' && !esperaOAbrir(e)) return nada(e);
  if (passe === true && corpoDoAbrir(e) !== null) {
    if (e.noApp && !e.passeRecusado) return pedirOPasse(e, { chaveDoColega: null, passe: null, passeRecusado: true });
    return comoDeFora(e);
  }
  // O link que não vale é o fim: o passe que o primeiro abrir levava sai do estado.
  if (status === 404) return terminar({ ...e, passe: null }, 'linkInvalido');
  if (status !== 429) return avisar(e, 'semServidor');
  const n = Math.max(0, Math.ceil(Number(esperarSegundos) || 0));
  if (n === 0) return avisar(e, 'tentativas');
  return avisar(e, 'tentativas', { esperarSegundos: n }, esperar(CONTAGEM_MS, 'contagem'));
}

// O canal abriu: o do pedido manda o nome (o do colega, o entrar); o do voltar, depois do aceito, manda a chave e
// espera o voltou. O da entrada de novo manda o entrar, e fica voltando até o aceito: ainda não é o da pessoa.
function canalAbriu(e) {
  if (!e.aceito) return com(e, { canal: 'aberto' }, pedidoOuEntrar(e));
  if (e.reentrando === 'abrindo') return com(e, { canal: 'voltando', reentrando: 'entrando' }, ENTRAR);
  return com(e, { canal: 'voltando' }, mandar({ tipo: 'voltar', ...e.chave }));
}

// Na espera, o pedido sai com o canal: o 1011 (um erro do servidor) abre de novo sozinho, até 3 vezes, e o resto é o
// semServidor. Depois do aceito, o canal que cai não tira ninguém da reunião. O do voltar, que caiu antes do voltou, é
// uma tentativa que falhou, e o que esperava uma senha por ele (para entrar, ou para voltar) não a tem mais. Com a
// chave, ele volta: na próxima tentativa da volta, ou por trás, com a ligação no ar (o religar).
function canalFechou(e, codigo) {
  if (e.canal === 'fechado') return nada(e); // o que a página fechou
  // As respostas que esperavam o feito não o recebem mais por este canal.
  const f = { ...e, canal: 'fechado', respondendo: e.respondendo.length > 0 ? Object.freeze([]) : e.respondendo };
  if (naEspera(e)) {
    if (codigo === 1011 && e.reabrindo < MAX_REABRIR) {
      return com(f, { reabrindo: e.reabrindo + 1 }, esperar(REABRIR_MS, 'reabrir'));
    }
    return avisar(f, 'semServidor');
  }
  if (e.reentrando !== null) return deixarDeCuidar(f); // o canal da entrada de novo
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
    case 'feito':
      return feito(e, m);
    case 'pausa':
      return pausaDoCanal(e, m);
    default:
      return nada(e);
  }
}

// ---- O app ----

// O pronta: a página pede um passe ao app, e espera por ele até PRAZO_DO_PASSE_MS (o tempo com o número deste pronta).
function pedirOPasse(e, mudancas = {}) {
  const prontas = e.prontas + 1;
  return com(
    e,
    { ...mudancas, esperandoPasse: true, prontas },
    avisarApp({ tipo: 'pronta' }),
    esperar(PRAZO_DO_PASSE_MS, `passe:${prontas}`),
  );
}

// O passe que não valeu, ou que o app não mandou a tempo: a página segue como quem é de fora, com a faixa, e nunca
// tenta de novo como colega. No carregar, um abrir sem corpo; no Entrar, a entrada de quem é de fora, com o cabeçalho
// que a página já tem; em outra tela (a pessoa saiu enquanto o app não respondia), só o estado.
function comoDeFora(e) {
  const semColega = { colega: null, chaveDoColega: null, passe: null, semColega: true, esperandoPasse: false };
  if (e.tela === 'carregando') return comAbrir(e, semColega);
  if (esperaOAbrir(e)) return com(e, { ...semColega, tela: 'entrada' });
  return com(e, semColega);
}

// As mensagens do app (o app.js já conferiu a origem, o starsonic e o tipo). O pausar, o retomar e o bloqueio são da
// pausa.
function doApp(e, m) {
  switch (m.tipo) {
    case 'passe':
      return passeDoApp(e, m);
    case 'aparelhos':
      return trocarAparelhos(e, lerAparelhos(m.aparelhos));
    case 'sair':
      return sairPeloApp(e);
    case 'pausar':
      return pausar(e, 'app', null);
    case 'retomar':
      return retomar(e, 'app');
    case 'bloqueio':
      return bloquear(e, m.ligado);
    default:
      return nada(e);
  }
}

// O passe que o app mandou, com os aparelhos, só em resposta a um pronta. O carregar e o Entrar que o esperavam abrem
// com ele; em outra tela (a pessoa saiu enquanto ele vinha), o próximo abrir o leva.
// Na entrada de novo, o abrir sai já, e o prazo dele (numa vez nova) vale até o aceito.
function passeDoApp(e, m) {
  if (!e.esperandoPasse || typeof m.passe !== 'string' || !PASSE_QUE_VALE.test(m.passe)) return nada(e);
  const mudancas = { passe: m.passe, aparelhos: lerAparelhos(m.aparelhos), esperandoPasse: false };
  if (e.reentrando === 'passe') {
    const vez = e.vez + 1;
    const r = comAbrir(e, { ...mudancas, reentrando: 'abrindo', vez });
    return so(r.estado, ...r.efeitos, prazoDaVez(vez));
  }
  return e.tela === 'carregando' || esperaOAbrir(e) ? comAbrir(e, mudancas) : com(e, mudancas);
}

// Os nomes dos aparelhos que o app manda: um objeto com o microfone, o altoFalante e a camera. Um nome que não é um
// texto de até 200 caracteres conta como o que falta, o padrão do sistema ('') para aquele aparelho; os aparelhos que
// faltam ou não são um objeto contam como {}. Um nome ruim nunca joga fora a mensagem, e muito menos o passe.
function lerAparelhos(a) {
  const objeto = a !== null && typeof a === 'object' && !Array.isArray(a) ? a : {};
  const lidos = {};
  for (const campo of Object.keys(APARELHOS_PADRAO)) {
    const nome = objeto[campo];
    lidos[campo] = typeof nome === 'string' && [...nome].length <= MAX_NOME_DO_APARELHO ? nome : '';
  }
  return lidos;
}

// A pessoa trocou um aparelho nas Configurações do app. Na entrada, a câmera e o microfone são pedidos de novo, para a
// prévia; na reunião, com a ligação no ar, a ligação troca o microfone (que continua como estava) e a câmera ligada,
// uma troca da câmera de cada vez. Nos outros casos, só os nomes mudam: o próximo pedido os usa. O alto-falante é do
// desenho (o setSinkId do som).
function trocarAparelhos(e, novos) {
  const antes = e.aparelhos;
  const outroMic = novos.microfone !== antes.microfone;
  const outraCam = novos.camera !== antes.camera;
  if (!outroMic && !outraCam && novos.altoFalante === antes.altoFalante) return nada(e);
  const mudancas = { aparelhos: novos };
  if (e.tela === 'entrada' && (outroMic || outraCam)) {
    return com(e, { ...mudancas, esperandoMidia: true }, PEDIR_MIDIA);
  }
  if (e.tela !== 'reuniao' || e.principal !== 'noAr') return com(e, mudancas);
  const efeitos = [];
  if (outroMic && e.mic !== 'indisponivel') {
    efeitos.push({ tipo: 'trocarMicrofone', ligado: e.mic === 'ligado', nome: novos.microfone });
  }
  if (outraCam && e.cam === 'ligado' && !e.trocandoCamera) {
    mudancas.trocandoCamera = true;
    efeitos.push({ tipo: 'trocarCamera', ligada: true, nome: novos.camera });
  }
  return com(e, mudancas, ...efeitos);
}

// O sair do app: a pessoa confirmou o fechar. Na reunião e entrando, o Sair de hoje; na espera, o Desistir; antes
// disso, nada a desfazer. O fim responde sempre: sem ele, o app espera 2 s para fechar a vista.
function sairPeloApp(e) {
  if (e.tela === 'reuniao' || e.tela === 'entrando') return sair(e);
  const r = ESPERA.has(e.tela) ? desistir(e) : nada(e);
  return so(r.estado, ...r.efeitos, fim('saiu'));
}

/** O que o app sabe da página: {fase, microfone}, ou null enquanto ela carrega. O microfone é o que os outros ouvem. */
export function paraOApp(estado) {
  if (estado.tela === 'carregando') return null;
  let fase = 'entrada';
  if (estado.tela === 'reuniao') fase = 'naReuniao';
  else if (estado.tela === 'aviso' && estado.aviso === 'saiu' && estado.queda) fase = 'fora';
  return { fase, microfone: estado.mic === 'ligado' };
}

// ---- A pausa ----

// O som da reunião está calado: a pausa vale.
const calado = (e) => e.pausa !== null;
// O cartão "Você está numa ligação…" está à vista: o da pausa que chegou pelo canal, na tela da reunião.
const comOCartaoDaPausa = (e) => e.tela === 'reuniao' && e.pausa?.origem === 'canal';
// A câmera está presa desligada: pela pausa ou pelo bloqueio.
const cameraPresa = (e) => e.pausa !== null || e.bloqueio !== null;
// O aparelho desligado pela pausa (o que falta continua faltando), e o devolvido por ela: só o que ela desligou.
const desligado = (v) => (v === 'ligado' ? 'desligado' : v);
const devolvido = (agora, antes) => (antes === 'ligado' && agora === 'desligado' ? 'ligado' : agora);

// O microfone e a câmera vão ao que a pausa (ou o bloqueio) pede, pelos caminhos do clique: com a ligação principal
// no ar, ela troca junto, uma troca da câmera de cada vez (com uma no caminho, a câmera é acertada quando ela
// responder: o cameraDeNovo). Com a ligação da volta subindo, o microfone vai a ela também (o mute dela, que o
// re-INVITE não desfaz), e a câmera fica com o fluxo, que o midia.js acerta. Sem a ligação, só o estado muda: o ligar
// da volta lê o fluxo. Devolve as mudanças e os efeitos.
function levarAMidia(e, mic, cam) {
  const mudancas = {};
  const efeitos = [];
  if (mic !== e.mic) {
    mudancas.mic = mic;
    if (e.principal === 'noAr' || e.principal === 'ligando') {
      efeitos.push({ tipo: 'trocarMicrofone', ligado: mic === 'ligado' });
    }
  }
  if (cam !== e.cam) {
    mudancas.cam = cam;
    if (e.principal === 'noAr' && e.trocandoCamera) mudancas.cameraDeNovo = true;
    else if (e.principal === 'noAr') {
      mudancas.trocandoCamera = true;
      efeitos.push({ tipo: 'trocarCamera', ligada: cam === 'ligado' });
    }
  }
  return { mudancas, efeitos };
}

// A pausa pedida (pelo app, ou pelo canal com a vez). Na tela entrando, ela fica guardada para quando a página entrar;
// fora da reunião, nada. Em cima de outra, ela só troca a vez (a ligação nova no app): o que a primeira guardou fica.
function pausar(e, origem, vez) {
  if (e.tela === 'entrando') {
    const igual = e.pausaPendente?.origem === origem && e.pausaPendente.vez === vez;
    return igual ? nada(e) : com(e, { pausaPendente: { origem, vez } });
  }
  if (e.tela !== 'reuniao') return nada(e);
  if (e.pausa !== null) return e.pausa.vez === vez ? nada(e) : com(e, { pausa: { ...e.pausa, vez } });
  return comecarAPausa(e, origem, vez);
}

// A pausa começa: ela guarda o microfone e a câmera de agora (a câmera de antes do bloqueio, se houver), desliga os
// dois e para a tela compartilhada (o Parar de compartilhar de hoje). O aviso da câmera e o calar nascem no fim da
// transicao.
function comecarAPausa(e, origem, vez) {
  const pausa = { origem, vez, mic: e.mic, cam: e.bloqueio?.cam ?? e.cam };
  const midia = levarAMidia(e, desligado(e.mic), desligado(e.cam));
  const tela = pararDeCompartilhar({ ...e, ...midia.mudancas });
  return com(tela.estado, { pausa, pausaPendente: null }, ...midia.efeitos, ...tela.efeitos);
}

// O retomar do app, ou o pausada falso do canal: a pausa daquela origem acaba (ou a guardada é apagada).
function retomar(e, origem) {
  if (e.pausaPendente?.origem === origem) return com(e, { pausaPendente: null });
  return e.pausa?.origem === origem ? acabarAPausa(e) : nada(e);
}

// A pausa acaba: o microfone e a câmera voltam como eram (a câmera, só sem o bloqueio), e o som volta. A tela
// compartilhada não volta.
function acabarAPausa(e, mudancas = {}) {
  const { mic, cam } = e.pausa;
  const midia = levarAMidia(e, devolvido(e.mic, mic), e.bloqueio === null ? devolvido(e.cam, cam) : e.cam);
  return com(e, { ...midia.mudancas, ...mudancas, pausa: null }, ...midia.efeitos);
}

// A mensagem pausa do canal (seção 10 do protocolo): só a página do colega no navegador a segue. A vez que o Voltar
// para a reunião desfez não pausa de novo.
function pausaDoCanal(e, { pausada, vez }) {
  if (e.colega === null || e.noApp || typeof pausada !== 'boolean') return nada(e);
  if (typeof vez !== 'string' || !VEZ_QUE_VALE.test(vez)) return nada(e);
  if (!pausada) return retomar(e, 'canal');
  return e.vezesDesfeitas.includes(vez) ? nada(e) : pausar(e, 'canal', vez);
}

// O Voltar para a reunião do cartão: a pausa do canal acaba ali mesmo (a ligação no app continua), e a vez dela fica
// lembrada, para as repetições.
function voltarDaPausa(e) {
  if (e.tela !== 'reuniao' || e.pausa?.origem !== 'canal') return nada(e);
  const vezesDesfeitas = [...e.vezesDesfeitas, e.pausa.vez].slice(-MAX_VEZES_DESFEITAS);
  return acabarAPausa(e, { vezesDesfeitas });
}

// O bloqueio da sessão do Windows, na reunião: ligado, a câmera desliga; desligado, ela volta como era, se a pausa
// não a segurar. O ligado que não é um sim ou não fica de fora.
function bloquear(e, ligado) {
  if (typeof ligado !== 'boolean' || e.tela !== 'reuniao') return nada(e);
  if (ligado) {
    if (e.bloqueio !== null) return nada(e);
    const midia = levarAMidia(e, e.mic, desligado(e.cam));
    return com(e, { ...midia.mudancas, bloqueio: { cam: e.pausa?.cam ?? e.cam } }, ...midia.efeitos);
  }
  if (e.bloqueio === null) return nada(e);
  const midia = levarAMidia(e, e.mic, e.pausa === null ? devolvido(e.cam, e.bloqueio.cam) : e.cam);
  return com(e, { ...midia.mudancas, bloqueio: null }, ...midia.efeitos);
}

// A página entrou na reunião (o confirmada da principal): a pausa guardada vale agora.
function comAPausaGuardada(r) {
  const { pausaPendente } = r.estado;
  if (pausaPendente === null || r.estado.tela !== 'reuniao') return r;
  const p = comecarAPausa(r.estado, pausaPendente.origem, pausaPendente.vez);
  return so(p.estado, ...r.efeitos, ...p.efeitos);
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
/** O colega pode responder (aceitar, recusar, tirar e encerrar): o canal da pessoa aberto, na tela da reunião. */
export function podeResponder(estado) {
  return estado.colega !== null && podeEscrever(estado);
}
// A lista inteira chegou (a mensagem participantes): ela toma o lugar da anterior. Ela não diz o resultado das
// respostas da página: o pedido que sai dela pode ter sido respondido por outro colega, e quem diz que a resposta deu
// certo é o feito. O pedido que a lista anterior não tinha, o leitor de tela ouve que chegou. Tudo o que a lista diz
// sai num dizer só, os textos na ordem: a região que o leitor de tela ouve guarda um texto de cada vez, e dois dizer no
// mesmo passo deixariam só o último. A pergunta do Tirar de quem já saiu se desfaz, e a reunião cheia do último aceitar
// sai.
function lista(e, m) {
  if (!colegaNaReuniao(e)) return nada(e);
  const nova = lerLista(m);
  if (nova === null) return nada(e);
  const ditos = [];
  for (const p of nova.pedidos) {
    // O que o leitor de tela ouve quando um pedido chega é o título do cartão dele sozinho: "<Nome> quer entrar".
    if (!e.lista.pedidos.some((x) => x.id === p.id)) ditos.push(tituloDoCartao([p]));
  }
  const tirando = nova.participantes.some((x) => x.id === e.tirando) ? e.tirando : null;
  const efeitos = ditos.length > 0 ? [dizer(ditos.join('. '))] : [];
  return com(e, { lista: nova, tirando, cheiaAoAceitar: false }, ...efeitos);
}

// O servidor confirma que uma resposta da página deu certo (o feito, com o de e o id): o leitor de tela ouve o
// resultado, e a resposta não espera mais. O feito sem a resposta esperando (o de outro tipo, de outro pedido, ou de um
// canal que já caiu) não diz nada.
function feito(e, { de, id }) {
  if (!colegaNaReuniao(e)) return nada(e);
  const r = e.respondendo.find((x) => x.de === de && x.id === id);
  if (!r) return nada(e);
  return com(e, { respondendo: e.respondendo.filter((x) => x !== r) }, dizer(ditoDaResposta(de, r.nome)));
}

// Uma resposta da página não deu certo (o recusa, com o de e o motivo): ela não espera mais a lista, e o resultado
// dela não é dito. O servidor responde na ordem em que recebe: a recusa é da mais antiga daquele tipo. A reunião cheia
// aparece no cartão e no painel, e o leitor de tela a ouve; o servidor de vídeo fora do ar, no aviso curto. Os outros
// motivos (a resposta de outro colega chegou antes, a pessoa já saiu, ou a página não está mais na reunião para o chat)
// não mostram nada: a lista nova diz.
function recusa(e, { de, motivo }) {
  if (!colegaNaReuniao(e)) return nada(e);
  const i = e.respondendo.findIndex((r) => r.de === de);
  const mudancas = i < 0 ? {} : { respondendo: e.respondendo.filter((_, j) => j !== i) };
  if (motivo === 'cheia' && de === 'aceitar') {
    return com(e, { ...mudancas, cheiaAoAceitar: true }, dizer('A reunião está cheia: ninguém mais entra agora.'));
  }
  if (motivo === 'servidorVideo' && e.tela === 'reuniao') return avisoDoServidor(e, mudancas);
  return i < 0 ? nada(e) : com(e, mudancas);
}

// O aviso curto do servidor de reuniões, que o leitor de tela ouve: o da recusa servidorVideo, e o da resposta que não
// sai.
function avisoDoServidor(e, mudancas) {
  const aviso = e.avisos + 1;
  return com(
    e,
    { ...mudancas, avisos: aviso, avisoCurto: { n: aviso, tipo: 'servidor' } },
    esperar(AVISO_CURTO_MS, `avisoCurto:${aviso}`),
    dizer('O servidor de reuniões não respondeu'),
  );
}

// Uma resposta sai pelo canal e espera o feito: {de, id, nome}. Responder de novo tira a reunião cheia. A resposta que
// já espera, com o mesmo de e o mesmo id, não sai de novo (outra resposta ao mesmo pedido sai: o servidor decide). Sem
// o canal da pessoa (o religar em curso), nada sai: é como a recusa servidorVideo, com o aviso curto do servidor, e a
// pergunta que a resposta fecharia fecha do mesmo jeito.
function responder(e, de, id, nome, m, mudancas = {}) {
  if (!podeResponder(e)) return avisoDoServidor(e, mudancas);
  if (e.respondendo.some((r) => r.de === de && r.id === id)) return com(e, mudancas);
  const respondendo = [...e.respondendo, { de, id, nome }];
  return com(e, { ...mudancas, respondendo, cheiaAoAceitar: false }, mandar(m));
}

// Os cliques do colega na reunião. O painel Participantes fica no lugar do chat: abrir um fecha o outro. O Tirar e o
// Encerrar para todos pedem o segundo clique, e a pergunta de cada um leva o foco ao Voltar dela, a escolha que não
// muda nada. Quem é de fora não tem nada disso.
function cliqueDoColega(e, botao, id) {
  if (e.colega === null || e.tela !== 'reuniao') return nada(e);
  const comPainel = { gente: true, chat: { ...e.chat, aberto: false } };
  switch (botao) {
    case 'participantes':
      // O botão abre e fecha: aberto, o foco vai ao título do painel; ao fechar por ele, o foco já está nele.
      return e.gente ? com(e, { gente: false }) : com(e, comPainel, focar('gente'));
    case 'fecharParticipantes':
      // O fechar do painel (o botão dele e o Esc) devolve o foco ao botão Participantes.
      return e.gente ? com(e, { gente: false }, focar('participantes')) : nada(e);
    case 'verPedidos':
      // O Ver os pedidos do cartão abre o painel, com o foco no cartão de quem espera.
      return com(e, comPainel, focar('cartao'));
    case 'aceitar':
    case 'recusar': {
      const p = e.lista.pedidos.find((x) => x.id === id);
      if (!p || !e.aceito) return nada(e);
      return responder(e, botao, p.id, p.nome, { tipo: botao, pedido: p.id });
    }
    case 'tirar': {
      const p = e.lista.participantes.find((x) => x.id === id);
      return p && !p.voce ? com(e, { tirando: p.id }, focar('naoTirar', p.id)) : nada(e);
    }
    case 'tirarMesmo': {
      const p = e.lista.participantes.find((x) => x.id === id);
      if (!p || e.tirando !== p.id || !e.aceito) return nada(e);
      return responder(e, 'tirar', p.id, p.nome, { tipo: 'tirar', participante: p.id }, { tirando: null });
    }
    case 'naoTirar':
      // O Voltar da pergunta devolve o foco ao Tirar daquela linha.
      return e.tirando !== null ? com(e, { tirando: null }, focar('tirar', e.tirando)) : nada(e);
    case 'encerrar':
      // Quem deixou de cuidar da reunião não a encerra, e, antes de a primeira lista chegar, a pergunta não teria
      // quantas pessoas saem: ela não abre.
      if (e.encerrando || e.semCuidar || e.lista.participantes.length === 0) return nada(e);
      return com(e, { encerrando: true }, focar('naoEncerrar'));
    case 'encerrarMesmo':
      // O encerrar não espera resposta na lista: o encerrada é o fim, e a recusa mostra o aviso. Sem o canal, o aviso
      // vem na hora, como o da recusa.
      if (!e.encerrando || !e.aceito) return nada(e);
      if (!podeResponder(e)) return avisoDoServidor(e, { encerrando: false });
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
  if (e.reentrando === 'entrando') return respostaDoEntrar(e, m);
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

// A resposta ao entrar da entrada de novo, no canal novo. A recusa não tem volta: o canal fecha, e o colega deixa de
// cuidar da reunião.
function respostaDoEntrar(e, m) {
  switch (m.tipo) {
    case 'aceito':
      return entrouDeNovo(e, m);
    case 'cheia':
    case 'servidorCheio':
    case 'semServidor':
    case 'linkInvalido':
    case 'erro':
      return deixarDeCuidar(e);
    default:
      return nada(e);
  }
}

// O aceito da entrada de novo: o canal novo é o da pessoa, com o acesso e a chave de volta novos, e a ligação é
// trocada pela volta de hoje: as duas descem, e a espera leva à senha nova e ao ligar. A senha do aceito não é usada.
function entrouDeNovo(e, m) {
  const { mudancas, efeitos } = desligarAsDuas(e);
  const { vez, espera } = esperaNova(e, 'reconectar', RECONECTAR_MS[0]);
  const novos = { canal: 'aberto', acesso: { turn: m.turn, video: m.video }, chave: chaveDe(m.participante, m.volta) };
  return com(e, { ...mudancas, ...novos, reentrando: null, reconectando: 1, religando: 0, vez }, ...efeitos, espera);
}

// O voltou: o canal é de novo o da pessoa, com a chave nova. Na volta depois da conexão caída, a tentativa segue com o
// senha; no religar, ele acabou.
function voltou(e, volta) {
  const mudancas = { canal: 'aberto', chave: chaveDe(e.chave.participante, volta) };
  if (e.reconectando > 0) return com(e, { ...mudancas, principal: 'pedindo' }, mandar({ tipo: 'senha' }));
  return com(e, { ...mudancas, religando: 0 });
}

// A chave recusada sai do estado. Na volta depois da conexão caída, a pessoa saiu; no religar, a reunião segue sem o
// canal (o colega, com a ligação no ar, deixa de cuidar dela), e uma queda da ligação, depois, é o saiu.
function chaveRecusada(e) {
  const f = { ...e, chave: null };
  if (e.reconectando > 0) return terminar(f, 'saiu');
  return e.colega !== null && e.principal === 'noAr' ? deixarDeCuidar(f) : pararDeReligar(f);
}

// O linkInvalido do voltar (a resposta, ou o 404 do abrir dele): a reunião deixou de valer, mas quem já está nela
// continua, mesmo depois do valeAte. Com a ligação no ar, o religar para, a reunião segue sem o canal (o colega deixa
// de cuidar dela), e a ligação decide o fim; a chave fica para a volta das duas. Sem a ligação, é o fim.
function linkInvalidoDoVoltar(e) {
  if (e.principal !== 'noAr') return terminar(e, 'linkInvalido');
  return e.colega !== null ? deixarDeCuidar(e) : pararDeReligar(e);
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
      // O canal que caiu no meio do ligar volta por trás, com a chave. A pausa que chegou com a página entrando vale.
      return comAPausaGuardada(e.canal === 'fechado' && e.chave !== null ? religar(e, mudancas) : com(e, mudancas));
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
    const semTroca = { trocandoCamera: false, cameraDeNovo: false };
    return com(e, { principal: 'nenhuma', ...semTroca }, esperar(FIM_SEM_AVISO_MS, 'fimSemAviso'));
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

// Uma tentativa de religar falhou: a próxima espera mais, e o canal do voltar que ela abriu fecha. O religar não
// desiste: depois da terceira, a reunião segue sem o canal (e sem o palco, que nada mais acerta), e a página tenta de
// novo a cada 30 s, a tentativa devagar, que fica no 4, enquanto a ligação está no ar.
function religarFalhou(e) {
  const { mudancas, efeitos } = fecharCanalDoVoltar(e);
  const devagar = e.religando >= MAX_RECONECTAR;
  const { vez, espera } = esperaNova(e, 'religar', devagar ? RELIGAR_DEVAGAR_MS : RECONECTAR_MS[e.religando]);
  const proxima = Math.min(e.religando + 1, MAX_RECONECTAR + 1);
  const semPalco = proxima > MAX_RECONECTAR ? { palco: null } : {};
  return com(e, { ...mudancas, ...semPalco, religando: proxima, vez }, ...efeitos, espera);
}

// O religar para: o canal do voltar fecha, e a reunião segue sem o canal. O palco sai junto: sem o canal, nada mais o
// acerta, e os quadros voltam ao mosaico inteiro.
function pararDeReligar(e) {
  const { mudancas, efeitos } = fecharCanalDoVoltar(e);
  return com(e, { ...mudancas, religando: 0, palco: null }, ...efeitos);
}

// O que só o canal do colega servia, e que sai com ele: a lista, as respostas que esperavam por ela, as perguntas e o
// palco. O religar para.
const SEM_O_CANAL_DO_COLEGA = Object.freeze({
  lista: LISTA_VAZIA,
  respondendo: Object.freeze([]),
  tirando: null,
  encerrando: false,
  cheiaAoAceitar: false,
  religando: 0,
  palco: null,
});

// O colega deixa de cuidar da reunião: o religar para, como no pararDeReligar, e o que só o canal servia sai com ele.
// A entrada de novo sozinha, se havia uma, acaba, e o passe esperado é esquecido. O leitor de tela ouve o aviso, depois
// do fechar do canal. A ligação segue, e o painel aberto fica aberto.
function deixarDeCuidar(e) {
  const { mudancas, efeitos } = fecharCanalDoVoltar(e);
  const semReentrar = { reentrando: null, esperandoPasse: false, passe: null };
  return com(
    e,
    { ...mudancas, ...SEM_O_CANAL_DO_COLEGA, ...semReentrar, semCuidar: true },
    ...efeitos,
    dizer(AVISO_SEM_CUIDAR),
  );
}

// Dentro do app, o colega entra de novo sozinho: o que só o canal servia sai, como no deixarDeCuidar, mas sem o aviso,
// e a página pede outro passe ao app. O canal já está fechado: o voltar nem saiu.
function reentrar(e) {
  return pedirOPasse(e, { ...SEM_O_CANAL_DO_COLEGA, reentrando: 'passe', passeRecusado: false });
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
  if (e.pausa !== null) return so(e, PARAR_CAPTURA); // na pausa, a tela não vai à reunião
  if (e.principal === 'noAr' && e.canal === 'aberto' && e.telaCompartilhada === 'nenhuma') {
    return com(e, { telaCompartilhada: 'pedindo' }, mandar({ tipo: 'tela' }));
  }
  return so(e, PARAR_CAPTURA);
}

function clique(e, botao, id) {
  switch (botao) {
    case 'peloNavegador':
      // O Entrar pelo navegador da escolha: a entrada de quem é de fora, e a mídia pedida só agora.
      if (e.tela !== 'escolha') return nada(e);
      return com(e, { tela: 'entrada', peloNavegador: true, esperandoMidia: true }, PEDIR_MIDIA);
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
    case 'voltarDaPausa':
      return voltarDaPausa(e);
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
// não o ligou a nada): o Entrar de novo abre outro, com a chave. O saiu do Sair não é uma queda, e dentro do app é o
// fim.
function sair(e) {
  if (e.tela !== 'reuniao' && e.tela !== 'entrando') return nada(e);
  const largar = !e.aceito && e.canal !== 'fechado';
  const r = terminar(largar ? { ...e, canal: 'fechado' } : e, 'saiu');
  const efeitos = largar ? [FECHAR_CANAL, ...r.efeitos] : r.efeitos;
  if (e.noApp) efeitos.push(fim('saiu'));
  // O passe que a página pedia ao app (o da chave que não valeu no Entrar) não serve mais: sem isto, o prazo dele
  // levaria o saiu à entrada de quem é de fora.
  return so({ ...r.estado, queda: false, esperandoPasse: false }, ...efeitos);
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
// Na pausa, nenhum dos dois muda; no bloqueio, a câmera.
function trocar(e, qual) {
  if (e[qual] === 'indisponivel' || e.principal === 'ligando') return nada(e);
  if (e.pausa !== null || (qual === 'cam' && e.bloqueio !== null)) return nada(e);
  const ligado = e[qual] !== 'ligado';
  const mudancas = { [qual]: ligado ? 'ligado' : 'desligado' };
  if (e.principal !== 'noAr') return com(e, mudancas);
  if (qual === 'mic') return com(e, mudancas, { tipo: 'trocarMicrofone', ligado });
  if (e.trocandoCamera) return nada(e);
  return com(e, { ...mudancas, trocandoCamera: true }, { tipo: 'trocarCamera', ligada: ligado });
}

// A resposta à troca da câmera na reunião: a que não deu certo volta a câmera ao que era. Sem troca pendente (fora da
// reunião, ou de uma ligação que já desceu), ela fica de fora.
// A câmera que mudou com esta troca no caminho (o cameraDeNovo) vai a outra troca, com o estado de agora. Com a câmera
// presa pela pausa ou pelo bloqueio, a troca que não deu certo não a acende.
function cameraTrocada(e, ok) {
  if (!e.trocandoCamera) return nada(e);
  if (e.cameraDeNovo) return com(e, { cameraDeNovo: false }, { tipo: 'trocarCamera', ligada: e.cam === 'ligado' });
  if (!ok && cameraPresa(e)) return com(e, { trocandoCamera: false });
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

// A mídia que o navegador deu: o que falta fica indisponível, e o que a pessoa desligou continua desligado; o aparelho
// que o midia não diz (o do microfone trocado que acaba sozinho, que só diz o microfone) fica como estava. Com uma
// senha guardada, o ligar sai agora. Num aviso sem o Tentar de novo (o fim, depois do pararMidia dele), a página não a
// quer mais: ela para logo, sem mudar a escolha da pessoa.
const escolha = (atual, veio) => (veio === undefined || (veio === 'ligado' && atual === 'desligado') ? atual : veio);

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
      // O da entrada de novo vale do abrir até o aceito.
      if (daVezAtual && (e.reentrando === 'abrindo' || e.reentrando === 'entrando')) return deixarDeCuidar(e);
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
    case 'passe':
      // O prazo do último pronta, sem o passe: a página segue como quem é de fora; na entrada de novo, o colega deixa
      // de cuidar da reunião.
      if (!e.esperandoPasse || Number(vez) !== e.prontas) return nada(e);
      return e.reentrando !== null ? deixarDeCuidar(e) : comoDeFora(e);
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
// O Entrar de novo do saiu a pede outra vez. O saiu daqui é o de uma queda: o Sair o corrige.
function terminar(e, aviso) {
  const ligacoes = e.aceito ? desligarAsDuas(e) : { mudancas: {}, efeitos: [] };
  const canal = fecharCanalDoVoltar(e);
  const efeitos = [...ligacoes.efeitos, ...canal.efeitos];
  if (e.tela !== 'carregando') efeitos.push(PARAR_MIDIA);
  return avisar(e, aviso, { ...ligacoes.mudancas, ...canal.mudancas, queda: aviso === 'saiu' }, ...efeitos);
}

// As duas ligações descem de propósito, e a captura da tela, se houver, para junto. A troca da câmera pendente era da
// ligação que desceu.
function desligarAsDuas(e) {
  const efeitos = [desligar('principal'), desligar('tela')];
  if (e.telaCompartilhada !== 'nenhuma') efeitos.push(PARAR_CAPTURA);
  const mudancas = { principal: 'nenhuma', telaCompartilhada: 'nenhuma', trocandoCamera: false, cameraDeNovo: false };
  return { mudancas, efeitos };
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
