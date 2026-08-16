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

test('um nome de estilo desconhecido falha alto, em vez de emitir s="undefined" e corromper o .xlsx', () => {
  const sheets = [{ name: 'S', rows: [[str('X', 'estilo-que-nao-existe')]] }];
  assert.throws(() => buildXlsx(sheets), /Estilo desconhecido: estilo-que-nao-existe/);
});

test('sem colWidths/merges/freezeRows/rowHeights, a saída não ganha nenhuma das tags novas', () => {
  const sheets = [{ name: 'S', rows: [[str('A')]] }];
  const outDir = buildAndExtract(sheets);
  const sheetXml = fs.readFileSync(path.join(outDir, 'xl', 'worksheets', 'sheet1.xml'), 'utf8');
  assert.ok(!sheetXml.includes('<cols>'));
  assert.ok(!sheetXml.includes('<mergeCells'));
  assert.ok(!sheetXml.includes('<sheetViews'));
});
