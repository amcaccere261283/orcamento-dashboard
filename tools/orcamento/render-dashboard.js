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
    `<option value="produtividade">Produtividade</option>` +
    `<option value="ticketMedio">Ticket médio</option>` +
    `</select>`;
}

function renderLinhaTabela(registro) {
  return `<tr data-tipologia="${escapeHtml(registro.tipologia)}" data-grupo="${escapeHtml(registro.grupo)}">` +
    `<td>${escapeHtml(registro.grupo)}</td>` +
    `<td>${escapeHtml(registro.tomador)}</td>` +
    `<td><span class="tipologia-chip">${escapeHtml(registro.tipologia)}</span></td>` +
    `<td colspan="6" class="celula-periodos num" data-linha-periodos></td>` +
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
  var buckets = [['acumuladoAnterior', 'Acum. anterior'], ['mesVigente', 'Mês vigente'], ['m1', 'M+1'], ['m2', 'M+2'], ['m3', 'M+3'], ['acumuladoFuturo', 'Acum. futuro']];

  if (dimensao === 'produtividade' || dimensao === 'ticketMedio') {
    var numeradorCampo = dimensao === 'produtividade' ? 'volume' : 'financeiro';
    var denominadorCampo = dimensao === 'produtividade' ? 'equipes' : 'volume';
    var premissa = dimensao === 'produtividade'
      ? (registro.previsto ? registro.previsto.equipesResumo.prod : null)
      : (registro.previsto ? registro.previsto.volumeResumo.ticket : null);
    var realizadoJanelas = registro.realizado
      ? dividirJanelas(calcularJanelas(registro.realizado[numeradorCampo], vigenteIdx), calcularJanelas(registro.realizado[denominadorCampo], vigenteIdx))
      : null;
    var totalJanelas = registro.total
      ? dividirJanelas(calcularJanelas(registro.total[numeradorCampo], vigenteIdx), calcularJanelas(registro.total[denominadorCampo], vigenteIdx))
      : null;
    return buckets.map(function (par) {
      var chave = par[0];
      var p = (premissa !== null && premissa !== undefined) ? formatarNumero(premissa) : '—';
      var r = realizadoJanelas ? formatarNumero(realizadoJanelas[chave]) : '—';
      var t = totalJanelas ? formatarNumero(totalJanelas[chave]) : '—';
      return '<span class="periodo-cell" title="' + par[1] + '">P: ' + p + ' / R: ' + r + ' / T: ' + t + '</span>';
    }).join('');
  }

  var previsto = registro.previsto ? calcularJanelas(registro.previsto[dimensao], vigenteIdx) : null;
  var realizado = registro.realizado ? calcularJanelas(registro.realizado[dimensao], vigenteIdx) : null;
  var total = registro.total ? calcularJanelas(registro.total[dimensao], vigenteIdx) : null;
  return buckets.map(function (par) {
    var chave = par[0];
    var p = previsto ? formatarNumero(previsto[chave]) : '—';
    var r = realizado ? formatarNumero(realizado[chave]) : '—';
    var t = total ? formatarNumero(total[chave]) : '—';
    return '<span class="periodo-cell" title="' + par[1] + '">P: ' + p + ' / R: ' + r + ' / T: ' + t + '</span>';
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

function renderDashboard({ registros, periodos, generatedAt, logoDataUri, iconDataUri }) {
  const linhasTabela = registros.map(renderLinhaTabela).join('');
  const registrosJson = JSON.stringify(registros.map(r => ({
    grupo: r.grupo, tomador: r.tomador, tipologia: r.tipologia,
    previsto: r.previsto, realizado: r.realizado, total: r.total,
  }))).replace(/<\/script/gi, '<\\/script');

  const logoImg = logoDataUri ? `<img src="${logoDataUri}" alt="Suporte Infra">` : '';
  const watermarkImg = iconDataUri ? `<img class="watermark" src="${iconDataUri}" alt="">` : '';

  // Mesmo sistema visual (tema escuro, header com logo, chips, tabela) da
  // matriz de equipes (tools/matriz/render-dashboard.js) -- cores, fonte e
  // classes principais copiadas de lá pra manter os dois dashboards
  // consistentes entre si.
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>ORÇAMENTO — MATRIZ</title>
<style>
  :root {
    --surface-1: #1a1a19;
    --page: #0d0d0d;
    --text-primary: #ffffff;
    --text-secondary: #c3c2b7;
    --muted: #898781;
    --gridline: #2c2c2a;
    --border: rgba(255,255,255,0.10);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: var(--page);
    color: var(--text-primary);
    padding: 24px;
  }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .generated { color: var(--text-secondary); font-size: 13px; margin-bottom: 20px; }
  .watermark {
    position: fixed;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: min(70vw, 900px);
    height: auto;
    opacity: 0.05;
    pointer-events: none;
    z-index: 0;
  }
  .header-bar { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
  .header-bar img { height: 36px; width: auto; }
  .header-bar-title { flex: 1 1 200px; min-width: 0; }
  .filtros { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
  .filtros select {
    padding: 8px 10px;
    border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface-1); color: var(--text-primary);
    font-size: 13px;
  }
  .table-scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; background: var(--surface-1); position: relative; z-index: 1; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--gridline); font-size: 13px; }
  td.num { font-variant-numeric: tabular-nums; }
  th { color: var(--text-secondary); font-weight: 600; }
  .tipologia-chip {
    display: inline-block;
    background: #f6b53f; color: #1a1a19;
    border-radius: 4px; padding: 2px 8px;
    font-size: 12px; font-weight: 600;
  }
  .periodo-cell {
    display: inline-block; margin-right: 10px; white-space: nowrap;
    padding: 2px 8px; border: 1px solid var(--border); border-radius: 999px;
    color: var(--text-secondary);
  }
</style>
</head>
<body>
  ${watermarkImg}
  <main>
  <div class="header-bar">
    ${logoImg}
    <div class="header-bar-title">
      <h1>ORÇAMENTO — Previsto x Realizado x Total</h1>
      <div class="generated">Gerado em ${escapeHtml(generatedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))}</div>
    </div>
  </div>
  <div class="filtros">
    ${renderFiltroTipologia(registros)}
    ${renderFiltroContrato(registros)}
    ${renderSeletorMesVigente(periodos)}
    ${renderSeletorDimensao()}
  </div>
  <div class="table-scroll">
  <table id="tabela-orcamento">
    <thead><tr><th>Grupo</th><th>Tomador</th><th>Tipologia</th><th>Previsto x Realizado x Total por período</th></tr></thead>
    <tbody>${linhasTabela}</tbody>
  </table>
  </div>
  </main>
  <script>window.__REGISTROS__ = ${registrosJson};</script>
  <script>${SCRIPT_CLIENTE}</script>
</body>
</html>`;
}

module.exports = { renderDashboard };
