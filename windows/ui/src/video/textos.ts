// Os textos do vídeo (o texto exato do plano da etapa 2, "Os textos"): um nome por texto.
import type { H264Situacao } from '../state';

// Os botões.
export const LIGAR_COM_VIDEO = 'Ligar com vídeo';
export const ATENDER_COM_VIDEO = 'Atender com vídeo';
export const CAMERA = 'Câmera';
export const ABRIR_GRANDE = 'Abrir grande';
export const DIMINUIR = 'Diminuir';
export const TELA_CHEIA = 'Tela cheia';
export const SAIR_DA_TELA_CHEIA = 'Sair da tela cheia';
export const CHAT = 'Chat';
export const VOLTAR_PARA_A_LIGACAO = 'Voltar para a ligação';
export const TESTAR_A_CAMERA = 'Testar a câmera';
export const PARAR_O_TESTE = 'Parar o teste';
export const TENTAR_DE_NOVO = 'Tentar de novo';

// Os nomes para o leitor de tela.
export const LIGAR_A_CAMERA = 'Ligar a câmera';
export const DESLIGAR_A_CAMERA = 'Desligar a câmera';
export const SUA_IMAGEM = 'Sua imagem';
export const rotuloDoVideo = (nome: string) => `Vídeo de ${nome}`;
export const ligarComVideoPara = (nome: string, ramal?: string) =>
  ramal === undefined ? `Ligar com vídeo para ${nome}` : `Ligar com vídeo para ${nome}, ramal ${ramal}`;

// As Configurações e o cartão Vídeo.
export const AUDIO_E_VIDEO = 'Áudio e vídeo';
export const NENHUMA_CAMERA = 'Nenhuma câmera encontrada.';
export const cameraDesconectada = (nome: string) => `${nome} (desconectada)`;
export const H264_DA_CISCO = 'H.264 da Cisco';
export const AVISO_DA_CISCO = 'OpenH264 Video Codec provided by Cisco Systems, Inc.';
export const AJUDA_DOS_PORTEIROS = 'Ramais dos porteiros, separados por vírgula: o app mostra a imagem deles antes de atender.';

/** A situação do módulo na tela; `null` para `desligado`. */
export function situacaoDoH264(s: H264Situacao): string | null {
  switch (s) {
    case 'instalado':
      return `${H264_DA_CISCO}: instalado`;
    case 'baixando':
      return `${H264_DA_CISCO}: baixando…`;
    case 'falhou':
      return `${H264_DA_CISCO}: não foi possível baixar`;
    default:
      return null;
  }
}

// A faixa da conversa.
export const EM_LIGACAO = 'Em ligação';

/** Os seis avisos do vídeo (os toasts do núcleo) que ficam 5 s na tela. */
export const AVISOS_DE_5_S: ReadonlySet<string> = new Set([
  'A outra ponta não aceitou o vídeo.',
  'A câmera está sendo usada por outro programa.',
  'A câmera foi desconectada.',
  'O Windows bloqueou a câmera para este app. Libere em Configurações do Windows → Privacidade e segurança → Câmera.',
  'Este vídeo precisa do H.264, que ainda não foi baixado.',
  NENHUMA_CAMERA,
]);
