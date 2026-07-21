'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { excelSerialParaData, formatarMesAno } = require('../tools/orcamento/datas.js');

test('excelSerialParaData converts a known Excel serial (46023, seen in the real MATRIZ header) to 01/01/2026 UTC', () => {
  const data = excelSerialParaData(46023);
  assert.equal(data.getUTCFullYear(), 2026);
  assert.equal(data.getUTCMonth(), 0);
  assert.equal(data.getUTCDate(), 1);
});

test('excelSerialParaData converts 46357 (the last MATRIZ month header) to 01/12/2026 UTC', () => {
  const data = excelSerialParaData(46357);
  assert.equal(data.getUTCFullYear(), 2026);
  assert.equal(data.getUTCMonth(), 11);
  assert.equal(data.getUTCDate(), 1);
});

test('formatarMesAno formats a date as abbreviated Portuguese "Mês/Ano"', () => {
  assert.equal(formatarMesAno(excelSerialParaData(46023)), 'Jan/2026');
  assert.equal(formatarMesAno(excelSerialParaData(46357)), 'Dez/2026');
});
