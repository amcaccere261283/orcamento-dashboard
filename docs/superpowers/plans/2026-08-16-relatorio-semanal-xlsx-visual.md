# Layout visual do Relatório Semanal em Excel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar cara de relatório ao `.xlsx` gerado pela aba Consolidado da página semanal (título, cabeçalho de tabela, zebra, larguras de coluna, congelamento de painel, formatação numérica) sem mudar nenhum número que ele já mostra.

**Architecture:** Estender o motor OOXML minimalista `tools/semanal/xlsx-writer-browser.js` com um catálogo fixo de estilos nomeados (resolvidos para `cellXfs` no `styles.xml`) mais suporte a largura de coluna, células mescladas, congelamento de painel e altura de linha. `tools/semanal/render-relatorio-semanal-xlsx.js` passa a referenciar esses estilos ao montar as 4 abas, e ganha uma linha de título mesclada no topo de cada uma.

**Tech Stack:** JavaScript puro (Node `var`/`function`, sem ES6 classes — convenção do bundle de navegador), `node:test` para os testes, `unzip` (CLI) para inspecionar o `.xlsx` gerado nos testes.

## Global Constraints

- Escopo só em `tools/semanal/xlsx-writer-browser.js` e
  `tools/semanal/render-relatorio-semanal-xlsx.js` (+ seus testes). Não tocar
  `tools/lib/xlsx-writer.js` (repositório irmão).
- Nenhuma mudança em `compute-relatorio-semanal.js` nem em qualquer conta —
  só formatação visual.
- Todo cell builder novo (`str`/`num`) precisa continuar funcionando SEM o
  parâmetro de estilo (compatibilidade com o resto do projeto que ainda não
  usa estilo).
- Rodar `node --test test/*.test.js` inteiro (não só os arquivos tocados) no
  fim de cada tarefa, para pegar qualquer regressão cruzada.
- `'use strict'` no topo de cada arquivo `.js`, mesmo padrão `var`/`function`
  já usado nos dois arquivos (não introduzir `const`/`let`/arrow functions —
  são módulos que entram no bundle de navegador via
  `tools/comum/browser-bundle.js`, que reescreve `require()` por posição de
  diretório, não transpila sintaxe nova).

---

## Task 1: Motor de estilo, largura de coluna, merge e congelamento no xlsx-writer-browser.js

**Files:**
- Modify: `tools/semanal/xlsx-writer-browser.js` (arquivo inteiro, 153 linhas)
- Test: `test/semanal-xlsx-writer-browser.test.js`

**Interfaces:**
- Consumes: nada de tarefas anteriores (primeira tarefa).
- Produces:
  - `str(value, estilo?)`, `num(value, estilo?)`, `formula(f, estilo?)` — `estilo` é uma string opcional, um dos nomes do catálogo abaixo. Sem o parâmetro, comportamento idêntico ao de hoje.
  - Catálogo de nomes de estilo válidos (usados pelas Tasks 2-4):
    `titulo`, `cabecalhoTabela`, `rotulo`, `texto`, `textoZebra`, `textoTotal`,
    `numeroMilhar`, `numeroMilharZebra`, `numeroMilharTotal`,
    `numeroDuasCasas`, `numeroDuasCasasZebra`, `numeroDuasCasasTotal`.
  - `buildXlsx(sheets)` — `sheets[i]` ganha 4 chaves novas, todas opcionais:
    `colWidths: number[]` (largura por coluna, 1 valor por índice de coluna,
    índices `null`/ausentes pulam a coluna), `merges: string[]` (refs tipo
    `'A1:L1'`), `freezeRows: number` (congela as N primeiras linhas),
    `rowHeights: { [numeroDaLinha1Indexado]: altura }`.

- [ ] **Step 1: Escrever os testes novos (falhando)**

Adicionar ao final de `test/semanal-xlsx-writer-browser.test.js` (depois do
último teste existente, mantendo os imports do topo do arquivo):

