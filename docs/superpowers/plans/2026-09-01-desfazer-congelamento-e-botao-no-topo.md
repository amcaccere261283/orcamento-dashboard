# Desfazer congelamento + botão no topo do Consolidado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover os botões de congelamento para dentro de `renderControles` (ao lado do seletor de semana, no topo da aba) e acrescentar um botão "Desfazer congelamento" que apaga de verdade a(s) linha(s) da semana em tela na Sheet, com o mesmo token e confirmação antes de executar.

**Architecture:** `apps-script-congelamento.gs` ganha uma terceira ação (`desfazer`) que apaga linhas por chave, sob a mesma trava da escrita. `congelamento-sheet.js` ganha um método espelhando `congelar`. `render-aba-consolidado.js` passa a emitir o markup estático dos botões dentro do bloco de controles que já existe. `render-semanal.js` para de duplicar esse bloco no fim da aba e liga o novo botão, calculando a segunda-feira da semana em tela para saber quais fragmentos apagar.

**Tech Stack:** Node puro (`node --test`, sem dependências), módulos duais Node+navegador em `var`/`function`, Google Apps Script.

Spec: `docs/superpowers/specs/2026-09-01-desfazer-congelamento-e-botao-no-topo-design.md`.

## Global Constraints

- Nenhuma dependência nova.
- Módulos duais Node+navegador (`congelamento-sheet.js`, `congelar-tendencia-semanal.js`, `render-aba-consolidado.js`, o script de cliente em `render-semanal.js`) em `var`/`function` no top-level exportado — nunca `const`/`let`/arrow. `apps-script-congelamento.gs` roda no Apps Script (ES5-ish), mesmo estilo.
- Nenhuma crase solta dentro de `SCRIPT_CLIENTE_SEMANAL` (`render-semanal.js`) — trunca o script do cliente inteiro em silêncio, vale para comentários também. Depois de editar esse template literal, rode `test/semanal-render-semanal-wireup.test.js` (executa o bundle inteiro num sandbox `vm`), não só o arquivo específico.
- `chaveMatriz`/tokens/segredos nunca em arquivo do repositório.
- `docs/planejamento-semanal.html`/`docs/alocacao-equipes.html` são cópias byte a byte de `dist/` — nunca `git checkout`/`restore` de só um dos dois.
- Todo teste que monta um sandbox de cliente (`vm.createContext`) precisa incluir `fetch` no objeto de contexto — o código de congelamento chama `window.fetch.bind(window)` incondicionalmente ao desbloquear, e um sandbox sem `fetch` lança `TypeError: Cannot read properties of undefined (reading 'bind')`.

---

## Task 1: `segundaDaSemana` — achar a segunda-feira de um fragmento truncado

**Files:**
- Modify: `tools/semanal/congelar-tendencia-semanal.js`
- Test: `test/semanal-congelar-tendencia.test.js`

**Interfaces:**
- Consumes: nada novo.
- Produces: `segundaDaSemana(diaEpoch)` → `'YYYY-MM-DD'` da segunda-feira da semana ISO que contém `diaEpoch` (anda pra TRÁS, incluindo o próprio dia se já for segunda). Exportada. Consumida pela Task 5.

- [ ] **Step 1: Escrever o teste nos sete dias da semana**

Acrescentar em `test/semanal-congelar-tendencia.test.js`:

```javascript
const { segundaDaSemana } = require('../tools/semanal/congelar-tendencia-semanal.js');

// Prova a invariância com proximaSegunda: uma anda pra FRENTE (estritamente
// depois de hoje), a outra pra TRÁS (incluindo o próprio dia). Nunca podem
// devolver o mesmo valor pro mesmo dia de entrada, exceto quando a entrada
// já é segunda -- aí proximaSegunda pula pra semana SEGUINTE e segundaDaSemana
// fica na mesma.
test('segundaDaSemana anda pra TRAS ate a segunda, incluindo o proprio dia quando ja e segunda', () => {
  const dia = (ano, mes1, d) => Date.UTC(ano, mes1 - 1, d) / 86400000;
  assert.equal(segundaDaSemana(dia(2026, 8, 31)), '2026-08-31'); // segunda -> ela mesma
  assert.equal(segundaDaSemana(dia(2026, 9, 1)), '2026-08-31');  // terça -> segunda anterior
  assert.equal(segundaDaSemana(dia(2026, 9, 2)), '2026-08-31');  // quarta
  assert.equal(segundaDaSemana(dia(2026, 9, 3)), '2026-08-31');  // quinta
  assert.equal(segundaDaSemana(dia(2026, 9, 4)), '2026-08-31');  // sexta
  assert.equal(segundaDaSemana(dia(2026, 9, 5)), '2026-08-31');  // sábado
  assert.equal(segundaDaSemana(dia(2026, 9, 6)), '2026-08-31');  // domingo
});

test('segundaDaSemana achando o inicio de um fragmento truncado (virada de mes) devolve a MESMA segunda que fragmentosDaSemanaAlvo espera', () => {
  // O fragmento de setembro da semana 31/08-06/09 começa em 2026-09-01 (terça,
  // não segunda) -- exatamente o caso que motivou esta função.
  const dia = Date.UTC(2026, 8, 1) / 86400000; // 2026-09-01
  assert.equal(segundaDaSemana(dia), '2026-08-31');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/semanal-congelar-tendencia.test.js`
Expected: FAIL — `segundaDaSemana` não exportada.

- [ ] **Step 3: Implementar `segundaDaSemana`**

