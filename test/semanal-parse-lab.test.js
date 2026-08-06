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

// 2026-03-10 em serial Excel.
const MAR10 = 46091;

function grade(linhas) {
  const grid = [];
  grid[1] = CABECALHO;
  linhas.forEach((linha, i) => { grid[i + 2] = linha; });
  return grid;
}

function ensaio({ sup = 'SUP-0001-24', concluido = MAR10, tipo = 'LL' } = {}) {
  const linha = [];
  linha[0] = sup;
  linha[3] = concluido;
  linha[6] = tipo;
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
  deslocado[2] = [];
  deslocado[2][2] = 'SUP-9999-26';
  deslocado[2][5] = MAR10;
  deslocado[2][9] = 'LL';
  const { ensaios } = parseLab(deslocado);
  assert.strictEqual(ensaios[0].sup, 'SUP-9999-26');
  assert.strictEqual(ensaios[0].tipologia, 'LAB.C');
});

test('locateColunasLab acha as 3 colunas pelo nome', () => {
  const cols = locateColunasLab(CABECALHO);
  assert.deepStrictEqual(cols, { sup: 0, concluidoDia: 3, tipoEnsaio: 6 });
});
