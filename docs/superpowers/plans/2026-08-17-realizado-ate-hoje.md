# Realizado até HOJE (D) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O Realizado da página Planejamento Semanal passa a contar até HOJE (D) em vez
de parar em d−1 — na exibição (Tabela Semanal, Gráficos, Consolidado, Alertas, Alocação,
nas três dimensões) e na busca do Link 7 (produção de equipes), que hoje descarta o dia
corrente antes de gravar o CSV.

**Architecture:** Três mudanças pequenas em cadeia, sem mudança de assinatura pública:
`render-aba-semanal.js` (a variável de corte some, o Realizado passa a usar `hojeEpoch`
como todo o resto da função) → `datas.js`/`atualizar-equipes-online.js` (o fetcher busca e
grava o dia corrente, e passa a rebuscar o mês anterior para completá-lo depois) →
documentação (quatro textos afirmam a regra antiga). Nenhum arquivo novo.

**Tech Stack:** Node puro (`node --test`), sem dependências externas.

## Global Constraints

- Escopo: só o Planejamento Semanal e o fetcher do Link 7. `tools/orcamento/` não é
  tocado (`test/orcamento-html-inalterado.test.js` prende isso).
- Spec de referência:
  `docs/superpowers/specs/2026-08-17-realizado-ate-hoje-design.md`.
- **NÃO RODAR NENHUM FETCHER nesta rodada** (`atualizar-arquivos.js`,
  `atualizar-equipes-online.js`, `atualizar-avancos-online.js`, `atualizar-lab-online.js`
  e os de demandas). O dono do projeto avisou em 2026-08-17 que o Patrick está
  atualizando os dados do Realizado neste momento, e pediu para não interferir. Esses
  scripts reescrevem os CSVs que ele está mexendo, e `atualizar-arquivos.js` ainda dá
  `git push` sozinho.
- **NÃO PUBLICAR (`git push`) nesta rodada.** A Task 4 constrói e commita localmente; a
  publicação fica para depois da confirmação do dono do projeto. Quando ela vier: rebase
  sobre `origin/master` antes (o Patrick empurra no mesmo master), nunca `--force`.
- `ORCAMENTO_SENHA` só existe como variável de ambiente no momento do build — nunca em
  arquivo do repositório.
- Depois do build: sempre `cp dist/planejamento-semanal.html docs/planejamento-semanal.html`
  antes de commitar (trava por `test/publicacao-docs-sincronizado.test.js`).
- A suíte inteira (`node --test test/*.js`) tem de fechar verde antes de qualquer build.
  Hoje são 1269 testes. **Medido de antemão: a mudança de corte quebra exatamente 2
  deles, os dois listados na Task 1. Se quebrar um terceiro, pare e investigue — não
  ajuste o número esperado para o que saiu.**

---

### Task 1: o corte do Realizado vira `hojeEpoch`

**Files:**
- Modify: `tools/semanal/render-aba-semanal.js` (linhas 311-322, 381-389, 450-457)
- Test: `test/semanal-render-aba-semanal.test.js` (linhas 449-482)
- Test: `test/semanal-render-aba-consolidado.test.js` (linhas 140-177)
- Test: `test/semanal-render-alertas-tendencia.test.js` (linha 88, só comentário)

**Interfaces:**
- Consumes: nada novo.
- Produces: nenhuma mudança de assinatura. `calcularSeriesSemanaisDimensao` continua com
  os mesmos parâmetros e o mesmo objeto de retorno — só os NÚMEROS de `semanasRealizado`
  / `fechamentoRealizado` (e, por consequência, da Tendência) mudam quando a semana em
  curso tem evento no dia de hoje. A variável local `realizadoAteEpoch` deixa de existir.

- [ ] **Step 1: Atualizar o teste de Realizado de Equipes**

Em `test/semanal-render-aba-semanal.test.js`, o teste que hoje começa em `test('Realizado
de Equipes: média diária por semana, cortada em d-1 -- S1 e S2 fechadas, S3 vigente
truncada em 2 dias, ...'`. Três edições dentro dele:

1. No **título**, trocar `cortada em d-1` por `cortada em HOJE` e `S3 vigente truncada em
   2 dias` por `S3 vigente truncada em 3 dias`.
