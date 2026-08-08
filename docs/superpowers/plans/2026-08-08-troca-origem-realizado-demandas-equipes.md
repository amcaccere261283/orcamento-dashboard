# Troca de origem — Realizado, Demandas e Equipes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar as fontes de dados online do Planejamento Semanal (Realizado, Demandas de sondagem/lab, Equipes) por 7 URLs novas de sond.com.br + a planilha "Equipes" do Google Sheets, sem quebrar nenhum dos consumidores existentes (Tabela Semanal, Gráficos, Balanço, Alertas, Consolidado).

**Architecture:** Cada fonte nova ganha um *mapeador puro* (grid bruto → grid sintético no MESMO layout de colunas que `parse-avancos.js`/`parse-lab.js` já exigem, ou eventos já resolvidos) e um *fetcher impuro* (CDP + Google Sheets via `gviz`, grava CSV em `dist/`). `build-dashboard.js` lê os CSVs e chama os parsers/compute existentes sem modificação, exceto `compute-demandas.js` (ganha chegada/pendentes de laboratório) e o pipeline de Equipes (troca de fonte completa). Cache em disco (`dist/cache/`) evita rebuscar meses fechados de Realizado.

**Tech Stack:** Node.js (`node:test`), CDP (`tools/semanal/cdp-client.js`), Google Sheets `gviz` CSV export, sem dependências novas de npm.

## Global Constraints

- Sem `npm install` — o projeto não usa dependências externas (ver `docs/setup-nova-maquina.md` do repo pai).
- Testes: `node --test test/*.js`.
- `ORCAMENTO_SENHA` nunca em arquivo do repositório — só env var (regra do CLAUDE.md).
- Toda função pura testada sem rede; scripts `atualizar-*-online.js` não têm teste automatizado direto (mesmo padrão do resto do projeto) — só os mapeadores que eles chamam.
- Especificação completa: `docs/superpowers/specs/2026-08-08-troca-origem-realizado-demandas-equipes-design.md`.
- Classificação LAB.C/LAB.E: onde a tabela do Frcst e o mapa atual do `tools/comum/tipologias-lab.js` divergem, **vale o Frcst** (decidido com o usuário).

---

## Task 1: Consolidar o mapa LAB.C/LAB.E com a tabela do Frcst

**Files:**
- Modify: `tools/comum/tipologias-lab.js`
- Test: `test/comum-tipologias-lab.test.js`

**Interfaces:**
- Produces: `MAPA_TIPO_ENSAIO_LAB` (objeto `{ [tipoEnsaio: string]: 'LAB.C' | 'LAB.E' }`), `classificarEnsaioLab(tipoEnsaioCru)` — sem mudança de assinatura, só o conteúdo do mapa.

- [ ] **Step 1: Escrever o teste que trava os 9 valores corrigidos e os pares novos**

Adicionar ao fim de `test/comum-tipologias-lab.test.js`:

```javascript
test('9 rótulos que divergiam do Frcst Novo 2.xlsx agora seguem o Frcst (decidido com o usuário em 2026-08-08)', () => {
  const esperado = {
    'M.ESP.A': 'LAB.E', 'COMP.D.3': 'LAB.E', 'COMP.R': 'LAB.E', 'MCT.C': 'LAB.E',
    DP: 'LAB.E', PH: 'LAB.E', 'T.ORG': 'LAB.E', 'COMP.EM.3': 'LAB.C', 'COMP.EN.3': 'LAB.C',
  };
  for (const [tipo, destino] of Object.entries(esperado)) {
    assert.strictEqual(classificarEnsaioLab(tipo), destino, tipo);
  }
});

test('pares do Frcst ausentes do mapa antigo entram sem quebrar os já existentes', () => {
  // Amostra dos pares novos (Frcst tem 125, o mapa antigo tinha ~60).
  assert.strictEqual(classificarEnsaioLab('CBR.1'), 'LAB.C');
  assert.strictEqual(classificarEnsaioLab('DSS'), 'LAB.E');
  assert.strictEqual(classificarEnsaioLab('LWD'), 'LAB.E');
  assert.strictEqual(classificarEnsaioLab('RES.COMP.SIM'), 'LAB.E');
  // Rótulos já existentes que NÃO mudaram continuam iguais.
  assert.strictEqual(classificarEnsaioLab('LL'), 'LAB.C');
  assert.strictEqual(classificarEnsaioLab('TRI4.CD'), 'LAB.E');
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node --test test/comum-tipologias-lab.test.js`
Expected: FAIL nos dois testes novos (valores antigos ou rótulos ausentes do mapa).

- [ ] **Step 3: Substituir `MAPA_TIPO_ENSAIO_LAB` pelo conteúdo consolidado**

Em `tools/comum/tipologias-lab.js`, trocar o objeto `MAPA_TIPO_ENSAIO_LAB` (linhas 17-93) pelos 125 pares extraídos da query `Mapa Tipo SONDAGEM` do `Frcst Novo 2.xlsx`, mantendo só os que terminam em `LAB.C`/`LAB.E` (os outros pares desse mapa são tipos de campo, fora do escopo deste arquivo) e atualizando o comentário de cabeçalho:

```javascript
// Consolidado em 2026-08-08 com a tabela "Mapa Tipo SONDAGEM" do
// Frcst Novo 2.xlsx (Desktop, 125 pares, fonte 2026-07-30) -- onde os dois
// mapas divergiam (9 rótulos), decidido com o usuário que o Frcst prevalece
// (mais recente e mais completo). Ver
// docs/superpowers/specs/2026-08-08-troca-origem-realizado-demandas-equipes-design.md.
const MAPA_TIPO_ENSAIO_LAB = {
  'ABR.LA': 'LAB.E', ABSOR: 'LAB.E', 'ADENS.CD': 'LAB.E', 'ADENS.CS': 'LAB.E',
  'ADENS.I.9': 'LAB.E', 'ADENS.N.9': 'LAB.E', 'ADENS.PE': 'LAB.E', 'ADES.A': 'LAB.E',
  'APR.P': 'LAB.E', 'AV.DURAB': 'LAB.E',
  'CBR.1': 'LAB.C', 'CBR.3': 'LAB.C', 'CBR.5': 'LAB.C',
  'CD.IN': 'LAB.E', 'CD.NAT': 'LAB.E', 'CD3.IN': 'LAB.E', 'CD3.NAT': 'LAB.E',
  'CD4.IN': 'LAB.E', 'CD4.NAT': 'LAB.E', 'CD5.IN': 'LAB.E', 'CD5.NAT': 'LAB.E', 'CDA.IN': 'LAB.E',
  'COMP.D': 'LAB.E', 'COMP.D.14D': 'LAB.E', 'COMP.D.28d': 'LAB.E', 'COMP.D.28D.2': 'LAB.E',
  'COMP.D.28D.3': 'LAB.E', 'COMP.D.3': 'LAB.E', 'COMP.D.7d': 'LAB.E', 'COMP.D.7D.2': 'LAB.E',
  'COMP.D.7D.3': 'LAB.E', 'COMP.DIA': 'LAB.E',
  'COMP.EI.3': 'LAB.C', 'COMP.EI.5': 'LAB.C', 'COMP.EM.3': 'LAB.C', 'COMP.EM.5': 'LAB.C',
  'COMP.EN.3': 'LAB.C', 'COMP.EN.5': 'LAB.C',
  'COMP.NC': 'LAB.E', 'COMP.R': 'LAB.E', 'COMP.S': 'LAB.E', 'COMP.S.14D': 'LAB.E',
  'COMP.S.28d': 'LAB.E', 'COMP.S.28D.2': 'LAB.E', 'COMP.S.28D.3': 'LAB.E', 'COMP.S.3d': 'LAB.E',
  'COMP.S.3d.2': 'LAB.E', 'COMP.S.3d.3': 'LAB.E', 'COMP.S.7d': 'LAB.E', 'COMP.S.7D.2': 'LAB.E',
  'COMP.S.7D.3': 'LAB.E',
  'D.HILF': 'LAB.C', 'D.NAT.L': 'LAB.E', DISSIP: 'LAB.E', 'DOSAG.': 'LAB.E', DP: 'LAB.E',
  DRX: 'LAB.E', DSS: 'LAB.E', DUR: 'LAB.E', DURAB: 'LAB.E',
  'E.CAN': 'LAB.E', 'EQ.A': 'LAB.E',
  'IND.F.P': 'LAB.E', 'IND.VAZ': 'LAB.E',
  LL: 'LAB.C', 'LOAD.TEST': 'LAB.E', LP: 'LAB.C', LWD: 'LAB.E',
  'M.ESP': 'LAB.C', 'M.ESP.A': 'LAB.E', 'MCT.C': 'LAB.E', 'MCT.P': 'LAB.C', 'MOLD.CP': 'LAB.C',
  'MR.A': 'LAB.E', 'MR.C': 'LAB.E', 'MR.G': 'LAB.E', 'MR.S': 'LAB.E',
  PEN: 'LAB.C', 'PERM.C': 'LAB.E', 'PERM.V': 'LAB.E', PH: 'LAB.E',
  'RES.COMP.SIM': 'LAB.E',
  SED: 'LAB.C',
  'T.ARG': 'LAB.E', 'T.ORG': 'LAB.E',
  'TRI.CD': 'LAB.E', 'TRI.CD4': 'LAB.E', 'TRI.CU': 'LAB.E', 'TRI.CU4': 'LAB.E',
  'TRI.PN': 'LAB.E', 'TRI.UU': 'LAB.E',
  'TRI2.CD': 'LAB.E', 'TRI2.CU': 'LAB.E', 'TRI2.UU': 'LAB.E',
  'TRI3. CU': 'LAB.E', 'TRI3.CD': 'LAB.E', 'TRI3.CU': 'LAB.E', 'TRI3.UU': 'LAB.E',
  'TRI4.CD': 'LAB.E', 'TRI4.CU': 'LAB.E', 'TRI4.UU': 'LAB.E',
  'TRI5.CD': 'LAB.E', 'TRI5.CU': 'LAB.E', 'TRI5.UU': 'LAB.E',
  'UMID.N': 'LAB.C', 'UMID.N.L': 'LAB.C',
};
```

