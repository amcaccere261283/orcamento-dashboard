# ORÇAMENTO — primeira tabela filtrável Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-contained HTML dashboard that reads the real MATRIZ tab of the ORÇAMENTO forecast spreadsheet (Previsto x Realizado x Total, per contrato/tipologia, by month) directly from its local Google Drive path, and renders it as a filterable table with a live-recalculating "mês vigente" window. No charts in this v1.

**Architecture:** Zero-npm-dependency Node.js pipeline (parse → compute → render → build), mirroring the sister project `matriz-equipes-source`. A hand-rolled ZIP+XLSX reader (no library) extracts the MATRIZ sheet's raw cell grid; a structural parser turns that grid into per-(contrato, tipologia) records; a compute layer derives 6 period windows (acumulado anterior / mês vigente / M+1..M+3 / acumulado futuro) and produtividade/ticket médio; a render layer emits one static HTML file with an inline client-side script that recomputes the same windows live when the user changes the "mês vigente" dropdown (no page reload, no server).

**Tech Stack:** Node.js built-ins only (`node:fs`, `node:zlib`) — no `package.json`, no `npm install`, no third-party libraries. Node's built-in test runner (`node --test`).

## Global Constraints

- Zero npm dependencies anywhere in this repo — every module uses only Node's built-in modules. Never add a `package.json` with a `dependencies`/`devDependencies` block.
- Source spreadsheet path (read on every build, never cached):
  `G:\Meu Drive\PMO\06 - Orçamento\OR26 - Rev 01 - Frcst 6+6\Modelo\OR - 2026 (04.A) - Base Frcst 6+6 Atual R00.1.xlsx`
- Sheet name to read: `MATRIZ` (exact string — the user renamed it from "FRCST 6+6").
- Only cached cell values (`<v>`) are ever read from the xlsx — no formula evaluation. This is intentional: Excel already computed and stored the values we need (confirmed by inspecting real formula cells in the workbook), so re-implementing SUMIFS/XLOOKUP formulas would be wasted, riskier work.
- Rows to exclude from parsed output (confirmed with the user): any row-group whose GRUPO is blank or literally `"Todos"` (pre-aggregated summary rows at the top of the sheet), and any row-group whose SONDAGEM (tipologia) is `"MENSAL"` or `"ACUMULADO"` (pre-aggregated per-contract trailer rows). The dashboard recomputes these same totals itself from the real per-tipologia rows.
- Produtividade/ticket médio formulas (confirmed with the user):
  - **Previsto**: read directly from the sheet's own PROD. and TICKET cells (typed planning premises, one value for the whole year — never recomputed).
  - **Realizado** and **Total**: `produtividade = volume ÷ equipes` and `ticketMedio = financeiro ÷ volume`, computed independently for each of the 6 period buckets from that bucket's own summed values.
- All test files live in `test/` at the repo root and are named `orcamento-<module>.test.js`, run via `node --test test/`.

---

## File Structure

```
orcamento-dashboard/
  tools/orcamento/
    zip-reader.js          -- Task 1: generic zip central-directory reader/extractor
    xlsx-cells.js           -- Task 2: sharedStrings + sheet-XML -> cell grid
    xlsx-reader.js          -- Task 3: workbook.xml/rels resolution, ties 1+2 together
    datas.js                -- Task 3: Excel serial date <-> JS Date helpers
    parse-matriz.js         -- Task 4: MATRIZ-specific structural parser
    compute-orcamento.js    -- Task 5: period windows + produtividade/ticket médio
    render-dashboard.js     -- Task 6: HTML table + filters + inline client script
    build-dashboard.js      -- Task 7: orchestration entry point
    config.js               -- Task 7: source file path + sheet name
  test/
    helpers/build-zip.js    -- Task 1: shared test-only zip-building helper
    orcamento-zip-reader.test.js
    orcamento-xlsx-cells.test.js
    orcamento-xlsx-reader.test.js
    orcamento-datas.test.js
    orcamento-parse-matriz.test.js
    orcamento-compute-orcamento.test.js
    orcamento-render-dashboard.test.js
    orcamento-build-dashboard.test.js   -- Task 8: end-to-end integration test
  dist/
    orcamento-dashboard.html            -- build output (committed, like matriz-equipes)
    Abrir Dashboard.bat                 -- Task 8
  docs/superpowers/specs/2026-07-21-primeira-tabela-orcamento-design.md   (already written)
  docs/superpowers/plans/2026-07-21-primeira-tabela-orcamento.md          (this file)
```

---

### Task 1: ZIP reader

**Files:**
- Create: `tools/orcamento/zip-reader.js`
- Create: `test/helpers/build-zip.js`
- Test: `test/orcamento-zip-reader.test.js`

**Interfaces:**
- Produces: `listZipEntries(buffer: Buffer) -> Map<string, {compressionMethod: number, compressedSize: number, localHeaderOffset: number}>`, `readZipEntry(buffer: Buffer, entry: {compressionMethod, compressedSize, localHeaderOffset}) -> Buffer`. Later tasks (3) call both.
- `test/helpers/build-zip.js` produces: `buildMinimalZip(entries: Array<{name: string, data: Buffer, method: 0|8}>) -> Buffer` — a valid minimal zip archive, used by this task's tests and Task 3's tests.

- [ ] **Step 1: Write the test-only zip-building helper**

```js
// test/helpers/build-zip.js
'use strict';
const zlib = require('node:zlib');

function buildMinimalZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { name, data, method } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const payload = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = zlib.crc32(data) >>> 0;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuf, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralDirStart = offset;
  const centralDir = Buffer.concat(centralParts);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(centralDirStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

module.exports = { buildMinimalZip };
```

- [ ] **Step 2: Write the failing test**

```js
// test/orcamento-zip-reader.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { listZipEntries, readZipEntry } = require('../tools/orcamento/zip-reader.js');
const { buildMinimalZip } = require('./helpers/build-zip.js');

test('listZipEntries finds a stored (uncompressed) entry with its metadata', () => {
  const zip = buildMinimalZip([{ name: 'hello.txt', data: Buffer.from('Hello, zip!'), method: 0 }]);
  const entries = listZipEntries(zip);
  assert.equal(entries.size, 1);
  assert.ok(entries.has('hello.txt'));
  assert.equal(entries.get('hello.txt').compressionMethod, 0);
});

test('readZipEntry returns the original bytes for a stored entry', () => {
  const zip = buildMinimalZip([{ name: 'hello.txt', data: Buffer.from('Hello, zip!'), method: 0 }]);
  const entries = listZipEntries(zip);
  const content = readZipEntry(zip, entries.get('hello.txt'));
  assert.equal(content.toString('utf8'), 'Hello, zip!');
});

test('readZipEntry inflates a deflated (compression method 8) entry back to the original bytes', () => {
  const original = Buffer.from('Some longer repeated text. '.repeat(50));
  const zip = buildMinimalZip([{ name: 'big.xml', data: original, method: 8 }]);
  const entries = listZipEntries(zip);
  const content = readZipEntry(zip, entries.get('big.xml'));
  assert.equal(content.toString('utf8'), original.toString('utf8'));
});

test('listZipEntries finds multiple entries with correct byte offsets', () => {
  const zip = buildMinimalZip([
    { name: 'a.xml', data: Buffer.from('<a/>'), method: 0 },
    { name: 'b.xml', data: Buffer.from('<b>'.repeat(30)), method: 8 },
  ]);
  const entries = listZipEntries(zip);
  assert.deepEqual([...entries.keys()], ['a.xml', 'b.xml']);
  assert.equal(readZipEntry(zip, entries.get('a.xml')).toString('utf8'), '<a/>');
  assert.equal(readZipEntry(zip, entries.get('b.xml')).toString('utf8'), '<b>'.repeat(30));
});

test('listZipEntries throws a clear error on a non-zip buffer', () => {
  assert.throws(() => listZipEntries(Buffer.from('not a zip file')), /end of central directory/);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/orcamento-zip-reader.test.js`
Expected: FAIL with "Cannot find module '../tools/orcamento/zip-reader.js'"

- [ ] **Step 4: Write minimal implementation**

```js
// tools/orcamento/zip-reader.js
'use strict';
const zlib = require('node:zlib');

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const EOCD_MIN_SIZE = 22;

function findEndOfCentralDirectory(buffer) {
  const maxCommentLength = 65535;
  const searchStart = Math.max(0, buffer.length - EOCD_MIN_SIZE - maxCommentLength);
  for (let offset = buffer.length - EOCD_MIN_SIZE; offset >= searchStart; offset--) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw new Error('Not a valid zip file: end of central directory record not found');
}

// Retorna um Map nome -> metadados (sem descomprimir ainda) -- lido a partir
// do diretório central, nunca varrendo os cabeçalhos locais sequencialmente
// (o diretório central é a fonte confiável de tamanho/offset de cada
// entrada).
function listZipEntries(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);

  const entries = new Map();
  let offset = centralDirOffset;
  for (let i = 0; i < totalEntries; i++) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== CENTRAL_DIR_SIGNATURE) {
      throw new Error(`Not a valid zip file: bad central directory signature at offset ${offset}`);
    }
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    entries.set(name, { compressionMethod, compressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipEntry(buffer, entry) {
  const nameLength = buffer.readUInt16LE(entry.localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localHeaderOffset + 28);
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.compressionMethod === 0) return Buffer.from(compressed);
  if (entry.compressionMethod === 8) return zlib.inflateRawSync(compressed);
  throw new Error(`Unsupported zip compression method: ${entry.compressionMethod}`);
}

module.exports = { listZipEntries, readZipEntry };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/orcamento-zip-reader.test.js`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add tools/orcamento/zip-reader.js test/helpers/build-zip.js test/orcamento-zip-reader.test.js
git commit -m "Add zero-dependency zip central-directory reader"
```

---

### Task 2: XLSX cell/shared-strings grid parser

**Files:**
- Create: `tools/orcamento/xlsx-cells.js`
- Test: `test/orcamento-xlsx-cells.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure string/XML parsing).
- Produces: `parseSharedStrings(xml: string) -> string[]`, `parseSheetGrid(xml: string, sharedStrings: string[]) -> grid` where `grid[rowNumber][colIndex]` holds a cell's value (`string | number | null`), `columnLetterToIndex(letters: string) -> number` (0-based), `cell(grid, rowNumber: number, col: number|string) -> value`. Task 3 and Task 4 use `parseSharedStrings`, `parseSheetGrid`, and `cell`.

