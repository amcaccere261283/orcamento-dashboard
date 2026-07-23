# Aba Alertas v2 (lista + fix de filtros) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Alertas tab's broken filter propagation, and change its table from "1 linha por grupo × N colunas coloridas" to "1 linha por grupo×combinação, com colunas Referência/Pesquisado/Desvio/Status (círculo colorido)" plus a text search box, per `docs/superpowers/specs/2026-07-23-tabela-alertas-semaforo-design.md`'s "Revisão v2" section.

**Architecture:** Same file (`tools/orcamento/render-dashboard.js`), same single-file-dashboard architecture as the rest of the project. All the math (`bucketPeriodo`, `calcularCelulaAlerta`, `colunasAlertas`, `classificarSemaforo`, `agruparIndicesAlertas`) is unchanged and reused — only the rendering functions (`renderCabecalhoAlertas`/`renderLinhaAlerta`/`renderCorpoAlertas`) and the filter-change wiring (`montarFiltroMulti`'s handler, `FILTROS_ALERTAS_CONFIG`) change.

**Tech Stack:** Node.js (`node --test`), vanilla client-side JS, Playwright for visual verification.

## Global Constraints

- No new npm dependencies. No TypeScript.
- Run `node --test test/*.test.js` after every task; all existing tests must keep passing.
- Semáforo colors/boundaries are UNCHANGED and must not be touched: `classificarSemaforo` already returns `{ cor, indicador }` with `>1.10` → `#1414CC` Excelente; `[0.90,1.10]` → `#128A3E` Dentro da meta; `[0.70,0.90)` → `#F5A700` Atenção; `<0.70` → `#D32020` Crítico; `null` → `#6E7580` Sem dado.
- Status column renders a solid circle (not a bordered chip, not a full-cell background) followed by the status label text.
- Referência = the baseline's bucketed absolute value (`celula.denominador`); Pesquisado = the numérico's bucketed absolute value (`celula.numerador`); both formatted with the existing `formatarNumero(v, 0)` (0 decimals, same as the old tooltip).
- After every task, rebuild `dist/orcamento-dashboard.html` is NOT required until the final task (Task 4) — earlier tasks only need `node --test` to pass.

---

### Task 1: Fix the filter-propagation bug

**Files:**
- Modify: `tools/orcamento/render-dashboard.js`
- Test: `test/orcamento-render-dashboard.test.js`

**Interfaces:**
- Consumes: existing `recalcularTabela()`, `recalcularAlertas()`, `montarFiltroMulti`.
- Produces: every filter change (recorte `FILTROS_CONFIG` entries AND the 5 `FILTROS_ALERTAS_CONFIG` entries) now calls both `recalcularTabela()` and `recalcularAlertas()` unconditionally. The `aoMudar` per-config callback mechanism is removed entirely (no longer needed).

**Bug being fixed:** `montarFiltroMulti`'s checkbox change-handler (`tools/orcamento/render-dashboard.js`, inside the function, current line ~1435) ends with:
```js
cfg.aoMudar ? cfg.aoMudar() : recalcularTabela();
```
Only the 5 `FILTROS_ALERTAS_CONFIG` entries set `cfg.aoMudar` (to `recalcularAlertas`) — every `FILTROS_CONFIG` entry (Origem/Categoria/Tipologia/Grupo/SUP/Série/Dimensão, the shared recorte filters) has no `aoMudar`, so changing any of them only calls `recalcularTabela()`. The Alertas tab never updates when a recorte filter changes. Confirmed by reproduction (Playwright): selecting a SUP in the top filter bar while on the Alertas tab leaves the Alertas table showing all SUPs, unchanged.

- [ ] **Step 1: Write the failing test**

Read `test/orcamento-render-dashboard.test.js` around its `extrairFuncoesPuras` helper (~line 130-215) first, so the new test sits alongside the existing wiring-assertion tests (e.g. the one from Task 7 checking `alternarAba`'s 3rd branch via a regex over `scriptTabela`). Add this test right after that one:

```js
test('every filter change (recorte or Alertas-specific) recalculates BOTH recalcularTabela and recalcularAlertas unconditionally -- the old cfg.aoMudar mechanism (which left recorte filters never touching Alertas) is gone', () => {
  const html = renderComSenha([registroExemplo()]);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const scriptTabela = scripts[3][1];
  assert.doesNotMatch(scriptTabela, /aoMudar/, 'aoMudar não deve existir mais em lugar nenhum -- nem no config, nem no handler');
  assert.match(scriptTabela, /recalcularTabela\(\);\s*\n\s*recalcularAlertas\(\);\s*\n\s*\}\);\s*\n\s*\}\);\s*\n\s*atualizarRotuloFiltro\(cfg, opcoes, estadoFiltros\);/, 'o final do handler de mudança de checkbox deve chamar as duas funções incondicionalmente, sem depender de cfg.aoMudar');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: FAIL — `aoMudar` still present in the current source.

- [ ] **Step 3: Implement the fix**

In `tools/orcamento/render-dashboard.js`, change the end of `montarFiltroMulti`'s checkbox change-handler from:
```js
      cfg.aoMudar ? cfg.aoMudar() : recalcularTabela();
    });
  });
  atualizarRotuloFiltro(cfg, opcoes, estadoFiltros);
}
```
to:
```js
      recalcularTabela();
      recalcularAlertas();
    });
  });
  atualizarRotuloFiltro(cfg, opcoes, estadoFiltros);
}
```

Then remove the now-unused `aoMudar` field from all 5 entries in `FILTROS_ALERTAS_CONFIG`. Change:
```js
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
```
to:
```js
var FILTROS_ALERTAS_CONFIG = [
  { id: 'filtro-alertas-agrupar-por', chave: 'agruparPor', rotuloPadrao: 'Agrupar por', exclusivo: true, opcoesFixas: [
    { valor: 'sup', rotulo: 'SUP' },
    { valor: 'tipologia', rotulo: 'Tipologia' },
    { valor: 'grupo', rotulo: 'Grupo' },
    { valor: 'categoria', rotulo: 'Categoria' },
    { valor: 'origem', rotulo: 'Origem' },
  ] },
  { id: 'filtro-alertas-dimensao', chave: 'dimensao', rotuloPadrao: 'Dimensão', exclusivo: true, opcoesFixas: DIMENSOES_CONFIG },
  { id: 'filtro-alertas-numerico', chave: 'numerico', rotuloPadrao: 'Selecione ao menos 1', minimoUm: true, opcoesFixas: [
    { valor: 'realizado', rotulo: 'Realizado' },
    { valor: 'total', rotulo: 'Tendência' },
  ] },
  { id: 'filtro-alertas-baseline', chave: 'baseline', rotuloPadrao: 'Selecione ao menos 1', minimoUm: true, opcoesFixas: [
    { valor: 'previsto', rotulo: 'Previsto' },
    { valor: 'previstoInicial', rotulo: 'Previsto Inicial' },
  ] },
  { id: 'filtro-alertas-periodo', chave: 'periodo', rotuloPadrao: 'Selecione ao menos 1', minimoUm: true, opcoesFixas: PERIODO_ORDEM.map(function (p) { return { valor: p, rotulo: PERIODO_LABELS[p] }; }) },
];
```

Also update the comment right above `FILTROS_ALERTAS_CONFIG` (currently explains `aoMudar` — search for "aoMudar aponta"), since it will be stale:
```js
// Config dos 5 seletores próprios da aba Alertas -- mesmo componente
// visual (filtro-multi) dos filtros de recorte, mas com estado PRÓPRIO
// (filtrosAlertas, não filtrosSelecionados) e, pra Agrupar por/Dimensão,
// exclusivo:true (single-choice, ver montarFiltroMulti). aoMudar aponta
// pra recalcularAlertas (definida na Task 7) em vez do recalcularTabela
// default, já que mudar um seletor da Alertas não deve tocar a Tabela/
// Gráfico.
```
becomes:
```js
// Config dos 5 seletores próprios da aba Alertas -- mesmo componente
// visual (filtro-multi) dos filtros de recorte, mas com estado PRÓPRIO
// (filtrosAlertas, não filtrosSelecionados) e, pra Agrupar por/Dimensão,
// exclusivo:true (single-choice, ver montarFiltroMulti). Toda mudança em
// QUALQUER filtro (este ou um de recorte) recalcula Tabela E Alertas
// incondicionalmente (ver o fim do handler de mudança em
// montarFiltroMulti) -- bug real corrigido aqui: antes só estes 5 tinham
// um gatilho (aoMudar) pra recalcularAlertas, então filtrar por SUP na
// barra de cima nunca atualizava a aba Alertas.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/*.test.js`
Expected: PASS — all tests, including the new one.

