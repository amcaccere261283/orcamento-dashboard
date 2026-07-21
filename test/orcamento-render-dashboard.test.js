'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { renderDashboard } = require('../tools/orcamento/render-dashboard.js');
const { excelSerialParaData } = require('../tools/orcamento/datas.js');

function registroExemplo(overrides) {
  return {
    sup: 'SUP-7133-24', grupo: 'PÁTRIA', tomador: 'Via Araucária S.A', tipologia: 'SM', observacao: null,
    previsto: {
      equipes: Array(12).fill(5), equipesResumo: { pico: 6, media: 5, prod: 1.5, dias: 25 },
      volume: Array(12).fill(100), volumeResumo: { total: 1200, totalInicial: 1000, ticket: 1885.65 },
      financeiro: Array(12).fill(1000), financeiroResumo: { total: 12000, totalInicial: 10000 },
    },
    realizado: {
      equipes: Array(12).fill(4), equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 },
      volume: Array(12).fill(80), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
      financeiro: Array(12).fill(800), financeiroResumo: { total: 0, totalInicial: 0 },
    },
    total: {
      equipes: Array(12).fill(4.5), equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 },
      volume: Array(12).fill(90), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
      financeiro: Array(12).fill(900), financeiroResumo: { total: 0, totalInicial: 0 },
    },
    ...overrides,
  };
}

function periodosExemplo() {
  // Gera o 1º dia de cada mês de 2026 como serial Excel real (46023 = Jan/2026,
  // 46357 = Dez/2026, os mesmos valores documentados em orcamento-datas.test.js).
  // Um passo fixo de +30 dias por mês (como um cálculo ingênuo poderia sugerir)
  // acumula deriva -- meses têm 28 a 31 dias -- e nunca alcança Dez/2026 dentro
  // de 12 iterações; por isso computamos o serial real de cada 1º-do-mês.
  const periodos = [];
  for (let i = 0; i < 12; i++) {
    const serial = Math.round(Date.UTC(2026, i, 1) / 86400000) + 25569;
    periodos.push(excelSerialParaData(serial));
  }
  return periodos;
}

