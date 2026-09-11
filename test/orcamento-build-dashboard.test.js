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

// Aba "PROJ. GERAL - 110MM" sintética da linha de base -- cabeçalho na
// linha 2 (não 1), sem coluna BASE, uma linha real (SUP-A / SP) que casa
// com o registro sintético da MATRIZ acima.
function construirPlanilhaLinhaBaseTeste() {
  const sharedStrings = ['ORIGEM', 'GRUPO', 'TOMADOR', 'ESCOPO', 'APOIO', 'SUP', 'INICIO', 'TERMINO', 'SONDAGEM',
    'PICO', 'FRENTES', 'PROD.', 'DIAS', 'TOTAL', 'TICKET', 'OBSERVAÇÃO',
    'SP', 'CONTRATO VIGENTE', 'PÁTRIA', 'Via Araucária S.A', 'SUP-A'];
  const idx = name => sharedStrings.indexOf(name);

  function linhaHeaderXml() {
    let cells = celulaStr(idx('ORIGEM'), 'B2') + celulaStr(idx('GRUPO'), 'C2') + celulaStr(idx('TOMADOR'), 'D2') +
      celulaStr(idx('ESCOPO'), 'E2') + celulaStr(idx('APOIO'), 'F2') + celulaStr(idx('SUP'), 'G2') +
      celulaStr(idx('INICIO'), 'H2') + celulaStr(idx('TERMINO'), 'I2') + celulaStr(idx('SONDAGEM'), 'J2');
    const letras = ['K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V'];
    letras.forEach((l, i) => { cells += celulaNum(`${l}2`, 46023 + i * 30); });
    cells += celulaStr(idx('PICO'), 'W2') + celulaStr(idx('FRENTES'), 'X2') + celulaStr(idx('PROD.'), 'Y2') + celulaStr(idx('DIAS'), 'Z2');
    const letras2 = ['AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AG', 'AH', 'AI', 'AJ', 'AK', 'AL'];
    letras2.forEach((l, i) => { cells += celulaNum(`${l}2`, 46023 + i * 30); });
    cells += celulaStr(idx('TOTAL'), 'AM2') + celulaStr(idx('TICKET'), 'AN2');
    const letras3 = ['AO', 'AP', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AV', 'AW', 'AX', 'AY', 'AZ'];
    letras3.forEach((l, i) => { cells += celulaNum(`${l}2`, 46023 + i * 30); });
    cells += celulaStr(idx('TOTAL'), 'BA2') + celulaStr(idx('OBSERVAÇÃO'), 'BB2');
    return `<row r="2">${cells}</row>`;
  }

  const cellsLinha = celulaStr(idx('CONTRATO VIGENTE'), 'B3') + celulaStr(idx('PÁTRIA'), 'C3') +
    celulaStr(idx('Via Araucária S.A'), 'D3') + celulaStr(idx('SUP-A'), 'G3') + celulaStr(idx('SP'), 'J3');
  const rows = linhaHeaderXml() + `<row r="3">${cellsLinha}</row>`;

  const sheetXml = `<worksheet><sheetData>${rows}</sheetData></worksheet>`;
  const workbookXml = '<?xml version="1.0"?><workbook xmlns:r="rels"><sheets><sheet name="PROJ. GERAL - 110MM" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const relsXml = '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>';
  const sharedStringsXml = '<sst>' + sharedStrings.map(s => `<si><t>${s}</t></si>`).join('') + '</sst>';

  return buildMinimalZip([
    { name: 'xl/workbook.xml', data: Buffer.from(workbookXml, 'utf8'), method: 0 },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(relsXml, 'utf8'), method: 0 },
    { name: 'xl/sharedStrings.xml', data: Buffer.from(sharedStringsXml, 'utf8'), method: 0 },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml, 'utf8'), method: 8 },
  ]);
}

