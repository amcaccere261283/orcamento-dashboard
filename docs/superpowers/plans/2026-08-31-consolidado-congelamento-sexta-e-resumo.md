# Consolidado: congelamento real às sextas 22h + resumo estilo relatório Excel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cada sexta-feira às 22h, gravar um snapshot persistido (não recalculável) da
Tendência da semana seguinte para Volume/Financeiro/Equipe/Produtividade média, e trocar a
tabela da aba Consolidado por um resumo (Previsto até a data / Realizado / Desvio até a
data / Semana total) que usa esse snapshot para as janelas ainda não encerradas.

**Architecture:** Um novo script Node (`congelar-tendencia-semanal.js`) roda nas 3 máquinas
já agendadas (mesmo padrão de corrida segura de `atualizar-diario-escalonado.js`) e grava
`docs/tendencia-congelada-semanal.json`. `build-dashboard.js` lê esse arquivo e embute os
dados no HTML (mesmo mecanismo de `window.__DEMANDAS_MENSAIS__`). `render-aba-consolidado.js`
ganha um novo formato de tabela que reaproveita `serieDaSemana` de
`compute-relatorio-semanal.js`, preferindo o snapshot quando ele existe para a semana em
tela e caindo no recálculo de hoje quando não existe.

**Tech Stack:** Node puro (sem dependências), o mesmo dual-módulo Node+navegador
(`var`/`function`, `module.exports`) usado no resto de `tools/semanal/`.

## Global Constraints

- Nenhuma dependência nova (`node --test`, sem `npm install`).
- Módulos que entram no bundle do navegador continuam em `var`/`function`, nunca `const`/
  `let`/arrow no top-level exportado, e sem `require()` de módulos fora do próprio diretório
  além do que o bundler já resolve (ver comentário no topo de `render-aba-consolidado.js`).
- Nenhuma crase solta dentro dos template literals `SCRIPT_CLIENTE_SEMANAL`/`CSS_SEMANAL`
  em `render-semanal.js` (trunca o script inteiro em silêncio — ver `CLAUDE.md`).
- `ORCAMENTO_SENHA` nunca em arquivo do repositório.
- `docs/planejamento-semanal.html` é sempre copiado de `dist/planejamento-semanal.html`
  antes de commitar (`test/publicacao-docs-sincronizado.test.js` trava isso byte a byte).
- Chave de registro sempre via `chaveMatriz(sup, tipologia)` (`tools/comum/linha-base.js`,
  `sup + '|' + tipologia`) — nunca montar a chave crua a mão.

---

## Task 1: Módulo puro do snapshot — `calcularSnapshotSemanaAlvo`

**Files:**
- Create: `tools/semanal/congelar-tendencia-semanal.js`
- Test: `test/semanal-congelar-tendencia.test.js`

**Interfaces:**
- Consumes: `calcularSeriesSemanaisDimensao` (`tools/semanal/render-aba-semanal.js`,
  assinatura `(registros, indices, dimensao, vigenteIdx, semanas, numSemanas,
  temSemanasReais, indiceAtual, demandas, hojeEpoch, mesAtualReal, opcoesInternas)`,
  campo de retorno usado aqui: `semanasTendenciaCompleta` — array por índice de semana);
  `chaveMatriz(sup, tipologia)` (`tools/comum/linha-base.js`); `semanasDoMes`,
  `indiceSemanaAtual` (`tools/semanal/compute-semanal.js`).
- Produces: `calcularSnapshotSemanaAlvo(registros, demandas, hojeEpoch)` → 
  `{ chaveSemanaAlvo: 'YYYY-MM-DD', geradoEmIso: string, porRegistro: { [chaveMatriz]:
  { volume: { tendencia: number|null }, financeiro: { tendencia: number|null },
  equipe: { tendencia: number|null }, produtividadeMedia: { tendencia: number|null } } } }`
  — usado pelo Task 2 (CLI) e pelo Task 5 (leitura no Consolidado, indiretamente via o
  JSON gravado).

- [ ] **Step 1: Escrever o teste da semana-alvo (a segunda seguinte à sexta corrente)**

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularSnapshotSemanaAlvo, chaveSemanaSeguinteDeSexta } = require('../tools/semanal/congelar-tendencia-semanal.js');

// Sexta 2026-09-04 -> a semana seguinte começa segunda 2026-09-07.
test('chaveSemanaSeguinteDeSexta acha a segunda seguinte à sexta em epoch de dias', () => {
  const sexta = Date.UTC(2026, 8, 4) / 86400000; // 2026-09-04, epoch de DIAS (UTC)
  const chave = chaveSemanaSeguinteDeSexta(sexta);
  assert.equal(chave, '2026-09-07');
});

test('chaveSemanaSeguinteDeSexta funciona também rodado num sábado/domingo (job atrasado)', () => {
  const sabado = Date.UTC(2026, 8, 5) / 86400000; // 2026-09-05
  assert.equal(chaveSemanaSeguinteDeSexta(sabado), '2026-09-07');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/semanal-congelar-tendencia.test.js`
Expected: FAIL — `congelar-tendencia-semanal.js` não existe ainda.

- [ ] **Step 3: Implementar `chaveSemanaSeguinteDeSexta`**

```javascript
'use strict';
const { chaveMatriz } = require('../comum/linha-base.js');
const { semanasDoMes, indiceSemanaAtual } = require('./compute-semanal.js');
const { calcularSeriesSemanaisDimensao } = require('./render-aba-semanal.js');

// diaEpoch (dias desde a época Unix, UTC) -> 'YYYY-MM-DD' da SEGUNDA da
// semana seguinte à sexta em que o job roda. Não assume que 'agoraEpoch' É
// uma sexta -- o job pode disparar atrasado (feriado no Task Scheduler,
// máquina desligada) num sábado/domingo, e ainda assim tem de mirar a MESMA
// segunda que a sexta daquela semana mirava, não a segunda seguinte a ele.
function chaveSemanaSeguinteDeSexta(agoraEpoch) {
  var data = new Date(agoraEpoch * 86400000);
  var diaSemana = data.getUTCDay(); // 0=domingo .. 6=sábado
  // Sexta é 5. Quantos dias faltam da SEXTA DESTA SEMANA (a mais recente,
  // <= agora) até a segunda seguinte a ela: sexta+3, sábado+2, domingo+1,
  // segunda..quinta conta pra trás até a sexta anterior e soma os mesmos 3.
  var diasDesdeSexta = (diaSemana + 2) % 7; // sexta=0, sábado=1, domingo=2, segunda=3, ...
  var epochSextaDestaSemana = agoraEpoch - diasDesdeSexta;
  var epochSegundaSeguinte = epochSextaDestaSemana + 3;
  var d = new Date(epochSegundaSeguinte * 86400000);
  var ano = d.getUTCFullYear();
  var mes = String(d.getUTCMonth() + 1).padStart(2, '0');
  var dia = String(d.getUTCDate()).padStart(2, '0');
  return ano + '-' + mes + '-' + dia;
}

module.exports = { chaveSemanaSeguinteDeSexta };
```

- [ ] **Step 4: Rodar de novo e confirmar os 2 testes passando**

Run: `node --test test/semanal-congelar-tendencia.test.js`
Expected: PASS (2 testes)

- [ ] **Step 5: Escrever o teste de `calcularSnapshotSemanaAlvo` com fixture sintética**

```javascript
test('calcularSnapshotSemanaAlvo grava tendencia de volume/financeiro/equipe/produtividade por registro', () => {
  const registros = [
    {
      sup: 'SUP-1', tipologia: 'SP', tomador: 'X',
      previsto: { volume: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100] },
      total: { equipes: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2] },
    },
  ];
  const demandas = { porRegistroEventos: {} };
  // 2026-09-04 (sexta) em epoch de dias -- mesma conta do Task 1, Step 1.
  const hojeEpoch = Date.UTC(2026, 8, 4) / 86400000;
  const snapshot = calcularSnapshotSemanaAlvo(registros, demandas, hojeEpoch);

  assert.equal(snapshot.chaveSemanaAlvo, '2026-09-07');
  const entrada = snapshot.porRegistro['SUP-1|SP'];
  assert.ok(entrada, 'registro SUP-1|SP presente no snapshot');
  assert.equal(typeof entrada.volume.tendencia, 'number');
  assert.equal(typeof entrada.equipe.tendencia, 'number');
  // produtividadeMedia = tendencia.volume / tendencia.equipe quando os dois existem.
  assert.equal(entrada.produtividadeMedia.tendencia, entrada.volume.tendencia / entrada.equipe.tendencia);
});

