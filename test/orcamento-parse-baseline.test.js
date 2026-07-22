'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBaseline } = require('../tools/orcamento/parse-baseline.js');

// Posições reais confirmadas na aba "PROJ. GERAL - 110MM" da linha de base
// (colunas B..BB, 0-based a partir de A=0) -- cabeçalho na linha 2 (não 1
// como a MATRIZ), sem coluna BASE (cada linha já é uma combinação SUP+
// tipologia só, não um trio P/R/T):
// B=1 ORIGEM, C=2 GRUPO, D=3 TOMADOR, E=4 ESCOPO, F=5 APOIO, G=6 SUP,
// H=7 INICIO, I=8 TERMINO, J=9 SONDAGEM, K..V=10..21 equipesMeses,
// W=22 PICO, X=23 FRENTES, Y=24 PROD., Z=25 DIAS, AA..AL=26..37 volumeMeses,
// AM=38 TOTAL, AN=39 TICKET, AO..AZ=40..51 financeiroMeses, BA=52 TOTAL,
// BB=53 OBSERVAÇÃO.
function linhaHeader() {
  const row = [];
  row[1] = 'ORIGEM'; row[2] = 'GRUPO'; row[3] = 'TOMADOR'; row[4] = 'ESCOPO'; row[5] = 'APOIO';
  row[6] = 'SUP'; row[7] = 'INICIO'; row[8] = 'TERMINO'; row[9] = 'SONDAGEM';
  for (let i = 0; i < 12; i++) row[10 + i] = 46023 + i * 30;
  row[22] = 'PICO'; row[23] = 'FRENTES'; row[24] = 'PROD.'; row[25] = 'DIAS';
  for (let i = 0; i < 12; i++) row[26 + i] = 46023 + i * 30;
  row[38] = 'TOTAL'; row[39] = 'TICKET';
  for (let i = 0; i < 12; i++) row[40 + i] = 46023 + i * 30;
  row[52] = 'TOTAL'; row[53] = 'OBSERVAÇÃO';
  return row;
}

// campos: { origem, grupo, sup, tipologia, equipes, volume, financeiro }
// equipes/volume/financeiro, quando dados, são um único número repetido nos 12 meses.
function linha(campos) {
  const row = [];
  if (campos.origem !== undefined) row[1] = campos.origem;
  if (campos.grupo !== undefined) row[2] = campos.grupo;
  if (campos.sup !== undefined) row[6] = campos.sup;
  if (campos.tipologia !== undefined) row[9] = campos.tipologia;
  for (let i = 0; i < 12; i++) row[10 + i] = campos.equipes ?? 0;
  row[24] = campos.prod ?? 0; row[25] = campos.dias ?? 0;
  for (let i = 0; i < 12; i++) row[26 + i] = campos.volume ?? 0;
  row[39] = campos.ticket ?? 0;
  for (let i = 0; i < 12; i++) row[40 + i] = campos.financeiro ?? 0;
  return row;
}

function construirGrid(linhas) {
  const grid = [];
  grid[2] = linhaHeader();
  linhas.forEach((l, i) => { grid[3 + i] = l; });
  return grid;
}

test('parseBaseline reads one row per (SUP, tipologia) directly -- no P/R/T triad, unlike the live MATRIZ', () => {
  const grid = construirGrid([
    linha({ origem: 'CONTRATO VIGENTE', grupo: 'PÁTRIA', sup: 'SUP-7133-24', tipologia: 'SP', equipes: 4, volume: 150, financeiro: 283042.5 }),
  ]);
  const { porChave } = parseBaseline(grid);
  assert.equal(porChave.size, 1);
  const dados = porChave.get('SUP-7133-24||SP');
  assert.ok(dados);
  assert.deepEqual(dados.equipes, Array(12).fill(4));
  assert.deepEqual(dados.volume, Array(12).fill(150));
  assert.deepEqual(dados.financeiro, Array(12).fill(283042.5));
});

test('parseBaseline skips the MENSAL/ACUMULADO summary rows and any row without a GRUPO (matches the top-of-sheet aggregate block pattern from the MATRIZ)', () => {
  const grid = construirGrid([
    linha({ origem: 'CONTRATO VIGENTE', tipologia: 'SP', equipes: 99 }), // sem GRUPO -- bloco de resumo do topo
    linha({ origem: 'CONTRATO VIGENTE', grupo: 'PÁTRIA', sup: 'SUP-A', tipologia: 'MENSAL', equipes: 88 }),
    linha({ origem: 'CONTRATO VIGENTE', grupo: 'PÁTRIA', sup: 'SUP-A', tipologia: 'ACUMULADO', equipes: 77 }),
    linha({ origem: 'CONTRATO VIGENTE', grupo: 'PÁTRIA', sup: 'SUP-A', tipologia: 'SP', equipes: 4 }),
  ]);
  const { porChave } = parseBaseline(grid);
  assert.equal(porChave.size, 1);
  assert.ok(porChave.has('SUP-A||SP'));
});

test('parseBaseline preserves a blank monthly cell as null (not 0), same convention as parseMatriz', () => {
  const grid = construirGrid([
    linha({ origem: 'CONTRATO VIGENTE', grupo: 'PÁTRIA', sup: 'SUP-A', tipologia: 'SP', equipes: 4, volume: 150, financeiro: 1000 }),
  ]);
  delete grid[3][10 + 5]; // equipes de junho em branco
  const { porChave } = parseBaseline(grid);
  const dados = porChave.get('SUP-A||SP');
  assert.equal(dados.equipes[5], null);
  assert.equal(dados.equipes[4], 4);
});

test('parseBaseline accumulates a running sum of financeiro across every real row, for build-dashboard to reconcile against the ~110MM the sheet is named after', () => {
  const grid = construirGrid([
    linha({ origem: 'CONTRATO VIGENTE', grupo: 'PÁTRIA', sup: 'SUP-A', tipologia: 'SP', financeiro: 1000000 }),
    linha({ origem: 'NOVOS NEGÓCIOS', grupo: 'DIVERSOS', sup: 'SUP-B', tipologia: 'ST', financeiro: 500000 }),
    linha({ origem: 'CONTRATO VIGENTE', grupo: 'PÁTRIA', sup: 'SUP-A', tipologia: 'MENSAL', financeiro: 999999999 }), // não deve contar
  ]);
  const { somaFinanceiroConferencia } = parseBaseline(grid);
  // 12 meses de 1.000.000 (SP) + 12 meses de 500.000 (ST)
  assert.equal(somaFinanceiroConferencia, 12 * 1000000 + 12 * 500000);
});

test('parseBaseline throws a clear error if the header layout does not match what is expected (guards against silently misreading a changed sheet)', () => {
  const grid = construirGrid([linha({ grupo: 'X', sup: 'Y', tipologia: 'SP' })]);
  grid[2][24] = 'ALGO ERRADO'; // devia ser "PROD."
  assert.throws(() => parseBaseline(grid), /Esperava a coluna "PROD\."/);
});
