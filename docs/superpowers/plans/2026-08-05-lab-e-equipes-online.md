# Lab e Equipes Online Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the online-fetch pattern already proven with Avanços to three more
data sources: Lab Realizado (replaces local "Lab Concluido"), Equipes produtivas
(replaces the Δ equipes source for the Balanço de massa), and Equipes não produtivas
(a new, separate informational breakdown).

**Architecture:** Two new CDP-scraped sources (Lab, one whole-month table fetch;
Equipes produtivas, one whole-month date-range table fetch) reuse a new generic
DataTable-reading capability added to `tools/semanal/cdp-client.js`. Equipes não
produtivas needs no new fetch — it's computed from the EQ tab data the build already
fetches today (`buscarEspelhoEq`). Both new fetch scripts publish a CSV the build and
the live-refresh button both consume, same pattern as `atualizar-avancos-online.js`.

**Tech Stack:** Node.js, no npm dependencies, CDP over raw WebSocket (already built
in this project's `cdp-client.js`, extended here — not copied from elsewhere), Google
Chrome with `--remote-debugging-port=9222`.

## Global Constraints

- No npm dependencies.
- `parse-lab.js` MAY be modified (unlike `parse-avancos.js`, which stays untouched) —
  only the column-name lookup for the date field changes (`'Concluído Dia'` →
  `'Ensaiado Dia'`); the rest of its logic, and the internal field name
  `ensaios[].concluido`, do not change.
- `classificar-dia-equipe.js`, `parseAbaEq`, `tools/comum/tipologias-lab.js`,
  `tools/comum/tipologias-avancos.js`, `compute-demandas.js`, `compute-balanco.js`,
  `compute-semanal.js` are NOT modified.
- Equipes produtivas becomes the PRIMARY source for `demandas.equipesPorDia`; the
  existing fallback chain (ativas via EQ tab → mobilizadas via furos) becomes the
  reserve, unchanged in its own logic — only the priority order gains a new first
  link.
- Equipes não produtivas is a NEW, SEPARATE field in the data passed to the client —
  never summed into `equipesPorDia` or any existing series.
- Design spec: `docs/superpowers/specs/2026-08-05-lab-e-equipes-online-design.md`.
- Real per-contract endpoint enumeration is NOT needed for this plan's two new fetches
  (both are whole-month/whole-company single fetches, unlike Avanços).
- Confirmed live 2026-08-05: `campo/fotos` table needs the same `page.len(-1)` /
  wait-for-stable-`recordsTotal` technique as other DataTable pages on this site — a
  premature check reads `recordsTotal: 0`.

---

### Task 1: `rasparTabelaDataTable` + `linhasComoObjetos` in `cdp-client.js`

**Files:**
- Modify: `tools/semanal/cdp-client.js`

**Interfaces:**
- Produces: `rasparTabelaDataTable(session, selector: string, opts?: {timeoutMs?: number}): Promise<{headers: string[], rows: string[][]}>`,
  `linhasComoObjetos({headers, rows}): Array<Record<string,string>>` — used by Tasks 3
  and 5.

No automated test (pure I/O, same rationale as the rest of this file) — verified by
a live manual smoke test.

- [ ] **Step 1: Add both functions**

Append to `tools/semanal/cdp-client.js`, before the final `module.exports`:

```js
// Le uma tabela renderizada por jQuery DataTables, forcando ela a mostrar
// TODAS as linhas antes de ler -- as tabelas de sond.com.br as vezes paginam
// so visualmente (dados ja carregados no client, DOM so com a pagina atual
// ate pedir page.len(-1)). Confirmado ao vivo em campo/fotos: uma leitura
// sem esperar o DataTable estabilizar acha recordsTotal 0.
async function rasparTabelaDataTable(session, selector, { timeoutMs = 30000 } = {}) {
  const rawData = await session.evaluate(`
    (async () => {
      const deadline = Date.now() + ${timeoutMs};
      const sel = ${JSON.stringify(selector)};

      function apiPronta() {
        return window.jQuery && window.jQuery.fn && window.jQuery.fn.DataTable &&
          window.jQuery.fn.DataTable.isDataTable(sel);
      }

      while (!apiPronta() && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 300));
      }
      if (!apiPronta()) {
        return JSON.stringify({ __error__: 'DataTable nao inicializou: ' + sel });
      }

      const api = window.jQuery(sel).DataTable();
      let anterior = -1;
      let estavel = 0;
      while (Date.now() < deadline) {
        const total = api.page.info().recordsTotal;
        if (total === anterior) {
          estavel++;
          if (estavel >= 2) break;
        } else {
          estavel = 0;
        }
        anterior = total;
        await new Promise((r) => setTimeout(r, 200));
      }

      api.page.len(-1).draw('page');
      await new Promise((r) => setTimeout(r, 500));

      const table = document.querySelector(sel);
      const headers = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent.trim());
      const rows = Array.from(table.querySelectorAll('tbody tr'))
        .map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent.trim()))
        .filter((cols) => cols.length === headers.length);

      return JSON.stringify({ headers, rows });
    })()
  `, timeoutMs + 10000);

  const parsed = JSON.parse(rawData);
  if (parsed.__error__) throw new Error(parsed.__error__);
  return parsed;
}

// Converte {headers, rows} em objetos {header: valor}, ignorando colunas
// sem nome (ex.: a coluna de icone de "Acoes" no fim de algumas tabelas).
function linhasComoObjetos({ headers, rows }) {
  return rows.map((cols) => {
    const obj = {};
    headers.forEach((h, i) => {
      if (h) obj[h] = cols[i];
    });
    return obj;
  });
}
```

Update the export line:

```js
module.exports = { abrirSessao, fecharSessao, checarConexao, fetchJson, fetchBuffer, rasparTabelaDataTable, linhasComoObjetos };
```

- [ ] **Step 2: Live smoke test**

With Chrome open at the debug port (already confirmed live and logged in):

```bash
node -e "
const cdp = require('./tools/semanal/cdp-client.js');
(async () => {
  await cdp.checarConexao();
  const { session, target } = await cdp.abrirSessao('https://sond.com.br/campo/fotos/de/2026-08-01/ate/2026-08-01/tabela/1/');
  const tabela = await cdp.rasparTabelaDataTable(session, '#table');
  console.log('linhas:', tabela.rows.length, '- headers:', tabela.headers);
  await cdp.fecharSessao(session, target);
})().catch((e) => { console.error(e); process.exit(1); });
"
```

Expected: prints a `linhas:` count matching what a normal browser tab shows for that
same URL (per the design doc, ~1900 for 2026-08-01) and the 11 headers listed in the
design spec.

- [ ] **Step 3: Commit**

```bash
git add tools/semanal/cdp-client.js
git commit -m "Add generic DataTable scraping to cdp-client.js"
```

---

### Task 2: Lab Realizado — column rename + fetch script

**Files:**
- Modify: `tools/semanal/parse-lab.js`
- Create: `tools/semanal/atualizar-lab-online.js`

**Interfaces:**
- Consumes: `rasparTabelaDataTable`, `linhasComoObjetos` (Task 1).
- Produces: no new exported interface from `parse-lab.js` (same `parseLab`,
  `locateColunasLab` signatures) — used by Task 3.

- [ ] **Step 1: Rename the date column lookup in `parse-lab.js`**

Find:

```js
const COLUNAS_OBRIGATORIAS = {
  sup: 'ID Contrato',
  concluidoDia: 'Concluído Dia',
  tipoEnsaio: 'Tipo de Ensaio',
};
```

Replace with:

```js
// 2026-08-05: a fonte trocou de "Lab Concluido" (arquivo local, coluna
// "Concluído Dia") para o extrato online "ensaios realizados" (coluna
// "Ensaiado Dia") -- ver docs/superpowers/specs/2026-08-05-lab-e-equipes-online-design.md.
// O campo interno continua `concluidoDia`/`ensaios[].concluido` (não
// renomeado) porque quem consome (compute-demandas.js) já trata essa data
// como "sondagemRealizada", que é exatamente o que "Ensaiado Dia" significa
// -- a troca de coluna alinha o dado com o nome que o código já usava.
const COLUNAS_OBRIGATORIAS = {
  sup: 'ID Contrato',
  concluidoDia: 'Ensaiado Dia',
  tipoEnsaio: 'Tipo de Ensaio',
};
```

- [ ] **Step 2: Run the existing test suite for this file**

Run: `node --test test/*.test.js 2>&1 | grep -i "lab"`

Expected: any test exercising `parse-lab.js` with SYNTHETIC fixtures (not real-data
tests) must already use header rows containing whichever column name they construct
themselves — check if any existing synthetic test fixture hardcodes `'Concluído Dia'`
as a literal header string. If so, update that fixture's header to `'Ensaiado Dia'`
so it keeps testing real parsing behavior (not a stale column name). The real-data
test `test/semanal-parse-lab-planilha-real.test.js` reads the LOCAL `Avanço Sond.xlsx`
file directly (untouched, still has `'Concluído Dia'`) — do NOT change that test, it's
intentionally still validating the old local file's format, which this task does not
touch.

- [ ] **Step 3: Create `tools/semanal/atualizar-lab-online.js`**

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { gridParaCsv } = require('./csv-writer-avancos.js');
const { locateColunasLab } = require('./parse-lab.js');
const cdp = require('./cdp-client.js');

const SITE_ORIGIN = 'https://sond.com.br';
const OUT_PATH = path.join(__dirname, '..', '..', 'dist', 'lab-online.csv');

function mesAnoDeHoje() {
  const hoje = new Date();
  return { mes: String(hoje.getMonth() + 1).padStart(2, '0'), ano: String(hoje.getFullYear()) };
}

async function main() {
  console.log('Checando conexao com o Chrome (CDP)...');
  await cdp.checarConexao();

  const { mes, ano } = mesAnoDeHoje();
  const url = `${SITE_ORIGIN}/extrato-ensaios-realizados/mes/${mes}/ano/${ano}/`;
  console.log(`Buscando ${url}...`);

  const { session, target } = await cdp.abrirSessao(url);
  try {
    const tabela = await cdp.rasparTabelaDataTable(session, '.producao-grid');
    console.log(`${tabela.rows.length} linha(s) de ensaio lidas.`);

    if (!tabela.rows.length) {
      throw new Error('Nenhuma linha encontrada -- abortando sem gravar (sessao expirada, ou mes sem ensaio ainda?).');
    }

    // Valida que o cabeçalho ainda tem as colunas obrigatórias ANTES de
    // gravar -- mesmo raciocínio de atualizar-avancos-online.js: protege o
    // CSV bom já publicado de ser sobrescrito por um que não dá pra ler.
    locateColunasLab([undefined, tabela.headers]);

    const grid = [tabela.headers, ...tabela.rows];
    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, gridParaCsv(grid), 'utf8');
    console.log(`Pronto: ${tabela.rows.length} ensaio(s) gravado(s) em ${OUT_PATH}.`);
  } finally {
    await cdp.fecharSessao(session, target);
  }
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { main, mesAnoDeHoje };
```

Note: `locateColunasLab` expects a 2-row-indexed grid (`grid[1]` is the header, per
`parse-lab.js`'s own convention inherited from the xlsx-reader's row-1-indexed
format) — passing `[undefined, tabela.headers]` satisfies that without needing any
change to `locateColunasLab` itself.

- [ ] **Step 4: Live smoke test**

```bash
node tools/semanal/atualizar-lab-online.js
```

Expected: prints a row count and `Pronto:` line, creates `dist/lab-online.csv`. Spot
check: `head -1 dist/lab-online.csv` shows the header including `Ensaiado Dia`,
`ID Contrato`, `Tipo de Ensaio`.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/parse-lab.js tools/semanal/atualizar-lab-online.js
git commit -m "Add online fetch script for Lab Realizado, retarget parse-lab.js to Ensaiado Dia"
```

