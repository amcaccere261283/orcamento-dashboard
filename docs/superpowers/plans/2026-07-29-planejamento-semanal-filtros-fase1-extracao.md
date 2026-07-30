# Fase 2 (filtros) — Plano 1: extrair a lógica de filtros para `tools/comum/render-shell.js` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the filter *interaction logic* (state shape, `indicesFiltrados`, `montarFiltroMulti`'s checkbox wiring, `opcoesFiltro`) out of `tools/orcamento/render-dashboard.js` and into `tools/comum/render-shell.js`, so the Planejamento Semanal page (Plan 2, separate) can reuse it instead of duplicating it.

**Architecture:** Today this logic is literal client-side JS *text* embedded inside the giant `SCRIPT_CLIENTE_TABELA` template literal in `render-dashboard.js` — it only runs in the browser, never at build time. This plan cuts a coherent chunk of that text out into a new exported function `scriptFiltros()` in `render-shell.js` (same pattern as the existing `scriptDesbloqueio()`), generalizing two things in the process: `estado` (the `chave -> Set` filter state object) becomes a mandatory parameter instead of defaulting to orçamento's global `filtrosSelecionados`, and `montarFiltroMulti`'s hardcoded tail (`recalcularTabela(); recalcularAlertas();` plus the categoria→tipologia cascade and the dimensão→corpo-tabela rebuild) becomes a caller-supplied `aoMudar(cfg)` callback. `render-dashboard.js` then calls the shared functions, passing its own `filtrosSelecionados`/`filtrosAlertas` and a callback that reproduces today's exact tail behavior.

**Tech Stack:** Plain Node.js (`node:test`, `node:vm`, `node:assert`), no external dependencies (this repo has no `package.json`). Client-side code is ES5-style (`var`/`function`, no arrow functions) because it also runs unmodified in older browsers and is written directly as template-literal text.

## Global Constraints

- No new npm dependencies — this repo has no `package.json`; everything runs on Node's built-in `node:test`/`node:vm`/`node:crypto`.
- Client-side JS in `render-shell.js` and `render-dashboard.js` must stay ES5-style (`var`, `function`, no arrow functions, no `const`/`let`) — it runs as literal browser script text.
- Never write the real `ORCAMENTO_SENHA` anywhere in source, tests, or fixtures — tests use the fake password constant already defined in `test/helpers/golden-orcamento.js` (`SENHA_FIXA = 'golden-fake'`).
- This plan does **not** touch `tools/semanal/*` at all — wiring the semanal page's filters is Plan 2, written and reviewed only after this plan's golden-regeneration step is reviewed and merged.
- The existing test `os registros cifrados... continuam os mesmos do golden` (in `test/orcamento-html-inalterado.test.js`) must keep passing unmodified — it proves the encrypted data payload itself never changes, independent of the JS-wiring refactor in this plan.

---

### Task 1: Add the shared filter primitives to `tools/comum/render-shell.js`

**Files:**
- Modify: `tools/comum/render-shell.js`
- Test: `test/comum-render-shell.test.js`

**Interfaces:**
- Produces: `scriptFiltros()` — a new exported function returning a client-JS string. Defines (as global `function`/`var` declarations, when the returned string runs in a browser): `escapeHtml(value)`, `TIPOLOGIAS_SONDAGEM_ESPECIAL`, `categoriaTipologia(tipologia)`, `linhasDistintas(registros, campo)`, `capitalizarPalavras(texto)`, `opcoesFiltro(cfg, registros, estado)`, `atualizarRotuloFiltro(cfg, opcoes, estado)`, `normalizarBusca(texto)`, `aplicarSelecaoExclusiva(estadoSet, valor)`, `filtroExclui(filtro, valor)`, `indicesFiltrados(registros, filtroTipologia, filtroCategoria, filtroGrupo, filtroSup, filtroOrigem)`, `montarFiltroMulti(cfg, registros, estado, aoMudar)`, `configurarAberturaFiltrosMulti()`.
- `montarFiltroMulti`'s `aoMudar` parameter: a `function(cfg)` the caller supplies, invoked once per checkbox change (after the Set/label update, after any `exclusivo` remount), with the `cfg` object of whichever filter changed. It is how each page decides what to recalculate.

- [ ] **Step 1: Add `scriptFiltros()` to `tools/comum/render-shell.js`**

Insert this new code block right before the final `module.exports = {...}` (currently at line 453 of `tools/comum/render-shell.js`):