```js
test('str/num com estilo gravam o atributo s com o índice do estilo nomeado', () => {
  const sheets = [{ name: 'S', rows: [[str('Título', 'titulo'), num(42, 'numeroMilhar')]] }];
  const outDir = buildAndExtract(sheets);
  const sheetXml = fs.readFileSync(path.join(outDir, 'xl', 'worksheets', 'sheet1.xml'), 'utf8');
  assert.match(sheetXml, /<c r="A1" s="1" t="inlineStr">/);
  assert.match(sheetXml, /<c r="B1" s="7"><v>42<\/v><\/c>/);
});

test('str/num sem estilo continuam sem atributo s (compatibilidade)', () => {
  const sheets = [{ name: 'S', rows: [[str('SUP'), num(74)]] }];
  const outDir = buildAndExtract(sheets);
  const sheetXml = fs.readFileSync(path.join(outDir, 'xl', 'worksheets', 'sheet1.xml'), 'utf8');
  assert.match(sheetXml, /<c r="A1" t="inlineStr"><is><t>SUP<\/t><\/is><\/c>/);
  assert.match(sheetXml, /<c r="B1"><v>74<\/v><\/c>/);
});

test('sheet.colWidths vira <cols> com uma largura por coluna', () => {
  const sheets = [{ name: 'S', rows: [[str('A'), str('B')]], colWidths: [12, 30] }];
  const outDir = buildAndExtract(sheets);
  const sheetXml = fs.readFileSync(path.join(outDir, 'xl', 'worksheets', 'sheet1.xml'), 'utf8');
  assert.match(sheetXml, /<cols><col min="1" max="1" width="12" customWidth="1"\/><col min="2" max="2" width="30" customWidth="1"\/><\/cols>/);
});

test('sheet.merges vira <mergeCells>', () => {
  const sheets = [{ name: 'S', rows: [[str('Título')]], merges: ['A1:B1'] }];
  const outDir = buildAndExtract(sheets);
  const sheetXml = fs.readFileSync(path.join(outDir, 'xl', 'worksheets', 'sheet1.xml'), 'utf8');
  assert.match(sheetXml, /<mergeCells count="1"><mergeCell ref="A1:B1"\/><\/mergeCells>/);
});

test('sheet.freezeRows congela as N primeiras linhas', () => {
  const sheets = [{ name: 'S', rows: [[str('Título')], [str('Cabeçalho')], [str('Dado')]], freezeRows: 2 }];
  const outDir = buildAndExtract(sheets);
  const sheetXml = fs.readFileSync(path.join(outDir, 'xl', 'worksheets', 'sheet1.xml'), 'utf8');
  assert.match(sheetXml, /<pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"\/>/);
});

test('sheet.rowHeights define a altura de uma linha específica', () => {
  const sheets = [{ name: 'S', rows: [[str('Título')], [str('Normal')]], rowHeights: { 1: 28 } }];
  const outDir = buildAndExtract(sheets);
  const sheetXml = fs.readFileSync(path.join(outDir, 'xl', 'worksheets', 'sheet1.xml'), 'utf8');
  assert.match(sheetXml, /<row r="1" ht="28" customHeight="1">/);
  assert.match(sheetXml, /<row r="2">/);
});

test('sem colWidths/merges/freezeRows/rowHeights, a saída não ganha nenhuma das tags novas', () => {
  const sheets = [{ name: 'S', rows: [[str('A')]] }];
  const outDir = buildAndExtract(sheets);
  const sheetXml = fs.readFileSync(path.join(outDir, 'xl', 'worksheets', 'sheet1.xml'), 'utf8');
  assert.ok(!sheetXml.includes('<cols>'));
  assert.ok(!sheetXml.includes('<mergeCells'));
  assert.ok(!sheetXml.includes('<sheetViews'));
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node --test test/semanal-xlsx-writer-browser.test.js`
Expected: os 6 testes novos falham (estilo/colWidths/merges/freezeRows/
rowHeights ainda não existem); os testes antigos continuam passando.

- [ ] **Step 3: Implementar o motor de estilo e as 4 capacidades novas**

Substituir o conteúdo de `tools/semanal/xlsx-writer-browser.js` por:

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

// Catálogo fixo de estilos nomeados -> índice de cellXfs (stylesXml()
// abaixo declara os cellXfs NESTA ordem -- mudar aqui sem mudar lá
// desalinha estilo com índice em silêncio). str/num/formula recebem o NOME;
// só o motor conhece o índice numérico.
var ESTILO_INDICE = {
  titulo: 1, cabecalhoTabela: 2, rotulo: 3,
  texto: 4, textoZebra: 5, textoTotal: 6,
  numeroMilhar: 7, numeroMilharZebra: 8, numeroMilharTotal: 9,
  numeroDuasCasas: 10, numeroDuasCasasZebra: 11, numeroDuasCasasTotal: 12,
};

function str(value, estilo) { return { type: 'str', value: String(value), estilo: estilo || null }; }
function num(value, estilo) { return { type: 'num', value: value, estilo: estilo || null }; }
function formula(f, estilo) { return { type: 'formula', formula: f, estilo: estilo || null }; }

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function cellXml(cell, ref) {
  if (cell == null) return '';
  var s = cell.estilo ? ' s="' + ESTILO_INDICE[cell.estilo] + '"' : '';
  if (cell.type === 'str') return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t>' + escapeXml(cell.value) + '</t></is></c>';
  if (cell.type === 'num') return '<c r="' + ref + '"' + s + '><v>' + cell.value + '</v></c>';
  if (cell.type === 'formula') return '<c r="' + ref + '"' + s + '><f>' + escapeXml(cell.formula) + '</f></c>';
  throw new Error('Unknown cell type: ' + cell.type);
}

