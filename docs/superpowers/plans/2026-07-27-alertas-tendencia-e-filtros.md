# Fechamento da Tendência no mês vigente, Equipes acumuladas e filtro de Dimensão duplicado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir 3 problemas da aba Alertas (e, por extensão, da Tabela) do dashboard de Orçamento: (1) a série Tendência do mês vigente passa a combinar Realizado + projeção da linha T em vez de mostrar só um dos dois isoladamente; (2) Equipes acumuladas (em qualquer período de mais de 1 mês) viram uma média ponderada por dias em vez de uma soma sem sentido; (3) o seletor de Dimensão duplicado da aba Alertas é removido -- ela passa a seguir a 1ª dimensão marcada na barra de cima.

**Architecture:** Este dashboard monta Tabela/Gráfico/Alertas inteiramente no navegador -- `SCRIPT_CLIENTE_TABELA` (`tools/orcamento/render-dashboard.js:91-2019`) é uma string gigante embutida como `<script>`, nunca executada pelo Node; `renderDashboard()` (fora dessa string, linha 2021+) só monta o HTML e cifra os dados. Toda a lógica nova deste plano (funções puras) entra dentro dessa string, testável via `vm.runInContext` (padrão `extrairFuncoesPuras` já usado em `test/orcamento-render-dashboard.test.js`).

**Tech Stack:** JavaScript puro (sem dependências novas), `node:test` + `node:assert/strict`, `node:vm` pro harness de teste já existente.

## Global Constraints

- Financeiro/Volume são fluxos (somam); Equipes é uma foto/headcount (nunca soma através de meses -- média ponderada por dias, nem soma no fechamento do mês vigente -- usa o maior dos dois valores).
- `DIAS_PREMISSA_MES = [15, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 15]` (Jan e Dez = 15 dias, os demais 30) é a ÚNICA premissa de peso -- já existe no arquivo, reaproveitar, nunca duplicar.
- O fechamento do mês vigente (Seção A) vale pro dashboard inteiro (Tabela, Gráfico, Alertas) -- aplicado uma vez, nos 2 pontos onde `window.__REGISTROS__` é definido (gate de senha e live-refresh), nunca dentro de `calcularMensal`/`bucketPeriodo`/`calcularTotalAno` (essas funções continuam lendo `registro.total` como está, sem saber que foi "fechado").
- `compute-orcamento.js` não é tocado (código morto, confirmado não importado por `build-dashboard.js` nem `render-dashboard.js`).
- Nenhuma mudança na coluna mensal individual da Tabela, nem no Gráfico -- só a coluna "Total" (ano inteiro) e a aba Alertas usam a média ponderada de Equipes.
- Toda função nova pura vive dentro de `SCRIPT_CLIENTE_TABELA` (perto das funções irmãs que já existem lá: `DIAS_PREMISSA_MES`, `somarIntervaloMensal` etc.), e precisa ser exposta em `extrairFuncoesPuras` (`test/orcamento-render-dashboard.test.js:141-215`, tanto no bloco `this.X = X` quanto no objeto retornado) pra ser testável.

---

### Task 1: Fechar a Tendência do mês vigente (Realizado + projeção)

**Files:**
- Modify: `tools/orcamento/render-dashboard.js`
- Modify: `test/orcamento-render-dashboard.test.js`

**Interfaces:**
- Produces: `fecharTendenciaVigente(registros, vigenteIdx) => registros` (mesma forma dos registros de entrada, só com `registro.total.{equipes,volume,financeiro}` "fechados"); usada por Task 4 apenas para verificação manual (não é consumida por nenhuma outra task deste plano).

- [ ] **Step 1: Write the failing tests**

Adicione estes testes em `test/orcamento-render-dashboard.test.js` (perto dos outros testes de `bucketPeriodo`, por volta da linha 1295, antes da seção de Alertas):

