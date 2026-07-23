'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { excelSerialParaData, formatarMesAno, calcularVigenteIdx } = require('../tools/orcamento/datas.js');

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

test('calcularVigenteIdx returns the UTC month index (0=Jan) when generatedAt falls within the same year as periodos', () => {
  const periodos = [];
  for (let i = 0; i < 12; i++) periodos.push(new Date(Date.UTC(2026, i, 1)));
  assert.equal(calcularVigenteIdx(periodos, new Date(Date.UTC(2026, 0, 15))), 0);
  assert.equal(calcularVigenteIdx(periodos, new Date(Date.UTC(2026, 6, 21))), 6);
  assert.equal(calcularVigenteIdx(periodos, new Date(Date.UTC(2026, 11, 31))), 11);
});

test('calcularVigenteIdx returns -1 when generatedAt is a year before periodos (whole year is still future)', () => {
  const periodos = [];
  for (let i = 0; i < 12; i++) periodos.push(new Date(Date.UTC(2026, i, 1)));
  assert.equal(calcularVigenteIdx(periodos, new Date(Date.UTC(2025, 11, 20))), -1);
});

test('calcularVigenteIdx returns 12 when generatedAt is a year after periodos (whole year is already past)', () => {
  const periodos = [];
  for (let i = 0; i < 12; i++) periodos.push(new Date(Date.UTC(2026, i, 1)));
  assert.equal(calcularVigenteIdx(periodos, new Date(Date.UTC(2027, 0, 5))), 12);
});
