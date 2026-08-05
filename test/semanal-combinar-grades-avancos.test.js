'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { combinarGradesAvancos } = require('../tools/semanal/atualizar-avancos-online.js');

// Fixtures no MESMO formato que readXlsxSheetFromBuffer devolve pra um
// .xlsx real: grid[0] é sempre undefined (Excel numera linha a partir de 1,
// nunca 0 -- ver o comentário em atualizar-avancos-online.js), cabeçalho em
// grid[1], dado a partir de grid[2]. Confirmado baixando um contrato real em
// 2026-08-05 -- ver task-3-report.md.

test('combinarGradesAvancos usa o cabecalho (grid[1]) do primeiro contrato e junta as linhas de dado (grid[2] em diante) de todos', () => {
  const contrato1 = [
    undefined,
    ['Contrato', 'Status'],
    ['SUP-0001-24', 'CONCLUIDO'],
    ['SUP-0001-24', 'PENDENTE'],
  ];
  const contrato2 = [
    undefined,
    ['Contrato', 'Status'],
    ['SUP-0002-24', 'EXECUTADO'],
  ];
  const { grid, avisos } = combinarGradesAvancos([contrato1, contrato2]);
  assert.deepEqual(grid, [
    ['Contrato', 'Status'],
    ['SUP-0001-24', 'CONCLUIDO'],
    ['SUP-0001-24', 'PENDENTE'],
    ['SUP-0002-24', 'EXECUTADO'],
  ]);
  assert.deepEqual(avisos, []);
});

test('combinarGradesAvancos avisa E PULA as linhas de um contrato com cabecalho diferente do primeiro', () => {
  const contrato1 = [undefined, ['Contrato', 'Status'], ['SUP-0001-24', 'CONCLUIDO']];
  const contrato2 = [undefined, ['Contrato', 'Situacao'], ['SUP-0002-24', 'EXECUTADO']];
  const { grid, avisos } = combinarGradesAvancos([contrato1, contrato2]);
  // Cabeçalho + só a linha de dado do PRIMEIRO contrato -- as linhas do
  // contrato2 (cabeçalho diferente) ficam de fora, senão seriam lidas sob
  // colunas erradas e produziriam datas/SUPs errados sem erro nenhum.
  assert.deepEqual(grid, [
    ['Contrato', 'Status'],
    ['SUP-0001-24', 'CONCLUIDO'],
  ]);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /cabeçalho diferente/);
});

test('combinarGradesAvancos lida com contrato sem nenhuma linha de dado (so cabecalho)', () => {
  const contrato1 = [undefined, ['Contrato', 'Status'], ['SUP-0001-24', 'CONCLUIDO']];
  const contrato2 = [undefined, ['Contrato', 'Status']];
  const { grid } = combinarGradesAvancos([contrato1, contrato2]);
  assert.deepEqual(grid, [['Contrato', 'Status'], ['SUP-0001-24', 'CONCLUIDO']]);
});

test('combinarGradesAvancos ignora buracos (linhas Excel genuinamente vazias, sem <row> na XML) dentro dos dados', () => {
  const contrato1 = [undefined, ['Contrato', 'Status'], ['SUP-0001-24', 'CONCLUIDO'], undefined, ['SUP-0001-24', 'PENDENTE']];
  const { grid } = combinarGradesAvancos([contrato1]);
  assert.deepEqual(grid, [
    ['Contrato', 'Status'],
    ['SUP-0001-24', 'CONCLUIDO'],
    ['SUP-0001-24', 'PENDENTE'],
  ]);
});

test('combinarGradesAvancos lanca erro claro se a lista de grades vier vazia', () => {
  assert.throws(() => combinarGradesAvancos([]), /nenhum contrato baixado/);
});
