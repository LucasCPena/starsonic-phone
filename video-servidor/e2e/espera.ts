// A espera dos testes e do ambiente: repetir uma leitura até ela servir, com um prazo.

/** Lê, espera intervalo ms e lê de novo, até a leitura servir, e a devolve. Passado o prazo (em ms, contado do
 * começo), lança o erro com o texto que falha monta com a última leitura. Um erro do ler sai na hora. */
export async function repetirAte<T>(
  prazo: number,
  intervalo: number,
  ler: () => T | Promise<T>,
  serve: (lido: T) => boolean,
  falha: (ultimo: T) => string | Promise<string>,
): Promise<T> {
  const fim = Date.now() + prazo;
  for (;;) {
    const lido = await ler();
    if (serve(lido)) return lido;
    if (Date.now() > fim) throw new Error(await falha(lido));
    await new Promise((r) => setTimeout(r, intervalo));
  }
}
