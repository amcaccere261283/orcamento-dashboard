# Gráfico ORÇAMENTO (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second view ("Gráfico") to the ORÇAMENTO dashboard, toggled via tabs alongside the existing "Tabela", showing a combo chart (monthly P/R/T bars + cumulative P/R/T line on a secondary axis) for the currently selected dimension and filters.

**Architecture:** Hand-rolled SVG, built entirely by client-side JS inside the existing `SCRIPT_CLIENTE_TABELA` string in `tools/orcamento/render-dashboard.js` — no charting library (keeps the project's zero-npm-dependency architecture). The chart reuses the existing `calcularMensal` aggregation and adds two new pieces: a cumulative-sum helper and a filtered-indices helper, both pure functions independent of any pre-rendered DOM row.

**Tech Stack:** Same as the rest of the project — vanilla browser JS (ES5-style, no build step) inside a template string, Node's built-in test runner (`node --test`), `node:vm` to execute the extracted client script in tests.

## Global Constraints

- Zero npm dependencies — no charting library, no `package.json` changes.
- The chart must NEVER render any per-registro identifying text (tipologia/grupo/sup/tomador names) — only the 3 fixed série labels ("Previsto"/"Realizado"/"Tendência") and month abbreviations, which are not sensitive. This preserves the existing security property that no protected data is ever expressed in a form that bypasses the password-gated decryption path.
- Série colors (already established, must match exactly): Previsto `#2f6ad0`, Realizado `#7fd858`, Tendência (internal key `total`) `#f6b53f`.
- Dimensões de soma (bars + cumulative line, dual axis): `equipes`, `volume`, `financeiro`. Dimensões de razão (line only, single axis, no accumulation): `produtividade`, `ticketMedio`.
- The chart must react to the same 4 filters (tipologia/grupo/sup/série) and the dimension selector already on the page, recomputing every time `recalcularTabela` runs — never a separate/stale copy of the filter state.
- All new pure functions are added inside the `SCRIPT_CLIENTE_TABELA` template string (same as `calcularMensal`, `mesclarConsecutivos`, etc.) and exposed to tests the same way, by extending `extrairFuncoesPuras` in `test/orcamento-render-dashboard.test.js`.
- DOM-orchestration functions (that call `document.getElementById`/`querySelectorAll`) are verified via Playwright against the real built HTML, not via Node unit tests — this matches the existing pattern in this codebase (`recalcularTabela`, `montarDashboard`, `mesclarColunasRepetidas` have no Node unit tests; only their pure helpers do).

---

## File Structure

```
tools/orcamento/render-dashboard.js   -- all 4 tasks: new pure functions, SVG builder, HTML/CSS, wiring
test/orcamento-render-dashboard.test.js -- new tests for each pure function + shell-HTML assertions
dist/orcamento-dashboard.html          -- rebuilt in Task 4 (real senha, real data)
docs/index.html                        -- re-copied from dist/ in Task 4 for GitHub Pages
```

No new files — this is a cohesive addition to the single existing render module, not a new subsystem.

---

### Task 1: Cumulative-sum and filtered-indices pure helpers

**Files:**
- Modify: `tools/orcamento/render-dashboard.js` — inside the `SCRIPT_CLIENTE_TABELA` template string, insert immediately after `calcularTotalAno` (the function ending with the line `return somar(lista.map(function (v) { return somar(v[dimensao]); }));\n}`, right before the `preencherLinha` function).
- Test: `test/orcamento-render-dashboard.test.js`

**Interfaces:**
- Produces: `calcularAcumulado(mensal)` — takes a 12-length array of numbers (may include `null`/`undefined`, treated as 0), returns a same-length array where index `i` is the running sum of indices `0..i`.
- Produces: `indicesFiltrados(registros, filtroTipologia, filtroGrupo, filtroSup)` — takes the raw registros array and the 3 current filter string values (empty string = "no filter"), returns an array of matching registro indices (AND semantics across the 3 filters). Mirrors the per-row filter logic already inline in `recalcularTabela`, but computed directly over registros with no DOM row required.
- Consumes: nothing new — both are standalone.

- [ ] **Step 1: Write the failing tests**

Add to `test/orcamento-render-dashboard.test.js`, right after the `mesclarConsecutivos` tests (before the `escapeHtml` test at the end of the file):

```js
test('calcularAcumulado (extraído do HTML real gerado) returns the running sum month over month', () => {
  const html = renderComSenha([registroExemplo()]);
  const { calcularAcumulado } = extrairFuncoesPuras(html);
  assert.deepEqual(paraPlano(calcularAcumulado([10, 20, 30])), [10, 30, 60]);
});

test('calcularAcumulado treats null/undefined months as 0 without breaking the running sum of the months after them', () => {
  const html = renderComSenha([registroExemplo()]);
  const { calcularAcumulado } = extrairFuncoesPuras(html);
  assert.deepEqual(paraPlano(calcularAcumulado([10, null, 30])), [10, 10, 40]);
});

test('calcularAcumulado returns an empty array for an empty input', () => {
  const html = renderComSenha([registroExemplo()]);
  const { calcularAcumulado } = extrairFuncoesPuras(html);
  assert.deepEqual(paraPlano(calcularAcumulado([])), []);
});

test('indicesFiltrados (extraído do HTML real gerado) returns every index when no filter is active', () => {
  const html = renderComSenha([registroExemplo()]);
  const { indicesFiltrados } = extrairFuncoesPuras(html);
  const registros = [
    { tipologia: 'SM', grupo: 'PÁTRIA', sup: 'SUP-A' },
    { tipologia: 'ST', grupo: 'PÁTRIA', sup: 'SUP-B' },
    { tipologia: 'SM', grupo: 'SYSTRA', sup: 'SUP-C' },
  ];
  assert.deepEqual(paraPlano(indicesFiltrados(registros, '', '', '')), [0, 1, 2]);
});

test('indicesFiltrados combines tipologia/grupo/sup with AND semantics, not OR', () => {
  const html = renderComSenha([registroExemplo()]);
  const { indicesFiltrados } = extrairFuncoesPuras(html);
  const registros = [
    { tipologia: 'SM', grupo: 'PÁTRIA', sup: 'SUP-A' },
    { tipologia: 'ST', grupo: 'PÁTRIA', sup: 'SUP-B' },
    { tipologia: 'SM', grupo: 'SYSTRA', sup: 'SUP-C' },
  ];
  assert.deepEqual(paraPlano(indicesFiltrados(registros, 'SM', '', '')), [0, 2]);
  assert.deepEqual(paraPlano(indicesFiltrados(registros, '', 'PÁTRIA', '')), [0, 1]);
  assert.deepEqual(paraPlano(indicesFiltrados(registros, 'SM', 'PÁTRIA', '')), [0]);
  assert.deepEqual(paraPlano(indicesFiltrados(registros, '', '', 'SUP-Z')), []);
});
```

Also update the `extrairFuncoesPuras` helper (near the top of the test file) to expose the two new functions — change the `vm.runInContext` call's appended assignment line from:

```js
'\nthis.calcularMensal = calcularMensal; this.calcularTotalAno = calcularTotalAno;' +
  ' this.mesclarConsecutivos = mesclarConsecutivos; this.tipologiaColor = tipologiaColor;' +
  ' this.renderCorpoTabela = renderCorpoTabela; this.escapeHtml = escapeHtml;',
```

to:

```js
'\nthis.calcularMensal = calcularMensal; this.calcularTotalAno = calcularTotalAno;' +
  ' this.mesclarConsecutivos = mesclarConsecutivos; this.tipologiaColor = tipologiaColor;' +
  ' this.renderCorpoTabela = renderCorpoTabela; this.escapeHtml = escapeHtml;' +
  ' this.calcularAcumulado = calcularAcumulado; this.indicesFiltrados = indicesFiltrados;',
```

and add the two new names to the returned object literal right after `renderCorpoTabela: sandbox.renderCorpoTabela, escapeHtml: sandbox.escapeHtml,`:

```js
    renderCorpoTabela: sandbox.renderCorpoTabela, escapeHtml: sandbox.escapeHtml,
    calcularAcumulado: sandbox.calcularAcumulado, indicesFiltrados: sandbox.indicesFiltrados,
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: FAIL — `calcularAcumulado`/`indicesFiltrados` are `undefined` (ReferenceError or TypeError calling them), since they don't exist yet.

- [ ] **Step 3: Implement the two functions**

In `tools/orcamento/render-dashboard.js`, insert this block right after `calcularTotalAno`'s closing `}` and before `function preencherLinha`:

```js
// Soma corrida mês a mês -- acumulado[i] = mensal[0]+...+mensal[i]. Trata
// null/undefined como 0 (não dá pra "acumular" um mês sem dado, mas
// também não pode quebrar a soma corrida dos meses seguintes).
function calcularAcumulado(mensal) {
  var soma = 0;
  return mensal.map(function (v) {
    soma += v || 0;
    return soma;
  });
}

