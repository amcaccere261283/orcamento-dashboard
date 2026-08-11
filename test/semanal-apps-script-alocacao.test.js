'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// O Apps Script da alocação (tools/semanal/apps-script-alocacao.gs) não era
// exercitado por teste nenhum -- ele roda no Google, não no Node, então ficava
// fora da suíte por construção. O preço apareceu em 2026-08-11, no dia de
// ligar o modo Sheet: o script gravava e RELIA VAZIO, porque o Sheets coage
// '2026-08-10' para Date e String(Date) nunca é igual à string ISO. Como
// chaveSemana() sempre monta ano + '|' + YYYY-MM-DD, TODO arrasto seria
// perdido, sem erro na tela.
//
// Este arquivo carrega o .gs em um sandbox com um SpreadsheetApp falso, e o
// falso IMITA A COERÇÃO -- é isso que dá valor ao teste. Um dublê que guardasse
// strings ingenuamente passaria com o bug presente e não teria pego nada.
const CAMINHO_GS = path.join(__dirname, '..', 'tools', 'semanal', 'apps-script-alocacao.gs');

// Reproduz o que o Sheets faz numa célula SEM formato de texto: 'YYYY-MM-DD'
// vira Date; '2026' vira número; o resto fica string. É o comportamento que
// quebrou em produção, medido contra a planilha real.
const RE_ISO = /^\d{4}-\d{2}-\d{2}$/;
function coagirComoSheets(valor, formatoTexto) {
  if (formatoTexto) return valor;
  if (typeof valor === 'string' && RE_ISO.test(valor)) {
    const [ano, mes, dia] = valor.split('-').map(Number);
    return new Date(ano, mes - 1, dia);
  }
  if (typeof valor === 'string' && /^\d+$/.test(valor)) return Number(valor);
  return valor;
}

function criarPlanilhaFalsa() {
  const abas = new Map();

  function criarAba(nome) {
    const celulas = [];
    const formatoTexto = [];
    const aba = {
      nome,
      getMaxRows: () => Math.max(celulas.length, 1000),
      getLastRow: () => celulas.length,
      getDataRange: () => ({
        getValues: () => celulas.map(l => l.slice()),
      }),
      getRange(linha, coluna, nLinhas, nColunas) {
        return {
          setNumberFormat(formato) {
            for (let r = linha; r < linha + nLinhas; r++) {
              formatoTexto[r] = formatoTexto[r] || [];
              for (let c = coluna; c < coluna + nColunas; c++) formatoTexto[r][c] = formato === '@';
            }
            return this;
          },
          setValues(valores) {
            for (let r = 0; r < nLinhas; r++) {
              const alvo = linha + r - 1;
              while (celulas.length <= alvo) celulas.push([]);
              for (let c = 0; c < nColunas; c++) {
                const ehTexto = !!(formatoTexto[linha + r] && formatoTexto[linha + r][coluna + c]);
                celulas[alvo][coluna + c - 1] = coagirComoSheets(valores[r][c], ehTexto);
              }
            }
            return this;
          },
        };
      },
      appendRow(valores) {
        aba.getRange(celulas.length + 1, 1, 1, valores.length).setValues([valores]);
      },
      // Escreve IGNORANDO o formato da célula, para simular o que a versão
      // anterior do .gs deixou gravado: ela usava appendRow sem formatar nada,
      // então o Sheets coagia a data. Não existe no objeto Sheet de verdade --
      // é uma porta dos fundos só do dublê, e por isso tem nome feio.
      __injetarLinhaCrua(valores) {
        celulas.push(valores.map(v => coagirComoSheets(v, false)));
      },
    };
    return aba;
  }

  return {
    getSheetByName: nome => abas.get(nome) || null,
    insertSheet(nome) {
      const aba = criarAba(nome);
      abas.set(nome, aba);
      return aba;
    },
  };
}

function carregarScript() {
  const planilha = criarPlanilhaFalsa();
  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => planilha },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: texto => ({
        texto,
        setMimeType() { return this; },
      }),
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(CAMINHO_GS, 'utf8'), sandbox, { filename: CAMINHO_GS });
  return {
    sandbox,
    get: chave => JSON.parse(sandbox.doGet({ parameter: { semana: chave } }).texto),
    post: corpo => JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify(corpo) } }).texto),
  };
}

// A chave real que alocacao-sheet.js produz: chaveSemana(2026, epoch) devolve
// exatamente este formato. Usar outra coisa aqui tiraria o sentido do teste --
// é o YYYY-MM-DD que dispara a coerção.
const CHAVE = '2026|2026-08-10';

test('o .gs compila e expõe doGet/doPost', () => {
  const { sandbox } = carregarScript();
  assert.strictEqual(typeof sandbox.doGet, 'function');
  assert.strictEqual(typeof sandbox.doPost, 'function');
});

