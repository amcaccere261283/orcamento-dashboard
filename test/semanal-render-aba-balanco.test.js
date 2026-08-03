'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  renderGraficoTipologia, escalaIndependente, calcularEscalaDivergente,
  renderAbaBalanco, GEOMETRIA,
} = require('../tools/semanal/render-aba-balanco.js');

const LINHAS = [
  { sup: 'SUP-A', valorBase: 105, valorRealizado: 205, desvio: 100, equipesBase: 2, equipesRealizado: 12, desvioEquipes: 10, ativo: true, semBase: false },
  { sup: 'SUP-B', valorBase: 90,  valorRealizado: 40,  desvio: -50, equipesBase: 4, equipesRealizado: 2,  desvioEquipes: -2, ativo: true, semBase: false },
];

test('a tipologia vira o cabeçalho do gráfico', () => {
  assert.match(renderGraficoTipologia('ST', LINHAS, {}), /ST/);
});

test('desvio positivo à direita, negativo à esquerda', () => {
  const svg = renderGraficoTipologia('ST', LINHAS, {});
  assert.match(svg, /class="barra-acima"/);
  assert.match(svg, /class="barra-abaixo"/);
});

test('equipes usam escala própria: 10 equipes não somem ao lado de 100 de volume', () => {
  const escalaVolume = escalaIndependente([100, -50], 300);
  const escalaEquipes = escalaIndependente([10, -2], 300);
  assert.ok(escalaEquipes(10) > escalaVolume(100) * 0.5,
    'a barra de equipes tem que ser visível, não um traço');
});

test('SUP sem base aparece rotulado, não como desvio zero', () => {
  const svg = renderGraficoTipologia('ST', [{ sup: 'SUP-C', desvio: null, semBase: true, ativo: true }], {});
  assert.match(svg, /sem base/i);
  assert.doesNotMatch(svg, /class="barra-acima"/);
});

// Fim a fim do achado acima, no nível do SVG: com a base 'previsto' (o
// DEFAULT da aba) e o Previsto em branco, o gráfico tem que rotular "sem
// base" -- antes desenhava barra de comprimento zero com rótulo '—', que é
// visualmente idêntico a "o realizado bateu a base". Usa renderAbaBalanco
// (não renderGraficoTipologia com linhas montadas à mão) de propósito: assim
// o teste atravessa calcularLinhas, que é onde a regra mora.
test('base Previsto em branco: o gráfico rotula "sem base", não desenha barra de comprimento zero', () => {
  const mensalNulo = () => new Array(12).fill(null);
  const previsto = { volume: mensalNulo(), equipes: mensalNulo(), financeiro: mensalNulo() };
  const realizado = { volume: new Array(12).fill(0), equipes: new Array(12).fill(0), financeiro: new Array(12).fill(0) };
  realizado.volume[6] = 120; realizado.equipes[6] = 3;

  const registros = [{ sup: 'SUP-0007-26', tipologia: 'ST', previsto, realizado, total: previsto }];
  const svg = renderAbaBalanco(registros, [0], {
    periodo: 'mesVigente', base: 'previsto', dimensao: 'volume', somenteAtivos: true,
    vigenteIdx: 6, baseline: [],
  });

  assert.match(svg, /SUP-0007-26/, 'pré-condição: a linha é ativa (realizado > 0) e não pode ter sido escondida pelo filtro');
  assert.match(svg, /sem base/i);
  assert.doesNotMatch(svg, /class="barra-acima"/, 'nenhuma barra pode ser desenhada -- comprimento zero pareceria "bateu a base certinho"');
  assert.doesNotMatch(svg, /class="barra-abaixo"/);
});

test('com o filtro de ativos ligado, inativos não são desenhados', () => {
  const linhas = LINHAS.concat([{ sup: 'SUP-Z', desvio: 0, ativo: false, semBase: false, valorBase: 0, valorRealizado: 0, desvioEquipes: 0 }]);
  assert.doesNotMatch(renderGraficoTipologia('ST', linhas, { somenteAtivos: true }), /SUP-Z/);
  assert.match(renderGraficoTipologia('ST', linhas, { somenteAtivos: false }), /SUP-Z/);
});

