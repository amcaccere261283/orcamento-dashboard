'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseLab, locateColunasLab, SERIAL_MIN, SERIAL_MAX } = require('../tools/semanal/parse-lab.js');

// A grade que readXlsxSheet devolve é indexada pelo número de linha do Excel
// (grid[1] é o cabeçalho) e por índice de coluna 0-based.
const CABECALHO = [];
CABECALHO[0] = 'ID Contrato';
CABECALHO[3] = 'Ensaiado Dia';
CABECALHO[6] = 'Tipo de Ensaio';
CABECALHO[9] = 'Data Programada';

// 2026-03-10 em serial Excel.
const MAR10 = 46091;

function grade(linhas) {
  const grid = [];
  grid[1] = CABECALHO;
  linhas.forEach((linha, i) => { grid[i + 2] = linha; });
  return grid;
}

function ensaio({ sup = 'SUP-0001-24', concluido = MAR10, criacao = MAR10, tipo = 'LL' } = {}) {
  const linha = [];
  linha[0] = sup;
  linha[3] = concluido;
  linha[6] = tipo;
  linha[9] = criacao;
  return linha;
}

test('lê um ensaio com a data convertida de serial Excel para Date UTC e a tipologia já classificada', () => {
  const { ensaios } = parseLab(grade([ensaio()]));
  assert.strictEqual(ensaios.length, 1);
  assert.strictEqual(ensaios[0].sup, 'SUP-0001-24');
  assert.strictEqual(ensaios[0].tipologia, 'LAB.C', 'LL é Convencional');
  assert.strictEqual(ensaios[0].concluido.toISOString().slice(0, 10), '2026-03-10');
});

test('Tipo de Ensaio Especial sai classificado como LAB.E', () => {
  const { ensaios } = parseLab(grade([ensaio({ tipo: 'TRI3.CU' })]));
  assert.strictEqual(ensaios[0].tipologia, 'LAB.E');
});

test('data fora da janela de saneamento vira null em vez de virar 1901 ou 2078', () => {
  const { ensaios } = parseLab(grade([ensaio({ concluido: SERIAL_MIN - 1 })]));
  assert.strictEqual(ensaios[0].concluido, null);
});

test('célula de data vazia vira null, não 1899-12-30', () => {
  const { ensaios } = parseLab(grade([ensaio({ concluido: '' })]));
  assert.strictEqual(ensaios[0].concluido, null);
});

test('linha com SUP = "TESTE" é descartada e contada -- lixo de planilha, não um contrato real', () => {
  const { ensaios, descartadas } = parseLab(grade([ensaio(), ensaio({ sup: 'TESTE' }), ensaio({ sup: 'teste' }), ensaio()]));
  assert.strictEqual(ensaios.length, 2);
  assert.strictEqual(descartadas, 2, '"TESTE" descarta em qualquer caixa');
});

test('SUP fora do padrão SUP-XXXX-YY (ex.: SUP-EPR_Ametista) é MANTIDO -- contrato real fora do padrão comum, não lixo', () => {
  const { ensaios, descartadas } = parseLab(grade([ensaio({ sup: 'SUP-EPR_Ametista' })]));
  assert.strictEqual(ensaios.length, 1);
  assert.strictEqual(ensaios[0].sup, 'SUP-EPR_Ametista');
  assert.strictEqual(descartadas, 0);
});

test('linha sem SUP e sem tipo é descartada e contada, não classificada', () => {
  const vazia = [];
  const { ensaios, descartadas } = parseLab(grade([ensaio(), vazia, ensaio()]));
  assert.strictEqual(ensaios.length, 2);
  assert.strictEqual(descartadas, 1);
});

test('Tipo de Ensaio desconhecido LANÇA citando o rótulo e a linha da planilha', () => {
  assert.throws(() => parseLab(grade([ensaio({ tipo: 'XYZ.NOVO' })])), /XYZ\.NOVO/);
  assert.throws(() => parseLab(grade([ensaio({ tipo: 'XYZ.NOVO' })])), /linha 2/);
});

test('cabeçalho sem uma das colunas obrigatórias LANÇA dizendo QUAL falta', () => {
  const semTipo = [];
  semTipo[1] = CABECALHO.map(rotulo => (rotulo === 'Tipo de Ensaio' ? 'Outra coisa' : rotulo));
  semTipo[2] = ensaio();
  assert.throws(() => parseLab(semTipo), /Tipo de Ensaio/);
});

