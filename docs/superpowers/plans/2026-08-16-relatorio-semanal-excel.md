# Relatório Semanal em Excel — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um botão na aba Consolidado de `planejamento-semanal.html` que gera, 100% no navegador, um `.xlsx` gerencial (Previsto/Realizado/Tendência de Volume e Equipes, por tipologia e contrato, em 3 janelas de tempo, com capítulo de desvios e campos de Ação/Responsável) e grava um resumo por geração numa Google Sheet de histórico.

**Architecture:** Um par de módulos browser-safe (zip + xlsx writer, portados de `tools/lib/` do repositório irmão, sem `Buffer`/`zlib`) produz o `.xlsx` puro. Um módulo `compute-relatorio-semanal.js` reaproveita `calcularSeriesSemanaisDimensao`/`agregarFatias`/`classificarSemaforo` (já testados) para montar as 3 janelas e os desvios, sem recalcular nada. Um módulo de renderização monta as 4 abas do arquivo a partir disso. Um cliente dual Node+navegador (mesmo molde de `alocacao-sheet.js`) grava o histórico numa Sheet via Apps Script. Tudo entra no bundle do navegador que `render-semanal.js` já monta.

**Tech Stack:** Node.js puro (sem dependências), JavaScript vanilla no navegador (`var`/`function`, sem ES modules — mesma convenção do resto de `tools/semanal/`), Google Apps Script.

## Global Constraints

- Sem dependências externas (nem npm, nem CDN) — `Uint8Array`/`DataView`/`TextEncoder`/`ArrayBuffer`, todos nativos em Node e navegador.
- Arquivos que entram no bundle do navegador (`tools/semanal/*.js` referenciados em `BUNDLE_ARQUIVOS`, `render-semanal.js`) usam `'use strict'` + `var`/`function` (nunca `const`/`let`/arrow no nível que precisa rodar embrulhado) e só fazem `require('./mesmo-diretorio.js')` — um `require('../algo.js')` é REMOVIDO pelo bundler, não reescrito (ver `tools/comum/browser-bundle.js`).
- `escapeHtml`/`escapeXml`/formatação numérica em pt-BR: siga os padrões já duplicados em cada módulo do bundle (não importe de `tools/comum/` num arquivo do bundle).
- Testes: `node --test test/*.test.js`, todos offline (sem rede, sem `G:\`).
- Volume/Financeiro sempre em números inteiros (0 casas); Equipes sempre com 2 casas (é média ponderada) — convenção do projeto inteiro.
- Nenhuma senha ou URL de produção em texto puro no repositório — a URL do Apps Script de histórico é um placeholder `'PENDENTE-...'` até o dono do projeto publicar e trocar manualmente (mesmo padrão de `URL_ALOCACAO`).

---

## Task 1: `zip-writer-browser.js` — ZIP sem compressão, browser-safe

**Files:**
- Create: `tools/semanal/zip-writer-browser.js`
- Test: `test/semanal-zip-writer-browser.test.js`

**Interfaces:**
- Produces: `createZip(entries)` — `entries: [{name: string, data: Uint8Array}]` → `Uint8Array` (um `.zip` completo, método STORE/sem compressão). `crc32(bytes: Uint8Array) → number` (CRC32 IEEE 802.3, unsigned 32-bit).

- [ ] **Step 1: Escrever o arquivo**

```js
'use strict';

// Porte de tools/lib/zip-writer.js (repositório matriz-equipes-source,
// usado por tools/matriz/gerar-historico-excel.js) para rodar sem Node:
// Buffer/DataView do Node trocados por Uint8Array/DataView puros, e
// zlib.crc32 trocado por uma tabela CRC32 calculada em JS -- mesmo
// algoritmo (IEEE 802.3), mesmo resultado bit a bit. ZIP sem compressão
// (método STORE, 0): xlsx-writer-browser.js grava pouco texto, e
// implementar deflate não vale a complexidade extra aqui.

var CRC_TABLE = (function () {
  var tabela = [];
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    tabela[n] = c >>> 0;
  }
  return tabela;
})();

function crc32(bytes) {
  var crc = 0xFFFFFFFF;
  for (var i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function textoParaBytes(texto) {
  return new TextEncoder().encode(texto);
}

function concatBytes(partes) {
  var total = 0;
  for (var i = 0; i < partes.length; i++) total += partes[i].length;
  var saida = new Uint8Array(total);
  var offset = 0;
  for (var j = 0; j < partes.length; j++) { saida.set(partes[j], offset); offset += partes[j].length; }
  return saida;
}

function dosDateTime(date) {
  var time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f);
  var day = (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0xf) << 5) | (date.getDate() & 0x1f);
  return { time: time, day: day };
}

function bloco30(crc, size, nomeLen, time, day) {
  var buf = new ArrayBuffer(30);
  var view = new DataView(buf);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, time, true);
  view.setUint16(12, day, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, nomeLen, true);
  view.setUint16(28, 0, true);
  return new Uint8Array(buf);
}

function blocoCentral46(crc, size, nomeLen, time, day, offset) {
  var buf = new ArrayBuffer(46);
  var view = new DataView(buf);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, time, true);
  view.setUint16(14, day, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, nomeLen, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, offset, true);
  return new Uint8Array(buf);
}

function blocoEocd(numEntradas, tamanhoCentral, offsetCentral) {
  var buf = new ArrayBuffer(22);
  var view = new DataView(buf);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, numEntradas, true);
  view.setUint16(10, numEntradas, true);
  view.setUint32(12, tamanhoCentral, true);
  view.setUint32(16, offsetCentral, true);
  view.setUint16(20, 0, true);
  return new Uint8Array(buf);
}

// entries: [{ name: string, data: Uint8Array }] -> Uint8Array (.zip completo)
function createZip(entries) {
  var localPartes = [];
  var centralPartes = [];
  var offset = 0;
  var dt = dosDateTime(new Date());

  entries.forEach(function (entrada) {
    var nomeBytes = textoParaBytes(entrada.name);
    var crc = crc32(entrada.data);
    var size = entrada.data.length;

    localPartes.push(bloco30(crc, size, nomeBytes.length, dt.time, dt.day), nomeBytes, entrada.data);
    centralPartes.push(blocoCentral46(crc, size, nomeBytes.length, dt.time, dt.day, offset), nomeBytes);

    offset += 30 + nomeBytes.length + entrada.data.length;
  });

  var centralOffset = offset;
  var central = concatBytes(centralPartes);
  var eocd = blocoEocd(entries.length, central.length, centralOffset);

  return concatBytes(localPartes.concat([central, eocd]));
}

module.exports = { createZip, crc32 };
```

- [ ] **Step 2: Escrever o teste**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { createZip, crc32 } = require('../tools/semanal/zip-writer-browser.js');

test('crc32 bate byte a byte com zlib.crc32 do Node, para o mesmo conteúdo', () => {
  const bytes = new TextEncoder().encode('conteudo de teste,com virgula\n');
  const esperado = zlib.crc32(Buffer.from(bytes)) >>> 0;
  assert.strictEqual(crc32(bytes), esperado);
});

test('crc32 de bytes vazios é 0 (mesma convenção de zlib.crc32)', () => {
  assert.strictEqual(crc32(new Uint8Array(0)), 0);
});

test('createZip produz um .zip de verdade, extraível por unzip, com os bytes originais preservados', () => {
  const entradas = [
    { name: 'a.txt', data: new TextEncoder().encode('primeiro arquivo') },
    { name: 'pasta/b.txt', data: new TextEncoder().encode('segundo arquivo, um pouco maior que o primeiro') },
  ];
  const bytes = createZip(entradas);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-writer-browser-test-'));
  const zipPath = path.join(tmpDir, 'test.zip');
  fs.writeFileSync(zipPath, Buffer.from(bytes));
  const outDir = path.join(tmpDir, 'out');
  execFileSync('unzip', ['-q', zipPath, '-d', outDir]);
  assert.strictEqual(fs.readFileSync(path.join(outDir, 'a.txt'), 'utf8'), 'primeiro arquivo');
  assert.strictEqual(fs.readFileSync(path.join(outDir, 'pasta', 'b.txt'), 'utf8'), 'segundo arquivo, um pouco maior que o primeiro');
});

test('createZip com zero entradas produz um .zip vazio válido (só o EOCD)', () => {
  const bytes = createZip([]);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-writer-browser-test-'));
  const zipPath = path.join(tmpDir, 'vazio.zip');
  fs.writeFileSync(zipPath, Buffer.from(bytes));
  const outDir = path.join(tmpDir, 'out');
  fs.mkdirSync(outDir);
  execFileSync('unzip', ['-q', zipPath, '-d', outDir]);
  assert.deepStrictEqual(fs.readdirSync(outDir), []);
});
```

- [ ] **Step 3: Rodar o teste e confirmar que passa**

Run: `node --test test/semanal-zip-writer-browser.test.js`
Expected: 4 testes, todos PASS.

- [ ] **Step 4: Commit**

```bash
git add tools/semanal/zip-writer-browser.js test/semanal-zip-writer-browser.test.js
git commit -m "$(cat <<'EOF'
Adiciona zip-writer-browser.js -- ZIP sem compressao, sem Node/Buffer/zlib

Porte de tools/lib/zip-writer.js (repositorio irmao) para Uint8Array/DataView
puros, base do gerador de .xlsx que vai rodar dentro do navegador.
EOF
)"
```

---

## Task 2: `xlsx-writer-browser.js` — gerador de `.xlsx`, browser-safe

**Files:**
- Create: `tools/semanal/xlsx-writer-browser.js`
- Test: `test/semanal-xlsx-writer-browser.test.js`

**Interfaces:**
- Consumes: `createZip(entries)` de `./zip-writer-browser.js` (Task 1).
- Produces: `buildXlsx(sheets) → Uint8Array`, `str(value)`, `num(value)`, `formula(f)` — mesma API de `tools/lib/xlsx-writer.js`. `sheets: [{ name: string, rows: cell[][], conditionalFormats?: [{sqref: string, color: 'critico'|'atencao', text: string}] }]`.

- [ ] **Step 1: Escrever o arquivo**