- [ ] **Step 1: Write the failing test**

```js
// test/orcamento-xlsx-cells.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSharedStrings, parseSheetGrid, columnLetterToIndex, cell } = require('../tools/orcamento/xlsx-cells.js');

test('columnLetterToIndex converts single and double letter columns to 0-based indices', () => {
  assert.equal(columnLetterToIndex('A'), 0);
  assert.equal(columnLetterToIndex('Z'), 25);
  assert.equal(columnLetterToIndex('AA'), 26);
  assert.equal(columnLetterToIndex('BG'), 58);
});

test('parseSharedStrings extracts plain text entries in order', () => {
  const xml = '<sst><si><t>ORIGEM</t></si><si><t>GRUPO</t></si></sst>';
  assert.deepEqual(parseSharedStrings(xml), ['ORIGEM', 'GRUPO']);
});

test('parseSharedStrings concatenates multiple <t> runs within one <si> (rich text)', () => {
  const xml = '<sst><si><r><t>Total </t></r><r><t>Inicial</t></r></si></sst>';
  assert.deepEqual(parseSharedStrings(xml), ['Total Inicial']);
});

test('parseSharedStrings decodes XML entities', () => {
  const xml = '<sst><si><t>Bloco 01 &amp; 02</t></si></sst>';
  assert.deepEqual(parseSharedStrings(xml), ['Bloco 01 & 02']);
});

test('parseSheetGrid reads a shared-string cell and a numeric cell, and returns null for an untouched cell', () => {
  const sharedStrings = ['ORIGEM', 'PÁTRIA'];
  const xml = '<sheetData><row r="1"><c r="B1" t="s"><v>0</v></c></row>' +
    '<row r="2"><c r="B2" t="s"><v>1</v></c><c r="M2"><v>46023</v></c></row></sheetData>';
  const grid = parseSheetGrid(xml, sharedStrings);
  assert.equal(cell(grid, 1, 'B'), 'ORIGEM');
  assert.equal(cell(grid, 2, 'B'), 'PÁTRIA');
  assert.equal(cell(grid, 2, 'M'), 46023);
  assert.equal(cell(grid, 2, 'Z'), null);
});

test('parseSheetGrid handles a self-closing empty cell (no value)', () => {
  const xml = '<sheetData><row r="1"><c r="A1"/><c r="B1" t="s"><v>0</v></c></row></sheetData>';
  const grid = parseSheetGrid(xml, ['x']);
  assert.equal(cell(grid, 1, 'A'), null);
  assert.equal(cell(grid, 1, 'B'), 'x');
});

test('parseSheetGrid reads an inline string cell (t="inlineStr")', () => {
  const xml = '<sheetData><row r="1"><c r="B1" t="inlineStr"><is><t>Todos</t></is></c></row></sheetData>';
  const grid = parseSheetGrid(xml, []);
  assert.equal(cell(grid, 1, 'B'), 'Todos');
});

test('parseSheetGrid reads a formula cell by its cached <v>, ignoring the <f> formula text', () => {
  const xml = '<sheetData><row r="38"><c r="AA38"><f t="shared" ref="AA38:AA68" si="69">IFERROR(AVERAGE(N38:Y38),0)</f><v>4.21</v></c></row></sheetData>';
  const grid = parseSheetGrid(xml, []);
  assert.equal(cell(grid, 38, 'AA'), 4.21);
});

test('cell returns null for a row that was never written to the grid', () => {
  const grid = parseSheetGrid('<sheetData></sheetData>', []);
  assert.equal(cell(grid, 99, 'A'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/orcamento-xlsx-cells.test.js`
Expected: FAIL with "Cannot find module '../tools/orcamento/xlsx-cells.js'"

- [ ] **Step 3: Write minimal implementation**

```js
// tools/orcamento/xlsx-cells.js
'use strict';

function decodeXmlEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseSharedStrings(xml) {
  const items = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let siMatch;
  while ((siMatch = siRe.exec(xml))) {
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let tMatch;
    let text = '';
    while ((tMatch = tRe.exec(siMatch[1]))) text += tMatch[1];
    items.push(decodeXmlEntities(text));
  }
  return items;
}

function columnLetterToIndex(letters) {
  let index = 0;
  for (const ch of letters) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

function parseCellRef(ref) {
  const match = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!match) throw new Error(`Invalid cell reference: ${ref}`);
  return { col: columnLetterToIndex(match[1]), row: Number(match[2]) };
}

function parseCellValue(type, content, sharedStrings) {
  if (!content) return null;
  if (type === 'inlineStr') {
    const tMatch = /<t[^>]*>([\s\S]*?)<\/t>/.exec(content);
    return tMatch ? decodeXmlEntities(tMatch[1]) : null;
  }
  const vMatch = /<v>([\s\S]*?)<\/v>/.exec(content);
  if (!vMatch) return null;
  const raw = vMatch[1];
  if (type === 's') return sharedStrings[Number(raw)] ?? null;
  if (type === 'str' || type === 'e') return decodeXmlEntities(raw);
  return Number(raw);
}

// grid[rowNumber][colIndex] = valor da célula (string para texto, number
// para célula numérica -- inclusive datas seriais cruas do Excel; quem
// chama decide quando um número é de fato uma data, ver datas.js).
function parseSheetGrid(xml, sharedStrings) {
  const grid = [];
  const rowRe = /<row[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(xml))) {
    const rowNumber = Number(rowMatch[1]);
    const rowContent = rowMatch[2];
    const row = [];
    const cellRe = /<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowContent))) {
      const { col } = parseCellRef(cellMatch[1]);
      const attrs = cellMatch[2];
      const content = cellMatch[3];
      const typeMatch = /\bt="([^"]*)"/.exec(attrs);
      const type = typeMatch ? typeMatch[1] : null;
      row[col] = parseCellValue(type, content, sharedStrings);
    }
    grid[rowNumber] = row;
  }
  return grid;
}

function cell(grid, rowNumber, col) {
  const row = grid[rowNumber];
  if (!row) return null;
  const colIndex = typeof col === 'string' ? columnLetterToIndex(col) : col;
  const value = row[colIndex];
  return value === undefined ? null : value;
}

module.exports = { parseSharedStrings, parseSheetGrid, columnLetterToIndex, parseCellRef, cell };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/orcamento-xlsx-cells.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add tools/orcamento/xlsx-cells.js test/orcamento-xlsx-cells.test.js
git commit -m "Add xlsx shared-strings and sheet-grid cell parser"
```

---

### Task 3: xlsx-reader.js (sheet resolution) + datas.js (Excel date helpers)

**Files:**
- Create: `tools/orcamento/xlsx-reader.js`
- Create: `tools/orcamento/datas.js`
- Test: `test/orcamento-xlsx-reader.test.js`
- Test: `test/orcamento-datas.test.js`

**Interfaces:**
- Consumes: `listZipEntries`/`readZipEntry` from `zip-reader.js` (Task 1); `parseSharedStrings`/`parseSheetGrid` from `xlsx-cells.js` (Task 2); `buildMinimalZip` from `test/helpers/build-zip.js` (Task 1, test only).
- Produces: `readXlsxSheet(filePath: string, sheetName: string) -> grid` (same grid shape as Task 2). `excelSerialParaData(serial: number) -> Date`, `formatarMesAno(data: Date) -> string`. Task 4 uses `readXlsxSheet`; Task 6 uses `formatarMesAno`; Task 7 uses `excelSerialParaData`.

- [ ] **Step 1: Write the failing test for datas.js**

```js
// test/orcamento-datas.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { excelSerialParaData, formatarMesAno } = require('../tools/orcamento/datas.js');

test('excelSerialParaData converts a known Excel serial (46023, seen in the real MATRIZ header) to 01/01/2026 UTC', () => {
  const data = excelSerialParaData(46023);
  assert.equal(data.getUTCFullYear(), 2026);
  assert.equal(data.getUTCMonth(), 0);
  assert.equal(data.getUTCDate(), 1);
});

test('excelSerialParaData converts 46357 (the last MATRIZ month header) to 01/12/2026 UTC', () => {
  const data = excelSerialParaData(46357);
  assert.equal(data.getUTCFullYear(), 2026);
  assert.equal(data.getUTCMonth(), 11);
  assert.equal(data.getUTCDate(), 1);
});

test('formatarMesAno formats a date as abbreviated Portuguese "Mês/Ano"', () => {
  assert.equal(formatarMesAno(excelSerialParaData(46023)), 'Jan/2026');
  assert.equal(formatarMesAno(excelSerialParaData(46357)), 'Dez/2026');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/orcamento-datas.test.js`
Expected: FAIL with "Cannot find module '../tools/orcamento/datas.js'"

- [ ] **Step 3: Write datas.js**

```js
// tools/orcamento/datas.js
'use strict';

// Época do Excel ajustada pro bug histórico de achar que 1900 foi bissexto
// -- serial 25569 = 1970-01-01 UTC, o offset padrão usado por qualquer
// leitor de xlsx real.
function excelSerialParaData(serial) {
  const milissegundos = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(milissegundos);
}

const MESES_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function formatarMesAno(data) {
  return `${MESES_PT[data.getUTCMonth()]}/${data.getUTCFullYear()}`;
}

module.exports = { excelSerialParaData, formatarMesAno };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/orcamento-datas.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the failing test for xlsx-reader.js**

This builds a complete minimal .xlsx (workbook.xml + rels + sharedStrings + one worksheet) entirely from the zip helper, to prove sheet-name resolution works end-to-end without needing a real file on disk.

```js
// test/orcamento-xlsx-reader.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readXlsxSheet } = require('../tools/orcamento/xlsx-reader.js');
const { buildMinimalZip } = require('./helpers/build-zip.js');

