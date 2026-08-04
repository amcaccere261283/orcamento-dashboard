# Tendência semanal por ramo e dois alertas novos — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na página de Planejamento Semanal, projetar a Tendência por três ramos explícitos (`R = P`, `R > P`, `R < P`), suprimi-la em período já realizado, e acrescentar dois alertas de diagnóstico na aba Alertas — mais tirar as casas decimais dos valores financeiros.

**Architecture:** Um módulo puro novo (`compute-tendencia-semanal.js`) passa a ser a única fonte da projeção: ele decide o ramo, projeta as semanas e devolve, no mesmo retorno, o diagnóstico numérico que alimenta os alertas. `calcularSeriesSemanaisDimensao` (que já é fonte única de Tabela, Gráficos, Alertas e Consolidado) passa a chamá-lo e a repassar `ramo`/`diagnostico`. Um segundo módulo puro (`compute-alertas-tendencia.js`) transforma esse diagnóstico em alerta ou em "sem dado", e um módulo de render (`render-alertas-tendencia.js`) desenha o bloco novo da aba Alertas.

**Tech Stack:** Node puro, sem dependências. `node --test test/*.test.js`. Módulos escritos em `var`/`function` porque o mesmo arquivo roda no Node (testes) e embrulhado numa IIFE no navegador (`tools/comum/browser-bundle.js`).

**Spec:** `docs/superpowers/specs/2026-08-04-semanal-tendencia-regras-e-alertas-design.md`

## Global Constraints

- Repositório: `orcamento-dashboard`. Branch: `semanal-tendencia-ramos` (já existe, já tem o commit do spec).
- **Não tocar no dashboard de orçamento.** `test/orcamento-html-inalterado.test.js` prende o HTML dele byte a byte e tem que continuar passando.
- Módulos que entram no bundle do navegador usam `var` e `function`, nunca `const`/arrow no corpo. A linha de import segue a forma exata que `transformaModulo` reconhece: `const { X, Y } = require('./arquivo.js');`.
- **A ordem de `BUNDLE_ARQUIVOS` (`tools/semanal/render-semanal.js`) é o contrato de dependência.** Não há resolvedor: um módulo só pode aparecer depois de tudo que ele consome via `require('./...')`. Um `require('../comum/...')` é REMOVIDO pelo bundler — os nomes chegam como global pelo `<script>` de `fonteParaCliente()`.
- Tolerância do ramo "igual": `0,01` (1% de `previstoAcumulado`).
- Dimensão dos alertas novos: **só `volume`**.
- Casas decimais: `financeiro` → 0. `equipes` continua 2. `volume` não muda.
- Toda tarefa termina com `node --test test/*.test.js` inteiro passando, não só o teste novo.
- Build da página: `ORCAMENTO_SENHA='...' node tools/semanal/build-dashboard.js`. A senha é env var e **nunca** entra em arquivo do repositório.

---

### Task 1: Módulo `compute-tendencia-semanal.js` com os três ramos

**Files:**
- Create: `tools/semanal/compute-tendencia-semanal.js`
- Test: `test/semanal-compute-tendencia-semanal.test.js`

**Interfaces:**
- Consumes: `diasNaSemana` de `./compute-semanal.js` (já exportada).
- Produces: `calcularTendenciaSemanal(entrada) -> { semanas, ramo, diagnostico }`, onde `entrada` é `{ previstoMes, semanasPrevisto, semanasRealizado, semanas, hojeEpoch }`, `ramo` é `'igual' | 'acima' | 'abaixo' | 'sem-dado'`, e `diagnostico` é `{ realizadoAcumulado, previstoAcumulado, semanasFechadas, indiceVigente, saldo, ritmoPorDia, diasRestantesMes, previstoRestante, tendenciaRestante }` (ou `null` quando `ramo === 'sem-dado'`). `semanas` do retorno é a versão COMPLETA: traz o Realizado nas semanas já encerradas, não `null`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `test/semanal-compute-tendencia-semanal.test.js`:

```js
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

test('diagnostico expoe o que o alerta precisa: restante previsto e restante projetado', () => {
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
  assert.strictEqual(r.diagnostico.previstoRestante, 190, 'P de S3+S4+S5');
  assert.strictEqual(r.diagnostico.tendenciaRestante, 270, 'T de S3+S4+S5 = 90+105+75');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-compute-tendencia-semanal.test.js`
Expected: FAIL — `Cannot find module '../tools/semanal/compute-tendencia-semanal.js'`.

- [ ] **Step 3: Escrever o módulo**

Criar `tools/semanal/compute-tendencia-semanal.js`:

```js
'use strict';
const { diasNaSemana } = require('./compute-semanal.js');

// Tendência semanal por RAMO -- pedido do dono do projeto em 2026-08-04, ver
// docs/superpowers/specs/2026-08-04-semanal-tendencia-regras-e-alertas-design.md.
// Substitui a calcularTendenciaSemanal que morava em render-aba-semanal.js e
// tinha só DOIS ramos (saldo positivo / saldo não positivo).
//
// A projeção e o DIAGNÓSTICO saem da mesma função de propósito: os dois
// alertas novos da aba Alertas precisam saber em que ramo o grupo caiu e com
// que números, e recalcular isso lá abriria a porta para a Tabela projetar por
// um ramo enquanto o alerta acusa outro, sem nada quebrar.

// Igualdade exata em ponto flutuante nunca acontece -- sem tolerância, o ramo
// "mantém o P" seria código morto. 1% do Previsto acumulado.
var TOLERANCIA_IGUAL = 0.01;

// 'igual' quando a diferença cabe na tolerância; isso inclui o caso
// previsto=0 e realizado=0 (mês inteiramente no futuro, ou plano zerado).
// previsto=0 com realizado>0 cai em 'acima', que é a leitura certa: produziu
// o que não estava planejado.
function escolherRamo(realizadoAcumulado, previstoAcumulado) {
  var diferenca = realizadoAcumulado - previstoAcumulado;
  if (Math.abs(diferenca) <= Math.abs(previstoAcumulado) * TOLERANCIA_IGUAL) return 'igual';
  return diferenca > 0 ? 'acima' : 'abaixo';
}

function numero(v) { return (v === null || v === undefined) ? 0 : v; }

function calcularTendenciaSemanal(entrada) {
  var e = entrada || {};
  var semanasRealizado = e.semanasRealizado || [];
  var semanasPrevisto = e.semanasPrevisto || [];
  var semanas = e.semanas;
  var previstoMes = e.previstoMes;
  var hojeEpoch = e.hojeEpoch;
  var numSemanas = semanasRealizado.length;

  var nulos = [];
  for (var n = 0; n < numSemanas; n++) nulos.push(null);
  var semDado = { semanas: nulos, ramo: 'sem-dado', diagnostico: null };

  if (previstoMes === null || previstoMes === undefined) return semDado;
  if (typeof hojeEpoch !== 'number') return semDado;
  if (!Array.isArray(semanas) || semanas.length !== numSemanas || numSemanas === 0) return semDado;

  // Regra 2.1: mês inteiramente no passado não tem futuro a projetar, e a
  // Tendência ali só repetiria o Realizado -- que é exatamente a duplicação
  // que o pedido veio eliminar. Vale para as células E para o fechamento:
  // quem chama transforma este retorno em fechamento null.
  if (semanas[numSemanas - 1].fim < hojeEpoch) return semDado;

  var fechadas = 0;
  for (var i = 0; i < numSemanas; i++) { if (semanas[i].fim < hojeEpoch) fechadas++; }

  // A semana em curso é a primeira NÃO fechada que já começou. Fica -1 quando
  // o mês inteiro ainda está no futuro.
  var indiceVigente = (fechadas < numSemanas && semanas[fechadas].inicio <= hojeEpoch) ? fechadas : -1;

  var realizadoAcumulado = 0;
  var previstoAcumulado = 0;
  var diasFechados = 0;
  for (var f = 0; f < fechadas; f++) {
    realizadoAcumulado += numero(semanasRealizado[f]);
    previstoAcumulado += numero(semanasPrevisto[f]);
    diasFechados += diasNaSemana(semanas[f]);
  }

  // A semana em curso fica FORA da comparação que escolhe o ramo: meia semana
  // de Realizado contra um Previsto de semana inteira acusaria déficit toda
  // segunda-feira, e o mês seria projetado a partir de um buraco que não
  // existe. O Realizado parcial dela entra só no saldo e na própria célula.
  var realizadoVigente = indiceVigente >= 0 ? numero(semanasRealizado[indiceVigente]) : 0;

  // Hoje já aconteceu: os dias que faltam da vigente são os DEPOIS de hoje.
  var diasRestantesVigente = indiceVigente >= 0 ? (semanas[indiceVigente].fim - hojeEpoch) : 0;
  var diasRestantesMes = diasRestantesVigente;
  var primeiraFutura = indiceVigente >= 0 ? indiceVigente + 1 : fechadas;
  for (var fu = primeiraFutura; fu < numSemanas; fu++) diasRestantesMes += diasNaSemana(semanas[fu]);

  var ramo = escolherRamo(realizadoAcumulado, previstoAcumulado);
  var ritmoPorDia = diasFechados > 0 ? realizadoAcumulado / diasFechados : 0;
  var saldo = previstoMes - realizadoAcumulado - realizadoVigente;

  var saida = [];
  for (var k = 0; k < numSemanas; k++) {
    if (k < fechadas) { saida.push(numero(semanasRealizado[k])); continue; }
    var ehVigente = (k === indiceVigente);

    if (ramo === 'igual') {
      // "mantém o P na T": a fatia INTEIRA que a linha Previsto exibe, para as
      // duas linhas mostrarem o mesmo número. Na vigente, nunca abaixo do que
      // já é fato.
      var previstoDaSemana = numero(semanasPrevisto[k]);
      saida.push(ehVigente ? Math.max(previstoDaSemana, realizadoVigente) : previstoDaSemana);
      continue;
    }

    var diasDaFatia = ehVigente ? diasRestantesVigente : diasNaSemana(semanas[k]);
    var base = ehVigente ? realizadoVigente : 0;

    // saldo <= 0 dentro do ramo 'abaixo' acontece quando o Realizado parcial
    // da vigente já cobriu sozinho o que faltava do mês -- seguir a fórmula do
    // saldo ali produziria projeção NEGATIVA.
    if (ramo === 'acima' || saldo <= 0) {
      saida.push(base + ritmoPorDia * diasDaFatia);
      continue;
    }
    saida.push(diasRestantesMes > 0 ? base + saldo * diasDaFatia / diasRestantesMes : base);
  }

  var previstoRestante = 0;
  var tendenciaRestante = 0;
  for (var r = fechadas; r < numSemanas; r++) {
    previstoRestante += numero(semanasPrevisto[r]);
    tendenciaRestante += saida[r];
  }

  return {
    semanas: saida,
    ramo: ramo,
    diagnostico: {
      realizadoAcumulado: realizadoAcumulado,
      previstoAcumulado: previstoAcumulado,
      semanasFechadas: fechadas,
      indiceVigente: indiceVigente,
      saldo: saldo,
      ritmoPorDia: ritmoPorDia,
      diasRestantesMes: diasRestantesMes,
      previstoRestante: previstoRestante,
      tendenciaRestante: tendenciaRestante,
    },
  };
}

module.exports = { calcularTendenciaSemanal, escolherRamo, TOLERANCIA_IGUAL };
```

- [ ] **Step 4: Rodar os testes**

Run: `node --test test/semanal-compute-tendencia-semanal.test.js`
Expected: PASS, 13 testes.

Depois: `node --test test/*.test.js`
Expected: PASS — nada consome o módulo novo ainda, então nenhum outro teste pode mudar.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/compute-tendencia-semanal.js test/semanal-compute-tendencia-semanal.test.js
git commit -m "Tendencia semanal por ramo: modulo puro com R=P/R>P/R<P e diagnostico"
```

---

### Task 2: Ligar o módulo novo em `calcularSeriesSemanaisDimensao`

**Files:**
- Modify: `tools/semanal/render-aba-semanal.js` (remover `calcularTendenciaSemanal` das linhas 128-224; alterar `calcularSeriesSemanaisDimensao`, linhas 291-376; alterar o `module.exports`, linha 454)
- Modify: `tools/semanal/render-semanal.js` (`BUNDLE_ARQUIVOS`)
- Modify: `test/semanal-render-aba-semanal.test.js` (remover os dois testes do fallback antigo)

**Interfaces:**
- Consumes: `calcularTendenciaSemanal` de `./compute-tendencia-semanal.js` (Task 1).
- Produces: `calcularSeriesSemanaisDimensao(...)` passa a devolver, além do que já devolvia, `ramoTendencia` (string) e `diagnosticoTendencia` (objeto ou `null`). `fechamentoTendencia` passa a ser `null` quando o mês está inteiramente no passado.

- [ ] **Step 1: Escrever os testes que falham**

Três mudanças em `test/semanal-render-aba-semanal.test.js`:

1. APAGAR os dois testes que exercitam o fallback de divisão igual (o da linha 357, "sem 'semanas' ... cai no fallback", e o da linha 365, "'semanas' com comprimento incompatível"). O módulo novo não tem esse fallback: entrada incompleta devolve `sem-dado`, coberto na Task 1.
2. No `require` do topo, tirar `calcularTendenciaSemanal` (não mora mais ali) e acrescentar `calcularSeriesSemanaisDimensao`. No `require` de `../tools/semanal/compute-semanal.js`, acrescentar `indiceSemanaAtual`. `diaEpoch` já vem de `../tools/comum/datas.js` neste arquivo — não trocar a origem.
3. Acrescentar ao fim do arquivo, reaproveitando os helpers que ele já tem (`registro(volumeMes)`, `diaJul`, `HOJE_15_JUL`, `ANO`, `VIGENTE_JULHO`, `semanasDoMes`) — não criar fixtures novas:

```js
const SEMANAS_JULHO = semanasDoMes(ANO, VIGENTE_JULHO);
const DEMANDAS_JULHO = {
  porRegistroEventos: {
    'SUP-0001-24||ST': { sondagemRealizada: [diaJul(2), diaJul(8), diaJul(14)], chegada: [], saidaEstoque: [] },
  },
};

