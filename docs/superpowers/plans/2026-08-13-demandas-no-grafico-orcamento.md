# Demandas no Gráfico do Orçamento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 4ª série "Demandas" (roxo `#9700DA`) ao Gráfico do dashboard de orçamento — barra mensal de chegadas + linha de acumulado (soma corrida) — visível só na dimensão Volume.

**Architecture:** O build do orçamento (`tools/orcamento/build-dashboard.js`) passa a ler as mesmas fontes online já usadas pela página semanal (`dist/avancos-online.csv` + `dist/lab-online.csv`, obrigatórias; `dist/demandas-sondagem-online.csv` + `dist/demandas-lab-online.json`, opcionais), bucketiza "chegadas" por (SUP, tipologia) × mês em Node, e embute o resultado (`{ chaveMatriz: [12 inteiros] }`) no MESMO blob cifrado que já carrega os registros — mudando o payload de um array puro para `{ registros, demandasChegadasMensais }`. O cliente (`tools/orcamento/render-dashboard.js`) soma esses arrays pelos MESMOS `indices` já filtrados pela Tabela/Gráfico e injeta uma 5ª entrada em `dadosPorSerie` só quando a dimensão marcada é `'volume'`.

**Tech Stack:** Node.js (`node:test`, `node:assert`), JS ES5-ish para o script de cliente embutido (sem bundler), reaproveitamento de `tools/semanal/parse-avancos.js`/`parse-lab.js`/`parse-matriz-cliente.js`/`compute-demandas.js` (Node-only, sem tocar no bundle do navegador da página semanal).

**Spec:** `docs/superpowers/specs/2026-08-13-demandas-no-grafico-orcamento-design.md`

## Global Constraints

- A série é `chegadas` (fluxo, soma corrida no acumulado) — **não** `pendentes`, confirmado contra o BI de referência (ver o spec, seção "Validação").
- Cor `#9700DA`, rótulo "Demandas", só na dimensão Volume, sempre visível (sem filtro/checkbox próprio).
- `test/orcamento-html-inalterado.test.js` deve continuar passando — mas o golden (`test/fixtures/orcamento-golden.html`) precisa ser regenerado deliberadamente (o formato do blob cifrado muda de propósito).
- **NÃO mover `compute-demandas.js`/`redirecionarSupsDesconhecidos` para `tools/comum/`** — ver "Riscos investigados" abaixo. Ficam em `tools/semanal/`, consumidos por `tools/orcamento/build-dashboard.js` via require cruzado direto (Node puro, sem bundle envolvido) — mesmo padrão que `tools/semanal/build-dashboard.js` já usa pra reaproveitar `tools/orcamento/config.js`/`parse-matriz.js`/`parse-baseline.js`, só na direção oposta.
- **Nenhuma mudança em `tools/semanal/`** além de uma função nova adicionada (aditiva) em `compute-demandas.js` — a página semanal publicada não pode regredir.
- Todo código de cliente novo dentro de `SCRIPT_CLIENTE_TABELA` (`tools/orcamento/render-dashboard.js`) usa `var`/`function`, nunca `const`/`let`/arrow — mesma convenção ES5 de todo o resto desse template literal.

## Riscos investigados (por que NÃO mover compute-demandas.js)

Investigação feita antes de escrever este plano: `tools/semanal/compute-demandas.js` é consumido de duas formas — (a) `require()` direto em Node por `tools/semanal/build-dashboard.js`, e (b) concatenado como TEXTO pelo bundle do navegador da página semanal (`buildBrowserBundle`, `tools/comum/browser-bundle.js`), que reescreve `require('./arquivo-do-mesmo-dir.js')` para `MODULOS['arquivo-do-mesmo-dir.js']` e REMOVE `require('../fora-do-dir.js')` inteiramente (assumindo que o nome já existe como global, injetado por `fonteParaCliente()`).

Mover o arquivo para `tools/comum/` mudaria QUAL regra se aplica a cada um dos 3 `require`s que ele já tem (`../comum/tipologias-avancos.js`, `../comum/linha-base.js`, `./compute-semanal.js`) — os dois primeiros virariam same-dir (quebrando: `tipologias-avancos.js`/`linha-base.js` não são bundladas via `MODULOS`, só injetadas como globais) e o terceiro viraria cross-dir (quebrando: `compute-semanal.js` SÓ existe como `MODULOS['compute-semanal.js']`, não como global solto). Qualquer uma das três mudanças quebraria o bundle da página semanal **publicada e em produção**, sem nenhum teste em Node acusando (os testes rodam puro Node, onde `require` sempre resolve certo).

Como o orçamento só precisa do RESULTADO já calculado no build (Node) — nunca roda `computeDemandas`/`chegadasMensaisPorRegistro` no navegador — a forma mais segura é um `require('../semanal/compute-demandas.js')` cruzado, comum e puro-Node, sem nenhum envolvimento do bundle.

## File Structure

- **Modify: `tools/semanal/compute-demandas.js`** — adiciona `chegadasMensaisPorRegistro` (nova função exportada, aditiva). `redirecionarSupsDesconhecidos` já existe e é reaproveitada sem mudança.
- **Modify: `tools/orcamento/build-dashboard.js`** — nova função `montarDemandasChegadasMensais` + 4 parâmetros novos (com default) em `build()`.
- **Modify: `tools/orcamento/render-dashboard.js`** — `renderDashboard()` (formato do blob cifrado), `fecharTendenciaVigente` (desembrulha `{registros, demandasChegadasMensais}`), `SERIE_LABELS`/`SERIE_COR`/`SERIE_TRACEJADO` (chave `demandas`), nova função `demandasMensaisPorIndices`, `construirPainelGraficoHtml` (injeta a 5ª série só em `dimensao === 'volume'`).
- **Modify: `test/semanal-compute-demandas.test.js`** — testes de `chegadasMensaisPorRegistro`.
- **Modify: `test/orcamento-build-dashboard.test.js`** — testes de `montarDemandasChegadasMensais` e do tratamento de arquivo obrigatório ausente; ajusta o teste e2e existente para o novo formato `{registros, ...}`.
- **Modify: `test/helpers/golden-orcamento.js`** — passa uma fixture de `demandasChegadasMensais`.
- **Regenerate: `test/fixtures/orcamento-golden.html`** — golden novo, deliberado.
- **Modify: `test/orcamento-render-dashboard.test.js`** — `extrairFuncoesPuras` ganha `demandasMensaisPorIndices` e expõe `window`; novos testes de `fecharTendenciaVigente`/`construirPainelGraficoHtml` com Demandas.
- **Modify: `CLAUDE.md`** (raiz do repositório) — documenta a nova dependência de build e a série nova.

---

### Task 1: `chegadasMensaisPorRegistro` em `tools/semanal/compute-demandas.js`

**Files:**
- Modify: `tools/semanal/compute-demandas.js`
- Test: `test/semanal-compute-demandas.test.js`

**Interfaces:**
- Consumes: `chaveMatriz` (já importado no topo do arquivo, `tools/comum/linha-base.js`), `zeros12`/`indiceDoMes` (já definidos no próprio arquivo).
- Produces: `chegadasMensaisPorRegistro(furos, ensaiosLab, periodos) → { [chaveMatriz]: number[12] }`, exportada em `module.exports`. Task 2 consome esta função.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao final de `test/semanal-compute-demandas.test.js` (reaproveita `furo()`, `d()`, `PERIODOS_2026` já definidos no topo do arquivo):

