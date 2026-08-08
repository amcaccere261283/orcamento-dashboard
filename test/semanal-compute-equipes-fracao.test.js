'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { agregarEquipesFracao } = require('../tools/semanal/compute-equipes-fracao.js');
const { diaEpoch } = require('../tools/semanal/compute-semanal.js');

const ANO = 2026;
const MES = 8;
const identidade = (sup) => sup;

// nome: o nome da equipe/líder no roster (Link 6, coluna "Equipe") -- é
// contra ESTE nome que casarSondador tenta achar o "Líder" do Link 7.
function equipe(nome, dias) {
  // dias: { 1: 'texto do dia 1', 2: 'texto do dia 2', ... }
  return {
    id: nome, nome, servicos: '',
    dias: Object.entries(dias).map(([dia, texto]) => ({ dia: Number(dia), texto })),
  };
}

function linhaLink7(lider, sup, tipo, dataStr) {
  return { lider, sup, tipo, diaEpoch: diaEpoch(new Date(dataStr + 'T00:00:00Z')) };
}

test('sondador que produziu 1 SUP+Tipo no dia conta 1 inteiro nessa combinação', () => {
  const equipes = [equipe('José Amaral', { 1: 'RioSP (17851-26)' })];
  const link7 = [linhaLink7('José Amaral', 'SUP-A', 'SP', '2026-08-01')];
  const { porDia } = agregarEquipesFracao({ equipes, linhasLink7: link7, ano: ANO, mes: MES, resolverSup: identidade });
  assert.strictEqual(porDia['SUP-A||SP'][diaEpoch(new Date('2026-08-01T00:00:00Z'))], 1);
});

test('sondador que produziu em 2 combinações SUP+Tipo no mesmo dia fraciona 0,5 pra cada', () => {
  const equipes = [equipe('José Amaral', { 1: 'trabalhando' })];
  const link7 = [
    linhaLink7('José Amaral', 'SUP-A', 'SP', '2026-08-01'),
    linhaLink7('José Amaral', 'SUP-A', 'SP', '2026-08-01'), // 2ª sondagem, MESMA combinação -- não conta 2x
    linhaLink7('José Amaral', 'SUP-B', 'PI', '2026-08-01'),
  ];
  const { porDia } = agregarEquipesFracao({ equipes, linhasLink7: link7, ano: ANO, mes: MES, resolverSup: identidade });
  const dia = diaEpoch(new Date('2026-08-01T00:00:00Z'));
  assert.strictEqual(porDia['SUP-A||SP'][dia], 0.5);
  assert.strictEqual(porDia['SUP-B||PI'][dia], 0.5);
});

test('sondador ativo no dia mas ausente do Link 7 desse dia vai pro último SUP+Tipo dos últimos 45 dias', () => {
  const equipes = [equipe('José Amaral', { 5: 'trabalhando' })]; // dia 5, sem OS na célula
  const link7 = [linhaLink7('José Amaral', 'SUP-A', 'SP', '2026-07-20')]; // 16 dias antes
  const { porDia } = agregarEquipesFracao({ equipes, linhasLink7: link7, ano: ANO, mes: MES, resolverSup: identidade });
  const dia5 = diaEpoch(new Date('2026-08-05T00:00:00Z'));
  assert.strictEqual(porDia['SUP-A||SP'][dia5], 1);
});

test('sondador sem NENHUMA produção nos últimos 45 dias fica de fora inteiramente', () => {
  const equipes = [equipe('José Amaral', { 5: 'trabalhando' })];
  const { porDia, semLink7 } = agregarEquipesFracao({ equipes, linhasLink7: [], ano: ANO, mes: MES, resolverSup: identidade });
  assert.deepStrictEqual(porDia, {});
  assert.strictEqual(semLink7, 1);
});

test('produção com mais de 45 dias de defasagem NÃO conta como fallback -- fora da janela', () => {
  const equipes = [equipe('José Amaral', { 5: 'trabalhando' })];
  const link7 = [linhaLink7('José Amaral', 'SUP-A', 'SP', '2026-06-01')]; // > 45 dias antes de 2026-08-05
  const { porDia, semLink7 } = agregarEquipesFracao({ equipes, linhasLink7: link7, ano: ANO, mes: MES, resolverSup: identidade });
  assert.deepStrictEqual(porDia, {});
  assert.strictEqual(semLink7, 1);
});

test('dia de EXCLUSÃO (férias/baixada) não conta nem produtiva nem fallback, mesmo com Link 7 disponível', () => {
  const equipes = [equipe('José Amaral', { 10: 'Férias' })];
  const link7 = [linhaLink7('José Amaral', 'SUP-A', 'SP', '2026-08-10'), linhaLink7('José Amaral', 'SUP-A', 'SP', '2026-07-15')];
  const { porDia } = agregarEquipesFracao({ equipes, linhasLink7: link7, ano: ANO, mes: MES, resolverSup: identidade });
  assert.deepStrictEqual(porDia, {}, 'férias exclui o dia inteiro, mesmo tendo produzido nesse dia por engano de fonte');
});

