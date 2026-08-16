'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { criarClienteHistoricoRelatorio, RE_URL_HISTORICO_PENDENTE } = require('../tools/semanal/historico-relatorio-sheet.js');

function armazenamentoFalso() {
  const dados = {};
  return { getItem: (k) => (k in dados ? dados[k] : null), setItem: (k, v) => { dados[k] = String(v); } };
}

const URL_OK = 'https://script.google.com/macros/s/AKfy.../exec';
const LOTE = { linhas: [{ geradoEm: '2026-08-16T10:00:00.000Z', sup: 'SUP-0001-24', tipologia: 'ST', dimensao: 'volume', previstoAcumulado: 100 }] };

test('URL PENDENTE- cai no modo local, sem tocar na rede', async () => {
  let chamou = false;
  const cliente = criarClienteHistoricoRelatorio({
    url: 'PENDENTE-publicar-o-apps-script', fetch: () => { chamou = true; throw new Error('não devia buscar'); },
    armazenamento: armazenamentoFalso(),
  });
  assert.strictEqual(cliente.modo(), 'local');
  const r = await cliente.gravar(LOTE);
  assert.deepStrictEqual(r, { ok: true, modo: 'local' });
  assert.strictEqual(chamou, false);
  assert.match('PENDENTE-qualquer-coisa', RE_URL_HISTORICO_PENDENTE);
});

test('com URL real, gravar faz POST com text/plain e o lote inteiro no corpo', async () => {
  let visto = null;
  const cliente = criarClienteHistoricoRelatorio({
    url: URL_OK,
    fetch: async (url, opcoes) => { visto = { url, opcoes }; return { ok: true, json: async () => ({ ok: true, gravadas: 1 }) }; },
    armazenamento: armazenamentoFalso(),
  });
  assert.strictEqual(cliente.modo(), 'sheet');
  const r = await cliente.gravar(LOTE);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(visto.opcoes.method, 'POST');
  assert.match(visto.opcoes.headers['Content-Type'], /^text\/plain/);
  const corpo = JSON.parse(visto.opcoes.body);
  assert.strictEqual(corpo.linhas.length, 1);
  assert.strictEqual(corpo.linhas[0].sup, 'SUP-0001-24');
});

test('falha de rede NÃO perde o lote: entra na fila e é reenviado depois', async () => {
  let falhar = true;
  const cliente = criarClienteHistoricoRelatorio({
    url: URL_OK, fetch: async () => { if (falhar) throw new Error('offline'); return { ok: true, json: async () => ({ ok: true }) }; },
    armazenamento: armazenamentoFalso(),
  });
  await cliente.gravar(LOTE);
  assert.strictEqual(cliente.pendentes().length, 1);
  falhar = false;
  await cliente.tentarDeNovo();
  assert.strictEqual(cliente.pendentes().length, 0);
});

test('resposta HTTP não-ok também vira fila, não silêncio', async () => {
  const cliente = criarClienteHistoricoRelatorio({
    url: URL_OK, fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }), armazenamento: armazenamentoFalso(),
  });
  await cliente.gravar(LOTE);
  assert.strictEqual(cliente.pendentes().length, 1);
});
