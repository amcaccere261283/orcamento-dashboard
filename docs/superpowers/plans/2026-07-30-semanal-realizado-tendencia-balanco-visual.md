# Realizado/Tendência semanal + ajustes no Balanço de massa Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preencher Realizado/Tendência (dimensão Volume) e uma nova linha Demandas Pendentes na Tabela semanal, a partir da série "Sondagem Realizada" do Avanço Sond (já disponível via a aba Demandas). No Balanço de massa, adicionar uma coluna de Tomador ao lado do SUP e ajustar a legibilidade visual (fonte menor, divisórias entre linhas).

**Architecture:** `compute-demandas.js` ganha um segundo agregado (`porRegistro`, chaveado por `sup||tipologia`, mesma expressão de `chaveMatriz`) na MESMA passada pelos furos que já produz o agregado por tipologia — sem reler a planilha. `compute-semanal.js` ganha `semanaAtual`, estendendo a mesma lógica de fatiamento nominal que `dividirEmSemanas` já aplica ao valor, agora aplicada ao calendário. `render-aba-semanal.js` ganha um 5º parâmetro opcional (`realizado`) que, quando presente com `porRegistro`, ativa Realizado/Tendência/Pendentes só no bloco Volume — ausente ou incompleto, o comportamento de hoje (tudo sem-dado) continua idêntico, então nenhum teste existente muda. `render-semanal.js` calcula `diaDoMes`/`diasNoMes` do relógio do cliente (`new Date()`) a cada recálculo e repassa. `compute-balanco.js`/`render-aba-balanco.js` ganham o campo `tomador` e os dois ajustes visuais no SVG.

**Tech Stack:** Node.js puro (`node:test`), sem dependências. Módulos que entram no bundle do navegador (`render-aba-semanal.js`, `render-aba-balanco.js`, `compute-semanal.js`, `compute-balanco.js`) ficam em ES5 (`var`/`function`). `compute-demandas.js` é Node-only (não entra no bundle) e pode usar `const`/`Map`/`Object.fromEntries` livremente, como já faz hoje.

## Global Constraints

- No new npm dependencies — este repositório não tem `package.json`.
- Módulos bundlados (`tools/semanal/render-aba-semanal.js`, `render-aba-balanco.js`, `compute-semanal.js`, `compute-balanco.js`) ficam em ES5 puro — `var`/`function`, nunca `const`/`let`/arrow no escopo do módulo, e qualquer `require('./arquivo.js')` de irmão na forma exata `const { X } = require('./arquivo.js');` (sem espaço antes do parêntese) — é o único formato que `tools/comum/browser-bundle.js` reescreve.
- `tools/semanal/compute-demandas.js` **não entra no bundle** (roda só no build, em Node) — pode importar `../comum/linha-base.js` livremente, mesmo padrão que já usa para `../comum/tipologias-avancos.js`.
- **`renderAbaSemanal`'s 5º parâmetro (`realizado`) é opcional e aditivo.** Toda chamada existente com 4 argumentos continua produzindo exatamente o mesmo HTML de hoje — nenhum teste que já passa deve precisar mudar por causa deste plano.
- Ausência de uma combinação `(sup, tipologia)` em `demandas.porRegistro` significa **zero furos**, nunca `null` — só `indices` vazio (nenhum registro selecionado) produz `null` nas somas novas, mesma regra que `previstoMesVigente` já segue para o Previsto.
- `test/orcamento-html-inalterado.test.js` deve continuar passando sem regenerar o golden — nada neste plano toca `tools/orcamento/*`.

---

### Task 1: `porRegistro` em compute-demandas.js + `semanaAtual` em compute-semanal.js

**Files:**
- Modify: `tools/semanal/compute-demandas.js`, `tools/semanal/compute-semanal.js`
- Test: `test/semanal-compute-demandas.test.js`, `test/semanal-compute-semanal.test.js`

**Interfaces:**
- Produces: `computeDemandas(furos, periodos)` — objeto de retorno ganha a chave `porRegistro: { [chave]: { sondagemRealizada: number[12], pendentes: number[12] } }`, chave = `sup + '||' + tipologia` (mesma expressão de `chaveMatriz`, `tools/comum/linha-base.js`). `semanaAtual(diaDoMes, diasNoMes)` — nova função em `compute-semanal.js`, devolve inteiro 1-4.

- [ ] **Step 1: Escrever os testes de `porRegistro`**

Em `test/semanal-compute-demandas.test.js`, adicionar (mantendo os testes existentes intactos):

