'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseAvancos, dataDeTexto, SERIAL_MIN, SERIAL_MAX } = require('../tools/semanal/parse-avancos.js');

// A grade que readXlsxSheet devolve é indexada pelo número de linha do Excel
// (grid[1] é o cabeçalho) e por índice de coluna 0-based -- ver
// parseSheetGrid em tools/comum/xlsx-cells.js. O CSV do Link 1 chega aqui
// pelo mesmo formato, com um unshift(null) em build-dashboard.js.
//
// REESCRITO EM 2026-08-10. O contrato de colunas encolheu junto com
// mapear-producao-total.js: saíram "Inicio Sondagem"/"Termino Sondagem" (que
// eram a MESMA data duplicada -- confirmado pelo dono do projeto) e
// "Conclusão"/"Cancelamento"/"Atualizado" (que o Link 1 não tem e eram
// fabricadas vazias). Entraram "Executado Dia" e "Deslocamento".
const CABECALHO = [];
CABECALHO[0] = 'Contrato';
CABECALHO[1] = 'Criação da OS';
CABECALHO[2] = 'Tipo';
CABECALHO[3] = 'Status';
CABECALHO[4] = 'Executado Dia';
CABECALHO[5] = 'Deslocamento';
CABECALHO[6] = 'Observações de Campo';
CABECALHO[7] = 'OS';
CABECALHO[8] = 'Sondador';

// 2026-03-10 e 2026-03-12 em serial Excel.
const MAR10 = 46091, MAR12 = 46093;

function grade(linhas) {
  const grid = [];
  grid[1] = CABECALHO;
  linhas.forEach((linha, i) => { grid[i + 2] = linha; });
  return grid;
}

function furo({
  sup = 'SUP-0001-24', tipo = 'SP', status = 'CONCLUIDO', criacao = MAR10,
  executado = MAR12, deslocamento = 'Não', observacoesCampo = '',
  os = '15534-24', sondador = 'Fulano de Tal',
} = {}) {
  const linha = [];
  linha[0] = sup;
  linha[1] = criacao;
  linha[2] = tipo;
  linha[3] = status;
  linha[4] = executado;
  linha[5] = deslocamento;
  linha[6] = observacoesCampo;
  linha[7] = os;
  linha[8] = sondador;
  return linha;
}

// --- leitura básica --------------------------------------------------------

test('lê um furo com as datas convertidas de serial Excel para Date UTC', () => {
  const { furos } = parseAvancos(grade([furo()]));
  assert.strictEqual(furos.length, 1);
  assert.strictEqual(furos[0].sup, 'SUP-0001-24');
  assert.strictEqual(furos[0].tipologia, 'SP');
  assert.strictEqual(furos[0].status, 'CONCLUIDO');
  assert.strictEqual(furos[0].criacaoOS.toISOString().slice(0, 10), '2026-03-10');
  assert.strictEqual(furos[0].executadoDia.toISOString().slice(0, 10), '2026-03-12');
});

// O extrato online entrega TODAS as datas como texto dd/MM/yyyy, nunca como
// serial (medido em 2026-08-10 sobre as 47.809 linhas de avancos-online.csv).
// O ramo de serial continua existindo pro caso de a fonte voltar a ser xlsx.
test('lê data em texto dd/MM/yyyy -- é o formato que o extrato online entrega', () => {
  const { furos } = parseAvancos(grade([furo({ criacao: '10/03/2026', executado: '12/03/2026' })]));
  assert.strictEqual(furos[0].criacaoOS.toISOString().slice(0, 10), '2026-03-10');
  assert.strictEqual(furos[0].executadoDia.toISOString().slice(0, 10), '2026-03-12');
});

test('não existe mais campo de início separado do de execução -- é uma data só', () => {
  const { furos } = parseAvancos(grade([furo()]));
  assert.strictEqual(furos[0].inicioSondagem, undefined);
  assert.strictEqual(furos[0].terminoSondagem, undefined);
});

