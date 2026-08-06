'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  renderGraficoTipologia, escalaIndependente, calcularEscalaAncorada,
  calcularDivisaoTicks, passoBonito, renderAbaBalanco, renderControles, GEOMETRIA,
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
// ATUALIZADO de novo na revisão de design de 2026-08-02: as barras deixaram
// de ser <rect> e viraram <path>, porque o arredondamento agora é só na ponta
// do dado (um <rect rx> arredonda os quatro cantos, descolando a barra do zero
// e transformando as barras curtas em losangos). Com isso a largura saiu do
// atributo 'width' e foi para dentro do 'd'. Em vez de fazer o teste
// engenhariar a geometria do path de volta, o render publica a largura
// desenhada em data-largura -- o teste de geometria abaixo prende esse número
// ao path de verdade, então ele não pode mentir.
function extrairLargura(svg, classe) {
  const m = svg.match(new RegExp('<path class="' + classe + '"[^>]*?\\sdata-largura="([0-9.]+)"'));
  assert.ok(m, 'esperava um <path class="' + classe + '"> no SVG');
  return Number(m[1]);
}

test('a barra de equipes usa a escala GLOBAL da aba, não a do painel -- comprimento igual tem que significar número igual em painéis diferentes', () => {
  // Dois painéis com Δ equipes de ordens diferentes. Antes cada um normalizava
  // pelo próprio máximo, então a maior barra de cada painel media o mesmo
  // tanto valendo números completamente diferentes -- o achado P0 da revisão.
  const painelGrande = renderGraficoTipologia('ST', LINHAS, { maxEquipesGlobal: 10 });
  const painelPequeno = renderGraficoTipologia('PI', [
    { sup: 'SUP-C', valorBase: 10, valorRealizado: 12, desvio: 2, equipesBase: 1, equipesRealizado: 3, desvioEquipes: 2, ativo: true, semBase: false },
  ], { maxEquipesGlobal: 10 });

  const larguraDe10 = extrairLargura(painelGrande, 'barra-equipes'); // Δ 10
  const larguraDe2 = extrairLargura(painelPequeno, 'barra-equipes'); // Δ 2

  assert.strictEqual(larguraDe10, GEOMETRIA.equipes.meiaLargura,
    'o Δ igual ao máximo global enche a meia-largura do plot de equipes');
  assert.ok(Math.abs(larguraDe2 - GEOMETRIA.equipes.meiaLargura * 0.2) < 0.05,
    `Δ 2 sobre máximo global 10 tem que medir 1/5 da meia-largura, mediu ${larguraDe2}`);
  assert.ok(larguraDe2 < larguraDe10,
    'com escala global, o painel de Δ menor tem barras menores -- é justamente o que a escala por painel apagava');
});

test('cada série é medida pela régua do SEU plot -- prova que renderGraficoTipologia chama uma escala por série, não uma para as duas', () => {
  const svg = renderGraficoTipologia('ST', LINHAS, { maxEquipesGlobal: 10 });

  const larguraVolume = extrairLargura(svg, 'barra-acima');   // SUP-A, desvio 100
  const larguraEquipes = extrairLargura(svg, 'barra-equipes'); // SUP-A, desvioEquipes 10

  // A série de equipes é a que denuncia o bug: no máximo global (10) ela enche
  // a meia-largura do plot de equipes. Se estivesse presa à régua do plot de
  // valor (onde 10 é uma fração mínima da amplitude), viraria um traço.
  assert.strictEqual(larguraEquipes, GEOMETRIA.equipes.meiaLargura,
    'o maior desvio de equipes tem que encher a meia-largura do plot de equipes');

  // Escala ancorada com divisão 1:4 (só o painel: min -50, max +100 -> nNeg 1,
  // nPos 4 sobre 5 intervalos), passo 25 -> domínio [-25, +100]. O desvio +100
  // é o topo, então enche os 4/5 positivos da largura.
  assert.ok(larguraVolume > larguraEquipes,
    'a barra de valor é medida pelo plot de valor, que é muito mais largo que o de equipes');
  assert.ok(larguraVolume <= GEOMETRIA.valor.largura,
    'nenhuma barra pode passar da largura do próprio plot');
});