Nota: `BQ`, `CPTU`, `DN`, `PI`, `PZ.SM`, `PZ.SP`, `SEG.A`, `SEG.V`, `SH`, `SM`, `SM.A`, `SM.F`,
`SP`, `SP.F`, `SR`, `ST`, `VT`, `BL` do mapa do Frcst **não** entram aqui — são tipos de
campo, já cobertos por `tools/comum/tipologias-avancos.js`, não ensaios de laboratório.

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --test test/comum-tipologias-lab.test.js`
Expected: PASS (todos, inclusive os testes já existentes — nenhum rótulo saiu do mapa).

- [ ] **Step 5: Rodar a suíte inteira (regressão em quem consome este mapa)**

Run: `node --test test/*.js`
Expected: PASS. `test/semanal-compute-demandas.test.js` e `test/semanal-parse-lab.test.js` não usam os 9 rótulos que mudaram, não deveriam quebrar.

- [ ] **Step 6: Commit**

```bash
git add tools/comum/tipologias-lab.js test/comum-tipologias-lab.test.js
git commit -m "Consolida mapa LAB.C/LAB.E com a tabela de 125 pares do Frcst Novo 2.xlsx"
```

---

## Task 2: `cdp-client.js` ganha um fetch de texto genérico (para o Google Sheets)

**Files:**
- Modify: `tools/semanal/cdp-client.js`
- Test: `test/semanal-cdp-client.test.js` (novo)

**Interfaces:**
- Produces: `fetchTexto(session, urlAbsoluta)` — busca uma URL ABSOLUTA (diferente de `fetchJson`, que busca um `urlPath` relativo ao site já aberto) no contexto da página e devolve o texto cru. Usada para o export `gviz` do Google Sheets, que é um domínio diferente de `sond.com.br`.

- [ ] **Step 1: Escrever o teste (com um WebSocket falso, sem rede)**

Criar `test/semanal-cdp-client.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert');

// cdp-client.js usa `WebSocket` global (disponível no Node >= 22 sem import).
// Este teste substitui a classe global por uma dublê que responde
// Runtime.evaluate na hora, sem abrir socket nenhum -- mesmo objetivo de
// testar fetchTexto (que só monta a expressão a ser avaliada) sem depender
// de um Chrome real rodando.
class WebSocketFalso {
  constructor() {
    this.listeners = {};
    this.readyState = 1; // OPEN
    setTimeout(() => this._emit('open'), 0);
  }
  addEventListener(evento, cb) { (this.listeners[evento] ||= []).push(cb); }
  _emit(evento, dado) { (this.listeners[evento] || []).forEach((cb) => cb(dado)); }
  send(mensagemJson) {
    const msg = JSON.parse(mensagemJson);
    if (msg.method !== 'Runtime.evaluate') {
      setTimeout(() => this._emit('message', { data: JSON.stringify({ id: msg.id, result: {} }) }), 0);
      return;
    }
    // Simula: a expressão é `fetch(...).then(r => r.text())` -- devolve um
    // texto fixo sem realmente buscar nada.
    setTimeout(() => this._emit('message', {
      data: JSON.stringify({ id: msg.id, result: { result: { value: 'linha1\nlinha2' } } }),
    }), 0);
  }
  close() {}
}

test('fetchTexto devolve o texto cru da expressão avaliada, sem tentar fazer JSON.parse', async () => {
  const globalAntigo = global.WebSocket;
  global.WebSocket = WebSocketFalso;
  try {
    const cdp = require('../tools/semanal/cdp-client.js');
    const session = new (require('../tools/semanal/cdp-client.js').CdpSession || class {})();
    // CdpSession não é exportada hoje -- este teste monta a sessão pelo
    // mesmo caminho que abrirSessao usaria, mas sem HTTP: instancia direto.
  } finally {
    global.WebSocket = globalAntigo;
  }
});
```

Este primeiro rascunho de teste é frágil (depende de exportar `CdpSession`). Simplificar: exportar `CdpSession` de `cdp-client.js` só para teste, e testar `fetchTexto` chamando `session.evaluate` diretamente:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert');

class WebSocketFalso {
  constructor() {
    this.listeners = {};
    this.readyState = 1;
    setTimeout(() => this._emit('open'), 0);
  }
  addEventListener(evento, cb) { (this.listeners[evento] ||= []).push(cb); }
  _emit(evento, dado) { (this.listeners[evento] || []).forEach((cb) => cb(dado)); }
  send(mensagemJson) {
    const msg = JSON.parse(mensagemJson);
    setTimeout(() => this._emit('message', {
      data: JSON.stringify({ id: msg.id, result: { result: { value: 'linha1\nlinha2' } } }),
    }), 0);
  }
  close() {}
}

test('fetchTexto avalia fetch(...).then(r => r.text()) e devolve o texto cru', async () => {
  const globalAntigo = global.WebSocket;
  global.WebSocket = WebSocketFalso;
  try {
    const { CdpSession, fetchTexto } = require('../tools/semanal/cdp-client.js');
    const session = new CdpSession('ws://fake');
    await session.waitOpen();
    const texto = await fetchTexto(session, 'https://docs.google.com/qualquer');
    assert.strictEqual(texto, 'linha1\nlinha2');
  } finally {
    global.WebSocket = globalAntigo;
  }
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node --test test/semanal-cdp-client.test.js`
Expected: FAIL — `CdpSession`/`fetchTexto` não exportados ainda.

- [ ] **Step 3: Implementar `fetchTexto` e exportar `CdpSession`**

Em `tools/semanal/cdp-client.js`, adicionar depois de `fetchJson` (linha 107):

```javascript
// Busca uma URL ABSOLUTA (fora do site já aberto na sessão -- ex.: o export
// gviz do Google Sheets) no contexto da PAGINA e devolve o texto cru, sem
// tentar JSON.parse (fetchJson faz isso; aqui o resultado é CSV, não JSON).
async function fetchTexto(session, urlAbsoluta) {
  return session.evaluate(`fetch(${JSON.stringify(urlAbsoluta)}).then(r => r.text())`, 30000);
}
```

E trocar a linha `module.exports` (linha 213) para expor `CdpSession` (só para teste) e `fetchTexto`:

```javascript
module.exports = {
  abrirSessao, fecharSessao, checarConexao, fetchJson, fetchTexto, fetchBuffer,
  rasparTabelaDataTable, linhasComoObjetos, CdpSession,
};
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `node --test test/semanal-cdp-client.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/cdp-client.js test/semanal-cdp-client.test.js
git commit -m "cdp-client: adiciona fetchTexto para buscar URLs fora do site aberto (Google Sheets)"
```

---

## Task 3: Mapear Link 1 (extrato-producao-total) para o grid que `parseAvancos` já lê

**Files:**
- Create: `tools/semanal/mapear-producao-total.js`
- Test: `test/semanal-mapear-producao-total.test.js`

**Interfaces:**
- Consumes: nada de outro task — só o formato de linha do Link 1, `{headers, rows}` de `cdp.rasparTabelaDataTable`.
- Produces: `mapearProducaoTotal(linhas)` → `{ header: string[], rows: string[][] }`, um grid 0-indexado (linha 0 = cabeçalho) com EXATAMENTE as colunas que `locateColunasAvancos` (`tools/semanal/parse-avancos.js`) exige: `Contrato, Criação da OS, Tipo, Status, Inicio Sondagem, Termino Sondagem, Conclusão, Cancelamento, Atualizado, Observações de Campo, OS, Sondador`. Este grid, depois de `[null, ...linhas]` (ver Task 4), alimenta `parseAvancos` sem nenhuma mudança nele.

- [ ] **Step 1: Escrever o teste**

Criar `test/semanal-mapear-producao-total.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { mapearProducaoTotal, COLUNAS_LINK1 } = require('../tools/semanal/mapear-producao-total.js');
const { locateColunasAvancos } = require('../tools/semanal/parse-avancos.js');

function linhaLink1(over = {}) {
  return Object.assign({
    Tomador: 'EPR Litoral Pioneiro',
    'ID Contrato': 'SUP-7722-24',
    Sondador: 'Evamar Fernandes de Macedo',
    Tipo: 'SP',
    OS: '16744-25',
    'Criação da OS': '18/09/2025',
    Identificação: 'ELP-SP-PR092-A-5-1067',
    Obra: 'Projetos do Ano 05',
    'Observações de campo': '',
    'Executado Dia': '01/08/2026',
    'Tags de Serviço': 'SP.Instal (1)',
    'Status Atual': 'EXECUTADO',
    'Data Status Atual': '01/08/2026',
  }, over);
}

test('o cabeçalho de saída é exatamente o que parseAvancos exige, sem lançar', () => {
  const { header } = mapearProducaoTotal([linhaLink1()]);
  assert.doesNotThrow(() => locateColunasAvancos(header));
});

test('Contrato, Tipo, OS, Sondador e Status vêm direto das colunas homônimas do Link 1', () => {
  const { header, rows } = mapearProducaoTotal([linhaLink1()]);
  const cols = locateColunasAvancos(header);
  assert.strictEqual(rows[0][cols.sup], 'SUP-7722-24');
  assert.strictEqual(rows[0][cols.tipo], 'SP');
  assert.strictEqual(rows[0][cols.os], '16744-25');
  assert.strictEqual(rows[0][cols.sondador], 'Evamar Fernandes de Macedo');
  assert.strictEqual(rows[0][cols.status], 'EXECUTADO');
});

test('Executado Dia alimenta Termino Sondagem E Inicio Sondagem -- a saída do estoque de Demandas usa Executado Dia, decidido com o usuário', () => {
  const { header, rows } = mapearProducaoTotal([linhaLink1()]);
  const cols = locateColunasAvancos(header);
  assert.strictEqual(rows[0][cols.terminoSondagem], '01/08/2026');
  assert.strictEqual(rows[0][cols.inicioSondagem], '01/08/2026');
});

test('Criação da OS alimenta Criação da OS sem transformação', () => {
  const { header, rows } = mapearProducaoTotal([linhaLink1()]);
  const cols = locateColunasAvancos(header);
  assert.strictEqual(rows[0][cols.criacaoOS], '18/09/2025');
});

test('Cancelamento e Conclusão ficam vazios -- Link 1 não tem essas datas separadas (limitação conhecida)', () => {
  const { header, rows } = mapearProducaoTotal([linhaLink1()]);
  const cols = locateColunasAvancos(header);
  assert.strictEqual(rows[0][cols.cancelamento], '');
  assert.strictEqual(rows[0][cols.conclusao], '');
});

test('Observações de campo do Link 1 vira Observações de Campo -- deslocamento continua filtrável em parse-avancos.js', () => {
  const { header, rows } = mapearProducaoTotal([linhaLink1({ 'Observações de campo': 'Deslocamento A' })]);
  const cols = locateColunasAvancos(header);
  assert.strictEqual(rows[0][cols.observacoesCampo], 'Deslocamento A');
});

test('linha sem ID Contrato ainda gera uma linha (parseAvancos decide o que descartar, este mapeador não filtra)', () => {
  const { rows } = mapearProducaoTotal([linhaLink1({ 'ID Contrato': '' })]);
  assert.strictEqual(rows.length, 1);
});

test('múltiplas linhas mantêm a ordem', () => {
  const { rows } = mapearProducaoTotal([linhaLink1({ OS: '1' }), linhaLink1({ OS: '2' })]);
  const cols = locateColunasAvancos(mapearProducaoTotal([linhaLink1()]).header);
  assert.strictEqual(rows[0][cols.os], '1');
  assert.strictEqual(rows[1][cols.os], '2');
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node --test test/semanal-mapear-producao-total.test.js`
Expected: FAIL — `Cannot find module '../tools/semanal/mapear-producao-total.js'`.

- [ ] **Step 3: Implementar `mapear-producao-total.js`**

```javascript
'use strict';

// Transforma linhas cruas do Link 1 (sond.com.br/extrato-producao-total),
// já em objetos {coluna: valor} via cdp.linhasComoObjetos, no MESMO layout
// de colunas que parse-avancos.js já exige -- assim parseAvancos() roda
// sem nenhuma mudança sobre este grid. Ver
// docs/superpowers/specs/2026-08-08-troca-origem-realizado-demandas-equipes-design.md,
// seção "Link 1".
//
// Duas repurposições deliberadas, confirmadas com o usuário:
// - "Executado Dia" alimenta TANTO "Termino Sondagem" (evento sondagem
//   realizada) QUANTO "Inicio Sondagem" (que compute-demandas.js usa como
//   evento de SAÍDA do estoque de pendentes desde 2026-08-06) -- o Link 1
//   só tem uma data de execução, não duas.
// - "Cancelamento"/"Conclusão"/"Atualizado" ficam vazios: o Link 1 (relatório
//   de PRODUÇÃO) não distingue essas datas. Furo cancelado não aparece nesta
//   tela (nada foi produzido) -- limitação conhecida, não bug.
const COLUNAS_LINK1 = [
  'Tomador', 'ID Contrato', 'Sondador', 'Tipo', 'OS', 'Criação da OS',
  'Identificação', 'Obra', 'Observações de campo', 'Executado Dia',
  'Tags de Serviço', 'Status Atual', 'Data Status Atual',
];

const HEADER_SAIDA = [
  'Contrato', 'Criação da OS', 'Tipo', 'Status', 'Inicio Sondagem',
  'Termino Sondagem', 'Conclusão', 'Cancelamento', 'Atualizado',
  'Observações de Campo', 'OS', 'Sondador',
];

function texto(valor) {
  return String(valor === null || valor === undefined ? '' : valor).trim();
}

function mapearProducaoTotal(linhas) {
  const rows = (linhas || []).map((linha) => {
    const executadoDia = texto(linha['Executado Dia']);
    return [
      texto(linha['ID Contrato']),
      texto(linha['Criação da OS']),
      texto(linha['Tipo']),
      texto(linha['Status Atual']),
      executadoDia,
      executadoDia,
      '',
      '',
      texto(linha['Data Status Atual']),
      texto(linha['Observações de campo']),
      texto(linha['OS']),
      texto(linha['Sondador']),
    ];
  });
  return { header: HEADER_SAIDA, rows };
}

module.exports = { mapearProducaoTotal, COLUNAS_LINK1, HEADER_SAIDA };
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `node --test test/semanal-mapear-producao-total.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/mapear-producao-total.js test/semanal-mapear-producao-total.test.js
git commit -m "Mapeia o Link 1 (extrato-producao-total) para o grid que parseAvancos já lê"
```

---

## Task 4: Reescrever `atualizar-avancos-online.js` (Link 1, com cache mensal)

**Files:**
- Modify: `tools/semanal/atualizar-avancos-online.js` (reescrito)
- Test: `test/semanal-cache-producao-total.test.js` (novo, só a decisão de cache — pura)

**Interfaces:**
- Consumes: `mapearProducaoTotal` (Task 3), `cdp.fetchTexto`/`cdp.rasparTabelaDataTable`/`cdp.linhasComoObjetos` (Task 2 + já existentes), `gridParaCsv` (`csv-writer-avancos.js`, já existe).
- Produces: continua gravando `dist/avancos-online.csv`, mesmo caminho e mesmo consumidor (`build-dashboard.js`) de hoje. Nova função pura exportada: `mesesParaBuscar(hoje, desde)` → lista de `{ano, mes, ehMesCorrente}` do primeiro mês de cobertura até o mês de `hoje`.

- [ ] **Step 1: Escrever o teste da decisão de cache (pura, sem CDP)**

Criar `test/semanal-cache-producao-total.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { mesesParaBuscar } = require('../tools/semanal/atualizar-avancos-online.js');

test('cobre de 2025-01 até o mês de hoje, inclusive', () => {
  const meses = mesesParaBuscar(new Date(Date.UTC(2026, 7, 8))); // agosto/2026
  assert.strictEqual(meses.length, 20); // jan/2025 .. ago/2026
  assert.deepStrictEqual(meses[0], { ano: 2025, mes: 1, ehMesCorrente: false });
  assert.deepStrictEqual(meses[meses.length - 1], { ano: 2026, mes: 8, ehMesCorrente: true });
});

test('só o último mês da lista é o mês corrente', () => {
  const meses = mesesParaBuscar(new Date(Date.UTC(2026, 0, 15))); // janeiro/2026
  assert.strictEqual(meses.filter(m => m.ehMesCorrente).length, 1);
  assert.strictEqual(meses[meses.length - 1].ehMesCorrente, true);
});

test('roda em janeiro/2025 (o próprio mês de início) sem devolver lista vazia nem negativa', () => {
  const meses = mesesParaBuscar(new Date(Date.UTC(2025, 0, 10)));
  assert.strictEqual(meses.length, 1);
  assert.deepStrictEqual(meses[0], { ano: 2025, mes: 1, ehMesCorrente: true });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node --test test/semanal-cache-producao-total.test.js`
Expected: FAIL — `mesesParaBuscar` não existe ainda (o arquivo atual não exporta essa função).

- [ ] **Step 3: Reescrever `atualizar-avancos-online.js`**

Substituir o conteúdo inteiro do arquivo:

```javascript
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { mapearProducaoTotal } = require('./mapear-producao-total.js');
const { gridParaCsv } = require('./csv-writer-avancos.js');
const { locateColunasAvancos } = require('./parse-avancos.js');
const cdp = require('./cdp-client.js');

const SITE_ORIGIN = 'https://sond.com.br';
const OUT_PATH = path.join(__dirname, '..', '..', 'dist', 'avancos-online.csv');
const CACHE_DIR = path.join(__dirname, '..', '..', 'dist', 'cache');
const DESDE = { ano: 2025, mes: 1 };

// Cobertura desde 2025-01 (decidido com o usuário) até o mês de 'hoje',
// inclusive. Só o ÚLTIMO item é o mês corrente -- todos os anteriores já
// fecharam e são candidatos a cache (execução passada não muda).
function mesesParaBuscar(hoje) {
  const anoAtual = hoje.getUTCFullYear();
  const mesAtual = hoje.getUTCMonth() + 1;
  const meses = [];
  let ano = DESDE.ano;
  let mes = DESDE.mes;
  while (ano < anoAtual || (ano === anoAtual && mes <= mesAtual)) {
    const ehMesCorrente = ano === anoAtual && mes === mesAtual;
    meses.push({ ano, mes, ehMesCorrente });
    mes++;
    if (mes > 12) { mes = 1; ano++; }
  }
  return meses;
}

function caminhoCache(ano, mes) {
  return path.join(CACHE_DIR, `producao-total-${ano}-${String(mes).padStart(2, '0')}.csv`);
}

// Busca um mês (Link 1). Mês corrente é sempre buscado de novo; mês fechado
// só é buscado se o cache não existir -- execução já concluída não muda.
async function buscarMes(session, ano, mes, ehMesCorrente) {
  const cache = caminhoCache(ano, mes);
  if (!ehMesCorrente && fs.existsSync(cache)) {
    return fs.readFileSync(cache, 'utf8');
  }
  const mm = String(mes).padStart(2, '0');
  const url = `${SITE_ORIGIN}/extrato-producao-total/mes/${mm}/ano/${ano}/`;
  const { session: sessaoMes, target } = await cdp.abrirSessao(url);
  try {
    const { headers, rows } = await cdp.rasparTabelaDataTable(sessaoMes, '.producao-grid', { timeoutMs: 30000 });
    const linhas = cdp.linhasComoObjetos({ headers, rows });
    const { header, rows: rowsMapeadas } = mapearProducaoTotal(linhas);
    const csv = gridParaCsv([header, ...rowsMapeadas]);
    if (!ehMesCorrente) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(cache, csv, 'utf8');
    }
    return csv;
  } finally {
    await cdp.fecharSessao(sessaoMes, target);
  }
}

async function main() {
  console.log('Checando conexao com o Chrome (CDP)...');
  await cdp.checarConexao();

  const meses = mesesParaBuscar(new Date());
  console.log(`Buscando ${meses.length} mes(es) de extrato-producao-total (2025-01 ate o mes corrente)...`);

  const grids = [];
  const falhas = [];
  for (const m of meses) {
    try {
      const csv = await buscarMes(null, m.ano, m.mes, m.ehMesCorrente);
      const linhas = csv.trim().split('\n').length - 1;
      grids.push(csv);
      console.log(`  ${m.ano}-${String(m.mes).padStart(2, '0')}${m.ehMesCorrente ? ' (corrente)' : ''}: ${linhas} linha(s)`);
    } catch (err) {
      falhas.push({ mes: `${m.ano}-${String(m.mes).padStart(2, '0')}`, erro: err.message });
      console.warn(`  ${m.ano}-${String(m.mes).padStart(2, '0')}: FALHOU -- ${err.message}`);
    }
  }

  if (!grids.length) {
    throw new Error('Nenhum mês foi baixado com sucesso -- abortando sem gravar (ver falhas acima).');
  }

  // Concatena: cabeçalho do primeiro grid + linhas de dado de TODOS (o
  // cabeçalho é sempre o mesmo, produzido por mapearProducaoTotal).
  const header = grids[0].split('\n')[0];
  const linhasDado = grids.flatMap((csv) => csv.trim().split('\n').slice(1));
  const csvFinal = [header, ...linhasDado].join('\n') + '\n';

  try {
    locateColunasAvancos(header.split(','));
  } catch (err) {
    throw new Error(`Cabeçalho combinado ficou inválido -- abortando SEM gravar ${OUT_PATH}. Erro original: ${err.message}`);
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, csvFinal, 'utf8');

  console.log(`Pronto: ${grids.length}/${meses.length} mes(es) combinados, ${linhasDado.length} linha(s), gravado em ${OUT_PATH}.`);
  if (falhas.length) {
    console.warn(`${falhas.length} mes(es) falharam e ficaram DE FORA: ${falhas.map((f) => f.mes).join(', ')}`);
  }
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { mesesParaBuscar, main };
```

Nota: a assinatura de `buscarMes` recebe `session` mas não a usa (abre a
própria sessão por mês, já que cada mês é uma URL diferente) -- mantido
como parâmetro por simetria com o resto do arquivo; pode ser removido do
parâmetro numa limpeza futura sem afetar comportamento.

- [ ] **Step 4: Rodar o teste puro e confirmar que passa**

Run: `node --test test/semanal-cache-producao-total.test.js`
Expected: PASS.

- [ ] **Step 5: Adicionar `dist/cache/` ao `.gitignore`**

Em `.gitignore`, adicionar:

```
dist/cache/
```

- [ ] **Step 6: Rodar a suíte inteira**

Run: `node --test test/*.js`
Expected: PASS (nenhum outro teste importa `combinarGradesAvancos`, que saiu deste arquivo — confirmar com grep antes de rodar).

Run: `grep -rl combinarGradesAvancos test/`
Expected: sem resultado (se houver, ajustar/remover esse teste antes de prosseguir — a função saiu do arquivo nesta reescrita).

- [ ] **Step 7: Commit**

```bash
git add tools/semanal/atualizar-avancos-online.js test/semanal-cache-producao-total.test.js .gitignore
git commit -m "Troca a origem de Realizado para extrato-producao-total (Link 1), com cache mensal desde 2025-01"
```

---

## Task 5: Mapear Demandas de sondagem pendentes (Link 2 + Link 3, join por OS)

**Files:**
- Create: `tools/semanal/mapear-demandas-sondagem.js`
- Test: `test/semanal-mapear-demandas-sondagem.test.js`

**Interfaces:**
- Consumes: nada de outro task.
- Produces: `juntarPendentesSondagem(linhasLink2, linhasLink3)` → `{ header: string[], rows: string[][], semContrato: number }`, mesmo layout de `HEADER_SAIDA` da Task 3 (reaproveitado por import), com `Status='PENDENTE'` e só os campos disponíveis preenchidos.

- [ ] **Step 1: Escrever o teste**

Criar `test/semanal-mapear-demandas-sondagem.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { juntarPendentesSondagem } = require('../tools/semanal/mapear-demandas-sondagem.js');
const { locateColunasAvancos } = require('../tools/semanal/parse-avancos.js');

function linhaLink2(over = {}) {
  return Object.assign({
    'Ordem de Serviço (OS)': '17656-26',
    Identificação: '0090 PI-009',
    Tipo: 'PI',
    Status: 'PENDENTE',
  }, over);
}

function linhaLink3(over = {}) {
  return Object.assign({
    'Ordens de Serviço (OS)': '17656-26',
    'OS desde': '11/06/2026',
    Contrato: 'SUP-7133-24',
    Tomador: 'Via Araucária S.A',
    Tipo: 'PI',
  }, over);
}

test('furo pendente do Link 2 recebe Contrato e Criação da OS do Link 3 pela mesma OS', () => {
  const { header, rows } = juntarPendentesSondagem([linhaLink2()], [linhaLink3()]);
  const cols = locateColunasAvancos(header);
  assert.strictEqual(rows[0][cols.sup], 'SUP-7133-24');
  assert.strictEqual(rows[0][cols.criacaoOS], '11/06/2026');
  assert.strictEqual(rows[0][cols.tipo], 'PI');
  assert.strictEqual(rows[0][cols.status], 'PENDENTE');
  assert.strictEqual(rows[0][cols.os], '17656-26');
});

test('Inicio Sondagem, Termino Sondagem, Cancelamento, Sondador ficam vazios -- furo ainda não aconteceu', () => {
  const { header, rows } = juntarPendentesSondagem([linhaLink2()], [linhaLink3()]);
  const cols = locateColunasAvancos(header);
  assert.strictEqual(rows[0][cols.inicioSondagem], '');
  assert.strictEqual(rows[0][cols.terminoSondagem], '');
  assert.strictEqual(rows[0][cols.cancelamento], '');
  assert.strictEqual(rows[0][cols.sondador], '');
});

test('OS do Link 2 sem linha correspondente no Link 3 conta em semContrato e sai da lista', () => {
  const { rows, semContrato } = juntarPendentesSondagem([linhaLink2({ 'Ordem de Serviço (OS)': '99999-99' })], [linhaLink3()]);
  assert.strictEqual(rows.length, 0);
  assert.strictEqual(semContrato, 1);
});

test('duas linhas do Link 2 na mesma OS recebem a MESMA chegada (lote) -- múltiplos furos pendentes de uma OS', () => {
  const { header, rows } = juntarPendentesSondagem(
    [linhaLink2({ Identificação: 'A' }), linhaLink2({ Identificação: 'B' })],
    [linhaLink3()],
  );
  const cols = locateColunasAvancos(header);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0][cols.criacaoOS], rows[1][cols.criacaoOS]);
});

test('Link 3 com Tipo diferente do Link 2 na mesma OS não confunde a linha -- junta só por OS, o Tipo final vem do Link 2', () => {
  const { header, rows } = juntarPendentesSondagem(
    [linhaLink2({ Tipo: 'PI' })],
    [linhaLink3({ Tipo: 'SP' })], // agregado da OS pode ter Tipo diferente (multi-tipo na mesma OS)
  );
  const cols = locateColunasAvancos(header);
  assert.strictEqual(rows[0][cols.tipo], 'PI', 'o furo individual do Link 2 é a fonte da verdade do Tipo dele');
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node --test test/semanal-mapear-demandas-sondagem.test.js`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `mapear-demandas-sondagem.js`**

```javascript
'use strict';
const { HEADER_SAIDA } = require('./mapear-producao-total.js');

// Junta furos PENDENTES do Link 2 (maps-sondagens, snapshot de agora) com o
// Link 3 (avanco-sondagens, agregado por OS+Tipo, tem Contrato/Tomador/
// "OS desde") pela OS -- Link 2 não tem Contrato nem data de criação
// confiável. "OS desde" do Link 3 vira a chegada de TODO furo pendente
// daquela OS no Link 2 (aproximação de lote, confirmada com o usuário). Ver
// docs/superpowers/specs/2026-08-08-troca-origem-realizado-demandas-equipes-design.md,
// seção "Demandas de sondagens".
function texto(valor) {
  return String(valor === null || valor === undefined ? '' : valor).trim();
}

function juntarPendentesSondagem(linhasLink2, linhasLink3) {
  const porOS = new Map();
  for (const l3 of linhasLink3 || []) {
    const os = texto(l3['Ordens de Serviço (OS)']);
    if (os && !porOS.has(os)) {
      porOS.set(os, { contrato: texto(l3['Contrato']), osDesde: texto(l3['OS desde']) });
    }
  }

  const rows = [];
  let semContrato = 0;
  for (const l2 of linhasLink2 || []) {
    const os = texto(l2['Ordem de Serviço (OS)']);
    const info = porOS.get(os);
    if (!info) { semContrato++; continue; }
    rows.push([
      info.contrato,
      info.osDesde,
      texto(l2['Tipo']),
      'PENDENTE',
      '', '', '', '', '',
      '',
      os,
      '',
    ]);
  }

  return { header: HEADER_SAIDA, rows, semContrato };
}

module.exports = { juntarPendentesSondagem };
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `node --test test/semanal-mapear-demandas-sondagem.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/mapear-demandas-sondagem.js test/semanal-mapear-demandas-sondagem.test.js
git commit -m "Junta Demandas de sondagem pendentes (Link 2 + Link 3) no grid que parseAvancos já lê"
```

---

## Task 6: `atualizar-demandas-sondagem-online.js` (fetch Link 2 + Link 3)

**Files:**
- Create: `tools/semanal/atualizar-demandas-sondagem-online.js`

**Interfaces:**
- Consumes: `juntarPendentesSondagem` (Task 5), `cdp.rasparTabelaDataTable`/`linhasComoObjetos` (existentes).
- Produces: `dist/demandas-sondagem-online.csv`, mesmo header de `avancos-online.csv` — `build-dashboard.js` (Task 12) lê os dois e concatena antes de `parseAvancos`.

- [ ] **Step 1: Implementar (sem teste direto — mesmo padrão de `atualizar-avancos-online.js`, a lógica testável já está em `mapear-demandas-sondagem.js`)**

```javascript
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { juntarPendentesSondagem } = require('./mapear-demandas-sondagem.js');
const { gridParaCsv } = require('./csv-writer-avancos.js');
const { locateColunasAvancos } = require('./parse-avancos.js');
const cdp = require('./cdp-client.js');

const SITE_ORIGIN = 'https://sond.com.br';
const OUT_PATH = path.join(__dirname, '..', '..', 'dist', 'demandas-sondagem-online.csv');

async function main() {
  console.log('Checando conexao com o Chrome (CDP)...');
  await cdp.checarConexao();

  console.log('Buscando pendentes (Link 2 -- maps-sondagens)...');
  const { session: s2, target: t2 } = await cdp.abrirSessao(`${SITE_ORIGIN}/maps-sondagens/tabela/inicial/1/`);
  let linhasLink2;
  try {
    const { headers, rows } = await cdp.rasparTabelaDataTable(s2, 'table', { timeoutMs: 30000 });
    linhasLink2 = cdp.linhasComoObjetos({ headers, rows });
  } finally {
    await cdp.fecharSessao(s2, t2);
  }
  console.log(`  ${linhasLink2.length} furo(s) pendente(s) encontrado(s).`);

  console.log('Buscando avanço por OS (Link 3 -- avanco-sondagens)...');
  const { session: s3, target: t3 } = await cdp.abrirSessao(`${SITE_ORIGIN}/avanco-sondagens/`);
  let linhasLink3;
  try {
    const { headers, rows } = await cdp.rasparTabelaDataTable(s3, '#avanco-grid', { timeoutMs: 30000 });
    linhasLink3 = cdp.linhasComoObjetos({ headers, rows });
  } finally {
    await cdp.fecharSessao(s3, t3);
  }
  console.log(`  ${linhasLink3.length} linha(s) de OS+Tipo encontrada(s).`);

  const { header, rows, semContrato } = juntarPendentesSondagem(linhasLink2, linhasLink3);
  if (semContrato > 0) {
    console.warn(`AVISO: ${semContrato} furo(s) pendente(s) do Link 2 sem OS correspondente no Link 3 -- ficaram DE FORA (sem Contrato pra atribuir).`);
  }

  try {
    locateColunasAvancos(header);
  } catch (err) {
    throw new Error(`Cabeçalho ficou inválido -- abortando SEM gravar ${OUT_PATH}. Erro original: ${err.message}`);
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, gridParaCsv([header, ...rows]), 'utf8');
  console.log(`Pronto: ${rows.length} furo(s) pendente(s) gravado(s) em ${OUT_PATH}.`);
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { main };
```

- [ ] **Step 2: Rodar a suíte inteira (garantir que nada quebrou por importar `mapear-demandas-sondagem.js`)**

Run: `node --test test/*.js`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tools/semanal/atualizar-demandas-sondagem-online.js
git commit -m "Novo fetcher: Demandas de sondagem pendentes (Link 2 + Link 3)"
```

---

## Task 7: `compute-demandas.js` — chegada e pendentes de laboratório (Link 4 + Link 5)

**Files:**
- Modify: `tools/semanal/compute-demandas.js`
- Modify: `test/semanal-compute-demandas.test.js` (2 testes existentes mudam de comportamento, deliberadamente)

**Interfaces:**
- Consumes: nada de outro task diretamente (o shape de `ensaiosLab` ganha um campo novo, `criacao`).
- Produces: `computeDemandas(furos, periodos, ensaiosLab)` — MESMA assinatura, mas `ensaiosLab` agora aceita `{sup, tipologia, concluido, criacao}` (`criacao` é opcional — quando ausente, comportamento idêntico ao de hoje). Quando presente, LAB.C/LAB.E ganham `chegadas`/`pendentes` reais em `tipologias`/`totais`, e `porRegistroEventos` ganha `chegada`/`saidaEstoque` pra essas chaves.

- [ ] **Step 1: Atualizar os dois testes que hoje travam o comportamento "zerado"**

Em `test/semanal-compute-demandas.test.js`, substituir os dois testes:

```javascript
test('ensaiosLab NÃO entra em tipologias/totais -- a aba Demandas (mensal) continua exclusiva de Sondagem', () => {
```

e

```javascript
test('ensaiosLab não gera chegada/saidaEstoque -- Demandas Pendentes de LAB.C/LAB.E fica sem-dado de propósito (sem fonte de backlog ainda)', () => {
```

por:

```javascript
test('ensaiosLab SEM "criacao" continua com tipologias/totais zerados e sem chegada/saidaEstoque -- compatibilidade com quem ainda não tem a fonte de backlog (2026-08-08: Lab Realizado sem Data Programada, caso raro)', () => {
  const saida = computeDemandas([], PERIODOS_2026, [ensaioLab({ tipologia: 'LAB.C', criacao: undefined })]);
  const blocoLabC = saida.tipologias.find(t => t.tipologia === 'LAB.C');
  assert.deepStrictEqual(blocoLabC.series.chegadas, new Array(12).fill(0));
  assert.deepStrictEqual(saida.porRegistroEventos['SUP-0001-24||LAB.C'].chegada, []);
  assert.deepStrictEqual(saida.porRegistroEventos['SUP-0001-24||LAB.C'].saidaEstoque, []);
});

test('ensaiosLab COM "criacao" (Data Programada, Link 4/5) alimenta chegada/pendentes de LAB.C/LAB.E em tipologias/totais -- ligado em 2026-08-08 (antes ficava zerado por falta de fonte de backlog)', () => {
  const saida = computeDemandas([], PERIODOS_2026, [
    ensaioLab({ tipologia: 'LAB.C', criacao: d(2026, 1, 10), concluido: d(2026, 2, 5) }),
  ]);
  const blocoLabC = saida.tipologias.find(t => t.tipologia === 'LAB.C');
  assert.strictEqual(blocoLabC.series.chegadas[0], 1, 'chegada em janeiro');
  assert.strictEqual(blocoLabC.series.sondagemRealizada[1], 1, 'concluído em fevereiro');
  assert.deepStrictEqual(blocoLabC.series.pendentes.slice(0, 3), [1, 0, 0], 'aberto em jan, fechado a partir de fev (concluído)');
});

test('ensaio ainda pendente (concluido null, criacao presente) fica no estoque indefinidamente -- mesma regra de furo sem data de saída', () => {
  const saida = computeDemandas([], PERIODOS_2026, [
    ensaioLab({ tipologia: 'LAB.E', criacao: d(2026, 3, 1), concluido: null }),
  ]);
  const blocoLabE = saida.tipologias.find(t => t.tipologia === 'LAB.E');
  assert.deepStrictEqual(blocoLabE.series.pendentes.slice(2, 12), new Array(10).fill(1));
});

test('porRegistroEventos de LAB ganha chegada/saidaEstoque quando criacao está presente', () => {
  const saida = computeDemandas([], PERIODOS_2026, [
    ensaioLab({ sup: 'SUP-0001-24', tipologia: 'LAB.C', criacao: d(2026, 1, 10), concluido: d(2026, 2, 5) }),
  ]);
  const entrada = saida.porRegistroEventos['SUP-0001-24||LAB.C'];
  assert.strictEqual(entrada.chegada.length, 1);
  assert.strictEqual(entrada.saidaEstoque.length, 1, 'concluído também sai do estoque -- lab não tem "início" separado de "conclusão"');
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node --test test/semanal-compute-demandas.test.js`
Expected: FAIL nos 4 testes novos (comportamento ainda não implementado).

- [ ] **Step 3: Implementar a extensão em `compute-demandas.js`**

Substituir o laço de `ensaiosLab` (linhas 159-163) por:

```javascript
  // Ensaios de laboratório (Link 4: extrato-ensaios-realizados, mesma fonte
  // de sempre; Link 5: detalhes-ensaios-programados, novo em 2026-08-08).
  // 'criacao' (Data Programada) é OPCIONAL: quando ausente, comportamento
  // idêntico ao anterior (só sondagemRealizada, tipologias/totais zerados
  // pra LAB -- "sem fonte de backlog"). Quando presente, LAB.C/LAB.E entram
  // no mesmo tratamento de chegada/pendentes que Sondagem já tem, porque
  // agora existe fonte pra isso (Link 4 dá chegada+saída na mesma linha
  // quando concluído; Link 5 dá chegada sem saída quando ainda pendente).
  // Diferente de furos, não existe "início" separado de "conclusão" pra
  // ensaio -- a saída do estoque é a PRÓPRIA conclusão.
  for (const e of ensaiosLab || []) {
    if (!porTipologia.has(e.tipologia)) porTipologia.set(e.tipologia, serieVazia(n));
    const seriesLab = porTipologia.get(e.tipologia);

    const chaveRegistro = chaveMatriz(e.sup, e.tipologia);
    if (!porRegistroEventos.has(chaveRegistro)) porRegistroEventos.set(chaveRegistro, entradaEventosVazia());
    const eventosLab = porRegistroEventos.get(chaveRegistro);

    if (e.concluido) eventosLab.sondagemRealizada.push(diaEpoch(e.concluido));

    if (e.criacao) {
      eventosLab.chegada.push(diaEpoch(e.criacao));
      if (e.concluido) eventosLab.saidaEstoque.push(diaEpoch(e.concluido));

      const iChegada = indiceDoMes(e.criacao, periodos);
      if (iChegada >= 0) seriesLab.chegadas[iChegada] += 1;

      for (let i = 0; i < n; i++) {
        if (e.criacao > fins[i]) continue;
        const saiu = e.concluido && e.concluido <= fins[i];
        if (!saiu) seriesLab.pendentes[i] += 1;
      }
    }

    if (e.concluido) {
      const iSondagem = indiceDoMes(e.concluido, periodos);
      if (iSondagem >= 0) seriesLab.sondagemRealizada[iSondagem] += 1;
    }
  }
```

Atualizar também o comentário acima do laço antigo (linhas 146-158), que hoje afirma "NÃO entram em tipologias/totais" — apagar esse parágrafo (a decisão mudou nesta task) mantendo o resto do contexto histórico útil.

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --test test/semanal-compute-demandas.test.js`
Expected: PASS, todos.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `node --test test/*.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/compute-demandas.js test/semanal-compute-demandas.test.js
git commit -m "compute-demandas: Demandas de laboratório ganham chegada/pendentes reais (Link 4/5), antes ficavam zeradas"
```

---

## Task 8: Lab Realizado ganha "Data Programada" (Link 4) e classificação central

**Files:**
- Modify: `tools/semanal/parse-lab.js`
- Modify: `test/semanal-parse-lab.test.js`

**Interfaces:**
- Produces: `parseLab(grid)` — `ensaios[]` ganha o campo `criacao` (Date | null), lido de uma coluna `Data Programada` agora OBRIGATÓRIA no cabeçalho (o Link 4 sempre a tem, confirmado ao vivo em 2026-08-08).

- [ ] **Step 1: Atualizar/adicionar testes em `test/semanal-parse-lab.test.js`**

Adicionar (ajustando a fixture de grid existente no arquivo para incluir a coluna `Data Programada` — ver o teste existente para o formato exato da fixture):

```javascript
test('ensaios ganham "criacao" a partir de Data Programada', () => {
  const grid = [
    null,
    ['Data Programada', 'ID Contrato', 'Ensaiado Dia', 'Tipo de Ensaio'],
    ['07/05/2026', 'SUP-6806-23', '03/08/2026', 'M.ESP'],
  ];
  const { ensaios } = parseLab(grid);
  assert.strictEqual(ensaios[0].criacao.getUTCFullYear(), 2026);
  assert.strictEqual(ensaios[0].criacao.getUTCMonth(), 4); // maio, 0-indexado
  assert.strictEqual(ensaios[0].criacao.getUTCDate(), 7);
});

test('Data Programada ausente no cabeçalho lança (coluna passou a ser obrigatória)', () => {
  const grid = [
    null,
    ['ID Contrato', 'Ensaiado Dia', 'Tipo de Ensaio'],
    ['SUP-6806-23', '03/08/2026', 'M.ESP'],
  ];
  assert.throws(() => parseLab(grid), /Data Programada/);
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node --test test/semanal-parse-lab.test.js`
Expected: FAIL — `criacao` não existe, e a coluna não é obrigatória ainda (segundo teste não lança).

- [ ] **Step 3: Implementar em `parse-lab.js`**

Em `COLUNAS_OBRIGATORIAS` (linha 46), adicionar:

```javascript
const COLUNAS_OBRIGATORIAS = {
  sup: 'ID Contrato',
  concluidoDia: 'Ensaiado Dia',
  tipoEnsaio: 'Tipo de Ensaio',
  // Achada ao vivo em 2026-08-08 -- a coluna já existe no extrato, só não
  // estava documentada. Alimenta a chegada de Demandas de laboratório
  // (compute-demandas.js, Task 7 deste plano); sem ela, chegada/pendentes de
  // LAB.C/LAB.E ficariam zerados de novo.
  criacaoOS: 'Data Programada',
};
```

E no `parseLab` (dentro do `.push`, linha 113-117), adicionar o campo:

```javascript
    ensaios.push({
      sup,
      tipologia,
      concluido: dataSaneada(linha[cols.concluidoDia]),
      criacao: dataSaneada(linha[cols.criacaoOS]),
    });
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --test test/semanal-parse-lab.test.js`
Expected: PASS.

- [ ] **Step 5: Rodar a suíte inteira (build-dashboard.js chama parseLab -- conferir se algum teste de build usa um grid fixo sem Data Programada)**

Run: `node --test test/*.js`
Expected: pode haver falhas em testes que montam um grid de Lab sintético sem a coluna nova (ex.: `test/semanal-build-dashboard.test.js`, se existir uma fixture de Lab lá). Se falhar, adicionar `'Data Programada'` ao cabeçalho dessas fixtures com um valor de data válido (`'01/01/2026'` é suficiente) — é ajuste de fixture, não de comportamento.

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/parse-lab.js test/semanal-parse-lab.test.js
git commit -m "parse-lab: lê Data Programada (Link 4) como chegada de Demandas de laboratório"
```

---

## Task 9: Demandas de lab pendentes (Link 5) — mapeador + fetcher

**Files:**
- Create: `tools/semanal/mapear-demandas-lab.js`
- Create: `tools/semanal/atualizar-demandas-lab-online.js`
- Test: `test/semanal-mapear-demandas-lab.test.js`

**Interfaces:**
- Produces: `mapearDemandasLab(linhasLink5)` → `{ ensaios: {sup, tipologia, concluido: null, criacao: Date|null}[], excluidos: number, semTipo: number }`, no shape que `computeDemandas`'s `ensaiosLab` já aceita (Task 7).

- [ ] **Step 1: Escrever o teste**

Criar `test/semanal-mapear-demandas-lab.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { mapearDemandasLab } = require('../tools/semanal/mapear-demandas-lab.js');

function linhaLink5(over = {}) {
  return Object.assign({
    Tomador: 'Alves Ribeiro S.A do Brasil',
    'ID Contrato': 'SUP-8690-26',
    'Código do Ensaio': '13609-06',
    'Ordem de Serviço (OS)': '17887-26',
    Sondagem: 'KM 565 + 500',
    'Sondagem Tipo': 'SP',
    'Status da Sondagem': 'Pendente',
    'Tipo do Ensaio': 'MR.S',
    'Status do Ensaio': 'Programada',
    'Status da Amostra': 'Coletada',
    'Data Programada': '04/08/2026',
  }, over);
}

test('classifica pelo Tipo do Ensaio (LAB.C/LAB.E) e lê a Data Programada como criacao', () => {
  const { ensaios } = mapearDemandasLab([linhaLink5()]);
  assert.strictEqual(ensaios.length, 1);
  assert.strictEqual(ensaios[0].sup, 'SUP-8690-26');
  assert.strictEqual(ensaios[0].tipologia, 'LAB.E'); // MR.S -> LAB.E no Frcst
  assert.strictEqual(ensaios[0].concluido, null, 'ainda não foi ensaiado');
  assert.strictEqual(ensaios[0].criacao.getUTCDate(), 4);
});

test('exclui Tomador "Suporte Sondagens - Filial Lapa"', () => {
  const { ensaios, excluidos } = mapearDemandasLab([linhaLink5({ Tomador: 'Suporte Sondagens - Filial Lapa' })]);
  assert.strictEqual(ensaios.length, 0);
  assert.strictEqual(excluidos, 1);
});

test('exclui Sondagem Tipo contendo SEG ou SN', () => {
  const { ensaios, excluidos } = mapearDemandasLab([
    linhaLink5({ 'Sondagem Tipo': 'SEG.A' }),
    linhaLink5({ 'Sondagem Tipo': 'SN' }),
  ]);
  assert.strictEqual(ensaios.length, 0);
  assert.strictEqual(excluidos, 2);
});

test('Tipo do Ensaio desconhecido lança (mesma regra de classificarEnsaioLab)', () => {
  assert.throws(() => mapearDemandasLab([linhaLink5({ 'Tipo do Ensaio': 'ENSAIO-NOVO-INEXISTENTE' })]), /desconhecido/);
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node --test test/semanal-mapear-demandas-lab.test.js`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `mapear-demandas-lab.js`**

```javascript
'use strict';
const { classificarEnsaioLab } = require('../comum/tipologias-lab.js');
const { dataDeTexto } = require('./parse-avancos.js');

// Link 5 (detalhes-ensaios-programados): ensaios de lab ainda PENDENTES, um
// por linha, já auto-suficiente (tem a própria Data Programada -- diferente
// de Demandas de sondagem, não precisa de join com outra fonte). Ver
// docs/superpowers/specs/2026-08-08-troca-origem-realizado-demandas-equipes-design.md,
// seção "Link 5".
const RE_EXCLUSAO_TIPO = /SEG|SN/;
const TOMADOR_EXCLUIDO = 'Suporte Sondagens - Filial Lapa';

function texto(valor) {
  return String(valor === null || valor === undefined ? '' : valor).trim();
}

function mapearDemandasLab(linhas) {
  const ensaios = [];
  let excluidos = 0;

  for (const linha of linhas || []) {
    const tomador = texto(linha['Tomador']);
    const sondagemTipo = texto(linha['Sondagem Tipo']).toUpperCase();
    if (tomador === TOMADOR_EXCLUIDO || RE_EXCLUSAO_TIPO.test(sondagemTipo)) {
      excluidos++;
      continue;
    }

    const tipoEnsaioCru = texto(linha['Tipo do Ensaio']);
    const tipologia = classificarEnsaioLab(tipoEnsaioCru);

    ensaios.push({
      sup: texto(linha['ID Contrato']),
      tipologia,
      concluido: null,
      criacao: dataDeTexto(linha['Data Programada']),
    });
  }

  return { ensaios, excluidos };
}

module.exports = { mapearDemandasLab };
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `node --test test/semanal-mapear-demandas-lab.test.js`
Expected: PASS.

- [ ] **Step 5: Implementar o fetcher `atualizar-demandas-lab-online.js` (sem teste direto)**

```javascript
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { mapearDemandasLab } = require('./mapear-demandas-lab.js');
const cdp = require('./cdp-client.js');

const SITE_ORIGIN = 'https://sond.com.br';
const OUT_PATH = path.join(__dirname, '..', '..', 'dist', 'demandas-lab-online.json');

async function main() {
  console.log('Checando conexao com o Chrome (CDP)...');
  await cdp.checarConexao();

  console.log('Buscando ensaios de lab pendentes (Link 5 -- detalhes-ensaios-programados)...');
  const { session, target } = await cdp.abrirSessao(`${SITE_ORIGIN}/detalhes-ensaios-programados/`);
  let linhas;
  try {
    const { headers, rows } = await cdp.rasparTabelaDataTable(session, '#table', { timeoutMs: 30000 });
    linhas = cdp.linhasComoObjetos({ headers, rows });
  } finally {
    await cdp.fecharSessao(session, target);
  }

  const { ensaios, excluidos } = mapearDemandasLab(linhas);
  console.log(`Pronto: ${ensaios.length} ensaio(s) pendente(s), ${excluidos} excluído(s) (Suporte Sondagens/SEG/SN).`);

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  // JSON, não CSV: 'criacao' já é Date aqui (dataDeTexto já rodou dentro de
  // mapearDemandasLab) -- build-dashboard.js reidrata as datas ao ler (ver
  // Task 12). Diferente de Sondagem, não existe parseAvancos/parseLab a
  // reaproveitar para este formato -- os campos JÁ são o shape final que
  // computeDemandas espera.
  fs.writeFileSync(OUT_PATH, JSON.stringify(ensaios.map(e => ({
    ...e, criacao: e.criacao ? e.criacao.toISOString() : null,
  })), null, 2), 'utf8');
  console.log(`Gravado em ${OUT_PATH}.`);
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { main };
```

- [ ] **Step 6: Rodar a suíte inteira**

Run: `node --test test/*.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tools/semanal/mapear-demandas-lab.js tools/semanal/atualizar-demandas-lab-online.js test/semanal-mapear-demandas-lab.test.js
git commit -m "Novo fetcher: Demandas de laboratório pendentes (Link 5)"
```

---

## Task 10: `compute-equipes-fracao.js` — roster (Link 6) + produção fracionada (Link 7)

**Files:**
- Create: `tools/semanal/compute-equipes-fracao.js`
- Test: `test/semanal-compute-equipes-fracao.test.js`

**Interfaces:**
- Consumes: `parseAbaEq` (já existe, `compute-equipes-ativas.js`), `classificarDiaEquipe`/`contaComoAtiva` (já existem, `classificar-dia-equipe.js`), `diaEpoch` (`compute-semanal.js`).
- Produces: `agregarEquipesFracao({ equipes, linhasLink7, ano, mes, resolverSup, janelaFallbackDias })` → `{ porDia, redirecionados, semLink7, diasPorEstado }` — `porDia` no MESMO shape que `agregarEquipesAtivas`/`agregarEquipesProdutivas` já produzem (`{ 'SUP||Tipo': { diaEpoch: soma } }`), pronto pra plugar em `build-dashboard.js` (Task 12) sem mudar o resto da cadeia.

- [ ] **Step 1: Escrever o teste**

Criar `test/semanal-compute-equipes-fracao.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { agregarEquipesFracao } = require('../tools/semanal/compute-equipes-fracao.js');
const { diaEpoch } = require('../tools/semanal/compute-semanal.js');

const ANO = 2026;
const MES = 8;
const identidade = (sup) => sup;

function equipe(id, dias) {
  // dias: { 1: 'texto do dia 1', 2: 'texto do dia 2', ... }
  return {
    id, nome: `Equipe ${id}`, servicos: '',
    dias: Object.entries(dias).map(([dia, texto]) => ({ dia: Number(dia), texto })),
  };
}

function linhaLink7(idSondador, sup, tipo, dataStr) {
  return { idSondador, sup, tipo, diaEpoch: diaEpoch(new Date(dataStr + 'T00:00:00Z')) };
}

test('sondador que produziu 1 SUP+Tipo no dia conta 1 inteiro nessa combinação', () => {
  const equipes = [equipe('4', { 1: 'RioSP (17851-26)' })];
  const link7 = [linhaLink7('4', 'SUP-A', 'SP', '2026-08-01')];
  const { porDia } = agregarEquipesFracao({ equipes, linhasLink7: link7, ano: ANO, mes: MES, resolverSup: identidade });
  assert.strictEqual(porDia['SUP-A||SP'][diaEpoch(new Date('2026-08-01T00:00:00Z'))], 1);
});

test('sondador que produziu em 2 combinações SUP+Tipo no mesmo dia fraciona 0,5 pra cada', () => {
  const equipes = [equipe('4', { 1: 'trabalhando' })];
  const link7 = [
    linhaLink7('4', 'SUP-A', 'SP', '2026-08-01'),
    linhaLink7('4', 'SUP-A', 'SP', '2026-08-01'), // 2ª sondagem, MESMA combinação -- não conta 2x
    linhaLink7('4', 'SUP-B', 'PI', '2026-08-01'),
  ];
  const { porDia } = agregarEquipesFracao({ equipes, linhasLink7: link7, ano: ANO, mes: MES, resolverSup: identidade });
  const dia = diaEpoch(new Date('2026-08-01T00:00:00Z'));
  assert.strictEqual(porDia['SUP-A||SP'][dia], 0.5);
  assert.strictEqual(porDia['SUP-B||PI'][dia], 0.5);
});

test('sondador ativo no dia mas ausente do Link 7 desse dia vai pro último SUP+Tipo dos últimos 45 dias', () => {
  const equipes = [equipe('4', { 5: 'trabalhando' })]; // dia 5, sem OS na célula
  const link7 = [linhaLink7('4', 'SUP-A', 'SP', '2026-07-20')]; // 16 dias antes
  const { porDia } = agregarEquipesFracao({ equipes, linhasLink7: link7, ano: ANO, mes: MES, resolverSup: identidade });
  const dia5 = diaEpoch(new Date('2026-08-05T00:00:00Z'));
  assert.strictEqual(porDia['SUP-A||SP'][dia5], 1);
});

test('sondador sem NENHUMA produção nos últimos 45 dias fica de fora inteiramente', () => {
  const equipes = [equipe('4', { 5: 'trabalhando' })];
  const { porDia, semLink7 } = agregarEquipesFracao({ equipes, linhasLink7: [], ano: ANO, mes: MES, resolverSup: identidade });
  assert.deepStrictEqual(porDia, {});
  assert.strictEqual(semLink7, 1);
});

test('produção com mais de 45 dias de defasagem NÃO conta como fallback -- fora da janela', () => {
  const equipes = [equipe('4', { 5: 'trabalhando' })];
  const link7 = [linhaLink7('4', 'SUP-A', 'SP', '2026-06-01')]; // > 45 dias antes de 2026-08-05
  const { porDia, semLink7 } = agregarEquipesFracao({ equipes, linhasLink7: link7, ano: ANO, mes: MES, resolverSup: identidade });
  assert.deepStrictEqual(porDia, {});
  assert.strictEqual(semLink7, 1);
});

test('dia de EXCLUSÃO (férias/baixada) não conta nem produtiva nem fallback, mesmo com Link 7 disponível', () => {
  const equipes = [equipe('4', { 10: 'Férias' })];
  const link7 = [linhaLink7('4', 'SUP-A', 'SP', '2026-08-10'), linhaLink7('4', 'SUP-A', 'SP', '2026-07-15')];
  const { porDia } = agregarEquipesFracao({ equipes, linhasLink7: link7, ano: ANO, mes: MES, resolverSup: identidade });
  assert.deepStrictEqual(porDia, {}, 'férias exclui o dia inteiro, mesmo tendo produzido nesse dia por engano de fonte');
});

test('resolverSup redireciona SUP desconhecido pra Diversos, mesmo tratamento de furos/ensaios', () => {
  const equipes = [equipe('4', { 1: 'trabalhando' })];
  const link7 = [linhaLink7('4', 'SUP-DESCONHECIDO', 'SP', '2026-08-01')];
  const resolverSup = (sup, tipo) => (sup === 'SUP-DESCONHECIDO' ? 'Diversos' : sup);
  const { porDia } = agregarEquipesFracao({ equipes, linhasLink7: link7, ano: ANO, mes: MES, resolverSup });
  const dia = diaEpoch(new Date('2026-08-01T00:00:00Z'));
  assert.strictEqual(porDia['Diversos||SP'][dia], 1);
});

test('duas equipes diferentes no mesmo SUP+Tipo+dia SOMAM', () => {
  const equipes = [equipe('4', { 1: 'trabalhando' }), equipe('9', { 1: 'trabalhando' })];
  const link7 = [linhaLink7('4', 'SUP-A', 'SP', '2026-08-01'), linhaLink7('9', 'SUP-A', 'SP', '2026-08-01')];
  const { porDia } = agregarEquipesFracao({ equipes, linhasLink7: link7, ano: ANO, mes: MES, resolverSup: identidade });
  const dia = diaEpoch(new Date('2026-08-01T00:00:00Z'));
  assert.strictEqual(porDia['SUP-A||SP'][dia], 2);
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node --test test/semanal-compute-equipes-fracao.test.js`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `compute-equipes-fracao.js`**

```javascript
'use strict';
const { classificarDiaEquipe, contaComoAtiva } = require('./classificar-dia-equipe.js');
const { diaEpoch } = require('./compute-semanal.js');

// Equipes produtivas por (SUP, tipologia) e por dia, a partir de:
//   - Link 6 (planilha "Equipes", aba "AAAA - MÊS (EQ)"): roster do mês +
//     exclusão de dia (férias/baixada/desligada/afastada/atestado), via
//     classificarDiaEquipe/contaComoAtiva -- MESMA fonte e MESMA
//     classificação que compute-equipes-ativas.js já usa pra outro fim.
//   - Link 7 (campo/sondagens): quem produziu, em qual SUP+Tipo, cada dia.
// Ver docs/superpowers/specs/2026-08-08-troca-origem-realizado-demandas-equipes-design.md,
// seção "Equipes -- algoritmo".
const JANELA_FALLBACK_PADRAO = 45;

// linhasLink7 -> { [idSondador]: { [diaEpoch]: Set('SUP||Tipo') } } e
// { [idSondador]: [{ diaEpoch, sup, tipo }] ordenado por diaEpoch, pra achar
// "o último antes de X" no fallback.
function indexarLink7(linhasLink7) {
  const porSondadorDia = new Map(); // idSondador -> Map(diaEpoch -> Set('sup||tipo'))
  const historicoPorSondador = new Map(); // idSondador -> [{diaEpoch, sup, tipo}], ordenado

  for (const l of linhasLink7 || []) {
    if (!porSondadorDia.has(l.idSondador)) porSondadorDia.set(l.idSondador, new Map());
    const porDia = porSondadorDia.get(l.idSondador);
    if (!porDia.has(l.diaEpoch)) porDia.set(l.diaEpoch, new Set());
    porDia.get(l.diaEpoch).add(l.sup + '||' + l.tipo);

    if (!historicoPorSondador.has(l.idSondador)) historicoPorSondador.set(l.idSondador, []);
    historicoPorSondador.get(l.idSondador).push({ diaEpoch: l.diaEpoch, sup: l.sup, tipo: l.tipo });
  }
  for (const lista of historicoPorSondador.values()) lista.sort((a, b) => a.diaEpoch - b.diaEpoch);

  return { porSondadorDia, historicoPorSondador };
}

// Último registro do sondador com diaEpoch < diaAlvo e diaAlvo - diaEpoch <=
// janela (em dias). null se não achar nenhum.
function ultimoDentroDaJanela(historico, diaAlvo, janelaDias) {
  let melhor = null;
  for (const item of historico || []) {
    if (item.diaEpoch >= diaAlvo) break; // ordenado -- pode parar
    if (diaAlvo - item.diaEpoch <= janelaDias) melhor = item;
  }
  return melhor;
}

function agregarEquipesFracao(opcoes) {
  const o = opcoes || {};
  const equipes = o.equipes || [];
  const ano = o.ano;
  const mes = o.mes;
  const resolverSup = o.resolverSup || ((sup) => sup);
  const janelaFallbackDias = o.janelaFallbackDias || JANELA_FALLBACK_PADRAO;
  const { porSondadorDia, historicoPorSondador } = indexarLink7(o.linhasLink7);

  const porDia = {};
  let semLink7 = 0;
  const diasPorEstado = { mobilizada: 0, campoSemFuro: 0, fora: 0, naoEquipe: 0 };

  function somar(sup, tipo, dia, fracao) {
    const chave = resolverSup(sup, tipo) + '||' + tipo;
    if (!porDia[chave]) porDia[chave] = {};
    porDia[chave][dia] = (porDia[chave][dia] || 0) + fracao;
  }

  for (const equipe of equipes) {
    const historico = historicoPorSondador.get(equipe.id) || [];
    for (const d of equipe.dias) {
      const classe = classificarDiaEquipe(d.texto);
      if (!classe) continue;
      diasPorEstado[classe.estado] += 1;
      if (!contaComoAtiva(classe.estado)) continue;

      const dia = diaEpoch(new Date(Date.UTC(ano, mes - 1, d.dia)));
      const combinacoesHoje = (porSondadorDia.get(equipe.id) || new Map()).get(dia);

      if (combinacoesHoje && combinacoesHoje.size) {
        const fracao = 1 / combinacoesHoje.size;
        for (const combinacao of combinacoesHoje) {
          const [sup, tipo] = combinacao.split('||');
          somar(sup, tipo, dia, fracao);
        }
        continue;
      }

      const ultimo = ultimoDentroDaJanela(historico, dia, janelaFallbackDias);
      if (ultimo) {
        somar(ultimo.sup, ultimo.tipo, dia, 1);
      } else {
        semLink7 += 1;
      }
    }
  }

  return { porDia, semLink7, diasPorEstado };
}

module.exports = { agregarEquipesFracao, JANELA_FALLBACK_PADRAO };
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `node --test test/semanal-compute-equipes-fracao.test.js`
Expected: PASS.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `node --test test/*.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/compute-equipes-fracao.js test/semanal-compute-equipes-fracao.test.js
git commit -m "Novo cálculo de Equipes: roster do Link 6 + produção fracionada do Link 7, com fallback de 45 dias"
```

---

## Task 11: `atualizar-equipes-online.js` (fetch Link 6 gviz + Link 7 range)

**Files:**
- Create: `tools/semanal/atualizar-equipes-online.js`
- Test: `test/semanal-parse-link7.test.js` (só a função pura de parse das linhas do Link 7)

**Interfaces:**
- Consumes: `cdp.fetchTexto`/`abrirSessao`/`rasparTabelaDataTable` (Tasks 2 + existentes), `parseAbaEq` (existe), `agregarEquipesFracao` (Task 10).
- Produces: `dist/equipes-online.csv` — grava o `porDia` já agregado, serializado como `{sup},{tipologia},{diaEpoch},{fracao}` por linha (formato mínimo, sem precisar reproduzir o layout de `equipes-produtivas-online.csv` antigo, já que o consumidor em `build-dashboard.js` também muda nesta troca — ver Task 12). Nova função pura exportada: `parseLinhasLink7(linhasCru, ano, mes)` → `{ idSondador, sup, tipo, diaEpoch }[]`.

- [ ] **Step 1: Escrever o teste de `parseLinhasLink7`**

Criar `test/semanal-parse-link7.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseLinhasLink7 } = require('../tools/semanal/atualizar-equipes-online.js');
const { diaEpoch } = require('../tools/semanal/compute-semanal.js');

function linhaLink7Cru(over = {}) {
  return Object.assign({
    'Ordem de Serviço (OS)': '16744-25',
    Tipo: 'SP',
    'Contrato Financeiro': 'SUP-7722-24',
    'Data / Hora Primeira Foto': '08/08/2026 07:54',
    'ID Sondador': '3275',
  }, over);
}

test('extrai idSondador, sup, tipo e diaEpoch da data/hora da primeira foto', () => {
  const [linha] = parseLinhasLink7([linhaLink7Cru()]);
  assert.strictEqual(linha.idSondador, '3275');
  assert.strictEqual(linha.sup, 'SUP-7722-24');
  assert.strictEqual(linha.tipo, 'SP');
  assert.strictEqual(linha.diaEpoch, diaEpoch(new Date('2026-08-08T00:00:00Z')));
});

test('linha com data ilegível é descartada, não quebra', () => {
  const linhas = parseLinhasLink7([linhaLink7Cru({ 'Data / Hora Primeira Foto': '' })]);
  assert.strictEqual(linhas.length, 0);
});

test('duas linhas da mesma OS+dia (múltiplas fotos) viram duas entradas -- a deduplicação de combinação acontece em compute-equipes-fracao.js, não aqui', () => {
  const linhas = parseLinhasLink7([linhaLink7Cru(), linhaLink7Cru()]);
  assert.strictEqual(linhas.length, 2);
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node --test test/semanal-parse-link7.test.js`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `atualizar-equipes-online.js`**

```javascript
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parseAbaEq } = require('./compute-equipes-ativas.js');
const { agregarEquipesFracao } = require('./compute-equipes-fracao.js');
const { diaEpoch } = require('./compute-semanal.js');
const cdp = require('./cdp-client.js');

const SITE_ORIGIN = 'https://sond.com.br';
const SHEET_ID = '1Mgj87eSKMO4Gh2aHQWChNl5YCH2vatMDC2fCNuxB8TU';
const OUT_PATH = path.join(__dirname, '..', '..', 'dist', 'equipes-online.csv');
const JANELA_FALLBACK_DIAS = 45;

const MESES_PT = ['JANEIRO', 'FEVEREIRO', 'MAR', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];

function nomeAbaEq(ano, mesIndice0) {
  return `${ano} - ${MESES_PT[mesIndice0]} (EQ)`;
}

const RE_DATA_HORA = /^(\d{2})\/(\d{2})\/(\d{4})/;
function parseLinhasLink7(linhasCru) {
  const saida = [];
  for (const l of linhasCru || []) {
    const bruto = String(l['Data / Hora Primeira Foto'] || '').trim();
    const m = RE_DATA_HORA.exec(bruto);
    if (!m) continue;
    const dia = diaEpoch(new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))));
    saida.push({
      idSondador: String(l['ID Sondador'] || '').trim(),
      sup: String(l['Contrato Financeiro'] || '').trim(),
      tipo: String(l['Tipo'] || '').trim(),
      diaEpoch: dia,
    });
  }
  return saida;
}

async function main() {
  console.log('Checando conexao com o Chrome (CDP)...');
  await cdp.checarConexao();

  const hoje = new Date();
  const ano = hoje.getUTCFullYear();
  const mesIndice0 = hoje.getUTCMonth();
  const aba = nomeAbaEq(ano, mesIndice0);

  console.log(`Buscando roster de equipes (Link 6 -- aba "${aba}")...`);
  const { session: s6, target: t6 } = await cdp.abrirSessao('https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/edit');
  let csvLink6;
  try {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(aba)}`;
    csvLink6 = await cdp.fetchTexto(s6, url);
  } finally {
    await cdp.fecharSessao(s6, t6);
  }
  const equipes = parseAbaEq(csvLink6);
  console.log(`  ${equipes.length} equipe(s) no roster.`);

  const fim = new Date(Date.UTC(ano, mesIndice0 + 1, 0));
  const inicioJanela = new Date(Date.now() - JANELA_FALLBACK_DIAS * 86400000);
  const fmtData = (d) => d.toISOString().slice(0, 10);
  console.log(`Buscando produção (Link 7 -- campo/sondagens, ${fmtData(inicioJanela)} a ${fmtData(fim)})...`);
  const { session: s7, target: t7 } = await cdp.abrirSessao(
    `${SITE_ORIGIN}/campo/sondagens/de/${fmtData(inicioJanela)}/ate/${fmtData(fim)}/tabela/1/`
  );
  let linhasLink7;
  try {
    const { headers, rows } = await cdp.rasparTabelaDataTable(s7, '#table', { timeoutMs: 45000 });
    linhasLink7 = parseLinhasLink7(cdp.linhasComoObjetos({ headers, rows }));
  } finally {
    await cdp.fecharSessao(s7, t7);
  }
  console.log(`  ${linhasLink7.length} sondagem-dia encontrada(s).`);

  const { porDia, semLink7, diasPorEstado } = agregarEquipesFracao({
    equipes, linhasLink7, ano, mes: mesIndice0 + 1, resolverSup: (sup) => sup, janelaFallbackDias: JANELA_FALLBACK_DIAS,
  });
  console.log(`  Estados do mês: ${JSON.stringify(diasPorEstado)}. ${semLink7} equipe-dia sem produção em ${JANELA_FALLBACK_DIAS} dias -- fora da conta.`);

  const linhasSaida = ['SUP,Tipo,DiaEpoch,Fracao'];
  for (const [chave, porDiaChave] of Object.entries(porDia)) {
    const [sup, tipo] = chave.split('||');
    for (const [dia, fracao] of Object.entries(porDiaChave)) {
      linhasSaida.push(`${sup},${tipo},${dia},${fracao}`);
    }
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, linhasSaida.join('\n') + '\n', 'utf8');
  console.log(`Pronto: gravado em ${OUT_PATH}.`);
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { parseLinhasLink7, nomeAbaEq, main };
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `node --test test/semanal-parse-link7.test.js`
Expected: PASS.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `node --test test/*.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/atualizar-equipes-online.js test/semanal-parse-link7.test.js
git commit -m "Novo fetcher: Equipes via Link 6 (roster) + Link 7 (produção), substitui campo/fotos"
```

---

## Task 12: `build-dashboard.js` — trocar todas as fontes

**Files:**
- Modify: `tools/semanal/build-dashboard.js`
- Test: `test/semanal-build-dashboard.test.js` (ajustar fixtures existentes)

**Interfaces:**
- Consumes: `avancos-online.csv` (Task 4, cabeçalho inalterado), `demandas-sondagem-online.csv` (Task 6, mesmo cabeçalho), `demandas-lab-online.json` (Task 9), `equipes-online.csv` (Task 11), `computeDemandas` estendido (Task 7), `parseLab` estendido (Task 8).

- [ ] **Step 1: Ler o teste existente de `build-dashboard.js` para entender a fixture atual**

Run: `node --test test/semanal-build-dashboard.test.js -- --test-reporter=tap` (ou abrir o arquivo) para ver como o teste hoje monta `avancos-online.csv`/`lab-online.csv`/`equipes-produtivas-online.csv` sintéticos. Ajustar essas fixtures para:
- `avancos-online.csv`: sem mudança de layout (mesmo cabeçalho de sempre).
- Nenhuma fixture de `demandas-sondagem-online.csv` obrigatória — Task 12 Step 3 trata a ausência do arquivo como "sem pendentes", não como erro (mesmo espírito de `equipes-produtivas-online.csv` hoje, que já é opcional via `fs.existsSync`).
- `equipes-produtivas-online.csv` sai da fixture; `equipes-online.csv` (novo formato `SUP,Tipo,DiaEpoch,Fracao`) entra, se o teste cobrir esse caminho.

- [ ] **Step 2: Trocar a leitura de Avanços para concatenar Avanços + Demandas pendentes**

Substituir o bloco de leitura de `CAMINHO_AVANCOS_ONLINE` (linhas 198-211) por:

```javascript
  const CAMINHO_AVANCOS_ONLINE = path.join(__dirname, '..', '..', 'dist', 'avancos-online.csv');
  const CAMINHO_DEMANDAS_SONDAGEM_ONLINE = path.join(__dirname, '..', '..', 'dist', 'demandas-sondagem-online.csv');
  let gridAvancos;
  try {
    const csvTexto = fs.readFileSync(CAMINHO_AVANCOS_ONLINE, 'utf8');
    gridAvancos = parseCsvGrid(csvTexto);
  } catch (err) {
    throw new Error(
      `Não consegui ler ${CAMINHO_AVANCOS_ONLINE}. Rode ` +
      `"node tools/semanal/atualizar-avancos-online.js" primeiro (precisa do Chrome ` +
      `aberto com --remote-debugging-port=9222, logado em sond.com.br). Erro original: ${err.message}`
    );
  }
  // Demandas pendentes de sondagem (Link 2 + 3) são OPCIONAIS: sem o arquivo,
  // o build continua com Realizado normal, só sem os furos ainda não
  // executados no estoque de Demandas -- mesmo espírito de robustez que
  // equipes-produtivas-online.csv já tem (ver mais abaixo).
  if (fs.existsSync(CAMINHO_DEMANDAS_SONDAGEM_ONLINE)) {
    const gridPendentes = parseCsvGrid(fs.readFileSync(CAMINHO_DEMANDAS_SONDAGEM_ONLINE, 'utf8'));
    // gridPendentes[0] é cabeçalho (igual ao de gridAvancos[0]) -- só as
    // linhas de dado (índice 1 em diante) entram.
    for (let i = 1; i < gridPendentes.length; i++) gridAvancos.push(gridPendentes[i]);
  } else {
    console.warn(`AVISO: ${CAMINHO_DEMANDAS_SONDAGEM_ONLINE} não encontrado -- Demandas Pendentes de sondagem não inclui furos ainda não executados. Rode "node tools/semanal/atualizar-demandas-sondagem-online.js".`);
  }
  gridAvancos.unshift(null);
  const { furos: furosLidos, descartadas, semDataTermino, cancelamentoIlegivel, deslocamentos } = parseAvancos(gridAvancos);
```

- [ ] **Step 3: Ler Demandas de lab pendentes e juntar com `ensaiosLidos`**

Depois do bloco de leitura de `CAMINHO_LAB_ONLINE`/`parseLab` (depois da linha 241 atual), adicionar:

```javascript
  const CAMINHO_DEMANDAS_LAB_ONLINE = path.join(__dirname, '..', '..', 'dist', 'demandas-lab-online.json');
  let ensaiosComPendentes = ensaiosLidos;
  if (fs.existsSync(CAMINHO_DEMANDAS_LAB_ONLINE)) {
    const pendentesLab = JSON.parse(fs.readFileSync(CAMINHO_DEMANDAS_LAB_ONLINE, 'utf8'))
      .map((e) => ({ ...e, criacao: e.criacao ? new Date(e.criacao) : null, concluido: null }));
    ensaiosComPendentes = ensaiosLidos.concat(pendentesLab);
    console.log(`Demandas de lab: ${pendentesLab.length} ensaio(s) pendente(s) incluído(s).`);
  } else {
    console.warn(`AVISO: ${CAMINHO_DEMANDAS_LAB_ONLINE} não encontrado -- Demandas Pendentes de LAB.C/LAB.E não inclui backlog. Rode "node tools/semanal/atualizar-demandas-lab-online.js".`);
  }
```

E trocar a chamada de `redirecionarSupsDesconhecidos(ensaiosLidos, registros)` (linha 242) para usar `ensaiosComPendentes` em vez de `ensaiosLidos`.

- [ ] **Step 4: Trocar a fonte de Equipes produtivas**

Substituir o bloco `CAMINHO_EQUIPES_PRODUTIVAS` (linhas 285 em diante, até o fechamento desse `if`) pela leitura de `equipes-online.csv`:

```javascript
  const CAMINHO_EQUIPES_ONLINE = path.join(__dirname, '..', '..', 'dist', 'equipes-online.csv');
  if (fs.existsSync(CAMINHO_EQUIPES_ONLINE)) {
    const linhasCsv = fs.readFileSync(CAMINHO_EQUIPES_ONLINE, 'utf8').trim().split('\n').slice(1);
    const porDiaFracao = {};
    let diasEncontrados = new Set();
    for (const linha of linhasCsv) {
      if (!linha) continue;
      const [sup, tipo, diaStr, fracaoStr] = linha.split(',');
      const supResolvido = resolverSupConhecido(registros)(sup, tipo);
      const chave = supResolvido + '||' + tipo;
      const dia = Number(diaStr);
      if (!porDiaFracao[chave]) porDiaFracao[chave] = {};
      porDiaFracao[chave][dia] = (porDiaFracao[chave][dia] || 0) + Number(fracaoStr);
      diasEncontrados.add(dia);
    }
    if (Object.keys(porDiaFracao).length) {
      demandas.equipesPorDia = porDiaFracao;
      // periodoProdutivas equivalente: o mês/ano do build (equipes-online.csv
      // já é buscado por mês -- ver atualizar-equipes-online.js).
      const diasArr = [...diasEncontrados];
      const diaRepresentativo = new Date(Math.min(...diasArr) * 86400000);
      demandas.equipesPeriodo = { ano: diaRepresentativo.getUTCFullYear(), mes: diaRepresentativo.getUTCMonth() + 1 };
      fonteEquipes = 'FRACIONADAS (Link 6 + 7)';
    }
  }
```

Nota: este bloco substitui inteiramente a leitura de `equipes-produtivas-online.csv` e a chamada a `agregarEquipesProdutivas` — `compute-equipes-produtivas.js` fica sem consumidor em `build-dashboard.js` a partir desta task (mantido no repositório, sem remoção: pode ter outro consumidor em `render-semanal.js`/botão "Atualizar dados" — checar no Step 6 abaixo antes de decidir se remove).

- [ ] **Step 5: Rodar o teste de build e ajustar fixtures**

Run: `node --test test/semanal-build-dashboard.test.js`
Expected: ajustar a fixture de `Data Programada` que falta no grid de Lab sintético (Task 8, Step 5) e qualquer referência a `equipes-produtivas-online.csv` que o teste monte — trocar para `equipes-online.csv` no novo formato `SUP,Tipo,DiaEpoch,Fracao`.

- [ ] **Step 6: Checar se `render-semanal.js` (botão "Atualizar dados") também referencia as fontes antigas**

Run: `grep -n "equipes-produtivas-online\|avancos-online\|lab-online" tools/semanal/render-semanal.js`

Se houver referência (`URL_ESPELHO_*` usados no botão live-refresh do navegador), essas URLs continuam apontando pros CSVs publicados em `docs/` — atualizar os nomes de arquivo publicados para bater com os novos (`equipes-online.csv` em vez de `equipes-produtivas-online.csv`) e, se o botão fizer sua própria agregação client-side reaproveitando `compute-equipes-produtivas.js`/`agregarEquipesProdutivas`, trocar essa chamada por `agregarEquipesFracao` (o bundle client-side já reaproveita `classificar-dia-equipe.js`/`compute-equipes-ativas.js`, então `compute-equipes-fracao.js` precisa entrar em `BUNDLE_ARQUIVOS` do mesmo jeito). Esta etapa é investigativa — se o grep não achar nada em `render-semanal.js` além do nome do arquivo publicado, só o nome muda, sem mais trabalho.

- [ ] **Step 7: Rodar a suíte inteira**

Run: `node --test test/*.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add tools/semanal/build-dashboard.js test/semanal-build-dashboard.test.js
git commit -m "build-dashboard: consome as novas fontes (avancos+demandas-sondagem, demandas-lab, equipes fracionadas)"
```

---

## Task 13: "Atualizar Dash Semanal.bat" na Área de Trabalho

**Files:**
- Create: `C:\Users\supor\OneDrive\Área de Trabalho\Atualizar Dash Semanal.bat`

**Interfaces:**
- Nenhuma — arquivo local, fora do repositório, nunca commitado.

- [ ] **Step 1: Confirmar o caminho exato do repositório e escrever o `.bat`**

Run (conferir o caminho, que pode variar por máquina):
`echo %cd%` dentro do repo, ou usar o caminho já conhecido desta sessão: `C:\Users\supor\OneDrive\Área de Trabalho\AGENTES DE IA\Projetos IA\orcamento-dashboard`.

Criar `C:\Users\supor\OneDrive\Área de Trabalho\Atualizar Dash Semanal.bat`:

```batch
@echo off
setlocal

set ORCAMENTO_SENHA=sptinfra@2026
set REPO=C:\Users\supor\OneDrive\Área de Trabalho\AGENTES DE IA\Projetos IA\orcamento-dashboard
set PERFIL_CHROME=C:\Users\supor\chrome-debug-profile

echo Verificando Chrome com porta de depuracao remota...
curl -s -o nul -w "%%{http_code}" http://127.0.0.1:9222/json/version > "%TEMP%\chrome-check.txt"
set /p CODIGO=<"%TEMP%\chrome-check.txt"
if not "%CODIGO%"=="200" (
  echo Chrome nao esta respondendo na porta 9222 -- abrindo com o perfil dedicado...
  start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%PERFIL_CHROME%"
  echo Aguarde o Chrome abrir, faca login em sond.com.br se pedido, e pressione qualquer tecla para continuar.
  pause
)

if not exist "G:\Meu Drive\PMO" (
  echo.
  echo ERRO: G:\ (Google Drive, pasta PMO) nao esta montado nesta maquina.
  echo O build precisa dele para ler a MATRIZ. Monte o Drive e rode de novo.
  pause
  exit /b 1
)

cd /d "%REPO%"
echo.
echo Buscando dados novos e publicando...
node tools\semanal\atualizar-avancos-online.js
node tools\semanal\atualizar-demandas-sondagem-online.js
node tools\semanal\atualizar-lab-online.js
node tools\semanal\atualizar-demandas-lab-online.js
node tools\semanal\atualizar-equipes-online.js
node tools\semanal\build-dashboard.js
copy /y dist\planejamento-semanal.html docs\planejamento-semanal.html
copy /y dist\avancos-online.csv docs\avancos-online.csv
copy /y dist\lab-online.csv docs\lab-online.csv
copy /y dist\equipes-online.csv docs\equipes-online.csv
git add -A
git commit -m "Atualizacao automatica: Realizado, Demandas e Equipes"
git push origin master

echo.
echo Pronto. Pressione qualquer tecla para fechar.
pause
endlocal
```

Nota: os `copy` de `docs/` seguem a regra permanente do CLAUDE.md do repo
("sempre publicar depois de reconstruir") e o padrão de
`atualizar-arquivos.js` já existente. `demandas-sondagem-online.csv` e
`demandas-lab-online.json` NÃO precisam de `copy` para `docs/` — só
alimentam o build (Task 12 os lê de `dist/`), o botão "Atualizar dados" no
navegador não os busca diretamente (diferente de avancos/lab/equipes, que o
botão live-refresh já busca de `docs/` — ver Task 12 Step 6 se isso mudar).

- [ ] **Step 2: Testar rodando o `.bat` uma vez manualmente**

Isso será feito na Task 14 (execução completa), não aqui — este step só cria o arquivo.

- [ ] **Step 3: Nenhum commit** — arquivo fica só na Área de Trabalho, fora do repositório git.

---

## Task 14: Execução completa e publicação

**Files:** nenhum arquivo novo — task de verificação manual.

- [ ] **Step 1: Rodar a suíte inteira uma última vez**

Run: `node --test test/*.js`
Expected: PASS, 0 falhas.

- [ ] **Step 2: Rodar o `.bat` de ponta a ponta**

Dar duplo clique em `Atualizar Dash Semanal.bat` (ou rodar via terminal), acompanhar o output de cada um dos 5 fetchers + build. Confirmar:
- Nenhuma das 5 fontes abortou (ver os avisos de "AVISO"/"FALHOU" no console).
- `git status` antes do `git add -A` automático do `.bat` mostra só os arquivos esperados (`dist/*`, `docs/*`, `dist/cache/*` NÃO deveria aparecer se o `.gitignore` da Task 4 está correto).

- [ ] **Step 3: Verificar a página publicada ao vivo**

Run: `curl -s https://amcaccere261283.github.io/orcamento-dashboard/planejamento-semanal.html | grep -o "Gerado em[^<]*"` (se a página tiver esse carimbo; senão, abrir a URL no navegador e conferir visualmente que Tabela Semanal/Gráficos/Demandas/Balanço têm números plausíveis, não todos zerados).

- [ ] **Step 4: Reportar ao usuário**

Resumo do que rodou: quantos contratos/meses de Realizado, quantos furos/ensaios pendentes incluídos em Demandas, quantas equipes no roster e quantas ficaram de fora por falta de produção em 45 dias — sem precisar de commit (é comunicação, não código).