- [ ] **Step 5: Commit**

```bash
git add tools/orcamento/render-dashboard.js test/orcamento-render-dashboard.test.js
git commit -m "Fix Alertas tab never recalculating when a recorte filter changes"
```

---

### Task 2: Rewrite the Alertas table as a list (Referência/Pesquisado/Desvio/Status)

**Files:**
- Modify: `tools/orcamento/render-dashboard.js`
- Test: `test/orcamento-render-dashboard.test.js`

**Interfaces:**
- Consumes: `calcularCelulaAlerta`, `colunasAlertas`, `agruparIndicesAlertas`, `classificarSemaforo`, `formatarNumero`, `escapeHtml`, `normalizarBusca` (all existing, unchanged).
- Produces: `renderCabecalhoAlertas(agruparPorRotulo)` — signature CHANGES (drops the `colunas` parameter; header is now fixed 6 columns). `renderLinhaAlerta(rotuloGrupo, registros, indices, coluna, dimensao, vigenteIdx)` — signature CHANGES (now takes ONE `coluna`, not the full array; renders ONE `<tr>` with 6 `<td>`s, not a label + N colored cells). `renderCorpoAlertas(...)` — same signature as before, but now emits `grupos.length + 1` (TOTAL GERAL) times `colunas.length` rows total, not one row per group. `renderCelulaAlerta` is removed (folded into `renderLinhaAlerta`).

