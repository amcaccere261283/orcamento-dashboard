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

// --- Texto no DEFAULT não é "em campo sem furo" (correção de 2026-08-05) ----
// classificarDiaEquipe devolve {estado:'campoSemFuro', noDefault:true} pra todo
// texto que não casou exceção nenhuma, de propósito: o jeito de escrever
// "trabalhando" é cauda infinita (nome de rodovia, de tomador, de lugar), e
// medindo julho+agosto de 2026 sobraram 572 equipe-dia em 70 textos assim --
// "CCR RioSP" (125), "Via Mineira" (89), "Em São Pedro". Pra "equipes ATIVAS"
// isso é inócuo (mobilizada e campoSemFuro contam como ativa dos dois jeitos);
// aqui NÃO, porque contá-los como não-produtivos inflaria a não-produtividade
// justamente com equipe que estava produzindo.
test('agregarEquipesNaoProdutivas NÃO conta texto não reconhecido (noDefault) como "em campo sem furo"', () => {
  const equipes = [
    { id: '1', nome: 'A', servicos: 'SM', dias: [
      { dia: 1, texto: 'CCR RioSP' },      // noDefault: nome de tomador/trecho -- equipe TRABALHANDO
      { dia: 2, texto: 'Via Mineira' },    // idem
    ] },
  ];
  const { porDiaPorMotivo } = agregarEquipesNaoProdutivas({ equipes, ano: 2026, mes: 8 });
  assert.deepEqual(
    porDiaPorMotivo, {},
    '"CCR RioSP"/"Via Mineira" caem no default de classificarDiaEquipe -- são equipe em campo trabalhando, e contá-las aqui infla "em campo sem furo"'
  );
});

test('agregarEquipesNaoProdutivas continua contando o campoSemFuro CATALOGADO, e o noDefault do mesmo dia não soma', () => {
  const equipes = [
    // Mesmo dia, duas equipes: uma com motivo catalogado (conta), outra com
    // texto de trabalho não catalogado (não conta). Se o filtro de noDefault
    // fosse largo demais e derrubasse os dois, campoSemFuro viria 0 aqui.
    { id: '1', nome: 'A', servicos: 'SM', dias: [{ dia: 3, texto: 'Chuva' }] },
    { id: '2', nome: 'B', servicos: 'SP', dias: [{ dia: 3, texto: 'CCR RioSP' }] },
    // E 'fora' casa regex EXPLÍCITA -- nunca é noDefault, então segue contando.
    { id: '3', nome: 'C', servicos: 'SP', dias: [{ dia: 3, texto: 'Férias' }] },
  ];
  const { porDiaPorMotivo } = agregarEquipesNaoProdutivas({ equipes, ano: 2026, mes: 8 });
  const dia3 = Math.floor(Date.UTC(2026, 7, 3) / 86400000);
  assert.deepEqual(porDiaPorMotivo[dia3], { campoSemFuro: 1, fora: 1 });
});
