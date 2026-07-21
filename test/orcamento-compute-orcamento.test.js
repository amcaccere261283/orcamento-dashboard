'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeOrcamento, calcularJanelas, dividir, dividirJanelas } = require('../tools/orcamento/compute-orcamento.js');

test('calcularJanelas sums months before the reference index as acumuladoAnterior, and after m3 as acumuladoFuturo', () => {
  const mensal = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]; // jan..dez
  const janelas = calcularJanelas(mensal, 5); // vigente = jun (índice 5, valor 6)
  assert.equal(janelas.acumuladoAnterior, 1 + 2 + 3 + 4 + 5); // jan..mai
  assert.equal(janelas.mesVigente, 6);
  assert.equal(janelas.m1, 7);
  assert.equal(janelas.m2, 8);
  assert.equal(janelas.m3, 9);
  assert.equal(janelas.acumuladoFuturo, 10 + 11 + 12); // out..dez
});

test('calcularJanelas returns null for M+1..M+3 when they fall past the end of the 12-month array', () => {
  const mensal = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const janelas = calcularJanelas(mensal, 11); // vigente = dez (último mês)
  assert.equal(janelas.mesVigente, 12);
  assert.equal(janelas.m1, null);
  assert.equal(janelas.m2, null);
  assert.equal(janelas.m3, null);
  assert.equal(janelas.acumuladoFuturo, 0);
});

test('dividir returns null instead of Infinity/NaN when the denominator is zero or null', () => {
  assert.equal(dividir(100, 0), null);
  assert.equal(dividir(100, null), null);
  assert.equal(dividir(100, 4), 25);
});

test('dividirJanelas divides two Janelas bucket-by-bucket', () => {
  const financeiro = calcularJanelas([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100], 5);
  const volume = calcularJanelas([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10], 5);
  const ticket = dividirJanelas(financeiro, volume);
  assert.equal(ticket.acumuladoAnterior, 10); // 500/50
  assert.equal(ticket.mesVigente, 10);
});

test('computeOrcamento: Previsto produtividade/ticketMedio are the sheet\'s own flat premise values, never recomputed per bucket', () => {
  const registro = {
    grupo: 'PÁTRIA', tipologia: 'SM',
    previsto: {
      equipes: Array(12).fill(5), equipesResumo: { pico: 6, media: 5, prod: 1.5, dias: 25 },
      volume: Array(12).fill(100), volumeResumo: { total: 1200, totalInicial: 1000, ticket: 1885.65 },
      financeiro: Array(12).fill(1000), financeiroResumo: { total: 12000, totalInicial: 10000 },
    },
    realizado: null, total: null,
  };
  const [resultado] = computeOrcamento([registro], 0);
  assert.equal(resultado.resumo.previsto.produtividade, 1.5);
  assert.equal(resultado.resumo.previsto.ticketMedio, 1885.65);
});

test('computeOrcamento: Realizado produtividade = volume ÷ equipes and ticketMedio = financeiro ÷ volume, accumulated per bucket', () => {
  const registro = {
    grupo: 'PÁTRIA', tipologia: 'SM',
    previsto: null,
    realizado: {
      equipes: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4], equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 },
      volume: [80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80], volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
      financeiro: [800, 800, 800, 800, 800, 800, 800, 800, 800, 800, 800, 800], financeiroResumo: { total: 0, totalInicial: 0 },
    },
    total: null,
  };
  const [resultado] = computeOrcamento([registro], 3); // vigente = índice 3 -> acumuladoAnterior soma 3 meses
  assert.equal(resultado.resumo.realizado.produtividade.acumuladoAnterior, (80 * 3) / (4 * 3)); // 20
  assert.equal(resultado.resumo.realizado.ticketMedio.acumuladoAnterior, (800 * 3) / (80 * 3)); // 10
  assert.equal(resultado.resumo.realizado.produtividade.mesVigente, 80 / 4);
});

test('computeOrcamento leaves resumo.previsto/realizado/total null when the source registro has no data for that dimension', () => {
  const registro = { grupo: 'X', tipologia: 'Y', previsto: null, realizado: null, total: null };
  const [resultado] = computeOrcamento([registro], 0);
  assert.equal(resultado.resumo.previsto, null);
  assert.equal(resultado.resumo.realizado, null);
  assert.equal(resultado.resumo.total, null);
});
