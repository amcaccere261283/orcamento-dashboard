# Base de demandas e realizado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ler a aba `Avanços` do `Avanço Sond.xlsx` (61.927 furos) e entregar, numa aba nova do Planejamento Semanal, 5 séries mensais em quantidade de furos — chegadas, sondagem realizada, relatório concluído, canceladas e pendentes (estoque) — com visão mensal e acumulada.

**Architecture:** Agregação no build, matriz pronta no blob cifrado. `parse-avancos.js` (Node) lê a planilha linha por furo e aplica o mapa de tipologias; `compute-demandas.js` (Node) agrega em (tipologia, mês) × 5 séries; `render-aba-demandas.js` (Node **e** navegador, via `buildBrowserBundle`) desenha a tabela e faz a transformação para acumulado no cliente. Mesma pipeline parse → compute → render que o orçamento já roda.

**Tech Stack:** Node.js puro, sem dependências. Testes com `node --test`. Leitura de xlsx pelos módulos próprios do repo (`tools/comum/xlsx-reader.js`). JS de cliente em ES5 (`var`, `function`), sem bundler.

**Spec:** `docs/superpowers/specs/2026-07-29-base-demandas-realizado-design.md`

## Global Constraints

- **Diretório de trabalho:** `orcamento-dashboard/` (repositório próprio, clonado dentro de `Projetos IA/`). Todos os caminhos deste plano são relativos a ele. Branch: `demandas-base`.
- **Comando de teste:** `node --test test/*.test.js`. Sem `npm install` — o repositório não tem dependências.
- **`test/orcamento-html-inalterado.test.js` DEVE continuar passando em todas as tarefas.** Nada aqui toca o dashboard de orçamento; se esse teste quebrar, algo saiu do lugar. Nunca regenere o golden neste plano.
- **A senha nunca vai para arquivo do repositório.** Builds usam `ORCAMENTO_SENHA` como variável de ambiente. Testes usam senha fictícia (`'senha-fake-de-teste-e2e-nao-e-a-real'`, padrão já usado em `test/semanal-render-semanal-wireup.test.js`).
- **Módulo que entra no bundle do navegador não pode ter `require('../...')`.** `transformaModulo` (`tools/comum/browser-bundle.js`) **remove** a linha inteira em vez de reescrevê-la — o nome viraria `undefined` em produção enquanto os testes em Node passam. Só `render-aba-demandas.js` vai para o bundle, e ele não requer nada fora de `./`.
- **Módulo bundlado usa `var` e `function`,** nunca `const`/arrow no escopo do módulo, e o `require` de irmão na forma exata `const { X } = require('./arquivo.js');` — é o único formato que a reescrita reconhece. Ver o comentário no topo de `tools/semanal/render-aba-semanal.js`.
- **Nada de `Map` no payload cifrado.** `renderSemanal` faz `JSON.stringify({ registros, baseline, demandas })`; um `Map` serializa como `{}` e os dados desaparecem sem erro. Só arrays e objetos simples.
- **Tarefas 1 a 5 rodam em qualquer máquina.** Só as Tarefas 6 e 7 precisam do Google Drive montado em `G:` e da senha real.
- **Janela de saneamento de data:** serial Excel fora de `44927` (2023-01-01) a `46388` (2027-01-01) é tratado como ausente. Valor único, definido uma vez em `parse-avancos.js`.
- **Nomes de coluna são exatos, com e sem acento como estão na planilha:** `Contrato`, `Criação da OS`, `Tipo`, `Status`, `Termino Sondagem` (**sem** acento em "Termino"), `Conclusão`, `Atualizado`.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `tools/comum/tipologias-avancos.js` | **Criar.** O mapa tipologia crua → rótulo do dashboard, a ordem de exibição, e a lista das que só aparecem quando acionadas. Nada de I/O. |
| `tools/semanal/config-demandas.js` | **Criar.** Caminho do `Avanço Sond.xlsx` e nome da aba. |
| `tools/semanal/parse-avancos.js` | **Criar.** Grade da planilha → uma linha por furo, com datas saneadas e tipologia já rotulada. Node-only. |
| `tools/semanal/compute-demandas.js` | **Criar.** Furos + 12 períodos → `(tipologia, mês)` × 5 séries. Função pura, Node-only (roda no build). |
| `tools/semanal/render-aba-demandas.js` | **Criar.** A tabela e o acumulado. Único módulo novo que entra no bundle do navegador. |
| `tools/semanal/build-dashboard.js` | **Modificar.** Ler a nova fonte, computar e passar `demandas` para `renderSemanal`. |
| `tools/semanal/render-semanal.js` | **Modificar.** Aba nova no seletor, seção, bundle, CSS, e `demandas` no payload cifrado. |
| `test/comum-tipologias-avancos.test.js` | **Criar.** |
| `test/semanal-parse-avancos.test.js` | **Criar.** |
| `test/semanal-compute-demandas.test.js` | **Criar.** |
| `test/semanal-render-aba-demandas.test.js` | **Criar.** |
| `test/semanal-render-aba-demandas-wireup.test.js` | **Criar.** Prova que a aba é montada de verdade no navegador. |
| `test/semanal-demandas-planilha-real.test.js` | **Criar.** Sanidade contra a planilha real, pulado quando não há `G:`. |
| `test/semanal-build-dashboard.test.js` | **Modificar.** 6 chamadas a `renderSemanal` passam a fornecer `demandas`, mais a do teste de recusa. |
| `test/semanal-render-semanal-wireup.test.js` | **Modificar.** 4 chamadas; ganha o teste de troca entre as três abas. |
| `test/semanal-render-aba-balanco-wireup.test.js` | **Modificar.** 3 chamadas. |
| `test/semanal-linha-base-costura.test.js` | **Modificar.** 1 chamada. |
| `CLAUDE.md` | **Modificar.** Documentar a nova fonte e as três armadilhas de dados. |

---

### Task 1: Mapa de tipologias

**Files:**
- Create: `tools/comum/tipologias-avancos.js`
- Test: `test/comum-tipologias-avancos.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `rotularTipologia(crua) -> string` (lança `Error` em rótulo desconhecido), `ORDEM_TIPOLOGIAS: string[]` (15 rótulos, ordem de exibição), `SO_QUANDO_ACIONADA: string[]` (`['SEG.A', 'SEG.V']`), `MAPA_TIPOLOGIAS: object`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `test/comum-tipologias-avancos.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  rotularTipologia, ORDEM_TIPOLOGIAS, SO_QUANDO_ACIONADA, MAPA_TIPOLOGIAS,
} = require('../tools/comum/tipologias-avancos.js');

test('as 6 tipologias que já batem com a MATRIZ passam direto', () => {
  for (const t of ['SP', 'ST', 'PI', 'BL', 'SH', 'VT']) {
    assert.strictEqual(rotularTipologia(t), t);
  }
});

test('CPTU vira CPTu -- diferença é só de caixa, e a MATRIZ manda', () => {
  assert.strictEqual(rotularTipologia('CPTU'), 'CPTu');
});

test('SM, SM.F e SR colapsam no rótulo único da MATRIZ', () => {
  assert.strictEqual(rotularTipologia('SM'), 'SM / SM.F / SR');
  assert.strictEqual(rotularTipologia('SM.F'), 'SM / SM.F / SR');
  assert.strictEqual(rotularTipologia('SR'), 'SM / SM.F / SR');
});

test('SM.A NÃO entra em SM / SM.F / SR -- decisão do dono, tem rótulo próprio', () => {
  assert.strictEqual(rotularTipologia('SM.A'), 'SM.A');
});

test('SP.F NÃO entra em SP -- decisão do dono, tem rótulo próprio', () => {
  assert.strictEqual(rotularTipologia('SP.F'), 'SP.F');
});

test('SEG.A e SEG.V mantêm rótulo próprio e estão marcadas como só-quando-acionada', () => {
  assert.strictEqual(rotularTipologia('SEG.A'), 'SEG.A');
  assert.strictEqual(rotularTipologia('SEG.V'), 'SEG.V');
  assert.deepStrictEqual(SO_QUANDO_ACIONADA, ['SEG.A', 'SEG.V']);
});

test('os 6 rótulos sem equivalente na MATRIZ viram Especiais', () => {
  for (const t of ['BQ', 'SN', 'DN', 'PZ.SP', 'PZ.SM', 'INA']) {
    assert.strictEqual(rotularTipologia(t), 'Especiais');
  }
});

test('rótulo desconhecido LANÇA citando o rótulo -- nunca cai calado em Especiais', () => {
  assert.throws(() => rotularTipologia('XYZ'), /XYZ/);
});

test('espaço em volta e caixa não decidem nada', () => {
  assert.strictEqual(rotularTipologia('  sp  '), 'SP');
  assert.strictEqual(rotularTipologia('cptu'), 'CPTu');
});

test('rótulo vazio LANÇA -- linha sem tipo é descartada antes, não rotulada', () => {
  assert.throws(() => rotularTipologia(''), /vazi/i);
  assert.throws(() => rotularTipologia(null), /vazi/i);
});

test('ORDEM_TIPOLOGIAS tem os 15 rótulos, inclui LAB.C/LAB.E e não repete nenhum', () => {
  assert.strictEqual(ORDEM_TIPOLOGIAS.length, 15);
  assert.ok(ORDEM_TIPOLOGIAS.includes('LAB.C'));
  assert.ok(ORDEM_TIPOLOGIAS.includes('LAB.E'));
  assert.strictEqual(new Set(ORDEM_TIPOLOGIAS).size, 15);
});

