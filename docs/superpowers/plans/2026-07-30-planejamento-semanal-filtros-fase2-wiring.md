# Fase 2 (filtros) — Plano 2: ligar os filtros na página Planejamento Semanal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the shared filter primitives (`scriptFiltros()`, extracted and merged in Plan 1) into `tools/semanal/render-semanal.js`, so both abas of the Planejamento Semanal page get a real filter bar (origem/categoria/tipologia/grupo/sup + a 3-option dimension selector) instead of always aggregating every registro.

**Architecture:** One shared `filtrosSelecionadosSemanal` state and one `<div class="filtros">` bar, positioned above the tab switcher exactly like the orçamento page — governs both abas. Aba 1 (Tabela semanal) gains multi-dimension support (`renderAbaSemanal` now renders one stacked block per selected dimension, mirroring the orçamento Gráfico tab's `.grafico-bloco-dimensao` pattern). Aba 2 (Balanço de massa) keeps its own local controls (Período/Base/Dimensão-2/Ativos) unchanged, but now receives the shared bar's filtered `indices` instead of "all registros" — `listarTipologias`/`calcularLinhas` already accept `indices`, so no changes are needed inside `render-aba-balanco.js`/`compute-balanco.js`.

**Tech Stack:** Plain Node.js (`node:test`, `node:vm`, `node:assert`), no external dependencies. Client-side code is ES5-style (`var`/`function`, no arrow functions).

## Global Constraints

- No new npm dependencies — this repo has no `package.json`.
- Client-side JS embedded in `tools/semanal/render-semanal.js`/`render-aba-semanal.js` must stay ES5-style (`var`, `function`, no arrow functions, no `const`/`let`) inside anything that runs in the browser (template-literal strings, or files bundled via `buildBrowserBundle`).
- Never write the real `ORCAMENTO_SENHA` anywhere in source, tests, or fixtures — tests use fake password constants already established in each test file (e.g. `SENHA_FAKE`).
- **Field scope is fixed by the approved spec** (`docs/superpowers/specs/2026-07-29-planejamento-semanal-filtros-design.md`) — do not add `filtro-serie` to the semanal filter bar (no columns it would toggle), and do not unify aba 2's 2-option dimension selector with aba 1's 3-option one (equipes has no visible effect on the Balanço chart's primary bar).
- The shared filter bar governs BOTH abas via one `filtrosSelecionadosSemanal` object and one `<div class="filtros">` — it is not duplicated per-aba.
- Aba 2's own controls (Período/Base/Dimensão-2/Ativos) remain page-local state, applied *after* the shared bar's `indices` — they narrow further, never replace it.
- `docs/planejamento-semanal.html` and `dist/planejamento-semanal.html` are NOT touched by any task in this plan (no rebuild/republish) — that only happens when `ORCAMENTO_SENHA` and the `G:\` spreadsheets are available, which is out of scope here.

---

### Task 1: Multi-dimension `renderAbaSemanal`

**Files:**
- Modify: `tools/semanal/render-aba-semanal.js`
- Test: `test/semanal-render-aba-semanal.test.js`

**Interfaces:**
- Produces: `renderAbaSemanal(registros, indices, dimensoes, vigenteIdx)` — `dimensoes` is now an **array** of dimension keys (`'equipes' | 'volume' | 'financeiro'`), in the order to render, previously a single string. Renders one `<div class="bloco-dimensao-semanal">` (heading + `<table class="tabela-semanal">`) per entry, concatenated.
- `rotuloColunaFechamento(dimensao)` — unchanged, still takes a single dimension string (called once per block, inside the loop).

- [ ] **Step 1: Write the failing tests for the new array signature and multi-block rendering**

Replace the whole content of `test/semanal-render-aba-semanal.test.js` with:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderAbaSemanal, rotuloColunaFechamento } = require('../tools/semanal/render-aba-semanal.js');

function registro(volumeMes) {
  const zeros = new Array(12).fill(0);
  const vol = new Array(12).fill(0); vol[6] = volumeMes;
  const bloco = (v) => ({ equipes: new Array(12).fill(2), volume: v, financeiro: zeros,
    equipesResumo: { pico: 2, media: 2, prod: 8, dias: 25 },
    volumeResumo: { total: volumeMes, totalInicial: volumeMes, ticket: 1 },
    financeiroResumo: { total: 0, totalInicial: 0 } });
  return { sup: 'SUP-0001-24', grupo: 'G', tomador: 'T', tipologia: 'ST',
           previsto: bloco(vol), realizado: bloco(zeros), total: bloco(zeros) };
}

test('mostra as 4 semanas com P, R e T', () => {
  const html = renderAbaSemanal([registro(400)], [0], ['volume'], 6);
  for (const s of ['S1', 'S2', 'S3', 'S4']) assert.match(html, new RegExp(s));
  assert.match(html, /Previsto/); assert.match(html, /Realizado/); assert.match(html, /Tend/);
});

test('previsto de volume aparece como um quarto do mês', () => {
  const html = renderAbaSemanal([registro(400)], [0], ['volume'], 6);
  assert.match(html, /100/);
});

test('a coluna de fechamento muda de rótulo conforme a dimensão', () => {
  assert.strictEqual(rotuloColunaFechamento('volume'), 'Total');
  assert.strictEqual(rotuloColunaFechamento('financeiro'), 'Total');
  assert.strictEqual(rotuloColunaFechamento('equipes'), 'Média');
});

test('realizado e tendência ficam vazios enquanto não há planilha semanal', () => {
  const html = renderAbaSemanal([registro(400)], [0], ['volume'], 6);
  assert.match(html, /class="[^"]*sem-dado/);
});

test('com uma dimensão só, renderiza exatamente 1 bloco/tabela', () => {
  const html = renderAbaSemanal([registro(400)], [0], ['volume'], 6);
  assert.equal((html.match(/<div class="bloco-dimensao-semanal">/g) || []).length, 1);
  assert.equal((html.match(/<table class="tabela-semanal">/g) || []).length, 1);
});

test('com várias dimensões marcadas, renderiza um bloco por dimensão, na ordem recebida, cada um com seu próprio título e sua própria coluna de fechamento', () => {
  const html = renderAbaSemanal([registro(400)], [0], ['equipes', 'volume', 'financeiro'], 6);
  assert.equal((html.match(/<div class="bloco-dimensao-semanal">/g) || []).length, 3);
  assert.equal((html.match(/<table class="tabela-semanal">/g) || []).length, 3);

  // split() no próprio marcador de bloco -- blocos[0] é '' (antes do 1º
  // marcador), blocos[1..3] são o conteúdo de cada bloco, na ordem em que
  // aparecem no HTML (que deve ser a ordem recebida em "dimensoes", não
  // reordenada).
  const blocos = html.split('<div class="bloco-dimensao-semanal">').slice(1);
  assert.equal(blocos.length, 3);

  assert.match(blocos[0], /<div class="tabela-semanal-titulo">Equipes<\/div>/);
  assert.match(blocos[1], /<div class="tabela-semanal-titulo">Volume<\/div>/);
  assert.match(blocos[2], /<div class="tabela-semanal-titulo">Financeiro<\/div>/);

  // Bloco de equipes fecha por Média (rótulo da coluna); volume/financeiro fecham por Total.
  assert.match(blocos[0], />Média<\/th>/);
  assert.match(blocos[1], />Total<\/th>/);
  assert.match(blocos[2], />Total<\/th>/);
});

test('título do bloco escapa o rótulo da dimensão (defesa em profundidade, mesmo as 3 dimensões sendo valores fixos e seguros)', () => {
  const html = renderAbaSemanal([registro(400)], [0], ['volume'], 6);
  assert.match(html, /<div class="tabela-semanal-titulo">Volume<\/div>/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/semanal-render-aba-semanal.test.js`
Expected: FAIL — the first 4 tests fail because `renderAbaSemanal` still takes a single string as its 3rd argument (passing `['volume']` breaks `dividirEmSemanas`/`previstoMesVigente`, which index straight into `registro[dimensao]` expecting a string key); the 2 new tests fail because `bloco-dimensao-semanal`/`tabela-semanal-titulo` don't exist yet.

- [ ] **Step 3: Rewrite `renderAbaSemanal` to loop over an array of dimensions**

In `tools/semanal/render-aba-semanal.js`, add this small label map right after the existing `require`s (after line 2):

```js
// Rótulo de exibição de cada dimensão -- só as 3 que a barra de filtros da
// semanal expõe (ver FILTROS_CONFIG_SEMANAL/DIMENSOES_CONFIG_SEMANAL em
// render-semanal.js); "produtividade"/"ticketMedio" do orçamento não têm
// equivalente aqui.
var DIMENSOES_ROTULO_SEMANAL = { equipes: 'Equipes', volume: 'Volume', financeiro: 'Financeiro' };
```

Replace the current `renderAbaSemanal` function (the last function in the file, right before `module.exports`) with:

```js
// registros/indices: mesmo par que o orçamento já usa (registros: array
// completo da MATRIZ; indices: quais entram nesta tabela -- agora vem
// filtrado pela barra compartilhada, ver render-semanal.js). dimensoes:
// array de 'volume' | 'financeiro' | 'equipes', na ordem a renderizar --
// várias marcadas ao mesmo tempo produzem um bloco empilhado por dimensão,
// mesmo padrão visual de .grafico-bloco-dimensao no orçamento (CSS próprio
// em CSS_SEMANAL, ver render-semanal.js -- não entra em cssBase()).
// vigenteIdx: índice 0-11 do mês vigente dentro dos arrays mensais de cada
// registro.
//
// Previsto vem de dividirEmSemanas (Task 6) aplicado à soma do Previsto do
// mês vigente através dos registros selecionados. Realizado e Tendência
// ainda não têm fonte -- a planilha semanal não existe (o usuário vai
// disponibilizá-la depois); as colunas são renderizadas vazias, com a
// classe sem-dado, prontas para um parser futuro preencher os 4 valores por
// semana sem precisar mudar a estrutura da tabela.
function renderAbaSemanal(registros, indices, dimensoes, vigenteIdx) {
  return dimensoes.map(function (dimensao) {
    var mesVigente = previstoMesVigente(registros, indices, dimensao, vigenteIdx);
    var semanasPrevisto = dividirEmSemanas(mesVigente, dimensao);
    var fechamentoPrevisto = fecharMes(semanasPrevisto, dimensao);
    var semanasSemDado = new Array(SEMANAS).fill(null);

    return '<div class="bloco-dimensao-semanal">'
      + '<div class="tabela-semanal-titulo">' + escapeHtml(DIMENSOES_ROTULO_SEMANAL[dimensao] || dimensao) + '</div>'
      + '<table class="tabela-semanal">'
      + renderCabecalho(dimensao)
      + '<tbody>'
      + renderLinhaSerie('Previsto', 'previsto', semanasPrevisto, fechamentoPrevisto)
      + renderLinhaSerie('Realizado', 'realizado', semanasSemDado, null)
      + renderLinhaSerie('Tendência', 'tendencia', semanasSemDado, null)
      + '</tbody></table></div>';
  }).join('');
}

module.exports = { renderAbaSemanal, rotuloColunaFechamento };
```

(Only the function body and the trailing `module.exports` line change — everything else in the file, including `previstoMesVigente`, `renderCabecalho`, `renderLinhaSerie`, `escapeHtml`, `formatarNumero`, stays exactly as it is.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/semanal-render-aba-semanal.test.js`
Expected: PASS, 8/8.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/render-aba-semanal.js test/semanal-render-aba-semanal.test.js
git commit -m "$(cat <<'EOF'
Suportar múltiplas dimensões em renderAbaSemanal

Muda o 3º parâmetro de string pra array, renderizando um bloco
empilhado (título + tabela) por dimensão marcada -- prepara a aba
Semanal para o seletor de dimensão de verdade (Plano 2, Task 2), mesmo
padrão visual do .grafico-bloco-dimensao que o orçamento já usa.
EOF
)"
```

---

### Task 2: Ligar a barra de filtros compartilhada em `render-semanal.js`

**Files:**
- Modify: `tools/semanal/render-semanal.js`

**Interfaces:**
- Consumes: `scriptFiltros`, `markupFiltros` from `tools/comum/render-shell.js` (already exported, unchanged by this plan); `renderAbaSemanal(registros, indices, dimensoes, vigenteIdx)` from Task 1.
- Produces (client-side globals, inside `SCRIPT_CLIENTE_SEMANAL`): `FILTROS_CONFIG_SEMANAL`, `DIMENSOES_CONFIG_SEMANAL`, `filtrosSelecionadosSemanal`, `dimensoesEmOrdemSemanal(selecionadas)`, `aoMudarSemanal(cfg)`, `recalcularSemanal()`. `montarAbaBalanco(registros, indices)` — gains a required 2nd parameter (previously computed `indicesTodos(registros)` internally).

- [ ] **Step 1: Import `markupFiltros`/`scriptFiltros`**

Modify `tools/semanal/render-semanal.js:5-7`, from:

```js
const {
  cssBase, markupCabecalho, markupAbas, scriptDesbloqueio,
} = require('../comum/render-shell.js');
```

to:

```js
const {
  cssBase, markupCabecalho, markupFiltros, markupAbas, scriptDesbloqueio, scriptFiltros,
} = require('../comum/render-shell.js');
```

- [ ] **Step 2: Remove the stale header comment about filters not being wired**

Delete these lines from the top-of-file comment block (currently lines 19-22):

```js
// markupFiltros() (da casca) continua NÃO entrando aqui: a aba Semanal, por
// ora, sempre agrega TODOS os registros (sem recorte) na dimensão fixa
// 'financeiro' -- ver o comentário sobre DIMENSAO_PADRAO abaixo. Só a aba
// Balanço de massa ganhou controles nesta tarefa.
```

- [ ] **Step 3: Add the build-time filter-bar skeleton**

Add this constant near `ABAS_VISUALIZACAO` (right after it, before `CSS_BALANCO`):

```js
// Os 6 filtros multi-select da barra compartilhada entre as duas abas: só
// id e rótulo inicial (mesmo padrão de FILTROS_PRINCIPAIS no orçamento) --
// as opções de cada um são montadas no cliente a partir dos registros
// decifrados. Sem filtro-serie (a Tabela semanal não tem colunas
// alternáveis -- ver docs/superpowers/specs/2026-07-29-planejamento-semanal-filtros-design.md).
const FILTROS_SEMANAL = [
  { id: 'filtro-origem', rotulo: 'Todas as origens' },
  { id: 'filtro-categoria', rotulo: 'Todas as categorias' },
  { id: 'filtro-tipologia', rotulo: 'Todas as tipologias' },
  { id: 'filtro-grupo', rotulo: 'Todos os grupos' },
  { id: 'filtro-sup', rotulo: 'Todos os SUP' },
  { id: 'seletor-dimensao', rotulo: 'Financeiro' },
];
```

- [ ] **Step 4: Splice the filter bar into the HTML template**

Modify the `renderSemanal()` template (currently):

```js
  <div id="conteudo-protegido" style="display:none">
${markupAbas(ABAS_VISUALIZACAO, '    ')}
    <div id="secao-semanal"></div>
    <div id="secao-balanco" style="display:none"></div>
  </div>
```

to:

```js
  <div id="conteudo-protegido" style="display:none">
${markupFiltros(FILTROS_SEMANAL, { recuo: '    ' })}
${markupAbas(ABAS_VISUALIZACAO, '    ')}
    <div id="secao-semanal"></div>
    <div id="secao-balanco" style="display:none"></div>
  </div>
```

- [ ] **Step 5: Splice `scriptFiltros()` into the client script**

Modify the final `<script>` tag (currently):

```js
  <script>${SCRIPT_CLIENTE_SEMANAL}</script>
```

to:

```js
  <script>${scriptFiltros()}${SCRIPT_CLIENTE_SEMANAL}</script>
```

This must stay the LAST `<script>` tag and the total count must stay at 6 (concatenating into the existing tag, not adding a new one) — `scriptFiltros()`'s functions (`montarFiltroMulti`, `indicesFiltrados`, `opcoesFiltro`, etc.) must be defined before `SCRIPT_CLIENTE_SEMANAL`'s code calls them, which this ordering guarantees.

- [ ] **Step 6: Replace the fixed-dimension/no-filter client script with the real wiring**

Replace the whole `SCRIPT_CLIENTE_SEMANAL` constant's body (keep the `const SCRIPT_CLIENTE_SEMANAL = \`` opening and closing `` \`; `` lines, replace everything between) with:

```js
var ComputeSemanal = MODULOS['compute-semanal.js'];
var RenderAbaSemanal = MODULOS['render-aba-semanal.js'];
var ComputeBalanco = MODULOS['compute-balanco.js'];
var RenderAbaBalanco = MODULOS['render-aba-balanco.js'];

// As 3 dimensões que a aba Semanal expõe -- subconjunto das 5 do orçamento
// (sem produtividade/ticketMedio, que não fazem sentido pra uma tabela
// semanal). Ordem canônica: sempre nesta ordem quando várias estão
// marcadas, nunca na ordem em que a pessoa marcou os checkboxes -- mesmo
// raciocínio de DIMENSOES_CONFIG/dimensoesEmOrdem no orçamento.
var DIMENSOES_CONFIG_SEMANAL = [
  { valor: 'equipes', rotulo: 'Equipes' },
  { valor: 'volume', rotulo: 'Volume' },
  { valor: 'financeiro', rotulo: 'Financeiro' },
];

function dimensoesEmOrdemSemanal(selecionadas) {
  var ordenadas = DIMENSOES_CONFIG_SEMANAL.filter(function (d) { return selecionadas.has(d.valor); }).map(function (d) { return d.valor; });
  return ordenadas.length ? ordenadas : ['financeiro'];
}

// Réplica do FILTROS_CONFIG do orçamento, com uma omissão deliberada: sem
// filtro-serie (ver docs/superpowers/specs/2026-07-29-planejamento-semanal-filtros-design.md,
// "Escopo de campos -- aba 1"). categoriaTipologia/opcoesFiltro/
// indicesFiltrados/montarFiltroMulti vêm de scriptFiltros() (tools/comum/render-shell.js),
// concatenado ANTES deste script na mesma <script> tag.
var FILTROS_CONFIG_SEMANAL = [
  { id: 'filtro-origem', chave: 'origem', rotuloPadrao: 'Todas as origens', campo: 'origem', rotuloCapitalizado: true },
  { id: 'filtro-categoria', chave: 'categoria', rotuloPadrao: 'Todas as categorias', opcoesFixas: [
    { valor: 'labConvencional', rotulo: 'Lab. Convencional' },
    { valor: 'labEspecial', rotulo: 'Lab. Especial' },
    { valor: 'sondagemConvencional', rotulo: 'Sondagem Convencional' },
    { valor: 'sondagemEspecial', rotulo: 'Sondagem Especial' },
  ] },
  { id: 'filtro-tipologia', chave: 'tipologia', rotuloPadrao: 'Todas as tipologias', campo: 'tipologia' },
  { id: 'filtro-grupo', chave: 'grupo', rotuloPadrao: 'Todos os grupos', campo: 'grupo' },
  { id: 'filtro-sup', chave: 'sup', rotuloPadrao: 'Todos os SUP', campo: 'sup', rotuloComposto: true },
  { id: 'seletor-dimensao', chave: 'dimensao', rotuloPadrao: 'Selecione ao menos 1', opcoesFixas: DIMENSOES_CONFIG_SEMANAL, minimoUm: true },
];

// chave -> Set dos valores marcados -- Set vazio significa "sem filtro,
// mostra tudo", igual ao orçamento (ver filtroExclui em scriptFiltros()).
// dimensao começa com Financeiro marcado (nunca pode ficar vazio, minimoUm:true).
var filtrosSelecionadosSemanal = {};
FILTROS_CONFIG_SEMANAL.forEach(function (cfg) { filtrosSelecionadosSemanal[cfg.chave] = new Set(); });
filtrosSelecionadosSemanal.dimensao.add('financeiro');

// dados: o que o gate acabou de JSON.parse -- {registros, baseline} (ver o
// ACHADO documentado acima desta constante). Guarda baseline à parte
// (window.__BASELINE__) e devolve só o array de registros, que é o que o
// resto do gate (e montarDashboard) espera em window.__REGISTROS__.
function fecharTendenciaVigente(dados) {
  window.__BASELINE__ = dados && dados.baseline;
  return dados && dados.registros ? dados.registros : dados;
}

function alternarAba(aba) {
  document.getElementById('secao-semanal').style.display = aba === 'semanal' ? '' : 'none';
  document.getElementById('secao-balanco').style.display = aba === 'balanco' ? '' : 'none';
  document.getElementById('aba-semanal').classList.toggle('aba-ativa', aba === 'semanal');
  document.getElementById('aba-balanco').classList.toggle('aba-ativa', aba === 'balanco');
}

// Estado dos controles PRÓPRIOS da aba Balanço de massa (Período/Base/
// Dimensão-2/Ativos) -- continuam locais a esta aba, aplicados DEPOIS do
// indices que a barra compartilhada já filtrou (ver "Fluxo de dados" no
// spec). somenteAtivos começa LIGADO -- a grade de origem é densa (34 SUPs
// x 10 tipologias, todo SUP presente em toda tipologia, a maioria zerada);
// desligado por padrão, cada gráfico abriria com a maioria das linhas em
// comprimento zero. Tendência não é opção de base -- descartada
// explicitamente pelo dono do projeto (ver compute-balanco.js).
var ESTADO_BALANCO = { periodo: 'mesVigente', base: 'previsto', dimensao: 'financeiro', somenteAtivos: true };

// Redesenha #secao-balanco inteira (controles + um gráfico por tipologia
// presente em 'indices') com o estado atual de ESTADO_BALANCO, e religa os 4
// controles -- eles são recriados a cada innerHTML novo (renderControles, em
// render-aba-balanco.js), então os listeners da renderização anterior
// morreram junto com os elementos antigos e precisam ser religados toda
// vez, depois do innerHTML. 'indices' vem da barra de filtros compartilhada
// (ver recalcularSemanal) -- os 4 controles desta aba filtram ainda mais
// dentro dele, nunca o substituem.
function montarAbaBalanco(registros, indices) {
  document.getElementById('secao-balanco').innerHTML = RenderAbaBalanco.renderAbaBalanco(registros, indices, {
    periodo: ESTADO_BALANCO.periodo,
    base: ESTADO_BALANCO.base,
    dimensao: ESTADO_BALANCO.dimensao,
    somenteAtivos: ESTADO_BALANCO.somenteAtivos,
    vigenteIdx: window.__VIGENTE_IDX__,
    baseline: window.__BASELINE__,
  });

  document.getElementById('balanco-periodo').addEventListener('change', function (e) {
    ESTADO_BALANCO.periodo = e.target.value;
    montarAbaBalanco(registros, indices);
  });
  document.getElementById('balanco-base').addEventListener('change', function (e) {
    ESTADO_BALANCO.base = e.target.value;
    montarAbaBalanco(registros, indices);
  });
  document.getElementById('balanco-dimensao').addEventListener('change', function (e) {
    ESTADO_BALANCO.dimensao = e.target.value;
    montarAbaBalanco(registros, indices);
  });
  document.getElementById('balanco-somente-ativos').addEventListener('change', function (e) {
    ESTADO_BALANCO.somenteAtivos = e.target.checked;
    montarAbaBalanco(registros, indices);
  });
}

// Recalcula o recorte a partir da barra de filtros compartilhada e redesenha
// as DUAS abas com o mesmo 'indices' -- é a única função que decide "o que
// recalcular" quando um filtro muda (equivalente a recalcularTabela +
// recalcularAlertas no orçamento, só que aqui é uma função só pras duas
// abas, já que nenhuma delas tem o custo de montagem incremental que a
// Tabela do orçamento tem -- as duas são full re-render via innerHTML).
function recalcularSemanal() {
  var indices = indicesFiltrados(
    window.__REGISTROS__,
    filtrosSelecionadosSemanal.tipologia,
    filtrosSelecionadosSemanal.categoria,
    filtrosSelecionadosSemanal.grupo,
    filtrosSelecionadosSemanal.sup,
    filtrosSelecionadosSemanal.origem
  );
  var dimensoes = dimensoesEmOrdemSemanal(filtrosSelecionadosSemanal.dimensao);
  document.getElementById('secao-semanal').innerHTML = RenderAbaSemanal.renderAbaSemanal(window.__REGISTROS__, indices, dimensoes, window.__VIGENTE_IDX__);
  montarAbaBalanco(window.__REGISTROS__, indices);
}

// Callback de mudança de filtro (aoMudar, ver montarFiltroMulti em
// scriptFiltros()) -- reproduz a cascata categoria->tipologia que o
// orçamento também precisa (aoMudarFiltroOrcamento, tools/orcamento/render-dashboard.js):
// opcoesFiltro só recalcula a lista de tipologias válidas quando CHAMADA de
// novo, então mudar a categoria exige remontar o painel de tipologia pra
// essa cascata aparecer na tela.
function aoMudarSemanal(cfg) {
  if (cfg.chave === 'categoria') {
    var cfgTipologia = FILTROS_CONFIG_SEMANAL.filter(function (c) { return c.chave === 'tipologia'; })[0];
    montarFiltroMulti(cfgTipologia, window.__REGISTROS__, filtrosSelecionadosSemanal, aoMudarSemanal);
  }
  recalcularSemanal();
}

function montarTodosFiltrosMultiSemanal(registros) {
  FILTROS_CONFIG_SEMANAL.forEach(function (cfg) { montarFiltroMulti(cfg, registros, filtrosSelecionadosSemanal, aoMudarSemanal); });
}

// registros: já decifrados (só é chamada de dentro de tentarDesbloquear,
// depois de decifrarComSenha) -- ver o comentário grande acima desta
// constante.
function montarDashboard(registros) {
  document.getElementById('aba-semanal').addEventListener('click', function () { alternarAba('semanal'); });
  document.getElementById('aba-balanco').addEventListener('click', function () { alternarAba('balanco'); });
  montarTodosFiltrosMultiSemanal(registros);
  configurarAberturaFiltrosMulti();
  recalcularSemanal();
}
```

This removes `DIMENSAO_PADRAO_SEMANAL` and `indicesTodos` entirely (both dead now — `indicesFiltrados` with all-empty Sets already produces "every index", and the dimension default lives in `filtrosSelecionadosSemanal.dimensao`'s initial `Set(['financeiro'])` instead of a fixed string). Everything else in the file (the big comment blocks above `CSS_BALANCO`/`CSS_SEMANAL`, `renderSemanal()` itself except the two template edits from Steps 4-5, `BUNDLE_ARQUIVOS`, `module.exports`) stays unchanged.

- [ ] **Step 7: Add CSS for the multi-dimension blocks**

Append to `CSS_SEMANAL` (in `tools/semanal/render-semanal.js`), right after the existing `.linha-tendencia` rules:

```js
const CSS_SEMANAL = `
  .linha-tendencia .serie-label, .linha-tendencia .celula-total-linha { color: #f6b53f; }
  .linha-tendencia .serie-label { border-left-color: #f6b53f; }
  .bloco-dimensao-semanal + .bloco-dimensao-semanal { margin-top: 28px; padding-top: 28px; border-top: 1px solid var(--border); }
  .tabela-semanal-titulo { font-size: 12px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 10px; }
`;
```

(Same values as `cssBase()`'s `.grafico-bloco-dimensao`/`.grafico-titulo` — same visual language as the orçamento's multi-dimension stacking, kept in this page-local sheet because `cssBase()` is byte-locked by `test/orcamento-html-inalterado.test.js`.)

- [ ] **Step 8: Run the existing suite and confirm what changes**

Run: `node --test test/*.test.js`

Expected: `test/semanal-render-semanal-wireup.test.js` and `test/semanal-render-aba-balanco-wireup.test.js` FAIL — both assert the old fixed-dimension/no-filter behavior (e.g. `renderAbaSemanal(registros, indicesTodos, 'financeiro', vigenteIdx)` with a bare string, and `blocos.length === 6` with the OLD script content). Task 3 rewrites these. Everything else should still pass, including all of `tools/orcamento/*` (untouched by this task) and Task 1's `test/semanal-render-aba-semanal.test.js`.

- [ ] **Step 9: Commit**

```bash
git add tools/semanal/render-semanal.js
git commit -m "$(cat <<'EOF'
Ligar a barra de filtros compartilhada na página semanal

Aba 1 e aba 2 passam a compartilhar filtrosSelecionadosSemanal (origem/
categoria/tipologia/grupo/sup + dimensão) via a mesma barra de filtros
do orçamento (scriptFiltros(), tools/comum/render-shell.js). Aba 2
mantém seus próprios controles (período/base/dimensão-2/ativos),
agora aplicados sobre o indices já filtrado pela barra, em vez de
sempre "todos os registros".

Os testes de wire-up existentes ainda esperam o comportamento antigo
(sem filtro) e falham de propósito -- a próxima tarefa os atualiza.
EOF
)"
```

---

### Task 3: Atualizar os testes de wire-up + cobrir comportamento com filtro ativo

**Files:**
- Modify: `test/semanal-render-semanal-wireup.test.js`, `test/semanal-render-aba-balanco-wireup.test.js`, `test/semanal-build-dashboard.test.js`, `test/semanal-linha-base-costura.test.js`

**Interfaces:**
- Consumes: the rewired `render-semanal.js` from Task 2, `renderAbaSemanal(registros, indices, dimensoes, vigenteIdx)` from Task 1.

**Scope note (added after Task 2's review):** Task 1's signature change (`renderAbaSemanal`'s 3rd argument going from a string to an array) broke two additional test files that neither Task 1 nor Task 2's briefs named — `test/semanal-build-dashboard.test.js` (one direct call site still passes a bare string) and `test/semanal-linha-base-costura.test.js` (its full-page sandbox test hits the same "fake DOM has no `querySelector`" gap as the two files already in scope, now that `montarDashboard` mounts the shared filter bar). Both are confirmed pre-existing regressions from Task 1, not caused by Task 2 — see the SDD ledger. This task's scope is widened to close both, since they're the same class of fix already being done here.

- [ ] **Step 1: Upgrade the fake DOM in both wire-up test files to support `querySelector`/`querySelectorAll` and real checkbox synthesis**

Both files currently define a `criarDocumentoFalso()` that only supports `getElementById`. `montarFiltroMulti`/`configurarAberturaFiltrosMulti` (from `scriptFiltros()`, now running inside this page) need `document.querySelector`, an element's own `.querySelector`/`.querySelectorAll`, `.closest`, and — to actually simulate checking a filter checkbox — a way to synthesize checkbox elements from a mounted panel's `innerHTML`. This is the exact same gap Plan 1's `test/comum-filtros-wireup.test.js` solved; reuse the identical approach.

In `test/semanal-render-semanal-wireup.test.js`, replace `criarDocumentoFalso` (currently lines 52-72) with the version below. **The returned shape stays exactly `{ elementos, getElementById, ... }`** — `querySelector`/`querySelectorAll` are added as new sibling properties on the same returned object, so `montarSandbox`'s existing `const documentoFalso = criarDocumentoFalso();` / `sandbox.document = documentoFalso` (unchanged) keeps working with no call-site edits anywhere:

```js
// DOM mínimo o bastante pro script de cliente rodar de ponta a ponta,
// AGORA incluindo a barra de filtros compartilhada (montarFiltroMulti/
// configurarAberturaFiltrosMulti, de scriptFiltros()) -- getElementById
// devolve sempre o MESMO objeto por id (memoizado); querySelector/
// querySelectorAll resolvem os poucos seletores que montarFiltroMulti de
// fato usa e sintetizam checkboxes reais (com addEventListener/change
// disparável) a partir do innerHTML que montarFiltroMulti escreveu, igual a
// test/comum-filtros-wireup.test.js (tools/comum/render-shell.js) já faz.
function criarDocumentoFalso() {
  const elementos = {};
  const checkboxesPorPainel = new Map();

  function criarCheckboxFake(valor, checked) {
    const listeners = {};
    return { value: valor, checked, listeners, addEventListener(tipo, fn) { listeners[tipo] = fn; } };
  }

  // Sintetiza os <input type="checkbox"> do innerHTML do painel -- cache
  // por texto de innerHTML (uma remontagem gera checkboxes NOVOS, igual ao
  // DOM real substituindo os nós ao reatribuir innerHTML).
  function checkboxesDoPainel(painel) {
    const cacheKey = painel.innerHTML;
    const cache = checkboxesPorPainel.get(painel);
    if (cache && cache.key === cacheKey) return cache.lista;
    const lista = [];
    const re = /<input type="checkbox" value="([^"]*)"( checked)?>/g;
    let m;
    while ((m = re.exec(painel.innerHTML))) lista.push(criarCheckboxFake(m[1], !!m[2]));
    checkboxesPorPainel.set(painel, { key: cacheKey, lista });
    return lista;
  }

  function elemento(id) {
    if (!elementos[id]) {
      const el = {
        id,
        style: {},
        classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
        listeners: {},
        addEventListener(tipo, fn) { this.listeners[tipo] = fn; },
        focus() {},
        value: '',
        textContent: '',
        innerHTML: '',
        disabled: false,
        closest() { return el; },
        // Só os 5 seletores que montarFiltroMulti/configurarAberturaFiltrosMulti
        // chamam sobre um elemento já resolvido (o gatilho, o painel, e o
        // que existe dentro do painel).
        querySelector(sel) {
          if (sel === '.filtro-multi-trigger') return elemento(id + '-trigger');
          if (sel === '.filtro-multi-painel') return elemento(id + '-painel');
          if (sel === '.filtro-multi-seta') return {};
          if (sel === '.filtro-multi-busca') return null; // sem busca digitada nestes testes
          if (sel === '.filtro-multi-vazio-busca') return { hidden: false };
          return null;
        },
        querySelectorAll(sel) {
          if (sel === 'input[type="checkbox"]') return checkboxesDoPainel(el);
          return [];
        },
      };
      elementos[id] = el;
    }
    return elementos[id];
  }

  return {
    elementos,
    getElementById: elemento,
    // document.querySelector só é chamado como '#algum-id .filtro-multi-trigger'
    // ou '#algum-id .filtro-multi-painel' (ver atualizarRotuloFiltro/montarFiltroMulti
    // em scriptFiltros()) -- resolve pro mesmo elemento(id) e delega.
    querySelector(sel) {
      const m = /^#([\w-]+) (\.filtro-multi-(?:trigger|painel))$/.exec(sel);
      return m ? elemento(m[1]).querySelector(m[2]) : null;
    },
    querySelectorAll() { return []; }, // .filtro-multi-trigger/.filtro-multi.aberto globais -- vazios de propósito, nenhum teste depende de achar outro filtro já aberto
    addEventListener() {},
  };
}
```

Apply the identical replacement to `test/semanal-render-aba-balanco-wireup.test.js`'s `criarDocumentoFalso` (currently lines 65-86) — same reasoning: its call site (inside `rodarBlocos`) already does `const documentoFalso = criarDocumentoFalso();` then `sandbox.document = documentoFalso`, unchanged.

- [ ] **Step 1b: Fix the one-line old-signature call site in `test/semanal-build-dashboard.test.js`**

This file doesn't run any client-side script through a sandbox — it calls `renderAbaSemanal` directly, so it needs no DOM changes, only the signature fix. In `test/semanal-build-dashboard.test.js:129`, change:

```js
const tabela = renderAbaSemanal(REGISTROS, [0], 'financeiro', 0);
```

to:

```js
const tabela = renderAbaSemanal(REGISTROS, [0], ['financeiro'], 0);
```

Nothing else in this file changes.

- [ ] **Step 1c: Apply the same fake-DOM upgrade to `test/semanal-linha-base-costura.test.js`**

This file's full-page sandbox test (`'na página gerada, a base "Previsto Inicial" só marca "sem base"...'`) drives `tentarDesbloquear()` → `montarDashboard()` → `montarTodosFiltrosMultiSemanal()`, which now needs `document.querySelector`/`painel.querySelectorAll` — the same gap Step 1 closed for the other two files. This test never interacts with the shared filter bar's checkboxes (it only flips the aba 2 `balanco-base` `<select>`), so it needs the DOM upgrade but no new filter-interaction assertions.

Replace `criarDocumentoFalso` (currently lines 149-162) with the **exact same function** written in Step 1 for `test/semanal-render-semanal-wireup.test.js` (identical code, same reasoning — copy it verbatim into this file too). Its call site, inside `rodarPagina` (currently lines 164-173), already does `const documentoFalso = criarDocumentoFalso();` then `sandbox.document = documentoFalso` — unchanged, no call-site edit needed here either.

- [ ] **Step 1d: Run these two files in isolation to confirm they pass again**

Run: `node --test test/semanal-build-dashboard.test.js test/semanal-linha-base-costura.test.js`
Expected: PASS, all tests in both files (this re-establishes the baseline Task 1 accidentally broke, before continuing with the rest of this task's own new work in Steps 2-5 below).

- [ ] **Step 2: Update the existing "sem filtro" assertions to reflect the new signature**

In `test/semanal-render-semanal-wireup.test.js`, the existing test `'depois da senha certa, a aba Semanal é montada de verdade...'` currently computes:

```js
const esperado = renderAbaSemanal(registros, indicesTodos, 'financeiro', vigenteIdx);
```

Change to:

```js
const esperado = renderAbaSemanal(registros, indicesTodos, ['financeiro'], vigenteIdx);
```

(Filter bar starts with every Set empty except `dimensao = Set(['financeiro'])`, so with no user interaction the rendered page must still match "no filter, dimension = financeiro" exactly — same expected value, just the new array-shaped 3rd argument.)

The static-assertion test (`'a chamada a RenderAbaSemanal.renderAbaSemanal... está no código-fonte de montarDashboard'`) currently regex-matches:

```js
/document\.getElementById\('secao-semanal'\)\.innerHTML = RenderAbaSemanal\.renderAbaSemanal\(/
```

This still matches the new `recalcularSemanal()` body (`document.getElementById('secao-semanal').innerHTML = RenderAbaSemanal.renderAbaSemanal(...)`), so it needs no change — but move it conceptually: this call now lives inside `recalcularSemanal()`, not `montarDashboard()` directly. Update the test's own name/comment to say "recalcularSemanal" instead of "montarDashboard" so the assertion's description matches reality (the assertion itself, a regex over the whole script text, still passes either way).

In `test/semanal-render-aba-balanco-wireup.test.js`, the existing test's expected value:

```js
const esperado = renderAbaBalanco(registros, indicesTodos, {
  periodo: 'mesVigente', base: 'previsto', dimensao: 'financeiro', somenteAtivos: true,
  vigenteIdx, baseline: [],
});
```

needs no change — with no filter interaction, `indicesFiltrados` over all-empty Sets still returns every index, so `indicesTodos` (computed the same way the test always has, `registros.map((_, i) => i)`) is still the right expected value.

- [ ] **Step 3: Add a filtered-behavior test to `test/semanal-render-semanal-wireup.test.js`**

Append:

```js
test('filtrar por SUP na barra compartilhada recalcula a aba Semanal só com os registros daquele SUP', async () => {
  const registros = [
    registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000),
    registroSintetico('SUP-0002-24', 'Tomador-Sintetico-Gama', 2000),
  ];
  const geradoEm = new Date('2026-07-01T00:00:00Z'); // vigenteIdx = 6 (julho)
  const html = renderSemanal({ registros, baseline: [], periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });
  const { sandbox, documentoFalso } = montarSandbox(html);

  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  // Simula marcar o checkbox de SUP-0001-24 no painel de filtro-sup --
  // painel já populado (opções vêm dos 2 registros), então o checkbox
  // sintético existe; disparar seu 'change' é o mesmo caminho que um clique
  // real percorreria dentro de montarFiltroMulti.
  const painelSup = documentoFalso.getElementById('filtro-sup-painel');
  const checkboxes = painelSup.querySelectorAll('input[type="checkbox"]');
  const checkboxAlfa = checkboxes.filter((c) => c.value === 'SUP-0001-24')[0];
  assert.ok(checkboxAlfa, 'esperava um checkbox pro SUP-0001-24 no painel montado');
  checkboxAlfa.checked = true;
  checkboxAlfa.listeners.change();

  const vigenteIdx = geradoEm.getUTCMonth();
  const esperado = renderAbaSemanal(registros, [0], ['financeiro'], vigenteIdx); // só o índice 0 (SUP-0001-24)
  const htmlMontado = documentoFalso.getElementById('secao-semanal').innerHTML;
  assert.equal(htmlMontado, esperado, 'depois de filtrar por SUP-0001-24, a Tabela semanal deve recalcular só com esse registro, não os 2');

  // Prova de conteúdo: 4000 ÷ 4 = 1000 por semana (só o SUP-0001-24), não
  // 1500 (que seria 6000 ÷ 4, a soma dos 2 registros sem filtro).
  const mil = (1000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  assert.match(htmlMontado, new RegExp(mil.replace('.', '\\.')));
});
```

- [ ] **Step 4: Add a filtered-behavior test to `test/semanal-render-aba-balanco-wireup.test.js`**

This file's existing sandbox helpers are `extrairBlocos(html)` (splits the `<script>` tags out) and `rodarBlocos(blocos)` (runs them in a `vm.Context`, returns `{ sandbox, documentoFalso }`) — not `montarSandbox` (that name belongs to the sibling file, `semanal-render-semanal-wireup.test.js`). Use this file's own helpers, matching every other test already in it:

```js
test('filtrar por tipologia na barra compartilhada faz a aba Balanço de massa mostrar só os gráficos das tipologias marcadas', async () => {
  const registros = [
    registroSintetico('SUP-0010-24', 'Tomador-Sintetico-Um', TIPOLOGIA_SINTETICA, 4000, 1000, 2, 5),
    registroSintetico('SUP-0011-24', 'Tomador-Sintetico-Dois', 'OUTRA-TIPOLOGIA', 3000, 3000, 2, 2),
  ];
  const geradoEm = new Date('2026-07-01T00:00:00Z');
  const html = renderSemanal({ registros, baseline: [], periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });

  const blocos = extrairBlocos(html);
  const { sandbox, documentoFalso } = rodarBlocos(blocos);

  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  const painelTipologia = documentoFalso.getElementById('filtro-tipologia-painel');
  const checkboxes = painelTipologia.querySelectorAll('input[type="checkbox"]');
  const checkboxSintetica = checkboxes.filter((c) => c.value === TIPOLOGIA_SINTETICA)[0];
  assert.ok(checkboxSintetica, 'esperava um checkbox pra ' + TIPOLOGIA_SINTETICA + ' no painel montado');
  checkboxSintetica.checked = true;
  checkboxSintetica.listeners.change();

  const htmlMontado = documentoFalso.getElementById('secao-balanco').innerHTML;
  assert.match(htmlMontado, new RegExp(TIPOLOGIA_SINTETICA), 'o gráfico da tipologia marcada deve continuar aparecendo');
  assert.doesNotMatch(htmlMontado, /OUTRA-TIPOLOGIA/, 'a tipologia não marcada não deve aparecer -- prova que a aba Balanço recebeu o indices já filtrado, não todos os registros');
});
```

- [ ] **Step 5: Extend the S1..S4 invariant under an active filter**

Append to `test/semanal-render-semanal-wireup.test.js`:

```js
test('a soma S1+S2+S3+S4 do Previsto continua batendo com o mês vigente mesmo com um filtro de recorte ativo, não só sem filtro', async () => {
  const registros = [
    registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000),
    registroSintetico('SUP-0002-24', 'Tomador-Sintetico-Gama', 2000),
  ];
  const geradoEm = new Date('2026-07-01T00:00:00Z');
  const html = renderSemanal({ registros, baseline: [], periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });
  const { sandbox, documentoFalso } = montarSandbox(html);

  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  const painelSup = documentoFalso.getElementById('filtro-sup-painel');
  const checkboxAlfa = painelSup.querySelectorAll('input[type="checkbox"]').filter((c) => c.value === 'SUP-0001-24')[0];
  checkboxAlfa.checked = true;
  checkboxAlfa.listeners.change();

  const htmlMontado = documentoFalso.getElementById('secao-semanal').innerHTML;
  const numeros = (htmlMontado.match(/<td class="num">([\d.,]+)<\/td>/g) || [])
    .map((td) => td.match(/>([\d.,]+)</)[1])
    .map((n) => Number(n.replace(/\./g, '').replace(',', '.')));
  // As 4 primeiras células numéricas da linha Previsto: S1..S4. Cada uma
  // deve ser 1000 (4000 ÷ 4, só o SUP-0001-24 depois do filtro), e a soma
  // das 4 deve bater com o 4000 do mês vigente filtrado -- não com os 6000
  // de antes do filtro.
  const s1a_s4 = numeros.slice(0, 4);
  assert.deepStrictEqual(s1a_s4, [1000, 1000, 1000, 1000]);
  assert.strictEqual(s1a_s4.reduce((a, b) => a + b, 0), 4000);
});
```

- [ ] **Step 6: Run the full suite**

Run: `node --test test/*.test.js`
Expected: PASS, every test — including `test/semanal-build-dashboard.test.js` and `test/semanal-linha-base-costura.test.js` (fixed in Steps 1b-1d, closing the gap Task 1 accidentally left open), Task 1's own test file, Task 2's now-fixed wire-up tests, and this task's new filtered-behavior/invariant tests.

- [ ] **Step 7: Commit**

```bash
git add test/semanal-render-semanal-wireup.test.js test/semanal-render-aba-balanco-wireup.test.js test/semanal-build-dashboard.test.js test/semanal-linha-base-costura.test.js
git commit -m "$(cat <<'EOF'
Atualizar os testes de wire-up da semanal para a barra de filtros

Fake DOM ganha querySelector/querySelectorAll com síntese de checkbox
(mesmo padrão de test/comum-filtros-wireup.test.js), os testes "sem
filtro" passam a cobrir o novo formato de array de dimensões, e dois
casos novos provam filtro ativo de ponta a ponta: SUP recalculando só
a Tabela semanal, tipologia escondendo o gráfico da aba Balanço não
marcada. Estende também o invariante S1..S4 pra rodar sob filtro.

Também fecha 2 regressões que a Task 1 (mudança de assinatura de
renderAbaSemanal) deixou passar sem querer, achadas só na revisão da
Task 2: uma chamada com string antiga em semanal-build-dashboard.test.js
e o mesmo gap de DOM fake (sem querySelector) em
semanal-linha-base-costura.test.js.
EOF
)"
```
