# Ramo R > P mira o Previsto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No ramo `R > P` da Tendência semanal (Planejamento Semanal, dimensão Volume), a
projeção das semanas futuras deixa de estender o ritmo médio das semanas fechadas e passa
a mirar o Previsto de cada semana — igual ao ramo `R ≈ P`. O Alerta A ("Avaliar equipe e
demanda") é substituído por um alerta novo ("Avaliar movimentação de equipe"), que dispara
quando a semana vigente ainda não teve nenhum avanço apesar do SUP estar acima do plano.

**Architecture:** Três arquivos puros em cadeia, sem mudança de assinatura pública:
`compute-tendencia-semanal.js` (projeção + diagnóstico) → `compute-alertas-tendencia.js`
(decide o alerta a partir do diagnóstico) → `render-alertas-tendencia.js` (desenha a linha
na aba Alertas). Nenhum arquivo novo, nenhuma mudança de `require`/ordem de bundle.

**Tech Stack:** Node puro (`node --test`), sem dependências externas — mesmo padrão do
resto do repositório.

## Global Constraints

- Escopo: só `docs/planejamento-semanal.html` (Planejamento Semanal). O dashboard de
  orçamento (`tools/orcamento/`) não é tocado em nenhuma tarefa.
- Ramo `R < P` e o Alerta B ("Equipes com pouco recurso ou improdutividade") não mudam de
  fórmula, código ou teste.
- `ORCAMENTO_SENHA` só existe como variável de ambiente no momento do build — nunca em
  arquivo do repositório.
- Depois do build de deploy: sempre `cp dist/planejamento-semanal.html
  docs/planejamento-semanal.html` antes de commitar (trava por
  `test/publicacao-docs-sincronizado.test.js`).
- Publicar sempre com `node tools/semanal/atualizar-arquivos.js` (que já faz `git push
  origin HEAD:master`) ou, se não for o caso de rodar o script completo, `git push origin
  HEAD:master` diretamente — nunca `git push origin master` (a branch local `master` está
  parada muito atrás de `origin/master`, ver `CLAUDE.md`).
- Spec de referência: `docs/superpowers/specs/2026-08-17-semanal-tendencia-ramo-acima-design.md`.

---

### Task 1: `compute-tendencia-semanal.js` — ramo `acima` mira o Previsto

**Files:**
- Modify: `tools/semanal/compute-tendencia-semanal.js:90-155`
- Test: `test/semanal-compute-tendencia-semanal.test.js`

**Interfaces:**
- Consumes: nada novo — mesma assinatura de entrada de `calcularTendenciaSemanal(entrada)`
  já documentada no topo do arquivo.
- Produces: `calcularTendenciaSemanal(entrada) -> { semanas: number[], ramo: 'igual' |
  'acima' | 'abaixo' | 'sem-dado', diagnostico: { realizadoAcumulado, previstoAcumulado,
  semanasFechadas, indiceVigente, realizadoVigente, saldo, ritmoPorDia, diasRestantesMes }
  | null }`. **`previstoAPartirDeHoje` e `tendenciaAPartirDeHoje` saem do objeto —
  qualquer consumidor que ainda os leia quebra em `undefined`, de propósito (é assim que
  Task 2 é forçada a parar de depender deles).** `realizadoVigente` é campo novo.

- [ ] **Step 1: Reescrever os testes do ramo `acima` para esperar o Previsto, não o ritmo**

Em `test/semanal-compute-tendencia-semanal.test.js`, substituir as DUAS funções de teste
entre as linhas 46–78 (`'ramo acima: as semanas restantes seguem o ritmo medio das
FECHADAS, nao o previsto'` e `'ramo acima: a vigente soma o Realizado parcial ao ritmo dos
dias que faltam dela'`) por:

```js
test('ramo acima: as semanas restantes miram o Previsto delas, nao o ritmo', () => {
  // hoje = 13/07. Fechadas S1+S2 = 12 dias, R acumulado 180 (P era 120) -> ramo acima.
  // ritmoPorDia ainda e calculado (15) e fica no diagnostico, mas NAO projeta mais:
  // S3 (vigente, realizado parcial 0) = max(70, 0) = 70. S4 = 70. S5 = 50 -- o
  // proprio Previsto de cada semana, igual ao ramo 'igual'.
  const r = calcularTendenciaSemanal({
    previstoMes: 310,
    semanasPrevisto: PREVISTO_JULHO,
    semanasRealizado: [80, 100, 0, 0, 0],
    semanas: SEMANAS_JULHO,
    hojeEpoch: dia(13),
  });
  assert.strictEqual(r.ramo, 'acima');
  assert.strictEqual(r.diagnostico.ritmoPorDia, 15, 'ritmo continua calculado, so nao projeta mais');
  assert.strictEqual(r.diagnostico.realizadoVigente, 0);
  assert.strictEqual(r.semanas[2], 70, 'vigente mira o proprio Previsto dela');
  assert.strictEqual(r.semanas[3], 70, 'futura mira o proprio Previsto dela');
  assert.strictEqual(r.semanas[4], 50, 'futura mira o proprio Previsto dela');
});

test('ramo acima: a vigente nunca projeta abaixo do que ja e fato, mesmo acima do proprio Previsto', () => {
  // hoje = 15/07, 3o dia de S3. Realizado parcial da vigente = 40 (abaixo do
  // Previsto de S3, que e 70) -> max(70, 40) = 70.
  const r = calcularTendenciaSemanal({
    previstoMes: 310,
    semanasPrevisto: PREVISTO_JULHO,
    semanasRealizado: [80, 100, 40, 0, 0],
    semanas: SEMANAS_JULHO,
    hojeEpoch: dia(15),
  });
  assert.strictEqual(r.ramo, 'acima');
  assert.strictEqual(r.diagnostico.realizadoVigente, 40);
  assert.strictEqual(r.semanas[2], 70);
});

test('ramo acima: quando a vigente ja fechou acima do proprio Previsto, a celula mostra o fato', () => {
  // hoje = 19/07, ULTIMO dia de S3: a vigente ja realizou 200 sozinha, acima
  // do proprio Previsto (70) -> max(70, 200) = 200. Futuras continuam
  // mirando o proprio Previsto (70 e 50), nao o ritmo (que daria 105 e 75).
  const r = calcularTendenciaSemanal({
    previstoMes: 310,
    semanasPrevisto: PREVISTO_JULHO,
    semanasRealizado: [80, 100, 200, 0, 0],
    semanas: SEMANAS_JULHO,
    hojeEpoch: dia(19),
  });
  assert.strictEqual(r.ramo, 'acima');
  assert.strictEqual(r.diagnostico.realizadoVigente, 200);
  assert.strictEqual(r.semanas[2], 200, 'a celula da vigente mostra o fato, nao o Previsto');
  assert.strictEqual(r.semanas[3], 70, 'futura mira o Previsto dela, nao o ritmo (105)');
  assert.strictEqual(r.semanas[4], 50, 'futura mira o Previsto dela, nao o ritmo (75)');
});
```

- [ ] **Step 2: Substituir o teste do diagnóstico "a partir de hoje" (agora inexistente)**

Substituir as DUAS funções de teste entre as linhas 179–232 (`'diagnostico expoe o que o
alerta precisa: previsto e tendencia A PARTIR DE HOJE'`, `'o realizado JA ENTREGUE da
semana em curso nao entra na tendencia a partir de hoje'` e `'mes inteiramente no futuro:
os dois campos sao o mes inteiro, sem vigente a ratear'`) por:

```js
test('diagnostico expoe realizadoVigente, o dado que o alerta de movimentacao usa', () => {
  const r = calcularTendenciaSemanal({
    previstoMes: 310,
    semanasPrevisto: PREVISTO_JULHO,
    semanasRealizado: [80, 100, 0, 0, 0],
    semanas: SEMANAS_JULHO,
    hojeEpoch: dia(13),
  });
  assert.strictEqual(r.diagnostico.semanasFechadas, 2);
  assert.strictEqual(r.diagnostico.indiceVigente, 2);
  assert.strictEqual(r.diagnostico.realizadoAcumulado, 180);
  assert.strictEqual(r.diagnostico.previstoAcumulado, 120);
  assert.strictEqual(r.diagnostico.realizadoVigente, 0);
  assert.strictEqual(r.diagnostico.previstoAPartirDeHoje, undefined, 'campo morto, saiu do diagnostico');
  assert.strictEqual(r.diagnostico.tendenciaAPartirDeHoje, undefined, 'campo morto, saiu do diagnostico');
});

test('mes inteiramente no futuro: realizadoVigente e 0, sem vigente a medir', () => {
  const r = calcularTendenciaSemanal({
    previstoMes: 310,
    semanasPrevisto: PREVISTO_JULHO,
    semanasRealizado: [0, 0, 0, 0, 0],
    semanas: SEMANAS_JULHO,
    hojeEpoch: diaEpoch(new Date(Date.UTC(2026, 5, 10))),
  });
  assert.strictEqual(r.diagnostico.indiceVigente, -1);
  assert.strictEqual(r.diagnostico.realizadoVigente, 0);
});
```

- [ ] **Step 3: Rodar os testes e confirmar que falham contra a implementação atual**

Run: `node --test test/semanal-compute-tendencia-semanal.test.js`
Expected: FAIL — os três testes do Step 1 esperam `r.semanas[2]===70` mas a implementação
atual devolve `90`/`100`/`200+ritmo`; os dois do Step 2 esperam `realizadoVigente` definido
e `previstoAPartirDeHoje === undefined`, e a implementação atual não expõe o primeiro e
expõe o segundo com valor numérico.

- [ ] **Step 4: Unir o ramo `acima` ao ramo `igual` na projeção**

Em `tools/semanal/compute-tendencia-semanal.js`, substituir o bloco das linhas 90–110:

```js
    if (ramo === 'igual') {
      // "mantém o P na T": a fatia INTEIRA que a linha Previsto exibe, para as
      // duas linhas mostrarem o mesmo número. Na vigente, nunca abaixo do que
      // já é fato.
      var previstoDaSemana = numero(semanasPrevisto[k]);
      saida.push(ehVigente ? Math.max(previstoDaSemana, realizadoVigente) : previstoDaSemana);
      continue;
    }

    var diasDaFatia = ehVigente ? diasRestantesVigente : diasNaSemana(semanas[k]);
    var base = ehVigente ? realizadoVigente : 0;

    // saldo <= 0 dentro do ramo 'abaixo' acontece quando o Realizado parcial
    // da vigente já cobriu sozinho o que faltava do mês -- seguir a fórmula do
    // saldo ali produziria projeção NEGATIVA.
    if (ramo === 'acima' || saldo <= 0) {
      saida.push(base + ritmoPorDia * diasDaFatia);
      continue;
    }
    saida.push(diasRestantesMes > 0 ? base + saldo * diasDaFatia / diasRestantesMes : base);
  }
```

por:

```js
    // Ramo 'acima' passou a mirar o Previsto de cada semana, igual ao ramo
    // 'igual' -- pedido de 2026-08-17: estender o ritmo que já bateu o plano
    // inflava a leitura da semana fechada e escondia semana vigente parada.
    // Ver docs/superpowers/specs/2026-08-17-semanal-tendencia-ramo-acima-design.md.
    if (ramo === 'igual' || ramo === 'acima') {
      // "mantém o P na T": a fatia INTEIRA que a linha Previsto exibe, para as
      // duas linhas mostrarem o mesmo número. Na vigente, nunca abaixo do que
      // já é fato.
      var previstoDaSemana = numero(semanasPrevisto[k]);
      saida.push(ehVigente ? Math.max(previstoDaSemana, realizadoVigente) : previstoDaSemana);
      continue;
    }

    // Só o ramo 'abaixo' chega aqui.
    var diasDaFatia = ehVigente ? diasRestantesVigente : diasNaSemana(semanas[k]);
    var base = ehVigente ? realizadoVigente : 0;

    // saldo <= 0 dentro do ramo 'abaixo' acontece quando o Realizado parcial
    // da vigente já cobriu sozinho o que faltava do mês -- seguir a fórmula do
    // saldo ali produziria projeção NEGATIVA.
    if (saldo <= 0) {
      saida.push(base + ritmoPorDia * diasDaFatia);
      continue;
    }
    saida.push(diasRestantesMes > 0 ? base + saldo * diasDaFatia / diasRestantesMes : base);
  }
```

- [ ] **Step 5: Remover o bloco morto "a partir de hoje" e ajustar o `diagnostico` devolvido**

No mesmo arquivo, substituir o bloco das linhas 112–155 (do comentário `// "A partir de
HOJE"` até o `}` que fecha a função):

```js
  // "A partir de HOJE", não "a partir da semana em curso" -- e os nomes dizem
  // isso porque a diferença é o defeito que a revisão de 2026-08-04 pegou.
  // Somando desde o índice 'fechadas', a semana vigente entrava INTEIRA nos
  // dois, e o excedente do Alerta A passava a cobrar carteira aberta para
  // sustentar furos que JÁ foram entregues nos dias passados dela (medido:
  // fechadas 130 contra 120, vigente já com 200 contra 70 no último dia dela
  // -- excedente 140, dos quais 130 eram fato consumado). Um alerta que olha
  // pra frente não pode ter passado no numerador.
  var previstoAPartirDeHoje = 0;
  var tendenciaAPartirDeHoje = 0;
  if (indiceVigente >= 0) {
    // Da vigente, só a FATIA proporcional aos dias que ainda faltam dela.
    var diasVigente = diasNaSemana(semanas[indiceVigente]);
    if (diasVigente > 0) {
      previstoAPartirDeHoje += numero(semanasPrevisto[indiceVigente]) * diasRestantesVigente / diasVigente;
    }
    // E da Tendência da vigente, só a parte PROJETADA: 'saida' nessa semana é
    // realizadoVigente (fato) + projeção dos dias que faltam, e o fato não é
    // projeção. Nos três ramos a projeção é construída assim, então subtrair
    // o realizado devolve exatamente a parcela futura (no ramo 'igual' a
    // saida é max(previsto, realizado), então a diferença nunca fica negativa).
    tendenciaAPartirDeHoje += saida[indiceVigente] - realizadoVigente;
  }
  for (var r = primeiraFutura; r < numSemanas; r++) {
    previstoAPartirDeHoje += numero(semanasPrevisto[r]);
    tendenciaAPartirDeHoje += saida[r];
  }

  return {
    semanas: saida,
    ramo: ramo,
    diagnostico: {
      realizadoAcumulado: realizadoAcumulado,
      previstoAcumulado: previstoAcumulado,
      semanasFechadas: fechadas,
      indiceVigente: indiceVigente,
      saldo: saldo,
      ritmoPorDia: ritmoPorDia,
      diasRestantesMes: diasRestantesMes,
      previstoAPartirDeHoje: previstoAPartirDeHoje,
      tendenciaAPartirDeHoje: tendenciaAPartirDeHoje,
    },
  };
}
```

por:

```js
  return {
    semanas: saida,
    ramo: ramo,
    diagnostico: {
      realizadoAcumulado: realizadoAcumulado,
      previstoAcumulado: previstoAcumulado,
      semanasFechadas: fechadas,
      indiceVigente: indiceVigente,
      // Consumido pelo alerta de movimentação de equipe (ramo 'acima' com a
      // vigente zerada) -- ver compute-alertas-tendencia.js.
      realizadoVigente: realizadoVigente,
      saldo: saldo,
      ritmoPorDia: ritmoPorDia,
      diasRestantesMes: diasRestantesMes,
    },
  };
}
```

- [ ] **Step 6: Rodar os testes e confirmar que passam**

Run: `node --test test/semanal-compute-tendencia-semanal.test.js`
Expected: PASS — todos os testes do arquivo, incluindo os reescritos nos Steps 1–2.

- [ ] **Step 7: Commit**

```bash
git add tools/semanal/compute-tendencia-semanal.js test/semanal-compute-tendencia-semanal.test.js
git commit -m "Tendência semanal: ramo R>P mira o Previsto de cada semana, não mais o ritmo"
```

---

### Task 2: `compute-alertas-tendencia.js` — alerta "Avaliar movimentação de equipe"

**Files:**
- Modify: `tools/semanal/compute-alertas-tendencia.js`
- Test: `test/semanal-compute-alertas-tendencia.test.js`

**Interfaces:**
- Consumes: `diagnostico.realizadoVigente` e `diagnostico.ritmoPorDia` de Task 1.
- Produces: `avaliarAlertaTendencia(entrada) -> null | { tipo: 'movimentacao', status:
  'alerta', realizadoAcumulado, previstoAcumulado, ritmoAnterior } | { tipo:
  'produtividade', ... } (inalterado)`. `entrada` não recebe mais `saldoDemandas` (campo
  morto, pode continuar sendo passado sem efeito, mas nenhum teste ou chamador deve
  depender dele). `ALERTA_ROTULO = { movimentacao: 'Avaliar movimentação de equipe',
  produtividade: 'Equipes com pouco recurso ou improdutividade' }` — a chave `demanda`
  deixa de existir.

- [ ] **Step 1: Reescrever os testes do ramo `acima` em `compute-alertas-tendencia.test.js`**

Substituir as linhas 1–44 (do topo do arquivo até o fim do teste `'R>P sem demandas
carregadas vira sem-dado, nunca alerta nem silencio'`) por:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { avaliarAlertaTendencia, diasPremissaRestantes, ALERTA_ROTULO } = require('../tools/semanal/compute-alertas-tendencia.js');
const { DIAS_PREMISSA_MES } = require('../tools/comum/calculo-equipes.js');

// Julho (mesIdx 6): 31 dias de calendario, 30 dias de premissa.
// realizadoVigente é o dado que o alerta 'movimentacao' usa (ramo R>P) -- ver
// compute-tendencia-semanal.js.
const DIAG_ACIMA_SEM_AVANCO = {
  realizadoAcumulado: 180, previstoAcumulado: 120, semanasFechadas: 2, indiceVigente: 2,
  realizadoVigente: 0, saldo: 130, ritmoPorDia: 15, diasRestantesMes: 18,
};
const DIAG_ACIMA_COM_AVANCO = Object.assign({}, DIAG_ACIMA_SEM_AVANCO, { realizadoVigente: 40 });
const DIAG_ABAIXO = {
  realizadoAcumulado: 60, previstoAcumulado: 120, semanasFechadas: 2, indiceVigente: 2,
  realizadoVigente: 0, saldo: 250, ritmoPorDia: 5, diasRestantesMes: 18,
};
const BASE = { mesIdx: 6, diasDoMes: 31 };

test('ramo igual e ramo sem-dado nao produzem alerta', () => {
  assert.strictEqual(avaliarAlertaTendencia(Object.assign({ ramo: 'igual', diagnostico: DIAG_ACIMA_SEM_AVANCO }, BASE)), null);
  assert.strictEqual(avaliarAlertaTendencia(Object.assign({ ramo: 'sem-dado', diagnostico: null }, BASE)), null);
});

test('R>P com a semana vigente zerada dispara "avaliar movimentacao de equipe"', () => {
  const a = avaliarAlertaTendencia(Object.assign({ ramo: 'acima', diagnostico: DIAG_ACIMA_SEM_AVANCO }, BASE));
  assert.strictEqual(a.tipo, 'movimentacao');
  assert.strictEqual(a.status, 'alerta');
  assert.strictEqual(a.realizadoAcumulado, 180);
  assert.strictEqual(a.previstoAcumulado, 120);
  assert.strictEqual(a.ritmoAnterior, 15);
});

test('R>P com qualquer avanco na semana vigente nao alerta', () => {
  const a = avaliarAlertaTendencia(Object.assign({ ramo: 'acima', diagnostico: DIAG_ACIMA_COM_AVANCO }, BASE));
  assert.strictEqual(a, null);
});
```

Manter INALTERADO todo o resto do arquivo a partir de `test('R<P que exige mais
produtividade do que a premissa dispara o alerta de equipes'...` (linha 46 em diante no
arquivo original) — são os testes do ramo `abaixo`/Alerta B, que não mudam.

Na última função do arquivo, `'os dois rotulos de tela existem'`, trocar
`ALERTA_ROTULO.demanda` por `ALERTA_ROTULO.movimentacao`:

```js
test('os dois rotulos de tela existem', () => {
  assert.strictEqual(typeof ALERTA_ROTULO.movimentacao, 'string');
  assert.strictEqual(typeof ALERTA_ROTULO.produtividade, 'string');
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham contra a implementação atual**

Run: `node --test test/semanal-compute-alertas-tendencia.test.js`
Expected: FAIL — `avaliarAlertaTendencia` ainda devolve `tipo: 'demanda'` e precisa de
`saldoDemandas`; `ALERTA_ROTULO.movimentacao` ainda é `undefined`.

- [ ] **Step 3: Reescrever o ramo `acima` de `avaliarAlertaTendencia` e o rótulo**

Em `tools/semanal/compute-alertas-tendencia.js`, substituir o topo do arquivo (linhas
1–18, do `'use strict'` até o fechamento de `ALERTA_ROTULO`):

```js
'use strict';
const { DIAS_PREMISSA_MES } = require('../comum/calculo-equipes.js');

// Os dois alertas de diagnóstico pedidos em 2026-08-04 -- ver
// docs/superpowers/specs/2026-08-04-semanal-tendencia-regras-e-alertas-design.md.
// Puro: recebe o 'diagnostico' que compute-tendencia-semanal.js já calculou e
// os três insumos externos (saldo de demandas, equipes previstas, premissa de
// produtividade), e responde a pergunta que o ramo levanta.
//
// O require de '../comum/' é REMOVIDO pelo bundler (ver transformaModulo em
// tools/comum/browser-bundle.js): no navegador DIAS_PREMISSA_MES chega como
// global pelo <script> de fonteParaCliente(), que já é injetado ANTES do
// bundle. No Node o require resolve normalmente.

var ALERTA_ROTULO = {
  demanda: 'Avaliar equipe e demanda',
  produtividade: 'Equipes com pouco recurso ou improdutividade',
};
```

por:

```js
'use strict';
const { DIAS_PREMISSA_MES } = require('../comum/calculo-equipes.js');

// Os dois alertas de diagnóstico da aba Alertas. Puro: recebe o
// 'diagnostico' que compute-tendencia-semanal.js já calculou e responde a
// pergunta que o ramo levanta.
//
// Alerta 'movimentacao' (ramo R>P, desde 2026-08-17 -- ver
// docs/superpowers/specs/2026-08-17-semanal-tendencia-ramo-acima-design.md):
// só olha o próprio diagnóstico, sem insumo externo. Alerta 'produtividade'
// (ramo R<P, 2026-08-04) ainda depende de dois insumos externos: equipes
// previstas e premissa de produtividade.
//
// O require de '../comum/' é REMOVIDO pelo bundler (ver transformaModulo em
// tools/comum/browser-bundle.js): no navegador DIAS_PREMISSA_MES chega como
// global pelo <script> de fonteParaCliente(), que já é injetado ANTES do
// bundle. No Node o require resolve normalmente.

var ALERTA_ROTULO = {
  movimentacao: 'Avaliar movimentação de equipe',
  produtividade: 'Equipes com pouco recurso ou improdutividade',
};
```

Em seguida, substituir a assinatura documentada de `avaliarAlertaTendencia` (o comentário
`// entrada: { ramo, diagnostico, mesIdx, diasDoMes, saldoDemandas, equipesPrevistas,
produtividadeEsperada }`) por:

```js
// entrada: { ramo, diagnostico, mesIdx, diasDoMes, equipesPrevistas, produtividadeEsperada }
```

E substituir o bloco do ramo `acima` dentro de `avaliarAlertaTendencia`:

```js
  if (e.ramo === 'acima') {
    // O ritmo acima do plano tem carteira que o sustente?
    var excedente = d.tendenciaAPartirDeHoje - d.previstoAPartirDeHoje;
    if (excedente <= 0) return null;
    if (e.saldoDemandas === null || e.saldoDemandas === undefined) return semDado('demanda', d);
    if (e.saldoDemandas >= excedente) return null;
    return {
      tipo: 'demanda', status: 'alerta',
      realizadoAcumulado: d.realizadoAcumulado,
      previstoAcumulado: d.previstoAcumulado,
      // Quanto a projeção do que falta DAQUI PRA FRENTE passa do plano do
      // mesmo recorte -- a semana em curso entra só na fração posterior a
      // hoje, nos dois lados (ver compute-tendencia-semanal.js).
      excedenteProjetado: excedente,
      saldoDemandas: e.saldoDemandas,
    };
  }