```js
'use strict';
const { createZip } = require('./zip-writer-browser.js');

// Porte de tools/lib/xlsx-writer.js (repositório matriz-equipes-source) para
// rodar sem Node: Buffer trocado por Uint8Array/TextEncoder, zip-writer.js
// trocado pela variante browser-safe (./zip-writer-browser.js). O formato
// OOXML gerado é idêntico -- só a implementação de baixo nível muda.
//
// Só 2 cores de formatação condicional -- Crítico e Atenção, as únicas que a
// aba Desvios do relatório semanal usa (Excelente/Dentro da meta/Sem dado
// não entram nesse capítulo, ver compute-relatorio-semanal.js).

function colIndexToLetter(idx) {
  var n = idx + 1;
  var letters = '';
  while (n > 0) {
    var rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function str(value) { return { type: 'str', value: String(value) }; }
function num(value) { return { type: 'num', value: value }; }
function formula(f) { return { type: 'formula', formula: f }; }

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function cellXml(cell, ref) {
  if (cell == null) return '';
  if (cell.type === 'str') return '<c r="' + ref + '" t="inlineStr"><is><t>' + escapeXml(cell.value) + '</t></is></c>';
  if (cell.type === 'num') return '<c r="' + ref + '"><v>' + cell.value + '</v></c>';
  if (cell.type === 'formula') return '<c r="' + ref + '"><f>' + escapeXml(cell.formula) + '</f></c>';
  throw new Error('Unknown cell type: ' + cell.type);
}

function rowsXml(rows) {
  var xml = '';
  rows.forEach(function (row, i) {
    var rowNum = i + 1;
    var cellsXml = '';
    row.forEach(function (cell, colIdx) {
      if (cell == null) return;
      cellsXml += cellXml(cell, colIndexToLetter(colIdx) + rowNum);
    });
    xml += '<row r="' + rowNum + '">' + cellsXml + '</row>';
  });
  return xml;
}

var CF_DXF_ID = { critico: 0, atencao: 1 };

function conditionalFormattingXml(conditionalFormats) {
  if (!conditionalFormats || conditionalFormats.length === 0) return '';
  var xml = '';
  conditionalFormats.forEach(function (cf, i) {
    var anchor = cf.sqref.split(':')[0];
    var dxfId = CF_DXF_ID[cf.color];
    xml += '<conditionalFormatting sqref="' + cf.sqref + '">'
      + '<cfRule type="containsText" dxfId="' + dxfId + '" priority="' + (i + 1) + '" operator="containsText" text="' + escapeXml(cf.text) + '">'
      + '<formula>NOT(ISERROR(SEARCH("' + escapeXml(cf.text) + '",' + anchor + ')))</formula>'
      + '</cfRule></conditionalFormatting>';
  });
  return xml;
}

function sheetXml(sheet) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetData>' + rowsXml(sheet.rows) + '</sheetData>'
    + conditionalFormattingXml(sheet.conditionalFormats)
    + '</worksheet>';
}

function stylesXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="1"><font><sz val="10"/><name val="Arial"/></font></fonts>'
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    + '<dxfs count="2">'
    + '<dxf><fill><patternFill><bgColor rgb="FFF4CCCC"/></patternFill></fill></dxf>'
    + '<dxf><fill><patternFill><bgColor rgb="FFFFF2CC"/></patternFill></fill></dxf>'
    + '</dxfs>'
    + '</styleSheet>';
}

function contentTypesXml(sheetCount) {
  var overrides = '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
  for (var i = 1; i <= sheetCount; i++) {
    overrides += '<Override PartName="/xl/worksheets/sheet' + i + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
  }
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + overrides + '</Types>';
}

function rootRelsXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>';
}

function workbookXml(sheetNames) {
  var sheetsXml = '';
  sheetNames.forEach(function (name, i) {
    sheetsXml += '<sheet name="' + escapeXml(name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
  });
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheets>' + sheetsXml + '</sheets></workbook>';
}

function workbookRelsXml(sheetCount) {
  var rels = '';
  for (var i = 1; i <= sheetCount; i++) {
    rels += '<Relationship Id="rId' + i + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + i + '.xml"/>';
  }
  rels += '<Relationship Id="rId' + (sheetCount + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + '</Relationships>';
}

function textoParaBytes(texto) { return new TextEncoder().encode(texto); }

// sheets: [{ name, rows: cell[][], conditionalFormats?: [{sqref,color,text}] }] -> Uint8Array (.xlsx)
function buildXlsx(sheets) {
  var entries = [];
  entries.push({ name: '[Content_Types].xml', data: textoParaBytes(contentTypesXml(sheets.length)) });
  entries.push({ name: '_rels/.rels', data: textoParaBytes(rootRelsXml()) });
  entries.push({ name: 'xl/workbook.xml', data: textoParaBytes(workbookXml(sheets.map(function (s) { return s.name; }))) });
  entries.push({ name: 'xl/_rels/workbook.xml.rels', data: textoParaBytes(workbookRelsXml(sheets.length)) });
  entries.push({ name: 'xl/styles.xml', data: textoParaBytes(stylesXml()) });
  sheets.forEach(function (sheet, i) {
    entries.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: textoParaBytes(sheetXml(sheet)) });
  });
  return createZip(entries);
}

module.exports = { buildXlsx, str, num, formula };
```

- [ ] **Step 2: Escrever o teste**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { buildXlsx, str, num, formula } = require('../tools/semanal/xlsx-writer-browser.js');

function buildAndExtract(sheets) {
  const bytes = buildXlsx(sheets);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-writer-browser-test-'));
  const xlsxPath = path.join(tmpDir, 'test.xlsx');
  fs.writeFileSync(xlsxPath, Buffer.from(bytes));
  const outDir = path.join(tmpDir, 'out');
  execFileSync('unzip', ['-q', xlsxPath, '-d', outDir]);
  return outDir;
}

test('buildXlsx produz um .xlsx de verdade (zip válido com as partes OOXML esperadas)', () => {
  const sheets = [{ name: 'Resumo', rows: [[str('Semana'), str('Status')], [str('S1'), str('Crítico')]] }];
  const outDir = buildAndExtract(sheets);
  assert.ok(fs.existsSync(path.join(outDir, '[Content_Types].xml')));
  assert.ok(fs.existsSync(path.join(outDir, 'xl', 'workbook.xml')));
  assert.ok(fs.existsSync(path.join(outDir, 'xl', 'worksheets', 'sheet1.xml')));
});

test('buildXlsx escreve células str como inline string e num como valor numérico', () => {
  const sheets = [{ name: 'Volume', rows: [[str('SUP'), num(74)]] }];
  const outDir = buildAndExtract(sheets);
  const sheetXml = fs.readFileSync(path.join(outDir, 'xl', 'worksheets', 'sheet1.xml'), 'utf8');
  assert.match(sheetXml, /<c r="A1" t="inlineStr"><is><t>SUP<\/t><\/is><\/c>/);
  assert.match(sheetXml, /<c r="B1"><v>74<\/v><\/c>/);
});

test('buildXlsx escreve fórmulas como <f>, escapadas', () => {
  const sheets = [{ name: 'Sheet1', rows: [[formula('A1&"!"')]] }];
  const outDir = buildAndExtract(sheets);
  const sheetXml = fs.readFileSync(path.join(outDir, 'xl', 'worksheets', 'sheet1.xml'), 'utf8');
  assert.match(sheetXml, /<f>A1&amp;&quot;!&quot;<\/f>/);
});

test('buildXlsx grava uma aba por sheets[], na ordem, com o nome escapado', () => {
  const sheets = [
    { name: 'Resumo', rows: [[str('1')]] },
    { name: 'Desvios & Ações', rows: [[str('2')]] },
  ];
  const outDir = buildAndExtract(sheets);
  const workbookXml = fs.readFileSync(path.join(outDir, 'xl', 'workbook.xml'), 'utf8');
  assert.match(workbookXml, /<sheet name="Resumo" sheetId="1" r:id="rId1"\/>/);
  assert.match(workbookXml, /<sheet name="Desvios &amp; Ações" sheetId="2" r:id="rId2"\/>/);
});

test('formatação condicional por texto marca a célula de Status com o dxf certo (Crítico vs Atenção)', () => {
  const sheets = [{
    name: 'Desvios',
    rows: [[str('Status')], [str('Crítico')], [str('Atenção')]],
    conditionalFormats: [
      { sqref: 'A2:A3', color: 'critico', text: 'Crítico' },
      { sqref: 'A2:A3', color: 'atencao', text: 'Atenção' },
    ],
  }];
  const outDir = buildAndExtract(sheets);
  const sheetXml = fs.readFileSync(path.join(outDir, 'xl', 'worksheets', 'sheet1.xml'), 'utf8');
  assert.match(sheetXml, /<cfRule type="containsText" dxfId="0"[^>]*text="Crítico">/);
  assert.match(sheetXml, /<cfRule type="containsText" dxfId="1"[^>]*text="Atenção">/);
});
```

- [ ] **Step 3: Rodar o teste e confirmar que passa**

Run: `node --test test/semanal-xlsx-writer-browser.test.js`
Expected: 5 testes, todos PASS.

- [ ] **Step 4: Commit**

```bash
git add tools/semanal/xlsx-writer-browser.js test/semanal-xlsx-writer-browser.test.js
git commit -m "$(cat <<'EOF'
Adiciona xlsx-writer-browser.js -- gerador de .xlsx sem Node, so p/ navegador

Porte de tools/lib/xlsx-writer.js (repositorio irmao) sobre a base de
zip-writer-browser.js. Formatacao condicional reduzida a Critico/Atencao,
as unicas cores que a aba Desvios do relatorio semanal usa.
EOF
)"
```

---

## Task 3: `compute-relatorio-semanal.js` — janelas de tempo (semana anterior/acumulado/semana que vem)

**Files:**
- Create: `tools/semanal/compute-relatorio-semanal.js`
- Test: `test/semanal-compute-relatorio-semanal.test.js`

**Interfaces:**
- Consumes: `semanasDoMes`, `indiceSemanaAtual` de `./compute-semanal.js`; `calcularSeriesSemanaisDimensao` de `./render-aba-semanal.js`; `agregarFatias`, `janelaDoPeriodo`, `semanasElapsadas`, `PERIODO_ACUMULADO` de `./render-aba-alertas.js`; `blocosPorSup`, `tipologiasPresentes` de `./render-aba-consolidado.js`.
- Produces: `semanaAnterior(ano, mesIdx, semanas, indiceAtual)`, `semanaSeguinte(ano, mesIdx, semanas, indiceAtual)` → `{semana: {inicio,fim}, mesIdx: number, semanasDoMesAlvo: array, indiceNoMes: number}`. `janelasDoGrupo(registros, indices, dimensao, ctx) → {semanaAnterior: {previsto,realizado,tendencia}, acumulado: {previsto,realizado,tendencia}, semanaQueVem: {previsto,tendencia}}`. `montarLinhasDimensao(registros, indices, dimensao, ctx) → linha[]`, cada `linha: {tipo: 'total-geral'|'total-geral-tipologia'|'registro'|'total-sup', sup, tomador, tipologia, contrato, janelas}`. `ctx: {ano, mesIdx, semanas, indiceAtual, demandas, hojeEpoch, mesAtualReal?, temSemanasReais}`.

- [ ] **Step 1: Escrever o arquivo**

```js
'use strict';
const { semanasDoMes, indiceSemanaAtual } = require('./compute-semanal.js');
const { calcularSeriesSemanaisDimensao } = require('./render-aba-semanal.js');
const { agregarFatias, janelaDoPeriodo, semanasElapsadas, PERIODO_ACUMULADO } = require('./render-aba-alertas.js');
const { blocosPorSup, tipologiasPresentes } = require('./render-aba-consolidado.js');

// Módulo dual Node+navegador (bundle) -- mesmo padrão 'var'/'function' e
// requires same-dir de render-aba-alertas.js/render-aba-consolidado.js.
//
// Este módulo NÃO recalcula nada -- é um MONTADOR sobre calcularSeries
// SemanaisDimensao (a mesma função que Tabela Semanal/Consolidado/Alertas já
// usam) e sobre agregarFatias/janelaDoPeriodo (o mesmo período "Acumulado
// até a semana atual" que a aba Alertas já expõe). Garantia: o relatório
// nunca pode divergir do que a página mostra, porque é o MESMO cálculo.

// A semana ANTERIOR ou SEGUINTE a semanas[indiceAtual], podendo cair num mês
// (e ano) civil diferente. semanasDoMes(ano, mesIdx) aceita mesIdx fora de
// [0,11]: o overflow de mês do Date.UTC do JavaScript resolve o rollover de
// ano sozinho, então as datas da semana vizinha saem corretas mesmo quando
// mesIdxVizinho é -1 (dezembro do ano anterior) ou 12 (janeiro do ano
// seguinte). O QUE NÃO sai correto nesse caso é o Previsto/Tendência: os
// registros só carregam os 12 meses de window.__ANO__, então
// registro.previsto.volume[-1] e [12] são sempre undefined --
// calcularSeriesSemanaisDimensao já trata isso como "sem dado" sozinha, sem
// nenhuma guarda extra precisar existir aqui (limitação conhecida e aceita,
// ver o spec -- só afeta a 1ª semana de janeiro e a última de dezembro).
function semanaAnterior(ano, mesIdx, semanas, indiceAtual) {
  if (indiceAtual - 1 >= 0) {
    return { semana: semanas[indiceAtual - 1], mesIdx: mesIdx, semanasDoMesAlvo: semanas, indiceNoMes: indiceAtual - 1 };
  }
  var semanasMesAnterior = semanasDoMes(ano, mesIdx - 1);
  return {
    semana: semanasMesAnterior[semanasMesAnterior.length - 1],
    mesIdx: mesIdx - 1, semanasDoMesAlvo: semanasMesAnterior, indiceNoMes: semanasMesAnterior.length - 1,
  };
}