test('calcularSnapshotSemanaAlvo devolve produtividadeMedia null quando equipe é 0/nula', () => {
  const registros = [
    {
      sup: 'SUP-2', tipologia: 'ST', tomador: 'Y',
      previsto: { volume: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50] },
      total: { equipes: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    },
  ];
  const demandas = { porRegistroEventos: {} };
  const hojeEpoch = Date.UTC(2026, 8, 4) / 86400000;
  const snapshot = calcularSnapshotSemanaAlvo(registros, demandas, hojeEpoch);
  assert.equal(snapshot.porRegistro['SUP-2|ST'].produtividadeMedia.tendencia, null);
});
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `node --test test/semanal-congelar-tendencia.test.js`
Expected: FAIL — `calcularSnapshotSemanaAlvo` não exportada ainda.

- [ ] **Step 7: Implementar `calcularSnapshotSemanaAlvo`**

Acrescentar em `congelar-tendencia-semanal.js` (mesmo arquivo do Step 3), depois de
`chaveSemanaSeguinteDeSexta`:

```javascript
// Acha o mesIdx (0-11) e o índice da semana-alvo dentro do mês dela, a
// partir da chave 'YYYY-MM-DD' já calculada -- reconstrói via semanasDoMes
// porque é a MESMA função que o resto do projeto usa pra cortar semanas
// reais (segunda a domingo, nunca cruzando mês), evitando uma segunda
// implementação de calendário que poderia divergir da primeira.
function localizarSemanaAlvo(chaveSemanaAlvo) {
  var partes = chaveSemanaAlvo.split('-').map(Number);
  var ano = partes[0], mes0 = partes[1] - 1;
  var semanasDoMesAlvo = semanasDoMes(ano, mes0);
  var epochAlvo = Date.UTC(ano, mes0, partes[2]) / 86400000;
  var indiceNoMes = semanasDoMesAlvo.findIndex(function (s) { return s.inicio === epochAlvo; });
  if (indiceNoMes === -1) {
    throw new Error('Semana-alvo ' + chaveSemanaAlvo + ' não bate com nenhuma semana de semanasDoMes(' + ano + ',' + mes0 + ') -- calendário divergente.');
  }
  return { ano: ano, mesIdx: mes0, semanas: semanasDoMesAlvo, indiceNoMes: indiceNoMes };
}

function tendenciaDaSemanaAlvo(registros, indices, dimensao, alvo, demandas, hojeEpoch) {
  var indiceAtual = indiceSemanaAtual(alvo.semanas, hojeEpoch);
  var series = calcularSeriesSemanaisDimensao(
    registros, indices, dimensao, alvo.mesIdx, alvo.semanas, alvo.semanas.length,
    !!(demandas && demandas.porRegistroEventos), indiceAtual, demandas, hojeEpoch
  );
  var v = series.semanasTendenciaCompleta[alvo.indiceNoMes];
  return (v === null || v === undefined) ? null : v;
}

// registros: array cru da MATRIZ (mesmo formato de window.__REGISTROS__).
// demandas: { porRegistroEventos } (mesmo formato de window.__DEMANDAS__).
// hojeEpoch: dia-epoch (UTC) do instante em que o job roda -- normalmente
// uma sexta 22h, mas ver chaveSemanaSeguinteDeSexta pra tolerância de atraso.
function calcularSnapshotSemanaAlvo(registros, demandas, hojeEpoch) {
  var chaveSemanaAlvo = chaveSemanaSeguinteDeSexta(hojeEpoch);
  var alvo = localizarSemanaAlvo(chaveSemanaAlvo);
  var porRegistro = {};
  (registros || []).forEach(function (registro, idx) {
    var chave = chaveMatriz(registro.sup, registro.tipologia);
    var volume = tendenciaDaSemanaAlvo(registros, [idx], 'volume', alvo, demandas, hojeEpoch);
    var financeiro = tendenciaDaSemanaAlvo(registros, [idx], 'financeiro', alvo, demandas, hojeEpoch);
    var equipe = tendenciaDaSemanaAlvo(registros, [idx], 'equipes', alvo, demandas, hojeEpoch);
    var produtividadeMedia = (volume === null || !equipe) ? null : volume / equipe;
    porRegistro[chave] = {
      volume: { tendencia: volume }, financeiro: { tendencia: financeiro },
      equipe: { tendencia: equipe }, produtividadeMedia: { tendencia: produtividadeMedia },
    };
  });
  return { chaveSemanaAlvo: chaveSemanaAlvo, geradoEmIso: new Date().toISOString(), porRegistro: porRegistro };
}

module.exports.calcularSnapshotSemanaAlvo = calcularSnapshotSemanaAlvo;
```

Ajustar o `module.exports` do Step 3 para exportar os dois:
`module.exports = { chaveSemanaSeguinteDeSexta, calcularSnapshotSemanaAlvo };`

- [ ] **Step 8: Rodar e confirmar os 4 testes passando**

Run: `node --test test/semanal-congelar-tendencia.test.js`
Expected: PASS (4 testes)

- [ ] **Step 9: Commit**

```bash
git add tools/semanal/congelar-tendencia-semanal.js test/semanal-congelar-tendencia.test.js
git commit -m "feat: calcula o snapshot de tendencia da semana seguinte a uma sexta"
```

---

## Task 2: CLI de gravação — arquivo persistido + coordenação entre as 3 máquinas

**Files:**
- Modify: `tools/semanal/congelar-tendencia-semanal.js`
- Test: `test/semanal-congelar-tendencia.test.js` (mesmo arquivo do Task 1, casos novos)

**Interfaces:**
- Consumes: `calcularSnapshotSemanaAlvo` (Task 1); `hojeNoFusoProjeto`, `diaEpochDeHoje`
  (`tools/comum/datas.js`); `parseHeartbeatVolume`/`formatarLinhaHeartbeat`/
  `gravarLinhaHeartbeatVolume` (`tools/semanal/coordenacao-volume.js` — reaproveitados
  tal qual, sem duplicar o formato de heartbeat, mesmo se o "resultado" aqui só tiver
  sentido `ok`/`falhou` sem detalhe de busca).
- Produces: `gravarSnapshotNoArquivo(caminhoArquivo, snapshot)` (mescla no JSON existente,
  uma chave por `chaveSemanaAlvo`, sobrescrevendo se já existir a mesma chave — usado pelo
  Task 6 indiretamente, o arquivo gerado é o que `build-dashboard.js` lê); `main()` (CLI,
  chamada por `require.main === module`, mesmo padrão de
  `atualizar-diario-escalonado.js`).

- [ ] **Step 1: Escrever o teste de `gravarSnapshotNoArquivo`**

