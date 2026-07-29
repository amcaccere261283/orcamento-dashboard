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