```js
test('fecharTendenciaVigente: meses antes do vigente passam a valer pelo Realizado, não pelo valor cru da linha T (Financeiro)', () => {
  const html = renderComSenha([registroExemplo()]);
  const { fecharTendenciaVigente } = extrairFuncoesPuras(html);
  const registro = registroExemplo({
    realizado: { equipes: Array(12).fill(4), equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 }, volume: Array(12).fill(80), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 }, financeiro: [1, 2, 3, 4, 5, 6, 7, null, null, null, null, null], financeiroResumo: { total: 0, totalInicial: 0 } },
    total: { equipes: Array(12).fill(4.5), equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 }, volume: Array(12).fill(90), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 }, financeiro: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120], financeiroResumo: { total: 0, totalInicial: 0 } },
  });
  const [fechado] = fecharTendenciaVigente([registro], 6);
  assert.deepEqual(fechado.total.financeiro, [1, 2, 3, 4, 5, 6, 77, 80, 90, 100, 110, 120]);
});

test('fecharTendenciaVigente: mês vigente de Financeiro/Volume (fluxos) soma Realizado + valor cru da linha T', () => {
  const html = renderComSenha([registroExemplo()]);
  const { fecharTendenciaVigente } = extrairFuncoesPuras(html);
  const registro = registroExemplo({
    realizado: { equipes: Array(12).fill(4), equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 }, volume: [10, 10, 10, 10, 10, 10, 25, null, null, null, null, null], volumeResumo: { total: 0, totalInicial: 0, ticket: 0 }, financeiro: Array(12).fill(100), financeiroResumo: { total: 0, totalInicial: 0 } },
    total: { equipes: Array(12).fill(4.5), equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 }, volume: [1, 1, 1, 1, 1, 1, 15, 30, 30, 30, 30, 30], volumeResumo: { total: 0, totalInicial: 0, ticket: 0 }, financeiro: Array(12).fill(900), financeiroResumo: { total: 0, totalInicial: 0 } },
  });
  const [fechado] = fecharTendenciaVigente([registro], 6);
  assert.equal(fechado.total.volume[6], 25 + 15);
});

test('fecharTendenciaVigente: mês vigente de Equipes (foto, não fluxo) usa o MAIOR entre Realizado e a linha T, nunca soma', () => {
  const html = renderComSenha([registroExemplo()]);
  const { fecharTendenciaVigente } = extrairFuncoesPuras(html);
  const registroTProjetaMais = registroExemplo({
    realizado: { equipes: [4, 4, 4, 4, 4, 4, 3, null, null, null, null, null], equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 }, volume: Array(12).fill(80), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 }, financeiro: Array(12).fill(800), financeiroResumo: { total: 0, totalInicial: 0 } },
    total: { equipes: [4, 4, 4, 4, 4, 4, 10, 10, 10, 10, 10, 10], equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 }, volume: Array(12).fill(90), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 }, financeiro: Array(12).fill(900), financeiroResumo: { total: 0, totalInicial: 0 } },
  });
  const [fechado1] = fecharTendenciaVigente([registroTProjetaMais], 6);
  assert.equal(fechado1.total.equipes[6], 10, 'linha T (10) projeta mais que o Realizado (3) -- usa a linha T');

  const registroRealizadoMaisAlto = registroExemplo({
    realizado: { equipes: [4, 4, 4, 4, 4, 4, 15, null, null, null, null, null], equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 }, volume: Array(12).fill(80), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 }, financeiro: Array(12).fill(800), financeiroResumo: { total: 0, totalInicial: 0 } },
    total: { equipes: [4, 4, 4, 4, 4, 4, 10, 10, 10, 10, 10, 10], equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 }, volume: Array(12).fill(90), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 }, financeiro: Array(12).fill(900), financeiroResumo: { total: 0, totalInicial: 0 } },
  });
  const [fechado2] = fecharTendenciaVigente([registroRealizadoMaisAlto], 6);
  assert.equal(fechado2.total.equipes[6], 15, 'Realizado (15) já mobilizou mais que a linha T (10) previu -- usa o Realizado');
});

test('fecharTendenciaVigente: mês vigente com só uma das 2 séries presente usa a que existe; com as 2 em branco, continua em branco (não vira 0 falso)', () => {
  const html = renderComSenha([registroExemplo()]);
  const { fecharTendenciaVigente } = extrairFuncoesPuras(html);
  const registroSoT = registroExemplo({
    realizado: { equipes: Array(12).fill(null), equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 }, volume: Array(12).fill(null), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 }, financeiro: Array(12).fill(null), financeiroResumo: { total: 0, totalInicial: 0 } },
    total: { equipes: Array(12).fill(4), equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 }, volume: Array(12).fill(90), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 }, financeiro: Array(12).fill(500), financeiroResumo: { total: 0, totalInicial: 0 } },
  });
  const [fechadoSoT] = fecharTendenciaVigente([registroSoT], 6);
  assert.equal(fechadoSoT.total.financeiro[6], 500);

  const registroNenhum = registroExemplo({
    realizado: { equipes: Array(12).fill(null), equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 }, volume: Array(12).fill(null), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 }, financeiro: Array(12).fill(null), financeiroResumo: { total: 0, totalInicial: 0 } },
    total: { equipes: Array(12).fill(null), equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 }, volume: Array(12).fill(null), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 }, financeiro: Array(12).fill(null), financeiroResumo: { total: 0, totalInicial: 0 } },
  });
  const [fechadoNenhum] = fecharTendenciaVigente([registroNenhum], 6);
  assert.equal(fechadoNenhum.total.financeiro[6], null);
});

test('fecharTendenciaVigente: meses futuros (depois do vigente) não mudam -- continuam com o valor cru da linha T', () => {
  const html = renderComSenha([registroExemplo()]);
  const { fecharTendenciaVigente } = extrairFuncoesPuras(html);
  const registro = registroExemplo({
    total: { equipes: Array(12).fill(4), equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 }, volume: Array(12).fill(90), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 }, financeiro: [0, 0, 0, 0, 0, 0, 0, 777, 888, 999, 0, 0], financeiroResumo: { total: 0, totalInicial: 0 } },
  });
  const [fechado] = fecharTendenciaVigente([registro], 6);
  assert.deepEqual(fechado.total.financeiro.slice(7, 10), [777, 888, 999]);
});

test('fecharTendenciaVigente: registro sem série total (registro.total null) passa direto, sem lançar erro', () => {
  const html = renderComSenha([registroExemplo()]);
  const { fecharTendenciaVigente } = extrairFuncoesPuras(html);
  const registro = registroExemplo({ total: null });
  const [fechado] = fecharTendenciaVigente([registro], 6);
  assert.equal(fechado.total, null);
});

test('o gate de senha (tentarDesbloquear) fecha a Tendência com fecharTendenciaVigente logo após decifrar, antes de montarDashboard', () => {
  const html = renderComSenha([registroExemplo()]);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const scriptGate = scripts[2][1];
  assert.match(scriptGate, /window\.__REGISTROS__ = JSON\.parse\(jsonTexto\);\s*\n\s*window\.__REGISTROS__ = fecharTendenciaVigente\(window\.__REGISTROS__, window\.__VIGENTE_IDX__\);/);
});

test('o live-refresh (atualizarDadosAoVivo) fecha a Tendência com fecharTendenciaVigente logo após buscar dados novos', () => {
  const html = renderComSenha([registroExemplo()]);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const scriptTabela = scripts[3][1];
  assert.match(scriptTabela, /window\.__REGISTROS__ = registrosNovos;\s*\n\s*window\.__REGISTROS__ = fecharTendenciaVigente\(window\.__REGISTROS__, window\.__VIGENTE_IDX__\);/);
});
```

