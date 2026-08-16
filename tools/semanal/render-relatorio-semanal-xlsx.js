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
function celulaNumOuVazia(v) {
  return (v === null || v === undefined || !Number.isFinite(v)) ? str('') : num(v);
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
    [str('Relatório Semanal — Planejamento')],
    [str('Mês/ano do relatório'), str(NOMES_MES[opcoes.mesIdx] + '/' + opcoes.ano)],
    [str('Semana anterior'), str(intervalo(janelaAnterior))],
    [str('Semana vigente'), str(semanaVigente ? formatarDataCurta(semanaVigente.inicio) + ' a ' + formatarDataCurta(semanaVigente.fim) : '—')],
    [str('Semana que vem'), str(intervalo(janelaSeguinte))],
    [str('Gerado em'), str(formatarDataHora(opcoes.geradoEm))],
    [str('Gerado por'), str(opcoes.autor || 'dashboard')],
    [str('')],
    [str('Desvios Crítico (por contrato)'), num(resumo.critico)],
    [str('Desvios Atenção (por contrato)'), num(resumo.atencao)],
    [str('  Volume — Crítico'), num(volumeResumo.critico)],
    [str('  Volume — Atenção'), num(volumeResumo.atencao)],
    [str('  Equipes — Crítico'), num(equipesResumo.critico)],
    [str('  Equipes — Atenção'), num(equipesResumo.atencao)],
  ];
  return { name: 'Resumo', rows: rows };
}

var CABECALHO_DESVIOS = [
  str('SUP'), str('Tomador'), str('Tipologia'), str('Contrato'), str('Janela'), str('Dimensão'),
  str('Previsto'), str('Realizado/Tendência'), str('Desvio %'), str('Status'), str('Ação'), str('Responsável'),
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

// Ver o comentário de casasDaDimensaoRotulo acima -- esta recebe a chave
// CRUA ('volume'/'equipes'), não o rótulo capitalizado.
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
  var linhasVolume = montarLinhasDimensao(opcoes.registros, opcoes.indices, 'volume', ctx);
  var linhasEquipes = montarLinhasDimensao(opcoes.registros, opcoes.indices, 'equipes', ctx);
  var desvios = montarDesvios({ volume: linhasVolume, equipes: linhasEquipes });
  var resumo = resumoDesvios(desvios);
  var janelaAnterior = semanaAnterior(ctx.ano, ctx.mesIdx, ctx.semanas, ctx.indiceAtual);
  var janelaSeguinte = semanaSeguinte(ctx.ano, ctx.mesIdx, ctx.semanas, ctx.indiceAtual);

  var sheets = [
    montarAbaResumo(opcoes, resumo, janelaAnterior, janelaSeguinte),
    montarAbaDesvios(desvios),
    montarAbaDimensao('Volume', linhasVolume, 'volume'),
    montarAbaDimensao('Equipes', linhasEquipes, 'equipes'),
  ];
  return {
    bytes: buildXlsx(sheets),
    resumo: resumo, desvios: desvios, linhasVolume: linhasVolume, linhasEquipes: linhasEquipes,
  };
}

module.exports = { gerarRelatorioSemanalXlsx, montarAbaResumo, montarAbaDesvios, montarAbaDimensao };