2. No comentário da linha do dia 14 da fixture, trocar
   `// S3 (13-19, truncada em d-1=14 -> 2 dias: 13 e 14)` por
   `// S3 (13-19, truncada em hoje=15 -> 3 dias: 13, 14 e 15)`.
3. Substituir o bloco de comentário que começa em `// S3 desde 2026-08-10 (corte em
   d-1): a janela para no dia 14, não no dia` e as duas asserções seguintes, por:

```js
  // S3 desde 2026-08-17 (corte em HOJE, não mais em d-1): a janela vai do dia
  // 13 ao dia 15 (hoje) -- 3 dias, todos úteis (13=segunda, 14=terça,
  // 15=quarta), então 3/3 = 1,0 -> Math.ceil = 1. Com o corte antigo em d-1
  // eram 2 dias (13 e 14) e dava 3/2 = 1,5 -> 2. Ver
  // docs/superpowers/specs/2026-08-17-realizado-ate-hoje-design.md.
  assert.deepStrictEqual(series.semanasRealizado, [1, 2, 1, null, null]);
  assert.ok(Math.abs(series.fechamentoRealizado - 4 / 3) < 1e-9, 'fechamento é a MÉDIA de [1,2,1], não a soma');
```

- [ ] **Step 2: Atualizar o teste da Tendência congelada do Consolidado**

Este é o mais interessante da rodada: **o corte em D devolve a este teste o poder de
detecção que a regra de d−1 tinha apagado.** O bloco de comentário acima dele conta que a
fixture original esperava `97` e que a regra de 2026-08-10 apagou a diferença entre
`indiceAtualEfetivo` e `indiceAtual`, deixando `74`. Com o corte em D, o valor volta a ser
`97` — medido.

Em `test/semanal-render-aba-consolidado.test.js`, substituir o trecho do bloco de
comentário que vai de `// A regra de 2026-08-10 ("realizado sempre considerar até d-1")
APAGOU essa` até `// deixou de ser observável aqui.` por:

```js
// A regra de 2026-08-10 ("realizado sempre considerar até d-1") APAGOU essa
// diferença por um tempo: congelar ancora hojeEfetivo no PRIMEIRO dia da
// semana k, e com o corte em d-1 a janela de Realizado dela ia de
// semanas[k].inicio até semanas[k].inicio - 1 -- vazia por construção.
//
// O corte em HOJE (2026-08-17, ver
// docs/superpowers/specs/2026-08-17-realizado-ate-hoje-design.md) DEVOLVEU a
// diferença: a janela da semana ancorada passa a ser [inicio, inicio], um dia
// -- justamente o dia em que a fixture põe os 30 furos. O esperado voltou a
// ser 97, o mesmo número da fixture original, e o parâmetro
// ctx.indiceAtualEfetivo voltou a ser observável aqui (com ctx.indiceAtual no
// lugar dele, o teste falha de novo).
```

E substituir a asserção do valor congelado por:

```js
  assert.strictEqual(celulas[5], '97',
    'os 30 furos de 06/07 ENTRAM: com o corte em HOJE, a janela da S2 ancorada em 06/07 é o próprio dia 06/07');
```

A segunda asserção do teste (`celulas[4]`, o Realizado exibido, `'30'`) **não muda** — ela
já usa o hoje real (15/07) e continua vendo os 30 furos.

- [ ] **Step 3: Corrigir o comentário do teste de alertas**

Em `test/semanal-render-alertas-tendencia.test.js`, no teste `'R>P com a semana vigente
zerada gera a linha "Avaliar movimentacao de equipe"'`, trocar
`// Nenhum furo realizado em S3 (13..19) ate o corte de d-1 (14/07) -> a` por
`// Nenhum furo realizado em S3 (13..19) ate hoje (15/07) -> a`. As asserções **não
mudam**: o cenário não tem evento nos dias 13, 14 nem 15.

- [ ] **Step 4: Escrever os dois testes novos (vão falhar)**

Em `test/semanal-render-aba-semanal.test.js`, acrescentar ao final do arquivo:

```js
test('o furo de HOJE entra no Realizado da semana em curso -- o corte é em D, não em d-1 (2026-08-17)', () => {
  // hoje = 15/07 (S3, 13..19). Um furo em 13/07 (passado) e um em 15/07 (hoje).
  // Com o corte antigo em d-1 (14/07) só o primeiro contava: S3 = 1.
  const eventos = { sondagemRealizada: [diaJul(13), diaJul(15)], saidaEstoque: [], chegada: [] };
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': eventos } };
  const series = calcularSeriesSemanaisDimensao(
    [registro(1000)], [0], 'volume', VIGENTE_JULHO, SEMANAS_JULHO, SEMANAS_JULHO.length,
    true, indiceSemanaAtual(SEMANAS_JULHO, HOJE_15_JUL), demandas, HOJE_15_JUL
  );
  assert.strictEqual(series.semanasRealizado[2], 2, 'os dois furos entram: o de 13/07 e o de HOJE (15/07)');
});

test('Realizado de Equipes: semana que COMEÇOU hoje deixa de ser sem-dado e mostra a média de 1 dia (2026-08-17)', () => {
  // hoje = 13/07, o PRIMEIRO dia da S3 (13..19). Com o corte antigo em d-1 a
  // condição `semana.inicio > realizadoAteEpoch` era verdadeira e S3 voltava
  // null ("semana futura, ou começou hoje"). Com o corte em D, a janela é
  // [13, 13] -- um dia, útil (segunda) -- e a média é o próprio valor dele.
  const hoje13 = diaJul(13);
  const equipesPorDia = { 'SUP-0001-24||ST': { [diaJul(13)]: 4 } };
  const demandas = { porRegistroEventos: {}, equipesPorDia };
  const series = calcularSeriesSemanaisDimensao(
    [registro(0)], [0], 'equipes', VIGENTE_JULHO, SEMANAS_JULHO, SEMANAS_JULHO.length,
    true, indiceSemanaAtual(SEMANAS_JULHO, hoje13), demandas, hoje13
  );
  assert.strictEqual(series.semanasRealizado[2], 4, 'S3 começou hoje: 4/1 dia útil = 4, não null');
  assert.strictEqual(series.semanasRealizado[3], null, 'S4 continua futura, sem dado');
});
```

- [ ] **Step 5: Rodar os testes e confirmar que falham**

Run: `node --test test/semanal-render-aba-semanal.test.js test/semanal-render-aba-consolidado.test.js`
Expected: FAIL — os dois testes editados nos Steps 1-2 falham com os valores antigos
(`[1,2,2,...]` contra `[1,2,1,...]`; `'74'` contra `'97'`) e os dois novos do Step 4
falham (`1` contra `2`; `null` contra `4`).

- [ ] **Step 6: Aplicar a mudança de corte**

Em `tools/semanal/render-aba-semanal.js`, substituir o bloco que hoje vai do comentário
`// O REALIZADO para em d-1, nunca em hoje -- regra do dono do projeto,` até a linha
`var realizadoAteEpoch = hojeEpoch - 1;` (inclusive) por:

```js
  // O REALIZADO conta até HOJE (D), inclusive -- pedido do dono do projeto em
  // 2026-08-17, ver docs/superpowers/specs/2026-08-17-realizado-ate-hoje-design.md.
  //
  // Até 2026-08-10 a regra era parar em d-1, porque o extrato do sond.com.br
  // era alimentado ao longo do dia e contar o dia corrente fazia a semana em
  // curso parecer em queda até virar a meia-noite. A atualização passou a
  // rodar às 8h diariamente: o que a página serve é o retrato daquela hora,
  // não um fluxo que se degrada, então o dia corrente entra.
  //
  // Com isso some a variável 'realizadoAteEpoch', que existia só para esse
  // corte: o Realizado passa a usar 'hojeEpoch' direto, igual a todo o resto
  // da função (qual é a semana em curso, saldo de Demandas Pendentes,
  // congelamento do Consolidado). E a Tabela Semanal passa a concordar com o
  // Balanço de massa, que já cortava em hojeEpoch (compute-balanco.js).
```

Depois, os três usos. Na contagem de Volume/Financeiro da semana em curso, substituir o
comentário e a linha:

```js
        // Semana em curso: conta até HOJE, inclusive. Se a semana começou
        // hoje, o intervalo é de um dia só -- o que já tiver sido lançado
        // até a captura das 8h.
        if (i === indiceAtual) return contarEventosNoIntervalo(registros, indices, demandas, 'sondagemRealizada', semana.inicio, hojeEpoch, pesoPorRegistro);
```