Também adicione `fecharTendenciaVigente` ao harness de extração, em `test/orcamento-render-dashboard.test.js`: no bloco de `this.X = X;` (perto da linha 183, logo após `this.preencherLinha = preencherLinha;`), acrescente `this.fecharTendenciaVigente = fecharTendenciaVigente;`; e no objeto retornado (perto da linha 210), acrescente `fecharTendenciaVigente: sandbox.fecharTendenciaVigente,`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: FAIL -- `fecharTendenciaVigente is not defined` (ou `undefined is not a function`) nos novos testes; os 2 testes de wiring (gate/live-refresh) também falham porque a linha nova ainda não existe no script.

- [ ] **Step 3: Implement `fecharTendenciaVigente` e ligar nos 2 pontos**

Em `tools/orcamento/render-dashboard.js`, logo após a declaração de `DIAS_PREMISSA_MES` (linha 141, dentro de `SCRIPT_CLIENTE_TABELA`), adicione:

```js
// Fecha a Tendência (série "total") do mês vigente combinando o Realizado
// parcial já ocorrido com a projeção da própria linha T da planilha pra
// completar o mês -- meses já fechados (antes do vigente) passam a valer
// pelo Realizado (fato, não projeção); meses futuros continuam com o valor
// cru da linha T. Financeiro/Volume são fluxos do mês (o que já rodou + o
// que falta pra fechar = soma); Equipes é uma foto (headcount), somar
// contaria equipe em dobro -- usa o maior dos dois em vez de somar.
// Confirmado com o usuário (2026-07-27): vale pro dashboard inteiro
// (Tabela/Gráfico/Alertas), aplicado uma vez nos 2 pontos onde
// window.__REGISTROS__ é definido (gate de senha e live-refresh) -- nunca
// dentro de calcularMensal/bucketPeriodo/calcularTotalAno.
function fecharValorMesVigenteFluxo(totalMes, realizadoMes) {
  if ((totalMes === null || totalMes === undefined) && (realizadoMes === null || realizadoMes === undefined)) return null;
  return (realizadoMes || 0) + (totalMes || 0);
}
function fecharValorMesVigenteEquipes(totalMes, realizadoMes) {
  if ((totalMes === null || totalMes === undefined) && (realizadoMes === null || realizadoMes === undefined)) return null;
  return Math.max(realizadoMes || 0, totalMes || 0);
}
var CAMPOS_FECHAMENTO_VIGENTE = { equipes: fecharValorMesVigenteEquipes, volume: fecharValorMesVigenteFluxo, financeiro: fecharValorMesVigenteFluxo };

function fecharSerieMensal(totalMensal, realizadoMensal, vigenteIdx, fechar) {
  return totalMensal.map(function (v, i) {
    if (i < vigenteIdx) {
      var r = realizadoMensal ? realizadoMensal[i] : null;
      return (r === null || r === undefined) ? v : r;
    }
    if (i === vigenteIdx) return fechar(v, realizadoMensal ? realizadoMensal[i] : null);
    return v;
  });
}

function fecharTendenciaVigente(registros, vigenteIdx) {
  if (vigenteIdx < 0 || vigenteIdx > 11) return registros; // fora do ano coberto -- nada a fechar
  return registros.map(function (registro) {
    if (!registro.total) return registro;
    var realizado = registro.realizado;
    var totalFechado = Object.assign({}, registro.total);
    ['equipes', 'volume', 'financeiro'].forEach(function (campo) {
      totalFechado[campo] = fecharSerieMensal(
        registro.total[campo], realizado ? realizado[campo] : null, vigenteIdx, CAMPOS_FECHAMENTO_VIGENTE[campo]
      );
    });
    return Object.assign({}, registro, { total: totalFechado });
  });
}
```

