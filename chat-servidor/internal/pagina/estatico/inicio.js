// O início da página da reunião: liga a tela aos adaptadores de verdade (a rede, a câmera e o microfone, as ligações e
// o relógio do navegador) e começa, com o abrir do código do link.
import { ehWindows, passeDoEndereco } from './colega.js';
import { criarLigacoes } from './ligacao.js';
import { criarMidia } from './midia.js';
import { iniciar } from './pagina.js';
import { criarRede } from './rede.js';

// O código do link: /r/<código>.
const codigo = location.pathname.split('/')[2] ?? '';
const previas = [...document.querySelectorAll('video.previa')];

// O passe que o app pôs no fim do endereço (/r/<código>#p=<passe>), que nunca vai ao servidor no endereço. Ele sai do
// endereço já, antes de qualquer pedido, e sem uma entrada nova no histórico: o caminho e a busca ficam. Qualquer
// outra coisa depois do # sai junto.
const passe = passeDoEndereco(location.hash);
if (location.href.includes('#')) history.replaceState(history.state, '', location.pathname + location.search);

iniciar(document.body, {
  rede: (aoEvento) => criarRede(aoEvento, codigo),
  midia: (aoEvento) => criarMidia(aoEvento, previas),
  ligacao: criarLigacoes,
  relogio: { agora: () => Date.now(), depois: (ms, fn) => setTimeout(fn, ms) },
  passe,
  windows: ehWindows(navigator),
});
