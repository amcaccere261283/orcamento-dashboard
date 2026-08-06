'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { agregarEquipesAtivoPorDia, diaEpochDeIso } = require('../tools/semanal/compute-equipes-ativo-matriz.js');

test('diaEpochDeIso desloca pro fuso de Brasília -- 02:00 UTC ainda é o dia anterior local', () => {
  // 2026-08-02T02:00:00Z -3h = 2026-08-01T23:00 local -> ainda dia 01.
  const dia1 = Math.floor(Date.UTC(2026, 7, 1) / 86400000);
  assert.equal(diaEpochDeIso('2026-08-02T02:00:00.000Z'), dia1);
  // 2026-08-02T04:00:00Z -3h = 2026-08-02T01:00 local -> já dia 02.
  const dia2 = Math.floor(Date.UTC(2026, 7, 2) / 86400000);
  assert.equal(diaEpochDeIso('2026-08-02T04:00:00.000Z'), dia2);
});

test('agregarEquipesAtivoPorDia pega o ÚLTIMO ponto de cada dia -- retrato de fim de dia', () => {
  const historico = [
    { data: '2026-08-01T12:00:00.000Z', ativo: 80 },
    { data: '2026-08-01T18:00:00.000Z', ativo: 85 }, // último de 01/08 -- este vence
    { data: '2026-08-02T12:00:00.000Z', ativo: 84 },
  ];
  const porDia = agregarEquipesAtivoPorDia(historico);
  const dia1 = Math.floor(Date.UTC(2026, 7, 1) / 86400000);
  const dia2 = Math.floor(Date.UTC(2026, 7, 2) / 86400000);
  assert.equal(porDia[dia1], 85);
  assert.equal(porDia[dia2], 84);
});

test('agregarEquipesAtivoPorDia ignora pontos sem data ou sem ativo numérico', () => {
  const historico = [
    { data: '2026-08-01T12:00:00.000Z' }, // sem ativo
    { ativo: 85 }, // sem data
    null,
  ];
  assert.deepEqual(agregarEquipesAtivoPorDia(historico), {});
});

test('agregarEquipesAtivoPorDia com historico vazio ou ausente devolve mapa vazio', () => {
  assert.deepEqual(agregarEquipesAtivoPorDia([]), {});
  assert.deepEqual(agregarEquipesAtivoPorDia(undefined), {});
});

// Regressão de calibração (2026-08-06): números medidos ao vivo contra
// historico.json publicado, confirmados batendo com historico.xlsx
// ("Ativas (total)": 85 em 01 e 02/08, 85/84/83/83 em 03-06/08).
test('regressão: replica os valores medidos ao vivo em 01-06/08/2026', () => {
  const historico = [
    { data: '2026-08-01T23:00:00.000Z', ativo: 85 },
    { data: '2026-08-02T23:00:00.000Z', ativo: 85 },
    { data: '2026-08-03T23:00:00.000Z', ativo: 85 },
    { data: '2026-08-04T23:00:00.000Z', ativo: 84 },
    { data: '2026-08-05T23:00:00.000Z', ativo: 83 },
    { data: '2026-08-06T11:09:45.000Z', ativo: 83 },
  ];
  const porDia = agregarEquipesAtivoPorDia(historico);
  const dia = (d) => Math.floor(Date.UTC(2026, 7, d) / 86400000);
  const s1 = [porDia[dia(1)], porDia[dia(2)]];
  assert.deepEqual(s1, [85, 85]);
  assert.equal(s1.reduce((a, b) => a + b, 0) / s1.length, 85);
  const s2AteHoje = [porDia[dia(3)], porDia[dia(4)], porDia[dia(5)], porDia[dia(6)]];
  assert.deepEqual(s2AteHoje, [85, 84, 83, 83]);
  assert.equal(s2AteHoje.reduce((a, b) => a + b, 0) / s2AteHoje.length, 83.75);
});
