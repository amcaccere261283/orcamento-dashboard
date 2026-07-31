# Botão "Atualizar dados" na página semanal — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um botão "Atualizar dados" na página `planejamento-semanal.html`,
que busca CSVs publicados ao vivo (MATRIZ + Avanço Sond) no navegador e
recalcula tudo sem precisar de um novo build/publish.

**Architecture:** Reaproveita o mecanismo já em produção no orçamento (Apps
Script espelha uma planilha viva pra uma Sheet publicada como CSV; o botão
busca esse CSV no navegador e substitui os dados em memória). Estende isso
pras 3 fontes da semanal. A maior parte da lógica de parsing/agregação já
existe como módulos Node puros (`parse-avancos.js`, `parse-lab.js`,
`compute-demandas.js`) e passa a entrar direto no bundle do navegador, sem
reescrita -- só as poucas dependências que esses módulos têm em
`tools/comum/` (fora do diretório do bundle) precisam virar globais
injetadas via o padrão `fonteParaCliente()` já usado por
`tools/comum/calculo-equipes.js`.

**Tech Stack:** Node.js (`node:test`), zero dependências npm, JS puro no
navegador (sem framework), `node:vm` pra testes de wireup.

**Spec:** `docs/superpowers/specs/2026-07-31-semanal-atualizar-dados-design.md`
(leia antes de começar -- explica o "porquê" de cada decisão abaixo).

## Global Constraints

- Nenhuma mudança em `tools/orcamento/render-dashboard.js` (arquivo trancado
  por `test/orcamento-html-inalterado.test.js`, byte-a-byte).
- Nenhuma mudança de comportamento no build estático (`build-dashboard.js`) --
  tudo que este plano adiciona só roda depois do clique no botão, no
  navegador, em memória.
