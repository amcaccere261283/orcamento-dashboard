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
