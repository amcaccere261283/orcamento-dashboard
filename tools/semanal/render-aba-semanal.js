'use strict';
const { SEMANAS, dividirEmSemanas, fecharMes } = require('./compute-semanal.js');

// Este módulo roda tanto no Node (testes) quanto embrulhado no navegador via
// buildBrowserBundle -- por isso 'var'/'function', não 'const'/arrow, e o
// require acima na forma EXATA que a reescrita de tools/comum/browser-bundle.js
// reconhece (`const { X, Y } = require('./arquivo.js');`, sem espaço antes do
// parêntese, com chaves). Ver o comentário no topo de transformaModulo lá.

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Mesmo formatador do orçamento (tools/orcamento/render-dashboard.js,
// SCRIPT_CLIENTE_TABELA): 2 casas por padrão, '—' pra ausência de valor.
function formatarNumero(v, casasDecimais) {
  if (v === null || v === undefined) return '—';
  var casas = casasDecimais === undefined ? 2 : casasDecimais;
  var fator = Math.pow(10, casas);
  return (Math.round(v * fator) / fator).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

// Equipes é uma FOTO (ver compute-semanal.js): fechar o mês combinando várias
// semanas é uma MÉDIA, não uma soma -- por isso o rótulo muda, pra impedir
// alguém de ler "Total" numa coluna de equipes e somar contratos por engano.
function rotuloColunaFechamento(dimensao) {
  return dimensao === 'equipes' ? 'Média' : 'Total';
}

// Soma, através dos registros em 'indices', o Previsto do mês vigente numa
// dimensão -- mesma soma-através-de-registros que somarArraysMensais faz no
// orçamento (tools/orcamento/render-dashboard.js), inclusive pra 'equipes':
// somar equipes de CONTRATOS DIFERENTES no mesmo mês é válido (times
// simultâneos se somam); o que NÃO se soma é equipes ao longo do TEMPO
// (semanas), que é o que dividirEmSemanas/fecharMes tratam à parte. null só
// quando NENHUM registro contribuinte tem valor no mês vigente.
function previstoMesVigente(registros, indices, dimensao, vigenteIdx) {
  var soma = null;
  (indices || []).forEach(function (i) {
    var registro = registros[i];
    var serie = registro && registro.previsto;
    var mensal = serie && serie[dimensao];
    if (!Array.isArray(mensal)) return;
    var v = mensal[vigenteIdx];
    if (v === null || v === undefined) return;
    soma = (soma === null ? 0 : soma) + v;
  });
  return soma;
}

function renderCabecalho(dimensao) {
  var colunasSemana = '';
  for (var i = 1; i <= SEMANAS; i++) colunasSemana += '<th>S' + i + '</th>';
  return '<thead><tr><th></th>' + colunasSemana + '<th>' + escapeHtml(rotuloColunaFechamento(dimensao)) + '</th></tr></thead>';
}

// 'semanas' são os 4 valores por semana (ou null); 'fechamento' é o valor já
// fechado (fecharMes) pra a coluna final. null em qualquer um vira a classe
// sem-dado -- Realizado e Tendência ainda não têm planilha semanal de
// origem (ver comentário no topo de renderAbaSemanal), então SEMPRE chegam
// nulos aqui; não é um caso de erro, é o estado normal de hoje.
function renderLinhaSerie(rotulo, classeSerie, semanas, fechamento) {
  var celulasSemana = semanas.map(function (v) {
    if (v === null || v === undefined) return '<td class="num sem-dado"></td>';
    return '<td class="num">' + formatarNumero(v) + '</td>';
  }).join('');
  var celulaFechamento = (fechamento === null || fechamento === undefined)
    ? '<td class="num celula-total-linha sem-dado"></td>'
    : '<td class="num celula-total-linha">' + formatarNumero(fechamento) + '</td>';
  return '<tr class="linha-serie-semanal linha-' + classeSerie + '">'
    + '<td class="serie-label">' + escapeHtml(rotulo) + '</td>'
    + celulasSemana + celulaFechamento + '</tr>';
}

// registros/indices: mesmo par que o orçamento já usa (registros: array
// completo da MATRIZ; indices: quais entram nesta tabela -- aqui sempre "o
// mês vigente inteiro", já que a aba ainda não tem filtro próprio).
// dimensao: 'volume' | 'financeiro' | 'equipes'. vigenteIdx: índice 0-11 do
// mês vigente dentro dos arrays mensais de cada registro.
//
// Previsto vem de dividirEmSemanas (Task 6) aplicado à soma do Previsto do
// mês vigente através dos registros selecionados. Realizado e Tendência
// ainda não têm fonte -- a planilha semanal não existe (o usuário vai
// disponibilizá-la depois); as colunas são renderizadas vazias, com a
// classe sem-dado, prontas para um parser futuro preencher os 4 valores por
// semana sem precisar mudar a estrutura da tabela.
function renderAbaSemanal(registros, indices, dimensao, vigenteIdx) {
  var mesVigente = previstoMesVigente(registros, indices, dimensao, vigenteIdx);
  var semanasPrevisto = dividirEmSemanas(mesVigente, dimensao);
  var fechamentoPrevisto = fecharMes(semanasPrevisto, dimensao);
  var semanasSemDado = new Array(SEMANAS).fill(null);

  return '<table class="tabela-semanal">'
    + renderCabecalho(dimensao)
    + '<tbody>'
    + renderLinhaSerie('Previsto', 'previsto', semanasPrevisto, fechamentoPrevisto)
    + renderLinhaSerie('Realizado', 'realizado', semanasSemDado, null)
    + renderLinhaSerie('Tendência', 'tendencia', semanasSemDado, null)
    + '</tbody></table>';
}

module.exports = { renderAbaSemanal, rotuloColunaFechamento };