test('uma alocação gravada volta na leitura -- a semana é data ISO', () => {
  // O teste que estava faltando. Confirmado RED contra a versão anterior do
  // .gs: ela devolvia { linhas: [] } aqui, exatamente como a planilha real.
  const s = carregarScript();
  const escrita = s.post({
    chaveSemana: CHAVE, equipeId: 'EQ-1', sup: 'CCR RioSP',
    coluna: 'SP', autor: 'teste', atualizadoEm: '2026-08-11T11:00:00.000Z',
  });
  assert.strictEqual(escrita.ok, true);
  assert.deepStrictEqual(escrita.linhas.map(l => l.equipeId), ['EQ-1'],
    'o doPost relê a semana antes de responder -- vazio aqui é o sintoma do bug de coerção');

  const leitura = s.get(CHAVE);
  assert.strictEqual(leitura.linhas.length, 1);
  assert.strictEqual(leitura.linhas[0].sup, 'CCR RioSP');
  assert.strictEqual(leitura.linhas[0].coluna, 'SP');
});

test('a leitura cura linha já gravada como Date pela versão anterior', () => {
  // Quem implantou o .gs antes da correção tem linhas com Date na coluna B.
  // Elas têm que voltar a aparecer, senão a correção só serve para dado novo e
  // o histórico fica órfão na planilha.
  const s = carregarScript();
  const planilha = s.sandbox.SpreadsheetApp.getActiveSpreadsheet();
  s.post({ chaveSemana: CHAVE, equipeId: 'EQ-NOVA', sup: 'SUP-B', coluna: 'SP' });

  // Escreve à moda antiga: SEM formato de texto, deixando o falso coagir.
  const aba = planilha.getSheetByName('ALOCACAO');
  aba.__injetarLinhaCrua(['2026', '2026-08-10', 'EQ-ANTIGA', 'SUP-A', 'ST', 'alguem', 'x']);
  const bruto = aba.getDataRange().getValues();
  const linhaAntiga = bruto[bruto.length - 1];
  assert.strictEqual(Object.prototype.toString.call(linhaAntiga[1]), '[object Date]',
    'o dublê tem que ter coagido -- se não coagiu, este teste não está testando nada');

  const ids = s.get(CHAVE).linhas.map(l => l.equipeId).sort();
  assert.deepStrictEqual(ids, ['EQ-ANTIGA', 'EQ-NOVA']);
});

test('regravar a mesma equipe na mesma semana atualiza, não duplica', () => {
  const s = carregarScript();
  s.post({ chaveSemana: CHAVE, equipeId: 'EQ-1', sup: 'SUP-A', coluna: 'SP' });
  s.post({ chaveSemana: CHAVE, equipeId: 'EQ-1', sup: 'SUP-B', coluna: 'ST' });

  const linhas = s.get(CHAVE).linhas;
  assert.strictEqual(linhas.length, 1, 'o upsert é por (ano, semanaInicio, equipeId)');
  assert.strictEqual(linhas[0].sup, 'SUP-B');
  assert.strictEqual(linhas[0].coluna, 'ST');
});

test('gravar com sup vazio tira a equipe do quadro', () => {
  // É assim que o cliente desaloca: aplicarLocal faz delete quando !sup, e o
  // lado da planilha responde sumindo com a linha na leitura.
  const s = carregarScript();
  s.post({ chaveSemana: CHAVE, equipeId: 'EQ-1', sup: 'SUP-A', coluna: 'SP' });
  assert.strictEqual(s.get(CHAVE).linhas.length, 1);

  s.post({ chaveSemana: CHAVE, equipeId: 'EQ-1', sup: '', coluna: '' });
  assert.strictEqual(s.get(CHAVE).linhas.length, 0);
});

test('semanas diferentes não se enxergam', () => {
  const s = carregarScript();
  s.post({ chaveSemana: '2026|2026-08-10', equipeId: 'EQ-1', sup: 'SUP-A', coluna: 'SP' });
  s.post({ chaveSemana: '2026|2026-08-17', equipeId: 'EQ-2', sup: 'SUP-B', coluna: 'ST' });

  assert.deepStrictEqual(s.get('2026|2026-08-10').linhas.map(l => l.equipeId), ['EQ-1']);
  assert.deepStrictEqual(s.get('2026|2026-08-17').linhas.map(l => l.equipeId), ['EQ-2']);
});

test('semana desconhecida devolve lista vazia, não erro', () => {
  const s = carregarScript();
  assert.deepStrictEqual(s.get('2026|2026-12-28').linhas, []);
  assert.deepStrictEqual(s.get('').linhas, []);
});
