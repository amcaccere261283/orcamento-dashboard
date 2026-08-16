'use strict';
const { semanasDoMes, indiceSemanaAtual } = require('./compute-semanal.js');
const { calcularSeriesSemanaisDimensao } = require('./render-aba-semanal.js');
const { agregarFatias, janelaDoPeriodo, semanasElapsadas, classificarSemaforo, PERIODO_ACUMULADO } = require('./render-aba-alertas.js');
const { blocosPorSup, tipologiasPresentes } = require('./render-aba-consolidado.js');

// Módulo dual Node+navegador (bundle) -- mesmo padrão 'var'/'function' e
// requires same-dir de render-aba-alertas.js/render-aba-consolidado.js.
//
// Este módulo NÃO recalcula nada -- é um MONTADOR sobre calcularSeries
// SemanaisDimensao (a mesma função que Tabela Semanal/Consolidado/Alertas já
// usam) e sobre agregarFatias/janelaDoPeriodo (o mesmo período "Acumulado
// até a semana atual" que a aba Alertas já expõe). Garantia: o relatório
// nunca pode divergir do que a página mostra, porque é o MESMO cálculo.

// A semana ANTERIOR ou SEGUINTE a semanas[indiceAtual], podendo cair num mês
// (e ano) civil diferente. semanasDoMes(ano, mesIdx) aceita mesIdx fora de
// [0,11]: o overflow de mês do Date.UTC do JavaScript resolve o rollover de
// ano sozinho, então as datas da semana vizinha saem corretas mesmo quando
// mesIdxVizinho é -1 (dezembro do ano anterior) ou 12 (janeiro do ano
// seguinte). O QUE NÃO sai correto nesse caso é o Previsto/Tendência: os
// registros só carregam os 12 meses de window.__ANO__, então
// registro.previsto.volume[-1] e [12] são sempre undefined --
// calcularSeriesSemanaisDimensao já trata isso como "sem dado" sozinha, sem
// nenhuma guarda extra precisar existir aqui (limitação conhecida e aceita,
// ver o spec -- só afeta a 1ª semana de janeiro e a última de dezembro).
function semanaAnterior(ano, mesIdx, semanas, indiceAtual) {
  if (indiceAtual - 1 >= 0) {
    return { semana: semanas[indiceAtual - 1], mesIdx: mesIdx, semanasDoMesAlvo: semanas, indiceNoMes: indiceAtual - 1 };
  }
  var semanasMesAnterior = semanasDoMes(ano, mesIdx - 1);
  return {
    semana: semanasMesAnterior[semanasMesAnterior.length - 1],
    mesIdx: mesIdx - 1, semanasDoMesAlvo: semanasMesAnterior, indiceNoMes: semanasMesAnterior.length - 1,
  };
}

function semanaSeguinte(ano, mesIdx, semanas, indiceAtual) {
  if (indiceAtual + 1 < semanas.length) {
    return { semana: semanas[indiceAtual + 1], mesIdx: mesIdx, semanasDoMesAlvo: semanas, indiceNoMes: indiceAtual + 1 };
  }
  var semanasMesSeguinte = semanasDoMes(ano, mesIdx + 1);
  return { semana: semanasMesSeguinte[0], mesIdx: mesIdx + 1, semanasDoMesAlvo: semanasMesSeguinte, indiceNoMes: 0 };
}

// Previsto/Realizado/Tendência de 'alvo.semana' -- mesmo mecanismo de
// congelamento de renderLinha (render-aba-consolidado.js): Realizado sai
// SEMPRE do hoje real (congelá-lo mostraria ~0 numa semana que produziu de
// verdade); Tendência é recalculada com hojeEpoch = início da semana quando
// ela já começou (encerrada ou em curso), e com o hoje real quando ainda não
// começou (projeção corrente -- é o caso de "semana que vem").
function serieDaSemana(registros, indices, dimensao, alvo, ctx) {
  var semanas = alvo.semanasDoMesAlvo;
  var indiceAtualReal = indiceSemanaAtual(semanas, ctx.hojeEpoch);
  var seriesAoVivo = calcularSeriesSemanaisDimensao(
    registros, indices, dimensao, alvo.mesIdx, semanas, semanas.length,
    ctx.temSemanasReais, indiceAtualReal, ctx.demandas, ctx.hojeEpoch, ctx.mesAtualReal
  );
  var congelar = alvo.semana.inicio <= ctx.hojeEpoch;
  var hojeEfetivo = congelar ? alvo.semana.inicio : ctx.hojeEpoch;
  var seriesTendencia = hojeEfetivo === ctx.hojeEpoch ? seriesAoVivo : calcularSeriesSemanaisDimensao(
    registros, indices, dimensao, alvo.mesIdx, semanas, semanas.length,
    ctx.temSemanasReais, indiceSemanaAtual(semanas, hojeEfetivo), ctx.demandas, hojeEfetivo, ctx.mesAtualReal
  );
  return {
    previsto: seriesAoVivo.semanasPrevisto[alvo.indiceNoMes],
    realizado: seriesAoVivo.semanasRealizado[alvo.indiceNoMes],
    tendencia: seriesTendencia.semanasTendenciaCompleta[alvo.indiceNoMes],
  };
}

