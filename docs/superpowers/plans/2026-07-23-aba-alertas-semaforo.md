# Aba Alertas (semáforo de desvio) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third "Alertas" tab to the ORÇAMENTO dashboard that shows a grouped, colored (semáforo) table of Realizado/Tendência-vs-Previsto/Previsto-Inicial deviation percentages, per the approved spec `docs/superpowers/specs/2026-07-23-tabela-alertas-semaforo-design.md`.

**Architecture:** Same single-file architecture as the rest of the dashboard — everything lives in `tools/orcamento/render-dashboard.js`, HTML/CSS/JS generated as template-literal strings and embedded in one self-contained HTML file. New client-side pure functions live inside the existing `SCRIPT_CLIENTE_TABELA` template string; a small new pure helper (`calcularVigenteIdx`) lives server-side in `tools/orcamento/datas.js`. No new dependencies, no new files for runtime code.

**Tech Stack:** Node.js (`node --test`), vanilla client-side JS (no framework, no build step), Playwright for visual verification of the generated HTML.

## Global Constraints

- Semáforo thresholds and colors (fixed, from spec): `> 110%` → Excelente `#1414CC`; `90%–110%` (inclusive both ends) → Dentro da meta `#128A3E`; `70%–90%` (70 inclusive, 90 exclusive) → Atenção `#F5A700`; `< 70%` → Crítico `#D32020`; sem dado (denominador 0/null, ou numerador null) → Sem dado `#6E7580`.
- Cell text: percentage formatted with 0 decimal places, white text on the solid semáforo-colored background.
- No new npm dependencies. No TypeScript. Client code must stay valid when embedded inside a template literal (existing file already has documented gotchas around `\r`/`\n`/`\.`/`\(` escapes being consumed by the outer template literal — see existing comments in `render-dashboard.js` near `normalizarBusca`/`tipologiaColor` before writing any new regex).
- Every new pure function added to `SCRIPT_CLIENTE_TABELA` must be added to the `extrairFuncoesPuras` sandbox-extraction list in `test/orcamento-render-dashboard.test.js` (`this.nomeDaFuncao = nomeDaFuncao;` line) or tests cannot reach it.
- Run `node --test test/*.test.js` after every task; all existing tests must keep passing (no regressions to the Tabela/Gráfico tabs).
- After the full feature is built and tested, rebuild `dist/orcamento-dashboard.html`, copy it to `docs/index.html` (GitHub Pages serves `/docs`, not `/dist` — see project memory), commit, and push, per the standing auto-publish agreement for this project.

---

### Task 1: `calcularVigenteIdx` in `datas.js`

**Files:**
- Modify: `tools/orcamento/datas.js`
- Test: `test/orcamento-datas.test.js`

**Interfaces:**
- Produces: `calcularVigenteIdx(periodos, generatedAt)` — `periodos` is an array of 12 `Date` objects (UTC, Jan..Dez of one year, same shape `excelSerialParaData` already returns); `generatedAt` is a `Date`. Returns an integer: `0..11` if `generatedAt`'s UTC year matches `periodos[0]`'s UTC year (the UTC month number); `-1` if `generatedAt`'s UTC year is earlier; `12` if later. Exported from `datas.js` alongside `excelSerialParaData`/`formatarMesAno`.

- [ ] **Step 1: Write the failing tests**

Read the current file first (`test/orcamento-datas.test.js`, 23 lines) so the new tests sit alongside the existing ones in the same style. Add:

```js
test('calcularVigenteIdx returns the UTC month index (0=Jan) when generatedAt falls within the same year as periodos', () => {
  const periodos = [];
  for (let i = 0; i < 12; i++) periodos.push(new Date(Date.UTC(2026, i, 1)));
  assert.equal(calcularVigenteIdx(periodos, new Date(Date.UTC(2026, 0, 15))), 0);
  assert.equal(calcularVigenteIdx(periodos, new Date(Date.UTC(2026, 6, 21))), 6);
  assert.equal(calcularVigenteIdx(periodos, new Date(Date.UTC(2026, 11, 31))), 11);
});

test('calcularVigenteIdx returns -1 when generatedAt is a year before periodos (whole year is still future)', () => {
  const periodos = [];
  for (let i = 0; i < 12; i++) periodos.push(new Date(Date.UTC(2026, i, 1)));
  assert.equal(calcularVigenteIdx(periodos, new Date(Date.UTC(2025, 11, 20))), -1);
});

test('calcularVigenteIdx returns 12 when generatedAt is a year after periodos (whole year is already past)', () => {
  const periodos = [];
  for (let i = 0; i < 12; i++) periodos.push(new Date(Date.UTC(2026, i, 1)));
  assert.equal(calcularVigenteIdx(periodos, new Date(Date.UTC(2027, 0, 5))), 12);
});
```

