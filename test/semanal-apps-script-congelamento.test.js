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
//
// A coerção real do Sheets produz meia-noite no FUSO DA PLANILHA, não em UTC
// -- por isso o Date aqui é construído com o construtor local (ano, mes-1,
// dia), igual ao dublê de apps-script-alocacao.test.js. Um dublê que usasse
// UTC ('...T00:00:00Z') não daria dente ao teste: em fuso negativo (o nosso)
// os getters getUTC* e os locais bateriam com o mesmo dia mesmo estando
// errados, e a mutação que remove a proteção não derrubaria nada.
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
              const [ano, mes, dia] = v.split('-').map(Number);
              return new Date(ano, mes - 1, dia);
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
    getMaxRows: () => Math.max(linhas.length, 1000),
    getRange: (l, c, nl, nc) => faixa(l, nl),
    appendRow: (l) => { linhas.push(l); },
    // Escreve uma linha IGNORANDO qualquer formato de célula, para simular o
    // que uma gravação torta deixaria na planilha (sem setNumberFormat('@')
    // antes de setValues) -- o mesmo mecanismo que
    // apps-script-alocacao.test.js usa para provar que a LEITURA (normalizarDia)
    // também precisa estar correta, independente de a escrita proteger ou não.
    // Não existe no Sheet de verdade -- é porta dos fundos só do dublê.
    __injetarLinhaCrua(valores) {
      const [ano, mes, dia] = String(valores[1]).split('-').map(Number);
      linhas.push(valores.map((v, i) => (i === 1 ? new Date(ano, mes - 1, dia) : v)));
    },
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

test('doPost grava a SemanaInicio como STRING na celula, nunca como Date', () => {
  // Espelho do teste de leitura acima, mas para o cinto de ESCRITA: inspeciona
  // DIRETO o array interno do dublê (sem passar por doGet/normalizarDia), então
  // este teste só morde se setNumberFormat('@') estiver de fato protegendo a
  // gravação -- normalizarDia estar correto na leitura não ajuda em nada aqui.
  const duble = criarSheetsDuble();
  const ctx = carregarScript(duble);
  ctx.doPost({ postData: { contents: JSON.stringify({
    token: TOKEN_BOM, chaveSegunda: '2026-08-31', autor: 'teste', congeladoEm: '2026-08-28T22:00:00Z',
    linhas: [{ chave: '2026-08-31', chaveMatriz: 'SUP-1||SP', volume: 10, financeiro: 20, equipe: 2, produtividadeMedia: 5 }],
  }) } });

  const linhaGravada = duble.linhas[duble.linhas.length - 1];
  assert.equal(typeof linhaGravada[1], 'string', 'a coluna SemanaInicio tem de ser gravada como string, nunca coagida a Date');
  assert.equal(linhaGravada[1], '2026-08-31');
});

test('a leitura cura linha já gravada como Date (sem proteção de texto), no fuso da planilha', () => {
  // Isola o `normalizarDia` do resto do doPost: injeta uma linha JÁ coagida a
  // Date (como uma gravação antiga, sem setNumberFormat('@'), teria deixado
  // na planilha), sem passar pelo caminho de escrita do script. Se
  // normalizarDia usar `instanceof Date` (falha ao atravessar o sandbox `vm`,
  // que é outro realm) ou getters UTC (dia errado num fuso positivo), esta
  // linha nunca é encontrada na releitura -- é a MESMA armadilha do
  // apps-script-alocacao.gs, mordida em 2026-08-11.
  const duble = criarSheetsDuble();
  const ctx = carregarScript(duble);
  duble.aba.__injetarLinhaCrua(['2026', '2026-08-31', 'SUP-2||ST', 5, 15, 1, 5, 'antigo', '2026-08-20T00:00:00Z']);

  const lido = corpoDe(ctx.doGet({ parameter: { semana: '2026-08-31', token: TOKEN_BOM } }));
  assert.equal(lido.linhas.length, 1, 'a linha gravada como Date tem de ser encontrada na releitura');
  assert.equal(lido.linhas[0].chaveMatriz, 'SUP-2||ST');
});

test('token errado e recusado na leitura e na escrita', () => {
  const duble = criarSheetsDuble();
  const ctx = carregarScript(duble);
  assert.equal(corpoDe(ctx.doGet({ parameter: { semana: '2026-08-31', token: 'errado' } })).erro, 'token');
  assert.equal(corpoDe(ctx.doPost({ postData: { contents: JSON.stringify({
    token: 'errado', chaveSegunda: '2026-08-31', linhas: [],
  }) } })).erro, 'token');
});
