// Os motivos com que a loja de atalhos do C++ (starsonic/desktop/Atalhos.cpp) recusa um Salvar: o texto do toast, que o
// C++ manda como está, e onde o foco volta na edição (o campo de que o motivo fala; os outros, o "Salvar atalho"). A
// edição só destrava o Salvar com um destes avisos ou com os atalhos gravados mudando: um aviso de outra coisa (uma
// ligação perdida, "Sem conexão…") no meio da espera não é a resposta do Salvar. Um motivo novo na loja entra aqui
// também (o teste de atalhos.spec.ts confere a lista com o Atalhos.cpp).

/** Onde o foco volta depois de uma recusa. */
export type AlvoDoFoco = 'nome' | 'numero' | 'salvar';

export const RECUSAS_DO_SALVAR: ReadonlyMap<string, AlvoDoFoco> = new Map<string, AlvoDoFoco>([
  ['Digite o nome do atalho.', 'nome'],
  ['O nome não pode ter caracteres de controle.', 'nome'],
  ['O nome pode ter até 24 caracteres.', 'nome'],
  ['Digite o número do atalho.', 'numero'],
  ['O número só pode ter dígitos, *, # e +.', 'numero'],
  ['O número pode ter até 32 caracteres.', 'numero'],
  ['Você já tem 8 atalhos. Remova um para adicionar outro.', 'salvar'],
  ['Escolha o que o atalho faz.', 'salvar'],
  ['Esse atalho não existe mais.', 'salvar'],
  ['Não foi possível gravar os atalhos.', 'salvar'],
]);