// Previsto/Realizado/Tendência acumulados de S1 até a semana vigente do mês
// SELECIONADO (nunca cruza mês -- "acumulado do mês" é sempre do mês na
// tela). Reaproveita agregarFatias/janelaDoPeriodo(PERIODO_ACUMULADO), a
// MESMA conta que a aba Alertas já usa para esse período.
function serieAcumulada(registros, indices, dimensao, ctx) {
  var elapsadas = semanasElapsadas(ctx.semanas, ctx.hojeEpoch);
  var series = calcularSeriesSemanaisDimensao(
    registros, indices, dimensao, ctx.mesIdx, ctx.semanas, ctx.semanas.length,
    ctx.temSemanasReais, ctx.indiceAtual, ctx.demandas, ctx.hojeEpoch, ctx.mesAtualReal
  );
  var janela = janelaDoPeriodo(PERIODO_ACUMULADO, ctx.semanas.length, elapsadas);
  return {
    previsto: agregarFatias(series.semanasPrevisto, dimensao, janela),
    realizado: agregarFatias(series.semanasRealizado, dimensao, janela),
    tendencia: agregarFatias(series.semanasTendenciaCompleta, dimensao, janela),
  };
}

// As 3 janelas de UM grupo (SUP inteiro, uma tipologia agregada, ou um
// registro/contrato), para uma dimensão.
function janelasDoGrupo(registros, indices, dimensao, ctx) {
  var alvoAnterior = semanaAnterior(ctx.ano, ctx.mesIdx, ctx.semanas, ctx.indiceAtual);
  var alvoSeguinte = semanaSeguinte(ctx.ano, ctx.mesIdx, ctx.semanas, ctx.indiceAtual);
  var semanaAnt = serieDaSemana(registros, indices, dimensao, alvoAnterior, ctx);
  var semanaSeg = serieDaSemana(registros, indices, dimensao, alvoSeguinte, ctx);
  return {
    semanaAnterior: semanaAnt,
    acumulado: serieAcumulada(registros, indices, dimensao, ctx),
    semanaQueVem: { previsto: semanaSeg.previsto, tendencia: semanaSeg.tendencia },
  };
}

function linhaGrupo(tipo, celulas, registros, indices, dimensao, ctx) {
  return {
    tipo: tipo, sup: celulas.sup, tomador: celulas.tomador, tipologia: celulas.tipologia,
    contrato: celulas.contrato || null,
    janelas: janelasDoGrupo(registros, indices, dimensao, ctx),
  };
}

// Mesma hierarquia de renderAbaConsolidado (render-aba-consolidado.js):
// TOTAL GERAL -> TOTAL GERAL por tipologia -> por SUP: um registro por linha
// (= por tipologia daquele SUP, que É o contrato -- ver o comentário no topo
// de render-aba-consolidado.js) + TOTAL <SUP>. Devolve um array plano, na
// ordem de exibição.
function montarLinhasDimensao(registros, indices, dimensao, ctx) {
  var linhas = [];
  var todos = indices || [];

  linhas.push(linhaGrupo('total-geral', { sup: '—', tomador: 'Todos', tipologia: 'TOTAL GERAL' }, registros, todos, dimensao, ctx));

  tipologiasPresentes(registros, todos).forEach(function (bloco) {
    linhas.push(linhaGrupo('total-geral-tipologia', { sup: '—', tomador: 'Todos', tipologia: bloco.tipologia }, registros, bloco.indices, dimensao, ctx));
  });

  blocosPorSup(registros, todos).forEach(function (blocoSup) {
    blocoSup.indices.forEach(function (idx) {
      var registro = registros[idx];
      linhas.push(linhaGrupo('registro', {
        sup: registro.sup, tomador: registro.tomador, tipologia: registro.tipologia, contrato: registro.sup,
      }, registros, [idx], dimensao, ctx));
    });
    var primeiro = registros[blocoSup.indices[0]];
    linhas.push(linhaGrupo('total-sup', { sup: blocoSup.sup, tomador: primeiro.tomador, tipologia: 'TOTAL' }, registros, blocoSup.indices, dimensao, ctx));
  });

  return linhas;
}