function semanaSeguinte(ano, mesIdx, semanas, indiceAtual) {
  if (indiceAtual + 1 < semanas.length) {
    return { semana: semanas[indiceAtual + 1], mesIdx: mesIdx, semanasDoMesAlvo: semanas, indiceNoMes: indiceAtual + 1 };
  }
  var semanasMesSeguinte = semanasDoMes(ano, mesIdx + 1);
  return { semana: semanasMesSeguinte[0], mesIdx: mesIdx + 1, semanasDoMesAlvo: semanasMesSeguinte, indiceNoMes: 0 };
}

// Previsto/Realizado/Tendência de 'alvo.semana' -- mesmo mecanismo de
// congelamento de renderLinha (render-aba-consolidado.js): Realizado sai
// SEMPRE do hoje real (congelá-lo mostraria ~0 numa semana que produziu de
// verdade); Tendência é recalculada com hojeEpoch = início da semana quando
// ela já começou (encerrada ou em curso), e com o hoje real quando ainda não
// começou (projeção corrente -- é o caso de "semana que vem").
function serieDaSemana(registros, indices, dimensao, alvo, ctx) {
  var semanas = alvo.semanasDoMesAlvo;
  var indiceAtualReal = indiceSemanaAtual(semanas, ctx.hojeEpoch);
  var seriesAoVivo = calcularSeriesSemanaisDimensao(
    registros, indices, dimensao, alvo.mesIdx, semanas, semanas.length,
    ctx.temSemanasReais, indiceAtualReal, ctx.demandas, ctx.hojeEpoch, ctx.mesAtualReal
  );
  var congelar = alvo.semana.inicio <= ctx.hojeEpoch;
  var hojeEfetivo = congelar ? alvo.semana.inicio : ctx.hojeEpoch;
  var seriesTendencia = hojeEfetivo === ctx.hojeEpoch ? seriesAoVivo : calcularSeriesSemanaisDimensao(
    registros, indices, dimensao, alvo.mesIdx, semanas, semanas.length,
    ctx.temSemanasReais, indiceSemanaAtual(semanas, hojeEfetivo), ctx.demandas, hojeEfetivo, ctx.mesAtualReal
  );
  return {
    previsto: seriesAoVivo.semanasPrevisto[alvo.indiceNoMes],
    realizado: seriesAoVivo.semanasRealizado[alvo.indiceNoMes],
    tendencia: seriesTendencia.semanasTendenciaCompleta[alvo.indiceNoMes],
  };
}

// Previsto/Realizado/Tendência acumulados de S1 até a semana vigente do mês
// SELECIONADO (nunca cruza mês -- "acumulado do mês" é sempre do mês na
// tela). Reaproveita agregarFatias/janelaDoPeriodo(PERIODO_ACUMULADO), a
// MESMA conta que a aba Alertas já usa para esse período.
function serieAcumulada(registros, indices, dimensao, ctx) {
  var elapsadas = semanasElapsadas(ctx.semanas, ctx.hojeEpoch);
  var series = calcularSeriesSemanaisDimensao(
    registros, indices, dimensao, ctx.mesIdx, ctx.semanas, ctx.semanas.length,
    ctx.temSemanasReais, ctx.indiceAtual, ctx.demandas, ctx.hojeEpoch, ctx.mesAtualReal
  );
  var janela = janelaDoPeriodo(PERIODO_ACUMULADO, ctx.semanas.length, elapsadas);
  return {
    previsto: agregarFatias(series.semanasPrevisto, dimensao, janela),
    realizado: agregarFatias(series.semanasRealizado, dimensao, janela),
    tendencia: agregarFatias(series.semanasTendenciaCompleta, dimensao, janela),
  };
}

// As 3 janelas de UM grupo (SUP inteiro, uma tipologia agregada, ou um
// registro/contrato), para uma dimensão.
function janelasDoGrupo(registros, indices, dimensao, ctx) {
  var alvoAnterior = semanaAnterior(ctx.ano, ctx.mesIdx, ctx.semanas, ctx.indiceAtual);
  var alvoSeguinte = semanaSeguinte(ctx.ano, ctx.mesIdx, ctx.semanas, ctx.indiceAtual);
  var semanaAnt = serieDaSemana(registros, indices, dimensao, alvoAnterior, ctx);
  var semanaSeg = serieDaSemana(registros, indices, dimensao, alvoSeguinte, ctx);
  return {
    semanaAnterior: semanaAnt,
    acumulado: serieAcumulada(registros, indices, dimensao, ctx),
    semanaQueVem: { previsto: semanaSeg.previsto, tendencia: semanaSeg.tendencia },
  };
}

function linhaGrupo(tipo, celulas, registros, indices, dimensao, ctx) {
  return {
    tipo: tipo, sup: celulas.sup, tomador: celulas.tomador, tipologia: celulas.tipologia,
    contrato: celulas.contrato || null,
    janelas: janelasDoGrupo(registros, indices, dimensao, ctx),
  };
}

// Mesma hierarquia de renderAbaConsolidado (render-aba-consolidado.js):
// TOTAL GERAL -> TOTAL GERAL por tipologia -> por SUP: um registro por linha
// (= por tipologia daquele SUP, que É o contrato -- ver o comentário no topo
// de render-aba-consolidado.js) + TOTAL <SUP>. Devolve um array plano, na
// ordem de exibição.
function montarLinhasDimensao(registros, indices, dimensao, ctx) {
  var linhas = [];
  var todos = indices || [];

  linhas.push(linhaGrupo('total-geral', { sup: '—', tomador: 'Todos', tipologia: 'TOTAL GERAL' }, registros, todos, dimensao, ctx));

  tipologiasPresentes(registros, todos).forEach(function (bloco) {
    linhas.push(linhaGrupo('total-geral-tipologia', { sup: '—', tomador: 'Todos', tipologia: bloco.tipologia }, registros, bloco.indices, dimensao, ctx));
  });

  blocosPorSup(registros, todos).forEach(function (blocoSup) {
    blocoSup.indices.forEach(function (idx) {
      var registro = registros[idx];
      linhas.push(linhaGrupo('registro', {
        sup: registro.sup, tomador: registro.tomador, tipologia: registro.tipologia, contrato: registro.sup,
      }, registros, [idx], dimensao, ctx));
    });
    var primeiro = registros[blocoSup.indices[0]];
    linhas.push(linhaGrupo('total-sup', { sup: blocoSup.sup, tomador: primeiro.tomador, tipologia: 'TOTAL' }, registros, blocoSup.indices, dimensao, ctx));
  });

  return linhas;
}

module.exports = {
  semanaAnterior, semanaSeguinte, serieDaSemana, serieAcumulada, janelasDoGrupo, montarLinhasDimensao,
};
```

- [ ] **Step 2: Escrever o teste**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const ComputeRelatorioSemanal = require('../tools/semanal/compute-relatorio-semanal.js');
const { semanasDoMes, diaEpoch, indiceSemanaAtual } = require('../tools/semanal/compute-semanal.js');
const RenderAbaSemanal = require('../tools/semanal/render-aba-semanal.js');
const RenderAbaAlertas = require('../tools/semanal/render-aba-alertas.js');

const ANO = 2026;

function registro({ sup, tipologia = 'ST', grupo = 'Grupo-A', tomador = 'Tomador-A', mesIdx, volume = 0, equipesTotal = 2 }) {
  const zeros = () => new Array(12).fill(0);
  const mk = (v) => { const a = zeros(); a[mesIdx] = v; return a; };
  const mkEquipes = (v) => { const a = zeros(); a[mesIdx] = v; return a; };
  return {
    sup, tipologia, grupo, tomador, origem: 'CONTRATO VIGENTE',
    previsto: { volume: mk(volume), financeiro: zeros(), equipes: mkEquipes(2), equipesResumo: { prod: 8 }, volumeResumo: { ticket: 1 } },
    realizado: { volume: zeros(), financeiro: zeros(), equipes: zeros(), equipesResumo: {}, volumeResumo: {} },
    total: { volume: zeros(), financeiro: zeros(), equipes: mkEquipes(equipesTotal), equipesResumo: {}, volumeResumo: {} },
  };
}

function demandasCom(eventosPorChave) {
  const porRegistroEventos = {};
  Object.keys(eventosPorChave).forEach((chave) => {
    porRegistroEventos[chave] = { chegada: [], saidaEstoque: [], sondagemRealizada: eventosPorChave[chave] };
  });
  return { porRegistroEventos };
}

test('semanaAnterior da 1ª semana de agosto devolve a última semana de julho, no mesmo ano', () => {
  const AGOSTO = 7;
  const semanasAgo = semanasDoMes(ANO, AGOSTO);
  const alvo = ComputeRelatorioSemanal.semanaAnterior(ANO, AGOSTO, semanasAgo, 0);
  const semanasJul = semanasDoMes(ANO, 6);
  assert.strictEqual(alvo.mesIdx, 6);
  assert.deepStrictEqual(alvo.semana, semanasJul[semanasJul.length - 1]);
  assert.strictEqual(alvo.semana.fim, diaEpoch(new Date(Date.UTC(ANO, AGOSTO, 1))) - 1, 'a última semana de julho termina no dia anterior a 01/08');
});

test('semanaSeguinte da última semana de dezembro devolve a 1ª semana de janeiro do ano SEGUINTE', () => {
  const DEZEMBRO = 11;
  const semanasDez = semanasDoMes(ANO, DEZEMBRO);
  const alvo = ComputeRelatorioSemanal.semanaSeguinte(ANO, DEZEMBRO, semanasDez, semanasDez.length - 1);
  assert.strictEqual(alvo.mesIdx, 12, 'mesIdx sai de [0,11] -- Previsto/Tendência ficam sem dado, tratado por calcularSeriesSemanaisDimensao');
  assert.strictEqual(alvo.semana.inicio, diaEpoch(new Date(Date.UTC(ANO + 1, 0, 1))), 'a semana seguinte a dezembro começa em 1º de janeiro do ano seguinte');
});

test('serieDaSemana: Previsto/Tendência ficam sem dado fora dos 12 meses carregados, mas Realizado (por data) continua correto', () => {
  const AGOSTO = 7;
  const semanasAgo = semanasDoMes(ANO, AGOSTO);
  const reg = registro({ sup: 'SUP-A', mesIdx: AGOSTO, volume: 100 });
  const alvo = ComputeRelatorioSemanal.semanaAnterior(ANO, AGOSTO, semanasAgo, 0); // cai em julho, mesIdx 6 -- ainda dentro do ano, sem furo nele
  // Força o alvo para FORA do ano (dezembro anterior), simulando a 1ª semana de janeiro:
  const semanasJan = semanasDoMes(ANO, 0);
  const alvoForaDoAno = ComputeRelatorioSemanal.semanaAnterior(ANO, 0, semanasJan, 0);
  assert.strictEqual(alvoForaDoAno.mesIdx, -1);

  const demandas = demandasCom({ 'SUP-A||ST': [alvoForaDoAno.semana.inicio] }); // 1 furo realizado dentro da semana-alvo
  const ctx = { hojeEpoch: alvoForaDoAno.semana.fim + 10, demandas, temSemanasReais: true };
  const serie = ComputeRelatorioSemanal.serieDaSemana([reg], [0], 'volume', alvoForaDoAno, ctx);

  assert.strictEqual(serie.previsto, null, 'previsto[-1] é undefined -- calcularSeriesSemanaisDimensao devolve null, não 0');
  assert.strictEqual(serie.realizado, 1, 'o furo é contado por DATA, independente do índice de mês estar fora de [0,11]');
});

test('serieAcumulada usa exatamente a mesma janela "Acumulado até a semana atual" que a aba Alertas expõe', () => {
  const JULHO = 6;
  const semanas = semanasDoMes(ANO, JULHO);
  const reg = registro({ sup: 'SUP-A', mesIdx: JULHO, volume: 70 });
  const diaComFuro = semanas[0].inicio;
  const demandas = demandasCom({ 'SUP-A||ST': [diaComFuro] });
  const hojeEpoch = semanas[1].inicio; // início da 2ª semana -- a 1ª já fechou
  const indiceAtual = indiceSemanaAtual(semanas, hojeEpoch);
  const ctx = {
    ano: ANO, mesIdx: JULHO, semanas: semanas, indiceAtual: indiceAtual,
    demandas: demandas, hojeEpoch: hojeEpoch, temSemanasReais: true,
  };

  const obtido = ComputeRelatorioSemanal.serieAcumulada([reg], [0], 'volume', ctx);

  const elapsadas = RenderAbaAlertas.semanasElapsadas(semanas, hojeEpoch);
  const series = RenderAbaSemanal.calcularSeriesSemanaisDimensao([reg], [0], 'volume', JULHO, semanas, semanas.length, true, indiceAtual, demandas, hojeEpoch);
  const janela = RenderAbaAlertas.janelaDoPeriodo(RenderAbaAlertas.PERIODO_ACUMULADO, semanas.length, elapsadas);
  const esperadoRealizado = RenderAbaAlertas.agregarFatias(series.semanasRealizado, 'volume', janela);

  assert.strictEqual(obtido.realizado, esperadoRealizado);
  assert.strictEqual(obtido.realizado, 1, 'o furo do dia 1 da S1 conta no acumulado, já que a S1 encerrou');
});

test('montarLinhasDimensao produz TOTAL GERAL, uma linha por tipologia, e por SUP um registro + TOTAL <SUP>', () => {
  const JULHO = 6;
  const semanas = semanasDoMes(ANO, JULHO);
  const registros = [
    registro({ sup: 'SUP-A', tipologia: 'ST', mesIdx: JULHO, volume: 10 }),
    registro({ sup: 'SUP-B', tipologia: 'SP', mesIdx: JULHO, volume: 20 }),
  ];
  const hojeEpoch = semanas[0].inicio;
  const ctx = {
    ano: ANO, mesIdx: JULHO, semanas: semanas, indiceAtual: indiceSemanaAtual(semanas, hojeEpoch),
    demandas: demandasCom({}), hojeEpoch: hojeEpoch, temSemanasReais: true,
  };
  const linhas = ComputeRelatorioSemanal.montarLinhasDimensao(registros, [0, 1], 'volume', ctx);
  const tipos = linhas.map((l) => l.tipo);
  assert.deepStrictEqual(tipos, [
    'total-geral', 'total-geral-tipologia', 'total-geral-tipologia',
    'registro', 'total-sup', 'registro', 'total-sup',
  ]);
  const linhaRegistroA = linhas.find((l) => l.tipo === 'registro' && l.sup === 'SUP-A');
  assert.strictEqual(linhaRegistroA.contrato, 'SUP-A', 'o contrato É o SUP -- cada registro é (SUP, tipologia)');
});
```

