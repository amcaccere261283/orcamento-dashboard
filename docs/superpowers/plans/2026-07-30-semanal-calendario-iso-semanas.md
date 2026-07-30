# Calendário ISO de semanas reais na Tabela Semanal — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir a divisão nominal por 4 semanas iguais (usada na Tabela Semanal) por
semanas ISO 8601 reais, com Previsto, Realizado, Tendência e Demandas Pendentes corretos
por semana em qualquer mês de 2026 (4 ou 5 semanas conforme o mês).

**Architecture:** Um módulo de calendário puro (`compute-semanal.js`) calcula, pra
qualquer (ano, mês), a lista real de semanas ISO que pertencem a ele (regra da maioria).
`compute-demandas.js` passa a expor, por `(sup, tipologia)`, uma lista compacta de
eventos (dias de chegada/sondagem realizada/saída de estoque) em vez de um valor
pré-somado mensal -- permite recortar Realizado e Pendentes por qualquer intervalo de
datas, inclusive "até hoje" na semana em curso. `render-aba-semanal.js` combina os dois:
descobre quantas semanas o mês vigente tem, qual delas é "hoje", e soma os eventos reais
em cada uma.

**Tech Stack:** Node.js (`node:test`), zero dependências, ES5 nos módulos que entram no
bundle do navegador (`compute-semanal.js`, `render-aba-semanal.js`).

## Global Constraints

- **ES5 nos módulos bundlados**: `compute-semanal.js` e `render-aba-semanal.js` rodam no
  navegador via `buildBrowserBundle` -- `var`/`function`, nunca `const`/`let`/arrow/
  template literal (as strings de teste em Node ficam de fora dessa regra).
- **`chaveDemandas` continua duplicada** em `render-aba-semanal.js` (mesma expressão de
  `chaveMatriz`, `tools/comum/linha-base.js`) -- o bundle remove `require('../comum/...')`,
  não reescreve.
- **Esta é uma SUBSTITUIÇÃO, não uma extensão aditiva.** Ao contrário do plano anterior
  (Realizado/Tendência/Balanço), que preservou 100% de compatibilidade com todo call site
  existente, este plano MUDA a assinatura de `renderAbaSemanal` (ganha um `ano`
  obrigatório) e o formato de `demandas` que ela espera (`porRegistroEventos` em vez de
  `porRegistro`). Não é possível nem desejável manter os dois formatos em paralelo pra
  sempre -- os testes que dependiam do formato antigo são REESCRITOS, não só estendidos.
- **Uma exceção documentada e esperada**: a Tarefa 3 deixa UM teste especificamente
  vermelho (`'Realizado/Tendência aparecem de ponta a ponta...'` em
  `test/semanal-render-semanal-wireup.test.js`), porque ele depende da fiação no cliente
  (`render-semanal.js`), que só é feita na Tarefa 4. Isso é esperado, não uma regressão a
  investigar no meio do caminho -- a Tarefa 3 documenta isso explicitamente no seu passo
  de "rodar a suíte inteira", e só a Tarefa 4 precisa fechar com 100% verde.
- **`diaEpoch` existe em dois lugares de propósito**: canônica em `tools/comum/datas.js`
  (Node, usada por `compute-demandas.js`), duplicada em `tools/semanal/compute-semanal.js`
  (bundle, sem `require`). Mesma expressão exata (`Math.floor(data.getTime() / 86400000)`)
  nos dois -- se um mudar, o outro precisa mudar junto.
- **Convenção de fuso**: `diaEpoch` em si é agnóstico de fuso (só um floor sobre o
  instante absoluto). Quem constrói o `Date` decide o resto: eventos de furos (Node, a
  partir de datas já parseadas de seriais Excel) e "hoje" no cliente (a partir de
  `new Date()`, com os getters LOCAIS -- `getFullYear()`/`getMonth()`/`getDate()`, nunca
  os `getUTC*`) -- mesma convenção que `recalcularSemanal()` já usava antes deste plano
  pra `diaDoMes`. Testes usam `new Date(ano, mes, dia)` (construtor local) para bater com
  essa mesma convenção -- nunca `Date.UTC` pra essas datas específicas, ou os números
  podem discordar por causa do fuso do interpretador Node rodando o teste.

---

### Task 1: Calendário ISO em `compute-semanal.js`

**Files:**
- Modify: `tools/semanal/compute-semanal.js`
- Modify: `tools/semanal/render-aba-semanal.js` (1 linha, ponte temporária -- ver Step 3)
- Test: `test/semanal-compute-semanal.test.js` (reescrita completa)

**Interfaces:**
- Produces: `diaEpoch(data)`, `semanasDoMes(ano, mesIndex)`, `indiceSemanaAtual(semanas, hojeEpoch)`.
- `dividirEmSemanas(valorMensal, dimensao, numSemanas)` -- MUDANÇA DE ASSINATURA: 3º
  parâmetro agora obrigatório (antes usava a constante fixa `SEMANAS`). `fecharMes`
  continua igual (já não referenciava `SEMANAS`). `semanaAtual`/`SEMANAS` continuam
  exportados por enquanto (ainda consumidos pelo código antigo de
  `render-aba-semanal.js`, intocado até a Tarefa 3) -- ficam marcados como obsoletos no
  próprio comentário.

- [ ] **Step 1: Escrever os testes (reescrita completa do arquivo)**

Substituir `test/semanal-compute-semanal.test.js` inteiro por:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  dividirEmSemanas, fecharMes, SEMANAS, semanaAtual,
  diaEpoch, semanasDoMes, indiceSemanaAtual,
} = require('../tools/semanal/compute-semanal.js');

test('volume divide o mês em N partes iguais', () => {
  assert.deepStrictEqual(dividirEmSemanas(400, 'volume', 4), [100, 100, 100, 100]);
  assert.deepStrictEqual(dividirEmSemanas(500, 'volume', 5), [100, 100, 100, 100, 100]);
});

test('financeiro divide igual a volume', () => {
  assert.deepStrictEqual(dividirEmSemanas(1000, 'financeiro', 4), [250, 250, 250, 250]);
});

test('equipes NÃO divide: 2 equipes no mês são 2 em cada semana, mesmo com 5 semanas', () => {
  assert.deepStrictEqual(dividirEmSemanas(2, 'equipes', 4), [2, 2, 2, 2]);
  assert.deepStrictEqual(dividirEmSemanas(2, 'equipes', 5), [2, 2, 2, 2, 2]);
});

test('volume fecha somando as semanas', () => {
  assert.strictEqual(fecharMes([100, 100, 100, 100], 'volume'), 400);
  assert.strictEqual(fecharMes([100, 100, 100, 100, 100], 'volume'), 500);
});

test('equipes fecha pela média, nunca pela soma', () => {
  assert.strictEqual(fecharMes([2, 2, 2, 2], 'equipes'), 2);
});

test('mês sem dado propaga null em vez de virar zero', () => {
  assert.deepStrictEqual(dividirEmSemanas(null, 'volume', 4), [null, null, null, null]);
  assert.strictEqual(fecharMes([null, null, null, null], 'volume'), null);
});

test('ida e volta fecha para as três dimensões, com 4 ou 5 semanas', () => {
  for (const numSemanas of [4, 5]) {
    for (const [valor, dim] of [[400, 'volume'], [1000, 'financeiro'], [3, 'equipes']]) {
      assert.strictEqual(fecharMes(dividirEmSemanas(valor, dim, numSemanas), dim), valor,
        `dimensão ${dim} não fechou com ${numSemanas} semanas`);
    }
  }
});

test('SEMANAS/semanaAtual continuam em 4 fatias nominais -- obsoletos, mantidos só até a Tarefa 3 trocar render-aba-semanal.js pelo calendário real', () => {
  assert.strictEqual(SEMANAS, 4);
  assert.strictEqual(semanaAtual(1, 28), 1);
  assert.strictEqual(semanaAtual(15, 28), 3);
  assert.strictEqual(semanaAtual(28, 28), 4);
});

// --- Calendário ISO de semanas reais ---------------------------------------

function dia(ano, mes, d) { return diaEpoch(new Date(ano, mes, d)); }

test('diaEpoch: dias consecutivos produzem inteiros consecutivos', () => {
  const d1 = diaEpoch(new Date(2026, 6, 15));
  const d2 = diaEpoch(new Date(2026, 6, 16));
  assert.strictEqual(d2, d1 + 1);
});

test('semanasDoMes: os 12 meses de 2026 somam 53 semanas, cada um com 4 ou 5 (2026 é ano ISO de 53 semanas)', () => {
  const contagens = [];
  for (let mes = 0; mes < 12; mes++) contagens.push(semanasDoMes(2026, mes).length);
  assert.deepStrictEqual(contagens, [5, 4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 5]);
  assert.strictEqual(contagens.reduce((a, b) => a + b, 0), 53);
});

test('semanasDoMes: janeiro de 2026 tem 5 semanas, a primeira pertence a janeiro mesmo com 3 dias em dezembro (regra da maioria)', () => {
  const semanas = semanasDoMes(2026, 0);
  assert.strictEqual(semanas.length, 5);
  assert.strictEqual(semanas[0].inicio, dia(2025, 11, 29)); // segunda 29/12/2025
  assert.strictEqual(semanas[0].fim, dia(2026, 0, 4));      // domingo 04/01/2026
  assert.strictEqual(semanas[4].inicio, dia(2026, 0, 26));  // segunda 26/01
  assert.strictEqual(semanas[4].fim, dia(2026, 1, 1));      // domingo 01/02
});

test('semanasDoMes: julho de 2026 tem 5 semanas, a última (S31) vai de segunda 27/07 a domingo 02/08', () => {
  const semanas = semanasDoMes(2026, 6);
  assert.strictEqual(semanas.length, 5);
  assert.strictEqual(semanas[0].inicio, dia(2026, 5, 29)); // segunda 29/06
  assert.strictEqual(semanas[0].fim, dia(2026, 6, 5));     // domingo 05/07
  assert.strictEqual(semanas[4].inicio, dia(2026, 6, 27)); // segunda 27/07
  assert.strictEqual(semanas[4].fim, dia(2026, 7, 2));     // domingo 02/08 -- cai em agosto, mas 5 dias em julho vs 2 em agosto
});

test('semanasDoMes: agosto de 2026 tem 4 semanas, a primeira começa segunda 03/08 (01-02/08 são de julho, não de agosto)', () => {
  const semanas = semanasDoMes(2026, 7);
  assert.strictEqual(semanas.length, 4);
  assert.strictEqual(semanas[0].inicio, dia(2026, 7, 3)); // segunda 03/08
  assert.strictEqual(semanas[3].fim, dia(2026, 7, 30));   // domingo 30/08
});

