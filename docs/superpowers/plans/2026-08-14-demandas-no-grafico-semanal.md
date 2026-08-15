# Demandas no Gráfico do Planejamento Semanal — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Acrescentar a série "Demandas" (chegadas, roxa `#9700DA`) à aba Gráficos do Planejamento Semanal, dimensão Volume — 4ª barra no painel Semanal e 4ª linha no painel Acumulado, com o Acumulado nascendo do saldo de abertura do mês.

**Architecture:** Todo o cálculo é client-side, dentro de `tools/semanal/render-aba-grafico-semanal.js`. O cliente já recebe `demandas.porRegistroEventos[chave].chegada` (array de dia-epoch) e `semanas[].inicio/fim` (dia-epoch), então não há mudança de build, de blob cifrado nem de golden. Uma função nova bucketiza as chegadas por semana; o saldo de abertura reusa `pendentesNaData`, já exportada de `render-aba-semanal.js`.

**Tech Stack:** Node.js puro, sem dependências. Testes com `node:test`/`node:assert`. O módulo roda no Node (testes) e embrulhado no navegador via `tools/comum/browser-bundle.js`.

**Spec:** `docs/superpowers/specs/2026-08-14-demandas-no-grafico-semanal-design.md` — leia antes de começar.

## Global Constraints

- **`var`/`function`, nunca `const`/`let`/arrow** em `render-aba-grafico-semanal.js`. O módulo entra no bundle do navegador. (Nos arquivos de TESTE, `const` é o padrão do repositório — só o módulo bundlado tem essa restrição.)
- **`require` só na forma `require('./arquivo.js')`, mesmo diretório.** É a forma exata que a reescrita de `tools/comum/browser-bundle.js` reconhece. Dependência de outro diretório é REMOVIDA do bundle, não reescrita.
- **Cor da série: `#9700DA`** (roxo de Demandas do projeto inteiro). Não confundir com `#a78bfa` (lavanda, `realizadoPrevistoInicial` do orçamento).
- **Rótulo da série: `Demandas`.** Tracejado: `4,3`.
- **A série existe SÓ quando `dimensao === 'volume'`.** Equipes e Financeiro continuam com 3 séries.
- **Rodar a suíte inteira** (`node --test test/*.test.js`) antes de cada commit, não só o arquivo tocado.
- **Nada é publicado antes das revisões passarem.** A publicação é a Task 3, e só ela.
- Branch de trabalho: `semanal-demandas-grafico` (já criada, baseada em `origin/master`).

---

### Task 1: `chegadasSemanaisPorIndices` — bucketizar as chegadas por semana

**Files:**
- Modify: `tools/semanal/render-aba-grafico-semanal.js` (acrescenta 2 funções + 1 export)
- Test: `test/semanal-render-aba-grafico-semanal.test.js`

**Interfaces:**
- Consumes: `demandas.porRegistroEventos` (objeto `{ 'SUP||TIPOLOGIA': { chegada: number[], sondagemRealizada: number[], saidaEstoque: number[] } }`, valores em dia-epoch) e `semanas` (array de `{ inicio: number, fim: number }`, dia-epoch, de `semanasDoMes`).
- Produces: `chegadasSemanaisPorIndices(registros, indices, demandas, semanas) -> number[]` de tamanho `semanas.length`, exportada em `module.exports`. A Task 2 a consome.

- [ ] **Step 1: Escrever os testes que falham**

Acrescente ao FIM de `test/semanal-render-aba-grafico-semanal.test.js`. Note que `chegadasSemanaisPorIndices` entra no `require` do topo do arquivo — acrescente o nome ao destructure que já existe lá.

As semanas de julho/2026 são: **S1 = dias 1–5, S2 = 6–12, S3 = 13–19, S4 = 20–26, S5 = 27–31** (medido com `semanasDoMes(2026, 6)`; o corte é sempre dentro do mês).

