# 5ª série "Realizado + Previsto Inicial" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 5th série to the Gráfico tab only — "Realizado + Previsto Inicial" (Realizado up to the last reported month, then the original baseline Previsto Inicial for the remaining months) — per `docs/superpowers/specs/2026-07-26-serie-realizado-previsto-inicial-design.md`.

**Architecture:** Same file (`tools/orcamento/render-dashboard.js`), same single-file dashboard architecture as the rest of the project — the whole file from `SCRIPT_CLIENTE_TABELA = \`` (line 91) onward IS the literal client-side `<script>` content embedded into the generated HTML, so editing it directly edits the browser-run code. `ORDEM_SERIES` (which drives the Tabela's per-registro rows) is left untouched; a new `ORDEM_SERIES_GRAFICO` constant (superset) is used only by the Gráfico's `construirPainelGraficoHtml`.

**Tech Stack:** Node.js (`node --test`), vanilla client-side JS (no framework, no bundler), Playwright for visual verification.

## Global Constraints

- No new npm dependencies. No TypeScript.
- Run `node --test test/*.test.js` after every task; all existing tests must keep passing.
- The new série is **Gráfico-only** — `ORDEM_SERIES` (Tabela row generation) must never include `realizadoPrevistoInicial`. Every existing Tabela row-count test must keep passing unchanged.
- Série key: `realizadoPrevistoInicial`. Label: `"Realizado + Previsto Inicial"`. Color: `#a78bfa`. Dash pattern: `6,3,1,3`.
- A month `<= ultimoMesRealizado` (the last month with real Realizado data, using the existing `ultimoIndiceComDado` + `removerZerosFinaisNaoReportados` cleanup) never shows the new série — same rule already applied to Tendência. A month `> ultimoMesRealizado` shows Previsto Inicial's own value for that month (never Previsto atual, never the MATRIZ's T row).
- The new série starts **desmarcada** (unchecked) in the `filtro-serie` dropdown, same convention as Previsto Inicial today (not added to `SERIES_PADRAO_ATIVAS`).
- Applies to all 5 dimensions (Equipes, Volume, Financeiro, Produtividade, Ticket Médio) — no Financeiro-only special case.
- Rebuild `dist/orcamento-dashboard.html` and copy to `docs/index.html` is only required in the final task — earlier tasks only need `node --test` to pass.

---

### Task 1: Generalize `calcularAcumuladoTendencia` into `calcularAcumuladoAposRealizado`

**Files:**
- Modify: `tools/orcamento/render-dashboard.js:385-402`
- Modify: `test/orcamento-render-dashboard.test.js` (harness injection list + 2 existing tests)

**Interfaces:**
- Consumes: nothing new.
- Produces: `calcularAcumuladoAposRealizado(mensalFutura, acumuladoRealizado, ultimoMesRealizado)` — same signature and behavior as the old `calcularAcumuladoTendencia`, just renamed so Task 2 can reuse it for a second série without the name implying it's Tendência-specific.

This is a pure rename + doc-comment generalization. No behavior changes — every existing test that covers this function must keep passing verbatim (just referencing the new name).

- [ ] **Step 1: Rename the function definition**

In `tools/orcamento/render-dashboard.js`, replace (lines 385-402):
```js
// Acumulado da série Tendência nunca recomeça do zero em Jan -- a SOMA
// interna continua exatamente de onde o acumulado de Realizado parou, pra
// o primeiro mês futuro somar em cima do total real já reportado. O PONTO
// de conexão em si (o último mês de Realizado) não aparece na série de
// Tendência, só em Realizado -- um mês que já tem Realizado mostra
// Previsto+Realizado, nunca Previsto+Realizado+Tendência (confirmado com o
// usuário: Tendência é só a projeção dos meses AINDA sem Realizado). Sem
// nenhum mês de Realizado (ultimoMesRealizado -1), a Tendência acumula
// sozinha desde Jan, do jeito usual.
function calcularAcumuladoTendencia(mensalTotal, acumuladoRealizado, ultimoMesRealizado) {
  if (ultimoMesRealizado === -1) return calcularAcumulado(mensalTotal);
  var resultado = new Array(mensalTotal.length).fill(null);
  var soma = acumuladoRealizado[ultimoMesRealizado] || 0;
  for (var i = ultimoMesRealizado + 1; i < mensalTotal.length; i++) {
    soma += mensalTotal[i] || 0;
    resultado[i] = soma;
  }
  return resultado;
}
```
with:
```js
// Acumulado de uma série "pós-Realizado" (Tendência, ou Realizado +
// Previsto Inicial) nunca recomeça do zero em Jan -- a SOMA interna
// continua exatamente de onde o acumulado de Realizado parou, pra o
// primeiro mês futuro somar em cima do total real já reportado. O PONTO
// de conexão em si (o último mês de Realizado) não aparece na série
// futura, só em Realizado -- um mês que já tem Realizado mostra
// Previsto+Realizado, nunca as duas séries juntas (confirmado com o
// usuário: tanto Tendência quanto Realizado+Previsto Inicial são só a
// projeção dos meses AINDA sem Realizado). Sem nenhum mês de Realizado
// (ultimoMesRealizado -1), a série futura acumula sozinha desde Jan, do
// jeito usual. `mensalFutura` já vem com null em todo mês
// `<= ultimoMesRealizado` (quem monta essa máscara é o chamador -- ver
// construirPainelGraficoHtml).
function calcularAcumuladoAposRealizado(mensalFutura, acumuladoRealizado, ultimoMesRealizado) {
  if (ultimoMesRealizado === -1) return calcularAcumulado(mensalFutura);
  var resultado = new Array(mensalFutura.length).fill(null);
  var soma = acumuladoRealizado[ultimoMesRealizado] || 0;
  for (var i = ultimoMesRealizado + 1; i < mensalFutura.length; i++) {
    soma += mensalFutura[i] || 0;
    resultado[i] = soma;
  }
  return resultado;
}
```