```js
// Lógica de interação dos filtros multi-select (Set de valores selecionados
// por campo, indicesFiltrados, montarFiltroMulti). Extraída de
// tools/orcamento/render-dashboard.js na Fase 2 do Planejamento Semanal (ver
// docs/superpowers/specs/2026-07-29-planejamento-semanal-filtros-design.md)
// -- markupFiltros()/markupFiltroMulti() (acima) só geram o esqueleto HTML
// vazio; isto aqui é o que liga os checkboxes de verdade.
//
// Generalizado na extração (por isso o HTML do orçamento deixou de ser
// byte-a-byte idêntico ao golden anterior -- o golden foi regenerado de
// propósito, com o diff revisado linha a linha, ver
// test/orcamento-html-inalterado.test.js):
//   - `estado` (chave -> Set de valores marcados) é sempre parâmetro
//     explícito agora, nunca cai de volta pra um global fixo -- cada página
//     tem o seu (filtrosSelecionados/filtrosAlertas no orçamento).
//   - montarFiltroMulti ganhou `aoMudar(cfg)`, chamado no fim de toda
//     mudança de checkbox -- antes disso ficar recalcularTabela() e
//     recalcularAlertas() hardcoded, o que impedia qualquer outra página de
//     reusar a função (ela não tem Tabela nem Alertas).
const SCRIPT_CLIENTE_FILTROS = `
function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

var TIPOLOGIAS_SONDAGEM_ESPECIAL = { CPTU: true, BL: true, SH: true, VT: true };
function categoriaTipologia(tipologia) {
  var key = String(tipologia || '').trim().toUpperCase();
  if (key === 'LAB.C') return 'labConvencional';
  if (key === 'LAB.E') return 'labEspecial';
  if (TIPOLOGIAS_SONDAGEM_ESPECIAL[key]) return 'sondagemEspecial';
  return 'sondagemConvencional';
}

function linhasDistintas(registros, campo) {
  var vistos = {};
  var resultado = [];
  registros.forEach(function (r) {
    var v = r[campo];
    if (v && !vistos[v]) { vistos[v] = true; resultado.push(v); }
  });
  resultado.sort();
  return resultado;
}

function capitalizarPalavras(texto) {
  return (texto || '').toString().toLowerCase().split(' ').map(function (palavra) {
    return palavra ? palavra.charAt(0).toUpperCase() + palavra.slice(1) : palavra;
  }).join(' ');
}

// cfg.chave === 'tipologia' com estado.categoria não-vazio: cascata em
// relação à Categoria, listando só as tipologias que pertencem à(s)
// categoria(s) marcada(s). Só se aplica se a página tiver os dois campos
// (categoria e tipologia) na mesma config -- senão estado.categoria é
// undefined e o \`&&\` curto-circuita antes de acessar .size.
function opcoesFiltro(cfg, registros, estado) {
  if (cfg.opcoesFixas) return cfg.opcoesFixas;

  if (cfg.chave === 'tipologia' && estado.categoria && estado.categoria.size > 0) {
    var tipologiasDaCategoria = linhasDistintas(registros, 'tipologia').filter(function (t) {
      return estado.categoria.has(categoriaTipologia(t));
    });
    return tipologiasDaCategoria.map(function (v) { return { valor: v, rotulo: v }; });
  }

  if (cfg.rotuloComposto) {
    var vistoSup = {};
    var opcoes = [];
    registros.forEach(function (r) {
      if (!r[cfg.campo] || vistoSup[r[cfg.campo]]) return;
      vistoSup[r[cfg.campo]] = true;
      var partes = [r.tomador, r.escopo].filter(Boolean).join(' / ');
      opcoes.push({ valor: r[cfg.campo], rotulo: partes ? r[cfg.campo] + ' — ' + partes : r[cfg.campo] });
    });
    opcoes.sort(function (a, b) { return a.valor < b.valor ? -1 : a.valor > b.valor ? 1 : 0; });
    return opcoes;
  }

  if (cfg.rotuloCapitalizado) {
    return linhasDistintas(registros, cfg.campo).map(function (v) { return { valor: v, rotulo: capitalizarPalavras(v) }; });
  }

  return linhasDistintas(registros, cfg.campo).map(function (v) { return { valor: v, rotulo: v }; });
}