// Aba "propostas-..." sintética e VAZIA (só cabeçalho, nenhuma linha GANHA)
// -- usada só pra deixar build() e2e completo sem precisar de um Radar de
// Demandas real. Os testes dedicados de propostas GANHAS ficam em
// test/orcamento-parse-propostas-ganhas.test.js.
function construirPlanilhaRadarDemandasVaziaTeste() {
  const sharedStrings = ['sup', 'status', 'contratante', 'clienteFinal', 'objeto'];
  const idx = name => sharedStrings.indexOf(name);
  const header = celulaStr(idx('sup'), 'A1') + celulaStr(idx('status'), 'B1') +
    celulaStr(idx('contratante'), 'C1') + celulaStr(idx('clienteFinal'), 'D1') + celulaStr(idx('objeto'), 'E1');
  const sheetXml = `<worksheet><sheetData><row r="1">${header}</row></sheetData></worksheet>`;
  const workbookXml = '<?xml version="1.0"?><workbook xmlns:r="rels"><sheets><sheet name="propostas-teste" sheetId="1" r:id="rId1"/></sheets></workbook>';
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
  const linhaBasePath = path.join(os.tmpdir(), `orcamento-linha-base-e2e-${Date.now()}.xlsx`);
  fs.writeFileSync(linhaBasePath, construirPlanilhaLinhaBaseTeste());
  const radarDemandasPath = path.join(os.tmpdir(), `orcamento-radar-demandas-e2e-${Date.now()}.xlsx`);
  fs.writeFileSync(radarDemandasPath, construirPlanilhaRadarDemandasVaziaTeste());
  const outPath = path.join(os.tmpdir(), `orcamento-dashboard-e2e-${Date.now()}.html`);
  const demandasContratadoPath = path.join(os.tmpdir(), `demandas-contratado-online-e2e-${Date.now()}.csv`);
  const backlog2026Path = path.join(os.tmpdir(), `backlog-2026-online-e2e-${Date.now()}.csv`);

  // Troca a config real por uma apontando pras planilhas sintéticas -- o
  // require cache garante que build-dashboard.js enxergue essa troca antes
  // de carregá-lo pela primeira vez neste processo de teste.
  const configPath = require.resolve('../tools/orcamento/config.js');
  delete require.cache[configPath];
  require.cache[configPath] = {
    id: configPath, filename: configPath, loaded: true,
    exports: {
      caminhoArquivo: xlsxPath, nomeAba: 'MATRIZ',
      caminhoLinhaBase: linhaBasePath, nomeAbaLinhaBase: 'PROJ. GERAL - 110MM',
      caminhoRadarDemandas: radarDemandasPath,
    },
  };
  const buildPath = require.resolve('../tools/orcamento/build-dashboard.js');
  delete require.cache[buildPath];
  const { build } = require(buildPath);

  const avancosPath = path.join(os.tmpdir(), `avancos-online-e2e-${Date.now()}.csv`);
  const labPath = path.join(os.tmpdir(), `lab-online-e2e-${Date.now()}.csv`);
  fs.writeFileSync(avancosPath, 'Contrato,Criação da OS,Tipo,Status,Executado Dia,Deslocamento,Total (m),Observações de Campo,OS,Sondador\n');
  fs.writeFileSync(labPath, 'ID Contrato,Ensaiado Dia,Tipo de Ensaio,Data Programada\n');

  try {
    const senha = 'senha-e2e-de-teste';
    build({
      outPath, today: new Date(2026, 6, 21), senha,
      caminhoAvancosOnline: avancosPath,
      caminhoDemandasSondagemOnline: path.join(os.tmpdir(), 'inexistente-sondagem-e2e.csv'),
      caminhoLabOnline: labPath,
      caminhoDemandasLabOnline: path.join(os.tmpdir(), 'inexistente-lab-e2e.json'),
      // Explícito, e não o default (dist/liberado-sond-online.csv) -- desde
      // a Task 9 (verificação end-to-end) esse arquivo é commitado de
      // verdade no repo (convenção documentada no CLAUDE.md), então o
      // default deixou de ser "ausente" num checkout normal. Sem apontar
      // pra um caminho garantidamente inexistente aqui, este teste passava
      // a ler o CSV real do repo e a fixture sintética (2 registros) não
      // batia mais com o número de linhas do funil (uma por combinação
      // SUP+tipologia da SOND, não uma por registro da MATRIZ).
      caminhoLiberadoSondOnline: path.join(os.tmpdir(), 'inexistente-liberado-sond-e2e.csv'),
      // Idem outPath: sem override aqui, build() sobrescreveria o CSV real e
      // commitado em dist/demandas-contratado-online.csv com o resultado
      // desta fixture sintética toda vez que a suíte rodar.
      caminhoDemandasContratadoOnline: demandasContratadoPath,
      caminhoBacklog2026Online: backlog2026Path,
    });
    const html = fs.readFileSync(outPath, 'utf8');
    assert.match(fs.readFileSync(backlog2026Path, 'utf8'), /^Cliente,Contrato,Realizado2026,TendenciaRestante2026\n/);

    // O conteúdo real (tipologia/grupo) fica cifrado no HTML -- decifra com
    // node:crypto (via criptografia.js) pra verificar as mesmas regras de
    // skip que antes eram checadas direto no HTML.
    const { decifrarComSenha } = require('../tools/comum/criptografia.js');
    const match = html.match(/window\.__DADOS_CIFRADOS__\s*=\s*(\{[\s\S]*?\});/);
    assert.ok(match, 'window.__DADOS_CIFRADOS__ not found in the built HTML');
    const dados = JSON.parse(decifrarComSenha(JSON.parse(match[1]), senha));
    const registros = dados.registros;
    assert.ok(dados.demandasChegadasMensais && typeof dados.demandasChegadasMensais === 'object', 'o blob decifrado tem que trazer demandasChegadasMensais, mesmo vazio');
    // demandasFunilLinhas: build() chama montarFunilDemandas({registros,
    // liberadoSond, propostasGanhas}) e passa o resultado pra renderDashboard
    // -- prova que a ligação (Parte 1 da Task 6) está de fato acontecendo, não
    // só que a função existe isolada (já coberta em
    // test/orcamento-compute-demandas-funil.test.js). Sem liberadoSond real
    // nesta fixture (caminhoLiberadoSondOnline aponta pra um arquivo
    // inexistente), uma linha por registro da MATRIZ ainda aparece
    // (contratado real, liberado/executado zerados por falta de entrada na
    // SOND).
    assert.ok(Array.isArray(dados.demandasFunilLinhas), 'o blob decifrado tem que trazer demandasFunilLinhas, mesmo vazio');
    assert.equal(dados.demandasFunilLinhas.length, registros.length, 'uma linha do funil por registro da MATRIZ, sem entradas extras da SOND (liberadoSond vazio nesta fixture)');
    const linhaFunilSP = dados.demandasFunilLinhas.find(l => l.tipologia === 'SP');
    assert.ok(linhaFunilSP, 'a linha do funil da tipologia SP existe');
    assert.equal(linhaFunilSP.liberado, 0, 'sem liberadoSond de verdade nesta fixture, liberado fica 0');
    assert.ok(Array.isArray(dados.demandasFunilPropostas), 'o blob decifrado tem que trazer demandasFunilPropostas, mesmo vazio');
    const tipologias = registros.map(r => r.tipologia);
    const grupos = registros.map(r => r.grupo);
    assert.ok(tipologias.includes('SP'));
    assert.ok(tipologias.includes('SM'));
    assert.ok(!tipologias.includes('MENSAL'));
    assert.ok(!tipologias.includes('ACUMULADO'));
    assert.ok(!grupos.includes('Todos'));

    // O SUP-A/SP casa com a linha de base sintética -- ganha um
    // previstoInicial de verdade; o SM (não existe na linha de base) fica
    // com previstoInicial zerado, não null.
    const registroSP = registros.find(r => r.tipologia === 'SP');
    const registroSM = registros.find(r => r.tipologia === 'SM');
    assert.ok(registroSP.previstoInicial, 'toda linha deve ganhar previstoInicial, mesmo sem casar com a linha de base');
    assert.equal(registroSM.previstoInicial.financeiro[0], 0, 'sem casar SUP+tipologia na linha de base, fica zero (não null)');

    // Sem a senha certa, os dados continuam inacessíveis.
    assert.throws(() => decifrarComSenha(JSON.parse(match[1]), 'senha-errada'));
  } finally {
    fs.unlinkSync(xlsxPath);
    fs.unlinkSync(linhaBasePath);
    fs.unlinkSync(radarDemandasPath);
    fs.unlinkSync(avancosPath);
    fs.unlinkSync(labPath);
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    if (fs.existsSync(demandasContratadoPath)) fs.unlinkSync(demandasContratadoPath);
    if (fs.existsSync(backlog2026Path)) fs.unlinkSync(backlog2026Path);
    delete require.cache[configPath];
    delete require.cache[buildPath];
  }
});

