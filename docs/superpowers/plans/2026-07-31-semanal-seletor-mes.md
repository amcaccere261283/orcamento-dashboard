# Seletor de mês na Tabela Semanal/Gráficos — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o usuário escolher qual mês do ano ver na Tabela Semanal e
na aba Gráficos (hoje sempre travado no mês vigente), pra poder rever o
fechamento de um mês já passado (ex.: julho).

**Architecture:** `renderAbaSemanal`/`renderAbaGraficoSemanal` já recebem um
índice de mês (0-11) como parâmetro genérico e já se comportam certo pra
mês passado/vigente/futuro (ver spec) -- não muda nada nelas. O trabalho
inteiro é trocar a fonte desse índice de uma constante fixa
(`window.__VIGENTE_IDX__`) por um estado de UI (`mesSelecionadoIdx`) que o
usuário controla via um `<select>` novo.

**Tech Stack:** Mesmo do resto do repositório -- Node.js, `node:test`, JS
puro no navegador, sem dependências novas.

**Spec:** `docs/superpowers/specs/2026-07-31-semanal-seletor-mes-design.md`.

## Global Constraints

- Afeta SÓ as abas Semanal e Gráficos. Balanço de massa e Demandas não
  mudam (Balanço já tem seu próprio controle de período, independente).
- Nenhuma mudança em `tools/semanal/compute-semanal.js`,
  `tools/semanal/render-aba-semanal.js`,
  `tools/semanal/render-aba-grafico-semanal.js`,
  `tools/semanal/compute-balanco.js`, `tools/semanal/render-aba-balanco.js`
  -- a lógica de cálculo por mês já é genérica.
- `atualizarDadosAoVivoSemanal()` (botão "Atualizar dados") não pode
  resetar `mesSelecionadoIdx` pro mês vigente -- atualizar dados não deve
  jogar o usuário de volta pro mês vigente se ele estava olhando outro.
- Depois de cada task: `node --test test/*.test.js` 100% verde.

---

### Task 1: Markup do `<select id="seletor-mes-semanal">` (12 meses, estático)

**Files:**
- Modify: `tools/semanal/render-semanal.js`
- Test: `test/semanal-render-semanal-wireup.test.js`

**Interfaces:**
- Produces: `<select id="seletor-mes-semanal">` com 12 `<option value="0">Jan</option>`..`<option value="11">Dez</option>`,
  dentro de `MARKUP_ACOES_SEMANAL`, ANTES do botão "Atualizar dados".
  Consumida pela Task 2 (estado do cliente lê/escreve `.value` deste
  elemento).

- [ ] **Step 1: Acrescentar `MESES_PT_CURTO_SERVIDOR` e gerar as 12 `<option>`**

Em `tools/semanal/render-semanal.js`, logo antes de `const MARKUP_ACOES_SEMANAL = ...`, acrescente:

```js
// 12 rótulos curtos (Jan..Dez), só pra montar o <select> de mês no HTML
// estático do build -- duplicado de propósito (array pequeno e estável,
// mesmo raciocínio de diaEpoch duplicado em compute-semanal.js): não vale
// exportar MESES_PT de tools/comum/datas.js só por causa disto. O CLIENTE
// tem sua PRÓPRIA cópia (MESES_PT_CURTO, dentro de SCRIPT_CLIENTE_SEMANAL,
// Task 2) -- as duas nunca precisam concordar em tempo de execução (o
// servidor só usa a dele pra montar o HTML inicial; o cliente nunca lê
// esta constante).
const MESES_PT_CURTO_SERVIDOR = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function opcoesMesSemanal() {
  return MESES_PT_CURTO_SERVIDOR.map(function (rotulo, i) {
    return '<option value="' + i + '">' + rotulo + '</option>';
  }).join('');
}
```

Troque:

```js
const MARKUP_ACOES_SEMANAL = `      <div class="filtros-acoes">
        <button id="atualizar-dashboard" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16M3 21v-5h5"/></svg>Atualizar dados</button>
        <span id="status-atualizacao" class="status-atualizacao"></span>
      </div>`;
```

