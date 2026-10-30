// A tela Entrar (sem conta em uso, ou a conta em uso sem a senha) e o mesmo formulário em Adicionar e Editar conta.
// As validações e as mensagens são do C++: a interface manda o `login` com os campos como estão e mostra
// `entrar.erro` embaixo da senha. Com `entrar.ocupado`, "Conectando…" e os campos travados; o formulário de
// Adicionar/Editar fecha quando `ocupado` passa de true para false sem erro. Com `entrar.podeCancelar` (a senha de
// uma troca de conta), o Cancelar volta para a conta em uso (cancelLogin).
import { useEffect, useRef, useState } from 'preact/hooks';
import { BackBar } from '../components/BackBar';
import { Confirm } from '../components/Confirm';
import { IconAlert, IconArrowRight, IconEye, IconEyeOff } from '../icons';
import { isIos } from '../plataforma';
import { EXTERNAL_URLS, type AppState, type Protocol, type SavedAccount } from '../state';
import type { Send } from '../types';

interface Props {
  state: AppState;
  send: Send;
  /** entrar: a tela inteira; adicionar/editar: um formulário com Voltar. */
  mode: 'entrar' | 'adicionar' | 'editar';
  conta?: SavedAccount;
  onClose?(): void;
}

interface Campos {
  servidor: string;
  protocolo: Protocol;
  ramal: string;
  senha: string;
  nome: string;
}

