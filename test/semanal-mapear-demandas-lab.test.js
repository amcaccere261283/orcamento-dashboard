'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { mapearDemandasLab } = require('../tools/semanal/mapear-demandas-lab.js');

function linhaLink5(over = {}) {
  return Object.assign({
    Tomador: 'Alves Ribeiro S.A do Brasil',
    'ID Contrato': 'SUP-8690-26',
    'Código do Ensaio': '13609-06',
    'Ordem de Serviço (OS)': '17887-26',
    Sondagem: 'KM 565 + 500',
    'Sondagem Tipo': 'SP',
    'Status da Sondagem': 'Pendente',
    'Tipo do Ensaio': 'MR.S',
    'Status do Ensaio': 'Programada',
    'Status da Amostra': 'Coletada',
    'Data Programada': '04/08/2026',
  }, over);
}

test('classifica pelo Tipo do Ensaio (LAB.C/LAB.E) e lê a Data Programada como criacao', () => {
  const { ensaios } = mapearDemandasLab([linhaLink5()]);
  assert.strictEqual(ensaios.length, 1);
  assert.strictEqual(ensaios[0].sup, 'SUP-8690-26');
  assert.strictEqual(ensaios[0].tipologia, 'LAB.E'); // MR.S -> LAB.E no Frcst
  assert.strictEqual(ensaios[0].concluido, null, 'ainda não foi ensaiado');
  assert.strictEqual(ensaios[0].criacao.getUTCDate(), 4);
});

test('exclui Tomador "Suporte Sondagens - Filial Lapa"', () => {
  const { ensaios, excluidos } = mapearDemandasLab([linhaLink5({ Tomador: 'Suporte Sondagens - Filial Lapa' })]);
  assert.strictEqual(ensaios.length, 0);
  assert.strictEqual(excluidos, 1);
});

test('exclui Sondagem Tipo contendo SEG ou SN', () => {
  const { ensaios, excluidos } = mapearDemandasLab([
    linhaLink5({ 'Sondagem Tipo': 'SEG.A' }),
    linhaLink5({ 'Sondagem Tipo': 'SN' }),
  ]);
  assert.strictEqual(ensaios.length, 0);
  assert.strictEqual(excluidos, 2);
});

test('Tipo do Ensaio desconhecido lança (mesma regra de classificarEnsaioLab)', () => {
  assert.throws(() => mapearDemandasLab([linhaLink5({ 'Tipo do Ensaio': 'ENSAIO-NOVO-INEXISTENTE' })]), /desconhecido/);
});