```

por:

```js
  if (e.ramo === 'acima') {
    // A equipe que produziu acima do plano continua avançando na semana em
    // curso? Zero furos nela, com as fechadas acima do plano, é o sinal de
    // que ela pode ter sido deslocada -- avaliar mover pra onde falta.
    // Ver docs/superpowers/specs/2026-08-17-semanal-tendencia-ramo-acima-design.md.
    if (d.realizadoVigente > 0) return null;
    return {
      tipo: 'movimentacao', status: 'alerta',
      realizadoAcumulado: d.realizadoAcumulado,
      previstoAcumulado: d.previstoAcumulado,
      ritmoAnterior: d.ritmoPorDia,
    };
  }
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --test test/semanal-compute-alertas-tendencia.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/compute-alertas-tendencia.js test/semanal-compute-alertas-tendencia.test.js
git commit -m "Alertas de tendência: Alerta A vira 'Avaliar movimentação de equipe'"
```

---

### Task 3: `render-alertas-tendencia.js` — rótulo e evidência na tela

**Files:**
- Modify: `tools/semanal/render-alertas-tendencia.js`
- Test: `test/semanal-render-alertas-tendencia.test.js`

**Interfaces:**
- Consumes: `avaliarAlertaTendencia` de Task 2 (tipo `'movimentacao'` com `ritmoAnterior`).
- Produces: nenhuma mudança de assinatura em `renderCorpoAlertasTendencia`,
  `renderCabecalhoAlertasTendencia` ou `premissaProdutividadeDoGrupo` — só o texto que
  aparece nas linhas HTML muda.

- [ ] **Step 1: Ajustar os testes de rótulo em `semanal-render-alertas-tendencia.test.js`**

No teste `'grupo sem alerta nenhum nao vira linha'` (linhas 49–60 do arquivo original),
trocar a asserção:

```js
  assert.ok(html.indexOf('Avaliar equipe e demanda') === -1);