test('Conclusão, Cancelamento e Atualizado saem null -- o Link 1 não tem essas datas', () => {
  const { furos } = parseAvancos(grade([furo()]));
  assert.strictEqual(furos[0].conclusao, null);
  assert.strictEqual(furos[0].cancelamento, null);
  assert.strictEqual(furos[0].atualizado, null);
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
  const { furos } = parseAvancos(grade([furo({ executado: SERIAL_MAX + 1 })]));
  assert.strictEqual(furos[0].executadoDia, null);
  assert.strictEqual(furos[0].criacaoOS.toISOString().slice(0, 10), '2026-03-10',
    'a data boa da mesma linha não pode ser afetada');
});

test('célula de data vazia vira null, não 1899-12-30', () => {
  const { furos } = parseAvancos(grade([furo({ executado: '' })]));
  assert.strictEqual(furos[0].executadoDia, null);
});

test('linha sem SUP e sem tipo é descartada e contada, não rotulada', () => {
  const vazia = [];
  const { furos, descartadas } = parseAvancos(grade([furo(), vazia, furo()]));
  assert.strictEqual(furos.length, 2);
  assert.strictEqual(descartadas, 1);
});

// --- deslocamento: coluna própria, não texto livre -------------------------
//
// Até 2026-08-10 isto era um regex sobre "Observações de Campo". Medido ao
// vivo no Link 1 em julho/2026 (2.053 linhas), os dois critérios divergiam em
// 119 linhas: a coluna acusa 82 deslocamentos, o regex acusava 185 -- 111
// furos legítimos eram derrubados e 8 deslocamentos reais passavam.

test('linha com Deslocamento = "Sim" é descartada, não vira furo', () => {
  const { furos, deslocamentos } = parseAvancos(grade([
    furo({ deslocamento: 'Sim' }),
    furo(),
  ]));
  assert.strictEqual(furos.length, 1);
  assert.strictEqual(deslocamentos, 1);
});

test('a detecção é insensível a caixa e a espaço em volta', () => {
  const { deslocamentos } = parseAvancos(grade([
    furo({ deslocamento: 'SIM' }),
    furo({ deslocamento: 'sim' }),
    furo({ deslocamento: ' Sim ' }),
  ]));
  assert.strictEqual(deslocamentos, 3);
});

test('Deslocamento = "Não", vazio ou ausente NÃO descarta a linha', () => {
  const { furos, deslocamentos } = parseAvancos(grade([
    furo({ deslocamento: 'Não' }),
    furo({ deslocamento: '' }),
  ]));
  assert.strictEqual(furos.length, 2);
  assert.strictEqual(deslocamentos, 0);
});

test('a palavra "deslocamento" nas Observações NÃO descarta mais a linha -- era o falso positivo', () => {
  // Este é o caso que derrubava 111 furos legítimos em julho/2026: a
  // observação MENCIONA deslocamento, mas a coluna diz que este furo não é um.
  const { furos, deslocamentos } = parseAvancos(grade([
    furo({ deslocamento: 'Não', observacoesCampo: 'FURO IMPENETRÁVEL - Foram realizados os deslocamentos A e B.' }),
  ]));
  assert.strictEqual(furos.length, 1, 'quem manda é a coluna, não o texto livre');
  assert.strictEqual(deslocamentos, 0);
});

test('deslocamento sem observação nenhuma é pego -- o regex antigo perdia estes', () => {
  const { furos, deslocamentos } = parseAvancos(grade([
    furo({ deslocamento: 'Sim', observacoesCampo: '' }),
  ]));
  assert.strictEqual(furos.length, 0);
  assert.strictEqual(deslocamentos, 1);
});

test('deslocamento é descartado mesmo com tipologia que lançaria erro -- a checagem vem antes de rotularTipologia', () => {
  const { furos, deslocamentos } = parseAvancos(grade([
    furo({ tipo: 'XYZ', deslocamento: 'Sim' }),
  ]));
  assert.strictEqual(furos.length, 0);
  assert.strictEqual(deslocamentos, 1);
});

// --- contrato de colunas ---------------------------------------------------

test('a coluna Deslocamento é achada pelo NOME, e sua ausência LANÇA', () => {
  const semDeslocamento = [];
  semDeslocamento[1] = CABECALHO.map(r => (r === 'Deslocamento' ? 'Outra coisa' : r));
  semDeslocamento[2] = furo();
  assert.throws(() => parseAvancos(semDeslocamento), /Deslocamento/);
});

