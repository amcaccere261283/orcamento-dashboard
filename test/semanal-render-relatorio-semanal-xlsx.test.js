'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const RenderRelatorioSemanalXlsx = require('../tools/semanal/render-relatorio-semanal-xlsx.js');
const { semanasDoMes, indiceSemanaAtual } = require('../tools/semanal/compute-semanal.js');
const { buildXlsx } = require('../tools/semanal/xlsx-writer-browser.js');

const ANO = 2026;
const JULHO = 6;

// totalVolume (linha T do orçamento): 0 por padrão ("T ausente"); só quem
// precisa de uma Tendência de Volume não-nula passa um valor.
function registro({ sup, tipologia = 'ST', tomador = 'Tomador-A', volume = 0, totalVolume = 0 }) {
  const zeros = () => new Array(12).fill(0);
  const mk = (v) => { const a = zeros(); a[JULHO] = v; return a; };
  return {
    sup, tipologia, grupo: 'Grupo-A', tomador, origem: 'CONTRATO VIGENTE',
    previsto: { volume: mk(volume), financeiro: zeros(), equipes: mk(2), equipesResumo: { prod: 8 }, volumeResumo: { ticket: 1 } },
    realizado: { volume: zeros(), financeiro: zeros(), equipes: zeros(), equipesResumo: {}, volumeResumo: {} },
    total: { volume: mk(totalVolume), financeiro: zeros(), equipes: mk(2), equipesResumo: {}, volumeResumo: {} },
  };
}

function opcoesBase(registros, indices) {
  const semanas = semanasDoMes(ANO, JULHO);
  const hojeEpoch = semanas[1].inicio;
  return {
    registros, indices, ano: ANO, mesIdx: JULHO, semanas: semanas,
    indiceAtual: indiceSemanaAtual(semanas, hojeEpoch),
    demandas: { porRegistroEventos: {} }, hojeEpoch: hojeEpoch,
    geradoEm: new Date('2026-07-08T12:00:00Z'), autor: 'teste',
  };
}

function demandasCom(eventosPorChave) {
  const porRegistroEventos = {};
  Object.keys(eventosPorChave).forEach((chave) => {
    porRegistroEventos[chave] = { chegada: [], saidaEstoque: [], sondagemRealizada: eventosPorChave[chave] };
  });
  return { porRegistroEventos };
}

// Fixture com dois registros na mesma tipologia (ST): SUP-A com previsto de
// volume alto e pouco realizado na semana anterior (16 previsto x 6
// realizado = 37,5% -> Crítico) e SUP-B com previsto baixo e realizado
// parecido (8 previsto x 6 realizado = 75% -> Atenção), mais o Acumulado dos
// dois (SUP-A 15,4%, SUP-B 30% -> Crítico nos dois) e a Tendência da semana
// VIGENTE de SUP-B (12 previsto x 10,56 tendência = 88% -> Atenção).
// Confirmado rodando compute-relatorio-semanal.js diretamente: porContrato
// sai com 3 linhas Crítico e 2 Atenção, e resumoDesvios soma
// { critico: 3, atencao: 2 }.
function opcoesComDesvios() {
  const semanas = semanasDoMes(ANO, JULHO);
  const hojeEpoch = semanas[1].inicio;
  const indiceAtual = indiceSemanaAtual(semanas, hojeEpoch);
  const diaAlvo = semanas[0].inicio + 1; // dentro da semana anterior (semanas[0])
  const registros = [
    registro({ sup: 'SUP-A', volume: 100, totalVolume: 100 }),
    registro({ sup: 'SUP-B', volume: 50, totalVolume: 50 }),
  ];
  const demandas = demandasCom({
    'SUP-A||ST': Array(6).fill(diaAlvo),
    'SUP-B||ST': Array(6).fill(diaAlvo),
  });
  return {
    registros, indices: [0, 1], ano: ANO, mesIdx: JULHO, semanas: semanas,
    indiceAtual: indiceAtual, demandas: demandas, hojeEpoch: hojeEpoch,
    geradoEm: new Date('2026-07-08T12:00:00Z'), autor: 'teste',
  };
}

function extrairAba(bytes, indiceAba) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-relatorio-xlsx-test-'));
  const xlsxPath = path.join(tmpDir, 'r.xlsx');
  fs.writeFileSync(xlsxPath, Buffer.from(bytes));
  const outDir = path.join(tmpDir, 'out');
  execFileSync('unzip', ['-q', xlsxPath, '-d', outDir]);
  return fs.readFileSync(path.join(outDir, 'xl', 'worksheets', 'sheet' + indiceAba + '.xml'), 'utf8');
}

