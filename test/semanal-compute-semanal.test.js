'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { dividirEmSemanas, fecharMes, SEMANAS, semanaAtual } = require('../tools/semanal/compute-semanal.js');

test('volume divide o mês em 4 partes iguais', () => {
  assert.deepStrictEqual(dividirEmSemanas(400, 'volume'), [100, 100, 100, 100]);
});

test('financeiro divide igual a volume', () => {
  assert.deepStrictEqual(dividirEmSemanas(1000, 'financeiro'), [250, 250, 250, 250]);
});

test('equipes NÃO divide: 2 equipes no mês são 2 em cada semana', () => {
  assert.deepStrictEqual(dividirEmSemanas(2, 'equipes'), [2, 2, 2, 2]);
});

test('volume fecha somando as semanas', () => {
  assert.strictEqual(fecharMes([100, 100, 100, 100], 'volume'), 400);
});

test('equipes fecha pela média, nunca pela soma', () => {
  assert.strictEqual(fecharMes([2, 2, 2, 2], 'equipes'), 2);
});

test('mês sem dado propaga null em vez de virar zero', () => {
  assert.deepStrictEqual(dividirEmSemanas(null, 'volume'), [null, null, null, null]);
  assert.strictEqual(fecharMes([null, null, null, null], 'volume'), null);
});

test('ida e volta fecha para as três dimensões', () => {
  for (const [valor, dim] of [[400, 'volume'], [1000, 'financeiro'], [3, 'equipes']]) {
    assert.strictEqual(fecharMes(dividirEmSemanas(valor, dim), dim), valor,
      'dimensão ' + dim + ' não fechou');
  }
});

test('são sempre 4 semanas', () => {
  assert.strictEqual(SEMANAS, 4);
  assert.strictEqual(dividirEmSemanas(1, 'volume').length, 4);
});

test('semanaAtual divide os dias do mês em 4 fatias nominais, mesma lógica de dividirEmSemanas aplicada ao calendário', () => {
  // Mês de 28 dias -- cada fatia nominal tem exatamente 7 dias.
  assert.strictEqual(semanaAtual(1, 28), 1);
  assert.strictEqual(semanaAtual(7, 28), 1);
  assert.strictEqual(semanaAtual(8, 28), 2);
  assert.strictEqual(semanaAtual(14, 28), 2);
  assert.strictEqual(semanaAtual(15, 28), 3);
  assert.strictEqual(semanaAtual(21, 28), 3);
  assert.strictEqual(semanaAtual(22, 28), 4);
  assert.strictEqual(semanaAtual(28, 28), 4);
});

test('semanaAtual nunca sai de [1,4], mesmo em mês de 31 dias (fatias não fecham em número inteiro de dias)', () => {
  assert.strictEqual(semanaAtual(1, 31), 1);
  assert.strictEqual(semanaAtual(31, 31), 4);
  for (let dia = 1; dia <= 31; dia++) {
    const s = semanaAtual(dia, 31);
    assert.ok(s >= 1 && s <= 4, `dia ${dia}/31 produziu semana ${s}, fora de [1,4]`);
  }
});
