# Botão "Congelar próxima semana" no Consolidado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o congelamento agendado (cron sexta 22h, nunca implementado) por um botão no Consolidado que congela a próxima semana, gravando numa Sheet via Apps Script atrás de token derivado da senha — o que de quebra elimina os três defeitos que a revisão final achou no caminho antigo.

**Architecture:** O navegador calcula o snapshot com as funções puras que já existem (`calcularSnapshotSemanaAlvo`), consulta a Sheet para saber se a semana-alvo já foi congelada, e grava via Apps Script Web App (mesmo padrão de `apps-script-alocacao.gs`). O Consolidado passa a BUSCAR o congelado em tempo de execução em vez de ler um global assado no HTML — então o dado nunca entra na página pública. O CLI, o heartbeat, o JSON no git e `window.__CONGELADO_SEMANAL__` são aposentados.

**Tech Stack:** Node puro (sem dependências, `node --test`), módulos duais Node+navegador em `var`/`function`, Google Apps Script (`.gs`) testado em sandbox com `vm`.

Spec: `docs/superpowers/specs/2026-08-31-congelar-semana-botao-design.md`.

## Global Constraints

- Nenhuma dependência nova (`node --test`, sem `npm install`).
- Módulos do bundle do navegador em `var`/`function` no top-level exportado — nunca `const`/`let`/arrow. (`build-dashboard.js` é Node-only e está isento.)
- Nenhuma crase solta dentro dos template literals `SCRIPT_CLIENTE_SEMANAL`/`CSS_SEMANAL` (`render-semanal.js`) — trunca o script do cliente inteiro EM SILÊNCIO, sintoma aparece longe como `montarDashboard is not defined`. Vale para comentários também.
- `ORCAMENTO_SENHA` e o token do Apps Script **nunca** em arquivo do repositório.
- Chave de registro sempre via `chaveMatriz(sup, tipologia)` (`tools/comum/linha-base.js`), que produz `sup + '||' + tipologia` — **dois** pipes. Nunca montar à mão.
- `docs/planejamento-semanal.html` e `docs/alocacao-equipes.html` são cópias byte a byte de `dist/` — `test/publicacao-docs-sincronizado.test.js` trava isso. Nunca fazer `git checkout`/`restore` de só um dos dois (`core.autocrlf` inverte a terminação e quebra o teste sem mudar conteúdo); regenere os dois com o build.
- Não quebrar o guard de ciclos: `test/semanal-bundle-sem-ciclos.test.js` faz detecção estática de ciclo em `tools/semanal/` e checa ordem de registro nos DOIS bundles (`BUNDLE_ARQUIVOS` e `BUNDLE_ARQUIVOS_ALOCACAO`).

---

## Task 1: `proximaSegunda` e os fragmentos da semana-alvo

**Files:**
- Modify: `tools/semanal/congelar-tendencia-semanal.js`
- Test: `test/semanal-congelar-tendencia.test.js`

**Interfaces:**
- Consumes: `semanasDoMes(ano, mes0)` (`tools/semanal/compute-semanal.js`) — devolve array de `{ inicio, fim }` em dia-epoch, cortando semanas na virada do mês.
- Produces: `proximaSegunda(hojeEpoch)` → `'YYYY-MM-DD'`; `fragmentosDaSemanaAlvo(chaveSegunda)` → array de `{ chave, ano, mesIdx, semanas, indiceNoMes }`, um por fragmento de calendário que a semana ocupa. Consumidos pela Task 2.

- [ ] **Step 1: Escrever o teste de `proximaSegunda` nos sete dias**

Acrescentar em `test/semanal-congelar-tendencia.test.js`:

```javascript
const { proximaSegunda } = require('../tools/semanal/congelar-tendencia-semanal.js');

// 2026-08-28 é uma SEXTA. A semana seguinte começa em 2026-08-31.
// 2026-08-31 é uma SEGUNDA. A semana seguinte a ela começa em 2026-09-07.
test('proximaSegunda devolve sempre a segunda ESTRITAMENTE depois de hoje', () => {
  const dia = (ano, mes1, d) => Date.UTC(ano, mes1 - 1, d) / 86400000;
  assert.equal(proximaSegunda(dia(2026, 8, 28)), '2026-08-31'); // sexta
  assert.equal(proximaSegunda(dia(2026, 8, 29)), '2026-08-31'); // sábado
  assert.equal(proximaSegunda(dia(2026, 8, 30)), '2026-08-31'); // domingo
  assert.equal(proximaSegunda(dia(2026, 8, 31)), '2026-09-07'); // SEGUNDA -> a seguinte
  assert.equal(proximaSegunda(dia(2026, 9, 1)), '2026-09-07');  // terça
  assert.equal(proximaSegunda(dia(2026, 9, 2)), '2026-09-07');  // quarta
  assert.equal(proximaSegunda(dia(2026, 9, 3)), '2026-09-07');  // quinta
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/semanal-congelar-tendencia.test.js`
Expected: FAIL — `proximaSegunda` não exportada.

- [ ] **Step 3: Implementar `proximaSegunda`**

Acrescentar em `tools/semanal/congelar-tendencia-semanal.js`, logo abaixo de `chaveSemanaSeguinteDeSexta` (que sai na Task 9):

```javascript
// dia-epoch (dias desde a época Unix, UTC) -> 'YYYY-MM-DD' da próxima SEGUNDA
// estritamente depois de hoje. Clicar numa segunda congela a semana SEGUINTE,
// não a que acabou de começar.
//
// NÃO confundir com chaveSemanaSeguinteDeSexta, que mapeia segunda-quinta de
// VOLTA pra sexta anterior (regra do cron, tolerante a atraso) e devolveria a
// semana CORRENTE numa terça. O botão aceita clique em qualquer dia, então
// aquela regra congelaria a semana errada em silêncio.
function proximaSegunda(hojeEpoch) {
  var data = new Date(hojeEpoch * 86400000);
  var diaSemana = data.getUTCDay(); // 0=domingo .. 6=sábado
  // Dias até a próxima segunda: domingo->1, segunda->7, terça->6, ... sábado->2.
  var faltam = (8 - diaSemana) % 7;
  if (faltam === 0) faltam = 7;
  return formatarDiaIso(hojeEpoch + faltam);
}

// dia-epoch -> 'YYYY-MM-DD'. Extraído porque proximaSegunda e
// fragmentosDaSemanaAlvo precisam do mesmo formato.
function formatarDiaIso(diaEpoch) {
  var d = new Date(diaEpoch * 86400000);
  var ano = d.getUTCFullYear();
  var mes = String(d.getUTCMonth() + 1).padStart(2, '0');
  var dia = String(d.getUTCDate()).padStart(2, '0');
  return ano + '-' + mes + '-' + dia;
}
```

Acrescentar `proximaSegunda` e `formatarDiaIso` ao `module.exports` existente.

- [ ] **Step 4: Rodar e confirmar passando**

Run: `node --test test/semanal-congelar-tendencia.test.js`
Expected: PASS

- [ ] **Step 5: Escrever o teste dos fragmentos**

