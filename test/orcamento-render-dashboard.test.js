'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { renderDashboard } = require('../tools/orcamento/render-dashboard.js');
const { decifrarComSenha } = require('../tools/orcamento/criptografia.js');
const { excelSerialParaData } = require('../tools/orcamento/datas.js');

const SENHA_TESTE = 'senha-fake-de-teste-abc';

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
  const periodos = [];
  for (let i = 0; i < 12; i++) {
    const serial = Math.round(Date.UTC(2026, i, 1) / 86400000) + 25569;
    periodos.push(excelSerialParaData(serial));
  }
  return periodos;
}

function renderComSenha(registros, overrides) {
  return renderDashboard({ registros, periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21), senha: SENHA_TESTE, ...overrides });
}

test('renderDashboard throws without a senha -- content must never be embeddable in plain text by accident', () => {
  assert.throws(
    () => renderDashboard({ registros: [registroExemplo()], periodos: periodosExemplo(), generatedAt: new Date(2026, 6, 21) }),
    /senha/
  );
});

test('renderDashboard never leaks real contract/client names in plain text anywhere in the HTML -- only inside the encrypted blob', () => {
  const html = renderComSenha([registroExemplo()]);
  assert.doesNotMatch(html, /PÁTRIA/);
  assert.doesNotMatch(html, /Via Araucária S\.A/);
  assert.doesNotMatch(html, /SUP-7133-24/);
});

function extrairPacoteCifrado(html) {
  const match = html.match(/window\.__DADOS_CIFRADOS__\s*=\s*(\{[\s\S]*?\});/);
  assert.ok(match, 'window.__DADOS_CIFRADOS__ not found in the rendered HTML');
  return JSON.parse(match[1]);
}

test('renderDashboard embeds an encrypted blob (salt/iv/dados/iteracoes) that decrypts back to the original registros with the correct senha', () => {
  const registro = registroExemplo();
  const html = renderComSenha([registro]);
  const pacote = extrairPacoteCifrado(html);
  assert.ok(pacote.salt && pacote.iv && pacote.dados && pacote.iteracoes);
  const registrosDecifrados = JSON.parse(decifrarComSenha(pacote, SENHA_TESTE));
  assert.equal(registrosDecifrados[0].grupo, 'PÁTRIA');
  assert.equal(registrosDecifrados[0].sup, 'SUP-7133-24');
  assert.equal(registrosDecifrados[0].tomador, 'Via Araucária S.A');
  assert.equal(registrosDecifrados[0].tipologia, 'SM');
});

test('renderDashboard\'s encrypted blob fails to decrypt with the wrong senha (never silently returns garbage)', () => {
  const html = renderComSenha([registroExemplo()]);
  const pacote = extrairPacoteCifrado(html);
  assert.throws(() => decifrarComSenha(pacote, 'senha-errada'));
});

test('renderDashboard includes the password gate UI (input + button), and the filter/table shells start empty -- no options or rows pre-populated, since those come from JS only after decryption', () => {
  const html = renderComSenha([registroExemplo()]);
  assert.match(html, /id="gate-senha"/);
  assert.match(html, /id="campo-senha"/);
  assert.match(html, /id="btn-desbloquear"/);
  assert.match(html, /<div class="filtro-multi" id="filtro-tipologia"><button type="button" class="filtro-multi-trigger">Todas as tipologias[\s\S]*?<\/button><div class="filtro-multi-painel" hidden><\/div><\/div>/, 'painel de checkboxes começa vazio -- as tipologias reais só existem depois de decifrar no navegador');
  assert.match(html, /<div class="filtro-multi" id="filtro-grupo"><button type="button" class="filtro-multi-trigger">Todos os grupos[\s\S]*?<\/button><div class="filtro-multi-painel" hidden><\/div><\/div>/);
  assert.match(html, /<div class="filtro-multi" id="filtro-sup"><button type="button" class="filtro-multi-trigger">Todos os SUP[\s\S]*?<\/button><div class="filtro-multi-painel" hidden><\/div><\/div>/);
  assert.match(html, /<tbody id="corpo-tabela"><\/tbody>/);
});

test('renderDashboard titles each of the 12 month columns with the real "Mês/Ano" label (calendar months are not sensitive, safe to render server-side), plus a final Total column', () => {
  const html = renderComSenha([registroExemplo()]);
  assert.match(html, /<th>Jan\/2026<\/th>/);
  assert.match(html, /<th>Dez\/2026<\/th>/);
  assert.match(html, /<th>Total<\/th>/);
});

test('renderDashboard includes a série filter (Previsto/Realizado/Tendência) and a categoria filter (fixed, non-sensitive labels, safe to render server-side unlike tipologia/grupo/SUP), and Limpar filtros / Atualizar dados buttons', () => {
  const html = renderComSenha([registroExemplo()]);
  assert.match(html, /<div class="filtro-multi" id="filtro-serie">/);
  assert.match(html, /<div class="filtro-multi" id="filtro-categoria">/);
  assert.match(html, /<button id="limpar-filtros" type="button"><svg[\s\S]*?<\/svg>Limpar filtros<\/button>/);
  assert.match(html, /<button id="atualizar-dashboard" type="button"><svg[\s\S]*?<\/svg>Atualizar dados<\/button>/);
});

test('renderDashboard defaults the dimension selector to "Financeiro", not "Equipes" -- the table must open showing money, not headcount', () => {
  const html = renderComSenha([registroExemplo()]);
  assert.match(html, /<option value="financeiro" selected>Financeiro<\/option>/);
  assert.doesNotMatch(html, /<option value="equipes" selected>/);
});

test('renderDashboard includes Tabela/Gráfico tab buttons and both view sections (Gráfico hidden by default)', () => {
  const html = renderComSenha([registroExemplo()]);
  assert.match(html, /<button id="aba-tabela" type="button" class="aba-ativa"><svg[\s\S]*?<\/svg>Tabela<\/button>/);
  assert.match(html, /<button id="aba-grafico" type="button"><svg[\s\S]*?<\/svg>Gráfico<\/button>/);
  assert.match(html, /<div id="secao-tabela">/);
  assert.match(html, /<div id="secao-grafico" style="display:none">/);
  assert.match(html, /<div id="grafico-mensal-container"><\/div>/);
  assert.match(html, /<div id="grafico-acumulado-container"><\/div>/);
  assert.match(html, /<div id="grafico-tooltip" class="grafico-tooltip" style="display:none"><\/div>/);
});

