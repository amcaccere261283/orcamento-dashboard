'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  dividirEmSemanas, fecharMes,
  diaEpoch, semanasDoMes, indiceSemanaAtual, diasNaSemana,
} = require('../tools/semanal/compute-semanal.js');

test('sem "semanas" (4º parâmetro omitido), cai no fallback de N partes iguais -- fluxo real sempre passa "semanas", este é só o contrato defensivo', () => {
  assert.deepStrictEqual(dividirEmSemanas(400, 'volume', 4), [100, 100, 100, 100]);
  assert.deepStrictEqual(dividirEmSemanas(500, 'volume', 5), [100, 100, 100, 100, 100]);
});

test('financeiro divide igual a volume no fallback sem "semanas"', () => {
  assert.deepStrictEqual(dividirEmSemanas(1000, 'financeiro', 4), [250, 250, 250, 250]);
});

test('equipes NÃO divide: 2 equipes no mês são 2 em cada semana, mesmo com 5 semanas', () => {
  assert.deepStrictEqual(dividirEmSemanas(2, 'equipes', 4), [2, 2, 2, 2]);
  assert.deepStrictEqual(dividirEmSemanas(2, 'equipes', 5), [2, 2, 2, 2, 2]);
});

// --- Achado de 2026-08-01: divisão proporcional aos DIAS de cada semana,
// não em N fatias iguais -- uma semana de 1-2 dias (borda de mês) não pode
// receber a mesma fatia que uma semana cheia de 7 dias. -----------------

test('com "semanas" real passada, volume/financeiro repartem proporcionalmente aos dias de cada semana, não em fatias iguais', () => {
  // Julho de 2026: 5 semanas reais, dias [5,7,7,7,5], total 31.
  const julho = semanasDoMes(2026, 6);
  assert.deepStrictEqual(julho.map(diasNaSemana), [5, 7, 7, 7, 5]);
  const resultado = dividirEmSemanas(3100, 'volume', julho.length, julho);
  // 3100/31 = 100 por dia -- fecha redondo de propósito, pra conferir a
  // conta sem depender de arredondamento de ponto flutuante.
  assert.deepStrictEqual(resultado, [500, 700, 700, 700, 500]);
  assert.strictEqual(resultado.reduce((a, b) => a + b, 0), 3100, 'a soma das semanas continua fechando o mês inteiro');
});

test('agosto de 2026 (S1 com 2 dias, S6 com 1 dia -- o caso que motivou o ajuste): as duas semanas de borda recebem MENOS que as semanas cheias, nunca a mesma fatia', () => {
  const agosto = semanasDoMes(2026, 7);
  assert.deepStrictEqual(agosto.map(diasNaSemana), [2, 7, 7, 7, 7, 1]);
  const resultado = dividirEmSemanas(3100, 'volume', agosto.length, agosto);
  // 3100/31 = 100 por dia.
  assert.deepStrictEqual(resultado, [200, 700, 700, 700, 700, 100]);
  assert.ok(resultado[0] < resultado[1], 'S1 (2 dias) tem que receber menos que S2 (7 dias)');
  assert.ok(resultado[5] < resultado[1], 'S6 (1 dia) tem que receber menos que S2 (7 dias)');
});

test('equipes continua sem dividir mesmo com "semanas" real passada -- é foto, não flui por dia', () => {
  const julho = semanasDoMes(2026, 6);
  assert.deepStrictEqual(dividirEmSemanas(2, 'equipes', julho.length, julho), [2, 2, 2, 2, 2]);
});

test('"semanas" com comprimento diferente de numSemanas cai no fallback de fatias iguais, em vez de dividir por uma contagem de dias que não bate', () => {
  const semanasCurtas = semanasDoMes(2026, 6).slice(0, 3); // só 3, mas numSemanas pede 5
  assert.deepStrictEqual(dividirEmSemanas(500, 'volume', 5, semanasCurtas), [100, 100, 100, 100, 100]);
});

test('null continua propagando null mesmo com "semanas" real passada -- ausência de dado não vira zero nem fatia por dia', () => {
  const julho = semanasDoMes(2026, 6);
  assert.deepStrictEqual(dividirEmSemanas(null, 'volume', julho.length, julho), [null, null, null, null, null]);
});

test('volume fecha somando as semanas', () => {
  assert.strictEqual(fecharMes([100, 100, 100, 100], 'volume'), 400);
  assert.strictEqual(fecharMes([100, 100, 100, 100, 100], 'volume'), 500);
});

test('equipes fecha pela média, nunca pela soma', () => {
  assert.strictEqual(fecharMes([2, 2, 2, 2], 'equipes'), 2);
});

