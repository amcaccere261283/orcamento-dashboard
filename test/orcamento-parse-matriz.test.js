'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMatriz } = require('../tools/orcamento/parse-matriz.js');

// Posições reais confirmadas na MATRIZ (colunas B..BG, 0-based a partir de A=0):
// B=1 ORIGEM, C=2 GRUPO, D=3 TOMADOR, E=4 SUP, F=5 ESCOPO, G=6 APOIO,
// H=7 INICIO, I=8 TERMINO, J=9 SONDAGEM, K=10/L=11 Demanda, M=12 BASE,
// N..Y=13..24 equipesMeses, Z=25 PICO, AA=26 MÉDIA, AB=27 PROD., AC=28 DIAS,
// AD..AO=29..40 volumeMeses, AP=41 TOTAL, AQ=42 TOTAL INICIAL, AR=43 TICKET,
// AS..BD=44..55 financeiroMeses, BE=56 TOTAL, BF=57 TOTAL INICIAL, BG=58 OBSERVAÇÃO.
function linhaHeader() {
  const row = [];
  row[1] = 'ORIGEM'; row[2] = 'GRUPO'; row[3] = 'TOMADOR'; row[4] = 'SUP'; row[5] = 'ESCOPO';
  row[6] = 'APOIO'; row[7] = 'INICIO'; row[8] = 'TERMINO'; row[9] = 'SONDAGEM';
  row[10] = 'Demanda à cadastrar'; row[11] = 'Demanda Cadastrada'; row[12] = 'BASE';
  for (let i = 0; i < 12; i++) row[13 + i] = 46023 + i * 30;
  row[25] = 'PICO'; row[26] = 'MÉDIA'; row[27] = 'PROD.'; row[28] = 'DIAS';
  for (let i = 0; i < 12; i++) row[29 + i] = 46023 + i * 30;
  row[41] = 'TOTAL'; row[42] = 'TOTAL INICIAL'; row[43] = 'TICKET';
  for (let i = 0; i < 12; i++) row[44 + i] = 46023 + i * 30;
  row[56] = 'TOTAL'; row[57] = 'TOTAL INICIAL'; row[58] = 'OBSERVAÇÃO';
  return row;
}

// campos: { origem, grupo, tomador, sup, escopo, apoio, inicio, termino, tipologia, base, equipes, volume, financeiro, observacao }
// equipes/volume/financeiro, quando dados, são um único número repetido nos 12 meses (simplifica a fixture).
function linha(campos) {
  const row = [];
  if (campos.origem !== undefined) row[1] = campos.origem;
  if (campos.grupo !== undefined) row[2] = campos.grupo;
  if (campos.tomador !== undefined) row[3] = campos.tomador;
  if (campos.sup !== undefined) row[4] = campos.sup;
  if (campos.escopo !== undefined) row[5] = campos.escopo;
  if (campos.apoio !== undefined) row[6] = campos.apoio;
  if (campos.inicio !== undefined) row[7] = campos.inicio;
  if (campos.termino !== undefined) row[8] = campos.termino;
  if (campos.tipologia !== undefined) row[9] = campos.tipologia;
  row[12] = campos.base;
  for (let i = 0; i < 12; i++) row[13 + i] = campos.equipes ?? 0;
  row[25] = campos.pico ?? 0; row[26] = campos.media ?? 0; row[27] = campos.prod ?? 0; row[28] = campos.dias ?? 0;
  for (let i = 0; i < 12; i++) row[29 + i] = campos.volume ?? 0;
  row[41] = campos.volumeTotal ?? 0; row[42] = campos.volumeTotalInicial ?? 0; row[43] = campos.ticket ?? 0;
  for (let i = 0; i < 12; i++) row[44 + i] = campos.financeiro ?? 0;
  row[56] = campos.financeiroTotal ?? 0; row[57] = campos.financeiroTotalInicial ?? 0;
  if (campos.observacao !== undefined) row[58] = campos.observacao;
  return row;
}

function construirGrid(linhas) {
  const grid = [];
  grid[1] = linhaHeader();
  linhas.forEach((l, i) => { grid[2 + i] = l; });
  return grid;
}

test('parseMatriz skips the top-of-sheet aggregate block (GRUPO="Todos") and parses real contract rows', () => {
  const grid = construirGrid([
    // Bloco de resumo do topo -- GRUPO ausente/"Todos", deve ser ignorado.
    linha({ origem: 'Todos', grupo: 'Todos', tomador: 'Todos', tipologia: 'SP', base: 'P', equipes: 99 }),
    linha({ base: 'R' }),
    linha({ base: 'T' }),
    // Contrato real: PÁTRIA, tipologia SM.
    linha({ origem: 'CONTRATO VIGENTE', grupo: 'PÁTRIA', tomador: 'Via Araucária S.A', tipologia: 'SM', base: 'P', equipes: 5, volume: 100, financeiro: 1000 }),
    linha({ base: 'R', equipes: 4, volume: 90, financeiro: 900 }),
    linha({ base: 'T', equipes: 4.5, volume: 95, financeiro: 950, observacao: 'Nota qualquer' }),
  ]);

  const registros = parseMatriz(grid);

  assert.equal(registros.length, 1);
  assert.equal(registros[0].grupo, 'PÁTRIA');
  assert.equal(registros[0].tomador, 'Via Araucária S.A');
  assert.equal(registros[0].tipologia, 'SM');
  assert.deepEqual(registros[0].previsto.equipes, Array(12).fill(5));
  assert.deepEqual(registros[0].realizado.volume, Array(12).fill(90));
  assert.deepEqual(registros[0].total.financeiro, Array(12).fill(950));
  assert.equal(registros[0].observacao, 'Nota qualquer');
});

