# Planejamento Semanal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar uma segunda página no `orcamento-dashboard` — `docs/planejamento-semanal.html` — com o mês vigente dividido em 4 semanas (aba 1) e o gráfico Balanço de massa por tipologia (aba 2), reaproveitando a casca visual do orçamento em vez de duplicá-la.

**Architecture:** Três fases de risco crescente. A primeira cria a rede de segurança (diff byte-a-byte do HTML do orçamento) e move utilitários puros para `tools/comum/`. A segunda extrai a casca visual **preservando o texto emitido exatamente**, de modo que o orçamento continue byte-idêntico. A terceira constrói a página nova sobre essa casca, com a lógica de cálculo em módulos Node reais inlinados via `browser-bundle`, padrão já usado em `tools/matriz/` e `tools/medicoes/` no repositório irmão.

**Tech Stack:** Node.js padrão (sem npm install, sem dependências), `node:test`, HTML/CSS/SVG gerados por template literals, AES-256-GCM via `node:crypto`.

## Global Constraints

- **Sem dependências de npm.** Nada de `npm install`; só módulos `node:*` e código do próprio repositório.
- **`ORCAMENTO_SENHA` só como variável de ambiente.** Nunca escrever a senha em nenhum arquivo do repositório (código, config, doc, teste ou fixture). Testes usam senha fictícia passada em memória.
- **`docs/` é o que o GitHub Pages serve** (`master:/docs`). Todo build destinado a deploy precisa copiar `dist/<arquivo>.html` para `docs/<arquivo>.html` e commitar os dois juntos.
- **A URL do orçamento não muda:** `docs/index.html` continua sendo o dashboard de orçamento. A página nova é um arquivo adicional, `docs/planejamento-semanal.html`.
- **Dados identificadores são protegidos pela senha.** SUP, GRUPO, TOMADOR e TIPOLOGIA nunca podem aparecer em texto puro no HTML gerado — por isso o cálculo e a montagem das tabelas acontecem no navegador, depois da decifragem, e não no build.
- **Rodar a suíte:** `node --test test/*.test.js` a partir de `orcamento-dashboard/`.
- **Equipes não é fluxo.** Em qualquer período de mais de um mês, equipes usa média ponderada por dias (`mediaEquipesPonderada`), nunca soma. Na divisão semanal, equipes **não** se divide por 4.
- **Crases dentro de strings de JS de cliente precisam ser escapadas** como `` \` ``.

---

### Task 1: Rede de segurança — diff byte-a-byte do orçamento

Antes de mover qualquer linha, criar o teste que prova que o HTML do orçamento não mudou. Todas as tarefas seguintes dependem dele.

**Files:**
- Create: `test/helpers/build-golden.js`
- Create: `test/orcamento-html-inalterado.test.js`
- Create: `test/fixtures/orcamento-golden.html`

**Interfaces:**
- Produces: `normalizarVolatil(html)` → `string` (o HTML com as duas linhas voláteis substituídas por marcadores fixos), consumido pelas Tasks 2, 3 e 4.

- [ ] **Step 1: Escrever o helper que constrói e normaliza**

`test/helpers/build-golden.js`:

```js
'use strict';
const { readXlsxSheet } = require('../../tools/orcamento/xlsx-reader.js');
const { parseMatriz } = require('../../tools/orcamento/parse-matriz.js');
const { parseBaseline } = require('../../tools/orcamento/parse-baseline.js');
const { renderDashboard } = require('../../tools/orcamento/render-dashboard.js');

// As duas únicas linhas que mudam legitimamente entre dois builds do mesmo
// código: o blob cifrado (nonce aleatório a cada execução) e o carimbo de
// data. Tudo o mais tem que ser idêntico byte a byte.
function normalizarVolatil(html) {
  return html
    .replace(/__DADOS_CIFRADOS__\s*=\s*"[^"]*"/, '__DADOS_CIFRADOS__="<NORMALIZADO>"')
    .replace(/Gerado em[^<]*/g, 'Gerado em <NORMALIZADO>');
}

module.exports = { normalizarVolatil };
```

- [ ] **Step 2: Escrever o teste que falha**

`test/orcamento-html-inalterado.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { normalizarVolatil } = require('./helpers/build-golden.js');

const GOLDEN = path.join(__dirname, 'fixtures', 'orcamento-golden.html');

