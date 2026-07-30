'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  rotularTipologia, ORDEM_TIPOLOGIAS, SO_QUANDO_ACIONADA, MAPA_TIPOLOGIAS,
} = require('../tools/comum/tipologias-avancos.js');

test('as 6 tipologias que já batem com a MATRIZ passam direto', () => {
  for (const t of ['SP', 'ST', 'PI', 'BL', 'SH', 'VT']) {
    assert.strictEqual(rotularTipologia(t), t);
  }
});

test('CPTU vira CPTu -- diferença é só de caixa, e a MATRIZ manda', () => {
  assert.strictEqual(rotularTipologia('CPTU'), 'CPTu');
});

test('SM, SM.F e SR colapsam no rótulo único da MATRIZ', () => {
  assert.strictEqual(rotularTipologia('SM'), 'SM / SM.F / SR');
  assert.strictEqual(rotularTipologia('SM.F'), 'SM / SM.F / SR');
  assert.strictEqual(rotularTipologia('SR'), 'SM / SM.F / SR');
});

test('SM.A NÃO entra em SM / SM.F / SR -- decisão do dono, tem rótulo próprio', () => {
  assert.strictEqual(rotularTipologia('SM.A'), 'SM.A');
});

test('SP.F NÃO entra em SP -- decisão do dono, tem rótulo próprio', () => {
  assert.strictEqual(rotularTipologia('SP.F'), 'SP.F');
});

test('SEG.A e SEG.V mantêm rótulo próprio e estão marcadas como só-quando-acionada', () => {
  assert.strictEqual(rotularTipologia('SEG.A'), 'SEG.A');
  assert.strictEqual(rotularTipologia('SEG.V'), 'SEG.V');
  assert.deepStrictEqual(SO_QUANDO_ACIONADA, ['SEG.A', 'SEG.V']);
});

test('os 6 rótulos sem equivalente na MATRIZ viram Especiais', () => {
  for (const t of ['BQ', 'SN', 'DN', 'PZ.SP', 'PZ.SM', 'INA']) {
    assert.strictEqual(rotularTipologia(t), 'Especiais');
  }
});

test('rótulo desconhecido LANÇA citando o rótulo -- nunca cai calado em Especiais', () => {
  assert.throws(() => rotularTipologia('XYZ'), /XYZ/);
});

test('espaço em volta e caixa não decidem nada', () => {
  assert.strictEqual(rotularTipologia('  sp  '), 'SP');
  assert.strictEqual(rotularTipologia('cptu'), 'CPTu');
});

test('rótulo vazio LANÇA -- linha sem tipo é descartada antes, não rotulada', () => {
  assert.throws(() => rotularTipologia(''), /vazi/i);
  assert.throws(() => rotularTipologia(null), /vazi/i);
});

test('ORDEM_TIPOLOGIAS tem os 15 rótulos, inclui LAB.C/LAB.E e não repete nenhum', () => {
  assert.strictEqual(ORDEM_TIPOLOGIAS.length, 15);
  assert.ok(ORDEM_TIPOLOGIAS.includes('LAB.C'));
  assert.ok(ORDEM_TIPOLOGIAS.includes('LAB.E'));
  assert.strictEqual(new Set(ORDEM_TIPOLOGIAS).size, 15);
});

test('todo rótulo de saída do mapa existe em ORDEM_TIPOLOGIAS', () => {
  for (const destino of Object.values(MAPA_TIPOLOGIAS)) {
    assert.ok(ORDEM_TIPOLOGIAS.includes(destino), `"${destino}" não está em ORDEM_TIPOLOGIAS`);
  }
});
