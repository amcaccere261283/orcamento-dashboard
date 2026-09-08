# Congelamento vira toggle on/off por semana — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o congelamento write-once do Consolidado (Planejamento Semanal) por um toggle on/off por semana: travada = "Atualizar dados" não mexe; aberta = "Atualizar dados" recalcula e grava a linha de base daquela semana.

**Architecture:** Uma nova aba `CongelamentoEstado` na mesma Google Sheet guarda o estado (travada/aberta) por semana, separada dos pontos (`Congelamento`). O Apps Script ganha `travar`/`destravar` e `congelar` deixa de recusar reclique — passa a checar o estado antes de sobrescrever. No cliente, os dois botões atuais viram um switch único, e "Atualizar dados" ganha um callback opcional que atualiza a linha de base da semana em tela quando ela não está travada.

**Tech Stack:** Apps Script (`.gs`, testado via porte para `vm` puro Node), JS de cliente `var`/`function` (entra em bundle de navegador via template literal), Node --test.

## Global Constraints

- Nenhum segredo em arquivo do repositório — token continua derivado da senha (`derivarTokenSheet`), sem mudança.
- Datas gravadas na Sheet são sempre TEXTO puro (`setNumberFormat('@')`), nunca Date — mesma armadilha de coerção documentada no `.gs` atual.
- Todo teste roda com `node --test test/*.test.js`, sem dependências externas.
- Depois do build, **sempre** `cp dist/planejamento-semanal.html docs/planejamento-semanal.html` (e `dist/alocacao-equipes.html`/`docs/` junto, mesmo par de sempre) antes de commitar, e publicar com `git push origin master` — regra permanente do projeto (ver `CLAUDE.md`).
- A aba Alocação Equipes (`render-alocacao-pagina.js`) não tem Consolidado e não é tocada por este plano.

---

### Task 1: Apps Script — aba `CongelamentoEstado`, ações `travar`/`destravar`, `congelar` vira upsert condicionado ao estado

**Files:**
- Modify: `tools/semanal/apps-script-congelamento.gs`
- Test: `test/semanal-apps-script-congelamento.test.js`

**Interfaces:**
- Consumes: nada de tarefas anteriores (primeira tarefa).
- Produces: contrato HTTP do Web App usado pela Task 2:
  - `doPost({acao:'ler', token, semana, chaveSegunda, chavesFragmentos})` → `{linhas: [...], estado: {travada, autor, atualizadoEm}}` ou `{erro:'token'}`.
  - `doPost({acao:'travar', token, chaveSegunda, autor, travadoEm, linhas?})` → `{ok:true, gravadas}` ou `{erro:'token'}`.
  - `doPost({acao:'destravar', token, chaveSegunda, autor, destravadoEm})` → `{ok:true}` ou `{erro:'token'}`.
  - `doPost({acao:'congelar', token, chaveSegunda, autor, congeladoEm, linhas})` → `{ok:true, gravadas}` ou `{erro:'travada', autor, atualizadoEm}` ou `{erro:'token'}`.
  - `doPost({acao:'desfazer', token, chaves})` → inalterado (mantido como mecanismo manual, sem UI).

- [ ] **Step 1: Escrever os testes que falham para a leitura de estado (fallback de compatibilidade e leitura de linha existente)**

Adicionar ao final de `test/semanal-apps-script-congelamento.test.js` (antes da última chave do arquivo, reaproveitando `criarSheetsDuble`/`carregarScript`/`corpoDe`/`ler` já definidos no topo — `criarSheetsDuble` precisa ganhar uma segunda aba fake; ver Step 2 para o motivo):

```javascript
test('ler devolve estado.travada=false por padrao para semana nunca tocada', () => {
  const ctx = carregarScript(criarSheetsDuble());
  const lido = ler(ctx, '2026-08-31', TOKEN_BOM);
  assert.deepEqual(lido.estado, { travada: false, autor: '', atualizadoEm: '' });
});

test('compatibilidade: semana com pontos gravados mas SEM linha em CongelamentoEstado (mecanismo antigo) le como travada=true', () => {
  const duble = criarSheetsDuble();
  const ctx = carregarScript(duble);
  // Simula uma gravacao feita pelo mecanismo write-once antigo: pontos
  // existem, CongelamentoEstado nunca foi escrita (aba nova, criada vazia
  // neste deploy). O primeiro "Atualizar dados" depois do deploy nao pode
  // sobrescrever isso em silencio.
  ctx.doPost({ postData: { contents: JSON.stringify({
    acao: 'congelar', token: TOKEN_BOM, chaveSegunda: '2026-08-31', autor: 'antigo', congeladoEm: 'x',
    linhas: [{ chave: '2026-08-31', chaveMatriz: 'SUP-1||SP', volume: 1, financeiro: 1, equipe: 1, produtividadeMedia: 1 }],
  }) } });
  const lido = ler(ctx, '2026-08-31', TOKEN_BOM);
  assert.equal(lido.estado.travada, true, 'sem linha de estado, pontos existentes têm de ser tratados como travados');
});

test('ler com chavesFragmentos verifica pontos nos DOIS fragmentos de uma semana que cruza mes', () => {
  const duble = criarSheetsDuble();
  const ctx = carregarScript(duble);
  ctx.doPost({ postData: { contents: JSON.stringify({
    acao: 'congelar', token: TOKEN_BOM, chaveSegunda: '2026-08-31', autor: 'antigo', congeladoEm: 'x',
    linhas: [{ chave: '2026-09-01', chaveMatriz: 'SUP-1||SP', volume: 1, financeiro: 1, equipe: 1, produtividadeMedia: 1 }],
  }) } });
  // A leitura em tela e do PRIMEIRO fragmento (sem ponto nenhum ali), mas
  // chavesFragmentos avisa que o SEGUNDO tem ponto -- tem de achar mesmo assim.
  const resultado = corpoDe(ctx.doPost({ postData: { contents: JSON.stringify({
    acao: 'ler', token: TOKEN_BOM, semana: '2026-08-31', chaveSegunda: '2026-08-31',
    chavesFragmentos: ['2026-08-31', '2026-09-01'],
  }) } }));
  assert.equal(resultado.linhas.length, 0, 'a leitura de pontos continua sendo so do fragmento em tela');
  assert.equal(resultado.estado.travada, true, 'mas a checagem de compatibilidade olha TODOS os fragmentos');
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node --test test/semanal-apps-script-congelamento.test.js`
Expected: FAIL — `lido.estado` é `undefined` (o `.gs` ainda não devolve `estado`).

- [ ] **Step 3: Estender `criarSheetsDuble` para servir DUAS abas (`Congelamento` e `CongelamentoEstado`)**

No topo de `test/semanal-apps-script-congelamento.test.js`, `criarSheetsDuble` hoje devolve um único `aba`/`linhas` e `SpreadsheetApp.getActiveSpreadsheet().getSheetByName()` sempre devolve essa mesma aba não importa o nome pedido. Trocar para um mapa por nome:

```javascript
function criarSheetsDuble() {
  const abasPorNome = {};
  function criarAba(cabecalho) {
    const linhas = [cabecalho];
    const formatoTextoDe = new Map();
    function chaveCelula(l, c) { return l + ',' + c; }
    function faixa(inicioLinha, inicioColuna, numLinhas, numColunas) {
      return {
        setNumberFormat(f) {
          for (let l = inicioLinha; l < inicioLinha + numLinhas; l++) {
            for (let c = inicioColuna; c < inicioColuna + numColunas; c++) {
              formatoTextoDe.set(chaveCelula(l, c), f === '@');
            }
          }
          return this;
        },
        setValues(valores) {
          valores.forEach((linha, i) => {
            const numeroDaLinha = inicioLinha + i;
            linhas[numeroDaLinha - 1] = linha.map((v, j) => {
              const texto = formatoTextoDe.get(chaveCelula(numeroDaLinha, inicioColuna + j)) === true;
              if (!texto && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
                const [ano, mes, dia] = v.split('-').map(Number);
                return new Date(ano, mes - 1, dia);
              }
              if (texto && typeof v === 'number') return String(v).replace('.', ',');
              return v;
            });
          });
          return this;
        },
      };
    }
    const contadores = { getDataRange: 0 };
    return {
      linhas, contadores,
      getDataRange: () => { contadores.getDataRange++; return { getValues: () => linhas.map((l) => l.slice()) }; },
      getLastRow: () => linhas.length,
      getMaxRows: () => Math.max(linhas.length, 1000),
      getRange: (l, c, nl, nc) => faixa(l, c, nl, nc),
      deleteRow: (l) => { linhas.splice(l - 1, 1); },
      __injetarLinhaCrua(valores) {
        const [ano, mes, dia] = String(valores[1]).split('-').map(Number);
        linhas.push(valores.map((v, i) => (i === 1 ? new Date(ano, mes - 1, dia) : v)));
      },
    };
  }
  return {
    get aba() { return abasPorNome['Congelamento']; },
    get linhas() { return abasPorNome['Congelamento'] ? abasPorNome['Congelamento'].linhas : undefined; },
    get contadores() { return abasPorNome['Congelamento'] ? abasPorNome['Congelamento'].contadores : undefined; },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (nome) => abasPorNome[nome] || null,
        insertSheet: (nome) => {
          const cabecalho = nome === 'CongelamentoEstado'
            ? ['SemanaInicio', 'Travada', 'Autor', 'AtualizadoEm']
            : ['Ano', 'SemanaInicio', 'Chave', 'Volume', 'Financeiro', 'Equipe', 'ProdutividadeMedia', 'Autor', 'CongeladoEm'];
          abasPorNome[nome] = criarAba(cabecalho);
          return abasPorNome[nome];
        },
      }),
    },
  };
}
```

