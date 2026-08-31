'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { calcularSnapshotSemanaAlvo, chaveSemanaSeguinteDeSexta, gravarSnapshotNoArquivo } = require('../tools/semanal/congelar-tendencia-semanal.js');

// Sexta 2026-09-04 -> a semana seguinte começa segunda 2026-09-07.
test('chaveSemanaSeguinteDeSexta acha a segunda seguinte à sexta em epoch de dias', () => {
  const sexta = Date.UTC(2026, 8, 4) / 86400000; // 2026-09-04, epoch de DIAS (UTC)
  const chave = chaveSemanaSeguinteDeSexta(sexta);
  assert.equal(chave, '2026-09-07');
});

test('chaveSemanaSeguinteDeSexta funciona também rodado num sábado/domingo (job atrasado)', () => {
  const sabado = Date.UTC(2026, 8, 5) / 86400000; // 2026-09-05
  assert.equal(chaveSemanaSeguinteDeSexta(sabado), '2026-09-07');
});

test('calcularSnapshotSemanaAlvo grava tendencia de volume/financeiro/equipe/produtividade por registro', () => {
  const registros = [
    {
      sup: 'SUP-1', tipologia: 'SP', tomador: 'X',
      previsto: { volume: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100] },
      total: { equipes: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2] },
    },
  ];
  const demandas = { porRegistroEventos: {} };
  // 2026-09-04 (sexta) em epoch de dias -- mesma conta do Task 1, Step 1.
  const hojeEpoch = Date.UTC(2026, 8, 4) / 86400000;
  const snapshot = calcularSnapshotSemanaAlvo(registros, demandas, hojeEpoch);

  assert.equal(snapshot.chaveSemanaAlvo, '2026-09-07');
  const entrada = snapshot.porRegistro['SUP-1||SP'];
  assert.ok(entrada, 'registro SUP-1||SP presente no snapshot');
  assert.equal(typeof entrada.volume.tendencia, 'number');
  assert.equal(typeof entrada.equipe.tendencia, 'number');
  // produtividadeMedia = tendencia.volume / tendencia.equipe quando os dois existem.
  assert.equal(entrada.produtividadeMedia.tendencia, entrada.volume.tendencia / entrada.equipe.tendencia);
});

test('calcularSnapshotSemanaAlvo devolve produtividadeMedia null quando equipe é 0/nula', () => {
  const registros = [
    {
      sup: 'SUP-2', tipologia: 'ST', tomador: 'Y',
      previsto: { volume: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50] },
      total: { equipes: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    },
  ];
  const demandas = { porRegistroEventos: {} };
  const hojeEpoch = Date.UTC(2026, 8, 4) / 86400000;
  const snapshot = calcularSnapshotSemanaAlvo(registros, demandas, hojeEpoch);
  assert.equal(snapshot.porRegistro['SUP-2||ST'].produtividadeMedia.tendencia, null);
});

test('gravarSnapshotNoArquivo cria o arquivo na 1a chamada e mescla na 2a, sem apagar semanas antigas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tendencia-congelada-'));
  const caminho = path.join(dir, 'tendencia-congelada-semanal.json');

  gravarSnapshotNoArquivo(caminho, {
    chaveSemanaAlvo: '2026-08-31', geradoEmIso: '2026-08-28T22:00:00.000Z',
    porRegistro: { 'SUP-1|SP': { volume: { tendencia: 10 } } },
  });
  gravarSnapshotNoArquivo(caminho, {
    chaveSemanaAlvo: '2026-09-07', geradoEmIso: '2026-09-04T22:00:00.000Z',
    porRegistro: { 'SUP-1|SP': { volume: { tendencia: 20 } } },
  });

  const conteudo = JSON.parse(fs.readFileSync(caminho, 'utf8'));
  assert.ok(conteudo['2026-08-31'], 'semana anterior preservada');
  assert.ok(conteudo['2026-09-07'], 'semana nova presente');
  assert.equal(conteudo['2026-09-07'].porRegistro['SUP-1|SP'].volume.tendencia, 20);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('gravarSnapshotNoArquivo SOBRESCREVE a mesma semana-alvo (job rodou 2x no mesmo dia)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tendencia-congelada-'));
  const caminho = path.join(dir, 'tendencia-congelada-semanal.json');
  gravarSnapshotNoArquivo(caminho, { chaveSemanaAlvo: '2026-09-07', geradoEmIso: 'a', porRegistro: { X: { volume: { tendencia: 1 } } } });
  gravarSnapshotNoArquivo(caminho, { chaveSemanaAlvo: '2026-09-07', geradoEmIso: 'b', porRegistro: { X: { volume: { tendencia: 2 } } } });
  const conteudo = JSON.parse(fs.readFileSync(caminho, 'utf8'));
  assert.equal(Object.keys(conteudo).length, 1);
  assert.equal(conteudo['2026-09-07'].porRegistro.X.volume.tendencia, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});