test('parseMatriz fills contract-identifying fields forward across a P/R/T triad when they are blank on R/T rows', () => {
  const grid = construirGrid([
    linha({ origem: 'CONTRATO VIGENTE', grupo: 'PÁTRIA', tomador: 'Via Araucária S.A', tipologia: 'ST', base: 'P' }),
    linha({ base: 'R' }),
    linha({ base: 'T' }),
  ]);
  const registros = parseMatriz(grid);
  assert.equal(registros[0].grupo, 'PÁTRIA');
  assert.equal(registros[0].tomador, 'Via Araucária S.A');
});

test('parseMatriz also works when contract-identifying fields are repeated on every row of the triad (not just the first)', () => {
  const grid = construirGrid([
    linha({ origem: 'CONTRATO VIGENTE', grupo: 'SYSTRA', tomador: 'Ecopistas', tipologia: 'ST', base: 'P' }),
    linha({ origem: 'CONTRATO VIGENTE', grupo: 'SYSTRA', tipologia: 'ST', base: 'R' }),
    linha({ origem: 'CONTRATO VIGENTE', grupo: 'SYSTRA', tipologia: 'ST', base: 'T' }),
  ]);
  const registros = parseMatriz(grid);
  assert.equal(registros.length, 1);
  assert.equal(registros[0].grupo, 'SYSTRA');
});

test('parseMatriz starts a new record when GRUPO changes to a different real value, even without an intervening blank', () => {
  const grid = construirGrid([
    linha({ origem: 'CONTRATO VIGENTE', grupo: 'PÁTRIA', tomador: 'Via Araucária S.A', tipologia: 'SM', base: 'P' }),
    linha({ base: 'R' }), linha({ base: 'T' }),
    linha({ origem: 'CONTRATO VIGENTE', grupo: 'SYSTRA', tomador: 'Ecopistas', tipologia: 'SP', base: 'P' }),
    linha({ base: 'R' }), linha({ base: 'T' }),
  ]);
  const registros = parseMatriz(grid);
  assert.equal(registros.length, 2);
  assert.equal(registros[0].grupo, 'PÁTRIA');
  assert.equal(registros[1].grupo, 'SYSTRA');
  assert.equal(registros[1].tipologia, 'SP');
});

test('parseMatriz skips the MENSAL/ACUMULADO trailer rows at the end of a real contract\'s tipologia list', () => {
  const grid = construirGrid([
    linha({ origem: 'CONTRATO VIGENTE', grupo: 'PÁTRIA', tomador: 'Via Araucária S.A', tipologia: 'SM', base: 'P' }),
    linha({ base: 'R' }), linha({ base: 'T' }),
    linha({ tipologia: 'MENSAL', base: 'P' }), linha({ base: 'R' }), linha({ base: 'T' }),
    linha({ tipologia: 'ACUMULADO', base: 'P' }), linha({ base: 'R' }), linha({ base: 'T' }),
  ]);
  const registros = parseMatriz(grid);
  assert.equal(registros.length, 1);
  assert.equal(registros[0].tipologia, 'SM');
});

test('parseMatriz preserves a blank monthly cell as null (not 0) -- "no data reported yet" for that month must survive parsing, since the dashboard (table and gráfico) needs to tell it apart from a real reported zero', () => {
  const grid = construirGrid([
    linha({ origem: 'CONTRATO VIGENTE', grupo: 'PÁTRIA', tomador: 'X', tipologia: 'SM', base: 'P', equipes: 5, volume: 100, financeiro: 1000 }),
    linha({ base: 'R', equipes: 4, volume: 80, financeiro: 800 }),
    linha({ base: 'T' }),
  ]);
  // Deixa o mês de índice 5 (Jun) em branco de propósito na linha R, tanto
  // pra equipes quanto financeiro -- simula a célula real vazia na planilha
  // (delete, não undefined explícito via campos, pra bater com como uma
  // célula nunca escrita aparece na grade real).
  delete grid[3][13 + 5];
  delete grid[3][44 + 5];

  const registros = parseMatriz(grid);
  assert.equal(registros[0].realizado.equipes[5], null);
  assert.equal(registros[0].realizado.equipes[4], 4);
  assert.equal(registros[0].realizado.equipes[6], 4);
  assert.equal(registros[0].realizado.financeiro[5], null);
  assert.equal(registros[0].realizado.volume[5], 80, 'só os meses de fato vazios na planilha viram null -- volume continuou preenchido nesse mês');
});

test('parseMatriz reads equipesResumo, volumeResumo and financeiroResumo per P/R/T row', () => {
  const grid = construirGrid([
    linha({
      origem: 'CONTRATO VIGENTE', grupo: 'PÁTRIA', tomador: 'X', tipologia: 'SM', base: 'P',
      pico: 6, media: 4.21, prod: 1.5, dias: 25,
      volumeTotal: 1200, volumeTotalInicial: 1599.5, ticket: 1885.65,
      financeiroTotal: 500000, financeiroTotalInicial: 480000,
    }),
    linha({ base: 'R' }), linha({ base: 'T' }),
  ]);
  const registros = parseMatriz(grid);
  assert.deepEqual(registros[0].previsto.equipesResumo, { pico: 6, media: 4.21, prod: 1.5, dias: 25 });
  assert.deepEqual(registros[0].previsto.volumeResumo, { total: 1200, totalInicial: 1599.5, ticket: 1885.65 });
  assert.deepEqual(registros[0].previsto.financeiroResumo, { total: 500000, totalInicial: 480000 });
});
