// As reuniões de ponta a ponta: quem entra pela página, o mosaico que o FreeSWITCH monta, o som de cada um, a sala de
// espera, a tela compartilhada, o tirar, o encerrar e quem sai sem desligar. Cada navegador é uma pessoa, com a
// câmera de uma cor e o microfone de um tom (midia.ts); o vídeo recebido é lido em pontos do mosaico (seção 7 do
// docs/video-agente.md).
import { expect, test } from '@playwright/test';
import {
  A,
  AMARELO,
  AZUL,
  B,
  C,
  MOSAICO_2,
  MOSAICO_4,
  QUADROS_PEQUENOS,
  TELA,
  VERDE,
  VERMELHO,
} from './midia';
import { Navegador } from './navegador';
import { ana, novaReuniaoDeTeste, type EventosDoApp } from './servidores';

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('a reunião de teste mostra as duas câmeras no mosaico e cada um ouve o outro', async () => {
  const codigo = await novaReuniaoDeTeste();
  const a = await Navegador.abrir(A);
  const b = await Navegador.abrir(B);
  try {
    // Na reunião de teste, o pedir responde aceito na hora, e o cliente liga.
    await a.entrarPelaPagina(codigo, 'Carlos Lima');
    await b.entrarPelaPagina(codigo, 'Bia Ramos');
    await a.esperarMensagem('aceito');
    await b.esperarMensagem('aceito');

    // Cada um se vê: o mosaico de 2 tem o vermelho e o azul, em qualquer ordem, no vídeo de B e no de A.
    await b.esperarCores(MOSAICO_2, [VERMELHO, AZUL]);
    await a.esperarCores(MOSAICO_2, [VERMELHO, AZUL]);

    // Cada um ouve o outro, e não a si mesmo.
    await b.esperarFrequencia(A.som);
    await a.esperarFrequencia(B.som);

    // O nome no quadro (M-29): a faixa de baixo de cada quadro, onde o FreeSWITCH escreve o nome, tem o texto
    // claro sobre o fundo escuro, e não uma cor só. Isso prova que a fonte do pacote desenha.
    await a.esperarNomesNoMosaicoDe2();
  } finally {
    await a.fechar();
    await b.fechar();
  }
});

// Os três da reunião marcada, na mesma reunião: a Ana (o app, pela API) e o navegador A, que liga com o acesso dela;
// C, de fora, pela página.
test.describe.serial('a reunião marcada', () => {
  let codigo = '';
  let a: Navegador | undefined;
  let c: Navegador | undefined;
  let eventos: EventosDoApp | undefined;

  test.afterAll(async () => {
    eventos?.fechar();
    await a?.fechar();
    await c?.fechar();
  });

  test('a pessoa de fora espera, é aceita pela colega e entra no mosaico', async () => {
    const app = ana();
    codigo = await app.criarMarcada();
    eventos = await app.eventos();

    // C chega antes da Ana: a reunião ainda não começou.
    c = await Navegador.abrir(C);
    await c.entrarPelaPagina(codigo, 'Maria Lima');
    await c.esperarMensagem('naoComecou');

    // A Ana entra pelo app, e o navegador A liga com o acesso dela: a reunião começa.
    const acesso = await app.entrar(codigo);
    a = await Navegador.abrir(A);
    await a.ligar(acesso);

    // O pedido chega à Ana, e C passa a esperar a resposta.
    await c.esperarMensagem('aguardando');
    const pedido = await eventos.esperar(
      (e) => e.tipo === 'reuniaoPedido' && e.reuniao === codigo && e.pedido?.nome === 'Maria Lima',
    );
    await app.aceitar(codigo, pedido.pedido.id);
    await c.esperarMensagem('aceito');
    await a.esperarCores(MOSAICO_2, [VERMELHO, AMARELO]);

    // Um segundo pedido, recusado.
    const b = await Navegador.abrir(B);
    try {
      await b.entrarPelaPagina(codigo, 'Bia Ramos');
      await b.esperarMensagem('aguardando');
      const outro = await eventos.esperar(
        (e) => e.tipo === 'reuniaoPedido' && e.reuniao === codigo && e.pedido?.nome === 'Bia Ramos',
      );
      await app.recusar(codigo, outro.pedido.id);
      await b.esperarMensagem('recusado');
    } finally {
      await b.fechar();
    }
  });

  test('a tela compartilhada ganha o quadro grande e a grade volta quando ela para', async () => {
    test.setTimeout(180_000);
    if (!a || !c) throw new Error('o teste anterior não pôs A e C na reunião');

    // C pede a senha da tela pelo canal da página e compartilha: a segunda ligação dele.
    await c.compartilhar(await c.pedirTela());
    await a.esperarCores([TELA], [VERDE]);
    await a.esperarCores(QUADROS_PEQUENOS, [VERMELHO, AMARELO]);

    // A ligação da tela manda o silêncio gerado: o tempo sem mídia (60 s) não a derruba.
    await esperar(70_000);
    expect(await c.telaNoAr()).toBe(true);
    await a.esperarCores([TELA], [VERDE], 5_000);

    // C para, e a grade volta ao mosaico de 2.
    await c.pararDeCompartilhar();
    await a.esperarMosaicoDe2([VERMELHO, AMARELO]);
  });

  test('a colega tira uma pessoa e depois encerra para todos', async () => {
    if (!a || !c) throw new Error('o teste anterior não pôs A e C na reunião');
    const app = ana();

    const lista = await app.participantes(codigo);
    expect(lista.status).toBe(200);
    const maria = lista.json.participantes.find((p: { nome: string }) => p.nome === 'Maria Lima');
    expect(maria, 'a Maria Lima está na lista da Ana').toBeTruthy();

    // O tirar termina a ligação de C em até 10 s, e o canal dele recebe o tirado.
    await app.tirar(codigo, maria.id);
    expect(await c.terminou(10_000), 'a ligação de C terminou').not.toBeNull();
    await c.esperarMensagem('tirado');

    // O encerrar termina a ligação de A, e a Ana fica fora da reunião.
    await app.encerrar(codigo);
    expect(await a.terminou(10_000), 'a ligação de A terminou').not.toBeNull();
    const depois = await app.participantes(codigo);
    expect(depois.status).toBe(409);
    expect(depois.json.erro).toBe('foraDaReuniao');
  });
});

