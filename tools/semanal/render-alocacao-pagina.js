'use strict';
const path = require('node:path');
const { formatarMesAno, calcularVigenteIdx } = require('../comum/datas.js');
const { cifrarComSenha } = require('../comum/criptografia.js');
const {
  cssBase, markupCabecalho, markupFiltros, scriptDesbloqueio, scriptFiltros,
} = require('../comum/render-shell.js');
const { buildBrowserBundle } = require('../comum/browser-bundle.js');
const { fonteParaCliente: fonteParaClienteEquipes } = require('../comum/calculo-equipes.js');
const { fonteParaCliente: fonteParaClienteTipologiasAvancos } = require('../comum/tipologias-avancos.js');
const { fonteParaCliente: fonteParaClienteTipologiasLab } = require('../comum/tipologias-lab.js');
const { fonteParaCliente: fonteParaClienteDatas } = require('../comum/datas.js');
const { fonteParaCliente: fonteParaClienteLinhaBase } = require('../comum/linha-base.js');
const {
  CSS_SEMANAL, CSS_ABAS_SEMANAL, CSS_DEMANDAS, SCRIPT_AVISO_ATUALIZACAO_ATRASADA, opcoesMesSemanal,
} = require('./render-semanal.js');

// Mesmo Apps Script que a aba usava dentro de planejamento-semanal.html
// (tools/semanal/apps-script-alocacao.gs) -- MOVIDO pra cá porque só esta
// página consome a alocação agora. Mesma URL: reimplantar o .gs (Gerenciar
// implantações > Nova versão) mantém este literal válido; só uma implantação
// NOVA do zero o trocaria.
const URL_ALOCACAO = 'https://script.google.com/macros/s/AKfycby3jOFa1eOZ9Rtu7mRq8iZWtZdKdg-7ATqzbU-fBba5eLuV5_U69nAe7-Md_3-l_ciB/exec';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Os 5 filtros da barra compartilhada que a Alocação de fato lê (indicesFiltrados,
// ver montarAbaAlocacao) -- sem o 6º (seletor-dimensao): a Tendência da Alocação é
// sempre 'volume', hardcoded em compute-alocacao.js (tendenciaDaCelula).
const FILTROS_ALOCACAO = [
  { id: 'filtro-origem', rotulo: 'Todas as origens' },
  { id: 'filtro-categoria', rotulo: 'Todas as categorias' },
  { id: 'filtro-tipologia', rotulo: 'Todas as tipologias' },
  { id: 'filtro-grupo', rotulo: 'Todos os grupos' },
  { id: 'filtro-sup', rotulo: 'Todos os SUP' },
];

// Réplica de MARKUP_ACOES_SEMANAL (render-semanal.js:109-115) sem o checkbox
// "Somente SUPs ativos" -- a Alocação nunca usou filtro-ativos de propósito
// (esconderia as linhas "Parado c/ carteira", o motivo da aba existir).
const MARKUP_ACOES_ALOCACAO = `      <div class="filtros-acoes">
        <label class="controle-mes-semanal">Mês<select id="seletor-mes-semanal">${opcoesMesSemanal()}</select></label>
        <button id="limpar-filtros" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>Limpar filtros</button>
        <button id="atualizar-dashboard" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16M3 21v-5h5"/></svg>Atualizar dados</button>
        <span id="status-atualizacao" class="status-atualizacao"></span>
      </div>`;

// Reduzido de BUNDLE_ARQUIVOS (render-semanal.js:795-892): só as 18 entradas
// que compute-alocacao.js/render-aba-alocacao.js/equipes-alocaveis.js/
// alocacao-sheet.js/grupos-veiculo.js e o live-refresh (Task 2) precisam,
// SUBSEQUÊNCIA da lista original preservando a ordem relativa (contrato de
// dependência) -- não foi reordenado.
const BUNDLE_ARQUIVOS_ALOCACAO = [
  'compute-semanal.js', 'compute-tendencia-semanal.js', 'render-aba-semanal.js',
  'render-aba-alertas.js', 'render-aba-consolidado.js',
  'parse-matriz-cliente.js', 'classificar-dia-equipe.js', 'compute-equipes-ativas.js',
  'compute-equipes-nao-produtivas.js', 'compute-equipes-realizado-alocado.js',
  'parse-avancos.js', 'parse-lab.js', 'compute-demandas.js',
  'grupos-veiculo.js', 'equipes-alocaveis.js', 'compute-alocacao.js', 'alocacao-sheet.js',
  'render-aba-alocacao.js',
];

// Placeholder até a Task 2 -- será substituído pelo script cliente completo
// (estado/arrasto/live-refresh). Mantém a página funcional (gate abre, seção
// existe vazia) já nesta Task, testável por si só.
const SCRIPT_CLIENTE_ALOCACAO = `
var ComputeSemanal = MODULOS['compute-semanal.js'];
var RenderAbaAlocacao = MODULOS['render-aba-alocacao.js'];
var EquipesAlocaveis = MODULOS['equipes-alocaveis.js'];
var GruposVeiculo = MODULOS['grupos-veiculo.js'];
var AlocacaoSheet = MODULOS['alocacao-sheet.js'];
var ParseMatrizCliente = MODULOS['parse-matriz-cliente.js'];
var ParseAvancos = MODULOS['parse-avancos.js'];
var ParseLab = MODULOS['parse-lab.js'];
var ComputeDemandas = MODULOS['compute-demandas.js'];
var ComputeEquipesAtivas = MODULOS['compute-equipes-ativas.js'];
var ComputeEquipesNaoProdutivas = MODULOS['compute-equipes-nao-produtivas.js'];
var ComputeEquipesRealizadoAlocado = MODULOS['compute-equipes-realizado-alocado.js'];

// Réplica reduzida de FILTROS_CONFIG_SEMANAL (render-semanal.js:1043-1054),
// sem 'seletor-dimensao' -- indicesFiltrados/montarFiltroMulti vêm de
// scriptFiltros() (tools/comum/render-shell.js), concatenado ANTES deste
// script na mesma <script> tag.
var FILTROS_CONFIG_SEMANAL = [
  { id: 'filtro-origem', chave: 'origem', rotuloPadrao: 'Todas as origens', campo: 'origem', rotuloCapitalizado: true },
  { id: 'filtro-categoria', chave: 'categoria', rotuloPadrao: 'Todas as categorias', opcoesFixas: [
    { valor: 'labConvencional', rotulo: 'Lab. Convencional' },
    { valor: 'labEspecial', rotulo: 'Lab. Especial' },
    { valor: 'sondagemConvencional', rotulo: 'Sondagem Convencional' },
    { valor: 'sondagemEspecial', rotulo: 'Sondagem Especial' },
  ] },
  { id: 'filtro-tipologia', chave: 'tipologia', rotuloPadrao: 'Todas as tipologias', campo: 'tipologia' },
  { id: 'filtro-grupo', chave: 'grupo', rotuloPadrao: 'Todos os grupos', campo: 'grupo' },
  { id: 'filtro-sup', chave: 'sup', rotuloPadrao: 'Todos os SUP', campo: 'sup', rotuloComposto: true },
];
var filtrosSelecionadosSemanal = {};
FILTROS_CONFIG_SEMANAL.forEach(function (cfg) { filtrosSelecionadosSemanal[cfg.chave] = new Set(); });

var mesSelecionadoIdx = Math.max(0, Math.min(11, window.__VIGENTE_IDX__));

function hojeEpochDoNavegador() {
  var agora = new Date();
  return ComputeSemanal.diaEpoch(new Date(Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate())));
}

function semanasDoMesSelecionado() {
  return ComputeSemanal.semanasDoMes(window.__ANO__, mesSelecionadoIdx);
}

// dados: o que o gate acabou de JSON.parse -- {registros, demandas, alocacaoUrl}
// (ver renderAlocacaoPagina). Reduzido de fecharTendenciaVigente
// (render-semanal.js:1177-1187): sem baseline nem historicoRelatorioUrl, que
// esta página não usa.
function fecharTendenciaVigente(dados) {
  window.__DEMANDAS__ = dados && dados.demandas;
  window.__ALOCACAO_URL__ = dados && dados.alocacaoUrl;
  return dados && dados.registros ? dados.registros : dados;
}

// Placeholder -- substituído na Task 2 pelo bloco real de estado/arrasto.
function montarAbaAlocacao() {}

function aoMudarSemanal(cfg) {
  if (cfg.chave === 'categoria') {
    var cfgTipologia = FILTROS_CONFIG_SEMANAL.filter(function (c) { return c.chave === 'tipologia'; })[0];
    montarFiltroMulti(cfgTipologia, window.__REGISTROS__, filtrosSelecionadosSemanal, aoMudarSemanal);
  }
  montarAbaAlocacao();
}

function montarTodosFiltrosMultiSemanal(registros) {
  FILTROS_CONFIG_SEMANAL.forEach(function (cfg) { montarFiltroMulti(cfg, registros, filtrosSelecionadosSemanal, aoMudarSemanal); });
}

function limparFiltrosSemanal() {
  FILTROS_CONFIG_SEMANAL.forEach(function (cfg) { filtrosSelecionadosSemanal[cfg.chave].clear(); });
  montarTodosFiltrosMultiSemanal(window.__REGISTROS__);
  montarAbaAlocacao();
}

function montarDashboard(registros) {
  document.getElementById('limpar-filtros').addEventListener('click', limparFiltrosSemanal);
  var seletorMes = document.getElementById('seletor-mes-semanal');
  seletorMes.value = String(mesSelecionadoIdx);
  seletorMes.addEventListener('change', function (e) {
    mesSelecionadoIdx = parseInt(e.target.value, 10);
    montarAbaAlocacao();
  });
  montarTodosFiltrosMultiSemanal(registros);
  configurarAberturaFiltrosMulti();
  montarAbaAlocacao();
}
`;

function renderAlocacaoPagina({ registros, demandas, periodos, senha, geradoEm, logoDataUri, iconDataUri, avisoAtualizacao, ultimaAtualizacaoOkIso }) {
  if (!senha) {
    throw new Error('renderAlocacaoPagina requer "senha" -- os registros são cifrados com ela antes de ir pro HTML.');
  }
  if (!Array.isArray(periodos) || periodos.length === 0) {
    throw new Error('renderAlocacaoPagina requer "periodos" (os 12 meses da MATRIZ, como datas).');
  }

  const dadosJson = JSON.stringify({ registros, demandas, alocacaoUrl: URL_ALOCACAO });
  const dadosCifrados = cifrarComSenha(dadosJson, senha);
  const dadosCifradosJson = JSON.stringify(dadosCifrados).replace(/<\/script/gi, '<\\/script');

  const logoImg = logoDataUri ? `<img src="${logoDataUri}" alt="Suporte Infra">` : '';
  const watermarkImg = iconDataUri ? `<img class="watermark" src="${iconDataUri}" alt="">` : '';
  const vigenteIdx = calcularVigenteIdx(periodos, geradoEm);
  const bundle = buildBrowserBundle(path.join(__dirname), BUNDLE_ARQUIVOS_ALOCACAO);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>ALOCAÇÃO EQUIPES</title>
<style>
${cssBase()}
${CSS_SEMANAL}
${CSS_ABAS_SEMANAL}
${CSS_DEMANDAS}
</style>
</head>
<body>
  ${watermarkImg}
  <main>
${markupCabecalho({
    titulo: 'Alocação Equipes',
    subtitulo: escapeHtml(avisoAtualizacao ? `${formatarMesAno(geradoEm)} · ${avisoAtualizacao}` : formatarMesAno(geradoEm)),
    logo: logoImg,
    recuo: '  ',
  })}
  <div id="aviso-atualizacao-atrasada" class="aviso-atualizacao-atrasada" style="display:none"></div>

  <div id="gate-senha" class="gate-senha">
    <div class="gate-senha-box">
      <h2>Digite a senha para abrir o dashboard</h2>
      <input type="password" id="campo-senha" autocomplete="off" placeholder="Senha">
      <button id="btn-desbloquear" type="button">Abrir</button>
      <div id="gate-senha-erro" class="gate-senha-erro" style="display:none"></div>
    </div>
  </div>

  <div id="conteudo-protegido" style="display:none">
${markupFiltros(FILTROS_ALOCACAO, { recuo: '    ', acoes: MARKUP_ACOES_ALOCACAO })}
    <div id="secao-alocacao"></div>
  </div>
  </main>
  <script>window.__VIGENTE_IDX__ = ${vigenteIdx}; window.__ANO__ = ${periodos[0].getUTCFullYear()};</script>
  <script>window.__ULTIMA_ATUALIZACAO_OK__ = ${ultimaAtualizacaoOkIso ? JSON.stringify(ultimaAtualizacaoOkIso) : 'null'};</script>
  <script>${SCRIPT_AVISO_ATUALIZACAO_ATRASADA}</script>
  <script>window.__DADOS_CIFRADOS__ = ${dadosCifradosJson};</script>
  <script>${scriptDesbloqueio()}</script>
  <script>${fonteParaClienteEquipes()}${fonteParaClienteTipologiasAvancos()}${fonteParaClienteTipologiasLab()}${fonteParaClienteDatas()}${fonteParaClienteLinhaBase()}</script>
  <script>${bundle}</script>
  <script>${scriptFiltros()}${SCRIPT_CLIENTE_ALOCACAO}</script>
</body>
</html>`;
}

module.exports = { renderAlocacaoPagina };