- `window.__BASELINE__` nunca é tocado pelo refresh (ver spec, seção "Estado
  atual") -- nenhuma task deste plano deve mexer nele.
- Todo módulo que ganha `fonteParaCliente()`/`trechosParaCliente()` segue
  EXATAMENTE o padrão de `tools/comum/calculo-equipes.js`: marcadores
  `// <<< INICIO CLIENTE` / `// FIM CLIENTE >>>`, e as DUAS funções de
  extração exportadas com esses nomes exatos.
- `atualizarDadosAoVivoSemanal()` é tudo-ou-nada: nenhum `window.__REGISTROS__`/
  `window.__DEMANDAS__` é sobrescrito antes de TODOS os 3 fetches e todo o
  parsing terminarem com sucesso (ver spec, passo 6 do fluxo do botão).
- Depois de cada task: `node --test test/*.test.js` tem que continuar 100%
  verde antes de commitar.

---

### Task 1: `tools/comum/tipologias-avancos.js` ganha `fonteParaCliente()`

**Files:**
- Modify: `tools/comum/tipologias-avancos.js`
- Test: `test/comum-tipologias-avancos.test.js`

**Interfaces:**
- Produces: `trechosParaCliente()` (array de strings) e `fonteParaCliente()`
  (string) exportados por `tools/comum/tipologias-avancos.js`, avaliáveis
  via `new Function(fonte + 'return {...}')()` produzindo `MAPA_TIPOLOGIAS`,
  `rotularTipologia`, `ORDEM_TIPOLOGIAS`, `SO_QUANDO_ACIONADA` idênticos aos
  exports do módulo Node. Consumida pela Task 9 (semanal injeta isso num
  `<script>`) e usada dentro do bundle por `parse-avancos.js`/
  `compute-demandas.js` (Task 8).

- [ ] **Step 1: Envolver `MAPA_TIPOLOGIAS`, `rotularTipologia`, `ORDEM_TIPOLOGIAS` e `SO_QUANDO_ACIONADA` em marcadores, e acrescentar as duas funções de extração**

Edite `tools/comum/tipologias-avancos.js`: envolva o bloco que vai de
`const MAPA_TIPOLOGIAS = {` até o fim de `rotularTipologia` (a função,
incluindo seu `}` de fechamento) com os marcadores, e o bloco de
`const ORDEM_TIPOLOGIAS = [` até `const SO_QUANDO_ACIONADA = [...]` com
outro par de marcadores (dois blocos separados, igual ao padrão de dois
blocos de `calculo-equipes.js`, porque há um comentário de documentação
extenso entre `rotularTipologia` e `ORDEM_TIPOLOGIAS` que não precisa ir pro
cliente). Ao final do arquivo, acrescente:

```js
function trechosParaCliente() {
  const src = fs.readFileSync(__filename, 'utf8').replace(/\r\n/g, '\n');
  const padrao = /\/\/ <<< INICIO CLIENTE([\s\S]*?)\/\/ FIM CLIENTE >>>/g;
  const trechos = [];
  let achado;
  while ((achado = padrao.exec(src)) !== null) trechos.push(achado[1]);
  return trechos;
}

function fonteParaCliente() {
  return trechosParaCliente().join('');
}

module.exports = { MAPA_TIPOLOGIAS, ORDEM_TIPOLOGIAS, SO_QUANDO_ACIONADA, rotularTipologia, trechosParaCliente, fonteParaCliente };
```

Acrescente `const fs = require('node:fs');` no topo do arquivo (não existia
antes -- o módulo não lia o próprio arquivo até agora).

O arquivo final, com os marcadores no lugar certo, fica assim (as partes
`// ...` abaixo são o conteúdo que já existe hoje, sem mudar o texto em si):

```js
'use strict';
const fs = require('node:fs');

// A aba Avanços do Avanço Sond.xlsx usa 21 rótulos de tipologia; a MATRIZ,
// que manda no resto do dashboard, usa 10. [... comentário existente, sem mudança ...]
// <<< INICIO CLIENTE
const MAPA_TIPOLOGIAS = {
  SP: 'SP',
  ST: 'ST',
  PI: 'PI',
  BL: 'BL',
  SH: 'SH',
  VT: 'VT',
  CPTU: 'CPTu',
  SM: 'SM / SM.F / SR',
  'SM.F': 'SM / SM.F / SR',
  SR: 'SM / SM.F / SR',
  'SM.A': 'SM / SM.F / SR',
  'PZ.SM': 'SM / SM.F / SR',
  INA: 'SM / SM.F / SR',
  'SP.F': 'SP',
  'PZ.SP': 'SP',
  'SEG.A': 'SEG.A',
  'SEG.V': 'SEG.V',
  BQ: 'PI',
  DN: 'SH',
  SN: 'Especiais',
};

// Rótulo fora do mapa LANÇA, de propósito: cair calado em 'Especiais'
// contabilizaria uma tipologia nova no lugar errado por meses sem ninguém
// perceber. Falhar o build é barato -- acrescentar uma linha no mapa acima.
function rotularTipologia(crua) {
  const chave = String(crua === null || crua === undefined ? '' : crua).trim().toUpperCase();
  if (!chave) {
    throw new Error('rotularTipologia recebeu tipologia vazia -- linha sem "Tipo" deve ser descartada em parse-avancos.js, não rotulada.');
  }
  const destino = MAPA_TIPOLOGIAS[chave];
  if (!destino) {
    throw new Error(`Tipologia desconhecida na aba Avanços: "${crua}". Acrescente em MAPA_TIPOLOGIAS (tools/comum/tipologias-avancos.js) decidindo se ela é rótulo próprio ou entra em "Especiais" -- não deixe cair em Especiais por omissão.`);
  }
  return destino;
}
// FIM CLIENTE >>>

// Ordem de exibição: [... comentário existente, sem mudança ...]
// <<< INICIO CLIENTE
const ORDEM_TIPOLOGIAS = [
  'SP', 'SM / SM.F / SR', 'ST', 'PI', 'BL', 'CPTu', 'SH', 'VT', 'LAB.C', 'LAB.E',
  'SEG.A', 'SEG.V', 'Especiais',
];

const SO_QUANDO_ACIONADA = ['SEG.A', 'SEG.V'];
// FIM CLIENTE >>>

function trechosParaCliente() {
  const src = fs.readFileSync(__filename, 'utf8').replace(/\r\n/g, '\n');
  const padrao = /\/\/ <<< INICIO CLIENTE([\s\S]*?)\/\/ FIM CLIENTE >>>/g;
  const trechos = [];
  let achado;
  while ((achado = padrao.exec(src)) !== null) trechos.push(achado[1]);
  return trechos;
}

function fonteParaCliente() {
  return trechosParaCliente().join('');
}

module.exports = { MAPA_TIPOLOGIAS, ORDEM_TIPOLOGIAS, SO_QUANDO_ACIONADA, rotularTipologia, trechosParaCliente, fonteParaCliente };
```

- [ ] **Step 2: Rodar os testes existentes pra confirmar que nada quebrou**

Run: `node --test test/comum-tipologias-avancos.test.js`
Expected: PASS (os testes existentes só chamam `rotularTipologia`/os
exports de dados -- não devem notar a mudança).

- [ ] **Step 3: Escrever os testes novos de `fonteParaCliente()`**

Acrescente a `test/comum-tipologias-avancos.test.js` (siga o padrão de
`test/comum-calculo-equipes.test.js`):

```js
const { fonteParaCliente, trechosParaCliente } = require('../tools/comum/tipologias-avancos.js');

test('o recorte não devolve CR nenhum', () => {
  assert.doesNotMatch(fonteParaCliente(), /\r/);
  trechosParaCliente().forEach((trecho, i) => assert.doesNotMatch(trecho, /\r/, `trecho ${i} tem CR`));
});

test('fonteParaCliente() avalia pros mesmos MAPA_TIPOLOGIAS/rotularTipologia/ORDEM_TIPOLOGIAS/SO_QUANDO_ACIONADA que os exports do Node', () => {
  const fonte = fonteParaCliente();
  const cliente = new Function(`${fonte}
return { MAPA_TIPOLOGIAS: MAPA_TIPOLOGIAS, rotularTipologia: rotularTipologia, ORDEM_TIPOLOGIAS: ORDEM_TIPOLOGIAS, SO_QUANDO_ACIONADA: SO_QUANDO_ACIONADA };`)();

  assert.deepStrictEqual(cliente.MAPA_TIPOLOGIAS, MAPA_TIPOLOGIAS);
  assert.deepStrictEqual(cliente.ORDEM_TIPOLOGIAS, ORDEM_TIPOLOGIAS);
  assert.deepStrictEqual(cliente.SO_QUANDO_ACIONADA, SO_QUANDO_ACIONADA);
  assert.strictEqual(cliente.rotularTipologia('SP.F'), rotularTipologia('SP.F'));
  assert.strictEqual(cliente.rotularTipologia('BQ'), rotularTipologia('BQ'));
  assert.throws(() => cliente.rotularTipologia('ROTULO-INEXISTENTE'), /Tipologia desconhecida/);
});
```

- [ ] **Step 4: Rodar os testes novos**

Run: `node --test test/comum-tipologias-avancos.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/comum/tipologias-avancos.js test/comum-tipologias-avancos.test.js
git commit -m "feat: tipologias-avancos.js ganha fonteParaCliente() pro live-refresh da semanal"
```

---

### Task 2: `tools/comum/tipologias-lab.js` ganha `fonteParaCliente()`

Mesmo tratamento da Task 1, aplicado a `MAPA_TIPO_ENSAIO_LAB` +
`classificarEnsaioLab` (um bloco só, sem o segundo bloco de ORDEM/SO_QUANDO
-- este arquivo não tem equivalente).

**Files:**
- Modify: `tools/comum/tipologias-lab.js`
- Test: `test/comum-tipologias-lab.test.js`

**Interfaces:**
- Produces: `trechosParaCliente()`/`fonteParaCliente()` avaliáveis pra
  `MAPA_TIPO_ENSAIO_LAB`/`classificarEnsaioLab`. Consumida por `parse-lab.js`
  dentro do bundle (Task 8) e injetada no `<script>` da semanal (Task 9).

- [ ] **Step 1: Envolver `MAPA_TIPO_ENSAIO_LAB` e `classificarEnsaioLab` em marcadores, acrescentar `fs`/`trechosParaCliente`/`fonteParaCliente`**

Edite `tools/comum/tipologias-lab.js`: acrescente `const fs = require('node:fs');`
no topo (depois de `'use strict';`); envolva o bloco de
`const MAPA_TIPO_ENSAIO_LAB = {` até o fim de `classificarEnsaioLab` (função
inclusive) com `// <<< INICIO CLIENTE` / `// FIM CLIENTE >>>`; ao final do
arquivo, acrescente as mesmas duas funções de extração da Task 1 (texto
idêntico, só que lendo este `__filename`); mude o `module.exports` final
para:

```js
module.exports = { MAPA_TIPO_ENSAIO_LAB, classificarEnsaioLab, trechosParaCliente, fonteParaCliente };
```

- [ ] **Step 2: Rodar os testes existentes**

Run: `node --test test/comum-tipologias-lab.test.js`
Expected: PASS

- [ ] **Step 3: Escrever os testes novos**

Mesmo padrão da Task 1, Step 3, adaptado:

```js
const { fonteParaCliente, trechosParaCliente } = require('../tools/comum/tipologias-lab.js');

test('o recorte não devolve CR nenhum', () => {
  assert.doesNotMatch(fonteParaCliente(), /\r/);
  trechosParaCliente().forEach((trecho, i) => assert.doesNotMatch(trecho, /\r/, `trecho ${i} tem CR`));
});

test('fonteParaCliente() avalia pros mesmos MAPA_TIPO_ENSAIO_LAB/classificarEnsaioLab que os exports do Node', () => {
  const fonte = fonteParaCliente();
  const cliente = new Function(`${fonte}
return { MAPA_TIPO_ENSAIO_LAB: MAPA_TIPO_ENSAIO_LAB, classificarEnsaioLab: classificarEnsaioLab };`)();

  assert.deepStrictEqual(cliente.MAPA_TIPO_ENSAIO_LAB, MAPA_TIPO_ENSAIO_LAB);
  assert.strictEqual(cliente.classificarEnsaioLab('LL'), classificarEnsaioLab('LL'));
  assert.strictEqual(cliente.classificarEnsaioLab('TRI2.UU'), classificarEnsaioLab('TRI2.UU'));
  assert.throws(() => cliente.classificarEnsaioLab('ENSAIO-INEXISTENTE'), /Tipo de Ensaio desconhecido/);
});
```

- [ ] **Step 4: Rodar os testes novos**

Run: `node --test test/comum-tipologias-lab.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/comum/tipologias-lab.js test/comum-tipologias-lab.test.js
git commit -m "feat: tipologias-lab.js ganha fonteParaCliente() pro live-refresh da semanal"
```

---

### Task 3: `tools/comum/datas.js` ganha `fonteParaCliente()` (só `excelSerialParaData`)

**Files:**
- Modify: `tools/comum/datas.js`
- Test: `test/orcamento-datas.test.js`

**Interfaces:**
- Produces: `trechosParaCliente()`/`fonteParaCliente()` expondo só
  `excelSerialParaData` (não `formatarMesAno`/`calcularVigenteIdx`/`diaEpoch`
  -- nenhum dos três é necessário no cliente pra esta feature: `diaEpoch` já
  tem sua própria duplicada em `compute-semanal.js`, ver Task 5). Consumida
  por `parse-avancos.js`/`parse-lab.js` dentro do bundle (Task 8).

- [ ] **Step 1: Envolver só `excelSerialParaData` em marcadores, acrescentar `fs`/extração**

Edite `tools/comum/datas.js`: acrescente `const fs = require('node:fs');`
logo abaixo de `'use strict';`; envolva SÓ a função `excelSerialParaData`
(as 3 linhas da função, com seu comentário) com os marcadores; ao final,
acrescente as duas funções de extração e atualize o `module.exports`:

```js
'use strict';
const fs = require('node:fs');

// <<< INICIO CLIENTE
// Época do Excel ajustada pro bug histórico de achar que 1900 foi bissexto
// -- serial 25569 = 1970-01-01 UTC, o offset padrão usado por qualquer
// leitor de xlsx real.
function excelSerialParaData(serial) {
  const milissegundos = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(milissegundos);
}
// FIM CLIENTE >>>

const MESES_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function formatarMesAno(data) {
  return `${MESES_PT[data.getUTCMonth()]}/${data.getUTCFullYear()}`;
}

function calcularVigenteIdx(periodos, generatedAt) {
  const anoPeriodos = periodos[0].getUTCFullYear();
  const anoGerado = generatedAt.getUTCFullYear();
  if (anoGerado < anoPeriodos) return -1;
  if (anoGerado > anoPeriodos) return 12;
  return generatedAt.getUTCMonth();
}

function diaEpoch(data) {
  return Math.floor(data.getTime() / 86400000);
}

function trechosParaCliente() {
  const src = fs.readFileSync(__filename, 'utf8').replace(/\r\n/g, '\n');
  const padrao = /\/\/ <<< INICIO CLIENTE([\s\S]*?)\/\/ FIM CLIENTE >>>/g;
  const trechos = [];
  let achado;
  while ((achado = padrao.exec(src)) !== null) trechos.push(achado[1]);
  return trechos;
}

function fonteParaCliente() {
  return trechosParaCliente().join('');
}

module.exports = { excelSerialParaData, formatarMesAno, calcularVigenteIdx, diaEpoch, trechosParaCliente, fonteParaCliente };
```

(Mantenha os comentários já existentes de `formatarMesAno`/`calcularVigenteIdx`/`diaEpoch`, omitidos acima só por brevidade -- não remova nada, só acrescente o bloco marcado e as duas funções novas no fim.)

- [ ] **Step 2: Rodar os testes existentes**

Run: `node --test test/orcamento-datas.test.js`
Expected: PASS

- [ ] **Step 3: Escrever os testes novos**

Acrescente a `test/orcamento-datas.test.js`:

```js
const { fonteParaCliente, trechosParaCliente } = require('../tools/comum/datas.js');

test('o recorte não devolve CR nenhum', () => {
  assert.doesNotMatch(fonteParaCliente(), /\r/);
  trechosParaCliente().forEach((trecho, i) => assert.doesNotMatch(trecho, /\r/, `trecho ${i} tem CR`));
});

test('fonteParaCliente() avalia pro mesmo excelSerialParaData que o export do Node, e NÃO expõe formatarMesAno/calcularVigenteIdx/diaEpoch', () => {
  const fonte = fonteParaCliente();
  assert.doesNotMatch(fonte, /function formatarMesAno/);
  assert.doesNotMatch(fonte, /function calcularVigenteIdx/);
  assert.doesNotMatch(fonte, /function diaEpoch/);

  const cliente = new Function(`${fonte}
return { excelSerialParaData: excelSerialParaData };`)();

  [25569, 46023, 44927].forEach((serial) => {
    assert.deepStrictEqual(cliente.excelSerialParaData(serial), excelSerialParaData(serial));
  });
});
```

- [ ] **Step 4: Rodar os testes novos**

Run: `node --test test/orcamento-datas.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/comum/datas.js test/orcamento-datas.test.js
git commit -m "feat: datas.js ganha fonteParaCliente() (excelSerialParaData) pro live-refresh da semanal"
```

---

### Task 4: `tools/comum/linha-base.js` ganha `fonteParaCliente()` (só `chaveMatriz`)

**Files:**
- Modify: `tools/comum/linha-base.js`
- Test: `test/semanal-linha-base-costura.test.js`

**Interfaces:**
- Produces: `trechosParaCliente()`/`fonteParaCliente()` expondo só
  `chaveMatriz` (não `reconciliarLinhaBase`/`resolverChaveLinhaBase` -- a
  semanal nunca reconcilia linha de base no cliente, ver spec). Consumida
  por `compute-demandas.js` dentro do bundle (Task 5/Task 8).

- [ ] **Step 1: Envolver só `chaveMatriz` em marcadores, acrescentar `fs`/extração**

Edite `tools/comum/linha-base.js`: acrescente `const fs = require('node:fs');`
logo abaixo de `'use strict';`; envolva SÓ a função `chaveMatriz` (as 3
linhas, com seu comentário) com os marcadores; ao final, acrescente as duas
funções de extração e atualize o `module.exports`:

```js
// <<< INICIO CLIENTE
// Chave no espaço da MATRIZ: sup e tipologia CRUS, exatamente como
// parse-matriz.js os entrega. É a MESMA expressão de chaveBaseline em
// tools/semanal/compute-balanco.js -- de propósito: é o formato que o
// cliente recebe e procura.
function chaveMatriz(sup, tipologia) {
  return `${sup}||${tipologia}`;
}
// FIM CLIENTE >>>
```

(o resto do arquivo -- `TIP_MAP_LINHA_BASE`, `SUP_MAP_LINHA_BASE`,
`resolverChaveLinhaBase`, `reconciliarLinhaBase` -- fica de fora dos
marcadores, sem mudança nenhuma.) Acrescente ao final:

```js
function trechosParaCliente() {
  const src = fs.readFileSync(__filename, 'utf8').replace(/\r\n/g, '\n');
  const padrao = /\/\/ <<< INICIO CLIENTE([\s\S]*?)\/\/ FIM CLIENTE >>>/g;
  const trechos = [];
  let achado;
  while ((achado = padrao.exec(src)) !== null) trechos.push(achado[1]);
  return trechos;
}

function fonteParaCliente() {
  return trechosParaCliente().join('');
}
```

E mude o `module.exports` final pra:

```js
module.exports = {
  TIP_MAP_LINHA_BASE, SUP_MAP_LINHA_BASE,
  chaveMatriz, resolverChaveLinhaBase, reconciliarLinhaBase,
  trechosParaCliente, fonteParaCliente,
};
```

- [ ] **Step 2: Rodar os testes existentes**

Run: `node --test test/semanal-linha-base-costura.test.js`
Expected: PASS

- [ ] **Step 3: Escrever os testes novos**

```js
const { fonteParaCliente, trechosParaCliente, chaveMatriz } = require('../tools/comum/linha-base.js');

test('o recorte não devolve CR nenhum', () => {
  assert.doesNotMatch(fonteParaCliente(), /\r/);
  trechosParaCliente().forEach((trecho, i) => assert.doesNotMatch(trecho, /\r/, `trecho ${i} tem CR`));
});

test('fonteParaCliente() avalia pro mesmo chaveMatriz que o export do Node, e NÃO expõe reconciliarLinhaBase', () => {
  const fonte = fonteParaCliente();
  assert.doesNotMatch(fonte, /function reconciliarLinhaBase/);
  assert.doesNotMatch(fonte, /function resolverChaveLinhaBase/);

  const cliente = new Function(`${fonte}
return { chaveMatriz: chaveMatriz };`)();

  assert.strictEqual(cliente.chaveMatriz('SUP-0001-24', 'SP'), chaveMatriz('SUP-0001-24', 'SP'));
});
```

- [ ] **Step 4: Rodar os testes novos**

Run: `node --test test/semanal-linha-base-costura.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/comum/linha-base.js test/semanal-linha-base-costura.test.js
git commit -m "feat: linha-base.js ganha fonteParaCliente() (chaveMatriz) pro live-refresh da semanal"
```

---

### Task 5: `compute-demandas.js` passa a ler `diaEpoch` de `./compute-semanal.js` e ganha `redirecionarSupsDesconhecidos`

**Files:**
- Modify: `tools/semanal/compute-demandas.js`
- Test: `test/semanal-compute-demandas.test.js` (se não existir, criar; confira antes com `ls test/ | grep compute-demandas`)

**Interfaces:**
- Consumes: `diaEpoch` de `./compute-semanal.js` (já exportado, ver
  `tools/semanal/compute-semanal.js:108`); `chaveMatriz` de
  `../comum/linha-base.js` (já importado, sem mudança).
- Produces: `redirecionarSupsDesconhecidos(itens, registros) -> { itens, redirecionados }`
  agora exportada por `compute-demandas.js` (mesma assinatura e
  comportamento que tinha em `build-dashboard.js`). Consumida pela Task 6
  (build-dashboard.js volta a importar de lá) e pela Task 11
  (`atualizarDadosAoVivoSemanal()`, dentro do bundle).

- [ ] **Step 1: Trocar a origem de `diaEpoch`**

Em `tools/semanal/compute-demandas.js`, troque:

```js
const { diaEpoch } = require('../comum/datas.js');
```

por:

```js
const { diaEpoch } = require('./compute-semanal.js');
```

(mesma função, mesmo comportamento -- só muda de onde vem; ver o comentário
em `tools/comum/datas.js` sobre as duas serem deliberadamente idênticas.
Atualize também o comentário da linha 8-9 do arquivo, que hoje diz "Por isso
o require '../comum/' acima é seguro aqui: este módulo não entra no
bundle" -- isso deixa de ser verdade a partir da Task 8; troque por uma nota
apontando pra este plano/spec.)

- [ ] **Step 2: Mover `redirecionarSupsDesconhecidos` de `build-dashboard.js` pra cá**

Acrescente em `tools/semanal/compute-demandas.js`, antes do
`module.exports` final:

```js
// Furo/ensaio cuja combinação (sup, tipologia) não existe como registro na
// MATRIZ não tem "onde" contar -- ficaria fora do Realizado/Demandas
// Pendentes da Tabela Semanal em silêncio, mesmo sendo trabalho real. A
// MATRIZ sempre tem um registro "Diversos" com Previsto próprio pra cada
// uma das suas 10 tipologias -- SUP não cadastrado SEMPRE redireciona pra
// Diversos, sem exceção, em vez de ser descartado. Função pura e agnóstica
// ao tipo de item (funciona pra ensaios de laboratório E furos de
// Sondagem/Avanços -- os dois só precisam de 'sup'/'tipologia'). Movida de
// build-dashboard.js pra cá: usa chaveMatriz, que só é seguro chamar aqui
// dentro (módulo dual Node/navegador) -- ver
// docs/superpowers/specs/2026-07-31-semanal-atualizar-dados-design.md.
function redirecionarSupsDesconhecidos(itens, registros) {
  const chavesConhecidas = new Set(registros.map(r => chaveMatriz(r.sup, r.tipologia)));
  let redirecionados = 0;
  const saida = itens.map(item => {
    if (chavesConhecidas.has(chaveMatriz(item.sup, item.tipologia))) return item;
    redirecionados++;
    return Object.assign({}, item, { sup: 'Diversos' });
  });
  return { itens: saida, redirecionados };
}
```

Mude o `module.exports` final pra:

```js
module.exports = { computeDemandas, reconciliarSups, redirecionarSupsDesconhecidos, SERIES, SERIE_ESTOQUE };
```

- [ ] **Step 3: Rodar os testes existentes de compute-demandas e de build-dashboard**

Run: `node --test test/semanal-build-dashboard.test.js`
Expected: FAIL -- `redirecionarSupsDesconhecidos` não é mais exportado por
`build-dashboard.js` (vamos corrigir isso na Task 6, de propósito nesta
ordem: prova que o teste realmente exercitava o import antigo).

- [ ] **Step 4: Commit (intermediário -- a Task 6 conserta o teste que quebrou)**

```bash
git add tools/semanal/compute-demandas.js
git commit -m "refactor: move redirecionarSupsDesconhecidos pra compute-demandas.js, diaEpoch via compute-semanal.js"
```

---

### Task 6: `build-dashboard.js` volta a importar `redirecionarSupsDesconhecidos` (de `compute-demandas.js`)

**Files:**
- Modify: `tools/semanal/build-dashboard.js`

**Interfaces:**
- Consumes: `redirecionarSupsDesconhecidos` de `./compute-demandas.js`
  (produzida pela Task 5).

- [ ] **Step 1: Remover a definição local, importar de compute-demandas.js**

Em `tools/semanal/build-dashboard.js`:

1. Remova a função `redirecionarSupsDesconhecidos` inteira (linhas 60-93 no
   arquivo atual, do comentário grande até o `}` de fechamento).
2. Troque a linha `const { computeDemandas, reconciliarSups } = require('./compute-demandas.js');`
   por `const { computeDemandas, reconciliarSups, redirecionarSupsDesconhecidos } = require('./compute-demandas.js');`.
3. `module.exports` no fim do arquivo continua `{ build, baselineParaCliente, redirecionarSupsDesconhecidos }`
   (mesmo texto de antes -- agora reexporta em vez de definir).

- [ ] **Step 2: Rodar os testes**

Run: `node --test test/semanal-build-dashboard.test.js`
Expected: PASS (o import em `test/semanal-build-dashboard.test.js` continua
`require('../tools/semanal/build-dashboard.js')` sem mudança nenhuma --
`build-dashboard.js` reexporta o mesmo nome).

Run: `node --test test/*.test.js`
Expected: PASS (suíte inteira verde de novo).

- [ ] **Step 3: Commit**

```bash
git add tools/semanal/build-dashboard.js
git commit -m "refactor: build-dashboard.js importa redirecionarSupsDesconhecidos de compute-demandas.js"
```

---

### Task 7: Novo `tools/semanal/parse-matriz-cliente.js` (parsing de CSV + MATRIZ, só navegador)

Réplica, isolada pra semanal, do parsing de CSV/MATRIZ que já existe em
`tools/orcamento/render-dashboard.js` (linhas 1552-1746) -- ver spec, seção
"Parsing do CSV da MATRIZ". Ao contrário do original (texto solto dentro de
um template literal), este é um módulo Node de verdade, testável
isoladamente, e SEM NENHUM `require` (auto-suficiente, mesmo padrão de
`tools/semanal/compute-semanal.js`) -- por isso entra no bundle sem
depender de nenhum `fonteParaCliente()`.

**Files:**
- Create: `tools/semanal/parse-matriz-cliente.js`
- Test: `test/semanal-parse-matriz-cliente.test.js`

**Interfaces:**
- Produces: `parseCsvGrid(texto) -> string[][]`; `numeroPtBr(valor) -> number|null`;
  `celulaTexto(v) -> string|null`; `locateColumnsMatrizCliente(headerRow) -> columns`;
  `extrairValoresLinhaMatrizCliente(row, columns) -> {equipes, equipesResumo, volume, volumeResumo, financeiro, financeiroResumo}`;
  `parseMatrizCliente(grid) -> registro[]` (mesma forma de registro que
  `tools/orcamento/parse-matriz.js` produz). Consumida pela Task 8 (entra no
  bundle) e pela Task 11 (`atualizarDadosAoVivoSemanal()` chama
  `parseMatrizCliente`/`parseCsvGrid` diretamente).

- [ ] **Step 1: Escrever o módulo**

Crie `tools/semanal/parse-matriz-cliente.js`:

```js
'use strict';

// Réplica em JS, só pra semanal, do parsing de CSV/MATRIZ que
// tools/orcamento/render-dashboard.js já tem embutido no próprio JS de
// cliente (linhas 1552-1746) -- não um require cruzado, porque aquele texto
// vive dentro de um template literal, não de um módulo Node de verdade, e
// porque tocar em render-dashboard.js quebraria o golden byte-a-byte do
// orçamento (test/orcamento-html-inalterado.test.js). Dívida consciente,
// registrada em docs/superpowers/specs/2026-07-31-semanal-atualizar-dados-design.md
// ("Parsing do CSV da MATRIZ") -- se um dia parse-matriz.js ganhar
// fonteParaCliente(), troque esta réplica pela injeção.
//
// SEM NENHUM require de propósito: entra no bundle do navegador
// (buildBrowserBundle) sem precisar de nenhuma injeção de fonteParaCliente(),
// mesmo padrão de compute-semanal.js.

// Parser CSV RFC4180 simples (aspas duplas escapam aspas, vírgula/quebra de
// linha dentro de aspas não terminam o campo) -- suficiente pro que o
// Google Sheets exporta.
function parseCsvGrid(texto) {
  var linhas = [];
  var linha = [];
  var campo = '';
  var dentroAspas = false;
  for (var i = 0; i < texto.length; i++) {
    var c = texto[i];
    if (dentroAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; }
        else dentroAspas = false;
      } else {
        campo += c;
      }
    } else if (c === '"') {
      dentroAspas = true;
    } else if (c === ',') {
      linha.push(campo); campo = '';
    } else if (c === '\r') {
      // ignora -- o \n logo em seguida já fecha a linha
    } else if (c === '\n') {
      linha.push(campo); campo = '';
      linhas.push(linha); linha = [];
    } else {
      campo += c;
    }
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

// Converte uma célula do CSV pra número, ou null. Trata string vazia, erro
// de fórmula (#NAME?/#REF!/#VALUE!/#N/A) e "n/a" como "sem dado" -- nunca
// como 0.
function numeroPtBr(valor) {
  if (valor === undefined || valor === null) return null;
  var texto = String(valor).trim();
  if (texto === '' || texto.charAt(0) === '#' || texto.toLowerCase() === 'n/a') return null;
  var numero = parseFloat(texto.replace(/\./g, '').replace(',', '.'));
  return isNaN(numero) ? null : numero;
}

function celulaTexto(v) {
  var t = (v === undefined || v === null) ? '' : String(v).trim();
  return t === '' ? null : t;
}

// Réplica em JS de parse-matriz.js (locateColumns) -- acha cada coluna pelo
// próprio rótulo da linha de cabeçalho, nunca por posição fixa. Lançar erro
// cedo aqui evita ler dado desalinhado em silêncio se a Sheet espelho mudar
// de forma.
function acharColunaMatrizCliente(headerRow, rotulo) {
  for (var col = 0; col < headerRow.length; col++) {
    if (String(headerRow[col] || '').trim() === rotulo) return col;
  }
  throw new Error('Coluna "' + rotulo + '" não encontrada no cabeçalho do espelho ao vivo da MATRIZ');
}
function proximasNColunasMatrizCliente(colunaAncora, quantidade) {
  var cols = [];
  for (var i = 0; i < quantidade; i++) cols.push(colunaAncora + 1 + i);
  return cols;
}
function exigirRotuloMatrizCliente(headerRow, col, esperado) {
  var encontrado = String(headerRow[col] || '').trim();
  if (encontrado !== esperado) {
    throw new Error('Esperava a coluna "' + esperado + '" na posição ' + col + ' do espelho ao vivo da MATRIZ, encontrei "' + encontrado + '" -- a forma da planilha pode ter mudado');
  }
}
function locateColumnsMatrizCliente(headerRow) {
  var origem = acharColunaMatrizCliente(headerRow, 'ORIGEM');
  var grupo = acharColunaMatrizCliente(headerRow, 'GRUPO');
  var tomador = acharColunaMatrizCliente(headerRow, 'TOMADOR');
  var sup = acharColunaMatrizCliente(headerRow, 'SUP');
  var escopo = acharColunaMatrizCliente(headerRow, 'ESCOPO');
  var apoio = acharColunaMatrizCliente(headerRow, 'APOIO');
  var inicio = acharColunaMatrizCliente(headerRow, 'INICIO');
  var termino = acharColunaMatrizCliente(headerRow, 'TERMINO');
  var sondagem = acharColunaMatrizCliente(headerRow, 'SONDAGEM');
  var base = acharColunaMatrizCliente(headerRow, 'BASE');

  var equipesMeses = proximasNColunasMatrizCliente(base, 12);
  var pico = equipesMeses[11] + 1;
  exigirRotuloMatrizCliente(headerRow, pico, 'PICO');
  var media = pico + 1;
  exigirRotuloMatrizCliente(headerRow, media, 'MÉDIA');
  var prod = media + 1;
  exigirRotuloMatrizCliente(headerRow, prod, 'PROD.');
  var dias = prod + 1;
  exigirRotuloMatrizCliente(headerRow, dias, 'DIAS');

  var volumeMeses = proximasNColunasMatrizCliente(dias, 12);
  var volumeTotal = volumeMeses[11] + 1;
  exigirRotuloMatrizCliente(headerRow, volumeTotal, 'TOTAL');
  var volumeTotalInicial = volumeTotal + 1;
  var ticket = volumeTotalInicial + 1;
  exigirRotuloMatrizCliente(headerRow, ticket, 'TICKET');

  var financeiroMeses = proximasNColunasMatrizCliente(ticket, 12);
  var financeiroTotal = financeiroMeses[11] + 1;
  exigirRotuloMatrizCliente(headerRow, financeiroTotal, 'TOTAL');
  var financeiroTotalInicial = financeiroTotal + 1;

  return {
    origem: origem, grupo: grupo, tomador: tomador, sup: sup, escopo: escopo, apoio: apoio,
    inicio: inicio, termino: termino, sondagem: sondagem, base: base,
    equipesMeses: equipesMeses, equipesResumo: { pico: pico, media: media, prod: prod, dias: dias },
    volumeMeses: volumeMeses, volumeResumo: { total: volumeTotal, totalInicial: volumeTotalInicial, ticket: ticket },
    financeiroMeses: financeiroMeses, financeiroResumo: { total: financeiroTotal, totalInicial: financeiroTotalInicial },
    observacao: financeiroTotalInicial + 1,
  };
}

function extrairValoresLinhaMatrizCliente(row, columns) {
  return {
    equipes: columns.equipesMeses.map(function (col) { return numeroPtBr(row[col]); }),
    equipesResumo: {
      pico: numeroPtBr(row[columns.equipesResumo.pico]) || 0,
      media: numeroPtBr(row[columns.equipesResumo.media]) || 0,
      prod: numeroPtBr(row[columns.equipesResumo.prod]) || 0,
      dias: numeroPtBr(row[columns.equipesResumo.dias]) || 0,
    },
    volume: columns.volumeMeses.map(function (col) { return numeroPtBr(row[col]); }),
    volumeResumo: {
      total: numeroPtBr(row[columns.volumeResumo.total]) || 0,
      totalInicial: numeroPtBr(row[columns.volumeResumo.totalInicial]) || 0,
      ticket: numeroPtBr(row[columns.volumeResumo.ticket]) || 0,
    },
    financeiro: columns.financeiroMeses.map(function (col) { return numeroPtBr(row[col]); }),
    financeiroResumo: {
      total: numeroPtBr(row[columns.financeiroResumo.total]) || 0,
      totalInicial: numeroPtBr(row[columns.financeiroResumo.totalInicial]) || 0,
    },
  };
}

var TIPOLOGIAS_RESUMO_MATRIZ_CLIENTE = { MENSAL: true, ACUMULADO: true };
function deveIncluirMatrizCliente(registro) {
  if (!registro.grupo || registro.grupo === 'Todos') return false;
  if (!registro.tipologia || TIPOLOGIAS_RESUMO_MATRIZ_CLIENTE[registro.tipologia]) return false;
  return true;
}

// Réplica em JS de parse-matriz.js (parseMatriz) -- mesmo esquema de 3
// linhas físicas por combinação (contrato, tipologia) identificadas pela
// coluna BASE (P/R/T) e preenchimento "sticky" dos campos identificadores.
// grid[0] é o cabeçalho (a exportação CSV não tem a linha 0 vazia que o
// .xlsx real tem antes da linha 1).
function parseMatrizCliente(grid) {
  var columns = locateColumnsMatrizCliente(grid[0]);
  var registros = [];
  var estado = {
    origem: null, grupo: null, tomador: null, sup: null, escopo: null,
    apoio: null, inicio: null, termino: null, tipologia: null,
  };
  var atual = null;

  for (var rowNum = 1; rowNum < grid.length; rowNum++) {
    var row = grid[rowNum];
    if (!row) continue;
    var base = celulaTexto(row[columns.base]);
    if (base === null) continue;

    estado.origem = celulaTexto(row[columns.origem]) || estado.origem;
    estado.grupo = celulaTexto(row[columns.grupo]) || estado.grupo;
    estado.tomador = celulaTexto(row[columns.tomador]) || estado.tomador;
    estado.sup = celulaTexto(row[columns.sup]) || estado.sup;
    estado.escopo = celulaTexto(row[columns.escopo]) || estado.escopo;
    estado.apoio = celulaTexto(row[columns.apoio]) || estado.apoio;
    estado.inicio = celulaTexto(row[columns.inicio]) || estado.inicio;
    estado.termino = celulaTexto(row[columns.termino]) || estado.termino;
    estado.tipologia = celulaTexto(row[columns.sondagem]) || estado.tipologia;

    if (base === 'P') {
      atual = {
        origem: estado.origem, grupo: estado.grupo, tomador: estado.tomador, sup: estado.sup,
        escopo: estado.escopo, apoio: estado.apoio, inicio: estado.inicio, termino: estado.termino,
        tipologia: estado.tipologia, observacao: null,
        previsto: extrairValoresLinhaMatrizCliente(row, columns), realizado: null, total: null,
      };
    } else if (base === 'R' && atual) {
      atual.realizado = extrairValoresLinhaMatrizCliente(row, columns);
    } else if (base === 'T' && atual) {
      atual.total = extrairValoresLinhaMatrizCliente(row, columns);
      atual.observacao = celulaTexto(row[columns.observacao]);
      if (deveIncluirMatrizCliente(atual)) registros.push(atual);
      atual = null;
    }
  }
  return registros;
}

module.exports = {
  parseCsvGrid, numeroPtBr, celulaTexto,
  locateColumnsMatrizCliente, extrairValoresLinhaMatrizCliente, parseMatrizCliente,
};
```

- [ ] **Step 2: Escrever os testes**

Crie `test/semanal-parse-matriz-cliente.test.js` (siga o padrão dos testes
de `parseCsvGrid`/`parseMatrizClient` em `test/orcamento-render-dashboard.test.js`,
linhas 1236-1310, adaptado pra chamar o módulo diretamente em vez de
extrair de HTML via vm.Context):

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  parseCsvGrid, numeroPtBr, celulaTexto, parseMatrizCliente,
} = require('../tools/semanal/parse-matriz-cliente.js');

