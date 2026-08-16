'use strict';
const ComputeRelatorioSemanal = require('./compute-relatorio-semanal.js');
const XlsxWriterBrowser = require('./xlsx-writer-browser.js');

var str = XlsxWriterBrowser.str;
var num = XlsxWriterBrowser.num;

function celulaNumOuVazia(v) {
  return (v === null || v === undefined) ? str('') : num(v);
}

function formatarDesvioTexto(d) {
  return (d === null || d === undefined) ? '' : Math.round(d * 100) + '%';
}

function doisDigitos(n) { return (n < 10 ? '0' : '') + n; }

function formatarDataCurta(diaEp) {
  var d = new Date(diaEp * 86400000);
  return doisDigitos(d.getUTCDate()) + '/' + doisDigitos(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
}

function formatarDataHora(date) {
  return doisDigitos(date.getDate()) + '/' + doisDigitos(date.getMonth() + 1) + '/' + date.getFullYear()
    + ' ' + doisDigitos(date.getHours()) + ':' + doisDigitos(date.getMinutes());
}

function montarAbaResumo(opcoes, resumo) {
  var semanaVigente = opcoes.semanas[opcoes.indiceAtual];
  var rows = [
    [str('Relatório Semanal — Planejamento')],
    [str('Semana vigente'), str(semanaVigente ? formatarDataCurta(semanaVigente.inicio) + ' a ' + formatarDataCurta(semanaVigente.fim) : '—')],
    [str('Gerado em'), str(formatarDataHora(opcoes.geradoEm))],
    [str('Gerado por'), str(opcoes.autor || 'dashboard')],
    [str('')],
    [str('Desvios Crítico'), num(resumo.critico)],
    [str('Desvios Atenção'), num(resumo.atencao)],
  ];
  return { name: 'Resumo', rows: rows };
}

var CABECALHO_DESVIOS = [
  str('SUP'), str('Tomador'), str('Tipologia'), str('Contrato'), str('Janela'), str('Dimensão'),
  str('Previsto'), str('Realizado/Tendência'), str('Desvio %'), str('Status'), str('Ação'), str('Responsável'),
];

function casasDaDimensaoRotulo(dimensaoRotulo) {
  return dimensaoRotulo === 'Equipes' ? 2 : 0;
}

function linhaDesvio(d) {
  var casas = casasDaDimensaoRotulo(d.dimensao);
  return [
    str(d.sup), str(d.tomador), str(d.tipologia), str(d.contrato || ''), str(d.janela), str(d.dimensao),
    celulaNumOuVazia(arredondar(d.previsto, casas)), celulaNumOuVazia(arredondar(d.numerador, casas)),
    str(formatarDesvioTexto(d.desvio)), str(d.status), str(''), str(''),
  ];
}

function montarAbaDesvios(desvios) {
  var rows = [[str('Por tipologia')], CABECALHO_DESVIOS.slice()];
  var linhaInicioTipologia = rows.length + 1;
  desvios.porTipologia.forEach(function (d) { rows.push(linhaDesvio(d)); });
  var linhaFimTipologia = rows.length;

  rows.push([str('')]);
  rows.push([str('Por contrato')]);
  rows.push(CABECALHO_DESVIOS.slice());
  var linhaInicioContrato = rows.length + 1;
  desvios.porContrato.forEach(function (d) { rows.push(linhaDesvio(d)); });
  var linhaFimContrato = rows.length;

  var colunaStatus = 'J'; // 10ª coluna de CABECALHO_DESVIOS (A..L)
  var conditionalFormats = [];
  if (linhaFimTipologia >= linhaInicioTipologia) {
    conditionalFormats.push({ sqref: colunaStatus + linhaInicioTipologia + ':' + colunaStatus + linhaFimTipologia, color: 'critico', text: 'Crítico' });
    conditionalFormats.push({ sqref: colunaStatus + linhaInicioTipologia + ':' + colunaStatus + linhaFimTipologia, color: 'atencao', text: 'Atenção' });
  }
  if (linhaFimContrato >= linhaInicioContrato) {
    conditionalFormats.push({ sqref: colunaStatus + linhaInicioContrato + ':' + colunaStatus + linhaFimContrato, color: 'critico', text: 'Crítico' });
    conditionalFormats.push({ sqref: colunaStatus + linhaInicioContrato + ':' + colunaStatus + linhaFimContrato, color: 'atencao', text: 'Atenção' });
  }
  return { name: 'Desvios', rows: rows, conditionalFormats: conditionalFormats };
}

function casasDaDimensao(dimensao) { return dimensao === 'equipes' ? 2 : 0; }

function arredondar(v, casas) {
  if (v === null || v === undefined) return null;
  var fator = Math.pow(10, casas);
  return Math.round(v * fator) / fator;
}

var CABECALHO_DIMENSAO = [
  str('SUP'), str('Tomador'), str('Tipologia'), str('Contrato'),
  str('Semana anterior — Previsto'), str('Semana anterior — Realizado'), str('Semana anterior — Tendência'),
  str('Acumulado do mês — Previsto'), str('Acumulado do mês — Realizado'), str('Acumulado do mês — Tendência'),
  str('Semana que vem — Previsto'), str('Semana que vem — Tendência'),
];

function linhaDimensao(linha, dimensao) {
  var casas = casasDaDimensao(dimensao);
  var j = linha.janelas;
  return [
    str(linha.sup), str(linha.tomador), str(linha.tipologia), str(linha.contrato || ''),
    celulaNumOuVazia(arredondar(j.semanaAnterior.previsto, casas)),
    celulaNumOuVazia(arredondar(j.semanaAnterior.realizado, casas)),
    celulaNumOuVazia(arredondar(j.semanaAnterior.tendencia, casas)),
    celulaNumOuVazia(arredondar(j.acumulado.previsto, casas)),
    celulaNumOuVazia(arredondar(j.acumulado.realizado, casas)),
    celulaNumOuVazia(arredondar(j.acumulado.tendencia, casas)),
    celulaNumOuVazia(arredondar(j.semanaQueVem.previsto, casas)),
    celulaNumOuVazia(arredondar(j.semanaQueVem.tendencia, casas)),
  ];
}

function montarAbaDimensao(nomeAba, linhas, dimensao) {
  var rows = [CABECALHO_DIMENSAO.slice()];
  linhas.forEach(function (linha) { rows.push(linhaDimensao(linha, dimensao)); });
  return { name: nomeAba, rows: rows };
}

// opcoes: { registros, indices, ano, mesIdx, semanas, indiceAtual, demandas,
//   hojeEpoch, mesAtualReal?, geradoEm: Date, autor: string }.
function gerarRelatorioSemanalXlsx(opcoes) {
  var ctx = {
    ano: opcoes.ano, mesIdx: opcoes.mesIdx, semanas: opcoes.semanas, indiceAtual: opcoes.indiceAtual,
    demandas: opcoes.demandas, hojeEpoch: opcoes.hojeEpoch, mesAtualReal: opcoes.mesAtualReal,
    temSemanasReais: !!(opcoes.demandas && opcoes.demandas.porRegistroEventos),
  };
  var linhasVolume = ComputeRelatorioSemanal.montarLinhasDimensao(opcoes.registros, opcoes.indices, 'volume', ctx);
  var linhasEquipes = ComputeRelatorioSemanal.montarLinhasDimensao(opcoes.registros, opcoes.indices, 'equipes', ctx);
  var desvios = ComputeRelatorioSemanal.montarDesvios({ volume: linhasVolume, equipes: linhasEquipes });
  var resumo = ComputeRelatorioSemanal.resumoDesvios(desvios);

  var sheets = [
    montarAbaResumo(opcoes, resumo),
    montarAbaDesvios(desvios),
    montarAbaDimensao('Volume', linhasVolume, 'volume'),
    montarAbaDimensao('Equipes', linhasEquipes, 'equipes'),
  ];
  return {
    bytes: XlsxWriterBrowser.buildXlsx(sheets),
    resumo: resumo, desvios: desvios, linhasVolume: linhasVolume, linhasEquipes: linhasEquipes,
  };
}

module.exports = { gerarRelatorioSemanalXlsx, montarAbaResumo, montarAbaDesvios, montarAbaDimensao };
