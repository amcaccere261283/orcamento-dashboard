# Avanços Online Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the local `Avanço Sond.xlsx` file as the source of "Realizado"
(furos de sondagem) for the Planejamento Semanal with a script that fetches the same
data online, per active contract, from sond.com.br — feeding both the Node build and
the page's "Atualizar dados" live-refresh button.

**Architecture:** A new fetch script enumerates the 83 active contratos financeiros via
two internal Sond endpoints, downloads each contract's Avanço Sondagens export via CDP
(one Chrome tab reused for all fetches), and combines them into a single CSV file
shaped exactly like the existing "Avanços" sheet mirror. Both consumers
(`build-dashboard.js` and the browser's live-refresh button) already know how to turn
that CSV shape into `furos` via `parseCsvGrid` + `parseAvancos` — neither of those two
functions changes at all.

**Tech Stack:** Node.js (same project conventions: no npm dependencies, custom
zip/xlsx reader in `tools/comum/`), CDP over raw WebSocket (same technique built for
the sibling "Controle Diário Sond" project, written fresh here — this project doesn't
share code with that one either), Google Chrome with `--remote-debugging-port=9222`.

## Global Constraints

- No npm dependencies — plain Node.js only, consistent with the rest of this repo.
- Browser for CDP: **Google Chrome** (not Brave) — `--remote-debugging-port=9222`,
  already confirmed working and logged into sond.com.br on this machine.
- `parse-avancos.js`, `parseCsvGrid` (`tools/semanal/parse-matriz-cliente.js`),
  `compute-demandas.js`, and every other downstream module are **not modified** —
  the whole design exists specifically to avoid touching them.
- "Contratos ativos" = the result of
  `financeiro/get_tomadoras_contrato_financeiro_ativo_by_prestadora/prestador/1/` →
  for each `tomadora_id`,
  `financeiro/get_contratos_financeiro_ativo_vigencia_indiferente_empresa_tomadora_by_prestadora/tomador/{id}/prestador/1/`.
  Confirmed live 2026-08-05: 54 tomadoras, 83 contratos.
- Per-contract export URL:
  `https://sond.com.br/avanco-sondagens-excel/tomador/{tomadorId}/contrato-financeiro/{contratoId}/`.
- The combined CSV's header comes from the first contract downloaded (all contracts
  share the same export template/column order) — see spec for the row-indexing
  detail (per-contract export has header at row 1; the original `Avanço Sond.xlsx`
  has it at row 2 — this is why downstream consumers already do `grid.unshift(null)`
  before calling `parseAvancos`, and this plan's combined CSV is written in the
  header-at-row-1 shape to match that existing convention exactly).
- Design spec: `docs/superpowers/specs/2026-08-05-avancos-online-design.md`.

---

### Task 1: `readXlsxSheetFromBuffer` — read an xlsx already in memory

**Files:**
- Modify: `tools/comum/xlsx-reader.js`
- Test: `test/comum-xlsx-reader-buffer.test.js`

**Interfaces:**
- Produces: `readXlsxSheetFromBuffer(buffer: Buffer, sheetName: string): Array<Array<string>>`
  — used by Task 3. `readXlsxSheet(filePath, sheetName)` keeps its existing signature,
  now implemented as `readXlsxSheetFromBuffer(fs.readFileSync(filePath), sheetName)`.

- [ ] **Step 1: Write the failing test**

Create `test/comum-xlsx-reader-buffer.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readXlsxSheetFromBuffer } = require('../tools/comum/xlsx-reader.js');
const { buildMinimalZip } = require('./helpers/build-zip.js');

function buildTestXlsxBuffer({ sheetNames, activeSheetRows }) {
  const workbookXml = '<?xml version="1.0"?><workbook xmlns:r="rels">' +
    '<sheets>' + sheetNames.map((name, i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
    '</sheets></workbook>';
  const relsXml = '<?xml version="1.0"?><Relationships>' +
    sheetNames.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    '</Relationships>';
  const sharedStringsXml = '<sst><si><t>Contrato</t></si></sst>';
  const sheetXml = `<worksheet><sheetData>${activeSheetRows}</sheetData></worksheet>`;

  const entries = [
    { name: 'xl/workbook.xml', data: Buffer.from(workbookXml, 'utf8'), method: 0 },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(relsXml, 'utf8'), method: 0 },
    { name: 'xl/sharedStrings.xml', data: Buffer.from(sharedStringsXml, 'utf8'), method: 0 },
  ];
  sheetNames.forEach((_, i) => {
    entries.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: Buffer.from(i === 0 ? sheetXml : '<worksheet><sheetData/></worksheet>', 'utf8'), method: 0 });
  });
  return buildMinimalZip(entries);
}

test('readXlsxSheetFromBuffer reads a sheet directly from an in-memory buffer, no disk', () => {
  const buffer = buildTestXlsxBuffer({
    sheetNames: ['Worksheet'],
    activeSheetRows: '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="str"><v>SUP-0001-24</v></c></row>',
  });
  const grid = readXlsxSheetFromBuffer(buffer, 'Worksheet');
  assert.equal(grid[0][0], 'Contrato');
  assert.equal(grid[0][1], 'SUP-0001-24');
});

test('readXlsxSheetFromBuffer throws a clear error when the sheet name does not exist', () => {
  const buffer = buildTestXlsxBuffer({ sheetNames: ['Worksheet'], activeSheetRows: '' });
  assert.throws(
    () => readXlsxSheetFromBuffer(buffer, 'AbaQueNaoExiste'),
    /Sheet "AbaQueNaoExiste" not found/
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/comum-xlsx-reader-buffer.test.js`
Expected: FAIL — `readXlsxSheetFromBuffer is not a function`

