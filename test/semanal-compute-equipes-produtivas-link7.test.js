'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { agregarEquipesProdutivas } = require('../tools/semanal/compute-equipes-produtivas-link7.js');
const { diaEpoch } = require('../tools/semanal/compute-semanal.js');

const dia1 = diaEpoch(new Date('2026-08-01T00:00:00Z'));
const dia2 = diaEpoch(new Date('2026-08-02T00:00:00Z'));

function linha(idEquipe, sup, tipo, dia) {
  return { idEquipe, sup, tipo, diaEpoch: dia };
}

test('sondador que produziu 1 SUP+Tipo no dia conta 1 inteiro nessa combinação', () => {
  const { porDia } = agregarEquipesProdutivas([linha('3275', 'SUP-A', 'SP', dia1)]);
  assert.strictEqual(porDia['SUP-A||SP'][dia1], 1);
});

test('sondador que produziu em 2 combinações SUP+Tipo distintas no mesmo dia fraciona 0,5 pra cada', () => {
  const { porDia } = agregarEquipesProdutivas([
    linha('3275', 'SUP-A', 'SP', dia1),
    linha('3275', 'SUP-A', 'SP', dia1), // 2ª sondagem, MESMA combinação -- não conta 2x
    linha('3275', 'SUP-B', 'PI', dia1),
  ]);
  assert.strictEqual(porDia['SUP-A||SP'][dia1], 0.5);
  assert.strictEqual(porDia['SUP-B||PI'][dia1], 0.5);
});

test('dois sondadores diferentes no mesmo SUP+Tipo+dia SOMAM', () => {
  const { porDia } = agregarEquipesProdutivas([
    linha('3275', 'SUP-A', 'SP', dia1),
    linha('1390', 'SUP-A', 'SP', dia1),
  ]);
  assert.strictEqual(porDia['SUP-A||SP'][dia1], 2);
});

test('mesmo sondador em dias diferentes conta 1 em cada dia, sem acumular', () => {
  const { porDia } = agregarEquipesProdutivas([
    linha('3275', 'SUP-A', 'SP', dia1),
    linha('3275', 'SUP-A', 'SP', dia2),
  ]);
  assert.strictEqual(porDia['SUP-A||SP'][dia1], 1);
  assert.strictEqual(porDia['SUP-A||SP'][dia2], 1);
});

test('linha sem idEquipe é ignorada, não quebra', () => {
  const { porDia } = agregarEquipesProdutivas([linha('', 'SUP-A', 'SP', dia1)]);
  assert.deepStrictEqual(porDia, {});
});

test('array vazio devolve porDia vazio, sem lançar', () => {
  const { porDia } = agregarEquipesProdutivas([]);
  assert.deepStrictEqual(porDia, {});
});

test('sem linhas nenhuma (undefined) não quebra', () => {
  const { porDia } = agregarEquipesProdutivas(undefined);
  assert.deepStrictEqual(porDia, {});
});