- [ ] **Step 1: Write the failing tests**

First, REPLACE the two now-invalid tests in `test/orcamento-render-dashboard.test.js` (they assert the old one-row-per-group-with-colored-cells shape). Find and replace:

```js
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
  assert.match(corpo, /background:#128A3E/, 'desvio de 110% cai na faixa Dentro da meta (verde), inclusive na fronteira');
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

with:

```js
test('renderCabecalhoAlertas has 6 fixed columns regardless of how many combinações are selected: [agrupar por] / Combinação / Referência / Pesquisado / Desvio / Status', () => {
  const html = renderComSenha([registroExemplo()]);
  const { renderCabecalhoAlertas } = extrairFuncoesPuras(html);
  const cabecalho = renderCabecalhoAlertas('SUP');
  assert.match(cabecalho, /<tr><th>SUP<\/th><th>Combinação<\/th><th>Referência<\/th><th>Pesquisado<\/th><th>Desvio<\/th><th>Status<\/th><\/tr>/);
});

test('renderCorpoAlertas emits one row PER (grupo, combinação) -- 2 grupos × 1 combinação = 2 data rows, plus 1 combinação × TOTAL GERAL = 3 rows total', () => {
  const html = renderComSenha([registroExemplo()]);
  const { renderCorpoAlertas } = extrairFuncoesPuras(html);
  const registroB = registroExemplo({ sup: 'SUP-B' });
  const registroA = registroExemplo({ sup: 'SUP-A' });
  const corpo = renderCorpoAlertas([registroB, registroA], [0, 1], 'sup', 'financeiro', ['realizado'], ['previsto'], ['totalAno'], 5);
  assert.equal((corpo.match(/<tr/g) || []).length, 3, '2 grupos (SUP-A, SUP-B) + 1 TOTAL GERAL, 1 combinação cada = 3 linhas');
  const posA = corpo.indexOf('SUP-A');
  const posB = corpo.indexOf('SUP-B');
  const posTotalGeral = corpo.indexOf('TOTAL GERAL');
  assert.ok(posA >= 0 && posB >= 0 && posTotalGeral >= 0);
  assert.ok(posA < posB, 'SUP-A vem antes de SUP-B (ordem alfabética)');
  assert.ok(posB < posTotalGeral, 'TOTAL GERAL vem por último');
});

