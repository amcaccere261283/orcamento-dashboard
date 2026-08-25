# Live-refresh compartilhado (fontes nomeadas) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Acabar com a duplicação de ~300 linhas do botão "Atualizar dados" entre
`render-semanal.js` e `render-alocacao-pagina.js`, trocando os índices posicionais
`textos[N]` por fontes NOMEADAS, e com isso eliminar o trabalho morto que a página de
Alocação faz a cada clique (M-5) e o nome enganoso `window.__ALOCACAO_AUTOR__` (M-6).

**Architecture:** Um módulo novo `tools/semanal/live-refresh.js`, empacotado no bundle das
duas páginas, expõe `atualizarDadosAoVivo(config)`. `config.fontes` é um objeto NOMEADO
(`{matriz, avancos, lab, eq, producao, roster, demandasSondagem, demandasLab}`) — fonte
ausente/`null` não é buscada, e o que dependia dela não é calculado. O módulo faz `require`
só dos 5 módulos que AS DUAS páginas carregam; os 2 que divergem
(`ComputeEquipesRealizadoAlocado`, `ComputeEquipesNaoProdutivas`) chegam por
`config.modulos` — é isso que permite a página de Alocação tirá-los do bundle sem quebrar.

**Tech Stack:** Node.js puro, `node --test`, `tools/comum/browser-bundle.js` (o módulo vira
IIFE e `require('./x.js')` desestruturado vira `MODULOS['x.js']`).

## Global Constraints

- **O módulo é dual (Node + navegador).** `window`, `document` e `fetch` só podem ser
  tocados DENTRO de funções, nunca no corpo do módulo — os testes o carregam em Node.
- **`require` só na forma desestruturada** (`const { X } = require('./y.js');`). O bundler
  não reescreve `const X = require('./y.js')`, e isso quebra no navegador.
- **Nunca fazer `require('./x.js')` de um módulo que uma das duas páginas não carrega** —
  `MODULOS['x.js']` sai `undefined` e a desestruturação lança `TypeError` na hora que a
  IIFE roda, derrubando o bundle inteiro.
- **A fonte `matriz` NÃO tem `.catch`** — é a única cuja falha derruba o refresh inteiro
  (atomicidade tudo-ou-nada). Todas as outras degradam sozinhas. Preservar exatamente isso.
- **A fonte `demandasLab` é JSON**, buscada com `fetch(url).then(r => r.json())` cru, sem
  `buscarCsvSemanal` e sem cache-bust. Preservar.
- **Nada é escrito em `window.__REGISTROS__`/`window.__DEMANDAS__` antes de todos os
  fetches e todo o parsing terminarem.** `window.__BASELINE__` nunca é tocado.
- Não mexer nos módulos de lógica pura (`compute-alocacao.js`, `equipes-alocaveis.js`,
  `grupos-veiculo.js`, `alocacao-sheet.js`, `render-aba-alocacao.js`, `compute-demandas.js`,
  `parse-avancos.js`, `parse-lab.js`).
- Não reconstruir os dashboards (`dist/`/`docs/`) durante as Tasks 1-3 — a Task 4 faz isso.

---

## Estado de partida (medido, não suposto)

- `render-semanal.js:1965-2177` (213 linhas) e `render-alocacao-pagina.js:1004-1264`
  (261 linhas) são a MESMA função, com **exatamente duas divergências**:
  - **A:** `render-alocacao-pagina.js:1124-1174` tem 48 linhas a mais — preserva
    `equipesCsv`/`osParaSup`/`equipesRosterPeriodo` de `window.__DEMANDAS__`, calcula
    `osParaSup` a partir de `furos`, e sobrescreve os três `if (periodoEq)`.
  - **B:** o redesenho final — `recalcularSemanal(); montarAbaDemandas();` (semanal) vs
    `montarAbaAlocacao();` (alocação).
- Os helpers (`URL_ESPELHO_*` x8, `definirStatusAtualizacaoSemanal`, `periodosDoAnoSemanal`,
  `buscarCsvSemanal`, `gridCsvComoXlsx`, `RE_URL_PENDENTE`) são **byte-idênticos** nas duas
  (`render-semanal.js:1866-1947` vs `render-alocacao-pagina.js:905-986`).
