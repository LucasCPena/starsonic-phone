// A Nova reunião (o quadro NovaReuniao, a tela 3), no lugar das abas: "REUNIÕES" em cima do título e o Voltar; o
// Assunto (opcional, até 120 caracteres), o Dia e a Hora (abrindo no dia de hoje e na próxima meia hora), até quando o
// link vale (o fim do dia da reunião, ou outro dia e hora) e o "Criar a reunião". Os erros vão num `alert`, junto do
// campo deles, e o formulário fica como estava: os dois da conferência (o dia que passou, a validade além dos 31 dias),
// os do servidor (as 100 reuniões, o 400 de um dos campos, o 429) e a falta de resposta. Enquanto o pedido está no ar,
// o botão fica desligado: um segundo clique (ou um Enter) não cria outra. Deu certo: a pessoa volta à aba, e o link já
// foi copiado.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { BackBar } from '../../components/BackBar';
import { ErroChat } from '../../chat/api';
import { ehParado } from '../../chat/cliente';
import { IconAlert, IconChevronDown, IconContacts } from '../../icons';
import type { ReunioesCliente } from '../cliente';
import { ateQuando, conferirNova, inicioPadrao, type NovaReuniao } from '../formato';
import {
  ASSUNTO,
  ATE_31_DIAS,
  AJUDA_DO_ASSUNTO,
  CEM_REUNIOES,
  COLEGAS_E_DE_FORA,
  CRIAR_A_REUNIAO,
  DIA,
  DIA_JA_PASSOU,
  depoisDessaHora,
  HORA,
  MUITAS_TENTATIVAS,
  NOVA_REUNIAO,
  O_FIM_DO_DIA,
  O_LINK_E_COPIADO,
  O_LINK_VALE_ATE,
  OPCIONAL,
  OUTRO_DIA_E_HORA,
  SECAO_REUNIOES,
  SERVIDOR_NAO_RESPONDEU,
  VOLTAR_PARA_AS_REUNIOES,
} from '../textos';

interface Props {
  cliente: ReunioesCliente;
  /** O Voltar, e a reunião criada: a pessoa volta à aba. */
  onVoltar(): void;
}

/** O assunto de uma reunião tem até 120 caracteres (docs/chat-protocolo.md, seção 9). */
const MAX_ASSUNTO = 120;
/** O fim do dia, na hora do "Outro dia e hora" que abre no fim do dia da reunião. */
const FIM_DO_DIA = '23:59';

/** O erro na tela: o texto, e de qual campo ele é (`form`: do pedido todo, ao lado do botão). */
interface Falha {
  texto: string;
  campo: 'dia' | 'ate' | 'form';
}

/** A falha de um pedido que o servidor recusou, ou que não teve resposta, em palavras da tela. */
function falhaDoPedido(e: unknown): Falha {
  if (e instanceof ErroChat) {
    if (e.status === 409 && e.erro === 'muitasReunioes') return { texto: CEM_REUNIOES, campo: 'form' };
    if (e.status === 400 && e.erro === 'invalido') {
      if (e.campo === 'inicio') return { texto: DIA_JA_PASSOU, campo: 'dia' };
      if (e.campo === 'valeAte') return { texto: ATE_31_DIAS, campo: 'ate' };
    }
    if (e.status === 429) return { texto: MUITAS_TENTATIVAS, campo: 'form' };
  }
  return { texto: SERVIDOR_NAO_RESPONDEU, campo: 'form' };
}

function Erro({ id, texto }: { id: string; texto: string }) {
  return (
    <p class="field-error" id={id} role="alert">
      <IconAlert size="sm" />
      <span>{texto}</span>
    </p>
  );
}

