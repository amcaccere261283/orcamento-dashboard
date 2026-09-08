# Planejamento Semanal — filtros e layout do orçamento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levar os 7 filtros da aba Tabela do orçamento para a página de Planejamento Semanal, aplicando o recorte às duas abas, e igualar a tabela semanal ao layout da tabela do orçamento (S1..S4 no lugar dos 12 meses).

**Architecture:** A máquina de filtro do orçamento vive dentro de um template literal (`SCRIPT_CLIENTE_TABELA`, em `tools/orcamento/render-dashboard.js`) cujo HTML gerado é travado byte a byte por `test/orcamento-html-inalterado.test.js`. Em vez de duplicá-la, ela é recortada **verbatim** para módulos em `tools/comum/`, entre marcadores `// <<< INICIO CLIENTE` / `// FIM CLIENTE >>>`, e reinjetada no orçamento na posição exata de onde saiu — o mesmo padrão já em produção em `tools/comum/render-shell.js` e `tools/comum/calculo-equipes.js`. As funções compartilhadas referenciam globais livres (`FILTROS_CONFIG`, `filtrosSelecionados`, `renderCorpoTabela`, `recalcularTabela`, `recalcularAlertas`); isso vira o contrato explícito entre a casca e cada página.

**Tech Stack:** Node.js puro, sem dependências. Testes com `node --test`. JS de cliente em ES5 (`var`, `function`), sem bundler — o HTML é estático e auto-contido.

**Spec:** `docs/superpowers/specs/2026-07-29-semanal-filtros-layout-orcamento-design.md`

## Global Constraints