```js
// --- Task 1: chegadas por semana -----------------------------------------

const SEMANAS_JULHO = require('../tools/semanal/compute-semanal.js').semanasDoMes(ANO, VIGENTE_JULHO);

// S1=dias 1-5, S2=6-12, S3=13-19, S4=20-26, S5=27-31 -> [2,2,1,1,1]
const EVENTOS_CHEGADAS = {
  chegada: [diaJul(1), diaJul(3), diaJul(8), diaJul(8), diaJul(15), diaJul(25), diaJul(28)],
  sondagemRealizada: [], saidaEstoque: [],
};

test('chegadasSemanaisPorIndices: bucketiza as chegadas nas semanas certas do mês', () => {
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': EVENTOS_CHEGADAS } };
  const resultado = chegadasSemanaisPorIndices([registro(100)], [0], demandas, SEMANAS_JULHO);
  assert.deepStrictEqual(resultado, [2, 2, 1, 1, 1]);
});

test('chegadasSemanaisPorIndices: semana sem chegada é 0, nunca null -- é contagem medida', () => {
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': { chegada: [diaJul(15)], sondagemRealizada: [], saidaEstoque: [] } } };
  const resultado = chegadasSemanaisPorIndices([registro(100)], [0], demandas, SEMANAS_JULHO);
  assert.deepStrictEqual(resultado, [0, 0, 1, 0, 0]);
  resultado.forEach((v) => assert.strictEqual(typeof v, 'number'));
});

test('chegadasSemanaisPorIndices: respeita indices -- registro fora do filtro não conta', () => {
  const outro = registro(100); outro.sup = 'SUP-0002-24';
  const demandas = {
    porRegistroEventos: {
      'SUP-0001-24||ST': EVENTOS_CHEGADAS,
      'SUP-0002-24||ST': EVENTOS_CHEGADAS,
    },
  };
  // Só o índice 0 passa no filtro: conta uma vez, não duas.
  assert.deepStrictEqual(chegadasSemanaisPorIndices([registro(100), outro], [0], demandas, SEMANAS_JULHO), [2, 2, 1, 1, 1]);
  // Os dois passam: dobra.
  assert.deepStrictEqual(chegadasSemanaisPorIndices([registro(100), outro], [0, 1], demandas, SEMANAS_JULHO), [4, 4, 2, 2, 2]);
});

test('chegadasSemanaisPorIndices: chave sem entrada em porRegistroEventos devolve zeros, sem lançar', () => {
  const demandas = { porRegistroEventos: {} };
  assert.deepStrictEqual(chegadasSemanaisPorIndices([registro(100)], [0], demandas, SEMANAS_JULHO), [0, 0, 0, 0, 0]);
});

test('chegadasSemanaisPorIndices: sem demandas devolve zeros, sem lançar', () => {
  assert.deepStrictEqual(chegadasSemanaisPorIndices([registro(100)], [0], undefined, SEMANAS_JULHO), [0, 0, 0, 0, 0]);
  assert.deepStrictEqual(chegadasSemanaisPorIndices([registro(100)], [0], {}, SEMANAS_JULHO), [0, 0, 0, 0, 0]);
});

test('chegadasSemanaisPorIndices: evento fora do mês exibido não entra em nenhuma semana', () => {
  const foraDoMes = {
    chegada: [
      diaEpoch(new Date(Date.UTC(2026, 5, 30))), // 30/jun -- véspera
      diaEpoch(new Date(Date.UTC(2026, 7, 1))),  // 01/ago -- dia seguinte ao fim
    ],
    sondagemRealizada: [], saidaEstoque: [],
  };
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': foraDoMes } };
  assert.deepStrictEqual(chegadasSemanaisPorIndices([registro(100)], [0], demandas, SEMANAS_JULHO), [0, 0, 0, 0, 0]);
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node --test test/semanal-render-aba-grafico-semanal.test.js`
Expected: FAIL com `chegadasSemanaisPorIndices is not a function` (ou `not defined`).

- [ ] **Step 3: Implementar**

