'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { calcularAcumulado, calcularEscalaEixo } = require('../tools/semanal/compute-grafico-semanal.js');

test('calcularAcumulado soma corrida simples', () => {
  assert.deepStrictEqual(calcularAcumulado([10, 20, 30]), [10, 30, 60]);
});

test('calcularAcumulado com semana 0 continua acumulando (0 é dado real, não ausência)', () => {
  assert.deepStrictEqual(calcularAcumulado([0, 5, 0, 5]), [0, 5, 5, 10]);
});

test('calcularAcumulado: null no início fica null até a primeira semana com dado real -- não é 0', () => {
  assert.deepStrictEqual(calcularAcumulado([null, null, 10, 20]), [null, null, 10, 30]);
});

test('calcularAcumulado: null no meio não reseta a soma corrida -- carrega o último acumulado real adiante', () => {
  assert.deepStrictEqual(calcularAcumulado([10, null, 20]), [10, 10, 30]);
});

test('calcularAcumulado: tudo null continua null em toda semana (nenhum dado real em lugar nenhum)', () => {
  assert.deepStrictEqual(calcularAcumulado([null, null, null]), [null, null, null]);
});

test('calcularAcumulado: lista vazia devolve lista vazia', () => {
  assert.deepStrictEqual(calcularAcumulado([]), []);
});

test('calcularAcumulado: undefined/null como argumento não quebra, devolve lista vazia', () => {
  assert.deepStrictEqual(calcularAcumulado(null), []);
  assert.deepStrictEqual(calcularAcumulado(undefined), []);
});

// --- calcularEscalaEixo (mesma função do orçamento, portada sem mudança) --

test('calcularEscalaEixo: valor 0 ou negativo devolve o fallback mínimo (max:1, passo:0.25)', () => {
  assert.deepStrictEqual(calcularEscalaEixo(0), { max: 1, passo: 0.25 });
  assert.deepStrictEqual(calcularEscalaEixo(-5), { max: 1, passo: 0.25 });
  assert.deepStrictEqual(calcularEscalaEixo(null), { max: 1, passo: 0.25 });
});

test('calcularEscalaEixo: teto sempre >= valorMax (nunca corta a barra/linha mais alta)', () => {
  for (const v of [1, 7, 42, 99, 100, 517, 1000, 12345, 999999]) {
    const escala = calcularEscalaEixo(v);
    assert.ok(escala.max >= v, `valorMax=${v}: escala.max=${escala.max} deveria ser >= ${v}`);
  }
});

test('calcularEscalaEixo: max é sempre passo * 4 ticks (GRAFICO_NUM_TICKS)', () => {
  const escala = calcularEscalaEixo(517);
  assert.strictEqual(escala.max, escala.passo * 4);
});

test('calcularEscalaEixo: degraus intermediários evitam sobra grande -- 517 não pula direto pro degrau 10', () => {
  // passoBruto = 517/4 ~= 129.25, magnitude=100, normalizado=1.2925 -> degrau 1.5
  // (não 2, nem pula pra 2.5) -- passo=150, max=600. Bem mais justo que
  // pular direto pra passo=250 (max=1000, quase o dobro do necessário).
  const escala = calcularEscalaEixo(517);
  assert.strictEqual(escala.passo, 150);
  assert.strictEqual(escala.max, 600);
});