- **Diretório de trabalho:** `orcamento-dashboard/` (repositório próprio, clonado dentro de `Projetos IA/`). Todos os caminhos deste plano são relativos a ele.
- **`test/orcamento-html-inalterado.test.js` DEVE continuar passando** em todas as tarefas 1–3 e 5–11. A Task 4 é a única que regenera o golden, e o faz com o diff revisado linha a linha. Esse teste é o critério de aceite mais importante do plano: ele é a prova de que as extrações foram verbatim.
- **Nunca escreva a senha em arquivo do repositório.** Os builds usam `ORCAMENTO_SENHA` como variável de ambiente. Para rodar os testes não é preciso senha real (os testes usam uma falsa).
- **Ao recortar texto para `tools/comum/`, não reformate nada:** não troque `var` por `const`, não reescreva comentário, não reindente. O texto recortado é conteúdo do HTML publicado.
- **Escapes dobrados viram simples.** Dentro do template literal os escapes de regex aparecem como `\\(`, `\\s`, `\\uNNNN`. Num arquivo `.js` de verdade, onde o texto é lido cru por `fs.readFileSync`, eles viram `\(`, `\s`, `\uNNNN`. Errar isso quebra o golden e é a falha mais provável destas extrações.
- **Crases e `${`** dentro do texto recortado precisam de escape no template literal de origem, mas **não** no arquivo `.js` de destino. Ao mover, remova o `\` que protegia a crase (ex.: ``\`registros\``` vira ``` `registros` ```).
- **Comando de teste:** `node --test test/*.test.js` (na raiz de `orcamento-dashboard/`).
- **Build:** `ORCAMENTO_SENHA='qualquer' node tools/semanal/build-dashboard.js` e `ORCAMENTO_SENHA='qualquer' node tools/orcamento/build-dashboard.js`. **Os dois builds precisam das planilhas em `G:\Meu Drive\PMO\...`** (ver `tools/orcamento/config.js`) — exigem o Google Drive montado.
- **A suíte de testes NÃO precisa do `G:`.** O golden do orçamento é construído por `test/helpers/golden-orcamento.js`, que lê `test/fixtures/registros-golden.json` com data e senha fixas. Só as Tasks 10 e 11 dependem do Drive; as Tasks 1–9 rodam em qualquer máquina.
- **Onde o golden mora:** `test/fixtures/orcamento-golden.html`, guardado **cru**. A comparação aplica `normalizarVolatil()` nos dois lados, que descarta o blob `__DADOS_CIFRADOS__` (salt/iv são sorteados a cada build), o carimbo `Gerado em` e o fim de linha. Qualquer outra diferença é regressão.

## Como localizar os blocos a extrair

Os números de linha abaixo valem para o HEAD no início do plano e **mudam a cada extração**. Localize sempre pelo **texto-âncora** (a primeira e a última linha citadas), não pelo número.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `tools/comum/trechos-cliente.js` | **Criar.** Helper que recorta blocos `<<< INICIO CLIENTE` de um arquivo. Usado pelos 4 módulos de texto compartilhado. |
| `tools/comum/agregacao-cliente.js` | **Criar.** Matemática de agregação de registros numa dimensão: `formatarNumero`, `somar`, `somarArraysMensais`, `CAMPOS_RATIO`, `calcularMensal`. |
| `tools/comum/filtros-cliente.js` | **Criar.** A máquina de filtro multi-select inteira, mais os helpers que ela consome. |
| `tools/comum/refresh-cliente.js` | **Criar.** O refresh ao vivo do espelho da MATRIZ. |
| `tools/comum/calculo-equipes.js` | **Modificar.** Passa a delegar o recorte para `trechos-cliente.js`. |
| `tools/orcamento/render-dashboard.js` | **Modificar.** Perde o texto extraído, ganha as interpolações que o reinjetam. |
| `tools/semanal/compute-semanal.js` | **Modificar.** Generalizado para as 5 dimensões. |
| `tools/semanal/render-aba-semanal.js` | **Reescrever.** Passa a emitir a tabela no layout do orçamento. |
| `tools/semanal/render-aba-balanco.js` | **Modificar.** Perde o select "Dimensão", ganha a nota de fallback. |
| `tools/semanal/render-semanal.js` | **Modificar.** Barra de filtros, faixa de ações, logo, marca d'água, "Gerado em", e todo o JS de cliente novo. |
| `tools/semanal/build-dashboard.js` | **Modificar.** Carrega logo e ícone como data-URI. |

---

### Task 1: Helper de recorte + `agregacao-cliente.js`

Extrai a matemática de agregação. É a menor das três extrações — serve para validar o mecanismo antes das maiores.

**Files:**
- Create: `tools/comum/trechos-cliente.js`
- Create: `tools/comum/agregacao-cliente.js`
- Modify: `tools/comum/calculo-equipes.js`
- Modify: `tools/orcamento/render-dashboard.js`
- Test: `test/comum-trechos-cliente.test.js`, `test/comum-agregacao-cliente.test.js`

**Interfaces:**
- Consumes: nada (primeira tarefa).
- Produces:
  - `tools/comum/trechos-cliente.js` → `recortarTrechos(caminhoArquivo) -> string[]`
  - `tools/comum/agregacao-cliente.js` → `{ formatarNumero, somar, somarArraysMensais, CAMPOS_RATIO, calcularMensal, trechosParaCliente, fonteParaCliente }`
    - `calcularMensal(valoresLista, serie, dimensao) -> (number|null)[12] | null`
    - `trechosParaCliente() -> string[]` (2 trechos, na ordem em que aparecem no arquivo)
    - `fonteParaCliente() -> string` (os trechos concatenados)

- [ ] **Step 1: Escrever o teste do helper de recorte (falhando)**

Criar `test/comum-trechos-cliente.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { recortarTrechos } = require('../tools/comum/trechos-cliente.js');

function arquivoTemporario(conteudo) {
  const destino = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'trechos-')), 'exemplo.js');
  fs.writeFileSync(destino, conteudo, 'utf8');
  return destino;
}

test('recorta cada bloco marcado, sem os marcadores', () => {
  const arquivo = arquivoTemporario(
    "antes\n// <<< INICIO CLIENTE\nvar a = 1;\n// FIM CLIENTE >>>\nmeio\n// <<< INICIO CLIENTE\nvar b = 2;\n// FIM CLIENTE >>>\ndepois\n"
  );
  assert.deepStrictEqual(recortarTrechos(arquivo), ['\nvar a = 1;\n', '\nvar b = 2;\n']);
});

test('devolve lista vazia quando não há bloco marcado', () => {
  assert.deepStrictEqual(recortarTrechos(arquivoTemporario('var a = 1;\n')), []);
});

// Sem esta normalização o HTML publicado passaria a depender de o repositório
// ter sido clonado em Windows (CRLF) ou Linux (LF) -- o template literal do
// orçamento normaliza a quebra de linha para \n, e o texto injetado precisa
// acompanhar.
test('normaliza CRLF para LF', () => {
  const arquivo = arquivoTemporario('// <<< INICIO CLIENTE\r\nvar a = 1;\r\n// FIM CLIENTE >>>\r\n');
  assert.deepStrictEqual(recortarTrechos(arquivo), ['\nvar a = 1;\n']);
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node --test test/comum-trechos-cliente.test.js`
Expected: FAIL — `Cannot find module '../tools/comum/trechos-cliente.js'`

- [ ] **Step 3: Criar `tools/comum/trechos-cliente.js`**

```js
'use strict';
const fs = require('node:fs');

// Recorta os blocos marcados de um arquivo, para inlinar no navegador
// exatamente o mesmo código que o Node testou. A regex escapa as barras,
// então o próprio padrão não casa consigo mesmo e não vira um bloco fantasma.
//
// O \r\n vira \n na leitura porque é isso que o resto do HTML já faz: o JS
// de cliente do orçamento mora em template literal, e a linguagem normaliza
// a quebra de linha do literal pra \n mesmo quando o .js está em CRLF no
// disco. fs.readFileSync não normaliza nada, então sem esse replace o
// trecho injetado sairia em CRLF num checkout Windows (core.autocrlf=true) e
// em LF num checkout Linux -- o HTML publicado passaria a depender de como o
// repositório foi clonado.
//
// Extraído de calculo-equipes.js, que era o único a fazer isso, quando um
// segundo, terceiro e quarto módulo passaram a precisar do mesmo recorte.
function recortarTrechos(caminhoArquivo) {
  const src = fs.readFileSync(caminhoArquivo, 'utf8').replace(/\r\n/g, '\n');
  const padrao = /\/\/ <<< INICIO CLIENTE([\s\S]*?)\/\/ FIM CLIENTE >>>/g;
  const trechos = [];
  let achado;
  while ((achado = padrao.exec(src)) !== null) trechos.push(achado[1]);
  return trechos;
}

module.exports = { recortarTrechos };
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `node --test test/comum-trechos-cliente.test.js`
Expected: PASS (3 testes)

- [ ] **Step 5: Fazer `calculo-equipes.js` delegar ao helper**

Em `tools/comum/calculo-equipes.js`, trocar o corpo de `trechosParaCliente()` e remover o `require('node:fs')` do topo:

```js
// (topo do arquivo) trocar:
//   const fs = require('node:fs');
// por:
const { recortarTrechos } = require('./trechos-cliente.js');
```

```js
// substituir a função inteira (mantendo o comentário grande acima dela,
// que agora aponta para o helper):
function trechosParaCliente() {
  return recortarTrechos(__filename);
}
```

O comentário de 10 linhas acima de `trechosParaCliente` explica a regex e o `\r\n`; mova-o para `trechos-cliente.js` (já está no Step 3) e deixe no lugar apenas:

```js
// O recorte em si mora em ./trechos-cliente.js -- quatro módulos precisam
// dele hoje.
```

**Atenção:** `calculo-equipes.js` também é consumido pelo bundle de navegador via `require('../comum/calculo-equipes.js')` em `tools/semanal/compute-balanco.js`, mas esse require é *removido* pelo bundle (ver `transformaModulo` em `tools/comum/browser-bundle.js`), então o novo `require('./trechos-cliente.js')` nunca chega ao navegador. Nenhum risco.

- [ ] **Step 6: Rodar a suíte inteira e confirmar que o golden do orçamento continua passando**

Run: `node --test test/*.test.js`
Expected: PASS — em especial `orcamento-html-inalterado.test.js` e `comum-calculo-equipes.test.js`. Se o golden falhar aqui, o `\r\n` ou o recorte mudaram: compare `recortarTrechos` com a função original antes de seguir.

- [ ] **Step 7: Commitar o helper**

```bash
git add tools/comum/trechos-cliente.js tools/comum/calculo-equipes.js test/comum-trechos-cliente.test.js
git commit -m "Extrair o recorte de trechos de cliente para um helper próprio"
```

- [ ] **Step 8: Criar `tools/comum/agregacao-cliente.js` com os dois blocos recortados**

Recorte de `tools/orcamento/render-dashboard.js`, de dentro do template literal `SCRIPT_CLIENTE_TABELA`:

- **Bloco 1** (hoje linhas 49–84): da linha `// casasDecimais default 2 (mantém o comportamento de sempre pra quem já` até o `};` que fecha `var CAMPOS_RATIO = {`. Inclui `formatarNumero`, `somar`, o comentário de `somarArraysMensais`, `somarArraysMensais` e `CAMPOS_RATIO`.
- **Bloco 2** (hoje linhas 142–172): da linha `// valoresLista: array de "valores" de UMA série (previsto/realizado/total),` até o `}` que fecha `function calcularMensal(...)`.

O arquivo novo:

```js
'use strict';
const { recortarTrechos } = require('./trechos-cliente.js');

// Fonte única da agregação de registros numa dimensão, compartilhada entre o
// dashboard de orçamento e a página de planejamento semanal. Reimplementar
// seria a forma mais fácil de as duas discordarem sobre quanto vale um mês.
//
// Os blocos marcados abaixo são copiados VERBATIM do JS de cliente do
// orçamento (tools/orcamento/render-dashboard.js), que agora os injeta de
// volta via trechosParaCliente(). Os `var` e os comentários fazem parte do
// texto emitido no HTML publicado, que precisa continuar byte-a-byte
// idêntico (test/orcamento-html-inalterado.test.js) -- não modernize pra
// `const`, não reformate, não reescreva comentário.
//
// calcularMensal depende de DIAS_PREMISSA_MES, que mora em
// ./calculo-equipes.js e é injetada ANTES deste texto na página. Aqui no
// Node, o require abaixo resolve isso.
const { DIAS_PREMISSA_MES } = require('./calculo-equipes.js');

// <<< INICIO CLIENTE
// ... BLOCO 1 VERBATIM ...
// FIM CLIENTE >>>

// <<< INICIO CLIENTE
// ... BLOCO 2 VERBATIM ...
// FIM CLIENTE >>>

function trechosParaCliente() {
  return recortarTrechos(__filename);
}

// Os trechos já começam e terminam em quebra de linha, então concatenar
// direto reproduz o espaçamento natural entre eles.
function fonteParaCliente() {
  return trechosParaCliente().join('');
}

module.exports = {
  formatarNumero, somar, somarArraysMensais, CAMPOS_RATIO, calcularMensal,
  trechosParaCliente, fonteParaCliente,
};
```

**Atenção ao Bloco 2:** dentro do template literal ele não tem escapes dobrados, mas confira caractere a caractere antes de salvar.

- [ ] **Step 9: Reinjetar os dois trechos no orçamento**

Em `tools/orcamento/render-dashboard.js`:

```js
// junto dos outros requires do topo:
const { trechosParaCliente: trechosAgregacao } = require('./../comum/agregacao-cliente.js');
```

Use a forma que o arquivo já usa para `calculo-equipes.js` (`require('../comum/...')`), não `./../`:

```js
const { trechosParaCliente: trechosAgregacao } = require('../comum/agregacao-cliente.js');
const [TRECHO_FORMATACAO, TRECHO_CALCULAR_MENSAL] = trechosAgregacao();
```

Depois, dentro de `SCRIPT_CLIENTE_TABELA`, substituir cada bloco removido por uma linha com **apenas** a interpolação — exatamente como `${TRECHO_DIAS_PREMISSA}` já aparece na linha 85:

```
${TRECHO_FORMATACAO}
```
```
${TRECHO_CALCULAR_MENSAL}
```

Cada trecho já traz quebra de linha nas duas pontas, então a interpolação ocupa uma linha sozinha e reproduz o espaçamento anterior.

- [ ] **Step 10: Rodar o golden e confirmar byte a byte**

Run: `node --test test/orcamento-html-inalterado.test.js`
Expected: PASS. **Se falhar, o diff é a lista exata do que você mudou sem querer** — normalmente uma linha em branco a mais ou a menos nas pontas de um bloco. Ajuste as pontas do bloco marcado, não o `${...}`.

- [ ] **Step 11: Escrever os testes de unidade do módulo novo**

Criar `test/comum-agregacao-cliente.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { calcularMensal, somarArraysMensais, formatarNumero } = require('../tools/comum/agregacao-cliente.js');

function serieCom(campo, valores) {
  const base = {
    equipes: Array(12).fill(null), volume: Array(12).fill(null), financeiro: Array(12).fill(null),
    equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 },
    volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
    financeiroResumo: { total: 0, totalInicial: 0 },
  };
  base[campo] = valores;
  return base;
}

test('somarArraysMensais mantém null onde nenhum contribuinte tem dado', () => {
  const a = Array(12).fill(null); a[0] = 10;
  const b = Array(12).fill(null); b[0] = 5; b[1] = 7;
  const soma = somarArraysMensais([a, b]);
  assert.strictEqual(soma[0], 15);
  assert.strictEqual(soma[1], 7);
  assert.strictEqual(soma[2], null);
});

test('calcularMensal soma através dos registros numa dimensão-fluxo', () => {
  const a = serieCom('financeiro', Array(12).fill(100));
  const b = serieCom('financeiro', Array(12).fill(50));
  assert.strictEqual(calcularMensal([a, b], 'realizado', 'financeiro')[3], 150);
});

// A razão NUNCA é a soma das razões: é a razão das somas. Somar "R$/m³" de
// dois contratos não produziria um número válido.
test('calcularMensal recalcula ticketMedio a partir das somas, não soma razões', () => {
  const a = { ...serieCom('financeiro', Array(12).fill(100)), volume: Array(12).fill(10) };
  const b = { ...serieCom('financeiro', Array(12).fill(300)), volume: Array(12).fill(10) };
  assert.strictEqual(calcularMensal([a, b], 'realizado', 'ticketMedio')[0], 20);
});

test('calcularMensal usa a premissa da planilha no Previsto de UMA tipologia', () => {
  const so = serieCom('volume', Array(12).fill(999));
  so.volumeResumo.ticket = 42;
  assert.strictEqual(calcularMensal([so], 'previsto', 'ticketMedio')[0], 42);
});

test('calcularMensal devolve null quando não há nenhum registro', () => {
  assert.strictEqual(calcularMensal([null, undefined], 'realizado', 'financeiro'), null);
});

test('formatarNumero devolve travessão para ausência de valor', () => {
  assert.strictEqual(formatarNumero(null), '—');
  assert.strictEqual(formatarNumero(undefined, 0), '—');
});
```

- [ ] **Step 12: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS, incluindo o golden.

- [ ] **Step 13: Commitar**

```bash
git add tools/comum/agregacao-cliente.js tools/orcamento/render-dashboard.js test/comum-agregacao-cliente.test.js
git commit -m "Extrair a agregação por dimensão para tools/comum/agregacao-cliente.js"
```

---

### Task 2: `filtros-cliente.js`

A extração maior: sete blocos não-contíguos.

**Files:**
- Create: `tools/comum/filtros-cliente.js`
- Modify: `tools/orcamento/render-dashboard.js`
- Test: `test/comum-filtros-cliente.test.js`

**Interfaces:**
- Consumes: `recortarTrechos` (Task 1).
- Produces: `tools/comum/filtros-cliente.js` → `{ categoriaTipologia, linhasDistintas, capitalizarPalavras, filtroExclui, indicesFiltrados, normalizarBusca, aplicarSelecaoExclusiva, DIMENSOES_CONFIG, DIMENSOES_ROTULO, dimensoesEmOrdem, emOrdemCanonica, tipologiaColor, trechosParaCliente, fonteParaCliente }`
  - `filtroExclui(filtro: Set, valor: string) -> boolean`
  - `indicesFiltrados(registros, filtroTipologia, filtroCategoria, filtroGrupo, filtroSup, filtroOrigem) -> number[]`
  - `dimensoesEmOrdem(selecionadas: Set) -> string[]`
  - `DIMENSOES_CONFIG: {valor, rotulo}[]` — `equipes, volume, financeiro, produtividade, ticketMedio`, nessa ordem

**Contrato de globais livres** — quem injetar `fonteParaCliente()` numa página **precisa** definir, no escopo global dessa página: `escapeHtml`, `FILTROS_CONFIG`, `filtrosSelecionados`, `renderCorpoTabela`, `recalcularTabela`, `recalcularAlertas`. Documente isso no topo do módulo.

- [ ] **Step 1: Criar `tools/comum/filtros-cliente.js` com os sete blocos**

Recorte de `SCRIPT_CLIENTE_TABELA`, **nesta ordem** (é a ordem em que aparecem no arquivo, e `trechosParaCliente()` devolve nessa ordem):

| # | Âncora inicial | Âncora final | Hoje |
|---|---|---|---|
| 1 | `// Um filtro é um Set de valores selecionados -- Set vazio (ou ausente)` | `}` de `function indicesFiltrados(...)` | 481–507 |
| 2 | `// Mesmo mapeamento de cores por tipologia da matriz de equipes` | `}` de `function tipologiaColor(...)` | 1105–1130 |
| 3 | `// Agrupamento fixo das 8 tipologias reais em 4 categorias -- Lab.` | `}` de `function categoriaTipologia(...)` | 1132–1144 |
| 4 | `// Ordem fixa e canônica das dimensões -- quando várias estão marcadas, os` | `}` de `function emOrdemCanonica(...)` | 1161–1187 |
| 5 | `function linhasDistintas(registros, campo) {` | `}` que a fecha | 1358–1367 |
| 6 | `// "CONTRATO VIGENTE" -> "Contrato Vigente" -- só cosmético pro rótulo do` | `}` de `function capitalizarPalavras(...)` | 1470–1481 |
| 7 | `function opcoesFiltro(cfg, registros) {` | `}` de `function configurarAberturaFiltrosMulti(...)` | 1483–1694 |

O bloco 7 é o maior e traz junto `opcoesFiltro`, `atualizarRotuloFiltro`, `normalizarBusca`, `aplicarSelecaoExclusiva`, `montarFiltroMulti`, `montarTodosFiltrosMulti` e `configurarAberturaFiltrosMulti`.

**Escapes que mudam neste recorte** (a falha mais provável da tarefa):
- No bloco 1, o comentário de `indicesFiltrados` tem ``\`registros\``` — vira ``` `registros` ``` (some a barra).
- No bloco 2, `tipologiaColor` tem `raw.match(/\\(([^)]+)\\)\\s*$/)` — vira `raw.match(/\(([^)]+)\)\s*$/)`.
- No bloco 6, o comentário cita `\\s/\\S` — vira `\s/\S`.
- No bloco 7, o comentário de `normalizarBusca` cita `\\uNNNN` e `\\r/\\n/\\.` — viram `\uNNNN` e `\r/\n/\.`.

Regra geral: **toda sequência `\\` no template literal vira `\` no arquivo `.js`.** Faça uma passada procurando por `\\` no texto recortado antes de salvar.

Cabeçalho do arquivo:

```js
'use strict';
const { recortarTrechos } = require('./trechos-cliente.js');

// A máquina de filtro multi-select (dropdown de checkboxes com busca),
// compartilhada entre o dashboard de orçamento e a página de planejamento
// semanal. Recortada VERBATIM do JS de cliente do orçamento
// (tools/orcamento/render-dashboard.js), que a injeta de volta nas mesmas
// posições via trechosParaCliente() -- não modernize `var` pra `const`, não
// reformate, não reescreva comentário: este texto é conteúdo do HTML
// publicado, travado byte a byte por test/orcamento-html-inalterado.test.js.
//
// CONTRATO: estas funções referenciam, de propósito, globais que cada página
// define do seu jeito. Quem injetar fonteParaCliente() PRECISA ter definido,
// no escopo global da página, antes de qualquer clique:
//
//   escapeHtml(valor)            usado ao montar os <label> de cada opção
//   FILTROS_CONFIG               a lista de filtros da página (opcoesFiltro,
//                                montarTodosFiltrosMulti, e a cascata
//                                Categoria -> Tipologia em montarFiltroMulti)
//   filtrosSelecionados          chave -> Set dos valores marcados
//   renderCorpoTabela(regs, dims)  remonta o <tbody id="corpo-tabela"> quando
//                                a Dimensão muda (o nº de linhas por registro
//                                depende de quantas dimensões estão marcadas)
//   recalcularTabela()           chamada a cada mudança de qualquer filtro
//   recalcularAlertas()          idem; a página semanal define um no-op
//
// A tabela da página também precisa ter <tbody id="corpo-tabela"> e o seletor
// de dimensão precisa ter id="seletor-dimensao" -- os dois nomes aparecem
// literalmente no texto de montarFiltroMulti.
//
// dimensoesEmOrdem/DIMENSOES_CONFIG/tipologiaColor/categoriaTipologia são
// exportados também como funções Node de verdade (testadas em
// test/comum-filtros-cliente.test.js), não só como texto.
```

Fim do arquivo:

```js
function trechosParaCliente() {
  return recortarTrechos(__filename);
}

function fonteParaCliente() {
  return trechosParaCliente().join('');
}

module.exports = {
  categoriaTipologia, linhasDistintas, capitalizarPalavras,
  filtroExclui, indicesFiltrados, normalizarBusca, aplicarSelecaoExclusiva,
  DIMENSOES_CONFIG, DIMENSOES_ROTULO, dimensoesEmOrdem, emOrdemCanonica,
  tipologiaColor,
  trechosParaCliente, fonteParaCliente,
};
```

**Nota:** `opcoesFiltro`, `atualizarRotuloFiltro`, `montarFiltroMulti`, `montarTodosFiltrosMulti` e `configurarAberturaFiltrosMulti` **não** entram no `module.exports` — elas tocam o DOM e referenciam globais que só existem na página; exportá-las convidaria alguém a chamá-las no Node, onde quebram. O texto delas continua saindo por `fonteParaCliente()`, que é o único consumo válido.

- [ ] **Step 2: Reinjetar os sete trechos no orçamento**

```js
const { trechosParaCliente: trechosFiltros } = require('../comum/filtros-cliente.js');
const [
  TRECHO_FILTRO_EXCLUI, TRECHO_TIPOLOGIA_COR, TRECHO_CATEGORIA_TIPOLOGIA,
  TRECHO_DIMENSOES, TRECHO_LINHAS_DISTINTAS, TRECHO_CAPITALIZAR, TRECHO_FILTRO_MULTI,
] = trechosFiltros();
```

E, dentro de `SCRIPT_CLIENTE_TABELA`, cada bloco removido vira uma linha só com a interpolação correspondente, na mesma posição.

- [ ] **Step 3: Rodar o golden**

Run: `node --test test/orcamento-html-inalterado.test.js`
Expected: PASS. Se falhar, procure primeiro por `\\` esquecido no arquivo novo — é a causa mais provável.

- [ ] **Step 4: Escrever os testes de unidade**

Criar `test/comum-filtros-cliente.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  filtroExclui, indicesFiltrados, categoriaTipologia, dimensoesEmOrdem,
  emOrdemCanonica, capitalizarPalavras, linhasDistintas, tipologiaColor,
  normalizarBusca, aplicarSelecaoExclusiva, DIMENSOES_CONFIG, fonteParaCliente,
} = require('../tools/comum/filtros-cliente.js');

const REGISTROS = [
  { sup: 'SUP1', grupo: 'G1', tomador: 'T1', tipologia: 'SP', origem: 'CONTRATO VIGENTE' },
  { sup: 'SUP2', grupo: 'G2', tomador: 'T2', tipologia: 'CPTU', origem: 'NOVOS NEGÓCIOS' },
  { sup: 'SUP3', grupo: 'G1', tomador: 'T3', tipologia: 'LAB.E', origem: 'CONTRATO VIGENTE' },
];

// Set vazio significa "sem filtro" -- a mesma semântica que o <select> antigo
// tinha com "". Confundir isso com "não passa nada" esconderia a tabela toda.
test('filtroExclui trata Set vazio como ausência de filtro', () => {
  assert.strictEqual(filtroExclui(new Set(), 'SP'), false);
  assert.strictEqual(filtroExclui(undefined, 'SP'), false);
  assert.strictEqual(filtroExclui(new Set(['ST']), 'SP'), true);
  assert.strictEqual(filtroExclui(new Set(['SP', 'ST']), 'SP'), false);
});

test('indicesFiltrados combina filtros com AND e valores com OR', () => {
  const vazio = new Set();
  assert.deepStrictEqual(indicesFiltrados(REGISTROS, vazio, vazio, vazio, vazio, vazio), [0, 1, 2]);
  assert.deepStrictEqual(
    indicesFiltrados(REGISTROS, vazio, vazio, new Set(['G1']), vazio, vazio), [0, 2]);
  assert.deepStrictEqual(
    indicesFiltrados(REGISTROS, new Set(['SP', 'CPTU']), vazio, vazio, vazio, vazio), [0, 1]);
  assert.deepStrictEqual(
    indicesFiltrados(REGISTROS, vazio, vazio, new Set(['G1']), vazio, new Set(['NOVOS NEGÓCIOS'])), []);
});

test('indicesFiltrados sabe filtrar por categoria, que é derivada da tipologia', () => {
  const vazio = new Set();
  assert.deepStrictEqual(
    indicesFiltrados(REGISTROS, vazio, new Set(['labEspecial']), vazio, vazio, vazio), [2]);
});

test('categoriaTipologia classifica as 4 categorias', () => {
  assert.strictEqual(categoriaTipologia('LAB.C'), 'labConvencional');
  assert.strictEqual(categoriaTipologia('lab.e'), 'labEspecial');
  assert.strictEqual(categoriaTipologia('CPTU'), 'sondagemEspecial');
  assert.strictEqual(categoriaTipologia('SP'), 'sondagemConvencional');
});

// A ordem dos blocos na tabela é canônica, não a ordem em que a pessoa
// marcou os checkboxes -- previsibilidade.
test('dimensoesEmOrdem devolve na ordem canônica e nunca vazio', () => {
  assert.deepStrictEqual(dimensoesEmOrdem(new Set(['ticketMedio', 'equipes'])), ['equipes', 'ticketMedio']);
  assert.deepStrictEqual(dimensoesEmOrdem(new Set()), ['financeiro']);
});

test('DIMENSOES_CONFIG tem as 5 dimensões na ordem canônica', () => {
  assert.deepStrictEqual(DIMENSOES_CONFIG.map(d => d.valor),
    ['equipes', 'volume', 'financeiro', 'produtividade', 'ticketMedio']);
});

test('emOrdemCanonica respeita a ordem dada, não a do Set', () => {
  assert.deepStrictEqual(emOrdemCanonica(['a', 'b', 'c'], new Set(['c', 'a'])), ['a', 'c']);
});

test('capitalizarPalavras deixa só o rótulo bonito', () => {
  assert.strictEqual(capitalizarPalavras('CONTRATO VIGENTE'), 'Contrato Vigente');
});

test('linhasDistintas deduplica, ordena e ignora vazios', () => {
  assert.deepStrictEqual(linhasDistintas(REGISTROS, 'grupo'), ['G1', 'G2']);
  assert.deepStrictEqual(linhasDistintas([{ x: '' }, { x: 'b' }], 'x'), ['b']);
});

// Sem isso "iguacu" não acharia "Iguaçu" e a busca dentro do dropdown
// exigiria digitar o acento certo.
test('normalizarBusca tira acento e caixa', () => {
  assert.strictEqual(normalizarBusca('Iguaçu'), 'iguacu');
  assert.strictEqual(normalizarBusca('SÃO PAULO'), 'sao paulo');
});

test('aplicarSelecaoExclusiva deixa exatamente um valor', () => {
  const s = new Set(['a', 'b']);
  aplicarSelecaoExclusiva(s, 'c');
  assert.deepStrictEqual([...s], ['c']);
});

test('tipologiaColor tem fallback e entende tipologia composta', () => {
  assert.strictEqual(tipologiaColor('SP'), '#3f851a');
  assert.strictEqual(tipologiaColor('SP/SM'), '#3f851a');
  assert.strictEqual(tipologiaColor('inexistente'), '#898781');
});

// O escape dobrado do template literal precisa ter virado escape simples --
// se sobrar um \\ no arquivo, o regex do cliente casa a barra literal e a
// função silenciosamente para de funcionar no navegador.
test('o texto de cliente não tem escape dobrado sobrando', () => {
  assert.ok(!fonteParaCliente().includes('\\\\'), 'sobrou uma barra dupla no texto de cliente');
});
```

- [ ] **Step 5: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS

- [ ] **Step 6: Commitar**

```bash
git add tools/comum/filtros-cliente.js tools/orcamento/render-dashboard.js test/comum-filtros-cliente.test.js
git commit -m "Extrair a máquina de filtro multi-select para tools/comum/filtros-cliente.js"
```

---

### Task 3: `refresh-cliente.js`

**Files:**
- Create: `tools/comum/refresh-cliente.js`
- Modify: `tools/orcamento/render-dashboard.js`
- Test: `test/comum-refresh-cliente.test.js`

**Interfaces:**
- Consumes: `recortarTrechos` (Task 1).
- Produces: `tools/comum/refresh-cliente.js` → `{ URL_ESPELHO_MATRIZ, parseCsvGrid, parseMatrizClient, preservarPrevistoInicial, trechosParaCliente, fonteParaCliente }`
  - `parseCsvGrid(texto: string) -> string[][]`
  - `preservarPrevistoInicial(registrosAntigos, registrosNovos) -> void` (muta `registrosNovos`)

- [ ] **Step 1: Criar o módulo com o bloco recortado**

O trecho é **contíguo** (verificado): vai da linha

```js
// ---- Atualização ao vivo (busca a Sheet espelho publicada, sem tocar no
```

até o `}` que fecha `function atualizarDadosAoVivo()` — hoje as linhas 1789–2055. Cobre, nesta ordem: o comentário do cabeçalho da seção, `URL_ESPELHO_MATRIZ`, `parseCsvGrid`, `parseMatrizClient`, `definirStatusAtualizacao`, `preservarPrevistoInicial` e `atualizarDadosAoVivo`.

A linha seguinte **fica** no orçamento — é wiring de página, e a semanal escreve o seu (Task 7):

```js
document.getElementById('atualizar-dashboard').addEventListener('click', atualizarDadosAoVivo);
```

**Escapes que mudam:** `parseCsvGrid` e `parseMatrizClient` têm regex com `\\r`, `\\n`, `\\.` — todos viram escape simples. Rode a mesma varredura por `\\` do Task 2.

Mesmo cabeçalho de contrato dos outros módulos, listando as globais livres que `atualizarDadosAoVivo` consome: `window.__REGISTROS__`, `window.__VIGENTE_IDX__`, `fecharTendenciaVigente`, `montarTodosFiltrosMulti`, `renderCorpoTabela`, `dimensoesEmOrdem`, `filtrosSelecionados`, `recalcularTabela`, `recalcularAlertas`, e os ids `status-atualizacao` e `corpo-tabela`.

- [ ] **Step 2: Reinjetar no orçamento**

```js
const { trechosParaCliente: trechosRefresh } = require('../comum/refresh-cliente.js');
const [TRECHO_REFRESH] = trechosRefresh();
```

E `${TRECHO_REFRESH}` na posição de onde o bloco saiu.

- [ ] **Step 3: Rodar o golden**

Run: `node --test test/orcamento-html-inalterado.test.js`
Expected: PASS

- [ ] **Step 4: Escrever os testes de unidade**

Criar `test/comum-refresh-cliente.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseCsvGrid, preservarPrevistoInicial, URL_ESPELHO_MATRIZ } = require('../tools/comum/refresh-cliente.js');

test('parseCsvGrid entende aspas, vírgula e quebra de linha dentro do campo', () => {
  assert.deepStrictEqual(parseCsvGrid('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
  assert.deepStrictEqual(parseCsvGrid('"x,y",z'), [['x,y', 'z']]);
  assert.deepStrictEqual(parseCsvGrid('"ele disse ""oi""",z'), [['ele disse "oi"', 'z']]);
  assert.deepStrictEqual(parseCsvGrid('"linha\nquebrada",z'), [['linha\nquebrada', 'z']]);
});

test('parseCsvGrid normaliza CRLF', () => {
  assert.deepStrictEqual(parseCsvGrid('a,b\r\n1,2'), [['a', 'b'], ['1', '2']]);
});

// previstoInicial vem de um arquivo lido só no build (o estudo de linha de
// base), nunca do CSV espelho -- sem o transplante, cada "Atualizar dados"
// apagaria a linha Previsto Inicial da tabela.
test('preservarPrevistoInicial transplanta por SUP+tipologia', () => {
  const antigos = [{ sup: 'S1', tipologia: 'SP', previstoInicial: { marcador: 'original' } }];
  const novos = [{ sup: 'S1', tipologia: 'SP' }, { sup: 'S2', tipologia: 'ST' }];
  preservarPrevistoInicial(antigos, novos);
  assert.strictEqual(novos[0].previstoInicial.marcador, 'original');
  assert.deepStrictEqual(novos[1].previstoInicial.financeiro, Array(12).fill(0));
});

test('a URL do espelho é a Sheet publicada, não o .xlsx de origem', () => {
  assert.match(URL_ESPELHO_MATRIZ, /^https:\/\/docs\.google\.com\/spreadsheets\/.*output=csv$/);
});
```

- [ ] **Step 5: Rodar a suíte inteira e commitar**

Run: `node --test test/*.test.js`
Expected: PASS

```bash
git add tools/comum/refresh-cliente.js tools/orcamento/render-dashboard.js test/comum-refresh-cliente.test.js
git commit -m "Extrair o refresh ao vivo da MATRIZ para tools/comum/refresh-cliente.js"
```

---

### Task 4: Parametrizar `mesclarColunasRepetidas` (regeneração deliberada do golden)

`mesclarColunasRepetidas` esmaece valores repetidos nas colunas SUP/Grupo/Tomador/Tipologia — parte do layout que a página semanal precisa reproduzir. Ela hardcoda `'#tabela-orcamento tbody tr'`, então **não dá para compartilhá-la sem mudar um byte do HTML do orçamento.**

Esta é a única tarefa do plano que regenera o golden. `CLAUDE.md` permite isso desde que seja de propósito e com o diff revisado linha a linha — que é o critério de aceite aqui.

**Files:**
- Modify: `tools/comum/filtros-cliente.js` (ganha um oitavo bloco)
- Modify: `tools/orcamento/render-dashboard.js`
- Modify: `test/fixtures/` — o golden do orçamento
- Test: `test/comum-filtros-cliente.test.js` (acrescentar)

**Interfaces:**
- Consumes: `filtros-cliente.js` (Task 2).
- Produces: `mesclarConsecutivos(valores: any[]) -> {valor, repetido}[]` exportado como função Node; `mesclarColunasRepetidas()` disponível no texto de cliente, lendo o seletor da global `SELETOR_LINHAS_TABELA`.

- [ ] **Step 1: Mover `mesclarConsecutivos` e `mesclarColunasRepetidas` para `filtros-cliente.js`**

Recortar de `SCRIPT_CLIENTE_TABELA` o trecho que vai de `// Dado um array de valores (na ordem das linhas visíveis de UMA coluna),` até o `}` que fecha `mesclarColunasRepetidas` (hoje ~1063–1103), acrescentando-o como oitavo bloco marcado em `tools/comum/filtros-cliente.js`, **na posição correta da ordem de leitura** (antes do bloco de `tipologiaColor`, que hoje vem depois dele no arquivo do orçamento).

Fazer **uma única alteração** no texto recortado — a primeira linha do corpo de `mesclarColunasRepetidas`:

```js
// ANTES
    document.querySelectorAll('#tabela-orcamento tbody tr'),
// DEPOIS
    document.querySelectorAll(SELETOR_LINHAS_TABELA),
```

E acrescentar, logo acima da função, este comentário (que **também** entra no HTML e por isso aparece no diff do golden):

```js
// SELETOR_LINHAS_TABELA é definido por cada página (o orçamento e o
// planejamento semanal têm tabelas com ids diferentes, mas as MESMAS colunas
// mescláveis) -- ver o contrato no topo de tools/comum/filtros-cliente.js.
```

- [ ] **Step 2: Definir a global no orçamento e reinjetar**

Em `SCRIPT_CLIENTE_TABELA`, na posição de onde o bloco saiu:

```
var SELETOR_LINHAS_TABELA = '#tabela-orcamento tbody tr';
${TRECHO_MESCLAGEM}
```

E acrescentar `TRECHO_MESCLAGEM` na desestruturação de `trechosFiltros()`, **na posição correspondente à ordem dos blocos no arquivo**.

Acrescentar `SELETOR_LINHAS_TABELA` à lista de globais do contrato, no cabeçalho de `filtros-cliente.js`.

- [ ] **Step 3: Rodar o golden e INSPECIONAR o diff**

Run: `node --test test/orcamento-html-inalterado.test.js`
Expected: **FAIL** — e é o esperado nesta tarefa. É a única vez no plano inteiro.

Gere os dois lados já normalizados e faça o diff à mão. Não use `tools/orcamento/build-dashboard.js` aqui — ele precisa do `G:`; o helper do golden usa fixture:

```bash
node -e "
const fs=require('node:fs');
const {construirHtmlGolden,normalizarVolatil}=require('./test/helpers/golden-orcamento.js');
fs.writeFileSync('/tmp/golden-antes.html', normalizarVolatil(fs.readFileSync('test/fixtures/orcamento-golden.html','utf8')));
fs.writeFileSync('/tmp/golden-depois.html', normalizarVolatil(construirHtmlGolden()));
"
diff /tmp/golden-antes.html /tmp/golden-depois.html
```

**Critério de aceite — o diff contém exatamente três coisas:**

1. a linha `var SELETOR_LINHAS_TABELA = '#tabela-orcamento tbody tr';` acrescentada;
2. as 3 linhas do comentário novo que a explica;
3. a troca de `'#tabela-orcamento tbody tr'` por `SELETOR_LINHAS_TABELA` dentro do `querySelectorAll`.

**Nada mais.** `Gerado em` e o blob cifrado já foram normalizados pelo helper, então não aparecem — se aparecer qualquer outra linha, a extração não foi verbatim. Corrija antes de regenerar; regenerar por cima de um diff sujo perde silenciosamente a prova de tudo que veio antes.

- [ ] **Step 4: Regenerar o golden**

Só depois de o diff acima estar exatamente como descrito. O golden é guardado **cru** (a normalização acontece na comparação, não na escrita):

```bash
node -e "
const fs=require('node:fs');
const {construirHtmlGolden}=require('./test/helpers/golden-orcamento.js');
fs.writeFileSync('test/fixtures/orcamento-golden.html', construirHtmlGolden());
"
node --test test/orcamento-html-inalterado.test.js
```

Expected: PASS — inclusive o teste que decifra os registros e compara com os do golden, que prova que o conteúdo protegido não mudou junto.

- [ ] **Step 5: Acrescentar o teste de `mesclarConsecutivos`**

Em `test/comum-filtros-cliente.test.js`:

```js
const { mesclarConsecutivos } = require('../tools/comum/filtros-cliente.js');

// O texto nunca vira '' -- quem decide como exibir (esmaecido) é o CSS.
test('mesclarConsecutivos marca repetição só contra a linha anterior', () => {
  assert.deepStrictEqual(mesclarConsecutivos(['a', 'a', 'b', 'a']), [
    { valor: 'a', repetido: false },
    { valor: 'a', repetido: true },
    { valor: 'b', repetido: false },
    { valor: 'a', repetido: false },
  ]);
  assert.deepStrictEqual(mesclarConsecutivos([]), []);
});
```

E acrescentar `mesclarConsecutivos` ao `module.exports` de `filtros-cliente.js`.

- [ ] **Step 6: Rodar a suíte inteira e commitar**

Run: `node --test test/*.test.js`
Expected: PASS

```bash
git add tools/comum/filtros-cliente.js tools/orcamento/render-dashboard.js test/
git commit -m "Parametrizar o seletor de mesclagem de colunas repetidas

Regeneração deliberada do golden do orçamento: mesclarColunasRepetidas
hardcodava '#tabela-orcamento tbody tr' e a página semanal precisa da mesma
mesclagem numa tabela com outro id. O diff foi revisado linha a linha e
contém apenas a global nova, o comentário que a explica e a substituição do
seletor."
```

---

### Task 5: Generalizar `compute-semanal.js` para as 5 dimensões

**Files:**
- Modify: `tools/semanal/compute-semanal.js`
- Test: `test/semanal-compute-semanal.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `tools/semanal/compute-semanal.js` → `{ SEMANAS, DIMENSOES_QUE_NAO_REPARTEM, reparteEmSemanas, dividirEmSemanas, fecharMes, rotuloFechamento }`
  - `reparteEmSemanas(dimensao: string) -> boolean`
  - `dividirEmSemanas(valorMensal: number|null, dimensao: string) -> (number|null)[4]`
  - `fecharMes(semanas, dimensao) -> number|null`
  - `rotuloFechamento(dimensoes: string[]) -> 'Total' | 'Média' | 'Total / Média'`

- [ ] **Step 1: Escrever os testes novos (falhando)**

Substituir o conteúdo de `test/semanal-compute-semanal.test.js` por (mantendo os casos que já existiam para financeiro/volume/equipes):

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  SEMANAS, dividirEmSemanas, fecharMes, reparteEmSemanas, rotuloFechamento,
} = require('../tools/semanal/compute-semanal.js');

test('SEMANAS é 4', () => assert.strictEqual(SEMANAS, 4));

// Volume e financeiro são FLUXOS: o mês se reparte e a soma reconstrói o mês.
test('fluxo reparte o mês em 4 e fecha somando', () => {
  ['financeiro', 'volume'].forEach((dim) => {
    assert.deepStrictEqual(dividirEmSemanas(100, dim), [25, 25, 25, 25]);
    assert.strictEqual(fecharMes([25, 25, 25, 25], dim), 100);
    assert.strictEqual(reparteEmSemanas(dim), true);
  });
});

// Equipes é uma FOTO: 2 equipes mobilizadas no mês são 2 equipes em cada
// semana, não 0,5. Dividir produziria número errado em silêncio.
test('equipes repete o valor e fecha na média', () => {
  assert.deepStrictEqual(dividirEmSemanas(2, 'equipes'), [2, 2, 2, 2]);
  assert.strictEqual(fecharMes([2, 2, 2, 2], 'equipes'), 2);
  assert.strictEqual(reparteEmSemanas('equipes'), false);
});

// Razões são INVARIANTES AO CORTE: ticket = (fin÷4)÷(vol÷4) = fin÷vol;
// produtividade = (vol÷4) ÷ (equipes × dias÷4) = a mesma taxa diária.
// Dividir uma razão por 4 seria simplesmente errado.
test('produtividade e ticketMedio repetem o valor, nunca são divididos', () => {
  ['produtividade', 'ticketMedio'].forEach((dim) => {
    assert.deepStrictEqual(dividirEmSemanas(12.5, dim), [12.5, 12.5, 12.5, 12.5]);
    assert.strictEqual(fecharMes([12.5, 12.5, 12.5, 12.5], dim), 12.5);
    assert.strictEqual(reparteEmSemanas(dim), false);
  });
});

test('valor mensal nulo produz 4 semanas nulas e fechamento nulo', () => {
  assert.deepStrictEqual(dividirEmSemanas(null, 'financeiro'), [null, null, null, null]);
  assert.deepStrictEqual(dividirEmSemanas(undefined, 'equipes'), [null, null, null, null]);
  assert.strictEqual(fecharMes([null, null, null, null], 'financeiro'), null);
});

test('fecharMes considera só as semanas com valor', () => {
  assert.strictEqual(fecharMes([25, null, 25, null], 'financeiro'), 50);
  assert.strictEqual(fecharMes([2, null, 4, null], 'equipes'), 3);
});

// Sem o rótulo certo alguém lê "Total" numa coluna de Equipes e soma
// contratos por engano.
test('rotuloFechamento reflete a mistura de dimensões marcadas', () => {
  assert.strictEqual(rotuloFechamento(['financeiro', 'volume']), 'Total');
  assert.strictEqual(rotuloFechamento(['equipes']), 'Média');
  assert.strictEqual(rotuloFechamento(['equipes', 'produtividade', 'ticketMedio']), 'Média');
  assert.strictEqual(rotuloFechamento(['financeiro', 'equipes']), 'Total / Média');
  assert.strictEqual(rotuloFechamento([]), 'Total');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-compute-semanal.test.js`
Expected: FAIL — `reparteEmSemanas is not a function`

- [ ] **Step 3: Reescrever `tools/semanal/compute-semanal.js`**

```js
'use strict';

// <<< INICIO CLIENTE
var SEMANAS = 4;

// Três das cinco dimensões NÃO se repartem entre as semanas, por dois
// motivos diferentes que dão no mesmo tratamento:
//
//   equipes                é uma FOTO, não um fluxo. 2 equipes mobilizadas no
//                          mês são 2 equipes em cada semana, não 0,5 --
//                          dividir produziria número errado em silêncio e
//                          discordaria do orçamento, que mostra a média.
//                          Mesma premissa de mediaEquipesPonderada em
//                          tools/comum/calculo-equipes.js.
//   produtividade,         são RAZÕES, invariantes ao corte:
//   ticketMedio            ticket = (fin÷4)÷(vol÷4) = fin÷vol;
//                          produtividade = (vol÷4)÷(equipes × dias÷4) = a
//                          mesma taxa diária. Dividir uma razão por 4 não
//                          produz "a razão da semana", produz um número sem
//                          significado.
//
// Volume e financeiro são FLUXOS: o mês se reparte em 4 fatias nominais e a
// soma delas reconstrói o mês.
var DIMENSOES_QUE_NAO_REPARTEM = { equipes: true, produtividade: true, ticketMedio: true };

function reparteEmSemanas(dimensao) {
  return !DIMENSOES_QUE_NAO_REPARTEM[dimensao];
}

function dividirEmSemanas(valorMensal, dimensao) {
  var saida = [];
  for (var i = 0; i < SEMANAS; i++) {
    if (valorMensal === null || valorMensal === undefined) { saida.push(null); continue; }
    saida.push(reparteEmSemanas(dimensao) ? valorMensal / SEMANAS : valorMensal);
  }
  return saida;
}

// Fluxo fecha somando; foto e razão fecham na média. Para foto/razão os 4
// valores são idênticos, então a média devolve o próprio valor -- é por isso
// que os dois casos compartilham este caminho.
function fecharMes(semanas, dimensao) {
  var validos = (semanas || []).filter(function (v) { return v !== null && v !== undefined; });
  if (!validos.length) return null;
  var soma = validos.reduce(function (a, b) { return a + b; }, 0);
  return reparteEmSemanas(dimensao) ? soma : soma / validos.length;
}

// Rótulo da última coluna da tabela. Com várias dimensões marcadas ao mesmo
// tempo, a coluna carrega naturezas diferentes em blocos diferentes -- dizer
// "Total" numa coluna de Equipes convidaria alguém a somar contratos ao
// longo do tempo, que é exatamente o erro que fecharMes evita.
function rotuloFechamento(dimensoes) {
  var lista = dimensoes && dimensoes.length ? dimensoes : ['financeiro'];
  var temSoma = false, temMedia = false;
  lista.forEach(function (d) {
    if (reparteEmSemanas(d)) temSoma = true; else temMedia = true;
  });
  if (temSoma && temMedia) return 'Total / Média';
  return temMedia ? 'Média' : 'Total';
}
// FIM CLIENTE >>>

module.exports = {
  SEMANAS, DIMENSOES_QUE_NAO_REPARTEM, reparteEmSemanas,
  dividirEmSemanas, fecharMes, rotuloFechamento,
};
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/semanal-compute-semanal.test.js`
Expected: PASS

- [ ] **Step 5: Commitar**

```bash
git add tools/semanal/compute-semanal.js test/semanal-compute-semanal.test.js
git commit -m "Generalizar a repartição semanal para as 5 dimensões"
```

---

### Task 6: Tabela semanal no layout do orçamento

Reescreve `render-aba-semanal.js` para emitir a estrutura da tabela do orçamento com células vazias. O preenchimento vem na Task 7.

**Files:**
- Modify: `tools/semanal/render-aba-semanal.js` (reescrita)
- Test: `test/semanal-render-aba-semanal.test.js` (reescrita)

**Interfaces:**
- Consumes: `categoriaTipologia`, `tipologiaColor` (Task 2) — no navegador vêm como globais injetadas; no Node, via `require('../comum/filtros-cliente.js')`.
- Produces: `tools/semanal/render-aba-semanal.js` → `{ renderCorpoTabelaSemanal, renderCabecalhoSemanal, SERIE_LABELS_SEMANAL, ORDEM_SERIES_SEMANAL, CLASSE_SERIE_SEMANAL }`
  - `renderCorpoTabelaSemanal(registros, dimensoes: string[]) -> string` (HTML das `<tr>`)
  - `renderCabecalhoSemanal(dimensoes: string[]) -> string` (HTML do `<thead>`)
  - `ORDEM_SERIES_SEMANAL = ['previsto', 'realizado', 'total']`
  - `CLASSE_SERIE_SEMANAL = { previsto: 'previsto', realizado: 'realizado', total: 'tendencia' }`

**Nota sobre os nomes das séries:** as chaves são `previsto`/`realizado`/`total` porque é assim que os campos se chamam no registro (`registros[idx][serie]`); os rótulos visíveis são Previsto/Realizado/**Tendência**. A classe CSS de `total` é `linha-tendencia`, que `CSS_SEMANAL` já estiliza.

- [ ] **Step 1: Escrever os testes (falhando)**

Substituir `test/semanal-render-aba-semanal.test.js` por:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  renderCorpoTabelaSemanal, renderCabecalhoSemanal, ORDEM_SERIES_SEMANAL,
} = require('../tools/semanal/render-aba-semanal.js');

const REGISTROS = [
  { sup: 'S1', grupo: 'G1', tomador: 'T1', tipologia: 'SP', origem: 'CONTRATO VIGENTE' },
  { sup: 'S1', grupo: 'G1', tomador: 'T1', tipologia: 'ST', origem: 'CONTRATO VIGENTE' },
  { sup: 'S2', grupo: 'G2', tomador: 'T2', tipologia: 'SP', origem: 'NOVOS NEGÓCIOS' },
];

function contarLinhas(html) {
  return (html.match(/<tr /g) || []).length;
}

test('a tabela tem 3 séries, não as 4 do orçamento', () => {
  assert.deepStrictEqual(ORDEM_SERIES_SEMANAL, ['previsto', 'realizado', 'total']);
});

test('o cabeçalho tem as colunas fixas, as 4 semanas e o fechamento', () => {
  const html = renderCabecalhoSemanal(['financeiro']);
  ['SUP', 'Grupo', 'Tomador', 'Tipologia', 'Série', 'S1', 'S2', 'S3', 'S4'].forEach((titulo) => {
    assert.ok(html.includes('>' + titulo + '<'), 'faltou a coluna ' + titulo);
  });
  assert.ok(html.includes('id="th-fechamento"'), 'o th de fechamento precisa de id para o rótulo dinâmico');
});

test('o rótulo da coluna de fechamento acompanha as dimensões marcadas', () => {
  assert.ok(renderCabecalhoSemanal(['financeiro']).includes('>Total<'));
  assert.ok(renderCabecalhoSemanal(['equipes']).includes('>Média<'));
  assert.ok(renderCabecalhoSemanal(['financeiro', 'equipes']).includes('>Total / Média<'));
});

// 1 TOTAL GERAL + 2 tipologias (SP, ST) + (2 registros + 1 total) do S1 +
// (1 registro + 1 total) do S2 = 8 blocos, 3 linhas cada.
test('monta total geral, um total por tipologia, os registros e um total por SUP', () => {
  const html = renderCorpoTabelaSemanal(REGISTROS, ['financeiro']);
  assert.strictEqual(contarLinhas(html), 8 * 3);
  assert.strictEqual((html.match(/data-total-geral="1"/g) || []).length, 3);
  assert.strictEqual((html.match(/data-total-geral-tipologia="1"/g) || []).length, 2 * 3);
  assert.strictEqual((html.match(/data-total-sup="1"/g) || []).length, 2 * 3);
});

test('cada dimensão marcada acrescenta um bloco de 3 linhas', () => {
  const uma = contarLinhas(renderCorpoTabelaSemanal(REGISTROS, ['financeiro']));
  const duas = contarLinhas(renderCorpoTabelaSemanal(REGISTROS, ['financeiro', 'equipes']));
  assert.strictEqual(duas, uma * 2);
});

test('os totais por tipologia vêm em ordem alfabética', () => {
  const html = renderCorpoTabelaSemanal(REGISTROS, ['financeiro']);
  assert.ok(html.indexOf('data-tipologia="SP" data-categoria') < html.indexOf('data-tipologia="ST" data-categoria'));
});

// recalcularTabela precisa desses ganchos para filtrar sem remontar a tabela.
test('cada linha carrega os data-* que o filtro consome', () => {
  const html = renderCorpoTabelaSemanal(REGISTROS, ['financeiro']);
  ['data-serie=', 'data-dimensao=', 'data-registro-indices=', 'data-grupo=', 'data-sup=', 'data-origem=', 'data-categoria='].forEach((attr) => {
    assert.ok(html.includes(attr), 'faltou ' + attr);
  });
});

test('as células saem vazias -- quem preenche é o cliente', () => {
  const html = renderCorpoTabelaSemanal(REGISTROS, ['financeiro']);
  assert.strictEqual((html.match(/<td class="celula-semana num"><\/td>/g) || []).length, 8 * 3 * 4);
  assert.ok(html.includes('<td class="celula-total-linha num"></td>'));
});

test('o rótulo da série traz o nome da dimensão junto', () => {
  const html = renderCorpoTabelaSemanal(REGISTROS, ['ticketMedio']);
  assert.ok(html.includes('Tendência — Ticket médio'));
  assert.ok(html.includes('Previsto — Ticket médio'));
});

test('escapa o que vem da planilha', () => {
  const html = renderCorpoTabelaSemanal([{ sup: 'S<x>', grupo: 'G', tomador: 'T&T', tipologia: 'SP', origem: 'O' }], ['financeiro']);
  assert.ok(!html.includes('<x>'));
  assert.ok(html.includes('S&lt;x&gt;'));
  assert.ok(html.includes('T&amp;T'));
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-render-aba-semanal.test.js`
Expected: FAIL — `renderCorpoTabelaSemanal is not a function`

- [ ] **Step 3: Reescrever `tools/semanal/render-aba-semanal.js`**

```js
'use strict';
const { SEMANAS, rotuloFechamento } = require('./compute-semanal.js');

// Este módulo roda tanto no Node (testes) quanto embrulhado no navegador via
// buildBrowserBundle -- por isso 'var'/'function', não 'const'/arrow, e o
// require acima na forma EXATA que a reescrita de tools/comum/browser-bundle.js
// reconhece (`const { X, Y } = require('./arquivo.js');`, sem espaço antes do
// parêntese, com chaves). Ver o comentário no topo de transformaModulo lá.
//
// categoriaTipologia, tipologiaColor e DIMENSOES_ROTULO vêm de
// tools/comum/filtros-cliente.js. No navegador elas já existem como GLOBAIS
// (render-semanal.js injeta fonteParaCliente() num <script> ANTES do bundle);
// no Node, o require '../' abaixo resolve normalmente. O bundle REMOVE esse
// require em vez de reescrevê-lo -- mesmo mecanismo já documentado no topo de
// compute-balanco.js. Sem a injeção prévia, a tabela quebra em produção com
// ReferenceError e os testes em Node passam do mesmo jeito.
const { categoriaTipologia, tipologiaColor, DIMENSOES_ROTULO } = require('../comum/filtros-cliente.js');

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// As chaves são os nomes dos campos do registro (registros[idx][serie]); os
// rótulos são o que aparece na tela. 'total' é a Tendência -- mesma
// convenção do orçamento. Previsto Inicial NÃO entra: a página semanal não
// carrega essa série por registro (o baseline chega em window.__BASELINE__,
// rechaveado por sup||tipologia, e serve só à aba Balanço de massa).
var ORDEM_SERIES_SEMANAL = ['previsto', 'realizado', 'total'];
var SERIE_LABELS_SEMANAL = { previsto: 'Previsto', realizado: 'Realizado', total: 'Tendência' };
// 'total' vira a classe .linha-tendencia (e não .linha-total, do orçamento):
// a linha é uma projeção, não um total de bloco, e CSS_SEMANAL em
// render-semanal.js já estiliza esse nome.
var CLASSE_SERIE_SEMANAL = { previsto: 'previsto', realizado: 'realizado', total: 'tendencia' };

function celulasSemanaVazias() {
  var html = '';
  for (var i = 0; i < SEMANAS; i++) html += '<td class="celula-semana num"></td>';
  return html;
}

// Gera o bloco de 3 linhas (Previsto/Realizado/Tendência) pra CADA dimensão
// marcada, reaproveitando as mesmas células fixas em todos os blocos -- só o
// rótulo da série ganha o nome da dimensão junto (" — Financeiro" etc.), pra
// diferenciar os blocos quando várias dimensões estão marcadas ao mesmo
// tempo. Usado pelos 4 tipos de linha (registro normal, total por SUP, total
// geral, total geral por tipologia), que só diferem nas células fixas.
// Espelha renderBlocosDimensao do orçamento (tools/orcamento/render-dashboard.js).
function renderBlocosDimensaoSemanal(classesExtra, dataAttrsBase, celulaSup, celulaGrupo, celulaTomador, celulaTipologia, dimensoes) {
  var sufixoClasse = classesExtra ? ' ' + classesExtra : '';
  var celulaFechamento = '<td class="celula-total-linha num"></td>';
  var html = '';
  dimensoes.forEach(function (dim) {
    var rotuloDim = DIMENSOES_ROTULO[dim];
    var dataAttrs = dataAttrsBase + ' data-dimensao="' + dim + '"';
    ORDEM_SERIES_SEMANAL.forEach(function (serie) {
      html += '<tr class="linha-serie linha-' + CLASSE_SERIE_SEMANAL[serie] + sufixoClasse + '" data-serie="' + serie + '" ' + dataAttrs + '>' +
          celulaSup + celulaGrupo + celulaTomador + celulaTipologia +
          '<td class="serie-label">' + SERIE_LABELS_SEMANAL[serie] + ' — ' + rotuloDim + '</td>' +
          celulasSemanaVazias() + celulaFechamento +
        '</tr>';
    });
  });
  return html;
}

function celulaMesclavel(classe, valor) {
  return '<td class="col-mesclavel ' + classe + '" data-valor="' + escapeHtml(valor) + '">' + escapeHtml(valor) + '</td>';
}

function renderLinhaSemanal(registro, indice, dimensoes) {
  var dataAttrsBase = 'data-tipologia="' + escapeHtml(registro.tipologia) + '" data-categoria="' + categoriaTipologia(registro.tipologia) + '" data-grupo="' + escapeHtml(registro.grupo) + '" data-sup="' + escapeHtml(registro.sup) + '" data-origem="' + escapeHtml(registro.origem) + '" data-registro-indices="' + indice + '"';
  var celulaTipologia = '<td class="col-mesclavel col-tipologia"><span class="tipologia-chip" style="--chip-color:' + tipologiaColor(registro.tipologia) + '">' + escapeHtml(registro.tipologia) + '</span></td>';
  return renderBlocosDimensaoSemanal('', dataAttrsBase,
    celulaMesclavel('col-sup', registro.sup), celulaMesclavel('col-grupo', registro.grupo),
    celulaMesclavel('col-tomador', registro.tomador), celulaTipologia, dimensoes);
}

// origem: sempre uniforme dentro de um SUP (mesmo fato já confirmado contra a
// MATRIZ real no orçamento -- nenhum SUP mistura CONTRATO VIGENTE e NOVOS
// NEGÓCIOS entre suas tipologias), então o total do SUP pode levar um único
// data-origem sem risco de esconder/mostrar errado.
function renderLinhaTotalSupSemanal(sup, grupo, tomador, origem, indices, dimensoes) {
  var dataAttrsBase = 'data-grupo="' + escapeHtml(grupo) + '" data-sup="' + escapeHtml(sup) + '" data-origem="' + escapeHtml(origem) + '" data-registro-indices="' + indices.join(',') + '" data-total-sup="1"';
  var celulaTipologia = '<td class="col-mesclavel col-tipologia"><span class="tipologia-chip tipologia-chip-total">TOTAL</span></td>';
  return renderBlocosDimensaoSemanal('linha-total-sup', dataAttrsBase,
    celulaMesclavel('col-sup', sup), celulaMesclavel('col-grupo', grupo),
    celulaMesclavel('col-tomador', tomador), celulaTipologia, dimensoes);
}

// O bloco do topo -- ao contrário de TOTAL SUP/TOTAL GERAL POR TIPOLOGIA
// (que somem quando um filtro de recorte estreita os dados, porque os índices
// que eles somam foram fixados na montagem), este NUNCA some: recalcularTabela
// recalcula os índices a cada chamada a partir dos filtros atuais, então o
// "TOTAL GERAL" vira "SUBTOTAL" (rótulo trocado em tempo real, ver
// .chip-total-geral) e mostra a soma exata do que está filtrado no momento.
function renderLinhaTotalGeralSemanal(totalRegistros, dimensoes) {
  var todosIndices = [];
  for (var i = 0; i < totalRegistros; i++) todosIndices.push(i);
  var dataAttrsBase = 'data-registro-indices="' + todosIndices.join(',') + '" data-total-geral="1"';
  var celulaVazia = function (classe) { return '<td class="col-mesclavel ' + classe + '" data-valor="">—</td>'; };
  var celulaTodos = function (classe) { return '<td class="col-mesclavel ' + classe + '" data-valor="Todos">Todos</td>'; };
  var celulaTipologia = '<td class="col-mesclavel col-tipologia"><span class="tipologia-chip tipologia-chip-total chip-total-geral">TOTAL GERAL</span></td>';
  return renderBlocosDimensaoSemanal('linha-total-geral', dataAttrsBase,
    celulaVazia('col-sup'), celulaTodos('col-grupo'), celulaTodos('col-tomador'), celulaTipologia, dimensoes);
}

function renderLinhaTotalGeralTipologiaSemanal(tipologia, indices, dimensoes) {
  var dataAttrsBase = 'data-tipologia="' + escapeHtml(tipologia) + '" data-categoria="' + categoriaTipologia(tipologia) + '" data-registro-indices="' + indices.join(',') + '" data-total-geral-tipologia="1"';
  var celulaVazia = function (classe) { return '<td class="col-mesclavel ' + classe + '" data-valor="">—</td>'; };
  var celulaTodos = function (classe) { return '<td class="col-mesclavel ' + classe + '" data-valor="Todos">Todos</td>'; };
  var celulaTipologia = '<td class="col-mesclavel col-tipologia"><span class="tipologia-chip" style="--chip-color:' + tipologiaColor(tipologia) + '">' + escapeHtml(tipologia) + '</span></td>';
  return renderBlocosDimensaoSemanal('linha-total-geral linha-total-geral-tipologia', dataAttrsBase,
    celulaVazia('col-sup'), celulaTodos('col-grupo'), celulaTodos('col-tomador'), celulaTipologia, dimensoes);
}

// O <thead>. O rótulo da última coluna é dinâmico (ver rotuloFechamento em
// compute-semanal.js) e ganha um id porque recalcularTabela o reescreve
// quando a Dimensão muda, sem remontar o cabeçalho inteiro.
function renderCabecalhoSemanal(dimensoes) {
  var colunasSemana = '';
  for (var i = 1; i <= SEMANAS; i++) colunasSemana += '<th>S' + i + '</th>';
  return '<thead><tr><th>SUP</th><th>Grupo</th><th>Tomador</th><th>Tipologia</th><th>Série</th>'
    + colunasSemana
    + '<th id="th-fechamento">' + escapeHtml(rotuloFechamento(dimensoes)) + '</th></tr></thead>';
}

// Mesma estrutura de renderCorpoTabela do orçamento: TOTAL GERAL no topo, um
// TOTAL GERAL POR TIPOLOGIA por tipologia (ordem alfabética, a mesma do
// filtro), depois os registros agrupados por SUP com um TOTAL fechando cada
// bloco. As células saem VAZIAS -- quem as preenche é recalcularTabela, no
// cliente, depois da decifragem.
function renderCorpoTabelaSemanal(registros, dimensoes) {
  dimensoes = dimensoes && dimensoes.length ? dimensoes : ['financeiro'];
  var html = renderLinhaTotalGeralSemanal(registros.length, dimensoes);

  var indicesPorTipologia = {};
  var ordemTipologias = [];
  registros.forEach(function (registro, indice) {
    if (!registro.tipologia) return;
    if (!indicesPorTipologia[registro.tipologia]) {
      indicesPorTipologia[registro.tipologia] = [];
      ordemTipologias.push(registro.tipologia);
    }
    indicesPorTipologia[registro.tipologia].push(indice);
  });
  ordemTipologias.sort();
  ordemTipologias.forEach(function (tipologia) {
    html += renderLinhaTotalGeralTipologiaSemanal(tipologia, indicesPorTipologia[tipologia], dimensoes);
  });

  var supAtual = null, grupoAtual = null, tomadorAtual = null, origemAtual = null;
  var indicesGrupoAtual = [];

  function fecharGrupo() {
    if (indicesGrupoAtual.length) {
      html += renderLinhaTotalSupSemanal(supAtual, grupoAtual, tomadorAtual, origemAtual, indicesGrupoAtual, dimensoes);
    }
  }

  registros.forEach(function (registro, indice) {
    if (supAtual !== null && registro.sup !== supAtual) {
      fecharGrupo();
      indicesGrupoAtual = [];
    }
    supAtual = registro.sup;
    grupoAtual = registro.grupo;
    tomadorAtual = registro.tomador;
    origemAtual = registro.origem;
    indicesGrupoAtual.push(indice);
    html += renderLinhaSemanal(registro, indice, dimensoes);
  });
  fecharGrupo();
  return html;
}

module.exports = {
  renderCorpoTabelaSemanal, renderCabecalhoSemanal,
  ORDEM_SERIES_SEMANAL, SERIE_LABELS_SEMANAL, CLASSE_SERIE_SEMANAL,
};
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/semanal-render-aba-semanal.test.js`
Expected: PASS

- [ ] **Step 5: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: `semanal-render-semanal-wireup.test.js` provavelmente FALHA — `render-semanal.js` ainda chama `RenderAbaSemanal.renderAbaSemanal`, que não existe mais. Isso é esperado e é fechado na Task 7. Anote a falha e siga.

- [ ] **Step 6: Commitar**

```bash
git add tools/semanal/render-aba-semanal.js test/semanal-render-aba-semanal.test.js
git commit -m "Reescrever a tabela semanal no layout da tabela do orçamento"
```

---

### Task 7: Barra de filtros e preenchimento no cliente

Liga tudo: a barra de filtros na página, o `recalcularTabela` que preenche as células, e os callbacks do contrato.

**Files:**
- Modify: `tools/semanal/render-semanal.js`
- Test: `test/semanal-render-semanal-wireup.test.js`

**Interfaces:**
- Consumes: tudo das Tasks 1–6.
- Produces: o HTML da página com a barra de filtros funcional. Nenhuma exportação nova.

- [ ] **Step 1: Escrever os testes de wire-up (falhando)**

Acrescentar a `test/semanal-render-semanal-wireup.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderSemanal } = require('../tools/semanal/render-semanal.js');
const { fonteParaCliente: fonteFiltros } = require('../tools/comum/filtros-cliente.js');
const { fonteParaCliente: fonteRefresh } = require('../tools/comum/refresh-cliente.js');

const PERIODOS = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2026, i, 1)));
function html() {
  return renderSemanal({
    registros: [], baseline: [], periodos: PERIODOS,
    senha: 'senha-de-teste', geradoEm: new Date(Date.UTC(2026, 6, 29)),
  });
}

test('a página traz os 7 filtros da barra principal', () => {
  const pagina = html();
  ['filtro-origem', 'filtro-categoria', 'filtro-tipologia', 'filtro-grupo',
   'filtro-sup', 'filtro-serie', 'seletor-dimensao'].forEach((id) => {
    assert.ok(pagina.includes('id="' + id + '"'), 'faltou o filtro ' + id);
  });
});

test('a página traz a faixa de ações e a nota de premissa', () => {
  const pagina = html();
  assert.ok(pagina.includes('id="limpar-filtros"'));
  assert.ok(pagina.includes('id="atualizar-dashboard"'));
  assert.ok(pagina.includes('id="status-atualizacao"'));
  assert.ok(pagina.includes('id="nota-premissa-produtividade"'));
});

test('a tabela tem os ids que o contrato de filtros-cliente exige', () => {
  const pagina = html();
  assert.ok(pagina.includes('id="corpo-tabela"'));
  assert.ok(pagina.includes('id="tabela-semanal"'));
});

// O contrato do módulo compartilhado: sem QUALQUER um destes nomes definido
// no escopo global da página, o primeiro clique num filtro quebra com
// ReferenceError -- e os testes em Node passam do mesmo jeito, porque lá o
// require resolve de verdade. Este teste é a única barreira contra isso.
test('a página define todas as globais que o texto compartilhado consome', () => {
  const pagina = html();
  ['escapeHtml', 'FILTROS_CONFIG', 'filtrosSelecionados', 'renderCorpoTabela',
   'recalcularTabela', 'recalcularAlertas', 'SELETOR_LINHAS_TABELA'].forEach((nome) => {
    assert.ok(
      pagina.includes('function ' + nome + '(') || pagina.includes('var ' + nome + ' ='),
      'a página não define ' + nome
    );
  });
});

test('o texto compartilhado dos filtros e do refresh entra na página', () => {
  const pagina = html();
  assert.ok(pagina.includes(fonteFiltros().trim().split('\n')[0]));
  assert.ok(pagina.includes('function atualizarDadosAoVivo()'));
  assert.ok(fonteRefresh().includes('function atualizarDadosAoVivo()'));
});

test('a série da página semanal tem 3 opções, não as 5 do orçamento', () => {
  const pagina = html();
  assert.ok(!pagina.includes('realizadoPrevistoInicial'));
  assert.ok(pagina.includes("{ valor: 'total', rotulo: 'Tendência' }"));
});

// Os registros são dado protegido -- não podem aparecer em texto plano.
test('nenhum registro vaza para fora do blob cifrado', () => {
  const pagina = renderSemanal({
    registros: [{ sup: 'SEGREDO-SUP', grupo: 'G', tomador: 'T', tipologia: 'SP', origem: 'O' }],
    baseline: [], periodos: PERIODOS, senha: 'senha-de-teste', geradoEm: new Date(Date.UTC(2026, 6, 29)),
  });
  assert.ok(!pagina.includes('SEGREDO-SUP'));
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-render-semanal-wireup.test.js`
Expected: FAIL

- [ ] **Step 3: Ligar a barra de filtros no markup de `render-semanal.js`**

No topo do arquivo, acrescentar aos requires:

```js
const {
  cssBase, markupCabecalho, markupAbas, markupFiltros, scriptDesbloqueio,
} = require('../comum/render-shell.js');
const { fonteParaCliente: fonteFiltros } = require('../comum/filtros-cliente.js');
const { fonteParaCliente: fonteAgregacao } = require('../comum/agregacao-cliente.js');
const { fonteParaCliente: fonteRefresh } = require('../comum/refresh-cliente.js');
```

Acrescentar as constantes de markup (espelhando `MARKUP_ACOES`/`MARKUP_NOTA_PREMISSA` do orçamento):

```js
const FILTROS_PRINCIPAIS = [
  { id: 'filtro-origem', rotulo: 'Todas as origens' },
  { id: 'filtro-categoria', rotulo: 'Todas as categorias' },
  { id: 'filtro-tipologia', rotulo: 'Todas as tipologias' },
  { id: 'filtro-grupo', rotulo: 'Todos os grupos' },
  { id: 'filtro-sup', rotulo: 'Todos os SUP' },
  { id: 'filtro-serie', rotulo: '3 selecionadas' },
  { id: 'seletor-dimensao', rotulo: 'Financeiro' },
];

const MARKUP_ACOES = `      <div class="filtros-acoes">
${markupAbas(ABAS_VISUALIZACAO, '        ')}
        <button id="limpar-filtros" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>Limpar filtros</button>
        <button id="atualizar-dashboard" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16M3 21v-5h5"/></svg>Atualizar dados</button>
        <span id="status-atualizacao" class="status-atualizacao"></span>
      </div>`;

const MARKUP_NOTA_PREMISSA = `      <div id="nota-premissa-produtividade" class="nota-premissa" style="display:none">Premissa: Produtividade = Volume ÷ (Equipes × dias do mês) — dias = 15 em Janeiro e Dezembro, 30 nos demais meses.</div>`;
```

No corpo do HTML, trocar a chamada solta de `markupAbas` (que hoje fica direto dentro de `#conteudo-protegido`) por `markupFiltros`, e a `<div id="secao-semanal">` pela tabela:

```html
  <div id="conteudo-protegido" style="display:none">
${markupFiltros(FILTROS_PRINCIPAIS, { recuo: '    ', acoes: MARKUP_ACOES, extra: MARKUP_NOTA_PREMISSA })}
    <div id="secao-semanal">
    <div class="table-scroll">
    <table id="tabela-semanal">
      <thead id="cabecalho-semanal"></thead>
      <tbody id="corpo-tabela"></tbody>
    </table>
    </div>
    </div>
    <div id="secao-balanco" style="display:none"></div>
  </div>
```

`markupAbas` agora só é chamada de dentro de `MARKUP_ACOES` — não a deixe duplicada.

- [ ] **Step 4: Injetar os três textos compartilhados**

Nos `<script>` do fim da página, **antes** do bundle (que consome `categoriaTipologia`, `tipologiaColor` e `DIMENSOES_ROTULO` como globais):

```js
  <script>${scriptDesbloqueio()}</script>
  <script>${fonteParaCliente()}</script>
  <script>${fonteAgregacao()}</script>
  <script>${fonteFiltros()}</script>
  <script>${fonteRefresh()}</script>
  <script>${bundle}</script>
  <script>${SCRIPT_CLIENTE_SEMANAL}</script>
```

`fonteParaCliente()` sem prefixo continua sendo a de `calculo-equipes.js` (já importada) e precisa vir **antes** de `fonteAgregacao()`, porque `calcularMensal` usa `DIAS_PREMISSA_MES`.

`SCRIPT_CLIENTE_SEMANAL` vem por último porque define os callbacks do contrato que os textos anteriores só chamam em tempo de clique.

- [ ] **Step 5: Escrever o JS de cliente da página**

Substituir `SCRIPT_CLIENTE_SEMANAL` por:

```js
const SCRIPT_CLIENTE_SEMANAL = `
var ComputeSemanal = MODULOS['compute-semanal.js'];
var RenderAbaSemanal = MODULOS['render-aba-semanal.js'];
var ComputeBalanco = MODULOS['compute-balanco.js'];
var RenderAbaBalanco = MODULOS['render-aba-balanco.js'];

// Contrato de tools/comum/filtros-cliente.js e refresh-cliente.js: os nomes
// abaixo são consumidos como GLOBAIS LIVRES pelo texto compartilhado que já
// rodou nos <script> anteriores. Renomear qualquer um quebra a página em
// produção sem quebrar nenhum teste em Node -- ver o teste de wire-up em
// test/semanal-render-semanal-wireup.test.js.
var SELETOR_LINHAS_TABELA = '#tabela-semanal tbody tr';

// Série com 3 opções, não as 5 do orçamento: a página semanal não carrega
// previstoInicial por registro, e "Realizado + Previsto Inicial" só existe no
// gráfico do orçamento. As chaves são os nomes dos campos do registro.
var FILTROS_CONFIG = [
  { id: 'filtro-origem', chave: 'origem', rotuloPadrao: 'Todas as origens', campo: 'origem', rotuloCapitalizado: true },
  { id: 'filtro-categoria', chave: 'categoria', rotuloPadrao: 'Todas as categorias', opcoesFixas: [
    { valor: 'labConvencional', rotulo: 'Lab. Convencional' },
    { valor: 'labEspecial', rotulo: 'Lab. Especial' },
    { valor: 'sondagemConvencional', rotulo: 'Sondagem Convencional' },
    { valor: 'sondagemEspecial', rotulo: 'Sondagem Especial' },
  ] },
  { id: 'filtro-tipologia', chave: 'tipologia', rotuloPadrao: 'Todas as tipologias', campo: 'tipologia' },
  { id: 'filtro-grupo', chave: 'grupo', rotuloPadrao: 'Todos os grupos', campo: 'grupo' },
  { id: 'filtro-sup', chave: 'sup', rotuloPadrao: 'Todos os SUP', campo: 'sup', rotuloComposto: true },
  { id: 'filtro-serie', chave: 'serie', rotuloPadrao: 'Todas as séries', opcoesFixas: [
    { valor: 'previsto', rotulo: 'Previsto' },
    { valor: 'realizado', rotulo: 'Realizado' },
    { valor: 'total', rotulo: 'Tendência' },
  ] },
  { id: 'seletor-dimensao', chave: 'dimensao', rotuloPadrao: 'Selecione ao menos 1', opcoesFixas: DIMENSOES_CONFIG, minimoUm: true },
];

// As 3 séries começam marcadas (ao contrário do orçamento, onde Previsto
// Inicial começa desmarcado por ser a referência de fundo).
var SERIES_PADRAO_SEMANAL = ['previsto', 'realizado', 'total'];
var filtrosSelecionados = {};
FILTROS_CONFIG.forEach(function (cfg) { filtrosSelecionados[cfg.chave] = new Set(); });
filtrosSelecionados.dimensao.add('financeiro');
SERIES_PADRAO_SEMANAL.forEach(function (s) { filtrosSelecionados.serie.add(s); });

var ESTADO_BALANCO = { periodo: 'mesVigente', base: 'previsto', somenteAtivos: true };

function escapeHtml(valor) {
  return String(valor === null || valor === undefined ? '' : valor)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Nome exigido pelo contrato -- é o que montarFiltroMulti chama quando a
// Dimensão muda (o nº de linhas por registro depende de quantas estão
// marcadas, então a ESTRUTURA da tabela precisa ser remontada, não só os
// valores).
function renderCorpoTabela(registros, dimensoes) {
  document.getElementById('cabecalho-semanal').innerHTML = RenderAbaSemanal.renderCabecalhoSemanal(dimensoes);
  return RenderAbaSemanal.renderCorpoTabelaSemanal(registros, dimensoes);
}

// Nome exigido pelo contrato. A página semanal não tem aba Alertas -- este
// no-op existe só para o texto compartilhado de filtros-cliente.js poder
// chamá-lo incondicionalmente, como faz no orçamento.
function recalcularAlertas() {}

// Preenche UMA linha: o valor do mês vigente na dimensão da linha, repartido
// em 4 semanas. Espelha preencherLinha do orçamento, trocando os 12 meses
// pelas 4 semanas.
//
// Realizado e Tendência ficam SEMPRE vazios, de propósito. O Previsto é um
// plano, e repartir um plano em 4 semanas é uma premissa declarada; o
// Realizado é medição, e espalhá-lo uniformemente afirmaria um recorte
// intra-mês que ninguém mediu. Ficam vazios até existir planilha semanal de
// origem -- decisão do dono do projeto, 2026-07-29. Quando essa planilha
// existir, é AQUI que ela entra.
function preencherLinhaSemanal(linha, valoresLista, serie, dimensao) {
  var casasDecimais = dimensao === 'produtividade' ? 2 : 0;
  var vigenteIdx = window.__VIGENTE_IDX__;
  // calcularVigenteIdx devolve -1 (ano inteiro no futuro) ou 12 (ano inteiro
  // no passado) quando os registros não são do ano corrente -- indexar o
  // array mensal com isso devolveria undefined em silêncio.
  var temVigente = typeof vigenteIdx === 'number' && vigenteIdx >= 0 && vigenteIdx < 12;
  var semanas, fechamento;
  if (serie !== 'previsto' || !temVigente) {
    semanas = new Array(ComputeSemanal.SEMANAS).fill(null);
    fechamento = null;
  } else {
    var mensal = calcularMensal(valoresLista, serie, dimensao);
    var valorMes = mensal ? mensal[vigenteIdx] : null;
    semanas = ComputeSemanal.dividirEmSemanas(valorMes, dimensao);
    fechamento = ComputeSemanal.fecharMes(semanas, dimensao);
  }
  linha.querySelectorAll('.celula-semana').forEach(function (celula, idx) {
    celula.textContent = formatarNumero(semanas[idx], casasDecimais);
  });
  var celulaFechamento = linha.querySelector('.celula-total-linha');
  if (celulaFechamento) celulaFechamento.textContent = formatarNumero(fechamento, casasDecimais);
}

// Nome exigido pelo contrato: chamada a cada mudança de qualquer filtro.
// Mesmas regras de visibilidade da tabela do orçamento (recalcularTabela lá):
// os blocos de total somem quando um filtro que os atravessa está ativo, e o
// TOTAL GERAL vira SUBTOTAL recalculado sobre o recorte atual.
function recalcularTabela() {
  var dimensoes = dimensoesEmOrdem(filtrosSelecionados.dimensao);
  document.getElementById('nota-premissa-produtividade').style.display =
    filtrosSelecionados.dimensao.has('produtividade') ? '' : 'none';
  document.getElementById('th-fechamento').textContent = ComputeSemanal.rotuloFechamento(dimensoes);

  var filtroTipologia = filtrosSelecionados.tipologia;
  var filtroCategoria = filtrosSelecionados.categoria;
  var filtroGrupo = filtrosSelecionados.grupo;
  var filtroSup = filtrosSelecionados.sup;
  var filtroOrigem = filtrosSelecionados.origem;
  var filtroSerie = filtrosSelecionados.serie;

  var indicesSubtotal = indicesFiltrados(window.__REGISTROS__, filtroTipologia, filtroCategoria, filtroGrupo, filtroSup, filtroOrigem);
  var algumFiltroDeRecorteAtivo = filtroTipologia.size > 0 || filtroCategoria.size > 0 || filtroGrupo.size > 0 || filtroSup.size > 0 || filtroOrigem.size > 0;
  document.querySelectorAll('.chip-total-geral').forEach(function (chip) {
    chip.textContent = algumFiltroDeRecorteAtivo ? 'SUBTOTAL' : 'TOTAL GERAL';
  });

  document.querySelectorAll(SELETOR_LINHAS_TABELA).forEach(function (linha) {
    var combinaSerie = !filtroExclui(filtroSerie, linha.dataset.serie);
    var combinaGrupoSup = !filtroExclui(filtroGrupo, linha.dataset.grupo) &&
      !filtroExclui(filtroSup, linha.dataset.sup) &&
      !filtroExclui(filtroOrigem, linha.dataset.origem);
    var combinaTipologiaCategoria = !filtroExclui(filtroTipologia, linha.dataset.tipologia) &&
      !filtroExclui(filtroCategoria, linha.dataset.categoria);
    var ehTotalGeral = linha.dataset.totalGeral === '1';
    var ehTotalGeralTipologia = linha.dataset.totalGeralTipologia === '1';
    var ehTotalSup = linha.dataset.totalSup === '1';
    var indices = ehTotalGeral ? indicesSubtotal : linha.dataset.registroIndices.split(',').map(Number);
    var mostra;
    if (ehTotalGeral) {
      mostra = combinaSerie;
    } else if (ehTotalGeralTipologia) {
      mostra = filtroGrupo.size === 0 && filtroSup.size === 0 && filtroOrigem.size === 0 && combinaTipologiaCategoria && combinaSerie;
    } else if (ehTotalSup) {
      mostra = combinaGrupoSup && filtroTipologia.size === 0 && filtroCategoria.size === 0 && combinaSerie;
    } else {
      mostra = combinaGrupoSup && combinaTipologiaCategoria && combinaSerie;
    }
    linha.style.display = mostra ? '' : 'none';
    if (mostra) {
      var valoresLista = indices.map(function (idx) { return window.__REGISTROS__[idx][linha.dataset.serie]; });
      preencherLinhaSemanal(linha, valoresLista, linha.dataset.serie, linha.dataset.dimensao);
    }
  });
  mesclarColunasRepetidas();
  montarAbaBalanco(window.__REGISTROS__, indicesSubtotal);
}

function limparFiltros() {
  FILTROS_CONFIG.forEach(function (cfg) { filtrosSelecionados[cfg.chave].clear(); });
  filtrosSelecionados.dimensao.add('financeiro');
  SERIES_PADRAO_SEMANAL.forEach(function (s) { filtrosSelecionados.serie.add(s); });
  montarTodosFiltrosMulti(window.__REGISTROS__);
  document.getElementById('corpo-tabela').innerHTML = renderCorpoTabela(window.__REGISTROS__, dimensoesEmOrdem(filtrosSelecionados.dimensao));
  recalcularTabela();
}

function alternarAba(aba) {
  document.getElementById('secao-semanal').style.display = aba === 'semanal' ? '' : 'none';
  document.getElementById('secao-balanco').style.display = aba === 'balanco' ? '' : 'none';
  document.getElementById('aba-semanal').classList.toggle('aba-ativa', aba === 'semanal');
  document.getElementById('aba-balanco').classList.toggle('aba-ativa', aba === 'balanco');
}

// dados: o que o gate acabou de JSON.parse -- {registros, baseline}. Guarda o
// baseline à parte e devolve só o array de registros, que é o que o gate (e
// montarDashboard) espera em window.__REGISTROS__.
function fecharTendenciaVigente(dados) {
  window.__BASELINE__ = dados && dados.baseline;
  return dados && dados.registros ? dados.registros : dados;
}

function montarDashboard(registros) {
  montarTodosFiltrosMulti(registros);
  configurarAberturaFiltrosMulti();
  document.getElementById('corpo-tabela').innerHTML = renderCorpoTabela(registros, dimensoesEmOrdem(filtrosSelecionados.dimensao));
  document.getElementById('limpar-filtros').addEventListener('click', limparFiltros);
  document.getElementById('atualizar-dashboard').addEventListener('click', atualizarDadosAoVivo);
  document.getElementById('aba-semanal').addEventListener('click', function () { alternarAba('semanal'); });
  document.getElementById('aba-balanco').addEventListener('click', function () { alternarAba('balanco'); });
  recalcularTabela();
}
`;
```

`montarAbaBalanco` ainda não existe com essa assinatura — é a Task 8. Deixe uma versão provisória que só chama a atual, para a página não quebrar entre as tarefas:

```js
function montarAbaBalanco(registros, indices) {
  document.getElementById('secao-balanco').innerHTML = RenderAbaBalanco.renderAbaBalanco(registros, indices, {
    periodo: ESTADO_BALANCO.periodo, base: ESTADO_BALANCO.base, dimensao: 'financeiro',
    somenteAtivos: ESTADO_BALANCO.somenteAtivos,
    vigenteIdx: window.__VIGENTE_IDX__, baseline: window.__BASELINE__,
  });
}
```

- [ ] **Step 6: Atualizar o comentário do topo do arquivo**

O comentário atual diz que `markupFiltros()` "continua NÃO entrando aqui" e que a dimensão é fixa. Isso deixou de ser verdade — reescreva-o descrevendo o estado novo e o contrato de globais, e apague a constante `DIMENSAO_PADRAO_SEMANAL`, que não é mais usada.

- [ ] **Step 7: Rodar e confirmar que passa**

Run: `node --test test/semanal-render-semanal-wireup.test.js`
Expected: PASS

- [ ] **Step 8: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS (o golden do orçamento inclusive)

- [ ] **Step 9: Commitar**

```bash
git add tools/semanal/render-semanal.js test/semanal-render-semanal-wireup.test.js
git commit -m "Ligar a barra de filtros do orçamento na página semanal"
```

---

### Task 8: Recorte e dimensão compartilhados na aba Balanço de massa

**Files:**
- Modify: `tools/semanal/render-aba-balanco.js`
- Modify: `tools/semanal/render-semanal.js`
- Test: `test/semanal-render-aba-balanco.test.js`

**Interfaces:**
- Consumes: Task 7.
- Produces: `tools/semanal/render-aba-balanco.js` → acrescenta `{ DIMENSOES_SUPORTADAS_BALANCO, escolherDimensaoBalanco }`
  - `escolherDimensaoBalanco(dimensoesMarcadas: string[]) -> { dimensao: string, substituida: boolean }`

- [ ] **Step 1: Escrever os testes (falhando)**

Acrescentar a `test/semanal-render-aba-balanco.test.js`:

```js
const { escolherDimensaoBalanco, renderControles, renderAbaBalanco } = require('../tools/semanal/render-aba-balanco.js');

// compute-balanco.js lê registro[base][dimensao] como array mensal. Isso
// existe para financeiro/volume/equipes, mas produtividade e ticketMedio são
// DERIVADAS -- nunca guardadas no registro. Desenhar zeros em silêncio para
// elas seria o pior desfecho possível.
test('escolherDimensaoBalanco aceita as dimensões que existem no registro', () => {
  assert.deepStrictEqual(escolherDimensaoBalanco(['financeiro']), { dimensao: 'financeiro', substituida: false });
  assert.deepStrictEqual(escolherDimensaoBalanco(['volume']), { dimensao: 'volume', substituida: false });
  assert.deepStrictEqual(escolherDimensaoBalanco(['equipes']), { dimensao: 'equipes', substituida: false });
});

test('escolherDimensaoBalanco cai para a primeira suportada e avisa', () => {
  assert.deepStrictEqual(escolherDimensaoBalanco(['produtividade']), { dimensao: 'financeiro', substituida: true });
  assert.deepStrictEqual(escolherDimensaoBalanco(['ticketMedio']), { dimensao: 'financeiro', substituida: true });
  assert.deepStrictEqual(escolherDimensaoBalanco(['produtividade', 'volume']), { dimensao: 'volume', substituida: true });
  assert.deepStrictEqual(escolherDimensaoBalanco([]), { dimensao: 'financeiro', substituida: true });
});

test('os controles perderam o select de dimensão', () => {
  const html = renderControles({});
  assert.ok(!html.includes('balanco-dimensao'));
  assert.ok(html.includes('balanco-periodo'));
  assert.ok(html.includes('balanco-base'));
  assert.ok(html.includes('balanco-somente-ativos'));
});

test('a aba avisa quando a dimensão marcada não é suportada', () => {
  const comAviso = renderAbaBalanco([], [], { dimensao: 'financeiro', substituida: true, vigenteIdx: 0, baseline: [] });
  assert.ok(comAviso.includes('nota-balanco-dimensao'));
  assert.ok(comAviso.includes('Financeiro'));
  const semAviso = renderAbaBalanco([], [], { dimensao: 'financeiro', substituida: false, vigenteIdx: 0, baseline: [] });
  assert.ok(!semAviso.includes('nota-balanco-dimensao'));
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-render-aba-balanco.test.js`
Expected: FAIL — `escolherDimensaoBalanco is not a function`

- [ ] **Step 3: Implementar em `render-aba-balanco.js`**

```js
// compute-balanco.js lê registro[base][dimensao] como array mensal de 12
// posições. Isso existe para estas três; produtividade e ticketMedio são
// DERIVADAS (razões calculadas na hora por calcularMensal), nunca guardadas
// no registro -- pedi-las aqui devolveria undefined e desenharia barras de
// comprimento zero, indistinguível de "não houve desvio".
var DIMENSOES_SUPORTADAS_BALANCO = ['equipes', 'volume', 'financeiro'];

// Recebe as dimensões marcadas na barra compartilhada (em ordem canônica) e
// devolve qual delas a aba consegue desenhar. 'substituida' liga a nota que
// explica a troca -- silêncio aqui seria mentir sobre o que o gráfico mostra.
function escolherDimensaoBalanco(dimensoesMarcadas) {
  var lista = dimensoesMarcadas || [];
  for (var i = 0; i < lista.length; i++) {
    if (DIMENSOES_SUPORTADAS_BALANCO.indexOf(lista[i]) !== -1) {
      return { dimensao: lista[i], substituida: i !== 0 };
    }
  }
  return { dimensao: 'financeiro', substituida: true };
}
```

Em `renderControles`, apagar o bloco do `<label class="controle-balanco">Dimensão…</label>` e o parâmetro `dimensao`.

Em `renderAbaBalanco`, acrescentar a nota quando `opts.substituida`:

```js
var ROTULO_DIMENSAO_BALANCO = { equipes: 'Equipes', volume: 'Volumetria', financeiro: 'Financeiro' };

// ... dentro de renderAbaBalanco, antes do return:
var nota = opts.substituida
  ? '<div id="nota-balanco-dimensao" class="nota-premissa">O Balanço de massa é desenhado a partir dos valores mensais guardados em cada contrato, que existem para Equipes, Volumetria e Financeiro. Produtividade e Ticket médio são razões calculadas na hora e não têm série própria — esta aba está mostrando <strong>' + escapeHtml(ROTULO_DIMENSAO_BALANCO[dimensao]) + '</strong>.</div>'
  : '';

return renderControles({ periodo: periodo, base: base, somenteAtivos: somenteAtivos })
  + nota
  + '<div class="graficos-balanco">' + graficos + '</div>';
```

Acrescentar `escolherDimensaoBalanco` e `DIMENSOES_SUPORTADAS_BALANCO` ao `module.exports`.

- [ ] **Step 4: Ligar em `render-semanal.js`**

Substituir a `montarAbaBalanco` provisória da Task 7 pela definitiva:

```js
// Redesenha #secao-balanco inteira com o recorte e a dimensão atuais, e
// religa os 3 controles locais -- eles são recriados a cada innerHTML novo
// (renderControles), então os listeners da renderização anterior morreram
// junto com os elementos antigos e precisam ser religados toda vez.
function montarAbaBalanco(registros, indices) {
  var escolha = RenderAbaBalanco.escolherDimensaoBalanco(dimensoesEmOrdem(filtrosSelecionados.dimensao));
  document.getElementById('secao-balanco').innerHTML = RenderAbaBalanco.renderAbaBalanco(registros, indices, {
    periodo: ESTADO_BALANCO.periodo,
    base: ESTADO_BALANCO.base,
    dimensao: escolha.dimensao,
    substituida: escolha.substituida,
    somenteAtivos: ESTADO_BALANCO.somenteAtivos,
    vigenteIdx: window.__VIGENTE_IDX__,
    baseline: window.__BASELINE__,
  });

  document.getElementById('balanco-periodo').addEventListener('change', function (e) {
    ESTADO_BALANCO.periodo = e.target.value;
    montarAbaBalanco(registros, indices);
  });
  document.getElementById('balanco-base').addEventListener('change', function (e) {
    ESTADO_BALANCO.base = e.target.value;
    montarAbaBalanco(registros, indices);
  });
  document.getElementById('balanco-somente-ativos').addEventListener('change', function (e) {
    ESTADO_BALANCO.somenteAtivos = e.target.checked;
    montarAbaBalanco(registros, indices);
  });
}
```

**Não mexa em `CSS_BALANCO`.** `balanco-periodo` e `balanco-base` continuam sendo `<select>`, então `.controle-balanco select` e suas variantes `:hover`/`:focus-visible` seguem em uso. Só o terceiro select saiu.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS. `semanal-render-aba-balanco-wireup.test.js` pode precisar de ajuste na assinatura — atualize-o se falhar.

- [ ] **Step 6: Commitar**

```bash
git add tools/semanal/render-aba-balanco.js tools/semanal/render-semanal.js test/
git commit -m "Aplicar o recorte e a dimensão compartilhados na aba Balanço de massa"
```

---

### Task 9: Logo, marca d'água e carimbo "Gerado em"

Fecha a pendência registrada em `CLAUDE.md`: sem o carimbo não dá para verificar um deploy pelo conteúdo — a verificação que o incidente de 2026-07-22 tornou obrigatória.

**Files:**
- Modify: `tools/semanal/build-dashboard.js`
- Modify: `tools/semanal/render-semanal.js`
- Test: `test/semanal-build-dashboard.test.js`, `test/semanal-render-semanal-wireup.test.js`

**Interfaces:**
- Consumes: Task 7.
- Produces: `renderSemanal({ registros, baseline, periodos, senha, geradoEm, logoDataUri, iconDataUri })` — os dois novos são opcionais e caem para `''` quando ausentes.

- [ ] **Step 1: Escrever os testes (falhando)**

Acrescentar a `test/semanal-render-semanal-wireup.test.js`:

```js
// Sem o carimbo não dá para confirmar um deploy pelo conteúdo -- que é
// exatamente a verificação exigida pelo CLAUDE.md do projeto depois de o
// build do Pages ter reportado "built" servindo um HTML de dois commits antes.
test('a página carimba a data de geração', () => {
  const pagina = renderSemanal({
    registros: [], baseline: [], periodos: PERIODOS,
    senha: 'senha-de-teste', geradoEm: new Date(Date.UTC(2026, 6, 29, 15, 0)),
  });
  assert.ok(/Gerado em \d{2}\/\d{2}\/\d{4}/.test(pagina), 'faltou o carimbo "Gerado em"');
});

test('logo e marca d\'água entram quando fornecidos e somem quando não', () => {
  const base = { registros: [], baseline: [], periodos: PERIODOS, senha: 's', geradoEm: new Date(Date.UTC(2026, 6, 29)) };
  const com = renderSemanal({ ...base, logoDataUri: 'data:image/png;base64,AAA', iconDataUri: 'data:image/png;base64,BBB' });
  assert.ok(com.includes('src="data:image/png;base64,AAA"'));
  assert.ok(com.includes('class="watermark"'));
  const sem = renderSemanal(base);
  assert.ok(!sem.includes('class="watermark"'));
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-render-semanal-wireup.test.js`
Expected: FAIL

- [ ] **Step 3: Implementar em `render-semanal.js`**

Na assinatura: `function renderSemanal({ registros, baseline, periodos, senha, geradoEm, logoDataUri, iconDataUri })`.

```js
const logoImg = logoDataUri ? `<img src="${logoDataUri}" alt="Suporte Infra">` : '';
const watermarkImg = iconDataUri ? `<img class="watermark" src="${iconDataUri}" alt="">` : '';
```

No markup, `${watermarkImg}` logo depois de `<body>`, e o cabeçalho vira:

```js
${markupCabecalho({
    titulo: 'Planejamento Semanal',
    subtitulo: `${escapeHtml(formatarMesAno(geradoEm))} · Gerado em ${escapeHtml(geradoEm.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))}`,
    logo: logoImg,
    recuo: '  ',
  })}
```

- [ ] **Step 4: Carregar os assets em `build-dashboard.js`**

`loadDataUri` existe em `tools/orcamento/build-dashboard.js:60` mas **não é exportada** — e importar dali arrastaria junto o `build()` do orçamento, que este arquivo não deve executar. São 5 linhas: duplique.

Acrescentar a `tools/semanal/build-dashboard.js`, junto dos outros requires (`path` e `fs` já estão importados):

```js
// Mesmos assets do orçamento -- os dois dashboards deste repositório
// compartilham a identidade visual. Duplicado de tools/orcamento/build-dashboard.js
// (5 linhas) em vez de importado de lá: aquele módulo exporta build(), que
// constrói o dashboard do orçamento, e não é isso que queremos disparar aqui.
const LOGO_PATH = path.join(__dirname, '..', '..', 'assets', 'logo-suporte-infra-negativo.png');
const ICON_PATH = path.join(__dirname, '..', '..', 'assets', 'logo-alvo.png');

function loadDataUri(filePath) {
  if (!fs.existsSync(filePath)) return undefined;
  const buf = fs.readFileSync(filePath);
  return `data:image/png;base64,${buf.toString('base64')}`;
}
```

E, na chamada de `renderSemanal` dentro de `build()`:

```js
const html = renderSemanal({
  registros, baseline, periodos, senha, geradoEm: today,
  logoDataUri: loadDataUri(LOGO_PATH), iconDataUri: loadDataUri(ICON_PATH),
});
```

- [ ] **Step 5: Rodar a suíte inteira e commitar**

Run: `node --test test/*.test.js`
Expected: PASS

```bash
git add tools/semanal/build-dashboard.js tools/semanal/render-semanal.js test/
git commit -m "Acrescentar logo, marca d'água e carimbo Gerado em na página semanal"
```

---

### Task 10: Revisão de design do Open Design

**Files:**
- Modify: `tools/semanal/render-semanal.js` (só se a revisão apontar algo que valha)

- [ ] **Step 1: Construir o HTML**

Run: `ORCAMENTO_SENHA='revisao' node tools/semanal/build-dashboard.js`
Expected: `Wrote N bytes to .../dist/planejamento-semanal.html`

Se `G:` não estiver montado, o build falha com `ENOENT` — nesse caso pule esta tarefa inteira e registre por quê no commit da Task 11.

- [ ] **Step 2: Rodar a revisão de design**

Use `mcp__open-design__start_run` com `agent: "claude"`, `skill: "design-review"`, projeto `3b8ae52a-0da9-418c-9ff5-3eb94d0c517f`, apontando para `dist/planejamento-semanal.html`. Espere terminar.

**Se o servidor do Open Design não estiver conectado, siga sem ele** — é o que o `CLAUDE.md` do repositório principal manda fazer. Registre isso e vá para a Task 11.

- [ ] **Step 3: Portar as sugestões que valerem a pena**

**As alterações vão para `tools/semanal/render-semanal.js`, nunca para o HTML pronto.** `dist/planejamento-semanal.html` é gerado — editá-lo direto (inclusive pelo próprio Open Design) não sobrevive à próxima reconstrução.

Descarte sugestões que mexam em `cssBase()`: aquela folha é compartilhada com o orçamento e o golden a trava. Se uma sugestão boa exigir mexer nela, anote-a como trabalho futuro em vez de aplicá-la.

- [ ] **Step 4: Rodar a suíte e commitar (só se houve mudança)**

Run: `node --test test/*.test.js`
Expected: PASS

```bash
git add tools/semanal/render-semanal.js
git commit -m "Incorporar a revisão de design do Open Design na página semanal"
```

---

### Task 11: Construir, verificar e publicar

**Files:**
- Modify: `dist/planejamento-semanal.html`, `docs/planejamento-semanal.html`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Rodar a suíte inteira uma última vez**

Run: `node --test test/*.test.js`
Expected: PASS — **todos**, incluindo `orcamento-html-inalterado.test.js` e `publicacao-docs-sincronizado.test.js`.

Se algum falhar, pare aqui: nada é publicado com teste vermelho.

- [ ] **Step 2: Construir as duas páginas**

```bash
ORCAMENTO_SENHA='<a senha real>' node tools/orcamento/build-dashboard.js
ORCAMENTO_SENHA='<a senha real>' node tools/semanal/build-dashboard.js
```

A senha real é a do dono do projeto — peça se não a tiver. **Nunca escreva o valor em arquivo do repositório.**

- [ ] **Step 3: Copiar para `docs/`**

O Pages serve `/docs`, não `/dist`, e nada copia automaticamente:

```bash
cp dist/orcamento-dashboard.html docs/index.html
cp dist/planejamento-semanal.html docs/planejamento-semanal.html
```

- [ ] **Step 4: Abrir a página no navegador e conferir à mão**

Abra `dist/planejamento-semanal.html`, destrave com a senha e confirme:

1. Os 7 filtros aparecem e abrem.
2. Marcar uma Tipologia estreita a tabela e o TOTAL GERAL vira SUBTOTAL.
3. Marcar uma Categoria remonta a lista de Tipologia (cascata).
4. Trocar a Dimensão remonta a tabela e troca o rótulo da última coluna.
5. Marcar Equipes junto com Financeiro mostra dois blocos por registro e o rótulo "Total / Média".
6. Marcar Produtividade mostra a nota de premissa.
7. A aba Balanço de massa respeita o filtro de SUP.
8. Marcar Ticket médio faz a aba Balanço mostrar a nota de dimensão substituída.
9. "Limpar filtros" volta ao estado inicial.
10. O cabeçalho mostra o logo e o "Gerado em" com a data de hoje.

Anote qualquer item que falhe e corrija antes de commitar.

- [ ] **Step 5: Atualizar o `CLAUDE.md` do projeto**

Em `orcamento-dashboard/CLAUDE.md`, na seção "Pendências conhecidas":

- Apagar o item **"Fase 2 — os filtros"** (entregue).
- Apagar o item **"A página semanal não tem carimbo Gerado em"** (entregue).
- Manter o item de `fecharMes` com semanas parcialmente nulas, acrescentando que Realizado e Tendência continuam nulos por decisão de 2026-07-29 e por quê.
- Acrescentar, na seção do Planejamento Semanal, que a máquina de filtro é compartilhada via `tools/comum/filtros-cliente.js` e que **o contrato de globais livres está documentado no topo desse módulo** — renomear qualquer uma delas quebra a página em produção sem quebrar teste em Node.

- [ ] **Step 6: Commitar e publicar**

```bash
git add dist/ docs/ CLAUDE.md
git commit -m "Publicar a página semanal com os filtros e o layout do orçamento"
git push origin master
```

- [ ] **Step 7: Verificar o deploy pelo conteúdo, não pelo status da API**

Espere o Pages construir, depois:

```bash
curl -s https://amcaccere261283.github.io/orcamento-dashboard/planejamento-semanal.html | grep -o 'Gerado em[^<]*'
```

Expected: a data/hora que bate com o `dist/` recém-construído. **Não confie no status "built" da API de builds** — ele publica o que estiver em `/docs` independentemente de `dist/` ter mudado, e já deu falsa confiança em 2026-07-22. Se o carimbo estiver velho, o `cp` do Step 3 não foi commitado.

Repita para `https://amcaccere261283.github.io/orcamento-dashboard/` (o orçamento).
