// Os textos das reuniões (a spec, seção 11, e o quadro "Starsonic Phone — reuniões"): por enquanto, só os do aviso
// do Windows (a tela 11).

export const AVISO_REUNIOES = 'Starsonic Phone · Reuniões';
export const querEntrar = (nome: string) => `${nome} quer entrar`;
/** O nome do aviso para o leitor de tela: com o assunto, "<Nome> quer entrar na reunião <assunto>". */
export const querEntrarNaReuniao = (nome: string, assunto: string | null) =>
  assunto ? `${nome} quer entrar na reunião ${assunto}` : `${nome} quer entrar na reunião`;
export const SEM_ASSUNTO = 'Reunião sem assunto';
export const RECUSAR = 'Recusar';
export const ACEITAR = 'Aceitar';
export const FECHAR_O_AVISO = 'Fechar o aviso';