por:

```js
const MARKUP_ACOES_SEMANAL = `      <div class="filtros-acoes">
        <label class="controle-mes-semanal">Mês<select id="seletor-mes-semanal">${opcoesMesSemanal()}</select></label>
        <button id="atualizar-dashboard" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16M3 21v-5h5"/></svg>Atualizar dados</button>
        <span id="status-atualizacao" class="status-atualizacao"></span>
      </div>`;
```

- [ ] **Step 2: CSS mínima pro `<label class="controle-mes-semanal">`**

Em `CSS_SEMANAL` (mesmo arquivo), logo depois do bloco
`.controle-balanco-check input[type="checkbox"] { accent-color: #f6b53f; cursor: pointer; }`
(mesmo esquema de cor/borda de `.controle-balanco select`, mas `flex-direction: row` -- este controle fica INLINE dentro de `.filtros-acoes`, ao lado do botão, não empilhado como os controles do Balanço de massa):

```css
  .controle-mes-semanal { display: flex; flex-direction: row; align-items: center; gap: 8px; font-size: 13px; color: var(--text-secondary); }
  .controle-mes-semanal select {
    padding: 6px 26px 6px 10px; height: 32px;
    border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface-1) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23c3c2b7' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 10px center;
    color: var(--text-primary);
    font-size: 13px; cursor: pointer;
    appearance: none; -webkit-appearance: none; -moz-appearance: none;
  }
  .controle-mes-semanal select:hover { border-color: rgba(246,181,63,0.5); }
  .controle-mes-semanal select:focus-visible { outline: 2px solid #f6b53f; outline-offset: 2px; }
```

(Mesmos tokens de cor/borda de `.controle-balanco select`, já existente no
mesmo arquivo -- `var(--border)`, `var(--surface-1)`, `var(--text-primary)`,
`#f6b53f` -- só a orientação do flex e a altura mudam.)

- [ ] **Step 3: Teste confirmando o markup**

Acrescente a `test/semanal-render-semanal-wireup.test.js` (perto do teste
`'o HTML da semanal tem o botão "Atualizar dados"...'`):

```js
test('o HTML da semanal tem o seletor de mês com as 12 opções (Jan..Dez, valores "0".."11")', () => {
  const html = renderSemanal({ registros: [], baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z') });
  assert.match(html, /<select id="seletor-mes-semanal">/);
  const opcoes = [...html.matchAll(/<option value="(\d+)">(\w+)<\/option>/g)];
  assert.deepStrictEqual(opcoes.map((m) => m[1]), ['0','1','2','3','4','5','6','7','8','9','10','11']);
  assert.deepStrictEqual(opcoes.map((m) => m[2]), ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']);
});
```

- [ ] **Step 4: Rodar os testes**

Run: `node --test test/semanal-render-semanal-wireup.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/render-semanal.js test/semanal-render-semanal-wireup.test.js
git commit -m "feat: markup do seletor de mês (Jan..Dez) na página semanal"
```

---

### Task 2: Estado do cliente + wiring em `montarAbaGraficoSemanal`/`recalcularSemanal`/`montarDashboard`

**Files:**
- Modify: `tools/semanal/render-semanal.js`

**Interfaces:**
- Produces: `mesSelecionadoIdx` (var de estado, dentro de
  `SCRIPT_CLIENTE_SEMANAL`), inicializada a partir de
  `window.__VIGENTE_IDX__` (com clamp pra `[0,11]`).
- Modifies: assinatura de `montarAbaGraficoSemanal` ganha um parâmetro
  `vigenteIdx` (deixa de ler `window.__VIGENTE_IDX__` direto).

- [ ] **Step 1: Adicionar `mesSelecionadoIdx` e `MESES_PT_CURTO` (cópia do cliente)**

