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

function renderFiltroSup(registros) {
  const sups = linhasDistintas(registros, 'sup');
  return `<select id="filtro-sup"><option value="">Todos os SUP</option>` +
    sups.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('') +
    `</select>`;
}

function renderCabecalhoMeses(periodos) {
  return periodos.map(data => `<th>${formatarMesAno(data)}</th>`).join('');
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

// Mesmo mapeamento de cores por tipologia da matriz de equipes
// (tools/matriz/render-dashboard.js's tipologiaColor) -- mantém os dois
// dashboards consistentes entre si. Pequena extensão: quando a tipologia
// vem como string composta sem parêntese (ex. "SM / SM.F / SR", formato
// real da aba MATRIZ do orçamento -- a matriz de equipes só usa parêntese
// pra isso), tenta o primeiro token antes da barra antes de cair no cinza
// neutro.
const TIPOLOGIA_COLOR = {
  SP: '#3f851a', SM: '#2f6ad0', ST: '#8d6f00', PI: '#606060',
  BL: '#4a3aa7', CPTU: '#db244e', SH: '#e87ba4', VT: '#eda100',
  'SEGURANÇA': '#2775b8', ESPECIAIS: '#db244e', SSMA: '#2775b8',
};
const TIPOLOGIA_COMPOSTA_COLOR = {
  'CPTU / VT / SH': TIPOLOGIA_COLOR.CPTU,
  'SP/SM': TIPOLOGIA_COLOR.SP,
};
function tipologiaColor(tipologia) {
  const raw = String(tipologia || '').trim();
  const key = raw.toUpperCase();
  if (TIPOLOGIA_COLOR[key]) return TIPOLOGIA_COLOR[key];
  if (TIPOLOGIA_COMPOSTA_COLOR[key]) return TIPOLOGIA_COMPOSTA_COLOR[key];
  const parenMatch = raw.match(/\(([^)]+)\)\s*$/);
  if (parenMatch) {
    const viaParen = TIPOLOGIA_COLOR[parenMatch[1].trim().toUpperCase()];
    if (viaParen) return viaParen;
  }
  const primeiroToken = key.split('/')[0].trim();
  if (TIPOLOGIA_COLOR[primeiroToken]) return TIPOLOGIA_COLOR[primeiroToken];
  return '#898781';
}

const SERIE_LABELS = { previsto: 'Previsto', realizado: 'Realizado', total: 'Tendência' };

// SUP/Grupo/Tomador aparecem em TODA linha (nunca com rowspan de verdade --
// rowspan quebra visualmente quando um filtro esconde uma linha no meio do
// grupo mesclado). O efeito de "mesclado" vem do cliente: ele compara o
// valor de cada linha com o da linha VISÍVEL anterior e apaga (mas nunca
// remove -- fica em data-valor) quando são iguais, recalculado toda vez que
// o filtro muda (ver mesclarConsecutivos/mesclarColunasRepetidas). Tipologia
// continua com rowspan="3" de verdade porque é seguro: as 3 linhas P/R/T de
// um mesmo registro nunca são filtradas de forma independente uma da outra.
//
// "Total" (T, a série de tendência real da planilha -- Realizado até hoje +
// Previsto pro resto do ano) chama-se "Tendência" na tela, pra não confundir
// com a nova coluna/linha de Total (soma), que são somas de verdade.
function renderLinhaTabela(registro, indice) {
  const chipColor = tipologiaColor(registro.tipologia);
  const dataAttrs = `data-tipologia="${escapeHtml(registro.tipologia)}" data-grupo="${escapeHtml(registro.grupo)}" data-sup="${escapeHtml(registro.sup)}" data-registro-indices="${indice}"`;
  const celulasMes = Array.from({ length: 12 }, () => `<td class="celula-mes num"></td>`).join('');
  const celulaTotalLinha = `<td class="celula-total-linha num"></td>`;
  const celulaSup = `<td class="col-mesclavel col-sup" data-valor="${escapeHtml(registro.sup)}">${escapeHtml(registro.sup)}</td>`;
  const celulaGrupo = `<td class="col-mesclavel col-grupo" data-valor="${escapeHtml(registro.grupo)}">${escapeHtml(registro.grupo)}</td>`;
  const celulaTomador = `<td class="col-mesclavel col-tomador" data-valor="${escapeHtml(registro.tomador)}">${escapeHtml(registro.tomador)}</td>`;
  return `<tr class="linha-serie linha-previsto" data-serie="previsto" ${dataAttrs}>` +
      celulaSup + celulaGrupo + celulaTomador +
      `<td rowspan="3"><span class="tipologia-chip" style="--chip-color:${chipColor}">${escapeHtml(registro.tipologia)}</span></td>` +
      `<td class="serie-label">${SERIE_LABELS.previsto}</td>` +
      celulasMes + celulaTotalLinha +
    `</tr>` +
    `<tr class="linha-serie linha-realizado" data-serie="realizado" ${dataAttrs}>` +
      celulaSup + celulaGrupo + celulaTomador +
      `<td class="serie-label">${SERIE_LABELS.realizado}</td>` +
      celulasMes + celulaTotalLinha +
    `</tr>` +
    `<tr class="linha-serie linha-total" data-serie="total" ${dataAttrs}>` +
      celulaSup + celulaGrupo + celulaTomador +
      `<td class="serie-label">${SERIE_LABELS.total}</td>` +
      celulasMes + celulaTotalLinha +
    `</tr>`;
}