E na linha seguinte, trocar o comentário `// Semana já encerrada: o intervalo inteiro dela
já é <= d-1.` por `// Semana já encerrada: o intervalo inteiro dela já passou.`

No bloco de Equipes, substituir o comentário e as duas linhas:

```js
      // Mesmo corte em HOJE do Realizado de Volume/Financeiro acima. Uma
      // semana que COMEÇOU hoje deixa de ser sem-dado: vira uma janela de um
      // dia, que é a leitura certa quando o dia de hoje conta.
      if (semana.inicio > hojeEpoch) return null; // semana estritamente futura
      var fim = Math.min(semana.fim, hojeEpoch);
```

- [ ] **Step 7: Rodar os testes e confirmar que passam**

Run: `node --test test/semanal-render-aba-semanal.test.js test/semanal-render-aba-consolidado.test.js test/semanal-render-alertas-tendencia.test.js`
Expected: PASS em todos.

- [ ] **Step 8: Rodar a suíte inteira**

Run: `node --test test/*.js`
Expected: PASS, 1269 + 2 testes novos = 1271, `fail 0`. **Se algum teste fora dos citados
nesta task falhar, pare e reporte — não ajuste o valor esperado dele.**

- [ ] **Step 9: Commit**

```bash
git add tools/semanal/render-aba-semanal.js test/semanal-render-aba-semanal.test.js test/semanal-render-aba-consolidado.test.js test/semanal-render-alertas-tendencia.test.js
git commit -m "Realizado conta até HOJE (D), não mais até d-1"
```

---

### Task 2: o fetcher do Link 7 busca até D, e completa o mês anterior

**Files:**
- Modify: `tools/comum/datas.js` (linhas 74-81 e a lista de `module.exports`)
- Modify: `tools/semanal/atualizar-equipes-online.js` (linhas 7, 369-377, 408-415, 434, 443, 451-452, 483-490)
- Test: `test/semanal-atualizar-equipes-online.test.js`

**Interfaces:**
- Consumes: nada da Task 1 (são independentes; só a documentação as junta).
- Produces: `diaEpochDeHoje(agora = new Date()) -> number` substitui
  `diaEpochDeOntem` em `tools/comum/datas.js` (mesma assinatura, um dia a mais).
  `mesesPendentes(porDia, ano, mesCorrente) -> number[]` mantém a assinatura e passa a
  incluir o mês anterior do mesmo ano.

- [ ] **Step 1: Escrever os testes novos (vão falhar)**

Em `test/semanal-atualizar-equipes-online.test.js` — atenção, este arquivo usa
`node:assert/strict`, então é `assert.deepEqual`/`assert.equal`, sem o sufixo `Strict`.
Acrescentar `mesesPendentes` à lista de imports do topo do arquivo (que hoje traz
`lerCsvExistente, linhasRosterDoMes, gravarRoster, lerRosterExistente, CABECALHO_ROSTER`)
e acrescentar ao final do arquivo:

```js
// O fetcher passou a gravar o dia CORRENTE (2026-08-17, ver
// docs/superpowers/specs/2026-08-17-realizado-ate-hoje-design.md), e o dia
// corrente é parcial: ele é capturado às 8h e só fica completo na captura do
// dia seguinte. O mês corrente já era rebuscado sempre, então o caso normal se
// resolve sozinho -- menos na virada do mês, onde o último dia ficaria
// congelado no retrato parcial para sempre. Por isso o mês ANTERIOR também
// entra.
test('mesesPendentes inclui o mês anterior mesmo quando ele já tem dado -- senão o último dia dele congela parcial', () => {
  // Todos os meses de jan a jul já têm dado; o mês corrente é julho (7).
  const porDia = {};
  [1, 2, 3, 4, 5, 6, 7].forEach((mes) => {
    // um dia qualquer de cada mês; mesDoDia() é quem traduz para 'ano-mes'
    porDia[String(diaEpochDe(2026, mes, 10))] = ['441,SUP-1,SP,0'];
  });
  const pendentes = mesesPendentes(porDia, 2026, 7);
  assert.deepEqual(pendentes, [6, 7], 'o mês corrente (7) e o anterior (6), nada mais');
});

test('mesesPendentes em JANEIRO não inventa mês 0 -- o mês anterior cruzaria o ano, que está fora do backfill', () => {
  const porDia = { [String(diaEpochDe(2026, 1, 10))]: ['441,SUP-1,SP,0'] };
  assert.deepEqual(mesesPendentes(porDia, 2026, 1), [1]);
});

test('mesesPendentes continua trazendo os meses SEM dado nenhum, que é o backfill original', () => {
  // Só maio tem dado; o mês corrente é julho.
  const porDia = { [String(diaEpochDe(2026, 5, 10))]: ['441,SUP-1,SP,0'] };
  assert.deepEqual(mesesPendentes(porDia, 2026, 7), [1, 2, 3, 4, 6, 7],
    'maio sai (tem dado e não é corrente nem anterior); junho entra por ser o anterior');
});
```