- [ ] **Step 3: Implement — extract the buffer-based function**

In `tools/comum/xlsx-reader.js`, replace the body of `readXlsxSheet` so the buffer
logic lives in a new exported function, and `readXlsxSheet` becomes a one-line wrapper:

```js
// Lê uma aba pelo nome de um .xlsx JÁ EM MEMÓRIA (buffer) e devolve sua grade
// de células (ver xlsx-cells.js). Só lê valores em cache (<v>) -- nunca avalia
// fórmula. Extraída de readXlsxSheet (abaixo) para servir também a fontes que
// não têm arquivo em disco (ex.: um .xlsx baixado ao vivo via fetch).
function readXlsxSheetFromBuffer(buffer, sheetName) {
  const zipEntries = listZipEntries(buffer);

  const workbookEntry = zipEntries.get('xl/workbook.xml');
  if (!workbookEntry) throw new Error('Buffer is not a valid .xlsx file (missing xl/workbook.xml)');
  const workbookXml = readZipEntry(buffer, workbookEntry).toString('utf8');
  const sheets = parseWorkbookSheets(workbookXml);
  const sheetMeta = sheets.find(s => s.name === sheetName);
  if (!sheetMeta) {
    const available = sheets.map(s => s.name).join(', ');
    throw new Error(`Sheet "${sheetName}" not found. Available sheets: ${available}`);
  }

  const relsEntry = zipEntries.get('xl/_rels/workbook.xml.rels');
  const relsXml = readZipEntry(buffer, relsEntry).toString('utf8');
  const relTargets = parseWorkbookRels(relsXml);
  const target = relTargets.get(sheetMeta.rId);
  if (!target) throw new Error(`No relationship target found for sheet "${sheetName}" (r:id ${sheetMeta.rId})`);

  const sheetPath = `xl/${target}`;
  const sheetEntry = zipEntries.get(sheetPath);
  if (!sheetEntry) throw new Error(`Worksheet part ${sheetPath} not found`);
  const sheetXml = readZipEntry(buffer, sheetEntry).toString('utf8');

  const sharedStringsEntry = zipEntries.get('xl/sharedStrings.xml');
  const sharedStrings = sharedStringsEntry
    ? parseSharedStrings(readZipEntry(buffer, sharedStringsEntry).toString('utf8'))
    : [];

  return parseSheetGrid(sheetXml, sharedStrings);
}

// Lê uma aba pelo nome de um .xlsx NO DISCO -- wrapper fino sobre
// readXlsxSheetFromBuffer. Mensagens de erro daqui incluem o caminho (a
// versão buffer não tem caminho pra incluir).
function readXlsxSheet(filePath, sheetName) {
  let buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch (err) {
    throw new Error(`${filePath}: ${err.message}`);
  }
  try {
    return readXlsxSheetFromBuffer(buffer, sheetName);
  } catch (err) {
    throw new Error(`${filePath}: ${err.message}`);
  }
}
```

Update the module's final export line:

```js
module.exports = { readXlsxSheet, readXlsxSheetFromBuffer, parseWorkbookSheets, parseWorkbookRels };
```

- [ ] **Step 4: Run the new test to verify it passes**