// Linha de total por SUP: soma as 3 séries de TODAS as tipologias daquele
// contrato. Sem data-tipologia (nenhum valor real de tipologia bate com
// ela), então some sozinha quando qualquer tipologia específica estiver
// selecionada no filtro -- só faz sentido mostrar "total de todas as
// tipologias" na visão sem esse filtro. data-registro-indices carrega os
// índices de TODOS os registros do SUP, pro cliente agregar.
function renderLinhaTotalSup(sup, grupo, tomador, indices) {
  const dataAttrs = `data-grupo="${escapeHtml(grupo)}" data-sup="${escapeHtml(sup)}" data-registro-indices="${indices.join(',')}" data-total-sup="1"`;
  const celulasMes = Array.from({ length: 12 }, () => `<td class="celula-mes num"></td>`).join('');
  const celulaTotalLinha = `<td class="celula-total-linha num"></td>`;
  const celulaSup = `<td class="col-mesclavel col-sup" data-valor="${escapeHtml(sup)}">${escapeHtml(sup)}</td>`;
  const celulaGrupo = `<td class="col-mesclavel col-grupo" data-valor="${escapeHtml(grupo)}">${escapeHtml(grupo)}</td>`;
  const celulaTomador = `<td class="col-mesclavel col-tomador" data-valor="${escapeHtml(tomador)}">${escapeHtml(tomador)}</td>`;
  return `<tr class="linha-serie linha-previsto linha-total-sup" data-serie="previsto" ${dataAttrs}>` +
      celulaSup + celulaGrupo + celulaTomador +
      `<td rowspan="3"><span class="tipologia-chip tipologia-chip-total">TOTAL</span></td>` +
      `<td class="serie-label">${SERIE_LABELS.previsto}</td>` +
      celulasMes + celulaTotalLinha +
    `</tr>` +
    `<tr class="linha-serie linha-realizado linha-total-sup" data-serie="realizado" ${dataAttrs}>` +
      celulaSup + celulaGrupo + celulaTomador +
      `<td class="serie-label">${SERIE_LABELS.realizado}</td>` +
      celulasMes + celulaTotalLinha +
    `</tr>` +
    `<tr class="linha-serie linha-total linha-total-sup" data-serie="total" ${dataAttrs}>` +
      celulaSup + celulaGrupo + celulaTomador +
      `<td class="serie-label">${SERIE_LABELS.total}</td>` +
      celulasMes + celulaTotalLinha +
    `</tr>`;
}

// Monta o corpo da tabela: cada registro na ordem em que já vem (a MATRIZ já
// traz as tipologias de um mesmo contrato/SUP contíguas, ver parse-matriz.js
// -- essa contiguidade é o que permite fechar o grupo de total assim que o
// SUP muda), seguido de uma linha de total assim que o SUP muda ou a lista
// acaba.
function renderCorpoTabela(registros) {
  let html = '';
  let supAtual = null;
  let grupoAtual = null;
  let tomadorAtual = null;
  let indicesGrupoAtual = [];

  function fecharGrupo() {
    if (indicesGrupoAtual.length) {
      html += renderLinhaTotalSup(supAtual, grupoAtual, tomadorAtual, indicesGrupoAtual);
    }
  }

  registros.forEach((registro, indice) => {
    if (supAtual !== null && registro.sup !== supAtual) {
      fecharGrupo();
      indicesGrupoAtual = [];
    }
    supAtual = registro.sup;
    grupoAtual = registro.grupo;
    tomadorAtual = registro.tomador;
    indicesGrupoAtual.push(indice);
    html += renderLinhaTabela(registro, indice);
  });
  fecharGrupo();
  return html;
}

