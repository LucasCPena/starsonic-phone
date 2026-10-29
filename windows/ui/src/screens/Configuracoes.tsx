// As Configurações: Contas (a lista, a em uso marcada, Editar e "Adicionar conta"), Áudio (Microfone, Alto-falante
// e Toque), Ligações ((rc.3) o bipe do fim da ligação, Atender automaticamente e o tempo, Iniciar com o Windows) e
// (rc.4) Contatos (a planilha da empresa: o link ou o caminho, o Salvar, a ajuda, a situação da leitura e o "Atualizar
// agora"). O Atender automaticamente e o tempo somem quando o administrador esconde o Atender automático.
import { useEffect, useRef, useState } from 'preact/hooks';
import { BackBar } from '../components/BackBar';
import { accountDot, accountTitle, autoAnswerLine, contactCount, readTime } from '../format';
import { IconAlert, IconChevronDown, IconPencil, IconPlus } from '../icons';
import type { AppState, AudioDevice, CompanyList } from '../state';
import type { Send } from '../types';

interface Props {
  state: AppState;
  send: Send;
  onBack(): void;
  onEditAccount(contaId: string): void;
  onAddAccount(): void;
}

const PADRAO = 'Padrão do Windows';
const TEMPOS = [0, 1, 2, 3, 5, 8, 10, 15, 20, 30];

interface Opcao {
  valor: string;
  texto: string;
}

/** As opções de um dispositivo do motor: o padrão, os de agora e o escolhido que está desconectado. */
function deviceOptions(lista: AudioDevice[], escolhido: string, desconectados: string[]): Opcao[] {
  const opcoes: Opcao[] = [{ valor: '', texto: PADRAO }];
  const vistos = new Set<string>();
  for (const d of lista) {
    if (vistos.has(d.nome)) continue;
    vistos.add(d.nome);
    opcoes.push({ valor: d.nome, texto: desconectados.includes(d.nome) ? `${d.nome} (desconectado)` : d.nome });
  }
  if (escolhido && !vistos.has(escolhido)) opcoes.push({ valor: escolhido, texto: `${escolhido} (desconectado)` });
  return opcoes;
}

/** As saídas de som da própria interface (o toque toca no WebView2, pelo setSinkId). */
function useOutputDevices(): Opcao[] {
  const [saidas, setSaidas] = useState<Opcao[]>([]);
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices) return;
    let vivo = true;
    const ler = () =>
      md
        .enumerateDevices()
        .then((lista) => {
          if (!vivo) return;
          const fora = lista.filter((d) => d.kind === 'audiooutput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
          setSaidas(fora.map((d, i) => ({ valor: d.deviceId, texto: d.label || `Saída de som ${i + 1}` })));
        })
        .catch(() => undefined);
    ler();
    md.addEventListener?.('devicechange', ler);
    return () => {
      vivo = false;
      md.removeEventListener?.('devicechange', ler);
    };
  }, []);
  return saidas;
}

function Select({ id, value, options, onChange }: { id: string; value: string; options: Opcao[]; onChange(v: string): void }) {
  return (
    <span class="select">
      <select id={id} value={value} onChange={(e) => onChange(e.currentTarget.value)}>
        {options.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.texto}
          </option>
        ))}
      </select>
      <IconChevronDown size="sm" />
    </span>
  );
}

const AJUDA_DA_PLANILHA =
  'Cole o link do Google Planilhas ou do OneDrive/SharePoint, compartilhado para qualquer pessoa com o link, ou o caminho do arquivo na rede.';

/**
 * (rc.4) A planilha da empresa (spec da rc.4, 5.1): o campo com o link ou o caminho e o Salvar (também o Enter; vazio
 * tira a lista), a ajuda, a situação da leitura e o "Atualizar agora" (desligado sem o link e enquanto lê). O erro vem
 * do C++ com o texto pronto; com uma lista de antes, a hora e o tamanho dela embaixo.
 */
