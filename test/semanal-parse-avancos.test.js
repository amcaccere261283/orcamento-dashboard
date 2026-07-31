'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseAvancos, SERIAL_MIN, SERIAL_MAX } = require('../tools/semanal/parse-avancos.js');

// A grade que readXlsxSheet devolve é indexada pelo número de linha do Excel
// (grid[1] é o cabeçalho) e por índice de coluna 0-based -- ver
// parseSheetGrid em tools/comum/xlsx-cells.js.
const CABECALHO = [];
CABECALHO[0] = 'Contrato';
CABECALHO[1] = 'Tomador';
CABECALHO[8] = 'Criação da OS';
CABECALHO[9] = 'Tipo';
CABECALHO[11] = 'Status';
CABECALHO[13] = 'Termino Sondagem';
CABECALHO[14] = 'Conclusão';
CABECALHO[15] = 'Cancelamento';
CABECALHO[16] = 'Atualizado';
CABECALHO[27] = 'Observações de Campo';

// 2026-03-10, 2026-03-12, 2026-04-02, 2026-04-05 em serial Excel.
const MAR10 = 46091, MAR12 = 46093, ABR02 = 46114, ABR05 = 46117;

function grade(linhas) {
  const grid = [];
  grid[1] = CABECALHO;
  linhas.forEach((linha, i) => { grid[i + 2] = linha; });
  return grid;
}

function furo({ sup = 'SUP-0001-24', tipo = 'SP', status = 'CONCLUIDO', criacao = MAR10, termino = MAR12, conclusao = ABR02, cancelamento = '', atualizado = ABR05, observacoesCampo = '' } = {}) {
  const linha = [];
  linha[0] = sup;
  linha[8] = criacao;
  linha[9] = tipo;
  linha[11] = status;
  linha[13] = termino;
  linha[14] = conclusao;
  linha[15] = cancelamento;
  linha[16] = atualizado;
  linha[27] = observacoesCampo;
  return linha;
}

test('lê um furo com as 4 datas convertidas de serial Excel para Date UTC', () => {
  const { furos } = parseAvancos(grade([furo()]));
  assert.strictEqual(furos.length, 1);
  assert.strictEqual(furos[0].sup, 'SUP-0001-24');
  assert.strictEqual(furos[0].tipologia, 'SP');
  assert.strictEqual(furos[0].status, 'CONCLUIDO');
  assert.strictEqual(furos[0].criacaoOS.toISOString().slice(0, 10), '2026-03-10');
  assert.strictEqual(furos[0].terminoSondagem.toISOString().slice(0, 10), '2026-03-12');
  assert.strictEqual(furos[0].conclusao.toISOString().slice(0, 10), '2026-04-02');
  assert.strictEqual(furos[0].atualizado.toISOString().slice(0, 10), '2026-04-05');
});

test('a tipologia sai JÁ rotulada pelo mapa, não crua', () => {
  const { furos } = parseAvancos(grade([furo({ tipo: 'CPTU' }), furo({ tipo: 'SM.F' })]));
  assert.strictEqual(furos[0].tipologia, 'CPTu');
  assert.strictEqual(furos[1].tipologia, 'SM / SM.F / SR');
});

test('status é normalizado para caixa alta sem espaço em volta', () => {
  const { furos } = parseAvancos(grade([furo({ status: ' concluido ' })]));
  assert.strictEqual(furos[0].status, 'CONCLUIDO');
});

test('data fora da janela de saneamento vira null em vez de virar 1901 ou 2078', () => {
  const { furos } = parseAvancos(grade([furo({ termino: SERIAL_MIN - 1, conclusao: SERIAL_MAX + 1 })]));
  assert.strictEqual(furos[0].terminoSondagem, null);
  assert.strictEqual(furos[0].conclusao, null);
  assert.strictEqual(furos[0].criacaoOS.toISOString().slice(0, 10), '2026-03-10',
    'a data boa da mesma linha não pode ser afetada');
});

test('célula de data vazia vira null, não 1899-12-30', () => {
  const { furos } = parseAvancos(grade([furo({ conclusao: '' })]));
  assert.strictEqual(furos[0].conclusao, null);
});

test('linha sem SUP e sem tipo é descartada e contada, não rotulada', () => {
  const vazia = [];
  const { furos, descartadas } = parseAvancos(grade([furo(), vazia, furo()]));
  assert.strictEqual(furos.length, 2);
  assert.strictEqual(descartadas, 1);
});

// --- deslocamento (achado de 2026-08-01) ---

test('linha com "deslocamento" em Observações de Campo é descartada, não vira furo', () => {
  const { furos, deslocamentos } = parseAvancos(grade([
    furo({ observacoesCampo: 'FURO IMPENETRÁVEL - Foram realizados os deslocamentos A e B.' }),
    furo(),
  ]));
  assert.strictEqual(furos.length, 1, 'só a linha sem "deslocamento" vira furo');
  assert.strictEqual(furos[0].sup, 'SUP-0001-24');
  assert.strictEqual(deslocamentos, 1);
});

test('detecção de "deslocamento" é insensível a maiúsculas/minúsculas', () => {
  const { deslocamentos } = parseAvancos(grade([
    furo({ observacoesCampo: 'DESLOCAMENTO (A)' }),
    furo({ observacoesCampo: 'Deslocamento A' }),
    furo({ observacoesCampo: 'deslocamento a' }),
  ]));
  assert.strictEqual(deslocamentos, 3);
});

test('deslocamento é descartado mesmo com tipologia que lançaria erro se rotulada -- checagem vem antes de rotularTipologia', () => {
  const { furos, deslocamentos } = parseAvancos(grade([
    furo({ tipo: 'XYZ', observacoesCampo: 'Deslocamento A' }),
  ]));
  assert.strictEqual(furos.length, 0);
  assert.strictEqual(deslocamentos, 1);
});