Run: `node --test test/comum-xlsx-reader-buffer.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full existing suite to confirm no regression**

Run: `node --test test/*.test.js`
Expected: same pass count as before this change, plus the 2 new tests (760 + 2 = 762
tests, 0 failures). `readXlsxSheet`'s error messages now get a `${filePath}: ` prefix
from the wrapper — confirmed during planning that the one existing test asserting on
an error message (`test/orcamento-xlsx-reader.test.js:53`,
`assert.throws(..., /Available sheets: Outra aba, MATRIZ/)`) uses an unanchored
regex that still matches the new prefixed message, so no test changes are needed
here.

- [ ] **Step 6: Commit**

```bash
git add tools/comum/xlsx-reader.js test/comum-xlsx-reader-buffer.test.js
git commit -m "Extract readXlsxSheetFromBuffer for in-memory xlsx sources"
```

---

### Task 2: CSV writer for the combined Avanços grid

**Files:**
- Create: `tools/semanal/csv-writer-avancos.js`
- Test: `test/semanal-csv-writer-avancos.test.js`

**Interfaces:**
- Consumes: `parseCsvGrid` from `tools/semanal/parse-matriz-cliente.js` (for the
  round-trip test only).
- Produces: `gridParaCsv(grid: Array<Array<string>>): string` — used by Task 3.

- [ ] **Step 1: Write the failing test**

Create `test/semanal-csv-writer-avancos.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { gridParaCsv } = require('../tools/semanal/csv-writer-avancos.js');
const { parseCsvGrid } = require('../tools/semanal/parse-matriz-cliente.js');

test('gridParaCsv joins cells with commas and rows with \\n', () => {
  const csv = gridParaCsv([['Contrato', 'Status'], ['SUP-0001-24', 'CONCLUIDO']]);
  assert.equal(csv, 'Contrato,Status\nSUP-0001-24,CONCLUIDO\n');
});

test('gridParaCsv quotes a cell containing a comma', () => {
  const csv = gridParaCsv([['Obra'], ['Rodovia BR-277, km 158']]);
  assert.equal(csv, 'Obra\n"Rodovia BR-277, km 158"\n');
});

test('gridParaCsv quotes a cell containing a double quote, doubling it', () => {
  const csv = gridParaCsv([['Observações'], ['Trecho "impenetrável" a 12m']]);
  assert.equal(csv, 'Observações\n"Trecho ""impenetrável"" a 12m"\n');
});

test('gridParaCsv quotes a cell containing a newline', () => {
  const csv = gridParaCsv([['Observações'], ['linha um\nlinha dois']]);
  assert.equal(csv, 'Observações\n"linha um\nlinha dois"\n');
});

test('gridParaCsv treats null/undefined cells as empty', () => {
  const csv = gridParaCsv([['A', 'B'], [null, undefined]]);
  assert.equal(csv, 'A,B\n,\n');
});

test('round-trips through parseCsvGrid unchanged for realistic data', () => {
  const original = [
    ['Contrato', 'Tomador', 'Obra', 'Status', 'Observações de Campo'],
    ['SUP-7133-24', 'Via Araucária S.A', 'BR-277, km 158', 'CONCLUIDO', 'Deslocamento "A", conforme relato'],
    ['SUP-6806-23', 'CCR MSVia', 'Trecho normal', 'PENDENTE', ''],
  ];
  const csv = gridParaCsv(original);
  const roundtripped = parseCsvGrid(csv);
  assert.deepEqual(roundtripped, original);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/semanal-csv-writer-avancos.test.js`
Expected: FAIL — `Cannot find module '../tools/semanal/csv-writer-avancos.js'`

- [ ] **Step 3: Implement `tools/semanal/csv-writer-avancos.js`**

```js
'use strict';

// Serializa uma grade (array de arrays de string) pra texto CSV, no mesmo
// dialeto que parseCsvGrid (tools/semanal/parse-matriz-cliente.js) já lê --
// aspas quando o valor tem vírgula, aspas ou quebra de linha; aspas internas
// dobradas. Usado pra publicar o CSV combinado de Avanços (ver
// tools/semanal/atualizar-avancos-online.js) no mesmo formato que o CSV
// publicado pela Sheet espelho antiga, pra não precisar mudar quem consome
// (parseCsvGrid + parseAvancos, tanto no build quanto no botão "Atualizar
// dados").
const RE_PRECISA_ASPAS = /[",\n]/;

function celulaCsv(valor) {
  const texto = valor === null || valor === undefined ? '' : String(valor);
  if (!RE_PRECISA_ASPAS.test(texto)) return texto;
  return '"' + texto.replace(/"/g, '""') + '"';
}

function gridParaCsv(grid) {
  return grid.map((linha) => linha.map(celulaCsv).join(',')).join('\n') + '\n';
}

module.exports = { gridParaCsv };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/semanal-csv-writer-avancos.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/csv-writer-avancos.js test/semanal-csv-writer-avancos.test.js
git commit -m "Add CSV writer for the combined Avancos grid"
```

---

### Task 3: Fetch script — enumerate active contracts, download, combine

**Files:**
- Create: `tools/semanal/cdp-client.js` (written fresh for this project — do not
  require or copy from any other project's `cdp-client.js`, including the sibling
  "Controle Diário Sond" repo; same protocol, independently written code)
- Create: `tools/semanal/atualizar-avancos-online.js`
- Test: `test/semanal-combinar-grades-avancos.test.js`

**Interfaces:**
- Consumes: `readXlsxSheetFromBuffer` (Task 1), `gridParaCsv` (Task 2).
- Produces: `combinarGradesAvancos(grades: Array<Array<Array<string>>>): {grid: Array<Array<string>>, avisos: string[]}`
  — the pure, testable combining logic, used by `main()` in the same file. Also
  produces the CDP helpers (`abrirSessao`, `fecharSessao`, `checarConexao`,
  `fetchJson`, `fetchBuffer`) used only by `main()` (no unit tests — same rationale as
  Controle Diário Sond's `cdp-client.js`: pure I/O, verified by a live run instead).

`tools/semanal/cdp-client.js` is a **new, independent implementation** — this project
does not import code from other projects on this machine. It only needs a subset of
what Controle Diário Sond's version has (no DataTable-scraping helper is needed here,
since these are plain `fetch()` calls, not scraped HTML tables):

- [ ] **Step 1: Implement `tools/semanal/cdp-client.js`**

```js
'use strict';

// Cliente minimo para o Chrome DevTools Protocol (CDP), conectando num
// Chrome ja aberto com --remote-debugging-port (sessao/cookies reaproveitados,
// nenhuma senha e guardada em lugar nenhum). Escrito do zero para este
// projeto -- so usa `fetch`/`WebSocket` globais do Node.

const CDP_PORT = 9222;

async function cdpGetJson(pathname, options = {}) {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}${pathname}`, options);
  if (!res.ok) throw new Error(`CDP HTTP ${pathname} falhou: ${res.status}`);
  return res.json();
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function mensagemErroWs(e) {
  return (e && e.error && e.error.message) || (e && e.message) || 'erro desconhecido';
}

class CdpSession {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        clearTimeout(timer);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || 'Erro CDP'));
        else resolve(msg.result);
      }
    });
    const rejeitarPendentes = (motivo) => {
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error('Sessao CDP encerrada: ' + motivo));
      }
      this.pending.clear();
    };
    this.ws.addEventListener('close', () => rejeitarPendentes('conexao fechada'));
    this.ws.addEventListener('error', (e) => rejeitarPendentes(mensagemErroWs(e)));
  }

  waitOpen() {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true });
      this.ws.addEventListener('error', (e) => reject(new Error('WebSocket: ' + mensagemErroWs(e))), { once: true });
    });
  }

  send(method, params = {}, timeoutMs = 30000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} sem resposta em ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, timeoutMs = 30000) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
    if (result.exceptionDetails) {
      const desc = result.exceptionDetails.exception && result.exceptionDetails.exception.description;
      throw new Error('Erro ao executar no navegador: ' + (desc || JSON.stringify(result.exceptionDetails)));
    }
    return result.result.value;
  }

  close() {
    try { this.ws.close(); } catch { /* ignore */ }
  }
}

