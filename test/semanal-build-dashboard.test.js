'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderSemanal } = require('../tools/semanal/render-semanal.js');

const REGISTROS = [{
  origem: 'CONTRATO VIGENTE', grupo: 'G1', tomador: 'T1', sup: 'SUP-0001-24',
  escopo: 'E', apoio: 'A', inicio: 45439, termino: 47265, tipologia: 'ST', observacao: null,
  previsto:  { equipes: new Array(12).fill(1), volume: new Array(12).fill(400), financeiro: new Array(12).fill(1000),
               equipesResumo: { pico: 1, media: 1, prod: 8, dias: 25 },
               volumeResumo: { total: 4800, totalInicial: 4800, ticket: 2.5 },
               financeiroResumo: { total: 12000, totalInicial: 12000 } },
  realizado: { equipes: new Array(12).fill(0), volume: new Array(12).fill(0), financeiro: new Array(12).fill(0),
               equipesResumo: { pico: 0, media: 0, prod: 8, dias: 25 },
               volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
               financeiroResumo: { total: 0, totalInicial: 0 } },
  total:     { equipes: new Array(12).fill(0), volume: new Array(12).fill(0), financeiro: new Array(12).fill(0),
               equipesResumo: { pico: 0, media: 0, prod: 8, dias: 25 },
               volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
               financeiroResumo: { total: 0, totalInicial: 0 } },
}];

test('gera HTML com as duas abas e a casca compartilhada', () => {
  const html = renderSemanal({ registros: REGISTROS, baseline: [], senha: 'fake', geradoEm: new Date(0) });
  assert.match(html, /id="aba-semanal"/);
  assert.match(html, /id="aba-balanco"/);
  assert.match(html, /abas-visualizacao/);
  assert.match(html, /--text-primary/);
});

test('nenhum identificador aparece em texto puro', () => {
  const html = renderSemanal({ registros: REGISTROS, baseline: [], senha: 'fake', geradoEm: new Date(0) });
  assert.doesNotMatch(html, /SUP-0001-24/, 'SUP vazou fora do blob cifrado');
  assert.doesNotMatch(html, /Via Araucária|T1/, 'tomador vazou fora do blob cifrado');
});

test('a senha nunca aparece no HTML', () => {
  const html = renderSemanal({ registros: REGISTROS, baseline: [], senha: 'senha-secreta-123', geradoEm: new Date(0) });
  assert.doesNotMatch(html, /senha-secreta-123/);
});