test('Observações de Campo sem a palavra "deslocamento" não descarta a linha', () => {
  const { furos, deslocamentos } = parseAvancos(grade([
    furo({ observacoesCampo: 'Furo executado sem intercorrências.' }),
  ]));
  assert.strictEqual(furos.length, 1);
  assert.strictEqual(deslocamentos, 0);
});

test('a coluna Observações de Campo é achada pelo NOME, como as outras', () => {
  const semObs = [];
  semObs[1] = CABECALHO.map(rotulo => (rotulo === 'Observações de Campo' ? 'Outra coisa' : rotulo));
  semObs[2] = furo();
  assert.throws(() => parseAvancos(semObs), /Observações de Campo/);
});

test('tipologia desconhecida LANÇA citando o rótulo e a linha da planilha', () => {
  assert.throws(() => parseAvancos(grade([furo({ tipo: 'XYZ' })])), /XYZ/);
  assert.throws(() => parseAvancos(grade([furo({ tipo: 'XYZ' })])), /linha 2/);
});

test('conta os furos concluídos/executados sem data de término -- eles nunca saem do estoque', () => {
  const { semDataTermino } = parseAvancos(grade([
    furo({ status: 'CONCLUIDO', termino: '' }),
    furo({ status: 'EXECUTADO', termino: '' }),
    furo({ status: 'PENDENTE', termino: '' }),
    furo({ status: 'CONCLUIDO' }),
  ]));
  assert.strictEqual(semDataTermino, 2, 'PENDENTE sem término é o estado normal, não conta');
});

test('cabeçalho sem uma das colunas obrigatórias LANÇA dizendo QUAL falta', () => {
  // Só a coluna Status é renomeada: com um cabeçalho curto, a mensagem citaria
  // a primeira ausente na ordem de checagem (Criação da OS) e o teste não
  // provaria nada sobre Status.
  const semStatus = [];
  semStatus[1] = CABECALHO.map(rotulo => (rotulo === 'Status' ? 'Outra coisa' : rotulo));
  semStatus[2] = furo();
  assert.throws(() => parseAvancos(semStatus), /Status/);
});

test('as colunas são achadas pelo NOME, não por posição fixa', () => {
  const deslocado = [];
  deslocado[1] = [];
  deslocado[1][3] = 'Contrato';
  deslocado[1][4] = 'Criação da OS';
  deslocado[1][5] = 'Tipo';
  deslocado[1][6] = 'Status';
  deslocado[1][7] = 'Termino Sondagem';
  deslocado[1][8] = 'Conclusão';
  deslocado[1][9] = 'Cancelamento';
  deslocado[1][10] = 'Atualizado';
  deslocado[1][11] = 'Observações de Campo';
  deslocado[2] = [];
  deslocado[2][3] = 'SUP-9999-26';
  deslocado[2][4] = MAR10;
  deslocado[2][5] = 'ST';
  deslocado[2][6] = 'PENDENTE';
  const { furos } = parseAvancos(deslocado);
  assert.strictEqual(furos[0].sup, 'SUP-9999-26');
  assert.strictEqual(furos[0].tipologia, 'ST');
});

test('cancelamento é lido de texto dd/MM/yyyy, não de serial Excel', () => {
  const { furos } = parseAvancos(grade([furo({ status: 'CANCELADO', cancelamento: '27/02/2025' })]));
  assert.strictEqual(furos[0].cancelamento.toISOString().slice(0, 10), '2025-02-27',
    'dd/MM/yyyy: 27 é o dia e 02 é o mês, nunca o contrário');
});

test('cancelamento vazio vira null', () => {
  const { furos } = parseAvancos(grade([furo({ cancelamento: '' })]));
  assert.strictEqual(furos[0].cancelamento, null);
});

test('cancelamento em serial Excel NÃO é aceito -- a coluna é texto na planilha real', () => {
  const { furos, cancelamentoIlegivel } = parseAvancos(grade([furo({ status: 'CANCELADO', cancelamento: 46091 })]));
  assert.strictEqual(furos[0].cancelamento, null);
  assert.strictEqual(cancelamentoIlegivel, 1);
});

test('cancelamento ilegível NUNCA vira Invalid Date -- ele compararia false contra qualquer data, em silêncio', () => {
  const { furos, cancelamentoIlegivel } = parseAvancos(grade([furo({ status: 'CANCELADO', cancelamento: '31/31/2025' })]));
  assert.strictEqual(furos[0].cancelamento, null);
  assert.strictEqual(cancelamentoIlegivel, 1);
});

test('cancelamentoIlegivel só conta linha CANCELADO -- texto perdido em linha não cancelada não é anomalia', () => {
  const { cancelamentoIlegivel } = parseAvancos(grade([
    furo({ status: 'CONCLUIDO', cancelamento: 'lixo' }),
    furo({ status: 'CANCELADO', cancelamento: 'lixo' }),
  ]));
  assert.strictEqual(cancelamentoIlegivel, 1);
});

test('data de cancelamento com espaço em volta ainda parseia', () => {
  const { furos } = parseAvancos(grade([furo({ status: 'CANCELADO', cancelamento: ' 05/11/2024 ' })]));
  assert.strictEqual(furos[0].cancelamento.toISOString().slice(0, 10), '2024-11-05');
});

test('a coluna Cancelamento é achada pelo NOME, como as outras', () => {
  const semCancelamento = [];
  semCancelamento[1] = CABECALHO.map(rotulo => (rotulo === 'Cancelamento' ? 'Outra coisa' : rotulo));
  semCancelamento[2] = furo();
  assert.throws(() => parseAvancos(semCancelamento), /Cancelamento/);
});
