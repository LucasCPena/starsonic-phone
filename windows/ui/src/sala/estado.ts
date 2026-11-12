// A sala no estado (docs/ponte-windows.md, "A sala de vídeo (0.4.0)"): a interface lê a sala só por aqui. No iPhone nada
// da sala aparece, mesmo com o `ligacao.sala` no estado. Onde a linha da sala está (em cima ou embaixo, com a ligação de
// fora), a conta das pessoas, os nomes da pergunta e as regras do Adicionar pessoa e da Câmera da sala, num lugar só.
import { isIos } from '../plataforma';
import type { AppState, CallCard, CallState, CallVideo, ParticipanteDaSala, SalaDaLigacao } from '../state';
import { videoDe, videoDoApp } from '../video/estado';

/** A sala de agora: `null` no iPhone, sem ligação ou sem sala. */
export function salaDe(state: AppState): SalaDaLigacao | null {
  return isIos(state) ? null : (state.ligacao?.sala ?? null);
}

/** A linha da sala é a de cima (você na sala, ou voltando para ela). */
export function salaEmCima(l: CallState, sala: SalaDaLigacao | null): boolean {
  return sala !== null && l.top.id === sala.id;
}

/** A linha da sala é a de baixo, em espera: a ligação de fora está em cima. */
export function salaEmbaixo(l: CallState, sala: SalaDaLigacao | null): boolean {
  return sala !== null && l.second?.id === sala.id;
}

/** Você está fora da sala: ela está embaixo, ou em cima ainda em espera (a ligação de fora acabando). */
export function foraDaSala(l: CallState, sala: SalaDaLigacao | null): boolean {
  return salaEmbaixo(l, sala) || (salaEmCima(l, sala) && l.top.held);
}

/** As pessoas da sala: você e cada convidado, também os que ainda são chamados (a sala cheia tem 6). */
export function pessoasNaSala(sala: SalaDaLigacao): number {
  return sala.participantes.length + 1;
}

/** O nome do convidado ou, sem ele, o número. */
export function nomeNaSala(p: ParticipanteDaSala): string {
  return p.nome || p.numero;
}

/** Os nomes dos convidados, na ordem: "Ana Souza", "Ana Souza e Carlos Lima", "Ana Souza, Carlos Lima e Bia Ramos". */
export function nomesDaSala(sala: SalaDaLigacao): string {
  const nomes = sala.participantes.map(nomeNaSala);
  return nomes.length <= 1 ? (nomes[0] ?? '') : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}

/**
 * O Adicionar pessoa aparece, fora do iPhone, com a sala em cima ou sem sala, com o vídeo do app ligado e o vídeo ativo
 * na de cima. Com a sala embaixo (a ligação de fora em cima), nunca.
 */
export function mostraAdicionar(state: AppState, l: CallState): boolean {
  if (isIos(state)) return false;
  const sala = l.sala ?? null;
  return (sala === null || salaEmCima(l, sala)) && videoDoApp(state).ligado && videoDe(state, l.top).ativo;
}

/**
 * O Adicionar pessoa vale (o que o núcleo pede ao `salaAdicionar`). Com a sala em cima: fora da espera, com você nela
 * (sem o `fora`) e sem o `cheia`. Sem sala: a de cima sozinha (sem a segunda, fora da conferência e da consulta),
 * atendida e fora da espera.
 */
export function podeAdicionar(state: AppState, l: CallState): boolean {
  if (!mostraAdicionar(state, l)) return false;
  const sala = l.sala ?? null;
  if (sala !== null) return !l.top.held && !sala.fora && !sala.cheia;
  return l.second === null && !l.conference && !l.consulting && l.top.phase === 'active' && l.top.activeSinceMs > 0 && !l.top.held;
}

/**
 * A Câmera da sala desativada: ligada, ela sempre desliga; desligada, ela só espera a sala sair da espera (a linha da
 * sala já nasce atendida).
 */
export function cameraDaSalaDesativada(linha: CallCard, video: CallVideo): boolean {
  return !video.camera && linha.held;
}