test('parseCsvGrid separa uma linha simples em campos, e mantém vírgula dentro de aspas sem quebrar o campo', () => {
  const grid = parseCsvGrid('a,b,c\n"1,5",d,"has ""quotes"" inside"\n');
  assert.deepStrictEqual(grid, [['a', 'b', 'c'], ['1,5', 'd', 'has "quotes" inside']]);
});

test('parseCsvGrid trata \\r\\n e a última linha sem quebra final', () => {
  const grid = parseCsvGrid('a,b\r\nc,d');
  assert.deepStrictEqual(grid, [['a', 'b'], ['c', 'd']]);
});

test('numeroPtBr converte formato pt-BR (milhar com ponto, decimal com vírgula) e trata erro de fórmula/vazio/n-a como null, nunca 0', () => {
  assert.strictEqual(numeroPtBr('1.234,5'), 1234.5);
  assert.strictEqual(numeroPtBr(''), null);
  assert.strictEqual(numeroPtBr('#REF!'), null);
  assert.strictEqual(numeroPtBr('n/a'), null);
  assert.strictEqual(numeroPtBr(undefined), null);
  assert.strictEqual(numeroPtBr('0'), 0);
});

test('celulaTexto normaliza string vazia/whitespace pra null', () => {
  assert.strictEqual(celulaTexto('  '), null);
  assert.strictEqual(celulaTexto(''), null);
  assert.strictEqual(celulaTexto('SUP-0001-24'), 'SUP-0001-24');
});

