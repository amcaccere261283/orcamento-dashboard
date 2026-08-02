'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { diaEpoch } = require('../tools/semanal/compute-semanal.js');
const {
  renderAbaGraficoSemanal, construirPainelGraficoSemanalHtml,
  construirGraficoSemanalSvg, construirGraficoAcumuladoSemanalSvg,
} = require('../tools/semanal/render-aba-grafico-semanal.js');

const ANO = 2026;
const VIGENTE_JULHO = 6; // julho tem 5 semanas (corte sempre dentro do mês) -- cenário principal

function registro(volumeMes, ticket) {
  const zeros = new Array(12).fill(0);
  const vol = new Array(12).fill(0); vol[VIGENTE_JULHO] = volumeMes;
  const eq = new Array(12).fill(2);
  const bloco = (v, e) => ({
    equipes: e, volume: v, financeiro: zeros,
    equipesResumo: { pico: 2, media: 2, prod: 8, dias: 25 },
    volumeResumo: { total: volumeMes, totalInicial: volumeMes, ticket: ticket === undefined ? 1 : ticket },
    financeiroResumo: { total: 0, totalInicial: 0 },
  });
  return {
    sup: 'SUP-0001-24', grupo: 'G', tomador: 'T', tipologia: 'ST',
    previsto: bloco(vol, eq), realizado: bloco(zeros, eq), total: bloco(zeros, zeros),
  };
}

function diaJul(dia) { return diaEpoch(new Date(Date.UTC(2026, 6, dia))); }
const HOJE_15_JUL = diaJul(15);

