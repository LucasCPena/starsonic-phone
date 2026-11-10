// O cartão Vídeo da área do administrador (0.3.0; os quadros AdmVideo e AdmVideoEscuro): os codecs (H.264, VP8 e VP9),
// o Primeiro, a Qualidade, os Porteiros e a situação do H.264 da Cisco. Cada mudança vai num adminSet com só o que
// mudou; o núcleo confere e recusa com um toast (a lista de porteiros inclusive), e a tela segue o estado.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { VNode } from 'preact';
import { Select } from '../components/Select';
import { IconCheck, IconRedial } from '../icons';
import type { AdminAberto, CodecDeVideo, QualidadeDeVideo, VideoSettings } from '../state';
import type { Send } from '../types';
import { AJUDA_DOS_PORTEIROS, situacaoDoH264, TENTAR_DE_NOVO } from '../video/textos';

const CODECS: Array<{ id: string; nome: string; campo: 'videoH264' | 'videoVp8' | 'videoVp9' }> = [
  { id: 'adm-h264', nome: 'H.264', campo: 'videoH264' },
  { id: 'adm-vp8', nome: 'VP8', campo: 'videoVp8' },
  { id: 'adm-vp9', nome: 'VP9', campo: 'videoVp9' },
];
const PRIMEIRO: Array<{ valor: CodecDeVideo; texto: string }> = [
  { valor: 'h264', texto: 'H.264' },
  { valor: 'vp8', texto: 'VP8' },
  { valor: 'vp9', texto: 'VP9' },
];
const QUALIDADES: Array<{ valor: QualidadeDeVideo; texto: string }> = [
  { valor: 'baixa', texto: 'Baixa' },
  { valor: 'media', texto: 'Média' },
  { valor: 'alta', texto: 'Alta' },
];

/** O texto dos Porteiros vira a lista: separa por vírgula, tira os espaços das pontas e os itens vazios. */
function listaDePorteiros(texto: string): string[] {
  return texto
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '');
}

/** Os Porteiros: vai quando a pessoa termina de digitar (Enter ou ao sair do campo), uma vez por valor. */
function Porteiros({ porteiros, send }: { porteiros: string[]; send: Send }) {
  const doEstado = porteiros.join(', ');
  const [valor, setValor] = useState(doEstado);
  const ultimo = useRef(doEstado);
  // O núcleo gravou (ou outra lista chegou): o campo segue o estado. Recusada, o estado não muda e o campo fica.
  useEffect(() => {
    setValor(doEstado);
    ultimo.current = doEstado;
  }, [doEstado]);
  const mandar = () => {
    const lista = listaDePorteiros(valor);
    const texto = lista.join(', ');
    if (texto === ultimo.current) return;
    ultimo.current = texto;
    send({ cmd: 'adminSet', porteiros: lista });
  };
  return (
    <form
      class="field adm-porteiros"
      onSubmit={(e) => {
        e.preventDefault();
        mandar();
      }}
    >
      <label class="label" for="adm-porteiros">
        Porteiros
      </label>
      <input
        id="adm-porteiros"
        class="input"
        autocomplete="off"
        spellcheck={false}
        autocapitalize="off"
        value={valor}
        aria-describedby="adm-porteiros-ajuda"
        onInput={(e) => setValor(e.currentTarget.value)}
        onBlur={mandar}
      />
      <p class="help-campo" id="adm-porteiros-ajuda">
        {AJUDA_DOS_PORTEIROS}
      </p>
    </form>
  );
}

/** A situação do módulo H.264 da Cisco: instalado, baixando… ou falhou (com o Tentar de novo). Desligado, nada. */
function Situacao({ video, send }: { video: VideoSettings; send: Send }) {
  const texto = situacaoDoH264(video.h264.situacao);
  if (texto === null) return null;
  const [nome, ...resto] = texto.split(': ');
  const falhou = video.h264.situacao === 'falhou';
  return (
    <div class="adm-video-situacao">
      <p role="status" class={falhou ? 'adm-chat-ligado adm-video-falhou' : 'adm-chat-ligado'}>
        {falhou ? (
          <svg class="ic ic-warn" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 3l10 18H2z" />
            <path d="M12 10v5M12 18v.5" />
          </svg>
        ) : video.h264.situacao === 'instalado' ? (
          <IconCheck size="sm" />
        ) : null}
        <span>
          <strong>{`${nome}:`}</strong>
          {` ${resto.join(': ')}`}
        </span>
      </p>
      {falhou && (
        <button type="button" class="btn btn-outline mini" onClick={() => send({ cmd: 'h264Retry' })}>
          <IconRedial size="sm" />
          {TENTAR_DE_NOVO}
        </button>
      )}
    </div>
  );
}

export function CartaoVideo({ admin, video, send }: { admin: AdminAberto; video: VideoSettings; send: Send }): VNode {
  return (
    <>
      <h2 class="eyebrow">Vídeo</h2>
      <div class="card">
        <p class="adm-video-titulo">Codecs</p>
        {CODECS.map(({ id, nome, campo }) => (
          <div class="set-row" key={id}>
            <span class="row-main">
              <span class="row-title set-title" id={id}>
                {nome}
              </span>
            </span>
            <button
              type="button"
              class="switch"
              role="switch"
              aria-checked={admin[campo]}
              aria-labelledby={id}
              onClick={() => send({ cmd: 'adminSet', [campo]: !admin[campo] })}
            />
          </div>
        ))}
        <div class="set-row">
          <label class="row-title set-title" for="adm-primeiro">
            Primeiro
          </label>
          <Select
            id="adm-primeiro"
            value={admin.videoPrimeiro}
            options={PRIMEIRO.map((o) => ({ valor: o.valor, texto: o.texto }))}
            onChange={(v) => send({ cmd: 'adminSet', videoPrimeiro: v as CodecDeVideo })}
          />
        </div>
        <fieldset class="field adm-canal">
          <legend class="label adm-canal-titulo">Qualidade</legend>
          <div class="seg seg-3">
            {QUALIDADES.map((q) => (
              <label key={q.valor}>
                <input
                  type="radio"
                  name="adm-qualidade"
                  value={q.valor}
                  checked={admin.videoQualidade === q.valor}
                  onChange={() => send({ cmd: 'adminSet', videoQualidade: q.valor })}
                />
                {q.texto}
              </label>
            ))}
          </div>
        </fieldset>
        <Porteiros porteiros={admin.porteiros} send={send} />
        <Situacao video={video} send={send} />
      </div>
    </>
  );
}