test('semanasDoMes: nenhuma semana falta ou se repete entre meses consecutivos -- fim de um mês + 1 dia = início do mês seguinte', () => {
  for (let mes = 0; mes < 11; mes++) {
    const semanasMes = semanasDoMes(2026, mes);
    const semanasProximo = semanasDoMes(2026, mes + 1);
    const ultimoFim = semanasMes[semanasMes.length - 1].fim;
    const primeiroInicio = semanasProximo[0].inicio;
    assert.strictEqual(primeiroInicio, ultimoFim + 1,
      `mês ${mes}->${mes + 1}: última semana termina em ${ultimoFim}, próxima começa em ${primeiroInicio}`);
  }
});

test('indiceSemanaAtual: acha a semana que contém hojeEpoch', () => {
  const semanas = semanasDoMes(2026, 6); // julho, S27..S31
  const meioDaS29 = dia(2026, 6, 15); // quarta 15/07, dentro de S29 (13/07-19/07)
  assert.strictEqual(indiceSemanaAtual(semanas, meioDaS29), 2);
});

test('indiceSemanaAtual: -1 quando hoje cai fora de todas as semanas do mês (dias de fronteira jul/ago: 01-02/08 pertencem a S31, que é de julho)', () => {
  const semanasAgosto = semanasDoMes(2026, 7); // S32..S36, começa 03/08
  assert.strictEqual(indiceSemanaAtual(semanasAgosto, dia(2026, 7, 1)), -1);
  assert.strictEqual(indiceSemanaAtual(semanasAgosto, dia(2026, 7, 2)), -1);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/semanal-compute-semanal.test.js`
Expected: FAIL -- `dividirEmSemanas` ainda tem a assinatura antiga (2 args, `SEMANAS`
fixo), e `diaEpoch`/`semanasDoMes`/`indiceSemanaAtual` ainda não existem.

- [ ] **Step 3: Implementar em `compute-semanal.js`**

Substituir o arquivo inteiro por:

```js
'use strict';

// <<< INICIO CLIENTE
var SEMANAS = 4;

// Volume e financeiro são FLUXOS: o mês se reparte em N fatias nominais e a
// soma delas reconstrói o mês. Equipes é uma FOTO: 2 equipes mobilizadas no
// mês são 2 equipes em cada semana, não valorMensal/N -- dividir produziria
// número errado em silêncio e discordaria do orçamento, que mostra a média.
// Mesma premissa de mediaEquipesPonderada em tools/comum/calculo-equipes.js.
// numSemanas é OBRIGATÓRIO: o calendário ISO abaixo mostra que um mês tem 4
// ou 5 semanas reais, nunca sempre 4 -- ver
// docs/superpowers/specs/2026-07-30-semanal-calendario-iso-design.md.
function dividirEmSemanas(valorMensal, dimensao, numSemanas) {
  var saida = [];
  for (var i = 0; i < numSemanas; i++) {
    if (valorMensal === null || valorMensal === undefined) { saida.push(null); continue; }
    saida.push(dimensao === 'equipes' ? valorMensal : valorMensal / numSemanas);
  }
  return saida;
}

function fecharMes(semanas, dimensao) {
  var validos = (semanas || []).filter(function (v) { return v !== null && v !== undefined; });
  if (!validos.length) return null;
  var soma = validos.reduce(function (a, b) { return a + b; }, 0);
  return dimensao === 'equipes' ? soma / validos.length : soma;
}

// OBSOLETO a partir do calendário ISO abaixo (ver
// docs/superpowers/specs/2026-07-30-semanal-calendario-iso-design.md) --
// mantido só até a Tarefa 3 deste plano trocar render-aba-semanal.js pelas
// semanas reais (semanasDoMes/indiceSemanaAtual). Não usar em código novo.
function semanaAtual(diaDoMes, diasNoMes) {
  var semana = Math.ceil(diaDoMes / (diasNoMes / SEMANAS));
  return Math.min(SEMANAS, Math.max(1, semana));
}

// ============================================================
// Calendário ISO 8601 de semanas reais (segunda a domingo) -- ver
// docs/superpowers/specs/2026-07-30-semanal-calendario-iso-design.md. Cada
// semana pertence ao mês que contém a MAIORIA dos seus 7 dias -- como 7 é
// ímpar, nunca há empate, e uma semana de 7 dias nunca toca 3 meses (nem
// fevereiro, o mês mais curto, tem menos de 7 dias).
// ============================================================

// Dia inteiro desde a época Unix (1970-01-01), a partir de QUALQUER
// instante de um Date -- só um floor, sem ajuste de fuso: quem constrói o
// Date decide se quer o dia civil local (new Date(ano,mes,dia), meia-noite
// local) ou outro instante. Mesma unidade usada nos eventos de furos
// (chegada/sondagemRealizada/saidaEstoque, ver compute-demandas.js) --
// permite comparar datas como inteiros simples, sem reconstruir Date.
function diaEpoch(data) {
  return Math.floor(data.getTime() / 86400000);
}

// Dado o início (segunda) de uma semana ISO, decide qual (ano, mês) tem a
// maioria dos seus 7 dias.
function mesDaSemana(segunda) {
  var contagem = {};
  var melhorChave = null;
  var melhorContagem = 0;
  for (var i = 0; i < 7; i++) {
    var d = new Date(segunda.getFullYear(), segunda.getMonth(), segunda.getDate() + i);
    var chave = d.getFullYear() + '-' + d.getMonth();
    contagem[chave] = (contagem[chave] || 0) + 1;
    if (contagem[chave] > melhorContagem) {
      melhorContagem = contagem[chave];
      melhorChave = chave;
    }
  }
  var partes = melhorChave.split('-');
  return { ano: Number(partes[0]), mes: Number(partes[1]) };
}

// Semanas ISO (segunda a domingo) cuja maioria dos dias cai em (ano,
// mesIndex) -- 4 ou 5 semanas, na ordem do calendário. inicio/fim de cada
// semana já vêm em diaEpoch, prontos pra comparar com datas de furos sem
// reconstruir Date. Varre a partir de uma semana antes do 1º dia do mês
// (cobre o caso da 1ª semana do mês pertencer, pela regra da maioria, ao
// mês anterior) e avança semana a semana -- no máximo 5 semanas próprias +
// as 2 de fronteira cabem com folga em 8 iterações.
function semanasDoMes(ano, mesIndex) {
  var primeiroDia = new Date(ano, mesIndex, 1);
  var deslocamento = (primeiroDia.getDay() + 6) % 7; // 0=segunda..6=domingo
  var cursor = new Date(ano, mesIndex, 1 - deslocamento - 7);
  var semanas = [];
  for (var i = 0; i < 8; i++) {
    var segunda = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
    var domingo = new Date(segunda.getFullYear(), segunda.getMonth(), segunda.getDate() + 6);
    var dono = mesDaSemana(segunda);
    if (dono.ano === ano && dono.mes === mesIndex) {
      semanas.push({ inicio: diaEpoch(segunda), fim: diaEpoch(domingo) });
    }
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7);
  }
  return semanas;
}

// Índice (0-based) da semana, dentro de semanasDoMes, que contém hojeEpoch
// -- ou -1 se nenhuma contém (dias de fronteira entre meses: a semana ISO
// que cobre esses dias pode pertencer ao mês anterior pela regra da
// maioria -- ver spec).
function indiceSemanaAtual(semanas, hojeEpoch) {
  for (var i = 0; i < semanas.length; i++) {
    if (hojeEpoch >= semanas[i].inicio && hojeEpoch <= semanas[i].fim) return i;
  }
  return -1;
}
// FIM CLIENTE >>>

module.exports = {
  SEMANAS, dividirEmSemanas, fecharMes, semanaAtual,
  diaEpoch, semanasDoMes, indiceSemanaAtual,
};
```

- [ ] **Step 4: Ponte temporária em `render-aba-semanal.js`**

`render-aba-semanal.js` ainda não muda de verdade nesta tarefa (isso é a Tarefa 3), mas o
único call site de `dividirEmSemanas` lá dentro precisa do 3º argumento agora que ele é
obrigatório. `SEMANAS` já está destruturado no require do topo do arquivo -- é só passar
explicitamente, ZERO mudança de comportamento (mesma constante 4 de sempre, até a Tarefa 3
trocar por `numSemanas` de verdade):

Em `tools/semanal/render-aba-semanal.js`, mudar:
```js
    var semanasPrevisto = dividirEmSemanas(mesVigente, dimensao);
```
para:
```js
    var semanasPrevisto = dividirEmSemanas(mesVigente, dimensao, SEMANAS); // ponte temporária -- Tarefa 3 troca por numSemanas real
```

- [ ] **Step 5: Rodar e confirmar**

Run: `node --test test/semanal-compute-semanal.test.js`
Expected: PASS em tudo.

- [ ] **Step 6: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS em tudo -- a ponte do Step 4 é neutra, nenhum outro teste deveria mudar de
resultado.

- [ ] **Step 7: Commit**

```bash
git add tools/semanal/compute-semanal.js tools/semanal/render-aba-semanal.js test/semanal-compute-semanal.test.js
git commit -m "$(cat <<'EOF'
Calendário ISO de semanas reais em compute-semanal.js

diaEpoch/semanasDoMes/indiceSemanaAtual: semanas segunda-domingo,
atribuídas ao mês que tem a maioria dos seus 7 dias -- 2026 tem 53
semanas ISO, cada mês com 4 ou 5. dividirEmSemanas ganha numSemanas
obrigatório (substitui a constante fixa). semanaAtual/SEMANAS ficam
temporariamente obsoletos, ainda consumidos pelo código antigo de
render-aba-semanal.js até a Tarefa 3 trocar pelo calendário real.
EOF
)"
```

---

### Task 2: Lista de eventos em `compute-demandas.js`

**Files:**
- Modify: `tools/comum/datas.js` (adiciona `diaEpoch`, versão canônica em Node)
- Modify: `tools/semanal/compute-demandas.js` (adiciona `porRegistroEventos`, mantém `porRegistro`)
- Test: `test/semanal-compute-demandas.test.js` (só adiciona -- os testes existentes de `porRegistro` continuam intocados)

**Interfaces:**
- Consumes: nada de tarefas anteriores.
- Produces: `diaEpoch(data)` em `tools/comum/datas.js` (Node). `computeDemandas(...)` passa
  a devolver também `porRegistroEventos` -- `{ [chaveMatriz]: { chegada: number[],
  sondagemRealizada: number[], saidaEstoque: number[] } }`, todos em dias-desde-época.
  `porRegistro` (mensal) continua existindo, intocado -- só é removido na Tarefa 3, quando
  o único consumidor (`render-aba-semanal.js`) for reescrito pra ler o novo formato.

- [ ] **Step 1: Escrever os testes**

Em `test/semanal-compute-demandas.test.js`, adicionar no topo do arquivo (junto dos outros
requires):

```js
const { diaEpoch } = require('../tools/comum/datas.js');
```

E adicionar, no fim do arquivo:

```js
test('porRegistroEventos: chegada tem um dia por furo (qualquer status), sondagemRealizada só CONCLUIDO/EXECUTADO', () => {
  const saida = computeDemandas([
    furo({ status: 'CONCLUIDO', criacaoOS: d(2026, 1, 5), terminoSondagem: d(2026, 2, 10) }),
    furo({ status: 'PENDENTE', criacaoOS: d(2026, 1, 6), terminoSondagem: null, conclusao: null }),
  ], PERIODOS_2026);
  const entrada = saida.porRegistroEventos['SUP-0001-24||SP'];
  assert.strictEqual(entrada.chegada.length, 2, 'os 2 furos têm criacaoOS, PENDENTE inclusive');
  assert.strictEqual(entrada.sondagemRealizada.length, 1, 'só o CONCLUIDO conta pro fluxo Realizado');
});

