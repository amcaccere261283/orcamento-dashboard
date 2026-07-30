'use strict';

// Este módulo roda tanto no Node (testes) quanto embrulhado no navegador via
// buildBrowserBundle -- por isso 'var'/'function', não 'const'/arrow, e
// ZERO require de fora do diretório (nem de './' nem de '../'). Um require de
// módulo externo seria REMOVIDO por transformaModulo (tools/comum/browser-bundle.js)
// e o nome viraria undefined em produção com os testes em Node passando. Tudo o que
// este arquivo precisa chega por argumento (o agregado de compute-demandas.js,
// decifrado do blob) ou está definido aqui.
//
// escapeHtml e MESES são duplicados de propósito, seguindo o que
// render-aba-semanal.js e render-aba-balanco.js já fazem: cada módulo do
// bundle se sustenta sozinho.

var MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// Ordem e rótulo de exibição das 5 séries. A ordem é o ciclo: chegou,
// sondou, fechou relatório, morreu, está parado.
var BLOCOS = [
  { serie: 'chegadas', rotulo: 'Demandas chegadas', estoque: false },
  { serie: 'sondagemRealizada', rotulo: 'Sondagem realizada', estoque: false },
  { serie: 'relatorioConcluido', rotulo: 'Relatório concluído', estoque: false },
  { serie: 'canceladas', rotulo: 'Canceladas', estoque: false },
  { serie: 'pendentes', rotulo: 'Pendentes', estoque: true },
];

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Fluxo acumula por soma corrida. ESTOQUE não: o saldo de março não é o de
// janeiro mais o de fevereiro mais o de março -- é o saldo de março. Somar
// daria uma curva crescente e convincente, e errada. Mesma premissa que
// mediaEquipesPonderada e dividirEmSemanas já carregam para equipes.
function acumularSerie(valores, ehEstoque) {
  var entrada = valores || [];
  if (ehEstoque) return entrada.slice();
  var saida = [];
  var corrente = 0;
  for (var i = 0; i < entrada.length; i++) {
    corrente += entrada[i] || 0;
    saida.push(corrente);
  }
  return saida;
}

// O rótulo da coluna de fechamento segue a NATUREZA da série, não o modo:
// fluxo fecha em "Total", estoque em "Saldo", nos dois modos. Chamar de
// "Total" a última coluna de um estoque no modo mensal esconderia atrás de um
// rótulo justamente a soma de saldos que este módulo existe para evitar.
// Mesmo cuidado que rotuloColunaFechamento de render-aba-semanal.js toma ao
// virar "Total" em "Média" na dimensão equipes.
function rotuloColunaFechamento(serie) {
  for (var i = 0; i < BLOCOS.length; i++) {
    if (BLOCOS[i].serie === serie && BLOCOS[i].estoque) return 'Saldo';
  }
  return 'Total';
}

// Estoque fecha no saldo do último mês. Fluxo fecha na soma dos 12 no modo
// mensal -- mas no modo ACUMULADO a série que chega aqui já é a soma corrida,
// e somá-la de novo daria um número sem significado nenhum (para [10,20,30]
// o acumulado é [10,30,60], cuja soma é 100, e o total do ano é 60). No
// acumulado, portanto, o fechamento é o último valor.
function fechamento(valores, ehEstoque, modo) {
  var lista = valores || [];
  if (ehEstoque || modo === 'acumulado') return lista.length ? (lista[lista.length - 1] || 0) : 0;
  var soma = 0;
  for (var i = 0; i < lista.length; i++) soma += lista[i] || 0;
  return soma;
}

function renderCabecalho(serie) {
  var ths = '';
  for (var i = 0; i < MESES.length; i++) ths += '<th>' + MESES[i] + '</th>';
  return '<thead><tr><th></th>' + ths
    + '<th>' + escapeHtml(rotuloColunaFechamento(serie)) + '</th></tr></thead>';
}

function renderLinha(rotulo, valores, ehEstoque, modo, classe) {
  var tds = '';
  for (var i = 0; i < valores.length; i++) {
    var v = valores[i] || 0;
    tds += v === 0
      ? '<td class="num sem-dado"></td>'
      : '<td class="num">' + v + '</td>';
  }
  return '<tr class="' + classe + '">'
    + '<td class="serie-label">' + escapeHtml(rotulo) + '</td>'
    + tds
    + '<td class="num celula-total-linha">' + fechamento(valores, ehEstoque, modo) + '</td></tr>';
}

function renderBloco(bloco, demandas, modo) {
  var linhas = '';
  for (var i = 0; i < demandas.tipologias.length; i++) {
    var t = demandas.tipologias[i];
    var valores = modo === 'acumulado'
      ? acumularSerie(t.series[bloco.serie], bloco.estoque)
      : (t.series[bloco.serie] || []);
    linhas += renderLinha(t.tipologia, valores, bloco.estoque, modo, 'linha-demandas');
  }
  var totais = modo === 'acumulado'
    ? acumularSerie(demandas.totais[bloco.serie], bloco.estoque)
    : (demandas.totais[bloco.serie] || []);
  linhas += renderLinha('Total', totais, bloco.estoque, modo, 'linha-demandas linha-total-demandas');

  // Pendentes carrega furo de anos anteriores: na planilha real, 5.546 dos
  // 7.154 abertos em janeiro/2026 chegaram antes de 2026. Sem essa nota o
  // primeiro mês parece um pico inexplicável.
  var nota = bloco.estoque
    ? '<p class="nota-demandas">Saldo aberto no fim de cada mês, não um fluxo — inclui demanda de anos anteriores ainda não sondada (o estoque de abertura). Por isso não se acumula.</p>'
    : '';

  return '<section class="bloco-demandas">'
    + '<h3>' + escapeHtml(bloco.rotulo) + '</h3>'
    + nota
    + '<table class="tabela-demandas">' + renderCabecalho(bloco.serie)
    + '<tbody>' + linhas + '</tbody></table></section>';
}

function renderControles(modo) {
  var opcoes = [['mensal', 'Mensal'], ['acumulado', 'Acumulado']].map(function (par) {
    var sel = par[0] === modo ? ' selected' : '';
    return '<option value="' + par[0] + '"' + sel + '>' + par[1] + '</option>';
  }).join('');
  return '<div class="controles-demandas">'
    + '<label class="controle-demandas">Visão'
    + '<select id="demandas-modo">' + opcoes + '</select>'
    + '</label></div>';
}

// demandas: a saída de compute-demandas.js, já decifrada
// ({tipologias, totais}). modo: 'mensal' | 'acumulado'.
function renderAbaDemandas(demandas, modo) {
  var dados = demandas || { tipologias: [], totais: {} };
  if (!dados.tipologias || !dados.tipologias.length) {
    return renderControles(modo)
      + '<p class="nota-demandas">Sem dado de demandas nesta base — nenhuma tipologia veio da aba Avanços.</p>';
  }
  var blocos = '';
  for (var i = 0; i < BLOCOS.length; i++) blocos += renderBloco(BLOCOS[i], dados, modo);
  return renderControles(modo) + blocos;
}

module.exports = { renderAbaDemandas, acumularSerie, rotuloColunaFechamento, fechamento };