test('mês sem dado propaga null em vez de virar zero', () => {
  assert.deepStrictEqual(dividirEmSemanas(null, 'volume', 4), [null, null, null, null]);
  assert.strictEqual(fecharMes([null, null, null, null], 'volume'), null);
});

test('ida e volta fecha para as três dimensões, com 4 ou 5 semanas (fallback sem "semanas")', () => {
  for (const numSemanas of [4, 5]) {
    for (const [valor, dim] of [[400, 'volume'], [1000, 'financeiro'], [3, 'equipes']]) {
      assert.strictEqual(fecharMes(dividirEmSemanas(valor, dim, numSemanas), dim), valor,
        `dimensão ${dim} não fechou com ${numSemanas} semanas`);
    }
  }
});

// Mesmo invariante do teste acima, mas no caminho que a produção REALMENTE
// usa (com "semanas" real, ponderando por dia) -- valores que NÃO dividem
// redondo por dia (7 e 1234.56), pra provar que o fechamento bate mesmo com
// resto de ponto flutuante, não só nos múltiplos exatos de 31 já cobertos
// acima no teste de agosto/julho.
test('ida e volta fecha pro mês vigente mesmo ponderando por dia, com valores que não dividem redondo', () => {
  const julho = semanasDoMes(2026, 6);
  const agosto = semanasDoMes(2026, 7);
  for (const semanas of [julho, agosto]) {
    for (const [valor, dim] of [[7, 'volume'], [1234.56, 'financeiro'], [3, 'equipes']]) {
      const fechado = fecharMes(dividirEmSemanas(valor, dim, semanas.length, semanas), dim);
      assert.ok(Math.abs(fechado - valor) < 1e-9,
        `dimensão ${dim} não fechou (${fechado} vs ${valor}) com semanas reais de ${semanas.length} colunas`);
    }
  }
});

// --- Calendário de semanas reais, corte sempre dentro do mês ---------------

// Date.UTC, não o construtor local: semanasDoMes trabalha inteiramente em
// UTC (mesma convenção de excelSerialParaData/eventos de furos -- ver o
// comentário de diaEpoch em compute-semanal.js) -- um dia local aqui só
// bateria por coincidência de fuso, não por estar correto.
function dia(ano, mes, d) { return diaEpoch(new Date(Date.UTC(ano, mes, d))); }

test('diaEpoch: dias consecutivos produzem inteiros consecutivos', () => {
  const d1 = diaEpoch(new Date(Date.UTC(2026, 6, 15)));
  const d2 = diaEpoch(new Date(Date.UTC(2026, 6, 16)));
  assert.strictEqual(d2, d1 + 1);
});

test('semanasDoMes: julho de 2026 tem exatamente as 5 semanas do exemplo do dono do projeto (2026-08-01)', () => {
  const semanas = semanasDoMes(2026, 6);
  assert.deepStrictEqual(semanas.map(s => [s.inicio, s.fim]), [
    [dia(2026, 6, 1), dia(2026, 6, 5)],   // S1: 01/07 a 05/07 (quarta a domingo -- mês começa numa quarta)
    [dia(2026, 6, 6), dia(2026, 6, 12)],  // S2: 06/07 a 12/07 (semana cheia)
    [dia(2026, 6, 13), dia(2026, 6, 19)], // S3: 13/07 a 19/07
    [dia(2026, 6, 20), dia(2026, 6, 26)], // S4: 20/07 a 26/07
    [dia(2026, 6, 27), dia(2026, 6, 31)], // S5: 27/07 a 31/07 (segunda a sexta -- mês termina numa sexta)
  ]);
});

test('semanasDoMes: nenhuma semana atravessa a virada de mês -- 29 e 30/06 ficam em junho, não em julho', () => {
  const semanasJunho = semanasDoMes(2026, 5);
  const ultimaSemanaJunho = semanasJunho[semanasJunho.length - 1];
  assert.strictEqual(ultimaSemanaJunho.inicio, dia(2026, 5, 29)); // segunda 29/06
  assert.strictEqual(ultimaSemanaJunho.fim, dia(2026, 5, 30));    // termina em 30/06, NUNCA em julho

  const semanasJulho = semanasDoMes(2026, 6);
  assert.strictEqual(semanasJulho[0].inicio, dia(2026, 6, 1), 'julho começa no dia 1, não antes');
});

test('semanasDoMes: mês que começa numa segunda não tem semana curta no início (fevereiro/2027, fora de escopo mas útil pra generalizar)', () => {
  // 2027-02-01 é segunda-feira -- a 1ª semana já sai cheia (7 dias), sem
  // sobra de janeiro.
  const semanas = semanasDoMes(2027, 1);
  assert.strictEqual(semanas[0].inicio, dia(2027, 1, 1));
  assert.strictEqual(semanas[0].fim, dia(2027, 1, 7));
  assert.strictEqual(semanas[0].fim - semanas[0].inicio, 6, 'semana cheia: 7 dias (0 a 6 de diferença)');
});

