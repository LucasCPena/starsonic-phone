// A tela da ligação, sempre na seção escura: uma ligação, a segunda tocando (a faixa "Ligação de …"), duas (o
// cartão "Em espera"), a consulta ("Consultando" e o cliente "Em espera · transferência") e a conferência.
// A interface não decide nenhuma regra: o que aparece e o que fica travado vem só do `ligacao` do estado
// (docs/ponte-windows.md). A conferência é olhada antes do `secondKind` (nela a segunda vem "active").
// Teclado físico: os dígitos, * e # mandam DTMF só com o teclado da ligação aberto; Esc fecha o teclado e o painel
// Atalhos. (rc.3) O botão Atalhos (com uma ligação atendida, fora da consulta e da conferência) abre o painel com os
// atalhos no lugar dos controles. (rc.6) No Windows, o campo do Transferir e da Nova ligação acha o contato pelo nome ou
// pelo número (o PainelPorNome): embaixo dele, a lista dos meus contatos e dos da lista da empresa, a mesma da aba
// Contatos, com a busca de ligar do Teclado (lista-de-contatos.ts). (iPhone) O campo é só de número, com as sugestões da
// agenda (um contato por número; um contato sem nome mostra o número). O contato escolhido da Nova ligação liga com a
// regra dos contatos (o `contato` do dial); o do Transferir põe o número no campo, e o Consultar e o Transferir agora
// dele, sem mudança depois, vão com o `contato` também (no Windows, desde a rc.5). (rc.6) No Windows, os controles, o
// Desligar e os botões dos painéis de número ignoram o segundo clique de um clique duplo (o semSegundoClique).
// (iPhone) O botão Áudio mostra a saída de agora (a `rotaAudio`: "iPhone", "Viva-voz" ou o nome do fone; "Áudio" sem
// saber), com o nome "Áudio: <saída>", e pede a escolha do iPhone (o `audioRoute`: o hospedeiro mostra a dele), no
// lugar do menu dos dispositivos; sem o botão Atalhos (fora da 1.0), uma ligação fica em três colunas (6 controles) e
// duas em quatro (7). Cada tecla do teclado da ligação manda, junto do dtmf, o `keyTone` com ela, com o Bipe ao digitar
// ligado (o `config.bipeTecla`).
// (vídeo, etapa 2) Com o vídeo ligado, a Câmera entra nos controles, depois do Mudo, com a regra do video/estado.ts (o
// cameraDaLigacaoDesativada): numa ligação, a do cameraDesativada; com duas (a segunda tocando ou em espera, também na
// consulta), só para desligar a câmera (o motor pausa a câmera de todas); na conferência, não. Numa ligação só, ou com a
// segunda quando a de cima é um porteiro (o imagemDaLigacao: a exceção do porteiro), fora do toque, sem painel aberto e
// com a imagem da outra ponta chegando, a área do vídeo (CaixaDoVideo.tsx) toma o lugar de quem fala, embaixo do cartão
// da outra ligação quando ele está em cima. Fora dela, com a câmera ligada, a sua imagem flutua no canto de cima
// à direita (também com um painel aberto): embaixo do cartão da outra ligação quando ele está em cima, e no canto de
// baixo, ao lado do Desligar, com ele e um painel aberto. As colunas dos controles seguem quantos são. O cartão da outra
// ligação (o CartaoDaOutra) também vai ao grande e à tela cheia. (Task 8) Numa ligação com um colega do chat (o `chat`,
// do main.tsx), o Chat vem depois da Câmera, nos controles de uma ligação: ele abre a conversa com o colega, embaixo da
// faixa da ligação. Com a segunda tocando, ele espera, como a Nova ligação (a conversa só fica na tela com uma ligação).
// (0.4.0) Numa videochamada (o mostraAdicionar do sala/estado.ts), o Adicionar pessoa vem depois da Câmera, nos controles
// de uma ligação (o Chat vem depois dele), e espera o que o núcleo pede (o podeAdicionar). Ele abre o painel de adicionar
// (sala/PainelDeAdicionar.tsx), com "Em videochamada" no alto, enquanto adicionar vale; o Adicionar manda o
// `salaAdicionar`; o pedido do painel cai com ele, e não volta sozinho. Com o painel de adicionar, a sua imagem flutua no
// canto de baixo, ao lado do Desligar. Os controles (controlesDaLigacao.tsx) e o painel pelo nome (PainelPorNome.tsx)
// saíram daqui sem mudar, para a sala usar também. Com a sala embaixo (você na ligação de fora), a outra não é ela: a sala tem a
// faixa "Você está fora da sala" (sala/FaixaForaDaSala.tsx, no main.tsx), e os controles são os de uma ligação, sem o Chat.
import type { VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { AtalhosPainel } from '../components/AtalhosPainel';
import { VistaDeVideo } from '../components/VistaDeVideo';
import { Menu } from '../components/Menu';
import { Rediscar } from '../components/Rediscar';
import { callTimer, contactNumberLine, digitsOnly, firstName, initials, nameOrNumber } from '../format';
import { isIos, semSegundoClique } from '../plataforma';
import {
  IconAdicionarPessoa,
  IconArrowRight,
  IconBolt,
  IconCheck,
  IconClose,
  IconKeypad,
  IconMerge,
  IconMessage,
  IconMic,
  IconMicOff,
  IconPause,
  IconPhone,
  IconPlus,
  IconSpeaker,
  IconSpeaking,
  IconSplit,
  IconSwap,
  IconVideo,
  IconVideoOff,
} from '../icons';
import { listaDeContatos } from '../lista-de-contatos';
import { mostraAdicionar, podeAdicionar, salaDe, salaEmbaixo } from '../sala/estado';
import { PainelDeAdicionar } from '../sala/PainelDeAdicionar';
import { ADICIONAR_PESSOA, EM_VIDEOCHAMADA } from '../sala/textos';
import type { AppState, CallCard, CallState, CompanyContact, Contact } from '../state';
import type { Send } from '../types';
import { CaixaDoVideo, SuaImagemFlutuante } from '../video/CaixaDoVideo';
import { cameraDaLigacaoDesativada, imagemDaLigacao, oferecerAtenderComVideo, videoDe, videoDoApp } from '../video/estado';
import { ATENDER_COM_VIDEO, CAMERA, CHAT, DESLIGAR_A_CAMERA, LIGAR_A_CAMERA, rotuloDoVideo } from '../video/textos';
import { Avatar, confirmada, Ctrl, NoWindows, RoundAction } from './controlesDaLigacao';
import { AvisoOuvindo } from '../reunioes/AvisoOuvindo';
import { PainelPorNome, type PainelProps } from './PainelPorNome';
import { statusLine, useNow } from './tempoDaLigacao';

interface Props {
  state: AppState;
  ligacao: CallState;
  /** Os contatos do Transferir e da Nova ligação: os `contatos` do estado; no iPhone, os da agenda. */
  contatos: Contact[];
  /** (rc.6) A lista da empresa (a última contatosEmpresa): no Windows, ela entra na lista dos painéis com os `contatos`. */
  daEmpresa: CompanyContact[];
  send: Send;
  /** (vídeo, etapa 2) O Chat, com um colega do chat na ligação de cima: abre a conversa com ele (main.tsx). */
  chat?: { abrir(): void } | null;
  /** (reuniões) A reunião aberta no navegador continua ouvindo a pessoa: a frase do aviso. */
  ouvindoNoNavegador?: boolean;
}

type Painel = 'teclado' | 'transferir' | 'nova' | 'atalhos' | 'adicionar' | null;

const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
const PADRAO = 'Padrão do Windows';

/** Os últimos dígitos mandados (os que cabem na linha). */
function ultimos(digitos: string): string {
  return digitos.length > 18 ? `…${digitos.slice(-17)}` : digitos;
}

/** O menu Áudio: o alto-falante e o microfone da ligação (o `setAudio` pelo nome; "" = o padrão do Windows). */
function AudioMenu({ state, send, anchor, onClose }: { state: AppState; send: Send; anchor: { current: HTMLElement | null }; onClose(): void }) {
  const { audio } = state;
  const grupo = (titulo: string, lista: string[], escolhido: string, mandar: (nome: string) => void) => {
    const nomes = [...lista];
    if (escolhido && !nomes.includes(escolhido)) nomes.push(escolhido);
    const id = `audio-${titulo === 'Microfone' ? 'mic' : 'falante'}`;
    return (
      <div role="group" aria-labelledby={id}>
        <p class="menu-group" id={id}>
          {titulo}
        </p>
        {['', ...nomes].map((nome) => {
          const fora = nome !== '' && audio.desconectados.includes(nome);
          return (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={nome === escolhido}
              class="menuitem"
              key={nome || 'padrao'}
              onClick={() => (onClose(), mandar(nome))}
            >
              <span class="check-slot">{nome === escolhido && <IconCheck size="sm" class="check" />}</span>
              {nome === '' ? PADRAO : fora ? `${nome} (desconectado)` : nome}
            </button>
          );
        })}
      </div>
    );
  };
  return (
    <Menu label="Áudio" anchor={anchor as { current: HTMLElement }} onClose={onClose} class="popover-audio">
      {grupo('Alto-falante', audio.altoFalantes.map((d) => d.nome), audio.altoFalante, (nome) => send({ cmd: 'setAudio', altoFalante: nome }))}
      <div class="menu-sep" role="separator" />
      {grupo('Microfone', audio.microfones.map((d) => d.nome), audio.microfone, (nome) => send({ cmd: 'setAudio', microfone: nome }))}
    </Menu>
  );
}

/** (iPhone) O número do Transferir e da Nova ligação, com as sugestões da agenda (como o Teclado). */
function NumberPanel({ titulo, rotulo, contatos, onCancel, onContact, actions, onEnter }: PainelProps & { contatos: Contact[] }) {
  const [numero, setNumero] = useState('');
  // O número do campo veio de uma sugestão e não mudou depois.
  const [daSugestao, setDaSugestao] = useState(false);
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => campo.current?.focus(), []);
  const digitos = digitsOnly(numero);
  const sugestoes = digitos.length >= 2 ? contatos.filter((c) => digitsOnly(c.numero).includes(digitos)).slice(0, 2) : [];
  return (
    <div class="call-panel">
      <h2 class="call-panel-title">{titulo}</h2>
      <input
        ref={campo}
        class="call-number"
        type="tel"
        aria-label={rotulo}
        placeholder="Digite o número"
        autocomplete="off"
        spellcheck={false}
        value={numero}
        onInput={(e) => {
          const valor = e.currentTarget.value.replace(/[^0-9*#+]/g, '');
          e.currentTarget.value = valor;
          setNumero(valor);
          setDaSugestao(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          } else if (e.key === 'Enter' && onEnter && numero) {
            e.preventDefault();
            onEnter(numero, daSugestao);
          }
        }}
      />
      {/* As sugestões ficam com o espaço que sobra (numa janela pequena, uma lista que rola sozinha). */}
      {sugestoes.length > 0 && (
        <div class="call-suggestions">
          {sugestoes.map((c) => (
            <button
              type="button"
              key={c.id}
              class="suggest call-suggest"
              onClick={() => (onContact ? onContact(c.numero) : (setNumero(c.numero), setDaSugestao(true)))}
            >
              <span class="avatar" aria-hidden="true">
                {initials(c.nome)}
              </span>
              <span class="row-main">
                <span class="row-title">{c.nome || c.numero}</span>
                <span class="row-sub">Contato · {c.numero}</span>
              </span>
              <IconArrowRight size="sm" />
            </button>
          ))}
        </div>
      )}
      <div class="call-panel-actions">{actions(numero, daSugestao)}</div>
      <button type="button" class="btn btn-ghost-dark" onClick={onCancel}>
        Cancelar
      </button>
    </div>
  );
}

interface CartaoProps {
  state: AppState;
  ligacao: CallState;
  send: Send;
  now: number;
}

/**
 * O cartão da outra ligação, em cima: a faixa da segunda que toca ("Ligação de …", com o Recusar e o Atender), ou o
 * cartão da outra em espera (na consulta com o colega em cima, o cliente: "Em espera · transferência"). Sem a outra, e na
 * conferência (olhada antes do `secondKind`), nenhum. A tela da ligação, o grande e a tela cheia o mostram.
 */
export function CartaoDaOutra({ state, ligacao: l, send, now }: CartaoProps): VNode | null {
  const ios = isIos(state);
  const conferencia = l.conference && l.second !== null;
  const segundaTocando = !conferencia && l.secondKind === 'ringing' ? l.second : null;
  // A linha da sala embaixo (você na ligação de fora) é da faixa "Você está fora da sala", não um cartão.
  const outra = !conferencia && l.secondKind === 'held' && !salaEmbaixo(l, salaDe(state)) ? l.second : null;
  const consulta = l.consulting && outra !== null;
  if (segundaTocando) {
    // Sem o Atender com vídeo: com outra ligação em andamento o vídeo pausa, e ele não cumpriria a promessa.
    return (
      <div class="vcard vcard-on" role="alert">
        <Avatar card={segundaTocando} />
        <span class="row-main">
          <span class="row-title">Ligação de {nameOrNumber(segundaTocando)}</span>
          <span class="row-sub">{segundaTocando.name ? `${contactNumberLine(segundaTocando.number)} · tocando` : 'tocando'}</span>
        </span>
        <button type="button" class="round-sm round-danger" aria-label="Recusar" title="Recusar" onClick={semSegundoClique(!ios, () => send({ cmd: 'reject' }))}>
          <IconPhone class="ic-hang" />
        </button>
        <button type="button" class="round-sm round-cyan" aria-label="Atender" title="Atender" onClick={semSegundoClique(!ios, () => send({ cmd: 'answer' }))}>
          <IconPhone />
        </button>
      </div>
    );
  }
  if (!outra) return null;
  const tempo = outra.activeSinceMs > 0 ? callTimer(now - outra.activeSinceMs) : statusLine(outra, now);
  // Na consulta com o colega em cima, o cartão é o cliente: "Em espera · transferência".
  const selo = consulta && l.colleagueActive ? 'Em espera · transferência' : 'Em espera';
  return (
    <div class="vcard">
      <Avatar card={outra} />
      <span class="row-main">
        <span class="row-title">{nameOrNumber(outra)}</span>
        <span class="row-sub">{outra.name ? `${contactNumberLine(outra.number)} · ${tempo}` : tempo}</span>
        {/* O selo longo vai embaixo do nome, para o nome e o tempo caberem inteiros. */}
        {consulta && <span class="tag tag-below">{selo}</span>}
      </span>
      {!consulta && <span class="tag">{selo}</span>}
      {!consulta && (
        <button
          type="button"
          class="round-sm round-danger round-xs"
          aria-label={`Desligar ${nameOrNumber(outra)}`}
          title={`Desligar ${nameOrNumber(outra)}`}
          onClick={semSegundoClique(!ios, () => send({ cmd: 'hangup', id: outra.id }))}
        >
          <IconPhone size="sm" class="ic-hang" />
        </button>
      )}
    </div>
  );
}

export function Ligacao({
  state,
  ligacao: l,
  contatos,
  daEmpresa,
  send,
  chat = null,
  ouvindoNoNavegador = false,
}: Props) {
  const now = useNow();
  const [painelPedido, setPainel] = useState<Painel>(null);
  const [digitos, setDigitos] = useState('');
  const [audioAberto, setAudioAberto] = useState(false);
  const audioRef = useRef<HTMLButtonElement>(null);
  // O botão Atalhos recebe o foco de volta quando o painel fecha pelo Fechar atalhos ou pelo Esc.
  const atalhosRef = useRef<HTMLButtonElement>(null);
  const [focarAtalhos, setFocarAtalhos] = useState(false);
  const painelDe = useRef(l.top.id);
  const top = l.top;
  const ios = isIos(state);
  // (iPhone) O bipe de cada tecla, com o Bipe ao digitar ligado.
  const bipe = ios && state.config.bipeTecla === true;

  // Os painéis são da ligação de cima: quando ela troca (a segunda atendida, Alternar, a volta da em espera), eles
  // fecham e os dígitos saem.
  useEffect(() => {
    if (top.id === painelDe.current) return;
    painelDe.current = top.id;
    setPainel(null);
    setDigitos('');
    setAudioAberto(false);
  }, [top.id]);

  const conferencia = l.conference && l.second !== null;
  const tocando = top.phase === 'ringing';
  const segundaTocando = !conferencia && l.secondKind === 'ringing' ? l.second : null;
  // (0.4.0) Com a sala embaixo (você na ligação de fora), a outra não é ela: a sala tem a faixa, e os controles são os de uma
  // ligação.
  const outra = !conferencia && l.secondKind === 'held' && !salaEmbaixo(l, salaDe(state)) ? l.second : null;
  const consulta = l.consulting && outra !== null;
  const falando = confirmada(top);
  const ambas = outra !== null && falando && confirmada(outra);

  // O painel só vale enquanto o estado deixa (a ligação que cai, a segunda que chega). Os atalhos, só com uma ligação
  // atendida (nunca com só uma recebida tocando), fora da consulta e da conferência, e com algum atalho. (0.4.0) O de
  // adicionar, enquanto o Adicionar pessoa vale (a segunda que toca, o vídeo que para e a espera o fecham).
  const temAtalhos = state.atalhos.length > 0;
  const podeAdicionarAgora = podeAdicionar(state, l);
  const painel: Painel =
    painelPedido === 'teclado' && falando && !tocando && !consulta
      ? 'teclado'
      : painelPedido === 'transferir' && falando && !consulta && !conferencia
        ? 'transferir'
        : painelPedido === 'nova' && falando && l.second === null
          ? 'nova'
          : painelPedido === 'atalhos' && falando && !tocando && !consulta && !conferencia && temAtalhos
            ? 'atalhos'
            : painelPedido === 'adicionar' && podeAdicionarAgora
              ? 'adicionar'
              : null;

  // (0.4.0) O pedido do painel de adicionar vale só enquanto adicionar vale: com o painel fechado pelo estado (a segunda que
  // toca, o vídeo que para, a espera), o pedido cai, e o painel não volta sozinho quando adicionar voltar a valer.
  useEffect(() => {
    if (painelPedido === 'adicionar' && !podeAdicionarAgora) setPainel(null);
  }, [painelPedido, podeAdicionarAgora]);

  const fecharAtalhos = () => {
    setPainel(null);
    setFocarAtalhos(true);
  };
  const fecharAtalhosRef = useRef(fecharAtalhos);
  fecharAtalhosRef.current = fecharAtalhos;
  useEffect(() => {
    if (!focarAtalhos || painel !== null) return;
    setFocarAtalhos(false);
    atalhosRef.current?.focus();
  }, [focarAtalhos, painel]);

  const dtmf = (tecla: string) => {
    send({ cmd: 'dtmf', digitos: tecla });
    if (bipe) send({ cmd: 'keyTone', tecla });
    setDigitos((d) => d + tecla);
  };
  const dtmfRef = useRef(dtmf);
  dtmfRef.current = dtmf;
  const painelRef = useRef(painel);
  painelRef.current = painel;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
      const alvo = e.target as HTMLElement;
      if (alvo.closest('input, textarea, select, [role="menu"], dialog')) return;
      if (painelRef.current === 'atalhos' && e.key === 'Escape') {
        e.preventDefault();
        fecharAtalhosRef.current();
        return;
      }
      if (painelRef.current !== 'teclado') return;
      if (/^[0-9*#]$/.test(e.key)) {
        e.preventDefault();
        dtmfRef.current(e.key);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setPainel(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const desligar = (card: CallCard) => send({ cmd: 'hangup', id: card.id });
  const contaNome = state.conta ? state.conta.nome || state.conta.ramal : '';
  const status = statusLine(top, now);
  const compacto = painel !== null;

  // (vídeo, etapa 2) O desenho com vídeo: numa ligação só, ou com a segunda quando a de cima é um porteiro (nunca na
  // conferência: o imagemDaLigacao), fora do toque, sem painel aberto e com a imagem da outra ponta chegando. Fora dele,
  // com a câmera ligada, a sua imagem flutua no canto.
  const video = videoDe(state, top);
  const comVideo = !tocando && imagemDaLigacao(l, video) && painel === null && video.imagem;
  const suaFlutuante = !comVideo && video.camera;
  // (vídeo, etapa 2) O porteiro que manda a imagem antes de atender: a imagem em cima, no lugar do avatar. O Atender com
  // vídeo, com o vídeo do app ligado, a oferta da que toca e nenhuma outra ligação em andamento (o
  // oferecerAtenderComVideo).
  const porteiro = tocando && video.cedo;
  const atenderComVideo = tocando && oferecerAtenderComVideo(state, top);

  // O que fica no alto: a faixa da segunda que toca, ou o cartão da outra (em espera).
  const temCartao = segundaTocando !== null || outra !== null;
  const cartao = temCartao ? <CartaoDaOutra state={state} ligacao={l} send={send} now={now} /> : null;

  // Quem fala: a área do vídeo, a conferência (os dois), ou a ligação de cima.
  let quem;
  if (comVideo) {
    quem = <CaixaDoVideo state={state} card={top} now={now} send={send} />;
  } else if (conferencia && l.second) {
    const segunda = l.second;
    quem = (
      <>
        <div class="who who-conf">
          <span class="eyebrow">Conferência</span>
          <span class="who-name">
            Você, {firstName(top)} e {firstName(segunda)}
          </span>
          <span class="timer">{callTimer(now - l.conferenceSinceMs)}</span>
          {painel === 'teclado' && digitos && <span class="dtmf">{ultimos(digitos)}</span>}
        </div>
        {!compacto && (
          <ul class="conf-list" aria-label="Participantes">
            {[top, segunda].map((card) => (
              <li class="vcard" key={card.id || card.number}>
                <Avatar card={card} />
                <span class="row-main">
                  <span class="row-title">{nameOrNumber(card)}</span>
                  {card.name && <span class="row-sub">{contactNumberLine(card.number)}</span>}
                </span>
                <IconSpeaking class="conf-ic" />
              </li>
            ))}
          </ul>
        )}
      </>
    );
  } else {
    // (0.4.0) Com o painel de adicionar, o alto dele diz que a ligação é uma videochamada (o quadro Adicionar).
    const eyebrow = tocando
      ? `Ligação recebida · ${contaNome}`
      : consulta && l.colleagueActive
        ? 'Consultando'
        : painel === 'adicionar'
          ? EM_VIDEOCHAMADA
          : 'Em ligação';
    const dele = (
      <div class={compacto ? 'who who-compact' : 'who'}>
        <span class="eyebrow">{eyebrow}</span>
        {!compacto && !porteiro && <Avatar card={top} large />}
        <span class="who-name">{nameOrNumber(top)}</span>
        {top.name && <span class="who-sub">{contactNumberLine(top.number)}</span>}
        {status && <span class="timer">{status}</span>}
        {top.held && !outra && <span class="tag">Em espera</span>}
        {painel === 'teclado' && digitos && <span class="dtmf">{ultimos(digitos)}</span>}
      </div>
    );
    quem = porteiro ? (
      <>
        <VistaDeVideo key={top.id} vista="remoto" desenhar={video.cedo} rotulo={rotuloDoVideo(nameOrNumber(top))} class="tocando-video" />
        {dele}
      </>
    ) : (
      dele
    );
  }

  const mudo = (
    <Ctrl
      label="Mudo"
      icon={l.muted ? <IconMicOff /> : <IconMic />}
      pressed={l.muted}
      onClick={() => send({ cmd: 'mute', on: !l.muted })}
    />
  );
  const teclado = (
    <Ctrl
      label="Teclado"
      icon={<IconKeypad />}
      pressed={painel === 'teclado'}
      disabled={!falando}
      onClick={() => setPainel(painel === 'teclado' ? null : 'teclado')}
    />
  );
  // (iPhone) A saída de agora, numa linha só (um nome de fone comprido sai com reticências; o nome do botão o tem inteiro),
  // e o toque pede a escolha do iPhone.
  const rota = state.rotaAudio ?? '';
  const audioCtrl = ios ? (
    <Ctrl
      label={<span class="ctrl-rota">{rota || 'Áudio'}</span>}
      nome={rota ? `Áudio: ${rota}` : undefined}
      icon={<IconSpeaker />}
      onClick={() => send({ cmd: 'audioRoute' })}
    />
  ) : (
    <div class="ctrl-wrap">
      <Ctrl
        label="Áudio"
        icon={<IconSpeaker />}
        popup
        expanded={audioAberto}
        ctrlRef={audioRef}
        onClick={() => setAudioAberto(!audioAberto)}
      />
      {audioAberto && <AudioMenu state={state} send={send} anchor={audioRef} onClose={() => setAudioAberto(false)} />}
    </div>
  );
  const espera = (
    <Ctrl label="Espera" icon={<IconPause />} pressed={top.held} disabled={!falando} onClick={() => send({ cmd: 'hold', on: !top.held })} />
  );
  const transferir = <Ctrl label="Transferir" icon={<IconArrowRight />} disabled={!falando} onClick={() => setPainel('transferir')} />;
  const alternar = <Ctrl label="Alternar" icon={<IconSwap />} disabled={!ambas} onClick={() => send({ cmd: 'swap' })} />;
  // rc.3: o painel com os atalhos (atendida, como o Transferir; sem nenhum atalho, nada a abrir). (iPhone) Sem ele.
  const atalhos = ios ? null : (
    <Ctrl label="Atalhos" icon={<IconBolt />} disabled={!falando || !temAtalhos} ctrlRef={atalhosRef} onClick={() => setPainel('atalhos')} />
  );
  // (vídeo, etapa 2) A Câmera, só com o vídeo ligado (nunca no iPhone): o nome diz a ação, e ela fica acesa com a
  // câmera ligada. Numa ligação, desligada, ela espera o atender e a volta da espera (o cameraDesativada); ligada,
  // sempre desliga. Com duas (a segunda tocando ou em espera, também na consulta), ela só desliga: o motor pausa a
  // câmera de todas (nada é mandado, nem a um porteiro), nenhuma câmera liga com duas ligações, e a que ainda aparece
  // ligada sempre tem como ser desligada (o cameraDaLigacaoDesativada, a mesma regra do grande).
  const cameraCtrl = videoDoApp(state).ligado ? (
    <Ctrl
      label={CAMERA}
      nome={video.camera ? DESLIGAR_A_CAMERA : LIGAR_A_CAMERA}
      icon={video.camera ? <IconVideo /> : <IconVideoOff />}
      aceso={video.camera}
      disabled={cameraDaLigacaoDesativada(l, video)}
      onClick={() => send({ cmd: 'camera', on: !video.camera })}
    />
  ) : null;

  // (vídeo, etapa 2) O Chat, com um colega do chat na ligação de cima (nunca no iPhone). Com a segunda tocando, ele espera,
  // como a Nova ligação: a conversa da ligação só fica na tela com uma (main.tsx).
  const chatCtrl =
    chat && !ios ? <Ctrl label={CHAT} icon={<IconMessage />} disabled={l.second !== null} onClick={chat.abrir} /> : null;
  // (0.4.0) O Adicionar pessoa, numa videochamada (o mostraAdicionar; nunca no iPhone): abre o painel de adicionar, e
  // espera a ligação sozinha, atendida e fora da espera (o podeAdicionar).
  const adicionarCtrl = mostraAdicionar(state, l) ? (
    <Ctrl label={ADICIONAR_PESSOA} icon={<IconAdicionarPessoa />} disabled={!podeAdicionar(state, l)} onClick={() => setPainel('adicionar')} />
  ) : null;

  // Os controles: na conferência, Mudo, Teclado e Separar (o motor pausa todo vídeo nela: sem a Câmera); na consulta,
  // Mudo, Câmera, Alternar e Cancelar; com duas, Mudo, Câmera, Teclado, Áudio, Espera, Transferir, Alternar, Juntar e
  // Atalhos; com uma, Mudo, Câmera, Adicionar pessoa, Chat, Teclado, Áudio, Espera, Transferir, Nova ligação e Atalhos. A
  // Câmera só vem com o vídeo ligado, o Adicionar pessoa numa videochamada e o Chat com um colega do chat; (iPhone) sem os
  // três e sem o Atalhos. O lugar de um que não vem fica vazio (null), e a tela não remonta os outros quando ele chega.
  let controles: Array<VNode | null>;
  if (conferencia) {
    controles = [mudo, teclado, <Ctrl label="Separar" icon={<IconSplit />} onClick={() => send({ cmd: 'split' })} />];
  } else if (consulta) {
    controles = [mudo, cameraCtrl, alternar, <Ctrl label="Cancelar" icon={<IconClose />} onClick={() => send({ cmd: 'cancelConsult' })} />];
  } else if (outra) {
    controles = [
      mudo,
      cameraCtrl,
      teclado,
      audioCtrl,
      espera,
      transferir,
      alternar,
      <Ctrl label="Juntar" icon={<IconMerge />} disabled={!ambas || l.consulting} onClick={() => send({ cmd: 'join' })} />,
      atalhos,
    ];
  } else {
    controles = [
      mudo,
      cameraCtrl,
      adicionarCtrl,
      chatCtrl,
      teclado,
      audioCtrl,
      espera,
      transferir,
      <Ctrl label="Nova ligação" icon={<IconPlus />} disabled={!falando || l.second !== null} onClick={() => setPainel('nova')} />,
      atalhos,
    ];
  }

  // O painel de número do Transferir e da Nova ligação: no Windows, pelo nome ou pelo número, com a lista dos meus e dos
  // da empresa (a lista pronta, a mesma da aba Contatos); no iPhone, só pelo número, com as sugestões da agenda.
  const painelDeNumero = (p: PainelProps) =>
    ios ? <NumberPanel {...p} contatos={contatos} /> : <PainelPorNome {...p} lista={listaDeContatos(contatos, daEmpresa).todas} />;

  let meio;
  if (tocando) {
    meio = null;
  } else if (painel === 'teclado') {
    meio = (
      <div class="call-keys" role="group" aria-label="Teclado da ligação">
        {TECLAS.map((tecla) => (
          <button type="button" class="key" key={tecla} onClick={() => dtmf(tecla)}>
            <b>{tecla}</b>
          </button>
        ))}
      </div>
    );
  } else if (painel === 'transferir') {
    meio = painelDeNumero({
      titulo: 'Transferir para',
      rotulo: 'Número para transferir',
      onCancel: () => setPainel(null),
      onContact: null,
      onEnter: null,
      actions: (numero, doContato) => {
          // O número de um contato escolhido, sem mudança depois, vai com a regra dos contatos (o `contato`), como no Ligar.
          const contato = doContato ? { contato: true } : {};
          return (
            <>
              {/* O Consultar é a segunda ligação: com duas, não. */}
              <button
                type="button"
                class="btn btn-outline-dark"
                disabled={!numero || l.second !== null}
                onClick={semSegundoClique(!ios, () => (setPainel(null), send({ cmd: 'consult', numero, ...contato })))}
              >
                Consultar
              </button>
              <button
                type="button"
                class="btn btn-cyan"
                disabled={!numero}
                onClick={semSegundoClique(!ios, () => (setPainel(null), send({ cmd: 'transfer', numero, ...contato })))}
              >
                Transferir agora
              </button>
            </>
          );
      },
    });
  } else if (painel === 'nova') {
    const ligar = (numero: string) => (setPainel(null), send({ cmd: 'dial', numero }));
    meio = painelDeNumero({
      titulo: 'Nova ligação',
      rotulo: 'Número da nova ligação',
      onCancel: () => setPainel(null),
      onContact: (numero) => (setPainel(null), send({ cmd: 'dial', numero, contato: true })),
      onEnter: ligar,
      actions: (numero) => (
        // O Rediscar da Nova ligação: a feita mais nova, pelo mesmo caminho do Ligar do painel (ele não usa o campo).
        <div class="call-row">
          <Rediscar recentes={state.recentes} id="rediscar-nova" onDial={ligar} noWindows={!ios} />
          <button type="button" class="btn btn-cyan btn-block" disabled={!numero} onClick={semSegundoClique(!ios, () => ligar(numero))}>
            <IconPhone size="sm" />
            Ligar
          </button>
        </div>
      ),
    });
  } else if (painel === 'atalhos') {
    meio = <AtalhosPainel atalhos={state.atalhos} ligacao={l} send={send} onClose={fecharAtalhos} onUsed={fecharAtalhos} />;
  } else if (painel === 'adicionar') {
    // (0.4.0) O painel de adicionar, com a lista dos meus e dos da empresa, como o Transferir. O número de um contato
    // escolhido, sem mudança depois, vai com o `contato`.
    meio = (
      <PainelDeAdicionar
        lista={listaDeContatos(contatos, daEmpresa).todas}
        onAdicionar={(numero, doContato) => {
          setPainel(null);
          send({ cmd: 'salaAdicionar', numero, ...(doContato ? { contato: true } : {}) });
        }}
        onCancel={() => setPainel(null)}
      />
    );
  } else {
    // As colunas seguem quantos controles há. Numa fila só: 3 (a conferência, e a consulta sem a Câmera) e 4 (a consulta
    // com ela). Em duas filas: 6 em três colunas (uma ligação no iPhone, sem o Atalhos), 7 e 8 em quatro, e 9 e 10 em
    // cinco (duas ligações com a Câmera; uma com a Câmera e o Adicionar pessoa ou o Chat, ou com os dois).
    const quantos = controles.filter((c) => c !== null).length;
    const grade = quantos >= 9 ? 'ctrls ctrls-5' : quantos >= 7 || quantos === 4 ? 'ctrls ctrls-4' : 'ctrls';
    meio = <div class={grade}>{controles}</div>;
  }

  let baixo;
  if (tocando) {
    baixo = (
      <div class={atenderComVideo ? 'call-actions call-actions-tres' : 'call-actions'}>
        <RoundAction label="Recusar" kind="hang" onClick={semSegundoClique(!ios, () => send({ cmd: 'reject' }))} />
        <RoundAction label="Atender" kind="answer" onClick={semSegundoClique(!ios, () => send({ cmd: 'answer' }))} />
        {atenderComVideo && (
          <RoundAction label={ATENDER_COM_VIDEO} kind="video" onClick={semSegundoClique(!ios, () => send({ cmd: 'answer', video: true }))} />
        )}
      </div>
    );
  } else if (consulta && outra) {
    const cliente = l.colleagueActive ? outra : top;
    const colega = l.colleagueActive ? top : outra;
    baixo = (
      <div class="consult-actions">
        <button type="button" class="btn btn-cyan btn-block btn-complete" disabled={!ambas} onClick={() => send({ cmd: 'completeTransfer' })}>
          <IconCheck />
          Concluir transferência
        </button>
        <p class="consult-note">
          {nameOrNumber(cliente)} passa a falar com {nameOrNumber(colega)}, e as duas ligações saem daqui.
        </p>
      </div>
    );
  } else {
    baixo = (
      <div class={painel === 'teclado' ? 'call-actions call-actions-keys' : 'call-actions'}>
        {painel === 'teclado' && <div class="call-side">{teclado}</div>}
        <RoundAction
          label={conferencia ? 'Desligar para todos' : 'Desligar'}
          kind="hang"
          onClick={semSegundoClique(!ios, () => desligar(top))}
        />
        {painel === 'teclado' && <div class="call-side" />}
      </div>
    );
  }

  // O painel de número (Transferir, Nova ligação) com um cartão em cima: na janela baixa, o bloco de quem fala sai
  // (app.css), para o painel caber entre o cartão e o Desligar.
  const painelComCartao = temCartao && (painel === 'transferir' || painel === 'nova' || painel === 'atalhos');
  // (0.4.0) Com o painel de adicionar, a sua imagem flutuante fica no canto de baixo, e quem fala (o alto do painel) não
  // estreita por ela (o app.css).
  const classes = [
    'call-body',
    painelComCartao ? 'call-painel-cartao' : '',
    comVideo ? 'call-com-video' : '',
    suaFlutuante ? (painel === 'adicionar' ? 'call-sua-embaixo' : 'call-sua-imagem') : '',
  ].filter(Boolean);
  // A sua imagem flutuante fica embaixo do cartão quando ele está em cima (o app.css): ela nunca cobre o Recusar, o
  // Atender e o Desligar dele. O cartão fica sempre na mesma caixa, e a câmera que liga não o remonta.
  const sua = suaFlutuante ? <SuaImagemFlutuante /> : null;
  return (
    <NoWindows.Provider value={!ios}>
      <main class={classes.join(' ')} aria-label={conferencia ? 'Conferência' : 'Ligação'}>
        {cartao ? (
          <div class="call-alto">
            {cartao}
            {sua}
          </div>
        ) : (
          sua
        )}
        {quem}
        {/* Sempre na página, para o leitor de tela dizer o texto quando ele aparece. */}
        <AvisoOuvindo ouvindo={ouvindoNoNavegador} />
        <div class="call-middle">{meio}</div>
        {baixo}
      </main>
    </NoWindows.Provider>
  );
}
