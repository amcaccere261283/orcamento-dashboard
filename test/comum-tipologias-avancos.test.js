'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  rotularTipologia, ORDEM_TIPOLOGIAS, SO_QUANDO_ACIONADA, MAPA_TIPOLOGIAS,
  fonteParaCliente, trechosParaCliente,
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

test('SM.A entra em SM / SM.F / SR -- reclassificado a pedido do dono em 2026-08-01', () => {
  assert.strictEqual(rotularTipologia('SM.A'), 'SM / SM.F / SR');
});

test('SP.F entra em SP -- reclassificado a pedido do dono em 2026-08-01', () => {
  assert.strictEqual(rotularTipologia('SP.F'), 'SP');
});

test('SEG.A e SEG.V mantêm rótulo próprio e estão marcadas como só-quando-acionada', () => {
  assert.strictEqual(rotularTipologia('SEG.A'), 'SEG.A');
  assert.strictEqual(rotularTipologia('SEG.V'), 'SEG.V');
  assert.deepStrictEqual(SO_QUANDO_ACIONADA, ['SEG.A', 'SEG.V']);
});

test('BQ entra em PI -- reclassificado a pedido do dono em 2026-08-01', () => {
  assert.strictEqual(rotularTipologia('BQ'), 'PI');
});

test('DN entra em SH -- reclassificado a pedido do dono em 2026-08-01 (sem vínculo nos dados com CPTU)', () => {
  assert.strictEqual(rotularTipologia('DN'), 'SH');
});

test('PZ.SP entra em SP -- reclassificado a pedido do dono em 2026-08-01', () => {
  assert.strictEqual(rotularTipologia('PZ.SP'), 'SP');
});

test('PZ.SM e INA entram em SM / SM.F / SR -- reclassificados a pedido do dono em 2026-08-01', () => {
  assert.strictEqual(rotularTipologia('PZ.SM'), 'SM / SM.F / SR');
  assert.strictEqual(rotularTipologia('INA'), 'SM / SM.F / SR');
});

test('SN é o único rótulo que sobra sem equivalente na MATRIZ -- vira Especiais', () => {
  assert.strictEqual(rotularTipologia('SN'), 'Especiais');
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

test('ORDEM_TIPOLOGIAS tem os 13 rótulos, inclui LAB.C/LAB.E e não repete nenhum', () => {
  assert.strictEqual(ORDEM_TIPOLOGIAS.length, 13);
  assert.ok(ORDEM_TIPOLOGIAS.includes('LAB.C'));
  assert.ok(ORDEM_TIPOLOGIAS.includes('LAB.E'));
  assert.strictEqual(new Set(ORDEM_TIPOLOGIAS).size, 13);
});

test('todo rótulo de saída do mapa existe em ORDEM_TIPOLOGIAS', () => {
  for (const destino of Object.values(MAPA_TIPOLOGIAS)) {
    assert.ok(ORDEM_TIPOLOGIAS.includes(destino), `"${destino}" não está em ORDEM_TIPOLOGIAS`);
  }
});

test('o recorte não devolve CR nenhum', () => {
  assert.doesNotMatch(fonteParaCliente(), /\r/);
  trechosParaCliente().forEach((trecho, i) => assert.doesNotMatch(trecho, /\r/, `trecho ${i} tem CR`));
});

test('fonteParaCliente() avalia pros mesmos MAPA_TIPOLOGIAS/rotularTipologia/ORDEM_TIPOLOGIAS/SO_QUANDO_ACIONADA que os exports do Node', () => {
  const fonte = fonteParaCliente();
  const cliente = new Function(`${fonte}
return { MAPA_TIPOLOGIAS: MAPA_TIPOLOGIAS, rotularTipologia: rotularTipologia, ORDEM_TIPOLOGIAS: ORDEM_TIPOLOGIAS, SO_QUANDO_ACIONADA: SO_QUANDO_ACIONADA };`)();

  assert.deepStrictEqual(cliente.MAPA_TIPOLOGIAS, MAPA_TIPOLOGIAS);
  assert.deepStrictEqual(cliente.ORDEM_TIPOLOGIAS, ORDEM_TIPOLOGIAS);
  assert.deepStrictEqual(cliente.SO_QUANDO_ACIONADA, SO_QUANDO_ACIONADA);
  assert.strictEqual(cliente.rotularTipologia('SP.F'), rotularTipologia('SP.F'));
  assert.strictEqual(cliente.rotularTipologia('BQ'), rotularTipologia('BQ'));
  assert.throws(() => cliente.rotularTipologia('ROTULO-INEXISTENTE'), /Tipologia desconhecida/);
});