(Do not commit `dist/lab-online.csv` yet — a later publish task handles that.)

---

### Task 3: Wire Lab into the build and the live-refresh button

**Files:**
- Modify: `tools/semanal/build-dashboard.js`
- Modify: `tools/semanal/render-semanal.js`

- [ ] **Step 1: Replace the Lab read step in `build-dashboard.js`**

Find:

```js
  let gridLab;
  try {
    gridLab = readXlsxSheet(configLab.caminhoArquivo, configLab.nomeAba);
  } catch (err) {
    throw new Error(`Não consegui ler a aba "${configLab.nomeAba}" de ${configLab.caminhoArquivo} (o Google Drive está montado em G:?). Erro original: ${err.message}`);
  }
```

Replace with:

```js
  // Fonte online (2026-08-05): substitui a aba "Lab Concluido" local por um
  // CSV de ensaios REALIZADOS, gerado por tools/semanal/atualizar-lab-online.js
  // (roda à parte, não a cada build). Mesmo unshift(null) de Avanços -- ver
  // docs/superpowers/specs/2026-08-05-lab-e-equipes-online-design.md.
  const CAMINHO_LAB_ONLINE = path.join(__dirname, '..', '..', 'dist', 'lab-online.csv');
  let gridLab;
  try {
    const csvTexto = fs.readFileSync(CAMINHO_LAB_ONLINE, 'utf8');
    gridLab = parseCsvGrid(csvTexto);
    gridLab.unshift(null);
  } catch (err) {
    throw new Error(
      `Não consegui ler ${CAMINHO_LAB_ONLINE}. Rode "node tools/semanal/atualizar-lab-online.js" ` +
      `primeiro (precisa do Chrome aberto com --remote-debugging-port=9222, logado em sond.com.br). ` +
      `Erro original: ${err.message}`
    );
  }
```

`parseCsvGrid` is already imported in this file from Task 4 of the Avanços plan
(`const { parseCsvGrid } = require('./parse-matriz-cliente.js');`) — confirm it's
still there, do not add a duplicate import.

The `configLab`/`config-lab.js` require at the top of the file becomes unused by this
change — remove the `const configLab = require('./config-lab.js');` line (this file
itself, `tools/semanal/config-lab.js`, can stay in the repo unused, or be deleted in
Task 6 alongside the CLAUDE.md cleanup — your call, not required here).

- [ ] **Step 2: Point the live-refresh button at the new file**

In `tools/semanal/render-semanal.js`, find:

```js
var URL_ESPELHO_LAB_SEMANAL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vS_Lmfr3EG4OwDb8xlc7670XrCXd2VL9vAiCjHeh8sxpLGFHNf_WgbXMGFe33XIKTXxTkaFXo8ls2eR/pub?gid=213649864&single=true&output=csv';
```

Replace with:

```js
// 2026-08-05: trocado do espelho da Sheet (Apps Script) pro CSV publicado
// junto com a própria página -- mesmo padrão de URL_ESPELHO_AVANCOS_SEMANAL.
// Ver docs/superpowers/specs/2026-08-05-lab-e-equipes-online-design.md.
var URL_ESPELHO_LAB_SEMANAL = 'lab-online.csv';
```

- [ ] **Step 3: Run the full test suite**

Run: `node --test test/*.test.js`
Expected: no new failures beyond the already-documented pre-existing `*-planilha-real.test.js`
ones (unrelated, real G:\ data drift). Check specifically that no test asserts on the
literal old `URL_ESPELHO_LAB_SEMANAL` value the way Task 5 of the Avanços plan already
confirmed for `URL_ESPELHO_AVANCOS_SEMANAL` (tests override it with test-scoped values)
— if you find one that does assert on the literal default, update it the same way.

- [ ] **Step 4: Commit**

```bash
git add tools/semanal/build-dashboard.js tools/semanal/render-semanal.js
git commit -m "Wire Lab Realizado into the build and the Atualizar-dados button"
```

---

### Task 4: Equipes produtivas — pure aggregation + fetch script

**Files:**
- Create: `tools/semanal/compute-equipes-produtivas.js`
- Create: `tools/semanal/atualizar-equipes-produtivas-online.js`
- Test: `test/semanal-compute-equipes-produtivas.test.js`

**Interfaces:**
- Consumes: `rasparTabelaDataTable`, `linhasComoObjetos` (Task 1).
- Produces: `agregarEquipesProdutivas({linhas, tipologiaPorSondador, rotularTipologia?}): {porDia: Record<string, Record<number,number>>, semTipologia: number}`
  — used by Task 6. `porDia` keyed `"${sup}||${tipologia}"`, inner key a
  day-since-epoch integer, value a count — SAME shape `agregarEquipesAtivas` already
  produces, so it can plug into the same downstream slot.

- [ ] **Step 1: Write the failing test**