- [ ] **Step 3: Rodar o teste e confirmar que passa**

Run: `node --test test/semanal-compute-relatorio-semanal.test.js`
Expected: 5 testes, todos PASS.

- [ ] **Step 4: Commit**

```bash
git add tools/semanal/compute-relatorio-semanal.js test/semanal-compute-relatorio-semanal.test.js
git commit -m "$(cat <<'EOF'
Adiciona compute-relatorio-semanal.js -- janelas de tempo do relatorio semanal

Semana anterior (congelada), acumulado do mes e semana que vem, todos via
calcularSeriesSemanaisDimensao/agregarFatias ja existentes -- nao recalcula
nada, so monta. Cobre a semana vizinha cruzando mes/ano.
EOF
)"
```

---

## Task 4: `compute-relatorio-semanal.js` — desvios (Crítico/Atenção)

**Files:**
- Modify: `tools/semanal/compute-relatorio-semanal.js` (acrescenta ao final, antes do `module.exports`)
- Test: `test/semanal-compute-relatorio-semanal.test.js` (acrescenta testes)

**Interfaces:**
- Consumes: `classificarSemaforo` de `./render-aba-alertas.js`; `linhas` produzidas por `montarLinhasDimensao` (Task 3).
- Produces: `montarDesvios(linhasPorDimensao) → {porTipologia: desvio[], porContrato: desvio[]}`, `resumoDesvios(desvios) → {critico: number, atencao: number}`. `desvio: {sup, tomador, tipologia, contrato, janela, dimensao, previsto, numerador, desvio, status, cor}`.

- [ ] **Step 1: Adicionar o import de `classificarSemaforo` e o código de desvios**

No topo do arquivo, troque a linha de import de `render-aba-alertas.js`:

```js
const { agregarFatias, janelaDoPeriodo, semanasElapsadas, PERIODO_ACUMULADO } = require('./render-aba-alertas.js');
```

por:

```js
const { agregarFatias, janelaDoPeriodo, semanasElapsadas, classificarSemaforo, PERIODO_ACUMULADO } = require('./render-aba-alertas.js');
```

No final do arquivo, antes de `module.exports`, acrescente:

```js
// Base de comparação por janela: sempre "o que aconteceu/vai acontecer" ÷
// Previsto -- mesma leitura do semáforo de Alertas. "Semana que vem" não tem
// Realizado (ainda não aconteceu): usa Tendência.
function desvioDaJanela(nomeJanela, janela) {
  var numerador = nomeJanela === 'semanaQueVem' ? janela.tendencia : janela.realizado;
  var desvio = (numerador === null || numerador === undefined || !janela.previsto)
    ? null : numerador / janela.previsto;
  return { desvio: desvio, previsto: janela.previsto, numerador: numerador };
}

var JANELA_ROTULO = {
  semanaAnterior: 'Semana anterior', acumulado: 'Acumulado do mês até a data', semanaQueVem: 'Semana que vem',
};
var DIMENSAO_ROTULO_RELATORIO = { volume: 'Volume', equipes: 'Equipes' };

// Uma linha de desvio por (linha da hierarquia x janela), só quando o
// semáforo classifica Crítico ou Atenção -- Excelente/Dentro da meta/Sem
// dado não entram neste capítulo.
function extrairDesvios(linhas, dimensao) {
  var desvios = [];
  linhas.forEach(function (linha) {
    ['semanaAnterior', 'acumulado', 'semanaQueVem'].forEach(function (nomeJanela) {
      var calculo = desvioDaJanela(nomeJanela, linha.janelas[nomeJanela]);
      var classe = classificarSemaforo(calculo.desvio);
      if (classe.indicador !== 'Crítico' && classe.indicador !== 'Atenção') return;
      desvios.push({
        sup: linha.sup, tomador: linha.tomador, tipologia: linha.tipologia, contrato: linha.contrato,
        janela: JANELA_ROTULO[nomeJanela], dimensao: DIMENSAO_ROTULO_RELATORIO[dimensao],
        previsto: calculo.previsto, numerador: calculo.numerador, desvio: calculo.desvio,
        status: classe.indicador, cor: classe.cor,
      });
    });
  });
  return desvios;
}

// linhasPorDimensao: { volume: linhas de montarLinhasDimensao, equipes: linhas }.
// Devolve { porTipologia, porContrato }, cruzando as duas dimensões.
function montarDesvios(linhasPorDimensao) {
  var porTipologia = [];
  var porContrato = [];
  ['volume', 'equipes'].forEach(function (dimensao) {
    var linhas = linhasPorDimensao[dimensao] || [];
    var tipologiaLinhas = linhas.filter(function (l) { return l.tipo === 'total-geral-tipologia'; });
    var contratoLinhas = linhas.filter(function (l) { return l.tipo === 'registro'; });
    porTipologia = porTipologia.concat(extrairDesvios(tipologiaLinhas, dimensao));
    porContrato = porContrato.concat(extrairDesvios(contratoLinhas, dimensao));
  });
  return { porTipologia: porTipologia, porContrato: porContrato };
}

// Contagem de Crítico/Atenção da geração inteira, pro capítulo Resumo do
// .xlsx e pra linha-resumo do histórico -- soma só porContrato (o nível mais
// fino), pra não contar duas vezes o mesmo desvio físico (que também
// aparece agregado em porTipologia).
function resumoDesvios(desvios) {
  var resumo = { critico: 0, atencao: 0 };
  (desvios.porContrato || []).forEach(function (d) {
    if (d.status === 'Crítico') resumo.critico++;
    else if (d.status === 'Atenção') resumo.atencao++;
  });
  return resumo;
}
```

E troque o `module.exports` final por:

```js
module.exports = {
  semanaAnterior, semanaSeguinte, serieDaSemana, serieAcumulada, janelasDoGrupo, montarLinhasDimensao,
  extrairDesvios, montarDesvios, resumoDesvios, JANELA_ROTULO, DIMENSAO_ROTULO_RELATORIO,
};
```

- [ ] **Step 2: Acrescentar os testes ao final de `test/semanal-compute-relatorio-semanal.test.js`**

```js
function linhaSintetica(tipo, extras, janelas) {
  return Object.assign({ tipo: tipo, sup: 'SUP-X', tomador: 'Tomador-X', tipologia: 'ST', contrato: 'SUP-X' }, extras, { janelas: janelas });
}

test('extrairDesvios só inclui linhas Crítico ou Atenção -- Dentro da meta/Excelente/Sem dado ficam de fora', () => {
  const linhas = [
    linhaSintetica('total-geral-tipologia', {}, {
      semanaAnterior: { previsto: 100, realizado: 50, tendencia: 50 }, // 50% -> Crítico
      acumulado: { previsto: 100, realizado: 95, tendencia: 95 }, // 95% -> Dentro da meta
      semanaQueVem: { previsto: 100, tendencia: 80 }, // 80% -> Atenção
    }),
  ];
  const desvios = ComputeRelatorioSemanal.extrairDesvios(linhas, 'volume');
  assert.strictEqual(desvios.length, 2, 'só semanaAnterior (Crítico) e semanaQueVem (Atenção) entram -- acumulado (Dentro da meta) fica de fora');
  assert.deepStrictEqual(desvios.map((d) => d.janela).sort(), ['Semana anterior', 'Semana que vem']);
  assert.strictEqual(desvios.find((d) => d.janela === 'Semana anterior').status, 'Crítico');
  assert.strictEqual(desvios.find((d) => d.janela === 'Semana que vem').status, 'Atenção');
});

test('extrairDesvios: "semana que vem" usa Tendência (não Realizado, que ainda não existe) como numerador', () => {
  const linhas = [
    linhaSintetica('registro', {}, {
      semanaAnterior: { previsto: null, realizado: null, tendencia: null },
      acumulado: { previsto: null, realizado: null, tendencia: null },
      semanaQueVem: { previsto: 100, tendencia: 40 }, // 40% -> Crítico
    }),
  ];
  const desvios = ComputeRelatorioSemanal.extrairDesvios(linhas, 'equipes');
  assert.strictEqual(desvios.length, 1);
  assert.strictEqual(desvios[0].numerador, 40);
  assert.strictEqual(desvios[0].status, 'Crítico');
});

test('montarDesvios separa por tipo de linha (tipologia vs contrato) e cruza volume + equipes', () => {
  const linhasVolume = [
    linhaSintetica('total-geral-tipologia', { tipologia: 'ST' }, {
      semanaAnterior: { previsto: 100, realizado: 40, tendencia: 40 }, acumulado: { previsto: null, realizado: null, tendencia: null }, semanaQueVem: { previsto: null, tendencia: null },
    }),
    linhaSintetica('registro', { sup: 'SUP-A', contrato: 'SUP-A' }, {
      semanaAnterior: { previsto: null, realizado: null, tendencia: null }, acumulado: { previsto: 100, realizado: 40, tendencia: 40 }, semanaQueVem: { previsto: null, tendencia: null },
    }),
  ];
  const linhasEquipes = [];
  const desvios = ComputeRelatorioSemanal.montarDesvios({ volume: linhasVolume, equipes: linhasEquipes });
  assert.strictEqual(desvios.porTipologia.length, 1);
  assert.strictEqual(desvios.porContrato.length, 1);
  assert.strictEqual(desvios.porTipologia[0].dimensao, 'Volume');
});

test('resumoDesvios conta só porContrato (nível mais fino), não duplica com porTipologia', () => {
  const desvios = {
    porTipologia: [{ status: 'Crítico' }, { status: 'Atenção' }, { status: 'Crítico' }],
    porContrato: [{ status: 'Crítico' }, { status: 'Atenção' }],
  };
  const resumo = ComputeRelatorioSemanal.resumoDesvios(desvios);
  assert.deepStrictEqual(resumo, { critico: 1, atencao: 1 });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que passa**

Run: `node --test test/semanal-compute-relatorio-semanal.test.js`
Expected: 9 testes (5 da Task 3 + 4 novos), todos PASS.

- [ ] **Step 4: Commit**

```bash
git add tools/semanal/compute-relatorio-semanal.js test/semanal-compute-relatorio-semanal.test.js
git commit -m "$(cat <<'EOF'
compute-relatorio-semanal.js: capitulo de desvios (Critico/Atencao)