test('as colunas são achadas pelo NOME, não por posição fixa', () => {
  const deslocado = [];
  deslocado[1] = [];
  deslocado[1][2] = 'ID Contrato';
  deslocado[1][5] = 'Ensaiado Dia';
  deslocado[1][9] = 'Tipo de Ensaio';
  deslocado[1][11] = 'Data Programada';
  deslocado[2] = [];
  deslocado[2][2] = 'SUP-9999-26';
  deslocado[2][5] = MAR10;
  deslocado[2][9] = 'LL';
  deslocado[2][11] = MAR10;
  const { ensaios } = parseLab(deslocado);
  assert.strictEqual(ensaios[0].sup, 'SUP-9999-26');
  assert.strictEqual(ensaios[0].tipologia, 'LAB.C');
});

test('locateColunasLab acha as 4 colunas pelo nome', () => {
  const cols = locateColunasLab(CABECALHO);
  assert.deepStrictEqual(cols, { sup: 0, concluidoDia: 3, tipoEnsaio: 6, criacaoOS: 9 });
});

test('ensaios ganham "criacao" a partir de Data Programada', () => {
  const grid = [
    null,
    ['Data Programada', 'ID Contrato', 'Ensaiado Dia', 'Tipo de Ensaio'],
    ['07/05/2026', 'SUP-6806-23', '03/08/2026', 'M.ESP'],
  ];
  const { ensaios } = parseLab(grid);
  assert.strictEqual(ensaios[0].criacao.getUTCFullYear(), 2026);
  assert.strictEqual(ensaios[0].criacao.getUTCMonth(), 4); // maio, 0-indexado
  assert.strictEqual(ensaios[0].criacao.getUTCDate(), 7);
});

test('Data Programada ausente no cabeçalho lança (coluna passou a ser obrigatória)', () => {
  const grid = [
    null,
    ['ID Contrato', 'Ensaiado Dia', 'Tipo de Ensaio'],
    ['SUP-6806-23', '03/08/2026', 'M.ESP'],
  ];
  assert.throws(() => parseLab(grid), /Data Programada/);
});

// --- projeção de colunas na publicação (2026-08-10) ------------------------
//
// O extrato traz 11 colunas e só 5 têm consumidor. Com a cobertura indo de 1
// para 20 meses, o CSV publicado saltou de 516 KB para 33 MB -- e ele é
// baixado inteiro pelo botão "Atualizar dados" a cada clique. Projetar corta
// para 12 MB sem perder nada que a página leia.
const { projetarColunas, COLUNAS_PUBLICADAS } = require('../tools/semanal/atualizar-lab-online.js');

test('projetarColunas mantém exatamente as colunas publicadas, na ordem', () => {
  const cab = ['Data Programada', 'Ensaiado Dia', 'Tomadora', 'ID Contrato', 'Usuário',
    'Tipo de Amostra', 'Tipo de Ensaio', 'Cod. Amostra', 'Identificação', 'OS', 'Ações'];
  const linha = ['01/03/2026', '05/03/2026', 'CCR MSVia', 'SUP-1', 'Fulano',
    'PREP', 'LL', 'AM-01', 'id', '123-26', ''];
  const r = projetarColunas(cab, [linha]);
  assert.deepStrictEqual(r.cabecalho, COLUNAS_PUBLICADAS);
  assert.deepStrictEqual(r.linhas[0], ['01/03/2026', '05/03/2026', 'CCR MSVia', 'SUP-1', 'LL']);
});

test('o cabeçalho projetado ainda satisfaz locateColunasLab -- é o contrato que parseLab exige', () => {
  assert.doesNotThrow(() => locateColunasLab(COLUNAS_PUBLICADAS));
});

test('projetarColunas LANÇA se a fonte deixar de trazer uma coluna publicada', () => {
  const cab = ['Data Programada', 'Ensaiado Dia', 'Tomadora', 'ID Contrato'];
  assert.throws(() => projetarColunas(cab, [[]]), /Tipo de Ensaio/);
});

test('projetarColunas tolera espaçamento duplo no cabeçalho da fonte', () => {
  const cab = ['Data  Programada', 'Ensaiado Dia', 'Tomadora', 'ID Contrato', 'Tipo de Ensaio'];
  const r = projetarColunas(cab, [['a', 'b', 'c', 'd', 'e']]);
  assert.deepStrictEqual(r.linhas[0], ['a', 'b', 'c', 'd', 'e']);
});
