'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { calcularTendenciaSemanal } = require('../tools/semanal/compute-tendencia-semanal.js');
const { semanasDoMes, diaEpoch } = require('../tools/semanal/compute-semanal.js');

// Julho/2026 começa numa quarta: S1 = 01..05 (5 dias), S2 = 06..12,
// S3 = 13..19, S4 = 20..26, S5 = 27..31 (5 dias). 31 dias em 5 semanas.
const SEMANAS_JULHO = semanasDoMes(2026, 6);
const dia = (d) => diaEpoch(new Date(Date.UTC(2026, 6, d)));

// Previsto de 310 no mês, repartido por dias: 50/70/70/70/50.
const PREVISTO_JULHO = [50, 70, 70, 70, 50];

test('ramo igual: R bate P nas semanas fechadas, e as futuras recebem o proprio Previsto', () => {
  // hoje = 13/07 (1o dia de S3). Fechadas: S1 e S2 (5+7=12 dias).
  // R acumulado 120 = P acumulado 120 -> ramo igual.
  const r = calcularTendenciaSemanal({
    previstoMes: 310,
    semanasPrevisto: PREVISTO_JULHO,
    semanasRealizado: [50, 70, 0, 0, 0],
    semanas: SEMANAS_JULHO,
    hojeEpoch: dia(13),
  });
  assert.strictEqual(r.ramo, 'igual');
  assert.strictEqual(r.semanas[0], 50, 'semana fechada devolve o fato');
  assert.strictEqual(r.semanas[1], 70, 'semana fechada devolve o fato');
  assert.strictEqual(r.semanas[2], 70, 'vigente mantem o P dela');
  assert.strictEqual(r.semanas[3], 70, 'futura mantem o P dela');
  assert.strictEqual(r.semanas[4], 50, 'futura mantem o P dela');
});

test('ramo igual: a semana em curso nunca projeta abaixo do que ja e fato', () => {
  // Mesmo cenario, mas S3 ja realizou 90 (acima do proprio P de 70).
  const r = calcularTendenciaSemanal({
    previstoMes: 310,
    semanasPrevisto: PREVISTO_JULHO,
    semanasRealizado: [50, 70, 90, 0, 0],
    semanas: SEMANAS_JULHO,
    hojeEpoch: dia(13),
  });
  assert.strictEqual(r.ramo, 'igual');
  assert.strictEqual(r.semanas[2], 90, 'vigente nao pode ficar abaixo do Realizado');
});

test('ramo acima: as semanas restantes seguem o ritmo medio das FECHADAS, nao o previsto', () => {
  // hoje = 13/07. Fechadas S1+S2 = 12 dias, R acumulado 180 (P era 120).
  // ritmo = 180/12 = 15 furos/dia.
  // S3 e a vigente: hoje e o 1o dia dela, restam 6 dias -> 0 + 15*6 = 90.
  // S4 (7 dias) -> 105. S5 (5 dias) -> 75.
  const r = calcularTendenciaSemanal({
    previstoMes: 310,
    semanasPrevisto: PREVISTO_JULHO,
    semanasRealizado: [80, 100, 0, 0, 0],
    semanas: SEMANAS_JULHO,
    hojeEpoch: dia(13),
  });
  assert.strictEqual(r.ramo, 'acima');
  assert.strictEqual(r.diagnostico.ritmoPorDia, 15);
  assert.strictEqual(r.semanas[2], 90);
  assert.strictEqual(r.semanas[3], 105);
  assert.strictEqual(r.semanas[4], 75);
});

test('ramo acima: a vigente soma o Realizado parcial ao ritmo dos dias que faltam dela', () => {
  // hoje = 15/07, o 3o dia de S3 (13,14,15 passaram; restam 16..19 = 4 dias).
  // Fechadas continuam S1+S2 = 12 dias, ritmo = 180/12 = 15.
  // S3 = 40 (fato parcial) + 15*4 = 100.
  const r = calcularTendenciaSemanal({
    previstoMes: 310,
    semanasPrevisto: PREVISTO_JULHO,
    semanasRealizado: [80, 100, 40, 0, 0],
    semanas: SEMANAS_JULHO,
    hojeEpoch: dia(15),
  });
  assert.strictEqual(r.ramo, 'acima');
  assert.strictEqual(r.semanas[2], 100);
});

