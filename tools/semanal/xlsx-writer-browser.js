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
