// Os testes das contas e dos textos do chat da reunião (mensagens.js): funções puras, sem DOM e sem relógio.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_MENSAGENS,
  MAX_TEXTO,
  contagem,
  dito,
  escreveu,
  falha,
  hora,
  nomeDoBotao,
  numaLinha,
  partes,
  quem,
  textoLimpo,
} from '../../internal/pagina/estatico/mensagens.js';

test('os valores da spec', () => {
  assert.equal(MAX_TEXTO, 1000);
  assert.equal(MAX_MENSAGENS, 500);
});

test('o texto que vale', () => {
  assert.equal(textoLimpo('  Bom dia  '), 'Bom dia');
  assert.equal(textoLimpo('\n\nlinha 1\nlinha 2\n'), 'linha 1\nlinha 2');
  assert.equal(textoLimpo(''), null);
  assert.equal(textoLimpo(' \n '), null);
  assert.equal(textoLimpo('a'.repeat(1000)), 'a'.repeat(1000));
  // Os pontos de código, e não as unidades do JavaScript: um emoji conta um.
  assert.equal(textoLimpo('😀'.repeat(1000)), '😀'.repeat(1000));
  assert.equal(textoLimpo('a'.repeat(1001)), null);
  assert.equal(textoLimpo('😀'.repeat(1001)), null);
  assert.equal(textoLimpo(` ${'a'.repeat(1000)} `), 'a'.repeat(1000));
  for (const naoETexto of [undefined, null, 7, {}, ['a']]) assert.equal(textoLimpo(naoETexto), null);
});

test('o texto sai limpo do que o servidor recusa', () => {
  // O servidor recusa o caractere de controle que não é a quebra de linha (docs/chat-protocolo.md, seção 3). O tab,
  // que vem num texto colado de uma planilha, vira um espaço; os outros saem.
  assert.equal(textoLimpo('nome\tvalor'), 'nome valor');
  assert.equal(textoLimpo('a\u0000b\u0007c\u001bd\u007fe\u0085f\u009fg'), 'abcdefg');
  // As quebras de linha ficam, e as de outros sistemas viram a de sempre, como no servidor.
  assert.equal(textoLimpo('linha 1\r\nlinha 2\rlinha 3\n\nlinha 5'), 'linha 1\nlinha 2\nlinha 3\n\nlinha 5');
  // O que sobra depois da limpeza é o que conta: para o vazio e para o tamanho.
  assert.equal(textoLimpo('\t\u0000 \u0085'), null);
  assert.equal(textoLimpo(`${'a'.repeat(1000)}\u0000`), 'a'.repeat(1000));
  assert.equal(textoLimpo(`\t${'a'.repeat(1000)}\t`), 'a'.repeat(1000));
  // O que não é de controle fica como está: as letras de qualquer língua, os emojis e o espaço que não quebra.
  assert.equal(textoLimpo('ação é 日本 😀 a\u00a0b'), 'ação é 日本 😀 a\u00a0b');
});