Create `test/semanal-compute-equipes-produtivas.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { agregarEquipesProdutivas } = require('../tools/semanal/compute-equipes-produtivas.js');

// Linhas modeladas a partir da tabela real de campo/fotos (capturada ao
// vivo em 2026-08-05) -- só os campos que a função lê.
const LINHAS_FIXTURE = [
  { 'Contrato Financeiro': 'SUP-7722-24', Data: '01/08/2026', Sondador: 'Evamar Fernandes de Macedo' },
  { 'Contrato Financeiro': 'SUP-7722-24', Data: '01/08/2026', Sondador: 'Evamar Fernandes de Macedo' }, // 2ª foto, mesmo dia/sondador -- não duplica
  { 'Contrato Financeiro': 'SUP-7722-24', Data: '01/08/2026', Sondador: 'Filipe Cosme Araujo Cunha' },
  { 'Contrato Financeiro': 'SUP-7722-24', Data: '02/08/2026', Sondador: 'Evamar Fernandes de Macedo' },
];

const TIPOLOGIA_POR_SONDADOR = {
  'Evamar Fernandes de Macedo': 'SP',
  'Filipe Cosme Araujo Cunha': 'SP',
};

test('agregarEquipesProdutivas conta Sondador distinto por dia e por (SUP, tipologia)', () => {
  const { porDia, semTipologia } = agregarEquipesProdutivas({
    linhas: LINHAS_FIXTURE,
    tipologiaPorSondador: TIPOLOGIA_POR_SONDADOR,
  });
  const chave = 'SUP-7722-24||SP';
  assert.ok(porDia[chave], 'chave SUP-7722-24||SP deveria existir');
  // 01/08/2026 -> dia-desde-epoca
  const dia1 = Math.floor(Date.UTC(2026, 7, 1) / 86400000);
  const dia2 = Math.floor(Date.UTC(2026, 7, 2) / 86400000);
  assert.equal(porDia[chave][dia1], 2, '01/08: Evamar + Filipe, sem duplicar Evamar (2 fotos)');
  assert.equal(porDia[chave][dia2], 1, '02/08: só Evamar');
  assert.equal(semTipologia, 0);
});

test('agregarEquipesProdutivas conta em semTipologia quando o sondador não tem tipologia conhecida', () => {
  const { porDia, semTipologia } = agregarEquipesProdutivas({
    linhas: [{ 'Contrato Financeiro': 'SUP-1', Data: '01/08/2026', Sondador: 'Alguem Desconhecido' }],
    tipologiaPorSondador: {},
  });
  assert.deepEqual(porDia, {});
  assert.equal(semTipologia, 1);
});

test('agregarEquipesProdutivas ignora linhas sem contrato, sem data ou sem sondador', () => {
  const { porDia, semTipologia } = agregarEquipesProdutivas({
    linhas: [
      { 'Contrato Financeiro': '', Data: '01/08/2026', Sondador: 'Alguem' },
      { 'Contrato Financeiro': 'SUP-1', Data: '', Sondador: 'Alguem' },
      { 'Contrato Financeiro': 'SUP-1', Data: '01/08/2026', Sondador: '' },
    ],
    tipologiaPorSondador: { Alguem: 'SP' },
  });
  assert.deepEqual(porDia, {});
  assert.equal(semTipologia, 0);
});

test('agregarEquipesProdutivas aplica rotularTipologia quando fornecida', () => {
  const { porDia } = agregarEquipesProdutivas({
    linhas: [{ 'Contrato Financeiro': 'SUP-1', Data: '01/08/2026', Sondador: 'Alguem' }],
    tipologiaPorSondador: { Alguem: 'SM' },
    rotularTipologia: (t) => (t === 'SM' ? 'SM / SM.F / SR' : t),
  });
  const dia1 = Math.floor(Date.UTC(2026, 7, 1) / 86400000);
  assert.equal(porDia['SUP-1||SM / SM.F / SR'][dia1], 1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/semanal-compute-equipes-produtivas.test.js`
Expected: FAIL — `Cannot find module '../tools/semanal/compute-equipes-produtivas.js'`

- [ ] **Step 3: Implement `tools/semanal/compute-equipes-produtivas.js`**