- [ ] **Step 2: Update the test harness injection list**

In `test/orcamento-render-dashboard.test.js`, find (inside `extrairFuncoesPuras`, the `vm.runInContext` string):
```js
      ' this.calcularAcumuladoTendencia = calcularAcumuladoTendencia;' +
```
Replace with:
```js
      ' this.calcularAcumuladoAposRealizado = calcularAcumuladoAposRealizado;' +
```
And find the returned object's:
```js
    calcularAcumuladoTendencia: sandbox.calcularAcumuladoTendencia,
```
Replace with:
```js
    calcularAcumuladoAposRealizado: sandbox.calcularAcumuladoAposRealizado,
```

- [ ] **Step 3: Update the two existing tests to use the new name**

Find:
```js
test('calcularAcumuladoTendencia (extraído do HTML real gerado) picks up Tendência\'s running total exactly where Realizado\'s accumulated total left off, not from zero -- but the connection month itself stays null (só Realizado aparece nesse mês, confirmado com o usuário: um mês com Realizado nunca mostra Tendência)', () => {
  const html = renderComSenha([registroExemplo()]);
  const { calcularAcumuladoTendencia, calcularAcumulado } = extrairFuncoesPuras(html);
  const mensalRealizado = [10, 10, 10, null, null, null, null, null, null, null, null, null];
  const acumuladoRealizado = calcularAcumulado(mensalRealizado); // [10,20,30,30,30,...]
  const ultimoMesRealizado = 2;
  const mensalTendencia = [null, null, null, 5, 5, 5, null, null, null, null, null, null];
  const resultado = calcularAcumuladoTendencia(mensalTendencia, acumuladoRealizado, ultimoMesRealizado);
  assert.deepEqual(paraPlano(resultado.slice(0, 3)), [null, null, null], 'até e incluindo o último mês de Realizado (índice 2), Tendência não desenha nada -- quem cobre esses meses é o Realizado');
  assert.deepEqual(paraPlano(resultado.slice(3, 6)), [35, 40, 45], 'a partir do 1º mês futuro, soma a própria contribuição mensal da Tendência EM CIMA do acumulado real herdado (30 + 5 = 35), sem mostrar o valor herdado como um ponto próprio da Tendência');
});

test('calcularAcumuladoTendencia falls back to accumulating Tendência alone from Jan when there is no Realizado month at all', () => {
  const html = renderComSenha([registroExemplo()]);
  const { calcularAcumuladoTendencia } = extrairFuncoesPuras(html);
  const resultado = calcularAcumuladoTendencia([5, 5, 5], [], -1);
  assert.deepEqual(paraPlano(resultado), [5, 10, 15]);
});
```
Replace with:
```js
test('calcularAcumuladoAposRealizado (extraído do HTML real gerado, usado tanto por Tendência quanto por Realizado+Previsto Inicial) picks up the running total exactly where Realizado\'s accumulated total left off, not from zero -- but the connection month itself stays null (só Realizado aparece nesse mês, confirmado com o usuário: um mês com Realizado nunca mostra a série futura)', () => {
  const html = renderComSenha([registroExemplo()]);
  const { calcularAcumuladoAposRealizado, calcularAcumulado } = extrairFuncoesPuras(html);
  const mensalRealizado = [10, 10, 10, null, null, null, null, null, null, null, null, null];
  const acumuladoRealizado = calcularAcumulado(mensalRealizado); // [10,20,30,30,30,...]
  const ultimoMesRealizado = 2;
  const mensalFutura = [null, null, null, 5, 5, 5, null, null, null, null, null, null];
  const resultado = calcularAcumuladoAposRealizado(mensalFutura, acumuladoRealizado, ultimoMesRealizado);
  assert.deepEqual(paraPlano(resultado.slice(0, 3)), [null, null, null], 'até e incluindo o último mês de Realizado (índice 2), a série futura não desenha nada -- quem cobre esses meses é o Realizado');
  assert.deepEqual(paraPlano(resultado.slice(3, 6)), [35, 40, 45], 'a partir do 1º mês futuro, soma a própria contribuição mensal EM CIMA do acumulado real herdado (30 + 5 = 35), sem mostrar o valor herdado como um ponto próprio da série futura');
});

test('calcularAcumuladoAposRealizado falls back to accumulating the série futura alone from Jan when there is no Realizado month at all', () => {
  const html = renderComSenha([registroExemplo()]);
  const { calcularAcumuladoAposRealizado } = extrairFuncoesPuras(html);
  const resultado = calcularAcumuladoAposRealizado([5, 5, 5], [], -1);
  assert.deepEqual(paraPlano(resultado), [5, 10, 15]);
});
```

