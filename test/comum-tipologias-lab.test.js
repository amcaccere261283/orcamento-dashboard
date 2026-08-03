'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { classificarEnsaioLab, MAPA_TIPO_ENSAIO_LAB, fonteParaCliente, trechosParaCliente } = require('../tools/comum/tipologias-lab.js');

test('todo destino do mapa é LAB.C ou LAB.E, nunca outra coisa', () => {
  for (const destino of Object.values(MAPA_TIPO_ENSAIO_LAB)) {
    assert.ok(destino === 'LAB.C' || destino === 'LAB.E', `destino inesperado: "${destino}"`);
  }
});

test('mapa tem exatamente os 61 tipos de ensaio medidos na planilha real (60 em 2026-07-31 + TRI.UU acrescentado em 2026-08-02)', () => {
  assert.strictEqual(Object.keys(MAPA_TIPO_ENSAIO_LAB).length, 61);
});

test('TRI.UU (sem número de estágio) classifica igual à família TRI2.UU/TRI3.UU/TRI4.UU -- LAB.E', () => {
  assert.strictEqual(classificarEnsaioLab('TRI.UU'), 'LAB.E');
});

test('amostra de Convencional: caracterização básica', () => {
  for (const t of ['LL', 'LP', 'SED', 'M.ESP', 'PEN', 'CBR.5', 'MCT.C', 'PH']) {
    assert.strictEqual(classificarEnsaioLab(t), 'LAB.C', `esperava LAB.C pra "${t}"`);
  }
});

test('amostra de Especial: ensaios mecânicos/avançados', () => {
  for (const t of ['MR.S', 'TRI3.CU', 'ADENS.I.9', 'PERM.V', 'DURAB', 'LOAD.TEST', 'DOSAG.']) {
    assert.strictEqual(classificarEnsaioLab(t), 'LAB.E', `esperava LAB.E pra "${t}"`);
  }
});

test('os 3 tipos sem classificação confiável (EQ.A, E.CAN, IND.F.P) vão pra Especial por padrão', () => {
  for (const t of ['EQ.A', 'E.CAN', 'IND.F.P']) {
    assert.strictEqual(classificarEnsaioLab(t), 'LAB.E');
  }
});

test('espaço em volta e caixa não decidem nada', () => {
  assert.strictEqual(classificarEnsaioLab('  ll  '), 'LAB.C');
  assert.strictEqual(classificarEnsaioLab('tri3.cu'), 'LAB.E');
});

test('tipo de ensaio desconhecido LANÇA citando o rótulo -- nunca cai calado em Convencional ou Especial', () => {
  assert.throws(() => classificarEnsaioLab('XYZ.NOVO'), /XYZ\.NOVO/);
});

test('tipo de ensaio vazio LANÇA -- linha sem "Tipo de Ensaio" é descartada antes, não classificada', () => {
  assert.throws(() => classificarEnsaioLab(''), /vazi/i);
  assert.throws(() => classificarEnsaioLab(null), /vazi/i);
});

test('o recorte não devolve CR nenhum', () => {
  assert.doesNotMatch(fonteParaCliente(), /\r/);
  trechosParaCliente().forEach((trecho, i) => assert.doesNotMatch(trecho, /\r/, `trecho ${i} tem CR`));
});

test('fonteParaCliente() avalia pros mesmos MAPA_TIPO_ENSAIO_LAB/classificarEnsaioLab que os exports do Node', () => {
  const fonte = fonteParaCliente();
  const cliente = new Function(`${fonte}
return { MAPA_TIPO_ENSAIO_LAB: MAPA_TIPO_ENSAIO_LAB, classificarEnsaioLab: classificarEnsaioLab };`)();

  assert.deepStrictEqual(cliente.MAPA_TIPO_ENSAIO_LAB, MAPA_TIPO_ENSAIO_LAB);
  assert.strictEqual(cliente.classificarEnsaioLab('LL'), classificarEnsaioLab('LL'));
  assert.strictEqual(cliente.classificarEnsaioLab('TRI2.UU'), classificarEnsaioLab('TRI2.UU'));
  assert.throws(() => cliente.classificarEnsaioLab('ENSAIO-INEXISTENTE'), /Tipo de Ensaio desconhecido/);
});
