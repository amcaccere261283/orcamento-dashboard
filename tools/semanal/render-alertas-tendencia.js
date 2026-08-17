'use strict';
const { avaliarAlertaTendencia, ALERTA_ROTULO} = require('./compute-alertas-tendencia.js');
const { calcularSeriesSemanaisDimensao } = require('./render-aba-semanal.js');
const { somarPrevistoMes} = require('./render-aba-consolidado.js');
const { agruparIndicesAlertas, tomadorDoGrupo, normalizarBusca} = require('./render-aba-alertas.js');
const { diasNaSemana, indiceSemanaAtual} = require('./compute-semanal.js');

// Bloco "Alertas de tendência" da aba Alertas -- os dois diagnósticos pedidos
// em 2026-08-04. Fica ABAIXO da tabela do semáforo e não altera nada dela: o
// semáforo mede desvio, este bloco responde "e daí?".
//
// SÓ na dimensão Volume, de propósito: as duas perguntas são físicas (furos em
// carteira, furos por equipe-dia). Em R$ não existe estoque de demanda, e em
// Equipes não existe Realizado semanal em lugar nenhum desta página.
//
// O alerta do ramo R>P mudou de pergunta em 2026-08-17 -- ver
// docs/superpowers/specs/2026-08-17-semanal-tendencia-ramo-acima-design.md.

var COR_ALERTA = '#c0392b';
var COR_SEM_DADO = '#95a5a6';