// A tabela é renderizada no servidor com os registros crus (previsto/
// realizado/total mês a mês); o script embutido abaixo recalcula os 12
// valores mensais + a coluna Total de cada linha sempre que a dimensão ou
// os filtros mudarem, sem recarregar a página (HTML estático, sem bundler
// -- não dá pra importar tools/orcamento/compute-orcamento.js aqui).
const SCRIPT_CLIENTE = `
function formatarNumero(v) { return v === null || v === undefined ? '—' : (Math.round(v * 100) / 100).toLocaleString('pt-BR'); }
function somar(array) { return (array || []).reduce(function (a, b) { return a + (b || 0); }, 0); }
function somarArraysMensais(arrays) {
  var soma = new Array(12).fill(0);
  arrays.forEach(function (arr) {
    if (!arr) return;
    for (var i = 0; i < 12; i++) soma[i] += arr[i] || 0;
  });
  return soma;
}

var CAMPOS_RATIO = {
  produtividade: { numerador: 'volume', denominador: 'equipes' },
  ticketMedio: { numerador: 'financeiro', denominador: 'volume' },
};

// valoresLista: array de "valores" de UMA série (previsto/realizado/total),
// um item por registro agregado (lista de 1 item no caso normal de uma
// única tipologia; vários itens na linha de total por SUP). Devolve os 12
// valores mensais na dimensão escolhida. Previsto de produtividade/
// ticketMedio, quando é UMA ÚNICA tipologia, usa a premissa fixa da
// planilha (PROD./TICKET, nunca recalculada); quando agrega várias
// tipologias (linha de total por SUP), não existe premissa própria do
// agregado, então usa a mesma razão-a-partir-da-soma que Realizado/
// Tendência (produtividade = Σvolume ÷ Σequipes, ticketMedio = Σfinanceiro
// ÷ Σvolume -- fórmulas confirmadas com o usuário, estendidas aqui pra
// somar através das tipologias, não só dos meses).
function calcularMensal(valoresLista, serie, dimensao) {
  var lista = valoresLista.filter(Boolean);
  if (!lista.length) return null;
  var ratio = CAMPOS_RATIO[dimensao];
  if (ratio) {
    if (serie === 'previsto' && lista.length === 1) {
      var premissa = dimensao === 'produtividade' ? lista[0].equipesResumo.prod : lista[0].volumeResumo.ticket;
      return new Array(12).fill((premissa === null || premissa === undefined) ? null : premissa);
    }
    var numeradorMensal = somarArraysMensais(lista.map(function (v) { return v[ratio.numerador]; }));
    var denominadorMensal = somarArraysMensais(lista.map(function (v) { return v[ratio.denominador]; }));
    return numeradorMensal.map(function (v, i) { return denominadorMensal[i] ? v / denominadorMensal[i] : null; });
  }
  return somarArraysMensais(lista.map(function (v) { return v[dimensao]; }));
}

// Coluna "Total" (soma do ano inteiro) da mesma linha -- soma os 12 meses
// pras 3 dimensões brutas; produtividade/ticketMedio recalculam a razão a
// partir da soma do numerador/denominador do ANO INTEIRO, nunca a soma das
// razões mensais (somar "R$/m³" de 12 meses não seria um número válido).
function calcularTotalAno(valoresLista, serie, dimensao) {
  var lista = valoresLista.filter(Boolean);
  if (!lista.length) return null;
  var ratio = CAMPOS_RATIO[dimensao];
  if (ratio) {
    if (serie === 'previsto' && lista.length === 1) {
      return dimensao === 'produtividade' ? lista[0].equipesResumo.prod : lista[0].volumeResumo.ticket;
    }
    var numeradorTotal = somar(lista.map(function (v) { return somar(v[ratio.numerador]); }));
    var denominadorTotal = somar(lista.map(function (v) { return somar(v[ratio.denominador]); }));
    return denominadorTotal ? numeradorTotal / denominadorTotal : null;
  }
  return somar(lista.map(function (v) { return somar(v[dimensao]); }));
}

function preencherLinha(linha, valoresLista, serie, dimensao) {
  var mensal = calcularMensal(valoresLista, serie, dimensao);
  var celulasMes = linha.querySelectorAll('.celula-mes');
  celulasMes.forEach(function (celula, idx) {
    celula.textContent = formatarNumero(mensal ? mensal[idx] : null);
  });
  var celulaTotal = linha.querySelector('.celula-total-linha');
  if (celulaTotal) celulaTotal.textContent = formatarNumero(calcularTotalAno(valoresLista, serie, dimensao));
}

// Dado um array de valores (na ordem das linhas visíveis de UMA coluna),
// devolve um array do mesmo tamanho onde cada valor igual ao da linha
// visível anterior vira '' -- é o efeito visual de "mesclar" sem usar
// rowspan de verdade, que quebra quando um filtro esconde uma linha no meio
// do grupo. Função pura (sem DOM) pra poder testar sozinha.
function mesclarConsecutivos(valores) {
  var resultado = [];
  var anterior = null;
  valores.forEach(function (valor, i) {
    resultado.push(i > 0 && valor === anterior ? '' : valor);
    anterior = valor;
  });
  return resultado;
}

// Aplica mesclarConsecutivos a cada coluna mesclável (SUP/Grupo/Tomador),
// olhando só pras linhas atualmente visíveis (depois do filtro já ter
// rodado) -- por isso precisa ser chamada de novo toda vez que o filtro
// muda, nunca uma vez só.
function mesclarColunasRepetidas() {
  ['col-sup', 'col-grupo', 'col-tomador'].forEach(function (classe) {
    var linhasVisiveis = Array.prototype.filter.call(
      document.querySelectorAll('#tabela-orcamento tbody tr'),
      function (tr) { return tr.style.display !== 'none'; }
    );
    var celulas = linhasVisiveis
      .map(function (tr) { return tr.querySelector('.' + classe); })
      .filter(Boolean);
    var valores = celulas.map(function (c) { return c.getAttribute('data-valor'); });
    var mesclados = mesclarConsecutivos(valores);
    celulas.forEach(function (c, i) { c.textContent = mesclados[i]; });
  });
}

function recalcularTabela() {
  var dimensao = document.getElementById('seletor-dimensao').value;
  var filtroTipologia = document.getElementById('filtro-tipologia').value;
  var filtroContrato = document.getElementById('filtro-contrato').value;
  var filtroSup = document.getElementById('filtro-sup').value;
  var linhas = document.querySelectorAll('#tabela-orcamento tbody tr');
  linhas.forEach(function (linha) {
    var combinaGrupoSup = (!filtroContrato || linha.dataset.grupo === filtroContrato) &&
      (!filtroSup || linha.dataset.sup === filtroSup);
    var ehTotalSup = linha.dataset.totalSup === '1';
    var mostra = ehTotalSup
      ? (combinaGrupoSup && !filtroTipologia)
      : (combinaGrupoSup && (!filtroTipologia || linha.dataset.tipologia === filtroTipologia));
    linha.style.display = mostra ? '' : 'none';
    if (mostra) {
      var indices = linha.dataset.registroIndices.split(',').map(Number);
      var valoresLista = indices.map(function (idx) { return window.__REGISTROS__[idx][linha.dataset.serie]; });
      preencherLinha(linha, valoresLista, linha.dataset.serie, dimensao);
    }
  });
  mesclarColunasRepetidas();
}

['seletor-dimensao', 'filtro-tipologia', 'filtro-contrato', 'filtro-sup'].forEach(function (id) {
  document.getElementById(id).addEventListener('change', recalcularTabela);
});
recalcularTabela();
`;

