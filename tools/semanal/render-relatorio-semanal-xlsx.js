'use strict';
// Requires DESTRUTURADOS de propósito (não `const X = require(...)`): é o
// padrão que tools/comum/browser-bundle.js sabe reescrever
// (transformaModulo) para MODULOS['arquivo.js'] no bundle do navegador --
// um require não-destruturado sobrevive ao build sem erro, mas quebra em
// silêncio no navegador com "require is not defined" na primeira vez que a
// função é chamada.
const { montarLinhasDimensao, montarDesvios, resumoDesvios, semanaAnterior, semanaSeguinte } = require('./compute-relatorio-semanal.js');
const { str, num, buildXlsx } = require('./xlsx-writer-browser.js');

// !Number.isFinite cobre tanto NaN quanto ±Infinity: um NaN chegando aqui
// serializaria como <v>NaN</v>, um .xlsx que o Excel recusa abrir -- melhor
// uma célula vazia do que um arquivo corrompido.
function celulaNumOuVazia(v, estiloNumero) {
  return (v === null || v === undefined || !Number.isFinite(v)) ? str('') : num(v, estiloNumero);
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

var NOMES_MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

var COLS_RESUMO = [32, 24];

// A capa precisa dizer QUAL período o relatório descreve -- antes só nomeava
// a semana vigente, e nem o mês/ano do relatório apareciam em lugar nenhum
// do arquivo. E as contagens de desvio são explicitamente "(por contrato)",
// pra não parecerem contradizer o que a aba Desvios mostra logo depois (que
// exibe TANTO por tipologia QUANTO por contrato -- ver o comentário de
// resumoDesvios em compute-relatorio-semanal.js sobre por que só porContrato
// entra na contagem, pra não contar o mesmo desvio físico duas vezes).
function montarAbaResumo(opcoes, resumo, janelaAnterior, janelaSeguinte) {
  var semanaVigente = opcoes.semanas[opcoes.indiceAtual];
  function intervalo(alvo) {
    return alvo && alvo.semana ? formatarDataCurta(alvo.semana.inicio) + ' a ' + formatarDataCurta(alvo.semana.fim) : '—';
  }
  var volumeResumo = resumo.porDimensao.Volume || { critico: 0, atencao: 0 };
  var equipesResumo = resumo.porDimensao.Equipes || { critico: 0, atencao: 0 };
  var rows = [
    [str('Relatório Semanal — Planejamento · Resumo', 'titulo'), str('', 'titulo')],
    [str('Mês/ano do relatório', 'rotulo'), str(NOMES_MES[opcoes.mesIdx] + '/' + opcoes.ano)],
    [str('Semana anterior', 'rotulo'), str(intervalo(janelaAnterior))],
    [str('Semana vigente', 'rotulo'), str(semanaVigente ? formatarDataCurta(semanaVigente.inicio) + ' a ' + formatarDataCurta(semanaVigente.fim) : '—')],
    [str('Semana que vem', 'rotulo'), str(intervalo(janelaSeguinte))],
    [str('Gerado em', 'rotulo'), str(formatarDataHora(opcoes.geradoEm))],
    [str('Gerado por', 'rotulo'), str(opcoes.autor || 'dashboard')],
    [str('')],
    [str('Desvios Crítico (por contrato)', 'rotulo'), num(resumo.critico)],
    [str('Desvios Atenção (por contrato)', 'rotulo'), num(resumo.atencao)],
    [str('  Volume — Crítico', 'rotulo'), num(volumeResumo.critico)],
    [str('  Volume — Atenção', 'rotulo'), num(volumeResumo.atencao)],
    [str('  Equipes — Crítico', 'rotulo'), num(equipesResumo.critico)],
    [str('  Equipes — Atenção', 'rotulo'), num(equipesResumo.atencao)],
  ];
  return { name: 'Resumo', rows: rows, colWidths: COLS_RESUMO, rowHeights: { 1: 28 }, merges: ['A1:B1'] };
}

var CABECALHO_DESVIOS = [
  str('SUP', 'cabecalhoTabela'), str('Tomador', 'cabecalhoTabela'), str('Tipologia', 'cabecalhoTabela'), str('Contrato', 'cabecalhoTabela'),
  str('Janela', 'cabecalhoTabela'), str('Dimensão', 'cabecalhoTabela'),
  str('Previsto', 'cabecalhoTabela'), str('Realizado/Tendência', 'cabecalhoTabela'), str('Desvio %', 'cabecalhoTabela'),
  str('Status', 'cabecalhoTabela'), str('Ação', 'cabecalhoTabela'), str('Responsável', 'cabecalhoTabela'),
];

// Duas casas quase-idênticas porque os domínios de entrada são diferentes:
// esta recebe o RÓTULO de exibição ('Volume'/'Equipes', capitalizado --
// DIMENSAO_ROTULO_RELATORIO em compute-relatorio-semanal.js), usada pela
// aba Desvios, que só conhece o desvio já rotulado. casasDaDimensao (mais
// abaixo) recebe a chave CRUA ('volume'/'equipes'), usada pelas abas
// Volume/Equipes, que já têm a chave de antemão. Fundir as duas exigiria
// normalizar um lado ou outro em todo chamador -- não valeu o troco por
// duas linhas.
function casasDaDimensaoRotulo(dimensaoRotulo) {
  return dimensaoRotulo === 'Equipes' ? 2 : 0;
}

function linhaDesvio(d, zebra) {
  var casas = casasDaDimensaoRotulo(d.dimensao);
  var estiloTexto = zebra ? 'textoZebra' : 'texto';
  var estiloNumero = casas === 2
    ? (zebra ? 'numeroDuasCasasZebra' : 'numeroDuasCasas')
    : (zebra ? 'numeroMilharZebra' : 'numeroMilhar');
  return [
    str(d.sup, estiloTexto), str(d.tomador, estiloTexto), str(d.tipologia, estiloTexto), str(d.contrato || '', estiloTexto),
    str(d.janela, estiloTexto), str(d.dimensao, estiloTexto),
    celulaNumOuVazia(arredondar(d.previsto, casas), estiloNumero), celulaNumOuVazia(arredondar(d.numerador, casas), estiloNumero),
    str(formatarDesvioTexto(d.desvio), estiloTexto), str(d.status, estiloTexto), str('', estiloTexto), str('', estiloTexto),
  ];
}

var COLS_DESVIOS = [12, 26, 16, 14, 28, 12, 12, 18, 10, 12, 22, 18];

function montarAbaDesvios(desvios, subtitulo) {
  var sufixo = subtitulo ? ' · ' + subtitulo : '';
  var rows = [
    [str('Relatório Semanal — Planejamento · Desvios' + sufixo, 'titulo')],
  ];
  var linhaInicioTipologia = 0, linhaFimTipologia = 0;
  var linhaInicioContrato = 0, linhaFimContrato = 0;
  var colunaStatus = 'J'; // 10ª coluna de CABECALHO_DESVIOS (A..L)
  var conditionalFormats = [];

  if (desvios.porTipologia.length > 0) {
    rows.push([str('Por tipologia', 'rotulo')]);
    rows.push(CABECALHO_DESVIOS.slice());
    linhaInicioTipologia = rows.length + 1;
    desvios.porTipologia.forEach(function (d, i) { rows.push(linhaDesvio(d, i % 2 === 1)); });
    linhaFimTipologia = rows.length;
    rows.push([str('')]);
    if (linhaFimTipologia >= linhaInicioTipologia) {
      conditionalFormats.push({ sqref: colunaStatus + linhaInicioTipologia + ':' + colunaStatus + linhaFimTipologia, color: 'critico', text: 'Crítico' });
      conditionalFormats.push({ sqref: colunaStatus + linhaInicioTipologia + ':' + colunaStatus + linhaFimTipologia, color: 'atencao', text: 'Atenção' });
    }
  }

  if (desvios.porContrato.length > 0) {
    rows.push([str('Por contrato', 'rotulo')]);
    rows.push(CABECALHO_DESVIOS.slice());
    linhaInicioContrato = rows.length + 1;
    desvios.porContrato.forEach(function (d, i) { rows.push(linhaDesvio(d, i % 2 === 1)); });
    linhaFimContrato = rows.length;
    if (linhaFimContrato >= linhaInicioContrato) {
      conditionalFormats.push({ sqref: colunaStatus + linhaInicioContrato + ':' + colunaStatus + linhaFimContrato, color: 'critico', text: 'Crítico' });
      conditionalFormats.push({ sqref: colunaStatus + linhaInicioContrato + ':' + colunaStatus + linhaFimContrato, color: 'atencao', text: 'Atenção' });
    }
  }

  return {
    name: 'Desvios', rows: rows, conditionalFormats: conditionalFormats,
    colWidths: COLS_DESVIOS, freezeRows: 3, rowHeights: { 1: 28, 3: 30 }, merges: ['A1:L1'],
  };
}

// Ver o comentário de casasDaDimensaoRotulo acima -- esta recebe a chave
// CRUA ('volume'/'equipes'), não o rótulo capitalizado.
function casasDaDimensao(dimensao) { return dimensao === 'equipes' ? 2 : 0; }

function arredondar(v, casas) {
  if (v === null || v === undefined) return null;
  var fator = Math.pow(10, casas);
  return Math.round(v * fator) / fator;
}

var CABECALHO_DIMENSAO = [
  str('SUP', 'cabecalhoTabela'), str('Tomador', 'cabecalhoTabela'), str('Tipologia', 'cabecalhoTabela'), str('Contrato', 'cabecalhoTabela'),
  str('Semana anterior — Previsto', 'cabecalhoTabela'), str('Semana anterior — Realizado', 'cabecalhoTabela'), str('Semana anterior — Tendência', 'cabecalhoTabela'),
  str('Acumulado do mês — Previsto', 'cabecalhoTabela'), str('Acumulado do mês — Realizado', 'cabecalhoTabela'), str('Acumulado do mês — Tendência', 'cabecalhoTabela'),
  str('Semana que vem — Previsto', 'cabecalhoTabela'), str('Semana que vem — Tendência', 'cabecalhoTabela'),
];

function linhaDimensao(linha, dimensao, total, zebra) {
  var casas = casasDaDimensao(dimensao);
  var j = linha.janelas;
  var estiloTexto = total ? 'textoTotal' : (zebra ? 'textoZebra' : 'texto');
  var estiloNumero = casas === 2
    ? (total ? 'numeroDuasCasasTotal' : (zebra ? 'numeroDuasCasasZebra' : 'numeroDuasCasas'))
    : (total ? 'numeroMilharTotal' : (zebra ? 'numeroMilharZebra' : 'numeroMilhar'));
  return [
    str(linha.sup, estiloTexto), str(linha.tomador, estiloTexto), str(linha.tipologia, estiloTexto), str(linha.contrato || '', estiloTexto),
    celulaNumOuVazia(arredondar(j.semanaAnterior.previsto, casas), estiloNumero),
    celulaNumOuVazia(arredondar(j.semanaAnterior.realizado, casas), estiloNumero),
    celulaNumOuVazia(arredondar(j.semanaAnterior.tendencia, casas), estiloNumero),
    celulaNumOuVazia(arredondar(j.acumulado.previsto, casas), estiloNumero),
    celulaNumOuVazia(arredondar(j.acumulado.realizado, casas), estiloNumero),
    celulaNumOuVazia(arredondar(j.acumulado.tendencia, casas), estiloNumero),
    celulaNumOuVazia(arredondar(j.semanaQueVem.previsto, casas), estiloNumero),
    celulaNumOuVazia(arredondar(j.semanaQueVem.tendencia, casas), estiloNumero),
  ];
}

var COLS_DIMENSAO = [12, 26, 16, 14, 15, 15, 15, 15, 15, 15, 15, 15];

function montarAbaDimensao(nomeAba, linhas, dimensao, subtitulo) {
  var sufixo = subtitulo ? ' · ' + subtitulo : '';
  var rows = [
    [str('Relatório Semanal — Planejamento · ' + nomeAba + sufixo, 'titulo')],
    CABECALHO_DIMENSAO.slice(),
  ];
  var indiceZebra = 0;
  linhas.forEach(function (linha) {
    var total = linha.tipo !== 'registro';
    var zebra = false;
    if (!total) { zebra = indiceZebra % 2 === 1; indiceZebra++; }
    rows.push(linhaDimensao(linha, dimensao, total, zebra));
  });
  return {
    name: nomeAba, rows: rows,
    colWidths: COLS_DIMENSAO, freezeRows: 2, rowHeights: { 1: 28, 2: 30 }, merges: ['A1:L1'],
  };
}

// opcoes: { registros, indices, ano, mesIdx, semanas, indiceAtual, demandas,
//   hojeEpoch, mesAtualReal?, geradoEm: Date, autor: string }.
function gerarRelatorioSemanalXlsx(opcoes) {
  var ctx = {
    ano: opcoes.ano, mesIdx: opcoes.mesIdx, semanas: opcoes.semanas, indiceAtual: opcoes.indiceAtual,
    demandas: opcoes.demandas, hojeEpoch: opcoes.hojeEpoch, mesAtualReal: opcoes.mesAtualReal,
    temSemanasReais: !!(opcoes.demandas && opcoes.demandas.porRegistroEventos),
  };
  var linhasVolume = montarLinhasDimensao(opcoes.registros, opcoes.indices, 'volume', ctx);
  var linhasEquipes = montarLinhasDimensao(opcoes.registros, opcoes.indices, 'equipes', ctx);
  var desvios = montarDesvios({ volume: linhasVolume, equipes: linhasEquipes });
  var resumo = resumoDesvios(desvios);
  var subtitulo = NOMES_MES[ctx.mesIdx] + '/' + ctx.ano;
  var janelaAnterior = semanaAnterior(ctx.ano, ctx.mesIdx, ctx.semanas, ctx.indiceAtual);
  var janelaSeguinte = semanaSeguinte(ctx.ano, ctx.mesIdx, ctx.semanas, ctx.indiceAtual);

  var sheets = [
    montarAbaResumo(opcoes, resumo, janelaAnterior, janelaSeguinte),
    montarAbaDesvios(desvios, subtitulo),
    montarAbaDimensao('Volume', linhasVolume, 'volume', subtitulo),
    montarAbaDimensao('Equipes', linhasEquipes, 'equipes', subtitulo),
  ];
  return {
    bytes: buildXlsx(sheets),
    resumo: resumo, desvios: desvios, linhasVolume: linhasVolume, linhasEquipes: linhasEquipes,
  };
}

module.exports = { gerarRelatorioSemanalXlsx, montarAbaResumo, montarAbaDesvios, montarAbaDimensao };
