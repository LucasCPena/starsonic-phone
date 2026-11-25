// As contas puras das reuniões, no Node, sem página. Cada hora é montada com new Date(ano, mês, dia, hora, minuto),
// no relógio de quem roda o teste, para valer em qualquer fuso.
import { expect, test } from '@playwright/test';
import {
  acontecendo,
  ateQuando,
  codigoDoTexto,
  conferirNova,
  descricaoDaLinha,
  fimDoDia,
  inicioPadrao,
  type NovaReuniao,
  quando,
  quandoPorExtenso,
  textoDoCancelar,
  valeAteTexto,
} from '../../src/reunioes/formato';
import type { Reuniao } from '../../src/reunioes/tipos';

/** O instante de um dia e hora do relógio do PC (o mês de 1 a 12). */
const h = (ano: number, mes: number, dia: number, hora = 0, minuto = 0) =>
  new Date(ano, mes - 1, dia, hora, minuto).getTime();

const AGORA = h(2026, 11, 24, 12, 0);

function reuniao(extra: Partial<Reuniao>): Reuniao {
  return {
    codigo: 'k7q49xwpht',
    link: 'https://chat.exemplo.test/r/k7q49xwpht',
    tipo: 'marcada',
    assunto: null,
    inicio: null,
    valeAte: null,
    criouEu: true,
    acontecendo: false,
    pessoas: 0,
    ...extra,
  };
}

test('o quando: hoje, amanhã, ontem, o dia da semana e o outro ano', () => {
  expect(quando(h(2026, 11, 24, 14, 0), AGORA)).toBe('Hoje, 14:00');
  expect(quando(h(2026, 11, 25, 9, 30), AGORA)).toBe('Amanhã, 09:30');
  expect(quando(h(2026, 11, 23, 14, 0), AGORA)).toBe('Ontem, 14:00');
  expect(quando(h(2026, 11, 26, 16, 0), AGORA)).toBe('Qui, 26/11, 16:00');
  expect(quando(h(2027, 11, 26, 16, 0), AGORA)).toBe('Sex, 26/11/2027, 16:00');
  expect(quando(h(2026, 11, 29, 8, 5), AGORA)).toBe('Dom, 29/11, 08:05');
  expect(quando(h(2026, 12, 5, 8, 5), AGORA)).toBe('Sáb, 05/12, 08:05');
});

test('o dia vira pelo calendário, e não por 24 horas', () => {
  expect(quando(h(2026, 11, 25, 0, 10), h(2026, 11, 24, 23, 59))).toBe('Amanhã, 00:10');
  expect(quando(h(2026, 11, 25, 0, 10), h(2026, 11, 25, 0, 0))).toBe('Hoje, 00:10');
  expect(quando(h(2026, 12, 1, 9, 0), h(2026, 11, 30, 12, 0))).toBe('Amanhã, 09:00');
  expect(quando(h(2027, 1, 1, 9, 0), h(2026, 12, 31, 12, 0))).toBe('Amanhã, 09:00');
  expect(quando(h(2026, 12, 31, 9, 0), h(2027, 1, 1, 12, 0))).toBe('Ontem, 09:00');
});

test('o quando por extenso e a descrição da linha são os do quadro', () => {
  expect(quandoPorExtenso(h(2026, 11, 24, 14, 0), AGORA)).toBe('hoje às 14:00');
  expect(quandoPorExtenso(h(2026, 11, 25, 9, 30), AGORA)).toBe('amanhã às 09:30');
  expect(quandoPorExtenso(h(2026, 11, 23, 14, 0), AGORA)).toBe('ontem às 14:00');
  expect(quandoPorExtenso(h(2026, 11, 26, 16, 0), AGORA)).toBe('quinta-feira, 26 de novembro, às 16:00');
  expect(quandoPorExtenso(h(2027, 11, 26, 16, 0), AGORA)).toBe('sexta-feira, 26 de novembro de 2027, às 16:00');

  const planejamento = reuniao({
    assunto: 'Planejamento de dezembro',
    inicio: h(2026, 11, 24, 14, 0),
    acontecendo: true,
    pessoas: 3,
  });
  expect(descricaoDaLinha(planejamento, AGORA)).toBe(
    'Planejamento de dezembro, hoje às 14:00, acontecendo agora com 3 pessoas',
  );
  expect(descricaoDaLinha({ ...planejamento, pessoas: 1 }, AGORA)).toBe(
    'Planejamento de dezembro, hoje às 14:00, acontecendo agora com 1 pessoa',
  );
  const contabilidade = reuniao({ assunto: 'Reunião com a contabilidade', inicio: h(2026, 11, 25, 9, 30) });
  expect(descricaoDaLinha(contabilidade, AGORA)).toBe('Reunião com a contabilidade, amanhã às 09:30');
  expect(descricaoDaLinha(reuniao({ inicio: h(2026, 11, 26, 16, 0) }), AGORA)).toBe(
    'Reunião sem assunto, quinta-feira, 26 de novembro, às 16:00',
  );
});