// --- Adicionado na rodada de revisão sobre f40ea78 (Important #1) ---
//
// O teste acima ("equipes usam escala própria") só exercita escalaIndependente()
// isolada -- prova que a FUNÇÃO é correta, não que renderGraficoTipologia() a
// está usando do jeito certo (duas chamadas, uma por série). O revisor mutou a
// fiação (as duas séries passaram a dividir UMA única chamada de
// escalaIndependente, sobre o array combinado) e a suíte inteira continuou
// verde -- só a mutação de escalaIndependente() em si reprovava. Este teste lê
// a LARGURA de fato desenhada nos <rect> do SVG (não só chama a função), pra
// travar o USO das duas escalas separadas.
//
// ATUALIZADO no redesenho de 2026-08-02: as duas séries deixaram de divergir
// do MESMO eixo e passaram a viver em dois plots lado a lado, de larguras
// diferentes (o de valor é ~6x mais largo que o de equipes). A asserção antiga
// era uma razão entre as duas larguras ("equipes > volume * 0,5"), o que só
// fazia sentido quando os dois plots tinham a mesma largura máxima -- agora
// ela reprovaria o desenho correto. A asserção nova é mais forte, não mais
// fraca: cada série, no seu próprio máximo, tem que preencher a meia-largura
// do SEU plot. Com uma escala compartilhada a barra de equipes cairia para
// 10/100 disso (~5px em vez de 52px) e o teste reprova igual.
function extrairLargura(svg, classe) {
  // \s antes de "width=" (não [^>]*width= sozinho) é o que impede casar com
  // um eventual "stroke-width=" do MESMO <rect> -- greedy + backtracking
  // acharia a ÚLTIMA ocorrência de "width=" na tag, não a primeira.
  // [^>]*? não-guloso sozinho ainda casaria "stroke-width" (o "s" de stroke
  // não é '>'); precisa do \s.
  const m = svg.match(new RegExp('<rect class="' + classe + '"[^>]*?\\swidth="([0-9.]+)"'));
  assert.ok(m, 'esperava um <rect class="' + classe + '"> no SVG');
  return Number(m[1]);
}

test('cada série é medida pela régua do SEU plot -- prova que renderGraficoTipologia chama uma escala por série, não uma para as duas', () => {
  const svg = renderGraficoTipologia('ST', LINHAS, {});

  const larguraVolume = extrairLargura(svg, 'barra-acima');   // SUP-A, desvio 100 -- máximo da própria série
  const larguraEquipes = extrairLargura(svg, 'barra-equipes'); // SUP-A, desvioEquipes 10 -- máximo da própria série

  // A série de equipes é a que denuncia o bug: no seu próprio máximo (10) ela
  // enche a meia-largura do plot de equipes. Se estivesse presa à régua do
  // plot de valor (onde 10 é 1/20 da amplitude), viraria um traço.
  assert.strictEqual(larguraEquipes, GEOMETRIA.equipes.meiaLargura,
    'o maior desvio de equipes tem que encher a meia-largura do plot de equipes');

  // desvio +100 sobre uma escala que vai de -80 a +120 (ver o teste do eixo
  // abaixo): 100/200 da largura do plot de valor.
  assert.strictEqual(larguraVolume, GEOMETRIA.valor.largura * 0.5,
    'o desvio de valor tem que ser medido pela escala do plot de valor');
});

// --- Testes do redesenho de 2026-08-02 -------------------------------------

test('os dois plots não se sobrepõem: nenhuma barra de equipes invade a faixa do plot de valor', () => {
  const svg = renderGraficoTipologia('ST', LINHAS, {});
  const xsEquipes = [...svg.matchAll(/<rect class="barra-equipes"[^>]*?\sx="([0-9.]+)"[^>]*?\swidth="([0-9.]+)"/g)]
    .map((m) => ({ x: Number(m[1]), fim: Number(m[1]) + Number(m[2]) }));

  assert.ok(xsEquipes.length > 0, 'pré-condição: as duas linhas de LINHAS têm desvio de equipes');
  xsEquipes.forEach((barra) => {
    assert.ok(barra.x >= GEOMETRIA.equipes.inicio,
      `barra de equipes começando em ${barra.x} invade o plot de valor (que termina em ${GEOMETRIA.valor.fim})`);
    assert.ok(barra.fim <= GEOMETRIA.equipes.fim, 'barra de equipes estourando a borda direita do SVG');
  });

  // O modo de falha original: a barra de equipes era desenhada DEPOIS da de
  // valor, no mesmo x, cobrindo-a. Aqui nem os intervalos se tocam.
  assert.ok(GEOMETRIA.valor.fim < GEOMETRIA.equipes.inicio,
    'os dois plots precisam ser faixas horizontais disjuntas');
});