// Grid sintético no formato real do espelho ao vivo -- cabeçalho + um trio
// P/R/T pra um único registro, com TICKET preenchido (é o dado que motivou
// esta feature inteira -- ver o pedido do usuário no spec).
function gridMatrizSintetico(ticket) {
  const header = ['ORIGEM', 'GRUPO', 'TOMADOR', 'SUP', 'ESCOPO', 'APOIO', 'INICIO', 'TERMINO', 'SONDAGEM', 'BASE',
    ...Array(12).fill('mes'), 'PICO', 'MÉDIA', 'PROD.', 'DIAS',
    ...Array(12).fill('mes'), 'TOTAL', 'TOTAL INICIAL', 'TICKET',
    ...Array(12).fill('mes'), 'TOTAL', 'TOTAL INICIAL', 'OBS'];
  const zeros12 = () => Array(12).fill('0');
  const linhaP = ['Origem-A', 'Grupo-A', 'Tomador-A', 'SUP-0001-24', 'Escopo', 'Apoio', '01/2026', '12/2026', 'SP', 'P',
    ...zeros12(), '2', '2', '8', '25',
    ...zeros12(), '100', '100', String(ticket),
    ...zeros12(), '100', '100', ''];
  const linhaR = [...linhaP]; linhaR[9] = 'R';
  const linhaT = [...linhaP]; linhaT[9] = 'T';
  return [header, linhaP, linhaR, linhaT];
}