test('porRegistroEventos: saidaEstoque é o MENOR entre término e cancelamento, nunca os dois separados -- furos CANCELADO com término preenchido existem na planilha real (16, ver spec)', () => {
  const saida = computeDemandas([
    furo({ status: 'CANCELADO', criacaoOS: d(2026, 1, 1), terminoSondagem: d(2026, 2, 1), cancelamento: d(2026, 3, 1), conclusao: null }),
  ], PERIODOS_2026);
  const entrada = saida.porRegistroEventos['SUP-0001-24||SP'];
  assert.strictEqual(entrada.saidaEstoque.length, 1, 'um furo só sai do estoque uma vez, mesmo com 2 datas candidatas');
  assert.strictEqual(entrada.saidaEstoque[0], diaEpoch(d(2026, 2, 1)), 'usa a data mais cedo (término), não o cancelamento');
});

test('porRegistroEventos: cancelamento antes do término também usa o menor (o cancelamento)', () => {
  const saida = computeDemandas([
    furo({ status: 'CANCELADO', criacaoOS: d(2026, 1, 1), terminoSondagem: d(2026, 5, 1), cancelamento: d(2026, 2, 1), conclusao: null }),
  ], PERIODOS_2026);
  const entrada = saida.porRegistroEventos['SUP-0001-24||SP'];
  assert.strictEqual(entrada.saidaEstoque.length, 1);
  assert.strictEqual(entrada.saidaEstoque[0], diaEpoch(d(2026, 2, 1)));
});

test('porRegistroEventos: furo sem término nem cancelamento nunca aparece em saidaEstoque (nunca sai do estoque)', () => {
  const saida = computeDemandas([
    furo({ status: 'PENDENTE', criacaoOS: d(2026, 1, 1), terminoSondagem: null, cancelamento: null, conclusao: null }),
  ], PERIODOS_2026);
  const entrada = saida.porRegistroEventos['SUP-0001-24||SP'];
  assert.deepStrictEqual(entrada.saidaEstoque, []);
});

test('porRegistroEventos: reconstrói o mesmo saldo mensal que porRegistro.pendentes, contando chegada/saidaEstoque até o fim de cada mês', () => {
  const furos = [
    furo({ status: 'CONCLUIDO', criacaoOS: d(2026, 1, 10), terminoSondagem: d(2026, 3, 20) }),
    furo({ status: 'PENDENTE', criacaoOS: d(2026, 2, 5), terminoSondagem: null, conclusao: null }),
  ];
  const saida = computeDemandas(furos, PERIODOS_2026);
  const eventos = saida.porRegistroEventos['SUP-0001-24||SP'];
  const fimDoMes1Based = (ano, mesUm) => diaEpoch(new Date(Date.UTC(ano, mesUm, 0, 23, 59, 59)));
  const saldoEm = (corte) =>
    eventos.chegada.filter(dia => dia <= corte).length - eventos.saidaEstoque.filter(dia => dia <= corte).length;
  const esperado = saida.porRegistro['SUP-0001-24||SP'].pendentes;
  for (let mes = 0; mes < 12; mes++) {
    assert.strictEqual(saldoEm(fimDoMes1Based(2026, mes + 1)), esperado[mes], `mês ${mes}: saldo por eventos precisa bater com porRegistro.pendentes`);
  }
});

test('porRegistroEventos: par (sup, tipologia) sem nenhum furo fica ausente, não aparece com arrays vazios "à toa"', () => {
  const saida = computeDemandas([furo()], PERIODOS_2026);
  assert.strictEqual('SUP-9999-99||SP' in saida.porRegistroEventos, false);
});