```

por:

```js
  assert.ok(html.indexOf('Avaliar movimentação de equipe') === -1);
```

Em seguida, adicionar estes dois testes novos logo depois do teste `'deficit grande com
uma equipe improdutiva vira a linha de equipes'` (depois da linha 83 do arquivo original):

```js
test('R>P com a semana vigente zerada gera a linha "Avaliar movimentacao de equipe"', () => {
  // Previsto do mes 62 -> semanas [10,14,14,14,10] (2/dia). S1+S2 previsto=24;
  // 30 furos realizados nelas (15 no dia 1, 15 no dia 6) -> ramo acima.
  // Nenhum furo realizado em S3 (13..19) ate o corte de d-1 (14/07) -> a
  // vigente fica zerada e o alerta dispara.
  const realizadas = [];
  for (let i = 0; i < 15; i++) { realizadas.push(dia(1)); realizadas.push(dia(6)); }
  const html = renderCorpoAlertasTendencia([registro('A', 62, 1, 1)], [0], {
    agruparPor: 'sup', dimensao: 'volume', mesIdx: 6, semanas: SEMANAS,
    demandas: demandasDe('A', [], realizadas),
    hojeEpoch: HOJE,
  });
  assert.ok(html.indexOf('Avaliar movimentação de equipe') !== -1);
  assert.ok(/data-search=/.test(html), 'a linha precisa do data-search para a busca da aba');
});

test('R>P com avanco na vigente, mesmo pequeno, nao alerta', () => {
  const realizadas = [];
  for (let i = 0; i < 15; i++) { realizadas.push(dia(1)); realizadas.push(dia(6)); }
  realizadas.push(dia(13)); // 1 furo na vigente, antes do corte de hoje-1 (14/07)
  const html = renderCorpoAlertasTendencia([registro('A', 62, 1, 1)], [0], {
    agruparPor: 'sup', dimensao: 'volume', mesIdx: 6, semanas: SEMANAS,
    demandas: demandasDe('A', [], realizadas),
    hojeEpoch: HOJE,
  });
  assert.strictEqual(html.indexOf('Avaliar movimentação de equipe'), -1);
  assert.strictEqual(html.indexOf('data-search='), -1, 'nenhum alerta dispara nesse grupo');
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham contra a implementação atual**

Run: `node --test test/semanal-render-alertas-tendencia.test.js`
Expected: FAIL — a implementação atual ainda emite "Avaliar equipe e demanda" e decide o
disparo por saldo de demandas, não por `realizadoVigente`.

- [ ] **Step 3: Atualizar `render-alertas-tendencia.js`**

Trocar o import do topo (linha 3):

```js
const { calcularSeriesSemanaisDimensao, pendentesNaData} = require('./render-aba-semanal.js');
```

por:

```js
const { calcularSeriesSemanaisDimensao } = require('./render-aba-semanal.js');
```

Adicionar uma frase ao comentário de topo do arquivo (depois do bloco que termina em
`"... Em R$ não existe estoque de demanda, e em Equipes não existe Realizado semanal em
lugar nenhum desta página."`, por volta da linha 14):

