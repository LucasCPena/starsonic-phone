// (0.3.0) O vídeo nas Configurações (spec do vídeo, 4.1; os quadros Configuracoes e ConfiguracoesEscuro): as linhas do
// cartão "Áudio e vídeo", depois do Toque (o cartão só existe no Windows). Com o `video.ligado`, o campo Câmera (as câmeras
// do computador, como o Microfone, e a escolhida desconectada com "(desconectada)"; sem câmeras, desativado, com "Nenhuma
// câmera encontrada.") e o "Testar a câmera", que mostra a sua imagem ali mesmo, numa prévia 16:9, até o "Parar o teste".
// Com o `video.h264.cartao` (o H.264 ligado no cartão Vídeo do administrador), a chave "H.264 da Cisco", com o aviso da
// Cisco embaixo, também com o vídeo desligado pela pessoa. A câmera nunca liga sozinha: o teste só liga no clique, e
// para quando a prévia sai sem o "Parar o teste": ao sair das Configurações, por qualquer caminho, ou quando o vídeo
// desliga.
import { useEffect, useRef } from 'preact/hooks';
import { Select, type Opcao } from '../components/Select';
import { VistaDeVideo } from '../components/VistaDeVideo';
import { IconStop, IconVideo } from '../icons';
import type { VideoSettings } from '../state';
import type { Send } from '../types';
import { AVISO_DA_CISCO, CAMERA, cameraDesconectada, H264_DA_CISCO, NENHUMA_CAMERA, PARAR_O_TESTE, SUA_IMAGEM, TESTAR_A_CAMERA } from './textos';

interface Props {
  video: VideoSettings;
  send: Send;
}

/** As opções do campo Câmera: as câmeras de agora e, com "(desconectada)", a escolhida que não está entre elas. */
function opcoesDaCamera(video: VideoSettings): Opcao[] {
  const opcoes: Opcao[] = [];
  for (const nome of video.cameras) {
    if (!opcoes.some((o) => o.valor === nome)) opcoes.push({ valor: nome, texto: nome });
  }
  if (video.cameraDesconectada && !opcoes.some((o) => o.valor === video.camera)) {
    opcoes.push({ valor: video.camera, texto: cameraDesconectada(video.camera) });
  }
  return opcoes;
}

/**
 * O "Testar a câmera" e, com o teste ligado, a prévia com o "Parar o teste" embaixo: o mesmo botão, que fica com o foco
 * do teclado. O teste ligado para quando ele sai (as Configurações saem, ou o vídeo desliga).
 */
function TesteDaCamera({ video, send }: Props) {
  const ligado = useRef(video.teste);
  ligado.current = video.teste;
  useEffect(
    () => () => {
      if (ligado.current) send({ cmd: 'cameraTest', on: false });
    },
    [],
  );
  return (
    <div class={video.teste ? 'set-row cfg-teste cfg-teste-ligado' : 'set-row cfg-teste'}>
      {video.teste && <VistaDeVideo vista="local" desenhar={video.teste} rotulo={SUA_IMAGEM} espelhar class="cfg-previa" />}
      <button
        type="button"
        class="btn btn-outline mini"
        disabled={!video.teste && video.cameras.length === 0}
        onClick={() => send({ cmd: 'cameraTest', on: !video.teste })}
      >
        {video.teste ? <IconStop size="sm" /> : <IconVideo size="sm" />}
        {video.teste ? PARAR_O_TESTE : TESTAR_A_CAMERA}
      </button>
    </div>
  );
}

export function ConfigDoVideo({ video, send }: Props) {
  const opcoes = opcoesDaCamera(video);
  // A escolhida, ou a primeira câmera ("" é a primeira).
  const valor = opcoes.some((o) => o.valor === video.camera) ? video.camera : (video.cameras[0] ?? '');
  return (
    <>
      {video.ligado && (
        <>
          <div class="set-row">
            <label class="row-main row-title set-title" for="cfg-camera">
              {CAMERA}
            </label>
            {video.cameras.length === 0 ? (
              <Select id="cfg-camera" value="" options={[{ valor: '', texto: NENHUMA_CAMERA }]} onChange={() => undefined} disabled />
            ) : (
              <Select id="cfg-camera" value={valor} options={opcoes} onChange={(camera) => send({ cmd: 'setVideo', camera })} />
            )}
          </div>
          <TesteDaCamera video={video} send={send} />
        </>
      )}
      {video.h264.cartao && (
        <div class="set-row">
          <span class="row-main">
            <span class="row-title set-title" id="cfg-h264">
              {H264_DA_CISCO}
            </span>
            <span class="row-sub wrap" id="cfg-h264-sub">
              {AVISO_DA_CISCO}
            </span>
          </span>
          <button
            type="button"
            class="switch"
            role="switch"
            aria-checked={video.h264.pessoa}
            aria-labelledby="cfg-h264"
            aria-describedby="cfg-h264-sub"
            onClick={() => send({ cmd: 'setVideo', h264: !video.h264.pessoa })}
          />
        </div>
      )}
    </>
  );
}