```javascript
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { gravarSnapshotNoArquivo } = require('../tools/semanal/congelar-tendencia-semanal.js');

test('gravarSnapshotNoArquivo cria o arquivo na 1a chamada e mescla na 2a, sem apagar semanas antigas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tendencia-congelada-'));
  const caminho = path.join(dir, 'tendencia-congelada-semanal.json');

  gravarSnapshotNoArquivo(caminho, {
    chaveSemanaAlvo: '2026-08-31', geradoEmIso: '2026-08-28T22:00:00.000Z',
    porRegistro: { 'SUP-1|SP': { volume: { tendencia: 10 } } },
  });
  gravarSnapshotNoArquivo(caminho, {
    chaveSemanaAlvo: '2026-09-07', geradoEmIso: '2026-09-04T22:00:00.000Z',
    porRegistro: { 'SUP-1|SP': { volume: { tendencia: 20 } } },
  });

  const conteudo = JSON.parse(fs.readFileSync(caminho, 'utf8'));
  assert.ok(conteudo['2026-08-31'], 'semana anterior preservada');
  assert.ok(conteudo['2026-09-07'], 'semana nova presente');
  assert.equal(conteudo['2026-09-07'].porRegistro['SUP-1|SP'].volume.tendencia, 20);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('gravarSnapshotNoArquivo SOBRESCREVE a mesma semana-alvo (job rodou 2x no mesmo dia)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tendencia-congelada-'));
  const caminho = path.join(dir, 'tendencia-congelada-semanal.json');
  gravarSnapshotNoArquivo(caminho, { chaveSemanaAlvo: '2026-09-07', geradoEmIso: 'a', porRegistro: { X: { volume: { tendencia: 1 } } } });
  gravarSnapshotNoArquivo(caminho, { chaveSemanaAlvo: '2026-09-07', geradoEmIso: 'b', porRegistro: { X: { volume: { tendencia: 2 } } } });
  const conteudo = JSON.parse(fs.readFileSync(caminho, 'utf8'));
  assert.equal(Object.keys(conteudo).length, 1);
  assert.equal(conteudo['2026-09-07'].porRegistro.X.volume.tendencia, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/semanal-congelar-tendencia.test.js`
Expected: FAIL — `gravarSnapshotNoArquivo` não exportada.

- [ ] **Step 3: Implementar `gravarSnapshotNoArquivo` e o resto do CLI**

Acrescentar em `congelar-tendencia-semanal.js`:

```javascript
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  parseHeartbeatVolume, formatarLinhaHeartbeat, jaAtualizadoHoje, gravarLinhaHeartbeatVolume,
} = require('./coordenacao-volume.js');

function gravarSnapshotNoArquivo(caminhoArquivo, snapshot) {
  fs.mkdirSync(path.dirname(caminhoArquivo), { recursive: true });
  var atual = {};
  if (fs.existsSync(caminhoArquivo)) {
    atual = JSON.parse(fs.readFileSync(caminhoArquivo, 'utf8'));
  }
  atual[snapshot.chaveSemanaAlvo] = { geradoEm: snapshot.geradoEmIso, porRegistro: snapshot.porRegistro };
  fs.writeFileSync(caminhoArquivo, JSON.stringify(atual, null, 2) + '\n');
}

// --- CLI, mesmo padrão de corrida segura de atualizar-diario-escalonado.js:
// heartbeat PRÓPRIO (nome de arquivo diferente, mesmo formato de linha), pra
// não competir com o heartbeat de busca de volume -- os dois podem disparar
// em janelas de tempo diferentes (8h vs. sexta 22h) e não têm por que
// compartilhar a mesma trava.
const RAIZ = path.join(__dirname, '..', '..');
const CAMINHO_SNAPSHOT = path.join(RAIZ, 'docs', 'tendencia-congelada-semanal.json');
const CAMINHO_HEARTBEAT = path.join(RAIZ, 'dist', 'heartbeat-congelamento-semanal.csv');
const NOME_HEARTBEAT = 'heartbeat-congelamento-semanal.csv';
const NOME_SNAPSHOT = 'tendencia-congelada-semanal.json';

function git(args) { return execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8' }); }

function lerHeartbeatDoOrigin() {
  try {
    return parseHeartbeatVolume(git(['show', 'origin/master:dist/' + NOME_HEARTBEAT]));
  } catch (err) {
    console.warn('Aviso: git show falhou (' + err.message + ') -- tratando como "nunca rodou".');
    return [];
  }
}

function precisaRodarHoje() {
  try { git(['fetch', 'origin', 'master']); }
  catch (err) { console.warn('Aviso: git fetch falhou (' + err.message + ') -- seguindo com cache local.'); }
  return !jaAtualizadoHoje(lerHeartbeatDoOrigin());
}

async function main() {
  console.log('Checando se o congelamento de hoje já rodou (via git, sem recalcular)...');
  if (!precisaRodarHoje()) {
    console.log('Já rodou hoje -- nada a fazer.');
    return;
  }

  const statusInicial = git(['status', '--porcelain']).trim();
  const precisaGuardar = statusInicial.length > 0;
  if (precisaGuardar) {
    git(['stash', 'push', '-u', '-m', 'congelar-tendencia-semanal.js: mudanças pendentes guardadas antes da publicação automática']);
  }

  try {
    // Lê o build corrente (já publicado) -- não busca nada online, o
    // congelamento usa exatamente o dado que a página de hoje já mostra.
    const { montarRegistrosEDemandas } = require('./build-dashboard.js');
    const { registros, demandas } = await montarRegistrosEDemandas();

    const { diaEpochDeHoje } = require('../comum/datas.js');
    const { calcularSnapshotSemanaAlvo } = require('./congelar-tendencia-semanal.js');
    const snapshot = calcularSnapshotSemanaAlvo(registros, demandas, diaEpochDeHoje());
    gravarSnapshotNoArquivo(CAMINHO_SNAPSHOT, snapshot);

    const maquina = process.env.COMPUTERNAME || 'desconhecida';
    gravarLinhaHeartbeatVolume(CAMINHO_HEARTBEAT, formatarLinhaHeartbeat({
      dataHora: new Date(), maquina: maquina, resultado: 'ok', detalhe: snapshot.chaveSemanaAlvo,
    }));

    if (!precisaRodarHoje()) {
      console.log('Outra máquina já congelou hoje enquanto rodávamos -- descartando, não vamos publicar de novo.');
      return;
    }

    const { execFileSync: exec } = require('node:child_process');
    exec('git', ['add', 'docs/' + NOME_SNAPSHOT, 'dist/' + NOME_HEARTBEAT], { cwd: RAIZ });
    exec('git', ['commit', '-m', 'Congelamento da tendencia (semana de ' + snapshot.chaveSemanaAlvo + ', ' + maquina + ')'], { cwd: RAIZ });
    exec('git', ['push', 'origin', 'HEAD:master'], { cwd: RAIZ });
    console.log('\n=== Concluído: semana ' + snapshot.chaveSemanaAlvo + ' congelada e publicada ===');
  } finally {
    if (precisaGuardar) git(['stash', 'pop']);
  }
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = {
  chaveSemanaSeguinteDeSexta, calcularSnapshotSemanaAlvo, gravarSnapshotNoArquivo, main,
};
```

**Nota para quem implementar:** `montarRegistrosEDemandas` ainda não existe em
`build-dashboard.js` — é criada no Task 6 (extração do que já monta `registros`/`demandas`
hoje dentro de `build()`, para reuso aqui sem duplicar parsing). Até o Task 6 rodar, este
CLI não executa de ponta a ponta — mas os testes deste Task 2 cobrem só
`gravarSnapshotNoArquivo` (função pura de arquivo), que não depende disso, então o teste
passa mesmo antes do Task 6. Documentar isso no corpo do commit.

- [ ] **Step 4: Rodar e confirmar os 6 testes do arquivo passando**

