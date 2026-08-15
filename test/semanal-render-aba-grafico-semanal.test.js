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

test('chegadasSemanaisPorIndices: semanas undefined com demandas válidas não lança -- devolve [] guardado', () => {
  // Reprodução do bug: demandas válidas com chegada não vazia + semanas undefined
  // deve devolver [] sem lançar "Cannot read properties of undefined (reading 'length')"
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': EVENTOS_CHEGADAS } };
  assert.deepStrictEqual(chegadasSemanaisPorIndices([registro(100)], [0], demandas, undefined), []);
});