test('linha com base mas sem Realizado no período não desenha barra -- comprimento zero pareceria "bateu a base certinho"', () => {
  const linhas = [{
    sup: 'SUP-FUTURO', valorBase: 500, valorRealizado: null, desvio: null,
    equipesBase: 3, equipesRealizado: null, desvioEquipes: null, ativo: true, semBase: false,
  }];
  const svg = renderGraficoTipologia('ST', linhas, {});

  assert.match(svg, />Realizado não lançado</, 'a linha precisa dizer que falta Realizado, não ficar muda');
  assert.doesNotMatch(svg, /class="barra-acima"/);
  assert.doesNotMatch(svg, /class="barra-abaixo"/);
  assert.doesNotMatch(svg, />sem base</, 'havia base (500) -- o rótulo errado seria dizer que não havia');
});

test('o eixo do plot de valor cai em números redondos e cobre só a amplitude que o dado usa', () => {
  // -50..+100: amplitude 150 / 4 ticks = 37,5 -> magnitude 10, normalizado
  // 3,75 -> degrau 4 -> passo 40. Cada ponta arredonda para cima: -80 e +120.
  assert.deepStrictEqual(calcularEscalaDivergente(-50, 100, 4), { passo: 40, min: -80, max: 120 });

  // Todos negativos (o caso comum no dado real: quase todo SUP abaixo da
  // base) -- o lado positivo do eixo não pode reservar largura nenhuma, e é
  // esse zero à direita que dobra o comprimento útil das barras.
  const soNegativos = calcularEscalaDivergente(-340000, 0, 4);
  assert.strictEqual(soNegativos.max, 0, 'sem nenhum desvio positivo, o eixo termina no zero');
  assert.ok(soNegativos.min <= -340000 && soNegativos.min % soNegativos.passo === 0);

  // Sem amplitude nenhuma (todo desvio exatamente zero) não há régua.
  assert.strictEqual(calcularEscalaDivergente(0, 0, 4), null);

  const svg = renderGraficoTipologia('ST', LINHAS, {});
  ['−80', '−40', '0', '+40', '+80', '+120'].forEach((tick) => {
    assert.ok(svg.includes('>' + tick + '<'), `esperava o tick "${tick}" no eixo`);
  });
});

test('sem nenhum desvio comparável, o gráfico não inventa uma régua', () => {
  const linhas = [{ sup: 'SUP-X', desvio: null, semBase: true, ativo: true, desvioEquipes: null }];
  const svg = renderGraficoTipologia('ST', linhas, {});
  assert.doesNotMatch(svg, /class="grafico-gridline"/,
    'um eixo "0 / 0,25 / 0,5" sobre um gráfico sem dado nenhum é pior que nenhum eixo');
});

// Regressão pega no navegador, não pelos testes: uma tipologia em que TODO
// desvio comparável é exatamente zero (mês fechado, a MATRIZ copia
// Realizado = Previsto linha a linha) deixa calcularEscalaDivergente sem
// amplitude, e portanto sem projetor. As linhas continuam válidas ("bateu a
// base"), então entram no ramo que desenha barra -- e sem guarda o projetor
// null estourava "xDe is not a function", derrubando a aba INTEIRA (as 10
// tipologias, não só a afetada) no primeiro redesenho.
test('tipologia com todos os desvios exatamente zero renderiza "bateu a base", não quebra por falta de escala', () => {
  const linhas = [
    { sup: 'SUP-A', valorBase: 500, valorRealizado: 500, desvio: 0, equipesBase: 2, equipesRealizado: 2, desvioEquipes: 0, ativo: true, semBase: false },
    { sup: 'SUP-B', valorBase: 900, valorRealizado: 900, desvio: 0, equipesBase: 3, equipesRealizado: 3, desvioEquipes: 0, ativo: true, semBase: false },
  ];
  const svg = renderGraficoTipologia('ST', linhas, {});

  assert.match(svg, /SUP-A/);
  assert.strictEqual(svg.split('>0<').length - 1, 2, 'os dois desvios zero precisam ser rotulados "0"');
  assert.doesNotMatch(svg, /class="barra-acima"/, 'desvio zero não tem comprimento -- nenhuma barra');
  assert.doesNotMatch(svg, />Realizado não lançado</, 'houve Realizado (500 e 900) -- só bateu a base');
});