```js
test('porRegistro agrega sondagemRealizada e pendentes por (sup, tipologia), na mesma passada que o agregado por tipologia', () => {
  const furos = [
    // 2 furos do mesmo SUP+tipologia, sondagem terminada em meses diferentes.
    { sup: 'SUP-0001-24', tipologia: 'ST', status: 'CONCLUIDO', criacaoOS: new Date(Date.UTC(2026, 0, 5)), terminoSondagem: new Date(Date.UTC(2026, 1, 10)), conclusao: new Date(Date.UTC(2026, 1, 15)), cancelamento: null },
    { sup: 'SUP-0001-24', tipologia: 'ST', status: 'EXECUTADO', criacaoOS: new Date(Date.UTC(2026, 0, 6)), terminoSondagem: new Date(Date.UTC(2026, 2, 1)), conclusao: null, cancelamento: null },
    // Outro SUP, mesma tipologia -- não pode se misturar com o de cima.
    { sup: 'SUP-0002-24', tipologia: 'ST', status: 'CONCLUIDO', criacaoOS: new Date(Date.UTC(2026, 0, 1)), terminoSondagem: new Date(Date.UTC(2026, 1, 20)), conclusao: new Date(Date.UTC(2026, 1, 25)), cancelamento: null },
  ];
  const periodos = Array.from({ length: 12 }, (_, m) => new Date(Date.UTC(2026, m, 1)));
  const { porRegistro } = computeDemandas(furos, periodos);

  assert.deepStrictEqual(porRegistro['SUP-0001-24||ST'].sondagemRealizada[1], 1, 'só o furo CONCLUIDO terminou sondagem em fevereiro (índice 1)');
  assert.deepStrictEqual(porRegistro['SUP-0001-24||ST'].sondagemRealizada[2], 1, 'o furo EXECUTADO terminou sondagem em março (índice 2)');
  assert.deepStrictEqual(porRegistro['SUP-0002-24||ST'].sondagemRealizada[1], 1, 'SUP diferente não pode somar no bucket do SUP-0001-24');
  assert.strictEqual(porRegistro['SUP-0001-24||ST'].sondagemRealizada.reduce((a, b) => a + b, 0), 2, 'total de sondagens realizadas do SUP-0001-24/ST no ano');
});

test('par (sup, tipologia) sem nenhum furo fica AUSENTE de porRegistro, não aparece com zeros', () => {
  const furos = [
    { sup: 'SUP-0001-24', tipologia: 'ST', status: 'CONCLUIDO', criacaoOS: new Date(Date.UTC(2026, 0, 1)), terminoSondagem: new Date(Date.UTC(2026, 0, 15)), conclusao: new Date(Date.UTC(2026, 0, 20)), cancelamento: null },
  ];
  const periodos = Array.from({ length: 12 }, (_, m) => new Date(Date.UTC(2026, m, 1)));
  const { porRegistro } = computeDemandas(furos, periodos);
  assert.strictEqual('SUP-9999-99||ST' in porRegistro, false, 'quem lê porRegistro trata ausência como zero -- este teste garante que a ausência é real, não uma entrada zerada');
});

test('pendentes em porRegistro fecha com o mesmo saldo por (sup, tipologia) que o agregado geral fecharia se só houvesse esse par', () => {
  const furos = [
    { sup: 'SUP-0001-24', tipologia: 'ST', status: 'PENDENTE', criacaoOS: new Date(Date.UTC(2026, 0, 10)), terminoSondagem: null, conclusao: null, cancelamento: null },
  ];
  const periodos = Array.from({ length: 12 }, (_, m) => new Date(Date.UTC(2026, m, 1)));
  const { porRegistro, totais } = computeDemandas(furos, periodos);
  assert.deepStrictEqual(porRegistro['SUP-0001-24||ST'].pendentes, totais.pendentes, 'com um único (sup, tipologia) na planilha, o saldo por registro tem que bater com o saldo total');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/semanal-compute-demandas.test.js`
Expected: FAIL — `porRegistro` ainda não existe no retorno de `computeDemandas` (`undefined` ao acessar `porRegistro['SUP-0001-24||ST']`).

- [ ] **Step 3: Implementar `porRegistro` em `compute-demandas.js`**

Adicionar o import de `chaveMatriz` (linha 2, junto do import existente):

```js
const { ORDEM_TIPOLOGIAS, SO_QUANDO_ACIONADA } = require('../comum/tipologias-avancos.js');
const { chaveMatriz } = require('../comum/linha-base.js');
```

Adicionar, logo após `function serieVazia(quantidade) {...}` (antes de `function computeDemandas`):

```js
// Só as 2 séries que a Tabela semanal precisa (Realizado/Tendência/Pendentes
// da dimensão Volume) -- não os 5, YAGNI. Chaveado por (sup, tipologia) --
// MESMA expressão de chaveMatriz (tools/comum/linha-base.js), reaproveitada
// aqui de propósito: este módulo é Node-only (não entra no bundle do
// navegador), o require é seguro.
function serieRegistroVazia(quantidade) {
  return { sondagemRealizada: zeros12(quantidade), pendentes: zeros12(quantidade) };
}
```

Dentro de `computeDemandas`, logo após a linha `const porTipologia = new Map();`, adicionar:

```js
  const porRegistro = new Map();
```

Dentro do loop `for (const f of furos || []) {`, logo após a linha `const cancelado = f.status === 'CANCELADO';`, adicionar:

```js
    const chaveRegistro = chaveMatriz(f.sup, f.tipologia);
    if (!porRegistro.has(chaveRegistro)) porRegistro.set(chaveRegistro, serieRegistroVazia(n));
    const serieRegistro = porRegistro.get(chaveRegistro);
```

Modificar o bloco de `sondagemRealizada` (dentro de `if (STATUS_REALIZADO.indexOf(f.status) !== -1) {`), de:

```js
    if (STATUS_REALIZADO.indexOf(f.status) !== -1) {
      const iSondagem = indiceDoMes(f.terminoSondagem, periodos);
      if (iSondagem >= 0) series.sondagemRealizada[iSondagem] += 1;
    }
```

para:

```js
    if (STATUS_REALIZADO.indexOf(f.status) !== -1) {
      const iSondagem = indiceDoMes(f.terminoSondagem, periodos);
      if (iSondagem >= 0) { series.sondagemRealizada[iSondagem] += 1; serieRegistro.sondagemRealizada[iSondagem] += 1; }
    }
```

Modificar o bloco de estoque (pendentes), de:

```js
    if (f.criacaoOS) {
      for (let i = 0; i < n; i++) {
        if (f.criacaoOS > fins[i]) continue;
        const terminou = f.terminoSondagem && f.terminoSondagem <= fins[i];
        const cancelou = f.cancelamento && f.cancelamento <= fins[i];
        if (!terminou && !cancelou) series.pendentes[i] += 1;
      }
    }
```

para:

```js
    if (f.criacaoOS) {
      for (let i = 0; i < n; i++) {
        if (f.criacaoOS > fins[i]) continue;
        const terminou = f.terminoSondagem && f.terminoSondagem <= fins[i];
        const cancelou = f.cancelamento && f.cancelamento <= fins[i];
        if (!terminou && !cancelou) { series.pendentes[i] += 1; serieRegistro.pendentes[i] += 1; }
      }
    }
```

E o `return` final de `computeDemandas`, de `return { tipologias, totais };` para:

```js
  return { tipologias, totais, porRegistro: Object.fromEntries(porRegistro) };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/semanal-compute-demandas.test.js`
Expected: PASS, incluindo os testes existentes (nada removido, só adicionado).

- [ ] **Step 5: Escrever o teste de `semanaAtual`**

Em `test/semanal-compute-semanal.test.js`, adicionar:

```js
test('semanaAtual divide os dias do mês em 4 fatias nominais, mesma lógica de dividirEmSemanas aplicada ao calendário', () => {
  // Mês de 28 dias -- cada fatia nominal tem exatamente 7 dias.
  assert.strictEqual(semanaAtual(1, 28), 1);
  assert.strictEqual(semanaAtual(7, 28), 1);
  assert.strictEqual(semanaAtual(8, 28), 2);
  assert.strictEqual(semanaAtual(14, 28), 2);
  assert.strictEqual(semanaAtual(15, 28), 3);
  assert.strictEqual(semanaAtual(21, 28), 3);
  assert.strictEqual(semanaAtual(22, 28), 4);
  assert.strictEqual(semanaAtual(28, 28), 4);
});

test('semanaAtual nunca sai de [1,4], mesmo em mês de 31 dias (fatias não fecham em número inteiro de dias)', () => {
  assert.strictEqual(semanaAtual(1, 31), 1);
  assert.strictEqual(semanaAtual(31, 31), 4);
  for (let dia = 1; dia <= 31; dia++) {
    const s = semanaAtual(dia, 31);
    assert.ok(s >= 1 && s <= 4, `dia ${dia}/31 produziu semana ${s}, fora de [1,4]`);
  }
});
```

Atualizar o `require` no topo do arquivo de teste para incluir `semanaAtual`:

```js
const { dividirEmSemanas, fecharMes, SEMANAS, semanaAtual } = require('../tools/semanal/compute-semanal.js');
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `node --test test/semanal-compute-semanal.test.js`
Expected: FAIL — `semanaAtual is not a function`.

- [ ] **Step 7: Implementar `semanaAtual` em `compute-semanal.js`**

Adicionar, logo antes de `// FIM CLIENTE >>>`:

```js
// diaDoMes: 1-31. diasNoMes: total de dias do mês vigente (28-31). Devolve
// 1-4 -- qual fatia nominal do mês "hoje" cai dentro, com a MESMA divisão em
// 4 partes iguais que dividirEmSemanas já aplica ao VALOR mensal, agora
// aplicada ao CALENDÁRIO -- não semanas ISO, mesmo espírito do resto deste
// arquivo. Math.min/max travam o resultado em [1,4] mesmo quando as fatias
// não fecham em número inteiro de dias (ex.: mês de 31 dias, 31/4 = 7.75).
function semanaAtual(diaDoMes, diasNoMes) {
  var semana = Math.ceil(diaDoMes / (diasNoMes / SEMANAS));
  return Math.min(SEMANAS, Math.max(1, semana));
}
```

Atualizar o `module.exports` no fim do arquivo:

```js
module.exports = { SEMANAS, dividirEmSemanas, fecharMes, semanaAtual };
```

- [ ] **Step 8: Rodar e ver passar**

Run: `node --test test/semanal-compute-semanal.test.js`
Expected: PASS.

- [ ] **Step 9: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS em tudo (só adições, nenhuma mudança de comportamento existente).

- [ ] **Step 10: Commit**

```bash
git add tools/semanal/compute-demandas.js tools/semanal/compute-semanal.js test/semanal-compute-demandas.test.js test/semanal-compute-semanal.test.js
git commit -m "$(cat <<'EOF'
Agregar Demandas por (sup, tipologia) + adicionar semanaAtual

porRegistro em compute-demandas.js dá à Tabela semanal o que ela
precisa pra respeitar os filtros de SUP/Grupo/Origem da barra
compartilhada, não só Tipologia -- mesma passada pelos furos que já
produz o agregado por tipologia, chaveado como chaveMatriz já chaveia
a linha de base. semanaAtual estende a mesma lógica de fatiamento
nominal que dividirEmSemanas já aplica ao valor, agora ao calendário
-- base para a Tendência semanal (próxima tarefa).
EOF
)"
```

---

### Task 2: Realizado/Tendência/Pendentes em `render-aba-semanal.js`

**Files:**
- Modify: `tools/semanal/render-aba-semanal.js`
- Test: `test/semanal-render-aba-semanal.test.js`

**Interfaces:**
- Consumes: `SEMANAS`, `dividirEmSemanas`, `fecharMes`, `semanaAtual` de `compute-semanal.js` (Task 1).
- Produces: `renderAbaSemanal(registros, indices, dimensoes, vigenteIdx, realizado)` — `realizado` é um 5º parâmetro **opcional**: `{ demandas, diaDoMes, diasNoMes }`. Omitido ou com `demandas.porRegistro` ausente, o HTML produzido é **idêntico** ao de hoje (Realizado/Tendência sem-dado, sem linha de Pendentes) — nenhuma chamada existente (Node ou cliente) precisa mudar para continuar funcionando.

- [ ] **Step 1: Escrever os testes do novo comportamento**

Em `test/semanal-render-aba-semanal.test.js`, adicionar (os 7 testes existentes continuam intactos, sem tocar):