Dentro de `SCRIPT_CLIENTE_SEMANAL`, logo depois de
`var filtrosSelecionadosSemanal = {};` ... `filtrosSelecionadosSemanal.dimensao.add('financeiro');`
(mesmo bloco de inicialização de estado), acrescente:

```js
// Índice do mês (0-11) que a Tabela Semanal/Gráficos mostram -- começa no
// vigente, mas o usuário pode trocar pelo <select> #seletor-mes-semanal
// (ver montarDashboard). O clamp cobre o caso raro de window.__VIGENTE_IDX__
// vir fora de [0,11] (ano inteiro no passado/futuro -- ver calcularVigenteIdx).
var mesSelecionadoIdx = Math.max(0, Math.min(11, window.__VIGENTE_IDX__));
```

- [ ] **Step 2: `montarAbaGraficoSemanal` passa a receber `vigenteIdx` em vez de ler `window.__VIGENTE_IDX__`**

Troque:

```js
function montarAbaGraficoSemanal(registros, indices, dimensoes, hojeEpoch) {
  document.getElementById('grafico-semanal-conteudo').innerHTML = RenderAbaGraficoSemanal.renderAbaGraficoSemanal(registros, indices, dimensoes, {
    vigenteIdx: window.__VIGENTE_IDX__,
    ano: window.__ANO__,
    demandas: window.__DEMANDAS__,
    hojeEpoch: hojeEpoch,
  });
}
```

por:

```js
function montarAbaGraficoSemanal(registros, indices, dimensoes, vigenteIdx, hojeEpoch) {
  document.getElementById('grafico-semanal-conteudo').innerHTML = RenderAbaGraficoSemanal.renderAbaGraficoSemanal(registros, indices, dimensoes, {
    vigenteIdx: vigenteIdx,
    ano: window.__ANO__,
    demandas: window.__DEMANDAS__,
    hojeEpoch: hojeEpoch,
  });
}
```

(o nome do parâmetro continua `vigenteIdx` de propósito -- é o mesmo nome
que `renderAbaGraficoSemanal`/`renderAbaSemanal` já usam internamente pra
"índice do mês sendo mostrado"; só quem CHAMA estas funções passa a decidir
qual índice é esse, ver Step 3.)

- [ ] **Step 3: `recalcularSemanal` usa `mesSelecionadoIdx`**

Troque:

```js
  document.getElementById('secao-semanal').innerHTML = RenderAbaSemanal.renderAbaSemanal(
    window.__REGISTROS__, indices, dimensoes, window.__VIGENTE_IDX__, window.__ANO__,
    { demandas: window.__DEMANDAS__, hojeEpoch: hojeEpoch }
  );
  montarAbaGraficoSemanal(window.__REGISTROS__, indices, dimensoes, hojeEpoch);
  montarAbaBalanco(window.__REGISTROS__, indices);
```

por:

```js
  document.getElementById('secao-semanal').innerHTML = RenderAbaSemanal.renderAbaSemanal(
    window.__REGISTROS__, indices, dimensoes, mesSelecionadoIdx, window.__ANO__,
    { demandas: window.__DEMANDAS__, hojeEpoch: hojeEpoch }
  );
  montarAbaGraficoSemanal(window.__REGISTROS__, indices, dimensoes, mesSelecionadoIdx, hojeEpoch);
  montarAbaBalanco(window.__REGISTROS__, indices);
```

(`montarAbaBalanco` NÃO muda -- continua lendo `window.__VIGENTE_IDX__`
direto, de propósito: Balanço de massa é fora de escopo desta feature, ver
Global Constraints.)

- [ ] **Step 4: Ligar o `<select>` em `montarDashboard`**

Troque:

```js
function montarDashboard(registros) {
  document.getElementById('aba-semanal').addEventListener('click', function () { alternarAba('semanal'); });
  document.getElementById('aba-grafico-semanal').addEventListener('click', function () { alternarAba('grafico-semanal'); });
  document.getElementById('aba-balanco').addEventListener('click', function () { alternarAba('balanco'); });
  document.getElementById('aba-demandas').addEventListener('click', function () { alternarAba('demandas'); });
```

