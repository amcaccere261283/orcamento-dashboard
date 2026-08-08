'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { mapearProducaoTotal, COLUNAS_LINK1 } = require('../tools/semanal/mapear-producao-total.js');
const { locateColunasAvancos } = require('../tools/semanal/parse-avancos.js');

function linhaLink1(over = {}) {
  return Object.assign({
    Tomador: 'EPR Litoral Pioneiro',
    'ID Contrato': 'SUP-7722-24',
    Sondador: 'Evamar Fernandes de Macedo',
    Tipo: 'SP',
    OS: '16744-25',
    'Criação da OS': '18/09/2025',
    Identificação: 'ELP-SP-PR092-A-5-1067',
    Obra: 'Projetos do Ano 05',
    'Observações de campo': '',
    'Executado Dia': '01/08/2026',
    'Tags de Serviço': 'SP.Instal (1)',
    'Status Atual': 'EXECUTADO',
    'Data Status Atual': '01/08/2026',
  }, over);
}

test('o cabeçalho de saída é exatamente o que parseAvancos exige, sem lançar', () => {
  const { header } = mapearProducaoTotal([linhaLink1()]);
  assert.doesNotThrow(() => locateColunasAvancos(header));
});

test('Contrato, Tipo, OS, Sondador e Status vêm direto das colunas homônimas do Link 1', () => {
  const { header, rows } = mapearProducaoTotal([linhaLink1()]);
  const cols = locateColunasAvancos(header);
  assert.strictEqual(rows[0][cols.sup], 'SUP-7722-24');
  assert.strictEqual(rows[0][cols.tipo], 'SP');
  assert.strictEqual(rows[0][cols.os], '16744-25');
  assert.strictEqual(rows[0][cols.sondador], 'Evamar Fernandes de Macedo');
  assert.strictEqual(rows[0][cols.status], 'EXECUTADO');
});

test('Executado Dia alimenta Termino Sondagem E Inicio Sondagem -- a saída do estoque de Demandas usa Executado Dia, decidido com o usuário', () => {
  const { header, rows } = mapearProducaoTotal([linhaLink1()]);
  const cols = locateColunasAvancos(header);
  assert.strictEqual(rows[0][cols.terminoSondagem], '01/08/2026');
  assert.strictEqual(rows[0][cols.inicioSondagem], '01/08/2026');
});

test('Criação da OS alimenta Criação da OS sem transformação', () => {
  const { header, rows } = mapearProducaoTotal([linhaLink1()]);
  const cols = locateColunasAvancos(header);
  assert.strictEqual(rows[0][cols.criacaoOS], '18/09/2025');
});

test('Cancelamento e Conclusão ficam vazios -- Link 1 não tem essas datas separadas (limitação conhecida)', () => {
  const { header, rows } = mapearProducaoTotal([linhaLink1()]);
  const cols = locateColunasAvancos(header);
  assert.strictEqual(rows[0][cols.cancelamento], '');
  assert.strictEqual(rows[0][cols.conclusao], '');
});

test('Observações de campo do Link 1 vira Observações de Campo -- deslocamento continua filtrável em parse-avancos.js', () => {
  const { header, rows } = mapearProducaoTotal([linhaLink1({ 'Observações de campo': 'Deslocamento A' })]);
  const cols = locateColunasAvancos(header);
  assert.strictEqual(rows[0][cols.observacoesCampo], 'Deslocamento A');
});

test('linha sem ID Contrato ainda gera uma linha (parseAvancos decide o que descartar, este mapeador não filtra)', () => {
  const { rows } = mapearProducaoTotal([linhaLink1({ 'ID Contrato': '' })]);
  assert.strictEqual(rows.length, 1);
});

test('múltiplas linhas mantêm a ordem', () => {
  const { rows } = mapearProducaoTotal([linhaLink1({ OS: '1' }), linhaLink1({ OS: '2' })]);
  const cols = locateColunasAvancos(mapearProducaoTotal([linhaLink1()]).header);
  assert.strictEqual(rows[0][cols.os], '1');
  assert.strictEqual(rows[1][cols.os], '2');
});
