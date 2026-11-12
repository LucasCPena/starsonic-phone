// Os textos da sala (o texto exato do plano da etapa 3b, "Os textos"): um nome por texto. Os de sempre (o Cancelar, o
// Mudo, a Câmera, o Abrir grande, o Alternar, o Desligar e o `Vídeo de <nome>`) ficam onde já estão.

// Os botões.
export const ADICIONAR_PESSOA = 'Adicionar pessoa';
export const ADICIONAR = 'Adicionar';
export const TIRAR_DA_SALA = 'Tirar da sala';
export const ENCERRAR = 'Encerrar';
export const VOLTAR_PARA_A_SALA = 'Voltar para a sala';

// O painel de adicionar: o título e o nome do campo, a ajuda e o alto do painel (o `.eyebrow` o põe em maiúsculas).
export const ADICIONAR_A_SALA = 'Adicionar à sala';
export const AJUDA_DE_ADICIONAR = 'O app liga para a pessoa com vídeo. Ela entra na sala quando atender.';
export const EM_VIDEOCHAMADA = 'Em videochamada';

// A sala: o nome dela, o grupo dos quadros, os estados de um convidado e o aviso da sala cheia.
export const SALA_DE_VIDEO = 'Sala de vídeo';
export const MOSAICO_DA_SALA = 'Mosaico da sala';
export const CHAMANDO = 'Chamando…';
export const SEM_VIDEO_NA_SALA = 'Sem vídeo';
export const EM_ESPERA_NA_SALA = 'Em espera';
export const SALA_CHEIA = 'A sala já tem 6 pessoas.';

/** "3 pessoas"; uma só no singular: "1 pessoa". */
export function pessoas(n: number): string {
  return n === 1 ? '1 pessoa' : `${n} pessoas`;
}

// A pergunta do Desligar.
export const ENCERRAR_A_SALA = 'Encerrar a sala para todos?';
/** "As ligações com Ana Souza e Carlos Lima vão desligar." (os nomes do `nomesDaSala`). */
export function ligacoesVaoDesligar(nomes: string): string {
  return `As ligações com ${nomes} vão desligar.`;
}

// A faixa de fora da sala (com os nomes e o tempo embaixo, e o Voltar para a sala).
export const FORA_DA_SALA = 'Você está fora da sala';
