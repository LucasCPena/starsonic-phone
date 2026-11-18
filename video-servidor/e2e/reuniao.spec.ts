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
  fundo,
  MOSAICO_1,
  MOSAICO_2,
  MOSAICO_4,
  perto,
  PESSOAS_2,
  TELA_2,
  VERDE,
  VERMELHO,
  type Cor,
} from './midia';
import { repetirAte } from './espera';
import { Navegador, Pagina, telaVerde, type Fim, type Mensagem } from './navegador';
import {
  ana,
  avisosDoMosaico,
  novaReuniaoDeTeste,
  salaDaSenha,
  salaNoAgente,
  type EventosDoApp,
} from './servidores';

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('a reunião de teste mostra as duas câmeras no mosaico e cada um ouve o outro', async () => {
  const codigo = await novaReuniaoDeTeste();
  let a: Navegador | undefined;
  let b: Navegador | undefined;
  try {
    a = await Navegador.abrir(A);
    b = await Navegador.abrir(B);
    // Na reunião de teste, o pedir responde aceito na hora, e o cliente liga.
    await a.entrarPelaPagina(codigo, 'Carlos Lima');
    await b.entrarPelaPagina(codigo, 'Bia Ramos');
    await a.esperarMensagem('aceito');
    await b.esperarMensagem('aceito');

    // Cada um se vê: o mosaico de 2 é a grade de 4, de 1920×1080, com o vermelho e o azul nas duas células de cima,
    // em qualquer ordem, no vídeo de B e no de A.
    await b.esperarTamanho(1920, 1080);
    await a.esperarTamanho(1920, 1080);
    await b.esperarCores(MOSAICO_2, [VERMELHO, AZUL]);
    await a.esperarCores(MOSAICO_2, [VERMELHO, AZUL]);

    // Cada um ouve o outro, e não a si mesmo.
    await b.esperarFrequencia(A.som);
    await a.esperarFrequencia(B.som);

    // O quadro não leva mais o nome: o pé de cada célula tem a cor da câmera, e não a faixa escura do nome. A câmera
    // de 16:9 enche a célula de 16:9.
    await a.esperarCores(
      [
        [0.25, 0.49],
        [0.75, 0.49],
      ],
      [VERMELHO, AZUL],
    );
  } finally {
    await a?.fechar();
    await b?.fechar();
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

    // C pede a senha da tela pelo canal da página e compartilha: a segunda ligação dele. O agente põe a apresentação
    // de 2, de 1920×1620: a tela em cima, e as duas pessoas embaixo.
    await c.compartilhar(await c.pedirTela());
    await a.esperarTamanho(1920, 1620);
    await a.esperarCores([TELA_2], [VERDE]);
    await a.esperarCores(PESSOAS_2, [VERMELHO, AMARELO]);

    // A ligação da tela manda o silêncio gerado: o tempo sem mídia (60 s) não a derruba.
    await esperar(70_000);
    expect(await c.telaNoAr()).toBe(true);
    await a.esperarCores([TELA_2], [VERDE]); // os 20 s de toda espera do brief

    // C para, e a grade volta ao mosaico de 2, de 1920×1080.
    await c.pararDeCompartilhar();
    await a.esperarTamanho(1920, 1080);
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

// O I1 da 1a, de ponta a ponta: quem a colega tirou ainda tem uma senha da tela, que vale por 30 s, e o servidor de
// vídeo atende a ligação com ela (a senha confere). Mas a tela de quem não tem a ligação principal na sala cai na hora,
// sem nenhum comando do mosaico (seção 6 do docs/video-agente.md): o quadro grande nunca é dela.
//
// O layout só muda por um comando do agente: o FreeSWITCH não tem mais o grupo de layouts com que escolhia um sozinho,
// e a ligação da tela entra com a reserva "tela", que a grade não tem. Sem o comando, nem o tamanho do mosaico nem a
// célula da colega mudam enquanto a ligação da tela existe.
test('a tela de quem foi tirado não entra', async () => {
  const app = ana();
  const codigo = await app.criarMarcada();
  const eventos = await app.eventos();
  let a: Navegador | undefined;
  let c: Navegador | undefined;
  try {
    // A Ana começa a reunião pelo navegador A, e a colega aceita Maria (C, de fora, pelo cliente mínimo).
    const acesso = await app.entrar(codigo);
    a = await Navegador.abrir(A);
    await a.ligar(acesso);
    await a.esperarCores(MOSAICO_1, [VERMELHO]);
    c = await Navegador.abrir(C);
    await c.entrarPelaPagina(codigo, 'Maria Lima');
    const pedido = await eventos.esperar(
      (e) => e.tipo === 'reuniaoPedido' && e.reuniao === codigo && e.pedido?.nome === 'Maria Lima',
    );
    await app.aceitar(codigo, pedido.pedido.id);
    await c.esperarMensagem('aceito');
    await a.esperarCores(MOSAICO_2, [VERMELHO, AMARELO]);

    // Pelo cliente mínimo, Maria pega uma senha da tela. Depois, a colega a tira.
    const senha = await c.pedirTela();
    const lista = await app.participantes(codigo);
    const maria = lista.json.participantes.find((p: { nome: string }) => p.nome === 'Maria Lima');
    expect(maria, 'a Maria Lima está na lista da Ana').toBeTruthy();
    await app.tirar(codigo, maria.id);
    expect(await c.terminou(10_000), 'a ligação da câmera de C terminou').not.toBeNull();
    await c.esperarMensagem('tirado');
    await a.esperarCores(MOSAICO_1, [VERMELHO]);

    // As outras três células da grade de 4 estão no fundo antes da tela.
    await repetirAte(
      20_000,
      250,
      () => a!.amostras(MOSAICO_4.slice(1)),
      (v) => v.every(fundo),
      (v) => `as outras células do vídeo de A não ficaram no fundo; as últimas: ${JSON.stringify(v)}`,
    );

    // C liga a tela com a senha. As quatro células e o tamanho do mosaico, no vídeo da colega, são olhados a cada
    // 50 ms, até 5 s depois do fim da ligação: a célula dela fica vermelha, as outras três no fundo (a imagem da tela
    // não cai em nenhuma), e o tamanho, 1920×1080.
    const vistas: Array<Cor | null> = [];
    const outras: Array<Cor | null> = [];
    const tamanhos: string[] = [];
    let olhando = true;
    const olhar = (async () => {
      while (olhando) {
        const [dela, ...resto] = await a!.amostras(MOSAICO_4);
        vistas.push(dela);
        outras.push(...resto);
        const t = await a!.tamanho();
        tamanhos.push(`${t.largura}×${t.altura}`);
        await esperar(50);
      }
    })();
    let fim: Fim | null = null;
    try {
      await c.compartilhar(senha).catch(() => {}); // a ligação cai: a confirmação dela pode nem chegar
      fim = await c.telaTerminou(10_000);
      await esperar(5_000);
    } finally {
      olhando = false;
      await olhar;
    }
    // A senha conferiu (veio o 200, e não o 403), e o servidor de vídeo derrubou a ligação com o BYE.
    expect(fim, 'como a ligação da tela terminou').toEqual({ codigo: null, causa: 'Terminated', originador: 'remote' });
    expect(vistas.length, 'as vistas da célula da colega').toBeGreaterThan(40);
    expect(vistas.filter((v) => perto(v, VERDE)), 'o verde da tela na célula da colega').toEqual([]);
    // O layout nunca mudou: nem a apresentação, com o quadro grande da tela ainda sem imagem, apareceu.
    expect(vistas.filter((v) => !perto(v, VERMELHO)), 'as vistas da célula que não são a colega').toEqual([]);
    expect(outras.filter((v) => !fundo(v)), 'as vistas das outras três células que não são o fundo').toEqual([]);
    expect(tamanhos.filter((t) => t !== '1920×1080'), 'os tamanhos do mosaico que não são o da grade').toEqual([]);
    await a.esperarCores(MOSAICO_1, [VERMELHO]);
  } finally {
    eventos.fechar();
    await a?.fechar();
    await c?.fechar();
  }
});

// Review Focus 2: quem fecha a aba ou perde a rede não manda o BYE; a ligação cai pelos 60 s em que nada chega a ela
// (o media_timeout que a discagem põe para o som e o vídeo), e o mosaico se arruma.
test('quem fecha a aba sai da reunião em até 75 segundos', async () => {
  test.setTimeout(180_000);
  const codigo = await novaReuniaoDeTeste();
  let a: Navegador | undefined;
  let b: Navegador | undefined;
  let c: Navegador | undefined;
  try {
    a = await Navegador.abrir(A);
    b = await Navegador.abrir(B);
    c = await Navegador.abrir(C);
    // A e B entram antes de C: cada um fica na célula com que entrou, e C, na de baixo, que vaga quando ele sai.
    await a.entrarPelaPagina(codigo, 'Carlos Lima');
    await b.entrarPelaPagina(codigo, 'Bia Ramos');
    await a.esperarCores(MOSAICO_2, [VERMELHO, AZUL]);
    await c.entrarPelaPagina(codigo, 'Maria Lima');
    await a.esperarCores(MOSAICO_4, [VERMELHO, AZUL, AMARELO]);

    // O navegador de C fecha, sem o sair() e sem o BYE.
    await c.fecharAba();
    await a.esperarMosaicoDe2([VERMELHO, AZUL], 75_000);
  } finally {
    await a?.fechar();
    await b?.fechar();
    await c?.fechar();
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
  let a: Navegador | undefined;
  let b: Navegador | undefined;
  let c: Navegador | undefined;
  try {
    a = await Navegador.abrir(A);
    b = await Navegador.abrir(B);
    c = await Navegador.abrir(C);
    // A e B entram antes de C: cada um fica na célula com que entrou, e C, na de baixo, que vaga quando ele sai.
    await a.entrarPelaPagina(codigo, 'Carlos Lima');
    await b.entrarPelaPagina(codigo, 'Bia Ramos');
    await a.esperarCores(MOSAICO_2, [VERMELHO, AZUL]);
    await c.entrarPelaPagina(codigo, 'Maria Lima');
    await a.esperarCores(MOSAICO_4, [VERMELHO, AZUL, AMARELO]);

    await c.pararDeMandar();
    const parou = Date.now();
    await a.esperarMosaicoDe2([VERMELHO, AZUL], 75_000);
    expect(Date.now() - parou, 'a ligação de C caiu pelo tempo sem mídia, e não antes').toBeGreaterThan(45_000);
    const fim = await c.terminou(10_000);
    expect(fim, 'o BYE do FreeSWITCH chegou a C pelo WebSocket aberto').toEqual({ codigo: null, causa: 'Terminated', originador: 'remote' });
  } finally {
    await a?.fechar();
    await b?.fechar();
    await c?.fechar();
  }
});

// O fim da reunião com a tela compartilhada, com o FreeSWITCH de verdade: a sala e as ligações somem enquanto o agente
// ainda arruma o mosaico (a tela que sai pede outro tamanho e outro layout). O comando que o FreeSWITCH recusa porque a
// sala ou a ligação já sumiram não é um problema, e o agente não o escreve: nenhuma linha "recusou um comando do
// mosaico" sai durante o teste.
test.describe('o aviso do mosaico no fim da reunião', () => {
  /** A sala de dentro da senha que a página recebeu (a do aceito). */
  const salaDe = (p: Pagina) => {
    const m = p.mensagensRecebidas().find((x: Mensagem) => typeof x.senha === 'string');
    if (!m) throw new Error(`${p.pessoa.letra} não recebeu uma senha`);
    return salaDaSenha(m.senha);
  };

  /** Espera a sala acabar no agente e, por mais 3 s, olha a saída dele: nenhum aviso do mosaico desde o começo do
   * teste (antes é quantos havia nele). */
  async function semAvisoAteOFim(sala: string, antes: number): Promise<void> {
    await expect.poll(() => salaNoAgente(sala), { timeout: 20_000, message: 'a sala acabou no agente' }).toBeNull();
    const fim = Date.now() + 3_000;
    do {
      expect(avisosDoMosaico().slice(antes), 'os avisos do mosaico do agente durante o teste').toEqual([]);
      await esperar(200);
    } while (Date.now() < fim);
    expect(avisosDoMosaico().slice(antes), 'os avisos do mosaico do agente durante o teste').toEqual([]);
  }

  test('a colega encerra a reunião com a tela compartilhada', async () => {
    const antes = avisosDoMosaico().length;
    const app = ana();
    const codigo = await app.criarMarcada();
    const eventos = await app.eventos();
    let colega: Navegador | undefined;
    let maria: Pagina | undefined;
    try {
      // A colega começa a reunião pelo cliente mínimo, e aceita Maria, que entra pela página.
      colega = await Navegador.abrir(A);
      await colega.ligar(await app.entrar(codigo));
      await colega.esperarCores(MOSAICO_1, [VERMELHO]);
      maria = await Pagina.abrir(C);
      await maria.page.addInitScript(telaVerde);
      await maria.entrar(codigo, 'Maria Lima');
      const pedido = await eventos.esperar(
        (e) => e.tipo === 'reuniaoPedido' && e.reuniao === codigo && e.pedido?.nome === 'Maria Lima',
      );
      await app.aceitar(codigo, pedido.pedido.id);
      await expect(maria.controles()).toBeVisible({ timeout: 30_000 });
      await colega.esperarCores(MOSAICO_2, [VERMELHO, AMARELO]);
      const sala = salaDe(maria);

      // Maria compartilha, e a apresentação de 2 chega às duas.
      await maria.botao('Compartilhar a tela').click();
      await colega.esperarTamanho(1920, 1620);
      await maria.esperarTamanho(1920, 1620);

      // A colega encerra para todos: as duas saem, e a sala acaba sem aviso do mosaico.
      await app.encerrar(codigo);
      expect(await colega.terminou(10_000), 'a ligação da colega terminou').not.toBeNull();
      await expect(maria.titulo('A reunião acabou')).toBeVisible({ timeout: 10_000 });
      await semAvisoAteOFim(sala, antes);
      await maria.conferirOConsole();
    } finally {
      eventos.fechar();
      await maria?.fechar();
      await colega?.fechar();
    }
  });

  test('a última pessoa sai com a tela dela compartilhada', async () => {
    const antes = avisosDoMosaico().length;
    const codigo = await novaReuniaoDeTeste();
    let maria: Pagina | undefined;
    try {
      maria = await Pagina.abrir(C);
      await maria.page.addInitScript(telaVerde);
      await maria.entrar(codigo, 'Maria Lima');
      await expect(maria.controles()).toBeVisible({ timeout: 30_000 });
      await maria.esperarCores(MOSAICO_1, [AMARELO]);
      const sala = salaDe(maria);

      await maria.botao('Compartilhar a tela').click();
      await maria.esperarTamanho(1920, 1620);

      // Ela sai com a tela no ar: as duas ligações dela terminam, e a sala acaba sem aviso do mosaico.
      await maria.controles().getByRole('button', { name: 'Sair', exact: true }).click();
      await expect(maria.titulo('Você saiu da reunião')).toBeVisible();
      await semAvisoAteOFim(sala, antes);
      await maria.conferirOConsole();
    } finally {
      await maria?.fechar();
    }
  });
});