```js
//
// O alerta do ramo R>P mudou de pergunta em 2026-08-17 -- ver
// docs/superpowers/specs/2026-08-17-semanal-tendencia-ramo-acima-design.md.
```

Trocar o comentário de `ROTULO_SEM_AVALIACAO` (linhas 19–24):

```js
// Rótulo do caso "não dá nem pra saber o ramo" (sem base de demandas
// carregada) -- não é um dos dois alertas de ALERTA_ROTULO (compute-alertas-
// tendencia.js), então não entra lá: nomear a linha "Avaliar equipe e
// demanda" ou "Equipes com pouco recurso" seria afirmar qual das duas
// perguntas ficou pendente quando, na verdade, nenhuma chegou a ser feita.
var ROTULO_SEM_AVALIACAO = 'Tendência não avaliada';
```

por:

```js
// Rótulo do caso "não dá nem pra saber o ramo" (sem base de demandas
// carregada) -- não é um dos dois alertas de ALERTA_ROTULO (compute-alertas-
// tendencia.js), então não entra lá: nomear a linha "Avaliar movimentação de
// equipe" ou "Equipes com pouco recurso" seria afirmar qual das duas
// perguntas ficou pendente quando, na verdade, nenhuma chegou a ser feita.
var ROTULO_SEM_AVALIACAO = 'Tendência não avaliada';
```