Em seguida, ligue nos 2 pontos onde `window.__REGISTROS__` é definido:

**1) `tentarDesbloquear`** (dentro de `SCRIPT_CLIENTE_GATE`, por volta da linha 63). Troque:
```js
    var jsonTexto = await decifrarComSenha(window.__DADOS_CIFRADOS__, senha);
    window.__REGISTROS__ = JSON.parse(jsonTexto);
    document.getElementById('gate-senha').style.display = 'none';
```
por:
```js
    var jsonTexto = await decifrarComSenha(window.__DADOS_CIFRADOS__, senha);
    window.__REGISTROS__ = JSON.parse(jsonTexto);
    window.__REGISTROS__ = fecharTendenciaVigente(window.__REGISTROS__, window.__VIGENTE_IDX__);
    document.getElementById('gate-senha').style.display = 'none';
```

**2) `atualizarDadosAoVivo`** (dentro de `SCRIPT_CLIENTE_TABELA`, por volta da linha 2004). Troque:
```js
      preservarPrevistoInicial(window.__REGISTROS__, registrosNovos);
      window.__REGISTROS__ = registrosNovos;
      montarTodosFiltrosMulti(window.__REGISTROS__);
```
por:
```js
      preservarPrevistoInicial(window.__REGISTROS__, registrosNovos);
      window.__REGISTROS__ = registrosNovos;
      window.__REGISTROS__ = fecharTendenciaVigente(window.__REGISTROS__, window.__VIGENTE_IDX__);
      montarTodosFiltrosMulti(window.__REGISTROS__);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: PASS, todos os testes incluindo os 8 novos.

- [ ] **Step 5: Commit**

```bash
git add tools/orcamento/render-dashboard.js test/orcamento-render-dashboard.test.js
git commit -m "Fechar a Tendência do mês vigente combinando Realizado com a projeção da linha T"
```

---

### Task 2: Equipes acumuladas viram média ponderada por dias

**Files:**
- Modify: `tools/orcamento/render-dashboard.js`
- Modify: `test/orcamento-render-dashboard.test.js`

**Interfaces:**
- Consumes: `DIAS_PREMISSA_MES` (já existe, `render-dashboard.js:141`).
- Produces: `mediaEquipesPonderada(mensal, inicio, fim) => number|null`, usada por `bucketPeriodo` e `calcularTotalAno` (ambos já existem, só o `return` final de cada um muda).

- [ ] **Step 1: Write the failing tests**

Adicione em `test/orcamento-render-dashboard.test.js`, perto dos testes de `somarIntervaloMensal`/`bucketPeriodo`:

```js
test('mediaEquipesPonderada: 3 meses "normais" (30 dias) com valores diferentes dá a média aritmética simples (mesmo peso)', () => {
  const html = renderComSenha([registroExemplo()]);
  const { mediaEquipesPonderada } = extrairFuncoesPuras(html);
  // meses 3,4,5 (Abr,Mai,Jun) -- todos 30 dias
  const mensal = [0, 0, 0, 4, 6, 8, 0, 0, 0, 0, 0, 0];
  assert.equal(mediaEquipesPonderada(mensal, 3, 6), (4 + 6 + 8) / 3);
});