test('o acontecendo, a validade e o cancelar', () => {
  expect(acontecendo({ acontecendo: true, pessoas: 1 })).toBe('Acontecendo · 1 pessoa');
  expect(acontecendo({ acontecendo: true, pessoas: 3 })).toBe('Acontecendo · 3 pessoas');
  expect(acontecendo({ acontecendo: true, pessoas: 0 })).toBe('');
  expect(acontecendo({ acontecendo: false, pessoas: 0 })).toBe('');

  expect(valeAteTexto(h(2026, 11, 24, 23, 59), AGORA)).toBe('O link vale até hoje, 23:59');
  expect(valeAteTexto(h(2026, 11, 25, 23, 59), AGORA)).toBe('O link vale até amanhã, 23:59');
  expect(valeAteTexto(h(2026, 11, 26, 23, 59), AGORA)).toBe('O link vale até 26/11, 23:59');
  expect(valeAteTexto(h(2027, 1, 3, 23, 59), AGORA)).toBe('O link vale até 03/01/2027, 23:59');
  // A hora é a do valeAte, sem os segundos.
  expect(valeAteTexto(fimDoDia(h(2026, 11, 24, 10, 0)), AGORA)).toBe('O link vale até hoje, 23:59');

  expect(ateQuando(h(2026, 11, 24, 23, 59), AGORA)).toBe('Hoje, às 23:59');
  expect(ateQuando(h(2026, 11, 25, 23, 59), AGORA)).toBe('Amanhã, às 23:59');
  expect(ateQuando(h(2026, 11, 26, 23, 59), AGORA)).toBe('26/11, às 23:59');
  expect(ateQuando(h(2027, 1, 3, 23, 59), AGORA)).toBe('03/01/2027, às 23:59');

  expect(textoDoCancelar({ acontecendo: false, pessoas: 0 })).toBe('O link para de valer na hora.');
  expect(textoDoCancelar({ acontecendo: true, pessoas: 3 })).toBe(
    'O link para de valer na hora. Como a reunião está acontecendo, as 3 pessoas saem.',
  );
  expect(textoDoCancelar({ acontecendo: true, pessoas: 1 })).toBe(
    'O link para de valer na hora. Como a reunião está acontecendo, a pessoa que está nela sai.',
  );
});

test('o código de um texto colado', () => {
  const base = 'https://chat.exemplo.test';
  const codigo = 'k7q49xwpht';
  expect(codigoDoTexto(`${base}/r/${codigo}`, base)).toBe(codigo);
  expect(codigoDoTexto(`  ${base}/r/${codigo}  `, base)).toBe(codigo);
  expect(codigoDoTexto(`${base.toUpperCase()}/r/${codigo}`, base)).toBe(codigo);
  expect(codigoDoTexto(`${base}/r/${codigo}?x=1`, base)).toBe(codigo);
  expect(codigoDoTexto(`${base}/r/${codigo}#p=abc`, base)).toBe(codigo);
  expect(codigoDoTexto(`${base}/r/${codigo}/`, base)).toBe(codigo);
  expect(codigoDoTexto(codigo, base)).toBe(codigo);
  expect(codigoDoTexto(' K7Q49XWPHT ', base)).toBe(codigo);
  expect(codigoDoTexto(`https://outro.exemplo.test/r/${codigo}`, base)).toBeNull();
  expect(codigoDoTexto('k7q49xwph', base)).toBeNull();
  expect(codigoDoTexto('k7q49xwpht2', base)).toBeNull();
  expect(codigoDoTexto('k7q49xwphi', base)).toBeNull();
  expect(codigoDoTexto('k7q49xwph0', base)).toBeNull();
  expect(codigoDoTexto('', base)).toBeNull();
  expect(codigoDoTexto(`${base}/r/`, base)).toBeNull();
});

