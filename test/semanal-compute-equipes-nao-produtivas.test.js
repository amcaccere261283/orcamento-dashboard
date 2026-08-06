'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { agregarEquipesNaoProdutivas } = require('../tools/semanal/compute-equipes-nao-produtivas.js');

test('agregarEquipesNaoProdutivas conta campoSemFuro e fora por dia, separados', () => {
  const equipes = [
    { id: '1', nome: 'A', servicos: 'SM', dias: [
      { dia: 1, texto: 'Mobilização' },       // campoSemFuro
      { dia: 2, texto: 'Férias' },             // fora
    ] },
    { id: '2', nome: 'B', servicos: 'SP', dias: [
      { dia: 1, texto: 'baixada' },            // fora
      { dia: 2, texto: 'Veículo quebrou' },    // campoSemFuro
    ] },
  ];
  const { porDiaPorMotivo } = agregarEquipesNaoProdutivas({ equipes, ano: 2026, mes: 8 });
  const dia1 = Math.floor(Date.UTC(2026, 7, 1) / 86400000);
  const dia2 = Math.floor(Date.UTC(2026, 7, 2) / 86400000);
  assert.deepEqual(porDiaPorMotivo[dia1], { campoSemFuro: 1, fora: 1 });
  assert.deepEqual(porDiaPorMotivo[dia2], { campoSemFuro: 1, fora: 1 });
});

test('agregarEquipesNaoProdutivas ignora mobilizada (produtiva) e naoEquipe', () => {
  const equipes = [
    { id: '1', nome: 'A', servicos: 'SM', dias: [
      { dia: 1, texto: 'OK' },                       // mobilizada -- fora do escopo desta função
      { dia: 2, texto: 'Assumir equipe' },           // naoEquipe -- nunca conta
    ] },
  ];
  const { porDiaPorMotivo } = agregarEquipesNaoProdutivas({ equipes, ano: 2026, mes: 8 });
  assert.deepEqual(porDiaPorMotivo, {});
});

test('agregarEquipesNaoProdutivas ignora célula vazia (dia não preenchido ainda)', () => {
  const equipes = [{ id: '1', nome: 'A', servicos: 'SM', dias: [{ dia: 1, texto: '' }] }];
  const { porDiaPorMotivo } = agregarEquipesNaoProdutivas({ equipes, ano: 2026, mes: 8 });
  assert.deepEqual(porDiaPorMotivo, {});
});
