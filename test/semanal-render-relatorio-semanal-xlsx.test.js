'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const RenderRelatorioSemanalXlsx = require('../tools/semanal/render-relatorio-semanal-xlsx.js');
const { semanasDoMes, indiceSemanaAtual } = require('../tools/semanal/compute-semanal.js');

const ANO = 2026;
const JULHO = 6;

function registro({ sup, tipologia = 'ST', tomador = 'Tomador-A', volume = 0 }) {
  const zeros = () => new Array(12).fill(0);
  const mk = (v) => { const a = zeros(); a[JULHO] = v; return a; };
  return {
    sup, tipologia, grupo: 'Grupo-A', tomador, origem: 'CONTRATO VIGENTE',
    previsto: { volume: mk(volume), financeiro: zeros(), equipes: mk(2), equipesResumo: { prod: 8 }, volumeResumo: { ticket: 1 } },
    realizado: { volume: zeros(), financeiro: zeros(), equipes: zeros(), equipesResumo: {}, volumeResumo: {} },
    total: { volume: zeros(), financeiro: zeros(), equipes: mk(2), equipesResumo: {}, volumeResumo: {} },
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
// parecido (8 previsto x 6 realizado = 75% -> Atenção). Confirmado rodando
// compute-relatorio-semanal.js diretamente: porContrato sai com 3 linhas
// Crítico e 1 Atenção (a de SUP-B), e resumoDesvios soma { critico: 3, atencao: 1 }.
function opcoesComDesvios() {
  const semanas = semanasDoMes(ANO, JULHO);
  const hojeEpoch = semanas[1].inicio;
  const indiceAtual = indiceSemanaAtual(semanas, hojeEpoch);
  const diaAlvo = semanas[0].inicio + 1; // dentro da semana anterior (semanas[0])
  const registros = [
    registro({ sup: 'SUP-A', volume: 100 }),
    registro({ sup: 'SUP-B', volume: 50 }),
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
  assert.match(sheetXml, /Semana que vem — Tendência/);
  // 1 cabeçalho + TOTAL GERAL + 2 tipologias + (registro+TOTAL SUP) x2 = 8 linhas
  const linhas = [...sheetXml.matchAll(/<row r="\d+">/g)];
  assert.strictEqual(linhas.length, 8);
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

test('a aba Resumo mostra as contagens de Crítico/Atenção batendo com resultado.resumo', () => {
  const resultado = RenderRelatorioSemanalXlsx.gerarRelatorioSemanalXlsx(opcoesComDesvios());
  assert.strictEqual(resultado.resumo.critico, 3);
  assert.strictEqual(resultado.resumo.atencao, 1);
  const sheetXml = extrairAba(resultado.bytes, 1); // Resumo
  assert.match(sheetXml, /<t>Desvios Crítico<\/t><\/is><\/c><c r="B6"><v>3<\/v><\/c>/);
  assert.match(sheetXml, /<t>Desvios Atenção<\/t><\/is><\/c><c r="B7"><v>1<\/v><\/c>/);
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