test('mediaEquipesPonderada: Janeiro/Dezembro (15 dias) pesam metade de um mês normal (30 dias) na média', () => {
  const html = renderComSenha([registroExemplo()]);
  const { mediaEquipesPonderada } = extrairFuncoesPuras(html);
  // mês 0 (Jan, 15 dias) = 10; mês 1 (Fev, 30 dias) = 20
  // média ponderada = (10*15 + 20*30) / (15+30), não (10+20)/2
  const mensal = [10, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  assert.equal(mediaEquipesPonderada(mensal, 0, 2), (10 * 15 + 20 * 30) / (15 + 30));
});

test('mediaEquipesPonderada: intervalo de 1 mês só devolve o valor do próprio mês (sem diferença de comportamento pros buckets de 1 mês)', () => {
  const html = renderComSenha([registroExemplo()]);
  const { mediaEquipesPonderada } = extrairFuncoesPuras(html);
  const mensal = [0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0];
  assert.equal(mediaEquipesPonderada(mensal, 6, 7), 7);
});

test('mediaEquipesPonderada: meses com null no meio são ignorados (não contam nem no numerador nem no peso)', () => {
  const html = renderComSenha([registroExemplo()]);
  const { mediaEquipesPonderada } = extrairFuncoesPuras(html);
  const mensal = [10, null, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  // só meses 0 e 2 (ambos 30... na verdade mês 0 é Jan=15 dias) contam
  assert.equal(mediaEquipesPonderada(mensal, 0, 3), (10 * 15 + 20 * 30) / (15 + 30));
});

test('mediaEquipesPonderada: intervalo sem nenhum dado (tudo null) devolve null', () => {
  const html = renderComSenha([registroExemplo()]);
  const { mediaEquipesPonderada } = extrairFuncoesPuras(html);
  const mensal = Array(12).fill(null);
  assert.equal(mediaEquipesPonderada(mensal, 0, 12), null);
});

test('bucketPeriodo: dimensão Equipes num período de vários meses usa a média ponderada, não a soma; Financeiro no mesmo período continua somando (sem regressão)', () => {
  const html = renderComSenha([registroExemplo()]);
  const { bucketPeriodo } = extrairFuncoesPuras(html);
  const registro = registroExemplo({
    realizado: { equipes: [4, 4, 4, 4, 4, 4, 4, 0, 0, 0, 0, 0], equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 }, volume: Array(12).fill(80), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 }, financeiro: [100, 200, 300, 400, 500, 600, 700, 0, 0, 0, 0, 0], financeiroResumo: { total: 0, totalInicial: 0 } },
  });
  const vigenteIdx = 6;
  const mediaEsperada = (4 * 15 + 4 * 30 + 4 * 30 + 4 * 30 + 4 * 30 + 4 * 30 + 4 * 30) / (15 + 30 * 6);
  assert.equal(bucketPeriodo([registro.realizado], 'realizado', 'equipes', 'acumuladoAteVigente', vigenteIdx), mediaEsperada);
  assert.equal(bucketPeriodo([registro.realizado], 'realizado', 'financeiro', 'acumuladoAteVigente', vigenteIdx), 100 + 200 + 300 + 400 + 500 + 600 + 700);
});

