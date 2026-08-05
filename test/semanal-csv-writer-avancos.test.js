'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { gridParaCsv } = require('../tools/semanal/csv-writer-avancos.js');
const { parseCsvGrid } = require('../tools/semanal/parse-matriz-cliente.js');

test('gridParaCsv joins cells with commas and rows with \\n', () => {
  const csv = gridParaCsv([['Contrato', 'Status'], ['SUP-0001-24', 'CONCLUIDO']]);
  assert.equal(csv, 'Contrato,Status\nSUP-0001-24,CONCLUIDO\n');
});

test('gridParaCsv quotes a cell containing a comma', () => {
  const csv = gridParaCsv([['Obra'], ['Rodovia BR-277, km 158']]);
  assert.equal(csv, 'Obra\n"Rodovia BR-277, km 158"\n');
});

test('gridParaCsv quotes a cell containing a double quote, doubling it', () => {
  const csv = gridParaCsv([['Observações'], ['Trecho "impenetrável" a 12m']]);
  assert.equal(csv, 'Observações\n"Trecho ""impenetrável"" a 12m"\n');
});

test('gridParaCsv quotes a cell containing a newline', () => {
  const csv = gridParaCsv([['Observações'], ['linha um\nlinha dois']]);
  assert.equal(csv, 'Observações\n"linha um\nlinha dois"\n');
});

test('gridParaCsv treats null/undefined cells as empty', () => {
  const csv = gridParaCsv([['A', 'B'], [null, undefined]]);
  assert.equal(csv, 'A,B\n,\n');
});

test('round-trips through parseCsvGrid unchanged for realistic data', () => {
  const original = [
    ['Contrato', 'Tomador', 'Obra', 'Status', 'Observações de Campo'],
    ['SUP-7133-24', 'Via Araucária S.A', 'BR-277, km 158', 'CONCLUIDO', 'Deslocamento "A", conforme relato'],
    ['SUP-6806-23', 'CCR MSVia', 'Trecho normal', 'PENDENTE', ''],
  ];
  const csv = gridParaCsv(original);
  const roundtripped = parseCsvGrid(csv);
  assert.deepEqual(roundtripped, original);
});