export function Entrar({ state, send, mode, conta, onClose }: Props) {
  const entrar = state.entrar;
  const contaId = mode === 'adicionar' ? '' : (conta?.id ?? entrar.contaId);
  // O `entrar` do estado vale para este formulário quando é da mesma conta (ou de uma nova, sem contaId).
  const doFormulario = entrar.contaId === contaId;
  const [enviado, setEnviado] = useState(false);
  const [campos, setCampos] = useState<Campos>(() =>
    conta && !(doFormulario && entrar.servidor)
      ? { servidor: conta.servidor, protocolo: conta.protocolo, ramal: conta.ramal, senha: '', nome: conta.nome }
      : { servidor: entrar.servidor, protocolo: entrar.protocolo, ramal: entrar.ramal, senha: '', nome: entrar.nome },
  );
  const [mostrar, setMostrar] = useState(false);
  const [remover, setRemover] = useState(false);

  // O C++ devolve os campos digitados (depois de uma mensagem) ou a conta que pede a senha.
  const primeiro = useRef(true);
  useEffect(() => {
    if (primeiro.current) {
      primeiro.current = false;
      return;
    }
    if (!doFormulario) return;
    setCampos((c) => ({ ...c, servidor: entrar.servidor, protocolo: entrar.protocolo, ramal: entrar.ramal, nome: entrar.nome }));
  }, [entrar.servidor, entrar.protocolo, entrar.ramal, entrar.nome, entrar.contaId]);

  const ocupadoAntes = useRef(entrar.ocupado);
  useEffect(() => {
    if (enviado && ocupadoAntes.current && !entrar.ocupado && entrar.erro === '') onClose?.();
    ocupadoAntes.current = entrar.ocupado;
  }, [entrar.ocupado, entrar.erro]);

  const erro = mode === 'entrar' || enviado ? entrar.erro : '';
  const ocupado = entrar.ocupado;
  const mudar = (chave: keyof Campos) => (e: Event) => setCampos({ ...campos, [chave]: (e.currentTarget as HTMLInputElement).value });

  const enviar = (e: Event) => {
    e.preventDefault();
    if (ocupado) return;
    setEnviado(true);
    send({
      cmd: 'login',
      servidor: campos.servidor,
      protocolo: campos.protocolo,
      ramal: campos.ramal,
      senha: campos.senha,
      nome: campos.nome,
      ...(contaId ? { contaId } : {}),
    });
  };

  // O número da ajuda é texto, para ler ou copiar: o app é o tratador do tel: (o instalador o registra), e um link só
  // encheria o Teclado escondido. (iPhone) Lá ele é um botão: o toque abre o discador do iPhone com o suporte.
  const ajuda = isIos(state) ? (
    <p class="help">
      Precisa de ajuda?{' '}
      <button
        type="button"
        class="help-numero help-ligar"
        aria-label="Ligar para (11) 5060-3000"
        onClick={() => send({ cmd: 'openExternal', url: EXTERNAL_URLS.suporte })}
      >
        (11) 5060-3000
      </button>
    </p>
  ) : (
    <p class="help">
      Precisa de ajuda? <span class="help-numero">(11) 5060-3000</span>
    </p>
  );

  return (
    <>
      {mode === 'entrar' ? (
        <header class="brand" style={{ padding: '26px 24px 26px', gap: '16px' }}>
          <div class="brand-glow" aria-hidden="true" />
          <img
            class="logo"
            src="assets/starsonic-logo-negativo.png"
            width={190}
            height={58}
            alt="Starsonic soluções de voz e dados"
            style={{ width: '190px', position: 'relative', zIndex: 1 }}
          />
          <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <p class="eyebrow" style={{ color: '#00c2cb' }}>
              Ramal no computador
            </p>
            <h1 class="h1" style={{ color: '#ffffff', fontSize: '24px' }}>
              Entre com o seu ramal
            </h1>
          </div>
        </header>
      ) : (
        <BackBar title={mode === 'editar' ? 'Editar conta' : 'Adicionar conta'} onBack={() => onClose?.()} />
      )}
      <form class="body form scroll" onSubmit={enviar} noValidate>
        <fieldset disabled={ocupado} style={{ display: 'contents' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 120px', gap: '10px', alignItems: 'end' }}>
            <div class="field">
              <label class="label" for="entrar-servidor">
                Servidor (endereço ou IP)
              </label>
              <input
                id="entrar-servidor"
                class="input"
                autocomplete="off"
                spellcheck={false}
                autocapitalize="off"
                value={campos.servidor}
                onInput={mudar('servidor')}
                autofocus={mode !== 'editar' && !campos.servidor}
              />
            </div>
            <fieldset class="field">
              <legend class="label" style={{ marginBottom: '6px' }}>
                Protocolo
              </legend>
              <div class="seg">
                {(['udp', 'tcp'] as const).map((p) => (
                  <label key={p}>
                    <input
                      type="radio"
                      name="protocolo"
                      value={p}
                      checked={campos.protocolo === p}
                      onChange={() => setCampos({ ...campos, protocolo: p })}
                    />
                    {p.toUpperCase()}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <div class="field">
            <label class="label" for="entrar-ramal">
              Ramal
            </label>
            <input id="entrar-ramal" class="input" inputMode="numeric" autocomplete="off" value={campos.ramal} onInput={mudar('ramal')} />
          </div>
          <div class="field">
            <label class="label" for="entrar-senha">
              Senha
            </label>
            <div class="input-wrap">
              <input
                id="entrar-senha"
                class="input"
                type={mostrar ? 'text' : 'password'}
                autocomplete="off"
                value={campos.senha}
                onInput={mudar('senha')}
                placeholder={mode === 'editar' ? 'Vazia, continua a mesma' : undefined}
                aria-invalid={erro ? 'true' : undefined}
                aria-describedby={erro ? 'entrar-erro' : undefined}
                autofocus={entrar.pedeSenha}
              />
              <button
                type="button"
                class="reveal"
                aria-label="Mostrar a senha"
                aria-pressed={mostrar}
                title={mostrar ? 'Esconder a senha' : 'Mostrar a senha'}
                onClick={() => setMostrar(!mostrar)}
              >
                {mostrar ? <IconEyeOff size="sm" /> : <IconEye size="sm" />}
              </button>
            </div>
            {erro && (
              <p class="field-error" id="entrar-erro" role="alert">
                <IconAlert size="sm" />
                <span>{erro}</span>
              </p>
            )}
          </div>
          <div class="field">
            <label class="label" for="entrar-nome">
              Nome da conta (opcional)
            </label>
            <input id="entrar-nome" class="input" autocomplete="off" placeholder="Ex.: Recepção" value={campos.nome} onInput={mudar('nome')} />
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-cyan btn-block" style={{ height: '50px' }} disabled={ocupado}>
              {ocupado ? (
                'Conectando…'
              ) : (
                <>
                  Entrar
                  <IconArrowRight size="sm" />
                </>
              )}
            </button>
            {mode === 'entrar' && entrar.podeCancelar && (
              <button type="button" class="btn btn-outline btn-block" disabled={ocupado} onClick={() => send({ cmd: 'cancelLogin' })}>
                Cancelar
              </button>
            )}
            {mode === 'editar' && conta && (
              <button
                type="button"
                class="btn btn-outline btn-block"
                disabled={ocupado || (conta.emUso && state.ligacao !== null)}
                onClick={() => setRemover(true)}
              >
                Remover
              </button>
            )}
          </div>
        </fieldset>
        {ajuda}
      </form>
      {remover && conta && (
        <Confirm
          title="Remover conta"
          message={`A conta ${conta.nome || conta.ramal} sai deste computador.`}
          confirmLabel="Remover"
          onCancel={() => setRemover(false)}
          onConfirm={() => {
            send({ cmd: 'removeAccount', contaId: conta.id });
            setRemover(false);
            onClose?.();
          }}
        />
      )}
    </>
  );
}
