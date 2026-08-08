'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { agregarEquipesFracao } = require('../tools/semanal/compute-equipes-fracao.js');
const { diaEpoch } = require('../tools/semanal/compute-semanal.js');

const ANO = 2026;
const MES = 8;
const identidade = (sup) => sup;

function equipe(id, dias) {
  // dias: { 1: 'texto do dia 1', 2: 'texto do dia 2', ... }
  return {
    id, nome: `Equipe ${id}`, servicos: '',
    dias: Object.entries(dias).map(([dia, texto]) => ({ dia: Number(dia), texto })),
  };
}

function linhaLink7(idSondador, sup, tipo, dataStr) {
  return { idSondador, sup, tipo, diaEpoch: diaEpoch(new Date(dataStr + 'T00:00:00Z')) };
}

test('sondador que produziu 1 SUP+Tipo no dia conta 1 inteiro nessa combinação', () => {
  const equipes = [equipe('4', { 1: 'RioSP (17851-26)' })];
  const link7 = [linhaLink7('4', 'SUP-A', 'SP', '2026-08-01')];
  const { porDia } = agregarEquipesFracao({ equipes, linhasLink7: link7, ano: ANO, mes: MES, resolverSup: identidade });
  assert.strictEqual(porDia['SUP-A||SP'][diaEpoch(new Date('2026-08-01T00:00:00Z'))], 1);
});

test('sondador que produziu em 2 combinações SUP+Tipo no mesmo dia fraciona 0,5 pra cada', () => {
  const equipes = [equipe('4', { 1: 'trabalhando' })];
  const link7 = [
    linhaLink7('4', 'SUP-A', 'SP', '2026-08-01'),
    linhaLink7('4', 'SUP-A', 'SP', '2026-08-01'), // 2ª sondagem, MESMA combinação -- não conta 2x
    linhaLink7('4', 'SUP-B', 'PI', '2026-08-01'),
  ];
  const { porDia } = agregarEquipesFracao({ equipes, linhasLink7: link7, ano: ANO, mes: MES, resolverSup: identidade });
  const dia = diaEpoch(new Date('2026-08-01T00:00:00Z'));
  assert.strictEqual(porDia['SUP-A||SP'][dia], 0.5);
  assert.strictEqual(porDia['SUP-B||PI'][dia], 0.5);
});

test('sondador ativo no dia mas ausente do Link 7 desse dia vai pro último SUP+Tipo dos últimos 45 dias', () => {
  const equipes = [equipe('4', { 5: 'trabalhando' })]; // dia 5, sem OS na célula
  const link7 = [linhaLink7('4', 'SUP-A', 'SP', '2026-07-20')]; // 16 dias antes
  const { porDia } = agregarEquipesFracao({ equipes, linhasLink7: link7, ano: ANO, mes: MES, resolverSup: identidade });
  const dia5 = diaEpoch(new Date('2026-08-05T00:00:00Z'));
  assert.strictEqual(porDia['SUP-A||SP'][dia5], 1);
});

test('sondador sem NENHUMA produção nos últimos 45 dias fica de fora inteiramente', () => {
  const equipes = [equipe('4', { 5: 'trabalhando' })];
  const { porDia, semLink7 } = agregarEquipesFracao({ equipes, linhasLink7: [], ano: ANO, mes: MES, resolverSup: identidade });
  assert.deepStrictEqual(porDia, {});
  assert.strictEqual(semLink7, 1);
});

test('produção com mais de 45 dias de defasagem NÃO conta como fallback -- fora da janela', () => {
  const equipes = [equipe('4', { 5: 'trabalhando' })];
  const link7 = [linhaLink7('4', 'SUP-A', 'SP', '2026-06-01')]; // > 45 dias antes de 2026-08-05
  const { porDia, semLink7 } = agregarEquipesFracao({ equipes, linhasLink7: link7, ano: ANO, mes: MES, resolverSup: identidade });
  assert.deepStrictEqual(porDia, {});
  assert.strictEqual(semLink7, 1);
});

test('dia de EXCLUSÃO (férias/baixada) não conta nem produtiva nem fallback, mesmo com Link 7 disponível', () => {
  const equipes = [equipe('4', { 10: 'Férias' })];
  const link7 = [linhaLink7('4', 'SUP-A', 'SP', '2026-08-10'), linhaLink7('4', 'SUP-A', 'SP', '2026-07-15')];
  const { porDia } = agregarEquipesFracao({ equipes, linhasLink7: link7, ano: ANO, mes: MES, resolverSup: identidade });
  assert.deepStrictEqual(porDia, {}, 'férias exclui o dia inteiro, mesmo tendo produzido nesse dia por engano de fonte');
});

test('resolverSup redireciona SUP desconhecido pra Diversos, mesmo tratamento de furos/ensaios', () => {
  const equipes = [equipe('4', { 1: 'trabalhando' })];
  const link7 = [linhaLink7('4', 'SUP-DESCONHECIDO', 'SP', '2026-08-01')];
  const resolverSup = (sup, tipo) => (sup === 'SUP-DESCONHECIDO' ? 'Diversos' : sup);
  const { porDia } = agregarEquipesFracao({ equipes, linhasLink7: link7, ano: ANO, mes: MES, resolverSup });
  const dia = diaEpoch(new Date('2026-08-01T00:00:00Z'));
  assert.strictEqual(porDia['Diversos||SP'][dia], 1);
});

test('duas equipes diferentes no mesmo SUP+Tipo+dia SOMAM', () => {
  const equipes = [equipe('4', { 1: 'trabalhando' }), equipe('9', { 1: 'trabalhando' })];
  const link7 = [linhaLink7('4', 'SUP-A', 'SP', '2026-08-01'), linhaLink7('9', 'SUP-A', 'SP', '2026-08-01')];
  const { porDia } = agregarEquipesFracao({ equipes, linhasLink7: link7, ano: ANO, mes: MES, resolverSup: identidade });
  const dia = diaEpoch(new Date('2026-08-01T00:00:00Z'));
  assert.strictEqual(porDia['SUP-A||SP'][dia], 2);
});