function renderDashboard({ registros, periodos, generatedAt, logoDataUri, iconDataUri }) {
  const linhasTabela = renderCorpoTabela(registros);
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
    background: var(--chip-color); color: #fff;
    border-radius: 4px; padding: 2px 8px;
    font-size: 12px; font-weight: 600;
  }
  .tipologia-chip-total { background: var(--surface-1); color: var(--text-primary); border: 2px solid var(--text-secondary); }
  .celula-mes { white-space: nowrap; }
  .celula-total-linha { white-space: nowrap; font-weight: 700; border-left: 2px solid var(--border); }
  .serie-label { font-weight: 700; border-left: 4px solid transparent; padding-left: 10px; white-space: nowrap; }
  .linha-previsto .serie-label, .linha-previsto .celula-mes, .linha-previsto .celula-total-linha { color: #2f6ad0; }
  .linha-previsto .serie-label { border-left-color: #2f6ad0; }
  .linha-realizado .serie-label, .linha-realizado .celula-mes, .linha-realizado .celula-total-linha { color: #7fd858; }
  .linha-realizado .serie-label { border-left-color: #7fd858; }
  .linha-total .serie-label, .linha-total .celula-mes, .linha-total .celula-total-linha { color: #f6b53f; }
  .linha-total .serie-label { border-left-color: #f6b53f; }
  tr.linha-total td { border-bottom: 2px solid var(--gridline); }
  .linha-total-sup td { background: color-mix(in srgb, var(--surface-1) 60%, #000); }
</style>
</head>
<body>
  ${watermarkImg}
  <main>
  <div class="header-bar">
    ${logoImg}
    <div class="header-bar-title">
      <h1>ORÇAMENTO — Previsto x Realizado x Tendência</h1>
      <div class="generated">Gerado em ${escapeHtml(generatedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))}</div>
    </div>
  </div>
  <div class="filtros">
    ${renderFiltroTipologia(registros)}
    ${renderFiltroContrato(registros)}
    ${renderFiltroSup(registros)}
    ${renderSeletorDimensao()}
  </div>
  <div class="table-scroll">
  <table id="tabela-orcamento">
    <thead><tr><th>SUP</th><th>Grupo</th><th>Tomador</th><th>Tipologia</th><th>Série</th>${renderCabecalhoMeses(periodos)}<th>Total</th></tr></thead>
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
