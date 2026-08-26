'use strict';
const path = require('node:path');
const { formatarMesAno, calcularVigenteIdx } = require('../comum/datas.js');
const { cifrarComSenha } = require('../comum/criptografia.js');
const {
  cssBase, markupCabecalho, markupFiltros, markupAbas, scriptDesbloqueio, scriptFiltros,
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

// Reduzido de BUNDLE_ARQUIVOS (render-semanal.js:806-895): só as 17 entradas
// que compute-alocacao.js/render-aba-alocacao.js/equipes-alocaveis.js/
// alocacao-sheet.js/grupos-veiculo.js e o live-refresh (Task 2) precisam,
// SUBSEQUÊNCIA da lista original preservando a ordem relativa (contrato de
// dependência) -- não foi reordenado.
const BUNDLE_ARQUIVOS_ALOCACAO = [
  'compute-semanal.js', 'compute-tendencia-semanal.js', 'render-aba-semanal.js',
  'render-aba-alertas.js', 'render-aba-consolidado.js',
  'parse-matriz-cliente.js', 'classificar-dia-equipe.js', 'compute-equipes-ativas.js',
  'parse-avancos.js', 'parse-lab.js', 'compute-demandas.js',
  'grupos-veiculo.js', 'equipes-alocaveis.js', 'coordenadas-sup.js', 'compute-alocacao.js', 'alocacao-sheet.js',
  'render-aba-alocacao.js', 'render-aba-alocacao-mapa.js',
  // live-refresh.js (Task 2, 2026-08-25) substitui a cópia local de
  // atualizarDadosAoVivoSemanal -- consome só os 5 módulos comuns já
  // listados acima (parse-matriz-cliente/compute-equipes-ativas/
  // parse-avancos/parse-lab/compute-demandas), então entra por ÚLTIMO de
  // propósito: o contrato de ordem de browser-bundle.js exige que tudo que
  // ele faz require() já esteja registrado em MODULOS quando sua IIFE roda.
  // compute-equipes-nao-produtivas.js e compute-equipes-realizado-alocado.js
  // SAÍRAM do bundle (eram os dois módulos exclusivos do Δ equipes
  // Realizado, que esta página nunca desenha -- Tendência é sempre 'volume'):
  // esta página passa config.modulos: {} pro live-refresh, e o módulo NUNCA
  // faz require() direto dos dois (só via config.modulos, opcional) -- ver o
  // comentário no topo de live-refresh.js. Bundlar os dois aqui seria
  // trabalho morto: nada no script de cliente os leria mais.
  'live-refresh.js',
];

// Script cliente completo da página: estado, filtros, arrasto, live-refresh
// (atualizarDadosAoVivoSemanal) e a montagem da grade de Alocação.
const SCRIPT_CLIENTE_ALOCACAO = `
// Setup MapLibre -- réplica EXATA do que está em produção no projeto Mapa
// Sondagens (http://192.168.1.53:8080/, js/app.js), incluindo as 3 fontes
// Esri/ArcGIS Online (World_Imagery base + Reference/World_Transportation +
// Reference/World_Boundaries_and_Places sempre visíveis, sem toggle -- é
// assim que o Mapa Sondagens já roda), a atribuição, e o zoom só com Ctrl
// pressionado (scroll normal continua rolando a PÁGINA, não o mapa).
//
// Inicializado LAZY (só no primeiro clique na aba Mapa, não no load da
// página): o MapLibre precisa que o container já tenha tamanho real
// (largura/altura != 0) pra calcular a projeção certo -- inicializar com
// #secao-mapa-alocacao ainda em display:none produziria um mapa quebrado
// (tiles no lugar errado até um resize forçar o recálculo).
var MAPA_ALOCACAO = { instancia: null };

var URL_ESRI_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
var URL_ESRI_TRANSPORTE = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}';
var URL_ESRI_LIMITES = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

function inicializarMapaAlocacao() {
  if (MAPA_ALOCACAO.instancia) {
    // Já existe -- só garante que o tamanho está certo (a aba pode ter sido
    // aberta a 1ª vez com uma largura, e a janela redimensionada depois
    // enquanto a aba Kanban estava ativa e o mapa invisível).
    MAPA_ALOCACAO.instancia.resize();
    return;
  }
  var mapa = new maplibregl.Map({
    container: 'mapa-alocacao-canvas',
    style: {
      version: 8,
      sources: {
        'esri-imagery': { type: 'raster', tiles: [URL_ESRI_IMAGERY], tileSize: 256, maxzoom: 19, attribution: 'Tiles &copy; Esri' },
        'esri-transporte': { type: 'raster', tiles: [URL_ESRI_TRANSPORTE], tileSize: 256, maxzoom: 19 },
        'esri-limites': { type: 'raster', tiles: [URL_ESRI_LIMITES], tileSize: 256, maxzoom: 19 },
      },
      layers: [
        { id: 'esri-imagery', type: 'raster', source: 'esri-imagery' },
        { id: 'esri-transporte', type: 'raster', source: 'esri-transporte' },
        { id: 'esri-limites', type: 'raster', source: 'esri-limites' },
      ],
    },
    // Centro/zoom iniciais: mesma região do Mapa Sondagens (Paraná) --
    // ajustado sozinho na Task 12 pra enquadrar os pinos reais assim que
    // eles existirem (fitBounds).
    center: [-49.2, -25.5],
    zoom: 7,
    pitch: 0, bearing: 0, dragRotate: false, touchPitch: false,
    attributionControl: { compact: true },
  });
  mapa.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
  mapa.scrollZoom.disable();
  mapa.getContainer().addEventListener('wheel', function (evento) {
    if (!evento.ctrlKey) return;
    evento.preventDefault();
    var retangulo = mapa.getContainer().getBoundingClientRect();
    var lngLat = mapa.unproject([evento.clientX - retangulo.left, evento.clientY - retangulo.top]);
    mapa.easeTo({ zoom: mapa.getZoom() + (evento.deltaY < 0 ? 1 : -1), around: lngLat, duration: 0 });
  }, { passive: false });

  MAPA_ALOCACAO.instancia = mapa;
  MAPA_ALOCACAO.marcadores = {};

  // Assim que o estilo carrega, desenha os pinos com o dado que JÁ existe
  // em ESTADO_ALOCACAO (o mapa pode ter sido aberto bem depois do 1º
  // montarAbaAlocacao) -- ver Task 12 pra desenharPinosMapa.
  mapa.on('load', function () {
    montarAbaAlocacao();
  });
}

var ComputeSemanal = MODULOS['compute-semanal.js'];
var RenderAbaAlocacao = MODULOS['render-aba-alocacao.js'];
var RenderAbaAlocacaoMapa = MODULOS['render-aba-alocacao-mapa.js'];
var CoordenadasSup = MODULOS['coordenadas-sup.js'];
var EquipesAlocaveis = MODULOS['equipes-alocaveis.js'];
var GruposVeiculo = MODULOS['grupos-veiculo.js'];
var ComputeAlocacao = MODULOS['compute-alocacao.js'];
var AlocacaoSheet = MODULOS['alocacao-sheet.js'];
// ParseMatrizCliente/ParseAvancos/ParseLab/ComputeDemandas/ComputeEquipesAtivas
// (e os dois de equipes-não-produtivas/realizado-alocado) saíram daqui em
// 2026-08-25 (Task 2): eram lidos só dentro da cópia local de
// atualizarDadosAoVivoSemanal, agora em live-refresh.js -- ver LiveRefresh
// logo abaixo, perto de onde a função vivia.

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

// --- Alocação Equipes -----------------------------------------------------
// Arrastar equipe para contrato, recalculando na hora -- ver
// docs/superpowers/specs/2026-08-10-semanal-alocacao-equipes-design.md
// (desenho original, quando isto era a 7ª aba de planejamento-semanal.html)
// e docs/superpowers/specs/2026-08-25-alocacao-equipes-pagina-propria-design.md
// (extração pra página própria). O estado (aplicarMovimento,
// semearDoRealizado, selecionarSemanaAlocacao, montarAbaAlocacao), os filtros
// compartilhados (indicesFiltrados, não indicesDaAba -- ver o comentário em
// montarAbaAlocacao) e os guardas semRoster/somenteLeitura chamam
// montarAbaAlocacao() direto a cada mudança de filtro/mês/semana -- esta
// página não tem um ciclo tipo recalcularSemanal/ABAS_VISUALIZACAO (isso era
// mecanismo da semanal, que hospedava 7 abas; aqui só existe esta).
//
// A URL do web app de alocação viaja DENTRO do blob cifrado (ver
// renderAlocacaoPagina, URL_ALOCACAO), não em texto puro no HTML: só quem
// destrava a página a enxerga. Enquanto o Apps Script não for publicado, o
// literal fica 'PENDENTE-...' e a aba roda inteira em localStorage -- mesmo
// padrão de RE_URL_PENDENTE, e é o estado inicial do recurso.
// semanaCarregada: a chaveSemana (AlocacaoSheet.chaveSemana) cujo mapa já foi
// buscado (e, se for o caso, semeado) -- ver carregarAlocacaoDaSemana logo
// abaixo. Sem isto, montarAbaAlocacao (chamada a cada troca de filtro/mês)
// buscaria a alocação de novo em toda
// tecla, sobrescrevendo movimentos locais em trânsito.
//
// geracaoAlocacao: contador incrementado toda vez que a INTENÇÃO do usuário
// muda -- um arrasto aplicado (aplicarMovimento), "Repor o realizado"
// (semearDoRealizado), "Limpar alocação" (limparAlocacao), ou a própria troca
// de semana (selecionarSemanaAlocacao / o gatilho automático em
// montarAbaAlocacao). Existe para carregarAlocacaoDaSemana (logo abaixo)
// poder descartar uma resposta que chegou TARDE DEMAIS -- ver o comentário
// grande lá, é a correção do achado "arrasto sobrescrito pela promise que
// resolve depois" (CLAUDE.md, "Precisa ser corrigido ANTES desse Apps
// Script ir ao ar").
var ESTADO_ALOCACAO = {
  semanaIdx: -1, alocacao: {}, equipes: [], foraDoQuadro: [], cliente: null,
  semanaCarregada: null, geracaoAlocacao: 0, busca: '', tipologia: '',
};

// MARCADOR DE SEMANA JÁ VISTA (Decisão 9 do spec, correção pós-verificação em
// navegador real: "ao abrir uma semana sem alocação salva, o quadro é
// semeado com onde as equipes estão de fato" nunca disparava sozinho -- só o
// clique manual em "Repor o realizado" preenchia, e o quadro abria com 114
// células vazias e 114 cartões no pool).
//
// O PROBLEMA que o marcador resolve: "nunca teve alocação salva" e "foi
// esvaziada de propósito" (botão "Limpar alocação") são indistinguíveis só
// olhando o mapa que carregar() devolve -- as duas são {}. Semear toda vez
// que o mapa vier vazio reencheria o quadro atrás de quem acabou de limpar.
//
// Por isso o marcador NÃO é derivado da chave de DADO que AlocacaoSheet já
// grava (PREFIXO_ARMAZENAMENTO + chave, em alocacao-sheet.js) -- aquela
// chave é escrita mesmo quando o valor gravado é {} (aplicarLocal grava
// sempre, e carregar() em modo 'sheet' também grava um cache local a cada
// fetch, VAZIO OU NÃO, só para não bater na rede de novo). Se o marcador
// fosse "a chave de dado existe", um simples carregar() de uma semana nunca
// tocada por ninguém (mapa vazio vindo da Sheet) já marcaria "vista" antes
// de qualquer decisão de semear -- o mesmo bug, um nível abaixo. Por isso
// este marcador vive numa chave PRÓPRIA, gravada só depois que
// carregarAlocacaoDaSemana decide o que fazer (semear ou não), nunca como
// efeito colateral de uma leitura.
//
// Por que isto vale nos DOIS modos:
// - Modo LOCAL (o que a aba usa hoje -- URL_ALOCACAO ainda é 'PENDENTE-...'):
//   localStorage já É a fonte de verdade inteira neste modo -- não existe
//   nenhuma outra máquina para desincronizar. "Este navegador já viu esta
//   semana antes" e "existe alocação salva para esta semana" são a MESMA
//   pergunta, sempre.
// - Modo SHEET (quando o Apps Script for publicado): o marcador é POR
//   NAVEGADOR, não compartilhado pela Sheet -- um navegador abrindo uma
//   semana pela primeira vez busca o mapa de verdade da Sheet; se vier
//   com equipes, usa (nunca semeia por cima de dado real, não importa o
//   marcador). Só semeia quando a Sheet devolve vazio. A limitação
//   conhecida: o Apps Script atual (apps-script-alocacao.gs,
//   linhasDaSemana) filtra fora as linhas com sup vazio, então uma semana
//   ESVAZIADA de propósito por um colega noutro navegador e uma semana
//   NUNCA TOCADA por ninguém respondem o mesmo {linhas:[]} -- um terceiro
//   navegador abrindo aquela semana pela PRIMEIRA VEZ reintroduziria a
//   semeadura que o colega tinha limpado. Corrigir isso de vez pede um
//   sinal novo do lado da Sheet (linhasDaSemana teria que devolver "existe
//   linha" separado de "sup preenchido") -- fora do escopo desta correção,
//   que é sobre o CLIENTE, e sem efeito enquanto a aba roda em modo local.
function chaveSemanaVista(chaveSemana) {
  return 'alocacao-equipes:vista:' + chaveSemana;
}

// Sem window.localStorage (ambiente sem storage nenhum -- não deveria
// acontecer num navegador real, mas é o caso de alguns testes que não
// simulam nenhum), NADA sobrevive entre recargas mesmo -- inclusive o que
// "Limpar alocação" tentaria lembrar. Nesse cenário "sem onde lembrar" é
// igual a "nunca vista": semear de novo a cada abertura é o comportamento
// mais consistente (é literalmente o que Decisão 9 pede -- "abrir uma
// semana SEM alocação salva"), não o mais raro. Isto não insiste em loop:
// só é consultada uma vez por TROCA de semana (ver semanaCarregada em
// carregarAlocacaoDaSemana), nunca a cada redesenho da mesma semana.
function semanaJaVista(chaveSemana) {
  if (!chaveSemana || !window.localStorage) return false;
  try { return window.localStorage.getItem(chaveSemanaVista(chaveSemana)) === '1'; }
  catch (err) { return false; }
}

function marcarSemanaVista(chaveSemana) {
  if (!chaveSemana || !window.localStorage) return;
  try { window.localStorage.setItem(chaveSemanaVista(chaveSemana), '1'); } catch (err) { /* cota cheia -- sem drama, só não lembra na próxima */ }
}

function clienteAlocacao() {
  if (!ESTADO_ALOCACAO.cliente) {
    ESTADO_ALOCACAO.cliente = AlocacaoSheet.criarClienteAlocacao({
      url: (window.__ALOCACAO_URL__ || 'PENDENTE-publicar-o-apps-script'),
      fetch: function (u, o) { return fetch(u, o); },
      armazenamento: window.localStorage,
      autor: (window.__DASHBOARD_AUTOR__ || 'dashboard'),
    });
  }
  return ESTADO_ALOCACAO.cliente;
}

function chaveSemanaAtual() {
  var semanas = semanasDoMesSelecionado();
  var semana = semanas[ESTADO_ALOCACAO.semanaIdx];
  return semana ? AlocacaoSheet.chaveSemana(window.__ANO__, semana.inicio) : null;
}

// Recusa fora do conjunto de colunas da equipe e equipe indisponível. Devolve
// true quando aplicou -- é o que o handler de soltura usa para decidir se
// redesenha ou mostra o motivo. Repare que NÃO consulta a grade/tendência: uma
// célula hachurada (sem tendência), mas dentro do conjunto de colunas da
// equipe, é aceita igual -- é o caso de "antecipar carteira" que a aba existe
// para servir (Decisão 6 do spec de 2026-08-10).
//
// TRAVA DE VEÍCULO (2026-08-12): quem decide o que se move é destinoDoGrupo
// (grupos-veiculo.js), função pura -- equipes que dividem veículo não podem
// ficar em SUPs diferentes, então o destino do gesto vale para o grupo inteiro,
// pool inclusive. Esta função virou o laço que APLICA a lista. As duas recusas
// continuam existindo, agora dentro dela, e recusa move zero equipes.
//
// A trava mora aqui de propósito: é o funil por onde os DOIS gestos (arrasto e
// clique-clique) já passam. Espalhá-la pelos handlers deixaria um caminho sem
// ela. E semearDoRealizado/limparAlocacao NÃO passam por aqui, também de
// propósito (Decisão 4 do spec): a semeadura é o retrato do realizado, não um
// plano a validar.
function aplicarMovimento(equipeId, sup, coluna) {
  var movimentos = GruposVeiculo.destinoDoGrupo(
    ESTADO_ALOCACAO.equipes, ESTADO_ALOCACAO.alocacao, equipeId, sup, coluna);
  if (!movimentos.length) return false;

  movimentos.forEach(function (m) {
    if (!m.sup) delete ESTADO_ALOCACAO.alocacao[m.id];
    else ESTADO_ALOCACAO.alocacao[m.id] = { sup: m.sup, coluna: m.coluna };
  });
  // Invalida qualquer carregarAlocacaoDaSemana em voo -- ver o comentário
  // grande em ESTADO_ALOCACAO. UMA vez para o gesto inteiro, não uma por
  // equipe: o grupo é um gesto só.
  ESTADO_ALOCACAO.geracaoAlocacao++;

  montarAbaAlocacao();
  // A gravação vem DEPOIS do redesenho, e não é esperada: a tela nunca trava
  // por causa da rede, e uma falha não desfaz o que o usuário acabou de ver.
  // Uma gravação por equipe movida, mesmo laço de semearDoRealizado.
  var chave = chaveSemanaAtual();
  movimentos.forEach(function (m) {
    clienteAlocacao().gravar({
      chaveSemana: chave, equipeId: m.id,
      sup: m.sup || null, coluna: m.coluna || null,
    }).then(function () { montarAbaAlocacao(); });
  });
  return true;
}

// "Repor o realizado" (Decisão 9 do spec): a equipe some da alocação atual e
// reaparece no SUP/coluna de onde ela REALMENTE trabalhou na semana --
// supRealizado/colunaRealizada, que equipesDoQuadro (Task 1) já calcula a
// partir da ÚLTIMA OS vista na aba EQ (o vínculo não se rompe nos dias ativos
// sem OS). Equipe sem OS na semana, ou indisponível, fica de fora -- nasce no
// pool, nunca é chutada. SUBSTITUI a alocação inteira (é reposição, não
// mescla): é o botão "Repor", não "Completar".
function semearDoRealizado() {
  var nova = {};
  ESTADO_ALOCACAO.equipes.forEach(function (e) {
    if (e.disponivel && e.supRealizado && e.colunaRealizada) {
      nova[e.id] = { sup: e.supRealizado, coluna: e.colunaRealizada };
    }
  });
  ESTADO_ALOCACAO.alocacao = nova;
  // Ver o comentário em aplicarMovimento -- mesmo raciocínio, "Repor o
  // realizado" também é uma mudança de intenção que uma resposta tardia de
  // carregarAlocacaoDaSemana não pode desfazer.
  ESTADO_ALOCACAO.geracaoAlocacao++;
  montarAbaAlocacao();
  var chave = chaveSemanaAtual();
  Object.keys(nova).forEach(function (id) {
    clienteAlocacao().gravar({
      chaveSemana: chave, equipeId: id, sup: nova[id].sup, coluna: nova[id].coluna,
    }).then(function () { montarAbaAlocacao(); });
  });
}

// "Limpar alocação": esvazia a semana inteira -- a outra ação destrutiva da
// aba (Decisão 9). Grava a remoção de cada equipe que estava alocada, uma por
// uma, no mesmo padrão de aplicarMovimento (redesenha antes, grava depois).
// Marca a semana como vista explicitamente: é o próprio ato de esvaziar de
// propósito que o marcador existe para lembrar (embora, na prática, ela já
// tenha sido marcada quando a semana foi carregada -- este botão só aparece
// depois disso). Ver o comentário grande em ESTADO_ALOCACAO.
function limparAlocacao() {
  var idsAlocados = Object.keys(ESTADO_ALOCACAO.alocacao);
  ESTADO_ALOCACAO.alocacao = {};
  // Ver o comentário em aplicarMovimento -- mesmo raciocínio.
  ESTADO_ALOCACAO.geracaoAlocacao++;
  montarAbaAlocacao();
  var chave = chaveSemanaAtual();
  marcarSemanaVista(chave);
  idsAlocados.forEach(function (id) {
    clienteAlocacao().gravar({ chaveSemana: chave, equipeId: id, sup: null, coluna: null })
      .then(function () { montarAbaAlocacao(); });
  });
}

// Busca a alocação salva de 'chave' e decide se semeia do realizado
// (Decisão 9 do spec: "ao abrir uma semana sem alocação salva, o quadro é
// semeado com onde as equipes estão de fato"). Chamada tanto pela troca
// explícita de semana (selecionarSemanaAlocacao) quanto pelo primeiro
// desenho da aba (montarAbaAlocacao, achado da verificação em navegador
// real -- antes disto NADA carregava a alocação salva no primeiro render,
// só ao clicar num botão de semana).
//
// CORREÇÃO (antes do Apps Script ir ao ar -- ver CLAUDE.md): esta busca é
// ASSÍNCRONA (clienteAlocacao().carregar) e o redesenho é SÍNCRONO. Em modo
// local carregar() resolve numa microtask -- rápido demais para um clique de
// usuário colidir. Em modo 'sheet' vira uma ida-e-volta de rede de verdade
// (centenas de ms), e QUALQUER coisa pode acontecer nesse intervalo: um
// arrasto (aplicarMovimento), "Repor o realizado", "Limpar alocação", ou o
// usuário trocando de semana de novo antes desta resposta chegar. Sem
// proteção, ESTADO_ALOCACAO.alocacao = mapa || {} no .then() é uma
// ATRIBUIÇÃO -- sobrescreveria qualquer uma dessas ações com uma resposta
// que já está desatualizada (o arrasto "pula de volta" pro lugar antigo,
// sem erro nenhum na tela), ou pior, aplicaria a resposta de UMA semana no
// quadro de OUTRA (trocar de semana rápido demais). geracaoAlocacao
// (ESTADO_ALOCACAO) é o token que resolve os dois: capturado no INÍCIO desta
// função, comparado no fim -- se algo mudou a intenção do usuário nesse
// meio-tempo (o contador só anda em aplicarMovimento/semearDoRealizado/
// limparAlocacao/troca de semana), a resposta chegou tarde demais e é
// descartada, silenciosa e inteiramente (nem redesenha, nem semeia, nem
// marca a semana como vista -- quem bateu por cima já deixou a tela e o
// armazenamento num estado consistente por conta própria).
//
// A ORDEM (quando a resposta AINDA é válida) importa: desenha primeiro com
// o que veio salvo (ou vazio) -- é o que popula ESTADO_ALOCACAO.equipes (o
// roster da semana), e semearDoRealizado precisa dele pronto antes de
// rodar. Só semeia quando o mapa salvo veio vazio E a semana nunca foi
// vista antes (semanaJaVista) -- uma semana ESVAZIADA de propósito (Limpar
// alocação) também chega aqui com o mapa vazio, mas o marcador já foi
// gravado da primeira vez que ela foi aberta, e é isso que impede reencher
// o quadro atrás do usuário. marcarSemanaVista no fim roda em QUALQUER ramo
// válido -- inclusive quando não havia nada para semear -- para não
// insistir em buscar/semear de novo a cada redesenho.
function carregarAlocacaoDaSemana(chave) {
  var geracaoNoInicio = ESTADO_ALOCACAO.geracaoAlocacao;
  return clienteAlocacao().carregar(chave).then(function (mapa) {
    if (ESTADO_ALOCACAO.geracaoAlocacao !== geracaoNoInicio) return;

    var vazio = !mapa || !Object.keys(mapa).length;
    ESTADO_ALOCACAO.alocacao = mapa || {};
    montarAbaAlocacao();
    if (vazio && !semanaJaVista(chave)) {
      semearDoRealizado();
    }
    marcarSemanaVista(chave);
  });
}

// Troca a semana exibida e RECARREGA a alocação daquela semana do cliente
// (Sheet ou localStorage, conforme o modo) -- nunca herda o que estava na
// semana anterior: cada semana tem sua própria chave (chaveSemana), e
// ESTADO_ALOCACAO.alocacao é SUBSTITUÍDO pelo que carregar() devolve, nunca
// mesclado. Devolve a Promise de carregarAlocacaoDaSemana para quem chama
// poder esperar o estado (e a semeadura, se houver) assentarem antes de agir
// (o teste de troca de semana depende disso). semanaCarregada é marcada
// ANTES de disparar a busca, não depois: o redesenho dentro de
// carregarAlocacaoDaSemana chama montarAbaAlocacao(), que checaria de novo
// se a semana já foi carregada -- sem marcar aqui primeiro, isso disparia
// uma segunda busca redundante para a mesma semana. geracaoAlocacao também
// avança aqui: trocar de semana invalida qualquer carregarAlocacaoDaSemana
// da semana ANTERIOR que ainda esteja em voo -- sem isto, a resposta atrasada
// de uma semana já abandonada aterrissaria no quadro da semana nova (ver o
// comentário grande em carregarAlocacaoDaSemana).
function selecionarSemanaAlocacao(idx) {
  ESTADO_ALOCACAO.semanaIdx = idx;
  var chave = chaveSemanaAtual();
  ESTADO_ALOCACAO.semanaCarregada = chave;
  ESTADO_ALOCACAO.geracaoAlocacao++;
  return carregarAlocacaoDaSemana(chave);
}

// Preparo COMPARTILHADO entre a aba Kanban e a aba Mapa -- as duas leem o
// MESMO roster, os MESMOS filtros e a MESMA semana; só desenham de jeitos
// diferentes. Extraído (2026-08-26) pra aba Mapa não duplicar este bloco --
// era o corpo inteiro de montarAbaAlocacao antes desta task.
//
// 'indices' sai de indicesFiltrados, NÃO de indicesDaAba: o filtro de ativos
// esconderia justamente as linhas "Parado c/ carteira", que são o motivo de
// a aba existir (um SUP inativo em Volume ainda pode ter carteira parada e
// merecer uma equipe).
//
// producaoOnline (2026-08-26) viaja no payload cifrado, dentro de
// window.__DEMANDAS__ (build-dashboard.js e o live-refresh, ver
// atualizarDadosAoVivoSemanal) -- é a produção crua do Link 7
// (dist/equipes-online.csv, sond.com.br/campo/sondagens), sem ela
// supRealizado/colunaRealizada ficam sempre null e "Repor o realizado" não
// tem o que semear. Antes vinha de osParaSup (texto da Sheet EQ + furos) --
// ver docs/superpowers/specs/2026-08-26-realizado-alocacao-via-producao-sond-design.md.
// O fallback '|| []' é o default seguro para HTML de um build anterior a essa
// troca (degrada para "pool vazio de sugestão", nunca quebra).
function prepararOpcoesAlocacao() {
  var semanas = semanasDoMesSelecionado();
  if (ESTADO_ALOCACAO.semanaIdx < 0 || ESTADO_ALOCACAO.semanaIdx >= semanas.length) {
    ESTADO_ALOCACAO.semanaIdx = Math.max(0, ComputeSemanal.indiceSemanaAtual(semanas, hojeEpochDoNavegador()));
  }
  var semana = semanas[ESTADO_ALOCACAO.semanaIdx];

  var demandas = window.__DEMANDAS__ || {};
  // equipesRosterPeriodo (2026-08-21), não equipesPeriodo -- este último
  // agora descreve a cobertura do Realizado (Link 6+7), que a Alocação não
  // usa; o roster arrastável vem sempre da Sheet EQ (equipesCsv), e é a
  // cobertura DELA que decide se a semana em tela é "só leitura".
  var periodo = demandas.equipesRosterPeriodo;
  // semRoster: a Sheet espelho da aba EQ não respondeu (build ou live-refresh
  // falharam) -- equipesCsv null é a MESMA convenção de montarEquipesAtivas
  // (build-dashboard.js), nunca string vazia (que parsearia para "zero
  // equipes", indistinguível de "a planilha está vazia").
  var semRoster = demandas.equipesCsv === null || demandas.equipesCsv === undefined;
  // somenteLeitura: o espelho da EQ só cobre o MÊS que ele descreve
  // (periodo.mes) -- uma semana de outro mês não tem roster fresco, então a
  // grade continua desenhada mas nada é arrastável.
  var somenteLeitura = (!semRoster && periodo && (periodo.mes - 1) !== mesSelecionadoIdx)
    ? 'mes-diferente' : null;
  var roster = EquipesAlocaveis.equipesDoQuadro(demandas.equipesCsv || '', {
    ano: window.__ANO__,
    mes: periodo ? periodo.mes : (mesSelecionadoIdx + 1),
    semana: semana,
    producaoOnline: demandas.producaoOnline || [],
  });
  ESTADO_ALOCACAO.equipes = roster.equipes;
  ESTADO_ALOCACAO.foraDoQuadro = roster.foraDoQuadro;

  var indices = indicesFiltrados(
    window.__REGISTROS__,
    filtrosSelecionadosSemanal.tipologia, filtrosSelecionadosSemanal.categoria,
    filtrosSelecionadosSemanal.grupo, filtrosSelecionadosSemanal.sup, filtrosSelecionadosSemanal.origem
  );

  var cliente = clienteAlocacao();
  var o = {
    mesIdx: mesSelecionadoIdx, ano: window.__ANO__,
    semanas: semanas, semana: semana,
    demandas: demandas,
    semRoster: semRoster, somenteLeitura: somenteLeitura,
    equipes: ESTADO_ALOCACAO.equipes, foraDoQuadro: ESTADO_ALOCACAO.foraDoQuadro,
    alocacao: ESTADO_ALOCACAO.alocacao,
    // Não é estado persistido -- vive só aqui e no DOM, como a busca da aba
    // Alertas. Trocar de semana ou de mês não o preserva.
    buscaEquipe: ESTADO_ALOCACAO.busca,
    tipologiaAlocacao: ESTADO_ALOCACAO.tipologia,
    hojeEpoch: hojeEpochDoNavegador(),
    modoPersistencia: cliente.modo(),
    pendentes: cliente.pendentes().length,
  };
  return { semanas: semanas, semana: semana, indices: indices, o: o, semRoster: semRoster };
}

// Recomputa o roster da semana (equipesDoQuadro, Task 1 -- disponibilidade e
// vínculo com o SUP mudam a cada semana, mesmo sem novo build) e redesenha
// #secao-kanban-alocacao inteira com o estado atual de ESTADO_ALOCACAO.alocacao.
// NÃO mexe em persistência -- quem muda o que está alocado é
// aplicarMovimento/semearDoRealizado/limparAlocacao/selecionarSemanaAlocacao,
// cada um decidindo por si quando ler ou gravar; esta função só desenha o que
// já está em ESTADO_ALOCACAO.
function montarAbaAlocacao() {
  var prep = prepararOpcoesAlocacao();

  document.getElementById('secao-kanban-alocacao').innerHTML = RenderAbaAlocacao.renderAbaAlocacao(
    window.__REGISTROS__, prep.indices, prep.o
  );
  montarMapaAlocacao(prep);

  // Primeiro desenho de uma semana nova (boot da aba, ou troca de mês que
  // muda a semana em curso) -- busca a alocação salva e, se for o caso,
  // semeia do realizado (Decisão 9 do spec, ver o comentário grande em
  // ESTADO_ALOCACAO). NÃO dispara de novo a cada redesenho por filtro:
  // 'chave' só muda quando a semana em si muda, e semanaCarregada é marcada
  // ANTES do fetch assíncrono -- o redesenho que carregarAlocacaoDaSemana
  // dispara chama montarAbaAlocacao() de novo, e sem marcar aqui primeiro
  // isso repetiria a busca. Pulado quando semRoster: sem roster não há
  // equipe nenhuma para semear, e sem este corte o guard repetiria a busca
  // em todo redesenho enquanto a Sheet espelho da EQ não responder.
  // geracaoAlocacao avança junto com semanaCarregada -- mesmo raciocínio de
  // selecionarSemanaAlocacao: uma resposta em voo da semana ANTERIOR não
  // pode aterrissar no quadro desta semana nova.
  var chaveDaSemana = prep.semana ? AlocacaoSheet.chaveSemana(window.__ANO__, prep.semana.inicio) : null;
  if (chaveDaSemana && chaveDaSemana !== ESTADO_ALOCACAO.semanaCarregada && !prep.semRoster) {
    ESTADO_ALOCACAO.semanaCarregada = chaveDaSemana;
    ESTADO_ALOCACAO.geracaoAlocacao++;
    carregarAlocacaoDaSemana(chaveDaSemana);
  }
}

// A aba Mapa: mesmo preparo (prep) que o Kanban acabou de usar -- reusa
// prepararDadosAlocacao (render-aba-alocacao.js) pra ter grade/resumo sem
// recalcular a mão. Sempre redesenha o HTML (controles/pool/resumo, barato);
// os PINOS só são desenhados se o mapa já foi inicializado (Task 11/12) --
// evita inicializar o MapLibre num container ainda invisível (display:none
// enquanto a aba Kanban está ativa).
function montarMapaAlocacao(prep) {
  var secao = document.getElementById('secao-mapa-alocacao');
  if (prep.semRoster) {
    secao.innerHTML = RenderAbaAlocacaoMapa.renderAbaAlocacaoMapa(null, { semRoster: true });
    return;
  }
  var dados = RenderAbaAlocacao.prepararDadosAlocacao(window.__REGISTROS__, prep.indices, prep.o);
  secao.innerHTML = RenderAbaAlocacaoMapa.renderAbaAlocacaoMapa(dados, prep.o);
  // desenharPinosMapa/atualizarPainelSemLocalizacao entram na Task 12 -- até
  // lá esta função só desenha o shell (controles/pool/resumo).
  if (typeof desenharPinosMapa === 'function' && MAPA_ALOCACAO.instancia) {
    desenharPinosMapa(dados, (window.__DEMANDAS__ || {}).coordenadasPorSup || {});
  }
}

// Pointer Events, não o drag-and-drop nativo do HTML5: o nativo não funciona
// em toque nenhum, e este quadro precisa servir num tablet. O mesmo caminho
// atende mouse e dedo.
//
// Um clique curto (sem mover) SELECIONA a equipe (fica destacada e as células
// compatíveis continuam acesas); o clique seguinte numa célula a solta ali.
// Isso é o atalho de teclado/precisão.
//
// FIX (revisão do Task 9, achado Critical 1): a seleção NÃO é decidida em
// 'pointerup' -- um toque simples dispara pointerdown -> pointerup -> click
// como UM gesto só, e o 'click' final desse MESMO gesto chegaria logo depois
// do pointerup que acabou de marcar a seleção, consumindo-a na hora (o clique
// se autocancelava, e o atalho de precisão/teclado nunca funcionava de
// verdade num navegador -- só parecia funcionar no DOM falso, que nunca
// sintetiza o 'click' seguinte). Agora a seleção nasce e morre inteiramente
// dentro do handler de 'click': o clique de um toque sem movimento SELECIONA
// (se nada estava selecionado), e o clique seguinte, numa célula, SOLTA. O
// clique final de um ARRASTO de verdade (moveu=true, já resolvido dentro de
// 'pointerup') é suprimido via SUPRIMIR_PROXIMO_CLICK_ALOCACAO, para não ser
// tratado de novo.
var ARRASTO_ALOCACAO = { pointerId: null, cartao: null, equipeId: null, fantasma: null, moveu: false };
var SELECAO_ALOCACAO = { equipeId: null };
var SUPRIMIR_PROXIMO_CLICK_ALOCACAO = false;

function equipeAlocavelPeloId(id) {
  for (var i = 0; i < ESTADO_ALOCACAO.equipes.length; i++) {
    if (ESTADO_ALOCACAO.equipes[i].id === id) return ESTADO_ALOCACAO.equipes[i];
  }
  return null;
}

// TRAVA DE VEÍCULO (2026-08-12): "devolver" move o GRUPO inteiro
// (destinoDoGrupo), pool inclusive -- então soltar no pool tem efeito mesmo
// quando a equipe ARRASTADA está no pool, desde que uma COMPANHEIRA esteja
// alocada (ela seria puxada pro pool junto). Por isso o pool tem de acender
// quando a arrastada OU qualquer companheira dela está alocada, não só a
// arrastada -- achado da revisão final de 2026-08-12, o motivo desta rodada.
function podeDevolverGrupo(equipeId, companheiros) {
  if (ESTADO_ALOCACAO.alocacao[equipeId]) return true;
  return (companheiros || []).some(function (id) {
    return !!ESTADO_ALOCACAO.alocacao[id];
  });
}

// Acende as células compatíveis com a equipe (celula-alvo) e esmaece as
// demais (celula-inerte). Limpa sempre pelo par abaixo -- em TODO caminho de
// saída do arrasto, inclusive recusa, senão o quadro fica preso num estado de
// "arrastando" que nunca existiu de verdade.
// podeDevolver: acende o POOL quando a equipe arrastada OU alguma companheira
// de veículo dela já está alocada (ver podeDevolverGrupo acima) -- com a
// trava no ar, arrastar uma equipe do POOL de volta pro pool ainda pode
// devolver uma companheira que estava alocada, então "não faz nada" seria
// mentira nesse caso.
//
// raiz (achado Important 3 da revisão do Task 9): renderControles emite
// #status-alocacao/#busca-equipe/#filtro-tipologia-alocacao, e desde que a
// aba Mapa passou a chamar renderControles TAMBÉM (render-aba-alocacao-mapa.js),
// esses ids -- e as classes .celula-alocacao/[data-equipe]/.pool-alocacao --
// existem DUAS vezes no documento assim que montarAbaAlocacao roda, uma vez
// por seção. Um document.querySelectorAll (sem raiz) varreria as duas, e um
// arrasto no Kanban carimbaria/apagaria destaque na aba Mapa escondida
// também. Todo call site de dentro de inicializarInteracaoAlocacao já
// conhece a seção que disparou o gesto (a variável 'secao' do closure) e
// passa ela aqui -- default 'document' só para não quebrar quem chama esta
// função direto (testes, ex. test/semanal-alocacao-interacao.test.js), que
// não têm duas seções competindo pelo mesmo id/classe no DOM falso.
function destacarCelulasCompativeis(colunas, podeDevolver, companheiros, raiz) {
  var r = raiz || document;
  var celulas = r.querySelectorAll('.celula-alocacao');
  for (var i = 0; i < celulas.length; i++) {
    var coluna = celulas[i].getAttribute ? celulas[i].getAttribute('data-coluna') : null;
    if (colunas.indexOf(coluna) !== -1) celulas[i].classList.add('celula-alvo');
    else celulas[i].classList.add('celula-inerte');
  }
  // As companheiras de veículo (trava de 2026-08-12): quem vai junto tem de
  // aparecer ANTES da soltura, não depois. O cartão de uma equipe polivalente
  // se repete em cada grupo do pool, então acende TODAS as instâncias dele.
  // Achado Minor 4 (revisão final): id interpolado cru dentro do seletor
  // lançaria DOMException se algum dia carregasse aspas -- ANTES do
  // setPointerCapture, matando o gesto inteiro. Em vez de montar seletor
  // nenhum, busca todo cartão com data-equipe e compara o valor em JS.
  var todosOsCartoes = r.querySelectorAll('[data-equipe]');
  (companheiros || []).forEach(function (idBruto) {
    var id = String(idBruto);
    for (var j = 0; j < todosOsCartoes.length; j++) {
      if (todosOsCartoes[j].getAttribute('data-equipe') === id) {
        todosOsCartoes[j].classList.add('cartao-companheiro');
      }
    }
  });
  if (!podeDevolver) return;
  var pool = r.querySelector('.pool-alocacao');
  if (pool) pool.classList.add('pool-alvo');
}

// Chamava-se limparDestaqueCelulas, e o nome virou mentira em 2026-08-11,
// quando o pool passou a acender junto -- e mais ainda em 2026-08-12, com as
// companheiras de veículo. É chamada dos CINCO pontos que encerram um gesto, e
// todos querem a limpeza COMPLETA: limpar qualquer uma dessas marcas em outro
// lugar a deixaria acesa para sempre em pelo menos um dos quatro caminhos de
// saída do arrasto (soltura aceita, recusada, pointercancel, ou solta fora de
// tudo). Ver o comentário de encerrarArrastoAlocacao.
//
// raiz: mesmo motivo/mesmo default de destacarCelulasCompativeis acima.
function limparDestaquesAlocacao(raiz) {
  var r = raiz || document;
  var celulas = r.querySelectorAll('.celula-alocacao');
  for (var i = 0; i < celulas.length; i++) {
    celulas[i].classList.remove('celula-alvo');
    celulas[i].classList.remove('celula-inerte');
  }
  var companheiros = r.querySelectorAll('.cartao-companheiro');
  for (var j = 0; j < companheiros.length; j++) {
    companheiros[j].classList.remove('cartao-companheiro');
  }
  var pool = r.querySelector('.pool-alocacao');
  if (pool) pool.classList.remove('pool-alvo');
}

function criarFantasmaArrasto(equipeId) {
  var fantasma = document.createElement('div');
  fantasma.className = 'fantasma-arrasto';
  fantasma.textContent = equipeId;
  document.body.appendChild(fantasma);
  return fantasma;
}

function posicionarFantasmaArrasto(fantasma, x, y) {
  fantasma.style.left = x + 'px';
  fantasma.style.top = y + 'px';
}

function removerFantasmaArrasto() {
  if (ARRASTO_ALOCACAO.fantasma && ARRASTO_ALOCACAO.fantasma.parentNode) {
    ARRASTO_ALOCACAO.fantasma.parentNode.removeChild(ARRASTO_ALOCACAO.fantasma);
  }
  ARRASTO_ALOCACAO.fantasma = null;
}

// Único ponto de saída do ARRASTO (não da seleção por clique, que é estado
// separado) -- os QUATRO caminhos (soltura aceita, recusada, cancelada por
// pointercancel, ou solta fora de qualquer célula) passam por aqui, e todos
// deixam o quadro exatamente igual: sem fantasma, sem destaque, sem captura
// de ponteiro presa, e ARRASTO_ALOCACAO de volta ao repouso.
//
// raiz: repassada pra limparDestaquesAlocacao (achado Important 3, ver o
// comentário lá) -- os dois call sites (pointerup/pointercancel, dentro de
// inicializarInteracaoAlocacao) já têm a seção certa em mãos.
function encerrarArrastoAlocacao(raiz) {
  if (ARRASTO_ALOCACAO.cartao && ARRASTO_ALOCACAO.pointerId !== null
    && typeof ARRASTO_ALOCACAO.cartao.releasePointerCapture === 'function') {
    try { ARRASTO_ALOCACAO.cartao.releasePointerCapture(ARRASTO_ALOCACAO.pointerId); } catch (err) { /* já liberada, ou o alvo sumiu do DOM -- sem problema */ }
  }
  removerFantasmaArrasto();
  ARRASTO_ALOCACAO.pointerId = null;
  ARRASTO_ALOCACAO.cartao = null;
  ARRASTO_ALOCACAO.equipeId = null;
  ARRASTO_ALOCACAO.moveu = false;
  limparDestaquesAlocacao(raiz);
}

// Resolve a .celula-alocacao sob o ponto do soltar.
//
// FIX (revisão do Task 9, achado Critical 2): a resolução agora prioriza
// document.elementFromPoint(clientX, clientY), não mais e.target -- porque
// pointerdown passou a capturar o ponteiro no cartão (setPointerCapture, ver
// inicializarInteracaoAlocacao), e com o ponteiro CAPTURADO o navegador
// retarget-a e.target para o elemento que capturou, não para o que está
// fisicamente sob o dedo/cursor no momento de soltar. Usar e.target aqui
// resolveria sempre para o próprio cartão (ou a célula de ORIGEM), nunca o
// destino. elementFromPoint continua funcionando porque lê a posição real na
// tela, ignorando quem capturou o quê. Cai para e.target.closest só em
// ambiente sem elementFromPoint (não deveria acontecer em navegador real).
// Resolve o ALVO do soltar: uma célula, o pool, ou nada.
//
// Era resolverCelulaAlocacao, que só conhecia célula e devolvia null para todo
// o resto -- por isso soltar no pool não fazia nada. A devolução (2026-08-11)
// precisa distinguir "soltou no pool" de "soltou no vazio": o primeiro devolve
// a equipe ao pool, o segundo não faz NADA, de propósito. Alocar é trabalho do
// usuário; um solte impreciso não pode desfazê-lo.
function resolverAlvoAlocacao(e) {
  var sob = null;
  if (typeof document.elementFromPoint === 'function' && typeof e.clientX === 'number') {
    sob = document.elementFromPoint(e.clientX, e.clientY);
  }
  if (!sob) sob = e.target;
  if (!sob || !sob.closest) return null;
  // A célula ganha prioridade: se por layout as duas casarem, o destino
  // específico vence o genérico.
  var celula = sob.closest('.celula-alocacao');
  if (celula) return { tipo: 'celula', el: celula };
  if (sob.closest('.pool-alocacao')) return { tipo: 'pool', el: null };
  return null;
}

// Um único listener delegado em #secao-kanban-alocacao, montado UMA VEZ (a
// seção nunca é recriada -- mesmo padrão do listener do Balanço, ver
// inicializarTooltipBalanco acima). #secao-kanban-alocacao existe no HTML
// estático desde o load (ver renderAlocacaoPagina), então este wireup pode
// rodar incondicionalmente, antes até da senha ser digitada -- só reage a
// eventos que, na prática, só acontecem depois que montarAbaAlocacao() já
// desenhou algo lá dentro. Renomeada de #secao-alocacao pra #secao-kanban-alocacao
// na Task 9 (2026-08-26), quando a nav Kanban/Mapa dividiu a seção única em
// duas -- a interação de arrasto (Pointer Events) só existe na grade Kanban,
// nunca na aba Mapa.
function inicializarInteracaoAlocacao() {
  var secao = document.getElementById('secao-kanban-alocacao');

  secao.addEventListener('pointerdown', function (e) {
    var cartao = e.target && e.target.closest ? e.target.closest('[data-equipe][data-arrastavel="sim"]') : null;
    if (!cartao) return;
    // FIX (revisão do Task 9, achado Important 3): um arrasto já em
    // andamento (outro pointerId) NÃO é sequestrado por um segundo dedo --
    // a aba move uma equipe por vez. O segundo pointerdown é ignorado até o
    // primeiro terminar (pointerup/pointercancel).
    if (ARRASTO_ALOCACAO.pointerId !== null) return;
    var equipeId = cartao.getAttribute('data-equipe');
    var equipe = equipeAlocavelPeloId(equipeId);
    if (!equipe) return;
    // Limpa qualquer resíduo ANTES de acender de novo -- uma seleção anterior
    // abandonada (clicou numa equipe e apertou outra sem soltar) deixaria o
    // destaque da primeira somado ao da segunda, senão.
    SELECAO_ALOCACAO.equipeId = null;
    limparDestaquesAlocacao(secao);

    ARRASTO_ALOCACAO.pointerId = e.pointerId;
    ARRASTO_ALOCACAO.cartao = cartao;
    ARRASTO_ALOCACAO.equipeId = equipeId;
    ARRASTO_ALOCACAO.moveu = false;
    ARRASTO_ALOCACAO.fantasma = criarFantasmaArrasto(equipeId);
    posicionarFantasmaArrasto(ARRASTO_ALOCACAO.fantasma, e.clientX, e.clientY);
    destacarCelulasCompativeis(equipe.colunas || [], podeDevolverGrupo(equipeId, equipe.companheiros), equipe.companheiros || [], secao);

    // FIX (revisão do Task 9, achado Critical 2): captura o ponteiro no
    // cartão -- garante que pointermove/pointerup/pointercancel CONTINUAM
    // chegando a este elemento (e, por bolha, em #secao-kanban-alocacao, que é
    // ancestral dele) mesmo que o ponteiro saia fisicamente da seção antes de
    // soltar (arrastar pra cima do cabeçalho, ou a seção não preencher a
    // viewport num tablet). Sem isso nenhum dos dois evento dispara, e o
    // fantasma/destaque ficam presos na tela para sempre.
    if (typeof cartao.setPointerCapture === 'function') {
      try { cartao.setPointerCapture(e.pointerId); } catch (err) { /* alvo removido entre o evento e a chamada -- sem problema */ }
    }
  });

  // O campo de busca de equipe. montarAbaAlocacao refaz a seção inteira, então
  // o input é OUTRO elemento a cada tecla -- sem devolver o foco e o cursor, só
  // daria pra digitar um caractere por vez.
  //
  // FIX (revisão do Task 9, achado Important 3): a busca por
  // document.getElementById('busca-equipe') resolvia pro campo do Kanban só
  // por ACIDENTE de ordem no documento -- desde que renderAbaAlocacaoMapa
  // também chama renderControles (a aba Mapa tem o mesmo #busca-equipe), há
  // dois na página assim que montarAbaAlocacao roda. secao.querySelector
  // escopa pro campo DESTA seção (a que disparou o 'input'), por construção,
  // não por ordem.
  secao.addEventListener('input', function (e) {
    var campo = e.target && e.target.id === 'busca-equipe' ? e.target : null;
    if (!campo) return;
    ESTADO_ALOCACAO.busca = campo.value || '';
    montarAbaAlocacao();
    var novo = secao.querySelector('#busca-equipe');
    if (novo && typeof novo.focus === 'function') {
      novo.focus();
      if (typeof novo.setSelectionRange === 'function') {
        novo.setSelectionRange(novo.value.length, novo.value.length);
      }
    }
  });

  // O filtro de tipologia da aba. <select> dispara 'change'; o 'input' acima
  // tambem o ve, mas sai fora porque o id nao bate.
  secao.addEventListener('change', function (e) {
    var sel = e.target && e.target.id === 'filtro-tipologia-alocacao' ? e.target : null;
    if (!sel) return;
    ESTADO_ALOCACAO.tipologia = sel.value || '';
    montarAbaAlocacao();
  });

  secao.addEventListener('pointermove', function (e) {
    if (ARRASTO_ALOCACAO.pointerId === null || e.pointerId !== ARRASTO_ALOCACAO.pointerId) return;
    ARRASTO_ALOCACAO.moveu = true;
    if (ARRASTO_ALOCACAO.fantasma) posicionarFantasmaArrasto(ARRASTO_ALOCACAO.fantasma, e.clientX, e.clientY);
  });

  secao.addEventListener('pointerup', function (e) {
    if (ARRASTO_ALOCACAO.pointerId === null || e.pointerId !== ARRASTO_ALOCACAO.pointerId) return;
    var equipeId = ARRASTO_ALOCACAO.equipeId;
    var moveu = ARRASTO_ALOCACAO.moveu;
    encerrarArrastoAlocacao(secao);

    if (!moveu) {
      // Clique sem mover: NÃO decide nada aqui (ver o comentário grande sobre
      // Critical 1, acima de ARRASTO_ALOCACAO) -- quem seleciona é o 'click'
      // que o navegador dispara a seguir, para este MESMO gesto.
      return;
    }

    // Arrasto de verdade: resolve o alvo e aplica -- sempre, inclusive quando
    // não há célula sob o ponto (soltou fora da grade) ou quando
    // aplicarMovimento recusa. O destaque/fantasma já foram limpos por
    // encerrarArrastoAlocacao() acima.
    // Célula aloca; pool DEVOLVE; vazio não faz nada.
    var alvo = resolverAlvoAlocacao(e);
    if (alvo && alvo.tipo === 'celula') {
      aplicarMovimento(equipeId, alvo.el.getAttribute('data-sup'), alvo.el.getAttribute('data-coluna'));
    } else if (alvo && alvo.tipo === 'pool') {
      aplicarMovimento(equipeId, '', '');
    }
    // O 'click' que o navegador dispara logo depois, para este MESMO gesto de
    // arrasto, já foi resolvido aqui -- suprime esse click específico (ver o
    // handler de 'click' abaixo) para não reaplicar nem tentar selecionar.
    SUPRIMIR_PROXIMO_CLICK_ALOCACAO = true;
  });

  // pointercancel: o navegador interrompe o gesto (rolagem do sistema, troca
  // de app, toque cancelado) sem nunca disparar pointerup. Mesma limpeza de
  // uma recusa -- nunca aplica nada, e nunca deixa uma seleção pendente (o
  // gesto foi interrompido, não completado).
  secao.addEventListener('pointercancel', function (e) {
    if (ARRASTO_ALOCACAO.pointerId === null || e.pointerId !== ARRASTO_ALOCACAO.pointerId) return;
    encerrarArrastoAlocacao(secao);
  });

  secao.addEventListener('click', function (e) {
    // O clique final de um ARRASTO de verdade (pointerup com moveu=true) já
    // foi resolvido lá -- este é o mesmo gesto, ignora e consome a flag.
    if (SUPRIMIR_PROXIMO_CLICK_ALOCACAO) {
      SUPRIMIR_PROXIMO_CLICK_ALOCACAO = false;
      return;
    }

    var acaoEl = e.target && e.target.closest ? e.target.closest('[data-acao]') : null;
    if (acaoEl) {
      var nome = acaoEl.getAttribute('data-acao');
      if (nome === 'repor-realizado') {
        if (Object.keys(ESTADO_ALOCACAO.alocacao).length
          && typeof window.confirm === 'function'
          && !window.confirm('Repor o realizado substitui a alocação atual desta semana. Continuar?')) return;
        semearDoRealizado();
      } else if (nome === 'limpar-alocacao') {
        if (Object.keys(ESTADO_ALOCACAO.alocacao).length
          && typeof window.confirm === 'function'
          && !window.confirm('Limpar toda a alocação desta semana?')) return;
        limparAlocacao();
      } else if (nome === 'tentar-de-novo') {
        clienteAlocacao().tentarDeNovo().then(montarAbaAlocacao);
      }
      return;
    }

    var botaoSemana = e.target && e.target.closest ? e.target.closest('[data-semana]') : null;
    if (botaoSemana) {
      selecionarSemanaAlocacao(parseInt(botaoSemana.getAttribute('data-semana'), 10));
      return;
    }

    // Já havia uma equipe selecionada (1º clique de um gesto ANTERIOR, feito
    // e concluído -- não pode ser o mesmo clique atual, que já teria sido
    // suprimido acima se pertencesse a um arrasto, e a seleção só nasce aqui
    // embaixo, nunca em pointerup): este clique é o 2º passo, solta na
    // célula (se houver) e encerra a seleção -- aceita ou recusa, sempre
    // limpa o destaque.
    if (SELECAO_ALOCACAO.equipeId) {
      var equipeIdSelecionado = SELECAO_ALOCACAO.equipeId;
      SELECAO_ALOCACAO.equipeId = null;
      limparDestaquesAlocacao(secao);
      // Mesmo alvo do arrasto: clicar no pool com uma equipe selecionada
      // devolve, exatamente como soltá-la ali.
      var alvoClique = resolverAlvoAlocacao(e);
      if (alvoClique && alvoClique.tipo === 'celula') {
        aplicarMovimento(equipeIdSelecionado, alvoClique.el.getAttribute('data-sup'), alvoClique.el.getAttribute('data-coluna'));
      } else if (alvoClique && alvoClique.tipo === 'pool') {
        aplicarMovimento(equipeIdSelecionado, '', '');
      }
      return;
    }

    // Sem seleção pendente: um clique sem movimento (o pointerup acima só
    // limpou o ARRASTO, nunca aplicou nada) num cartão arrastável é o 1º
    // passo do atalho -- SELECIONA e mantém o destaque aceso, esperando o
    // próximo clique numa célula.
    var cartaoClicado = e.target && e.target.closest ? e.target.closest('[data-equipe][data-arrastavel="sim"]') : null;
    if (!cartaoClicado) return;
    var equipeIdClicado = cartaoClicado.getAttribute('data-equipe');
    var equipeClicada = equipeAlocavelPeloId(equipeIdClicado);
    if (!equipeClicada) return;
    SELECAO_ALOCACAO.equipeId = equipeIdClicado;
    destacarCelulasCompativeis(equipeClicada.colunas || [], podeDevolverGrupo(equipeIdClicado, equipeClicada.companheiros), equipeClicada.companheiros || [], secao);
  });
}

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

function definirStatusAtualizacaoSemanal(texto, ehErro) {
  var el = document.getElementById('status-atualizacao');
  if (!el) return;
  el.textContent = texto;
  el.classList.toggle('status-erro', !!ehErro);
}

// live-refresh.js (Task 2, 2026-08-25) é a fonte única desta lógica -- ver o
// histórico completo da duplicação (e por que as duas páginas divergiam) no
// cabeçalho de tools/semanal/live-refresh.js. Esta página passa só as 6
// fontes que a Alocação de fato lê (matriz/avancos/lab/eq/demandasSondagem/
// demandasLab) e config.rosterAlocacao: true -- liga os 3 campos exclusivos
// dela (equipesCsv/osParaSup/equipesRosterPeriodo). producao/roster (Link
// 6+7) e config.modulos ficam de fora de propósito: os dois só alimentam
// equipesPorDia/equipesNaoProdutivas (Realizado de Equipes), que esta página
// nunca lê -- a Tendência dela é sempre 'volume' (compute-alocacao.js), e
// volume não toca nenhum dos dois campos.
var LiveRefresh = MODULOS['live-refresh.js'];

function atualizarDadosAoVivoSemanal() {
  return LiveRefresh.atualizarDadosAoVivo({
    fontes: {
      matriz: LiveRefresh.URLS_PADRAO.matriz,
      avancos: LiveRefresh.URLS_PADRAO.avancos,
      lab: LiveRefresh.URLS_PADRAO.lab,
      eq: LiveRefresh.URLS_PADRAO.eq,
      demandasSondagem: LiveRefresh.URLS_PADRAO.demandasSondagem,
      demandasLab: LiveRefresh.URLS_PADRAO.demandasLab,
      // producao/roster NÃO entram: só alimentam equipesPorDia (Realizado de
      // Equipes), que esta página nunca lê -- a Tendência dela é sempre
      // 'volume' (compute-alocacao.js), e volume não toca equipesPorDia.
    },
    modulos: {},   // idem: sem os dois módulos de equipes-realizado/não-produtivas
    ano: window.__ANO__,
    rosterAlocacao: true,
    estadoAtual: function () {
      return { registros: window.__REGISTROS__, demandas: window.__DEMANDAS__ };
    },
    aplicar: function (registrosNovos, demandasNovas) {
      window.__REGISTROS__ = registrosNovos;
      window.__DEMANDAS__ = demandasNovas;
      montarTodosFiltrosMultiSemanal(window.__REGISTROS__);
      montarAbaAlocacao();
    },
    definirStatus: definirStatusAtualizacaoSemanal,
  });
}

document.getElementById('atualizar-dashboard').addEventListener('click', atualizarDadosAoVivoSemanal);

// Wireup incondicional, no load do script -- #secao-kanban-alocacao já existe
// no HTML estático (ver renderAlocacaoPagina), e o listener delegado não
// depende de senha nem de a aba já ter sido desenhada.
inicializarInteracaoAlocacao();

// Nav Kanban/Mapa -- markupAbas() (tools/comum/render-shell.js) já desenha
// o <div class="abas-visualizacao"> com os dois <button>; aqui só liga o
// clique. Lazy-init do MapLibre no primeiro clique na aba Mapa (Task 11) --
// aqui só troca o display e redesenha; a inicialização do mapa em si mora
// em inicializarMapaAlocacao(), chamada por este mesmo handler quando ainda
// não existir instância.
document.getElementById('aba-kanban-alocacao').addEventListener('click', function () {
  document.getElementById('aba-kanban-alocacao').classList.add('aba-ativa');
  document.getElementById('aba-mapa-alocacao').classList.remove('aba-ativa');
  document.getElementById('secao-kanban-alocacao').style.display = '';
  document.getElementById('secao-mapa-alocacao').style.display = 'none';
});
document.getElementById('aba-mapa-alocacao').addEventListener('click', function () {
  document.getElementById('aba-mapa-alocacao').classList.add('aba-ativa');
  document.getElementById('aba-kanban-alocacao').classList.remove('aba-ativa');
  document.getElementById('secao-kanban-alocacao').style.display = 'none';
  document.getElementById('secao-mapa-alocacao').style.display = '';
  if (typeof inicializarMapaAlocacao === 'function') inicializarMapaAlocacao();
});
`;

function renderAlocacaoPagina({
  registros, demandas, periodos, senha, geradoEm, logoDataUri, iconDataUri,
  avisoAtualizacao, ultimaAtualizacaoOkIso,
  nimbusRegularDataUri, nimbusBlackDataUri, texturaMapaDataUri,
}) {
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

  // @font-face da marca Suporte Infra (Nimbus Sans Extd) -- só as declarações;
  // o CSS que USA essas fontes na aba Mapa chega na Task 10. A custom property
  // --textura-mapa-alocacao carrega a textura pro mesmo <style> desde já (pra
  // não depender do build ler o arquivo de novo), mas ainda não é usada por
  // nenhuma regra -- Task 10 consome via var(--textura-mapa-alocacao).
  const cssFontesMapa = (nimbusRegularDataUri || nimbusBlackDataUri || texturaMapaDataUri) ? `
  ${nimbusRegularDataUri ? `@font-face { font-family: "Nimbus Sans Extd"; src: url("${nimbusRegularDataUri}") format("opentype"); font-weight: 400; }` : ''}
  ${nimbusBlackDataUri ? `@font-face { font-family: "Nimbus Sans Extd"; src: url("${nimbusBlackDataUri}") format("opentype"); font-weight: 900; }` : ''}
  ${texturaMapaDataUri ? `:root { --textura-mapa-alocacao: url("${texturaMapaDataUri}"); }` : ''}
` : '';

  // CSS Suporte Infra (Task 10) -- paleta/tipografia do Guia de Marca, mas
  // ESCOPADA inteira dentro de #secao-mapa-alocacao: a aba Kanban continua
  // com o visual de sempre (cssBase()/CSS_SEMANAL/CSS_ABAS_SEMANAL,
  // #secao-kanban-alocacao), e migrar o Kanban pra essa marca é trabalho
  // futuro separado, ainda não pedido. Reusa var(--textura-mapa-alocacao)
  // (Task 7, ver cssFontesMapa acima) em vez de reinterpolar
  // texturaMapaDataUri de novo -- só decide SE a regra de background-image
  // entra (o parâmetro pode faltar, ver o teste "sem os data URIs..."), o
  // valor em si vem da custom property.
  //
  // Vai DEPOIS de CSS_DEMANDAS de propósito: render-semanal.js:501
  // (dentro de CSS_SEMANAL, que entra ANTES neste bloco <style>) já declara
  // "#secao-kanban-alocacao, #secao-mapa-alocacao { position: relative;
  // z-index: 1; background: var(--page); }" pra apagar a marca d'água atrás
  // das duas seções -- essencial pra continuar valendo aqui (mesmos
  // position/z-index, repetidos abaixo por clareza), mas o "background:
  // var(--page)" tem de perder pro fundo escuro da marca. Duas regras pro
  // MESMO seletor #secao-mapa-alocacao, mesma especificidade -- quem vem
  // DEPOIS no CSS vence a cascata, então esta precisa ficar por último.
  const cssMapaAlocacao = `
  #secao-mapa-alocacao {
    --mapa-fundo: #0c0d10;
    --mapa-fundo-painel: rgba(0, 22, 59, 0.45);
    --mapa-borda-painel: rgba(255, 255, 255, 0.1);
    --mapa-texto: #f4f6fa;
    --mapa-texto-secundario: #a9b3c9;
    --mapa-acento: #f3b53f;
    --mapa-acento-contraste: #00163b;
    position: relative;
    z-index: 1;
    border-radius: 12px;
    overflow: hidden;
    background: var(--mapa-fundo);
    color: var(--mapa-texto);
    font-family: "Poppins", -apple-system, "Segoe UI", Roboto, sans-serif;
    padding: 16px;
  }
  ${texturaMapaDataUri ? `#secao-mapa-alocacao {
    background-image: linear-gradient(rgba(12,13,16,0.55), rgba(12,13,16,0.75)), var(--textura-mapa-alocacao);
    background-size: cover; background-position: center; background-repeat: no-repeat;
  }` : ''}
  #secao-mapa-alocacao .controles-alocacao,
  #secao-mapa-alocacao .faixa-alocacao,
  #secao-mapa-alocacao .mapa-alocacao-pool {
    position: relative; z-index: 1;
    background: var(--mapa-fundo-painel);
    border: 1px solid var(--mapa-borda-painel);
    border-radius: 12px;
    backdrop-filter: blur(10px);
    padding: 14px 18px;
    margin-bottom: 12px;
  }
  #secao-mapa-alocacao h1, #secao-mapa-alocacao h2, #secao-mapa-alocacao h3,
  #secao-mapa-alocacao .pool-grupo-titulo {
    font-family: "Nimbus Sans Extd", "Poppins", sans-serif;
    font-weight: 900;
    color: var(--mapa-acento);
  }
  #secao-mapa-alocacao .mapa-alocacao-corpo {
    display: flex; gap: 16px; align-items: flex-start;
    position: relative; z-index: 1;
  }
  #secao-mapa-alocacao .mapa-alocacao-pool {
    flex: 0 0 300px; max-height: 720px; overflow-y: auto;
  }
  #secao-mapa-alocacao .mapa-alocacao-mapa-wrap {
    flex: 1 1 auto; min-width: 0;
    position: relative;
    border-radius: 12px; overflow: hidden;
    border: 1px solid var(--mapa-borda-painel);
  }
  #mapa-alocacao-canvas { width: 100%; height: 720px; }
  #secao-mapa-alocacao .mapa-alocacao-sem-localizacao {
    position: absolute; top: 12px; right: 12px; z-index: 5;
    max-width: 280px; max-height: 220px; overflow-y: auto;
    background: var(--mapa-fundo-painel);
    border: 1px solid var(--mapa-borda-painel);
    border-radius: 8px; padding: 10px 12px;
    font-size: 12px; color: var(--mapa-texto-secundario);
    backdrop-filter: blur(10px);
  }
  #secao-mapa-alocacao .mapa-alocacao-sem-localizacao:empty { display: none; }
  #secao-mapa-alocacao .maplibregl-ctrl-attrib { background: rgba(0,0,0,0.5); color: var(--mapa-texto-secundario); }
  `;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>ALOCAÇÃO EQUIPES</title>
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css">
<style>
${cssBase()}
${CSS_SEMANAL}
${CSS_ABAS_SEMANAL}
${cssFontesMapa}
${CSS_DEMANDAS}
${cssMapaAlocacao}
</style>
</head>
<body>
  ${watermarkImg}
  <main>
${markupCabecalho({
    titulo: 'Alocação Equipes',
    subtitulo: escapeHtml(avisoAtualizacao ? `${formatarMesAno(geradoEm)} · ${avisoAtualizacao}` : formatarMesAno(geradoEm)),
    logo: logoImg,
    extra: '<a class="link-pagina-irma" href="planejamento-semanal.html">← Planejamento Semanal</a>',
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
${markupAbas([
    { id: 'aba-kanban-alocacao', rotulo: 'Kanban', svg: '', ativa: true },
    { id: 'aba-mapa-alocacao', rotulo: 'Mapa', svg: '' },
  ], '    ')}
    <div id="secao-kanban-alocacao"></div>
    <div id="secao-mapa-alocacao" style="display:none"></div>
  </div>
  </main>
  <script>window.__VIGENTE_IDX__ = ${vigenteIdx}; window.__ANO__ = ${periodos[0].getUTCFullYear()};</script>
  <script>window.__ULTIMA_ATUALIZACAO_OK__ = ${ultimaAtualizacaoOkIso ? JSON.stringify(ultimaAtualizacaoOkIso) : 'null'};</script>
  <script>${SCRIPT_AVISO_ATUALIZACAO_ATRASADA}</script>
  <script>window.__DADOS_CIFRADOS__ = ${dadosCifradosJson};</script>
  <script>${scriptDesbloqueio()}</script>
  <script>${fonteParaClienteEquipes()}${fonteParaClienteTipologiasAvancos()}${fonteParaClienteTipologiasLab()}${fonteParaClienteDatas()}${fonteParaClienteLinhaBase()}</script>
  <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
  <script>${bundle}</script>
  <script>${scriptFiltros()}${SCRIPT_CLIENTE_ALOCACAO}</script>
</body>
</html>`;
}

module.exports = { renderAlocacaoPagina };
