// A área do administrador (rc.3, spec 6.2), só com ela aberta no C++ (main.tsx): os botões da tela principal (Não
// perturbe e Atender automático: mostrar ou esconder), os atalhos (o BLF, o puxar ligação e o código), os servidores
// (a tabela de portas, UDP e TCP; os de fora dela usam a porta da conta, 5060) e o canal de atualização. Cada mudança
// vai num adminSet com só o que mudou (os servidores, a lista inteira); o C++ confere (a loja) e recusa com um toast, e
// a tela segue o estado. "Sair da área do administrador" manda o adminLogout.
import { useEffect, useRef, useState } from 'preact/hooks';
import { BackBar } from '../components/BackBar';
import { IconPlus } from '../icons';
import type { AdminServer, AdminState, Command } from '../state';
import type { Send } from '../types';

type AdminAberta = Extract<AdminState, { aberto: true }>;

interface Props {
  admin: AdminAberta;
  send: Send;
  onBack(): void;
  /** Saiu da área (o adminLogout já foi). */
  onLeave(): void;
}

/** A porta dos servidores fora da tabela: a da [conta] do perfil (a ponte não a manda; Ruling 3). */
const PORTA_DOS_OUTROS = 5060;
const AJUDA_DO_CODIGO = 'Depende da central do cliente. {ramal} vira o número do ramal que está tocando (ex.: **2007 ou *8).';

function Chave({ id, titulo, ajuda, ligada, onChange }: { id: string; titulo: string; ajuda: string; ligada: boolean; onChange(v: boolean): void }) {
  return (
    <div class="set-row">
      <span class="row-main">
        <span class="row-title set-title wrap" id={id}>
          {titulo}
        </span>
        <span class="row-sub wrap" id={`${id}-ajuda`}>
          {ajuda}
        </span>
      </span>
      <button
        type="button"
        class="switch"
        role="switch"
        aria-checked={ligada}
        aria-labelledby={id}
        aria-describedby={`${id}-ajuda`}
        onClick={() => onChange(!ligada)}
      />
    </div>
  );
}

/** O código de puxar: vai quando a pessoa termina de digitar (Enter ou ao sair do campo), uma vez por valor. */
function CodigoPuxar({ codigo, send }: { codigo: string; send: Send }) {
  const [valor, setValor] = useState(codigo);
  const ultimo = useRef(codigo);
  // O C++ gravou (ou outro valor chegou): o campo segue o estado. Recusado, o estado não muda e o campo fica.
  useEffect(() => {
    setValor(codigo);
    ultimo.current = codigo;
  }, [codigo]);
  const mandar = () => {
    if (valor === ultimo.current) return;
    ultimo.current = valor;
    send({ cmd: 'adminSet', codigoPuxar: valor });
  };
  return (
    <form
      class="field adm-codigo"
      onSubmit={(e) => {
        e.preventDefault();
        mandar();
      }}
    >
      <label class="label" for="adm-codigo">
        Código para puxar a ligação
      </label>
      <input
        id="adm-codigo"
        class="input"
        autocomplete="off"
        spellcheck={false}
        autocapitalize="off"
        value={valor}
        aria-describedby="adm-codigo-ajuda"
        onInput={(e) => setValor(e.currentTarget.value)}
        onBlur={mandar}
      />
      <p class="help-campo" id="adm-codigo-ajuda">
        {AJUDA_DO_CODIGO}
      </p>
    </form>
  );
}