Trocar a função `textoEvidencia` inteira:

```js
function textoEvidencia(alerta) {
  if (alerta.tipo === 'sem-avaliacao') {
    return 'Sem base de demandas carregada -- sem ela não dá pra saber se o ritmo está acima ou abaixo do plano';
  }
  if (alerta.status === 'sem-dado') {
    // Só o Alerta B (produtividade) chega aqui. O 'sem-dado' do Alerta A
    // exigiria saldoDemandas null, e ele nunca é: sem base de demandas o
    // bypass de renderLinhaGrupo intercepta antes (tipo 'sem-avaliacao'), e
    // com base carregada pendentesNaData sempre devolve número. A mensagem
    // "Sem base de demandas carregada" que existia neste ramo era inalcançável.
    return 'Sem equipes previstas ou sem premissa de produtividade';
  }
  if (alerta.tipo === 'demanda') {
    return 'Saldo de demandas ' + formatarNumero(alerta.saldoDemandas, 0)
      + ' · excedente projetado ' + formatarNumero(alerta.excedenteProjetado, 0);
  }
  return 'Produtividade exigida ' + formatarNumero(alerta.produtividadeExigida, 2)
    + ' · esperada ' + formatarNumero(alerta.produtividadeEsperada, 2)
    + ' (' + formatarNumero(alerta.equipesPrevistas, 2) + ' equipes previstas)';
}
```

