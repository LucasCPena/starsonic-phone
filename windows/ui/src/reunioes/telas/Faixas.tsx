// As faixas da reunião dentro do app, logo abaixo da barra de título do app de sempre. A da tela 14 é a do "Telefone":
// a pessoa está na reunião (escondida), e a faixa diz se o microfone dela está ligado. A Task 6 acrescenta a da 13.
// A faixa é uma seção com o nome "Você está na reunião". O texto do microfone é uma região `status` que fica montada
// enquanto a faixa existe: só o texto troca.
import { useLayoutEffect, useRef } from 'preact/hooks';
import {
  MICROFONE_DESLIGADO,
  MICROFONE_LIGADO,
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
