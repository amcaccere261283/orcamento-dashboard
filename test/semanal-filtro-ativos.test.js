'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { indicesAtivos, registroAtivo } = require('../tools/semanal/filtro-ativos.js');
const { semanasDoMes, diaEpoch } = require('../tools/semanal/compute-semanal.js');

const MES = 6; // julho
const SEMANAS = semanasDoMes(2026, MES);
const INTERVALO = { inicio: SEMANAS[0].inicio, fim: SEMANAS[SEMANAS.length - 1].fim };
const diaJ = (d) => diaEpoch(new Date(Date.UTC(2026, MES, d)));

function reg(sup, previstoVol, realizadoVol) {
  const zeros = () => new Array(12).fill(0);
  const p = zeros(); p[MES] = previstoVol;
  const r = zeros(); r[MES] = realizadoVol;
  return {
    sup: sup, tipologia: 'ST',
    previsto: { volume: p, financeiro: zeros(), equipes: zeros() },
    realizado: { volume: r, financeiro: zeros(), equipes: zeros() },
  };
}

test('previsto positivo basta para estar ativo', () => {
  assert.strictEqual(registroAtivo(reg('A', 10, 0), 'volume', MES, null, INTERVALO), true);
});

test('realizado positivo basta, mesmo sem previsto', () => {
  assert.strictEqual(registroAtivo(reg('A', 0, 7), 'volume', MES, null, INTERVALO), true);
});

test('sem previsto e sem realizado no mes, esta inativo', () => {
  assert.strictEqual(registroAtivo(reg('A', 0, 0), 'volume', MES, null, INTERVALO), false);
});

test('furo no Avanco Sond dentro do mes ativa o registro mesmo com a MATRIZ zerada', () => {
  const demandas = { porRegistroEventos: { 'A||ST': { sondagemRealizada: [diaJ(9)], chegada: [], saidaEstoque: [] } } };
  assert.strictEqual(registroAtivo(reg('A', 0, 0), 'volume', MES, demandas, INTERVALO), true);
});

test('furo FORA do mes nao ativa', () => {
  const foraDoMes = diaEpoch(new Date(Date.UTC(2026, 5, 9))); // junho
  const demandas = { porRegistroEventos: { 'A||ST': { sondagemRealizada: [foraDoMes], chegada: [], saidaEstoque: [] } } };
  assert.strictEqual(registroAtivo(reg('A', 0, 0), 'volume', MES, demandas, INTERVALO), false);
});

test('indicesAtivos preserva a ORDEM e devolve so os ativos', () => {
  const registros = [reg('A', 10, 0), reg('B', 0, 0), reg('C', 0, 3)];
  assert.deepStrictEqual(indicesAtivos(registros, [0, 1, 2], 'volume', MES, null, INTERVALO), [0, 2]);
});

test('mes fora de [0,11] nao ativa ninguem pela MATRIZ -- nao estoura o array', () => {
  assert.strictEqual(registroAtivo(reg('A', 10, 0), 'volume', 99, null, INTERVALO), false);
});

test('a dimensao importa: ativo em volume pode estar inativo em financeiro', () => {
  const r = reg('A', 10, 0);
  assert.strictEqual(registroAtivo(r, 'volume', MES, null, INTERVALO), true);
  assert.strictEqual(registroAtivo(r, 'financeiro', MES, null, INTERVALO), false);
});
