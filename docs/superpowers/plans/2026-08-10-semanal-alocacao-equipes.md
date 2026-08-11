# Aba "Alocação Equipes" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Acrescentar à página `planejamento-semanal.html` uma sétima aba onde as equipes são arrastadas para os contratos numa matriz SUP × tipologia, com a demanda saindo da Tendência travada na semana e a alocação gravada numa planilha Google.

**Architecture:** Três módulos puros (`equipes-alocaveis.js`, `compute-alocacao.js`, `alocacao-sheet.js`) testados em Node e embrulhados para o navegador pelo `browser-bundle.js` existente; um módulo de desenho (`render-aba-alocacao.js`) no padrão de `render-aba-balanco.js`; e a interação de arrasto no script de cliente de `render-semanal.js`. Nenhuma fonte de dados nova: o roster da aba EQ já é baixado pelo build **e** pelo live-refresh.

**Tech Stack:** Node.js puro (`node --test`), JavaScript de navegador sem biblioteca, Google Apps Script para o endpoint de gravação.

**Spec:** `docs/superpowers/specs/2026-08-10-semanal-alocacao-equipes-design.md` — leia antes da Task 1.

## Global Constraints

- **Sem dependências.** Não existe `npm install` neste repositório e não vai passar a existir. Nada de biblioteca de drag-and-drop.
- **Testes offline.** `node --test test/*.test.js` roda sem rede e sem `G:`. Nenhum teste novo pode buscar URL nem ler planilha real.
- **Módulos duais (Node + navegador)** — `equipes-alocaveis.js`, `compute-alocacao.js`, `alocacao-sheet.js`: use `var`/`function`, **nunca** `const`/`let`/arrow no escopo do módulo, e requires no formato exato `const { X } = require('./arquivo.js');` (mesmo diretório, uma linha). É o que `transformaModulo` (`tools/comum/browser-bundle.js`) reconhece.
- **A ordem de `BUNDLE_ARQUIVOS` é o contrato de dependência** (`render-semanal.js`). Um módulo só pode aparecer depois de tudo que ele consome via require same-dir.
- **`require('../comum/...')` é REMOVIDO pelo bundler.** O nome destruturado precisa existir como global na página, injetado por um `<script>` de `fonteParaCliente()` ANTES do bundle.
- **Build:** `ORCAMENTO_SENHA='...' node tools/semanal/build-dashboard.js`. A senha nunca vai para arquivo do repositório.
- **`cp dist/planejamento-semanal.html docs/planejamento-semanal.html` antes de commitar** — o Pages serve `/docs`. `test/publicacao-docs-sincronizado.test.js` trava isso.
- **Textos de tela em português (pt-BR).**
- **Nomes de colunas de tipologia, exatos:** `SP`, `SM / SM.F / SR`, `ST`, `PI`, `BL`, `Especiais` (esta última cobrindo `CPTu`, `SH`, `VT`).
- **Nunca use `produtividadeEsperada()` de `render-aba-consolidado.js`** como referência de produtividade. Use `premissaProdutividadeDoGrupo` de `render-alertas-tendencia.js`. O motivo está no `CLAUDE.md` e na Decisão 3 do spec.
- **Commits em português**, no estilo do histórico do repositório.

---

### Task 1: `equipes-alocaveis.js` — do roster da aba EQ para as equipes do quadro

**Files:**
- Create: `tools/semanal/equipes-alocaveis.js`
- Test: `test/semanal-equipes-alocaveis.test.js`

**Interfaces:**
- Consumes: `parseAbaEq` e `RE_COLUNA_DIA` de `./compute-equipes-ativas.js`; `classificarDiaEquipe` e `contaComoAtiva` de `./classificar-dia-equipe.js`.
- Produces:
  - `COLUNAS_ALOCACAO` — array ordenado de `{ id, rotulo, tipologias: [] }`
  - `COLUNAS_POR_SERVICO` — mapa `Serviços` → array de ids de coluna
  - `colunasDaEquipe(servicos)` → `{ colunas: [], motivoFora: null }` ou `{ colunas: [], motivoFora: 'texto' }`
  - `equipesDoQuadro(roster, opcoes)` → `{ equipes: [], foraDoQuadro: [] }`, com cada equipe em `{ id, lider, servicos, colunas, polivalente, diasDisponiveis, diasDaSemana, disponivel, supRealizado, colunaRealizada, popup }`

- [ ] **Step 1: Escreva o teste que falha (colunas por serviço)**

Crie `test/semanal-equipes-alocaveis.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  COLUNAS_ALOCACAO, colunasDaEquipe, equipesDoQuadro,
} = require('../tools/semanal/equipes-alocaveis.js');

test('as 6 colunas do quadro, na ordem canônica, com as tipologias da MATRIZ que cada uma cobre', () => {
  assert.deepStrictEqual(COLUNAS_ALOCACAO.map((c) => c.id),
    ['SP', 'SM / SM.F / SR', 'ST', 'PI', 'BL', 'Especiais']);
  const especiais = COLUNAS_ALOCACAO.find((c) => c.id === 'Especiais');
  assert.deepStrictEqual(especiais.tipologias, ['CPTu', 'SH', 'VT']);
  const bl = COLUNAS_ALOCACAO.find((c) => c.id === 'BL');
  assert.deepStrictEqual(bl.tipologias, ['BL'], 'BL é coluna própria, não entra em Especiais');
});

test('serviço simples resolve para uma coluna só', () => {
  assert.deepStrictEqual(colunasDaEquipe('SM'), { colunas: ['SM / SM.F / SR'], motivoFora: null });
  assert.deepStrictEqual(colunasDaEquipe('SP'), { colunas: ['SP'], motivoFora: null });
});

test('CPTu | VT | SH vira a coluna Especiais -- uma só, não três', () => {
  assert.deepStrictEqual(colunasDaEquipe('CPTu | VT | SH'), { colunas: ['Especiais'], motivoFora: null });
});

test('ST | PI | BL e SP/SM são polivalentes: aceitam mais de uma coluna', () => {
  assert.deepStrictEqual(colunasDaEquipe('ST | PI | BL').colunas, ['ST', 'PI', 'BL']);
  assert.deepStrictEqual(colunasDaEquipe('SP/SM').colunas, ['SP', 'SM / SM.F / SR']);
});

test('Lab, TST e SN ficam fora do quadro COM motivo -- nunca somem calados', () => {
  for (const servico of ['Lab', 'TST', 'SN']) {
    const r = colunasDaEquipe(servico);
    assert.deepStrictEqual(r.colunas, []);
    assert.ok(r.motivoFora && r.motivoFora.length > 0, `${servico} precisa de motivo`);
  }
});

test('serviço NOVO não derruba nada: fica fora do quadro com o texto cru no motivo', () => {
  // Diferente de rotularTipologia (tools/comum/tipologias-avancos.js), que
  // LANÇA em rótulo desconhecido. Aqui um texto novo na coluna Serviços não
  // pode matar a página inteira -- mas tem de aparecer.
  const r = colunasDaEquipe('SONDAGEM AQUATICA');
  assert.deepStrictEqual(r.colunas, []);
  assert.match(r.motivoFora, /SONDAGEM AQUATICA/);
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `node --test test/semanal-equipes-alocaveis.test.js`
Expected: FAIL — `Cannot find module '../tools/semanal/equipes-alocaveis.js'`

- [ ] **Step 3: Implemente as colunas**

Crie `tools/semanal/equipes-alocaveis.js`:

```js
'use strict';
const { parseAbaEq } = require('./compute-equipes-ativas.js');
const { classificarDiaEquipe, contaComoAtiva } = require('./classificar-dia-equipe.js');

// Este módulo roda no Node (build/testes) e no navegador (bundle) -- por isso
// 'var'/'function' e os requires acima na forma EXATA que transformaModulo
// (tools/comum/browser-bundle.js) reconhece.
//
// DO ROSTER DA ABA EQ PARA AS EQUIPES DO QUADRO
// ===========================================================================
// Ver docs/superpowers/specs/2026-08-10-semanal-alocacao-equipes-design.md,
// Decisão 1.

// As colunas do quadro são GRUPOS DE TIPOLOGIA DE EQUIPE, não as 10 tipologias
// cruas da MATRIZ. 'Especiais' junta CPTu+SH+VT (decisão do dono do projeto);
// BL fica em coluna própria porque quem a atende são as equipes 'ST | PI | BL',
// e enfiá-la em Especiais criaria uma coluna que as equipes dela não servem.
var COLUNAS_ALOCACAO = [
  { id: 'SP', rotulo: 'SP', tipologias: ['SP'] },
  { id: 'SM / SM.F / SR', rotulo: 'SM / SM.F / SR', tipologias: ['SM / SM.F / SR'] },
  { id: 'ST', rotulo: 'ST', tipologias: ['ST'] },
  { id: 'PI', rotulo: 'PI', tipologias: ['PI'] },
  { id: 'BL', rotulo: 'BL', tipologias: ['BL'] },
  { id: 'Especiais', rotulo: 'Especiais', tipologias: ['CPTu', 'SH', 'VT'] },
];

// Os 9 valores distintos da coluna 'Serviços' medidos na aba EQ em 2026-08-10,
// mais 'BL' e 'SN' por completude. Array com MAIS DE UMA coluna = polivalente:
// a equipe pode ser solta em qualquer uma delas, e quem decide é quem arrasta
// (ver spec, Decisão 1 -- substitui a heurística casarSondador, que falha em
// 25 das 117 equipes).
var COLUNAS_POR_SERVICO = {
  SM: ['SM / SM.F / SR'],
  SP: ['SP'],
  ST: ['ST'],
  PI: ['PI'],
  BL: ['BL'],
  'CPTu | VT | SH': ['Especiais'],
  'ST | PI | BL': ['ST', 'PI', 'BL'],
  'SP/SM': ['SP', 'SM / SM.F / SR'],
};

// Serviços que existem na planilha e NÃO entram no quadro, com o motivo que
// aparece na lista "fora do quadro".
var FORA_DO_QUADRO = {
  Lab: 'Laboratório tem fonte própria e não é equipe de campo de sondagem',
  TST: 'Serviço de teste, sem demanda correspondente na MATRIZ',
  SN: 'Sem demanda correspondente na MATRIZ',
};

// Serviço desconhecido NÃO lança, ao contrário de rotularTipologia
// (tools/comum/tipologias-avancos.js): um texto novo digitado na planilha de
// equipes não pode derrubar a página inteira. Mas também não some -- a equipe
// vai para a lista "fora do quadro" com o texto cru no motivo, visível na tela.
function colunasDaEquipe(servicos) {
  var s = String(servicos === null || servicos === undefined ? '' : servicos).trim();
  if (!s) return { colunas: [], motivoFora: 'Sem serviço preenchido na aba EQ' };
  if (Object.prototype.hasOwnProperty.call(COLUNAS_POR_SERVICO, s)) {
    return { colunas: COLUNAS_POR_SERVICO[s].slice(), motivoFora: null };
  }
  if (Object.prototype.hasOwnProperty.call(FORA_DO_QUADRO, s)) {
    return { colunas: [], motivoFora: FORA_DO_QUADRO[s] };
  }
  return { colunas: [], motivoFora: 'Serviço não catalogado: "' + s + '"' };
}

module.exports = { COLUNAS_ALOCACAO, COLUNAS_POR_SERVICO, colunasDaEquipe };
```

- [ ] **Step 4: Rode e veja passar**

Run: `node --test test/semanal-equipes-alocaveis.test.js`
Expected: PASS (6 testes)

- [ ] **Step 5: Escreva o teste de `equipesDoQuadro`**

Acrescente ao mesmo arquivo de teste:

```js
// --- equipesDoQuadro -------------------------------------------------------

// Cabeçalho REAL da aba EQ (medido em 2026-08-10): ID | Equipe | Habilitação |
// Serviços | Líderes | Veículo | Proprietário | Equipamento x5 | Tenda |
// Tomador | sinalização 3P | <dias>. A linha 1 é sub-cabeçalho.
const CSV_EQ = [
  'ID,Equipe,Habilitação,Serviços,Líderes,Veículo,Proprietário,Equipamento,Equipamento,Equipamento,Equipamento,Equipamento,Tenda - nova estrutura,Tomador,sinalização 3P,10/08/2026,11/08/2026,12/08/2026,13/08/2026,14/08/2026',
  ',,do condutor,-,-,-,-,Kit Especiais,Kit BL e PI,Kit ST,Kit SP,Kit SR,Nova estrutura,-,,SEGUNDA,TERÇA,QUARTA,QUINTA,SEXTA',
  '4,José I. Amaral,D,SM,Amaral,SUH-6F44 (D9p),Suporte,N/A,N/A,N/A,Próprio,Próprio,,CCR RioSP,RioSP,RioSP (16925-25),OK,OK,OK,OK',
  '59,Paulo S. Lima,D,SP,Paulo S.,EYX 4G65,Suporte,N/A,N/A,Hilf-019,Próprio,Próprio,,Quadrante,OK,Férias,Férias,Férias,Férias,Férias',
  '88,Edy I. Gomes,D,ST | PI | BL,Edy I.,ABC 1234,Próprio,N/A,Kit,N/A,N/A,N/A,,Sorocabana,,Baixada,Baixada,Sorocabana (17746-26),OK,OK',
  '200,Ana L. Souza,D,Lab,Ana L.,-,-,N/A,N/A,N/A,N/A,N/A,,-,,OK,OK,OK,OK,OK',
].join('\n');

const SEMANA = { inicio: diaEpochDe(2026, 8, 10), fim: diaEpochDe(2026, 8, 16) };
function diaEpochDe(ano, mes, dia) { return Math.floor(Date.UTC(ano, mes - 1, dia) / 86400000); }

const OS_PARA_SUP = { '16925-25': 'SUP-7128-24', '17746-26': 'SUP-7133-24' };

test('equipesDoQuadro monta as equipes com colunas, disponibilidade e popup', () => {
  const { equipes } = equipesDoQuadro(CSV_EQ, {
    ano: 2026, mes: 8, semana: SEMANA, osParaSup: OS_PARA_SUP,
  });
  const porId = Object.fromEntries(equipes.map((e) => [e.id, e]));

  assert.strictEqual(porId['4'].lider, 'Amaral', 'o rótulo do cartão é a coluna Líderes (curta), não Equipe');
  assert.deepStrictEqual(porId['4'].colunas, ['SM / SM.F / SR']);
  assert.strictEqual(porId['4'].polivalente, false);
  assert.strictEqual(porId['4'].disponivel, true);
  assert.strictEqual(porId['4'].diasDisponiveis, 5, 'os 5 dias da semana estão ativos');
  assert.strictEqual(porId['4'].popup.veiculo, 'SUH-6F44 (D9p)');
  assert.strictEqual(porId['4'].popup.proprietario, 'Suporte');
  assert.strictEqual(porId['4'].popup.tomador, 'CCR RioSP');
});

test('equipe de férias a semana inteira não é arrastável', () => {
  const { equipes } = equipesDoQuadro(CSV_EQ, { ano: 2026, mes: 8, semana: SEMANA, osParaSup: OS_PARA_SUP });
  const eq59 = equipes.find((e) => e.id === '59');
  assert.strictEqual(eq59.diasDisponiveis, 0);
  assert.strictEqual(eq59.disponivel, false);
});