E, logo acima desses três testes, o utilitário que eles usam (o arquivo ainda não tem um):

```js
// Dia-desde-época de uma data do calendário, para montar as chaves de porDia.
// Mesma conta de diaEpoch (tools/comum/datas.js), repetida aqui para o teste
// não depender da ordem de import daquele módulo.
function diaEpochDe(ano, mes, dia) {
  return Math.floor(Date.UTC(ano, mes - 1, dia) / 86400000);
}
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `node --test test/semanal-atualizar-equipes-online.test.js`
Expected: FAIL — `mesesPendentes` hoje devolve `[7]` no primeiro teste (só o corrente) e
`[1,2,3,4,6,7]` sem junho no terceiro.

- [ ] **Step 3: `mesesPendentes` passa a incluir o mês anterior**

Em `tools/semanal/atualizar-equipes-online.js`, substituir o corpo de `mesesPendentes`:

```js
function mesesPendentes(porDia, ano, mesCorrente) {
  const comDado = new Set(Object.keys(porDia).map((d) => mesDoDia(Number(d))));
  const pendentes = [];
  for (let mes = 1; mes <= mesCorrente; mes++) {
    const chave = `${ano}-${String(mes).padStart(2, '0')}`;
    // O mês ANTERIOR entra mesmo já tendo dado (2026-08-17): desde que o
    // fetcher passou a gravar o dia corrente, o último dia de cada mês é
    // gravado PARCIAL (retrato das 8h). O mês corrente já era rebuscado
    // sempre, o que completa o dia de ontem todo dia -- mas na virada do mês
    // ele deixa de ser o corrente, e sem isto o dia 30/31 ficaria congelado
    // no parcial para sempre, sem erro nem aviso.
    // Limite conhecido: em 01/01 o mês anterior é dezembro do ano ANTERIOR, e
    // este backfill é escopado ao ano corrente -- 31/12 fica parcial. Ver
    // docs/superpowers/specs/2026-08-17-realizado-ate-hoje-design.md.
    if (mes === mesCorrente || mes === mesCorrente - 1 || !comDado.has(chave)) pendentes.push(mes);
  }
  return pendentes;
}
```

- [ ] **Step 4: `diaEpochDeOntem` vira `diaEpochDeHoje`**

Em `tools/comum/datas.js`, substituir o comentário e a função (linhas 74-81) por:

```js
// Dia-desde-época de HOJE, no fuso do projeto. Até 2026-08-17 esta função era
// 'diaEpochDeOntem' e devolvia d-1, pela regra de que o dia corrente estava
// incompleto. A atualização passou a rodar às 8h diariamente e o Realizado
// passou a contar até D -- ver
// docs/superpowers/specs/2026-08-17-realizado-ate-hoje-design.md.
function diaEpochDeHoje(agora = new Date()) {
  return diaEpoch(agoraNoFusoProjeto(agora));
}
```

E, no `module.exports` do mesmo arquivo, trocar `diaEpochDeOntem` por `diaEpochDeHoje`.

- [ ] **Step 5: O fetcher usa a função nova e para de descartar o dia corrente**

Em `tools/semanal/atualizar-equipes-online.js`:

1. Linha 7, no require: trocar `diaEpochDeOntem` por `diaEpochDeHoje`.
2. Trocar `const diaFim = diaEpochDeOntem();` por `const diaFim = diaEpochDeHoje();`.
3. No `console.log` de abertura, trocar `(corte em d-1: ${fmtData(dataDoDiaEpoch(diaFim))})`
   por `(corte em hoje: ${fmtData(dataDoDiaEpoch(diaFim))})`.
4. Trocar o comentário `// Nunca além de d-1: o dia corrente está incompleto no Link 7.`
   por `// Nunca além de hoje: não há dado de dia futuro no Link 7.`
