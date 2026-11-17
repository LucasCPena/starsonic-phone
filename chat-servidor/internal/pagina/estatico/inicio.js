// O início da página da reunião: liga a tela aos adaptadores de verdade (a rede, a câmera e o microfone, as ligações e
// o relógio do navegador) e começa, com o abrir do código do link.
import { criarLigacoes } from './ligacao.js';
import { criarMidia } from './midia.js';
import { iniciar } from './pagina.js';
import { criarRede } from './rede.js';

// O código do link: /r/<código>.
const codigo = location.pathname.split('/')[2] ?? '';
const previas = [...document.querySelectorAll('video.previa')];

iniciar(document.body, {
  rede: (aoEvento) => criarRede(aoEvento, codigo),
  midia: (aoEvento) => criarMidia(aoEvento, previas),
  ligacao: criarLigacoes,
  relogio: { agora: () => Date.now(), depois: (ms, fn) => setTimeout(fn, ms) },
});