test('montarDemandasChegadasMensais: lê avancos-online.csv + lab-online.csv (via parseCsvGrid) e devolve chegadas mensais por (sup,tipologia), redirecionando SUP desconhecido pra "Diversos"', () => {
  const { montarDemandasChegadasMensais } = require('../tools/orcamento/build-dashboard.js');
  const registros = [
    { sup: 'SUP-0001-24', tipologia: 'SP' },
    { sup: 'Diversos', tipologia: 'SP' },
  ];
  const periodos = Array.from({ length: 12 }, (_, m) => new Date(Date.UTC(2026, m, 1)));

  // 46023 = 01/01/2026, 46054 = 01/02/2026 (mesma convenção de serial Excel
  // usada em todo o resto do projeto).
  const avancosCsv = 'Contrato,Criação da OS,Tipo,Status,Executado Dia,Deslocamento,Total (m),Observações de Campo,OS,Sondador\n'
    + 'SUP-0001-24,46023,SP,PENDENTE,,Não,10,,OS-1,\n'
    + 'SUP-9999-24,46054,SP,PENDENTE,,Não,10,,OS-2,\n';

  const avancosPath = path.join(os.tmpdir(), `avancos-online-teste-${Date.now()}.csv`);
  const labPath = path.join(os.tmpdir(), `lab-online-teste-${Date.now()}.csv`);
  fs.writeFileSync(avancosPath, avancosCsv);
  fs.writeFileSync(labPath, 'ID Contrato,Ensaiado Dia,Tipo de Ensaio,Data Programada\n');

  try {
    const resultado = montarDemandasChegadasMensais({
      registros, periodos,
      caminhoAvancosOnline: avancosPath,
      caminhoDemandasSondagemOnline: path.join(os.tmpdir(), 'inexistente-sondagem.csv'),
      caminhoLabOnline: labPath,
      caminhoDemandasLabOnline: path.join(os.tmpdir(), 'inexistente-lab.json'),
    });
    assert.strictEqual(resultado.chegadasMensais['SUP-0001-24||SP'][0], 1);
    assert.strictEqual(resultado.chegadasMensais['Diversos||SP'][1], 1, 'furo de SUP desconhecido tem que redirecionar pra Diversos, não sumir');
  } finally {
    fs.unlinkSync(avancosPath);
    fs.unlinkSync(labPath);
  }
});

