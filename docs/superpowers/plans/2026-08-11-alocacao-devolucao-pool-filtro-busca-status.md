# Aba Alocação Equipes: devolução, pool por tipologia, filtro, busca e status — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir dois bugs da aba Alocação Equipes (filtro de SUP que não filtra, status da célula invertido) e acrescentar três recursos (devolução ao pool por arrasto, pool agrupado por tipologia, busca de equipe).

**Architecture:** Tudo dentro da aba. `compute-alocacao.js` ganha a poda por filtro e um classificador de célula; `render-aba-alocacao.js` reescreve o pool e a célula; `render-semanal.js` ganha o alvo de soltura e o campo de busca. Nenhuma mudança em persistência, no Apps Script ou em qualquer conta — a devolução reaproveita `aplicarMovimento(id, '', '')`, que já apaga.

**Tech Stack:** Node puro, sem dependências. `node --test`. Módulos duais Node+navegador (`var`/`function`, `require` same-dir na forma que `tools/comum/browser-bundle.js` reconhece).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-11-alocacao-devolucao-e-pool-por-tipologia-design.md`. Em conflito, o spec manda.
- **Sem dependências novas.** Não existe `npm install` neste repositório e não vai passar a existir.
- **Módulos duais** (`compute-alocacao.js`, `render-aba-alocacao.js`, `equipes-alocaveis.js`): `var` e `function`, nunca `const`/`let`/arrow no escopo do módulo, e `require('./x.js')` só na forma literal same-dir.
- **Crase dentro de `SCRIPT_CLIENTE_SEMANAL`/`CSS_SEMANAL` trunca o script inteiro em silêncio.** Ao editar esses template literals em `render-semanal.js`, escape toda crase (`` \` ``). O sintoma aparece longe: teste de navegador falhando com `montarDashboard is not defined`.
- **`ROTULO_SITUACAO`/`CLASSE_SITUACAO` são compartilhados** entre a célula e o resumo por equipe. `livre` significa "no pool" do lado da equipe — **nunca renomear**.
- **Não tocar** em `aplicarMovimento`, `alocacao-sheet.js`, `apps-script-alocacao.gs`, nem em qualquer número (tendência, carteira, capacidade).
- **Rodar a suíte inteira** (`node --test test/*.js`) antes de cada commit, não só o arquivo tocado. Baseline atual: **1017 passam, 0 falham**.
- **Não construir nem publicar** em nenhuma tarefa a não ser a Task 6.

---

### Task 1: Status da célula — corrigir a inversão e rotular a Tendência

Implementa a Decisão 9 do spec. É a menor e a mais isolada; vai primeiro para o resto ser revisado em cima de uma célula já correta.

**Files:**
- Modify: `tools/semanal/compute-alocacao.js` (novo `classificarCelula`, e o `module.exports` no fim)
- Modify: `tools/semanal/render-aba-alocacao.js` (`ROTULO_SITUACAO`, `CLASSE_SITUACAO`, `renderCelula`)
- Modify: `tools/semanal/render-semanal.js` (uma regra de CSS, perto de `.celula-status`)
- Test: `test/semanal-compute-alocacao.test.js`, `test/semanal-render-aba-alocacao.test.js`

**Interfaces:**
- Consumes: `classificarOcupacao(ocupacao)` e `FAIXA_OCUPACAO` de `compute-alocacao.js` (já exportados).
- Produces: `classificarCelula(tendencia, capacidadeAlocada) -> 'livre'|'sem-equipe'|'folga'|'equilibrada'|'sobrecarregada'`, exportado por `compute-alocacao.js`. A Task 4 e a Task 5 não dependem dela; ninguém mais consome.

- [ ] **Step 1: Escrever os testes que falham (a propriedade primeiro)**

Acrescente ao FIM de `test/semanal-compute-alocacao.test.js`:

```js
const { classificarCelula } = require('../tools/semanal/compute-alocacao.js');

test('classificarCelula: capacidade abaixo da tendência é SOBRECARREGADA, não folga', () => {
  // O bug relatado em 2026-08-11: a célula mostrava "Com folga · saldo -50".
  assert.strictEqual(classificarCelula(100, 50), 'sobrecarregada');
});

test('classificarCelula: capacidade acima da tendência é FOLGA, não sobrecarga', () => {
  assert.strictEqual(classificarCelula(100, 150), 'folga');
});

test('classificarCelula: capacidade igual à tendência é equilibrada', () => {
  assert.strictEqual(classificarCelula(100, 100), 'equilibrada');
  // As bordas da faixa 0,85..1,05, vistas como tendência/capacidade.
  assert.strictEqual(classificarCelula(100, 100 / 0.85), 'equilibrada');
  assert.strictEqual(classificarCelula(100, 100 / 1.05), 'equilibrada');
});

test('classificarCelula: tendência sem nenhuma equipe é "sem-equipe"', () => {
  assert.strictEqual(classificarCelula(100, 0), 'sem-equipe');
  assert.strictEqual(classificarCelula(100, null), 'sem-equipe');
});

test('classificarCelula: sem tendência não há o que cobrir -- neutro', () => {
  assert.strictEqual(classificarCelula(0, 50), 'livre');
  assert.strictEqual(classificarCelula(null, 0), 'livre');
});

// O teste que trava a CLASSE do bug, e não dois exemplos dele: o rótulo não
// pode contradizer o sinal do saldo, em nenhum ponto da faixa.
test('PROPRIEDADE: o status nunca contradiz o sinal do saldo', () => {
  const tendencia = 100;
  for (let cap = 1; cap <= 300; cap++) {
    const s = classificarCelula(tendencia, cap);
    const saldo = cap - tendencia;
    if (saldo < 0) {
      assert.notStrictEqual(s, 'folga', `cap=${cap}: saldo ${saldo} não pode ser "folga"`);
      assert.notStrictEqual(s, 'livre', `cap=${cap}: saldo ${saldo} não pode ser "livre"`);
    }
    if (saldo > 0) {
      assert.notStrictEqual(s, 'sobrecarregada', `cap=${cap}: saldo +${saldo} não pode ser "sobrecarregada"`);
    }
  }
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/semanal-compute-alocacao.test.js`
Expected: FAIL — `classificarCelula is not a function` em todos os casos novos.

- [ ] **Step 3: Implementar `classificarCelula`**

Em `tools/semanal/compute-alocacao.js`, logo DEPOIS de `classificarOcupacao`:

```js
// A situação de uma CÉLULA, que não é a mesma conta da situação de uma EQUIPE.
//
// Bug corrigido em 2026-08-11: renderCelula alimentava classificarOcupacao com
// `cobertura` = capacidadeAlocada / tendencia -- a razão RECÍPROCA da ocupação
// (carga / capacidade) para a qual as faixas de FAIXA_OCUPACAO foram escritas.
// O efeito era o rótulo contradizer o saldo impresso ao lado dele: tendência
// 100 com capacidade 50 saía "Com folga · saldo -50". O comentário que
// autorizava o reaproveitamento afirmava que as duas eram "a mesma noção", e as
// duas fórmulas escritas nessa mesma frase são recíprocas.
//
// A correção não inventa faixa nova: usa as MESMAS, com o argumento na
// orientação certa -- quanto da capacidade a demanda ocupa.
function classificarCelula(tendencia, capacidadeAlocada) {
  var t = tendencia || 0;
  var c = capacidadeAlocada || 0;
  // Sem demanda não há o que cobrir. A célula existe por carteira ou por equipe
  // alocada; chamá-la de folga ou de sobrecarga seria inventar.
  if (t <= 0) return 'livre';
  // Demanda sem nenhuma equipe é divisão por zero, e é o caso MAIS descoberto
  // que existe -- não o mais tranquilo. Estado próprio, em tom de atenção.
  if (c <= 0) return 'sem-equipe';
  return classificarOcupacao(t / c);
}
```

E no `module.exports` do fim do arquivo, acrescente `classificarCelula` à primeira linha:

```js
module.exports = {
  FAIXA_OCUPACAO, diasPremissaDaSemana, capacidadeDaEquipe, ratearCarga, classificarOcupacao,
  classificarCelula,
  montarGradeAlocacao, ancoraDaSemana,
  resumirAlocacao, leituraDoSup, LEITURAS_SUP,
};
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/semanal-compute-alocacao.test.js`
Expected: PASS, inclusive a propriedade.

- [ ] **Step 5: Escrever o teste de renderização que falha**

Acrescente ao FIM de `test/semanal-render-aba-alocacao.test.js`:

```js
test('a célula mostra "Sobrecarregada" quando a capacidade não cobre a tendência', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    alocacao: { '4': { sup: 'SUP-A', coluna: 'SP' } },
  }));
  // Uma equipe de 5/7 dias não cobre 120 furos com a premissa da fixture.
  assert.match(html, /Sobrecarregada/);
  assert.doesNotMatch(html, /Com folga/);
});

test('a célula com tendência e sem equipe diz "Sem equipe"', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({ alocacao: {} }));
  assert.match(html, /Sem equipe/);
  assert.match(html, /situacao-sem-equipe/);
});

test('a Tendência da célula aparece rotulada, não como número solto', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({ alocacao: {} }));
  assert.match(html, /tend[êe]ncia\s*<\/span>|>tend[êe]ncia /i,
    'o primeiro número da célula era o único sem rótulo');
});

test('"Livre" continua existindo para a EQUIPE no pool -- a chave é compartilhada', () => {
  const { ROTULO_SITUACAO } = require('../tools/semanal/render-aba-alocacao.js');
  assert.strictEqual(ROTULO_SITUACAO.livre, 'Livre');
  assert.strictEqual(ROTULO_SITUACAO['sem-equipe'], 'Sem equipe');
});
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `node --test test/semanal-render-aba-alocacao.test.js`
Expected: FAIL — hoje sai "Com folga", não há `situacao-sem-equipe`, e a Tendência não tem rótulo.

- [ ] **Step 7: Implementar na renderização**

Em `tools/semanal/render-aba-alocacao.js`:

(a) No `require` do topo do arquivo, troque `classificarOcupacao` por `classificarCelula` **se `classificarOcupacao` não for usado em mais nenhum lugar do arquivo**; confirme com `grep -n classificarOcupacao tools/semanal/render-aba-alocacao.js` antes de remover. Se ainda for usado, importe os dois.

(b) Acrescente a chave nova aos DOIS mapas, sem tocar em `livre`:

```js
var ROTULO_SITUACAO = {
  fora: 'Fora da semana',
  livre: 'Livre',
  'sem-equipe': 'Sem equipe',
  folga: 'Com folga',
  equilibrada: 'Equilibrada',
  sobrecarregada: 'Sobrecarregada',
};

var CLASSE_SITUACAO = {
  fora: 'situacao-fora',
  livre: 'situacao-livre',
  'sem-equipe': 'situacao-sem-equipe',
  folga: 'situacao-folga',
  equilibrada: 'situacao-equilibrada',
  sobrecarregada: 'situacao-sobrecarregada',
};
```

(c) Em `renderCelula`, troque o bloco do cálculo e o `return`. O comentário ANTIGO (o que afirma que cobertura e ocupação são a mesma noção) sai — ele é a causa raiz documentada:

```js
  // A barra continua sendo COBERTURA (capacidade ÷ tendência): é o que a barra
  // desenha, e ela cresce para a direita quando sobra capacidade. Já o STATUS
  // sai de classificarCelula, que raciocina na orientação inversa -- ver o
  // comentário grande lá. As duas coisas são diferentes de propósito.
  var cobertura = c.tendencia ? c.capacidadeAlocada / c.tendencia : null;
  var situacaoCelula = classificarCelula(c.tendencia, c.capacidadeAlocada);

  return '<td class="' + classes.join(' ') + '" data-sup="' + escapeHtml(sup) + '" data-coluna="' + escapeHtml(coluna) + '">'
    + '<div class="celula-tendencia"><span class="celula-rotulo">tendência </span>' + formatarNumero(c.tendencia) + '</div>'
    + '<div class="celula-status ' + (CLASSE_SITUACAO[situacaoCelula] || '') + '">'
    + (ROTULO_SITUACAO[situacaoCelula] || situacaoCelula) + ' · saldo ' + formatarNumero(c.saldo) + '</div>'
    + renderBarraCobertura(cobertura)
    + '<div class="celula-cartoes">' + cartoes + '</div>'
    + '<span class="carteira">carteira ' + formatarNumero(c.carteira, 0) + '</span>'
    + '</td>';
```

(d) Garanta que `ROTULO_SITUACAO` está no `module.exports` do arquivo (já está — confirme).

- [ ] **Step 8: CSS do estado novo**

Em `tools/semanal/render-semanal.js`, no bloco `CSS_SEMANAL`, ao lado das regras `.situacao-*` existentes. Localize com `grep -n "situacao-sobrecarregada" tools/semanal/render-semanal.js` e acrescente na mesma vizinhança:

```css
  .situacao-sem-equipe { background: #FEF3C7; color: #92400E; }
  .celula-rotulo { color: var(--text-secondary); font-weight: 400; }
```

Se as regras `.situacao-*` existentes usarem outra convenção de cor (variáveis em vez de hex), siga a convenção que estiver lá em vez destes valores.

- [ ] **Step 9: Rodar a suíte inteira**

Run: `node --test test/*.js`
Expected: 1017 + os novos, 0 falhas.

- [ ] **Step 10: Commit**

```bash
git add tools/semanal/compute-alocacao.js tools/semanal/render-aba-alocacao.js tools/semanal/render-semanal.js test/semanal-compute-alocacao.test.js test/semanal-render-aba-alocacao.test.js
git commit -m "Alocacao: corrige o status invertido da celula e rotula a Tendencia"
```

---

### Task 2: O filtro de SUP passa a filtrar a grade

Implementa a Decisão 7. Vem antes do pool agrupado porque muda o CRITÉRIO de quem está no pool, e a Task 4 reescreve o pool em cima desse critério.

**Files:**
- Modify: `tools/semanal/compute-alocacao.js` (`montarGradeAlocacao`, montagem de `chavesCandidatas`)
- Modify: `tools/semanal/render-aba-alocacao.js` (`renderPool` e a chamada dela em `renderAbaAlocacao`)
- Test: `test/semanal-compute-alocacao.test.js`, `test/semanal-render-aba-alocacao.test.js`

**Interfaces:**
- Consumes: `montarGradeAlocacao(registros, indices, opcoes)`, já existente.
- Produces: `renderPool(equipes, foraDoQuadro, porEquipeMap, somenteLeitura, alocacao)` — **quinto parâmetro novo**, a alocação crua. A Task 4 e a Task 5 partem desta assinatura.

- [ ] **Step 1: Escrever o teste que falha**

Acrescente ao FIM de `test/semanal-compute-alocacao.test.js`:

```js
const { montarGradeAlocacao } = require('../tools/semanal/compute-alocacao.js');

function registrosFiltro() {
  const z = () => new Array(12).fill(0);
  const bloco = () => ({ volume: z(), financeiro: z(), equipes: z() });
  return ['SUP-A', 'SUP-B'].map((sup) => {
    const r = { sup, tipologia: 'ST', grupo: 'G', origem: 'O',
      previsto: bloco(), realizado: bloco(), total: bloco() };
    r.previsto.volume[7] = 100;
    r.total.volume[7] = 100;
    return r;
  });
}

function opcoesFiltro(alocacao) {
  const semana = { inicio: 20675, fim: 20681 };
  return {
    mesIdx: 7, ano: 2026, semanas: [semana], semana, hojeEpoch: 20678,
    equipes: [{ id: 'EQ-1', lider: 'L', diasDisponiveis: 5, diasDaSemana: 7,
      disponivel: true, colunas: ['ST'] }],
    demandas: { porRegistroEventos: {
      'SUP-A||ST': { chegada: [], sondagemRealizada: [], saidaEstoque: [] },
      'SUP-B||ST': { chegada: [], sondagemRealizada: [], saidaEstoque: [] },
    } },
    alocacao: alocacao,
  };
}

test('o filtro de SUP poda a grade mesmo com equipe alocada no SUP excluído', () => {
  // O bug relatado em 2026-08-11: filtrar por um SUP devolvia também os SUPs
  // onde havia equipe alocada -- e a semana nasce semeada do realizado, então
  // isso é o caso NORMAL, não uma borda.
  const grade = montarGradeAlocacao(registrosFiltro(), [0],
    opcoesFiltro({ 'EQ-1': { sup: 'SUP-B', coluna: 'ST' } }));
  assert.deepStrictEqual(grade.linhas.map((l) => l.sup), ['SUP-A']);
});

test('controle: sem alocação nenhuma o filtro já funcionava, e continua', () => {
  const grade = montarGradeAlocacao(registrosFiltro(), [0], opcoesFiltro({}));
  assert.deepStrictEqual(grade.linhas.map((l) => l.sup), ['SUP-A']);
});

test('equipe alocada num SUP que PASSA no filtro continua desenhando a célula', () => {
  // A poda não pode jogar fora alocação legítima: se o SUP está visível, a
  // célula dele existe mesmo sem registro naquela coluna.
  const grade = montarGradeAlocacao(registrosFiltro(), [0],
    opcoesFiltro({ 'EQ-1': { sup: 'SUP-A', coluna: 'ST' } }));
  assert.deepStrictEqual(grade.linhas.map((l) => l.sup), ['SUP-A']);
  assert.ok(grade.linhas[0].celulas.ST, 'a célula com a equipe tem que existir');
  assert.deepStrictEqual(grade.linhas[0].celulas.ST.equipes, ['EQ-1']);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/semanal-compute-alocacao.test.js`
Expected: FAIL no primeiro teste — sai `['SUP-A','SUP-B']`. Os outros dois passam já (são o controle).

- [ ] **Step 3: Implementar a poda**

Em `tools/semanal/compute-alocacao.js`, dentro de `montarGradeAlocacao`, substitua o bloco de `chavesCandidatas`:

```js
  // As células candidatas vêm de duas fontes, e ATÉ 2026-08-11 só uma respeitava
  // o filtro: `porCelula` sai de indicesPorCelula(registros, indices) e obedece;
  // `equipesNaCelula` sai de `alocacao` e não obedecia, então qualquer SUP com
  // equipe alocada virava linha por cima do filtro. Como a semana nasce semeada
  // do realizado, esse era o caso normal -- filtrar um SUP devolvia todos os
  // SUPs semeados junto.
  //
  // A alocação continua entrando (uma equipe alocada numa coluna sem registro
  // tem de aparecer), mas só nos SUPs que o filtro deixou passar.
  var supsPermitidos = {};
  (indices || []).forEach(function (i) {
    if (registros[i]) supsPermitidos[registros[i].sup] = true;
  });

  var chavesCandidatas = {};
  Object.keys(porCelula).forEach(function (k) { chavesCandidatas[k] = true; });
  Object.keys(equipesNaCelula).forEach(function (k) {
    if (supsPermitidos[k.split('||')[0]]) chavesCandidatas[k] = true;
  });
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/semanal-compute-alocacao.test.js`
Expected: PASS nos três.

- [ ] **Step 5: Escrever o teste da armadilha do pool**

Acrescente ao FIM de `test/semanal-render-aba-alocacao.test.js`:

```js
test('equipe alocada num SUP podado pelo filtro NÃO volta ao pool como livre', () => {
  // A armadilha da Decisão 7: com a linha podada, resumirAlocacao devolve
  // sup: null para a equipe, e um pool que decidisse pelo resumo a desenharia
  // como livre -- dando pra alocá-la uma segunda vez, em dois SUPs ao mesmo
  // tempo. O pool tem que decidir pela alocação CRUA.
  const html = renderAbaAlocacao(registros(), [], opcoes({
    alocacao: { '4': { sup: 'SUP-FORA-DO-FILTRO', coluna: 'SP' } },
  }));
  assert.doesNotMatch(html, /data-equipe="4"/,
    'a equipe alocada não pode aparecer como cartão enquanto o filtro esconde o SUP dela');
});

test('equipe sem alocação nenhuma continua no pool', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({ alocacao: {} }));
  assert.match(html, /data-equipe="4"/);
});
```

E, no MESMO arquivo de `compute`, o teste dos totais — a faixa do topo sai de
`resumirAlocacao(grade)` e tem de acompanhar a poda:

```js
const { resumirAlocacao } = require('../tools/semanal/compute-alocacao.js');

test('os totais da faixa excluem as linhas podadas pelo filtro', () => {
  const o = opcoesFiltro({ 'EQ-1': { sup: 'SUP-B', coluna: 'ST' } });
  const grade = montarGradeAlocacao(registrosFiltro(), [0], o);
  const resumo = resumirAlocacao(grade, { equipes: o.equipes, mesIdx: 7 });
  // Só SUP-A sobrou: a tendência total é a dele, não a dos dois.
  const tendenciaDeUmSup = grade.linhas[0].tendencia;
  assert.strictEqual(resumo.totais.tendencia, tendenciaDeUmSup,
    'a faixa não pode somar um SUP que a grade não mostra');
});

test('limpar o filtro traz a linha de volta -- a poda é de exibição, não de estado', () => {
  const alocacao = { 'EQ-1': { sup: 'SUP-B', coluna: 'ST' } };
  const comFiltro = montarGradeAlocacao(registrosFiltro(), [0], opcoesFiltro(alocacao));
  const semFiltro = montarGradeAlocacao(registrosFiltro(), [0, 1], opcoesFiltro(alocacao));
  assert.deepStrictEqual(comFiltro.linhas.map((l) => l.sup), ['SUP-A']);
  assert.deepStrictEqual(semFiltro.linhas.map((l) => l.sup).sort(), ['SUP-A', 'SUP-B']);
  assert.deepStrictEqual(semFiltro.linhas.find((l) => l.sup === 'SUP-B').celulas.ST.equipes,
    ['EQ-1'], 'a alocação nunca foi apagada, só escondida');
});
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `node --test test/semanal-render-aba-alocacao.test.js`
Expected: FAIL no primeiro — hoje o cartão aparece.

- [ ] **Step 7: O pool passa a decidir pela alocação crua**

Em `tools/semanal/render-aba-alocacao.js`:

```js
// O pool: cartões das equipes SEM destino nesta semana, mais a lista
// recolhida "fora do quadro (N)" -- Lab/TST/SN, que nunca somem calados.
//
// `alocacao` é a alocação CRUA, e não o resumo da grade, de propósito
// (Decisão 7 do spec de 2026-08-11): com o filtro de SUP podando a linha, o
// resumo devolve sup: null para uma equipe que ESTÁ alocada, e decidir por ele
// a traria de volta ao pool como livre -- podendo ser alocada uma segunda vez.
function renderPool(equipes, foraDoQuadro, porEquipeMap, somenteLeitura, alocacao) {
  var lista = equipes || [];
  var aloc = alocacao || {};
  var noPool = lista.filter(function (e) {
    var destino = aloc[e.id];
    return !(destino && destino.sup);
  });
```

O resto do corpo de `renderPool` fica igual nesta task (a Task 4 reescreve a montagem dos cartões).

E na chamada, dentro de `renderAbaAlocacao`, passe o quinto argumento:

```js
  html += renderPool(equipes, o.foraDoQuadro, porEquipeMap, somenteLeitura, o.alocacao);
```

- [ ] **Step 8: Rodar a suíte inteira**

Run: `node --test test/*.js`
Expected: 0 falhas.

- [ ] **Step 9: Commit**

```bash
git add tools/semanal/compute-alocacao.js tools/semanal/render-aba-alocacao.js test/semanal-compute-alocacao.test.js test/semanal-render-aba-alocacao.test.js
git commit -m "Alocacao: o filtro de SUP passa a podar a grade, sem soltar a equipe no pool"
```

---

### Task 3: Devolução — arrastar (ou clicar) a equipe de volta ao pool

Implementa as Decisões 1, 2 e 3.

**Files:**
- Modify: `tools/semanal/render-semanal.js` (`resolverCelulaAlocacao` → `resolverAlvoAlocacao`, `destacarCelulasCompativeis`, `limparDestaqueCelulas` → `limparDestaquesAlocacao`, os handlers de `pointerdown`/`pointerup`/`click`, e uma regra de CSS)
- Test: `test/semanal-render-semanal-wireup.test.js`

**Interfaces:**
- Consumes: `aplicarMovimento(equipeId, sup, coluna)` — inalterada; `sup` vazio já apaga.
- Produces: nada que outra task consuma.

- [ ] **Step 1: Escrever os testes que falham**

Acrescente ao FIM de `test/semanal-render-semanal-wireup.test.js`. Use os helpers que o arquivo já tem (`registroSintetico`, `csvEqComOs`, `montarSandbox`, `DEMANDAS_VAZIAS`, `PERIODOS_2026`, `SENHA_FAKE`) — leia o topo do arquivo antes de escrever, e siga a forma dos testes de arrasto que já existem lá:

```js
test('arrastar uma equipe alocada até o POOL a devolve', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const geradoEm = new Date('2026-08-01T00:00:00Z');
  const demandas = Object.assign({}, DEMANDAS_VAZIAS, {
    equipesCsv: csvEqComOs('CCR RioSP (16925-25)'),
    equipesPeriodo: { ano: 2026, mes: 8 },
    osParaSup: { '16925-25': 'SUP-0001-24' },
  });
  const html = renderSemanal({ registros, baseline: [], demandas, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();
  await sandbox.selecionarSemanaAlocacao(0);

  sandbox.aplicarMovimento('4', 'SUP-0001-24', 'ST');
  assert.ok(sandbox.ESTADO_ALOCACAO.alocacao['4'], 'pré-condição: a equipe está alocada');

  // O gesto: soltar sobre o pool.
  sandbox.aplicarMovimento('4', '', '');
  assert.strictEqual(sandbox.ESTADO_ALOCACAO.alocacao['4'], undefined,
    'a devolução tem que apagar a alocação');
});

test('resolverAlvoAlocacao reconhece célula, pool e vazio', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const demandas = Object.assign({}, DEMANDAS_VAZIAS, {
    equipesCsv: csvEqComOs('CCR RioSP (16925-25)'),
    equipesPeriodo: { ano: 2026, mes: 8 },
    osParaSup: { '16925-25': 'SUP-0001-24' },
  });
  const html = renderSemanal({ registros, baseline: [], demandas, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-08-01T00:00:00Z') });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();
  await sandbox.selecionarSemanaAlocacao(0);

  assert.strictEqual(typeof sandbox.resolverAlvoAlocacao, 'function');

  const celula = documentoFalso.querySelector('.celula-alocacao');
  assert.strictEqual(sandbox.resolverAlvoAlocacao({ target: celula }).tipo, 'celula');

  const pool = documentoFalso.querySelector('.pool-alocacao');
  assert.strictEqual(sandbox.resolverAlvoAlocacao({ target: pool }).tipo, 'pool');

  const fora = documentoFalso.getElementById('secao-alocacao');
  assert.strictEqual(sandbox.resolverAlvoAlocacao({ target: fora }), null);
});

test('nenhum destaque sobra depois de encerrar o arrasto -- inclusive o do pool', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const demandas = Object.assign({}, DEMANDAS_VAZIAS, {
    equipesCsv: csvEqComOs('CCR RioSP (16925-25)'),
    equipesPeriodo: { ano: 2026, mes: 8 },
    osParaSup: { '16925-25': 'SUP-0001-24' },
  });
  const html = renderSemanal({ registros, baseline: [], demandas, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-08-01T00:00:00Z') });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();
  await sandbox.selecionarSemanaAlocacao(0);

  sandbox.aplicarMovimento('4', 'SUP-0001-24', 'ST');
  sandbox.destacarCelulasCompativeis(['ST'], true);
  assert.ok(documentoFalso.querySelector('.pool-alvo'), 'pré-condição: o pool acendeu');

  sandbox.limparDestaquesAlocacao();
  assert.strictEqual(documentoFalso.querySelector('.pool-alvo'), null,
    'o destaque do pool tem que morrer junto com o das células');
  assert.strictEqual(documentoFalso.querySelector('.celula-alvo'), null);
});

test('soltar no VAZIO não devolve -- a alocação sobrevive', async () => {
  // Decisão 2 do spec: alocar é trabalho do usuário, e um solte impreciso não
  // pode desfazê-lo. Só o pool, explicitamente, devolve.
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const demandas = Object.assign({}, DEMANDAS_VAZIAS, {
    equipesCsv: csvEqComOs('CCR RioSP (16925-25)'),
    equipesPeriodo: { ano: 2026, mes: 8 },
    osParaSup: { '16925-25': 'SUP-0001-24' },
  });
  const html = renderSemanal({ registros, baseline: [], demandas, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-08-01T00:00:00Z') });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();
  await sandbox.selecionarSemanaAlocacao(0);

  sandbox.aplicarMovimento('4', 'SUP-0001-24', 'ST');
  const fora = documentoFalso.getElementById('secao-alocacao');
  assert.strictEqual(sandbox.resolverAlvoAlocacao({ target: fora }), null,
    'fora de célula e de pool não é alvo nenhum');
  assert.ok(sandbox.ESTADO_ALOCACAO.alocacao['4'],
    'e por isso a alocação continua de pé');
});

test('em somenteLeitura a devolução é bloqueada como a alocação', async () => {
  // Decisão 6 do spec: a proteção sai de graça (os cartões viram
  // data-arrastavel="não" e os dois gestos filtram por ela no closest), mas é
  // do tipo que se perde CALADA se alguém mexer no seletor -- por isso tem
  // teste próprio.
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const demandas = Object.assign({}, DEMANDAS_VAZIAS, {
    equipesCsv: csvEqComOs('CCR RioSP (16925-25)'),
    // Espelho de JULHO com a página em AGOSTO: é o que dispara
    // somenteLeitura = 'mes-diferente'.
    equipesPeriodo: { ano: 2026, mes: 7 },
    osParaSup: { '16925-25': 'SUP-0001-24' },
  });
  const html = renderSemanal({ registros, baseline: [], demandas, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-08-01T00:00:00Z') });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  const secao = documentoFalso.getElementById('secao-alocacao').innerHTML;
  assert.match(secao, /Somente leitura/);
  assert.doesNotMatch(secao, /data-arrastavel="sim"/,
    'sem cartão arrastável, nem alocar nem devolver têm por onde começar');
});

test('o gesto de clique-clique também devolve: clicar no cartão, clicar no pool', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const demandas = Object.assign({}, DEMANDAS_VAZIAS, {
    equipesCsv: csvEqComOs('CCR RioSP (16925-25)'),
    equipesPeriodo: { ano: 2026, mes: 8 },
    osParaSup: { '16925-25': 'SUP-0001-24' },
  });
  const html = renderSemanal({ registros, baseline: [], demandas, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-08-01T00:00:00Z') });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();
  await sandbox.selecionarSemanaAlocacao(0);

  sandbox.aplicarMovimento('4', 'SUP-0001-24', 'ST');
  // 1º clique: seleciona o cartão que está DENTRO da célula.
  const celula = documentoFalso.querySelector('.celula-alocacao');
  const cartaoNaCelula = celula.querySelector('[data-equipe="4"]');
  sandbox.SELECAO_ALOCACAO.equipeId = cartaoNaCelula.getAttribute('data-equipe');
  // 2º clique: no pool.
  const pool = documentoFalso.querySelector('.pool-alocacao');
  pool.dispatchEvent({ type: 'click', target: pool });

  assert.strictEqual(sandbox.ESTADO_ALOCACAO.alocacao['4'], undefined);
});

test('arrastar equipe que JÁ está no pool não acende o pool', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const demandas = Object.assign({}, DEMANDAS_VAZIAS, {
    equipesCsv: csvEqComOs('CCR RioSP (16925-25)'),
    equipesPeriodo: { ano: 2026, mes: 8 },
    osParaSup: { '16925-25': 'SUP-0001-24' },
  });
  const html = renderSemanal({ registros, baseline: [], demandas, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-08-01T00:00:00Z') });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();
  await sandbox.selecionarSemanaAlocacao(0);
  sandbox.limparAlocacao();

  sandbox.destacarCelulasCompativeis(['ST'], false);
  assert.strictEqual(documentoFalso.querySelector('.pool-alvo'), null,
    'devolver ao lugar onde ela já está é no-op; acender sugeriria ação inexistente');
});
```

Se `documentoFalso` não tiver `querySelector`, use o utilitário de consulta que o arquivo já usa nos outros testes — leia como os testes existentes localizam `.celula-alocacao` antes de escrever estes.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/semanal-render-semanal-wireup.test.js`
Expected: FAIL — `resolverAlvoAlocacao` e `limparDestaquesAlocacao` não existem.

- [ ] **Step 3: Trocar o resolvedor de célula pelo resolvedor de alvo**

Em `tools/semanal/render-semanal.js`, substitua `resolverCelulaAlocacao` inteira (mantendo o comentário grande sobre `elementFromPoint`, que continua valendo):

```js
// Resolve o ALVO do soltar: uma célula, o pool, ou nada.
//
// Era resolverCelulaAlocacao, que só conhecia célula e devolvia null para todo
// o resto -- por isso soltar no pool não fazia nada. A devolução (2026-08-11)
// precisa distinguir "soltou no pool" de "soltou no vazio": o primeiro devolve
// a equipe, o segundo não faz nada, de propósito. Alocar é trabalho do usuário;
// um solte impreciso não pode desfazê-lo.
//
// FIX (revisão do Task 9, achado Critical 2): a resolução prioriza
// document.elementFromPoint(clientX, clientY), não e.target -- porque
// pointerdown captura o ponteiro no cartão (setPointerCapture), e com o
// ponteiro CAPTURADO o navegador retarget-a e.target para o elemento que
// capturou, não para o que está fisicamente sob o dedo no momento de soltar.
// Usar e.target aqui resolveria sempre para o próprio cartão (ou a célula de
// ORIGEM), nunca o destino. elementFromPoint lê a posição real na tela,
// ignorando quem capturou o quê. Cai para e.target.closest só em ambiente sem
// elementFromPoint (não deveria acontecer em navegador real).
function resolverAlvoAlocacao(e) {
  var sob = null;
  if (typeof document.elementFromPoint === 'function' && typeof e.clientX === 'number') {
    sob = document.elementFromPoint(e.clientX, e.clientY);
  }
  if (!sob) sob = e.target;
  if (!sob || !sob.closest) return null;
  // A célula ganha prioridade: se por layout as duas casarem, o destino
  // específico vence o genérico.
  var celula = sob.closest('.celula-alocacao');
  if (celula) return { tipo: 'celula', el: celula };
  if (sob.closest('.pool-alocacao')) return { tipo: 'pool', el: null };
  return null;
}
```

- [ ] **Step 4: Destaque do pool, e a limpeza no único ponto de saída**

Ainda em `render-semanal.js`, substitua as duas funções de destaque:

```js
// podeDevolver: só acende o pool quando a equipe arrastada ESTÁ alocada.
// Arrastando uma que já está no pool, devolver é no-op -- acender sugeriria
// uma ação que não existe.
function destacarCelulasCompativeis(colunas, podeDevolver) {
  var celulas = document.querySelectorAll('.celula-alocacao');
  for (var i = 0; i < celulas.length; i++) {
    var coluna = celulas[i].getAttribute ? celulas[i].getAttribute('data-coluna') : null;
    if (colunas.indexOf(coluna) !== -1) celulas[i].classList.add('celula-alvo');
    else celulas[i].classList.add('celula-inerte');
  }
  if (!podeDevolver) return;
  var pool = document.querySelector('.pool-alocacao');
  if (pool) pool.classList.add('pool-alvo');
}

// Chamava-se limparDestaqueCelulas, e o nome virou mentira quando o pool
// passou a acender: ela é chamada dos CINCO pontos que encerram um gesto, e
// todos querem a limpeza COMPLETA. Limpar o pool em qualquer outro lugar o
// deixaria aceso para sempre em pelo menos um dos quatro caminhos de saída do
// arrasto (soltura aceita, recusada, pointercancel, ou solta fora de tudo) --
// ver o comentário de encerrarArrastoAlocacao.
function limparDestaquesAlocacao() {
  var celulas = document.querySelectorAll('.celula-alocacao');
  for (var i = 0; i < celulas.length; i++) {
    celulas[i].classList.remove('celula-alvo');
    celulas[i].classList.remove('celula-inerte');
  }
  var pool = document.querySelector('.pool-alocacao');
  if (pool) pool.classList.remove('pool-alvo');
}
```

Renomeie TODAS as chamadas de `limparDestaqueCelulas` para `limparDestaquesAlocacao`. Encontre-as com:

```bash
grep -n "limparDestaqueCelulas" tools/semanal/render-semanal.js
```

Devem ser 5. Nenhuma pode ficar para trás — o build não avisa, e o sintoma seria destaque preso na tela.

- [ ] **Step 5: Ligar os dois gestos ao alvo novo**

(a) No `pointerdown`, passe o segundo argumento (a equipe está alocada?):

```js
    destacarCelulasCompativeis(equipe.colunas || [], !!ESTADO_ALOCACAO.alocacao[equipeId]);
```

(b) No `pointerup`, troque o bloco final:

```js
    // Arrasto de verdade: resolve o alvo e aplica. Célula aloca; pool devolve;
    // vazio não faz nada. O destaque/fantasma já foram limpos por
    // encerrarArrastoAlocacao() acima.
    var alvo = resolverAlvoAlocacao(e);
    if (alvo && alvo.tipo === 'celula') {
      aplicarMovimento(equipeId, alvo.el.getAttribute('data-sup'), alvo.el.getAttribute('data-coluna'));
    } else if (alvo && alvo.tipo === 'pool') {
      aplicarMovimento(equipeId, '', '');
    }
    SUPRIMIR_PROXIMO_CLICK_ALOCACAO = true;
```

(c) No `click`, no ramo do 2º passo da seleção:

```js
    if (SELECAO_ALOCACAO.equipeId) {
      var equipeIdSelecionado = SELECAO_ALOCACAO.equipeId;
      SELECAO_ALOCACAO.equipeId = null;
      limparDestaquesAlocacao();
      var alvoClique = resolverAlvoAlocacao(e);
      if (alvoClique && alvoClique.tipo === 'celula') {
        aplicarMovimento(equipeIdSelecionado, alvoClique.el.getAttribute('data-sup'), alvoClique.el.getAttribute('data-coluna'));
      } else if (alvoClique && alvoClique.tipo === 'pool') {
        aplicarMovimento(equipeIdSelecionado, '', '');
      }
      return;
    }
```

(d) No 1º passo da seleção (o `click` que acende), passe o segundo argumento também:

```js
    destacarCelulasCompativeis(equipeClicada.colunas || [], !!ESTADO_ALOCACAO.alocacao[equipeIdClicado]);
```

- [ ] **Step 6: CSS do pool como alvo**

No bloco `CSS_SEMANAL` de `render-semanal.js`, junto de `.pool-alocacao`:

```css
  .pool-alvo { outline: 2px dashed var(--accent, #2563EB); outline-offset: 2px; }
```

Se `--accent` não existir no CSS desta página, use a mesma cor que `.celula-alvo` já usa — localize com `grep -n "celula-alvo" tools/semanal/render-semanal.js`.

- [ ] **Step 7: Rodar a suíte inteira**

Run: `node --test test/*.js`
Expected: 0 falhas. Se o ARQUIVO de wireup estourar timeout com os testes passando um a um, o problema é fetch em voo — releia o comentário de `fetchMockAlocacaoSheet` no próprio arquivo.

- [ ] **Step 8: Commit**

```bash
git add tools/semanal/render-semanal.js test/semanal-render-semanal-wireup.test.js
git commit -m "Alocacao: arrastar (ou clicar) a equipe de volta ao pool devolve"
```

---

### Task 4: Pool agrupado por tipologia

Implementa as Decisões 4 e 5.

**Files:**
- Modify: `tools/semanal/render-aba-alocacao.js` (`renderPool`, `renderCartaoEquipe`)
- Modify: `tools/semanal/render-semanal.js` (CSS dos grupos)
- Test: `test/semanal-render-aba-alocacao.test.js`

**Interfaces:**
- Consumes: `COLUNAS_ALOCACAO` de `tools/semanal/equipes-alocaveis.js` (já importado no arquivo — confirme com `grep -n "COLUNAS_ALOCACAO" tools/semanal/render-aba-alocacao.js`; se não estiver, acrescente ao `require` existente).
- Produces: markup `.pool-grupo` com `data-grupo="<id da coluna>"`, consumido pela Task 5.

- [ ] **Step 1: Escrever os testes que falham**

Acrescente ao FIM de `test/semanal-render-aba-alocacao.test.js`:

```js
function equipesVariadas() {
  const base = { diasDisponiveis: 5, diasDaSemana: 7, disponivel: true,
    supRealizado: null, colunaRealizada: null, popup: {} };
  return [
    Object.assign({ id: '4', lider: 'Amaral', nome: 'José I. Amaral', servicos: 'SP',
      colunas: ['SP'], polivalente: false }, base),
    Object.assign({ id: '7', lider: 'Alves', nome: 'Carlos Alves', servicos: 'ST | PI | BL',
      colunas: ['ST', 'PI', 'BL'], polivalente: true }, base),
  ];
}

test('o pool sai agrupado, na ordem canônica de COLUNAS_ALOCACAO', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), alocacao: {},
  }));
  const ordem = [...html.matchAll(/data-grupo="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(ordem, ['SP', 'ST', 'PI', 'BL'],
    'grupos vazios não são desenhados, e os que sobram seguem a ordem canônica');
});

test('a equipe polivalente aparece em CADA grupo que serve', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), alocacao: {},
  }));
  const ocorrencias = (html.match(/data-equipe="7"/g) || []).length;
  assert.strictEqual(ocorrencias, 3, 'ST, PI e BL -- é o que faz o grupo BL ter candidato');
});

test('o grupo BL existe por causa da polivalente -- não há equipe só de BL', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), alocacao: {},
  }));
  assert.match(html, /data-grupo="BL"/);
});

test('o cartão polivalente leva selo; o de coluna única, não', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), alocacao: {},
  }));
  assert.match(html, /cartao-polivalente/);
  const selos = (html.match(/cartao-selo-poli/g) || []).length;
  assert.strictEqual(selos, 3, 'um por cópia da equipe 7');
});

test('"fora do quadro" continua fora do agrupamento', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), alocacao: {},
  }));
  assert.match(html, /fora do quadro \(1\)/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/semanal-render-aba-alocacao.test.js`
Expected: FAIL — não existe `data-grupo` nenhum.

- [ ] **Step 3: Reescrever `renderPool` com os grupos**

Em `tools/semanal/render-aba-alocacao.js`, substitua o corpo de `renderPool` (mantendo a assinatura de 5 parâmetros da Task 2 e o comentário sobre a alocação crua):

```js
function renderPool(equipes, foraDoQuadro, porEquipeMap, somenteLeitura, alocacao) {
  var lista = equipes || [];
  var aloc = alocacao || {};
  var noPool = lista.filter(function (e) {
    var destino = aloc[e.id];
    return !(destino && destino.sup);
  });

  // Um bloco por coluna, na ORDEM CANÔNICA de COLUNAS_ALOCACAO -- a mesma da
  // grade, para o olho não ter que traduzir entre as duas metades da tela.
  //
  // A equipe aparece em TODOS os grupos que serve, e não num "Polivalentes"
  // separado: medido em 2026-08-11, não existe nenhuma equipe com serviço 'BL'
  // sozinho -- as 6 de 'ST | PI | BL' são as únicas candidatas a BL que
  // existem, e num pool que as isolasse o grupo BL nasceria sempre vazio.
  // O preço é a repetição (7 polivalentes viram 20 cartões), e o selo no cartão
  // existe para ela não ser lida como equipes diferentes.
  var grupos = COLUNAS_ALOCACAO.map(function (coluna) {
    var doGrupo = noPool.filter(function (e) {
      return (e.colunas || []).indexOf(coluna.id) !== -1;
    });
    if (!doGrupo.length) return '';   // grupo vazio não é desenhado
    var cartoes = doGrupo.map(function (e) {
      return renderCartaoEquipe(e, porEquipeMap[e.id] || null, somenteLeitura);
    }).join('');
    return '<div class="pool-grupo" data-grupo="' + escapeHtml(coluna.id) + '">'
      + '<h4 class="pool-grupo-titulo">' + escapeHtml(coluna.rotulo)
      + ' <span class="pool-grupo-contagem">(' + doGrupo.length + ')</span></h4>'
      + '<div class="pool-cartoes">' + cartoes + '</div>'
      + '</div>';
  }).join('');

  var fora = foraDoQuadro || [];
  var itensFora = fora.map(function (f) {
    return '<li><strong>' + escapeHtml(f.id) + '</strong> ' + escapeHtml(f.lider)
      + ' (' + escapeHtml(f.servicos) + ') — ' + escapeHtml(f.motivo) + '</li>';
  }).join('');

  return '<div class="pool-alocacao">'
    + (grupos || '<p class="pool-vazio">nenhuma equipe livre</p>')
    + '<details class="fora-do-quadro">'
    + '<summary>fora do quadro (' + fora.length + ')</summary>'
    + '<ul>' + itensFora + '</ul>'
    + '</details>'
    + '</div>';
}
```

- [ ] **Step 4: Selo no cartão polivalente**

Em `renderCartaoEquipe`, acrescente o selo depois do medalhão e a linha no popup. O cartão já ganha a classe `cartao-polivalente`; falta o selo visível:

```js
    + '<span class="cartao-medalhao">' + escapeHtml(equipe.id) + '</span>'
    + (equipe.polivalente ? '<span class="cartao-selo-poli" title="aparece em mais de um grupo">⇄</span>' : '')
```

E no `popupHtml`, logo depois da linha de Tipologia:

```js
    + (equipe.polivalente
      ? '<p class="popup-poli">Aparece nos grupos: ' + escapeHtml(colunas.join(', ')) + '</p>'
      : '')
```

- [ ] **Step 5: CSS dos grupos**

No bloco `CSS_SEMANAL` de `render-semanal.js`, junto das regras `.pool-*` existentes:

```css
  .pool-grupo { margin-bottom: 12px; }
  .pool-grupo-titulo {
    margin: 0 0 6px; font-size: 12px; font-weight: 600;
    color: var(--text-secondary); text-transform: uppercase; letter-spacing: .04em;
  }
  .pool-grupo-contagem { font-weight: 400; opacity: .75; }
  .cartao-selo-poli { margin-left: 4px; font-size: 11px; opacity: .8; }
```

- [ ] **Step 6: Rodar a suíte inteira**

Run: `node --test test/*.js`
Expected: 0 falhas. Testes antigos que contavam cartões no pool podem quebrar por causa da repetição — se quebrarem, confira se a expectativa antiga assumia um cartão por equipe e atualize com um comentário dizendo por que agora são mais.

- [ ] **Step 7: Commit**

```bash
git add tools/semanal/render-aba-alocacao.js tools/semanal/render-semanal.js test/semanal-render-aba-alocacao.test.js
git commit -m "Alocacao: pool agrupado por tipologia, com a polivalente em cada grupo"
```

---

### Task 5: Campo de busca de equipe

Implementa a Decisão 8.

**Files:**
- Modify: `tools/semanal/render-aba-alocacao.js` (`renderControles`, `renderPool`, `renderCartaoEquipe`)
- Modify: `tools/semanal/render-semanal.js` (repasse do termo, listener de `input`, CSS)
- Test: `test/semanal-render-aba-alocacao.test.js`, `test/semanal-render-semanal-wireup.test.js`

**Interfaces:**
- Consumes: `normalizarBusca(texto)` de `tools/comum/render-shell.js`, via `scriptFiltros()` já presente no bundle do cliente. Confirme como a aba Alertas a alcança (`grep -n "normalizarBusca" tools/semanal/render-semanal.js`) e use o MESMO caminho.
- Produces: `opcoes.buscaEquipe` (string) lido por `renderAbaAlocacao`; markup `#busca-equipe`.

- [ ] **Step 1: Escrever os testes que falham**

Acrescente ao FIM de `test/semanal-render-aba-alocacao.test.js`:

```js
test('a busca casa o id', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), alocacao: {}, buscaEquipe: '7',
  }));
  assert.match(html, /data-equipe="7"/);
  assert.doesNotMatch(html, /data-equipe="4"/);
});

test('a busca casa o líder', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), alocacao: {}, buscaEquipe: 'amaral',
  }));
  assert.match(html, /data-equipe="4"/);
  assert.doesNotMatch(html, /data-equipe="7"/);
});

test('a busca casa o NOME COMPLETO, que o cartão não mostra', () => {
  // Medido na Sheet em 2026-08-11: a col. 1 tem "José I. Amaral" e a col. 4
  // tem "Amaral". O cartão só mostra o apelido, então casar apenas o que ele
  // exibe deixaria "josé" sem achar ninguém.
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), alocacao: {}, buscaEquipe: 'josé',
  }));
  assert.match(html, /data-equipe="4"/);
});

test('a busca ignora acento e caixa', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), alocacao: {}, buscaEquipe: 'JOSE',
  }));
  assert.match(html, /data-equipe="4"/);
});

test('casando só pelo nome completo, o cartão passa a exibi-lo', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), alocacao: {}, buscaEquipe: 'josé',
  }));
  assert.match(html, /José I\. Amaral/);
});

test('busca vazia devolve o pool inteiro', () => {
  const comBusca = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), alocacao: {}, buscaEquipe: '',
  }));
  const semBusca = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), alocacao: {},
  }));
  assert.strictEqual(comBusca, semBusca);
});

test('busca sem resultado não deixa a área muda', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), alocacao: {}, buscaEquipe: 'zzzznaoexiste',
  }));
  assert.match(html, /nenhuma equipe/i);
});

test('a busca poda o POOL e não mexe nas linhas da grade', () => {
  // Os dois eixos são independentes: quem recorta a grade é o filtro de SUP
  // (Decisão 7), a busca só ajuda a achar equipe.
  const semBusca = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), alocacao: {},
  }));
  const comBusca = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), alocacao: {}, buscaEquipe: 'zzzznaoexiste',
  }));
  const linhasDe = (html) => (html.match(/data-sup="/g) || []).length;
  assert.strictEqual(linhasDe(comBusca), linhasDe(semBusca),
    'a grade tem que ficar idêntica, com ou sem busca');
});

test('busca e filtro de SUP valem ao mesmo tempo sem se atropelar', () => {
  // Filtro vazio (grade podada até nada) + busca que casa: a busca continua
  // respondendo sobre o pool, que não depende de `indices`.
  const html = renderAbaAlocacao(registros(), [], opcoes({
    equipes: equipesVariadas(), alocacao: {}, buscaEquipe: 'amaral',
  }));
  assert.match(html, /data-equipe="4"/);
  assert.doesNotMatch(html, /data-equipe="7"/);
});

test('equipe que casa a busca mas está ALOCADA vira linha de texto, não cartão', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), buscaEquipe: 'alves',
    alocacao: { '7': { sup: 'SUP-A', coluna: 'ST' } },
  }));
  assert.match(html, /alocada em/i);
  assert.match(html, /SUP-A/);
  // Arrastar se faz da célula; um segundo cartão arrastável reintroduziria o
  // risco de dupla alocação da Decisão 7.
  assert.doesNotMatch(html, /class="pool-alocada"[^>]*data-arrastavel="sim"/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/semanal-render-aba-alocacao.test.js`
Expected: FAIL — `buscaEquipe` é ignorada.

- [ ] **Step 3: Implementar o casamento e o campo**

Em `tools/semanal/render-aba-alocacao.js`, acrescente perto do topo (depois dos requires):

```js
// Casa contra os TRÊS campos, e não só contra o que o cartão mostra. Medido na
// Sheet em 2026-08-11: a coluna 1 ("Equipe") tem o nome completo e a 4
// ("Líderes") tem o apelido -- o cartão exibe o apelido, então casar só por ele
// deixaria "josé" sem achar a equipe cujo líder é "José I. Amaral".
function equipeCasaBusca(equipe, termoNormalizado) {
  if (!termoNormalizado) return true;
  var campos = [equipe.id, equipe.lider, equipe.nome];
  for (var i = 0; i < campos.length; i++) {
    if (normalizarBusca(campos[i] || '').indexOf(termoNormalizado) !== -1) return true;
  }
  return false;
}

// Verdadeiro quando o casamento veio SÓ do nome completo -- aí o cartão exibe o
// nome, senão o resultado parece aleatório (busca "josé", aparece "Amaral").
function casouSoPeloNome(equipe, termoNormalizado) {
  if (!termoNormalizado) return false;
  var visivel = normalizarBusca(equipe.id || '') + ' ' + normalizarBusca(equipe.lider || '');
  if (visivel.indexOf(termoNormalizado) !== -1) return false;
  return normalizarBusca(equipe.nome || '').indexOf(termoNormalizado) !== -1;
}
```

`normalizarBusca` vem de `./render-aba-alertas.js`. Acrescente ao bloco de `require` do topo do arquivo:

```js
const { normalizarBusca } = require('./render-aba-alertas.js');
```

Três coisas verificadas, para não haver dúvida:

- ela **não** é exportada de `tools/comum/render-shell.js` — lá vive dentro de `scriptFiltros()`, inalcançável;
- `render-aba-alertas.js` tem uma cópia própria (documentada no arquivo como "cópias das de `scriptFiltros()`") e **a exporta**;
- a ordem do bundle já permite: `render-aba-alertas.js` está na posição 711 de `BUNDLE_ARQUIVOS` e `render-aba-alocacao.js` na 776. **Não mexa em `BUNDLE_ARQUIVOS`** — a ordem já está certa.

**Não reimplemente a normalização.** Duas normalizações divergentes é bug garantido, e este repositório já carrega uma duplicata deliberada demais.

Em `renderControles`, acrescente o campo antes de `renderStatus`:

```js
    + '<input id="busca-equipe" type="text" class="busca-equipe" placeholder="Buscar equipe (id ou líder)..."'
    + ' autocomplete="off" value="' + escapeHtml(o.buscaEquipe || '') + '">'
```

Em `renderPool`, receba o termo e aplique. A assinatura ganha um sexto parâmetro:

```js
function renderPool(equipes, foraDoQuadro, porEquipeMap, somenteLeitura, alocacao, buscaEquipe) {
  var lista = equipes || [];
  var aloc = alocacao || {};
  var termo = normalizarBusca(buscaEquipe || '');
  var casam = lista.filter(function (e) { return equipeCasaBusca(e, termo); });
  var noPool = casam.filter(function (e) {
    var destino = aloc[e.id];
    return !(destino && destino.sup);
  });
  // Equipe que casa a busca mas ESTÁ alocada não some calada: a poda sozinha
  // responderia "não achei" para uma equipe que existe.
  var alocadas = termo ? casam.filter(function (e) {
    var destino = aloc[e.id];
    return !!(destino && destino.sup);
  }) : [];
```

O `map` dos grupos passa a usar `noPool` (já usa) e `renderCartaoEquipe` ganha um argumento a mais para o nome:

```js
      return renderCartaoEquipe(e, porEquipeMap[e.id] || null, somenteLeitura, casouSoPeloNome(e, termo));
```

E o `return` final ganha o bloco das alocadas e uma mensagem honesta de "não achei":

```js
  var linhasAlocadas = alocadas.map(function (e) {
    var d = aloc[e.id];
    return '<li class="pool-alocada">' + escapeHtml(e.id) + ' (' + escapeHtml(e.lider) + ')'
      + ' — alocada em ' + escapeHtml(d.sup) + ' · ' + escapeHtml(d.coluna) + '</li>';
  }).join('');

  var corpo = grupos;
  if (!grupos) {
    corpo = '<p class="pool-vazio">' + (termo ? 'nenhuma equipe livre casa a busca' : 'nenhuma equipe livre') + '</p>';
  }

  return '<div class="pool-alocacao">'
    + corpo
    + (linhasAlocadas ? '<ul class="pool-alocadas">' + linhasAlocadas + '</ul>' : '')
    + '<details class="fora-do-quadro">'
    + '<summary>fora do quadro (' + fora.length + ')</summary>'
    + '<ul>' + itensFora + '</ul>'
    + '</details>'
    + '</div>';
```

Em `renderCartaoEquipe`, aceite o quarto parâmetro e mostre o nome quando pedido:

```js
function renderCartaoEquipe(equipe, resumoEquipe, somenteLeitura, mostrarNome) {
```

e, depois da linha de `cartao-lider`:

```js
    + (mostrarNome && equipe.nome ? '<span class="cartao-nome">' + escapeHtml(equipe.nome) + '</span>' : '')
```

Em `renderAbaAlocacao`, repasse o termo às duas funções:

```js
  var html = renderControles(o, somenteLeitura);
  html += renderFaixaAlocacao(resumo.totais);
  if (somenteLeitura === 'mes-diferente') html += renderAvisoSomenteLeitura();
  html += renderPool(equipes, o.foraDoQuadro, porEquipeMap, somenteLeitura, o.alocacao, o.buscaEquipe);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/semanal-render-aba-alocacao.test.js`
Expected: PASS.

- [ ] **Step 5: Ligar o campo no cliente**

Em `tools/semanal/render-semanal.js`:

(a) Estado, junto de `ESTADO_ALOCACAO`:

```js
// O termo digitado NÃO é estado persistido -- vive só aqui e no DOM, como a
// busca da aba Alertas. Trocar de semana ou de mês não o preserva.
var BUSCA_EQUIPE_ALOCACAO = '';
```

(b) Em `montarAbaAlocacao`, passe no objeto de opções (junto de `alocacao:`):

```js
      buscaEquipe: BUSCA_EQUIPE_ALOCACAO,
```

(c) No listener delegado de `#secao-alocacao` (`inicializarInteracaoAlocacao`), acrescente:

```js
  // 'input' não borbulha em navegadores muito antigos, mas borbulha em todos os
  // que este dashboard suporta -- mesma premissa da busca da aba Alertas.
  secao.addEventListener('input', function (e) {
    var campo = e.target && e.target.id === 'busca-equipe' ? e.target : null;
    if (!campo) return;
    BUSCA_EQUIPE_ALOCACAO = campo.value || '';
    montarAbaAlocacao();
    // montarAbaAlocacao refaz a seção inteira: o campo é outro elemento agora,
    // e o foco/cursor iriam embora a cada tecla sem isto.
    var novo = document.getElementById('busca-equipe');
    if (novo && typeof novo.focus === 'function') {
      novo.focus();
      if (typeof novo.setSelectionRange === 'function') {
        novo.setSelectionRange(novo.value.length, novo.value.length);
      }
    }
  });
```

(d) CSS, junto de `.busca-alertas` (localize com `grep -n "busca-alertas" tools/semanal/render-semanal.js` e copie a convenção de lá):

```css
  .busca-equipe { padding: 6px 8px; font-size: 13px; min-width: 220px; }
  .pool-alocadas { margin: 8px 0 0; padding-left: 18px; font-size: 12px; color: var(--text-secondary); }
  .cartao-nome { display: block; font-size: 11px; opacity: .8; }
```

- [ ] **Step 6: Teste de ponta a ponta do campo**

Acrescente ao FIM de `test/semanal-render-semanal-wireup.test.js`, seguindo a forma dos testes de sandbox do arquivo:

```js
test('digitar no campo de busca poda o pool sem perder o foco', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const demandas = Object.assign({}, DEMANDAS_VAZIAS, {
    equipesCsv: csvEqComOs('CCR RioSP (16925-25)'),
    equipesPeriodo: { ano: 2026, mes: 8 },
    osParaSup: { '16925-25': 'SUP-0001-24' },
  });
  const html = renderSemanal({ registros, baseline: [], demandas, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-08-01T00:00:00Z') });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();
  await sandbox.selecionarSemanaAlocacao(0);

  const campo = documentoFalso.getElementById('busca-equipe');
  assert.ok(campo, 'o campo tem que existir na aba');
  campo.value = 'zzzznaoexiste';
  campo.dispatchEvent({ type: 'input', target: campo });

  assert.match(documentoFalso.getElementById('secao-alocacao').innerHTML, /nenhuma equipe/i);
});
```

Se o `documentoFalso` do arquivo não suportar `dispatchEvent` nessa forma, use o mecanismo que os outros testes do arquivo já usam para disparar eventos — leia-os antes de escrever.

- [ ] **Step 7: Rodar a suíte inteira**

Run: `node --test test/*.js`
Expected: 0 falhas.

- [ ] **Step 8: Commit**

```bash
git add tools/semanal/render-aba-alocacao.js tools/semanal/render-semanal.js test/semanal-render-aba-alocacao.test.js test/semanal-render-semanal-wireup.test.js
git commit -m "Alocacao: campo de busca de equipe por id, lider ou nome completo"
```

---

### Task 6: Documentar, reconstruir e publicar

Só depois de as Tasks 1 a 5 estarem revisadas e verdes. É a ÚNICA task que constrói ou publica.

**Files:**
- Modify: `CLAUDE.md` (seção `### Aba Alocação Equipes`)
- Build: `dist/planejamento-semanal.html`, `docs/planejamento-semanal.html`

- [ ] **Step 1: Registrar no CLAUDE.md**

Na seção `### Aba Alocação Equipes`, acrescente ao fim:

```markdown
**Cinco mudanças de 2026-08-11** (spec:
`docs/superpowers/specs/2026-08-11-alocacao-devolucao-e-pool-por-tipologia-design.md`):

- **Devolução**: soltar a equipe sobre o pool a tira do contrato.
  `resolverAlvoAlocacao` devolve célula/pool/nada; soltar no VAZIO continua não
  fazendo nada, de propósito.
- **O destaque do pool morre em `limparDestaquesAlocacao`** (ex-`limparDestaqueCelulas`),
  o único ponto de saída do arrasto. Limpá-lo em outro lugar o deixaria aceso
  para sempre em um dos quatro caminhos.
- **Pool agrupado por tipologia**, com a equipe polivalente repetida em CADA
  grupo que serve. Não existe equipe com serviço `BL` sozinho: as 6 de
  `ST | PI | BL` são as únicas candidatas a BL, e isolá-las num grupo
  "Polivalentes" deixaria BL sempre vazio.
- **O filtro de SUP passa a podar a grade.** `montarGradeAlocacao` unia as
  células de `porCelula` (filtrado) com as de `alocacao` (não filtrado), e como
  a semana nasce semeada do realizado isso devolvia todos os SUPs semeados. O
  **pool decide pela alocação CRUA**, nunca pelo resumo da grade — decidir pelo
  resumo traria a equipe de um SUP podado de volta ao pool como livre,
  permitindo alocá-la duas vezes.
- **O status da célula estava INVERTIDO.** `classificarOcupacao` tem faixas para
  `carga ÷ capacidade`, e a célula a alimentava com `capacidade ÷ tendência`, a
  razão recíproca: tendência 100 com capacidade 50 saía "Com folga · saldo −50".
  Use `classificarCelula(tendencia, capacidadeAlocada)`. `ROTULO_SITUACAO` é
  compartilhado com o resumo por equipe, onde `livre` significa "no pool" —
  **nunca renomear `livre`**.
```

- [ ] **Step 2: Rodar a suíte inteira uma última vez**

Run: `node --test test/*.js`
Expected: 0 falhas.

- [ ] **Step 3: Rebasear sobre o master atual**

O master tem uma segunda frente ativa (outra pessoa empurra dados no mesmo branch).

```bash
git fetch origin
git rebase origin/master
node --test test/*.js
```

Expected: rebase sem conflito, suíte verde. Em conflito nos CSVs de dados ou no HTML construído, o upstream ganha — eles são regenerados no passo seguinte.

- [ ] **Step 4: Construir e sincronizar `docs/`**

```bash
ORCAMENTO_SENHA='sptinfra@2026' node tools/semanal/build-dashboard.js
cp dist/planejamento-semanal.html docs/planejamento-semanal.html
node --test test/publicacao-docs-sincronizado.test.js
```

Expected: build escreve o HTML; o teste de sincronia byte a byte passa nos 7 arquivos.

- [ ] **Step 5: Commit e publicar**

```bash
git add CLAUDE.md dist/planejamento-semanal.html docs/planejamento-semanal.html
git commit -m "Rebuild: devolucao, pool por tipologia, filtro de SUP e status da celula"
git push origin HEAD:master
```

- [ ] **Step 6: Confirmar o deploy ao vivo**

A página semanal não tem carimbo "Gerado em", então a verificação é por conteúdo:

```bash
sha256sum docs/planejamento-semanal.html | cut -c1-16
curl -s "https://amcaccere261283.github.io/orcamento-dashboard/planejamento-semanal.html" | sha256sum | cut -c1-16
```

Expected: os dois hashes iguais. O Pages leva 1-2 minutos; repita o `curl` até bater antes de declarar publicado.
