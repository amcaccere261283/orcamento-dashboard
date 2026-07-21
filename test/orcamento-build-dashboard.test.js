// test/orcamento-build-dashboard.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildMinimalZip } = require('./helpers/build-zip.js');

function celulaNum(ref, valor) { return `<c r="${ref}"><v>${valor}</v></c>`; }
function celulaStr(sharedIndex, ref) { return `<c r="${ref}" t="s"><v>${sharedIndex}</v></c>`; }

// Monta uma aba MATRIZ sintética mas estruturalmente real: cabeçalho (linha
// 1), um bloco "Todos" pra confirmar que é ignorado, 1 contrato real com 2
// tipologias, e um par MENSAL/ACUMULADO no fim do contrato pra confirmar
// que também é ignorado.
function construirPlanilhaTeste() {
  const sharedStrings = ['ORIGEM', 'GRUPO', 'TOMADOR', 'SUP', 'ESCOPO', 'APOIO', 'INICIO', 'TERMINO', 'SONDAGEM',
    'Demanda à cadastrar', 'Demanda Cadastrada', 'BASE', 'PICO', 'MÉDIA', 'PROD.', 'DIAS', 'TOTAL', 'TOTAL INICIAL', 'TICKET', 'OBSERVAÇÃO',
    'Todos', 'P', 'R', 'T', 'SP', 'CONTRATO VIGENTE', 'PÁTRIA', 'Via Araucária S.A', 'SM', 'MENSAL', 'ACUMULADO'];
  const idx = name => sharedStrings.indexOf(name);

  function linhaHeaderXml() {
    let cells = celulaStr(idx('ORIGEM'), 'B1') + celulaStr(idx('GRUPO'), 'C1') + celulaStr(idx('TOMADOR'), 'D1') +
      celulaStr(idx('SUP'), 'E1') + celulaStr(idx('ESCOPO'), 'F1') + celulaStr(idx('APOIO'), 'G1') +
      celulaStr(idx('INICIO'), 'H1') + celulaStr(idx('TERMINO'), 'I1') + celulaStr(idx('SONDAGEM'), 'J1') +
      celulaStr(idx('Demanda à cadastrar'), 'K1') + celulaStr(idx('Demanda Cadastrada'), 'L1') + celulaStr(idx('BASE'), 'M1');
    const letras = ['N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y'];
    letras.forEach((l, i) => { cells += celulaNum(`${l}1`, 46023 + i * 30); });
    cells += celulaStr(idx('PICO'), 'Z1') + celulaStr(idx('MÉDIA'), 'AA1') + celulaStr(idx('PROD.'), 'AB1') + celulaStr(idx('DIAS'), 'AC1');
    const letras2 = ['AD', 'AE', 'AF', 'AG', 'AH', 'AI', 'AJ', 'AK', 'AL', 'AM', 'AN', 'AO'];
    letras2.forEach((l, i) => { cells += celulaNum(`${l}1`, 46023 + i * 30); });
    cells += celulaStr(idx('TOTAL'), 'AP1') + celulaStr(idx('TOTAL INICIAL'), 'AQ1') + celulaStr(idx('TICKET'), 'AR1');
    const letras3 = ['AS', 'AT', 'AU', 'AV', 'AW', 'AX', 'AY', 'AZ', 'BA', 'BB', 'BC', 'BD'];
    letras3.forEach((l, i) => { cells += celulaNum(`${l}1`, 46023 + i * 30); });
    cells += celulaStr(idx('TOTAL'), 'BE1') + celulaStr(idx('TOTAL INICIAL'), 'BF1') + celulaStr(idx('OBSERVAÇÃO'), 'BG1');
    return `<row r="1">${cells}</row>`;
  }

  // Uma linha "vazia" só com BASE e os 3 meses/resumos zerados -- usada pras
  // linhas R/T de cada tripla e pro bloco Todos (não precisamos de valores
  // reais nelas pra este teste, só confirmar inclusão/exclusão).
  function linhaMinima(rowNum, baseIdx, tipologiaIdx, grupoIdx) {
    let cells = celulaStr(baseIdx, `M${rowNum}`);
    if (tipologiaIdx !== undefined) cells += celulaStr(tipologiaIdx, `J${rowNum}`);
    if (grupoIdx !== undefined) cells += celulaStr(grupoIdx, `C${rowNum}`);
    return `<row r="${rowNum}">${cells}</row>`;
  }

  let rows = linhaHeaderXml();
  let r = 2;
  // Bloco "Todos" (deve ser ignorado).
  rows += linhaMinima(r++, idx('P'), idx('SP'), idx('Todos'));
  rows += linhaMinima(r++, idx('R'));
  rows += linhaMinima(r++, idx('T'));
  // Contrato real PÁTRIA, tipologia SP.
  rows += linhaMinima(r++, idx('P'), idx('SP'), idx('PÁTRIA'));
  rows += linhaMinima(r++, idx('R'));
  rows += linhaMinima(r++, idx('T'));
  // Contrato real PÁTRIA, tipologia SM.
  rows += linhaMinima(r++, idx('P'), idx('SM'));
  rows += linhaMinima(r++, idx('R'));
  rows += linhaMinima(r++, idx('T'));
  // Trailer MENSAL/ACUMULADO do contrato PÁTRIA (deve ser ignorado).
  rows += linhaMinima(r++, idx('P'), idx('MENSAL'));
  rows += linhaMinima(r++, idx('R'));
  rows += linhaMinima(r++, idx('T'));
  rows += linhaMinima(r++, idx('P'), idx('ACUMULADO'));
  rows += linhaMinima(r++, idx('R'));
  rows += linhaMinima(r++, idx('T'));

  const sheetXml = `<worksheet><sheetData>${rows}</sheetData></worksheet>`;
  const workbookXml = '<?xml version="1.0"?><workbook xmlns:r="rels"><sheets><sheet name="MATRIZ" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const relsXml = '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>';
  const sharedStringsXml = '<sst>' + sharedStrings.map(s => `<si><t>${s}</t></si>`).join('') + '</sst>';

  return buildMinimalZip([
    { name: 'xl/workbook.xml', data: Buffer.from(workbookXml, 'utf8'), method: 0 },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(relsXml, 'utf8'), method: 0 },
    { name: 'xl/sharedStrings.xml', data: Buffer.from(sharedStringsXml, 'utf8'), method: 0 },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml, 'utf8'), method: 8 },
  ]);
}