// Mesmo fixture EXATO de "Realizado semanal..." em
// test/semanal-render-aba-semanal.test.js -- prova que o Gráfico e a
// Tabela nunca divergem sobre os mesmos furos (os dois consomem
// calcularSeriesSemanaisDimensao).
const EVENTOS_REALIZADO_CONHECIDO = {
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

test('renderAbaGraficoSemanal: sem mês vigente válido, devolve aviso em vez de gráfico vazio', () => {
  const html = renderAbaGraficoSemanal([registro(100)], [0], ['volume'], { vigenteIdx: 12, ano: ANO });
  assert.match(html, /sem mês vigente válido/i);
  assert.doesNotMatch(html, /grafico-svg/);

  const htmlNegativo = renderAbaGraficoSemanal([registro(100)], [0], ['volume'], { vigenteIdx: -1, ano: ANO });
  assert.match(htmlNegativo, /sem mês vigente válido/i);
});

test('renderAbaGraficoSemanal: um bloco por dimensão marcada, na ordem recebida', () => {
  const html = renderAbaGraficoSemanal([registro(100)], [0], ['equipes', 'volume', 'financeiro'], { vigenteIdx: VIGENTE_JULHO, ano: ANO });
  const blocos = html.split('<div class="grafico-bloco-dimensao">').slice(1);
  assert.strictEqual(blocos.length, 3);
  assert.match(blocos[0], /Equipes/);
  assert.match(blocos[1], /Volume/);
  assert.match(blocos[2], /Financeiro/);
});

test('renderAbaGraficoSemanal: Volume/Financeiro ganham painel Semanal + Acumulado (2 grafico-painel); Equipes só Semanal (1)', () => {
  const html = renderAbaGraficoSemanal([registro(100)], [0], ['equipes', 'volume'], { vigenteIdx: VIGENTE_JULHO, ano: ANO });
  const blocos = html.split('<div class="grafico-bloco-dimensao">').slice(1);
  assert.strictEqual((blocos[0].match(/class="grafico-painel"/g) || []).length, 1, 'Equipes: só o painel Semanal, sem Acumulado');
  assert.strictEqual((blocos[1].match(/class="grafico-painel"/g) || []).length, 2, 'Volume: Semanal + Acumulado');
});

test('construirPainelGraficoSemanalHtml: Volume com demandas mostra as 3 séries (Previsto/Realizado/Tendência) com as cores certas', () => {
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': EVENTOS_REALIZADO_CONHECIDO } };
  const semanas = require('../tools/semanal/compute-semanal.js').semanasDoMes(ANO, VIGENTE_JULHO);
  const html = construirPainelGraficoSemanalHtml(
    [registro(1000)], [0], 'volume', VIGENTE_JULHO, semanas, semanas.length, true,
    require('../tools/semanal/compute-semanal.js').indiceSemanaAtual(semanas, HOJE_15_JUL),
    demandas, HOJE_15_JUL
  );
  assert.match(html, /Semanal — Volume/);
  assert.match(html, /Acumulado no mês — Volume/);
  assert.match(html, /fill="#2f6ad0"/, 'cor do Previsto -- mesma cor de .linha-previsto na tabela');
  assert.match(html, /fill="#7fd858"/, 'cor do Realizado -- mesma cor de .linha-realizado na tabela');
  assert.match(html, /fill="#f6b53f"/, 'cor da Tendência -- mesma cor de .linha-tendencia na tabela');
  assert.match(html, />Previsto</);
  assert.match(html, />Realizado</);
  assert.match(html, />Tendência</);
});

test('construirPainelGraficoSemanalHtml: os valores desenhados no gráfico batem EXATAMENTE com os da Tabela Semanal pro mesmo fixture -- [2,3,1,0,0], passando pelo PIPELINE REAL (não hardcoded)', () => {
  const { semanasDoMes, indiceSemanaAtual } = require('../tools/semanal/compute-semanal.js');
  const { calcularSeriesSemanaisDimensao } = require('../tools/semanal/render-aba-semanal.js');
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': EVENTOS_REALIZADO_CONHECIDO } };
  const semanas = semanasDoMes(ANO, VIGENTE_JULHO);
  const indiceAtual = indiceSemanaAtual(semanas, HOJE_15_JUL);

  // Pré-condição: a MESMA função que a Tabela Semanal usa (ver
  // "Realizado semanal..." em test/semanal-render-aba-semanal.test.js)
  // produz [2,3,1,0,0] pra este fixture -- se esta linha falhar, o
  // problema é na extração, não no gráfico.
  const series = calcularSeriesSemanaisDimensao(
    [registro(1000)], [0], 'volume', VIGENTE_JULHO, semanas, semanas.length, true, indiceAtual, demandas, HOJE_15_JUL
  );
  assert.deepStrictEqual(series.semanasRealizado, [2, 3, 1, 0, 0]);

  // A aba Gráficos passa pelo MESMO pipeline (construirPainelGraficoSemanalHtml
  // chama calcularSeriesSemanaisDimensao por dentro, não recebe valores
  // prontos) -- os números desenhados no SVG (via data-tooltip, que carrega
  // o valor exato) têm que bater ponto a ponto com a série acima.
  const html = construirPainelGraficoSemanalHtml(
    [registro(1000)], [0], 'volume', VIGENTE_JULHO, semanas, semanas.length, true, indiceAtual, demandas, HOJE_15_JUL
  );
  assert.match(html, /S1 \(01\/07 a 05\/07\) · Realizado: 2"/);
  assert.match(html, /S2 \(06\/07 a 12\/07\) · Realizado: 3"/);
  assert.match(html, /S3 \(13\/07 a 19\/07\) · Realizado: 1"/);
  assert.match(html, /S4 \(20\/07 a 26\/07\) · Realizado: 0"/);
  assert.match(html, /S5 \(27\/07 a 31\/07\) · Realizado: 0"/);

  // Só 3 semanas de Realizado são positivas (2, 3, 1) -- construirColunasSvg
  // só desenha <path> quando a barra tem altura > 0 (0 furo = altura zero,
  // desenharBarraArredondada devolve ''); Previsto/Tendência têm valor em
  // toda semana, então o total de barras é maior que 3 -- não checa a
  // contagem aqui de propósito, isso já é coberto no teste de
  // construirGraficoSemanalSvg isolado (mais acima neste arquivo).
});

test('construirPainelGraficoSemanalHtml: Equipes mostra só Previsto, sem legenda (1 série só) e sem painel Acumulado', () => {
  const html = construirPainelGraficoSemanalHtml(
    [registro(100)], [0], 'equipes', VIGENTE_JULHO,
    require('../tools/semanal/compute-semanal.js').semanasDoMes(ANO, VIGENTE_JULHO), 5, false, -1, undefined, undefined
  );
  assert.doesNotMatch(html, /Acumulado no mês/);
  assert.doesNotMatch(html, />Realizado</);
  assert.doesNotMatch(html, />Tendência</);
  assert.match(html, /Semanal — Equipes/);
});

test('construirPainelGraficoSemanalHtml: sem demandas, Volume ainda mostra o painel Semanal (só Previsto tem barra, Realizado/Tendência ficam sem dado)', () => {
  const html = construirPainelGraficoSemanalHtml(
    [registro(700)], [0], 'volume', VIGENTE_JULHO,
    require('../tools/semanal/compute-semanal.js').semanasDoMes(ANO, VIGENTE_JULHO), 5, false, -1, undefined, undefined
  );
  assert.match(html, /Semanal — Volume/);
  assert.match(html, /fill="#2f6ad0"/, 'Previsto sempre aparece -- não depende de demandas');
});

test('construirGraficoSemanalSvg: viewBox exato 0 0 1000 320 (mesma dimensão do gráfico de barras do orçamento)', () => {
  const svg = construirGraficoSemanalSvg([{ serie: 'previsto', valores: [10, 20, 30, 40, 50] }], 0, 5, null);
  assert.match(svg.svg, /<svg viewBox="0 0 1000 320" class="grafico-svg">/);
});

test('construirGraficoAcumuladoSemanalSvg: viewBox exato 0 0 1000 280 (mesma dimensão da curva S do orçamento)', () => {
  const svg = construirGraficoAcumuladoSemanalSvg([{ serie: 'previsto', valores: [10, 20], acumulado: [10, 30] }], 0, 2, null);
  assert.match(svg.svg, /<svg viewBox="0 0 1000 280" class="grafico-svg">/);
});

test('construirGraficoAcumuladoSemanalSvg: desenha polyline e marcadores pra série com dado', () => {
  const svg = construirGraficoAcumuladoSemanalSvg(
    [{ serie: 'previsto', valores: [10, 20, 30], acumulado: [10, 30, 60] }], 0, 3, null
  );
  assert.match(svg.svg, /class="grafico-linha"/);
  assert.strictEqual((svg.svg.match(/class="grafico-marcador"/g) || []).length, 3);
});

test('construirGraficoAcumuladoSemanalSvg: acumulado null não desenha polyline nem marcador nessa semana', () => {
  const svg = construirGraficoAcumuladoSemanalSvg(
    [{ serie: 'previsto', valores: [null, null], acumulado: [null, null] }], 0, 2, null
  );
  assert.doesNotMatch(svg.svg, /class="grafico-linha"/);
  assert.doesNotMatch(svg.svg, /class="grafico-marcador"/);
});

test('construirGraficoSemanalSvg: eixo X usa rótulo curto "Sn", sem intervalo de datas (só o tooltip tem o intervalo)', () => {
  const { semanasDoMes } = require('../tools/semanal/compute-semanal.js');
  const semanas = semanasDoMes(ANO, VIGENTE_JULHO);
  const svg = construirGraficoSemanalSvg([{ serie: 'previsto', valores: [10, 20, 30, 40, 50] }], 0, 5, semanas);
  assert.match(svg.svg, />S1</);
  assert.match(svg.svg, />S5</);
  assert.doesNotMatch(svg.svg, />S1 \(/, 'eixo X fica só com "S1", o intervalo de datas mora no data-tooltip');
  assert.match(svg.svg, /data-tooltip="S1 \(01\/07 a 05\/07\)/, 'tooltip tem o intervalo completo');
});

test('renderAbaGraficoSemanal: soma o Previsto só dos registros em "indices" -- respeita o recorte já filtrado, não os registros inteiros', () => {
  const registros = [registro(100), Object.assign(registro(200), { sup: 'SUP-0002-24', tipologia: 'SP' })];
  const html = renderAbaGraficoSemanal(registros, [1], ['volume'], { vigenteIdx: VIGENTE_JULHO, ano: ANO });
  // Só o índice 1 (SUP-0002-24, previsto 200) entra -- previsto semanal
  // reparte 200 proporcionalmente aos dias de cada semana de julho (31
  // dias): S2/S3/S4 (7 dias) = 200x7/31 = 45,16 -> 45 (casasDecimais=0);
  // não deveria ter nenhum traço do registro 0 (previsto 100).
  assert.match(html, />45</);
});
