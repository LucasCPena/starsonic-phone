// O esforço da troca de tamanho do mosaico: mil trocas seguidas, direto no FreeSWITCH, com uma pessoa entrando e
// saindo no meio. É a prova da correção da pasta freeswitch/patches: sem ela, o FreeSWITCH 1.11.3 congela a imagem
// nessa troca (com mais de 2 processadores, como no GitHub e no servidor de produção) ou cai
// (docs/superpowers/specs/2026-11-19-starsonic-phone-freeswitch-troca-de-tamanho-design.md).
import { expect, test } from '@playwright/test';
import { readFileSync, statSync } from 'node:fs';
import { Esl } from './esl';
import { repetirAte } from './espera';
import { A, AZUL, B, C, MOSAICO_2, VERMELHO } from './midia';
import { Navegador } from './navegador';
import { avisosDoMosaico, novaReuniaoDeTeste, REGISTROS, salaNoAgente, senhaDoEsl } from './servidores';

const TROCAS = 1000;
const PAUSA_MS = 20;
/** Quanto uma troca pode ficar sem resposta. Com a correção, ela responde em milésimos de segundo. */
const PRAZO_MS = 5000;
/** As trocas em que a terceira pessoa começa a entrar, e as trocas em que ela sai. */
const ENTRA = [200, 650];
const SAI = [450, 900];
/** Os dois erros do codificador que o defeito causa. O "[8:Invalid parameter:(null)]" não é dele: pode aparecer
 * numa troca de tamanho normal (docs/video-servidor.md, passo 8). */
const ERROS_DO_DEFEITO = { doTamanho: 'Image size must match', doFormato: 'Invalid image format' };

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('mil trocas de tamanho do mosaico, com uma pessoa entrando e saindo', async () => {
  test.setTimeout(180_000);
  const codigo = await novaReuniaoDeTeste();
  const avisosAntes = avisosDoMosaico().length;
  const inicioDoRegistro = statSync(REGISTROS.freeswitch).size;
  let a: Navegador | undefined;
  let b: Navegador | undefined;
  let c: Navegador | undefined;
  let esl: Esl | undefined;
  // A entrada da terceira pessoa corre ao lado das trocas. O erro dela fica guardado até alguém esperar por ela.
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
    const salas = [...((await esl.api('conference list')) ?? '').matchAll(/Conference (\S+) \(/g)].map((m) => m[1]);
    if (salas.length !== 1) throw new Error(`esperava uma conferência no FreeSWITCH, e há ${salas.length}`);
    const sala = salas[0];

    // Uma troca: o comando e a resposta dele. A sala é segredo dos registros, e não vai à mensagem da falha.
    const trocar = async (qual: string, tamanho: string): Promise<void> => {
      const resposta = await esl!.api(`conference ${sala} vid-res ${tamanho}`, PRAZO_MS);
      if (resposta === null) {
        const dePe = await Esl.abrir(senhaDoEsl()).then(
          (outro) => {
            outro.fechar();
            return true;
          },
          () => false,
        );
        // Os dois jeitos do defeito: a imagem congelada (o comando fica sem resposta) e a queda (a ligação fecha).
        const oQueHouve = esl!.aberta ? `ficou ${PRAZO_MS / 1000} s sem resposta` : 'derrubou a ligação com o FreeSWITCH';
        throw new Error(`${qual} ${oQueHouve}; o FreeSWITCH ${dePe ? 'continua de pé' : 'não responde mais'}`);
      }
      if (!resposta.startsWith('+OK')) throw new Error(`${qual} respondeu: ${resposta.replaceAll(sala, '<sala>').slice(0, 60)}`);
    };

    for (let i = 0; i < TROCAS; i++) {
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
      await trocar(`a troca ${i}`, i % 2 === 0 ? '1920x1620' : '1920x1080');
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
    await trocar('a troca do fim para 1920x1620', '1920x1620');
    await a.esperarTamanho(1920, 1620);
    await b.esperarTamanho(1920, 1620);
    await trocar('a troca do fim para 1920x1080', '1920x1080');
    await a.esperarTamanho(1920, 1080);
    await b.esperarTamanho(1920, 1080);
    await a.esperarCores(MOSAICO_2, [VERMELHO, AZUL]);
    await b.esperarCores(MOSAICO_2, [VERMELHO, AZUL]);

    // Os registros: nenhum dos dois erros do defeito no FreeSWITCH, e nenhum comando do agente recusado.
    const doCodificador = readFileSync(REGISTROS.freeswitch)
      .subarray(inicioDoRegistro)
      .toString('utf8')
      .split('\n')
      .filter((l) => l.includes('VPX encode error'));
    const achados = {
      doTamanho: doCodificador.filter((l) => l.includes(ERROS_DO_DEFEITO.doTamanho)).length,
      doFormato: doCodificador.filter((l) => l.includes(ERROS_DO_DEFEITO.doFormato)).length,
    };
    expect(achados, 'os erros do codificador que o defeito causa, no registro do FreeSWITCH').toEqual({ doTamanho: 0, doFormato: 0 });
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