test('gerarRelatorioSemanalXlsx produz 4 abas, na ordem Resumo/Desvios/Volume/Equipes', () => {
  const registros = [registro({ sup: 'SUP-A', volume: 10 })];
  const resultado = RenderRelatorioSemanalXlsx.gerarRelatorioSemanalXlsx(opcoesBase(registros, [0]));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-relatorio-xlsx-test-'));
  const xlsxPath = path.join(tmpDir, 'r.xlsx');
  fs.writeFileSync(xlsxPath, Buffer.from(resultado.bytes));
  const outDir = path.join(tmpDir, 'out');
  execFileSync('unzip', ['-q', xlsxPath, '-d', outDir]);
  const workbookXml = fs.readFileSync(path.join(outDir, 'xl', 'workbook.xml'), 'utf8');
  assert.match(workbookXml, /<sheet name="Resumo"/);
  assert.match(workbookXml, /<sheet name="Desvios"/);
  assert.match(workbookXml, /<sheet name="Volume"/);
  assert.match(workbookXml, /<sheet name="Equipes"/);
});

test('a aba Volume tem o cabeçalho das 3 janelas e uma linha por registro/tipologia/total', () => {
  const registros = [registro({ sup: 'SUP-A', volume: 10 }), registro({ sup: 'SUP-B', tipologia: 'SP', volume: 20 })];
  const resultado = RenderRelatorioSemanalXlsx.gerarRelatorioSemanalXlsx(opcoesBase(registros, [0, 1]));
  const sheetXml = extrairAba(resultado.bytes, 3); // Resumo=1, Desvios=2, Volume=3
  assert.match(sheetXml, /Semana anterior — Previsto/);
  assert.match(sheetXml, /Acumulado do mês — Realizado/);
  assert.match(sheetXml, /Semana vigente — Tendência/);
  // 1 título + 1 cabeçalho + TOTAL GERAL + 2 tipologias + (registro+TOTAL SUP) x2 = 9 linhas
  const linhas = [...sheetXml.matchAll(/<row r="\d+"[^>]*>/g)];
  assert.strictEqual(linhas.length, 9);
});

test('a aba Volume tem título mesclado e cabeçalho estilizado', () => {
  const registros = [registro({ sup: 'SUP-A', volume: 10 })];
  const resultado = RenderRelatorioSemanalXlsx.gerarRelatorioSemanalXlsx(opcoesBase(registros, [0]));
  const sheetXml = extrairAba(resultado.bytes, 3); // Volume
  assert.match(sheetXml, /<mergeCells count="1"><mergeCell ref="A1:M1"\/><\/mergeCells>/);
  assert.match(sheetXml, /<c r="A1" s="1" t="inlineStr"><is><t>Relatório Semanal — Planejamento · Volume · Jul\/2026<\/t>/);
  assert.match(sheetXml, /<c r="A2" s="2" t="inlineStr"><is><t>SUP<\/t>/);
});

test('a aba Volume estiliza a linha TOTAL GERAL diferente de uma linha de registro', () => {
  const registros = [registro({ sup: 'SUP-A', volume: 10 })];
  const resultado = RenderRelatorioSemanalXlsx.gerarRelatorioSemanalXlsx(opcoesBase(registros, [0]));
  const sheetXml = extrairAba(resultado.bytes, 3); // Volume
  // linha 3 = TOTAL GERAL (título=1, cabeçalho=2, TOTAL GERAL=3) -- estilo textoTotal (s="6")
  assert.match(sheetXml, /<row r="3"><c r="A3" s="6" t="inlineStr"><is><t>—<\/t><\/is><\/c>/);
});

test('gerarRelatorioSemanalXlsx devolve resumo/desvios/linhas junto com bytes, prontos pro histórico', () => {
  const registros = [registro({ sup: 'SUP-A', volume: 10 })];
  const resultado = RenderRelatorioSemanalXlsx.gerarRelatorioSemanalXlsx(opcoesBase(registros, [0]));
  assert.strictEqual(typeof resultado.resumo.critico, 'number');
  assert.strictEqual(typeof resultado.resumo.atencao, 'number');
  assert.ok(Array.isArray(resultado.linhasVolume));
  assert.ok(Array.isArray(resultado.linhasEquipes));
  assert.ok(resultado.linhasVolume.some((l) => l.tipo === 'registro' && l.sup === 'SUP-A'));
});