por:

```js
function textoEvidencia(alerta) {
  if (alerta.tipo === 'sem-avaliacao') {
    return 'Sem base de demandas carregada -- sem ela não dá pra saber se o ritmo está acima ou abaixo do plano';
  }
  if (alerta.status === 'sem-dado') {
    // Só o Alerta B (produtividade) chega aqui -- o de movimentação nunca tem
    // 'sem-dado' (só olha o próprio diagnóstico, sem insumo externo).
    return 'Sem equipes previstas ou sem premissa de produtividade';
  }
  if (alerta.tipo === 'movimentacao') {
    return 'Ritmo médio nas semanas fechadas ' + formatarNumero(alerta.ritmoAnterior, 2)
      + ' furos/dia · nenhum avanço registrado na semana em curso';
  }
  return 'Produtividade exigida ' + formatarNumero(alerta.produtividadeExigida, 2)
    + ' · esperada ' + formatarNumero(alerta.produtividadeEsperada, 2)
    + ' (' + formatarNumero(alerta.equipesPrevistas, 2) + ' equipes previstas)';
}
```

Por fim, em `renderLinhaGrupo`, remover a linha `saldoDemandas: ...` da chamada de
`avaliarAlertaTendencia`:

```js
  var alerta = ctx.temDemandas
    ? avaliarAlertaTendencia({
        ramo: series.ramoTendencia,
        diagnostico: series.diagnosticoTendencia,
        mesIdx: ctx.mesIdx,
        diasDoMes: ctx.diasDoMes,
        saldoDemandas: pendentesNaData(registros, indices, ctx.demandas, ctx.hojeEpoch),
        equipesPrevistas: somarPrevistoMes(registros, indices, 'equipes', ctx.mesIdx),
        produtividadeEsperada: premissaProdutividadeDoGrupo(registros, indices, ctx.mesIdx),
      })
    : { tipo: 'sem-avaliacao', status: 'sem-dado', realizadoAcumulado: null, previstoAcumulado: null };
```