Acrescentar em `tools/semanal/congelar-tendencia-semanal.js`, logo abaixo de `proximaSegunda` (a função já existe no arquivo, não a duplique — só adicione a nova ao lado):

```javascript
// dia-epoch -> 'YYYY-MM-DD' da segunda-feira da semana ISO que contém esse
// dia -- anda pra TRÁS, incluindo o próprio dia se já for segunda. Distinta
// de proximaSegunda, que anda pra FRENTE e nunca devolve o mesmo dia.
//
// Usada para achar a segunda-feira "verdadeira" de uma semana que, EM TELA,
// pode estar aparecendo como um fragmento truncado por cruzar virada de mês
// (semanaEscolhida.inicio nesse caso não é uma segunda) -- sem isso, desfazer
// o congelamento de um fragmento assim só acharia a chave do próprio
// fragmento, nunca o outro lado da mesma semana congelada.
function segundaDaSemana(diaEpoch) {
  var data = new Date(diaEpoch * 86400000);
  var diaSemana = data.getUTCDay(); // 0=domingo .. 6=sábado
  var voltar = (diaSemana + 6) % 7; // segunda=0, terça=1, ..., domingo=6
  return formatarDiaIso(diaEpoch - voltar);
}
```

Ajustar o `module.exports` no final do arquivo para incluir `segundaDaSemana`:

```javascript
module.exports = {
  proximaSegunda, formatarDiaIso, fragmentosDaSemanaAlvo, calcularSnapshotSemanaAlvo, segundaDaSemana,
};
```

- [ ] **Step 4: Rodar e confirmar os testes do arquivo passando**

Run: `node --test test/semanal-congelar-tendencia.test.js`
Expected: PASS (todos, incluindo os pré-existentes)

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/congelar-tendencia-semanal.js test/semanal-congelar-tendencia.test.js
git commit -m "feat: segundaDaSemana acha a segunda-feira de um fragmento truncado"
```

---

## Task 2: `apps-script-congelamento.gs` ganha `acao: 'desfazer'`

**Files:**
- Modify: `tools/semanal/apps-script-congelamento.gs`
- Test: `test/semanal-apps-script-congelamento.test.js`

**Interfaces:**
- Consumes: `abaCongelamento()`, `normalizarDia()`, `tokenValido()`, `resposta()`, `COL_SEMANA_INICIO` (já existem no arquivo).
- Produces: `doPost` aceita `{ token, acao: 'desfazer', chaves: [...] }` → `{ ok: true, apagadas: N }` ou `{ erro: 'token' }`. Consumida pela Task 3.

- [ ] **Step 1: Ler o estado atual do arquivo**

Não é step de teste — levantamento. Leia `tools/semanal/apps-script-congelamento.gs` inteiro (169 linhas) antes de editar. O `doPost` atual despacha por `corpo.acao === 'ler'` logo após validar o token, e cai no fluxo de escrita (com `LockService`) para qualquer outro valor de `acao` (hoje só `'congelar'` chega até ali). Você vai acrescentar um terceiro ramo, `'desfazer'`, ANTES do fluxo de escrita — mesma posição relativa que `'ler'` já ocupa.

- [ ] **Step 2: Escrever os testes com o Sheets dublê já existente**

Leia primeiro `criarSheetsDuble()`/`carregarScript()` no topo de `test/semanal-apps-script-congelamento.test.js` — reaproveite exatamente o mesmo dublê e a mesma forma de invocar `doPost`/`doGet`, não recrie. Depois, acrescente:

```javascript
test('doPost com acao desfazer apaga so as linhas das chaves pedidas', () => {
  const duble = criarSheetsDuble();
  const ctx = carregarScript(duble);
  // Duas semanas congeladas, uma linha cada.
  ctx.doPost({ postData: { contents: JSON.stringify({
    token: TOKEN_BOM, acao: 'congelar', chaveSegunda: '2026-08-31', autor: 'a', congeladoEm: 'x',
    linhas: [{ chave: '2026-08-31', chaveMatriz: 'SUP-1||SP', volume: 1, financeiro: 1, equipe: 1, produtividadeMedia: 1 }],
  }) } });
  ctx.doPost({ postData: { contents: JSON.stringify({
    token: TOKEN_BOM, acao: 'congelar', chaveSegunda: '2026-09-07', autor: 'a', congeladoEm: 'x',
    linhas: [{ chave: '2026-09-07', chaveMatriz: 'SUP-1||SP', volume: 2, financeiro: 2, equipe: 2, produtividadeMedia: 2 }],
  }) } });

  const resultado = corpoDe(ctx.doPost({ postData: { contents: JSON.stringify({
    token: TOKEN_BOM, acao: 'desfazer', chaves: ['2026-08-31'],
  }) } }));
  assert.equal(resultado.ok, true);
  assert.equal(resultado.apagadas, 1);

  // doGet nao le nada (so devolve {erro:'use-post'}) -- leitura e sempre via
  // doPost com acao 'ler', mesmo padrao que os testes de 'ler'/'congelar' ja
  // usam neste arquivo.
  const lida0831 = corpoDe(ctx.doPost({ postData: { contents: JSON.stringify({ token: TOKEN_BOM, acao: 'ler', semana: '2026-08-31' }) } }));
  const lida0907 = corpoDe(ctx.doPost({ postData: { contents: JSON.stringify({ token: TOKEN_BOM, acao: 'ler', semana: '2026-09-07' }) } }));
  assert.equal(lida0831.linhas.length, 0, 'a semana apagada nao pode mais aparecer');
  assert.equal(lida0907.linhas.length, 1, 'a semana NAO listada pra apagar continua intacta');
});

