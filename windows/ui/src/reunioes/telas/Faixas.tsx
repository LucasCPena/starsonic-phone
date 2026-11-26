// As faixas da reunião dentro do app, logo abaixo da barra de título do app de sempre. A da tela 14 é a do "Telefone":
// a pessoa está na reunião (escondida), e a faixa diz se o microfone dela está ligado. A da tela 13 é a da ligação: a
// reunião está em pausa, com a tela da ligação por cima, e a faixa diz o assunto e tem o "Voltar para a reunião" (só
// com uma ligação, já atendida; o main.tsx decide).
// Cada faixa é uma seção com o nome do título. O texto do microfone é uma região `status` que fica montada enquanto a
// faixa existe: só o texto troca.
import { useLayoutEffect, useRef } from 'preact/hooks';
import { semSegundoClique } from '../../plataforma';
import {
  MICROFONE_DESLIGADO,
  MICROFONE_LIGADO,
  SEM_ASSUNTO,
  VOCE_ESTA_FORA_DA_REUNIAO,
  VOCE_ESTA_NA_REUNIAO,
  VOLTAR_PARA_A_REUNIAO,
} from '../textos';

interface Props {
  /** O `microfone` do último `estado` da página. */
  microfone: boolean;
  onVoltar(): void;
}

/** A faixa da tela 14: "Você está na reunião", o microfone e o "Voltar para a reunião". */
export function FaixaDoTelefone({ microfone, onVoltar }: Props) {
  const voltar = useRef<HTMLButtonElement>(null);
  // A faixa nasce com o clique no "Telefone" (que sai do documento com a vista): o foco vai para o "Voltar", e não
  // para o fundo.
  useLayoutEffect(() => voltar.current?.focus(), []);
  return (
    <section class="faixa-telefone" aria-label={VOCE_ESTA_NA_REUNIAO}>
      <span class="faixa-telefone-ponto" aria-hidden="true" />
      <span class="faixa-telefone-textos">
        <span class="faixa-telefone-titulo">{VOCE_ESTA_NA_REUNIAO}</span>
        <span class="faixa-telefone-mic" role="status">
          {microfone ? MICROFONE_LIGADO : MICROFONE_DESLIGADO}
        </span>
      </span>
      <button ref={voltar} type="button" class="faixa-telefone-voltar" onClick={onVoltar}>
        {VOLTAR_PARA_A_REUNIAO}
      </button>
    </section>
  );
}

interface PropsDaLigacao {
  /** O assunto da reunião ('' sem assunto: "Reunião sem assunto"). */
  assunto: string;
  /** O "Voltar para a reunião"; null sem o botão (chamando, com duas ligações, na conferência ou na consulta). */
  onVoltar: (() => void) | null;
}

/**
 * A faixa da tela 13: "Você está fora da reunião", o assunto e o "Voltar para a reunião". Ela nasce com a pausa, que
 * esconde a vista: se o foco estava nela (o Atender do cartão, a página da reunião) ou caiu no fundo, ele vem para a
 * faixa (o leitor de tela diz onde a pessoa está), e não para um botão, que um Enter a mais apertaria. O "Voltar" muda
 * a tela: ele ignora o segundo clique de um clique duplo (o semSegundoClique; a reunião é só do Windows).
 */
export function FaixaForaDaReuniao({ assunto, onVoltar }: PropsDaLigacao) {
  const faixa = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const ativo = document.activeElement;
    if (ativo === null || ativo === document.body || ativo.closest('.reuniao-vista')) faixa.current?.focus();
  }, []);
  return (
    <section ref={faixa} class="fora-reuniao" aria-label={VOCE_ESTA_FORA_DA_REUNIAO} tabIndex={-1}>
      <span class="fora-reuniao-textos">
        <span class="fora-reuniao-titulo">{VOCE_ESTA_FORA_DA_REUNIAO}</span>
        <span class="fora-reuniao-assunto">{assunto || SEM_ASSUNTO}</span>
      </span>
      {onVoltar && (
        <button type="button" class="fora-reuniao-voltar" onClick={semSegundoClique(true, onVoltar)}>
          {VOLTAR_PARA_A_REUNIAO}
        </button>
      )}
    </section>
  );
}