por:

```js
function montarDashboard(registros) {
  document.getElementById('aba-semanal').addEventListener('click', function () { alternarAba('semanal'); });
  document.getElementById('aba-grafico-semanal').addEventListener('click', function () { alternarAba('grafico-semanal'); });
  document.getElementById('aba-balanco').addEventListener('click', function () { alternarAba('balanco'); });
  document.getElementById('aba-demandas').addEventListener('click', function () { alternarAba('demandas'); });
  var seletorMes = document.getElementById('seletor-mes-semanal');
  seletorMes.value = String(mesSelecionadoIdx);
  seletorMes.addEventListener('change', function (e) {
    mesSelecionadoIdx = parseInt(e.target.value, 10);
    recalcularSemanal();
  });
```

- [ ] **Step 5: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS (nenhum teste existente afirma a assinatura antiga de
`montarAbaGraficoSemanal` diretamente -- só via `recalcularSemanal`, que já
foi ajustado no mesmo passo).

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/render-semanal.js
git commit -m "feat: mesSelecionadoIdx substitui window.__VIGENTE_IDX__ nas abas Semanal/Gráficos"
```

---

### Task 3: `atualizarDadosAoVivoSemanal()` não reseta `mesSelecionadoIdx`

**Files:**
- Modify: `tools/semanal/render-semanal.js` (confirmar, sem mudança de código -- ver Step 1)
- Test: `test/semanal-render-semanal-wireup.test.js`

**Interfaces:**
- Nenhuma interface nova -- esta task é uma VERIFICAÇÃO + teste de
  regressão, não uma mudança funcional (a Task 2 já deixou
  `atualizarDadosAoVivoSemanal` correto por construção, ver Step 1).

- [ ] **Step 1: Confirmar que não há nenhuma mudança de código necessária**

Releia `atualizarDadosAoVivoSemanal()` (`tools/semanal/render-semanal.js`).
Ela chama `montarTodosFiltrosMultiSemanal(window.__REGISTROS__)` e
`recalcularSemanal()` -- nenhuma das duas toca em `mesSelecionadoIdx`, e
`recalcularSemanal()` já lê a variável de estado (Task 2), não
`window.__VIGENTE_IDX__` -- então o refresh JÁ preserva o mês selecionado
sem precisar de nenhuma mudança adicional. Esta task só escreve o teste que
prova isso (Step 2) -- se o teste passar sem tocar em
`render-semanal.js`, está correto; se falhar, algo na Task 2 ficou incompleto
e precisa ser revisto antes de prosseguir.

- [ ] **Step 2: Teste de regressão**

Acrescente a `test/semanal-render-semanal-wireup.test.js`, perto dos testes
de `atualizarDadosAoVivoSemanal` já existentes:

```js
test('atualizarDadosAoVivoSemanal NÃO reseta o mês selecionado pro vigente -- se o usuário estava olhando outro mês, o refresh preserva a escolha', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const geradoEm = new Date('2026-07-01T00:00:00Z'); // vigenteIdx = 6 (julho)
  const html = renderSemanal({ registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });

  const fetchMock = (url) => url.indexOf('pub?gid=609773455') !== -1
    ? Promise.resolve({ ok: true, text: () => Promise.resolve('ORIGEM,GRUPO,TOMADOR,SUP,ESCOPO,APOIO,INICIO,TERMINO,SONDAGEM,BASE\n') })
    : Promise.reject(new Error('não deveria buscar Avanços/Lab com as URLs ainda placeholder: ' + url));

  const { sandbox, documentoFalso } = montarSandbox(html, fetchMock);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  // Usuário troca pra março (índice 2) ANTES de clicar em Atualizar dados.
  sandbox.mesSelecionadoIdx = 2;

  // MATRIZ mockada acima não tem nenhum registro -- vai lançar
  // "nenhum registro encontrado", cai no .catch, mas isso não importa aqui:
  // o que este teste prova é que mesSelecionadoIdx não é tocado em NENHUM
  // ponto do fluxo de atualizarDadosAoVivoSemanal, sucesso ou falha.
  sandbox.atualizarDadosAoVivoSemanal();
  await new Promise((resolve) => setImmediate(resolve));

  assert.strictEqual(sandbox.mesSelecionadoIdx, 2, 'mesSelecionadoIdx não pode ser resetado pelo refresh de dados');
});
```

- [ ] **Step 3: Rodar os testes**

Run: `node --test test/semanal-render-semanal-wireup.test.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add test/semanal-render-semanal-wireup.test.js
git commit -m "test: atualizarDadosAoVivoSemanal preserva mesSelecionadoIdx"
```

---

### Task 4: Teste de wireup ponta-a-ponta -- trocar o seletor recalcula a Tabela Semanal com o mês escolhido

**Files:**
- Modify: `test/semanal-render-semanal-wireup.test.js`

**Interfaces:**
- Nenhuma interface nova -- só prova, com o HTML real rodando num
  `vm.Context`, que disparar `change` no `<select>` troca o mês exibido.

- [ ] **Step 1: Escrever o teste**

Acrescente a `test/semanal-render-semanal-wireup.test.js`:

```js
test('trocar o <select> de mês recalcula a Tabela Semanal com as semanas do mês escolhido, não mais o vigente', async () => {
  // Julho e Agosto de 2026 têm quebras de semana DIFERENTES (números de
  // semana distintos) -- comparar o número de semanas renderizadas entre os
  // dois é prova suficiente de que o mês realmente mudou, sem precisar
  // recalcular a mão o Previsto esperado de cada um.
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const geradoEm = new Date('2026-07-01T00:00:00Z'); // vigenteIdx = 6 (julho)
  const html = renderSemanal({ registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  const semanalAntes = documentoFalso.getElementById('secao-semanal').innerHTML;
  // renderCabecalho (tools/semanal/render-aba-semanal.js) emite um <th> por
  // semana com o rótulo "S<n> (dd/mm a dd/mm)", sem classe nenhuma -- contar
  // quantos <th>S\d aparecem é uma prova mais direta de que o número real de
  // semanas mudou (julho e agosto de 2026 não têm a mesma quantidade) do que
  // inventar uma classe CSS que o HTML real não tem.
  const semanasNoHtml = (html) => (html.match(/<th>S\d+ /g) || []).length;
  const colunasJulho = semanasNoHtml(semanalAntes);

  // test/helpers/dom-falso-semanal.js não implementa dispatchEvent -- o
  // padrão já estabelecido no repositório (ver test/comum-filtros-wireup.test.js,
  // test/semanal-render-aba-demandas-wireup.test.js) é chamar o listener
  // guardado em `.listeners.change` direto, com um evento sintético mínimo.
  documentoFalso.getElementById('seletor-mes-semanal').listeners.change({ target: { value: '7' } }); // Agosto

  assert.strictEqual(sandbox.mesSelecionadoIdx, 7, 'mesSelecionadoIdx precisa refletir a escolha do usuário');
  const semanalDepois = documentoFalso.getElementById('secao-semanal').innerHTML;
  assert.notStrictEqual(semanalDepois, semanalAntes, 'a Tabela Semanal precisa ter sido redesenhada de verdade, não só o estado interno mudado');
  assert.notStrictEqual(semanasNoHtml(semanalDepois), colunasJulho, 'julho e agosto de 2026 têm quantidades de semana diferentes -- se o número bater, o mês não mudou de verdade');
});
```

- [ ] **Step 2: Rodar os testes**

Run: `node --test test/semanal-render-semanal-wireup.test.js`
Expected: PASS

- [ ] **Step 3: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: 100% verde.

- [ ] **Step 4: Commit**

```bash
git add test/semanal-render-semanal-wireup.test.js
git commit -m "test: trocar o seletor de mês recalcula a Tabela Semanal de ponta a ponta"
```