/** A tabela de portas: Editar (endereço e porta, Remover), "Outros servidores" e Adicionar servidor. */
function Servidores({ servidores, send }: { servidores: AdminServer[]; send: Send }) {
  const [editando, setEditando] = useState<number | 'novo' | null>(null);
  const [endereco, setEndereco] = useState('');
  const [porta, setPorta] = useState('');
  const campo = useRef<HTMLInputElement>(null);
  // Os botões a que o foco volta quando o formulário fecha: o Editar de cada linha e o "Adicionar servidor".
  const botoesEditar = useRef<Array<HTMLButtonElement | null>>([]);
  const botaoAdicionar = useRef<HTMLButtonElement>(null);
  // O que abriu o formulário (a linha ou o "Adicionar servidor"), até o foco voltar a ele; sem ele, não há o que devolver.
  const voltaA = useRef<number | 'novo' | null>(null);
  // A lista de quando a mudança saiu: quando o estado traz outra, o C++ gravou e o formulário fecha; recusada (o toast
  // diz o motivo), o estado não muda e o formulário fica com o que foi digitado.
  const enviadaDe = useRef<string | null>(null);
  const lista = JSON.stringify(servidores);
  useEffect(() => {
    if (enviadaDe.current === null || enviadaDe.current === lista) return;
    enviadaDe.current = null;
    setEditando(null);
  }, [lista]);
  useEffect(() => {
    if (editando !== null) {
      campo.current?.focus();
      return;
    }
    // O formulário fechou (Cancelar, gravou, removeu): o foco volta ao botão que o abriu, ou ao "Adicionar servidor" se
    // a linha saiu. Só se o foco ficou sem lugar (o <body>: o botão do formulário saiu da tela): se a pessoa o levou a
    // outro controle enquanto o C++ gravava, ele fica lá.
    const alvo = voltaA.current;
    voltaA.current = null;
    if (alvo === null || (document.activeElement && document.activeElement !== document.body)) return;
    ((typeof alvo === 'number' ? botoesEditar.current[alvo] : null) ?? botaoAdicionar.current)?.focus();
  }, [editando]);

  const abrir = (qual: number | 'novo') => {
    enviadaDe.current = null;
    voltaA.current = qual;
    setEditando(qual);
    setEndereco(qual === 'novo' ? '' : servidores[qual].endereco);
    setPorta(qual === 'novo' ? '' : String(servidores[qual].porta));
  };
  const fechar = () => {
    enviadaDe.current = null;
    setEditando(null);
  };
  const mandar = (nova: AdminServer[]) => {
    enviadaDe.current = lista;
    send({ cmd: 'adminSet', servidores: nova } satisfies Command);
  };
  const salvar = (e: Event) => {
    e.preventDefault();
    const item: AdminServer = { endereco: endereco.trim(), porta: Number(porta) };
    if (!item.endereco || !Number.isInteger(item.porta)) return;
    if (editando === 'novo') {
      mandar([...servidores, item]);
    } else if (editando !== null) {
      const antes = servidores[editando];
      // Nada mudou (o C++ grava o endereço em minúsculas): só fecha.
      if (antes && antes.endereco === item.endereco.toLowerCase() && antes.porta === item.porta) {
        fechar();
        return;
      }
      mandar(servidores.map((s, i) => (i === editando ? item : s)));
    }
  };

  const formulario = (
    <form class="srv-form" onSubmit={salvar}>
      <div class="srv-campos">
        <div class="field">
          <label class="label" for="srv-endereco">
            Endereço
          </label>
          <input
            ref={campo}
            id="srv-endereco"
            class="input"
            autocomplete="off"
            spellcheck={false}
            autocapitalize="off"
            value={endereco}
            onInput={(e) => setEndereco(e.currentTarget.value)}
          />
        </div>
        <div class="field">
          <label class="label" for="srv-porta">
            Porta
          </label>
          <input
            id="srv-porta"
            class="input"
            inputMode="numeric"
            autocomplete="off"
            value={porta}
            onInput={(e) => {
              const valor = e.currentTarget.value.replace(/\D/g, '').slice(0, 5);
              e.currentTarget.value = valor;
              setPorta(valor);
            }}
          />
        </div>
      </div>
      <div class="srv-acoes">
        {typeof editando === 'number' && (
          <button
            type="button"
            class="btn btn-outline mini"
            onClick={() => {
              // A linha vai sair: o foco volta ao "Adicionar servidor", e não ao Editar da que subir para o lugar dela.
              voltaA.current = 'novo';
              mandar(servidores.filter((_, i) => i !== editando));
            }}
          >
            Remover
          </button>
        )}
        <button type="button" class="btn btn-outline mini" onClick={fechar}>
          Cancelar
        </button>
        <button type="submit" class="btn btn-cyan mini" disabled={!endereco.trim() || !porta}>
          Salvar servidor
        </button>
      </div>
    </form>
  );

  return (
    <div class="card">
      {servidores.map((s, i) =>
        editando === i ? (
          <div key={s.endereco}>{formulario}</div>
        ) : (
          <div class="set-row" key={s.endereco}>
            <span class="row-main">
              <span class="row-title set-title">{s.endereco}</span>
              <span class="row-sub">{`Porta ${s.porta} · UDP e TCP`}</span>
            </span>
            <button
              ref={(botao) => {
                botoesEditar.current[i] = botao;
              }}
              type="button"
              class="btn btn-outline mini"
              aria-label={`Editar o servidor ${s.endereco}`}
              onClick={() => abrir(i)}
            >
              Editar
            </button>
          </div>
        ),
      )}
      {editando === 'novo' && formulario}
      <div class="set-row">
        <span class="row-sub">{`Outros servidores · porta ${PORTA_DOS_OUTROS}`}</span>
      </div>
      {editando !== 'novo' && (
        <div class="set-row">
          <button ref={botaoAdicionar} type="button" class="adm-adicionar" onClick={() => abrir('novo')}>
            <IconPlus size="sm" />
            Adicionar servidor
          </button>
        </div>
      )}
    </div>
  );
}

