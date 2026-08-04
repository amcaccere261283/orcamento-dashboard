'use strict';
const { avaliarAlertaTendencia, ALERTA_ROTULO} = require('./compute-alertas-tendencia.js');
const { calcularSeriesSemanaisDimensao, pendentesNaData} = require('./render-aba-semanal.js');
const { produtividadeEsperada, somarPrevistoMes} = require('./render-aba-consolidado.js');
const { agruparIndicesAlertas, tomadorDoGrupo, normalizarBusca} = require('./render-aba-alertas.js');
const { diasNaSemana, indiceSemanaAtual} = require('./compute-semanal.js');

// Bloco "Alertas de tendência" da aba Alertas -- os dois diagnósticos pedidos
// em 2026-08-04. Fica ABAIXO da tabela do semáforo e não altera nada dela: o
// semáforo mede desvio, este bloco responde "e daí?".
//
// SÓ na dimensão Volume, de propósito: as duas perguntas são físicas (furos em
// carteira, furos por equipe-dia). Em R$ não existe estoque de demanda, e em
// Equipes não existe Realizado semanal em lugar nenhum desta página.

var COR_ALERTA = '#c0392b';
var COR_SEM_DADO = '#95a5a6';

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatarNumero(v, casasDecimais) {
  if (v === null || v === undefined) return '—';
  var casas = casasDecimais === undefined ? 2 : casasDecimais;
  var fator = Math.pow(10, casas);
  return (Math.round(v * fator) / fator).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function renderCabecalhoAlertasTendencia(agruparPorRotulo) {
  return '<tr><th>' + escapeHtml(agruparPorRotulo || 'SUP') + '</th><th>Tomador</th><th>Alerta</th>'
    + '<th class="num">Realizado acum.</th><th class="num">Previsto acum.</th>'
    + '<th>Evidência</th><th>Status</th></tr>';
}

// A prova do alerta, em texto: sem ela a linha é uma acusação sem número.
function textoEvidencia(alerta) {
  if (alerta.status === 'sem-dado') {
    return alerta.tipo === 'demanda'
      ? 'Sem base de demandas carregada'
      : 'Sem equipes previstas ou sem premissa de produtividade';
  }
  if (alerta.tipo === 'demanda') {
    return 'Saldo de demandas ' + formatarNumero(alerta.saldoDemandas, 0)
      + ' · excedente projetado ' + formatarNumero(alerta.excedenteProjetado, 0);
  }
  return 'Produtividade exigida ' + formatarNumero(alerta.produtividadeExigida, 2)
    + ' · esperada ' + formatarNumero(alerta.produtividadeEsperada, 2)
    + ' (' + formatarNumero(alerta.equipesPrevistas, 2) + ' equipes previstas)';
}

function diasDoMesNasSemanas(semanas) {
  var total = 0;
  for (var i = 0; i < semanas.length; i++) total += diasNaSemana(semanas[i]);
  return total;
}

function renderLinhaGrupo(rotuloGrupo, registros, indices, ctx) {
  var series = calcularSeriesSemanaisDimensao(
    registros, indices, 'volume', ctx.mesIdx, ctx.semanas, ctx.semanas.length,
    ctx.temSemanasReais, ctx.indiceAtual, ctx.demandas, ctx.hojeEpoch
  );
  // Sem base de demandas carregada, nem sequer dá pra saber o ramo (R>P/R<P):
  // series.ramoTendencia fica 'sem-dado' e avaliarAlertaTendencia devolve null
  // pra esse ramo -- null significa "nada a dizer" (Task 4), não "sem dado".
  // Design spec (2026-08-04): ausência de insumo tem de aparecer como "Sem
  // dado", nunca sumir silenciosamente (isso leria como "tudo certo"). Por
  // isso o bypass aqui, ANTES de perguntar ao avaliador -- sem ele, a linha
  // some pra todo grupo assim que a base de demandas falha em carregar.
  var alerta = ctx.temDemandas
    ? avaliarAlertaTendencia({
        ramo: series.ramoTendencia,
        diagnostico: series.diagnosticoTendencia,
        mesIdx: ctx.mesIdx,
        diasDoMes: ctx.diasDoMes,
        saldoDemandas: pendentesNaData(registros, indices, ctx.demandas, ctx.hojeEpoch),
        equipesPrevistas: somarPrevistoMes(registros, indices, 'equipes', ctx.mesIdx),
        produtividadeEsperada: produtividadeEsperada(registros, indices, ctx.mesIdx),
      })
    : { tipo: 'demanda', status: 'sem-dado', realizadoAcumulado: null, previstoAcumulado: null };
  if (!alerta) return '';

  var tomador = tomadorDoGrupo(registros, indices);
  var rotulo = ALERTA_ROTULO[alerta.tipo];
  var cor = alerta.status === 'alerta' ? COR_ALERTA : COR_SEM_DADO;
  var statusTexto = alerta.status === 'alerta' ? 'Alerta' : 'Sem dado';
  var busca = normalizarBusca(rotuloGrupo + ' ' + tomador + ' ' + rotulo);
  return '<tr data-search="' + escapeHtml(busca) + '">'
    + '<td>' + escapeHtml(rotuloGrupo) + '</td>'
    + '<td>' + escapeHtml(tomador) + '</td>'
    + '<td>' + escapeHtml(rotulo) + '</td>'
    + '<td class="num">' + formatarNumero(alerta.realizadoAcumulado, 0) + '</td>'
    + '<td class="num">' + formatarNumero(alerta.previstoAcumulado, 0) + '</td>'
    + '<td>' + escapeHtml(textoEvidencia(alerta)) + '</td>'
    + '<td><span class="status-circulo" style="background:' + cor + '"></span>' + escapeHtml(statusTexto) + '</td>'
    + '</tr>';
}

// opcoes: { agruparPor, dimensao, mesIdx, semanas, demandas, hojeEpoch }
function renderCorpoAlertasTendencia(registros, indices, opcoes) {
  var o = opcoes || {};
  var semanas = o.semanas || [];
  if (o.dimensao !== 'volume') {
    // Nota fora de <tr>/<td>: o corpo desta função vira <tbody> na aba (o
    // cabeçalho já é um <tr> à parte), e um <tr> aqui obrigaria o navegador a
    // "adotar" a nota para fora da tabela (foster parenting do HTML5), lá em
    // cima do <thead> -- o mesmo padrão de nota (fora de tabela) já usado em
    // render-aba-demandas.js (`nota-demandas`) para "nada a mostrar aqui".
    return '<p class="nota-alertas-tendencia">'
      + 'Os alertas de tendência só existem na dimensão <strong>Volume</strong>: '
      + 'as duas perguntas que eles respondem são físicas (furos em carteira e furos por equipe-dia).'
      + '</p>';
  }
  if (!semanas.length || typeof o.hojeEpoch !== 'number') return '';

  var temDemandas = !!(o.demandas && o.demandas.porRegistroEventos);
  var ctx = {
    mesIdx: o.mesIdx,
    semanas: semanas,
    demandas: o.demandas,
    hojeEpoch: o.hojeEpoch,
    temDemandas: temDemandas,
    temSemanasReais: temDemandas,
    indiceAtual: indiceSemanaAtual(semanas, o.hojeEpoch),
    diasDoMes: diasDoMesNasSemanas(semanas),
  };
  var grupos = agruparIndicesAlertas(registros, indices, o.agruparPor || 'sup');
  return grupos.map(function (g) {
    return renderLinhaGrupo(g.chave, registros, g.indices, ctx);
  }).join('');
}

module.exports = { renderCorpoAlertasTendencia, renderCabecalhoAlertasTendencia, ALERTA_ROTULO };