// Todas as funções de montagem da tabela (linhas, cores, agregação) rodam
// só no navegador, DEPOIS de decifrar -- por isso vivem dentro do 3º
// <script> da página (SCRIPT_CLIENTE_TABELA), não no 2º (o gate, que só
// cuida da senha) nem no 1º (só o JSON cifrado). Extraídas via vm.Context
// pros testes chamarem diretamente.
function extrairFuncoesPuras(html) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 3, 'esperava exatamente 3 <script> (dados cifrados, gate, tabela)');
  const scriptTabela = scripts[2][1];
  const sandbox = {
    document: {
      getElementById: () => ({ addEventListener: () => {}, value: '0', options: [{}] }),
      querySelectorAll: () => [],
    },
    window: {},
  };
  vm.createContext(sandbox);
  vm.runInContext(
    scriptTabela +
      '\nthis.calcularMensal = calcularMensal; this.calcularTotalAno = calcularTotalAno;' +
      ' this.mesclarConsecutivos = mesclarConsecutivos; this.tipologiaColor = tipologiaColor;' +
      ' this.renderCorpoTabela = renderCorpoTabela; this.escapeHtml = escapeHtml;' +
      ' this.calcularAcumulado = calcularAcumulado; this.indicesFiltrados = indicesFiltrados;' +
      ' this.construirGraficoMensalSvg = construirGraficoMensalSvg;' +
      ' this.construirGraficoAcumuladoSvg = construirGraficoAcumuladoSvg;' +
      ' this.calcularEscalaEixo = calcularEscalaEixo;' +
      ' this.ultimoIndiceComDado = ultimoIndiceComDado;' +
      ' this.calcularAcumuladoTendencia = calcularAcumuladoTendencia;' +
      ' this.parseCsvGrid = parseCsvGrid; this.numeroPtBr = numeroPtBr;' +
      ' this.parseMatrizClient = parseMatrizClient;' +
      ' this.formatarNumero = formatarNumero; this.formatarValorGrafico = formatarValorGrafico;' +
      ' this.categoriaTipologia = categoriaTipologia;' +
      ' this.cortarAcumuladoNoUltimoDado = cortarAcumuladoNoUltimoDado;',
    sandbox
  );
  return {
    calcularMensal: sandbox.calcularMensal, calcularTotalAno: sandbox.calcularTotalAno,
    mesclarConsecutivos: sandbox.mesclarConsecutivos, tipologiaColor: sandbox.tipologiaColor,
    renderCorpoTabela: sandbox.renderCorpoTabela, escapeHtml: sandbox.escapeHtml,
    calcularAcumulado: sandbox.calcularAcumulado, indicesFiltrados: sandbox.indicesFiltrados,
    construirGraficoMensalSvg: sandbox.construirGraficoMensalSvg,
    construirGraficoAcumuladoSvg: sandbox.construirGraficoAcumuladoSvg,
    calcularEscalaEixo: sandbox.calcularEscalaEixo,
    ultimoIndiceComDado: sandbox.ultimoIndiceComDado,
    calcularAcumuladoTendencia: sandbox.calcularAcumuladoTendencia,
    parseCsvGrid: sandbox.parseCsvGrid, numeroPtBr: sandbox.numeroPtBr,
    parseMatrizClient: sandbox.parseMatrizClient,
    formatarNumero: sandbox.formatarNumero, formatarValorGrafico: sandbox.formatarValorGrafico,
    categoriaTipologia: sandbox.categoriaTipologia,
    cortarAcumuladoNoUltimoDado: sandbox.cortarAcumuladoNoUltimoDado,
  };
}

// As funções do cliente rodam dentro de um vm.Context (um realm diferente do
// processo Node principal), então os arrays/objetos que elas devolvem têm um
// protótipo distinto -- assert.deepEqual (alias de deepStrictEqual, sensível
// a protótipo) acusaria divergência mesmo com os mesmos valores.
// JSON.parse(JSON.stringify(...)) normaliza pro protótipo do realm atual.
function paraPlano(valor) {
  return valor === null ? null : JSON.parse(JSON.stringify(valor));
}

test('tipologiaColor (extraído do HTML real gerado) usa o mesmo mapeamento da matriz de equipes (SM é azul #2f6ad0)', () => {
  const html = renderComSenha([registroExemplo()]);
  const { tipologiaColor } = extrairFuncoesPuras(html);
  assert.equal(tipologiaColor('SM'), '#2f6ad0');
  assert.equal(tipologiaColor('SM / SM.F / SR'), '#2f6ad0');
  assert.equal(tipologiaColor('ALGO-DESCONHECIDO'), '#898781');
});

test('renderCorpoTabela (extraído do HTML real gerado) monta o bloco TOTAL GERAL primeiro, depois cada registro com 3 linhas de série e um total por SUP ao fim de cada grupo', () => {
  const html = renderComSenha([registroExemplo()]);
  const { renderCorpoTabela } = extrairFuncoesPuras(html);
  const corpo = renderCorpoTabela([registroExemplo()]);
  assert.match(corpo, /^<tr class="linha-serie linha-previsto linha-total-geral"/);
  assert.match(corpo, /<span class="tipologia-chip tipologia-chip-total">TOTAL GERAL<\/span>/);
  assert.match(corpo, /<span class="tipologia-chip" style="--chip-color:#2f6ad0">SM<\/span>/);
  assert.match(corpo, /<span class="tipologia-chip tipologia-chip-total">TOTAL<\/span>/);
  assert.match(corpo, /data-valor="SUP-7133-24"/);
  assert.match(corpo, /data-valor="PÁTRIA"/);
});

test('renderCorpoTabela shows "Todos" (not a blank dash) in Grupo and Tomador for both TOTAL GERAL and TOTAL GERAL POR TIPOLOGIA -- SUP still shows a dash, since there is no per-SUP breakdown at that level', () => {
  const html = renderComSenha([registroExemplo()]);
  const { renderCorpoTabela } = extrairFuncoesPuras(html);
  const corpo = renderCorpoTabela([registroExemplo()]);
  const celulasTodos = corpo.match(/data-valor="Todos">Todos<\/td>/g) || [];
  // 1 registro -> TOTAL GERAL (3 linhas) + 1 bloco de tipologia (3 linhas) =
  // 6 linhas, cada uma com 2 células "Todos" (Grupo e Tomador) = 12.
  assert.equal(celulasTodos.length, 12);
  const celulasSupTraco = corpo.match(/class="col-mesclavel col-sup" data-valor="">—<\/td>/g) || [];
  assert.equal(celulasSupTraco.length, 6);
});

