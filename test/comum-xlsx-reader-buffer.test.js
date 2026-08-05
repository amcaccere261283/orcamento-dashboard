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
    activeSheetRows: '<row r="0"><c r="A0" t="s"><v>0</v></c><c r="B0" t="str"><v>SUP-0001-24</v></c></row>',
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