```js
const {
  computeDemandas, SERIES, SERIE_ESTOQUE, reconciliarSups, chegadasMensaisPorRegistro,
} = require('../tools/semanal/compute-demandas.js');
```

(troca a linha de `require` já existente no topo do arquivo, adicionando `chegadasMensaisPorRegistro` à desestruturação.)

```js
test('chegadasMensaisPorRegistro: bucketiza por (sup,tipologia), não por tipologia -- dois SUPs da mesma tipologia ficam em chaves separadas', () => {
  const furos = [
    furo({ sup: 'SUP-0001-24', tipologia: 'SP', criacaoOS: d(2026, 1, 10) }),
    furo({ sup: 'SUP-0002-24', tipologia: 'SP', criacaoOS: d(2026, 1, 15) }),
  ];
  const resultado = chegadasMensaisPorRegistro(furos, [], PERIODOS_2026);
  assert.deepStrictEqual(Object.keys(resultado).sort(), ['SUP-0001-24||SP', 'SUP-0002-24||SP']);
  assert.strictEqual(resultado['SUP-0001-24||SP'][0], 1);
  assert.strictEqual(resultado['SUP-0002-24||SP'][0], 1);
});

test('chegadasMensaisPorRegistro: ensaios de laboratório também contam, pelo evento "criacao" (Data Programada)', () => {
  const ensaios = [{ sup: 'SUP-0003-24', tipologia: 'LAB.C', criacao: d(2026, 3, 1), concluido: null }];
  const resultado = chegadasMensaisPorRegistro([], ensaios, PERIODOS_2026);
  assert.strictEqual(resultado['SUP-0003-24||LAB.C'][2], 1);
});

test('chegadasMensaisPorRegistro: furo sem criacaoOS não entra em nenhum mês, e não cria chave nenhuma', () => {
  const furos = [furo({ criacaoOS: null })];
  const resultado = chegadasMensaisPorRegistro(furos, [], PERIODOS_2026);
  assert.deepStrictEqual(resultado, {});
});

test('chegadasMensaisPorRegistro: sem furos nem ensaios devolve objeto vazio, não lança', () => {
  assert.deepStrictEqual(chegadasMensaisPorRegistro([], [], PERIODOS_2026), {});
  assert.deepStrictEqual(chegadasMensaisPorRegistro(undefined, undefined, PERIODOS_2026), {});
});

test('chegadasMensaisPorRegistro: a soma por mês, agregada de novo por tipologia, bate com demandas.totais.chegadas de computeDemandas -- duas leituras do MESMO conjunto de furos (por registro vs. por tipologia) não podem divergir', () => {
  const furos = [
    furo({ sup: 'SUP-0001-24', tipologia: 'SP', criacaoOS: d(2026, 1, 10) }),
    furo({ sup: 'SUP-0002-24', tipologia: 'SP', criacaoOS: d(2026, 2, 5) }),
    furo({ sup: 'SUP-0001-24', tipologia: 'ST', criacaoOS: d(2026, 1, 20) }),
  ];
  const porRegistro = chegadasMensaisPorRegistro(furos, [], PERIODOS_2026);
  const porTipologia = computeDemandas(furos, PERIODOS_2026, []);

  const somaSP = new Array(12).fill(0);
  ['SUP-0001-24||SP', 'SUP-0002-24||SP'].forEach((chave) => {
    (porRegistro[chave] || new Array(12).fill(0)).forEach((v, i) => { somaSP[i] += v; });
  });
  const blocoSP = porTipologia.tipologias.find((t) => t.tipologia === 'SP');
  assert.deepStrictEqual(somaSP, blocoSP.series.chegadas);
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node --test test/semanal-compute-demandas.test.js`
Expected: FAIL — `chegadasMensaisPorRegistro is not a function` (ou `undefined`, na desestruturação do `require`).

- [ ] **Step 3: Implementar `chegadasMensaisPorRegistro`**

Adicionar em `tools/semanal/compute-demandas.js`, logo depois de `computeDemandas` (antes de `reconciliarSups`):

```js
// Bucketiza as chegadas (evento 'criacaoOS'/'criacao' -- o mesmo que
// alimenta demandas.porRegistroEventos[chave].chegada dentro de
// computeDemandas acima) por (sup, tipologia) em vez de por tipologia --
// é o que o Gráfico do dashboard de ORÇAMENTO precisa pra recortar
// Demandas pelos MESMOS filtros de SUP/tipologia/grupo/origem que já
// recortam Previsto/Realizado/Tendência lá (ver
// docs/superpowers/specs/2026-08-13-demandas-no-grafico-orcamento-design.md).
// Roda no BUILD do orçamento (tools/orcamento/build-dashboard.js), sobre os
// MESMOS furos/ensaiosLab (já redirecionados pra "Diversos" quando o SUP
// não bate com a MATRIZ, ver redirecionarSupsDesconhecidos) que
// computeDemandas usaria -- por isso a soma por mês, agregada de volta por
// tipologia, tem que bater com demandas.totais.chegadas (ver o teste de
// invariante em test/semanal-compute-demandas.test.js).
function chegadasMensaisPorRegistro(furos, ensaiosLab, periodos) {
  const n = periodos.length;
  const porChave = new Map();

  function bucket(chave) {
    if (!porChave.has(chave)) porChave.set(chave, zeros12(n));
    return porChave.get(chave);
  }

  for (const f of furos || []) {
    if (!f.criacaoOS) continue;
    const iChegada = indiceDoMes(f.criacaoOS, periodos);
    if (iChegada < 0) continue;
    bucket(chaveMatriz(f.sup, f.tipologia))[iChegada] += 1;
  }

  for (const e of ensaiosLab || []) {
    if (!e.criacao) continue;
    const iChegada = indiceDoMes(e.criacao, periodos);
    if (iChegada < 0) continue;
    bucket(chaveMatriz(e.sup, e.tipologia))[iChegada] += 1;
  }

  return Object.fromEntries(porChave);
}
```

E atualizar a linha `module.exports` no final do arquivo, de:

```js
module.exports = { computeDemandas, reconciliarSups, redirecionarSupsDesconhecidos, resolverSupConhecido, SERIES, SERIE_ESTOQUE };
```

para:

```js
module.exports = {
  computeDemandas, reconciliarSups, redirecionarSupsDesconhecidos, resolverSupConhecido, SERIES, SERIE_ESTOQUE,
  chegadasMensaisPorRegistro,
};
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --test test/semanal-compute-demandas.test.js`
Expected: PASS (todos os testes, os novos e os já existentes).

- [ ] **Step 5: Confirmar que a página semanal não regrediu**