por:

```js
  var alerta = ctx.temDemandas
    ? avaliarAlertaTendencia({
        ramo: series.ramoTendencia,
        diagnostico: series.diagnosticoTendencia,
        mesIdx: ctx.mesIdx,
        diasDoMes: ctx.diasDoMes,
        equipesPrevistas: somarPrevistoMes(registros, indices, 'equipes', ctx.mesIdx),
        produtividadeEsperada: premissaProdutividadeDoGrupo(registros, indices, ctx.mesIdx),
      })
    : { tipo: 'sem-avaliacao', status: 'sem-dado', realizadoAcumulado: null, previstoAcumulado: null };
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --test test/semanal-render-alertas-tendencia.test.js`
Expected: PASS.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `node --test test/*.js`
Expected: PASS em todos os arquivos, incluindo `test/orcamento-html-inalterado.test.js`
(nada neste plano toca o dashboard de orçamento) e `test/publicacao-docs-sincronizado.test.js`
(ainda não deve ter divergência, porque nenhum build rodou ainda nesta branch).

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/render-alertas-tendencia.js test/semanal-render-alertas-tendencia.test.js
git commit -m "Aba Alertas: rotulo e evidencia do alerta de movimentacao de equipe"
```

---

### Task 4: Build, CLAUDE.md e publicação

**Files:**
- Modify: `orcamento-dashboard/CLAUDE.md` (seção "Tendência por ramo e alertas de
  tendência (2026-08-04)" ganha um adendo datado — não reescrever a seção antiga, só
  adicionar)
- Generate: `dist/planejamento-semanal.html` (build)
- Modify: `docs/planejamento-semanal.html` (cópia do dist, trava por
  `test/publicacao-docs-sincronizado.test.js`)

**Interfaces:** N/A — tarefa de build e publicação, não de código.

**Nota de execução:** esta tarefa precisa de `ORCAMENTO_SENHA` (variável de ambiente local,
nunca em arquivo) e faz `git push`. Rode-a na sessão coordenadora, não delegue a um
subagente novo sem contexto do valor da senha.

- [ ] **Step 1: Confirmar que a suíte inteira passa antes de tocar em build**

Run: `node --test test/*.js`
Expected: PASS — é a mesma suíte do fim da Task 3; rodar de novo aqui é o portão antes de
qualquer publicação, por instrução permanente do projeto (nada é publicado antes das
revisões/testes passarem).

- [ ] **Step 2: Adicionar o adendo no `CLAUDE.md`**

Em `orcamento-dashboard/CLAUDE.md`, dentro da seção `### Tendência por ramo e alertas de
tendência (2026-08-04)`, logo depois do parágrafo que termina em `"Os nomes são compridos
de propósito."`, adicionar:

```markdown

**Ramo `R > P` mudou de fórmula em 2026-08-17** — ver
`docs/superpowers/specs/2026-08-17-semanal-tendencia-ramo-acima-design.md`. Antes, a
semana vigente e as futuras estendiam o ritmo médio das semanas fechadas; isso inflava a
leitura da semana fechada e escondia quando uma equipe acima do plano parava de avançar.
Agora esse ramo projeta **igual ao ramo `R ≈ P`**: mira o Previsto de cada semana (nunca
abaixo do Realizado parcial da vigente). `ritmoPorDia` continua no diagnóstico (vira
evidência do alerta abaixo), só não projeta mais nada. O Alerta A ("Avaliar equipe e
demanda") foi substituído por **"Avaliar movimentação de equipe"**: dispara quando o ramo
é `R > P` e a semana vigente ainda não teve NENHUM avanço
(`diagnostico.realizadoVigente === 0`) — sinal de que a equipe pode ter sido deslocada.
Não depende mais de saldo de demandas. Consolidado congelado e Alocação Equipes herdam a
fórmula nova automaticamente (mesma função), sem mudança de código nesses dois.
```

- [ ] **Step 3: Build**

```bash
ORCAMENTO_SENHA='<peça ao dono do projeto se não tiver>' node tools/semanal/build-dashboard.js
```

Expected: termina sem erro, gera/atualiza `dist/planejamento-semanal.html`.

- [ ] **Step 4: Copiar pra `docs/` e conferir sincronia**

```bash
cp dist/planejamento-semanal.html docs/planejamento-semanal.html
node --test test/publicacao-docs-sincronizado.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit e publicar**

```bash
git add orcamento-dashboard/CLAUDE.md dist/planejamento-semanal.html docs/planejamento-semanal.html
git commit -m "Build: ramo R>P da Tendência mira o Previsto, alerta de movimentação de equipe"
node tools/semanal/atualizar-arquivos.js
```

Se `atualizar-arquivos.js` não for aplicável no momento (por exemplo, quiser publicar sem
refazer as buscas online), publicar direto:

```bash
git push origin HEAD:master
```

Expected: push aceito, `git log origin/master -1` mostra o commit acima no topo.

- [ ] **Step 6: Confirmar ao vivo**

```bash
curl -s https://amcaccere261283.github.io/orcamento-dashboard/planejamento-semanal.html | grep -o 'Avaliar movimentação de equipe' | head -1
```

Expected: encontra o texto (pode levar alguns minutos para o Pages atualizar — se vier
vazio na primeira tentativa, tentar de novo em 1-2 minutos antes de investigar problema).

---

## Self-Review

**Cobertura da spec:** Decisão 1 (fórmula nova) → Task 1. Decisão 2 (alerta novo) → Task 2
+ Task 3 (render). Decisão 3 (o que não muda) → nenhuma task toca ramo `abaixo`/Alerta
B/Consolidado/Alocação, e os testes existentes desses caminhos ficam intactos, provando
por omissão. Seção de Testes da spec → cada arquivo de teste citado tem uma task
correspondente. Fora de escopo da spec → nenhuma task extrapola.

**Placeholders:** nenhum "TBD"/"implementar depois" — toda task tem código completo, ou
(Task 4) comandos de shell completos.

**Consistência de tipos:** `diagnostico.realizadoVigente` (Task 1) é lido por
`avaliarAlertaTendencia` (Task 2) como `d.realizadoVigente`, mesmo nome. `a.ritmoAnterior`
(Task 2) é lido por `textoEvidencia` (Task 3) como `alerta.ritmoAnterior`, mesmo nome.
`ALERTA_ROTULO.movimentacao` (Task 2) é o que a Task 3 espera aparecer na tela via
`ALERTA_ROTULO[alerta.tipo]` já existente em `renderLinhaGrupo` — sem mudança necessária
ali, porque já indexa pelo tipo.