```js
function demandasFixture(sup, tipologia, sondagemRealizadaMes, pendentesMes) {
  const zeros = new Array(12).fill(0);
  const sondagem = zeros.slice(); sondagem[6] = sondagemRealizadaMes;
  const pendentes = zeros.slice(); pendentes[6] = pendentesMes;
  return { porRegistro: { [`${sup}||${tipologia}`]: { sondagemRealizada: sondagem, pendentes: pendentes } } };
}

test('sem o 5º parâmetro, o comportamento é idêntico ao de hoje -- Realizado/Tendência sem-dado, sem linha de Pendentes', () => {
  const html = renderAbaSemanal([registro(400)], [0], ['volume'], 6);
  assert.doesNotMatch(html, /Demandas Pendentes/);
  const linhasSemDado = (html.match(/class="num sem-dado"/g) || []).length;
  assert.strictEqual(linhasSemDado, 8, '4 semanas x 2 linhas (Realizado + Tendência), nenhuma mudança nesta chamada de 4 argumentos');
});

test('com demandas SEM a chave porRegistro (ex.: {tipologias:[],totais:{}}, o formato que os testes de wire-up já usam como "sem dado real"), o comportamento fica idêntico ao de hoje', () => {
  const html = renderAbaSemanal([registro(400)], [0], ['volume'], 6, { demandas: { tipologias: [], totais: {} }, diaDoMes: 10, diasNoMes: 28 });
  assert.doesNotMatch(html, /Demandas Pendentes/, 'demandas.porRegistro é undefined aqui (a chave não existe) -- diferente de {} vazio, que é um agregado real com zero furos; undefined é "sem agregado nenhum"');
});

// Diferente do teste acima: aqui porRegistro EXISTE, só está vazio -- um
// agregado real (a planilha existe, ninguém no recorte atual tem furo
// nenhum). Isso é um dado real, não "ausência de dado" -- por isso ATIVA a
// linha nova, com zero, não sem-dado. A distinção entre "chave ausente" e
// "objeto vazio" é proposital (ver demandasMesVigente/temDadosDemandas).
test('com demandas.porRegistro presente mas vazio ({}), a linha Demandas Pendentes aparece com zero, não fica escondida', () => {
  const html = renderAbaSemanal([registro(400)], [0], ['volume'], 6, { demandas: { porRegistro: {} }, diaDoMes: 10, diasNoMes: 28 });
  assert.match(html, /Demandas Pendentes/, 'porRegistro:{} é um agregado real (zero furos casaram), diferente de porRegistro ausente -- a linha deve aparecer, mostrando 0');
  const linhaPendentes = html.match(/<tr class="linha-serie-semanal linha-pendentes-demandas">[\s\S]*?<\/tr>/)[0];
  assert.match(linhaPendentes, /celula-total-linha">0,00/);
});

test('Realizado semanal (Volume) vem de demandas.porRegistro, dividido nominalmente em 4 semanas', () => {
  // diaDoMes=1 (semanaAtualNum=1) de propósito, não 28: mantém Tendência
  // (3 semanas futuras, saldo distribuído) numericamente diferente de
  // Realizado (800/4=200 fixo em todas as semanas) -- se este teste usasse
  // diaDoMes=28 (semanaAtualNum=4), Tendência colapsaria pro mesmo valor de
  // Realizado em toda semana, e uma regex frouxa passaria mesmo com um bug
  // em Realizado.
  const demandas = demandasFixture('SUP-0001-24', 'ST', 800, 0);
  const html = renderAbaSemanal([registro(1600)], [0], ['volume'], 6, { demandas, diaDoMes: 1, diasNoMes: 28 });
  // 800 furos no mês, dividido em 4 = 200 por semana -- escopado à linha
  // Realizado especificamente (não a Tendência, que aqui é diferente).
  const linhaRealizado = html.match(/<tr class="linha-serie-semanal linha-realizado">[\s\S]*?<\/tr>/)[0];
  const duzentos = (200).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const oitocentos = (800).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  assert.strictEqual((linhaRealizado.match(new RegExp(duzentos.replace('.', '\\.'), 'g')) || []).length, 4, 'as 4 semanas mostram 200,00 cada -- 800 furos no mês ÷ 4');
  assert.match(linhaRealizado, new RegExp('celula-total-linha">' + oitocentos.replace('.', '\\.')), 'a coluna de fechamento (Total, dimensão Volume soma) mostra 800,00 -- a soma das 4 semanas, não 200');
});

test('Realizado/Tendência só aparecem no bloco Volume -- Equipes e Financeiro continuam sem-dado mesmo com demandas presente', () => {
  const demandas = demandasFixture('SUP-0001-24', 'ST', 800, 0);
  const html = renderAbaSemanal([registro(1600)], [0], ['equipes', 'financeiro'], 6, { demandas, diaDoMes: 28, diasNoMes: 28 });
  assert.doesNotMatch(html, /Demandas Pendentes/);
  const linhasSemDado = (html.match(/class="num sem-dado"/g) || []).length;
  assert.strictEqual(linhasSemDado, 16, '2 dimensões x 4 semanas x 2 linhas (Realizado + Tendência), nenhuma delas é Volume');
});

test('Tendência: semanas já passadas usam o Realizado nominal, semanas futuras distribuem o saldo restante igualmente -- soma bate com o Previsto', () => {
  // Previsto do mês = 800 (200/semana nominal). Realizado do mês = 400 (100/semana
  // nominal). diaDoMes=10 num mês de 28 dias -> semanaAtual = ceil(10/7) = 2.
  const demandas = demandasFixture('SUP-0001-24', 'ST', 400, 0);
  const html = renderAbaSemanal([registro(800)], [0], ['volume'], 6, { demandas, diaDoMes: 10, diasNoMes: 28 });
  // Semanas 1-2 (passadas): Realizado nominal = 100 cada. Semanas 3-4 (futuras):
  // saldoRestante = 800 - (100*2) = 600, dividido por 2 semanas restantes = 300 cada.
  const cem = (100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const trezentos = (300).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const oitocentos = (800).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const linhaTendencia = html.match(/<tr class="linha-serie-semanal linha-tendencia">[\s\S]*?<\/tr>/)[0];
  assert.strictEqual((linhaTendencia.match(new RegExp(cem.replace('.', '\\.'), 'g')) || []).length, 2, 'as 2 primeiras semanas devem mostrar 100 (Realizado nominal)');
  assert.strictEqual((linhaTendencia.match(new RegExp(trezentos.replace('.', '\\.'), 'g')) || []).length, 2, 'as 2 últimas semanas devem mostrar 300 (saldo distribuído)');
  assert.match(linhaTendencia, new RegExp(oitocentos.replace('.', '\\.') + '</td>'), 'a soma das 4 semanas de Tendência bate com o Previsto do mês (800) -- "mantido o resto do plano, o mês fecha como planejado"');
});

test('linha Demandas Pendentes: só a célula de fechamento, as 4 semanas ficam sem-dado', () => {
  const demandas = demandasFixture('SUP-0001-24', 'ST', 0, 150);
  const html = renderAbaSemanal([registro(400)], [0], ['volume'], 6, { demandas, diaDoMes: 1, diasNoMes: 28 });
  const linhaPendentes = html.match(/<tr class="linha-serie-semanal linha-pendentes-demandas">[\s\S]*?<\/tr>/);
  assert.ok(linhaPendentes, 'esperava uma linha com classe linha-pendentes-demandas');
  assert.match(linhaPendentes[0], /Demandas Pendentes/);
  const semDadoNaLinha = (linhaPendentes[0].match(/class="num sem-dado"/g) || []).length;
  assert.strictEqual(semDadoNaLinha, 4, 'as 4 células de semana ficam sem-dado -- Pendentes é estoque, não se divide');
  const centoECinquenta = (150).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  assert.match(linhaPendentes[0], new RegExp('celula-total-linha">' + centoECinquenta.replace('.', '\\.')));
});

test('registro cuja combinação (sup, tipologia) não existe em demandas.porRegistro contribui 0, não é excluído da soma', () => {
  const demandas = demandasFixture('SUP-0002-24', 'ST', 400, 0); // registro abaixo é SUP-0001-24, não bate
  const html = renderAbaSemanal([registro(400)], [0], ['volume'], 6, { demandas, diaDoMes: 28, diasNoMes: 28 });
  const linhaRealizado = html.match(/<tr class="linha-serie-semanal linha-realizado">[\s\S]*?<\/tr>/)[0];
  assert.doesNotMatch(linhaRealizado, /sem-dado/, 'indices não está vazio -- deve somar 0, não cair pra sem-dado, já que "sem furo" é uma contagem real, não uma lacuna');
  assert.match(linhaRealizado, /<td class="num">0,00<\/td>/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/semanal-render-aba-semanal.test.js`