export function Nova({ cliente, onVoltar }: Props) {
  const [form, setForm] = useState<NovaReuniao>(() => {
    const p = inicioPadrao(Date.now());
    return { assunto: '', dia: p.dia, hora: p.hora, validade: 'fimDoDia', ateDia: p.dia, ateHora: FIM_DO_DIA };
  });
  const [falha, setFalha] = useState<Falha | null>(null);
  const [emCurso, setEmCurso] = useState(false);
  const ocupada = useRef(false);
  /** A tela ainda está na janela (o pedido pode acabar depois do Voltar). */
  const montada = useRef(true);
  const assunto = useRef<HTMLInputElement>(null);
  const dia = useRef<HTMLInputElement>(null);
  const ateDia = useRef<HTMLInputElement>(null);
  // Um efeito de layout: o foco vai ao Assunto na hora que a tela abre.
  useLayoutEffect(() => {
    assunto.current?.focus();
    return () => {
      montada.current = false;
    };
  }, []);

  /** Muda um campo; o erro de antes sai (a pessoa já está corrigindo). */
  const mudar = (parte: Partial<NovaReuniao>) => {
    setForm((f) => ({ ...f, ...parte }));
    setFalha(null);
  };

  // A frase de até quando o link vale: a conferência sem o relógio (só os campos), e o `agora` só para dizer "hoje".
  const conferido = conferirNova(form, 0);
  const frase = 'corpo' in conferido ? depoisDessaHora(ateQuando(conferido.corpo.valeAte, Date.now())) : null;

  const enviar = (e: Event) => {
    e.preventDefault();
    if (ocupada.current) return;
    const r = conferirNova(form, Date.now());
    if ('erro' in r) {
      setFalha({ texto: r.erro, campo: r.campo });
      (r.campo === 'dia' ? dia : ateDia).current?.focus();
      return;
    }
    ocupada.current = true;
    setEmCurso(true);
    setFalha(null);
    cliente.criar(r.corpo).then(
      () => {
        ocupada.current = false;
        if (montada.current) onVoltar();
      },
      (erro) => {
        ocupada.current = false;
        if (!montada.current) return;
        setEmCurso(false);
        // A pessoa trocou no meio: a tela sai sozinha, e a falha não é dela.
        if (!ehParado(erro)) setFalha(falhaDoPedido(erro));
      },
    );
  };

  const erroDoDia = falha?.campo === 'dia';
  const erroDoAte = falha?.campo === 'ate';
  return (
    <>
      <BackBar title={NOVA_REUNIAO} eyebrow={SECAO_REUNIOES} voltar={VOLTAR_PARA_AS_REUNIOES} onBack={onVoltar} />
      <form class="body scroll chat reun-form" onSubmit={enviar}>
        <div class="field">
          <div class="reun-rotulo">
            <label class="label" for="nova-assunto">
              {ASSUNTO}
            </label>
            <span class="reun-opcional">{OPCIONAL}</span>
          </div>
          <input
            ref={assunto}
            id="nova-assunto"
            class="input reun-campo"
            autocomplete="off"
            maxLength={MAX_ASSUNTO}
            aria-describedby="nova-assunto-ajuda"
            value={form.assunto}
            onInput={(e) => mudar({ assunto: e.currentTarget.value })}
          />
          <p class="reun-ajuda" id="nova-assunto-ajuda">
            {AJUDA_DO_ASSUNTO}
          </p>
        </div>

        <div class="reun-par">
          <div class="field">
            <label class="label" id="nova-dia-rotulo" for="nova-dia">
              {DIA}
            </label>
            <input
              ref={dia}
              id="nova-dia"
              class="input reun-campo"
              type="date"
              required
              value={form.dia}
              aria-invalid={erroDoDia ? 'true' : undefined}
              aria-describedby={erroDoDia ? 'nova-dia-erro' : undefined}
              onInput={(e) => mudar({ dia: e.currentTarget.value })}
            />
          </div>
          <div class="field">
            <label class="label" id="nova-hora-rotulo" for="nova-hora">
              {HORA}
            </label>
            <input
              id="nova-hora"
              class="input reun-campo"
              type="time"
              required
              value={form.hora}
              aria-invalid={erroDoDia ? 'true' : undefined}
              aria-describedby={erroDoDia ? 'nova-dia-erro' : undefined}
              onInput={(e) => mudar({ hora: e.currentTarget.value })}
            />
          </div>
        </div>
        {erroDoDia && <Erro id="nova-dia-erro" texto={falha.texto} />}

        <div class="field">
          <label class="label" id="nova-vale-rotulo" for="nova-vale">
            {O_LINK_VALE_ATE}
          </label>
          <div class="reun-seletor">
            <select
              id="nova-vale"
              class="input reun-campo reun-select"
              value={form.validade}
              aria-describedby={frase ? 'nova-vale-frase' : undefined}
              onChange={(e) => {
                const validade = e.currentTarget.value === 'outra' ? 'outra' : 'fimDoDia';
                // O "Outro dia e hora" abre no fim do dia da reunião.
                mudar(validade === 'outra' ? { validade, ateDia: form.dia, ateHora: FIM_DO_DIA } : { validade });
              }}
            >
              <option value="fimDoDia">{O_FIM_DO_DIA}</option>
              <option value="outra">{OUTRO_DIA_E_HORA}</option>
            </select>
            <IconChevronDown class="reun-seta" />
          </div>
          {form.validade === 'outra' && (
            <div class="reun-par">
              <input
                ref={ateDia}
                class="input reun-campo"
                type="date"
                required
                value={form.ateDia}
                aria-labelledby="nova-vale-rotulo nova-dia-rotulo"
                aria-invalid={erroDoAte ? 'true' : undefined}
                aria-describedby={erroDoAte ? 'nova-ate-erro' : undefined}
                onInput={(e) => mudar({ ateDia: e.currentTarget.value })}
              />
              <input
                class="input reun-campo"
                type="time"
                required
                value={form.ateHora}
                aria-labelledby="nova-vale-rotulo nova-hora-rotulo"
                aria-invalid={erroDoAte ? 'true' : undefined}
                aria-describedby={erroDoAte ? 'nova-ate-erro' : undefined}
                onInput={(e) => mudar({ ateHora: e.currentTarget.value })}
              />
            </div>
          )}
          {frase && (
            <p class="reun-ajuda" id="nova-vale-frase">
              {frase}
            </p>
          )}
          {erroDoAte && <Erro id="nova-ate-erro" texto={falha.texto} />}
        </div>

        <p class="reun-nota">
          <IconContacts size="sm" />
          <span>{COLEGAS_E_DE_FORA}</span>
        </p>

        <div class="reun-rodape">
          {falha?.campo === 'form' && <Erro id="nova-erro" texto={falha.texto} />}
          <button type="submit" class="btn btn-cyan chat-confirmar" disabled={emCurso}>
            {CRIAR_A_REUNIAO}
          </button>
          <p class="reun-rodape-nota">{O_LINK_E_COPIADO}</p>
        </div>
      </form>
    </>
  );
}