```js
'use strict';

// EQUIPES PRODUTIVAS a partir de campo/fotos (2026-08-05)
// ============================================================================
// Fonte: sond.com.br/campo/fotos/de/{inicio}/ate/{fim}/tabela/1/ -- uma linha
// por FOTO (não por sondagem: várias fotos por furo por dia são normais).
// "Equipe produtiva num dia" = Sondador distinto naquele dia, por Contrato
// Financeiro. A tabela não tem coluna Tipo -- quem chama injeta
// tipologiaPorSondador (mesmo mapa que build-dashboard.js já calcula pra
// equipes ativas, a partir da tipologia mais frequente nos furos do
// sondador).
//
// Mesmo formato de saída (porDia) que compute-equipes-ativas.js já produz,
// pra plugar no mesmo lugar em build-dashboard.js.

const RE_DATA_BR = /^(\d{2})\/(\d{2})\/(\d{4})$/;

function diaEpochDeTextoBr(texto) {
  const m = RE_DATA_BR.exec(String(texto || '').trim());
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const ano = Number(m[3]);
  return Math.floor(Date.UTC(ano, mes - 1, dia) / 86400000);
}

function agregarEquipesProdutivas(opcoes) {
  const o = opcoes || {};
  const linhas = o.linhas || [];
  const tipologiaPorSondador = o.tipologiaPorSondador || {};
  const rotular = o.rotularTipologia || ((t) => t);

  // contrato -> diaEpoch -> Set(sondador)
  const sondadoresPorContratoDia = new Map();
  let semTipologia = 0;

  for (const linha of linhas) {
    const contrato = String(linha['Contrato Financeiro'] || '').trim();
    const sondador = String(linha['Sondador'] || '').trim();
    const diaEpoch = diaEpochDeTextoBr(linha['Data']);
    if (!contrato || !sondador || diaEpoch === null) continue;

    const tipologiaCrua = tipologiaPorSondador[sondador];
    if (!tipologiaCrua) { semTipologia++; continue; }
    let tipologia;
    try { tipologia = rotular(tipologiaCrua); } catch { tipologia = null; }
    if (!tipologia) { semTipologia++; continue; }

    const chaveContrato = `${contrato}||${tipologia}||${diaEpoch}`;
    if (!sondadoresPorContratoDia.has(chaveContrato)) sondadoresPorContratoDia.set(chaveContrato, new Set());
    sondadoresPorContratoDia.get(chaveContrato).add(sondador);
  }

  const porDia = {};
  for (const [chaveContrato, sondadores] of sondadoresPorContratoDia) {
    const [contrato, tipologia, diaEpochTexto] = chaveContrato.split('||');
    const chave = `${contrato}||${tipologia}`;
    const diaEpoch = Number(diaEpochTexto);
    if (!porDia[chave]) porDia[chave] = {};
    porDia[chave][diaEpoch] = sondadores.size;
  }

  return { porDia, semTipologia };
}

module.exports = { agregarEquipesProdutivas, diaEpochDeTextoBr };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/semanal-compute-equipes-produtivas.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Create `tools/semanal/atualizar-equipes-produtivas-online.js`**

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { gridParaCsv } = require('./csv-writer-avancos.js');
const cdp = require('./cdp-client.js');

const SITE_ORIGIN = 'https://sond.com.br';
const OUT_PATH = path.join(__dirname, '..', '..', 'dist', 'equipes-produtivas-online.csv');

function primeiroEUltimoDiaDoMes(data) {
  const ano = data.getFullYear();
  const mes = data.getMonth();
  const primeiro = new Date(ano, mes, 1);
  const ultimo = new Date(ano, mes + 1, 0);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { de: fmt(primeiro), ate: fmt(ultimo) };
}

async function main() {
  console.log('Checando conexao com o Chrome (CDP)...');
  await cdp.checarConexao();

  const { de, ate } = primeiroEUltimoDiaDoMes(new Date());
  const url = `${SITE_ORIGIN}/campo/fotos/de/${de}/ate/${ate}/tabela/1/`;
  console.log(`Buscando ${url}...`);

  const { session, target } = await cdp.abrirSessao(url);
  try {
    const tabela = await cdp.rasparTabelaDataTable(session, '#table', { timeoutMs: 45000 });
    console.log(`${tabela.rows.length} linha(s) de foto lidas.`);

    if (!tabela.rows.length) {
      throw new Error('Nenhuma linha encontrada -- abortando sem gravar (sessao expirada, ou mes sem foto ainda?).');
    }
    if (!tabela.headers.includes('Contrato Financeiro') || !tabela.headers.includes('Sondador') || !tabela.headers.includes('Data')) {
      throw new Error(`Cabeçalho inesperado (sem Contrato Financeiro/Sondador/Data): ${tabela.headers.join(', ')} -- abortando sem gravar.`);
    }

    const grid = [tabela.headers, ...tabela.rows];
    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, gridParaCsv(grid), 'utf8');
    console.log(`Pronto: ${tabela.rows.length} linha(s) gravada(s) em ${OUT_PATH}.`);
  } finally {
    await cdp.fecharSessao(session, target);
  }
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { main, primeiroEUltimoDiaDoMes };
```

- [ ] **Step 6: Live smoke test**

```bash
node tools/semanal/atualizar-equipes-produtivas-online.js
```