test('build() reads a synthetic MATRIZ, skips the aggregate/trailer rows, and writes a dashboard HTML with only the 2 real tipologia rows', () => {
  const xlsxPath = path.join(os.tmpdir(), `orcamento-e2e-${Date.now()}.xlsx`);
  fs.writeFileSync(xlsxPath, construirPlanilhaTeste());
  const outPath = path.join(os.tmpdir(), `orcamento-dashboard-e2e-${Date.now()}.html`);

  // Troca a config real por uma apontando pra planilha sintética -- o
  // require cache garante que build-dashboard.js enxergue essa troca antes
  // de carregá-lo pela primeira vez neste processo de teste.
  const configPath = require.resolve('../tools/orcamento/config.js');
  delete require.cache[configPath];
  require.cache[configPath] = {
    id: configPath, filename: configPath, loaded: true,
    exports: { caminhoArquivo: xlsxPath, nomeAba: 'MATRIZ' },
  };
  const buildPath = require.resolve('../tools/orcamento/build-dashboard.js');
  delete require.cache[buildPath];
  const { build } = require(buildPath);

  try {
    const senha = 'senha-e2e-de-teste';
    build({ outPath, today: new Date(2026, 6, 21), senha });
    const html = fs.readFileSync(outPath, 'utf8');

    // O conteúdo real (tipologia/grupo) fica cifrado no HTML -- decifra com
    // node:crypto (via criptografia.js) pra verificar as mesmas regras de
    // skip que antes eram checadas direto no HTML.
    const { decifrarComSenha } = require('../tools/orcamento/criptografia.js');
    const match = html.match(/window\.__DADOS_CIFRADOS__\s*=\s*(\{[\s\S]*?\});/);
    assert.ok(match, 'window.__DADOS_CIFRADOS__ not found in the built HTML');
    const registros = JSON.parse(decifrarComSenha(JSON.parse(match[1]), senha));
    const tipologias = registros.map(r => r.tipologia);
    const grupos = registros.map(r => r.grupo);
    assert.ok(tipologias.includes('SP'));
    assert.ok(tipologias.includes('SM'));
    assert.ok(!tipologias.includes('MENSAL'));
    assert.ok(!tipologias.includes('ACUMULADO'));
    assert.ok(!grupos.includes('Todos'));

    // Sem a senha certa, os dados continuam inacessíveis.
    assert.throws(() => decifrarComSenha(JSON.parse(match[1]), 'senha-errada'));
  } finally {
    fs.unlinkSync(xlsxPath);
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    delete require.cache[configPath];
    delete require.cache[buildPath];
  }
});
