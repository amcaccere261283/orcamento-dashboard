'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderGraficoTipologia, escalaIndependente, renderAbaBalanco } = require('../tools/semanal/render-aba-balanco.js');

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

// Mesmo cuidado de "sem base", pro outro lado do desvio: havia Previsto,
// mas o Realizado ainda não existe (achado de 2026-08-01 -- a coluna
// Realizado da MATRIZ só é preenchida depois que o mês fecha, então
// Acumulado até o mês pode legitimamente ficar "sem dado" nalgum SUP; Mês
// Vigente não cai mais aqui, ver realizadoDoAvancos em compute-balanco.js).
// "Realizado não lançado" e "bateu a base certinho" (desvio 0) apareceriam
// idênticos se ambos virassem barra de comprimento zero.
test('valorRealizado sem dado (desvio null, mas COM base): rotula "Realizado não lançado", não desenha barra de comprimento zero', () => {
  const linha = { sup: 'SUP-D', valorBase: 100, valorRealizado: null, desvio: null, equipesBase: null, equipesRealizado: null, desvioEquipes: null, ativo: true, semBase: false };
  const svg = renderGraficoTipologia('ST', [linha], {});
  assert.match(svg, /Realizado não lançado/i);
  assert.doesNotMatch(svg, /class="barra-acima"/);
  assert.doesNotMatch(svg, /class="barra-abaixo"/);
  // A base (100) ainda é informação real -- diferente de "sem base", ela
  // continua aparecendo mesmo sem Realizado.
  assert.match(svg, />100</);
});

test('desvioEquipes sem dado (null) não desenha a barra de equipes, mas não impede a barra principal (desvio) de aparecer', () => {
  const linha = { sup: 'SUP-E', valorBase: 100, valorRealizado: 150, desvio: 50, equipesBase: null, equipesRealizado: null, desvioEquipes: null, ativo: true, semBase: false };
  const svg = renderGraficoTipologia('ST', [linha], {});
  assert.match(svg, /class="barra-acima"/, 'o desvio principal tem valor -- a barra precisa aparecer mesmo sem dado de equipes');
  assert.doesNotMatch(svg, /class="barra-equipes"/, 'sem equipesBase/equipesRealizado não há o que desenhar -- nunca uma barra de comprimento zero');
  assert.doesNotMatch(svg, /eq\.</, 'nenhum rótulo "0,0 eq." -- isso pareceria um desvio real de equipes igual a zero');
});