test('todo rótulo de saída do mapa existe em ORDEM_TIPOLOGIAS', () => {
  for (const destino of Object.values(MAPA_TIPOLOGIAS)) {
    assert.ok(ORDEM_TIPOLOGIAS.includes(destino), `"${destino}" não está em ORDEM_TIPOLOGIAS`);
  }
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/comum-tipologias-avancos.test.js`
Expected: FAIL — `Cannot find module '../tools/comum/tipologias-avancos.js'`

- [ ] **Step 3: Implementar**

Criar `tools/comum/tipologias-avancos.js`:

```js
'use strict';

// A aba Avanços do Avanço Sond.xlsx usa 21 rótulos de tipologia; a MATRIZ,
// que manda no resto do dashboard, usa 10. Este mapa é a tradução, definida
// pelo dono do projeto em 2026-07-29 (ver o spec
// docs/superpowers/specs/2026-07-29-base-demandas-realizado-design.md).
//
// Duas decisões que parecem erro de digitação e NÃO são:
// - SM.A não entra em 'SM / SM.F / SR', e SP.F não entra em 'SP'. São
//   serviços tratados de forma independente, com rótulo próprio.
// - SEG.A e SEG.V ficam separadas e só aparecem na tela quando houver
//   acionamento no período (ver SO_QUANDO_ACIONADA) -- são serviços sob
//   demanda, e uma linha de zeros permanente só faria ruído.
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
  'SP.F': 'SP.F',
  'SM.A': 'SM.A',
  'SEG.A': 'SEG.A',
  'SEG.V': 'SEG.V',
  BQ: 'Especiais',
  SN: 'Especiais',
  DN: 'Especiais',
  'PZ.SP': 'Especiais',
  'PZ.SM': 'Especiais',
  INA: 'Especiais',
};

// Ordem de exibição: primeiro as 10 da MATRIZ (mesma ordem que o orçamento
// usa), depois as independentes, depois as de acionamento, e Especiais no
// fim. LAB.C e LAB.E entram mesmo sem nenhuma linha no Avanços --
// laboratório tem fonte própria, e omitir os dois rótulos faria a grade
// parecer completa quando não está.
const ORDEM_TIPOLOGIAS = [
  'SP', 'SM / SM.F / SR', 'ST', 'PI', 'BL', 'CPTu', 'SH', 'VT', 'LAB.C', 'LAB.E',
  'SP.F', 'SM.A', 'SEG.A', 'SEG.V', 'Especiais',
];

const SO_QUANDO_ACIONADA = ['SEG.A', 'SEG.V'];

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

module.exports = { MAPA_TIPOLOGIAS, ORDEM_TIPOLOGIAS, SO_QUANDO_ACIONADA, rotularTipologia };
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/comum-tipologias-avancos.test.js`
Expected: PASS — 12 testes.

- [ ] **Step 5: Commit**

```bash
git add tools/comum/tipologias-avancos.js test/comum-tipologias-avancos.test.js
git commit -m "Mapear as 21 tipologias da aba Avanços nos rótulos da MATRIZ"
```

---

### Task 2: Leitura da aba Avanços

**Files:**
- Create: `tools/semanal/config-demandas.js`
- Create: `tools/semanal/parse-avancos.js`
- Test: `test/semanal-parse-avancos.test.js`

**Interfaces:**
- Consumes: `rotularTipologia` de `tools/comum/tipologias-avancos.js` (Task 1); `excelSerialParaData` de `tools/comum/datas.js` (já existe).
- Produces: `parseAvancos(grid) -> { furos, descartadas, semDataTermino }`, onde cada furo é `{ sup: string, tipologia: string, status: string, criacaoOS: Date|null, terminoSondagem: Date|null, conclusao: Date|null, atualizado: Date|null }`. Também `SERIAL_MIN`, `SERIAL_MAX`, `locateColunasAvancos(headerRow) -> object`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `test/semanal-parse-avancos.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseAvancos, SERIAL_MIN, SERIAL_MAX } = require('../tools/semanal/parse-avancos.js');

// A grade que readXlsxSheet devolve é indexada pelo número de linha do Excel
// (grid[1] é o cabeçalho) e por índice de coluna 0-based -- ver
// parseSheetGrid em tools/comum/xlsx-cells.js.
const CABECALHO = [];
CABECALHO[0] = 'Contrato';
CABECALHO[1] = 'Tomador';
CABECALHO[8] = 'Criação da OS';
CABECALHO[9] = 'Tipo';
CABECALHO[11] = 'Status';
CABECALHO[13] = 'Termino Sondagem';
CABECALHO[14] = 'Conclusão';
CABECALHO[16] = 'Atualizado';

// 2026-03-10, 2026-03-12, 2026-04-02, 2026-04-05 em serial Excel.
const MAR10 = 46091, MAR12 = 46093, ABR02 = 46114, ABR05 = 46117;

function grade(linhas) {
  const grid = [];
  grid[1] = CABECALHO;
  linhas.forEach((linha, i) => { grid[i + 2] = linha; });
  return grid;
}

function furo({ sup = 'SUP-0001-24', tipo = 'SP', status = 'CONCLUIDO', criacao = MAR10, termino = MAR12, conclusao = ABR02, atualizado = ABR05 } = {}) {
  const linha = [];
  linha[0] = sup;
  linha[8] = criacao;
  linha[9] = tipo;
  linha[11] = status;
  linha[13] = termino;
  linha[14] = conclusao;
  linha[16] = atualizado;
  return linha;
}

test('lê um furo com as 4 datas convertidas de serial Excel para Date UTC', () => {
  const { furos } = parseAvancos(grade([furo()]));
  assert.strictEqual(furos.length, 1);
  assert.strictEqual(furos[0].sup, 'SUP-0001-24');
  assert.strictEqual(furos[0].tipologia, 'SP');
  assert.strictEqual(furos[0].status, 'CONCLUIDO');
  assert.strictEqual(furos[0].criacaoOS.toISOString().slice(0, 10), '2026-03-10');
  assert.strictEqual(furos[0].terminoSondagem.toISOString().slice(0, 10), '2026-03-12');
  assert.strictEqual(furos[0].conclusao.toISOString().slice(0, 10), '2026-04-02');
  assert.strictEqual(furos[0].atualizado.toISOString().slice(0, 10), '2026-04-05');
});

test('a tipologia sai JÁ rotulada pelo mapa, não crua', () => {
  const { furos } = parseAvancos(grade([furo({ tipo: 'CPTU' }), furo({ tipo: 'SM.F' })]));
  assert.strictEqual(furos[0].tipologia, 'CPTu');
  assert.strictEqual(furos[1].tipologia, 'SM / SM.F / SR');
});

test('status é normalizado para caixa alta sem espaço em volta', () => {
  const { furos } = parseAvancos(grade([furo({ status: ' concluido ' })]));
  assert.strictEqual(furos[0].status, 'CONCLUIDO');
});

test('data fora da janela de saneamento vira null em vez de virar 1901 ou 2078', () => {
  const { furos } = parseAvancos(grade([furo({ termino: SERIAL_MIN - 1, conclusao: SERIAL_MAX + 1 })]));
  assert.strictEqual(furos[0].terminoSondagem, null);
  assert.strictEqual(furos[0].conclusao, null);
  assert.strictEqual(furos[0].criacaoOS.toISOString().slice(0, 10), '2026-03-10',
    'a data boa da mesma linha não pode ser afetada');
});

test('célula de data vazia vira null, não 1899-12-30', () => {
  const { furos } = parseAvancos(grade([furo({ conclusao: '' })]));
  assert.strictEqual(furos[0].conclusao, null);
});

test('linha sem SUP e sem tipo é descartada e contada, não rotulada', () => {
  const vazia = [];
  const { furos, descartadas } = parseAvancos(grade([furo(), vazia, furo()]));
  assert.strictEqual(furos.length, 2);
  assert.strictEqual(descartadas, 1);
});

test('tipologia desconhecida LANÇA citando o rótulo e a linha da planilha', () => {
  assert.throws(() => parseAvancos(grade([furo({ tipo: 'XYZ' })])), /XYZ/);
  assert.throws(() => parseAvancos(grade([furo({ tipo: 'XYZ' })])), /linha 2/);
});

test('conta os furos concluídos/executados sem data de término -- eles nunca saem do estoque', () => {
  const { semDataTermino } = parseAvancos(grade([
    furo({ status: 'CONCLUIDO', termino: '' }),
    furo({ status: 'EXECUTADO', termino: '' }),
    furo({ status: 'PENDENTE', termino: '' }),
    furo({ status: 'CONCLUIDO' }),
  ]));
  assert.strictEqual(semDataTermino, 2, 'PENDENTE sem término é o estado normal, não conta');
});

test('cabeçalho sem uma das colunas obrigatórias LANÇA dizendo QUAL falta', () => {
  // Só a coluna Status é renomeada: com um cabeçalho curto, a mensagem citaria
  // a primeira ausente na ordem de checagem (Criação da OS) e o teste não
  // provaria nada sobre Status.
  const semStatus = [];
  semStatus[1] = CABECALHO.map(rotulo => (rotulo === 'Status' ? 'Outra coisa' : rotulo));
  semStatus[2] = furo();
  assert.throws(() => parseAvancos(semStatus), /Status/);
});