function atualizarRotuloFiltro(cfg, opcoes, estado) {
  var trigger = document.querySelector('#' + cfg.id + ' .filtro-multi-trigger');
  var seta = trigger.querySelector('.filtro-multi-seta');
  var selecionados = estado[cfg.chave];
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

function normalizarBusca(texto) {
  var normalizado = (texto || '').toString().toLowerCase().normalize('NFD');
  var resultado = '';
  for (var i = 0; i < normalizado.length; i++) {
    var codigo = normalizado.charCodeAt(i);
    if (codigo < 768 || codigo > 879) resultado += normalizado[i];
  }
  return resultado;
}

function aplicarSelecaoExclusiva(estadoSet, valor) {
  estadoSet.clear();
  estadoSet.add(valor);
}

function filtroExclui(filtro, valor) {
  return !!(filtro && filtro.size > 0 && !filtro.has(valor));
}

function indicesFiltrados(registros, filtroTipologia, filtroCategoria, filtroGrupo, filtroSup, filtroOrigem) {
  var indices = [];
  registros.forEach(function (registro, indice) {
    if (filtroExclui(filtroTipologia, registro.tipologia)) return;
    if (filtroExclui(filtroCategoria, categoriaTipologia(registro.tipologia))) return;
    if (filtroExclui(filtroGrupo, registro.grupo)) return;
    if (filtroExclui(filtroSup, registro.sup)) return;
    if (filtroExclui(filtroOrigem, registro.origem)) return;
    indices.push(indice);
  });
  return indices;
}

// aoMudar(cfg): chamado 1x por mudança de checkbox, depois do Set/rótulo já
// atualizados (e depois do remount de exclusivo, se for o caso) -- é onde a
// página decide o que recalcular. estado é sempre obrigatório (chave ->
// Set); cada página passa o seu (não existe mais fallback pra um global).
function montarFiltroMulti(cfg, registros, estado, aoMudar) {
  var opcoes = opcoesFiltro(cfg, registros, estado);
  var valoresValidos = {};
  opcoes.forEach(function (o) { valoresValidos[o.valor] = true; });
  estado[cfg.chave].forEach(function (v) {
    if (!valoresValidos[v]) estado[cfg.chave].delete(v);
  });

  var painel = document.querySelector('#' + cfg.id + ' .filtro-multi-painel');
  var listaHtml = opcoes.length
    ? opcoes.map(function (o) {
        var marcado = estado[cfg.chave].has(o.valor) ? ' checked' : '';
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
      if ((cfg.minimoUm || cfg.exclusivo) && !checkbox.checked && estado[cfg.chave].size === 1) {
        checkbox.checked = true;
        return;
      }
      if (checkbox.checked) {
        if (cfg.exclusivo) aplicarSelecaoExclusiva(estado[cfg.chave], checkbox.value);
        else estado[cfg.chave].add(checkbox.value);
      } else {
        estado[cfg.chave].delete(checkbox.value);
      }
      atualizarRotuloFiltro(cfg, opcoes, estado);
      if (cfg.exclusivo) montarFiltroMulti(cfg, registros, estado, aoMudar);
      aoMudar(cfg);
    });
  });
  atualizarRotuloFiltro(cfg, opcoes, estado);
}

function configurarAberturaFiltrosMulti() {
  document.querySelectorAll('.filtro-multi-trigger').forEach(function (trigger) {
    trigger.addEventListener('click', function (evento) {
      evento.stopPropagation();
      var container = trigger.closest('.filtro-multi');
      var jaAberto = container.classList.contains('aberto');
      document.querySelectorAll('.filtro-multi.aberto').forEach(function (el) {
        el.classList.remove('aberto');
        el.querySelector('.filtro-multi-painel').hidden = true;
      });
      if (!jaAberto) {
        container.classList.add('aberto');
        var painelAberto = container.querySelector('.filtro-multi-painel');
        painelAberto.hidden = false;
        var buscaAberto = painelAberto.querySelector('.filtro-multi-busca');
        if (buscaAberto) {
          buscaAberto.value = '';
          painelAberto.querySelectorAll('.filtro-multi-item').forEach(function (item) { item.style.display = ''; });
          var vazioBusca = painelAberto.querySelector('.filtro-multi-vazio-busca');
          if (vazioBusca) vazioBusca.hidden = true;
          buscaAberto.focus();
        }
      }
    });
  });
  document.querySelectorAll('.filtro-multi-painel').forEach(function (painel) {
    painel.addEventListener('click', function (evento) { evento.stopPropagation(); });
  });
  document.addEventListener('click', function () {
    document.querySelectorAll('.filtro-multi.aberto').forEach(function (el) {
      el.classList.remove('aberto');
      el.querySelector('.filtro-multi-painel').hidden = true;
    });
  });
}
`;

// O JS de cliente da lógica de filtros -- ver o comentário grande acima de
// SCRIPT_CLIENTE_FILTROS. Depende de a página já ter as <div class="filtro-multi">
// no HTML (markupFiltros, acima, já cuida disso) e de rodar ANTES de
// qualquer script que CHAME montarFiltroMulti/indicesFiltrados/etc.
function scriptFiltros() {
  return SCRIPT_CLIENTE_FILTROS;
}
```

- [ ] **Step 2: Export `scriptFiltros` from `tools/comum/render-shell.js`**

Modify the `module.exports` block (currently lines 453-459):

```js
module.exports = {
  cssBase,
  markupCabecalho,
  markupFiltros,
  markupAbas,
  scriptDesbloqueio,
  scriptFiltros,
};
```

- [ ] **Step 3: Add static tests for `scriptFiltros()` to `test/comum-render-shell.test.js`**

Append to the end of `test/comum-render-shell.test.js` (update the `require` at line 4 to also destructure `scriptFiltros`):