test('disponibilidade PARCIAL conta só os dias em campo', () => {
  // Equipe 88: 2 dias Baixada + 3 dias em campo.
  const { equipes } = equipesDoQuadro(CSV_EQ, { ano: 2026, mes: 8, semana: SEMANA, osParaSup: OS_PARA_SUP });
  const eq88 = equipes.find((e) => e.id === '88');
  assert.strictEqual(eq88.diasDisponiveis, 3);
  assert.strictEqual(eq88.disponivel, true);
  assert.strictEqual(eq88.polivalente, true);
});

test('supRealizado sai da ÚLTIMA OS vista, e o dia ativo sem OS herda a anterior', () => {
  const { equipes } = equipesDoQuadro(CSV_EQ, { ano: 2026, mes: 8, semana: SEMANA, osParaSup: OS_PARA_SUP });
  const porId = Object.fromEntries(equipes.map((e) => [e.id, e]));
  // Equipe 4: OS só na segunda, OK nos outros 4 dias -- o vínculo não se rompe.
  assert.strictEqual(porId['4'].supRealizado, 'SUP-7128-24');
  assert.strictEqual(porId['4'].colunaRealizada, 'SM / SM.F / SR');
  // Equipe 88: OS na quarta -- polivalente, cai numa das colunas dela.
  assert.strictEqual(porId['88'].supRealizado, 'SUP-7133-24');
  assert.ok(porId['88'].colunas.indexOf(porId['88'].colunaRealizada) !== -1);
});

test('equipe sem OS nenhuma nasce no pool -- supRealizado null, nunca chutado', () => {
  const csv = CSV_EQ.split('\n').filter((l) => !l.startsWith('4,') && !l.startsWith('88,')).join('\n');
  const { equipes } = equipesDoQuadro(csv, { ano: 2026, mes: 8, semana: SEMANA, osParaSup: OS_PARA_SUP });
  const eq59 = equipes.find((e) => e.id === '59');
  assert.strictEqual(eq59.supRealizado, null);
  assert.strictEqual(eq59.colunaRealizada, null);
});

test('Lab sai do quadro e aparece em foraDoQuadro com o motivo', () => {
  const { equipes, foraDoQuadro } = equipesDoQuadro(CSV_EQ, {
    ano: 2026, mes: 8, semana: SEMANA, osParaSup: OS_PARA_SUP,
  });
  assert.strictEqual(equipes.find((e) => e.id === '200'), undefined);
  const fora = foraDoQuadro.find((e) => e.id === '200');
  assert.ok(fora, 'a equipe de Lab tem de aparecer na lista de fora');
  assert.match(fora.motivo, /[Ll]aborat/);
});
```

- [ ] **Step 6: Rode e veja falhar**

Run: `node --test test/semanal-equipes-alocaveis.test.js`
Expected: FAIL — `equipesDoQuadro is not a function`

- [ ] **Step 7: Implemente `equipesDoQuadro`**

Acrescente a `tools/semanal/equipes-alocaveis.js`, antes do `module.exports`:

```js
var COL_LIDER = 4;
var COL_HABILITACAO = 2;
var COL_VEICULO = 5;
var COL_PROPRIETARIO = 6;
var COL_EQUIPAMENTO = [7, 8, 9, 10, 11];
var COL_TENDA = 12;
var COL_TOMADOR = 13;
var COL_SINALIZACAO = 14;

// parseAbaEq (compute-equipes-ativas.js) já devolve id/nome/servicos/dias, mas
// não os campos do popup nem a coluna Líderes -- então esta função lê a grade
// de novo para eles. Não vale mudar parseAbaEq: ela alimenta o Balanço, e
// acrescentar campos lá aumentaria o payload de todo mundo por causa de uma aba.
function camposDoPopup(linha) {
  var equipamentos = [];
  for (var i = 0; i < COL_EQUIPAMENTO.length; i++) {
    var valor = String(linha[COL_EQUIPAMENTO[i]] || '').trim();
    if (valor && valor.toUpperCase() !== 'N/A') equipamentos.push(valor);
  }
  return {
    habilitacao: String(linha[COL_HABILITACAO] || '').trim(),
    veiculo: String(linha[COL_VEICULO] || '').trim(),
    proprietario: String(linha[COL_PROPRIETARIO] || '').trim(),
    equipamentos: equipamentos,
    tenda: String(linha[COL_TENDA] || '').trim(),
    tomador: String(linha[COL_TOMADOR] || '').trim(),
    sinalizacao3p: String(linha[COL_SINALIZACAO] || '').trim(),
  };
}

function diaEpochDoDia(ano, mes, dia) {
  return Math.floor(Date.UTC(ano, mes - 1, dia) / 86400000);
}

// A coluna em que uma equipe POLIVALENTE cai ao ser semeada pelo realizado:
// entre as colunas dela, a primeira (ordem canônica de COLUNAS_ALOCACAO) que
// tenha demanda naquele SUP. Sem nenhuma, a primeira da lista dela. Nunca
// devolve coluna fora do conjunto da equipe.
function colunaSemeada(colunas, sup, temDemanda) {
  if (!colunas.length) return null;
  for (var i = 0; i < COLUNAS_ALOCACAO.length; i++) {
    var id = COLUNAS_ALOCACAO[i].id;
    if (colunas.indexOf(id) === -1) continue;
    if (temDemanda && temDemanda(sup, id)) return id;
  }
  return colunas[0];
}

// csvEq: o texto CSV da Sheet espelho da aba EQ.
// opcoes: { ano, mes, semana: {inicio, fim}, osParaSup, temDemanda }
//   temDemanda(sup, colunaId) -> bool, OPCIONAL, só para desempatar a coluna
//   de uma equipe polivalente semeada pelo realizado.
function equipesDoQuadro(csvEq, opcoes) {
  var o = opcoes || {};
  var roster = parseAbaEq(csvEq || '');
  var grade = linhasCruas(csvEq || '');
  var osParaSup = o.osParaSup || {};
  var equipes = [];
  var foraDoQuadro = [];
  var diasDaSemana = o.semana ? (o.semana.fim - o.semana.inicio + 1) : 0;

  roster.forEach(function (bruta, indice) {
    var resolvido = colunasDaEquipe(bruta.servicos);
    var linha = grade[indice] || [];
    var lider = String(linha[COL_LIDER] || '').trim() || bruta.nome;

    if (!resolvido.colunas.length) {
      foraDoQuadro.push({
        id: bruta.id, lider: lider, servicos: bruta.servicos, motivo: resolvido.motivoFora,
      });
      return;
    }

    // Disponibilidade e vínculo com o SUP saem do MESMO varrimento dos dias.
    // O vínculo olha o mês inteiro até o fim da semana (a última OS vista
    // continua valendo nos dias ativos sem OS -- mesma regra de
    // agregarEquipesAtivas); a disponibilidade olha SÓ os dias da semana.
    var diasDisponiveis = 0;
    var ultimoSup = null;
    bruta.dias.forEach(function (d) {
      var epoch = diaEpochDoDia(o.ano, o.mes, d.dia);
      if (o.semana && epoch > o.semana.fim) return;
      var classe = classificarDiaEquipe(d.texto);
      if (!classe) return;
      if (!contaComoAtiva(classe.estado)) return;
      if (classe.os && osParaSup[classe.os]) ultimoSup = osParaSup[classe.os];
      if (o.semana && epoch >= o.semana.inicio) diasDisponiveis += 1;
    });

    equipes.push({
      id: bruta.id,
      lider: lider,
      nome: bruta.nome,
      servicos: bruta.servicos,
      colunas: resolvido.colunas,
      polivalente: resolvido.colunas.length > 1,
      diasDisponiveis: diasDisponiveis,
      diasDaSemana: diasDaSemana,
      disponivel: diasDisponiveis > 0,
      supRealizado: ultimoSup,
      colunaRealizada: ultimoSup ? colunaSemeada(resolvido.colunas, ultimoSup, o.temDemanda) : null,
      popup: camposDoPopup(linha),
    });
  });

  return { equipes: equipes, foraDoQuadro: foraDoQuadro };
}
```

E acrescente o helper que lê a grade crua, logo depois dos requires:

```js
// parseAbaEq não devolve a linha crua, e o popup precisa de 8 colunas que ela
// não carrega. Reaproveitar parseCsvGrid direto criaria um segundo require
// same-dir (parse-matriz-cliente.js) só para isso -- e a ordem do bundle já
// garante que compute-equipes-ativas.js veio antes, então basta reexportar
// dali. Ver Step 8.
function linhasCruas(csvTexto) {
  return linhasDaAbaEq(csvTexto);
}
```

- [ ] **Step 8: Exporte `linhasDaAbaEq` de `compute-equipes-ativas.js`**

Em `tools/semanal/compute-equipes-ativas.js`, acrescente esta função logo depois de `parseAbaEq` e inclua-a no `module.exports`:

```js
// A grade crua a partir da linha 2 (as duas primeiras são cabeçalho e
// sub-cabeçalho), na MESMA ordem que parseAbaEq devolve as equipes -- inclusive
// pulando as linhas sem ID, para que o índice de uma bata com o da outra.
// Existe para equipes-alocaveis.js ler as colunas do popup sem duplicar o
// parser de CSV nem inchar o retorno de parseAbaEq, que alimenta o Balanço.
function linhasDaAbaEq(csvTexto) {
  var grid = parseCsvGrid(csvTexto || '');
  var linhas = [];
  for (var r = 2; r < grid.length; r++) {
    var linha = grid[r] || [];
    var id = String(linha[COL_ID] === null || linha[COL_ID] === undefined ? '' : linha[COL_ID]).trim();
    if (!id) continue;
    linhas.push(linha);
  }
  return linhas;
}
```

E em `equipes-alocaveis.js` troque o require e o helper:

```js
const { parseAbaEq, linhasDaAbaEq } = require('./compute-equipes-ativas.js');
```

Apague a função `linhasCruas` e use `linhasDaAbaEq(csvEq || '')` direto em `equipesDoQuadro`.

- [ ] **Step 9: Atualize o `module.exports`**

```js
module.exports = {
  COLUNAS_ALOCACAO, COLUNAS_POR_SERVICO, colunasDaEquipe, equipesDoQuadro,
};
```

- [ ] **Step 10: Rode a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS — os 12 testes novos e nenhuma regressão em `semanal-compute-equipes-ativas.test.js`

- [ ] **Step 11: Commit**

```bash
git add tools/semanal/equipes-alocaveis.js tools/semanal/compute-equipes-ativas.js test/semanal-equipes-alocaveis.test.js
git commit -m "Alocacao: roster da aba EQ vira equipes do quadro, com colunas e disponibilidade"
```

---

### Task 2: Corrigir o bug de tabela que engole as 7 equipes de Especiais

**Files:**
- Modify: `tools/semanal/compute-equipes-ativas.js` (função `agregarEquipesAtivas`, o helper `traduzir`)
- Test: `test/semanal-compute-equipes-ativas.test.js`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `agregarEquipesAtivas` passa a apropriar as equipes de `CPTu | VT | SH`. Nenhuma assinatura muda.

**Contexto:** `TIPOLOGIA_DIRETA['CPTu | VT | SH']` devolve a string `'Especiais'`; `traduzir` a passa para `rotularTipologia`, que **lança** (`ESPECIAIS` não é chave de `MAPA_TIPOLOGIAS`); o `try/catch` engole e devolve `null`. Resultado: as 7 equipes contam como `semTipologia` e ficam fora do Δ equipes do Balanço, em silêncio.

- [ ] **Step 1: Escreva o teste que falha**

Acrescente a `test/semanal-compute-equipes-ativas.test.js`:

```js
const { agregarEquipesAtivas } = require('../tools/semanal/compute-equipes-ativas.js');
const { rotularTipologia } = require('../tools/comum/tipologias-avancos.js');

