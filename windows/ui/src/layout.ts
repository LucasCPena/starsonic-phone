// Os três layouts da janela (rc.2: a janela muda de tamanho, de 300×440 até a área de trabalho). O layout vem do
// tamanho da área da interface (o viewport): Normal com 380 de largura e 640 de altura ou mais; Compacto abaixo disso;
// Mínimo abaixo de 330 de largura ou de 540 de altura. Cada layout só é usado onde cabe: as 12 teclas, o Rediscar, o
// Ligar e a navegação inteiros, sem rolar, e ainda uma sugestão de contato à vista (o Normal cabe até 640 de altura, o
// Compacto até uns 531, o Mínimo até os 440 do mínimo da janela; medido em tests/window.spec.ts). Os limites ficam meio pixel abaixo dos inteiros: numa escala
// fracionária, a janela de 380 lógicos pode virar 379,x px de CSS e continua no layout dela. O .win leva o
// data-layout, e o app.css desenha cada um.
import { useEffect, useState } from 'preact/hooks';

export type Layout = 'normal' | 'compacto' | 'minimo';

const MINIMO = '(max-width: 329.5px), (max-height: 539.5px)';
const COMPACTO = '(max-width: 379.5px), (max-height: 639.5px)';

function current(): Layout {
  if (window.matchMedia(MINIMO).matches) return 'minimo';
  if (window.matchMedia(COMPACTO).matches) return 'compacto';
  return 'normal';
}

export function useLayout(): Layout {
  const [layout, setLayout] = useState<Layout>(current);
  useEffect(() => {
    const listas = [window.matchMedia(MINIMO), window.matchMedia(COMPACTO)];
    const mudou = () => setLayout(current());
    for (const l of listas) l.addEventListener('change', mudou);
    mudou();
    return () => {
      for (const l of listas) l.removeEventListener('change', mudou);
    };
  }, []);
  return layout;
}