test('renderCorpoTabela never uses rowspan for the Tipologia/badge column -- it must repeat on every P/R/T row so the filtro-serie filter can hide exactly one of the 3 rows without breaking the other 2 (real bug: rowspan="3" lived only on the Previsto row, so filtering to Realizado/Tendência made the whole column vanish)', () => {
  const html = renderComSenha([registroExemplo()]);
  const { renderCorpoTabela } = extrairFuncoesPuras(html);
  const corpo = renderCorpoTabela([registroExemplo()]);
  assert.doesNotMatch(corpo, /rowspan/);
  // 3 registro rows (P/R/T) + 3 total-sup rows + 3 total-geral rows + 3
  // total-geral-tipologia rows (1 distinct tipologia here) = 12 rows total,
  // each needs its own col-tipologia cell now.
  const celulasTipologia = corpo.match(/class="col-mesclavel col-tipologia"/g) || [];
  assert.equal(celulasTipologia.length, 12);
});

test('renderCorpoTabela adds a "total geral por tipologia" block for each distinct tipologia (alphabetical), aggregating across ALL SUPs that have it, right after the overall TOTAL GERAL and before any per-contract row', () => {
  const registroSM_supA = registroExemplo({ sup: 'SUP-A', grupo: 'PÁTRIA', tipologia: 'SM' });
  const registroST_supA = registroExemplo({ sup: 'SUP-A', grupo: 'PÁTRIA', tipologia: 'ST' });
  const registroSM_supB = registroExemplo({ sup: 'SUP-B', grupo: 'SYSTRA', tipologia: 'SM' });
  const html = renderComSenha([registroSM_supA, registroST_supA, registroSM_supB]);
  const { renderCorpoTabela } = extrairFuncoesPuras(html);
  const corpo = renderCorpoTabela([registroSM_supA, registroST_supA, registroSM_supB]);

  // Ordem: TOTAL GERAL, depois total geral por tipologia em ordem
  // alfabética (SM antes de ST), só depois disso os registros normais.
  const posTotalGeral = corpo.indexOf('data-total-geral="1"');
  const posTotalTipologiaSM = corpo.search(/data-tipologia="SM"[^>]*data-total-geral-tipologia="1"/);
  const posTotalTipologiaST = corpo.search(/data-tipologia="ST"[^>]*data-total-geral-tipologia="1"/);
  const posPrimeiroRegistro = corpo.indexOf('data-sup="SUP-A"');
  assert.ok(posTotalTipologiaSM >= 0 && posTotalTipologiaST >= 0, 'esperava blocos de total geral por tipologia pra SM e ST');
  assert.ok(posTotalGeral < posTotalTipologiaSM, 'total geral deve vir antes do total por tipologia');
  assert.ok(posTotalTipologiaSM < posTotalTipologiaST, 'SM deve vir antes de ST (ordem alfabética)');
  assert.ok(posTotalTipologiaST < posPrimeiroRegistro, 'totais por tipologia devem vir antes dos registros normais');

  // O bloco de total geral de "SM" reúne os índices das DUAS tipologias SM
  // (SUP-A e SUP-B), não só a primeira.
  const matchIndicesSM = corpo.match(/data-tipologia="SM"[^>]*data-registro-indices="([\d,]*)" data-total-geral-tipologia="1"/);
  assert.ok(matchIndicesSM);
  assert.deepEqual(matchIndicesSM[1].split(',').map(Number).sort(), [0, 2]);
});

test('calcularMensal (extraído do HTML real gerado), com uma lista de 1 item (caso normal de uma tipologia), devolve os 12 valores mensais crus pra equipes/volume/financeiro, sem agregação', () => {
  const html = renderComSenha([registroExemplo()]);
  const { calcularMensal } = extrairFuncoesPuras(html);
  const registro = registroExemplo();
  assert.deepEqual(paraPlano(calcularMensal([registro.previsto], 'previsto', 'equipes')), Array(12).fill(5));
  assert.deepEqual(paraPlano(calcularMensal([registro.realizado], 'realizado', 'volume')), Array(12).fill(80));
  assert.deepEqual(paraPlano(calcularMensal([registro.total], 'total', 'financeiro')), Array(12).fill(900));
  assert.equal(calcularMensal([null], 'previsto', 'equipes'), null);
});

test('calcularMensal preserves null for a month with no data reported yet (never coerces it to 0) -- real case: R/P left blank for a month the source spreadsheet had no value for', () => {
  const registro = registroExemplo({
    realizado: {
      equipes: [4, 4, 4, 4, 4, null, 4, 4, 4, 4, 4, 4],
      equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 },
      volume: Array(12).fill(80), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
      financeiro: Array(12).fill(800).map((v, i) => i === 5 ? null : v), financeiroResumo: { total: 0, totalInicial: 0 },
    },
  });
  const html = renderComSenha([registro]);
  const { calcularMensal } = extrairFuncoesPuras(html);
  const equipes = calcularMensal([registro.realizado], 'realizado', 'equipes');
  assert.equal(equipes[5], null);
  assert.equal(equipes[4], 4);
  assert.equal(equipes[6], 4);
  const financeiro = calcularMensal([registro.realizado], 'realizado', 'financeiro');
  assert.equal(financeiro[5], null);
});

test('calcularMensal computa produtividade como volume÷equipes e ticketMedio como financeiro÷volume, mês a mês, nunca o inverso (protege contra troca de numerador/denominador)', () => {
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
  const html = renderComSenha([registro]);
  const { calcularMensal } = extrairFuncoesPuras(html);

  assert.deepEqual(paraPlano(calcularMensal([registro.realizado], 'realizado', 'produtividade')), Array(12).fill(40));
  assert.deepEqual(paraPlano(calcularMensal([registro.realizado], 'realizado', 'ticketMedio')), Array(12).fill(15));
  assert.deepEqual(paraPlano(calcularMensal([registro.previsto], 'previsto', 'produtividade')), Array(12).fill(1.5));
  assert.deepEqual(paraPlano(calcularMensal([registro.previsto], 'previsto', 'ticketMedio')), Array(12).fill(1885.65));
});

