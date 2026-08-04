# Consolidado congelado, filtro global de ativos e três ajustes — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na página Planejamento Semanal: igualar o indicador de status ao do orçamento, trocar as colunas do Consolidado por Realizado + Tendência congelada, mover o "somente SUPs ativos" para a barra compartilhada, e fazer o Consolidado seguir o seletor de dimensão da página.

**Architecture:** O congelamento não guarda nada: é a MESMA `calcularSeriesSemanaisDimensao` chamada com `hojeEpoch = 1º dia da semana selecionada`. Como o Realizado exibido continua sendo o de hoje, a aba passa a calcular DUAS séries por linha quando congela. O filtro de ativos vira estado compartilhado na barra, aplicado por aba (não em `indicesFiltrados`, porque "ativo" depende do período que cada aba mostra).

**Tech Stack:** Node puro, sem dependências. `node --test test/*.test.js`.

**Spec:** `docs/superpowers/specs/2026-08-04-semanal-consolidado-congelado-e-ativos-design.md`

## Global Constraints

- Repositório `orcamento-dashboard`, branch `semanal-consolidado-congelado` (já criado, já tem o commit do spec).
- **Não tocar em `tools/orcamento/`** — `test/orcamento-html-inalterado.test.js` prende aquele HTML byte a byte.
- Módulos de produção rodam no Node E embrulhados numa IIFE no navegador: `var`/`function`, nunca `const`/`let`/arrow. Import só na forma exata `const { X } = require('./arquivo.js');` — é a regex de `transformaModulo` (`tools/comum/browser-bundle.js`). Um `require('../comum/...')` é REMOVIDO pelo bundler.
- **A ordem de `BUNDLE_ARQUIVOS` (`tools/semanal/render-semanal.js`) é o contrato de dependência** — não há resolvedor.
- O JS de cliente vive em template literals: crases escapadas (`` \` ``).
- Todo dado que vai para markup passa por `escapeHtml`.
- Sem dependências novas. Comentários em português, explicando POR QUE.
- Cada tarefa termina com `node --test test/*.test.js` inteiro passando.

---

### Task 1: O anel do indicador de status sai

**Files:**
- Modify: `tools/semanal/render-semanal.js` (bloco `CSS_ABAS_SEMANAL`, as duas linhas do `box-shadow` do `.status-circulo` e o comentário acima delas)
- Test: `test/semanal-render-semanal-wireup.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: nada.

- [ ] **Step 1: Escrever o teste que falha**

Em `test/semanal-render-semanal-wireup.test.js`, usando a mesma montagem que os testes vizinhos já fazem (`registroSintetico`, `DEMANDAS_VAZIAS`, `PERIODOS_2026`, `SENHA_FAKE` estão no topo do arquivo):

```js
test('o indicador de status nao tem anel -- e identico ao do dashboard de orcamento', () => {
  const html = renderSemanal({
    registros: [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)],
    baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z'),
  });
  assert.strictEqual(html.indexOf('.status-circulo { box-shadow'), -1,
    'a regra do anel nao pode existir mais');
  assert.strictEqual(html.indexOf('rgba(255,255,255,0.45)'), -1,
    'o valor do anel nao pode sobrar em nenhuma outra regra');
  assert.ok(html.indexOf('status-circulo') !== -1,
    'a classe em si continua existindo -- e ela que pinta a bolinha');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-render-semanal-wireup.test.js`
Expected: FAIL — a regra ainda está no HTML gerado.

- [ ] **Step 3: Apagar a regra**

Em `tools/semanal/render-semanal.js`, no bloco `CSS_ABAS_SEMANAL`, apagar as duas linhas:

```css
  #tabela-alertas .status-circulo,
  #tabela-alertas-tendencia .status-circulo { box-shadow: 0 0 0 1px rgba(255,255,255,0.45); }
```

e o comentário que as precede (o que fala do contraste do `#1414CC`). No lugar do comentário apagado, deixar registrado na regra de hover logo acima — ou como comentário solto ali — o seguinte, para ninguém "consertar" isso de volta:

```
  /* O anel de contraste do .status-circulo foi REMOVIDO em 2026-08-04 a pedido
     do dono do projeto: o indicador desta página tem de ficar idêntico ao do
     dashboard de orçamento, que nunca teve anel. O preço é conhecido e aceito
     -- o #1414CC ("Excelente") fica em ~1,65:1 contra a superfície escura e
     quase some, justamente no status que se quer achar varrendo a tela. Não
     recolocar numa revisão de design sem perguntar a ele. */
```

- [ ] **Step 4: Rodar os testes**

Run: `node --test test/*.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/render-semanal.js test/semanal-render-semanal-wireup.test.js
git commit -m "Indicador de status igual ao do orcamento: sai o anel de contraste"
```

---

### Task 2: Consolidado — sai o Previsto, entra a Tendência congelada

**Files:**
- Modify: `tools/semanal/render-aba-consolidado.js` (`renderCabecalho`, `renderLinha`, `renderAbaConsolidado`)
- Test: `test/semanal-render-aba-consolidado.test.js`

**Interfaces:**
- Consumes: `calcularSeriesSemanaisDimensao(registros, indices, dimensao, mesIdx, semanas, numSemanas, temSemanasReais, indiceAtual, demandas, hojeEpoch)` de `./render-aba-semanal.js` — já usada por este arquivo hoje. `indiceSemanaAtual(semanas, hojeEpoch)` e `formatarIntervaloSemana(inicio, fim)` continuam como estão.
- Produces: `renderAbaConsolidado(registros, indices, opcoes)` mantém a assinatura. O `<thead>` passa a ter 6 colunas fixas + as de premissa (era 7 + premissa).

- [ ] **Step 1: Escrever os testes que falham**

Em `test/semanal-render-aba-consolidado.test.js` (reaproveitar as fixtures que o arquivo já tem; se não houver uma que sirva, montar registros com `previsto.volume[mesIdx]` e um `demandas.porRegistroEventos` com `sondagemRealizada` em datas de semanas diferentes):

```js
const { semanasDoMes, diaEpoch } = require('../tools/semanal/compute-semanal.js');
const { calcularSeriesSemanaisDimensao } = require('../tools/semanal/render-aba-semanal.js');

const SEMANAS_JUL = semanasDoMes(2026, 6);
const diaJ = (d) => diaEpoch(new Date(Date.UTC(2026, 6, d)));

// Furos espalhados: 6 na S1, 20 na S2. Com hoje em 15/07 (S3), a S2 esta
// encerrada e a S3 em curso.
function demandasEspalhadas(sup) {
  const realizada = [];
  for (let i = 0; i < 6; i++) realizada.push(diaJ(2));
  for (let i = 0; i < 20; i++) realizada.push(diaJ(8));
  const eventos = { sondagemRealizada: realizada, chegada: [], saidaEstoque: [] };
  const porRegistroEventos = {};
  porRegistroEventos[sup + '||ST'] = eventos;
  return { porRegistroEventos: porRegistroEventos };
}

test('a coluna Previsto sumiu do Consolidado', () => {
  const html = renderAbaConsolidado(REGISTROS, [0], {
    semanaIdx: 1, dimensao: 'volume', mesIdx: 6, semanas: SEMANAS_JUL,
    demandas: demandasEspalhadas('SUP-0001-24'), hojeEpoch: diaJ(15),
  });
  const cabecalho = html.match(/<thead>[\s\S]*?<\/thead>/)[0];
  assert.strictEqual(cabecalho.indexOf('>Previsto'), -1, 'Previsto nao pode mais ser coluna');
  assert.ok(cabecalho.indexOf('>Realizado') !== -1);
  assert.ok(cabecalho.indexOf('Tend') !== -1);
});

test('semana encerrada: a Tendencia e a CONGELADA no 1o dia dela, nao a projecao de hoje', () => {
  const demandas = demandasEspalhadas('SUP-0001-24');
  const hoje = diaJ(15);
  const inicioS2 = SEMANAS_JUL[1].inicio;

  const congelada = calcularSeriesSemanaisDimensao(
    REGISTROS, [0], 'volume', 6, SEMANAS_JUL, SEMANAS_JUL.length, true,
    indiceSemanaAtual(SEMANAS_JUL, inicioS2), demandas, inicioS2
  ).semanasTendenciaCompleta[1];
  const aoVivo = calcularSeriesSemanaisDimensao(
    REGISTROS, [0], 'volume', 6, SEMANAS_JUL, SEMANAS_JUL.length, true,
    indiceSemanaAtual(SEMANAS_JUL, hoje), demandas, hoje
  ).semanasTendenciaCompleta[1];
  assert.notStrictEqual(Math.round(congelada), Math.round(aoVivo),
    'a fixture precisa produzir valores DIFERENTES, senao o teste nao prova nada');

  const html = renderAbaConsolidado(REGISTROS, [0], {
    semanaIdx: 1, dimensao: 'volume', mesIdx: 6, semanas: SEMANAS_JUL,
    demandas: demandas, hojeEpoch: hoje,
  });
  const linha = html.match(/<tr class="linha-consolidado">[\s\S]*?<\/tr>/)[0];
  assert.ok(linha.indexOf('>' + formatarNumero(congelada, 0) + '<') !== -1,
    'a celula tem de trazer a tendencia congelada');
  assert.strictEqual(linha.indexOf('>' + formatarNumero(aoVivo, 0) + '<'), -1,
    'e nao a projecao de hoje');
});

test('o Realizado exibido continua sendo o de HOJE, nao o congelado', () => {
  const demandas = demandasEspalhadas('SUP-0001-24');
  const html = renderAbaConsolidado(REGISTROS, [0], {
    semanaIdx: 1, dimensao: 'volume', mesIdx: 6, semanas: SEMANAS_JUL,
    demandas: demandas, hojeEpoch: diaJ(15),
  });
  const linha = html.match(/<tr class="linha-consolidado">[\s\S]*?<\/tr>/)[0];
  assert.ok(linha.indexOf('>20<') !== -1,
    'S2 teve 20 furos; congelar o Realizado no 1o dia dela daria 0');
});

test('semana futura usa a projecao de hoje, e o cabecalho diz isso', () => {
  const html = renderAbaConsolidado(REGISTROS, [0], {
    semanaIdx: 4, dimensao: 'volume', mesIdx: 6, semanas: SEMANAS_JUL,
    demandas: demandasEspalhadas('SUP-0001-24'), hojeEpoch: diaJ(15),
  });
  const cabecalho = html.match(/<thead>[\s\S]*?<\/thead>/)[0];
  assert.ok(cabecalho.indexOf('projeção de hoje') !== -1);
  assert.strictEqual(cabecalho.indexOf('congelada'), -1);
});

test('semana encerrada e semana em curso trazem a data-ancora no cabecalho', () => {
  const demandas = demandasEspalhadas('SUP-0001-24');
  const encerrada = renderAbaConsolidado(REGISTROS, [0], {
    semanaIdx: 1, dimensao: 'volume', mesIdx: 6, semanas: SEMANAS_JUL, demandas, hojeEpoch: diaJ(15),
  });
  assert.ok(encerrada.indexOf('congelada em 06/07') !== -1, 'S2 comeca em 06/07');
  const emCurso = renderAbaConsolidado(REGISTROS, [0], {
    semanaIdx: 2, dimensao: 'volume', mesIdx: 6, semanas: SEMANAS_JUL, demandas, hojeEpoch: diaJ(15),
  });
  assert.ok(emCurso.indexOf('congelada em 13/07') !== -1, 'S3 comeca em 13/07');
});
```

`REGISTROS` é a fixture de registros do arquivo (SUP `SUP-0001-24`, tipologia `ST`, com `previsto.volume[6]` positivo). Se o nome local for outro, usar o que está lá. `formatarNumero` é a função local do próprio módulo de teste ou do render — se não estiver acessível, comparar pelo número formatado à mão em `pt-BR` com 0 casas.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-render-aba-consolidado.test.js`
Expected: FAIL — Previsto ainda é coluna, e a Tendência exibida é a de hoje.

- [ ] **Step 3: Implementar**

3a. Acrescentar, perto dos outros helpers de formatação do arquivo, o formatador de data-âncora (o módulo não tem um que devolva só `dd/MM`):

```js
// '06/07' -- só o 1º dia da semana, sem o intervalo que formatarIntervaloSemana
// devolve. Mesma reconstrução de Date por multiplicação usada no resto do
// projeto: diaEpoch nunca ajusta fuso, então o produto cai na meia-noite UTC
// daquele dia e getUTC* lê o dia civil certo em qualquer fuso.
function dataCurta(diaEp) {
  var d = new Date(diaEp * 86400000);
  var dia = d.getUTCDate();
  var mes = d.getUTCMonth() + 1;
  return (dia < 10 ? '0' : '') + dia + '/' + (mes < 10 ? '0' : '') + mes;
}
```

3b. `renderCabecalho` passa a receber o modo do congelamento e perde a coluna Previsto:

```js
// 'congeladaEm' é o diaEpoch do 1º dia da semana quando a Tendência está
// congelada, ou null quando ela é a projeção de hoje (semana futura). O
// rótulo TEM de dizer qual das duas está na tela: as duas se chamam
// "Tendência" e significam coisas opostas -- uma é registro histórico do que
// se projetava naquele momento, a outra é a projeção corrente.
function renderCabecalho(dimensao, semana, congeladaEm) {
  var sufixo = semana ? ' (' + formatarIntervaloSemana(semana.inicio, semana.fim) + ')' : '';
  var rotuloTendencia = congeladaEm === null || congeladaEm === undefined
    ? 'Tendência (projeção de hoje)'
    : 'Tendência congelada em ' + dataCurta(congeladaEm);
  var ths = '<th>SUP</th><th>Grupo</th><th>Tomador</th><th>Tipologia</th>'
    + '<th class="num">Realizado' + escapeHtml(sufixo) + '</th>'
    + '<th class="num">' + escapeHtml(rotuloTendencia) + escapeHtml(sufixo) + '</th>';
  colunasExtras(dimensao).forEach(function (c, i) {
    ths += '<th class="num cabecalho-premissa' + (i === 0 ? ' cabecalho-premissa-inicio' : '') + '">'
      + escapeHtml(c.rotulo) + '</th>';
  });
  return '<thead><tr>' + ths + '</tr></thead>';
}
```

3c. `renderLinha` passa a usar DUAS séries e a emitir 2 células de valor:

```js
function renderLinha(celulas, classe, registros, indices, ctx) {
  // Realizado sai SEMPRE do hoje real: congelar o Realizado mostraria ~0 numa
  // semana que de fato produziu, porque a contagem pararia no 1º dia dela.
  var seriesAoVivo = calcularSeriesSemanaisDimensao(
    registros, indices, ctx.dimensao, ctx.mesIdx, ctx.semanas, ctx.numSemanas,
    ctx.temSemanasReais, ctx.indiceAtual, ctx.demandas, ctx.hojeEpoch
  );
  // Tendência sai do hoje EFETIVO: igual ao real na semana futura, e o 1º dia
  // da semana quando ela está congelada. Nesse recálculo aquela semana É a
  // vigente, então o valor devolvido é a projeção que se fazia para ela
  // inteira no momento em que ela começou.
  var seriesTendencia = ctx.hojeEfetivo === ctx.hojeEpoch ? seriesAoVivo : calcularSeriesSemanaisDimensao(
    registros, indices, ctx.dimensao, ctx.mesIdx, ctx.semanas, ctx.numSemanas,
    ctx.temSemanasReais, ctx.indiceAtualEfetivo, ctx.demandas, ctx.hojeEfetivo
  );
  function celulaSemana(fatias) {
    var v = Array.isArray(fatias) ? fatias[ctx.semanaIdx] : null;
    if (v === null || v === undefined) return '<td class="num sem-dado"></td>';
    return '<td class="num">' + formatarNumero(v, 0) + '</td>';
  }
  var html = '<tr class="' + classe + '">' + celulas
    + celulaSemana(seriesAoVivo.semanasRealizado)
    + celulaSemana(seriesTendencia.semanasTendenciaCompleta);
  colunasExtras(ctx.dimensao).forEach(function (c, i) {
    html += '<td class="num celula-premissa' + (i === 0 ? ' celula-premissa-inicio' : '') + '">'
      + formatarNumero(valorExtra(c.chave, registros, indices, ctx.mesIdx), c.casas) + '</td>';
  });
  return html + '</tr>';
}
```

3d. Em `renderAbaConsolidado`, decidir o congelamento uma vez e pôr os dois epochs no `ctx`:

```js
  // Congela na semana JÁ COMEÇADA (encerrada ou em curso): inicio <= hoje.
  // A futura (inicio > hoje) não tem o que congelar -- nunca começou.
  var semanaEscolhida = semanas[semanaIdx];
  var congelar = !!semanaEscolhida && typeof o.hojeEpoch === 'number'
    && semanaEscolhida.inicio <= o.hojeEpoch;
  var hojeEfetivo = congelar ? semanaEscolhida.inicio : o.hojeEpoch;
```

e no objeto `ctx`, junto do que já existe:

```js
    hojeEfetivo: hojeEfetivo,
    indiceAtualEfetivo: typeof hojeEfetivo === 'number' ? indiceSemanaAtual(semanas, hojeEfetivo) : -1,
```

3e. A chamada de `renderCabecalho` no `return` passa o terceiro argumento:

```js
    + '<table id="tabela-consolidado">' + renderCabecalho(dimensao, semanas[semanaIdx], congelar ? hojeEfetivo : null)
```

3f. Atualizar `renderNota(dimensao)` para mencionar o congelamento — a nota de rodapé já explica que as premissas são do MÊS ao lado de colunas da semana; acrescentar uma frase dizendo que a Tendência das semanas já começadas é a que se projetava no 1º dia delas, e que ela é recalculada (um lançamento retroativo no Avanço Sond a altera).

- [ ] **Step 4: Rodar os testes**

Run: `node --test test/*.test.js`
Expected: PASS. Testes pré-existentes que contavam colunas do Consolidado ou esperavam a célula de Previsto vão precisar de ajuste — o número de `<th>` caiu de 7+premissa para 6+premissa. Ajuste o valor esperado, **nunca enfraqueça a asserção**.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/render-aba-consolidado.js test/semanal-render-aba-consolidado.test.js
git commit -m "Consolidado: sai o Previsto, a Tendencia das semanas ja comecadas congela"
```

---

### Task 3: Consolidado usa a dimensão da barra compartilhada

**Files:**
- Modify: `tools/semanal/render-aba-consolidado.js` (`renderControles`, que hoje emite o `<select id="consolidado-dimensao">`)
- Modify: `tools/semanal/render-semanal.js` (`ESTADO_CONSOLIDADO`, `montarAbaConsolidado`, e a chamada que passa `dimensao`)
- Test: `test/semanal-render-aba-consolidado.test.js`, `test/semanal-render-semanal-wireup.test.js`

**Interfaces:**
- Consumes: o resultado da Task 2 (`renderAbaConsolidado` com `opcoes.dimensao`).
- Produces: `opcoes.dimensao` continua existindo e sendo obrigatório — o que muda é QUEM o preenche.

- [ ] **Step 1: Escrever os testes que falham**

Em `test/semanal-render-aba-consolidado.test.js`:

```js
test('o seletor proprio de dimensao nao existe mais nos controles', () => {
  const html = renderAbaConsolidado(REGISTROS, [0], {
    semanaIdx: 0, dimensao: 'volume', mesIdx: 6, semanas: SEMANAS_JUL,
    demandas: demandasEspalhadas('SUP-0001-24'), hojeEpoch: diaJ(15),
  });
  assert.strictEqual(html.indexOf('id="consolidado-dimensao"'), -1);
  assert.ok(html.indexOf('id="consolidado-semana"') !== -1, 'o de semana continua -- e proprio da aba');
});

test('a dimensao recebida ainda troca as colunas de premissa', () => {
  const base = { semanaIdx: 0, mesIdx: 6, semanas: SEMANAS_JUL, demandas: demandasEspalhadas('SUP-0001-24'), hojeEpoch: diaJ(15) };
  const volume = renderAbaConsolidado(REGISTROS, [0], Object.assign({ dimensao: 'volume' }, base));
  assert.ok(volume.indexOf('Equipes previstas') !== -1);
  assert.strictEqual(volume.indexOf('Ticket médio'), -1);
  const financeiro = renderAbaConsolidado(REGISTROS, [0], Object.assign({ dimensao: 'financeiro' }, base));
  assert.ok(financeiro.indexOf('Ticket médio') !== -1);
  assert.strictEqual(financeiro.indexOf('Equipes previstas'), -1);
});
```

Em `test/semanal-render-semanal-wireup.test.js` (montando a página com `paginaCrua()`, o helper que os testes da leva anterior já criaram — se não existir, montar com `renderSemanal({...})` como os vizinhos):

```js
test('a aba Consolidado le a dimensao da barra compartilhada, nao de um seletor proprio', () => {
  const html = paginaCrua();
  assert.strictEqual(html.indexOf("getElementById('consolidado-dimensao')"), -1,
    'o listener do seletor proprio nao pode mais existir');
  assert.ok(/dimensao: dimensoesSelecionadas\(\)\[0\]|dimensao: dimensoes\[0\]/.test(html),
    'montarAbaConsolidado tem de tirar a dimensao da barra');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-render-aba-consolidado.test.js test/semanal-render-semanal-wireup.test.js`
Expected: FAIL — o `<select>` e o listener ainda existem.

- [ ] **Step 3: Implementar**

3a. Em `render-aba-consolidado.js`, `renderControles`: apagar o bloco que emite o `<label>` + `<select id="consolidado-dimensao">` com suas `<option>`. O controle de **semana** fica.

3b. Em `render-semanal.js`: trocar `var ESTADO_CONSOLIDADO = { semana: null, dimensao: 'volume' };` por

```js
// 'dimensao' saiu daqui em 2026-08-04: a aba passou a usar a PRIMEIRA marcada
// na barra compartilhada, igual à aba Alertas (a tabela tem um jogo de colunas
// de valor só, não dá pra empilhar dimensões nela). Consequência assumida: a
// aba não abre mais em Volume, abre no que a barra tiver -- então as colunas
// de premissa que aparecem de saída são as de Financeiro (Ticket médio).
var ESTADO_CONSOLIDADO = { semana: null };
```

e apagar o comentário acima dele que explicava o default em Volume.

3c. `montarAbaConsolidado` passa a receber a lista de dimensões, exatamente como `recalcularAlertasSemanal(indices, dimensoes)` já recebe, e usa a primeira:

```js
function montarAbaConsolidado(registros, indices, dimensoes) {
  var dimensao = dimensoes[0];
```

e na chamada de `dimensao:` dentro dela, trocar `ESTADO_CONSOLIDADO.dimensao` por `dimensao`. Há **duas** chamadas de `montarAbaConsolidado` a ajustar: a de `recalcularSemanal()` (que já tem `dimensoes` em escopo — passe-a) e a recursiva de dentro do listener do seletor de semana (passe a mesma `dimensoes` que a função recebeu).

Em `recalcularSemanal()`, o comentário logo acima da chamada diz hoje:

```
  // O Consolidado usa a dimensão PRÓPRIA dele (volume/financeiro), não a da
  // barra -- mas o RECORTE de registros é o mesmo das outras abas.
```

Ele passou a ser falso — reescreva dizendo que a aba usa a primeira dimensão da barra, igual à de Alertas.

3d. Apagar o bloco do listener `var seletorDimensao = document.getElementById('consolidado-dimensao'); ...` inteiro.

3e. Nada a fazer para o redesenho: `aoMudarSemanal(cfg)` já chama `recalcularSemanal()`, que já chama `montarAbaConsolidado`. Trocar a dimensão na barra passa a redesenhar a aba automaticamente. **Confirme** que é assim antes de seguir; se não for, ligue.

- [ ] **Step 4: Rodar os testes**

Run: `node --test test/*.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/render-aba-consolidado.js tools/semanal/render-semanal.js test/
git commit -m "Consolidado segue o seletor de dimensao da barra compartilhada"
```

---

### Task 4: Módulo do filtro de ativos + o check na barra compartilhada

**Files:**
- Create: `tools/semanal/filtro-ativos.js`
- Modify: `tools/semanal/render-semanal.js` (`MARKUP_ACOES_SEMANAL`, `BUNDLE_ARQUIVOS`, estado e listener)
- Modify: `tools/semanal/render-aba-balanco.js` (`renderControles`: remover o checkbox próprio)
- Test: `test/semanal-filtro-ativos.test.js`

**Interfaces:**
- Consumes: `chaveMatriz`-equivalente já usado no projeto para indexar `demandas.porRegistroEventos` (a chave é `sup + '||' + tipologia`).
- Produces: `indicesAtivos(registros, indices, dimensao, mesIdx, demandas, intervaloEpoch) -> array de índices`, e `registroAtivo(registro, dimensao, mesIdx, demandas, intervaloEpoch) -> boolean`. `intervaloEpoch` é `{ inicio, fim }` em diaEpoch (o mês selecionado) ou `null`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `test/semanal-filtro-ativos.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { indicesAtivos, registroAtivo } = require('../tools/semanal/filtro-ativos.js');
const { semanasDoMes, diaEpoch } = require('../tools/semanal/compute-semanal.js');

const MES = 6; // julho
const SEMANAS = semanasDoMes(2026, MES);
const INTERVALO = { inicio: SEMANAS[0].inicio, fim: SEMANAS[SEMANAS.length - 1].fim };
const diaJ = (d) => diaEpoch(new Date(Date.UTC(2026, MES, d)));

function reg(sup, previstoVol, realizadoVol) {
  const zeros = () => new Array(12).fill(0);
  const p = zeros(); p[MES] = previstoVol;
  const r = zeros(); r[MES] = realizadoVol;
  return {
    sup: sup, tipologia: 'ST',
    previsto: { volume: p, financeiro: zeros(), equipes: zeros() },
    realizado: { volume: r, financeiro: zeros(), equipes: zeros() },
  };
}

test('previsto positivo basta para estar ativo', () => {
  assert.strictEqual(registroAtivo(reg('A', 10, 0), 'volume', MES, null, INTERVALO), true);
});

test('realizado positivo basta, mesmo sem previsto', () => {
  assert.strictEqual(registroAtivo(reg('A', 0, 7), 'volume', MES, null, INTERVALO), true);
});

test('sem previsto e sem realizado no mes, esta inativo', () => {
  assert.strictEqual(registroAtivo(reg('A', 0, 0), 'volume', MES, null, INTERVALO), false);
});

test('furo no Avanco Sond dentro do mes ativa o registro mesmo com a MATRIZ zerada', () => {
  const demandas = { porRegistroEventos: { 'A||ST': { sondagemRealizada: [diaJ(9)], chegada: [], saidaEstoque: [] } } };
  assert.strictEqual(registroAtivo(reg('A', 0, 0), 'volume', MES, demandas, INTERVALO), true);
});

test('furo FORA do mes nao ativa', () => {
  const foraDoMes = diaEpoch(new Date(Date.UTC(2026, 5, 9))); // junho
  const demandas = { porRegistroEventos: { 'A||ST': { sondagemRealizada: [foraDoMes], chegada: [], saidaEstoque: [] } } };
  assert.strictEqual(registroAtivo(reg('A', 0, 0), 'volume', MES, demandas, INTERVALO), false);
});

test('indicesAtivos preserva a ORDEM e devolve so os ativos', () => {
  const registros = [reg('A', 10, 0), reg('B', 0, 0), reg('C', 0, 3)];
  assert.deepStrictEqual(indicesAtivos(registros, [0, 1, 2], 'volume', MES, null, INTERVALO), [0, 2]);
});

test('mes fora de [0,11] nao ativa ninguem pela MATRIZ -- nao estoura o array', () => {
  assert.strictEqual(registroAtivo(reg('A', 10, 0), 'volume', 99, null, INTERVALO), false);
});

test('a dimensao importa: ativo em volume pode estar inativo em financeiro', () => {
  const r = reg('A', 10, 0);
  assert.strictEqual(registroAtivo(r, 'volume', MES, null, INTERVALO), true);
  assert.strictEqual(registroAtivo(r, 'financeiro', MES, null, INTERVALO), false);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-filtro-ativos.test.js`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Escrever o módulo**

Criar `tools/semanal/filtro-ativos.js`:

```js
'use strict';

// "SUP ativo no período" -- a MESMA definição que o Balanço de massa já usava
// no seu checkbox próprio (compute-balanco.js: previsto positivo OU realizado
// positivo), extraída aqui em 2026-08-04 para virar filtro da página inteira.
//
// A atividade é medida no MÊS selecionado, nunca na semana: por semana, uma
// linha apareceria e sumiria a cada troca de semana, o que lê como defeito e
// não como filtro.
//
// Este módulo NÃO entra em indicesFiltrados (tools/comum/render-shell.js): os
// filtros de lá recortam por propriedade do registro (origem, categoria,
// tipologia, grupo, SUP) e não conhecem período nenhum. "Ativo" depende do mês
// que a aba está mostrando, então é estado compartilhado aplicado POR ABA.

function ehPositivo(v) { return typeof v === 'number' && v > 0; }

function valorDoMes(bloco, dimensao, mesIdx) {
  var mensal = bloco && bloco[dimensao];
  if (!Array.isArray(mensal)) return null;
  var v = mensal[mesIdx];
  return (v === null || v === undefined) ? null : v;
}

// Houve furo executado deste registro dentro do intervalo? É o que torna
// ativo um registro cuja linha na MATRIZ está zerada mas que produziu de fato
// -- o mesmo Avanço Sond que alimenta o Realizado das outras abas.
function teveFuroNoIntervalo(registro, demandas, intervaloEpoch) {
  if (!demandas || !demandas.porRegistroEventos || !intervaloEpoch) return false;
  var entrada = demandas.porRegistroEventos[registro.sup + '||' + registro.tipologia];
  var dias = entrada && entrada.sondagemRealizada;
  if (!Array.isArray(dias)) return false;
  for (var i = 0; i < dias.length; i++) {
    if (dias[i] >= intervaloEpoch.inicio && dias[i] <= intervaloEpoch.fim) return true;
  }
  return false;
}

function registroAtivo(registro, dimensao, mesIdx, demandas, intervaloEpoch) {
  if (!registro) return false;
  if (ehPositivo(valorDoMes(registro.previsto, dimensao, mesIdx))) return true;
  if (ehPositivo(valorDoMes(registro.realizado, dimensao, mesIdx))) return true;
  return teveFuroNoIntervalo(registro, demandas, intervaloEpoch);
}

function indicesAtivos(registros, indices, dimensao, mesIdx, demandas, intervaloEpoch) {
  return (indices || []).filter(function (i) {
    return registroAtivo(registros[i], dimensao, mesIdx, demandas, intervaloEpoch);
  });
}

module.exports = { indicesAtivos, registroAtivo };
```

- [ ] **Step 4: Pôr o checkbox na barra e tirar o do Balanço**

4a. Em `render-semanal.js`, `MARKUP_ACOES_SEMANAL`: acrescentar o checkbox logo antes do `<button id="limpar-filtros">`:

```html
        <label class="controle-ativos-semanal"><input type="checkbox" id="somente-ativos" checked> Somente SUPs ativos no período</label>
```

4b. Declarar o estado compartilhado perto dos outros estados de aba:

```js
// Ligado por padrão -- era o default do checkbox próprio do Balanço, e a
// grade de origem é densa o bastante para que "tudo" seja ruído.
var SOMENTE_ATIVOS = true;
```

4c. Ligar o listener junto dos outros listeners da barra. `recalcularSemanal()` é a função que redesenha a página inteira (é o que `aoMudarSemanal` chama a cada mudança de filtro):

```js
  document.getElementById('somente-ativos').addEventListener('change', function (e) {
    SOMENTE_ATIVOS = e.target.checked;
    recalcularSemanal();
  });
```

Ponha essa ligação no mesmo lugar onde os outros controles da barra de ações são ligados (o do `seletor-mes-semanal` e os dois botões).

4d. Em `render-aba-balanco.js`, `renderControles`: apagar as três linhas que emitem o `<label class="controle-balanco controle-balanco-check">` com o `<input id="balanco-somente-ativos">`. **Não** mexa em `opcoes.somenteAtivos` nem na lógica que filtra as `linhas` — ela continua igual, só passa a ser alimentada pelo estado compartilhado.

4e. Em `render-semanal.js`, `ESTADO_BALANCO`: remover `somenteAtivos: true` do objeto e passar `somenteAtivos: SOMENTE_ATIVOS` na chamada de `montarAbaBalanco`; apagar o listener `document.getElementById('balanco-somente-ativos')`.

4f. `BUNDLE_ARQUIVOS`: acrescentar `'filtro-ativos.js'` — ele não consome nenhum módulo same-dir, então pode entrar no início da lista, junto de `compute-semanal.js`. Declare também `var FiltroAtivos = MODULOS['filtro-ativos.js'];` junto das outras.

4g. CSS: acrescentar em `CSS_SEMANAL` a regra do rótulo novo, reaproveitando os tokens existentes:

```css
  .controle-ativos-semanal { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); }
```

- [ ] **Step 5: Rodar os testes**

Run: `node --test test/*.test.js`
Expected: PASS. Testes de wire-up do Balanço que procuravam `balanco-somente-ativos` precisam apontar para `somente-ativos` — ajuste o seletor, não a asserção.

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/filtro-ativos.js tools/semanal/render-semanal.js tools/semanal/render-aba-balanco.js test/
git commit -m "Somente SUPs ativos vira filtro da pagina inteira, na barra compartilhada"
```

---

### Task 5: Aplicar o filtro de ativos nas abas

**Files:**
- Modify: `tools/semanal/render-semanal.js` (as funções que montam Semanal, Alertas e Consolidado)
- Test: `test/semanal-render-semanal-wireup.test.js`

**Interfaces:**
- Consumes: `indicesAtivos(registros, indices, dimensao, mesIdx, demandas, intervaloEpoch)` (Task 4); `SOMENTE_ATIVOS` (Task 4).
- Produces: nada.

**O que este filtro faz em cada aba — leia antes de implementar, porque não é uniforme:**

- **Consolidado e Alertas**: têm linha por SUP/tipologia. O filtro ESCONDE linhas. É onde ele se vê.
- **Semanal**: NÃO tem linha por SUP — mostra Previsto/Realizado/Tendência agregados por semana. Filtrar não esconde nada; muda só os agregados, e para P/R/T isso é matematicamente nulo (um registro inativo tem previsto e realizado zerados, contribuindo zero). O ÚNICO número que muda de verdade é **Demandas Pendentes**, que soma estoque em aberto e pode ter saldo num registro sem movimento no mês. Aplicar mesmo assim, para a página inteira responder ao mesmo recorte.
- **Balanço**: já resolvido na Task 4 (lê o estado compartilhado, lógica própria inalterada).
- **Gráficos e Demandas**: NÃO aplicar. Gráficos soma tudo numa série só, onde inativo contribui zero — código sem efeito. Demandas lê o agregado do Avanço Sond por tipologia e não quebra por registro da MATRIZ.

- [ ] **Step 1: Escrever os testes que falham**

Em `test/semanal-render-semanal-wireup.test.js`, um teste de ponta a ponta que roda os `<script>` da página no `vm.Context` (use `montarSandbox`, o helper que o arquivo já tem, e siga o padrão dos testes de wire-up vizinhos que digitam a senha e leem o `innerHTML` de uma seção):

```js
test('com o check ligado, SUP sem movimento no mes some da aba Consolidado; desligado, volta', async () => {
  // Um SUP com previsto no mês e outro inteiramente zerado.
  const registros = [
    registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000),
    registroSintetico('SUP-0002-24', 'Tomador-Sintetico-Gama', 0),
  ];
  const html = renderSemanal({
    registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z'),
  });
  const { sandbox, documentoFalso } = montarSandbox(html);
  // Mesma sequência de desbloqueio dos testes vizinhos deste arquivo.
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  const comCheck = documentoFalso.getElementById('secao-consolidado').innerHTML;
  assert.ok(comCheck.indexOf('SUP-0001-24') !== -1, 'o SUP com movimento fica');
  assert.strictEqual(comCheck.indexOf('SUP-0002-24'), -1, 'o zerado some com o check ligado');

  documentoFalso.getElementById('somente-ativos').checked = false;
  documentoFalso.getElementById('somente-ativos').dispatchEvent({ type: 'change' });
  const semCheck = documentoFalso.getElementById('secao-consolidado').innerHTML;
  assert.ok(semCheck.indexOf('SUP-0002-24') !== -1, 'desligado, o zerado volta');
});
```

Se o DOM falso (`test/helpers/dom-falso-semanal.js`) não suportar `dispatchEvent` nem a propriedade `checked`, **estenda o helper** — é infraestrutura de teste legítima, a leva anterior já registrou essa limitação como pendência conhecida, e sem ela o caminho do checkbox fica sem cobertura nenhuma.

Se a extensão do helper se mostrar grande demais para caber nesta tarefa, o plano B é: no lugar do `dispatchEvent`, chamar `sandbox.recalcularSemanal()` depois de setar `sandbox.SOMENTE_ATIVOS = false` diretamente, e cobrir o `addEventListener` por um assert de texto sobre o HTML gerado (`assert.ok(/getElementById\('somente-ativos'\)\.addEventListener/.test(html))`). Se você usar o plano B, **diga isso explicitamente no relatório** — o revisor precisa saber que o clique real no checkbox não está exercitado.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-render-semanal-wireup.test.js`
Expected: FAIL — o SUP zerado aparece nos dois casos.

- [ ] **Step 3: Implementar**

Em `render-semanal.js`, criar UMA função que os três pontos usam, para não haver três definições de "os índices desta aba":

```js
// Os índices que uma aba deve mostrar: os já filtrados pela barra, e depois
// só os ativos, se o check estiver ligado. Fica aqui e não em
// indicesFiltrados porque "ativo" depende do MÊS que a aba mostra -- ver o
// comentário no topo de filtro-ativos.js.
function indicesDaAba(indices, dimensao) {
  if (!SOMENTE_ATIVOS) return indices;
  var semanas = semanasDoMesSelecionado();
  var intervalo = semanas.length
    ? { inicio: semanas[0].inicio, fim: semanas[semanas.length - 1].fim }
    : null;
  return FiltroAtivos.indicesAtivos(
    window.__REGISTROS__, indices, dimensao, mesSelecionadoIdx, window.__DEMANDAS__, intervalo
  );
}
```

e usá-la em: `montarAbaConsolidado` (com a dimensão que a Task 3 passou a ler da barra), `recalcularAlertasSemanal` (com a `dimensao` que ela já calcula) e a montagem da aba Semanal (uma vez por dimensão exibida, já que o recorte de ativos depende da dimensão).

**Não** aplicar em Gráficos nem em Demandas, pelos motivos listados acima.

- [ ] **Step 4: Rodar os testes**

Run: `node --test test/*.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/render-semanal.js test/
git commit -m "Filtro de ativos aplicado nas abas Semanal, Alertas e Consolidado"
```

---

### Task 6: Revisão de design

**Files:**
- Modify: `tools/semanal/render-semanal.js` e/ou `tools/semanal/render-aba-consolidado.js`, conforme o que valer a pena

**Interfaces:**
- Consumes: a página construída nas Tasks 1-5.
- Produces: nada.

O `CLAUDE.md` exige revisão de design do Open Design para trabalho de HTML, **e manda seguir sem ele se não estiver disponível na máquina**.

- [ ] **Step 1: Verificar se as ferramentas `mcp__open-design__*` respondem.** Se responderem, criar um projeto DEDICADO (`create_project` com `skill: "design-review"`) — nunca o projeto "Projetos IA", que tem `skill: agent-browser` e devolve `succeeded` com `artifactCount: 0` sem fazer nada. Gerar um snapshot estático que RENDERIZE a aba Consolidado com dados SINTÉTICOS e o CSS extraído do `<style>` emitido, rodar `start_run` com `agent: "claude"` e `skill: "design-review"`, conferir o `events.jsonl` antes de concluir (um run pode morrer com `rate_limit` e ainda ter editado arquivos), e portar à mão o que valer.

- [ ] **Step 2 (se o Open Design NÃO estiver disponível): passada de design à mão.** Conferir quatro coisas concretas no markup e no CSS emitidos:
  - o cabeçalho "Tendência congelada em dd/MM" é mais longo que os rótulos que ele substituiu — ele quebra linha, empurra as colunas de premissa ou desalinha o `<thead>` do `<tbody>`?
  - com uma coluna a menos (Previsto saiu), a faixa das colunas de premissa (`cabecalho-premissa-inicio`) ainda começa no lugar certo;
  - o checkbox novo na barra de ações fica alinhado com o seletor de mês e os dois botões ao lado, e não quebra a barra numa segunda linha em largura média;
  - o indicador de status sem o anel continua legível nos 4 status que sobraram bem — e registrar que o "Excelente" ficou fraco de propósito.

- [ ] **Step 3: Rodar os testes e commitar**

Run: `node --test test/*.test.js`
Expected: PASS.

```bash
git add tools/semanal/
git commit -m "Incorpora a revisao de design"
```

---

### Task 7: Revisão de código

**Files:**
- Modify: o que a revisão apontar

**Interfaces:**
- Consumes: tudo das Tasks 1-6.
- Produces: nada.

- [ ] **Step 1: Rodar a revisão** com `superpowers:requesting-code-review` sobre o diff completo do branch contra `origin/master`.

- [ ] **Step 2: Tratar os achados** com `superpowers:receiving-code-review` — verificar cada um antes de implementar. Dar atenção especial a:
  - o congelamento devolve mesmo a projeção do 1º dia da semana, e o Realizado exibido continua sendo o de hoje (são duas séries diferentes na mesma linha — trocá-las é invisível a olho nu);
  - o custo de calcular duas séries por linha não estourou nada na tabela cheia;
  - "ativo" tem UMA definição só no código, e o Balanço não ficou com uma segunda;
  - nenhuma aba ficou lendo `ESTADO_CONSOLIDADO.dimensao`, que não existe mais.

- [ ] **Step 3: Rodar os testes e commitar**

Run: `node --test test/*.test.js`
Expected: PASS.

```bash
git add -A
git commit -m "Corrige os achados da revisao de codigo"
```

---

### Task 8: Reconstruir, sincronizar `docs/` e publicar

**Files:**
- Modify: `dist/planejamento-semanal.html`, `docs/planejamento-semanal.html`, `CLAUDE.md`

**Interfaces:**
- Consumes: tudo das Tasks 1-7.
- Produces: a publicação.

**Esta tarefa é da sessão que verificou o trabalho, nunca de um subagente no meio do pipeline: nada é publicado antes das revisões das Tasks 6 e 7 passarem.**

- [ ] **Step 1: Reconstruir**

```bash
ORCAMENTO_SENHA='<pedir ao dono do projeto>' node tools/semanal/build-dashboard.js
```

A senha é env var e nunca entra em arquivo do repositório. O build lê as planilhas em `G:\Meu Drive\PMO\...`, então exige o Google Drive montado.

- [ ] **Step 2: Sincronizar `docs/`**

```bash
cp dist/planejamento-semanal.html docs/planejamento-semanal.html
```

O Pages serve `/docs`, não `/dist`, e nada copia automaticamente.

- [ ] **Step 3: Rodar a bateria inteira**

Run: `node --test test/*.test.js`
Expected: PASS, incluindo `publicacao-docs-sincronizado.test.js` e `orcamento-html-inalterado.test.js`.

- [ ] **Step 4: Registrar no `CLAUDE.md`**

Acrescentar à seção "Planejamento Semanal" um bloco "Consolidado congelado e filtro de ativos (2026-08-04)" com: as colunas novas do Consolidado; o congelamento por recálculo e a ressalva do lançamento retroativo; que a aba é exceção deliberada à regra 2.1; a definição única de "ativo" e o fato de o filtro NÃO caber em `indicesFiltrados`; que Gráficos e Demandas ficam de fora e por quê; e que o anel do `.status-circulo` foi removido de propósito, com o contraste do "Excelente" como preço aceito.

- [ ] **Step 5: Commitar e publicar**

```bash
git add dist/planejamento-semanal.html docs/planejamento-semanal.html CLAUDE.md
git commit -m "Rebuild: Consolidado congelado, filtro global de ativos e ajustes"
git push origin semanal-consolidado-congelado:master
```

O `master` local está velho/divergente — publicar sempre por `push <branch>:master`, nunca por merge local.

- [ ] **Step 6: Confirmar a publicação pelo conteúdo**

```bash
curl -s https://amcaccere261283.github.io/orcamento-dashboard/planejamento-semanal.html | grep -c "somente-ativos"
```

Expected: maior que zero, e o HTML servido batendo com `dist/planejamento-semanal.html`. Não confiar no status da API de builds do Pages: em 2026-07-22 ele reportou "built" servindo um build de dois commits antes.