test('a aba Desvios tem cabeçalho, seções Por tipologia/Por contrato e formatação condicional Crítico + Atenção na coluna J', () => {
  const resultado = RenderRelatorioSemanalXlsx.gerarRelatorioSemanalXlsx(opcoesComDesvios());
  const sheetXml = extrairAba(resultado.bytes, 2); // Resumo=1, Desvios=2

  assert.match(sheetXml, /<t>Por tipologia<\/t>/);
  assert.match(sheetXml, /<t>Por contrato<\/t>/);
  // cabeçalho das 12 colunas (A..L)
  ['SUP', 'Tomador', 'Tipologia', 'Contrato', 'Janela', 'Dimensão', 'Previsto',
    'Realizado/Tendência', 'Desvio %', 'Status', 'Ação', 'Responsável'].forEach((rotulo) => {
    assert.match(sheetXml, new RegExp('<t>' + rotulo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '</t>'));
  });
  // as duas linhas de status esperadas do fixture (SUP-A Crítico, SUP-B Atenção)
  assert.match(sheetXml, /<t>Crítico<\/t>/);
  assert.match(sheetXml, /<t>Atenção<\/t>/);
  // formatação condicional na coluna J -- pelo menos um bloco Crítico (dxfId 0) e um Atenção (dxfId 1)
  assert.match(sheetXml, /<conditionalFormatting sqref="J\d+:J\d+"><cfRule[^>]*dxfId="0"[^>]*text="Crítico"/);
  assert.match(sheetXml, /<conditionalFormatting sqref="J\d+:J\d+"><cfRule[^>]*dxfId="1"[^>]*text="Atenção"/);
});

test('a aba Desvios tem título mesclado, cabeçalho estilizado e zebra alternando nas linhas de dado', () => {
  const resultado = RenderRelatorioSemanalXlsx.gerarRelatorioSemanalXlsx(opcoesComDesvios());
  const sheetXml = extrairAba(resultado.bytes, 2); // Desvios

  assert.match(sheetXml, /<mergeCells count="1"><mergeCell ref="A1:L1"\/><\/mergeCells>/);
  assert.match(sheetXml, /<c r="A1" s="1" t="inlineStr"><is><t>Relatório Semanal — Planejamento · Desvios · Jul\/2026<\/t>/);
  // cabeçalho (linha 3: título=1, "Por tipologia"=2, cabeçalho=3) com estilo cabecalhoTabela (índice 2)
  assert.match(sheetXml, /<c r="A3" s="2" t="inlineStr"><is><t>SUP<\/t>/);
  // 1ª linha de dado (linha 4) sem zebra, 2ª linha de dado (linha 5) com zebra
  assert.match(sheetXml, /<row r="4"><c r="A4" s="4"/);
  assert.match(sheetXml, /<row r="5"><c r="A5" s="5"/);
});

test('a aba Desvios formata Previsto/Realizado-Tendência com separador de milhar quando a dimensão é Volume', () => {
  const desvios = {
    porTipologia: [],
    porContrato: [{
      sup: 'SUP-A', tomador: 'Tomador-A', tipologia: 'ST', contrato: 'SUP-A',
      janela: 'Semana anterior', dimensao: 'Volume',
      previsto: 12345, numerador: 6789, desvio: 0.55, status: 'Crítico', cor: '#D32020',
    }],
  };
  const sheets = [RenderRelatorioSemanalXlsx.montarAbaDesvios(desvios)];
  const bytes = buildXlsx(sheets);
  const sheetXml = extrairAba(bytes, 1);
  // s="7" = numeroMilhar (sem zebra, 1ª linha de dado)
  assert.match(sheetXml, /<c r="G4" s="7"><v>12345<\/v><\/c>/);
});

// Bundled cleanup A1 (revisão final 2026-08-16): o arredondamento de
// linhaDesvio() (casasDaDimensaoRotulo('Volume') === 0) foi confirmado
// estruturalmente quando foi implementado, mas nunca contra um valor
// fracionário de verdade -- um desvio de Volume com Previsto/Tendência
// quebrados (o caso real: uma janela "Semana vigente" projetada por
// Tendência) precisa sair como inteiro na célula, nunca com casas decimais.
test('a aba Desvios arredonda Previsto/Realizado-Tendência de Volume para inteiro, mesmo vindo fracionário', () => {
  const desvios = {
    porTipologia: [],
    porContrato: [{
      sup: 'SUP-A', tomador: 'Tomador-A', tipologia: 'ST', contrato: 'SUP-A',
      janela: 'Semana vigente', dimensao: 'Volume',
      previsto: 16.6, numerador: 6.3333333333333, desvio: 0.381, status: 'Crítico', cor: '#D32020',
    }],
  };
  const sheets = [RenderRelatorioSemanalXlsx.montarAbaDesvios(desvios)];
  const bytes = buildXlsx(sheets);
  const sheetXml = extrairAba(bytes, 1);
  assert.match(sheetXml, /<v>17<\/v>/, 'Previsto 16.6 precisa arredondar para 17 (inteiro), não vazar fracionário');
  assert.match(sheetXml, /<v>6<\/v>/, 'Realizado/Tendência 6.33... precisa arredondar para 6 (inteiro), não vazar fracionário');
  assert.ok(!sheetXml.includes('16.6'), 'não pode vazar o Previsto fracionário cru');
  assert.ok(!sheetXml.includes('6.333'), 'não pode vazar a Tendência fracionária crua');
});