test('renderCorpoAlertas emits N rows per grupo when N combinações are selected, each row carrying its own Combinação label, in the canonical Período→Numérico→Baseline order', () => {
  const html = renderComSenha([registroExemplo()]);
  const { renderCorpoAlertas } = extrairFuncoesPuras(html);
  const corpo = renderCorpoAlertas([registroExemplo()], [0], 'sup', 'financeiro', ['total', 'realizado'], ['previsto'], ['totalAno', 'acumuladoAteVigente'], 5);
  // 1 grupo (SUP-7133-24, da registroExemplo() default) + 1 TOTAL GERAL, 2 numéricos × 1 baseline × 2 períodos = 4 combinações cada = 8 linhas.
  assert.equal((corpo.match(/<tr/g) || []).length, 8);
  assert.match(corpo, /<td>Realizado ÷ Previsto — Acumulado até Vigente<\/td>/);
  assert.match(corpo, /<td>Tendência ÷ Previsto — Total Ano<\/td>/);
  const posAcumulado = corpo.indexOf('Acumulado até Vigente');
  const posTotalAno = corpo.indexOf('Total Ano');
  assert.ok(posAcumulado < posTotalAno, 'Acumulado até Vigente vem antes de Total Ano (ordem canônica de período)');
});

test('renderCorpoAlertas renders Referência (baseline absoluto) e Pesquisado (numérico absoluto) as separate <td>s, Desvio as a whole-number percentage, and a colored circle + label in Status -- no cell background color anywhere', () => {
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
  assert.match(corpo, /<td class="num">13\.200<\/td>/, 'Pesquisado (Realizado, numerador) = 1100*12');
  assert.match(corpo, /<td class="num">12\.000<\/td>/, 'Referência (Previsto, denominador) = 1000*12');
  assert.match(corpo, /<td class="num">110%<\/td>/, 'Desvio (110%, fronteira inclusiva do lado verde)');
  assert.match(corpo, /<span class="status-circulo" style="background:#128A3E"><\/span>Dentro da meta/);
  assert.doesNotMatch(corpo, /style="background:[^"]*"[^>]*>\s*\d+%/, 'a % do Desvio nunca deve ter fundo colorido -- só o círculo de Status carrega cor');
});

test('renderCorpoAlertas shows "—" for Referência/Pesquisado/Desvio and the cinza "Sem dado" status when the baseline bucket has no data', () => {
  const html = renderComSenha([registroExemplo()]);
  const { renderCorpoAlertas } = extrairFuncoesPuras(html);
  const registroSemPrevisto = registroExemplo({
    previsto: {
      equipes: Array(12).fill(0), equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 },
      volume: Array(12).fill(0), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
      financeiro: Array(12).fill(0), financeiroResumo: { total: 0, totalInicial: 0 },
    },
  });
  const corpo = renderCorpoAlertas([registroSemPrevisto], [0], 'sup', 'financeiro', ['realizado'], ['previsto'], ['totalAno'], 5);
  assert.match(corpo, /<span class="status-circulo" style="background:#6E7580"><\/span>Sem dado/);
});

test('renderCorpoAlertas gives every row a data-search attribute (normalized: lowercase, sem acento) combining the grupo label and the Combinação label, for the text search box', () => {
  const html = renderComSenha([registroExemplo()]);
  const { renderCorpoAlertas } = extrairFuncoesPuras(html);
  const corpo = renderCorpoAlertas([registroExemplo({ sup: 'SUP-Ímpar' })], [0], 'sup', 'financeiro', ['realizado'], ['previsto'], ['totalAno'], 5);
  assert.match(corpo, /<tr data-search="sup-impar realizado [^"]*previsto[^"]*total ano"/);
});
```

Add `normalizarBusca` to `extrairFuncoesPuras`'s extraction list if it is not already there (check first — it may already be extracted for other tests; if present, skip this sub-step).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: FAIL — the new assertions don't match the current one-row-per-group, colored-cell output.

- [ ] **Step 3: Implement the new rendering**

In `tools/orcamento/render-dashboard.js`, replace the current block (from `renderCabecalhoAlertas` through `renderCorpoAlertas` — i.e. delete `renderCabecalhoAlertas`, `renderCelulaAlerta`, `renderLinhaAlerta`, `renderCorpoAlertas` entirely) with:

```js
function renderCabecalhoAlertas(agruparPorRotulo) {
  return '<tr><th>' + escapeHtml(agruparPorRotulo) + '</th><th>Combinação</th><th>Referência</th><th>Pesquisado</th><th>Desvio</th><th>Status</th></tr>';
}