test('a barra é arredondada só na ponta do dado -- a ponta do zero fica reta e encosta no eixo', () => {
  const svg = renderGraficoTipologia('ST', LINHAS, { maxEquipesGlobal: 10 });
  const m = svg.match(/<path class="barra-acima" data-largura="([0-9.]+)" d="M([0-9.]+),([0-9.]+) h([0-9.-]+)/);
  assert.ok(m, 'esperava o path da barra positiva');

  const [, largura, xInicio, , primeiroH] = m;
  // O path começa NO zero e o primeiro comando é horizontal: nenhum arco
  // acontece antes de sair do eixo, ou seja, o canto colado no zero é reto.
  // E o traço horizontal inicial é a largura menos o raio da ponta arredondada.
  assert.ok(Math.abs(Number(primeiroH) - (Number(largura) - 3)) < 0.15,
    `o primeiro segmento (${primeiroH}) tem que ser a largura (${largura}) menos o raio 3 -- prova que só a ponta do dado é curva`);

  // data-largura não pode mentir: o path tem que começar exatamente no zero.
  const zero = svg.match(/<line class="balanco-eixo-zero" x1="([0-9.]+)"/)[1];
  assert.strictEqual(xInicio, zero, 'a barra tem que nascer exatamente na linha do zero');
});

test('desvio pequeno demais para render como nada ganha um piso de comprimento', () => {
  // Desvio de 1 numa escala cujo topo é 10.000: sem piso isso daria menos de
  // 0,1 unidade e sumiria -- visualmente idêntico a "não há dado", que é
  // justamente a distinção que o módulo inteiro se esforça para preservar.
  const linhas = [
    { sup: 'SUP-GRANDE', valorBase: 0, valorRealizado: 10000, desvio: 10000, equipesBase: 1, equipesRealizado: 1, desvioEquipes: 0, ativo: true, semBase: false },
    { sup: 'SUP-MINIMO', valorBase: 0, valorRealizado: 1, desvio: 1, equipesBase: 1, equipesRealizado: 1, desvioEquipes: 0, ativo: true, semBase: false },
  ];
  const svg = renderGraficoTipologia('ST', linhas, {});
  const larguras = [...svg.matchAll(/<path class="barra-acima" data-largura="([0-9.]+)"/g)].map((m) => Number(m[1]));
  assert.strictEqual(larguras.length, 2);
  assert.ok(Math.min(...larguras) >= 2, `a menor barra mediu ${Math.min(...larguras)}, abaixo do piso de 2`);
});

// --- Testes do redesenho de 2026-08-02 -------------------------------------

test('os dois plots não se sobrepõem: nenhuma barra de equipes invade a faixa do plot de valor', () => {
  const svg = renderGraficoTipologia('ST', LINHAS, { maxEquipesGlobal: 10 });
  // As barras viraram <path> que nascem no zero do próprio plot e crescem para
  // um dos lados -- a extensão sai do x inicial mais/menos data-largura, e o
  // sinal do primeiro comando 'h' diz o lado.
  const xsEquipes = [...svg.matchAll(/<path class="barra-equipes" data-largura="([0-9.]+)" d="M([0-9.]+),[0-9.]+ h(-?)/g)]
    .map((m) => {
      const largura = Number(m[1]);
      const zero = Number(m[2]);
      const paraEsquerda = m[3] === '-';
      return paraEsquerda
        ? { x: zero - largura, fim: zero }
        : { x: zero, fim: zero + largura };
    });

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

test('a repartição do eixo sai do formato dos dados da aba inteira, não de um 4:1 cravado', () => {
  // Quase tudo negativo (o caso real): o lado negativo leva quase todos os
  // intervalos, mas o positivo nunca fica sem nenhum se houver dado positivo.
  assert.deepStrictEqual(calcularDivisaoTicks(-1000, 50, 5), { nNeg: 4, nPos: 1 });
  // Maioria positiva: a repartição se inverte sozinha. Um 4:1 fixo deixaria
  // 80% da largura vazia aqui.
  assert.deepStrictEqual(calcularDivisaoTicks(-50, 1000, 5), { nNeg: 1, nPos: 4 });
  // Só de um lado: o zero encosta na borda, e nenhum intervalo é desperdiçado.
  assert.deepStrictEqual(calcularDivisaoTicks(-340000, 0, 5), { nNeg: 5, nPos: 0 });
  assert.deepStrictEqual(calcularDivisaoTicks(0, 900, 5), { nNeg: 0, nPos: 5 });
  // Sem dado nenhum não há régua.
  assert.strictEqual(calcularDivisaoTicks(0, 0, 5), null);
});

test('o zero cai no MESMO x em todos os painéis, mesmo com domínios diferentes', () => {
  // Este é o ponto do eixo ancorado: painéis empilhados numa coluna só
  // conseguem ser lidos de relance se o zero for uma vertical constante. Antes
  // ele pulava de x=693,6 para x=802 entre painéis vizinhos, porque a
  // CONTAGEM de intervalos variava com o sinal do dado de cada painel.
  const divisao = calcularDivisaoTicks(-1000, 100, 5);

  const misto = renderGraficoTipologia('ST', LINHAS, { divisao, maxEquipesGlobal: 10 });
  const soNegativo = renderGraficoTipologia('PI', [
    { sup: 'SUP-N', valorBase: 900, valorRealizado: 100, desvio: -800, equipesBase: 2, equipesRealizado: 2, desvioEquipes: 0, ativo: true, semBase: false },
  ], { divisao, maxEquipesGlobal: 10 });

  const zeroDe = (svg) => svg.match(/<line class="balanco-eixo-zero" x1="([0-9.]+)"/)[1];
  assert.strictEqual(zeroDe(misto), zeroDe(soNegativo),
    'o zero tem que cair no mesmo x nos dois painéis, apesar de os domínios serem diferentes');

  // E continua sendo um domínio POR PAINEL: os ticks não são os mesmos.
  const ticksDe = (svg) => [...svg.matchAll(/class="grafico-eixo-texto"[^>]*>([^<]+)</g)].map((m) => m[1]);
  assert.notDeepStrictEqual(ticksDe(misto), ticksDe(soNegativo),
    'ancorar o zero não pode ter achatado os painéis num domínio comum');
});

test('o eixo do plot de valor cai em números redondos', () => {
  // Divisão 1:4 sobre 5 intervalos, min -50 e max +100. O passo tem que caber
  // os DOIS lados: o negativo precisa de 50/1 = 50 por intervalo, o positivo
  // de 100/4 = 25. Vence o maior (50), senão o lado negativo transbordaria.
  // Domínio: [-1x50, +4x50] = [-50, +200].
  //
  // O topo sobra (200 para um dado de 100) -- é o preço de ancorar o zero, e
  // é deliberado: numa coluna de 10 painéis, um zero que não se mexe vale mais
  // que meia régua a mais de aproveitamento em um painel.
  const divisao = { nNeg: 1, nPos: 4 };
  assert.deepStrictEqual(calcularEscalaAncorada(-50, 100, divisao), { passo: 50, min: -50, max: 200 });

  // Sem amplitude nenhuma (todo desvio exatamente zero) não há régua.
  assert.strictEqual(calcularEscalaAncorada(0, 0, divisao), null);

  // passoBonito usa os degraus intermediários do orçamento, não só 1/2/5/10.
  assert.strictEqual(passoBonito(37.5), 40);
  assert.strictEqual(passoBonito(82307), 100000);
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

// --- Aviso de Δ equipes sem dado (2026-08-03) ------------------------------

test('mês fora da cobertura da aba EQ mostra o aviso, e diz QUAL mês tem dado', () => {
  const html = renderAbaBalanco([], [], {
    periodo: 'mesVigente', vigenteIdx: 6, ano: 2026, // julho na tela
    equipesPeriodo: { ano: 2026, mes: 8 },      // espelho traz agosto
  });
  assert.match(html, /aviso-equipes/);
  assert.match(html, /Ago\/2026/, 'o aviso precisa dizer qual mês tem dado -- é a saída do problema');
  assert.match(html, /não são afetadas/, 'e deixar claro que o desvio de valor continua válido');
});

test('no mês coberto, nenhum aviso aparece', () => {
  const html = renderAbaBalanco([], [], {
    periodo: 'mesVigente', vigenteIdx: 7, ano: 2026,
    equipesPeriodo: { ano: 2026, mes: 8 },
  });
  assert.doesNotMatch(html, /aviso-equipes/);
});

test('"Acumulado até o mês" sempre avisa -- um mapa de um mês não responde pelo acumulado', () => {
  const html = renderAbaBalanco([], [], {
    periodo: 'acumuladoAteMes', vigenteIdx: 7, ano: 2026,
    equipesPeriodo: { ano: 2026, mes: 8 },
  });
  assert.match(html, /aviso-equipes/);
});

test('sem equipes ativas configuradas (fonte antiga), nenhum aviso -- nada mudou para quem não tem a aba EQ', () => {
  const html = renderAbaBalanco([], [], { periodo: 'mesVigente', vigenteIdx: 7, ano: 2026 });
  assert.doesNotMatch(html, /aviso-equipes/);
});

// --- Dimensão "Demandas" no seletor da aba (2026-08-03) -------------------

test('o seletor Dimensão tem as três opções, com Demandas ao lado de Financeiro/Volumetria', () => {
  const html = renderControles({});
  assert.match(html, /<option value="financeiro"[^>]*>Financeiro<\/option>/);
  assert.match(html, /<option value="volume"[^>]*>Volumetria<\/option>/);
  assert.match(html, /<option value="demandas"[^>]*>Demandas<\/option>/);
});

test('o seletor Dimensão marca "demandas" como selecionado quando é o estado atual', () => {
  const html = renderControles({ dimensao: 'demandas' });
  assert.match(html, /<option value="demandas" selected>Demandas<\/option>/);
  assert.doesNotMatch(html, /<option value="financeiro" selected>/);
});

test('o título de cada painel diz "Desvio de demandas" -- não pode reaproveitar o rótulo de volume, as duas são contagem de furo e só o nome as distingue', () => {
  const linhas = [{ sup: 'SUP-0001-24', tomador: 'T', valorBase: 100, valorRealizado: 60, desvio: -40, equipesBase: null, equipesRealizado: null, desvioEquipes: null, ativo: true, semBase: false }];
  const html = renderGraficoTipologia('ST', linhas, { dimensao: 'demandas' });
  assert.match(html, /ST — Desvio de demandas/);
});