test('com valorRealizado E desvioEquipes ambos presentes, as duas barras aparecem juntas (comportamento de sempre)', () => {
  const linha = { sup: 'SUP-F', valorBase: 100, valorRealizado: 150, desvio: 50, equipesBase: 2, equipesRealizado: 3, desvioEquipes: 1, ativo: true, semBase: false };
  const svg = renderGraficoTipologia('ST', [linha], {});
  assert.match(svg, /class="barra-acima"/);
  assert.match(svg, /class="barra-equipes"/);
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
// fiação (linhas 97-98 do módulo: as duas séries passaram a dividir UMA única
// chamada de escalaIndependente, sobre o array combinado) e a suíte inteira
// continuou verde -- só a mutação de escalaIndependente() em si reprovava.
// Este teste lê a LARGURA de fato desenhada nos <rect> do SVG (não só chama a
// função), pra travar o USO das duas escalas separadas, não só a existência
// delas. Extrai a largura do primeiro <rect class="barra-acima"> (desvio de
// volume da SUP-A, 100 -- o próprio máximo da série de volume) e do primeiro
// <rect class="barra-equipes"> (desvio de equipes da SUP-A, 10 -- o próprio
// máximo da série de equipes): com escalas independentes as duas devem
// preencher a MESMA largura máxima (LARGURA_BARRA_MAX), porque cada uma é o
// maior valor da própria série; com uma escala compartilhada (o bug que este
// teste existe pra impedir), a barra de equipes encolheria pra ~1/10 da
// largura da barra de volume (10/100, a proporção entre as duas séries).
function extrairLargura(svg, classe) {
  // \s antes de "width=" (não [^>]*width= sozinho) é o que impede casar com
  // o "stroke-width=" do MESMO <rect> -- greedy + backtracking acharia a
  // ÚLTIMA ocorrência de "width=" na tag (stroke-width="0.5"), não a
  // primeira (width="280"). [^>]*? não-guloso sozinho ainda casaria
  // "stroke-width" (o "s" de stroke não é '>'); precisa do \s.
  const m = svg.match(new RegExp('<rect class="' + classe + '"[^>]*?\\swidth="([0-9.]+)"'));
  assert.ok(m, 'esperava um <rect class="' + classe + '"> no SVG');
  return Number(m[1]);
}

test('a barra de equipes usa uma escala DE FATO separada no SVG desenhado -- não é só a função escalaIndependente() isolada que precisa estar certa, é o jeito como renderGraficoTipologia() a chama (uma vez por série, não uma vez para as duas)', () => {
  const svg = renderGraficoTipologia('ST', LINHAS, {});

  const larguraVolume = extrairLargura(svg, 'barra-acima');   // SUP-A, desvio 100 -- máximo da própria série
  const larguraEquipes = extrairLargura(svg, 'barra-equipes'); // SUP-A, desvioEquipes 10 -- máximo da própria série

  assert.ok(
    larguraEquipes > larguraVolume * 0.5,
    'com escalas independentes, o desvio de equipes da SUP-A (10, o próprio máximo da série de equipes) deveria ocupar a MESMA largura máxima que o desvio de volume da SUP-A (100, o próprio máximo da série de volume) -- se as duas dividirem uma escala comum, a barra de equipes encolhe pra uma fração de traço (largura equipes = ' + larguraEquipes + ', largura volume = ' + larguraVolume + ')'
  );
});

test('o rótulo composto SUP — Tomador aparece no SVG quando a linha tem tomador', () => {
  const linhas = [{ sup: 'SUP-A', tomador: 'Concessionária Exemplo S.A', valorBase: 105, valorRealizado: 205, desvio: 100, equipesBase: 2, equipesRealizado: 12, desvioEquipes: 10, ativo: true, semBase: false }];
  const svg = renderGraficoTipologia('ST', linhas, {});
  assert.match(svg, /SUP-A/);
  assert.match(svg, /Concessionária Exemplo S\.A/);
});

test('linha sem tomador (undefined) não quebra e não deixa um "— undefined" no SVG', () => {
  const svg = renderGraficoTipologia('ST', LINHAS, {}); // LINHAS não tem campo tomador
  assert.doesNotMatch(svg, /undefined/);
});

test('fonte do rótulo de SUP é 11px (menor que antes), e há uma linha divisória entre a 1ª e a 2ª linha do gráfico', () => {
  const svg = renderGraficoTipologia('ST', LINHAS, {}); // LINHAS tem 2 entradas
  assert.match(svg, /<text x="8"[^>]*font-size="11"/);
  // Regex ancorada no stroke da divisória (COR_DIVISORIA), não só em
  // '<line x1="0"': o <defs><pattern> de hachura das equipes também emite
  // uma <line x1="0" y1="0" ...> (stroke preto, diagonal do padrão) em TODO
  // gráfico, com ou sem divisórias -- contar só '<line x1="0"' inflava a
  // contagem em +1 e escondia uma quebra real do guard 'i > 0'.
  const linhasDivisoria = (svg.match(/<line x1="0"[^>]*stroke="rgba\(255,255,255,0\.10\)"/g) || []).length;
  assert.strictEqual(linhasDivisoria, 1, 'com 2 linhas de SUP, espera-se exatamente 1 divisória entre elas (nunca antes da primeira)');
});