Reaproveita classificarSemaforo (mesmo semaforo da aba Alertas) sobre as
janelas ja montadas pela Task 3 -- so Critico e Atencao entram no capitulo.
EOF
)"
```

---

## Task 5: `render-relatorio-semanal-xlsx.js` — monta as 4 abas do arquivo

**Files:**
- Create: `tools/semanal/render-relatorio-semanal-xlsx.js`
- Test: `test/semanal-render-relatorio-semanal-xlsx.test.js`

**Interfaces:**
- Consumes: `montarLinhasDimensao`, `montarDesvios`, `resumoDesvios` de `./compute-relatorio-semanal.js`; `buildXlsx`, `str`, `num` de `./xlsx-writer-browser.js`.
- Produces: `gerarRelatorioSemanalXlsx(opcoes) → {bytes: Uint8Array, resumo, desvios, linhasVolume, linhasEquipes}`. `opcoes: {registros, indices, ano, mesIdx, semanas, indiceAtual, demandas, hojeEpoch, mesAtualReal?, geradoEm: Date, autor: string}`.

- [ ] **Step 1: Escrever o arquivo**

```js
'use strict';
const ComputeRelatorioSemanal = require('./compute-relatorio-semanal.js');
const XlsxWriterBrowser = require('./xlsx-writer-browser.js');

var str = XlsxWriterBrowser.str;
var num = XlsxWriterBrowser.num;

function celulaNumOuVazia(v) {
  return (v === null || v === undefined) ? str('') : num(v);
}

function formatarDesvioTexto(d) {
  return (d === null || d === undefined) ? '' : Math.round(d * 100) + '%';
}

function doisDigitos(n) { return (n < 10 ? '0' : '') + n; }

