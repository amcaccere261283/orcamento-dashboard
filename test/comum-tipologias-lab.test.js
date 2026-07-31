'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { classificarEnsaioLab, MAPA_TIPO_ENSAIO_LAB } = require('../tools/comum/tipologias-lab.js');

test('todo destino do mapa é LAB.C ou LAB.E, nunca outra coisa', () => {
  for (const destino of Object.values(MAPA_TIPO_ENSAIO_LAB)) {
    assert.ok(destino === 'LAB.C' || destino === 'LAB.E', `destino inesperado: "${destino}"`);
  }
});

test('mapa tem exatamente os 60 tipos de ensaio medidos na planilha real em 2026-07-31', () => {
  assert.strictEqual(Object.keys(MAPA_TIPO_ENSAIO_LAB).length, 60);
});

test('amostra de Convencional: caracterização básica', () => {
  for (const t of ['LL', 'LP', 'SED', 'M.ESP', 'PEN', 'CBR.5', 'MCT.C', 'PH']) {
    assert.strictEqual(classificarEnsaioLab(t), 'LAB.C', `esperava LAB.C pra "${t}"`);
  }
});

test('amostra de Especial: ensaios mecânicos/avançados', () => {
  for (const t of ['MR.S', 'TRI3.CU', 'ADENS.I.9', 'PERM.V', 'DURAB', 'LOAD.TEST', 'DOSAG.']) {
    assert.strictEqual(classificarEnsaioLab(t), 'LAB.E', `esperava LAB.E pra "${t}"`);
  }
});

test('os 3 tipos sem classificação confiável (EQ.A, E.CAN, IND.F.P) vão pra Especial por padrão', () => {
  for (const t of ['EQ.A', 'E.CAN', 'IND.F.P']) {
    assert.strictEqual(classificarEnsaioLab(t), 'LAB.E');
  }
});

test('espaço em volta e caixa não decidem nada', () => {
  assert.strictEqual(classificarEnsaioLab('  ll  '), 'LAB.C');
  assert.strictEqual(classificarEnsaioLab('tri3.cu'), 'LAB.E');
});

test('tipo de ensaio desconhecido LANÇA citando o rótulo -- nunca cai calado em Convencional ou Especial', () => {
  assert.throws(() => classificarEnsaioLab('XYZ.NOVO'), /XYZ\.NOVO/);
});

test('tipo de ensaio vazio LANÇA -- linha sem "Tipo de Ensaio" é descartada antes, não classificada', () => {
  assert.throws(() => classificarEnsaioLab(''), /vazi/i);
  assert.throws(() => classificarEnsaioLab(null), /vazi/i);
});