- [ ] **Step 4: Run the full suite**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: PASS, every test (this is a pure rename — nothing should fail if done correctly; if `calcularAcumuladoTendencia` is referenced anywhere else, this step will surface it as a `ReferenceError`).

- [ ] **Step 5: Commit**

```bash
git add tools/orcamento/render-dashboard.js test/orcamento-render-dashboard.test.js
git commit -m "Generalize calcularAcumuladoTendencia into calcularAcumuladoAposRealizado (prep for a 2nd série reusing it)"
```

---

### Task 2: Add série metadata + compute it in `construirPainelGraficoHtml`

**Files:**
- Modify: `tools/orcamento/render-dashboard.js:466-473` (SERIE_COR/SERIE_TRACEJADO)
- Modify: `tools/orcamento/render-dashboard.js:757-812` (construirPainelGraficoHtml)
- Modify: `tools/orcamento/render-dashboard.js:1017-1019` (SERIE_LABELS/ORDEM_SERIES/CLASSE_SERIE — add `ORDEM_SERIES_GRAFICO` here, do NOT touch `ORDEM_SERIES` itself)
- Modify: `tools/orcamento/render-dashboard.js:1261-1266` (filtro-serie opcoesFixas)
- Test: `test/orcamento-render-dashboard.test.js`

**Interfaces:**
- Consumes: `calcularAcumuladoAposRealizado` (Task 1), existing `ultimoIndiceComDado`, `removerZerosFinaisNaoReportados`, `calcularAcumulado`, `calcularMensal`, `filtroExclui`.
- Produces: `ORDEM_SERIES_GRAFICO` (array, `ORDEM_SERIES` + `'realizadoPrevistoInicial'`), used only inside `construirPainelGraficoHtml`. `SERIE_LABELS.realizadoPrevistoInicial`, `SERIE_COR.realizadoPrevistoInicial`, `SERIE_TRACEJADO.realizadoPrevistoInicial`. The `filtro-serie` config's `opcoesFixas` array gains a 5th entry.

**Step 1: Write the failing test — real ~104MM case**

Read `test/orcamento-render-dashboard.test.js` around the existing test `'construirPainelGraficoHtml: a trailing zero artifact in Realizado...'` (search for it) — add the new test right after it:

```js
test('construirPainelGraficoHtml computes a 5ª série "Realizado + Previsto Inicial": Realizado up to the last reported month, Previsto Inicial for the rest -- real case, financeiro sem filtro fecha em ~104MM (Realizado Jan-Jun ~49.299 + Previsto Inicial Jul-Dez)', () => {
  const html = renderComSenha([registroExemplo()]);
  const { construirPainelGraficoHtml } = extrairFuncoesPuras(html);
  const registro = registroExemplo({
    realizado: {
      equipes: Array(12).fill(5), volume: Array(12).fill(80),
      financeiro: [10000, 10000, 10000, 10000, 10000, 10000, null, null, null, null, null, null],
    },
    previstoInicial: {
      equipes: Array(12).fill(0), equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 },
      volume: Array(12).fill(0), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
      financeiro: [10000, 10000, 10000, 10000, 10000, 10000, 12000, 12000, 12000, 12000, 12000, 12000],
      financeiroResumo: { total: 0, totalInicial: 0 },
    },
  });
  const htmlPainel = construirPainelGraficoHtml([registro], [0], new Set(['realizadoPrevistoInicial']), 'financeiro');

  // Mensal: Jan-Jun não desenha a nova série (mesma regra da Tendência);
  // Jul-Dez desenha Previsto Inicial (12.000/mês).
  const mensalMatch = htmlPainel.match(/Mensal[\s\S]*?Acumulado no ano/);
  assert.ok(mensalMatch, 'esperava o painel Mensal no HTML');
  assert.equal((mensalMatch[0].match(/fill="#a78bfa"/g) || []).length, 6, 'só 6 barras (Jul-Dez) na cor da nova série -- Jan-Jun não desenha nada dela');

  // Acumulado: Jun = 60.000 (6 x 10.000, herdado do Realizado, não
  // desenhado); Jul = 60.000 + 12.000 = 72.000; ... Dez = 60.000 + 6x12.000 = 132.000.
  const acumuladoMatch = htmlPainel.match(/Acumulado no ano[\s\S]*$/);
  assert.match(acumuladoMatch[0], /72\.000/, 'julho deveria ser 60.000 (acumulado real de junho) + 12.000 (Previsto Inicial de julho) = 72.000');
  assert.match(acumuladoMatch[0], /132\.000/, 'dezembro deveria fechar em 60.000 + 6×12.000 = 132.000');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: FAIL — `realizadoPrevistoInicial` isn't a recognized série yet, so `seriesVisiveis` (built from `ORDEM_SERIES`, which doesn't include it) filters it out entirely; no `fill="#a78bfa"` anywhere in the output.

- [ ] **Step 3: Add série metadata**

In `tools/orcamento/render-dashboard.js`, replace (lines 466-473):
```js
// Mesmo cinza claro usado na linha "Previsto Inicial" da tabela (.linha-previsto-inicial),
// pra não inventar uma cor nova pra mesma série.
var SERIE_COR = { previstoInicial: '#8b8a82', previsto: '#2f6ad0', realizado: '#7fd858', total: '#f6b53f' };
// Tracejado por série além da cor -- segunda camada de identidade (não só
// hue) pra sobreviver a daltonismo/impressão P&B: previsto inicial pontilhado
// esparso (mais discreto, é a referência de fundo), previsto sólido,
// realizado pontilhado fino, tendência tracejado longo.
var SERIE_TRACEJADO = { previstoInicial: '2,4', previsto: '', realizado: '1,5', total: '9,5' };
```
with:
```js
// Mesmo cinza claro usado na linha "Previsto Inicial" da tabela (.linha-previsto-inicial),
// pra não inventar uma cor nova pra mesma série. Roxo é a 5ª cor
// categórica (só do Gráfico, ver ORDEM_SERIES_GRAFICO) -- distinta das
// outras 4 hues (cinza/azul/verde/âmbar).
var SERIE_COR = { previstoInicial: '#8b8a82', previsto: '#2f6ad0', realizado: '#7fd858', total: '#f6b53f', realizadoPrevistoInicial: '#a78bfa' };
// Tracejado por série além da cor -- segunda camada de identidade (não só
// hue) pra sobreviver a daltonismo/impressão P&B: previsto inicial pontilhado
// esparso (mais discreto, é a referência de fundo), previsto sólido,
// realizado pontilhado fino, tendência tracejado longo, realizado+previsto
// inicial dash-dot (distinto dos outros 4 traços).
var SERIE_TRACEJADO = { previstoInicial: '2,4', previsto: '', realizado: '1,5', total: '9,5', realizadoPrevistoInicial: '6,3,1,3' };
```

- [ ] **Step 4: Add `ORDEM_SERIES_GRAFICO` and the label**

In `tools/orcamento/render-dashboard.js`, find (lines 1017-1019):
```js
var SERIE_LABELS = { previstoInicial: 'Previsto Inicial', previsto: 'Previsto', realizado: 'Realizado', total: 'Tendência' };
var ORDEM_SERIES = ['previstoInicial', 'previsto', 'realizado', 'total'];
var CLASSE_SERIE = { previstoInicial: 'previsto-inicial', previsto: 'previsto', realizado: 'realizado', total: 'total' };
```
Replace with:
```js
var SERIE_LABELS = { previstoInicial: 'Previsto Inicial', previsto: 'Previsto', realizado: 'Realizado', total: 'Tendência', realizadoPrevistoInicial: 'Realizado + Previsto Inicial' };
// ORDEM_SERIES gera as linhas por registro da TABELA (renderBlocosDimensao)
// -- fica só com as 4 séries originais de propósito. ORDEM_SERIES_GRAFICO
// é a versão usada SÓ pelo Gráfico (construirPainelGraficoHtml), com a 5ª
// série "Realizado + Previsto Inicial" -- confirmado com o usuário que
// essa série não faz sentido como uma 5ª linha da Tabela.
var ORDEM_SERIES = ['previstoInicial', 'previsto', 'realizado', 'total'];
var ORDEM_SERIES_GRAFICO = ORDEM_SERIES.concat(['realizadoPrevistoInicial']);
var CLASSE_SERIE = { previstoInicial: 'previsto-inicial', previsto: 'previsto', realizado: 'realizado', total: 'total' };
```

- [ ] **Step 5: Add the filtro-serie option**

In `tools/orcamento/render-dashboard.js`, find (lines 1261-1266):
```js
  { id: 'filtro-serie', chave: 'serie', rotuloPadrao: 'Todas as séries', opcoesFixas: [
    { valor: 'previstoInicial', rotulo: 'Previsto Inicial' },
    { valor: 'previsto', rotulo: 'Previsto' },
    { valor: 'realizado', rotulo: 'Realizado' },
    { valor: 'total', rotulo: 'Tendência' },
  ] },