test('calcularTotalAno: dimensão Equipes usa a média ponderada do ano inteiro (não a soma); Financeiro no mesmo registro continua somando (sem regressão)', () => {
  const html = renderComSenha([registroExemplo()]);
  const { calcularTotalAno } = extrairFuncoesPuras(html);
  const registro = registroExemplo({
    realizado: { equipes: Array(12).fill(5), equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 }, volume: Array(12).fill(80), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 }, financeiro: Array(12).fill(100), financeiroResumo: { total: 0, totalInicial: 0 } },
  });
  assert.equal(calcularTotalAno([registro.realizado], 'realizado', 'equipes'), 5, 'todo mês com o mesmo valor (5) -- média ponderada continua 5, não 60 (soma)');
  assert.equal(calcularTotalAno([registro.realizado], 'realizado', 'financeiro'), 1200);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: FAIL -- `mediaEquipesPonderada is not defined`; os testes de `bucketPeriodo`/`calcularTotalAno` com Equipes falham (valor observado é a soma, não a média esperada).

- [ ] **Step 3: Implement**

Em `tools/orcamento/render-dashboard.js`, logo após `somarIntervaloMensal` (linha 233), adicione:

```js
// Equipes é uma foto por mês, não um fluxo -- acumular vários meses deve
// ser uma MÉDIA ponderada pelos dias de cada mês (mesma premissa de
// DIAS_PREMISSA_MES do denominador de Produtividade), não uma soma bruta
// (que produziria um "equipe-meses" sem significado prático). Um único mês
// no intervalo devolve o próprio valor do mês (peso 1, sem diferença de
// comportamento pros buckets de 1 mês só).
function mediaEquipesPonderada(mensal, inicio, fim) {
  var somaEquipeDias = null, somaDias = 0;
  var ini = Math.max(0, inicio), lim = Math.min(mensal.length, fim);
  for (var i = ini; i < lim; i++) {
    if (mensal[i] === null || mensal[i] === undefined) continue;
    somaEquipeDias = (somaEquipeDias === null ? 0 : somaEquipeDias) + mensal[i] * DIAS_PREMISSA_MES[i];
    somaDias += DIAS_PREMISSA_MES[i];
  }
  return somaDias ? somaEquipeDias / somaDias : null;
}
```

Em `bucketPeriodo` (linha 256), troque a última linha da função:
```js
  var mensal = somarArraysMensais(lista.map(function (v) { return v[dimensao]; }));
  return somarIntervaloMensal(mensal, inicio, fim);
}
```
por:
```js
  var mensal = somarArraysMensais(lista.map(function (v) { return v[dimensao]; }));
  return dimensao === 'equipes' ? mediaEquipesPonderada(mensal, inicio, fim) : somarIntervaloMensal(mensal, inicio, fim);
}
```

Em `calcularTotalAno` (linha 178), troque a última linha da função (branch não-ratio):
```js
  return somar(lista.map(function (v) { return somar(v[dimensao]); }));
}
```
por:
```js
  if (dimensao === 'equipes') return mediaEquipesPonderada(somarArraysMensais(lista.map(function (v) { return v[dimensao]; })), 0, 12);
  return somar(lista.map(function (v) { return somar(v[dimensao]); }));
}
```

Adicione `mediaEquipesPonderada` ao harness de extração (`this.mediaEquipesPonderada = mediaEquipesPonderada;` no bloco de `this.X`, e `mediaEquipesPonderada: sandbox.mediaEquipesPonderada,` no objeto retornado).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: PASS, todos os testes incluindo os 7 novos.