// Bundled cleanup B (revisão final 2026-08-16): celulaNumOuVazia ganhou um
// guard contra NaN/±Infinity -- sem ele, um NaN chegando aqui serializaria
// como <v>NaN</v>, produzindo um .xlsx que o Excel recusa abrir.
test('celulaNumOuVazia (via montarAbaDesvios) transforma NaN numa célula vazia, não em <v>NaN</v>', () => {
  const desvios = {
    porTipologia: [],
    porContrato: [{
      sup: 'SUP-Z', tomador: 'Tomador-A', tipologia: 'ST', contrato: 'SUP-Z',
      janela: 'Semana anterior', dimensao: 'Volume',
      previsto: NaN, numerador: 6, desvio: null, status: 'Crítico', cor: '#D32020',
    }],
  };
  const sheets = [RenderRelatorioSemanalXlsx.montarAbaDesvios(desvios)];
  const bytes = buildXlsx(sheets);
  const sheetXml = extrairAba(bytes, 1);
  assert.ok(!sheetXml.includes('NaN'), 'um NaN não pode chegar ao XML -- Excel recusa abrir o arquivo');
  // A coluna G (Previsto) da linha de dados precisa ser uma célula de texto
  // vazia (inline string), não uma célula numérica.
  assert.match(sheetXml, /<c r="G\d+" t="inlineStr"><is><t><\/t><\/is><\/c>/);
});

test('a aba Resumo mostra as contagens de Crítico/Atenção (por contrato) batendo com resultado.resumo', () => {
  const resultado = RenderRelatorioSemanalXlsx.gerarRelatorioSemanalXlsx(opcoesComDesvios());
  assert.strictEqual(resultado.resumo.critico, 3);
  assert.strictEqual(resultado.resumo.atencao, 2);
  const sheetXml = extrairAba(resultado.bytes, 1); // Resumo
  // Layout: 1 título, 2 mês/ano, 3 semana anterior, 4 semana vigente,
  // 5 gerado em, 6 gerado por, 7 vazia, 8 crítico, 9 atenção.
  assert.match(sheetXml, /<t>Desvios Crítico \(por contrato\)<\/t><\/is><\/c><c r="B8"><v>3<\/v><\/c>/);
  assert.match(sheetXml, /<t>Desvios Atenção \(por contrato\)<\/t><\/is><\/c><c r="B9"><v>2<\/v><\/c>/);
});

test('a aba Resumo declara o período do relatório: mês/ano, semana anterior e semana vigente', () => {
  const resultado = RenderRelatorioSemanalXlsx.gerarRelatorioSemanalXlsx(opcoesComDesvios());
  const sheetXml = extrairAba(resultado.bytes, 1); // Resumo
  assert.match(sheetXml, /<t>Mês\/ano do relatório<\/t>/);
  assert.match(sheetXml, /<t>Jul\/2026<\/t>/);
  assert.match(sheetXml, /<t>Semana anterior<\/t>/);
  assert.match(sheetXml, /<t>Semana vigente<\/t>/);
  // A fixture usa semanasDoMes(2026, JULHO) com hojeEpoch = semanas[1].inicio,
  // então indiceAtual=1: a semana anterior é semanas[0] e a vigente, semanas[1]
  // -- as duas datas precisam ser distintas entre si (nenhuma delas "—").
  assert.doesNotMatch(sheetXml, /<t>Semana anterior<\/t><\/is><\/c><c r="B3"[^>]*><is><t>—<\/t>/);
  assert.doesNotMatch(sheetXml, /<t>Semana vigente<\/t><\/is><\/c><c r="B4"[^>]*><is><t>—<\/t>/);
});

