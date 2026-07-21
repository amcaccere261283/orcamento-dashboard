'use strict';
const { formatarMesAno } = require('./datas.js');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function linhasDistintas(registros, campo) {
  return [...new Set(registros.map(r => r[campo]).filter(Boolean))].sort();
}

function renderFiltroTipologia(registros) {
  const tipologias = linhasDistintas(registros, 'tipologia');
  return `<select id="filtro-tipologia"><option value="">Todas as tipologias</option>` +
    tipologias.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('') +
    `</select>`;
}

function renderFiltroContrato(registros) {
  const grupos = linhasDistintas(registros, 'grupo');
  return `<select id="filtro-contrato"><option value="">Todos os contratos</option>` +
    grupos.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('') +
    `</select>`;
}

function renderSeletorMesVigente(periodos) {
  return `<select id="seletor-mes-vigente">` +
    periodos.map((data, i) => `<option value="${i}">${formatarMesAno(data)}</option>`).join('') +
    `</select>`;
}

function renderSeletorDimensao() {
  return `<select id="seletor-dimensao">` +
    `<option value="equipes">Equipes</option>` +
    `<option value="volume">Volume</option>` +
    `<option value="financeiro">Financeiro</option>` +
    `</select>`;
}

function renderLinhaTabela(registro) {
  return `<tr data-tipologia="${escapeHtml(registro.tipologia)}" data-grupo="${escapeHtml(registro.grupo)}">` +
    `<td>${escapeHtml(registro.grupo)}</td>` +
    `<td>${escapeHtml(registro.tomador)}</td>` +
    `<td>${escapeHtml(registro.tipologia)}</td>` +
    `<td colspan="6" class="celula-periodos" data-linha-periodos></td>` +
    `</tr>`;
}

// A tabela é renderizada no servidor com os registros crus (previsto/
// realizado/total mês a mês); o script embutido abaixo reimplementa as
// mesmas fórmulas de tools/orcamento/compute-orcamento.js em JS de
// navegador (sem require -- é HTML estático, sem bundler) pra recalcular
// as janelas de período sempre que o mês vigente, a dimensão ou os filtros
// mudarem, sem recarregar a página.
const SCRIPT_CLIENTE = `
function somarMeses(mensal, inicioIdx, fimIdxExclusivo) {
  let soma = 0;
  for (let i = Math.max(0, inicioIdx); i < Math.min(mensal.length, fimIdxExclusivo); i++) soma += mensal[i] || 0;
  return soma;
}
function valorMes(mensal, idx) { return (idx < 0 || idx >= mensal.length) ? null : (mensal[idx] || 0); }
function calcularJanelas(mensal, vigenteIdx) {
  return {
    acumuladoAnterior: somarMeses(mensal, 0, vigenteIdx),
    mesVigente: valorMes(mensal, vigenteIdx),
    m1: valorMes(mensal, vigenteIdx + 1), m2: valorMes(mensal, vigenteIdx + 2), m3: valorMes(mensal, vigenteIdx + 3),
    acumuladoFuturo: somarMeses(mensal, vigenteIdx + 4, mensal.length),
  };
}
function dividir(n, d) { return d ? n / d : null; }
function dividirJanelas(num, den) {
  var buckets = ['acumuladoAnterior', 'mesVigente', 'm1', 'm2', 'm3', 'acumuladoFuturo'];
  var r = {};
  buckets.forEach(function (b) { r[b] = dividir(num[b], den[b]); });
  return r;
}
function formatarNumero(v) { return v === null || v === undefined ? '—' : (Math.round(v * 100) / 100).toLocaleString('pt-BR'); }

function renderizarCelulasPeriodo(registro, dimensao, vigenteIdx) {
  var previsto = registro.previsto ? calcularJanelas(registro.previsto[dimensao], vigenteIdx) : null;
  var realizado = registro.realizado ? calcularJanelas(registro.realizado[dimensao], vigenteIdx) : null;
  var buckets = [['acumuladoAnterior', 'Acum. anterior'], ['mesVigente', 'Mês vigente'], ['m1', 'M+1'], ['m2', 'M+2'], ['m3', 'M+3'], ['acumuladoFuturo', 'Acum. futuro']];
  return buckets.map(function (par) {
    var chave = par[0];
    var p = previsto ? formatarNumero(previsto[chave]) : '—';
    var r = realizado ? formatarNumero(realizado[chave]) : '—';
    return '<span class="periodo-cell" title="' + par[1] + '">P: ' + p + ' / R: ' + r + '</span>';
  }).join('');
}

function recalcularTabela() {
  var vigenteIdx = Number(document.getElementById('seletor-mes-vigente').value);
  var dimensao = document.getElementById('seletor-dimensao').value;
  var filtroTipologia = document.getElementById('filtro-tipologia').value;
  var filtroContrato = document.getElementById('filtro-contrato').value;
  var linhas = document.querySelectorAll('#tabela-orcamento tbody tr');
  linhas.forEach(function (linha, i) {
    var registro = window.__REGISTROS__[i];
    var mostra = (!filtroTipologia || linha.dataset.tipologia === filtroTipologia) &&
      (!filtroContrato || linha.dataset.grupo === filtroContrato);
    linha.style.display = mostra ? '' : 'none';
    var celula = linha.querySelector('[data-linha-periodos]');
    celula.innerHTML = renderizarCelulasPeriodo(registro, dimensao, vigenteIdx);
  });
}

['seletor-mes-vigente', 'seletor-dimensao', 'filtro-tipologia', 'filtro-contrato'].forEach(function (id) {
  document.getElementById(id).addEventListener('change', recalcularTabela);
});
recalcularTabela();
`;

function renderDashboard({ registros, periodos, generatedAt }) {
  const linhasTabela = registros.map(renderLinhaTabela).join('');
  const registrosJson = JSON.stringify(registros.map(r => ({
    grupo: r.grupo, tomador: r.tomador, tipologia: r.tipologia,
    previsto: r.previsto, realizado: r.realizado, total: r.total,
  }))).replace(/<\/script/gi, '<\\/script');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>ORÇAMENTO — MATRIZ</title>
<style>
  body { font-family: Arial, sans-serif; padding: 16px; }
  .filtros { display: flex; gap: 12px; margin-bottom: 16px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; font-size: 13px; text-align: left; }
  .periodo-cell { display: inline-block; margin-right: 10px; white-space: nowrap; }
</style>
</head>
<body>
  <h1>ORÇAMENTO — MATRIZ</h1>
  <div class="generated">Gerado em ${escapeHtml(generatedAt.toLocaleString('pt-BR'))}</div>
  <div class="filtros">
    ${renderFiltroTipologia(registros)}
    ${renderFiltroContrato(registros)}
    ${renderSeletorMesVigente(periodos)}
    ${renderSeletorDimensao()}
  </div>
  <table id="tabela-orcamento">
    <thead><tr><th>Grupo</th><th>Tomador</th><th>Tipologia</th><th>Previsto x Realizado por período</th></tr></thead>
    <tbody>${linhasTabela}</tbody>
  </table>
  <script>window.__REGISTROS__ = ${registrosJson};</script>
  <script>${SCRIPT_CLIENTE}</script>
</body>
</html>`;
}

module.exports = { renderDashboard };