export function Admin({ admin, send, onBack, onLeave }: Props) {
  // Ruling 4: o canal "" é o do build, o de teste nestas versões.
  const canal = admin.canal === '' ? 'teste' : admin.canal;
  return (
    <>
      <BackBar eyebrow="Starsonic" title="Área do administrador" onBack={onBack} focarTitulo />
      <div class="body scroll adm">
        <h2 class="eyebrow">Botões da tela principal</h2>
        <div class="card">
          <Chave
            id="adm-dnd"
            titulo="Não perturbe"
            ajuda="Desligado: o botão some e ninguém liga o Não perturbe."
            ligada={admin.naoPerturbe}
            onChange={(v) => send({ cmd: 'adminSet', naoPerturbe: v })}
          />
          <Chave
            id="adm-auto"
            titulo="Atender automático"
            ajuda="Desligado: o botão some da tela principal."
            ligada={admin.atenderAuto}
            onChange={(v) => send({ cmd: 'adminSet', atenderAuto: v })}
          />
        </div>

        <h2 class="eyebrow">Atalhos</h2>
        <div class="card">
          <Chave
            id="adm-blf"
            titulo="BLF nos atalhos"
            ajuda="Mostra se cada ramal está livre, ocupado ou tocando. O servidor precisa ter o BLF ligado."
            ligada={admin.blf}
            onChange={(v) => send({ cmd: 'adminSet', blf: v })}
          />
          <Chave
            id="adm-puxar"
            titulo="Puxar ligação pelo atalho"
            ajuda="Clicar num ramal tocando atende a ligação dele."
            ligada={admin.puxar}
            onChange={(v) => send({ cmd: 'adminSet', puxar: v })}
          />
          <CodigoPuxar codigo={admin.codigoPuxar} send={send} />
        </div>

        <h2 class="eyebrow">Servidores</h2>
        <Servidores servidores={admin.servidores} send={send} />

        <h2 class="eyebrow">Atualizações</h2>
        <div class="card">
          <fieldset class="field adm-canal">
            <legend class="label adm-canal-titulo">Canal</legend>
            <div class="seg">
              {(['teste', 'estavel'] as const).map((c) => (
                <label key={c}>
                  <input type="radio" name="adm-canal" value={c} checked={canal === c} onChange={() => send({ cmd: 'adminSet', canal: c })} />
                  {c === 'teste' ? 'Teste' : 'Estável'}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <button
          type="button"
          class="btn btn-outline btn-block adm-sair"
          onClick={() => {
            send({ cmd: 'adminLogout' });
            onLeave();
          }}
        >
          Sair da área do administrador
        </button>
      </div>
    </>
  );
}