```javascript
const { fragmentosDaSemanaAlvo } = require('../tools/semanal/congelar-tendencia-semanal.js');

// A semana de 31/08 a 06/09 CRUZA a virada do mês. semanasDoMes corta semanas
// dentro do mês, então ela existe como DOIS fragmentos: o toco [31/08, 31/08]
// em agosto e [01/09, 06/09] em setembro. O leitor do Consolidado procura pelo
// INÍCIO do fragmento -- 2026-09-01, uma terça -- então gravar só sob a segunda
// deixaria essa semana sem congelado.
test('fragmentosDaSemanaAlvo devolve os DOIS fragmentos de uma semana que cruza a virada do mês', () => {
  const frags = fragmentosDaSemanaAlvo('2026-08-31');
  assert.equal(frags.length, 2);
  assert.deepEqual(frags.map((f) => f.chave), ['2026-08-31', '2026-09-01']);
  assert.equal(frags[0].mesIdx, 7); // agosto
  assert.equal(frags[1].mesIdx, 8); // setembro
});

test('fragmentosDaSemanaAlvo devolve UM fragmento para semana inteira dentro do mês', () => {
  const frags = fragmentosDaSemanaAlvo('2026-09-07'); // 07/09 a 13/09, tudo em setembro
  assert.equal(frags.length, 1);
  assert.equal(frags[0].chave, '2026-09-07');
});
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `node --test test/semanal-congelar-tendencia.test.js`
Expected: FAIL — `fragmentosDaSemanaAlvo` não exportada.

- [ ] **Step 7: Implementar `fragmentosDaSemanaAlvo`**

```javascript
// chaveSegunda ('YYYY-MM-DD', sempre uma segunda) -> um descritor por FRAGMENTO
// de calendário que essa semana ocupa.
//
// semanasDoMes corta semanas na virada do mês, então a semana 31/08-06/09 vira
// [31/08,31/08] em agosto MAIS [01/09,06/09] em setembro. O Consolidado chaveia
// pelo início do fragmento que está em tela, então o congelamento precisa gravar
// sob TODAS as chaves que ele pode procurar -- senão ~1 mês em 4 tem uma semana
// que nunca acha o próprio snapshot.
//
// Substitui localizarSemanaAlvo, que devolvia UM alvo e LANÇAVA quando a chave
// não era início de semana no mês dela.
function fragmentosDaSemanaAlvo(chaveSegunda) {
  var partes = chaveSegunda.split('-').map(Number);
  var epochSegunda = Date.UTC(partes[0], partes[1] - 1, partes[2]) / 86400000;
  var epochDomingo = epochSegunda + 6;
  var fragmentos = [];

  // A semana toca no máximo dois meses: o da segunda e o do domingo.
  var mesesTocados = [{ ano: partes[0], mes0: partes[1] - 1 }];
  var dataDomingo = new Date(epochDomingo * 86400000);
  var anoD = dataDomingo.getUTCFullYear(), mesD = dataDomingo.getUTCMonth();
  if (anoD !== mesesTocados[0].ano || mesD !== mesesTocados[0].mes0) {
    mesesTocados.push({ ano: anoD, mes0: mesD });
  }

  mesesTocados.forEach(function (m) {
    var semanas = semanasDoMes(m.ano, m.mes0);
    semanas.forEach(function (s, indice) {
      // O fragmento pertence a esta semana-alvo se ele cai DENTRO do intervalo
      // segunda..domingo dela.
      if (s.inicio < epochSegunda || s.inicio > epochDomingo) return;
      fragmentos.push({
        chave: formatarDiaIso(s.inicio), ano: m.ano, mesIdx: m.mes0,
        semanas: semanas, indiceNoMes: indice,
      });
    });
  });
  return fragmentos;
}
```

Acrescentar `fragmentosDaSemanaAlvo` ao `module.exports`.

- [ ] **Step 8: Rodar e confirmar os testes do arquivo passando**

Run: `node --test test/semanal-congelar-tendencia.test.js`
Expected: PASS (todos)

- [ ] **Step 9: Commit**

```bash
git add tools/semanal/congelar-tendencia-semanal.js test/semanal-congelar-tendencia.test.js
git commit -m "feat: proximaSegunda e fragmentosDaSemanaAlvo (semana que cruza virada de mes)"
```

---

## Task 2: `calcularSnapshotSemanaAlvo` recebe a chave e devolve linhas por fragmento

**Files:**
- Modify: `tools/semanal/congelar-tendencia-semanal.js`
- Test: `test/semanal-congelar-tendencia.test.js`

**Interfaces:**
- Consumes: `proximaSegunda`, `fragmentosDaSemanaAlvo`, `formatarDiaIso` (Task 1); `calcularSeriesSemanaisDimensao` (`tools/semanal/render-aba-semanal.js`); `chaveMatriz` (`tools/comum/linha-base.js`).
- Produces: `calcularSnapshotSemanaAlvo(registros, demandas, hojeEpoch, chaveSegundaAlvo)` — o 4º parâmetro é NOVO e obrigatório; devolve `{ chaveSegunda, geradoEmIso, linhas: [{ chave, chaveMatriz, volume, financeiro, equipe, produtividadeMedia }] }`. `linhas` é o payload que a Task 4 envia ao Apps Script.

- [ ] **Step 1: Escrever o teste do novo formato**

```javascript
test('calcularSnapshotSemanaAlvo emite uma linha por (fragmento x registro), com as 4 tendencias', () => {
  const registros = [
    { sup: 'SUP-1', tipologia: 'SP', tomador: 'X',
      previsto: { volume: Array(12).fill(100) }, total: { equipes: Array(12).fill(2) } },
  ];
  const demandas = { porRegistroEventos: {} };
  const hojeEpoch = Date.UTC(2026, 7, 28) / 86400000; // sexta 28/08
  const snapshot = calcularSnapshotSemanaAlvo(registros, demandas, hojeEpoch, '2026-08-31');

  assert.equal(snapshot.chaveSegunda, '2026-08-31');
  // 1 registro x 2 fragmentos (31/08 e 01/09) = 2 linhas.
  assert.equal(snapshot.linhas.length, 2);
  assert.deepEqual(snapshot.linhas.map((l) => l.chave).sort(), ['2026-08-31', '2026-09-01']);
  snapshot.linhas.forEach((linha) => {
    assert.equal(linha.chaveMatriz, 'SUP-1||SP');
    assert.equal(typeof linha.volume, 'number');
    assert.equal(typeof linha.equipe, 'number');
    assert.equal(linha.produtividadeMedia, linha.volume / linha.equipe);
  });
});

test('calcularSnapshotSemanaAlvo devolve produtividadeMedia null quando equipe e 0', () => {
  const registros = [
    { sup: 'SUP-2', tipologia: 'ST', tomador: 'Y',
      previsto: { volume: Array(12).fill(50) }, total: { equipes: Array(12).fill(0) } },
  ];
  const hojeEpoch = Date.UTC(2026, 8, 4) / 86400000; // sexta 04/09
  const snapshot = calcularSnapshotSemanaAlvo(registros, { porRegistroEventos: {} }, hojeEpoch, '2026-09-07');
  assert.equal(snapshot.linhas[0].produtividadeMedia, null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/semanal-congelar-tendencia.test.js`
Expected: FAIL — hoje a função ignora o 4º parâmetro e devolve `{ chaveSemanaAlvo, porRegistro }`.

- [ ] **Step 3: Reescrever `calcularSnapshotSemanaAlvo`**

Substituir a função inteira (e `tendenciaDaSemanaAlvo` passa a receber o fragmento):

```javascript
function tendenciaDoFragmento(registros, indices, dimensao, fragmento, demandas, hojeEpoch) {
  var indiceAtual = indiceSemanaAtual(fragmento.semanas, hojeEpoch);
  var series = calcularSeriesSemanaisDimensao(
    registros, indices, dimensao, fragmento.mesIdx, fragmento.semanas, fragmento.semanas.length,
    !!(demandas && demandas.porRegistroEventos), indiceAtual, demandas, hojeEpoch
  );
  var v = series.semanasTendenciaCompleta[fragmento.indiceNoMes];
  return (v === null || v === undefined) ? null : v;
}

// registros: array cru da MATRIZ (mesmo formato de window.__REGISTROS__).
// demandas: { porRegistroEventos } (mesmo formato de window.__DEMANDAS__).
// hojeEpoch: dia-epoch (UTC) do clique.
// chaveSegundaAlvo: 'YYYY-MM-DD' da segunda da semana a congelar -- vem de
//   proximaSegunda(hojeEpoch). É parâmetro em vez de calculado aqui dentro pra
//   que o chamador possa mostrar na tela QUAL semana vai congelar antes de
//   confirmar, sem recalcular a regra em dois lugares.
function calcularSnapshotSemanaAlvo(registros, demandas, hojeEpoch, chaveSegundaAlvo) {
  var fragmentos = fragmentosDaSemanaAlvo(chaveSegundaAlvo);
  var linhas = [];
  fragmentos.forEach(function (fragmento) {
    (registros || []).forEach(function (registro, idx) {
      var volume = tendenciaDoFragmento(registros, [idx], 'volume', fragmento, demandas, hojeEpoch);
      var financeiro = tendenciaDoFragmento(registros, [idx], 'financeiro', fragmento, demandas, hojeEpoch);
      var equipe = tendenciaDoFragmento(registros, [idx], 'equipes', fragmento, demandas, hojeEpoch);
      linhas.push({
        chave: fragmento.chave,
        chaveMatriz: chaveMatriz(registro.sup, registro.tipologia),
        volume: volume, financeiro: financeiro, equipe: equipe,
        produtividadeMedia: (volume === null || !equipe) ? null : volume / equipe,
      });
    });
  });
  return { chaveSegunda: chaveSegundaAlvo, geradoEmIso: new Date().toISOString(), linhas: linhas };
}
```

Remover `localizarSemanaAlvo` e `tendenciaDaSemanaAlvo` (substituídas), e tirá-las do `module.exports` se estiverem lá.

- [ ] **Step 4: Rodar e confirmar passando**

Run: `node --test test/semanal-congelar-tendencia.test.js`
Expected: PASS. **Testes antigos que chamavam `calcularSnapshotSemanaAlvo` com 3 argumentos ou liam `.porRegistro` vão falhar** — atualize-os para o formato novo (`.linhas`), preservando a intenção de cada um.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/congelar-tendencia-semanal.js test/semanal-congelar-tendencia.test.js
git commit -m "feat: snapshot recebe a chave-alvo e emite linhas por fragmento de semana"
```

---

## Task 3: Apps Script do congelamento + teste em sandbox

**Files:**
- Create: `tools/semanal/apps-script-congelamento.gs`
- Test: `test/semanal-apps-script-congelamento.test.js`

**Interfaces:**
- Consumes: nada do repositório (roda no Google). O contrato é HTTP.
- Produces: `doGet(e)` com `e.parameter.semana` e `e.parameter.token` → `{ linhas: [...] }` ou `{ erro: 'token' }`; `doPost(e)` com corpo `{ token, chaveSegunda, autor, congeladoEm, linhas: [{ chave, chaveMatriz, volume, financeiro, equipe, produtividadeMedia }] }` → `{ ok: true, gravadas: N }`, `{ erro: 'token' }` ou `{ erro: 'ja-congelada', congeladoEm, autor }`. Consumido pela Task 4.

- [ ] **Step 1: Ler o Apps Script existente como molde**

Não é step de teste — é levantamento obrigatório. Leia `tools/semanal/apps-script-alocacao.gs` inteiro e `test/semanal-apps-script-alocacao.test.js`. Reproduza dali: a estrutura de `resposta()`, o padrão `setNumberFormat('@')` antes de `setValues` (impede a coerção de data), `normalizarDia` na leitura, e o modo como o teste carrega o `.gs` num sandbox `vm` com um Sheets dublê.

- [ ] **Step 2: Escrever o teste com o Sheets dublê que IMITA a coerção de data**

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const TOKEN_BOM = 'token-de-teste-abc123';

// O Sheets COAGE uma string tipo '2026-08-31' pra Date na gravação, e
// String(Date) nunca casa com a string ISO na releitura -- o script gravaria e
// descartaria a própria linha, em silêncio. Este dublê IMITA a coerção: sem
// isso, o teste passaria com o bug. Foi exatamente essa armadilha que mordeu o
// apps-script-alocacao.gs em 2026-08-11.
function criarSheetsDuble() {
  const linhas = [['Ano', 'SemanaInicio', 'Chave', 'Volume', 'Financeiro', 'Equipe', 'ProdutividadeMedia', 'Autor', 'CongeladoEm']];
  function faixa(inicioLinha, numLinhas) {
    let formatoTexto = false;
    return {
      setNumberFormat(f) { formatoTexto = (f === '@'); return this; },
      setValues(valores) {
        valores.forEach((linha, i) => {
          linhas[inicioLinha - 1 + i] = linha.map((v) => {
            // A coerção só acontece quando a célula NÃO está formatada como texto.
            if (!formatoTexto && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
              return new Date(v + 'T00:00:00Z');
            }
            return v;
          });
        });
        return this;
      },
    };
  }
  const aba = {
    getDataRange: () => ({ getValues: () => linhas.map((l) => l.slice()) }),
    getLastRow: () => linhas.length,
    getRange: (l, c, nl, nc) => faixa(l, nl),
    appendRow: (l) => { linhas.push(l); },
  };
  return {
    aba,
    linhas,
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => aba, insertSheet: () => aba }) },
  };
}