Expected: prints a row count and `Pronto:` line, creates `dist/equipes-produtivas-online.csv`.
This fetches the WHOLE current month (could be tens of thousands of rows, per the
design doc's measured ~1900/day) — let it finish, it may take a minute or two.

- [ ] **Step 7: Commit**

```bash
git add tools/semanal/compute-equipes-produtivas.js tools/semanal/atualizar-equipes-produtivas-online.js test/semanal-compute-equipes-produtivas.test.js
git commit -m "Add equipes-produtivas collector and fetch script (campo/fotos)"
```

---

### Task 5: Equipes não produtivas — pure aggregation (no new fetch)

**Files:**
- Create: `tools/semanal/compute-equipes-nao-produtivas.js`
- Test: `test/semanal-compute-equipes-nao-produtivas.test.js`

**Interfaces:**
- Consumes: the `equipes` shape `parseAbaEq` already produces (Task 1 of the
  Equipes-ativas design — `[{id, nome, servicos, dias: [{dia, texto}]}]`), and
  `classificarDiaEquipe` from `tools/semanal/classificar-dia-equipe.js` (both
  already exist, unmodified).
- Produces: `agregarEquipesNaoProdutivas({equipes, ano, mes}): {porDiaPorMotivo: Record<number, {campoSemFuro: number, fora: number}>}`
  — used by Task 6. No per-SUP breakdown (an equipe on leave has no contract that
  day) — aggregate count per day, split by the two non-productive reasons.

- [ ] **Step 1: Write the failing test**

Create `test/semanal-compute-equipes-nao-produtivas.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { agregarEquipesNaoProdutivas } = require('../tools/semanal/compute-equipes-nao-produtivas.js');

test('agregarEquipesNaoProdutivas conta campoSemFuro e fora por dia, separados', () => {
  const equipes = [
    { id: '1', nome: 'A', servicos: 'SM', dias: [
      { dia: 1, texto: 'Mobilização' },       // campoSemFuro
      { dia: 2, texto: 'Férias' },             // fora
    ] },
    { id: '2', nome: 'B', servicos: 'SP', dias: [
      { dia: 1, texto: 'baixada' },            // fora
      { dia: 2, texto: 'Veículo quebrou' },    // campoSemFuro
    ] },
  ];
  const { porDiaPorMotivo } = agregarEquipesNaoProdutivas({ equipes, ano: 2026, mes: 8 });
  const dia1 = Math.floor(Date.UTC(2026, 7, 1) / 86400000);
  const dia2 = Math.floor(Date.UTC(2026, 7, 2) / 86400000);
  assert.deepEqual(porDiaPorMotivo[dia1], { campoSemFuro: 1, fora: 1 });
  assert.deepEqual(porDiaPorMotivo[dia2], { campoSemFuro: 1, fora: 1 });
});

test('agregarEquipesNaoProdutivas ignora mobilizada (produtiva) e naoEquipe', () => {
  const equipes = [
    { id: '1', nome: 'A', servicos: 'SM', dias: [
      { dia: 1, texto: 'OK' },                       // mobilizada -- fora do escopo desta função
      { dia: 2, texto: 'Assumir equipe' },           // naoEquipe -- nunca conta
    ] },
  ];
  const { porDiaPorMotivo } = agregarEquipesNaoProdutivas({ equipes, ano: 2026, mes: 8 });
  assert.deepEqual(porDiaPorMotivo, {});
});

test('agregarEquipesNaoProdutivas ignora célula vazia (dia não preenchido ainda)', () => {
  const equipes = [{ id: '1', nome: 'A', servicos: 'SM', dias: [{ dia: 1, texto: '' }] }];
  const { porDiaPorMotivo } = agregarEquipesNaoProdutivas({ equipes, ano: 2026, mes: 8 });
  assert.deepEqual(porDiaPorMotivo, {});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/semanal-compute-equipes-nao-produtivas.test.js`
Expected: FAIL — `Cannot find module '../tools/semanal/compute-equipes-nao-produtivas.js'`

- [ ] **Step 3: Implement `tools/semanal/compute-equipes-nao-produtivas.js`**

```js
'use strict';
const { classificarDiaEquipe } = require('./classificar-dia-equipe.js');

// EQUIPES NÃO PRODUTIVAS (2026-08-05)
// ============================================================================
// Mesma fonte que equipes ativas (aba EQ, via parseAbaEq -- já buscada hoje
// pelo build, nenhuma busca nova aqui). "Não produtiva" = campoSemFuro (em
// campo, sem furo aquele dia) OU fora (férias/baixada/afastada/desligada) --
// os dois estados que classificar-dia-equipe.js já reconhece.
// mobilizada (produtiva) e naoEquipe (não é equipe de campo) ficam de fora.
//
// Sem quebra por (SUP, tipologia): uma equipe de férias não tem contrato
// associado naquele dia -- só o total por dia, separado por motivo.

function agregarEquipesNaoProdutivas(opcoes) {
  const o = opcoes || {};
  const equipes = o.equipes || [];
  const ano = o.ano;
  const mes = o.mes;

  const porDiaPorMotivo = {};

  equipes.forEach((equipe) => {
    (equipe.dias || []).forEach((d) => {
      const classe = classificarDiaEquipe(d.texto);
      if (!classe) return;
      if (classe.estado !== 'campoSemFuro' && classe.estado !== 'fora') return;

      const diaEpoch = Math.floor(Date.UTC(ano, mes - 1, d.dia) / 86400000);
      if (!porDiaPorMotivo[diaEpoch]) porDiaPorMotivo[diaEpoch] = { campoSemFuro: 0, fora: 0 };
      porDiaPorMotivo[diaEpoch][classe.estado] += 1;
    });
  });

  return { porDiaPorMotivo };
}

module.exports = { agregarEquipesNaoProdutivas };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/semanal-compute-equipes-nao-produtivas.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/compute-equipes-nao-produtivas.js test/semanal-compute-equipes-nao-produtivas.test.js
git commit -m "Add equipes-nao-produtivas aggregation (no new fetch, reuses EQ tab data)"
```

---

### Task 6: Wire both equipes sources into the build, the button, and the Balanço tab

**Files:**
- Modify: `tools/semanal/build-dashboard.js`
- Modify: `tools/semanal/render-semanal.js`
- Modify: `tools/semanal/render-aba-balanco.js`

- [ ] **Step 1: Add produtivas/não-produtivas to `build-dashboard.js`**

Add near the other `require`s at the top:

```js
const { agregarEquipesProdutivas } = require('./compute-equipes-produtivas.js');
const { agregarEquipesNaoProdutivas } = require('./compute-equipes-nao-produtivas.js');
```

Find `montarEquipesAtivas` (the function that currently produces the "ativas"
fallback layer) and, in `build()`, right after the existing call to
`Object.assign(demandas, montarEquipesAtivas(furos, equipesAtivasCsv));`, add:

```js
  // Fonte online (2026-08-05): equipes produtivas (campo/fotos) vira a
  // PRIMEIRA prioridade pro Δ equipes -- ativas (aba EQ, acima) e mobilizadas
  // (furos) continuam como reserva se o CSV novo não existir/estiver vazio.
  // Ver docs/superpowers/specs/2026-08-05-lab-e-equipes-online-design.md.
  const CAMINHO_EQUIPES_PRODUTIVAS = path.join(__dirname, '..', '..', 'dist', 'equipes-produtivas-online.csv');
  if (fs.existsSync(CAMINHO_EQUIPES_PRODUTIVAS)) {
    try {
      const csvProdutivas = fs.readFileSync(CAMINHO_EQUIPES_PRODUTIVAS, 'utf8');
      const gridProdutivas = parseCsvGrid(csvProdutivas);
      const cabecalho = gridProdutivas[0] || [];
      const linhasProdutivas = gridProdutivas.slice(1).map((linha) => {
        const obj = {};
        cabecalho.forEach((h, i) => { if (h) obj[h] = linha[i]; });
        return obj;
      });
      const { porDia: porDiaProdutivas, semTipologia: semTipologiaProdutivas } = agregarEquipesProdutivas({
        linhas: linhasProdutivas,
        tipologiaPorSondador,
        rotularTipologia,
      });
      if (Object.keys(porDiaProdutivas).length) {
        demandas.equipesPorDia = porDiaProdutivas;
        console.log(`Equipes produtivas: fonte online em uso (${semTipologiaProdutivas} equipe-dia sem tipologia conhecida, fora da conta).`);
      } else {
        console.warn('Equipes produtivas: CSV existe mas não produziu nenhum dia utilizável -- mantendo a fonte de reserva (ativas/mobilizadas).');
      }
    } catch (err) {
      console.warn(`Equipes produtivas: falha ao ler ${CAMINHO_EQUIPES_PRODUTIVAS} (${err.message}) -- mantendo a fonte de reserva.`);
    }
  } else {
    console.warn(`Equipes produtivas: ${CAMINHO_EQUIPES_PRODUTIVAS} não existe -- rode "node tools/semanal/atualizar-equipes-produtivas-online.js". Mantendo a fonte de reserva (ativas/mobilizadas).`);
  }

  // Equipes NÃO produtivas -- informação separada, nunca somada em
  // equipesPorDia. Mesma fonte (aba EQ) que "ativas" já usa acima, sem busca
  // nova -- só roda se a Sheet espelho respondeu (mesmo `equipesAtivasCsv`).
  let equipesNaoProdutivas = null;
  if (equipesAtivasCsv) {
    const periodoEq = mesDaAbaEq(equipesAtivasCsv);
    if (periodoEq) {
      const equipesEq = parseAbaEq(equipesAtivasCsv);
      equipesNaoProdutivas = agregarEquipesNaoProdutivas({ equipes: equipesEq, ano: periodoEq.ano, mes: periodoEq.mes }).porDiaPorMotivo;
    }
  }
```

Note: `tipologiaPorSondador`, `rotularTipologia`, `parseAbaEq`, `mesDaAbaEq`, `path`,
`fs`, `parseCsvGrid` are all already in scope in this file by this point in the
plan (from earlier tasks in this plan and the Avanços plan) — do not re-declare them.

Pass `equipesNaoProdutivas` through to `renderSemanal(...)`'s options object (find
the call and add `equipesNaoProdutivas,` alongside the existing `demandas, periodos,`
etc.).

