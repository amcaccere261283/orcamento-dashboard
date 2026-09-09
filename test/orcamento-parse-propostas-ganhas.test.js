// test/orcamento-parse-propostas-ganhas.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildMinimalZip } = require('./helpers/build-zip.js');
const {
  montarPropostasGanhas, extrairPropostasGanhas, acharAbaPropostas, resolverColunas,
  parseTexto, extrairSupBase,
} = require('../tools/orcamento/parse-propostas-ganhas.js');

function celulaNum(ref, valor) { return `<c r="${ref}"><v>${valor}</v></c>`; }
function celulaStr(sharedIndex, ref) { return `<c r="${ref}" t="s"><v>${sharedIndex}</v></c>`; }

// Monta um workbook sintético (uma ou mais abas) com a mesma forma do Radar
// de Demandas real: linha 1 = cabeçalho (sup, status, contratante,
// clienteFinal, objeto, nesta ordem -- mas locateColumns nunca deve
// depender disso), linhas seguintes = dados.
//
// `abas` é [{ nome, cabecalho: string[], linhas: (string|number)[][] }, ...]
// -- cada linha é indexada pela MESMA ordem de `cabecalho`.
function construirWorkbookPropostas(abas) {
  const sharedStrings = [];
  const idx = (valor) => {
    if (typeof valor === 'number') return null; // números não usam shared strings
    let i = sharedStrings.indexOf(valor);
    if (i === -1) { sharedStrings.push(valor); i = sharedStrings.length - 1; }
    return i;
  };
  const colLetra = (col) => {
    let n = col + 1;
    let s = '';
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
  };
  const celula = (valor, ref) => {
    if (typeof valor === 'number') return celulaNum(ref, valor);
    return celulaStr(idx(valor), ref);
  };

  const sheetEntries = [];
  const sheetTags = [];
  const relEntries = [];
  abas.forEach((aba, i) => {
    const rowNum = 1;
    let headerCells = '';
    aba.cabecalho.forEach((h, col) => { headerCells += celula(h, `${colLetra(col)}${rowNum}`); });
    let rows = `<row r="${rowNum}">${headerCells}</row>`;
    (aba.linhas || []).forEach((linha, r) => {
      const rn = r + 2;
      let cells = '';
      linha.forEach((v, col) => {
        if (v === null || v === undefined || v === '') return;
        cells += celula(v, `${colLetra(col)}${rn}`);
      });
      rows += `<row r="${rn}">${cells}</row>`;
    });
    const sheetXml = `<worksheet><sheetData>${rows}</sheetData></worksheet>`;
    const sheetPath = `xl/worksheets/sheet${i + 1}.xml`;
    sheetEntries.push({ name: sheetPath, data: Buffer.from(sheetXml, 'utf8'), method: 8 });
    sheetTags.push(`<sheet name="${aba.nome}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`);
    relEntries.push(`<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`);
  });

  const workbookXml = `<?xml version="1.0"?><workbook xmlns:r="rels"><sheets>${sheetTags.join('')}</sheets></workbook>`;
  const relsXml = `<?xml version="1.0"?><Relationships>${relEntries.join('')}</Relationships>`;
  const sharedStringsXml = '<sst>' + sharedStrings.map(s => `<si><t>${String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</t></si>`).join('') + '</sst>';

  return buildMinimalZip([
    { name: 'xl/workbook.xml', data: Buffer.from(workbookXml, 'utf8'), method: 0 },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(relsXml, 'utf8'), method: 0 },
    { name: 'xl/sharedStrings.xml', data: Buffer.from(sharedStringsXml, 'utf8'), method: 0 },
    ...sheetEntries,
  ]);
}

const CABECALHO_PADRAO = ['sup', 'status', 'contratante', 'clienteFinal', 'objeto'];

test('parseTexto: delimitador "/" com 7 tipologias -- todas devem sair, não só a primeira', () => {
  const texto = 'SPT: 100 und / SM: 100 und / ST: 100 und / PI: 100 und / CPTu: 30 und / VT: 30 und / Shelby: 100 und';
  const { valores, naoMapeados } = parseTexto(texto);
  assert.deepEqual(valores, { SP: 100, SM: 100, ST: 100, PI: 100, CPTU: 30, VT: 30, SH: 100 });
  assert.deepEqual(naoMapeados, []);
});

test('parseTexto: delimitador "|" e casing misto', () => {
  const texto = 'spt: 50 und | Denison: 20 und | pi 10';
  const { valores } = parseTexto(texto);
  assert.deepEqual(valores, { SP: 50, DN: 20, PI: 10 });
});