Isso mantém `duble.aba`/`duble.linhas`/`duble.contadores` funcionando para todos os testes existentes (que só conhecem a aba `Congelamento`, criada sob demanda no primeiro `insertSheet` como já acontecia) — só passa a rotear por nome de aba.

- [ ] **Step 4: Implementar `CongelamentoEstado`, `lerEstado`, `gravarEstado` no `.gs`**

Em `tools/semanal/apps-script-congelamento.gs`, logo depois da constante `COL_CONGELADO_EM` e antes de `tokenEsperado`:

```javascript
var ABA_ESTADO = 'CongelamentoEstado';
var CABECALHO_ESTADO = ['SemanaInicio', 'Travada', 'Autor', 'AtualizadoEm'];
var COL_ESTADO_SEMANA = 1;

function abaCongelamentoEstado() {
  var planilha = SpreadsheetApp.getActiveSpreadsheet();
  var aba = planilha.getSheetByName(ABA_ESTADO);
  if (!aba) {
    aba = planilha.insertSheet(ABA_ESTADO);
    aba.getRange(1, 1, 1, CABECALHO_ESTADO.length).setValues([CABECALHO_ESTADO]);
    aba.getRange(1, COL_ESTADO_SEMANA, aba.getMaxRows(), 1).setNumberFormat('@');
  }
  return aba;
}

// {travada, autor, atualizadoEm} para chaveSegunda. Sem linha em
// CongelamentoEstado (aba nova, ou semana nunca travada/destravada por
// aqui), cai no fallback de compatibilidade com o mecanismo write-once
// antigo: travada = temPontosExistentes. Sem isso, o primeiro "Atualizar
// dados" rodado depois deste deploy sobrescreveria em silêncio uma semana
// que alguém já tratava como definitiva sob a regra antiga.
function lerEstado(chaveSegunda, temPontosExistentes) {
  var dados = abaCongelamentoEstado().getDataRange().getValues();
  var alvo = String(chaveSegunda || '');
  for (var i = 1; i < dados.length; i++) {
    if (normalizarDia(dados[i][0]) === alvo) {
      return {
        travada: String(dados[i][1]) === 'TRUE',
        autor: String(dados[i][2] || ''),
        atualizadoEm: String(dados[i][3] || ''),
      };
    }
  }
  return { travada: !!temPontosExistentes, autor: '', atualizadoEm: '' };
}

function gravarEstado(chaveSegunda, travada, autor, quando) {
  var aba = abaCongelamentoEstado();
  var dados = aba.getDataRange().getValues();
  var alvo = String(chaveSegunda || '');
  var valores = [alvo, travada ? 'TRUE' : 'FALSE', autor || '', quando || ''];
  for (var i = 1; i < dados.length; i++) {
    if (normalizarDia(dados[i][0]) === alvo) {
      aba.getRange(i + 1, 1, 1, CABECALHO_ESTADO.length).setValues([valores]);
      return;
    }
  }
  var linha = aba.getLastRow() + 1;
  aba.getRange(linha, COL_ESTADO_SEMANA, 1, 1).setNumberFormat('@');
  aba.getRange(linha, 1, 1, CABECALHO_ESTADO.length).setValues([valores]);
}
```

- [ ] **Step 5: Estender `doPost` — `ler` devolve `estado`; `congelar`/`travar`/`destravar` num bloco só**

Substituir, em `tools/semanal/apps-script-congelamento.gs`, o corpo de `doPost` (linhas 114 a 190 do arquivo atual) por:

```javascript
function doPost(e) {
  var corpo = JSON.parse(e.postData.contents);
  if (!tokenValido(corpo.token)) return resposta({ erro: 'token' });

  if (corpo.acao === 'ler') {
    var linhas = linhasDaSemana(corpo.semana);
    var chaveEstado = corpo.chaveSegunda || corpo.semana;
    var fragmentosParaChecagem = (corpo.chavesFragmentos && corpo.chavesFragmentos.length)
      ? corpo.chavesFragmentos : [corpo.semana];
    var temPontosExistentes = fragmentosParaChecagem.some(function (c) { return linhasDaSemana(c).length > 0; });
    return resposta({ linhas: linhas, estado: lerEstado(chaveEstado, temPontosExistentes) });
  }

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
      linhasParaApagar.sort(function (a, b) { return b - a; })
        .forEach(function (linha) { abaDesfazer.deleteRow(linha); });
      return resposta({ ok: true, apagadas: linhasParaApagar.length });
    } finally {
      travaDesfazer.releaseLock();
    }
  }

  // congelar (upsert condicionado ao estado) / travar (upsert + trava) /
  // destravar (só destrava, nunca apaga ponto). As três compartilham a
  // trava de concorrência porque as três podem escrever em Congelamento
  // e/ou CongelamentoEstado.
  var trava = LockService.getScriptLock();
  trava.waitLock(30000);
  try {
    if (corpo.acao === 'destravar') {
      gravarEstado(corpo.chaveSegunda, false, corpo.autor, corpo.destravadoEm);
      return resposta({ ok: true });
    }

    if (corpo.acao === 'congelar') {
      var estadoAtual = lerEstado(corpo.chaveSegunda, false);
      if (estadoAtual.travada) {
        return resposta({ erro: 'travada', autor: estadoAtual.autor, atualizadoEm: estadoAtual.atualizadoEm });
      }
    }

    var linhasPayload = corpo.linhas || [];
    if (linhasPayload.length) {
      // Upsert: apaga as linhas EXISTENTES das chaves-alvo (se houver) e
      // grava as novas no lugar. Mesma leitura única da planilha que a
      // checagem "já congelada" original fazia -- ver o comentário
      // histórico sobre custo quadrático, ainda válido aqui.
      var chavesAlvo = {};
      linhasPayload.forEach(function (l) { chavesAlvo[String(l.chave)] = true; });
      var abaPontos = abaCongelamento();
      var dadosPontos = abaPontos.getDataRange().getValues();
      var linhasParaSubstituir = [];
      for (var i = 1; i < dadosPontos.length; i++) {
        if (chavesAlvo[normalizarDia(dadosPontos[i][COL_SEMANA_INICIO - 1])]) linhasParaSubstituir.push(i + 1);
      }
      linhasParaSubstituir.sort(function (a, b) { return b - a; })
        .forEach(function (linha) { abaPontos.deleteRow(linha); });

      var novasLinhas = linhasPayload.map(function (linha) {
        return [String(corpo.chaveSegunda).slice(0, 4), linha.chave, linha.chaveMatriz,
          linha.volume, linha.financeiro, linha.equipe, linha.produtividadeMedia,
          corpo.autor || '', corpo.congeladoEm || corpo.travadoEm || ''];
      });
      var primeira = Math.max(abaPontos.getLastRow() + 1, 2);
      formatarColunasDeDataComoTexto(abaPontos, primeira, novasLinhas.length);
      abaPontos.getRange(primeira, 1, novasLinhas.length, CABECALHO.length).setValues(novasLinhas);
    }

    if (corpo.acao === 'travar') {
      gravarEstado(corpo.chaveSegunda, true, corpo.autor, corpo.travadoEm);
    }

    return resposta({ ok: true, gravadas: linhasPayload.length });
  } finally {
    trava.releaseLock();
  }
}
```

Também atualizar o comentário de topo do arquivo (linhas 1-18): a regra 1 ("a semana só pode ser congelada UMA vez") não vale mais — trocar por uma frase descrevendo o toggle (travada bloqueia `congelar`; `travar`/`destravar` mudam o estado; `desfazer` continua existindo só como mecanismo manual).

- [ ] **Step 6: Rodar os dois testes novos do Step 1 e confirmar que passam**

Run: `node --test test/semanal-apps-script-congelamento.test.js`
Expected: PASS nos 2 testes novos.

- [ ] **Step 7: Atualizar o teste de recusa existente para a semântica de `travada`, e adicionar testes de `travar`/`destravar`/upsert**

Em `test/semanal-apps-script-congelamento.test.js`, o teste `'doPost RECUSA quando a semana ja tem qualquer linha, sem sobrescrever'` (linha 145 do arquivo atual) descreve o comportamento ANTIGO — não é mais verdade (upsert é permitido quando aberta). Substituir por:

