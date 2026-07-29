'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderAbaSemanal, rotuloColunaFechamento } = require('../tools/semanal/render-aba-semanal.js');

function registro(volumeMes) {
  const zeros = new Array(12).fill(0);
  const vol = new Array(12).fill(0); vol[6] = volumeMes;
  const bloco = (v) => ({ equipes: new Array(12).fill(2), volume: v, financeiro: zeros,
    equipesResumo: { pico: 2, media: 2, prod: 8, dias: 25 },
    volumeResumo: { total: volumeMes, totalInicial: volumeMes, ticket: 1 },
    financeiroResumo: { total: 0, totalInicial: 0 } });
  return { sup: 'SUP-0001-24', grupo: 'G', tomador: 'T', tipologia: 'ST',
           previsto: bloco(vol), realizado: bloco(zeros), total: bloco(zeros) };
}

test('mostra as 4 semanas com P, R e T', () => {
  const html = renderAbaSemanal([registro(400)], [0], 'volume', 6);
  for (const s of ['S1', 'S2', 'S3', 'S4']) assert.match(html, new RegExp(s));
  assert.match(html, /Previsto/); assert.match(html, /Realizado/); assert.match(html, /Tend/);
});

test('previsto de volume aparece como um quarto do mês', () => {
  const html = renderAbaSemanal([registro(400)], [0], 'volume', 6);
  assert.match(html, /100/);
});

test('a coluna de fechamento muda de rótulo conforme a dimensão', () => {
  assert.strictEqual(rotuloColunaFechamento('volume'), 'Total');
  assert.strictEqual(rotuloColunaFechamento('financeiro'), 'Total');
  assert.strictEqual(rotuloColunaFechamento('equipes'), 'Média');
});

test('realizado e tendência ficam vazios enquanto não há planilha semanal', () => {
  const html = renderAbaSemanal([registro(400)], [0], 'volume', 6);
  assert.match(html, /class="[^"]*sem-dado/);
});