test('montarDemandasChegadasMensais: também devolve o saldo de abertura (estoque em 31/12 do ano anterior), separado das chegadas do ano -- furo de 2025 ainda pendente conta em saldoAbertura, não em chegadasMensais', () => {
  const { montarDemandasChegadasMensais } = require('../tools/orcamento/build-dashboard.js');
  const registros = [{ sup: 'SUP-0001-24', tipologia: 'SP' }];
  const periodos = Array.from({ length: 12 }, (_, m) => new Date(Date.UTC(2026, m, 1)));

  // 45658 = 01/01/2025 (furo que chegou no ano anterior e nunca foi executado
  // -- entra no saldo de abertura de 2026, não nas chegadas de 2026).
  const avancosCsv = 'Contrato,Criação da OS,Tipo,Status,Executado Dia,Deslocamento,Total (m),Observações de Campo,OS,Sondador\n'
    + 'SUP-0001-24,45658,SP,PENDENTE,,Não,10,,OS-1,\n';

  const avancosPath = path.join(os.tmpdir(), `avancos-online-saldo-teste-${Date.now()}.csv`);
  const labPath = path.join(os.tmpdir(), `lab-online-saldo-teste-${Date.now()}.csv`);
  fs.writeFileSync(avancosPath, avancosCsv);
  fs.writeFileSync(labPath, 'ID Contrato,Ensaiado Dia,Tipo de Ensaio,Data Programada\n');

  try {
    const resultado = montarDemandasChegadasMensais({
      registros, periodos,
      caminhoAvancosOnline: avancosPath,
      caminhoDemandasSondagemOnline: path.join(os.tmpdir(), 'inexistente-sondagem-saldo.csv'),
      caminhoLabOnline: labPath,
      caminhoDemandasLabOnline: path.join(os.tmpdir(), 'inexistente-lab-saldo.json'),
    });
    assert.strictEqual(resultado.saldoAbertura['SUP-0001-24||SP'], 1);
    assert.strictEqual(resultado.chegadasMensais['SUP-0001-24||SP'], undefined, 'furo de 2025 não é chegada de 2026');
  } finally {
    fs.unlinkSync(avancosPath);
    fs.unlinkSync(labPath);
  }
});

