'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { avaliarAlertaTendencia, diasPremissaRestantes, ALERTA_ROTULO } = require('../tools/semanal/compute-alertas-tendencia.js');
const { DIAS_PREMISSA_MES } = require('../tools/comum/calculo-equipes.js');

// Julho (mesIdx 6): 31 dias de calendario, 30 dias de premissa.
// previstoAPartirDeHoje/tendenciaAPartirDeHoje medem so o que ainda NAO
// aconteceu (a semana em curso entra pela fatia posterior a hoje) -- ver
// compute-tendencia-semanal.js.
const DIAG_ACIMA = {
  realizadoAcumulado: 180, previstoAcumulado: 120, semanasFechadas: 2, indiceVigente: 2,
  saldo: 130, ritmoPorDia: 15, diasRestantesMes: 18, previstoAPartirDeHoje: 190, tendenciaAPartirDeHoje: 270,
};
const DIAG_ABAIXO = {
  realizadoAcumulado: 60, previstoAcumulado: 120, semanasFechadas: 2, indiceVigente: 2,
  saldo: 250, ritmoPorDia: 5, diasRestantesMes: 18, previstoAPartirDeHoje: 190, tendenciaAPartirDeHoje: 250,
};
const BASE = { mesIdx: 6, diasDoMes: 31 };

test('ramo igual e ramo sem-dado nao produzem alerta', () => {
  assert.strictEqual(avaliarAlertaTendencia(Object.assign({ ramo: 'igual', diagnostico: DIAG_ACIMA }, BASE)), null);
  assert.strictEqual(avaliarAlertaTendencia(Object.assign({ ramo: 'sem-dado', diagnostico: null }, BASE)), null);
});

test('R>P sem carteira que sustente o ritmo dispara "avaliar equipe e demanda"', () => {
  // excedente = 270 - 190 = 80. Saldo de demandas 30 < 80 -> alerta.
  const a = avaliarAlertaTendencia(Object.assign({ ramo: 'acima', diagnostico: DIAG_ACIMA, saldoDemandas: 30 }, BASE));
  assert.strictEqual(a.tipo, 'demanda');
  assert.strictEqual(a.status, 'alerta');
  assert.strictEqual(a.excedenteProjetado, 80);
  assert.strictEqual(a.saldoDemandas, 30);
});

test('R>P com carteira suficiente nao alerta', () => {
  const a = avaliarAlertaTendencia(Object.assign({ ramo: 'acima', diagnostico: DIAG_ACIMA, saldoDemandas: 200 }, BASE));
  assert.strictEqual(a, null);
});

test('R>P sem demandas carregadas vira sem-dado, nunca alerta nem silencio', () => {
  const a = avaliarAlertaTendencia(Object.assign({ ramo: 'acima', diagnostico: DIAG_ACIMA, saldoDemandas: null }, BASE));
  assert.strictEqual(a.tipo, 'demanda');
  assert.strictEqual(a.status, 'sem-dado');
});

test('R<P que exige mais produtividade do que a premissa dispara o alerta de equipes', () => {
  // dias de premissa restantes = 30 * 18/31 = 17,419...
  // exigida = 250 / (2 * 17,419...) = 7,177...  contra esperada 1,2 -> alerta.
  const a = avaliarAlertaTendencia(Object.assign({
    ramo: 'abaixo', diagnostico: DIAG_ABAIXO, equipesPrevistas: 2, produtividadeEsperada: 1.2,
  }, BASE));
  assert.strictEqual(a.tipo, 'produtividade');
  assert.strictEqual(a.status, 'alerta');
  assert.ok(a.produtividadeExigida > a.produtividadeEsperada);
  const esperado = 250 / (2 * DIAS_PREMISSA_MES[6] * 18 / 31);
  assert.ok(Math.abs(a.produtividadeExigida - esperado) < 1e-9);
});

test('R<P que cabe na produtividade prevista nao alerta', () => {
  const a = avaliarAlertaTendencia(Object.assign({
    ramo: 'abaixo', diagnostico: DIAG_ABAIXO, equipesPrevistas: 2, produtividadeEsperada: 50,
  }, BASE));
  assert.strictEqual(a, null);
});

test('R<P sem equipes ou sem premissa de produtividade vira sem-dado', () => {
  const semEquipes = avaliarAlertaTendencia(Object.assign({ ramo: 'abaixo', diagnostico: DIAG_ABAIXO, equipesPrevistas: null, produtividadeEsperada: 1.2 }, BASE));
  assert.strictEqual(semEquipes.status, 'sem-dado');
  const semProd = avaliarAlertaTendencia(Object.assign({ ramo: 'abaixo', diagnostico: DIAG_ABAIXO, equipesPrevistas: 2, produtividadeEsperada: null }, BASE));
  assert.strictEqual(semProd.status, 'sem-dado');
});

test('R<P com saldo ja zerado nao tem o que cobrar de ninguem', () => {
  const diag = Object.assign({}, DIAG_ABAIXO, { saldo: -10 });
  const a = avaliarAlertaTendencia(Object.assign({ ramo: 'abaixo', diagnostico: diag, equipesPrevistas: 2, produtividadeEsperada: 1.2 }, BASE));
  assert.strictEqual(a, null);
});

test('sem dias restantes no mes nao ha produtividade a exigir', () => {
  const diag = Object.assign({}, DIAG_ABAIXO, { diasRestantesMes: 0 });
  const a = avaliarAlertaTendencia(Object.assign({ ramo: 'abaixo', diagnostico: diag, equipesPrevistas: 2, produtividadeEsperada: 1.2 }, BASE));
  assert.strictEqual(a.status, 'sem-dado');
});

test('dias de premissa restantes recortam DIAS_PREMISSA_MES pela fracao do mes que falta', () => {
  assert.strictEqual(diasPremissaRestantes(6, 31, 31), DIAS_PREMISSA_MES[6]);
  assert.strictEqual(diasPremissaRestantes(6, 0, 31), 0);
  assert.strictEqual(diasPremissaRestantes(0, 31, 31), DIAS_PREMISSA_MES[0], 'janeiro usa 15, nao 30');
});

test('os dois rotulos de tela existem', () => {
  assert.strictEqual(typeof ALERTA_ROTULO.demanda, 'string');
  assert.strictEqual(typeof ALERTA_ROTULO.produtividade, 'string');
});