test('ramo abaixo: o saldo do MES e repartido pelos dias que restam', () => {
  // hoje = 13/07. Fechadas S1+S2, R acumulado 60 (P era 120) -> ramo abaixo.
  // saldo = 310 - 60 - 0 = 250. Dias restantes: 6 (S3) + 7 (S4) + 5 (S5) = 18.
  // S3 = 0 + 250*6/18, S4 = 250*7/18, S5 = 250*5/18.
  const r = calcularTendenciaSemanal({
    previstoMes: 310,
    semanasPrevisto: PREVISTO_JULHO,
    semanasRealizado: [20, 40, 0, 0, 0],
    semanas: SEMANAS_JULHO,
    hojeEpoch: dia(13),
  });
  assert.strictEqual(r.ramo, 'abaixo');
  assert.strictEqual(r.diagnostico.saldo, 250);
  assert.strictEqual(r.diagnostico.diasRestantesMes, 18);
  assert.ok(Math.abs(r.semanas[2] - 250 * 6 / 18) < 1e-9);
  assert.ok(Math.abs(r.semanas[3] - 250 * 7 / 18) < 1e-9);
  assert.ok(Math.abs(r.semanas[4] - 250 * 5 / 18) < 1e-9);
  const projetado = r.semanas.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(projetado - 310) < 1e-9, 'compensar significa fechar o mes no plano');
});

test('ramo abaixo com saldo ja coberto pela vigente cai no ritmo, nunca em projecao negativa', () => {
  // Fechadas somam 60 contra 120 previstos (ramo abaixo), mas a vigente ja
  // realizou 300 sozinha: saldo = 310 - 60 - 300 = -50.
  const r = calcularTendenciaSemanal({
    previstoMes: 310,
    semanasPrevisto: PREVISTO_JULHO,
    semanasRealizado: [20, 40, 300, 0, 0],
    semanas: SEMANAS_JULHO,
    hojeEpoch: dia(13),
  });
  assert.strictEqual(r.ramo, 'abaixo');
  assert.ok(r.diagnostico.saldo < 0);
  r.semanas.forEach((v, i) => assert.ok(v >= 0, 'semana ' + i + ' nao pode ser negativa'));
  // ritmo = 60/12 = 5; S4 tem 7 dias -> 35.
  assert.strictEqual(r.semanas[3], 35);
});

test('mes inteiramente no passado nao tem tendencia nenhuma', () => {
  const r = calcularTendenciaSemanal({
    previstoMes: 310,
    semanasPrevisto: PREVISTO_JULHO,
    semanasRealizado: [50, 70, 70, 70, 50],
    semanas: SEMANAS_JULHO,
    hojeEpoch: diaEpoch(new Date(Date.UTC(2026, 7, 10))),
  });
  assert.strictEqual(r.ramo, 'sem-dado');
  assert.strictEqual(r.diagnostico, null);
  assert.deepStrictEqual(r.semanas, [null, null, null, null, null]);
});

test('mes inteiramente no futuro reproduz o Previsto', () => {
  const r = calcularTendenciaSemanal({
    previstoMes: 310,
    semanasPrevisto: PREVISTO_JULHO,
    semanasRealizado: [0, 0, 0, 0, 0],
    semanas: SEMANAS_JULHO,
    hojeEpoch: diaEpoch(new Date(Date.UTC(2026, 5, 10))),
  });
  assert.strictEqual(r.ramo, 'igual');
  assert.deepStrictEqual(r.semanas, PREVISTO_JULHO);
});

test('ultimo dia do mes: nada a projetar, e nenhuma divisao por zero', () => {
  const r = calcularTendenciaSemanal({
    previstoMes: 310,
    semanasPrevisto: PREVISTO_JULHO,
    semanasRealizado: [50, 70, 70, 70, 30],
    semanas: SEMANAS_JULHO,
    hojeEpoch: dia(31),
  });
  assert.strictEqual(r.diagnostico.diasRestantesMes, 0);
  r.semanas.forEach((v, i) => assert.ok(Number.isFinite(v), 'semana ' + i + ' precisa ser finita'));
});

test('previsto acumulado zero: R zero e igual, R positivo e acima', () => {
  const semanasFuturas = { previstoMes: 0, semanasPrevisto: [0, 0, 0, 0, 0], semanas: SEMANAS_JULHO, hojeEpoch: dia(13) };
  const zerado = calcularTendenciaSemanal(Object.assign({ semanasRealizado: [0, 0, 0, 0, 0] }, semanasFuturas));
  assert.strictEqual(zerado.ramo, 'igual');
  const positivo = calcularTendenciaSemanal(Object.assign({ semanasRealizado: [5, 5, 0, 0, 0] }, semanasFuturas));
  assert.strictEqual(positivo.ramo, 'acima');
});

test('a tolerancia de 1% decide o ramo igual', () => {
  const base = { previstoMes: 310, semanasPrevisto: PREVISTO_JULHO, semanas: SEMANAS_JULHO, hojeEpoch: dia(13) };
  // P acumulado = 120; 1% = 1,2.
  const dentro = calcularTendenciaSemanal(Object.assign({ semanasRealizado: [50, 71, 0, 0, 0] }, base));
  assert.strictEqual(dentro.ramo, 'igual', '121 contra 120 esta dentro de 1%');
  const fora = calcularTendenciaSemanal(Object.assign({ semanasRealizado: [50, 72, 0, 0, 0] }, base));
  assert.strictEqual(fora.ramo, 'acima', '122 contra 120 passa de 1%');
});