test('calcularMensal, agregando VÁRIAS tipologias (caso da linha de total por SUP/geral), soma volume/equipes/financeiro mês a mês e recalcula produtividade/ticketMedio a partir da soma agregada', () => {
  const tipologiaA = registroExemplo({ tipologia: 'SM' });
  const tipologiaB = registroExemplo({
    tipologia: 'ST',
    previsto: {
      equipes: Array(12).fill(2), equipesResumo: { pico: 0, media: 0, prod: 9, dias: 0 },
      volume: Array(12).fill(50), volumeResumo: { total: 0, totalInicial: 0, ticket: 999 },
      financeiro: Array(12).fill(500), financeiroResumo: { total: 0, totalInicial: 0 },
    },
  });
  const html = renderComSenha([tipologiaA, tipologiaB]);
  const { calcularMensal } = extrairFuncoesPuras(html);

  assert.deepEqual(paraPlano(calcularMensal([tipologiaA.previsto, tipologiaB.previsto], 'previsto', 'equipes')), Array(12).fill(7));
  const produtividadeAgregada = calcularMensal([tipologiaA.previsto, tipologiaB.previsto], 'previsto', 'produtividade');
  assert.ok(Math.abs(produtividadeAgregada[0] - 150 / 7) < 1e-9);
  assert.notEqual(produtividadeAgregada[0], 1.5);
  assert.notEqual(produtividadeAgregada[0], 9);
});

test('calcularMensal, aggregating multiple tipologias, sums whatever contributors DO have data for a month (does not zero out just because one contributor is still blank that month) -- but stays null when EVERY contributor is blank', () => {
  const tipologiaA = registroExemplo({
    tipologia: 'SM',
    realizado: {
      equipes: Array(12).fill(4).map((v, i) => i === 5 ? null : v), equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 },
      volume: Array(12).fill(80), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
      financeiro: Array(12).fill(800).map((v, i) => i === 5 ? null : v), financeiroResumo: { total: 0, totalInicial: 0 },
    },
  });
  const tipologiaB = registroExemplo({
    tipologia: 'ST',
    realizado: {
      equipes: Array(12).fill(2).map((v, i) => i === 5 ? null : v), equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 },
      volume: Array(12).fill(30), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
      financeiro: Array(12).fill(300), financeiroResumo: { total: 0, totalInicial: 0 },
    },
  });
  const html = renderComSenha([tipologiaA, tipologiaB]);
  const { calcularMensal } = extrairFuncoesPuras(html);

  // Mês 5: as duas tipologias estão sem equipes -- o agregado continua null.
  const equipes = calcularMensal([tipologiaA.realizado, tipologiaB.realizado], 'realizado', 'equipes');
  assert.equal(equipes[5], null);
  assert.equal(equipes[4], 6);

  // Mês 5: só tipologiaA está sem financeiro -- o agregado soma só o que tem (tipologiaB).
  const financeiro = calcularMensal([tipologiaA.realizado, tipologiaB.realizado], 'realizado', 'financeiro');
  assert.equal(financeiro[5], 300);
  assert.equal(financeiro[4], 1100);
});

test('calcularTotalAno soma os 12 meses de uma lista de 1 item, e recalcula a razão do ano inteiro (não a soma das razões mensais) pra produtividade/ticketMedio agregados', () => {
  const registro = registroExemplo();
  const html = renderComSenha([registro]);
  const { calcularTotalAno } = extrairFuncoesPuras(html);

  assert.equal(calcularTotalAno([registro.realizado], 'realizado', 'volume'), 80 * 12);
  assert.equal(calcularTotalAno([registro.previsto], 'previsto', 'produtividade'), 1.5);
  assert.equal(calcularTotalAno([registro.realizado], 'realizado', 'ticketMedio'), 10);
});

test('mesclarConsecutivos marks repetido=true only when a value repeats the immediately previous entry, keeping the value itself always present (never blanked)', () => {
  const html = renderComSenha([registroExemplo()]);
  const { mesclarConsecutivos } = extrairFuncoesPuras(html);

  assert.deepEqual(
    paraPlano(mesclarConsecutivos(['SUP-A', 'SUP-A', 'SUP-A'])),
    [
      { valor: 'SUP-A', repetido: false },
      { valor: 'SUP-A', repetido: true },
      { valor: 'SUP-A', repetido: true },
    ]
  );
});

test('mesclarConsecutivos starts a new (non-repetido) visible block when the value actually changes', () => {
  const html = renderComSenha([registroExemplo()]);
  const { mesclarConsecutivos } = extrairFuncoesPuras(html);

  assert.deepEqual(
    paraPlano(mesclarConsecutivos(['SUP-A', 'SUP-A', 'SUP-B'])),
    [
      { valor: 'SUP-A', repetido: false },
      { valor: 'SUP-A', repetido: true },
      { valor: 'SUP-B', repetido: false },
    ]
  );
});

test('mesclarConsecutivos re-marks a value as NOT repetido right after a hidden/filtered row removes it from the visible sequence (guards the exact bug rowspan would have)', () => {
  const html = renderComSenha([registroExemplo()]);
  const { mesclarConsecutivos } = extrairFuncoesPuras(html);

  // Simula o filtro tendo escondido uma linha do meio do grupo "SUP-A" -- a
  // sequência VISÍVEL passada pra função já vem sem ela.
  assert.deepEqual(
    paraPlano(mesclarConsecutivos(['SUP-A', 'SUP-A', 'SUP-B'])),
    [
      { valor: 'SUP-A', repetido: false },
      { valor: 'SUP-A', repetido: true },
      { valor: 'SUP-B', repetido: false },
    ]
  );
});

test('calcularAcumulado (extraído do HTML real gerado) returns the running sum month over month', () => {
  const html = renderComSenha([registroExemplo()]);
  const { calcularAcumulado } = extrairFuncoesPuras(html);
  assert.deepEqual(paraPlano(calcularAcumulado([10, 20, 30])), [10, 30, 60]);
});

test('calcularAcumulado treats null/undefined months as 0 without breaking the running sum of the months after them', () => {
  const html = renderComSenha([registroExemplo()]);
  const { calcularAcumulado } = extrairFuncoesPuras(html);
  assert.deepEqual(paraPlano(calcularAcumulado([10, null, 30])), [10, 10, 40]);
});

test('calcularAcumulado returns an empty array for an empty input', () => {
  const html = renderComSenha([registroExemplo()]);
  const { calcularAcumulado } = extrairFuncoesPuras(html);
  assert.deepEqual(paraPlano(calcularAcumulado([])), []);
});

test('ultimoIndiceComDado (extraído do HTML real gerado) finds the last non-null month, ignoring trailing nulls', () => {
  const html = renderComSenha([registroExemplo()]);
  const { ultimoIndiceComDado } = extrairFuncoesPuras(html);
  assert.equal(ultimoIndiceComDado([10, 20, 30, null, null, null, null, null, null, null, null, null]), 2);
  assert.equal(ultimoIndiceComDado(Array(12).fill(null)), -1);
  assert.equal(ultimoIndiceComDado(Array(12).fill(5)), 11);
});