test('equipe CPTu | VT | SH é apropriada, não cai em semTipologia', () => {
  // Regressão de 2026-08-10: TIPOLOGIA_DIRETA devolvia 'Especiais',
  // rotularTipologia lançava, o try/catch engolia, e as 7 equipes de Especiais
  // sumiam da conta sem nenhum aviso.
  const equipes = [{
    id: '175', nome: 'João dos Santos', servicos: 'CPTu | VT | SH',
    dias: [{ dia: 1, texto: 'CCR RioSP (16925-25)' }, { dia: 2, texto: 'OK' }],
  }];
  const r = agregarEquipesAtivas({
    equipes, osParaSup: { '16925-25': 'SUP-7128-24' },
    rotularTipologia, ano: 2026, mes: 8,
  });
  assert.strictEqual(r.semTipologia, 0, 'nenhuma equipe pode sobrar sem tipologia aqui');
  const chaves = Object.keys(r.porDia);
  assert.deepStrictEqual(chaves, ['SUP-7128-24||Especiais']);
  const dias = r.porDia['SUP-7128-24||Especiais'];
  assert.strictEqual(Object.values(dias).reduce((a, b) => a + b, 0), 2);
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `node --test test/semanal-compute-equipes-ativas.test.js`
Expected: FAIL — `semTipologia` vem `2` e `porDia` vem `{}`

- [ ] **Step 3: Corrija `traduzir`**

Em `tools/semanal/compute-equipes-ativas.js`, dentro de `agregarEquipesAtivas`, substitua a função `traduzir` por:

```js
  // 'Especiais' JÁ É um rótulo da MATRIZ (ORDEM_TIPOLOGIAS, tools/comum/
  // tipologias-avancos.js) -- passá-lo por rotularTipologia LANÇA, porque o
  // mapa traduz rótulos CRUS do Avanço Sond, e 'ESPECIAIS' não é um deles.
  // Até 2026-08-10 o try/catch abaixo engolia essa exceção e devolvia null,
  // e as 7 equipes de 'CPTu | VT | SH' contavam como semTipologia -- some da
  // conta sem erro, sem log, sem nada na tela. Rótulo que já é de destino
  // passa direto.
  var JA_TRADUZIDAS = ['Especiais', 'SEG.A', 'SEG.V'];
  function traduzir(tipologia) {
    if (!tipologia) return null;
    if (JA_TRADUZIDAS.indexOf(tipologia) !== -1) return tipologia;
    try { return rotular(tipologia); } catch (err) { return null; }
  }
```

- [ ] **Step 4: Rode e veja passar**

Run: `node --test test/semanal-compute-equipes-ativas.test.js`
Expected: PASS

- [ ] **Step 5: Rode a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS. Se `semanal-compute-balanco.test.js` quebrar, é porque uma fixture contava com o número errado — corrija a fixture, não a lógica.

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/compute-equipes-ativas.js test/semanal-compute-equipes-ativas.test.js
git commit -m "Equipes ativas: as 7 equipes de Especiais deixam de sumir da conta"
```

---

### Task 3: `compute-alocacao.js` — capacidade, rateio e ocupação

**Files:**
- Create: `tools/semanal/compute-alocacao.js`
- Test: `test/semanal-compute-alocacao.test.js`

**Interfaces:**
- Consumes: `diasNaSemana` de `./compute-semanal.js`; `DIAS_PREMISSA_MES` de `../comum/calculo-equipes.js` (require que o bundler REMOVE — chega como global).
- Produces:
  - `diasPremissaDaSemana(mesIdx, diasDisponiveis, diasDoMes)` → número
  - `capacidadeDaEquipe(equipe, premissaProd, mesIdx, diasDoMes)` → número
  - `ratearCarga(tendencia, capacidades)` → array de números na mesma ordem
  - `FAIXA_OCUPACAO` → `{ folga: 0.85, sobrecarga: 1.05 }`
  - `classificarOcupacao(ocupacao)` → `'folga' | 'equilibrada' | 'sobrecarregada' | 'livre'`

- [ ] **Step 1: Escreva o teste que falha**

Crie `test/semanal-compute-alocacao.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  diasPremissaDaSemana, capacidadeDaEquipe, ratearCarga, classificarOcupacao,
} = require('../tools/semanal/compute-alocacao.js');

// Agosto (mesIdx 7): DIAS_PREMISSA_MES = 30. Um mês repartido em semanas reais
// soma 31 dias em agosto/2026 (semanasDoMes corta sempre dentro do mês).

test('dias de premissa da semana saem da PREMISSA, não do calendário', () => {
  // 5 dias disponíveis de um mês de 31 dias, premissa 30 -> 30 * 5/31
  assert.ok(Math.abs(diasPremissaDaSemana(7, 5, 31) - (30 * 5 / 31)) < 1e-9);
});

test('equipe indisponível a semana toda tem 0 dias de premissa', () => {
  assert.strictEqual(diasPremissaDaSemana(7, 0, 31), 0);
});

test('mês sem premissa ou sem dias devolve 0, nunca NaN', () => {
  assert.strictEqual(diasPremissaDaSemana(7, 5, 0), 0);
  assert.strictEqual(diasPremissaDaSemana(-1, 5, 31), 0);
});

test('capacidade = premissa PROD x dias de premissa da semana', () => {
  const equipe = { diasDisponiveis: 5 };
  const c = capacidadeDaEquipe(equipe, 2, 7, 31);
  assert.ok(Math.abs(c - 2 * (30 * 5 / 31)) < 1e-9);
});

test('sem premissa de produtividade, a capacidade é null -- nunca zero', () => {
  // Zero leria como "esta equipe não produz". null leria como "não sei",
  // que é a verdade, e a tela mostra "sem dado".
  assert.strictEqual(capacidadeDaEquipe({ diasDisponiveis: 5 }, null, 7, 31), null);
});

test('rateio ponderado pela capacidade', () => {
  assert.deepStrictEqual(ratearCarga(30, [10, 20]), [10, 20]);
});

test('capacidades iguais degeneram em divisão igual', () => {
  assert.deepStrictEqual(ratearCarga(30, [15, 15]), [15, 15]);
});

test('rateio com capacidade total zero devolve zeros -- nunca divide por zero', () => {
  assert.deepStrictEqual(ratearCarga(30, [0, 0]), [0, 0]);
});

test('rateio sem equipe nenhuma devolve lista vazia', () => {
  assert.deepStrictEqual(ratearCarga(30, []), []);
});

test('a soma do rateio é exatamente a tendência', () => {
  const partes = ratearCarga(37, [11, 7, 3]);
  assert.ok(Math.abs(partes.reduce((a, b) => a + b, 0) - 37) < 1e-9);
});

test('faixas de ocupação', () => {
  assert.strictEqual(classificarOcupacao(0), 'livre');
  assert.strictEqual(classificarOcupacao(0.60), 'folga');
  assert.strictEqual(classificarOcupacao(0.85), 'equilibrada');
  assert.strictEqual(classificarOcupacao(1.05), 'equilibrada');
  assert.strictEqual(classificarOcupacao(1.27), 'sobrecarregada');
  assert.strictEqual(classificarOcupacao(null), 'livre');
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `node --test test/semanal-compute-alocacao.test.js`
Expected: FAIL — `Cannot find module '../tools/semanal/compute-alocacao.js'`

- [ ] **Step 3: Implemente**

Crie `tools/semanal/compute-alocacao.js`:

```js
'use strict';
const { DIAS_PREMISSA_MES } = require('../comum/calculo-equipes.js');

// Módulo dual (Node + navegador). O require de '../comum/' acima é REMOVIDO
// pelo bundler (transformaModulo, tools/comum/browser-bundle.js): no navegador
// DIAS_PREMISSA_MES chega como global pelo <script> de fonteParaCliente(), que
// já é injetado ANTES do bundle. No Node o require resolve normalmente.
//
// A CONTA DA ALOCAÇÃO
// ===========================================================================
// Ver docs/superpowers/specs/2026-08-10-semanal-alocacao-equipes-design.md,
// Decisão 3.

var FAIXA_OCUPACAO = { folga: 0.85, sobrecarga: 1.05 };

// A premissa de dias úteis do mês (30, ou 15 em Jan/Dez) recortada na fração
// da semana que a equipe está disponível. Dias de CALENDÁRIO aqui fariam esta
// conta discordar da coluna "Produtividade média esperada" do Consolidado, que
// é a mesma premissa vista de outro ângulo -- mesmo raciocínio de
// diasPremissaRestantes (compute-alertas-tendencia.js).
//
// diasDoMes é a soma de diasNaSemana sobre as semanas do mês (o mesmo
// diasDoMesNasSemanas de render-alertas-tendencia.js), NÃO os dias do
// calendário: as semanas são sempre cortadas dentro do mês, e os dois só
// coincidem por acidente.
function diasPremissaDaSemana(mesIdx, diasDisponiveis, diasDoMes) {
  var premissa = DIAS_PREMISSA_MES[mesIdx];
  if (!premissa || !diasDoMes || !diasDisponiveis) return 0;
  return premissa * diasDisponiveis / diasDoMes;
}

// null (não zero) quando não há premissa de produtividade: zero leria como
// "esta equipe não produz", e a verdade é "não sei". A tela mostra "sem dado".
function capacidadeDaEquipe(equipe, premissaProd, mesIdx, diasDoMes) {
  if (premissaProd === null || premissaProd === undefined) return null;
  var dias = diasPremissaDaSemana(mesIdx, (equipe && equipe.diasDisponiveis) || 0, diasDoMes);
  return premissaProd * dias;
}

// Reparte a demanda da célula entre as equipes que estão nela, PROPORCIONAL à
// capacidade de cada uma. Com todo mundo inteiro na semana as capacidades são
// iguais (mesma célula => mesma premissa) e isto degenera em divisão igual,
// como deve; com uma equipe de 3 de 5 dias, ela puxa menos.
function ratearCarga(tendencia, capacidades) {
  var lista = capacidades || [];
  var total = 0;
  var i;
  for (i = 0; i < lista.length; i++) total += lista[i] || 0;
  if (!total) return lista.map(function () { return 0; });
  return lista.map(function (c) { return tendencia * (c || 0) / total; });
}

function classificarOcupacao(ocupacao) {
  if (ocupacao === null || ocupacao === undefined || ocupacao <= 0) return 'livre';
  if (ocupacao < FAIXA_OCUPACAO.folga) return 'folga';
  if (ocupacao <= FAIXA_OCUPACAO.sobrecarga) return 'equilibrada';
  return 'sobrecarregada';
}

module.exports = {
  FAIXA_OCUPACAO, diasPremissaDaSemana, capacidadeDaEquipe, ratearCarga, classificarOcupacao,
};
```

- [ ] **Step 4: Rode e veja passar**

Run: `node --test test/semanal-compute-alocacao.test.js`
Expected: PASS (11 testes)

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/compute-alocacao.js test/semanal-compute-alocacao.test.js
git commit -m "Alocacao: capacidade por premissa, rateio ponderado e faixas de ocupacao"
```

---

### Task 4: `compute-alocacao.js` — a grade (células, poda de coluna, prioridade)

**Files:**
- Modify: `tools/semanal/compute-alocacao.js`
- Test: `test/semanal-compute-alocacao.test.js`

**Interfaces:**
- Consumes: `capacidadeDaEquipe`, `ratearCarga` (Task 3); `COLUNAS_ALOCACAO` de `./equipes-alocaveis.js` (Task 1); `calcularSeriesSemanaisDimensao` e `pendentesNaData` de `./render-aba-semanal.js`; `premissaProdutividadeDoGrupo` de `./render-alertas-tendencia.js`; `diasNaSemana` de `./compute-semanal.js`.
- Produces: `montarGradeAlocacao(registros, indices, opcoes)` → `{ colunas, linhas, ancoraEpoch }`, com cada linha em `{ sup, tomador, ramo, ordem, celulas }` e cada célula em `{ sup, coluna, indices, tendencia, carteira, equipes, capacidadeAlocada, saldo, estado, premissaProd }`.

**Nota sobre a âncora:** `ancoraEpoch = semana.inicio` quando a semana já começou (`semana.inicio <= hojeEpoch`), senão `hojeEpoch`. A MESMA âncora alimenta a tendência (congelada por recálculo) e a carteira. Misturar as duas datas daria um saldo que não fecha com nada.

- [ ] **Step 1: Escreva o teste que falha**

Acrescente a `test/semanal-compute-alocacao.test.js`:

```js
const { montarGradeAlocacao } = require('../tools/semanal/compute-alocacao.js');
const { semanasDoMes } = require('../tools/semanal/compute-semanal.js');

function dia(ano, mes, d) { return Math.floor(Date.UTC(ano, mes - 1, d) / 86400000); }

// Dois registros da MATRIZ: SP e ST no mesmo SUP, mais um SUP só com carteira.
function registrosDeTeste() {
  const zeros = () => new Array(12).fill(0);
  const volumeAgosto = (v) => { const a = zeros(); a[7] = v; return a; };
  return [
    { sup: 'SUP-A', tomador: 'Tomador A', tipologia: 'SP',
      previsto: { volume: volumeAgosto(120), equipesResumo: { prod: 2 } } },
    { sup: 'SUP-A', tomador: 'Tomador A', tipologia: 'ST',
      previsto: { volume: volumeAgosto(0), equipesResumo: { prod: 3 } } },
    { sup: 'SUP-B', tomador: 'Tomador B', tipologia: 'SP',
      previsto: { volume: volumeAgosto(0), equipesResumo: { prod: 2 } } },
  ];
}

// Carteira: 40 furos abertos em SUP-A||ST e 79 em SUP-B||SP, nenhum fechado.
function demandasDeTeste() {
  const abertas = (n, diaChegada) => ({
    chegada: new Array(n).fill(diaChegada), sondagemRealizada: [], saidaEstoque: [],
  });
  return {
    porRegistroEventos: {
      'SUP-A||SP': { chegada: [], sondagemRealizada: [], saidaEstoque: [] },
      'SUP-A||ST': abertas(40, dia(2026, 7, 1)),
      'SUP-B||SP': abertas(79, dia(2026, 7, 1)),
    },
  };
}

const SEMANAS_AGOSTO = semanasDoMes(2026, 7);

function opcoesBase(extra) {
  return Object.assign({
    mesIdx: 7, ano: 2026,
    semanas: SEMANAS_AGOSTO,
    semana: SEMANAS_AGOSTO[1],
    demandas: demandasDeTeste(),
    equipes: [],
    alocacao: {},
    hojeEpoch: SEMANAS_AGOSTO[1].inicio + 2,
  }, extra || {});
}

test('a âncora é o início da semana quando ela já começou', () => {
  const g = montarGradeAlocacao(registrosDeTeste(), [0, 1, 2], opcoesBase());
  assert.strictEqual(g.ancoraEpoch, SEMANAS_AGOSTO[1].inicio);
});

test('semana futura ainda não travou: a âncora é hoje', () => {
  const g = montarGradeAlocacao(registrosDeTeste(), [0, 1, 2], opcoesBase({
    semana: SEMANAS_AGOSTO[3], hojeEpoch: SEMANAS_AGOSTO[1].inicio + 2,
  }));
  assert.strictEqual(g.ancoraEpoch, SEMANAS_AGOSTO[1].inicio + 2);
});

test('a célula traz a carteira mesmo sem tendência nenhuma', () => {
  const g = montarGradeAlocacao(registrosDeTeste(), [0, 1, 2], opcoesBase());
  const linhaA = g.linhas.find((l) => l.sup === 'SUP-A');
  const celulaST = linhaA.celulas['ST'];
  assert.strictEqual(celulaST.tendencia, 0);
  assert.strictEqual(celulaST.carteira, 40);
});

test('SUP sem tendência nenhuma entra no quadro SÓ por causa da carteira', () => {
  const g = montarGradeAlocacao(registrosDeTeste(), [0, 1, 2], opcoesBase());
  const linhaB = g.linhas.find((l) => l.sup === 'SUP-B');
  assert.ok(linhaB, 'SUP-B tem 79 furos parados e precisa aparecer');
  assert.strictEqual(linhaB.celulas['SP'].carteira, 79);
});

test('SUP sem tendência E sem carteira não vira linha', () => {
  const registros = registrosDeTeste();
  const g = montarGradeAlocacao(registros, [0, 1, 2], opcoesBase({
    demandas: { porRegistroEventos: {} },
  }));
  assert.deepStrictEqual(g.linhas.map((l) => l.sup), ['SUP-A']);
});

test('coluna zerada em tendência E carteira é podada', () => {
  const g = montarGradeAlocacao(registrosDeTeste(), [0, 1, 2], opcoesBase());
  assert.deepStrictEqual(g.colunas.map((c) => c.id), ['SP', 'ST']);
});

test('coluna zerada COM equipe alocada NÃO é podada -- o cartão sumiria da tela', () => {
  const g = montarGradeAlocacao(registrosDeTeste(), [0, 1, 2], opcoesBase({
    equipes: [{ id: '9', colunas: ['PI'], diasDisponiveis: 5, disponivel: true }],
    alocacao: { 9: { sup: 'SUP-A', coluna: 'PI' } },
  }));
  assert.ok(g.colunas.some((c) => c.id === 'PI'));
});

test('capacidade alocada e saldo saem das equipes na célula', () => {
  const g = montarGradeAlocacao(registrosDeTeste(), [0, 1, 2], opcoesBase({
    equipes: [
      { id: '1', colunas: ['SP'], diasDisponiveis: 5, disponivel: true },
      { id: '2', colunas: ['SP'], diasDisponiveis: 5, disponivel: true },
    ],
    alocacao: { 1: { sup: 'SUP-A', coluna: 'SP' }, 2: { sup: 'SUP-A', coluna: 'SP' } },
  }));
  const celula = g.linhas.find((l) => l.sup === 'SUP-A').celulas['SP'];
  assert.deepStrictEqual(celula.equipes, ['1', '2']);
  assert.ok(celula.capacidadeAlocada > 0);
  assert.ok(Math.abs(celula.saldo - (celula.capacidadeAlocada - celula.tendencia)) < 1e-9);
});

test('as linhas saem ordenadas pelo diagnóstico da tendência, com os parados por último', () => {
  const g = montarGradeAlocacao(registrosDeTeste(), [0, 1, 2], opcoesBase());
  const ultima = g.linhas[g.linhas.length - 1];
  assert.strictEqual(ultima.sup, 'SUP-B', 'SUP sem tendência vai para o fim');
});

test('a ordem NÃO muda quando a alocação muda', () => {
  const antes = montarGradeAlocacao(registrosDeTeste(), [0, 1, 2], opcoesBase());
  const depois = montarGradeAlocacao(registrosDeTeste(), [0, 1, 2], opcoesBase({
    equipes: [{ id: '1', colunas: ['SP'], diasDisponiveis: 5, disponivel: true }],
    alocacao: { 1: { sup: 'SUP-A', coluna: 'SP' } },
  }));
  assert.deepStrictEqual(antes.linhas.map((l) => l.sup), depois.linhas.map((l) => l.sup));
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `node --test test/semanal-compute-alocacao.test.js`
Expected: FAIL — `montarGradeAlocacao is not a function`

- [ ] **Step 3: Implemente `montarGradeAlocacao`**

Acrescente a `tools/semanal/compute-alocacao.js` (requires no topo, junto dos que já existem):

```js
const { COLUNAS_ALOCACAO } = require('./equipes-alocaveis.js');
const { calcularSeriesSemanaisDimensao, pendentesNaData } = require('./render-aba-semanal.js');
const { premissaProdutividadeDoGrupo } = require('./render-alertas-tendencia.js');
const { diasNaSemana, indiceSemanaAtual } = require('./compute-semanal.js');
```

E o corpo, antes do `module.exports`:

```js
// A data-âncora da semana. Semana já começada: o INÍCIO dela -- é o que
// congela a Tendência (calcularSeriesSemanaisDimensao recomputada com
// hojeEpoch = semana.inicio faz aquela semana virar a vigente, devolvendo a
// projeção que se fazia para ela inteira ao começar; mesmo mecanismo da aba
// Consolidado). Semana futura: não há nada a congelar, usa hoje.
//
// A CARTEIRA usa a MESMA âncora. Tendência de segunda-feira somada a carteira
// de hoje daria um saldo que não fecha com nada.
function ancoraDaSemana(semana, hojeEpoch) {
  if (!semana || typeof hojeEpoch !== 'number') return hojeEpoch;
  return semana.inicio <= hojeEpoch ? semana.inicio : hojeEpoch;
}

function diasDoMesNasSemanas(semanas) {
  var total = 0;
  for (var i = 0; i < (semanas || []).length; i++) total += diasNaSemana(semanas[i]);
  return total;
}

// Índices de registros por (sup, coluna) -- a coluna cobre 1 ou 3 tipologias
// da MATRIZ (ver COLUNAS_ALOCACAO).
function indicesPorCelula(registros, indices) {
  var mapa = {};
  (indices || []).forEach(function (i) {
    var r = registros[i];
    if (!r || !r.sup) return;
    for (var c = 0; c < COLUNAS_ALOCACAO.length; c++) {
      if (COLUNAS_ALOCACAO[c].tipologias.indexOf(r.tipologia) === -1) continue;
      var chave = r.sup + '||' + COLUNAS_ALOCACAO[c].id;
      if (!mapa[chave]) mapa[chave] = [];
      mapa[chave].push(i);
      break;
    }
  });
  return mapa;
}

// A tendência da célula naquela semana, já travada pela âncora.
function tendenciaDaCelula(registros, indicesCelula, o, ancoraEpoch) {
  if (!indicesCelula || !indicesCelula.length) return 0;
  var series = calcularSeriesSemanaisDimensao(
    registros, indicesCelula, 'volume', o.mesIdx, o.semanas, o.semanas.length,
    true, indiceSemanaAtual(o.semanas, ancoraEpoch), o.demandas, ancoraEpoch
  );
  var idx = o.semanas.indexOf(o.semana);
  var valor = series.semanasTendenciaCompleta && series.semanasTendenciaCompleta[idx];
  return valor === null || valor === undefined ? 0 : valor;
}

// registros/indices: os de sempre. opcoes:
//   { mesIdx, ano, semanas, semana, demandas, equipes, alocacao, hojeEpoch }
//   alocacao: { equipeId: { sup, coluna } }
function montarGradeAlocacao(registros, indices, opcoes) {
  var o = opcoes || {};
  var ancoraEpoch = ancoraDaSemana(o.semana, o.hojeEpoch);
  var diasDoMes = diasDoMesNasSemanas(o.semanas);
  var porCelula = indicesPorCelula(registros, indices);
  var alocacao = o.alocacao || {};
  var equipesPorId = {};
  (o.equipes || []).forEach(function (e) { equipesPorId[e.id] = e; });

  // Equipes alocadas, por célula.
  var equipesNaCelula = {};
  Object.keys(alocacao).forEach(function (id) {
    var destino = alocacao[id];
    if (!destino || !destino.sup || !destino.coluna) return;
    var chave = destino.sup + '||' + destino.coluna;
    if (!equipesNaCelula[chave]) equipesNaCelula[chave] = [];
    equipesNaCelula[chave].push(id);
  });

  var supsComAlgo = {};
  var colunasComAlgo = {};
  var celulas = {};

  var chavesCandidatas = {};
  Object.keys(porCelula).forEach(function (k) { chavesCandidatas[k] = true; });
  Object.keys(equipesNaCelula).forEach(function (k) { chavesCandidatas[k] = true; });

  Object.keys(chavesCandidatas).forEach(function (chave) {
    var partes = chave.split('||');
    var sup = partes[0];
    var coluna = partes[1];
    var indicesCelula = porCelula[chave] || [];
    var tendencia = tendenciaDaCelula(registros, indicesCelula, o, ancoraEpoch);
    var carteira = indicesCelula.length
      ? pendentesNaData(registros, indicesCelula, o.demandas, ancoraEpoch) : 0;
    var ids = equipesNaCelula[chave] || [];
    var premissaProd = indicesCelula.length
      ? premissaProdutividadeDoGrupo(registros, indicesCelula, o.mesIdx) : null;

    var capacidades = ids.map(function (id) {
      return capacidadeDaEquipe(equipesPorId[id] || { diasDisponiveis: 0 }, premissaProd, o.mesIdx, diasDoMes) || 0;
    });
    var capacidadeAlocada = capacidades.reduce(function (a, b) { return a + b; }, 0);

    // Célula sem tendência, sem carteira e sem equipe não existe.
    if (!tendencia && !carteira && !ids.length) return;

    celulas[chave] = {
      sup: sup, coluna: coluna, indices: indicesCelula,
      tendencia: tendencia, carteira: carteira,
      equipes: ids, capacidades: capacidades,
      capacidadeAlocada: capacidadeAlocada,
      saldo: capacidadeAlocada - tendencia,
      premissaProd: premissaProd,
    };
    supsComAlgo[sup] = true;
    colunasComAlgo[coluna] = true;
  });

  var colunas = COLUNAS_ALOCACAO.filter(function (c) { return colunasComAlgo[c.id]; });

  // O diagnóstico do SUP INTEIRO -- é ele que decide a ordem, e ele NÃO
  // depende da alocação: por isso as linhas não pulam durante o arrasto.
  var linhas = Object.keys(supsComAlgo).map(function (sup) {
    var indicesSup = (indices || []).filter(function (i) {
      return registros[i] && registros[i].sup === sup;
    });
    var series = indicesSup.length ? calcularSeriesSemanaisDimensao(
      registros, indicesSup, 'volume', o.mesIdx, o.semanas, o.semanas.length,
      true, indiceSemanaAtual(o.semanas, ancoraEpoch), o.demandas, ancoraEpoch
    ) : null;
    var minhasCelulas = {};
    colunas.forEach(function (c) {
      var celula = celulas[sup + '||' + c.id];
      if (celula) minhasCelulas[c.id] = celula;
    });
    var tendenciaSup = 0;
    Object.keys(minhasCelulas).forEach(function (k) { tendenciaSup += minhasCelulas[k].tendencia; });
    var registroDoSup = registros[indicesSup[0]];
    return {
      sup: sup,
      tomador: (registroDoSup && registroDoSup.tomador) || '',
      ramo: (series && series.ramoTendencia) || 'sem-dado',
      diagnostico: (series && series.diagnosticoTendencia) || null,
      tendencia: tendenciaSup,
      celulas: minhasCelulas,
    };
  });

  // Ordem: R<P (por saldo decrescente) -> R≈P -> R>P -> sem tendência.
  var PESO_RAMO = { abaixo: 0, igual: 1, acima: 2 };
  linhas.sort(function (a, b) {
    var semA = a.tendencia > 0 ? 0 : 1;
    var semB = b.tendencia > 0 ? 0 : 1;
    if (semA !== semB) return semA - semB;
    var pa = PESO_RAMO[a.ramo] === undefined ? 3 : PESO_RAMO[a.ramo];
    var pb = PESO_RAMO[b.ramo] === undefined ? 3 : PESO_RAMO[b.ramo];
    if (pa !== pb) return pa - pb;
    var sa = (a.diagnostico && a.diagnostico.saldo) || 0;
    var sb = (b.diagnostico && b.diagnostico.saldo) || 0;
    if (sa !== sb) return sb - sa;
    return a.sup < b.sup ? -1 : (a.sup > b.sup ? 1 : 0);
  });
  linhas.forEach(function (l, i) { l.ordem = i + 1; });

  return { colunas: colunas, linhas: linhas, ancoraEpoch: ancoraEpoch, diasDoMes: diasDoMes };
}
```

Acrescente `montarGradeAlocacao` e `ancoraDaSemana` ao `module.exports`.

- [ ] **Step 4: Rode e veja passar**

Run: `node --test test/semanal-compute-alocacao.test.js`
Expected: PASS (21 testes no total)

- [ ] **Step 5: Rode a suíte inteira e commite**

```bash
node --test test/*.test.js
git add tools/semanal/compute-alocacao.js test/semanal-compute-alocacao.test.js
git commit -m "Alocacao: a grade SUP x tipologia, com tendencia travada e carteira em toda celula"
```

---

### Task 5: `compute-alocacao.js` — os três resumos e o aviso condicional

**Files:**
- Modify: `tools/semanal/compute-alocacao.js`
- Test: `test/semanal-compute-alocacao.test.js`

**Interfaces:**
- Consumes: `montarGradeAlocacao` (Task 4), `ratearCarga`/`classificarOcupacao` (Task 3).
- Produces: `resumirAlocacao(grade, opcoes)` → `{ porSup: [], porEquipe: [], totais: {} }`; `LEITURAS_SUP` (array ordenado de ids).

**As cinco leituras, na ordem em que são avaliadas (primeira que casa vence):**

| # | id | Condição |
|---|---|---|
| 1 | `parado-com-carteira` | tendência = 0 **e** carteira > 0 |
| 2 | `sem-equipe` | tendência > 0 **e** nenhuma equipe alocada |
| 3 | `falta-equipe` | saldo < 0 |
| 4 | `antecipar` | saldo > 0 **e** carteira > 0 |
| 5 | `absorvido` | qualquer outro caso com tendência > 0 |

- [ ] **Step 1: Escreva o teste que falha**

Acrescente a `test/semanal-compute-alocacao.test.js`:

```js
const { resumirAlocacao } = require('../tools/semanal/compute-alocacao.js');

function gradeComEquipes(equipes, alocacao) {
  return montarGradeAlocacao(registrosDeTeste(), [0, 1, 2], opcoesBase({ equipes, alocacao }));
}

test('as cinco leituras por SUP são avaliadas em ordem: parado c/ carteira vence', () => {
  // SUP-B: tendência 0, carteira 79, e uma equipe solta ali. Sem a ordem
  // explícita ele casaria com 'antecipar' também.
  const equipes = [{ id: '1', colunas: ['SP'], diasDisponiveis: 5, disponivel: true }];
  const grade = gradeComEquipes(equipes, { 1: { sup: 'SUP-B', coluna: 'SP' } });
  const r = resumirAlocacao(grade, { equipes, mesIdx: 7 });
  const supB = r.porSup.find((s) => s.sup === 'SUP-B');
  assert.strictEqual(supB.leitura, 'parado-com-carteira');
});

test('SUP com tendência e nenhuma equipe lê "sem equipe"', () => {
  const r = resumirAlocacao(gradeComEquipes([], {}), { equipes: [], mesIdx: 7 });
  const supA = r.porSup.find((s) => s.sup === 'SUP-A');
  assert.strictEqual(supA.leitura, 'sem-equipe');
});

test('"semanas de carteira" é carteira ÷ tendência; sem tendência fica null, não zero', () => {
  const r = resumirAlocacao(gradeComEquipes([], {}), { equipes: [], mesIdx: 7 });
  const supB = r.porSup.find((s) => s.sup === 'SUP-B');
  assert.strictEqual(supB.semanasDeCarteira, null, 'sem ritmo não há prazo -- null, nunca 0');
  const supA = r.porSup.find((s) => s.sup === 'SUP-A');
  assert.ok(supA.semanasDeCarteira >= 0);
});

test('o aviso de antecipar ACENDE quando há carteira e equipe livre da coluna', () => {
  const equipes = [{ id: '5', colunas: ['ST'], diasDisponiveis: 5, disponivel: true }];
  const grade = gradeComEquipes(equipes, {});
  const r = resumirAlocacao(grade, { equipes, mesIdx: 7 });
  const celula = r.avisos['SUP-A||ST'];
  assert.strictEqual(celula, 'aceso');
});

test('o aviso fica MUDO quando há carteira mas nenhuma equipe livre da coluna', () => {
  const grade = gradeComEquipes([], {});
  const r = resumirAlocacao(grade, { equipes: [], mesIdx: 7 });
  assert.strictEqual(r.avisos['SUP-A||ST'], 'mudo');
});

test('equipe alocada com folga também acende o aviso -- não só as do pool', () => {
  const equipes = [
    { id: '5', colunas: ['ST'], diasDisponiveis: 5, disponivel: true },
  ];
  // Alocada numa célula com tendência 0: ocupação 0, logo tem folga.
  const grade = gradeComEquipes(equipes, { 5: { sup: 'SUP-A', coluna: 'ST' } });
  const r = resumirAlocacao(grade, { equipes, mesIdx: 7 });
  assert.strictEqual(r.avisos['SUP-A||ST'], 'aceso');
});

test('resumo por equipe: carga, ocupação e situação', () => {
  const equipes = [
    { id: '1', lider: 'A', colunas: ['SP'], diasDisponiveis: 5, disponivel: true },
    { id: '2', lider: 'B', colunas: ['SP'], diasDisponiveis: 5, disponivel: true },
    { id: '3', lider: 'C', colunas: ['SP'], diasDisponiveis: 5, disponivel: true },
  ];
  const grade = gradeComEquipes(equipes, {
    1: { sup: 'SUP-A', coluna: 'SP' }, 2: { sup: 'SUP-A', coluna: 'SP' },
  });
  const r = resumirAlocacao(grade, { equipes, mesIdx: 7 });
  const porId = Object.fromEntries(r.porEquipe.map((e) => [e.id, e]));
  assert.ok(Math.abs(porId['1'].carga - porId['2'].carga) < 1e-9, 'mesma célula, capacidades iguais');
  assert.strictEqual(porId['3'].sup, null);
  assert.strictEqual(porId['3'].carga, 0);
  assert.strictEqual(porId['3'].situacao, 'livre');
});

test('equipe indisponível a semana toda aparece como "fora na semana", sem números', () => {
  const equipes = [{ id: '9', lider: 'Z', colunas: ['SP'], diasDisponiveis: 0, disponivel: false }];
  const r = resumirAlocacao(gradeComEquipes(equipes, {}), { equipes, mesIdx: 7 });
  const eq = r.porEquipe.find((e) => e.id === '9');
  assert.strictEqual(eq.situacao, 'fora');
  assert.strictEqual(eq.carga, null);
  assert.strictEqual(eq.capacidade, null);
});

test('capacidade ociosa: equipe sobrecarregada contribui ZERO, nunca negativo', () => {
  const equipes = [
    { id: '1', colunas: ['SP'], diasDisponiveis: 5, disponivel: true },
    { id: '9', colunas: ['ST'], diasDisponiveis: 5, disponivel: true },
  ];
  // A equipe 1 sozinha numa célula de 120 no mês -> sobrecarregada.
  // A equipe 9 fica livre -> contribui a capacidade inteira.
  const grade = gradeComEquipes(equipes, { 1: { sup: 'SUP-A', coluna: 'SP' } });
  const r = resumirAlocacao(grade, { equipes, mesIdx: 7 });
  const eq9 = r.porEquipe.find((e) => e.id === '9');
  assert.ok(r.totais.capacidadeOciosa >= eq9.capacidade - 1e-9);
  assert.ok(r.totais.capacidadeOciosa < eq9.capacidade + 1e-9,
    'a sobrecarga da equipe 1 não pode descontar da ociosidade da 9');
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `node --test test/semanal-compute-alocacao.test.js`
Expected: FAIL — `resumirAlocacao is not a function`

- [ ] **Step 3: Implemente `resumirAlocacao`**

Acrescente a `tools/semanal/compute-alocacao.js`:

```js
// As cinco leituras por SUP, na ordem em que são avaliadas -- a PRIMEIRA que
// casa vence. Sem a ordem explícita, um SUP com tendência 0, carteira alta e
// uma equipe solta ali casaria com duas ao mesmo tempo.
var LEITURAS_SUP = ['parado-com-carteira', 'sem-equipe', 'falta-equipe', 'antecipar', 'absorvido'];

function leituraDoSup(tendencia, carteira, capacidadeAlocada, temEquipe) {
  var saldo = capacidadeAlocada - tendencia;
  if (!tendencia && carteira > 0) return 'parado-com-carteira';
  if (tendencia > 0 && !temEquipe) return 'sem-equipe';
  if (saldo < 0) return 'falta-equipe';
  if (saldo > 0 && carteira > 0) return 'antecipar';
  return 'absorvido';
}

// grade: o retorno de montarGradeAlocacao. opcoes: { equipes, mesIdx }
function resumirAlocacao(grade, opcoes) {
  var o = opcoes || {};
  var equipes = o.equipes || [];
  var diasDoMes = grade.diasDoMes;

  // --- carga por equipe, célula a célula ---
  var cargaPorEquipe = {};
  var celulaPorEquipe = {};
  var capacidadePorEquipe = {};
  grade.linhas.forEach(function (linha) {
    Object.keys(linha.celulas).forEach(function (colunaId) {
      var celula = linha.celulas[colunaId];
      var partes = ratearCarga(celula.tendencia, celula.capacidades);
      celula.equipes.forEach(function (id, i) {
        cargaPorEquipe[id] = (cargaPorEquipe[id] || 0) + partes[i];
        capacidadePorEquipe[id] = celula.capacidades[i];
        celulaPorEquipe[id] = { sup: celula.sup, coluna: celula.coluna };
      });
    });
  });

  var porEquipe = equipes.map(function (e) {
    if (!e.disponivel) {
      return {
        id: e.id, lider: e.lider, colunas: e.colunas, sup: null, coluna: null,
        carga: null, capacidade: null, ocupacao: null, situacao: 'fora',
      };
    }
    var destino = celulaPorEquipe[e.id] || null;
    var capacidade = capacidadePorEquipe[e.id];
    if (capacidade === undefined || capacidade === null) {
      // Não alocada: a capacidade de referência sai da premissa MÉDIA das
      // colunas dela na grade, para a tabela não mostrar '—' em toda equipe
      // livre. Sem nenhuma célula da coluna dela na grade, fica null.
      capacidade = capacidadeDeReferencia(grade, e, o.mesIdx, diasDoMes);
    }
    var carga = cargaPorEquipe[e.id] || 0;
    var ocupacao = capacidade ? carga / capacidade : null;
    return {
      id: e.id, lider: e.lider, colunas: e.colunas,
      sup: destino ? destino.sup : null,
      coluna: destino ? destino.coluna : null,
      carga: carga, capacidade: capacidade, ocupacao: ocupacao,
      situacao: destino ? classificarOcupacao(ocupacao) : 'livre',
    };
  });

  // --- avisos por célula, com a condição ---
  // Uma coluna tem "equipe livre" quando existe equipe DISPONÍVEL daquela
  // coluna com ocupação abaixo de 100% (no pool ou alocada com folga).
  var temLivrePorColuna = {};
  porEquipe.forEach(function (e) {
    if (e.situacao === 'fora') return;
    if (e.ocupacao !== null && e.ocupacao >= 1) return;
    (e.colunas || []).forEach(function (c) { temLivrePorColuna[c] = true; });
  });

  var avisos = {};
  grade.linhas.forEach(function (linha) {
    Object.keys(linha.celulas).forEach(function (colunaId) {
      var celula = linha.celulas[colunaId];
      if (!(celula.carteira > 0)) return;
      if (celula.saldo < 0) return;
      avisos[celula.sup + '||' + colunaId] = temLivrePorColuna[colunaId] ? 'aceso' : 'mudo';
    });
  });

  // --- resumo por SUP ---
  var porSup = grade.linhas.map(function (linha) {
    var tendencia = 0;
    var carteira = 0;
    var capacidadeAlocada = 0;
    var temEquipe = false;
    Object.keys(linha.celulas).forEach(function (k) {
      var c = linha.celulas[k];
      tendencia += c.tendencia;
      carteira += c.carteira;
      capacidadeAlocada += c.capacidadeAlocada;
      if (c.equipes.length) temEquipe = true;
    });
    return {
      sup: linha.sup, tomador: linha.tomador, ramo: linha.ramo, ordem: linha.ordem,
      tendencia: tendencia, carteira: carteira,
      capacidadeAlocada: capacidadeAlocada,
      saldo: capacidadeAlocada - tendencia,
      cobertura: tendencia ? capacidadeAlocada / tendencia : null,
      // Sem tendência não há ritmo, e sem ritmo não há prazo: null, nunca 0
      // (0 leria como "a carteira seca esta semana", o oposto da verdade).
      semanasDeCarteira: tendencia ? carteira / tendencia : null,
      leitura: leituraDoSup(tendencia, carteira, capacidadeAlocada, temEquipe),
    };
  });

  // --- totais (a faixa do topo) ---
  var totais = { tendencia: 0, capacidadeAlocada: 0, carteira: 0, capacidadeOciosa: 0, equipesAlocadas: 0 };
  porSup.forEach(function (s) {
    totais.tendencia += s.tendencia;
    totais.capacidadeAlocada += s.capacidadeAlocada;
    totais.carteira += s.carteira;
  });
  porEquipe.forEach(function (e) {
    if (e.situacao === 'fora' || e.capacidade === null) return;
    if (e.sup) totais.equipesAlocadas += 1;
    // Equipe sobrecarregada contribui ZERO, nunca negativo: a folga de umas
    // mascararia o excesso de outras e o número do topo mentiria.
    var folga = e.capacidade - e.carga;
    if (folga > 0) totais.capacidadeOciosa += folga;
  });
  totais.saldo = totais.capacidadeAlocada - totais.tendencia;

  return { porSup: porSup, porEquipe: porEquipe, avisos: avisos, totais: totais };
}

// A premissa média das colunas da equipe entre as células da grade, ponderada
// pela tendência -- só para dar uma capacidade de referência à equipe que ainda
// não foi alocada.
function capacidadeDeReferencia(grade, equipe, mesIdx, diasDoMes) {
  var somaPeso = 0;
  var somaPonderada = 0;
  grade.linhas.forEach(function (linha) {
    Object.keys(linha.celulas).forEach(function (colunaId) {
      if ((equipe.colunas || []).indexOf(colunaId) === -1) return;
      var celula = linha.celulas[colunaId];
      if (celula.premissaProd === null || celula.premissaProd === undefined) return;
      var peso = celula.tendencia || 1;
      somaPeso += peso;
      somaPonderada += peso * celula.premissaProd;
    });
  });
  if (!somaPeso) return null;
  return capacidadeDaEquipe(equipe, somaPonderada / somaPeso, mesIdx, diasDoMes);
}
```

Acrescente `resumirAlocacao`, `leituraDoSup` e `LEITURAS_SUP` ao `module.exports`.

- [ ] **Step 4: Rode e veja passar**

Run: `node --test test/semanal-compute-alocacao.test.js`
Expected: PASS (30 testes no total)

- [ ] **Step 5: Rode a suíte inteira e commite**

```bash
node --test test/*.test.js
git add tools/semanal/compute-alocacao.js test/semanal-compute-alocacao.test.js
git commit -m "Alocacao: resumos por SUP e por equipe, avisos condicionais e capacidade ociosa"
```

---

### Task 6: `alocacao-sheet.js` + `apps-script-alocacao.gs` — persistência

**Files:**
- Create: `tools/semanal/alocacao-sheet.js`
- Create: `tools/semanal/apps-script-alocacao.gs`
- Test: `test/semanal-alocacao-sheet.test.js`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces:
  - `RE_URL_ALOCACAO_PENDENTE` — regex do literal `PENDENTE-`
  - `criarClienteAlocacao(opcoes)` → `{ carregar(chaveSemana), gravar(movimento), pendentes(), tentarDeNovo(), modo() }`
  - `chaveSemana(ano, semanaInicioEpoch)` → string `'2026|2026-08-10'`

**Nota:** `opcoes` recebe `{ url, fetch, armazenamento, autor }` — todos injetados, para o teste rodar sem rede e sem `localStorage`.

- [ ] **Step 1: Escreva o teste que falha**

Crie `test/semanal-alocacao-sheet.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  criarClienteAlocacao, chaveSemana, RE_URL_ALOCACAO_PENDENTE,
} = require('../tools/semanal/alocacao-sheet.js');

function armazenamentoFalso() {
  const dados = {};
  return {
    getItem: (k) => (k in dados ? dados[k] : null),
    setItem: (k, v) => { dados[k] = String(v); },
    _dados: dados,
  };
}

const URL_OK = 'https://script.google.com/macros/s/AKfy.../exec';

test('chaveSemana é ano + data ISO do início da semana', () => {
  const inicio = Math.floor(Date.UTC(2026, 7, 10) / 86400000);
  assert.strictEqual(chaveSemana(2026, inicio), '2026|2026-08-10');
});

test('URL PENDENTE- cai no modo local, sem tocar na rede', async () => {
  let chamou = false;
  const cliente = criarClienteAlocacao({
    url: 'PENDENTE-publicar-o-apps-script',
    fetch: () => { chamou = true; throw new Error('não devia buscar'); },
    armazenamento: armazenamentoFalso(),
    autor: 'teste',
  });
  assert.strictEqual(cliente.modo(), 'local');
  const r = await cliente.carregar('2026|2026-08-10');
  assert.deepStrictEqual(r, {});
  assert.strictEqual(chamou, false);
  assert.match('PENDENTE-qualquer-coisa', RE_URL_ALOCACAO_PENDENTE);
});

test('no modo local a gravação vai para o armazenamento e volta na leitura', async () => {
  const armazenamento = armazenamentoFalso();
  const cliente = criarClienteAlocacao({
    url: 'PENDENTE-x', fetch: () => { throw new Error('não'); }, armazenamento, autor: 'teste',
  });
  await cliente.gravar({ chaveSemana: '2026|2026-08-10', equipeId: '4', sup: 'SUP-A', coluna: 'SP' });
  const r = await cliente.carregar('2026|2026-08-10');
  assert.deepStrictEqual(r, { 4: { sup: 'SUP-A', coluna: 'SP' } });
});

test('sup null REMOVE a equipe da semana', async () => {
  const armazenamento = armazenamentoFalso();
  const cliente = criarClienteAlocacao({
    url: 'PENDENTE-x', fetch: () => { throw new Error('não'); }, armazenamento, autor: 'teste',
  });
  await cliente.gravar({ chaveSemana: '2026|2026-08-10', equipeId: '4', sup: 'SUP-A', coluna: 'SP' });
  await cliente.gravar({ chaveSemana: '2026|2026-08-10', equipeId: '4', sup: null, coluna: null });
  assert.deepStrictEqual(await cliente.carregar('2026|2026-08-10'), {});
});

test('com URL real, carregar faz GET e devolve o mapa por equipe', async () => {
  const cliente = criarClienteAlocacao({
    url: URL_OK,
    fetch: async (url) => {
      assert.match(url, /semana=2026%7C2026-08-10/);
      return { ok: true, json: async () => ({ linhas: [
        { equipeId: '4', sup: 'SUP-A', coluna: 'SP' },
        { equipeId: '59', sup: 'SUP-B', coluna: 'ST' },
      ] }) };
    },
    armazenamento: armazenamentoFalso(), autor: 'teste',
  });
  assert.strictEqual(cliente.modo(), 'sheet');
  assert.deepStrictEqual(await cliente.carregar('2026|2026-08-10'), {
    4: { sup: 'SUP-A', coluna: 'SP' },
    59: { sup: 'SUP-B', coluna: 'ST' },
  });
});

test('a gravação usa POST com text/plain -- sem preflight, que o Apps Script não responde', async () => {
  let visto = null;
  const cliente = criarClienteAlocacao({
    url: URL_OK,
    fetch: async (url, opcoes) => {
      visto = { url, opcoes };
      return { ok: true, json: async () => ({ linhas: [{ equipeId: '4', sup: 'SUP-A', coluna: 'SP' }] }) };
    },
    armazenamento: armazenamentoFalso(), autor: 'amcac',
  });
  await cliente.gravar({ chaveSemana: '2026|2026-08-10', equipeId: '4', sup: 'SUP-A', coluna: 'SP' });
  assert.strictEqual(visto.opcoes.method, 'POST');
  assert.match(visto.opcoes.headers['Content-Type'], /^text\/plain/);
  const corpo = JSON.parse(visto.opcoes.body);
  assert.strictEqual(corpo.equipeId, '4');
  assert.strictEqual(corpo.autor, 'amcac');
});

test('falha de rede NÃO perde o movimento: ele entra na fila e é reenviado depois', async () => {
  let falhar = true;
  const cliente = criarClienteAlocacao({
    url: URL_OK,
    fetch: async () => {
      if (falhar) throw new Error('offline');
      return { ok: true, json: async () => ({ linhas: [] }) };
    },
    armazenamento: armazenamentoFalso(), autor: 'teste',
  });
  await cliente.gravar({ chaveSemana: '2026|2026-08-10', equipeId: '4', sup: 'SUP-A', coluna: 'SP' });
  assert.strictEqual(cliente.pendentes().length, 1);
  falhar = false;
  await cliente.tentarDeNovo();
  assert.strictEqual(cliente.pendentes().length, 0);
});

test('a fila sobrevive a um recarregamento -- fica no armazenamento', async () => {
  const armazenamento = armazenamentoFalso();
  const cliente = criarClienteAlocacao({
    url: URL_OK, fetch: async () => { throw new Error('offline'); }, armazenamento, autor: 'teste',
  });
  await cliente.gravar({ chaveSemana: '2026|2026-08-10', equipeId: '4', sup: 'SUP-A', coluna: 'SP' });
  const outro = criarClienteAlocacao({
    url: URL_OK, fetch: async () => { throw new Error('offline'); }, armazenamento, autor: 'teste',
  });
  assert.strictEqual(outro.pendentes().length, 1);
});

test('resposta HTTP não-ok também vira fila, não silêncio', async () => {
  const cliente = criarClienteAlocacao({
    url: URL_OK,
    fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }),
    armazenamento: armazenamentoFalso(), autor: 'teste',
  });
  await cliente.gravar({ chaveSemana: '2026|2026-08-10', equipeId: '4', sup: 'SUP-A', coluna: 'SP' });
  assert.strictEqual(cliente.pendentes().length, 1);
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `node --test test/semanal-alocacao-sheet.test.js`
Expected: FAIL — `Cannot find module '../tools/semanal/alocacao-sheet.js'`

- [ ] **Step 3: Implemente o cliente**

Crie `tools/semanal/alocacao-sheet.js`:

```js
'use strict';

// Módulo dual (Node + navegador). Sem require nenhum -- tudo que ele precisa
// (fetch, armazenamento) é INJETADO por quem chama, e é isso que deixa o teste
// rodar offline, sem localStorage e sem rede.
//
// PERSISTÊNCIA DA ALOCAÇÃO
// ===========================================================================
// Ver docs/superpowers/specs/2026-08-10-semanal-alocacao-equipes-design.md,
// Decisão 8.

// Mesmo padrão de RE_URL_PENDENTE (render-semanal.js): enquanto o Apps Script
// não estiver publicado, o literal fica 'PENDENTE-...' e a aba roda inteira em
// armazenamento local, dizendo isso no status. É o ESTADO INICIAL do recurso.
var RE_URL_ALOCACAO_PENDENTE = /^PENDENTE-/;

var PREFIXO_ARMAZENAMENTO = 'alocacao-equipes:';
var CHAVE_FILA = 'alocacao-equipes:fila';

// '2026|2026-08-10' -- ano civil mais a data ISO do primeiro dia da semana.
// Sai de diaEpoch (dias-desde-época UTC), então reconstruir com Date.UTC cai
// exatamente na meia-noite daquele dia; lê com getUTC*, nunca local.
function chaveSemana(ano, semanaInicioEpoch) {
  var d = new Date(semanaInicioEpoch * 86400000);
  var mes = d.getUTCMonth() + 1;
  var dia = d.getUTCDate();
  return ano + '|' + d.getUTCFullYear()
    + '-' + (mes < 10 ? '0' : '') + mes
    + '-' + (dia < 10 ? '0' : '') + dia;
}

function criarClienteAlocacao(opcoes) {
  var o = opcoes || {};
  var url = String(o.url || '');
  var buscar = o.fetch;
  var armazenamento = o.armazenamento;
  var autor = o.autor || 'anônimo';
  var local = RE_URL_ALOCACAO_PENDENTE.test(url) || !url;

  function lerJson(chave, padrao) {
    if (!armazenamento) return padrao;
    try {
      var texto = armazenamento.getItem(chave);
      return texto ? JSON.parse(texto) : padrao;
    } catch (err) { return padrao; }
  }

  function gravarJson(chave, valor) {
    if (!armazenamento) return;
    try { armazenamento.setItem(chave, JSON.stringify(valor)); } catch (err) { /* cota cheia */ }
  }

  function aplicarLocal(movimento) {
    var chave = PREFIXO_ARMAZENAMENTO + movimento.chaveSemana;
    var mapa = lerJson(chave, {});
    if (!movimento.sup) delete mapa[movimento.equipeId];
    else mapa[movimento.equipeId] = { sup: movimento.sup, coluna: movimento.coluna };
    gravarJson(chave, mapa);
    return mapa;
  }

  function linhasParaMapa(linhas) {
    var mapa = {};
    (linhas || []).forEach(function (l) {
      if (!l || !l.equipeId || !l.sup) return;
      mapa[l.equipeId] = { sup: l.sup, coluna: l.coluna };
    });
    return mapa;
  }

  function enfileirar(movimento) {
    var fila = lerJson(CHAVE_FILA, []);
    // Um movimento por equipe/semana: reenviar dois estados da mesma equipe
    // só faria o mais velho sobrescrever o mais novo do outro lado.
    fila = fila.filter(function (m) {
      return !(m.chaveSemana === movimento.chaveSemana && m.equipeId === movimento.equipeId);
    });
    fila.push(movimento);
    gravarJson(CHAVE_FILA, fila);
  }

  async function enviar(movimento) {
    var resposta = await buscar(url, {
      method: 'POST',
      // text/plain faz disto uma requisição SIMPLES: sem preflight OPTIONS,
      // que um web app do Apps Script não sabe responder. O corpo continua
      // sendo JSON, lido em e.postData.contents do lado de lá.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        chaveSemana: movimento.chaveSemana,
        equipeId: movimento.equipeId,
        sup: movimento.sup,
        coluna: movimento.coluna,
        autor: autor,
        atualizadoEm: new Date().toISOString(),
      }),
      redirect: 'follow',
    });
    if (!resposta || !resposta.ok) throw new Error('HTTP ' + (resposta && resposta.status));
    return await resposta.json();
  }

  return {
    modo: function () { return local ? 'local' : 'sheet'; },

    carregar: async function (chave) {
      var mapaLocal = lerJson(PREFIXO_ARMAZENAMENTO + chave, {});
      if (local) return mapaLocal;
      try {
        var resposta = await buscar(url + '?semana=' + encodeURIComponent(chave), { redirect: 'follow' });
        if (!resposta || !resposta.ok) throw new Error('HTTP ' + (resposta && resposta.status));
        var dados = await resposta.json();
        var mapa = linhasParaMapa(dados && dados.linhas);
        gravarJson(PREFIXO_ARMAZENAMENTO + chave, mapa);
        return mapa;
      } catch (err) {
        // Sem rede, o cache local é a melhor resposta disponível -- e é honesta:
        // é o que ESTA máquina gravou por último. Quem chama mostra o aviso.
        return mapaLocal;
      }
    },

    gravar: async function (movimento) {
      // O local é aplicado SEMPRE e primeiro: a tela nunca espera a rede, e uma
      // falha de gravação não pode desfazer o que o usuário acabou de ver.
      aplicarLocal(movimento);
      if (local) return { ok: true, modo: 'local' };
      try {
        await enviar(movimento);
        return { ok: true, modo: 'sheet' };
      } catch (err) {
        enfileirar(movimento);
        return { ok: false, modo: 'sheet', erro: err.message };
      }
    },

    pendentes: function () { return lerJson(CHAVE_FILA, []); },

    tentarDeNovo: async function () {
      var fila = lerJson(CHAVE_FILA, []);
      var restantes = [];
      for (var i = 0; i < fila.length; i++) {
        try { await enviar(fila[i]); } catch (err) { restantes.push(fila[i]); }
      }
      gravarJson(CHAVE_FILA, restantes);
      return restantes.length;
    },
  };
}