test('parseTexto: vírgula solta em prosa não vira número falso', () => {
  const texto = 'ST, SPT, SM, PI e Ensaios de Laboratório';
  const { valores } = parseTexto(texto);
  assert.deepEqual(valores, {}, 'nenhum segmento bate "<fase> <número>" -- a prosa não deve produzir quantidade nenhuma');
});

test('parseTexto: tipologia desconhecida no texto livre vai para naoMapeados, não é descartada em silêncio', () => {
  const texto = 'SPT: 100 und / Flutuante: 5 und';
  const { valores, naoMapeados } = parseTexto(texto);
  assert.deepEqual(valores, { SP: 100 });
  assert.equal(naoMapeados.length, 1);
  assert.equal(naoMapeados[0][0], 'FLUTUANTE');
});

test('parseTexto: "LAB" é ignorado (fonte própria, fora deste funil)', () => {
  const { valores, naoMapeados } = parseTexto('SPT: 10 und / LAB: 5 und');
  assert.deepEqual(valores, { SP: 10 });
  assert.deepEqual(naoMapeados, []);
});

test('extrairSupBase: extrai "dddd-dd" tanto de "SUP-8224-25" quanto de "8224-25" ou "SUP-8224-25 (AB)"', () => {
  assert.equal(extrairSupBase('SUP-8224-25'), '8224-25');
  assert.equal(extrairSupBase('8224-25'), '8224-25');
  assert.equal(extrairSupBase('SUP-8224-25 (AB)'), '8224-25');
  assert.equal(extrairSupBase('sem padrão nenhum'), null);
});

test('acharAbaPropostas: acha por PREFIXO case-insensitive, inclusive uma aba datada diferente', () => {
  const buffer = construirWorkbookPropostas([{ nome: 'propostas-2026-09-08 (1)', cabecalho: CABECALHO_PADRAO, linhas: [] }]);
  assert.equal(acharAbaPropostas(buffer), 'propostas-2026-09-08 (1)');

  const buffer2 = construirWorkbookPropostas([{ nome: 'Propostas-2027-01-15', cabecalho: CABECALHO_PADRAO, linhas: [] }]);
  assert.equal(acharAbaPropostas(buffer2), 'Propostas-2027-01-15');
});

test('acharAbaPropostas: zero abas batendo o prefixo falha alto', () => {
  const buffer = construirWorkbookPropostas([{ nome: 'outra-aba-qualquer', cabecalho: CABECALHO_PADRAO, linhas: [] }]);
  assert.throws(() => acharAbaPropostas(buffer), /esperava exatamente 1 aba/i);
});

test('acharAbaPropostas: 2+ abas batendo o prefixo falha alto', () => {
  const buffer = construirWorkbookPropostas([
    { nome: 'propostas-2026-09-08 (1)', cabecalho: CABECALHO_PADRAO, linhas: [] },
    { nome: 'propostas-2026-08-01', cabecalho: CABECALHO_PADRAO, linhas: [] },
  ]);
  assert.throws(() => acharAbaPropostas(buffer), /esperava exatamente 1 aba/i);
});

test('resolverColunas: coluna obrigatória faltando falha alto nomeando ela', () => {
  assert.throws(
    () => resolverColunas(['sup', 'status', 'contratante', 'objeto']), // falta clienteFinal
    /clienteFinal/,
  );
});

test('extrairPropostasGanhas: filtra status !== GANHA', () => {
  const grid = [];
  grid[1] = CABECALHO_PADRAO;
  grid[2] = ['SUP-1111-26', 'PERDIDA', 'Cliente A', 'Cliente Final A', 'SPT: 100 und'];
  grid[3] = ['SUP-2222-26', 'EM ANDAMENTO', 'Cliente B', 'Cliente Final B', 'SPT: 100 und'];
  const resultado = extrairPropostasGanhas(grid, {});
  assert.deepEqual(resultado, []);
});

test('extrairPropostasGanhas: objeto vazio/sem número reconhecível cai pra nota manual da mesma linha do SUP base, inclusive quando a nota está espalhada em várias células', () => {
  const grid = [];
  grid[1] = CABECALHO_PADRAO;
  grid[2] = ['SUP-3333-26', 'GANHA', 'Cliente C', 'Cliente Final C', ''];
  // Nota manual "solta" em outra linha do sheet, espalhada em 2 células
  // (vírgula perdida no texto original colado, quebrando a célula bem no
  // meio do delimitador "|") -- junta com "," (restaurando
  // "...SPT: 40 und,| PI: 20 und") e casa contra o SUP base "3333-26".
  grid[10] = ['3333-26 - SPT: 40 und', '| PI: 20 und'];
  const resultado = extrairPropostasGanhas(grid, {});
  const porTipologia = Object.fromEntries(resultado.map(r => [r.tipologia, r.quantidade]));
  assert.deepEqual(porTipologia, { SP: 40, PI: 20 });
  assert.ok(resultado.every(r => r.origem === 'nota manual'));
  assert.ok(resultado.every(r => r.sup === '3333-26'));
});