function buildTestXlsx({ sheetNames, activeSheetRows }) {
  const workbookXml = '<?xml version="1.0"?><workbook xmlns:r="rels">' +
    '<sheets>' + sheetNames.map((name, i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
    '</sheets></workbook>';
  const relsXml = '<?xml version="1.0"?><Relationships>' +
    sheetNames.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    '</Relationships>';
  const sharedStringsXml = '<sst><si><t>PÁTRIA</t></si></sst>';
  const sheetXml = `<worksheet><sheetData>${activeSheetRows}</sheetData></worksheet>`;

  const entries = [
    { name: 'xl/workbook.xml', data: Buffer.from(workbookXml, 'utf8'), method: 0 },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(relsXml, 'utf8'), method: 0 },
    { name: 'xl/sharedStrings.xml', data: Buffer.from(sharedStringsXml, 'utf8'), method: 0 },
  ];
  sheetNames.forEach((_, i) => {
    const xml = i === sheetNames.length - 1 ? sheetXml : '<worksheet><sheetData></sheetData></worksheet>';
    entries.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: Buffer.from(xml, 'utf8'), method: 8 });
  });
  return buildMinimalZip(entries);
}

test('readXlsxSheet resolves a sheet by name through workbook.xml and rels, and returns its grid', () => {
  const zip = buildTestXlsx({
    sheetNames: ['Outra aba', 'MATRIZ'],
    activeSheetRows: '<row r="1"><c r="B1" t="s"><v>0</v></c></row>',
  });
  const tmpFile = path.join(os.tmpdir(), `orcamento-test-${Date.now()}.xlsx`);
  fs.writeFileSync(tmpFile, zip);
  try {
    const grid = readXlsxSheet(tmpFile, 'MATRIZ');
    const { cell } = require('../tools/orcamento/xlsx-cells.js');
    assert.equal(cell(grid, 1, 'B'), 'PÁTRIA');
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test('readXlsxSheet throws a clear error naming the available sheets when the requested sheet is missing', () => {
  const zip = buildTestXlsx({ sheetNames: ['Outra aba', 'MATRIZ'], activeSheetRows: '' });
  const tmpFile = path.join(os.tmpdir(), `orcamento-test-${Date.now()}.xlsx`);
  fs.writeFileSync(tmpFile, zip);
  try {
    assert.throws(() => readXlsxSheet(tmpFile, 'NÃO EXISTE'), /Available sheets: Outra aba, MATRIZ/);
  } finally {
    fs.unlinkSync(tmpFile);
  }
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `node --test test/orcamento-xlsx-reader.test.js`
Expected: FAIL with "Cannot find module '../tools/orcamento/xlsx-reader.js'"

- [ ] **Step 7: Write xlsx-reader.js**

```js
// tools/orcamento/xlsx-reader.js
'use strict';
const fs = require('node:fs');
const { listZipEntries, readZipEntry } = require('./zip-reader.js');
const { parseSharedStrings, parseSheetGrid } = require('./xlsx-cells.js');

function decodeXmlEntities(text) {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function parseWorkbookSheets(workbookXml) {
  const sheets = [];
  const sheetRe = /<sheet\b[^>]*\bname="([^"]*)"[^>]*\br:id="([^"]*)"[^>]*\/>/g;
  let match;
  while ((match = sheetRe.exec(workbookXml))) {
    sheets.push({ name: decodeXmlEntities(match[1]), rId: match[2] });
  }
  return sheets;
}

function parseWorkbookRels(relsXml) {
  const targets = new Map();
  const relRe = /<Relationship\b[^>]*\bId="([^"]*)"[^>]*\bTarget="([^"]*)"[^>]*\/>/g;
  let match;
  while ((match = relRe.exec(relsXml))) {
    targets.set(match[1], match[2]);
  }
  return targets;
}

// Lê uma aba pelo nome de um .xlsx no disco e devolve sua grade de células
// (ver xlsx-cells.js). Só lê valores em cache (<v>) -- nunca avalia fórmula.
function readXlsxSheet(filePath, sheetName) {
  const buffer = fs.readFileSync(filePath);
  const zipEntries = listZipEntries(buffer);

  const workbookEntry = zipEntries.get('xl/workbook.xml');
  if (!workbookEntry) throw new Error(`${filePath} is not a valid .xlsx file (missing xl/workbook.xml)`);
  const workbookXml = readZipEntry(buffer, workbookEntry).toString('utf8');
  const sheets = parseWorkbookSheets(workbookXml);
  const sheetMeta = sheets.find(s => s.name === sheetName);
  if (!sheetMeta) {
    const available = sheets.map(s => s.name).join(', ');
    throw new Error(`Sheet "${sheetName}" not found in ${filePath}. Available sheets: ${available}`);
  }

  const relsEntry = zipEntries.get('xl/_rels/workbook.xml.rels');
  const relsXml = readZipEntry(buffer, relsEntry).toString('utf8');
  const relTargets = parseWorkbookRels(relsXml);
  const target = relTargets.get(sheetMeta.rId);
  if (!target) throw new Error(`No relationship target found for sheet "${sheetName}" (r:id ${sheetMeta.rId})`);

  const sheetPath = `xl/${target}`;
  const sheetEntry = zipEntries.get(sheetPath);
  if (!sheetEntry) throw new Error(`Worksheet part ${sheetPath} not found in ${filePath}`);
  const sheetXml = readZipEntry(buffer, sheetEntry).toString('utf8');

  const sharedStringsEntry = zipEntries.get('xl/sharedStrings.xml');
  const sharedStrings = sharedStringsEntry
    ? parseSharedStrings(readZipEntry(buffer, sharedStringsEntry).toString('utf8'))
    : [];

  return parseSheetGrid(sheetXml, sharedStrings);
}

module.exports = { readXlsxSheet, parseWorkbookSheets, parseWorkbookRels };
```

- [ ] **Step 8: Run test to verify it passes**

Run: `node --test test/orcamento-xlsx-reader.test.js`
Expected: PASS (2 tests)

- [ ] **Step 9: Commit**

```bash
git add tools/orcamento/xlsx-reader.js tools/orcamento/datas.js test/orcamento-xlsx-reader.test.js test/orcamento-datas.test.js
git commit -m "Add xlsx sheet-name resolution and Excel-serial date helpers"
```

---

### Task 4: parse-matriz.js (MATRIZ structural parser)

**Files:**
- Create: `tools/orcamento/parse-matriz.js`
- Test: `test/orcamento-parse-matriz.test.js`

**Interfaces:**
- Consumes: a `grid` shaped as produced by `xlsx-cells.js`'s `parseSheetGrid` / `xlsx-reader.js`'s `readXlsxSheet` (Tasks 2-3) — this task's tests build the grid directly as a plain array, without going through XML, since `parse-matriz.js` only depends on the grid shape, not on how it was produced.
- Produces: `parseMatriz(grid) -> registro[]`, where each `registro` is `{ origem, grupo, tomador, sup, escopo, apoio, inicio, termino, tipologia, observacao, previsto: ValoresLinha, realizado: ValoresLinha, total: ValoresLinha }` and `ValoresLinha` is `{ equipes: number[12], equipesResumo: {pico, media, prod, dias}, volume: number[12], volumeResumo: {total, totalInicial, ticket}, financeiro: number[12], financeiroResumo: {total, totalInicial} }`. Task 5 consumes this exact shape.

- [ ] **Step 1: Write the failing test**

This builds a compact synthetic grid mirroring the real confirmed layout: a header row (real column positions B..BG), one "Todos" aggregate block (must be skipped), two real contracts each with 2 tipologia sub-blocks, and a MENSAL/ACUMULADO trailer on the first contract (must be skipped).

```js
// test/orcamento-parse-matriz.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMatriz } = require('../tools/orcamento/parse-matriz.js');

// Posições reais confirmadas na MATRIZ (colunas B..BG, 0-based a partir de A=0):
// B=1 ORIGEM, C=2 GRUPO, D=3 TOMADOR, E=4 SUP, F=5 ESCOPO, G=6 APOIO,
// H=7 INICIO, I=8 TERMINO, J=9 SONDAGEM, K=10/L=11 Demanda, M=12 BASE,
// N..Y=13..24 equipesMeses, Z=25 PICO, AA=26 MÉDIA, AB=27 PROD., AC=28 DIAS,
// AD..AO=29..40 volumeMeses, AP=41 TOTAL, AQ=42 TOTAL INICIAL, AR=43 TICKET,
// AS..BD=44..55 financeiroMeses, BE=56 TOTAL, BF=57 TOTAL INICIAL, BG=58 OBSERVAÇÃO.
function linhaHeader() {
  const row = [];
  row[1] = 'ORIGEM'; row[2] = 'GRUPO'; row[3] = 'TOMADOR'; row[4] = 'SUP'; row[5] = 'ESCOPO';
  row[6] = 'APOIO'; row[7] = 'INICIO'; row[8] = 'TERMINO'; row[9] = 'SONDAGEM';
  row[10] = 'Demanda à cadastrar'; row[11] = 'Demanda Cadastrada'; row[12] = 'BASE';
  for (let i = 0; i < 12; i++) row[13 + i] = 46023 + i * 30;
  row[25] = 'PICO'; row[26] = 'MÉDIA'; row[27] = 'PROD.'; row[28] = 'DIAS';
  for (let i = 0; i < 12; i++) row[29 + i] = 46023 + i * 30;
  row[41] = 'TOTAL'; row[42] = 'TOTAL INICIAL'; row[43] = 'TICKET';
  for (let i = 0; i < 12; i++) row[44 + i] = 46023 + i * 30;
  row[56] = 'TOTAL'; row[57] = 'TOTAL INICIAL'; row[58] = 'OBSERVAÇÃO';
  return row;
}

// campos: { origem, grupo, tomador, sup, escopo, apoio, inicio, termino, tipologia, base, equipes, volume, financeiro, observacao }
// equipes/volume/financeiro, quando dados, são um único número repetido nos 12 meses (simplifica a fixture).
function linha(campos) {
  const row = [];
  if (campos.origem !== undefined) row[1] = campos.origem;
  if (campos.grupo !== undefined) row[2] = campos.grupo;
  if (campos.tomador !== undefined) row[3] = campos.tomador;
  if (campos.sup !== undefined) row[4] = campos.sup;
  if (campos.escopo !== undefined) row[5] = campos.escopo;
  if (campos.apoio !== undefined) row[6] = campos.apoio;
  if (campos.inicio !== undefined) row[7] = campos.inicio;
  if (campos.termino !== undefined) row[8] = campos.termino;
  if (campos.tipologia !== undefined) row[9] = campos.tipologia;
  row[12] = campos.base;
  for (let i = 0; i < 12; i++) row[13 + i] = campos.equipes ?? 0;
  row[25] = campos.pico ?? 0; row[26] = campos.media ?? 0; row[27] = campos.prod ?? 0; row[28] = campos.dias ?? 0;
  for (let i = 0; i < 12; i++) row[29 + i] = campos.volume ?? 0;
  row[41] = campos.volumeTotal ?? 0; row[42] = campos.volumeTotalInicial ?? 0; row[43] = campos.ticket ?? 0;
  for (let i = 0; i < 12; i++) row[44 + i] = campos.financeiro ?? 0;
  row[56] = campos.financeiroTotal ?? 0; row[57] = campos.financeiroTotalInicial ?? 0;
  if (campos.observacao !== undefined) row[58] = campos.observacao;
  return row;
}

function construirGrid(linhas) {
  const grid = [];
  grid[1] = linhaHeader();
  linhas.forEach((l, i) => { grid[2 + i] = l; });
  return grid;
}

test('parseMatriz skips the top-of-sheet aggregate block (GRUPO="Todos") and parses real contract rows', () => {
  const grid = construirGrid([
    // Bloco de resumo do topo -- GRUPO ausente/"Todos", deve ser ignorado.
    linha({ origem: 'Todos', grupo: 'Todos', tomador: 'Todos', tipologia: 'SP', base: 'P', equipes: 99 }),
    linha({ base: 'R' }),
    linha({ base: 'T' }),
    // Contrato real: PÁTRIA, tipologia SM.
    linha({ origem: 'CONTRATO VIGENTE', grupo: 'PÁTRIA', tomador: 'Via Araucária S.A', tipologia: 'SM', base: 'P', equipes: 5, volume: 100, financeiro: 1000 }),
    linha({ base: 'R', equipes: 4, volume: 90, financeiro: 900 }),
    linha({ base: 'T', equipes: 4.5, volume: 95, financeiro: 950, observacao: 'Nota qualquer' }),
  ]);

  const registros = parseMatriz(grid);

  assert.equal(registros.length, 1);
  assert.equal(registros[0].grupo, 'PÁTRIA');
  assert.equal(registros[0].tomador, 'Via Araucária S.A');
  assert.equal(registros[0].tipologia, 'SM');
  assert.deepEqual(registros[0].previsto.equipes, Array(12).fill(5));
  assert.deepEqual(registros[0].realizado.volume, Array(12).fill(90));
  assert.deepEqual(registros[0].total.financeiro, Array(12).fill(950));
  assert.equal(registros[0].observacao, 'Nota qualquer');
});

test('parseMatriz fills contract-identifying fields forward across a P/R/T triad when they are blank on R/T rows', () => {
  const grid = construirGrid([
    linha({ origem: 'CONTRATO VIGENTE', grupo: 'PÁTRIA', tomador: 'Via Araucária S.A', tipologia: 'ST', base: 'P' }),
    linha({ base: 'R' }),
    linha({ base: 'T' }),
  ]);
  const registros = parseMatriz(grid);
  assert.equal(registros[0].grupo, 'PÁTRIA');
  assert.equal(registros[0].tomador, 'Via Araucária S.A');
});

test('parseMatriz also works when contract-identifying fields are repeated on every row of the triad (not just the first)', () => {
  const grid = construirGrid([
    linha({ origem: 'CONTRATO VIGENTE', grupo: 'SYSTRA', tomador: 'Ecopistas', tipologia: 'ST', base: 'P' }),
    linha({ origem: 'CONTRATO VIGENTE', grupo: 'SYSTRA', tipologia: 'ST', base: 'R' }),
    linha({ origem: 'CONTRATO VIGENTE', grupo: 'SYSTRA', tipologia: 'ST', base: 'T' }),
  ]);
  const registros = parseMatriz(grid);
  assert.equal(registros.length, 1);
  assert.equal(registros[0].grupo, 'SYSTRA');
});

test('parseMatriz starts a new record when GRUPO changes to a different real value, even without an intervening blank', () => {
  const grid = construirGrid([
    linha({ origem: 'CONTRATO VIGENTE', grupo: 'PÁTRIA', tomador: 'Via Araucária S.A', tipologia: 'SM', base: 'P' }),
    linha({ base: 'R' }), linha({ base: 'T' }),
    linha({ origem: 'CONTRATO VIGENTE', grupo: 'SYSTRA', tomador: 'Ecopistas', tipologia: 'SP', base: 'P' }),
    linha({ base: 'R' }), linha({ base: 'T' }),
  ]);
  const registros = parseMatriz(grid);
  assert.equal(registros.length, 2);
  assert.equal(registros[0].grupo, 'PÁTRIA');
  assert.equal(registros[1].grupo, 'SYSTRA');
  assert.equal(registros[1].tipologia, 'SP');
});

test('parseMatriz skips the MENSAL/ACUMULADO trailer rows at the end of a real contract\'s tipologia list', () => {
  const grid = construirGrid([
    linha({ origem: 'CONTRATO VIGENTE', grupo: 'PÁTRIA', tomador: 'Via Araucária S.A', tipologia: 'SM', base: 'P' }),
    linha({ base: 'R' }), linha({ base: 'T' }),
    linha({ tipologia: 'MENSAL', base: 'P' }), linha({ base: 'R' }), linha({ base: 'T' }),
    linha({ tipologia: 'ACUMULADO', base: 'P' }), linha({ base: 'R' }), linha({ base: 'T' }),
  ]);
  const registros = parseMatriz(grid);
  assert.equal(registros.length, 1);
  assert.equal(registros[0].tipologia, 'SM');
});

test('parseMatriz reads equipesResumo, volumeResumo and financeiroResumo per P/R/T row', () => {
  const grid = construirGrid([
    linha({
      origem: 'CONTRATO VIGENTE', grupo: 'PÁTRIA', tomador: 'X', tipologia: 'SM', base: 'P',
      pico: 6, media: 4.21, prod: 1.5, dias: 25,
      volumeTotal: 1200, volumeTotalInicial: 1599.5, ticket: 1885.65,
      financeiroTotal: 500000, financeiroTotalInicial: 480000,
    }),
    linha({ base: 'R' }), linha({ base: 'T' }),
  ]);
  const registros = parseMatriz(grid);
  assert.deepEqual(registros[0].previsto.equipesResumo, { pico: 6, media: 4.21, prod: 1.5, dias: 25 });
  assert.deepEqual(registros[0].previsto.volumeResumo, { total: 1200, totalInicial: 1599.5, ticket: 1885.65 });
  assert.deepEqual(registros[0].previsto.financeiroResumo, { total: 500000, totalInicial: 480000 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/orcamento-parse-matriz.test.js`
Expected: FAIL with "Cannot find module '../tools/orcamento/parse-matriz.js'"

- [ ] **Step 3: Write minimal implementation**

```js
// tools/orcamento/parse-matriz.js
'use strict';

function rotuloEm(headerRow, col) {
  return String(headerRow[col] ?? '').trim();
}

function acharColuna(headerRow, rotulo) {
  for (let col = 0; col < headerRow.length; col++) {
    if (rotuloEm(headerRow, col) === rotulo) return col;
  }
  throw new Error(`Coluna "${rotulo}" não encontrada na linha de cabeçalho da MATRIZ`);
}

function proximasNColunas(colunaAncora, quantidade) {
  const cols = [];
  for (let i = 0; i < quantidade; i++) cols.push(colunaAncora + 1 + i);
  return cols;
}

function exigirRotulo(headerRow, col, esperado) {
  const encontrado = rotuloEm(headerRow, col);
  if (encontrado !== esperado) {
    throw new Error(`Esperava a coluna "${esperado}" na posição ${col} da MATRIZ, encontrei "${encontrado}" -- o layout da planilha pode ter mudado`);
  }
}

// Acha cada coluna pelo próprio rótulo da linha 1 (nunca por posição fixa),
// pra sobreviver a pequenas mudanças de layout entre revisões do modelo --
// mas os 3 blocos de 12 meses continuam assumidos como blocos fixos de 12
// colunas fechados por rótulos conhecidos (PICO/MÉDIA/PROD./DIAS,
// TOTAL/TOTAL INICIAL/TICKET, TOTAL/TOTAL INICIAL). Se a forma mudar (menos
// de 12 meses, blocos reordenados), lança erro em vez de ler dado errado
// em silêncio.
function locateColumns(grid) {
  const headerRow = grid[1];
  if (!headerRow) throw new Error('Linha de cabeçalho (linha 1) da MATRIZ está vazia');

  const origem = acharColuna(headerRow, 'ORIGEM');
  const grupo = acharColuna(headerRow, 'GRUPO');
  const tomador = acharColuna(headerRow, 'TOMADOR');
  const sup = acharColuna(headerRow, 'SUP');
  const escopo = acharColuna(headerRow, 'ESCOPO');
  const apoio = acharColuna(headerRow, 'APOIO');
  const inicio = acharColuna(headerRow, 'INICIO');
  const termino = acharColuna(headerRow, 'TERMINO');
  const sondagem = acharColuna(headerRow, 'SONDAGEM');
  const base = acharColuna(headerRow, 'BASE');

  const equipesMeses = proximasNColunas(base, 12);
  const pico = equipesMeses[11] + 1;
  exigirRotulo(headerRow, pico, 'PICO');
  const media = pico + 1;
  exigirRotulo(headerRow, media, 'MÉDIA');
  const prod = media + 1;
  exigirRotulo(headerRow, prod, 'PROD.');
  const dias = prod + 1;
  exigirRotulo(headerRow, dias, 'DIAS');

  const volumeMeses = proximasNColunas(dias, 12);
  const volumeTotal = volumeMeses[11] + 1;
  exigirRotulo(headerRow, volumeTotal, 'TOTAL');
  const volumeTotalInicial = volumeTotal + 1;
  const ticket = volumeTotalInicial + 1;
  exigirRotulo(headerRow, ticket, 'TICKET');

  const financeiroMeses = proximasNColunas(ticket, 12);
  const financeiroTotal = financeiroMeses[11] + 1;
  exigirRotulo(headerRow, financeiroTotal, 'TOTAL');
  const financeiroTotalInicial = financeiroTotal + 1;

  const observacao = financeiroTotalInicial + 1;

  return {
    origem, grupo, tomador, sup, escopo, apoio, inicio, termino, sondagem, base,
    equipesMeses, equipesResumo: { pico, media, prod, dias },
    volumeMeses, volumeResumo: { total: volumeTotal, totalInicial: volumeTotalInicial, ticket },
    financeiroMeses, financeiroResumo: { total: financeiroTotal, totalInicial: financeiroTotalInicial },
    observacao,
  };
}

function extrairValoresLinha(row, columns) {
  return {
    equipes: columns.equipesMeses.map(col => row[col] ?? 0),
    equipesResumo: {
      pico: row[columns.equipesResumo.pico] ?? 0,
      media: row[columns.equipesResumo.media] ?? 0,
      prod: row[columns.equipesResumo.prod] ?? 0,
      dias: row[columns.equipesResumo.dias] ?? 0,
    },
    volume: columns.volumeMeses.map(col => row[col] ?? 0),
    volumeResumo: {
      total: row[columns.volumeResumo.total] ?? 0,
      totalInicial: row[columns.volumeResumo.totalInicial] ?? 0,
      ticket: row[columns.volumeResumo.ticket] ?? 0,
    },
    financeiro: columns.financeiroMeses.map(col => row[col] ?? 0),
    financeiroResumo: {
      total: row[columns.financeiroResumo.total] ?? 0,
      totalInicial: row[columns.financeiroResumo.totalInicial] ?? 0,
    },
  };
}

// Linhas de resumo pré-calculadas pelo Excel (total geral com GRUPO="Todos"
// no topo da aba, e os totais MENSAL/ACUMULADO no fim de cada contrato) não
// são dados reais de contrato -- confirmado com o usuário, o dashboard
// recalcula os mesmos totais a partir dos registros reais.
const TIPOLOGIAS_RESUMO = new Set(['MENSAL', 'ACUMULADO']);
function deveIncluir(registro) {
  if (!registro.grupo || registro.grupo === 'Todos') return false;
  if (!registro.tipologia || TIPOLOGIAS_RESUMO.has(registro.tipologia)) return false;
  return true;
}

// Cada combinação (contrato, tipologia) ocupa 3 linhas físicas na planilha:
// P (Previsto), R (Realizado), T (Total) -- identificadas pela coluna BASE,
// nunca por posição relativa. Campos identificadores (ORIGEM..TERMINO,
// SONDAGEM) usam preenchimento "sticky": adota o valor da própria linha
// quando presente, senão mantém o último valor visto -- isso cobre os dois
// estilos de preenchimento reais vistos na planilha (em branco depois da
// primeira linha do grupo, ou repetido em toda linha).
function parseMatriz(grid) {
  const columns = locateColumns(grid);
  const registros = [];
  const estado = {
    origem: null, grupo: null, tomador: null, sup: null, escopo: null,
    apoio: null, inicio: null, termino: null, tipologia: null,
  };
  let atual = null;

  for (let rowNum = 2; rowNum < grid.length; rowNum++) {
    const row = grid[rowNum];
    if (!row) continue;
    const base = row[columns.base];
    if (base == null) continue;

    estado.origem = row[columns.origem] ?? estado.origem;
    estado.grupo = row[columns.grupo] ?? estado.grupo;
    estado.tomador = row[columns.tomador] ?? estado.tomador;
    estado.sup = row[columns.sup] ?? estado.sup;
    estado.escopo = row[columns.escopo] ?? estado.escopo;
    estado.apoio = row[columns.apoio] ?? estado.apoio;
    estado.inicio = row[columns.inicio] ?? estado.inicio;
    estado.termino = row[columns.termino] ?? estado.termino;
    estado.tipologia = row[columns.sondagem] ?? estado.tipologia;

    if (base === 'P') {
      atual = {
        origem: estado.origem, grupo: estado.grupo, tomador: estado.tomador, sup: estado.sup,
        escopo: estado.escopo, apoio: estado.apoio, inicio: estado.inicio, termino: estado.termino,
        tipologia: estado.tipologia, observacao: null,
        previsto: extrairValoresLinha(row, columns), realizado: null, total: null,
      };
    } else if (base === 'R' && atual) {
      atual.realizado = extrairValoresLinha(row, columns);
    } else if (base === 'T' && atual) {
      atual.total = extrairValoresLinha(row, columns);
      atual.observacao = row[columns.observacao] ?? null;
      if (deveIncluir(atual)) registros.push(atual);
      atual = null;
    }
  }
  return registros;
}

module.exports = { parseMatriz, locateColumns };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/orcamento-parse-matriz.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add tools/orcamento/parse-matriz.js test/orcamento-parse-matriz.test.js
git commit -m "Add MATRIZ structural parser (contract/tipologia records, skip aggregate rows)"
```

---

### Task 5: compute-orcamento.js (period windows + produtividade/ticket médio)

**Files:**
- Create: `tools/orcamento/compute-orcamento.js`
- Test: `test/orcamento-compute-orcamento.test.js`

**Interfaces:**
- Consumes: `registro[]` shape produced by `parse-matriz.js` (Task 4).
- Produces: `computeOrcamento(registros, vigenteIdx: number) -> registroComResumo[]` where each item is `{ ...registro, resumo: { previsto, realizado, total } }`; `previsto` is `{ equipes: Janelas, volume: Janelas, financeiro: Janelas, produtividade: number, ticketMedio: number }` (flat premise numbers); `realizado`/`total` are `{ equipes: Janelas, volume: Janelas, financeiro: Janelas, produtividade: Janelas, ticketMedio: Janelas }` (per-bucket computed ratios); `Janelas` is `{ acumuladoAnterior, mesVigente, m1, m2, m3, acumuladoFuturo }`. Task 6 consumes this exact shape (both server-side render and the mirrored client-side JS).

- [ ] **Step 1: Write the failing test**

```js
// test/orcamento-compute-orcamento.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeOrcamento, calcularJanelas, dividir, dividirJanelas } = require('../tools/orcamento/compute-orcamento.js');

test('calcularJanelas sums months before the reference index as acumuladoAnterior, and after m3 as acumuladoFuturo', () => {
  const mensal = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]; // jan..dez
  const janelas = calcularJanelas(mensal, 5); // vigente = jun (índice 5, valor 6)
  assert.equal(janelas.acumuladoAnterior, 1 + 2 + 3 + 4 + 5); // jan..mai
  assert.equal(janelas.mesVigente, 6);
  assert.equal(janelas.m1, 7);
  assert.equal(janelas.m2, 8);
  assert.equal(janelas.m3, 9);
  assert.equal(janelas.acumuladoFuturo, 10 + 11 + 12); // out..dez
});

test('calcularJanelas returns null for M+1..M+3 when they fall past the end of the 12-month array', () => {
  const mensal = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const janelas = calcularJanelas(mensal, 11); // vigente = dez (último mês)
  assert.equal(janelas.mesVigente, 12);
  assert.equal(janelas.m1, null);
  assert.equal(janelas.m2, null);
  assert.equal(janelas.m3, null);
  assert.equal(janelas.acumuladoFuturo, 0);
});

test('dividir returns null instead of Infinity/NaN when the denominator is zero or null', () => {
  assert.equal(dividir(100, 0), null);
  assert.equal(dividir(100, null), null);
  assert.equal(dividir(100, 4), 25);
});

test('dividirJanelas divides two Janelas bucket-by-bucket', () => {
  const financeiro = calcularJanelas([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100], 5);
  const volume = calcularJanelas([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10], 5);
  const ticket = dividirJanelas(financeiro, volume);
  assert.equal(ticket.acumuladoAnterior, 10); // 500/50
  assert.equal(ticket.mesVigente, 10);
});

test('computeOrcamento: Previsto produtividade/ticketMedio are the sheet\'s own flat premise values, never recomputed per bucket', () => {
  const registro = {
    grupo: 'PÁTRIA', tipologia: 'SM',
    previsto: {
      equipes: Array(12).fill(5), equipesResumo: { pico: 6, media: 5, prod: 1.5, dias: 25 },
      volume: Array(12).fill(100), volumeResumo: { total: 1200, totalInicial: 1000, ticket: 1885.65 },
      financeiro: Array(12).fill(1000), financeiroResumo: { total: 12000, totalInicial: 10000 },
    },
    realizado: null, total: null,
  };
  const [resultado] = computeOrcamento([registro], 0);
  assert.equal(resultado.resumo.previsto.produtividade, 1.5);
  assert.equal(resultado.resumo.previsto.ticketMedio, 1885.65);
});

test('computeOrcamento: Realizado produtividade = volume ÷ equipes and ticketMedio = financeiro ÷ volume, accumulated per bucket', () => {
  const registro = {
    grupo: 'PÁTRIA', tipologia: 'SM',
    previsto: null,
    realizado: {
      equipes: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4], equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 },
      volume: [80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80], volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
      financeiro: [800, 800, 800, 800, 800, 800, 800, 800, 800, 800, 800, 800], financeiroResumo: { total: 0, totalInicial: 0 },
    },
    total: null,
  };
  const [resultado] = computeOrcamento([registro], 3); // vigente = índice 3 -> acumuladoAnterior soma 3 meses
  assert.equal(resultado.resumo.realizado.produtividade.acumuladoAnterior, (80 * 3) / (4 * 3)); // 20
  assert.equal(resultado.resumo.realizado.ticketMedio.acumuladoAnterior, (800 * 3) / (80 * 3)); // 10
  assert.equal(resultado.resumo.realizado.produtividade.mesVigente, 80 / 4);
});

test('computeOrcamento leaves resumo.previsto/realizado/total null when the source registro has no data for that dimension', () => {
  const registro = { grupo: 'X', tipologia: 'Y', previsto: null, realizado: null, total: null };
  const [resultado] = computeOrcamento([registro], 0);
  assert.equal(resultado.resumo.previsto, null);
  assert.equal(resultado.resumo.realizado, null);
  assert.equal(resultado.resumo.total, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/orcamento-compute-orcamento.test.js`
Expected: FAIL with "Cannot find module '../tools/orcamento/compute-orcamento.js'"

- [ ] **Step 3: Write minimal implementation**

```js
// tools/orcamento/compute-orcamento.js
'use strict';

function somarMeses(mensal, inicioIdx, fimIdxExclusivo) {
  let soma = 0;
  for (let i = Math.max(0, inicioIdx); i < Math.min(mensal.length, fimIdxExclusivo); i++) {
    soma += mensal[i] || 0;
  }
  return soma;
}

function valorMes(mensal, idx) {
  if (idx < 0 || idx >= mensal.length) return null;
  return mensal[idx] || 0;
}

// vigenteIdx: índice 0-based (0=janeiro) do mês vigente dentro do array de
// 12 meses. acumuladoAnterior/acumuladoFuturo somam vários meses; mês
// vigente/M+1/M+2/M+3 são cada um um único mês.
function calcularJanelas(mensal, vigenteIdx) {
  return {
    acumuladoAnterior: somarMeses(mensal, 0, vigenteIdx),
    mesVigente: valorMes(mensal, vigenteIdx),
    m1: valorMes(mensal, vigenteIdx + 1),
    m2: valorMes(mensal, vigenteIdx + 2),
    m3: valorMes(mensal, vigenteIdx + 3),
    acumuladoFuturo: somarMeses(mensal, vigenteIdx + 4, mensal.length),
  };
}

function dividir(numerador, denominador) {
  if (!denominador) return null;
  return numerador / denominador;
}

const BUCKETS = ['acumuladoAnterior', 'mesVigente', 'm1', 'm2', 'm3', 'acumuladoFuturo'];

function dividirJanelas(numeradorJanelas, denominadorJanelas) {
  const resultado = {};
  for (const bucket of BUCKETS) {
    resultado[bucket] = dividir(numeradorJanelas[bucket], denominadorJanelas[bucket]);
  }
  return resultado;
}

// Previsto nunca recalcula nada: produtividade e ticket médio do Previsto
// são as premissas digitadas na planilha (PROD. e TICKET, um valor só pro
// ano inteiro) -- confirmado com o usuário, são a mesma premissa usada pra
// montar o próprio Previsto, não uma razão derivada por período.
function calcularDimensaoPrevisto(valoresPrevisto, vigenteIdx) {
  return {
    equipes: calcularJanelas(valoresPrevisto.equipes, vigenteIdx),
    volume: calcularJanelas(valoresPrevisto.volume, vigenteIdx),
    financeiro: calcularJanelas(valoresPrevisto.financeiro, vigenteIdx),
    produtividade: valoresPrevisto.equipesResumo.prod,
    ticketMedio: valoresPrevisto.volumeResumo.ticket,
  };
}

// Realizado e Total recalculam produtividade/ticket médio a partir dos
// próprios números apurados em cada período (confirmado com o usuário:
// "ticket médio realizado = total medido / volume realizado, acumulado no
// período"; "produtividade realizada = volumetria realizada / equipes
// mobilizadas, acumulado no período") -- nunca usam PROD./TICKET da
// planilha, que só existem como premissa do Previsto.
function calcularDimensaoApurada(valores, vigenteIdx) {
  const janelasEquipes = calcularJanelas(valores.equipes, vigenteIdx);
  const janelasVolume = calcularJanelas(valores.volume, vigenteIdx);
  const janelasFinanceiro = calcularJanelas(valores.financeiro, vigenteIdx);
  return {
    equipes: janelasEquipes,
    volume: janelasVolume,
    financeiro: janelasFinanceiro,
    produtividade: dividirJanelas(janelasVolume, janelasEquipes),
    ticketMedio: dividirJanelas(janelasFinanceiro, janelasVolume),
  };
}

function calcularResumoRegistro(registro, vigenteIdx) {
  return {
    previsto: registro.previsto ? calcularDimensaoPrevisto(registro.previsto, vigenteIdx) : null,
    realizado: registro.realizado ? calcularDimensaoApurada(registro.realizado, vigenteIdx) : null,
    total: registro.total ? calcularDimensaoApurada(registro.total, vigenteIdx) : null,
  };
}

function computeOrcamento(registros, vigenteIdx) {
  return registros.map(registro => ({ ...registro, resumo: calcularResumoRegistro(registro, vigenteIdx) }));
}

module.exports = { computeOrcamento, calcularJanelas, dividir, dividirJanelas };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/orcamento-compute-orcamento.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add tools/orcamento/compute-orcamento.js test/orcamento-compute-orcamento.test.js
git commit -m "Add period-window and produtividade/ticket médio computation"
```

---

### Task 6: render-dashboard.js (HTML table, filters, live client-side recompute)

**Files:**
- Create: `tools/orcamento/render-dashboard.js`
- Test: `test/orcamento-render-dashboard.test.js`

**Interfaces:**
- Consumes: `registro[]` from `parse-matriz.js` (Task 4, the RAW records — this module embeds them as JSON and recomputes client-side, it does not take pre-computed `computeOrcamento` output as input, to avoid needing 12 server-rendered variants); `formatarMesAno`/`excelSerialParaData` from `datas.js` (Task 3); the pure functions from `compute-orcamento.js` (Task 5) are mirrored (re-implemented, not required — client-side JS can't `require()` a Node module) inside the generated inline `<script>`.
- Produces: `renderDashboard({ registros, periodos, generatedAt }) -> string` (a complete HTML document). `periodos` is `Date[12]` (the 12 month headers, from Task 3's date helpers). Task 7 calls this.

- [ ] **Step 1: Write the failing test**

```js
// test/orcamento-render-dashboard.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderDashboard } = require('../tools/orcamento/render-dashboard.js');
const { excelSerialParaData } = require('../tools/orcamento/datas.js');

function registroExemplo() {
  return {
    grupo: 'PÁTRIA', tomador: 'Via Araucária S.A', tipologia: 'SM', observacao: null,
    previsto: {
      equipes: Array(12).fill(5), equipesResumo: { pico: 6, media: 5, prod: 1.5, dias: 25 },
      volume: Array(12).fill(100), volumeResumo: { total: 1200, totalInicial: 1000, ticket: 1885.65 },
      financeiro: Array(12).fill(1000), financeiroResumo: { total: 12000, totalInicial: 10000 },
    },
    realizado: {
      equipes: Array(12).fill(4), equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 },
      volume: Array(12).fill(80), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
      financeiro: Array(12).fill(800), financeiroResumo: { total: 0, totalInicial: 0 },
    },
    total: {
      equipes: Array(12).fill(4.5), equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 },
      volume: Array(12).fill(90), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
      financeiro: Array(12).fill(900), financeiroResumo: { total: 0, totalInicial: 0 },
    },
  };
}

function periodosExemplo() {
  const periodos = [];
  for (let i = 0; i < 12; i++) periodos.push(excelSerialParaData(46023 + i * 30));
  return periodos;
}

test('renderDashboard embeds one row per registro, with tipologia and contrato as data attributes for filtering', () => {
  const html = renderDashboard({ registros: [registroExemplo()], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  assert.match(html, /data-tipologia="SM"/);
  assert.match(html, /data-grupo="PÁTRIA"/);
});

test('renderDashboard includes a mês vigente dropdown with all 12 months formatted as "Mês/Ano"', () => {
  const html = renderDashboard({ registros: [registroExemplo()], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  assert.match(html, /Jan\/2026/);
  assert.match(html, /Dez\/2026/);
});

test('renderDashboard embeds the raw registros as JSON for the client-side recompute script', () => {
  const html = renderDashboard({ registros: [registroExemplo()], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  assert.match(html, /window\.__REGISTROS__\s*=\s*\[/);
  assert.match(html, /"tipologia":"SM"/);
});

test('renderDashboard includes tipologia and contrato filter dropdowns populated from distinct registro values', () => {
  const registros = [registroExemplo(), { ...registroExemplo(), grupo: 'SYSTRA', tomador: 'Ecopistas', tipologia: 'ST' }];
  const html = renderDashboard({ registros, periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  assert.match(html, /<option value="SM">SM<\/option>/);
  assert.match(html, /<option value="ST">ST<\/option>/);
  assert.match(html, /<option value="PÁTRIA">PÁTRIA<\/option>/);
  assert.match(html, /<option value="SYSTRA">SYSTRA<\/option>/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: FAIL with "Cannot find module '../tools/orcamento/render-dashboard.js'"

- [ ] **Step 3: Write minimal implementation**

```js
// tools/orcamento/render-dashboard.js
'use strict';
const { formatarMesAno } = require('./datas.js');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function linhasDistintas(registros, campo) {
  return [...new Set(registros.map(r => r[campo]).filter(Boolean))].sort();
}

function renderFiltroTipologia(registros) {
  const tipologias = linhasDistintas(registros, 'tipologia');
  return `<select id="filtro-tipologia"><option value="">Todas as tipologias</option>` +
    tipologias.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('') +
    `</select>`;
}

function renderFiltroContrato(registros) {
  const grupos = linhasDistintas(registros, 'grupo');
  return `<select id="filtro-contrato"><option value="">Todos os contratos</option>` +
    grupos.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('') +
    `</select>`;
}

function renderSeletorMesVigente(periodos) {
  return `<select id="seletor-mes-vigente">` +
    periodos.map((data, i) => `<option value="${i}">${formatarMesAno(data)}</option>`).join('') +
    `</select>`;
}

function renderSeletorDimensao() {
  return `<select id="seletor-dimensao">` +
    `<option value="equipes">Equipes</option>` +
    `<option value="volume">Volume</option>` +
    `<option value="financeiro">Financeiro</option>` +
    `</select>`;
}

function renderLinhaTabela(registro) {
  return `<tr data-tipologia="${escapeHtml(registro.tipologia)}" data-grupo="${escapeHtml(registro.grupo)}">` +
    `<td>${escapeHtml(registro.grupo)}</td>` +
    `<td>${escapeHtml(registro.tomador)}</td>` +
    `<td>${escapeHtml(registro.tipologia)}</td>` +
    `<td colspan="6" class="celula-periodos" data-linha-periodos></td>` +
    `</tr>`;
}

// A tabela é renderizada no servidor com os registros crus (previsto/
// realizado/total mês a mês); o script embutido abaixo reimplementa as
// mesmas fórmulas de tools/orcamento/compute-orcamento.js em JS de
// navegador (sem require -- é HTML estático, sem bundler) pra recalcular
// as janelas de período sempre que o mês vigente, a dimensão ou os filtros
// mudarem, sem recarregar a página.
const SCRIPT_CLIENTE = `
function somarMeses(mensal, inicioIdx, fimIdxExclusivo) {
  let soma = 0;
  for (let i = Math.max(0, inicioIdx); i < Math.min(mensal.length, fimIdxExclusivo); i++) soma += mensal[i] || 0;
  return soma;
}
function valorMes(mensal, idx) { return (idx < 0 || idx >= mensal.length) ? null : (mensal[idx] || 0); }
function calcularJanelas(mensal, vigenteIdx) {
  return {
    acumuladoAnterior: somarMeses(mensal, 0, vigenteIdx),
    mesVigente: valorMes(mensal, vigenteIdx),
    m1: valorMes(mensal, vigenteIdx + 1), m2: valorMes(mensal, vigenteIdx + 2), m3: valorMes(mensal, vigenteIdx + 3),
    acumuladoFuturo: somarMeses(mensal, vigenteIdx + 4, mensal.length),
  };
}
function dividir(n, d) { return d ? n / d : null; }
function dividirJanelas(num, den) {
  var buckets = ['acumuladoAnterior', 'mesVigente', 'm1', 'm2', 'm3', 'acumuladoFuturo'];
  var r = {};
  buckets.forEach(function (b) { r[b] = dividir(num[b], den[b]); });
  return r;
}
function formatarNumero(v) { return v === null || v === undefined ? '—' : (Math.round(v * 100) / 100).toLocaleString('pt-BR'); }

function renderizarCelulasPeriodo(registro, dimensao, vigenteIdx) {
  var previsto = registro.previsto ? calcularJanelas(registro.previsto[dimensao], vigenteIdx) : null;
  var realizado = registro.realizado ? calcularJanelas(registro.realizado[dimensao], vigenteIdx) : null;
  var buckets = [['acumuladoAnterior', 'Acum. anterior'], ['mesVigente', 'Mês vigente'], ['m1', 'M+1'], ['m2', 'M+2'], ['m3', 'M+3'], ['acumuladoFuturo', 'Acum. futuro']];
  return buckets.map(function (par) {
    var chave = par[0];
    var p = previsto ? formatarNumero(previsto[chave]) : '—';
    var r = realizado ? formatarNumero(realizado[chave]) : '—';
    return '<span class="periodo-cell" title="' + par[1] + '">P: ' + p + ' / R: ' + r + '</span>';
  }).join('');
}

function recalcularTabela() {
  var vigenteIdx = Number(document.getElementById('seletor-mes-vigente').value);
  var dimensao = document.getElementById('seletor-dimensao').value;
  var filtroTipologia = document.getElementById('filtro-tipologia').value;
  var filtroContrato = document.getElementById('filtro-contrato').value;
  var linhas = document.querySelectorAll('#tabela-orcamento tbody tr');
  linhas.forEach(function (linha, i) {
    var registro = window.__REGISTROS__[i];
    var mostra = (!filtroTipologia || linha.dataset.tipologia === filtroTipologia) &&
      (!filtroContrato || linha.dataset.grupo === filtroContrato);
    linha.style.display = mostra ? '' : 'none';
    var celula = linha.querySelector('[data-linha-periodos]');
    celula.innerHTML = renderizarCelulasPeriodo(registro, dimensao, vigenteIdx);
  });
}

['seletor-mes-vigente', 'seletor-dimensao', 'filtro-tipologia', 'filtro-contrato'].forEach(function (id) {
  document.getElementById(id).addEventListener('change', recalcularTabela);
});
recalcularTabela();
`;

function renderDashboard({ registros, periodos, generatedAt }) {
  const linhasTabela = registros.map(renderLinhaTabela).join('');
  const registrosJson = JSON.stringify(registros.map(r => ({
    grupo: r.grupo, tomador: r.tomador, tipologia: r.tipologia,
    previsto: r.previsto, realizado: r.realizado, total: r.total,
  })));

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>ORÇAMENTO — MATRIZ</title>
<style>
  body { font-family: Arial, sans-serif; padding: 16px; }
  .filtros { display: flex; gap: 12px; margin-bottom: 16px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; font-size: 13px; text-align: left; }
  .periodo-cell { display: inline-block; margin-right: 10px; white-space: nowrap; }
</style>
</head>
<body>
  <h1>ORÇAMENTO — MATRIZ</h1>
  <div class="generated">Gerado em ${escapeHtml(generatedAt.toLocaleString('pt-BR'))}</div>
  <div class="filtros">
    ${renderFiltroTipologia(registros)}
    ${renderFiltroContrato(registros)}
    ${renderSeletorMesVigente(periodos)}
    ${renderSeletorDimensao()}
  </div>
  <table id="tabela-orcamento">
    <thead><tr><th>Grupo</th><th>Tomador</th><th>Tipologia</th><th>Previsto x Realizado por período</th></tr></thead>
    <tbody>${linhasTabela}</tbody>
  </table>
  <script>window.__REGISTROS__ = ${registrosJson};</script>
  <script>${SCRIPT_CLIENTE}</script>
</body>
</html>`;
}

module.exports = { renderDashboard };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add tools/orcamento/render-dashboard.js test/orcamento-render-dashboard.test.js
git commit -m "Add filterable dashboard table with live client-side mês-vigente recompute"
```

---

### Task 7: build-dashboard.js + config.js (orchestration)

**Files:**
- Create: `tools/orcamento/config.js`
- Create: `tools/orcamento/build-dashboard.js`

**Interfaces:**
- Consumes: `readXlsxSheet` (Task 3), `parseMatriz` (Task 4), `renderDashboard` (Task 6), `excelSerialParaData` (Task 3).
- Produces: `build({ outPath, today }) -> resolvedOutPath` (mirrors matriz-equipes-source's `build-dashboard.js` shape, for consistency). No test file for this task — it is a thin orchestration wrapper around already-tested modules, verified instead by Task 8's end-to-end test.

- [ ] **Step 1: Write config.js**

```js
// tools/orcamento/config.js
'use strict';

module.exports = {
  caminhoArquivo: 'G:\\Meu Drive\\PMO\\06 - Orçamento\\OR26 - Rev 01 - Frcst 6+6\\Modelo\\OR - 2026 (04.A) - Base Frcst 6+6 Atual R00.1.xlsx',
  nomeAba: 'MATRIZ',
};
```

- [ ] **Step 2: Write build-dashboard.js**

```js
// tools/orcamento/build-dashboard.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { readXlsxSheet } = require('./xlsx-reader.js');
const { parseMatriz, locateColumns } = require('./parse-matriz.js');
const { renderDashboard } = require('./render-dashboard.js');
const { excelSerialParaData } = require('./datas.js');
const config = require('./config.js');

function build({ outPath, today = new Date() } = {}) {
  const grid = readXlsxSheet(config.caminhoArquivo, config.nomeAba);
  const registros = parseMatriz(grid);

  const columns = locateColumns(grid);
  const headerRow = grid[1];
  const periodos = columns.equipesMeses.map(col => excelSerialParaData(headerRow[col]));

  const html = renderDashboard({ registros, periodos, generatedAt: today });

  const resolvedOutPath = outPath || path.join(__dirname, '..', '..', 'dist', 'orcamento-dashboard.html');
  fs.mkdirSync(path.dirname(resolvedOutPath), { recursive: true });
  fs.writeFileSync(resolvedOutPath, html, 'utf8');
  console.log(`Wrote ${html.length} bytes to ${resolvedOutPath}`);
  return resolvedOutPath;
}

if (require.main === module) {
  try {
    build();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

module.exports = { build };
```

- [ ] **Step 3: Manually verify against the real spreadsheet**

Run: `node tools/orcamento/build-dashboard.js`
Expected: `Wrote <N> bytes to .../dist/orcamento-dashboard.html` with no error. If it throws `Coluna "..." não encontrada` or `Esperava a coluna "..."`, the real sheet's header layout differs from what Task 4 assumed — stop and re-inspect the real header row before proceeding (do not adjust column offsets blindly).

- [ ] **Step 4: Commit**

```bash
git add tools/orcamento/config.js tools/orcamento/build-dashboard.js
git commit -m "Add build-dashboard orchestration reading the real MATRIZ spreadsheet"
```

---

### Task 8: End-to-end integration test, launcher, final review

**Files:**
- Test: `test/orcamento-build-dashboard.test.js`
- Create: `dist/Abrir Dashboard.bat`

**Interfaces:**
- Consumes: `build` from `build-dashboard.js` (Task 7), with `outPath` overridden to a temp file and the real `config.caminhoArquivo`/`nomeAba` swapped for a synthetic fixture built with the zip helper — this test does NOT depend on the real spreadsheet being present on disk (it would fail on any machine without the G:\ drive mounted).

- [ ] **Step 1: Write the failing end-to-end test**

This builds a small but structurally realistic synthetic .xlsx (header + one "Todos" block to skip + two contracts with two tipologias each + a MENSAL/ACUMULADO trailer) and drives `build()` against it via a monkey-patched config, asserting the final HTML contains the expected rows and none of the skipped ones.

```js
// test/orcamento-build-dashboard.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildMinimalZip } = require('./helpers/build-zip.js');

function celulaNum(ref, valor) { return `<c r="${ref}"><v>${valor}</v></c>`; }
function celulaStr(sharedIndex, ref) { return `<c r="${ref}" t="s"><v>${sharedIndex}</v></c>`; }

// Monta uma aba MATRIZ sintética mas estruturalmente real: cabeçalho (linha
// 1), um bloco "Todos" pra confirmar que é ignorado, 1 contrato real com 2
// tipologias, e um par MENSAL/ACUMULADO no fim do contrato pra confirmar
// que também é ignorado.
function construirPlanilhaTeste() {
  const sharedStrings = ['ORIGEM', 'GRUPO', 'TOMADOR', 'SUP', 'ESCOPO', 'APOIO', 'INICIO', 'TERMINO', 'SONDAGEM',
    'Demanda à cadastrar', 'Demanda Cadastrada', 'BASE', 'PICO', 'MÉDIA', 'PROD.', 'DIAS', 'TOTAL', 'TOTAL INICIAL', 'TICKET', 'OBSERVAÇÃO',
    'Todos', 'P', 'R', 'T', 'SP', 'CONTRATO VIGENTE', 'PÁTRIA', 'Via Araucária S.A', 'SM', 'MENSAL', 'ACUMULADO'];
  const idx = name => sharedStrings.indexOf(name);

  function linhaHeaderXml() {
    let cells = celulaStr(idx('ORIGEM'), 'B1') + celulaStr(idx('GRUPO'), 'C1') + celulaStr(idx('TOMADOR'), 'D1') +
      celulaStr(idx('SUP'), 'E1') + celulaStr(idx('ESCOPO'), 'F1') + celulaStr(idx('APOIO'), 'G1') +
      celulaStr(idx('INICIO'), 'H1') + celulaStr(idx('TERMINO'), 'I1') + celulaStr(idx('SONDAGEM'), 'J1') +
      celulaStr(idx('Demanda à cadastrar'), 'K1') + celulaStr(idx('Demanda Cadastrada'), 'L1') + celulaStr(idx('BASE'), 'M1');
    const letras = ['N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y'];
    letras.forEach((l, i) => { cells += celulaNum(`${l}1`, 46023 + i * 30); });
    cells += celulaStr(idx('PICO'), 'Z1') + celulaStr(idx('MÉDIA'), 'AA1') + celulaStr(idx('PROD.'), 'AB1') + celulaStr(idx('DIAS'), 'AC1');
    const letras2 = ['AD', 'AE', 'AF', 'AG', 'AH', 'AI', 'AJ', 'AK', 'AL', 'AM', 'AN', 'AO'];
    letras2.forEach((l, i) => { cells += celulaNum(`${l}1`, 46023 + i * 30); });
    cells += celulaStr(idx('TOTAL'), 'AP1') + celulaStr(idx('TOTAL INICIAL'), 'AQ1') + celulaStr(idx('TICKET'), 'AR1');
    const letras3 = ['AS', 'AT', 'AU', 'AV', 'AW', 'AX', 'AY', 'AZ', 'BA', 'BB', 'BC', 'BD'];
    letras3.forEach((l, i) => { cells += celulaNum(`${l}1`, 46023 + i * 30); });
    cells += celulaStr(idx('TOTAL'), 'BE1') + celulaStr(idx('TOTAL INICIAL'), 'BF1') + celulaStr(idx('OBSERVAÇÃO'), 'BG1');
    return `<row r="1">${cells}</row>`;
  }

  // Uma linha "vazia" só com BASE e os 3 meses/resumos zerados -- usada pras
  // linhas R/T de cada tripla e pro bloco Todos (não precisamos de valores
  // reais nelas pra este teste, só confirmar inclusão/exclusão).
  function linhaMinima(rowNum, baseIdx, tipologiaIdx, grupoIdx) {
    let cells = celulaStr(baseIdx, `M${rowNum}`);
    if (tipologiaIdx !== undefined) cells += celulaStr(tipologiaIdx, `J${rowNum}`);
    if (grupoIdx !== undefined) cells += celulaStr(grupoIdx, `C${rowNum}`);
    return `<row r="${rowNum}">${cells}</row>`;
  }

  let rows = linhaHeaderXml();
  let r = 2;
  // Bloco "Todos" (deve ser ignorado).
  rows += linhaMinima(r++, idx('P'), idx('SP'), idx('Todos'));
  rows += linhaMinima(r++, idx('R'));
  rows += linhaMinima(r++, idx('T'));
  // Contrato real PÁTRIA, tipologia SP.
  rows += linhaMinima(r++, idx('P'), idx('SP'), idx('PÁTRIA'));
  rows += linhaMinima(r++, idx('R'));
  rows += linhaMinima(r++, idx('T'));
  // Contrato real PÁTRIA, tipologia SM.
  rows += linhaMinima(r++, idx('P'), idx('SM'));
  rows += linhaMinima(r++, idx('R'));
  rows += linhaMinima(r++, idx('T'));
  // Trailer MENSAL/ACUMULADO do contrato PÁTRIA (deve ser ignorado).
  rows += linhaMinima(r++, idx('P'), idx('MENSAL'));
  rows += linhaMinima(r++, idx('R'));
  rows += linhaMinima(r++, idx('T'));
  rows += linhaMinima(r++, idx('P'), idx('ACUMULADO'));
  rows += linhaMinima(r++, idx('R'));
  rows += linhaMinima(r++, idx('T'));

  const sheetXml = `<worksheet><sheetData>${rows}</sheetData></worksheet>`;
  const workbookXml = '<?xml version="1.0"?><workbook xmlns:r="rels"><sheets><sheet name="MATRIZ" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const relsXml = '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>';
  const sharedStringsXml = '<sst>' + sharedStrings.map(s => `<si><t>${s}</t></si>`).join('') + '</sst>';

  return buildMinimalZip([
    { name: 'xl/workbook.xml', data: Buffer.from(workbookXml, 'utf8'), method: 0 },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(relsXml, 'utf8'), method: 0 },
    { name: 'xl/sharedStrings.xml', data: Buffer.from(sharedStringsXml, 'utf8'), method: 0 },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml, 'utf8'), method: 8 },
  ]);
}

test('build() reads a synthetic MATRIZ, skips the aggregate/trailer rows, and writes a dashboard HTML with only the 2 real tipologia rows', () => {
  const xlsxPath = path.join(os.tmpdir(), `orcamento-e2e-${Date.now()}.xlsx`);
  fs.writeFileSync(xlsxPath, construirPlanilhaTeste());
  const outPath = path.join(os.tmpdir(), `orcamento-dashboard-e2e-${Date.now()}.html`);

  // Troca a config real por uma apontando pra planilha sintética -- o
  // require cache garante que build-dashboard.js enxergue essa troca antes
  // de carregá-lo pela primeira vez neste processo de teste.
  const configPath = require.resolve('../tools/orcamento/config.js');
  delete require.cache[configPath];
  require.cache[configPath] = {
    id: configPath, filename: configPath, loaded: true,
    exports: { caminhoArquivo: xlsxPath, nomeAba: 'MATRIZ' },
  };
  const buildPath = require.resolve('../tools/orcamento/build-dashboard.js');
  delete require.cache[buildPath];
  const { build } = require(buildPath);

  try {
    build({ outPath, today: new Date(2026, 6, 21) });
    const html = fs.readFileSync(outPath, 'utf8');
    assert.match(html, /data-tipologia="SP"/);
    assert.match(html, /data-tipologia="SM"/);
    assert.doesNotMatch(html, /data-tipologia="MENSAL"/);
    assert.doesNotMatch(html, /data-tipologia="ACUMULADO"/);
    assert.doesNotMatch(html, /data-grupo="Todos"/);
  } finally {
    fs.unlinkSync(xlsxPath);
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    delete require.cache[configPath];
    delete require.cache[buildPath];
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/orcamento-build-dashboard.test.js`
Expected: FAIL (either a module resolution error if any earlier task file is missing, or an assertion failure if the skip logic has a gap) — confirm the failure reason matches what's still missing, not an unrelated bug.

- [ ] **Step 3: Fix any gap found, then re-run to verify it passes**

Run: `node --test test/orcamento-build-dashboard.test.js`
Expected: PASS (1 test)

- [ ] **Step 4: Run the full test suite**

Run: `node --test test/`
Expected: All tests across every `test/orcamento-*.test.js` file PASS.

- [ ] **Step 5: Create the dashboard launcher**

```bat
@echo off
start "" "%~dp0orcamento-dashboard.html"
```

Save as `dist/Abrir Dashboard.bat` (matches the sister project's launcher convention).

- [ ] **Step 6: Build the real dashboard and eyeball it**

Run: `node tools/orcamento/build-dashboard.js`
Then open `dist/orcamento-dashboard.html` in a browser and check: the tipologia/contrato dropdowns list real values, changing "mês vigente" updates the P/R numbers without a page reload, and no row shows `Todos`/`MENSAL`/`ACUMULADO` as its tipologia or grupo.

- [ ] **Step 7: Commit**

```bash
git add dist/ test/orcamento-build-dashboard.test.js
git commit -m "Add end-to-end build test, dashboard launcher, and first real build"
```

---

## Plan Self-Review Notes

- **Spec coverage:** Filtro por tipologia/contrato → Task 6. Janelas de período (acumulado anterior/mês vigente/M+1-3/acumulado futuro) → Task 5. Previsto x Realizado → Tasks 5-6. Produtividade/ticket médio com as fórmulas confirmadas → Task 5. Leitura direta do .xlsx local sem publicação → Tasks 1-3, 7. Zero dependências npm → every task. Repositório próprio, privado → already created and confirmed by the user before this plan was written (see spec). Deploy no GitHub Pages privado → intentionally NOT a task here: it depends on whether the user's GitHub plan supports Pages on a private repo, which is unconfirmed; raise it again once v1 is working locally, rather than building deploy plumbing against an unconfirmed capability.
- **Placeholder scan:** no TBD/TODO; every step has complete, runnable code.
- **Type consistency:** `registro` shape (from Task 4) is used identically in Tasks 5, 6, 8. `Janelas` shape (from Task 5) matches between the Node implementation and its client-side mirror in Task 6. Column index names in `locateColumns` (Task 4) match the field names consumed in `extrairValoresLinha`.