- A reatribuição `demandasNovas = ComputeDemandas.computeDemandas(...)` está em
  `render-semanal.js:2071` / `render-alocacao-pagina.js:1110`. **Nenhum campo é escrito
  antes dela hoje** — a regra do CLAUDE.md está satisfeita, é restrição para o futuro.
- Testes que protegem isto hoje: **7** em `test/semanal-render-semanal-wireup.test.js`
  (`:576`, `:624`, `:734`, `:797`, `:818`, `:1606`, `:1669`) e **2** em
  `test/semanal-alocacao-pagina-wireup.test.js` (`:188`, `:250`).

---

### Task 1: O módulo `live-refresh.js` com fontes nomeadas + testes de unidade

**Files:**
- Create: `tools/semanal/live-refresh.js`
- Create: `test/semanal-live-refresh.test.js`

**Interfaces:**
- Consumes (via `require('./x.js')` desestruturado — os 5 que as DUAS páginas carregam):
  `parse-matriz-cliente.js`, `parse-avancos.js`, `parse-lab.js`, `compute-demandas.js`,
  `compute-equipes-ativas.js`.
- Produces: `module.exports = { atualizarDadosAoVivo, URLS_PADRAO, RE_URL_PENDENTE }`.

- [ ] **Step 1: Escrever os testes que falham primeiro (TDD)**

Em `test/semanal-live-refresh.test.js`, com `fetch` e `document` dublês. Cubra:

1. `fontes.matriz` falhando rejeita e NÃO chama `aplicar` (atomicidade).
2. `fontes.eq` falhando NÃO derruba o refresh — `aplicar` é chamado.
3. Fonte omitida (`producao: null`) **não é buscada** — o dublê de `fetch` não recebe
   aquela URL. (Esta é a prova do M-5.)
4. Sem `modulos.ComputeEquipesRealizadoAlocado`, `equipesPorDia` do resultado **preserva**
   o valor de `estadoAtual().demandas.equipesPorDia` e nenhum cruzamento é tentado.
5. Sem `modulos.ComputeEquipesNaoProdutivas`, `equipesNaoProdutivas` não é calculado.
6. Com `rosterAlocacao: true`, os 3 campos são preservados quando `eq` falha e
   sobrescritos quando `eq` responde (é o comportamento I-2 já testado na página).