Add `calcularVigenteIdx` to the `require` destructuring at the top of the test file (it currently imports `excelSerialParaData`/`formatarMesAno` from `../tools/orcamento/datas.js`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/orcamento-datas.test.js`
Expected: FAIL — `calcularVigenteIdx is not a function` (or `undefined`).

- [ ] **Step 3: Implement `calcularVigenteIdx`**

In `tools/orcamento/datas.js`, add before the `module.exports` line:

```js
// vigenteIdx (índice 0=Jan..11=Dez do "mês vigente") nunca existiu no
// pipeline real antes desta função -- compute-orcamento.js já tinha
// calcularJanelas(mensal, vigenteIdx) testado, mas build-dashboard.js nunca
// o chamava, e o client nunca recebia nenhuma data (só os rótulos <th> já
// formatados como texto). periodos é sempre Jan..Dez de um único ano
// (mesma garantia já assumida pelo resto do projeto) -- por isso comparar
// só o ano de generatedAt contra o ano de periodos[0] basta pra decidir
// entre "mês real dentro do ano" e os dois extremos (ano inteiro ainda no
// futuro / ano inteiro já no passado).
function calcularVigenteIdx(periodos, generatedAt) {
  const anoPeriodos = periodos[0].getUTCFullYear();
  const anoGerado = generatedAt.getUTCFullYear();
  if (anoGerado < anoPeriodos) return -1;
  if (anoGerado > anoPeriodos) return 12;
  return generatedAt.getUTCMonth();
}
```

Update the `module.exports` line at the bottom of `datas.js` to include it:

```js
module.exports = { excelSerialParaData, formatarMesAno, calcularVigenteIdx };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/orcamento-datas.test.js`
Expected: PASS (all tests, including the 3 new ones).

- [ ] **Step 5: Commit**

```bash
git add tools/orcamento/datas.js test/orcamento-datas.test.js
git commit -m "Add calcularVigenteIdx: the 'current month' concept the alert period buckets need"
```

---

### Task 2: Embed `window.__VIGENTE_IDX__` in the rendered dashboard

**Files:**
- Modify: `tools/orcamento/render-dashboard.js`
- Test: `test/orcamento-render-dashboard.test.js`

**Interfaces:**
- Consumes: `calcularVigenteIdx(periodos, generatedAt)` from Task 1.
- Produces: the rendered HTML contains a plain (non-encrypted — an integer is not sensitive data) `<script>window.__VIGENTE_IDX__ = <n>;</script>` tag, computed from the `periodos`/`generatedAt` already passed into `renderDashboard`.

- [ ] **Step 1: Write the failing test**

Add to `test/orcamento-render-dashboard.test.js`, near the other `renderDashboard` structural tests (e.g. after the "titles each of the 12 month columns" test):

```js
test('renderDashboard embeds window.__VIGENTE_IDX__ as a plain (non-encrypted) integer, computed from generatedAt vs the periodos month range', () => {
  // periodosExemplo() generates Jan..Dez/2026; renderComSenha's default generatedAt is 2026-07-21 (see renderComSenha) -- month index 6 (Jul, 0-based).
  const html = renderComSenha([registroExemplo()]);
  assert.match(html, /<script>window\.__VIGENTE_IDX__ = 6;<\/script>/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: FAIL — no match for `__VIGENTE_IDX__` in the rendered HTML.

- [ ] **Step 3: Implement the embed**

In `tools/orcamento/render-dashboard.js`:

Change the import at the top of the file:
```js
const { formatarMesAno, calcularVigenteIdx } = require('./datas.js');
```

In `renderDashboard`, right after the `periodos`/`generatedAt` destructuring (the function already receives both as parameters), compute the index:
```js
const vigenteIdx = calcularVigenteIdx(periodos, generatedAt);
```
(add this line right after the `if (!senha) { throw ... }` guard at the top of `renderDashboard`, before `registrosJson` is built).

Then, in the returned HTML template, right before the line `<script>window.__DADOS_CIFRADOS__ = ${dadosCifradosJson};</script>`, add a new plain script tag:
```
  <script>window.__VIGENTE_IDX__ = ${vigenteIdx};</script>
  <script>window.__DADOS_CIFRADOS__ = ${dadosCifradosJson};</script>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: PASS. Also re-check the `extrairFuncoesPuras` helper's assumption of "exactly 3 `<script>` tags" (it asserts `scripts.length === 3` matching `/<script>([\s\S]*?)<\/script>/g}`) — adding a 4th plain `<script>` tag will break that count. Update the assertion in `extrairFuncoesPuras` from:
```js
assert.equal(scripts.length, 3, 'esperava exatamente 3 <script> (dados cifrados, gate, tabela)');
const scriptTabela = scripts[2][1];
```
to:
```js
assert.equal(scripts.length, 4, 'esperava exatamente 4 <script> (vigenteIdx, dados cifrados, gate, tabela)');
const scriptTabela = scripts[3][1];
```
Run `node --test test/orcamento-render-dashboard.test.js` again.
Expected: PASS (full file — this assertion is shared by every test that calls `extrairFuncoesPuras`, so a single fix here fixes all of them).

- [ ] **Step 5: Commit**

```bash
git add tools/orcamento/render-dashboard.js test/orcamento-render-dashboard.test.js
git commit -m "Embed window.__VIGENTE_IDX__ (plain, non-sensitive) in the rendered dashboard"
```

---

### Task 3: Period-bucketing and semáforo pure functions

**Files:**
- Modify: `tools/orcamento/render-dashboard.js` (inside the `SCRIPT_CLIENTE_TABELA` template string)
- Test: `test/orcamento-render-dashboard.test.js`

**Interfaces:**
- Consumes: `somarArraysMensais` (existing, module-scope inside `SCRIPT_CLIENTE_TABELA`), `CAMPOS_RATIO` (existing), `DIAS_PREMISSA_MES` (existing).
- Produces:
  - `PERIODOS_ALERTAS_INTERVALO` — object keyed by period name, each value a function `(vigenteIdx) => [inicio, fimExclusivo]`.
  - `somarIntervaloMensal(mensal, inicio, fim)` — returns `null` if every month in `[inicio, fim)` is `null`/`undefined`, else the sum treating individual null months as 0.
  - `bucketPeriodo(valoresLista, serie, dimensao, periodo, vigenteIdx)` — returns the single bucketed number (or `null`) for that série+dimensão+período, mirroring `calcularMensal`'s per-registro aggregation and the "previsto premissa" special case, but summing raw numerador/denominador over the period's month range (never averaging monthly ratios) for `produtividade`/`ticketMedio`.
  - `classificarSemaforo(desvio)` — returns `{ cor, indicador }` given a ratio (or `null`).

- [ ] **Step 1: Write the failing tests**

Add to `test/orcamento-render-dashboard.test.js`, near the existing `calcularMensal`/`calcularTotalAno` tests, and add the 3 new function names (`bucketPeriodo`, `somarIntervaloMensal`, `classificarSemaforo`) to `extrairFuncoesPuras`'s extraction list (both the `vm.runInContext` assignment lines and the returned object):

```js
test('somarIntervaloMensal sums only the months in [inicio, fim), returns null when every month in that range is null, and treats an individual null month within a mixed range as 0', () => {
  const html = renderComSenha([registroExemplo()]);
  const { somarIntervaloMensal } = extrairFuncoesPuras(html);
  const mensal = [10, 20, 30, null, null, null, null, null, null, null, null, null];
  assert.equal(somarIntervaloMensal(mensal, 0, 3), 60);
  assert.equal(somarIntervaloMensal(mensal, 3, 6), null, 'meses 3..5 são todos null -- sem dado, não 0');
  assert.equal(somarIntervaloMensal(mensal, 2, 4), 30, 'mês 2 (30) + mês 3 (null, tratado como ausente) = só 30');
});

test('bucketPeriodo, dimensão de soma (financeiro), soma só os meses do período pedido -- acumuladoAnterior/mesVigente/acumuladoFuturo/totalAno cobrem faixas diferentes do mesmo array mensal', () => {
  const html = renderComSenha([registroExemplo()]);
  const { bucketPeriodo } = extrairFuncoesPuras(html);
  const registro = registroExemplo({
    realizado: {
      equipes: Array(12).fill(4), equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 },
      volume: Array(12).fill(80), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
      financeiro: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200], financeiroResumo: { total: 0, totalInicial: 0 },
    },
  });
  const vigenteIdx = 5; // Jun (índice 5)
  assert.equal(bucketPeriodo([registro.realizado], 'realizado', 'financeiro', 'acumuladoAnterior', vigenteIdx), 100 + 200 + 300 + 400 + 500);
  assert.equal(bucketPeriodo([registro.realizado], 'realizado', 'financeiro', 'mesVigente', vigenteIdx), 600);
  assert.equal(bucketPeriodo([registro.realizado], 'realizado', 'financeiro', 'm1', vigenteIdx), 700);
  assert.equal(bucketPeriodo([registro.realizado], 'realizado', 'financeiro', 'acumuladoAteVigente', vigenteIdx), 100 + 200 + 300 + 400 + 500 + 600);
  assert.equal(bucketPeriodo([registro.realizado], 'realizado', 'financeiro', 'acumuladoFuturo', vigenteIdx), 900 + 1000 + 1100 + 1200);
  assert.equal(bucketPeriodo([registro.realizado], 'realizado', 'financeiro', 'totalAno', vigenteIdx), 100 + 200 + 300 + 400 + 500 + 600 + 700 + 800 + 900 + 1000 + 1100 + 1200);
});

test('bucketPeriodo, dimensão de razão (produtividade/ticketMedio), soma numerador e denominador BRUTOS no intervalo e só então divide -- nunca a média das razões mensais', () => {
  const html = renderComSenha([registroExemplo()]);
  const { bucketPeriodo } = extrairFuncoesPuras(html);
  const registro = registroExemplo({
    realizado: {
      equipes: Array(12).fill(5), equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 },
      volume: Array(12).fill(100), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
      financeiro: Array(12).fill(1000), financeiroResumo: { total: 0, totalInicial: 0 },
    },
  });
  // totalAno: ticketMedio = Σfinanceiro ÷ Σvolume = (1000*12) / (100*12) = 10
  assert.equal(bucketPeriodo([registro.realizado], 'realizado', 'ticketMedio', 'totalAno', 5), 10);
  // acumuladoAnterior (5 meses, jan..mai): mesma proporção, mesmo resultado (10) -- prova que não é média,
  // é soma/soma (senão um denominador variável mudaria o resultado só quando os meses realmente diferem).
  assert.equal(bucketPeriodo([registro.realizado], 'realizado', 'ticketMedio', 'acumuladoAnterior', 5), 10);
});

test('bucketPeriodo returns the sheet premissa (period-invariant) for previsto ticketMedio/produtividade with a single tipologia, regardless of which período is asked', () => {
  const html = renderComSenha([registroExemplo()]);
  const { bucketPeriodo } = extrairFuncoesPuras(html);
  const registro = registroExemplo();
  assert.equal(bucketPeriodo([registro.previsto], 'previsto', 'ticketMedio', 'totalAno', 5), registro.previsto.volumeResumo.ticket);
  assert.equal(bucketPeriodo([registro.previsto], 'previsto', 'ticketMedio', 'mesVigente', 5), registro.previsto.volumeResumo.ticket);
});

test('bucketPeriodo returns null for a sum dimension when the baseline has zero months with real data in that período (denominador handling happens at the desvio level, not here -- this just confirms "sem dado no intervalo" propagates)', () => {
  const html = renderComSenha([registroExemplo()]);
  const { bucketPeriodo } = extrairFuncoesPuras(html);
  const registro = registroExemplo({
    realizado: {
      equipes: Array(12).fill(null), equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 },
      volume: Array(12).fill(null), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
      financeiro: Array(12).fill(null), financeiroResumo: { total: 0, totalInicial: 0 },
    },
  });
  assert.equal(bucketPeriodo([registro.realizado], 'realizado', 'financeiro', 'm3', 0), null);
});

