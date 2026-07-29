# Fechar o hiato Realizado→série futura Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the visual gap between the last Realizado month and the first month of a "future" série (Tendência, Realizado + Previsto Inicial) in the Acumulado panel and the razão-dimension Mensal line panel, per `docs/superpowers/specs/2026-07-26-conector-hiato-acumulado-design.md`.

**Architecture:** Same file (`tools/orcamento/render-dashboard.js`), same single-file dashboard architecture. The connection-month value comes back into the accumulation math (`calcularAcumuladoAposRealizado`), but the SVG line-drawing function (`construirLinhasSvg`) gets a new per-série `indiceConector` field that tells it "this point should join the polyline but must not draw its own marker/hit-target/label" — Realizado's own trace already draws all three at that exact coordinate.

**Tech Stack:** Node.js (`node --test`), vanilla client-side JS, Playwright for visual verification.

## Global Constraints

- No new npm dependencies. No TypeScript.
- Run `node --test test/orcamento-*.test.js` after every task; all existing tests must keep passing.
- The Mensal **bar** panel (Equipes/Volume/Financeiro, soma dimensions) gets NO connector — it must keep showing zero bars for a future série in an already-Realizado month, exactly as it does today. Only line-drawing paths (Acumulado always; Mensal only for razão dimensions Produtividade/Ticket Médio) get the connector.
- The connector point itself never renders a `<circle class="grafico-marcador">`, a `<circle class="grafico-hit">`, or a `rotulos` entry — only Realizado's own trace draws those at that coordinate. The connector point DOES join the `<polyline>` so the line segment from the connection month to the next real month is drawn, in the future série's own color/dash.
- `indiceConector` only applies to `total` (Tendência) and `realizadoPrevistoInicial` séries — never `previstoInicial`, `previsto`, or `realizado`.
- Rebuild `dist/orcamento-dashboard.html` and copy to `docs/index.html` only in the final task.

---

### Task 1: Revert `calcularAcumuladoAposRealizado` to fill the connection month

**Files:**
- Modify: `tools/orcamento/render-dashboard.js:385-407`
- Modify: `test/orcamento-render-dashboard.test.js:611-628`

**Interfaces:**
- Consumes: nothing new.
- Produces: `calcularAcumuladoAposRealizado(mensalFutura, acumuladoRealizado, ultimoMesRealizado)` now returns a REAL value (not `null`) at `resultado[ultimoMesRealizado]`, equal to `acumuladoRealizado[ultimoMesRealizado]` — restoring the behavior this function had before today's "hide the connection month" change. Task 3 of this plan relies on this value being non-null so the connector point has something to plot.

- [ ] **Step 1: Update the doc comment and revert the function body**

In `tools/orcamento/render-dashboard.js`, replace (lines 385-407):
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
with:
```js
// Acumulado de uma série "pós-Realizado" (Tendência, ou Realizado +
// Previsto Inicial) nunca recomeça do zero em Jan -- a SOMA interna
// continua exatamente de onde o acumulado de Realizado parou, pra o
// primeiro mês futuro somar em cima do total real já reportado. O PONTO
// de conexão (o último mês de Realizado) TEM valor aqui -- igual ao
// acumulado real de Realizado ali -- pra existir um ponto de onde a linha
// da série futura possa partir (ver construirLinhasSvg/indiceConector: é o
// desenho SVG, não esta função, quem decide não duplicar marcador/rótulo
// nesse mês, já que Realizado desenha os dois ali). Sem nenhum mês de
// Realizado (ultimoMesRealizado -1), a série futura acumula sozinha desde
// Jan, do jeito usual.
function calcularAcumuladoAposRealizado(mensalFutura, acumuladoRealizado, ultimoMesRealizado) {
  if (ultimoMesRealizado === -1) return calcularAcumulado(mensalFutura);
  var resultado = new Array(mensalFutura.length).fill(null);
  var soma = acumuladoRealizado[ultimoMesRealizado] || 0;
  resultado[ultimoMesRealizado] = soma;
  for (var i = ultimoMesRealizado + 1; i < mensalFutura.length; i++) {
    soma += mensalFutura[i] || 0;
    resultado[i] = soma;
  }
  return resultado;
}
```

- [ ] **Step 2: Revert the 2 existing tests for this function**