Run: `node --test test/*.test.js`
Expected: PASS — em especial `test/semanal-build-dashboard.test.js` e qualquer teste que exercite o bundle do navegador (`test/comum-browser-bundle.test.js`), já que a função nova é só ADITIVA (não muda nenhum `require` existente nem o `module.exports` de nada que já era consumido).

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/compute-demandas.js test/semanal-compute-demandas.test.js
git commit -m "Adicionar chegadasMensaisPorRegistro a compute-demandas.js, pro Gráfico do orçamento"
```

---

### Task 2: Ler as fontes online no build do orçamento

**Files:**
- Modify: `tools/orcamento/build-dashboard.js`
- Test: `test/orcamento-build-dashboard.test.js`

**Interfaces:**
- Consumes: `chegadasMensaisPorRegistro`, `redirecionarSupsDesconhecidos` (`tools/semanal/compute-demandas.js`, Task 1); `parseAvancos` (`tools/semanal/parse-avancos.js`); `parseLab` (`tools/semanal/parse-lab.js`); `parseCsvGrid` (`tools/semanal/parse-matriz-cliente.js`).
- Produces: `montarDemandasChegadasMensais({ registros, periodos, caminhoAvancosOnline, caminhoDemandasSondagemOnline, caminhoLabOnline, caminhoDemandasLabOnline }) → { [chaveMatriz]: number[12] }`, exportada de `tools/orcamento/build-dashboard.js`. `build()` ganha 4 parâmetros opcionais com o mesmo nome (default: os caminhos reais em `dist/`). Task 3 consome o retorno de `montarDemandasChegadasMensais` como o `demandasChegadasMensais` passado pra `renderDashboard`.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao final de `test/orcamento-build-dashboard.test.js` (o arquivo já importa `fs`, `os`, `path`; adicionar `assert` já está importado como `node:assert/strict`):

```js
test('montarDemandasChegadasMensais: lê avancos-online.csv + lab-online.csv (via parseCsvGrid) e devolve chegadas mensais por (sup,tipologia), redirecionando SUP desconhecido pra "Diversos"', () => {
  const { montarDemandasChegadasMensais } = require('../tools/orcamento/build-dashboard.js');
  const registros = [
    { sup: 'SUP-0001-24', tipologia: 'SP' },
    { sup: 'Diversos', tipologia: 'SP' },
  ];
  const periodos = Array.from({ length: 12 }, (_, m) => new Date(Date.UTC(2026, m, 1)));

  // 46023 = 01/01/2026, 46054 = 01/02/2026 (mesma convenção de serial Excel
  // usada em todo o resto do projeto).
  const avancosCsv = 'Contrato,Criação da OS,Tipo,Status,Executado Dia,Deslocamento,Total (m),Observações de Campo,OS,Sondador\n'
    + 'SUP-0001-24,46023,SP,PENDENTE,,Não,10,,OS-1,\n'
    + 'SUP-9999-24,46054,SP,PENDENTE,,Não,10,,OS-2,\n';

  const avancosPath = path.join(os.tmpdir(), `avancos-online-teste-${Date.now()}.csv`);
  const labPath = path.join(os.tmpdir(), `lab-online-teste-${Date.now()}.csv`);
  fs.writeFileSync(avancosPath, avancosCsv);
  fs.writeFileSync(labPath, 'ID Contrato,Ensaiado Dia,Tipo de Ensaio,Data Programada\n');

  try {
    const resultado = montarDemandasChegadasMensais({
      registros, periodos,
      caminhoAvancosOnline: avancosPath,
      caminhoDemandasSondagemOnline: path.join(os.tmpdir(), 'inexistente-sondagem.csv'),
      caminhoLabOnline: labPath,
      caminhoDemandasLabOnline: path.join(os.tmpdir(), 'inexistente-lab.json'),
    });
    assert.strictEqual(resultado['SUP-0001-24||SP'][0], 1);
    assert.strictEqual(resultado['Diversos||SP'][1], 1, 'furo de SUP desconhecido tem que redirecionar pra Diversos, não sumir');
  } finally {
    fs.unlinkSync(avancosPath);
    fs.unlinkSync(labPath);
  }
});

test('montarDemandasChegadasMensais: erro claro quando avancos-online.csv (obrigatório) não existe', () => {
  const { montarDemandasChegadasMensais } = require('../tools/orcamento/build-dashboard.js');
  assert.throws(
    () => montarDemandasChegadasMensais({
      registros: [], periodos: Array.from({ length: 12 }, (_, m) => new Date(Date.UTC(2026, m, 1))),
      caminhoAvancosOnline: path.join(os.tmpdir(), 'nunca-existiu.csv'),
      caminhoDemandasSondagemOnline: path.join(os.tmpdir(), 'nunca-existiu-2.csv'),
      caminhoLabOnline: path.join(os.tmpdir(), 'nunca-existiu-3.csv'),
      caminhoDemandasLabOnline: path.join(os.tmpdir(), 'nunca-existiu-4.json'),
    }),
    /atualizar-avancos-online\.js/,
  );
});
```

E ajustar a asserção do teste e2e já existente (`'build() reads a synthetic MATRIZ...'`) — o `html` decifrado passa a ser `{registros, demandasChegadasMensais}`, não mais um array puro. Trocar:

```js
    const registros = JSON.parse(decifrarComSenha(JSON.parse(match[1]), senha));
    const tipologias = registros.map(r => r.tipologia);
    const grupos = registros.map(r => r.grupo);
```

por:

```js
    const dados = JSON.parse(decifrarComSenha(JSON.parse(match[1]), senha));
    const registros = dados.registros;
    assert.ok(dados.demandasChegadasMensais && typeof dados.demandasChegadasMensais === 'object', 'o blob decifrado tem que trazer demandasChegadasMensais, mesmo vazio');
    const tipologias = registros.map(r => r.tipologia);
    const grupos = registros.map(r => r.grupo);
```

(as duas referências seguintes a `registros` no mesmo teste continuam funcionando sem mudança, já que a variável `registros` continua sendo o array.)

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node --test test/orcamento-build-dashboard.test.js`
Expected: FAIL — `montarDemandasChegadasMensais is not a function`, e o teste e2e existente falha em `registros.map is not a function` (ainda não mudamos `renderDashboard`, mas o teste já espera o formato novo — isso é esperado até a Task 3).

Nota: como a Task 3 (mudança em `renderDashboard`) ainda não rodou, o teste e2e vai continuar falhando até o fim da Task 3 — é aceitável fazer as Tasks 2 e 3 em sequência antes de rodar `node --test` de novo neste arquivo. Se preferir rodar isolado agora, comente temporariamente o ajuste do teste e2e e volte a ele na Task 3.

- [ ] **Step 3: Implementar `montarDemandasChegadasMensais` e os parâmetros novos de `build()`**

No topo de `tools/orcamento/build-dashboard.js`, adicionar aos requires já existentes:

```js
const { parseCsvGrid } = require('../semanal/parse-matriz-cliente.js');
const { parseAvancos } = require('../semanal/parse-avancos.js');
const { parseLab } = require('../semanal/parse-lab.js');
const { redirecionarSupsDesconhecidos, chegadasMensaisPorRegistro } = require('../semanal/compute-demandas.js');
```

Adicionar a função nova, antes de `function build(...)`:

```js
// Lê as mesmas 4 fontes online que tools/semanal/build-dashboard.js já usa
// pra Demandas (avancos-online.csv + lab-online.csv, obrigatórios; os dois
// "pendentes" são opcionais -- sem eles o backlog ainda não executado fica
// de fora, mas o build não quebra) e devolve {chaveMatriz: [12 chegadas por
// mês]} pro Gráfico do orçamento, dimensão Volume -- ver
// docs/superpowers/specs/2026-08-13-demandas-no-grafico-orcamento-design.md.
// Os dois pipelines (semanal e orçamento) leem a MESMA MATRIZ por parsers
// diferentes, então redirecionarSupsDesconhecidos roda de novo aqui contra
// os `registros` do ORÇAMENTO -- não reaproveita o resultado da semanal.
function montarDemandasChegadasMensais({
  registros, periodos, caminhoAvancosOnline, caminhoDemandasSondagemOnline, caminhoLabOnline, caminhoDemandasLabOnline,
}) {
  let gridAvancos;
  try {
    gridAvancos = parseCsvGrid(fs.readFileSync(caminhoAvancosOnline, 'utf8'));
  } catch (err) {
    throw new Error(
      `Não consegui ler ${caminhoAvancosOnline}. Rode "node tools/semanal/atualizar-avancos-online.js" primeiro ` +
      `(precisa do Chrome aberto com --remote-debugging-port=9222, logado em sond.com.br). Erro original: ${err.message}`
    );
  }
  if (fs.existsSync(caminhoDemandasSondagemOnline)) {
    const gridPendentes = parseCsvGrid(fs.readFileSync(caminhoDemandasSondagemOnline, 'utf8'));
    for (let i = 1; i < gridPendentes.length; i++) gridAvancos.push(gridPendentes[i]);
  } else {
    console.warn(`AVISO: ${caminhoDemandasSondagemOnline} não encontrado -- Demandas do Gráfico não inclui furos ainda não executados. Rode "node tools/semanal/atualizar-demandas-sondagem-online.js".`);
  }
  gridAvancos.unshift(null);
  const { furos } = parseAvancos(gridAvancos);

  let gridLab;
  try {
    gridLab = parseCsvGrid(fs.readFileSync(caminhoLabOnline, 'utf8'));
    gridLab.unshift(null);
  } catch (err) {
    throw new Error(
      `Não consegui ler ${caminhoLabOnline}. Rode "node tools/semanal/atualizar-lab-online.js" primeiro ` +
      `(precisa do Chrome aberto com --remote-debugging-port=9222, logado em sond.com.br). Erro original: ${err.message}`
    );
  }
  const { ensaios: ensaiosLidos } = parseLab(gridLab);

  let ensaiosComPendentes = ensaiosLidos;
  if (fs.existsSync(caminhoDemandasLabOnline)) {
    const pendentesLab = JSON.parse(fs.readFileSync(caminhoDemandasLabOnline, 'utf8'))
      .map(e => ({ ...e, criacao: e.criacao ? new Date(e.criacao) : null, concluido: null }));
    ensaiosComPendentes = ensaiosLidos.concat(pendentesLab);
  } else {
    console.warn(`AVISO: ${caminhoDemandasLabOnline} não encontrado -- Demandas do Gráfico não inclui backlog de LAB.C/LAB.E. Rode "node tools/semanal/atualizar-demandas-lab-online.js".`);
  }

  const { itens: furosRedirecionados } = redirecionarSupsDesconhecidos(furos, registros);
  const { itens: ensaiosRedirecionados } = redirecionarSupsDesconhecidos(ensaiosComPendentes, registros);
  return chegadasMensaisPorRegistro(furosRedirecionados, ensaiosRedirecionados, periodos);
}
```

Alterar a assinatura de `build()`, de:

```js
function build({ outPath, today = new Date(), senha = process.env.ORCAMENTO_SENHA } = {}) {
```

para:

```js
function build({
  outPath, today = new Date(), senha = process.env.ORCAMENTO_SENHA,
  caminhoAvancosOnline = path.join(__dirname, '..', '..', 'dist', 'avancos-online.csv'),
  caminhoDemandasSondagemOnline = path.join(__dirname, '..', '..', 'dist', 'demandas-sondagem-online.csv'),
  caminhoLabOnline = path.join(__dirname, '..', '..', 'dist', 'lab-online.csv'),
  caminhoDemandasLabOnline = path.join(__dirname, '..', '..', 'dist', 'demandas-lab-online.json'),
} = {}) {
```

E, dentro de `build()`, entre o bloco de `anexarPrevistoInicial` e a chamada de `renderDashboard`, adicionar:

```js
  const demandasChegadasMensais = montarDemandasChegadasMensais({
    registros, periodos, caminhoAvancosOnline, caminhoDemandasSondagemOnline, caminhoLabOnline, caminhoDemandasLabOnline,
  });
```

E trocar a chamada de `renderDashboard` de:

```js
  const html = renderDashboard({
    registros, periodos, generatedAt: today, senha,
    logoDataUri: loadDataUri(LOGO_PATH), iconDataUri: loadDataUri(ICON_PATH),
  });
```

para:

```js
  const html = renderDashboard({
    registros, periodos, generatedAt: today, senha, demandasChegadasMensais,
    logoDataUri: loadDataUri(LOGO_PATH), iconDataUri: loadDataUri(ICON_PATH),
  });
```

Por fim, expor a função nova no `module.exports` do arquivo (linha final), de:

```js
module.exports = { build, anexarPrevistoInicial };
```

para:

```js
module.exports = { build, anexarPrevistoInicial, montarDemandasChegadasMensais };
```

- [ ] **Step 4: Rodar os testes**

Run: `node --test test/orcamento-build-dashboard.test.js`
Expected: os dois testes novos de `montarDemandasChegadasMensais` PASSAM. O teste e2e (`'build() reads a synthetic MATRIZ...'`) ainda FALHA — a chamada a `build()` dentro dele não passa `caminhoAvancosOnline`/`caminhoLabOnline`, então cai no default (`dist/avancos-online.csv`/`dist/lab-online.csv` REAIS do repositório, que existem e são grandes) **e** `renderDashboard` ainda não sabe o que fazer com `demandasChegadasMensais` (Task 3). Isso é esperado nesta task — corrigido na Task 3, Step 4 abaixo.

- [ ] **Step 5: Commit**

```bash
git add tools/orcamento/build-dashboard.js test/orcamento-build-dashboard.test.js
git commit -m "Ler avancos-online.csv/lab-online.csv no build do orçamento e montar demandasChegadasMensais"
```

---

### Task 3: `renderDashboard` cifra `{registros, demandasChegadasMensais}` + golden

**Files:**
- Modify: `tools/orcamento/render-dashboard.js`
- Modify: `test/helpers/golden-orcamento.js`
- Modify: `test/orcamento-build-dashboard.test.js` (finaliza o teste e2e deixado pendente na Task 2)
- Regenerate: `test/fixtures/orcamento-golden.html`