function formatarDataCurta(diaEp) {
  var d = new Date(diaEp * 86400000);
  return doisDigitos(d.getUTCDate()) + '/' + doisDigitos(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
}

function formatarDataHora(date) {
  return doisDigitos(date.getDate()) + '/' + doisDigitos(date.getMonth() + 1) + '/' + date.getFullYear()
    + ' ' + doisDigitos(date.getHours()) + ':' + doisDigitos(date.getMinutes());
}

function montarAbaResumo(opcoes, resumo) {
  var semanaVigente = opcoes.semanas[opcoes.indiceAtual];
  var rows = [
    [str('Relatório Semanal — Planejamento')],
    [str('Semana vigente'), str(semanaVigente ? formatarDataCurta(semanaVigente.inicio) + ' a ' + formatarDataCurta(semanaVigente.fim) : '—')],
    [str('Gerado em'), str(formatarDataHora(opcoes.geradoEm))],
    [str('Gerado por'), str(opcoes.autor || 'dashboard')],
    [str('')],
    [str('Desvios Crítico'), num(resumo.critico)],
    [str('Desvios Atenção'), num(resumo.atencao)],
  ];
  return { name: 'Resumo', rows: rows };
}

var CABECALHO_DESVIOS = [
  str('SUP'), str('Tomador'), str('Tipologia'), str('Contrato'), str('Janela'), str('Dimensão'),
  str('Previsto'), str('Realizado/Tendência'), str('Desvio %'), str('Status'), str('Ação'), str('Responsável'),
];

function linhaDesvio(d) {
  return [
    str(d.sup), str(d.tomador), str(d.tipologia), str(d.contrato || ''), str(d.janela), str(d.dimensao),
    celulaNumOuVazia(d.previsto), celulaNumOuVazia(d.numerador), str(formatarDesvioTexto(d.desvio)),
    str(d.status), str(''), str(''),
  ];
}

function montarAbaDesvios(desvios) {
  var rows = [[str('Por tipologia')], CABECALHO_DESVIOS.slice()];
  var linhaInicioTipologia = rows.length + 1;
  desvios.porTipologia.forEach(function (d) { rows.push(linhaDesvio(d)); });
  var linhaFimTipologia = rows.length;

  rows.push([str('')]);
  rows.push([str('Por contrato')]);
  rows.push(CABECALHO_DESVIOS.slice());
  var linhaInicioContrato = rows.length + 1;
  desvios.porContrato.forEach(function (d) { rows.push(linhaDesvio(d)); });
  var linhaFimContrato = rows.length;

  var colunaStatus = 'J'; // 10ª coluna de CABECALHO_DESVIOS (A..L)
  var conditionalFormats = [];
  if (linhaFimTipologia >= linhaInicioTipologia) {
    conditionalFormats.push({ sqref: colunaStatus + linhaInicioTipologia + ':' + colunaStatus + linhaFimTipologia, color: 'critico', text: 'Crítico' });
    conditionalFormats.push({ sqref: colunaStatus + linhaInicioTipologia + ':' + colunaStatus + linhaFimTipologia, color: 'atencao', text: 'Atenção' });
  }
  if (linhaFimContrato >= linhaInicioContrato) {
    conditionalFormats.push({ sqref: colunaStatus + linhaInicioContrato + ':' + colunaStatus + linhaFimContrato, color: 'critico', text: 'Crítico' });
    conditionalFormats.push({ sqref: colunaStatus + linhaInicioContrato + ':' + colunaStatus + linhaFimContrato, color: 'atencao', text: 'Atenção' });
  }
  return { name: 'Desvios', rows: rows, conditionalFormats: conditionalFormats };
}

function casasDaDimensao(dimensao) { return dimensao === 'equipes' ? 2 : 0; }

function arredondar(v, casas) {
  if (v === null || v === undefined) return null;
  var fator = Math.pow(10, casas);
  return Math.round(v * fator) / fator;
}

var CABECALHO_DIMENSAO = [
  str('SUP'), str('Tomador'), str('Tipologia'), str('Contrato'),
  str('Semana anterior — Previsto'), str('Semana anterior — Realizado'), str('Semana anterior — Tendência'),
  str('Acumulado do mês — Previsto'), str('Acumulado do mês — Realizado'), str('Acumulado do mês — Tendência'),
  str('Semana que vem — Previsto'), str('Semana que vem — Tendência'),
];

function linhaDimensao(linha, dimensao) {
  var casas = casasDaDimensao(dimensao);
  var j = linha.janelas;
  return [
    str(linha.sup), str(linha.tomador), str(linha.tipologia), str(linha.contrato || ''),
    celulaNumOuVazia(arredondar(j.semanaAnterior.previsto, casas)),
    celulaNumOuVazia(arredondar(j.semanaAnterior.realizado, casas)),
    celulaNumOuVazia(arredondar(j.semanaAnterior.tendencia, casas)),
    celulaNumOuVazia(arredondar(j.acumulado.previsto, casas)),
    celulaNumOuVazia(arredondar(j.acumulado.realizado, casas)),
    celulaNumOuVazia(arredondar(j.acumulado.tendencia, casas)),
    celulaNumOuVazia(arredondar(j.semanaQueVem.previsto, casas)),
    celulaNumOuVazia(arredondar(j.semanaQueVem.tendencia, casas)),
  ];
}

function montarAbaDimensao(nomeAba, linhas, dimensao) {
  var rows = [CABECALHO_DIMENSAO.slice()];
  linhas.forEach(function (linha) { rows.push(linhaDimensao(linha, dimensao)); });
  return { name: nomeAba, rows: rows };
}

// opcoes: { registros, indices, ano, mesIdx, semanas, indiceAtual, demandas,
//   hojeEpoch, mesAtualReal?, geradoEm: Date, autor: string }.
function gerarRelatorioSemanalXlsx(opcoes) {
  var ctx = {
    ano: opcoes.ano, mesIdx: opcoes.mesIdx, semanas: opcoes.semanas, indiceAtual: opcoes.indiceAtual,
    demandas: opcoes.demandas, hojeEpoch: opcoes.hojeEpoch, mesAtualReal: opcoes.mesAtualReal,
    temSemanasReais: !!(opcoes.demandas && opcoes.demandas.porRegistroEventos),
  };
  var linhasVolume = ComputeRelatorioSemanal.montarLinhasDimensao(opcoes.registros, opcoes.indices, 'volume', ctx);
  var linhasEquipes = ComputeRelatorioSemanal.montarLinhasDimensao(opcoes.registros, opcoes.indices, 'equipes', ctx);
  var desvios = ComputeRelatorioSemanal.montarDesvios({ volume: linhasVolume, equipes: linhasEquipes });
  var resumo = ComputeRelatorioSemanal.resumoDesvios(desvios);

  var sheets = [
    montarAbaResumo(opcoes, resumo),
    montarAbaDesvios(desvios),
    montarAbaDimensao('Volume', linhasVolume, 'volume'),
    montarAbaDimensao('Equipes', linhasEquipes, 'equipes'),
  ];
  return {
    bytes: XlsxWriterBrowser.buildXlsx(sheets),
    resumo: resumo, desvios: desvios, linhasVolume: linhasVolume, linhasEquipes: linhasEquipes,
  };
}

module.exports = { gerarRelatorioSemanalXlsx, montarAbaResumo, montarAbaDesvios, montarAbaDimensao };
```

- [ ] **Step 2: Escrever o teste**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const RenderRelatorioSemanalXlsx = require('../tools/semanal/render-relatorio-semanal-xlsx.js');
const { semanasDoMes, diaEpoch, indiceSemanaAtual } = require('../tools/semanal/compute-semanal.js');

const ANO = 2026;
const JULHO = 6;

function registro({ sup, tipologia = 'ST', tomador = 'Tomador-A', volume = 0 }) {
  const zeros = () => new Array(12).fill(0);
  const mk = (v) => { const a = zeros(); a[JULHO] = v; return a; };
  return {
    sup, tipologia, grupo: 'Grupo-A', tomador, origem: 'CONTRATO VIGENTE',
    previsto: { volume: mk(volume), financeiro: zeros(), equipes: mk(2), equipesResumo: { prod: 8 }, volumeResumo: { ticket: 1 } },
    realizado: { volume: zeros(), financeiro: zeros(), equipes: zeros(), equipesResumo: {}, volumeResumo: {} },
    total: { volume: zeros(), financeiro: zeros(), equipes: mk(2), equipesResumo: {}, volumeResumo: {} },
  };
}

function opcoesBase(registros, indices) {
  const semanas = semanasDoMes(ANO, JULHO);
  const hojeEpoch = semanas[1].inicio;
  return {
    registros, indices, ano: ANO, mesIdx: JULHO, semanas: semanas,
    indiceAtual: indiceSemanaAtual(semanas, hojeEpoch),
    demandas: { porRegistroEventos: {} }, hojeEpoch: hojeEpoch,
    geradoEm: new Date('2026-07-08T12:00:00Z'), autor: 'teste',
  };
}

function extrairAba(bytes, indiceAba) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-relatorio-xlsx-test-'));
  const xlsxPath = path.join(tmpDir, 'r.xlsx');
  fs.writeFileSync(xlsxPath, Buffer.from(bytes));
  const outDir = path.join(tmpDir, 'out');
  execFileSync('unzip', ['-q', xlsxPath, '-d', outDir]);
  return fs.readFileSync(path.join(outDir, 'xl', 'worksheets', 'sheet' + indiceAba + '.xml'), 'utf8');
}

test('gerarRelatorioSemanalXlsx produz 4 abas, na ordem Resumo/Desvios/Volume/Equipes', () => {
  const registros = [registro({ sup: 'SUP-A', volume: 10 })];
  const resultado = RenderRelatorioSemanalXlsx.gerarRelatorioSemanalXlsx(opcoesBase(registros, [0]));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-relatorio-xlsx-test-'));
  const xlsxPath = path.join(tmpDir, 'r.xlsx');
  fs.writeFileSync(xlsxPath, Buffer.from(resultado.bytes));
  const outDir = path.join(tmpDir, 'out');
  execFileSync('unzip', ['-q', xlsxPath, '-d', outDir]);
  const workbookXml = fs.readFileSync(path.join(outDir, 'xl', 'workbook.xml'), 'utf8');
  assert.match(workbookXml, /<sheet name="Resumo"/);
  assert.match(workbookXml, /<sheet name="Desvios"/);
  assert.match(workbookXml, /<sheet name="Volume"/);
  assert.match(workbookXml, /<sheet name="Equipes"/);
});

test('a aba Volume tem o cabeçalho das 3 janelas e uma linha por registro/tipologia/total', () => {
  const registros = [registro({ sup: 'SUP-A', volume: 10 }), registro({ sup: 'SUP-B', tipologia: 'SP', volume: 20 })];
  const resultado = RenderRelatorioSemanalXlsx.gerarRelatorioSemanalXlsx(opcoesBase(registros, [0, 1]));
  const sheetXml = extrairAba(resultado.bytes, 3); // Resumo=1, Desvios=2, Volume=3
  assert.match(sheetXml, /Semana anterior — Previsto/);
  assert.match(sheetXml, /Acumulado do mês — Realizado/);
  assert.match(sheetXml, /Semana que vem — Tendência/);
  // 1 cabeçalho + TOTAL GERAL + 2 tipologias + (registro+TOTAL SUP) x2 = 8 linhas
  const linhas = [...sheetXml.matchAll(/<row r="\d+">/g)];
  assert.strictEqual(linhas.length, 8);
});

test('gerarRelatorioSemanalXlsx devolve resumo/desvios/linhas junto com bytes, prontos pro histórico', () => {
  const registros = [registro({ sup: 'SUP-A', volume: 10 })];
  const resultado = RenderRelatorioSemanalXlsx.gerarRelatorioSemanalXlsx(opcoesBase(registros, [0]));
  assert.strictEqual(typeof resultado.resumo.critico, 'number');
  assert.strictEqual(typeof resultado.resumo.atencao, 'number');
  assert.ok(Array.isArray(resultado.linhasVolume));
  assert.ok(Array.isArray(resultado.linhasEquipes));
  assert.ok(resultado.linhasVolume.some((l) => l.tipo === 'registro' && l.sup === 'SUP-A'));
});
```

- [ ] **Step 3: Rodar o teste e confirmar que passa**

Run: `node --test test/semanal-render-relatorio-semanal-xlsx.test.js`
Expected: 3 testes, todos PASS.

- [ ] **Step 4: Commit**

```bash
git add tools/semanal/render-relatorio-semanal-xlsx.js test/semanal-render-relatorio-semanal-xlsx.test.js
git commit -m "$(cat <<'EOF'
Adiciona render-relatorio-semanal-xlsx.js -- monta as 4 abas do relatorio

Resumo, Desvios (com formatacao condicional Critico/Atencao e colunas Acao/
Responsavel em branco) e Volume/Equipes (hierarquia SUP->tipologia->contrato
x 3 janelas de tempo).
EOF
)"
```

---

## Task 6: Histórico — Apps Script + cliente

**Files:**
- Create: `tools/semanal/apps-script-historico-relatorio.gs`
- Create: `tools/semanal/historico-relatorio-sheet.js`
- Test: `test/semanal-apps-script-historico-relatorio.test.js`
- Test: `test/semanal-historico-relatorio-sheet.test.js`

**Interfaces:**
- Produces: `criarClienteHistoricoRelatorio(opcoes) → {modo(), gravar(lote), pendentes(), tentarDeNovo()}`. `opcoes: {url, fetch, armazenamento}`. `lote: {linhas: [...]}`.

- [ ] **Step 1: Escrever `tools/semanal/apps-script-historico-relatorio.gs`**

```js
// Cole este código no editor do Apps Script da Sheet de HISTÓRICO DO
// RELATÓRIO SEMANAL (Extensões > Apps Script). Ele só GRAVA -- diferente de
// apps-script-alocacao.gs, não há doGet nem upsert: cada geração de
// relatório é um lote de linhas novo, sempre em appendRow.
//
// ATENÇÃO ao copiar: se o Chrome oferecer traduzir a página, RECUSE -- a
// tradução troca palavras-chave do JavaScript e o script para de compilar.
//
// Setup (uma vez só):
//   1. Crie uma Google Sheet em branco -- esta vai ser a Sheet de histórico.
//   2. Nela: Extensões > Apps Script, apague o conteúdo padrão e cole este
//      arquivo inteiro.
//   3. Implantar > Nova implantação > tipo "App da Web".
//      - Executar como: EU (sua conta).
//      - Quem tem acesso: QUALQUER PESSOA.
//      Copie a URL que termina em /exec.
//   4. A aba "HISTORICO_RELATORIO" nasce sozinha na 1ª gravação.
//   5. Troque URL_HISTORICO_RELATORIO em tools/semanal/render-semanal.js
//      pela URL copiada, reconstrua e publique.

var ABA = 'HISTORICO_RELATORIO';
var CABECALHO = [
  'geradoEm', 'semanaInicio', 'semanaFim', 'sup', 'tipologia', 'dimensao',
  'previstoSemanaAnterior', 'realizadoSemanaAnterior', 'tendenciaSemanaAnterior',
  'previstoAcumulado', 'realizadoAcumulado', 'tendenciaAcumulado',
  'previstoSemanaQueVem', 'tendenciaSemanaQueVem', 'qtdCritico', 'qtdAtencao', 'autor',
];

function abaHistorico() {
  var planilha = SpreadsheetApp.getActiveSpreadsheet();
  var aba = planilha.getSheetByName(ABA);
  if (!aba) {
    aba = planilha.insertSheet(ABA);
    aba.getRange(1, 1, 1, CABECALHO.length).setValues([CABECALHO]);
    // Texto puro desde o nascimento -- mesma cautela de apps-script-alocacao.gs
    // (normalizarDia): evita qualquer coerção silenciosa do Sheets, inclusive
    // nas colunas numéricas vazias (a linha-resumo tem previsto/realizado/
    // tendência em branco).
    aba.getRange(1, 1, aba.getMaxRows(), CABECALHO.length).setNumberFormat('@');
  }
  return aba;
}

function valorOuVazio(v) {
  return (v === null || v === undefined) ? '' : v;
}

function linhaParaArray(l) {
  return [
    valorOuVazio(l.geradoEm), valorOuVazio(l.semanaInicio), valorOuVazio(l.semanaFim),
    valorOuVazio(l.sup), valorOuVazio(l.tipologia), valorOuVazio(l.dimensao),
    valorOuVazio(l.previstoSemanaAnterior), valorOuVazio(l.realizadoSemanaAnterior), valorOuVazio(l.tendenciaSemanaAnterior),
    valorOuVazio(l.previstoAcumulado), valorOuVazio(l.realizadoAcumulado), valorOuVazio(l.tendenciaAcumulado),
    valorOuVazio(l.previstoSemanaQueVem), valorOuVazio(l.tendenciaSemanaQueVem),
    valorOuVazio(l.qtdCritico), valorOuVazio(l.qtdAtencao), valorOuVazio(l.autor),
  ];
}

function resposta(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto)).setMimeType(ContentService.MimeType.JSON);
}

// corpo: { linhas: [...] } -- um lote inteiro por geração de relatório.
// appendRow por linha: sem upsert, sem checagem de duplicata -- cada clique
// no botão é um registro histórico novo, mesmo que a semana seja a mesma.
function doPost(e) {
  var corpo = JSON.parse(e.postData.contents);
  var aba = abaHistorico();
  var linhas = (corpo && corpo.linhas) || [];
  linhas.forEach(function (l) { aba.appendRow(linhaParaArray(l)); });
  return resposta({ ok: true, gravadas: linhas.length });
}
```

- [ ] **Step 2: Escrever `tools/semanal/historico-relatorio-sheet.js`**

```js
'use strict';

// Cliente de histórico do Relatório Semanal em Excel -- mesmo padrão dual
// Node+navegador de alocacao-sheet.js (fetch/armazenamento injetados,
// PENDENTE- cai em modo local sem tocar a rede). Diferente daquele, este é
// APPEND-ONLY: cada geração de relatório grava um lote NOVO, nunca atualiza
// um lote existente -- é histórico, não estado. Por isso não há "carregar":
// não existe um estado atual pra ler de volta, só o que já foi enviado.

var RE_URL_HISTORICO_PENDENTE = /^PENDENTE-/;
var CHAVE_FILA = 'historico-relatorio:fila';

function criarClienteHistoricoRelatorio(opcoes) {
  var o = opcoes || {};
  var url = String(o.url || '');
  var buscar = o.fetch;
  var armazenamento = o.armazenamento;
  var local = RE_URL_HISTORICO_PENDENTE.test(url) || !url;

  function lerJson(chave, padrao) {
    if (!armazenamento) return padrao;
    try { var texto = armazenamento.getItem(chave); return texto ? JSON.parse(texto) : padrao; }
    catch (err) { return padrao; }
  }
  function gravarJson(chave, valor) {
    if (!armazenamento) return;
    try { armazenamento.setItem(chave, JSON.stringify(valor)); } catch (err) { /* cota cheia */ }
  }
  function enfileirar(lote) {
    var fila = lerJson(CHAVE_FILA, []);
    fila.push(lote);
    gravarJson(CHAVE_FILA, fila);
  }
  async function enviar(lote) {
    var resposta = await buscar(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // requisição simples, sem preflight
      body: JSON.stringify(lote),
      redirect: 'follow',
    });
    if (!resposta || !resposta.ok) throw new Error('HTTP ' + (resposta && resposta.status));
    return await resposta.json();
  }

  return {
    modo: function () { return local ? 'local' : 'sheet'; },

    // lote: { linhas: [...] }. Sem URL publicada, não há onde enfileirar de
    // verdade (não sobrevive a um novo build, que troca a constante) --
    // devolve ok:true, modo:'local' sem tocar em nada.
    gravar: async function (lote) {
      if (local) return { ok: true, modo: 'local' };
      try {
        await enviar(lote);
        return { ok: true, modo: 'sheet' };
      } catch (err) {
        enfileirar(lote);
        return { ok: false, modo: 'sheet', erro: err.message };
      }
    },

    pendentes: function () { return lerJson(CHAVE_FILA, []); },

    tentarDeNovo: async function () {
      var fila = lerJson(CHAVE_FILA, []);
      var restantes = [];
      for (var i = 0; i < fila.length; i++) {
        try { await enviar(fila[i]); } catch (err) { restantes.push(fila[i]); }
      }
      gravarJson(CHAVE_FILA, restantes);
      return restantes.length;
    },
  };
}

module.exports = { criarClienteHistoricoRelatorio, RE_URL_HISTORICO_PENDENTE };
```

- [ ] **Step 3: Escrever `test/semanal-apps-script-historico-relatorio.test.js`**

```js
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
```

- [ ] **Step 4: Escrever `test/semanal-historico-relatorio-sheet.test.js`**

```js
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
```

- [ ] **Step 5: Rodar os dois testes e confirmar que passam**

Run: `node --test test/semanal-apps-script-historico-relatorio.test.js test/semanal-historico-relatorio-sheet.test.js`
Expected: 4 + 4 = 8 testes, todos PASS.

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/apps-script-historico-relatorio.gs tools/semanal/historico-relatorio-sheet.js test/semanal-apps-script-historico-relatorio.test.js test/semanal-historico-relatorio-sheet.test.js
git commit -m "$(cat <<'EOF'
Adiciona o historico do relatorio semanal (Apps Script + cliente)

Mesmo padrao dual Node+navegador de alocacao-sheet.js/apps-script-alocacao.gs,
mas append-only (cada geracao grava um lote novo, sem upsert -- e historico,
nao estado). Granularidade SUP x tipologia, nao por contrato (ver o spec).
EOF
)"
```

---

## Task 7: Wiring — botão na aba Consolidado

**Files:**
- Modify: `tools/semanal/render-aba-consolidado.js` (`renderControles`)
- Modify: `tools/semanal/render-semanal.js` (const `URL_HISTORICO_RELATORIO`, `BUNDLE_ARQUIVOS`, globais de módulo, `dadosJson`, `window.__HISTORICO_RELATORIO_URL__`, funções novas em `SCRIPT_CLIENTE_SEMANAL`, `montarAbaConsolidado`)
- Modify: `test/semanal-render-aba-consolidado.test.js` (novo teste)
- Create: `test/semanal-relatorio-wireup.test.js`

**Interfaces:**
- Consumes: `ComputeRelatorioSemanal`, `RenderRelatorioSemanalXlsx`, `HistoricoRelatorioSheet` (globais do bundle, Tasks 3–6); `indicesDaAba`, `semanasDoMesSelecionado`, `hojeEpochDoNavegador`, `mesSelecionadoIdx`, `filtrosSelecionadosSemanal`, `indicesFiltrados` (já existentes em `render-semanal.js`).

- [ ] **Step 1: Adicionar o botão em `renderControles` (`tools/semanal/render-aba-consolidado.js`)**

Troque:

```js
function renderControles(estado) {
  var e = estado || {};
  var semanas = e.semanas || [];
  var opcoesSemana = semanas.map(function (semana, i) {
    return '<option value="' + i + '"' + (i === e.semanaIdx ? ' selected' : '') + '>'
      + escapeHtml('S' + (i + 1) + ' (' + formatarIntervaloSemana(semana.inicio, semana.fim) + ')') + '</option>';
  }).join('');
  return '<div class="controles-consolidado">'
    + '<label class="controle-consolidado">Semana<select id="consolidado-semana">' + opcoesSemana + '</select></label>'
    + '</div>';
}
```

por:

```js
function renderControles(estado) {
  var e = estado || {};
  var semanas = e.semanas || [];
  var opcoesSemana = semanas.map(function (semana, i) {
    return '<option value="' + i + '"' + (i === e.semanaIdx ? ' selected' : '') + '>'
      + escapeHtml('S' + (i + 1) + ' (' + formatarIntervaloSemana(semana.inicio, semana.fim) + ')') + '</option>';
  }).join('');
  return '<div class="controles-consolidado">'
    + '<label class="controle-consolidado">Semana<select id="consolidado-semana">' + opcoesSemana + '</select></label>'
    + '<button id="gerar-relatorio-excel" type="button">Gerar relatório Excel</button>'
    + '<span id="status-relatorio-excel" class="status-atualizacao"></span>'
    + '</div>';
}
```

(`.status-atualizacao` já é estilizada por `cssBase()` — mesma classe que o span do botão "Atualizar dados" usa, sem CSS novo necessário.)

- [ ] **Step 2: Teste em `test/semanal-render-aba-consolidado.test.js`**

Acrescente ao final do arquivo:

```js
test('renderControles inclui o botão "Gerar relatório Excel" e o span de status, ao lado do seletor de semana', () => {
  const html = renderControles({ semanas: SEMANAS, semanaIdx: 0 });
  assert.match(html, /<button id="gerar-relatorio-excel" type="button">Gerar relatório Excel<\/button>/);
  assert.match(html, /<span id="status-relatorio-excel" class="status-atualizacao"><\/span>/);
});
```

- [ ] **Step 3: Rodar e confirmar**

Run: `node --test test/semanal-render-aba-consolidado.test.js`
Expected: PASS (mais este teste novo).

- [ ] **Step 4: `URL_HISTORICO_RELATORIO` e o transporte pro cliente (`tools/semanal/render-semanal.js`)**

Logo abaixo da linha `const URL_ALOCACAO = ...;` (por volta da linha 23), acrescente:

```js
// Web app do Apps Script que guarda o histórico do relatório semanal
// (tools/semanal/apps-script-historico-relatorio.gs). PENDENTE- até o dono
// do projeto publicar -- mesmo mecanismo de URL_ALOCACAO acima.
const URL_HISTORICO_RELATORIO = 'PENDENTE-publicar-o-apps-script-historico-relatorio';
```

Ache a linha `const dadosJson = JSON.stringify({ registros, baseline, demandas, alocacaoUrl: URL_ALOCACAO });` (por volta da linha 2848) e troque por:

```js
const dadosJson = JSON.stringify({ registros, baseline, demandas, alocacaoUrl: URL_ALOCACAO, historicoRelatorioUrl: URL_HISTORICO_RELATORIO });
```

Ache a linha `window.__ALOCACAO_URL__ = dados && dados.alocacaoUrl;` (por volta da linha 1097) e acrescente logo abaixo:

```js
window.__HISTORICO_RELATORIO_URL__ = dados && dados.historicoRelatorioUrl;
```

- [ ] **Step 5: `BUNDLE_ARQUIVOS` — registrar os 5 módulos novos**

Ache, dentro de `BUNDLE_ARQUIVOS` (por volta da linha 780):

```js
  'compute-semanal.js', 'compute-tendencia-semanal.js', 'render-aba-semanal.js', 'render-aba-alertas.js', 'render-aba-consolidado.js',