// Review Focus 2: quem fecha a aba ou perde a rede não manda o BYE; a ligação cai pelos 60 s em que nada chega a ela
// (o media_timeout que a discagem põe para o som e o vídeo), e o mosaico se arruma.
test('quem fecha a aba sai da reunião em até 75 segundos', async () => {
  test.setTimeout(180_000);
  const codigo = await novaReuniaoDeTeste();
  const [a, b, c] = [await Navegador.abrir(A), await Navegador.abrir(B), await Navegador.abrir(C)];
  try {
    await a.entrarPelaPagina(codigo, 'Carlos Lima');
    await b.entrarPelaPagina(codigo, 'Bia Ramos');
    await c.entrarPelaPagina(codigo, 'Maria Lima');
    await a.esperarCores(MOSAICO_4, [VERMELHO, AZUL, AMARELO]);

    // O navegador de C fecha, sem o sair() e sem o BYE.
    await c.fecharAba();
    await a.esperarMosaicoDe2([VERMELHO, AZUL], 75_000);
  } finally {
    await a.fechar();
    await b.fechar();
    await c.fechar();
  }
});

// M-27: a variante com o WebSocket aberto, em que só a mídia para: quem cai é a ligação de que não chega nada, e não
// o WebSocket que fecha. Nada mais sai da ligação de C (nem o RTP, nem o RTCP, nem o ICE: a RTCPeerConnection fecha
// sem o BYE), como num navegador que perdeu o caminho da mídia. Ela cai pelo tempo sem mídia, nem antes (não foi
// outra coisa que a derrubou) nem depois dos 75 s, e o BYE do FreeSWITCH chega a C pelo WebSocket. Só o
// replaceTrack(null) não derrubaria: o RTCP e o ICE continuam, e o FreeSWITCH conta tudo o que chega (seção 6 do
// docs/video-agente.md).
test('quem para de mandar a mídia, com o WebSocket aberto, sai da reunião em até 75 segundos', async () => {
  test.setTimeout(180_000);
  const codigo = await novaReuniaoDeTeste();
  const [a, b, c] = [await Navegador.abrir(A), await Navegador.abrir(B), await Navegador.abrir(C)];
  try {
    await a.entrarPelaPagina(codigo, 'Carlos Lima');
    await b.entrarPelaPagina(codigo, 'Bia Ramos');
    await c.entrarPelaPagina(codigo, 'Maria Lima');
    await a.esperarCores(MOSAICO_4, [VERMELHO, AZUL, AMARELO]);

    await c.pararDeMandar();
    const parou = Date.now();
    await a.esperarMosaicoDe2([VERMELHO, AZUL], 75_000);
    expect(Date.now() - parou, 'a ligação de C caiu pelo tempo sem mídia, e não antes').toBeGreaterThan(45_000);
    const fim = await c.terminou(10_000);
    expect(fim, 'o BYE do FreeSWITCH chegou a C pelo WebSocket aberto').toEqual({ codigo: null, causa: 'Terminated', originador: 'remote' });
  } finally {
    await a.fechar();
    await b.fechar();
    await c.fechar();
  }
});