// Uma linha por (grupo, combinação) -- Referência/Pesquisado são os
// valores absolutos que antes só apareciam no tooltip (feedback do
// usuário: queria conferir o dado, não só confiar na %). Status é um
// círculo cheio (não um badge com borda, nem fundo de célula colorido --
// pedido explícito) seguido do rótulo por extenso.
function renderLinhaAlerta(rotuloGrupo, registros, indices, coluna, dimensao, vigenteIdx) {
  var celula = calcularCelulaAlerta(registros, indices, coluna, dimensao, vigenteIdx);
  var classe = classificarSemaforo(celula.desvio);
  var desvioTexto = celula.desvio === null ? '—' : Math.round(celula.desvio * 100) + '%';
  var referencia = formatarNumero(celula.denominador, 0);
  var pesquisado = formatarNumero(celula.numerador, 0);
  var busca = normalizarBusca(rotuloGrupo + ' ' + coluna.rotulo);
  return '<tr data-search="' + escapeHtml(busca) + '">' +
    '<td>' + escapeHtml(rotuloGrupo) + '</td>' +
    '<td>' + escapeHtml(coluna.rotulo) + '</td>' +
    '<td class="num">' + referencia + '</td>' +
    '<td class="num">' + pesquisado + '</td>' +
    '<td class="num">' + desvioTexto + '</td>' +
    '<td><span class="status-circulo" style="background:' + classe.cor + '"></span>' + escapeHtml(classe.indicador) + '</td>' +
    '</tr>';
}

function renderLinhasGrupoAlerta(rotuloGrupo, registros, indices, colunas, dimensao, vigenteIdx) {
  return colunas.map(function (c) { return renderLinhaAlerta(rotuloGrupo, registros, indices, c, dimensao, vigenteIdx); }).join('');
}

function renderCorpoAlertas(registros, indices, agruparPor, dimensao, numericos, baselines, periodos, vigenteIdx) {
  var colunas = colunasAlertas(numericos, baselines, periodos);
  var grupos = agruparIndicesAlertas(registros, indices, agruparPor);
  var linhas = grupos.map(function (g) { return renderLinhasGrupoAlerta(g.chave, registros, g.indices, colunas, dimensao, vigenteIdx); });
  linhas.push(renderLinhasGrupoAlerta('TOTAL GERAL', registros, indices, colunas, dimensao, vigenteIdx));
  return linhas.join('');
}
```

Update `recalcularAlertas()`'s call to `renderCabecalhoAlertas` (it currently passes `colunas` as a 2nd argument, which no longer exists). Change:
```js
  document.getElementById('cabecalho-alertas').innerHTML = renderCabecalhoAlertas(AGRUPAR_POR_ROTULO[agruparPor], colunas);
```
to:
```js
  document.getElementById('cabecalho-alertas').innerHTML = renderCabecalhoAlertas(AGRUPAR_POR_ROTULO[agruparPor]);
```
(`colunas` is still computed in `recalcularAlertas` two lines above via `colunasAlertas(...)` and still passed to `renderCorpoAlertas` — only the header call drops it, since the header no longer varies by column count.)

In the CSS `<style>` block, replace:
```css
  .celula-alerta {
    color: #ffffff; font-weight: 600; text-align: center;
    padding: 6px 10px; font-size: 13px;
  }