5. Substituir o comentário que hoje começa em `// Recorta aos meses REALMENTE buscados, e
   nunca além de d-1: o filtro` e vai até `// corrente parcial entrariam no agregado sem
   isto.` por:

```js
  // Recorta aos meses REALMENTE buscados, e nunca além de hoje: o filtro
  // de/ate do site não restringe "Data / Hora Primeira Foto" ao intervalo
  // pedido (achado em 2026-08-09), então sessões de OS antigas entrariam no
  // agregado sem isto. O dia corrente AGORA ENTRA (2026-08-17) -- ele é
  // parcial, e é o rebusque do mês corrente (e do anterior, ver
  // mesesPendentes) que o completa depois.
```

6. No `console.log` do descarte, trocar
   `(sessão de foto de OS antiga ainda ativa, ou o dia de hoje)` por
   `(sessão de foto de OS antiga ainda ativa)`.
7. No bloco de comentário do backfill incremental, trocar a citação
   `apenas os dias que não temos considerando d-1".` por
   `apenas os dias que não temos considerando d-1" (o corte virou HOJE em
   2026-08-17 -- ver o spec citado em mesesPendentes).`

- [ ] **Step 6: Rodar os testes e confirmar que passam**

Run: `node --test test/semanal-atualizar-equipes-online.test.js`
Expected: PASS.

- [ ] **Step 7: Confirmar que nada mais consumia `diaEpochDeOntem`**

Run: `grep -rn "diaEpochDeOntem" tools/ test/`
Expected: nenhuma saída. (O `CLAUDE.md` ainda cita o nome antigo — isso é a Task 3.)

- [ ] **Step 8: Rodar a suíte inteira**

Run: `node --test test/*.js`
Expected: PASS, `fail 0`.

- [ ] **Step 9: Commit**

```bash
git add tools/comum/datas.js tools/semanal/atualizar-equipes-online.js test/semanal-atualizar-equipes-online.test.js
git commit -m "Link 7: busca e grava o dia corrente, e rebusca o mês anterior para completá-lo"
```

---

### Task 3: a documentação que a mudança torna falsa

**Files:**
- Modify: `CLAUDE.md` (regra 1 e regra 5 da seção "Regras de dados…"; o parágrafo final do adendo do alerta de 2026-08-17)
- Modify: `docs/superpowers/specs/2026-08-17-semanal-tendencia-ramo-acima-design.md` (parágrafo "Decisão explícita, sem trava extra")
- Modify: `tools/relatorio/gerar-glossario-alocacao-docx.js` (duas ocorrências)

**Interfaces:** N/A — só texto. Nenhum arquivo desta task entra no build do HTML.

- [ ] **Step 1: `CLAUDE.md`, regra 1 da seção "Regras de dados"**

Substituir o trecho que hoje diz:

```
   E **todo Realizado para em d−1** — o dia
   corrente está incompleto por construção. `realizadoAteEpoch`
   (`render-aba-semanal.js`) existe só para isso; `hojeEpoch` continua sendo hoje
   para semana em curso, saldo de pendentes e congelamento do Consolidado.
```

por:

```
   E **todo Realizado contava até d−1** — o dia corrente estava incompleto por
   construção, e `realizadoAteEpoch` (`render-aba-semanal.js`) existia só para
   isso. **Superado em 2026-08-17** (ver
   `docs/superpowers/specs/2026-08-17-realizado-ate-hoje-design.md`): a
   atualização passou a rodar às 8h diariamente, o que a página serve é o
   retrato daquela hora, e o Realizado passou a contar até **HOJE (D)**. A
   variável sumiu — o Realizado usa `hojeEpoch` como todo o resto da função, e a
   Tabela Semanal passou a concordar com o Balanço de massa, que já cortava
   assim. Isso vale nas três dimensões, e o Link 7 (produção de equipes) passou
   a buscar e gravar o dia corrente junto.
```

