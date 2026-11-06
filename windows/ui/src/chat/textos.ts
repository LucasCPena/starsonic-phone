// Os textos do chat, letra por letra: os da seção 10 da spec (docs/superpowers/specs/2026-11-04-starsonic-phone-chat-
// design.md) e os da lista "Os textos novos" do plano da etapa 2. A hora e a prévia da lista, e o título e o texto do
// aviso do Windows, ficam no formato.ts.
import type { AvisoDeGrupo, Membro, Pessoa } from './tipos';

export const CHAT = 'Chat';
export const PROCURAR_CONVERSA = 'Procurar conversa';
export const NOVA_CONVERSA_OU_NOVO_GRUPO = 'Nova conversa ou novo grupo';
export const NOVA_CONVERSA = 'Nova conversa';
export const NOVO_GRUPO = 'Novo grupo';
export const NENHUMA_CONVERSA_AINDA = 'Nenhuma conversa ainda';
export const CONVERSE_COM_OS_COLEGAS = 'Converse com os colegas da sua empresa, mande arquivos e fotos, e monte grupos.';
export const COMECAR_UMA_CONVERSA = 'Começar uma conversa';
export const NENHUMA_CONVERSA_ENCONTRADA = 'Nenhuma conversa encontrada.';
export const SEM_CONEXAO_TENTANDO = 'Sem conexão com o chat. Tentando de novo…';
export const CONECTE_A_SUA_CONTA = 'Conecte a sua conta para usar o chat.';
export const COMPUTADOR_SAIU = 'Este computador saiu do chat. Fale com o suporte da Starsonic.';
export const FECHAR_O_AVISO = 'Fechar o aviso';
export const FOTO = 'Foto';
/** Eu, no começo de uma frase ("Você: <texto>", "Você criou o grupo"). */
export const VOCE = 'Você';

/** O começo do aviso do computador novo; o nome do computador vem depois. */
export const SEU_CHAT_ENTROU_EM = 'Seu chat entrou em outro computador: ';

/** O texto do aviso do Windows do computador novo (o título dele é "Chat") e da faixa da lista. */
export function computadorNovo(nome: string): string {
  return `${SEU_CHAT_ENTROU_EM}${nome}`;
}

/** "1 mensagem não lida" ou "<n> mensagens não lidas". */
export function mensagensNaoLidas(n: number): string {
  return n === 1 ? '1 mensagem não lida' : `${n} mensagens não lidas`;
}

/** O rótulo de leitor de tela da aba: "Chat" sem nenhuma, senão "Chat, <n> mensagens não lidas". */
export function rotuloDaAba(naoLidas: number): string {
  return naoLidas > 0 ? `${CHAT}, ${mensagensNaoLidas(naoLidas)}` : CHAT;
}

/** O nome de uma pessoa: quem saiu do chat ganha " (saiu)". */
export function nomeDaPessoa(p: Pessoa): string {
  return p.saiu ? `${p.nome} (saiu)` : p.nome;
}

// A conversa (os quadros Conversa, Grupo e SemConexao; os nomes de leitor de tela são os dos quadros).
export const VOLTAR_PARA_AS_CONVERSAS = 'Voltar para as conversas';
export const ESCREVA_UMA_MENSAGEM = 'Escreva uma mensagem';
export const ESCREVA_PARA_O_GRUPO = 'Escreva para o grupo';
export const ENVIAR = 'Enviar';
/** No lugar da hora, enquanto a mensagem não chegou ao servidor. */
export const ENVIANDO = 'Enviando…';
export const NAO_ENVIADA = 'Não enviada';
export const TENTAR_DE_NOVO = 'Tentar de novo';

/** "Ramal 2003". */
export function ramalN(ramal: string): string {
  return `Ramal ${ramal}`;
}

/** O Ligar da conversa a dois: "Ligar para Ana Souza, ramal 2003". */
export function ligarPara(nome: string, ramal: string): string {
  return `Ligar para ${nome}, ramal ${ramal}`;
}

/** "1 pessoa" ou "<n> pessoas" (o título da lista dos Membros, e dentro de outros textos). */
export function nPessoas(n: number): string {
  return n === 1 ? '1 pessoa' : `${n} pessoas`;
}

