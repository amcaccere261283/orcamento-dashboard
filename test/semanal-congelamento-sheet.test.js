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
  // A leitura e POST com acao 'ler' -- o token NAO pode viajar na query string,
  // onde aparece nos logs de execucao do Apps Script e em qualquer registro de
  // requisicao (e um token vazado permite recuperar a senha do dashboard).
  assert.equal(d.chamadas[0].opcoes.method, 'POST');
  assert.doesNotMatch(d.chamadas[0].url, /token|semana/);
  const corpo = JSON.parse(d.chamadas[0].opcoes.body);
  assert.equal(corpo.acao, 'ler');
  assert.equal(corpo.token, 'tok');
  assert.equal(corpo.semana, '2026-08-31');
});

test('carregar devolve estado sem congelado quando a semana nao tem nenhum ponto', async () => {
  const d = fetchDuble([{ linhas: [], estado: { travada: false, autor: '', atualizadoEm: '' } }]);
  const cliente = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: d.fetch, token: 'tok' });
  const r = await cliente.carregar('2026-08-31', '2026-08-31', ['2026-08-31']);
  assert.equal(r.porRegistro, null);
  assert.equal(r.semAlgumaLinha, true);
  assert.deepEqual(r.estado, { travada: false, autor: '', atualizadoEm: '' });
});

// "Nunca foi congelada" e "existe congelamento que nao consegui ler" nao podem
// virar o mesmo null: com a senha rotacionada sem atualizar a Script Property
// TOKEN_DASHBOARD, a segunda vira "(recalculada)" na tela sem ninguem saber que
// ha um congelamento inacessivel. Degradar sem lancar continua obrigatorio.
test('carregar distingue token recusado de rede fora, sem lancar', async () => {
  const cliente1 = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: fetchDuble([new Error('offline')]).fetch, token: 'tok' });
  assert.deepEqual(await cliente1.carregar('2026-08-31'), { motivo: 'rede' });
  const cliente2 = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: fetchDuble([{ erro: 'token' }]).fetch, token: 'ruim' });
  assert.deepEqual(await cliente2.carregar('2026-08-31'), { motivo: 'token' });
  // Qualquer outro erro do Apps Script cai em 'rede' -- e uma falha de leitura,
  // nao "sem congelado".
  const cliente3 = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: fetchDuble([{ erro: 'use-post' }]).fetch, token: 'tok' });
  assert.deepEqual(await cliente3.carregar('2026-08-31'), { motivo: 'rede' });
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
  assert.equal(corpo.acao, 'congelar');
  assert.equal(corpo.token, 'tok');
  assert.equal(corpo.autor, 'bruno');
  assert.equal(corpo.linhas.length, 2);
});

test('desfazer manda token, acao e as chaves no corpo', async () => {
  const d = fetchDuble([{ ok: true, apagadas: 2 }]);
  const cliente = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: d.fetch, token: 'tok' });
  const r = await cliente.desfazer(['2026-08-31', '2026-09-01']);
  assert.equal(r.ok, true);
  assert.equal(r.apagadas, 2);
  const corpo = JSON.parse(d.chamadas[0].opcoes.body);
  assert.equal(corpo.token, 'tok');
  assert.equal(corpo.acao, 'desfazer');
  assert.deepEqual(corpo.chaves, ['2026-08-31', '2026-09-01']);
});

test('desfazer degrada pra {ok:false, motivo} em erro de token, sem lancar', async () => {
  const d = fetchDuble([{ erro: 'token' }]);
  const cliente = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: d.fetch, token: 'ruim' });
  const r = await cliente.desfazer(['2026-08-31']);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'token');
});

test('desfazer degrada pra {ok:false, motivo:"rede"} quando o fetch lanca, sem lancar', async () => {
  const cliente = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: fetchDuble([new Error('offline')]).fetch, token: 'tok' });
  const r = await cliente.desfazer(['2026-08-31']);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'rede');
});

test('carregar inclui o campo estado (travada/autor/atualizadoEm) vindo da Sheet', async () => {
  const d = fetchDuble([{ linhas: [], estado: { travada: true, autor: 'ana', atualizadoEm: '2026-08-28T22:00:00Z' } }]);
  const cliente = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: d.fetch, token: 'tok' });
  const congelado = await cliente.carregar('2026-08-31', '2026-08-31', ['2026-08-31']);
  assert.deepEqual(congelado.estado, { travada: true, autor: 'ana', atualizadoEm: '2026-08-28T22:00:00Z' });
  const corpo = JSON.parse(d.chamadas[0].opcoes.body);
  assert.equal(corpo.chaveSegunda, '2026-08-31');
  assert.deepEqual(corpo.chavesFragmentos, ['2026-08-31']);
});

test('travar manda acao, chaveSegunda, autor e as linhas (quando fornecidas) no corpo', async () => {
  const d = fetchDuble([{ ok: true, gravadas: 1 }]);
  const cliente = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: d.fetch, token: 'tok' });
  const r = await cliente.travar('2026-08-31', { chaveSegunda: '2026-08-31', linhas: [{ chave: '2026-08-31' }] }, 'ana');
  assert.equal(r.ok, true);
  const corpo = JSON.parse(d.chamadas[0].opcoes.body);
  assert.equal(corpo.acao, 'travar');
  assert.equal(corpo.token, 'tok');
  assert.equal(corpo.chaveSegunda, '2026-08-31');
  assert.equal(corpo.autor, 'ana');
  assert.equal(corpo.linhas.length, 1);
});

test('travar sem snapshot manda linhas vazio -- so trava, sem tocar nos pontos', async () => {
  const d = fetchDuble([{ ok: true, gravadas: 0 }]);
  const cliente = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: d.fetch, token: 'tok' });
  await cliente.travar('2026-08-31', null, 'ana');
  const corpo = JSON.parse(d.chamadas[0].opcoes.body);
  assert.deepEqual(corpo.linhas, []);
});

test('destravar manda acao, chaveSegunda e autor, sem linhas', async () => {
  const d = fetchDuble([{ ok: true }]);
  const cliente = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: d.fetch, token: 'tok' });
  const r = await cliente.destravar('2026-08-31', 'bruno');
  assert.equal(r.ok, true);
  const corpo = JSON.parse(d.chamadas[0].opcoes.body);
  assert.equal(corpo.acao, 'destravar');
  assert.equal(corpo.chaveSegunda, '2026-08-31');
  assert.equal(corpo.autor, 'bruno');
  assert.equal(corpo.linhas, undefined);
});

test('travar e destravar degradam para {ok:false, motivo} sem lancar (token e rede)', async () => {
  const cliente1 = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: fetchDuble([{ erro: 'token' }]).fetch, token: 'ruim' });
  assert.deepEqual(await cliente1.travar('2026-08-31', null, 'x'), { ok: false, motivo: 'token' });
  const cliente2 = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: fetchDuble([new Error('offline')]).fetch, token: 'tok' });
  assert.deepEqual(await cliente2.destravar('2026-08-31', 'x'), { ok: false, motivo: 'rede' });
});
