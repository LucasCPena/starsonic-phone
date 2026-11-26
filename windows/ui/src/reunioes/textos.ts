// Os textos das reuniões (a spec, seção 11, e o quadro "Starsonic Phone — reuniões", telas 1 a 5 e 11): o aviso do
// Windows, a aba, o menu, a Nova reunião, o cancelar e os erros.

export const AVISO_REUNIOES = 'Starsonic Phone · Reuniões';
export const querEntrar = (nome: string) => `${nome} quer entrar`;
/** O nome do aviso para o leitor de tela: com o assunto, "<Nome> quer entrar na reunião <assunto>". */
export const querEntrarNaReuniao = (nome: string, assunto: string | null) =>
  assunto ? `${nome} quer entrar na reunião ${assunto}` : `${nome} quer entrar na reunião`;
export const SEM_ASSUNTO = 'Reunião sem assunto';
export const RECUSAR = 'Recusar';
export const ACEITAR = 'Aceitar';
export const FECHAR_O_AVISO = 'Fechar o aviso';

// A aba.
export const REUNIOES = 'Reuniões';
export const AS_QUE_VOCE_MARCOU = 'As que você marcou';
export const NOVA_REUNIAO = 'Nova reunião';
export const ENTRAR = 'Entrar';
export const COPIAR_LINK = 'Copiar link';
export const LINK_COPIADO = 'Link copiado';
export const CAMPO_DO_LINK = 'Cole aqui o link de uma reunião';
export const ABRIR_NO_NAVEGADOR = 'Abrir no navegador';
/** O nome do campo do link para o leitor de tela. */
export const ENTRAR_COM_O_LINK = 'Entrar com o link de uma reunião';

// A primeira vez (o "Nova reunião" do segundo texto vai em negrito na tela).
export const NENHUMA_REUNIAO = 'Nenhuma reunião marcada';
export const PRIMEIRA_VEZ_ANTES = 'Marque uma no ';
export const PRIMEIRA_VEZ_DEPOIS =
  ' e mande o link para quem vai participar. Os colegas entram direto, e quem é de fora pede para entrar.';

// O menu da linha.
export const CANCELAR_A_REUNIAO = 'Cancelar a reunião';
export const maisOpcoesDe = (assunto: string | null) => `Mais opções de ${assunto || SEM_ASSUNTO}`;
export const opcoesDe = (assunto: string | null) => `Opções de ${assunto || SEM_ASSUNTO}`;

// A Nova reunião.
export const SECAO_REUNIOES = 'REUNIÕES';
export const ASSUNTO = 'Assunto';
export const OPCIONAL = 'Opcional';
export const AJUDA_DO_ASSUNTO = 'Aparece no alto da reunião, para todos que entram.';
export const DIA = 'Dia';
export const HORA = 'Hora';
export const O_LINK_VALE_ATE = 'O link vale até';
export const O_FIM_DO_DIA = 'O fim do dia da reunião';
export const OUTRO_DIA_E_HORA = 'Outro dia e hora';
export const depoisDessaHora = (ate: string) => `${ate}. Depois dessa hora, ninguém novo entra pelo link.`;
export const COLEGAS_E_DE_FORA =
  'Os colegas da empresa entram direto. Quem é de fora digita o nome e espera um colega aceitar.';
export const CRIAR_A_REUNIAO = 'Criar a reunião';
export const O_LINK_E_COPIADO = 'O link é copiado assim que a reunião é criada.';
export const DIA_JA_PASSOU = 'O dia da reunião já passou.';
export const ATE_31_DIAS = 'O link pode valer até 31 dias depois da reunião.';
export const CEM_REUNIOES = 'Você já tem 100 reuniões marcadas. Cancele uma para marcar outra.';
export const VOLTAR_PARA_AS_REUNIOES = 'Voltar para as reuniões';

// O cancelar.
export const CANCELAR_A_REUNIAO_PERGUNTA = 'Cancelar a reunião?';
export const VOLTAR = 'Voltar';

// Os erros da aba.
export const LINK_SEM_VALOR = 'Este link não vale mais';
export const NAO_E_LINK_DE_REUNIAO = 'Este não é um link de reunião do Starsonic.';
export const REUNIAO_DE_OUTRA_EMPRESA =
  'Esta reunião é de outra empresa. Ela abre no navegador, e você entra como convidado.';
export const MUITAS_TENTATIVAS = 'Muitas tentativas. Espere um pouco para tentar de novo.';
export const SERVIDOR_NAO_RESPONDEU = 'O servidor do chat não respondeu. Tente de novo.';
export const SEM_CONEXAO_COM_O_CHAT = 'Sem conexão com o chat. As reuniões voltam quando a conexão voltar.';
export const SERVIDOR_PRECISA_ATUALIZAR = 'O servidor do chat precisa ser atualizado para abrir reuniões pelo app.';

// Avisos curtos e a tela da ligação.
export const REUNIAO_CHEIA = 'A reunião está cheia: ninguém mais entra agora.';
export const NAVEGADOR_CONTINUA_OUVINDO = 'A reunião no navegador continua ouvindo você. Desligue o microfone lá.';

// A reunião dentro do app (o quadro, telas 6, 7 e 12 a 14).
export const REUNIAO = 'Reunião';
export const OCUPADO_EM_REUNIAO = 'Ocupado · em reunião';
export const TELA_CHEIA = 'Tela cheia';
export const SAIR_DA_TELA_CHEIA = 'Sair da tela cheia';
export const A_REUNIAO_NAO_ABRIU = 'A reunião não abriu.';
export const TENTAR_DE_NOVO = 'Tentar de novo';
export const FECHAR = 'Fechar';
export const DESLIGUE_PARA_ENTRAR = 'Desligue a ligação para entrar na reunião.';
export const SAIA_PARA_ENTRAR_EM_OUTRA = 'Saia da reunião de agora para entrar em outra.';
export const SEM_CHAT_ENTRE_PELO_NAVEGADOR =
  'Este computador não está ligado ao chat da empresa. Entre pelo navegador.';
export const WEBVIEW2_ANTIGO = 'Este Windows não abre a reunião dentro do app. Ela abriu no navegador.';
export const TELEFONE = 'Telefone';
/** A faixa do "Telefone" (tela 14). */
export const VOCE_ESTA_NA_REUNIAO = 'Você está na reunião';
export const MICROFONE_LIGADO = 'O microfone está ligado';
export const MICROFONE_DESLIGADO = 'O microfone está desligado';
export const VOLTAR_PARA_A_REUNIAO = 'Voltar para a reunião';
