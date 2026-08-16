'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const RenderRelatorioSemanalXlsx = require('../tools/semanal/render-relatorio-semanal-xlsx.js');
const { semanasDoMes, diaEpoch, indiceSemanaAtual } = require('../tools/semanal/compute-semanal.js');

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