function rowsXml(rows, rowHeights) {
  var xml = '';
  rows.forEach(function (row, i) {
    var rowNum = i + 1;
    var alturaAttr = (rowHeights && rowHeights[rowNum]) ? ' ht="' + rowHeights[rowNum] + '" customHeight="1"' : '';
    var cellsXml = '';
    row.forEach(function (cell, colIdx) {
      if (cell == null) return;
      cellsXml += cellXml(cell, colIndexToLetter(colIdx) + rowNum);
    });
    xml += '<row r="' + rowNum + '"' + alturaAttr + '">' + cellsXml + '</row>';
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

function sheetViewsXml(freezeRows) {
  if (!freezeRows) return '';
  var topLeft = 'A' + (freezeRows + 1);
  return '<sheetViews><sheetView workbookViewId="0">'
    + '<pane ySplit="' + freezeRows + '" topLeftCell="' + topLeft + '" activePane="bottomLeft" state="frozen"/>'
    + '<selection pane="bottomLeft" activeCell="' + topLeft + '" sqref="' + topLeft + '"/>'
    + '</sheetView></sheetViews>';
}

function colsXml(colWidths) {
  if (!colWidths || colWidths.length === 0) return '';
  var xml = '<cols>';
  colWidths.forEach(function (w, i) {
    if (w == null) return;
    var colNum = i + 1;
    xml += '<col min="' + colNum + '" max="' + colNum + '" width="' + w + '" customWidth="1"/>';
  });
  xml += '</cols>';
  return xml;
}

function mergeCellsXml(merges) {
  if (!merges || merges.length === 0) return '';
  var xml = '<mergeCells count="' + merges.length + '">';
  merges.forEach(function (ref) { xml += '<mergeCell ref="' + ref + '"/>'; });
  xml += '</mergeCells>';
  return xml;
}

function sheetXml(sheet) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + sheetViewsXml(sheet.freezeRows)
    + colsXml(sheet.colWidths)
    + '<sheetData>' + rowsXml(sheet.rows, sheet.rowHeights) + '</sheetData>'
    + mergeCellsXml(sheet.merges)
    + conditionalFormattingXml(sheet.conditionalFormats)
    + '</worksheet>';
}

// cellXfs, NESTA ordem, tem que bater índice a índice com ESTILO_INDICE
// acima. fontId/fillId/borderId referenciam <fonts>/<fills>/<borders> logo
// abaixo. numFmtId 3 = "#,##0" e 4 = "#,##0.00" são formatos EMBUTIDOS do
// Excel (ECMA-376) -- não precisam de <numFmts> custom.
function stylesXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="4">'
    + '<font><sz val="10"/><name val="Arial"/></font>'
    + '<font><b/><sz val="10"/><name val="Arial"/></font>'
    + '<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>'
    + '<font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>'
    + '</fonts>'
    + '<fills count="5">'
    + '<fill><patternFill patternType="none"/></fill>'
    + '<fill><patternFill patternType="gray125"/></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FF1A1A19"/><bgColor indexed="64"/></patternFill></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFE8E8E8"/><bgColor indexed="64"/></patternFill></fill>'
    + '</fills>'
    + '<borders count="3">'
    + '<border><left/><right/><top/><bottom/><diagonal/></border>'
    + '<border><left style="thin"><color rgb="FFD9D9D9"/></left><right style="thin"><color rgb="FFD9D9D9"/></right><top style="thin"><color rgb="FFD9D9D9"/></top><bottom style="thin"><color rgb="FFD9D9D9"/></bottom><diagonal/></border>'
    + '<border><left/><right/><top/><bottom style="medium"><color rgb="FFF6B53F"/></bottom><diagonal/></border>'
    + '</borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="13">'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    + '<xf numFmtId="0" fontId="3" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>'
    + '<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
    + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left"/></xf>'
    + '<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left"/></xf>'
    + '<xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left"/></xf>'
    + '<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>'
    + '<xf numFmtId="3" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>'
    + '<xf numFmtId="3" fontId="1" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>'
    + '<xf numFmtId="4" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>'
    + '<xf numFmtId="4" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>'
    + '<xf numFmtId="4" fontId="1" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>'
    + '</cellXfs>'
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

// sheets: [{ name, rows: cell[][], conditionalFormats?, colWidths?,
//   merges?, freezeRows?, rowHeights? }] -> Uint8Array (.xlsx)
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

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --test test/semanal-xlsx-writer-browser.test.js`
Expected: todos os testes (os antigos + os 6 novos) passam.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/xlsx-writer-browser.js test/semanal-xlsx-writer-browser.test.js
git commit -m "$(cat <<'EOF'
xlsx-writer-browser: estilo nomeado, largura de coluna, merge e congelamento

Catálogo fixo de estilos (título, cabeçalho de tabela, zebra, total,
formatos numéricos) resolvido para cellXfs, mais suporte a <cols>,
<mergeCells> e painel congelado. str/num continuam funcionando sem
estilo -- nenhuma chamada existente muda de comportamento.
EOF
)"
```

---

## Task 2: Aba Resumo — título e rótulos estilizados

**Files:**
- Modify: `tools/semanal/render-relatorio-semanal-xlsx.js:43-67` (`montarAbaResumo`)
- Test: `test/semanal-render-relatorio-semanal-xlsx.test.js`

**Interfaces:**
- Consumes: `str(value, estilo)` de `xlsx-writer-browser.js` (Task 1) — estilos `titulo` e `rotulo`.
- Produces: `montarAbaResumo(...)` continua devolvendo `{ name: 'Resumo', rows }`, agora também com `colWidths`/`rowHeights`/`merges`. Assinatura e ordem das 14 linhas **não mudam** — só ganham `estilo`.

- [ ] **Step 1: Escrever o teste novo (falhando)**

Adicionar em `test/semanal-render-relatorio-semanal-xlsx.test.js`, depois do
teste `'a aba Resumo quebra Crítico/Atenção por dimensão...'`:

```js
test('a aba Resumo tem título mesclado A1:B1 e larguras de coluna, sem mudar as 14 linhas de conteúdo', () => {
  const resultado = RenderRelatorioSemanalXlsx.gerarRelatorioSemanalXlsx(opcoesComDesvios());
  const sheetXml = extrairAba(resultado.bytes, 1); // Resumo
  assert.match(sheetXml, /<mergeCells count="1"><mergeCell ref="A1:B1"\/><\/mergeCells>/);
  assert.match(sheetXml, /<c r="A1" s="1" t="inlineStr">/);
  assert.match(sheetXml, /<cols><col min="1" max="1" width="32" customWidth="1"\/><col min="2" max="2" width="24" customWidth="1"\/><\/cols>/);
  // as 14 linhas de sempre continuam nas mesmas posições -- B9/B13 inalterados
  assert.match(sheetXml, /<t>Desvios Crítico \(por contrato\)<\/t><\/is><\/c><c r="B9"><v>3<\/v><\/c>/);
  assert.match(sheetXml, /<t>  Equipes — Crítico<\/t><\/is><\/c><c r="B13"><v>0<\/v><\/c>/);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-render-relatorio-semanal-xlsx.test.js`
Expected: o teste novo falha (sem merge/cols/estilo ainda); os demais continuam passando.

- [ ] **Step 3: Implementar**

Em `tools/semanal/render-relatorio-semanal-xlsx.js`, substituir a função
`montarAbaResumo` (linhas 43-67) por:

```js
var COLS_RESUMO = [32, 24];

function montarAbaResumo(opcoes, resumo, janelaAnterior, janelaSeguinte) {
  var semanaVigente = opcoes.semanas[opcoes.indiceAtual];
  function intervalo(alvo) {
    return alvo && alvo.semana ? formatarDataCurta(alvo.semana.inicio) + ' a ' + formatarDataCurta(alvo.semana.fim) : '—';
  }
  var volumeResumo = resumo.porDimensao.Volume || { critico: 0, atencao: 0 };
  var equipesResumo = resumo.porDimensao.Equipes || { critico: 0, atencao: 0 };
  var rows = [
    [str('Relatório Semanal — Planejamento · Resumo', 'titulo'), str('', 'titulo')],
    [str('Mês/ano do relatório', 'rotulo'), str(NOMES_MES[opcoes.mesIdx] + '/' + opcoes.ano)],
    [str('Semana anterior', 'rotulo'), str(intervalo(janelaAnterior))],
    [str('Semana vigente', 'rotulo'), str(semanaVigente ? formatarDataCurta(semanaVigente.inicio) + ' a ' + formatarDataCurta(semanaVigente.fim) : '—')],
    [str('Semana que vem', 'rotulo'), str(intervalo(janelaSeguinte))],
    [str('Gerado em', 'rotulo'), str(formatarDataHora(opcoes.geradoEm))],
    [str('Gerado por', 'rotulo'), str(opcoes.autor || 'dashboard')],
    [str('')],
    [str('Desvios Crítico (por contrato)', 'rotulo'), num(resumo.critico)],
    [str('Desvios Atenção (por contrato)', 'rotulo'), num(resumo.atencao)],
    [str('  Volume — Crítico', 'rotulo'), num(volumeResumo.critico)],
    [str('  Volume — Atenção', 'rotulo'), num(volumeResumo.atencao)],
    [str('  Equipes — Crítico', 'rotulo'), num(equipesResumo.critico)],
    [str('  Equipes — Atenção', 'rotulo'), num(equipesResumo.atencao)],
  ];
  return { name: 'Resumo', rows: rows, colWidths: COLS_RESUMO, rowHeights: { 1: 28 }, merges: ['A1:B1'] };
}
```

Nenhuma outra função do arquivo muda nesta tarefa.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/semanal-render-relatorio-semanal-xlsx.test.js`
Expected: todos os testes passam, incluindo os antigos de B9/B10/B11-B14 (inalterados) e o novo.

Run também: `node --test test/*.test.js` (suíte inteira) — confirma que nada
fora deste arquivo depende do shape antigo de `montarAbaResumo`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/render-relatorio-semanal-xlsx.js test/semanal-render-relatorio-semanal-xlsx.test.js
git commit -m "$(cat <<'EOF'
Relatório semanal xlsx: título e rótulos estilizados na aba Resumo

Linha 1 vira faixa de título mesclada; rótulos da coluna A ficam em
negrito. Nenhuma linha muda de posição -- só estilo em cima do que já
existia.
EOF
)"
```

---

## Task 3: Aba Desvios — título, cabeçalho de tabela, zebra e formatação numérica

**Files:**
- Modify: `tools/semanal/render-relatorio-semanal-xlsx.js:14-119` (`celulaNumOuVazia`, `CABECALHO_DESVIOS`, `casasDaDimensaoRotulo`, `linhaDesvio`, `montarAbaDesvios`) e a chamada em `gerarRelatorioSemanalXlsx` (linha ~177)
- Test: `test/semanal-render-relatorio-semanal-xlsx.test.js`

**Interfaces:**
- Consumes: estilos `titulo`, `cabecalhoTabela`, `rotulo`, `texto`, `textoZebra`, `numeroMilhar(Zebra)`, `numeroDuasCasas(Zebra)` (Task 1).
- Produces:
  - `celulaNumOuVazia(v, estiloNumero)` — 2º parâmetro NOVO e opcional; célula vazia (`v` nulo/NaN/±Infinity) sempre sai **sem estilo** (decisão deliberada: evita qualquer risco de quebrar o teste de guard de NaN já existente, custo aceito é uma célula ocasional sem borda numa tabela com grade).
  - `montarAbaDesvios(desvios, subtitulo?)` — 2º parâmetro novo opcional (mês/ano para o título; sem ele, título sai sem o sufixo `· <mês/ano>` — usado pelos testes que chamam a função direto).
  - A aba ganha 1 linha no topo (título) — **todo o resto desce 1 linha**; `linhaInicioTipologia`/`linhaFimTipologia`/etc. continuam calculados dinamicamente a partir de `rows.length`, então nenhuma conta manual muda.

- [ ] **Step 1: Escrever os testes novos (falhando)**

Adicionar em `test/semanal-render-relatorio-semanal-xlsx.test.js`, depois do
teste `'a aba Desvios tem cabeçalho, seções Por tipologia/Por contrato...'`:

```js
test('a aba Desvios tem título mesclado, cabeçalho estilizado e zebra alternando nas linhas de dado', () => {
  const resultado = RenderRelatorioSemanalXlsx.gerarRelatorioSemanalXlsx(opcoesComDesvios());
  const sheetXml = extrairAba(resultado.bytes, 2); // Desvios

  assert.match(sheetXml, /<mergeCells count="1"><mergeCell ref="A1:L1"\/><\/mergeCells>/);
  assert.match(sheetXml, /<c r="A1" s="1" t="inlineStr"><is><t>Relatório Semanal — Planejamento · Desvios · Jul\/2026<\/t>/);
  // cabeçalho (linha 3: título=1, "Por tipologia"=2, cabeçalho=3) com estilo cabecalhoTabela (índice 2)
  assert.match(sheetXml, /<c r="A3" s="2" t="inlineStr"><is><t>SUP<\/t>/);
  // 1ª linha de dado (linha 4) sem zebra, 2ª linha de dado (linha 5) com zebra
  assert.match(sheetXml, /<row r="4"><c r="A4" s="4"/);
  assert.match(sheetXml, /<row r="5"><c r="A5" s="5"/);
});

test('a aba Desvios formata Previsto/Realizado-Tendência com separador de milhar quando a dimensão é Volume', () => {
  const desvios = {
    porTipologia: [],
    porContrato: [{
      sup: 'SUP-A', tomador: 'Tomador-A', tipologia: 'ST', contrato: 'SUP-A',
      janela: 'Semana anterior', dimensao: 'Volume',
      previsto: 12345, numerador: 6789, desvio: 0.55, status: 'Crítico', cor: '#D32020',
    }],
  };
  const sheets = [RenderRelatorioSemanalXlsx.montarAbaDesvios(desvios)];
  const bytes = buildXlsx(sheets);
  const sheetXml = extrairAba(bytes, 1);
  // s="7" = numeroMilhar (sem zebra, 1ª linha de dado)
  assert.match(sheetXml, /<c r="G4" s="7"><v>12345<\/v><\/c>/);
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `node --test test/semanal-render-relatorio-semanal-xlsx.test.js`
Expected: os 2 testes novos falham; os existentes continuam passando (ainda
não editamos a implementação).

- [ ] **Step 3: Implementar**

Em `tools/semanal/render-relatorio-semanal-xlsx.js`:

Substituir `celulaNumOuVazia` (linhas 14-16) por:

```js
function celulaNumOuVazia(v, estiloNumero) {
  return (v === null || v === undefined || !Number.isFinite(v)) ? str('') : num(v, estiloNumero);
}
```

Substituir `CABECALHO_DESVIOS` (linhas 69-72) por:

```js
var CABECALHO_DESVIOS = [
  str('SUP', 'cabecalhoTabela'), str('Tomador', 'cabecalhoTabela'), str('Tipologia', 'cabecalhoTabela'), str('Contrato', 'cabecalhoTabela'),
  str('Janela', 'cabecalhoTabela'), str('Dimensão', 'cabecalhoTabela'),
  str('Previsto', 'cabecalhoTabela'), str('Realizado/Tendência', 'cabecalhoTabela'), str('Desvio %', 'cabecalhoTabela'),
  str('Status', 'cabecalhoTabela'), str('Ação', 'cabecalhoTabela'), str('Responsável', 'cabecalhoTabela'),
];
```

Substituir `linhaDesvio` (linhas 86-93) por:

```js
function linhaDesvio(d, zebra) {
  var casas = casasDaDimensaoRotulo(d.dimensao);
  var estiloTexto = zebra ? 'textoZebra' : 'texto';
  var estiloNumero = casas === 2
    ? (zebra ? 'numeroDuasCasasZebra' : 'numeroDuasCasas')
    : (zebra ? 'numeroMilharZebra' : 'numeroMilhar');
  return [
    str(d.sup, estiloTexto), str(d.tomador, estiloTexto), str(d.tipologia, estiloTexto), str(d.contrato || '', estiloTexto),
    str(d.janela, estiloTexto), str(d.dimensao, estiloTexto),
    celulaNumOuVazia(arredondar(d.previsto, casas), estiloNumero), celulaNumOuVazia(arredondar(d.numerador, casas), estiloNumero),
    str(formatarDesvioTexto(d.desvio), estiloTexto), str(d.status, estiloTexto), str('', estiloTexto), str('', estiloTexto),
  ];
}
```

Substituir `montarAbaDesvios` (linhas 95-119) por:

```js
var COLS_DESVIOS = [12, 26, 16, 14, 28, 12, 12, 18, 10, 12, 22, 18];

function montarAbaDesvios(desvios, subtitulo) {
  var sufixo = subtitulo ? ' · ' + subtitulo : '';
  var rows = [
    [str('Relatório Semanal — Planejamento · Desvios' + sufixo, 'titulo')],
    [str('Por tipologia', 'rotulo')],
    CABECALHO_DESVIOS.slice(),
  ];
  var linhaInicioTipologia = rows.length + 1;
  desvios.porTipologia.forEach(function (d, i) { rows.push(linhaDesvio(d, i % 2 === 1)); });
  var linhaFimTipologia = rows.length;

  rows.push([str('')]);
  rows.push([str('Por contrato', 'rotulo')]);
  rows.push(CABECALHO_DESVIOS.slice());
  var linhaInicioContrato = rows.length + 1;
  desvios.porContrato.forEach(function (d, i) { rows.push(linhaDesvio(d, i % 2 === 1)); });
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
  return {
    name: 'Desvios', rows: rows, conditionalFormats: conditionalFormats,
    colWidths: COLS_DESVIOS, freezeRows: 3, rowHeights: { 1: 28, 3: 30 }, merges: ['A1:L1'],
  };
}
```

Em `gerarRelatorioSemanalXlsx` (por volta da linha 170-180), adicionar a
variável `subtitulo` logo depois de `var resumo = resumoDesvios(desvios);` e
passá-la para `montarAbaDesvios`:

```js
  var resumo = resumoDesvios(desvios);
  var subtitulo = NOMES_MES[ctx.mesIdx] + '/' + ctx.ano;
  var janelaAnterior = semanaAnterior(ctx.ano, ctx.mesIdx, ctx.semanas, ctx.indiceAtual);
  var janelaSeguinte = semanaSeguinte(ctx.ano, ctx.mesIdx, ctx.semanas, ctx.indiceAtual);

  var sheets = [
    montarAbaResumo(opcoes, resumo, janelaAnterior, janelaSeguinte),
    montarAbaDesvios(desvios, subtitulo),
    montarAbaDimensao('Volume', linhasVolume, 'volume', subtitulo),
    montarAbaDimensao('Equipes', linhasEquipes, 'equipes', subtitulo),
  ];
```

(A mudança nas duas chamadas de `montarAbaDimensao` é consumida pela Task 4
— deixar essas duas linhas já com o 4º argumento aqui não quebra nada, já
que a Task 4 vai dar a `montarAbaDimensao` um parâmetro `subtitulo` opcional
também.)

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/semanal-render-relatorio-semanal-xlsx.test.js`
Expected: todos os testes de Desvios passam (os 2 novos + os já existentes,
incluindo o teste de arredondamento e o de guard de NaN — nenhum dos dois é
afetado, porque a célula vazia continua sem estilo).

Run também: `node --test test/*.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/render-relatorio-semanal-xlsx.js test/semanal-render-relatorio-semanal-xlsx.test.js
git commit -m "$(cat <<'EOF'
Relatório semanal xlsx: título, cabeçalho e zebra na aba Desvios

Título mescladO no topo (empurra o resto 1 linha, cálculos de seção já
eram dinâmicos), cabeçalho das 12 colunas com fundo grafite, e zebra
alternando por linha de dado. Formatação numérica (milhar/2 casas) só
nas células com valor -- vazio/NaN continua sem estilo.
EOF
)"
```

---

## Task 4: Abas Volume/Equipes — título, cabeçalho, zebra, total e formatação numérica

**Files:**
- Modify: `tools/semanal/render-relatorio-semanal-xlsx.js:121-185` (`casasDaDimensao`, `CABECALHO_DIMENSAO`, `linhaDimensao`, `montarAbaDimensao`, e as 2 chamadas em `gerarRelatorioSemanalXlsx`)
- Test: `test/semanal-render-relatorio-semanal-xlsx.test.js`

**Interfaces:**
- Consumes: estilos de Task 1 + `subtitulo` (Task 3, já fica disponível em `gerarRelatorioSemanalXlsx`).
- Produces: `montarAbaDimensao(nomeAba, linhas, dimensao, subtitulo?)` — 4º parâmetro novo opcional, mesma regra do `subtitulo` de `montarAbaDesvios`. A aba ganha 1 linha de título no topo — deslocamento de +1 em toda a tabela.

- [ ] **Step 1: Escrever os testes novos (falhando) e atualizar a contagem de linhas**

Em `test/semanal-render-relatorio-semanal-xlsx.test.js`, no teste `'a aba
Volume tem o cabeçalho das 3 janelas...'` (linha ~95-105), trocar o
comentário e o número esperado:

```js
test('a aba Volume tem o cabeçalho das 3 janelas e uma linha por registro/tipologia/total', () => {
  const registros = [registro({ sup: 'SUP-A', volume: 10 }), registro({ sup: 'SUP-B', tipologia: 'SP', volume: 20 })];
  const resultado = RenderRelatorioSemanalXlsx.gerarRelatorioSemanalXlsx(opcoesBase(registros, [0, 1]));
  const sheetXml = extrairAba(resultado.bytes, 3); // Resumo=1, Desvios=2, Volume=3
  assert.match(sheetXml, /Semana anterior — Previsto/);
  assert.match(sheetXml, /Acumulado do mês — Realizado/);
  assert.match(sheetXml, /Semana que vem — Tendência/);
  // 1 título + 1 cabeçalho + TOTAL GERAL + 2 tipologias + (registro+TOTAL SUP) x2 = 9 linhas
  const linhas = [...sheetXml.matchAll(/<row r="\d+">/g)];
  assert.strictEqual(linhas.length, 9);
});
```

Adicionar, logo depois desse teste, mais dois:

```js
test('a aba Volume tem título mesclado e cabeçalho estilizado', () => {
  const registros = [registro({ sup: 'SUP-A', volume: 10 })];
  const resultado = RenderRelatorioSemanalXlsx.gerarRelatorioSemanalXlsx(opcoesBase(registros, [0]));
  const sheetXml = extrairAba(resultado.bytes, 3); // Volume
  assert.match(sheetXml, /<mergeCells count="1"><mergeCell ref="A1:L1"\/><\/mergeCells>/);
  assert.match(sheetXml, /<c r="A1" s="1" t="inlineStr"><is><t>Relatório Semanal — Planejamento · Volume · Jul\/2026<\/t>/);
  assert.match(sheetXml, /<c r="A2" s="2" t="inlineStr"><is><t>SUP<\/t>/);
});

test('a aba Volume estiliza a linha TOTAL GERAL diferente de uma linha de registro', () => {
  const registros = [registro({ sup: 'SUP-A', volume: 10 })];
  const resultado = RenderRelatorioSemanalXlsx.gerarRelatorioSemanalXlsx(opcoesBase(registros, [0]));
  const sheetXml = extrairAba(resultado.bytes, 3); // Volume
  // linha 3 = TOTAL GERAL (título=1, cabeçalho=2, TOTAL GERAL=3) -- estilo textoTotal (s="6")
  assert.match(sheetXml, /<row r="3"><c r="A3" s="6"><is><t>—<\/t><\/is><\/c>/);
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `node --test test/semanal-render-relatorio-semanal-xlsx.test.js`
Expected: os 3 testes (o atualizado de contagem + os 2 novos) falham. O
teste de contagem falha porque ainda espera 8 no código antigo — depois de
editado ele já espera 9 e falha porque a implementação ainda não gera o
título.

- [ ] **Step 3: Implementar**

Em `tools/semanal/render-relatorio-semanal-xlsx.js`, substituir
`CABECALHO_DIMENSAO` (linhas 131-136) por:

```js
var CABECALHO_DIMENSAO = [
  str('SUP', 'cabecalhoTabela'), str('Tomador', 'cabecalhoTabela'), str('Tipologia', 'cabecalhoTabela'), str('Contrato', 'cabecalhoTabela'),
  str('Semana anterior — Previsto', 'cabecalhoTabela'), str('Semana anterior — Realizado', 'cabecalhoTabela'), str('Semana anterior — Tendência', 'cabecalhoTabela'),
  str('Acumulado do mês — Previsto', 'cabecalhoTabela'), str('Acumulado do mês — Realizado', 'cabecalhoTabela'), str('Acumulado do mês — Tendência', 'cabecalhoTabela'),
  str('Semana que vem — Previsto', 'cabecalhoTabela'), str('Semana que vem — Tendência', 'cabecalhoTabela'),
];
```

Substituir `linhaDimensao` (linhas 138-152) por:

```js
function linhaDimensao(linha, dimensao, total, zebra) {
  var casas = casasDaDimensao(dimensao);
  var j = linha.janelas;
  var estiloTexto = total ? 'textoTotal' : (zebra ? 'textoZebra' : 'texto');
  var estiloNumero = casas === 2
    ? (total ? 'numeroDuasCasasTotal' : (zebra ? 'numeroDuasCasasZebra' : 'numeroDuasCasas'))
    : (total ? 'numeroMilharTotal' : (zebra ? 'numeroMilharZebra' : 'numeroMilhar'));
  return [
    str(linha.sup, estiloTexto), str(linha.tomador, estiloTexto), str(linha.tipologia, estiloTexto), str(linha.contrato || '', estiloTexto),
    celulaNumOuVazia(arredondar(j.semanaAnterior.previsto, casas), estiloNumero),
    celulaNumOuVazia(arredondar(j.semanaAnterior.realizado, casas), estiloNumero),
    celulaNumOuVazia(arredondar(j.semanaAnterior.tendencia, casas), estiloNumero),
    celulaNumOuVazia(arredondar(j.acumulado.previsto, casas), estiloNumero),
    celulaNumOuVazia(arredondar(j.acumulado.realizado, casas), estiloNumero),
    celulaNumOuVazia(arredondar(j.acumulado.tendencia, casas), estiloNumero),
    celulaNumOuVazia(arredondar(j.semanaQueVem.previsto, casas), estiloNumero),
    celulaNumOuVazia(arredondar(j.semanaQueVem.tendencia, casas), estiloNumero),
  ];
}
```

Substituir `montarAbaDimensao` (linhas 154-158) por:

```js
var COLS_DIMENSAO = [12, 26, 16, 14, 15, 15, 15, 15, 15, 15, 15, 15];

function montarAbaDimensao(nomeAba, linhas, dimensao, subtitulo) {
  var sufixo = subtitulo ? ' · ' + subtitulo : '';
  var rows = [
    [str('Relatório Semanal — Planejamento · ' + nomeAba + sufixo, 'titulo')],
    CABECALHO_DIMENSAO.slice(),
  ];
  var indiceZebra = 0;
  linhas.forEach(function (linha) {
    var total = linha.tipo !== 'registro';
    var zebra = false;
    if (!total) { zebra = indiceZebra % 2 === 1; indiceZebra++; }
    rows.push(linhaDimensao(linha, dimensao, total, zebra));
  });
  return {
    name: nomeAba, rows: rows,
    colWidths: COLS_DIMENSAO, freezeRows: 2, rowHeights: { 1: 28, 2: 30 }, merges: ['A1:L1'],
  };
}
```

Em `gerarRelatorioSemanalXlsx`, as duas chamadas de `montarAbaDimensao` já
foram atualizadas na Task 3 para passar `subtitulo` — confirmar que ficaram:

```js
  var sheets = [
    montarAbaResumo(opcoes, resumo, janelaAnterior, janelaSeguinte),
    montarAbaDesvios(desvios, subtitulo),
    montarAbaDimensao('Volume', linhasVolume, 'volume', subtitulo),
    montarAbaDimensao('Equipes', linhasEquipes, 'equipes', subtitulo),
  ];
```

Se a Task 3 não tiver deixado assim por algum motivo, ajustar agora.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/semanal-render-relatorio-semanal-xlsx.test.js`
Expected: todos os testes passam, incluindo o de Equipes com 2 casas
decimais (linha ~221-236, que só checa presença de `<v>2.67</v>` em
qualquer lugar da aba — não é afetado pelo deslocamento nem pelo `s` novo).

Run também: `node --test test/*.test.js`
Expected: PASS — suíte inteira, nenhuma regressão fora deste arquivo.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/render-relatorio-semanal-xlsx.js test/semanal-render-relatorio-semanal-xlsx.test.js
git commit -m "$(cat <<'EOF'
Relatório semanal xlsx: título, cabeçalho, zebra e total nas abas
Volume/Equipes

Mesmo tratamento visual de Desvios: título mesclado, cabeçalho grafite,
zebra nas linhas de registro, destaque de negrito+fundo nas linhas
TOTAL GERAL/TOTAL SUP, formatação numérica (milhar em Volume, 2 casas
em Equipes) e painel congelado no cabeçalho.
EOF
)"
```

---

## Task 5: Verificação final, build e publicação

**Files:**
- Nenhum arquivo de código novo — só build/verificação/publish.

**Interfaces:**
- Consumes: tudo das Tasks 1-4.
- Produces: `dist/planejamento-semanal.html` reconstruído, `docs/planejamento-semanal.html` sincronizado, um `.xlsx` de amostra verificado, tudo commitado e publicado.

- [ ] **Step 1: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS, zero falhas.

- [ ] **Step 2: Gerar um `.xlsx` de amostra e inspecionar a estrutura**

Criar um script temporário (fora do repositório, ex.
`/tmp/gerar-amostra.js` ou o scratchpad da sessão) que chama
`RenderRelatorioSemanalXlsx.gerarRelatorioSemanalXlsx` com uma fixture
pequena (pode reusar `registro`/`opcoesBase` do teste, copiados inline) e
grava o resultado em `amostra-relatorio-semanal.xlsx`. Rodar `unzip -l` no
arquivo gerado e confirmar que `xl/styles.xml` tem 13 `cellXfs` e cada
`xl/worksheets/sheetN.xml` tem `<sheetViews>`/`<cols>`/`<mergeCells>` onde
esperado. Abrir o arquivo (se houver Excel/LibreOffice disponível na
máquina) para conferir visualmente: título com faixa escura, cabeçalho
branco sobre grafite, zebra, congelamento ao rolar. Apagar o arquivo de
amostra depois (é só verificação, não faz parte do repositório).

- [ ] **Step 3: Reconstruir a página semanal**

Run: `ORCAMENTO_SENHA='sptinfra@2026' node tools/semanal/build-dashboard.js`
Expected: build conclui sem erro, escreve `dist/planejamento-semanal.html`
(e os demais artefatos de `dist/` de sempre).

- [ ] **Step 4: Sincronizar docs/ e conferir o teste de sincronia**

```bash
cp dist/planejamento-semanal.html docs/planejamento-semanal.html
node --test test/publicacao-docs-sincronizado.test.js
```
Expected: PASS.

- [ ] **Step 5: Commit e publish**

```bash
git add docs/planejamento-semanal.html dist/planejamento-semanal.html
git commit -m "$(cat <<'EOF'
Rebuild: layout visual do Relatório Semanal em Excel

Reconstrução da página semanal com o gerador de .xlsx estilizado
(Tasks 1-4 deste plano).
EOF
)"
git push origin HEAD:master
```

Expected: push aceito, `git log origin/master -1` mostra este commit no
topo.

- [ ] **Step 6: Confirmar no site publicado**

Run: `curl -s https://amcaccere261283.github.io/planejamento-semanal.html` (ou a URL correta da página, conferir em `orcamento-dashboard/CLAUDE.md`) e comparar
timestamp/conteúdo com o build local — mesma verificação que o `CLAUDE.md`
do projeto exige depois de todo deploy (não confiar só no status do Pages).

---

## Self-Review

**1. Cobertura do spec:** motor de estilo (Task 1) ✓; paleta grafite/âmbar
aplicada via cellXfs (Task 1) ✓; título mesclado nas 4 abas (Tasks 2-4) ✓;
cabeçalho de tabela estilizado (Tasks 3-4) ✓; zebra (Tasks 3-4) ✓; total
row com destaque (Task 4) ✓; formatação numérica milhar/2 casas (Tasks 3-4)
✓; larguras de coluna (Tasks 2-4) ✓; congelamento de painel (Tasks 3-4) ✓;
escopo restrito ao motor client-side, sem tocar `tools/lib/xlsx-writer.js`
✓; rebuild+publish (Task 5) ✓.

**2. Placeholder scan:** nenhum "TBD"/"implementar depois" — todo passo tem
código completo.

**3. Consistência de tipos:** `ESTILO_INDICE` (Task 1) e os nomes usados em
`str(..., 'nome')` nas Tasks 2-4 conferidos um a um contra a lista de 12
nomes; `celulaNumOuVazia(v, estiloNumero)` tem a mesma assinatura nas Tasks
3 e 4; `montarAbaDesvios(desvios, subtitulo)` e
`montarAbaDimensao(nomeAba, linhas, dimensao, subtitulo)` — `subtitulo`
sempre o último parâmetro, sempre opcional, mesma regra de sufixo
(`' · ' + subtitulo` só quando truthy) nas duas funções.