```js
test('scriptFiltros traz todas as primitivas de filtro esperadas, como declarações globais', () => {
  const js = scriptFiltros();
  for (const nome of [
    'escapeHtml', 'categoriaTipologia', 'linhasDistintas', 'capitalizarPalavras',
    'opcoesFiltro', 'atualizarRotuloFiltro', 'normalizarBusca', 'aplicarSelecaoExclusiva',
    'filtroExclui', 'indicesFiltrados', 'montarFiltroMulti', 'configurarAberturaFiltrosMulti',
  ]) {
    assert.match(js, new RegExp('function ' + nome + '\\('));
  }
});

test('scriptFiltros não vaza senha nem dado identificador', () => {
  const js = scriptFiltros();
  assert.doesNotMatch(js, /senha\s*=\s*['"][^'"]/);
  assert.doesNotMatch(js, /SUP-/);
});

test('montarFiltroMulti recebe estado e aoMudar como parâmetros explícitos -- sem fallback pra nenhum global fixo (é o que permite reusar entre páginas com estados diferentes)', () => {
  const js = scriptFiltros();
  assert.match(js, /function montarFiltroMulti\(cfg, registros, estado, aoMudar\)/);
  assert.doesNotMatch(js, /estado \|\| filtrosSelecionados/);
});
```

- [ ] **Step 4: Run the new tests**

Run: `node --test test/comum-render-shell.test.js`
Expected: all tests PASS, including the 3 new ones.

- [ ] **Step 5: Commit**

```bash
git add tools/comum/render-shell.js test/comum-render-shell.test.js
git commit -m "$(cat <<'EOF'
Adicionar scriptFiltros() à casca compartilhada

Extrai o esqueleto das primitivas de filtro (estado, indicesFiltrados,
montarFiltroMulti) pra tools/comum/render-shell.js, generalizado com
`estado` e `aoMudar` explícitos -- ainda não consumido por
render-dashboard.js (próxima tarefa).
EOF
)"
```

---

### Task 2: Prove the shared filter logic actually works — dynamic wire-up test

**Files:**
- Test: `test/comum-filtros-wireup.test.js` (new)

**Interfaces:**
- Consumes: `scriptFiltros()` from Task 1.
- Produces: nothing new for later tasks — this is a leaf verification task, but it's the only place `montarFiltroMulti`/`configurarAberturaFiltrosMulti`/`opcoesFiltro`'s cascade branch/`aoMudar` get exercised dynamically (no existing test does; the pre-extraction code never had a dynamic test for these either — only the pure functions `indicesFiltrados`/`categoriaTipologia`/`aplicarSelecaoExclusiva` are covered today, in `test/orcamento-render-dashboard.test.js`, and that coverage keeps working unmodified after Task 3, since those functions' bodies don't change).

- [ ] **Step 1: Write a minimal fake DOM supporting exactly what `montarFiltroMulti`/`configurarAberturaFiltrosMulti` call**

Create `test/comum-filtros-wireup.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { scriptFiltros } = require('../tools/comum/render-shell.js');

// DOM mínimo o bastante pra montarFiltroMulti/configurarAberturaFiltrosMulti
// rodarem de ponta a ponta -- só os métodos que elas de fato chamam (mesma
// convenção de criarLinhaFake em test/orcamento-render-dashboard.test.js e
// criarDocumentoFalso em test/semanal-render-semanal-wireup.test.js).
// `buscar`/`buscarTodos` precisam existir ANTES de criarElemento pra ele
// poder fechar sobre elas (querySelector/querySelectorAll de um elemento
// devolvem outros elementos do mesmo registro) -- por isso as duas famílias
// de função vivem juntas dentro de criarSandboxDom, não em módulo separado.
function criarSandboxDom() {
  const registrados = {};

  function criarElemento(seletor) {
    const classes = new Set();
    const listeners = {};
    const el = {
      seletor,
      hidden: false,
      value: '',
      textContent: '',
      innerHTML: '',
      style: {},
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
      },
      listeners,
      addEventListener(tipo, fn) { listeners[tipo] = fn; },
      focus() {},
      appendChild() {},
      querySelector: buscar,
      querySelectorAll: buscarTodos,
      closest: () => el,
    };
    return el;
  }

  function buscar(sel) {
    if (!registrados[sel]) registrados[sel] = criarElemento(sel);
    return registrados[sel];
  }

  // Só é chamada pra '.filtro-multi-item'/'.filtro-multi-busca' (dentro de
  // um painel, populados só como texto em innerHTML, nunca como elementos
  // reais neste fake) e '.filtro-multi-trigger'/'.filtro-multi.aberto'
  // (globais) -- sempre vazio de propósito: nenhum teste deste arquivo
  // depende de encontrar outros filtros/itens já abertos ou renderizados.
  function buscarTodos() {
    return [];
  }

  const documentoFalso = {
    getElementById: buscar,
    querySelector: buscar,
    querySelectorAll: buscarTodos,
    addEventListener() {},
  };
  return { documentoFalso, buscar };
}

// vm.createContext realms do NOT inherit host globals like Set/Array
// automatically -- montarFiltroMulti/opcoesFiltro call Set methods
// (.has/.add/.delete/.size) on whatever `estado` the test constructs, so
// those Set instances must come from INSIDE this same realm (sandbox.Set),
// not the host Node process's Set.
function montarSandbox() {
  const { documentoFalso, buscar } = criarSandboxDom();
  const sandbox = { document: documentoFalso, console, Set, Array, String, Math };
  vm.createContext(sandbox);
  vm.runInContext(scriptFiltros(), sandbox, { filename: 'filtros-cliente.js' });
  return { sandbox, buscar };
}
```