- [ ] **Step 5: Commit**

```bash
git add tools/orcamento/render-dashboard.js test/orcamento-render-dashboard.test.js
git commit -m "Equipes acumuladas usam média ponderada por dias em vez de soma (Alertas e coluna Total da Tabela)"
```

---

### Task 3: Remover o seletor de Dimensão duplicado da aba Alertas

**Files:**
- Modify: `tools/orcamento/render-dashboard.js`
- Modify: `test/orcamento-render-dashboard.test.js`

**Interfaces:**
- Consumes: `dimensoesEmOrdem(selecionadas)` (já existe, `render-dashboard.js:1137`), `filtrosSelecionados.dimensao` (Set da barra de cima, já existe).
- Produces: `recalcularAlertas` passa a derivar `dimensao` da barra de cima em vez de ter seu próprio filtro.

- [ ] **Step 1: Write the failing tests**

Em `test/orcamento-render-dashboard.test.js`, localize o teste (por volta da linha 1594):

```js
test('renderDashboard includes the Alertas tab button, the 5 Alertas selector containers (agrupar-por/dimensao/numerico/baseline/periodo), and the empty alertas table shell', () => {
  const html = renderComSenha([registroExemplo()]);
  assert.match(html, /<button id="aba-alertas" type="button"><svg[\s\S]*?<\/svg>Alertas<\/button>/);
  assert.match(html, /<div id="secao-alertas" style="display:none">/);
  assert.match(html, /<div class="filtro-multi" id="filtro-alertas-agrupar-por">/);
  assert.match(html, /<div class="filtro-multi" id="filtro-alertas-dimensao">/);
  assert.match(html, /<div class="filtro-multi" id="filtro-alertas-numerico">/);
  assert.match(html, /<div class="filtro-multi" id="filtro-alertas-baseline">/);
  assert.match(html, /<div class="filtro-multi" id="filtro-alertas-periodo">/);
  assert.match(html, /<table id="tabela-alertas">/);
  assert.match(html, /<thead id="cabecalho-alertas"><\/thead>/);
  assert.match(html, /<tbody id="corpo-alertas"><\/tbody>/);
});
```

Substitua por (remove a linha do `filtro-alertas-dimensao`, ajusta o título e acrescenta uma asserção negativa):

```js
test('renderDashboard includes the Alertas tab button, the 4 Alertas selector containers (agrupar-por/numerico/baseline/periodo -- no dimensao selector of its own, ver próximo teste), and the empty alertas table shell', () => {
  const html = renderComSenha([registroExemplo()]);
  assert.match(html, /<button id="aba-alertas" type="button"><svg[\s\S]*?<\/svg>Alertas<\/button>/);
  assert.match(html, /<div id="secao-alertas" style="display:none">/);
  assert.match(html, /<div class="filtro-multi" id="filtro-alertas-agrupar-por">/);
  assert.doesNotMatch(html, /id="filtro-alertas-dimensao"/, 'Alertas não tem mais seletor de Dimensão próprio -- segue a barra de cima');
  assert.match(html, /<div class="filtro-multi" id="filtro-alertas-numerico">/);
  assert.match(html, /<div class="filtro-multi" id="filtro-alertas-baseline">/);
  assert.match(html, /<div class="filtro-multi" id="filtro-alertas-periodo">/);
  assert.match(html, /<table id="tabela-alertas">/);
  assert.match(html, /<thead id="cabecalho-alertas"><\/thead>/);
  assert.match(html, /<tbody id="corpo-alertas"><\/tbody>/);
});

test('recalcularAlertas deriva a dimensão da barra de cima (dimensoesEmOrdem(filtrosSelecionados.dimensao)[0]), não de um filtro próprio -- confirma via código-fonte que filtrosAlertas.dimensao não existe mais em lugar nenhum', () => {
  const html = renderComSenha([registroExemplo()]);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const scriptTabela = scripts[3][1];
  assert.match(scriptTabela, /var dimensao = dimensoesEmOrdem\(filtrosSelecionados\.dimensao\)\[0\];/);
  assert.doesNotMatch(scriptTabela, /filtrosAlertas\.dimensao/, 'filtrosAlertas não deve ter mais uma chave "dimensao" -- removida junto com o seletor');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: FAIL -- o teste do shell (agora esperando ausência de `filtro-alertas-dimensao`) falha porque o elemento ainda existe; o teste de `recalcularAlertas` falha porque a linha nova ainda não existe e `filtrosAlertas.dimensao` ainda aparece no script.

- [ ] **Step 3: Implement**

Em `tools/orcamento/render-dashboard.js`:

1. Em `FILTROS_ALERTAS_CONFIG` (linha 1382), remova a entrada `filtro-alertas-dimensao` inteira:
```js
  { id: 'filtro-alertas-dimensao', chave: 'dimensao', rotuloPadrao: 'Dimensão', exclusivo: true, opcoesFixas: DIMENSOES_CONFIG },