test('resolverSup redireciona SUP desconhecido pra Diversos, mesmo tratamento de furos/ensaios', () => {
  const equipes = [equipe('José Amaral', { 1: 'trabalhando' })];
  const link7 = [linhaLink7('José Amaral', 'SUP-DESCONHECIDO', 'SP', '2026-08-01')];
  const resolverSup = (sup, tipo) => (sup === 'SUP-DESCONHECIDO' ? 'Diversos' : sup);
  const { porDia } = agregarEquipesFracao({ equipes, linhasLink7: link7, ano: ANO, mes: MES, resolverSup });
  const dia = diaEpoch(new Date('2026-08-01T00:00:00Z'));
  assert.strictEqual(porDia['Diversos||SP'][dia], 1);
});

test('duas equipes diferentes no mesmo SUP+Tipo+dia SOMAM', () => {
  const equipes = [equipe('José Amaral', { 1: 'trabalhando' }), equipe('Paulo Lima', { 1: 'trabalhando' })];
  const link7 = [linhaLink7('José Amaral', 'SUP-A', 'SP', '2026-08-01'), linhaLink7('Paulo Lima', 'SUP-A', 'SP', '2026-08-01')];
  const { porDia } = agregarEquipesFracao({ equipes, linhasLink7: link7, ano: ANO, mes: MES, resolverSup: identidade });
  const dia = diaEpoch(new Date('2026-08-01T00:00:00Z'));
  assert.strictEqual(porDia['SUP-A||SP'][dia], 2);
});

test('texto de dia desconhecido cai no default (campoSemFuro) mas aparece em textosNoDefault, sem mudar a contagem', () => {
  const equipes = [equipe('José Amaral', { 1: 'Trabalhando em local novo XYZ' })];
  const link7 = [linhaLink7('José Amaral', 'SUP-A', 'SP', '2026-08-01')];
  const { porDia, textosNoDefault } = agregarEquipesFracao({ equipes, linhasLink7: link7, ano: ANO, mes: MES, resolverSup: identidade });
  const dia = diaEpoch(new Date('2026-08-01T00:00:00Z'));
  assert.strictEqual(porDia['SUP-A||SP'][dia], 1, 'dia ainda conta como ativo/produtivo normalmente');
  assert.deepStrictEqual(textosNoDefault, { 'Trabalhando em local novo XYZ': 1 });
});

// Casamento por NOME, não por ID -- achado rodando o pipeline de verdade em
// 2026-08-08: o "ID" do roster (Link 6) é ID de EQUIPE, e "ID Sondador" do
// Link 7 é ID de PESSOA -- sistemas diferentes, sem interseção real medida
// ao vivo (1 em 105). Ajuste temporário pedido pelo dono do projeto: casar
// pelo nome da equipe (líder) contra o "Líder" de cada linha do Link 7,
// reaproveitando casarSondador (compute-equipes-ativas.js).
test('nome da equipe casa por TOKEN com o Líder do Link 7 (nome curto vs nome completo), não precisa ser idêntico', () => {
  const equipes = [equipe('Paulo Lima', { 1: 'trabalhando' })]; // nome curto, como a planilha de equipes escreve
  const link7 = [linhaLink7('Paulo Sérgio Lima', 'SUP-A', 'SP', '2026-08-01')]; // nome completo, como o Líder do Link 7
  const { porDia } = agregarEquipesFracao({ equipes, linhasLink7: link7, ano: ANO, mes: MES, resolverSup: identidade });
  const dia = diaEpoch(new Date('2026-08-01T00:00:00Z'));
  assert.strictEqual(porDia['SUP-A||SP'][dia], 1);
});

test('nome da equipe sem casamento nenhum no Link 7 conta em semNomeCasado, e o equipe-dia cai no mesmo caminho de "sem produção"', () => {
  const equipes = [equipe('Ninguém Reconhecido', { 1: 'trabalhando' })];
  const link7 = [linhaLink7('José Amaral', 'SUP-A', 'SP', '2026-08-01')];
  const { porDia, semLink7, semNomeCasado } = agregarEquipesFracao({ equipes, linhasLink7: link7, ano: ANO, mes: MES, resolverSup: identidade });
  assert.deepStrictEqual(porDia, {});
  assert.strictEqual(semLink7, 1);
  assert.strictEqual(semNomeCasado, 1);
});

test('nome da equipe AMBÍGUO (casa com mais de um Líder do Link 7) também conta em semNomeCasado, sem inventar um casamento', () => {
  const equipes = [equipe('Carlos Junior', { 1: 'trabalhando' })];
  const link7 = [
    linhaLink7('Carlos Junior Alves', 'SUP-A', 'SP', '2026-08-01'),
    linhaLink7('Carlos Junior Souza', 'SUP-B', 'PI', '2026-08-01'),
  ];
  const { semNomeCasado } = agregarEquipesFracao({ equipes, linhasLink7: link7, ano: ANO, mes: MES, resolverSup: identidade });
  assert.strictEqual(semNomeCasado, 1);
});