test('o HTML do orçamento continua byte-idêntico ao golden', () => {
  const atual = fs.readFileSync(
    path.join(__dirname, '..', 'dist', 'orcamento-dashboard.html'), 'utf8');
  const golden = fs.readFileSync(GOLDEN, 'utf8');
  assert.strictEqual(normalizarVolatil(atual), normalizarVolatil(golden));
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `node --test test/orcamento-html-inalterado.test.js`
Expected: FAIL — `ENOENT` em `test/fixtures/orcamento-golden.html`, que ainda não existe.

- [ ] **Step 4: Gerar o golden a partir do build atual**

```bash
mkdir -p test/fixtures
cp dist/orcamento-dashboard.html test/fixtures/orcamento-golden.html
```

O `dist/orcamento-dashboard.html` versionado é o build corrente e serve de referência. Não é preciso ter `ORCAMENTO_SENHA` nem acesso ao `G:\` para esta tarefa.

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `node --test test/orcamento-html-inalterado.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add test/helpers/build-golden.js test/orcamento-html-inalterado.test.js test/fixtures/orcamento-golden.html
git commit -m "Adicionar diff byte-a-byte do HTML do orçamento como rede de segurança"
```

---

### Task 2: Fase A — mover utilitários puros para tools/comum/

**Files:**
- Create: `tools/comum/xlsx-reader.js`, `tools/comum/zip-reader.js`, `tools/comum/xlsx-cells.js`, `tools/comum/criptografia.js`, `tools/comum/datas.js` (movidos, conteúdo inalterado)
- Delete: os mesmos cinco arquivos em `tools/orcamento/`
- Modify: `tools/orcamento/build-dashboard.js`, `tools/orcamento/parse-matriz.js`, `tools/orcamento/parse-baseline.js`, `tools/orcamento/render-dashboard.js` (só os caminhos de `require`)
- Modify: `test/orcamento-xlsx-reader.test.js`, `test/orcamento-xlsx-cells.test.js`, `test/orcamento-zip-reader.test.js`, `test/orcamento-criptografia.test.js`, `test/orcamento-datas.test.js`, `test/helpers/build-golden.js` (caminhos)

**Interfaces:**
- Consumes: `normalizarVolatil` da Task 1.
- Produces: `require('../comum/xlsx-reader.js')` e irmãos, consumidos pelas Tasks 3–11.

- [ ] **Step 1: Mover os cinco arquivos preservando histórico**

```bash
mkdir -p tools/comum
git mv tools/orcamento/xlsx-reader.js   tools/comum/xlsx-reader.js
git mv tools/orcamento/zip-reader.js    tools/comum/zip-reader.js
git mv tools/orcamento/xlsx-cells.js    tools/comum/xlsx-cells.js
git mv tools/orcamento/criptografia.js  tools/comum/criptografia.js
git mv tools/orcamento/datas.js         tools/comum/datas.js
```

- [ ] **Step 2: Rodar a suíte e confirmar que quebra**

Run: `node --test test/*.test.js`
Expected: FAIL — vários `Cannot find module './xlsx-reader.js'`.

- [ ] **Step 3: Corrigir os requires**

Dentro de `tools/comum/*.js`, requires entre eles continuam `./`. Em `tools/orcamento/*.js`, trocar `./xlsx-reader.js` por `../comum/xlsx-reader.js` (e análogos). Em `test/*.test.js`, trocar `../tools/orcamento/` por `../tools/comum/` para esses cinco.

Conferir que sobrou nada:

```bash
grep -rn "orcamento/xlsx-reader\|orcamento/zip-reader\|orcamento/xlsx-cells\|orcamento/criptografia\|orcamento/datas" tools/ test/
```

Expected: nenhuma saída.

- [ ] **Step 4: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS, incluindo `orcamento-html-inalterado`.

- [ ] **Step 5: Confirmar que o HTML não mudou**

Run: `ORCAMENTO_SENHA='<senha real>' node tools/orcamento/build-dashboard.js && node --test test/orcamento-html-inalterado.test.js`
Expected: PASS. Mover arquivo não pode alterar um byte do HTML.

Se não houver acesso ao `G:\` ou à senha, pular a reconstrução: o teste roda contra o `dist/` versionado e ainda assim prova que nada no caminho de render mudou.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Mover utilitários puros de xlsx, zip, cripto e datas para tools/comum/"
```

---

### Task 3: Fase B — extrair a casca visual preservando o texto

A extração é **textual**: as strings emitidas têm que ser exatamente as mesmas, sem reformatar, reindentar ou reordenar. Se o diff da Task 1 acusar diferença, a extração foi longe demais — reduza o escopo até voltar a passar.

**Files:**
- Create: `tools/comum/render-shell.js`
- Modify: `tools/orcamento/render-dashboard.js` (substituir os blocos extraídos por chamadas)
- Create: `test/comum-render-shell.test.js`

**Interfaces:**
- Consumes: `normalizarVolatil` (Task 1).
- Produces:
  - `cssBase()` → `string` — tokens de cor, tipografia, reset e estilos de `.filtros`, `.abas-visualizacao`, `.filtro-multi-item`.
  - `markupCabecalho({ titulo, subtitulo })` → `string`
  - `markupFiltros()` → `string` — a barra de filtros multi-select.
  - `markupAbas(abas)` → `string`, onde `abas` é `[{ id, rotulo, svg, ativa }]`
  - `scriptDesbloqueio()` → `string` — o JS de cliente de decifragem por senha.

- [ ] **Step 1: Escrever o teste que fixa o contrato**

`test/comum-render-shell.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { cssBase, markupCabecalho, markupAbas, scriptDesbloqueio } = require('../tools/comum/render-shell.js');

test('cssBase traz os tokens e os componentes compartilhados', () => {
  const css = cssBase();
  assert.match(css, /--text-primary/);
  assert.match(css, /\.abas-visualizacao button/);
  assert.match(css, /\.filtro-multi-item/);
});

test('markupAbas marca só a aba ativa', () => {
  const html = markupAbas([
    { id: 'aba-a', rotulo: 'A', svg: '<svg></svg>', ativa: true },
    { id: 'aba-b', rotulo: 'B', svg: '<svg></svg>', ativa: false },
  ]);
  assert.match(html, /id="aba-a"[^>]*class="aba-ativa"/);
  assert.doesNotMatch(html, /id="aba-b"[^>]*aba-ativa/);
});

test('scriptDesbloqueio não vaza senha nem dado identificador', () => {
  const js = scriptDesbloqueio();
  assert.match(js, /decifrarComSenha/);
  assert.doesNotMatch(js, /SUP-/);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/comum-render-shell.test.js`
Expected: FAIL — `Cannot find module '../tools/comum/render-shell.js'`.

- [ ] **Step 3: Criar o módulo movendo o texto existente**

Recortar de `tools/orcamento/render-dashboard.js` os blocos abaixo — **faixas de linha conferidas em 2026-07-28, no commit 7c6db0a** — e colar em `tools/comum/render-shell.js` **sem editar o conteúdo, sem reindentar e sem reordenar**:

| Bloco | Origem em `render-dashboard.js` | Destino |
|---|---|---|
| CSS completo, entre `<style>` e `</style>` | linhas 2174–2429 | `cssBase()` |
| Markup `<div class="filtros">` e seu conteúdo | a partir da linha 2452 | `markupFiltros()` |
| Markup `<div class="abas-visualizacao">` | a partir da linha 2463 | `markupAbas()` |
| `SCRIPT_CLIENTE_GATE` (`base64ParaBytes`, `decifrarComSenha`, `mostrarErroSenha`, `tentarDesbloquear`) | linhas 20–91 | `scriptDesbloqueio()` |

Se as linhas tiverem se deslocado, localizar pelos mesmos marcadores (`<style>`, `class="filtros"`, `abas-visualizacao`, `const SCRIPT_CLIENTE_GATE`) em vez de confiar nos números.

```js
'use strict';

function cssBase() {
  return `<CSS das linhas 2174–2429, verbatim, sem as tags <style>>`;
}

function markupCabecalho({ titulo, subtitulo }) {
  return `<markup do cabeçalho, verbatim, com só o texto do título e do subtítulo trocado pelos parâmetros>`;
}

function markupAbas(abas) {
  const botoes = abas.map(function (a) {
    return '<button id="' + a.id + '" type="button"'
      + (a.ativa ? ' class="aba-ativa"' : '') + '>' + a.svg + a.rotulo + '</button>';
  }).join('');
  return '<div class="abas-visualizacao">' + botoes + '</div>';
}

function scriptDesbloqueio() {
  return `<conteúdo de SCRIPT_CLIENTE_GATE, linhas 20–91, verbatim>`;
}

module.exports = { cssBase, markupCabecalho, markupFiltros, markupAbas, scriptDesbloqueio };
```

Em `render-dashboard.js`, substituir cada bloco recortado pela chamada correspondente, montando `markupAbas` com exatamente os mesmos três botões (Tabela, Gráfico, Alertas) e os mesmos SVGs, na mesma ordem.

- [ ] **Step 4: Rodar o teste do módulo**

Run: `node --test test/comum-render-shell.test.js`
Expected: PASS.

- [ ] **Step 5: Provar que o HTML do orçamento não mudou**

Run: `node --test test/orcamento-html-inalterado.test.js`
Expected: PASS.

Se falhar, o diff mostra exatamente onde o texto divergiu — normalmente espaço em branco entre atributos ou ordem de classes. Ajustar `markupAbas` até coincidir; **não** regenerar o golden.

- [ ] **Step 6: Commit**

```bash
git add tools/comum/render-shell.js tools/orcamento/render-dashboard.js test/comum-render-shell.test.js
git commit -m "Extrair casca visual compartilhada preservando o HTML do orçamento byte a byte"
```

---

### Task 4: Fase B — compartilhar o cálculo de equipes

`mediaEquipesPonderada`, `somarIntervaloEquipeDias` e `DIAS_PREMISSA_MES` hoje existem só como texto dentro do JS de cliente do orçamento. A página nova precisa da mesma semântica; reimplementar seria a forma mais fácil de as duas páginas discordarem sobre quantas equipes havia num período.

**Files:**
- Create: `tools/comum/calculo-equipes.js`
- Create: `test/comum-calculo-equipes.test.js`
- Modify: `tools/orcamento/render-dashboard.js`

**Interfaces:**
- Produces:
  - `DIAS_PREMISSA_MES` → `number[]` de 12 posições
  - `mediaEquipesPonderada(mensal, inicio, fim)` → `number | null`
  - `somarIntervaloEquipeDias(mensal, inicio, fim)` → `number | null`
  - `fonteParaCliente()` → `string` com o código-fonte das três, para inlinar no bundle do navegador.
- Consumido pelas Tasks 6, 9 e 10.

- [ ] **Step 1: Escrever os testes**

`test/comum-calculo-equipes.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { mediaEquipesPonderada, somarIntervaloEquipeDias, DIAS_PREMISSA_MES } = require('../tools/comum/calculo-equipes.js');

test('um único mês devolve o próprio valor do mês', () => {
  const mensal = [0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  assert.strictEqual(mediaEquipesPonderada(mensal, 1, 2), 2);
});

test('vários meses fazem média ponderada por dias, não soma', () => {
  const mensal = new Array(12).fill(0);
  mensal[0] = 2; mensal[1] = 4;
  const esperado = (2 * DIAS_PREMISSA_MES[0] + 4 * DIAS_PREMISSA_MES[1])
                 / (DIAS_PREMISSA_MES[0] + DIAS_PREMISSA_MES[1]);
  assert.strictEqual(mediaEquipesPonderada(mensal, 0, 2), esperado);
  assert.ok(mediaEquipesPonderada(mensal, 0, 2) < 6, 'não pode ser a soma');
});

test('meses sem dado não entram no denominador', () => {
  const mensal = new Array(12).fill(null);
  mensal[3] = 5;
  assert.strictEqual(mediaEquipesPonderada(mensal, 0, 12), 5);
});

test('intervalo totalmente vazio devolve null', () => {
  assert.strictEqual(mediaEquipesPonderada(new Array(12).fill(null), 0, 12), null);
});

test('equipe-dias soma, ao contrário da média', () => {
  const mensal = new Array(12).fill(0);
  mensal[0] = 1;
  assert.strictEqual(somarIntervaloEquipeDias(mensal, 0, 1), DIAS_PREMISSA_MES[0]);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/comum-calculo-equipes.test.js`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Criar o módulo com o corpo verbatim**

Copiar de `render-dashboard.js`, **sem alterar uma linha** (inclusive os `var`, que existem porque o código roda no navegador) — posições conferidas em 2026-07-28, no commit 7c6db0a:

| Trecho | Linha em `render-dashboard.js` |
|---|---|
| `var DIAS_PREMISSA_MES = [15, 30, ...]` | 142 |
| `function mediaEquipesPonderada(mensal, inicio, fim)` | 302, com o comentário das 6 linhas acima |
| `function somarIntervaloEquipeDias(mensal, inicio, fim)` | 316, com o comentário acima |

Os comentários vão junto: eles são a razão de a função existir e o que impede alguém de "simplificar" a média ponderada para uma soma. Acrescentar:

```js
const fs = require('node:fs');
function fonteParaCliente() {
  const src = fs.readFileSync(__filename, 'utf8');
  // Recorta do marcador de início até o de fim, para inlinar no navegador
  // exatamente o mesmo código que o Node testou.
  return src.split('// <<< INICIO CLIENTE')[1].split('// FIM CLIENTE >>>')[0];
}
module.exports = { DIAS_PREMISSA_MES, mediaEquipesPonderada, somarIntervaloEquipeDias, fonteParaCliente };
```

Envolver as três definições com os marcadores `// <<< INICIO CLIENTE` e `// FIM CLIENTE >>>`.

- [ ] **Step 4: Rodar os testes do módulo**

Run: `node --test test/comum-calculo-equipes.test.js`
Expected: PASS.

- [ ] **Step 5: Fazer o orçamento consumir a fonte compartilhada**

Em `render-dashboard.js`, remover as três definições do template literal e injetar `fonteParaCliente()` na mesma posição do arquivo em que elas estavam.

Run: `node --test test/orcamento-html-inalterado.test.js`
Expected: PASS. Se falhar por espaço em branco, ajustar os marcadores até o texto emitido coincidir.

- [ ] **Step 6: Commit**

```bash
git add tools/comum/calculo-equipes.js test/comum-calculo-equipes.test.js tools/orcamento/render-dashboard.js
git commit -m "Compartilhar o cálculo de equipes entre as duas páginas sem alterar o HTML gerado"
```

---

### Task 5: Bundle de navegador para a página nova

Trazer para este repositório o padrão já usado em `tools/matriz/browser-bundle.js` e `tools/medicoes/browser-bundle.js`: módulos Node reais, testáveis, concatenados num único escopo para o navegador.

**Files:**
- Create: `tools/comum/browser-bundle.js`
- Create: `test/comum-browser-bundle.test.js`

**Interfaces:**
- Produces: `buildBrowserBundle(dir, arquivosEmOrdem)` → `string` — JS pronto para inlinar, com `require('./x.js')` reescrito para leitura de um registro `MODULOS` e `module.exports = {...}` reescrito para `return`.
- Consumido pelas Tasks 7, 8 e 10.

- [ ] **Step 1: Escrever o teste**

`test/comum-browser-bundle.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildBrowserBundle } = require('../tools/comum/browser-bundle.js');

test('concatena na ordem e resolve require entre módulos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'));
  fs.writeFileSync(path.join(dir, 'a.js'), "'use strict';\nfunction dobro(n){return n*2;}\nmodule.exports = { dobro };\n");
  fs.writeFileSync(path.join(dir, 'b.js'), "'use strict';\nconst { dobro } = require('./a.js');\nfunction quadruplo(n){return dobro(dobro(n));}\nmodule.exports = { quadruplo };\n");

  const bundle = buildBrowserBundle(dir, ['a.js', 'b.js']);
  assert.doesNotMatch(bundle, /require\(/, 'nenhum require pode sobrar');
  assert.doesNotMatch(bundle, /module\.exports/, 'nenhum module.exports pode sobrar');

  const quadruplo = new Function(bundle + '; return MODULOS["b.js"].quadruplo;')();
  assert.strictEqual(quadruplo(3), 12);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/comum-browser-bundle.test.js`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

Portar `tools/matriz/browser-bundle.js` do repositório `matriz-equipes-source`, generalizando a lista fixa de arquivos para o parâmetro `arquivosEmOrdem`. Manter os mesmos comentários explicativos sobre ordem de dependência.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/comum-browser-bundle.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/comum/browser-bundle.js test/comum-browser-bundle.test.js
git commit -m "Portar o padrão de browser-bundle para o repositório do orçamento"
```

---

### Task 6: Cálculo da divisão semanal

O núcleo de correção da aba 1. Volume e financeiro dividem por 4; equipes **não**.

**Files:**
- Create: `tools/semanal/compute-semanal.js`
- Create: `test/semanal-compute-semanal.test.js`

**Interfaces:**
- Consumes: `mediaEquipesPonderada` de `tools/comum/calculo-equipes.js` (Task 4).
- Produces:
  - `dividirEmSemanas(valorMensal, dimensao)` → `number[]` de 4 posições
  - `fecharMes(semanas, dimensao)` → `number` — soma para volume/financeiro, média para equipes
  - `SEMANAS = 4`
- Consumido pelas Tasks 8 e 10.

- [ ] **Step 1: Escrever os testes**

`test/semanal-compute-semanal.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { dividirEmSemanas, fecharMes, SEMANAS } = require('../tools/semanal/compute-semanal.js');

test('volume divide o mês em 4 partes iguais', () => {
  assert.deepStrictEqual(dividirEmSemanas(400, 'volume'), [100, 100, 100, 100]);
});

test('financeiro divide igual a volume', () => {
  assert.deepStrictEqual(dividirEmSemanas(1000, 'financeiro'), [250, 250, 250, 250]);
});

test('equipes NÃO divide: 2 equipes no mês são 2 em cada semana', () => {
  assert.deepStrictEqual(dividirEmSemanas(2, 'equipes'), [2, 2, 2, 2]);
});

test('volume fecha somando as semanas', () => {
  assert.strictEqual(fecharMes([100, 100, 100, 100], 'volume'), 400);
});

test('equipes fecha pela média, nunca pela soma', () => {
  assert.strictEqual(fecharMes([2, 2, 2, 2], 'equipes'), 2);
});

test('mês sem dado propaga null em vez de virar zero', () => {
  assert.deepStrictEqual(dividirEmSemanas(null, 'volume'), [null, null, null, null]);
  assert.strictEqual(fecharMes([null, null, null, null], 'volume'), null);
});

test('ida e volta fecha para as três dimensões', () => {
  for (const [valor, dim] of [[400, 'volume'], [1000, 'financeiro'], [3, 'equipes']]) {
    assert.strictEqual(fecharMes(dividirEmSemanas(valor, dim), dim), valor,
      'dimensão ' + dim + ' não fechou');
  }
});

test('são sempre 4 semanas', () => {
  assert.strictEqual(SEMANAS, 4);
  assert.strictEqual(dividirEmSemanas(1, 'volume').length, 4);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-compute-semanal.test.js`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

`tools/semanal/compute-semanal.js`:

```js
'use strict';

// <<< INICIO CLIENTE
var SEMANAS = 4;

// Volume e financeiro são FLUXOS: o mês se reparte em 4 fatias nominais e a
// soma delas reconstrói o mês. Equipes é uma FOTO: 2 equipes mobilizadas no
// mês são 2 equipes em cada semana, não 0,5 -- dividir produziria número
// errado em silêncio e discordaria do orçamento, que mostra a média. Mesma
// premissa de mediaEquipesPonderada em tools/comum/calculo-equipes.js.
function dividirEmSemanas(valorMensal, dimensao) {
  var saida = [];
  for (var i = 0; i < SEMANAS; i++) {
    if (valorMensal === null || valorMensal === undefined) { saida.push(null); continue; }
    saida.push(dimensao === 'equipes' ? valorMensal : valorMensal / SEMANAS);
  }
  return saida;
}

function fecharMes(semanas, dimensao) {
  var validos = (semanas || []).filter(function (v) { return v !== null && v !== undefined; });
  if (!validos.length) return null;
  var soma = validos.reduce(function (a, b) { return a + b; }, 0);
  return dimensao === 'equipes' ? soma / validos.length : soma;
}
// FIM CLIENTE >>>

module.exports = { SEMANAS, dividirEmSemanas, fecharMes };
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/semanal-compute-semanal.test.js`
Expected: PASS, 8 testes.

O teste de ida e volta (`fecharMes(dividirEmSemanas(v, dim)) === v`) é a forma testável do invariante do spec — "a soma S1..S4 tem que bater com o mês vigente". Uma comparação direta contra o número que o orçamento exibe não é viável em teste unitário, porque aquele cálculo roda no navegador, dentro do blob cifrado; o fechamento por dimensão prova a mesma propriedade sobre a mesma entrada.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/compute-semanal.js test/semanal-compute-semanal.test.js
git commit -m "Divisão semanal do mês, com equipes tratada como foto e não como fluxo"
```

---

### Task 7: Build da página nova, com a casca e sem abas

Entrega uma página publicável: cabeçalho, filtros, desbloqueio por senha e duas abas vazias. Prova o caminho fim a fim antes de qualquer conteúdo.

**Files:**
- Create: `tools/semanal/build-dashboard.js`
- Create: `tools/semanal/render-semanal.js`
- Create: `test/semanal-build-dashboard.test.js`

**Interfaces:**
- Consumes: `cssBase`, `markupCabecalho`, `markupAbas`, `scriptDesbloqueio` (Task 3); `buildBrowserBundle` (Task 5); `criptografar` de `tools/comum/criptografia.js`; `parseMatriz`, `parseBaseline`, `readXlsxSheet`.
- Produces: `renderSemanal({ registros, baseline, senha, geradoEm })` → `string`; `dist/planejamento-semanal.html`.

- [ ] **Step 1: Escrever o teste**

`test/semanal-build-dashboard.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderSemanal } = require('../tools/semanal/render-semanal.js');

const REGISTROS = [{
  origem: 'CONTRATO VIGENTE', grupo: 'G1', tomador: 'T1', sup: 'SUP-0001-24',
  escopo: 'E', apoio: 'A', inicio: 45439, termino: 47265, tipologia: 'ST', observacao: null,
  previsto:  { equipes: new Array(12).fill(1), volume: new Array(12).fill(400), financeiro: new Array(12).fill(1000),
               equipesResumo: { pico: 1, media: 1, prod: 8, dias: 25 },
               volumeResumo: { total: 4800, totalInicial: 4800, ticket: 2.5 },
               financeiroResumo: { total: 12000, totalInicial: 12000 } },
  realizado: { equipes: new Array(12).fill(0), volume: new Array(12).fill(0), financeiro: new Array(12).fill(0),
               equipesResumo: { pico: 0, media: 0, prod: 8, dias: 25 },
               volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
               financeiroResumo: { total: 0, totalInicial: 0 } },
  total:     { equipes: new Array(12).fill(0), volume: new Array(12).fill(0), financeiro: new Array(12).fill(0),
               equipesResumo: { pico: 0, media: 0, prod: 8, dias: 25 },
               volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
               financeiroResumo: { total: 0, totalInicial: 0 } },
}];

test('gera HTML com as duas abas e a casca compartilhada', () => {
  const html = renderSemanal({ registros: REGISTROS, baseline: [], senha: 'fake', geradoEm: new Date(0) });
  assert.match(html, /id="aba-semanal"/);
  assert.match(html, /id="aba-balanco"/);
  assert.match(html, /abas-visualizacao/);
  assert.match(html, /--text-primary/);
});

test('nenhum identificador aparece em texto puro', () => {
  const html = renderSemanal({ registros: REGISTROS, baseline: [], senha: 'fake', geradoEm: new Date(0) });
  assert.doesNotMatch(html, /SUP-0001-24/, 'SUP vazou fora do blob cifrado');
  assert.doesNotMatch(html, /Via Araucária|T1/, 'tomador vazou fora do blob cifrado');
});

test('a senha nunca aparece no HTML', () => {
  const html = renderSemanal({ registros: REGISTROS, baseline: [], senha: 'senha-secreta-123', geradoEm: new Date(0) });
  assert.doesNotMatch(html, /senha-secreta-123/);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-build-dashboard.test.js`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar render + build**

`render-semanal.js` monta o documento com `cssBase()`, `markupCabecalho({ titulo: 'Planejamento Semanal', subtitulo: <mês vigente> })`, `markupAbas([{ id:'aba-semanal', rotulo:'Semanal', svg:<ícone tabela>, ativa:true }, { id:'aba-balanco', rotulo:'Balanço de massa', svg:<ícone gráfico>, ativa:false }])`, `scriptDesbloqueio()` e o bundle de `tools/semanal/` via `buildBrowserBundle`. Os registros vão **só** dentro do blob cifrado.

`build-dashboard.js` espelha o do orçamento: lê `ORCAMENTO_SENHA`, falha com mensagem clara se ausente, lê as planilhas via `config.js`, chama `renderSemanal` e escreve `dist/planejamento-semanal.html`.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/semanal-build-dashboard.test.js`
Expected: PASS, 3 testes.

- [ ] **Step 5: Confirmar que o orçamento segue intacto**

Run: `node --test test/*.test.js`
Expected: PASS, incluindo `orcamento-html-inalterado`.

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/ test/semanal-build-dashboard.test.js
git commit -m "Gerar a página do Planejamento Semanal com a casca compartilhada e abas vazias"
```

---

### Task 8: Aba 1 — tabela do mês vigente em 4 semanas

**Files:**
- Create: `tools/semanal/render-aba-semanal.js`
- Create: `test/semanal-render-aba-semanal.test.js`
- Modify: `tools/semanal/render-semanal.js` (incluir o módulo no bundle)

**Interfaces:**
- Consumes: `dividirEmSemanas`, `fecharMes`, `SEMANAS` (Task 6).
- Produces:
  - `renderAbaSemanal(registros, indices, dimensao, vigenteIdx)` → `string` (HTML da tabela)
  - `rotuloColunaFechamento(dimensao)` → `'Média'` para `'equipes'`, `'Total'` para as demais

- [ ] **Step 1: Escrever os testes**

`test/semanal-render-aba-semanal.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderAbaSemanal, rotuloColunaFechamento } = require('../tools/semanal/render-aba-semanal.js');

function registro(volumeMes) {
  const zeros = new Array(12).fill(0);
  const vol = new Array(12).fill(0); vol[6] = volumeMes;
  const bloco = (v) => ({ equipes: new Array(12).fill(2), volume: v, financeiro: zeros,
    equipesResumo: { pico: 2, media: 2, prod: 8, dias: 25 },
    volumeResumo: { total: volumeMes, totalInicial: volumeMes, ticket: 1 },
    financeiroResumo: { total: 0, totalInicial: 0 } });
  return { sup: 'SUP-0001-24', grupo: 'G', tomador: 'T', tipologia: 'ST',
           previsto: bloco(vol), realizado: bloco(zeros), total: bloco(zeros) };
}

test('mostra as 4 semanas com P, R e T', () => {
  const html = renderAbaSemanal([registro(400)], [0], 'volume', 6);
  for (const s of ['S1', 'S2', 'S3', 'S4']) assert.match(html, new RegExp(s));
  assert.match(html, /Previsto/); assert.match(html, /Realizado/); assert.match(html, /Tend/);
});

test('previsto de volume aparece como um quarto do mês', () => {
  const html = renderAbaSemanal([registro(400)], [0], 'volume', 6);
  assert.match(html, /100/);
});

test('a coluna de fechamento muda de rótulo conforme a dimensão', () => {
  assert.strictEqual(rotuloColunaFechamento('volume'), 'Total');
  assert.strictEqual(rotuloColunaFechamento('financeiro'), 'Total');
  assert.strictEqual(rotuloColunaFechamento('equipes'), 'Média');
});

test('realizado e tendência ficam vazios enquanto não há planilha semanal', () => {
  const html = renderAbaSemanal([registro(400)], [0], 'volume', 6);
  assert.match(html, /class="[^"]*sem-dado/);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-render-aba-semanal.test.js`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

Renderizar `<table>` com cabeçalho S1..S4 × (Previsto, Realizado, Tendência) mais a coluna de fechamento. Previsto vem de `dividirEmSemanas(valorDoMesVigente, dimensao)`. Realizado e Tendência são `null` e recebem a classe `sem-dado`. `rotuloColunaFechamento(dimensao)` devolve `'Média'` para equipes e `'Total'` para as demais.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/semanal-render-aba-semanal.test.js`
Expected: PASS, 4 testes.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/render-aba-semanal.js test/semanal-render-aba-semanal.test.js tools/semanal/render-semanal.js
git commit -m "Aba semanal com o mês vigente dividido em 4 semanas"
```

---

### Task 9: Cálculo do Balanço de massa

**Files:**
- Create: `tools/semanal/compute-balanco.js`
- Create: `test/semanal-compute-balanco.test.js`

**Interfaces:**
- Consumes: `mediaEquipesPonderada` (Task 4).
- Produces:
  - `calcularLinhas({ registros, indices, tipologia, base, dimensao, periodo, vigenteIdx, baseline })` → `[{ sup, valorBase, valorRealizado, desvio, equipesBase, equipesRealizado, desvioEquipes, ativo, semBase }]`
  - `ordenarPorDesvio(linhas)` → mesmo array ordenado
- Consumido pela Task 10.

- [ ] **Step 1: Escrever os testes**

`test/semanal-compute-balanco.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ordenarPorDesvio, calcularLinhas } = require('../tools/semanal/compute-balanco.js');

test('ordena por desvio com sinal, positivos antes dos negativos', () => {
  const linhas = [
    { sup: 'A', desvio: -50 }, { sup: 'B', desvio: 100 },
    { sup: 'C', desvio: -72 }, { sup: 'D', desvio: 15 }, { sup: 'E', desvio: 70 },
  ];
  assert.deepStrictEqual(ordenarPorDesvio(linhas).map(l => l.sup), ['B', 'E', 'D', 'A', 'C']);
});

test('desvio é realizado menos base', () => {
  const linhas = calcularLinhas(cenario({ previstoVol: 105, realizadoVol: 205 }));
  assert.strictEqual(linhas[0].desvio, 100);
});

test('SUP sem movimento no período fica marcado como inativo', () => {
  const linhas = calcularLinhas(cenario({ previstoVol: 0, realizadoVol: 0 }));
  assert.strictEqual(linhas[0].ativo, false);
});

test('SUP com previsto e sem realizado continua ativo', () => {
  const linhas = calcularLinhas(cenario({ previstoVol: 300, realizadoVol: 0 }));
  assert.strictEqual(linhas[0].ativo, true);
});

test('base Previsto Inicial ausente marca semBase, nunca desvio zero', () => {
  const linhas = calcularLinhas(cenario({ previstoVol: 100, realizadoVol: 100, base: 'previstoInicial', baseline: [] }));
  assert.strictEqual(linhas[0].semBase, true);
  assert.strictEqual(linhas[0].desvio, null);
});

// helper que monta o cenário mínimo de 1 SUP × 1 tipologia no mês 6
function cenario({ previstoVol, realizadoVol, base = 'previsto', baseline = null }) {
  const mk = (vol, eq) => { const v = new Array(12).fill(0), e = new Array(12).fill(0);
    v[6] = vol; e[6] = eq; return { volume: v, equipes: e, financeiro: new Array(12).fill(0) }; };
  return {
    registros: [{ sup: 'SUP-0001-24', tipologia: 'ST', previsto: mk(previstoVol, 2), realizado: mk(realizadoVol, 3), total: mk(0, 0) }],
    indices: [0], tipologia: 'ST', base, dimensao: 'volume', periodo: 'mesVigente',
    vigenteIdx: 6, baseline: baseline === null ? [{ sup: 'SUP-0001-24', tipologia: 'ST', volume: new Array(12).fill(0) }] : baseline,
  };
}
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-compute-balanco.test.js`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

`calcularLinhas` resolve o período (`mesVigente` = índice `vigenteIdx`; `acumuladoAteMes` = 0..`vigenteIdx`; `s1..s4` devolvem `null` enquanto não houver planilha semanal), soma volume/financeiro no intervalo, usa `mediaEquipesPonderada` para equipes, e marca `ativo` quando previsto ou realizado for maior que zero na dimensão escolhida.

A ordenação é uma regra só, e é onde é fácil errar — não é por módulo, é pelo valor **com sinal**, que já produz "positivos antes dos negativos" de graça:

```js
// Decrescente pelo desvio COM SINAL: +100, +70, +15, -50, -72.
// Isso satisfaz as duas exigências ao mesmo tempo (do maior para o menor,
// positivos antes dos negativos) sem precisar particionar por sinal. Note
// que entre negativos o menos negativo vem primeiro -- ordenar por módulo
// aqui inverteria essa parte e contrariaria o combinado.
function ordenarPorDesvio(linhas) {
  return linhas.slice().sort(function (a, b) {
    if (a.desvio === null && b.desvio === null) return 0;
    if (a.desvio === null) return 1;   // sem base vai pro fim
    if (b.desvio === null) return -1;
    return b.desvio - a.desvio;
  });
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/semanal-compute-balanco.test.js`
Expected: PASS, 5 testes.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/compute-balanco.js test/semanal-compute-balanco.test.js
git commit -m "Cálculo do Balanço de massa: desvio, ordenação com sinal e atividade por tipologia"
```

---

### Task 10: Aba 2 — gráfico de barras divergentes

**Files:**
- Create: `tools/semanal/render-aba-balanco.js`
- Create: `test/semanal-render-aba-balanco.test.js`
- Modify: `tools/semanal/render-semanal.js` (incluir no bundle)

**Interfaces:**
- Consumes: `calcularLinhas`, `ordenarPorDesvio` (Task 9).
- Produces: `renderGraficoTipologia(tipologia, linhas, opcoes)` → `string` (SVG); `escalaIndependente(valores, larguraMax)` → `(valor) => number`.

- [ ] **Step 1: Escrever os testes**

`test/semanal-render-aba-balanco.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderGraficoTipologia, escalaIndependente } = require('../tools/semanal/render-aba-balanco.js');

const LINHAS = [
  { sup: 'SUP-A', valorBase: 105, valorRealizado: 205, desvio: 100, equipesBase: 2, equipesRealizado: 12, desvioEquipes: 10, ativo: true, semBase: false },
  { sup: 'SUP-B', valorBase: 90,  valorRealizado: 40,  desvio: -50, equipesBase: 4, equipesRealizado: 2,  desvioEquipes: -2, ativo: true, semBase: false },
];

test('a tipologia vira o cabeçalho do gráfico', () => {
  assert.match(renderGraficoTipologia('ST', LINHAS, {}), /ST/);
});

test('desvio positivo à direita, negativo à esquerda', () => {
  const svg = renderGraficoTipologia('ST', LINHAS, {});
  assert.match(svg, /class="barra-acima"/);
  assert.match(svg, /class="barra-abaixo"/);
});

test('equipes usam escala própria: 10 equipes não somem ao lado de 100 de volume', () => {
  const escalaVolume = escalaIndependente([100, -50], 300);
  const escalaEquipes = escalaIndependente([10, -2], 300);
  assert.ok(escalaEquipes(10) > escalaVolume(100) * 0.5,
    'a barra de equipes tem que ser visível, não um traço');
});

test('SUP sem base aparece rotulado, não como desvio zero', () => {
  const svg = renderGraficoTipologia('ST', [{ sup: 'SUP-C', desvio: null, semBase: true, ativo: true }], {});
  assert.match(svg, /sem base/i);
  assert.doesNotMatch(svg, /class="barra-acima"/);
});

test('com o filtro de ativos ligado, inativos não são desenhados', () => {
  const linhas = LINHAS.concat([{ sup: 'SUP-Z', desvio: 0, ativo: false, semBase: false, valorBase: 0, valorRealizado: 0, desvioEquipes: 0 }]);
  assert.doesNotMatch(renderGraficoTipologia('ST', linhas, { somenteAtivos: true }), /SUP-Z/);
  assert.match(renderGraficoTipologia('ST', linhas, { somenteAtivos: false }), /SUP-Z/);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-render-aba-balanco.test.js`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

SVG com linha central vertical. Barra externa colorida (`barra-acima` verde à direita, `barra-abaixo` vermelha à esquerda) e barra interna laranja hachurada para equipes. Rótulos: base junto à linha central, realizado na ponta, equipes em laranja. Linha com `semBase` mostra "sem base" e nenhuma barra. Controles da aba: período, base (Previsto / Previsto Inicial), dimensão e o check "somente SUPs ativos no período", ligado por padrão.

O ponto delicado é a escala. Cada série normaliza pelo **próprio** maior valor absoluto — é isso que impede a barra de equipes (unidades) de sumir ao lado da de volume (centenas ou milhares):

```js
// Uma escala POR SÉRIE, não uma régua comum. Equipes andam em unidades e
// volume em centenas ou milhares; numa régua só, 10 equipes ao lado de 100
// de volume viraria um traço de 1 pixel. Cada série usa toda a largura
// disponível, então os comprimentos são comparáveis DENTRO da série e
// nunca entre séries -- por isso os rótulos numéricos são obrigatórios.
function escalaIndependente(valores, larguraMax) {
  var maximo = 0;
  for (var i = 0; i < valores.length; i++) {
    var v = Math.abs(valores[i] || 0);
    if (v > maximo) maximo = v;
  }
  if (!maximo) return function () { return 0; };
  return function (valor) { return Math.abs(valor || 0) / maximo * larguraMax; };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/semanal-render-aba-balanco.test.js`
Expected: PASS, 5 testes.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/render-aba-balanco.js test/semanal-render-aba-balanco.test.js tools/semanal/render-semanal.js
git commit -m "Aba Balanço de massa: barras divergentes por tipologia com escalas independentes"
```

---

### Task 11: Publicar

**Files:**
- Modify: `docs/planejamento-semanal.html` (cópia do build)
- Modify: `README.md` do repositório

- [ ] **Step 1: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS, todos os arquivos, incluindo `orcamento-html-inalterado`.

- [ ] **Step 2: Reconstruir as duas páginas**

```bash
ORCAMENTO_SENHA='<senha real>' node tools/orcamento/build-dashboard.js
ORCAMENTO_SENHA='<senha real>' node tools/semanal/build-dashboard.js
```

- [ ] **Step 3: Copiar as duas para docs/**

```bash
cp dist/orcamento-dashboard.html  docs/index.html
cp dist/planejamento-semanal.html docs/planejamento-semanal.html
```

O Pages serve `/docs`; sem esta cópia o site publica conteúdo velho **reportando deploy bem-sucedido**.

- [ ] **Step 4: Verificar localmente antes de publicar**

Servir `docs/` por HTTP, abrir as duas páginas, desbloquear com a senha e conferir: as 4 semanas somam o mês na aba 1, e a aba 2 desenha as barras na tipologia selecionada.

- [ ] **Step 5: Commit e push**

```bash
git add docs/index.html docs/planejamento-semanal.html README.md
git commit -m "Publicar a página do Planejamento Semanal"
git push origin master
```

- [ ] **Step 6: Confirmar o deploy pelo conteúdo, não pelo status**

```bash
curl -s https://amcaccere261283.github.io/orcamento-dashboard/planejamento-semanal.html | grep -o "Gerado em[^<]*"
curl -s https://amcaccere261283.github.io/orcamento-dashboard/ | grep -o "Gerado em[^<]*"
```

Expected: os dois carimbos batem com os arquivos recém-construídos. A API de builds do Pages reporta "built" mesmo servindo `/docs` velho — só o conteúdo prova o deploy.

---

## Pendente da planilha semanal

Quando o arquivo chegar, entra `tools/semanal/parse-semanal.js` e apenas dois pontos mudam: as colunas Realizado e Tendência da aba 1 deixam de ser `null`, e os períodos `s1..s4` da aba 2 deixam de devolver `null`. Nenhuma outra tarefa deste plano é afetada — foi por isso que ambos nasceram com o lugar reservado.

A alimentação de volta para o orçamento é outro spec, a ser escrito quando a planilha existir.
