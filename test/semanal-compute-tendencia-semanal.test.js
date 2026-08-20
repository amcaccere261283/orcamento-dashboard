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

// --- Ramo/diagnóstico: continuam comparando Realizado x Previsto (P), sem
// mudança nenhuma -- é a aba Alertas que consome os dois (inclusive
// realizadoVigente, pro alerta de movimentação de equipe, 2026-08-17). A
// curva exibida (r.semanas) NÃO depende mais do ramo escolhido aqui, ver o
// segundo bloco de testes abaixo. -------------------------------------------

test('ramo igual: R bate P nas semanas fechadas', () => {
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
});

test('ramo acima: ritmo sai das semanas FECHADAS, e realizadoVigente vai pro diagnostico', () => {
  // hoje = 13/07. Fechadas S1+S2 = 12 dias, R acumulado 180 (P era 120).
  // ritmo = 180/12 = 15 furos/dia.
  const r = calcularTendenciaSemanal({
    previstoMes: 310,
    semanasPrevisto: PREVISTO_JULHO,
    semanasRealizado: [80, 100, 0, 0, 0],
    semanas: SEMANAS_JULHO,
    hojeEpoch: dia(13),
  });
  assert.strictEqual(r.ramo, 'acima');
  assert.strictEqual(r.diagnostico.ritmoPorDia, 15);
  assert.strictEqual(r.diagnostico.realizadoVigente, 0);
});

test('ramo abaixo: o diagnostico.saldo (baseado no Previsto) reparte o mes inteiro', () => {
  // hoje = 13/07. Fechadas S1+S2, R acumulado 60 (P era 120) -> ramo abaixo.
  const r = calcularTendenciaSemanal({
    previstoMes: 310,
    semanasPrevisto: PREVISTO_JULHO,
    semanasRealizado: [20, 40, 0, 0, 0],
    semanas: SEMANAS_JULHO,
    hojeEpoch: dia(13),
  });
  assert.strictEqual(r.ramo, 'abaixo');
  assert.strictEqual(r.diagnostico.saldo, 250, 'saldo = 310 - 60 - 0, so pro diagnostico/Alertas');
  assert.strictEqual(r.diagnostico.diasRestantesMes, 18);
});