/** A linha de baixo do cabeçalho do grupo: "5 pessoas · ver os membros" (com uma, "1 pessoa", como nos Membros). */
export function pessoasVerOsMembros(n: number): string {
  return `${nPessoas(n)} · ver os membros`;
}

/** O botão do cabeçalho do grupo, que leva aos Membros. */
export function verOsMembrosDoGrupo(grupo: string): string {
  return `Ver os membros do grupo ${grupo}`;
}

/** A lista de mensagens (o `log`): "Mensagens com Ana Souza" ou "Mensagens do grupo Comercial". */
export function mensagensCom(nome: string): string {
  return `Mensagens com ${nome}`;
}

export function mensagensDoGrupo(grupo: string): string {
  return `Mensagens do grupo ${grupo}`;
}

/** O campo de escrever: "Mensagem para Ana Souza" ou "Mensagem para o grupo Comercial". */
export function mensagemPara(nome: string): string {
  return `Mensagem para ${nome}`;
}

export function mensagemParaOGrupo(grupo: string): string {
  return `Mensagem para o grupo ${grupo}`;
}

/** Perto do limite do texto: "Faltam 150". */
export function faltam(n: number): string {
  return `Faltam ${n}`;
}

/** No lugar do campo de escrever, na conversa a dois com quem saiu do chat: "Ana Souza saiu do chat.". */
export function saiuDoChat(nome: string): string {
  return `${nome} saiu do chat.`;
}

/** O texto do aviso do Windows de um arquivo: "Arquivo: Pedido 4471.xlsx" (a foto é "Foto"). */
export function arquivoNoAviso(nome: string): string {
  return `Arquivo: ${nome}`;
}

/** O texto de um aviso de grupo; quem fez ou o alvo sou eu: "Você" no começo, "você" no meio. */
export function textoDoAvisoDeGrupo(aviso: AvisoDeGrupo, euId: number): string {
  const quem = aviso.quem.id === euId ? VOCE : nomeDaPessoa(aviso.quem);
  const alvo = aviso.alvo === null ? '' : aviso.alvo.id === euId ? 'você' : nomeDaPessoa(aviso.alvo);
  switch (aviso.acao) {
    case 'criou':
      return `${quem} criou o grupo`;
    case 'pos':
      return `${quem} pôs ${alvo} no grupo`;
    case 'tirou':
      return `${quem} tirou ${alvo} do grupo`;
    case 'saiu':
      return `${quem} saiu do grupo`;
  }
}

// (Task 5) A nova conversa, o novo grupo, o pôr pessoas e os membros (os quadros NovaConversa, NovoGrupo e Membros; os
// nomes de leitor de tela são os dos quadros; o Voltar do novo grupo e do pôr pessoas é o "Voltar" do BackBar). As
// falhas dos pedidos usam os textos do cartão Chat (R31).
export const VOLTAR_PARA_A_CONVERSA = 'Voltar para a conversa';
export const PROCURAR_PELO_NOME_OU_PELO_RAMAL = 'Procurar pelo nome ou pelo ramal';
/** O nome de leitor de tela da busca da Nova conversa. */
export const PROCURAR_UM_COLEGA = 'Procurar um colega pelo nome ou pelo ramal';
/** O nome de leitor de tela da busca do Novo grupo e do Pôr pessoas. */
export const PROCURAR_UMA_PESSOA = 'Procurar uma pessoa pelo nome ou pelo ramal';
export const COLEGAS_NO_CHAT = 'Colegas no chat';
export const APARECEM_SO_OS_COLEGAS = 'Aparecem só os colegas da sua empresa que já usam o chat.';
export const NENHUM_COLEGA_NO_CHAT = 'Nenhum colega no chat ainda.';
export const NINGUEM_ENCONTRADO = 'Ninguém encontrado.';
export const NOME_DO_GRUPO = 'Nome do grupo';
export const CRIAR_GRUPO = 'Criar grupo';
export const O_GRUPO_JA_TEM_200 = 'O grupo já tem 200 pessoas.';
export const MEMBROS_DO_GRUPO = 'Membros do grupo';
export const VOCE_CUIDA_DESTE_GRUPO = 'Você cuida deste grupo: só você põe e tira pessoas. Quem está no grupo pode sair quando quiser.';
export const TIRAR = 'Tirar';
export const POR_PESSOAS_NO_GRUPO = 'Pôr pessoas no grupo';
export const SAIR_DO_GRUPO = 'Sair do grupo';
/** A confirmação do Sair: o título e o texto (os botões são "Sair do grupo" e "Cancelar"). */
export const SAIR_DO_GRUPO_PERGUNTA = 'Sair do grupo?';
export const PARA_VOLTAR = 'Para voltar, quem cuida do grupo precisa pôr você de novo.';