- [ ] **Step 2: Test that `montarFiltroMulti` populates the panel, marks pre-selected values, and does NOT call `aoMudar` on initial mount**

Append to the same file:

```js
test('montarFiltroMulti monta as opções, marca as já selecionadas, e NÃO chama aoMudar na montagem inicial (só numa mudança real de checkbox)', () => {
  const { sandbox, buscar } = montarSandbox();
  const registros = [{ tipologia: 'SM' }, { tipologia: 'ST' }];
  const cfg = { id: 'filtro-tipologia', chave: 'tipologia', rotuloPadrao: 'Todas', campo: 'tipologia' };
  const estado = { tipologia: new sandbox.Set(['SM']) };
  const chamadas = [];

  sandbox.montarFiltroMulti(cfg, registros, estado, function (cfgMudado) { chamadas.push(cfgMudado.chave); });

  const painel = buscar('#filtro-tipologia .filtro-multi-painel');
  assert.match(painel.innerHTML, /value="SM" checked/);
  assert.match(painel.innerHTML, /value="ST">/);
  assert.equal(chamadas.length, 0, 'aoMudar só deve rodar numa mudança real de checkbox, nunca na montagem/remontagem');
});
```

- [ ] **Step 3: Run it**

Run: `node --test test/comum-filtros-wireup.test.js`
Expected: PASS (1 test so far).

- [ ] **Step 4: Add the remaining 3 tests — estado mutation, categoria cascade, indicesFiltrados/categoriaTipologia parity**

This fake DOM's `innerHTML` is a plain string (no real parsing), so a checkbox `change` listener attached via `painel.querySelectorAll('input[type="checkbox"]')` never gets a real element to attach to. Rather than simulate a DOM click, prove `montarFiltroMulti` reads live `estado` by mutating the Set and remounting — exactly what the real `change` handler does right before it calls `aoMudar`. Append to the same file:

```js
test('estado (Set) mutation between two montarFiltroMulti calls is reflected in the panel -- proves montarFiltroMulti reads current estado, not a stale snapshot', () => {
  const { sandbox, buscar } = montarSandbox();
  const registros = [{ tipologia: 'SM' }, { tipologia: 'ST' }];
  const cfg = { id: 'filtro-tipologia', chave: 'tipologia', rotuloPadrao: 'Todas', campo: 'tipologia' };
  const estado = { tipologia: new sandbox.Set() };

  sandbox.montarFiltroMulti(cfg, registros, estado, function () {});
  assert.doesNotMatch(buscar('#filtro-tipologia .filtro-multi-painel').innerHTML, /checked/);

  estado.tipologia.add('ST');
  sandbox.montarFiltroMulti(cfg, registros, estado, function () {});
  assert.match(buscar('#filtro-tipologia .filtro-multi-painel').innerHTML, /value="ST" checked/);
});

test('opcoesFiltro cascades tipologia options to only those in the selected categoria(s)', () => {
  const { sandbox } = montarSandbox();
  const registros = [{ tipologia: 'SP' }, { tipologia: 'LAB.C' }, { tipologia: 'CPTu' }];
  const cfgTipologia = { chave: 'tipologia', campo: 'tipologia' };
  const estadoSemCategoria = { categoria: new sandbox.Set(), tipologia: new sandbox.Set() };
  const todas = sandbox.opcoesFiltro(cfgTipologia, registros, estadoSemCategoria).map((o) => o.valor);
  assert.deepEqual(todas.sort(), ['CPTu', 'LAB.C', 'SP']);

  const estadoComCategoria = { categoria: new sandbox.Set(['labConvencional']), tipologia: new sandbox.Set() };
  const soLab = sandbox.opcoesFiltro(cfgTipologia, registros, estadoComCategoria).map((o) => o.valor);
  assert.deepEqual(soLab, ['LAB.C']);
});

test('indicesFiltrados and categoriaTipologia are present and behave exactly as before the extraction', () => {
  const { sandbox } = montarSandbox();
  const registros = [
    { tipologia: 'SM', grupo: 'PÁTRIA', sup: 'SUP-A', origem: 'X' },
    { tipologia: 'ST', grupo: 'SYSTRA', sup: 'SUP-B', origem: 'Y' },
  ];
  const vazio = new sandbox.Set();
  assert.deepEqual(sandbox.indicesFiltrados(registros, vazio, vazio, vazio, vazio, vazio), [0, 1]);
  assert.deepEqual(sandbox.indicesFiltrados(registros, new sandbox.Set(['SM']), vazio, vazio, vazio, vazio), [0]);
  assert.equal(sandbox.categoriaTipologia('LAB.E'), 'labEspecial');
});
```

