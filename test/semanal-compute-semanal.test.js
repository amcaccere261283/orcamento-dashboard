'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { dividirEmSemanas, fecharMes, SEMANAS } = require('../tools/semanal/compute-semanal.js');

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