```

e troque por:

```js
  'compute-semanal.js', 'compute-tendencia-semanal.js', 'render-aba-semanal.js', 'render-aba-alertas.js', 'render-aba-consolidado.js',
  // Relatório Semanal em Excel (2026-08-16): zip-writer-browser.js e
  // xlsx-writer-browser.js não consomem nada same-dir (zip depende só de
  // zip-writer-browser.js, que já entra antes dele). compute-relatorio-
  // semanal.js consome compute-semanal.js, render-aba-semanal.js,
  // render-aba-alertas.js e render-aba-consolidado.js -- todos já
  // registrados acima. render-relatorio-semanal-xlsx.js consome compute-
  // relatorio-semanal.js e xlsx-writer-browser.js, ambos logo antes dele.
  // historico-relatorio-sheet.js não consome nada same-dir.
  'zip-writer-browser.js', 'xlsx-writer-browser.js', 'compute-relatorio-semanal.js',
  'render-relatorio-semanal-xlsx.js', 'historico-relatorio-sheet.js',
```

- [ ] **Step 6: Globais de módulo no `SCRIPT_CLIENTE_SEMANAL`**

Ache a linha `var AlocacaoSheet = MODULOS['alocacao-sheet.js'];` (por volta da linha 926) e acrescente logo abaixo:

```js
var RenderRelatorioSemanalXlsx = MODULOS['render-relatorio-semanal-xlsx.js'];
var HistoricoRelatorioSheet = MODULOS['historico-relatorio-sheet.js'];
```

(`compute-relatorio-semanal.js` NÃO ganha global próprio: o script de cliente nunca chama `ComputeRelatorioSemanal` diretamente, só por dentro de `RenderRelatorioSemanalXlsx.gerarRelatorioSemanalXlsx` — mesmo critério que `compute-tendencia-semanal.js` já segue, sem global, só consumido internamente por `render-aba-semanal.js`.)

- [ ] **Step 7: Handler do botão — acrescentar dentro de `SCRIPT_CLIENTE_SEMANAL`, próximo a `clienteAlocacao()`**

```js
var ESTADO_RELATORIO_SEMANAL = { cliente: null };

function clienteHistoricoRelatorio() {
  if (!ESTADO_RELATORIO_SEMANAL.cliente) {
    ESTADO_RELATORIO_SEMANAL.cliente = HistoricoRelatorioSheet.criarClienteHistoricoRelatorio({
      url: (window.__HISTORICO_RELATORIO_URL__ || 'PENDENTE-publicar-o-apps-script-historico-relatorio'),
      fetch: function (u, o) { return fetch(u, o); },
      armazenamento: window.localStorage,
    });
  }
  return ESTADO_RELATORIO_SEMANAL.cliente;
}

// O relatório sempre mostra Volume E Equipes juntos (não depende de qual
// dimensão está marcada na barra compartilhada) -- por isso usa 'volume'
// fixo pra decidir o recorte de "somente ativos" (mesma coerção que o
// Consolidado já aplica quando a barra está em Equipes, ver
// dimensaoDaTabela em render-aba-consolidado.js).
function montarOpcoesRelatorioSemanal(registros, indices) {
  var indicesAba = indicesDaAba(indices, 'volume');
  var semanas = semanasDoMesSelecionado();
  var hojeEpoch = hojeEpochDoNavegador();
  return {
    registros: registros, indices: indicesAba,
    ano: window.__ANO__, mesIdx: mesSelecionadoIdx, semanas: semanas,
    indiceAtual: ComputeSemanal.indiceSemanaAtual(semanas, hojeEpoch),
    demandas: window.__DEMANDAS__, hojeEpoch: hojeEpoch,
    geradoEm: new Date(), autor: (window.__ALOCACAO_AUTOR__ || 'dashboard'),
  };
}

function celulaHistoricoOuVazia(v) { return (v === null || v === undefined) ? '' : v; }

// Uma linha por (SUP x Tipologia) -- os registros ('registro', ver compute-
// relatorio-semanal.js) de Volume e de Equipes, mais a linha-resumo de
// fechamento da geração. Granularidade por CONTRATO fica só no .xlsx
// baixado (ver o spec, "Histórico").
function montarLoteHistoricoRelatorio(resultado, opcoes) {
  var semanaVigente = opcoes.semanas[opcoes.indiceAtual] || {};
  var geradoEmIso = opcoes.geradoEm.toISOString();
  var linhas = [];

  function linhasDaDimensao(nomeDimensao, linhasHierarquia) {
    linhasHierarquia.filter(function (l) { return l.tipo === 'registro'; }).forEach(function (l) {
      linhas.push({
        geradoEm: geradoEmIso, semanaInicio: semanaVigente.inicio, semanaFim: semanaVigente.fim,
        sup: l.sup, tipologia: l.tipologia, dimensao: nomeDimensao,
        previstoSemanaAnterior: celulaHistoricoOuVazia(l.janelas.semanaAnterior.previsto),
        realizadoSemanaAnterior: celulaHistoricoOuVazia(l.janelas.semanaAnterior.realizado),
        tendenciaSemanaAnterior: celulaHistoricoOuVazia(l.janelas.semanaAnterior.tendencia),
        previstoAcumulado: celulaHistoricoOuVazia(l.janelas.acumulado.previsto),
        realizadoAcumulado: celulaHistoricoOuVazia(l.janelas.acumulado.realizado),
        tendenciaAcumulado: celulaHistoricoOuVazia(l.janelas.acumulado.tendencia),
        previstoSemanaQueVem: celulaHistoricoOuVazia(l.janelas.semanaQueVem.previsto),
        tendenciaSemanaQueVem: celulaHistoricoOuVazia(l.janelas.semanaQueVem.tendencia),
        autor: opcoes.autor,
      });
    });
  }
  linhasDaDimensao('volume', resultado.linhasVolume);
  linhasDaDimensao('equipes', resultado.linhasEquipes);

  linhas.push({
    geradoEm: geradoEmIso, semanaInicio: semanaVigente.inicio, semanaFim: semanaVigente.fim,
    sup: '—', tipologia: 'TOTAL GERAL', dimensao: '',
    qtdCritico: resultado.resumo.critico, qtdAtencao: resultado.resumo.atencao,
    autor: opcoes.autor,
  });

  return { linhas: linhas };
}

function nomeArquivoRelatorio(geradoEm) {
  var dd = (geradoEm.getDate() < 10 ? '0' : '') + geradoEm.getDate();
  var mm = (geradoEm.getMonth() + 1 < 10 ? '0' : '') + (geradoEm.getMonth() + 1);
  return 'relatorio-semanal-' + geradoEm.getFullYear() + '-' + mm + '-' + dd + '.xlsx';
}

