'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseLinhasLink7 } = require('../tools/semanal/atualizar-equipes-online.js');
const { diaEpoch } = require('../tools/semanal/compute-semanal.js');

function linhaLink7Cru(over = {}) {
  return Object.assign({
    'Ordem de Serviço (OS)': '16744-25',
    Tipo: 'SP',
    'Contrato Financeiro': 'SUP-7722-24',
    'Data / Hora Primeira Foto': '08/08/2026 07:54',
    'ID Sondador': '3275',
  }, over);
}

test('extrai idSondador, sup, tipo e diaEpoch da data/hora da primeira foto', () => {
  const [linha] = parseLinhasLink7([linhaLink7Cru()]);
  assert.strictEqual(linha.idSondador, '3275');
  assert.strictEqual(linha.sup, 'SUP-7722-24');
  assert.strictEqual(linha.tipo, 'SP');
  assert.strictEqual(linha.diaEpoch, diaEpoch(new Date('2026-08-08T00:00:00Z')));
});

test('linha com data ilegível é descartada, não quebra', () => {
  const linhas = parseLinhasLink7([linhaLink7Cru({ 'Data / Hora Primeira Foto': '' })]);
  assert.strictEqual(linhas.length, 0);
});

test('duas linhas da mesma OS+dia (múltiplas fotos) viram duas entradas -- a deduplicação de combinação acontece em compute-equipes-fracao.js, não aqui', () => {
  const linhas = parseLinhasLink7([linhaLink7Cru(), linhaLink7Cru()]);
  assert.strictEqual(linhas.length, 2);
});
