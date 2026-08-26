'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { resolverCoordenadasPorSup } = require('../tools/semanal/coordenadas-sup.js');

test('resolve lat/lon quando as colunas Latitude/Longitude existem', () => {
  const header = ['Contrato', 'Tipo', 'Latitude', 'Longitude'];
  const rows = [['SUP-A', 'SP', '-25.5', '-49.2']];
  const resultado = resolverCoordenadasPorSup(header, rows);
  assert.deepStrictEqual(resultado, { 'SUP-A': { lat: -25.5, lon: -49.2 } });
});

test('aceita variações comuns de nome de coluna (Lat/Lon/Lng)', () => {
  assert.deepStrictEqual(
    resolverCoordenadasPorSup(['Contrato', 'Lat', 'Lon'], [['SUP-B', '-25.4', '-49.1']]),
    { 'SUP-B': { lat: -25.4, lon: -49.1 } }
  );
  assert.deepStrictEqual(
    resolverCoordenadasPorSup(['Contrato', 'Lat', 'Lng'], [['SUP-C', '-25.3', '-49.0']]),
    { 'SUP-C': { lat: -25.3, lon: -49.0 } }
  );
});

test('sem coluna de coordenada -- devolve objeto vazio, nunca lança', () => {
  const header = ['Contrato', 'Tipo'];
  const rows = [['SUP-D', 'SP']];
  assert.deepStrictEqual(resolverCoordenadasPorSup(header, rows), {});
});

test('valor não-numérico ou célula vazia -- SUP não entra no resultado', () => {
  const header = ['Contrato', 'Latitude', 'Longitude'];
  const rows = [
    ['SUP-E', '', ''],
    ['SUP-F', 'abc', '-49.2'],
  ];
  assert.deepStrictEqual(resolverCoordenadasPorSup(header, rows), {});
});

test('lat e lon ambos zero é tratado como ausente -- 0,0 é o placeholder mais comum de planilha, nunca um SUP real', () => {
  const header = ['Contrato', 'Latitude', 'Longitude'];
  const rows = [['SUP-G', '0', '0']];
  assert.deepStrictEqual(resolverCoordenadasPorSup(header, rows), {});
});

test('duas linhas do mesmo SUP -- usa a PRIMEIRA coordenada válida, ignora a segunda', () => {
  const header = ['Contrato', 'Latitude', 'Longitude'];
  const rows = [
    ['SUP-H', '-25.5', '-49.2'],
    ['SUP-H', '-25.9', '-49.9'],
  ];
  assert.deepStrictEqual(resolverCoordenadasPorSup(header, rows), { 'SUP-H': { lat: -25.5, lon: -49.2 } });
});

test('linha sem Contrato preenchido é ignorada', () => {
  const header = ['Contrato', 'Latitude', 'Longitude'];
  const rows = [['', '-25.5', '-49.2']];
  assert.deepStrictEqual(resolverCoordenadasPorSup(header, rows), {});
});

test('valor com vírgula decimal (formato PT-BR) é rejeitado, não truncado silenciosamente', () => {
  const header = ['Contrato', 'Latitude', 'Longitude'];
  const rows = [['SUP-I', '-25,5', '-49.2']];
  assert.deepStrictEqual(resolverCoordenadasPorSup(header, rows), {});
});