function baixarArquivoXlsx(bytes, nomeArquivo) {
  var blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function definirStatusRelatorio(texto) {
  var span = document.getElementById('status-relatorio-excel');
  if (span) span.textContent = texto;
}

async function gerarRelatorioExcel() {
  definirStatusRelatorio('Gerando...');
  var indices = indicesFiltrados(
    window.__REGISTROS__,
    filtrosSelecionadosSemanal.tipologia, filtrosSelecionadosSemanal.categoria,
    filtrosSelecionadosSemanal.grupo, filtrosSelecionadosSemanal.sup, filtrosSelecionadosSemanal.origem
  );
  var opcoes = montarOpcoesRelatorioSemanal(window.__REGISTROS__, indices);
  var resultado = RenderRelatorioSemanalXlsx.gerarRelatorioSemanalXlsx(opcoes);
  baixarArquivoXlsx(resultado.bytes, nomeArquivoRelatorio(opcoes.geradoEm));

  var lote = montarLoteHistoricoRelatorio(resultado, opcoes);
  var envio = await clienteHistoricoRelatorio().gravar(lote);
  definirStatusRelatorio(
    'Relatório baixado (Crítico: ' + resultado.resumo.critico + ' · Atenção: ' + resultado.resumo.atencao + ')'
    + (envio.ok ? '' : ' -- histórico será reenviado depois (sem rede)')
  );
}
```

- [ ] **Step 8: Ligar o clique dentro de `montarAbaConsolidado`**

Ache, dentro de `montarAbaConsolidado` (por volta da linha 2133):

```js
  var seletorSemana = document.getElementById('consolidado-semana');
  if (seletorSemana) {
    seletorSemana.addEventListener('change', function (e) {
      ESTADO_CONSOLIDADO.semana = parseInt(e.target.value, 10);
      montarAbaConsolidado(registros, indices, dimensoes);
    });
  }
}
```

e troque por:

```js
  var seletorSemana = document.getElementById('consolidado-semana');
  if (seletorSemana) {
    seletorSemana.addEventListener('change', function (e) {
      ESTADO_CONSOLIDADO.semana = parseInt(e.target.value, 10);
      montarAbaConsolidado(registros, indices, dimensoes);
    });
  }
  var botaoRelatorio = document.getElementById('gerar-relatorio-excel');
  if (botaoRelatorio) botaoRelatorio.addEventListener('click', gerarRelatorioExcel);
}
```

- [ ] **Step 9: Escrever `test/semanal-relatorio-wireup.test.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { renderSemanal } = require('../tools/semanal/render-semanal.js');
const { criarDocumentoFalso } = require('./helpers/dom-falso-semanal.js');

const SENHA_FAKE = 'senha-fake-de-teste-relatorio-nao-e-a-real';
const PERIODOS_2026 = Array.from({ length: 12 }, (_, mes) => new Date(Date.UTC(2026, mes, 1)));
const DEMANDAS_VAZIAS = { tipologias: [], totais: {}, porRegistroEventos: {} };

function registroSintetico(sup, tomador, tipologia, previstoVolumeMes) {
  const zeros = new Array(12).fill(0);
  const volume = new Array(12).fill(0); volume[6] = previstoVolumeMes; // julho
  const bloco = (equipes, vol, financeiro) => ({
    equipes, volume: vol, financeiro,
    equipesResumo: { pico: 2, media: 2, prod: 8, dias: 25 },
    volumeResumo: { total: 0, totalInicial: 0, ticket: 1 },
    financeiroResumo: { total: 0, totalInicial: 0 },
  });
  return {
    sup, grupo: 'Grupo-Relatorio', tomador, tipologia,
    previsto: bloco(new Array(12).fill(2), volume, zeros),
    realizado: bloco(new Array(12).fill(0), zeros, zeros),
    total: bloco(new Array(12).fill(2), zeros, zeros),
  };
}

// Mesmo padrão de test/semanal-render-semanal-wireup.test.js (6 <script>,
// vm.Context isolado), com Blob/URL/document.createElement A MAIS -- a aba
// Consolidado ganhou um botão que baixa um .xlsx via Blob, e o DOM falso
// compartilhado (dom-falso-semanal.js) não tinha createElement porque
// nenhum recurso anterior precisava criar elemento nenhum.
function montarSandbox(html) {
  const blocos = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(blocos.length, 6);
  const codigo = blocos.join('\n;\n');

  const documentoFalso = criarDocumentoFalso();
  const ancoraCriada = { href: '', download: '', style: {}, cliques: 0, click() { this.cliques++; } };
  documentoFalso.createElement = () => ancoraCriada;
  documentoFalso.body = { appendChild() {}, removeChild() {} };

  const blobsCriados = [];
  function BlobFalso(partes, opcoes) { blobsCriados.push({ partes, opcoes }); }
  const URLFalso = { createObjectURL() { return 'blob:fake-url'; }, revokeObjectURL() {} };

  const sandbox = {
    document: documentoFalso, atob, btoa, crypto, TextEncoder, TextDecoder, console,
    fetch: () => Promise.reject(new Error('fetch não mockado neste teste')),
    localStorage: { getItem: () => null, setItem() {} },
    Blob: BlobFalso, URL: URLFalso,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(codigo, sandbox, { filename: 'planejamento-semanal-relatorio-teste.js' });
  return { sandbox, documentoFalso, ancoraCriada, blobsCriados };
}

test('a aba Consolidado tem o botão "Gerar relatório Excel" e o span de status', () => {
  const html = renderSemanal({ registros: [], baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z') });
  assert.match(html, /<button id="gerar-relatorio-excel" type="button">/);
  assert.match(html, /<span id="status-relatorio-excel"[^>]*><\/span>/);
});

test('clicar em "Gerar relatório Excel" baixa um .xlsx (via Blob) e o status reflete a contagem de desvios', async () => {
  const registros = [
    registroSintetico('SUP-0001-24', 'Tomador-A', 'ST', 100),
    registroSintetico('SUP-0002-24', 'Tomador-B', 'ST', 50),
  ];
  const geradoEm = new Date('2026-07-15T00:00:00Z'); // dentro de julho/2026
  const html = renderSemanal({ registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });
  const { sandbox, documentoFalso, ancoraCriada, blobsCriados } = montarSandbox(html);

  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  await sandbox.gerarRelatorioExcel();

  assert.strictEqual(blobsCriados.length, 1, 'esperava um Blob criado (o .xlsx)');
  assert.strictEqual(blobsCriados[0].opcoes.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.ok(blobsCriados[0].partes[0].length > 0, 'o .xlsx não pode vir vazio');
  assert.strictEqual(ancoraCriada.cliques, 1, 'o link de download precisa ser clicado uma vez');
  assert.match(ancoraCriada.download, /^relatorio-semanal-\d{4}-\d{2}-\d{2}\.xlsx$/);
  assert.match(documentoFalso.getElementById('status-relatorio-excel').textContent, /Relatório baixado \(Crítico: \d+ · Atenção: \d+\)/);
});

test('a chamada a RenderRelatorioSemanalXlsx.gerarRelatorioSemanalXlsx e a HistoricoRelatorioSheet.criarClienteHistoricoRelatorio estão no código-fonte de gerarRelatorioExcel', () => {
  const html = renderSemanal({ registros: [], baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z') });
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const scriptCliente = scripts[5][1];
  assert.match(scriptCliente, /RenderRelatorioSemanalXlsx\.gerarRelatorioSemanalXlsx\(/);
  assert.match(scriptCliente, /HistoricoRelatorioSheet\.criarClienteHistoricoRelatorio\(/);
});
```

- [ ] **Step 10: Rodar toda a suíte e confirmar que passa, sem quebrar nada existente**

Run: `node --test test/*.test.js`
Expected: todos os testes PASS, incluindo os ~17 novos deste plano (Tasks 1–7) e os já existentes.

- [ ] **Step 11: Commit**

```bash
git add tools/semanal/render-aba-consolidado.js tools/semanal/render-semanal.js test/semanal-render-aba-consolidado.test.js test/semanal-relatorio-wireup.test.js
git commit -m "$(cat <<'EOF'
Liga o botao "Gerar relatorio Excel" na aba Consolidado

Monta o .xlsx 100% no navegador (compute-relatorio-semanal + render-
relatorio-semanal-xlsx), baixa via Blob, e grava um lote no historico
(historico-relatorio-sheet, URL ainda PENDENTE- ate ser publicada).
EOF
)"
```

---

## Task 8: Build & Publish

**Pré-requisito obrigatório:** só execute esta tarefa depois que as Tasks 1–7 tiverem passado por revisão de código. Nenhum passo abaixo roda antes disso (regra permanente do projeto — ver `CLAUDE.md`, "nada é publicado antes das revisões passarem").

**Files:**
- Modify: `dist/planejamento-semanal.html` (gerado pelo build)
- Modify: `docs/planejamento-semanal.html` (cópia de publicação)

- [ ] **Step 1: Rodar a suíte inteira uma última vez**

Run: `node --test test/*.test.js`
Expected: todos PASS (nenhuma falha, nenhum teste pulado inesperadamente).

- [ ] **Step 2: Buscar a senha do build com o dono do projeto e reconstruir**

```bash
ORCAMENTO_SENHA='<peça ao dono do projeto>' node tools/semanal/build-dashboard.js
```

Expected: `dist/planejamento-semanal.html` regenerado sem erro.

- [ ] **Step 3: Copiar para `docs/` (regra fixa do projeto — o Pages serve `/docs`, não `/dist`)**

```bash
cp dist/planejamento-semanal.html docs/planejamento-semanal.html
```

- [ ] **Step 4: Rebase sobre o `origin/master` mais recente (pode ter avançado durante a implementação)**

```bash
git fetch origin master
git rebase origin/master
```

Se houver conflito num arquivo de DADOS compartilhado (CSVs online, `historico.json` etc. — não deveria haver neste plano, que só toca `tools/semanal/`, `test/` e os dois HTMLs gerados), resolva a favor do `upstream` e nunca com `--force` no push. Este plano não toca nenhum arquivo de dados compartilhado, então o rebase deve ser direto.

- [ ] **Step 5: Rodar a suíte de novo depois do rebase**

Run: `node --test test/*.test.js`
Expected: todos PASS — confirma que o rebase não quebrou nada.

- [ ] **Step 6: Commit e push**

```bash
git add dist/planejamento-semanal.html docs/planejamento-semanal.html
git commit -m "$(cat <<'EOF'
Reconstroi e publica: botao "Gerar relatorio Excel" na aba Consolidado

Relatorio semanal gerencial (Previsto/Realizado/Tendencia de Volume e
Equipes, por tipologia e contrato, 3 janelas de tempo, capitulo de desvios,
campos de Acao/Responsavel) gerado 100% no navegador, com historico gravado
numa Google Sheet via Apps Script.
EOF
)"
git push origin master
```

- [ ] **Step 7: Verificar ao vivo**

```bash
curl -s https://amcaccere261283.github.io/orcamento-dashboard/planejamento-semanal.html | grep -o 'Gerado em[^<]*'
```

Expected: a data/hora bate com a deste build (não um deploy anterior). Se divergir, o Pages ainda não processou o push — normal levar alguns minutos; reconfirme depois.

- [ ] **Step 8: Anotar a pendência manual (não automatizável por este plano)**

`URL_HISTORICO_RELATORIO` (`tools/semanal/render-semanal.js`) continua `'PENDENTE-publicar-o-apps-script-historico-relatorio'` até o dono do projeto:
1. Criar uma Google Sheet nova, colar `tools/semanal/apps-script-historico-relatorio.gs` no Apps Script dela (ver as instruções no topo do próprio arquivo).
2. Implantar como App da Web ("Qualquer pessoa" com acesso) e copiar a URL `/exec`.
3. Trocar `URL_HISTORICO_RELATORIO` por essa URL, reconstruir (Steps 1–7 acima) e publicar de novo.

Até lá, o botão continua funcionando (o .xlsx baixa normalmente) — só o histórico central fica em modo local (fila no `localStorage` de cada navegador, nunca sincronizada), exatamente como `URL_ALOCACAO` funcionou entre a implementação da aba Alocação e a publicação do respectivo Apps Script.
