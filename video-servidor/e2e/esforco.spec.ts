// O esforço da troca de tamanho do mosaico, direto no FreeSWITCH. É a prova das correções da pasta freeswitch/patches
// (docs/superpowers/specs/2026-11-19-starsonic-phone-freeswitch-troca-de-tamanho-design.md):
// - sem a primeira, o FreeSWITCH 1.11.3 congela a imagem nessa troca (com mais de 2 processadores, como no GitHub e no
//   servidor de produção) ou cai;
// - sem a segunda, o comando da banda, que o agente manda logo depois de pedir um tamanho, lê a imagem do mosaico
//   enquanto ela é trocada, e o FreeSWITCH pode cair.
import { expect, test } from '@playwright/test';
import { readFileSync, statSync } from 'node:fs';
import { Esl } from './esl';
import { repetirAte } from './espera';
import { A, AZUL, B, C, MOSAICO_2, VERMELHO } from './midia';
import { Navegador } from './navegador';
import { avisosDoMosaico, novaReuniaoDeTeste, REGISTROS, salaNoAgente, senhaDoEsl } from './servidores';

/** Os pedidos do primeiro teste, e a pausa entre eles. Com a correção, o FreeSWITCH só anota o pedido, e a thread do
 * mosaico aplica o último a cada imagem (25 por segundo): nem todo pedido vira uma troca. */
const PEDIDOS = 1000;
const PAUSA_MS = 20;
/** As trocas do segundo teste: cada uma é conferida antes da seguinte. */
const CONFERIDAS = 300;
/** A banda que o agente pede para a grade (BandaDaGrade, em video-servidor/internal/mosaico/layouts.go). */
const BANDA = '3mb';
/** Quanto um comando pode ficar sem resposta, e quanto um tamanho pedido pode levar para valer. Com as correções, o
 * comando responde em milésimos de segundo, e o tamanho vale na imagem seguinte (40 ms). */
const PRAZO_MS = 5000;
/** Os pedidos em que a terceira pessoa começa a entrar, e os pedidos em que ela sai. */
const ENTRA = [200, 650];
const SAI = [450, 900];
/** Os dois erros do codificador que o defeito causa. O "[8:Invalid parameter:(null)]" não é dele: pode aparecer
 * numa troca de tamanho normal (docs/video-servidor.md, passo 8). */
const ERROS_DO_DEFEITO = { doTamanho: 'Image size must match', doFormato: 'Invalid image format' };

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tamanhoDaVez = (i: number) => (i % 2 === 0 ? '1920x1620' : '1920x1080');