- [ ] **Step 5: Run the final test file**

Run: `node --test test/comum-filtros-wireup.test.js`
Expected: PASS, 4 tests (montagem+aoMudar-not-called-on-mount, estado mutation reflected, opcoesFiltro cascade, indicesFiltrados/categoriaTipologia parity).

- [ ] **Step 6: Commit**

```bash
git add test/comum-filtros-wireup.test.js
git commit -m "$(cat <<'EOF'
Testar dinamicamente as primitivas de filtro compartilhadas

Prova, via vm.Context com um DOM mínimo, que montarFiltroMulti/
opcoesFiltro/indicesFiltrados se comportam como antes da extração --
cobertura que não existia (os testes de render-dashboard.test.js só
provam as funções puras, nunca montarFiltroMulti em si).
EOF
)"
```

---

### Task 3: Rewire `tools/orcamento/render-dashboard.js` to consume the shared logic

**Files:**
- Modify: `tools/orcamento/render-dashboard.js:4-7` (import), `tools/orcamento/render-dashboard.js:44-47` (remove the now-redundant client-side `escapeHtml`), `tools/orcamento/render-dashboard.js:482-507` (remove `filtroExclui`/`indicesFiltrados`), `tools/orcamento/render-dashboard.js:1137-1144` (remove `categoriaTipologia`/`TIPOLOGIAS_SONDAGEM_ESPECIAL`), `tools/orcamento/render-dashboard.js:1470-1481` (remove `capitalizarPalavras`), `tools/orcamento/render-dashboard.js:1483-1511` (remove `opcoesFiltro`), `tools/orcamento/render-dashboard.js:1513-1546` (remove `atualizarRotuloFiltro`/`normalizarBusca`), `tools/orcamento/render-dashboard.js:1548-1646` (remove `aplicarSelecaoExclusiva`/`montarFiltroMulti`, keep+modify `montarTodosFiltrosMulti`, add `aoMudarFiltroOrcamento`), `tools/orcamento/render-dashboard.js:1648-1694` (remove `configurarAberturaFiltrosMulti`), `tools/orcamento/render-dashboard.js:1777` (Alertas wiring call site), `tools/orcamento/render-dashboard.js:2184` (script-tag concatenation)

**Interfaces:**
- Consumes: `scriptFiltros` from `tools/comum/render-shell.js` (Task 1) — but only as a *build-time* import to splice its returned string into the HTML; the functions it defines (`montarFiltroMulti`, `indicesFiltrados`, etc.) become available in the *browser* global scope once that script runs, exactly like `scriptDesbloqueio()`'s functions already are.
- Produces: `aoMudarFiltroOrcamento(cfg)` — the client-side callback wired into every `montarFiltroMulti` call in this file, reproducing the exact tail behavior that used to be hardcoded inside `montarFiltroMulti` itself.

- [ ] **Step 1: Add `scriptFiltros` to the import**

Modify `tools/orcamento/render-dashboard.js:4-6`:

```js
const {
  cssBase, markupCabecalho, markupFiltros, markupAbas, scriptDesbloqueio, scriptFiltros,
} = require('../comum/render-shell.js');
```

- [ ] **Step 2: Remove the now-redundant client-side `escapeHtml` at the top of `SCRIPT_CLIENTE_TABELA`**

`SCRIPT_CLIENTE_TABELA` currently opens with its own `escapeHtml`, at lines 44-47:

```js
function escapeHtml(valor) {
  return String(valor === null || valor === undefined ? '' : valor)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
```

`scriptFiltros()` (Task 1) already defines an identical `escapeHtml`, and Step 8 below concatenates `scriptFiltros()` *before* `SCRIPT_CLIENTE_TABELA` in the same `<script>` tag — so by the time this line would run, the function is already defined. Leaving both would be a verbatim duplicate declaration in the shipped page for no reason (unlike `scriptFiltros()` itself, which duplicates `escapeHtml` internally on purpose, so it stays self-contained for a future consumer — the semanal page — that has no `escapeHtml` of its own yet).

