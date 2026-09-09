// test/orcamento-compute-demandas-funil.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { montarFunilDemandas } = require('../tools/orcamento/compute-demandas-funil.js');

function registro({ sup, tipologia, tomador, total }) {
  return {
    sup, tipologia, tomador,
    previsto: { volumeResumo: { total, totalInicial: total, ticket: 0 } },
  };
}

test('registro com liberadoSond correspondente: os 5 campos numéricos batem', () => {
  const registros = [registro({ sup: 'SUP-0001-26', tipologia: 'SP', tomador: 'Cliente A', total: 1000 })];
  const liberadoSond = {
    'SUP-0001-26||SP': { prevista: 600, executada: 400, saldo: 200 },
  };
  const { linhas } = montarFunilDemandas({ registros, liberadoSond, propostasGanhas: [] });
  assert.equal(linhas.length, 1);
  assert.deepEqual(linhas[0], {
    sup: 'SUP-0001-26', tomador: 'Cliente A', tipologia: 'SP',
    contratado: 1000, liberado: 600, executado: 400,
    saldoLiberadoNaoExecutado: 200, saldoAliberar: 400,
  });
});

test('registro sem entrada no liberadoSond: liberado/executado/saldo zerados, saldoAliberar === contratado', () => {
  const registros = [registro({ sup: 'SUP-0002-26', tipologia: 'CPTU', tomador: 'Cliente B', total: 500 })];
  const { linhas } = montarFunilDemandas({ registros, liberadoSond: {}, propostasGanhas: [] });
  assert.equal(linhas.length, 1);
  assert.deepEqual(linhas[0], {
    sup: 'SUP-0002-26', tomador: 'Cliente B', tipologia: 'CPTU',
    contratado: 500, liberado: 0, executado: 0,
    saldoLiberadoNaoExecutado: 0, saldoAliberar: 500,
  });
});

test('chave do liberadoSond sem registro correspondente: linha sintética extra', () => {
  const registros = [registro({ sup: 'SUP-0001-26', tipologia: 'SP', tomador: 'Cliente A', total: 1000 })];
  const liberadoSond = {
    'SUP-0001-26||SP': { prevista: 600, executada: 400, saldo: 200 },
    'SUP-9999-26||ST': { prevista: 50, executada: 10, saldo: 40 },
  };
  const { linhas } = montarFunilDemandas({ registros, liberadoSond, propostasGanhas: [] });
  assert.equal(linhas.length, 2);
  const extra = linhas.find(l => l.sup === 'SUP-9999-26');
  assert.ok(extra, 'esperava uma linha sintética para a chave sem registro');
  assert.deepEqual(extra, {
    sup: 'SUP-9999-26', tomador: null, tipologia: 'ST',
    contratado: 0, liberado: 50, executado: 10,
    saldoLiberadoNaoExecutado: 40, saldoAliberar: 0,
  });
});

test('contratado < liberado: saldoAliberar fica clampado em 0, não fica negativo', () => {
  const registros = [registro({ sup: 'SUP-0003-26', tipologia: 'BL', tomador: 'Cliente C', total: 100 })];
  const liberadoSond = {
    'SUP-0003-26||BL': { prevista: 300, executada: 100, saldo: 200 },
  };
  const { linhas } = montarFunilDemandas({ registros, liberadoSond, propostasGanhas: [] });
  assert.equal(linhas[0].contratado, 100);
  assert.equal(linhas[0].liberado, 300);
  assert.equal(linhas[0].saldoAliberar, 0);
});

// executado > liberado não deveria acontecer em dado real, mas se
// liberadoSond[chave].saldo vier negativo num input malformado, este módulo
// PASSA O VALOR ADIANTE tal como veio -- decisão consciente, não bug: saldo
// já é calculado upstream (montarLiberadoSond) e é responsabilidade de quem
// alimenta liberadoSond garantir que ele é coerente; recalcular/clampar aqui
// esconderia um problema real na fonte em vez de deixá-lo visível.
test('saldo negativo no liberadoSond (input malformado) passa adiante sem clamp', () => {
  const registros = [registro({ sup: 'SUP-0004-26', tipologia: 'VT', tomador: 'Cliente D', total: 100 })];
  const liberadoSond = {
    'SUP-0004-26||VT': { prevista: 50, executada: 80, saldo: -30 },
  };
  const { linhas } = montarFunilDemandas({ registros, liberadoSond, propostasGanhas: [] });
  assert.equal(linhas[0].saldoLiberadoNaoExecutado, -30);
});

test('propostasGanhas: passthrough com etapa adicionada, mesma contagem', () => {
  const propostasGanhas = [
    { sup: '8224-25', cliente: 'Cliente E', clienteFinal: 'Final E', tipologia: 'SP', quantidade: 100, origem: 'objeto' },
    { sup: '8300-26', cliente: 'Cliente F', clienteFinal: 'Final F', tipologia: 'CPTU', quantidade: 50, origem: 'nota manual' },
  ];
  const { propostasGanhas: saida } = montarFunilDemandas({ registros: [], liberadoSond: {}, propostasGanhas });
  assert.equal(saida.length, 2);
  assert.deepEqual(saida[0], {
    sup: '8224-25', cliente: 'Cliente E', clienteFinal: 'Final E', tipologia: 'SP',
    quantidade: 100, origem: 'objeto', etapa: 'propostaGanha',
  });
  assert.deepEqual(saida[1], {
    sup: '8300-26', cliente: 'Cliente F', clienteFinal: 'Final F', tipologia: 'CPTU',
    quantidade: 50, origem: 'nota manual', etapa: 'propostaGanha',
  });
});

test('inputs vazios: devolve listas vazias, sem lançar', () => {
  const resultado = montarFunilDemandas({ registros: [], liberadoSond: {}, propostasGanhas: [] });
  assert.deepEqual(resultado, { linhas: [], propostasGanhas: [] });
});