```
Replace with:
```js
  { id: 'filtro-serie', chave: 'serie', rotuloPadrao: 'Todas as séries', opcoesFixas: [
    { valor: 'previstoInicial', rotulo: 'Previsto Inicial' },
    { valor: 'previsto', rotulo: 'Previsto' },
    { valor: 'realizado', rotulo: 'Realizado' },
    { valor: 'total', rotulo: 'Tendência' },
    // Só existe no Gráfico (ORDEM_SERIES_GRAFICO) -- nenhuma <tr> da
    // Tabela tem data-serie="realizadoPrevistoInicial", então marcar essa
    // opção aqui não tem efeito na Tabela, só filtra o Gráfico.
    { valor: 'realizadoPrevistoInicial', rotulo: 'Realizado + Previsto Inicial' },
  ] },
```

- [ ] **Step 6: Restructure `construirPainelGraficoHtml` to compute the new série**

In `tools/orcamento/render-dashboard.js`, replace (lines 757-791):
```js
function construirPainelGraficoHtml(registros, indices, filtroSerie, dimensao) {
  var seriesVisiveis = ORDEM_SERIES.filter(function (s) { return !filtroExclui(filtroSerie, s); });
  var ehRazao = DIMENSOES_RAZAO.indexOf(dimensao) !== -1;

  var mensalPorSerie = {};
  seriesVisiveis.forEach(function (serie) {
    var valoresLista = indices.map(function (idx) { return registros[idx][serie]; });
    mensalPorSerie[serie] = calcularMensal(valoresLista, serie, dimensao) || new Array(12).fill(null);
  });
  if (mensalPorSerie.realizado) mensalPorSerie.realizado = removerZerosFinaisNaoReportados(mensalPorSerie.realizado);

  // Um mês com Realizado nunca mostra Tendência junto (confirmado com o
  // usuário: Tendência é só a projeção dos meses AINDA sem Realizado) --
  // painel Mensal mostra Previsto+Realizado nesses meses, Previsto+Tendência
  // nos meses futuros, nunca as 3 juntas. ultimoMesRealizado só serve pro
  // Acumulado saber de onde herdar a soma corrida (ver
  // calcularAcumuladoTendencia) -- não precisa (e não deve) editar
  // mensalPorSerie.total aqui.
  var ultimoMesRealizado = -1;
  if (mensalPorSerie.realizado) ultimoMesRealizado = ultimoIndiceComDado(mensalPorSerie.realizado);

  var dadosPorSerie = seriesVisiveis.map(function (serie) {
    var mensal = mensalPorSerie[serie];
    var acumulado = null;
    if (!ehRazao) {
      if (serie === 'total') {
        acumulado = calcularAcumuladoTendencia(mensal, calcularAcumulado(mensalPorSerie.realizado || []), ultimoMesRealizado);
      } else if (serie === 'realizado') {
        acumulado = cortarAcumuladoNoUltimoDado(calcularAcumulado(mensal), mensal);
      } else {
        acumulado = calcularAcumulado(mensal);
      }
    }
    return { serie: serie, mensal: mensal, acumulado: acumulado };
  });
```
with:
```js
function construirPainelGraficoHtml(registros, indices, filtroSerie, dimensao) {
  var seriesVisiveis = ORDEM_SERIES_GRAFICO.filter(function (s) { return !filtroExclui(filtroSerie, s); });
  var ehRazao = DIMENSOES_RAZAO.indexOf(dimensao) !== -1;

  function mensalBruto(serie) {
    var valoresLista = indices.map(function (idx) { return registros[idx][serie]; });
    return calcularMensal(valoresLista, serie, dimensao) || new Array(12).fill(null);
  }

  // Realizado e Previsto Inicial SEMPRE calculados, mesmo se não
  // estiverem marcados no filtro de série -- Tendência e "Realizado +
  // Previsto Inicial" dependem dos dois pra achar onde o Realizado parou
  // (ultimoMesRealizado) e montar a parte futura, mesmo quando nenhum dos
  // dois está marcado pra aparecer no gráfico (efeito colateral bom: antes
  // dessa mudança, desmarcar "Realizado" no filtro fazia a Tendência
  // "esquecer" o total real acumulado e recomeçar sozinha do zero -- não
  // acontece mais).
  var mensalRealizado = removerZerosFinaisNaoReportados(mensalBruto('realizado'));
  var mensalPrevistoInicial = mensalBruto('previstoInicial');
  var ultimoMesRealizado = ultimoIndiceComDado(mensalRealizado);
  var acumuladoRealizado = calcularAcumulado(mensalRealizado);

  var mensalPorSerie = { realizado: mensalRealizado, previstoInicial: mensalPrevistoInicial };
  seriesVisiveis.forEach(function (serie) {
    if (mensalPorSerie[serie] || serie === 'realizadoPrevistoInicial') return;
    mensalPorSerie[serie] = mensalBruto(serie);
  });
  // "Realizado + Previsto Inicial": null em todo mês que já tem Realizado
  // (mesma regra da Tendência -- um mês com Realizado nunca mostra outra
  // série de projeção junto), Previsto Inicial do próprio mês dali em
  // diante (não Previsto atual, não a Tendência da MATRIZ).
  mensalPorSerie.realizadoPrevistoInicial = mensalPrevistoInicial.map(function (v, i) {
    return i <= ultimoMesRealizado ? null : v;
  });

  var dadosPorSerie = seriesVisiveis.map(function (serie) {
    var mensal = mensalPorSerie[serie];
    var acumulado = null;
    if (!ehRazao) {
      if (serie === 'total' || serie === 'realizadoPrevistoInicial') {
        acumulado = calcularAcumuladoAposRealizado(mensal, acumuladoRealizado, ultimoMesRealizado);
      } else if (serie === 'realizado') {
        acumulado = cortarAcumuladoNoUltimoDado(calcularAcumulado(mensal), mensal);
      } else {
        acumulado = calcularAcumulado(mensal);
      }
    }
    return { serie: serie, mensal: mensal, acumulado: acumulado };
  });
```

Note: the rest of `construirPainelGraficoHtml` (from `var rotuloDimensao = ...` onward) is unchanged — leave it exactly as-is.

- [ ] **Step 7: Run test to verify it passes**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: PASS, including the new test from Step 1.

- [ ] **Step 8: Write and run a Tabela-unaffected regression test**

Add this test right after the one from Step 1:
```js
test('the new "Realizado + Previsto Inicial" série never adds a row to the Tabela -- ORDEM_SERIES (Tabela row generation) stays at exactly 4 séries', () => {
  const html = renderComSenha([registroExemplo()]);
  const { renderCorpoTabela } = extrairFuncoesPuras(html);
  const corpo = renderCorpoTabela([registroExemplo()]);
  const linhasRegistro = (corpo.match(/<tr class="linha-serie[^>]*>/g) || [])
    .filter(tr => tr.includes('data-registro-indices="0"') && !tr.includes('data-total-sup') && !tr.includes('data-total-geral'));
  assert.equal(linhasRegistro.length, 4, 'continua 4 linhas (Previsto Inicial/Previsto/Realizado/Tendência) por registro -- a 5ª série não deve aparecer na Tabela');
  assert.doesNotMatch(corpo, /realizadoPrevistoInicial/, 'nenhuma linha/atributo da Tabela deve referenciar a nova série');
});
```

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add tools/orcamento/render-dashboard.js test/orcamento-render-dashboard.test.js
git commit -m "Add 5ª série 'Realizado + Previsto Inicial' to the Gráfico (Mensal + Acumulado)"
```

---

### Task 3: Edge-case tests (no Realizado at all, entire year realized, razão dimension, Tendência regression)

**Files:**
- Test: `test/orcamento-render-dashboard.test.js`

**Interfaces:**
- Consumes: `construirPainelGraficoHtml` (Task 2), no new production code expected — this task exists to lock in the edge-case behavior already implied by Task 2's implementation. If any of these fail, fix `construirPainelGraficoHtml` (not the tests) to match the spec.

- [ ] **Step 1: Write the 4 edge-case tests**

Add these tests after the ones from Task 2:

```js
test('"Realizado + Previsto Inicial" falls back to Previsto Inicial alone for the whole year when there is no Realizado at all in the recorte', () => {
  const html = renderComSenha([registroExemplo()]);
  const { construirPainelGraficoHtml } = extrairFuncoesPuras(html);
  const registro = registroExemplo({
    realizado: {
      equipes: Array(12).fill(null), volume: Array(12).fill(null),
      financeiro: Array(12).fill(null),
    },
    previstoInicial: {
      equipes: Array(12).fill(0), equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 },
      volume: Array(12).fill(0), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
      financeiro: Array(12).fill(5000),
      financeiroResumo: { total: 0, totalInicial: 0 },
    },
  });
  const htmlPainel = construirPainelGraficoHtml([registro], [0], new Set(['realizadoPrevistoInicial']), 'financeiro');
  const mensalMatch = htmlPainel.match(/Mensal[\s\S]*?Acumulado no ano/);
  assert.equal((mensalMatch[0].match(/fill="#a78bfa"/g) || []).length, 12, 'sem Realizado nenhum, todos os 12 meses desenham a nova série (Previsto Inicial puro)');
  const acumuladoMatch = htmlPainel.match(/Acumulado no ano[\s\S]*$/);
  assert.match(acumuladoMatch[0], /60\.000/, 'dezembro deveria fechar em 12 × 5.000 = 60.000, acumulando Previsto Inicial sozinho desde Jan');
});

test('"Realizado + Previsto Inicial" draws nothing when the entire year already has Realizado (no future month left to substitute)', () => {
  const html = renderComSenha([registroExemplo()]);
  const { construirPainelGraficoHtml } = extrairFuncoesPuras(html);
  const registro = registroExemplo({
    realizado: {
      equipes: Array(12).fill(5), volume: Array(12).fill(80),
      financeiro: Array(12).fill(1000),
    },
    previstoInicial: {
      equipes: Array(12).fill(0), equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 },
      volume: Array(12).fill(0), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
      financeiro: Array(12).fill(5000),
      financeiroResumo: { total: 0, totalInicial: 0 },
    },
  });
  const htmlPainel = construirPainelGraficoHtml([registro], [0], new Set(['realizadoPrevistoInicial']), 'financeiro');
  const mensalMatch = htmlPainel.match(/Mensal[\s\S]*?Acumulado no ano/);
  assert.equal((mensalMatch[0].match(/fill="#a78bfa"/g) || []).length, 0, 'ano inteiro já realizado -- nada da nova série aparece no Mensal');
  const acumuladoMatch = htmlPainel.match(/Acumulado no ano[\s\S]*$/);
  assert.doesNotMatch(acumuladoMatch[0], /stroke="#a78bfa"/, 'nem uma polyline da nova série deveria existir no Acumulado');
});

test('"Realizado + Previsto Inicial" also works for a razão dimension (Produtividade) -- só painel Mensal (sem Acumulado, mesma regra já existente pras outras 4 séries), com a mesma máscara (null até o corte, razão de Previsto Inicial dali em diante)', () => {
  const html = renderComSenha([registroExemplo()]);
  const { construirPainelGraficoHtml } = extrairFuncoesPuras(html);
  const registro = registroExemplo({
    realizado: {
      equipes: [4, 4, 4, 4, 4, 4, null, null, null, null, null, null],
      volume: [80, 80, 80, 80, 80, 80, null, null, null, null, null, null],
      financeiro: Array(12).fill(800),
    },
    previstoInicial: {
      equipes: Array(12).fill(5), equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 },
      volume: Array(12).fill(100), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
      financeiro: Array(12).fill(0),
      financeiroResumo: { total: 0, totalInicial: 0 },
    },
  });
  const htmlPainel = construirPainelGraficoHtml([registro], [0], new Set(['realizadoPrevistoInicial']), 'produtividade');
  assert.doesNotMatch(htmlPainel, /Acumulado no ano/, 'dimensão de razão nunca mostra painel Acumulado, nem pra essa nova série');
  const pontos = (htmlPainel.match(/fill="#a78bfa"/g) || []).length;
  assert.ok(pontos > 0, 'esperava ao menos 1 marcador roxo no painel Mensal (meses futuros com Previsto Inicial)');
});

test('Tendência keeps correctly inheriting the real Realizado accumulated total even when "Realizado" itself is unchecked in filtro-serie (regression: before this task, unchecking Realizado made Tendência silently restart from Jan)', () => {
  const html = renderComSenha([registroExemplo()]);
  const { construirPainelGraficoHtml } = extrairFuncoesPuras(html);
  const registro = registroExemplo({
    realizado: {
      equipes: Array(12).fill(5), volume: Array(12).fill(80),
      financeiro: [10000, 10000, 10000, 10000, 10000, 10000, null, null, null, null, null, null],
    },
    total: {
      equipes: Array(12).fill(0), volume: Array(12).fill(0),
      financeiro: [null, null, null, null, null, null, 8000, 8000, 8000, 8000, 8000, 8000],
    },
  });
  // "Realizado" NÃO está no filtro -- só Tendência.
  const htmlPainel = construirPainelGraficoHtml([registro], [0], new Set(['total']), 'financeiro');
  const acumuladoMatch = htmlPainel.match(/Acumulado no ano[\s\S]*$/);
  assert.match(acumuladoMatch[0], /68\.000/, 'julho deveria ser 60.000 (Realizado acumulado até junho, mesmo não aparecendo no gráfico) + 8.000 (Tendência de julho) = 68.000 -- não 8.000 (o que aconteceria se Tendência tivesse esquecido o Realizado)');
});
```

- [ ] **Step 2: Run the full suite**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: PASS, all 4 new tests plus every pre-existing test.

If any of the 4 new tests fail, the implementation from Task 2 has a bug relative to the spec — fix `construirPainelGraficoHtml` in `tools/orcamento/render-dashboard.js`, not the test.

- [ ] **Step 3: Run the entire project test suite (all files, not just render-dashboard)**

Run: `node --test test/orcamento-*.test.js`
Expected: PASS, every test across every test file (should be 149 total: 143 existing + 6 new from Tasks 2-3).

- [ ] **Step 4: Commit**

```bash
git add test/orcamento-render-dashboard.test.js
git commit -m "Cover edge cases for Realizado+Previsto Inicial: no Realizado, whole year realized, razão dimension, Tendência regression"
```

---

### Task 4: Visual verification, rebuild, and deploy

**Files:**
- Modify: `dist/orcamento-dashboard.html` (generated), `docs/index.html` (generated copy)

- [ ] **Step 1: Run the full test suite one more time**

Run: `node --test test/orcamento-*.test.js`
Expected: PASS, every test.

- [ ] **Step 2: Rebuild with the real password**

```bash
ORCAMENTO_SENHA='spt@2026' node tools/orcamento/build-dashboard.js
```

- [ ] **Step 3: Visual check with Playwright**

Serve `dist/` locally (same pattern used in prior sessions — a throwaway `node -e "require('http').createServer(...)"` on a free port, since `file://` navigation is blocked), open it, unlock with the real password, go to the Gráfico tab, open the série filter (`filtro-serie`) and check "Realizado + Previsto Inicial". Confirm:
- A 5th, purple, dash-dot line/set of bars appears, labeled "Realizado + Previsto Inicial" in the legend.
- Jan-Jun (or whichever months already have Realizado) show NO bar/point for this série — same as Tendência already does.
- The Acumulado line for this série only starts being visible at the first month without Realizado, and December's value is close to the ~104MM figure confirmed earlier in this conversation (exact value will differ slightly from build to build as the MATRIZ gets updated, but should be materially between Previsto Inicial's ~110MM and be lower than it, since some real Realizado months differ from the original baseline).
- Switch to the Tabela tab — confirm it still shows only 4 séries per registro (Previsto Inicial/Previsto/Realizado/Tendência), no 5th row anywhere, and the "Realizado + Previsto Inicial" checkbox in the shared filter has no visible effect there.
- No regression in the Alertas tab or the rest of the Gráfico (other dimensions, other séries).

Fix anything broken before proceeding.

- [ ] **Step 4: Copy to the Pages source and verify**

```bash
cp dist/orcamento-dashboard.html docs/index.html
```
Confirm both files show the same "Gerado em" timestamp.

- [ ] **Step 5: Commit and push**

```bash
git add dist/orcamento-dashboard.html docs/index.html
git commit -m "Rebuild dashboard: 5ª série 'Realizado + Previsto Inicial' no Gráfico"
git push
```