test('a coluna Executado Dia é achada pelo NOME, e sua ausência LANÇA', () => {
  const semExecutado = [];
  semExecutado[1] = CABECALHO.map(r => (r === 'Executado Dia' ? 'Outra coisa' : r));
  semExecutado[2] = furo();
  assert.throws(() => parseAvancos(semExecutado), /Executado Dia/);
});

test('cabeçalho sem uma das colunas obrigatórias LANÇA dizendo QUAL falta', () => {
  const semStatus = [];
  semStatus[1] = CABECALHO.map(r => (r === 'Status' ? 'Outra coisa' : r));
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
  deslocado[1][7] = 'Executado Dia';
  deslocado[1][8] = 'Deslocamento';
  deslocado[1][9] = 'Observações de Campo';
  deslocado[1][10] = 'Sondador';
  deslocado[1][11] = 'OS';
  deslocado[2] = [];
  deslocado[2][3] = 'SUP-9999-26';
  deslocado[2][4] = MAR10;
  deslocado[2][5] = 'ST';
  deslocado[2][6] = 'PENDENTE';
  const { furos } = parseAvancos(deslocado);
  assert.strictEqual(furos[0].sup, 'SUP-9999-26');
  assert.strictEqual(furos[0].tipologia, 'ST');
});

test('tipologia desconhecida LANÇA citando o rótulo e a linha da planilha', () => {
  assert.throws(() => parseAvancos(grade([furo({ tipo: 'XYZ' })])), /XYZ/);
  assert.throws(() => parseAvancos(grade([furo({ tipo: 'XYZ' })])), /linha 2/);
});

test('conta os furos concluídos/executados sem data de execução -- eles nunca saem do estoque', () => {
  const { semDataTermino } = parseAvancos(grade([
    furo({ status: 'CONCLUIDO', executado: '' }),
    furo({ status: 'EXECUTADO', executado: '' }),
    furo({ status: 'PENDENTE', executado: '' }),
    furo({ status: 'CONCLUIDO' }),
  ]));
  assert.strictEqual(semDataTermino, 2, 'PENDENTE sem execução é o estado normal, não conta');
});

test('Sondador e OS continuam sendo lidos -- alimentam equipes e o join de pendentes', () => {
  const { furos } = parseAvancos(grade([furo({ sondador: 'Ana Silva', os: '17851-26' })]));
  assert.strictEqual(furos[0].sondador, 'Ana Silva');
  assert.strictEqual(furos[0].os, '17851-26');
});

// --- dataDeTexto ------------------------------------------------------------
//
// Continua exportada e em uso por mapear-demandas-lab.js (coluna "Data
// Programada", texto dd/MM/yyyy). Antes era exercitada indiretamente pela
// coluna Cancelamento, que saiu do contrato -- agora é testada direto.

test('dataDeTexto lê dd/MM/yyyy, nunca MM/dd/yyyy', () => {
  assert.strictEqual(dataDeTexto('27/02/2025').toISOString().slice(0, 10), '2025-02-27');
});

test('dataDeTexto aceita espaço em volta', () => {
  assert.strictEqual(dataDeTexto(' 05/11/2024 ').toISOString().slice(0, 10), '2024-11-05');
});

test('dataDeTexto devolve null para vazio, serial e lixo', () => {
  assert.strictEqual(dataDeTexto(''), null);
  assert.strictEqual(dataDeTexto(46091), null, 'serial Excel não é dd/MM/yyyy');
  assert.strictEqual(dataDeTexto('lixo'), null);
});

test('dataDeTexto NUNCA devolve Invalid Date -- ele compararia false contra qualquer data, em silêncio', () => {
  assert.strictEqual(dataDeTexto('31/31/2025'), null);
  assert.strictEqual(dataDeTexto('32/01/2025'), null);
});

test('SERIAL_MIN/SERIAL_MAX delimitam a janela de sanidade de 2023 a 2027', () => {
  assert.ok(SERIAL_MIN < SERIAL_MAX);
  const { furos } = parseAvancos(grade([furo({ executado: SERIAL_MIN - 1 })]));
  assert.strictEqual(furos[0].executadoDia, null);
});