module.exports = { criarClienteAlocacao, chaveSemana, RE_URL_ALOCACAO_PENDENTE };
```

- [ ] **Step 4: Rode e veja passar**

Run: `node --test test/semanal-alocacao-sheet.test.js`
Expected: PASS (10 testes)

- [ ] **Step 5: Escreva o Apps Script**

Crie `tools/semanal/apps-script-alocacao.gs`:

```js
// Cole este código no editor do Apps Script da Sheet de ALOCAÇÃO (Extensões >
// Apps Script). Ele guarda a alocação de equipes por semana e responde ao
// dashboard de Planejamento Semanal.
//
// Diferente dos dois espelhos (apps-script-espelho-eq.gs e
// apps-script-espelho-avancos.gs), este NÃO copia nada: ele é o dono do dado.
// A alocação não existe em planilha nenhuma antes daqui.
//
// ATENÇÃO ao copiar este arquivo: se você abrir no navegador e o Chrome
// oferecer traduzir a página, RECUSE. A tradução troca as palavras-chave do
// JavaScript ("try" vira "tentar") e o script para de compilar. O caminho
// seguro é abrir o arquivo local no Bloco de Notas e copiar de lá.
//
// Setup (uma vez só):
//   1. Crie uma Google Sheet em branco -- esta vai ser a Sheet de alocação.
//   2. Nela: Extensões > Apps Script, apague o conteúdo padrão e cole este
//      arquivo inteiro.
//   3. Implantar > Nova implantação > tipo "App da Web".
//      - Executar como: EU (sua conta).
//      - Quem tem acesso: QUALQUER PESSOA.
//      Copie a URL que termina em /exec e me mande.
//   4. A aba "ALOCACAO" é criada sozinha na primeira gravação.
//
// SEGURANÇA, dita com todas as letras: "qualquer pessoa" é necessário porque a
// página é um HTML estático, sem login. A URL vai DENTRO do blob cifrado do
// dashboard, então só quem tem a senha a enxerga -- mas quem tem a senha pode
// gravar. É o mesmo nível de confiança de quem já vê os dados.