```javascript
test('congelar faz UPSERT quando a semana esta aberta -- sobrescreve o valor anterior', () => {
  const duble = criarSheetsDuble();
  const ctx = carregarScript(duble);
  const corpo = (volume) => ({ postData: { contents: JSON.stringify({
    acao: 'congelar', token: TOKEN_BOM, chaveSegunda: '2026-08-31', autor: 'primeiro', congeladoEm: 'x',
    linhas: [{ chave: '2026-08-31', chaveMatriz: 'SUP-1||SP', volume: volume, financeiro: 0, equipe: 1, produtividadeMedia: volume }],
  }) } });
  ctx.doPost(corpo(10));
  const segunda = corpoDe(ctx.doPost(corpo(999)));
  assert.equal(segunda.ok, true, 'sem trava, o segundo congelar tem de suceder');
  assert.equal(segunda.gravadas, 1);

  const lido = ler(ctx, '2026-08-31', TOKEN_BOM);
  assert.equal(lido.linhas.length, 1, 'upsert nao pode duplicar a linha');
  assert.equal(lido.linhas[0].volume, 999, 'o valor tem de ser o mais recente');
});

test('congelar RECUSA com {erro:"travada"} quando a semana foi travada', () => {
  const duble = criarSheetsDuble();
  const ctx = carregarScript(duble);
  ctx.doPost({ postData: { contents: JSON.stringify({
    acao: 'travar', token: TOKEN_BOM, chaveSegunda: '2026-08-31', autor: 'ana', travadoEm: '2026-08-28T22:00:00Z',
    linhas: [{ chave: '2026-08-31', chaveMatriz: 'SUP-1||SP', volume: 10, financeiro: 1, equipe: 1, produtividadeMedia: 10 }],
  }) } });
  const resultado = corpoDe(ctx.doPost({ postData: { contents: JSON.stringify({
    acao: 'congelar', token: TOKEN_BOM, chaveSegunda: '2026-08-31', autor: 'bruno', congeladoEm: 'x',
    linhas: [{ chave: '2026-08-31', chaveMatriz: 'SUP-1||SP', volume: 999, financeiro: 1, equipe: 1, produtividadeMedia: 999 }],
  }) } }));
  assert.equal(resultado.erro, 'travada');
  assert.equal(resultado.autor, 'ana');

  const lido = ler(ctx, '2026-08-31', TOKEN_BOM);
  assert.equal(lido.linhas[0].volume, 10, 'a semana travada nao pode ter sido sobrescrita');
});

test('travar grava o snapshot enviado E marca travada=true na leitura', () => {
  const duble = criarSheetsDuble();
  const ctx = carregarScript(duble);
  const gravado = corpoDe(ctx.doPost({ postData: { contents: JSON.stringify({
    acao: 'travar', token: TOKEN_BOM, chaveSegunda: '2026-08-31', autor: 'ana', travadoEm: '2026-08-28T22:00:00Z',
    linhas: [{ chave: '2026-08-31', chaveMatriz: 'SUP-1||SP', volume: 7, financeiro: 1, equipe: 1, produtividadeMedia: 7 }],
  }) } }));
  assert.equal(gravado.ok, true);

  const lido = ler(ctx, '2026-08-31', TOKEN_BOM);
  assert.equal(lido.linhas[0].volume, 7);
  assert.equal(lido.estado.travada, true);
  assert.equal(lido.estado.autor, 'ana');
});

test('destravar zera travada mas NAO apaga os pontos gravados', () => {
  const duble = criarSheetsDuble();
  const ctx = carregarScript(duble);
  ctx.doPost({ postData: { contents: JSON.stringify({
    acao: 'travar', token: TOKEN_BOM, chaveSegunda: '2026-08-31', autor: 'ana', travadoEm: 'x',
    linhas: [{ chave: '2026-08-31', chaveMatriz: 'SUP-1||SP', volume: 7, financeiro: 1, equipe: 1, produtividadeMedia: 7 }],
  }) } });
  const resultado = corpoDe(ctx.doPost({ postData: { contents: JSON.stringify({
    acao: 'destravar', token: TOKEN_BOM, chaveSegunda: '2026-08-31', autor: 'bruno', destravadoEm: 'y',
  }) } }));
  assert.equal(resultado.ok, true);

  const lido = ler(ctx, '2026-08-31', TOKEN_BOM);
  assert.equal(lido.estado.travada, false);
  assert.equal(lido.estado.autor, 'bruno', 'o autor do ULTIMO evento de estado (destravar) tem de aparecer');
  assert.equal(lido.linhas.length, 1, 'destravar nao apaga pontos');
  assert.equal(lido.linhas[0].volume, 7);
});

test('token errado em travar/destravar recusa sem gravar nada', () => {
  const duble = criarSheetsDuble();
  const ctx = carregarScript(duble);
  assert.equal(corpoDe(ctx.doPost({ postData: { contents: JSON.stringify({
    acao: 'travar', token: 'errado', chaveSegunda: '2026-08-31', linhas: [],
  }) } })).erro, 'token');
  assert.equal(corpoDe(ctx.doPost({ postData: { contents: JSON.stringify({
    acao: 'destravar', token: 'errado', chaveSegunda: '2026-08-31',
  }) } })).erro, 'token');
});
```

Remover também o teste `'doPost recusa quando so o SEGUNDO fragmento da semana ja existe'` (linha 252) — descreve a mesma regra antiga de recusa por reclique, agora inválida; a regra de fragmentos continua coberta pelo teste do Step 1 (`ler com chavesFragmentos...`) e pelos testes de `desfazer` que já cobrem os dois fragmentos.

- [ ] **Step 8: Rodar a suíte inteira do arquivo e confirmar verde**

Run: `node --test test/semanal-apps-script-congelamento.test.js`
Expected: PASS em todos os testes.

- [ ] **Step 9: Commit**

```bash
git add tools/semanal/apps-script-congelamento.gs test/semanal-apps-script-congelamento.test.js
git commit -m "feat(congelamento): Apps Script ganha travar/destravar e congelar vira upsert condicionado ao estado"
```

---

### Task 2: Cliente — `congelamento-sheet.js` ganha `travar`/`destravar` e `carregar` devolve `estado`

**Files:**
- Modify: `tools/semanal/congelamento-sheet.js`
- Test: `test/semanal-congelamento-sheet.test.js`

**Interfaces:**
- Consumes: contrato HTTP da Task 1 (`ler`/`travar`/`destravar`/`congelar`).
- Produces: `criarClienteCongelamento(opcoes).carregar(chaveSemana, chaveSegunda, chavesFragmentos)` → `Promise<{porRegistro, autor, congeladoEm, estado:{travada,autor,atualizadoEm}} | {motivo} | null>`; `.travar(chaveSegunda, snapshotOuNull, autor)` → `Promise<{ok:true}|{ok:false,motivo}>`; `.destravar(chaveSegunda, autor)` → `Promise<{ok:true}|{ok:false,motivo}>`. `.congelar`/`.desfazer` mantêm assinatura atual.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao final de `test/semanal-congelamento-sheet.test.js`:

```javascript
test('carregar inclui o campo estado (travada/autor/atualizadoEm) vindo da Sheet', async () => {
  const d = fetchDuble([{ linhas: [], estado: { travada: true, autor: 'ana', atualizadoEm: '2026-08-28T22:00:00Z' } }]);
  const cliente = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: d.fetch, token: 'tok' });
  const congelado = await cliente.carregar('2026-08-31', '2026-08-31', ['2026-08-31']);
  assert.deepEqual(congelado.estado, { travada: true, autor: 'ana', atualizadoEm: '2026-08-28T22:00:00Z' });
  const corpo = JSON.parse(d.chamadas[0].opcoes.body);
  assert.equal(corpo.chaveSegunda, '2026-08-31');
  assert.deepEqual(corpo.chavesFragmentos, ['2026-08-31']);
});

test('travar manda acao, chaveSegunda, autor e as linhas (quando fornecidas) no corpo', async () => {
  const d = fetchDuble([{ ok: true, gravadas: 1 }]);
  const cliente = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: d.fetch, token: 'tok' });
  const r = await cliente.travar('2026-08-31', { chaveSegunda: '2026-08-31', linhas: [{ chave: '2026-08-31' }] }, 'ana');
  assert.equal(r.ok, true);
  const corpo = JSON.parse(d.chamadas[0].opcoes.body);
  assert.equal(corpo.acao, 'travar');
  assert.equal(corpo.token, 'tok');
  assert.equal(corpo.chaveSegunda, '2026-08-31');
  assert.equal(corpo.autor, 'ana');
  assert.equal(corpo.linhas.length, 1);
});

test('travar sem snapshot manda linhas vazio -- so trava, sem tocar nos pontos', async () => {
  const d = fetchDuble([{ ok: true, gravadas: 0 }]);
  const cliente = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: d.fetch, token: 'tok' });
  await cliente.travar('2026-08-31', null, 'ana');
  const corpo = JSON.parse(d.chamadas[0].opcoes.body);
  assert.deepEqual(corpo.linhas, []);
});

test('destravar manda acao, chaveSegunda e autor, sem linhas', async () => {
  const d = fetchDuble([{ ok: true }]);
  const cliente = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: d.fetch, token: 'tok' });
  const r = await cliente.destravar('2026-08-31', 'bruno');
  assert.equal(r.ok, true);
  const corpo = JSON.parse(d.chamadas[0].opcoes.body);
  assert.equal(corpo.acao, 'destravar');
  assert.equal(corpo.chaveSegunda, '2026-08-31');
  assert.equal(corpo.autor, 'bruno');
  assert.equal(corpo.linhas, undefined);
});

test('travar e destravar degradam para {ok:false, motivo} sem lancar (token e rede)', async () => {
  const cliente1 = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: fetchDuble([{ erro: 'token' }]).fetch, token: 'ruim' });
  assert.deepEqual(await cliente1.travar('2026-08-31', null, 'x'), { ok: false, motivo: 'token' });
  const cliente2 = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: fetchDuble([new Error('offline')]).fetch, token: 'tok' });
  assert.deepEqual(await cliente2.destravar('2026-08-31', 'x'), { ok: false, motivo: 'rede' });
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `node --test test/semanal-congelamento-sheet.test.js`
Expected: FAIL — `cliente.travar`/`cliente.destravar` não existem; `carregar` não devolve `estado`.

- [ ] **Step 3: Implementar em `tools/semanal/congelamento-sheet.js`**

Substituir a função `carregar` (dentro do objeto devolvido por `criarClienteCongelamento`) para aceitar `chaveSegunda`/`chavesFragmentos` e repassar `estado`:

```javascript
    carregar: async function (chaveSemana, chaveSegunda, chavesFragmentos) {
      if (!url || !buscar) return null;
      try {
        var resposta = await buscar(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            acao: 'ler', token: token, semana: chaveSemana,
            chaveSegunda: chaveSegunda || chaveSemana,
            chavesFragmentos: chavesFragmentos || [chaveSemana],
          }),
        });
        var corpo = await resposta.json();
        if (!corpo) return { motivo: 'rede' };
        if (corpo.erro) return { motivo: corpo.erro === 'token' ? 'token' : 'rede' };
        var estado = corpo.estado || { travada: false, autor: '', atualizadoEm: '' };
        if (!corpo.linhas || !corpo.linhas.length) return { porRegistro: null, autor: '', congeladoEm: '', estado: estado, semAlgumaLinha: true };
        return {
          porRegistro: porRegistroDasLinhas(corpo.linhas),
          autor: corpo.linhas[0].autor || '',
          congeladoEm: corpo.linhas[0].congeladoEm || '',
          estado: estado,
        };
      } catch (err) {
        return { motivo: 'rede' };
      }
    },