test('classificarSemaforo classifies the 5 faixas with the exact documented boundaries and colors (spec: >110% azul, 90-110% verde, 70-90% amarelo, <70% vermelho, sem dado cinza)', () => {
  const html = renderComSenha([registroExemplo()]);
  const { classificarSemaforo } = extrairFuncoesPuras(html);
  assert.deepEqual(classificarSemaforo(1.15), { cor: '#1414CC', indicador: 'Excelente' });
  assert.deepEqual(classificarSemaforo(1.10), { cor: '#128A3E', indicador: 'Dentro da meta' }, '110% é fronteira inclusiva do lado verde, não azul');
  assert.deepEqual(classificarSemaforo(0.90), { cor: '#128A3E', indicador: 'Dentro da meta' });
  assert.deepEqual(classificarSemaforo(0.89), { cor: '#F5A700', indicador: 'Atenção' });
  assert.deepEqual(classificarSemaforo(0.70), { cor: '#F5A700', indicador: 'Atenção' }, '70% é fronteira inclusiva do lado amarelo, não vermelho');
  assert.deepEqual(classificarSemaforo(0.69), { cor: '#D32020', indicador: 'Crítico' });
  assert.deepEqual(classificarSemaforo(null), { cor: '#6E7580', indicador: 'Sem dado' });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: FAIL — `bucketPeriodo`/`somarIntervaloMensal`/`classificarSemaforo` undefined in the sandbox (add them to `extrairFuncoesPuras` first — see note above — then re-run to confirm they fail because the client script itself doesn't define them yet).

- [ ] **Step 3: Implement the functions**

Add this block inside `SCRIPT_CLIENTE_TABELA` (the template string), right after the existing `calcularTotalAno` function (which already references `CAMPOS_RATIO`/`DIAS_PREMISSA_MES`, both in scope):

```js
// Buckets de período pra aba Alertas -- [inicio, fimExclusivo) de meses,
// no mesmo array de 12 posições que calcularMensal já usa. mesVigente/
// m1/m2/m3 são um mês só; os outros somam uma faixa. Fora do range 0..11
// (vigenteIdx pode ser -1 ou 12, ver calcularVigenteIdx em datas.js) o
// próprio somarIntervaloMensal já clampa e devolve null/0 corretamente.
var PERIODOS_ALERTAS_INTERVALO = {
  acumuladoAnterior: function (v) { return [0, v]; },
  mesVigente: function (v) { return [v, v + 1]; },
  m1: function (v) { return [v + 1, v + 2]; },
  m2: function (v) { return [v + 2, v + 3]; },
  m3: function (v) { return [v + 3, v + 4]; },
  acumuladoFuturo: function (v) { return [v + 4, 12]; },
  acumuladoAteVigente: function (v) { return [0, v + 1]; },
  totalAno: function () { return [0, 12]; },
};

// Soma só os meses [inicio, fim) -- null quando NENHUM mês do intervalo tem
// dado (nada foi reportado ainda nessa janela inteira), senão soma o que
// tem tratando um mês individual em branco dentro do intervalo como 0
// (mesma convenção de somarArraysMensais, generalizada de "vários
// registros no mesmo mês" pra "vários meses no mesmo intervalo").
function somarIntervaloMensal(mensal, inicio, fim) {
  var soma = null;
  var ini = Math.max(0, inicio), lim = Math.min(mensal.length, fim);
  for (var i = ini; i < lim; i++) {
    if (mensal[i] === null || mensal[i] === undefined) continue;
    soma = (soma === null ? 0 : soma) + mensal[i];
  }
  return soma;
}

// produtividade soma equipe-DIAS no intervalo (não só equipes), mesma
// premissa de DIAS_PREMISSA_MES que calcularTotalAno já usa pro ano
// inteiro -- generalizada aqui pra qualquer intervalo de meses.
function somarIntervaloEquipeDias(mensal, inicio, fim) {
  var soma = null;
  var ini = Math.max(0, inicio), lim = Math.min(mensal.length, fim);
  for (var i = ini; i < lim; i++) {
    if (mensal[i] === null || mensal[i] === undefined) continue;
    soma = (soma === null ? 0 : soma) + mensal[i] * DIAS_PREMISSA_MES[i];
  }
  return soma;
}

// Valor de UMA série (previsto/realizado/total), pra UMA dimensão, bucketado
// num período da aba Alertas -- generaliza calcularMensal/calcularTotalAno
// (que só sabem fazer "todos os 12 meses" ou "1 mês") pra um intervalo
// arbitrário. Dimensões de razão NUNCA fazem média das razões mensais --
// somam numerador/denominador brutos no intervalo e só então dividem
// (exatamente como calcularTotalAno já faz pro ano inteiro), exceto a
// premissa fixa do Previsto de uma única tipologia, que independe do
// período (mesmo caso especial de calcularMensal/calcularTotalAno).
function bucketPeriodo(valoresLista, serie, dimensao, periodo, vigenteIdx) {
  var lista = valoresLista.filter(Boolean);
  if (!lista.length) return null;
  var intervalo = PERIODOS_ALERTAS_INTERVALO[periodo](vigenteIdx);
  var inicio = intervalo[0], fim = intervalo[1];
  var ratio = CAMPOS_RATIO[dimensao];
  if (ratio) {
    if (serie === 'previsto' && lista.length === 1) {
      var premissa = dimensao === 'produtividade' ? lista[0].equipesResumo.prod : lista[0].volumeResumo.ticket;
      return (premissa === null || premissa === undefined) ? null : premissa;
    }
    var numeradorMensal = somarArraysMensais(lista.map(function (v) { return v[ratio.numerador]; }));
    var denominadorMensal = somarArraysMensais(lista.map(function (v) { return v[ratio.denominador]; }));
    var numeradorBucket = somarIntervaloMensal(numeradorMensal, inicio, fim);
    var denominadorBucket = dimensao === 'produtividade'
      ? somarIntervaloEquipeDias(denominadorMensal, inicio, fim)
      : somarIntervaloMensal(denominadorMensal, inicio, fim);
    if (numeradorBucket === null || !denominadorBucket) return null;
    return numeradorBucket / denominadorBucket;
  }
  var mensal = somarArraysMensais(lista.map(function (v) { return v[dimensao]; }));
  return somarIntervaloMensal(mensal, inicio, fim);
}

// Faixas fixas do semáforo (spec 2026-07-23) -- mesma regra pra todas as
// dimensões, já que Financeiro aqui é receita bruta (não custo): maior é
// sempre melhor, sem inversão. Limites: >110% azul; 90%-110% (inclusive
// nas duas pontas) verde; 70%-90% (70 inclusive, 90 exclusivo) amarelo;
// <70% vermelho; sem dado (desvio null) cinza.
function classificarSemaforo(desvio) {
  if (desvio === null || desvio === undefined) return { cor: '#6E7580', indicador: 'Sem dado' };
  if (desvio > 1.10) return { cor: '#1414CC', indicador: 'Excelente' };
  if (desvio >= 0.90) return { cor: '#128A3E', indicador: 'Dentro da meta' };
  if (desvio >= 0.70) return { cor: '#F5A700', indicador: 'Atenção' };
  return { cor: '#D32020', indicador: 'Crítico' };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: PASS (all tests, old and new).

- [ ] **Step 5: Commit**

```bash
git add tools/orcamento/render-dashboard.js test/orcamento-render-dashboard.test.js
git commit -m "Add bucketPeriodo/somarIntervaloMensal/classificarSemaforo -- the pure math behind the Alertas semáforo"
```

---

### Task 4: Generalize `montarFiltroMulti` to support an explicit state object and an "exclusivo" (single-choice) mode

**Files:**
- Modify: `tools/orcamento/render-dashboard.js` (inside `SCRIPT_CLIENTE_TABELA`)
- Test: `test/orcamento-render-dashboard.test.js`

Why this task exists: the approved spec commits to reusing the same `filtro-multi` dropdown-checkbox visual component for all 5 Alertas selectors, but with a state object of their own (not `filtrosSelecionados`, which must keep controlling only Tabela/Gráfico), and two of the five ("Agrupar por", "Dimensão") must behave as single-choice (checking one unchecks the rest), unlike every existing filter which is genuine multi-select. `montarFiltroMulti`/`atualizarRotuloFiltro` currently hardcode the module-global `filtrosSelecionados` object and have no single-choice mode — both need a small, backward-compatible generalization before Task 5 can add the Alertas config entries.

**Interfaces:**
- Consumes: existing `montarFiltroMulti(cfg, registros)`, `atualizarRotuloFiltro(cfg, opcoes)`, `filtrosSelecionados`, `FILTROS_CONFIG`.
- Produces: `montarFiltroMulti(cfg, registros, estado)` — 3rd parameter, defaults to `filtrosSelecionados` when omitted (every existing call site keeps working unchanged). `cfg.exclusivo: true` — when set, checking a checkbox clears every other value in that Set first (so exactly one stays checked), and unchecking the only checked one is blocked exactly like `cfg.minimoUm` already does (an exclusivo filter is implicitly `minimoUm`).

- [ ] **Step 1: Write the failing tests**

Add to `test/orcamento-render-dashboard.test.js`. These tests exercise `montarFiltroMulti` directly against a hand-built DOM fragment (not the full `document` sandbox stub used elsewhere in this file), so first extend the sandbox in `extrairFuncoesPuras` to also expose `montarFiltroMulti`, `FILTROS_CONFIG`, and a way to hand it a real-ish DOM. Given the existing sandbox's `document` stub is a minimal stand-in (`getElementById`/`querySelectorAll` returning fixed fake nodes), testing `montarFiltroMulti`'s DOM-writing behavior directly is disproportionate — instead, test the **state-mutation logic** in isolation by extracting just the exclusivo-handling branch into its own tiny pure helper, which is both easier to test and keeps `montarFiltroMulti` itself simple:

```js
test('aplicarSelecaoExclusiva (extraído do HTML real gerado) clears every other value in the Set when checking one, in exclusivo mode -- exactly one value stays selected', () => {
  const html = renderComSenha([registroExemplo()]);
  const { aplicarSelecaoExclusiva } = extrairFuncoesPuras(html);
  const estado = new Set(['sup']);
  aplicarSelecaoExclusiva(estado, 'tipologia');
  assert.deepEqual(paraPlano(estado), ['tipologia']);
});

test('aplicarSelecaoExclusiva is a no-op when the value being checked is already the only one selected', () => {
  const html = renderComSenha([registroExemplo()]);
  const { aplicarSelecaoExclusiva } = extrairFuncoesPuras(html);
  const estado = new Set(['sup']);
  aplicarSelecaoExclusiva(estado, 'sup');
  assert.deepEqual(paraPlano(estado), ['sup']);
});
```

Add `aplicarSelecaoExclusiva` to the `extrairFuncoesPuras` extraction list.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: FAIL — `aplicarSelecaoExclusiva` undefined.

- [ ] **Step 3: Implement the generalization**

In `tools/orcamento/render-dashboard.js`, inside `SCRIPT_CLIENTE_TABELA`:

Add this small pure helper right before `montarFiltroMulti`:
```js
// Modo "exclusivo" de um filtro-multi (Agrupar por / Dimensão da aba
// Alertas): checar um valor esvazia o Set antes de adicionar, deixando
// exatamente 1 marcado -- as 5 opções continuam sendo checkboxes (mesmo
// componente visual dos outros filtros), só o COMPORTAMENTO vira
// radio-like. Função separada (sem DOM) pra poder testar sozinha.
function aplicarSelecaoExclusiva(estadoSet, valor) {
  estadoSet.clear();
  estadoSet.add(valor);
}
```

Change the signature and body of `montarFiltroMulti` (currently `function montarFiltroMulti(cfg, registros) { ... }`, using the module-global `filtrosSelecionados[cfg.chave]` in 5 places) to accept an explicit 3rd parameter defaulting to the existing global, and to call `aplicarSelecaoExclusiva` when `cfg.exclusivo` is set. The full updated function:

```js
function montarFiltroMulti(cfg, registros, estado) {
  var estadoFiltros = estado || filtrosSelecionados;
  var opcoes = opcoesFiltro(cfg, registros);
  var valoresValidos = {};
  opcoes.forEach(function (o) { valoresValidos[o.valor] = true; });
  estadoFiltros[cfg.chave].forEach(function (v) {
    if (!valoresValidos[v]) estadoFiltros[cfg.chave].delete(v);
  });

  var painel = document.querySelector('#' + cfg.id + ' .filtro-multi-painel');
  var listaHtml = opcoes.length
    ? opcoes.map(function (o) {
        var marcado = estadoFiltros[cfg.chave].has(o.valor) ? ' checked' : '';
        return '<label class="filtro-multi-item"><input type="checkbox" value="' + escapeHtml(o.valor) + '"' + marcado + '>' + escapeHtml(o.rotulo) + '</label>';
      }).join('')
    : '<div class="filtro-multi-vazio">Nenhuma opção</div>';
  painel.innerHTML =
    (opcoes.length ? '<input type="text" class="filtro-multi-busca" placeholder="Buscar..." autocomplete="off">' : '') +
    listaHtml +
    '<div class="filtro-multi-vazio filtro-multi-vazio-busca" hidden>Nenhum resultado</div>';

  var busca = painel.querySelector('.filtro-multi-busca');
  if (busca) {
    busca.addEventListener('input', function () {
      var termo = normalizarBusca(busca.value);
      var algumVisivel = false;
      painel.querySelectorAll('.filtro-multi-item').forEach(function (item) {
        var combina = normalizarBusca(item.textContent).indexOf(termo) !== -1;
        item.style.display = combina ? '' : 'none';
        if (combina) algumVisivel = true;
      });
      painel.querySelector('.filtro-multi-vazio-busca').hidden = algumVisivel || termo === '';
    });
  }

  painel.querySelectorAll('input[type="checkbox"]').forEach(function (checkbox) {
    checkbox.addEventListener('change', function () {
      if ((cfg.minimoUm || cfg.exclusivo) && !checkbox.checked && estadoFiltros[cfg.chave].size === 1) {
        checkbox.checked = true;
        return;
      }
      if (checkbox.checked) {
        if (cfg.exclusivo) aplicarSelecaoExclusiva(estadoFiltros[cfg.chave], checkbox.value);
        else estadoFiltros[cfg.chave].add(checkbox.value);
      } else {
        estadoFiltros[cfg.chave].delete(checkbox.value);
      }
      atualizarRotuloFiltro(cfg, opcoes, estadoFiltros);
      if (cfg.exclusivo) montarFiltroMulti(cfg, registros, estado);
      if (cfg.chave === 'categoria') {
        var cfgTipologia = FILTROS_CONFIG.filter(function (c) { return c.chave === 'tipologia'; })[0];
        montarFiltroMulti(cfgTipologia, registros);
      }
      if (cfg.chave === 'dimensao') {
        document.getElementById('corpo-tabela').innerHTML = renderCorpoTabela(window.__REGISTROS__, dimensoesEmOrdem(filtrosSelecionados.dimensao));
      }
      cfg.aoMudar ? cfg.aoMudar() : recalcularTabela();
    });
  });
  atualizarRotuloFiltro(cfg, opcoes, estadoFiltros);
}
```

Note the exclusivo branch re-renders the panel (`montarFiltroMulti(cfg, registros, estado)`) right after mutating state, so the checkbox list visually reflects "only one checked" immediately — the DOM's `checked` attributes don't auto-update from the Set mutation alone. `cfg.aoMudar` is a new optional per-filter callback (defaults to the existing `recalcularTabela()`), needed in Task 5 so Alertas' own config entries trigger their own recalculation function instead.

Update `atualizarRotuloFiltro` the same way (3rd parameter, default to the global):
```js
function atualizarRotuloFiltro(cfg, opcoes, estado) {
  var estadoFiltros = estado || filtrosSelecionados;
  var trigger = document.querySelector('#' + cfg.id + ' .filtro-multi-trigger');
  var seta = trigger.querySelector('.filtro-multi-seta');
  var selecionados = estadoFiltros[cfg.chave];
  var texto;
  if (selecionados.size === 0) {
    texto = cfg.rotuloPadrao;
  } else if (selecionados.size === 1) {
    var valor = selecionados.values().next().value;
    var opcao = opcoes.filter(function (o) { return o.valor === valor; })[0];
    texto = opcao ? opcao.rotulo : valor;
  } else {
    texto = selecionados.size + ' selecionadas';
  }
  trigger.textContent = texto;
  trigger.appendChild(seta);
}
```

Update `montarTodosFiltrosMulti` — unchanged, it only drives the recorte filters (`FILTROS_CONFIG`), still calls `montarFiltroMulti(cfg, registros)` with no 3rd arg, defaulting correctly.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: PASS — every existing filter test must still pass unchanged (this task is a pure refactor plus additive behavior; no existing call site's behavior changes since every existing `FILTROS_CONFIG` entry has no `exclusivo`/`aoMudar` and every existing call omits the 3rd argument).

- [ ] **Step 5: Commit**

```bash
git add tools/orcamento/render-dashboard.js test/orcamento-render-dashboard.test.js
git commit -m "Generalize montarFiltroMulti with an explicit state param and an exclusivo (single-choice) mode"
```

---

### Task 5: Alertas-specific config, state, and grouping helpers

**Files:**
- Modify: `tools/orcamento/render-dashboard.js` (inside `SCRIPT_CLIENTE_TABELA`)
- Test: `test/orcamento-render-dashboard.test.js`

**Interfaces:**
- Consumes: `DIMENSOES_CONFIG`, `categoriaTipologia`, `montarFiltroMulti`/`atualizarRotuloFiltro` (Task 4), `dimensoesEmOrdem`-style ordering pattern.
- Produces:
  - `NUMERICO_ORDEM = ['realizado', 'total']`, `BASELINE_ORDEM = ['previsto', 'previstoInicial']`, `PERIODO_ORDEM = ['acumuladoAnterior', 'mesVigente', 'm1', 'm2', 'm3', 'acumuladoFuturo', 'acumuladoAteVigente', 'totalAno']`.
  - `PERIODO_LABELS` — object mapping each period key to its display label.
  - `emOrdemCanonica(ordemCanonica, selecionadas)` — generic version of the existing `dimensoesEmOrdem` pattern: filters `ordemCanonica` down to values present in the `selecionadas` Set, preserving canonical order.
  - `campoAgrupamento(registro, agruparPor)` — returns `categoriaTipologia(registro.tipologia)` when `agruparPor === 'categoria'`, else `registro[agruparPor]`.
  - `agruparIndicesAlertas(registros, indices, agruparPor)` — returns an array of `{ chave, indices }`, one per distinct value of `campoAgrupamento`, alphabetically sorted by `chave`.
  - `FILTROS_ALERTAS_CONFIG` (array, same shape as `FILTROS_CONFIG` entries) and `filtrosAlertas` (state object, one Set per config entry, with the documented defaults).

- [ ] **Step 1: Write the failing tests**

```js
test('emOrdemCanonica (extraído do HTML real gerado) filters a canonical order array down to whatever is in the Set, preserving canonical order regardless of Set insertion order', () => {
  const html = renderComSenha([registroExemplo()]);
  const { emOrdemCanonica } = extrairFuncoesPuras(html);
  const ordem = ['acumuladoAnterior', 'mesVigente', 'm1', 'm2', 'm3', 'acumuladoFuturo', 'acumuladoAteVigente', 'totalAno'];
  const selecionadas = new Set(['totalAno', 'mesVigente']);
  assert.deepEqual(paraPlano(emOrdemCanonica(ordem, selecionadas)), ['mesVigente', 'totalAno']);
});

test('campoAgrupamento (extraído do HTML real gerado) reads the field directly for sup/tipologia/grupo/origem, but derives categoria via categoriaTipologia (not a stored field)', () => {
  const html = renderComSenha([registroExemplo()]);
  const { campoAgrupamento } = extrairFuncoesPuras(html);
  const registro = { sup: 'SUP-A', tipologia: 'LAB.E', grupo: 'PÁTRIA', origem: 'CONTRATO VIGENTE' };
  assert.equal(campoAgrupamento(registro, 'sup'), 'SUP-A');
  assert.equal(campoAgrupamento(registro, 'tipologia'), 'LAB.E');
  assert.equal(campoAgrupamento(registro, 'categoria'), 'labEspecial');
});

test('agruparIndicesAlertas (extraído do HTML real gerado) groups the given indices by campoAgrupamento, alphabetically by chave, aggregating every matching index per group', () => {
  const html = renderComSenha([registroExemplo()]);
  const { agruparIndicesAlertas } = extrairFuncoesPuras(html);
  const registros = [
    { sup: 'SUP-B', tipologia: 'SM' },
    { sup: 'SUP-A', tipologia: 'ST' },
    { sup: 'SUP-A', tipologia: 'SM' },
  ];
  const grupos = agruparIndicesAlertas(registros, [0, 1, 2], 'sup');
  assert.deepEqual(paraPlano(grupos), [
    { chave: 'SUP-A', indices: [1, 2] },
    { chave: 'SUP-B', indices: [0] },
  ]);
});

test('agruparIndicesAlertas only considers the indices it is given (respects an upstream recorte filter), not every registro in the array', () => {
  const html = renderComSenha([registroExemplo()]);
  const { agruparIndicesAlertas } = extrairFuncoesPuras(html);
  const registros = [
    { sup: 'SUP-A', tipologia: 'SM' },
    { sup: 'SUP-B', tipologia: 'ST' },
  ];
  const grupos = agruparIndicesAlertas(registros, [0], 'sup');
  assert.deepEqual(paraPlano(grupos), [{ chave: 'SUP-A', indices: [0] }]);
});
```

Add `emOrdemCanonica`, `campoAgrupamento`, `agruparIndicesAlertas` to `extrairFuncoesPuras`'s extraction list.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: FAIL — the 3 new functions are undefined.

- [ ] **Step 3: Implement**

Add this block inside `SCRIPT_CLIENTE_TABELA`, right after `dimensoesEmOrdem` (so it sits next to the pattern it generalizes):

```js
// Generaliza dimensoesEmOrdem pra qualquer lista de valores canônicos --
// devolve só os que estão em `selecionadas`, na ordem de `ordemCanonica`
// (nunca na ordem em que a pessoa marcou os checkboxes).
function emOrdemCanonica(ordemCanonica, selecionadas) {
  return ordemCanonica.filter(function (v) { return selecionadas.has(v); });
}

var NUMERICO_ORDEM = ['realizado', 'total'];
var BASELINE_ORDEM = ['previsto', 'previstoInicial'];
var PERIODO_ORDEM = ['acumuladoAnterior', 'mesVigente', 'm1', 'm2', 'm3', 'acumuladoFuturo', 'acumuladoAteVigente', 'totalAno'];
var PERIODO_LABELS = {
  acumuladoAnterior: 'Acumulado Anterior', mesVigente: 'Mês Vigente',
  m1: 'M+1', m2: 'M+2', m3: 'M+3', acumuladoFuturo: 'Acumulado Futuro',
  acumuladoAteVigente: 'Acumulado até Vigente', totalAno: 'Total Ano',
};

// "Agrupar por" precisa ler categoria (derivada de tipologia, nunca
// guardada no registro) do mesmo jeito que indicesFiltrados/opcoesFiltro
// já fazem pro filtro de categoria -- generalizado aqui pra qualquer campo
// de agrupamento, não só os campos que existem direto no registro.
function campoAgrupamento(registro, agruparPor) {
  return agruparPor === 'categoria' ? categoriaTipologia(registro.tipologia) : registro[agruparPor];
}

// Agrupa só os `indices` recebidos (já filtrados pelo recorte atual) por
// campoAgrupamento, em ordem alfabética de chave -- cada grupo soma TODOS
// os índices que caem nele, não só o primeiro visto.
function agruparIndicesAlertas(registros, indices, agruparPor) {
  var porChave = {};
  var ordem = [];
  indices.forEach(function (idx) {
    var chave = campoAgrupamento(registros[idx], agruparPor);
    if (!porChave[chave]) { porChave[chave] = []; ordem.push(chave); }
    porChave[chave].push(idx);
  });
  ordem.sort();
  return ordem.map(function (chave) { return { chave: chave, indices: porChave[chave] }; });
}
```

Add this block right after `FILTROS_CONFIG`'s closing `];` (so both filter-config arrays live together):

```js
// Config dos 5 seletores próprios da aba Alertas -- mesmo componente
// visual (filtro-multi) dos filtros de recorte, mas com estado PRÓPRIO
// (filtrosAlertas, não filtrosSelecionados) e, pra Agrupar por/Dimensão,
// exclusivo:true (single-choice, ver montarFiltroMulti). aoMudar aponta
// pra recalcularAlertas (definida na Task 7) em vez do recalcularTabela
// default, já que mudar um seletor da Alertas não deve tocar a Tabela/
// Gráfico.
var FILTROS_ALERTAS_CONFIG = [
  { id: 'filtro-alertas-agrupar-por', chave: 'agruparPor', rotuloPadrao: 'Agrupar por', exclusivo: true, opcoesFixas: [
    { valor: 'sup', rotulo: 'SUP' },
    { valor: 'tipologia', rotulo: 'Tipologia' },
    { valor: 'grupo', rotulo: 'Grupo' },
    { valor: 'categoria', rotulo: 'Categoria' },
    { valor: 'origem', rotulo: 'Origem' },
  ], aoMudar: function () { recalcularAlertas(); } },
  { id: 'filtro-alertas-dimensao', chave: 'dimensao', rotuloPadrao: 'Dimensão', exclusivo: true, opcoesFixas: DIMENSOES_CONFIG,
    aoMudar: function () { recalcularAlertas(); } },
  { id: 'filtro-alertas-numerico', chave: 'numerico', rotuloPadrao: 'Selecione ao menos 1', minimoUm: true, opcoesFixas: [
    { valor: 'realizado', rotulo: 'Realizado' },
    { valor: 'total', rotulo: 'Tendência' },
  ], aoMudar: function () { recalcularAlertas(); } },
  { id: 'filtro-alertas-baseline', chave: 'baseline', rotuloPadrao: 'Selecione ao menos 1', minimoUm: true, opcoesFixas: [
    { valor: 'previsto', rotulo: 'Previsto' },
    { valor: 'previstoInicial', rotulo: 'Previsto Inicial' },
  ], aoMudar: function () { recalcularAlertas(); } },
  { id: 'filtro-alertas-periodo', chave: 'periodo', rotuloPadrao: 'Selecione ao menos 1', minimoUm: true, opcoesFixas: PERIODO_ORDEM.map(function (p) { return { valor: p, rotulo: PERIODO_LABELS[p] }; }),
    aoMudar: function () { recalcularAlertas(); } },
];

var filtrosAlertas = {};
FILTROS_ALERTAS_CONFIG.forEach(function (cfg) { filtrosAlertas[cfg.chave] = new Set(); });
filtrosAlertas.agruparPor.add('sup');
filtrosAlertas.dimensao.add('financeiro');
filtrosAlertas.numerico.add('realizado');
filtrosAlertas.numerico.add('total');
filtrosAlertas.baseline.add('previsto');
filtrosAlertas.periodo.add('acumuladoAteVigente');
filtrosAlertas.periodo.add('totalAno');
```

Note: `FILTROS_ALERTAS_CONFIG`'s `dimensao` chave intentionally reuses the name `'dimensao'` — that's fine, it lives in `filtrosAlertas`, a completely separate object from `filtrosSelecionados`, so there's no collision with the Tabela/Gráfico dimension filter.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: PASS. (`recalcularAlertas` is referenced inside the `aoMudar` closures but not yet defined — that's fine, JS closures resolve it lazily at call time, and it's only invoked once wired up in Task 7; it must not be *called* by anything before then. Confirm the test run doesn't invoke `montarFiltroMulti`/the change handlers yet — it only tests the pure helpers above, which don't touch `FILTROS_ALERTAS_CONFIG`.)

- [ ] **Step 5: Commit**

```bash
git add tools/orcamento/render-dashboard.js test/orcamento-render-dashboard.test.js
git commit -m "Add Alertas selector config/state and the campo-agrupamento grouping helpers"
```

---

### Task 6: Build the Alertas table HTML (header + body)

**Files:**
- Modify: `tools/orcamento/render-dashboard.js` (inside `SCRIPT_CLIENTE_TABELA`)
- Test: `test/orcamento-render-dashboard.test.js`

**Interfaces:**
- Consumes: `agruparIndicesAlertas`, `bucketPeriodo`, `classificarSemaforo`, `emOrdemCanonica`, `NUMERICO_ORDEM`/`BASELINE_ORDEM`/`PERIODO_ORDEM`/`PERIODO_LABELS`, `SERIE_LABELS` (existing — has `previsto`/`realizado`/`total`; needs `previstoInicial` too, already present), `formatarNumero` (existing), `escapeHtml` (existing).
- Produces:
  - `colunasAlertas(numericos, baselines, periodos)` — returns an ordered array of `{ numerico, baseline, periodo, rotulo }`, one per combination, in the fixed order Período → Numérico → Baseline (per spec).
  - `calcularCelulaAlerta(registros, indices, coluna, dimensao, vigenteIdx)` — returns `{ desvio, numerador, denominador }` for one group's indices and one column.
  - `renderCabecalhoAlertas(agruparPorRotulo, colunas)` — returns the `<tr>...</tr>` header row HTML string.
  - `renderCorpoAlertas(registros, indices, agruparPor, dimensao, numericos, baselines, periodos, vigenteIdx)` — returns the full `<tbody>` inner HTML string: one row per group plus a final TOTAL GERAL row.

- [ ] **Step 1: Write the failing tests**

```js
test('colunasAlertas builds one column per Período×Numérico×Baseline combination, in that fixed order (not selection order), with the "Numérico ÷ Baseline — Período" label', () => {
  const html = renderComSenha([registroExemplo()]);
  const { colunasAlertas } = extrairFuncoesPuras(html);
  const colunas = colunasAlertas(['total', 'realizado'], ['previstoInicial', 'previsto'], ['totalAno', 'acumuladoAteVigente']);
  assert.deepEqual(paraPlano(colunas.map(function (c) { return c.rotulo; })), [
    'Realizado ÷ Previsto — Acumulado até Vigente',
    'Realizado ÷ Previsto Inicial — Acumulado até Vigente',
    'Tendência ÷ Previsto — Acumulado até Vigente',
    'Tendência ÷ Previsto Inicial — Acumulado até Vigente',
    'Realizado ÷ Previsto — Total Ano',
    'Realizado ÷ Previsto Inicial — Total Ano',
    'Tendência ÷ Previsto — Total Ano',
    'Tendência ÷ Previsto Inicial — Total Ano',
  ]);
});

test('calcularCelulaAlerta divides the bucketed numérico value by the bucketed baseline value for the given group of indices, and returns null desvio (sem dado) when the baseline bucket is zero', () => {
  const html = renderComSenha([registroExemplo()]);
  const { calcularCelulaAlerta, colunasAlertas } = extrairFuncoesPuras(html);
  const registro = registroExemplo({
    previsto: {
      equipes: Array(12).fill(5), equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 },
      volume: Array(12).fill(100), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
      financeiro: Array(12).fill(1000), financeiroResumo: { total: 0, totalInicial: 0 },
    },
    realizado: {
      equipes: Array(12).fill(4), equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 },
      volume: Array(12).fill(80), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
      financeiro: Array(12).fill(1100), financeiroResumo: { total: 0, totalInicial: 0 },
    },
  });
  const coluna = colunasAlertas(['realizado'], ['previsto'], ['totalAno'])[0];
  const celula = calcularCelulaAlerta([registro], [0], coluna, 'financeiro', 5);
  assert.equal(celula.numerador, 1100 * 12);
  assert.equal(celula.denominador, 1000 * 12);
  assert.ok(Math.abs(celula.desvio - 1.1) < 1e-9);

  const registroSemPrevisto = registroExemplo({
    previsto: {
      equipes: Array(12).fill(0), equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 },
      volume: Array(12).fill(0), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
      financeiro: Array(12).fill(0), financeiroResumo: { total: 0, totalInicial: 0 },
    },
  });
  const celulaSemDado = calcularCelulaAlerta([registroSemPrevisto], [0], coluna, 'financeiro', 5);
  assert.equal(celulaSemDado.desvio, null);
});

