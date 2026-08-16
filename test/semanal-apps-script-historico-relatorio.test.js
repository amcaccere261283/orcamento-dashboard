'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CAMINHO_GS = path.join(__dirname, '..', 'tools', 'semanal', 'apps-script-historico-relatorio.gs');

function criarPlanilhaFalsa() {
  const abas = new Map();
  function criarAba(nome) {
    const celulas = [];
    return {
      nome,
      getMaxRows: () => Math.max(celulas.length, 1000),
      getRange(linha, coluna, nLinhas, nColunas) {
        return {
          setNumberFormat() { return this; },
          setValues(valores) {
            for (let r = 0; r < nLinhas; r++) {
              const alvo = linha + r - 1;
              while (celulas.length <= alvo) celulas.push([]);
              for (let c = 0; c < nColunas; c++) celulas[alvo][coluna + c - 1] = valores[r][c];
            }
            return this;
          },
        };
      },
      appendRow(valores) { celulas.push(valores.slice()); },
      _celulas: celulas,
    };
  }
  return {
    getSheetByName: nome => abas.get(nome) || null,
    insertSheet(nome) { const aba = criarAba(nome); abas.set(nome, aba); return aba; },
  };
}

function carregarScript() {
  const planilha = criarPlanilhaFalsa();
  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => planilha },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: texto => ({ texto, setMimeType() { return this; } }) },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(CAMINHO_GS, 'utf8'), sandbox, { filename: CAMINHO_GS });
  return {
    planilha,
    post: corpo => JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify(corpo) } }).texto),
  };
}

test('o .gs compila e expõe doPost', () => {
  const { post } = carregarScript();
  assert.strictEqual(typeof post, 'function');
});

test('doPost cria a aba HISTORICO_RELATORIO com o cabeçalho na 1ª gravação', () => {
  const s = carregarScript();
  s.post({ linhas: [{ geradoEm: '2026-08-16T10:00:00.000Z', sup: 'SUP-0001-24', tipologia: 'ST', dimensao: 'volume' }] });
  const aba = s.planilha.getSheetByName('HISTORICO_RELATORIO');
  assert.ok(aba, 'esperava a aba HISTORICO_RELATORIO criada');
  assert.strictEqual(aba._celulas[0][0], 'geradoEm');
  assert.strictEqual(aba._celulas[0][3], 'sup');
});

test('cada gravação faz APPEND -- duas gerações da mesma semana não se sobrescrevem', () => {
  const s = carregarScript();
  s.post({ linhas: [{ geradoEm: '2026-08-16T10:00:00.000Z', sup: 'SUP-0001-24', tipologia: 'ST', dimensao: 'volume' }] });
  s.post({ linhas: [{ geradoEm: '2026-08-16T15:00:00.000Z', sup: 'SUP-0001-24', tipologia: 'ST', dimensao: 'volume' }] });
  const aba = s.planilha.getSheetByName('HISTORICO_RELATORIO');
  assert.strictEqual(aba._celulas.length, 3, 'cabeçalho + 2 linhas gravadas, nenhuma sobrescrita');
});

test('um lote com várias linhas grava todas, na ordem, e devolve a contagem', () => {
  const s = carregarScript();
  const resultado = s.post({ linhas: [
    { sup: 'SUP-A', tipologia: 'ST', dimensao: 'volume' },
    { sup: 'SUP-A', tipologia: 'ST', dimensao: 'equipes' },
    { sup: '—', tipologia: 'TOTAL GERAL', dimensao: '', qtdCritico: 3, qtdAtencao: 5 },
  ] });
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.gravadas, 3);
  const aba = s.planilha.getSheetByName('HISTORICO_RELATORIO');
  assert.strictEqual(aba._celulas.length, 4);
  assert.strictEqual(aba._celulas[3][14], 3); // qtdCritico da linha-resumo
});