test('doPost com acao desfazer apaga os DOIS fragmentos de uma semana que cruza mes', () => {
  const duble = criarSheetsDuble();
  const ctx = carregarScript(duble);
  ctx.doPost({ postData: { contents: JSON.stringify({
    token: TOKEN_BOM, acao: 'congelar', chaveSegunda: '2026-08-31', autor: 'a', congeladoEm: 'x',
    linhas: [
      { chave: '2026-08-31', chaveMatriz: 'SUP-1||SP', volume: 1, financeiro: 1, equipe: 1, produtividadeMedia: 1 },
      { chave: '2026-09-01', chaveMatriz: 'SUP-1||SP', volume: 1, financeiro: 1, equipe: 1, produtividadeMedia: 1 },
    ],
  }) } });

  const resultado = corpoDe(ctx.doPost({ postData: { contents: JSON.stringify({
    token: TOKEN_BOM, acao: 'desfazer', chaves: ['2026-08-31', '2026-09-01'],
  }) } }));
  assert.equal(resultado.apagadas, 2);

  const lida = corpoDe(ctx.doPost({ postData: { contents: JSON.stringify({ token: TOKEN_BOM, acao: 'ler', semana: '2026-08-31' }) } }));
  assert.equal(lida.linhas.length, 0);
});

test('doPost com acao desfazer e token errado recusa sem apagar nada', () => {
  const duble = criarSheetsDuble();
  const ctx = carregarScript(duble);
  ctx.doPost({ postData: { contents: JSON.stringify({
    token: TOKEN_BOM, acao: 'congelar', chaveSegunda: '2026-08-31', autor: 'a', congeladoEm: 'x',
    linhas: [{ chave: '2026-08-31', chaveMatriz: 'SUP-1||SP', volume: 1, financeiro: 1, equipe: 1, produtividadeMedia: 1 }],
  }) } });

  const resultado = corpoDe(ctx.doPost({ postData: { contents: JSON.stringify({
    token: 'errado', acao: 'desfazer', chaves: ['2026-08-31'],
  }) } }));
  assert.equal(resultado.erro, 'token');

  const lida = corpoDe(ctx.doPost({ postData: { contents: JSON.stringify({ token: TOKEN_BOM, acao: 'ler', semana: '2026-08-31' }) } }));
  assert.equal(lida.linhas.length, 1, 'nada pode ter sido apagado com token errado');
});

