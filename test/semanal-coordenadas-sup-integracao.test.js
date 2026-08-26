'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { resolverCoordenadasPorSup } = require('../tools/semanal/coordenadas-sup.js');
const { HEADER_SAIDA } = require('../tools/semanal/mapear-producao-total.js');

test('o grid combinado (avanços + pendentes) que build-dashboard.js monta resolve coordenada por SUP', () => {
  // Mesmo formato que build-dashboard.js produz: gridAvancos[0] = header
  // (HEADER_SAIDA), gridAvancos[1..] = linhas de avancos-online.csv seguidas
  // das linhas de demandas-sondagem-online.csv.
  var colLat = HEADER_SAIDA.indexOf('Latitude');
  var colLon = HEADER_SAIDA.indexOf('Longitude');
  var linha = new Array(HEADER_SAIDA.length).fill('');
  linha[HEADER_SAIDA.indexOf('Contrato')] = 'SUP-A';
  linha[colLat] = '-25.5';
  linha[colLon] = '-49.2';
  var resultado = resolverCoordenadasPorSup(HEADER_SAIDA, [linha]);
  assert.deepStrictEqual(resultado, { 'SUP-A': { lat: -25.5, lon: -49.2 } });
});