Em `tools/semanal/render-aba-grafico-semanal.js`, logo DEPOIS de `var ORDEM_SERIES_GRAFICO = [...]` (linha ~76), acrescente as duas funções:

```js
// Mesma expressão de chaveMatriz (tools/comum/linha-base.js) -- duplicada de
// propósito, igual a render-aba-semanal.js:71 e compute-balanco.js:182, porque
// este módulo entra no bundle do navegador: as dependências de OUTRO diretório
// são removidas do bundle, não reescritas. Importá-la daqui quebraria a página
// publicada em silêncio.
function chaveDemandas(sup, tipologia) {
  return sup + '||' + tipologia;
}

// Chegadas de demanda por SEMANA, através dos registros em 'indices'. O evento
// 'chegada' de porRegistroEventos é a "Criação da OS" do furo (Link 1) e a
// "Criação" do ensaio de Lab (Links 4/5), já em dia-epoch -- a MESMA lista que
// pendentesNaData (render-aba-semanal.js) percorre pro estoque da Tabela.
//
// É a versão semanal de chegadasMensaisPorRegistro (compute-demandas.js), que
// faz o mesmo por MÊS no build do orçamento. Lá o bucketing precisou ir pro
// build porque o cliente do orçamento não tem data nenhuma; aqui roda no
// CLIENTE porque os eventos crus, datados, já chegam nele. Ver
// docs/superpowers/specs/2026-08-14-demandas-no-grafico-semanal-design.md.
//
// Semana sem chegada nenhuma é 0, nunca null: é contagem medida, e zero
// chegadas é informação -- ao contrário de semanasTendencia, onde null diz
// "não se projeta aqui".
function chegadasSemanaisPorIndices(registros, indices, demandas, semanas) {
  var porSemana = new Array((semanas || []).length).fill(0);
  if (!demandas || !demandas.porRegistroEventos) return porSemana;
  (indices || []).forEach(function (i) {
    var registro = registros[i];
    if (!registro) return;
    var entrada = demandas.porRegistroEventos[chaveDemandas(registro.sup, registro.tipologia)];
    if (!entrada) return;
    (entrada.chegada || []).forEach(function (dia) {
      for (var s = 0; s < semanas.length; s++) {
        if (dia >= semanas[s].inicio && dia <= semanas[s].fim) {
          porSemana[s] += 1;
          return;
        }
      }
    });
  });
  return porSemana;
}
```

E acrescente `chegadasSemanaisPorIndices` ao `module.exports` no fim do arquivo:

```js
module.exports = {
  renderAbaGraficoSemanal, construirPainelGraficoSemanalHtml,
  construirGraficoSemanalSvg, construirGraficoAcumuladoSemanalSvg,
  chegadasSemanaisPorIndices,
};
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --test test/semanal-render-aba-grafico-semanal.test.js`
Expected: PASS, todos.

Depois rode a suíte inteira: `node --test test/*.test.js`
Expected: PASS. Nada mais deve ter mudado — esta task só ACRESCENTA uma função, não altera nenhum caminho existente.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/render-aba-grafico-semanal.js test/semanal-render-aba-grafico-semanal.test.js
git commit -m "Gráfico semanal: chegadasSemanaisPorIndices bucketiza demandas por semana"
```

---

### Task 2: A 4ª série no painel de Volume, com saldo de abertura

**Files:**
- Modify: `tools/semanal/render-aba-grafico-semanal.js` (require, 3 mapas, `construirPainelGraficoSemanalHtml`)
- Test: `test/semanal-render-aba-grafico-semanal.test.js`

**Interfaces:**
- Consumes: `chegadasSemanaisPorIndices` (Task 1); `pendentesNaData(registros, indices, demandas, dataEpoch) -> number` (já exportada de `./render-aba-semanal.js`); `calcularAcumulado(valores) -> number[]` (já importada de `./compute-grafico-semanal.js`).
- Produces: o painel de Volume com 4 entradas em `dadosPorSerie`. Nenhuma API nova.

**O risco central desta task:** o corte do saldo de abertura é `semanas[0].inicio - 1`, **não** `semanas[0].inicio`. `pendentesNaData` conta `chegada <= dataEpoch` INCLUSIVE — com o corte no próprio primeiro dia do mês, a demanda que chega nele é contada duas vezes (no saldo de abertura E na S1), inflando o Acumulado sem erro nem aviso. O teste de fronteira do Step 1 existe exatamente para travar isso.

- [ ] **Step 1: Escrever os testes que falham**

Acrescente ao FIM de `test/semanal-render-aba-grafico-semanal.test.js`:

```js
// --- Task 2: a 4ª série (Demandas) no painel de Volume --------------------