async function abrirSessao(url) {
  const target = await cdpGetJson(`/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  const session = new CdpSession(target.webSocketDebuggerUrl);
  await session.waitOpen();
  await session.send('Page.enable');
  await session.send('Runtime.enable');
  await sleep(3000);
  return { session, target };
}

async function fecharSessao(session, target) {
  session.close();
  try { await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${target.id}`); } catch { /* ignore */ }
}

async function checarConexao() {
  await cdpGetJson('/json/version');
}

// Busca um endpoint JSON no contexto da PAGINA (sessao logada) e devolve
// ja parseado.
async function fetchJson(session, urlPath) {
  const raw = await session.evaluate(`fetch(${JSON.stringify(urlPath)}).then(r => r.text())`);
  return JSON.parse(raw);
}

// Baixa um arquivo binario (o .xlsx de um contrato) no contexto da pagina e
// devolve um Buffer do Node.
async function fetchBuffer(session, urlPath) {
  const base64 = await session.evaluate(`
    (async () => {
      const res = await fetch(${JSON.stringify(urlPath)});
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      return btoa(binary);
    })()
  `, 60000);
  return Buffer.from(base64, 'base64');
}

module.exports = { abrirSessao, fecharSessao, checarConexao, fetchJson, fetchBuffer };
```

- [ ] **Step 2: Write the failing test for the pure combining logic**

Create `test/semanal-combinar-grades-avancos.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { combinarGradesAvancos } = require('../tools/semanal/atualizar-avancos-online.js');

test('combinarGradesAvancos usa o cabecalho do primeiro contrato e junta as linhas de dado de todos', () => {
  const contrato1 = [
    ['Contrato', 'Status'],
    ['SUP-0001-24', 'CONCLUIDO'],
    ['SUP-0001-24', 'PENDENTE'],
  ];
  const contrato2 = [
    ['Contrato', 'Status'],
    ['SUP-0002-24', 'EXECUTADO'],
  ];
  const { grid, avisos } = combinarGradesAvancos([contrato1, contrato2]);
  assert.deepEqual(grid, [
    ['Contrato', 'Status'],
    ['SUP-0001-24', 'CONCLUIDO'],
    ['SUP-0001-24', 'PENDENTE'],
    ['SUP-0002-24', 'EXECUTADO'],
  ]);
  assert.deepEqual(avisos, []);
});