- [ ] **Step 2: `CLAUDE.md`, regra 5 da mesma seção**

Trocar `(`hojeNoFusoProjeto`/`diaEpochDeOntem` em `tools/comum/datas.js`)` por
`(`hojeNoFusoProjeto`/`diaEpochDeHoje` em `tools/comum/datas.js`)`.

- [ ] **Step 3: `CLAUDE.md`, o parágrafo do disparo garantido na segunda**

Substituir o parágrafo inteiro que hoje começa em `**O gatilho `realizadoVigente === 0`
dispara com certeza em todo primeiro dia de` e termina em `dono do projeto (ver o spec de
2026-08-17), sem trava de dias mínimos.` por:

```markdown
**O gatilho `realizadoVigente === 0` tende a disparar cedo na segunda-feira, mas
não é mais garantido.** Enquanto o Realizado parava em d−1, o intervalo de contagem
da semana vigente ficava vazio no primeiro dia dela e `realizadoVigente` saía 0 POR
CONSTRUÇÃO — o alerta disparava para TODO SUP no ramo `R > P`, toda semana, sem
exceção. **O corte passou a ser HOJE em 2026-08-17** (ver
`docs/superpowers/specs/2026-08-17-realizado-ate-hoje-design.md`), e isso deixou de
valer: a segunda-feira pode ter avanço registrado. Na prática o disparo ainda é
provável de manhã, porque a captura das 8h pega a segunda quase vazia — mas é
circunstância, não estrutura. Segue sem trava de dias mínimos, decisão explícita do
dono do projeto em 2026-08-17.
```

- [ ] **Step 4: o spec do alerta**

Em `docs/superpowers/specs/2026-08-17-semanal-tendencia-ramo-acima-design.md`,
substituir o parágrafo que começa em `**Decisão explícita, sem trava extra:**` e termina
em `incomodar na prática — não como bug.` por:

```markdown
**Decisão explícita, sem trava extra:** o gatilho é `realizadoVigente === 0` sem
exigir um número mínimo de dias decorridos na semana vigente — inclusive no
primeiro dia dela. É deliberado (bate com "ainda não tivemos avanço na semana", o
cenário que motivou o pedido).

> **Correção de 2026-08-17 (mesmo dia).** A versão original deste parágrafo dizia
> que o disparo era garantido POR CONSTRUÇÃO em toda segunda-feira, porque o
> Realizado parava em d−1 e o intervalo da semana vigente ficava vazio no primeiro
> dia dela. **Isso deixou de valer no mesmo dia:** o corte do Realizado passou a ser
> HOJE (ver `2026-08-17-realizado-ate-hoje-design.md`), e a segunda-feira pode ter
> avanço registrado. O disparo ainda é provável de manhã — a captura das 8h pega a
> segunda quase vazia — mas é circunstância, não garantia. A decisão de não colocar
> trava de dias mínimos foi mantida pelo dono do projeto depois dessa mudança.
```

- [ ] **Step 5: o glossário**

Em `tools/relatorio/gerar-glossario-alocacao-docx.js`, duas edições:

1. Substituir:

```js
  b.push(item([{ t: 'O realizado para sempre em ONTEM. ', b: true },
    'O dia corrente está incompleto por construção — o extrato é alimentado ao longo do dia. Contá-lo '
    + 'faria a semana em curso parecer em queda até virar a meia-noite.']));
```

por:

```js
  b.push(item([{ t: 'O realizado conta até HOJE. ', b: true },
    'A atualização dos dados roda às 8h todo dia, então o que você vê é o retrato daquela hora — o dia '
    + 'corrente entra com o que já tiver sido lançado até ali, e fica completo na atualização do dia '
    + 'seguinte.']));
```

2. Substituir `'ONTEM e de que deslocamentos e cancelados não entram.'` por
   `'HOJE (retrato das 8h) e de que deslocamentos e cancelados não entram.'`

- [ ] **Step 6: Confirmar que nenhum texto do repositório ainda afirma a regra antiga**

Run: `grep -rn "para em d−1\|para em d-1\|para sempre em ONTEM\|diaEpochDeOntem" CLAUDE.md tools/ test/ docs/superpowers/`
Expected: nenhuma saída. (Citações históricas explicitamente marcadas como superadas —
como o "contava até d−1" da regra 1 — não casam com esses padrões; se alguma casar,
confira se está marcada como histórico antes de mudar.)