function nova(extra: Partial<NovaReuniao>): NovaReuniao {
  return { assunto: '', dia: '2026-11-24', hora: '14:00', validade: 'fimDoDia', ateDia: '', ateHora: '', ...extra };
}

test('a Nova reunião: o corpo e os dois erros', () => {
  const inicio = h(2026, 11, 24, 14, 0);

  // O fim do dia e o assunto.
  const r = conferirNova(nova({ assunto: '  Planejamento\tde dezembro  ' }), AGORA);
  expect(r).toEqual({ corpo: { assunto: 'Planejamento de dezembro', inicio, valeAte: fimDoDia(inicio) } });
  const semAssunto = conferirNova(nova({ assunto: '   ' }), AGORA);
  expect(semAssunto).toEqual({ corpo: { inicio, valeAte: fimDoDia(inicio) } });
  expect('assunto' in (semAssunto as { corpo: object }).corpo).toBe(false);

  // O dia que já passou; uma hora de hoje que já passou vale.
  expect(conferirNova(nova({ dia: '2026-11-23' }), AGORA)).toEqual({
    erro: 'O dia da reunião já passou.',
    campo: 'dia',
  });
  expect(conferirNova(nova({ hora: '09:00' }), AGORA)).toEqual({
    corpo: { inicio: h(2026, 11, 24, 9, 0), valeAte: fimDoDia(h(2026, 11, 24, 9, 0)) },
  });

  // A outra validade.
  const erroAte = { erro: 'O link pode valer até 31 dias depois da reunião.', campo: 'ate' };
  const outra = (ateDia: string, ateHora: string) => nova({ validade: 'outra', ateDia, ateHora });
  const trintaEUm = h(2026, 12, 25, 14, 0);
  expect(conferirNova(outra('2026-12-25', '14:00'), AGORA)).toEqual({ corpo: { inicio, valeAte: trintaEUm } });
  expect(conferirNova(outra('2026-12-25', '14:01'), AGORA)).toEqual(erroAte);
  expect(conferirNova(outra('2026-11-24', '14:00'), AGORA)).toEqual(erroAte);
  expect(conferirNova(outra('2026-11-24', '13:59'), AGORA)).toEqual(erroAte);
  // Depois do início, mas antes de agora (a reunião foi marcada para o passado de hoje).
  expect(conferirNova({ ...outra('2026-11-24', '11:00'), hora: '09:00' }, AGORA)).toEqual(erroAte);
});

test('o começo padrão é a próxima meia hora cheia', () => {
  expect(inicioPadrao(h(2026, 11, 24, 14, 7))).toEqual({ dia: '2026-11-24', hora: '14:30' });
  expect(inicioPadrao(h(2026, 11, 24, 14, 30))).toEqual({ dia: '2026-11-24', hora: '15:00' });
  expect(inicioPadrao(h(2026, 11, 24, 14, 59))).toEqual({ dia: '2026-11-24', hora: '15:00' });
  expect(inicioPadrao(h(2026, 11, 24, 23, 40))).toEqual({ dia: '2026-11-25', hora: '00:00' });
  expect(inicioPadrao(h(2026, 12, 31, 23, 40))).toEqual({ dia: '2027-01-01', hora: '00:00' });
});

test('o fim do dia é 23:59:59,999 do dia, no relógio do PC', () => {
  const fim = new Date(fimDoDia(h(2026, 11, 24, 8, 15)));
  expect([fim.getFullYear(), fim.getMonth(), fim.getDate()]).toEqual([2026, 10, 24]);
  expect([fim.getHours(), fim.getMinutes(), fim.getSeconds(), fim.getMilliseconds()]).toEqual([23, 59, 59, 999]);
});
