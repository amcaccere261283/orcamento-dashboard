# Aba Mapa na página Alocação Equipes — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar uma segunda visão (mapa) à página `docs/alocacao-equipes.html`, com pinos por SUP coloridos pela mesma leitura que o Kanban já usa, arrasto de equipes do pool até o pino (mesmas regras: trava de veículo, filtros, busca), e identidade visual Suporte Infra só nessa aba.

**Architecture:** Duas abas (`Kanban`/`Mapa`) dentro da mesma página, mesmo estado `ESTADO_ALOCACAO`, mesma persistência (Sheet/localStorage). A camada de dados (`montarGradeAlocacao`/`resumirAlocacao`) é extraída para uma função compartilhada (`prepararDadosAlocacao`) que os dois lados consomem — nenhuma regra de negócio nova. O mapa em si é MapLibre GL JS com tiles raster Esri/ArcGIS (réplica do setup em produção do projeto Mapa Sondagens, `http://192.168.1.53:8080/`), pinos como marcadores DOM (reaproveitam as classes CSS `.leitura-*` já existentes para a cor), arrasto por Pointer Events reaproveitando o mesmo `aplicarMovimento`/`resolverAlvoAlocacao` que a tabela usa hoje, só estendido para reconhecer o pino como alvo.

**Tech Stack:** Node.js (`node --test`), JS "dual module" (Node + navegador, via `tools/comum/browser-bundle.js`), MapLibre GL JS 4.7.1 (CDN unpkg), tiles raster Esri/ArcGIS Online (`World_Imagery`, `Reference/World_Transportation`, `Reference/World_Boundaries_and_Places`), CSS puro (sem framework).

## Global Constraints

- Branch de trabalho: `semanal-alocacao-mapa` (já criada a partir de `origin/master`, commit `e791b3e` = a spec). Todo commit deste plano vai nela.
- `node --test test/*.test.js` tem que continuar 100% verde depois de CADA tarefa — nenhuma tarefa deste plano pode deixar a suíte quebrada, mesmo que a feature ainda não esteja completa.
- Nenhuma regra de negócio nova ou duplicada: `aplicarMovimento`, `resolverAlvoAlocacao`, `montarGradeAlocacao`, `resumirAlocacao`, `leituraDoSup`, `destinoDoGrupo` (trava de veículo) continuam sendo os únicos donos das regras — o mapa só estende a DETECÇÃO de alvo e a APRESENTAÇÃO.
- Módulos "duais" (rodam no Node E no navegador via `tools/comum/browser-bundle.js`) usam `'use strict';` + `var`/`function` (nunca `const`/`let`/arrow function no corpo) e `require('./arquivo-do-mesmo-diretorio.js')` — é o formato EXATO que `transformaModulo` reconhece. Módulos Node-only (scripts `atualizar-*.js`, `build-dashboard.js`) podem usar `const`/arrow normalmente.
- Cor de PINO (leitura/status) e cor de TIPOLOGIA (pool) são dois canais visuais separados — nunca reusar `#7fd858`/`#e0684f` (verde/vermelho da leitura) como cor de tipologia, nem vice-versa.
- Toda mudança que toca `render-alocacao-pagina.js`/`render-aba-alocacao.js` preserva o comportamento hoje existente da aba Kanban byte a byte onde não há mudança pretendida — a suíte já tem os goldens que provam isso (`test/semanal-render-aba-alocacao.test.js`, `test/semanal-render-alocacao-pagina.test.js`).
- Assets novos já estão no repo (baixados do Mapa Sondagens em produção, mesmos arquivos): `assets/mapa-alocacao/nimbus-sans-extd.otf`, `assets/mapa-alocacao/nimbus-sans-extd-black.otf`, `assets/mapa-alocacao/textura-fundo.png`.

---

## Task 1: Extrair `prepararDadosAlocacao` de `renderAbaAlocacao` (refactor puro)

A aba Mapa precisa da MESMA `grade`/`resumo`/`equipes` que a tabela já calcula — hoje esses três objetos são computados DENTRO de `renderAbaAlocacao` e nunca saem dela. Esta tarefa extrai esse cálculo para uma função própria, sem mudar UM BYTE do HTML que `renderAbaAlocacao` já produz — é o alicerce que evita duplicar a lógica de negócio no mapa.

**Files:**
- Modify: `tools/semanal/render-aba-alocacao.js:624-675` (a função `renderAbaAlocacao` e a área logo acima dela)
- Test: `test/semanal-render-aba-alocacao.test.js` (já existe — não muda, é a prova de regressão)
- Test: `test/semanal-compute-alocacao-preparar-dados.test.js` (novo)

**Interfaces:**
- Produces: `prepararDadosAlocacao(registros, indices, opcoes)` → `{ somenteLeitura, equipes, equipesPorId, grade, resumo, porEquipeMap }` quando `opcoes.semRoster` é falso; `null` quando `opcoes.semRoster` é truthy (chamador decide o que desenhar nesse caso — a guarda "sem roster" NÃO faz parte desta função, de propósito, porque ela é sobre COMPUTAR dado, e "sem roster" é sobre a AUSÊNCIA dele).
- Exportada em `module.exports` de `render-aba-alocacao.js`, ao lado de `renderAbaAlocacao`.

- [ ] **Step 1: Escrever o teste da extração**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { prepararDadosAlocacao } = require('../tools/semanal/render-aba-alocacao.js');

function registroSintetico(sup, tipologia, previstoAgosto) {
  const volume = new Array(12).fill(0);
  volume[7] = previstoAgosto;
  return { sup, tomador: 'Tomador Teste', tipologia, previsto: { volume, equipesResumo: { prod: 2 } } };
}

function equipeSintetica(id, colunas) {
  return { id, lider: 'Líder ' + id, colunas, disponivel: true, diasDisponiveis: 5, diasDaSemana: 5, companheiros: [], polivalente: colunas.length > 1 };
}

test('prepararDadosAlocacao devolve null quando semRoster', () => {
  const resultado = prepararDadosAlocacao([], [], { semRoster: true });
  assert.strictEqual(resultado, null);
});

test('prepararDadosAlocacao devolve grade/resumo/equipes coerentes com uma equipe alocada', () => {
  const registros = [registroSintetico('SUP-A', 'SP', 100)];
  const opcoes = {
    mesIdx: 7, semanas: [{ inicio: 100, fim: 106 }], semana: { inicio: 100, fim: 106 },
    demandas: {}, hojeEpoch: 100,
    equipes: [equipeSintetica('4', ['SP'])],
    alocacao: { 4: { sup: 'SUP-A', coluna: 'SP' } },
  };
  const dados = prepararDadosAlocacao(registros, [0], opcoes);
  assert.ok(dados);
  assert.strictEqual(dados.grade.linhas.length, 1);
  assert.strictEqual(dados.grade.linhas[0].sup, 'SUP-A');
  assert.strictEqual(dados.equipesPorId['4'].id, '4');
  assert.strictEqual(dados.resumo.porSup[0].sup, 'SUP-A');
  assert.strictEqual(dados.porEquipeMap['4'].sup, 'SUP-A');
});
```

- [ ] **Step 2: Rodar o teste novo e confirmar que falha**

Run: `node --test test/semanal-compute-alocacao-preparar-dados.test.js`
Expected: FAIL — `prepararDadosAlocacao` não existe ainda em `render-aba-alocacao.js`.

- [ ] **Step 3: Extrair a função em `render-aba-alocacao.js`**

Substituir o trecho de `renderAbaAlocacao` (linhas 624-675 do arquivo atual) por:

```js
// registros/indices: os de sempre. opcoes: mesmo shape que renderAbaAlocacao
// recebia antes desta extração -- ver o comentário que já existia ali.
// Devolve null quando opcoes.semRoster: esta função é só sobre CALCULAR
// grade/resumo, não sobre decidir o que desenhar na ausência de roster --
// essa decisão continua em renderAbaAlocacao (a tabela) e, a partir desta
// tarefa, também no chamador da aba Mapa.
//
// Extraída (2026-08-26) para a aba Mapa poder desenhar pinos por SUP sem
// duplicar montarGradeAlocacao/resumirAlocacao -- ver
// docs/superpowers/specs/2026-08-26-alocacao-equipes-mapa-design.md,
// Decisão 2.
function prepararDadosAlocacao(registros, indices, opcoes) {
  var o = opcoes || {};
  if (o.semRoster) return null;

  var somenteLeitura = o.somenteLeitura || null;
  var equipesBrutas = o.equipes || [];
  var equipes = marcarConflitos(equipesBrutas, o.alocacao || {});
  var equipesPorId = {};
  equipes.forEach(function (e) { equipesPorId[e.id] = e; });

  var termoBusca = normalizarBusca(o.buscaEquipe || '');
  var equipesVisiveis = null;
  if (termoBusca) {
    equipesVisiveis = [];
    equipes.forEach(function (e) {
      if (equipeCasaBusca(e, termoBusca)) equipesVisiveis.push(e.id);
    });
  }

  var opcoesGrade = {};
  Object.keys(o).forEach(function (k) { opcoesGrade[k] = o[k]; });
  opcoesGrade.equipesVisiveis = equipesVisiveis;
  opcoesGrade.tipologia = o.tipologiaAlocacao || null;

  var grade = montarGradeAlocacao(registros, indices, opcoesGrade);
  var resumo = resumirAlocacao(grade, { equipes: equipes, mesIdx: o.mesIdx });
  var porEquipeMap = {};
  resumo.porEquipe.forEach(function (e) { porEquipeMap[e.id] = e; });

  return {
    somenteLeitura: somenteLeitura, equipes: equipes, equipesPorId: equipesPorId,
    grade: grade, resumo: resumo, porEquipeMap: porEquipeMap,
  };
}