// Base de comparação por janela: sempre "o que aconteceu/vai acontecer" ÷
// Previsto -- mesma leitura do semáforo de Alertas. "Semana que vem" não tem
// Realizado (ainda não aconteceu): usa Tendência.
function desvioDaJanela(nomeJanela, janela) {
  var numerador = nomeJanela === 'semanaQueVem' ? janela.tendencia : janela.realizado;
  var desvio = (numerador === null || numerador === undefined || !janela.previsto)
    ? null : numerador / janela.previsto;
  return { desvio: desvio, previsto: janela.previsto, numerador: numerador };
}

var JANELA_ROTULO = {
  semanaAnterior: 'Semana anterior', acumulado: 'Acumulado do mês até a data', semanaQueVem: 'Semana que vem',
};
var DIMENSAO_ROTULO_RELATORIO = { volume: 'Volume', equipes: 'Equipes' };

// Uma linha de desvio por (linha da hierarquia x janela), só quando o
// semáforo classifica Crítico ou Atenção -- Excelente/Dentro da meta/Sem
// dado não entram neste capítulo.
function extrairDesvios(linhas, dimensao) {
  var desvios = [];
  linhas.forEach(function (linha) {
    ['semanaAnterior', 'acumulado', 'semanaQueVem'].forEach(function (nomeJanela) {
      var calculo = desvioDaJanela(nomeJanela, linha.janelas[nomeJanela]);
      var classe = classificarSemaforo(calculo.desvio);
      if (classe.indicador !== 'Crítico' && classe.indicador !== 'Atenção') return;
      desvios.push({
        sup: linha.sup, tomador: linha.tomador, tipologia: linha.tipologia, contrato: linha.contrato,
        janela: JANELA_ROTULO[nomeJanela], dimensao: DIMENSAO_ROTULO_RELATORIO[dimensao],
        previsto: calculo.previsto, numerador: calculo.numerador, desvio: calculo.desvio,
        status: classe.indicador, cor: classe.cor,
      });
    });
  });
  return desvios;
}

// linhasPorDimensao: { volume: linhas de montarLinhasDimensao, equipes: linhas }.
// Devolve { porTipologia, porContrato }, cruzando as duas dimensões.
function montarDesvios(linhasPorDimensao) {
  var porTipologia = [];
  var porContrato = [];
  ['volume', 'equipes'].forEach(function (dimensao) {
    var linhas = linhasPorDimensao[dimensao] || [];
    var tipologiaLinhas = linhas.filter(function (l) { return l.tipo === 'total-geral-tipologia'; });
    var contratoLinhas = linhas.filter(function (l) { return l.tipo === 'registro'; });
    porTipologia = porTipologia.concat(extrairDesvios(tipologiaLinhas, dimensao));
    porContrato = porContrato.concat(extrairDesvios(contratoLinhas, dimensao));
  });
  return { porTipologia: porTipologia, porContrato: porContrato };
}

// Contagem de Crítico/Atenção da geração inteira, pro capítulo Resumo do
// .xlsx e pra linha-resumo do histórico -- soma só porContrato (o nível mais
// fino), pra não contar duas vezes o mesmo desvio físico (que também
// aparece agregado em porTipologia). 'critico'/'atencao' são o total (forma
// já existente, consumida por render-semanal.js sem mudança); 'porDimensao'
// é aditivo -- a quebra por Volume/Equipes que o capítulo Resumo passou a
// mostrar ao lado do total.
function resumoDesvios(desvios) {
  var resumo = { critico: 0, atencao: 0, porDimensao: {} };
  (desvios.porContrato || []).forEach(function (d) {
    if (!resumo.porDimensao[d.dimensao]) resumo.porDimensao[d.dimensao] = { critico: 0, atencao: 0 };
    if (d.status === 'Crítico') { resumo.critico++; resumo.porDimensao[d.dimensao].critico++; }
    else if (d.status === 'Atenção') { resumo.atencao++; resumo.porDimensao[d.dimensao].atencao++; }
  });
  return resumo;
}

module.exports = {
  semanaAnterior, semanaSeguinte, serieDaSemana, serieAcumulada, janelasDoGrupo, montarLinhasDimensao,
  extrairDesvios, montarDesvios, resumoDesvios, JANELA_ROTULO, DIMENSAO_ROTULO_RELATORIO,
};
