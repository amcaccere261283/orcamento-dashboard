'use strict';
const fs = require('node:fs');
const { listZipEntries, readZipEntry } = require('./zip-reader.js');
const { parseSharedStrings, parseSheetGrid } = require('./xlsx-cells.js');

function decodeXmlEntities(text) {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function extrairAtributo(tagXml, nomeAtributo) {
  const match = new RegExp(`\\b${nomeAtributo}="([^"]*)"`).exec(tagXml);
  return match ? match[1] : null;
}

function parseWorkbookSheets(workbookXml) {
  const sheets = [];
  const tagRe = /<sheet\b[^>]*\/>/g;
  let tagMatch;
  while ((tagMatch = tagRe.exec(workbookXml))) {
    const tag = tagMatch[0];
    const name = extrairAtributo(tag, 'name');
    const rId = extrairAtributo(tag, 'r:id');
    if (name !== null && rId !== null) {
      sheets.push({ name: decodeXmlEntities(name), rId });
    }
  }
  return sheets;
}

function parseWorkbookRels(relsXml) {
  const targets = new Map();
  const tagRe = /<Relationship\b[^>]*\/>/g;
  let tagMatch;
  while ((tagMatch = tagRe.exec(relsXml))) {
    const tag = tagMatch[0];
    const id = extrairAtributo(tag, 'Id');
    const target = extrairAtributo(tag, 'Target');
    if (id !== null && target !== null) {
      targets.set(id, target);
    }
  }
  return targets;
}

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
// versão buffer não tem caminho pra incluir). Erros de leitura de arquivo
// propagam sem wrapping (Node já inclui o caminho no ENOENT).
function readXlsxSheet(filePath, sheetName) {
  const buffer = fs.readFileSync(filePath);
  try {
    return readXlsxSheetFromBuffer(buffer, sheetName);
  } catch (err) {
    throw new Error(`${filePath}: ${err.message}`);
  }
}

module.exports = { readXlsxSheet, readXlsxSheetFromBuffer, parseWorkbookSheets, parseWorkbookRels };