function PlanilhaDaEmpresa({ empresa, send }: { empresa: CompanyList; send: Send }) {
  const [link, setLink] = useState(empresa.link);
  // O campo segue o link salvo que vem no estado (o C++ grava sem os espaços das pontas), menos o que a pessoa digitou
  // depois do último Salvar: o estado dele pode chegar com ela já digitando outro.
  const editando = useRef(false);
  useEffect(() => {
    if (!editando.current) setLink(empresa.link);
  }, [empresa.link]);
  return (
    <>
      <form
        class="field cfg-planilha"
        onSubmit={(e) => {
          e.preventDefault();
          editando.current = false;
          send({ cmd: 'setCompanyList', link });
        }}
      >
        <label class="label" for="cfg-planilha">
          Planilha da empresa
        </label>
        <div class="cfg-planilha-campo">
          <input
            id="cfg-planilha"
            class="input"
            autocomplete="off"
            spellcheck={false}
            autocapitalize="off"
            value={link}
            aria-describedby="cfg-planilha-ajuda"
            onInput={(e) => {
              editando.current = true;
              setLink(e.currentTarget.value);
            }}
          />
          <button type="submit" class="btn btn-cyan mini">
            Salvar
          </button>
        </div>
        <p class="help-campo" id="cfg-planilha-ajuda">
          {AJUDA_DA_PLANILHA}
        </p>
      </form>
      <div class="cfg-leitura">
        {/* Sempre na página (vazia em "nenhuma"): o leitor de tela diz cada situação nova. */}
        <div class="cfg-situacao" id="cfg-planilha-situacao" role="status">
          {empresa.situacao === 'lendo' && <p>Lendo a planilha…</p>}
          {empresa.situacao === 'ok' && <p>{`Atualizada ${readTime(empresa.atualizadaEm)} · ${contactCount(empresa.quantos)}`}</p>}
          {empresa.situacao === 'erro' && (
            <>
              <p class="field-error">
                <IconAlert size="sm" />
                <span>{empresa.erro}</span>
              </p>
              {empresa.atualizadaEm > 0 && <p>{`Última lista: ${readTime(empresa.atualizadaEm)} · ${contactCount(empresa.quantos)}`}</p>}
            </>
          )}
        </div>
        <button
          type="button"
          class="btn btn-outline mini"
          disabled={empresa.link === '' || empresa.situacao === 'lendo'}
          aria-describedby="cfg-planilha-situacao"
          onClick={() => send({ cmd: 'refreshCompanyList' })}
        >
          Atualizar agora
        </button>
      </div>
    </>
  );
}

