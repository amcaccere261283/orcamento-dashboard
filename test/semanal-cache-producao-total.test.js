'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { mesesParaBuscar } = require('../tools/semanal/atualizar-avancos-online.js');

test('cobre de 2025-01 até o mês de hoje, inclusive', () => {
  const meses = mesesParaBuscar(new Date(Date.UTC(2026, 7, 8))); // agosto/2026
  assert.strictEqual(meses.length, 20); // jan/2025 .. ago/2026
  assert.deepStrictEqual(meses[0], { ano: 2025, mes: 1, ehMesCorrente: false });
  assert.deepStrictEqual(meses[meses.length - 1], { ano: 2026, mes: 8, ehMesCorrente: true });
});

test('só o último mês da lista é o mês corrente', () => {
  const meses = mesesParaBuscar(new Date(Date.UTC(2026, 0, 15))); // janeiro/2026
  assert.strictEqual(meses.filter(m => m.ehMesCorrente).length, 1);
  assert.strictEqual(meses[meses.length - 1].ehMesCorrente, true);
});

test('roda em janeiro/2025 (o próprio mês de início) sem devolver lista vazia nem negativa', () => {
  const meses = mesesParaBuscar(new Date(Date.UTC(2025, 0, 10)));
  assert.strictEqual(meses.length, 1);
  assert.deepStrictEqual(meses[0], { ano: 2025, mes: 1, ehMesCorrente: true });
});