// registros/indices: os de sempre. opcoes:
//   { mesIdx, ano, semanas, semana, demandas, equipes, foraDoQuadro, alocacao,
//     hojeEpoch, modoPersistencia, pendentes, semRoster, somenteLeitura }
// semRoster: a Sheet espelho da EQ não respondeu -- guarda, sem grade nenhuma.
// somenteLeitura: 'mes-diferente' quando a semana pedida é de outro mês que
//   não o que o espelho da EQ cobre -- desenha a grade, mas nada é arrastável.
function renderAbaAlocacao(registros, indices, opcoes) {
  var o = opcoes || {};

  // A guarda vem ANTES de qualquer grade -- um quadro vazio leria como "nada
  // alocado", que é uma afirmação diferente e falsa de "não sabemos".
  if (o.semRoster) {
    return renderControles(o, true) + renderGuardaSemRoster();
  }

  var dados = prepararDadosAlocacao(registros, indices, opcoes);
  var somenteLeitura = dados.somenteLeitura;

  var html = renderControles(o, somenteLeitura);
  html += renderFaixaAlocacao(dados.resumo.totais);
  if (somenteLeitura === 'mes-diferente') html += renderAvisoSomenteLeitura();
  html += renderPool(dados.equipes, o.foraDoQuadro, dados.porEquipeMap, somenteLeitura, o.alocacao, o.buscaEquipe, o.tipologiaAlocacao || null);
  html += renderMatriz(dados.grade, dados.resumo, dados.equipesPorId, somenteLeitura);
  html += renderResumoSup(dados.resumo.porSup);
  html += renderResumoEquipe(dados.resumo.porEquipe);
  return html;
}
```

Em `module.exports` (fim do arquivo), acrescentar `prepararDadosAlocacao` à lista já exportada (ao lado de `renderAbaAlocacao`).

- [ ] **Step 4: Rodar o teste novo — confirmar que passa**

Run: `node --test test/semanal-compute-alocacao-preparar-dados.test.js`
Expected: PASS

- [ ] **Step 5: Rodar a suíte inteira — a extração não pode mudar NENHUM HTML gerado**

Run: `node --test test/*.test.js`
Expected: PASS em tudo, incluindo `test/semanal-render-aba-alocacao.test.js` e `test/semanal-render-alocacao-pagina.test.js` sem nenhuma alteração neles.

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/render-aba-alocacao.js test/semanal-compute-alocacao-preparar-dados.test.js
git commit -m "refactor: extrai prepararDadosAlocacao de renderAbaAlocacao (base pra aba Mapa)"
```

---

## Task 2: `coordenadas-sup.js` — resolvedor tolerante de coordenada por SUP

Módulo novo, puro, dual (Node + navegador). Lê um grid CSV (header + rows, o MESMO formato que `mapear-demandas-sondagem.js`/`mapear-producao-total.js` já produzem) e devolve a primeira coordenada válida encontrada por SUP. Nunca lança — SUP sem coluna de coordenada, ou com valor não-numérico, simplesmente não entra no resultado.

**Files:**
- Create: `tools/semanal/coordenadas-sup.js`
- Test: `test/semanal-coordenadas-sup.test.js`

**Interfaces:**
- Produces: `resolverCoordenadasPorSup(header, rows)` → `{ [sup]: { lat: number, lon: number } }`. `header` é um array de strings (nomes de coluna); `rows` é um array de arrays (uma linha por furo/OS), na MESMA ordem posicional do `header`. A coluna do SUP é sempre `'Contrato'` (mesmo nome que `HEADER_SAIDA` já usa em `mapear-producao-total.js`).

- [ ] **Step 1: Escrever o teste**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { resolverCoordenadasPorSup } = require('../tools/semanal/coordenadas-sup.js');

test('resolve lat/lon quando as colunas Latitude/Longitude existem', () => {
  const header = ['Contrato', 'Tipo', 'Latitude', 'Longitude'];
  const rows = [['SUP-A', 'SP', '-25.5', '-49.2']];
  const resultado = resolverCoordenadasPorSup(header, rows);
  assert.deepStrictEqual(resultado, { 'SUP-A': { lat: -25.5, lon: -49.2 } });
});

test('aceita variações comuns de nome de coluna (Lat/Lon/Lng)', () => {
  assert.deepStrictEqual(
    resolverCoordenadasPorSup(['Contrato', 'Lat', 'Lon'], [['SUP-B', '-25.4', '-49.1']]),
    { 'SUP-B': { lat: -25.4, lon: -49.1 } }
  );
  assert.deepStrictEqual(
    resolverCoordenadasPorSup(['Contrato', 'Lat', 'Lng'], [['SUP-C', '-25.3', '-49.0']]),
    { 'SUP-C': { lat: -25.3, lon: -49.0 } }
  );
});

test('sem coluna de coordenada -- devolve objeto vazio, nunca lança', () => {
  const header = ['Contrato', 'Tipo'];
  const rows = [['SUP-D', 'SP']];
  assert.deepStrictEqual(resolverCoordenadasPorSup(header, rows), {});
});

test('valor não-numérico ou célula vazia -- SUP não entra no resultado', () => {
  const header = ['Contrato', 'Latitude', 'Longitude'];
  const rows = [
    ['SUP-E', '', ''],
    ['SUP-F', 'abc', '-49.2'],
  ];
  assert.deepStrictEqual(resolverCoordenadasPorSup(header, rows), {});
});

test('lat e lon ambos zero é tratado como ausente -- 0,0 é o placeholder mais comum de planilha, nunca um SUP real', () => {
  const header = ['Contrato', 'Latitude', 'Longitude'];
  const rows = [['SUP-G', '0', '0']];
  assert.deepStrictEqual(resolverCoordenadasPorSup(header, rows), {});
});

test('duas linhas do mesmo SUP -- usa a PRIMEIRA coordenada válida, ignora a segunda', () => {
  const header = ['Contrato', 'Latitude', 'Longitude'];
  const rows = [
    ['SUP-H', '-25.5', '-49.2'],
    ['SUP-H', '-25.9', '-49.9'],
  ];
  assert.deepStrictEqual(resolverCoordenadasPorSup(header, rows), { 'SUP-H': { lat: -25.5, lon: -49.2 } });
});

test('linha sem Contrato preenchido é ignorada', () => {
  const header = ['Contrato', 'Latitude', 'Longitude'];
  const rows = [['', '-25.5', '-49.2']];
  assert.deepStrictEqual(resolverCoordenadasPorSup(header, rows), {});
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-coordenadas-sup.test.js`
Expected: FAIL — o módulo não existe.

- [ ] **Step 3: Implementar**

```js
'use strict';

// Resolvedor TOLERANTE de coordenada por SUP -- lê um grid CSV (header +
// rows, o mesmo formato que mapear-producao-total.js/mapear-demandas-
// sondagem.js já produzem) e devolve a primeira coordenada válida por SUP.
//
// Contexto: no momento em que este módulo foi escrito, NENHUMA fonte de
// dado deste projeto tinha coordenada nenhuma -- Patrick (dono da fonte de
// demandas) ainda vai publicar Latitude/Longitude no site que
// tools/semanal/atualizar-demandas-sondagem-online.js raspa. Os nomes de
// coluna abaixo são um CHUTE educado (variações comuns); se o nome real
// vier diferente, o ajuste fica CONTIDO nesta lista -- nunca espalha pelo
// resto do pipeline. Ver
// docs/superpowers/specs/2026-08-26-alocacao-equipes-mapa-design.md,
// Decisão 3.
//
// Resolve por IGUALDADE EXATA (nunca por prefixo/contains) -- mesmo padrão
// já estabelecido em tools/medicoes/parse-medicoes.js (ver CLAUDE.md, "A
// planilha das medições renomeia colunas"): um "Latitude (aprox.)" do lado
// de um "Latitude" real seria capturado por engano com prefixo.
//
// NUNCA lança. SUP sem coluna de coordenada, sem valor numérico, ou com
// 0/0 (placeholder mais comum de planilha, nunca uma coordenada real no
// Brasil) simplesmente não entra no resultado -- o chamador trata "sem
// entrada" como "sem localização", nunca como erro.
var CANDIDATOS_LAT = ['Latitude', 'Lat'];
var CANDIDATOS_LON = ['Longitude', 'Lon', 'Lng'];
var COLUNA_SUP = 'Contrato';

function acharColuna(header, candidatos) {
  for (var c = 0; c < candidatos.length; c++) {
    for (var col = 0; col < header.length; col++) {
      if (String(header[col] || '').trim() === candidatos[c]) return col;
    }
  }
  return -1;
}

function numeroOuNull(valor) {
  var texto = String(valor === null || valor === undefined ? '' : valor).trim();
  if (texto === '') return null;
  var n = parseFloat(texto);
  return isNaN(n) ? null : n;
}

function resolverCoordenadasPorSup(header, rows) {
  var h = header || [];
  var colSup = acharColuna(h, [COLUNA_SUP]);
  var colLat = acharColuna(h, CANDIDATOS_LAT);
  var colLon = acharColuna(h, CANDIDATOS_LON);
  var resultado = {};
  if (colSup === -1 || colLat === -1 || colLon === -1) return resultado;

  (rows || []).forEach(function (row) {
    var sup = String(row[colSup] || '').trim();
    if (!sup || resultado[sup]) return; // já resolvido -- primeira coordenada válida vence
    var lat = numeroOuNull(row[colLat]);
    var lon = numeroOuNull(row[colLon]);
    if (lat === null || lon === null) return;
    if (lat === 0 && lon === 0) return;
    resultado[sup] = { lat: lat, lon: lon };
  });
  return resultado;
}

module.exports = { resolverCoordenadasPorSup };
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/semanal-coordenadas-sup.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/coordenadas-sup.js test/semanal-coordenadas-sup.test.js
git commit -m "feat: coordenadas-sup.js -- resolvedor tolerante de lat/lon por SUP"
```

---

## Task 3: `escolherColunaAutomatica` em `compute-alocacao.js`

No Kanban, soltar uma equipe polivalente numa célula escolhe a coluna pela POSIÇÃO física da célula. No mapa há um pino só por SUP — esta função decide, entre as colunas que a equipe atende, qual delas o pino representa: a que já tem uma célula real (tendência/carteira/equipe) naquele SUP com o MAIOR déficit (saldo mais negativo); se nenhuma candidata tem célula real ali, cai na primeira candidata (ordem de `COLUNAS_ALOCACAO`, que já é a ordem de `equipe.colunas`).

**Files:**
- Modify: `tools/semanal/compute-alocacao.js` (adicionar função + export, sem tocar nas existentes)
- Test: `test/semanal-compute-alocacao.test.js` (arquivo já existe — acrescentar os testes novos nele)

**Interfaces:**
- Consumes: nada de novo — só os tipos que `montarGradeAlocacao` já produz (`linha.celulas`, `celula.saldo`).
- Produces: `escolherColunaAutomatica(colunasEquipe, celulasDaLinha)` → `string | null`. `colunasEquipe` é `equipe.colunas` (array de ids de coluna, na ordem em que a equipe as serve). `celulasDaLinha` é `linha.celulas` de UMA linha de `grade.linhas` (objeto `{ colunaId: celula }`, só as colunas que já têm algo NAQUELE SUP). `null` só quando `colunasEquipe` está vazio.

- [ ] **Step 1: Escrever os testes**

```js
// Acrescentar ao final de test/semanal-compute-alocacao.test.js:
const { escolherColunaAutomatica } = require('../tools/semanal/compute-alocacao.js');

test('escolherColunaAutomatica escolhe a coluna candidata com maior déficit (saldo mais negativo)', () => {
  const celulas = {
    ST: { saldo: -2 },
    PI: { saldo: -10 },
    BL: { saldo: 3 },
  };
  assert.strictEqual(escolherColunaAutomatica(['ST', 'PI', 'BL'], celulas), 'PI');
});

test('escolherColunaAutomatica ignora coluna sem célula real naquele SUP', () => {
  const celulas = { PI: { saldo: -1 } }; // ST/BL não têm célula NESTE sup
  assert.strictEqual(escolherColunaAutomatica(['ST', 'PI', 'BL'], celulas), 'PI');
});

test('escolherColunaAutomatica cai na primeira candidata quando NENHUMA tem célula real ali', () => {
  assert.strictEqual(escolherColunaAutomatica(['ST', 'PI', 'BL'], {}), 'ST');
});

test('escolherColunaAutomatica com equipe de coluna única devolve essa coluna direto', () => {
  assert.strictEqual(escolherColunaAutomatica(['SP'], {}), 'SP');
});

test('escolherColunaAutomatica sem nenhuma coluna devolve null', () => {
  assert.strictEqual(escolherColunaAutomatica([], {}), null);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-compute-alocacao.test.js`
Expected: FAIL — `escolherColunaAutomatica` não existe.

- [ ] **Step 3: Implementar em `compute-alocacao.js`**

Acrescentar logo antes de `module.exports` (fim do arquivo):

```js
// Decide, entre as colunas que a equipe atende, qual delas o PINO do mapa
// representa quando ela é solta ali -- só existe porque o mapa tem UM pino
// por SUP (não uma célula por coluna, como a tabela). Prefere a candidata
// com célula REAL naquele SUP (algo já aconteceu ali -- tendência, carteira
// ou equipe) e o MAIOR déficit (saldo mais negativo, a mais carente); sem
// nenhuma candidata com célula real, cai na primeira da lista (que já
// chega na ordem de COLUNAS_ALOCACAO, via equipe.colunas).
//
// Não valida se a equipe PODE ir pra essa coluna -- quem recusa é
// aplicarMovimento/destinoDoGrupo, como sempre. Esta função só decide QUAL
// das colunas válidas propor.
function escolherColunaAutomatica(colunasEquipe, celulasDaLinha) {
  var candidatas = (colunasEquipe || []).filter(function (c) {
    return celulasDaLinha && celulasDaLinha[c];
  });
  if (candidatas.length) {
    candidatas.sort(function (a, b) {
      return celulasDaLinha[a].saldo - celulasDaLinha[b].saldo;
    });
    return candidatas[0];
  }
  return (colunasEquipe && colunasEquipe[0]) || null;
}
```

E acrescentar `escolherColunaAutomatica` ao `module.exports` existente.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/semanal-compute-alocacao.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/compute-alocacao.js test/semanal-compute-alocacao.test.js
git commit -m "feat: escolherColunaAutomatica -- resolve a coluna do pino pra equipe polivalente"
```

---

## Task 4: `Latitude`/`Longitude` opcionais em `HEADER_SAIDA` e nos dois mapeadores

`HEADER_SAIDA` (`mapear-producao-total.js`) é compartilhado por `mapearProducaoTotal` (Link 1, realizado) e `juntarPendentesSondagem` (Link 2+3, pendentes) — as duas escrevem `dist/demandas-sondagem-online.csv`. Esta tarefa acrescenta duas colunas TRAILING (nunca quebra leitura posicional existente, porque tudo downstream já resolve coluna por NOME via `locateColunasAvancos`) e faz as duas funções tentarem lê-las da linha crua, tolerando ausência (célula vazia, nunca erro).

**Files:**
- Modify: `tools/semanal/mapear-producao-total.js`
- Modify: `tools/semanal/mapear-demandas-sondagem.js`
- Test: `test/semanal-mapear-producao-total.test.js` (já existe)
- Test: `test/semanal-mapear-demandas-sondagem.test.js` (já existe)

**Interfaces:**
- `HEADER_SAIDA` passa de 10 para 12 entradas: `[..., 'Latitude', 'Longitude']`.
- `mapearProducaoTotal`/`juntarPendentesSondagem` continuam devolvendo `{ header, rows, ... }` — `rows[i]` ganha 2 elementos a mais no fim.

- [ ] **Step 1: Escrever os testes novos**

```js
// Acrescentar ao final de test/semanal-mapear-producao-total.test.js:
test('Latitude/Longitude são lidas quando presentes na linha crua, e vazias quando ausentes', () => {
  const { mapearProducaoTotal, HEADER_SAIDA } = require('../tools/semanal/mapear-producao-total.js');
  const colLat = HEADER_SAIDA.indexOf('Latitude');
  const colLon = HEADER_SAIDA.indexOf('Longitude');
  assert.notStrictEqual(colLat, -1);
  assert.notStrictEqual(colLon, -1);

  const linhaComCoordenada = { Tipo: 'SP', 'ID Contrato': 'SUP-A', 'Criação da OS': '', 'Status Atual': '', 'Executado Dia': '', Deslocamento: '', 'Total (m)': '', 'Observações de campo': '', OS: '1', Sondador: '', Latitude: '-25.5', Longitude: '-49.2' };
  const { rows } = mapearProducaoTotal([linhaComCoordenada]);
  assert.strictEqual(rows[0][colLat], '-25.5');
  assert.strictEqual(rows[0][colLon], '-49.2');

  const linhaSemCoordenada = Object.assign({}, linhaComCoordenada, { Latitude: undefined, Longitude: undefined });
  const { rows: rows2 } = mapearProducaoTotal([linhaSemCoordenada]);
  assert.strictEqual(rows2[0][colLat], '');
  assert.strictEqual(rows2[0][colLon], '');
});
```

```js
// Acrescentar ao final de test/semanal-mapear-demandas-sondagem.test.js:
test('Latitude/Longitude do Link 2 (furo pendente) são repassadas quando presentes', () => {
  const { HEADER_SAIDA } = require('../tools/semanal/mapear-producao-total.js');
  const colLat = HEADER_SAIDA.indexOf('Latitude');
  const colLon = HEADER_SAIDA.indexOf('Longitude');
  const { rows } = juntarPendentesSondagem(
    [linhaLink2({ Latitude: '-25.6', Longitude: '-49.3' })],
    [linhaLink3()],
  );
  assert.strictEqual(rows[0][colLat], '-25.6');
  assert.strictEqual(rows[0][colLon], '-49.3');
});

test('sem Latitude/Longitude no Link 2 -- colunas ficam vazias, nunca lança', () => {
  const { HEADER_SAIDA } = require('../tools/semanal/mapear-producao-total.js');
  const colLat = HEADER_SAIDA.indexOf('Latitude');
  const { rows } = juntarPendentesSondagem([linhaLink2()], [linhaLink3()]);
  assert.strictEqual(rows[0][colLat], '');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-mapear-producao-total.test.js test/semanal-mapear-demandas-sondagem.test.js`
Expected: FAIL — `HEADER_SAIDA` ainda não tem `Latitude`/`Longitude`.

- [ ] **Step 3: Implementar**

Em `tools/semanal/mapear-producao-total.js`, mudar:

```js
const HEADER_SAIDA = [
  'Contrato', 'Criação da OS', 'Tipo', 'Status', 'Executado Dia',
  'Deslocamento', 'Total (m)', 'Observações de Campo', 'OS', 'Sondador',
];
```

para:

```js
const HEADER_SAIDA = [
  'Contrato', 'Criação da OS', 'Tipo', 'Status', 'Executado Dia',
  'Deslocamento', 'Total (m)', 'Observações de Campo', 'OS', 'Sondador',
  // Colunas OPCIONAIS (2026-08-26, aba Mapa da Alocação Equipes): a fonte
  // (Link 1/Link 2, raspados por atualizar-*-online.js) pode ou não trazer
  // coordenada -- ver tools/semanal/coordenadas-sup.js pro porquê dos
  // nomes. Célula vazia é o caso normal até a fonte publicar isso; nunca
  // trate ausência como erro.
  'Latitude', 'Longitude',
];
```

E, dentro de `mapearProducaoTotal`, no `rows.push([...])`, acrescentar duas linhas no fim do array:

```js
    rows.push([
      texto(linha['ID Contrato']),
      texto(linha['Criação da OS']),
      tipo,
      texto(linha['Status Atual']),
      texto(linha['Executado Dia']),
      texto(linha['Deslocamento']),
      texto(linha['Total (m)']),
      texto(linha['Observações de campo']),
      texto(linha['OS']),
      texto(linha['Sondador']),
      texto(linha['Latitude']),
      texto(linha['Longitude']),
    ]);
```

Em `tools/semanal/mapear-demandas-sondagem.js`, no `rows.push([...])` de `juntarPendentesSondagem`, acrescentar da mesma forma:

```js
    rows.push([
      info.contrato,
      info.osDesde,
      tipo,
      'PENDENTE',
      '',
      '',
      '',
      '',
      os,
      '',
      texto(l2['Latitude']),
      texto(l2['Longitude']),
    ]);
```

(`l2` é a variável do laço que já itera `linhasLink2` nessa função — confirmar o nome exato lendo o laço `for (const l2 of linhasLink2...)` já existente antes desse `rows.push`, que hoje usa `os = texto(l2['Ordem de Serviço (OS)'])`.)

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/semanal-mapear-producao-total.test.js test/semanal-mapear-demandas-sondagem.test.js`
Expected: PASS

- [ ] **Step 5: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS — nenhum outro teste lê `HEADER_SAIDA` por posição fixa além do índice já coberto por `locateColunasAvancos` (por nome), então nada mais deveria quebrar.

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/mapear-producao-total.js tools/semanal/mapear-demandas-sondagem.js test/semanal-mapear-producao-total.test.js test/semanal-mapear-demandas-sondagem.test.js
git commit -m "feat: Latitude/Longitude opcionais em HEADER_SAIDA e nos dois mapeadores de demanda"
```

---

## Task 5: Ligar `coordenadas-sup.js` em `build-dashboard.js`

O grid combinado (`gridAvancos`, avanços realizados + pendentes) já é montado em `build-dashboard.js` antes de `parseAvancos`. Esta tarefa lê a coordenada dele e anexa em `demandas.coordenadasPorSup`, ANTES do `unshift(null)` que `parseAvancos` exige (esse `null` deslocaria os índices de linha, não os de coluna — mas o resolvedor não usa índice de linha nenhum, só itera `rows`, então rodar antes ou depois do unshift não muda o resultado; roda ANTES por clareza, no mesmo bloco que já lê o grid).

**Files:**
- Modify: `tools/semanal/build-dashboard.js` (perto de `const demandas = computeDemandas(furos, periodos, ensaios);`, por volta da linha 369, e do require no topo do arquivo)
- Test: `test/semanal-build-dashboard.test.js` (verificar se existe; se não existir, adicionar a asserção ao teste mais próximo que já exercita `build()`/a montagem de `demandas` — buscar com `grep -rl "computeDemandas\|const demandas" test/*.test.js` antes de escrever o teste, para não duplicar um teste de integração já existente)

**Interfaces:**
- Consumes: `resolverCoordenadasPorSup(header, rows)` (Task 2).
- Produces: `demandas.coordenadasPorSup` — `{ [sup]: { lat, lon } }`, sempre presente (objeto vazio quando nada resolve), disponível para qualquer consumidor de `window.__DEMANDAS__`.

- [ ] **Step 1: Criar o teste de integração**

`test/semanal-build-dashboard.test.js` e `test/semanal-build-dashboard-fontes-novas.test.js` (os dois arquivos de teste existentes de `build-dashboard.js`) testam outras partes dele (blob/renderSemanal e `montarEquipesRealizado`, respectivamente) — nenhum dos dois cobre o merge do grid de avanços+pendentes, então esta tarefa cria um arquivo novo em vez de sobrecarregar um dos dois. `build-dashboard.js` inteiro depende de arquivos em `G:\...` (não reproduzível em CI) — a prova de integração real é `resolverCoordenadasPorSup` chamada sobre um grid sintético no MESMO formato que `build-dashboard.js` monta (header de `HEADER_SAIDA`, uma linha com Latitude/Longitude preenchidas); a LIGAÇÃO em si (Step 3) é curta o bastante pra revisar por leitura de código.

Criar `test/semanal-coordenadas-sup-integracao.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { resolverCoordenadasPorSup } = require('../tools/semanal/coordenadas-sup.js');
const { HEADER_SAIDA } = require('../tools/semanal/mapear-producao-total.js');

test('o grid combinado (avanços + pendentes) que build-dashboard.js monta resolve coordenada por SUP', () => {
  // Mesmo formato que build-dashboard.js produz: gridAvancos[0] = header
  // (HEADER_SAIDA), gridAvancos[1..] = linhas de avancos-online.csv seguidas
  // das linhas de demandas-sondagem-online.csv.
  var colLat = HEADER_SAIDA.indexOf('Latitude');
  var colLon = HEADER_SAIDA.indexOf('Longitude');
  var linha = new Array(HEADER_SAIDA.length).fill('');
  linha[HEADER_SAIDA.indexOf('Contrato')] = 'SUP-A';
  linha[colLat] = '-25.5';
  linha[colLon] = '-49.2';
  var resultado = resolverCoordenadasPorSup(HEADER_SAIDA, [linha]);
  assert.deepStrictEqual(resultado, { 'SUP-A': { lat: -25.5, lon: -49.2 } });
});
```

- [ ] **Step 2: Rodar e confirmar que passa (já deveria, dado Task 2/4)**

Run: `node --test test/semanal-coordenadas-sup-integracao.test.js`
Expected: PASS — se falhar, alguma das Tasks 2/4 tem um problema a corrigir antes de prosseguir.

- [ ] **Step 3: Ligar em `build-dashboard.js`**

No topo do arquivo, ao lado dos outros requires de `./`:

```js
const { resolverCoordenadasPorSup } = require('./coordenadas-sup.js');
```

Logo depois do bloco que monta `gridAvancos` (mescla avanços + pendentes) e ANTES de `gridAvancos.unshift(null);`:

```js
  // Coordenadas por SUP (aba Mapa da Alocação Equipes, 2026-08-26) -- lê o
  // MESMO grid combinado (avanços + pendentes) antes do unshift(null) que
  // parseAvancos exige. Objeto vazio até a fonte publicar Latitude/
  // Longitude (ver coordenadas-sup.js) -- nunca lança, nunca bloqueia o
  // build.
  const coordenadasPorSup = resolverCoordenadasPorSup(gridAvancos[0], gridAvancos.slice(1));
  gridAvancos.unshift(null);
```

E logo depois de `const demandas = computeDemandas(furos, periodos, ensaios);`:

```js
  demandas.coordenadasPorSup = coordenadasPorSup;
```

- [ ] **Step 4: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/build-dashboard.js test/semanal-coordenadas-sup-integracao.test.js
git commit -m "feat: build-dashboard.js calcula demandas.coordenadasPorSup a partir do grid de avancos+pendentes"
```

---

## Task 6: Ligar `coordenadas-sup.js` em `live-refresh.js`

Mesma lógica da Task 5, do lado do navegador — "Atualizar dados" (o botão) não pode apagar `coordenadasPorSup` que o build calculou nem deixar de recalculá-lo com o dado fresco.

**Files:**
- Modify: `tools/semanal/live-refresh.js`
- Modify: `tools/semanal/render-alocacao-pagina.js` (`BUNDLE_ARQUIVOS_ALOCACAO`, acrescentar `'coordenadas-sup.js'` ANTES de `'live-refresh.js'` — contrato de ordem de `browser-bundle.js`)
- Test: `test/semanal-live-refresh.test.js` (já existe — tem os testes `'com os módulos reais injetados, equipesPorDia é recomputado...'` e a família `rosterAlocacao`, que já montam `fontes`/mocks de fetch pro caminho `avancosLabConfigurados` — reaproveitar o MESMO helper de mock de fetch que eles já usam)

**Interfaces:**
- Consumes: `CoordenadasSup.resolverCoordenadasPorSup` (via `MODULOS['coordenadas-sup.js']`, dentro de `live-refresh.js`).

- [ ] **Step 1: Ler o helper de mock já estabelecido no arquivo**

Abrir `test/semanal-live-refresh.test.js` e localizar o teste `'com os módulos reais injetados, equipesPorDia é recomputado via REALIZADO...'` (por volta da linha 266) — ele já monta `fontes.avancos`/`fontes.demandasSondagem` com CSV sintético e chama `atualizarDadosAoVivo(cfg)` de ponta a ponta. É o MESMO helper de mock de fetch que o teste novo abaixo reaproveita.

- [ ] **Step 2: Escrever o teste (acrescentar ao arquivo)**

```js
test('atualizarDadosAoVivo recalcula demandas.coordenadasPorSup a partir do CSV fresco de avancos', async () => {
  // Seguir o MESMO padrão de mock de fetch/config que os testes vizinhos já
  // usam neste arquivo (buscarCsv/fontes.avancos) -- seed do texto de
  // avancos-online.csv com uma linha contendo Latitude/Longitude no formato
  // de HEADER_SAIDA (12 colunas, Task 4).
  // ... (adaptar o mock de fetch já usado nos testes vizinhos deste arquivo)
  // Asserção final:
  // assert.deepStrictEqual(resultado.demandas.coordenadasPorSup, { 'SUP-X': { lat: ..., lon: ... } });
});
```

(O corpo exato do mock depende do helper de fetch já estabelecido nos testes vizinhos deste arquivo — replicar a mesma estrutura deles, trocando só o CSV de avanços para incluir as colunas novas e a asserção final.)

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `node --test <arquivo encontrado no Step 1>`
Expected: FAIL — `coordenadasPorSup` ainda não é calculado em `live-refresh.js`.

- [ ] **Step 4: Implementar em `live-refresh.js`**

No topo do arquivo, ao lado dos outros requires:

```js
const { resolverCoordenadasPorSup } = require('./coordenadas-sup.js');
```

Dentro do bloco `if (avancosLabConfigurados) { ... }`, logo depois de montar `gridAvancosCliente` (com os pendentes já anexados) e ANTES de `gridAvancosCliente.unshift(null);`:

```js
        var coordenadasPorSup = resolverCoordenadasPorSup(gridAvancosCliente[0], gridAvancosCliente.slice(1));
        gridAvancosCliente.unshift(null);
```

E logo depois de `demandasNovas = computeDemandas(furos, periodosDoAno(cfg.ano), ensaios);`:

```js
        demandasNovas.coordenadasPorSup = coordenadasPorSup;
```

Em `tools/semanal/render-alocacao-pagina.js`, em `BUNDLE_ARQUIVOS_ALOCACAO`, acrescentar `'coordenadas-sup.js'` na lista, ANTES de `'render-aba-alocacao.js'` (não depende de nada, pode entrar cedo — por exemplo logo depois de `'equipes-alocaveis.js'`) e confirmar que `'live-refresh.js'` continua por ÚLTIMO (já está).

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `node --test <arquivo do Step 1>`
Expected: PASS

- [ ] **Step 6: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add tools/semanal/live-refresh.js tools/semanal/render-alocacao-pagina.js test/<arquivo-do-step-1>
git commit -m "feat: live-refresh.js recalcula demandas.coordenadasPorSup no botao Atualizar dados"
```

---

## Task 7: Carregar os assets Suporte Infra (fonte + textura) no build

Os arquivos já estão no repo (`assets/mapa-alocacao/`). Esta tarefa os embute como `data:` URI no HTML gerado, mesmo mecanismo que `LOGO_PATH`/`ICON_PATH` já usam.

**Files:**
- Modify: `tools/semanal/build-dashboard.js` (as duas chamadas a `renderAlocacaoPagina({...})`, por volta das linhas 517 e 528)
- Modify: `tools/semanal/render-alocacao-pagina.js` (assinatura de `renderAlocacaoPagina`)
- Test: `test/semanal-render-alocacao-pagina.test.js` (acrescentar teste dos parâmetros novos)

**Interfaces:**
- `renderAlocacaoPagina({ ..., nimbusRegularDataUri, nimbusBlackDataUri, texturaMapaDataUri })` — os três são STRINGS `data:` URI ou `undefined`/`''` (quando o arquivo não existir em disco — não pode quebrar o build; degrada para fonte de sistema e sem textura).

- [ ] **Step 1: Escrever o teste**

```js
// Acrescentar a test/semanal-render-alocacao-pagina.test.js:
test('sem os data URIs de fonte/textura, o build não quebra -- degrada pra sem @font-face/sem textura', () => {
  const registros = [registroSintetico('SUP-0003-24', 'Tomador-Sintetico-Gama')];
  const html = renderAlocacaoPagina({
    registros, demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z'),
    // nimbusRegularDataUri/nimbusBlackDataUri/texturaMapaDataUri OMITIDOS de propósito
  });
  assert.ok(html); // não lança
});

test('com os data URIs presentes, o @font-face Nimbus Sans Extd entra no <style>', () => {
  const registros = [registroSintetico('SUP-0004-24', 'Tomador-Sintetico-Delta')];
  const html = renderAlocacaoPagina({
    registros, demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z'),
    nimbusRegularDataUri: 'data:font/otf;base64,AAAA',
    nimbusBlackDataUri: 'data:font/otf;base64,BBBB',
    texturaMapaDataUri: 'data:image/png;base64,CCCC',
  });
  assert.match(html, /Nimbus Sans Extd/);
  assert.match(html, /data:font\/otf;base64,AAAA/);
  assert.match(html, /data:image\/png;base64,CCCC/);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-render-alocacao-pagina.test.js`
Expected: FAIL — os parâmetros ainda não existem.

- [ ] **Step 3: Implementar em `render-alocacao-pagina.js`**

Mudar a assinatura de `renderAlocacaoPagina`:

```js
function renderAlocacaoPagina({
  registros, demandas, periodos, senha, geradoEm, logoDataUri, iconDataUri,
  avisoAtualizacao, ultimaAtualizacaoOkIso,
  nimbusRegularDataUri, nimbusBlackDataUri, texturaMapaDataUri,
}) {
```

E, dentro do bloco `<style>` (antes de `${CSS_DEMANDAS}`), acrescentar a definição condicional de `@font-face` — essa parte entra AQUI, mas o corpo completo do CSS da aba Mapa (que USA essas fontes) só chega na Task 10; por ora só as declarações `@font-face`, sempre seguras de existir mesmo antes do resto do CSS da aba Mapa:

```js
const cssFontesMapa = (nimbusRegularDataUri || nimbusBlackDataUri) ? `
  ${nimbusRegularDataUri ? `@font-face { font-family: "Nimbus Sans Extd"; src: url("${nimbusRegularDataUri}") format("opentype"); font-weight: 400; }` : ''}
  ${nimbusBlackDataUri ? `@font-face { font-family: "Nimbus Sans Extd"; src: url("${nimbusBlackDataUri}") format("opentype"); font-weight: 900; }` : ''}
` : '';
```

(declarar essa `const` no corpo da função, antes do `return` do template do HTML) e incluir `${cssFontesMapa}` dentro do `<style>...</style>` do template (logo antes de `${CSS_DEMANDAS}`). `texturaMapaDataUri` fica guardado como variável disponível para a Task 10 usar dentro do CSS da aba Mapa (`background-image: url("${texturaMapaDataUri}")`) — se a Task 10 for implementada na mesma sessão, threads essa variável direto; senão, deixe-a exportada/acessível no escopo da função para a Task 10 consumir.

- [ ] **Step 4: Implementar em `build-dashboard.js`**

No topo, ao lado de `LOGO_PATH`/`ICON_PATH`:

```js
const NIMBUS_REGULAR_PATH = path.join(__dirname, '..', '..', 'assets', 'mapa-alocacao', 'nimbus-sans-extd.otf');
const NIMBUS_BLACK_PATH = path.join(__dirname, '..', '..', 'assets', 'mapa-alocacao', 'nimbus-sans-extd-black.otf');
const TEXTURA_MAPA_PATH = path.join(__dirname, '..', '..', 'assets', 'mapa-alocacao', 'textura-fundo.png');
```

Nas duas chamadas a `renderAlocacaoPagina({...})` (linhas ~517 e ~528), acrescentar:

```js
    nimbusRegularDataUri: loadDataUri(NIMBUS_REGULAR_PATH),
    nimbusBlackDataUri: loadDataUri(NIMBUS_BLACK_PATH),
    texturaMapaDataUri: loadDataUri(TEXTURA_MAPA_PATH),
```

(`loadDataUri` já existe e já devolve `undefined`/vazio quando o arquivo não existe, sem lançar — mesmo padrão do logo/ícone.)

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `node --test test/semanal-render-alocacao-pagina.test.js`
Expected: PASS

- [ ] **Step 6: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add tools/semanal/build-dashboard.js tools/semanal/render-alocacao-pagina.js test/semanal-render-alocacao-pagina.test.js
git commit -m "feat: embute fonte Nimbus Sans Extd e textura da marca Suporte Infra no build da Alocação"
```

---

## Task 8: `render-aba-alocacao-mapa.js` — shell de markup da aba Mapa

Markup ESTÁTICO da aba Mapa: reaproveita `renderControles`/`renderFaixaAlocacao`/`renderPool`/`renderGuardaSemRoster`/`renderAvisoSomenteLeitura` (já exportados de `render-aba-alocacao.js`) para a barra de controles/resumo/pool — os pinos em si são desenhados por JS depois (Task 12), não fazem parte deste HTML.

**Files:**
- Create: `tools/semanal/render-aba-alocacao-mapa.js`
- Test: `test/semanal-render-aba-alocacao-mapa.test.js`

**Interfaces:**
- Consumes: `RenderAbaAlocacao.{renderControles, renderFaixaAlocacao, renderPool, renderGuardaSemRoster, renderAvisoSomenteLeitura}` (`./render-aba-alocacao.js`), `dados` = resultado de `prepararDadosAlocacao` (Task 1, pode ser `null`).
- Produces: `renderAbaAlocacaoMapa(dados, opcoes)` → string HTML. `opcoes` é o MESMO objeto `o` que `renderAbaAlocacao` já recebe (mesmas chaves: `semanas`, `semana`, `foraDoQuadro`, `alocacao`, `buscaEquipe`, `tipologiaAlocacao`, `modoPersistencia`, `pendentes`, `semRoster`).

- [ ] **Step 1: Escrever o teste**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderAbaAlocacaoMapa } = require('../tools/semanal/render-aba-alocacao-mapa.js');
const { prepararDadosAlocacao } = require('../tools/semanal/render-aba-alocacao.js');

function registroSintetico(sup, tipologia, previstoAgosto) {
  const volume = new Array(12).fill(0);
  volume[7] = previstoAgosto;
  return { sup, tomador: 'Tomador Teste', tipologia, previsto: { volume, equipesResumo: { prod: 2 } } };
}

test('semRoster: mostra a guarda, sem container de mapa', () => {
  const html = renderAbaAlocacaoMapa(null, { semRoster: true });
  assert.match(html, /alocacao-guarda-erro/);
  assert.doesNotMatch(html, /mapa-alocacao-canvas/);
});

test('com dados: tem o container do mapa, o painel "sem localização" e reaproveita o pool', () => {
  const registros = [registroSintetico('SUP-A', 'SP', 100)];
  const opcoes = {
    mesIdx: 7, semanas: [{ inicio: 100, fim: 106 }], semana: { inicio: 100, fim: 106 },
    demandas: {}, hojeEpoch: 100,
    equipes: [{ id: '4', lider: 'Amaral', colunas: ['SP'], disponivel: true, diasDisponiveis: 5, diasDaSemana: 5, companheiros: [] }],
    alocacao: {}, foraDoQuadro: [], buscaEquipe: '', tipologiaAlocacao: '',
    modoPersistencia: 'local', pendentes: 0,
  };
  const dados = prepararDadosAlocacao(registros, [0], opcoes);
  const html = renderAbaAlocacaoMapa(dados, opcoes);
  assert.match(html, /id="mapa-alocacao-canvas"/);
  assert.match(html, /id="mapa-alocacao-sem-localizacao"/);
  assert.match(html, /pool-alocacao/); // renderPool reaproveitado
  assert.match(html, /faixa-alocacao/); // renderFaixaAlocacao reaproveitado
  assert.match(html, /data-equipe="4"/); // cartão de equipe existe (mesmo cartão do Kanban)
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-render-aba-alocacao-mapa.test.js`
Expected: FAIL — o módulo não existe.

- [ ] **Step 3: Implementar**

```js
'use strict';
const {
  renderControles, renderFaixaAlocacao, renderPool,
  renderGuardaSemRoster, renderAvisoSomenteLeitura,
} = require('./render-aba-alocacao.js');

// Módulo dual (Node + navegador) -- mesmo padrão de render-aba-alocacao.js.
// Devolve o HTML ESTÁTICO da aba Mapa: barra de controles, resumo, pool de
// equipes (os TRÊS reaproveitados de render-aba-alocacao.js, sem nenhuma
// cópia) e o container onde o MapLibre desenha os pinos -- isso é JS puro,
// não faz parte deste HTML (ver render-alocacao-pagina.js, Tasks 11/12).
//
// Ver docs/superpowers/specs/2026-08-26-alocacao-equipes-mapa-design.md.
//
// dados: o resultado de prepararDadosAlocacao(registros, indices, opcoes)
// (render-aba-alocacao.js) -- null quando opcoes.semRoster.
function renderAbaAlocacaoMapa(dados, opcoes) {
  var o = opcoes || {};
  if (o.semRoster) {
    return renderControles(o, true) + renderGuardaSemRoster();
  }

  var html = renderControles(o, dados.somenteLeitura);
  html += renderFaixaAlocacao(dados.resumo.totais);
  if (dados.somenteLeitura === 'mes-diferente') html += renderAvisoSomenteLeitura();
  html += '<div class="mapa-alocacao-corpo">';
  html += '<aside class="mapa-alocacao-pool">' + renderPool(
    dados.equipes, o.foraDoQuadro, dados.porEquipeMap, dados.somenteLeitura,
    o.alocacao, o.buscaEquipe, o.tipologiaAlocacao || null
  ) + '</aside>';
  html += '<div class="mapa-alocacao-mapa-wrap">'
    + '<div id="mapa-alocacao-canvas"></div>'
    + '<div id="mapa-alocacao-sem-localizacao" class="mapa-alocacao-sem-localizacao"></div>'
    + '</div>';
  html += '</div>';
  return html;
}

module.exports = { renderAbaAlocacaoMapa };
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/semanal-render-aba-alocacao-mapa.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/render-aba-alocacao-mapa.js test/semanal-render-aba-alocacao-mapa.test.js
git commit -m "feat: render-aba-alocacao-mapa.js -- shell de markup da aba Mapa (reaproveita controles/resumo/pool)"
```

---

## Task 9: Nav de abas Kanban/Mapa e `prepararOpcoesAlocacao()` compartilhada

Esta é a tarefa que muda `render-alocacao-pagina.js` de verdade: acrescenta a nav (`markupAbas`, já existe em `tools/comum/render-shell.js`), divide `#secao-alocacao` em `#secao-kanban-alocacao` + `#secao-mapa-alocacao`, e extrai o preparo de dados que hoje vive dentro de `montarAbaAlocacao()` para uma função compartilhada — o mapa vai precisar do MESMO roster/filtro/semana que o Kanban já calcula, sem duplicar aquele bloco.

**Files:**
- Modify: `tools/semanal/render-alocacao-pagina.js`
- Modify: `test/semanal-render-alocacao-pagina.test.js` (os testes que hoje checam `#secao-alocacao` precisam apontar pro novo id)
- Modify: `test/semanal-alocacao-interacao.test.js` (a asserção `blocos.length === 8` — conferir se ainda bate; ver o comentário no Step 3)

**Interfaces:**
- Produces (client script): `prepararOpcoesAlocacao()` → `{ semanas, semana, indices, o, semRoster }` (`o` é o MESMO objeto de opções que hoje é montado inline dentro de `montarAbaAlocacao`).
- `montarAbaAlocacao()` passa a chamar `prepararOpcoesAlocacao()` no lugar do bloco que hoje monta `demandas`/`roster`/`indices`/`o` à mão, e escreve em `#secao-kanban-alocacao` (não mais `#secao-alocacao`).
- Novo `RenderAbaAlocacaoMapa` = `MODULOS['render-aba-alocacao-mapa.js']` (Task 8) e `CoordenadasSup` = `MODULOS['coordenadas-sup.js']` (Task 2), ambos ligados no topo de `SCRIPT_CLIENTE_ALOCACAO`.

- [ ] **Step 1: Atualizar os testes existentes que apontam pro id antigo**

Em `test/semanal-render-alocacao-pagina.test.js`, trocar:

```js
  assert.match(html, /<div id="secao-alocacao"><\/div>/);
```

por:

```js
  assert.match(html, /<div id="secao-kanban-alocacao"><\/div>/);
  assert.match(html, /<div id="secao-mapa-alocacao"[^>]*><\/div>/);
  assert.match(html, /class="abas-visualizacao"/);
```

- [ ] **Step 2: Escrever o teste de que o roster/filtro é compartilhado entre as duas abas**

Acrescentar a `test/semanal-alocacao-interacao.test.js` (reaproveitando `montarClienteAlocacao()` já existente nele):

```js
test('prepararOpcoesAlocacao devolve o MESMO roster que montarAbaAlocacao usa pro Kanban', async () => {
  const cliente = montarClienteAlocacao();
  await cliente.selecionarSemanaAlocacao(1);
  const prep = cliente.prepararOpcoesAlocacao();
  assert.deepStrictEqual(normalizar(prep.o.equipes), normalizar(cliente.ESTADO_ALOCACAO.equipes));
  assert.strictEqual(prep.semana.inicio, cliente.ESTADO_ALOCACAO.semanaIdx >= 0 ? prep.semana.inicio : undefined);
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `node --test test/semanal-render-alocacao-pagina.test.js test/semanal-alocacao-interacao.test.js`
Expected: FAIL — `#secao-alocacao` ainda existe com o id antigo; `prepararOpcoesAlocacao` ainda não existe.

Nota sobre `blocos.length === 8` (linha ~153 de `test/semanal-alocacao-interacao.test.js`): esta tarefa NÃO acrescenta nenhum `<script>` novo (só MUDA o conteúdo de `SCRIPT_CLIENTE_ALOCACAO`, que já é um dos 8 blocos) — a contagem deve continuar 8. Se ao rodar o teste ela vier diferente, é sinal de que algo foi colado como bloco novo em vez de concatenado dentro do existente; ver Task 11 para o motivo disso importar (MapLibre entra como `<script src="...">`, que o regex de `extrairBlocos` — `/<script>([\s\S]*?)<\/script>/g`, sem atributos — não captura, então também não deveria mexer nessa contagem).

- [ ] **Step 4: Implementar em `render-alocacao-pagina.js`**

No topo, junto aos outros imports de `render-shell.js`:

```js
const {
  cssBase, markupCabecalho, markupFiltros, markupAbas, scriptDesbloqueio, scriptFiltros,
} = require('../comum/render-shell.js');
```

(acrescentar `markupAbas` à desestruturação já existente).

Em `BUNDLE_ARQUIVOS_ALOCACAO`, acrescentar `'render-aba-alocacao-mapa.js'` logo depois de `'render-aba-alocacao.js'`:

```js
const BUNDLE_ARQUIVOS_ALOCACAO = [
  'compute-semanal.js', 'compute-tendencia-semanal.js', 'render-aba-semanal.js',
  'render-aba-alertas.js', 'render-aba-consolidado.js',
  'parse-matriz-cliente.js', 'classificar-dia-equipe.js', 'compute-equipes-ativas.js',
  'parse-avancos.js', 'parse-lab.js', 'compute-demandas.js',
  'coordenadas-sup.js',
  'grupos-veiculo.js', 'equipes-alocaveis.js', 'compute-alocacao.js', 'alocacao-sheet.js',
  'render-aba-alocacao.js', 'render-aba-alocacao-mapa.js',
  'live-refresh.js',
];
```

No topo de `SCRIPT_CLIENTE_ALOCACAO` (onde já existem `var ComputeSemanal = ...`, `var RenderAbaAlocacao = ...` etc.), acrescentar:

```js
var RenderAbaAlocacaoMapa = MODULOS['render-aba-alocacao-mapa.js'];
var CoordenadasSup = MODULOS['coordenadas-sup.js'];
var ComputeAlocacao = MODULOS['compute-alocacao.js'];
```

Substituir o CORPO de `montarAbaAlocacao()` (a função inteira, hoje com o bloco de roster/filtro/render inline) por DUAS funções — a extração do preparo e a função original agora enxuta:

```js
// Preparo COMPARTILHADO entre a aba Kanban e a aba Mapa -- as duas leem o
// MESMO roster, os MESMOS filtros e a MESMA semana; só desenham de jeitos
// diferentes. Extraído (2026-08-26) pra aba Mapa não duplicar este bloco.
function prepararOpcoesAlocacao() {
  var semanas = semanasDoMesSelecionado();
  if (ESTADO_ALOCACAO.semanaIdx < 0 || ESTADO_ALOCACAO.semanaIdx >= semanas.length) {
    ESTADO_ALOCACAO.semanaIdx = Math.max(0, ComputeSemanal.indiceSemanaAtual(semanas, hojeEpochDoNavegador()));
  }
  var semana = semanas[ESTADO_ALOCACAO.semanaIdx];

  var demandas = window.__DEMANDAS__ || {};
  var periodo = demandas.equipesRosterPeriodo;
  var semRoster = demandas.equipesCsv === null || demandas.equipesCsv === undefined;
  var somenteLeitura = (!semRoster && periodo && (periodo.mes - 1) !== mesSelecionadoIdx)
    ? 'mes-diferente' : null;
  var roster = EquipesAlocaveis.equipesDoQuadro(demandas.equipesCsv || '', {
    ano: window.__ANO__,
    mes: periodo ? periodo.mes : (mesSelecionadoIdx + 1),
    semana: semana,
    osParaSup: demandas.osParaSup || {},
  });
  ESTADO_ALOCACAO.equipes = roster.equipes;
  ESTADO_ALOCACAO.foraDoQuadro = roster.foraDoQuadro;

  var indices = indicesFiltrados(
    window.__REGISTROS__,
    filtrosSelecionadosSemanal.tipologia, filtrosSelecionadosSemanal.categoria,
    filtrosSelecionadosSemanal.grupo, filtrosSelecionadosSemanal.sup, filtrosSelecionadosSemanal.origem
  );

  var cliente = clienteAlocacao();
  var o = {
    mesIdx: mesSelecionadoIdx, ano: window.__ANO__,
    semanas: semanas, semana: semana,
    demandas: demandas,
    semRoster: semRoster, somenteLeitura: somenteLeitura,
    equipes: ESTADO_ALOCACAO.equipes, foraDoQuadro: ESTADO_ALOCACAO.foraDoQuadro,
    alocacao: ESTADO_ALOCACAO.alocacao,
    buscaEquipe: ESTADO_ALOCACAO.busca,
    tipologiaAlocacao: ESTADO_ALOCACAO.tipologia,
    hojeEpoch: hojeEpochDoNavegador(),
    modoPersistencia: cliente.modo(),
    pendentes: cliente.pendentes().length,
  };
  return { semanas: semanas, semana: semana, indices: indices, o: o, semRoster: semRoster };
}

function montarAbaAlocacao() {
  var prep = prepararOpcoesAlocacao();

  document.getElementById('secao-kanban-alocacao').innerHTML = RenderAbaAlocacao.renderAbaAlocacao(
    window.__REGISTROS__, prep.indices, prep.o
  );
  montarMapaAlocacao(prep);

  // Primeiro desenho de uma semana nova (boot da aba, ou troca de mês que
  // muda a semana em curso) -- busca a alocação salva e, se for o caso,
  // semeia do realizado. Ver o comentário grande original desta função (não
  // mudou de comportamento, só de lugar).
  var chaveDaSemana = prep.semana ? AlocacaoSheet.chaveSemana(window.__ANO__, prep.semana.inicio) : null;
  if (chaveDaSemana && chaveDaSemana !== ESTADO_ALOCACAO.semanaCarregada && !prep.semRoster) {
    ESTADO_ALOCACAO.semanaCarregada = chaveDaSemana;
    ESTADO_ALOCACAO.geracaoAlocacao++;
    carregarAlocacaoDaSemana(chaveDaSemana);
  }
}

// A aba Mapa: mesmo preparo (prep) que o Kanban acabou de usar -- reusa
// prepararDadosAlocacao (render-aba-alocacao.js) pra ter grade/resumo sem
// recalcular a mão. Sempre redesenha o HTML (controles/pool/resumo, barato);
// os PINOS só são desenhados se o mapa já foi inicializado (Task 11/12) --
// evita inicializar o MapLibre num container ainda invisível (display:none
// enquanto a aba Kanban está ativa).
function montarMapaAlocacao(prep) {
  var secao = document.getElementById('secao-mapa-alocacao');
  if (prep.semRoster) {
    secao.innerHTML = RenderAbaAlocacaoMapa.renderAbaAlocacaoMapa(null, { semRoster: true });
    return;
  }
  var dados = RenderAbaAlocacao.prepararDadosAlocacao(window.__REGISTROS__, prep.indices, prep.o);
  secao.innerHTML = RenderAbaAlocacaoMapa.renderAbaAlocacaoMapa(dados, prep.o);
  // desenharPinosMapa/atualizarPainelSemLocalizacao entram na Task 12 -- até
  // lá esta função só desenha o shell (controles/pool/resumo).
  if (typeof desenharPinosMapa === 'function' && MAPA_ALOCACAO.instancia) {
    desenharPinosMapa(dados, (window.__DEMANDAS__ || {}).coordenadasPorSup || {});
  }
}
```

No HTML de `renderAlocacaoPagina` (o template dentro de `return \`<!DOCTYPE html>...\``), substituir:

```html
  <div id="conteudo-protegido" style="display:none">
${markupFiltros(FILTROS_ALOCACAO, { recuo: '    ', acoes: MARKUP_ACOES_ALOCACAO })}
    <div id="secao-alocacao"></div>
  </div>
```

por:

```html
  <div id="conteudo-protegido" style="display:none">
${markupFiltros(FILTROS_ALOCACAO, { recuo: '    ', acoes: MARKUP_ACOES_ALOCACAO })}
${markupAbas([
    { id: 'aba-kanban-alocacao', rotulo: 'Kanban', ativa: true },
    { id: 'aba-mapa-alocacao', rotulo: 'Mapa', svg: '' },
  ], '    ')}
    <div id="secao-kanban-alocacao"></div>
    <div id="secao-mapa-alocacao" style="display:none"></div>
  </div>
```

E, no fim de `SCRIPT_CLIENTE_ALOCACAO` (perto de `inicializarInteracaoAlocacao();`, o wireup incondicional do fim do arquivo), acrescentar o clique da nav:

```js
// Nav Kanban/Mapa -- markupAbas() (tools/comum/render-shell.js) já desenha
// o <div class="abas-visualizacao"> com os dois <button>; aqui só liga o
// clique. Lazy-init do MapLibre no primeiro clique na aba Mapa (Task 11) --
// aqui só troca o display e redesenha; a inicialização do mapa em si mora
// em inicializarMapaAlocacao(), chamada por este mesmo handler quando ainda
// não existir instância.
document.getElementById('aba-kanban-alocacao').addEventListener('click', function () {
  document.getElementById('aba-kanban-alocacao').classList.add('aba-ativa');
  document.getElementById('aba-mapa-alocacao').classList.remove('aba-ativa');
  document.getElementById('secao-kanban-alocacao').style.display = '';
  document.getElementById('secao-mapa-alocacao').style.display = 'none';
});
document.getElementById('aba-mapa-alocacao').addEventListener('click', function () {
  document.getElementById('aba-mapa-alocacao').classList.add('aba-ativa');
  document.getElementById('aba-kanban-alocacao').classList.remove('aba-ativa');
  document.getElementById('secao-kanban-alocacao').style.display = 'none';
  document.getElementById('secao-mapa-alocacao').style.display = '';
  if (typeof inicializarMapaAlocacao === 'function') inicializarMapaAlocacao();
});
```

(`inicializarMapaAlocacao` ainda não existe — entra na Task 11. Até lá este handler só troca o display, sem erro: a checagem `typeof ... === 'function'` é defensiva só até a Task 11 rodar dentro do MESMO plano; depois dela a função sempre existe e a checagem vira redundante, mas inofensiva — pode ficar.)

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `node --test test/semanal-render-alocacao-pagina.test.js test/semanal-alocacao-interacao.test.js`
Expected: PASS

- [ ] **Step 6: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add tools/semanal/render-alocacao-pagina.js test/semanal-render-alocacao-pagina.test.js test/semanal-alocacao-interacao.test.js
git commit -m "feat: nav Kanban/Mapa na pagina Alocacao Equipes, com preparo de dados compartilhado"
```

---

## Task 10: CSS Suporte Infra escopado na aba Mapa

Paleta/tipografia do Guia de Marca só dentro de `#secao-mapa-alocacao` (a aba Kanban não muda) — dark, `--acento:#f3b53f`, `--acento-contraste:#00163b`, painéis "glass", textura de fundo, Nimbus Sans Extd nos títulos.

**Files:**
- Modify: `tools/semanal/render-alocacao-pagina.js` (novo bloco `CSS_MAPA_ALOCACAO`, incluído no `<style>`)
- Test: `test/semanal-render-alocacao-pagina.test.js`

**Interfaces:**
- Nova `const CSS_MAPA_ALOCACAO` (string), consumida dentro do template de `renderAlocacaoPagina` — recebe `texturaMapaDataUri` (Task 7) via template string, então precisa ser montada DENTRO da função (não um `const` de módulo top-level, porque depende do parâmetro).

- [ ] **Step 1: Escrever o teste**

```js
test('a aba Mapa tem CSS escopado com a paleta Suporte Infra, sem vazar pro Kanban', () => {
  const registros = [registroSintetico('SUP-0005-24', 'Tomador-Sintetico-Epsilon')];
  const html = renderAlocacaoPagina({
    registros, demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z'),
  });
  assert.match(html, /#secao-mapa-alocacao\s*\{[^}]*#00163b/i);
  assert.match(html, /#f3b53f/);
  // A paleta nova NÃO pode aparecer fora do escopo #secao-mapa-alocacao --
  // verificação simples: toda ocorrência de #00163b vem precedida, em algum
  // ponto anterior do CSS, por um seletor "#secao-mapa-alocacao".
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-render-alocacao-pagina.test.js`
Expected: FAIL

- [ ] **Step 3: Implementar**

Dentro de `renderAlocacaoPagina`, antes do `return`, montar:

```js
  const cssMapaAlocacao = `
  #secao-mapa-alocacao {
    --mapa-fundo: #0c0d10;
    --mapa-fundo-painel: rgba(0, 22, 59, 0.45);
    --mapa-borda-painel: rgba(255, 255, 255, 0.1);
    --mapa-texto: #f4f6fa;
    --mapa-texto-secundario: #a9b3c9;
    --mapa-acento: #f3b53f;
    --mapa-acento-contraste: #00163b;
    position: relative;
    border-radius: 12px;
    overflow: hidden;
    background: var(--mapa-fundo);
    color: var(--mapa-texto);
    font-family: "Poppins", -apple-system, "Segoe UI", Roboto, sans-serif;
    padding: 16px;
  }
  ${texturaMapaDataUri ? `#secao-mapa-alocacao {
    background-image: linear-gradient(rgba(12,13,16,0.55), rgba(12,13,16,0.75)), url("${texturaMapaDataUri}");
    background-size: cover; background-position: center; background-repeat: no-repeat;
  }` : ''}
  #secao-mapa-alocacao .controles-alocacao,
  #secao-mapa-alocacao .faixa-alocacao,
  #secao-mapa-alocacao .mapa-alocacao-pool {
    position: relative; z-index: 1;
    background: var(--mapa-fundo-painel);
    border: 1px solid var(--mapa-borda-painel);
    border-radius: 12px;
    backdrop-filter: blur(10px);
    padding: 14px 18px;
    margin-bottom: 12px;
  }
  #secao-mapa-alocacao h1, #secao-mapa-alocacao h2, #secao-mapa-alocacao h3,
  #secao-mapa-alocacao .pool-grupo-titulo {
    font-family: "Nimbus Sans Extd", "Poppins", sans-serif;
    font-weight: 900;
    color: var(--mapa-acento);
  }
  #secao-mapa-alocacao .mapa-alocacao-corpo {
    display: flex; gap: 16px; align-items: flex-start;
    position: relative; z-index: 1;
  }
  #secao-mapa-alocacao .mapa-alocacao-pool {
    flex: 0 0 300px; max-height: 720px; overflow-y: auto;
  }
  #secao-mapa-alocacao .mapa-alocacao-mapa-wrap {
    flex: 1 1 auto; min-width: 0;
    position: relative;
    border-radius: 12px; overflow: hidden;
    border: 1px solid var(--mapa-borda-painel);
  }
  #mapa-alocacao-canvas { width: 100%; height: 720px; }
  #secao-mapa-alocacao .mapa-alocacao-sem-localizacao {
    position: absolute; top: 12px; right: 12px; z-index: 5;
    max-width: 280px; max-height: 220px; overflow-y: auto;
    background: var(--mapa-fundo-painel);
    border: 1px solid var(--mapa-borda-painel);
    border-radius: 8px; padding: 10px 12px;
    font-size: 12px; color: var(--mapa-texto-secundario);
    backdrop-filter: blur(10px);
  }
  #secao-mapa-alocacao .mapa-alocacao-sem-localizacao:empty { display: none; }
  #secao-mapa-alocacao .maplibregl-ctrl-attrib { background: rgba(0,0,0,0.5); color: var(--mapa-texto-secundario); }
  `;
```

E incluir `${cssMapaAlocacao}` dentro do bloco `<style>` do template (logo depois de `${CSS_DEMANDAS}` e do `cssFontesMapa` já adicionado na Task 7).

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/semanal-render-alocacao-pagina.test.js`
Expected: PASS

- [ ] **Step 5: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/render-alocacao-pagina.js test/semanal-render-alocacao-pagina.test.js
git commit -m "feat: CSS Suporte Infra escopado na aba Mapa (paleta, glass panels, Nimbus Sans Extd)"
```

---

## Task 11: MapLibre — setup igual ao Mapa Sondagens + lazy-init

**Files:**
- Modify: `tools/semanal/render-alocacao-pagina.js` (`<head>`/`<body>` do template + `SCRIPT_CLIENTE_ALOCACAO`)
- Test: manual (MapLibre não roda em `node --test`, que não tem `window`/canvas real — a prova é a Task 14, que testa `resolverAlvoAlocacao` com um marcador FAKE, e uma verificação visual manual descrita no Step 4 abaixo)

**Interfaces:**
- Produces: `var MAPA_ALOCACAO = { instancia: null };` e `function inicializarMapaAlocacao()`.

- [ ] **Step 1: Acrescentar o script/CSS do MapLibre no `<head>`**

No template de `renderAlocacaoPagina`, dentro de `<head>`, logo antes de `<style>`:

```html
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css">
```

E logo ANTES da tag `<script>${bundle}</script>` já existente (MapLibre precisa existir como `window.maplibregl` antes do bundle/script de cliente rodar):

```html
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
```

- [ ] **Step 2: Implementar `inicializarMapaAlocacao()` em `SCRIPT_CLIENTE_ALOCACAO`**

Acrescentar, próximo ao topo (perto de `var ESTADO_ALOCACAO = {...}`):

```js
// Setup MapLibre -- réplica EXATA do que está em produção no projeto Mapa
// Sondagens (http://192.168.1.53:8080/, js/app.js), incluindo as 3 fontes
// Esri/ArcGIS Online (World_Imagery base + Reference/World_Transportation +
// Reference/World_Boundaries_and_Places sempre visíveis, sem toggle -- é
// assim que o Mapa Sondagens já roda), a atribuição, e o zoom só com Ctrl
// pressionado (scroll normal continua rolando a PÁGINA, não o mapa).
//
// Inicializado LAZY (só no primeiro clique na aba Mapa, não no load da
// página): o MapLibre precisa que o container já tenha tamanho real
// (largura/altura != 0) pra calcular a projeção certo -- inicializar com
// #secao-mapa-alocacao ainda em display:none produziria um mapa quebrado
// (tiles no lugar errado até um resize forçar o recálculo).
var MAPA_ALOCACAO = { instancia: null };

var URL_ESRI_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
var URL_ESRI_TRANSPORTE = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}';
var URL_ESRI_LIMITES = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

function inicializarMapaAlocacao() {
  if (MAPA_ALOCACAO.instancia) {
    // Já existe -- só garante que o tamanho está certo (a aba pode ter sido
    // aberta a 1ª vez com uma largura, e a janela redimensionada depois
    // enquanto a aba Kanban estava ativa e o mapa invisível).
    MAPA_ALOCACAO.instancia.resize();
    return;
  }
  var mapa = new maplibregl.Map({
    container: 'mapa-alocacao-canvas',
    style: {
      version: 8,
      sources: {
        'esri-imagery': { type: 'raster', tiles: [URL_ESRI_IMAGERY], tileSize: 256, maxzoom: 19, attribution: 'Tiles &copy; Esri' },
        'esri-transporte': { type: 'raster', tiles: [URL_ESRI_TRANSPORTE], tileSize: 256, maxzoom: 19 },
        'esri-limites': { type: 'raster', tiles: [URL_ESRI_LIMITES], tileSize: 256, maxzoom: 19 },
      },
      layers: [
        { id: 'esri-imagery', type: 'raster', source: 'esri-imagery' },
        { id: 'esri-transporte', type: 'raster', source: 'esri-transporte' },
        { id: 'esri-limites', type: 'raster', source: 'esri-limites' },
      ],
    },
    // Centro/zoom iniciais: mesma região do Mapa Sondagens (Paraná) --
    // ajustado sozinho na Task 12 pra enquadrar os pinos reais assim que
    // eles existirem (fitBounds).
    center: [-49.2, -25.5],
    zoom: 7,
    pitch: 0, bearing: 0, dragRotate: false, touchPitch: false,
    attributionControl: { compact: true },
  });
  mapa.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
  mapa.scrollZoom.disable();
  mapa.getContainer().addEventListener('wheel', function (evento) {
    if (!evento.ctrlKey) return;
    evento.preventDefault();
    var retangulo = mapa.getContainer().getBoundingClientRect();
    var lngLat = mapa.unproject([evento.clientX - retangulo.left, evento.clientY - retangulo.top]);
    mapa.easeTo({ zoom: mapa.getZoom() + (evento.deltaY < 0 ? 1 : -1), around: lngLat, duration: 0 });
  }, { passive: false });

  MAPA_ALOCACAO.instancia = mapa;
  MAPA_ALOCACAO.marcadores = {};

  // Assim que o estilo carrega, desenha os pinos com o dado que JÁ existe
  // em ESTADO_ALOCACAO (o mapa pode ter sido aberto bem depois do 1º
  // montarAbaAlocacao) -- ver Task 12 pra desenharPinosMapa.
  mapa.on('load', function () {
    montarAbaAlocacao();
  });
}
```

- [ ] **Step 3: Rodar a suíte inteira (não deve quebrar nada — MapLibre só roda no navegador)**

Run: `node --test test/*.test.js`
Expected: PASS — `vm.Context` dos testes de interação não define `maplibregl`, mas `inicializarMapaAlocacao` só é chamada pelo clique na aba Mapa, que nenhum teste hoje simula (a Task 14 vai simular isso com um `maplibregl` FAKE, não o real).

- [ ] **Step 4: Verificação manual (não automatizável em `node --test`)**

Depois do build (`ORCAMENTO_SENHA=... node tools/semanal/build-dashboard.js`), abrir `dist/alocacao-equipes.html` num navegador, destravar com a senha, clicar na aba "Mapa" e confirmar visualmente: o mapa aparece (satélite + vias + limites), os controles de zoom aparecem no canto superior esquerdo, o scroll da página funciona normalmente sobre o mapa (só dá zoom com Ctrl+scroll), e trocar de volta pra aba Kanban e voltar pro Mapa não quebra o mapa (mesma instância, `.resize()` chamado).

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/render-alocacao-pagina.js
git commit -m "feat: MapLibre + tiles Esri na aba Mapa (setup identico ao Mapa Sondagens), lazy-init"
```

---

## Task 12: Desenhar pinos por SUP, popup e painel "sem localização"

**Files:**
- Modify: `tools/semanal/render-alocacao-pagina.js` (`SCRIPT_CLIENTE_ALOCACAO`)
- Test: `test/semanal-alocacao-interacao.test.js` (a parte testável sem MapLibre — quais SUPs viram pino — ver Step 1); o resto (desenho real dos pinos no MapLibre) só é verificável manualmente (Step 6), mesma limitação da Task 11.

**Interfaces:**
- Produces: `function desenharPinosMapa(dados, coordenadasPorSup)` — `dados` é o resultado de `RenderAbaAlocacao.prepararDadosAlocacao(...)` (não nulo), `coordenadasPorSup` é `window.__DEMANDAS__.coordenadasPorSup`.
- Consumes: `ComputeAlocacao` (`compute-alocacao.js`, já ligado na Task 9) só para nada extra aqui — a leitura por SUP já vem pronta em `dados.resumo.porSup` (campo `leitura`, ver `compute-alocacao.js:leituraDoSup`).

- [ ] **Step 1: Escrever um teste da parte TESTÁVEL sem MapLibre — quais SUPs têm pino vs. quais vão pro painel "sem localização"**

Esta função pura (separada de `desenharPinosMapa`, que mexe no DOM/MapLibre) decide o particionamento. Acrescentar a `test/semanal-alocacao-interacao.test.js`, reaproveitando `montarClienteAlocacao()` já definida nele (o `cliente` devolvido é o `sandbox` do `vm.Context`, e `particionarSupsPorLocalizacao` pousa nele do mesmo jeito que `aplicarMovimento`/`resolverAlvoAlocacao` já pousam, porque `SCRIPT_CLIENTE_ALOCACAO` declara tudo com `var`/`function` no escopo do Realm):

```js
test('particionarSupsPorLocalizacao separa SUPs com e sem coordenada', () => {
  const cliente = montarClienteAlocacao();
  const porSup = [{ sup: 'SUP-A', leitura: 'absorvido' }, { sup: 'SUP-B', leitura: 'falta-equipe' }];
  const coordenadas = { 'SUP-A': { lat: -25.5, lon: -49.2 } };
  const resultado = cliente.particionarSupsPorLocalizacao(porSup, coordenadas);
  assert.deepStrictEqual(resultado.comLocalizacao.map((s) => s.sup), ['SUP-A']);
  assert.deepStrictEqual(resultado.semLocalizacao.map((s) => s.sup), ['SUP-B']);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-alocacao-interacao.test.js`
Expected: FAIL — `particionarSupsPorLocalizacao` não existe.

- [ ] **Step 3: Implementar em `SCRIPT_CLIENTE_ALOCACAO`**

```js
// Mesmas 5 cores de .leitura-* (CSS_SEMANAL, render-semanal.js) -- REPETIDAS
// aqui de propósito, porque o marcador do MapLibre precisa da cor SÓLIDA
// (background do pino), enquanto a classe original é um CHIP translúcido
// (fundo claro + texto colorido, pensado pra um <span> de rótulo, não pra
// um ponto no mapa). Mudar uma sem a outra é a próxima divergência
// esperando acontecer -- ver o comentário sobre TIPOLOGIA_COLOR em
// render-aba-consolidado.js pro mesmo raciocínio aplicado a outra paleta
// deste projeto.
var CORES_LEITURA_PINO = {
  'parado-com-carteira': '#f6b53f',
  'sem-equipe': '#e0684f',
  'falta-equipe': '#e0684f',
  antecipar: '#4f8ff0',
  absorvido: '#7fd858',
  'sem-demanda': '#898781',
};

// Separa as linhas de resumo.porSup em quem tem coordenada conhecida
// (vira pino) e quem não tem (vai pro painel "sem localização"). Função
// PURA -- não mexe no mapa nem no DOM, só decide.
function particionarSupsPorLocalizacao(porSup, coordenadasPorSup) {
  var coords = coordenadasPorSup || {};
  var comLocalizacao = [];
  var semLocalizacao = [];
  (porSup || []).forEach(function (s) {
    if (coords[s.sup]) comLocalizacao.push(s);
    else semLocalizacao.push(s);
  });
  return { comLocalizacao: comLocalizacao, semLocalizacao: semLocalizacao };
}

function popupHtmlDoPino(sup, coords) {
  var celulasTexto = Object.keys(sup.celulas || {}).length
    ? '' // dados.grade.linhas não tem por-coluna aqui direto -- resumo.porSup já
         // vem AGREGADO por SUP; detalhe por coluna fica só no popup do CARTÃO
         // da equipe (já existente), não duplicado aqui.
    : '';
  return '<div class="popup-pino-alocacao">'
    + '<p class="popup-titulo">' + RenderAbaAlocacao.escapeHtml(sup.sup) + '</p>'
    + '<p>' + RenderAbaAlocacao.escapeHtml(sup.tomador || '—') + '</p>'
    + '<p>Tendência: ' + sup.tendencia.toFixed(1) + ' · Capacidade alocada: ' + sup.capacidadeAlocada.toFixed(1) + '</p>'
    + '<p>Saldo: ' + sup.saldo.toFixed(1) + '</p>'
    + '<p>Carteira: ' + sup.carteira.toFixed(0) + '</p>'
    + '</div>';
}

// Redesenha os pinos a partir do zero a cada chamada -- mesma filosofia de
// montarAbaAlocacao pro Kanban (redesenha inteiro, mais simples e barato o
// bastante que otimizar incrementalmente não vale a pena aqui: no máximo
// algumas dezenas de SUPs por semana).
function desenharPinosMapa(dados, coordenadasPorSup) {
  if (!MAPA_ALOCACAO.instancia) return;
  var mapa = MAPA_ALOCACAO.instancia;

  Object.keys(MAPA_ALOCACAO.marcadores).forEach(function (sup) {
    MAPA_ALOCACAO.marcadores[sup].remove();
  });
  MAPA_ALOCACAO.marcadores = {};

  var particionado = particionarSupsPorLocalizacao(dados.resumo.porSup, coordenadasPorSup);

  particionado.comLocalizacao.forEach(function (sup) {
    var coords = coordenadasPorSup[sup.sup];
    var el = document.createElement('div');
    el.className = 'marcador-alocacao-mapa';
    el.style.background = CORES_LEITURA_PINO[sup.leitura] || CORES_LEITURA_PINO['sem-demanda'];
    el.setAttribute('data-sup', sup.sup);
    var marcador = new maplibregl.Marker({ element: el })
      .setLngLat([coords.lon, coords.lat])
      .setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(popupHtmlDoPino(sup, coords)))
      .addTo(mapa);
    MAPA_ALOCACAO.marcadores[sup.sup] = marcador;
  });

  var painelSemLocalizacao = document.getElementById('mapa-alocacao-sem-localizacao');
  if (painelSemLocalizacao) {
    if (!particionado.semLocalizacao.length) {
      painelSemLocalizacao.innerHTML = '';
    } else {
      painelSemLocalizacao.innerHTML = '<strong>' + particionado.semLocalizacao.length
        + ' SUP(s) sem localização</strong><ul>'
        + particionado.semLocalizacao.map(function (s) {
          return '<li>' + RenderAbaAlocacao.escapeHtml(s.sup) + ' — ' + RenderAbaAlocacao.escapeHtml(s.tomador || '—') + '</li>';
        }).join('') + '</ul>';
    }
  }
}
```

Acrescentar `var CSS_MARCADOR = ...` como uma pequena regra CSS extra no `CSS_MAPA_ALOCACAO` da Task 10 (voltar lá e acrescentar, se ainda não commitado; se já commitado, um pequeno complemento nesta tarefa):

```css
  .marcador-alocacao-mapa {
    width: 18px; height: 18px; border-radius: 50%;
    border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.5);
    cursor: pointer;
  }
  .popup-pino-alocacao { font-family: "Poppins", sans-serif; font-size: 13px; }
  .popup-pino-alocacao .popup-titulo { font-weight: 700; margin: 0 0 4px; }
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/semanal-alocacao-interacao.test.js`
Expected: PASS

- [ ] **Step 5: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS

- [ ] **Step 6: Verificação manual**

Com `dist/alocacao-equipes.html` já buildado (mesmo build da Task 11) — como `coordenadasPorSup` ainda deve estar vazio (Patrick não publicou a fonte), confirmar que a aba Mapa abre sem pino nenhum e SEM ERRO, e que TODOS os SUPs do resumo aparecem no painel "sem localização" com a contagem certa. Isso prova a degradação graciosa antes mesmo de existir dado real.

- [ ] **Step 7: Commit**

```bash
git add tools/semanal/render-alocacao-pagina.js test/semanal-alocacao-interacao.test.js
git commit -m "feat: desenha pinos por SUP no mapa (cor = leitura), popup e painel sem-localizacao"
```

---

## Task 13: Arrasto até o pino — estender `resolverAlvoAlocacao`

**Files:**
- Modify: `tools/semanal/render-alocacao-pagina.js` (`resolverAlvoAlocacao`, `SCRIPT_CLIENTE_ALOCACAO`)
- Test: `test/semanal-alocacao-interacao.test.js`

**Interfaces:**
- `resolverAlvoAlocacao(e)` ganha um terceiro tipo de retorno possível: `{ tipo: 'pino', el: <elemento do marcador> }`, ao lado dos já existentes `'celula'`/`'pool'`/`null`.
- O handler de `pointerup`/`click` que já chama `aplicarMovimento(equipeId, sup, coluna)` para `alvo.tipo === 'celula'` ganha um novo `else if (alvo.tipo === 'pino')`, que resolve a COLUNA via `ComputeAlocacao.escolherColunaAutomatica` antes de chamar `aplicarMovimento`.

- [ ] **Step 1: Escrever o teste**

Acrescentar a `test/semanal-alocacao-interacao.test.js`, reaproveitando `montarClienteAlocacao()`. Como o pino é um elemento DOM real do MapLibre (que o `document` FALSO deste arquivo de teste não simula), o teste chama `resolverAlvoAlocacao`/`aplicarMovimento` diretamente com um objeto que IMITA o formato de evento que `document.elementFromPoint` devolveria — mesma técnica que os testes de célula/pool já vizinhos usam (não precisa de um DOM completo, só do contrato de `.closest()`).

```js
function elementoFalsoPino(sup) {
  const el = { getAttribute: (attr) => (attr === 'data-sup' ? sup : null) };
  el.closest = (sel) => (sel === '.marcador-alocacao-mapa' ? el : null);
  return el;
}

test('resolverAlvoAlocacao reconhece um marcador do mapa (.marcador-alocacao-mapa) como alvo tipo pino', async () => {
  const cliente = montarClienteAlocacao();
  const elFalso = elementoFalsoPino('SUP-A');
  // document.elementFromPoint é chamado por resolverAlvoAlocacao -- o
  // documento falso deste arquivo não implementa elementFromPoint, então
  // caímos no fallback e.target (ver o comentário de resolverAlvoAlocacao).
  const alvo = cliente.resolverAlvoAlocacao({ target: elFalso });
  assert.deepStrictEqual({ tipo: alvo.tipo, sup: alvo.el.getAttribute('data-sup') }, { tipo: 'pino', sup: 'SUP-A' });
});

test('soltar equipe polivalente no pino escolhe a coluna com maior déficit', async () => {
  const cliente = montarClienteAlocacao();
  await cliente.selecionarSemanaAlocacao(1);
  // Equipe 4 é SP nesta suíte -- reaproveitar como está prova só o caminho
  // de coluna única (delega pra escolherColunaAutomatica, testada de sobra
  // em test/semanal-compute-alocacao.test.js, Task 3). O caminho ONDE a
  // coluna é escolhida (o handler de solta-no-pino) é o que este teste
  // prova: chamar aplicarMovimentoNoPino('4', 'SUP-A') e checar que a
  // coluna 'SP' (a única de equipe 4) foi resolvida sozinha.
  const ok = cliente.aplicarMovimentoNoPino('4', 'SUP-A');
  assert.strictEqual(ok, true);
  assert.strictEqual(cliente.ESTADO_ALOCACAO.alocacao['4'].sup, 'SUP-A');
  assert.strictEqual(cliente.ESTADO_ALOCACAO.alocacao['4'].coluna, 'SP');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-alocacao-interacao.test.js`
Expected: FAIL — `resolverAlvoAlocacao` ainda não reconhece `.marcador-alocacao-mapa`; `aplicarMovimentoNoPino` não existe.

- [ ] **Step 3: Implementar**

Em `resolverAlvoAlocacao` (dentro de `SCRIPT_CLIENTE_ALOCACAO`), mudar:

```js
function resolverAlvoAlocacao(e) {
  var sob = null;
  if (typeof document.elementFromPoint === 'function' && typeof e.clientX === 'number') {
    sob = document.elementFromPoint(e.clientX, e.clientY);
  }
  if (!sob) sob = e.target;
  if (!sob || !sob.closest) return null;
  var celula = sob.closest('.celula-alocacao');
  if (celula) return { tipo: 'celula', el: celula };
  if (sob.closest('.pool-alocacao')) return { tipo: 'pool', el: null };
  var pino = sob.closest('.marcador-alocacao-mapa');
  if (pino) return { tipo: 'pino', el: pino };
  return null;
}
```

Acrescentar uma função nova, que resolve a coluna e delega pra `aplicarMovimento` (o MESMO `aplicarMovimento` de sempre — nenhuma regra nova de negócio, só a escolha de QUAL coluna passar pra ele):

```js
// Resolve a coluna automaticamente (escolherColunaAutomatica,
// compute-alocacao.js -- Task 3) e delega pra aplicarMovimento, o MESMO
// caminho que a célula da tabela já usa. equipeId: a equipe sendo solta.
// sup: o SUP do pino onde ela foi solta.
function aplicarMovimentoNoPino(equipeId, sup) {
  var equipe = equipeAlocavelPeloId(equipeId);
  if (!equipe) return false;
  var linha = null;
  for (var i = 0; i < ESTADO_ALOCACAO.ultimaGrade.linhas.length; i++) {
    if (ESTADO_ALOCACAO.ultimaGrade.linhas[i].sup === sup) { linha = ESTADO_ALOCACAO.ultimaGrade.linhas[i]; break; }
  }
  var celulasDaLinha = linha ? linha.celulas : {};
  var coluna = ComputeAlocacao.escolherColunaAutomatica(equipe.colunas || [], celulasDaLinha);
  if (!coluna) return false;
  return aplicarMovimento(equipeId, sup, coluna);
}
```

`ESTADO_ALOCACAO.ultimaGrade` ainda não existe — acrescentar ao objeto `ESTADO_ALOCACAO` (declaração no topo do script):

```js
var ESTADO_ALOCACAO = {
  semanaIdx: -1, alocacao: {}, equipes: [], foraDoQuadro: [], cliente: null,
  semanaCarregada: null, geracaoAlocacao: 0, busca: '', tipologia: '',
  ultimaGrade: { linhas: [], colunas: [] },
};
```

E, em `montarMapaAlocacao(prep)` (Task 9), guardar a grade calculada antes de desenhar os pinos:

```js
  var dados = RenderAbaAlocacao.prepararDadosAlocacao(window.__REGISTROS__, prep.indices, prep.o);
  ESTADO_ALOCACAO.ultimaGrade = dados.grade;
  secao.innerHTML = RenderAbaAlocacaoMapa.renderAbaAlocacaoMapa(dados, prep.o);
```

(substitui a linha equivalente já escrita na Task 9 — mesma linha, só acrescenta a atribuição a `ultimaGrade` logo antes).

Por fim, nos DOIS handlers que já chamam `aplicarMovimento` para `alvo.tipo === 'celula'`/`'pool'` (dentro de `pointerup` e dentro de `click`, dois lugares — ver o código já existente de `inicializarInteracaoAlocacao`), acrescentar o ramo `'pino'`:

```js
    var alvo = resolverAlvoAlocacao(e);
    if (alvo && alvo.tipo === 'celula') {
      aplicarMovimento(equipeId, alvo.el.getAttribute('data-sup'), alvo.el.getAttribute('data-coluna'));
    } else if (alvo && alvo.tipo === 'pino') {
      aplicarMovimentoNoPino(equipeId, alvo.el.getAttribute('data-sup'));
    } else if (alvo && alvo.tipo === 'pool') {
      aplicarMovimento(equipeId, '', '');
    }
```

(aplicar a mesma mudança nos DOIS lugares — o de `pointerup`, usando `equipeId`, e o de `click`/seleção por 2 cliques, usando `equipeIdSelecionado`/`equipeIdClicado` conforme o nome da variável local naquele bloco).

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/semanal-alocacao-interacao.test.js`
Expected: PASS

- [ ] **Step 5: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/render-alocacao-pagina.js test/semanal-alocacao-interacao.test.js
git commit -m "feat: arrastar equipe ate o pino do mapa aloca no SUP (coluna resolvida automaticamente)"
```

---

## Task 14: Estender `dom-falso-semanal.js` e cobrir o gesto completo (arrasto real até o pino)

A Task 13 provou a RESOLUÇÃO de alvo e a APLICAÇÃO isoladas. Esta tarefa fecha o ciclo: um gesto de `pointerdown` no cartão do pool → `pointermove` → `pointerup` sobre o pino, exatamente como o usuário faria, usando o helper de DOM falso (que precisa aprender a registrar marcadores, do mesmo jeito que já registra células).

**Files:**
- Modify: `test/helpers/dom-falso-semanal.js`
- Test: `test/semanal-alocacao-interacao.test.js`

**Interfaces:**
- `criarDocumentoFalso()` ganha `registrarMarcadoresAlocacao(sups)` (mesmo padrão de `registrarCelulasAlocacao`) e `querySelectorAll('.marcador-alocacao-mapa')` passa a devolver os marcadores registrados.

- [ ] **Step 1: Escrever o teste do gesto completo**

```js
test('arrastar o cartão do pool ate o pino do mapa aloca a equipe (gesto completo)', async () => {
  const cliente = montarClienteAlocacao();
  marcarSemanasVistas(cliente, 1);
  await cliente.selecionarSemanaAlocacao(1);

  const documentoFalso = cliente.document; // o mesmo `document` do sandbox
  const [pino] = documentoFalso.registrarMarcadoresAlocacao(['SUP-A']);
  const cartao4 = documentoFalso.registrarCartoesAlocacao(['4'])[0];
  cartao4.closest = (sel) => (sel === '[data-equipe][data-arrastavel="sim"]' ? cartao4 : null);
  cartao4.getAttribute = (attr) => (attr === 'data-equipe' ? '4' : null);

  const secao = documentoFalso.getElementById('secao-mapa-alocacao');
  secao.listeners.pointerdown({ target: cartao4, pointerId: 1, clientX: 0, clientY: 0 });
  secao.listeners.pointermove({ pointerId: 1, clientX: 10, clientY: 10 });
  secao.listeners.pointerup({ pointerId: 1, clientX: 10, clientY: 10, target: pino });

  assert.strictEqual(cliente.ESTADO_ALOCACAO.alocacao['4'].sup, 'SUP-A');
  assert.strictEqual(cliente.ESTADO_ALOCACAO.alocacao['4'].coluna, 'SP');
});
```

Nota: `secao.listeners.pointerdown(...)` funciona porque o `document` falso memoiza `getElementById` e `inicializarInteracaoAlocacao()` já roda incondicionalmente no load do script (ver o wireup no fim de `SCRIPT_CLIENTE_ALOCACAO`) — os `addEventListener` acontecem sobre `document.getElementById('secao-alocacao')` HOJE; como a Task 9 renomeou pra `secao-kanban-alocacao`, e o arrasto do MAPA precisa de um listener PRÓPRIO em `#secao-mapa-alocacao` (o pino não é filho de `#secao-kanban-alocacao`) — ver Step 3 abaixo, que resolve exatamente isso.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-alocacao-interacao.test.js`
Expected: FAIL — `registrarMarcadoresAlocacao` não existe; `inicializarInteracaoAlocacao` ainda só escuta `#secao-kanban-alocacao`.

- [ ] **Step 3: Estender `dom-falso-semanal.js`**

Ao lado de `registrarCelulasAlocacao`/`registrarCartoesAlocacao` (dentro do `return { ... }` de `criarDocumentoFalso`), acrescentar:

```js
    // Os pinos do mapa (2026-08-26) -- mesmo padrão de registrarCelulasAlocacao:
    // sem isto, querySelectorAll('.marcador-alocacao-mapa') devolveria [] e
    // resolverAlvoAlocacao nunca acharia um alvo tipo 'pino' num teste.
    registrarMarcadoresAlocacao(sups) {
      const marcadores = [];
      (sups || []).forEach((sup) => {
        const el = comClassList({
          getAttribute: (attr) => (attr === 'data-sup' ? sup : null),
        });
        el.closest = (sel) => (sel === '.marcador-alocacao-mapa' ? el : null);
        marcadores.push(el);
      });
      elementos['__marcadoresAlocacao'] = marcadores;
      return marcadores;
    },
```

E em `querySelectorAll(sel)` (o método já existente no objeto devolvido por `criarDocumentoFalso`), acrescentar um ramo:

```js
      if (sel === '.marcador-alocacao-mapa') return elementos['__marcadoresAlocacao'] || [];
```

- [ ] **Step 4: Ligar `#secao-mapa-alocacao` no wireup de interação**

Em `render-alocacao-pagina.js`, `inicializarInteracaoAlocacao()` hoje escuta só `document.getElementById('secao-alocacao')` — a Task 9 já renomeou essa chamada pra `'secao-kanban-alocacao'` (conferir; se ainda não, corrigir agora). Como os PINOS vivem em `#secao-mapa-alocacao` (fora da árvore de `#secao-kanban-alocacao`), a função precisa escutar as DUAS seções. Mudar a assinatura pra aceitar múltiplas seções, ou (mais simples, sem mexer no corpo inteiro da função) chamar o MESMO corpo de wireup duas vezes, uma por seção:

```js
// inicializarInteracaoAlocacao(idSecao) -- generaliza pra aceitar tanto
// #secao-kanban-alocacao (células/pool) quanto #secao-mapa-alocacao (pinos/
// pool do mapa). Chamada duas vezes no wireup incondicional do fim do
// script (Task 9 já tinha a chamada única; esta tarefa a torna dupla).
function inicializarInteracaoAlocacao(idSecao) {
  var secao = document.getElementById(idSecao);
  // ... TODO o corpo já existente da função, sem NENHUMA outra mudança,
  // só trocando a variável local 'secao' pra usar o parâmetro em vez do id
  // fixo 'secao-alocacao'.
}
```

E, no wireup incondicional do fim de `SCRIPT_CLIENTE_ALOCACAO` (onde hoje está `inicializarInteracaoAlocacao();`):

```js
inicializarInteracaoAlocacao('secao-kanban-alocacao');
inicializarInteracaoAlocacao('secao-mapa-alocacao');
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `node --test test/semanal-alocacao-interacao.test.js`
Expected: PASS

- [ ] **Step 6: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add test/helpers/dom-falso-semanal.js tools/semanal/render-alocacao-pagina.js test/semanal-alocacao-interacao.test.js
git commit -m "test: gesto completo de arrasto ate o pino do mapa (dom-falso-semanal ganha marcadores)"
```

---

## Task 15: Build final, suíte completa, revisão de design e publicação

**Esta é a ÚNICA tarefa deste plano que publica algo.** Nenhuma tarefa anterior reconstrói `dist/`/`docs/` nem faz push — a regra permanente do CLAUDE.md ("sempre publicar depois de reconstruir") vale pra sessão que VERIFICA o trabalho, não para subagentes no meio do pipeline. Esta tarefa É a verificação final.

**Files:**
- Modify: `dist/alocacao-equipes.html`, `docs/alocacao-equipes.html` (gerados pelo build — não editar à mão)
- Modify: `dist/planejamento-semanal.html`, `docs/index.html` (o MESMO build escreve os dois pares de arquivo, mesmo quando só a Alocação mudou — ver `render-semanal.js`)

- [ ] **Step 1: Build local**

```bash
ORCAMENTO_SENHA='<pedir ao dono do projeto>' node tools/semanal/build-dashboard.js
```

Expected: termina sem erro, escreve `dist/alocacao-equipes.html`, `dist/planejamento-semanal.html` (e os `docs/` correspondentes, se o script já fizer a cópia — conferir `SETUP-ATUALIZACAO-DIARIA.md`/`CLAUDE.md` do repo pra confirmar se `cp dist/*.html docs/` é manual ou parte do script).

- [ ] **Step 2: Suíte completa**

```bash
node --test test/*.test.js
```

Expected: 100% verde. Qualquer falha aqui BLOQUEIA a publicação — corrigir antes de prosseguir, nunca pular com `--test-skip` ou similar.

- [ ] **Step 3: Verificação manual em navegador (golden path + estados vazios)**

Abrir `dist/alocacao-equipes.html`, destravar, e conferir:
1. A aba Kanban continua EXATAMENTE como antes (nenhuma mudança visual/comportamental).
2. A aba Mapa abre, mostra satélite+vias+limites, controles de zoom, e (dado que `coordenadasPorSup` ainda deve estar vazio até Patrick publicar a fonte) TODOS os SUPs aparecem no painel "sem localização", sem pino nenhum e sem erro no console.
3. Arrastar um cartão do pool da aba Mapa até QUALQUER lugar do mapa (sem pino, já que não há coordenada real ainda) não faz nada — mesmo comportamento de soltar no vazio da tabela.
4. Trocar de aba (Kanban → Mapa → Kanban) várias vezes não quebra nem duplica nada.

- [ ] **Step 4: Revisão de Open Design (se disponível)**

Seguir a seção "HTML passa pela revisão de design do Open Design" do `CLAUDE.md` do repositório: projeto DEDICADO (nunca `3b8ae52a-...`/"Projetos IA"), `skill: "design-review"`, snapshot estático com dados sintéticos cobrindo os 5 estados de leitura (as 5 cores de pino) + o estado "sem localização". Se o MCP do Open Design não estiver disponível nesta sessão (estava desconectado no início desta sessão de planejamento — conferir se voltou), seguir sem ele, registrando isso na memória do projeto pra retomar depois.

- [ ] **Step 5: Commit do build**

```bash
git add dist/ docs/
git commit -m "build: reconstroi Alocacao Equipes com a aba Mapa (MapLibre + tiles Esri, pinos por SUP)"
```

- [ ] **Step 6: Rebase sobre origin/master antes de publicar**

Ver `CLAUDE.md`/memória do projeto ("master tem uma segunda frente ativa"): Patrick e os workflows agendados empurram pro mesmo `master`. Antes de publicar:

```bash
git fetch origin
git rebase origin/master
node --test test/*.test.js   # de novo, depois do rebase -- o dado da MATRIZ pode ter mudado
```

Resolver conflitos priorizando os arquivos COMPARTILHADOS (dado vindo de upstream vence, nunca force) — ver a memória `project-orcamento-master-tem-segunda-frente`.

- [ ] **Step 7: Push e publicação**

```bash
git push origin semanal-alocacao-mapa:master
```

Depois, seguir o fluxo de deploy do Pages descrito no `CLAUDE.md` da raiz (`orcamento-dashboard` publica via Pages servindo `/docs` do próprio `master` — conferir se há um passo de deploy adicional além do push, lendo a seção correspondente do `CLAUDE.md` do repo `orcamento-dashboard` antes de assumir que o push sozinho publica).

- [ ] **Step 8: Verificação ao vivo**

```bash
curl -s https://amcaccere261283.github.io/orcamento-dashboard/alocacao-equipes.html | grep -o 'Gerado em[^<]*'
```

Confirmar que o "Gerado em" bate com o build local recém-feito — nunca confiar só no status da API/Action.

---

## Fora de escopo deste plano (repetido da spec, pra não virar instrução solta)

- **Migração visual da aba Kanban pro padrão Suporte Infra** — pedido explícito do usuário pra vir DEPOIS deste plano estar publicado e revisado. Quando for a hora, isso é um plano PRÓPRIO (nova spec + novo plano), nunca uma tarefa amontoada no fim deste.
- Geocodificação automática por texto, ou qualquer suposição sobre o nome real das colunas que Patrick vai publicar além do que `coordenadas-sup.js` já tenta (Task 2/4) — ajustar aquele módulo quando o nome real divergir, sem reabrir o resto do desenho.
