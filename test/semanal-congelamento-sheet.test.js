'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarClienteCongelamento } = require('../tools/semanal/congelamento-sheet.js');

function fetchDuble(respostas) {
  const chamadas = [];
  return {
    chamadas,
    fetch: async (url, opcoes) => {
      chamadas.push({ url: String(url), opcoes: opcoes || null });
      const r = respostas.shift();
      if (r instanceof Error) throw r;
      return { ok: true, json: async () => r, text: async () => JSON.stringify(r) };
    },
  };
}

test('carregar transforma as linhas da Sheet no formato porRegistro que o Consolidado le', async () => {
  const d = fetchDuble([{ linhas: [
    { chaveMatriz: 'SUP-1||SP', volume: 10, financeiro: 20, equipe: 2, produtividadeMedia: 5,
      autor: 'ana', congeladoEm: '2026-08-28T22:00:00Z' },
  ] }]);
  const cliente = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: d.fetch, token: 'tok' });
  const congelado = await cliente.carregar('2026-08-31');
  assert.equal(congelado.porRegistro['SUP-1||SP'].volume.tendencia, 10);
  assert.equal(congelado.porRegistro['SUP-1||SP'].produtividadeMedia.tendencia, 5);
  assert.equal(congelado.autor, 'ana');
  assert.match(d.chamadas[0].url, /token=tok/);
  assert.match(d.chamadas[0].url, /semana=2026-08-31/);
});

test('carregar devolve null quando a semana nao tem congelado', async () => {
  const d = fetchDuble([{ linhas: [] }]);
  const cliente = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: d.fetch, token: 'tok' });
  assert.equal(await cliente.carregar('2026-08-31'), null);
});

test('carregar devolve null (nao lanca) quando a rede falha ou o token e recusado', async () => {
  const cliente1 = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: fetchDuble([new Error('offline')]).fetch, token: 'tok' });
  assert.equal(await cliente1.carregar('2026-08-31'), null);
  const cliente2 = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: fetchDuble([{ erro: 'token' }]).fetch, token: 'ruim' });
  assert.equal(await cliente2.carregar('2026-08-31'), null);
});

test('congelar devolve motivo ja-congelada com autor e data, sem lancar', async () => {
  const d = fetchDuble([{ erro: 'ja-congelada', autor: 'ana', congeladoEm: '2026-08-28T22:00:00Z' }]);
  const cliente = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: d.fetch, token: 'tok' });
  const r = await cliente.congelar({ chaveSegunda: '2026-08-31', linhas: [] }, 'bruno');
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'ja-congelada');
  assert.equal(r.autor, 'ana');
});

test('congelar manda token, autor e as linhas no corpo', async () => {
  const d = fetchDuble([{ ok: true, gravadas: 2 }]);
  const cliente = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: d.fetch, token: 'tok' });
  const r = await cliente.congelar({ chaveSegunda: '2026-08-31', linhas: [{ chave: '2026-08-31' }, { chave: '2026-09-01' }] }, 'bruno');
  assert.equal(r.ok, true);
  const corpo = JSON.parse(d.chamadas[0].opcoes.body);
  assert.equal(corpo.token, 'tok');
  assert.equal(corpo.autor, 'bruno');
  assert.equal(corpo.linhas.length, 2);
});