test('combinarGradesAvancos avisa (sem abortar) quando um contrato tem cabecalho diferente do primeiro', () => {
  const contrato1 = [['Contrato', 'Status'], ['SUP-0001-24', 'CONCLUIDO']];
  const contrato2 = [['Contrato', 'Situacao'], ['SUP-0002-24', 'EXECUTADO']];
  const { grid, avisos } = combinarGradesAvancos([contrato1, contrato2]);
  assert.equal(grid.length, 3); // cabecalho + 2 linhas de dado, mesmo com o aviso
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /cabeçalho diferente/);
});

test('combinarGradesAvancos lida com contrato sem nenhuma linha de dado (so cabecalho)', () => {
  const contrato1 = [['Contrato', 'Status'], ['SUP-0001-24', 'CONCLUIDO']];
  const contrato2 = [['Contrato', 'Status']];
  const { grid } = combinarGradesAvancos([contrato1, contrato2]);
  assert.deepEqual(grid, [['Contrato', 'Status'], ['SUP-0001-24', 'CONCLUIDO']]);
});

test('combinarGradesAvancos lanca erro claro se a lista de grades vier vazia', () => {
  assert.throws(() => combinarGradesAvancos([]), /nenhum contrato baixado/);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test test/semanal-combinar-grades-avancos.test.js`
Expected: FAIL — `Cannot find module '../tools/semanal/atualizar-avancos-online.js'`

- [ ] **Step 4: Implement `tools/semanal/atualizar-avancos-online.js`**

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { readXlsxSheetFromBuffer } = require('../comum/xlsx-reader.js');
const { gridParaCsv } = require('./csv-writer-avancos.js');
const cdp = require('./cdp-client.js');

const SITE_ORIGIN = 'https://sond.com.br';
const OUT_PATH = path.join(__dirname, '..', '..', 'dist', 'avancos-online.csv');

// Junta as grades (uma por contrato, cada uma já no formato "cabeçalho na
// linha 0" que readXlsxSheetFromBuffer devolve) numa só: cabeçalho do
// PRIMEIRO contrato baixado, seguido das linhas de dado (índice 1 em diante)
// de TODOS os contratos, na ordem em que vieram. Não aborta se algum
// contrato tiver cabeçalho diferente (mesmo template de tela pra todos, mas
// se algum vier diferente é melhor avisar e seguir do que travar a
// atualização inteira por causa de um contrato só) -- ver
// docs/superpowers/specs/2026-08-05-avancos-online-design.md.
function combinarGradesAvancos(grades) {
  if (!grades.length) throw new Error('combinarGradesAvancos: nenhum contrato baixado.');

  const cabecalho = grades[0][0] || [];
  const avisos = [];
  const linhas = [cabecalho];

  grades.forEach((grade, i) => {
    const cabecalhoAtual = grade[0] || [];
    if (i > 0 && cabecalhoAtual.join('|') !== cabecalho.join('|')) {
      avisos.push(`Contrato de índice ${i} tem cabeçalho diferente do primeiro contrato -- usando o cabeçalho do primeiro mesmo assim.`);
    }
    for (let r = 1; r < grade.length; r++) {
      linhas.push(grade[r]);
    }
  });

  return { grid: linhas, avisos };
}

async function buscarContratosAtivos(session) {
  const tomadoras = await cdp.fetchJson(session, '/financeiro/get_tomadoras_contrato_financeiro_ativo_by_prestadora/prestador/1/');
  const contratos = [];
  for (const t of tomadoras) {
    const lista = await cdp.fetchJson(
      session,
      `/financeiro/get_contratos_financeiro_ativo_vigencia_indiferente_empresa_tomadora_by_prestadora/tomador/${t.tomadora_id}/prestador/1/`
    );
    for (const c of lista) {
      contratos.push({ tomadoraId: t.tomadora_id, tomadoraNome: t.tomadora_nome, contratoId: c.id, sup: c.nome });
    }
  }
  return contratos;
}

async function main() {
  console.log('Checando conexao com o Chrome (CDP)...');
  await cdp.checarConexao();
  const { session, target } = await cdp.abrirSessao(`${SITE_ORIGIN}/avanco-sondagens/`);

  try {
    console.log('Buscando contratos financeiros ativos...');
    const contratos = await buscarContratosAtivos(session);
    console.log(`${contratos.length} contrato(s) ativo(s) encontrado(s). Baixando...`);

    const grades = [];
    const falhas = [];
    for (const [i, c] of contratos.entries()) {
      try {
        const buffer = await cdp.fetchBuffer(session, `/avanco-sondagens-excel/tomador/${c.tomadoraId}/contrato-financeiro/${c.contratoId}/`);
        const grid = readXlsxSheetFromBuffer(buffer, 'Worksheet');
        grades.push(grid);
        console.log(`  [${i + 1}/${contratos.length}] ${c.sup}: ${grid.length - 1} linha(s)`);
      } catch (err) {
        falhas.push({ sup: c.sup, erro: err.message });
        console.warn(`  [${i + 1}/${contratos.length}] ${c.sup}: FALHOU -- ${err.message}`);
      }
    }

    if (!grades.length) {
      throw new Error('Nenhum dos contratos foi baixado com sucesso -- abortando sem gravar (ver falhas acima).');
    }

    const { grid, avisos } = combinarGradesAvancos(grades);
    avisos.forEach((a) => console.warn(`AVISO: ${a}`));

    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, gridParaCsv(grid), 'utf8');

    const totalFuros = grid.length - 1;
    console.log(
      `Pronto: ${grades.length}/${contratos.length} contrato(s) baixado(s) com sucesso, ` +
      `${totalFuros} linha(s) de furo combinadas, gravado em ${OUT_PATH}.`
    );
    if (falhas.length) {
      console.warn(`${falhas.length} contrato(s) falharam e ficaram DE FORA deste CSV: ${falhas.map((f) => f.sup).join(', ')}`);
    }
  } finally {
    await cdp.fecharSessao(session, target);
  }
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { combinarGradesAvancos, main };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/semanal-combinar-grades-avancos.test.js`
Expected: PASS (4 tests)

- [ ] **Step 6: Manual smoke test against the real site**

With Chrome open at the debug port and logged in (already confirmed working):

```bash
node tools/semanal/atualizar-avancos-online.js
```

Expected: prints progress for ~83 contracts, ends with a `Pronto:` line, and creates
`dist/avancos-online.csv`. This is a real, several-minute run (83 sequential
downloads through one reused tab) — let it finish. Confirm:
- `dist/avancos-online.csv` exists and its first line matches the header columns
  `parse-avancos.js` expects (`Contrato`, `Criação da OS`, `Tipo`, `Status`, ... —
  check against `COLUNAS_OBRIGATORIAS` in `tools/semanal/parse-avancos.js`).
- Row count is roughly consistent with the sum of per-contract line counts printed
  during the run.
- If any contracts failed, note which ones in your report — a few transient failures
  are not blocking (the script already continues past them), but if most/all fail
  something is wrong with the session and must be fixed before continuing.

- [ ] **Step 7: Commit**

```bash
git add tools/semanal/cdp-client.js tools/semanal/atualizar-avancos-online.js test/semanal-combinar-grades-avancos.test.js
git commit -m "Add online fetch script for Avancos data (active contracts only)"
```

(Do **not** commit `dist/avancos-online.csv` itself in this task — Task 6 handles
publishing it, after the consumers in Tasks 4-5 are wired up and verified against it.)

---

### Task 4: Wire `build-dashboard.js` to the new CSV

**Files:**
- Modify: `tools/semanal/build-dashboard.js`

**Interfaces:**
- Consumes: `parseCsvGrid` from `./parse-matriz-cliente.js` (already required
  elsewhere in the codebase; add the import here), the existing `parseAvancos`
  (unchanged).

This task has no new automated test — the existing `test/semanal-build-dashboard.test.js`
does not exercise `build()`'s file-reading step at all (it only tests `renderSemanal`/
`baselineParaCliente`/`redirecionarSupsDesconhecidos` with synthetic in-memory data),
so there is nothing to update there. Verification is the real build run in Step 3.

- [ ] **Step 1: Add the import**

In `tools/semanal/build-dashboard.js`, add near the other requires:

```js
const { parseCsvGrid } = require('./parse-matriz-cliente.js');
```

- [ ] **Step 2: Replace the Avanços read step**

Find this block (currently reading the local xlsx):

```js
  let gridAvancos;
  try {
    gridAvancos = readXlsxSheet(configDemandas.caminhoArquivo, configDemandas.nomeAba);
  } catch (err) {
    throw new Error(`Não consegui ler a aba "${configDemandas.nomeAba}" de ${configDemandas.caminhoArquivo} (o Google Drive está montado em G:?). Erro original: ${err.message}`);
  }
  const { furos: furosLidos, descartadas, semDataTermino, cancelamentoIlegivel, deslocamentos } = parseAvancos(gridAvancos);
```

Replace it with:

```js
  // Fonte online (2026-08-05): substitui o Avanço Sond.xlsx local por um CSV
  // combinado dos exports de cada contrato ativo, gerado por
  // tools/semanal/atualizar-avancos-online.js (roda à parte, não a cada
  // build -- ver docs/superpowers/specs/2026-08-05-avancos-online-design.md).
  // O unshift(null) reproduz a mesma diferença de indexação que
  // gridCsvComoXlsx() já trata no navegador (render-semanal.js): o CSV
  // combinado tem cabeçalho na linha 0, mas parseAvancos espera cabeçalho em
  // grid[1] (o formato do .xlsx original, que tem uma linha em branco antes).
  const CAMINHO_AVANCOS_ONLINE = path.join(__dirname, '..', '..', 'dist', 'avancos-online.csv');
  let gridAvancos;
  try {
    const csvTexto = fs.readFileSync(CAMINHO_AVANCOS_ONLINE, 'utf8');
    gridAvancos = parseCsvGrid(csvTexto);
    gridAvancos.unshift(null);
  } catch (err) {
    throw new Error(
      `Não consegui ler ${CAMINHO_AVANCOS_ONLINE}. Rode ` +
      `"node tools/semanal/atualizar-avancos-online.js" primeiro (precisa do Chrome ` +
      `aberto com --remote-debugging-port=9222, logado em sond.com.br). Erro original: ${err.message}`
    );
  }
  const { furos: furosLidos, descartadas, semDataTermino, cancelamentoIlegivel, deslocamentos } = parseAvancos(gridAvancos);
```

- [ ] **Step 3: Run the full test suite**

Run: `node --test test/*.test.js`
Expected: same pass count as after Task 2 (no test in this suite exercises this code
path directly, so nothing should change) — this run is a safety net for syntax
errors, not a behavior check.

- [ ] **Step 4: Real build verification (after Task 3's fetch script has produced `dist/avancos-online.csv`)**

```bash
ORCAMENTO_SENHA='qualquer-coisa-para-teste-local' node tools/semanal/build-dashboard.js
```

Expected: build completes, prints the `Demandas: N furos lidos...` log line with a
plausible count (compare against the row count `atualizar-avancos-online.js` reported
in Task 3 Step 6 — should match or be very close, since `descartadas`/`deslocamentos`
are the only rows parseAvancos itself drops). If it throws the "Não consegui ler"
error, confirm `dist/avancos-online.csv` exists from Task 3's run.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/build-dashboard.js
git commit -m "Read Avancos from the online CSV instead of the local G:\ file"
```

---

### Task 5: Wire the "Atualizar dados" button to the published file

**Files:**
- Modify: `tools/semanal/render-semanal.js`

**Interfaces:** none new — this only changes a URL constant and removes now-dead
placeholder-handling logic.

- [ ] **Step 1: Replace the URL constant**

Find:

```js
var URL_ESPELHO_AVANCOS_SEMANAL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vS_Lmfr3EG4OwDb8xlc7670XrCXd2VL9vAiCjHeh8sxpLGFHNf_WgbXMGFe33XIKTXxTkaFXo8ls2eR/pub?gid=943230110&single=true&output=csv';
```

Replace with:

```js
// 2026-08-05: trocado do espelho da Sheet (Apps Script copiando o .xlsx do
// Drive) pro CSV combinado publicado junto com a própria página -- gerado
// por tools/semanal/atualizar-avancos-online.js (roda à parte, não a cada
// build). Caminho relativo: mesmo domínio do GitHub Pages, sem CORS, e sem
// depender de um Apps Script rodando em outra conta. Ver
// docs/superpowers/specs/2026-08-05-avancos-online-design.md.
var URL_ESPELHO_AVANCOS_SEMANAL = 'avancos-online.csv';
```

- [ ] **Step 2: Simplify the "PENDENTE" placeholder check**

Find `RE_URL_PENDENTE` and its usage building `avancosLabConfigurados`:

```js
var RE_URL_PENDENTE = /^PENDENTE-/;
```

```js
  var avancosLabConfigurados = !RE_URL_PENDENTE.test(URL_ESPELHO_AVANCOS_SEMANAL)
    && !RE_URL_PENDENTE.test(URL_ESPELHO_LAB_SEMANAL);
```

Leave `RE_URL_PENDENTE` itself and the `URL_ESPELHO_LAB_SEMANAL` half of the check
exactly as-is (Lab is out of scope, still a real Sheet-mirror URL that could still be
a placeholder in some environments) — only Avanços' own URL is now always a real,
same-origin path, so it can never match `RE_URL_PENDENTE`. **Do not delete the
variable or the check** — just leave it; it now always evaluates the Avanços half to
`true`, which is the correct behavior, and touching more than the URL constant here
risks breaking the Lab half unnecessarily. No code change needed beyond Step 1.

- [ ] **Step 3: Confirm existing tests need no changes (already verified during planning)**

`test/semanal-render-semanal-wireup.test.js` has 3 tests that reference
`URL_ESPELHO_AVANCOS_SEMANAL`/`RE_URL_PENDENTE` (lines ~458-643) — all of them
**override** `sandbox.URL_ESPELHO_AVANCOS_SEMANAL` with their own test-scoped value
(e.g. `'PENDENTE-AGUARDANDO-...'` or `'https://exemplo.com/avancos-configurado-teste.csv'`)
before invoking `atualizarDadosAoVivoSemanal()` — none of them assert against the
module's actual default value. Changing the default in Step 1 does not affect these
tests. No test changes needed for this task; this step is just running the suite
(Step 4) as confirmation, not a search-and-fix step.

- [ ] **Step 4: Run the full test suite**

Run: `node --test test/*.test.js`
Expected: passes, with any adjustment from Step 3 applied if needed.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/render-semanal.js
git commit -m "Point the Atualizar-dados button at the published online CSV"
```

---

### Task 6: Publish, retire the old mirror, verify live, update docs

**Files:**
- Modify: `CLAUDE.md`
- Delete: `tools/semanal/apps-script-espelho-avancos.gs`
- Create/update: `dist/avancos-online.csv`, `docs/avancos-online.csv`,
  `dist/planejamento-semanal.html`, `docs/planejamento-semanal.html`

- [ ] **Step 1: Full rebuild with the real fetched data**

If `dist/avancos-online.csv` from Task 3 is more than a few hours old, re-run
`node tools/semanal/atualizar-avancos-online.js` first (Chrome must be open at the
debug port, logged in). Then:

```bash
ORCAMENTO_SENHA='<senha real>' node tools/semanal/build-dashboard.js
cp dist/planejamento-semanal.html docs/planejamento-semanal.html
cp dist/avancos-online.csv docs/avancos-online.csv
```

- [ ] **Step 2: Verify the button live, locally, before publishing**

Serve `docs/` locally and open the page in a real browser (same technique used to
verify the Controle Diário Sond dashboard):

```bash
node -e "
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, 'docs');
http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200);
    res.end(data);
  });
}).listen(4591, () => console.log('up'));
setTimeout(() => process.exit(0), 120000);
" &
```

Open `http://localhost:4591/planejamento-semanal.html`, unlock with the real
password, click "Atualizar dados", and confirm: the status text does not show an
error, and the Tabela Semanal's Realizado numbers update (or at minimum don't error
out) — this proves the same-origin fetch of `avancos-online.csv` actually works from
a browser, not just from Node. Compare row/furo counts against what
`atualizar-avancos-online.js` printed in Task 3 Step 6 as a sanity check.

- [ ] **Step 3: Delete the retired Apps Script mirror file**

```bash
git rm tools/semanal/apps-script-espelho-avancos.gs
```

Note in the commit message that the *live* Apps Script trigger (running every 30 min
on Google's side, in whatever Google account owns that Sheet) is **not** something
this repo can disable remotely — flag this to the user as a manual follow-up (they
need to open that Sheet's Apps Script editor and delete the trigger themselves, or it
keeps running harmlessly-but-pointlessly in the background).

- [ ] **Step 4: Update `CLAUDE.md`**

Add a new section (place it near the existing "Planejamento Semanal" section):

```markdown
## Avanços online (2026-08-05)

A fonte de "Realizado" (furos de sondagem) do Planejamento Semanal deixou de ser o
arquivo local `Avanço Sond.xlsx` e passou a ser buscada direto do sond.com.br, só dos
contratos financeiros ATIVOS (confirmado 2026-08-05: 83 contratos). Ver
`docs/superpowers/specs/2026-08-05-avancos-online-design.md` para o desenho completo.

**Atualizar os dados:**

```bash
node tools/semanal/atualizar-avancos-online.js   # gera dist/avancos-online.csv (~alguns minutos, 83 contratos)
```

Exige o **Google Chrome** (não Brave) aberto com a porta de depuração remota e já
logado em sond.com.br:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
```

Depois de rodar, o build principal (`tools/semanal/build-dashboard.js`) já lê esse
CSV automaticamente. **Sempre** `cp dist/avancos-online.csv docs/avancos-online.csv`
junto com o `cp dist/planejamento-semanal.html docs/planejamento-semanal.html` de
sempre -- o botão "Atualizar dados" da página busca esse CSV publicado (mesmo
domínio, sem CORS), então esquecer essa cópia deixa o botão buscando uma versão
desatualizada mesmo depois de reconstruir a página.

**O mecanismo antigo foi aposentado**: `tools/semanal/apps-script-espelho-avancos.gs`
(que espelhava o `.xlsx` do Drive numa Sheet publicada) foi removido do repositório.
O gatilho do Apps Script em si, se ainda existir na conta Google dona daquela Sheet,
precisa ser desligado manualmente por lá -- este repositório não tem como alcançá-lo.

**Rodando de outra máquina:** só precisa do Chrome com a porta de depuração e login
manual em sond.com.br (sessão por cookie, sem senha guardada em lugar nenhum) --
diferente da MATRIZ/linha de base, que ainda exigem o G:\ com o Google Drive montado,
esta fonte específica não depende mais de nenhum caminho de Drive.
```

- [ ] **Step 5: Commit and push**

```bash
git add CLAUDE.md docs/planejamento-semanal.html docs/avancos-online.csv dist/planejamento-semanal.html dist/avancos-online.csv
git commit -m "Publish Avancos-online CSV, retire the old Drive-mirror mechanism, document setup"
git push
```

- [ ] **Step 6: Verify the live site**

```bash
sleep 30
curl -sI https://amcaccere261283.github.io/orcamento-dashboard/planejamento-semanal.html | head -3
curl -sI https://amcaccere261283.github.io/orcamento-dashboard/avancos-online.csv | head -3
```

Expected: both `HTTP/2 200`. Open the live URL, unlock, click "Atualizar dados" one
more time against the real published site (not the local server from Step 2) to
close the loop.