Expected: FAIL nos novos testes (o 5º parâmetro é ignorado hoje; `linha-pendentes-demandas` não existe).

- [ ] **Step 3: Implementar em `render-aba-semanal.js`**

Atualizar o `require` no topo (linha 2):

```js
const { SEMANAS, dividirEmSemanas, fecharMes, semanaAtual } = require('./compute-semanal.js');
```

Adicionar, logo após `previstoMesVigente` (antes de `renderCabecalho`):

```js
// Mesma expressão de chaveMatriz (tools/comum/linha-base.js) -- duplicada de
// propósito porque este módulo entra no bundle do navegador
// (buildBrowserBundle remove require('../comum/...'), não reescreve -- mesmo
// motivo já documentado em chaveBaseline, tools/semanal/compute-balanco.js).
function chaveDemandas(sup, tipologia) {
  return sup + '||' + tipologia;
}

// Soma, através dos registros em 'indices', uma série de demandas.porRegistro
// (Task 1, compute-demandas.js) no mês vigente -- mesmo padrão de
// soma-através-de-registros que previstoMesVigente já usa, só que a fonte é
// 'demandas' (Avanço Sond), não registro.previsto. Ausência de (sup,
// tipologia) em porRegistro significa ZERO furos para aquele par -- não "sem
// dado reportado" (null): o Avanço Sond é uma listagem completa de furos, uma
// combinação ausente é uma contagem real de zero. null só quando 'indices'
// está vazio (nenhum registro selecionado) -- mesma regra de
// previstoMesVigente.
function demandasMesVigente(registros, indices, demandas, serie, vigenteIdx) {
  if (!indices || !indices.length) return null;
  var soma = 0;
  indices.forEach(function (i) {
    var registro = registros[i];
    if (!registro) return;
    var entrada = demandas.porRegistro[chaveDemandas(registro.sup, registro.tipologia)];
    if (entrada && Array.isArray(entrada[serie])) soma += (entrada[serie][vigenteIdx] || 0);
  });
  return soma;
}

// Tendência semanal (Volume): semanas já passadas (<= semanaAtualNum) usam o
// Realizado nominal daquela semana; semanas futuras distribuem igualmente o
// que falta pra bater o Previsto do mês -- ver "Semana atual e Tendência" no
// spec (docs/superpowers/specs/2026-07-30-semanal-realizado-tendencia-balanco-visual-design.md).
// Por construção, a soma das 4 semanas bate com previstoMes quando há
// semana(s) futura(s) -- "mantido o resto do plano, o mês fecha como
// planejado". null (as 4 semanas) quando previstoMes ou realizadoMes for
// null.
function calcularTendenciaSemanal(previstoMes, realizadoMes, semanasRealizado, semanaAtualNum) {
  if (previstoMes === null || realizadoMes === null) return new Array(SEMANAS).fill(null);
  var realizadoAteAgora = (realizadoMes / SEMANAS) * semanaAtualNum;
  var semanasRestantes = SEMANAS - semanaAtualNum;
  var saldoRestante = previstoMes - realizadoAteAgora;
  var tendenciaFutura = semanasRestantes > 0 ? saldoRestante / semanasRestantes : 0;
  var saida = [];
  for (var s = 1; s <= SEMANAS; s++) {
    saida.push(s <= semanaAtualNum ? semanasRealizado[s - 1] : tendenciaFutura);
  }
  return saida;
}
```

Substituir a função `renderAbaSemanal` inteira (a última do arquivo, antes de `module.exports`) por:

```js
// registros/indices/dimensoes/vigenteIdx: mesmos parâmetros de sempre (ver
// comentário original abaixo). 'realizado' é um 5º parâmetro OPCIONAL --
// { demandas, diaDoMes, diasNoMes } -- que ativa Realizado/Tendência/
// Demandas Pendentes só no bloco Volume, quando demandas.porRegistro existe
// (Task 1). Omitido, ou com porRegistro ausente/vazio, o HTML produzido é
// IDÊNTICO ao de antes desta tarefa -- nenhuma chamada existente precisa
// mudar.
//
// Previsto vem de dividirEmSemanas aplicado à soma do Previsto do mês
// vigente através dos registros selecionados. diaDoMes/diasNoMes vêm do
// relógio de quem está vendo a página (render-semanal.js calcula com
// `new Date()` a cada recálculo) -- esta função nunca chama new Date()
// internamente, fica pura e testável em Node com qualquer combinação.
function renderAbaSemanal(registros, indices, dimensoes, vigenteIdx, realizado) {
  var opts = realizado || {};
  var temDadosDemandas = !!(opts.demandas && opts.demandas.porRegistro && opts.diaDoMes && opts.diasNoMes);

  return dimensoes.map(function (dimensao) {
    var mesVigente = previstoMesVigente(registros, indices, dimensao, vigenteIdx);
    var semanasPrevisto = dividirEmSemanas(mesVigente, dimensao);
    var fechamentoPrevisto = fecharMes(semanasPrevisto, dimensao);
    var semanasSemDado = new Array(SEMANAS).fill(null);

    var semanasRealizado = semanasSemDado;
    var fechamentoRealizado = null;
    var semanasTendencia = semanasSemDado;
    var fechamentoTendencia = null;
    var linhaPendentes = '';

    if (dimensao === 'volume' && temDadosDemandas) {
      var realizadoMes = demandasMesVigente(registros, indices, opts.demandas, 'sondagemRealizada', vigenteIdx);
      semanasRealizado = dividirEmSemanas(realizadoMes, 'volume');
      fechamentoRealizado = fecharMes(semanasRealizado, 'volume');

      var semanaAtualNum = semanaAtual(opts.diaDoMes, opts.diasNoMes);
      semanasTendencia = calcularTendenciaSemanal(mesVigente, realizadoMes, semanasRealizado, semanaAtualNum);
      fechamentoTendencia = fecharMes(semanasTendencia, 'volume');

      var pendentesMes = demandasMesVigente(registros, indices, opts.demandas, 'pendentes', vigenteIdx);
      linhaPendentes = renderLinhaSerie('Demandas Pendentes', 'pendentes-demandas', semanasSemDado, pendentesMes);
    }

    return '<div class="bloco-dimensao-semanal">'
      + '<div class="tabela-semanal-titulo">' + escapeHtml(DIMENSOES_ROTULO_SEMANAL[dimensao] || dimensao) + '</div>'
      + '<table class="tabela-semanal">'
      + renderCabecalho(dimensao)
      + '<tbody>'
      + renderLinhaSerie('Previsto', 'previsto', semanasPrevisto, fechamentoPrevisto)
      + renderLinhaSerie('Realizado', 'realizado', semanasRealizado, fechamentoRealizado)
      + renderLinhaSerie('Tendência', 'tendencia', semanasTendencia, fechamentoTendencia)
      + linhaPendentes
      + '</tbody></table></div>';
  }).join('');
}

module.exports = { renderAbaSemanal, rotuloColunaFechamento };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/semanal-render-aba-semanal.test.js`
Expected: PASS, 14/14 (7 existentes + 7 novos).

- [ ] **Step 5: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS em tudo — nenhuma chamada existente de `renderAbaSemanal` usa o 5º parâmetro ainda (só as tarefas seguintes ligam isso de ponta a ponta), então nada mais deve mudar.

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/render-aba-semanal.js test/semanal-render-aba-semanal.test.js
git commit -m "$(cat <<'EOF'
Realizado/Tendência/Demandas Pendentes na Tabela semanal (Volume)