test('ultimoIndiceComDado ignores a null gap followed by more real data (a hole in the middle does not count as "the end")', () => {
  const html = renderComSenha([registroExemplo()]);
  const { ultimoIndiceComDado } = extrairFuncoesPuras(html);
  assert.equal(ultimoIndiceComDado([10, null, 30, null, null, null, null, null, null, null, null, null]), 2);
});

test('calcularAcumuladoTendencia (extraído do HTML real gerado) picks up Tendência\'s running total exactly where Realizado\'s accumulated total left off, not from zero', () => {
  const html = renderComSenha([registroExemplo()]);
  const { calcularAcumuladoTendencia, calcularAcumulado } = extrairFuncoesPuras(html);
  const mensalRealizado = [10, 10, 10, null, null, null, null, null, null, null, null, null];
  const acumuladoRealizado = calcularAcumulado(mensalRealizado); // [10,20,30,30,30,...]
  const ultimoMesRealizado = 2;
  const mensalTendencia = [null, null, null, 5, 5, 5, null, null, null, null, null, null];
  const resultado = calcularAcumuladoTendencia(mensalTendencia, acumuladoRealizado, ultimoMesRealizado);
  assert.deepEqual(paraPlano(resultado.slice(0, 2)), [null, null], 'antes do último Realizado, Tendência não desenha nada -- quem cobre esses meses é o Realizado');
  assert.equal(resultado[2], 30, 'no mês de conexão, o acumulado de Tendência é o mesmo do acumulado de Realizado ali');
  assert.deepEqual(paraPlano(resultado.slice(3, 6)), [35, 40, 45], 'dali em diante, soma só a própria contribuição mensal da Tendência em cima do acumulado herdado');
});

test('calcularAcumuladoTendencia falls back to accumulating Tendência alone from Jan when there is no Realizado month at all', () => {
  const html = renderComSenha([registroExemplo()]);
  const { calcularAcumuladoTendencia } = extrairFuncoesPuras(html);
  const resultado = calcularAcumuladoTendencia([5, 5, 5], [], -1);
  assert.deepEqual(paraPlano(resultado), [5, 10, 15]);
});

test('indicesFiltrados (extraído do HTML real gerado) returns every index when no filter is active', () => {
  const html = renderComSenha([registroExemplo()]);
  const { indicesFiltrados } = extrairFuncoesPuras(html);
  const registros = [
    { tipologia: 'SM', grupo: 'PÁTRIA', sup: 'SUP-A' },
    { tipologia: 'ST', grupo: 'PÁTRIA', sup: 'SUP-B' },
    { tipologia: 'SM', grupo: 'SYSTRA', sup: 'SUP-C' },
  ];
  assert.deepEqual(paraPlano(indicesFiltrados(registros, new Set(), new Set(), new Set(), new Set())), [0, 1, 2]);
});

test('indicesFiltrados combines tipologia/categoria/grupo/sup with AND semantics, not OR', () => {
  const html = renderComSenha([registroExemplo()]);
  const { indicesFiltrados } = extrairFuncoesPuras(html);
  const registros = [
    { tipologia: 'SM', grupo: 'PÁTRIA', sup: 'SUP-A' },
    { tipologia: 'ST', grupo: 'PÁTRIA', sup: 'SUP-B' },
    { tipologia: 'SM', grupo: 'SYSTRA', sup: 'SUP-C' },
  ];
  assert.deepEqual(paraPlano(indicesFiltrados(registros, new Set(['SM']), new Set(), new Set(), new Set())), [0, 2]);
  assert.deepEqual(paraPlano(indicesFiltrados(registros, new Set(), new Set(), new Set(['PÁTRIA']), new Set())), [0, 1]);
  assert.deepEqual(paraPlano(indicesFiltrados(registros, new Set(['SM']), new Set(), new Set(['PÁTRIA']), new Set())), [0]);
  assert.deepEqual(paraPlano(indicesFiltrados(registros, new Set(), new Set(), new Set(), new Set(['SUP-Z']))), []);
});

test('indicesFiltrados treats multiple values within the SAME filter as OR (Tipologia = SM or ST matches both), while still AND-ing across different filters', () => {
  const html = renderComSenha([registroExemplo()]);
  const { indicesFiltrados } = extrairFuncoesPuras(html);
  const registros = [
    { tipologia: 'SM', grupo: 'PÁTRIA', sup: 'SUP-A' },
    { tipologia: 'ST', grupo: 'PÁTRIA', sup: 'SUP-B' },
    { tipologia: 'PI', grupo: 'PÁTRIA', sup: 'SUP-C' },
    { tipologia: 'SM', grupo: 'SYSTRA', sup: 'SUP-D' },
  ];
  assert.deepEqual(paraPlano(indicesFiltrados(registros, new Set(['SM', 'ST']), new Set(), new Set(), new Set())), [0, 1, 3]);
  assert.deepEqual(paraPlano(indicesFiltrados(registros, new Set(['SM', 'ST']), new Set(), new Set(['PÁTRIA']), new Set())), [0, 1], 'OR dentro de tipologia, AND com grupo -- exclui o SM de SYSTRA');
});

test('categoriaTipologia (extraído do HTML real gerado) classifies LAB.C/LAB.E as their own categories, CPTu/BL/SH/VT as sondagemEspecial, and everything else (SP, SM, ST, PI, unknown values) as sondagemConvencional', () => {
  const html = renderComSenha([registroExemplo()]);
  const { categoriaTipologia } = extrairFuncoesPuras(html);
  assert.equal(categoriaTipologia('LAB.C'), 'labConvencional');
  assert.equal(categoriaTipologia('LAB.E'), 'labEspecial');
  assert.equal(categoriaTipologia('CPTu'), 'sondagemEspecial');
  assert.equal(categoriaTipologia('BL'), 'sondagemEspecial');
  assert.equal(categoriaTipologia('SH'), 'sondagemEspecial');
  assert.equal(categoriaTipologia('VT'), 'sondagemEspecial');
  assert.equal(categoriaTipologia('SP'), 'sondagemConvencional');
  assert.equal(categoriaTipologia('SM / SM.F / SR'), 'sondagemConvencional');
  assert.equal(categoriaTipologia('ST'), 'sondagemConvencional');
  assert.equal(categoriaTipologia('PI'), 'sondagemConvencional');
  assert.equal(categoriaTipologia('algo-desconhecido'), 'sondagemConvencional', 'tipologia não mapeada cai no catch-all "todo o resto", não fica sem categoria');
});

