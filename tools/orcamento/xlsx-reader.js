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
