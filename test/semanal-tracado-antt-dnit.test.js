'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  padBr, montarUrlWfs, douglasPeucker, simplificarGeometria,
} = require('../tools/semanal/atualizar-tracado-antt-dnit.js');
const {
  UF_ANTT_PARA_SIGLA, TRECHOS_FEDERAIS_POR_CONCESSIONARIA,
} = require('../tools/semanal/tracado-antt-dnit-fonte.js');

test('padBr completa com zero à esquerda até 3 dígitos', () => {
  assert.strictEqual(padBr('40'), '040');
  assert.strictEqual(padBr('60'), '060');
  assert.strictEqual(padBr('101'), '101');
  assert.strictEqual(padBr(9), '009');
});

test('montarUrlWfs monta o CQL_FILTER com BR zero-padded, UF e sobreposição de km', () => {
  const url = montarUrlWfs('40', 'MG', 776.1, 831.4);
  assert.match(url, /typeNames=DNIT:snv_202507a/);
  assert.match(url, /outputFormat=application\/json/);
  const filtro = decodeURIComponent(url.split('CQL_FILTER=')[1]);
  assert.strictEqual(filtro, "vl_br='040' AND sg_uf='MG' AND NOT (vl_km_fina<776.1 OR vl_km_inic>831.4)");
});

test('douglasPeucker preserva extremos e remove pontos quase colineares', () => {
  const linhaReta = [[0, 0], [1, 0.0001], [2, -0.0001], [3, 0]];
  const simplificada = douglasPeucker(linhaReta, 0.0005);
  assert.deepStrictEqual(simplificada, [[0, 0], [3, 0]]);
});

test('douglasPeucker preserva um pico real fora da tolerância', () => {
  const comPico = [[0, 0], [1, 1], [2, 0]];
  const simplificada = douglasPeucker(comPico, 0.0005);
  assert.deepStrictEqual(simplificada, comPico);
});

test('douglasPeucker devolve a linha intacta com menos de 3 pontos', () => {
  assert.deepStrictEqual(douglasPeucker([[0, 0]], 0.0005), [[0, 0]]);
  assert.deepStrictEqual(douglasPeucker([[0, 0], [1, 1]], 0.0005), [[0, 0], [1, 1]]);
});

test('simplificarGeometria reduz pontos de LineString e MultiLineString sem tocar em outros tipos', () => {
  const linhaReta = [[0, 0], [1, 0.0001], [2, -0.0001], [3, 0]];
  const featureLine = { type: 'Feature', geometry: { type: 'LineString', coordinates: linhaReta } };
  simplificarGeometria(featureLine);
  assert.strictEqual(featureLine.geometry.coordinates.length, 2);

  const featureMulti = { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [linhaReta, linhaReta] } };
  simplificarGeometria(featureMulti);
  assert.strictEqual(featureMulti.geometry.coordinates[0].length, 2);
  assert.strictEqual(featureMulti.geometry.coordinates[1].length, 2);

  const featurePonto = { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] } };
  assert.strictEqual(simplificarGeometria(featurePonto), featurePonto);

  assert.strictEqual(simplificarGeometria({ type: 'Feature', geometry: null }).geometry, null);
});

test('todo ufAntt usado em TRECHOS_FEDERAIS_POR_CONCESSIONARIA tem sigla mapeada em UF_ANTT_PARA_SIGLA', () => {
  Object.keys(TRECHOS_FEDERAIS_POR_CONCESSIONARIA).forEach((id) => {
    TRECHOS_FEDERAIS_POR_CONCESSIONARIA[id].forEach((trecho) => {
      assert.ok(
        UF_ANTT_PARA_SIGLA[trecho.ufAntt],
        id + ': código de UF ' + trecho.ufAntt + ' sem sigla mapeada'
      );
      assert.ok(trecho.kmFinal > trecho.kmInicial, id + ': faixa de km invertida ou vazia em BR-' + trecho.br);
    });
  });
});