test('renderCorpoAlertas emits one row per distinct group value (agrupado por SUP), sorted alphabetically, plus a final TOTAL GERAL row summing every given index', () => {
  const html = renderComSenha([registroExemplo()]);
  const { renderCorpoAlertas } = extrairFuncoesPuras(html);
  const registroB = registroExemplo({ sup: 'SUP-B' });
  const registroA = registroExemplo({ sup: 'SUP-A' });
  const corpo = renderCorpoAlertas([registroB, registroA], [0, 1], 'sup', 'financeiro', ['realizado'], ['previsto'], ['totalAno'], 5);
  const posA = corpo.indexOf('SUP-A');
  const posB = corpo.indexOf('SUP-B');
  const posTotalGeral = corpo.indexOf('TOTAL GERAL');
  assert.ok(posA >= 0 && posB >= 0 && posTotalGeral >= 0);
  assert.ok(posA < posB, 'SUP-A vem antes de SUP-B (ordem alfabética)');
  assert.ok(posB < posTotalGeral, 'TOTAL GERAL vem por último');
  assert.equal((corpo.match(/<tr/g) || []).length, 3, '2 grupos (SUP-A, SUP-B) + 1 TOTAL GERAL');
});

test('renderCorpoAlertas paints each cell with the semáforo background color and the desvio as a whole-number percentage, with a tooltip title showing the absolute numerador/baseline', () => {
  const html = renderComSenha([registroExemplo()]);
  const { renderCorpoAlertas } = extrairFuncoesPuras(html);
  const registro = registroExemplo({
    previsto: {
      equipes: Array(12).fill(5), equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 },
      volume: Array(12).fill(100), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
      financeiro: Array(12).fill(1000), financeiroResumo: { total: 0, totalInicial: 0 },
    },
    realizado: {
      equipes: Array(12).fill(4), equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 },
      volume: Array(12).fill(80), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
      financeiro: Array(12).fill(1100), financeiroResumo: { total: 0, totalInicial: 0 },
    },
  });
  const corpo = renderCorpoAlertas([registro], [0], 'sup', 'financeiro', ['realizado'], ['previsto'], ['totalAno'], 5);
  assert.match(corpo, /background:#1414CC/, 'desvio de 110% cai na faixa Excelente (azul)');
  assert.match(corpo, />110%</);
  assert.match(corpo, /title="Realizado: 13\.200[^"]*Previsto: 12\.000/);
});

