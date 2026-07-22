'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { anexarPrevistoInicial } = require('../tools/orcamento/build-dashboard.js');

function baselineFalso(entradas) {
  const porChave = new Map();
  entradas.forEach(([chave, financeiro]) => {
    porChave.set(chave, { equipes: Array(12).fill(0), volume: Array(12).fill(0), financeiro });
  });
  return { porChave };
}

test('anexarPrevistoInicial matches a live SUP directly against the baseline when the same code exists there', () => {
  const registros = [{ sup: 'SUP-A', tipologia: 'SP' }];
  const baseline = baselineFalso([['SUP-A||SP', Array(12).fill(100)]]);
  anexarPrevistoInicial(registros, baseline);
  assert.deepEqual(registros[0].previstoInicial.financeiro, Array(12).fill(100));
});

test('anexarPrevistoInicial falls back to SUP_MAP_LINHA_BASE only when there is no direct match -- confirms the real mapping for the 7 renamed/renewed contracts cross-referenced with the user', () => {
  // Um dos 7 pares reais: SUP-6830-23 (código atual) <- SUP-6830-24 (nome na linha de base).
  const registros = [{ sup: 'SUP-6830-23', tipologia: 'SP' }];
  const baseline = baselineFalso([['SUP-6830-24||SP', Array(12).fill(4499411 / 12)]]);
  anexarPrevistoInicial(registros, baseline);
  assert.ok(registros[0].previstoInicial.financeiro[0] > 0, 'devia ter achado via SUP_MAP_LINHA_BASE, não ficar zerado');
});

test('anexarPrevistoInicial never lets the SUP_MAP fallback override an existing direct match (guards against silently double-counting or misallocating a renamed contract onto the wrong live SUP)', () => {
  const registros = [{ sup: 'SUP-8224-25', tipologia: 'SP' }];
  const baseline = baselineFalso([
    ['SUP-8224-25||SP', Array(12).fill(1)], // match direto -- devia ganhar
    ['MOTIVA - BID 2.0||SP', Array(12).fill(999)], // fallback -- NÃO devia ser usado aqui
  ]);
  anexarPrevistoInicial(registros, baseline);
  assert.deepEqual(registros[0].previstoInicial.financeiro, Array(12).fill(1));
});

test('anexarPrevistoInicial leaves previstoInicial zeroed (not null) when neither the direct SUP nor the mapped one exists in the baseline', () => {
  const registros = [{ sup: 'SUP-NOVO-SEM-HISTORICO', tipologia: 'SP' }];
  const baseline = baselineFalso([]);
  anexarPrevistoInicial(registros, baseline);
  assert.deepEqual(registros[0].previstoInicial.financeiro, Array(12).fill(0));
});

test('anexarPrevistoInicial counts a chave mapped via SUP_MAP as "used" for the reconciliation report -- it must not show up as an unmatched baseline entry once mapped', () => {
  const registros = [{ sup: 'SUP-6830-23', tipologia: 'SP' }];
  const baseline = baselineFalso([['SUP-6830-24||SP', Array(12).fill(10)]]);
  const { chavesSemMatch, somaSemMatch } = anexarPrevistoInicial(registros, baseline);
  assert.equal(chavesSemMatch, 0);
  assert.equal(somaSemMatch, 0);
});