// Rótulo do caso "não dá nem pra saber o ramo" (sem base de demandas
// carregada) -- não é um dos dois alertas de ALERTA_ROTULO (compute-alertas-
// tendencia.js), então não entra lá: nomear a linha "Avaliar movimentação de
// equipe" ou "Equipes com pouco recurso" seria afirmar qual das duas
// perguntas ficou pendente quando, na verdade, nenhuma chegou a ser feita.
var ROTULO_SEM_AVALIACAO = 'Tendência não avaliada';

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
  if (alerta.tipo === 'sem-avaliacao') {
    return 'Sem base de demandas carregada -- sem ela não dá pra saber se o ritmo está acima ou abaixo do plano';
  }
  if (alerta.status === 'sem-dado') {
    // Só o Alerta B (produtividade) chega aqui -- o de movimentação nunca tem
    // 'sem-dado' (só olha o próprio diagnóstico, sem insumo externo).
    return 'Sem equipes previstas ou sem premissa de produtividade';
  }
  if (alerta.tipo === 'movimentacao') {
    return 'Ritmo médio nas semanas fechadas ' + formatarNumero(alerta.ritmoAnterior, 2)
      + ' furos/dia · nenhum avanço registrado na semana em curso';
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

// A referência de produtividade do Alerta B: a premissa PROD. da planilha,
// média das premissas dos registros do grupo PONDERADA pelo volume previsto de
// cada um no mês -- Σ(volume_i × prod_i) ÷ Σ(volume_i). Registro sem premissa,
// ou com volume nulo/zero no mês, fica fora dos dois somatórios; se ninguém
// contribuir, devolve null e o alerta vira 'sem-dado'. Com UM registro só a
// fórmula devolve o próprio prod dele, sem precisar de caso especial.
//
// POR QUE não usar produtividadeEsperada() do Consolidado, que era o que
// estava aqui: para um grupo AGREGADO ela RECALCULA V ÷ (E × D), e V, E e D
// são exatamente os mesmos números que a produtividade exigida usa. Fazendo a
// álgebra, o teste "exigida > esperada" vira "saldo > V × R/C": E e D se
// cancelam, e o alerta que prometia responder "as equipes previstas dão conta
// do saldo?" respondia "o realizado está abaixo do plano pro-rata?". Medido na
// revisão final de 2026-08-04: com os mesmos furos, 2 equipes previstas e
// 200.000 equipes previstas disparavam igual. Como a premissa da planilha não
// depende de E, o E deixa de se cancelar e o alerta volta a medir equipes.
//
// produtividadeEsperada() continua intacta em render-aba-consolidado.js de
// propósito: ela alimenta a coluna "Produtividade média esperada" do
// Consolidado, cuja regra de dois ramos é copiada do dashboard de orçamento e
// tem de continuar batendo com ele. São duas perguntas diferentes.
function premissaProdutividadeDoGrupo(registros, indices, mesIdx) {
  var somaVolume = 0;
  var somaPonderada = 0;
  (indices || []).forEach(function (i) {
    var registro = registros[i];
    var previsto = registro && registro.previsto;
    if (!previsto) return;
    var prod = previsto.equipesResumo && previsto.equipesResumo.prod;
    if (prod === null || prod === undefined) return;
    if (!Array.isArray(previsto.volume)) return;
    var volume = previsto.volume[mesIdx];
    if (volume === null || volume === undefined || !volume) return;
    somaVolume += volume;
    somaPonderada += volume * prod;
  });
  if (!somaVolume) return null;
  return somaPonderada / somaVolume;
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
  // tipo 'sem-avaliacao' (não é um dos dois de ALERTA_ROTULO, de propósito:
  // sem saber o ramo não dá pra afirmar qual das duas perguntas ficou em
  // aberto -- ver ROTULO_SEM_AVALIACAO acima).
  var alerta = ctx.temDemandas
    ? avaliarAlertaTendencia({
        ramo: series.ramoTendencia,
        diagnostico: series.diagnosticoTendencia,
        mesIdx: ctx.mesIdx,
        diasDoMes: ctx.diasDoMes,
        equipesPrevistas: somarPrevistoMes(registros, indices, 'equipes', ctx.mesIdx),
        produtividadeEsperada: premissaProdutividadeDoGrupo(registros, indices, ctx.mesIdx),
      })
    : { tipo: 'sem-avaliacao', status: 'sem-dado', realizadoAcumulado: null, previstoAcumulado: null };
  if (!alerta) return '';

  var tomador = tomadorDoGrupo(registros, indices);
  var rotulo = alerta.tipo === 'sem-avaliacao' ? ROTULO_SEM_AVALIACAO : ALERTA_ROTULO[alerta.tipo];
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
    // O retorno desta função vai direto pro innerHTML de um <tbody> (o
    // cabeçalho já é um <tr> à parte, ver renderCabecalhoAlertasTendencia) --
    // por isso a nota também é um <tr>/<td colspan>, não um <p>: um <p> aqui
    // é que seria içado pra fora da tabela pelo parser HTML5 (foster
    // parenting), não o contrário.
    return '<tr class="linha-nota-alertas"><td colspan="7">'
      + 'Os alertas de tendência só existem na dimensão <strong>Volume</strong>: '
      + 'as duas perguntas que eles respondem são físicas (furos em carteira e furos por equipe-dia).'
      + '</td></tr>';
  }
  if (!semanas.length || typeof o.hojeEpoch !== 'number') return '';

  // Mês inteiramente no passado (não há futuro a projetar) ou inteiramente no
  // futuro (não há passado a julgar): o design manda não aparecer alerta
  // nenhum. Com a base de demandas carregada isso já acontecia sozinho -- o
  // avaliador devolve null nos dois casos --, mas o bypass de "sem base de
  // demandas" abaixo é anterior a ele e emitia uma linha "Sem dado" por grupo
  // justamente onde NADA seria avaliado nem com a base presente. A guarda é
  // de calendário, então vale igual para todos os grupos e cabe aqui.
  if (semanas[semanas.length - 1].fim < o.hojeEpoch) return '';
  if (semanas[0].inicio > o.hojeEpoch) return '';

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

module.exports = {
  renderCorpoAlertasTendencia, renderCabecalhoAlertasTendencia,
  // Exportada só para teste direto da ponderação -- o render é o único
  // consumidor de produção.
  premissaProdutividadeDoGrupo,
  ALERTA_ROTULO,
};