- [ ] **Step 7: Rodar a suíte inteira**

Run: `node --test test/*.js`
Expected: PASS, `fail 0`. (Nenhuma mudança desta task é de código executado por teste,
mas o glossário é um módulo JS — um erro de sintaxe ali apareceria aqui.)

- [ ] **Step 8: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-08-17-semanal-tendencia-ramo-acima-design.md tools/relatorio/gerar-glossario-alocacao-docx.js
git commit -m "Documenta o corte do Realizado em HOJE e corrige o que a regra antiga afirmava"
```

---

### Task 4: build local, SEM publicar

**Files:**
- Generate: `dist/planejamento-semanal.html`
- Modify: `docs/planejamento-semanal.html` (cópia do dist)

**Interfaces:** N/A — build.

**Nota de execução:** esta task precisa de `ORCAMENTO_SENHA` (variável de ambiente local).
Rode-a na sessão coordenadora, não delegue a um subagente sem contexto do valor da senha.

- [ ] **Step 1: Portão de testes**

Run: `node --test test/*.js`
Expected: PASS, `fail 0`.

- [ ] **Step 2: Build**

```bash
ORCAMENTO_SENHA='<peça ao dono do projeto se não tiver>' node tools/semanal/build-dashboard.js
```

Expected: termina sem erro e escreve `dist/planejamento-semanal.html`.

**Não rode nenhum fetcher antes disto.** O build lê os CSVs que já estão em `dist/` — é
exatamente o comportamento desejado nesta rodada, porque o Patrick está mexendo nas
fontes.

- [ ] **Step 3: Copiar para `docs/` e conferir a sincronia**

```bash
cp dist/planejamento-semanal.html docs/planejamento-semanal.html
node --test test/publicacao-docs-sincronizado.test.js
```

Expected: PASS.

- [ ] **Step 4: Conferir que só o esperado mudou**

Run: `git status --short`
Expected: exatamente `dist/planejamento-semanal.html` e `docs/planejamento-semanal.html`
modificados. Nenhum CSV — se algum CSV aparecer, um fetcher rodou por engano; pare e
reporte.

- [ ] **Step 5: Commit local, e PARAR**

```bash
git add dist/planejamento-semanal.html docs/planejamento-semanal.html
git commit -m "Build: Realizado até HOJE"
```

**NÃO rode `git push` nem `atualizar-arquivos.js`.** A publicação espera a confirmação do
dono do projeto de que o Patrick terminou. Quando ela vier, o fluxo é: `git fetch origin`,
rebase sobre `origin/master`, rodar a suíte de novo, e só então `git push origin
HEAD:master`.

---

## Self-Review

**Cobertura da spec:** Decisão 1 (corte vira `hojeEpoch`, com a consequência em Equipes e
o alinhamento com o Balanço) → Task 1. Decisão 2 (fetcher até D, `diaEpochDeHoje`) →
Task 2 Steps 4-5. Decisão 3 (buraco do último dia do mês) → Task 2 Steps 1-3. Decisão 4
(quatro textos) → Task 3, um step por texto. Decisão 5 (o que não muda) → nenhuma task
toca Balanço, fetchers de Sondagem/Lab, regra 2 ou o orçamento. Seção "Testes" da spec →
Task 1 Steps 1-4 e Task 2 Step 1. Seção "Publicação" → Global Constraints + Task 4 Step 5.

**Placeholders:** nenhum. Os dois valores esperados que mudam (`[1,2,1,null,null]` com
fechamento `4/3`, e `'97'`) foram MEDIDOS antes de escrever o plano, aplicando a mudança
num checkout temporário e revertendo — não são estimativas.

**Consistência de tipos:** `diaEpochDeHoje` (Task 2 Step 4, `datas.js`) é consumida em
Task 2 Step 5 (`atualizar-equipes-online.js`) com o mesmo nome e a mesma aridade.
`mesesPendentes` mantém `(porDia, ano, mesCorrente) -> number[]` entre o Step 1 (testes) e
o Step 3 (implementação). `hojeEpoch` na Task 1 é o parâmetro que
`calcularSeriesSemanaisDimensao` já recebe — nenhuma assinatura muda em lugar nenhum.