test('os links', () => {
  assert.deepEqual(partes('Bom dia a todos'), [{ texto: 'Bom dia a todos' }]);
  assert.deepEqual(partes('O link é https://exemplo.com.br/relatorio'), [
    { texto: 'O link é ' },
    { link: 'https://exemplo.com.br/relatorio' },
  ]);
  assert.deepEqual(partes('https://exemplo.com.br'), [{ link: 'https://exemplo.com.br' }]);
  // A pontuação do fim fica de fora do link.
  assert.deepEqual(partes('veja https://exemplo.com.br/a. Depois'), [
    { texto: 'veja ' },
    { link: 'https://exemplo.com.br/a' },
    { texto: '. Depois' },
  ]);
  assert.deepEqual(partes('(http://exemplo.com.br/a)'), [
    { texto: '(' },
    { link: 'http://exemplo.com.br/a' },
    { texto: ')' },
  ]);
  assert.deepEqual(partes('É este: https://exemplo.com.br/a?b=1&c=2!!'), [
    { texto: 'É este: ' },
    { link: 'https://exemplo.com.br/a?b=1&c=2' },
    { texto: '!!' },
  ]);
  assert.deepEqual(partes('"https://exemplo.com.br/a"'), [
    { texto: '"' },
    { link: 'https://exemplo.com.br/a' },
    { texto: '"' },
  ]);
  // O fechamento que fecha um par aberto dentro do endereço é dele; o que sobra é da frase.
  assert.deepEqual(partes('https://exemplo.com.br/wiki/Brasil_(país)'), [
    { link: 'https://exemplo.com.br/wiki/Brasil_(país)' },
  ]);
  assert.deepEqual(partes('(veja https://exemplo.com.br/wiki/Brasil_(país))'), [
    { texto: '(veja ' },
    { link: 'https://exemplo.com.br/wiki/Brasil_(país)' },
    { texto: ')' },
  ]);
  assert.deepEqual(partes('[https://exemplo.com.br/a]. E {https://exemplo.com.br/b}'), [
    { texto: '[' },
    { link: 'https://exemplo.com.br/a' },
    { texto: ']. E {' },
    { link: 'https://exemplo.com.br/b' },
    { texto: '}' },
  ]);
  // O esquema em maiúsculas também começa um endereço.
  assert.deepEqual(partes('HTTPS://EXEMPLO.COM.BR'), [{ link: 'HTTPS://EXEMPLO.COM.BR' }]);
  // Dois links, e o link no fim de uma linha.
  assert.deepEqual(partes('https://exemplo.com.br/a e https://exemplo.com.br/b'), [
    { link: 'https://exemplo.com.br/a' },
    { texto: ' e ' },
    { link: 'https://exemplo.com.br/b' },
  ]);
  assert.deepEqual(partes('primeiro https://exemplo.com.br/a\nsegunda linha'), [
    { texto: 'primeiro ' },
    { link: 'https://exemplo.com.br/a' },
    { texto: '\nsegunda linha' },
  ]);
  // Os sinais de HTML terminam o endereço: eles ficam como texto.
  assert.deepEqual(partes('<b>https://exemplo.com.br</b>'), [
    { texto: '<b>' },
    { link: 'https://exemplo.com.br' },
    { texto: '</b>' },
  ]);
});

test('o que não vira link', () => {
  for (const texto of [
    'javascript:alert(1)',
    'ftp://exemplo.com.br/arquivo',
    'www.exemplo.com.br',
    'exemplo.com.br/relatorio',
    'http://',
    'https:// exemplo.com.br',
    'https://.',
    'data:text/html,<script>alert(1)</script>',
    'mailto:ana@exemplo.com.br',
  ]) {
    assert.deepEqual(partes(texto), [{ texto }], texto);
  }
});

// Os sinais que mudam a direção do texto (o RLO e os outros) não ficam dentro de um link: com um deles no meio, o
// endereço que aparece na tela não é o endereço para onde o link leva.
test('o endereço acaba num sinal de direção do texto', () => {
  const RLO = '‮';
  // O endereço escrito ao contrário, depois do sinal: na tela, ele terminaria em "@exemplo.com.br".
  const aoContrario = `https://${RLO}rb.moc.olpmexe@outro.example/`;
  assert.deepEqual(partes(aoContrario), [{ texto: aoContrario }]);
  // No meio do endereço: o link vai até o sinal, e o resto é texto.
  assert.deepEqual(partes(`veja https://exemplo.com.br/a${RLO}fdp.exe`), [
    { texto: 'veja ' },
    { link: 'https://exemplo.com.br/a' },
    { texto: `${RLO}fdp.exe` },
  ]);
  // Todos eles: as marcas, os que embutem, os que forçam e os que isolam.
  const sinais = ['061C', '200E', '200F', '202A', '202B', '202C', '202D', '202E', '2066', '2067', '2068', '2069'];
  for (const codigo of sinais) {
    const sinal = String.fromCodePoint(Number.parseInt(codigo, 16));
    assert.deepEqual(
      partes(`https://exemplo.com.br/a${sinal}b`),
      [{ link: 'https://exemplo.com.br/a' }, { texto: `${sinal}b` }],
      `U+${codigo}`,
    );
  }
  // As letras de outras línguas continuam valendo num endereço.
  assert.deepEqual(partes('https://exemplo.com.br/مرحبا/שלום'), [{ link: 'https://exemplo.com.br/مرحبا/שלום' }]);
});

