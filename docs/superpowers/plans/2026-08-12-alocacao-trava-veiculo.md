# Trava de deslocamento por veículo compartilhado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Equipes que dividem o mesmo veículo nunca ficam em SUPs diferentes na aba Alocação Equipes — o gesto que move uma move o grupo inteiro.

**Architecture:** Um módulo puro novo (`tools/semanal/grupos-veiculo.js`) transforma a coluna `Veículo` da aba EQ em grupos por fecho transitivo (union-find) e decide, sozinho e sem tocar em estado nem DOM, a lista de movimentos de um gesto. `equipes-alocaveis.js` anexa o grupo a cada equipe; `render-semanal.js` aplica a lista em `aplicarMovimento` (o funil por onde os dois gestos já passam); `render-aba-alocacao.js` desenha o selo, o destaque das companheiras e o estado de conflito herdado.

**Tech Stack:** JavaScript ES5-compatível (`var`/`function`), Node 20+ sem dependências, `node:test`. Os módulos de `tools/semanal/` rodam no Node (build/testes) **e** no navegador, concatenados por `tools/comum/browser-bundle.js`.

**Spec:** `docs/superpowers/specs/2026-08-12-alocacao-trava-veiculo-design.md` — leia antes de começar.

## Global Constraints

- **Repositório:** `orcamento-dashboard`. Branch de trabalho: `semanal-alocacao-equipes-rebase`.
- **Estilo dos módulos bundláveis:** `'use strict';` no topo, `var`/`function` (nunca `const`/`let`/arrow em código de módulo), `const { X } = require('./arquivo.js');` **na primeira linha depois do `use strict`** e `module.exports = { ... };` no fim — são as formas EXATAS que `transformaModulo` reconhece. Qualquer outro formato de require quebra o bundle no navegador em silêncio.
- **Ordem do bundle é contrato:** `BUNDLE_ARQUIVOS` (`tools/semanal/render-semanal.js:756`) não resolve dependência. Um módulo só pode aparecer DEPOIS de tudo que ele consome.
- **Nunca escreva crase (`` ` ``) dentro dos template literals `SCRIPT_CLIENTE_SEMANAL`/`CSS_SEMANAL`** em `render-semanal.js` — uma crase solta trunca o script do cliente inteiro sem erro de build; o sintoma aparece longe, como `montarDashboard is not defined`.
- **Testes:** `node --test test/*.test.js` na raiz do repositório. A suíte estava em **1054 passando / 0 falhando** antes deste plano.
- **Não publique nada.** Nenhuma tarefa deste plano roda `git push`, `cp` para `docs/` ou build de deploy, exceto a Task 7 (que só reconstrói e commita). A publicação é da sessão que verifica o trabalho, depois das revisões.
- **Nomes de identificador de equipe são STRING sempre.** `String(id)` em toda chave de mapa — o CSV entrega texto, mas os testes e o `alocacao` salvo podem trazer número.

---

### Task 1: O módulo de agrupamento — `normalizarVeiculo` e `agruparPorVeiculo`

**Files:**
- Create: `tools/semanal/grupos-veiculo.js`
- Test: `test/semanal-grupos-veiculo.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `normalizarVeiculo(texto) -> { tipo: 'placa'|'carona'|'nenhum', chave: string|null }`
  - `agruparPorVeiculo(linhas) -> { grupoPorId: {[id]: chave}, membrosDoGrupo: {[chave]: [id]}, rotuloDoGrupo: {[chave]: string} }`, onde `linhas` é `[{ id, veiculo }]` do roster INTEIRO.

- [ ] **Step 1: Write the failing test**

Crie `test/semanal-grupos-veiculo.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { normalizarVeiculo, agruparPorVeiculo } = require('../tools/semanal/grupos-veiculo.js');

// Todos os casos abaixo são TEXTO REAL medido na aba EQ em 2026-08-12
// (117 equipes) -- ver a seção "Medição da fonte" do spec.

test('placa é reconhecida e normalizada: o descritivo entre parênteses e a caixa não contam', () => {
  assert.deepStrictEqual(normalizarVeiculo('UDU8J88 (D, 9p)'), { tipo: 'placa', chave: 'UDU8J88' });
  assert.deepStrictEqual(normalizarVeiculo('UDU8J88 (D, 9 p)'), { tipo: 'placa', chave: 'UDU8J88' });
  assert.deepStrictEqual(normalizarVeiculo('UFW3J85 (b, 2p)'), { tipo: 'placa', chave: 'UFW3J85' });
  // Placa antiga, com hífen e com espaço.
  assert.deepStrictEqual(normalizarVeiculo('SUH-6F44 (D, Munck, 2p)'), { tipo: 'placa', chave: 'SUH6F44' });
  assert.deepStrictEqual(normalizarVeiculo('EYX 4G65 (D, 9p)'), { tipo: 'placa', chave: 'EYX4G65' });
});

test('carona é reconhecida em qualquer caixa e com espaço sobrando', () => {
  assert.deepStrictEqual(normalizarVeiculo('Carona ID 171'), { tipo: 'carona', chave: '171' });
  assert.deepStrictEqual(normalizarVeiculo('carona ID 463'), { tipo: 'carona', chave: '463' });
  assert.deepStrictEqual(normalizarVeiculo('Carona  ID 477'), { tipo: 'carona', chave: '477' });
});

test('LISTA DE PERMISSÃO: todo o resto é "nenhum" -- Próprio, vazio e texto solto nunca vinculam', () => {
  // O inverso (agrupar tudo, com lista negra) prenderia duas equipes uma na
  // outra no dia em que alguém digitasse uma palavra nova. Ver Decisão 1.
  for (const texto of ['Próprio', 'próprio', 'PRÓPRIO', '', '   ', '-', 'afastado', 'D?', 'Suporte', null, undefined]) {
    assert.deepStrictEqual(normalizarVeiculo(texto), { tipo: 'nenhum', chave: null },
      'não pode vincular: ' + JSON.stringify(texto));
  }
});

test('cadeia de quatro vira UM grupo: três caronas apontando para a equipe da placa', () => {
  const r = agruparPorVeiculo([
    { id: '644', veiculo: 'carona ID 660' },
    { id: '651', veiculo: 'carona ID 660' },
    { id: '656', veiculo: 'Carona ID 660' },
    { id: '660', veiculo: 'ELE-8E91 (9 p)' },
  ]);
  const chave = r.grupoPorId['644'];
  assert.deepStrictEqual(r.membrosDoGrupo[chave], ['644', '651', '656', '660']);
  assert.strictEqual(r.grupoPorId['660'], chave);
  assert.strictEqual(r.rotuloDoGrupo[chave], 'ELE8E91');
});

test('placas iguais com pontuação diferente agrupam -- 3 grupos reais dependem disso', () => {
  const r = agruparPorVeiculo([
    { id: '479', veiculo: 'UDU8J88 (D, 9p)' },
    { id: '623', veiculo: 'UDU8J88 (D, 9 p)' },
  ]);
  assert.strictEqual(r.grupoPorId['479'], r.grupoPorId['623']);
  assert.deepStrictEqual(r.membrosDoGrupo[r.grupoPorId['479']], ['479', '623']);
});

test('16 equipes "Próprio" ficam SOLTEIRAS, e vazio não agrupa com vazio', () => {
  const r = agruparPorVeiculo([
    { id: '164', veiculo: 'Próprio' },
    { id: '223', veiculo: 'Próprio' },
    { id: '286', veiculo: 'próprio' },
    { id: '322', veiculo: '' },
    { id: '605', veiculo: '' },
  ]);
  const chaves = new Set(['164', '223', '286', '322', '605'].map((id) => r.grupoPorId[id]));
  assert.strictEqual(chaves.size, 5, 'cada uma no seu próprio grupo');
  ['164', '223', '286', '322', '605'].forEach((id) => {
    assert.deepStrictEqual(r.membrosDoGrupo[r.grupoPorId[id]], [id]);
  });
});

test('carona órfã (alvo fora do roster) fica solteira -- Carona ID 10 e Carona ID 477 existem de verdade', () => {
  const r = agruparPorVeiculo([
    { id: '366', veiculo: 'Carona ID 10' },
    { id: '478', veiculo: 'Carona  ID 477' },
  ]);
  assert.notStrictEqual(r.grupoPorId['366'], r.grupoPorId['478']);
  assert.deepStrictEqual(r.membrosDoGrupo[r.grupoPorId['366']], ['366']);
});

test('grupo SEM nenhuma placa é rotulado pela carona -- caso real {322, 635, 666}', () => {
  const r = agruparPorVeiculo([
    { id: '322', veiculo: '' },
    { id: '635', veiculo: 'Carona ID 322' },
    { id: '666', veiculo: 'Carona ID 322' },
  ]);
  const chave = r.grupoPorId['635'];
  assert.deepStrictEqual(r.membrosDoGrupo[chave], ['322', '635', '666']);
  assert.strictEqual(r.rotuloDoGrupo[chave], 'Carona ID 322');
});

test('ciclo de caronas não entra em laço infinito', () => {
  const r = agruparPorVeiculo([
    { id: '10', veiculo: 'Carona ID 20' },
    { id: '20', veiculo: 'Carona ID 10' },
  ]);
  assert.strictEqual(r.grupoPorId['10'], r.grupoPorId['20']);
});

test('carona apontando para si mesma não quebra nem cria grupo', () => {
  const r = agruparPorVeiculo([{ id: '660', veiculo: 'Carona ID 660' }]);
  assert.deepStrictEqual(r.membrosDoGrupo[r.grupoPorId['660']], ['660']);
});

test('membros saem em ordem numérica estável, não na ordem do CSV', () => {
  const r = agruparPorVeiculo([
    { id: '660', veiculo: 'ELE-8E91 (9 p)' },
    { id: '44', veiculo: 'carona ID 660' },
    { id: '651', veiculo: 'carona ID 660' },
  ]);
  assert.deepStrictEqual(r.membrosDoGrupo[r.grupoPorId['660']], ['44', '651', '660']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/semanal-grupos-veiculo.test.js`
Expected: FAIL — `Cannot find module '../tools/semanal/grupos-veiculo.js'`

- [ ] **Step 3: Write minimal implementation**

Crie `tools/semanal/grupos-veiculo.js`:

```javascript
'use strict';

// Este módulo roda no Node (build/testes) e no navegador (bundle) -- por isso
// 'var'/'function'. Não consome nenhum outro módulo.
//
// EQUIPES QUE DIVIDEM VEÍCULO
// ===========================================================================
// Ver docs/superpowers/specs/2026-08-12-alocacao-trava-veiculo-design.md.
//
// A coluna 'Veículo' da aba EQ carrega quatro tipos de conteúdo, e só dois
// criam vínculo entre equipes: uma PLACA (a mesma placa em duas linhas) e uma
// CARONA ('Carona ID N', que aponta para outra equipe). O resto -- 'Próprio'
// (16 equipes), vazio (10), 'afastado', 'D?', 'Suporte' -- não vincula NADA.
//
// A regra é uma lista de PERMISSÃO de propósito. Com lista de exclusão, no dia
// em que alguém digitasse uma palavra nova em duas linhas as duas equipes
// ficariam travadas uma na outra, sem nada na tela explicando por quê. Assim,
// texto desconhecido apenas não trava -- o modo de falhar é a ausência da
// trava, nunca uma trava fantasma.

// Placa antiga (SUH-6F44, EYX 4G65) e Mercosul (UFY1G30): 3 letras + 4
// alfanuméricos começando por dígito, com separador opcional. O descritivo
// entre parênteses -- '(D, 9p)' vs '(D, 9 p)' -- fica de fora: três grupos
// REAIS só aparecem porque ele não conta.
var RE_PLACA = /^([A-Za-z]{3})[ -]?([0-9][A-Za-z0-9]{3})/;
// 'Carona ID 171', 'carona ID 463', 'Carona  ID 477' (espaço duplo) -- as três
// grafias existem na planilha.
var RE_CARONA = /^carona\s+id\s*(\d+)/i;

function normalizarVeiculo(texto) {
  var t = String(texto === null || texto === undefined ? '' : texto).trim();
  if (!t) return { tipo: 'nenhum', chave: null };
  var carona = RE_CARONA.exec(t);
  if (carona) return { tipo: 'carona', chave: carona[1] };
  var placa = RE_PLACA.exec(t);
  if (placa) return { tipo: 'placa', chave: (placa[1] + placa[2]).toUpperCase() };
  return { tipo: 'nenhum', chave: null };
}

// Ordem numérica quando os dois lados são numéricos (todo ID da aba EQ é), com
// queda para ordem de texto -- um ID não numérico não pode quebrar a ordenação.
function compararIds(a, b) {
  var na = parseInt(a, 10);
  var nb = parseInt(b, 10);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  return a < b ? -1 : (a > b ? 1 : 0);
}

// linhas: [{ id, veiculo }] -- o roster INTEIRO da aba EQ, incluindo as equipes
// que ficam fora do quadro (Lab/TST/SN). Duas equipes alocáveis podem se ligar
// através da carona numa terceira que não é alocável: o veículo é o mesmo de
// qualquer forma, e quem filtra o que aparece na tela é quem chama.
function agruparPorVeiculo(linhas) {
  var lista = linhas || [];
  var pai = {};
  lista.forEach(function (l) { pai[String(l.id)] = String(l.id); });

  function raiz(x) {
    var atual = x;
    while (pai[atual] && pai[atual] !== atual) {
      pai[atual] = pai[pai[atual]];
      atual = pai[atual];
    }
    return atual;
  }
  function unir(a, b) {
    var ra = raiz(a);
    var rb = raiz(b);
    if (ra !== rb) pai[ra] = rb;
  }

  var porPlaca = {};
  var placaDoId = {};
  lista.forEach(function (l) {
    var id = String(l.id);
    var v = normalizarVeiculo(l.veiculo);
    if (v.tipo === 'carona') {
      // Alvo que não existe no roster não cria aresta (medido: 'Carona ID 10'
      // e 'Carona ID 477' apontam para IDs ausentes). Auto-referência também
      // não -- uniria a equipe a si mesma, sem efeito, mas o guarda deixa a
      // intenção explícita.
      if (Object.prototype.hasOwnProperty.call(pai, v.chave) && v.chave !== id) unir(id, v.chave);
      return;
    }
    if (v.tipo === 'placa') {
      placaDoId[id] = v.chave;
      if (!porPlaca[v.chave]) porPlaca[v.chave] = [];
      porPlaca[v.chave].push(id);
    }
  });
  Object.keys(porPlaca).forEach(function (placa) {
    var ids = porPlaca[placa];
    for (var i = 1; i < ids.length; i++) unir(ids[0], ids[i]);
  });

  // A raiz do union-find é arbitrária (depende da ordem das uniões), então ela
  // NÃO serve de chave estável. A chave sai do conteúdo: a menor placa do
  // grupo, ou o menor ID quando o grupo não tem placa nenhuma (caso real
  // {322, 635, 666}, em que a 322 tem veículo vazio e as outras a caroneiam).
  var membrosPorRaiz = {};
  Object.keys(pai).forEach(function (id) {
    var r = raiz(id);
    if (!membrosPorRaiz[r]) membrosPorRaiz[r] = [];
    membrosPorRaiz[r].push(id);
  });

  var grupoPorId = {};
  var membrosDoGrupo = {};
  var rotuloDoGrupo = {};
  Object.keys(membrosPorRaiz).forEach(function (r) {
    var membros = membrosPorRaiz[r].slice().sort(compararIds);
    var placas = membros.map(function (id) { return placaDoId[id]; })
      .filter(function (p) { return !!p; }).sort();
    var chave = placas.length ? 'PLACA:' + placas[0] : 'CARONA:' + membros[0];
    membrosDoGrupo[chave] = membros;
    rotuloDoGrupo[chave] = placas.length ? placas[0] : 'Carona ID ' + membros[0];
    membros.forEach(function (id) { grupoPorId[id] = chave; });
  });

  return { grupoPorId: grupoPorId, membrosDoGrupo: membrosDoGrupo, rotuloDoGrupo: rotuloDoGrupo };
}

module.exports = { normalizarVeiculo, agruparPorVeiculo };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/semanal-grupos-veiculo.test.js`
Expected: PASS, 11 testes.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/grupos-veiculo.js test/semanal-grupos-veiculo.test.js
git commit -m "Alocacao: modulo que agrupa equipes pelo veiculo compartilhado"
```

---

### Task 2: A decisão do gesto — `destinoDoGrupo` e `conflitosDeVeiculo`

**Files:**
- Modify: `tools/semanal/grupos-veiculo.js` (acrescenta duas funções e as exporta)
- Test: `test/semanal-grupos-veiculo.test.js` (acrescenta um bloco)

**Interfaces:**
- Consumes: `normalizarVeiculo`/`agruparPorVeiculo` (Task 1) — não diretamente, mas o mesmo arquivo.
- Produces:
  - `destinoDoGrupo(equipes, alocacao, equipeId, sup, coluna) -> [{ id, sup, coluna }]`. Lista VAZIA = gesto recusado, nada se move. `sup: ''` num item = devolver ao pool.
  - `conflitosDeVeiculo(equipes, alocacao) -> { [equipeId]: [{ id, sup }] }`
  - Formato de `equipes`: os objetos que `equipesDoQuadro` devolve — `{ id, colunas, disponivel, companheiros }`. Formato de `alocacao`: `{ [equipeId]: { sup, coluna } }`.

- [ ] **Step 1: Write the failing test**

Acrescente ao FIM de `test/semanal-grupos-veiculo.test.js`:

```javascript
// --- destinoDoGrupo ---------------------------------------------------------

const { destinoDoGrupo, conflitosDeVeiculo } = require('../tools/semanal/grupos-veiculo.js');

// Grupo de três (A, B, C) mais uma equipe solteira (Z). B é polivalente
// (ST | PI | BL), C só serve SP, e D é do grupo mas está INDISPONÍVEL.
function equipesDeTeste() {
  return [
    { id: 'A', colunas: ['SP'], disponivel: true, companheiros: ['B', 'C', 'D'] },
    { id: 'B', colunas: ['ST', 'PI', 'BL'], disponivel: true, companheiros: ['A', 'C', 'D'] },
    { id: 'C', colunas: ['SP'], disponivel: true, companheiros: ['A', 'B', 'D'] },
    { id: 'D', colunas: ['SP'], disponivel: false, companheiros: ['A', 'B', 'C'] },
    { id: 'Z', colunas: ['SP'], disponivel: true, companheiros: [] },
  ];
}

test('companheira alocada em OUTRO SUP vem junto', () => {
  const alocacao = { A: { sup: 'SUP-1', coluna: 'SP' }, C: { sup: 'SUP-2', coluna: 'SP' } };
  const movs = destinoDoGrupo(equipesDeTeste(), alocacao, 'A', 'SUP-3', 'SP');
  assert.deepStrictEqual(movs.find((m) => m.id === 'C'), { id: 'C', sup: 'SUP-3', coluna: 'SP' });
});

test('companheira NO POOL vem junto -- pool é destino igual ao SUP', () => {
  const movs = destinoDoGrupo(equipesDeTeste(), {}, 'A', 'SUP-1', 'SP');
  assert.deepStrictEqual(movs.map((m) => m.id).sort(), ['A', 'B', 'C']);
});

test('companheira INDISPONÍVEL nunca é tocada, nem no pool nem no quadro', () => {
  const alocacao = { D: { sup: 'SUP-9', coluna: 'SP' } };
  const movs = destinoDoGrupo(equipesDeTeste(), alocacao, 'A', 'SUP-1', 'SP');
  assert.ok(!movs.some((m) => m.id === 'D'), 'D está indisponível: fica onde está');
});

test('companheira JÁ no SUP de destino não gera movimento redundante', () => {
  const alocacao = { C: { sup: 'SUP-1', coluna: 'SP' } };
  const movs = destinoDoGrupo(equipesDeTeste(), alocacao, 'A', 'SUP-1', 'SP');
  assert.ok(!movs.some((m) => m.id === 'C'));
});

test('a coluna da companheira é PRESERVADA quando ela serve a mesma no destino', () => {
  const alocacao = { B: { sup: 'SUP-2', coluna: 'PI' } };
  const movs = destinoDoGrupo(equipesDeTeste(), alocacao, 'A', 'SUP-1', 'SP');
  assert.deepStrictEqual(movs.find((m) => m.id === 'B'), { id: 'B', sup: 'SUP-1', coluna: 'PI' });
});

test('companheira que não serve a coluna do gesto cai na primeira que ela serve', () => {
  // B não serve SP; do pool, sem coluna anterior, vai para ST (primeira dela).
  const movs = destinoDoGrupo(equipesDeTeste(), {}, 'A', 'SUP-1', 'SP');
  assert.deepStrictEqual(movs.find((m) => m.id === 'B'), { id: 'B', sup: 'SUP-1', coluna: 'ST' });
});

test('companheira do pool que SERVE a coluna do gesto cai nela', () => {
  const movs = destinoDoGrupo(equipesDeTeste(), {}, 'A', 'SUP-1', 'SP');
  assert.deepStrictEqual(movs.find((m) => m.id === 'C'), { id: 'C', sup: 'SUP-1', coluna: 'SP' });
});

test('soltar no POOL devolve o grupo inteiro -- e só quem estava no quadro', () => {
  const alocacao = { A: { sup: 'SUP-1', coluna: 'SP' }, C: { sup: 'SUP-1', coluna: 'SP' } };
  const movs = destinoDoGrupo(equipesDeTeste(), alocacao, 'A', '', '');
  assert.deepStrictEqual(movs.map((m) => m.id).sort(), ['A', 'C']);
  movs.forEach((m) => assert.strictEqual(m.sup, ''));
});

test('gesto RECUSADO não move ninguém: coluna fora do conjunto da equipe arrastada', () => {
  assert.deepStrictEqual(destinoDoGrupo(equipesDeTeste(), {}, 'A', 'SUP-1', 'ST'), []);
});

test('gesto RECUSADO não move ninguém: equipe arrastada indisponível', () => {
  assert.deepStrictEqual(destinoDoGrupo(equipesDeTeste(), {}, 'D', 'SUP-1', 'SP'), []);
});

test('equipe desconhecida devolve lista vazia', () => {
  assert.deepStrictEqual(destinoDoGrupo(equipesDeTeste(), {}, 'NAO-EXISTE', 'SUP-1', 'SP'), []);
});

test('equipe sem companheiras move só ela', () => {
  const movs = destinoDoGrupo(equipesDeTeste(), {}, 'Z', 'SUP-1', 'SP');
  assert.deepStrictEqual(movs, [{ id: 'Z', sup: 'SUP-1', coluna: 'SP' }]);
});

// --- conflitosDeVeiculo -----------------------------------------------------

test('conflito é grupo espalhado em 2+ SUPs, apontando quem está onde', () => {
  const alocacao = { A: { sup: 'SUP-1', coluna: 'SP' }, C: { sup: 'SUP-2', coluna: 'SP' } };
  const conflitos = conflitosDeVeiculo(equipesDeTeste(), alocacao);
  assert.deepStrictEqual(conflitos.A, [{ id: 'C', sup: 'SUP-2' }]);
  assert.deepStrictEqual(conflitos.C, [{ id: 'A', sup: 'SUP-1' }]);
});

test('grupo inteiro no MESMO SUP não é conflito, e equipe no pool nunca é conflito', () => {
  const alocacao = { A: { sup: 'SUP-1', coluna: 'SP' }, C: { sup: 'SUP-1', coluna: 'SP' } };
  assert.deepStrictEqual(conflitosDeVeiculo(equipesDeTeste(), alocacao), {});
  // B está no pool enquanto A está alocada: pool não é SUP.
  assert.deepStrictEqual(conflitosDeVeiculo(equipesDeTeste(), { A: { sup: 'SUP-1', coluna: 'SP' } }), {});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/semanal-grupos-veiculo.test.js`
Expected: FAIL — `destinoDoGrupo is not a function`

- [ ] **Step 3: Write minimal implementation**

Em `tools/semanal/grupos-veiculo.js`, ANTES do `module.exports`, acrescente:

```javascript
// A coluna em que uma companheira aterrissa no SUP de destino. Preferência, em
// ordem: a coluna em que ela JÁ estava (se serve), a coluna do gesto (se
// serve), a primeira que ela serve. A trava é sobre SUP -- mudar a tipologia de
// quem só está pegando carona seria uma decisão que ninguém pediu.
function colunaDaCompanheira(equipe, atual, colunaDoGesto) {
  var colunas = equipe.colunas || [];
  if (atual && atual.coluna && colunas.indexOf(atual.coluna) !== -1) return atual.coluna;
  if (colunas.indexOf(colunaDoGesto) !== -1) return colunaDoGesto;
  return colunas[0];
}

// A TRAVA. Recebe o gesto (equipe arrastada + destino) e devolve a lista de
// movimentos a aplicar, com o grupo do veículo junto. Não toca em estado nem no
// DOM: quem aplica é aplicarMovimento (render-semanal.js).
//
// Lista VAZIA significa gesto RECUSADO -- e recusado move ZERO equipes, nem a
// arrastada. As duas recusas são as mesmas de antes da trava (equipe
// indisponível; coluna fora do conjunto dela), avaliadas antes de qualquer
// efeito.
//
// sup vazio = devolução ao pool, e ela também vale para o grupo: 'andam juntas'
// nos dois sentidos, senão tirar só uma do quadro recriaria o plano impossível
// ao contrário.
//
// A companheira INDISPONÍVEL nunca entra na lista. Não há deslocamento a
// coordenar com quem não vai a campo, e a trava não pode virar a porta dos
// fundos que aloca quem aplicarMovimento recusaria individualmente.
function destinoDoGrupo(equipes, alocacao, equipeId, sup, coluna) {
  var lista = equipes || [];
  var aloc = alocacao || {};
  var porId = {};
  lista.forEach(function (e) { porId[String(e.id)] = e; });

  var alvo = porId[String(equipeId)];
  if (!alvo || !alvo.disponivel) return [];
  if (sup && (alvo.colunas || []).indexOf(coluna) === -1) return [];

  var movimentos = [{
    id: String(equipeId),
    sup: sup || '',
    coluna: sup ? coluna : '',
  }];

  (alvo.companheiros || []).forEach(function (idBruto) {
    var id = String(idBruto);
    var companheira = porId[id];
    if (!companheira || !companheira.disponivel) return;
    var atual = aloc[id];
    if (!sup) {
      if (atual && atual.sup) movimentos.push({ id: id, sup: '', coluna: '' });
      return;
    }
    if (atual && atual.sup === sup) return;
    movimentos.push({ id: id, sup: sup, coluna: colunaDaCompanheira(companheira, atual, coluna) });
  });

  return movimentos;
}

// Grupos que JÁ estão espalhados em mais de um SUP -- só podem ter entrado pela
// semeadura do realizado ou por uma alocação salva antes desta versão, porque a
// trava impede que um movimento crie um. Marcar, nunca corrigir: a semeadura é
// o retrato de onde as equipes estiveram de fato (Decisão 4 do spec).
//
// Equipe no pool NUNCA é conflito: conflito é estar em SUPs diferentes, e pool
// não é SUP. (Isto é independente da trava mover companheira do pool -- lá é
// coordenar deslocamento, aqui é acusar um plano impossível.)
function conflitosDeVeiculo(equipes, alocacao) {
  var aloc = alocacao || {};
  var conflitos = {};
  (equipes || []).forEach(function (e) {
    var meu = aloc[String(e.id)];
    if (!meu || !meu.sup) return;
    var outros = [];
    (e.companheiros || []).forEach(function (idBruto) {
      var destino = aloc[String(idBruto)];
      if (destino && destino.sup && destino.sup !== meu.sup) {
        outros.push({ id: String(idBruto), sup: destino.sup });
      }
    });
    if (outros.length) conflitos[String(e.id)] = outros;
  });
  return conflitos;
}
```

E troque o `module.exports` por:

```javascript
module.exports = {
  normalizarVeiculo, agruparPorVeiculo, destinoDoGrupo, conflitosDeVeiculo,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/semanal-grupos-veiculo.test.js`
Expected: PASS, 25 testes.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/grupos-veiculo.js test/semanal-grupos-veiculo.test.js
git commit -m "Alocacao: destinoDoGrupo decide o gesto, conflitosDeVeiculo acha o herdado"
```

---

### Task 3: `equipesDoQuadro` anexa o grupo a cada equipe

**Files:**
- Modify: `tools/semanal/equipes-alocaveis.js`
- Test: `test/semanal-equipes-alocaveis.test.js`

**Interfaces:**
- Consumes: `agruparPorVeiculo` (Task 1).
- Produces: cada objeto de `equipesDoQuadro(...).equipes` ganha três campos novos — `veiculoGrupo` (chave do grupo, string), `veiculoRotulo` (texto para a tela, ex. `'ELE8E91'` ou `'Carona ID 322'`), `companheiros` (array de IDs ALOCÁVEIS do mesmo grupo, sem a própria; `[]` quando não há).

- [ ] **Step 1: Write the failing test**

O `CSV_EQ` do arquivo tem placas todas distintas. Acrescente ao FIM de `test/semanal-equipes-alocaveis.test.js`:

```javascript
// --- grupos de veículo ------------------------------------------------------

// Mesmo cabeçalho do CSV_EQ acima. A 4 tem placa; a 91 caroneia nela; a 92 tem
// 'Próprio'; a 93 é Lab (fora do quadro) e a 94 caroneia NA 93 -- a ponte por
// equipe não alocável.
const CSV_EQ_VEICULO = [
  'ID,Equipe,Habilitação,Serviços,Líderes,Veículo,Proprietário,Equipamento,Equipamento,Equipamento,Equipamento,Equipamento,Tenda - nova estrutura,Tomador,sinalização 3P,10/08/2026,11/08/2026,12/08/2026,13/08/2026,14/08/2026',
  ',,do condutor,-,-,-,-,Kit Especiais,Kit BL e PI,Kit ST,Kit SP,Kit SR,Nova estrutura,-,,SEGUNDA,TERÇA,QUARTA,QUINTA,SEXTA',
  '4,José I. Amaral,D,SM,Amaral,SUH-6F44 (D9p),Suporte,N/A,N/A,N/A,Próprio,Próprio,,CCR RioSP,RioSP,OK,OK,OK,OK,OK',
  '91,Carona Um,D,SM,Um,Carona ID 4,Suporte,N/A,N/A,N/A,N/A,N/A,,-,,OK,OK,OK,OK,OK',
  '92,Sozinha,D,SP,Sozinha,Próprio,Suporte,N/A,N/A,N/A,N/A,N/A,,-,,OK,OK,OK,OK,OK',
  '93,Lab Ponte,D,Lab,Ponte,TKF3E96 (D9p),Suporte,N/A,N/A,N/A,N/A,N/A,,-,,OK,OK,OK,OK,OK',
  '94,Carona Lab,D,SP,Lab Dois,carona ID 93,Suporte,N/A,N/A,N/A,N/A,N/A,,-,,OK,OK,OK,OK,OK',
].join('\n');

const OPCOES_VEICULO = {
  ano: 2026, mes: 8, semana: { inicio: 20675, fim: 20679 }, osParaSup: {},
};

test('equipe com carona ganha companheiros, rótulo do grupo e chave', () => {
  const { equipes } = equipesDoQuadro(CSV_EQ_VEICULO, OPCOES_VEICULO);
  const quatro = equipes.find((e) => e.id === '4');
  const noventaEUm = equipes.find((e) => e.id === '91');
  assert.deepStrictEqual(quatro.companheiros, ['91']);
  assert.deepStrictEqual(noventaEUm.companheiros, ['4']);
  assert.strictEqual(quatro.veiculoGrupo, noventaEUm.veiculoGrupo);
  assert.strictEqual(quatro.veiculoRotulo, 'SUH6F44');
});

test('equipe "Próprio" fica sem companheiros', () => {
  const { equipes } = equipesDoQuadro(CSV_EQ_VEICULO, OPCOES_VEICULO);
  assert.deepStrictEqual(equipes.find((e) => e.id === '92').companheiros, []);
});

test('a equipe FORA DO QUADRO serve de ponte mas não aparece em companheiros', () => {
  // A 94 caroneia na 93 (Lab). O veículo é o mesmo, então o grupo existe -- mas
  // a 93 não é alocável e não pode virar cartão arrastável nenhum.
  const { equipes } = equipesDoQuadro(CSV_EQ_VEICULO, OPCOES_VEICULO);
  const noventaEQuatro = equipes.find((e) => e.id === '94');
  assert.ok(noventaEQuatro, '94 é SP, tem de estar no quadro');
  assert.deepStrictEqual(noventaEQuatro.companheiros, []);
  assert.strictEqual(noventaEQuatro.veiculoRotulo, 'TKF3E96');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/semanal-equipes-alocaveis.test.js`
Expected: FAIL — `companheiros` é `undefined`.

- [ ] **Step 3: Write minimal implementation**

Em `tools/semanal/equipes-alocaveis.js`, acrescente o require na linha 3 (logo depois dos dois existentes, mantendo a forma exata que `transformaModulo` reconhece):

```javascript
const { agruparPorVeiculo } = require('./grupos-veiculo.js');
```

Dentro de `equipesDoQuadro`, LOGO DEPOIS de `var diasDaSemana = ...`, acrescente:

```javascript
  // Os grupos saem do roster INTEIRO -- incluindo o que vai para foraDoQuadro.
  // Duas equipes alocáveis podem se ligar pela carona numa Lab, e o veículo é o
  // mesmo. `roster` e `grade` são index-alinhados (é o que a leitura de
  // camposDoPopup já assume logo abaixo).
  var grupos = agruparPorVeiculo(roster.map(function (bruta, indice) {
    return { id: bruta.id, veiculo: String((grade[indice] || [])[COL_VEICULO] || '').trim() };
  }));
```

Dentro do `equipes.push({...})`, acrescente duas propriedades depois de `popup: camposDoPopup(linha),`:

```javascript
      veiculoGrupo: grupos.grupoPorId[String(bruta.id)] || null,
      veiculoRotulo: grupos.rotuloDoGrupo[grupos.grupoPorId[String(bruta.id)]] || null,
```

E, LOGO ANTES do `return { equipes: equipes, foraDoQuadro: foraDoQuadro };`, acrescente:

```javascript
  // companheiros só pode ser calculado depois do laço: é o grupo do veículo
  // podado para quem ficou ALOCÁVEL. A equipe que serviu de ponte (Lab, TST)
  // some daqui de propósito -- ela não vira cartão em lugar nenhum.
  var alocaveis = {};
  equipes.forEach(function (e) { alocaveis[String(e.id)] = true; });
  equipes.forEach(function (e) {
    var membros = grupos.membrosDoGrupo[e.veiculoGrupo] || [];
    e.companheiros = membros.filter(function (id) {
      return id !== String(e.id) && alocaveis[id];
    });
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/semanal-equipes-alocaveis.test.js`
Expected: PASS.

Depois rode a suíte inteira para provar que nada quebrou:
Run: `node --test test/*.test.js`
Expected: 0 falhas.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/equipes-alocaveis.js test/semanal-equipes-alocaveis.test.js
git commit -m "Alocacao: cada equipe carrega o grupo de veiculo e as companheiras"
```

---

### Task 4: `aplicarMovimento` move o grupo inteiro

**Files:**
- Modify: `tools/semanal/render-semanal.js` (`BUNDLE_ARQUIVOS` ~linha 826-839; a lista de `var X = MODULOS[...]` ~linha 907; `aplicarMovimento` ~linha 1376)
- Test: `test/semanal-alocacao-interacao.test.js`

**Interfaces:**
- Consumes: `destinoDoGrupo` (Task 2), `companheiros`/`disponivel` nas equipes (Task 3).
- Produces: `aplicarMovimento(equipeId, sup, coluna)` continua devolvendo `true`/`false` (aplicou / recusou) e continua sendo o único funil dos dois gestos.

- [ ] **Step 1: Write the failing test**

O `CSV_EQ_TESTE` do arquivo (linha ~66) tem `VEIC-4` e `VEIC-59` na coluna Veículo — nenhum dos dois casa placa nem carona, então hoje não existe grupo nenhum ali. Troque a linha da equipe 4 e acrescente a equipe 77 (SP, disponível o período todo, caroneando na 4):

```javascript
  '4,Equipe 4,D,SP,Amaral,SUH-6F44,Suporte,N/A,N/A,N/A,N/A,N/A,,Tomador X,,'
    + linhaDias((_e, i) => (i === 0 ? `RioSP (${OS_SUP_A})` : 'OK')),
  '59,Equipe 59,D,SP,Paulo,VEIC-59,Suporte,N/A,N/A,N/A,N/A,N/A,,Tomador X,,'
    + linhaDias(() => 'Férias'),
  '77,Equipe 77,D,SP,Carona,Carona ID 4,Suporte,N/A,N/A,N/A,N/A,N/A,,Tomador X,,'
    + linhaDias(() => 'OK'),
```

**Placa sem vírgula de propósito:** o texto real é `SUH-6F44 (D, Munck, 2p)`, e a vírgula dentro dele só sobrevive entre aspas no CSV. `SUH-6F44` casa `RE_PLACA` igual e evita que a fixture dependa do parser de aspas para provar a trava. A cobertura da placa com parênteses fica na Task 1, onde é o assunto.

Acrescente ao FIM do arquivo:

```javascript
test('a trava leva a companheira de veículo junto', async () => {
  const cliente = montarClienteAlocacao();
  await cliente.selecionarSemanaAlocacao(1);
  // A 4 e a 77 dividem o veículo. Mover a 4 para SUP-B move a 77 também.
  assert.strictEqual(cliente.aplicarMovimento('4', 'SUP-B', 'SP'), true);
  assert.deepStrictEqual(normalizar(cliente.ESTADO_ALOCACAO.alocacao['4']), { sup: 'SUP-B', coluna: 'SP' });
  assert.deepStrictEqual(normalizar(cliente.ESTADO_ALOCACAO.alocacao['77']), { sup: 'SUP-B', coluna: 'SP' });
});

test('devolver ao pool devolve a companheira também', async () => {
  const cliente = montarClienteAlocacao();
  await cliente.selecionarSemanaAlocacao(1);
  cliente.aplicarMovimento('4', 'SUP-B', 'SP');
  assert.strictEqual(cliente.aplicarMovimento('4', '', ''), true);
  assert.strictEqual(cliente.ESTADO_ALOCACAO.alocacao['4'], undefined);
  assert.strictEqual(cliente.ESTADO_ALOCACAO.alocacao['77'], undefined);
});

test('a companheira INDISPONÍVEL não é arrastada pela trava', async () => {
  const cliente = montarClienteAlocacao();
  await cliente.selecionarSemanaAlocacao(1);
  // A 59 está de férias o período inteiro. Forçamos ela para dentro do grupo
  // da 4 no estado já montado -- é o caminho mais curto para provar a regra
  // sem um terceiro CSV.
  const equipes = cliente.ESTADO_ALOCACAO.equipes;
  equipes.find((e) => e.id === '4').companheiros = ['77', '59'];
  equipes.find((e) => e.id === '59').companheiros = ['4', '77'];
  assert.strictEqual(equipes.find((e) => e.id === '59').disponivel, false, 'a 59 está de férias');

  cliente.aplicarMovimento('4', 'SUP-B', 'SP');
  assert.strictEqual(cliente.ESTADO_ALOCACAO.alocacao['59'], undefined,
    'indisponível fica onde está -- a trava não é a porta dos fundos da recusa');
});

test('gesto recusado não move NINGUÉM do grupo', async () => {
  const cliente = montarClienteAlocacao();
  await cliente.selecionarSemanaAlocacao(1);
  // A 4 é SP: a coluna ST está fora do conjunto dela.
  assert.strictEqual(cliente.aplicarMovimento('4', 'SUP-B', 'ST'), false);
  assert.strictEqual(cliente.ESTADO_ALOCACAO.alocacao['4'], undefined);
  assert.strictEqual(cliente.ESTADO_ALOCACAO.alocacao['77'], undefined);
});
```

`montarClienteAlocacao()` e `normalizar()` já existem no arquivo (linhas ~104 e ~138) — o sandbox devolvido É o objeto onde `aplicarMovimento`/`ESTADO_ALOCACAO` moram, como os testes existentes já fazem. Não crie helper novo.

Os testes existentes deste arquivo semeiam a alocação a partir do mesmo CSV: rode-os depois de mudar o CSV e ajuste as asserções que passarem a contar a equipe 77 — ela é uma equipe SP nova no pool, então contagens de cartão/pool mudam de propósito.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/semanal-alocacao-interacao.test.js`
Expected: FAIL — a 77 não vai junto (`alocacao['77']` é `undefined`).

- [ ] **Step 3: Write minimal implementation**

**3a.** Em `BUNDLE_ARQUIVOS` (`tools/semanal/render-semanal.js`), troque a linha final do bloco da Alocação por:

```javascript
  // grupos-veiculo.js (2026-08-12) não consome nada same-dir (é matemática pura
  // sobre a coluna Veículo da aba EQ), mas equipes-alocaveis.js o consome --
  // por isso vem ANTES dele. A ordem desta lista é o contrato de dependência.
  'grupos-veiculo.js', 'equipes-alocaveis.js', 'compute-alocacao.js', 'alocacao-sheet.js', 'render-aba-alocacao.js',
```

**3b.** Junto de `var EquipesAlocaveis = MODULOS['equipes-alocaveis.js'];` (~linha 907), acrescente:

```javascript
var GruposVeiculo = MODULOS['grupos-veiculo.js'];
```

**3c.** Substitua o corpo de `aplicarMovimento` (mantendo o bloco de comentário que já existe acima dela e ACRESCENTANDO o parágrafo novo):

```javascript
// Recusa fora do conjunto de colunas da equipe e equipe indisponível. Devolve
// true quando aplicou -- é o que o handler de soltura usa para decidir se
// redesenha ou mostra o motivo. Repare que NÃO consulta a grade/tendência: uma
// célula hachurada (sem tendência), mas dentro do conjunto de colunas da
// equipe, é aceita igual -- é o caso de "antecipar carteira" que a aba existe
// para servir (Decisão 6 do spec de 2026-08-10).
//
// TRAVA DE VEÍCULO (2026-08-12): quem decide o que se move é destinoDoGrupo
// (grupos-veiculo.js), função pura -- equipes que dividem veículo não podem
// ficar em SUPs diferentes, então o destino do gesto vale para o grupo inteiro,
// pool inclusive. Esta função virou o laço que APLICA a lista. As duas recusas
// continuam existindo, agora dentro dela, e recusa move zero equipes.
//
// A trava mora aqui de propósito: é o funil por onde os DOIS gestos (arrasto e
// clique-clique) já passam. Espalhá-la pelos handlers deixaria um caminho sem
// ela. E semearDoRealizado/limparAlocacao NÃO passam por aqui, também de
// propósito (Decisão 4 do spec): a semeadura é o retrato do realizado, não um
// plano a validar.
function aplicarMovimento(equipeId, sup, coluna) {
  var movimentos = GruposVeiculo.destinoDoGrupo(
    ESTADO_ALOCACAO.equipes, ESTADO_ALOCACAO.alocacao, equipeId, sup, coluna);
  if (!movimentos.length) return false;

  movimentos.forEach(function (m) {
    if (!m.sup) delete ESTADO_ALOCACAO.alocacao[m.id];
    else ESTADO_ALOCACAO.alocacao[m.id] = { sup: m.sup, coluna: m.coluna };
  });
  // Invalida qualquer carregarAlocacaoDaSemana em voo -- ver o comentário
  // grande em ESTADO_ALOCACAO. UMA vez para o gesto inteiro, não uma por
  // equipe: o grupo é um gesto só.
  ESTADO_ALOCACAO.geracaoAlocacao++;

  montarAbaAlocacao();
  // A gravação vem DEPOIS do redesenho, e não é esperada: a tela nunca trava
  // por causa da rede, e uma falha não desfaz o que o usuário acabou de ver.
  // Uma gravação por equipe movida, mesmo laço de semearDoRealizado.
  var chave = chaveSemanaAtual();
  movimentos.forEach(function (m) {
    clienteAlocacao().gravar({
      chaveSemana: chave, equipeId: m.id,
      sup: m.sup || null, coluna: m.coluna || null,
    }).then(function () { montarAbaAlocacao(); });
  });
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/semanal-alocacao-interacao.test.js`
Expected: PASS.

Run: `node --test test/*.test.js`
Expected: 0 falhas.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/render-semanal.js test/semanal-alocacao-interacao.test.js
git commit -m "Alocacao: o gesto move o grupo do veiculo inteiro, pool inclusive"
```

---

### Task 5: As companheiras acendem na seleção e no arrasto

**Files:**
- Modify: `tools/semanal/render-semanal.js` (`destacarCelulasCompativeis` ~1659, `limparDestaquesAlocacao` ~1677, os dois pontos que as chamam: `pointerdown` ~1792 e o `click` de seleção)
- Modify: `test/helpers/dom-falso-semanal.js` (resolver `[data-equipe="..."]` no `querySelectorAll`)
- Test: `test/semanal-alocacao-interacao.test.js`

**Interfaces:**
- Consumes: `equipe.companheiros` (Task 3).
- Produces: a classe CSS `cartao-companheiro` nos cartões das companheiras enquanto o gesto dura. Task 6 estiliza essa classe.

- [ ] **Step 1: Write the failing test**

Primeiro, o DOM falso precisa saber resolver o seletor por `data-equipe` — hoje ele devolve `[]` para tudo que não seja `.celula-alocacao` ou a tabela de Alertas, e um teste de destaque escrito contra ele **passaria vazio**. Em `test/helpers/dom-falso-semanal.js`, acrescente ao objeto devolvido, junto de `registrarCelulasAlocacao`:

```javascript
    // Os cartões que os testes de destaque querem observar. Mesmo motivo de
    // registrarCelulasAlocacao: sem isto querySelectorAll devolve [] e o teste
    // de destaque das companheiras passaria VAZIO.
    registrarCartoesAlocacao(ids) {
      cartoesAlocacao.length = 0;
      (ids || []).forEach((id) => {
        cartoesAlocacao.push(comClassList({
          getAttribute: (attr) => (attr === 'data-equipe' ? String(id) : null),
          equipeId: String(id),
        }));
      });
      return cartoesAlocacao;
    },
    cartaoAlocacao(id) {
      return cartoesAlocacao.find((c) => c.equipeId === String(id)) || null;
    },
```

Declare `const cartoesAlocacao = [];` junto de `const celulasAlocacao = [];`, e no `querySelectorAll` acrescente, ANTES do `if (sel !== '#tabela-alertas tbody tr') return [];`:

```javascript
      var porEquipe = /^\[data-equipe="([^"]+)"\]$/.exec(sel);
      if (porEquipe) return cartoesAlocacao.filter((c) => c.equipeId === porEquipe[1]);
```

Agora o teste, ao fim de `test/semanal-alocacao-interacao.test.js`:

```javascript
test('ao começar o gesto, os cartões das companheiras de veículo acendem', async () => {
  const cliente = montarClienteAlocacao();
  await cliente.selecionarSemanaAlocacao(1);
  cliente.document.registrarCelulasAlocacao(['SP']);
  cliente.document.registrarCartoesAlocacao(['4', '77', '59']);

  const equipeQuatro = cliente.ESTADO_ALOCACAO.equipes.find((e) => e.id === '4');
  cliente.destacarCelulasCompativeis(equipeQuatro.colunas, false, equipeQuatro.companheiros);

  assert.ok(cliente.document.cartaoAlocacao('77').classList.contains('cartao-companheiro'),
    'a 77 divide o veículo da 4');
  assert.ok(!cliente.document.cartaoAlocacao('59').classList.contains('cartao-companheiro'),
    'a 59 não é do grupo');
});

test('o destaque das companheiras morre em limparDestaquesAlocacao -- o único ponto de saída', async () => {
  const cliente = montarClienteAlocacao();
  await cliente.selecionarSemanaAlocacao(1);
  cliente.document.registrarCelulasAlocacao(['SP']);
  cliente.document.registrarCartoesAlocacao(['4', '77']);

  const equipeQuatro = cliente.ESTADO_ALOCACAO.equipes.find((e) => e.id === '4');
  cliente.destacarCelulasCompativeis(equipeQuatro.colunas, false, equipeQuatro.companheiros);
  cliente.limparDestaquesAlocacao();

  assert.ok(!cliente.document.cartaoAlocacao('77').classList.contains('cartao-companheiro'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/semanal-alocacao-interacao.test.js`
Expected: FAIL — a classe `cartao-companheiro` nunca é adicionada.

- [ ] **Step 3: Write minimal implementation**

Em `tools/semanal/render-semanal.js`, troque as duas funções:

```javascript
function destacarCelulasCompativeis(colunas, podeDevolver, companheiros) {
  var celulas = document.querySelectorAll('.celula-alocacao');
  for (var i = 0; i < celulas.length; i++) {
    var coluna = celulas[i].getAttribute ? celulas[i].getAttribute('data-coluna') : null;
    if (colunas.indexOf(coluna) !== -1) celulas[i].classList.add('celula-alvo');
    else celulas[i].classList.add('celula-inerte');
  }
  // As companheiras de veículo (trava de 2026-08-12): quem vai junto tem de
  // aparecer ANTES da soltura, não depois. O cartão de uma equipe polivalente
  // se repete em cada grupo do pool, então acende TODAS as instâncias dele.
  (companheiros || []).forEach(function (id) {
    var cartoes = document.querySelectorAll('[data-equipe="' + id + '"]');
    for (var j = 0; j < cartoes.length; j++) cartoes[j].classList.add('cartao-companheiro');
  });
  if (!podeDevolver) return;
  var pool = document.querySelector('.pool-alocacao');
  if (pool) pool.classList.add('pool-alvo');
}

// Chamava-se limparDestaqueCelulas, e o nome virou mentira em 2026-08-11,
// quando o pool passou a acender junto -- e mais ainda em 2026-08-12, com as
// companheiras de veículo. É chamada dos CINCO pontos que encerram um gesto, e
// todos querem a limpeza COMPLETA: limpar qualquer uma dessas marcas em outro
// lugar a deixaria acesa para sempre em pelo menos um dos quatro caminhos de
// saída do arrasto (soltura aceita, recusada, pointercancel, ou solta fora de
// tudo). Ver o comentário de encerrarArrastoAlocacao.
function limparDestaquesAlocacao() {
  var celulas = document.querySelectorAll('.celula-alocacao');
  for (var i = 0; i < celulas.length; i++) {
    celulas[i].classList.remove('celula-alvo');
    celulas[i].classList.remove('celula-inerte');
  }
  var companheiros = document.querySelectorAll('.cartao-companheiro');
  for (var j = 0; j < companheiros.length; j++) {
    companheiros[j].classList.remove('cartao-companheiro');
  }
  var pool = document.querySelector('.pool-alocacao');
  if (pool) pool.classList.remove('pool-alvo');
}
```

No DOM falso, `querySelectorAll('.cartao-companheiro')` precisa devolver os cartões acesos. Acrescente ao `querySelectorAll` do helper, junto do seletor por `data-equipe`:

```javascript
      if (sel === '.cartao-companheiro') return cartoesAlocacao.filter((c) => c.classes.has('cartao-companheiro'));
```

Nos DOIS pontos que chamam `destacarCelulasCompativeis`, passe as companheiras. No `pointerdown` (~1792):

```javascript
    destacarCelulasCompativeis(equipe.colunas || [], !!ESTADO_ALOCACAO.alocacao[equipeId], equipe.companheiros || []);
```

Faça a mesma troca na chamada de dentro do handler de `click` que nasce a seleção (procure a outra ocorrência de `destacarCelulasCompativeis(` no arquivo — são duas ao todo).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/semanal-alocacao-interacao.test.js`
Expected: PASS.

Run: `node --test test/*.test.js`
Expected: 0 falhas.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/render-semanal.js test/helpers/dom-falso-semanal.js test/semanal-alocacao-interacao.test.js
git commit -m "Alocacao: as companheiras de veiculo acendem durante o gesto"
```

---

### Task 6: O selo no cartão, o estado de conflito e o CSS

**Files:**
- Modify: `tools/semanal/render-aba-alocacao.js` (`renderCartaoEquipe` ~258, `renderAbaAlocacao` ~553)
- Modify: `tools/semanal/render-semanal.js` (`CSS_SEMANAL`, perto de `.cartao-selo-poli` ~linha 521)
- Modify: `tools/semanal/snapshot-alocacao.js` (`EQUIPES`, `ESTADOS_COBERTOS`)
- Test: `test/semanal-render-aba-alocacao.test.js`

**Interfaces:**
- Consumes: `veiculoRotulo`/`companheiros` nas equipes (Task 3), `conflitosDeVeiculo` (Task 2).
- Produces: markup com `cartao-selo-veiculo` (selo permanente) e `cartao-conflito-veiculo` (estado de conflito herdado).

**ANTES DE COMEÇAR:** invoque a skill `design-kanban-alocacao-equipes` — ela traz a paleta, os estados e o espaçamento desta aba, e evita reinventar cor que já existe.

- [ ] **Step 1: Write the failing test**

Primeiro, acrescente `renderCartaoEquipe` ao require do topo do arquivo (o módulo já o exporta):

```javascript
const { renderAbaAlocacao, renderCartaoEquipe, corDaColuna } = require('../tools/semanal/render-aba-alocacao.js');
```

Depois acrescente ao FIM de `test/semanal-render-aba-alocacao.test.js`:

```javascript
// --- trava de veículo -------------------------------------------------------

test('o cartão traz o selo do veículo com o tamanho do grupo', () => {
  const equipe = {
    id: '660', lider: 'Fulano', nome: 'Fulano de Tal', colunas: ['ST'],
    polivalente: false, disponivel: true, diasDisponiveis: 5, diasDaSemana: 7,
    popup: { veiculo: 'ELE-8E91 (9 p)' },
    veiculoGrupo: 'PLACA:ELE8E91', veiculoRotulo: 'ELE8E91',
    companheiros: ['644', '651', '656'],
  };
  const html = renderCartaoEquipe(equipe, null, null, false, 'ST');
  assert.match(html, /cartao-selo-veiculo/);
  assert.match(html, /ELE8E91/);
  assert.match(html, /4/, 'o selo diz quantas equipes dividem o veículo');
});

test('equipe sem companheiras NÃO ganha selo de veículo', () => {
  const equipe = {
    id: '92', lider: 'Sozinha', nome: 'Sozinha', colunas: ['SP'],
    polivalente: false, disponivel: true, diasDisponiveis: 5, diasDaSemana: 7,
    popup: { veiculo: 'Próprio' }, veiculoGrupo: 'CARONA:92', veiculoRotulo: 'Carona ID 92',
    companheiros: [],
  };
  assert.doesNotMatch(renderCartaoEquipe(equipe, null, null, false, 'SP'), /cartao-selo-veiculo/);
});

test('conflito herdado marca o cartão e nomeia quem está no outro SUP', () => {
  const equipe = {
    id: '479', lider: 'Beltrano', nome: 'Beltrano', colunas: ['SM / SM.F / SR'],
    polivalente: false, disponivel: true, diasDisponiveis: 5, diasDaSemana: 7,
    popup: { veiculo: 'UDU8J88 (D, 9p)' },
    veiculoGrupo: 'PLACA:UDU8J88', veiculoRotulo: 'UDU8J88', companheiros: ['623'],
    conflitoVeiculo: [{ id: '623', sup: 'SUP-DOIS' }],
  };
  const html = renderCartaoEquipe(equipe, null, null, false, 'SM / SM.F / SR');
  assert.match(html, /cartao-conflito-veiculo/);
  assert.match(html, /623/);
  assert.match(html, /SUP-DOIS/);
});

test('renderAbaAlocacao calcula o conflito e ele chega ao cartão sem o chamador fazer nada', () => {
  // Duas equipes do mesmo veículo alocadas em SUPs diferentes: é o estado
  // herdado que a semeadura produz e que a trava NÃO corrige.
  const equipes = [
    {
      id: '479', lider: 'A', nome: 'A', colunas: ['SP'], polivalente: false, disponivel: true,
      diasDisponiveis: 5, diasDaSemana: 7, popup: {}, veiculoGrupo: 'PLACA:UDU8J88',
      veiculoRotulo: 'UDU8J88', companheiros: ['623'],
    },
    {
      id: '623', lider: 'B', nome: 'B', colunas: ['SP'], polivalente: false, disponivel: true,
      diasDisponiveis: 5, diasDaSemana: 7, popup: {}, veiculoGrupo: 'PLACA:UDU8J88',
      veiculoRotulo: 'UDU8J88', companheiros: ['479'],
    },
  ];
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipes,
    alocacao: { 479: { sup: 'SUP-A', coluna: 'SP' }, 623: { sup: 'SUP-B', coluna: 'SP' } },
  }));
  assert.match(html, /cartao-conflito-veiculo/);
});
```

`registros()` e `opcoes(extra)` já existem no arquivo (linhas ~11 e ~20) — `opcoes` faz `Object.assign` do extra por cima do padrão, então passar `equipes`/`alocacao` substitui os dois. Não crie fixture nova.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/semanal-render-aba-alocacao.test.js`
Expected: FAIL — `cartao-selo-veiculo` não existe no markup.

- [ ] **Step 3: Write minimal implementation**

**3a.** Em `renderCartaoEquipe` (`tools/semanal/render-aba-alocacao.js`), acrescente antes da montagem do `cartao`:

```javascript
  // Trava de veículo (2026-08-12): o selo só aparece quando há companheira de
  // verdade -- grupo de uma equipe só é o caso comum (63 das 117), e um selo
  // ali seria ruído puro.
  var companheiros = equipe.companheiros || [];
  var temGrupo = companheiros.length > 0;
  var conflito = equipe.conflitoVeiculo || null;
```

Acrescente `+ (conflito ? ' cartao-conflito-veiculo' : '')` à lista de classes do `div.cartao-equipe`, e acrescente o selo logo DEPOIS do selo de polivalente:

```javascript
    + (temGrupo
      ? '<span class="cartao-selo-veiculo" title="' + escapeHtml(String(companheiros.length + 1))
        + ' equipes no veículo ' + escapeHtml(equipe.veiculoRotulo || '—') + '">🚐 '
        + escapeHtml(String(companheiros.length + 1)) + '</span>'
      : '')
```

No `popupHtml`, depois da linha `Veículo:` já existente, acrescente:

```javascript
    + (temGrupo
      ? '<p class="popup-veiculo-grupo">Mesmo veículo (' + escapeHtml(equipe.veiculoRotulo || '—')
        + '): equipes ' + escapeHtml(companheiros.join(', '))
        + ' — andam juntas: o quadro move o grupo inteiro de uma vez.</p>'
      : '')
    + (conflito
      ? '<p class="popup-conflito-veiculo">Conflito: ' + conflito.map(function (c) {
        return escapeHtml(c.id) + ' em ' + escapeHtml(c.sup);
      }).join(', ') + '. Veio do realizado ou de uma alocação antiga — mova uma delas para resolver.</p>'
      : '')
```

**3b.** Em `renderAbaAlocacao`, LOGO DEPOIS de `var equipes = o.equipes || [];`, troque por:

```javascript
  var equipesBrutas = o.equipes || [];
  // O conflito herdado sai da alocação CRUA, nunca do resumo da grade: com o
  // filtro de SUP podando a linha, resumirAlocacao devolve sup: null para uma
  // equipe que ESTÁ alocada, e o conflito sumiria da tela sem ter sumido do
  // plano. Mesmo raciocínio da Decisão 7 de 2026-08-11 (o pool decide pela
  // alocação crua).
  //
  // A marca é anexada a uma CÓPIA rasa da equipe -- os objetos vêm de
  // ESTADO_ALOCACAO.equipes e não podem ser mutados por um render.
  var conflitos = conflitosDeVeiculo(equipesBrutas, o.alocacao || {});
  var equipes = equipesBrutas.map(function (e) {
    if (!conflitos[String(e.id)]) return e;
    var copia = {};
    Object.keys(e).forEach(function (k) { copia[k] = e[k]; });
    copia.conflitoVeiculo = conflitos[String(e.id)];
    return copia;
  });
```

Acrescente o require no topo do arquivo, na forma exata que o bundler reconhece:

```javascript
const { conflitosDeVeiculo } = require('./grupos-veiculo.js');
```

E acrescente `'grupos-veiculo.js'` como dependência de `render-aba-alocacao.js` no comentário de `BUNDLE_ARQUIVOS` (ele já vem antes na lista pela Task 4 — só o comentário precisa dizer isso).

**3c.** Em `CSS_SEMANAL` (`tools/semanal/render-semanal.js`), junto de `.cartao-selo-poli`:

```css
  /* Trava de veículo: o selo é informação permanente do cartão (quantas
     equipes dividem o carro); .cartao-companheiro é o destaque efêmero do
     gesto, e morre em limparDestaquesAlocacao. */
  .cartao-selo-veiculo { margin-left: 3px; font-size: 10px; opacity: .85; font-variant-numeric: tabular-nums; }
  .cartao-companheiro { outline: 2px dashed #4f8ff0; outline-offset: 2px; }
  .cartao-conflito-veiculo { box-shadow: inset 0 0 0 1px #d94f4f; }
  .popup-veiculo-grupo { font-size: 11px; opacity: .9; }
  .popup-conflito-veiculo { font-size: 11px; color: #f0a0a0; }
```

Use as cores que a skill `design-kanban-alocacao-equipes` documenta para "alvo" e "erro" se elas divergirem dos hex acima — `#4f8ff0` é o mesmo do `.pool-alvo`, o que mantém "alvo do gesto" com uma cor só.

**3d.** Em `tools/semanal/snapshot-alocacao.js`, acrescente `veiculoGrupo`/`veiculoRotulo`/`companheiros` a pelo menos duas equipes de `EQUIPES` (uma com grupo, uma em conflito) e as duas marcas novas a `ESTADOS_COBERTOS`:

```javascript
  'cartao-selo-veiculo': 'selo de equipes que dividem veículo',
  'cartao-conflito-veiculo': 'conflito herdado: mesmo veículo em SUPs diferentes',
```

Para o conflito aparecer, as duas equipes do grupo precisam estar em SUPs diferentes na `GRADE` sintética **e** a alocação passada ao render precisa refleti-lo.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/semanal-render-aba-alocacao.test.js`
Expected: PASS.

Run: `node tools/semanal/snapshot-alocacao.js`
Expected: imprime a contagem de estados visuais, agora com os dois novos, e NÃO falha.

Run: `node --test test/*.test.js`
Expected: 0 falhas.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/render-aba-alocacao.js tools/semanal/render-semanal.js tools/semanal/snapshot-alocacao.js test/semanal-render-aba-alocacao.test.js
git commit -m "Alocacao: selo do veiculo no cartao e marca do conflito herdado"
```

---

### Task 7: Reconstruir, sincronizar `docs/` e documentar

**Files:**
- Modify: `CLAUDE.md` (seção `### Aba Alocação Equipes`)
- Build: `dist/planejamento-semanal.html` → `docs/planejamento-semanal.html`

**Interfaces:**
- Consumes: tudo das Tasks 1–6.
- Produces: build sincronizado e o conhecimento durável no `CLAUDE.md`.

**NÃO PUBLIQUE.** Sem `git push`, sem deploy. A publicação é da sessão que verifica o trabalho, depois das revisões.

- [ ] **Step 1: Reconstruir**

```bash
ORCAMENTO_SENHA="$ORCAMENTO_SENHA" node tools/semanal/build-dashboard.js
```

A senha vem do dono do projeto por variável de ambiente e **nunca** é escrita em arquivo do repositório. Se `ORCAMENTO_SENHA` não estiver definida no ambiente, PARE e peça — não invente valor nem leia de arquivo.

- [ ] **Step 2: Sincronizar `docs/`**

```bash
cp dist/planejamento-semanal.html docs/planejamento-semanal.html
```

O Pages serve `/docs`, não `/dist` — sem esta cópia o site continua servindo o build antigo. `test/publicacao-docs-sincronizado.test.js` trava isso.

- [ ] **Step 3: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: 0 falhas, incluindo `publicacao-docs-sincronizado`.

Se `publicacao-docs-sincronizado` falhar por diferença de fim de linha, **não** faça `git checkout`/`restore` de só um dos dois arquivos (`core.autocrlf=true` sem `.gitattributes` inverte a terminação e quebra a comparação byte a byte sem mudar conteúdo) — regenere os dois com o build e copie de novo.

- [ ] **Step 4: Documentar no `CLAUDE.md`**

Acrescente ao fim da seção `### Aba Alocação Equipes`:

```markdown
**Trava de veículo (2026-08-12)** — spec:
`docs/superpowers/specs/2026-08-12-alocacao-trava-veiculo-design.md`, plano:
`docs/superpowers/plans/2026-08-12-alocacao-trava-veiculo.md`. Equipes que dividem
veículo não podem ficar em SUPs diferentes: o destino do gesto vale para o grupo
inteiro, **pool inclusive**, e a única exceção é a equipe indisponível, que nunca
é tocada.

- **O vínculo é lista de PERMISSÃO** (`tools/semanal/grupos-veiculo.js`): só placa
  (`/^([A-Za-z]{3})[ -]?([0-9][A-Za-z0-9]{3})/`, normalizada — o descritivo entre
  parênteses varia: `UDU8J88 (D, 9p)` vs `(D, 9 p)`, e **3 grupos reais só existem**
  por causa disso) e `Carona ID N` apontando para um ID **presente no roster**.
  `Próprio` (16 equipes), vazio (10), `afastado`, `D?`, `Suporte` não vinculam nada.
  Com lista de exclusão, um texto novo digitado em duas linhas prenderia as duas
  equipes em silêncio.
- **O fecho é transitivo e roda sobre o roster INTEIRO**, incluindo Lab/TST: duas
  equipes alocáveis podem se ligar pela carona numa terceira que não é alocável.
  A ponte some de `companheiros`. Medido em 2026-08-12: **21 grupos, 54 das 117
  equipes**; o maior é `{644, 651, 656, 660}`.
- **A trava vive em `aplicarMovimento`**, o funil dos dois gestos. `destinoDoGrupo`
  é pura e decide; `aplicarMovimento` só aplica. **`semearDoRealizado` e
  `limparAlocacao` não passam por ela**, de propósito — a semeadura é o retrato do
  realizado, não um plano a validar, e **2 dos 21 grupos já nascem em SUPs
  diferentes** (`{479, 604, 623}`, `{353, 513, 629}`). Esse conflito herdado é
  MARCADO no cartão (`conflitosDeVeiculo`), nunca corrigido.
- **O conflito sai da alocação CRUA, nunca do resumo da grade** — com o filtro de
  SUP podando a linha, `resumirAlocacao` devolve `sup: null` para equipe alocada, e
  o conflito sumiria da tela sem ter sumido do plano.
- **`.cartao-companheiro` morre em `limparDestaquesAlocacao`**, junto de
  `celula-alvo`/`pool-alvo` — limpar em outro lugar deixaria o destaque preso em um
  dos quatro caminhos de saída do arrasto.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md dist/planejamento-semanal.html docs/planejamento-semanal.html
git commit -m "Rebuild: trava de deslocamento por veiculo compartilhado"
```