test('semanasDoMes: mês que termina num domingo não tem semana curta no fim (2026-05-31 é domingo)', () => {
  const semanas = semanasDoMes(2026, 4); // maio
  const ultima = semanas[semanas.length - 1];
  assert.strictEqual(ultima.inicio, dia(2026, 4, 25)); // segunda 25/05
  assert.strictEqual(ultima.fim, dia(2026, 4, 31));    // domingo 31/05, o último dia do mês
  assert.strictEqual(ultima.fim - ultima.inicio, 6, 'última semana sai cheia: 7 dias, sem sobra');
  // A sobra deste mês cai no INÍCIO (maio começa numa sexta) -- confirma que
  // a sobra pode cair tanto no início quanto no fim, dependendo de como o
  // mês se alinha à semana, nunca nos dois ao mesmo tempo por acaso.
  assert.strictEqual(semanas[0].inicio, dia(2026, 4, 1));
  assert.strictEqual(semanas[0].fim, dia(2026, 4, 3), 'sexta a domingo, só 3 dias');
});

test('semanasDoMes: mês que começa num sábado ou domingo pode chegar a 6 semanas (agosto/2026 começa num sábado)', () => {
  const semanas = semanasDoMes(2026, 7); // agosto
  assert.strictEqual(semanas.length, 6);
  assert.strictEqual(semanas[0].inicio, dia(2026, 7, 1));
  assert.strictEqual(semanas[0].fim, dia(2026, 7, 2), 'sábado e domingo, só 2 dias');
  assert.strictEqual(semanas[5].inicio, dia(2026, 7, 31));
  assert.strictEqual(semanas[5].fim, dia(2026, 7, 31), 'segunda-feira sozinha, mês acaba ali');
});

test('semanasDoMes: toda semana do meio (nem primeira nem última) é sempre cheia -- 7 dias, segunda a domingo', () => {
  for (let mes = 0; mes < 12; mes++) {
    const semanas = semanasDoMes(2026, mes);
    for (let i = 1; i < semanas.length - 1; i++) {
      const s = semanas[i];
      assert.strictEqual(s.fim - s.inicio, 6, `mês ${mes}, semana ${i}: esperava 7 dias corridos`);
    }
  }
});

test('semanasDoMes: as semanas de um mês cobrem TODOS os dias do mês, sem lacuna nem repetição', () => {
  for (let mes = 0; mes < 12; mes++) {
    const semanas = semanasDoMes(2026, mes);
    const primeiroDia = dia(2026, mes, 1);
    const ultimoDia = diaEpoch(new Date(Date.UTC(2026, mes + 1, 0)));
    assert.strictEqual(semanas[0].inicio, primeiroDia, `mês ${mes}: 1ª semana não começa no dia 1`);
    assert.strictEqual(semanas[semanas.length - 1].fim, ultimoDia, `mês ${mes}: última semana não termina no último dia`);
    for (let i = 1; i < semanas.length; i++) {
      assert.strictEqual(semanas[i].inicio, semanas[i - 1].fim + 1, `mês ${mes}: lacuna ou sobreposição entre semana ${i - 1} e ${i}`);
    }
  }
});

test('indiceSemanaAtual: acha a semana que contém hojeEpoch', () => {
  const semanas = semanasDoMes(2026, 6); // julho
  const meioDaS3 = dia(2026, 6, 15); // quarta 15/07, dentro de S3 (13/07-19/07)
  assert.strictEqual(indiceSemanaAtual(semanas, meioDaS3), 2);
});

test('indiceSemanaAtual: nunca devolve -1 pra um dia real de dentro do mês -- o corte sempre-dentro-do-mês elimina os dias de fronteira que o calendário ISO antigo tinha', () => {
  for (let mes = 0; mes < 12; mes++) {
    const semanas = semanasDoMes(2026, mes);
    const ultimoDia = diaEpoch(new Date(Date.UTC(2026, mes + 1, 0)));
    for (let d = dia(2026, mes, 1); d <= ultimoDia; d++) {
      assert.notStrictEqual(indiceSemanaAtual(semanas, d), -1, `mês ${mes}, dia ${d}: deveria estar em alguma semana do próprio mês`);
    }
  }
});

test('indiceSemanaAtual: -1 quando hoje está fora do mês vigente sendo exibido (contrato defensivo, não ocorre no fluxo real)', () => {
  const semanasJulho = semanasDoMes(2026, 6);
  assert.strictEqual(indiceSemanaAtual(semanasJulho, dia(2026, 7, 15)), -1, '15/08 não é de julho');
});