Delete lines 44-47 from `tools/orcamento/render-dashboard.js`. The opening `` const SCRIPT_CLIENTE_TABELA = `  `` (line 43) and the blank line + `formatarNumero` comment that follow (currently lines 48-53) stay, now immediately after the backtick.

- [ ] **Step 3: Remove `filtroExclui`/`indicesFiltrados` (now in `scriptFiltros()`)**

Delete lines 482-507 (the comment block + both functions) from `tools/orcamento/render-dashboard.js`. The line before (481, blank) and the line after (509, comment starting "Mesmo cinza claro...") stay.

- [ ] **Step 4: Remove `TIPOLOGIAS_SONDAGEM_ESPECIAL`/`categoriaTipologia`**

Delete lines 1137-1144 from `tools/orcamento/render-dashboard.js` (the `var TIPOLOGIAS_SONDAGEM_ESPECIAL = ...` line through `categoriaTipologia`'s closing `}`). The blank line 1145 and `var SERIE_LABELS = ...` at 1146 stay untouched.

- [ ] **Step 5: Remove `capitalizarPalavras`, `opcoesFiltro`, `atualizarRotuloFiltro`, `normalizarBusca`, `aplicarSelecaoExclusiva`, `montarFiltroMulti`, `configurarAberturaFiltrosMulti`**

Delete lines 1470-1481 (`capitalizarPalavras` comment+function), 1483-1511 (`opcoesFiltro`), 1513-1530 (`atualizarRotuloFiltro`), 1532-1546 (`normalizarBusca` comment+function), 1548-1556 (`aplicarSelecaoExclusiva` comment+function), 1558-1642 (`montarFiltroMulti` comment+function), 1648-1694 (`configurarAberturaFiltrosMulti` comment+function) from `tools/orcamento/render-dashboard.js`.

Leave `FILTROS_CONFIG` (1373-1411), `FILTROS_ALERTAS_CONFIG` (1413-1450), `filtrosAlertas` init (1452-1459), and `filtrosSelecionados` init (1461-1468) exactly as they are — these stay orçamento-specific.

- [ ] **Step 6: Replace `montarTodosFiltrosMulti` and add `aoMudarFiltroOrcamento`**

Where `montarTodosFiltrosMulti` used to be (originally lines 1644-1646), write:

```js
// Reproduz exatamente o que o final de montarFiltroMulti fazia hardcoded
// antes da extração pra tools/comum/render-shell.js: cascata de
// categoria->tipologia, rebuild da estrutura da tabela quando a dimensão
// muda, e recálculo incondicional de Tabela + Alertas. Serve tanto pros
// filtros de recorte (FILTROS_CONFIG) quanto pros da aba Alertas
// (FILTROS_ALERTAS_CONFIG) -- pra estes últimos as duas condições de cima
// nunca batem (nenhum cfg de Alertas tem chave 'categoria' nem id
// 'seletor-dimensao'), então só o recálculo final roda, igual sempre foi.
function aoMudarFiltroOrcamento(cfg) {
  if (cfg.chave === 'categoria') {
    var cfgTipologia = FILTROS_CONFIG.filter(function (c) { return c.chave === 'tipologia'; })[0];
    montarFiltroMulti(cfgTipologia, window.__REGISTROS__, filtrosSelecionados, aoMudarFiltroOrcamento);
  }
  if (cfg.id === 'seletor-dimensao') {
    document.getElementById('corpo-tabela').innerHTML = renderCorpoTabela(window.__REGISTROS__, dimensoesEmOrdem(filtrosSelecionados.dimensao));
  }
  recalcularTabela();
  recalcularAlertas();
}

function montarTodosFiltrosMulti(registros) {
  FILTROS_CONFIG.forEach(function (cfg) { montarFiltroMulti(cfg, registros, filtrosSelecionados, aoMudarFiltroOrcamento); });
}
```

- [ ] **Step 7: Update the Alertas filter wiring call site**

Modify `tools/orcamento/render-dashboard.js:1777` (inside `montarDashboard`), from:

```js
  FILTROS_ALERTAS_CONFIG.forEach(function (cfg) { montarFiltroMulti(cfg, registros, filtrosAlertas); });
```

to:

```js
  FILTROS_ALERTAS_CONFIG.forEach(function (cfg) { montarFiltroMulti(cfg, registros, filtrosAlertas, aoMudarFiltroOrcamento); });
```

- [ ] **Step 8: Splice `scriptFiltros()` into the rendered HTML**

Modify `tools/orcamento/render-dashboard.js:2184`, from:

```js
  <script>${SCRIPT_CLIENTE_TABELA}</script>
```

to:

```js
  <script>${scriptFiltros()}${SCRIPT_CLIENTE_TABELA}</script>