Run: `node --test test/semanal-congelar-tendencia.test.js`
Expected: PASS (6 testes — os 4 do Task 1 + os 2 novos)

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/congelar-tendencia-semanal.js test/semanal-congelar-tendencia.test.js
git commit -m "feat: CLI de congelamento semanal com coordenacao entre maquinas (git heartbeat)"
```

---

## Task 3: `serieDaSemana` de `compute-relatorio-semanal.js` aceita Tendência externa

**Files:**
- Modify: `tools/semanal/compute-relatorio-semanal.js`
- Test: `test/semanal-compute-relatorio-semanal.test.js`

**Interfaces:**
- Consumes: nada novo — mesma assinatura de `calcularSeriesSemanaisDimensao` já usada.
- Produces: `serieDaSemana(registros, indices, dimensao, alvo, ctx)` ganha suporte a
  `ctx.tendenciaExterna` — uma função `(chaveRegistro) => number|null|undefined` (quando
  `undefined`, cai no cálculo de hoje). Consumida pelo Task 5 (Consolidado) para plugar o
  snapshot no lugar do recálculo, sem duplicar `serieDaSemana`.

- [ ] **Step 1: Escrever o teste (com `tendenciaExterna` presente e ausente)**

Ler primeiro `test/semanal-compute-relatorio-semanal.test.js` existente para copiar a
fixture de `registros`/`demandas`/`semanas` já usada pelos testes desse arquivo (mesmos
nomes de campo que `janelasDoGrupo`/`montarLinhasDimensao` já exercitam) — não recriar do
zero. Depois, acrescentar:

```javascript
test('serieDaSemana usa ctx.tendenciaExterna quando fornecida, ignorando o recalculo', () => {
  const ctx = { ...ctxBase, tendenciaExterna: () => 999 }; // ctxBase = a fixture já existente do arquivo
  const resultado = serieDaSemana(registros, [0], 'volume', alvoSemanaVigente, ctx); // alvoSemanaVigente = a mesma fixture de alvo já usada nos testes existentes
  assert.equal(resultado.tendencia, 999);
});

test('serieDaSemana sem ctx.tendenciaExterna continua recalculando como antes (regressao)', () => {
  const ctx = { ...ctxBase }; // sem tendenciaExterna
  const resultado = serieDaSemana(registros, [0], 'volume', alvoSemanaVigente, ctx);
  assert.notEqual(resultado.tendencia, 999); // não é o valor mockado -- é o valor calculado de verdade
});
```

- [ ] **Step 2: Rodar e ver o 1º teste falhar**

Run: `node --test test/semanal-compute-relatorio-semanal.test.js`
Expected: FAIL no teste de `tendenciaExterna` (a função ainda ignora o campo); PASS no de
regressão (já é o comportamento atual).

- [ ] **Step 3: Implementar o suporte em `serieDaSemana`**

Em `tools/semanal/compute-relatorio-semanal.js`, dentro de `serieDaSemana` (linhas
44-62 hoje), trocar o bloco de cálculo da Tendência:

```javascript
function serieDaSemana(registros, indices, dimensao, alvo, ctx) {
  var semanas = alvo.semanasDoMesAlvo;
  var indiceAtualReal = indiceSemanaAtual(semanas, ctx.hojeEpoch);
  var seriesAoVivo = calcularSeriesSemanaisDimensao(
    registros, indices, dimensao, alvo.mesIdx, semanas, semanas.length,
    ctx.temSemanasReais, indiceAtualReal, ctx.demandas, ctx.hojeEpoch, ctx.mesAtualReal
  );
  // ctx.tendenciaExterna: função opcional (chaveRegistro) => number|null. Só faz
  // sentido para GRUPOS de um registro só (indices.length === 1) -- um total
  // agregado (SUP/tipologia/geral) não tem UMA chave, então cai sempre no
  // recálculo local mesmo com tendenciaExterna presente. Quem quiser um total
  // vindo do snapshot soma os registros individuais fora daqui (ver Consolidado,
  // que já faz essa soma para as outras colunas).
  var tendenciaCongelada;
  if (typeof ctx.tendenciaExterna === 'function' && indices.length === 1) {
    var registro = registros[indices[0]];
    var chave = ctx.chaveDoRegistro ? ctx.chaveDoRegistro(registro) : null;
    var externa = chave === null ? undefined : ctx.tendenciaExterna(chave);
    if (externa !== undefined) tendenciaCongelada = externa;
  }
  if (tendenciaCongelada === undefined) {
    var congelar = alvo.semana.inicio <= ctx.hojeEpoch;
    var hojeEfetivo = congelar ? alvo.semana.inicio : ctx.hojeEpoch;
    var seriesTendencia = hojeEfetivo === ctx.hojeEpoch ? seriesAoVivo : calcularSeriesSemanaisDimensao(
      registros, indices, dimensao, alvo.mesIdx, semanas, semanas.length,
      ctx.temSemanasReais, indiceSemanaAtual(semanas, hojeEfetivo), ctx.demandas, hojeEfetivo, ctx.mesAtualReal
    );
    tendenciaCongelada = seriesTendencia.semanasTendenciaCompleta[alvo.indiceNoMes];
  }
  return {
    previsto: seriesAoVivo.semanasPrevisto[alvo.indiceNoMes],
    realizado: seriesAoVivo.semanasRealizado[alvo.indiceNoMes],
    tendencia: tendenciaCongelada,
  };
}
```

`ctx.chaveDoRegistro` é passado pelo Task 5 como `(registro) => chaveMatriz(registro.sup,
registro.tipologia)` — fica como parâmetro em vez de importar `chaveMatriz` direto aqui
porque este módulo é dual Node+navegador e `linha-base.js` não faz parte do bundle do
navegador desta página (ver o comentário no topo de `render-aba-consolidado.js` sobre
`DIAS_PREMISSA_MES` chegar como global, mesmo motivo se aplicaria a `chaveMatriz` — mais
simples receber a função pronta do chamador, que já sabe resolver isso).

- [ ] **Step 4: Rodar e confirmar os 2 testes novos + a suíte inteira do arquivo passando**

Run: `node --test test/semanal-compute-relatorio-semanal.test.js`
Expected: PASS (todos, incluindo os pré-existentes — nenhuma regressão)

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/compute-relatorio-semanal.js test/semanal-compute-relatorio-semanal.test.js
git commit -m "feat: serieDaSemana aceita tendencia externa (snapshot) por registro"
```

---

## Task 4: Resumo por SUP × Tipologia no Consolidado (substitui a tabela atual)

**Files:**
- Modify: `tools/semanal/render-aba-consolidado.js`
- Test: `test/semanal-render-aba-consolidado.test.js`

**Interfaces:**
- Consumes: `serieDaSemana` (Task 3, com `ctx.tendenciaExterna`/`ctx.chaveDoRegistro`);
  `blocosPorSup`, `tipologiasPresentes` (já existentes no próprio arquivo);
  `chaveMatriz` (`tools/comum/linha-base.js`).
- Produces: `renderAbaConsolidado(registros, indices, opcoes)` — `opcoes` ganha
  `congeladoSemanal` (o objeto `{ [chaveSemanaAlvo]: { porRegistro } }` inteiro, cru — a
  função escolhe a entrada certa por `formatarChaveSemana(semana.inicio)`); tabela HTML
  muda de forma (ver Step 3). `formatarChaveSemana(diaEpoch)` novo, exportado (mesma
  conta que `chaveSemanaSeguinteDeSexta` do Task 1 usa para o formato `YYYY-MM-DD`, mas
  aplicada direto a um `diaEpoch` sem procurar sexta — usada tanto aqui quanto,
  futuramente, por quem gerar o link entre snapshot e semana).

- [ ] **Step 1: Escrever o teste do resumo com snapshot presente e ausente**

Ler primeiro os fixtures existentes de `test/semanal-render-aba-consolidado.test.js` para
reusar `registros`/`opcoes` já montados nos testes atuais (mesmo padrão de semanas/mesIdx
que os testes de "congelamento" e "colunas" de hoje já usam) em vez de recriar. Depois:

```javascript
test('resumo mostra Previsto ate a data / Realizado / Desvio ate a data / Semana total, por SUP e tipologia', () => {
  const html = renderAbaConsolidado(registros, indices, { ...opcoesBase }); // opcoesBase = fixture já existente
  assert.match(html, /Previsto até a data/);
  assert.match(html, /Realizado/);
  assert.match(html, /Desvio até a data/);
  assert.match(html, /Semana total/);
});

test('com congeladoSemanal presente para a semana em tela, a Tendencia exibida vem do snapshot (nao do recalculo)', () => {
  const chaveSemana = formatarChaveSemana(opcoesBase.semanas[opcoesBase.semanaIdx].inicio);
  const congeladoSemanal = {
    [chaveSemana]: { porRegistro: { [chaveMatriz(registros[0].sup, registros[0].tipologia)]: { volume: { tendencia: 12345 } } } },
  };
  const html = renderAbaConsolidado(registros, indices, { ...opcoesBase, congeladoSemanal });
  assert.match(html, /12\.345/); // formatarNumero(12345, 0) -> '12.345' em pt-BR
  assert.match(html, /congelada/i);
});

test('sem entrada no snapshot para a semana em tela, cai no recalculo de hoje e rotula "recalculada"', () => {
  const html = renderAbaConsolidado(registros, indices, { ...opcoesBase, congeladoSemanal: {} });
  assert.match(html, /recalculada/i);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/semanal-render-aba-consolidado.test.js`
Expected: FAIL — a tabela atual não tem essas colunas/rótulos ainda.

- [ ] **Step 3: Reescrever a montagem de linhas/cabeçalho para o formato de resumo**

Em `tools/semanal/render-aba-consolidado.js`:

1. Importar `chaveMatriz` e `serieDaSemana`:
```javascript
const { chaveMatriz } = require('../comum/linha-base.js');
const { serieDaSemana } = require('./compute-relatorio-semanal.js');
```
(mesma ressalva do Task 3 sobre bundle do navegador — `linha-base.js` e
`compute-relatorio-semanal.js` precisam estar na lista de arquivos concatenados pelo
bundler desta página; ver Task 6, que ajusta `build-dashboard.js`/`render-semanal.js`.)

2. Novo `formatarChaveSemana(diaEpoch)`:
```javascript
function formatarChaveSemana(diaEpoch) {
  var d = new Date(diaEpoch * 86400000);
  var ano = d.getUTCFullYear();
  var mes = String(d.getUTCMonth() + 1).padStart(2, '0');
  var dia = String(d.getUTCDate()).padStart(2, '0');
  return ano + '-' + mes + '-' + dia;
}
```

3. Trocar `renderLinha`/`renderCabecalho` por um par novo que monta as 4 colunas do
resumo em vez de Realizado/Tendência/premissas. `renderLinhaResumo` substitui
`renderLinha`:

```javascript
// congeladoPorSemana: a fatia de congeladoSemanal já resolvida para a chave da
// semana em tela (congeladoSemanal[formatarChaveSemana(semana.inicio)] || null),
// resolvida uma vez em renderAbaConsolidado e passada via ctx -- evita recalcular
// a chave em cada linha.
function tendenciaExternaDoCtx(ctx) {
  if (!ctx.congeladoPorSemana || !ctx.congeladoPorSemana.porRegistro) return undefined;
  var porRegistro = ctx.congeladoPorSemana.porRegistro;
  return function (chave) {
    var entrada = porRegistro[chave];
    if (!entrada || !entrada[ctx.dimensaoSnapshot]) return undefined;
    var v = entrada[ctx.dimensaoSnapshot].tendencia;
    return v === undefined ? undefined : v;
  };
}

function renderLinhaResumo(celulas, classe, registros, indices, ctx) {
  var alvo = { semana: ctx.semanaEscolhida, mesIdx: ctx.mesIdx, semanasDoMesAlvo: ctx.semanas, indiceNoMes: ctx.semanaIdx };
  var serieCtx = {
    hojeEpoch: ctx.hojeEpoch, temSemanasReais: ctx.temSemanasReais, demandas: ctx.demandas,
    tendenciaExterna: tendenciaExternaDoCtx(ctx),
    chaveDoRegistro: function (r) { return chaveMatriz(r.sup, r.tipologia); },
  };
  var janela = serieDaSemana(registros, indices, ctx.dimensaoSnapshot, alvo, serieCtx);
  // "Previsto até a data": fração do Previsto da semana proporcional aos dias
  // já passados dela (mesma leitura do .xlsx) -- dias corridos, não úteis,
  // porque é isso que "até a data" descreve num calendário civil.
  var diasNaSemana = Math.round((ctx.semanaEscolhida.fim - ctx.semanaEscolhida.inicio + 1));
  var diasDecorridos = Math.max(0, Math.min(diasNaSemana, ctx.hojeEpoch - ctx.semanaEscolhida.inicio + 1));
  var previstoAteAData = janela.previsto === null ? null : janela.previsto * (diasDecorridos / diasNaSemana);
  var numeradorDesvio = ctx.semanaEscolhida.inicio <= ctx.hojeEpoch && ctx.semanaEscolhida.fim > ctx.hojeEpoch
    ? janela.tendencia // semana em curso: compara contra a projeção, não o parcial cru
    : janela.realizado;
  var desvio = (numeradorDesvio === null || numeradorDesvio === undefined || !previstoAteAData)
    ? null : (numeradorDesvio / previstoAteAData) - 1;

  function num(v, casas) { return v === null || v === undefined ? '<td class="num sem-dado"></td>' : '<td class="num">' + formatarNumero(v, casas === undefined ? 0 : casas) + '</td>'; }
  function pct(v) { return v === null || v === undefined ? '<td class="num sem-dado"></td>' : '<td class="num">' + formatarNumero(v * 100, 1) + '%</td>'; }

  return '<tr class="' + classe + '">' + celulas
    + num(previstoAteAData) + num(janela.realizado) + pct(desvio) + num(janela.previsto)
    + '</tr>';
}
```

4. `renderCabecalho` vira:
```javascript
function renderCabecalho(dimensao, semana, congelada) {
  var sufixo = semana ? ' (' + formatarIntervaloSemana(semana.inicio, semana.fim) + ')' : '';
  var rotuloTendencia = congelada === true ? ' (congelada)' : congelada === false ? ' (recalculada)' : '';
  return '<thead><tr>'
    + '<th>SUP</th><th>Grupo</th><th>Tomador</th><th>Tipologia</th>'
    + '<th class="num">Previsto até a data' + escapeHtml(sufixo + rotuloTendencia) + '</th>'
    + '<th class="num">Realizado</th>'
    + '<th class="num">Desvio até a data</th>'
    + '<th class="num">Semana total</th>'
    + '</tr></thead>';
}
```
`congelada` é `true`/`false`/`null` (sem semana selecionada) — resolvido em
`renderAbaConsolidado` por `!!ctx.congeladoPorSemana`.

5. Em `renderAbaConsolidado`, montar `ctx.semanaEscolhida`/`ctx.congeladoPorSemana`/
`ctx.dimensaoSnapshot` (a mesma `dimensao` coagida por `dimensaoDaTabela`, ver Decisão 5
do design) e trocar as chamadas de `renderLinha(...)` por `renderLinhaResumo(...)`, e
`renderCabecalho(dimensao, semanas[semanaIdx], congelar ? hojeEfetivo : null)` por
`renderCabecalho(dimensao, semanas[semanaIdx], !!o.congeladoSemanal && !!o.congeladoSemanal[formatarChaveSemana(semanas[semanaIdx].inicio)])`.