const { semanasDoMes: _semanasDoMes, indiceSemanaAtual: _indiceSemanaAtual } = require('../tools/semanal/compute-semanal.js');

// 3 chegadas em junho, 1 delas já executada em junho -> saldo de abertura = 2.
// Mais as 7 chegadas de julho de EVENTOS_CHEGADAS -> [2,2,1,1,1].
const EVENTOS_COM_ABERTURA = {
  chegada: [
    diaEpoch(new Date(Date.UTC(2026, 5, 10))),
    diaEpoch(new Date(Date.UTC(2026, 5, 20))),
    diaEpoch(new Date(Date.UTC(2026, 5, 25))),
  ].concat(EVENTOS_CHEGADAS.chegada),
  sondagemRealizada: [],
  saidaEstoque: [diaEpoch(new Date(Date.UTC(2026, 5, 28)))],
};

function painelVolume(demandas) {
  const semanas = _semanasDoMes(ANO, VIGENTE_JULHO);
  return construirPainelGraficoSemanalHtml(
    [registro(1000)], [0], 'volume', VIGENTE_JULHO, semanas, semanas.length, true,
    _indiceSemanaAtual(semanas, HOJE_15_JUL), demandas, HOJE_15_JUL
  );
}

test('Volume ganha a série Demandas: cor #9700DA e rótulo na legenda', () => {
  const html = painelVolume({ porRegistroEventos: { 'SUP-0001-24||ST': EVENTOS_COM_ABERTURA } });
  assert.match(html, /#9700DA/, 'roxo de Demandas do projeto inteiro');
  assert.match(html, />Demandas</, 'rótulo na legenda');
  assert.doesNotMatch(html, /#a78bfa/, 'lavanda do realizadoPrevistoInicial do orçamento -- série diferente, não pode aparecer');
});

test('Equipes e Financeiro NÃO ganham a série Demandas', () => {
  const semanas = _semanasDoMes(ANO, VIGENTE_JULHO);
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': EVENTOS_COM_ABERTURA } };
  ['equipes', 'financeiro'].forEach((dimensao) => {
    const html = construirPainelGraficoSemanalHtml(
      [registro(1000)], [0], dimensao, VIGENTE_JULHO, semanas, semanas.length, true,
      _indiceSemanaAtual(semanas, HOJE_15_JUL), demandas, HOJE_15_JUL
    );
    assert.doesNotMatch(html, /#9700DA/, dimensao + ' não pode ter Demandas -- é contagem física, sem equivalente em headcount nem R$');
    assert.doesNotMatch(html, />Demandas</, dimensao + ' não pode ter Demandas na legenda');
  });
});

test('FRONTEIRA do saldo de abertura: chegada no 1º dia do mês conta na S1 e NÃO na abertura', () => {
  // Uma única chegada, exatamente em 01/jul (= semanas[0].inicio).
  // Se o corte da abertura fosse semanas[0].inicio em vez de inicio - 1, ela
  // seria contada DUAS vezes e o acumulado fecharia em 2 em vez de 1.
  const soNoPrimeiroDia = { chegada: [diaJul(1)], sondagemRealizada: [], saidaEstoque: [] };
  const semanas = _semanasDoMes(ANO, VIGENTE_JULHO);
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': soNoPrimeiroDia } };

  const { pendentesNaData } = require('../tools/semanal/render-aba-semanal.js');
  const abertura = pendentesNaData([registro(1000)], [0], demandas, semanas[0].inicio - 1);
  assert.strictEqual(abertura, 0, 'a chegada do dia 1 NÃO pertence ao saldo de abertura');

  const porSemana = chegadasSemanaisPorIndices([registro(1000)], [0], demandas, semanas);
  assert.deepStrictEqual(porSemana, [1, 0, 0, 0, 0], 'ela pertence à S1');
});

test('FRONTEIRA do saldo de abertura: chegada na véspera conta na abertura e em nenhuma semana', () => {
  const soNaVespera = {
    chegada: [diaEpoch(new Date(Date.UTC(2026, 5, 30)))], // 30/jun
    sondagemRealizada: [], saidaEstoque: [],
  };
  const semanas = _semanasDoMes(ANO, VIGENTE_JULHO);
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': soNaVespera } };

  const { pendentesNaData } = require('../tools/semanal/render-aba-semanal.js');
  assert.strictEqual(pendentesNaData([registro(1000)], [0], demandas, semanas[0].inicio - 1), 1);
  assert.deepStrictEqual(chegadasSemanaisPorIndices([registro(1000)], [0], demandas, semanas), [0, 0, 0, 0, 0]);
});

test('Acumulado de Demandas nasce do saldo de abertura e fecha em abertura + total do mês', () => {
  // abertura = 3 chegadas de junho - 1 saída de junho = 2
  // chegadas de julho = [2,2,1,1,1], total 7
  // acumulado esperado = [4, 6, 7, 8, 9]  (2 + soma corrida)
  const semanas = _semanasDoMes(ANO, VIGENTE_JULHO);
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': EVENTOS_COM_ABERTURA } };
  const { pendentesNaData } = require('../tools/semanal/render-aba-semanal.js');
  const { calcularAcumulado } = require('../tools/semanal/compute-grafico-semanal.js');

  const abertura = pendentesNaData([registro(1000)], [0], demandas, semanas[0].inicio - 1);
  assert.strictEqual(abertura, 2, 'pré-condição: 3 chegadas em junho, 1 já executada');

  const porSemana = chegadasSemanaisPorIndices([registro(1000)], [0], demandas, semanas);
  const acumulado = calcularAcumulado(porSemana).map((v) => (v || 0) + abertura);
  assert.deepStrictEqual(acumulado, [4, 6, 7, 8, 9]);

  // Monotônico não-decrescente: chegadas nunca são negativas.
  for (let i = 1; i < acumulado.length; i++) assert.ok(acumulado[i] >= acumulado[i - 1]);
});

test('DECISÃO 2026-08-14: o Acumulado de Demandas NÃO é cortado na semana em curso', () => {
  // Escolha explícita do dono do projeto: espelhar o orçamento em vez da
  // coerência local do painel. As semanas futuras achatam a curva (não há
  // chegadas lá) -- é o efeito que cortarAcumuladoNasElapsadas evita no
  // Realizado, e aqui é aceito de propósito. Este teste existe para que uma
  // revisão futura não "corrija" isso sem perguntar.
  const soNaS1 = { chegada: [diaJul(2)], sondagemRealizada: [], saidaEstoque: [] };
  const semanas = _semanasDoMes(ANO, VIGENTE_JULHO);
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': soNaS1 } };
  const { calcularAcumulado } = require('../tools/semanal/compute-grafico-semanal.js');

  const acumulado = calcularAcumulado(chegadasSemanaisPorIndices([registro(1000)], [0], demandas, semanas));
  // Achata em 1, e NENHUMA semana vira null (que é o que o corte produziria).
  assert.deepStrictEqual(acumulado, [1, 1, 1, 1, 1]);
  acumulado.forEach((v) => assert.notStrictEqual(v, null));
});

test('Sem demandas, Volume volta às 3 séries de sempre', () => {
  const semanas = _semanasDoMes(ANO, VIGENTE_JULHO);
  const html = construirPainelGraficoSemanalHtml(
    [registro(1000)], [0], 'volume', VIGENTE_JULHO, semanas, semanas.length, false, -1, undefined, undefined
  );
  assert.doesNotMatch(html, /#9700DA/);
  assert.doesNotMatch(html, />Demandas</);
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node --test test/semanal-render-aba-grafico-semanal.test.js`
Expected: FAIL. Os testes de fronteira e de acumulado já podem passar (usam só funções existentes + a da Task 1); os que checam o HTML (`#9700DA`, `>Demandas<`) devem falhar.

- [ ] **Step 3: Acrescentar `pendentesNaData` ao require**

Em `tools/semanal/render-aba-grafico-semanal.js`, linha 3, troque:

```js
const { calcularSeriesSemanaisDimensao, formatarIntervaloSemana } = require('./render-aba-semanal.js');
```

por:

```js
const { calcularSeriesSemanaisDimensao, formatarIntervaloSemana, pendentesNaData } = require('./render-aba-semanal.js');
```

(Mesmo diretório, forma `'./arquivo.js'` — a que o `browser-bundle.js` reconhece. Não mudar a forma do require.)

- [ ] **Step 4: Acrescentar a série aos 3 mapas**

Nas linhas ~73-76, acrescente a chave `demandas` aos três mapas. **Não** acrescente a `ORDEM_SERIES_GRAFICO` — essa lista governa as 3 séries de TODAS as dimensões, e Demandas só existe em Volume.

```js
// A 4ª série, 'demandas', não entra em ORDEM_SERIES_GRAFICO de propósito: ela
// só existe na dimensão Volume, acrescentada à mão em
// construirPainelGraficoSemanalHtml. #9700DA é o roxo de Demandas do projeto
// inteiro (.linha-pendentes-demandas/.linha-demandas, tools/comum/render-shell.js
// e render-aba-demandas.js) -- NÃO confundir com #a78bfa, a lavanda do
// realizadoPrevistoInicial do orçamento.
var SERIE_COR = { previsto: '#2f6ad0', realizado: '#7fd858', tendencia: '#f6b53f', demandas: '#9700DA' };
var SERIE_TRACEJADO = { previsto: '', realizado: '1,5', tendencia: '9,5', demandas: '4,3' };
var SERIE_LABELS = { previsto: 'Previsto', realizado: 'Realizado', tendencia: 'Tendência', demandas: 'Demandas' };
```

- [ ] **Step 5: Acrescentar a 4ª entrada em `dadosPorSerie`**

Em `construirPainelGraficoSemanalHtml`, logo DEPOIS do bloco `var dadosPorSerie = seriesVisiveis.map(...)` e ANTES de `var rotuloDimensao = ...`:

```js
  // Demandas (chegadas) -- 4ª série, SÓ na dimensão Volume. Duas decisões do
  // dono do projeto em 2026-08-14, ambas espelhando o Gráfico do orçamento em
  // vez da coerência local deste painel (ver o spec
  // 2026-08-14-demandas-no-grafico-semanal-design.md):
  //
  // 1. O Acumulado nasce do SALDO DE ABERTURA do mês, não de zero como as
  //    outras 3 séries. Sem isso a curva de Demandas fica quase sempre ABAIXO
  //    da de Realizado -- o que se lê como impossível (não dá pra executar
  //    mais do que chegou), mas é só a janela de um mês escondendo a carteira
  //    que já estava aberta antes dele.
  // 2. NÃO é cortado na semana em curso. As semanas futuras achatam a curva --
  //    é o efeito que cortarAcumuladoNasElapsadas evita no Realizado, aceito
  //    aqui de propósito. Não "corrigir" numa revisão sem perguntar.
  if (dimensao === 'volume' && demandas && demandas.porRegistroEventos) {
    var chegadasSemanais = chegadasSemanaisPorIndices(registros, indices, demandas, semanas);
    // O corte é 'inicio - 1', NÃO 'inicio': pendentesNaData conta
    // 'chegada <= dataEpoch' INCLUSIVE, então cortar no próprio primeiro dia
    // do mês contaria a demanda que chegou nele DUAS vezes -- no saldo de
    // abertura E na S1 -- inflando o Acumulado sem erro nem aviso.
    var aberturaDemandas = pendentesNaData(registros, indices, demandas, semanas[0].inicio - 1);
    dadosPorSerie.push({
      serie: 'demandas',
      valores: chegadasSemanais,
      acumulado: calcularAcumulado(chegadasSemanais).map(function (v) { return (v || 0) + aberturaDemandas; }),
      indiceConector: null,
    });
  }
```

- [ ] **Step 6: Rodar os testes e confirmar que passam**

Run: `node --test test/semanal-render-aba-grafico-semanal.test.js`
Expected: PASS, todos os novos.

- [ ] **Step 7: Rodar a suíte inteira e consertar o que quebrou de propósito**

Run: `node --test test/*.test.js`

**Espera-se UMA quebra legítima:** o teste `construirPainelGraficoSemanalHtml: Volume com demandas mostra as 3 séries (Previsto/Realizado/Tendência) com as cores certas` (~linha 73) descreve um comportamento que esta task muda de propósito — Volume agora tem 4 séries.

O fixture dele (`EVENTOS_REALIZADO_CONHECIDO`) tem `chegada: []`, então as asserções atuais continuam passando (a série de Demandas sai toda zerada), mas **o nome do teste fica mentindo**. Renomeie e acrescente a asserção que faltava:

```js
test('construirPainelGraficoSemanalHtml: Volume mostra as 4 séries (Previsto/Realizado/Tendência/Demandas) com as cores certas', () => {
```

e, no corpo, depois das 3 asserções de cor existentes:

```js
  assert.match(html, /#9700DA/, 'cor de Demandas -- a 4ª série, só nesta dimensão');
  assert.match(html, />Demandas</);
```

Se QUALQUER outro teste quebrar, **pare e investigue** — não ajuste o número para o que saiu. Nenhum outro caminho deveria ter mudado.

Expected após o ajuste: PASS, suíte inteira.

- [ ] **Step 8: Commit**

```bash
git add tools/semanal/render-aba-grafico-semanal.js test/semanal-render-aba-grafico-semanal.test.js
git commit -m "Gráfico semanal: Demandas vira a 4ª série do painel de Volume"
```

---

### Task 3: Reconstruir, verificar e publicar

**Files:**
- Modify: `dist/planejamento-semanal.html` (gerado)
- Modify: `docs/planejamento-semanal.html` (cópia obrigatória do anterior)
- Modify: `CLAUDE.md` (seção nova documentando a série)

**Interfaces:**
- Consumes: o módulo já alterado pelas Tasks 1 e 2.
- Produces: a página publicada. Nada consome isto.

**Pré-condição:** as revisões das Tasks 1 e 2 passaram. Nada aqui roda antes disso.

- [ ] **Step 1: Documentar no CLAUDE.md**

Acrescente, em `CLAUDE.md`, logo antes da seção `### Aba Alocação Equipes (2026-08-10)`:

```markdown
### Série Demandas no Gráfico (2026-08-14)

A aba Gráficos ganhou uma 4ª série, **Demandas** (roxa `#9700DA`), **só na dimensão
Volume** — barra no painel Semanal, linha no Acumulado. É a série `chegadas`
(quantos furos + ensaios CHEGARAM), portada do Gráfico do orçamento
(`docs/superpowers/specs/2026-08-13-demandas-no-grafico-orcamento-design.md`).
Spec desta rodada: `.../2026-08-14-demandas-no-grafico-semanal-design.md`.

**Duas decisões do dono do projeto que contrariam o painel vizinho** — registradas
para não serem "corrigidas" numa revisão futura:

1. **O Acumulado nasce do saldo de abertura do mês**, não de zero como as outras 3
   séries. Sem isso a curva de Demandas fica abaixo da de Realizado, o que se lê como
   impossível — é só a janela de um mês escondendo a carteira já aberta antes dele.
   No orçamento o mesmo problema foi medido: 55% dos furos executados em 2026 tinham
   Criação da OS em 2025 ou antes. Com a janela de um MÊS, o efeito é maior ainda.
2. **A curva NÃO é cortada na semana em curso** — achata nas semanas futuras, que é
   exatamente o efeito que `cortarAcumuladoNasElapsadas` evita no Realizado. Aceito
   de propósito. Travado por teste.

**O off-by-one que duplica demanda:** o corte do saldo de abertura é
`semanas[0].inicio - 1`, NUNCA `semanas[0].inicio`. `pendentesNaData` conta
`chegada <= D` inclusive — com o corte no próprio dia 1, a demanda que chega nele
entra no saldo E na S1, inflando o Acumulado sem erro nem aviso. Há teste de
fronteira nos dois sentidos.

**Ao contrário do orçamento, isto não tocou build, blob cifrado nem golden:** o
cliente da semanal já recebe `porRegistroEventos` com os eventos crus datados, e
`semanas[]` já traz `inicio`/`fim` em dia-epoch, então o bucketing
(`chegadasSemanaisPorIndices`) roda no cliente. `chaveDemandas` foi DUPLICADA neste
módulo, não importada — é a convenção dos módulos que entram no bundle do navegador.

**O botão "Atualizar dados" cobre esta série** — ela lê `porRegistroEventos` do mesmo
`window.__DEMANDAS__` que `atualizarDadosAoVivoSemanal` recalcula.
```

- [ ] **Step 2: Reconstruir**

```bash
ORCAMENTO_SENHA='<a senha real, pedir ao dono do projeto>' node tools/semanal/build-dashboard.js
```

Expected: build conclui sem erro e reescreve `dist/planejamento-semanal.html`.

Se o build reclamar de `dist/avancos-online.csv`/`dist/lab-online.csv` ausentes, os arquivos estão versionados no repositório — confirme que você está na raiz do `orcamento-dashboard` e que a árvore está limpa. **Não** rode os fetchers (`atualizar-*-online.js`): eles exigem Chrome com porta de depuração e sessão em sond.com.br, e não fazem parte desta entrega.

- [ ] **Step 3: Copiar para `docs/` e rodar a suíte inteira**

```bash
cp dist/planejamento-semanal.html docs/planejamento-semanal.html
node --test test/*.test.js
```

Expected: PASS, incluindo `test/publicacao-docs-sincronizado.test.js` (que trava a cópia byte a byte).

**Nunca** faça `git checkout`/`restore` de só um entre `dist/` e `docs/`: `core.autocrlf=true` sem `.gitattributes` inverte a terminação de linha e quebra o teste de sincronia sem mudar o conteúdo. Se precisar reverter, regenere os dois com o build.

- [ ] **Step 4: Verificar que só o Volume mudou**

```bash
git diff --stat
grep -c "9700DA" docs/planejamento-semanal.html
```

Expected: `9700DA` aparece no HTML (a série foi embutida). Se aparecer **0**, o módulo não entrou no bundle — pare e investigue antes de publicar; o sintoma clássico é uma crase solta em `SCRIPT_CLIENTE_SEMANAL`/`CSS_SEMANAL` truncando o script do cliente em silêncio.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md dist/planejamento-semanal.html docs/planejamento-semanal.html
git commit -m "Rebuild: Demandas no Gráfico do Planejamento Semanal"
```

- [ ] **Step 6: Rebase em origin/master e publicar**

`origin/master` tem uma segunda frente ativa (atualizações diárias automáticas de dados). Rebase antes de empurrar; o upstream ganha nos arquivos de dados compartilhados; **nunca `--force`**.

```bash
git fetch origin
git rebase origin/master
node --test test/*.test.js
git push origin semanal-demandas-grafico:master
```

Expected: suíte PASS depois do rebase (se o rebase trouxe CSVs novos, o build pode precisar ser refeito — nesse caso repita os Steps 2-3 e faça `git commit --amend` antes do push).
