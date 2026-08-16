'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { diaEpoch } = require('../tools/semanal/compute-semanal.js');
const {
  renderAbaGraficoSemanal, construirPainelGraficoSemanalHtml,
  construirGraficoSemanalSvg, construirGraficoAcumuladoSemanalSvg,
  chegadasSemanaisPorIndices,
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

test('construirPainelGraficoSemanalHtml: Volume mostra as 4 séries (Previsto/Realizado/Tendência/Demandas) com as cores certas', () => {
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
  assert.match(html, /#9700DA/, 'cor de Demandas -- a 4ª série, só nesta dimensão');
  assert.match(html, />Demandas</);
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
  // desenharBarraArredondada devolve ''). Previsto tem valor em toda
  // semana; Tendência fica sem-dado só nas semanas TOTALMENTE fechadas
  // (S1/S2 aqui, hoje=15/07 dentro de S3 -- achado de 2026-08-03: a semana
  // vigente projeta seu próprio total em vez de ficar sem-dado) e S3/S4/S5
  // desenham barra -- não checa a contagem aqui de propósito, isso já é
  // coberto no teste de construirGraficoSemanalSvg isolado (mais acima
  // neste arquivo).
});

// Achado da revisão final (2026-08-02): o painel Semanal (barras) e o
// painel Acumulado (curva S) usam a MESMA série de Tendência, mas com
// tratamentos diferentes -- o de barras precisa da versão SUPRIMIDA (pra
// não desenhar barra nas semanas TOTALMENTE fechadas), o Acumulado precisa
// da versão COMPLETA (calcularAcumulado trata null como "ainda não começou
// a acumular" -- acumular a versão suprimida faria a curva reiniciar do
// zero na 1ª semana futura, perdendo o que já foi realizado). Este teste
// prova que o ponto final da curva Acumulada de Tendência bate com o
// Fechamento que a Tabela Semanal mostra, mesmo com as semanas fechadas
// suprimidas no painel de barras.
test('construirPainelGraficoSemanalHtml: o ponto final da curva Acumulada de Tendência bate com o Fechamento da Tabela Semanal, mesmo com as semanas fechadas suprimidas no painel de barras', () => {
  const { calcularSeriesSemanaisDimensao } = require('../tools/semanal/render-aba-semanal.js');
  const { semanasDoMes, indiceSemanaAtual } = require('../tools/semanal/compute-semanal.js');
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': EVENTOS_REALIZADO_CONHECIDO } };
  const semanas = semanasDoMes(ANO, VIGENTE_JULHO);
  const indiceAtual = indiceSemanaAtual(semanas, HOJE_15_JUL);

  const series = calcularSeriesSemanaisDimensao(
    [registro(1000)], [0], 'volume', VIGENTE_JULHO, semanas, semanas.length, true, indiceAtual, demandas, HOJE_15_JUL
  );
  // Pré-condição: confirma que este fixture tem semanas TOTALMENTE fechadas
  // suprimidas na tabela (senão o teste não provaria nada) e um Fechamento
  // de verdade calculado. Hoje=15/07 está dentro de S3 (vigente, em curso)
  // -- só S1/S2 (fim < hoje) estão totalmente fechadas; S3 mostra sua
  // própria projeção (achado de 2026-08-03), não fica sem-dado.
  assert.deepStrictEqual(series.semanasTendencia.slice(0, 2), [null, null], 'S1/S2 precisam estar suprimidas pra este teste fazer sentido');
  assert.ok(typeof series.semanasTendencia[2] === 'number', 'S3 (vigente) mostra sua própria projeção, não fica sem-dado');
  assert.ok(typeof series.fechamentoTendencia === 'number' && series.fechamentoTendencia > 0);

  const html = construirPainelGraficoSemanalHtml(
    [registro(1000)], [0], 'volume', VIGENTE_JULHO, semanas, semanas.length, true, indiceAtual, demandas, HOJE_15_JUL
  );
  const tooltipsAcumuladoTendencia = [...html.matchAll(/data-tooltip="([^"]*Tendência: [^"]*)"/g)].map((m) => m[1]);
  // ATUALIZADO em 2026-08-03: a curva Acumulada de Tendência deixou de cobrir
  // as 5 semanas. Ela nasce no ponto de junção (S3, a semana em curso, que não
  // ganha marcador nem tooltip próprios -- o Realizado já desenha os dele ali)
  // e só tem ponto próprio nas semanas futuras, S4 e S5. Antes eram 5 pontos,
  // e os 3 primeiros corriam por cima do Realizado repetindo os mesmos números.
  //
  // O que NÃO mudou, e é o ponto deste teste: S5 continua sendo o projetado do
  // mês inteiro, igual ao Fechamento da Tabela Semanal. O recorte muda de onde
  // a linha parte, não quanto ela soma.
  const tooltipsPainelAcumulado = tooltipsAcumuladoTendencia.slice(-2); // últimos = os do painel Acumulado (o de barras vem primeiro no HTML)
  assert.strictEqual(tooltipsPainelAcumulado.length, 2, 'só S4/S5 têm ponto próprio de Tendência no Acumulado');
  assert.match(tooltipsPainelAcumulado[0], /^S4 /, 'o primeiro ponto próprio é a primeira semana FUTURA, não a em curso');
  const valorFinal = tooltipsPainelAcumulado[1].match(/Tendência: ([\d.]+)$/)[1].replace(/\./g, '');
  assert.strictEqual(Number(valorFinal), Math.round(series.fechamentoTendencia),
    'o ponto final (S5) da curva Acumulada precisa bater com o Fechamento da Tabela Semanal');
});

test('construirPainelGraficoSemanalHtml: no Acumulado o Realizado morre na semana em curso, não segue reto até o fim do mês', () => {
  const { semanasDoMes, indiceSemanaAtual } = require('../tools/semanal/compute-semanal.js');
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': EVENTOS_REALIZADO_CONHECIDO } };
  const semanas = semanasDoMes(ANO, VIGENTE_JULHO);
  const indiceAtual = indiceSemanaAtual(semanas, HOJE_15_JUL);

  const html = construirPainelGraficoSemanalHtml(
    [registro(1000)], [0], 'volume', VIGENTE_JULHO, semanas, semanas.length, true, indiceAtual, demandas, HOJE_15_JUL
  );
  const semanasComRealizado = [...html.matchAll(/data-tooltip="(S\d)[^"]*Realizado: [^"]*"/g)].map((m) => m[1]);
  // O painel de barras desenha as 5 (semanasRealizado traz 0 nas futuras, e
  // uma barra zero ainda é um dado: "nada aconteceu"). Já a CURVA acumulada
  // não pode seguir reta em S4/S5 -- ali não há nada realizado, e uma linha
  // horizontal se lê como "o total parou de crescer".
  const noAcumulado = semanasComRealizado.slice(-3);
  assert.deepStrictEqual(noAcumulado, ['S1', 'S2', 'S3'],
    'a curva de Realizado vai até a semana em curso (S3) e para');
});

test('construirPainelGraficoSemanalHtml: Equipes sem demandas/mês-vigente-real mostra as 3 séries na legenda (mesmo padrão de Volume/Financeiro, 2026-08-07), mas sem barra nem tooltip de Realizado/Tendência -- e continua sem painel Acumulado', () => {
  const html = construirPainelGraficoSemanalHtml(
    [registro(100)], [0], 'equipes', VIGENTE_JULHO,
    require('../tools/semanal/compute-semanal.js').semanasDoMes(ANO, VIGENTE_JULHO), 5, false, -1, undefined, undefined
  );
  assert.doesNotMatch(html, /Acumulado no mês/, 'Equipes é foto, não fluxo -- sem painel Acumulado, mesmo com as 3 séries na Semanal');
  assert.match(html, />Realizado</, 'legenda lista as 3 séries -- mesmo padrão de Volume/Financeiro desde 2026-08-07');
  assert.match(html, />Tendência</);
  assert.doesNotMatch(html, /Realizado: /, 'sem temSemanasReais nenhuma barra/tooltip de Realizado é desenhada -- só a legenda existe');
  assert.doesNotMatch(html, /Tendência: /, 'idem para Tendência');
  assert.match(html, /Semanal — Equipes/);
});

test('construirPainelGraficoSemanalHtml: com mês vigente real, Equipes desenha barras de Realizado (de demandas.equipesPorDia, por SUP+tipologia desde 2026-08-08) e Tendência (de registro.total.equipes)', () => {
  const semanas = require('../tools/semanal/compute-semanal.js').semanasDoMes(ANO, VIGENTE_JULHO);
  // Todos os 5 dias de S1 (01/07 a 05/07) com o mesmo valor (3): fecha em 3
  // -- ver somarEquipesNoIntervalo em render-aba-semanal.js (soma por dia
  // através dos registros, depois média sobre os dias da JANELA, não só os
  // dias com dado). S2..S5 ficam sem-dado (nenhum dia com produção),
  // inclusive S3 (a semana vigente, hoje=15/07) -- valor exato já travado no
  // teste de compute-level em semanal-render-aba-semanal.test.js; aqui só
  // prova que o Gráfico desenha a barra/tooltip com o mesmo número.
  const equipesPorDia = {
    'SUP-0001-24||ST': {
      [diaJul(1)]: 3, [diaJul(2)]: 3, [diaJul(3)]: 3, [diaJul(4)]: 3, [diaJul(5)]: 3,
    },
  };
  const demandas = { porRegistroEventos: {}, equipesPorDia };
  const registroComTendencia = registro(100);
  registroComTendencia.total.equipes = new Array(12).fill(0);
  registroComTendencia.total.equipes[VIGENTE_JULHO] = 5;
  const html = construirPainelGraficoSemanalHtml(
    [registroComTendencia], [0], 'equipes', VIGENTE_JULHO, semanas, 5, true,
    require('../tools/semanal/compute-semanal.js').indiceSemanaAtual(semanas, HOJE_15_JUL), demandas, HOJE_15_JUL
  );
  assert.match(html, /Realizado: 3/, 'S1 fecha em 3 (único dia com retrato)');
  assert.match(html, /Tendência: 5/, 'repete o Total do mês (5) em cada semana, igual ao Previsto');
  assert.doesNotMatch(html, /Acumulado no mês/, 'continua sem painel Acumulado pra Equipes');
});

test('construirPainelGraficoSemanalHtml: sem demandas, Volume ainda mostra o painel Semanal (só Previsto tem barra, Realizado/Tendência ficam sem dado)', () => {
  const html = construirPainelGraficoSemanalHtml(
    [registro(700)], [0], 'volume', VIGENTE_JULHO,
    require('../tools/semanal/compute-semanal.js').semanasDoMes(ANO, VIGENTE_JULHO), 5, false, -1, undefined, undefined
  );
  assert.match(html, /Semanal — Volume/);
  assert.match(html, /fill="#2f6ad0"/, 'Previsto sempre aparece -- não depende de demandas');
});

// Regressão (2026-08-06, pedido do dono do projeto): o gráfico dividia por
// mil e escrevia "(em milhares)" no título assim que o maior valor da série
// batia 1000 -- comportamento removido de propósito (GRAFICO_LIMIAR_MILHARES
// continua no arquivo, só nunca mais é atingido). Agora mostra sempre o
// número cheio, agrupado por milhar via toLocaleString('pt-BR') ("4.415"),
// mesmo padrão que a Tabela Semanal já usa.
test('construirGraficoSemanalSvg: valor >= 1000 não divide mais por mil -- mostra o número cheio agrupado, milhares sempre false', () => {
  const svg = construirGraficoSemanalSvg([{ serie: 'previsto', valores: [4415, 2000, 0, 0, 0] }], 0, 5, null);
  assert.strictEqual(svg.milhares, false);
  assert.match(svg.svg, />4\.415</, 'rótulo da coluna precisa mostrar o valor cheio agrupado, não "4" ou "4,4"');
  assert.doesNotMatch(svg.svg, />4</, 'não pode sobrar um rótulo dividido por mil (ex.: "4" de 4415/1000)');
});

test('construirGraficoAcumuladoSemanalSvg: valor acumulado >= 1000 não divide mais por mil', () => {
  const svg = construirGraficoAcumuladoSemanalSvg(
    [{ serie: 'previsto', valores: [4415], acumulado: [4415] }], 0, 1, null
  );
  assert.strictEqual(svg.milhares, false);
  assert.match(svg.svg, />4\.415</);
});

test('construirPainelGraficoSemanalHtml: título nunca mais mostra "(em milhares)", mesmo com Previsto do mês muito acima de 1000', () => {
  const { semanasDoMes } = require('../tools/semanal/compute-semanal.js');
  const semanas = semanasDoMes(ANO, VIGENTE_JULHO);
  const registros = [registro(50000)]; // bem acima do antigo limiar de 1000
  const html = construirPainelGraficoSemanalHtml(
    registros, [0], 'volume', VIGENTE_JULHO, semanas, semanas.length,
    false, -1, null, null
  );
  assert.doesNotMatch(html, /em milhares/i);
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

// --- Ponto de junção Realizado -> Tendência no Acumulado (2026-08-03) -------

test('no ponto de junção do Acumulado só uma série desenha marcador e rótulo -- não dois por cima do outro', () => {
  // Realizado morre na semana 2 (índice 1) e a Tendência nasce ali, no MESMO
  // x,y. Sem indiceConector saem dois <circle> marcadores empilhados e dois
  // rótulos com o mesmo número, um em cima do outro. Quem desenha os dois é o
  // Realizado; a Tendência só usa o ponto para a linha partir dali.
  const dados = [
    { serie: 'realizado', valores: [10, 20, 0, 0], acumulado: [10, 30, null, null] },
    { serie: 'tendencia', valores: [null, null, 25, 25], acumulado: [null, 30, 55, 80], indiceConector: 1 },
  ];
  const { svg } = construirGraficoAcumuladoSemanalSvg(dados, 0, 4, null);

  const marcadores = [...svg.matchAll(/<circle class="grafico-marcador"[^>]*cx="([0-9.]+)" cy="([0-9.]+)"/g)]
    .map((m) => m[1] + ',' + m[2]);
  const duplicados = marcadores.filter((p, i) => marcadores.indexOf(p) !== i);
  assert.deepStrictEqual(duplicados, [], `dois marcadores no mesmo ponto: ${duplicados}`);

  // A linha da Tendência ainda TEM que passar pelo ponto de junção -- é dele
  // que ela parte. Suprimir o marcador não pode ter suprimido o vértice.
  const linhas = [...svg.matchAll(/<polyline class="grafico-linha" points="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(linhas.some((pts) => pts.split(' ').length === 3),
    'a Tendência tem que ser uma polilinha de 3 pontos (junção + 2 semanas futuras)');
});

// --- Task 1: chegadas por semana -----------------------------------------

const SEMANAS_JULHO = require('../tools/semanal/compute-semanal.js').semanasDoMes(ANO, VIGENTE_JULHO);

// S1=dias 1-5, S2=6-12, S3=13-19, S4=20-26, S5=27-31 -> [2,2,1,1,1]
const EVENTOS_CHEGADAS = {
  chegada: [diaJul(1), diaJul(3), diaJul(8), diaJul(8), diaJul(15), diaJul(25), diaJul(28)],
  sondagemRealizada: [], saidaEstoque: [],
};

test('chegadasSemanaisPorIndices: bucketiza as chegadas nas semanas certas do mês', () => {
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': EVENTOS_CHEGADAS } };
  const resultado = chegadasSemanaisPorIndices([registro(100)], [0], demandas, SEMANAS_JULHO);
  assert.deepStrictEqual(resultado, [2, 2, 1, 1, 1]);
});

// Achado da revisão final de 2026-08-15: o lado 'inicio' do bucketing
// ('dia >= semanas[s].inicio') já era travado por outro teste (mutar '>='
// pra '>' quebra 5 testes da suíte inteira), mas o lado 'fim'
// ('dia <= semanas[s].fim') não tinha NENHUMA cobertura -- mutar '<=' pra
// '<' deixava a suíte inteira verde. Semanas são contíguas (cursor =
// fimSemana + 1, compute-semanal.js), então um evento exatamente no 'fim'
// de uma semana ficaria SEM bucket nenhum -- silenciosamente descartado,
// não empurrado pra semana seguinte. Medido: 11 das 11.505 chegadas reais
// de julho/2026 caem exatamente num 'fim' de semana.
// Extensão do fixture acima (concat, sem mutar EVENTOS_CHEGADAS -- ele é
// compartilhado com outros testes) com os dois dias de fronteira reais
// deste calendário: 12/07/2026 é o 'fim' de S2 (06/07 a 12/07), e
// 31/07/2026 é o 'fim' de S5, último dia do mês.
test('chegadasSemanaisPorIndices: chegada exatamente no ÚLTIMO dia de uma semana ("fim", inclusive) cai nela, não fica sem bucket', () => {
  const eventosComFronteira = {
    chegada: EVENTOS_CHEGADAS.chegada.concat([diaJul(12), diaJul(31)]),
    sondagemRealizada: [], saidaEstoque: [],
  };
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': eventosComFronteira } };
  const resultado = chegadasSemanaisPorIndices([registro(100)], [0], demandas, SEMANAS_JULHO);
  // Fixture original [2,2,1,1,1] + 1 em S2 (12/07) + 1 em S5 (31/07).
  assert.deepStrictEqual(resultado, [2, 3, 1, 1, 2]);
});

test('chegadasSemanaisPorIndices: semana sem chegada é 0, nunca null -- é contagem medida', () => {
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': { chegada: [diaJul(15)], sondagemRealizada: [], saidaEstoque: [] } } };
  const resultado = chegadasSemanaisPorIndices([registro(100)], [0], demandas, SEMANAS_JULHO);
  assert.deepStrictEqual(resultado, [0, 0, 1, 0, 0]);
  resultado.forEach((v) => assert.strictEqual(typeof v, 'number'));
});

test('chegadasSemanaisPorIndices: respeita indices -- registro fora do filtro não conta', () => {
  const outro = registro(100); outro.sup = 'SUP-0002-24';
  const demandas = {
    porRegistroEventos: {
      'SUP-0001-24||ST': EVENTOS_CHEGADAS,
      'SUP-0002-24||ST': EVENTOS_CHEGADAS,
    },
  };
  // Só o índice 0 passa no filtro: conta uma vez, não duas.
  assert.deepStrictEqual(chegadasSemanaisPorIndices([registro(100), outro], [0], demandas, SEMANAS_JULHO), [2, 2, 1, 1, 1]);
  // Os dois passam: dobra.
  assert.deepStrictEqual(chegadasSemanaisPorIndices([registro(100), outro], [0, 1], demandas, SEMANAS_JULHO), [4, 4, 2, 2, 2]);
});

test('chegadasSemanaisPorIndices: chave sem entrada em porRegistroEventos devolve zeros, sem lançar', () => {
  const demandas = { porRegistroEventos: {} };
  assert.deepStrictEqual(chegadasSemanaisPorIndices([registro(100)], [0], demandas, SEMANAS_JULHO), [0, 0, 0, 0, 0]);
});

test('chegadasSemanaisPorIndices: sem demandas devolve zeros, sem lançar', () => {
  assert.deepStrictEqual(chegadasSemanaisPorIndices([registro(100)], [0], undefined, SEMANAS_JULHO), [0, 0, 0, 0, 0]);
  assert.deepStrictEqual(chegadasSemanaisPorIndices([registro(100)], [0], {}, SEMANAS_JULHO), [0, 0, 0, 0, 0]);
});

test('chegadasSemanaisPorIndices: evento fora do mês exibido não entra em nenhuma semana', () => {
  const foraDoMes = {
    chegada: [
      diaEpoch(new Date(Date.UTC(2026, 5, 30))), // 30/jun -- véspera
      diaEpoch(new Date(Date.UTC(2026, 7, 1))),  // 01/ago -- dia seguinte ao fim
    ],
    sondagemRealizada: [], saidaEstoque: [],
  };
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': foraDoMes } };
  assert.deepStrictEqual(chegadasSemanaisPorIndices([registro(100)], [0], demandas, SEMANAS_JULHO), [0, 0, 0, 0, 0]);
});

// Revisão final de 2026-08-15: a guarda 'semanas || []' que este teste
// provava foi removida -- ela era proteção falsa. O único chamador de
// produção (construirPainelGraficoSemanalHtml) já dereferencia
// 'semanas[0].inicio' sem guarda nenhuma cinco linhas depois de chamar esta
// função com o mesmo 'semanas' undefined -- então "não lançar aqui" nunca
// evitava o throw em produção, só adiava uma linha. 'semanas' é exigido pelo
// contrato real (sempre vem de semanasDoMes). Este teste passou a provar o
// contrário do que provava antes: que omitir 'semanas' lança, coerente com o
// que o chamador de produção já faz.
test('chegadasSemanaisPorIndices: semanas undefined lança -- não é mais um caso tolerado (era proteção falsa, ver render-aba-grafico-semanal.js)', () => {
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': EVENTOS_CHEGADAS } };
  assert.throws(() => chegadasSemanaisPorIndices([registro(100)], [0], demandas, undefined));
});

// --- Task 2: a 4ª série (Demandas) no painel de Volume --------------------

const { semanasDoMes: _semanasDoMes, indiceSemanaAtual: _indiceSemanaAtual } = require('../tools/semanal/compute-semanal.js');

// 3 chegadas em junho, 1 delas já executada em junho -> saldo de abertura = 2.
// Mais as 7 chegadas de julho de EVENTOS_CHEGADAS -> [2,2,1,1,1].
const EVENTOS_COM_ABERTURA = {
  chegada: [
    diaEpoch(new Date(Date.UTC(2026, 5, 10))),
    diaEpoch(new Date(Date.UTC(2026, 5, 20))),
    diaEpoch(new Date(Date.UTC(2026, 5, 25))),
  ].concat(EVENTOS_CHEGADAS.chegada),
  sondagemRealizada: [],
  saidaEstoque: [diaEpoch(new Date(Date.UTC(2026, 5, 28)))],
};

function painelVolume(demandas) {
  const semanas = _semanasDoMes(ANO, VIGENTE_JULHO);
  return construirPainelGraficoSemanalHtml(
    [registro(1000)], [0], 'volume', VIGENTE_JULHO, semanas, semanas.length, true,
    _indiceSemanaAtual(semanas, HOJE_15_JUL), demandas, HOJE_15_JUL
  );
}

test('Volume ganha a série Demandas: cor #9700DA e rótulo na legenda', () => {
  const html = painelVolume({ porRegistroEventos: { 'SUP-0001-24||ST': EVENTOS_COM_ABERTURA } });
  assert.match(html, /#9700DA/, 'roxo de Demandas do projeto inteiro');
  assert.match(html, />Demandas</, 'rótulo na legenda');
  assert.doesNotMatch(html, /#a78bfa/, 'lavanda do realizadoPrevistoInicial do orçamento -- série diferente, não pode aparecer');
});

// Fix round 1 (2026-08-15): os testes acima e os de FRONTEIRA/Acumulado mais
// abaixo chamam pendentesNaData/chegadasSemanaisPorIndices/calcularAcumulado
// DIRETO e recomputam o esperado à mão -- provam que as PRIMITIVAS (que esta
// task não mudou) estão certas, mas ficam cegos pra dois jeitos de a
// PRODUÇÃO (construirPainelGraficoSemanalHtml) fazer a fiação errado:
// cortar a abertura em semanas[0].inicio em vez de inicio-1, ou vazar o
// saldo de abertura pras barras semanais (.valores) além do Acumulado
// (.acumulado). Este teste chama a função de produção de verdade e lê os
// números que ela DESENHA, via data-tooltip -- mesmo mecanismo do teste
// "...os valores desenhados no gráfico batem EXATAMENTE..." mais acima
// neste arquivo (~linha 92), agora pra a série Demandas.
test('construirPainelGraficoSemanalHtml: os valores REAIS desenhados pela série Demandas -- barras semanais em FLUXO puro [2,2,1,1,1], Acumulado nasce do saldo de abertura [4,6,7,8,9], passando pelo PIPELINE REAL', () => {
  const html = painelVolume({ porRegistroEventos: { 'SUP-0001-24||ST': EVENTOS_COM_ABERTURA } });
  const [painelBarras, painelAcumulado] = html.split('Acumulado no mês — Volume');
  assert.ok(painelAcumulado, 'pré-condição: o painel Acumulado existe (Volume sempre tem os dois painéis)');

  // Painel Semanal (barras): FLUXO puro das chegadas, sem o saldo de
  // abertura somado -- é o que a 2ª mutação da revisão (abertura vazando
  // pra .valores) quebraria.
  assert.match(painelBarras, /S1 \(01\/07 a 05\/07\) · Demandas: 2"/, 'S1: 2 chegadas de julho');
  assert.match(painelBarras, /S2 \(06\/07 a 12\/07\) · Demandas: 2"/, 'S2: 2 chegadas de julho');
  assert.match(painelBarras, /S3 \(13\/07 a 19\/07\) · Demandas: 1"/, 'S3: 1 chegada de julho');
  assert.match(painelBarras, /S4 \(20\/07 a 26\/07\) · Demandas: 1"/, 'S4: 1 chegada de julho');
  assert.match(painelBarras, /S5 \(27\/07 a 31\/07\) · Demandas: 1"/, 'S5: 1 chegada de julho');
  assert.doesNotMatch(painelBarras, /Demandas: [4-9]"/, 'nenhuma barra semanal pode mostrar o saldo de abertura (2) somado ao fluxo');

  // Painel Acumulado (curva S): nasce do saldo de abertura (2 -- 3 chegadas
  // de junho menos 1 saída de junho) e soma corrida das chegadas de julho
  // -- é o que a 1ª mutação da revisão (cortar em semanas[0].inicio em vez
  // de inicio-1, contando a chegada de 01/jul duas vezes) inflaria pra
  // [5,7,8,9,10].
  assert.match(painelAcumulado, /S1 \(01\/07 a 05\/07\) · Demandas: 4"/, 'abertura 2 + S1 2 = 4');
  assert.match(painelAcumulado, /S2 \(06\/07 a 12\/07\) · Demandas: 6"/, '4 + S2 2 = 6');
  assert.match(painelAcumulado, /S3 \(13\/07 a 19\/07\) · Demandas: 7"/, '6 + S3 1 = 7');
  assert.match(painelAcumulado, /S4 \(20\/07 a 26\/07\) · Demandas: 8"/, '7 + S4 1 = 8');
  assert.match(painelAcumulado, /S5 \(27\/07 a 31\/07\) · Demandas: 9"/, '8 + S5 1 = 9 -- fecha em abertura(2) + total do mês(7)');
});

test('Equipes e Financeiro NÃO ganham a série Demandas', () => {
  const semanas = _semanasDoMes(ANO, VIGENTE_JULHO);
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': EVENTOS_COM_ABERTURA } };
  ['equipes', 'financeiro'].forEach((dimensao) => {
    const html = construirPainelGraficoSemanalHtml(
      [registro(1000)], [0], dimensao, VIGENTE_JULHO, semanas, semanas.length, true,
      _indiceSemanaAtual(semanas, HOJE_15_JUL), demandas, HOJE_15_JUL
    );
    assert.doesNotMatch(html, /#9700DA/, dimensao + ' não pode ter Demandas -- é contagem física, sem equivalente em headcount nem R$');
    assert.doesNotMatch(html, />Demandas</, dimensao + ' não pode ter Demandas na legenda');
  });
});

test('FRONTEIRA do saldo de abertura: chegada no 1º dia do mês conta na S1 e NÃO na abertura', () => {
  // Uma única chegada, exatamente em 01/jul (= semanas[0].inicio).
  // Se o corte da abertura fosse semanas[0].inicio em vez de inicio - 1, ela
  // seria contada DUAS vezes e o acumulado fecharia em 2 em vez de 1.
  const soNoPrimeiroDia = { chegada: [diaJul(1)], sondagemRealizada: [], saidaEstoque: [] };
  const semanas = _semanasDoMes(ANO, VIGENTE_JULHO);
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': soNoPrimeiroDia } };

  const { pendentesNaData } = require('../tools/semanal/render-aba-semanal.js');
  const abertura = pendentesNaData([registro(1000)], [0], demandas, semanas[0].inicio - 1);
  assert.strictEqual(abertura, 0, 'a chegada do dia 1 NÃO pertence ao saldo de abertura');

  const porSemana = chegadasSemanaisPorIndices([registro(1000)], [0], demandas, semanas);
  assert.deepStrictEqual(porSemana, [1, 0, 0, 0, 0], 'ela pertence à S1');
});

test('FRONTEIRA do saldo de abertura: chegada na véspera conta na abertura e em nenhuma semana', () => {
  const soNaVespera = {
    chegada: [diaEpoch(new Date(Date.UTC(2026, 5, 30)))], // 30/jun
    sondagemRealizada: [], saidaEstoque: [],
  };
  const semanas = _semanasDoMes(ANO, VIGENTE_JULHO);
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': soNaVespera } };

  const { pendentesNaData } = require('../tools/semanal/render-aba-semanal.js');
  assert.strictEqual(pendentesNaData([registro(1000)], [0], demandas, semanas[0].inicio - 1), 1);
  assert.deepStrictEqual(chegadasSemanaisPorIndices([registro(1000)], [0], demandas, semanas), [0, 0, 0, 0, 0]);
});

test('Acumulado de Demandas nasce do saldo de abertura e fecha em abertura + total do mês', () => {
  // abertura = 3 chegadas de junho - 1 saída de junho = 2
  // chegadas de julho = [2,2,1,1,1], total 7
  // acumulado esperado = [4, 6, 7, 8, 9]  (2 + soma corrida)
  const semanas = _semanasDoMes(ANO, VIGENTE_JULHO);
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': EVENTOS_COM_ABERTURA } };
  const { pendentesNaData } = require('../tools/semanal/render-aba-semanal.js');
  const { calcularAcumulado } = require('../tools/semanal/compute-grafico-semanal.js');

  const abertura = pendentesNaData([registro(1000)], [0], demandas, semanas[0].inicio - 1);
  assert.strictEqual(abertura, 2, 'pré-condição: 3 chegadas em junho, 1 já executada');

  const porSemana = chegadasSemanaisPorIndices([registro(1000)], [0], demandas, semanas);
  const acumulado = calcularAcumulado(porSemana).map((v) => (v || 0) + abertura);
  assert.deepStrictEqual(acumulado, [4, 6, 7, 8, 9]);

  // Monotônico não-decrescente: chegadas nunca são negativas.
  for (let i = 1; i < acumulado.length; i++) assert.ok(acumulado[i] >= acumulado[i - 1]);
});

test('DECISÃO 2026-08-14: o Acumulado de Demandas NÃO é cortado na semana em curso', () => {
  // Escolha explícita do dono do projeto: espelhar o orçamento em vez da
  // coerência local do painel. As semanas futuras achatam a curva (não há
  // chegadas lá) -- é o efeito que cortarAcumuladoNasElapsadas evita no
  // Realizado, e aqui é aceito de propósito. Este teste existe para que uma
  // revisão futura não "corrija" isso sem perguntar.
  const soNaS1 = { chegada: [diaJul(2)], sondagemRealizada: [], saidaEstoque: [] };
  const semanas = _semanasDoMes(ANO, VIGENTE_JULHO);
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': soNaS1 } };
  const { calcularAcumulado } = require('../tools/semanal/compute-grafico-semanal.js');

  const acumulado = calcularAcumulado(chegadasSemanaisPorIndices([registro(1000)], [0], demandas, semanas));
  // Achata em 1, e NENHUMA semana vira null (que é o que o corte produziria).
  assert.deepStrictEqual(acumulado, [1, 1, 1, 1, 1]);
  acumulado.forEach((v) => assert.notStrictEqual(v, null));
});

test('Sem demandas, Volume volta às 3 séries de sempre', () => {
  const semanas = _semanasDoMes(ANO, VIGENTE_JULHO);
  const html = construirPainelGraficoSemanalHtml(
    [registro(1000)], [0], 'volume', VIGENTE_JULHO, semanas, semanas.length, false, -1, undefined, undefined
  );
  assert.doesNotMatch(html, /#9700DA/);
  assert.doesNotMatch(html, />Demandas</);
});
