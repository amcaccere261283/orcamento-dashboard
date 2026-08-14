# Atualizar Demandas ao clicar em "Atualizar dados" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the orçamento dashboard's "Atualizar dados" button also recompute the Demandas series (monthly chegadas + saldo de abertura) from the live `avancos-online.csv`/`lab-online.csv`/`demandas-sondagem-online.csv`/`demandas-lab-online.json` files, instead of leaving it frozen at build-time values.

**Architecture:** Reuse `tools/comum/browser-bundle.js` (already generic, already proven in production on the sibling semanal page) to embed `tools/semanal/{compute-semanal,parse-avancos,parse-lab,compute-demandas}.js` into the orçamento client script, exactly the same mechanism the semanal page already uses for its own live-refresh. `atualizarDadosAoVivo()` gains a second, independent, gracefully-degrading fetch group (avancos/lab/pendentes) alongside the existing MATRIZ fetch.

**Tech Stack:** Plain Node (no npm deps), `node --test`, `node:vm` for client-script sandbox tests.

**Spec:** `docs/superpowers/specs/2026-08-13-orcamento-atualizar-demandas-design.md`

## Global Constraints

- Never write the build password (`ORCAMENTO_SENHA`) to any repository file.
- `tools/semanal/compute-demandas.js` stays in `tools/semanal/` — do not move it (breaks the semanal page's own bundle; see the spec).
- SUP/Grupo/Tomador/Tipologia/values from the MATRIZ stay inside the AES-encrypted blob in the static HTML — this plan does not touch that. The 4 furos/ensaios files were already plaintext-fetched by the semanal page before this plan; no new exposure is introduced.
- Every task ends green on `node --test` before moving to the next task.
- `test/fixtures/orcamento-golden.html` must be regenerated (`node -e` calling `construirHtmlGolden()`, see Task 5) any time `SCRIPT_CLIENTE_TABELA`'s text changes, and `test/orcamento-html-inalterado.test.js` must pass afterward.

---

### Task 1: Expose `window.__ANO_ORCAMENTO__`

**Files:**
- Modify: `tools/orcamento/render-dashboard.js:2034` (the `<script>window.__VIGENTE_IDX__ = ...` line, inside `renderDashboard`)
- Test: `test/orcamento-render-dashboard.test.js`

**Interfaces:**
- Produces: `window.__ANO_ORCAMENTO__` (integer, the calendar year of `periodos[0]`) — a new global baked into the HTML, consumed by Task 3's `periodosDoAnoOrcamento()`.

- [ ] **Step 1: Write the failing test**

Add near the other `renderDashboard` embedding tests in `test/orcamento-render-dashboard.test.js` (after the `pacote cifrado` tests, e.g. after line 79):

```js
test('renderDashboard embute window.__ANO_ORCAMENTO__ (ano de periodos[0]) num <script> -- o live-refresh usa isso pra recompor os 12 meses do ano sem precisar reler o cabeçalho do espelho', () => {
  const html = renderComSenha([registroExemplo()]);
  assert.match(html, /window\.__ANO_ORCAMENTO__ = 2026;/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: FAIL — `window.__ANO_ORCAMENTO__` not found in the HTML.

- [ ] **Step 3: Write minimal implementation**

In `tools/orcamento/render-dashboard.js`, change:

```js
  <script>window.__VIGENTE_IDX__ = ${vigenteIdx};</script>
```

to:

```js
  <script>window.__VIGENTE_IDX__ = ${vigenteIdx}; window.__ANO_ORCAMENTO__ = ${periodos[0].getUTCFullYear()};</script>
```

(`periodos` is already a parameter of `renderDashboard` — no new argument needed.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: PASS, no other test broken.

- [ ] **Step 5: Regenerate the golden fixture**

```bash
node -e "const {construirHtmlGolden}=require('./test/helpers/golden-orcamento.js'); require('fs').writeFileSync('test/fixtures/orcamento-golden.html', construirHtmlGolden());"
node --test test/orcamento-html-inalterado.test.js
```

- [ ] **Step 6: Commit**

```bash
git add tools/orcamento/render-dashboard.js test/orcamento-render-dashboard.test.js test/fixtures/orcamento-golden.html
git commit -m "feat(orcamento): expose window.__ANO_ORCAMENTO__ for the live-refresh Demandas pipeline"
```

---

### Task 2: Embed the browser bundle (parse-avancos/parse-lab/compute-demandas) + fonteParaCliente globals

**Files:**
- Modify: `tools/orcamento/render-dashboard.js` (imports, new `BUNDLE_DEMANDAS` constant, final HTML assembly)
- Modify: `test/orcamento-render-dashboard.test.js` (`extrairFuncoesPuras` and 5 other `scripts[3]` occurrences → `scripts[5]`, since 2 new `<script>` tags shift the main script's index)

**Interfaces:**
- Produces: two new `<script>` tags in the rendered HTML — one with `fonteParaClienteTipologiasAvancos()+fonteParaClienteTipologiasLab()+fonteParaClienteDatas()+fonteParaClienteLinhaBase()`, one with the bundle (`MODULOS['compute-semanal.js']`, `MODULOS['parse-avancos.js']`, `MODULOS['parse-lab.js']`, `MODULOS['compute-demandas.js']`). Total `<script>` count goes from 4 to 6, main script moves from index 3 to index 5 — same layout the semanal page already uses (`test/semanal-render-semanal-wireup.test.js:91`).
- Consumes: nothing new from earlier tasks.

- [ ] **Step 1: Write the failing test**

Add to `test/orcamento-render-dashboard.test.js`, right after the `renderDashboard embute window.__ANO_ORCAMENTO__` test from Task 1:

```js
test('renderDashboard embute o bundle de navegador (compute-semanal/parse-avancos/parse-lab/compute-demandas) e as 4 fontes fonteParaCliente que eles precisam, ANTES do script principal -- 6 <script> ao todo, mesmo layout que a página semanal já usa', () => {
  const html = renderComSenha([registroExemplo()]);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 6, 'esperava exatamente 6 <script> (vigenteIdx, dados cifrados, gate, fonteParaCliente, bundle, tabela)');

  const scriptFontes = scripts[3][1];
  assert.match(scriptFontes, /excelSerialParaData/);
  assert.match(scriptFontes, /rotularTipologia/);
  assert.match(scriptFontes, /classificarEnsaioLab/);
  assert.match(scriptFontes, /chaveMatriz/);

  const scriptBundle = scripts[4][1];
  assert.match(scriptBundle, /MODULOS\['compute-semanal\.js'\]/);
  assert.match(scriptBundle, /MODULOS\['parse-avancos\.js'\]/);
  assert.match(scriptBundle, /MODULOS\['parse-lab\.js'\]/);
  assert.match(scriptBundle, /MODULOS\['compute-demandas\.js'\]/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: FAIL — only 4 `<script>` tags exist today.

- [ ] **Step 3: Write minimal implementation**

In `tools/orcamento/render-dashboard.js`, change the top imports from:

```js
'use strict';
const { formatarMesAno, calcularVigenteIdx } = require('../comum/datas.js');
const { cifrarComSenha } = require('../comum/criptografia.js');
const {
  cssBase, markupCabecalho, markupFiltros, markupAbas, scriptDesbloqueio, scriptFiltros,
} = require('../comum/render-shell.js');
const { trechosParaCliente } = require('../comum/calculo-equipes.js');
```

to:

```js
'use strict';
const path = require('node:path');
const { formatarMesAno, calcularVigenteIdx, fonteParaCliente: fonteParaClienteDatas } = require('../comum/datas.js');
const { cifrarComSenha } = require('../comum/criptografia.js');
const {
  cssBase, markupCabecalho, markupFiltros, markupAbas, scriptDesbloqueio, scriptFiltros,
} = require('../comum/render-shell.js');
const { trechosParaCliente } = require('../comum/calculo-equipes.js');
const { buildBrowserBundle } = require('../comum/browser-bundle.js');
const { fonteParaCliente: fonteParaClienteTipologiasAvancos } = require('../comum/tipologias-avancos.js');
const { fonteParaCliente: fonteParaClienteTipologiasLab } = require('../comum/tipologias-lab.js');
const { fonteParaCliente: fonteParaClienteLinhaBase } = require('../comum/linha-base.js');
```

Right after `const [TRECHO_DIAS_PREMISSA, TRECHO_EQUIPES] = trechosParaCliente();` add:

```js
// Bundle de navegador (mesmo mecanismo que tools/semanal/render-semanal.js
// já usa em produção) pro botão "Atualizar dados" poder recalcular Demandas
// no cliente sem duplicar as regras de parse-avancos.js/parse-lab.js/
// compute-demandas.js à mão -- ver
// docs/superpowers/specs/2026-08-13-orcamento-atualizar-demandas-design.md.
// compute-semanal.js entra só porque compute-demandas.js consome diaEpoch
// dele via require('./compute-semanal.js'), same-dir -- precisa vir ANTES
// dele na lista (mesma ordem que BUNDLE_ARQUIVOS usa na semanal).
const BUNDLE_DEMANDAS = buildBrowserBundle(
  path.join(__dirname, '..', 'semanal'),
  ['compute-semanal.js', 'parse-avancos.js', 'parse-lab.js', 'compute-demandas.js']
);
```

Then change the final HTML assembly from:

```js
  <script>window.__VIGENTE_IDX__ = ${vigenteIdx}; window.__ANO_ORCAMENTO__ = ${periodos[0].getUTCFullYear()};</script>
  <script>window.__DADOS_CIFRADOS__ = ${dadosCifradosJson};</script>
  <script>${scriptDesbloqueio()}</script>
  <script>${scriptFiltros()}${SCRIPT_CLIENTE_TABELA}</script>
```

to:

```js
  <script>window.__VIGENTE_IDX__ = ${vigenteIdx}; window.__ANO_ORCAMENTO__ = ${periodos[0].getUTCFullYear()};</script>
  <script>window.__DADOS_CIFRADOS__ = ${dadosCifradosJson};</script>
  <script>${scriptDesbloqueio()}</script>
  <script>${fonteParaClienteTipologiasAvancos()}${fonteParaClienteTipologiasLab()}${fonteParaClienteDatas()}${fonteParaClienteLinhaBase()}</script>
  <script>${BUNDLE_DEMANDAS}</script>
  <script>${scriptFiltros()}${SCRIPT_CLIENTE_TABELA}</script>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: the new test passes; several OTHER tests now fail (they hardcode `scripts[3]` as the main script, which is now `scripts[5]`) — expected, fixed in Step 5.

- [ ] **Step 5: Fix the mechanical script-index shift**

In `test/orcamento-render-dashboard.test.js`:

1. In `extrairFuncoesPuras`, change:
   ```js
   const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
   assert.equal(scripts.length, 4, 'esperava exatamente 4 <script> (vigenteIdx, dados cifrados, gate, tabela)');
   const scriptTabela = scripts[3][1];
   ```
   to:
   ```js
   const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
   assert.equal(scripts.length, 6, 'esperava exatamente 6 <script> (vigenteIdx, dados cifrados, gate, fonteParaCliente, bundle, tabela)');
   // Junta TODOS os blocos, não só o da tabela: a partir desta task, funções
   // como recalcularDemandasAoVivo (Task 3) referenciam ParseAvancos/ParseLab/
   // ComputeDemandas, que só existem depois que o <script> do bundle (índice
   // 4) rodou -- mesma junção que test/semanal-render-semanal-wireup.test.js
   // já faz (montarSandbox: blocos.join('\n;\n')).
   const codigo = scripts.map(s => s[1]).join('\n;\n');
   ```
   and change every subsequent use of `scriptTabela +` in that same function to `codigo +`.

2. In the other 5 occurrences (currently at lines 1785, 2110, 2118, 2127, 2160 — search for `scripts[3][1]`), change `scripts[3][1]` to `scripts[5][1]`.

- [ ] **Step 6: Run the full file to verify it passes**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 7: Regenerate the golden fixture**

```bash
node -e "const {construirHtmlGolden}=require('./test/helpers/golden-orcamento.js'); require('fs').writeFileSync('test/fixtures/orcamento-golden.html', construirHtmlGolden());"
node --test test/orcamento-html-inalterado.test.js
```

- [ ] **Step 8: Run the full suite**

Run: `node --test`
Expected: PASS, 0 failures (this bundle addition can only affect orcamento-* tests, but confirm nothing else broke).

- [ ] **Step 9: Commit**

```bash
git add tools/orcamento/render-dashboard.js test/orcamento-render-dashboard.test.js test/fixtures/orcamento-golden.html
git commit -m "feat(orcamento): embed the parse-avancos/parse-lab/compute-demandas browser bundle in the client script"
```

---

### Task 3: Client-side `periodosDoAnoOrcamento` and `recalcularDemandasAoVivo`

**Files:**
- Modify: `tools/orcamento/render-dashboard.js` (inside `SCRIPT_CLIENTE_TABELA`)
- Modify: `test/orcamento-render-dashboard.test.js` (`extrairFuncoesPuras` exposes the 2 new functions)

**Interfaces:**
- Consumes: `window.__ANO_ORCAMENTO__` (Task 1), `ParseAvancos`/`ParseLab`/`ComputeDemandas` globals (Task 2's bundle), the pre-existing client `parseCsvGrid(texto)`.
- Produces:
  - `periodosDoAnoOrcamento()` → `Date[12]`, Jan-Dec of `window.__ANO_ORCAMENTO__`.
  - `recalcularDemandasAoVivo(textoAvancos, textoLab, textoDemandasSondagem, demandasLabJson, registrosNovos)` → `{ chegadasMensais, saldoAbertura }` — same shape `montarDemandasChegadasMensais` (build-dashboard.js) already produces. `textoDemandasSondagem`/`demandasLabJson` may be `null` (pendentes are optional, same rule as the build).

- [ ] **Step 1: Write the failing test**

Add to `test/orcamento-render-dashboard.test.js`, after the Task 2 test:

```js
test('periodosDoAnoOrcamento (extraído do HTML real gerado) devolve os 12 primeiros dias do mês de window.__ANO_ORCAMENTO__, em UTC', () => {
  const html = renderComSenha([registroExemplo()]);
  const { periodosDoAnoOrcamento, window: sandboxWindow } = extrairFuncoesPuras(html);
  sandboxWindow.__ANO_ORCAMENTO__ = 2026;
  const periodos = periodosDoAnoOrcamento();
  assert.equal(periodos.length, 12);
  assert.equal(periodos[0].toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(periodos[11].toISOString(), '2026-12-01T00:00:00.000Z');
});

test('recalcularDemandasAoVivo (extraído do HTML real gerado) faz o MESMO pipeline que montarDemandasChegadasMensais (build-dashboard.js) roda no build: parseAvancos + parseLab + redirecionarSupsDesconhecidos + chegadasMensaisPorRegistro -- prova que live-refresh e build nunca podem divergir', () => {
  const html = renderComSenha([registroExemplo()]);
  const { recalcularDemandasAoVivo, window: sandboxWindow } = extrairFuncoesPuras(html);
  sandboxWindow.__ANO_ORCAMENTO__ = 2026;

  // Mesmo CSV e mesma asserção que
  // test/orcamento-build-dashboard.test.js:204 usa pro lado servidor --
  // prova que os dois caminhos concordam no mesmo furo.
  const avancosCsv = 'Contrato,Criação da OS,Tipo,Status,Executado Dia,Deslocamento,Total (m),Observações de Campo,OS,Sondador\n'
    + 'SUP-7133-24,46023,SP,PENDENTE,,Não,10,,OS-1,\n'
    + 'SUP-9999-24,46054,SP,PENDENTE,,Não,10,,OS-2,\n';
  const labCsv = 'ID Contrato,Ensaiado Dia,Tipo de Ensaio,Data Programada\n';
  const registrosNovos = [{ sup: 'SUP-7133-24', tipologia: 'SP' }, { sup: 'Diversos', tipologia: 'SP' }];

  const resultado = recalcularDemandasAoVivo(avancosCsv, labCsv, null, null, registrosNovos);
  assert.strictEqual(resultado.chegadasMensais['SUP-7133-24||SP'][0], 1);
  assert.strictEqual(resultado.chegadasMensais['Diversos||SP'][1], 1, 'SUP desconhecido redireciona pra Diversos, mesma regra do build');
});

test('recalcularDemandasAoVivo também devolve o saldo de abertura (estoque em 31/12 do ano anterior) -- mesma regra que saldoAberturaPorRegistro usa no build', () => {
  const html = renderComSenha([registroExemplo()]);
  const { recalcularDemandasAoVivo, window: sandboxWindow } = extrairFuncoesPuras(html);
  sandboxWindow.__ANO_ORCAMENTO__ = 2026;

  // 45658 = 01/01/2025 (furo pendente que chegou no ano anterior -- entra no
  // saldo de abertura de 2026, não nas chegadas de 2026). Mesmo fixture que
  // test/orcamento-build-dashboard.test.js:239 usa pro lado servidor.
  const avancosCsv = 'Contrato,Criação da OS,Tipo,Status,Executado Dia,Deslocamento,Total (m),Observações de Campo,OS,Sondador\n'
    + 'SUP-7133-24,45658,SP,PENDENTE,,Não,10,,OS-1,\n';
  const labCsv = 'ID Contrato,Ensaiado Dia,Tipo de Ensaio,Data Programada\n';
  const registrosNovos = [{ sup: 'SUP-7133-24', tipologia: 'SP' }];

  const resultado = recalcularDemandasAoVivo(avancosCsv, labCsv, null, null, registrosNovos);
  assert.strictEqual(resultado.saldoAbertura['SUP-7133-24||SP'], 1);
  assert.strictEqual(resultado.chegadasMensais['SUP-7133-24||SP'], undefined, 'furo de 2025 não é chegada de 2026');
});
```

Also add, inside `extrairFuncoesPuras`'s exposing string (after the `fecharTendenciaVigente`/`mediaEquipesPonderada` lines) and its returned object:

```js
' this.periodosDoAnoOrcamento = periodosDoAnoOrcamento; this.recalcularDemandasAoVivo = recalcularDemandasAoVivo;',
```
```js
    periodosDoAnoOrcamento: sandbox.periodosDoAnoOrcamento,
    recalcularDemandasAoVivo: sandbox.recalcularDemandasAoVivo,
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: FAIL — `periodosDoAnoOrcamento`/`recalcularDemandasAoVivo` are `undefined` (not defined yet).

- [ ] **Step 3: Write minimal implementation**

In `tools/orcamento/render-dashboard.js`, right after the existing `var URL_ESPELHO_MATRIZ = '...';` line, add:

```js
// Os 4 arquivos que o build já usa pra Demandas (ver
// tools/orcamento/build-dashboard.js, montarDemandasChegadasMensais) --
// publicados em texto puro junto com a própria página (mesmo domínio do
// GitHub Pages, sem CORS), exatamente como a página semanal já busca os
// mesmos 4 arquivos pro próprio live-refresh.
var URL_ESPELHO_AVANCOS = 'avancos-online.csv';
var URL_ESPELHO_LAB = 'lab-online.csv';
var URL_ESPELHO_DEMANDAS_SONDAGEM = 'demandas-sondagem-online.csv';
var URL_ESPELHO_DEMANDAS_LAB = 'demandas-lab-online.json';

// Réplica cliente de periodosDoAnoSemanal() (tools/semanal/render-
// semanal.js) -- chegadasMensaisPorRegistro/saldoAberturaPorRegistro só
// precisam do ano de periodos[0] (12 meses janeiro-dezembro consecutivos),
// baked em window.__ANO_ORCAMENTO__ pelo build (ver renderDashboard) em vez
// de recalculado a partir do cabeçalho do espelho ao vivo -- evitaria um
// parsing de data novo (serial Excel vs texto formatado do Google Sheets)
// sem necessidade.
function periodosDoAnoOrcamento() {
  var periodos = [];
  for (var i = 0; i < 12; i++) periodos.push(new Date(Date.UTC(window.__ANO_ORCAMENTO__, i, 1)));
  return periodos;
}

function buscarCsvOrcamento(url) {
  var comCacheBust = url + (url.indexOf('?') === -1 ? '?' : '&') + '_=' + Date.now();
  return fetch(comCacheBust).then(function (resposta) {
    if (!resposta.ok) throw new Error('HTTP ' + resposta.status + ' ao buscar ' + url);
    return resposta.text();
  });
}

function buscarJsonOrcamento(url) {
  var comCacheBust = url + (url.indexOf('?') === -1 ? '?' : '&') + '_=' + Date.now();
  return fetch(comCacheBust).then(function (resposta) {
    if (!resposta.ok) throw new Error('HTTP ' + resposta.status + ' ao buscar ' + url);
    return resposta.json();
  });
}

// parseAvancos/parseLab consomem a grade 1-INDEXADA de readXlsxSheet:
// grid[0] é um buraco vazio, grid[1] é o cabeçalho. parseCsvGrid devolve
// 0-indexada (grid[0] = cabeçalho) -- mesmo deslocamento que
// tools/semanal/render-semanal.js (gridCsvComoXlsx) já precisa fazer.
function gridCsvComoXlsxOrcamento(texto) {
  var g = parseCsvGrid(texto);
  g.unshift(null);
  return g;
}

// Mesmo pipeline que tools/orcamento/build-dashboard.js
// (montarDemandasChegadasMensais) roda no build, rodando no cliente com o
// bundle da Task 2 (ParseAvancos/ParseLab/ComputeDemandas, globals expostas
// por ele) -- os dois NUNCA podem divergir, senão um live-refresh mostraria
// um número diferente do que o próximo build vai gerar.
// textoDemandasSondagem/demandasLabJson podem vir null (pendentes são
// opcionais, mesma regra do build).
function recalcularDemandasAoVivo(textoAvancos, textoLab, textoDemandasSondagem, demandasLabJson, registrosNovos) {
  var gridAvancos = parseCsvGrid(textoAvancos);
  if (textoDemandasSondagem) {
    var gridPendentes = parseCsvGrid(textoDemandasSondagem);
    for (var i = 1; i < gridPendentes.length; i++) gridAvancos.push(gridPendentes[i]);
  }
  gridAvancos.unshift(null);
  var furosLidos = ParseAvancos.parseAvancos(gridAvancos).furos;
  var ensaiosLidos = ParseLab.parseLab(gridCsvComoXlsxOrcamento(textoLab)).ensaios;
  if (demandasLabJson) {
    for (var j = 0; j < demandasLabJson.length; j++) {
      var pend = demandasLabJson[j];
      ensaiosLidos.push({ sup: pend.sup, tipologia: pend.tipologia, concluido: null, criacao: pend.criacao ? new Date(pend.criacao) : null });
    }
  }
  var furos = ComputeDemandas.redirecionarSupsDesconhecidos(furosLidos, registrosNovos).itens;
  var ensaios = ComputeDemandas.redirecionarSupsDesconhecidos(ensaiosLidos, registrosNovos).itens;
  var periodos = periodosDoAnoOrcamento();
  return {
    chegadasMensais: ComputeDemandas.chegadasMensaisPorRegistro(furos, ensaios, periodos),
    saldoAbertura: ComputeDemandas.saldoAberturaPorRegistro(furos, ensaios, periodos),
  };
}
```

Right after `const SCRIPT_CLIENTE_TABELA = \`` (the opening of the template literal), add the MODULOS destructuring so every function above can reference `ParseAvancos`/`ParseLab`/`ComputeDemandas`:

```js
var ParseAvancos = MODULOS['parse-avancos.js'];
var ParseLab = MODULOS['parse-lab.js'];
var ComputeDemandas = MODULOS['compute-demandas.js'];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Regenerate the golden fixture**

```bash
node -e "const {construirHtmlGolden}=require('./test/helpers/golden-orcamento.js'); require('fs').writeFileSync('test/fixtures/orcamento-golden.html', construirHtmlGolden());"
node --test test/orcamento-html-inalterado.test.js
```

- [ ] **Step 6: Commit**

```bash
git add tools/orcamento/render-dashboard.js test/orcamento-render-dashboard.test.js test/fixtures/orcamento-golden.html
git commit -m "feat(orcamento): add periodosDoAnoOrcamento/recalcularDemandasAoVivo client helpers"
```

---

### Task 4: Rewrite `atualizarDadosAoVivo()` to recompute Demandas, with graceful per-pair degradation

**Files:**
- Modify: `tools/orcamento/render-dashboard.js` (`atualizarDadosAoVivo`, inside `SCRIPT_CLIENTE_TABELA`)
- Modify: `test/orcamento-render-dashboard.test.js`

**Interfaces:**
- Consumes: `recalcularDemandasAoVivo`, `buscarCsvOrcamento`, `buscarJsonOrcamento`, `URL_ESPELHO_AVANCOS`/`URL_ESPELHO_LAB`/`URL_ESPELHO_DEMANDAS_SONDAGEM`/`URL_ESPELHO_DEMANDAS_LAB` (all from Task 3).
- Produces: `atualizarDadosAoVivo` now also updates `window.__DEMANDAS_MENSAIS__`/`window.__DEMANDAS_SALDO_ABERTURA__` when avancos+lab both succeed; `recalcularTabela()` (already called at the end, already calls `montarGraficos` internally at `tools/orcamento/render-dashboard.js:1607`) picks up the new values automatically — no separate re-render call needed.

- [ ] **Step 1: Write the failing test**

Add to `test/orcamento-render-dashboard.test.js`, after the Task 3 tests:

```js
test('atualizarDadosAoVivo busca avancos/lab/demandas-sondagem/demandas-lab junto com a MATRIZ, cada um dos 4 de Demandas com .catch próprio -- uma falha neles nunca pode derrubar a atualização de Previsto/Realizado/Tendência (só Demandas fica sem atualizar)', () => {
  const html = renderComSenha([registroExemplo()]);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const scriptTabela = scripts[5][1];
  assert.match(scriptTabela, /buscarCsvOrcamento\(URL_ESPELHO_AVANCOS\)\.catch\(/);
  assert.match(scriptTabela, /buscarCsvOrcamento\(URL_ESPELHO_LAB\)\.catch\(/);
  assert.match(scriptTabela, /buscarCsvOrcamento\(URL_ESPELHO_DEMANDAS_SONDAGEM\)\.catch\(/);
  assert.match(scriptTabela, /buscarJsonOrcamento\(URL_ESPELHO_DEMANDAS_LAB\)\.catch\(/);
});

test('atualizarDadosAoVivo só recalcula Demandas quando avancos E lab vieram com sucesso (nenhum dos dois é null), e um erro de PARSING dentro do recálculo (não só de fetch) também não derruba o resto da atualização', () => {
  const html = renderComSenha([registroExemplo()]);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const scriptTabela = scripts[5][1];
  assert.match(scriptTabela, /if \(textos\[1\] && textos\[2\]\) \{\s*try \{/);
  assert.match(scriptTabela, /window\.__DEMANDAS_MENSAIS__ = demandas\.chegadasMensais;/);
  assert.match(scriptTabela, /window\.__DEMANDAS_SALDO_ABERTURA__ = demandas\.saldoAbertura;/);
  assert.match(scriptTabela, /catch \(erroDemandas\) \{/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: FAIL — today's `atualizarDadosAoVivo` only fetches `URL_ESPELHO_MATRIZ`.

- [ ] **Step 3: Write minimal implementation**

In `tools/orcamento/render-dashboard.js`, replace `atualizarDadosAoVivo()` (currently only fetching `URL_ESPELHO_MATRIZ`) with:

```js
function atualizarDadosAoVivo() {
  definirStatusAtualizacao('Atualizando…', false);
  Promise.all([
    buscarCsvOrcamento(URL_ESPELHO_MATRIZ),
    buscarCsvOrcamento(URL_ESPELHO_AVANCOS).catch(function () { return null; }),
    buscarCsvOrcamento(URL_ESPELHO_LAB).catch(function () { return null; }),
    buscarCsvOrcamento(URL_ESPELHO_DEMANDAS_SONDAGEM).catch(function () { return null; }),
    buscarJsonOrcamento(URL_ESPELHO_DEMANDAS_LAB).catch(function () { return null; }),
  ])
    .then(function (textos) {
      var grid = parseCsvGrid(textos[0]);
      var registrosNovos = parseMatrizClient(grid);
      if (!registrosNovos.length) throw new Error('nenhum registro encontrado no espelho -- confira se o Apps Script já rodou pelo menos uma vez');

      // Demandas é uma 5ª série opcional (só na dimensão Volume) -- ao
      // contrário da MATRIZ, uma falha em avancos/lab nunca pode derrubar o
      // resto do botão. Cada fetch acima já degrada com .catch(() => null);
      // aqui o try/catch cobre também um erro de PARSING (formato mudou),
      // que aconteceria DEPOIS do fetch já ter tido sucesso.
      if (textos[1] && textos[2]) {
        try {
          var demandas = recalcularDemandasAoVivo(textos[1], textos[2], textos[3], textos[4], registrosNovos);
          window.__DEMANDAS_MENSAIS__ = demandas.chegadasMensais;
          window.__DEMANDAS_SALDO_ABERTURA__ = demandas.saldoAbertura;
        } catch (erroDemandas) {
          console.warn('Não foi possível recalcular Demandas: ' + erroDemandas.message);
        }
      }

      preservarPrevistoInicial(window.__REGISTROS__, registrosNovos);
      window.__REGISTROS__ = registrosNovos;
      window.__REGISTROS__ = fecharTendenciaVigente(window.__REGISTROS__, window.__VIGENTE_IDX__);
      montarTodosFiltrosMulti(window.__REGISTROS__);
      document.getElementById('corpo-tabela').innerHTML = renderCorpoTabela(window.__REGISTROS__, dimensoesEmOrdem(filtrosSelecionados.dimensao));
      recalcularTabela();
      recalcularAlertas();

      var agora = new Date();
      definirStatusAtualizacao('Atualizado às ' + agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), false);
    })
    .catch(function (erro) {
      definirStatusAtualizacao('Falha ao atualizar: ' + erro.message, true);
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: PASS, 0 failures. Note: the pre-existing test `'o live-refresh (atualizarDadosAoVivo) fecha a Tendência com fecharTendenciaVigente logo após buscar dados novos'` still matches (the `fecharTendenciaVigente` call and its surrounding lines are unchanged), just now reads `scripts[5]` (already fixed in Task 2 Step 5).

- [ ] **Step 5: Regenerate the golden fixture**

```bash
node -e "const {construirHtmlGolden}=require('./test/helpers/golden-orcamento.js'); require('fs').writeFileSync('test/fixtures/orcamento-golden.html', construirHtmlGolden());"
node --test test/orcamento-html-inalterado.test.js
```

- [ ] **Step 6: Run the full suite**

Run: `node --test`
Expected: PASS, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add tools/orcamento/render-dashboard.js test/orcamento-render-dashboard.test.js test/fixtures/orcamento-golden.html
git commit -m "feat(orcamento): recompute Demandas from avancos/lab/pendentes when 'Atualizar dados' is clicked"
```

---

### Task 5: Document the decision in CLAUDE.md and run the final regression pass

**Files:**
- Modify: `CLAUDE.md` (repo root)

**Interfaces:** none (documentation only).

- [ ] **Step 1: Add a dated section to CLAUDE.md**

Append (following the existing dated-section convention already used for the 3 prior 2026-08-13 entries):

```markdown
## Atualizar Demandas ao clicar em "Atualizar dados" (2026-08-14)

O botão "Atualizar dados" da Matriz de Orçamento (`tools/orcamento/render-dashboard.js`,
`atualizarDadosAoVivo`) agora também recalcula Demandas (chegadas mensais +
saldo de abertura), não só Previsto/Realizado/Tendência. Reaproveita o
mecanismo de bundle de navegador que a página semanal já usava
(`tools/comum/browser-bundle.js` + `tools/semanal/{compute-semanal,parse-avancos,
parse-lab,compute-demandas}.js`, embutidos como 2 `<script>` novos antes do
script principal -- 6 `<script>` ao todo, mesmo layout de
`tools/semanal/render-semanal.js`) em vez de duplicar as regras de parsing à
mão. `window.__ANO_ORCAMENTO__` (baked no HTML, mesmo padrão de
`window.__VIGENTE_IDX__`) substitui a necessidade de reler o ano do
cabeçalho do espelho ao vivo.

Divergência deliberada do padrão da semanal: avancos-online.csv/lab-online.csv
são OPCIONAIS aqui (cada um com `.catch(() => null)`, mais um try/catch em
volta do recálculo) -- na semanal um 404 neles derruba o refresh inteiro,
mas na Matriz de Orçamento Previsto/Realizado/Tendência (o conteúdo
principal da página) não depende desses 2 arquivos, só Demandas depende.
Ver `docs/superpowers/specs/2026-08-13-orcamento-atualizar-demandas-design.md`.
```

- [ ] **Step 2: Run the full test suite one more time**

Run: `node --test`
Expected: PASS, 0 failures.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document the live-refresh Demandas pipeline decision"
```

---

## Após a implementação

Nenhuma task deste plano roda o build real nem publica no GitHub Pages —
isso segue o mesmo fluxo manual já usado nos 2 ajustes anteriores desta
mesma feature: pedir a senha de novo, rodar
`ORCAMENTO_SENHA=... node tools/orcamento/build-dashboard.js`, copiar pra
`docs/index.html`, rodar a suíte completa, e só then commitar/publicar --
tudo com confirmação explícita do usuário em cada etapa.