```
with:
```css
  .status-circulo {
    display: inline-block; width: 10px; height: 10px; border-radius: 50%;
    margin-right: 6px; vertical-align: middle;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/*.test.js`
Expected: PASS — all tests, including the rewritten ones.

- [ ] **Step 5: Commit**

```bash
git add tools/orcamento/render-dashboard.js test/orcamento-render-dashboard.test.js
git commit -m "Rewrite Alertas table as a list (Referência/Pesquisado/Desvio/Status círculo)"
```

---

### Task 3: Add a text search box above the Alertas table

**Files:**
- Modify: `tools/orcamento/render-dashboard.js`
- Test: `test/orcamento-render-dashboard.test.js`

**Interfaces:**
- Consumes: `normalizarBusca` (existing), the `data-search` attribute added to every `<tr>` in Task 2.
- Produces: `aplicarBuscaAlertas()` — reads `#busca-alertas`'s current value, normalizes it, and toggles `display` on every `#tabela-alertas tbody tr` based on whether its `data-search` contains the normalized term (empty term shows everything). Called once from a new `input` event listener wired in `montarDashboard`, AND at the end of `recalcularAlertas()` (so a filter change that rebuilds the table re-applies whatever search term is currently typed, instead of resetting to "show everything").

- [ ] **Step 1: Write the failing tests**

```js
test('aplicarBuscaAlertas (extraído do HTML real gerado) hides rows whose data-search does not contain the normalized search term, and shows all rows when the term is empty', () => {
  const html = renderComSenha([registroExemplo()]);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const scriptTabela = scripts[3][1];
  const linhas = [
    { dataset: { search: 'sup-a realizado previsto total ano' }, style: {} },
    { dataset: { search: 'sup-b realizado previsto total ano' }, style: {} },
  ];
  const sandbox = {
    document: {
      getElementById: function (id) {
        if (id === 'busca-alertas') return { value: 'sup-a' };
        return null;
      },
      querySelectorAll: function (sel) {
        if (sel === '#tabela-alertas tbody tr') return linhas;
        return [];
      },
    },
    window: {},
  };
  vm.createContext(sandbox);
  vm.runInContext(scriptTabela + '\nthis.aplicarBuscaAlertas = aplicarBuscaAlertas; this.normalizarBusca = normalizarBusca;', sandbox);
  sandbox.aplicarBuscaAlertas();
  assert.equal(linhas[0].style.display, '', 'SUP-A combina com o termo "sup-a"');
  assert.equal(linhas[1].style.display, 'none', 'SUP-B não combina');

  sandbox.document.getElementById = function (id) { return id === 'busca-alertas' ? { value: '' } : null; };
  sandbox.aplicarBuscaAlertas();
  assert.equal(linhas[0].style.display, '', 'termo vazio mostra tudo de novo');
  assert.equal(linhas[1].style.display, '', 'termo vazio mostra tudo de novo');
});

test('renderDashboard includes the busca-alertas text input above the Alertas table', () => {
  const html = renderComSenha([registroExemplo()]);
  assert.match(html, /<input id="busca-alertas" type="text" class="busca-alertas" placeholder="Buscar\.\.\." autocomplete="off">/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: FAIL — `aplicarBuscaAlertas` and the `busca-alertas` input don't exist yet.

- [ ] **Step 3: Implement**

Add this function inside `SCRIPT_CLIENTE_TABELA`, right after `recalcularAlertas` (so the two search-relevant functions sit together):

```js
// Filtra as linhas JÁ renderizadas da tabela de Alertas por texto --
// nunca refaz a busca de dados (bucketPeriodo etc.), só esconde/mostra
// <tr> pelo data-search que renderLinhaAlerta já embutiu. Termo vazio
// mostra tudo (mesma convenção do campo de busca dentro de cada
// filtro-multi, ver montarFiltroMulti).
function aplicarBuscaAlertas() {
  var termo = normalizarBusca(document.getElementById('busca-alertas').value);
  document.querySelectorAll('#tabela-alertas tbody tr').forEach(function (tr) {
    var combina = termo === '' || (tr.dataset.search || '').indexOf(termo) !== -1;
    tr.style.display = combina ? '' : 'none';
  });
}
```

Update `recalcularAlertas()` to re-apply the search after rebuilding the table — add `aplicarBuscaAlertas();` as its last line:
```js
  document.getElementById('corpo-alertas').innerHTML = renderCorpoAlertas(
    window.__REGISTROS__, indices, agruparPor, dimensao, numericos, baselines, periodos, window.__VIGENTE_IDX__
  );
  aplicarBuscaAlertas();
}
```

Wire the input listener in `montarDashboard` — add this line right after the existing `document.getElementById('aba-alertas').addEventListener('click', function () { alternarAba('alertas'); });` line:
```js
  document.getElementById('busca-alertas').addEventListener('input', aplicarBuscaAlertas);
```

In `tools/orcamento/render-dashboard.js`'s returned HTML template, add the input right after the `.filtros.filtros-alertas` div's closing `</div>` and before `<div class="table-scroll">` inside `secao-alertas`. Change:
```html
      <div class="filtros filtros-alertas">
        <div class="filtros-selecao">
          <div class="filtro-multi" id="filtro-alertas-agrupar-por">...</div>
          ...
        </div>
      </div>
      <div class="table-scroll">
      <table id="tabela-alertas">
```
to (only the new line added, the 5 `filtro-multi` divs stay exactly as they are):
```html
      <div class="filtros filtros-alertas">
        <div class="filtros-selecao">
          <div class="filtro-multi" id="filtro-alertas-agrupar-por">...</div>
          ...
        </div>
      </div>
      <input id="busca-alertas" type="text" class="busca-alertas" placeholder="Buscar..." autocomplete="off">
      <div class="table-scroll">
      <table id="tabela-alertas">
```

Add CSS, right after the `.status-circulo` rule added in Task 2:
```css
  .busca-alertas {
    display: block; width: 100%; max-width: 320px; box-sizing: border-box;
    margin-bottom: 12px; padding: 8px 10px;
    border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface-1); color: var(--text-primary); font-size: 13px;
  }
  .busca-alertas::placeholder { color: var(--text-secondary); }
  .busca-alertas:focus-visible { outline: 2px solid #f6b53f; outline-offset: 1px; }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/*.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/orcamento/render-dashboard.js test/orcamento-render-dashboard.test.js
git commit -m "Add a text search box above the Alertas table (busca-alertas)"
```

---

### Task 4: Visual verification, rebuild, and deploy

**Files:**
- Modify: `dist/orcamento-dashboard.html` (generated), `docs/index.html` (generated copy)

- [ ] **Step 1: Run the full test suite one more time**

Run: `node --test test/*.test.js`
Expected: PASS, every test.

- [ ] **Step 2: Rebuild with the real password**

```bash
ORCAMENTO_SENHA=<senha real> node tools/orcamento/build-dashboard.js
```

- [ ] **Step 3: Visual check with Playwright**

Open the rebuilt `dist/orcamento-dashboard.html` (via a local static server, same pattern as before), unlock with the real password, go to the Alertas tab, and confirm:
- The table now shows one row per (grupo, combinação) with columns [Agrupar por] / Combinação / Referência / Pesquisado / Desvio / Status — no colored cell backgrounds anywhere, only a small colored circle in the Status column.
- **The filter-propagation fix**: select a specific SUP in the TOP filter bar (Todos os SUP), confirm the Alertas table narrows to only that SUP's rows (this was the reported bug — must work now).
- The `busca-alertas` text box filters visible rows by typed text, and survives a filter change (type a search term, then change "Agrupar por" — the search term should still be applied to the freshly rebuilt rows, not reset).
- TOTAL GERAL rows still appear at the end.
- No regression in Tabela/Gráfico tabs.

Fix anything broken before proceeding.

- [ ] **Step 4: Copy to the Pages source and verify**

```bash
cp dist/orcamento-dashboard.html docs/index.html
```
Confirm both files show the same "Gerado em" timestamp.

- [ ] **Step 5: Commit and push**

```bash
git add dist/orcamento-dashboard.html docs/index.html
git commit -m "Rebuild dashboard: Alertas tab v2 (lista + fix de filtros)"
git push
```

Then poll the GitHub Pages build status and `curl` the live URL to confirm the "Gerado em" timestamp matches this build before considering the task complete.
