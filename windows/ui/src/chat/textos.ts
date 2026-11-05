// Os textos do chat, letra por letra: os da seção 10 da spec (docs/superpowers/specs/2026-11-04-starsonic-phone-chat-
// design.md) e os da lista "Os textos novos" do plano da etapa 2. A hora e a prévia da lista ficam no formato.ts.
import type { AvisoDeGrupo, Pessoa } from './tipos';

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

/** O texto de um aviso de grupo; quem fez ou o alvo sou eu: "Você" no começo, "você" no meio. */
export function textoDoAviso(aviso: AvisoDeGrupo, euId: number): string {
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
