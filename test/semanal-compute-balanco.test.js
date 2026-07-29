'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ordenarPorDesvio, calcularLinhas } = require('../tools/semanal/compute-balanco.js');

test('ordena por desvio com sinal, positivos antes dos negativos', () => {
  const linhas = [
    { sup: 'A', desvio: -50 }, { sup: 'B', desvio: 100 },
    { sup: 'C', desvio: -72 }, { sup: 'D', desvio: 15 }, { sup: 'E', desvio: 70 },
  ];
  assert.deepStrictEqual(ordenarPorDesvio(linhas).map(l => l.sup), ['B', 'E', 'D', 'A', 'C']);
});

test('desvio é realizado menos base', () => {
  const linhas = calcularLinhas(cenario({ previstoVol: 105, realizadoVol: 205 }));
  assert.strictEqual(linhas[0].desvio, 100);
});

test('SUP sem movimento no período fica marcado como inativo', () => {
  const linhas = calcularLinhas(cenario({ previstoVol: 0, realizadoVol: 0 }));
  assert.strictEqual(linhas[0].ativo, false);
});

test('SUP com previsto e sem realizado continua ativo', () => {
  const linhas = calcularLinhas(cenario({ previstoVol: 300, realizadoVol: 0 }));
  assert.strictEqual(linhas[0].ativo, true);
});

test('base Previsto Inicial ausente marca semBase, nunca desvio zero', () => {
  const linhas = calcularLinhas(cenario({ previstoVol: 100, realizadoVol: 100, base: 'previstoInicial', baseline: [] }));
  assert.strictEqual(linhas[0].semBase, true);
  assert.strictEqual(linhas[0].desvio, null);
});

// helper que monta o cenário mínimo de 1 SUP × 1 tipologia no mês 6
function cenario({ previstoVol, realizadoVol, base = 'previsto', baseline = null }) {
  const mk = (vol, eq) => { const v = new Array(12).fill(0), e = new Array(12).fill(0);
    v[6] = vol; e[6] = eq; return { volume: v, equipes: e, financeiro: new Array(12).fill(0) }; };
  return {
    registros: [{ sup: 'SUP-0001-24', tipologia: 'ST', previsto: mk(previstoVol, 2), realizado: mk(realizadoVol, 3), total: mk(0, 0) }],
    indices: [0], tipologia: 'ST', base, dimensao: 'volume', periodo: 'mesVigente',
    vigenteIdx: 6, baseline: baseline === null ? [{ sup: 'SUP-0001-24', tipologia: 'ST', volume: new Array(12).fill(0) }] : baseline,
  };
}