test('mes inteiramente no passado: Tendencia sem dado ate no fechamento', () => {
  const hojeAgosto = diaEpoch(new Date(Date.UTC(2026, 7, 10)));
  const series = calcularSeriesSemanaisDimensao(
    [registro(1000)], [0], 'volume', VIGENTE_JULHO, SEMANAS_JULHO, SEMANAS_JULHO.length,
    true, indiceSemanaAtual(SEMANAS_JULHO, hojeAgosto), DEMANDAS_JULHO, hojeAgosto
  );
  assert.strictEqual(series.fechamentoTendencia, null, 'o Total nao pode repetir o Realizado');
  series.semanasTendencia.forEach((v) => assert.strictEqual(v, null));
  series.semanasTendenciaCompleta.forEach((v) => assert.strictEqual(v, null));
  assert.strictEqual(series.ramoTendencia, 'sem-dado');
  assert.strictEqual(series.diagnosticoTendencia, null);
});

test('mes corrente: o fechamento da Tendencia continua sendo o mes projetado, e o ramo vem junto', () => {
  const series = calcularSeriesSemanaisDimensao(
    [registro(1000)], [0], 'volume', VIGENTE_JULHO, SEMANAS_JULHO, SEMANAS_JULHO.length,
    true, indiceSemanaAtual(SEMANAS_JULHO, HOJE_15_JUL), DEMANDAS_JULHO, HOJE_15_JUL
  );
  assert.ok(series.fechamentoTendencia !== null, 'mes em curso tem projecao');
  assert.ok(['igual', 'acima', 'abaixo'].indexOf(series.ramoTendencia) !== -1);
  assert.ok(series.diagnosticoTendencia !== null);
  const somaCompleta = series.semanasTendenciaCompleta.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(somaCompleta - series.fechamentoTendencia) < 1e-9,
    'o fechamento tem de ser a soma da serie completa -- e o invariante da curva Acumulada');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-render-aba-semanal.test.js`
Expected: FAIL — `series.ramoTendencia` é `undefined` e `fechamentoTendencia` não é `null` no mês passado.

- [ ] **Step 3: Alterar `render-aba-semanal.js`**

3a. No topo, acrescentar o import (a forma exata importa para o bundler):

```js
const { calcularTendenciaSemanal } = require('./compute-tendencia-semanal.js');
```

3b. APAGAR o bloco inteiro que vai do comentário `// Tendência semanal (Volume): semanas TOTALMENTE fechadas...` até o fecho da função `calcularTendenciaSemanal` (linhas 128-224). A lógica inteira mudou de casa na Task 1.

3c. Dentro de `calcularSeriesSemanaisDimensao`, trocar o trecho que hoje calcula a tendência (as linhas que vão de `semanasTendenciaCompleta = calcularTendenciaSemanal(mesVigente, ...)` até `semanasTendencia = semanasTendenciaCompleta.map(...)`) por:

```js
    // A projeção e o ramo saem da MESMA chamada -- ver
    // tools/semanal/compute-tendencia-semanal.js. 'ramo' e 'diagnostico'
    // sobem no retorno porque a aba Alertas monta os dois alertas novos em
    // cima deles, e recalcular a comparação lá deixaria as duas telas
    // discordarem sobre em que ramo o grupo caiu.
    var tendencia = calcularTendenciaSemanal({
      previstoMes: mesVigente,
      semanasPrevisto: semanasPrevisto,
      semanasRealizado: semanasRealizado,
      semanas: semanas,
      hojeEpoch: hojeEpoch,
    });
    ramoTendencia = tendencia.ramo;
    diagnosticoTendencia = tendencia.diagnostico;
    semanasTendenciaCompleta = tendencia.semanas;
    // 'sem-dado' é o mês inteiramente no passado (regra 2.1): a série já vem
    // toda nula, e o fechamento tem de acompanhar -- fecharMes devolveria
    // null sozinho, mas deixar explícito impede que uma mudança futura em
    // fecharMes ressuscite o número que este pedido veio eliminar.
    fechamentoTendencia = tendencia.ramo === 'sem-dado' ? null : fecharMes(semanasTendenciaCompleta, dimensao);

    var semanasFechadas = 0;
    for (var sf = 0; sf < semanas.length; sf++) {
      if (semanas[sf].fim < hojeEpoch) semanasFechadas++;
    }
    semanasTendencia = tendencia.ramo === 'sem-dado'
      ? semanasTendenciaCompleta
      : semanasTendenciaCompleta.map(function (v, i) { return i < semanasFechadas ? null : v; });
```

3d. Declarar as duas variáveis novas junto das outras, logo abaixo de `var semanasElapsadas = 0;`:

```js
  var ramoTendencia = 'sem-dado';
  var diagnosticoTendencia = null;
```

3e. Acrescentá-las ao objeto de retorno, depois de `semanasElapsadas: semanasElapsadas,`:

```js
    ramoTendencia: ramoTendencia,
    diagnosticoTendencia: diagnosticoTendencia,
```

3f. No `module.exports`, remover `calcularTendenciaSemanal` (ela não mora mais aqui).

- [ ] **Step 4: Registrar o módulo no bundle**

Em `tools/semanal/render-semanal.js`, em `BUNDLE_ARQUIVOS`, trocar a primeira linha da lista por:

```js
  // compute-tendencia-semanal.js (2026-08-04) consome compute-semanal.js
  // (diasNaSemana) e é consumido por render-aba-semanal.js -- por isso entra
  // ENTRE os dois. A ordem desta lista é o contrato de dependência.
  'compute-semanal.js', 'compute-tendencia-semanal.js', 'render-aba-semanal.js', 'render-aba-alertas.js', 'render-aba-consolidado.js',
```

- [ ] **Step 5: Rodar os testes**

Run: `node --test test/*.test.js`
Expected: PASS. `test/semanal-compute-grafico-semanal.test.js` e `test/semanal-render-aba-alertas.test.js` consomem estas séries — se algum número mudar ali, é o ramo `R > P` mudando de janela (agora o ritmo sai só das semanas FECHADAS), que é a mudança pretendida. Conferir caso a caso antes de ajustar qualquer expectativa; não relaxar asserção nenhuma sem entender o número novo.

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/render-aba-semanal.js tools/semanal/render-semanal.js test/semanal-render-aba-semanal.test.js
git commit -m "Tendencia por ramo ligada nas series semanais; mes fechado nao projeta mais"
```

---

### Task 3: Financeiro sem casas decimais

**Files:**
- Modify: `tools/semanal/render-aba-semanal.js` (linhas 446-448, as três chamadas de `renderLinhaSerie`)
- Modify: `tools/semanal/render-aba-consolidado.js` (linha 154, `colunasExtras`)
- Test: `test/semanal-render-aba-semanal.test.js`, `test/semanal-render-aba-consolidado.test.js`

**Interfaces:**
- Consumes: nada de tarefas anteriores.
- Produces: nada que tarefas seguintes consumam.

- [ ] **Step 1: Escrever os testes que falham**

Em `test/semanal-render-aba-semanal.test.js`, usando os helpers que o arquivo já tem (`registro`, `ANO`, `VIGENTE_JULHO`, `HOJE_15_JUL`) e o `DEMANDAS_JULHO` criado na Task 2:

```js
// O registro base do arquivo só carrega volume; para exercitar o financeiro
// basta preencher o mês vigente dele.
function registroFinanceiro(financeiroMes) {
  const r = registro(0);
  r.previsto.financeiro = new Array(12).fill(0);
  r.previsto.financeiro[VIGENTE_JULHO] = financeiroMes;
  r.previsto.volumeResumo = { total: 0, totalInicial: 0, ticket: 250 };
  return r;
}

test('financeiro sai inteiro nas tres linhas da Tabela Semanal', () => {
  const html = renderAbaSemanal([registroFinanceiro(123456)], [0], ['financeiro'], VIGENTE_JULHO, ANO,
    { demandas: DEMANDAS_JULHO, hojeEpoch: HOJE_15_JUL });
  const numeros = html.match(/<td class="num[^"]*">[\d.,]+<\/td>/g) || [];
  assert.ok(numeros.length > 0, 'a fixture precisa produzir celulas numericas');
  numeros.forEach((td) => assert.ok(!/,\d/.test(td), 'financeiro nao pode ter casa decimal: ' + td));
});

test('equipes continua com duas casas -- e media ponderada, nao valor financeiro', () => {
  const html = renderAbaSemanal([registro(1000)], [0], ['equipes'], VIGENTE_JULHO, ANO, {});
  assert.ok(/,\d\d</.test(html), 'equipes tem de manter as 2 casas');
});
```

Em `test/semanal-render-aba-consolidado.test.js`:

```js
test('ticket medio previsto sai inteiro', () => {
  const colunas = colunasExtras('financeiro');
  assert.strictEqual(colunas.length, 1);
  assert.strictEqual(colunas[0].chave, 'ticket');
  assert.strictEqual(colunas[0].casas, 0);
});
```

Se `colunasExtras` ainda não estiver exportada de `render-aba-consolidado.js`, acrescentá-la ao `module.exports` dele e ao `require` do teste.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-render-aba-semanal.test.js test/semanal-render-aba-consolidado.test.js`
Expected: FAIL — as células de financeiro vêm com `,00` e `casas` do ticket é `2`.

- [ ] **Step 3: Implementar**

3a. Em `render-aba-semanal.js`, substituir as três chamadas de `renderLinhaSerie` dentro do `return` de `renderAbaSemanal` por:

```js
      // Equipes continua com 2 casas: é média ponderada (foto), não passa pelo
      // arredondamento inteiro -- ver dividirEmSemanasInteiras. Financeiro é
      // inteiro desde 2026-08-04 (pedido do dono do projeto: nenhum valor
      // financeiro com casa decimal). Volume fica no padrão: a Tendência dele
      // é projeção fracionária, e a casa decimal ali é informação real.
      + renderLinhaSerie('Previsto', 'previsto', series.semanasPrevisto, series.fechamentoPrevisto, dimensao === 'equipes' ? 2 : 0)
      + renderLinhaSerie('Realizado', 'realizado', series.semanasRealizado, series.fechamentoRealizado, dimensao === 'financeiro' ? 0 : undefined)
      + renderLinhaSerie('Tendência', 'tendencia', series.semanasTendencia, series.fechamentoTendencia, dimensao === 'financeiro' ? 0 : undefined)
```

3b. Em `render-aba-consolidado.js`, em `colunasExtras`, trocar `casas: 2` do ticket por `casas: 0`, e ajustar o comentário acima da função para registrar que financeiro é inteiro nesta página.

- [ ] **Step 4: Rodar os testes**

Run: `node --test test/*.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/render-aba-semanal.js tools/semanal/render-aba-consolidado.js test/semanal-render-aba-semanal.test.js test/semanal-render-aba-consolidado.test.js
git commit -m "Valores financeiros sem casas decimais na pagina semanal"
```

---

### Task 4: Módulo `compute-alertas-tendencia.js`

**Files:**
- Create: `tools/semanal/compute-alertas-tendencia.js`
- Modify: `tools/semanal/render-aba-semanal.js` (`module.exports`: acrescentar `pendentesNaData`)
- Modify: `tools/semanal/render-aba-consolidado.js` (`module.exports`: acrescentar `produtividadeEsperada` e `somarPrevistoMes`)
- Test: `test/semanal-compute-alertas-tendencia.test.js`

**Interfaces:**
- Consumes: o `diagnostico` produzido pela Task 1 e devolvido por `calcularSeriesSemanaisDimensao` na Task 2 (`ramoTendencia`, `diagnosticoTendencia`).
- Produces: `avaliarAlertaTendencia(entrada) -> null | { tipo, status, ...evidencia }`, com `tipo` em `'demanda' | 'produtividade'` e `status` em `'alerta' | 'sem-dado'`. Também `ALERTA_ROTULO` (mapa `tipo -> rótulo de tela`) e `diasPremissaRestantes(mesIdx, diasRestantesMes, diasDoMes)`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `test/semanal-compute-alertas-tendencia.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { avaliarAlertaTendencia, diasPremissaRestantes, ALERTA_ROTULO } = require('../tools/semanal/compute-alertas-tendencia.js');
const { DIAS_PREMISSA_MES } = require('../tools/comum/calculo-equipes.js');

// Julho (mesIdx 6): 31 dias de calendario, 30 dias de premissa.
const DIAG_ACIMA = {
  realizadoAcumulado: 180, previstoAcumulado: 120, semanasFechadas: 2, indiceVigente: 2,
  saldo: 130, ritmoPorDia: 15, diasRestantesMes: 18, previstoRestante: 190, tendenciaRestante: 270,
};
const DIAG_ABAIXO = {
  realizadoAcumulado: 60, previstoAcumulado: 120, semanasFechadas: 2, indiceVigente: 2,
  saldo: 250, ritmoPorDia: 5, diasRestantesMes: 18, previstoRestante: 190, tendenciaRestante: 250,
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
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-compute-alertas-tendencia.test.js`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Escrever o módulo**

Criar `tools/semanal/compute-alertas-tendencia.js`:

```js
'use strict';
const { DIAS_PREMISSA_MES } = require('../comum/calculo-equipes.js');

// Os dois alertas de diagnóstico pedidos em 2026-08-04 -- ver
// docs/superpowers/specs/2026-08-04-semanal-tendencia-regras-e-alertas-design.md.
// Puro: recebe o 'diagnostico' que compute-tendencia-semanal.js já calculou e
// os três insumos externos (saldo de demandas, equipes previstas, premissa de
// produtividade), e responde a pergunta que o ramo levanta.
//
// O require de '../comum/' é REMOVIDO pelo bundler (ver transformaModulo em
// tools/comum/browser-bundle.js): no navegador DIAS_PREMISSA_MES chega como
// global pelo <script> de fonteParaCliente(), que já é injetado ANTES do
// bundle. No Node o require resolve normalmente.

var ALERTA_ROTULO = {
  demanda: 'Avaliar equipe e demanda',
  produtividade: 'Equipes com pouco recurso ou improdutividade',
};

// A premissa de dias úteis do projeto (30, ou 15 em Jan/Dez) recortada na
// fração do mês que ainda falta. Usar dias de CALENDÁRIO aqui faria esta conta
// discordar da coluna "Produtividade média esperada" do Consolidado, que é
// justamente a referência com que ela é comparada.
function diasPremissaRestantes(mesIdx, diasRestantesMes, diasDoMes) {
  var premissa = DIAS_PREMISSA_MES[mesIdx];
  if (!premissa || !diasDoMes) return 0;
  return premissa * diasRestantesMes / diasDoMes;
}

function semDado(tipo, diagnostico) {
  return {
    tipo: tipo, status: 'sem-dado',
    realizadoAcumulado: diagnostico.realizadoAcumulado,
    previstoAcumulado: diagnostico.previstoAcumulado,
  };
}

// entrada: { ramo, diagnostico, mesIdx, diasDoMes, saldoDemandas,
//            equipesPrevistas, produtividadeEsperada }
// Devolve null quando não há nada a dizer, e um objeto quando há -- 'sem-dado'
// quando falta insumo para decidir. Ausência nunca vira "tudo certo".
function avaliarAlertaTendencia(entrada) {
  var e = entrada || {};
  var d = e.diagnostico;
  if (!d || e.ramo === 'igual' || e.ramo === 'sem-dado' || !e.ramo) return null;

  if (e.ramo === 'acima') {
    // O ritmo acima do plano tem carteira que o sustente?
    var excedente = d.tendenciaRestante - d.previstoRestante;
    if (excedente <= 0) return null;
    if (e.saldoDemandas === null || e.saldoDemandas === undefined) return semDado('demanda', d);
    if (e.saldoDemandas >= excedente) return null;
    return {
      tipo: 'demanda', status: 'alerta',
      realizadoAcumulado: d.realizadoAcumulado,
      previstoAcumulado: d.previstoAcumulado,
      excedenteProjetado: excedente,
      saldoDemandas: e.saldoDemandas,
    };
  }

  // ramo 'abaixo': as equipes previstas, na produtividade prevista, dão conta
  // do saldo que ainda falta produzir?
  if (d.saldo <= 0) return null;
  var dias = diasPremissaRestantes(e.mesIdx, d.diasRestantesMes, e.diasDoMes);
  if (!dias || !e.equipesPrevistas
      || e.produtividadeEsperada === null || e.produtividadeEsperada === undefined) {
    return semDado('produtividade', d);
  }
  var exigida = d.saldo / (e.equipesPrevistas * dias);
  if (exigida <= e.produtividadeEsperada) return null;
  return {
    tipo: 'produtividade', status: 'alerta',
    realizadoAcumulado: d.realizadoAcumulado,
    previstoAcumulado: d.previstoAcumulado,
    produtividadeExigida: exigida,
    produtividadeEsperada: e.produtividadeEsperada,
    equipesPrevistas: e.equipesPrevistas,
  };
}

module.exports = { avaliarAlertaTendencia, diasPremissaRestantes, ALERTA_ROTULO };
```

- [ ] **Step 4: Exportar as duas funções que o render vai precisar**

Em `tools/semanal/render-aba-semanal.js`, acrescentar `pendentesNaData` ao `module.exports`.
Em `tools/semanal/render-aba-consolidado.js`, acrescentar `produtividadeEsperada` e `somarPrevistoMes` ao `module.exports`. Nenhuma das três muda de corpo — só deixam de ser privadas.

- [ ] **Step 5: Rodar os testes**

Run: `node --test test/*.test.js`
Expected: PASS, incluindo os 11 testes novos.

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/compute-alertas-tendencia.js test/semanal-compute-alertas-tendencia.test.js tools/semanal/render-aba-semanal.js tools/semanal/render-aba-consolidado.js
git commit -m "Dois alertas de tendencia: modulo puro de decisao"
```

---

### Task 5: Render do bloco de alertas na aba Alertas

**Files:**
- Create: `tools/semanal/render-alertas-tendencia.js`
- Test: `test/semanal-render-alertas-tendencia.test.js`

**Interfaces:**
- Consumes: `avaliarAlertaTendencia`/`ALERTA_ROTULO` (Task 4); `calcularSeriesSemanaisDimensao` e `pendentesNaData` de `./render-aba-semanal.js`; `produtividadeEsperada` e `somarPrevistoMes` de `./render-aba-consolidado.js`; `agruparIndicesAlertas`, `tomadorDoGrupo` e `normalizarBusca` de `./render-aba-alertas.js`; `diasNaSemana` e `indiceSemanaAtual` de `./compute-semanal.js`.
- Produces: `renderCabecalhoAlertasTendencia(agruparPorRotulo) -> string` e `renderCorpoAlertasTendencia(registros, indices, opcoes) -> string`, com `opcoes = { agruparPor, dimensao, mesIdx, semanas, demandas, hojeEpoch }`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `test/semanal-render-alertas-tendencia.test.js`. Montar registros e demandas sintéticos que forcem cada caso (copiar a forma das fixtures de `test/semanal-render-aba-alertas.test.js`, que já monta `registros` com `previsto.volume`/`previsto.equipes`/`equipesResumo` e um `demandas.porRegistroEventos`):

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderCorpoAlertasTendencia, renderCabecalhoAlertasTendencia } = require('../tools/semanal/render-alertas-tendencia.js');
const { semanasDoMes, diaEpoch } = require('../tools/semanal/compute-semanal.js');

const SEMANAS = semanasDoMes(2026, 6);
const HOJE = diaEpoch(new Date(Date.UTC(2026, 6, 15)));
const dia = (d) => diaEpoch(new Date(Date.UTC(2026, 6, d)));

function registro(sup, volumeMes, equipes, prod) {
  const mensal = new Array(12).fill(0);
  mensal[6] = volumeMes;
  const eq = new Array(12).fill(0);
  eq[6] = equipes;
  return {
    sup: sup, tipologia: 'SP.P', tomador: 'T1', grupo: 'G1', origem: 'O1',
    previsto: { volume: mensal, financeiro: new Array(12).fill(0), equipes: eq, equipesResumo: { prod: prod }, volumeResumo: { ticket: 100 } },
  };
}

// Um SUP produzindo muito acima do plano e com carteira minima -> alerta de demanda.
// Outro produzindo muito abaixo com 1 equipe e produtividade prevista baixa -> alerta de equipes.
function demandasCom(chegadas, realizadas) {
  return { porRegistroEventos: { 'ACIMA||SP.P': { chegada: chegadas, sondagemRealizada: realizadas, saidaEstoque: realizadas } } };
}

test('cabecalho traz as sete colunas do bloco', () => {
  const html = renderCabecalhoAlertasTendencia('SUP');
  ['SUP', 'Tomador', 'Alerta', 'Realizado acum.', 'Previsto acum.', 'Evidência', 'Status']
    .forEach((c) => assert.ok(html.indexOf(c) !== -1, 'falta a coluna ' + c));
});

test('dimensao diferente de volume nao monta tabela, explica por que', () => {
  const html = renderCorpoAlertasTendencia([registro('A', 100, 1, 1)], [0], {
    agruparPor: 'sup', dimensao: 'financeiro', mesIdx: 6, semanas: SEMANAS, demandas: demandasCom([], []), hojeEpoch: HOJE,
  });
  assert.ok(/Volume/.test(html), 'a nota tem de dizer que o bloco so vale em Volume');
  assert.ok(html.indexOf('<tr') === -1, 'nenhuma linha de alerta fora de Volume');
});

test('grupo sem alerta nenhum nao vira linha', () => {
  // Realizado batendo o previsto -> ramo igual -> nenhum alerta.
  const chegadas = []; const realizadas = [];
  for (let d = 1; d <= 12; d++) { chegadas.push(dia(d)); realizadas.push(dia(d)); }
  const html = renderCorpoAlertasTendencia([registro('A', 31, 1, 1)], [0], {
    agruparPor: 'sup', dimensao: 'volume', mesIdx: 6, semanas: SEMANAS,
    demandas: { porRegistroEventos: { 'A||SP.P': { chegada: chegadas, sondagemRealizada: realizadas, saidaEstoque: realizadas } } },
    hojeEpoch: HOJE,
  });
  assert.ok(html.indexOf('Avaliar equipe e demanda') === -1);
  assert.ok(html.indexOf('Equipes com pouco recurso') === -1);
});

test('mes inteiramente no passado nao gera alerta nenhum', () => {
  const chegadas = [dia(1)]; const realizadas = [dia(1)];
  const html = renderCorpoAlertasTendencia([registro('A', 500, 1, 0.1)], [0], {
    agruparPor: 'sup', dimensao: 'volume', mesIdx: 6, semanas: SEMANAS,
    demandas: { porRegistroEventos: { 'A||SP.P': { chegada: chegadas, sondagemRealizada: realizadas, saidaEstoque: realizadas } } },
    hojeEpoch: diaEpoch(new Date(Date.UTC(2026, 7, 20))),
  });
  assert.strictEqual(html.indexOf('<tr'), -1);
});

test('deficit grande com uma equipe improdutiva vira a linha de equipes', () => {
  // Previsto 500 no mes, quase nada realizado nas semanas fechadas, 1 equipe
  // com produtividade prevista de 0,1 furo/equipe-dia -> exigida >> esperada.
  const html = renderCorpoAlertasTendencia([registro('A', 500, 1, 0.1)], [0], {
    agruparPor: 'sup', dimensao: 'volume', mesIdx: 6, semanas: SEMANAS,
    demandas: { porRegistroEventos: { 'A||SP.P': { chegada: [dia(1)], sondagemRealizada: [dia(1)], saidaEstoque: [dia(1)] } } },
    hojeEpoch: HOJE,
  });
  assert.ok(html.indexOf('Equipes com pouco recurso ou improdutividade') !== -1);
  assert.ok(/data-search=/.test(html), 'a linha precisa do data-search para a busca da aba');
});

test('sem demandas carregadas o bloco diz sem dado, nao "tudo certo"', () => {
  const html = renderCorpoAlertasTendencia([registro('A', 500, 1, 0.1)], [0], {
    agruparPor: 'sup', dimensao: 'volume', mesIdx: 6, semanas: SEMANAS, demandas: null, hojeEpoch: HOJE,
  });
  assert.ok(/Sem dado/.test(html));
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-render-alertas-tendencia.test.js`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Escrever o módulo**

Criar `tools/semanal/render-alertas-tendencia.js`:

```js
'use strict';
const { avaliarAlertaTendencia, ALERTA_ROTULO} = require('./compute-alertas-tendencia.js');
const { calcularSeriesSemanaisDimensao, pendentesNaData} = require('./render-aba-semanal.js');
const { produtividadeEsperada, somarPrevistoMes} = require('./render-aba-consolidado.js');
const { agruparIndicesAlertas, tomadorDoGrupo, normalizarBusca} = require('./render-aba-alertas.js');
const { diasNaSemana, indiceSemanaAtual} = require('./compute-semanal.js');

// Bloco "Alertas de tendência" da aba Alertas -- os dois diagnósticos pedidos
// em 2026-08-04. Fica ABAIXO da tabela do semáforo e não altera nada dela: o
// semáforo mede desvio, este bloco responde "e daí?".
//
// SÓ na dimensão Volume, de propósito: as duas perguntas são físicas (furos em
// carteira, furos por equipe-dia). Em R$ não existe estoque de demanda, e em
// Equipes não existe Realizado semanal em lugar nenhum desta página.

var COR_ALERTA = '#c0392b';
var COR_SEM_DADO = '#95a5a6';

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatarNumero(v, casasDecimais) {
  if (v === null || v === undefined) return '—';
  var casas = casasDecimais === undefined ? 2 : casasDecimais;
  var fator = Math.pow(10, casas);
  return (Math.round(v * fator) / fator).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function renderCabecalhoAlertasTendencia(agruparPorRotulo) {
  return '<tr><th>' + escapeHtml(agruparPorRotulo || 'SUP') + '</th><th>Tomador</th><th>Alerta</th>'
    + '<th class="num">Realizado acum.</th><th class="num">Previsto acum.</th>'
    + '<th>Evidência</th><th>Status</th></tr>';
}

// A prova do alerta, em texto: sem ela a linha é uma acusação sem número.
function textoEvidencia(alerta) {
  if (alerta.status === 'sem-dado') {
    return alerta.tipo === 'demanda'
      ? 'Sem base de demandas carregada'
      : 'Sem equipes previstas ou sem premissa de produtividade';
  }
  if (alerta.tipo === 'demanda') {
    return 'Saldo de demandas ' + formatarNumero(alerta.saldoDemandas, 0)
      + ' · excedente projetado ' + formatarNumero(alerta.excedenteProjetado, 0);
  }
  return 'Produtividade exigida ' + formatarNumero(alerta.produtividadeExigida, 2)
    + ' · esperada ' + formatarNumero(alerta.produtividadeEsperada, 2)
    + ' (' + formatarNumero(alerta.equipesPrevistas, 2) + ' equipes previstas)';
}

function diasDoMesNasSemanas(semanas) {
  var total = 0;
  for (var i = 0; i < semanas.length; i++) total += diasNaSemana(semanas[i]);
  return total;
}

function renderLinhaGrupo(rotuloGrupo, registros, indices, ctx) {
  var series = calcularSeriesSemanaisDimensao(
    registros, indices, 'volume', ctx.mesIdx, ctx.semanas, ctx.semanas.length,
    ctx.temSemanasReais, ctx.indiceAtual, ctx.demandas, ctx.hojeEpoch
  );
  var alerta = avaliarAlertaTendencia({
    ramo: series.ramoTendencia,
    diagnostico: series.diagnosticoTendencia,
    mesIdx: ctx.mesIdx,
    diasDoMes: ctx.diasDoMes,
    saldoDemandas: ctx.temDemandas ? pendentesNaData(registros, indices, ctx.demandas, ctx.hojeEpoch) : null,
    equipesPrevistas: somarPrevistoMes(registros, indices, 'equipes', ctx.mesIdx),
    produtividadeEsperada: produtividadeEsperada(registros, indices, ctx.mesIdx),
  });
  if (!alerta) return '';

  var tomador = tomadorDoGrupo(registros, indices);
  var rotulo = ALERTA_ROTULO[alerta.tipo];
  var cor = alerta.status === 'alerta' ? COR_ALERTA : COR_SEM_DADO;
  var statusTexto = alerta.status === 'alerta' ? 'Alerta' : 'Sem dado';
  var busca = normalizarBusca(rotuloGrupo + ' ' + tomador + ' ' + rotulo);
  return '<tr data-search="' + escapeHtml(busca) + '">'
    + '<td>' + escapeHtml(rotuloGrupo) + '</td>'
    + '<td>' + escapeHtml(tomador) + '</td>'
    + '<td>' + escapeHtml(rotulo) + '</td>'
    + '<td class="num">' + formatarNumero(alerta.realizadoAcumulado, 0) + '</td>'
    + '<td class="num">' + formatarNumero(alerta.previstoAcumulado, 0) + '</td>'
    + '<td>' + escapeHtml(textoEvidencia(alerta)) + '</td>'
    + '<td><span class="status-circulo" style="background:' + cor + '"></span>' + escapeHtml(statusTexto) + '</td>'
    + '</tr>';
}

// opcoes: { agruparPor, dimensao, mesIdx, semanas, demandas, hojeEpoch }
function renderCorpoAlertasTendencia(registros, indices, opcoes) {
  var o = opcoes || {};
  var semanas = o.semanas || [];
  if (o.dimensao !== 'volume') {
    return '<tr class="linha-nota-alertas"><td colspan="7">'
      + 'Os alertas de tendência só existem na dimensão <strong>Volume</strong>: '
      + 'as duas perguntas que eles respondem são físicas (furos em carteira e furos por equipe-dia).'
      + '</td></tr>';
  }
  if (!semanas.length || typeof o.hojeEpoch !== 'number') return '';

  var temDemandas = !!(o.demandas && o.demandas.porRegistroEventos);
  var ctx = {
    mesIdx: o.mesIdx,
    semanas: semanas,
    demandas: o.demandas,
    hojeEpoch: o.hojeEpoch,
    temDemandas: temDemandas,
    temSemanasReais: temDemandas,
    indiceAtual: indiceSemanaAtual(semanas, o.hojeEpoch),
    diasDoMes: diasDoMesNasSemanas(semanas),
  };
  var grupos = agruparIndicesAlertas(registros, indices, o.agruparPor || 'sup');
  return grupos.map(function (g) {
    return renderLinhaGrupo(g.chave, registros, g.indices, ctx);
  }).join('');
}

module.exports = { renderCorpoAlertasTendencia, renderCabecalhoAlertasTendencia, ALERTA_ROTULO };
```

- [ ] **Step 4: Rodar os testes**

Run: `node --test test/*.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/render-alertas-tendencia.js test/semanal-render-alertas-tendencia.test.js
git commit -m "Bloco de alertas de tendencia: render das linhas"
```

---

### Task 6: Ligar o bloco na página (HTML, CSS, bundle e recálculo)

**Files:**
- Modify: `tools/semanal/render-semanal.js` (`BUNDLE_ARQUIVOS`, `CSS_SEMANAL`, o markup de `secao-alertas`, a lista de `var Render... = MODULOS[...]`, e `recalcularAlertasSemanal`)
- Test: `test/semanal-render-semanal-wireup.test.js`

**Interfaces:**
- Consumes: `renderCorpoAlertasTendencia`/`renderCabecalhoAlertasTendencia` (Task 5).
- Produces: nada que tarefas seguintes consumam.

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar a `test/semanal-render-semanal-wireup.test.js`, montando o HTML pela mesma chamada que os testes vizinhos já fazem (`registroSintetico`, `DEMANDAS_VAZIAS`, `PERIODOS_2026`, `SENHA_FAKE` já existem no topo do arquivo):

```js
// O HTML cru basta aqui: estes três testes olham markup e ordem de bundle, não
// precisam do vm.Context que montarSandbox arma para os testes de wire-up.
function paginaCrua() {
  return renderSemanal({
    registros: [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)],
    baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z'),
  });
}

test('a aba Alertas tem o bloco de tendencia, com cabecalho e corpo proprios', () => {
  const html = paginaCrua();
  assert.ok(html.indexOf('id="cabecalho-alertas-tendencia"') !== -1);
  assert.ok(html.indexOf('id="corpo-alertas-tendencia"') !== -1);
  assert.ok(html.indexOf('Alertas de tendência') !== -1);
});

test('render-alertas-tendencia.js entra no bundle DEPOIS de tudo que ele consome', () => {
  const html = paginaCrua();
  const pos = (nome) => html.indexOf("MODULOS['" + nome + "']");
  ['compute-tendencia-semanal.js', 'compute-alertas-tendencia.js', 'render-aba-semanal.js',
   'render-aba-alertas.js', 'render-aba-consolidado.js', 'compute-semanal.js'].forEach((dep) => {
    assert.ok(pos(dep) !== -1, dep + ' precisa estar no bundle');
    assert.ok(pos(dep) < pos('render-alertas-tendencia.js'), dep + ' tem de vir antes de render-alertas-tendencia.js');
  });
});

test('o recalculo da aba Alertas preenche o bloco novo', () => {
  assert.ok(/getElementById\('corpo-alertas-tendencia'\)\.innerHTML/.test(paginaCrua()));
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-render-semanal-wireup.test.js`
Expected: FAIL — nenhum dos ids existe.

- [ ] **Step 3: Implementar as cinco ligações**

3a. `BUNDLE_ARQUIVOS`: acrescentar `compute-alertas-tendencia.js` e `render-alertas-tendencia.js` logo DEPOIS de `render-aba-consolidado.js`, com o comentário de dependência:

```js
  // Os dois de 2026-08-04. compute-alertas-tendencia.js só tem um
  // require('../comum/calculo-equipes.js'), que o bundler REMOVE
  // (DIAS_PREMISSA_MES chega como global). render-alertas-tendencia.js
  // consome compute-alertas-tendencia.js, render-aba-semanal.js,
  // render-aba-consolidado.js, render-aba-alertas.js e compute-semanal.js --
  // todos já registrados acima dele nesta lista.
  'compute-alertas-tendencia.js', 'render-alertas-tendencia.js',
```

3b. Junto das outras linhas `var RenderAbaAlertas = MODULOS['render-aba-alertas.js'];`:

```js
var RenderAlertasTendencia = MODULOS['render-alertas-tendencia.js'];
```

3c. No markup de `secao-alertas`, logo DEPOIS do `</table>` de `tabela-alertas`:

```html
      <div class="bloco-alertas-tendencia">
        <h3 class="titulo-alertas-tendencia">Alertas de tendência</h3>
        <table id="tabela-alertas-tendencia">
          <thead id="cabecalho-alertas-tendencia"></thead>
          <tbody id="corpo-alertas-tendencia"></tbody>
        </table>
      </div>
```

3d. No fim de `recalcularAlertasSemanal`, ANTES de `aplicarBuscaAlertasSemanal();`:

```js
  // O bloco de tendência segue o mesmo agrupamento e o mesmo recorte da
  // tabela de cima, mas ignora o seletor de dimensão dela: é Volume sempre
  // (ver render-alertas-tendencia.js). A busca da aba varre os dois <tbody>
  // pelo data-search, então ele precisa ser preenchido ANTES dela rodar.
  document.getElementById('cabecalho-alertas-tendencia').innerHTML =
    RenderAlertasTendencia.renderCabecalhoAlertasTendencia(
      RenderAbaAlertas.AGRUPAR_POR_ROTULO[agruparPor] || agruparPor
    );
  document.getElementById('corpo-alertas-tendencia').innerHTML =
    RenderAlertasTendencia.renderCorpoAlertasTendencia(window.__REGISTROS__, indices, {
      agruparPor: agruparPor,
      dimensao: dimensao,
      mesIdx: mesSelecionadoIdx,
      semanas: semanasDoMesSelecionado(),
      demandas: window.__DEMANDAS__,
      hojeEpoch: hojeEpochDoNavegador(),
    });
```

3e. Em `CSS_SEMANAL`, acrescentar:

```css
.bloco-alertas-tendencia { margin-top: 28px; }
.titulo-alertas-tendencia { font-size: 15px; font-weight: 600; margin: 0 0 8px; }
#tabela-alertas-tendencia { width: 100%; border-collapse: collapse; }
.linha-nota-alertas td { color: var(--texto-suave); font-size: 13px; padding: 12px 8px; }
```

Conferir os nomes de variável CSS que o arquivo já usa (`--texto-suave` pode ter outro nome) e reaproveitar os existentes em vez de inventar.

Verificar também se `aplicarBuscaAlertasSemanal` varre só `#corpo-alertas`; se varrer, estendê-la para incluir `#corpo-alertas-tendencia`, senão a busca da aba esconde uma tabela e deixa a outra.

- [ ] **Step 4: Rodar os testes**

Run: `node --test test/*.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/render-semanal.js test/semanal-render-semanal-wireup.test.js
git commit -m "Aba Alertas: bloco de tendencia ligado na pagina"
```

---

### Task 7: Revisão de design do Open Design

**Files:**
- Create: um snapshot estático descartável no scratchpad da sessão (não entra no repositório)
- Modify: `tools/semanal/render-semanal.js` e/ou `tools/semanal/render-alertas-tendencia.js`, conforme as sugestões que valerem a pena

**Interfaces:**
- Consumes: a página construída na Task 6.
- Produces: nada que tarefas seguintes consumam além do HTML já ajustado.

O `CLAUDE.md` do repositório exige revisão de design do Open Design para trabalho de HTML. As três armadilhas registradas em 2026-08-03 valem inteiras aqui:

- [ ] **Step 1: Criar um projeto DEDICADO** via `mcp__open-design__create_project` com `skill: "design-review"`. **NÃO** usar o projeto `3b8ae52a-...` ("Projetos IA"): ele tem `skill: agent-browser` e o plugin `example-web-prototype` aplicados, devolve `succeeded` em ~9s com `artifactCount: 0` e não faz nada.

- [ ] **Step 2: Gerar um snapshot estático que RENDERIZE a aba Alertas** com dados **sintéticos** (o snapshot é HTML em texto puro — dado real ali vazaria fora do blob cifrado), com o CSS extraído do `<style>` que o próprio render emite. Calibrar os dados para os três estados do bloco aparecerem juntos: linha de alerta de demanda, linha de alerta de produtividade e linha "Sem dado". A página publicada não serve de insumo — é gate de senha mais blob cifrado, e o OD revisaria a caixa de senha.

- [ ] **Step 3: Rodar `mcp__open-design__start_run`** com `agent: "claude"` e `skill: "design-review"` no projeto dedicado, e esperar terminar.

- [ ] **Step 4: Conferir o `events.jsonl` do run** antes de concluir que a revisão terminou. O agente interno do OD consome a MESMA cota da conta: um run pode morrer no meio com `failureCategory: rate_limit`, com `status: failed`, e ainda assim ter editado arquivos.

- [ ] **Step 5: Portar à mão** as sugestões que valerem a pena para `render-semanal.js`/`render-alertas-tendencia.js`. Os "fixes" do OD caem numa cópia dele — editar o HTML construído não dura, a próxima reconstrução apaga.

- [ ] **Step 6: Rodar os testes e commitar**

Run: `node --test test/*.test.js`
Expected: PASS.

```bash
git add tools/semanal/
git commit -m "Incorpora a revisao de design do Open Design no bloco de alertas de tendencia"
```

---

### Task 8: Revisão de código

**Files:**
- Modify: o que a revisão apontar

**Interfaces:**
- Consumes: tudo das Tasks 1-7.
- Produces: nada.

- [ ] **Step 1: Rodar a revisão** com a skill `superpowers:requesting-code-review` sobre o diff completo do branch contra `origin/master`.

- [ ] **Step 2: Tratar os achados** com a skill `superpowers:receiving-code-review` — verificar cada um antes de implementar, não concordar por educação. Dar atenção especial a três pontos, que são onde este plano tem mais chance de estar errado:
  - o invariante "ponto final da curva Acumulada da aba Gráficos = Fechamento da Tabela Semanal" continua valendo em todos os ramos;
  - `semanasTendenciaCompleta` continua servindo o numerador do semáforo da aba Alertas sem mudar de significado;
  - nenhum caminho novo divide por zero (`diasFechados`, `diasRestantesMes`, `equipesPrevistas`, `diasDoMes`).

- [ ] **Step 3: Rodar os testes e commitar**

Run: `node --test test/*.test.js`
Expected: PASS.

```bash
git add -A
git commit -m "Corrige os achados da revisao de codigo"
```

---

### Task 9: Reconstruir, sincronizar `docs/` e publicar

**Files:**
- Modify: `dist/planejamento-semanal.html`, `docs/planejamento-semanal.html`
- Modify: `CLAUDE.md` (do `orcamento-dashboard`)

**Interfaces:**
- Consumes: tudo das Tasks 1-8.
- Produces: a publicação.

**Esta tarefa é da sessão que verificou o trabalho, nunca de um subagente no meio do pipeline: nada é publicado antes das revisões das Tasks 7 e 8 passarem.**

- [ ] **Step 1: Reconstruir**

```bash
ORCAMENTO_SENHA='<pedir ao dono do projeto>' node tools/semanal/build-dashboard.js
```

Expected: escreve `dist/planejamento-semanal.html` sem erro. A senha é env var e nunca entra em arquivo do repositório.

- [ ] **Step 2: Sincronizar `docs/`**

```bash
cp dist/planejamento-semanal.html docs/planejamento-semanal.html
```

O Pages serve `/docs`, não `/dist`, e nada copia automaticamente. `test/publicacao-docs-sincronizado.test.js` trava esta cópia.

- [ ] **Step 3: Rodar a bateria inteira**

Run: `node --test test/*.test.js`
Expected: PASS, incluindo `publicacao-docs-sincronizado.test.js` e `orcamento-html-inalterado.test.js`.

- [ ] **Step 4: Registrar as decisões no `CLAUDE.md`**

Acrescentar à seção "Planejamento Semanal" do `orcamento-dashboard/CLAUDE.md` um bloco "Tendência por ramo (2026-08-04)" com: os três ramos e a tolerância de 1%; a semana em curso ficando fora da comparação e por quê; mês fechado sem Tendência nem no Total; os dois alertas, suas condições de disparo e por que só em Volume; e que financeiro passou a ser inteiro nesta página.

- [ ] **Step 5: Commitar e publicar**

```bash
git add dist/planejamento-semanal.html docs/planejamento-semanal.html CLAUDE.md
git commit -m "Rebuild: tendencia por ramo, alertas de tendencia e financeiro inteiro"
git push origin semanal-tendencia-ramos:master
```

O `master` local está velho/divergente — publicar sempre por `push <branch>:master`, nunca por merge local.

- [ ] **Step 6: Confirmar a publicação pelo conteúdo, não pelo status da API**

```bash
curl -s https://amcaccere261283.github.io/orcamento-dashboard/planejamento-semanal.html | head -c 2000
```

Expected: o HTML servido bate com `dist/planejamento-semanal.html`. Não confiar no status da API de builds do Pages: em 2026-07-22 ele reportou "built" servindo um build de dois commits antes.