```

- [ ] **Step 9: Run the full existing suite and confirm what passes/fails**

Run: `node --test test/*.test.js`

Expected: every test file passes **except** `test/orcamento-html-inalterado.test.js`, which fails on the byte-identical assertion (`o HTML do orçamento continua byte-idêntico ao golden`) — this is the expected, deliberate failure this plan's Task 4 resolves by regenerating the golden fixture. If any *other* test fails, stop and investigate before continuing (it means the extraction changed real behavior, not just source layout) — the most likely culprits are a typo in one of the deleted line ranges (Steps 2-5) leaving a dangling reference, or a missed `estadoFiltros` → `estado` rename inside a function this plan intended to delete but didn't fully remove.

- [ ] **Step 10: Commit**

```bash
git add tools/orcamento/render-dashboard.js
git commit -m "$(cat <<'EOF'
Consumir a lógica de filtros compartilhada em render-dashboard.js

Remove as definições duplicadas (indicesFiltrados, montarFiltroMulti,
opcoesFiltro, categoriaTipologia, etc.) e passa a usar scriptFiltros()
(tools/comum/render-shell.js), com aoMudarFiltroOrcamento reproduzindo
o comportamento exato que estava hardcoded no fim de montarFiltroMulti.

test/orcamento-html-inalterado.test.js falha agora no assert de
byte-identidade, de propósito -- a próxima tarefa regenera o golden.
EOF
)"
```

---

### Task 4: Regenerate the golden fixture with a reviewed diff, close out the plan

**Files:**
- Modify: `test/fixtures/orcamento-golden.html`
- Modify: `CLAUDE.md` (repo root)

**Interfaces:**
- Consumes: `construirHtmlGolden()`/`normalizarVolatil()` from `test/helpers/golden-orcamento.js` (unchanged).

- [ ] **Step 1: Regenerate the golden fixture**

Run this one-off script to rebuild the fixture (it mirrors exactly what `construirHtmlGolden()` already does — same fixed date/senha/periodos — so the only differences from the old fixture should be the ones this plan intentionally made):

```bash
node -e "
const fs = require('node:fs');
const path = require('node:path');
const { construirHtmlGolden } = require('./test/helpers/golden-orcamento.js');
const dest = path.join('test', 'fixtures', 'orcamento-golden.html');
fs.writeFileSync(dest, construirHtmlGolden());
console.log('regenerated', dest);
"
```

- [ ] **Step 2: Review the diff line-by-line**

Run: `git diff test/fixtures/orcamento-golden.html`

Expected diff content, and nothing else:
- The `window.__DADOS_CIFRADOS__` blob differs (salt/iv are random per build — already true before this plan, unrelated to it).
- Inside the single `<script>` tag that used to hold only `SCRIPT_CLIENTE_TABELA`: the filter-related functions (`escapeHtml`, `categoriaTipologia`, `linhasDistintas`, `capitalizarPalavras`, `opcoesFiltro`, `atualizarRotuloFiltro`, `normalizarBusca`, `aplicarSelecaoExclusiva`, `filtroExclui`, `indicesFiltrados`, `montarFiltroMulti`, `configurarAberturaFiltrosMulti`) now appear **before** the rest of the table/graph/alerts code instead of interleaved with it (and `SCRIPT_CLIENTE_TABELA`'s own former `escapeHtml` is gone — it's the same function, now defined once, earlier); `montarFiltroMulti`'s body ends in `aoMudar(cfg)` instead of the inlined cascade/rebuild/recalculate calls; a new `aoMudarFiltroOrcamento` function appears; `montarTodosFiltrosMulti`'s and the Alertas `forEach`'s `montarFiltroMulti(...)` calls now pass `filtrosSelecionados`/`filtrosAlertas` and `aoMudarFiltroOrcamento` explicitly.
- If the diff shows **anything else** — a changed number, a changed CSS rule, a changed HTML tag outside the `<script>` block, a changed table row — stop; that means Task 3 introduced a real behavior change, not just a reorganization, and must be fixed before regenerating the golden again.

- [ ] **Step 3: Run the full suite again**

Run: `node --test test/*.test.js`
Expected: all tests PASS, including every test in `test/orcamento-html-inalterado.test.js` (the byte-identical assertion now compares against the freshly-reviewed golden).

- [ ] **Step 4: Update `CLAUDE.md`'s Fase 2 pending-items note**

In the repo-root `CLAUDE.md`, under "### Pendências conhecidas" (in the "Planejamento Semanal" section), replace the "**Fase 2 — os filtros.**" paragraph with:

```markdown
**Fase 2 — os filtros: lógica compartilhada extraída, semanal ainda não
consome.** `tools/comum/render-shell.js` agora exporta `scriptFiltros()`
(estado, `indicesFiltrados`, `montarFiltroMulti` com `aoMudar(cfg)`) --
ver docs/superpowers/specs/2026-07-29-planejamento-semanal-filtros-design.md
e docs/superpowers/plans/2026-07-29-planejamento-semanal-filtros-fase1-extracao.md.
O orçamento já consome (comportamento idêntico, golden regenerado de
propósito). A página semanal (aba 1 com a barra completa + seletor de
dimensão, aba 2 só com o filtro de tipologia da mesma barra) ainda não foi
ligada -- é o Plano 2, a escrever separadamente.
```

- [ ] **Step 5: Commit**

```bash
git add test/fixtures/orcamento-golden.html CLAUDE.md
git commit -m "$(cat <<'EOF'
Regenerar o golden do orçamento depois da extração dos filtros

Diff revisado linha a linha: só a reorganização esperada (funções de
filtro reagrupadas, aoMudarFiltroOrcamento novo, chamadas de
montarFiltroMulti com estado/callback explícitos) -- nenhuma mudança
numérica, de CSS ou de HTML fora do <script>.
EOF
)"
```

- [ ] **Step 6: Push, after confirming with the user**

This repo auto-publishes from `master:/docs` — confirm with the user before `git push origin master`, per the project's standing rule (see project memory `colaborador_dashboards_amcaccere`).