test('parseMatrizCliente parseia um grid sintético no formato do espelho ao vivo, incluindo TICKET (a coluna que motivou esta feature)', () => {
  const registros = parseMatrizCliente(gridMatrizSintetico(1500));
  assert.strictEqual(registros.length, 1);
  assert.strictEqual(registros[0].sup, 'SUP-0001-24');
  assert.strictEqual(registros[0].tipologia, 'SP');
  assert.strictEqual(registros[0].previsto.volumeResumo.ticket, 1500);
});

test('parseMatrizCliente lança erro claro se a coluna TICKET não existir (planilha mudou de forma)', () => {
  const grid = gridMatrizSintetico(1500);
  grid[0] = grid[0].map((rotulo) => (rotulo === 'TICKET' ? 'OUTRA-COISA' : rotulo));
  assert.throws(() => parseMatrizCliente(grid), /Esperava a coluna "TICKET"/);
});
```

- [ ] **Step 3: Rodar os testes**

Run: `node --test test/semanal-parse-matriz-cliente.test.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tools/semanal/parse-matriz-cliente.js test/semanal-parse-matriz-cliente.test.js
git commit -m "feat: parse-matriz-cliente.js -- parsing de CSV/MATRIZ pro live-refresh da semanal"
```

---

### Task 8: Adicionar os 4 módulos novos ao `BUNDLE_ARQUIVOS` da semanal

**Files:**
- Modify: `tools/semanal/render-semanal.js`

**Interfaces:**
- Consumes: `parse-matriz-cliente.js` (Task 7), `parse-avancos.js`,
  `parse-lab.js`, `compute-demandas.js` (Task 5) -- todos em
  `tools/semanal/`.
- Produces: `MODULOS['parse-matriz-cliente.js']`, `MODULOS['parse-avancos.js']`,
  `MODULOS['parse-lab.js']`, `MODULOS['compute-demandas.js']` disponíveis no
  bundle do navegador. Consumida pela Task 11.

- [ ] **Step 1: Estender `BUNDLE_ARQUIVOS`**

Em `tools/semanal/render-semanal.js`, troque:

```js
const BUNDLE_ARQUIVOS = [
  'compute-semanal.js', 'render-aba-semanal.js',
  'compute-grafico-semanal.js', 'render-aba-grafico-semanal.js',
  'compute-balanco.js', 'render-aba-balanco.js', 'render-aba-demandas.js',
];
```

por:

```js
const BUNDLE_ARQUIVOS = [
  'compute-semanal.js', 'render-aba-semanal.js',
  'compute-grafico-semanal.js', 'render-aba-grafico-semanal.js',
  'compute-balanco.js', 'render-aba-balanco.js', 'render-aba-demandas.js',
  // Os 4 abaixo alimentam o botão "Atualizar dados" (live-refresh) -- ver
  // docs/superpowers/specs/2026-07-31-semanal-atualizar-dados-design.md.
  // parse-matriz-cliente.js não tem require nenhum (auto-suficiente).
  // parse-avancos.js/parse-lab.js/compute-demandas.js têm require('../comum/...')
  // que o bundle REMOVE (ver transformaModulo) -- as funções que sobram
  // undefined (excelSerialParaData, rotularTipologia, classificarEnsaioLab,
  // chaveMatriz) são supridas como globais pelo <script> de fonteParaCliente()
  // logo ANTES deste bundle (ver a Task 9 deste plano). compute-demandas.js
  // também precisa vir DEPOIS de compute-semanal.js na lista -- ele lê
  // diaEpoch de lá agora (require('./compute-semanal.js'), same-dir,
  // resolvido normalmente pelo bundler).
  'parse-matriz-cliente.js', 'parse-avancos.js', 'parse-lab.js', 'compute-demandas.js',
];
```

- [ ] **Step 2: Confirmar que o bundle gerado não deixa `require(` nem `module.exports` sobrando**

Run: `node -e "const {buildBrowserBundle}=require('./tools/comum/browser-bundle.js'); const b=buildBrowserBundle(require('path').join(__dirname,'tools','semanal'), ['compute-semanal.js','render-aba-semanal.js','compute-grafico-semanal.js','render-aba-grafico-semanal.js','compute-balanco.js','render-aba-balanco.js','render-aba-demandas.js','parse-matriz-cliente.js','parse-avancos.js','parse-lab.js','compute-demandas.js']); if(/require\(/.test(b)) throw new Error('sobrou require'); if(/module\.exports/.test(b)) throw new Error('sobrou module.exports'); console.log('OK, ' + b.length + ' bytes');"`

Expected: imprime `OK, <N> bytes`, sem lançar.

- [ ] **Step 3: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: a maior parte PASSA. `test/semanal-render-semanal-wireup.test.js`
e outros testes de wireup que executam o bundle completo num `vm.Context`
PODEM falhar aqui com `ReferenceError: excelSerialParaData is not defined`
(ou `rotularTipologia`/`classificarEnsaioLab`/`chaveMatriz`) -- é esperado
até a Task 9 injetar essas globais. Confirme que a falha É especificamente
esse `ReferenceError` (não outra coisa) antes de seguir pra Task 9.

- [ ] **Step 4: Commit**

```bash
git add tools/semanal/render-semanal.js
git commit -m "feat: adiciona parse-matriz-cliente/parse-avancos/parse-lab/compute-demandas ao bundle da semanal"
```

---

### Task 9: Injetar as 4 `fonteParaCliente()` novas no `<script>` compartilhado

**Files:**
- Modify: `tools/semanal/render-semanal.js`

**Interfaces:**
- Consumes: `fonteParaCliente` de `tools/comum/tipologias-avancos.js` (Task 1),
  `tools/comum/tipologias-lab.js` (Task 2), `tools/comum/datas.js` (Task 3),
  `tools/comum/linha-base.js` (Task 4).
- Produces: `excelSerialParaData`, `rotularTipologia`, `classificarEnsaioLab`,
  `chaveMatriz` disponíveis como globais no navegador, ANTES do bundle (Task
  8) rodar. Resolve o `ReferenceError` da Task 8, Step 3.

- [ ] **Step 1: Importar as 4 `fonteParaCliente()` com nomes distintos**

Em `tools/semanal/render-semanal.js`, troque:

```js
const { fonteParaCliente } = require('../comum/calculo-equipes.js');
```

por:

```js
const { fonteParaCliente: fonteParaClienteEquipes } = require('../comum/calculo-equipes.js');
const { fonteParaCliente: fonteParaClienteTipologiasAvancos } = require('../comum/tipologias-avancos.js');
const { fonteParaCliente: fonteParaClienteTipologiasLab } = require('../comum/tipologias-lab.js');
const { fonteParaCliente: fonteParaClienteDatas } = require('../comum/datas.js');
const { fonteParaCliente: fonteParaClienteLinhaBase } = require('../comum/linha-base.js');
```

- [ ] **Step 2: Concatenar as 5 fontes no `<script>` existente**

Troque a linha (perto do fim do arquivo, dentro do template literal HTML):

```js
  <script>${fonteParaCliente()}</script>
```

por:

```js
  <script>${fonteParaClienteEquipes()}${fonteParaClienteTipologiasAvancos()}${fonteParaClienteTipologiasLab()}${fonteParaClienteDatas()}${fonteParaClienteLinhaBase()}</script>
```

(continua sendo um `<script>` só -- a contagem de 6 blocos que
`test/semanal-render-semanal-wireup.test.js` já verifica NÃO muda; só o
CONTEÚDO deste bloco cresce.)

- [ ] **Step 3: Atualizar o comentário que documenta a contagem de scripts**

Em `test/semanal-render-semanal-wireup.test.js`, o comentário acima de
`montarSandbox` (por volta da linha 55-61) hoje diz que o 4º bloco é
"fonteParaCliente() (mediaEquipesPonderada como global...)". Atualize pra
mencionar que agora concatena 5 fontes (calculo-equipes, tipologias-avancos,
tipologias-lab, datas, linha-base) -- não muda nenhum assert, só o texto do
comentário.

- [ ] **Step 4: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS -- o `ReferenceError` da Task 8 desaparece (as 4 globais
agora existem antes do bundle rodar).

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/render-semanal.js test/semanal-render-semanal-wireup.test.js
git commit -m "feat: injeta tipologias-avancos/tipologias-lab/datas/linha-base como globais antes do bundle da semanal"
```

---

### Task 10: Markup do botão "Atualizar dados" + status

**Files:**
- Modify: `tools/semanal/render-semanal.js`

**Interfaces:**
- Produces: `<button id="atualizar-dashboard">`/`<span id="status-atualizacao">`
  no HTML da semanal, reaproveitando o CSS já existente em
  `tools/comum/render-shell.js` (`#atualizar-dashboard`,
  `.status-atualizacao` -- ver spec, seção "UI"). Consumida pela Task 11
  (`atualizarDadosAoVivoSemanal()` liga o listener neste id).

- [ ] **Step 1: Definir `MARKUP_ACOES_SEMANAL` e passar pro slot `acoes` de `markupFiltros`**

Em `tools/semanal/render-semanal.js`, logo antes de `const FILTROS_SEMANAL = [...]`
(ou em qualquer ponto antes do primeiro uso), acrescente:

```js
// Só o botão de atualização ao vivo + status -- ao contrário do orçamento,
// a semanal não tem "#limpar-filtros" nem as abas dentro deste slot (as
// abas já são renderizadas à parte, via markupAbas() logo abaixo da barra
// de filtros -- ver a chamada de renderSemanal). Reaproveita os MESMOS ids
// (#atualizar-dashboard/#status-atualizacao) que o CSS compartilhado em
// cssBase() (tools/comum/render-shell.js) já estiliza.
const MARKUP_ACOES_SEMANAL = `      <div class="filtros-acoes">
        <button id="atualizar-dashboard" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16M3 21v-5h5"/></svg>Atualizar dados</button>
        <span id="status-atualizacao" class="status-atualizacao"></span>
      </div>`;
```

Troque:

```js
${markupFiltros(FILTROS_SEMANAL, { recuo: '    ' })}
```

por:

```js
${markupFiltros(FILTROS_SEMANAL, { recuo: '    ', acoes: MARKUP_ACOES_SEMANAL })}
```

- [ ] **Step 2: Rodar os testes existentes de HTML da semanal**

Run: `node --test test/semanal-render-semanal-wireup.test.js`
Expected: PASS (nenhum teste existente afirma o HTML exato da barra de
ações -- só verifica seções específicas).

- [ ] **Step 3: Escrever um teste confirmando que o botão existe no HTML**

Em algum teste de `render-semanal.js` (ex.: `test/semanal-render-semanal-wireup.test.js`
ou um novo `test/semanal-render-semanal.test.js` se não houver um teste
puro de markup ainda -- confira com `ls test/ | grep "semanal-render-semanal\b"`),
acrescente:

```js
test('o HTML da semanal tem o botão "Atualizar dados" e o span de status, com os MESMOS ids que o CSS compartilhado (cssBase) estiliza', () => {
  const html = renderSemanal({ registros: [], baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z') });
  assert.match(html, /<button id="atualizar-dashboard" type="button">/);
  assert.match(html, /<span id="status-atualizacao" class="status-atualizacao"><\/span>/);
});
```

(ajuste os nomes de fixture -- `DEMANDAS_VAZIAS`/`PERIODOS_2026`/`SENHA_FAKE`
-- pro que já existir no arquivo escolhido; são os mesmos usados em
`test/semanal-render-semanal-wireup.test.js`.)

- [ ] **Step 4: Rodar o teste novo**

Run: `node --test test/semanal-render-semanal-wireup.test.js` (ou o arquivo escolhido)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/render-semanal.js test/semanal-render-semanal-wireup.test.js
git commit -m "feat: markup do botão Atualizar dados na página semanal"
```

---

### Task 11: `atualizarDadosAoVivoSemanal()` -- a orquestração do botão

**Files:**
- Modify: `tools/semanal/render-semanal.js`

**Interfaces:**
- Consumes: `ParseMatrizCliente`/`ParseAvancos`/`ParseLab`/`ComputeDemandas`
  (via `MODULOS[...]`, Task 8); `montarTodosFiltrosMultiSemanal`,
  `recalcularSemanal`, `montarAbaDemandas` (já existentes no
  `SCRIPT_CLIENTE_SEMANAL`, ver `render-semanal.js:487-503`).
- Produces: `atualizarDadosAoVivoSemanal()`, ligada ao clique de
  `#atualizar-dashboard`.

- [ ] **Step 1: Referenciar os 4 módulos novos do bundle**

No topo de `SCRIPT_CLIENTE_SEMANAL` (dentro do template literal, logo
depois de `var RenderAbaDemandas = MODULOS['render-aba-demandas.js'];`),
acrescente:

```js
var ParseMatrizCliente = MODULOS['parse-matriz-cliente.js'];
var ParseAvancos = MODULOS['parse-avancos.js'];
var ParseLab = MODULOS['parse-lab.js'];
var ComputeDemandas = MODULOS['compute-demandas.js'];
```

- [ ] **Step 2: Escrever `atualizarDadosAoVivoSemanal()` e as funções de apoio**

Ao final de `SCRIPT_CLIENTE_SEMANAL` (depois da função `montarDashboard`,
ainda dentro do mesmo template literal, antes do fechamento com crase),
acrescente:

```js

// ---- Atualização ao vivo (busca as Sheets espelho publicadas, sem tocar
// nos arquivos originais) -- ver docs/superpowers/specs/2026-07-31-semanal-atualizar-dados-design.md.
// URL_ESPELHO_MATRIZ_SEMANAL é a MESMA Sheet publicada que o orçamento já
// usa (tools/orcamento/render-dashboard.js) -- literal duplicado de
// propósito, não hà como as duas páginas compartilharem uma constante JS
// (são dois builds independentes). As outras duas ainda são placeholder:
// dependem de um Apps Script novo, que o dono do projeto precisa publicar
// manualmente (ver tools/semanal/apps-script-espelho-avancos.gs) -- troque
// pelos valores reais assim que ele publicar.
var URL_ESPELHO_MATRIZ_SEMANAL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRaOjGxPYWKj-as9RwErptIND7PE_zxsND19PReV1MdOup1ZY3iAu_DGrQ0gatPyYFEy3hg-LWE2esw/pub?gid=609773455&single=true&output=csv';
var URL_ESPELHO_AVANCOS_SEMANAL = 'PENDENTE-AGUARDANDO-PUBLICACAO-DO-APPS-SCRIPT-AVANCOS';
var URL_ESPELHO_LAB_SEMANAL = 'PENDENTE-AGUARDANDO-PUBLICACAO-DO-APPS-SCRIPT-LAB';

function definirStatusAtualizacaoSemanal(texto, ehErro) {
  var el = document.getElementById('status-atualizacao');
  if (!el) return;
  el.textContent = texto;
  el.classList.toggle('status-erro', !!ehErro);
}

function periodosDoAnoSemanal() {
  var periodos = [];
  for (var i = 0; i < 12; i++) periodos.push(new Date(Date.UTC(window.__ANO__, i, 1)));
  return periodos;
}

function buscarCsvSemanal(url) {
  var comCacheBust = url + (url.indexOf('?') === -1 ? '?' : '&') + '_=' + Date.now();
  return fetch(comCacheBust).then(function (resposta) {
    if (!resposta.ok) throw new Error('HTTP ' + resposta.status + ' ao buscar ' + url);
    return resposta.text();
  });
}

// Tudo-ou-nada: nenhum window.__REGISTROS__/window.__DEMANDAS__ é
// sobrescrito antes dos 3 fetches E de todo o parsing terminarem com
// sucesso -- uma falha parcial (ex.: MATRIZ ok, Avanços fora do ar) não
// pode deixar os dois globais referindo momentos diferentes. baseline
// (window.__BASELINE__) nunca é tocado aqui -- ver "Estado atual" no spec.
function atualizarDadosAoVivoSemanal() {
  definirStatusAtualizacaoSemanal('Atualizando…', false);
  Promise.all([
    buscarCsvSemanal(URL_ESPELHO_MATRIZ_SEMANAL),
    buscarCsvSemanal(URL_ESPELHO_AVANCOS_SEMANAL),
    buscarCsvSemanal(URL_ESPELHO_LAB_SEMANAL),
  ]).then(function (textos) {
    var registrosNovos = ParseMatrizCliente.parseMatrizCliente(ParseMatrizCliente.parseCsvGrid(textos[0]));
    if (!registrosNovos.length) throw new Error('nenhum registro encontrado no espelho da MATRIZ -- confira se o Apps Script já rodou pelo menos uma vez');

    var furosLidos = ParseAvancos.parseAvancos(ParseMatrizCliente.parseCsvGrid(textos[1])).furos;
    var ensaiosLidos = ParseLab.parseLab(ParseMatrizCliente.parseCsvGrid(textos[2])).ensaios;

    var furos = ComputeDemandas.redirecionarSupsDesconhecidos(furosLidos, registrosNovos).itens;
    var ensaios = ComputeDemandas.redirecionarSupsDesconhecidos(ensaiosLidos, registrosNovos).itens;
    var demandasNovas = ComputeDemandas.computeDemandas(furos, periodosDoAnoSemanal(), ensaios);

    window.__REGISTROS__ = registrosNovos;
    window.__DEMANDAS__ = demandasNovas;
    montarTodosFiltrosMultiSemanal(window.__REGISTROS__);
    recalcularSemanal();
    montarAbaDemandas();

    var agora = new Date();
    definirStatusAtualizacaoSemanal('Atualizado às ' + agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), false);
  }).catch(function (erro) {
    definirStatusAtualizacaoSemanal('Falha ao atualizar: ' + erro.message, true);
  });
}

document.getElementById('atualizar-dashboard').addEventListener('click', atualizarDadosAoVivoSemanal);
```

- [ ] **Step 3: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS (nada ainda exercita `atualizarDadosAoVivoSemanal` de
verdade -- isso é a Task 12).

- [ ] **Step 4: Commit**

```bash
git add tools/semanal/render-semanal.js
git commit -m "feat: atualizarDadosAoVivoSemanal -- orquestra o botão Atualizar dados"
```

---

### Task 12: Teste de wireup ponta-a-ponta do live-refresh

**Files:**
- Modify: `test/semanal-render-semanal-wireup.test.js`

**Interfaces:**
- Consumes: `montarSandbox` (helper já existente no próprio arquivo, ver
  Task-anterior do wireup original) -- precisa de um `fetch` mockado
  injetado no sandbox.

- [ ] **Step 1: Adaptar `montarSandbox` pra aceitar um `fetch` mockável**

Em `test/semanal-render-semanal-wireup.test.js`, altere a assinatura de
`montarSandbox(html)` pra `montarSandbox(html, fetchMock)`, e no objeto
`sandbox`, acrescente `fetch: fetchMock || (() => Promise.reject(new Error('fetch não mockado neste teste')))`.

- [ ] **Step 2: Escrever o teste de refresh com sucesso**

```js
test('atualizarDadosAoVivoSemanal: busca os 3 CSVs, substitui window.__REGISTROS__/window.__DEMANDAS__ (sem tocar window.__BASELINE__), remonta filtros e re-renderiza a aba ativa', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const geradoEm = new Date('2026-07-01T00:00:00Z');
  const html = renderSemanal({ registros, baseline: [{ chave: 'SUP-0001-24||ST', previstoInicial: {} }], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });

  const csvMatriz = 'ORIGEM,GRUPO,TOMADOR,SUP,ESCOPO,APOIO,INICIO,TERMINO,SONDAGEM,BASE,'
    + Array(12).fill('mes').join(',') + ',PICO,MÉDIA,PROD.,DIAS,'
    + Array(12).fill('mes').join(',') + ',TOTAL,TOTAL INICIAL,TICKET,'
    + Array(12).fill('mes').join(',') + ',TOTAL,TOTAL INICIAL,OBS\n'
    + 'Origem-B,Grupo-B,Tomador-Novo,SUP-0002-25,Escopo,Apoio,01/2026,12/2026,ST,P,'
    + Array(12).fill('0').join(',') + ',2,2,8,25,'
    + Array(12).fill('0').join(',') + ',100,100,9999,'
    + Array(12).fill('0').join(',') + ',100,100,\n';
  const csvVazio = 'Contrato,Criação da OS,Tipo,Status,Termino Sondagem,Conclusão,Cancelamento,Atualizado,Observações de Campo\n';
  const csvLabVazio = 'ID Contrato,Concluído Dia,Tipo de Ensaio\n';

  const fetchMock = (url) => {
    const texto = url.indexOf('pub?gid=609773455') !== -1 ? csvMatriz
      : url.indexOf('PENDENTE-AGUARDANDO-PUBLICACAO-DO-APPS-SCRIPT-AVANCOS') !== -1 ? csvVazio
      : csvLabVazio;
    return Promise.resolve({ ok: true, text: () => Promise.resolve(texto) });
  };

  const { sandbox, documentoFalso } = montarSandbox(html, fetchMock);
  const senhaInput = documentoFalso.getElementById('senha-input');
  senhaInput.value = SENHA_FAKE;
  await documentoFalso.getElementById('form-desbloqueio').dispatchEvent(new Event('submit'));

  const baselineAntes = sandbox.window.__BASELINE__;
  await sandbox.atualizarDadosAoVivoSemanal();

  assert.strictEqual(sandbox.window.__REGISTROS__.length, 1, 'registros novos vieram só do CSV da MATRIZ mockado');
  assert.strictEqual(sandbox.window.__REGISTROS__[0].sup, 'SUP-0002-25');
  assert.strictEqual(sandbox.window.__REGISTROS__[0].previsto.volumeResumo.ticket, 9999, 'TICKET novo precisa aparecer -- é a motivação original desta feature');
  assert.strictEqual(sandbox.window.__BASELINE__, baselineAntes, 'baseline não pode ser tocado pelo refresh');
  assert.match(documentoFalso.getElementById('status-atualizacao').textContent, /^Atualizado às \d{2}:\d{2}$/);
});
```

(Ajuste `registroSintetico`/`SENHA_FAKE`/`PERIODOS_2026`/`DEMANDAS_VAZIAS`
pros helpers já existentes no arquivo; ajuste o mecanismo exato de "digitar
a senha e submeter" pro que o teste de wireup original -- linhas 75+ do
mesmo arquivo -- já usa, copiando o padrão em vez de reinventar.)

- [ ] **Step 3: Escrever o teste de falha (tudo-ou-nada)**

```js
test('atualizarDadosAoVivoSemanal: se qualquer um dos 3 fetches falhar, window.__REGISTROS__ NÃO muda e o status mostra o erro', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const geradoEm = new Date('2026-07-01T00:00:00Z');
  const html = renderSemanal({ registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });

  const fetchMock = (url) => url.indexOf('pub?gid=609773455') !== -1
    ? Promise.resolve({ ok: false, status: 500 })
    : Promise.resolve({ ok: true, text: () => Promise.resolve('') });

  const { sandbox, documentoFalso } = montarSandbox(html, fetchMock);
  const senhaInput = documentoFalso.getElementById('senha-input');
  senhaInput.value = SENHA_FAKE;
  await documentoFalso.getElementById('form-desbloqueio').dispatchEvent(new Event('submit'));

  const registrosAntes = sandbox.window.__REGISTROS__;
  await sandbox.atualizarDadosAoVivoSemanal();

  assert.strictEqual(sandbox.window.__REGISTROS__, registrosAntes, 'uma falha em QUALQUER fetch não pode trocar os registros -- tudo ou nada');
  assert.match(documentoFalso.getElementById('status-atualizacao').textContent, /^Falha ao atualizar: /);
  assert.ok(documentoFalso.getElementById('status-atualizacao').classList.contains('status-erro'));
});
```

(Se `dispatchEvent`/`Event`/o fluxo exato de submissão da senha não bater
com o que o teste de wireup original usa, ajuste pra copiar o padrão real
já presente no arquivo -- não invente um mecanismo novo de simular o
desbloqueio.)

- [ ] **Step 4: Rodar os 2 testes novos**

Run: `node --test test/semanal-render-semanal-wireup.test.js`
Expected: PASS

- [ ] **Step 5: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: 100% verde.

- [ ] **Step 6: Commit**

```bash
git add test/semanal-render-semanal-wireup.test.js
git commit -m "test: cobre atualizarDadosAoVivoSemanal ponta-a-ponta (sucesso e falha tudo-ou-nada)"
```

---

### Task 13: Apps Script novo (Avanços + Lab Concluido)

**Files:**
- Create: `tools/semanal/apps-script-espelho-avancos.gs`

Sem teste (mesmo caso de `tools/orcamento/apps-script-espelho-matriz.gs`:
código Google Apps Script, roda fora deste repositório, sem `node --test`
possível).

- [ ] **Step 1: Escrever o script**

Crie `tools/semanal/apps-script-espelho-avancos.gs`, adaptando
`tools/orcamento/apps-script-espelho-matriz.gs` pra 2 abas em vez de 1:

```
// Cole este código no editor do Apps Script da Sheet "espelho" (Extensões >
// Apps Script). Ele copia as abas "Avanços" e "Lab Concluido" do arquivo
// real (.xlsx no Drive) pra dentro desta própria Sheet, periodicamente --
// você continua editando só o .xlsx normalmente, esta Sheet é só um espelho
// automático. Companheiro de tools/orcamento/apps-script-espelho-matriz.gs
// (mesmo padrão, mesma Sheet de origem que MATRIZ NÃO é -- este script
// espelha o workbook "Avanço Sond.xlsx", não o de orçamento).
//
// Setup (uma vez só):
//   1. Crie uma Google Sheet em branco -- esta vai ser a Sheet espelho.
//   2. Nela: Extensões > Apps Script, apague o conteúdo padrão e cole este arquivo inteiro.
//   3. No editor do Apps Script: no menu lateral "Serviços" (ícone +), adicione "Drive API"
//      (serviço avançado -- é diferente do DriveApp básico).
//   4. Na barra de funções (topo), selecione "atualizarEspelhoAvancos" e clique Executar --
//      vai pedir autorização (sua conta Google), autorize. Isso já popula as abas "Avanços"
//      e "Lab Concluido" dentro desta Sheet pela primeira vez.
//   5. Selecione "criarGatilho" e clique Executar uma vez -- isso agenda a
//      atualização automática a cada 30 min daqui pra frente (não precisa rodar de novo).
//   6. De volta na Sheet (não no editor de script): Arquivo > Compartilhar > Publicar na web >
//      selecione a aba "Avanços" > formato CSV > Publicar. Repita pra "Lab Concluido"
//      (são DUAS publicações, uma por aba -- duas URLs diferentes). Guarde as duas URLs
//      e me envie -- é o que eu uso pra terminar de ligar o botão "Atualizar dados" do
//      Planejamento Semanal.

var ORIGEM_FILE_ID = 'SUBSTITUA_PELO_ID_DO_ARQUIVO_AVANCO_SOND_XLSX'; // "Avanço Sond.xlsx"
var ABAS_ORIGEM = ['Avanços', 'Lab Concluido'];

// Mesmo mecanismo de tools/orcamento/apps-script-espelho-matriz.gs
// (atualizarEspelhoMatriz): converte o .xlsx numa cópia temporária em
// formato Sheets nativo, copia CADA aba de ABAS_ORIGEM pra dentro desta
// Sheet, e apaga a cópia temporária. Diferença: duas abas por vez, não uma.
function atualizarEspelhoAvancos() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tempFile = Drive.Files.copy(
    { title: '__temp_avancos_sync__', mimeType: MimeType.GOOGLE_SHEETS },
    ORIGEM_FILE_ID
  );
  try {
    var tempSs = SpreadsheetApp.openById(tempFile.id);
    ABAS_ORIGEM.forEach(function (nomeAba) {
      var abaOrigem = tempSs.getSheetByName(nomeAba);
      if (!abaOrigem) throw new Error('Aba "' + nomeAba + '" não encontrada no arquivo de origem -- confira ORIGEM_FILE_ID e o nome da aba.');
      var dados = abaOrigem.getDataRange().getValues();

      var abaEspelho = ss.getSheetByName(nomeAba);
      if (!abaEspelho) abaEspelho = ss.insertSheet(nomeAba);
      abaEspelho.clearContents();
      if (dados.length && dados[0].length) {
        abaEspelho.getRange(1, 1, dados.length, dados[0].length).setValues(dados);
      }
      abaEspelho.getRange(1, 1).setNote('Espelho automático -- atualizado em ' + new Date().toISOString());
    });
  } finally {
    Drive.Files.remove(tempFile.id);
  }
}

// Agenda atualizarEspelhoAvancos pra rodar sozinha a cada 30 min. Roda esta
// função manualmente UMA vez só (remove qualquer gatilho antigo da mesma
// função antes de criar um novo, então rodar de novo não duplica).
function criarGatilho() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'atualizarEspelhoAvancos') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('atualizarEspelhoAvancos')
    .timeBased()
    .everyMinutes(30)
    .create();
}
```

- [ ] **Step 2: Commit**

```bash
git add tools/semanal/apps-script-espelho-avancos.gs
git commit -m "docs: Apps Script pra espelhar Avanços + Lab Concluido (setup manual do usuário)"
```

---

### Task 14: Atualizar CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Documentar a feature na seção "Planejamento Semanal"**

Acrescente um parágrafo novo depois do parágrafo que descreve a aba
Demandas, algo como:

```markdown
### Botão "Atualizar dados" (live-refresh, 2026-07-31)

A página semanal ganhou o mesmo botão que o orçamento já tinha: busca CSVs
publicados ao vivo (MATRIZ -- mesma Sheet espelho do orçamento -- e Avanço
Sond, via `tools/semanal/apps-script-espelho-avancos.gs`, Apps Script novo)
e recalcula tudo no navegador, sem precisar de um novo build/publish. Ver
`docs/superpowers/specs/2026-07-31-semanal-atualizar-dados-design.md` pro
desenho completo. `window.__BASELINE__` nunca é tocado pelo refresh -- ao
contrário do orçamento, a semanal mantém a linha de base separada dos
registros desde sempre, então não precisa do transplante de
`previstoInicial` que o orçamento precisa.

**Pendência**: as URLs `URL_ESPELHO_AVANCOS_SEMANAL`/`URL_ESPELHO_LAB_SEMANAL`
em `tools/semanal/render-semanal.js` (dentro de `SCRIPT_CLIENTE_SEMANAL`)
são placeholder até o dono do projeto terminar o setup manual do Apps
Script novo (ver o arquivo `.gs`) e publicar as duas abas como CSV. Até lá o
botão funciona pra MATRIZ mas falha (com mensagem de erro clara no
`#status-atualizacao`) ao tentar buscar Avanços/Lab.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: registra o botão Atualizar dados da semanal e a pendência das URLs do Apps Script novo"
```

---

## Depois de todas as tasks

Rode a suíte inteira uma última vez (`node --test test/*.test.js`), confirme
100% verde, e siga o fluxo de publicação de sempre (build com
`ORCAMENTO_SENHA`, copiar `dist/planejamento-semanal.html` pra
`docs/planejamento-semanal.html`, reverter os patches locais de
`config-demandas.js`/`config.js`, commit dist+docs juntos, push, poll até o
Pages servir o novo conteúdo) -- SÓ depois de o usuário confirmar que quer
publicar (o botão funciona parcialmente até lá -- MATRIZ ao vivo já
funciona; Avanços/Lab dependem do Apps Script novo que só ele pode
configurar).
