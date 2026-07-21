'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { renderDashboard } = require('../tools/orcamento/render-dashboard.js');
const { excelSerialParaData } = require('../tools/orcamento/datas.js');

function registroExemplo() {
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

test('renderDashboard embeds one row per registro, with tipologia and contrato as data attributes for filtering', () => {
  const html = renderDashboard({ registros: [registroExemplo()], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  assert.match(html, /data-tipologia="SM"/);
  assert.match(html, /data-grupo="PÁTRIA"/);
});

test('renderDashboard shows the SUP contract code as its own column, on every one of the 3 série rows (no rowspan -- rowspan would break when a filter hides a row mid-group)', () => {
  const html = renderDashboard({ registros: [registroExemplo()], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  assert.match(html, /<th>SUP<\/th>/);
  const celulasSup = html.match(/<td class="col-mesclavel col-sup" data-valor="SUP-7133-24">SUP-7133-24<\/td>/g) || [];
  assert.equal(celulasSup.length, 3);
  assert.doesNotMatch(html, /rowspan="3">SUP-7133-24/);
});

test('renderDashboard also renders Grupo and Tomador as mesclável columns (data-valor + col-grupo/col-tomador), one per série row', () => {
  const html = renderDashboard({ registros: [registroExemplo()], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  const celulasGrupo = html.match(/<td class="col-mesclavel col-grupo" data-valor="PÁTRIA">PÁTRIA<\/td>/g) || [];
  const celulasTomador = html.match(/<td class="col-mesclavel col-tomador" data-valor="Via Araucária S\.A">Via Araucária S\.A<\/td>/g) || [];
  assert.equal(celulasGrupo.length, 3);
  assert.equal(celulasTomador.length, 3);
});

test('renderDashboard titles each of the 12 month columns with the real "Mês/Ano" label, not a generic period bucket', () => {
  const html = renderDashboard({ registros: [registroExemplo()], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  assert.match(html, /<th>Jan\/2026<\/th>/);
  assert.match(html, /<th>Dez\/2026<\/th>/);
  assert.doesNotMatch(html, /Acum\. anterior/);
  assert.doesNotMatch(html, /Mês vigente/);
});

test('renderDashboard embeds the raw registros as JSON for the client-side recompute script', () => {
  const html = renderDashboard({ registros: [registroExemplo()], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  assert.match(html, /window\.__REGISTROS__\s*=\s*\[/);
  assert.match(html, /"tipologia":"SM"/);
});

test('renderDashboard includes tipologia and contrato filter dropdowns populated from distinct registro values', () => {
  const registros = [registroExemplo(), { ...registroExemplo(), grupo: 'SYSTRA', tomador: 'Ecopistas', tipologia: 'ST' }];
  const html = renderDashboard({ registros, periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  assert.match(html, /<option value="SM">SM<\/option>/);
  assert.match(html, /<option value="ST">ST<\/option>/);
  assert.match(html, /<option value="PÁTRIA">PÁTRIA<\/option>/);
  assert.match(html, /<option value="SYSTRA">SYSTRA<\/option>/);
});

test('renderDashboard includes produtividade and ticket médio as dimension options', () => {
  const html = renderDashboard({ registros: [registroExemplo()], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  assert.match(html, /<option value="produtividade">Produtividade<\/option>/);
  assert.match(html, /<option value="ticketMedio">Ticket médio<\/option>/);
});

test('renderDashboard renders Previsto/Realizado/Total as 3 separate rows per registro, each labeled and tagged with its série', () => {
  const html = renderDashboard({ registros: [registroExemplo()], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  assert.match(html, /<tr class="linha-serie linha-previsto" data-serie="previsto"/);
  assert.match(html, /<tr class="linha-serie linha-realizado" data-serie="realizado"/);
  assert.match(html, /<tr class="linha-serie linha-total" data-serie="total"/);
  assert.match(html, /<td class="serie-label">Previsto<\/td>/);
  assert.match(html, /<td class="serie-label">Realizado<\/td>/);
  assert.match(html, /<td class="serie-label">Total<\/td>/);
});

test('renderDashboard renders exactly 12 empty month cells per série row, ready for the client script to fill in', () => {
  const html = renderDashboard({ registros: [registroExemplo()], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  const celulas = html.match(/<td class="celula-mes num"><\/td>/g) || [];
  assert.equal(celulas.length, 36); // 12 meses x 3 séries (Previsto/Realizado/Total)
});

test('renderDashboard gives each série row a distinct color (P azul, R verde, T amarelo) via CSS classes', () => {
  const html = renderDashboard({ registros: [registroExemplo()], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  assert.match(html, /\.linha-previsto \.serie-label,\s*\.linha-previsto \.celula-mes\s*\{\s*color:\s*#2f6ad0/);
  assert.match(html, /\.linha-realizado \.serie-label,\s*\.linha-realizado \.celula-mes\s*\{\s*color:\s*#7fd858/);
  assert.match(html, /\.linha-total \.serie-label,\s*\.linha-total \.celula-mes\s*\{\s*color:\s*#f6b53f/);
});

test('renderDashboard colors the tipologia chip using the same tipologia→cor mapping as the matriz de equipes dashboard (SM is blue #2f6ad0)', () => {
  const html = renderDashboard({ registros: [registroExemplo()], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  assert.match(html, /<span class="tipologia-chip" style="--chip-color:#2f6ad0">SM<\/span>/);
});

test('renderDashboard resolves a composite tipologia string without parentheses (real MATRIZ format, e.g. "SM / SM.F / SR") to its first token\'s cor, unlike matriz de equipes which only needs the parenthesis form', () => {
  const registro = { ...registroExemplo(), tipologia: 'SM / SM.F / SR' };
  const html = renderDashboard({ registros: [registro], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  assert.match(html, /<span class="tipologia-chip" style="--chip-color:#2f6ad0">SM \/ SM\.F \/ SR<\/span>/);
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
    scriptCliente + '\nthis.calcularSerieMensal = calcularSerieMensal; this.mesclarConsecutivos = mesclarConsecutivos;',
    sandbox
  );
  return { calcularSerieMensal: sandbox.calcularSerieMensal, mesclarConsecutivos: sandbox.mesclarConsecutivos };
}

function extrairCalcularSerieMensal(html) {
  return extrairFuncoesPuras(html).calcularSerieMensal;
}

// calcularSerieMensal roda dentro de um vm.Context (um realm diferente do
// processo Node principal), então os arrays que ela devolve têm um
// Array.prototype distinto -- assert.deepEqual (alias de deepStrictEqual,
// sensível a protótipo) acusaria divergência mesmo com os mesmos valores.
// JSON.parse(JSON.stringify(...)) normaliza pro protótipo do realm atual.
function paraArrayPlano(valor) {
  return valor === null ? null : JSON.parse(JSON.stringify(valor));
}

test('calcularSerieMensal (extraído do HTML real gerado) devolve os 12 valores mensais crus pra equipes/volume/financeiro, sem agregação', () => {
  const html = renderDashboard({ registros: [registroExemplo()], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  const calcularSerieMensal = extrairCalcularSerieMensal(html);
  const registro = registroExemplo();
  assert.deepEqual(paraArrayPlano(calcularSerieMensal(registro, 'previsto', 'equipes')), Array(12).fill(5));
  assert.deepEqual(paraArrayPlano(calcularSerieMensal(registro, 'realizado', 'volume')), Array(12).fill(80));
  assert.deepEqual(paraArrayPlano(calcularSerieMensal(registro, 'total', 'financeiro')), Array(12).fill(900));
  assert.equal(calcularSerieMensal({ previsto: null, realizado: null, total: null }, 'previsto', 'equipes'), null);
});

test('calcularSerieMensal (extraído do HTML real gerado) computa produtividade como volume÷equipes e ticketMedio como financeiro÷volume, mês a mês, nunca o inverso (protege contra troca de numerador/denominador)', () => {
  // Números deliberadamente assimétricos (volume≠equipes≠financeiro) pra que
  // uma troca de numerador/denominador produza um valor bem diferente e
  // fácil de distinguir do valor correto.
  const registro = {
    sup: 'SUP-X', grupo: 'X', tomador: 'Y', tipologia: 'Z', observacao: null,
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
  };
  const html = renderDashboard({ registros: [registro], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  const calcularSerieMensal = extrairCalcularSerieMensal(html);

  // Produtividade Realizado = volume ÷ equipes = 200 ÷ 5 = 40 em todo mês (não 5/200=0,025).
  assert.deepEqual(paraArrayPlano(calcularSerieMensal(registro, 'realizado', 'produtividade')), Array(12).fill(40));

  // Ticket médio Realizado = financeiro ÷ volume = 3000 ÷ 200 = 15 em todo mês (não 200/3000≈0,067).
  assert.deepEqual(paraArrayPlano(calcularSerieMensal(registro, 'realizado', 'ticketMedio')), Array(12).fill(15));

  // Previsto usa a premissa fixa da planilha (PROD./TICKET), repetida nos 12 meses, não uma razão recalculada.
  assert.deepEqual(paraArrayPlano(calcularSerieMensal(registro, 'previsto', 'produtividade')), Array(12).fill(1.5));
  assert.deepEqual(paraArrayPlano(calcularSerieMensal(registro, 'previsto', 'ticketMedio')), Array(12).fill(1885.65));

  // Total é null nesse registro -- não deve lançar, só devolver null.
  assert.equal(calcularSerieMensal(registro, 'total', 'produtividade'), null);
});

test('mesclarConsecutivos (extraído do HTML real gerado) blanks a value only when it repeats the immediately previous entry, keeping the first occurrence and any later re-appearance after a change', () => {
  const html = renderDashboard({ registros: [registroExemplo()], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  const { mesclarConsecutivos } = extrairFuncoesPuras(html);

  // 3 linhas P/R/T do mesmo registro (mesmo SUP) + 3 do próximo registro do
  // MESMO contrato (mesmo SUP de novo) -- tudo deve mesclar num bloco só.
  assert.deepEqual(
    paraArrayPlano(mesclarConsecutivos(['SUP-A', 'SUP-A', 'SUP-A', 'SUP-A', 'SUP-A', 'SUP-A'])),
    ['SUP-A', '', '', '', '', '']
  );
});

test('mesclarConsecutivos starts a new visible block when the value actually changes (a different contract\'s SUP)', () => {
  const html = renderDashboard({ registros: [registroExemplo()], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  const { mesclarConsecutivos } = extrairFuncoesPuras(html);

  assert.deepEqual(
    paraArrayPlano(mesclarConsecutivos(['SUP-A', 'SUP-A', 'SUP-A', 'SUP-B', 'SUP-B', 'SUP-B'])),
    ['SUP-A', '', '', 'SUP-B', '', '']
  );
});

test('mesclarConsecutivos re-shows the value right after a hidden/filtered row removes it from the visible sequence (guards the exact bug rowspan would have)', () => {
  const html = renderDashboard({ registros: [registroExemplo()], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) });
  const { mesclarConsecutivos } = extrairFuncoesPuras(html);

  // Simula o filtro tendo escondido a 2ª linha do grupo "SUP-A" -- a
  // sequência VISÍVEL passada pra função já vem sem ela. A 1ª linha
  // remanescente do grupo continua precisando mostrar o valor (não pode
  // ficar em branco só porque não é fisicamente a 1ª linha do registro).
  assert.deepEqual(
    paraArrayPlano(mesclarConsecutivos(['SUP-A', 'SUP-A', 'SUP-B'])),
    ['SUP-A', '', 'SUP-B']
  );
});