test('renderDashboard embeds one row per registro, with tipologia, contrato and sup as data attributes for filtering', () => {
  const html = renderDashboard({ registros: [registroExemplo()], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  assert.match(html, /data-tipologia="SM"/);
  assert.match(html, /data-grupo="PÁTRIA"/);
  assert.match(html, /data-sup="SUP-7133-24"/);
});

test('renderDashboard shows SUP/Grupo/Tomador as mesclável columns (data-valor, no rowspan) on every série row, including the SUP-total row', () => {
  const html = renderDashboard({ registros: [registroExemplo()], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  const celulasSup = html.match(/<td class="col-mesclavel col-sup" data-valor="SUP-7133-24">SUP-7133-24<\/td>/g) || [];
  const celulasGrupo = html.match(/<td class="col-mesclavel col-grupo" data-valor="PÁTRIA">PÁTRIA<\/td>/g) || [];
  const celulasTomador = html.match(/<td class="col-mesclavel col-tomador" data-valor="Via Araucária S\.A">Via Araucária S\.A<\/td>/g) || [];
  // 3 linhas do registro (SM) + 3 linhas do total do SUP (só tem 1 tipologia aqui) = 6.
  assert.equal(celulasSup.length, 6);
  assert.equal(celulasGrupo.length, 6);
  assert.equal(celulasTomador.length, 6);
  assert.doesNotMatch(html, /rowspan="3">SUP-7133-24/);
});

test('renderDashboard titles each of the 12 month columns with the real "Mês/Ano" label, plus a final Total column', () => {
  const html = renderDashboard({ registros: [registroExemplo()], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  assert.match(html, /<th>Jan\/2026<\/th>/);
  assert.match(html, /<th>Dez\/2026<\/th>/);
  assert.match(html, /<th>Total<\/th>/);
  assert.doesNotMatch(html, /Acum\. anterior/);
  assert.doesNotMatch(html, /Mês vigente/);
});

test('renderDashboard embeds the raw registros as JSON for the client-side recompute script', () => {
  const html = renderDashboard({ registros: [registroExemplo()], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  assert.match(html, /window\.__REGISTROS__\s*=\s*\[/);
  assert.match(html, /"tipologia":"SM"/);
});

test('renderDashboard includes tipologia, contrato and SUP filter dropdowns populated from distinct registro values', () => {
  const registros = [registroExemplo(), registroExemplo({ sup: 'SUP-9999-24', grupo: 'SYSTRA', tomador: 'Ecopistas', tipologia: 'ST' })];
  const html = renderDashboard({ registros, periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  assert.match(html, /<option value="SM">SM<\/option>/);
  assert.match(html, /<option value="ST">ST<\/option>/);
  assert.match(html, /<option value="PÁTRIA">PÁTRIA<\/option>/);
  assert.match(html, /<option value="SYSTRA">SYSTRA<\/option>/);
  assert.match(html, /id="filtro-sup"[\s\S]*?<option value="SUP-7133-24">SUP-7133-24<\/option>/);
  assert.match(html, /id="filtro-sup"[\s\S]*?<option value="SUP-9999-24">SUP-9999-24<\/option>/);
});

test('renderDashboard includes produtividade and ticket médio as dimension options', () => {
  const html = renderDashboard({ registros: [registroExemplo()], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  assert.match(html, /<option value="produtividade">Produtividade<\/option>/);
  assert.match(html, /<option value="ticketMedio">Ticket médio<\/option>/);
});

test('renderDashboard renders Previsto/Realizado/Tendência as 3 separate rows per registro, each labeled and tagged with its série ("Total" is relabeled "Tendência" so it is never confused with the sum column/row)', () => {
  const html = renderDashboard({ registros: [registroExemplo()], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  assert.match(html, /<tr class="linha-serie linha-previsto" data-serie="previsto"/);
  assert.match(html, /<tr class="linha-serie linha-realizado" data-serie="realizado"/);
  assert.match(html, /<tr class="linha-serie linha-total" data-serie="total"/);
  assert.match(html, /<td class="serie-label">Previsto<\/td>/);
  assert.match(html, /<td class="serie-label">Realizado<\/td>/);
  assert.match(html, /<td class="serie-label">Tendência<\/td>/);
  assert.doesNotMatch(html, /<td class="serie-label">Total<\/td>/);
});

test('renderDashboard appends one SUP-total row-group (Previsto/Realizado/Tendência) after each SUP\'s tipologia rows, with a TOTAL badge instead of a tipologia chip and no data-tipologia (so it hides whenever a specific tipologia filter is active)', () => {
  const html = renderDashboard({ registros: [registroExemplo()], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  assert.match(html, /<tr class="linha-serie linha-previsto linha-total-sup" data-serie="previsto" data-grupo="PÁTRIA" data-sup="SUP-7133-24" data-registro-indices="0" data-total-sup="1">/);
  assert.match(html, /<span class="tipologia-chip tipologia-chip-total">TOTAL<\/span>/);
});

test('renderDashboard renders exactly 12 empty month cells plus 1 empty Total cell per série row (1 total geral + 2 registros + 2 SUP-totals, 3 séries cada)', () => {
  const registros = [registroExemplo(), registroExemplo({ sup: 'SUP-9999-24', grupo: 'SYSTRA', tomador: 'Ecopistas', tipologia: 'ST' })];
  const html = renderDashboard({ registros, periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  const celulasMes = html.match(/<td class="celula-mes num"><\/td>/g) || [];
  const celulasTotal = html.match(/<td class="celula-total-linha num"><\/td>/g) || [];
  assert.equal(celulasMes.length, 12 * 3 * 5); // 1 total geral + 2 registros + 2 totais-por-sup, 3 séries cada
  assert.equal(celulasTotal.length, 3 * 5);
});

test('renderDashboard places one "TOTAL GERAL" row-group first in the table body, aggregating every registro (indices 0..N-1)', () => {
  const registros = [registroExemplo(), registroExemplo({ sup: 'SUP-9999-24', grupo: 'SYSTRA', tomador: 'Ecopistas', tipologia: 'ST' })];
  const html = renderDashboard({ registros, periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  assert.match(html, /<tbody><tr class="linha-serie linha-previsto linha-total-geral" data-serie="previsto" data-registro-indices="0,1" data-total-geral="1">/);
  assert.match(html, /<span class="tipologia-chip tipologia-chip-total">TOTAL GERAL<\/span>/);
});

test('renderDashboard includes a série filter (Previsto/Realizado/Tendência) and Limpar filtros / Atualizar dados buttons', () => {
  const html = renderDashboard({ registros: [registroExemplo()], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  assert.match(html, /<select id="filtro-serie">/);
  assert.match(html, /<option value="previsto">Previsto<\/option>/);
  assert.match(html, /<option value="realizado">Realizado<\/option>/);
  assert.match(html, /<option value="total">Tendência<\/option>/);
  assert.match(html, /<button id="limpar-filtros" type="button">Limpar filtros<\/button>/);
  assert.match(html, /<button id="atualizar-dashboard" type="button">Atualizar dados<\/button>/);
});

test('renderDashboard gives each série row a distinct color (P azul, R verde, Tendência amarelo) via CSS classes, applied to both month cells and the Total column', () => {
  const html = renderDashboard({ registros: [registroExemplo()], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  assert.match(html, /\.linha-previsto \.serie-label,\s*\.linha-previsto \.celula-mes,\s*\.linha-previsto \.celula-total-linha\s*\{\s*color:\s*#2f6ad0/);
  assert.match(html, /\.linha-realizado \.serie-label,\s*\.linha-realizado \.celula-mes,\s*\.linha-realizado \.celula-total-linha\s*\{\s*color:\s*#7fd858/);
  assert.match(html, /\.linha-total \.serie-label,\s*\.linha-total \.celula-mes,\s*\.linha-total \.celula-total-linha\s*\{\s*color:\s*#f6b53f/);
});

test('renderDashboard colors the tipologia chip using the same tipologia→cor mapping as the matriz de equipes dashboard (SM is blue #2f6ad0)', () => {
  const html = renderDashboard({ registros: [registroExemplo()], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  assert.match(html, /<span class="tipologia-chip" style="--chip-color:#2f6ad0">SM<\/span>/);
});

function extrairFuncoesPuras(html) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const scriptCliente = scripts[1][1]; // segundo <script> é o SCRIPT_CLIENTE (o primeiro é window.__REGISTROS__)
  const sandbox = {
    document: {
      getElementById: () => ({ addEventListener: () => {}, value: '0' }),
      querySelectorAll: () => [],
    },
    window: {},
  };
  vm.createContext(sandbox);
  vm.runInContext(
    scriptCliente + '\nthis.calcularMensal = calcularMensal; this.calcularTotalAno = calcularTotalAno; this.mesclarConsecutivos = mesclarConsecutivos;',
    sandbox
  );
  return { calcularMensal: sandbox.calcularMensal, calcularTotalAno: sandbox.calcularTotalAno, mesclarConsecutivos: sandbox.mesclarConsecutivos };
}

// As funções do cliente rodam dentro de um vm.Context (um realm diferente do
// processo Node principal), então os arrays/objetos que elas devolvem têm um
// protótipo distinto -- assert.deepEqual (alias de deepStrictEqual, sensível
// a protótipo) acusaria divergência mesmo com os mesmos valores.
// JSON.parse(JSON.stringify(...)) normaliza pro protótipo do realm atual.
function paraPlano(valor) {
  return valor === null ? null : JSON.parse(JSON.stringify(valor));
}

test('calcularMensal (extraído do HTML real gerado), com uma lista de 1 item (caso normal de uma tipologia), devolve os 12 valores mensais crus pra equipes/volume/financeiro, sem agregação', () => {
  const html = renderDashboard({ registros: [registroExemplo()], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  const { calcularMensal } = extrairFuncoesPuras(html);
  const registro = registroExemplo();
  assert.deepEqual(paraPlano(calcularMensal([registro.previsto], 'previsto', 'equipes')), Array(12).fill(5));
  assert.deepEqual(paraPlano(calcularMensal([registro.realizado], 'realizado', 'volume')), Array(12).fill(80));
  assert.deepEqual(paraPlano(calcularMensal([registro.total], 'total', 'financeiro')), Array(12).fill(900));
  assert.equal(calcularMensal([null], 'previsto', 'equipes'), null);
});

test('calcularMensal computa produtividade como volume÷equipes e ticketMedio como financeiro÷volume, mês a mês, nunca o inverso (protege contra troca de numerador/denominador)', () => {
  // Números deliberadamente assimétricos (volume≠equipes≠financeiro) pra que
  // uma troca de numerador/denominador produza um valor bem diferente e
  // fácil de distinguir do valor correto.
  const registro = registroExemplo({
    previsto: {
      equipes: Array(12).fill(4), equipesResumo: { pico: 0, media: 0, prod: 1.5, dias: 0 },
      volume: Array(12).fill(100), volumeResumo: { total: 0, totalInicial: 0, ticket: 1885.65 },
      financeiro: Array(12).fill(1000), financeiroResumo: { total: 0, totalInicial: 0 },
    },
    realizado: {
      equipes: Array(12).fill(5), equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 },
      volume: Array(12).fill(200), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
      financeiro: Array(12).fill(3000), financeiroResumo: { total: 0, totalInicial: 0 },
    },
    total: null,
  });
  const html = renderDashboard({ registros: [registro], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  const { calcularMensal } = extrairFuncoesPuras(html);

  // Produtividade Realizado = volume ÷ equipes = 200 ÷ 5 = 40 em todo mês (não 5/200=0,025).
  assert.deepEqual(paraPlano(calcularMensal([registro.realizado], 'realizado', 'produtividade')), Array(12).fill(40));
  // Ticket médio Realizado = financeiro ÷ volume = 3000 ÷ 200 = 15 em todo mês (não 200/3000≈0,067).
  assert.deepEqual(paraPlano(calcularMensal([registro.realizado], 'realizado', 'ticketMedio')), Array(12).fill(15));
  // Previsto (lista de 1 item) usa a premissa fixa da planilha, repetida nos 12 meses, não uma razão recalculada.
  assert.deepEqual(paraPlano(calcularMensal([registro.previsto], 'previsto', 'produtividade')), Array(12).fill(1.5));
  assert.deepEqual(paraPlano(calcularMensal([registro.previsto], 'previsto', 'ticketMedio')), Array(12).fill(1885.65));
});

test('calcularMensal, agregando VÁRIAS tipologias (caso da linha de total por SUP), soma volume/equipes/financeiro mês a mês e recalcula produtividade/ticketMedio a partir da soma agregada -- inclusive pro Previsto, que não tem premissa própria quando é um agregado de várias tipologias', () => {
  const tipologiaA = registroExemplo({ tipologia: 'SM' });
  const tipologiaB = registroExemplo({
    tipologia: 'ST',
    previsto: {
      equipes: Array(12).fill(2), equipesResumo: { pico: 0, media: 0, prod: 9, dias: 0 },
      volume: Array(12).fill(50), volumeResumo: { total: 0, totalInicial: 0, ticket: 999 },
      financeiro: Array(12).fill(500), financeiroResumo: { total: 0, totalInicial: 0 },
    },
  });
  const html = renderDashboard({ registros: [tipologiaA, tipologiaB], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  const { calcularMensal } = extrairFuncoesPuras(html);

  // equipes: 5 (SM) + 2 (ST) = 7 em todo mês.
  assert.deepEqual(paraPlano(calcularMensal([tipologiaA.previsto, tipologiaB.previsto], 'previsto', 'equipes')), Array(12).fill(7));
  // produtividade agregada = Σvolume ÷ Σequipes = (100+50) ÷ (5+2) = 150/7, NUNCA a média das premissas (1,5 e 9).
  const produtividadeAgregada = calcularMensal([tipologiaA.previsto, tipologiaB.previsto], 'previsto', 'produtividade');
  assert.ok(Math.abs(produtividadeAgregada[0] - 150 / 7) < 1e-9);
  assert.notEqual(produtividadeAgregada[0], 1.5);
  assert.notEqual(produtividadeAgregada[0], 9);
});

test('calcularTotalAno soma os 12 meses de uma lista de 1 item, e recalcula a razão do ano inteiro (não a soma das razões mensais) pra produtividade/ticketMedio agregados', () => {
  const registro = registroExemplo();
  const html = renderDashboard({ registros: [registro], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  const { calcularTotalAno } = extrairFuncoesPuras(html);

  assert.equal(calcularTotalAno([registro.realizado], 'realizado', 'volume'), 80 * 12);
  // Previsto (lista de 1 item): a coluna Total também usa a premissa fixa, não uma soma.
  assert.equal(calcularTotalAno([registro.previsto], 'previsto', 'produtividade'), 1.5);
  // Realizado: razão do ano inteiro = Σfinanceiro ÷ Σvolume = (800*12) ÷ (80*12) = 10.
  assert.equal(calcularTotalAno([registro.realizado], 'realizado', 'ticketMedio'), 10);
});

test('mesclarConsecutivos marks repetido=true only when a value repeats the immediately previous entry, keeping the value itself always present (never blanked) -- the caller decides how to render "repetido"', () => {
  const html = renderDashboard({ registros: [registroExemplo()], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  const { mesclarConsecutivos } = extrairFuncoesPuras(html);

  assert.deepEqual(
    paraPlano(mesclarConsecutivos(['SUP-A', 'SUP-A', 'SUP-A', 'SUP-A', 'SUP-A', 'SUP-A'])),
    [
      { valor: 'SUP-A', repetido: false },
      { valor: 'SUP-A', repetido: true },
      { valor: 'SUP-A', repetido: true },
      { valor: 'SUP-A', repetido: true },
      { valor: 'SUP-A', repetido: true },
      { valor: 'SUP-A', repetido: true },
    ]
  );
});

test('mesclarConsecutivos starts a new (non-repetido) visible block when the value actually changes (a different contract\'s SUP)', () => {
  const html = renderDashboard({ registros: [registroExemplo()], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  const { mesclarConsecutivos } = extrairFuncoesPuras(html);

  assert.deepEqual(
    paraPlano(mesclarConsecutivos(['SUP-A', 'SUP-A', 'SUP-A', 'SUP-B', 'SUP-B', 'SUP-B'])),
    [
      { valor: 'SUP-A', repetido: false },
      { valor: 'SUP-A', repetido: true },
      { valor: 'SUP-A', repetido: true },
      { valor: 'SUP-B', repetido: false },
      { valor: 'SUP-B', repetido: true },
      { valor: 'SUP-B', repetido: true },
    ]
  );
});

test('mesclarConsecutivos re-marks a value as NOT repetido right after a hidden/filtered row removes it from the visible sequence (guards the exact bug rowspan would have)', () => {
  const html = renderDashboard({ registros: [registroExemplo()], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  const { mesclarConsecutivos } = extrairFuncoesPuras(html);

  // Simula o filtro tendo escondido a 2ª linha do grupo "SUP-A" -- a
  // sequência VISÍVEL passada pra função já vem sem ela. A 1ª linha
  // remanescente do grupo continua precisando mostrar o valor (repetido=false).
  assert.deepEqual(
    paraPlano(mesclarConsecutivos(['SUP-A', 'SUP-A', 'SUP-B'])),
    [
      { valor: 'SUP-A', repetido: false },
      { valor: 'SUP-A', repetido: true },
      { valor: 'SUP-B', repetido: false },
    ]
  );
});