function carregarScript(duble) {
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'tools', 'semanal', 'apps-script-congelamento.gs'), 'utf8');
  const contexto = {
    SpreadsheetApp: duble.SpreadsheetApp,
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (t) => ({ setMimeType: () => ({ conteudo: t }) }),
    },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k) => (k === 'TOKEN_DASHBOARD' ? TOKEN_BOM : null) }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  };
  vm.createContext(contexto);
  vm.runInContext(codigo, contexto);
  return contexto;
}

function corpoDe(saida) { return JSON.parse(saida.conteudo); }

test('doPost grava e doGet le de volta a MESMA chave de semana (sobrevive a coercao de data)', () => {
  const duble = criarSheetsDuble();
  const ctx = carregarScript(duble);
  const gravado = corpoDe(ctx.doPost({ postData: { contents: JSON.stringify({
    token: TOKEN_BOM, chaveSegunda: '2026-08-31', autor: 'teste', congeladoEm: '2026-08-28T22:00:00Z',
    linhas: [{ chave: '2026-08-31', chaveMatriz: 'SUP-1||SP', volume: 10, financeiro: 20, equipe: 2, produtividadeMedia: 5 }],
  }) } }));
  assert.equal(gravado.ok, true);
  assert.equal(gravado.gravadas, 1);

  const lido = corpoDe(ctx.doGet({ parameter: { semana: '2026-08-31', token: TOKEN_BOM } }));
  assert.equal(lido.linhas.length, 1, 'a linha gravada tem de ser encontrada na releitura');
  assert.equal(lido.linhas[0].chaveMatriz, 'SUP-1||SP');
  assert.equal(lido.linhas[0].volume, 10);
});

test('doPost RECUSA quando a semana ja tem qualquer linha, sem sobrescrever', () => {
  const duble = criarSheetsDuble();
  const ctx = carregarScript(duble);
  const corpo = (volume) => ({ postData: { contents: JSON.stringify({
    token: TOKEN_BOM, chaveSegunda: '2026-08-31', autor: 'primeiro', congeladoEm: '2026-08-28T22:00:00Z',
    linhas: [{ chave: '2026-08-31', chaveMatriz: 'SUP-1||SP', volume: volume, financeiro: 0, equipe: 1, produtividadeMedia: volume }],
  }) } });
  ctx.doPost(corpo(10));
  const segunda = corpoDe(ctx.doPost(corpo(999)));
  assert.equal(segunda.erro, 'ja-congelada');
  assert.equal(segunda.autor, 'primeiro');

  const lido = corpoDe(ctx.doGet({ parameter: { semana: '2026-08-31', token: TOKEN_BOM } }));
  assert.equal(lido.linhas[0].volume, 10, 'o valor original NAO pode ter sido sobrescrito');
});

