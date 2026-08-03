'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  calcularAcumulado, calcularEscalaEixo,
  cortarAcumuladoNasElapsadas, calcularAcumuladoAposElapsadas,
} = require('../tools/semanal/compute-grafico-semanal.js');

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

// --- Recorte das curvas acumuladas (2026-08-03) ----------------------------
// Pedido do dono do projeto: no painel Acumulado, o Realizado só vai até onde
// de fato foi realizado, e a Tendência nasce desse ponto em vez de correr por
// cima do Realizado desde a primeira semana.

test('o acumulado do Realizado para na semana em curso -- não segue reto até o fim do mês', () => {
  // semanasRealizado traz 0 nas semanas futuras de propósito ("nada aconteceu
  // ainda", ver calcularSeriesSemanaisDimensao) -- é justamente esse 0 que
  // fazia a linha continuar horizontal, parecendo "o total parou de crescer".
  const acumulado = calcularAcumulado([10, 20, 0, 0, 0]);
  assert.deepStrictEqual(acumulado, [10, 30, 30, 30, 30], 'pré-condição: sem o corte a linha é flat até o fim');
  assert.deepStrictEqual(
    cortarAcumuladoNasElapsadas(acumulado, 2),
    [10, 30, null, null, null],
  );
});

test('o corte usa o CALENDÁRIO, não os valores -- semana passada que fechou em 0 continua na linha', () => {
  // Este é o caso que a heurística do orçamento (ultimoIndiceComDado +
  // removerZerosFinaisNaoReportados) erraria: lá um 0 no fim da série é
  // indistinguível de "não reportado". Aqui a semana 2 fechou mesmo em 0
  // furos, e ela É passado.
  assert.deepStrictEqual(
    cortarAcumuladoNasElapsadas(calcularAcumulado([10, 20, 0, 0, 0]), 3),
    [10, 30, 30, null, null],
  );
});

test('a Tendência acumulada nasce exatamente onde o Realizado parou, e só sobe depois da semana em curso', () => {
  const acumuladoRealizado = calcularAcumulado([10, 20, 0, 0, 0]); // [10,30,30,30,30]
  // Série completa da Tendência: as elapsadas repetem o Realizado (ver
  // calcularTendenciaSemanal), as futuras trazem a projeção.
  const tendenciaCompleta = [10, 20, 25, 25, 25];

  const curva = calcularAcumuladoAposElapsadas(tendenciaCompleta, acumuladoRealizado, 2);

  assert.deepStrictEqual(curva.slice(0, 1), [null], 'nada de Tendência antes do ponto de junção');
  assert.strictEqual(curva[1], 30, 'o ponto de junção é a última semana elapsada, no valor acumulado do Realizado');
  assert.deepStrictEqual(curva, [null, 30, 55, 80, 105]);
});

test('o fim da Tendência acumulada continua batendo com o Fechamento da Tabela Semanal', () => {
  // O invariante que a revisão de 2026-08-02 já tinha travado: o ponto final
  // desta curva é o projetado do mês inteiro, o MESMO número que a coluna
  // Total mostra (fecharMes sobre a série completa). Recortar o começo da
  // linha não pode mexer nisso -- e não mexe, porque as semanas elapsadas da
  // série completa são o próprio Realizado, então herdar o acumulado do
  // Realizado no ponto de junção soma exatamente a mesma coisa.
  const semanasRealizado = [10, 20, 0, 0, 0];
  const tendenciaCompleta = [10, 20, 25, 25, 25];
  const totalCompleto = tendenciaCompleta.reduce((a, b) => a + b, 0);

  const curva = calcularAcumuladoAposElapsadas(tendenciaCompleta, calcularAcumulado(semanasRealizado), 2);

  assert.strictEqual(curva[curva.length - 1], totalCompleto);
});

test('mês sem nenhuma semana elapsada: a Tendência acumula sozinha desde a primeira semana', () => {
  // Mês inteiramente futuro -- não há Realizado de onde partir, então a curva
  // é o acumulado usual, sem ponto de junção nenhum.
  assert.deepStrictEqual(
    calcularAcumuladoAposElapsadas([25, 25, 25, 25], [null, null, null, null], 0),
    [25, 50, 75, 100],
  );
});