6. `colunasExtras`/`valorExtra`/`produtividadeEsperada`/`ticketMedioPrevisto` usadas
SÓ pelas premissas antigas: remover as chamadas em `renderCabecalho`/`renderLinha` (já
substituídas acima), mas **manter as funções exportadas** — `produtividadeEsperada`/
`ticketMedioPrevisto`/`somarPrevistoMes` continuam com teste próprio e podem ter outro
consumidor; não apagar código que não foi pedido para sair.

- [ ] **Step 4: Rodar e confirmar os 3 testes novos passando**

Run: `node --test test/semanal-render-aba-consolidado.test.js`
Expected: PASS nos 3 novos. **Espera-se que testes ANTIGOS quebrem** (eles verificavam a
tabela de Realizado/Tendência/premissas, que saiu) — ver Step 5.

- [ ] **Step 5: Atualizar/remover os testes antigos que verificavam a tabela anterior**

Abrir `test/semanal-render-aba-consolidado.test.js` e, para cada teste que afirma sobre
`Realizado`/`Tendência`/`Equipes previstas`/`Produtividade média esperada`/`Ticket médio
previsto` como COLUNAS da tabela principal (não como conceito geral): apagar ou reescrever
para o formato novo. Os testes de **congelamento** (comparar `hojeEpoch` vs. semana
escolhida) continuam válidos, mas precisam ler o valor do lugar novo (`Previsto até a
data`/coluna com `(congelada)`/`(recalculada)` no cabeçalho) em vez de procurar
`Tendência congelada em`.

- [ ] **Step 6: Rodar a suíte inteira do arquivo e confirmar tudo verde**

Run: `node --test test/semanal-render-aba-consolidado.test.js`
Expected: PASS (sem nenhum teste vermelho)

- [ ] **Step 7: Commit**

```bash
git add tools/semanal/render-aba-consolidado.js test/semanal-render-aba-consolidado.test.js
git commit -m "feat: Consolidado mostra resumo Previsto ate a data/Realizado/Desvio/Semana total"
```

---

## Task 5: Blocos "Produtividade média" e "Equipe" (Tendência congelada + Realizado)

**Files:**
- Modify: `tools/semanal/render-aba-consolidado.js`
- Test: `test/semanal-render-aba-consolidado.test.js`

**Interfaces:**
- Consumes: `renderLinhaResumo`/`serieDaSemana` (Task 4); `demandas.equipesPorDia` (mesmo
  campo que a Tabela Semanal já lê para Realizado de Equipes).
- Produces: `renderAbaConsolidado` passa a desenhar 3 tabelas na aba (Volume/Financeiro
  coagido — Task 4 — mais estes 2 blocos novos), cada uma com seu próprio `<h3>`/título.

- [ ] **Step 1: Escrever o teste dos 2 blocos novos**

```javascript
test('aba mostra bloco Produtividade media e bloco Equipe, cada um com Tendencia congelada e Realizado', () => {
  const html = renderAbaConsolidado(registros, indices, { ...opcoesBase });
  assert.match(html, /Produtividade média/);
  assert.match(html, /Equipe/);
  // 3 tabelas na aba: a principal (Volume/Financeiro) + 2 novas.
  const ocorrencias = html.match(/<table/g) || [];
  assert.equal(ocorrencias.length, 3);
});

test('Realizado de Produtividade media = Realizado Volume / Realizado Equipe da mesma semana', () => {
  const html = renderAbaConsolidado(registros, indices, { ...opcoesBase });
  // Fixture: com os valores conhecidos de opcoesBase, o Realizado de volume e
  // de equipe do TOTAL GERAL na semana escolhida são fixos -- reusar os
  // mesmos números que os testes de Realizado da tabela principal (Task 4)
  // já verificam, dividindo um pelo outro à mão no assert.
  assert.match(html, new RegExp(String(REALIZADO_VOLUME_TOTAL_GERAL / REALIZADO_EQUIPE_TOTAL_GERAL).split('.')[0]));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/semanal-render-aba-consolidado.test.js`
Expected: FAIL — blocos não existem ainda.

- [ ] **Step 3: Implementar os 2 blocos**

Em `render-aba-consolidado.js`, criar uma função genérica reaproveitando a hierarquia
já montada (TOTAL GERAL / por tipologia / por SUP) para desenhar qualquer uma das 3
"dimensões de bloco" (volume-ou-financeiro / produtividadeMedia / equipe):

```javascript
// realizadoDoBloco: (registros, indices, ctx) => number|null -- Produtividade
// média e Equipe não têm Realizado saindo de calcularSeriesSemanaisDimensao
// como as outras (ver Decisão 3 do design: Produtividade média Realizado =
// Volume Realizado / Equipe Realizado; Equipe Realizado = demandas.equipesPorDia
// já agregado pela mesma janela que a Tabela Semanal usa) -- por isso este
// bloco recebe a função pronta em vez de reusar tendenciaExternaDoCtx sozinha.
function renderLinhaResumoGenerica(celulas, classe, registros, indices, ctx, chaveDimensaoSnapshot, realizadoDoBloco) {
  var alvo = { semana: ctx.semanaEscolhida, mesIdx: ctx.mesIdx, semanasDoMesAlvo: ctx.semanas, indiceNoMes: ctx.semanaIdx };
  var congeladoPorSemana = ctx.congeladoPorSemana;
  var tendenciaExterna;
  if (congeladoPorSemana && congeladoPorSemana.porRegistro && indices.length === 1) {
    var chave = chaveMatriz(registros[indices[0]].sup, registros[indices[0]].tipologia);
    var entrada = congeladoPorSemana.porRegistro[chave];
    if (entrada && entrada[chaveDimensaoSnapshot] && entrada[chaveDimensaoSnapshot].tendencia !== undefined) {
      tendenciaExterna = entrada[chaveDimensaoSnapshot].tendencia;
    }
  }
  var tendencia = tendenciaExterna !== undefined ? tendenciaExterna : null; // sem snapshot: sem recalculo local pra estes 2 blocos (ver nota abaixo)
  var realizado = realizadoDoBloco(registros, indices, ctx);
  function num(v, casas) { return v === null || v === undefined ? '<td class="num sem-dado"></td>' : '<td class="num">' + formatarNumero(v, casas === undefined ? 2 : casas) + '</td>'; }
  return '<tr class="' + classe + '">' + celulas + num(tendencia) + num(realizado) + '</tr>';
}
```

**Nota de escopo, para não confundir quem revisar:** os 2 blocos novos usam **só o
snapshot** para a Tendência (sem cair no recálculo local que a tabela principal do Task 4
tem como fallback) — Produtividade média não existe como série própria em
`calcularSeriesSemanaisDimensao` (é derivada), então "recalcular" aqui exigiria refazer a
mesma divisão volume/equipe fora do snapshot, o que é possível mas não foi pedido nesta
rodada; sem snapshot para a semana, a célula fica **sem dado**, com uma nota dizendo que o
congelamento de sexta ainda não rodou para aquela semana. Isso é uma limitação aceita, não
um bug — documentar no comentário do código e no `CLAUDE.md` (Task 7).

`realizadoDoBloco` para Produtividade média:
```javascript
function realizadoProdutividadeMedia(registros, indices, ctx) {
  var serieVolume = serieDaSemana(registros, indices, 'volume', { semana: ctx.semanaEscolhida, mesIdx: ctx.mesIdx, semanasDoMesAlvo: ctx.semanas, indiceNoMes: ctx.semanaIdx }, { hojeEpoch: ctx.hojeEpoch, temSemanasReais: ctx.temSemanasReais, demandas: ctx.demandas });
  var serieEquipe = serieDaSemana(registros, indices, 'equipes', { semana: ctx.semanaEscolhida, mesIdx: ctx.mesIdx, semanasDoMesAlvo: ctx.semanas, indiceNoMes: ctx.semanaIdx }, { hojeEpoch: ctx.hojeEpoch, temSemanasReais: ctx.temSemanasReais, demandas: ctx.demandas });
  if (serieVolume.realizado === null || !serieEquipe.realizado) return null;
  return serieVolume.realizado / serieEquipe.realizado;
}
function realizadoEquipe(registros, indices, ctx) {
  var serieEquipe = serieDaSemana(registros, indices, 'equipes', { semana: ctx.semanaEscolhida, mesIdx: ctx.mesIdx, semanasDoMesAlvo: ctx.semanas, indiceNoMes: ctx.semanaIdx }, { hojeEpoch: ctx.hojeEpoch, temSemanasReais: ctx.temSemanasReais, demandas: ctx.demandas });
  return serieEquipe.realizado;
}
```