test('token errado e recusado na leitura e na escrita', () => {
  const duble = criarSheetsDuble();
  const ctx = carregarScript(duble);
  assert.equal(corpoDe(ctx.doGet({ parameter: { semana: '2026-08-31', token: 'errado' } })).erro, 'token');
  assert.equal(corpoDe(ctx.doPost({ postData: { contents: JSON.stringify({
    token: 'errado', chaveSegunda: '2026-08-31', linhas: [],
  }) } })).erro, 'token');
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test test/semanal-apps-script-congelamento.test.js`
Expected: FAIL — o `.gs` não existe.

- [ ] **Step 4: Escrever `tools/semanal/apps-script-congelamento.gs`**

```javascript
// Web App que guarda a Tendência CONGELADA por semana, gravada pelo botão
// "Congelar próxima semana" do Consolidado.
//
// Duas regras que não podem ser afrouxadas:
//  1. A semana só pode ser congelada UMA vez. doPost recusa se já existir
//     QUALQUER linha da semana -- inclusive de uma gravação interrompida no
//     meio. Refazer exige apagar as linhas na planilha à mão. É a promessa do
//     recurso: o número nunca muda depois.
//  2. Datas são gravadas como TEXTO. O Sheets coage '2026-08-31' pra Date, e
//     String(Date) nunca casa com a string ISO na releitura -- o script
//     gravaria e descartaria a própria linha, em silêncio.
var ABA = 'Congelamento';
var CABECALHO = ['Ano', 'SemanaInicio', 'Chave', 'Volume', 'Financeiro', 'Equipe',
  'ProdutividadeMedia', 'Autor', 'CongeladoEm'];

function tokenEsperado() {
  return PropertiesService.getScriptProperties().getProperty('TOKEN_DASHBOARD');
}

function tokenValido(recebido) {
  var esperado = tokenEsperado();
  return !!esperado && String(recebido || '') === String(esperado);
}

function abaCongelamento() {
  var planilha = SpreadsheetApp.getActiveSpreadsheet();
  var aba = planilha.getSheetByName(ABA);
  if (!aba) {
    aba = planilha.insertSheet(ABA);
    aba.getRange(1, 1, 1, CABECALHO.length).setValues([CABECALHO]);
  }
  return aba;
}

// O Sheets pode devolver Date onde gravamos texto (planilha antiga, edição
// manual). Normaliza os dois casos pra 'YYYY-MM-DD'.
function normalizarDia(valor) {
  if (valor instanceof Date) {
    var ano = valor.getUTCFullYear();
    var mes = ('0' + (valor.getUTCMonth() + 1)).slice(-2);
    var dia = ('0' + valor.getUTCDate()).slice(-2);
    return ano + '-' + mes + '-' + dia;
  }
  return String(valor || '');
}

function linhasDaSemana(chaveSemana) {
  var dados = abaCongelamento().getDataRange().getValues();
  var alvo = String(chaveSemana || '');
  var saida = [];
  for (var i = 1; i < dados.length; i++) {
    if (normalizarDia(dados[i][1]) !== alvo) continue;
    saida.push({
      chaveMatriz: String(dados[i][2]),
      volume: dados[i][3] === '' ? null : Number(dados[i][3]),
      financeiro: dados[i][4] === '' ? null : Number(dados[i][4]),
      equipe: dados[i][5] === '' ? null : Number(dados[i][5]),
      produtividadeMedia: dados[i][6] === '' ? null : Number(dados[i][6]),
      autor: String(dados[i][7] || ''),
      congeladoEm: String(dados[i][8] || ''),
    });
  }
  return saida;
}

function resposta(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!tokenValido(p.token)) return resposta({ erro: 'token' });
  return resposta({ linhas: linhasDaSemana(p.semana) });
}

function doPost(e) {
  var corpo = JSON.parse(e.postData.contents);
  if (!tokenValido(corpo.token)) return resposta({ erro: 'token' });

  var trava = LockService.getScriptLock();
  trava.waitLock(30000);
  try {
    // A checagem olha a semana INTEIRA (todos os fragmentos gravados sob a
    // mesma chaveSegunda entram como linhas com chaves diferentes, então a
    // varredura é por qualquer linha cuja SemanaInicio pertença a esta
    // gravação). Basta uma linha existir pra recusar.
    var existentes = [];
    (corpo.linhas || []).forEach(function (linha) {
      if (existentes.length) return;
      var achadas = linhasDaSemana(linha.chave);
      if (achadas.length) existentes = achadas;
    });
    if (existentes.length) {
      return resposta({ erro: 'ja-congelada', autor: existentes[0].autor, congeladoEm: existentes[0].congeladoEm });
    }

    var aba = abaCongelamento();
    var linhasParaGravar = (corpo.linhas || []).map(function (linha) {
      return [String(corpo.chaveSegunda).slice(0, 4), linha.chave, linha.chaveMatriz,
        linha.volume, linha.financeiro, linha.equipe, linha.produtividadeMedia,
        corpo.autor || '', corpo.congeladoEm || ''];
    });
    if (linhasParaGravar.length) {
      var primeira = Math.max(aba.getLastRow() + 1, 2);
      var faixa = aba.getRange(primeira, 1, linhasParaGravar.length, CABECALHO.length);
      faixa.setNumberFormat('@'); // ANTES de escrever -- é o que impede a coerção de data
      faixa.setValues(linhasParaGravar);
    }
    return resposta({ ok: true, gravadas: linhasParaGravar.length });
  } finally {
    trava.releaseLock();
  }
}
```

- [ ] **Step 5: Rodar e confirmar os 3 testes passando**

Run: `node --test test/semanal-apps-script-congelamento.test.js`
Expected: PASS (3)

- [ ] **Step 6: Provar por MUTAÇÃO que o teste da coerção morde**

Troque temporariamente `faixa.setNumberFormat('@');` por `faixa.setNumberFormat('0');` e rode de novo: o teste "sobrevive a coercao de data" tem de ficar VERMELHO. Reverta em seguida. Sem essa prova o teste pode estar passando por acidente.

Run: `node --test test/semanal-apps-script-congelamento.test.js`
Expected: FAIL enquanto mutado; PASS depois de reverter.

- [ ] **Step 7: Commit**

```bash
git add tools/semanal/apps-script-congelamento.gs test/semanal-apps-script-congelamento.test.js
git commit -m "feat: Apps Script do congelamento (token, recusa de reclique, data como texto)"
```

---

## Task 4: Cliente do congelamento (`congelamento-sheet.js`)

**Files:**
- Create: `tools/semanal/congelamento-sheet.js`
- Test: `test/semanal-congelamento-sheet.test.js`

**Interfaces:**
- Consumes: o contrato HTTP do Task 3.
- Produces: `criarClienteCongelamento({ url, fetch, token })` → `{ carregar(chaveSemana), congelar(snapshot, autor) }`. `carregar` devolve `{ porRegistro: { [chaveMatriz]: { volume:{tendencia}, financeiro:{tendencia}, equipe:{tendencia}, produtividadeMedia:{tendencia} } }, autor, congeladoEm }` ou `null` quando a semana não tem congelado / a Sheet falhou. `congelar` devolve `{ ok: true }` ou `{ ok: false, motivo: 'ja-congelada'|'token'|'rede', autor, congeladoEm }`. Consumido pelas Tasks 6 e 8.

- [ ] **Step 1: Escrever o teste com `fetch` dublê**

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarClienteCongelamento } = require('../tools/semanal/congelamento-sheet.js');

function fetchDuble(respostas) {
  const chamadas = [];
  return {
    chamadas,
    fetch: async (url, opcoes) => {
      chamadas.push({ url: String(url), opcoes: opcoes || null });
      const r = respostas.shift();
      if (r instanceof Error) throw r;
      return { ok: true, json: async () => r, text: async () => JSON.stringify(r) };
    },
  };
}

test('carregar transforma as linhas da Sheet no formato porRegistro que o Consolidado le', async () => {
  const d = fetchDuble([{ linhas: [
    { chaveMatriz: 'SUP-1||SP', volume: 10, financeiro: 20, equipe: 2, produtividadeMedia: 5,
      autor: 'ana', congeladoEm: '2026-08-28T22:00:00Z' },
  ] }]);
  const cliente = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: d.fetch, token: 'tok' });
  const congelado = await cliente.carregar('2026-08-31');
  assert.equal(congelado.porRegistro['SUP-1||SP'].volume.tendencia, 10);
  assert.equal(congelado.porRegistro['SUP-1||SP'].produtividadeMedia.tendencia, 5);
  assert.equal(congelado.autor, 'ana');
  assert.match(d.chamadas[0].url, /token=tok/);
  assert.match(d.chamadas[0].url, /semana=2026-08-31/);
});

test('carregar devolve null quando a semana nao tem congelado', async () => {
  const d = fetchDuble([{ linhas: [] }]);
  const cliente = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: d.fetch, token: 'tok' });
  assert.equal(await cliente.carregar('2026-08-31'), null);
});

test('carregar devolve null (nao lanca) quando a rede falha ou o token e recusado', async () => {
  const cliente1 = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: fetchDuble([new Error('offline')]).fetch, token: 'tok' });
  assert.equal(await cliente1.carregar('2026-08-31'), null);
  const cliente2 = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: fetchDuble([{ erro: 'token' }]).fetch, token: 'ruim' });
  assert.equal(await cliente2.carregar('2026-08-31'), null);
});

test('congelar devolve motivo ja-congelada com autor e data, sem lancar', async () => {
  const d = fetchDuble([{ erro: 'ja-congelada', autor: 'ana', congeladoEm: '2026-08-28T22:00:00Z' }]);
  const cliente = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: d.fetch, token: 'tok' });
  const r = await cliente.congelar({ chaveSegunda: '2026-08-31', linhas: [] }, 'bruno');
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'ja-congelada');
  assert.equal(r.autor, 'ana');
});

test('congelar manda token, autor e as linhas no corpo', async () => {
  const d = fetchDuble([{ ok: true, gravadas: 2 }]);
  const cliente = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: d.fetch, token: 'tok' });
  const r = await cliente.congelar({ chaveSegunda: '2026-08-31', linhas: [{ chave: '2026-08-31' }, { chave: '2026-09-01' }] }, 'bruno');
  assert.equal(r.ok, true);
  const corpo = JSON.parse(d.chamadas[0].opcoes.body);
  assert.equal(corpo.token, 'tok');
  assert.equal(corpo.autor, 'bruno');
  assert.equal(corpo.linhas.length, 2);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/semanal-congelamento-sheet.test.js`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `tools/semanal/congelamento-sheet.js`**

```javascript
'use strict';

// Cliente do Apps Script do congelamento. Espelha o papel de
// alocacao-sheet.js, com duas diferenças: manda um token derivado da senha em
// toda chamada, e NUNCA tem modo local -- congelar é um ato compartilhado, uma
// cópia em localStorage só enganaria quem clicasse.
//
// Toda falha de leitura vira null. O Consolidado trata null como "sem
// congelado" e cai no recálculo com rótulo "recalculada" -- degradar é sempre
// melhor que quebrar a página.
function criarClienteCongelamento(opcoes) {
  var o = opcoes || {};
  var url = String(o.url || '');
  var buscar = o.fetch;
  var token = String(o.token || '');

  function porRegistroDasLinhas(linhas) {
    var porRegistro = {};
    linhas.forEach(function (linha) {
      porRegistro[linha.chaveMatriz] = {
        volume: { tendencia: linha.volume },
        financeiro: { tendencia: linha.financeiro },
        equipe: { tendencia: linha.equipe },
        produtividadeMedia: { tendencia: linha.produtividadeMedia },
      };
    });
    return porRegistro;
  }

  return {
    carregar: async function (chaveSemana) {
      if (!url || !buscar) return null;
      try {
        var resposta = await buscar(url + '?semana=' + encodeURIComponent(chaveSemana) + '&token=' + encodeURIComponent(token));
        var corpo = await resposta.json();
        if (!corpo || corpo.erro || !corpo.linhas || !corpo.linhas.length) return null;
        return {
          porRegistro: porRegistroDasLinhas(corpo.linhas),
          autor: corpo.linhas[0].autor || '',
          congeladoEm: corpo.linhas[0].congeladoEm || '',
        };
      } catch (err) {
        return null;
      }
    },

    congelar: async function (snapshot, autor) {
      if (!url || !buscar) return { ok: false, motivo: 'rede' };
      try {
        var resposta = await buscar(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            token: token, chaveSegunda: snapshot.chaveSegunda, autor: autor || 'dashboard',
            congeladoEm: new Date().toISOString(), linhas: snapshot.linhas,
          }),
        });
        var corpo = await resposta.json();
        if (corpo && corpo.ok) return { ok: true };
        return { ok: false, motivo: (corpo && corpo.erro) || 'rede', autor: corpo && corpo.autor, congeladoEm: corpo && corpo.congeladoEm };
      } catch (err) {
        return { ok: false, motivo: 'rede' };
      }
    },
  };
}

module.exports = { criarClienteCongelamento };
```

Nota: `Content-Type: text/plain` é deliberado — é o que evita o preflight CORS que o Apps Script não responde. Mesmo motivo pelo qual `alocacao-sheet.js` faz igual.

- [ ] **Step 4: Rodar e confirmar os 5 testes passando**

Run: `node --test test/semanal-congelamento-sheet.test.js`
Expected: PASS (5)

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/congelamento-sheet.js test/semanal-congelamento-sheet.test.js
git commit -m "feat: cliente do Apps Script de congelamento (carregar/congelar, degrada pra null)"
```

---

## Task 5: Token derivado da senha em `render-shell.js`

**Files:**
- Modify: `tools/comum/render-shell.js`
- Test: `test/comum-render-shell.test.js` (crie se não existir; confira antes com `ls test/ | grep -i shell`)

**Interfaces:**
- Consumes: `crypto.subtle` do navegador (já usado ali para PBKDF2/AES).
- Produces: `window.__TOKEN_SHEET__` — hex de SHA-256 de `SAL_TOKEN + senha`, definido dentro de `tentarDesbloquear` logo após a decifragem bem-sucedida. Consumido pela Task 8.

- [ ] **Step 1: Localizar `tentarDesbloquear` e o ponto pós-decifragem**

Levantamento, não teste. Em `tools/comum/render-shell.js`, `tentarDesbloquear` tem a senha na variável local `senha` e some com ela ao terminar. O token tem de ser derivado logo após `decifrarComSenha` resolver (portanto senha correta), antes de `montarDashboard`.

- [ ] **Step 2: Escrever o teste da derivação**

O código de cliente vive dentro de template literal, então o teste extrai a função por regex e a executa — mesmo padrão que outros testes deste repositório usam para código de cliente. Confirme como os testes existentes fazem isso antes de escrever (`grep -rn "extrair\|new Function\|runInContext" test/*.js | head`).

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { scriptGateSenha } = require('../tools/comum/render-shell.js'); // confirme o nome real do export

// O token tem de ser derivado da senha de forma REPRODUZÍVEL: o Apps Script
// guarda o valor esperado nas Script Properties e compara por igualdade. Se a
// derivação mudar, o botão para de funcionar com "token recusado".
test('o token e SHA-256 de SAL + senha, em hex minusculo', async () => {
  const fonte = scriptGateSenha();
  const m = fonte.match(/var SAL_TOKEN = '([^']+)'/);
  assert.ok(m, 'SAL_TOKEN precisa existir como constante literal no script do cliente');
  const sal = m[1];
  const esperado = crypto.createHash('sha256').update(sal + 'senha-de-teste').digest('hex');
  // Prova o contrato: o valor que o Apps Script vai guardar é exatamente este.
  assert.match(esperado, /^[0-9a-f]{64}$/);
  assert.match(fonte, /__TOKEN_SHEET__/, 'o script tem de definir window.__TOKEN_SHEET__');
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test test/comum-render-shell.test.js`
Expected: FAIL — `SAL_TOKEN`/`__TOKEN_SHEET__` não existem.

- [ ] **Step 4: Implementar a derivação**

Em `tools/comum/render-shell.js`, dentro do template literal do script de cliente, acrescentar antes de `tentarDesbloquear`:

```javascript
// Sal fixo e PÚBLICO -- ele não esconde a senha, só impede que o token sirva
// em outro lugar. Quem já tem a senha deriva o token de qualquer jeito; quem
// não tem esbarra no PBKDF2 do blob antes. O que faz a comparação valer é o
// valor esperado morar no servidor (Script Properties do Apps Script).
var SAL_TOKEN = 'congelamento-semanal:v1:';

async function derivarTokenSheet(senha) {
  var bytes = new TextEncoder().encode(SAL_TOKEN + senha);
  var hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.prototype.map.call(new Uint8Array(hash), function (b) {
    return ('0' + b.toString(16)).slice(-2);
  }).join('');
}
```

E em `tentarDesbloquear`, logo depois de `var jsonTexto = await decifrarComSenha(...)` (ou seja, senha já provada correta) e antes de `montarDashboard`:

```javascript
    window.__TOKEN_SHEET__ = await derivarTokenSheet(senha);
```

- [ ] **Step 5: Rodar e confirmar passando**

Run: `node --test test/comum-render-shell.test.js`
Expected: PASS

- [ ] **Step 6: Rodar a suíte inteira — `render-shell.js` é COMPARTILHADO com o dashboard de orçamento**

Run: `node --test test/*.test.js`
Expected: nenhuma regressão nova. Há testes golden que comparam o HTML construído byte a byte; se algum quebrar por causa desta linha a mais, **regenere o golden de propósito** e confirme no diff que só as linhas novas mudaram — nunca ajuste o teste para "passar" sem olhar.

- [ ] **Step 7: Commit**

```bash
git add tools/comum/render-shell.js test/comum-render-shell.test.js
git commit -m "feat: retem token derivado da senha (window.__TOKEN_SHEET__) apos o desbloqueio"
```

---

## Task 6: Totais lendo o snapshot

**Files:**
- Modify: `tools/semanal/render-aba-consolidado.js`
- Modify: `tools/semanal/compute-relatorio-semanal.js`
- Test: `test/semanal-render-aba-consolidado.test.js`

**Interfaces:**
- Consumes: `ctx.congeladoPorSemana.porRegistro` (formato do Task 4); `chaveMatriz`.
- Produces: `somarTendenciaCongelada(registros, indices, porRegistro, dimensao)` → `number|null`, exportada de `render-aba-consolidado.js`. Usada nos dois caminhos de linha e pelo `serieDaSemana` via `ctx.tendenciaExterna`.

- [ ] **Step 1: Escrever o teste dos agregados**

```javascript
test('TOTAL GERAL e TOTAL do SUP somam a tendencia congelada dos registros, nao recalculam', () => {
  const chaveSemana = formatarChaveSemana(SEMANAS[2].inicio);
  const c1 = chaveMatriz(REGISTROS_A[0].sup, REGISTROS_A[0].tipologia);
  const c2 = chaveMatriz(REGISTROS_A[1].sup, REGISTROS_A[1].tipologia);
  const congeladoSemanal = { [chaveSemana]: { porRegistro: {
    [c1]: { volume: { tendencia: 10 }, equipe: { tendencia: 2 }, produtividadeMedia: { tendencia: 5 } },
    [c2]: { volume: { tendencia: 30 }, equipe: { tendencia: 3 }, produtividadeMedia: { tendencia: 10 } },
  } } };
  const html = renderAbaConsolidado(REGISTROS_A, [0, 1], opcoes({
    semanaIdx: 2, demandas: demandasEspalhadas(), hojeEpoch: diaJul(15), congeladoSemanal,
  }));
  const totalGeral = celulasDe(linhasDe(html).filter((l) => l.indexOf('linha-total-geral') !== -1)[0]);
  // "Semana total" do bloco Equipe: 2 + 3 = 5, somado do snapshot.
  assert.ok(html.indexOf('>5<') !== -1 || totalGeral.join('|').indexOf('5') !== -1);
});

test('produtividadeMedia agregada e Soma(volume)/Soma(equipe), nao a soma das produtividades', () => {
  // c1: volume 10, equipe 2 (prod 5). c2: volume 30, equipe 3 (prod 10).
  // Somar as produtividades daria 15 -- ERRADO. O certo e 40/5 = 8.
  const chaveSemana = formatarChaveSemana(SEMANAS[2].inicio);
  const c1 = chaveMatriz(REGISTROS_A[0].sup, REGISTROS_A[0].tipologia);
  const c2 = chaveMatriz(REGISTROS_A[1].sup, REGISTROS_A[1].tipologia);
  const congeladoSemanal = { [chaveSemana]: { porRegistro: {
    [c1]: { volume: { tendencia: 10 }, equipe: { tendencia: 2 }, produtividadeMedia: { tendencia: 5 } },
    [c2]: { volume: { tendencia: 30 }, equipe: { tendencia: 3 }, produtividadeMedia: { tendencia: 10 } },
  } } };
  const html = renderAbaConsolidado(REGISTROS_A, [0, 1], opcoes({
    semanaIdx: 2, demandas: demandasEspalhadas(), hojeEpoch: diaJul(15), congeladoSemanal,
  }));
  assert.ok(html.indexOf('15,00') === -1, 'nao pode somar produtividades');
  assert.ok(html.indexOf('8,00') !== -1, 'produtividade agregada tem de ser 40/5 = 8,00');
});

test('agregado devolve sem-dado quando NENHUM registro do grupo tem congelado', () => {
  const html = renderAbaConsolidado(REGISTROS_A, [0, 1], opcoes({
    semanaIdx: 2, demandas: demandasEspalhadas(), hojeEpoch: diaJul(15), congeladoSemanal: {},
  }));
  assert.match(html, /sem-dado/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/semanal-render-aba-consolidado.test.js`
Expected: FAIL — hoje agregados caem no recálculo (tabela principal) ou ficam em branco (blocos novos).

- [ ] **Step 3: Implementar `somarTendenciaCongelada` e ligar nos dois caminhos**

Em `tools/semanal/render-aba-consolidado.js`:

```javascript
// Soma a tendência congelada dos registros de um grupo. O spec pede que os
// totais sejam SOMADOS do snapshot por registro, não recalculados -- senão a
// linha de TOTAL sai de uma âncora diferente das linhas acima dela e não fecha
// na soma delas.
//
// produtividadeMedia NÃO se soma: ela é uma razão. Agrega como
// Soma(volume)/Soma(equipe), do mesmo snapshot.
//
// Devolve null quando NENHUM registro do grupo tem entrada -- distinto de zero.
function somarTendenciaCongelada(registros, indices, porRegistro, dimensao) {
  if (!porRegistro) return null;
  if (dimensao === 'produtividadeMedia') {
    var somaVolume = somarTendenciaCongelada(registros, indices, porRegistro, 'volume');
    var somaEquipe = somarTendenciaCongelada(registros, indices, porRegistro, 'equipe');
    if (somaVolume === null || !somaEquipe) return null;
    return somaVolume / somaEquipe;
  }
  var soma = null;
  indices.forEach(function (idx) {
    var registro = registros[idx];
    if (!registro) return;
    var entrada = porRegistro[chaveMatriz(registro.sup, registro.tipologia)];
    if (!entrada || !entrada[dimensao]) return;
    var v = entrada[dimensao].tendencia;
    if (v === null || v === undefined) return;
    soma = (soma === null ? 0 : soma) + v;
  });
  return soma;
}
```

Em `tendenciaExternaDoCtx`, trocar o fechamento para receber os índices do grupo em vez de só a chave. Como `serieDaSemana` chama `ctx.tendenciaExterna(chave)` com uma chave só, a forma mais direta é o Consolidado calcular a tendência do grupo ANTES e passar uma função constante:

```javascript
function tendenciaExternaDoCtx(ctx, registros, indices) {
  if (!ctx.congeladoPorSemana || !ctx.congeladoPorSemana.porRegistro) return undefined;
  var valor = somarTendenciaCongelada(registros, indices, ctx.congeladoPorSemana.porRegistro, ctx.dimensaoSnapshot);
  if (valor === null) return undefined; // sem congelado -> serieDaSemana recalcula
  return function () { return valor; };
}
```

Ajustar a chamada em `renderLinhaResumo` para `tendenciaExterna: tendenciaExternaDoCtx(ctx, registros, indices)`.

Em `compute-relatorio-semanal.js`, `serieDaSemana` hoje só consulta `ctx.tendenciaExterna` quando `indices.length === 1`. Remover essa guarda — a decisão de agregar agora é do chamador, que já somou:

```javascript
  var tendenciaCongelada;
  if (typeof ctx.tendenciaExterna === 'function') {
    var chave = ctx.chaveDoRegistro && indices.length === 1
      ? ctx.chaveDoRegistro(registros[indices[0]]) : null;
    var externa = ctx.tendenciaExterna(chave);
    if (externa !== undefined && externa !== null) tendenciaCongelada = externa;
  }
```

Em `renderLinhaResumoGenerica`, trocar o bloco que exige `indices.length === 1` por:

```javascript
  var tendenciaCheia = congeladoPorSemana && congeladoPorSemana.porRegistro
    ? somarTendenciaCongelada(registros, indices, congeladoPorSemana.porRegistro, chaveDimensaoSnapshot)
    : null;
```

Acrescentar `somarTendenciaCongelada` ao `module.exports`.

- [ ] **Step 4: Rodar e confirmar**

Run: `node --test test/semanal-render-aba-consolidado.test.js`
Expected: PASS (todos). Testes antigos que assumiam agregado em branco precisam ser atualizados — preserve a intenção de cada um.

- [ ] **Step 5: Rodar o wireup, que exercita o Consolidado no bundle**

Run: `node --test test/semanal-render-semanal-wireup.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/render-aba-consolidado.js tools/semanal/compute-relatorio-semanal.js test/semanal-render-aba-consolidado.test.js
git commit -m "feat: linhas de TOTAL somam a tendencia congelada do snapshot"
```

---

## Task 7: Rótulo honesto no cabeçalho

**Files:**
- Modify: `tools/semanal/render-aba-consolidado.js`
- Test: `test/semanal-render-aba-consolidado.test.js`

**Interfaces:**
- Consumes: `somarTendenciaCongelada` (Task 6).
- Produces: nenhuma nova; muda o HTML do `<thead>`.

- [ ] **Step 1: Escrever o teste**

```javascript
test('o rotulo "congelada" acende na coluna do Desvio, nao na do Previsto', () => {
  const chaveSemana = formatarChaveSemana(SEMANAS[2].inicio);
  const c1 = chaveMatriz(REGISTROS_A[0].sup, REGISTROS_A[0].tipologia);
  const congeladoSemanal = { [chaveSemana]: { porRegistro: { [c1]: { volume: { tendencia: 99 } } } } };
  const html = renderAbaConsolidado(REGISTROS_A, [0], opcoes({
    semanaIdx: 2, demandas: demandasEspalhadas(), hojeEpoch: diaJul(15), congeladoSemanal,
  }));
  const cabecalho = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
  const ths = cabecalho.split('<th').map((t) => t.replace(/<[^>]*>/g, ''));
  const thPrevisto = ths.find((t) => t.indexOf('Previsto até a data') !== -1) || '';
  const thDesvio = ths.find((t) => t.indexOf('Desvio até a data') !== -1) || '';
  assert.ok(thPrevisto.indexOf('congelada') === -1, 'Previsto nunca congela -- o rotulo nao pode ficar nele');
  assert.ok(thDesvio.indexOf('congelada') !== -1, 'o rotulo pertence a coluna que consome o valor congelado');
});

test('sem NENHUMA linha visivel usando o congelado, o rotulo diz "recalculada"', () => {
  const html = renderAbaConsolidado(REGISTROS_A, [0], opcoes({
    semanaIdx: 2, demandas: demandasEspalhadas(), hojeEpoch: diaJul(15), congeladoSemanal: {},
  }));
  assert.match(html, /recalculada/);
  assert.ok(html.indexOf('(congelada)') === -1);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/semanal-render-aba-consolidado.test.js`
Expected: FAIL — hoje o rótulo está no `<th>` de Previsto e liga só por existir snapshot.

- [ ] **Step 3: Implementar**

Em `renderAbaConsolidado`, calcular se ALGUMA linha visível usou o congelado — o conjunto de índices visíveis já está disponível ali:

```javascript
  // O rótulo só é honesto se alguma linha realmente consumiu o congelado.
  // Antes ele acendia por o snapshot EXISTIR, mesmo numa semana em que nenhuma
  // linha visível o usava.
  var usouCongelado = !!(congeladoPorSemana && congeladoPorSemana.porRegistro
    && somarTendenciaCongelada(registros, indices, congeladoPorSemana.porRegistro, dimensaoSnapshot) !== null);
```

Em `renderCabecalho`, mover o sufixo do `<th>` de "Previsto até a data" para o de "Desvio até a data":

```javascript
function renderCabecalho(semana, usouCongelado) {
  var sufixoSemana = semana ? ' (' + formatarIntervaloSemana(semana.inicio, semana.fim) + ')' : '';
  var rotulo = usouCongelado ? ' (congelada)' : ' (recalculada)';
  return '<thead><tr>'
    + '<th>SUP</th><th>Grupo</th><th>Tomador</th><th>Tipologia</th>'
    + '<th class="num">' + escapeHtml('Previsto até a data' + sufixoSemana) + '</th>'
    + '<th class="num">Realizado</th>'
    + '<th class="num">' + escapeHtml('Desvio até a data' + rotulo) + '</th>'
    + '<th class="num">Semana total</th>'
    + '</tr></thead>';
}
```

Ajustar o chamador. O parâmetro `dimensao`, que já não era usado, sai.

- [ ] **Step 4: Rodar e confirmar**

Run: `node --test test/semanal-render-aba-consolidado.test.js`
Expected: PASS (todos)

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/render-aba-consolidado.js test/semanal-render-aba-consolidado.test.js
git commit -m "fix: rotulo congelada/recalculada vai pra coluna do Desvio e so acende quando foi usado"
```

---

## Task 8: O botão e o carregamento assíncrono do congelado

**Files:**
- Modify: `tools/semanal/render-semanal.js`
- Test: `test/semanal-render-semanal-wireup.test.js`

**Interfaces:**
- Consumes: `criarClienteCongelamento` (Task 4); `proximaSegunda`, `calcularSnapshotSemanaAlvo` (Tasks 1-2); `window.__TOKEN_SHEET__` (Task 5); `formatarChaveSemana` (`render-aba-consolidado.js`).
- Produces: `URL_CONGELAMENTO` (constante, começa como `'PENDENTE-congelamento'` até o Apps Script ser implantado); botão `#btn-congelar-semana`; `#status-congelamento`. `montarAbaConsolidado` passa a receber `congeladoSemanal` do estado carregado.

- [ ] **Step 1: Escrever o teste de wireup**

Leia primeiro como `test/semanal-render-semanal-wireup.test.js` monta o sandbox e como os testes da Alocação exercitam `URL_ALOCACAO` pendente. Depois:

```javascript
test('o botao de congelar diz QUAL semana vai congelar e nasce desabilitado ate a Sheet responder', () => {
  const html = /* montar o HTML da aba Consolidado pelo caminho que o arquivo ja usa */;
  assert.match(html, /btn-congelar-semana/);
  assert.match(html, /Verificando/); // estado inicial
});