export function Configuracoes({ state, send, onBack, onEditAccount, onAddAccount }: Props) {
  const { audio, atenderAutomatico: auto } = state;
  const saidas = useOutputDevices();
  const toques: Opcao[] = [{ valor: '', texto: PADRAO }, ...saidas];
  if (audio.toque && !saidas.some((s) => s.valor === audio.toque)) toques.push({ valor: audio.toque, texto: 'Dispositivo escolhido (desconectado)' });
  const tempos = TEMPOS.includes(auto.segundos) ? TEMPOS : [...TEMPOS, auto.segundos].sort((a, b) => a - b);

  return (
    <>
      <BackBar title="Configurações" onBack={onBack} />
      <div class="body scroll" style={{ gap: '10px', paddingTop: '16px' }}>
        <h2 class="eyebrow">Contas</h2>
        <div class="card">
          {state.contas.map((c) => (
            <div class="set-row" key={c.id}>
              {/* A conta em uso: a bolinha do cabeçalho (verde conectado, ciano conectando, cinza sem conexão e no erro). */}
              <span class={c.emUso && state.conta ? accountDot(state.conta, state.ligacao !== null, state.naoPerturbe).dot : 'dot dot-off'} aria-hidden="true" />
              <span class="row-main">
                <span class="row-title">{accountTitle(c)}</span>
                <span class="row-sub">{`${c.servidor} · ${c.protocolo.toUpperCase()}${c.emUso ? ' · em uso' : ''}`}</span>
              </span>
              <button
                type="button"
                class="row-call"
                aria-label={`Editar a conta ${c.nome || c.ramal}`}
                title="Editar"
                style={{ width: '34px', height: '34px' }}
                onClick={() => onEditAccount(c.id)}
              >
                <IconPencil size="sm" />
              </button>
            </div>
          ))}
          <div class="set-row">
            <button type="button" class="link" onClick={onAddAccount}>
              <IconPlus size="sm" />
              Adicionar conta
            </button>
          </div>
        </div>

        <h2 class="eyebrow" style={{ marginTop: '4px' }}>
          Áudio
        </h2>
        <div class="card">
          <div class="set-row">
            <label class="row-main row-title set-title" for="cfg-microfone">
              Microfone
            </label>
            <Select
              id="cfg-microfone"
              value={audio.microfone}
              options={deviceOptions(audio.microfones, audio.microfone, audio.desconectados)}
              onChange={(v) => send({ cmd: 'setAudio', microfone: v })}
            />
          </div>
          <div class="set-row">
            <label class="row-main row-title set-title" for="cfg-alto-falante">
              Alto-falante
            </label>
            <Select
              id="cfg-alto-falante"
              value={audio.altoFalante}
              options={deviceOptions(audio.altoFalantes, audio.altoFalante, audio.desconectados)}
              onChange={(v) => send({ cmd: 'setAudio', altoFalante: v })}
            />
          </div>
          <div class="set-row">
            <label class="row-main row-title set-title" for="cfg-toque">
              Toque
            </label>
            <Select id="cfg-toque" value={audio.toque} options={toques} onChange={(v) => send({ cmd: 'setAudio', toque: v })} />
          </div>
        </div>

        <h2 class="eyebrow" style={{ marginTop: '4px' }}>
          Ligações
        </h2>
        <div class="card">
          <div class="set-row">
            <span class="row-main">
              <span class="row-title set-title wrap" id="cfg-bipe">
                Bipe quando a ligação cai ou termina
              </span>
              <span class="row-sub wrap" id="cfg-bipe-sub">
                Vem ligado. Um bipe curto no fone quando a outra pessoa desliga ou a ligação cai.
              </span>
            </span>
            <button
              type="button"
              class="switch"
              role="switch"
              aria-checked={state.config.bipeFim}
              aria-labelledby="cfg-bipe"
              aria-describedby="cfg-bipe-sub"
              onClick={() => send({ cmd: 'setSetting', chave: 'bipeFim', valor: !state.config.bipeFim })}
            />
          </div>
          {state.admin.atenderAuto && (
            <>
              <div class="set-row">
                <span class="row-main">
                  <span class="row-title set-title" id="cfg-auto">
                    Atender automaticamente
                  </span>
                  <span class="row-sub" id="cfg-auto-sub">
                    {autoAnswerLine(auto.segundos)}
                  </span>
                </span>
                <button
                  type="button"
                  class="switch"
                  role="switch"
                  aria-checked={auto.on}
                  aria-labelledby="cfg-auto"
                  aria-describedby="cfg-auto-sub"
                  onClick={() => send({ cmd: 'setAutoAnswer', on: !auto.on })}
                />
              </div>
              <div class="set-row">
                <label class="row-main row-title set-title" for="cfg-tempo">
                  Tempo para atender
                </label>
                <Select
                  id="cfg-tempo"
                  value={String(auto.segundos)}
                  options={tempos.map((s) => ({ valor: String(s), texto: s === 0 ? 'Na hora' : `${s} s` }))}
                  onChange={(v) => send({ cmd: 'setAutoAnswer', on: auto.on, segundos: Number(v) })}
                />
              </div>
            </>
          )}
          <div class="set-row">
            <span class="row-main">
              <span class="row-title set-title" id="cfg-iniciar">
                Iniciar com o Windows
              </span>
              <span class="row-sub" id="cfg-iniciar-sub">
                Na bandeja, pronto para receber
              </span>
            </span>
            <button
              type="button"
              class="switch"
              role="switch"
              aria-checked={state.iniciarComWindows}
              aria-labelledby="cfg-iniciar"
              aria-describedby="cfg-iniciar-sub"
              onClick={() => send({ cmd: 'setSetting', chave: 'iniciarComWindows', valor: !state.iniciarComWindows })}
            />
          </div>
        </div>

        <h2 class="eyebrow" style={{ marginTop: '4px' }}>
          Contatos
        </h2>
        <div class="card">
          <PlanilhaDaEmpresa empresa={state.empresa} send={send} />
        </div>
      </div>
    </>
  );
}