test('cortarAcumuladoNoUltimoDado (extraído do HTML real gerado) nulls out the accumulated Realizado line past the last month with real monthly data, instead of it continuing flat to December', () => {
  const html = renderComSenha([registroExemplo()]);
  const { cortarAcumuladoNoUltimoDado, calcularAcumulado } = extrairFuncoesPuras(html);
  const mensal = [10, 10, 10, null, null, null, null, null, null, null, null, null];
  const acumulado = calcularAcumulado(mensal); // [10,20,30,30,30,30,...] -- reto até dezembro
  const resultado = cortarAcumuladoNoUltimoDado(acumulado, mensal);
  assert.deepEqual(paraPlano(resultado), [10, 20, 30, null, null, null, null, null, null, null, null, null]);
});

test('cortarAcumuladoNoUltimoDado returns an all-null array when the underlying mensal series has no data at all', () => {
  const html = renderComSenha([registroExemplo()]);
  const { cortarAcumuladoNoUltimoDado, calcularAcumulado } = extrairFuncoesPuras(html);
  const mensal = Array(12).fill(null);
  const resultado = cortarAcumuladoNoUltimoDado(calcularAcumulado(mensal), mensal);
  assert.deepEqual(paraPlano(resultado), Array(12).fill(null));
});

test('indicesFiltrados filters by categoria (a derived grouping of tipologia, not a stored field) with the same AND semantics', () => {
  const html = renderComSenha([registroExemplo()]);
  const { indicesFiltrados } = extrairFuncoesPuras(html);
  const registros = [
    { tipologia: 'SP', grupo: 'PÁTRIA', sup: 'SUP-A' }, // sondagemConvencional
    { tipologia: 'CPTu', grupo: 'PÁTRIA', sup: 'SUP-B' }, // sondagemEspecial
    { tipologia: 'LAB.C', grupo: 'SYSTRA', sup: 'SUP-C' }, // labConvencional
    { tipologia: 'LAB.E', grupo: 'SYSTRA', sup: 'SUP-D' }, // labEspecial
  ];
  assert.deepEqual(paraPlano(indicesFiltrados(registros, new Set(), new Set(['sondagemConvencional']), new Set(), new Set())), [0]);
  assert.deepEqual(paraPlano(indicesFiltrados(registros, new Set(), new Set(['sondagemEspecial']), new Set(), new Set())), [1]);
  assert.deepEqual(paraPlano(indicesFiltrados(registros, new Set(), new Set(['labConvencional']), new Set(), new Set())), [2]);
  assert.deepEqual(paraPlano(indicesFiltrados(registros, new Set(), new Set(['labEspecial']), new Set(), new Set())), [3]);
  assert.deepEqual(paraPlano(indicesFiltrados(registros, new Set(), new Set(['labEspecial']), new Set(['PÁTRIA']), new Set())), [], 'AND com grupo -- nenhum registro de PÁTRIA é labEspecial');
});

test('construirGraficoMensalSvg draws 12 columns per série (soma dimension, ehRazao=false) as rounded-top paths, no line in the monthly panel; construirGraficoAcumuladoSvg draws 1 line per série', () => {
  const html = renderComSenha([registroExemplo()]);
  const { construirGraficoMensalSvg, construirGraficoAcumuladoSvg, calcularAcumulado } = extrairFuncoesPuras(html);
  const mensalPrevisto = Array(12).fill(100);
  const mensalRealizado = Array(12).fill(50);
  const dados = [
    { serie: 'previsto', mensal: mensalPrevisto, acumulado: calcularAcumulado(mensalPrevisto) },
    { serie: 'realizado', mensal: mensalRealizado, acumulado: calcularAcumulado(mensalRealizado) },
  ];
  const mensal = construirGraficoMensalSvg(dados, false);
  assert.equal((mensal.svg.match(/<path class="grafico-barra"/g) || []).length, 24);
  assert.equal((mensal.svg.match(/<polyline class="grafico-linha"/g) || []).length, 0);
  assert.match(mensal.svg, /<svg viewBox="0 0 1000 320" class="grafico-svg">/);

  const acumulado = construirGraficoAcumuladoSvg(dados);
  assert.equal((acumulado.svg.match(/<polyline class="grafico-linha"/g) || []).length, 2);
  assert.equal((acumulado.svg.match(/<path class="grafico-barra"/g) || []).length, 0);
  assert.match(acumulado.svg, /<svg viewBox="0 0 1000 280" class="grafico-svg">/);
});

test('construirGraficoMensalSvg draws NO columns for a razão dimension (ehRazao=true), only 1 line per série using the monthly value', () => {
  const html = renderComSenha([registroExemplo()]);
  const { construirGraficoMensalSvg } = extrairFuncoesPuras(html);
  const dados = [{ serie: 'previsto', mensal: Array(12).fill(1.5), acumulado: null }];
  const { svg } = construirGraficoMensalSvg(dados, true);
  assert.equal((svg.match(/<path class="grafico-barra"/g) || []).length, 0);
  assert.equal((svg.match(/<polyline class="grafico-linha"/g) || []).length, 1);
});