test('com URL PENDENTE o botao aparece desabilitado e explica, sem quebrar a aba', () => {
  // Mesmo caminho degradado que RE_URL_ALOCACAO_PENDENTE ja cobre pra Alocacao.
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/semanal-render-semanal-wireup.test.js`
Expected: FAIL — o botão não existe.

- [ ] **Step 3: Implementar o botão e o ciclo de vida**

Em `tools/semanal/render-semanal.js`, dentro de `SCRIPT_CLIENTE_SEMANAL` (**cuidado com crases — ver Global Constraints**):

```javascript
var URL_CONGELAMENTO = 'PENDENTE-congelamento';
var ESTADO_CONGELAMENTO = { congelado: null, carregando: false };

function clienteCongelamento() {
  return criarClienteCongelamento({
    url: URL_CONGELAMENTO, fetch: window.fetch.bind(window),
    token: window.__TOKEN_SHEET__ || '',
  });
}

function urlCongelamentoPendente() { return /^PENDENTE-/.test(URL_CONGELAMENTO); }

// Busca o congelado da semana EM TELA e redesenha. Chamado ao montar a aba e a
// cada troca de semana. Falha vira null -> a aba cai no recalculo, com rotulo
// "recalculada". Nunca quebra a pagina.
async function carregarCongeladoDaSemana(chaveSemana) {
  if (urlCongelamentoPendente()) return null;
  var congelado = await clienteCongelamento().carregar(chaveSemana);
  ESTADO_CONGELAMENTO.congelado = congelado;
  return congelado;
}

async function atualizarBotaoCongelar() {
  var botao = document.getElementById('btn-congelar-semana');
  var status = document.getElementById('status-congelamento');
  if (!botao) return;
  var hoje = diaEpochDeHoje();
  var chaveAlvo = proximaSegunda(hoje);
  botao.textContent = 'Congelar semana de ' + formatarDiaCurto(chaveAlvo);
  if (urlCongelamentoPendente()) {
    botao.disabled = true;
    status.textContent = 'Congelamento ainda não configurado nesta planilha.';
    return;
  }
  botao.disabled = true;
  status.textContent = 'Verificando…';
  var existente = await clienteCongelamento().carregar(chaveAlvo);
  if (existente) {
    botao.disabled = true;
    status.textContent = 'Semana de ' + formatarDiaCurto(chaveAlvo) + ' congelada em '
      + formatarDataHora(existente.congeladoEm) + ', por ' + (existente.autor || 'desconhecido') + '.';
  } else {
    botao.disabled = false;
    status.textContent = '';
  }
}

async function congelarProximaSemana() {
  var botao = document.getElementById('btn-congelar-semana');
  var status = document.getElementById('status-congelamento');
  botao.disabled = true;
  status.textContent = 'Congelando…';
  try {
    var hoje = diaEpochDeHoje();
    var chaveAlvo = proximaSegunda(hoje);
    var snapshot = calcularSnapshotSemanaAlvo(window.__REGISTROS__, window.__DEMANDAS__, hoje, chaveAlvo);
    var r = await clienteCongelamento().congelar(snapshot, window.__DASHBOARD_AUTOR__ || 'dashboard');
    if (r.ok) {
      status.textContent = 'Semana de ' + formatarDiaCurto(chaveAlvo) + ' congelada agora.';
      return;
    }
    if (r.motivo === 'ja-congelada') {
      status.textContent = 'Esta semana já foi congelada em ' + formatarDataHora(r.congeladoEm)
        + ', por ' + (r.autor || 'desconhecido') + '. Para refazer, apague as linhas na planilha.';
      return;
    }
    status.textContent = r.motivo === 'token'
      ? 'Acesso recusado pela planilha (token). Confira o token nas Script Properties.'
      : 'Não foi possível congelar (rede ou planilha fora do ar). Tente de novo.';
    botao.disabled = false;
  } catch (err) {
    status.textContent = 'Erro ao congelar: ' + err.message;
    botao.disabled = false;
  }
}
```

No markup da aba Consolidado, perto do seletor de semana:

```javascript
'<button id="btn-congelar-semana" class="btn-secundario" disabled>Verificando…</button>'
+ '<span id="status-congelamento" class="nota-inline"></span>'
```

Ligar o `click` em `congelarProximaSemana`, chamar `atualizarBotaoCongelar()` ao montar a aba, e `carregarCongeladoDaSemana(formatarChaveSemana(semanaEscolhida.inicio))` seguido de redesenho ao montar e a cada troca de semana.

- [ ] **Step 4: Garantir os módulos novos no bundle**

`tools/semanal/congelamento-sheet.js` e `tools/semanal/congelar-tendencia-semanal.js` precisam entrar em `BUNDLE_ARQUIVOS`, em ordem de dependência (ambos antes de quem os usa). **Não** adicionar em `BUNDLE_ARQUIVOS_ALOCACAO` — a página de Alocação não congela nada.

Run: `node --test test/semanal-bundle-sem-ciclos.test.js`
Expected: PASS — o guard de ciclos e de ordem tem de continuar verde.

- [ ] **Step 5: Rodar os testes**

Run: `node --test test/semanal-render-semanal-wireup.test.js test/semanal-bundle-sem-ciclos.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/render-semanal.js test/semanal-render-semanal-wireup.test.js
git commit -m "feat: botao Congelar proxima semana no Consolidado, com estados e carga assincrona"
```

---

## Task 9: Aposentar o CLI, o JSON no git e `window.__CONGELADO_SEMANAL__`

**Files:**
- Modify: `tools/semanal/congelar-tendencia-semanal.js`
- Modify: `tools/semanal/build-dashboard.js`
- Modify: `tools/semanal/render-semanal.js`
- Modify: `test/semanal-congelar-tendencia.test.js`, `test/semanal-build-dashboard.test.js`
- Delete: `tools/semanal/congelar-semanal.ps1` (se existir como untracked)

**Interfaces:**
- Consumes: nada novo.
- Produces: remove `main`, `gravarSnapshotNoArquivo`, `descartarEscritaNaoCommitada`, `chaveSemanaSeguinteDeSexta`, `lerCongeladoSemanal`, `window.__CONGELADO_SEMANAL__`.

- [ ] **Step 1: Remover a casca de CLI de `congelar-tendencia-semanal.js`**

Apagar: `main`, `git`, `lerHeartbeatDoOrigin`, `precisaRodarHoje`, `gravarSnapshotNoArquivo`, `descartarEscritaNaoCommitada`, `chaveSemanaSeguinteDeSexta`, o bloco `if (require.main === module)`, os `require` de `node:fs`/`node:path`/`node:child_process`/`coordenacao-volume.js`, e as constantes de caminho/heartbeat. **Manter** `proximaSegunda`, `formatarDiaIso`, `fragmentosDaSemanaAlvo`, `tendenciaDoFragmento`, `calcularSnapshotSemanaAlvo`.

Atualizar o comentário do topo do arquivo: ele descreve um job agendado que não existe mais.

O `module.exports` final:

```javascript
module.exports = { proximaSegunda, formatarDiaIso, fragmentosDaSemanaAlvo, calcularSnapshotSemanaAlvo };
```

- [ ] **Step 2: Apagar os testes do que saiu**

Em `test/semanal-congelar-tendencia.test.js`, remover os testes de `gravarSnapshotNoArquivo`, `descartarEscritaNaoCommitada` e `chaveSemanaSeguinteDeSexta`. **Não** remover os das funções que ficaram.

- [ ] **Step 3: Remover a leitura do JSON no build**

Em `tools/semanal/build-dashboard.js`: apagar `CAMINHO_CONGELADO_SEMANAL`, `lerCongeladoSemanal` e o export dela. Em `tools/semanal/render-semanal.js`: apagar a emissão de `window.__CONGELADO_SEMANAL__` e o `congeladoSemanal:` que vinha dele para `montarAbaConsolidado` (o valor agora vem de `ESTADO_CONGELAMENTO`, Task 8).

Em `test/semanal-build-dashboard.test.js`: apagar os dois testes de embed do snapshot e os helpers `comSnapshot`/`comSnapshotSync` — eles escreviam e apagavam `docs/tendencia-congelada-semanal.json` de verdade, na pasta que o Pages serve.

- [ ] **Step 4: Apagar o `.ps1`**

```bash
rm -f tools/semanal/congelar-semanal.ps1
```

- [ ] **Step 5: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: nenhuma falha nova. A falha pré-existente de `semanal-demandas-planilha-real.test.js` (colunas `Latitude`/`Longitude` no CSV real) continua — é conhecida e não tem relação.

- [ ] **Step 6: Commit**

```bash
git add -u tools/semanal test/
git commit -m "refactor: aposenta o CLI de congelamento, o JSON no git e o global assado no HTML"
```

---

## Task 10: Documentação e implantação

**Files:**
- Modify: `CLAUDE.md`
- Create: `docs/implantar-apps-script-congelamento.md`

**Interfaces:** nenhuma — documentação.

- [ ] **Step 1: Escrever o passo a passo de implantação**

`docs/implantar-apps-script-congelamento.md` cobrindo: criar a Sheet e a aba `Congelamento`; colar `tools/semanal/apps-script-congelamento.gs`; definir a Script Property `TOKEN_DASHBOARD` com o SHA-256 hex de `congelamento-semanal:v1:` + a senha do dashboard (com o comando para calcular: `node -e "console.log(require('node:crypto').createHash('sha256').update('congelamento-semanal:v1:'+process.argv[1]).digest('hex'))" '<senha>'`); implantar como Web App com acesso "qualquer pessoa"; copiar a URL para `URL_CONGELAMENTO` em `render-semanal.js`.

Incluir o aviso: **reimplantar mantendo a MESMA URL** é Implantar > Gerenciar implantações > lápis > Versão: Nova versão. Uma "Nova implantação" troca a URL e exige mexer no código de novo.

- [ ] **Step 2: Seção nova no `CLAUDE.md`**

No estilo das outras seções datadas da página Planejamento Semanal: o congelamento agora é por botão, a Sheet é a origem única, o token deriva da senha, o reclique é recusado, a semana que cruza mês grava dois fragmentos, e os totais somam do snapshot. **Registrar junto da senha** que rotacionar `ORCAMENTO_SENHA` exige atualizar `TOKEN_DASHBOARD` nas Script Properties — senão o congelamento para com "token recusado" enquanto o resto da página segue funcionando.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/implantar-apps-script-congelamento.md
git commit -m "docs: implantacao do Apps Script de congelamento e a regra do token vs rotacao de senha"
```

---

## Task 11: Reconstruir e publicar

**Files:**
- Modify: `dist/planejamento-semanal.html`, `docs/planejamento-semanal.html`, `dist/alocacao-equipes.html`, `docs/alocacao-equipes.html`

**Interfaces:** nenhuma — publicação.

- [ ] **Step 1: Suíte inteira**

Run: `node --test test/*.test.js`
Expected: só a falha pré-existente conhecida.

- [ ] **Step 2: Rebase antes de publicar**

```bash
git fetch origin master
git log --oneline HEAD..origin/master   # se houver commits, rebase
git rebase origin/master
```

`origin/master` tem uma segunda frente ativa (outra pessoa empurra dados no mesmo branch). Nos arquivos compartilhados o upstream ganha; **nunca** force push.

- [ ] **Step 3: Build**

```bash
ORCAMENTO_SENHA='<senha real>' node tools/semanal/build-dashboard.js
```

- [ ] **Step 4: Copiar para `docs/` — os dois, sempre juntos**

```bash
cp dist/planejamento-semanal.html docs/planejamento-semanal.html
cp dist/alocacao-equipes.html docs/alocacao-equipes.html
```

- [ ] **Step 5: Teste de sincronia**

Run: `node --test test/publicacao-docs-sincronizado.test.js`
Expected: PASS

- [ ] **Step 6: Commit e push**

```bash
git add dist/planejamento-semanal.html docs/planejamento-semanal.html dist/alocacao-equipes.html docs/alocacao-equipes.html
git commit -m "build: publica o botao de congelar a semana"
git push origin HEAD:master
```

- [ ] **Step 7: Verificar AO VIVO pelo conteúdo, não pelo status da API**

```bash
curl -s https://amcaccere261283.github.io/orcamento-dashboard/planejamento-semanal.html | tr -d '\r' | md5sum
tr -d '\r' < docs/planejamento-semanal.html | md5sum
```

Os dois hashes têm de bater. O build do Pages reporta "built" mesmo servindo conteúdo antigo — já aconteceu neste projeto.

---

## Self-Review

**Cobertura do spec:**
- Decisão 1 (próxima semana, `proximaSegunda` no lugar de `chaveSemanaSeguinteDeSexta`) → Tasks 1, 2, 8, 9.
- Decisão 2 (token derivado da senha) → Tasks 3, 4, 5, 10.
- Decisão 3 (reclique recusado) → Task 3 (servidor) + Task 8 (tela).
- Decisão 4 (origem única, CLI aposentado) → Task 9.
- Decisão 5 (clique em qualquer dia) → Task 1 (`proximaSegunda` cobre os sete dias) + Task 8 (sem trava de dia).
- Decisão 6 (totais) → Task 6.
- Fragmento de mês → Tasks 1, 2.
- Rótulo honesto → Task 7.
- Estados na tela / degradação → Task 8; leitura degradando para null → Task 4.
- Testes exigidos pelo spec → Tasks 1, 3, 4, 6, 7.
- "O que é aposentado" → Task 9.

**Placeholders:** o Step 1 do Task 8 deixa o corpo do HTML a montar como comentário porque o caminho exato depende de como `montarAbaConsolidado` monta o markup hoje — o implementador lê o arquivo primeiro. Não é lacuna de decisão; o comportamento exigido está escrito nos asserts.

**Consistência de tipos:** `chaveSegunda`/`chave` sempre `'YYYY-MM-DD'`; `linhas[]` sempre `{ chave, chaveMatriz, volume, financeiro, equipe, produtividadeMedia }` do Task 2 ao Task 4; `porRegistro[chaveMatriz][dimensao].tendencia` do Task 4 ao Task 6, com `dimensao` ∈ `volume|financeiro|equipe|produtividadeMedia` — o mesmo conjunto que o Apps Script grava em colunas.