test('extrairPropostasGanhas: dedup contra registros da MATRIZ (mesma base SUP já formalizada)', () => {
  const grid = [];
  grid[1] = CABECALHO_PADRAO;
  grid[2] = ['SUP-4444-26', 'GANHA', 'Cliente D', 'Cliente Final D', 'SPT: 10 und'];
  const registros = [{ sup: 'SUP-4444-26 (AB)', tipologia: 'SP' }];
  const resultado = extrairPropostasGanhas(grid, { registros });
  assert.deepEqual(resultado, [], 'SUP já tem registro na MATRIZ -- não deve aparecer nas propostas GANHAS');
});

test('extrairPropostasGanhas: dedup contra chaves já presentes em liberadoSond', () => {
  const grid = [];
  grid[1] = CABECALHO_PADRAO;
  grid[2] = ['SUP-5555-26', 'GANHA', 'Cliente E', 'Cliente Final E', 'SPT: 10 und'];
  const liberadoSond = { 'SUP-5555-26 (AB)||SP': { prevista: 10, executada: 0, saldo: 10 } };
  const resultado = extrairPropostasGanhas(grid, { liberadoSond });
  assert.deepEqual(resultado, [], 'SUP já liberado na SOND nesta rodada -- não deve aparecer nas propostas GANHAS');
});

test('extrairPropostasGanhas: SUP sem match em registros nem liberadoSond continua na lista', () => {
  const grid = [];
  grid[1] = CABECALHO_PADRAO;
  grid[2] = ['SUP-6666-26', 'GANHA', 'Cliente F', 'Cliente Final F', 'SPT: 10 und'];
  const registros = [{ sup: 'SUP-9999-26', tipologia: 'SP' }];
  const liberadoSond = { 'SUP-8888-26||SP': { prevista: 1, executada: 0, saldo: 1 } };
  const resultado = extrairPropostasGanhas(grid, { registros, liberadoSond });
  assert.equal(resultado.length, 1);
  assert.equal(resultado[0].sup, '6666-26');
  assert.equal(resultado[0].tipologia, 'SP');
  assert.equal(resultado[0].quantidade, 10);
  assert.equal(resultado[0].cliente, 'Cliente F');
  assert.equal(resultado[0].clienteFinal, 'Cliente Final F');
  assert.equal(resultado[0].origem, 'objeto');
});

test('montarPropostasGanhas: ponta a ponta -- lê o workbook, acha a aba por prefixo, filtra GANHA e dedupa', () => {
  const buffer = construirWorkbookPropostas([{
    nome: 'propostas-2026-09-08 (1)',
    cabecalho: CABECALHO_PADRAO,
    linhas: [
      ['SUP-7777-26', 'GANHA', 'Cliente G', 'Cliente Final G', 'SPT: 100 und / SM: 100 und / ST: 100 und / PI: 100 und / CPTu: 30 und / VT: 30 und / Shelby: 100 und'],
      ['SUP-8888-26', 'PERDIDA', 'Cliente H', 'Cliente Final H', 'SPT: 100 und'],
      ['SUP-9999-26', 'GANHA', 'Cliente I', 'Cliente Final I', 'SPT: 10 und'],
    ],
  }]);
  const radarPath = path.join(os.tmpdir(), `radar-demandas-e2e-${Date.now()}.xlsx`);
  fs.writeFileSync(radarPath, buffer);
  try {
    const registros = [{ sup: 'SUP-9999-26 (AB)', tipologia: 'SP' }]; // já formalizado -- deve sumir
    const resultado = montarPropostasGanhas({ registros, liberadoSond: {}, caminhoRadarDemandas: radarPath });
    const sups = new Set(resultado.map(r => r.sup));
    assert.ok(sups.has('7777-26'));
    assert.ok(!sups.has('9999-26'), 'já formalizado na MATRIZ -- deve ter sido dedupado');
    assert.ok(!sups.has('8888-26'), 'status PERDIDA -- nunca deveria ter entrado');
    const tipologias7777 = resultado.filter(r => r.sup === '7777-26').map(r => r.tipologia).sort();
    assert.deepEqual(tipologias7777, ['CPTU', 'PI', 'SH', 'SM', 'SP', 'ST', 'VT']);
  } finally {
    fs.unlinkSync(radarPath);
  }
});