test('renderCabecalhoAlertas labels the first column with the current "agrupar por" choice and one <th> per coluna, in order', () => {
  const html = renderComSenha([registroExemplo()]);
  const { renderCabecalhoAlertas, colunasAlertas } = extrairFuncoesPuras(html);
  const colunas = colunasAlertas(['realizado'], ['previsto'], ['totalAno']);
  const cabecalho = renderCabecalhoAlertas('SUP', colunas);
  assert.match(cabecalho, /<th>SUP<\/th>/);
  assert.match(cabecalho, /<th>Realizado ÷ Previsto — Total Ano<\/th>/);
});
```

Add `colunasAlertas`, `calcularCelulaAlerta`, `renderCabecalhoAlertas`, `renderCorpoAlertas` to `extrairFuncoesPuras`'s extraction list.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: FAIL — the 4 new functions are undefined.

- [ ] **Step 3: Implement**

Add this block inside `SCRIPT_CLIENTE_TABELA`, right after `classificarSemaforo` (Task 3):

```js
// Uma coluna por combinação marcada de Período×Numérico×Baseline, na
// ordem fixa Período -> Numérico -> Baseline (spec 2026-07-23) -- nunca a
// ordem em que a pessoa marcou os checkboxes.
function colunasAlertas(numericos, baselines, periodos) {
  var colunas = [];
  periodos.forEach(function (periodo) {
    numericos.forEach(function (numerico) {
      baselines.forEach(function (baseline) {
        colunas.push({
          numerico: numerico, baseline: baseline, periodo: periodo,
          rotulo: SERIE_LABELS[numerico] + ' ÷ ' + SERIE_LABELS[baseline] + ' — ' + PERIODO_LABELS[periodo],
        });
      });
    });
  });
  return colunas;
}