E, em `renderAbaConsolidado`, depois da tabela principal (Task 4), montar as duas tabelas
extras percorrendo a MESMA hierarquia (`blocosPorSup`/`tipologiasPresentes`/`todos`) já
calculada, chamando `renderLinhaResumoGenerica` com `'produtividadeMedia'`/
`realizadoProdutividadeMedia` e `'equipe'`/`realizadoEquipe` respectivamente, cada bloco
com seu próprio `<h3>Produtividade média</h3>`/`<h3>Equipe</h3>` e
`<table><thead><tr><th>SUP</th>...<th>Tendência congelada</th><th>Realizado</th></tr></thead>`.

- [ ] **Step 4: Rodar e confirmar os testes passando**

Run: `node --test test/semanal-render-aba-consolidado.test.js`
Expected: PASS (todos, incluindo os do Task 4)

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/render-aba-consolidado.js test/semanal-render-aba-consolidado.test.js
git commit -m "feat: blocos Produtividade media e Equipe (tendencia congelada + realizado) no Consolidado"
```

---

## Task 6: `build-dashboard.js` embute o snapshot + extrai `montarRegistrosEDemandas`

**Files:**
- Modify: `tools/semanal/build-dashboard.js`
- Modify: `tools/semanal/render-semanal.js` (passar `congeladoSemanal` para
  `montarAbaConsolidado`, e incluir `compute-relatorio-semanal.js`/`linha-base.js` no
  bundle do navegador se ainda não estiverem)
- Test: `test/semanal-build-dashboard.test.js`

**Interfaces:**
- Consumes: `calcularSnapshotSemanaAlvo`/estrutura de `docs/tendencia-congelada-semanal.json`
  (Tasks 1-2); `renderAbaConsolidado` com `opcoes.congeladoSemanal` (Tasks 4-5).
- Produces: `montarRegistrosEDemandas()` (extraída de dentro de `build()`, exportada —
  consumida pelo CLI do Task 2); `window.__CONGELADO_SEMANAL__` (novo global baked no
  HTML, mesmo padrão de `window.__DEMANDAS_MENSAIS__`).

- [ ] **Step 1: Ler `build()` em `build-dashboard.js` e localizar onde `registros`/
  `demandas` já são montados**

Não é um "step de teste" — é levantamento necessário antes de extrair a função sem
quebrar nada. Procurar a variável que hoje guarda o resultado de `ComputeDemandas.
computeDemandas(...)` e o array final de `registros` (pós-`reconciliarLinhaBase`) dentro
de `build()`.

- [ ] **Step 2: Escrever o teste de `montarRegistrosEDemandas`**

```javascript
const { montarRegistrosEDemandas } = require('../tools/semanal/build-dashboard.js');