// Devolve os índices de `registros` que combinam com os filtros de
// tipologia/grupo/SUP atuais (AND, não OR) -- mesma regra usada linha a
// linha em recalcularTabela, calculada aqui direto sobre os registros
// crus, sem depender de uma linha <tr> já renderizada, pra o gráfico
// poder agregar o recorte atual sem precisar de uma linha "molde" no DOM.
function indicesFiltrados(registros, filtroTipologia, filtroGrupo, filtroSup) {
  var indices = [];
  registros.forEach(function (registro, indice) {
    if (filtroTipologia && registro.tipologia !== filtroTipologia) return;
    if (filtroGrupo && registro.grupo !== filtroGrupo) return;
    if (filtroSup && registro.sup !== filtroSup) return;
    indices.push(indice);
  });
  return indices;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: PASS (all tests, including the 6 new ones).

- [ ] **Step 5: Commit**

```bash
git add tools/orcamento/render-dashboard.js test/orcamento-render-dashboard.test.js
git commit -m "Add calcularAcumulado and indicesFiltrados helpers for the ORÇAMENTO chart"
```

---

### Task 2: SVG chart builder (`construirGraficoSvg`)

**Files:**
- Modify: `tools/orcamento/render-dashboard.js` — insert after the block added in Task 1 (still before `preencherLinha`), OR anywhere before `renderCorpoTabela` — this plan inserts it right after the Task 1 block for locality with the data it consumes.
- Test: `test/orcamento-render-dashboard.test.js`

**Interfaces:**
- Consumes: `calcularAcumulado` (Task 1), `SERIE_LABELS` (already defined, `{ previsto: 'Previsto', realizado: 'Realizado', total: 'Tendência' }`), `formatarNumero` (already defined).
- Produces: `construirGraficoSvg(dadosPorSerie, ehRazao)` where `dadosPorSerie` is an array of `{ serie: 'previsto'|'realizado'|'total', mensal: number[12], acumulado: number[12]|null }` (only entries for the currently-visible séries; `acumulado` is `null` when `ehRazao` is true, and unused in that branch). Returns a complete `<svg>...</svg>` markup string. Later consumed by `montarGrafico` (Task 3).
- Produces (module-level constants used by later tasks too): `SERIE_COR = { previsto: '#2f6ad0', realizado: '#7fd858', total: '#f6b53f' }`, `DIMENSOES_RAZAO = ['produtividade', 'ticketMedio']`.

- [ ] **Step 1: Write the failing tests**

Add to `test/orcamento-render-dashboard.test.js`, right after the `indicesFiltrados` tests from Task 1:

```js
test('construirGraficoSvg (extraído do HTML real gerado) draws 12 bars per série plus 1 cumulative line per série, for a soma dimension (ehRazao=false)', () => {
  const html = renderComSenha([registroExemplo()]);
  const { construirGraficoSvg, calcularAcumulado } = extrairFuncoesPuras(html);
  const mensalPrevisto = Array(12).fill(100);
  const mensalRealizado = Array(12).fill(50);
  const dados = [
    { serie: 'previsto', mensal: mensalPrevisto, acumulado: calcularAcumulado(mensalPrevisto) },
    { serie: 'realizado', mensal: mensalRealizado, acumulado: calcularAcumulado(mensalRealizado) },
  ];
  const svg = construirGraficoSvg(dados, false);
  assert.equal((svg.match(/<rect class="grafico-barra"/g) || []).length, 24);
  assert.equal((svg.match(/<polyline class="grafico-linha"/g) || []).length, 2);
  assert.match(svg, /<svg viewBox="0 0 1000 380" class="grafico-svg">/);
});

test('construirGraficoSvg draws NO bars for a razão dimension (ehRazao=true), only 1 line per série using the monthly value (not the cumulative)', () => {
  const html = renderComSenha([registroExemplo()]);
  const { construirGraficoSvg } = extrairFuncoesPuras(html);
  const dados = [{ serie: 'previsto', mensal: Array(12).fill(1.5), acumulado: null }];
  const svg = construirGraficoSvg(dados, true);
  assert.equal((svg.match(/<rect class="grafico-barra"/g) || []).length, 0);
  assert.equal((svg.match(/<polyline class="grafico-linha"/g) || []).length, 1);
});

test('construirGraficoSvg scales bar heights proportionally to their value (guards against a numerator/denominator swap in the Y scale)', () => {
  const html = renderComSenha([registroExemplo()]);
  const { construirGraficoSvg } = extrairFuncoesPuras(html);
  const mensal = [100, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const dados = [{ serie: 'previsto', mensal: mensal, acumulado: mensal }];
  const svg = construirGraficoSvg(dados, false);
  const alturas = [...svg.matchAll(/<rect class="grafico-barra"[^>]*height="([\d.]+)"/g)].map(m => Number(m[1]));
  assert.equal(alturas.length, 12);
  assert.ok(Math.abs(alturas[0] - 2 * alturas[1]) < 0.5, `expected month0 (value 100) bar to be ~2x month1 (value 50) bar, got ${alturas[0]} vs ${alturas[1]}`);
});

test('construirGraficoSvg only draws bars/lines for the séries actually passed in (respects an upstream série filter)', () => {
  const html = renderComSenha([registroExemplo()]);
  const { construirGraficoSvg, calcularAcumulado } = extrairFuncoesPuras(html);
  const mensal = Array(12).fill(10);
  const dados = [{ serie: 'realizado', mensal: mensal, acumulado: calcularAcumulado(mensal) }];
  const svg = construirGraficoSvg(dados, false);
  assert.equal((svg.match(/<rect class="grafico-barra"/g) || []).length, 12);
  assert.equal((svg.match(/<polyline class="grafico-linha"/g) || []).length, 1);
  assert.match(svg, /fill="#7fd858"/); // Realizado's color, confirming the right série was drawn
});
```

Also extend `extrairFuncoesPuras`'s exposure line and returned object once more (same mechanism as Task 1), adding `construirGraficoSvg`:

```js
'\nthis.calcularMensal = calcularMensal; this.calcularTotalAno = calcularTotalAno;' +
  ' this.mesclarConsecutivos = mesclarConsecutivos; this.tipologiaColor = tipologiaColor;' +
  ' this.renderCorpoTabela = renderCorpoTabela; this.escapeHtml = escapeHtml;' +
  ' this.calcularAcumulado = calcularAcumulado; this.indicesFiltrados = indicesFiltrados;' +
  ' this.construirGraficoSvg = construirGraficoSvg;',
```

```js
    renderCorpoTabela: sandbox.renderCorpoTabela, escapeHtml: sandbox.escapeHtml,
    calcularAcumulado: sandbox.calcularAcumulado, indicesFiltrados: sandbox.indicesFiltrados,
    construirGraficoSvg: sandbox.construirGraficoSvg,
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: FAIL — `construirGraficoSvg` is undefined.

- [ ] **Step 3: Implement the SVG builder**

Insert this block right after the Task 1 functions (after `indicesFiltrados`), still before `preencherLinha`:

```js
var SERIE_COR = { previsto: '#2f6ad0', realizado: '#7fd858', total: '#f6b53f' };
var DIMENSOES_RAZAO = ['produtividade', 'ticketMedio'];
var MESES_ABREVIADOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

var GRAFICO_LARGURA = 1000;
var GRAFICO_ALTURA = 380;
var GRAFICO_MARGEM = { topo: 24, baixo: 36, esquerda: 64, direita: 64 };

// Mapeia um valor pra uma distância em pixels dentro de [0, pixelMax],
// proporcional a valorMax -- 0 quando valorMax é 0 (evita divisão por
// zero quando não há nenhum dado no recorte filtrado).
function escalaLinear(valor, valorMax, pixelMax) {
  if (!valorMax) return 0;
  return (valor / valorMax) * pixelMax;
}

function construirEixoXSvg(larguraMes, alturaPlot) {
  var svg = '';
  for (var mes = 0; mes < 12; mes++) {
    var x = GRAFICO_MARGEM.esquerda + mes * larguraMes + larguraMes / 2;
    var y = GRAFICO_MARGEM.topo + alturaPlot + 18;
    svg += '<text class="grafico-eixo-texto" x="' + x.toFixed(1) + '" y="' + y + '" text-anchor="middle">' + MESES_ABREVIADOS[mes] + '</text>';
  }
  return svg;
}

var GRAFICO_NUM_TICKS = 4;
function construirTicksEixoY(valorMax, alturaPlot, ladoDireita) {
  var svg = '';
  for (var i = 0; i <= GRAFICO_NUM_TICKS; i++) {
    var fracao = i / GRAFICO_NUM_TICKS;
    var y = GRAFICO_MARGEM.topo + alturaPlot - fracao * alturaPlot;
    var valor = fracao * valorMax;
    var x = ladoDireita ? (GRAFICO_LARGURA - GRAFICO_MARGEM.direita + 8) : (GRAFICO_MARGEM.esquerda - 8);
    var ancora = ladoDireita ? 'start' : 'end';
    svg += '<text class="grafico-eixo-texto" x="' + x + '" y="' + (y + 4) + '" text-anchor="' + ancora + '">' + formatarNumero(valor) + '</text>';
    if (!ladoDireita) {
      svg += '<line class="grafico-gridline" x1="' + GRAFICO_MARGEM.esquerda + '" y1="' + y + '" x2="' + (GRAFICO_LARGURA - GRAFICO_MARGEM.direita) + '" y2="' + y + '"/>';
    }
  }
  return svg;
}

function construirLegendaSvg(dadosPorSerie) {
  var svg = '';
  dadosPorSerie.forEach(function (d, i) {
    var x = GRAFICO_MARGEM.esquerda + i * 130;
    var y = 10;
    svg += '<circle cx="' + x + '" cy="' + y + '" r="5" fill="' + SERIE_COR[d.serie] + '"/>';
    svg += '<text class="grafico-eixo-texto" x="' + (x + 10) + '" y="' + (y + 4) + '" text-anchor="start">' + SERIE_LABELS[d.serie] + '</text>';
  });
  return svg;
}

// dadosPorSerie: [{ serie, mensal: number[12], acumulado: number[12]|null }],
// já filtrado só com as séries visíveis (respeita filtro-serie) e com
// valores mensais nunca-nulos (null já virou 0 antes de chegar aqui --
// ver montarGrafico). ehRazao=true pras dimensões Produtividade/Ticket
// médio: nesse caso não faz sentido "acumular" uma razão, então só a
// linha do valor mensal aparece, sem barras e sem eixo secundário.
function construirGraficoSvg(dadosPorSerie, ehRazao) {
  var larguraPlot = GRAFICO_LARGURA - GRAFICO_MARGEM.esquerda - GRAFICO_MARGEM.direita;
  var alturaPlot = GRAFICO_ALTURA - GRAFICO_MARGEM.topo - GRAFICO_MARGEM.baixo;
  var larguraMes = larguraPlot / 12;
  var numSeries = dadosPorSerie.length;

  var maxMensal = 0;
  dadosPorSerie.forEach(function (d) { d.mensal.forEach(function (v) { if (v > maxMensal) maxMensal = v; }); });
  var maxAcumulado = 0;
  if (!ehRazao) {
    dadosPorSerie.forEach(function (d) { d.acumulado.forEach(function (v) { if (v > maxAcumulado) maxAcumulado = v; }); });
  }

  var svg = '';
  svg += construirTicksEixoY(maxMensal, alturaPlot, false);
  if (!ehRazao) svg += construirTicksEixoY(maxAcumulado, alturaPlot, true);
  svg += construirEixoXSvg(larguraMes, alturaPlot);

  if (!ehRazao) {
    var larguraBarra = (larguraMes * 0.7) / (numSeries || 1);
    for (var mes = 0; mes < 12; mes++) {
      var inicioMes = GRAFICO_MARGEM.esquerda + mes * larguraMes + larguraMes * 0.15;
      dadosPorSerie.forEach(function (d, i) {
        var valor = d.mensal[mes];
        var alturaBarra = escalaLinear(valor, maxMensal, alturaPlot);
        var x = inicioMes + i * larguraBarra;
        var y = GRAFICO_MARGEM.topo + alturaPlot - alturaBarra;
        svg += '<rect class="grafico-barra" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + larguraBarra.toFixed(1) + '" height="' + alturaBarra.toFixed(1) + '" fill="' + SERIE_COR[d.serie] + '"><title>' + SERIE_LABELS[d.serie] + ': ' + formatarNumero(valor) + '</title></rect>';
      });
    }
  }

  dadosPorSerie.forEach(function (d) {
    var serieValores = ehRazao ? d.mensal : d.acumulado;
    var maxEixo = ehRazao ? maxMensal : maxAcumulado;
    var pontos = serieValores.map(function (valor, mes) {
      var x = GRAFICO_MARGEM.esquerda + mes * larguraMes + larguraMes / 2;
      var y = GRAFICO_MARGEM.topo + alturaPlot - escalaLinear(valor, maxEixo, alturaPlot);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    var tracejado = ehRazao ? '' : ' stroke-dasharray="5,4"';
    svg += '<polyline class="grafico-linha" points="' + pontos.join(' ') + '" fill="none" stroke="' + SERIE_COR[d.serie] + '" stroke-width="2"' + tracejado + '/>';
  });

  svg += construirLegendaSvg(dadosPorSerie);

  return '<svg viewBox="0 0 ' + GRAFICO_LARGURA + ' ' + GRAFICO_ALTURA + '" class="grafico-svg">' + svg + '</svg>';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: PASS (all tests, including the 4 new ones). If the proportional-height test fails, double check `escalaLinear`'s argument order (`valor, valorMax, pixelMax` — never swapped) and that `y` is computed as `topo + alturaPlot - alturaBarra` (SVG y grows downward, so larger values must produce a SMALLER y, i.e. taller bar from the bottom up).

- [ ] **Step 5: Real mutation-test check (manual, not committed)**

Temporarily swap `escalaLinear(valor, valorMax, pixelMax)`'s body to `return (valorMax / valor) * pixelMax;` (an inverted ratio — a plausible real mistake), re-run the Step 3 test file, confirm the proportional-height test now FAILS, then revert the swap via a targeted `Edit` (never `git checkout --`) and re-run to confirm all tests pass again. This proves the test actually catches a realistic scaling bug, not just a coincidence.

- [ ] **Step 6: Commit**

```bash
git add tools/orcamento/render-dashboard.js test/orcamento-render-dashboard.test.js
git commit -m "Add construirGraficoSvg: hand-rolled SVG combo chart (bars + cumulative line)"
```

---

### Task 3: Tabs UI, orchestration (`montarGrafico`, `alternarAba`), and wiring

**Files:**
- Modify: `tools/orcamento/render-dashboard.js` — HTML template (tab buttons + graph section + CSS), `SCRIPT_CLIENTE_TABELA` (new `montarGrafico`/`alternarAba` functions, calls from `recalcularTabela` and `montarDashboard`).
- Test: `test/orcamento-render-dashboard.test.js`

**Interfaces:**
- Consumes: `indicesFiltrados`, `calcularMensal` (existing), `calcularAcumulado`, `construirGraficoSvg`, `DIMENSOES_RAZAO`, `SERIE_LABELS` — all from Tasks 1–2.
- Produces: `montarGrafico(registros, filtroTipologia, filtroGrupo, filtroSup, filtroSerie, dimensao)` (DOM-touching, no unit test — verified in Task 4 via Playwright) and `alternarAba(aba)` (DOM-touching, same).

- [ ] **Step 1: Write the failing shell-HTML test**

Add to `test/orcamento-render-dashboard.test.js`, right after the "renderDashboard includes a série filter..." test:

```js
test('renderDashboard includes Tabela/Gráfico tab buttons and both view sections (Gráfico hidden by default)', () => {
  const html = renderComSenha([registroExemplo()]);
  assert.match(html, /<button id="aba-tabela" type="button" class="aba-ativa">Tabela<\/button>/);
  assert.match(html, /<button id="aba-grafico" type="button">Gráfico<\/button>/);
  assert.match(html, /<div id="secao-tabela">/);
  assert.match(html, /<div id="secao-grafico" style="display:none">/);
  assert.match(html, /<div id="grafico-svg-container"><\/div>/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: FAIL — none of these ids/classes exist yet.

- [ ] **Step 3: Add the HTML/CSS**

In `tools/orcamento/render-dashboard.js`, inside the `<style>` block, add right after the `#atualizar-dashboard:hover { ... }` rule:

```css
  .abas-visualizacao { display: flex; gap: 8px; }
  .abas-visualizacao button {
    padding: 8px 16px;
    border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface-1); color: var(--text-secondary);
    font-size: 13px; cursor: pointer;
  }
  .abas-visualizacao button.aba-ativa { border-color: #f6b53f; color: var(--text-primary); font-weight: 600; }
  #secao-grafico {
    background: rgba(26,26,25,0.68); border-radius: 8px; padding: 16px 8px;
    position: relative; z-index: 1;
  }
  .grafico-svg { width: 100%; height: auto; display: block; }
  .grafico-eixo-texto { fill: var(--text-secondary); font-size: 11px; }
  .grafico-gridline { stroke: var(--gridline); stroke-width: 1; }
```

Then, inside the `.filtros` div in the body (right after `${renderSeletorDimensao()}` and before the `<button id="limpar-filtros"...` line), add:

```html
      <div class="abas-visualizacao">
        <button id="aba-tabela" type="button" class="aba-ativa">Tabela</button>
        <button id="aba-grafico" type="button">Gráfico</button>
      </div>
```

Then wrap the existing table markup in a `secao-tabela` div and add the graph section right after it — change:

```html
    <div class="table-scroll">
    <table id="tabela-orcamento">
      <thead><tr><th>SUP</th><th>Grupo</th><th>Tomador</th><th>Tipologia</th><th>Série</th>${renderCabecalhoMeses(periodos)}<th>Total</th></tr></thead>
      <tbody id="corpo-tabela"></tbody>
    </table>
    </div>
```

to:

```html
    <div id="secao-tabela">
    <div class="table-scroll">
    <table id="tabela-orcamento">
      <thead><tr><th>SUP</th><th>Grupo</th><th>Tomador</th><th>Tipologia</th><th>Série</th>${renderCabecalhoMeses(periodos)}<th>Total</th></tr></thead>
      <tbody id="corpo-tabela"></tbody>
    </table>
    </div>
    </div>
    <div id="secao-grafico" style="display:none">
      <div id="grafico-svg-container"></div>
    </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: PASS.

- [ ] **Step 5: Implement `montarGrafico` and `alternarAba`, and wire them in**

Insert this block right after `construirGraficoSvg` (from Task 2), still before `preencherLinha`:

```js
// Recalcula e redesenha o gráfico a partir dos MESMOS filtros/dimensão da
// tabela -- chamado toda vez que recalcularTabela roda, então nunca fica
// desatualizado mesmo se o usuário estiver na aba Tabela quando muda um
// filtro e só depois troca pra aba Gráfico.
function montarGrafico(registros, filtroTipologia, filtroGrupo, filtroSup, filtroSerie, dimensao) {
  var indices = indicesFiltrados(registros, filtroTipologia, filtroGrupo, filtroSup);
  var seriesTodas = ['previsto', 'realizado', 'total'];
  var seriesVisiveis = seriesTodas.filter(function (s) { return !filtroSerie || filtroSerie === s; });
  var ehRazao = DIMENSOES_RAZAO.indexOf(dimensao) !== -1;

  var dadosPorSerie = seriesVisiveis.map(function (serie) {
    var valoresLista = indices.map(function (idx) { return registros[idx][serie]; });
    var mensalBruto = calcularMensal(valoresLista, serie, dimensao) || new Array(12).fill(null);
    var mensal = mensalBruto.map(function (v) { return v === null ? 0 : v; });
    return { serie: serie, mensal: mensal, acumulado: ehRazao ? null : calcularAcumulado(mensal) };
  });

  document.getElementById('grafico-svg-container').innerHTML = construirGraficoSvg(dadosPorSerie, ehRazao);
}

function alternarAba(aba) {
  document.getElementById('secao-tabela').style.display = aba === 'tabela' ? '' : 'none';
  document.getElementById('secao-grafico').style.display = aba === 'grafico' ? '' : 'none';
  document.getElementById('aba-tabela').classList.toggle('aba-ativa', aba === 'tabela');
  document.getElementById('aba-grafico').classList.toggle('aba-ativa', aba === 'grafico');
}
```

In `recalcularTabela`, `mesclarColunasRepetidas();` is currently the last line before the function's closing brace. Add the call to `montarGrafico` right after it, so the chart always redraws last, once the table's own recompute is done:

```js
  mesclarColunasRepetidas();
  montarGrafico(window.__REGISTROS__, filtroTipologia, filtroGrupo, filtroSup, filtroSerie, dimensao);
}
```

In `montarDashboard`, add the tab button listeners right after the existing `document.getElementById('limpar-filtros').addEventListener('click', limparFiltros);` line:

```js
  document.getElementById('aba-tabela').addEventListener('click', function () { alternarAba('tabela'); });
  document.getElementById('aba-grafico').addEventListener('click', function () { alternarAba('grafico'); });
```

- [ ] **Step 6: Run the full test suite**

Run: `node --test`
Expected: PASS — all existing tests plus the new ones from Tasks 1–3.

- [ ] **Step 7: Commit**

```bash
git add tools/orcamento/render-dashboard.js test/orcamento-render-dashboard.test.js
git commit -m "Wire the ORÇAMENTO chart into a Tabela/Gráfico tab toggle"
```

---

### Task 4: End-to-end verification, rebuild, and deploy

**Files:**
- None modified — this task rebuilds and verifies the output of Tasks 1–3, and ships it.

- [ ] **Step 1: Rebuild the real dashboard**

Run (PowerShell):
```
$env:ORCAMENTO_SENHA = "spt@2026"; node tools/orcamento/build-dashboard.js
```

- [ ] **Step 2: Serve locally and verify via Playwright**

Start (or reuse) the local static server on port 8934 serving `dist/orcamento-dashboard.html`, navigate, unlock with the real senha, then verify via `browser_evaluate`:
- The default view shows the "Tabela" tab active and "Gráfico" section hidden.
- Clicking `#aba-grafico` shows the chart and hides the table; `#grafico-svg-container` contains an `<svg class="grafico-svg">`.
- With the default dimension (Financeiro, a soma dimension) and no série filter: the chart has `36` `<rect class="grafico-barra">` (3 séries × 12 meses) and `3` `<polyline class="grafico-linha">`.
- Switching `seletor-dimensao` to `produtividade`: the chart has `0` bars and `3` polylines (razão dimension, line-only).
- Setting `filtro-serie` to `previsto`: back on a soma dimension, the chart now has `12` bars and `1` polyline.
- Cross-check one concrete number: with no filters and dimension `financeiro`, sum the chart's underlying `dadosPorSerie` (accessible by calling `indicesFiltrados`/`calcularMensal` directly in the page, same as `montarGrafico` does) for `previsto`'s December value and confirm it equals the TOTAL GERAL row's December `Previsto` cell already shown in the table (`document.querySelector('[data-total-geral="1"][data-serie="previsto"] .celula-mes')` at index 11) — this guards against the chart and table silently disagreeing on the same aggregate.
- Take a screenshot of the Gráfico tab (both a soma dimension and a razão dimension) and visually confirm: bars are present/absent as expected, the secondary axis labels appear only for soma dimensions, the legend shows only the currently-visible séries, and colors match Previsto=blue/Realizado=green/Tendência=amber.

- [ ] **Step 3: Copy to docs/ and ship**

```bash
cp dist/orcamento-dashboard.html docs/index.html
git add dist/orcamento-dashboard.html docs/index.html
git commit -m "Rebuild ORÇAMENTO dashboard with the new Gráfico tab"
git push origin master
```

- [ ] **Step 4: Verify live on GitHub Pages**

Poll `gh api repos/amcaccere261283/orcamento-dashboard/pages/builds/latest` until `status` is `built`, then navigate Playwright to `https://amcaccere261283.github.io/orcamento-dashboard/?v=<next>` (cache-busting param), unlock with the real senha, and repeat the key checks from Step 2 (tab toggle works, bar/line counts match expectations for a soma and a razão dimension) directly against the live URL.