test('montarDemandasChegadasMensais: erro claro quando avancos-online.csv (obrigatório) não existe', () => {
  const { montarDemandasChegadasMensais } = require('../tools/orcamento/build-dashboard.js');
  assert.throws(
    () => montarDemandasChegadasMensais({
      registros: [], periodos: Array.from({ length: 12 }, (_, m) => new Date(Date.UTC(2026, m, 1))),
      caminhoAvancosOnline: path.join(os.tmpdir(), 'nunca-existiu.csv'),
      caminhoDemandasSondagemOnline: path.join(os.tmpdir(), 'nunca-existiu-2.csv'),
      caminhoLabOnline: path.join(os.tmpdir(), 'nunca-existiu-3.csv'),
      caminhoDemandasLabOnline: path.join(os.tmpdir(), 'nunca-existiu-4.json'),
    }),
    /atualizar-avancos-online\.js/,
  );
});

test('montarLiberadoSond: soma prevista/executada/saldo de siglas diferentes que caem no mesmo bucket canônico (SM, SM.F, SR -> "SM / SM.F / SR")', () => {
  const { montarLiberadoSond } = require('../tools/orcamento/build-dashboard.js');
  const csv = 'Cliente,Contrato,Sigla,Prevista,Executada,Saldo\n'
    + 'Cliente A,SUP-8224-25 (AB),SM,100,40,60\n'
    + 'Cliente A,SUP-8224-25 (AB),SM.F,50,10,40\n'
    + 'Cliente A,SUP-8224-25 (AB),SR,25,5,20\n'
    + 'Cliente A,SUP-8224-25 (AB),SP,30,30,0\n';
  const csvPath = path.join(os.tmpdir(), `liberado-sond-online-teste-${Date.now()}.csv`);
  fs.writeFileSync(csvPath, csv);
  try {
    const liberadoSond = montarLiberadoSond({ caminhoLiberadoSondOnline: csvPath });
    assert.deepEqual(liberadoSond['SUP-8224-25 (AB)||SM / SM.F / SR'], { prevista: 175, executada: 55, saldo: 120 });
    assert.deepEqual(liberadoSond['SUP-8224-25 (AB)||SP'], { prevista: 30, executada: 30, saldo: 0 });
  } finally {
    fs.unlinkSync(csvPath);
  }
});

