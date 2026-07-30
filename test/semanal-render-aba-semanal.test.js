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
  const html = renderAbaSemanal([registro(400)], [0], ['volume'], 6);
  for (const s of ['S1', 'S2', 'S3', 'S4']) assert.match(html, new RegExp(s));
  assert.match(html, /Previsto/); assert.match(html, /Realizado/); assert.match(html, /Tend/);
});

test('previsto de volume aparece como um quarto do mês', () => {
  const html = renderAbaSemanal([registro(400)], [0], ['volume'], 6);
  assert.match(html, /100/);
});

test('a coluna de fechamento muda de rótulo conforme a dimensão', () => {
  assert.strictEqual(rotuloColunaFechamento('volume'), 'Total');
  assert.strictEqual(rotuloColunaFechamento('financeiro'), 'Total');
  assert.strictEqual(rotuloColunaFechamento('equipes'), 'Média');
});

test('realizado e tendência ficam vazios enquanto não há planilha semanal', () => {
  const html = renderAbaSemanal([registro(400)], [0], ['volume'], 6);
  assert.match(html, /class="[^"]*sem-dado/);
});

test('com uma dimensão só, renderiza exatamente 1 bloco/tabela', () => {
  const html = renderAbaSemanal([registro(400)], [0], ['volume'], 6);
  assert.equal((html.match(/<div class="bloco-dimensao-semanal">/g) || []).length, 1);
  assert.equal((html.match(/<table class="tabela-semanal">/g) || []).length, 1);
});

test('com várias dimensões marcadas, renderiza um bloco por dimensão, na ordem recebida, cada um com seu próprio título e sua própria coluna de fechamento', () => {
  const html = renderAbaSemanal([registro(400)], [0], ['equipes', 'volume', 'financeiro'], 6);
  assert.equal((html.match(/<div class="bloco-dimensao-semanal">/g) || []).length, 3);
  assert.equal((html.match(/<table class="tabela-semanal">/g) || []).length, 3);

  // split() no próprio marcador de bloco -- blocos[0] é '' (antes do 1º
  // marcador), blocos[1..3] são o conteúdo de cada bloco, na ordem em que
  // aparecem no HTML (que deve ser a ordem recebida em "dimensoes", não
  // reordenada).
  const blocos = html.split('<div class="bloco-dimensao-semanal">').slice(1);
  assert.equal(blocos.length, 3);

  assert.match(blocos[0], /<div class="tabela-semanal-titulo">Equipes<\/div>/);
  assert.match(blocos[1], /<div class="tabela-semanal-titulo">Volume<\/div>/);
  assert.match(blocos[2], /<div class="tabela-semanal-titulo">Financeiro<\/div>/);

  // Bloco de equipes fecha por Média (rótulo da coluna); volume/financeiro fecham por Total.
  assert.match(blocos[0], />Média<\/th>/);
  assert.match(blocos[1], />Total<\/th>/);
  assert.match(blocos[2], />Total<\/th>/);
});

test('título do bloco escapa o rótulo da dimensão (defesa em profundidade, mesmo as 3 dimensões sendo valores fixos e seguros)', () => {
  const html = renderAbaSemanal([registro(400)], [0], ['volume'], 6);
  assert.match(html, /<div class="tabela-semanal-titulo">Volume<\/div>/);
});
