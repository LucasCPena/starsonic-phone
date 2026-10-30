// O Sobre: o logo (principal no claro, negativo no escuro), "Starsonic Phone <versão>", a licença, o site, o
// telefone e o WhatsApp, o código-fonte e "Enviar diagnóstico". Os links abrem no navegador padrão (openExternal).
// (iPhone) A linha das peças do app do iPhone no lugar da licença do Windows; no telefone, também o Ligar (o discador do
// iPhone, pelo tel: do suporte); e, no lugar do código-fonte, a linha "Avisos de licença", que abre a tela deles
// (Licencas.tsx). O Enviar diagnóstico abre a janela de compartilhar do iPhone (o hospedeiro).
import { BackBar } from '../components/BackBar';
import { IconArrowRight, IconCode, IconDocument, IconGlobe, IconPhone } from '../icons';
import { EXTERNAL_URLS } from '../state';
import type { Send } from '../types';

interface Props {
  versao: string;
  send: Send;
  onBack(): void;
  /** (iPhone) O Sobre do iPhone, com o `onLicencas` da linha "Avisos de licença". */
  ios?: boolean;
  onLicencas?(): void;
}

export function Sobre({ versao, send, onBack, ios, onLicencas }: Props) {
  return (
    <>
      <BackBar title="Sobre" onBack={onBack} />
      <div class="body about scroll">
        <picture>
          <source srcset="assets/starsonic-logo-negativo.png" media="(prefers-color-scheme: dark)" />
          <img class="about-logo" src="assets/starsonic-logo-principal.png" width={230} height={70} alt="Starsonic soluções de voz e dados" />
        </picture>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span class="version">{`Starsonic Phone ${versao}`}</span>
          {ios ? (
            // Em duas linhas do mesmo tamanho, quando não cabe numa (sem o "(BSD)" sozinho embaixo).
            <span class="muted" style={{ fontSize: '13.5px', textWrap: 'balance' }}>
              Usa o baresip e a libre (BSD), a libg722 e o Opus (BSD)
            </span>
          ) : (
            <>
              <span class="muted" style={{ fontSize: '13.5px' }}>
                Licença GPL v3 · usa o PJSIP (GPL v2 ou posterior) e o Opus (BSD)
              </span>
              <span class="muted" style={{ fontSize: '12px' }}>
                Plus Jakarta Sans (OFL), Preact (MIT) e WebView2 (Microsoft)
              </span>
            </>
          )}
        </div>
        <div class="card">
          <div class="set-row">
            <span class="tile" aria-hidden="true">
              <IconGlobe size="sm" />
            </span>
            <span class="row-main">
              <span class="row-title set-title">starsonic.com.br</span>
            </span>
            <button type="button" class="link" style={{ fontSize: '13px' }} aria-label="Abrir starsonic.com.br" onClick={() => send({ cmd: 'openExternal', url: EXTERNAL_URLS.site })}>
              Abrir
            </button>
          </div>
          {/* (iPhone) O horário embaixo do número, na largura toda (o app.css): o Ligar e o WhatsApp ficam na linha do número. */}
          <div class={ios ? 'set-row about-telefone' : 'set-row'}>
            <span class="tile" aria-hidden="true">
              <IconPhone size="sm" />
            </span>
            <span class="row-main">
              <span class="row-title set-title">(11) 5060-3000</span>
              <span class="row-sub">
                Também no WhatsApp · seg. a sex., 8h às 18h
              </span>
            </span>
            {ios && (
              <button type="button" class="link" style={{ fontSize: '13px' }} aria-label="Ligar para o suporte" onClick={() => send({ cmd: 'openExternal', url: EXTERNAL_URLS.suporte })}>
                Ligar
              </button>
            )}
            <button type="button" class="link" style={{ fontSize: '13px' }} aria-label="Abrir o WhatsApp" onClick={() => send({ cmd: 'openExternal', url: EXTERNAL_URLS.whatsapp })}>
              WhatsApp
            </button>
          </div>
          {ios ? (
            // A linha inteira abre a tela dos avisos (como uma linha dos Ajustes do iPhone, com a seta).
            <button type="button" class="set-row about-avisos" onClick={onLicencas}>
              <span class="tile" aria-hidden="true">
                <IconDocument size="sm" />
              </span>
              <span class="row-main">
                <span class="row-title set-title">Avisos de licença</span>
              </span>
              <IconArrowRight size="sm" class="muted" />
            </button>
          ) : (
            <div class="set-row">
              <span class="tile" aria-hidden="true">
                <IconCode size="sm" />
              </span>
              <span class="row-main">
                <span class="row-title set-title">Código-fonte</span>
                <span class="row-sub">github.com/LucasCPena/starsonic-phone</span>
              </span>
              <button type="button" class="link" style={{ fontSize: '13px' }} aria-label="Abrir o código-fonte" onClick={() => send({ cmd: 'openExternal', url: EXTERNAL_URLS.codigo })}>
                Abrir
              </button>
            </div>
          )}
        </div>
        <button type="button" class="btn btn-outline btn-block" onClick={() => send({ cmd: 'sendDiagnostics' })}>
          Enviar diagnóstico
        </button>
      </div>
    </>
  );
}