test('montarLiberadoSond: dist/liberado-sond-online.csv ausente é OPCIONAL -- avisa e devolve objeto vazio, não quebra o build', () => {
  const { montarLiberadoSond } = require('../tools/orcamento/build-dashboard.js');
  const avisos = [];
  const warnOriginal = console.warn;
  console.warn = (msg) => avisos.push(msg);
  try {
    const liberadoSond = montarLiberadoSond({ caminhoLiberadoSondOnline: path.join(os.tmpdir(), 'liberado-sond-online-nunca-existiu.csv') });
    assert.deepEqual(liberadoSond, {});
    assert.ok(avisos.some(m => /atualizar-liberado-sond\.js/.test(m)), 'aviso deve citar o comando pra gerar o CSV');
  } finally {
    console.warn = warnOriginal;
  }
});

test('montarLiberadoSond: sigla fora de MAPA_TIPOLOGIAS propaga o erro de rotularTipologia, não engole em silêncio', () => {
  const { montarLiberadoSond } = require('../tools/orcamento/build-dashboard.js');
  const csv = 'Cliente,Contrato,Sigla,Prevista,Executada,Saldo\n'
    + 'Cliente A,SUP-8224-25 (AB),XYZ-DESCONHECIDA,10,0,10\n';
  const csvPath = path.join(os.tmpdir(), `liberado-sond-online-erro-teste-${Date.now()}.csv`);
  fs.writeFileSync(csvPath, csv);
  try {
    assert.throws(
      () => montarLiberadoSond({ caminhoLiberadoSondOnline: csvPath }),
      /Tipologia desconhecida/,
    );
  } finally {
    fs.unlinkSync(csvPath);
  }
});

test('gerarDemandasContratadoOnline: uma linha por (sup,tipologia) com tomador e contratado > 0, órfãs (tomador null) e contratado 0 ficam de fora', () => {
  const { gerarDemandasContratadoOnline } = require('../tools/orcamento/build-dashboard.js');
  const linhas = [
    { sup: 'SUP-8520-26', tomador: 'Cliente A', tipologia: 'SP', contratado: 100, liberado: 0, executado: 0 },
    { sup: 'SUP-8520-26', tomador: 'Cliente A', tipologia: 'PI', contratado: 50, liberado: 0, executado: 0 },
    { sup: 'SUP-9999-26', tomador: null, tipologia: 'SP', contratado: 0, liberado: 20, executado: 10 }, // órfã do liberadoSond
    { sup: 'SUP-1000-24', tomador: 'Cliente B', tipologia: 'ST', contratado: 0, liberado: 0, executado: 0 }, // contratado zero
  ];
  const csv = gerarDemandasContratadoOnline(linhas);
  const linhasCsv = csv.trim().split('\n');
  assert.equal(linhasCsv[0], 'Cliente,Contrato');
  assert.equal(linhasCsv.length, 3); // cabeçalho + 2 linhas de SUP-8520-26 (uma por tipologia)
  assert.ok(linhasCsv.slice(1).every((l) => l.startsWith('Cliente A,SUP-8520-26')));
});

test('gerarDemandasContratadoOnline: lista vazia devolve só o cabeçalho', () => {
  const { gerarDemandasContratadoOnline } = require('../tools/orcamento/build-dashboard.js');
  assert.equal(gerarDemandasContratadoOnline([]).trim(), 'Cliente,Contrato');
  assert.equal(gerarDemandasContratadoOnline(undefined).trim(), 'Cliente,Contrato');
});

test('gerarDemandasContratadoOnline: tomador com vírgula é escapado (reaproveita gridParaCsv)', () => {
  const { gerarDemandasContratadoOnline } = require('../tools/orcamento/build-dashboard.js');
  const csv = gerarDemandasContratadoOnline([
    { sup: 'SUP-1-24', tomador: 'Empresa, Ltda', tipologia: 'SP', contratado: 10 },
  ]);
  assert.match(csv, /"Empresa, Ltda",SUP-1-24/);
});