test('montarRegistrosEDemandas devolve registros e demandas sem precisar de ORCAMENTO_SENHA nem escrever nada em disco', async () => {
  const { registros, demandas } = await montarRegistrosEDemandas();
  assert.ok(Array.isArray(registros) && registros.length > 0);
  assert.ok(demandas && demandas.porRegistroEventos);
});
```

(Este teste roda no `dist/*.csv` já commitado, mesma fonte que os outros testes de
`semanal-build-dashboard.test.js` já usam — não faz rede.)

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test test/semanal-build-dashboard.test.js`
Expected: FAIL — `montarRegistrosEDemandas` não exportada.

- [ ] **Step 4: Extrair `montarRegistrosEDemandas` de dentro de `build()`**

Cortar o trecho de `build()` que monta `registros`/`demandas` (parsing dos CSVs +
`reconciliarLinhaBase` + `ComputeDemandas.computeDemandas`) para uma função nomeada
`async function montarRegistrosEDemandas() { ... return { registros, demandas }; }`, e
fazer `build()` chamá-la no lugar do trecho cortado — comportamento de `build()`
inalterado, só reorganizado. Exportar no `module.exports` final do arquivo, ao lado de
`build`.

- [ ] **Step 5: Rodar e confirmar o teste novo passando + a suíte de build inteira**

Run: `node --test test/semanal-build-dashboard.test.js`
Expected: PASS (todos)

- [ ] **Step 6: Escrever o teste de embutir o snapshot no HTML**

```javascript
test('build embute window.__CONGELADO_SEMANAL__ quando docs/tendencia-congelada-semanal.json existe', async () => {
  // Fixture: escrever um docs/tendencia-congelada-semanal.json temporário
  // (mesmo diretório que o build já lê) antes de chamar build(), e confirmar
  // que window.__CONGELADO_SEMANAL__ aparece no HTML gerado com o conteúdo
  // certo. Seguir o padrão de setup/teardown que os testes de
  // avancos-online.csv/lab-online.csv já usam neste mesmo arquivo (arquivo
  // de fixture escrito em dist/ ou docs/ antes do teste, removido depois).
});

test('build funciona normalmente (sem quebrar) quando o arquivo de snapshot NÃO existe', async () => {
  // window.__CONGELADO_SEMANAL__ deve sair como {} (nunca undefined -- o
  // cliente não pode ter que checar undefined em cada leitura).
});
```

- [ ] **Step 7: Rodar e ver falhar**

Run: `node --test test/semanal-build-dashboard.test.js`
Expected: FAIL — `window.__CONGELADO_SEMANAL__` não é emitido ainda.

- [ ] **Step 8: Implementar a leitura opcional do arquivo em `build()`**

Perto de onde `build-dashboard.js` já lê outros arquivos opcionais em `dist/`/`docs/`
(mesmo padrão condicional que `demandas-sondagem-online.csv` já segue — lê se existir,
segue sem erro se não existir), acrescentar:

```javascript
const CAMINHO_CONGELADO_SEMANAL = path.join(__dirname, '..', '..', 'docs', 'tendencia-congelada-semanal.json');
function lerCongeladoSemanal() {
  if (!fs.existsSync(CAMINHO_CONGELADO_SEMANAL)) return {};
  return JSON.parse(fs.readFileSync(CAMINHO_CONGELADO_SEMANAL, 'utf8'));
}
```

E, no ponto onde o HTML final monta os `<script>` de globals (perto de onde
`window.__DEMANDAS_MENSAIS__`/`window.__ANO__` já são escritos), acrescentar:
`window.__CONGELADO_SEMANAL__ = ` + `JSON.stringify(lerCongeladoSemanal())` + `;`.

- [ ] **Step 9: Rodar e confirmar os 2 testes novos + suíte inteira**

Run: `node --test test/semanal-build-dashboard.test.js`
Expected: PASS (todos)

- [ ] **Step 10: Ligar o global ao Consolidado em `render-semanal.js`**

Em `montarAbaConsolidado` (`render-semanal.js:1580`), passar
`congeladoSemanal: window.__CONGELADO_SEMANAL__` dentro do objeto de `opcoes` que já é
passado para `RenderAbaConsolidado.renderAbaConsolidado(...)` (linha ~1598).

- [ ] **Step 11: Garantir que `linha-base.js` e `compute-relatorio-semanal.js` entram no
  bundle do navegador**

Procurar, em `render-semanal.js` (ou em `build-dashboard.js`, onde o bundle é montado —
mesmo mecanismo que já concatena `render-aba-consolidado.js`/`render-aba-semanal.js`/
`compute-semanal.js` como `<script>`s), a lista de arquivos concatenados para o
`<script>` do cliente. Adicionar `tools/comum/linha-base.js` e
`tools/semanal/compute-relatorio-semanal.js` **se ainda não estiverem lá** (checar
primeiro — `compute-relatorio-semanal.js` já é usado pelo botão "Gerar relatório Excel",
então é bem provável que já esteja incluído; `linha-base.js` pode não estar, porque hoje
só é usado no build, não no cliente).

- [ ] **Step 12: Build manual de verificação (não é teste automatizado, é checagem
  visual antes de seguir)**

Run: `ORCAMENTO_SENHA='qualquer' node tools/semanal/build-dashboard.js`
Expected: build termina sem erro. Abrir `dist/planejamento-semanal.html` num navegador
local, senha `qualquer`, ir na aba Consolidado, confirmar que a tabela nova aparece sem
erro de console (`montarDashboard is not defined` seria sinal de crase solta truncando o
`SCRIPT_CLIENTE_SEMANAL` — ver Global Constraints).

- [ ] **Step 13: Commit**

```bash
git add tools/semanal/build-dashboard.js tools/semanal/render-semanal.js test/semanal-build-dashboard.test.js
git commit -m "feat: build embute o snapshot congelado e liga ao Consolidado"
```

---

## Task 7: Agendamento nas 3 máquinas + docs

**Files:**
- Create: `tools/semanal/congelar-semanal.ps1` (wrapper `.ps1`, mesmo papel de
  `atualizar-diario.ps1` para o script novo — sem abrir Chrome, ver Task 2)
- Modify: `docs/setup-atualizacao-escalonada.md`
- Modify: `orcamento-dashboard/CLAUDE.md` (seção nova "Congelamento semanal (sextas 22h)")

**Interfaces:**
- Consumes: `tools/semanal/congelar-tendencia-semanal.js` (Task 2, `main()`/CLI).
- Produces: nenhuma interface de código — este task é infraestrutura/documentação.

- [ ] **Step 1: Escrever `congelar-semanal.ps1`**

```powershell
# Roda o congelamento semanal (sextas ~22h) nas 3 maquinas. Sem Chrome --
# le so o que ja foi publicado no build de hoje (ver o comentario no topo de
# congelar-tendencia-semanal.js). Mesmo padrao de coordenacao via git que
# atualizar-diario.ps1 ja usa para o job das 8h.
$env:ORCAMENTO_SENHA = "COLOQUE_A_SENHA_AQUI_NO_TASK_SCHEDULER_LOCAL"
Set-Location "$PSScriptRoot\..\.."
node tools/semanal/congelar-tendencia-semanal.js
```

(Mesma ressalva de segredo que `atualizar-diario.ps1` já documenta: a senha fica só no
Task Scheduler local de cada máquina, nunca commitada — se o arquivo `.ps1` for
commitado com um placeholder, confirmar que ele não tem a senha real preenchida antes do
commit.)

- [ ] **Step 2: Documentar o agendamento em `docs/setup-atualizacao-escalonada.md`**

Acrescentar uma seção "Congelamento semanal (sextas ~22h)" explicando: Task Scheduler
novo, gatilho semanal sexta-feira 22:00 (horário local de cada máquina — Brasília), ação
`powershell.exe -File tools\semanal\congelar-semanal.ps1`, mesma pasta de trabalho do job
das 8h. Não precisa dos 15 minutos de escalonamento entre máquinas que o job das 8h usa
(o próprio script já resolve corrida via heartbeat/git, ver Task 2) — as 3 podem ser
agendadas para o mesmo horário exato.

- [ ] **Step 3: Documentar no `CLAUDE.md` do `orcamento-dashboard`**

Seção nova, no mesmo estilo das outras seções datadas da página Planejamento Semanal
(ver o padrão de "Consolidado congelado..." já existente): resumir a mudança de
recálculo→snapshot real, apontar para o spec
(`docs/superpowers/specs/2026-08-31-consolidado-congelamento-sexta-e-resumo-design.md`),
e registrar a limitação aceita do Task 5 (Produtividade média/Equipe sem fallback de
recálculo — só mostram algo depois da 1ª sexta em que o job rodar).

- [ ] **Step 4: Commit**

```bash
git add tools/semanal/congelar-semanal.ps1 docs/setup-atualizacao-escalonada.md CLAUDE.md
git commit -m "docs: agenda o congelamento semanal de sexta 22h nas 3 maquinas"
```

---

## Task 8: Rebuild final, sincronizar `docs/`, publicar

**Files:**
- Modify: `docs/planejamento-semanal.html` (cópia byte a byte de `dist/`)

**Interfaces:**
- Consumes: `build-dashboard.js` (Task 6).
- Produces: nada — task de publicação, fecha a regra permanente do `CLAUDE.md` raiz
  ("sempre publicar depois de reconstruir").

- [ ] **Step 1: Rodar a suíte inteira**

Run: `node --test test/*.js`
Expected: PASS em tudo (nenhuma regressão em nenhum outro arquivo de teste da página
semanal — Alertas, Balanço, Alocação, etc. não foram tocados, mas todos importam módulos
que este plano mexeu).

- [ ] **Step 2: Build de produção**

Run: `ORCAMENTO_SENHA='<senha real>' node tools/semanal/build-dashboard.js`
Expected: gera `dist/planejamento-semanal.html` e `dist/alocacao-equipes.html` sem erro.

- [ ] **Step 3: Copiar para `docs/` (regra fixa do projeto)**

```bash
cp dist/planejamento-semanal.html docs/planejamento-semanal.html
cp dist/alocacao-equipes.html docs/alocacao-equipes.html
```

- [ ] **Step 4: Rodar o teste de sincronia**

Run: `node --test test/publicacao-docs-sincronizado.test.js`
Expected: PASS (os pares `dist/`↔`docs/` batem byte a byte)

- [ ] **Step 5: Commit e push**

```bash
git add dist/planejamento-semanal.html docs/planejamento-semanal.html dist/alocacao-equipes.html docs/alocacao-equipes.html
git commit -m "build: reconstroi Planejamento Semanal com o Consolidado novo (resumo + congelamento real)"
git push origin HEAD:master
```

(Regra permanente do `CLAUDE.md` raiz: toda reconstrução de dashboard é commitada **e
publicada** sem perguntar de novo, e sempre com `git push` junto — o workflow de Pages
publica a partir de `docs/**` em `master`.)

---

## Self-Review

**Cobertura do spec:**
- Decisão 1 (snapshot real, sextas 22h) → Tasks 1, 2, 7.
- Decisão 2 (fallback quando não há snapshot) → Task 4 (rótulo "recalculada").
- Decisão 3 (resumo substitui a tabela, blocos Produtividade média/Equipe) → Tasks 4, 5.
- Publicação/regra do projeto → Task 8.
- "Fora de escopo" do spec (alerta de falha do job, outras abas, outras dimensões) →
  nenhum task cobre de propósito, como o spec pede.

**Placeholders:** nenhum "TBD"/"implementar depois" — os únicos pontos deixados como
"levantamento" (Task 6, Step 1) são leitura de código existente antes de extrair, não
lacunas de decisão.

**Consistência de tipos:** `chaveSemanaAlvo`/`formatarChaveSemana` sempre `'YYYY-MM-DD'`;
`congeladoSemanal` sempre `{ [chave]: { geradoEm, porRegistro: { [chaveMatriz]: {
volume, financeiro, equipe, produtividadeMedia } } } }` do Task 1 ao Task 6, mesmo nome de
campo em todos os tasks que o tocam (`tendencia`, nunca `tendência`/`valor`/outro nome).