```

Adicionar `travar`/`destravar` como novos métodos do mesmo objeto, ao lado de `congelar`/`desfazer`:

```javascript
    travar: async function (chaveSegunda, snapshot, autor) {
      if (!url || !buscar) return { ok: false, motivo: 'rede' };
      try {
        var resposta = await buscar(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            acao: 'travar', token: token, chaveSegunda: chaveSegunda,
            autor: autor || 'dashboard', travadoEm: new Date().toISOString(),
            linhas: (snapshot && snapshot.linhas) || [],
          }),
        });
        var corpo = await resposta.json();
        if (corpo && corpo.ok) return { ok: true };
        return { ok: false, motivo: (corpo && corpo.erro) || 'rede' };
      } catch (err) {
        return { ok: false, motivo: 'rede' };
      }
    },

    destravar: async function (chaveSegunda, autor) {
      if (!url || !buscar) return { ok: false, motivo: 'rede' };
      try {
        var resposta = await buscar(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            acao: 'destravar', token: token, chaveSegunda: chaveSegunda,
            autor: autor || 'dashboard', destravadoEm: new Date().toISOString(),
          }),
        });
        var corpo = await resposta.json();
        if (corpo && corpo.ok) return { ok: true };
        return { ok: false, motivo: (corpo && corpo.erro) || 'rede' };
      } catch (err) {
        return { ok: false, motivo: 'rede' };
      }
    },
```

**Nota importante:** o `carregar` antigo devolvia `null` quando `corpo.linhas` estava vazio ("nunca foi congelada"). Agora `carregar` PRECISA devolver o `estado` mesmo sem nenhum ponto gravado (uma semana pode estar destravada e sem nenhuma linha de base ainda) — por isso a mudança acima devolve um objeto com `porRegistro: null` e `semAlgumaLinha: true` em vez de `null` puro nesse caso. Isso muda o contrato de quem chama `carregar` — tratado na Task 4.

- [ ] **Step 4: Rodar e confirmar que os novos testes passam, e checar os antigos**

Run: `node --test test/semanal-congelamento-sheet.test.js`
Expected: os 5 testes novos PASSAM. O teste antigo `'carregar devolve null quando a semana nao tem congelado'` (linha 40) agora FALHA, de propósito — atualizar sua asserção:

```javascript
test('carregar devolve estado sem congelado quando a semana nao tem nenhum ponto', async () => {
  const d = fetchDuble([{ linhas: [], estado: { travada: false, autor: '', atualizadoEm: '' } }]);
  const cliente = criarClienteCongelamento({ url: 'https://exemplo/exec', fetch: d.fetch, token: 'tok' });
  const r = await cliente.carregar('2026-08-31', '2026-08-31', ['2026-08-31']);
  assert.equal(r.porRegistro, null);
  assert.equal(r.semAlgumaLinha, true);
  assert.deepEqual(r.estado, { travada: false, autor: '', atualizadoEm: '' });
});
```

- [ ] **Step 5: Rodar a suíte inteira do arquivo e confirmar verde**

Run: `node --test test/semanal-congelamento-sheet.test.js`
Expected: PASS em todos os testes.

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/congelamento-sheet.js test/semanal-congelamento-sheet.test.js
git commit -m "feat(congelamento): cliente ganha travar/destravar e carregar devolve estado"
```

---

### Task 3: UI — troca os dois botões pelo switch on/off na aba Consolidado

**Files:**
- Modify: `tools/semanal/render-aba-consolidado.js:502-526` (função `renderControles`)
- Modify: `tools/semanal/render-semanal.js` (bloco `CSS_ABAS_SEMANAL`, `const CSS_ABAS_SEMANAL = ...`)
- Test: `test/semanal-render-aba-consolidado.test.js`

**Interfaces:**
- Consumes: nada de Sheet — puro markup/CSS.
- Produces: markup com `id="toggle-congelamento"` (`<input type="checkbox">`), `id="status-congelamento"` (texto de status), mantém `id="status-congelamento-leitura"` inalterado. Remove `id="btn-congelar-semana"`, `id="btn-desfazer-congelamento"`, `id="status-desfazer"`.

- [ ] **Step 1: Escrever o teste que falha**

Localizar (ou criar, se não existir ainda) em `test/semanal-render-aba-consolidado.test.js` um teste de `renderControles`/`renderAbaConsolidado` cobrindo o markup dos controles, e adicionar:

```javascript
test('renderControles emite um switch de congelamento, nao mais os dois botoes antigos', () => {
  const html = RenderAbaConsolidado.renderAbaConsolidado([], [], {
    semanaIdx: 0, dimensao: 'volume', mesIdx: 0,
    semanas: [{ inicio: 0, fim: 6 }], demandas: { porRegistroEventos: {} }, hojeEpoch: 0,
  });
  assert.match(html, /id="toggle-congelamento"/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /id="status-congelamento"/);
  assert.doesNotMatch(html, /id="btn-congelar-semana"/);
  assert.doesNotMatch(html, /id="btn-desfazer-congelamento"/);
  assert.doesNotMatch(html, /id="status-desfazer"/);
});
```

Ajustar os `require`s de topo do arquivo de teste se `RenderAbaConsolidado` ainda não estiver importado (`const RenderAbaConsolidado = require('../tools/semanal/render-aba-consolidado.js');`).

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-render-aba-consolidado.test.js`
Expected: FAIL — `id="toggle-congelamento"` não existe ainda; `id="btn-congelar-semana"` ainda existe.

- [ ] **Step 3: Implementar o novo markup**

Em `tools/semanal/render-aba-consolidado.js`, substituir as linhas 513-524 (o bloco de comentário + os dois botões + os três spans de status) por:

```javascript
    // Congelamento (2026-09-08: toggle on/off, substitui os botões
    // "Congelar semana"/"Desfazer congelamento") -- markup ESTÁTICO só;
    // render-semanal.js religa comportamento por id, não por posição no DOM.
    + '<label class="controle-consolidado toggle-congelamento-wrap">'
    + '<span class="toggle-congelamento-rotulo">Linha de base</span>'
    + '<span class="toggle-congelamento-switch">'
    + '<input type="checkbox" id="toggle-congelamento" disabled>'
    + '<span class="toggle-congelamento-trilho" aria-hidden="true"></span>'
    + '</span>'
    + '</label>'
    + '<span id="status-congelamento" class="nota-inline"></span>'
    + '<span id="status-congelamento-leitura" class="nota-inline"></span>'