test('sem semanas, sem previsto ou sem hoje devolve sem-dado em vez de chutar', () => {
  const ok = { previstoMes: 310, semanasPrevisto: PREVISTO_JULHO, semanasRealizado: [0, 0, 0, 0, 0], semanas: SEMANAS_JULHO, hojeEpoch: dia(13) };
  assert.strictEqual(calcularTendenciaSemanal(Object.assign({}, ok, { previstoMes: null })).ramo, 'sem-dado');
  assert.strictEqual(calcularTendenciaSemanal(Object.assign({}, ok, { hojeEpoch: undefined })).ramo, 'sem-dado');
  assert.strictEqual(calcularTendenciaSemanal(Object.assign({}, ok, { semanas: SEMANAS_JULHO.slice(0, 3) })).ramo, 'sem-dado');
});

test('diagnostico expoe o que o alerta precisa: previsto e tendencia A PARTIR DE HOJE', () => {
  const r = calcularTendenciaSemanal({
    previstoMes: 310,
    semanasPrevisto: PREVISTO_JULHO,
    semanasRealizado: [80, 100, 0, 0, 0],
    semanas: SEMANAS_JULHO,
    hojeEpoch: dia(13),
  });
  assert.strictEqual(r.diagnostico.semanasFechadas, 2);
  assert.strictEqual(r.diagnostico.indiceVigente, 2);
  assert.strictEqual(r.diagnostico.realizadoAcumulado, 180);
  assert.strictEqual(r.diagnostico.previstoAcumulado, 120);
  // Hoje e o 1o dia de S3 (7 dias, restam 6): da S3 entra 70*6/7 = 60, nao os
  // 70 inteiros. Antes da correcao de 2026-08-04 dava 190 (S3+S4+S5 inteiras).
  assert.ok(Math.abs(r.diagnostico.previstoAPartirDeHoje - (70 * 6 / 7 + 70 + 50)) < 1e-9, 'S3 entra so pela fatia futura');
  // Como S3 ainda nao realizou nada, a projecao dela e inteira: 90+105+75.
  assert.strictEqual(r.diagnostico.tendenciaAPartirDeHoje, 270);
});

test('o realizado JA ENTREGUE da semana em curso nao entra na tendencia a partir de hoje', () => {
  // hoje = 19/07, ULTIMO dia de S3 (13..19): nao resta dia nenhum dela.
  // Fechadas S1+S2 = 180 contra 120 previstos -> ramo acima, ritmo = 15/dia.
  // S3 ja realizou 200 sozinha. A projecao de S3 e 200 + 15*0 = 200, mas os
  // 200 sao fato consumado -- a parte projetada dela e ZERO.
  const r = calcularTendenciaSemanal({
    previstoMes: 310,
    semanasPrevisto: PREVISTO_JULHO,
    semanasRealizado: [80, 100, 200, 0, 0],
    semanas: SEMANAS_JULHO,
    hojeEpoch: dia(19),
  });
  assert.strictEqual(r.ramo, 'acima');
  assert.strictEqual(r.diagnostico.indiceVigente, 2);
  assert.strictEqual(r.semanas[2], 200, 'a celula da vigente continua mostrando o fato');
  // S4 (7 dias) = 105, S5 (5 dias) = 75. Nada de S3.
  assert.strictEqual(r.diagnostico.tendenciaAPartirDeHoje, 180, 'so S4+S5 sao projecao');
  assert.strictEqual(r.diagnostico.previstoAPartirDeHoje, 120, 'S3 nao tem dia restante: 0 + 70 + 50');
  // O excedente que o Alerta A cobra passa a ser 180-120 = 60, e nao os 140
  // que a versao anterior cobrava (270-190) somando furos ja entregues.
  assert.strictEqual(r.diagnostico.tendenciaAPartirDeHoje - r.diagnostico.previstoAPartirDeHoje, 60);
});

test('mes inteiramente no futuro: os dois campos sao o mes inteiro, sem vigente a ratear', () => {
  const r = calcularTendenciaSemanal({
    previstoMes: 310,
    semanasPrevisto: PREVISTO_JULHO,
    semanasRealizado: [0, 0, 0, 0, 0],
    semanas: SEMANAS_JULHO,
    hojeEpoch: diaEpoch(new Date(Date.UTC(2026, 5, 10))),
  });
  assert.strictEqual(r.diagnostico.indiceVigente, -1);
  assert.strictEqual(r.diagnostico.previstoAPartirDeHoje, 310);
  assert.strictEqual(r.diagnostico.tendenciaAPartirDeHoje, 310);
});