test('doPost com acao desfazer e nenhuma linha encontrada devolve sucesso com apagadas 0, nao erro', () => {
  const duble = criarSheetsDuble();
  const ctx = carregarScript(duble);
  const resultado = corpoDe(ctx.doPost({ postData: { contents: JSON.stringify({
    token: TOKEN_BOM, acao: 'desfazer', chaves: ['2099-01-01'],
  }) } }));
  assert.equal(resultado.ok, true);
  assert.equal(resultado.apagadas, 0);
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test test/semanal-apps-script-congelamento.test.js`
Expected: FAIL — `doPost` não reconhece `acao: 'desfazer'`.

- [ ] **Step 4: Implementar o ramo `desfazer`**

Em `tools/semanal/apps-script-congelamento.gs`, dentro de `doPost`, logo depois do bloco `if (corpo.acao === 'ler') return resposta({ linhas: linhasDaSemana(corpo.semana) });` e ANTES de `var trava = LockService.getScriptLock();` do fluxo de escrita:

```javascript
if (corpo.acao === 'desfazer') {
  var travaDesfazer = LockService.getScriptLock();
  travaDesfazer.waitLock(30000);
  try {
    var chavesApagar = {};
    (corpo.chaves || []).forEach(function (c) { chavesApagar[String(c)] = true; });
    var abaDesfazer = abaCongelamento();
    var dadosDesfazer = abaDesfazer.getDataRange().getValues();
    var linhasParaApagar = [];
    for (var j = 1; j < dadosDesfazer.length; j++) {
      if (chavesApagar[normalizarDia(dadosDesfazer[j][COL_SEMANA_INICIO - 1])]) linhasParaApagar.push(j + 1);
    }
    // De trás pra frente: apagar de cima pra baixo desloca o índice das
    // linhas seguintes, e o próximo deleteRow erraria a linha.
    linhasParaApagar.sort(function (a, b) { return b - a; })
      .forEach(function (linha) { abaDesfazer.deleteRow(linha); });
    return resposta({ ok: true, apagadas: linhasParaApagar.length });
  } finally {
    travaDesfazer.releaseLock();
  }
}
```

Nomeie a trava/variáveis locais deste bloco de forma distinta das do bloco de escrita (`travaDesfazer`, `abaDesfazer`, `dadosDesfazer` em vez de `trava`/`aba`/`dados`) — os dois blocos são `if` irmãos dentro da mesma função, e reusar o mesmo nome de `var` dentro de uma função JS não dá erro, mas confunde quem ler depois qual bloco está em qual escopo.

- [ ] **Step 5: Rodar e confirmar os 4 testes novos passando**

Run: `node --test test/semanal-apps-script-congelamento.test.js`
Expected: PASS (todos, incluindo os pré-existentes — nenhuma regressão nos ramos `ler`/`congelar`)

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/apps-script-congelamento.gs test/semanal-apps-script-congelamento.test.js
git commit -m "feat: Apps Script ganha acao desfazer (apaga linhas por chave, mesma trava da escrita)"
```

---

## Task 3: `congelamento-sheet.js` ganha `desfazer(chaves)`

**Files:**
- Modify: `tools/semanal/congelamento-sheet.js`
- Test: `test/semanal-congelamento-sheet.test.js`

**Interfaces:**
- Consumes: o contrato HTTP da Task 2 (`{ token, acao: 'desfazer', chaves }` → `{ ok: true, apagadas: N }` ou `{ erro: 'token' }`).
- Produces: `criarClienteCongelamento({...}).desfazer(chaves)` → `{ ok: true, apagadas: N }` ou `{ ok: false, motivo: 'token'|'rede' }`, nunca lança. Consumida pela Task 5.

- [ ] **Step 1: Escrever o teste com `fetch` dublê**

Leia primeiro os testes existentes de `congelar`/`carregar` em `test/semanal-congelamento-sheet.test.js` para reaproveitar o `fetchDuble` já definido lá — não recrie. Depois:

```javascript
test('desfazer manda token, acao e as chaves no corpo', async () => {
  const d = fetchDuble([{ ok: true, apagadas: 2 }]);
  const cliente = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: d.fetch, token: 'tok' });
  const r = await cliente.desfazer(['2026-08-31', '2026-09-01']);
  assert.equal(r.ok, true);
  assert.equal(r.apagadas, 2);
  const corpo = JSON.parse(d.chamadas[0].opcoes.body);
  assert.equal(corpo.token, 'tok');
  assert.equal(corpo.acao, 'desfazer');
  assert.deepEqual(corpo.chaves, ['2026-08-31', '2026-09-01']);
});

test('desfazer degrada pra {ok:false, motivo} em erro de token, sem lancar', async () => {
  const d = fetchDuble([{ erro: 'token' }]);
  const cliente = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: d.fetch, token: 'ruim' });
  const r = await cliente.desfazer(['2026-08-31']);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'token');
});

test('desfazer degrada pra {ok:false, motivo:"rede"} quando o fetch lanca, sem lancar', async () => {
  const cliente = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: fetchDuble([new Error('offline')]).fetch, token: 'tok' });
  const r = await cliente.desfazer(['2026-08-31']);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'rede');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/semanal-congelamento-sheet.test.js`
Expected: FAIL — `desfazer` não existe no objeto devolvido por `criarClienteCongelamento`.

- [ ] **Step 3: Implementar `desfazer`**

Em `tools/semanal/congelamento-sheet.js`, dentro do objeto devolvido por `criarClienteCongelamento` (ao lado de `carregar`/`congelar`, mesmo nível de indentação):

```javascript
    desfazer: async function (chaves) {
      if (!url || !buscar) return { ok: false, motivo: 'rede' };
      try {
        var resposta = await buscar(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ token: token, acao: 'desfazer', chaves: chaves }),
        });
        var corpo = await resposta.json();
        if (corpo && corpo.ok) return { ok: true, apagadas: corpo.apagadas };
        return { ok: false, motivo: (corpo && corpo.erro) || 'rede' };
      } catch (err) {
        return { ok: false, motivo: 'rede' };
      }
    },
```

- [ ] **Step 4: Rodar e confirmar os 3 testes novos passando**

Run: `node --test test/semanal-congelamento-sheet.test.js`
Expected: PASS (todos, incluindo os pré-existentes de `carregar`/`congelar`)

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/congelamento-sheet.js test/semanal-congelamento-sheet.test.js
git commit -m "feat: cliente do congelamento ganha desfazer(chaves), espelhando congelar"
```

---

## Task 4: Botões migram para dentro de `renderControles`

**Files:**
- Modify: `tools/semanal/render-aba-consolidado.js`
- Test: `test/semanal-render-aba-consolidado.test.js`

**Interfaces:**
- Consumes: nada novo — só reorganiza markup estático.
- Produces: `renderControles` passa a incluir, no MESMO `<div class="controles-consolidado">` que já tem o seletor de semana e "Gerar relatório Excel", os elementos `#btn-congelar-semana`, `#status-congelamento`, `#status-congelamento-leitura`, `#btn-desfazer-congelamento` (nasce com `style="display:none"`), `#status-desfazer`. Nenhum `id` novo é inventado — os quatro primeiros já existem hoje em `render-semanal.js` e são só realocados; `btn-desfazer-congelamento`/`status-desfazer` são os únicos novos. Consumida pela Task 5.

- [ ] **Step 1: Ler o estado atual de `renderControles`**

Não é step de teste — levantamento. `renderControles` (`tools/semanal/render-aba-consolidado.js:502-514`) hoje devolve:

```javascript
function renderControles(estado) {
  var e = estado || {};
  var semanas = e.semanas || [];
  var opcoesSemana = semanas.map(function (semana, i) {
    return '<option value="' + i + '"' + (i === e.semanaIdx ? ' selected' : '') + '>'
      + escapeHtml('S' + (i + 1) + ' (' + formatarIntervaloSemana(semana.inicio, semana.fim) + ')') + '</option>';
  }).join('');
  return '<div class="controles-consolidado">'
    + '<label class="controle-consolidado">Semana<select id="consolidado-semana">' + opcoesSemana + '</select></label>'
    + '<button id="gerar-relatorio-excel" type="button">Gerar relatório Excel</button>'
    + '<span id="status-relatorio-excel" class="status-atualizacao"></span>'
    + '</div>';
}
```

- [ ] **Step 2: Escrever o teste do markup novo**

Leia primeiro os testes existentes que já verificam `renderControles`/o `<select id="consolidado-semana">` em `test/semanal-render-aba-consolidado.test.js`, para não duplicar fixture. Depois:

```javascript
test('renderControles inclui os botoes de congelamento e desfazer no MESMO bloco do seletor de semana', () => {
  const html = renderControles({ semanas: SEMANAS, semanaIdx: 0 });
  // Um SÓ <div class="controles-consolidado"> -- prova que não sobrou um
  // segundo bloco em outro lugar (o que render-semanal.js concatenava antes).
  const blocos = html.match(/<div class="controles-consolidado">/g) || [];
  assert.equal(blocos.length, 1);
  assert.match(html, /<select id="consolidado-semana">/);
  assert.match(html, /<button id="btn-congelar-semana"/);
  assert.match(html, /<span id="status-congelamento"/);
  assert.match(html, /<span id="status-congelamento-leitura"/);
  assert.match(html, /<button id="btn-desfazer-congelamento"[^>]*style="display:none"/);
  assert.match(html, /<span id="status-desfazer"/);
});

test('btn-congelar-semana nasce desabilitado e com o texto Verificando, igual antes', () => {
  const html = renderControles({ semanas: SEMANAS, semanaIdx: 0 });
  assert.match(html, /<button id="btn-congelar-semana" class="btn-secundario" disabled>Verificando…<\/button>/);
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test test/semanal-render-aba-consolidado.test.js`
Expected: FAIL — os botões novos não existem em `renderControles` ainda.

- [ ] **Step 4: Mover o markup pra dentro de `renderControles`**

Reescrever `renderControles`:

```javascript
function renderControles(estado) {
  var e = estado || {};
  var semanas = e.semanas || [];
  var opcoesSemana = semanas.map(function (semana, i) {
    return '<option value="' + i + '"' + (i === e.semanaIdx ? ' selected' : '') + '>'
      + escapeHtml('S' + (i + 1) + ' (' + formatarIntervaloSemana(semana.inicio, semana.fim) + ')') + '</option>';
  }).join('');
  return '<div class="controles-consolidado">'
    + '<label class="controle-consolidado">Semana<select id="consolidado-semana">' + opcoesSemana + '</select></label>'
    + '<button id="gerar-relatorio-excel" type="button">Gerar relatório Excel</button>'
    + '<span id="status-relatorio-excel" class="status-atualizacao"></span>'
    // Congelamento (Task 8 do plano anterior) e Desfazer (este plano) --
    // markup ESTÁTICO só; render-semanal.js religa comportamento por id, não
    // por posição no DOM, então mover pra cá não muda nenhuma lógica de
    // habilitar/desabilitar/clique.
    + '<button id="btn-congelar-semana" class="btn-secundario" disabled>Verificando…</button>'
    + '<span id="status-congelamento" class="nota-inline"></span>'
    + '<span id="status-congelamento-leitura" class="nota-inline"></span>'
    // display:none no nascimento -- só o client script decide quando mostrar
    // (semana em tela tem congelado), então sem JavaScub o botão de exclusão
    // permanente nunca aparece sem função.
    + '<button id="btn-desfazer-congelamento" class="btn-secundario" style="display:none">Desfazer congelamento</button>'
    + '<span id="status-desfazer" class="nota-inline"></span>'
    + '</div>';
}
```

- [ ] **Step 5: Rodar e confirmar os 2 testes novos passando**

Run: `node --test test/semanal-render-aba-consolidado.test.js`
Expected: PASS (todos, incluindo os pré-existentes)

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/render-aba-consolidado.js test/semanal-render-aba-consolidado.test.js
git commit -m "feat: botoes de congelamento migram pra dentro de renderControles, ao lado do seletor de semana"
```

---

## Task 5: `render-semanal.js` para de duplicar o bloco e liga "Desfazer"

**Files:**
- Modify: `tools/semanal/render-semanal.js`
- Test: `test/semanal-render-semanal-wireup.test.js`

**Interfaces:**
- Consumes: `segundaDaSemana`, `fragmentosDaSemanaAlvo` (`CongelarTendenciaSemanal`, Task 1 — já no bundle via `BUNDLE_ARQUIVOS`, confirme); `CongelamentoSheet.criarClienteCongelamento(...).desfazer(chaves)` (Task 3); markup de `renderControles` (Task 4, já sem o segundo `<div class="controles-consolidado">` que este arquivo emitia).
- Produces: `desfazerCongelamentoDaSemana()` (função de cliente, ligada ao clique de `#btn-desfazer-congelamento`); `montarAbaConsolidado` para de concatenar o bloco de controles duplicado e passa a decidir a visibilidade do botão de desfazer.

- [ ] **Step 1: Remover a concatenação duplicada em `montarAbaConsolidado`**

Em `tools/semanal/render-semanal.js`, dentro de `montarAbaConsolidado` (por volta da linha 1808-1828), o `document.getElementById('secao-consolidado').innerHTML = ...` termina hoje em:

```javascript
  })
    + '<div class="controles-consolidado">'
    + '<button id="btn-congelar-semana" class="btn-secundario" disabled>Verificando…</button>'
    + '<span id="status-congelamento" class="nota-inline"></span>'
    + '<span id="status-congelamento-leitura" class="nota-inline"></span>'
    + '</div>';
```

Remover a concatenação inteira (o `+ '<div class="controles-consolidado">' ... + '</div>';`), deixando só:

```javascript
  document.getElementById('secao-consolidado').innerHTML = RenderAbaConsolidado.renderAbaConsolidado(registros, indicesAba, {
    /* ...opções sem mudança... */
  });
```

Os elementos (`btn-congelar-semana`, `status-congelamento`, `status-congelamento-leitura`) já vêm dentro do HTML de `RenderAbaConsolidado.renderAbaConsolidado(...)`, porque `renderAbaConsolidado` chama `renderControles` internamente (confirme isso lendo `render-aba-consolidado.js:558-580` antes de prosseguir — a Task 4 não mudou ONDE `renderControles` é chamada, só o que ela devolve).

- [ ] **Step 2: Escrever o teste do botão de desfazer aparecendo/escondendo**

Leia primeiro `montarSandbox`/os testes existentes de congelamento em `test/semanal-render-semanal-wireup.test.js` (procure `btn-congelar-semana`) para reaproveitar o padrão de fixture — não recrie do zero.

```javascript
test('com a semana em tela JA congelada, btn-desfazer-congelamento aparece visivel e habilitado', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const fetchMock = async (url, opcoes) => {
    const corpo = opcoes && opcoes.body ? JSON.parse(opcoes.body) : {};
    if (corpo.acao === 'ler') {
      return { ok: true, json: async () => ({ linhas: [
        { chaveMatriz: 'SUP-0001-24||SP', volume: 10, financeiro: 10, equipe: 1, produtividadeMedia: 10, autor: 'ana', congeladoEm: '2026-08-28T22:00:00Z' },
      ] }) };
    }
    return { ok: true, json: async () => ({}) };
  };
  const html = renderSemanal({
    registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z'),
  });
  const { sandbox, documentoFalso } = montarSandbox(html, fetchMock);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();
  await new Promise((r) => setTimeout(r, 0)); // deixa o fetch assincrono de carregarCongeladoDaSemana resolver

  const btnDesfazer = documentoFalso.getElementById('btn-desfazer-congelamento');
  assert.notEqual(btnDesfazer.style.display, 'none');
  assert.equal(btnDesfazer.disabled, false);
});

test('sem congelado na semana em tela, btn-desfazer-congelamento fica escondido', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const fetchMock = async () => ({ ok: true, json: async () => ({ linhas: [] }) });
  const html = renderSemanal({
    registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z'),
  });
  const { sandbox, documentoFalso } = montarSandbox(html, fetchMock);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();
  await new Promise((r) => setTimeout(r, 0));

  const btnDesfazer = documentoFalso.getElementById('btn-desfazer-congelamento');
  assert.equal(btnDesfazer.style.display, 'none');
});

test('clique em desfazer com confirm cancelado NAO manda requisicao', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  let chamadasDesfazer = 0;
  const fetchMock = async (url, opcoes) => {
    const corpo = opcoes && opcoes.body ? JSON.parse(opcoes.body) : {};
    if (corpo.acao === 'ler') return { ok: true, json: async () => ({ linhas: [
      { chaveMatriz: 'SUP-0001-24||SP', volume: 10, financeiro: 10, equipe: 1, produtividadeMedia: 10, autor: 'ana', congeladoEm: '2026-08-28T22:00:00Z' },
    ] }) };
    if (corpo.acao === 'desfazer') chamadasDesfazer++;
    return { ok: true, json: async () => ({ ok: true, apagadas: 1 }) };
  };
  const html = renderSemanal({
    registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z'),
  });
  const { sandbox, documentoFalso } = montarSandbox(html, fetchMock);
  sandbox.confirm = () => false; // usuário cancela
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();
  await new Promise((r) => setTimeout(r, 0));

  await sandbox.desfazerCongelamentoDaSemana();
  assert.equal(chamadasDesfazer, 0, 'confirm cancelado nao pode chegar a mandar a requisicao de desfazer');
});

test('desfazer com sucesso redesenha a aba: rotulo volta a recalculada e o botao some', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  let jaDesfeito = false;
  const fetchMock = async (url, opcoes) => {
    const corpo = opcoes && opcoes.body ? JSON.parse(opcoes.body) : {};
    if (corpo.acao === 'ler') {
      return { ok: true, json: async () => (jaDesfeito ? { linhas: [] } : { linhas: [
        { chaveMatriz: 'SUP-0001-24||SP', volume: 10, financeiro: 10, equipe: 1, produtividadeMedia: 10, autor: 'ana', congeladoEm: '2026-08-28T22:00:00Z' },
      ] }) };
    }
    if (corpo.acao === 'desfazer') { jaDesfeito = true; return { ok: true, json: async () => ({ ok: true, apagadas: 1 }) }; }
    return { ok: true, json: async () => ({}) };
  };
  const html = renderSemanal({
    registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z'),
  });
  const { sandbox, documentoFalso } = montarSandbox(html, fetchMock);
  sandbox.confirm = () => true; // usuário confirma
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();
  await new Promise((r) => setTimeout(r, 0));

  await sandbox.desfazerCongelamentoDaSemana();
  await new Promise((r) => setTimeout(r, 0));

  const btnDesfazer = documentoFalso.getElementById('btn-desfazer-congelamento');
  assert.equal(btnDesfazer.style.display, 'none', 'sem congelado, o botao de desfazer some de novo');
});

test('desfazerCongelamentoDaSemana calcula as chaves com segundaDaSemana + fragmentosDaSemanaAlvo da semana EM TELA', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  let chavesRecebidas = null;
  const fetchMock = async (url, opcoes) => {
    const corpo = opcoes && opcoes.body ? JSON.parse(opcoes.body) : {};
    if (corpo.acao === 'ler') return { ok: true, json: async () => ({ linhas: [
      { chaveMatriz: 'SUP-0001-24||SP', volume: 10, financeiro: 10, equipe: 1, produtividadeMedia: 10, autor: 'ana', congeladoEm: '2026-08-28T22:00:00Z' },
    ] }) };
    if (corpo.acao === 'desfazer') chavesRecebidas = corpo.chaves;
    return { ok: true, json: async () => ({ ok: true, apagadas: 1 }) };
  };
  const html = renderSemanal({
    registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z'),
  });
  const { sandbox, documentoFalso } = montarSandbox(html, fetchMock);
  sandbox.confirm = () => true;
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();
  await new Promise((r) => setTimeout(r, 0));

  await sandbox.desfazerCongelamentoDaSemana();
  assert.ok(Array.isArray(chavesRecebidas) && chavesRecebidas.length >= 1,
    'as chaves mandadas pro Apps Script precisam vir de fragmentosDaSemanaAlvo(segundaDaSemana(semana em tela))');
});
```

**Nota para quem implementar:** os testes acima assumem que `montarSandbox(html, fetchMock)` já aceita um `fetchMock` (o arquivo já tem esse parâmetro, usado pelos testes do botão de congelar — confirme lendo a assinatura antes de escrever). Se o `documentoFalso`/sandbox não expuser `confirm` como algo sobrescrevível, verifique como `window.confirm` chega ao sandbox (pode precisar adicionar `confirm: () => true` como default no objeto de contexto do `montarSandbox`, e os testes acima sobrescrevem depois via `sandbox.confirm = ...`) — ajuste o helper se for o caso, é infraestrutura de teste, não comportamento de produto.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/semanal-render-semanal-wireup.test.js`
Expected: FAIL — `desfazerCongelamentoDaSemana` não existe, `btn-desfazer-congelamento` nunca aparece.

- [ ] **Step 3: Implementar `desfazerCongelamentoDaSemana` e ligar a visibilidade**

Em `tools/semanal/render-semanal.js`, perto de `congelarProximaSemana` (mesma região do arquivo):

```javascript
// Mostra/esconde btn-desfazer-congelamento com base no que
// carregarCongeladoDaSemana JÁ buscou pra semana em tela -- nenhuma chamada
// nova ao Apps Script, é a mesma resposta que decide "(congelada)"/
// "(recalculada)" lida de outro ângulo.
function atualizarBotaoDesfazer(chaveSemanaEmTela) {
  var botao = document.getElementById('btn-desfazer-congelamento');
  var status = document.getElementById('status-desfazer');
  if (!botao) return;
  var temCongelado = ESTADO_CONGELAMENTO.chave === chaveSemanaEmTela && !!ESTADO_CONGELAMENTO.congelado;
  if (!temCongelado) {
    botao.style.display = 'none';
    status.textContent = '';
    return;
  }
  botao.style.display = '';
  botao.disabled = false;
  botao.textContent = 'Desfazer congelamento da semana de ' + formatarDiaCurto(chaveSemanaEmTela);
}

async function desfazerCongelamentoDaSemana() {
  var chaveSemanaEmTela = ESTADO_CONGELAMENTO.chave;
  if (!chaveSemanaEmTela) return;
  var confirmado = window.confirm(
    'Desfazer o congelamento da semana de ' + formatarDiaCurto(chaveSemanaEmTela)
    + '? Esta ação não pode ser desfeita.'
  );
  if (!confirmado) return;

  var botao = document.getElementById('btn-desfazer-congelamento');
  var status = document.getElementById('status-desfazer');
  botao.disabled = true;
  status.textContent = 'Desfazendo…';
  try {
    // A semana EM TELA pode ela mesma ser um fragmento truncado (cruza
    // virada de mês) -- segundaDaSemana acha a segunda-feira de verdade
    // antes de recalcular os fragmentos, senão só o próprio fragmento seria
    // apagado, deixando o outro lado órfão na planilha.
    var partesChave = chaveSemanaEmTela.split('-').map(Number);
    var epochChave = Date.UTC(partesChave[0], partesChave[1] - 1, partesChave[2]) / 86400000;
    var segunda = CongelarTendenciaSemanal.segundaDaSemana(epochChave);
    var fragmentos = CongelarTendenciaSemanal.fragmentosDaSemanaAlvo(segunda);
    var chaves = fragmentos.map(function (f) { return f.chave; });

    var r = await clienteCongelamento().desfazer(chaves);
    if (r.ok) {
      ESTADO_CONGELAMENTO.congelado = null;
      ESTADO_CONGELAMENTO.erro = null;
      status.textContent = '';
      // Redesenha a aba pra refletir o estado novo -- rótulo volta a
      // "(recalculada)", totais recalculam, este botão some.
      if (typeof window.__REDESENHAR_CONSOLIDADO__ === 'function') window.__REDESENHAR_CONSOLIDADO__();
      return;
    }
    status.textContent = r.motivo === 'token'
      ? 'Acesso recusado pela planilha (token). Confira o token nas Script Properties.'
      : 'Não foi possível desfazer (rede ou planilha fora do ar). Tente de novo.';
    botao.disabled = false;
  } catch (err) {
    status.textContent = 'Erro ao desfazer: ' + err.message;
    botao.disabled = false;
  }
}
```

`window.__REDESENHAR_CONSOLIDADO__` precisa apontar para uma função que redesenha `#secao-consolidado` com os mesmos argumentos (`registros`, `indices`, `dimensoes`) que `montarAbaConsolidado` já recebeu da última vez — dentro de `montarAbaConsolidado`, logo antes do `return` (ou no ponto em que a função termina), acrescente:

```javascript
  window.__REDESENHAR_CONSOLIDADO__ = function () { montarAbaConsolidado(registros, indices, dimensoes); };
```

E, no mesmo bloco onde `botaoCongelar`/`atualizarBotaoCongelar()` já são ligados (perto do fim de `montarAbaConsolidado`), acrescente:

```javascript
  var botaoDesfazer = document.getElementById('btn-desfazer-congelamento');
  if (botaoDesfazer) botaoDesfazer.addEventListener('click', desfazerCongelamentoDaSemana);
  atualizarBotaoDesfazer(chaveSemanaEscolhida);
```

E dentro do `.then()` de `carregarCongeladoDaSemana(...)` (que já redesenha a aba via `montarAbaConsolidado(registros, indices, dimensoes)`), nenhuma mudança adicional é necessária — o redesenho já chama `montarAbaConsolidado` de novo, que já religa `atualizarBotaoDesfazer` com o estado atualizado.

- [ ] **Step 4: Rodar e confirmar os 5 testes novos passando**

Run: `node --test test/semanal-render-semanal-wireup.test.js`
Expected: PASS (todos, incluindo os pré-existentes — nenhuma regressão nos testes do botão de congelar)

- [ ] **Step 5: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: nenhuma falha NOVA. As falhas pré-existentes e não relacionadas (deriva de coluna do CSV real em `semanal-demandas-planilha-real.test.js`, e a contagem de tipos de ensaio em `comum-tipologias-lab.test.js` desatualizada por commits upstream) continuam lá — não são suas, não conserte.

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/render-semanal.js test/semanal-render-semanal-wireup.test.js
git commit -m "feat: botao de desfazer congelamento, ligado a segundaDaSemana + fragmentosDaSemanaAlvo da semana em tela"
```

---

## Task 6: Reconstruir e publicar

**Files:**
- Modify: `dist/planejamento-semanal.html`, `docs/planejamento-semanal.html`, `dist/alocacao-equipes.html`, `docs/alocacao-equipes.html`

**Interfaces:** nenhuma — publicação.

- [ ] **Step 1: Suíte inteira**

Run: `node --test test/*.test.js`
Expected: só as falhas pré-existentes conhecidas (ver Task 5, Step 5).

- [ ] **Step 2: Rebase antes de publicar**

```bash
git fetch origin master
git log --oneline HEAD..origin/master   # se houver commits, rebase
git rebase origin/master
```

`origin/master` tem uma segunda frente ativa (outra pessoa/automação empurra dados no mesmo branch). Nos arquivos compartilhados o upstream ganha; **nunca** force push. Se o rebase trouxer commits que mudaram `test/fixtures/orcamento-golden.html`-adjacent files (ex.: mapeamentos de tipologia), reconfira a suíte depois do rebase — já aconteceu neste projeto de um rebase introduzir falhas de golden desatualizado que precisam de regeneração deliberada (ver histórico de commits `test: regenera o golden do orcamento`).

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
git commit -m "build: publica o botao de desfazer congelamento + controles no topo do Consolidado"
git push origin HEAD:master
```

- [ ] **Step 7: Verificar AO VIVO pelo conteúdo, não pelo status da API**

```bash
curl -s https://amcaccere261283.github.io/orcamento-dashboard/planejamento-semanal.html | tr -d '\r' | md5sum
tr -d '\r' < docs/planejamento-semanal.html | md5sum
```

Os dois hashes têm de bater.

- [ ] **Step 8: Teste manual de ponta a ponta na página publicada**

Não é possível testar clique de verdade em produção sem gastar um congelamento real — em vez disso, confirme visualmente: abrir a página, desbloquear, ir no Consolidado, e checar que os botões "Congelar semana de..." e (se a semana em tela tiver congelado) "Desfazer congelamento..." aparecem AO LADO do seletor de semana, não mais depois das tabelas.

---

## Self-Review

**Cobertura do spec:**
- Decisão 1 (apaga a linha de verdade) → Task 2.
- Decisão 2 (mesmo token) → Task 2 (mesma `tokenValido()`), Task 3.
- Decisão 3 (qualquer semana em tela) → Task 5 (`ESTADO_CONGELAMENTO.chave`, não a semana-alvo do congelamento).
- Decisão 4 (confirmação) → Task 5 (`window.confirm`).
- Decisão 5 (ao lado do seletor de semana) → Task 4.
- Armadilha do fragmento truncado (`segundaDaSemana`) → Task 1, consumida na Task 5.
- Testes exigidos pelo spec → Tasks 1, 2, 3, 4, 5.

**Placeholders:** nenhum "TBD"/"implementar depois". O Step 1 da Task 2 e o Step 1 da Task 4/5 são levantamento explícito antes de editar, não lacuna de decisão — o comportamento exigido já está escrito nos testes de cada task.

**Consistência de tipos:** `chaves` é sempre array de string `'YYYY-MM-DD'` (o mesmo formato de `linha.chave` que `calcularSnapshotSemanaAlvo` já produz) do Apps Script (Task 2) ao cliente (Task 3) ao botão (Task 5). `desfazer(chaves)` devolve `{ok, apagadas}` em sucesso e `{ok:false, motivo}` em falha — mesmo formato de `congelar`, nunca lança, consistente nas 3 tasks que o tocam.