test('as colunas são achadas pelo NOME, não por posição fixa', () => {
  const deslocado = [];
  deslocado[1] = [];
  deslocado[1][3] = 'Contrato';
  deslocado[1][4] = 'Criação da OS';
  deslocado[1][5] = 'Tipo';
  deslocado[1][6] = 'Status';
  deslocado[1][7] = 'Termino Sondagem';
  deslocado[1][8] = 'Conclusão';
  deslocado[1][9] = 'Atualizado';
  deslocado[2] = [];
  deslocado[2][3] = 'SUP-9999-26';
  deslocado[2][4] = MAR10;
  deslocado[2][5] = 'ST';
  deslocado[2][6] = 'PENDENTE';
  const { furos } = parseAvancos(deslocado);
  assert.strictEqual(furos[0].sup, 'SUP-9999-26');
  assert.strictEqual(furos[0].tipologia, 'ST');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-parse-avancos.test.js`
Expected: FAIL — `Cannot find module '../tools/semanal/parse-avancos.js'`

- [ ] **Step 3: Implementar os dois arquivos**

Criar `tools/semanal/config-demandas.js`:

```js
// tools/semanal/config-demandas.js
'use strict';

// Fonte da base de demandas e realizado -- uma planilha de EXECUÇÃO (uma
// linha por furo, com datas reais), diferente das duas fontes mensais que o
// orçamento já lê. Fica em arquivo próprio, e não em tools/orcamento/
// config.js, porque nada do orçamento depende dela: se este caminho quebrar,
// só a aba Demandas cai.
module.exports = {
  caminhoArquivo: 'G:\\Meu Drive\\PMO\\06 - Orçamento\\OR26 - Rev 01 - Frcst 6+6\\Dados e extratos\\Extratos Sond\\Avanço Sond.xlsx',
  nomeAba: 'Avanços',
};
```

Criar `tools/semanal/parse-avancos.js`:

```js
'use strict';
const { excelSerialParaData } = require('../comum/datas.js');
const { rotularTipologia } = require('../comum/tipologias-avancos.js');

// Lê a aba "Avanços" do Avanço Sond.xlsx: 61.927 linhas, uma por furo. Só
// leitura e saneamento -- nenhuma agregação (isso é compute-demandas.js).
//
// Node-only: NUNCA entra no bundle do navegador. Os requires '../comum/'
// acima seriam REMOVIDOS por transformaModulo (tools/comum/browser-bundle.js),
// e as funções virariam undefined em produção com os testes passando.
//
// Colunas usadas, com o nome EXATO da planilha (medido em 2026-07-29):
// Contrato(A) · Criação da OS(I) · Tipo(J) · Status(L) · Termino Sondagem(N,
// sem acento em "Termino") · Conclusão(O) · Atualizado(Q).
//
// Duas colunas de propósito NÃO usadas:
// - Inicio Sondagem(M): 3.929 das 61.927 linhas têm data fora de 2023-2027
//   (de 1901 a 2078). Nenhuma série ancora nela.
// - Cancelamento(P): apesar do nome, está VAZIA em todas as 4.331 linhas
//   CANCELADO e PREENCHIDA em todas as 50.662 CONCLUIDO, tipicamente cerca de
//   um ano depois da conclusão -- comporta-se como prazo contratual, não como
//   data de evento. É por isso que canceladas ancoram em Atualizado(Q).

// Janela de sanidade de data. A planilha só tem operação a partir de
// 2023-02; qualquer serial fora daqui é lixo (a coluna Inicio Sondagem tem
// de 1901 a 2078) e é tratado como ausente, nunca como data.
const SERIAL_MIN = 44927; // 2023-01-01
const SERIAL_MAX = 46388; // 2027-01-01

const COLUNAS_OBRIGATORIAS = {
  sup: 'Contrato',
  criacaoOS: 'Criação da OS',
  tipo: 'Tipo',
  status: 'Status',
  terminoSondagem: 'Termino Sondagem',
  conclusao: 'Conclusão',
  atualizado: 'Atualizado',
};

function texto(valor) {
  return String(valor === null || valor === undefined ? '' : valor).trim();
}

function locateColunasAvancos(headerRow) {
  const linha = headerRow || [];
  const cols = {};
  for (const [campo, rotulo] of Object.entries(COLUNAS_OBRIGATORIAS)) {
    let achou = -1;
    for (let col = 0; col < linha.length; col++) {
      if (texto(linha[col]) === rotulo) { achou = col; break; }
    }
    if (achou === -1) {
      throw new Error(`Coluna "${rotulo}" não encontrada no cabeçalho da aba Avanços -- o layout da planilha pode ter mudado.`);
    }
    cols[campo] = achou;
  }
  return cols;
}

// Serial fora da janela, vazio ou não-numérico vira null. Sem isso, célula
// vazia viraria 1899-12-30 e entraria como mês válido em alguma série.
function dataSaneada(valor) {
  const serial = Number(valor);
  if (!Number.isFinite(serial) || serial < SERIAL_MIN || serial > SERIAL_MAX) return null;
  return excelSerialParaData(serial);
}

function parseAvancos(grid) {
  const cols = locateColunasAvancos(grid[1]);
  const furos = [];
  let descartadas = 0;
  let semDataTermino = 0;

  for (let r = 2; r < grid.length; r++) {
    const linha = grid[r];
    if (!linha) continue;
    const sup = texto(linha[cols.sup]);
    const tipoCru = texto(linha[cols.tipo]);
    // 21 linhas da planilha real não têm SUP, tipo nem profundidade -- são
    // resto de edição. Descartadas e contadas, nunca rotuladas (rotular
    // lançaria por tipologia vazia).
    if (!sup && !tipoCru) { descartadas++; continue; }

    let tipologia;
    try {
      tipologia = rotularTipologia(tipoCru);
    } catch (err) {
      throw new Error(`${err.message} (linha ${r} da aba Avanços)`);
    }

    const status = texto(linha[cols.status]).toUpperCase();
    const terminoSondagem = dataSaneada(linha[cols.terminoSondagem]);
    if ((status === 'CONCLUIDO' || status === 'EXECUTADO') && terminoSondagem === null) {
      semDataTermino++;
    }

    furos.push({
      sup,
      tipologia,
      status,
      criacaoOS: dataSaneada(linha[cols.criacaoOS]),
      terminoSondagem,
      conclusao: dataSaneada(linha[cols.conclusao]),
      atualizado: dataSaneada(linha[cols.atualizado]),
    });
  }

  return { furos, descartadas, semDataTermino };
}

module.exports = { parseAvancos, locateColunasAvancos, SERIAL_MIN, SERIAL_MAX };
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/semanal-parse-avancos.test.js`
Expected: PASS — 10 testes.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS em tudo, inclusive `orcamento-html-inalterado`.

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/config-demandas.js tools/semanal/parse-avancos.js test/semanal-parse-avancos.test.js
git commit -m "Ler a aba Avanços furo por furo, com data saneada e tipologia rotulada"
```

---

### Task 3: As cinco séries mensais

**Files:**
- Create: `tools/semanal/compute-demandas.js`
- Test: `test/semanal-compute-demandas.test.js`

**Interfaces:**
- Consumes: `ORDEM_TIPOLOGIAS`, `SO_QUANDO_ACIONADA` de `tools/comum/tipologias-avancos.js` (Task 1); o formato de furo de `parse-avancos.js` (Task 2).
- Produces: `computeDemandas(furos, periodos) -> { tipologias: [{ tipologia, series: { chegadas, sondagemRealizada, relatorioConcluido, canceladas, pendentes } }], totais: { <mesmas 5 chaves> } }`. Cada série é um array de 12 números. Também `SERIES: string[]` (as 5 chaves na ordem de exibição), `SERIE_ESTOQUE: 'pendentes'` e `reconciliarSups(furos, registros) -> { soNoAvancos: string[], soNaMatriz: string[], furosSemSupNaMatriz: number }`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `test/semanal-compute-demandas.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  computeDemandas, SERIES, SERIE_ESTOQUE, reconciliarSups,
} = require('../tools/semanal/compute-demandas.js');

const PERIODOS_2026 = Array.from({ length: 12 }, (_, mes) => new Date(Date.UTC(2026, mes, 1)));
const d = (ano, mes, dia) => new Date(Date.UTC(ano, mes - 1, dia));

function furo(over = {}) {
  return Object.assign({
    sup: 'SUP-0001-24', tipologia: 'SP', status: 'CONCLUIDO',
    criacaoOS: d(2026, 1, 10), terminoSondagem: d(2026, 2, 10),
    conclusao: d(2026, 3, 10), atualizado: d(2026, 3, 12),
  }, over);
}

function serieDe(saida, tipologia, serie) {
  const bloco = saida.tipologias.find(t => t.tipologia === tipologia);
  assert.ok(bloco, `tipologia "${tipologia}" ausente na saída`);
  return bloco.series[serie];
}

test('as 5 séries existem, na ordem, e pendentes é a marcada como estoque', () => {
  assert.deepStrictEqual(SERIES, ['chegadas', 'sondagemRealizada', 'relatorioConcluido', 'canceladas', 'pendentes']);
  assert.strictEqual(SERIE_ESTOQUE, 'pendentes');
});

test('cada série cai no mês da SUA data: chegada em jan, sondagem em fev, relatório em mar', () => {
  const saida = computeDemandas([furo()], PERIODOS_2026);
  assert.strictEqual(serieDe(saida, 'SP', 'chegadas')[0], 1);
  assert.strictEqual(serieDe(saida, 'SP', 'sondagemRealizada')[1], 1);
  assert.strictEqual(serieDe(saida, 'SP', 'relatorioConcluido')[2], 1);
  assert.strictEqual(serieDe(saida, 'SP', 'chegadas')[1], 0, 'chegada não se repete em fevereiro');
});

test('chegadas conta TODOS os status, inclusive a que foi cancelada depois', () => {
  const saida = computeDemandas([
    furo({ status: 'CANCELADO', terminoSondagem: null, conclusao: null }),
    furo({ status: 'PENDENTE', terminoSondagem: null, conclusao: null }),
  ], PERIODOS_2026);
  assert.strictEqual(serieDe(saida, 'SP', 'chegadas')[0], 2);
});

test('sondagem realizada exige o status: PENDENTE com data de término não conta', () => {
  const saida = computeDemandas([furo({ status: 'PENDENTE' })], PERIODOS_2026);
  assert.strictEqual(serieDe(saida, 'SP', 'sondagemRealizada')[1], 0);
});

test('EXECUTADO conta como sondagem realizada -- campo feito, relatório pendente', () => {
  const saida = computeDemandas([furo({ status: 'EXECUTADO' })], PERIODOS_2026);
  assert.strictEqual(serieDe(saida, 'SP', 'sondagemRealizada')[1], 1);
});

test('relatório concluído exige status CONCLUIDO: 798 das 811 linhas EXECUTADO têm data de Conclusão preenchida e NÃO podem contar', () => {
  const saida = computeDemandas([furo({ status: 'EXECUTADO' })], PERIODOS_2026);
  assert.strictEqual(serieDe(saida, 'SP', 'relatorioConcluido')[2], 0);
});

test('canceladas ancoram em Atualizado, a única data que existe nelas', () => {
  const saida = computeDemandas([
    furo({ status: 'CANCELADO', terminoSondagem: null, conclusao: null, atualizado: d(2026, 5, 20) }),
  ], PERIODOS_2026);
  assert.strictEqual(serieDe(saida, 'SP', 'canceladas')[4], 1);
});

test('cancelada NÃO entra no estoque de pendentes, em nenhum mês', () => {
  const saida = computeDemandas([
    furo({ status: 'CANCELADO', terminoSondagem: null, conclusao: null, atualizado: d(2026, 5, 20) }),
  ], PERIODOS_2026);
  assert.deepStrictEqual(serieDe(saida, 'SP', 'pendentes'), new Array(12).fill(0));
});

test('estoque é SALDO: o furo aberto em janeiro conta em todo mês até o término', () => {
  const saida = computeDemandas([
    furo({ status: 'PENDENTE', criacaoOS: d(2026, 1, 10), terminoSondagem: null, conclusao: null }),
  ], PERIODOS_2026);
  assert.deepStrictEqual(serieDe(saida, 'SP', 'pendentes'), new Array(12).fill(1));
});

test('o furo sai do estoque no mês em que a sondagem termina, não antes nem depois', () => {
  const saida = computeDemandas([
    furo({ criacaoOS: d(2026, 1, 10), terminoSondagem: d(2026, 3, 20) }),
  ], PERIODOS_2026);
  const pendentes = serieDe(saida, 'SP', 'pendentes');
  assert.deepStrictEqual(pendentes.slice(0, 4), [1, 1, 0, 0],
    'março é o mês do término: ao FIM de março o furo já não está aberto');
});

test('furo que chegou antes do ano (legado) entra no estoque desde janeiro, mas não em chegadas', () => {
  const saida = computeDemandas([
    furo({ status: 'PENDENTE', criacaoOS: d(2025, 11, 3), terminoSondagem: null, conclusao: null }),
  ], PERIODOS_2026);
  assert.strictEqual(serieDe(saida, 'SP', 'chegadas')[0], 0);
  assert.strictEqual(serieDe(saida, 'SP', 'pendentes')[0], 1);
});

test('furo concluído sem data de término válida nunca sai do estoque -- limitação conhecida, não bug', () => {
  const saida = computeDemandas([
    furo({ status: 'CONCLUIDO', criacaoOS: d(2026, 1, 5), terminoSondagem: null, conclusao: null }),
  ], PERIODOS_2026);
  assert.deepStrictEqual(serieDe(saida, 'SP', 'pendentes'), new Array(12).fill(1));
});

test('data fora dos 12 períodos não vira mês nenhum, e não estoura o array', () => {
  const saida = computeDemandas([
    furo({ criacaoOS: d(2027, 2, 1), terminoSondagem: d(2027, 3, 1), conclusao: d(2027, 4, 1) }),
  ], PERIODOS_2026);
  assert.deepStrictEqual(serieDe(saida, 'SP', 'chegadas'), new Array(12).fill(0));
  assert.strictEqual(serieDe(saida, 'SP', 'chegadas').length, 12);
});

test('data nula é ignorada sem quebrar', () => {
  const saida = computeDemandas([
    furo({ criacaoOS: null, terminoSondagem: null, conclusao: null, atualizado: null }),
  ], PERIODOS_2026);
  assert.deepStrictEqual(serieDe(saida, 'SP', 'chegadas'), new Array(12).fill(0));
});

test('tipologias saem na ordem de ORDEM_TIPOLOGIAS, com LAB.C/LAB.E zerados', () => {
  const saida = computeDemandas([furo({ tipologia: 'ST' }), furo({ tipologia: 'SP' })], PERIODOS_2026);
  const rotulos = saida.tipologias.map(t => t.tipologia);
  assert.ok(rotulos.indexOf('SP') < rotulos.indexOf('ST'), 'SP vem antes de ST');
  assert.deepStrictEqual(serieDe(saida, 'LAB.C', 'chegadas'), new Array(12).fill(0));
});

test('SEG.A e SEG.V só aparecem quando há acionamento no período', () => {
  const semSeg = computeDemandas([furo()], PERIODOS_2026);
  assert.strictEqual(semSeg.tipologias.some(t => t.tipologia === 'SEG.A'), false);

  const comSeg = computeDemandas([furo(), furo({ tipologia: 'SEG.A' })], PERIODOS_2026);
  assert.strictEqual(comSeg.tipologias.some(t => t.tipologia === 'SEG.A'), true);
  assert.strictEqual(comSeg.tipologias.some(t => t.tipologia === 'SEG.V'), false,
    'SEG.V sem acionamento continua fora, mesmo com SEG.A presente');
});

test('totais somam as tipologias mês a mês; pendentes também soma (saldos do MESMO mês se somam)', () => {
  const saida = computeDemandas([
    furo({ tipologia: 'SP', status: 'PENDENTE', criacaoOS: d(2026, 1, 5), terminoSondagem: null, conclusao: null }),
    furo({ tipologia: 'ST', status: 'PENDENTE', criacaoOS: d(2026, 1, 6), terminoSondagem: null, conclusao: null }),
  ], PERIODOS_2026);
  assert.strictEqual(saida.totais.chegadas[0], 2);
  assert.strictEqual(saida.totais.pendentes[0], 2);
});

test('a saída sobrevive a JSON.stringify -- nenhum Map no payload cifrado', () => {
  const saida = computeDemandas([furo()], PERIODOS_2026);
  const voltou = JSON.parse(JSON.stringify(saida));
  assert.deepStrictEqual(voltou.tipologias[0].series.chegadas, saida.tipologias[0].series.chegadas);
  assert.ok(voltou.tipologias.length > 0);
});

test('reconciliarSups relata os dois lados do desencontro, sem descartar ninguém', () => {
  const furos = [furo({ sup: 'SUP-0001-24' }), furo({ sup: 'SUP-6785-23 (SO)' }), furo({ sup: 'SUP-6785-23 (SO)' })];
  const registros = [{ sup: 'SUP-0001-24' }, { sup: 'SUP-8511-26' }];
  const r = reconciliarSups(furos, registros);
  assert.deepStrictEqual(r.soNoAvancos, ['SUP-6785-23 (SO)']);
  assert.deepStrictEqual(r.soNaMatriz, ['SUP-8511-26']);
  assert.strictEqual(r.furosSemSupNaMatriz, 2, 'conta FUROS, não SUPs -- é o tamanho real do desencontro');
});

test('reconciliarSups não muda o agregado: SUP fora da MATRIZ continua contando na sua tipologia', () => {
  const saida = computeDemandas([furo({ sup: 'SUP-INEXISTENTE-99' })], PERIODOS_2026);
  assert.strictEqual(serieDe(saida, 'SP', 'chegadas')[0], 1,
    'nada é descartado por não casar com a MATRIZ -- foi o Critical da Fase 1');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-compute-demandas.test.js`
Expected: FAIL — `Cannot find module '../tools/semanal/compute-demandas.js'`

- [ ] **Step 3: Implementar**

Criar `tools/semanal/compute-demandas.js`:

```js
'use strict';
const { ORDEM_TIPOLOGIAS, SO_QUANDO_ACIONADA } = require('../comum/tipologias-avancos.js');

// Agrega os furos de parse-avancos.js em (tipologia, mês) x 5 séries, em
// QUANTIDADE DE FUROS. Roda no BUILD, em Node -- o navegador recebe só o
// agregado, já dentro do blob cifrado (ver render-semanal.js). Por isso o
// require '../comum/' acima é seguro aqui: este módulo não entra no bundle.
//
// As 4 primeiras séries são FLUXOS (eventos datados, acumulam por soma
// corrida). 'pendentes' é ESTOQUE: o saldo aberto no fim de cada mês. Somar
// saldos de meses diferentes daria um número crescente e sem significado --
// mesma armadilha que mediaEquipesPonderada (tools/comum/calculo-equipes.js)
// e dividirEmSemanas (./compute-semanal.js) já documentam para equipes. Quem
// acumula é render-aba-demandas.js, e ele respeita SERIE_ESTOQUE.

const SERIES = ['chegadas', 'sondagemRealizada', 'relatorioConcluido', 'canceladas', 'pendentes'];
const SERIE_ESTOQUE = 'pendentes';

const STATUS_REALIZADO = ['CONCLUIDO', 'EXECUTADO'];

function zeros12(quantidade) {
  return new Array(quantidade).fill(0);
}

// Índice do mês (0-11) dentro de periodos, ou -1 se a data está fora do ano
// da planilha. Compara ano+mês, não intervalo, porque periodos é sempre
// Jan..Dez de um único ano (mesma garantia que o resto do projeto assume --
// ver calcularVigenteIdx em tools/comum/datas.js).
function indiceDoMes(data, periodos) {
  if (!data) return -1;
  for (let i = 0; i < periodos.length; i++) {
    if (periodos[i].getUTCFullYear() === data.getUTCFullYear()
      && periodos[i].getUTCMonth() === data.getUTCMonth()) return i;
  }
  return -1;
}

// Último instante do mês de um período. Date.UTC(ano, mes + 1, 0) é o último
// dia do mês 'mes' -- a virada de mês do próprio Date, sem tabela de dias.
function fimDoMes(periodo) {
  return new Date(Date.UTC(periodo.getUTCFullYear(), periodo.getUTCMonth() + 1, 0, 23, 59, 59));
}

function serieVazia(quantidade) {
  const series = {};
  for (const nome of SERIES) series[nome] = zeros12(quantidade);
  return series;
}

function computeDemandas(furos, periodos) {
  const n = periodos.length;
  const fins = periodos.map(fimDoMes);
  const porTipologia = new Map();
  for (const rotulo of ORDEM_TIPOLOGIAS) porTipologia.set(rotulo, serieVazia(n));

  for (const f of furos || []) {
    // Tipologia fora de ORDEM_TIPOLOGIAS não deveria existir (rotularTipologia
    // já lançou em parse-avancos.js), mas se existir é melhor aparecer do que
    // sumir: cria o bucket na hora, no fim da ordem.
    if (!porTipologia.has(f.tipologia)) porTipologia.set(f.tipologia, serieVazia(n));
    const series = porTipologia.get(f.tipologia);
    const cancelado = f.status === 'CANCELADO';

    const iChegada = indiceDoMes(f.criacaoOS, periodos);
    if (iChegada >= 0) series.chegadas[iChegada] += 1;

    if (STATUS_REALIZADO.indexOf(f.status) !== -1) {
      const iSondagem = indiceDoMes(f.terminoSondagem, periodos);
      if (iSondagem >= 0) series.sondagemRealizada[iSondagem] += 1;
    }

    if (f.status === 'CONCLUIDO') {
      const iRelatorio = indiceDoMes(f.conclusao, periodos);
      if (iRelatorio >= 0) series.relatorioConcluido[iRelatorio] += 1;
    }

    if (cancelado) {
      const iCancel = indiceDoMes(f.atualizado, periodos);
      if (iCancel >= 0) series.canceladas[iCancel] += 1;
    }

    // Estoque: aberto no fim do mês = chegou até ali e a sondagem não
    // terminou até ali. Cancelada sai por STATUS, não por data, porque data
    // de cancelamento não existe na planilha -- limitação declarada no spec
    // (o saldo histórico subestima em até 4.331 furos no pior caso).
    if (!cancelado && f.criacaoOS) {
      for (let i = 0; i < n; i++) {
        if (f.criacaoOS > fins[i]) continue;
        const terminou = f.terminoSondagem && f.terminoSondagem <= fins[i];
        if (!terminou) series.pendentes[i] += 1;
      }
    }
  }

  const tipologias = [];
  for (const [rotulo, series] of porTipologia) {
    // SEG.A/SEG.V são serviços acionados sob demanda: sem acionamento no
    // período, a linha de zeros é só ruído. Qualquer outra tipologia aparece
    // mesmo zerada (a grade densa é informação: LAB.C/LAB.E zerados dizem
    // "laboratório tem fonte própria", não "não houve serviço").
    if (SO_QUANDO_ACIONADA.indexOf(rotulo) !== -1) {
      const temAlgum = SERIES.some(nome => series[nome].some(v => v > 0));
      if (!temAlgum) continue;
    }
    tipologias.push({ tipologia: rotulo, series });
  }

  const totais = serieVazia(n);
  for (const bloco of tipologias) {
    for (const nome of SERIES) {
      for (let i = 0; i < n; i++) totais[nome][i] += bloco.series[nome][i];
    }
  }

  return { tipologias, totais };
}

// O agregado é por TIPOLOGIA, não por SUP -- mas nada é descartado por SUP:
// os 36 SUPs do Avanços contribuem para a tipologia deles, inclusive os 13
// que a MATRIZ não conhece. Esta função só RELATA o desencontro, para o build
// imprimir. Silenciar é o que produziu o Critical da Fase 1 em linha-base.js:
// linha sem correspondência ficava indistinguível de linha legitimamente
// ausente.
function reconciliarSups(furos, registros) {
  const noAvancos = new Set((furos || []).map(f => f.sup).filter(Boolean));
  const naMatriz = new Set((registros || []).map(r => r.sup).filter(Boolean));
  const soNoAvancos = [...noAvancos].filter(s => !naMatriz.has(s));
  const soNaMatriz = [...naMatriz].filter(s => !noAvancos.has(s));
  const furosSemSupNaMatriz = (furos || []).filter(f => f.sup && !naMatriz.has(f.sup)).length;
  return { soNoAvancos, soNaMatriz, furosSemSupNaMatriz };
}

module.exports = { computeDemandas, reconciliarSups, SERIES, SERIE_ESTOQUE };
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/semanal-compute-demandas.test.js`
Expected: PASS — 20 testes.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS em tudo.

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/compute-demandas.js test/semanal-compute-demandas.test.js
git commit -m "Agregar as 5 séries mensais de demandas, com pendentes como estoque

Inclui reconciliarSups, que relata o desencontro de SUP entre o Avanços e a
MATRIZ nos dois sentidos sem descartar nenhum furo."
```

---

### Task 4: Tabela e acumulado

**Files:**
- Create: `tools/semanal/render-aba-demandas.js`
- Test: `test/semanal-render-aba-demandas.test.js`

**Interfaces:**
- Consumes: a saída de `computeDemandas` (Task 3), passada como argumento — **sem `require`**, porque este módulo entra no bundle do navegador.
- Produces: `renderAbaDemandas(demandas, modo) -> string` (HTML; `modo` é `'mensal'` ou `'acumulado'`), `acumularSerie(valores, ehEstoque) -> number[]`, `rotuloColunaFechamento(serie) -> string`, `fechamento(valores, ehEstoque, modo) -> number`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `test/semanal-render-aba-demandas.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  renderAbaDemandas, acumularSerie, rotuloColunaFechamento, fechamento,
} = require('../tools/semanal/render-aba-demandas.js');

const demandasExemplo = {
  tipologias: [
    { tipologia: 'SP', series: {
      chegadas: [10, 20, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      sondagemRealizada: [5, 10, 15, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      relatorioConcluido: [1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      canceladas: [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      pendentes: [5, 7, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6],
    } },
    { tipologia: 'ST', series: {
      chegadas: [1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      sondagemRealizada: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      relatorioConcluido: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      canceladas: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      pendentes: [1, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
    } },
  ],
  totais: {
    chegadas: [11, 21, 31, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    sondagemRealizada: [5, 10, 15, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    relatorioConcluido: [1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    canceladas: [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    pendentes: [6, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9],
  },
};

test('fluxo acumula por soma corrida', () => {
  assert.deepStrictEqual(acumularSerie([10, 20, 30], false), [10, 30, 60]);
});

test('ESTOQUE NÃO acumula: saldos 5/7/6 seguem 5/7/6, nunca 5/12/18', () => {
  assert.deepStrictEqual(acumularSerie([5, 7, 6], true), [5, 7, 6]);
});

test('acumularSerie não muta o array recebido', () => {
  const original = [1, 2, 3];
  acumularSerie(original, false);
  assert.deepStrictEqual(original, [1, 2, 3]);
});

test('o rótulo da coluna de fechamento segue a NATUREZA da série, não o modo', () => {
  assert.strictEqual(rotuloColunaFechamento('chegadas'), 'Total');
  assert.strictEqual(rotuloColunaFechamento('pendentes'), 'Saldo');
});

test('fluxo no modo mensal fecha somando os 12 meses', () => {
  assert.strictEqual(fechamento([10, 20, 30], false, 'mensal'), 60);
});

test('fluxo no modo acumulado fecha no ÚLTIMO valor, nunca somando a série já acumulada', () => {
  // [10,30,60] já é o acumulado de [10,20,30]. Somar daria 100, que não
  // significa nada -- o total do ano é 60.
  assert.strictEqual(fechamento([10, 30, 60], false, 'acumulado'), 60);
});

test('estoque fecha no saldo do último mês nos DOIS modos -- 12 saldos somados não são um total', () => {
  assert.strictEqual(fechamento([5, 7, 6], true, 'mensal'), 6);
  assert.strictEqual(fechamento([5, 7, 6], true, 'acumulado'), 6);
});

test('renderiza um bloco por série, com o rótulo em português', () => {
  const html = renderAbaDemandas(demandasExemplo, 'mensal');
  for (const rotulo of ['Demandas chegadas', 'Sondagem realizada', 'Relatório concluído', 'Canceladas', 'Pendentes']) {
    assert.ok(html.includes(rotulo), `falta o bloco "${rotulo}"`);
  }
});

test('cada bloco tem uma linha por tipologia e as 12 colunas de mês', () => {
  const html = renderAbaDemandas(demandasExemplo, 'mensal');
  assert.ok(html.includes('>SP<'));
  assert.ok(html.includes('>ST<'));
  for (const mes of ['Jan', 'Fev', 'Dez']) assert.ok(html.includes('>' + mes + '<'), `falta a coluna ${mes}`);
});

test('no modo mensal os valores são os do mês', () => {
  const html = renderAbaDemandas(demandasExemplo, 'mensal');
  assert.ok(html.includes('>30<'), 'chegadas de SP em março (30) deve aparecer cru');
});

test('no modo acumulado o fluxo aparece somado', () => {
  const html = renderAbaDemandas(demandasExemplo, 'acumulado');
  assert.ok(html.includes('>60<'), '10+20+30 = 60 em março');
});

test('no modo acumulado o estoque NÃO aparece somado', () => {
  const html = renderAbaDemandas(demandasExemplo, 'acumulado');
  assert.ok(!html.includes('>18<'), '5+7+6=18 não pode existir -- pendentes é saldo');
});

test('o bloco de estoque diz Saldo já no modo mensal, e nunca soma os 12 saldos', () => {
  const html = renderAbaDemandas(demandasExemplo, 'mensal');
  assert.ok(html.includes('>Saldo<'), 'o bloco de pendentes fecha em Saldo, não em Total');
  // Os 12 saldos de SP somados dariam 5+7+6*10 = 72; o saldo correto é 6.
  assert.ok(!html.includes('>72<'), 'somar saldo mensal é exatamente o número que este bloco evita');
});

test('o seletor Mensal/Acumulado existe e marca o modo atual', () => {
  const html = renderAbaDemandas(demandasExemplo, 'acumulado');
  assert.ok(html.includes('id="demandas-modo"'));
  assert.ok(/<option value="acumulado" selected/.test(html));
});

test('a nota do estoque de abertura aparece no bloco de pendentes', () => {
  const html = renderAbaDemandas(demandasExemplo, 'mensal');
  assert.ok(/saldo|abertura|legado/i.test(html), 'pendentes precisa explicar que carrega furo de anos anteriores');
});

test('rótulo de tipologia com caractere de HTML é escapado', () => {
  const html = renderAbaDemandas({
    tipologias: [{ tipologia: '<script>x</script>', series: demandasExemplo.tipologias[0].series }],
    totais: demandasExemplo.totais,
  }, 'mensal');
  assert.ok(!html.includes('<script>x</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('demandas sem nenhuma tipologia rende um aviso, não uma tabela vazia sem explicação', () => {
  const html = renderAbaDemandas({ tipologias: [], totais: demandasExemplo.totais }, 'mensal');
  assert.ok(/sem dado|nenhum/i.test(html));
});

test('o módulo não tem require de fora do próprio diretório -- o bundle removeria a linha', () => {
  const fs = require('node:fs');
  const fonte = fs.readFileSync(require.resolve('../tools/semanal/render-aba-demandas.js'), 'utf8');
  assert.strictEqual(/require\(['"]\.\.\//.test(fonte), false,
    'require("../...") é REMOVIDO por transformaModulo e viraria undefined no navegador');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-render-aba-demandas.test.js`
Expected: FAIL — `Cannot find module '../tools/semanal/render-aba-demandas.js'`

- [ ] **Step 3: Implementar**

Criar `tools/semanal/render-aba-demandas.js`:

```js
'use strict';

// Este módulo roda tanto no Node (testes) quanto embrulhado no navegador via
// buildBrowserBundle -- por isso 'var'/'function', não 'const'/arrow, e
// ZERO require: nem de './' nem de '../'. Um require('../comum/...') seria
// REMOVIDO por transformaModulo (tools/comum/browser-bundle.js) e o nome
// viraria undefined em produção com os testes em Node passando. Tudo o que
// este arquivo precisa chega por argumento (o agregado de
// compute-demandas.js, decifrado do blob) ou está definido aqui.
//
// escapeHtml e MESES são duplicados de propósito, seguindo o que
// render-aba-semanal.js e render-aba-balanco.js já fazem: cada módulo do
// bundle se sustenta sozinho.

var MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// Ordem e rótulo de exibição das 5 séries. A ordem é o ciclo: chegou,
// sondou, fechou relatório, morreu, está parado.
var BLOCOS = [
  { serie: 'chegadas', rotulo: 'Demandas chegadas', estoque: false },
  { serie: 'sondagemRealizada', rotulo: 'Sondagem realizada', estoque: false },
  { serie: 'relatorioConcluido', rotulo: 'Relatório concluído', estoque: false },
  { serie: 'canceladas', rotulo: 'Canceladas', estoque: false },
  { serie: 'pendentes', rotulo: 'Pendentes', estoque: true },
];

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Fluxo acumula por soma corrida. ESTOQUE não: o saldo de março não é o de
// janeiro mais o de fevereiro mais o de março -- é o saldo de março. Somar
// daria uma curva crescente e convincente, e errada. Mesma premissa que
// mediaEquipesPonderada e dividirEmSemanas já carregam para equipes.
function acumularSerie(valores, ehEstoque) {
  var entrada = valores || [];
  if (ehEstoque) return entrada.slice();
  var saida = [];
  var corrente = 0;
  for (var i = 0; i < entrada.length; i++) {
    corrente += entrada[i] || 0;
    saida.push(corrente);
  }
  return saida;
}

// O rótulo da coluna de fechamento segue a NATUREZA da série, não o modo:
// fluxo fecha em "Total", estoque em "Saldo", nos dois modos. Chamar de
// "Total" a última coluna de um estoque no modo mensal esconderia atrás de um
// rótulo justamente a soma de saldos que este módulo existe para evitar.
// Mesmo cuidado que rotuloColunaFechamento de render-aba-semanal.js toma ao
// virar "Total" em "Média" na dimensão equipes.
function rotuloColunaFechamento(serie) {
  for (var i = 0; i < BLOCOS.length; i++) {
    if (BLOCOS[i].serie === serie && BLOCOS[i].estoque) return 'Saldo';
  }
  return 'Total';
}

// Estoque fecha no saldo do último mês. Fluxo fecha na soma dos 12 no modo
// mensal -- mas no modo ACUMULADO a série que chega aqui já é a soma corrida,
// e somá-la de novo daria um número sem significado nenhum (para [10,20,30]
// o acumulado é [10,30,60], cuja soma é 100, e o total do ano é 60). No
// acumulado, portanto, o fechamento é o último valor.
function fechamento(valores, ehEstoque, modo) {
  var lista = valores || [];
  if (ehEstoque || modo === 'acumulado') return lista.length ? (lista[lista.length - 1] || 0) : 0;
  var soma = 0;
  for (var i = 0; i < lista.length; i++) soma += lista[i] || 0;
  return soma;
}

function renderCabecalho(serie) {
  var ths = '';
  for (var i = 0; i < MESES.length; i++) ths += '<th>' + MESES[i] + '</th>';
  return '<thead><tr><th></th>' + ths
    + '<th>' + escapeHtml(rotuloColunaFechamento(serie)) + '</th></tr></thead>';
}

function renderLinha(rotulo, valores, ehEstoque, modo, classe) {
  var tds = '';
  for (var i = 0; i < valores.length; i++) {
    var v = valores[i] || 0;
    tds += v === 0
      ? '<td class="num sem-dado"></td>'
      : '<td class="num">' + v + '</td>';
  }
  return '<tr class="' + classe + '">'
    + '<td class="serie-label">' + escapeHtml(rotulo) + '</td>'
    + tds
    + '<td class="num celula-total-linha">' + fechamento(valores, ehEstoque, modo) + '</td></tr>';
}

function renderBloco(bloco, demandas, modo) {
  var linhas = '';
  for (var i = 0; i < demandas.tipologias.length; i++) {
    var t = demandas.tipologias[i];
    var valores = modo === 'acumulado'
      ? acumularSerie(t.series[bloco.serie], bloco.estoque)
      : (t.series[bloco.serie] || []);
    linhas += renderLinha(t.tipologia, valores, bloco.estoque, modo, 'linha-demandas');
  }
  var totais = modo === 'acumulado'
    ? acumularSerie(demandas.totais[bloco.serie], bloco.estoque)
    : (demandas.totais[bloco.serie] || []);
  linhas += renderLinha('Total', totais, bloco.estoque, modo, 'linha-demandas linha-total-demandas');

  // Pendentes carrega furo de anos anteriores: na planilha real, 5.546 dos
  // 7.154 abertos em janeiro/2026 chegaram antes de 2026. Sem essa nota o
  // primeiro mês parece um pico inexplicável.
  var nota = bloco.estoque
    ? '<p class="nota-demandas">Saldo aberto no fim de cada mês, não um fluxo — inclui demanda de anos anteriores ainda não sondada (o estoque de abertura). Por isso não se acumula.</p>'
    : '';

  return '<section class="bloco-demandas">'
    + '<h3>' + escapeHtml(bloco.rotulo) + '</h3>'
    + nota
    + '<table class="tabela-demandas">' + renderCabecalho(bloco.serie)
    + '<tbody>' + linhas + '</tbody></table></section>';
}

function renderControles(modo) {
  var opcoes = [['mensal', 'Mensal'], ['acumulado', 'Acumulado']].map(function (par) {
    var sel = par[0] === modo ? ' selected' : '';
    return '<option value="' + par[0] + '"' + sel + '>' + par[1] + '</option>';
  }).join('');
  return '<div class="controles-demandas">'
    + '<label class="controle-demandas">Visão'
    + '<select id="demandas-modo">' + opcoes + '</select>'
    + '</label></div>';
}

// demandas: a saída de compute-demandas.js, já decifrada
// ({tipologias, totais}). modo: 'mensal' | 'acumulado'.
function renderAbaDemandas(demandas, modo) {
  var dados = demandas || { tipologias: [], totais: {} };
  if (!dados.tipologias || !dados.tipologias.length) {
    return renderControles(modo)
      + '<p class="nota-demandas">Sem dado de demandas nesta base — nenhuma tipologia veio da aba Avanços.</p>';
  }
  var blocos = '';
  for (var i = 0; i < BLOCOS.length; i++) blocos += renderBloco(BLOCOS[i], dados, modo);
  return renderControles(modo) + blocos;
}

module.exports = { renderAbaDemandas, acumularSerie, rotuloColunaFechamento, fechamento };
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/semanal-render-aba-demandas.test.js`
Expected: PASS — 18 testes.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/render-aba-demandas.js test/semanal-render-aba-demandas.test.js
git commit -m "Tabela de demandas com alternância mensal/acumulado, estoque sem somar"
```

---

### Task 5: Ligar a aba na página

**Files:**
- Modify: `tools/semanal/build-dashboard.js`
- Modify: `tools/semanal/render-semanal.js`
- Modify: `test/semanal-build-dashboard.test.js` (6 chamadas + teste de recusa)
- Modify: `test/semanal-render-semanal-wireup.test.js` (4 chamadas)
- Modify: `test/semanal-render-aba-balanco-wireup.test.js` (3 chamadas)
- Modify: `test/semanal-linha-base-costura.test.js` (1 chamada)
- Test: `test/semanal-render-aba-demandas-wireup.test.js`

**Interfaces:**
- Consumes: `parseAvancos` (Task 2), `computeDemandas` (Task 3), `renderAbaDemandas` (Task 4).
- Produces: `renderSemanal({ registros, baseline, demandas, periodos, senha, geradoEm })` — `demandas` passa a ser **obrigatório**; `build({ outPath, today, senha })` inalterado na assinatura.

- [ ] **Step 1: Escrever o teste de wire-up que falha**

Criar `test/semanal-render-aba-demandas-wireup.test.js`. Copia a montagem de `test/semanal-render-semanal-wireup.test.js` (mesmo `vm.Context`, mesmo Web Crypto nativo) e prova que a aba é montada de verdade — não só que a `<div>` existe:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { renderSemanal } = require('../tools/semanal/render-semanal.js');
const { renderAbaDemandas } = require('../tools/semanal/render-aba-demandas.js');

// Mesma prova que test/semanal-render-aba-balanco-wireup.test.js faz para a
// aba Balanço de massa: gerar a página, rodar os <script> de cliente num
// vm.Context, digitar a senha certa e conferir que #secao-demandas recebe o
// HTML EXATO que renderAbaDemandas produz. Um módulo presente no bundle mas
// nunca chamado já aconteceu neste projeto (a aba Semanal abriu vazia na
// Task 8 da Fase 1) -- este teste é o que impede a repetição.

const SENHA_FAKE = 'senha-fake-de-teste-e2e-nao-e-a-real';
const PERIODOS_2026 = Array.from({ length: 12 }, (_, mes) => new Date(Date.UTC(2026, mes, 1)));

const DEMANDAS = {
  tipologias: [{ tipologia: 'SP', series: {
    chegadas: [10, 20, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    sondagemRealizada: [5, 10, 15, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    relatorioConcluido: [1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    canceladas: [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    pendentes: [5, 7, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6],
  } }],
  totais: {
    chegadas: [10, 20, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    sondagemRealizada: [5, 10, 15, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    relatorioConcluido: [1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    canceladas: [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    pendentes: [5, 7, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6],
  },
};

function registroSintetico() {
  const zeros = new Array(12).fill(0);
  const bloco = () => ({
    equipes: zeros.slice(), volume: zeros.slice(), financeiro: zeros.slice(),
    equipesResumo: { pico: 1, media: 1, prod: 8, dias: 25 },
    volumeResumo: { total: 0, totalInicial: 0, ticket: 1 },
    financeiroResumo: { total: 0, totalInicial: 0 },
  });
  return {
    sup: 'SUP-0001-24', grupo: 'G', tomador: 'T', tipologia: 'ST',
    previsto: bloco(), realizado: bloco(), total: bloco(),
  };
}

// DOM falso e sandbox: MESMA forma de test/semanal-render-semanal-wireup.test.js
// (que é a referência do repositório para isto). Dois detalhes que precisam
// bater com ela, senão o teste não roda:
// - `addEventListener` guarda em `this.listeners[tipo]`, e é assim que o teste
//   dispara o `change` do <select> mais abaixo.
// - `window` É o objeto global do sandbox, como no navegador -- e o gate
//   (scriptDesbloqueio, da casca) define `tentarDesbloquear` nesse global.
function criarDocumentoFalso() {
  const elementos = {};
  function elemento(id) {
    if (!elementos[id]) {
      elementos[id] = {
        id, style: {}, classList: { toggle() {} }, listeners: {},
        addEventListener(tipo, fn) { this.listeners[tipo] = fn; },
        focus() {}, value: '', textContent: '', innerHTML: '', disabled: false,
      };
    }
    return elementos[id];
  }
  return { elementos, getElementById: elemento };
}

function montarSandbox(html) {
  const blocos = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  // Continua 6: a aba Demandas entra no bundle EXISTENTE (BUNDLE_ARQUIVOS) e
  // no SCRIPT_CLIENTE_SEMANAL existente -- não acrescenta <script> nenhum. Se
  // este número mudar, alguém injetou um script novo sem querer.
  assert.equal(blocos.length, 6, 'esperava 6 <script> (vigenteIdx, dados cifrados, gate, fonteParaCliente, bundle, cliente)');
  const documentoFalso = criarDocumentoFalso();
  const sandbox = { document: documentoFalso, atob, btoa, crypto, TextEncoder, TextDecoder, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(blocos.join('\n;\n'), sandbox, { filename: 'planejamento-semanal-cliente.js' });
  return { sandbox, documentoFalso };
}

function paginaComDemandas() {
  return renderSemanal({
    registros: [registroSintetico()], baseline: [], demandas: DEMANDAS,
    periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm: new Date(Date.UTC(2026, 6, 15)),
  });
}

test('#secao-demandas recebe o HTML exato de renderAbaDemandas depois da senha certa', async () => {
  const html = paginaComDemandas();
  // Antes de qualquer script a seção está vazia: nada pode ser montado em
  // build-time, fora do gate -- seria dado de cliente num Pages público.
  assert.match(html, /<div id="secao-demandas" style="display:none"><\/div>/);

  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  assert.equal(typeof sandbox.tentarDesbloquear, 'function');
  await sandbox.tentarDesbloquear();

  const montado = documentoFalso.getElementById('secao-demandas').innerHTML;
  assert.notEqual(montado, '', '#secao-demandas vazia depois da senha certa reproduz o bug da aba Semanal na Fase 1');
  assert.equal(montado, renderAbaDemandas(DEMANDAS, 'mensal'),
    'precisa ser exatamente o que renderAbaDemandas(demandas decifradas, "mensal") produz -- prova que os argumentos batem, não só que ALGUM HTML foi injetado');
});

test('os NÚMEROS das demandas viajam DENTRO do blob cifrado -- nunca soltos no HTML', () => {
  const html = paginaComDemandas();
  // O rótulo "Demandas chegadas" existe no HTML cru porque render-aba-demandas.js
  // vai inteiro no bundle (é código, não dado) -- o que NÃO pode aparecer é
  // qualquer número real da agregação fora do blob cifrado. A prova é o mesmo
  // tipo que test/semanal-render-semanal-wireup.test.js já faz para os
  // registros: procurar o dado, não o rótulo.
  const semBlob = html.replace(/window\.__DADOS_CIFRADOS__ = [\s\S]*?;/, '');
  assert.strictEqual(/>\s*7154\s*</.test(semBlob), false, 'saldo real vazando no markup');
  assert.strictEqual(semBlob.includes('"chegadas":[10,20,30'), false, 'série real vazando no markup');
});

test('renderSemanal sem demandas LANÇA em vez de publicar uma aba vazia em silêncio', () => {
  assert.throws(() => renderSemanal({
    registros: [registroSintetico()], baseline: [],
    periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm: new Date(Date.UTC(2026, 6, 15)),
  }), /demandas/);
});

test('trocar o seletor para acumulado redesenha a seção, e o listener sobrevive à segunda troca', async () => {
  const { sandbox, documentoFalso } = montarSandbox(paginaComDemandas());
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  documentoFalso.getElementById('demandas-modo').listeners.change({ target: { value: 'acumulado' } });
  assert.equal(documentoFalso.getElementById('secao-demandas').innerHTML, renderAbaDemandas(DEMANDAS, 'acumulado'));

  // O <select> é recriado a cada innerHTML, então o listener tem que ser
  // religado depois de cada montagem -- mesmo motivo já documentado em
  // montarAbaBalanco. Sem isso, a segunda troca não faz nada e o bug passa
  // desapercebido num teste que só troca uma vez.
  documentoFalso.getElementById('demandas-modo').listeners.change({ target: { value: 'mensal' } });
  assert.equal(documentoFalso.getElementById('secao-demandas').innerHTML, renderAbaDemandas(DEMANDAS, 'mensal'));
});

test('a aba Demandas aparece no seletor de abas, sem quebrar as duas existentes', () => {
  const html = paginaComDemandas();
  for (const id of ['aba-semanal', 'aba-balanco', 'aba-demandas']) {
    assert.ok(html.includes('id="' + id + '"'), `falta o botão ${id}`);
  }
  assert.ok(html.includes('>Demandas<'));
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-render-aba-demandas-wireup.test.js`
Expected: FAIL — `renderSemanal` ainda não conhece `demandas`; `#secao-demandas` fica vazio.

- [ ] **Step 3: Modificar `render-semanal.js`**

Cinco edições, todas aditivas. Localize pelo texto-âncora, não por número de linha.

1. Terceira entrada em `ABAS_VISUALIZACAO`, depois da entrada `aba-balanco`:

```js
  { id: 'aba-demandas', rotulo: 'Demandas', ativa: false,
    svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>' },
```

2. CSS próprio, ao lado de `CSS_SEMANAL`/`CSS_BALANCO` (e pelo mesmo motivo: `cssBase()` é compartilhada com o orçamento e `test/orcamento-html-inalterado.test.js` trava o HTML dele byte a byte):

```js
const CSS_DEMANDAS = `
  .controles-demandas { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 16px; margin-bottom: 20px; }
  .controle-demandas { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--text-secondary); }
  .controle-demandas select {
    padding: 8px 30px 8px 10px; height: 36px;
    border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface-1) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23c3c2b7' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 10px center;
    color: var(--text-primary); font-size: 13px; cursor: pointer;
    appearance: none; -webkit-appearance: none; -moz-appearance: none;
  }
  .bloco-demandas { margin-bottom: 28px; }
  .bloco-demandas h3 { font-size: 14px; margin: 0 0 6px; color: var(--text-primary); }
  .nota-demandas { font-size: 12px; color: var(--text-secondary); margin: 0 0 10px; max-width: 70ch; }
  .tabela-demandas { width: 100%; border-collapse: collapse; }
  .tabela-demandas th, .tabela-demandas td { padding: 6px 8px; font-size: 12px; }
  .tabela-demandas .num { text-align: right; }
  .linha-total-demandas td { font-weight: 600; border-top: 1px solid var(--border); }
`;
```

3. `render-aba-demandas.js` no fim de `BUNDLE_ARQUIVOS` (ele não consome nenhum outro módulo do bundle, então a posição é livre; no fim é o menor diff):

```js
const BUNDLE_ARQUIVOS = ['compute-semanal.js', 'render-aba-semanal.js', 'compute-balanco.js', 'render-aba-balanco.js', 'render-aba-demandas.js'];
```

4. No `SCRIPT_CLIENTE_SEMANAL`: guardar o módulo, guardar o estado, desembrulhar `demandas` no gate, ligar a aba e montar a seção. `fecharTendenciaVigente` é onde o payload decifrado é aberto — **sem a linha de `__DEMANDAS__` a aba monta vazia**, exatamente como aconteceu com `__BASELINE__` na Fase 1:

```js
var RenderAbaDemandas = MODULOS['render-aba-demandas.js'];

var MODO_DEMANDAS = 'mensal';
```

Em `fecharTendenciaVigente`, acrescentar antes do `return`:

```js
  window.__DEMANDAS__ = dados && dados.demandas;
```

Em `alternarAba`, duas linhas a mais (a função é escrita aba por aba, não genérica — mantida assim de propósito, para o merge com a Fase 2 ficar trivial):

```js
  document.getElementById('secao-demandas').style.display = aba === 'demandas' ? '' : 'none';
  document.getElementById('aba-demandas').classList.toggle('aba-ativa', aba === 'demandas');
```

Nova função, ao lado de `montarAbaBalanco` (o listener é religado a cada `innerHTML` porque o `<select>` é recriado junto com a seção — mesmo motivo já documentado em `montarAbaBalanco`):

```js
function montarAbaDemandas() {
  document.getElementById('secao-demandas').innerHTML =
    RenderAbaDemandas.renderAbaDemandas(window.__DEMANDAS__, MODO_DEMANDAS);
  document.getElementById('demandas-modo').addEventListener('change', function (e) {
    MODO_DEMANDAS = e.target.value;
    montarAbaDemandas();
  });
}
```

Em `montarDashboard`, o listener e a montagem:

```js
  document.getElementById('aba-demandas').addEventListener('click', function () { alternarAba('demandas'); });
  montarAbaDemandas();
```

5. Na assinatura e no corpo de `renderSemanal`: aceitar `demandas`, exigi-lo, e incluí-lo no payload cifrado. Também a `<div>` da seção e o `<style>`:

```js
function renderSemanal({ registros, baseline, demandas, periodos, senha, geradoEm }) {
```

Esta checagem entra **depois** da de `periodos` — há um teste existente que chama `renderSemanal` sem `periodos` e exige que a mensagem cite `periodos` (ver Step 5):

```js
  if (!demandas || !Array.isArray(demandas.tipologias)) {
    throw new Error('renderSemanal requer "demandas" ({tipologias, totais}, de tools/semanal/compute-demandas.js) -- sem isso a aba Demandas montaria vazia no navegador sem nenhum erro no build.');
  }
```

```js
  const dadosJson = JSON.stringify({ registros, baseline, demandas });
```

```html
    <div id="secao-demandas" style="display:none"></div>
```

```
${CSS_DEMANDAS}
```

- [ ] **Step 4: Modificar `build-dashboard.js`**

Acrescentar os requires e a leitura, e passar `demandas` para `renderSemanal`:

```js
const { parseAvancos } = require('./parse-avancos.js');
const { computeDemandas, reconciliarSups } = require('./compute-demandas.js');
const configDemandas = require('./config-demandas.js');
```

Dentro de `build()`, depois do `baseline` e antes do `renderSemanal`:

```js
  // Terceira fonte desta página, e a única de EXECUÇÃO (uma linha por furo).
  // Falha com o caminho na mensagem em vez de deixar vazar um ENOENT cru: um
  // caminho errado em cache já travou uma sessão inteira neste projeto (ver
  // CLAUDE.md, item da aba Gerencial).
  let gridAvancos;
  try {
    gridAvancos = readXlsxSheet(configDemandas.caminhoArquivo, configDemandas.nomeAba);
  } catch (err) {
    throw new Error(`Não consegui ler a aba "${configDemandas.nomeAba}" de ${configDemandas.caminhoArquivo} (o Google Drive está montado em G:?). Erro original: ${err.message}`);
  }
  const { furos, descartadas, semDataTermino } = parseAvancos(gridAvancos);
  const demandas = computeDemandas(furos, periodos);
  console.log(`Demandas: ${furos.length} furos lidos, ${descartadas} linha(s) vazia(s) descartada(s), ${semDataTermino} furo(s) concluído(s) sem data de término (nunca saem do estoque).`);

  // Relatório dos DOIS lados do desencontro de SUP. Nada é descartado -- isto
  // é só visibilidade, e existe porque silenciar o que não casa foi o Critical
  // da Fase 1 (ver tools/comum/linha-base.js).
  const sups = reconciliarSups(furos, registros);
  console.log(`Demandas/SUP: ${sups.furosSemSupNaMatriz} furo(s) em ${sups.soNoAvancos.length} SUP(s) que a MATRIZ não tem (${sups.soNoAvancos.join(', ') || 'nenhum'}); ${sups.soNaMatriz.length} SUP(s) da MATRIZ sem nenhum furo (${sups.soNaMatriz.join(', ') || 'nenhum'}).`);
```

E na chamada:

```js
  const html = renderSemanal({ registros, baseline, demandas, periodos, senha, geradoEm: today });
```

- [ ] **Step 5: Atualizar os QUATRO testes existentes que chamam `renderSemanal`**

Tornar `demandas` obrigatório quebra **14 chamadas em 4 arquivos**. Todas as quatro precisam da constante abaixo no topo e de `demandas: DEMANDAS_VAZIAS` na chamada:

```js
// A aba Demandas passou a ser obrigatória no payload (renderSemanal lança sem
// ela, de propósito -- ver o comentário lá). Agregado mínimo válido: sem
// tipologia nenhuma, renderAbaDemandas rende o aviso de "sem dado".
const DEMANDAS_VAZIAS = { tipologias: [], totais: {} };
```

| Arquivo | Chamadas |
|---|---|
| `test/semanal-build-dashboard.test.js` | 6 (linhas 39, 56, 63, 107, 126, 149) mais a do teste de recusa, no Step abaixo |
| `test/semanal-render-semanal-wireup.test.js` | 4 (101, 147, 159, 170) |
| `test/semanal-render-aba-balanco-wireup.test.js` | 3 (111, 167, 199) |
| `test/semanal-linha-base-costura.test.js` | 1 (184) |

Os números de linha valem para o HEAD no início desta tarefa; localize por `renderSemanal({`.

**A ordem das validações importa.** `test/semanal-build-dashboard.test.js` tem este teste, que chama `renderSemanal` **sem** `periodos` e exige que a mensagem cite `periodos`:

```js
test('renderSemanal recusa build sem "periodos" -- sem eles não dá para decidir o mês vigente sem chutar o ano', () => {
  assert.throws(
    () => renderSemanal({ registros: REGISTROS, baseline: [], senha: 'fake', geradoEm: new Date(0) }),
    /periodos/
  );
});
```

Duas consequências: a checagem de `demandas` entra **depois** da de `periodos` em `renderSemanal`, e esta chamada também ganha `demandas: DEMANDAS_VAZIAS` — senão ela passa a falhar por `demandas` e o `/periodos/` não casa.

- [ ] **Step 5b: Cobrir a terceira aba no wireup existente**

Em `test/semanal-render-semanal-wireup.test.js`, `montarSandbox` afirma `blocos.length === 6`. **Esse número não muda** — a aba nova entra no `BUNDLE_ARQUIVOS` e no `SCRIPT_CLIENTE_SEMANAL` que já existem, sem `<script>` novo. Se ele quebrar, algum script foi injetado sem intenção.

Acrescente ali um teste de que a troca de abas continua exclusiva com três abas:

```js
test('com três abas, abrir Demandas esconde as outras duas seções -- alternarAba continua exclusiva', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const html = renderSemanal({
    registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z'),
  });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  documentoFalso.getElementById('aba-demandas').listeners.click();
  assert.equal(documentoFalso.getElementById('secao-demandas').style.display, '');
  assert.equal(documentoFalso.getElementById('secao-semanal').style.display, 'none');
  assert.equal(documentoFalso.getElementById('secao-balanco').style.display, 'none');

  documentoFalso.getElementById('aba-semanal').listeners.click();
  assert.equal(documentoFalso.getElementById('secao-demandas').style.display, 'none');
  assert.equal(documentoFalso.getElementById('secao-semanal').style.display, '');
});
```

- [ ] **Step 6: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS em tudo — inclusive `orcamento-html-inalterado` (nada aqui toca o orçamento) e `publicacao-docs-sincronizado` (que compara `dist/` com `docs/`, ambos ainda intocados nesta tarefa).

- [ ] **Step 7: Commit**

```bash
git add tools/semanal/render-semanal.js tools/semanal/build-dashboard.js \
  test/semanal-render-aba-demandas-wireup.test.js test/semanal-build-dashboard.test.js \
  test/semanal-render-semanal-wireup.test.js test/semanal-render-aba-balanco-wireup.test.js \
  test/semanal-linha-base-costura.test.js
git commit -m "Ligar a aba Demandas: payload cifrado, seletor de aba e montagem no cliente"
```

---

### Task 6: Sanidade contra a planilha real

**Files:**
- Test: `test/semanal-demandas-planilha-real.test.js`

**Interfaces:**
- Consumes: `config-demandas.js` (Task 2), `parseAvancos` (Task 2), `computeDemandas` (Task 3), `readXlsxSheet` (`tools/comum/xlsx-reader.js`).
- Produces: nada — é só rede de segurança.

- [ ] **Step 1: Escrever o teste**

Criar `test/semanal-demandas-planilha-real.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { readXlsxSheet } = require('../tools/comum/xlsx-reader.js');
const { parseAvancos } = require('../tools/semanal/parse-avancos.js');
const { computeDemandas } = require('../tools/semanal/compute-demandas.js');
const config = require('../tools/semanal/config-demandas.js');

// Toda a suíte acima roda sobre fixture sintética, o que prova a LÓGICA mas
// não o MAPEAMENTO: um nome de coluna errado, um status escrito de outro
// jeito ou uma tipologia nova passariam inteiros. Este arquivo é a única
// prova contra a planilha de verdade -- e por isso depende do Google Drive
// montado em G:. Sem G:, PULA em vez de falhar: as outras 5 tarefas deste
// plano rodam em qualquer máquina, e um colaborador sem acesso ao Drive não
// pode ficar com a suíte vermelha (ver docs/onboarding-colaborador.md).
//
// Os números vêm da medição de 2026-07-29. Eles MUDAM quando a planilha é
// atualizada: se este teste falhar depois de uma atualização, confira a
// diferença antes de mexer no número -- é justamente aqui que uma tipologia
// nova ou um status novo aparece pela primeira vez.
const TEM_DRIVE = fs.existsSync(config.caminhoArquivo);
const PERIODOS_2026 = Array.from({ length: 12 }, (_, mes) => new Date(Date.UTC(2026, mes, 1)));

test('a planilha real é lida e agregada com os números medidos em 2026-07-29', { skip: TEM_DRIVE ? false : 'G: não montado -- este teste só roda com o Drive disponível' }, () => {
  const grid = readXlsxSheet(config.caminhoArquivo, config.nomeAba);
  const { furos, descartadas } = parseAvancos(grid);

  assert.strictEqual(descartadas, 21, '21 linhas vazias na planilha de 2026-07-29');
  assert.ok(furos.length > 61000, `esperava mais de 61 mil furos, li ${furos.length}`);

  const demandas = computeDemandas(furos, PERIODOS_2026);
  const soma = serie => demandas.totais[serie].reduce((a, b) => a + b, 0);

  assert.strictEqual(soma('chegadas'), 16570, 'demandas chegadas em 2026');
  assert.strictEqual(soma('sondagemRealizada'), 15387, 'sondagem realizada em 2026');
  assert.strictEqual(soma('relatorioConcluido'), 14753, 'relatório concluído em 2026');
  assert.strictEqual(soma('canceladas'), 1902, 'canceladas em 2026, ancoradas em Atualizado');

  assert.strictEqual(demandas.totais.pendentes[0], 7154, 'saldo de janeiro');
  assert.strictEqual(demandas.totais.pendentes[11], 6176, 'saldo de dezembro');
});

test('nenhuma tipologia crua da planilha real fica fora do mapa', { skip: TEM_DRIVE ? false : 'G: não montado' }, () => {
  const grid = readXlsxSheet(config.caminhoArquivo, config.nomeAba);
  // parseAvancos LANÇA em tipologia desconhecida (com o número da linha) --
  // este teste existe para que essa falha apareça como teste vermelho, e não
  // só quando alguém rodar o build.
  assert.doesNotThrow(() => parseAvancos(grid));
});
```

- [ ] **Step 2: Rodar**

Run: `node --test test/semanal-demandas-planilha-real.test.js`
Expected: com `G:` montado, PASS nos 2 testes. Sem `G:`, os 2 aparecem como `skipped` — nunca como falha.

Se algum número divergir, **não ajuste o número para o que saiu**: confira primeiro se a planilha foi atualizada desde 2026-07-29 (`ls -la` no caminho) e, se foi, atualize os números **e** o comentário com a nova data de medição.

- [ ] **Step 3: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS em tudo.

- [ ] **Step 4: Commit**

```bash
git add test/semanal-demandas-planilha-real.test.js
git commit -m "Travar os números da planilha real, pulando quando o G: não existe"
```

---

### Task 7: Construir, verificar e publicar

**Files:**
- Modify: `CLAUDE.md`
- Build: `dist/planejamento-semanal.html`, `docs/planejamento-semanal.html`

**Interfaces:**
- Consumes: todo o resto do plano.
- Produces: a página publicada.

Esta tarefa **precisa** do Google Drive montado em `G:` e da senha real (`ORCAMENTO_SENHA`, pedir ao dono do projeto — nunca escrever em arquivo).

- [ ] **Step 1: Construir as duas páginas**

```bash
ORCAMENTO_SENHA='<a senha real>' node tools/semanal/build-dashboard.js
ORCAMENTO_SENHA='<a senha real>' node tools/orcamento/build-dashboard.js
```

Expected: a saída do build da semanal traz a linha nova `Demandas: ... furos lidos, 21 linha(s) vazia(s) descartada(s), ...`. O build do orçamento roda para confirmar que continua igual — ele **não** deveria ter mudado.

- [ ] **Step 2: Conferir a página à mão**

Abra `dist/planejamento-semanal.html`, destrave com a senha e confirme:

1. A terceira aba **Demandas** existe e abre.
2. Os 5 blocos aparecem, na ordem: Demandas chegadas, Sondagem realizada, Relatório concluído, Canceladas, Pendentes.
3. Trocar a Visão para **Acumulado** faz os fluxos crescerem mês a mês e **não** muda a linha de Pendentes.
4. No Acumulado, a última coluna do bloco Pendentes diz **Saldo**, não Total.
5. `SEG.A`/`SEG.V` aparecem só se houver acionamento; `LAB.C`/`LAB.E` aparecem zerados.
6. As abas Semanal e Balanço de massa continuam funcionando como antes.

- [ ] **Step 3: Copiar para `docs/` — o Pages serve `/docs`, não `/dist`**

```bash
cp dist/planejamento-semanal.html docs/planejamento-semanal.html
cp dist/orcamento-dashboard.html docs/index.html
```

Sem isso o site segue servindo o build anterior **reportando deploy bem-sucedido** — foi o incidente de 2026-07-22. `test/publicacao-docs-sincronizado.test.js` trava essa cópia para as duas páginas.

- [ ] **Step 4: Rodar a suíte inteira uma última vez**

Run: `node --test test/*.test.js`
Expected: PASS em tudo, incluindo `publicacao-docs-sincronizado` (agora comparando os arquivos recém-copiados).

- [ ] **Step 5: Documentar no `CLAUDE.md`**

Na seção "Planejamento Semanal", acrescentar a fonte nova e as três armadilhas de dados que custaram medição para descobrir:

```markdown
### Aba Demandas (base do Avanço Sond)

Terceira aba da página semanal, alimentada por
`Dados e extratos\Extratos Sond\Avanço Sond.xlsx`, aba `Avanços` (61.927 linhas, uma por
furo) — ver `tools/semanal/config-demandas.js`. É a única fonte de EXECUÇÃO do repositório;
as outras duas são mensais. Cinco séries em quantidade de furos, mensal e acumulado.

Três coisas da planilha que parecem bug e não são:

- **A coluna `P` ("Cancelamento") não é data de cancelamento.** Está vazia em todas as 4.331
  linhas CANCELADO e preenchida em todas as 50.662 CONCLUIDO, cerca de um ano depois da
  conclusão. Canceladas ancoram em `Q` (Atualizado), a única data que existe nelas — é um
  proxy declarado, não um fato.
- **798 das 811 linhas EXECUTADO têm data de Conclusão preenchida**, embora EXECUTADO
  signifique "relatório ainda por fazer". A série de relatório filtra por
  `status = CONCLUIDO`, nunca pela presença da data.
- **Pendentes é estoque, não fluxo:** no acumulado mostra o saldo do mês, nunca a soma.
  Cancelada sai do saldo por status (não há data), então o saldo histórico subestima em até
  4.331 furos no pior caso. Está no spec.

`tools/comum/tipologias-avancos.js` mapeia os 21 rótulos crus nos 10 da MATRIZ mais
`SP.F`/`SM.A` (independentes), `SEG.A`/`SEG.V` (só quando acionadas) e `Especiais`. Rótulo
novo **falha o build de propósito** — não caia calado em Especiais.
```

- [ ] **Step 6: Commit e publicar**

```bash
git add CLAUDE.md dist/planejamento-semanal.html docs/planejamento-semanal.html
git commit -m "Publicar a aba Demandas e documentar a fonte Avanço Sond"
git push origin demandas-base
```

Publicação: `origin/master` é o que o Pages serve, e o `docs/onboarding-colaborador.md` pede
branch + PR porque há três pessoas empurrando no mesmo repositório. Abra o PR:

```bash
gh pr create --base master --head demandas-base --title "Base de demandas e realizado (aba Demandas)" --body "Implementa docs/superpowers/specs/2026-07-29-base-demandas-realizado-design.md"
```

- [ ] **Step 7: Verificar o deploy pelo conteúdo, não pelo status**

Depois do merge do PR em `master`:

```bash
curl -s https://amcaccere261283.github.io/orcamento-dashboard/planejamento-semanal.html | grep -c 'aba-demandas'
```

Expected: 1 ou mais. A API de builds do Pages reporta "built" mesmo quando `/docs` não mudou
— confira sempre pelo conteúdo da URL ao vivo.