/** A sala deste teste no FreeSWITCH. Espera haver uma só: a do teste anterior leva um instante para acabar. */
async function aSalaDoTeste(esl: Esl): Promise<string> {
  const salas = await repetirAte(
    20_000,
    200,
    async () => [...((await esl.api('conference list')) ?? '').matchAll(/Conference (\S+) \(/g)].map((m) => m[1]),
    (s) => s.length === 1,
    (s) => `esperava uma conferência no FreeSWITCH, e há ${s.length}`,
  );
  return salas[0];
}

/** Manda um comando da conferência e devolve a resposta. Os dois jeitos de o FreeSWITCH faltar viram a falha do teste:
 * a imagem congelada (o comando fica sem resposta) e a queda (a ligação fecha). A sala é segredo dos registros, e não
 * vai à mensagem da falha. */
async function mandar(esl: Esl, sala: string, qual: string, comando: string): Promise<string> {
  const resposta = await esl.api(`conference ${sala} ${comando}`, PRAZO_MS);
  if (resposta === null) {
    const dePe = await Esl.abrir(senhaDoEsl()).then(
      (outro) => {
        outro.fechar();
        return true;
      },
      () => false,
    );
    const oQueHouve = esl.aberta ? `ficou ${PRAZO_MS / 1000} s sem resposta` : 'derrubou a ligação com o FreeSWITCH';
    throw new Error(`${qual} ${oQueHouve}; o FreeSWITCH ${dePe ? 'continua de pé' : 'não responde mais'}`);
  }
  return resposta;
}

/** Pede um tamanho ao mosaico (o vid-res). */
async function pedirTamanho(esl: Esl, sala: string, qual: string, tamanho: string): Promise<void> {
  const resposta = await mandar(esl, sala, qual, `vid-res ${tamanho}`);
  if (!resposta.startsWith('+OK')) throw new Error(`${qual} respondeu: ${resposta.replaceAll(sala, '<sala>').slice(0, 60)}`);
}

/** Os erros do codificador que o defeito causa, no registro do FreeSWITCH, do ponto inicio em diante. */
function errosDoDefeito(inicio: number): { doTamanho: number; doFormato: number } {
  const doCodificador = readFileSync(REGISTROS.freeswitch)
    .subarray(inicio)
    .toString('utf8')
    .split('\n')
    .filter((l) => l.includes('VPX encode error'));
  return {
    doTamanho: doCodificador.filter((l) => l.includes(ERROS_DO_DEFEITO.doTamanho)).length,
    doFormato: doCodificador.filter((l) => l.includes(ERROS_DO_DEFEITO.doFormato)).length,
  };
}

test('mil pedidos de troca de tamanho seguidos, com uma pessoa entrando e saindo', async () => {
  test.setTimeout(180_000);
  const codigo = await novaReuniaoDeTeste();
  const avisosAntes = avisosDoMosaico().length;
  const inicioDoRegistro = statSync(REGISTROS.freeswitch).size;
  let a: Navegador | undefined;
  let b: Navegador | undefined;
  let c: Navegador | undefined;
  let esl: Esl | undefined;
  // A entrada da terceira pessoa corre ao lado dos pedidos. O erro dela fica guardado até alguém esperar por ela.
  let entrada: Promise<void> = Promise.resolve();
  let erroDaEntrada: Error | null = null;
  const saidas: Promise<void>[] = [];
  try {
    a = await Navegador.abrir(A);
    b = await Navegador.abrir(B);
    await a.entrarPelaPagina(codigo, 'Carlos Lima');
    await b.entrarPelaPagina(codigo, 'Bia Ramos');
    await a.esperarMensagem('aceito');
    await b.esperarMensagem('aceito');
    await a.esperarTamanho(1920, 1080);
    await b.esperarTamanho(1920, 1080);
    await a.esperarCores(MOSAICO_2, [VERMELHO, AZUL]);

    esl = await Esl.abrir(senhaDoEsl());
    const sala = await aSalaDoTeste(esl);

    for (let i = 0; i < PEDIDOS; i++) {
      if (ENTRA.includes(i)) {
        entrada = (async () => {
          c = await Navegador.abrir(C);
          await c.entrarPelaPagina(codigo, 'Maria Lima');
          await c.esperarMensagem('aceito');
        })().catch((e: unknown) => {
          erroDaEntrada = e instanceof Error ? e : new Error(String(e));
        });
      }
      if (SAI.includes(i)) {
        await entrada;
        // O c é posto dentro da entrada, que o compilador não acompanha: sem o "as", ele o daria por nunca posto.
        const quem = c as Navegador | undefined;
        c = undefined;
        if (quem) saidas.push(quem.fechar().catch(() => undefined));
      }
      await pedirTamanho(esl, sala, `a troca ${i}`, tamanhoDaVez(i));
      await esperar(PAUSA_MS);
    }

    await entrada;
    if (erroDaEntrada) throw new Error(`a terceira pessoa não entrou no meio das trocas: ${(erroDaEntrada as Error).message}`);
    await Promise.all(saidas);
    // O agente já viu a terceira pessoa sair e arrumou o mosaico das duas: daqui em diante, só este teste manda.
    await repetirAte(
      20_000,
      200,
      () => salaNoAgente(sala),
      (s) => s?.participantes.length === 2 && s.palco?.quadros.length === 2,
      (s) => `o agente não voltou às duas pessoas em 20 s: ${s?.participantes.length ?? 'sem'} ligações e ${s?.palco?.quadros.length ?? 'sem'} quadros`,
    );

    // O mosaico continua vivo: os dois tamanhos chegam às duas pessoas, com as duas câmeras.
    await pedirTamanho(esl, sala, 'a troca do fim para 1920x1620', '1920x1620');
    await a.esperarTamanho(1920, 1620);
    await b.esperarTamanho(1920, 1620);
    await pedirTamanho(esl, sala, 'a troca do fim para 1920x1080', '1920x1080');
    await a.esperarTamanho(1920, 1080);
    await b.esperarTamanho(1920, 1080);
    await a.esperarCores(MOSAICO_2, [VERMELHO, AZUL]);
    await b.esperarCores(MOSAICO_2, [VERMELHO, AZUL]);

    // Os registros: nenhum dos dois erros do defeito no FreeSWITCH, e nenhum comando do agente recusado.
    expect(errosDoDefeito(inicioDoRegistro), 'os erros do codificador que o defeito causa, no registro do FreeSWITCH').toEqual({ doTamanho: 0, doFormato: 0 });
    expect(avisosDoMosaico().length, 'os comandos do mosaico que o FreeSWITCH recusou ao agente').toBe(avisosAntes);
  } finally {
    // Com o FreeSWITCH congelado, é a saída das pessoas que o destrava para os testes seguintes: A e B primeiro.
    esl?.fechar();
    await a?.fechar().catch(() => undefined);
    await b?.fechar().catch(() => undefined);
    await entrada;
    await Promise.all(saidas);
    await (c as Navegador | undefined)?.fechar().catch(() => undefined);
  }
});

// O agente manda o comando da banda (vid-bandwidth) logo depois de pedir um tamanho, no começo e no fim de todo
// compartilhamento de tela. A resposta desse comando diz o tamanho que o mosaico tem: este teste pede um tamanho e
// repete o comando da banda, sem pausa, até a resposta trazer o tamanho pedido. Assim cada troca é conferida, e o
// comando da banda corre bem na hora em que a thread do mosaico troca a imagem.
test('trezentas trocas de tamanho conferidas uma a uma pelo comando da banda', async () => {
  test.setTimeout(180_000);
  const codigo = await novaReuniaoDeTeste();
  const avisosAntes = avisosDoMosaico().length;
  const inicioDoRegistro = statSync(REGISTROS.freeswitch).size;
  let a: Navegador | undefined;
  let b: Navegador | undefined;
  let esl: Esl | undefined;
  try {
    a = await Navegador.abrir(A);
    b = await Navegador.abrir(B);
    await a.entrarPelaPagina(codigo, 'Carlos Lima');
    await b.entrarPelaPagina(codigo, 'Bia Ramos');
    await a.esperarMensagem('aceito');
    await b.esperarMensagem('aceito');
    await a.esperarTamanho(1920, 1080);
    await b.esperarTamanho(1920, 1080);
    await a.esperarCores(MOSAICO_2, [VERMELHO, AZUL]);

    esl = await Esl.abrir(senhaDoEsl());
    const sala = await aSalaDoTeste(esl);

    let comandosDaBanda = 0;
    for (let i = 0; i < CONFERIDAS; i++) {
      const tamanho = tamanhoDaVez(i);
      await pedirTamanho(esl, sala, `a troca ${i}`, tamanho);
      const fim = Date.now() + PRAZO_MS;
      for (;;) {
        // A resposta traz o nome das ligações: dela, só o tamanho do mosaico sai daqui.
        const resposta = await mandar(esl, sala, `o comando da banda depois da troca ${i}`, `vid-bandwidth ${BANDA} '' 1`);
        comandosDaBanda++;
        const valendo = / sdiv [\d.]+ (\d+x\d+) fdiv /.exec(resposta)?.[1];
        if (!valendo) throw new Error(`o comando da banda depois da troca ${i} respondeu sem o tamanho do mosaico`);
        if (valendo === tamanho) break;
        if (Date.now() > fim) throw new Error(`o tamanho da troca ${i} não valeu em ${PRAZO_MS / 1000} s`);
      }
    }
    console.log(`esforço: ${CONFERIDAS} trocas conferidas, com ${comandosDaBanda} comandos da banda`);

    // O mosaico continua vivo: o último tamanho chega às duas pessoas, com as duas câmeras.
    await a.esperarTamanho(1920, 1080);
    await b.esperarTamanho(1920, 1080);
    await a.esperarCores(MOSAICO_2, [VERMELHO, AZUL]);
    await b.esperarCores(MOSAICO_2, [VERMELHO, AZUL]);

    expect(errosDoDefeito(inicioDoRegistro), 'os erros do codificador que o defeito causa, no registro do FreeSWITCH').toEqual({ doTamanho: 0, doFormato: 0 });
    expect(avisosDoMosaico().length, 'os comandos do mosaico que o FreeSWITCH recusou ao agente').toBe(avisosAntes);
  } finally {
    esl?.fechar();
    await a?.fechar().catch(() => undefined);
    await b?.fechar().catch(() => undefined);
  }
});
