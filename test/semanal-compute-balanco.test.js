'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ordenarPorDesvio, calcularLinhas } = require('../tools/semanal/compute-balanco.js');
const { DIAS_PREMISSA_MES, mediaEquipesPonderada } = require('../tools/comum/calculo-equipes.js');

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

// --- Correções da rodada de revisão (achados 1-3 sobre o commit d209db4) ---

// Achado 2: o fixture original deste teste (herdado do brief) usava
// `{sup, tipologia, volume}` solto na linha de base, mas o formato REAL que
// tools/semanal/build-dashboard.js produz (baselineParaCliente, sobre o Map
// de tools/orcamento/parse-baseline.js) é `{chave: "sup||tipologia", ...}`
// -- mesma convenção `${sup}||${tipologia}` que parseBaseline já usa como
// chave do Map. Com o fixture antigo, ligar isto a dados reais faria TODA
// linha cair em semBase:true (nada bateria), indistinguível de "contrato
// novo sem linha na linha de base" -- falha silenciosa. calcularLinhas foi
// corrigido pra casar por 'chave'; os testes abaixo provam os dois lados.
test('base Previsto Inicial casa por "chave" (formato real de baselineParaCliente), não por sup/tipologia soltos', () => {
  const linhas = calcularLinhas(cenario({
    previstoVol: 100, realizadoVol: 130, base: 'previstoInicial',
    baseline: [mkBaseline('SUP-0001-24||ST', 80, 2)],
  }));
  assert.strictEqual(linhas[0].semBase, false);
  assert.strictEqual(linhas[0].valorBase, 80);
  assert.strictEqual(linhas[0].desvio, 50); // 130 - 80
});

test('base Previsto Inicial com baseline não vazio mas sem chave pra este SUP/tipologia também marca semBase, nunca desvio zero', () => {
  const linhas = calcularLinhas(cenario({
    previstoVol: 100, realizadoVol: 100, base: 'previstoInicial',
    // baseline tem dado de verdade, só que pra outro SUP -- não pode ser
    // confundido com "linha de base vazia".
    baseline: [mkBaseline('SUP-9999-24||PB', 999, 9)],
  }));
  assert.strictEqual(linhas[0].semBase, true);
  assert.strictEqual(linhas[0].valorBase, null);
  assert.strictEqual(linhas[0].desvio, null);
});

// Achado 3: equipesBase/equipesRealizado/desvioEquipes não tinham asserção
// própria -- só apareciam por leitura do brief. Cobertos agora, inclusive
// no caso multi-mês que prova a média PONDERADA por dias (não a soma, nem a
// média simples), que é a premissa que mediaEquipesPonderada (Task 4)
// existe pra garantir.
test('equipesBase e equipesRealizado vêm de mediaEquipesPonderada, desvioEquipes é a diferença', () => {
  const linhas = calcularLinhas(cenario({ previstoVol: 105, realizadoVol: 205 }));
  // cenario() fixa equipes previsto=2, realizado=3 num único mês -- média
  // ponderada de um mês só devolve o próprio valor (peso 1).
  assert.strictEqual(linhas[0].equipesBase, 2);
  assert.strictEqual(linhas[0].equipesRealizado, 3);
  assert.strictEqual(linhas[0].desvioEquipes, 1);
});

test('acumuladoAteMes: equipes usa média ponderada por dias entre jan (15d) e fev (30d), não soma nem média simples', () => {
  const previsto = { volume: new Array(12).fill(0), equipes: new Array(12).fill(0), financeiro: new Array(12).fill(0) };
  const realizado = { volume: new Array(12).fill(0), equipes: new Array(12).fill(0), financeiro: new Array(12).fill(0) };
  previsto.equipes[0] = 2; previsto.equipes[1] = 4; // jan=2, fev=4
  realizado.volume[0] = 10; realizado.volume[1] = 10; // só pra 'ativo' ficar true

  const linhas = calcularLinhas({
    registros: [{ sup: 'SUP-0002-24', tipologia: 'ST', previsto, realizado, total: previsto }],
    indices: [0], tipologia: 'ST', base: 'previsto', dimensao: 'volume', periodo: 'acumuladoAteMes',
    vigenteIdx: 1, baseline: [],
  });

  const pesoJan = DIAS_PREMISSA_MES[0], pesoFev = DIAS_PREMISSA_MES[1];
  const esperado = (2 * pesoJan + 4 * pesoFev) / (pesoJan + pesoFev);
  // Trava contra qualquer troca de mediaEquipesPonderada por outra conta:
  // usa a própria função (Task 4) como oráculo, em vez de um número fixo.
  assert.strictEqual(esperado, mediaEquipesPonderada(previsto.equipes, 0, 2));
  assert.strictEqual(linhas[0].equipesBase, esperado);
  assert.ok(linhas[0].equipesBase !== 3, 'não pode ser a média simples (2+4)/2=3 -- jan e fev não pesam igual');
  assert.ok(linhas[0].equipesBase < 6, 'não pode ser a soma (2+4=6)');
});

// helper que monta uma entrada de linha de base no formato real
// (baselineParaCliente): {chave, volume, equipes, financeiro}, com o valor
// de interesse só no mês 6 (mesmo mês vigente que cenario() usa).
function mkBaseline(chave, volMes6, eqMes6) {
  const volume = new Array(12).fill(0), equipes = new Array(12).fill(0);
  volume[6] = volMes6; equipes[6] = eqMes6;
  return { chave, volume, equipes, financeiro: new Array(12).fill(0) };
}

// helper que monta o cenário mínimo de 1 SUP × 1 tipologia no mês 6
function cenario({ previstoVol, realizadoVol, base = 'previsto', baseline = null }) {
  const mk = (vol, eq) => { const v = new Array(12).fill(0), e = new Array(12).fill(0);
    v[6] = vol; e[6] = eq; return { volume: v, equipes: e, financeiro: new Array(12).fill(0) }; };
  return {
    registros: [{ sup: 'SUP-0001-24', tipologia: 'ST', previsto: mk(previstoVol, 2), realizado: mk(realizadoVol, 3), total: mk(0, 0) }],
    indices: [0], tipologia: 'ST', base, dimensao: 'volume', periodo: 'mesVigente',
    vigenteIdx: 6, baseline: baseline === null ? [{ chave: 'SUP-0001-24||ST', volume: new Array(12).fill(0) }] : baseline,
  };
}