var ABA = 'ALOCACAO';
var CABECALHO = ['ano', 'semanaInicio', 'equipeId', 'sup', 'coluna', 'autor', 'atualizadoEm'];

function abaAlocacao() {
  var planilha = SpreadsheetApp.getActiveSpreadsheet();
  var aba = planilha.getSheetByName(ABA);
  if (!aba) {
    aba = planilha.insertSheet(ABA);
    aba.getRange(1, 1, 1, CABECALHO.length).setValues([CABECALHO]);
  }
  return aba;
}

// 'chaveSemana' chega como '2026|2026-08-10' e é gravada nas DUAS primeiras
// colunas, para a planilha continuar legível por um humano.
function partesDaChave(chave) {
  var pedacos = String(chave || '').split('|');
  return { ano: pedacos[0] || '', semanaInicio: pedacos[1] || '' };
}

function linhasDaSemana(chave) {
  var p = partesDaChave(chave);
  var aba = abaAlocacao();
  var dados = aba.getDataRange().getValues();
  var linhas = [];
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][0]) !== p.ano) continue;
    if (String(dados[i][1]) !== p.semanaInicio) continue;
    if (!dados[i][3]) continue;
    linhas.push({
      equipeId: String(dados[i][2]),
      sup: String(dados[i][3]),
      coluna: String(dados[i][4]),
      autor: String(dados[i][5]),
      atualizadoEm: String(dados[i][6]),
    });
  }
  return linhas;
}