In `test/orcamento-render-dashboard.test.js`, replace (lines 611-628):
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
with:
```js
test('calcularAcumuladoAposRealizado (extraído do HTML real gerado, usado tanto por Tendência quanto por Realizado+Previsto Inicial) picks up the running total exactly where Realizado\'s accumulated total left off, not from zero -- INCLUDING at the connection month itself, so construirLinhasSvg has a point to draw a connecting line from (see indiceConector -- suppressing the duplicate marker/rótulo there is the renderer\'s job, not this function\'s)', () => {
  const html = renderComSenha([registroExemplo()]);
  const { calcularAcumuladoAposRealizado, calcularAcumulado } = extrairFuncoesPuras(html);
  const mensalRealizado = [10, 10, 10, null, null, null, null, null, null, null, null, null];
  const acumuladoRealizado = calcularAcumulado(mensalRealizado); // [10,20,30,30,30,...]
  const ultimoMesRealizado = 2;
  const mensalFutura = [null, null, null, 5, 5, 5, null, null, null, null, null, null];
  const resultado = calcularAcumuladoAposRealizado(mensalFutura, acumuladoRealizado, ultimoMesRealizado);
  assert.deepEqual(paraPlano(resultado.slice(0, 2)), [null, null], 'antes do último mês de Realizado, a série futura não tem valor nenhum');
  assert.equal(resultado[2], 30, 'no mês de conexão (índice 2), o acumulado da série futura é igual ao acumulado real de Realizado ali (30) -- existe um ponto pra desenhar a linha a partir dele');
  assert.deepEqual(paraPlano(resultado.slice(3, 6)), [35, 40, 45], 'a partir do 1º mês futuro, soma a própria contribuição mensal EM CIMA do acumulado real herdado (30 + 5 = 35)');
});

test('calcularAcumuladoAposRealizado falls back to accumulating the série futura alone from Jan when there is no Realizado month at all', () => {
  const html = renderComSenha([registroExemplo()]);
  const { calcularAcumuladoAposRealizado } = extrairFuncoesPuras(html);
  const resultado = calcularAcumuladoAposRealizado([5, 5, 5], [], -1);
  assert.deepEqual(paraPlano(resultado), [5, 10, 15]);
});
```

- [ ] **Step 3: Run the full suite**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: the 2 tests just rewritten PASS. Some OTHER tests may now show `#a78bfa`/`#f6b53f` values appearing at the connection month's accumulated total in their HTML output (since `calcularAcumuladoAposRealizado` no longer returns `null` there) — this is fine and expected; none of the existing assertions check for the ABSENCE of a value at that specific index (they check specific later-month substrings like `72.000`/`132.000`/`68.000`, or check marker/polyline COUNTS which are computed by `construirLinhasSvg`, unchanged until Task 2). If anything unexpectedly fails, read the assertion message carefully before concluding it's a real regression — Task 2 is what makes the renderer connection-month-aware; this task only changes the math.

- [ ] **Step 4: Commit**

```bash
git add tools/orcamento/render-dashboard.js test/orcamento-render-dashboard.test.js
git commit -m "Revert calcularAcumuladoAposRealizado to fill the connection month (prep for closing the Acumulado line gap)"
```

---

### Task 2: Teach `construirLinhasSvg` to suppress the connector point's marker/hit/label

**Files:**
- Modify: `tools/orcamento/render-dashboard.js:661-687`
- Test: `test/orcamento-render-dashboard.test.js`

**Interfaces:**
- Consumes: nothing new from other functions.
- Produces: `construirLinhasSvg(dadosPorSerie, campo, ...)` now reads an optional `d.indiceConector` (a 0-based month index, or `null`/`undefined`/absent) on each entry of `dadosPorSerie`. When the month being drawn (`mes`) equals `d.indiceConector`, the point still joins the `<polyline>` (so the line segment connects), but skips drawing `<circle class="grafico-marcador">`, `<circle class="grafico-hit">`, and pushing to `rotulos`. Task 3 sets this field when building `dadosPorSerie`.

- [ ] **Step 1: Write the failing tests**

Read `test/orcamento-render-dashboard.test.js` around the existing test `'construirGraficoMensalSvg (razão dimension, linha) and construirGraficoAcumuladoSvg break the polyline at a null month...'` (search for it) — add these 2 new tests right after it:

```js
test('construirLinhasSvg (via construirGraficoAcumuladoSvg): a point at indiceConector joins the polyline (closing the gap to the next real point) but draws no marker, no hit-target, and no label -- Realizado already drew all three there', () => {
  const html = renderComSenha([registroExemplo()]);
  const { construirGraficoAcumuladoSvg } = extrairFuncoesPuras(html);
  const dados = [
    { serie: 'realizado', acumulado: [10, 20, 30, null, null, null, null, null, null, null, null, null], indiceConector: null },
    { serie: 'total', acumulado: [null, null, 30, 35, 40, null, null, null, null, null, null, null], indiceConector: 2 },
  ];
  const { svg } = construirGraficoAcumuladoSvg(dados, 0);
  // A polyline da Tendência deve ligar os meses 2,3,4 (3 pontos) -- inclui
  // o mês de conexão (2) mesmo sem marcador ali.
  const polylineTendencia = svg.match(/<polyline[^>]*points="([^"]*)"[^>]*stroke="#f6b53f"/);
  assert.ok(polylineTendencia, 'esperava uma polyline da Tendência ligando o mês de conexão aos meses seguintes');
  assert.equal(polylineTendencia[1].trim().split(' ').length, 3, 'a polyline deve ter 3 pontos (mês de conexão + 2 meses seguintes)');
  // Só 1 marcador da Tendência (mês 3, valor 35) e 1 do mês 4 (valor 40) --
  // NENHUM no mês de conexão (2).
  const marcadoresTendencia = (svg.match(/<circle class="grafico-marcador"[^>]*fill="#f6b53f"/g) || []).length;
  assert.equal(marcadoresTendencia, 2, 'só os 2 meses realmente "próprios" da Tendência (3 e 4) desenham marcador -- o mês de conexão (2) não');
  const hitsTendencia = (svg.match(/<circle class="grafico-hit"[^>]*Tendência/g) || []).length;
  assert.equal(hitsTendencia, 2, 'mesma contagem pro hit-target de hover');
  // Realizado continua desenhando normalmente nos seus 3 meses, incluindo
  // o mês de conexão (2) -- é dele mesmo, não suprimido.
  const marcadoresRealizado = (svg.match(/<circle class="grafico-marcador"[^>]*fill="#7fd858"/g) || []).length;
  assert.equal(marcadoresRealizado, 3, 'Realizado desenha seus 3 marcadores normalmente, sem nenhuma supressão');
});

test('construirLinhasSvg: a point NOT at indiceConector (or a série with indiceConector null/absent) always draws marker+hit+label normally -- suppression is scoped exactly to the connector month of a série that has one', () => {
  const html = renderComSenha([registroExemplo()]);
  const { construirGraficoAcumuladoSvg } = extrairFuncoesPuras(html);
  const dados = [{ serie: 'previsto', acumulado: [10, 20, 30, 40, null, null, null, null, null, null, null, null], indiceConector: null }];
  const { svg } = construirGraficoAcumuladoSvg(dados, 0);
  assert.equal((svg.match(/<circle class="grafico-marcador"/g) || []).length, 4, 'sem indiceConector, todo mês com dado desenha seu marcador normalmente');
  assert.equal((svg.match(/class="grafico-rotulo-final"/g) || []).length, 4, 'e seu rótulo');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: FAIL on the first new test (`marcadoresTendencia` will be 3, not 2 — `construirLinhasSvg` doesn't know about `indiceConector` yet, so it draws a marker at every non-null point including the connector). The second new test should already PASS (no `indiceConector` set, nothing to suppress) — that's fine, it's here to lock in the "don't over-suppress" behavior once Step 3 is implemented, not to prove a regression.

- [ ] **Step 3: Implement the suppression in `construirLinhasSvg`**

In `tools/orcamento/render-dashboard.js`, replace (lines 661-687):
```js
function construirLinhasSvg(dadosPorSerie, campo, escala, alturaPlot, larguraMes, margem, usarMilhares, rotulos, casasDecimais) {
  var svg = '';
  dadosPorSerie.forEach(function (d) {
    var traco = SERIE_TRACEJADO[d.serie] ? ' stroke-dasharray="' + SERIE_TRACEJADO[d.serie] + '"' : '';
    var trecho = [];
    function fecharTrecho() {
      if (trecho.length > 1) {
        var pontosStr = trecho.map(function (p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
        svg += '<polyline class="grafico-linha" points="' + pontosStr + '" fill="none" stroke="' + SERIE_COR[d.serie] + '" stroke-width="2"' + traco + '/>';
      }
      trecho = [];
    }
    d[campo].forEach(function (valor, mes) {
      if (valor === null || valor === undefined) { fecharTrecho(); return; }
      var x = margem.esquerda + mes * larguraMes + larguraMes / 2;
      var y = margem.topo + alturaPlot - escalaLinear(valor, escala.max, alturaPlot);
      trecho.push({ x: x, y: y });
      svg += '<circle class="grafico-marcador" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="4" fill="' + SERIE_COR[d.serie] + '" stroke="var(--surface-1)" stroke-width="2"/>';
      svg += '<circle class="grafico-hit" data-tooltip="' + MESES_ABREVIADOS[mes] + ' · ' + SERIE_LABELS[d.serie] + ': ' + formatarNumero(valor, casasDecimais) + '" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="10" fill="transparent"/>';
      if (valor) {
        rotulos.push({ x: x, y: y - 10, texto: formatarValorGrafico(valor, usarMilhares, casasDecimais), classe: 'grafico-rotulo-final' });
      }
    });
    fecharTrecho();
  });
  return svg;
}
```
with:
```js
// indiceConector (opcional, em cada item de dadosPorSerie): o mês onde uma
// série "pós-Realizado" (Tendência, Realizado+Previsto Inicial) herda o
// ponto de partida de Realizado -- ver calcularAcumuladoAposRealizado e
// construirPainelGraficoHtml. Esse mês PRECISA entrar no trecho da
// polyline (fecha o hiato visual entre o último mês de Realizado e o
// primeiro mês próprio da série futura, desenhando o segmento na cor/
// tracejado da série futura), mas NÃO desenha marcador/hit/rótulo -- quem
// já desenhou os três ali foi a própria série Realizado, no mesmo x,y.
function construirLinhasSvg(dadosPorSerie, campo, escala, alturaPlot, larguraMes, margem, usarMilhares, rotulos, casasDecimais) {
  var svg = '';
  dadosPorSerie.forEach(function (d) {
    var traco = SERIE_TRACEJADO[d.serie] ? ' stroke-dasharray="' + SERIE_TRACEJADO[d.serie] + '"' : '';
    var trecho = [];
    function fecharTrecho() {
      if (trecho.length > 1) {
        var pontosStr = trecho.map(function (p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
        svg += '<polyline class="grafico-linha" points="' + pontosStr + '" fill="none" stroke="' + SERIE_COR[d.serie] + '" stroke-width="2"' + traco + '/>';
      }
      trecho = [];
    }
    d[campo].forEach(function (valor, mes) {
      if (valor === null || valor === undefined) { fecharTrecho(); return; }
      var x = margem.esquerda + mes * larguraMes + larguraMes / 2;
      var y = margem.topo + alturaPlot - escalaLinear(valor, escala.max, alturaPlot);
      trecho.push({ x: x, y: y });
      var ehConector = d.indiceConector !== null && d.indiceConector !== undefined && mes === d.indiceConector;
      if (!ehConector) {
        svg += '<circle class="grafico-marcador" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="4" fill="' + SERIE_COR[d.serie] + '" stroke="var(--surface-1)" stroke-width="2"/>';
        svg += '<circle class="grafico-hit" data-tooltip="' + MESES_ABREVIADOS[mes] + ' · ' + SERIE_LABELS[d.serie] + ': ' + formatarNumero(valor, casasDecimais) + '" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="10" fill="transparent"/>';
        if (valor) {
          rotulos.push({ x: x, y: y - 10, texto: formatarValorGrafico(valor, usarMilhares, casasDecimais), classe: 'grafico-rotulo-final' });
        }
      }
    });
    fecharTrecho();
  });
  return svg;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: PASS, including both new tests. `dadosPorSerie` entries built elsewhere in the file (e.g. inside existing tests for `construirGraficoMensalSvg`/`construirGraficoAcumuladoSvg`) don't set `indiceConector` at all — since the check is `!== null && !== undefined`, an absent field is treated as "no connector," so none of those pre-existing tests should be affected.

- [ ] **Step 5: Commit**

```bash
git add tools/orcamento/render-dashboard.js test/orcamento-render-dashboard.test.js
git commit -m "construirLinhasSvg: suppress marker/hit/label at a série's indiceConector, while still joining the polyline"
```

---

### Task 3: Wire `indiceConector` into `construirPainelGraficoHtml`

**Files:**
- Modify: `tools/orcamento/render-dashboard.js:764-812`
- Test: `test/orcamento-render-dashboard.test.js`

**Interfaces:**
- Consumes: `calcularAcumuladoAposRealizado` (Task 1, now fills the connector), `construirLinhasSvg`'s new `indiceConector` support (Task 2).
- Produces: `construirPainelGraficoHtml`'s `dadosPorSerie` entries for `total` and `realizadoPrevistoInicial` now carry `indiceConector: ultimoMesRealizado` (or `null` when `ultimoMesRealizado === -1`, i.e. no Realizado at all — nothing to connect from). For razão dimensions only, `mensalPorSerie.total` and `mensalPorSerie.realizadoPrevistoInicial` get the connection month's value patched in (from `mensalRealizado[ultimoMesRealizado]`) SPECIFICALLY so the Mensal line panel has a point to draw there too — the Mensal BAR panel (soma dimensions) never receives this patch.

- [ ] **Step 1: Write the failing tests**

Read `test/orcamento-render-dashboard.test.js` around the test `'"Realizado + Previsto Inicial" draws nothing when the entire year already has Realizado...'` (search for it) — add these 2 new tests right after it:

```js
test('construirPainelGraficoHtml: the Acumulado panel has NO gap between Realizado and the future séries (Tendência, Realizado+Previsto Inicial) -- their polylines include the connection month, drawn in their own color, with no duplicate marker there', () => {
  const html = renderComSenha([registroExemplo()]);
  const { construirPainelGraficoHtml } = extrairFuncoesPuras(html);
  const registro = registroExemplo({
    realizado: {
      equipes: Array(12).fill(5), volume: Array(12).fill(80),
      financeiro: [10000, 10000, 10000, 10000, 10000, 10000, null, null, null, null, null, null],
    },
    total: {
      equipes: Array(12).fill(0), volume: Array(12).fill(0),
      financeiro: [null, null, null, null, null, null, 9000, 9000, 9000, 9000, 9000, 9000],
    },
    previstoInicial: {
      equipes: Array(12).fill(0), equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 },
      volume: Array(12).fill(0), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
      financeiro: [10000, 10000, 10000, 10000, 10000, 10000, 12000, 12000, 12000, 12000, 12000, 12000],
      financeiroResumo: { total: 0, totalInicial: 0 },
    },
  });
  const htmlPainel = construirPainelGraficoHtml([registro], [0], new Set(['total', 'realizadoPrevistoInicial']), 'financeiro');
  const acumuladoMatch = htmlPainel.match(/Acumulado no ano[\s\S]*$/);
  assert.ok(acumuladoMatch, 'esperava o painel Acumulado');

  // Tendência (âmbar) e Realizado+Previsto Inicial (roxo): cada polyline
  // liga o mês de conexão (junho, valor herdado 60.000) aos meses
  // seguintes -- pelo menos 7 pontos (Jun..Dez).
  const polylineTendencia = acumuladoMatch[0].match(/<polyline[^>]*points="([^"]*)"[^>]*stroke="#f6b53f"/);
  assert.ok(polylineTendencia, 'esperava a polyline da Tendência fechando o hiato');
  assert.ok(polylineTendencia[1].trim().split(' ').length >= 7, 'a polyline da Tendência deve incluir o mês de conexão + os 6 meses futuros');

  const polylineHibrida = acumuladoMatch[0].match(/<polyline[^>]*points="([^"]*)"[^>]*stroke="#a78bfa"/);
  assert.ok(polylineHibrida, 'esperava a polyline de Realizado+Previsto Inicial fechando o hiato');
  assert.ok(polylineHibrida[1].trim().split(' ').length >= 7, 'a polyline de Realizado+Previsto Inicial deve incluir o mês de conexão + os 6 meses futuros');

  // Nenhum marcador âmbar/roxo no mês de conexão -- só o verde do
  // Realizado ali. Conta o TOTAL de marcadores de cada cor: Tendência e
  // Realizado+Previsto Inicial só têm valor próprio Jul-Dez (6 meses cada),
  // então só podem ter 6 marcadores cada, nunca 7 (o que aconteceria se o
  // mês de conexão também desenhasse um).
  const marcadoresTendencia = (acumuladoMatch[0].match(/<circle class="grafico-marcador"[^>]*fill="#f6b53f"/g) || []).length;
  assert.equal(marcadoresTendencia, 6, 'Tendência só desenha marcador nos 6 meses onde tem valor próprio (Jul-Dez), nunca no mês de conexão');
  const marcadoresHibrida = (acumuladoMatch[0].match(/<circle class="grafico-marcador"[^>]*fill="#a78bfa"/g) || []).length;
  assert.equal(marcadoresHibrida, 6, 'Realizado+Previsto Inicial só desenha marcador nos 6 meses onde tem valor próprio (Jul-Dez), nunca no mês de conexão');
});

test('construirPainelGraficoHtml: the Mensal BAR panel (soma dimension) still shows NO bar for the future séries at the connection month -- the connector patch never reaches the bar-drawing path', () => {
  const html = renderComSenha([registroExemplo()]);
  const { construirPainelGraficoHtml } = extrairFuncoesPuras(html);
  const registro = registroExemplo({
    realizado: {
      equipes: Array(12).fill(5), volume: Array(12).fill(80),
      financeiro: [10000, 10000, 10000, 10000, 10000, 10000, null, null, null, null, null, null],
    },
    total: {
      equipes: Array(12).fill(0), volume: Array(12).fill(0),
      financeiro: [null, null, null, null, null, null, 9000, 9000, 9000, 9000, 9000, 9000],
    },
    previstoInicial: {
      equipes: Array(12).fill(0), equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 },
      volume: Array(12).fill(0), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
      financeiro: [10000, 10000, 10000, 10000, 10000, 10000, 12000, 12000, 12000, 12000, 12000, 12000],
      financeiroResumo: { total: 0, totalInicial: 0 },
    },
  });
  const htmlPainel = construirPainelGraficoHtml([registro], [0], new Set(['total', 'realizadoPrevistoInicial']), 'financeiro');
  const mensalMatch = htmlPainel.match(/Mensal[\s\S]*?Acumulado no ano/);
  assert.ok(mensalMatch, 'esperava o painel Mensal');
  // 6 barras âmbar (Tendência) + 6 roxas (Realizado+Previsto Inicial) --
  // nenhuma das duas no mês de conexão (junho), exatamente como antes.
  assert.equal((mensalMatch[0].match(/fill="#f6b53f"/g) || []).length, 6, 'Tendência continua sem barra no mês de conexão');
  assert.equal((mensalMatch[0].match(/fill="#a78bfa"/g) || []).length, 6, 'Realizado+Previsto Inicial continua sem barra no mês de conexão');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: the first new test FAILs (no `indiceConector` wired yet, so `construirLinhasSvg` never receives it — but more fundamentally, `dadosPorSerie` doesn't set it, so `d.indiceConector` is `undefined` everywhere, meaning Task 2's suppression never triggers, meaning June DOES draw a marker → `marcadoresTendencia`/`marcadoresHibrida` will be 7, not 6). The second test should already PASS (this task hasn't touched the bar path, and won't) — it's here as a regression guard for Step 3, not to prove a bug.

- [ ] **Step 3: Wire indiceConector + razão-mensal connector into `construirPainelGraficoHtml`**

In `tools/orcamento/render-dashboard.js`, replace (lines 764-812):
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

  // Só pro painel Mensal em LINHA (razão -- Produtividade/Ticket Médio):
  // injeta o valor do próprio Realizado no mês de conexão pra série
  // futura ter um ponto ali (fecha o hiato dessa linha também) -- nunca
  // sobrescreve um valor que já exista (a MATRIZ pode, em tese, ter o
  // próprio T ali) e NUNCA roda pro painel Mensal em BARRA (soma), que
  // continua sem nenhum ponto/barra da série futura no mês de conexão.
  function comConectorSeRazao(mensal) {
    if (!ehRazao || ultimoMesRealizado === -1) return mensal;
    var resultado = mensal.slice();
    if (resultado[ultimoMesRealizado] === null || resultado[ultimoMesRealizado] === undefined) {
      resultado[ultimoMesRealizado] = mensalRealizado[ultimoMesRealizado];
    }
    return resultado;
  }

  var mensalPorSerie = { realizado: mensalRealizado, previstoInicial: mensalPrevistoInicial };
  seriesVisiveis.forEach(function (serie) {
    if (mensalPorSerie[serie] || serie === 'realizadoPrevistoInicial') return;
    mensalPorSerie[serie] = mensalBruto(serie);
  });
  if (mensalPorSerie.total) mensalPorSerie.total = comConectorSeRazao(mensalPorSerie.total);
  // "Realizado + Previsto Inicial": null em todo mês que já tem Realizado
  // (mesma regra da Tendência -- um mês com Realizado nunca mostra outra
  // série de projeção junto), Previsto Inicial do próprio mês dali em
  // diante (não Previsto atual, não a Tendência da MATRIZ).
  mensalPorSerie.realizadoPrevistoInicial = comConectorSeRazao(mensalPrevistoInicial.map(function (v, i) {
    return i <= ultimoMesRealizado ? null : v;
  }));

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
    // indiceConector: só pras séries "pós-Realizado", e só quando existe
    // de fato um mês de Realizado pra herdar (ultimoMesRealizado !== -1)
    // -- ver construirLinhasSvg. Vale tanto pro painel Mensal em linha
    // (razão) quanto pro Acumulado; o painel Mensal em BARRA (soma) não
    // usa esse campo (construirColunasSvg não olha pra ele).
    var indiceConector = (serie === 'total' || serie === 'realizadoPrevistoInicial') && ultimoMesRealizado !== -1
      ? ultimoMesRealizado
      : null;
    return { serie: serie, mensal: mensal, acumulado: acumulado, indiceConector: indiceConector };
  });
```

Note: the rest of `construirPainelGraficoHtml` (from `var rotuloDimensao = ...` onward) is unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: PASS, including both new tests from Step 1.

- [ ] **Step 5: Run the entire project test suite**

Run: `node --test test/orcamento-*.test.js`
Expected: PASS, every test across every file.

- [ ] **Step 6: Commit**

```bash
git add tools/orcamento/render-dashboard.js test/orcamento-render-dashboard.test.js
git commit -m "Wire indiceConector into construirPainelGraficoHtml: close the Acumulado/razão-Mensal gap between Realizado and the future séries"
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
ORCAMENTO_SENHA='<a senha -- nunca em arquivo do repo>' node tools/orcamento/build-dashboard.js
```

- [ ] **Step 3: Visual check with Playwright**

Serve `dist/` locally (throwaway `node -e "require('http').createServer(...)"` on a free port — `file://` navigation is blocked), open it, unlock with the real password, go to the Gráfico tab. Confirm:
- With Tendência and/or Realizado + Previsto Inicial checked in the série filter: the Acumulado line now visibly connects from the last Realizado month (currently June) to the first future month (currently July), in the future série's own color/dash (amber for Tendência, purple dash-dot for Realizado + Previsto Inicial) — no visible gap.
- The marker/dot AT June is still exactly one green Realizado circle — no second, overlapping colored circle on top of it.
- Hovering over the June point still shows Realizado's tooltip (not a duplicate future-série tooltip).
- Switch dimension to Produtividade or Ticket Médio (razão) — same gap-closing behavior in the Mensal line panel.
- Switch to Equipes, Volume, or Financeiro's Mensal (bar) panel — confirm NO regression: still zero bars for Tendência/Realizado+Previsto Inicial in June, exactly as before this plan.
- No regression in the Tabela or Alertas tabs.

Fix anything broken before proceeding.

- [ ] **Step 4: Copy to the Pages source and verify**

```bash
cp dist/orcamento-dashboard.html docs/index.html
```
Confirm both files show the same "Gerado em" timestamp.

- [ ] **Step 5: Commit and push**

```bash
git add dist/orcamento-dashboard.html docs/index.html
git commit -m "Rebuild dashboard: fechar o hiato entre Realizado e a série futura nos gráficos de linha"
git push
```
