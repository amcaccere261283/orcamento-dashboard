'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const TOKEN_BOM = 'token-de-teste-abc123';

// O Sheets COAGE uma string tipo '2026-08-31' pra Date na gravação, e
// String(Date) nunca casa com a string ISO na releitura -- o script gravaria e
// descartaria a própria linha, em silêncio. Este dublê IMITA a coerção: sem
// isso, o teste passaria com o bug. Foi exatamente essa armadilha que mordeu o
// apps-script-alocacao.gs em 2026-08-11.
function criarSheetsDuble() {
  const linhas = [['Ano', 'SemanaInicio', 'Chave', 'Volume', 'Financeiro', 'Equipe', 'ProdutividadeMedia', 'Autor', 'CongeladoEm']];
  function faixa(inicioLinha, numLinhas) {
    let formatoTexto = false;
    return {
      setNumberFormat(f) { formatoTexto = (f === '@'); return this; },
      setValues(valores) {
        valores.forEach((linha, i) => {
          linhas[inicioLinha - 1 + i] = linha.map((v) => {
            // A coerção só acontece quando a célula NÃO está formatada como texto.
            if (!formatoTexto && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
              return new Date(v + 'T00:00:00Z');
            }
            return v;
          });
        });
        return this;
      },
    };
  }
  const aba = {
    getDataRange: () => ({ getValues: () => linhas.map((l) => l.slice()) }),
    getLastRow: () => linhas.length,
    getRange: (l, c, nl, nc) => faixa(l, nl),
    appendRow: (l) => { linhas.push(l); },
  };
  return {
    aba,
    linhas,
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => aba, insertSheet: () => aba }) },
  };
}

function carregarScript(duble) {
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'tools', 'semanal', 'apps-script-congelamento.gs'), 'utf8');
  const contexto = {
    SpreadsheetApp: duble.SpreadsheetApp,
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (t) => ({ setMimeType: () => ({ conteudo: t }) }),
    },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k) => (k === 'TOKEN_DASHBOARD' ? TOKEN_BOM : null) }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  };
  vm.createContext(contexto);
  vm.runInContext(codigo, contexto);
  return contexto;
}

function corpoDe(saida) { return JSON.parse(saida.conteudo); }

test('doPost grava e doGet le de volta a MESMA chave de semana (sobrevive a coercao de data)', () => {
  const duble = criarSheetsDuble();
  const ctx = carregarScript(duble);
  const gravado = corpoDe(ctx.doPost({ postData: { contents: JSON.stringify({
    token: TOKEN_BOM, chaveSegunda: '2026-08-31', autor: 'teste', congeladoEm: '2026-08-28T22:00:00Z',
    linhas: [{ chave: '2026-08-31', chaveMatriz: 'SUP-1||SP', volume: 10, financeiro: 20, equipe: 2, produtividadeMedia: 5 }],
  }) } }));
  assert.equal(gravado.ok, true);
  assert.equal(gravado.gravadas, 1);

  const lido = corpoDe(ctx.doGet({ parameter: { semana: '2026-08-31', token: TOKEN_BOM } }));
  assert.equal(lido.linhas.length, 1, 'a linha gravada tem de ser encontrada na releitura');
  assert.equal(lido.linhas[0].chaveMatriz, 'SUP-1||SP');
  assert.equal(lido.linhas[0].volume, 10);
});

test('doPost RECUSA quando a semana ja tem qualquer linha, sem sobrescrever', () => {
  const duble = criarSheetsDuble();
  const ctx = carregarScript(duble);
  const corpo = (volume) => ({ postData: { contents: JSON.stringify({
    token: TOKEN_BOM, chaveSegunda: '2026-08-31', autor: 'primeiro', congeladoEm: '2026-08-28T22:00:00Z',
    linhas: [{ chave: '2026-08-31', chaveMatriz: 'SUP-1||SP', volume: volume, financeiro: 0, equipe: 1, produtividadeMedia: volume }],
  }) } });
  ctx.doPost(corpo(10));
  const segunda = corpoDe(ctx.doPost(corpo(999)));
  assert.equal(segunda.erro, 'ja-congelada');
  assert.equal(segunda.autor, 'primeiro');

  const lido = corpoDe(ctx.doGet({ parameter: { semana: '2026-08-31', token: TOKEN_BOM } }));
  assert.equal(lido.linhas[0].volume, 10, 'o valor original NAO pode ter sido sobrescrito');
});

test('token errado e recusado na leitura e na escrita', () => {
  const duble = criarSheetsDuble();
  const ctx = carregarScript(duble);
  assert.equal(corpoDe(ctx.doGet({ parameter: { semana: '2026-08-31', token: 'errado' } })).erro, 'token');
  assert.equal(corpoDe(ctx.doPost({ postData: { contents: JSON.stringify({
    token: 'errado', chaveSegunda: '2026-08-31', linhas: [],
  }) } })).erro, 'token');
});