```

- [ ] **Step 4: Rodar e confirmar que o teste novo passa**

Run: `node --test test/semanal-render-aba-consolidado.test.js`
Expected: PASS.

- [ ] **Step 5: Adicionar o CSS do switch**

Em `tools/semanal/render-semanal.js`, dentro de `CSS_ABAS_SEMANAL`, logo após o bloco `.controle-balanco select:focus-visible...` (por volta da linha 159), adicionar:

```css
  .toggle-congelamento-wrap { flex-direction: row; align-items: center; gap: 8px; }
  .toggle-congelamento-rotulo { font-size: 12px; color: var(--text-secondary); }
  .toggle-congelamento-switch { position: relative; display: inline-block; width: 38px; height: 22px; }
  .toggle-congelamento-switch input {
    position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer;
  }
  .toggle-congelamento-switch input:disabled { cursor: not-allowed; }
  .toggle-congelamento-trilho {
    position: absolute; inset: 0; border-radius: 11px;
    background: var(--surface-1); border: 1px solid var(--border);
    transition: background 0.15s ease;
  }
  .toggle-congelamento-trilho::before {
    content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
    border-radius: 50%; background: var(--text-secondary); transition: transform 0.15s ease;
  }
  .toggle-congelamento-switch input:checked + .toggle-congelamento-trilho {
    background: rgba(246,181,63,0.35); border-color: #f6b53f;
  }
  .toggle-congelamento-switch input:checked + .toggle-congelamento-trilho::before {
    transform: translateX(16px); background: #f6b53f;
  }
  .toggle-congelamento-switch input:disabled + .toggle-congelamento-trilho { opacity: 0.5; }
  .toggle-congelamento-switch input:focus-visible + .toggle-congelamento-trilho { outline: 2px solid #f6b53f; outline-offset: 2px; }
```

- [ ] **Step 6: Rodar a suíte inteira relevante**

Run: `node --test test/semanal-render-aba-consolidado.test.js test/comum-render-shell.test.js`
Expected: PASS. (`comum-render-shell.test.js` não deveria ser afetado — `CSS_ABAS_SEMANAL` fica fora de `cssBase()`, ver o comentário no topo do arquivo — rodar mesmo assim para confirmar.)

- [ ] **Step 7: Commit**

```bash
git add tools/semanal/render-aba-consolidado.js tools/semanal/render-semanal.js test/semanal-render-aba-consolidado.test.js
git commit -m "feat(congelamento): troca os dois botoes pelo switch on/off na aba Consolidado"
```

---

### Task 4: UI — religa o switch em `render-semanal.js` (ESTADO_CONGELAMENTO, handlers, wiring)

**Files:**
- Modify: `tools/semanal/render-semanal.js:1580-1923` (bloco de Congelamento dentro de `SCRIPT_CLIENTE_SEMANAL`)
- Test: `test/semanal-render-semanal-wireup.test.js`

**Interfaces:**
- Consumes: `CongelamentoSheet.criarClienteCongelamento(...)` (Task 2), `CongelarTendenciaSemanal.{proximaSegunda, segundaDaSemana, fragmentosDaSemanaAlvo, calcularSnapshotSemanaAlvo}` (já existentes, sem mudança de assinatura).
- Produces: função `alternarCongelamento()` (handler de clique/change do `#toggle-congelamento`) e `atualizarToggleCongelamento(chaveSemanaEmTela)`, chamadas por `montarAbaConsolidado`. `ESTADO_CONGELAMENTO` ganha o campo `estado` (`{travada, autor, atualizadoEm}`).

- [ ] **Step 1: Escrever os testes que falham**

Estes testes substituem o bloco antigo de Congelamento/Desfazer em `test/semanal-render-semanal-wireup.test.js` (linhas 1782-2400 aproximadamente, do comentário "--- Task 8 (2026-09-01)..." até o fim dos testes de `desfazerCongelamentoDaSemana`). Antes de escrever os novos, **apagar** todos os testes cujo nome contenha `congelarProximaSemana`, `atualizarBotaoCongelar`, `atualizarBotaoDesfazer`, `desfazerCongelamentoDaSemana`, `btn-congelar-semana`, `btn-desfazer-congelamento` — a lista completa dos nomes de teste a remover, buscando por essas strings no arquivo, mais o comentário de cabeçalho da seção. Manter os helpers já definidos ali (`diaCurtoDeChave`, `chaveAlvoDoTeste`, `esperarMicrotasks`) — todos reaproveitados abaixo. Escrever no lugar:

```javascript
// --- Toggle de congelamento (2026-09-08): substitui os botões "Congelar
// próxima semana"/"Desfazer congelamento" por um switch por semana. Todos
// os testes abaixo, exceto os que mutam sandbox.URL_CONGELAMENTO
// explicitamente, exercitam o caminho degradado (URL PENDENTE) por default.

test('toggle nasce desabilitado ate a Sheet responder, e reflete travada=false', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const html = renderSemanal({
    registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z'),
  });
  const fetchMock = async (url, opcoes) => {
    const corpo = JSON.parse(opcoes.body);
    if (corpo.acao === 'ler') return { ok: true, json: async () => ({ linhas: [], estado: { travada: false, autor: '', atualizadoEm: '' } }) };
    throw new Error('URL inesperada: ' + url);
  };
  const { sandbox, documentoFalso } = montarSandbox(html, fetchMock);
  sandbox.URL_CONGELAMENTO = 'https://exemplo.com/congelamento-configurado';
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();
  await esperarMicrotasks();
  await esperarMicrotasks();

  const toggle = documentoFalso.getElementById('toggle-congelamento');
  assert.strictEqual(toggle.checked, false);
  assert.strictEqual(toggle.disabled, false, 'semana aberta e sem erro de leitura -- o switch tem de ficar clicavel');
});

test('toggle aparece marcado e mostra autor/data quando a semana em tela esta travada', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const html = renderSemanal({
    registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z'),
  });
  const fetchMock = async (url, opcoes) => {
    const corpo = JSON.parse(opcoes.body);
    if (corpo.acao === 'ler') {
      return { ok: true, json: async () => ({
        linhas: [{ chaveMatriz: 'SUP-0001-24||BL', volume: 1, financeiro: 1, equipe: 1, produtividadeMedia: 1, autor: 'Fulano', congeladoEm: '2026-08-31T22:00:00Z' }],
        estado: { travada: true, autor: 'Fulano', atualizadoEm: '2026-08-31T22:00:00Z' },
      }) };
    }
    throw new Error('URL inesperada: ' + url);
  };
  const { sandbox, documentoFalso } = montarSandbox(html, fetchMock);
  sandbox.URL_CONGELAMENTO = 'https://exemplo.com/congelamento-configurado';
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();
  await esperarMicrotasks();
  await esperarMicrotasks();

  const toggle = documentoFalso.getElementById('toggle-congelamento');
  assert.strictEqual(toggle.checked, true);
  const status = documentoFalso.getElementById('status-congelamento');
  assert.match(status.textContent, /Fulano/);
});

test('ligar o toggle chama travar com um snapshot calculado na hora, para a semana EM TELA', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const html = renderSemanal({
    registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z'),
  });
  const chamadasPost = [];
  const fetchMock = async (url, opcoes) => {
    const corpo = JSON.parse(opcoes.body);
    chamadasPost.push(corpo);
    if (corpo.acao === 'ler') return { ok: true, json: async () => ({ linhas: [], estado: { travada: false, autor: '', atualizadoEm: '' } }) };
    if (corpo.acao === 'travar') return { ok: true, json: async () => ({ ok: true, gravadas: corpo.linhas.length }) };
    throw new Error('URL inesperada: ' + url);
  };
  const { sandbox, documentoFalso } = montarSandbox(html, fetchMock);
  sandbox.URL_CONGELAMENTO = 'https://exemplo.com/congelamento-configurado';
  sandbox.window.__DASHBOARD_AUTOR__ = 'Autor Sintetico';
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();
  await esperarMicrotasks();
  await esperarMicrotasks();

  await sandbox.alternarCongelamento();
  await esperarMicrotasks();

  const chamadaTravar = chamadasPost.find((c) => c.acao === 'travar');
  assert.ok(chamadaTravar, 'tem de ter chamado travar');
  assert.strictEqual(chamadaTravar.autor, 'Autor Sintetico');
  assert.ok(Array.isArray(chamadaTravar.linhas) && chamadaTravar.linhas.length > 0, 'o snapshot enviado precisa ter linhas calculadas na hora');

  const toggle = documentoFalso.getElementById('toggle-congelamento');
  assert.strictEqual(toggle.checked, true);
});

test('desligar o toggle chama destravar, sem mandar nenhuma linha', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const html = renderSemanal({
    registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z'),
  });
  const chamadasPost = [];
  const fetchMock = async (url, opcoes) => {
    const corpo = JSON.parse(opcoes.body);
    chamadasPost.push(corpo);
    if (corpo.acao === 'ler') {
      return { ok: true, json: async () => ({
        linhas: [{ chaveMatriz: 'SUP-0001-24||BL', volume: 1, financeiro: 1, equipe: 1, produtividadeMedia: 1, autor: 'Fulano', congeladoEm: 'x' }],
        estado: { travada: true, autor: 'Fulano', atualizadoEm: 'x' },
      }) };
    }
    if (corpo.acao === 'destravar') return { ok: true, json: async () => ({ ok: true }) };
    throw new Error('URL inesperada: ' + url);
  };
  const { sandbox, documentoFalso } = montarSandbox(html, fetchMock);
  sandbox.URL_CONGELAMENTO = 'https://exemplo.com/congelamento-configurado';
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();
  await esperarMicrotasks();
  await esperarMicrotasks();

  await sandbox.alternarCongelamento();
  await esperarMicrotasks();

  const chamadaDestravar = chamadasPost.find((c) => c.acao === 'destravar');
  assert.ok(chamadaDestravar, 'tem de ter chamado destravar');
  assert.strictEqual(chamadaDestravar.linhas, undefined);

  const toggle = documentoFalso.getElementById('toggle-congelamento');
  assert.strictEqual(toggle.checked, false);
});

test('falha de rede ao travar mantem o toggle no estado anterior e mostra aviso', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const html = renderSemanal({
    registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z'),
  });
  const fetchMock = async (url, opcoes) => {
    const corpo = JSON.parse(opcoes.body);
    if (corpo.acao === 'ler') return { ok: true, json: async () => ({ linhas: [], estado: { travada: false, autor: '', atualizadoEm: '' } }) };
    if (corpo.acao === 'travar') throw new Error('offline');
    throw new Error('URL inesperada: ' + url);
  };
  const { sandbox, documentoFalso } = montarSandbox(html, fetchMock);
  sandbox.URL_CONGELAMENTO = 'https://exemplo.com/congelamento-configurado';
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();
  await esperarMicrotasks();
  await esperarMicrotasks();

  await sandbox.alternarCongelamento();
  await esperarMicrotasks();

  const toggle = documentoFalso.getElementById('toggle-congelamento');
  assert.strictEqual(toggle.checked, false, 'falha de rede nao pode deixar o toggle marcado como travado');
  const status = documentoFalso.getElementById('status-congelamento');
  assert.match(status.textContent, /rede ou planilha fora do ar/);
});

test('URL_CONGELAMENTO pendente deixa o toggle desabilitado e explica na tela', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const html = renderSemanal({
    registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z'),
  });
  const { sandbox, documentoFalso } = montarSandbox(html);
  sandbox.URL_CONGELAMENTO = 'PENDENTE-congelamento';
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  const toggle = documentoFalso.getElementById('toggle-congelamento');
  assert.strictEqual(toggle.disabled, true);
  const status = documentoFalso.getElementById('status-congelamento');
  assert.strictEqual(status.textContent, 'Congelamento ainda não configurado nesta planilha.');
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `node --test test/semanal-render-semanal-wireup.test.js`
Expected: FAIL — `sandbox.alternarCongelamento` não existe; `toggle-congelamento` não é encontrado no DOM ao vivo (o markup mudou na Task 3, mas o wiring de clique/estado ainda não).

- [ ] **Step 3: Implementar em `tools/semanal/render-semanal.js`**

Substituir, dentro de `SCRIPT_CLIENTE_SEMANAL`, todo o trecho de `atualizarBotaoCongelar` até o fim de `desfazerCongelamentoDaSemana` (linhas 1683-1825 do arquivo atual) por:

```javascript
// Estado do toggle da semana EM TELA (qualquer uma do seletor, não só a
// próxima segunda -- 2026-09-08, substitui o botão write-once). Guarda
// também 'estado' ({travada, autor, atualizadoEm}), que agora vem junto na
// resposta de carregar().
function atualizarToggleCongelamento(chaveSemanaEmTela) {
  var toggle = document.getElementById('toggle-congelamento');
  var status = document.getElementById('status-congelamento');
  if (!toggle) return;
  if (urlCongelamentoPendente()) {
    toggle.checked = false;
    toggle.disabled = true;
    status.textContent = 'Congelamento ainda não configurado nesta planilha.';
    return;
  }
  if (!chaveSemanaEmTela) {
    toggle.disabled = true;
    status.textContent = '';
    return;
  }
  if (ESTADO_CONGELAMENTO.chave !== chaveSemanaEmTela || ESTADO_CONGELAMENTO.carregando) {
    toggle.disabled = true;
    status.textContent = 'Verificando…';
    return;
  }
  if (ESTADO_CONGELAMENTO.erro) {
    toggle.disabled = ESTADO_CONGELAMENTO.erro === 'token';
    status.textContent = textoErroLeituraCongelamento(ESTADO_CONGELAMENTO.erro);
    return;
  }
  var estado = ESTADO_CONGELAMENTO.estado || { travada: false, autor: '', atualizadoEm: '' };
  toggle.disabled = false;
  toggle.checked = !!estado.travada;
  if (!estado.autor) {
    status.textContent = '';
  } else if (estado.travada) {
    status.textContent = 'Semana de ' + formatarDiaCurto(chaveSemanaEmTela) + ' travada em '
      + formatarDataHora(estado.atualizadoEm) + ', por ' + estado.autor + '.';
  } else {
    status.textContent = 'Linha de base atualizada pela última vez em '
      + formatarDataHora(estado.atualizadoEm) + ', por ' + estado.autor + '.';
  }
}

// Clique/troca no switch: liga -> trava (com snapshot calculado na hora,
// pra garantir que toda trava deixa pelo menos um ponto gravado); desliga
// -> destrava (não recalcula nada -- o próximo "Atualizar dados" faz isso).
// Sem confirm(): deixou de ser destrutivo/irreversível.
async function alternarCongelamento() {
  var toggle = document.getElementById('toggle-congelamento');
  var status = document.getElementById('status-congelamento');
  var chaveSemanaEmTela = ESTADO_CONGELAMENTO.chave;
  if (!chaveSemanaEmTela) return;
  var estadoAntes = ESTADO_CONGELAMENTO.estado || { travada: false };
  var vaiTravar = !estadoAntes.travada;

  var partes = chaveSemanaEmTela.split('-').map(Number);
  var epoch = Date.UTC(partes[0], partes[1] - 1, partes[2]) / 86400000;
  var segunda = CongelarTendenciaSemanal.segundaDaSemana(epoch);

  toggle.disabled = true;
  status.textContent = vaiTravar ? 'Travando…' : 'Destravando…';
  try {
    var autor = window.__DASHBOARD_AUTOR__ || 'dashboard';
    var r;
    if (vaiTravar) {
      var hoje = hojeEpochDoNavegador();
      var snapshot = CongelarTendenciaSemanal.calcularSnapshotSemanaAlvo(window.__REGISTROS__, window.__DEMANDAS__, hoje, segunda);
      r = await clienteCongelamento().travar(segunda, snapshot, autor);
    } else {
      r = await clienteCongelamento().destravar(segunda, autor);
    }
    // Perdeu a corrida: a semana em tela mudou enquanto o POST estava no
    // ar -- mesma classe de guard que carregarCongeladoDaSemana já usa.
    // Aplicar aqui mudaria o estado exibido de OUTRA semana.
    if (ESTADO_CONGELAMENTO.chave !== chaveSemanaEmTela) return;
    if (!r.ok) {
      toggle.checked = estadoAntes.travada;
      toggle.disabled = false;
      status.textContent = r.motivo === 'token'
        ? 'Acesso recusado pela planilha (token). Confira o token nas Script Properties.'
        : 'Não foi possível ' + (vaiTravar ? 'travar' : 'destravar') + ' (rede ou planilha fora do ar). Tente de novo.';
      return;
    }
    ESTADO_CONGELAMENTO.estado = { travada: vaiTravar, autor: autor, atualizadoEm: new Date().toISOString() };
    // Redesenha a aba inteira: a tabela precisa refletir o snapshot novo
    // (se travou) ou voltar a poder ser sobrescrita (se destravou).
    if (typeof window.__REDESENHAR_CONSOLIDADO__ === 'function') window.__REDESENHAR_CONSOLIDADO__();
  } catch (err) {
    if (ESTADO_CONGELAMENTO.chave !== chaveSemanaEmTela) return;
    toggle.checked = estadoAntes.travada;
    toggle.disabled = false;
    status.textContent = 'Erro: ' + err.message;
  }
}
```

Em seguida, atualizar `carregarCongeladoDaSemana` (logo acima, por volta da linha 1653) para passar `chaveSegunda`/`chavesFragmentos` ao `carregar` e guardar `estado` em `ESTADO_CONGELAMENTO`:

```javascript
async function carregarCongeladoDaSemana(chaveSemana) {
  ESTADO_CONGELAMENTO.chave = chaveSemana;
  ESTADO_CONGELAMENTO.congelado = null;
  ESTADO_CONGELAMENTO.estado = null;
  ESTADO_CONGELAMENTO.erro = null;
  if (urlCongelamentoPendente()) return null;
  ESTADO_CONGELAMENTO.carregando = true;
  var partes = chaveSemana.split('-').map(Number);
  var epoch = Date.UTC(partes[0], partes[1] - 1, partes[2]) / 86400000;
  var segunda = CongelarTendenciaSemanal.segundaDaSemana(epoch);
  var chavesFragmentos = CongelarTendenciaSemanal.fragmentosDaSemanaAlvo(segunda).map(function (f) { return f.chave; });
  var congelado = await clienteCongelamento().carregar(chaveSemana, segunda, chavesFragmentos);
  ESTADO_CONGELAMENTO.carregando = false;
  if (ESTADO_CONGELAMENTO.chave !== chaveSemana) return null;
  if (congelado && congelado.motivo) {
    ESTADO_CONGELAMENTO.erro = congelado.motivo;
    return null;
  }
  ESTADO_CONGELAMENTO.estado = (congelado && congelado.estado) || { travada: false, autor: '', atualizadoEm: '' };
  ESTADO_CONGELAMENTO.congelado = (congelado && !congelado.semAlgumaLinha) ? congelado : null;
  return congelado;
}
```

E `ESTADO_CONGELAMENTO` (por volta da linha 1600) ganha os dois campos novos:

```javascript
var ESTADO_CONGELAMENTO = { congelado: null, estado: null, chave: null, erro: null, carregando: false };
```

Por fim, em `montarAbaConsolidado` (por volta das linhas 1905-1911), trocar o wiring dos botões antigos:

```javascript
  var toggleCongelamento = document.getElementById('toggle-congelamento');
  if (toggleCongelamento) toggleCongelamento.addEventListener('change', alternarCongelamento);
  atualizarToggleCongelamento(chaveSemanaEscolhida);
```

(remove as 6 linhas de `botaoCongelar`/`atualizarBotaoCongelar`/`botaoDesfazer`/`atualizarBotaoDesfazer` que estavam ali).

- [ ] **Step 4: Rodar e confirmar que os testes passam**

Run: `node --test test/semanal-render-semanal-wireup.test.js`
Expected: PASS em todos os testes do arquivo (os novos e os pré-existentes que não mudaram).

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/render-semanal.js test/semanal-render-semanal-wireup.test.js
git commit -m "feat(congelamento): religa o toggle on/off na aba Consolidado, substitui os dois botoes antigos"
```

---

### Task 5: "Atualizar dados" recalcula e grava a linha de base quando a semana em tela está aberta

**Files:**
- Modify: `tools/semanal/live-refresh.js:214-519` (`atualizarDadosAoVivo`)
- Modify: `tools/semanal/render-semanal.js:2204-2233` (`atualizarDadosAoVivoSemanal`)
- Test: `test/semanal-render-semanal-wireup.test.js`

**Interfaces:**
- Consumes: `cfg.aplicar`/`cfg.definirStatus` (já existentes); `ESTADO_CONSOLIDADO`, `ESTADO_CONGELAMENTO`, `alternarCongelamento`'s snapshot logic (Task 4), `clienteCongelamento()` (Task 2).
- Produces: `config.aoAtualizarLinhaBase(registrosNovos, demandasNovas)` — novo campo opcional de `atualizarDadosAoVivo(config)`, chamado logo depois de `cfg.aplicar(...)`, sem bloquear o resto do refresh.

- [ ] **Step 1: Escrever o teste que falha (hook em `live-refresh.js`)**

Localizar o teste de `live-refresh.js` mais simples já existente (`test/semanal-atualizar-equipes-online.test.js` ou o arquivo que testa `atualizarDadosAoVivo` diretamente — buscar por `require('../tools/semanal/live-refresh.js')` em `test/*.test.js` para achar o arquivo certo) e adicionar:

```javascript
test('atualizarDadosAoVivo chama config.aoAtualizarLinhaBase depois de aplicar, sem bloquear o status final', async () => {
  const chamadas = [];
  const fetchMock = async (url) => {
    if (String(url).indexOf('matriz') !== -1) return { ok: true, text: async () => CSV_MATRIZ_MINIMO };
    return { ok: false, status: 404 };
  };
  const statusTextos = [];
  await LiveRefresh.atualizarDadosAoVivo({
    fontes: { matriz: 'https://exemplo/matriz.csv' },
    fetch: fetchMock,
    estadoAtual: () => ({ registros: [], demandas: DEMANDAS_VAZIAS_MINIMO }),
    aplicar: (registrosNovos, demandasNovas) => { chamadas.push('aplicar'); },
    aoAtualizarLinhaBase: (registrosNovos, demandasNovas) => { chamadas.push('aoAtualizarLinhaBase'); },
    definirStatus: (texto) => statusTextos.push(texto),
  });
  assert.deepEqual(chamadas, ['aplicar', 'aoAtualizarLinhaBase']);
  assert.match(statusTextos[statusTextos.length - 1], /^Atualizado/);
});

test('atualizarDadosAoVivo sem aoAtualizarLinhaBase continua funcionando normalmente (campo opcional)', async () => {
  const fetchMock = async (url) => {
    if (String(url).indexOf('matriz') !== -1) return { ok: true, text: async () => CSV_MATRIZ_MINIMO };
    return { ok: false, status: 404 };
  };
  const statusTextos = [];
  await LiveRefresh.atualizarDadosAoVivo({
    fontes: { matriz: 'https://exemplo/matriz.csv' },
    fetch: fetchMock,
    estadoAtual: () => ({ registros: [], demandas: DEMANDAS_VAZIAS_MINIMO }),
    aplicar: () => {},
    definirStatus: (texto) => statusTextos.push(texto),
  });
  assert.match(statusTextos[statusTextos.length - 1], /^Atualizado/);
});
```

Ajustar `CSV_MATRIZ_MINIMO`/`DEMANDAS_VAZIAS_MINIMO`/o mock de `fetch` para bater com o padrão real já usado no arquivo escolhido (o wireup de `atualizarDadosAoVivo` já tem fixtures prontas — reaproveitar, não reinventar).

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `node --test <arquivo escolhido no Step 1>`
Expected: FAIL — `aoAtualizarLinhaBase` nunca é chamado.

- [ ] **Step 3: Implementar o hook em `tools/semanal/live-refresh.js`**

Na linha 508 (`cfg.aplicar(registrosNovos, demandasNovas);`), logo depois, adicionar:

```javascript
      cfg.aplicar(registrosNovos, demandasNovas);

      // Linha de base da semana (2026-09-08): best-effort, nunca bloqueia
      // nem derruba o resto do refresh -- uma falha aqui é a MESMA classe
      // de degradação que o resto do congelamento já segue (avisa, não
      // quebra a página). Só a página Semanal (Consolidado) fornece este
      // callback; a Alocação Equipes não tem Consolidado.
      if (typeof cfg.aoAtualizarLinhaBase === 'function') {
        try {
          Promise.resolve(cfg.aoAtualizarLinhaBase(registrosNovos, demandasNovas)).catch(function () {});
        } catch (erroLinhaBase) { /* nunca deixa o refresh cair por causa disto */ }
      }
```

Atualizar também o comentário de cabeçalho de `atualizarDadosAoVivo` (por volta da linha 200) para documentar o novo campo `aoAtualizarLinhaBase` na lista de campos de `config`, junto de `aplicar`/`definirStatus`.

- [ ] **Step 4: Rodar e confirmar que os dois testes passam**

Run: `node --test <arquivo escolhido no Step 1>`
Expected: PASS.

- [ ] **Step 5: Escrever o teste que falha para o wiring em `render-semanal.js`**

Em `test/semanal-render-semanal-wireup.test.js`, adicionar:

```javascript
test('atualizarDadosAoVivoSemanal: com a semana do Consolidado ABERTA, "Atualizar dados" chama congelar (upsert da linha de base)', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const html = renderSemanal({
    registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-03-15T00:00:00Z'),
  });
  const chamadasPost = [];
  const fetchMock = (url, opcoes) => {
    if (opcoes && opcoes.body) {
      const corpo = JSON.parse(opcoes.body);
      chamadasPost.push(corpo);
      if (corpo.acao === 'ler') return Promise.resolve({ ok: true, json: () => Promise.resolve({ linhas: [], estado: { travada: false, autor: '', atualizadoEm: '' } }) });
      if (corpo.acao === 'congelar') return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, gravadas: corpo.linhas.length }) });
    }
    if (url.indexOf('pub?gid=609773455') !== -1) return Promise.resolve({ ok: true, text: () => Promise.resolve(CSV_MATRIZ_PRIORIDADE) });
    return Promise.resolve({ ok: false, status: 404 });
  };

  const { sandbox, documentoFalso } = montarSandbox(html, fetchMock);
  sandbox.URL_CONGELAMENTO = 'https://exemplo.com/congelamento-configurado';
  sandbox.window.__DASHBOARD_AUTOR__ = 'Autor Sintetico';
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();
  await esperarMicrotasks();
  await esperarMicrotasks();

  await chamarEsperarAtualizacao(sandbox);
  await esperarMicrotasks();
  await esperarMicrotasks();

  const chamadaCongelar = chamadasPost.find((c) => c.acao === 'congelar');
  assert.ok(chamadaCongelar, 'a semana aberta em tela tem de disparar um congelar (upsert) apos o refresh');
});

test('atualizarDadosAoVivoSemanal: com a semana do Consolidado TRAVADA, "Atualizar dados" NAO chama congelar', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const html = renderSemanal({
    registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-03-15T00:00:00Z'),
  });
  const chamadasPost = [];
  const fetchMock = (url, opcoes) => {
    if (opcoes && opcoes.body) {
      const corpo = JSON.parse(opcoes.body);
      chamadasPost.push(corpo);
      if (corpo.acao === 'ler') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({
          linhas: [{ chaveMatriz: 'SUP-0001-24||BL', volume: 1, financeiro: 1, equipe: 1, produtividadeMedia: 1, autor: 'Fulano', congeladoEm: 'x' }],
          estado: { travada: true, autor: 'Fulano', atualizadoEm: 'x' },
        }) });
      }
    }
    if (url.indexOf('pub?gid=609773455') !== -1) return Promise.resolve({ ok: true, text: () => Promise.resolve(CSV_MATRIZ_PRIORIDADE) });
    return Promise.resolve({ ok: false, status: 404 });
  };

  const { sandbox, documentoFalso } = montarSandbox(html, fetchMock);
  sandbox.URL_CONGELAMENTO = 'https://exemplo.com/congelamento-configurado';
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();
  await esperarMicrotasks();
  await esperarMicrotasks();

  await chamarEsperarAtualizacao(sandbox);
  await esperarMicrotasks();
  await esperarMicrotasks();

  assert.ok(!chamadasPost.some((c) => c.acao === 'congelar'), 'semana travada nao pode ser sobrescrita pelo refresh');
});
```

(`chamarEsperarAtualizacao`, `CSV_MATRIZ_PRIORIDADE`, `registroSintetico` já existem no arquivo — reaproveitar os mesmos usados nos testes de `atualizarDadosAoVivoSemanal` vizinhos.)

- [ ] **Step 6: Rodar e confirmar que falham**

Run: `node --test test/semanal-render-semanal-wireup.test.js`
Expected: FAIL — `atualizarDadosAoVivoSemanal` ainda não passa `aoAtualizarLinhaBase`.

- [ ] **Step 7: Implementar em `tools/semanal/render-semanal.js`**

Em `atualizarDadosAoVivoSemanal` (linhas 2204-2233), adicionar o campo `aoAtualizarLinhaBase` ao objeto passado a `LiveRefresh.atualizarDadosAoVivo`, depois de `aplicar`:

```javascript
    aoAtualizarLinhaBase: async function (registrosNovos, demandasNovas) {
      // Só a semana em tela no Consolidado -- outras semanas não estão
      // sendo olhadas agora, e recalcular todas a cada refresh custaria
      // uma chamada de rede por semana sem necessidade.
      var chaveSemanaEmTela = ESTADO_CONGELAMENTO.chave;
      var estado = ESTADO_CONGELAMENTO.estado;
      if (!chaveSemanaEmTela || !estado || estado.travada) return;
      var partes = chaveSemanaEmTela.split('-').map(Number);
      var epoch = Date.UTC(partes[0], partes[1] - 1, partes[2]) / 86400000;
      var segunda = CongelarTendenciaSemanal.segundaDaSemana(epoch);
      var hoje = hojeEpochDoNavegador();
      var snapshot = CongelarTendenciaSemanal.calcularSnapshotSemanaAlvo(registrosNovos, demandasNovas, hoje, segunda);
      var r = await clienteCongelamento().congelar(snapshot, window.__DASHBOARD_AUTOR__ || 'dashboard');
      if (r.ok) {
        ESTADO_CONGELAMENTO.estado = { travada: false, autor: window.__DASHBOARD_AUTOR__ || 'dashboard', atualizadoEm: new Date().toISOString() };
        if (typeof window.__REDESENHAR_CONSOLIDADO__ === 'function') window.__REDESENHAR_CONSOLIDADO__();
      }
      // r.motivo === 'travada': perdeu a corrida contra um toggle ligado no
      // meio do refresh -- nada a fazer, a próxima leitura mostra o estado
      // certo. Falha de rede/token: degrada em silêncio, mesma filosofia
      // do resto do congelamento (best-effort, não pode derrubar o refresh).
    },
```

- [ ] **Step 8: Rodar e confirmar que os testes passam**

Run: `node --test test/semanal-render-semanal-wireup.test.js`
Expected: PASS.

- [ ] **Step 9: Rodar a suíte inteira do repositório**

Run: `node --test test/*.test.js`
Expected: PASS em todos os arquivos.

- [ ] **Step 10: Commit**

```bash
git add tools/semanal/live-refresh.js tools/semanal/render-semanal.js test/semanal-render-semanal-wireup.test.js test/<arquivo-de-live-refresh-escolhido-no-step-1>.test.js
git commit -m "feat(congelamento): Atualizar dados grava a linha de base da semana quando ela esta aberta"
```

---

### Task 6: Build, publicação e atualização de `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md` (seção "Congelamento da semana por botão")
- Generate: `dist/planejamento-semanal.html`, `dist/alocacao-equipes.html`
- Copy: `docs/planejamento-semanal.html`, `docs/alocacao-equipes.html`

**Interfaces:**
- Consumes: todas as tasks anteriores já commitadas nesta branch.
- Produces: dashboard publicado; nenhuma interface nova de código.

- [ ] **Step 1: Rodar a suíte inteira uma última vez**

Run: `node --test test/*.test.js`
Expected: PASS em todos os arquivos, sem nenhum teste pulado por erro de sintaxe.

- [ ] **Step 2: Build**

Run: `ORCAMENTO_SENHA='<senha real, pedir ao dono do projeto ou usar a já em uso na máquina>' node tools/semanal/build-dashboard.js`
Expected: gera `dist/planejamento-semanal.html` e `dist/alocacao-equipes.html` sem erro.

- [ ] **Step 3: Sincronizar `docs/`**

```bash
cp dist/planejamento-semanal.html docs/planejamento-semanal.html
cp dist/alocacao-equipes.html docs/alocacao-equipes.html
```

- [ ] **Step 4: Atualizar `CLAUDE.md`**

Na seção `## Congelamento da semana por botão (2026-09-01)`, adicionar um parágrafo novo no topo (mantendo o resto do histórico como está, é registro do que já existiu):

```markdown
**Virou toggle on/off por semana em 2026-09-08** — o botão write-once
descrito abaixo foi substituído por um switch por semana (qualquer uma do
seletor do Consolidado, não só a próxima segunda): travada = "Atualizar
dados" não mexe; aberta = "Atualizar dados" recalcula e grava a linha de
base daquela semana (upsert, não mais recusa por reclique). Nova aba na
Sheet, `CongelamentoEstado` (uma linha por semana, chaveada pela
segunda-feira real), guarda esse estado — ver
`docs/superpowers/specs/2026-09-08-congelamento-toggle-design.md`. O texto
abaixo descreve o mecanismo de PONTOS (aba `Congelamento`, upsert,
formato de data em texto, fragmentos de semana que cruza mês), que
continua valendo sem mudança; só a regra de "uma vez só" mudou.
```

E revisar a frase "**Reclique é recusado, de propósito**" logo abaixo — ela não é mais verdade para `congelar` em geral (só quando a semana está travada); ajustar para: "**Reclique só é recusado quando a semana está travada.**" com uma frase curta remetendo ao parágrafo novo do topo.

- [ ] **Step 5: Verificar publicação byte a byte**

Run: `node --test test/publicacao-docs-sincronizado.test.js`
Expected: PASS (trava que `dist/`/`docs/` ficaram idênticos).

- [ ] **Step 6: Commit e push**

```bash
git add dist/planejamento-semanal.html dist/alocacao-equipes.html docs/planejamento-semanal.html docs/alocacao-equipes.html CLAUDE.md
git commit -m "chore: reconstroi o dashboard semanal -- congelamento vira toggle on/off por semana"
git push origin master
```

**Nota:** o Apps Script (`tools/semanal/apps-script-congelamento.gs`) precisa ser **reimplantado manualmente** no Google Apps Script depois deste push — o repositório não publica o `.gs` sozinho (mesmo processo já documentado em `docs/implantar-apps-script-congelamento.md`). Sem reimplantar, o cliente novo (que manda `acao:'travar'`/`'destravar'` e espera `estado` na resposta de `ler`) fala com uma versão antiga do Web App que não reconhece essas ações — travar/destravar falhariam com `{ok:false}` silencioso, e o toggle ficaria sempre preso no estado anterior. Confirmar com o dono do projeto antes deste passo, e testar de ponta a ponta (travar uma semana de teste, destravar, clicar "Atualizar dados" numa semana aberta) contra a Sheet real antes de considerar a tarefa concluída.

---

## Self-Review Notes

- **Cobertura do spec:** modelo de dados (Task 1), contrato do Apps Script (Task 1), cliente (Task 2), UI/switch (Tasks 3-4), "Atualizar dados" (Task 5), compatibilidade com semanas já congeladas (Task 1, Step 1/7), fora de escopo (`desfazer` sem UI — Task 1 mantém só o handler; nenhuma task adiciona botão para ele).
- **Consistência de nomes:** `travar`/`destravar`/`congelar` usados de forma idêntica em `.gs` (Task 1), `congelamento-sheet.js` (Task 2) e `render-semanal.js` (Tasks 4-5); `chaveSegunda` é sempre a segunda-feira REAL (via `segundaDaSemana`), nunca a chave de fragmento em tela — helper reusado nas Tasks 4 e 5 exatamente como `desfazerCongelamentoDaSemana` já fazia antes desta mudança.
- **Risco de implantação manual do Apps Script** (Task 6) é o maior ponto de atenção deste plano — documentado explicitamente no último passo, porque é o tipo de coisa que "funciona nos testes" e falha ao vivo sem aviso claro (mesma classe de risco que este projeto já registrou várias vezes em `CLAUDE.md`).