test('cada linha tem área de hover com os números exatos -- o rótulo mostra o desvio, o tooltip mostra base e realizado', () => {
  const svg = renderGraficoTipologia('ST', LINHAS, {});
  assert.match(svg, /class="grafico-hit" data-tooltip="SUP-A · Base 105 · Realizado 205 · Desvio \+100"/);
  assert.match(svg, /class="grafico-hit" data-tooltip="SUP-A · Equipes base 2,0 · Realizado 12,0 · Δ \+10,0"/);
});

test('um desvio que arredonda para zero não sai com sinal ("−0,0" parece defeito de formatação)', () => {
  const linhas = [{
    sup: 'SUP-QUASE', valorBase: 100, valorRealizado: 100, desvio: 0,
    equipesBase: 2.02, equipesRealizado: 1.98, desvioEquipes: -0.04, ativo: true, semBase: false,
  }];
  const svg = renderGraficoTipologia('ST', linhas, {});
  assert.ok(svg.includes('>0,0<'), 'esperava o Δ equipes arredondado sem sinal');
  assert.ok(!svg.includes('−0,0') && !svg.includes('+0,0'), 'zero arredondado não leva sinal');
});

test('o rótulo da barra mostra o DESVIO (o que o comprimento codifica), não o Realizado', () => {
  const svg = renderGraficoTipologia('ST', LINHAS, {});
  // SUP-B: base 90, realizado 40, desvio -50. O número na barra tem que ser
  // o desvio -- a versão anterior escrevia o Realizado na ponta de uma barra
  // cujo comprimento era o desvio, dois números diferentes no mesmo lugar.
  assert.ok(svg.includes('>−50<'), 'esperava o desvio −50 rotulado');
  assert.ok(!svg.includes('>40<'), 'o Realizado (40) não pode ser o rótulo da barra -- ele mora no tooltip');
});

test('o título sai do SVG e vira .grafico-titulo, com o sufixo de milhares quando o recorte é grande', () => {
  const pequeno = renderGraficoTipologia('ST', LINHAS, { dimensao: 'volume' });
  assert.match(pequeno, /^<div class="grafico-titulo">ST — Desvio de volume<\/div>/);

  const grande = renderGraficoTipologia('ST', [
    { sup: 'SUP-A', valorBase: 1000, valorRealizado: 51000, desvio: 50000, desvioEquipes: 1, equipesBase: 1, equipesRealizado: 2, ativo: true, semBase: false },
  ], { dimensao: 'financeiro' });
  assert.match(grande, /^<div class="grafico-titulo">ST — Desvio financeiro \(em milhares\)<\/div>/);
});

test('a aba traz legenda única e o balão de tooltip, não uma legenda por painel', () => {
  const zeros = () => new Array(12).fill(0);
  const previsto = { volume: zeros(), equipes: zeros(), financeiro: zeros() };
  const realizado = { volume: zeros(), equipes: zeros(), financeiro: zeros() };
  previsto.financeiro[6] = 100; realizado.financeiro[6] = 150;
  previsto.equipes[6] = 2; realizado.equipes[6] = 3;
  const registros = [
    { sup: 'SUP-1', tipologia: 'ST', previsto, realizado, total: previsto },
    { sup: 'SUP-2', tipologia: 'PI', previsto, realizado, total: previsto },
  ];
  const html = renderAbaBalanco(registros, [0, 1], {
    periodo: 'mesVigente', base: 'previsto', dimensao: 'financeiro', somenteAtivos: true,
    vigenteIdx: 6, baseline: [],
  });

  assert.strictEqual(html.split('class="legenda-balanco"').length - 1, 1,
    'a legenda é a mesma nos 10 painéis -- repetir seria só ruído');
  assert.strictEqual(html.split('id="balanco-tooltip"').length - 1, 1,
    'um balão só, reposicionado pelo listener delegado de render-semanal.js');
  assert.strictEqual(html.split('class="grafico-painel"').length - 1, 2, 'um painel por tipologia');
});