```

2. Remova a linha `filtrosAlertas.dimensao.add('financeiro');` (logo após `var filtrosAlertas = {};` / `FILTROS_ALERTAS_CONFIG.forEach(...)`, por volta da linha 1416).

3. No template HTML retornado por `renderDashboard` (por volta da linha 2363, junto dos outros `<div class="filtro-multi" id="filtro-alertas-...">`), remova a linha:
```html
          <div class="filtro-multi" id="filtro-alertas-dimensao"><button type="button" class="filtro-multi-trigger">Financeiro<svg class="filtro-multi-seta" width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div class="filtro-multi-painel" hidden></div></div>
```

4. Em `recalcularAlertas` (linha 919), troque:
```js
  var dimensao = filtrosAlertas.dimensao.values().next().value;
```
por:
```js
  var dimensao = dimensoesEmOrdem(filtrosSelecionados.dimensao)[0];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: PASS, todos os testes.

- [ ] **Step 5: Commit**

```bash
git add tools/orcamento/render-dashboard.js test/orcamento-render-dashboard.test.js
git commit -m "Remover o seletor de Dimensão próprio da aba Alertas -- ela passa a seguir a barra de cima"
```

---

### Task 4: Verificação final, rebuild e deploy

**Files:** none (verificação + build + deploy apenas)

**Interfaces:** none -- valida as Tasks 1-3 juntas contra a planilha real.

- [ ] **Step 1: Run the full test suite**

Run: `node --test test/*.js`
Expected: PASS, 0 falhas, em todos os arquivos de teste do repositório (não só `orcamento-render-dashboard.test.js`).

- [ ] **Step 2: Rebuild real contra a planilha ao vivo**

Run: `ORCAMENTO_SENHA='<a senha -- nunca em arquivo do repo>' node tools/orcamento/build-dashboard.js` (ajuste o caminho de saída se o script pedir; ver `tools/orcamento/build-dashboard.js` pro nome exato do argumento/variável de output se não for automático).
Expected: sucesso, gera `dist/orcamento-dashboard.html`.

- [ ] **Step 3: Verificação no navegador**

Abra `dist/orcamento-dashboard.html`, digite a senha (a senha, fora do repo), e confirme:
- A aba Alertas mostra só 1 seletor "Dimensão" no total (o da barra de cima) -- não 2.
- Trocar a dimensão da barra de cima muda o resultado da aba Alertas sem precisar de nenhum controle próprio nela.
- "Tendência ÷ Previsto — Acumulado até Vigente" não aparece mais artificialmente baixo/zerado nos SUPs que antes mostravam isso -- os números devem bater com Realizado nos meses passados + a linha T no vigente/futuro.
- Na coluna "Equipes" (Tabela, coluna Total, e Alertas com dimensão Equipes), os valores acumulados parecem uma média plausível (não uma soma inflada tipo "60" quando cada mês individual mostra "5").

- [ ] **Step 4: Deploy**

Copie o build pro Pages deste repo (`docs/` é o que o GitHub Pages serve, não `dist/` -- ver `project_orcamento_pages_serves_docs_not_dist` na memória):
```bash
cp dist/orcamento-dashboard.html docs/index.html
git add docs/index.html dist/orcamento-dashboard.html
git commit -m "Rebuild dashboard: fechamento da Tendência, média de Equipes acumuladas e Dimensão unificada em Alertas"
git push
```

- [ ] **Step 5: Finish**

Siga `superpowers:finishing-a-development-branch` pra decidir o que fazer com a branch (merge local / PR / manter como está).
