'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buscarListaDeAbas, extrairAbasDoHtml, parseNomeAbaEq, mesesEqDoAno,
} = require('../tools/comum/descobrir-abas-planilha.js');

test('extrairAbasDoHtml extrai {nome, gid} de vários items.push', () => {
  const html = `<html><script>
    items.push({name: "2026 - JULHO (EQ)", pageUrl: "https://x", gid: "147186333"});
    items.push({name: "2026 - JULHO (VEIC)", pageUrl: "https://x", gid: "999"});
  </script></html>`;
  assert.deepEqual(extrairAbasDoHtml(html), [
    { nome: '2026 - JULHO (EQ)', gid: '147186333' },
    { nome: '2026 - JULHO (VEIC)', gid: '999' },
  ]);
});

test('buscarListaDeAbas monta a URL do htmlview e devolve extrairAbasDoHtml', async () => {
  let urlChamada = null;
  const fakeFetch = async (url) => {
    urlChamada = url;
    return { ok: true, status: 200, text: async () => 'items.push({name: "2026 - AGOSTO (EQ)", pageUrl: "https://x", gid: "1"});' };
  };
  const abas = await buscarListaDeAbas('FILE_ID', fakeFetch);
  assert.equal(urlChamada, 'https://docs.google.com/spreadsheets/d/FILE_ID/htmlview');
  assert.deepEqual(abas, [{ nome: '2026 - AGOSTO (EQ)', gid: '1' }]);
});

test('buscarListaDeAbas lança erro quando a resposta HTTP não é ok', async () => {
  const fakeFetch = async () => ({ ok: false, status: 500, text: async () => '' });
  await assert.rejects(() => buscarListaDeAbas('FILE_ID', fakeFetch), /HTTP 500/);
});

test('parseNomeAbaEq: só reconhece categoria (EQ), tolera espaço extra e mês abreviado/por extenso', () => {
  assert.deepEqual(parseNomeAbaEq('2026 - JULHO (EQ)'), { ano: 2026, mes: 7 });
  assert.deepEqual(parseNomeAbaEq(' 2026 - AGOSTO (EQ) '), { ano: 2026, mes: 8 });
  assert.deepEqual(parseNomeAbaEq('2026 - AGO (EQ)'), { ano: 2026, mes: 8 });
  assert.equal(parseNomeAbaEq('2026 - JULHO (VEIC)'), null);
  assert.equal(parseNomeAbaEq('2026 - JULHO (EQ e SUP.)'), null); // categoria diferente, não confundir
  assert.equal(parseNomeAbaEq('JULHO (EQ)'), null); // sem ano, nunca adivinha
  assert.equal(parseNomeAbaEq(''), null);
});

test('mesesEqDoAno filtra pelo ano e ordena por mês, ignorando categorias/anos diferentes', () => {
  const abas = [
    { nome: '2026 - MARÇO (EQ)', gid: '3' },
    { nome: '2026 - JANEIRO (EQ)', gid: '1' },
    { nome: '2026 - FEVEREIRO (EQ)', gid: '2' },
    { nome: '2025 - DEZEMBRO (EQ)', gid: '99' },
    { nome: '2026 - JANEIRO (VEIC)', gid: '100' },
  ];
  assert.deepEqual(mesesEqDoAno(abas, 2026), [
    { ano: 2026, mes: 1, gid: '1' },
    { ano: 2026, mes: 2, gid: '2' },
    { ano: 2026, mes: 3, gid: '3' },
  ]);
});

test('mesesEqDoAno descarta mês com 2+ abas ambíguas em vez de escolher uma', () => {
  const abas = [
    { nome: '2026 - JANEIRO (EQ)', gid: '1' },
    { nome: '2026 - JAN (EQ)', gid: '2' }, // mesmo (ano,mes), nome diferente -- duplicata
  ];
  assert.deepEqual(mesesEqDoAno(abas, 2026), []);
});