test('construirGraficoMensalSvg scales column heights proportionally to their value (guards against a numerator/denominator swap in the Y scale); zero-value months emit no column', () => {
  const html = renderComSenha([registroExemplo()]);
  const { construirGraficoMensalSvg } = extrairFuncoesPuras(html);
  const mensal = [100, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const dados = [{ serie: 'previsto', mensal: mensal, acumulado: mensal }];
  const { svg } = construirGraficoMensalSvg(dados, false);
  // path d = "M{x},{y+h} L{x},{y+r} Q{x},{y} ..." -> height = (y+h) - y
  const alturas = [...svg.matchAll(/<path class="grafico-barra" d="M[\d.]+,([\d.]+) L[\d.]+,[\d.]+ Q[\d.]+,([\d.]+)/g)]
    .map(m => Number(m[1]) - Number(m[2]));
  assert.equal(alturas.length, 2); // meses com valor 0 não geram coluna
  assert.ok(Math.abs(alturas[0] - 2 * alturas[1]) < 0.5, `expected month0 (value 100) column to be ~2x month1 (value 50), got ${alturas[0]} vs ${alturas[1]}`);
});

test('construirGraficoMensalSvg only draws columns for the séries actually passed in (respects an upstream série filter) and in that série color', () => {
  const html = renderComSenha([registroExemplo()]);
  const { construirGraficoMensalSvg, calcularAcumulado } = extrairFuncoesPuras(html);
  const mensal = Array(12).fill(10);
  const dados = [{ serie: 'realizado', mensal: mensal, acumulado: calcularAcumulado(mensal) }];
  const { svg } = construirGraficoMensalSvg(dados, false);
  assert.equal((svg.match(/<path class="grafico-barra"/g) || []).length, 12);
  assert.match(svg, /fill="#7fd858"/); // Realizado's color, confirming the right série was drawn
});

test('construirGraficoMensalSvg draws no column and no hoverable hit-rect for a null month (no data reported), unlike a real reported 0 which still gets a hit-rect', () => {
  const html = renderComSenha([registroExemplo()]);
  const { construirGraficoMensalSvg } = extrairFuncoesPuras(html);
  // Jan=100 (real), Fev=0 (real reported zero), Mar..Dez=null (not reported yet)
  const mensal = [100, 0, null, null, null, null, null, null, null, null, null, null];
  const dados = [{ serie: 'realizado', mensal: mensal, acumulado: mensal }];
  const { svg } = construirGraficoMensalSvg(dados, false);
  assert.equal((svg.match(/<path class="grafico-barra"/g) || []).length, 1, 'só Jan (100) desenha uma barra visível -- Fev é 0 (altura 0) e Mar+ é null');
  assert.equal((svg.match(/<rect class="grafico-hit"/g) || []).length, 2, 'Jan e Fev têm ponto de dado real (hover mostra o valor, inclusive 0) -- os meses null não têm hit-rect nenhum');
});

test('construirGraficoMensalSvg (razão dimension, linha) and construirGraficoAcumuladoSvg break the polyline at a null month instead of drawing a phantom point at the baseline', () => {
  const html = renderComSenha([registroExemplo()]);
  const { construirGraficoMensalSvg, construirGraficoAcumuladoSvg } = extrairFuncoesPuras(html);
  // Dois trechos contínuos de dado real (Jan-Mar e Ago-Set), com um buraco no meio.
  const mensal = [10, 12, 11, null, null, null, null, 9, 10, null, null, null];
  const dados = [{ serie: 'previsto', mensal: mensal, acumulado: mensal }];

  const razao = construirGraficoMensalSvg(dados, true);
  assert.equal((razao.svg.match(/<polyline class="grafico-linha"/g) || []).length, 2, 'um <polyline> por trecho contínuo, não um só ligando todos os 12 meses');
  assert.equal((razao.svg.match(/<circle class="grafico-marcador"/g) || []).length, 5, 'um marcador por mês com dado real (3 + 2), nenhum nos meses null');

  const acumulado = construirGraficoAcumuladoSvg(dados);
  assert.equal((acumulado.svg.match(/<polyline class="grafico-linha"/g) || []).length, 2);
});

test('construirGraficoMensalSvg and construirGraficoAcumuladoSvg emit no numeric label for a zero-value point (real "no data yet" case, e.g. Realizado before any month has actuals) -- a labeled "0" on every empty point is visual clutter, not signal', () => {
  const html = renderComSenha([registroExemplo()]);
  const { construirGraficoMensalSvg, construirGraficoAcumuladoSvg } = extrairFuncoesPuras(html);
  const mensalComZeros = [100, 0, 0, 200, 0, 0, 0, 0, 0, 0, 0, 0];
  const dados = [{ serie: 'previsto', mensal: mensalComZeros, acumulado: mensalComZeros }];

  const mensal = construirGraficoMensalSvg(dados, false);
  assert.equal((mensal.svg.match(/class="grafico-rotulo"/g) || []).length, 2, 'só os 2 meses com valor real (100 e 200) devem ganhar rótulo');

  const acumulado = construirGraficoAcumuladoSvg(dados);
  assert.equal((acumulado.svg.match(/class="grafico-rotulo-final"/g) || []).length, 2, 'mesma regra pro acumulado -- só pontos com valor real ganham rótulo');
});

test('calcularEscalaEixo (extraído do HTML real gerado) rounds the axis max to a tight "nice number" -- must not overshoot to double the real max when an intermediate step (2.5x) already fits it', () => {
  const html = renderComSenha([registroExemplo()]);
  const { calcularEscalaEixo } = extrairFuncoesPuras(html);
  // Caso real: acumulado de dezembro ~85.372,98 -- o degrau ingênuo (1/2/5/10)
  // pula de 2x pra 5x e deixa o eixo em 200.000 (menos da metade do gráfico
  // usada); com o degrau intermediário de 2,5x, o teto fica em 100.000.
  const escala = calcularEscalaEixo(85372.98);
  assert.equal(escala.max, 100000);
  assert.equal(escala.passo, 25000);
});

test('escapeHtml (extraído do HTML real gerado) escapes the same 5 characters as the server-side helper, protecting against markup injection from spreadsheet text once rendered client-side', () => {
  const html = renderComSenha([registroExemplo()]);
  const { escapeHtml } = extrairFuncoesPuras(html);
  assert.equal(escapeHtml('<script>&"'), '&lt;script&gt;&amp;&quot;');
});

test('formatarNumero (extraído do HTML real gerado) rounds to 2 decimal places by default (unchanged behavior for callers that don\'t pass casasDecimais), and to the given number of places when passed explicitly -- 0 for Equipes, which must always show as a whole number', () => {
  const html = renderComSenha([registroExemplo()]);
  const { formatarNumero } = extrairFuncoesPuras(html);
  assert.equal(formatarNumero(4.567), '4,57');
  assert.equal(formatarNumero(4.567, 0), '5');
  assert.equal(formatarNumero(4.4, 0), '4');
  assert.equal(formatarNumero(null, 0), '—');
  assert.equal(formatarNumero(0, 0), '0');
});

test('formatarValorGrafico (extraído do HTML real gerado) rounds to the given casasDecimais the same way as formatarNumero, on top of the milhares scaling', () => {
  const html = renderComSenha([registroExemplo()]);
  const { formatarValorGrafico } = extrairFuncoesPuras(html);
  assert.equal(formatarValorGrafico(4.567, false), '4,57');
  assert.equal(formatarValorGrafico(4.567, false, 0), '5');
  assert.equal(formatarValorGrafico(4500, true, 0), '5', 'em milhares, 4500 -> 4,5 mil -> arredondado a 0 casas -> "5"');
});

test('construirGraficoMensalSvg rounds column/axis/tooltip labels to 0 decimal places for Equipes (casasDecimais=0), while a dimension without it passed keeps the default 2 decimals', () => {
  const html = renderComSenha([registroExemplo()]);
  const { construirGraficoMensalSvg } = extrairFuncoesPuras(html);
  const mensal = [4.567, 3.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const dados = [{ serie: 'previsto', mensal: mensal, acumulado: mensal }];

  const comCasasZero = construirGraficoMensalSvg(dados, false, 0);
  assert.match(comCasasZero.svg, /class="grafico-rotulo"[^>]*>5</, 'rótulo da coluna de Jan (4,567) arredondado pra "5", não "4,57"');
  assert.match(comCasasZero.svg, /data-tooltip="Jan · Previsto: 5"/, 'tooltip também arredonda pra inteiro em Equipes -- não faz sentido revelar fração de equipe nem no hover');

  const semArgumento = construirGraficoMensalSvg(dados, false);
  assert.match(semArgumento.svg, /class="grafico-rotulo"[^>]*>4,57</, 'sem casasDecimais, mantém o comportamento de sempre (2 casas)');
});

test('parseCsvGrid (extraído do HTML real gerado) splits a simple CSV into rows/cells, and keeps a comma inside a quoted field from splitting it (real case: quoted numbers/fields in the published mirror CSV)', () => {
  const html = renderComSenha([registroExemplo()]);
  const { parseCsvGrid } = extrairFuncoesPuras(html);
  const grid = parseCsvGrid('a,b,c\n"1,5",d,"has ""quotes"" inside"\n');
  assert.deepEqual(paraPlano(grid[0]), ['a', 'b', 'c']);
  assert.deepEqual(paraPlano(grid[1]), ['1,5', 'd', 'has "quotes" inside']);
});

test('parseCsvGrid handles \\r\\n line endings and a final line with no trailing newline', () => {
  const html = renderComSenha([registroExemplo()]);
  const { parseCsvGrid } = extrairFuncoesPuras(html);
  const grid = parseCsvGrid('a,b\r\nc,d');
  assert.deepEqual(paraPlano(grid), [['a', 'b'], ['c', 'd']]);
});

test('numeroPtBr (extraído do HTML real gerado) parses a pt-BR comma-decimal number, and treats blank/formula-error/n-a cells as null -- never as 0 (real case: the mirror Sheet\'s CSV export uses "," for decimals and shows "#NAME?" where an Excel formula didn\'t convert cleanly to Sheets)', () => {
  const html = renderComSenha([registroExemplo()]);
  const { numeroPtBr } = extrairFuncoesPuras(html);
  assert.equal(numeroPtBr('11,79377778'), 11.79377778);
  assert.equal(numeroPtBr('815729,9525'), 815729.9525);
  assert.equal(numeroPtBr(''), null);
  assert.equal(numeroPtBr(null), null);
  assert.equal(numeroPtBr(undefined), null);
  assert.equal(numeroPtBr('#NAME?'), null);
  assert.equal(numeroPtBr('#REF!'), null);
  assert.equal(numeroPtBr('n/a'), null);
  assert.equal(numeroPtBr('0'), 0);
});

test('parseMatrizClient (extraído do HTML real gerado) parses a CSV grid shaped like the real mirror export (pt-BR comma-decimals quoted, P/R/T triad, Todos block skipped) into the same registro shape as the server-side parseMatriz', () => {
  const html = renderComSenha([registroExemplo()]);
  const { parseMatrizClient, parseCsvGrid } = extrairFuncoesPuras(html);

  // Uma célula com vírgula decimal precisa vir entre aspas na linha CSV
  // (senão a vírgula quebra o campo em dois) -- igual à exportação real.
  function celula(v) { return String(v).indexOf(',') === -1 ? v : '"' + v + '"'; }
  function linha(campos) { return campos.map(celula).join(','); }

  const cabecalho = linha(
    ['', 'ORIGEM', 'GRUPO', 'TOMADOR', 'SUP', 'ESCOPO', 'APOIO', 'INICIO', 'TERMINO', 'SONDAGEM', 'Demanda à cadastrar', 'Demanda Cadastrada', 'BASE']
      .concat(Array(12).fill('01/01/2026'))
      .concat(['PICO', 'MÉDIA', 'PROD.', 'DIAS'])
      .concat(Array(12).fill('01/01/2026'))
      .concat(['TOTAL', 'TOTAL INICIAL', 'TICKET'])
      .concat(Array(12).fill('01/01/2026'))
      .concat(['TOTAL', 'TOTAL INICIAL', 'OBSERVAÇÃO'])
  );
  const linhaTodos = linha(
    ['', 'CONTRATO VIGENTE', 'Todos', 'Todos', 'Todos', 'Todos', 'Todos', 'Todos', 'Todos', 'SP', '', '0', 'P']
      .concat(Array(46).fill('99'))
  );
  function linhaContrato(base, equipesValor) {
    return linha(
      ['', 'CONTRATO VIGENTE', 'PÁTRIA', 'Via Araucária', 'SUP-1', 'Bloco 1', 'Apoio', '27/05/2024', '27/05/2029', 'SP', '', '0', base]
        .concat(Array(12).fill(equipesValor)) // equipesMeses
        .concat([equipesValor, '0', '0', '25']) // PICO/MÉDIA/PROD./DIAS
        .concat(Array(12).fill('10')) // volumeMeses
        .concat(['120', '0', '1885']) // volume TOTAL/TOTAL INICIAL/TICKET
        .concat(Array(12).fill(equipesValor)) // financeiroMeses
        .concat(['999', '0', 'Nota']) // financeiro TOTAL/TOTAL INICIAL/OBSERVAÇÃO
    );
  }
  const texto = [cabecalho, linhaTodos, linhaContrato('P', '4,5'), linhaContrato('R', '3,2'), linhaContrato('T', '0')].join('\n');
  const grid = parseCsvGrid(texto);
  const registros = parseMatrizClient(grid);

  assert.equal(registros.length, 1, 'a linha Todos deve ser ignorada, sobrando só o contrato real');
  assert.equal(registros[0].grupo, 'PÁTRIA');
  assert.equal(registros[0].sup, 'SUP-1');
  assert.equal(registros[0].tipologia, 'SP');
  assert.deepEqual(paraPlano(registros[0].previsto.equipes), Array(12).fill(4.5));
  assert.deepEqual(paraPlano(registros[0].realizado.equipes), Array(12).fill(3.2));
  assert.equal(registros[0].observacao, 'Nota');
});