**Interfaces:**
- Consumes: `demandasChegadasMensais` (Task 2's `montarDemandasChegadasMensais`, ou uma fixture direta nos testes/golden).
- Produces: `renderDashboard({ ..., demandasChegadasMensais = {} })` — o blob cifrado passa a decifrar para `{ registros: [...], demandasChegadasMensais: {...} }`. Task 4 consome esse formato no cliente.

- [ ] **Step 1: Atualizar o teste e2e da Task 2 pra apontar pras fontes sintéticas**

Em `test/orcamento-build-dashboard.test.js`, dentro do teste `'build() reads a synthetic MATRIZ...'`, criar CSVs sintéticos mínimos (mesmo padrão de `xlsxPath`/`linhaBasePath` já usado ali) e passá-los pra `build()`. Trocar:

```js
  try {
    const senha = 'senha-e2e-de-teste';
    build({ outPath, today: new Date(2026, 6, 21), senha });
```

por:

```js
  const avancosPath = path.join(os.tmpdir(), `avancos-online-e2e-${Date.now()}.csv`);
  const labPath = path.join(os.tmpdir(), `lab-online-e2e-${Date.now()}.csv`);
  fs.writeFileSync(avancosPath, 'Contrato,Criação da OS,Tipo,Status,Executado Dia,Deslocamento,Total (m),Observações de Campo,OS,Sondador\n');
  fs.writeFileSync(labPath, 'ID Contrato,Ensaiado Dia,Tipo de Ensaio,Data Programada\n');

  try {
    const senha = 'senha-e2e-de-teste';
    build({
      outPath, today: new Date(2026, 6, 21), senha,
      caminhoAvancosOnline: avancosPath,
      caminhoDemandasSondagemOnline: path.join(os.tmpdir(), 'inexistente-sondagem-e2e.csv'),
      caminhoLabOnline: labPath,
      caminhoDemandasLabOnline: path.join(os.tmpdir(), 'inexistente-lab-e2e.json'),
    });
```

E no bloco `finally` do mesmo teste, apagar os dois arquivos novos também. Trocar:

```js
  } finally {
    fs.unlinkSync(xlsxPath);
    fs.unlinkSync(linhaBasePath);
```

por:

```js
  } finally {
    fs.unlinkSync(xlsxPath);
    fs.unlinkSync(linhaBasePath);
    fs.unlinkSync(avancosPath);
    fs.unlinkSync(labPath);
```

- [ ] **Step 2: Rodar o teste e2e e confirmar que falha do jeito esperado**

Run: `node --test test/orcamento-build-dashboard.test.js`
Expected: FAIL — `TypeError: registros.map is not a function` (o ajuste do Step 1 da Task 2 já trocou pra `dados.registros`, mas `renderDashboard` ainda cifra só o array puro, então `dados` já É o array, e `dados.registros` é `undefined`).

- [ ] **Step 3: Implementar a mudança em `renderDashboard`**

Em `tools/orcamento/render-dashboard.js`, trocar a assinatura e a montagem do JSON cifrado (por volta da linha 1865):

```js
function renderDashboard({ registros, periodos, generatedAt, logoDataUri, iconDataUri, senha }) {
```

para:

```js
function renderDashboard({ registros, periodos, generatedAt, logoDataUri, iconDataUri, senha, demandasChegadasMensais = {} }) {
```

E trocar:

```js
  const registrosJson = JSON.stringify(registros.map(r => ({
    sup: r.sup, grupo: r.grupo, tomador: r.tomador, escopo: r.escopo, tipologia: r.tipologia, origem: r.origem,
    previstoInicial: r.previstoInicial, previsto: r.previsto, realizado: r.realizado, total: r.total,
  })));
```

por:

```js
  const registrosJson = JSON.stringify({
    registros: registros.map(r => ({
      sup: r.sup, grupo: r.grupo, tomador: r.tomador, escopo: r.escopo, tipologia: r.tipologia, origem: r.origem,
      previstoInicial: r.previstoInicial, previsto: r.previsto, realizado: r.realizado, total: r.total,
    })),
    demandasChegadasMensais,
  });
```

(as duas linhas seguintes -- `cifrarComSenha(registrosJson, senha)` e o `dadosCifradosJson` -- não mudam.)

- [ ] **Step 4: Rodar o teste e2e de novo**

Run: `node --test test/orcamento-build-dashboard.test.js`
Expected: PASS (todos os testes do arquivo).

- [ ] **Step 5: Atualizar a fixture do golden**

Em `test/helpers/golden-orcamento.js`, adicionar uma fixture de demandas (chave batendo com um dos registros reais de `test/fixtures/registros-golden.json` -- `SUP-0002-24||SP`) e passá-la pra `renderDashboard`:

```js
const DEMANDAS_GOLDEN = {
  'SUP-0002-24||SP': [3, 0, 5, 0, 0, 2, 0, 0, 0, 4, 0, 0],
};

function construirHtmlGolden() {
  return renderDashboard({
    registros: JSON.parse(fs.readFileSync(FIXTURE, 'utf8')),
    periodos: PERIODOS,
    generatedAt: DATA_FIXA,
    senha: SENHA_FIXA,
    demandasChegadasMensais: DEMANDAS_GOLDEN,
    logoDataUri: 'data:image/png;base64,GOLDEN',
    iconDataUri: 'data:image/png;base64,GOLDEN',
  });
}
```

- [ ] **Step 6: Regenerar o golden**

Run:
```bash
node -e "const fs = require('fs'); const { construirHtmlGolden } = require('./test/helpers/golden-orcamento.js'); fs.writeFileSync('test/fixtures/orcamento-golden.html', construirHtmlGolden());"
```
Expected: `test/fixtures/orcamento-golden.html` reescrito (o `git diff` deve mostrar só a linha `window.__DADOS_CIFRADOS__` mudando de forma -- byte-a-byte diferente por causa do formato novo do blob, salt/iv novos, e o carimbo "Gerado em" -- nada mais deve mudar visivelmente na estrutura do HTML).

- [ ] **Step 7: Rodar os testes de golden**

Run: `node --test test/orcamento-html-inalterado.test.js`
Expected: PASS -- em especial o teste `'os registros cifrados... continuam os mesmos do golden, decifrados'`, que agora compara o objeto `{registros, demandasChegadasMensais}` inteiro entre duas execuções (prova que a fixture nova é determinística).

- [ ] **Step 8: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS -- nenhum outro teste deveria ter sido afetado por esta task (Tabela/Alertas/Gráfico das outras dimensões ainda não mudaram; só o formato do blob).

- [ ] **Step 9: Commit**

```bash
git add tools/orcamento/render-dashboard.js test/helpers/golden-orcamento.js test/fixtures/orcamento-golden.html test/orcamento-build-dashboard.test.js
git commit -m "renderDashboard cifra {registros, demandasChegadasMensais}; regenerar golden"
```

---

### Task 4: Cliente desembrulha `{registros, demandasChegadasMensais}`

**Files:**
- Modify: `tools/orcamento/render-dashboard.js`
- Test: `test/orcamento-render-dashboard.test.js`

**Interfaces:**
- Consumes: nada novo (mexe só em `fecharTendenciaVigente`, já extraída via `extrairFuncoesPuras` nos testes existentes).
- Produces: `window.__DEMANDAS_MENSAIS__` setado após qualquer desbloqueio bem-sucedido (gate de senha) quando o blob decifrado trouxer `demandasChegadasMensais`; preservado (não sobrescrito com `undefined`) quando `atualizarDadosAoVivo` chama `fecharTendenciaVigente` de novo com um array puro (a MATRIZ espelho não tem Demandas). Task 5 consome `window.__DEMANDAS_MENSAIS__`.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar a `test/orcamento-render-dashboard.test.js` (perto dos outros testes de `fecharTendenciaVigente`, se já existirem; senão, num bloco novo). Primeiro, garantir que `extrairFuncoesPuras` devolve `window` (ver Step 3 abaixo) -- os testes deste Step já assumem isso:

```js
test('fecharTendenciaVigente: desembrulha {registros, demandasChegadasMensais}, guarda demandas em window.__DEMANDAS_MENSAIS__ e devolve só o array de registros', () => {
  const html = construirHtmlGolden();
  const { fecharTendenciaVigente, window: sandboxWindow } = extrairFuncoesPuras(html);

  const registro = { sup: 'SUP-X', tipologia: 'SP', total: null, realizado: null };
  const resultado = fecharTendenciaVigente({ registros: [registro], demandasChegadasMensais: { 'SUP-X||SP': [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] } }, 5);

  assert.deepStrictEqual(resultado, [registro]);
  assert.deepStrictEqual(sandboxWindow.__DEMANDAS_MENSAIS__, { 'SUP-X||SP': [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
});

test('fecharTendenciaVigente: chamada com um array puro (live-refresh, sem Demandas) preserva window.__DEMANDAS_MENSAIS__ já setado, em vez de apagar', () => {
  const html = construirHtmlGolden();
  const { fecharTendenciaVigente, window: sandboxWindow } = extrairFuncoesPuras(html);

  const registro = { sup: 'SUP-X', tipologia: 'SP', total: null, realizado: null };
  fecharTendenciaVigente({ registros: [registro], demandasChegadasMensais: { 'SUP-X||SP': [9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] } }, 5);
  assert.deepStrictEqual(sandboxWindow.__DEMANDAS_MENSAIS__, { 'SUP-X||SP': [9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] });

  // live-refresh: registrosNovos é um ARRAY puro, sem demandasChegadasMensais.
  const registrosNovos = [{ sup: 'SUP-Y', tipologia: 'ST', total: null, realizado: null }];
  const resultado = fecharTendenciaVigente(registrosNovos, 5);

  assert.deepStrictEqual(resultado, registrosNovos);
  assert.deepStrictEqual(sandboxWindow.__DEMANDAS_MENSAIS__, { 'SUP-X||SP': [9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }, 'live-refresh não deve apagar as Demandas do build');
});
```

(precisa de `const { construirHtmlGolden } = require('./helpers/golden-orcamento.js');` no topo do arquivo de teste -- confirmar se já está importado; se não estiver, adicionar.)

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: FAIL -- `sandboxWindow` é `undefined` (Step 3 ainda não feito) e/ou `fecharTendenciaVigente({registros:[...], ...}, 5)` devolve `undefined`/lança (a função ainda espera um array puro como primeiro argumento, e chamaria `.map` num objeto).

- [ ] **Step 3: Expor `window` em `extrairFuncoesPuras`**

Em `test/orcamento-render-dashboard.test.js`, na função `extrairFuncoesPuras`, no objeto retornado (depois de `mediaEquipesPonderada: sandbox.mediaEquipesPonderada,` ou onde for a última linha antes do `};` de fechamento), adicionar:

```js
    window: sandbox.window,
```

- [ ] **Step 4: Implementar a mudança em `fecharTendenciaVigente`**

Em `tools/orcamento/render-dashboard.js`, trocar (por volta da linha 119):

```js
function fecharTendenciaVigente(registros, vigenteIdx) {
  if (vigenteIdx < 0 || vigenteIdx > 11) return registros; // fora do ano coberto -- nada a fechar
  return registros.map(function (registro) {
```

por:

```js
// dados: o que o gate acabou de JSON.parse -- {registros, demandasChegadasMensais}
// (ver renderDashboard). Guarda demandasChegadasMensais em
// window.__DEMANDAS_MENSAIS__ SÓ quando presente -- atualizarDadosAoVivo
// chama esta mesma função de novo com um array puro (a MATRIZ espelho não
// tem Demandas), e sobrescrever incondicionalmente apagaria as Demandas do
// build a cada "Atualizar dados ao vivo". Mesmo espírito de
// window.__DEMANDAS__ em tools/semanal/render-semanal.js, com a exceção
// condicional documentada acima.
function fecharTendenciaVigente(dados, vigenteIdx) {
  if (dados && dados.demandasChegadasMensais) window.__DEMANDAS_MENSAIS__ = dados.demandasChegadasMensais;
  var registros = (dados && dados.registros) ? dados.registros : dados;
  if (vigenteIdx < 0 || vigenteIdx > 11) return registros; // fora do ano coberto -- nada a fechar
  return registros.map(function (registro) {
```

(o corpo do `.map(...)` continua idêntico -- só a linha de abertura da função e a extração de `registros` mudam. O fechamento `});` e `}` do final da função não mudam.)

- [ ] **Step 5: Rodar os testes**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: PASS (os dois testes novos e todos os já existentes que chamam `fecharTendenciaVigente` -- conferir se algum teste antigo chamava `fecharTendenciaVigente(arrayDeRegistros, idx)` direto; se sim, ele continua passando, porque um array puro cai no `else` de `(dados && dados.registros) ? ... : dados` e devolve o próprio array, exatamente como antes).

- [ ] **Step 6: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tools/orcamento/render-dashboard.js test/orcamento-render-dashboard.test.js
git commit -m "Cliente do orçamento desembrulha {registros, demandasChegadasMensais} em fecharTendenciaVigente"
```

---

### Task 5: A série "Demandas" no Gráfico (dimensão Volume)

**Files:**
- Modify: `tools/orcamento/render-dashboard.js`
- Test: `test/orcamento-render-dashboard.test.js`

**Interfaces:**
- Consumes: `window.__DEMANDAS_MENSAIS__` (Task 4), `calcularAcumulado` (já existe, `tools/orcamento/render-dashboard.js:392`), `indices`/`registros` (já passados pra `construirPainelGraficoHtml`).
- Produces: `demandasMensaisPorIndices(indices, registros, demandasMensais) → number[12]`, nova função exportada via `extrairFuncoesPuras` nos testes. `dadosPorSerie` ganha uma 5ª entrada `{serie:'demandas', ...}` só quando `dimensao === 'volume'`.

- [ ] **Step 1: Escrever os testes que falham**

Em `extrairFuncoesPuras` (`test/orcamento-render-dashboard.test.js`), adicionar `demandasMensaisPorIndices` à lista de nomes injetados (na string grande de `this.X = X;`) e ao objeto retornado -- mesmo padrão de `construirPainelGraficoHtml` já feito ali:

```js
      ' this.demandasMensaisPorIndices = demandasMensaisPorIndices;' +
```

(adicionar essa linha junto das outras `this.X = X;`, antes do fechamento da string) e, no objeto retornado:

```js
    demandasMensaisPorIndices: sandbox.demandasMensaisPorIndices,
```

Depois, adicionar os testes novos:

```js
test('demandasMensaisPorIndices: soma os arrays das chaves (sup||tipologia) dos registros filtrados, mês a mês', () => {
  const html = construirHtmlGolden();
  const { demandasMensaisPorIndices } = extrairFuncoesPuras(html);

  const registros = [
    { sup: 'SUP-A', tipologia: 'SP' },
    { sup: 'SUP-B', tipologia: 'SP' },
    { sup: 'SUP-C', tipologia: 'ST' }, // fora dos indices filtrados
  ];
  const demandasMensais = {
    'SUP-A||SP': [1, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    'SUP-B||SP': [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    'SUP-C||ST': [99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99],
  };

  const resultado = demandasMensaisPorIndices([0, 1], registros, demandasMensais);
  assert.deepStrictEqual(resultado, [4, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test('demandasMensaisPorIndices: registro sem entrada em demandasMensais não quebra, conta como 12 zeros', () => {
  const html = construirHtmlGolden();
  const { demandasMensaisPorIndices } = extrairFuncoesPuras(html);
  const registros = [{ sup: 'SUP-SEM-DADO', tipologia: 'SP' }];
  const resultado = demandasMensaisPorIndices([0], registros, { 'SUP-OUTRO||SP': [5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
  assert.deepStrictEqual(resultado, new Array(12).fill(0));
});

test('demandasMensaisPorIndices: sem demandasMensais (undefined) devolve 12 zeros, não lança', () => {
  const html = construirHtmlGolden();
  const { demandasMensaisPorIndices } = extrairFuncoesPuras(html);
  assert.deepStrictEqual(demandasMensaisPorIndices([0], [{ sup: 'X', tipologia: 'Y' }], undefined), new Array(12).fill(0));
});

test('construirPainelGraficoHtml: dimensão Volume inclui uma 5ª série "Demandas" (roxa, #9700DA) em dadosPorSerie, com acumulado em soma corrida', () => {
  const html = construirHtmlGolden();
  const { construirPainelGraficoHtml, window: sandboxWindow } = extrairFuncoesPuras(html);
  sandboxWindow.__DEMANDAS_MENSAIS__ = { 'SUP-0002-24||SP': [3, 0, 5, 0, 0, 2, 0, 0, 0, 4, 0, 0] };

  const registro = { sup: 'SUP-0002-24', tipologia: 'SP', previsto: null, previstoInicial: null, realizado: null, total: null };
  const htmlPainel = construirPainelGraficoHtml([registro], [0], new Set(), 'volume');

  assert.match(htmlPainel, /#9700DA/, 'a cor de Demandas precisa aparecer no SVG desenhado');
  assert.match(htmlPainel, /Demandas/, 'o rótulo "Demandas" precisa aparecer (legenda/tooltip)');
});

test('construirPainelGraficoHtml: dimensões que NÃO são Volume nunca ganham a série Demandas, mesmo com window.__DEMANDAS_MENSAIS__ preenchido', () => {
  const html = construirHtmlGolden();
  const { construirPainelGraficoHtml, window: sandboxWindow } = extrairFuncoesPuras(html);
  sandboxWindow.__DEMANDAS_MENSAIS__ = { 'SUP-0002-24||SP': [3, 0, 5, 0, 0, 2, 0, 0, 0, 4, 0, 0] };

  const registro = { sup: 'SUP-0002-24', tipologia: 'SP', previsto: null, previstoInicial: null, realizado: null, total: null };
  const htmlFinanceiro = construirPainelGraficoHtml([registro], [0], new Set(), 'financeiro');

  assert.doesNotMatch(htmlFinanceiro, /#9700DA/);
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: FAIL -- `demandasMensaisPorIndices is not a function`, e os testes de `construirPainelGraficoHtml` com `'volume'` não encontram `#9700DA`/`Demandas` no SVG.

- [ ] **Step 3: Implementar `demandasMensaisPorIndices`, `SERIE_LABELS`/`SERIE_COR`/`SERIE_TRACEJADO`, e a injeção em `construirPainelGraficoHtml`**

Em `tools/orcamento/render-dashboard.js`, trocar as 3 linhas de configuração de série (por volta da linha 482, 488, 1109):

```js
var SERIE_COR = { previstoInicial: '#8b8a82', previsto: '#2f6ad0', realizado: '#7fd858', total: '#f6b53f', realizadoPrevistoInicial: '#a78bfa' };
```
→
```js
var SERIE_COR = { previstoInicial: '#8b8a82', previsto: '#2f6ad0', realizado: '#7fd858', total: '#f6b53f', realizadoPrevistoInicial: '#a78bfa', demandas: '#9700DA' };
```

```js
var SERIE_TRACEJADO = { previstoInicial: '2,4', previsto: '', realizado: '1,5', total: '9,5', realizadoPrevistoInicial: '6,3,1,3' };
```
→
```js
var SERIE_TRACEJADO = { previstoInicial: '2,4', previsto: '', realizado: '1,5', total: '9,5', realizadoPrevistoInicial: '6,3,1,3', demandas: '4,2' };
```

```js
var SERIE_LABELS = { previstoInicial: 'Previsto Inicial', previsto: 'Previsto', realizado: 'Realizado', total: 'Tendência', realizadoPrevistoInicial: 'Realizado + Previsto Inicial' };
```
→
```js
var SERIE_LABELS = { previstoInicial: 'Previsto Inicial', previsto: 'Previsto', realizado: 'Realizado', total: 'Tendência', realizadoPrevistoInicial: 'Realizado + Previsto Inicial', demandas: 'Demandas' };
```

Adicionar `demandasMensaisPorIndices`, logo antes de `construirPainelGraficoHtml` (por volta da linha 784):

```js
// Soma, mês a mês, os arrays de demandasMensais (window.__DEMANDAS_MENSAIS__,
// {chaveMatriz: [12 chegadas]} montado no build -- ver
// tools/orcamento/build-dashboard.js:montarDemandasChegadasMensais) das
// chaves (sup||tipologia) dos registros que passaram no filtro atual.
// Mesma chave de tools/comum/linha-base.js:chaveMatriz, reproduzida aqui
// como concatenação simples (sem importar o módulo -- este código roda
// embutido no <script> da página, sem require).
function demandasMensaisPorIndices(indices, registros, demandasMensais) {
  var mensal = new Array(12).fill(0);
  if (!demandasMensais) return mensal;
  indices.forEach(function (idx) {
    var registro = registros[idx];
    var chave = registro.sup + '||' + registro.tipologia;
    var porMes = demandasMensais[chave];
    if (!porMes) return;
    for (var i = 0; i < 12; i++) mensal[i] += porMes[i] || 0;
  });
  return mensal;
}
```

E, dentro de `construirPainelGraficoHtml`, logo depois do bloco que monta `var dadosPorSerie = seriesVisiveis.map(function (serie) { ... });` (o `.map` inteiro, que termina em `});`) e ANTES de `var rotuloDimensao = ...`, adicionar:

```js
  // Demandas (chegadas -- furos de sondagem + ensaios de laboratório) só
  // faz sentido em Volume: é uma contagem física, sem equivalente em R$
  // (Financeiro) nem headcount (Equipes), e Produtividade/Ticket médio são
  // razões que não admitem uma 5ª série somada. Sempre visível quando a
  // dimensão é Volume -- não passa pelo filtro-serie (Previsto Inicial/
  // Previsto/Realizado/Total), decisão explícita do dono do projeto em
  // 2026-08-13 (ver o spec). Acumulado por soma corrida (calcularAcumulado),
  // igual às outras 3 séries de fluxo -- Demandas aqui é "chegadas", não
  // "pendentes" (estoque), então soma normalmente.
  if (dimensao === 'volume') {
    var demandasMensal = demandasMensaisPorIndices(indices, registros, window.__DEMANDAS_MENSAIS__);
    dadosPorSerie = dadosPorSerie.concat([{ serie: 'demandas', mensal: demandasMensal, acumulado: calcularAcumulado(demandasMensal), indiceConector: null }]);
  }
```

- [ ] **Step 4: Rodar os testes**

Run: `node --test test/orcamento-render-dashboard.test.js`
Expected: PASS (todos, novos e existentes).

- [ ] **Step 5: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS.

- [ ] **Step 6: Verificação visual manual (opcional, mas recomendada)**

Se `ORCAMENTO_SENHA` estiver disponível nesta máquina:

```bash
ORCAMENTO_SENHA='...' node tools/orcamento/build-dashboard.js
```

Abrir `dist/orcamento-dashboard.html` num navegador, desbloquear, ir na aba Gráfico, marcar só a dimensão Volume, e conferir visualmente: uma 4ª barra roxa no painel Mensal, uma 4ª linha roxa tracejada no painel Acumulado, "Demandas" na legenda. Trocar pra Financeiro/Equipes/Produtividade/Ticket médio e confirmar que a série roxa NÃO aparece.

- [ ] **Step 7: Commit**

```bash
git add tools/orcamento/render-dashboard.js test/orcamento-render-dashboard.test.js
git commit -m "Adicionar a série Demandas (roxa) ao Gráfico do orçamento, dimensão Volume"
```

---

### Task 6: Documentação (`CLAUDE.md`)

**Files:**
- Modify: `CLAUDE.md` (raiz do repositório `orcamento-dashboard`)

**Interfaces:**
- Consumes: nada (documentação pura).
- Produces: nada (não afeta código nem testes).

- [ ] **Step 1: Adicionar uma seção nova em `CLAUDE.md`**

Inserir, logo antes da seção `## Pendência conhecida: aba Gerencial` (ou em outro ponto de sua escolha que preserve a ordem cronológica do arquivo), o seguinte bloco:

```markdown
## Demandas no Gráfico (dimensão Volume, 2026-08-13)

A aba Gráfico ganhou uma 4ª série, "Demandas" (roxo `#9700DA`), visível só na
dimensão Volume -- barra mensal de chegadas (furos de sondagem + ensaios de
laboratório) + linha de acumulado por soma corrida. Ver
`docs/superpowers/specs/2026-08-13-demandas-no-grafico-orcamento-design.md`
pro design completo, incluindo a comparação contra o BI de referência que
decidiu `chegadas` (fluxo) em vez de `pendentes` (estoque).

**O build do orçamento passou a depender de 4 arquivos que antes só a página
semanal usava** (`dist/avancos-online.csv` e `dist/lab-online.csv`,
obrigatórios; `dist/demandas-sondagem-online.csv` e
`dist/demandas-lab-online.json`, opcionais -- sem eles o build roda normal,
só sem o backlog ainda não executado nas Demandas). Se faltar um dos dois
obrigatórios, `node tools/orcamento/build-dashboard.js` falha com uma
mensagem que já diz o comando pra gerar (`node
tools/semanal/atualizar-avancos-online.js` / `atualizar-lab-online.js`,
documentados na seção "Planejamento Semanal" abaixo -- precisam do Chrome
aberto com `--remote-debugging-port=9222`, logado em sond.com.br). Rodar só
o build do orçamento numa máquina que nunca rodou a semanal exige rodar esses
2 (ou 4) comandos pelo menos uma vez antes.

`tools/semanal/compute-demandas.js` ganhou `chegadasMensaisPorRegistro`
(aditiva, não muda nada que a página semanal já consumia) -- é a função que
bucketiza chegadas por (SUP, tipologia) × mês, em vez de só por tipologia.
**Este arquivo continua em `tools/semanal/`, não foi movido pra
`tools/comum/`** -- ver o comentário de "Riscos investigados" no plano de
implementação (`docs/superpowers/plans/2026-08-13-demandas-no-grafico-orcamento.md`):
mover quebraria o bundle do navegador da página semanal, que concatena o
arquivo como texto e reescreve `require()`s por posição de diretório.
`tools/orcamento/build-dashboard.js` importa direto de `tools/semanal/`
(Node puro, nenhum bundle envolvido nesse lado).

**O formato do blob cifrado mudou** de um array puro de registros para
`{ registros, demandasChegadasMensais }` -- `window.__REGISTROS__` continua
sendo só o array (o cliente desembrulha em `fecharTendenciaVigente`), e
`window.__DEMANDAS_MENSAIS__` é o novo global com `{chaveMatriz: [12
chegadas por mês]}`. **O botão "Atualizar dados ao vivo" não atualiza
Demandas** -- ele só busca a Sheet espelho da MATRIZ, então
`window.__DEMANDAS_MENSAIS__` fica com o valor do último build até uma
rodada futura trazer isso pro live-refresh também.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "Documentar a série Demandas no Gráfico e a nova dependência de build"
```

---

### Task 7: Verificação final

**Files:** nenhum arquivo novo -- só execução e checagem.

**Interfaces:** N/A.

- [ ] **Step 1: Suíte completa**

Run: `node --test test/*.test.js`
Expected: PASS -- 100% dos testes, incluindo os de `tools/semanal/` (nenhuma regressão na página publicada).

- [ ] **Step 2: Build real (se `ORCAMENTO_SENHA` e as planilhas de origem estiverem disponíveis nesta máquina)**

```bash
ORCAMENTO_SENHA='senha-de-verificacao' node tools/orcamento/build-dashboard.js
```

Expected: build termina sem erro, reporta "Wrote N bytes to .../dist/orcamento-dashboard.html". Se `dist/avancos-online.csv`/`dist/lab-online.csv` estiverem desatualizados (não é bloqueante, mas vale rodar `node tools/semanal/atualizar-avancos-online.js`/`atualizar-lab-online.js` antes se quiser dado fresco).

- [ ] **Step 3: Diff seletivo contra o HTML publicado**

Se houver uma cópia do `dist/orcamento-dashboard.html`/`docs/index.html` publicado ANTES desta mudança (ex.: `git show HEAD~N:dist/orcamento-dashboard.html`), comparar visualmente ou por diff de texto (ignorando `__DADOS_CIFRADOS__` e "Gerado em"): as dimensões Equipes/Financeiro/Produtividade/Ticket médio, a Tabela e os Alertas devem ficar idênticos; só o painel de Volume do Gráfico muda.

- [ ] **Step 4: Publicar (só se o dono do projeto pedir explicitamente nesta sessão)**

```bash
cp dist/orcamento-dashboard.html docs/index.html
git add dist/orcamento-dashboard.html docs/index.html
git commit -m "Rebuild: Demandas no Gráfico do orçamento, dimensão Volume"
git push origin master
```

**Não rodar este step sem confirmação explícita** -- publicar no Pages é uma ação visível externamente (mesma disciplina do resto do projeto).