test('juntar as partes dá o texto de volta', () => {
  for (const texto of [
    '',
    'sem link nenhum',
    'veja https://exemplo.com.br/a. Depois (https://exemplo.com.br/b), e "https://exemplo.com.br/c"!',
    'https://https://exemplo.com.br',
    'a\nb\n\nhttps://exemplo.com.br\n',
    '<img src=x onerror=alert(1)> https://exemplo.com.br/<b>',
    'https://exemplo.com.br/' + 'a'.repeat(900),
  ]) {
    const junto = partes(texto)
      .map((p) => p.texto ?? p.link)
      .join('');
    assert.equal(junto, texto);
    // Nenhuma parte vazia, e todo link começa com http:// ou https://.
    for (const p of partes(texto)) {
      assert.ok((p.texto ?? p.link).length > 0);
      if (p.link) assert.match(p.link, /^https?:\/\//i);
    }
  }
  assert.deepEqual(partes(''), []);
});

test('a hora', () => {
  assert.equal(hora(new Date(2026, 10, 17, 14, 2).getTime()), '14:02');
  assert.equal(hora(new Date(2026, 10, 17, 9, 5).getTime()), '09:05');
  assert.equal(hora(new Date(2026, 10, 17, 0, 0).getTime()), '00:00');
});

test('o número do botão', () => {
  assert.equal(contagem(0), '');
  assert.equal(contagem(1), '1');
  assert.equal(contagem(9), '9');
  assert.equal(contagem(10), '9+');
  assert.equal(contagem(500), '9+');
});

test('o nome do botão', () => {
  assert.equal(nomeDoBotao(0), 'Chat');
  assert.equal(nomeDoBotao(1), 'Chat, 1 mensagem nova');
  assert.equal(nomeDoBotao(2), 'Chat, 2 mensagens novas');
  assert.equal(nomeDoBotao(12), 'Chat, 12 mensagens novas');
});

test('quem escreveu', () => {
  assert.equal(quem({ voce: true, nome: 'Maria Lima' }), 'Você');
  assert.equal(quem({ voce: false, nome: 'Ana Souza' }), 'Ana Souza');
  assert.equal(quem({ voce: false, nome: '' }), 'Participante');
  assert.equal(quem({ voce: false }), 'Participante');
});

test('o que o leitor de tela ouve', () => {
  assert.equal(dito({ nome: 'Carlos Lima', texto: 'linha 1\nlinha 2' }), 'Carlos Lima escreveu: linha 1 linha 2');
  assert.equal(dito({ nome: '', texto: 'Oi' }), 'Participante escreveu: Oi');
  assert.equal(dito({ nome: 'Carlos Lima', texto: 'a\n\n\nb' }), 'Carlos Lima escreveu: a b');
});

test('o texto numa linha só, e quem escreveu, para o aviso curto', () => {
  assert.equal(numaLinha('linha 1\nlinha 2'), 'linha 1 linha 2');
  assert.equal(numaLinha('  a \n\n\n b  '), 'a b');
  assert.equal(numaLinha('sem quebra'), 'sem quebra');
  assert.equal(numaLinha('<b>oi</b>\nsegunda'), '<b>oi</b> segunda');
  assert.equal(escreveu({ nome: 'Carlos Lima' }), 'Carlos Lima escreveu');
  assert.equal(escreveu({ nome: '' }), 'Participante escreveu');
  assert.equal(escreveu({}), 'Participante escreveu');
  // O que o leitor de tela ouve é as duas coisas juntas.
  const m = { nome: 'Carlos Lima', texto: 'linha 1\nlinha 2' };
  assert.equal(dito(m), `${escreveu(m)}: ${numaLinha(m.texto)}`);
});

test('o texto da mensagem que não foi', () => {
  assert.equal(falha('limite'), 'Não enviada: muitas mensagens seguidas. Espere um pouco.');
  for (const motivo of ['prazo', 'semCanal', 'foraDaReuniao', 'grande', 'invalida', null, undefined]) {
    assert.equal(falha(motivo), 'Não enviada');
  }
});