test('a saída sobrevive a JSON.stringify com porRegistroEventos também', () => {
  const saida = computeDemandas([furo()], PERIODOS_2026);
  const voltou = JSON.parse(JSON.stringify(saida));
  assert.deepStrictEqual(voltou.porRegistroEventos, saida.porRegistroEventos);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/semanal-compute-demandas.test.js`
Expected: FAIL nos 7 testes novos (`porRegistroEventos` ainda não existe na saída).

- [ ] **Step 3: Implementar `diaEpoch` em `tools/comum/datas.js`**

Adicionar (antes de `module.exports`):

```js
// Dia inteiro desde a época Unix (1970-01-01) -- mesma função de
// tools/semanal/compute-semanal.js (duplicada lá de propósito: aquele
// arquivo entra no bundle do navegador e não tem require nenhum; esta é a
// versão canônica, usada em Node). Ver
// docs/superpowers/specs/2026-07-30-semanal-calendario-iso-design.md.
function diaEpoch(data) {
  return Math.floor(data.getTime() / 86400000);
}
```

E mudar `module.exports = { excelSerialParaData, formatarMesAno, calcularVigenteIdx };`
para `module.exports = { excelSerialParaData, formatarMesAno, calcularVigenteIdx, diaEpoch };`.

- [ ] **Step 4: Implementar `porRegistroEventos` em `compute-demandas.js`**

Adicionar o require de `diaEpoch` no topo:
```js
const { diaEpoch } = require('../comum/datas.js');
```

Adicionar, perto de `serieRegistroVazia` (pode ficar logo abaixo dela):
```js
// Eventos brutos por (sup, tipologia), em dias-desde-época (diaEpoch) --
// substitui, de propósito, um valor pré-somado por mês: a Tabela semanal
// (Tarefa 3 do plano do calendário ISO) precisa recortar Realizado/
// Pendentes por semana real, inclusive "até hoje" na semana em curso, algo
// que uma granularidade fixa (mês ou semana) não serve -- ver
// docs/superpowers/specs/2026-07-30-semanal-calendario-iso-design.md,
// seção "Fonte de dados".
function entradaEventosVazia() {
  return { chegada: [], sondagemRealizada: [], saidaEstoque: [] };
}
```

Dentro de `computeDemandas`, logo após `const porRegistro = new Map();`, adicionar:
```js
  const porRegistroEventos = new Map();
```

Dentro do laço `for (const f of furos || [])`, logo após o bloco que já monta
`chaveRegistro`/`serieRegistro` (ou seja, reaproveitando a MESMA `chaveRegistro` já
calculada ali), adicionar:
```js
    if (!porRegistroEventos.has(chaveRegistro)) porRegistroEventos.set(chaveRegistro, entradaEventosVazia());
    const eventosRegistro = porRegistroEventos.get(chaveRegistro);

    if (f.criacaoOS) eventosRegistro.chegada.push(diaEpoch(f.criacaoOS));

    if (STATUS_REALIZADO.indexOf(f.status) !== -1 && f.terminoSondagem) {
      eventosRegistro.sondagemRealizada.push(diaEpoch(f.terminoSondagem));
    }

    // saidaEstoque: o MENOR entre término (qualquer status) e cancelamento
    // -- nunca os dois independentes, pra não contar duas vezes os furos
    // CANCELADO que também têm data de término preenchida (16 na planilha
    // real, ver spec). Só entra se pelo menos um dos dois existir; sem
    // nenhum, o furo nunca sai do estoque (mesma regra de porRegistro).
    const candidatosSaida = [];
    if (f.terminoSondagem) candidatosSaida.push(diaEpoch(f.terminoSondagem));
    if (cancelado && f.cancelamento) candidatosSaida.push(diaEpoch(f.cancelamento));
    if (candidatosSaida.length) eventosRegistro.saidaEstoque.push(Math.min.apply(null, candidatosSaida));
```

E mudar o `return` final de `computeDemandas`, de:
```js
  return { tipologias, totais, porRegistro: Object.fromEntries(porRegistro) };
```
para:
```js
  return {
    tipologias, totais,
    porRegistro: Object.fromEntries(porRegistro), // ainda aqui só até a Tarefa 3 (render-aba-semanal.js) trocar de vez pra porRegistroEventos
    porRegistroEventos: Object.fromEntries(porRegistroEventos),
  };
```

- [ ] **Step 5: Rodar e confirmar**

Run: `node --test test/semanal-compute-demandas.test.js`
Expected: PASS em tudo (os testes de `porRegistro` continuam passando -- nada ali mudou).

- [ ] **Step 6: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS em tudo.

- [ ] **Step 7: Commit**

```bash
git add tools/comum/datas.js tools/semanal/compute-demandas.js test/semanal-compute-demandas.test.js
git commit -m "$(cat <<'EOF'
Adiciona porRegistroEventos (lista de eventos) em compute-demandas.js

Por (sup, tipologia): chegada/sondagemRealizada/saidaEstoque em
dias-desde-época, um elemento por furo -- não um valor pré-somado por
mês. saidaEstoque é o MENOR entre término (qualquer status) e
cancelamento, calculado por furo (16 furos CANCELADO reais têm os
dois preenchidos -- somar as duas listas separadas contaria essas
linhas duas vezes do saldo). Substitui porRegistro na Tarefa 3;
mantido em paralelo por enquanto, sem nenhuma mudança de
comportamento.
EOF
)"
```

---

### Task 3: `render-aba-semanal.js` consome tudo, remove o antigo

Esta é a tarefa que troca de vez a divisão nominal por 4 pelas semanas reais. Toca 3
arquivos de produção (o rewrite principal, mais a limpeza do que ficou obsoleto nas duas
tarefas anteriores) e reescreve/ajusta 4 arquivos de teste.

**Files:**
- Modify: `tools/semanal/render-aba-semanal.js` (reescrita quase completa)
- Modify: `tools/semanal/compute-semanal.js` (remove `semanaAtual`/`SEMANAS`, agora
  realmente obsoletos)
- Modify: `tools/semanal/compute-demandas.js` (remove `porRegistro`/`serieRegistroVazia`,
  agora sem consumidor)
- Test: `test/semanal-render-aba-semanal.test.js` (reescrita completa)
- Test: `test/semanal-compute-semanal.test.js` (remove os 2 testes de `semanaAtual`/`SEMANAS`)
- Test: `test/semanal-compute-demandas.test.js` (remove os 3 testes de `porRegistro`)
- Test: `test/semanal-render-semanal-wireup.test.js` (só as 2 chamadas diretas a
  `renderAbaSemanal`, que precisam do novo `ano`)
- Test: `test/semanal-build-dashboard.test.js` (só o teste "toda classe linha-*", que
  chama `renderAbaSemanal` direto com a assinatura antiga)

**Interfaces:**
- Consumes: `diaEpoch`, `semanasDoMes`, `indiceSemanaAtual`, `dividirEmSemanas` (Tarefa 1);
  `porRegistroEventos` (Tarefa 2).
- Produces: `renderAbaSemanal(registros, indices, dimensoes, vigenteIdx, ano, realizado)`
  -- MUDANÇA DE ASSINATURA: `ano` é um novo 5º parâmetro OBRIGATÓRIO (posicional, antes do
  6º opcional). `realizado` (6º, opcional) passa a ser `{ demandas, hojeEpoch }` --
  `diaDoMes`/`diasNoMes` são REMOVIDOS, `hojeEpoch` (inteiro, `diaEpoch`) os substitui.
  `demandas.porRegistroEventos` substitui `demandas.porRegistro`.

**Sabidamente esperado**: depois desta tarefa, o teste
`'Realizado/Tendência aparecem de ponta a ponta quando a dimensão Volume está marcada e demandas.porRegistro tem dado real'`
em `test/semanal-render-semanal-wireup.test.js` continua VERMELHO -- ele passa pela
fiação real do cliente (`render-semanal.js`), que só é atualizada na Tarefa 4. Confirme
que é APENAS este teste que fica vermelho (pelo motivo documentado), não outro.

- [ ] **Step 1: Escrever os testes (reescrita completa de `test/semanal-render-aba-semanal.test.js`)**

Substituir o arquivo inteiro por:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderAbaSemanal, rotuloColunaFechamento } = require('../tools/semanal/render-aba-semanal.js');
const { diaEpoch } = require('../tools/comum/datas.js');

const ANO = 2026;
const VIGENTE_JULHO = 6; // julho tem 5 semanas (S27..S31) -- cenário principal
const VIGENTE_AGOSTO = 7; // agosto tem 4 semanas (S32..S36) -- confirma que N=4 também funciona

function registro(volumeMes) {
  const zeros = new Array(12).fill(0);
  const vol = new Array(12).fill(0); vol[VIGENTE_JULHO] = volumeMes;
  const bloco = (v) => ({ equipes: new Array(12).fill(2), volume: v, financeiro: zeros,
    equipesResumo: { pico: 2, media: 2, prod: 8, dias: 25 },
    volumeResumo: { total: volumeMes, totalInicial: volumeMes, ticket: 1 },
    financeiroResumo: { total: 0, totalInicial: 0 } });
  return { sup: 'SUP-0001-24', grupo: 'G', tomador: 'T', tipologia: 'ST',
           previsto: bloco(vol), realizado: bloco(zeros), total: bloco(zeros) };
}

test('mostra as 5 semanas de julho (mês com 5 semanas ISO) com P, R e T', () => {
  const html = renderAbaSemanal([registro(1000)], [0], ['volume'], VIGENTE_JULHO, ANO);
  for (const s of ['S1', 'S2', 'S3', 'S4', 'S5']) assert.match(html, new RegExp(s));
  assert.doesNotMatch(html, /S6/);
  assert.match(html, /Previsto/); assert.match(html, /Realizado/); assert.match(html, /Tend/);
});

test('mostra as 4 semanas de agosto (mês com 4 semanas ISO)', () => {
  const html = renderAbaSemanal([registro(1000)], [0], ['volume'], VIGENTE_AGOSTO, ANO);
  for (const s of ['S1', 'S2', 'S3', 'S4']) assert.match(html, new RegExp(s));
  assert.doesNotMatch(html, /S5/);
});

test('previsto de volume divide pelo número REAL de semanas do mês -- 1000/5 em julho, 800/4 em agosto', () => {
  const htmlJulho = renderAbaSemanal([registro(1000)], [0], ['volume'], VIGENTE_JULHO, ANO);
  assert.match(htmlJulho, /<td class="num">200,00<\/td>/);

  const registroAgosto = registro(0);
  registroAgosto.previsto.volume[VIGENTE_AGOSTO] = 800;
  const htmlAgosto = renderAbaSemanal([registroAgosto], [0], ['volume'], VIGENTE_AGOSTO, ANO);
  assert.match(htmlAgosto, /<td class="num">200,00<\/td>/);
});

test('a coluna de fechamento muda de rótulo conforme a dimensão', () => {
  assert.strictEqual(rotuloColunaFechamento('volume'), 'Total');
  assert.strictEqual(rotuloColunaFechamento('financeiro'), 'Total');
  assert.strictEqual(rotuloColunaFechamento('equipes'), 'Média');
});

test('realizado e tendência ficam vazios sem demandas', () => {
  const html = renderAbaSemanal([registro(1000)], [0], ['volume'], VIGENTE_JULHO, ANO);
  assert.match(html, /class="[^"]*sem-dado/);
});

test('com uma dimensão só, renderiza exatamente 1 bloco/tabela', () => {
  const html = renderAbaSemanal([registro(1000)], [0], ['volume'], VIGENTE_JULHO, ANO);
  assert.equal((html.match(/<div class="bloco-dimensao-semanal">/g) || []).length, 1);
  assert.equal((html.match(/<table class="tabela-semanal">/g) || []).length, 1);
});

test('com várias dimensões marcadas, renderiza um bloco por dimensão, na ordem recebida', () => {
  const html = renderAbaSemanal([registro(1000)], [0], ['equipes', 'volume', 'financeiro'], VIGENTE_JULHO, ANO);
  const blocos = html.split('<div class="bloco-dimensao-semanal">').slice(1);
  assert.equal(blocos.length, 3);
  assert.match(blocos[0], /<div class="tabela-semanal-titulo">Equipes<\/div>/);
  assert.match(blocos[1], /<div class="tabela-semanal-titulo">Volume<\/div>/);
  assert.match(blocos[2], /<div class="tabela-semanal-titulo">Financeiro<\/div>/);
  assert.match(blocos[0], />Média<\/th>/);
  assert.match(blocos[1], />Total<\/th>/);
  assert.match(blocos[2], />Total<\/th>/);
});

test('título do bloco escapa o rótulo da dimensão', () => {
  const html = renderAbaSemanal([registro(1000)], [0], ['volume'], VIGENTE_JULHO, ANO);
  assert.match(html, /<div class="tabela-semanal-titulo">Volume<\/div>/);
});

test('sem o 6º parâmetro, o comportamento é o mesmo de sem demandas -- Realizado/Tendência sem-dado, sem linha de Pendentes', () => {
  const html = renderAbaSemanal([registro(1000)], [0], ['volume'], VIGENTE_JULHO, ANO);
  assert.doesNotMatch(html, /Demandas Pendentes/);
  const linhasSemDado = (html.match(/class="num sem-dado"/g) || []).length;
  assert.strictEqual(linhasSemDado, 10, '5 semanas (julho) x 2 linhas (Realizado + Tendência)');
});

test('com demandas SEM a chave porRegistroEventos, o comportamento fica idêntico ao de sem demandas', () => {
  const html = renderAbaSemanal([registro(1000)], [0], ['volume'], VIGENTE_JULHO, ANO,
    { demandas: { tipologias: [], totais: {} }, hojeEpoch: diaEpoch(new Date(2026, 6, 15)) });
  assert.doesNotMatch(html, /Demandas Pendentes/, 'demandas.porRegistroEventos é undefined -- diferente de {} vazio, que é um agregado real');
});

test('com demandas.porRegistroEventos presente mas vazio ({}), a linha Demandas Pendentes aparece com zero, não fica escondida', () => {
  const html = renderAbaSemanal([registro(1000)], [0], ['volume'], VIGENTE_JULHO, ANO,
    { demandas: { porRegistroEventos: {} }, hojeEpoch: diaEpoch(new Date(2026, 6, 15)) });
  assert.match(html, /Demandas Pendentes/, 'porRegistroEventos:{} é um agregado real (zero furos casaram) -- a linha aparece, mostrando 0');
  const linhaPendentes = html.match(/<tr class="linha-serie-semanal linha-pendentes-demandas">[\s\S]*?<\/tr>/)[0];
  assert.match(linhaPendentes, /celula-total-linha">0,00/);
});

// --- Cenário principal: julho de 2026 (5 semanas: S27 29/06-05/07, S28
// 06/07-12/07, S29 13/07-19/07, S30 20/07-26/07, S31 27/07-02/08), hoje =
// 15/07 (dentro de S29 -- semana em curso, índice 2 0-based). -----------

function diaJul(dia) { return diaEpoch(new Date(2026, 6, dia)); }
const HOJE_15_JUL = diaJul(15);

test('Realizado semanal: semana fechada soma o intervalo inteiro, semana em curso soma só até hoje, semana futura é 0 -- valores exatos [2,3,1,0,0] e fechamento 6', () => {
  const eventos = {
    sondagemRealizada: [
      diaJul(1), diaJul(1),
      diaJul(8), diaJul(8), diaJul(8),
      diaJul(14),
      diaJul(18),
      diaJul(22), diaJul(22), diaJul(22), diaJul(22), diaJul(22),
      diaJul(28), diaJul(28), diaJul(28), diaJul(28),
    ],
    saidaEstoque: [], chegada: [],
  };
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': eventos } };
  const html = renderAbaSemanal([registro(0)], [0], ['volume'], VIGENTE_JULHO, ANO, { demandas, hojeEpoch: HOJE_15_JUL });
  const linhaRealizado = html.match(/<tr class="linha-serie-semanal linha-realizado">[\s\S]*?<\/tr>/)[0];
  const numeros = linhaRealizado.match(/<td class="num[^"]*">([^<]*)<\/td>/g).map(td => td.match(/>([^<]*)</)[1]);
  assert.deepStrictEqual(numeros, ['2,00', '3,00', '1,00', '0,00', '0,00', '6,00']);
});

test('Tendência: semanas fechada/em-curso usam o Realizado real, futuras dividem igualmente o saldo restante do Previsto', () => {
  const eventos = {
    sondagemRealizada: [diaJul(1), diaJul(1), diaJul(8), diaJul(8), diaJul(8), diaJul(14)],
    saidaEstoque: [], chegada: [],
  };
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': eventos } };
  // Previsto do mês = 1000. Realizado até agora (S27+S28+S29 parcial) = 2+3+1 = 6.
  // 2 semanas futuras (S30, S31): saldoRestante = 1000 - 6 = 994, /2 = 497 cada.
  const html = renderAbaSemanal([registro(1000)], [0], ['volume'], VIGENTE_JULHO, ANO, { demandas, hojeEpoch: HOJE_15_JUL });
  const linhaTendencia = html.match(/<tr class="linha-serie-semanal linha-tendencia">[\s\S]*?<\/tr>/)[0];
  const numeros = linhaTendencia.match(/<td class="num[^"]*">([^<]*)<\/td>/g).map(td => td.match(/>([^<]*)</)[1]);
  assert.deepStrictEqual(numeros, ['2,00', '3,00', '1,00', '497,00', '497,00', '1.000,00']);
});

test('Tendência nunca fica negativa quando o Realizado já passou o Previsto -- continua no ritmo já realizado', () => {
  const eventos = {
    // 20 furos concentrados em S27+S28: realizado até agora bem acima do Previsto.
    sondagemRealizada: new Array(10).fill(diaJul(1)).concat(new Array(10).fill(diaJul(8))),
    saidaEstoque: [], chegada: [],
  };
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': eventos } };
  const html = renderAbaSemanal([registro(5)], [0], ['volume'], VIGENTE_JULHO, ANO, { demandas, hojeEpoch: HOJE_15_JUL });
  const linhaTendencia = html.match(/<tr class="linha-serie-semanal linha-tendencia">[\s\S]*?<\/tr>/)[0];
  assert.doesNotMatch(linhaTendencia, />-/, 'nenhum valor negativo -- ">-" isola número negativo dos hífens em nomes de classe');
  // realizadoAteAgora (S27+S28+S29) = 10+10+0 = 20; ritmo = 20/3 semanas elapsadas.
  const ritmo = (20 / 3).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const numeros = linhaTendencia.match(/<td class="num[^"]*">([^<]*)<\/td>/g).map(td => td.match(/>([^<]*)</)[1]);
  assert.strictEqual(numeros[3], ritmo, 'semana futura S30 continua no ritmo médio já realizado');
  assert.strictEqual(numeros[4], ritmo, 'semana futura S31 idem');
});

test('Tendência: na última semana do mês (sem semana futura), os números batem exatamente com Realizado', () => {
  const eventos = {
    sondagemRealizada: [diaJul(1), diaJul(8), diaJul(14), diaJul(22), diaJul(29)],
    saidaEstoque: [], chegada: [],
  };
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': eventos } };
  const html = renderAbaSemanal([registro(1000)], [0], ['volume'], VIGENTE_JULHO, ANO, { demandas, hojeEpoch: diaJul(31) }); // dentro de S31, a última
  const linhaTendencia = html.match(/<tr class="linha-serie-semanal linha-tendencia">[\s\S]*?<\/tr>/)[0];
  const linhaRealizado = html.match(/<tr class="linha-serie-semanal linha-realizado">[\s\S]*?<\/tr>/)[0];
  const numerosTendencia = linhaTendencia.match(/<td class="num[^"]*">[^<]*<\/td>/g);
  const numerosRealizado = linhaRealizado.match(/<td class="num[^"]*">[^<]*<\/td>/g);
  assert.deepStrictEqual(numerosTendencia, numerosRealizado);
});

test('Demandas Pendentes: semana fechada mostra o saldo no domingo daquela semana, semana em curso mostra o saldo de hoje, semana futura fica sem-dado', () => {
  const eventos = {
    chegada: new Array(10).fill(diaJul(-30)), // 10 furos, todos chegados antes de julho
    saidaEstoque: [diaJul(2), diaJul(2), diaJul(9)], // 2 saem durante S27, 1 durante S28
    sondagemRealizada: [],
  };
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': eventos } };
  const html = renderAbaSemanal([registro(0)], [0], ['volume'], VIGENTE_JULHO, ANO, { demandas, hojeEpoch: HOJE_15_JUL });
  const linhaPendentes = html.match(/<tr class="linha-serie-semanal linha-pendentes-demandas">[\s\S]*?<\/tr>/)[0];
  const celulas = linhaPendentes.match(/<td class="num[^"]*"[^>]*>([^<]*)<\/td>/g).map(td => td.match(/>([^<]*)</)[1]);
  // S27 fim (05/07): 10 chegaram - 2 saíram = 8. S28 fim (12/07): 10-3=7.
  // S29 (em curso, hoje 15/07): 10-3=7 (nenhuma saída nova entre 09/07 e 15/07).
  // S30/S31 (futuras): sem-dado (célula vazia).
  assert.deepStrictEqual(celulas, ['8,00', '7,00', '7,00', '', '']);
  assert.match(linhaPendentes, /celula-total-linha">7,00/, 'fechamento é sempre o saldo de hoje, calculado direto');
});

test('registro cuja combinação (sup, tipologia) não existe em demandas.porRegistroEventos contribui 0, não é excluído da soma', () => {
  const demandas = { porRegistroEventos: { 'SUP-0002-24||ST': { sondagemRealizada: [diaJul(1)], saidaEstoque: [], chegada: [] } } };
  const html = renderAbaSemanal([registro(1000)], [0], ['volume'], VIGENTE_JULHO, ANO, { demandas, hojeEpoch: HOJE_15_JUL }); // registro é SUP-0001-24, não bate
  const linhaRealizado = html.match(/<tr class="linha-serie-semanal linha-realizado">[\s\S]*?<\/tr>/)[0];
  assert.doesNotMatch(linhaRealizado, /sem-dado/, '"sem furo" é uma contagem real (0), não uma lacuna');
  assert.match(linhaRealizado, /<td class="num">0,00<\/td>/);
});

test('Realizado/Tendência só aparecem no bloco Volume -- Equipes e Financeiro continuam sem-dado mesmo com demandas presente', () => {
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': { sondagemRealizada: [diaJul(1)], saidaEstoque: [], chegada: [] } } };
  const html = renderAbaSemanal([registro(1000)], [0], ['equipes', 'financeiro'], VIGENTE_JULHO, ANO, { demandas, hojeEpoch: HOJE_15_JUL });
  assert.doesNotMatch(html, /Demandas Pendentes/);
  const linhasSemDado = (html.match(/class="num sem-dado"/g) || []).length;
  assert.strictEqual(linhasSemDado, 20, '2 dimensões x 5 semanas (julho) x 2 linhas (Realizado + Tendência)');
});

test('vigenteIdx fora do intervalo do ano (12 ou -1): Realizado/Tendência ficam sem-dado, mas Demandas Pendentes ainda mostra o fechamento -- saldo de hoje independe do mês sendo exibido', () => {
  const eventos = { chegada: [diaJul(1)], saidaEstoque: [], sondagemRealizada: [diaJul(10)] };
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': eventos } };
  const html = renderAbaSemanal([registro(1000)], [0], ['volume'], 12, ANO, { demandas, hojeEpoch: HOJE_15_JUL });

  const linhaRealizado = html.match(/<tr class="linha-serie-semanal linha-realizado">[\s\S]*?<\/tr>/)[0];
  assert.match(linhaRealizado, /class="num sem-dado"/, 'Realizado sem-dado quando vigenteIdx é inválido');

  const linhaPendentes = html.match(/<tr class="linha-serie-semanal linha-pendentes-demandas">[\s\S]*?<\/tr>/)[0];
  const semDadoNaLinha = (linhaPendentes.match(/class="num sem-dado"/g) || []).length;
  assert.strictEqual(semDadoNaLinha, 4, 'sem mês vigente válido não há semanas reais -- cai no fallback de 4 colunas, todas sem-dado');
  assert.match(linhaPendentes, /celula-total-linha">1,00/, 'fechamento continua mostrando o saldo de hoje: 1 chegada, 0 saídas até 15/07');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/semanal-render-aba-semanal.test.js`
Expected: FAIL -- `renderAbaSemanal` ainda tem a assinatura antiga (sem `ano`, com
`diaDoMes`/`diasNoMes`, lendo `demandas.porRegistro`).

- [ ] **Step 3: Reescrever `render-aba-semanal.js`**

Substituir o arquivo inteiro por:

```js
'use strict';
const { diaEpoch, semanasDoMes, indiceSemanaAtual, dividirEmSemanas, fecharMes } = require('./compute-semanal.js');

// Rótulo de exibição de cada dimensão -- só as 3 que a barra de filtros da
// semanal expõe (ver FILTROS_CONFIG_SEMANAL/DIMENSOES_CONFIG_SEMANAL em
// render-semanal.js); "produtividade"/"ticketMedio" do orçamento não têm
// equivalente aqui.
var DIMENSOES_ROTULO_SEMANAL = { equipes: 'Equipes', volume: 'Volume', financeiro: 'Financeiro' };

// Este módulo roda tanto no Node (testes) quanto embrulhado no navegador via
// buildBrowserBundle -- por isso 'var'/'function', não 'const'/arrow, e o
// require acima na forma EXATA que a reescrita de tools/comum/browser-bundle.js
// reconhece (`const { X, Y } = require('./arquivo.js');`, sem espaço antes do
// parêntese, com chaves). Ver o comentário no topo de transformaModulo lá.

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Mesmo formatador do orçamento (tools/orcamento/render-dashboard.js,
// SCRIPT_CLIENTE_TABELA): 2 casas por padrão, '—' pra ausência de valor.
function formatarNumero(v, casasDecimais) {
  if (v === null || v === undefined) return '—';
  var casas = casasDecimais === undefined ? 2 : casasDecimais;
  var fator = Math.pow(10, casas);
  return (Math.round(v * fator) / fator).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

// Equipes é uma FOTO (ver compute-semanal.js): fechar o mês combinando várias
// semanas é uma MÉDIA, não uma soma -- por isso o rótulo muda, pra impedir
// alguém de ler "Total" numa coluna de equipes e somar contratos por engano.
function rotuloColunaFechamento(dimensao) {
  return dimensao === 'equipes' ? 'Média' : 'Total';
}

// Soma, através dos registros em 'indices', o Previsto do mês vigente numa
// dimensão -- mesma soma-através-de-registros que somarArraysMensais faz no
// orçamento (tools/orcamento/render-dashboard.js), inclusive pra 'equipes':
// somar equipes de CONTRATOS DIFERENTES no mesmo mês é válido (times
// simultâneos se somam); o que NÃO se soma é equipes ao longo do TEMPO
// (semanas), que é o que dividirEmSemanas/fecharMes tratam à parte. null só
// quando NENHUM registro contribuinte tem valor no mês vigente -- inclusive
// quando vigenteIdx está fora de [0,11] (mensal[vigenteIdx] é undefined).
function previstoMesVigente(registros, indices, dimensao, vigenteIdx) {
  var soma = null;
  (indices || []).forEach(function (i) {
    var registro = registros[i];
    var serie = registro && registro.previsto;
    var mensal = serie && serie[dimensao];
    if (!Array.isArray(mensal)) return;
    var v = mensal[vigenteIdx];
    if (v === null || v === undefined) return;
    soma = (soma === null ? 0 : soma) + v;
  });
  return soma;
}

// Mesma expressão de chaveMatriz (tools/comum/linha-base.js) -- duplicada de
// propósito porque este módulo entra no bundle do navegador
// (buildBrowserBundle remove require('../comum/...'), não reescreve -- mesmo
// motivo já documentado em chaveBaseline, tools/semanal/compute-balanco.js).
function chaveDemandas(sup, tipologia) {
  return sup + '||' + tipologia;
}

// Soma, através dos registros em 'indices', quantos eventos de uma série de
// porRegistroEventos (compute-demandas.js) caem em [inicioEpoch, fimEpoch]
// (inclusive nos dois extremos). Ausência de (sup, tipologia) em
// porRegistroEventos, ou nenhum evento no intervalo, conta 0 -- mesma
// convenção "ausência = zero" de sempre (Avanço Sond é listagem completa).
function contarEventosNoIntervalo(registros, indices, demandas, serie, inicioEpoch, fimEpoch) {
  var total = 0;
  (indices || []).forEach(function (i) {
    var registro = registros[i];
    if (!registro) return;
    var entrada = demandas.porRegistroEventos[chaveDemandas(registro.sup, registro.tipologia)];
    if (!entrada || !Array.isArray(entrada[serie])) return;
    entrada[serie].forEach(function (dia) {
      if (dia >= inicioEpoch && dia <= fimEpoch) total += 1;
    });
  });
  return total;
}

// Saldo de furos em aberto na data 'dataEpoch' (inclusive), através dos
// registros em 'indices': chegou até ali, e ainda não saiu do estoque até
// ali. saidaEstoque já é o menor entre término e cancelamento, calculado
// por furo em compute-demandas.js -- ver o comentário lá sobre por que não
// dá pra subtrair as duas listas independentes.
function pendentesNaData(registros, indices, demandas, dataEpoch) {
  var total = 0;
  (indices || []).forEach(function (i) {
    var registro = registros[i];
    if (!registro) return;
    var entrada = demandas.porRegistroEventos[chaveDemandas(registro.sup, registro.tipologia)];
    if (!entrada) return;
    (entrada.chegada || []).forEach(function (dia) { if (dia <= dataEpoch) total += 1; });
    (entrada.saidaEstoque || []).forEach(function (dia) { if (dia <= dataEpoch) total -= 1; });
  });
  return total;
}

// Tendência semanal (Volume): semanas já fechadas ou em curso usam o
// Realizado REAL daquela semana (já é fato, não precisa projetar); semanas
// futuras distribuem igualmente o que falta pra bater o Previsto do mês.
// Quando o Realizado até agora já bateu ou passou o Previsto (saldo <= 0),
// as semanas futuras continuam no mesmo ritmo médio já realizado em vez de
// projetar um valor negativo. indiceAtual === -1 (nenhuma semana do mês
// começou ainda -- dias de fronteira entre meses) conta como "nenhuma
// semana elapsada": todas as semanas do mês são futuras, e a Tendência
// mostra previstoMes/numSemanas igualmente em todas.
function calcularTendenciaSemanal(previstoMes, semanasRealizado, indiceAtual) {
  var numSemanas = semanasRealizado.length;
  if (previstoMes === null) return semanasRealizado.map(function () { return null; });

  var semanasElapsadas = indiceAtual + 1; // 0 quando indiceAtual === -1
  var realizadoAteAgora = 0;
  for (var s = 0; s < semanasElapsadas; s++) realizadoAteAgora += semanasRealizado[s];

  var semanasFuturas = numSemanas - semanasElapsadas;
  var saldoRestante = previstoMes - realizadoAteAgora;
  var ritmoRealizado = semanasElapsadas > 0 ? realizadoAteAgora / semanasElapsadas : previstoMes / numSemanas;
  var tendenciaFutura = semanasFuturas > 0
    ? (saldoRestante > 0 ? saldoRestante / semanasFuturas : ritmoRealizado)
    : 0;

  var saida = [];
  for (var i = 0; i < numSemanas; i++) {
    saida.push(i < semanasElapsadas ? semanasRealizado[i] : tendenciaFutura);
  }
  return saida;
}

function renderCabecalho(dimensao, numSemanas) {
  var colunasSemana = '';
  for (var i = 1; i <= numSemanas; i++) colunasSemana += '<th>S' + i + '</th>';
  return '<thead><tr><th></th>' + colunasSemana + '<th>' + escapeHtml(rotuloColunaFechamento(dimensao)) + '</th></tr></thead>';
}

// 'semanas' são os N valores por semana (ou null); 'fechamento' é o valor já
// fechado (fecharMes) pra a coluna final. null em qualquer um vira a classe
// sem-dado.
function renderLinhaSerie(rotulo, classeSerie, semanas, fechamento) {
  var celulasSemana = semanas.map(function (v) {
    if (v === null || v === undefined) return '<td class="num sem-dado"></td>';
    return '<td class="num">' + formatarNumero(v) + '</td>';
  }).join('');
  var celulaFechamento = (fechamento === null || fechamento === undefined)
    ? '<td class="num celula-total-linha sem-dado"></td>'
    : '<td class="num celula-total-linha">' + formatarNumero(fechamento) + '</td>';
  return '<tr class="linha-serie-semanal linha-' + classeSerie + '">'
    + '<td class="serie-label">' + escapeHtml(rotulo) + '</td>'
    + celulasSemana + celulaFechamento + '</tr>';
}

// registros/indices/dimensoes/vigenteIdx: mesmos parâmetros de sempre. 'ano'
// (novo, obrigatório) é o ano civil da planilha (periodos[0].getUTCFullYear())
// -- necessário pra semanasDoMes saber quantas semanas (4 ou 5) o mês
// vigente tem, mesmo quando 'realizado' não é passado (Previsto/Equipes/
// Financeiro precisam da contagem certa de colunas independente de haver
// dado de demandas). 'realizado' é um 6º parâmetro OPCIONAL --
// { demandas, hojeEpoch } -- que ativa Realizado/Tendência/Demandas
// Pendentes no bloco Volume quando demandas.porRegistroEventos existe
// (Tarefa 2) e hojeEpoch é um número (dia-desde-época de "hoje", calculado
// pelo relógio de quem está vendo a página -- render-semanal.js calcula
// com diaEpoch(new Date(...)) a cada recálculo; esta função nunca chama
// new Date() internamente, fica pura e testável em Node com qualquer
// combinação).
//
// Duas coisas continuam válidas mesmo sem mês vigente válido (vigenteIdx
// fora de [0,11] -- ano inteiro no passado/futuro): a linha Demandas
// Pendentes ainda aparece (com as 4 semanas de fallback sem-dado, mas o
// fechamento mostra o saldo de hoje calculado direto) -- "quantas demandas
// estão pendentes agora" não depende de qual mês a tabela está exibindo.
function renderAbaSemanal(registros, indices, dimensoes, vigenteIdx, ano, realizado) {
  var opts = realizado || {};
  var mesValido = vigenteIdx >= 0 && vigenteIdx <= 11;
  var semanas = mesValido ? semanasDoMes(ano, vigenteIdx) : [];
  var numSemanas = mesValido ? semanas.length : 4;
  var temDemandas = !!(opts.demandas && opts.demandas.porRegistroEventos && typeof opts.hojeEpoch === 'number');
  var temSemanasReais = mesValido && temDemandas;
  var indiceAtual = temSemanasReais ? indiceSemanaAtual(semanas, opts.hojeEpoch) : -1;

  return dimensoes.map(function (dimensao) {
    var mesVigente = previstoMesVigente(registros, indices, dimensao, vigenteIdx);
    var semanasPrevisto = dividirEmSemanas(mesVigente, dimensao, numSemanas);
    var fechamentoPrevisto = fecharMes(semanasPrevisto, dimensao);
    var semanasSemDado = new Array(numSemanas).fill(null);

    var semanasRealizado = semanasSemDado;
    var fechamentoRealizado = null;
    var semanasTendencia = semanasSemDado;
    var fechamentoTendencia = null;
    var linhaPendentes = '';

    if (dimensao === 'volume' && temDemandas) {
      if (temSemanasReais) {
        semanasRealizado = semanas.map(function (semana, i) {
          if (i === indiceAtual) return contarEventosNoIntervalo(registros, indices, opts.demandas, 'sondagemRealizada', semana.inicio, opts.hojeEpoch);
          if (semana.fim < opts.hojeEpoch) return contarEventosNoIntervalo(registros, indices, opts.demandas, 'sondagemRealizada', semana.inicio, semana.fim);
          return 0; // semana futura -- nada aconteceu ainda
        });
        fechamentoRealizado = fecharMes(semanasRealizado, 'volume');

        semanasTendencia = calcularTendenciaSemanal(mesVigente, semanasRealizado, indiceAtual);
        fechamentoTendencia = fecharMes(semanasTendencia, 'volume');
      }

      var semanasPendentes = temSemanasReais
        ? semanas.map(function (semana, i) {
            if (i === indiceAtual) return pendentesNaData(registros, indices, opts.demandas, opts.hojeEpoch);
            if (semana.fim < opts.hojeEpoch) return pendentesNaData(registros, indices, opts.demandas, semana.fim);
            return null; // semana futura -- sem-dado, não projeta estoque futuro
          })
        : semanasSemDado;
      // Fechamento SEMPRE o saldo de hoje, calculado direto e independente
      // da quebra semanal -- "quantas demandas estão pendentes agora" não
      // depende de qual das N semanas está em curso, nem de haver semana
      // válida nenhuma.
      var fechamentoPendentes = pendentesNaData(registros, indices, opts.demandas, opts.hojeEpoch);
      linhaPendentes = renderLinhaSerie('Demandas Pendentes', 'pendentes-demandas', semanasPendentes, fechamentoPendentes);
    }

    return '<div class="bloco-dimensao-semanal">'
      + '<div class="tabela-semanal-titulo">' + escapeHtml(DIMENSOES_ROTULO_SEMANAL[dimensao] || dimensao) + '</div>'
      + '<table class="tabela-semanal">'
      + renderCabecalho(dimensao, numSemanas)
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

- [ ] **Step 4: Limpar `compute-semanal.js` (remover `semanaAtual`/`SEMANAS`, agora sem consumidor)**

Em `tools/semanal/compute-semanal.js`, remover a função `semanaAtual` inteira (o bloco
"OBSOLETO a partir do calendário ISO..."), remover a linha `var SEMANAS = 4;`, e mudar o
`module.exports` de:
```js
module.exports = {
  SEMANAS, dividirEmSemanas, fecharMes, semanaAtual,
  diaEpoch, semanasDoMes, indiceSemanaAtual,
};
```
para:
```js
module.exports = { dividirEmSemanas, fecharMes, diaEpoch, semanasDoMes, indiceSemanaAtual };
```

- [ ] **Step 5: Limpar `test/semanal-compute-semanal.test.js`**

Remover o teste `'SEMANAS/semanaAtual continuam em 4 fatias nominais -- obsoletos...'`
(escrito na Tarefa 1) e remover `SEMANAS, semanaAtual,` do require do topo do arquivo.

- [ ] **Step 6: Limpar `compute-demandas.js` (remover `porRegistro`/`serieRegistroVazia`, agora sem consumidor)**

Em `tools/semanal/compute-demandas.js`:
- Remover a função `serieRegistroVazia` inteira.
- Remover a linha `const porRegistro = new Map();`.
- Remover o bloco:
  ```js
    const chaveRegistro = chaveMatriz(f.sup, f.tipologia);
    if (!porRegistro.has(chaveRegistro)) porRegistro.set(chaveRegistro, serieRegistroVazia(n));
    const serieRegistro = porRegistro.get(chaveRegistro);
  ```
  e substituir por:
  ```js
    const chaveRegistro = chaveMatriz(f.sup, f.tipologia);
  ```
  (a linha continua necessária -- `porRegistroEventos` usa a mesma `chaveRegistro` logo
  abaixo -- só o resto do bloco antigo é removido).
- Remover as duas referências a `serieRegistro.sondagemRealizada[...] += 1` e
  `serieRegistro.pendentes[i] += 1` (ficam só `series.sondagemRealizada[...] += 1` e
  `series.pendentes[i] += 1`, sem o `serieRegistro.` companheiro).
- Mudar o `return` final de:
  ```js
    return {
      tipologias, totais,
      porRegistro: Object.fromEntries(porRegistro), // ainda aqui só até a Tarefa 3 (render-aba-semanal.js) trocar de vez pra porRegistroEventos
      porRegistroEventos: Object.fromEntries(porRegistroEventos),
    };
  ```
  para:
  ```js
    return { tipologias, totais, porRegistroEventos: Object.fromEntries(porRegistroEventos) };
  ```

- [ ] **Step 7: Limpar `test/semanal-compute-demandas.test.js`**

Remover os 3 testes que usam `porRegistro` (não `porRegistroEventos`):
`'porRegistro agrega sondagemRealizada e pendentes por (sup, tipologia)...'`,
`'par (sup, tipologia) sem nenhum furo fica AUSENTE de porRegistro...'`,
`'pendentes em porRegistro fecha com o mesmo saldo...'`.

O teste `'porRegistroEventos: reconstrói o mesmo saldo mensal que porRegistro.pendentes...'`
(escrito na Tarefa 2) também precisa mudar: ele lê `saida.porRegistro['SUP-0001-24||ST'].pendentes`
como `esperado`, e esse campo não existe mais. Trocar por um cálculo direto (sem depender
de `porRegistro`):

```js
test('porRegistroEventos: reconstrói o saldo mensal correto, contando chegada/saidaEstoque até o fim de cada mês', () => {
  const furos = [
    furo({ status: 'CONCLUIDO', criacaoOS: d(2026, 1, 10), terminoSondagem: d(2026, 3, 20) }),
    furo({ status: 'PENDENTE', criacaoOS: d(2026, 2, 5), terminoSondagem: null, conclusao: null }),
  ];
  const saida = computeDemandas(furos, PERIODOS_2026);
  const eventos = saida.porRegistroEventos['SUP-0001-24||SP'];
  const fimDoMes1Based = (ano, mesUm) => diaEpoch(new Date(Date.UTC(ano, mesUm, 0, 23, 59, 59)));
  const saldoEm = (corte) =>
    eventos.chegada.filter(dia => dia <= corte).length - eventos.saidaEstoque.filter(dia => dia <= corte).length;
  // Furo 1: chega jan/10, sai (termina) mar/20 -> aberto jan-fev, fechado a partir de mar.
  // Furo 2: chega fev/5, nunca sai -> aberto de fev em diante.
  const esperado = [0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2];
  for (let mes = 0; mes < 12; mes++) {
    assert.strictEqual(saldoEm(fimDoMes1Based(2026, mes + 1)), esperado[mes], `mês ${mes}`);
  }
});
```

(Esta versão substitui a escrita na Tarefa 2 -- Tarefa 2 não sabia ainda que `porRegistro`
seria removido nesta tarefa.)

- [ ] **Step 8: Corrigir as 2 chamadas diretas a `renderAbaSemanal` em `test/semanal-render-semanal-wireup.test.js`**

Estas 2 chamadas são só de dimensão `financeiro` (sem demandas) -- não precisam de
`hojeEpoch`, só do novo `ano` posicional. Trocar:
```js
  const esperado = renderAbaSemanal(registros, indicesTodos, ['financeiro'], vigenteIdx);
```
por:
```js
  const esperado = renderAbaSemanal(registros, indicesTodos, ['financeiro'], vigenteIdx, 2026);
```
(linha ~108) e:
```js
  const esperado = renderAbaSemanal(registros, [0], ['financeiro'], vigenteIdx); // só o índice 0 (SUP-0001-24)
```
por:
```js
  const esperado = renderAbaSemanal(registros, [0], ['financeiro'], vigenteIdx, 2026); // só o índice 0 (SUP-0001-24)
```
(linha ~207). Ambas usam `PERIODOS_2026` no `renderSemanal` correspondente, então `2026`
é o `ano` certo.

**Não mexer** no teste `'Realizado/Tendência aparecem de ponta a ponta...'` (o último do
arquivo) -- ele fica vermelho até a Tarefa 4, de propósito (ver a nota no topo desta
tarefa).

- [ ] **Step 9: Corrigir o teste "toda classe linha-\*" em `test/semanal-build-dashboard.test.js`**

Adicionar `const { diaEpoch } = require('../tools/comum/datas.js');` ao topo do arquivo
(junto dos outros requires). Trocar:
```js
  const demandas = { totais: { sondagemRealizada: new Array(12).fill(0), pendentes: new Array(12).fill(0) }, porRegistro: {} };
  const tabela = renderAbaSemanal(REGISTROS, [0], ['volume'], 0, { demandas, diaDoMes: 1, diasNoMes: 28 });
```
por:
```js
  const demandas = { porRegistroEventos: {} };
  const tabela = renderAbaSemanal(REGISTROS, [0], ['volume'], 0, 1970, { demandas, hojeEpoch: diaEpoch(new Date(1970, 0, 15)) });
```
(`1970` porque `PERIODOS` deste arquivo é `periodosDoAno(1970)` -- ver o topo do arquivo;
`vigenteIdx=0` já é passado como estava).

- [ ] **Step 10: Rodar e confirmar**

Run: `node --test test/semanal-render-aba-semanal.test.js test/semanal-compute-semanal.test.js test/semanal-compute-demandas.test.js test/semanal-render-semanal-wireup.test.js test/semanal-build-dashboard.test.js`
Expected: tudo PASS, **exceto** o teste
`'Realizado/Tendência aparecem de ponta a ponta quando a dimensão Volume está marcada e demandas.porRegistro tem dado real'`
em `semanal-render-semanal-wireup.test.js`, que continua FAIL -- confirme que a falha é
especificamente nele (fiação do cliente pendente, Tarefa 4), e não em nenhum outro teste
do arquivo.

- [ ] **Step 11: Rodar a suíte inteira e confirmar o estado esperado**

Run: `node --test test/*.test.js`
Expected: exatamente 1 falha (o teste nomeado no Step 10), todo o resto PASS. Se mais de 1
teste falhar, ou um teste diferente falhar, investigue antes de prosseguir -- não é o
resultado esperado desta tarefa.

- [ ] **Step 12: Commit**

```bash
git add tools/semanal/render-aba-semanal.js tools/semanal/compute-semanal.js tools/semanal/compute-demandas.js test/semanal-render-aba-semanal.test.js test/semanal-compute-semanal.test.js test/semanal-compute-demandas.test.js test/semanal-render-semanal-wireup.test.js test/semanal-build-dashboard.test.js
git commit -m "$(cat <<'EOF'
Tabela Semanal passa a usar semanas ISO reais, não mais 4 fatias nominais

renderAbaSemanal ganha um 5º parâmetro obrigatório (ano) e troca
diaDoMes/diasNoMes por hojeEpoch -- Previsto divide pelo número real
de semanas do mês (4 ou 5), Realizado soma eventos reais de
sondagemRealizada por intervalo de data (semana fechada = intervalo
inteiro, semana em curso = só até hoje, futura = 0), Tendência usa o
Realizado real das semanas já passadas, Demandas Pendentes ganha
quebra por semana (saldo no domingo de cada semana fechada, saldo de
hoje na semana em curso, sem-dado nas futuras -- fechamento sempre
saldo de hoje, independente da quebra). semanaAtual/SEMANAS
(compute-semanal.js) e porRegistro/serieRegistroVazia
(compute-demandas.js) removidos, sem consumidor.

Um teste de wireup fica vermelho de propósito até a próxima tarefa
(fiação no cliente, render-semanal.js) -- documentado no plano.
EOF
)"
```

---

### Task 4: Fiação no cliente — `render-semanal.js`

**Files:**
- Modify: `tools/semanal/render-semanal.js`
- Test: `test/semanal-render-semanal-wireup.test.js` (o teste deixado vermelho na Tarefa 3)
- Test: `test/semanal-build-dashboard.test.js` (`DEMANDAS_VAZIAS`)
- Test: `test/semanal-linha-base-costura.test.js` (`DEMANDAS_VAZIAS`)
- Test: `test/semanal-render-aba-balanco-wireup.test.js` (`DEMANDAS_VAZIAS`)

**Interfaces:**
- Consumes: `renderAbaSemanal(registros, indices, dimensoes, vigenteIdx, ano, realizado)`
  (Tarefa 3); `ComputeSemanal.diaEpoch` (Tarefa 1, já acessível via
  `MODULOS['compute-semanal.js']` -- ver Step 1).
- Produces: nenhuma interface nova exportada -- só liga o que já existe, e troca a
  validação de build de `demandas.porRegistro` pra `demandas.porRegistroEventos`.

- [ ] **Step 1: Ligar `hojeEpoch`/`ano` em `recalcularSemanal`**

Em `tools/semanal/render-semanal.js`, dentro de `SCRIPT_CLIENTE_SEMANAL`, a linha
`var ComputeSemanal = MODULOS['compute-semanal.js'];` já existe (documentada como "nunca
lida diretamente daqui em diante" -- isso deixa de ser verdade agora). Atualizar o
comentário logo acima dela, de:
```js
// ComputeSemanal/ComputeBalanco nunca são lidos diretamente daqui em diante
// -- quem faz o trabalho é RenderAbaSemanal/RenderAbaBalanco, que usam esses
// dois módulos por dentro (chamada indireta, dentro do bundle). Estas duas
// linhas continuam aqui só pra documentar que compute-semanal.js/
// compute-balanco.js FORAM carregados do bundle de propósito -- sem elas, um
// futuro leitor poderia achar que os dois módulos são código morto e
// removê-los do bundle junto, quebrando RenderAbaSemanal/RenderAbaBalanco.
```
para:
```js
// ComputeBalanco nunca é lido diretamente daqui em diante -- quem faz o
// trabalho é RenderAbaBalanco, que o usa por dentro (chamada indireta,
// dentro do bundle). ComputeSemanal MUDOU: recalcularSemanal usa
// ComputeSemanal.diaEpoch diretamente agora, pra calcular "hoje" em dias-
// desde-época com a MESMA convenção que os eventos de furos (ver
// compute-semanal.js/compute-demandas.js) -- sem isso, um futuro leitor
// poderia achar RenderAbaBalanco é o único motivo de ComputeBalanco estar
// aqui e continuar achando o mesmo de ComputeSemanal por engano.
```

Depois, mudar `recalcularSemanal` de:
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
  // hojeEpoch vem do relógio de quem está vendo a página (não do build) --
  // calculado de novo a cada recálculo, é barato e evita estado obsoleto se
  // a aba ficar aberta atravessando a meia-noite. Mesma convenção de fuso
  // que os eventos de furos usam (diaEpoch em compute-demandas.js): dia
  // civil LOCAL, não UTC -- new Date() já constrói no fuso de quem está
  // vendo a página.
  var hojeEpoch = ComputeSemanal.diaEpoch(new Date());
  document.getElementById('secao-semanal').innerHTML = RenderAbaSemanal.renderAbaSemanal(
    window.__REGISTROS__, indices, dimensoes, window.__VIGENTE_IDX__, window.__ANO__,
    { demandas: window.__DEMANDAS__, hojeEpoch: hojeEpoch }
  );
  montarAbaBalanco(window.__REGISTROS__, indices);
}
```

- [ ] **Step 2: Emitir `window.__ANO__` no HTML**

Em `renderSemanal`, mudar:
```js
  <script>window.__VIGENTE_IDX__ = ${vigenteIdx};</script>
```
para:
```js
  <script>window.__VIGENTE_IDX__ = ${vigenteIdx}; window.__ANO__ = ${periodos[0].getUTCFullYear()};</script>
```
(mesma tag -- não cria um novo `<script>`, pra não quebrar a contagem fixa de 6 blocos que
`test/semanal-render-semanal-wireup.test.js`'s `montarSandbox` já assume).

- [ ] **Step 3: Trocar a validação de build de `porRegistro` pra `porRegistroEventos`**

Em `renderSemanal`, mudar:
```js
  if (!demandas.porRegistro || typeof demandas.porRegistro !== 'object') {
    throw new Error('renderSemanal requer "demandas.porRegistro" (de tools/semanal/compute-demandas.js) -- sem isso Realizado/Tendência/Demandas Pendentes desapareceriam da Tabela Semanal sem nenhum erro no build.');
  }
```
para:
```js
  if (!demandas.porRegistroEventos || typeof demandas.porRegistroEventos !== 'object') {
    throw new Error('renderSemanal requer "demandas.porRegistroEventos" (de tools/semanal/compute-demandas.js) -- sem isso Realizado/Tendência/Demandas Pendentes desapareceriam da Tabela Semanal sem nenhum erro no build.');
  }
```

- [ ] **Step 4: Atualizar `DEMANDAS_VAZIAS` nos 4 arquivos de teste que a definem**

Em `test/semanal-build-dashboard.test.js`, `test/semanal-render-semanal-wireup.test.js`,
`test/semanal-linha-base-costura.test.js` e `test/semanal-render-aba-balanco-wireup.test.js`,
trocar:
```js
const DEMANDAS_VAZIAS = { tipologias: [], totais: {}, porRegistro: {} };
```
por:
```js
const DEMANDAS_VAZIAS = { tipologias: [], totais: {}, porRegistroEventos: {} };
```
(mesma linha nos 4 arquivos -- procure por `porRegistro: {}` em cada um).

- [ ] **Step 5: Corrigir o `demandas` fixture do teste deixado vermelho na Tarefa 3**

Em `test/semanal-render-semanal-wireup.test.js`, o teste
`'Realizado/Tendência aparecem de ponta a ponta...'` usa um `demandas` fixture com
`porRegistro` (mensal). Trocar:
```js
  const demandas = {
    // tipologias/totais: renderSemanal exige o formato {tipologias, totais}
    // de compute-demandas.js (ver DEMANDAS_VAZIAS acima) -- vazios aqui
    // porque este teste não olha a aba Demandas, só o wire-up de
    // Realizado/Tendência via porRegistro em window.__DEMANDAS__. totais
    // precisa refletir o mesmo comprimento/serie de porRegistro (revisão
    // final da branch): demandasMesVigente usa demandas.totais[serie] só
    // pra saber o tamanho do ano e validar vigenteIdx -- {} vazio faria
    // vigenteIdx=6 parecer "fora do intervalo" por engano.
    tipologias: [], totais: { sondagemRealizada: [0, 0, 0, 0, 0, 0, 800, 0, 0, 0, 0, 0], pendentes: [0, 0, 0, 0, 0, 0, 50, 0, 0, 0, 0, 0] },
    porRegistro: { 'SUP-0001-24||ST': { sondagemRealizada: [0, 0, 0, 0, 0, 0, 800, 0, 0, 0, 0, 0], pendentes: [0, 0, 0, 0, 0, 0, 50, 0, 0, 0, 0, 0] } },
  };
```
por:
```js
  // tipologias/totais: renderSemanal exige o formato {tipologias, totais}
  // de compute-demandas.js (ver DEMANDAS_VAZIAS acima) -- vazios aqui
  // porque este teste não olha a aba Demandas, só o wire-up de
  // Realizado/Tendência via porRegistroEventos em window.__DEMANDAS__.
  // Datas em julho de 2026 (mês vigente deste teste) -- qualquer dia real
  // desse mês serve, já que o cliente calcula hojeEpoch com o relógio real
  // de quem roda o teste (recalcularSemanal), não com geradoEm.
  const { diaEpoch } = require('../tools/comum/datas.js');
  const demandas = {
    tipologias: [], totais: {},
    porRegistroEventos: {
      'SUP-0001-24||ST': {
        chegada: [],
        sondagemRealizada: [diaEpoch(new Date(2026, 6, 5)), diaEpoch(new Date(2026, 6, 5))],
        saidaEstoque: [],
      },
    },
  };
```
(mova o `require('../tools/comum/datas.js')` pro topo do arquivo, junto dos outros
requires, em vez de inline dentro do teste -- é só mais legível lá).

- [ ] **Step 6: Rodar e confirmar**

Run: `node --test test/semanal-render-semanal-wireup.test.js`
Expected: PASS em tudo, incluindo o teste que ficou vermelho na Tarefa 3.

- [ ] **Step 7: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS em tudo, 0 falhas.

- [ ] **Step 8: Commit**

```bash
git add tools/semanal/render-semanal.js test/semanal-render-semanal-wireup.test.js test/semanal-build-dashboard.test.js test/semanal-linha-base-costura.test.js test/semanal-render-aba-balanco-wireup.test.js
git commit -m "$(cat <<'EOF'
Liga o calendário ISO de semanas no cliente da página semanal

recalcularSemanal calcula hojeEpoch com ComputeSemanal.diaEpoch(new
Date()) a cada recálculo (relógio de quem vê a página) e passa
window.__ANO__ (novo global, emitido no build a partir de
periodos[0]) pra renderAbaSemanal. Validação de build trocada de
demandas.porRegistro pra demandas.porRegistroEventos.
DEMANDAS_VAZIAS atualizada nos 4 arquivos de teste que a definem.
EOF
)"
```

---

## Depois das 4 tarefas

Revisão final de branch inteira (per subagent-driven-development), igual ao plano
anterior: dispatch no modelo mais capaz disponível, cobrindo especificamente:
- A aritmética de Tendência/Realizado/Pendentes em pelo menos 2 cenários reais (julho, 5
  semanas; agosto, 4 semanas), refeita à mão pelo revisor, não só conferida contra o que o
  código produz.
- O caso de fronteira (dias em que "hoje" já é do mês novo mas nenhuma semana própria dele
  começou) -- pelo menos um teste além de jul/ago, se possível (maio/junho é o único outro
  par com fronteira exata em 2026, sem dias de transição -- vale confirmar que a lista de
  meses "com transição" bate com a tabela da spec).
- Se o payload (`porRegistroEventos`) ficou mais leve que o `porRegistro` mensal que
  substituiu, como a spec previu -- só confirmável depois de um build com dados reais.
- Nenhum resquício de `porRegistro`/`serieRegistroVazia`/`semanaAtual`/`SEMANAS` sobrou em
  código ou comentário desatualizado.

Depois da revisão limpa: publicar (rebuild com `ORCAMENTO_SENHA` real +
`cp dist/planejamento-semanal.html docs/planejamento-semanal.html`) só com autorização
explícita do usuário, seguindo o mesmo protocolo de segurança já usado nas publicações
anteriores deste projeto.