// Bucketa numérico e baseline pro grupo de índices dado (soma os
// registros do grupo, ver bucketPeriodo) e divide -- null (sem dado)
// quando o denominador bucketado é 0/null, ou quando o numerador vier
// null (nada reportado ainda nesse intervalo).
function calcularCelulaAlerta(registros, indices, coluna, dimensao, vigenteIdx) {
  var valoresNumerico = indices.map(function (i) { return registros[i][coluna.numerico]; });
  var valoresBaseline = indices.map(function (i) { return registros[i][coluna.baseline]; });
  var numerador = bucketPeriodo(valoresNumerico, coluna.numerico, dimensao, coluna.periodo, vigenteIdx);
  var denominador = bucketPeriodo(valoresBaseline, coluna.baseline, dimensao, coluna.periodo, vigenteIdx);
  var desvio = (numerador === null || !denominador) ? null : numerador / denominador;
  return { desvio: desvio, numerador: numerador, denominador: denominador };
}

var AGRUPAR_POR_ROTULO = { sup: 'SUP', tipologia: 'Tipologia', grupo: 'Grupo', categoria: 'Categoria', origem: 'Origem' };

function renderCabecalhoAlertas(agruparPorRotulo, colunas) {
  return '<tr><th>' + escapeHtml(agruparPorRotulo) + '</th>' +
    colunas.map(function (c) { return '<th>' + escapeHtml(c.rotulo) + '</th>'; }).join('') +
    '</tr>';
}