- [ ] **Step 2: Add the third live-refresh fetch in `render-semanal.js`**

Find `URL_ESPELHO_LAB_SEMANAL` (already updated in Task 3) and add a sibling constant
right after it:

```js
// 2026-08-05: equipes produtivas, mesmo padrão de publicação relativa.
var URL_ESPELHO_EQUIPES_PRODUTIVAS_SEMANAL = 'equipes-produtivas-online.csv';
```

In `atualizarDadosAoVivoSemanal`, find the `Promise.all([...])` block that fetches
`URL_ESPELHO_MATRIZ_SEMANAL`/`URL_ESPELHO_AVANCOS_SEMANAL`/`URL_ESPELHO_LAB_SEMANAL`/`URL_ESPELHO_EQ_SEMANAL`
and add a fifth entry fetching `URL_ESPELHO_EQUIPES_PRODUTIVAS_SEMANAL`, gated the
same way the Avanços/Lab pair already is (`avancosLabConfigurados` — reuse that same
flag, since equipes-produtivas is meaningless without Avanços/Lab already being live
data too, given it also depends on `tipologiaPorSondador` derived from furos). After
all fetches resolve, parse the new CSV the same way `gridCsvComoXlsx` is NOT needed
here (this isn't fed through `parseAvancos` — it goes straight into
`agregarEquipesProdutivas`, which takes plain row objects) — build row objects via
`parseCsvGrid` + zip against its own header row (mirror the loop already written in
Task 6 Step 1 for the Node side), call `agregarEquipesProdutivas`, and if it produces
any `porDia` entries, overwrite `demandasNovas.equipesPorDia` with it (same "last one
wins, and it's the best one" pattern the build uses). If the fetch fails or produces
nothing, silently keep whatever `demandasNovas.equipesPorDia` already was set to by
the ativas/mobilizadas fallback earlier in the same function — do not throw, this
fetch is allowed to degrade gracefully like the EQ one already does.

- [ ] **Step 3: Show "equipes não produtivas" in the Balanço de massa tab**

In `tools/semanal/render-aba-balanco.js`, find where the Δ equipes bar/section is
rendered (search for `equipesPorDia` or the existing Δ-equipes heading). Add a small
new block right after it, only rendered when `equipesNaoProdutivas` (passed through
from the options object, same threading as `demandas`) has at least one day of data:
show the MOST RECENT day present in `equipesNaoProdutivas` as two numbers with
labels — "Em campo sem furo: N" and "Férias/baixada/afastada/desligada: N". If
`equipesNaoProdutivas` is `null` or empty, render nothing extra (no placeholder, no
"sem dado" — this is optional supplementary info, not a tracked metric like the Δ bar
itself). Keep this minimal — a small `<div>`/paragraph is enough, not a new
sub-table; this can be refined later if the user wants more from it.

- [ ] **Step 4: Run the full test suite**

Run: `node --test test/*.test.js`
Expected: no new failures beyond the pre-existing, documented, unrelated
`*-planilha-real.test.js` ones.

- [ ] **Step 5: Real build verification**

With Chrome open, logged in, and both `dist/lab-online.csv` (Task 2) and
`dist/equipes-produtivas-online.csv` (Task 4) present and reasonably fresh (re-run
either fetch script if they're more than a few hours old):

```bash
ORCAMENTO_SENHA='<senha real>' node tools/semanal/build-dashboard.js
```

Expected: build completes, and the log includes a line confirming "Equipes
produtivas: fonte online em uso" (not a fallback warning) — if it falls back, check
that both CSVs exist and re-run the fetch scripts. Note the `furos.length`/Demandas
numbers — Lab's swap doesn't affect these, just confirm the build doesn't error.

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/build-dashboard.js tools/semanal/render-semanal.js tools/semanal/render-aba-balanco.js
git commit -m "Wire equipes produtivas/nao-produtivas into build, live-refresh button, and Balanco tab"
```

---

### Task 7: Publish, clean up, update docs, live verify

**Files:**
- Modify: `CLAUDE.md`
- Create/update: `dist/lab-online.csv`, `docs/lab-online.csv`,
  `dist/equipes-produtivas-online.csv`, `docs/equipes-produtivas-online.csv`,
  `dist/planejamento-semanal.html`, `docs/planejamento-semanal.html`
- Modify: `test/publicacao-docs-sincronizado.test.js`

- [ ] **Step 1: Re-run both fetch scripts fresh (if needed) and rebuild for real**

```bash
node tools/semanal/atualizar-lab-online.js
node tools/semanal/atualizar-equipes-produtivas-online.js
ORCAMENTO_SENHA='<senha real>' node tools/semanal/build-dashboard.js
cp dist/planejamento-semanal.html docs/planejamento-semanal.html
cp dist/lab-online.csv docs/lab-online.csv
cp dist/equipes-produtivas-online.csv docs/equipes-produtivas-online.csv
```

- [ ] **Step 2: Add both new CSV pairs to the publish-sync test**

In `test/publicacao-docs-sincronizado.test.js`, add `dist/lab-online.csv` ↔
`docs/lab-online.csv` and `dist/equipes-produtivas-online.csv` ↔
`docs/equipes-produtivas-online.csv` to the existing pair list (same mechanism
already extended once for `avancos-online.csv` in the prior plan — follow that exact
precedent, three total non-HTML pairs now).

Run: `node --test test/publicacao-docs-sincronizado.test.js` — expect all pairs to
pass (they will, since Step 1 just synced them).

- [ ] **Step 3: Verify the live-refresh button locally, in a real browser**

Same technique as the Avanços plan's Task 6: serve `docs/` locally, open
`planejamento-semanal.html`, unlock with the real password, click "Atualizar dados",
confirm no error status, and check the Balanço de massa tab shows the new "equipes
não produtivas" line with real numbers (not blank/error).

- [ ] **Step 4: Update `CLAUDE.md`**

Add a new subsection right after the existing "Avanços online (2026-08-05)" section
(same section this whole feature lives under, "## Planejamento Semanal"):

```markdown
### Lab Realizado + Equipes online (2026-08-05)

Duas fontes a mais migraram do arquivo/Sheet local pro sond.com.br direto, mesmo
padrão de Avanços. Ver
`docs/superpowers/specs/2026-08-05-lab-e-equipes-online-design.md`.

- **Lab Realizado** substitui a aba "Lab Concluido" -- conta agora por "Ensaiado Dia",
  não "Concluído Dia" (mudança de semântica deliberada, ver o spec).
- **Equipes produtivas** (Sondador distinto por dia, via `campo/fotos`) virou a fonte
  PRINCIPAL do Δ equipes do Balanço de massa -- ativas (aba EQ)/mobilizadas (furos)
  continuam de reserva se o CSV novo faltar.
- **Equipes não produtivas** é informação nova e separada (aba Balanço de massa,
  perto do Δ equipes) -- não some com produtivas. Não precisa de busca nova: usa os
  mesmos dados da aba EQ que "ativas" já buscava.

**Atualizar:**

```bash
node tools/semanal/atualizar-lab-online.js
node tools/semanal/atualizar-equipes-produtivas-online.js
```

Mesmo requisito de Chrome com `--remote-debugging-port=9222` logado em sond.com.br
que Avanços já documenta acima. **Sempre** `cp` os dois CSVs novos pra `docs/` junto
com o HTML, mesma regra de sempre.

**Limpeza pendente no Google (fora deste repositório):** com Lab também migrado, o
gatilho do Apps Script que ainda espelhava "Avanços" + "Lab Concluido" fica **sem
nenhum consumidor neste projeto**. Se ainda estiver rodando na conta Google dona da
Sheet, pode ser desligado de vez.
```

- [ ] **Step 5: Commit and push**

```bash
git add CLAUDE.md docs/planejamento-semanal.html docs/lab-online.csv docs/equipes-produtivas-online.csv dist/planejamento-semanal.html dist/lab-online.csv dist/equipes-produtivas-online.csv test/publicacao-docs-sincronizado.test.js
git commit -m "Publish Lab Realizado + Equipes produtivas/nao-produtivas online, document setup"
git push
```

- [ ] **Step 6: Verify the live site**

```bash
sleep 30
curl -sI https://amcaccere261283.github.io/orcamento-dashboard/planejamento-semanal.html | head -3
curl -sI https://amcaccere261283.github.io/orcamento-dashboard/lab-online.csv | head -3
curl -sI https://amcaccere261283.github.io/orcamento-dashboard/equipes-produtivas-online.csv | head -3
```

Expected: all `HTTP/2 200`. Open the live URL, unlock, confirm the Balanço tab shows
non-produtivas info and the numbers look sane against what the local verification in
Step 3 already showed.
