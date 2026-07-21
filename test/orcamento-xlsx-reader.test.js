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