test('mes inteiramente no passado nao tem tendencia nenhuma', () => {
  const r = calcularTendenciaSemanal({
    previstoMes: 310,
    tendenciaMes: 310,
    semanasPrevisto: PREVISTO_JULHO,
    semanasRealizado: [50, 70, 70, 70, 50],
    semanas: SEMANAS_JULHO,
    hojeEpoch: diaEpoch(new Date(Date.UTC(2026, 7, 10))),
  });
  assert.strictEqual(r.ramo, 'sem-dado');
  assert.strictEqual(r.diagnostico, null);
  assert.deepStrictEqual(r.semanas, [null, null, null, null, null]);
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

test('sem semanas, sem previsto ou sem hoje devolve sem-dado em vez de chutar -- mesmo com T preenchido', () => {
  const ok = { previstoMes: 310, tendenciaMes: 999, semanasPrevisto: PREVISTO_JULHO, semanasRealizado: [0, 0, 0, 0, 0], semanas: SEMANAS_JULHO, hojeEpoch: dia(13) };
  assert.strictEqual(calcularTendenciaSemanal(Object.assign({}, ok, { previstoMes: null })).ramo, 'sem-dado', 'P ausente ainda barra tudo, T nao substitui esse guard');
  assert.strictEqual(calcularTendenciaSemanal(Object.assign({}, ok, { hojeEpoch: undefined })).ramo, 'sem-dado');
  assert.strictEqual(calcularTendenciaSemanal(Object.assign({}, ok, { semanas: SEMANAS_JULHO.slice(0, 3) })).ramo, 'sem-dado');
});

test('diagnostico expoe realizadoVigente mesmo quando T decide a curva', () => {
  const r = calcularTendenciaSemanal({
    previstoMes: 310,
    tendenciaMes: 310,
    semanasPrevisto: PREVISTO_JULHO,
    semanasRealizado: [80, 100, 0, 0, 0],
    semanas: SEMANAS_JULHO,
    hojeEpoch: dia(13),
  });
  assert.strictEqual(r.diagnostico.semanasFechadas, 2);
  assert.strictEqual(r.diagnostico.indiceVigente, 2);
  assert.strictEqual(r.diagnostico.realizadoAcumulado, 180);
  assert.strictEqual(r.diagnostico.previstoAcumulado, 120);
  assert.strictEqual(r.diagnostico.realizadoVigente, 0);
});

test('mes inteiramente no futuro: realizadoVigente e 0, sem vigente a medir', () => {
  const r = calcularTendenciaSemanal({
    previstoMes: 310,
    semanasPrevisto: PREVISTO_JULHO,
    semanasRealizado: [0, 0, 0, 0, 0],
    semanas: SEMANAS_JULHO,
    hojeEpoch: diaEpoch(new Date(Date.UTC(2026, 5, 10))),
  });
  assert.strictEqual(r.diagnostico.indiceVigente, -1);
  assert.strictEqual(r.diagnostico.realizadoVigente, 0);
});

// --- A curva exibida (r.semanas): ancorada no T do orçamento (tendenciaMes),
// nunca mais no algoritmo automatico por ramo. Ausencia de T conta como
// zero -- "nao executar nada naquele local", pedido do dono do projeto em
// 2026-08-20 (confirmado mesmo sabendo que isso esvazia a projecao pra quem
// nao preenche T -- e o comportamento pretendido, nao um efeito colateral).
// --------------------------------------------------------------------------

test('T ausente: semanas fechadas mostram o fato, e a vigente/futuras nao projetam nada alem do que ja e fato', () => {
  // hoje = 15/07, 3o dia de S3 (13,14,15 passaram; restam 16..19 = 4 dias).
  const r = calcularTendenciaSemanal({
    previstoMes: 310,
    // tendenciaMes ausente de proposito
    semanasPrevisto: PREVISTO_JULHO,
    semanasRealizado: [50, 70, 20, 0, 0],
    semanas: SEMANAS_JULHO,
    hojeEpoch: dia(15),
  });
  assert.deepStrictEqual(r.semanas, [50, 70, 20, 0, 0], 'S1/S2 fato; S3 so o que ja e fato (20); S4/S5 zero, sem ritmo nem Previsto de reserva');
});

test('T presente: o saldo pra fechar o mes no T (nao no Previsto) e repartido pelos dias que restam', () => {
  // hoje = 13/07 (1o dia de S3). Fechadas S1+S2, R acumulado 60.
  // T = 400 (bem diferente do Previsto, 310) -> saldo = 400-60-0 = 340,
  // repartido pelos 18 dias restantes (6 de S3 + 7 de S4 + 5 de S5).
  const r = calcularTendenciaSemanal({
    previstoMes: 310,
    tendenciaMes: 400,
    semanasPrevisto: PREVISTO_JULHO,
    semanasRealizado: [20, 40, 0, 0, 0],
    semanas: SEMANAS_JULHO,
    hojeEpoch: dia(13),
  });
  assert.strictEqual(r.semanas[0], 20);
  assert.strictEqual(r.semanas[1], 40);
  assert.ok(Math.abs(r.semanas[2] - 340 * 6 / 18) < 1e-9);
  assert.ok(Math.abs(r.semanas[3] - 340 * 7 / 18) < 1e-9);
  assert.ok(Math.abs(r.semanas[4] - 340 * 5 / 18) < 1e-9);
  const projetado = r.semanas.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(projetado - 400) < 1e-9, 'o mes fecha no T (400), nao no Previsto (310)');
});

test('T ja superado pelo Realizado: fica no que ja foi feito, sem extrapolar ritmo (diferente do automatico antigo)', () => {
  // Fechadas somam 60, mas a vigente ja realizou 300 sozinha, e T = 310:
  // saldo = 310 - 60 - 300 = -50 -> max(0, ...) = 0. Nada a mais e projetado.
  const r = calcularTendenciaSemanal({
    previstoMes: 310,
    tendenciaMes: 310,
    semanasPrevisto: PREVISTO_JULHO,
    semanasRealizado: [20, 40, 300, 0, 0],
    semanas: SEMANAS_JULHO,
    hojeEpoch: dia(13),
  });
  assert.deepStrictEqual(r.semanas, [20, 40, 300, 0, 0], 'S4/S5 ficam em zero, nunca extrapolam o ritmo ja visto');
  r.semanas.forEach((v, i) => assert.ok(v >= 0, 'semana ' + i + ' nao pode ser negativa'));
});

test('mes inteiramente no futuro, T ausente: a Tendencia inteira fica zero (nao reproduz mais o Previsto)', () => {
  const r = calcularTendenciaSemanal({
    previstoMes: 310,
    semanasPrevisto: PREVISTO_JULHO,
    semanasRealizado: [0, 0, 0, 0, 0],
    semanas: SEMANAS_JULHO,
    hojeEpoch: diaEpoch(new Date(Date.UTC(2026, 5, 10))),
  });
  assert.strictEqual(r.ramo, 'igual', 'diagnostico continua igual (R=P=0), so a curva exibida muda de fonte');
  assert.deepStrictEqual(r.semanas, [0, 0, 0, 0, 0]);
});

test('mes inteiramente no futuro, T presente: reparte o T inteiro pelas semanas, proporcional aos dias', () => {
  const r = calcularTendenciaSemanal({
    previstoMes: 310,
    tendenciaMes: 310,
    semanasPrevisto: PREVISTO_JULHO,
    semanasRealizado: [0, 0, 0, 0, 0],
    semanas: SEMANAS_JULHO,
    hojeEpoch: diaEpoch(new Date(Date.UTC(2026, 5, 10))),
  });
  // T=310 repartido pelos 31 dias do mes (5,7,7,7,5) da os mesmos numeros
  // "redondos" do Previsto -- coincidencia de fixture (T = P aqui), nao uma
  // regra: o teste acima (T ausente) prova que a fonte agora e outra.
  assert.deepStrictEqual(r.semanas, [50, 70, 70, 70, 50]);
});

test('ultimo dia do mes: nada a projetar, e nenhuma divisao por zero', () => {
  const r = calcularTendenciaSemanal({
    previstoMes: 310,
    tendenciaMes: 310,
    semanasPrevisto: PREVISTO_JULHO,
    semanasRealizado: [50, 70, 70, 70, 30],
    semanas: SEMANAS_JULHO,
    hojeEpoch: dia(31),
  });
  assert.strictEqual(r.diagnostico.diasRestantesMes, 0);
  r.semanas.forEach((v, i) => assert.ok(Number.isFinite(v), 'semana ' + i + ' precisa ser finita'));
  assert.strictEqual(r.semanas[4], 30, 'sem dia restante, a vigente fecha no proprio fato');
});

test('a semana vigente nunca fica abaixo do que ja e fato, T presente ou ausente', () => {
  const semRealizadoAlto = { previstoMes: 310, semanasPrevisto: PREVISTO_JULHO, semanas: SEMANAS_JULHO, hojeEpoch: dia(13) };
  const semT = calcularTendenciaSemanal(Object.assign({ semanasRealizado: [20, 40, 90, 0, 0] }, semRealizadoAlto));
  assert.strictEqual(semT.semanas[2], 90, 'sem T, a vigente e so o proprio fato -- mas nunca menos que ele');
  const comT = calcularTendenciaSemanal(Object.assign({ tendenciaMes: 500, semanasRealizado: [20, 40, 90, 0, 0] }, semRealizadoAlto));
  assert.ok(comT.semanas[2] >= 90, 'com T, a vigente soma o fato (90) com a fatia do saldo -- nunca abaixo do fato');
});