renderAbaSemanal ganha um 5º parâmetro opcional (realizado) que ativa
as 3 linhas novas só no bloco Volume, a partir de
demandas.porRegistro (Task anterior). Omitido, ou sem porRegistro, o
HTML produzido é idêntico ao de antes -- nenhuma chamada existente
precisou mudar. Tendência: semanas passadas = Realizado nominal,
semanas futuras = saldo restante distribuído igualmente, soma bate
com o Previsto do mês.
EOF
)"
```

---

### Task 3: Ligar no cliente (`render-semanal.js`) + CSS da linha nova

**Files:**
- Modify: `tools/semanal/render-semanal.js`

**Interfaces:**
- Consumes: `renderAbaSemanal(registros, indices, dimensoes, vigenteIdx, realizado)` (Task 2).
- Produces: nenhuma interface nova exportada — só liga o que já existe.

- [ ] **Step 1: Passar `demandas`/`diaDoMes`/`diasNoMes` na chamada de `recalcularSemanal`**

Em `tools/semanal/render-semanal.js`, dentro de `SCRIPT_CLIENTE_SEMANAL`, modificar `recalcularSemanal` de:

```js
function recalcularSemanal() {
  var indices = indicesFiltrados(
    window.__REGISTROS__,
    filtrosSelecionadosSemanal.tipologia,
    filtrosSelecionadosSemanal.categoria,
    filtrosSelecionadosSemanal.grupo,
    filtrosSelecionadosSemanal.sup,
    filtrosSelecionadosSemanal.origem
  );
  var dimensoes = dimensoesEmOrdemSemanal(filtrosSelecionadosSemanal.dimensao);
  document.getElementById('secao-semanal').innerHTML = RenderAbaSemanal.renderAbaSemanal(window.__REGISTROS__, indices, dimensoes, window.__VIGENTE_IDX__);
  montarAbaBalanco(window.__REGISTROS__, indices);
}
```

para:

```js
function recalcularSemanal() {
  var indices = indicesFiltrados(
    window.__REGISTROS__,
    filtrosSelecionadosSemanal.tipologia,
    filtrosSelecionadosSemanal.categoria,
    filtrosSelecionadosSemanal.grupo,
    filtrosSelecionadosSemanal.sup,
    filtrosSelecionadosSemanal.origem
  );
  var dimensoes = dimensoesEmOrdemSemanal(filtrosSelecionadosSemanal.dimensao);
  // hoje/diasNoMes vêm do relógio de quem está vendo a página (não do
  // build) -- calculados de novo a cada recálculo, é barato e evita estado
  // obsoleto se a aba ficar aberta atravessando a meia-noite. Dia 0 do mês
  // seguinte = último dia do mês atual, truque padrão do Date do JS.
  var hoje = new Date();
  var diasNoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
  document.getElementById('secao-semanal').innerHTML = RenderAbaSemanal.renderAbaSemanal(
    window.__REGISTROS__, indices, dimensoes, window.__VIGENTE_IDX__,
    { demandas: window.__DEMANDAS__, diaDoMes: hoje.getDate(), diasNoMes: diasNoMes }
  );
  montarAbaBalanco(window.__REGISTROS__, indices);
}
```

- [ ] **Step 2: CSS da linha "Demandas Pendentes"**

Em `CSS_SEMANAL` (mesmo arquivo), adicionar a regra depois de `.tabela-semanal-titulo`:

```js
const CSS_SEMANAL = `
  .linha-tendencia .serie-label, .linha-tendencia .celula-total-linha { color: #f6b53f; }
  .linha-tendencia .serie-label { border-left-color: #f6b53f; }
  .bloco-dimensao-semanal + .bloco-dimensao-semanal { margin-top: 28px; padding-top: 28px; border-top: 1px solid var(--border); }
  .tabela-semanal-titulo { font-size: 12px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 10px; }
  /* Mesmo verde de .linha-demandas em CSS_DEMANDAS abaixo -- fio visual
     entre as duas: esta linha também vem do Avanço Sond, também é
     execução (estoque de furos), nunca previsão. */
  .linha-pendentes-demandas .serie-label, .linha-pendentes-demandas .celula-total-linha { color: #7fd858; }
  .linha-pendentes-demandas .serie-label { border-left-color: #7fd858; }
`;
```

- [ ] **Step 3: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS em tudo. Nenhum teste existente usa a dimensão Volume por padrão (o filtro de dimensão abre em Financeiro), então nenhum teste de wire-up deveria mudar de resultado — mas confirme lendo a saída, não só o código de saída.

- [ ] **Step 4: Escrever um teste de wire-up de ponta a ponta**

Em `test/semanal-render-semanal-wireup.test.js`, adicionar (reaproveitando `montarSandbox`/`registroSintetico`/`DEMANDAS_VAZIAS` já existentes no arquivo):

```js
test('Realizado/Tendência aparecem de ponta a ponta quando a dimensão Volume está marcada e demandas.porRegistro tem dado real', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const geradoEm = new Date('2026-07-01T00:00:00Z'); // vigenteIdx = 6 (julho)
  const demandas = {
    porRegistro: { 'SUP-0001-24||ST': { sondagemRealizada: [0, 0, 0, 0, 0, 0, 800, 0, 0, 0, 0, 0], pendentes: [0, 0, 0, 0, 0, 0, 50, 0, 0, 0, 0, 0] } },
  };
  const html = renderSemanal({ registros, baseline: [], demandas, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });
  const { sandbox, documentoFalso } = montarSandbox(html);

  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  // Marca a dimensão Volume no seletor (Financeiro continua marcado também --
  // seletor-dimensao é multi-select, minimoUm:true, não substitui).
  const painelDimensao = documentoFalso.getElementById('seletor-dimensao-painel');
  const checkboxVolume = painelDimensao.querySelectorAll('input[type="checkbox"]').filter((c) => c.value === 'volume')[0];
  assert.ok(checkboxVolume, 'esperava um checkbox "volume" no seletor de dimensão');
  checkboxVolume.checked = true;
  checkboxVolume.listeners.change();

  const htmlMontado = documentoFalso.getElementById('secao-semanal').innerHTML;
  assert.match(htmlMontado, /Demandas Pendentes/, 'a linha nova precisa aparecer no bloco Volume depois de marcar a dimensão');
  assert.doesNotMatch(htmlMontado.match(/<tr class="linha-serie-semanal linha-realizado">[\s\S]*?<\/tr>/)[0], /sem-dado/, 'Realizado (Volume) precisa vir preenchido, não sem-dado, com demandas.porRegistro real');
});
```

- [ ] **Step 5: Rodar e confirmar**

Run: `node --test test/semanal-render-semanal-wireup.test.js`
Expected: PASS, incluindo o teste novo.

- [ ] **Step 6: Rodar a suíte inteira uma última vez**

Run: `node --test test/*.test.js`
Expected: PASS em tudo.

- [ ] **Step 7: Commit**

```bash
git add tools/semanal/render-semanal.js test/semanal-render-semanal-wireup.test.js
git commit -m "$(cat <<'EOF'
Ligar Realizado/Tendência/Pendentes no cliente da página semanal

recalcularSemanal calcula diaDoMes/diasNoMes do relógio de quem está
vendo a página (new Date(), não o build) e repassa pra
renderAbaSemanal a cada recálculo, junto com window.__DEMANDAS__.
CSS da linha "Demandas Pendentes" no mesmo verde da aba Demandas --
mesma fonte, mesma linguagem visual.
EOF
)"
```

---

### Task 4: Coluna Tomador + ajuste visual no Balanço de massa

**Files:**
- Modify: `tools/semanal/compute-balanco.js`, `tools/semanal/render-aba-balanco.js`
- Test: `test/semanal-compute-balanco.test.js`, `test/semanal-render-aba-balanco.test.js`

**Interfaces:**
- Produces: `calcularLinhas(...)` — cada linha do array de saída ganha o campo `tomador`. `renderGraficoTipologia`/`renderAbaBalanco` — sem mudança de assinatura, só de markup/estilo.

- [ ] **Step 1: Escrever os testes**

Em `test/semanal-compute-balanco.test.js`, atualizar `cenario()` para aceitar `tomador` opcional:

```js
function cenario({ previstoVol, realizadoVol, base = 'previsto', baseline = null, tomador = 'Tomador-Padrao' }) {
  const mk = (vol, eq) => { const v = new Array(12).fill(0), e = new Array(12).fill(0);
    v[6] = vol; e[6] = eq; return { volume: v, equipes: e, financeiro: new Array(12).fill(0) }; };
  return {
    registros: [{ sup: 'SUP-0001-24', tipologia: 'ST', tomador, previsto: mk(previstoVol, 2), realizado: mk(realizadoVol, 3), total: mk(0, 0) }],
    indices: [0], tipologia: 'ST', base, dimensao: 'volume', periodo: 'mesVigente',
    vigenteIdx: 6, baseline: baseline === null ? [{ chave: 'SUP-0001-24||ST', volume: new Array(12).fill(0) }] : baseline,
  };
}
```

Adicionar teste:

```js
test('tomador chega em cada linha, direto do registro', () => {
  const linhas = calcularLinhas(cenario({ previstoVol: 100, realizadoVol: 100, tomador: 'Concessionária Exemplo S.A' }));
  assert.strictEqual(linhas[0].tomador, 'Concessionária Exemplo S.A');
});
```

Em `test/semanal-render-aba-balanco.test.js`, adicionar (reaproveitando `LINHAS`, `renderGraficoTipologia` já importados):

```js
test('o rótulo composto SUP — Tomador aparece no SVG quando a linha tem tomador', () => {
  const linhas = [{ sup: 'SUP-A', tomador: 'Concessionária Exemplo S.A', valorBase: 105, valorRealizado: 205, desvio: 100, equipesBase: 2, equipesRealizado: 12, desvioEquipes: 10, ativo: true, semBase: false }];
  const svg = renderGraficoTipologia('ST', linhas, {});
  assert.match(svg, /SUP-A/);
  assert.match(svg, /Concessionária Exemplo S\.A/);
});

test('linha sem tomador (undefined) não quebra e não deixa um "— undefined" no SVG', () => {
  const svg = renderGraficoTipologia('ST', LINHAS, {}); // LINHAS não tem campo tomador
  assert.doesNotMatch(svg, /undefined/);
});

test('fonte do rótulo de SUP é 11px (menor que antes), e há uma linha divisória entre a 1ª e a 2ª linha do gráfico', () => {
  const svg = renderGraficoTipologia('ST', LINHAS, {}); // LINHAS tem 2 entradas
  assert.match(svg, /<text x="8"[^>]*font-size="11"/);
  const linhasDivisoria = (svg.match(/<line x1="0"/g) || []).length;
  assert.strictEqual(linhasDivisoria, 1, 'com 2 linhas de SUP, espera-se exatamente 1 divisória entre elas (nunca antes da primeira)');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/semanal-compute-balanco.test.js test/semanal-render-aba-balanco.test.js`
Expected: FAIL nos 4 testes novos (`tomador` ainda não existe na saída de `calcularLinhas`; SVG ainda não tem tomador, `font-size="12"` em vez de `"11"`, sem `<line x1="0"`).

- [ ] **Step 3: Implementar em `compute-balanco.js`**

No `push` final de `calcularLinhas`, adicionar `tomador: registro.tomador` ao objeto:

```js
    linhas.push({
      sup: registro.sup,
      tomador: registro.tomador,
      valorBase: semBase ? null : valorBase,
      valorRealizado: valorRealizado,
      desvio: desvio,
      equipesBase: semBase ? null : equipesBase,
      equipesRealizado: equipesRealizado,
      desvioEquipes: desvioEquipes,
      ativo: ativo,
      semBase: semBase,
    });
```

- [ ] **Step 4: Implementar em `render-aba-balanco.js`**

Adicionar a constante de cor da divisória, junto das outras cores (depois de `var COR_EIXO = '#2c2c2a';`):

```js
var COR_DIVISORIA = 'rgba(255,255,255,0.10)'; // mesmo valor de --border em cssBase()
```

Dentro de `renderGraficoTipologia`, no `.forEach` que desenha cada linha, mudar de:

```js
  linhasOrdenadas.forEach(function (linha, i) {
    var y = ALTURA_CABECALHO + i * ALTURA_LINHA + ALTURA_LINHA / 2;

    svg += '<text x="8" y="' + (y + 4) + '" fill="' + COR_TEXTO + '" font-size="12">' + escapeHtml(linha.sup) + '</text>';
```

para:

```js
  linhasOrdenadas.forEach(function (linha, i) {
    var y = ALTURA_CABECALHO + i * ALTURA_LINHA + ALTURA_LINHA / 2;

    // Divisória entre linhas -- nunca antes da primeira (o eixo/cabeçalho já
    // marca esse limite). Facilita a leitura com muitos SUPs na tela.
    if (i > 0) {
      var yDivisoria = ALTURA_CABECALHO + i * ALTURA_LINHA;
      svg += '<line x1="0" y1="' + yDivisoria + '" x2="' + LARGURA_SVG + '" y2="' + yDivisoria + '" stroke="' + COR_DIVISORIA + '" stroke-width="1"></line>';
    }

    // Fonte menor (era 12) pra caber o Tomador na mesma linha sem espremer.
    // <tspan> em vez de escapeHtml simples porque SUP e Tomador têm cores
    // diferentes (SUP em destaque, Tomador em cor secundária) dentro do
    // MESMO <text> -- é assim que SVG mistura estilo numa linha só.
    // "Facilita a leitura quando o filtro estiver sem SUP específico
    // selecionado" (dono do projeto) -- com muitas linhas visíveis de uma
    // vez, o tomador ajuda a identificar rápido de quem é cada uma.
    svg += '<text x="8" y="' + (y + 4) + '" font-size="11">'
      + '<tspan fill="' + COR_TEXTO + '">' + escapeHtml(linha.sup) + '</tspan>'
      + (linha.tomador ? '<tspan fill="' + COR_TEXTO_SECUNDARIO + '"> — ' + escapeHtml(linha.tomador) + '</tspan>' : '')
      + '</text>';
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test test/semanal-compute-balanco.test.js test/semanal-render-aba-balanco.test.js`
Expected: PASS, todos os testes (existentes + novos).

- [ ] **Step 6: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS em tudo — incluindo `test/semanal-render-aba-balanco-wireup.test.js`, que recomputa `esperado` com o mesmo código atualizado (nenhuma mudança de teste necessária lá, já que ele chama `renderAbaBalanco` de novo pra comparar, não fixa um HTML antigo).

- [ ] **Step 7: Commit**

```bash
git add tools/semanal/compute-balanco.js tools/semanal/render-aba-balanco.js test/semanal-compute-balanco.test.js test/semanal-render-aba-balanco.test.js
git commit -m "$(cat <<'EOF'
Coluna Tomador + ajuste visual no gráfico de Balanço de massa

calcularLinhas passa tomador adiante (já existia no registro, só não
saía). renderGraficoTipologia mostra "SUP — Tomador" na mesma linha
(cores diferentes via <tspan>), fonte do SUP menor (12 -> 11) e uma
divisória fina entre cada linha -- facilita achar de quem é cada SUP
com o filtro aberto (sem um SUP específico selecionado).
EOF
)"
```
