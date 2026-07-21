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
