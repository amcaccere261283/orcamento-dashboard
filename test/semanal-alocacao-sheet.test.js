'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  criarClienteAlocacao, chaveSemana, RE_URL_ALOCACAO_PENDENTE,
} = require('../tools/semanal/alocacao-sheet.js');

function armazenamentoFalso() {
  const dados = {};
  return {
    getItem: (k) => (k in dados ? dados[k] : null),
    setItem: (k, v) => { dados[k] = String(v); },
    _dados: dados,
  };
}

const URL_OK = 'https://script.google.com/macros/s/AKfy.../exec';

test('chaveSemana é ano + data ISO do início da semana', () => {
  const inicio = Math.floor(Date.UTC(2026, 7, 10) / 86400000);
  assert.strictEqual(chaveSemana(2026, inicio), '2026|2026-08-10');
});

test('URL PENDENTE- cai no modo local, sem tocar na rede', async () => {
  let chamou = false;
  const cliente = criarClienteAlocacao({
    url: 'PENDENTE-publicar-o-apps-script',
    fetch: () => { chamou = true; throw new Error('não devia buscar'); },
    armazenamento: armazenamentoFalso(),
    autor: 'teste',
  });
  assert.strictEqual(cliente.modo(), 'local');
  const r = await cliente.carregar('2026|2026-08-10');
  assert.deepStrictEqual(r, {});
  assert.strictEqual(chamou, false);
  assert.match('PENDENTE-qualquer-coisa', RE_URL_ALOCACAO_PENDENTE);
});

test('no modo local a gravação vai para o armazenamento e volta na leitura', async () => {
  const armazenamento = armazenamentoFalso();
  const cliente = criarClienteAlocacao({
    url: 'PENDENTE-x', fetch: () => { throw new Error('não'); }, armazenamento, autor: 'teste',
  });
  await cliente.gravar({ chaveSemana: '2026|2026-08-10', equipeId: '4', sup: 'SUP-A', coluna: 'SP' });
  const r = await cliente.carregar('2026|2026-08-10');
  assert.deepStrictEqual(r, { 4: { sup: 'SUP-A', coluna: 'SP' } });
});

test('sup null REMOVE a equipe da semana', async () => {
  const armazenamento = armazenamentoFalso();
  const cliente = criarClienteAlocacao({
    url: 'PENDENTE-x', fetch: () => { throw new Error('não'); }, armazenamento, autor: 'teste',
  });
  await cliente.gravar({ chaveSemana: '2026|2026-08-10', equipeId: '4', sup: 'SUP-A', coluna: 'SP' });
  await cliente.gravar({ chaveSemana: '2026|2026-08-10', equipeId: '4', sup: null, coluna: null });
  assert.deepStrictEqual(await cliente.carregar('2026|2026-08-10'), {});
});

test('com URL real, carregar faz GET e devolve o mapa por equipe', async () => {
  const cliente = criarClienteAlocacao({
    url: URL_OK,
    fetch: async (url) => {
      assert.match(url, /semana=2026%7C2026-08-10/);
      return { ok: true, json: async () => ({ linhas: [
        { equipeId: '4', sup: 'SUP-A', coluna: 'SP' },
        { equipeId: '59', sup: 'SUP-B', coluna: 'ST' },
      ] }) };
    },
    armazenamento: armazenamentoFalso(), autor: 'teste',
  });
  assert.strictEqual(cliente.modo(), 'sheet');
  assert.deepStrictEqual(await cliente.carregar('2026|2026-08-10'), {
    4: { sup: 'SUP-A', coluna: 'SP' },
    59: { sup: 'SUP-B', coluna: 'ST' },
  });
});

test('a gravação usa POST com text/plain -- sem preflight, que o Apps Script não responde', async () => {
  let visto = null;
  const cliente = criarClienteAlocacao({
    url: URL_OK,
    fetch: async (url, opcoes) => {
      visto = { url, opcoes };
      return { ok: true, json: async () => ({ linhas: [{ equipeId: '4', sup: 'SUP-A', coluna: 'SP' }] }) };
    },
    armazenamento: armazenamentoFalso(), autor: 'amcac',
  });
  await cliente.gravar({ chaveSemana: '2026|2026-08-10', equipeId: '4', sup: 'SUP-A', coluna: 'SP' });
  assert.strictEqual(visto.opcoes.method, 'POST');
  assert.match(visto.opcoes.headers['Content-Type'], /^text\/plain/);
  const corpo = JSON.parse(visto.opcoes.body);
  assert.strictEqual(corpo.equipeId, '4');
  assert.strictEqual(corpo.autor, 'amcac');
});

test('falha de rede NÃO perde o movimento: ele entra na fila e é reenviado depois', async () => {
  let falhar = true;
  const cliente = criarClienteAlocacao({
    url: URL_OK,
    fetch: async () => {
      if (falhar) throw new Error('offline');
      return { ok: true, json: async () => ({ linhas: [] }) };
    },
    armazenamento: armazenamentoFalso(), autor: 'teste',
  });
  await cliente.gravar({ chaveSemana: '2026|2026-08-10', equipeId: '4', sup: 'SUP-A', coluna: 'SP' });
  assert.strictEqual(cliente.pendentes().length, 1);
  falhar = false;
  await cliente.tentarDeNovo();
  assert.strictEqual(cliente.pendentes().length, 0);
});

test('a fila sobrevive a um recarregamento -- fica no armazenamento', async () => {
  const armazenamento = armazenamentoFalso();
  const cliente = criarClienteAlocacao({
    url: URL_OK, fetch: async () => { throw new Error('offline'); }, armazenamento, autor: 'teste',
  });
  await cliente.gravar({ chaveSemana: '2026|2026-08-10', equipeId: '4', sup: 'SUP-A', coluna: 'SP' });
  const outro = criarClienteAlocacao({
    url: URL_OK, fetch: async () => { throw new Error('offline'); }, armazenamento, autor: 'teste',
  });
  assert.strictEqual(outro.pendentes().length, 1);
});

test('resposta HTTP não-ok também vira fila, não silêncio', async () => {
  const cliente = criarClienteAlocacao({
    url: URL_OK,
    fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }),
    armazenamento: armazenamentoFalso(), autor: 'teste',
  });
  await cliente.gravar({ chaveSemana: '2026|2026-08-10', equipeId: '4', sup: 'SUP-A', coluna: 'SP' });
  assert.strictEqual(cliente.pendentes().length, 1);
});