7. Com `rosterAlocacao` ausente/false, os 3 campos **não** aparecem no resultado.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/semanal-live-refresh.test.js`
Expected: FAIL — `Cannot find module './live-refresh.js'` ou equivalente.

- [ ] **Step 3: Implementar o módulo**

Porte a lógica de `render-semanal.js:1866-2177` (helpers + função) para o módulo, com estas
mudanças e NENHUMA outra:

```js
// atualizarDadosAoVivo(config) -> Promise
// config:
//   fontes: { matriz, avancos, lab, eq, producao, roster, demandasSondagem, demandasLab }
//     -- cada uma uma URL string, ou null/undefined pra não buscar.
//   modulos: { ComputeEquipesRealizadoAlocado?, ComputeEquipesNaoProdutivas? }
//     -- opcionais: ausente => a saída que depende dele não é calculada.
//   ano: number                      (era window.__ANO__)
//   rosterAlocacao: boolean          (divergência A: os 3 campos da Alocação)
//   estadoAtual: () => ({ registros, demandas })   (era window.__REGISTROS__/__DEMANDAS__)
//   aplicar: (registrosNovos, demandasNovas) => void   (divergência B + a escrita dos globais)
//   definirStatus: (texto, ehErro) => void
```

Regras de derivação (substituem os `if` posicionais de hoje):
- `avancosLabConfigurados` = `fontes.avancos && fontes.lab` e nenhuma delas casando
  `RE_URL_PENDENTE`.
- `equipesPorDia`/`equipesPeriodo` (Realizado) só são recalculados quando
  `fontes.producao && fontes.roster && modulos.ComputeEquipesRealizadoAlocado` e o
  cruzamento devolver par utilizável; caso contrário **preservam** o valor anterior.
- `equipesNaoProdutivas` só quando `modulos.ComputeEquipesNaoProdutivas` e `csvEq &&
  periodoEq`.
- Os 3 campos da Alocação só quando `rosterAlocacao === true` — preservados do estado
  anterior e sobrescritos `if (periodoEq)`, exatamente como
  `render-alocacao-pagina.js:1144-1174` faz hoje.

`URLS_PADRAO` exporta as 8 constantes `URL_ESPELHO_*` com os comentários que elas já
carregam (as duas páginas passam a lê-las daqui em vez de duplicá-las).

**Cuidado com o `Promise.all`:** monte-o a partir de uma LISTA de nomes, e leia o resultado
por nome (ex.: `resultado.eq`), nunca por índice. É o ponto inteiro desta task.

- [ ] **Step 4: Rodar até passar**

Run: `node --test test/semanal-live-refresh.test.js`
Expected: PASS.

- [ ] **Step 5: Suíte inteira (nada foi ligado ainda, deve continuar verde)**

Run: `node --test test/*.test.js`
Expected: PASS, 1309 + os novos.

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/live-refresh.js test/semanal-live-refresh.test.js
git commit -m "feat: módulo live-refresh.js com fontes nomeadas (ainda não ligado nas páginas)"
```

---

### Task 2: Ligar a página de Alocação (6 fontes) e enxugar o bundle dela

**Files:**
- Modify: `tools/semanal/render-alocacao-pagina.js`
- Modify (só se algum teste exigir): `test/semanal-alocacao-pagina-wireup.test.js`

**Interfaces:**
- Consumes: `atualizarDadosAoVivo`, `URLS_PADRAO` de `live-refresh.js` (Task 1).

- [ ] **Step 1: Trocar a implementação pela chamada**

Apague de `SCRIPT_CLIENTE_ALOCACAO` os helpers duplicados (`render-alocacao-pagina.js:905-986`)
e a função inteira (`:1004-1264`), e ponha no lugar:

```js
var LiveRefresh = MODULOS['live-refresh.js'];

function atualizarDadosAoVivoSemanal() {
  return LiveRefresh.atualizarDadosAoVivo({
    fontes: {
      matriz: LiveRefresh.URLS_PADRAO.matriz,
      avancos: LiveRefresh.URLS_PADRAO.avancos,
      lab: LiveRefresh.URLS_PADRAO.lab,
      eq: LiveRefresh.URLS_PADRAO.eq,
      demandasSondagem: LiveRefresh.URLS_PADRAO.demandasSondagem,
      demandasLab: LiveRefresh.URLS_PADRAO.demandasLab,
      // producao/roster NÃO entram: só alimentam equipesPorDia (Realizado de
      // Equipes), que esta página nunca lê -- a Tendência dela é sempre
      // 'volume' (compute-alocacao.js), e volume não toca equipesPorDia.
    },
    modulos: {},   // idem: sem os dois módulos de equipes-realizado/não-produtivas
    ano: window.__ANO__,
    rosterAlocacao: true,
    estadoAtual: function () {
      return { registros: window.__REGISTROS__, demandas: window.__DEMANDAS__ };
    },
    aplicar: function (registrosNovos, demandasNovas) {
      window.__REGISTROS__ = registrosNovos;
      window.__DEMANDAS__ = demandasNovas;
      montarTodosFiltrosMultiSemanal(window.__REGISTROS__);
      montarAbaAlocacao();
    },
    definirStatus: definirStatusAtualizacaoSemanal,
  });
}
```

`definirStatusAtualizacaoSemanal` continua na página (é DOM dela). Os bindings
`var ParseAvancos = ...` etc. que ficarem SEM USO no script de cliente devem sair — confira
um por um com grep antes de remover (alguns podem ter outro consumidor).

- [ ] **Step 2: Enxugar `BUNDLE_ARQUIVOS_ALOCACAO`**

Remover `'compute-equipes-nao-produtivas.js'` e `'compute-equipes-realizado-alocado.js'`.
Acrescentar `'live-refresh.js'` no FIM da lista (ele consome os 5 comuns, todos já antes).
Deixe um comentário dizendo por que os dois saíram e por que o módulo novo não pode
fazer `require` deles.

- [ ] **Step 3: Rodar os testes da página**

Run: `node --test test/semanal-alocacao-pagina-wireup.test.js`
Expected: PASS — os 2 testes de refresh (`:188` e `:250`) continuam valendo sem alteração.
Se algum falhar por causa da contagem de `<script>` ou de um binding removido, ajuste o
TESTE só no que for mecânico; se falhar por COMPORTAMENTO, pare e reporte.

- [ ] **Step 4: Suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/render-alocacao-pagina.js test/
git commit -m "refactor: página de Alocação usa live-refresh.js com 6 fontes (fim do trabalho morto de equipes)"
```

---

### Task 3: Ligar a página Semanal (8 fontes)

**Files:**
- Modify: `tools/semanal/render-semanal.js`
- Modify (só se algum teste exigir): `test/semanal-render-semanal-wireup.test.js`

- [ ] **Step 1: Trocar a implementação pela chamada**

Mesma troca da Task 2, apagando `render-semanal.js:1866-1947` e `:1965-2177`, com as 8
fontes, `modulos: { ComputeEquipesRealizadoAlocado, ComputeEquipesNaoProdutivas }`,
**sem** `rosterAlocacao`, e o `aplicar` chamando `recalcularSemanal(); montarAbaDemandas();`.

- [ ] **Step 2: Acrescentar `'live-refresh.js'` ao fim de `BUNDLE_ARQUIVOS`**

Os dois módulos de equipes CONTINUAM nesta lista (esta página os usa).

- [ ] **Step 3: Rodar os 7 testes de refresh**

Run: `node --test test/semanal-render-semanal-wireup.test.js`
Expected: PASS — os 7 (`:576`, `:624`, `:734`, `:797`, `:818`, `:1606`, `:1669`) são a rede
de segurança desta task. Nenhum deles deve precisar mudar de ASSERÇÃO.

- [ ] **Step 4: Suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/render-semanal.js test/
git commit -m "refactor: página Semanal usa live-refresh.js com as 8 fontes"
```

---

### Task 4: `__ALOCACAO_AUTOR__` (M-6), rebuild, verificação e publicação

**Files:**
- Modify: `tools/semanal/render-semanal.js`, `tools/semanal/render-alocacao-pagina.js`
- Modify: `CLAUDE.md`
- Build: `dist/*.html` → `docs/*.html`

- [ ] **Step 1: Renomear o global de autor**

`window.__ALOCACAO_AUTOR__` é lido em dois lugares e **nunca é definido em lugar nenhum**
(sai sempre `'dashboard'`): `render-semanal.js:1403` (autoria do relatório histórico — nome
enganoso, a página não tem mais alocação) e `render-alocacao-pagina.js:233` (autoria da
escrita na planilha de alocação). Renomeie os DOIS para `window.__DASHBOARD_AUTOR__` — é o
mesmo conceito ("quem está operando o dashboard"), e dois nomes para o mesmo global vazio
seria pior. Grep antes e depois para garantir que não sobrou ocorrência.

- [ ] **Step 2: Atualizar o CLAUDE.md**

A seção que descreve o live-refresh precisa dizer que ele agora vive em
`tools/semanal/live-refresh.js`, é compartilhado pelas duas páginas, e que as fontes são
NOMEADAS — o aviso sobre "índices posicionais `textos[N]`" e sobre "escrever por último em
`demandasNovas`" deve ser reescrito para refletir que o primeiro deixou de existir. Também
remova/ajuste os comentários de aviso mútuo que a rodada anterior pôs no topo de cada cópia
(eles apontam para uma duplicação que não existe mais).

- [ ] **Step 3: Suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS.

- [ ] **Step 4: Commit do fonte**

```bash
git add tools/ test/ CLAUDE.md
git commit -m "refactor: __ALOCACAO_AUTOR__ vira __DASHBOARD_AUTOR__; CLAUDE.md sobre o live-refresh compartilhado"
```

- [ ] **Step 5: Rebuild e publicação — SÓ depois da revisão final da branch**

Este passo NÃO é do implementador: quem coordena roda o build com a senha, copia os dois
HTMLs para `docs/`, verifica em navegador real (as duas páginas destravando sem erro de
console e o botão "Atualizar dados" funcionando nas duas) e publica. Ver o histórico de
2026-08-25 para o fluxo completo.