function renderCelulaAlerta(registros, indices, coluna, dimensao, vigenteIdx) {
  var celula = calcularCelulaAlerta(registros, indices, coluna, dimensao, vigenteIdx);
  var classe = classificarSemaforo(celula.desvio);
  var texto = celula.desvio === null ? '—' : Math.round(celula.desvio * 100) + '%';
  var tooltip = SERIE_LABELS[coluna.numerico] + ': ' + formatarNumero(celula.numerador, 0) + ' · ' +
    SERIE_LABELS[coluna.baseline] + ': ' + formatarNumero(celula.denominador, 0);
  return '<td class="celula-alerta" style="background:' + classe.cor + '" title="' + escapeHtml(tooltip) + '">' + texto + '</td>';
}

function renderLinhaAlerta(rotuloLinha, registros, indices, colunas, dimensao, vigenteIdx) {
  return '<tr><td>' + escapeHtml(rotuloLinha) + '</td>' +
    colunas.map(function (c) { return renderCelulaAlerta(registros, indices, c, dimensao, vigenteIdx); }).join('') +
    '</tr>';
}

function renderCorpoAlertas(registros, indices, agruparPor, dimensao, numericos, baselines, periodos, vigenteIdx) {
  var colunas = colunasAlertas(numericos, baselines, periodos);
  var grupos = agruparIndicesAlertas(registros, indices, agruparPor);
  var linhas = grupos.map(function (g) { return renderLinhaAlerta(g.chave, registros, g.indices, colunas, dimensao, vigenteIdx); });
  linhas.push(renderLinhaAlerta('TOTAL GERAL', registros, indices, colunas, dimensao, vigenteIdx));
  return linhas.join('');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/orcamento/render-dashboard.js test/orcamento-render-dashboard.test.js
git commit -m "Build the Alertas table HTML: colunasAlertas/calcularCelulaAlerta/renderCabecalhoAlertas/renderCorpoAlertas"
```

---

### Task 7: HTML/CSS shell and lifecycle wiring for the Alertas tab

This task merges what would otherwise be two interdependent halves (HTML shell, JS wiring) into one: the JS wiring references DOM ids (`secao-alertas`, `aba-alertas`, `filtro-alertas-*`, `cabecalho-alertas`, `corpo-alertas`) that only the HTML defines, and the HTML is meaningless without the JS behind it — neither half is independently reviewable/testable, so per task right-sizing they belong in the same task rather than leaving one half's tests red until the next commit.

**Files:**
- Modify: `tools/orcamento/render-dashboard.js` (the `renderDashboard` function's returned HTML template + its `<style>` block, and the `SCRIPT_CLIENTE_TABELA` template string)
- Test: `test/orcamento-render-dashboard.test.js`

**Interfaces:**
- Consumes: `alternarAba` (existing), `montarDashboard`/`limparFiltros`/`atualizarDadosAoVivo` (existing), `indicesFiltrados` (existing), `renderCabecalhoAlertas`/`renderCorpoAlertas`/`emOrdemCanonica`/`FILTROS_ALERTAS_CONFIG`/`filtrosAlertas`/`AGRUPAR_POR_ROTULO` (Tasks 5-6), `window.__VIGENTE_IDX__` (Task 2).
- Produces: `recalcularAlertas()` — the function referenced (but not yet defined) by the `aoMudar` closures in Task 5; rebuilds both `#cabecalho-alertas` and `#corpo-alertas` from current recorte filters + Alertas selectors. `alternarAba` gains a third `'alertas'` branch. `montarDashboard` wires the new tab button and calls `recalcularAlertas()` once at startup. `limparFiltros` and `atualizarDadosAoVivo` also call `recalcularAlertas()` after they finish (recorte filters changed, and the Alertas tab must never show stale content even if it isn't the active tab right now — same "always fully rebuilt" philosophy already used for the existing Gráfico tab).

- [ ] **Step 1: Write the failing tests**

```js
test('renderDashboard includes the Alertas tab button, the 5 Alertas selector containers (agrupar-por/dimensao/numerico/baseline/periodo), and the empty alertas table shell', () => {
  const html = renderComSenha([registroExemplo()]);
  assert.match(html, /<button id="aba-alertas" type="button"><svg[\s\S]*?<\/svg>Alertas<\/button>/);
  assert.match(html, /<div id="secao-alertas" style="display:none">/);
  assert.match(html, /<div class="filtro-multi" id="filtro-alertas-agrupar-por">/);
  assert.match(html, /<div class="filtro-multi" id="filtro-alertas-dimensao">/);
  assert.match(html, /<div class="filtro-multi" id="filtro-alertas-numerico">/);
  assert.match(html, /<div class="filtro-multi" id="filtro-alertas-baseline">/);
  assert.match(html, /<div class="filtro-multi" id="filtro-alertas-periodo">/);
  assert.match(html, /<table id="tabela-alertas">/);
  assert.match(html, /<thead id="cabecalho-alertas"><\/thead>/);
  assert.match(html, /<tbody id="corpo-alertas"><\/tbody>/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: FAIL — none of the Alertas HTML exists yet.

- [ ] **Step 3: Implement the HTML/CSS shell**

In `tools/orcamento/render-dashboard.js`, inside `renderDashboard`'s returned template, add the 3rd tab button next to the existing two. Change:
```html
        <div class="abas-visualizacao">
          <button id="aba-tabela" type="button" class="aba-ativa"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>Tabela</button>
          <button id="aba-grafico" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M12 20V4M20 20v-7"/></svg>Gráfico</button>
        </div>
```
to:
```html
        <div class="abas-visualizacao">
          <button id="aba-tabela" type="button" class="aba-ativa"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>Tabela</button>
          <button id="aba-grafico" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M12 20V4M20 20v-7"/></svg>Gráfico</button>
          <button id="aba-alertas" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.29 3.86l-8.18 14.18A2 2 0 0 0 3.9 21h16.2a2 2 0 0 0 1.79-2.96L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>Alertas</button>
        </div>
```

Then add the Alertas section itself, right after `secao-grafico`'s closing `</div>` and before the outer `</div>` that closes `conteudo-protegido`. Change:
```html
    <div id="secao-grafico" style="display:none">
      <div id="graficos-container"></div>
      <div id="grafico-tooltip" class="grafico-tooltip" style="display:none"></div>
    </div>
  </div>
```
to:
```html
    <div id="secao-grafico" style="display:none">
      <div id="graficos-container"></div>
      <div id="grafico-tooltip" class="grafico-tooltip" style="display:none"></div>
    </div>
    <div id="secao-alertas" style="display:none">
      <div class="filtros filtros-alertas">
        <div class="filtros-selecao">
          <div class="filtro-multi" id="filtro-alertas-agrupar-por"><button type="button" class="filtro-multi-trigger">SUP<svg class="filtro-multi-seta" width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div class="filtro-multi-painel" hidden></div></div>
          <div class="filtro-multi" id="filtro-alertas-dimensao"><button type="button" class="filtro-multi-trigger">Financeiro<svg class="filtro-multi-seta" width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div class="filtro-multi-painel" hidden></div></div>
          <div class="filtro-multi" id="filtro-alertas-numerico"><button type="button" class="filtro-multi-trigger">2 selecionadas<svg class="filtro-multi-seta" width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div class="filtro-multi-painel" hidden></div></div>
          <div class="filtro-multi" id="filtro-alertas-baseline"><button type="button" class="filtro-multi-trigger">Previsto<svg class="filtro-multi-seta" width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div class="filtro-multi-painel" hidden></div></div>
          <div class="filtro-multi" id="filtro-alertas-periodo"><button type="button" class="filtro-multi-trigger">2 selecionadas<svg class="filtro-multi-seta" width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div class="filtro-multi-painel" hidden></div></div>
        </div>
      </div>
      <div class="table-scroll">
      <table id="tabela-alertas">
        <thead id="cabecalho-alertas"></thead>
        <tbody id="corpo-alertas"></tbody>
      </table>
      </div>
    </div>
  </div>
```

(The trigger buttons' initial text — "SUP", "Financeiro", "2 selecionadas", "Previsto", "2 selecionadas" — mirrors the server-rendered defaults elsewhere in this file, e.g. `seletor-dimensao` already hardcodes "Financeiro"; `montarFiltroMulti`'s `atualizarRotuloFiltro` overwrites this text as soon as the client runs, exactly like every other filter already does, so it's cosmetic/first-paint only, never load-bearing.)

Add CSS, right after the existing `.tipologia-chip { ... }` block and before the closing `</style>`:
```css
  .filtros-alertas { margin-bottom: 16px; }
  .celula-alerta {
    color: #ffffff; font-weight: 600; text-align: center;
    padding: 6px 10px; font-size: 13px;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: PASS for this task's own test. `recalcularAlertas`/`alternarAba`'s 3rd branch/tab click wiring don't exist yet — that's Steps 5-6 below, needed before the feature actually works end-to-end even though the HTML-shape test above already passes on markup alone.

- [ ] **Step 5: Write the failing behavioral tests**

```js
test('renderDashboard\'s Alertas table shell starts empty (thead/tbody with no rows) -- confirmed above already; this test instead locks in that recalcularAlertas exists and is reachable from the client script, by checking montarDashboard wires the 3rd tab click handler', () => {
  const html = renderComSenha([registroExemplo()]);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const scriptTabela = scripts[3][1];
  assert.match(scriptTabela, /document\.getElementById\('aba-alertas'\)\.addEventListener\('click', function \(\) \{ alternarAba\('alertas'\); \}\);/);
  assert.match(scriptTabela, /function recalcularAlertas\(\)/);
  assert.match(scriptTabela, /document\.getElementById\('secao-alertas'\)\.style\.display = aba === 'alertas' \? '' : 'none';/);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: FAIL — `recalcularAlertas` and the `aba-alertas` wiring don't exist in the client script yet.

- [ ] **Step 7: Implement the lifecycle wiring**

Add this function inside `SCRIPT_CLIENTE_TABELA`, right after `montarGraficos` (so the three tab-content builders — `renderCorpoTabela`'s caller, `montarGraficos`, `recalcularAlertas` — sit near each other):

```js
// Sempre reconstrói cabeçalho + corpo inteiros (sem estado incremental,
// mesma filosofia do resto do script) -- muito mais simples que a Tabela
// porque aqui NUNCA existe uma distinção "estrutura vs valor": qualquer
// mudança (recorte OU um dos 5 seletores próprios) muda linhas E colunas
// ao mesmo tempo, então não vale a pena ter dois caminhos.
function recalcularAlertas() {
  var indices = indicesFiltrados(
    window.__REGISTROS__, filtrosSelecionados.tipologia, filtrosSelecionados.categoria,
    filtrosSelecionados.grupo, filtrosSelecionados.sup, filtrosSelecionados.origem
  );
  var agruparPor = filtrosAlertas.agruparPor.values().next().value;
  var dimensao = filtrosAlertas.dimensao.values().next().value;
  var numericos = emOrdemCanonica(NUMERICO_ORDEM, filtrosAlertas.numerico);
  var baselines = emOrdemCanonica(BASELINE_ORDEM, filtrosAlertas.baseline);
  var periodos = emOrdemCanonica(PERIODO_ORDEM, filtrosAlertas.periodo);
  var colunas = colunasAlertas(numericos, baselines, periodos);
  document.getElementById('cabecalho-alertas').innerHTML = renderCabecalhoAlertas(AGRUPAR_POR_ROTULO[agruparPor], colunas);
  document.getElementById('corpo-alertas').innerHTML = renderCorpoAlertas(
    window.__REGISTROS__, indices, agruparPor, dimensao, numericos, baselines, periodos, window.__VIGENTE_IDX__
  );
}
```

Update `alternarAba` (existing function) to add the 3rd tab:
```js
function alternarAba(aba) {
  document.getElementById('secao-tabela').style.display = aba === 'tabela' ? '' : 'none';
  document.getElementById('secao-grafico').style.display = aba === 'grafico' ? '' : 'none';
  document.getElementById('secao-alertas').style.display = aba === 'alertas' ? '' : 'none';
  document.getElementById('aba-tabela').classList.toggle('aba-ativa', aba === 'tabela');
  document.getElementById('aba-grafico').classList.toggle('aba-ativa', aba === 'grafico');
  document.getElementById('aba-alertas').classList.toggle('aba-ativa', aba === 'alertas');
}
```

Update `montarDashboard` (existing function) to wire the new tab button, the Alertas filter panels, and the initial render:
```js
function montarDashboard(registros) {
  montarTodosFiltrosMulti(registros);
  FILTROS_ALERTAS_CONFIG.forEach(function (cfg) { montarFiltroMulti(cfg, registros, filtrosAlertas); });
  configurarAberturaFiltrosMulti();
  document.getElementById('corpo-tabela').innerHTML = renderCorpoTabela(registros, dimensoesEmOrdem(filtrosSelecionados.dimensao));
  document.getElementById('limpar-filtros').addEventListener('click', limparFiltros);
  document.getElementById('aba-tabela').addEventListener('click', function () { alternarAba('tabela'); });
  document.getElementById('aba-grafico').addEventListener('click', function () { alternarAba('grafico'); });
  document.getElementById('aba-alertas').addEventListener('click', function () { alternarAba('alertas'); });
  inicializarTooltipGrafico();
  recalcularTabela();
  recalcularAlertas();
}
```

Update `limparFiltros` (existing function) to also refresh Alertas after clearing recorte filters (it does NOT touch `filtrosAlertas` itself — "Limpar filtros" only clears recorte, per the spec's "Filtros de recorte (compartilhados)" section; the Alertas selectors are a different kind of state):
```js
function limparFiltros() {
  FILTROS_CONFIG.forEach(function (cfg) {
    filtrosSelecionados[cfg.chave].clear();
  });
  filtrosSelecionados.dimensao.add('financeiro');
  SERIES_PADRAO_ATIVAS.forEach(function (s) { filtrosSelecionados.serie.add(s); });
  montarTodosFiltrosMulti(window.__REGISTROS__);
  document.getElementById('corpo-tabela').innerHTML = renderCorpoTabela(window.__REGISTROS__, dimensoesEmOrdem(filtrosSelecionados.dimensao));
  recalcularTabela();
  recalcularAlertas();
}
```

Update `atualizarDadosAoVivo` (existing function) — inside its `.then(function (texto) { ... })` success callback, right after the existing `recalcularTabela();` line (there is no such line currently inside that callback — check: the callback currently ends with `montarTodosFiltrosMulti`/`corpo-tabela` rebuild and does NOT call `recalcularTabela()` directly, relying on `montarTodosFiltrosMulti` triggering it indirectly via filter re-render — verify by reading the function before editing; add `recalcularAlertas();` as the last line of that `.then` block, right before the `var agora = new Date();` status-update lines):
```js
      preservarPrevistoInicial(window.__REGISTROS__, registrosNovos);
      window.__REGISTROS__ = registrosNovos;
      montarTodosFiltrosMulti(window.__REGISTROS__);
      document.getElementById('corpo-tabela').innerHTML = renderCorpoTabela(window.__REGISTROS__, dimensoesEmOrdem(filtrosSelecionados.dimensao));
      recalcularTabela();
      recalcularAlertas();

      var agora = new Date();
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `node --test test/*.test.js`
Expected: PASS — the full suite, including every test from Tasks 3, 6, and this task (both the HTML-shape test from Step 1 and the wiring test from Step 5).

- [ ] **Step 9: Commit**

```bash
git add tools/orcamento/render-dashboard.js test/orcamento-render-dashboard.test.js
git commit -m "Add the Alertas tab HTML/CSS and wire recalcularAlertas into the dashboard lifecycle"
```

---

### Task 8: Visual verification, rebuild, and deploy

**Files:**
- Modify: `dist/orcamento-dashboard.html` (generated), `docs/index.html` (generated copy)

- [ ] **Step 1: Run the full test suite one more time**

Run: `node --test test/*.test.js`
Expected: PASS, every test in the project.

- [ ] **Step 2: Rebuild the dashboard with a real password against the real spreadsheet**

Run (replace with the real value, never commit it):
```bash
ORCAMENTO_SENHA=<senha real> node tools/orcamento/build-dashboard.js
```
Expected output: `Wrote <N> bytes to .../dist/orcamento-dashboard.html`.

- [ ] **Step 3: Visual check with Playwright**

Open `dist/orcamento-dashboard.html` in a Playwright browser (same pattern as the rest of this project's visual verification), unlock with the real password, click the new "Alertas" tab, and confirm:
- The tab button appears and switches to the Alertas section, hiding Tabela/Gráfico.
- The 5 selectors render with their default labels (SUP / Financeiro / "2 selecionadas" / Previsto / "2 selecionadas") and open/close correctly (reusing the existing filtro-multi dropdown behavior).
- The table shows one row per SUP (default "Agrupar por"), a TOTAL GERAL row at the bottom, 4 columns by default, each cell colored per its semáforo band with a readable white percentage and a working hover tooltip.
- Changing "Agrupar por" to Tipologia rebuilds the rows; checking more Período/Numérico/Baseline options adds columns; changing a recorte filter (e.g. SUP) narrows both the Tabela and the Alertas rows together.
- "Limpar filtros" resets recorte filters and Alertas rows update accordingly, without resetting the Alertas selectors themselves.

Fix anything broken found during this check before proceeding (loop back to the relevant earlier task, re-run its tests, then re-verify visually).

- [ ] **Step 4: Copy the build to the Pages source and verify the timestamp**

```bash
cp dist/orcamento-dashboard.html docs/index.html
```
Confirm both files show the same "Gerado em" timestamp (open each and compare, or `diff` them — they should be byte-identical since `docs/index.html` is a straight copy of `dist/orcamento-dashboard.html`).

- [ ] **Step 5: Commit and push**

```bash
git add dist/orcamento-dashboard.html docs/index.html
git commit -m "Rebuild dashboard: add the Alertas tab (semáforo de desvio)"
git push
```

Then poll the GitHub Pages build status and `curl` the live URL to confirm the "Gerado em" timestamp matches this build (per the standing deploy-verification agreement for this project) before considering the task complete.
