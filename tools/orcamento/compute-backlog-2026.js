'use strict';

const { calcularVigenteIdx } = require('../comum/datas.js');
const { gridParaCsv } = require('../semanal/csv-writer-avancos.js');

// Realizado e Tendência de 2026 por SUP, em R$ -- os MESMOS números que a
// Tabela do dashboard de orçamento mostra (série Financeiro), exportados em
// dist/backlog-2026-online.csv pro Backlog das medições (repositório
// matriz-equipes-source). Conferido contra a Tabela em 2026-09-11 com o
// SUP-7285-24: realizado 4.759.080 + tendência 9.419.610 = 14.178.690.
//
// A Tabela calcula isso só no navegador (fecharTendenciaVigente em
// render-dashboard.js, sobre window.__REGISTROS__). As três funções abaixo
// são a mesma regra portada pro Node -- se a de lá mudar, esta tem que mudar
// junto, senão o Backlog das medições deixa de bater com a Tabela.
function removerZerosFinaisNaoReportados(mensal) {
  const resultado = mensal.slice();
  let i = resultado.length - 1;
  while (i >= 0 && (resultado[i] === 0 || resultado[i] == null)) i--;
  for (let j = i + 1; j < resultado.length; j++) {
    if (resultado[j] === 0) resultado[j] = null;
  }
  return resultado;
}

function fecharSerieFinanceira(totalMensal, realizadoMensal, vigenteIdx) {
  return totalMensal.map((v, i) => {
    const r = realizadoMensal ? realizadoMensal[i] : null;
    if (i < vigenteIdx) return r == null ? v : r;
    if (i === vigenteIdx) return (v == null && r == null) ? null : (r || 0) + (v || 0);
    return v;
  });
}

function somar(valores) {
  return valores.reduce((s, v) => s + (v || 0), 0);
}

// Uma linha por SUP (texto cru da MATRIZ, somando todas as tipologias).
// realizado2026 = série R somada de janeiro até o mês vigente (inclusive).
// projecao2026 = série T "fechada" (meses passados valem o Realizado, o mês
// vigente soma o parcial com o que falta) somada no ano inteiro -- é o
// "Total" da Tabela. tendenciaRestante2026 = o que ainda falta executar no
// ano = projecao2026 - realizado2026.
function montarBacklog2026({ registros, periodos, today }) {
  const vigenteIdxBruto = calcularVigenteIdx(periodos, today);
  if (vigenteIdxBruto < 0) return [];
  const vigenteIdx = Math.min(vigenteIdxBruto, 11);

  const porSup = new Map();
  for (const r of registros) {
    if (!r.sup) continue;
    const realizado = r.realizado && Array.isArray(r.realizado.financeiro) ? r.realizado.financeiro : new Array(12).fill(null);
    const total = r.total && Array.isArray(r.total.financeiro) ? r.total.financeiro : new Array(12).fill(null);
    const realizado2026 = somar(realizado.slice(0, vigenteIdx + 1));
    const projecao2026 = somar(fecharSerieFinanceira(total, removerZerosFinaisNaoReportados(realizado), vigenteIdx));

    const atual = porSup.get(r.sup) || { sup: r.sup, tomador: r.tomador || '', realizado2026: 0, projecao2026: 0 };
    atual.realizado2026 += realizado2026;
    atual.projecao2026 += projecao2026;
    porSup.set(r.sup, atual);
  }

  return [...porSup.values()].map((l) => ({
    sup: l.sup, tomador: l.tomador,
    realizado2026: l.realizado2026,
    tendenciaRestante2026: l.projecao2026 - l.realizado2026,
  }));
}

const arredondarCentavos = (v) => String(Math.round(v * 100) / 100);

// Números com ponto decimal e sem separador de milhar ("14178690.2") --
// nunca no formato brasileiro, pra o leitor das medições não ter que
// adivinhar se "1.234" é mil ou um vírgula dois.
function gerarBacklog2026Online(linhas) {
  const grid = [
    ['Cliente', 'Contrato', 'Realizado2026', 'TendenciaRestante2026'],
    ...(linhas || []).map((l) => [l.tomador, l.sup, arredondarCentavos(l.realizado2026), arredondarCentavos(l.tendenciaRestante2026)]),
  ];
  return gridParaCsv(grid);
}

module.exports = { montarBacklog2026, gerarBacklog2026Online, fecharSerieFinanceira, removerZerosFinaisNaoReportados };
