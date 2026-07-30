'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  dividirEmSemanas, fecharMes, SEMANAS, semanaAtual,
  diaEpoch, semanasDoMes, indiceSemanaAtual,
} = require('../tools/semanal/compute-semanal.js');

test('volume divide o mês em N partes iguais', () => {
  assert.deepStrictEqual(dividirEmSemanas(400, 'volume', 4), [100, 100, 100, 100]);
  assert.deepStrictEqual(dividirEmSemanas(500, 'volume', 5), [100, 100, 100, 100, 100]);
});

test('financeiro divide igual a volume', () => {
  assert.deepStrictEqual(dividirEmSemanas(1000, 'financeiro', 4), [250, 250, 250, 250]);
});

test('equipes NÃO divide: 2 equipes no mês são 2 em cada semana, mesmo com 5 semanas', () => {
  assert.deepStrictEqual(dividirEmSemanas(2, 'equipes', 4), [2, 2, 2, 2]);
  assert.deepStrictEqual(dividirEmSemanas(2, 'equipes', 5), [2, 2, 2, 2, 2]);
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

test('ida e volta fecha para as três dimensões, com 4 ou 5 semanas', () => {
  for (const numSemanas of [4, 5]) {
    for (const [valor, dim] of [[400, 'volume'], [1000, 'financeiro'], [3, 'equipes']]) {
      assert.strictEqual(fecharMes(dividirEmSemanas(valor, dim, numSemanas), dim), valor,
        `dimensão ${dim} não fechou com ${numSemanas} semanas`);
    }
  }
});

test('SEMANAS/semanaAtual continuam em 4 fatias nominais -- obsoletos, mantidos só até a Tarefa 3 trocar render-aba-semanal.js pelo calendário real', () => {
  assert.strictEqual(SEMANAS, 4);
  assert.strictEqual(semanaAtual(1, 28), 1);
  assert.strictEqual(semanaAtual(15, 28), 3);
  assert.strictEqual(semanaAtual(28, 28), 4);
});

// --- Calendário ISO de semanas reais ---------------------------------------

function dia(ano, mes, d) { return diaEpoch(new Date(ano, mes, d)); }

test('diaEpoch: dias consecutivos produzem inteiros consecutivos', () => {
  const d1 = diaEpoch(new Date(2026, 6, 15));
  const d2 = diaEpoch(new Date(2026, 6, 16));
  assert.strictEqual(d2, d1 + 1);
});

test('semanasDoMes: os 12 meses de 2026 somam 53 semanas, cada um com 4 ou 5 (2026 é ano ISO de 53 semanas)', () => {
  const contagens = [];
  for (let mes = 0; mes < 12; mes++) contagens.push(semanasDoMes(2026, mes).length);
  assert.deepStrictEqual(contagens, [5, 4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 5]);
  assert.strictEqual(contagens.reduce((a, b) => a + b, 0), 53);
});

test('semanasDoMes: janeiro de 2026 tem 5 semanas, a primeira pertence a janeiro mesmo com 3 dias em dezembro (regra da maioria)', () => {
  const semanas = semanasDoMes(2026, 0);
  assert.strictEqual(semanas.length, 5);
  assert.strictEqual(semanas[0].inicio, dia(2025, 11, 29)); // segunda 29/12/2025
  assert.strictEqual(semanas[0].fim, dia(2026, 0, 4));      // domingo 04/01/2026
  assert.strictEqual(semanas[4].inicio, dia(2026, 0, 26));  // segunda 26/01
  assert.strictEqual(semanas[4].fim, dia(2026, 1, 1));      // domingo 01/02
});

test('semanasDoMes: julho de 2026 tem 5 semanas, a última (S31) vai de segunda 27/07 a domingo 02/08', () => {
  const semanas = semanasDoMes(2026, 6);
  assert.strictEqual(semanas.length, 5);
  assert.strictEqual(semanas[0].inicio, dia(2026, 5, 29)); // segunda 29/06
  assert.strictEqual(semanas[0].fim, dia(2026, 6, 5));     // domingo 05/07
  assert.strictEqual(semanas[4].inicio, dia(2026, 6, 27)); // segunda 27/07
  assert.strictEqual(semanas[4].fim, dia(2026, 7, 2));     // domingo 02/08 -- cai em agosto, mas 5 dias em julho vs 2 em agosto
});

test('semanasDoMes: agosto de 2026 tem 4 semanas, a primeira começa segunda 03/08 (01-02/08 são de julho, não de agosto)', () => {
  const semanas = semanasDoMes(2026, 7);
  assert.strictEqual(semanas.length, 4);
  assert.strictEqual(semanas[0].inicio, dia(2026, 7, 3)); // segunda 03/08
  assert.strictEqual(semanas[3].fim, dia(2026, 7, 30));   // domingo 30/08
});

test('semanasDoMes: nenhuma semana falta ou se repete entre meses consecutivos -- fim de um mês + 1 dia = início do mês seguinte', () => {
  for (let mes = 0; mes < 11; mes++) {
    const semanasMes = semanasDoMes(2026, mes);
    const semanasProximo = semanasDoMes(2026, mes + 1);
    const ultimoFim = semanasMes[semanasMes.length - 1].fim;
    const primeiroInicio = semanasProximo[0].inicio;
    assert.strictEqual(primeiroInicio, ultimoFim + 1,
      `mês ${mes}->${mes + 1}: última semana termina em ${ultimoFim}, próxima começa em ${primeiroInicio}`);
  }
});

test('indiceSemanaAtual: acha a semana que contém hojeEpoch', () => {
  const semanas = semanasDoMes(2026, 6); // julho, S27..S31
  const meioDaS29 = dia(2026, 6, 15); // quarta 15/07, dentro de S29 (13/07-19/07)
  assert.strictEqual(indiceSemanaAtual(semanas, meioDaS29), 2);
});

test('indiceSemanaAtual: -1 quando hoje cai fora de todas as semanas do mês (dias de fronteira jul/ago: 01-02/08 pertencem a S31, que é de julho)', () => {
  const semanasAgosto = semanasDoMes(2026, 7); // S32..S36, começa 03/08
  assert.strictEqual(indiceSemanaAtual(semanasAgosto, dia(2026, 7, 1)), -1);
  assert.strictEqual(indiceSemanaAtual(semanasAgosto, dia(2026, 7, 2)), -1);
});