test('a aba Resumo quebra Crítico/Atenção por dimensão (Volume/Equipes)', () => {
  const resultado = RenderRelatorioSemanalXlsx.gerarRelatorioSemanalXlsx(opcoesComDesvios());
  const sheetXml = extrairAba(resultado.bytes, 1); // Resumo
  assert.match(sheetXml, /<t>  Volume — Crítico<\/t>/);
  assert.match(sheetXml, /<t>  Volume — Atenção<\/t>/);
  assert.match(sheetXml, /<t>  Equipes — Crítico<\/t>/);
  assert.match(sheetXml, /<t>  Equipes — Atenção<\/t>/);
  // O fixture opcoesComDesvios só popula registros ST (Volume) -- a linha de
  // Equipes tem que existir e ficar em zero, não sumir do relatório.
  assert.match(sheetXml, /<t>  Equipes — Crítico<\/t><\/is><\/c><c r="B12"><v>0<\/v><\/c>/);
  assert.match(sheetXml, /<t>  Equipes — Atenção<\/t><\/is><\/c><c r="B13"><v>0<\/v><\/c>/);
  assert.match(sheetXml, /<t>  Volume — Crítico<\/t><\/is><\/c><c r="B10"><v>3<\/v><\/c>/);
  assert.match(sheetXml, /<t>  Volume — Atenção<\/t><\/is><\/c><c r="B11"><v>2<\/v><\/c>/);
});

test('a aba Equipes arredonda valores fracionários para 2 casas decimais', () => {
  const zeros = () => new Array(12).fill(0);
  const mk = (v) => { const a = zeros(); a[JULHO] = v; return a; };
  const regEquipesFracionarias = {
    sup: 'SUP-A', tipologia: 'ST', grupo: 'Grupo-A', tomador: 'Tomador-A', origem: 'CONTRATO VIGENTE',
    previsto: { volume: zeros(), financeiro: zeros(), equipes: mk(8 / 3), equipesResumo: { prod: 8 }, volumeResumo: { ticket: 1 } },
    realizado: { volume: zeros(), financeiro: zeros(), equipes: zeros(), equipesResumo: {}, volumeResumo: {} },
    total: { volume: zeros(), financeiro: zeros(), equipes: mk(8 / 3), equipesResumo: {}, volumeResumo: {} },
  };
  const resultado = RenderRelatorioSemanalXlsx.gerarRelatorioSemanalXlsx(opcoesBase([regEquipesFracionarias], [0]));
  const sheetXml = extrairAba(resultado.bytes, 4); // Resumo=1, Desvios=2, Volume=3, Equipes=4
  // 8/3 = 2,6666... -> arredondado a 2 casas = 2.67 (a serialização de <v> usa
  // ponto, não vírgula -- número JS cru, não texto formatado em pt-BR)
  assert.match(sheetXml, /<v>2\.67<\/v>/);
  assert.ok(!sheetXml.includes('2.6666666666666665'), 'não pode vazar o valor fracionário cru sem arredondar');
});

test('as 4 abas têm o título no mesmo formato "Relatório Semanal — Planejamento · <Aba> · <Mês/Ano>"', () => {
  const registros = [registro({ sup: 'SUP-A', volume: 10 })];
  const resultado = RenderRelatorioSemanalXlsx.gerarRelatorioSemanalXlsx(opcoesBase(registros, [0]));
  const abas = ['Resumo', 'Desvios', 'Volume', 'Equipes'];
  abas.forEach((nome, i) => {
    const sheetXml = extrairAba(resultado.bytes, i + 1);
    const esperado = new RegExp('Relatório Semanal — Planejamento · ' + nome + ' · Jul/2026');
    assert.match(sheetXml, esperado, nome + ' deveria mostrar o mês/ano no título');
  });
});

test('a aba Resumo tem título mesclado A1:B1 e larguras de coluna, sem mudar as 13 linhas de conteúdo', () => {
  const resultado = RenderRelatorioSemanalXlsx.gerarRelatorioSemanalXlsx(opcoesComDesvios());
  const sheetXml = extrairAba(resultado.bytes, 1); // Resumo
  assert.match(sheetXml, /<mergeCells count="1"><mergeCell ref="A1:B1"\/><\/mergeCells>/);
  assert.match(sheetXml, /<c r="A1" s="1" t="inlineStr">/);
  assert.match(sheetXml, /<cols><col min="1" max="1" width="32" customWidth="1"\/><col min="2" max="2" width="24" customWidth="1"\/><\/cols>/);
  // as 13 linhas de sempre continuam nas mesmas posições -- B8/B12 inalterados
  assert.match(sheetXml, /<t>Desvios Crítico \(por contrato\)<\/t><\/is><\/c><c r="B8"><v>3<\/v><\/c>/);
  assert.match(sheetXml, /<t>  Equipes — Crítico<\/t><\/is><\/c><c r="B12"><v>0<\/v><\/c>/);
});