function resposta(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var chave = (e && e.parameter && e.parameter.semana) || '';
  return resposta({ linhas: linhasDaSemana(chave) });
}

function doPost(e) {
  var corpo = JSON.parse(e.postData.contents);
  var p = partesDaChave(corpo.chaveSemana);
  var aba = abaAlocacao();
  var dados = aba.getDataRange().getValues();

  // Upsert por (ano, semanaInicio, equipeId). Gravar o MOVIMENTO, e não o
  // quadro inteiro, é o que impede duas pessoas mexendo em equipes diferentes
  // de se atropelarem; só a mesma equipe colide, e aí vence a última escrita.
  var alvo = -1;
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][0]) !== p.ano) continue;
    if (String(dados[i][1]) !== p.semanaInicio) continue;
    if (String(dados[i][2]) !== String(corpo.equipeId)) continue;
    alvo = i + 1;
    break;
  }

  var linha = [p.ano, p.semanaInicio, String(corpo.equipeId),
    corpo.sup || '', corpo.coluna || '', corpo.autor || '', corpo.atualizadoEm || ''];

  if (alvo === -1) aba.appendRow(linha);
  else aba.getRange(alvo, 1, 1, CABECALHO.length).setValues([linha]);

  return resposta({ ok: true, linhas: linhasDaSemana(corpo.chaveSemana) });
}
```

- [ ] **Step 6: Rode a suíte inteira e commite**

```bash
node --test test/*.test.js
git add tools/semanal/alocacao-sheet.js tools/semanal/apps-script-alocacao.gs test/semanal-alocacao-sheet.test.js
git commit -m "Alocacao: cliente de persistencia com fila offline e o Apps Script da Sheet"
```

---

### Task 7: O roster da aba EQ chega ao cliente (build e live-refresh)

**Files:**
- Modify: `tools/semanal/build-dashboard.js` (função `montarEquipesAtivas`)
- Modify: `tools/semanal/render-semanal.js` (o bloco do live-refresh, perto de `URL_ESPELHO_EQ_SEMANAL`)
- Test: `test/semanal-build-dashboard.test.js`

**Interfaces:**
- Consumes: nada de tasks anteriores (só o CSV que já é buscado).
- Produces: `demandas.equipesCsv` — o texto CSV cru da aba EQ, dentro do blob cifrado; e `window.__DEMANDAS__.equipesCsv` atualizado pelo live-refresh.

**Por que o CSV cru e não o roster já processado:** `equipesDoQuadro` depende da SEMANA escolhida (disponibilidade e última OS mudam com ela), e a semana muda na tela sem novo build. Guardar o CSV deixa o cliente recomputar a cada troca de semana com a função que os testes já exercitam. O CSV da aba EQ tem ~119 linhas — cabe folgado no payload.

- [ ] **Step 1: Escreva o teste que falha**

Acrescente a `test/semanal-build-dashboard.test.js`:

```js
const { montarEquipesAtivas } = require('../tools/semanal/build-dashboard.js');

test('montarEquipesAtivas devolve o CSV cru da aba EQ para o cliente', () => {
  const csv = [
    'ID,Equipe,Habilitação,Serviços,Líderes,Veículo,Proprietário,Equipamento,Equipamento,Equipamento,Equipamento,Equipamento,Tenda,Tomador,sinalização 3P,01/08/2026',
    ',,do condutor,-,-,-,-,-,-,-,-,-,-,-,,SÁBADO',
    '4,José I. Amaral,D,SM,Amaral,-,-,N/A,N/A,N/A,N/A,N/A,,CCR RioSP,,OK',
  ].join('\n');
  const r = montarEquipesAtivas([], csv);
  assert.strictEqual(r.equipesCsv, csv, 'sem o CSV o cliente não consegue montar o quadro');
  assert.deepStrictEqual(r.equipesAtivasPeriodo, { ano: 2026, mes: 8 });
});

test('sem espelho, equipesCsv fica null -- nunca string vazia', () => {
  // String vazia parseia para "zero equipes", indistinguível de "a planilha
  // está vazia". null é o que a aba usa para dizer "sem fonte" na tela.
  const r = montarEquipesAtivas([], null);
  assert.strictEqual(r.equipesCsv, null);
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `node --test test/semanal-build-dashboard.test.js`
Expected: FAIL — `montarEquipesAtivas is not a function` (ela ainda não é exportada) ou `r.equipesCsv` é `undefined`

- [ ] **Step 3: Devolva o CSV em `montarEquipesAtivas`**

Em `tools/semanal/build-dashboard.js`, na função `montarEquipesAtivas`:

```js
function montarEquipesAtivas(furos, csvEspelho) {
  // equipesCsv viaja para o cliente porque a aba Alocação Equipes recomputa o
  // roster a cada troca de SEMANA (disponibilidade e última OS mudam com ela),
  // e a semana muda sem novo build. São ~119 linhas -- cabe folgado no payload.
  // null, e não '', quando não há espelho: string vazia parseia para "zero
  // equipes", indistinguível de "a planilha está vazia".
  if (!csvEspelho) return { equipesAtivasPeriodo: null, equipesCsv: null };
```

E no `return` do fim da função, acrescente o campo:

```js
  return {
    equipesPorDia: r.porDia,
    equipesAtivasPeriodo: periodo,
    equipesCsv: csvEspelho,
  };
```

No caso de cabeçalho irreconhecível (`if (!periodo)`), devolva também `equipesCsv: null` — sem `{ano, mes}` o cliente não sabe a que mês os dias pertencem, e um roster sem calendário é pior que nenhum.

Acrescente `montarEquipesAtivas` ao `module.exports` do arquivo.

- [ ] **Step 4: Rode e veja passar**

Run: `node --test test/semanal-build-dashboard.test.js`
Expected: PASS

- [ ] **Step 5: Atualize o CSV no live-refresh**

Em `tools/semanal/render-semanal.js`, no bloco do live-refresh onde o CSV da EQ já é usado para recalcular as equipes ativas, acrescente (junto de onde `demandasNovas.equipesPorDia` e `equipesAtivasPeriodo` são atribuídos):

```js
      // A aba Alocação Equipes recomputa o roster a partir deste CSV a cada
      // troca de semana -- sem atualizá-lo aqui, o quadro continuaria mostrando
      // o roster do momento do build depois de um "Atualizar dados".
      demandasNovas.equipesCsv = csvEq;
```

Use o nome de variável que o bloco já usa para o texto do CSV da EQ; se ele só existir dentro de um `.then`, guarde numa variável do escopo do bloco antes.

- [ ] **Step 6: Rode a suíte inteira e commite**

```bash
node --test test/*.test.js
git add tools/semanal/build-dashboard.js tools/semanal/render-semanal.js test/semanal-build-dashboard.test.js
git commit -m "Alocacao: o CSV da aba EQ viaja ao cliente, no build e no refresh"
```

---

### Task 8: `render-aba-alocacao.js` — o markup

**Files:**
- Create: `tools/semanal/render-aba-alocacao.js`
- Test: `test/semanal-render-aba-alocacao.test.js`

**Interfaces:**
- Consumes: `montarGradeAlocacao`, `resumirAlocacao` (Tasks 4-5); `COLUNAS_ALOCACAO` (Task 1); `formatarIntervaloSemana` de `./render-aba-semanal.js`.
- Produces: `renderAbaAlocacao(registros, indices, opcoes)` → string HTML; `CLASSE_LEITURA` (mapa leitura → classe CSS).

**Estrutura do HTML produzido, nesta ordem:**
1. `<div class="controles-alocacao">` — botões de semana (`data-semana`), "Repor o realizado", "Limpar alocação", e `<span id="status-alocacao">`.
2. `<div class="faixa-alocacao">` — os 5 números do Nível 1.
3. `<div class="pool-alocacao">` — cartões arrastáveis + a lista recolhida "fora do quadro (N)".
4. `<table class="matriz-alocacao">` — a grade, células com `data-sup` e `data-coluna`.
5. Duas tabelas de resumo.

- [ ] **Step 1: Escreva o teste que falha**

Crie `test/semanal-render-aba-alocacao.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderAbaAlocacao } = require('../tools/semanal/render-aba-alocacao.js');
const { semanasDoMes } = require('../tools/semanal/compute-semanal.js');

const SEMANAS = semanasDoMes(2026, 7);

function registros() {
  const zeros = () => new Array(12).fill(0);
  const vol = (v) => { const a = zeros(); a[7] = v; return a; };
  return [
    { sup: 'SUP-A', tomador: 'Tomador A', tipologia: 'SP',
      previsto: { volume: vol(120), equipesResumo: { prod: 2 } } },
  ];
}

function opcoes(extra) {
  return Object.assign({
    mesIdx: 7, ano: 2026, semanas: SEMANAS, semana: SEMANAS[1],
    demandas: { porRegistroEventos: { 'SUP-A||SP': { chegada: [], sondagemRealizada: [], saidaEstoque: [] } } },
    equipes: [{ id: '4', lider: 'Amaral', servicos: 'SM', colunas: ['SP'],
      polivalente: false, diasDisponiveis: 5, diasDaSemana: 7, disponivel: true,
      supRealizado: null, colunaRealizada: null,
      popup: { habilitacao: 'D', veiculo: 'SUH-6F44', proprietario: 'Suporte',
        equipamentos: ['Kit SP'], tenda: '', tomador: 'CCR RioSP', sinalizacao3p: '' } }],
    foraDoQuadro: [{ id: '200', lider: 'Ana L.', servicos: 'Lab', motivo: 'Laboratório tem fonte própria' }],
    alocacao: {},
    hojeEpoch: SEMANAS[1].inicio + 2,
    modoPersistencia: 'local',
    pendentes: 0,
  }, extra || {});
}

test('cada célula da matriz é uma área de soltura identificada por SUP e coluna', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes());
  assert.match(html, /data-sup="SUP-A"[^>]*data-coluna="SP"/);
  assert.match(html, /class="[^"]*celula-alocacao/);
});

test('o cartão da equipe traz o ID, o líder e a coluna dele', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes());
  assert.match(html, /data-equipe="4"/);
  assert.match(html, /Amaral/);
  assert.match(html, /data-colunas="SP"/);
});

test('equipe indisponível sai marcada e NÃO arrastável', () => {
  const o = opcoes();
  o.equipes[0].disponivel = false;
  o.equipes[0].diasDisponiveis = 0;
  const html = renderAbaAlocacao(registros(), [0], o);
  assert.match(html, /data-equipe="4"[^>]*data-arrastavel="nao"/);
});

test('equipe polivalente carrega as colunas dela separadas por vírgula', () => {
  const o = opcoes();
  o.equipes[0].colunas = ['ST', 'PI', 'BL'];
  o.equipes[0].polivalente = true;
  const html = renderAbaAlocacao(registros(), [0], o);
  assert.match(html, /data-colunas="ST,PI,BL"/);
});

test('o popup traz veículo, proprietário e equipamentos -- e NÃO promete nomes de efetivo', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes());
  assert.match(html, /SUH-6F44/);
  assert.match(html, /Suporte/);
  assert.match(html, /Kit SP/);
});

test('a lista "fora do quadro" mostra a equipe e o motivo -- nunca some calada', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes());
  assert.match(html, /fora do quadro \(1\)/i);
  assert.match(html, /Laborat/);
});

test('sem roster, a aba explica em vez de mostrar quadro vazio', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({ equipes: null, semRoster: true }));
  assert.doesNotMatch(html, /matriz-alocacao/);
  assert.match(html, /aba EQ/i);
});

test('semana fora do mês do espelho: somente leitura, com o motivo na tela', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({ somenteLeitura: 'mes-diferente' }));
  assert.match(html, /somente leitura/i);
  assert.match(html, /m[êe]s/i);
});

test('o modo local avisa que a alocação não está sendo gravada na planilha', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({ modoPersistencia: 'local' }));
  assert.match(html, /neste navegador/i);
});

test('movimentos na fila aparecem no status', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({ modoPersistencia: 'sheet', pendentes: 2 }));
  assert.match(html, /2 movimento/i);
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `node --test test/semanal-render-aba-alocacao.test.js`
Expected: FAIL — módulo não encontrado

- [ ] **Step 3: Implemente o render**

Crie `tools/semanal/render-aba-alocacao.js` seguindo o padrão de `render-aba-balanco.js` (função por bloco, `escapeHtml` local, nada de template literal com crase não escapada — este arquivo entra num template literal de `render-semanal.js`). Cubra, nesta ordem:

```js
'use strict';
const { montarGradeAlocacao, resumirAlocacao, classificarOcupacao } = require('./compute-alocacao.js');
const { COLUNAS_ALOCACAO } = require('./equipes-alocaveis.js');
const { formatarIntervaloSemana } = require('./render-aba-semanal.js');

// Módulo dual. Ver o padrão de render-aba-balanco.js: este arquivo devolve uma
// STRING de HTML que render-semanal.js injeta em #secao-alocacao.
//
// Os rótulos das 5 leituras, na ordem de LEITURAS_SUP (compute-alocacao.js).
var ROTULO_LEITURA = {
  'parado-com-carteira': 'Parado c/ carteira',
  'sem-equipe': 'Sem equipe',
  'falta-equipe': 'Falta equipe',
  antecipar: 'Antecipar',
  absorvido: 'Absorvido',
};

var CLASSE_LEITURA = {
  'parado-com-carteira': 'leitura-parado',
  'sem-equipe': 'leitura-falta',
  'falta-equipe': 'leitura-falta',
  antecipar: 'leitura-antecipar',
  absorvido: 'leitura-ok',
};
```

Requisitos concretos do markup, todos exercitados pelos testes do Step 1:

- **Célula:** `<td class="celula-alocacao ..." data-sup="..." data-coluna="...">`, com a tendência, o status, a barra de cobertura, os cartões e `<span class="carteira">carteira N</span>`. Célula com aviso `aceso` ganha a classe `aviso-aceso`; com `mudo`, `aviso-mudo`.
- **Cartão:** `<div class="cartao-equipe" data-equipe="ID" data-colunas="A,B" data-arrastavel="sim|nao">`, com o medalhão do ID, o ponto da cor da coluna e o nome do líder. `data-arrastavel="nao"` quando `disponivel` é falso **ou** quando `opcoes.somenteLeitura` está definido.
- **Popup:** `<div class="popup-equipe">` irmão do cartão, com habilitação, veículo + proprietário, equipamentos, tomador, capacidade e ocupação. Nunca escreva "efetivo" nem nomes de pessoas — esta página não os tem.
- **Guardas, antes de qualquer grade:** `opcoes.semRoster` devolve só um bloco explicando que a Sheet espelho da aba EQ não respondeu e que sem ela não há quadro; `opcoes.somenteLeitura === 'mes-diferente'` desenha a grade mas com todos os cartões não arrastáveis e um aviso de que o espelho da aba EQ só cobre o mês corrente.
- **Status:** `modoPersistencia === 'local'` escreve "gravando só neste navegador — a planilha de alocação ainda não foi publicada"; `pendentes > 0` escreve "N movimento(s) não gravado(s)" com um botão `data-acao="tentar-de-novo"`.

- [ ] **Step 4: Rode e veja passar**

Run: `node --test test/semanal-render-aba-alocacao.test.js`
Expected: PASS (10 testes)

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/render-aba-alocacao.js test/semanal-render-aba-alocacao.test.js
git commit -m "Alocacao: markup da aba, com celulas de soltura, cartoes e resumos"
```

---

### Task 9: A interação — arrastar, soltar e recalcular

**Files:**
- Modify: `tools/semanal/render-semanal.js` (CSS em `cssPagina`/`CSS_SEMANAL`, e `SCRIPT_CLIENTE_SEMANAL`)
- Test: `test/semanal-alocacao-interacao.test.js`

**Interfaces:**
- Consumes: `renderAbaAlocacao` (Task 8), `criarClienteAlocacao`/`chaveSemana` (Task 6), `equipesDoQuadro` (Task 1).
- Produces, no escopo do script de cliente: `ESTADO_ALOCACAO` (`{ semanaIdx, alocacao, equipes, foraDoQuadro, cliente }`), `montarAbaAlocacao()`, `aplicarMovimento(equipeId, sup, coluna)`, `semearDoRealizado()`.

**Regras da interação (todas testáveis pelo DOM falso):**
- `aplicarMovimento` valida a coluna contra `data-colunas` da equipe e **recusa** fora do conjunto.
- Célula sem tendência (hachurada) **dentro** do conjunto aceita.
- Depois de aplicar, `montarAbaAlocacao()` redesenha a seção inteira e o cliente grava em segundo plano.

- [ ] **Step 1: Escreva o teste que falha**

Crie `test/semanal-alocacao-interacao.test.js` usando `test/helpers/dom-falso-semanal.js` no mesmo molde de `test/semanal-render-semanal-cliente.test.js` (procure o teste existente que executa `SCRIPT_CLIENTE_SEMANAL` com o DOM falso e copie a montagem). Cubra:

```js
test('soltar uma equipe na coluna dela aplica o movimento', () => {
  // ... monta o cliente com uma equipe SP e a grade com SUP-A||SP
  cliente.aplicarMovimento('4', 'SUP-A', 'SP');
  assert.deepStrictEqual(cliente.ESTADO_ALOCACAO.alocacao['4'], { sup: 'SUP-A', coluna: 'SP' });
});

test('soltar fora do conjunto de colunas da equipe é RECUSADO', () => {
  const ok = cliente.aplicarMovimento('4', 'SUP-A', 'ST');
  assert.strictEqual(ok, false);
  assert.strictEqual(cliente.ESTADO_ALOCACAO.alocacao['4'], undefined);
});

test('soltar numa célula sem tendência, dentro do conjunto, é ACEITO -- é o caso de antecipar', () => {
  const ok = cliente.aplicarMovimento('4', 'SUP-B', 'SP');
  assert.strictEqual(ok, true);
});

test('equipe indisponível não pode ser movida nem por clique', () => {
  const ok = cliente.aplicarMovimento('59', 'SUP-A', 'SP');
  assert.strictEqual(ok, false);
});

test('semear do realizado preenche a partir da última OS da semana', () => {
  cliente.semearDoRealizado();
  assert.strictEqual(cliente.ESTADO_ALOCACAO.alocacao['4'].sup, 'SUP-A');
});

test('trocar de semana recarrega a alocação daquela semana, sem misturar', () => {
  cliente.aplicarMovimento('4', 'SUP-A', 'SP');
  cliente.selecionarSemanaAlocacao(2);
  assert.strictEqual(cliente.ESTADO_ALOCACAO.alocacao['4'], undefined);
  cliente.selecionarSemanaAlocacao(1);
  assert.strictEqual(cliente.ESTADO_ALOCACAO.alocacao['4'].sup, 'SUP-A');
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `node --test test/semanal-alocacao-interacao.test.js`
Expected: FAIL

- [ ] **Step 3: Implemente o estado e as funções no script de cliente**

Em `SCRIPT_CLIENTE_SEMANAL` (`render-semanal.js`), acrescente perto de `ESTADO_BALANCO`:

```js
// A URL do web app de alocação viaja DENTRO do blob cifrado (ver
// renderSemanal), não em texto puro no HTML: só quem destrava a página a
// enxerga. Enquanto o Apps Script não for publicado, o literal fica
// 'PENDENTE-...' e a aba roda inteira em localStorage -- mesmo padrão de
// RE_URL_PENDENTE, e é o estado inicial do recurso.
var ESTADO_ALOCACAO = {
  semanaIdx: -1, alocacao: {}, equipes: [], foraDoQuadro: [], cliente: null,
};

function clienteAlocacao() {
  if (!ESTADO_ALOCACAO.cliente) {
    ESTADO_ALOCACAO.cliente = AlocacaoSheet.criarClienteAlocacao({
      url: (window.__ALOCACAO_URL__ || 'PENDENTE-publicar-o-apps-script'),
      fetch: function (u, o) { return fetch(u, o); },
      armazenamento: window.localStorage,
      autor: (window.__ALOCACAO_AUTOR__ || 'dashboard'),
    });
  }
  return ESTADO_ALOCACAO.cliente;
}

// Recusa fora do conjunto de colunas da equipe e equipe indisponível. Devolve
// true quando aplicou -- é o que o handler de soltura usa para decidir se
// redesenha ou mostra o motivo.
function aplicarMovimento(equipeId, sup, coluna) {
  var equipe = null;
  for (var i = 0; i < ESTADO_ALOCACAO.equipes.length; i++) {
    if (ESTADO_ALOCACAO.equipes[i].id === equipeId) { equipe = ESTADO_ALOCACAO.equipes[i]; break; }
  }
  if (!equipe || !equipe.disponivel) return false;
  if (sup && equipe.colunas.indexOf(coluna) === -1) return false;

  if (!sup) delete ESTADO_ALOCACAO.alocacao[equipeId];
  else ESTADO_ALOCACAO.alocacao[equipeId] = { sup: sup, coluna: coluna };

  montarAbaAlocacao();
  // A gravação vem DEPOIS do redesenho, e não é esperada: a tela nunca trava
  // por causa da rede, e uma falha não desfaz o que o usuário acabou de ver.
  clienteAlocacao().gravar({
    chaveSemana: chaveSemanaAtual(), equipeId: equipeId,
    sup: sup || null, coluna: coluna || null,
  }).then(function () { montarAbaAlocacao(); });
  return true;
}
```

Acrescente também `semearDoRealizado()` (percorre `ESTADO_ALOCACAO.equipes` e usa `supRealizado`/`colunaRealizada`), `selecionarSemanaAlocacao(idx)` (troca `semanaIdx`, chama `carregar` do cliente e remonta) e `montarAbaAlocacao()` (recomputa `equipesDoQuadro` para a semana e injeta o HTML em `#secao-alocacao`).

- [ ] **Step 4: Implemente o arrasto com Pointer Events**

Ainda em `SCRIPT_CLIENTE_SEMANAL`, um único listener delegado em `#secao-alocacao` (a seção nunca é recriada — mesmo padrão do listener do Balanço, `render-semanal.js:818`):

```js
// Pointer Events, não o drag-and-drop nativo do HTML5: o nativo não funciona
// em toque nenhum, e este quadro precisa servir num tablet. O mesmo caminho
// atende mouse e dedo.
//
// Um clique curto (sem mover) SELECIONA a equipe; o clique seguinte numa célula
// a solta ali. Isso é o atalho de teclado/precisão e, de quebra, o caminho que
// o teste do DOM falso exercita sem simular coordenadas.
var ARRASTO = { equipeId: null, fantasma: null, moveu: false };
```

O handler de `pointerdown` num `[data-equipe][data-arrastavel="sim"]` guarda o id e cria o fantasma; `pointermove` posiciona o fantasma e acende as células compatíveis (`.celula-alocacao[data-coluna]` cuja coluna esteja em `data-colunas` da equipe ganham `celula-alvo`, as demais `celula-inerte`); `pointerup` resolve o alvo com `document.elementFromPoint` e chama `aplicarMovimento`, limpando as classes ao final — sempre, inclusive quando recusa.

- [ ] **Step 5: Acrescente o CSS**

Em `CSS_SEMANAL` (`render-semanal.js`), acrescente as classes usadas pelo render e pela interação: `.matriz-alocacao`, `.celula-alocacao`, `.celula-alvo`, `.celula-inerte`, `.cartao-equipe`, `.popup-equipe` (escondido por padrão, visível em `:hover`/`:focus-within`), `.aviso-aceso`, `.aviso-mudo`, `.leitura-*`, `.pool-alocacao`, `.faixa-alocacao`, `.fantasma-arrasto` (`position:fixed; pointer-events:none`). Siga as variáveis de cor já usadas em `cssBase()`.

- [ ] **Step 6: Rode e veja passar**

Run: `node --test test/semanal-alocacao-interacao.test.js`
Expected: PASS (6 testes)

- [ ] **Step 7: Rode a suíte inteira e commite**

```bash
node --test test/*.test.js
git add tools/semanal/render-semanal.js test/semanal-alocacao-interacao.test.js
git commit -m "Alocacao: arrastar com Pointer Events, recalculo imediato e gravacao em segundo plano"
```

---

### Task 10: Integração — a sétima aba, o bundle e o invariante

**Files:**
- Modify: `tools/semanal/render-semanal.js` (`ABAS_VISUALIZACAO`, `BUNDLE_ARQUIVOS`, markup das seções, `mostrarAba`, `montarDashboard`)
- Test: `test/semanal-render-semanal.test.js`, `test/semanal-compute-alocacao.test.js`

**Interfaces:**
- Consumes: tudo das tasks 1-9.
- Produces: a aba `aba-alocacao` funcional na página construída.

- [ ] **Step 1: Escreva o teste do invariante que amarra a aba ao resto**

Acrescente a `test/semanal-compute-alocacao.test.js`:

```js
const { calcularSeriesSemanaisDimensao } = require('../tools/semanal/render-aba-semanal.js');
const { indiceSemanaAtual } = require('../tools/semanal/compute-semanal.js');

test('INVARIANTE: com a alocação vazia, a soma da tendência da grade bate com a Tabela Semanal', () => {
  // Se um dia isto divergir, alguém trocou a fonte de um dos dois. É o único
  // laço que impede a aba nova de virar um segundo cálculo paralelo.
  const registros = registrosDeTeste();
  const indices = [0, 1, 2];
  const o = opcoesBase();
  const grade = montarGradeAlocacao(registros, indices, o);

  let somaGrade = 0;
  grade.linhas.forEach((l) => Object.keys(l.celulas).forEach((k) => { somaGrade += l.celulas[k].tendencia; }));

  const series = calcularSeriesSemanaisDimensao(
    registros, indices, 'volume', o.mesIdx, o.semanas, o.semanas.length,
    true, indiceSemanaAtual(o.semanas, grade.ancoraEpoch), o.demandas, grade.ancoraEpoch
  );
  const daTabela = series.semanasTendenciaCompleta[o.semanas.indexOf(o.semana)] || 0;

  assert.ok(Math.abs(somaGrade - daTabela) < 1e-6,
    `grade ${somaGrade} != tabela ${daTabela}`);
});
```

- [ ] **Step 2: Rode e veja falhar ou passar**

Run: `node --test test/semanal-compute-alocacao.test.js`
Expected: PASS se a grade já usa a mesma fonte. **Se falhar, o bug é da grade, não do teste** — o mais provável é a âncora ou o índice da semana divergirem. Conserte `montarGradeAlocacao`.

- [ ] **Step 3: Registre a aba**

Em `ABAS_VISUALIZACAO` (`render-semanal.js`), acrescente como último item:

```js
  // Ícone: pessoas num quadro -- distinto dos 6 que já existem nesta barra.
  { id: 'aba-alocacao', rotulo: 'Alocação Equipes', ativa: false,
    svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M5 17c0-2 2-3 4-3s4 1 4 3"/><path d="M16 9h3M16 13h3"/></svg>' },
```

E o contêiner, junto dos outros `#secao-*`:

```html
    <div id="secao-alocacao" style="display:none"></div>
```

Em `mostrarAba`, acrescente a linha equivalente às que já existem:

```js
  document.getElementById('secao-alocacao').style.display = aba === 'alocacao' ? '' : 'none';
```

- [ ] **Step 4: Registre os módulos no bundle, na ORDEM certa**

Em `BUNDLE_ARQUIVOS`, acrescente ao fim (a ordem é o contrato de dependência):

```js
  // Alocação Equipes (2026-08-10). equipes-alocaveis.js consome
  // compute-equipes-ativas.js e classificar-dia-equipe.js -- os dois já estão
  // registrados acima. compute-alocacao.js consome equipes-alocaveis.js,
  // render-aba-semanal.js, render-alertas-tendencia.js e compute-semanal.js,
  // todos acima, mais um require de '../comum/calculo-equipes.js' que o
  // bundler REMOVE (DIAS_PREMISSA_MES chega como global pelo <script> de
  // fonteParaCliente, igual ao que compute-alertas-tendencia.js já faz).
  // alocacao-sheet.js não consome nada. render-aba-alocacao.js consome
  // compute-alocacao.js e equipes-alocaveis.js -- por último.
  'equipes-alocaveis.js', 'compute-alocacao.js', 'alocacao-sheet.js', 'render-aba-alocacao.js',
```

- [ ] **Step 5: Ligue `montarAbaAlocacao` ao ciclo de redesenho**

Em `montarDashboard` (`render-semanal.js`), acrescente a chamada junto das outras `montarAba*`, e passe:

- `indices` **sem** `filtro-ativos` — use `indicesFiltrados`, não `indicesDaAba`. O filtro de ativos esconderia justamente as linhas `Parado c/ carteira`.
- `semana` a partir de `ESTADO_ALOCACAO.semanaIdx`, com o padrão sendo a semana em curso (`indiceSemanaAtual`).
- `somenteLeitura: 'mes-diferente'` quando `window.__DEMANDAS__.equipesAtivasPeriodo.mes - 1 !== mesSelecionadoIdx`.
- `semRoster: true` quando `window.__DEMANDAS__.equipesCsv` for nulo.

- [ ] **Step 6: Injete a URL do endpoint dentro do blob cifrado**

Em `renderSemanal` (`render-semanal.js`), acrescente ao objeto que é serializado e cifrado (junto de `registros`/`baseline`/`demandas`) um campo `alocacaoUrl`, e no script de desbloqueio atribua `window.__ALOCACAO_URL__` a partir dele — do mesmo jeito que `window.__DEMANDAS__` já é atribuído em `aplicarDadosDecifrados`. O valor vem de uma constante no topo do arquivo:

```js
// Web app do Apps Script que guarda a alocação (tools/semanal/apps-script-alocacao.gs).
// Enquanto não for publicado, o literal PENDENTE- mantém a aba em modo local,
// dizendo isso na tela -- mesmo padrão de URL_ESPELHO_AVANCOS_SEMANAL.
const URL_ALOCACAO = 'PENDENTE-publicar-o-apps-script-de-alocacao';
```

- [ ] **Step 7: Rode a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS. `test/comum-browser-bundle.test.js` e `test/semanal-render-semanal.test.js` são os que pegam erro de ordem no bundle.

- [ ] **Step 8: Construa de verdade e confira**

```bash
ORCAMENTO_SENHA='sptinfra@2026' node tools/semanal/build-dashboard.js
```

Expected: o build imprime a linha de "Equipes ATIVAS" e grava `dist/planejamento-semanal.html`. **Se as fontes em `G:` não estiverem montadas, pare e reporte** — não invente fixture para contornar.

- [ ] **Step 9: Commit**

```bash
git add tools/semanal/render-semanal.js test/semanal-compute-alocacao.test.js
git commit -m "Alocacao: setima aba ligada, bundle registrado e invariante com a Tabela Semanal"
```

---

### Task 11: Revisão de design do Open Design

**Files:**
- Create: um snapshot estático em `<scratchpad>/alocacao-snapshot.html` (fora do repositório)
- Modify: `tools/semanal/render-semanal.js` e/ou `tools/semanal/render-aba-alocacao.js`, conforme o que a revisão apontar

O `CLAUDE.md` exige revisão de design do Open Design em todo trabalho de HTML deste projeto. Três armadilhas registradas lá, todas capazes de fazer a revisão falhar em silêncio:

- **NÃO use o projeto `3b8ae52a-...` ("Projetos IA")** — ele tem `skill: agent-browser` e o plugin `example-web-prototype`, que engolem o prompt: o run volta `succeeded` em ~9 segundos com `artifactCount: 0`. Crie um projeto dedicado (`create_project` com `skill: "design-review"`).
- **As páginas deste repositório não servem como insumo direto** (gate de senha + blob cifrado): gere um snapshot que RENDERIZE a aba, com dados **sintéticos**, e com o CSS extraído do `<style>` que o próprio render emite.
- **Calibre os dados para todos os estados visuais aparecerem juntos:** as 5 leituras por SUP, aviso aceso e mudo, célula hachurada, equipe polivalente, equipe indisponível, ocupação nas 4 faixas, e o status em modo local.

- [ ] **Step 1: Gere o snapshot estático com dados sintéticos**

Escreva um script temporário no scratchpad que importe `renderAbaAlocacao` e o CSS de `render-semanal.js`, monte registros/equipes fictícios cobrindo os estados acima, e grave o HTML completo. **Nenhum dado real** — o snapshot é texto puro e vazaria fora do blob cifrado.

- [ ] **Step 2: Crie o projeto dedicado e rode a revisão**

```
mcp__open-design__create_project  → skill: "design-review", nome "revisao-alocacao-equipes"
mcp__open-design__start_run       → agent: "claude", skill: "design-review"
```

- [ ] **Step 3: Confira `events.jsonl` antes de concluir**

O agente interno do OD consome a MESMA cota da conta. Um run pode morrer no meio com `failureCategory: rate_limit`: o `status` diz `failed`, mas os arquivos já editados ficam. Leia `events.jsonl` do run antes de dar a revisão por terminada. **Se o Open Design não estiver disponível na máquina, siga sem ele** e registre isso na resposta.

- [ ] **Step 4: Porte à mão as sugestões que valerem a pena**

Os "fixes" do OD caem numa cópia dentro do projeto dele. Porte para `render-aba-alocacao.js`/`render-semanal.js` — editar o HTML construído não dura, a próxima reconstrução apaga.

- [ ] **Step 5: Rode a suíte e commite**

```bash
node --test test/*.test.js
git add tools/semanal/
git commit -m "Alocacao: ajustes da revisao de design do Open Design"
```

---

### Task 12: Reconstruir, copiar para `docs/`, commitar e publicar

**Files:**
- Modify: `dist/planejamento-semanal.html`, `docs/planejamento-semanal.html`
- Modify: `orcamento-dashboard/CLAUDE.md`

- [ ] **Step 1: Reconstrua**

```bash
ORCAMENTO_SENHA='sptinfra@2026' node tools/semanal/build-dashboard.js
cp dist/planejamento-semanal.html docs/planejamento-semanal.html
```

**A cópia para `docs/` não é opcional:** o Pages serve `/docs`, o build só escreve em `dist/`, e esquecer esse passo já deixou o site servindo um build de dois commits antes (2026-07-22).

- [ ] **Step 2: Rode a suíte inteira uma última vez**

Run: `node --test test/*.test.js`
Expected: PASS, incluindo `publicacao-docs-sincronizado.test.js`, que trava a cópia acima.

- [ ] **Step 3: Registre o recurso no `CLAUDE.md`**

Acrescente uma seção `### Aba Alocação Equipes (2026-08-10)` em `orcamento-dashboard/CLAUDE.md`, cobrindo: as 6 colunas e por que BL não entra em Especiais; a âncora única de tendência+carteira; a correção do bug de Especiais em `compute-equipes-ativas.js`; que a aba **não** usa `filtro-ativos` e por quê; que o espelho da aba EQ só cobre o mês corrente; e o passo de setup pendente do `apps-script-alocacao.gs` (com a nota de que quem tem a senha pode gravar).

- [ ] **Step 4: Commit e publicação**

```bash
git add dist/planejamento-semanal.html docs/planejamento-semanal.html CLAUDE.md
git commit -m "Rebuild: aba Alocacao Equipes"
git push origin HEAD:master
```

**Confira o publicado pelo conteúdo, não pelo status da API de builds** — ela reporta "built" mesmo quando `/docs` não mudou. Faça `curl` na URL ao vivo e confirme que a aba aparece.

- [ ] **Step 5: Diga ao dono do projeto o que falta do lado dele**

A aba nasce em **modo local** (`PENDENTE-`). Para ligar a gravação compartilhada ele precisa: criar a Sheet, colar `tools/semanal/apps-script-alocacao.gs`, implantar como App da Web (executar como ele, acesso "qualquer pessoa") e mandar a URL `/exec`. Aí basta trocar `URL_ALOCACAO` e reconstruir.

---

## Self-Review

**Cobertura do spec:** Decisão 1 → Tasks 1 e 2. Decisão 2 (tendência travada, âncora única) → Task 4. Decisão 3 (capacidade/carga) → Task 3. Decisão 4 (três níveis, aviso condicional) → Task 5. Decisão 5 (prioridade estável) → Task 4, Step 1, teste "a ordem NÃO muda". Decisão 6 (interação) → Task 9. Decisão 7 (popup) → Task 8. Decisão 8 (persistência) → Task 6. Decisão 9 (semear do realizado) → Tasks 1 e 9. Limites de tela → Task 8, Steps 1 e 3. Testes do spec → Tasks 1, 3, 4, 5, 6, 8, 9, 10.

**Consistência de nomes entre tasks:** `equipesDoQuadro` (T1) → consumida em T9; `montarGradeAlocacao`/`resumirAlocacao` (T4/T5) → consumidas em T8; `criarClienteAlocacao`/`chaveSemana` (T6) → consumidas em T9; `demandas.equipesCsv` (T7) → consumido em T10; `COLUNAS_ALOCACAO` (T1) → consumida em T4 e T8. `capacidadeDaEquipe` devolve `null` sem premissa (T3) e T5 trata esse `null` explicitamente em `capacidadeDeReferencia`.