/** O título da escolha: "Pessoas · 2 escolhidas" (com uma, "Pessoas · 1 escolhida"). */
export function pessoasEscolhidas(n: number): string {
  return `Pessoas · ${n === 1 ? '1 escolhida' : `${n} escolhidas`}`;
}

/** O botão do Novo grupo com alguém escolhido: "Criar grupo com 3 pessoas" (contando quem cria). */
export function criarGrupoCom(n: number): string {
  return `${CRIAR_GRUPO} com ${nPessoas(n)}`;
}

/** O botão do Pôr pessoas com alguém escolhido: "Pôr 1 pessoa no grupo" ou "Pôr <n> pessoas no grupo". */
export function porNoGrupo(n: number): string {
  return `Pôr ${nPessoas(n)} no grupo`;
}

/** O nome de um membro nos Membros: o meu ganha " (você)". */
export function nomeDoMembro(p: Pessoa, euId: number): string {
  return p.id === euId ? `${nomeDaPessoa(p)} (você)` : nomeDaPessoa(p);
}

/** A linha de baixo de um membro: "Ramal 2001 · criou o grupo", "Ramal 2001 · cuida do grupo" ou "Ramal 2001". */
export function linhaDoMembro(m: Membro): string {
  const ramal = ramalN(m.pessoa.ramal);
  return m.criou ? `${ramal} · criou o grupo` : m.cuida ? `${ramal} · cuida do grupo` : ramal;
}

/** O Tirar de um membro, para o leitor de tela (o nome do quadro Membros): "Tirar Ana Souza do grupo". */
export function tirarDoGrupo(nome: string): string {
  return `Tirar ${nome} do grupo`;
}

/** A confirmação do Tirar: o título "Tirar Ana Souza do grupo?" e o texto (os botões são "Tirar" e "Cancelar"). */
export function tirarDoGrupoPergunta(nome: string): string {
  return `${tirarDoGrupo(nome)}?`;
}

export function deixaDeVer(nome: string): string {
  return `${nome} deixa de ver as mensagens novas do grupo.`;
}

// O cartão Chat da área do administrador.
export const LIGA_ESTE_COMPUTADOR = 'Liga este computador ao chat de uma empresa. O código vem da página de administração do chat.';
export const CODIGO_DA_EMPRESA = 'Código da empresa';
export const LIGAR_AO_CHAT = 'Ligar ao chat';
export const DESLIGAR_DO_CHAT = 'Desligar do chat';
export const CODIGO_NAO_ENCONTRADO = 'Código não encontrado. Confira o código na página de administração.';
export const SEM_CONEXAO_TENTE = 'Sem conexão com o chat. Tente de novo.';
/** "Ligado ao chat da <empresa>. A aba Chat já aparece no app.", em volta do nome da empresa (que vai em negrito). */
export const LIGADO_AO_CHAT_DA = 'Ligado ao chat da ';
export const A_ABA_CHAT_JA_APARECE = '. A aba Chat já aparece no app.';

/** O 429 `tentativas` do código: a espera em minutos, arredondada para cima. */
export function muitasTentativas(esperarSegundos: number): string {
  const minutos = Math.max(1, Math.ceil(esperarSegundos / 60));
  return minutos === 1
    ? 'Muitas tentativas. Tente de novo daqui a 1 minuto.'
    : `Muitas tentativas. Tente de novo daqui a ${minutos} minutos.`;
}
