# Equipes Realizado (roster Link 6 + produção Link 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a fonte de "Realizado" de Equipes na Tabela Semanal (`planejamento-semanal.html`) para roster (Link 6) + produção (Link 7), com carry-forward de 45 dias para quem não produziu no dia, com backfill anual dos dois lados.

**Architecture:** Um fetcher (`atualizar-equipes-online.js`) passa a publicar dois CSVs crus (produção por equipe/dia/contrato; roster por equipe/dia/estado). Um módulo de cálculo novo, bundle-safe (roda em Node no build e no navegador no refresh), cruza os dois e produz o mesmo formato `equipesPorDia` que já existe hoje. Um módulo novo de descoberta de gid (porta de `tools/matriz/discover-gids.js`) resolve o backfill do roster, que só existia até agora via um espelho Apps Script limitado ao mês corrente — esse espelho é aposentado.

**Tech Stack:** Node.js puro (sem dependências), `node --test`, fetch nativo, Chrome DevTools Protocol (`tools/semanal/cdp-client.js`) só para o Link 7 (sond.com.br).

## Global Constraints

- Nenhum segredo em arquivo do repositório — `ORCAMENTO_SENHA` só via variável de ambiente.
- Módulos consumidos tanto pelo build quanto pelo refresh no navegador usam `var`/`function` (não `const`/arrow) e só `require('./mesmo-diretorio.js')` — ver `tools/comum/browser-bundle.js`.
- Nenhuma fonte online nova pode derrubar o build inteiro — falha vira aviso + fallback, nunca exceção não tratada (exceto erros de layout/coluna, que são fail-loud de propósito, como o resto do projeto já faz).
- Toda reconstrução publicada exige `cp dist/planejamento-semanal.html docs/planejamento-semanal.html` (+ os CSVs novos) antes de commitar — travado por `test/publicacao-docs-sincronizado.test.js`.
- Ver a spec completa em `docs/superpowers/specs/2026-08-10-equipes-realizado-roster-link6-link7-design.md` para o raciocínio por trás de cada decisão.

---

### Task 1: Descoberta de gid — porta de `tools/matriz/discover-gids.js`

**Files:**
- Create: `tools/comum/descobrir-abas-planilha.js`
- Test: `test/semanal-descobrir-abas-planilha.test.js`

**Interfaces:**
- Produces: `buscarListaDeAbas(fileId, fetchImpl?) -> Promise<[{nome, gid}]>`; `extrairAbasDoHtml(html) -> [{nome, gid}]`; `parseNomeAbaEq(nome) -> {ano, mes} | null` (reconhece só `"AAAA - MÊS (EQ)"`, tolerando espaço extra e mês abreviado/por extenso); `mesesEqDoAno(abas, ano) -> [{ano, mes, gid}]` ordenado por mês.

- [ ] **Step 1: Escrever o teste**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buscarListaDeAbas, extrairAbasDoHtml, parseNomeAbaEq, mesesEqDoAno,
} = require('../tools/comum/descobrir-abas-planilha.js');

test('extrairAbasDoHtml extrai {nome, gid} de vários items.push', () => {
  const html = `<html><script>
    items.push({name: "2026 - JULHO (EQ)", pageUrl: "https://x", gid: "147186333"});
    items.push({name: "2026 - JULHO (VEIC)", pageUrl: "https://x", gid: "999"});
  </script></html>`;
  assert.deepEqual(extrairAbasDoHtml(html), [
    { nome: '2026 - JULHO (EQ)', gid: '147186333' },
    { nome: '2026 - JULHO (VEIC)', gid: '999' },
  ]);
});

test('buscarListaDeAbas monta a URL do htmlview e devolve extrairAbasDoHtml', async () => {
  let urlChamada = null;
  const fakeFetch = async (url) => {
    urlChamada = url;
    return { ok: true, status: 200, text: async () => 'items.push({name: "2026 - AGOSTO (EQ)", pageUrl: "https://x", gid: "1"});' };
  };
  const abas = await buscarListaDeAbas('FILE_ID', fakeFetch);
  assert.equal(urlChamada, 'https://docs.google.com/spreadsheets/d/FILE_ID/htmlview');
  assert.deepEqual(abas, [{ nome: '2026 - AGOSTO (EQ)', gid: '1' }]);
});

test('buscarListaDeAbas lança erro quando a resposta HTTP não é ok', async () => {
  const fakeFetch = async () => ({ ok: false, status: 500, text: async () => '' });
  await assert.rejects(() => buscarListaDeAbas('FILE_ID', fakeFetch), /HTTP 500/);
});

test('parseNomeAbaEq: só reconhece categoria (EQ), tolera espaço extra e mês abreviado/por extenso', () => {
  assert.deepEqual(parseNomeAbaEq('2026 - JULHO (EQ)'), { ano: 2026, mes: 7 });
  assert.deepEqual(parseNomeAbaEq(' 2026 - AGOSTO (EQ) '), { ano: 2026, mes: 8 });
  assert.deepEqual(parseNomeAbaEq('2026 - AGO (EQ)'), { ano: 2026, mes: 8 });
  assert.equal(parseNomeAbaEq('2026 - JULHO (VEIC)'), null);
  assert.equal(parseNomeAbaEq('2026 - JULHO (EQ e SUP.)'), null); // categoria diferente, não confundir
  assert.equal(parseNomeAbaEq('JULHO (EQ)'), null); // sem ano, nunca adivinha
  assert.equal(parseNomeAbaEq(''), null);
});

test('mesesEqDoAno filtra pelo ano e ordena por mês, ignorando categorias/anos diferentes', () => {
  const abas = [
    { nome: '2026 - MARÇO (EQ)', gid: '3' },
    { nome: '2026 - JANEIRO (EQ)', gid: '1' },
    { nome: '2026 - FEVEREIRO (EQ)', gid: '2' },
    { nome: '2025 - DEZEMBRO (EQ)', gid: '99' },
    { nome: '2026 - JANEIRO (VEIC)', gid: '100' },
  ];
  assert.deepEqual(mesesEqDoAno(abas, 2026), [
    { ano: 2026, mes: 1, gid: '1' },
    { ano: 2026, mes: 2, gid: '2' },
    { ano: 2026, mes: 3, gid: '3' },
  ]);
});

