'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { juntarPendentesSondagem } = require('../tools/semanal/mapear-demandas-sondagem.js');
const { locateColunasAvancos } = require('../tools/semanal/parse-avancos.js');

function linhaLink2(over = {}) {
  return Object.assign({
    'Ordem de Serviço (OS)': '17656-26',
    Identificação: '0090 PI-009',
    Tipo: 'PI',
    Status: 'PENDENTE',
  }, over);
}

function linhaLink3(over = {}) {
  return Object.assign({
    'Ordens de Serviço (OS)': '17656-26',
    'OS desde': '11/06/2026',
    Contrato: 'SUP-7133-24',
    Tomador: 'Via Araucária S.A',
    Tipo: 'PI',
  }, over);
}

test('furo pendente do Link 2 recebe Contrato e Criação da OS do Link 3 pela mesma OS', () => {
  const { header, rows } = juntarPendentesSondagem([linhaLink2()], [linhaLink3()]);
  const cols = locateColunasAvancos(header);
  assert.strictEqual(rows[0][cols.sup], 'SUP-7133-24');
  assert.strictEqual(rows[0][cols.criacaoOS], '11/06/2026');
  assert.strictEqual(rows[0][cols.tipo], 'PI');
  assert.strictEqual(rows[0][cols.status], 'PENDENTE');
  assert.strictEqual(rows[0][cols.os], '17656-26');
});

test('Inicio Sondagem, Termino Sondagem, Cancelamento, Sondador ficam vazios -- furo ainda não aconteceu', () => {
  const { header, rows } = juntarPendentesSondagem([linhaLink2()], [linhaLink3()]);
  const cols = locateColunasAvancos(header);
  assert.strictEqual(rows[0][cols.inicioSondagem], '');
  assert.strictEqual(rows[0][cols.terminoSondagem], '');
  assert.strictEqual(rows[0][cols.cancelamento], '');
  assert.strictEqual(rows[0][cols.sondador], '');
});

test('OS do Link 2 sem linha correspondente no Link 3 conta em semContrato e sai da lista', () => {
  const { rows, semContrato } = juntarPendentesSondagem([linhaLink2({ 'Ordem de Serviço (OS)': '99999-99' })], [linhaLink3()]);
  assert.strictEqual(rows.length, 0);
  assert.strictEqual(semContrato, 1);
});

test('duas linhas do Link 2 na mesma OS recebem a MESMA chegada (lote) -- múltiplos furos pendentes de uma OS', () => {
  const { header, rows } = juntarPendentesSondagem(
    [linhaLink2({ Identificação: 'A' }), linhaLink2({ Identificação: 'B' })],
    [linhaLink3()],
  );
  const cols = locateColunasAvancos(header);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0][cols.criacaoOS], rows[1][cols.criacaoOS]);
});

test('Link 3 com Tipo diferente do Link 2 na mesma OS não confunde a linha -- junta só por OS, o Tipo final vem do Link 2', () => {
  const { header, rows } = juntarPendentesSondagem(
    [linhaLink2({ Tipo: 'PI' })],
    [linhaLink3({ Tipo: 'SP' })], // agregado da OS pode ter Tipo diferente (multi-tipo na mesma OS)
  );
  const cols = locateColunasAvancos(header);
  assert.strictEqual(rows[0][cols.tipo], 'PI', 'o furo individual do Link 2 é a fonte da verdade do Tipo dele');
});