test('mesesEqDoAno descarta mês com 2+ abas ambíguas em vez de escolher uma', () => {
  const abas = [
    { nome: '2026 - JANEIRO (EQ)', gid: '1' },
    { nome: '2026 - JAN (EQ)', gid: '2' }, // mesmo (ano,mes), nome diferente -- duplicata
  ];
  assert.deepEqual(mesesEqDoAno(abas, 2026), []);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/semanal-descobrir-abas-planilha.test.js`
Expected: FAIL (`Cannot find module '../tools/comum/descobrir-abas-planilha.js'`)

- [ ] **Step 3: Implementar**

```js
'use strict';

// Porta de tools/matriz/discover-gids.js (repositório-mãe) -- generalizada
// para reconhecer só a categoria "(EQ)" (é a única que este repositório
// consome). Mesma técnica: o endpoint público /htmlview lista todas as
// abas de uma planilha (nome + gid) sem credencial -- só server-side, sem
// CORS, nunca chamável do live-refresh no navegador.
async function buscarListaDeAbas(fileId, fetchImpl = fetch) {
  const url = `https://docs.google.com/spreadsheets/d/${fileId}/htmlview`;
  const res = await fetchImpl(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`buscarListaDeAbas: HTTP ${res.status}`);
  return extrairAbasDoHtml(await res.text());
}

function extrairAbasDoHtml(html) {
  const regex = /items\.push\(\{name: "([^"]*)", pageUrl: "[^"]*", gid: "(\d+)"/g;
  const abas = [];
  let m;
  while ((m = regex.exec(html))) abas.push({ nome: m[1], gid: m[2] });
  return abas;
}

// "AAAA - MÊS (EQ)" -- tolera espaço extra ao redor do ano/hífen, exige o
// ano com 4 dígitos e a categoria EXATA "(EQ)" (não confunde com
// "(EQ e SUP.)", que é outra categoria da mesma planilha).
const NOME_ABA_PATTERN = /^\s*(\d{4})\s*-\s*([A-Za-zÀ-ÿ]+)\s*\(EQ\)\s*$/;

const MESES_NOME = {
  JAN: 1, JANEIRO: 1, FEV: 2, FEVEREIRO: 2, MAR: 3, MARCO: 3, 'MARÇO': 3,
  ABR: 4, ABRIL: 4, MAI: 5, MAIO: 5, JUN: 6, JUNHO: 6, JUL: 7, JULHO: 7,
  AGO: 8, AGOSTO: 8, SET: 9, SETEMBRO: 9, OUT: 10, OUTUBRO: 10,
  NOV: 11, NOVEMBRO: 11, DEZ: 12, DEZEMBRO: 12,
};

function parseNomeAbaEq(nome) {
  const m = NOME_ABA_PATTERN.exec(nome || '');
  if (!m) return null;
  const mes = MESES_NOME[m[2].toUpperCase()];
  if (!mes) return null;
  return { ano: Number(m[1]), mes };
}

// Abas "(EQ)" do ano pedido, uma por mês -- 2+ abas batendo o mesmo
// (ano,mes) (nome duplicado/renomeado) descarta o mês inteiro, nunca
// escolhe "a primeira que achar" (mesmo princípio de discover-gids.js).
function mesesEqDoAno(abas, ano) {
  const porMes = new Map();
  for (const aba of abas || []) {
    const info = parseNomeAbaEq(aba.nome);
    if (!info || info.ano !== ano) continue;
    if (!porMes.has(info.mes)) porMes.set(info.mes, []);
    porMes.get(info.mes).push(aba.gid);
  }
  const saida = [];
  for (const [mes, gids] of porMes) {
    if (gids.length === 1) saida.push({ ano, mes, gid: gids[0] });
  }
  return saida.sort((a, b) => a.mes - b.mes);
}

module.exports = { buscarListaDeAbas, extrairAbasDoHtml, parseNomeAbaEq, mesesEqDoAno };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/semanal-descobrir-abas-planilha.test.js`
Expected: PASS (todos os testes)

- [ ] **Step 5: Commit**

```bash
git add tools/comum/descobrir-abas-planilha.js test/semanal-descobrir-abas-planilha.test.js
git commit -m "Descoberta de gid das abas (EQ) da planilha de equipes (porta de tools/matriz/discover-gids.js)"
```

---

### Task 2: Fetcher — produção do Link 7 em formato cru

**Files:**
- Modify: `tools/semanal/atualizar-equipes-online.js`
- Modify: `test/semanal-atualizar-equipes-online.test.js` (criar se não existir — ver Step 1; se já existir cobrindo `lerCsvExistente`/`mesesPendentes`/`janelasMensais`, só adicionar os casos novos)

**Interfaces:**
- Consumes: `parseLinhasLink7` (já existe, devolve `[{idEquipe, sup, tipo, diaEpoch}]` — não muda).
- Produces: `dist/equipes-online.csv` no formato `IdEquipe,SUP,Tipo,DiaEpoch` (uma linha por equipe/dia/contrato — deixa de ser pré-agregado).

`parseLinhasLink7` já devolve exatamente os campos crus que o novo formato precisa — a mudança é só em como `main()` grava o arquivo, sem chamar mais `agregarEquipesProdutivas`.

- [ ] **Step 1: Escrever os testes do formato novo**

```js
// Adicionar a test/semanal-atualizar-equipes-online.test.js (criar se não existir)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { lerCsvExistente } = require('../tools/semanal/atualizar-equipes-online.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('lerCsvExistente lê o formato cru novo (IdEquipe,SUP,Tipo,DiaEpoch), dia na coluna 4', () => {
  const caminho = path.join(os.tmpdir(), `equipes-teste-${Date.now()}.csv`);
  fs.writeFileSync(caminho, 'IdEquipe,SUP,Tipo,DiaEpoch\n441,SUP-1,SP,19000\n442,SUP-2,SM,19001\n');
  const { porDia, ultimoDia } = lerCsvExistente(caminho);
  assert.deepEqual(Object.keys(porDia).sort(), ['19000', '19001']);
  assert.equal(porDia[19000].length, 1);
  assert.equal(porDia[19000][0], '441,SUP-1,SP,19000');
  assert.equal(ultimoDia, 19001);
  fs.unlinkSync(caminho);
});

test('lerCsvExistente devolve porDia vazio quando o arquivo não existe', () => {
  const { porDia, ultimoDia } = lerCsvExistente(path.join(os.tmpdir(), 'nao-existe-nunca.csv'));
  assert.deepEqual(porDia, {});
  assert.equal(ultimoDia, null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/semanal-atualizar-equipes-online.test.js`
Expected: FAIL (`lerCsvExistente` ainda lê a coluna 2, não a 3 — `porDia[19000][0]` viria vazio/errado)

- [ ] **Step 3: Implementar — mudar as colunas e remover a agregação da escrita**

Em `tools/semanal/atualizar-equipes-online.js`:

Trocar `lerCsvExistente` (a linha `const dia = Number(linha.split(',')[2]);`) para ler a coluna 3 (índice 3, formato novo):

```js
function lerCsvExistente(caminho) {
  if (!fs.existsSync(caminho)) return { porDia: {}, ultimoDia: null };
  const linhas = fs.readFileSync(caminho, 'utf8').trim().split('\n').slice(1);
  const porDia = {};
  let ultimoDia = null;
  for (const linha of linhas) {
    if (!linha.trim()) continue;
    const dia = Number(linha.split(',')[3]); // formato novo: IdEquipe,SUP,Tipo,DiaEpoch
    if (!Number.isFinite(dia)) continue;
    (porDia[dia] = porDia[dia] || []).push(linha);
    if (ultimoDia === null || dia > ultimoDia) ultimoDia = dia;
  }
  return { porDia, ultimoDia };
}
```

Trocar o bloco final de `main()` (de `const { porDia } = agregarEquipesProdutivas(linhasLink7);` até o `fs.writeFileSync`) para gravar as linhas CRUAS, sem agregação:

```js
  // Formato cru desde 2026-08-10: IdEquipe,SUP,Tipo,DiaEpoch, uma linha por
  // (equipe, dia, contrato) -- a fração/alocação por roster passou a ser
  // calculada no cruzamento (build/refresh), não mais aqui. Ver
  // compute-equipes-realizado-alocado.js e a spec
  // docs/superpowers/specs/2026-08-10-equipes-realizado-roster-link6-link7-design.md.
  const linhasSaida = linhasLink7.map((l) => `${l.idEquipe},${l.sup},${l.tipo},${l.diaEpoch}`);

  // Preserva os dias dos meses que NÃO foram rebuscados agora -- mesma
  // idempotência de sempre (diaInicio é ultimoDia + 1, os dois conjuntos são
  // disjuntos por construção).
  let diasPreservados = 0;
  for (const [dia, linhas] of Object.entries(jaTemos)) {
    if (mesesBuscados.has(mesDoDia(Number(dia)))) continue;
    linhasSaida.push(...linhas);
    diasPreservados++;
  }

  linhasSaida.sort((a, b) => Number(a.split(',')[3]) - Number(b.split(',')[3]));

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, ['IdEquipe,SUP,Tipo,DiaEpoch', ...linhasSaida].join('\n') + '\n', 'utf8');
  const diasNovos = new Set(linhasLink7.map((l) => l.diaEpoch)).size;
  if (falhas.length) console.warn(`${falhas.length} mês(es) falharam e ficaram como estavam: ${falhas.join(', ')}`);
  console.log(`Pronto: ${diasNovos} dia(s) novo(s) + ${diasPreservados} dia(s) preservado(s) do CSV anterior, gravado em ${OUT_PATH}.`);
```

Remover o `require('./compute-equipes-produtivas-link7.js')` do topo do arquivo (não é mais consumido aqui) e o log de "par(es) (SUP, tipologia) com equipe produtiva" que dependia de `porDia` (substituir por um log baseado em `linhasLink7.length`, ex. `console.log(\`  ${linhasLink7.length} linha(s) de produção (equipe, dia, contrato) no período buscado.\`);`).

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/semanal-atualizar-equipes-online.test.js test/semanal-parse-link7.test.js`
Expected: PASS (o teste novo passa; `semanal-parse-link7.test.js` continua passando porque `parseLinhasLink7` não mudou)

- [ ] **Step 5: Buscar e corrigir outros testes que dependiam do formato antigo**

Run: `node --test test/*.js 2>&1 | grep -i "equipes-online\|SUP,Tipo,DiaEpoch,Fracao"`

Se algum teste de `build-dashboard.js` ou fixture ainda montar `equipes-online.csv` no formato antigo (`SUP,Tipo,DiaEpoch,Fracao`), ele será substituído na Task 5 (que troca o leitor no build) — não corrigir aqui, só confirmar quais existem para não esquecer na Task 5.

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/atualizar-equipes-online.js test/semanal-atualizar-equipes-online.test.js
git commit -m "Fetcher: produção do Link 7 publicada crua (IdEquipe,SUP,Tipo,DiaEpoch), sem agregação no fetcher"
```

---

### Task 3: Fetcher — roster multi-mês do Link 6

**Files:**
- Modify: `tools/semanal/atualizar-equipes-online.js`
- Test: `test/semanal-atualizar-equipes-online.test.js` (mesmo arquivo da Task 2)

**Interfaces:**
- Consumes: `descobrirAbasPlanilha.mesesEqDoAno` (Task 1), `compute-equipes-ativas.js`'s `parseAbaEq`, `classificar-dia-equipe.js`'s `classificarDiaEquipe`.
- Produces: `dist/equipes-roster-online.csv`, formato `IdEquipe,DiaEpoch,Estado` (uma linha por equipe/dia; `Estado` é `mobilizada|campoSemFuro|fora|naoEquipe`).

**ID_PLANILHA_EQUIPES** = `'1Mgj87eSKMO4Gh2aHQWChNl5YCH2vatMDC2fCNuxB8TU'` (mesma planilha que `apps-script-espelho-eq.gs` usava — ver `ORIGEM_FILE_ID` nele).

- [ ] **Step 1: Escrever o teste da função de agregação do roster**

```js
// Adicionar a test/semanal-atualizar-equipes-online.test.js
const { linhasRosterDoMes } = require('../tools/semanal/atualizar-equipes-online.js');

test('linhasRosterDoMes classifica cada dia de cada equipe e devolve linhas "IdEquipe,DiaEpoch,Estado"', () => {
  // Mesmo formato de tools/semanal/compute-equipes-ativas.js: cabeçalho na
  // linha 0 (colunas de dia), sub-cabeçalho na linha 1 (ignorada), dado a
  // partir da linha 2. Coluna 0 = ID, coluna 1 = Nome.
  const csv = [
    'ID,Nome,-,Serviços,1-Ago,2-Ago',
    '-,-,-,-,-,-',
    '441,João,-,SP,CCR RioSP (17851-26),Férias',
  ].join('\n');
  const linhas = linhasRosterDoMes(csv, 2026, 8);
  assert.deepEqual(linhas.sort(), [
    `441,${Math.floor(Date.UTC(2026, 7, 1) / 86400000)},mobilizada`,
    `441,${Math.floor(Date.UTC(2026, 7, 2) / 86400000)},fora`,
  ].sort());
});

test('linhasRosterDoMes ignora célula vazia (dia ainda não preenchido)', () => {
  const csv = ['ID,Nome,-,Serviços,1-Ago', '-,-,-,-,-', '441,João,-,SP,'].join('\n');
  assert.deepEqual(linhasRosterDoMes(csv, 2026, 8), []);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/semanal-atualizar-equipes-online.test.js`
Expected: FAIL (`linhasRosterDoMes is not a function`)

- [ ] **Step 3: Implementar a busca e a agregação do roster**

No topo de `tools/semanal/atualizar-equipes-online.js`, adicionar aos requires:

```js
const { parseAbaEq } = require('./compute-equipes-ativas.js');
const { classificarDiaEquipe } = require('./classificar-dia-equipe.js');
const { buscarListaDeAbas, mesesEqDoAno } = require('../comum/descobrir-abas-planilha.js');
```

E as constantes/novas funções (perto de `SITE_ORIGIN`):

```js
const ID_PLANILHA_EQUIPES = '1Mgj87eSKMO4Gh2aHQWChNl5YCH2vatMDC2fCNuxB8TU';
const OUT_PATH_ROSTER = path.join(__dirname, '..', '..', 'dist', 'equipes-roster-online.csv');

// csvTexto é o export CSV de UMA aba "(EQ)" (mesmo layout que
// compute-equipes-ativas.js's parseAbaEq já lê -- é a MESMA planilha,
// só buscada direto em vez de via espelho Apps Script). ano/mes vêm do
// NOME da aba (descoberto por mesesEqDoAno), não do cabeçalho: o export
// direto do Google não carrega o ano na coluna de dia ("1-Ago", sem
// "/2026"), diferente do que o espelho antigo produzia via getValues().
function linhasRosterDoMes(csvTexto, ano, mes) {
  const equipes = parseAbaEq(csvTexto);
  const saida = [];
  for (const equipe of equipes) {
    if (!equipe.id) continue;
    for (const d of equipe.dias) {
      const classe = classificarDiaEquipe(d.texto);
      if (!classe) continue;
      const dia = diaEpoch(new Date(Date.UTC(ano, mes - 1, d.dia)));
      saida.push(`${equipe.id},${dia},${classe.estado}`);
    }
  }
  return saida;
}

// Lê o roster já gravado, como { dia -> [linha...] } -- mesmo padrão de
// lerCsvExistente (produção), mas o dia é a coluna 1 (IdEquipe,DiaEpoch,Estado).
function lerRosterExistente(caminho) {
  if (!fs.existsSync(caminho)) return { porDia: {} };
  const linhas = fs.readFileSync(caminho, 'utf8').trim().split('\n').slice(1);
  const porDia = {};
  for (const linha of linhas) {
    if (!linha.trim()) continue;
    const dia = Number(linha.split(',')[1]);
    if (!Number.isFinite(dia)) continue;
    (porDia[dia] = porDia[dia] || []).push(linha);
  }
  return { porDia };
}

// Backfill incremental do roster, mesmo espírito do Link 7: mês corrente
// SEMPRE rebuscado (ainda sendo preenchido), meses passados só se faltando.
// Substitui por completo o espelho Apps Script (apps-script-espelho-eq.gs),
// que só publicava o mês corrente -- ver a spec
// docs/superpowers/specs/2026-08-10-equipes-realizado-roster-link6-link7-design.md.
async function buscarRoster(ano, mesCorrente) {
  const { porDia: jaTemos } = lerRosterExistente(OUT_PATH_ROSTER);
  const diaTemMes = (dia) => {
    const d = new Date(Number(dia) * 86400000);
    return d.getUTCFullYear() === ano && (d.getUTCMonth() + 1);
  };
  const mesesComDado = new Set(
    Object.keys(jaTemos).map((dia) => diaTemMes(dia)).filter((m) => m && new Date(Number(Object.keys(jaTemos)[0]) * 86400000).getUTCFullYear() === ano)
  );

  console.log('Roster: descobrindo abas (EQ) da planilha de equipes...');
  const abas = await buscarListaDeAbas(ID_PLANILHA_EQUIPES);
  const mesesDisponiveis = mesesEqDoAno(abas, ano);
  if (!mesesDisponiveis.length) {
    console.warn('Roster: nenhuma aba "(EQ)" encontrada pro ano corrente -- Ativas/Não-produtivas/Realizado ficam sem dado de roster.');
    return { linhasNovas: [], mesesBuscados: new Set() };
  }

  const pendentes = mesesDisponiveis.filter((m) => m.mes === mesCorrente || !mesesComDado.has(m.mes));
  if (!pendentes.length) {
    console.log('Roster: todos os meses do ano já têm dado, e o mês corrente já foi buscado.');
    return { linhasNovas: [], mesesBuscados: new Set() };
  }

  const linhasNovas = [];
  const mesesBuscados = new Set();
  for (const { mes, gid } of pendentes) {
    const url = `https://docs.google.com/spreadsheets/d/${ID_PLANILHA_EQUIPES}/export?format=csv&gid=${gid}`;
    try {
      const resposta = await fetch(url, { redirect: 'follow' });
      if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
      const csv = await resposta.text();
      const linhas = linhasRosterDoMes(csv, ano, mes);
      console.log(`  Roster ${String(mes).padStart(2, '0')}/${ano}: ${linhas.length} linha(s) de equipe-dia.`);
      linhasNovas.push(...linhas);
      mesesBuscados.add(mes);
    } catch (err) {
      console.warn(`  Roster ${String(mes).padStart(2, '0')}/${ano}: FALHOU -- ${err.message}`);
    }
  }
  return { linhasNovas, mesesBuscados, jaTemos };
}

// Grava dist/equipes-roster-online.csv juntando o novo com o preservado --
// mesma idempotência do Link 7 (meses buscados são substituídos inteiros).
function gravarRoster({ linhasNovas, mesesBuscados, jaTemos }) {
  if (!mesesBuscados || !mesesBuscados.size) return;
  const linhasSaida = [...linhasNovas];
  let diasPreservados = 0;
  for (const [dia, linhas] of Object.entries(jaTemos || {})) {
    const mesDoRegistro = new Date(Number(dia) * 86400000).getUTCMonth() + 1;
    if (mesesBuscados.has(mesDoRegistro)) continue;
    linhasSaida.push(...linhas);
    diasPreservados++;
  }
  linhasSaida.sort((a, b) => Number(a.split(',')[1]) - Number(b.split(',')[1]));
  fs.mkdirSync(path.dirname(OUT_PATH_ROSTER), { recursive: true });
  fs.writeFileSync(OUT_PATH_ROSTER, ['IdEquipe,DiaEpoch,Estado', ...linhasSaida].join('\n') + '\n', 'utf8');
  console.log(`Roster: ${linhasNovas.length} linha(s) nova(s) + ${diasPreservados} dia(s) preservado(s), gravado em ${OUT_PATH_ROSTER}.`);
}
```

Em `main()`, depois de `const { ano, mes: mesCorrente } = hojeNoFusoProjeto();`, adicionar:

```js
  const resultadoRoster = await buscarRoster(ano, mesCorrente);
  gravarRoster(resultadoRoster);
```

(Antes do bloco que busca o Link 7 — a busca do roster usa `fetch` puro, sem Chrome, então não precisa vir depois de `checarConexao()`; pode inclusive vir ANTES para falhar rápido se a planilha mudou de layout.)

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/semanal-atualizar-equipes-online.test.js`
Expected: PASS

- [ ] **Step 5: Exportar as novas funções**

No `module.exports` de `atualizar-equipes-online.js`, adicionar `linhasRosterDoMes, lerRosterExistente, buscarRoster, gravarRoster`.

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/atualizar-equipes-online.js test/semanal-atualizar-equipes-online.test.js
git commit -m "Fetcher: roster do Link 6 com backfill anual via descoberta de gid, aposenta o espelho Apps Script"
```

---

### Task 4: Módulo de cruzamento — roster + produção, com carry-forward

**Files:**
- Create: `tools/semanal/compute-equipes-realizado-alocado.js`
- Test: `test/semanal-compute-equipes-realizado-alocado.test.js`

**Interfaces:**
- Consumes: roster como `[{idEquipe, diaEpoch, estado}]`; produção crua como `[{idEquipe, sup, tipo, diaEpoch}]`.
- Produces: `agregarEquipesRealizadoAlocado({ roster, producao, janelaFallbackDias? }) -> { porDia, foraDaJanela, ativos }` — `porDia` no MESMO formato de `demandas.equipesPorDia` (`'SUP||Tipo' -> {diaEpoch: fração}`).

- [ ] **Step 1: Escrever os testes**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { agregarEquipesRealizadoAlocado } = require('../tools/semanal/compute-equipes-realizado-alocado.js');

test('ativa e produziu no dia: fraciona 1/N entre as combinações (SUP,tipo) do dia', () => {
  const roster = [{ idEquipe: '1', diaEpoch: 100, estado: 'mobilizada' }];
  const producao = [
    { idEquipe: '1', sup: 'SUP-A', tipo: 'SP', diaEpoch: 100 },
    { idEquipe: '1', sup: 'SUP-B', tipo: 'SM', diaEpoch: 100 },
  ];
  const { porDia } = agregarEquipesRealizadoAlocado({ roster, producao });
  assert.equal(porDia['SUP-A||SP'][100], 0.5);
  assert.equal(porDia['SUP-B||SM'][100], 0.5);
});

test('duas linhas de produção na MESMA combinação (SUP,tipo) no mesmo dia não inflam o denominador', () => {
  const roster = [{ idEquipe: '1', diaEpoch: 100, estado: 'mobilizada' }];
  const producao = [
    { idEquipe: '1', sup: 'SUP-A', tipo: 'SP', diaEpoch: 100 },
    { idEquipe: '1', sup: 'SUP-A', tipo: 'SP', diaEpoch: 100 }, // segunda foto, mesma combinação
  ];
  const { porDia } = agregarEquipesRealizadoAlocado({ roster, producao });
  assert.equal(porDia['SUP-A||SP'][100], 1);
});

test('ativa sem produção no dia, com produção dentro de 45 dias: carry-forward pro último (SUP,tipo)', () => {
  const roster = [{ idEquipe: '1', diaEpoch: 140, estado: 'campoSemFuro' }];
  const producao = [
    { idEquipe: '1', sup: 'SUP-A', tipo: 'SP', diaEpoch: 100 }, // 40 dias antes
  ];
  const { porDia } = agregarEquipesRealizadoAlocado({ roster, producao });
  assert.equal(porDia['SUP-A||SP'][140], 1);
});

test('ativa sem produção, última produção a MAIS de 45 dias: fica fora da conta', () => {
  const roster = [{ idEquipe: '1', diaEpoch: 200, estado: 'mobilizada' }];
  const producao = [{ idEquipe: '1', sup: 'SUP-A', tipo: 'SP', diaEpoch: 100 }]; // 100 dias antes
  const { porDia, foraDaJanela } = agregarEquipesRealizadoAlocado({ roster, producao });
  assert.deepEqual(porDia, {});
  assert.equal(foraDaJanela, 1);
});

test('ativa sem NENHUMA produção histórica: fica fora da conta', () => {
  const roster = [{ idEquipe: '1', diaEpoch: 100, estado: 'mobilizada' }];
  const { porDia, foraDaJanela } = agregarEquipesRealizadoAlocado({ roster, producao: [] });
  assert.deepEqual(porDia, {});
  assert.equal(foraDaJanela, 1);
});

test('estado "fora" nunca entra na conta, mesmo com produção no mesmo dia', () => {
  const roster = [{ idEquipe: '1', diaEpoch: 100, estado: 'fora' }];
  const producao = [{ idEquipe: '1', sup: 'SUP-A', tipo: 'SP', diaEpoch: 100 }];
  const { porDia, ativos } = agregarEquipesRealizadoAlocado({ roster, producao });
  assert.deepEqual(porDia, {});
  assert.equal(ativos, 0);
});

test('estado "naoEquipe" CONTA como ativa -- definição nova de 2026-08-10, diferente de contaComoAtiva', () => {
  const roster = [{ idEquipe: '1', diaEpoch: 100, estado: 'naoEquipe' }];
  const producao = [{ idEquipe: '1', sup: 'SUP-A', tipo: 'SP', diaEpoch: 100 }];
  const { porDia, ativos } = agregarEquipesRealizadoAlocado({ roster, producao });
  assert.equal(porDia['SUP-A||SP'][100], 1);
  assert.equal(ativos, 1);
});

test('carry-forward usa a produção mais RECENTE dentro da janela, não a mais antiga', () => {
  const roster = [{ idEquipe: '1', diaEpoch: 150, estado: 'mobilizada' }];
  const producao = [
    { idEquipe: '1', sup: 'SUP-VELHO', tipo: 'SP', diaEpoch: 100 },
    { idEquipe: '1', sup: 'SUP-NOVO', tipo: 'SM', diaEpoch: 120 },
  ];
  const { porDia } = agregarEquipesRealizadoAlocado({ roster, producao });
  assert.equal(porDia['SUP-NOVO||SM'][150], 1);
  assert.equal(porDia['SUP-VELHO||SP'], undefined);
});

test('janelaFallbackDias é configurável (default 45)', () => {
  const roster = [{ idEquipe: '1', diaEpoch: 130, estado: 'mobilizada' }];
  const producao = [{ idEquipe: '1', sup: 'SUP-A', tipo: 'SP', diaEpoch: 100 }]; // 30 dias antes
  const comJanelaCurta = agregarEquipesRealizadoAlocado({ roster, producao, janelaFallbackDias: 20 });
  assert.deepEqual(comJanelaCurta.porDia, {});
  const comJanelaPadrao = agregarEquipesRealizadoAlocado({ roster, producao });
  assert.equal(comJanelaPadrao.porDia['SUP-A||SP'][130], 1);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/semanal-compute-equipes-realizado-alocado.test.js`
Expected: FAIL (`Cannot find module`)

- [ ] **Step 3: Implementar**

```js
'use strict';

// Cruza roster (Link 6) + produção crua (Link 7) para o Realizado de
// Equipes da Tabela Semanal. Regra fechada com o dono do projeto em
// 2026-08-10 -- ver a spec
// docs/superpowers/specs/2026-08-10-equipes-realizado-roster-link6-link7-design.md.
//
// Bundle-safe (var/function): roda tanto no build (Node) quanto no
// live-refresh (navegador, via browser-bundle.js) -- mesmo padrão de
// compute-equipes-ativas.js.
var JANELA_FALLBACK_PADRAO = 45;

// "Ativa" = tudo exceto 'fora' (férias/baixada/folga) -- INCLUI 'naoEquipe'
// (contratação, admissão, encarregado, auxiliar), diferente de
// contaComoAtiva() em classificar-dia-equipe.js (que só conta mobilizada +
// campoSemFuro, e continua servindo Equipes Ativas/Não-produtivas sem
// mudar). Duas definições de "ativa" coexistem de propósito -- não
// unificar sem decisão do dono do projeto.
function ativaNaDefinicaoNova(estado) {
  return estado !== 'fora';
}

// producao -> { idEquipe -> { porDia: Map(diaEpoch -> Set('sup||tipo')), historico: [{diaEpoch,sup,tipo}] ordenado } }
function indexarProducao(producao) {
  var porEquipe = new Map();
  (producao || []).forEach(function (l) {
    if (!l.idEquipe) return;
    if (!porEquipe.has(l.idEquipe)) porEquipe.set(l.idEquipe, { porDia: new Map(), historico: [] });
    var entrada = porEquipe.get(l.idEquipe);
    if (!entrada.porDia.has(l.diaEpoch)) entrada.porDia.set(l.diaEpoch, new Set());
    entrada.porDia.get(l.diaEpoch).add(l.sup + '||' + l.tipo);
    entrada.historico.push({ diaEpoch: l.diaEpoch, sup: l.sup, tipo: l.tipo });
  });
  porEquipe.forEach(function (entrada) {
    entrada.historico.sort(function (a, b) { return a.diaEpoch - b.diaEpoch; });
  });
  return porEquipe;
}

// Último registro do histórico com diaEpoch < diaAlvo e dentro da janela.
// null se não achar. Assume histórico ORDENADO (indexarProducao garante).
function ultimoDentroDaJanela(historico, diaAlvo, janelaDias) {
  var melhor = null;
  for (var i = 0; i < (historico || []).length; i++) {
    var item = historico[i];
    if (item.diaEpoch >= diaAlvo) break;
    if (diaAlvo - item.diaEpoch <= janelaDias) melhor = item;
  }
  return melhor;
}

// opcoes.roster: [{idEquipe, diaEpoch, estado}]
// opcoes.producao: [{idEquipe, sup, tipo, diaEpoch}]
// opcoes.janelaFallbackDias: default 45
//
// Devolve { porDia, foraDaJanela, ativos }. porDia no MESMO formato que
// demandas.equipesPorDia já usa hoje: 'SUP||Tipo' -> {diaEpoch: fração}.
function agregarEquipesRealizadoAlocado(opcoes) {
  var o = opcoes || {};
  var janela = typeof o.janelaFallbackDias === 'number' ? o.janelaFallbackDias : JANELA_FALLBACK_PADRAO;
  var porEquipeProducao = indexarProducao(o.producao);

  var porDia = {};
  function somar(sup, tipo, dia, fracao) {
    var chave = sup + '||' + tipo;
    if (!porDia[chave]) porDia[chave] = {};
    porDia[chave][dia] = (porDia[chave][dia] || 0) + fracao;
  }

  var ativos = 0;
  var foraDaJanela = 0;

  (o.roster || []).forEach(function (item) {
    if (!ativaNaDefinicaoNova(item.estado)) return;
    ativos++;

    var entradaEquipe = porEquipeProducao.get(item.idEquipe);
    var combinacoesHoje = entradaEquipe && entradaEquipe.porDia.get(item.diaEpoch);

    if (combinacoesHoje && combinacoesHoje.size) {
      var fracao = 1 / combinacoesHoje.size;
      combinacoesHoje.forEach(function (combinacao) {
        var partes = combinacao.split('||');
        somar(partes[0], partes[1], item.diaEpoch, fracao);
      });
      return;
    }

    var historico = entradaEquipe ? entradaEquipe.historico : [];
    var ultimo = ultimoDentroDaJanela(historico, item.diaEpoch, janela);
    if (ultimo) {
      somar(ultimo.sup, ultimo.tipo, item.diaEpoch, 1);
    } else {
      foraDaJanela++;
    }
  });

  return { porDia: porDia, foraDaJanela: foraDaJanela, ativos: ativos };
}

module.exports = { agregarEquipesRealizadoAlocado, ativaNaDefinicaoNova, JANELA_FALLBACK_PADRAO };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/semanal-compute-equipes-realizado-alocado.test.js`
Expected: PASS (todos os 9 testes)

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/compute-equipes-realizado-alocado.js test/semanal-compute-equipes-realizado-alocado.test.js
git commit -m "Módulo novo: cruza roster (Link 6) + produção (Link 7) com carry-forward de 45 dias pro Realizado de Equipes"
```

---

### Task 5: `build-dashboard.js` — ler os CSVs publicados, aposentar `buscarEspelhoEq`

**Files:**
- Modify: `tools/semanal/build-dashboard.js`
- Modify: `test/semanal-build-dashboard.test.js` (ajustar fixtures que hoje simulam `buscarEspelhoEq`/o CSV antigo de equipes-online)

**Interfaces:**
- Consumes: `agregarEquipesRealizadoAlocado` (Task 4), `parseAbaEq`/`agregarEquipesAtivas`/`agregarEquipesNaoProdutivas` (já existentes, sem mudar assinatura).
- Produces: `demandas.equipesPorDia`/`equipesPeriodo` (Realizado novo) e o texto CSV do roster do mês corrente para `montarEquipesAtivas`/`equipesNaoProdutivas` — mesma forma que essas duas funções já recebem hoje (texto CSV no formato de `parseAbaEq`), só que agora **sintetizado** a partir de `equipes-roster-online.csv` em vez de buscado ao vivo.

Como `equipes-roster-online.csv` já vem CLASSIFICADO (`IdEquipe,DiaEpoch,Estado`), e `montarEquipesAtivas`/`agregarEquipesNaoProdutivas` esperam o formato BRUTO de `parseAbaEq` (`{id, nome, servicos, dias:[{dia,texto}]}` — texto livre, não estado), a ponte é um parser pequeno que lê o roster publicado direto para o formato de entrada que essas funções já aceitam (`agregarEquipesAtivas`/`agregarEquipesNaoProdutivas` consomem `equipe.dias[].texto` só para re-classificar via `classificarDiaEquipe` — ver `classificar-dia-equipe.js`). Para não duplicar re-classificação, este task troca a ENTRADA dessas duas funções pelo Estado já pronto em vez de reformar as duas funções (que são usadas só aqui) — ver Step 3.

- [ ] **Step 1: Escrever/ajustar o teste de `parseRosterOnlineCsv`**

```js
// Adicionar a test/semanal-build-dashboard.test.js (ou criar um teste
// unitário próprio, test/semanal-parse-roster-online.test.js, se
// build-dashboard.test.js já estiver grande)
const { parseRosterOnlineCsv } = require('../tools/semanal/build-dashboard.js');

test('parseRosterOnlineCsv agrupa por equipe e filtra pro (ano,mes) pedido', () => {
  var dia1 = Math.floor(Date.UTC(2026, 7, 1) / 86400000);
  var dia2 = Math.floor(Date.UTC(2026, 6, 15) / 86400000); // mês diferente
  var csv = 'IdEquipe,DiaEpoch,Estado\n441,' + dia1 + ',mobilizada\n441,' + dia2 + ',fora\n';
  var equipes = parseRosterOnlineCsv(csv, 2026, 8);
  assert.equal(equipes.length, 1);
  assert.equal(equipes[0].id, '441');
  assert.equal(equipes[0].estados.length, 1);
  assert.equal(equipes[0].estados[0].estado, 'mobilizada');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/semanal-build-dashboard.test.js`
Expected: FAIL (`parseRosterOnlineCsv is not exported`)

- [ ] **Step 3: Implementar as trocas em `build-dashboard.js`**

Remover `buscarEspelhoEq`/`URL_ESPELHO_EQ` por completo. Adicionar:

```js
const { agregarEquipesRealizadoAlocado } = require('./compute-equipes-realizado-alocado.js');

// dist/equipes-online.csv (produção crua do Link 7, Task 2) -> [{idEquipe,
// sup, tipo, diaEpoch}]. Mesmo parser simples que o resto do build usa pra
// CSV plano (sem aspas/vírgula em campo -- IDs/SUPs/tipologias nunca têm).
function parseProducaoOnlineCsv(csvTexto) {
  var linhas = (csvTexto || '').trim().split('\n').slice(1);
  var saida = [];
  linhas.forEach(function (linha) {
    if (!linha) return;
    var partes = linha.split(',');
    saida.push({ idEquipe: partes[0], sup: partes[1], tipo: partes[2], diaEpoch: Number(partes[3]) });
  });
  return saida;
}

// dist/equipes-roster-online.csv (Task 3) -> { porEquipeDia:
// [{idEquipe,diaEpoch,estado}], porMes: (ano,mes) -> [{id, estados:
// [{dia,estado}]}] no formato "equipe" que montarEquipesAtivas/
// agregarEquipesNaoProdutivas esperam (troca 'dias[].texto' livre por
// 'estados[].estado' já classificado -- essas duas funções, ao consumir
// este formato via wrappers abaixo, não re-classificam texto nenhum).
function parseRosterOnlineCsvBruto(csvTexto) {
  var linhas = (csvTexto || '').trim().split('\n').slice(1);
  var saida = [];
  linhas.forEach(function (linha) {
    if (!linha) return;
    var partes = linha.split(',');
    saida.push({ idEquipe: partes[0], diaEpoch: Number(partes[1]), estado: partes[2] });
  });
  return saida;
}

// Recorte de um (ano,mes) do roster bruto, agrupado por equipe -- formato
// { id, estados: [{dia, estado}] } (dia = dia DO MÊS, 1..31, pra combinar
// com o resto do pipeline de Ativas/Não-produtivas que já pensa em
// "dia do mês").
function parseRosterOnlineCsv(csvTexto, ano, mes) {
  var porEquipe = new Map();
  parseRosterOnlineCsvBruto(csvTexto).forEach(function (l) {
    var d = new Date(l.diaEpoch * 86400000);
    if (d.getUTCFullYear() !== ano || d.getUTCMonth() + 1 !== mes) return;
    if (!porEquipe.has(l.idEquipe)) porEquipe.set(l.idEquipe, []);
    porEquipe.get(l.idEquipe).push({ dia: d.getUTCDate(), estado: l.estado });
  });
  return Array.from(porEquipe, function ([id, estados]) { return { id: id, estados: estados }; });
}
```

Substituir a chamada `const equipesAtivasCsv = await buscarEspelhoEq();` no topo de `build()` por leitura do arquivo publicado:

```js
  const CAMINHO_ROSTER_ONLINE = path.join(__dirname, '..', '..', 'dist', 'equipes-roster-online.csv');
  const rosterOnlineCsv = fs.existsSync(CAMINHO_ROSTER_ONLINE) ? fs.readFileSync(CAMINHO_ROSTER_ONLINE, 'utf8') : null;
```

`montarEquipesAtivas(furos, csvEspelho)` e o bloco de `equipesNaoProdutivas` esperam `equipe.dias[].texto` (texto livre) hoje — como o roster publicado já chega CLASSIFICADO, a ponte mais simples é adaptar `agregarEquipesAtivas`/`agregarEquipesNaoProdutivas` para aceitar um `estado` pronto OU um `texto` (ambos convergem em `classificarDiaEquipe`/`contaComoAtiva` de qualquer forma). Só que essas duas funções são compartilhadas com o navegador (bundle) e mexer nelas é risco desnecessário para este plano. Em vez disso, **sintetiza um "texto" de volta a partir do estado já classificado**, reaproveitando as duas funções sem tocar nelas:

```js
// classificarDiaEquipe(texto) é IRREVERSÍVEL de propósito (é um parser de
// texto livre) -- mas as duas funções consumidoras (agregarEquipesAtivas/
// agregarEquipesNaoProdutivas) só usam o RESULTADO da classificação, nunca
// o texto em si (ver como usam classe.estado). Um texto sintético e
// INEQUÍVOCO por estado faz classificarDiaEquipe(texto sintético) produzir
// de volta o mesmo estado, sem tocar nas duas funções compartilhadas com o
// navegador. 'Auxiliar' cai em naoEquipe; 'CCR RioSP' cai no default
// (mobilizada/campoSemFuro -- indistinguíveis por texto puro, e para
// Ativas/Não-produtivas os dois já contam igual via contaComoAtiva).
const TEXTO_SINTETICO_POR_ESTADO = {
  fora: 'Férias', naoEquipe: 'Auxiliar', mobilizada: 'OK', campoSemFuro: 'Mobilização',
};
function equipesParaFormatoAbaEq(equipesRoster) {
  return equipesRoster.map((e) => ({
    id: e.id, nome: e.id, servicos: '', // nome/serviços não existem no CSV cru -- ver Fora de escopo na spec
    dias: e.estados.map((es) => ({ dia: es.dia, texto: TEXTO_SINTETICO_POR_ESTADO[es.estado] || '' })),
  }));
}
```

E, na função `montarEquipesAtivas`, trocar `parseAbaEq(csvEspelho)` por `equipesParaFormatoAbaEq(parseRosterOnlineCsv(csvEspelho, periodo.ano, periodo.mes))` — mas como `montarEquipesAtivas` já recebe `csvEspelho` (agora o roster CRU, não mais um CSV no formato aba EQ), seu parâmetro `mesDaAbaEq(csvEspelho)` (que lia o cabeçalho) também precisa mudar: **o período agora vem de `hojeNoFusoProjeto()`** (mesmo helper que `atualizar-equipes-online.js` já usa), não mais do cabeçalho do CSV. Ajustar a assinatura de `montarEquipesAtivas(furos, rosterOnlineCsv, periodoAtual)` para receber `{ano, mes}` de fora, e usar isso em vez de `mesDaAbaEq`.

No bloco de `equipesNaoProdutivas` (perto do fim de `build()`), mesma troca: em vez de `mesDaAbaEq(equipesAtivasCsv)` + `parseAbaEq(equipesAtivasCsv)`, usar `hojeNoFusoProjeto()` + `equipesParaFormatoAbaEq(parseRosterOnlineCsv(rosterOnlineCsv, ano, mesCorrente))`.

Substituir o bloco "Δ equipes PRODUTIVAS (2026-08-09)" (que lê `equipes-online.csv` com `parseEquipesFracaoCsv`) por:

```js
  // Δ equipes REALIZADO (2026-08-10): roster (Link 6) + produção (Link 7),
  // com carry-forward -- ver compute-equipes-realizado-alocado.js e a spec
  // docs/superpowers/specs/2026-08-10-equipes-realizado-roster-link6-link7-design.md.
  // Substitui o pré-agregado "PRODUTIVAS (Link 7)" de 2026-08-09. Continua
  // sendo a PRIMEIRA prioridade -- ativas (aba EQ)/mobilizadas (furos)
  // seguem como reserva se qualquer um dos dois CSVs faltar ou não produzir
  // dado utilizável.
  const CAMINHO_PRODUCAO_ONLINE = path.join(__dirname, '..', '..', 'dist', 'equipes-online.csv');
  if (fs.existsSync(CAMINHO_PRODUCAO_ONLINE) && rosterOnlineCsv) {
    const producao = parseProducaoOnlineCsv(fs.readFileSync(CAMINHO_PRODUCAO_ONLINE, 'utf8'));
    const roster = parseRosterOnlineCsvBruto(rosterOnlineCsv);
    const resultado = agregarEquipesRealizadoAlocado({ roster, producao });
    if (Object.keys(resultado.porDia).length) {
      // resolverSupConhecido: MESMA tradução de "Diversos" que produtivas já
      // aplicava (o SUP da produção pode não existir na MATRIZ pra aquela
      // tipologia).
      const resolverSup = resolverSupConhecido(registros);
      const porDiaResolvido = {};
      for (const [chave, mapa] of Object.entries(resultado.porDia)) {
        const [sup, tipo] = chave.split('||');
        const chaveResolvida = resolverSup(sup, tipo) + '||' + tipo;
        porDiaResolvido[chaveResolvida] = porDiaResolvido[chaveResolvida] || {};
        for (const [dia, fracao] of Object.entries(mapa)) {
          porDiaResolvido[chaveResolvida][dia] = (porDiaResolvido[chaveResolvida][dia] || 0) + fracao;
        }
      }
      demandas.equipesPorDia = porDiaResolvido;
      demandas.equipesPeriodo = null; // multi-mês -- ver o comentário de equipesPeriodo mais acima
      fonteEquipes = 'REALIZADO (roster Link 6 + produção Link 7)';
      console.log(`Equipes REALIZADO: ${resultado.ativos} equipe-dia ativa(s), ${resultado.foraDaJanela} sem produção dentro de 45 dias (fora da conta).`);
    } else {
      console.warn('Equipes REALIZADO: roster+produção não produziram nenhum par utilizável -- mantendo a fonte de reserva (ativas/mobilizadas).');
    }
  } else {
    console.warn(`Equipes REALIZADO: falta ${CAMINHO_PRODUCAO_ONLINE} ou equipes-roster-online.csv -- rode "node tools/semanal/atualizar-equipes-online.js". Mantendo a fonte de reserva (ativas/mobilizadas).`);
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/semanal-build-dashboard.test.js`
Expected: PASS. Se algum teste existente montava um `equipesAtivasCsv` fake no formato de `parseAbaEq` esperando que `build()` o buscasse via `fetch`/`buscarEspelhoEq`, ajustar essa fixture para gravar um `equipes-roster-online.csv` temporário em vez de mockar `fetch` (padrão que os testes de `avancos-online.csv`/`lab-online.csv` já usam — arquivo em `dist/` antes de chamar `build()`).

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/build-dashboard.js test/semanal-build-dashboard.test.js
git commit -m "build-dashboard.js: Realizado de Equipes via roster+produção; Ativas/Não-produtivas leem o mesmo roster publicado (aposenta buscarEspelhoEq)"
```

---

### Task 6: `render-semanal.js` — refresh no navegador

**Files:**
- Modify: `tools/semanal/render-semanal.js`
- Modify: `test/semanal-render-semanal-wireup.test.js` (ajustar índices do `Promise.all` se o teste inspecionar o texto do script gerado)

**Interfaces:**
- Consumes: `compute-equipes-realizado-alocado.js` (Task 4) — precisa entrar em `BUNDLE_ARQUIVOS`.
- Produces: recalcula `demandas.equipesPorDia`/`equipesPeriodo`/`equipesNaoProdutivas` no clique de "Atualizar dados", lendo os arquivos publicados em vez do Google Sheets direto.

- [ ] **Step 1: Registrar o módulo novo no bundle**

Em `BUNDLE_ARQUIVOS` (perto de `'compute-equipes-nao-produtivas.js'`), adicionar `'compute-equipes-realizado-alocado.js'` (não consome nenhum módulo same-dir — pode entrar em qualquer ponto depois de `classificar-dia-equipe.js`, mas antes de `compute-balanco.js` para manter a convenção de "tudo de equipes fica junto"):

```js
  'compute-equipes-nao-produtivas.js', 'compute-equipes-realizado-alocado.js',
```

E, na lista de `var X = MODULOS[...]` logo abaixo de `SCRIPT_CLIENTE_SEMANAL`:

```js
var ComputeEquipesRealizadoAlocado = MODULOS['compute-equipes-realizado-alocado.js'];
```

- [ ] **Step 2: Trocar as URLs e o parsing no `Promise.all`**

Trocar:
```js
var URL_ESPELHO_EQ_SEMANAL = 'https://docs.google.com/spreadsheets/d/e/2PACX-.../pub?gid=199381651&single=true&output=csv';
```
por:
```js
// 2026-08-10: aposenta o espelho Apps Script (só mês corrente) -- lê o
// roster publicado pelo fetcher (equipes-roster-online.csv, multi-mês, já
// classificado por Estado). Mesmo padrão relativo dos outros CSVs online.
// Ver docs/superpowers/specs/2026-08-10-equipes-realizado-roster-link6-link7-design.md.
var URL_ESPELHO_EQ_SEMANAL = 'equipes-roster-online.csv';
```

`URL_ESPELHO_EQUIPES_SEMANAL` continua apontando pra `'equipes-online.csv'` (só o CONTEÚDO mudou de formato — o refresh ainda busca o mesmo nome de arquivo).

No `.then(function (textos) {...})`, o bloco que hoje lê `textos[3]` (`csvEq`) para Ativas e `textos[4]` para "equipes FRACIONADAS" muda:

```js
      // Roster publicado (multi-mês, já classificado) -- textos[3].
      // csvEq aqui é o CSV CRU (IdEquipe,DiaEpoch,Estado), não mais o
      // formato de aba EQ -- os usos de ComputeEquipesAtivas.parseAbaEq(csvEq)
      // abaixo trocam pelo parser novo + síntese de texto (mesma ponte que
      // build-dashboard.js usa, ver equipesParaFormatoAbaEq).
      var rosterOnlineTexto = textos[3];
      var hoje = new Date();
      var periodoAtual = { ano: hoje.getUTCFullYear(), mes: hoje.getUTCMonth() + 1 };

      function parseRosterOnlineClienteBruto(texto) {
        var linhas = (texto || '').trim().split('\n').slice(1);
        var saida = [];
        linhas.forEach(function (linha) {
          if (!linha) return;
          var p = linha.split(',');
          saida.push({ idEquipe: p[0], diaEpoch: Number(p[1]), estado: p[2] });
        });
        return saida;
      }
      var TEXTO_SINTETICO_POR_ESTADO_CLIENTE = { fora: 'Férias', naoEquipe: 'Auxiliar', mobilizada: 'OK', campoSemFuro: 'Mobilização' };
      function equipesParaFormatoAbaEqCliente(rosterBruto, ano, mes) {
        var porEquipe = {};
        rosterBruto.forEach(function (l) {
          var d = new Date(l.diaEpoch * 86400000);
          if (d.getUTCFullYear() !== ano || d.getUTCMonth() + 1 !== mes) return;
          if (!porEquipe[l.idEquipe]) porEquipe[l.idEquipe] = { id: l.idEquipe, nome: l.idEquipe, servicos: '', dias: [] };
          porEquipe[l.idEquipe].dias.push({ dia: d.getUTCDate(), texto: TEXTO_SINTETICO_POR_ESTADO_CLIENTE[l.estado] || '' });
        });
        return Object.keys(porEquipe).map(function (k) { return porEquipe[k]; });
      }

      var rosterBrutoCliente = rosterOnlineTexto ? parseRosterOnlineClienteBruto(rosterOnlineTexto) : [];
      var csvEq = rosterOnlineTexto; // mantém o nome pra minimizar diff no resto do bloco
      var periodoEq = rosterOnlineTexto ? periodoAtual : null;
```

E, dentro de `if (periodoEq) { ... agregarEquipesAtivas({ equipes: ComputeEquipesAtivas.parseAbaEq(csvEq), ... }) }`, trocar `ComputeEquipesAtivas.parseAbaEq(csvEq)` por `equipesParaFormatoAbaEqCliente(rosterBrutoCliente, periodoEq.ano, periodoEq.mes)`. Mesma troca no bloco de "Equipes NÃO produtivas" mais abaixo (`ComputeEquipesAtivas.parseAbaEq(csvEq)` → `equipesParaFormatoAbaEqCliente(rosterBrutoCliente, periodoEq.ano, periodoEq.mes)`).

Substituir por completo o bloco "Equipes FRACIONADAS (2026-08-08, Task 12...)" (o `if (textos[4]) { ... }` que soma `SUP,Tipo,DiaEpoch,Fracao`) por:

```js
      // Δ equipes REALIZADO (2026-08-10): roster + produção crua, mesmo
      // cruzamento que o build faz (build-dashboard.js) -- ver
      // compute-equipes-realizado-alocado.js. Substitui "FRACIONADAS"
      // (pré-agregado, aposentado). Gated por avancosLabConfigurados (mesmo
      // motivo dos blocos acima: precisa de furos prontos pra resolverSup).
      if (textos[4] && rosterBrutoCliente.length) {
        var producaoCliente = [];
        textos[4].trim().split('\n').slice(1).forEach(function (linha) {
          if (!linha) return;
          var p = linha.split(',');
          producaoCliente.push({ idEquipe: p[0], sup: p[1], tipo: p[2], diaEpoch: Number(p[3]) });
        });
        var resultadoCliente = ComputeEquipesRealizadoAlocado.agregarEquipesRealizadoAlocado({
          roster: rosterBrutoCliente, producao: producaoCliente,
        });
        if (Object.keys(resultadoCliente.porDia).length) {
          var resolverSupCliente = ComputeDemandas.resolverSupConhecido(registrosNovos);
          var porDiaResolvidoCliente = {};
          Object.keys(resultadoCliente.porDia).forEach(function (chave) {
            var partes = chave.split('||');
            var chaveResolvida = resolverSupCliente(partes[0], partes[1]) + '||' + partes[1];
            porDiaResolvidoCliente[chaveResolvida] = porDiaResolvidoCliente[chaveResolvida] || {};
            Object.keys(resultadoCliente.porDia[chave]).forEach(function (dia) {
              porDiaResolvidoCliente[chaveResolvida][dia] = (porDiaResolvidoCliente[chaveResolvida][dia] || 0) + resultadoCliente.porDia[chave][dia];
            });
          });
          demandasNovas.equipesPorDia = porDiaResolvidoCliente;
          demandasNovas.equipesPeriodo = null;
        }
      }
```

- [ ] **Step 3: Rodar os testes de wireup**

Run: `node --test test/semanal-render-semanal-wireup.test.js`
Expected: PASS (ou ajustar qualquer asserção que checasse o texto literal da URL antiga/`textos[4]` no formato antigo — buscar por `URL_ESPELHO_EQ_SEMANAL`/`Fracao` no arquivo de teste)

- [ ] **Step 4: Rodar a suíte inteira**

Run: `node --test test/*.js`
Expected: PASS (nenhuma regressão nas outras páginas/abas)

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/render-semanal.js test/semanal-render-semanal-wireup.test.js
git commit -m "render-semanal.js: refresh lê o roster+produção publicados (aposenta o espelho Google Sheets direto no navegador)"
```

---

### Task 7: Denominador da média — dias úteis, sem domingo

**Files:**
- Modify: `tools/semanal/render-aba-semanal.js`
- Test: `test/semanal-render-aba-semanal.test.js` (ou o arquivo de teste existente que já cobre `somarEquipesNoIntervalo` — buscar antes de criar um novo)

**Interfaces:**
- Modifies: `somarEquipesNoIntervalo(registros, indices, demandas, inicioEpoch, fimEpoch)` — mesma assinatura, só o denominador interno muda.

- [ ] **Step 1: Escrever os testes**

```js
// Localizar o describe/bloco de testes existente pra somarEquipesNoIntervalo
// em test/semanal-render-aba-semanal.test.js (procurar "somarEquipesNoIntervalo"
// ou "Realizado de Equipes"); se não existir teste direto (a função não é
// exportada hoje -- só usada internamente por calcularSeriesSemanaisDimensao),
// testar através de calcularSeriesSemanaisDimensao com dimensao='equipes',
// que já é o padrão dos testes existentes deste arquivo.

test('semana cheia (segunda a sábado, 6 dias dentro do mês): denominador 6, não 7', () => {
  // segunda 03/08/2026 a domingo 09/08/2026 -- domingo (09) sai da conta
  var inicio = diaEpoch(new Date('2026-08-03T00:00:00Z'));
  var fimComDomingo = diaEpoch(new Date('2026-08-09T00:00:00Z'));
  // equipesPorDia com 1 equipe TODO santo dia da semana, inclusive domingo --
  // se o domingo entrasse na soma OU no denominador, o resultado mudaria.
  var demandas = { equipesPorDia: {} };
  var registros = [{ sup: 'SUP-A', tipologia: 'SP' }];
  var indices = [0];
  for (var d = inicio; d <= fimComDomingo; d++) {
    demandas.equipesPorDia['SUP-A||SP'] = demandas.equipesPorDia['SUP-A||SP'] || {};
    demandas.equipesPorDia['SUP-A||SP'][d] = 6; // 6 equipes todo dia -- soma seg-sáb = 36
  }
  var resultado = calcularSeriesSemanaisDimensao(
    registros, indices, 'equipes', 0,
    [{ inicio: inicio, fim: fimComDomingo }], 1, true, 0, demandas, fimComDomingo + 1
  );
  // 36 (soma seg-sáb, domingo tem 6 mas não deveria entrar) / 6 = 6 -- se o
  // denominador ainda fosse 7, ou se domingo entrasse na soma, daria outro
  // número.
  assert.equal(resultado.semanasRealizado[0], 6);
});
```

(Ajustar a chamada acima ao formato exato que os testes existentes do arquivo já usam para `calcularSeriesSemanaisDimensao` — ler 2-3 testes vizinhos antes de escrever, para casar os parâmetros posicionais exatamente.)

- [ ] **Step 2: Rodar e ver falhar (ou confirmar que já passa por coincidência, e então fortalecer o teste)**

Run: `node --test test/semanal-render-aba-semanal.test.js`

- [ ] **Step 3: Implementar o denominador novo**

Em `render-aba-semanal.js`, trocar `somarEquipesNoIntervalo`:

```js
// Dias da semana [inicioEpoch, fimEpoch] que NÃO são domingo -- domingo sai
// da conta (2026-08-10, decisão do dono do projeto: semana cheia = segunda
// a sábado, 6 dias). Se o recorte cair inteiro num domingo (acontece na
// borda do mês, quando a "semana" do calendário real tem só esse dia),
// esse domingo é contado sozinho em vez de dar denominador zero.
function diasUteisNoIntervalo(inicioEpoch, fimEpoch) {
  var dias = 0;
  var apenasDomingo = 0;
  for (var dia = inicioEpoch; dia <= fimEpoch; dia++) {
    var diaSemana = new Date(dia * 86400000).getUTCDay(); // 0 = domingo
    if (diaSemana === 0) { apenasDomingo++; continue; }
    dias++;
  }
  return dias > 0 ? dias : apenasDomingo;
}

function somarEquipesNoIntervalo(registros, indices, demandas, inicioEpoch, fimEpoch) {
  var equipesPorDia = demandas && demandas.equipesPorDia;
  if (!equipesPorDia || fimEpoch < inicioEpoch) return null;
  var totalDias = diasUteisNoIntervalo(inicioEpoch, fimEpoch);
  var somaTotal = 0;
  var achouAlgumaChave = false;
  for (var dia = inicioEpoch; dia <= fimEpoch; dia++) {
    if (new Date(dia * 86400000).getUTCDay() === 0 && totalDias > 0 && fimEpoch > inicioEpoch) continue; // domingo não soma quando há outro dia na semana
    (indices || []).forEach(function (i) {
      var registro = registros[i];
      if (!registro) return;
      var porDiaRegistro = equipesPorDia[chaveDemandas(registro.sup, registro.tipologia)];
      if (porDiaRegistro && typeof porDiaRegistro[dia] === 'number') {
        somaTotal += porDiaRegistro[dia];
        achouAlgumaChave = true;
      }
    });
  }
  if (!achouAlgumaChave) return null;
  return Math.ceil(somaTotal / totalDias);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/semanal-render-aba-semanal.test.js`
Expected: PASS

- [ ] **Step 5: Rodar a suíte inteira (Gráficos/Consolidado/Alertas também chamam `calcularSeriesSemanaisDimensao` com `dimensao='equipes'`)**

Run: `node --test test/*.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/render-aba-semanal.js test/semanal-render-aba-semanal.test.js
git commit -m "Realizado de Equipes: denominador vira dias úteis da semana (exclui domingo), não mais todos os dias"
```

---

### Task 8: Publicação — novo arquivo em `ARQUIVOS_PUBLICAR` e na trava de sincronismo

**Files:**
- Modify: `tools/semanal/atualizar-arquivos.js`
- Modify: `test/publicacao-docs-sincronizado.test.js`

- [ ] **Step 1: Adicionar `equipes-roster-online.csv` a `ARQUIVOS_PUBLICAR`**

```js
const ARQUIVOS_PUBLICAR = [
  'planejamento-semanal.html',
  'avancos-online.csv',
  'lab-online.csv',
  'equipes-online.csv',
  'equipes-roster-online.csv',
  'demandas-sondagem-online.csv',
  'demandas-lab-online.json',
];
```

- [ ] **Step 2: Ler o teste de sincronismo atual e replicar o padrão pro arquivo novo**

Run: `grep -n "equipes-online" test/publicacao-docs-sincronizado.test.js`

Adicionar o par `dist/equipes-roster-online.csv` / `docs/equipes-roster-online.csv` na mesma lista/loop que já cobre os outros CSVs (a asserção existente provavelmente itera um array de nomes — só adicionar `'equipes-roster-online.csv'` a esse array, seguindo o padrão exato já usado para `'equipes-online.csv'`).

- [ ] **Step 3: Rodar o teste**

Run: `node --test test/publicacao-docs-sincronizado.test.js`
Expected: PASS (o par `dist/docs` para o arquivo novo ainda não existe fisicamente até a Task 10 rodar o fetcher de verdade — se o teste depender de os dois arquivos EXISTIREM em vez de só comparar quando ambos existem, ajustar para o mesmo comportamento tolerante que os outros arquivos opcionais já têm; ler o teste antes de decidir).

- [ ] **Step 4: Commit**

```bash
git add tools/semanal/atualizar-arquivos.js test/publicacao-docs-sincronizado.test.js
git commit -m "Publica equipes-roster-online.csv junto com o resto (atualizar-arquivos.js + trava de sincronismo)"
```

---

### Task 9: Aposentar o espelho Apps Script e atualizar a documentação

**Files:**
- Delete: `tools/semanal/apps-script-espelho-eq.gs`
- Modify: `CLAUDE.md` (seção "Planejamento Semanal", subseções "Lab Realizado + Equipes online" e "Formato numérico da Tabela Semanal e Gráficos, bug do Realizado de Equipes")

- [ ] **Step 1: Remover o arquivo do espelho**

```bash
git rm tools/semanal/apps-script-espelho-eq.gs
```

- [ ] **Step 2: Atualizar `CLAUDE.md`**

Adicionar uma seção nova (depois de "Segunda rodada da Tabela Semanal..." e antes de "Pendências conhecidas"), resumindo:

```markdown
### Equipes Realizado: roster (Link 6) + produção (Link 7), com carry-forward (2026-08-10)

Ver a spec completa em
`docs/superpowers/specs/2026-08-10-equipes-realizado-roster-link6-link7-design.md`
e o plano em `docs/superpowers/plans/2026-08-10-equipes-realizado-roster-link6-link7.md`.

**"Realizado" de Equipes na Tabela Semanal deixou de vir do agregado
"PRODUTIVAS (Link 7)"** (2026-08-09) e passou a cruzar roster (Link 6, aba
"(EQ)") + produção crua (Link 7), com carry-forward de até 45 dias para
quem está ativo mas não produziu no dia (`tools/semanal/compute-equipes-realizado-alocado.js`).
"Ativa" ganhou definição nova, só para este cálculo: tudo exceto `fora`
(inclui `naoEquipe`) — Equipes Ativas/Não-produtivas continuam com a
definição antiga (`contaComoAtiva`, só `mobilizada`/`campoSemFuro`).

**O espelho Apps Script do roster (`apps-script-espelho-eq.gs`) foi
removido do repositório** — ele só publicava o mês corrente, e o backfill
anual do roster (pedido do dono do projeto) precisava de meses passados.
Substituído por descoberta de gid direto na planilha de origem
(`tools/comum/descobrir-abas-planilha.js`, porta de
`tools/matriz/discover-gids.js` do repositório-mãe) — lista as abas
`"AAAA - MÊS (EQ)"` via `.../htmlview` e baixa cada CSV por
`.../export?format=csv&gid=...`. **Desligar o gatilho de 30 min na conta
Google dona da Sheet espelho é passo manual, fora deste repositório**
(mesmo padrão já usado para aposentar o espelho de Avanços em 2026-08-05).

`dist/equipes-online.csv` (produção do Link 7) mudou de formato: era
`SUP,Tipo,DiaEpoch,Fracao` (pré-agregado), agora é `IdEquipe,SUP,Tipo,DiaEpoch`
(cru, um por equipe/dia/contrato) — a fração/alocação passou a ser
calculada no cruzamento com o roster, não mais no fetcher.
`dist/equipes-roster-online.csv` é o arquivo novo (`IdEquipe,DiaEpoch,Estado`,
multi-mês) — Ativas/Não-produtivas TAMBÉM passaram a ler dele (recorte do
mês corrente), em vez de buscar o espelho ao vivo dentro do build
(`buscarEspelhoEq` foi removido) — alinha com o padrão de todas as outras
fontes online deste projeto (exigem o fetcher ter rodado antes).

**Denominador do Realizado de Equipes mudou**: dias úteis da semana
(exclui domingo), não mais todos os dias — semana cheia divide por 6.
```

E, na subseção "Lab Realizado + Equipes online (2026-08-05)", adicionar uma nota de que o comando de atualização continua o mesmo (`node tools/semanal/atualizar-equipes-online.js`), mas agora também busca e publica o roster.

- [ ] **Step 3: Commit**

```bash
git add tools/semanal/apps-script-espelho-eq.gs CLAUDE.md
git commit -m "Aposenta o espelho Apps Script do roster; documenta o cruzamento roster+produção no CLAUDE.md"
```

---

### Task 10: Regressão completa + rodada real (build + publish)

**Files:** nenhum arquivo novo — só verificação.

- [ ] **Step 1: Suíte inteira**

Run: `node --test test/*.js`
Expected: PASS, 0 falhas (anotar o número total, mesmo padrão de "811/814" que sessões anteriores já registraram no CLAUDE.md)

- [ ] **Step 2: Rodar o fetcher de verdade**

Pré-requisitos (avisar o usuário se algum faltar, não travar a sessão tentando adivinhar):
- Chrome aberto com `--remote-debugging-port=9222`, logado em sond.com.br (perfil `C:\Users\supor\chrome-debug-profile` — ver `feedback_chrome_cdp_perfil_padrao_bloqueado` na memória).
- `ORCAMENTO_SENHA` (env var, nunca em arquivo).

```bash
ORCAMENTO_SENHA='...' node tools/semanal/atualizar-arquivos.js
```

Conferir no log: quantas linhas de produção e de roster foram buscadas, quantos meses de backfill, e se as buscas de Avanços/Lab/Demandas continuam OK (nenhuma delas deveria ter sido afetada por este plano).

- [ ] **Step 3: Verificar o "Realizado de Equipes" contra um exemplo real**

Igual ao padrão já usado em sessões anteriores (`decifrarComSenha` sobre o payload publicado, ver `feedback_preview_dashboard_sem_senha` na memória) — decifrar o HTML gerado e conferir que `demandas.equipesPorDia` tem pares (SUP, tipologia) plausíveis e que a Tabela Semanal mostra um número de Realizado de Equipes diferente de vazio/zero pro mês vigente.

- [ ] **Step 4: Confirmar publicação**

`atualizar-arquivos.js` já commita e dá push sozinho (regra permanente do projeto). Depois, `curl` na URL ao vivo (`https://amcaccere261283.github.io/orcamento-dashboard/planejamento-semanal.html`) e conferir que o HTML bate com o `dist/` recém-construído (mesmo cuidado que o CLAUDE.md do repositório-mãe manda, por causa do incidente de 2026-07-22 — o Pages pode reportar "built" sem ter pego o commit certo).

---

## Self-Review

**Cobertura da spec:**
- Formato cru da produção (Link 7) → Task 2. ✓
- Bloqueio do backfill do roster + descoberta de gid → Task 1 + Task 3. ✓
- Módulo de cruzamento (ativa/carry-forward/fração) → Task 4. ✓
- `build-dashboard.js` (Realizado + Ativas/Não-produtivas no mesmo arquivo publicado) → Task 5. ✓
- `render-semanal.js` (refresh) → Task 6. ✓
- Denominador (dias úteis, sem domingo) → Task 7. ✓
- Publicação/sincronismo → Task 8. ✓
- Aposentar o Apps Script + documentação → Task 9. ✓
- Verificação contra dado real, pedida explicitamente pelo usuário ("quero ver o produto final") → Task 10. ✓

**Placeholders:** nenhum "TBD"/"implementar depois" — toda task tem código completo. `equipesParaFormatoAbaEq`/síntese de texto (Task 5/6) é uma ponte deliberada, documentada, não um placeholder.

**Consistência de tipos:** `agregarEquipesRealizadoAlocado({roster, producao, janelaFallbackDias}) -> {porDia, foraDaJanela, ativos}` é usado com a mesma assinatura em `build-dashboard.js` (Task 5) e `render-semanal.js` (Task 6, via `ComputeEquipesRealizadoAlocado.agregarEquipesRealizadoAlocado`). `porDia` no formato `'SUP||Tipo' -> {dia: fração}` é o mesmo em todo lugar que hoje já lê `demandas.equipesPorDia`.
