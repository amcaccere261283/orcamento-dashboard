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
  'grupos-veiculo.js', 'pessoas-ativas.js', 'equipes-alocaveis.js', 'coordenadas-sup.js',
  'vinculo-sup-concessionaria.js', 'compute-alocacao.js', 'alocacao-sheet.js',
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
// Setup MapLibre -- baseado no que está em produção no projeto Mapa
// Sondagens (http://192.168.1.53:8080/, js/app.js), com duas divergências
// deliberadas pedidas pelo dono do projeto em 2026-08-27:
// 1) A fonte Esri Reference/World_Transportation (rótulos de rodovia com
//    sombreado/relevo -- o efeito que lia como "3D") saiu de vez.
// 2) Reference/World_Boundaries_and_Places (limites administrativos +
//    nomes de lugar) NÃO saiu, mas teve o detalhe CONGELADO: a fonte tem
//    maxzoom: 7, então o MapLibre nunca busca um tile mais detalhado que
//    esse (nível que já mostra limite de estado + nome do estado +
//    principais municípios, sem descer pra limite/nome de município
//    pequeno -- testado ao vivo). Zoom além de 7 reusa (overzoom) o
//    mesmo tile z7, que ficaria borrado se mostrado sólido -- por isso
//    'raster-opacity' desvanece a camada até sumir em zoom 9: no
//    overview (zoom padrão 7) o contexto administrativo aparece nítido,
//    zoomado numa área específica ele já desapareceu antes de ficar feio.
// A atribuição e o zoom só com Ctrl pressionado (scroll normal continua
// rolando a PÁGINA, não o mapa) continuam iguais ao Mapa Sondagens.
//
// Inicializado LAZY (só no primeiro clique na aba Mapa, não no load da
// página): o MapLibre precisa que o container já tenha tamanho real
// (largura/altura != 0) pra calcular a projeção certo -- inicializar com
// #secao-mapa-alocacao ainda em display:none produziria um mapa quebrado
// (tiles no lugar errado até um resize forçar o recálculo).
var MAPA_ALOCACAO = { instancia: null };

var URL_ESRI_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
var URL_ESRI_LIMITES = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

function inicializarMapaAlocacao() {
  if (MAPA_ALOCACAO.instancia) {
    // Já existe -- só garante que o tamanho está certo (a aba pode ter sido
    // aberta a 1ª vez com uma largura, e a janela redimensionada depois
    // enquanto a aba Kanban estava ativa e o mapa invisível).
    MAPA_ALOCACAO.instancia.resize();
    return;
  }
  // FIX (revisão final, achado Important 3): quando semRoster é true,
  // montarMapaAlocacao (abaixo) desenha só renderControles + renderGuardaSemRoster
  // -- não existe #mapa-alocacao-canvas nenhum no DOM. Clicar na aba Mapa
  // ainda chama esta função (o handler de clique não sabe de semRoster), e
  // sem esta guarda new maplibregl.Map({container: 'mapa-alocacao-canvas'})
  // lançaria "Container 'mapa-alocacao-canvas' not found" -- uma exceção não
  // tratada saindo do handler de clique da aba. Sem container, não há o que
  // inicializar: sai cedo, silenciosamente, e o próximo clique tenta de novo
  // (MAPA_ALOCACAO.instancia continua null).
  if (!document.getElementById('mapa-alocacao-canvas')) return;
  var mapa = new maplibregl.Map({
    container: 'mapa-alocacao-canvas',
    style: {
      version: 8,
      sources: {
        'esri-imagery': { type: 'raster', tiles: [URL_ESRI_IMAGERY], tileSize: 256, maxzoom: 19, attribution: 'Tiles &copy; Esri' },
        // maxzoom: 7 -- ver o comentário grande no topo do arquivo (congela
        // o detalhe em estado+principais municípios, nunca desce a município
        // pequeno).
        'esri-limites': { type: 'raster', tiles: [URL_ESRI_LIMITES], tileSize: 256, maxzoom: 7 },
      },
      layers: [
        { id: 'esri-imagery', type: 'raster', source: 'esri-imagery' },
        {
          id: 'esri-limites', type: 'raster', source: 'esri-limites',
          // Desvanece entre zoom 7 (nítido) e 9 (some) -- evita o overzoom
          // borrado que o maxzoom: 7 da fonte produziria se ficasse sólido
          // além desse zoom.
          paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 7, 1, 9, 0] },
        },
      ],
    },
    // Centro/zoom iniciais: mesma região do Mapa Sondagens (Paraná) -- só o
    // ponto de partida antes do 1º desenho com rodovias reais.
    // desenharSupsComoRodovias (mais abaixo) chama mapa.fitBounds() na
    // primeira vez que existe pelo menos uma rodovia vinculada a algum SUP,
    // e não repete depois (guardado por MAPA_ALOCACAO.enquadrouUmaVez) -- pra
    // não puxar o mapa de volta toda vez que o usuário já tiver panado/dado
    // zoom por conta própria.
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
  // enquadrouUmaVez (fitBounds, ver desenharSupsComoRodovias): nasce false a
  // cada instância NOVA do mapa -- um mapa recriado do zero (semRoster ligou
  // e desligou de novo, ver o comentário em montarMapaAlocacao) merece um
  // novo auto-enquadramento, não herdar o "já enquadrei" de uma instância
  // anterior que nem existe mais.
  MAPA_ALOCACAO.enquadrouUmaVez = false;

  // Hover nas rodovias (2026-08-28): UM listener no nível do MAPA, ligado
  // uma vez só por instância -- nunca por camada, porque as camadas de
  // rodovia mudam a cada redesenho (desenharSupsComoRodovias) e uma camada
  // WebGL não tem elemento DOM por feature onde prender/soltar listeners.
  // queryRenderedFeatures([...], {layers}) lê MAPA_ALOCACAO.camadasSupRodovia
  // na hora, então funciona não importa quantas rodovias existam agora.
  mapa.on('mousemove', function (e) {
    var camadas = MAPA_ALOCACAO.camadasSupRodovia || [];
    if (!camadas.length) { esconderPopupHoverRodovia(); return; }
    var features = mapa.queryRenderedFeatures(e.point, { layers: camadas });
    if (!features.length) { esconderPopupHoverRodovia(); return; }
    mostrarPopupHoverRodovia(features[0].layer.id, e.lngLat);
  });
  mapa.getContainer().addEventListener('mouseleave', esconderPopupHoverRodovia);

  // Assim que o estilo carrega, desenha as rodovias com o dado que JÁ existe
  // em ESTADO_ALOCACAO (o mapa pode ter sido aberto bem depois do 1º
  // montarAbaAlocacao).
  mapa.on('load', function () {
    montarAbaAlocacao();
  });
}

var ComputeSemanal = MODULOS['compute-semanal.js'];
var RenderAbaAlocacao = MODULOS['render-aba-alocacao.js'];
var RenderAbaAlocacaoMapa = MODULOS['render-aba-alocacao-mapa.js'];
var CoordenadasSup = MODULOS['coordenadas-sup.js'];
var VinculoSupConcessionaria = MODULOS['vinculo-sup-concessionaria.js'];
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
// ultimaGrade (Task 13): a última grade calculada por montarMapaAlocacao
// (RenderAbaAlocacao.prepararDadosAlocacao(...).grade), guardada aqui para
// aplicarMovimentoNoPino achar a linha do SUP onde a equipe foi solta sem
// recalcular a grade de novo. Nasce vazia -- soltar antes do primeiro
// desenho não deveria acontecer (a rodovia só nasce depois de
// desenharSupsComoRodovias rodar, que só roda depois de montarMapaAlocacao
// popular isto), mas o default garante que .linhas.length não estoura mesmo
// assim.
var ESTADO_ALOCACAO = {
  semanaIdx: -1, alocacao: {}, equipes: [], foraDoQuadro: [], cliente: null,
  semanaCarregada: null, geracaoAlocacao: 0, busca: '', tipologia: '',
  ultimaGrade: { linhas: [], colunas: [] }, filaSalvar: {},
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

// Aplica LOCAL na hora (tela + localStorage, síncrono -- clienteAlocacao().
// gravarLocal) e representa o envio ao Sheet para o clique de "Salvar
// alocação". Ver o comentário grande em ESTADO_ALOCACAO.filaSalvar.
function registrarParaSalvar(chave, equipeId, sup, coluna) {
  if (!chave) return;
  clienteAlocacao().gravarLocal({ chaveSemana: chave, equipeId: equipeId, sup: sup || null, coluna: coluna || null });
  ESTADO_ALOCACAO.filaSalvar[chave + '|' + equipeId] = {
    chaveSemana: chave, equipeId: equipeId, sup: sup || null, coluna: coluna || null,
  };
}

function contarNaoSalvos() {
  return Object.keys(ESTADO_ALOCACAO.filaSalvar).length;
}

// "Salvar alocação": envia ao Sheet TUDO que está represado, de qualquer
// semana (cada item já carrega sua própria chaveSemana). Limpa a fila ANTES
// do envio -- o mesmo raciocínio de "a tela nunca espera a rede" que
// aplicarMovimento já seguia: se o envio falhar, o item cai na fila de
// RETRANSMISSÃO de clienteAlocacao (a mesma que "Tentar de novo" já usava),
// não de volta em filaSalvar -- reabrir filaSalvar reativaria o botão como se
// nada tivesse sido tentado, escondendo a falha atrás de um botão que parece
// não ter feito nada.
function salvarAlocacao() {
  var movimentos = Object.keys(ESTADO_ALOCACAO.filaSalvar).map(function (k) { return ESTADO_ALOCACAO.filaSalvar[k]; });
  if (!movimentos.length) return;
  ESTADO_ALOCACAO.filaSalvar = {};
  montarAbaAlocacao();
  clienteAlocacao().enviarLote(movimentos).then(function () { montarAbaAlocacao(); });
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

  // Aplica local na hora (síncrono) e represa o envio ao Sheet para o clique
  // de "Salvar alocação" -- ver o comentário grande em
  // ESTADO_ALOCACAO.filaSalvar. Uma entrada por equipe movida, mesmo laço de
  // semearDoRealizado.
  var chave = chaveSemanaAtual();
  movimentos.forEach(function (m) {
    registrarParaSalvar(chave, m.id, m.sup, m.coluna);
  });
  montarAbaAlocacao();
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
  var chave = chaveSemanaAtual();
  Object.keys(nova).forEach(function (id) {
    registrarParaSalvar(chave, id, nova[id].sup, nova[id].coluna);
  });
  montarAbaAlocacao();
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
  var chave = chaveSemanaAtual();
  marcarSemanaVista(chave);
  idsAlocados.forEach(function (id) {
    registrarParaSalvar(chave, id, null, null);
  });
  montarAbaAlocacao();
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
  // supsConhecidos (2026-08-28): os SUPs que existem na Matriz (TODOS os
  // registros do ano carregado, não só os filtrados -- mesma base que
  // compute-alocacao.js usa pra supsConhecidos, ver o comentário lá). Quando
  // o SUP resolvido pela produção online (Última Foto) não bate com nenhum
  // deles, equipesDoQuadro redireciona a equipe pra 'Diversos' em vez de
  // criar uma linha avulsa na grade -- ver o design de 2026-08-28.
  var supsConhecidos = {};
  (window.__REGISTROS__ || []).forEach(function (r) { if (r) supsConhecidos[r.sup] = true; });
  var roster = EquipesAlocaveis.equipesDoQuadro(demandas.equipesCsv || '', {
    ano: window.__ANO__,
    mes: periodo ? periodo.mes : (mesSelecionadoIdx + 1),
    semana: semana,
    producaoOnline: demandas.producaoOnline || [],
    pessoasCsv: demandas.pessoasCsv,
    supsConhecidos: supsConhecidos,
    hoje: hojeEpochDoNavegador(),
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
    // Movimentos já aplicados na tela/localStorage mas ainda represados,
    // aguardando o clique em "Salvar alocação" -- ver ESTADO_ALOCACAO.filaSalvar.
    naoSalvos: contarNaoSalvos(),
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

  // dados (achado Important 2 da revisão final): computado UMA vez aqui e
  // repassado tanto para renderAbaAlocacao (Kanban) quanto para
  // montarMapaAlocacao (Mapa) -- as duas chamavam prepararDadosAlocacao
  // separadamente com os MESMOS argumentos (registros/prep.indices/prep.o),
  // recalculando a grade inteira duas vezes a cada redesenho (o próprio
  // motivo de prepararDadosAlocacao ter sido extraída, Task 1, era
  // compartilhar este cálculo -- a composição das duas chamadas tinha
  // deixado de fazer isso). null quando semRoster: prepararDadosAlocacao
  // também devolve null nesse caso (mesma guarda), e renderAbaAlocacao já
  // sabe desenhar a guarda-sem-roster sem precisar de dados nenhum.
  var dados = prep.semRoster ? null : RenderAbaAlocacao.prepararDadosAlocacao(window.__REGISTROS__, prep.indices, prep.o);

  document.getElementById('secao-kanban-alocacao').innerHTML = RenderAbaAlocacao.renderAbaAlocacao(
    window.__REGISTROS__, prep.indices, prep.o, dados
  );
  montarMapaAlocacao(prep, dados);

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
//
// CRITICAL corrigido pós-revisão da Task 11: antes desta correção, esta
// função fazia sempre secao.innerHTML = renderAbaAlocacaoMapa(...) inteiro,
// mesmo com o mapa JÁ inicializado. Isso troca #mapa-alocacao-canvas por um
// container NOVO e vazio a cada chamada -- e mapa.on('load', function () {
// montarAbaAlocacao(); }) (inicializarMapaAlocacao, perto do topo deste
// arquivo) dispara essa MESMA cadeia poucos instantes depois do clique na
// aba, destruindo o container ao qual o MapLibre acabou de se ligar. O mapa
// continua "existindo" (segura um contexto WebGL) mas nada dele aparece na
// tela, e a checagem de idempotência de inicializarMapaAlocacao (que só olha
// MAPA_ALOCACAO.instancia, ainda um objeto válido) nunca detecta o container
// órfão -- só um F5 resolve. E não é só o handler de 'load': QUALQUER
// redesenho normal (troca de filtro/semana/mês, arrasto aplicado, "Atualizar
// dados") passa por montarAbaAlocacao -> montarMapaAlocacao e destruiria o
// canvas do mesmo jeito, então a correção tem que estar aqui, não só no
// handler de 'load'.
//
// Fix: com o mapa já inicializado, secao.innerHTML NUNCA mais é reatribuído
// -- só os dois pedaços que de fato mudam a cada redesenho
// (#mapa-alocacao-topo: controles/faixa/aviso; #mapa-alocacao-pool: o pool
// de equipes) são reescritos, cada um por dentro do PRÓPRIO innerHTML. O
// wrap do mapa (.mapa-alocacao-mapa-wrap, com #mapa-alocacao-canvas e
// #mapa-alocacao-sem-localizacao dentro) nunca é tocado depois do primeiro
// desenho -- é ele que carrega o container real que o MapLibre se ligou.
// Ver os dois testes 'CRITICAL: com o mapa já inicializado...' e 'com o mapa
// já inicializado, o pool e os controles...' em
// test/semanal-alocacao-interacao.test.js para a prova (RED antes desta
// correção, GREEN depois).
function montarMapaAlocacao(prep, dadosPrecomputados) {
  var secao = document.getElementById('secao-mapa-alocacao');
  if (prep.semRoster) {
    // FIX (revisão final, achado Important 3): este ramo reescreve
    // secao.innerHTML inteiro, sem o #mapa-alocacao-canvas que
    // MAPA_ALOCACAO.instancia estaria ligada a ele -- se semRoster ligar
    // DEPOIS de o mapa já ter sido inicializado numa sessão (a Sheet espelho
    // da EQ parou de responder no meio da sessão), o próximo redesenho SEM
    // semRoster (o ramo 'else' logo abaixo, quando o mapa já existe) faria
    // document.getElementById('mapa-alocacao-topo').innerHTML sobre um
    // elemento que não existe mais (null), lançando pra fora de
    // aplicarMovimento antes da gravação na Sheet. Descartar a instância
    // aqui -- no MESMO instante em que o container que ela dependia deixa de
    // existir -- garante que o próximo desenho (com ou sem roster) sempre
    // encontra MAPA_ALOCACAO num estado consistente com o que está no DOM:
    // sem instância, o próximo clique na aba Mapa reinicializa do zero.
    if (MAPA_ALOCACAO.instancia) {
      MAPA_ALOCACAO.instancia.remove();
      MAPA_ALOCACAO.instancia = null;
      // FIX (achado Minor 5 da revisão final): sem isto, ESTADO_RODOVIAS.ordem
      // sobrevive à destruição da instância (é estado do SELETOR, não do
      // mapa), mas MAPA_ALOCACAO.camadasRodovia continuava com os ids de
      // camadas que não existem mais -- quando o roster volta e o mapa é
      // recriado do zero, sincronizarCamadasRodovias() tentaria remover
      // camadas de uma instância NOVA que nunca as teve. Zerar aqui, no MESMO
      // instante em que a instância morre, deixa o próximo desenho recriar as
      // camadas do zero a partir de ESTADO_RODOVIAS.ordem, em vez de deixar o
      // painel com caixas marcadas sobre um mapa sem nenhuma linha. Mesma
      // razão pra camadasSupRodovia (2026-08-28).
      MAPA_ALOCACAO.camadasRodovia = [];
      MAPA_ALOCACAO.camadasSupRodovia = [];
    }
    secao.innerHTML = RenderAbaAlocacaoMapa.renderAbaAlocacaoMapa(null, { semRoster: true });
    return;
  }
  // dadosPrecomputados (achado Important 2 da revisão final): montarAbaAlocacao
  // já calculou a MESMA grade/resumo (registros/indices/prep.o idênticos, ver
  // o comentário lá) para desenhar o Kanban -- recalcular aqui de novo era
  // trabalho em dobro a cada tecla da busca, cada troca de filtro/semana/mês,
  // cada solta e cada "Atualizar dados" (montarGradeAlocacao roda
  // calcularSeriesSemanaisDimensao uma vez por CÉLULA e uma vez por LINHA de
  // SUP -- ordem de 150 chamadas em produção), mesmo quando a aba Mapa nunca
  // chegou a ser aberta (montarMapaAlocacao é incondicional). O parâmetro é
  // OPCIONAL -- se faltar, cai no cálculo direto, mesmo comportamento de
  // antes -- então snapshot-alocacao.js e qualquer chamador futuro que não
  // tenha um 'dados' pronto continuam funcionando sem mudar nada.
  var dados = dadosPrecomputados || RenderAbaAlocacao.prepararDadosAlocacao(window.__REGISTROS__, prep.indices, prep.o);
  // ultimaGrade (Task 13): guardada aqui, no MESMO redesenho que
  // desenharSupsComoRodovias (abaixo) usa pra desenhar as rodovias -- é o
  // que garante que aplicarMovimentoNoPino sempre acha a linha certa para o
  // SUP de uma rodovia que está de fato na tela agora.
  ESTADO_ALOCACAO.ultimaGrade = dados.grade;
  if (!MAPA_ALOCACAO.instancia) {
    // Primeiro desenho (ou qualquer desenho ANTES do mapa existir): markup
    // completo, incluindo um #mapa-alocacao-canvas novo -- é nele que
    // inicializarMapaAlocacao() vai se ligar no primeiro clique da aba Mapa.
    secao.innerHTML = RenderAbaAlocacaoMapa.renderAbaAlocacaoMapa(dados, prep.o);
  } else {
    document.getElementById('mapa-alocacao-topo').innerHTML =
      RenderAbaAlocacaoMapa.renderAbaAlocacaoMapaTopo(dados, prep.o);
    document.getElementById('mapa-alocacao-pool').innerHTML =
      RenderAbaAlocacaoMapa.renderAbaAlocacaoMapaPool(dados, prep.o);
  }
  // desenharSupsComoRodovias desenha a linha da rodovia de cada SUP quando o
  // mapa já existe -- a guarda 'typeof' é defensiva (nunca deveria disparar
  // hoje que a função está sempre definida abaixo), mas fica porque
  // montarMapaAlocacao é chamada de muitos gatilhos (arrasto, troca de
  // filtro/semana/mês, "Atualizar dados", o handler de 'load' do mapa) e não
  // vale o risco de um ReferenceError silencioso quebrar o redesenho inteiro
  // do Kanban/Mapa.
  if (typeof desenharSupsComoRodovias === 'function' && MAPA_ALOCACAO.instancia) {
    desenharSupsComoRodovias(dados);
  }
  // FIX (achado Minor 5 da revisão final): redesenha as camadas de rodovia
  // selecionadas sempre que o mapa é redesenhado -- sem isto, um mapa
  // recriado do zero (depois de um ciclo semRoster, ver o FIX acima) nunca
  // recuperava as camadas de ESTADO_RODOVIAS.ordem, e o painel ficava com
  // caixas marcadas sobre um mapa vazio. Guardado por instancia (não por
  // typeof, como desenharSupsComoRodovias acima) porque sincronizarCamadasRodovias
  // é declarada ANTES desta função no mesmo arquivo, sempre definida.
  if (MAPA_ALOCACAO.instancia) sincronizarCamadasRodovias();
}

// Mesmas 5 cores de .leitura-* (CSS_SEMANAL, render-semanal.js) --
// REPETIDAS aqui de propósito, porque o marcador do MapLibre precisa da cor
// SÓLIDA (background do pino), enquanto a classe original é um CHIP
// translúcido (fundo claro + texto colorido, pensado pra um <span> de
// rótulo, não pra um ponto no mapa). Mudar uma sem a outra é a próxima
// divergência esperando acontecer -- ver o comentário sobre TIPOLOGIA_COLOR
// em render-aba-consolidado.js pro mesmo raciocínio aplicado a outra paleta
// deste projeto.
var CORES_LEITURA_PINO = {
  'parado-com-carteira': '#f6b53f',
  'sem-equipe': '#e0684f',
  'falta-equipe': '#e0684f',
  antecipar: '#4f8ff0',
  absorvido: '#7fd858',
  'sem-demanda': '#898781',
};

// Paleta pra camada de referência das rodovias das concessionárias (Task 6) --
// SEIS cores, escolhidas pra não colidir de hue com CORES_LEITURA_PINO (acima)
// nem com TIPOLOGIA_COLOR (render-aba-consolidado.js): aquelas já cobrem
// vermelho/coral, laranja-amarelo, azul, verde, roxo e cinza -- daqui saem
// ciano, magenta, marrom, indigo-azulado, dourado-mostarda e verde-água.
// Saturação/brilho aumentados em 2026-08-27 (pedido do dono do projeto,
// "cores mais vivas") em cima dos mesmos seis matizes já testados contra
// colisão -- MESMA família de cor de antes, só mais intensa, então a
// distinção de matiz já verificada continua valendo. Tom exato calibrado na
// revisão do Open Design (mesma ressalva já feita pra outras cores novas
// deste projeto); a MECÂNICA de atribuição é o que este teste trava.
// Ver docs/superpowers/specs/2026-08-27-alocacao-mapa-camada-rodovias-design.md,
// Decisão 8.
var CORES_RODOVIA = ['#00d4e6', '#f02ef0', '#b8611a', '#6a4dff', '#e8b400', '#00c9a3'];

// idsEmOrdem: ids de concessionária na ordem em que foram MARCADAS no seletor
// (não a ordem alfabética da lista) -- é essa ordem que decide qual cor cada
// uma pega. Cor é um DIFERENCIADOR da seleção atual, não uma identidade fixa da
// concessionária: desmarcar e marcar de novo pode pegar outra posição.
function atribuirCorRodovia(idsEmOrdem) {
  var resultado = {};
  (idsEmOrdem || []).forEach(function (id, indice) {
    resultado[id] = CORES_RODOVIA[indice % CORES_RODOVIA.length];
  });
  return resultado;
}

// idsSelecionadosEmOrdem: ESTADO_RODOVIAS.ordem (abaixo). concessoesPorId: mapa
// id -> entrada de concessoes-rodovias.json (Task 2/3), já carregado. Função
// PURA -- decide o QUE desenhar, nunca toca map/DOM (isso é
// sincronizarCamadasRodovias, Step 5). Concessionária sem geojson (poucas,
// hoje -- 59 das 60 têm trecho em ROADS) simplesmente não vira camada; ela
// continua "selecionada" (ESTADO_RODOVIAS.ordem não muda), só não desenha nada.
function camadasRodoviasDesejadas(idsSelecionadosEmOrdem, concessoesPorId) {
  var cores = atribuirCorRodovia(idsSelecionadosEmOrdem || []);
  var resultado = [];
  (idsSelecionadosEmOrdem || []).forEach(function (id) {
    var c = (concessoesPorId || {})[id];
    if (!c || !c.geojson) return;
    resultado.push({ id: c.id, nome: c.nome, cor: cores[id], geojson: c.geojson });
  });
  return resultado;
}

// Estado de módulo pro seletor de rodovias -- 'ordem' é a lista de ids na ORDEM
// em que foram marcados (não a ordem alfabética da lista), porque é essa ordem
// que decide a cor de cada um (atribuirCorRodovia). 'concessoesPorId' nasce null
// e só é populado no 1º fetch bem-sucedido de concessoes-rodovias.json (lazy --
// nunca busca antes de o usuário abrir o seletor pela 1ª vez).
var ESTADO_RODOVIAS = { ordem: [], concessoesPorId: null, carregando: null };

// Busca concessoes-rodovias.json (mesma origem do Pages, sem CORS) só na
// PRIMEIRA vez que é preciso -- nunca no load da página. Idempotente: chamadas
// concorrentes (ex. dois cliques rápidos no seletor antes do 1º fetch responder)
// compartilham a MESMA promise via ESTADO_RODOVIAS.carregando, em vez de disparar
// requisições duplicadas.
function garantirConcessoesCarregadas() {
  if (ESTADO_RODOVIAS.concessoesPorId) return Promise.resolve(ESTADO_RODOVIAS.concessoesPorId);
  if (ESTADO_RODOVIAS.carregando) return ESTADO_RODOVIAS.carregando;
  // Sem fetch global (ambiente de teste -- o DOM falso deste projeto nunca
  // simula rede; ou um navegador muito antigo) -- mesma filosofia "nunca
  // lança" do catch logo abaixo, só que ANTES de tentar chamar algo que nem
  // existe (chamar fetch(...) sem fetch definido lançaria síncrono, fora
  // do alcance do .catch da promise). Achado em 2026-08-28 quando
  // desenharSupsComoRodovias passou a chamar esta função em TODO redesenho
  // do mapa, não só quando o usuário abre o seletor manual.
  if (typeof fetch !== 'function') return Promise.resolve(ESTADO_RODOVIAS.concessoesPorId || {});
  ESTADO_RODOVIAS.carregando = fetch('concessoes-rodovias.json')
    .then(function (resposta) { return resposta.json(); })
    .then(function (lista) {
      var porId = {};
      lista.forEach(function (c) { porId[c.id] = c; });
      ESTADO_RODOVIAS.concessoesPorId = porId;
      ESTADO_RODOVIAS.carregando = null;
      return porId;
    })
    .catch(function (erro) {
      // Nunca lança pra fora -- sem o JSON, o seletor simplesmente não tem
      // opções (mesma filosofia de "sem dado, nunca erro" de coordenadas-sup.js).
      console.error('concessoes-rodovias.json não pôde ser carregado:', erro);
      ESTADO_RODOVIAS.carregando = null;
      return {};
    });
  return ESTADO_RODOVIAS.carregando;
}

// Redesenha TODAS as camadas de rodovia a partir do zero -- mesma filosofia de
// desenharSupsComoRodovias (redesenhar inteiro é simples e barato o bastante
// pra no máximo algumas linhas por vez). Só roda se o mapa já existe; se o seletor for
// mexido antes de a aba Mapa ter sido aberta (não deveria ser possível, o bloco
// só existe dentro de #secao-mapa-alocacao, mas é uma guarda barata), sai sem
// fazer nada.
function sincronizarCamadasRodovias() {
  var mapa = MAPA_ALOCACAO.instancia;
  if (!mapa) return;

  (MAPA_ALOCACAO.camadasRodovia || []).forEach(function (id) {
    if (mapa.getLayer('rodovia-' + id)) mapa.removeLayer('rodovia-' + id);
    if (mapa.getSource('rodovia-' + id)) mapa.removeSource('rodovia-' + id);
  });
  MAPA_ALOCACAO.camadasRodovia = [];

  var camadas = camadasRodoviasDesejadas(ESTADO_RODOVIAS.ordem, ESTADO_RODOVIAS.concessoesPorId || {});
  camadas.forEach(function (camada) {
    mapa.addSource('rodovia-' + camada.id, { type: 'geojson', data: camada.geojson });
    mapa.addLayer({
      id: 'rodovia-' + camada.id,
      type: 'line',
      source: 'rodovia-' + camada.id,
      // line-width/opacity aumentados em 2026-08-27 (pedido do dono do
      // projeto, "um pouco mais espessa") -- era 3/0.85.
      paint: { 'line-color': camada.cor, 'line-width': 5, 'line-opacity': 0.95 },
    });
    MAPA_ALOCACAO.camadasRodovia.push(camada.id);
  });

  var legenda = document.getElementById('mapa-alocacao-rodovias-legenda');
  if (legenda) {
    legenda.innerHTML = camadas.map(function (c) {
      return '<span class="legenda-rodovia-item"><span class="legenda-rodovia-cor" style="background:' + c.cor + '"></span>' + RenderAbaAlocacao.escapeHtml(c.nome) + '</span>';
    }).join('');
  }
}

// Ligação do checkbox: marcar adiciona ao FIM de ESTADO_RODOVIAS.ordem (fica com
// a próxima cor da paleta); desmarcar remove -- as que continuam marcadas NÃO
// mudam de posição relativa entre si (Array.prototype.filter preserva ordem),
// então suas cores continuam estáveis.
function aoMudarSeletorRodovias(idConcessionaria, marcado) {
  var indiceAtual = ESTADO_RODOVIAS.ordem.indexOf(idConcessionaria);
  if (marcado && indiceAtual === -1) ESTADO_RODOVIAS.ordem.push(idConcessionaria);
  else if (!marcado && indiceAtual !== -1) ESTADO_RODOVIAS.ordem.splice(indiceAtual, 1);
  sincronizarCamadasRodovias();
}

// Abre/fecha o painel e, na 1ª abertura, busca concessoes-rodovias.json e
// popula as opções.
function abrirOuFecharSeletorRodovias() {
  var container = document.getElementById('filtro-rodovias');
  var painel = container ? container.querySelector('.filtro-multi-painel') : null;
  if (!container || !painel) return;
  var jaAberto = container.classList.contains('aberto');
  document.querySelectorAll('.filtro-multi.aberto').forEach(function (el) {
    el.classList.remove('aberto');
    el.querySelector('.filtro-multi-painel').hidden = true;
  });
  if (jaAberto) return;
  container.classList.add('aberto');
  painel.hidden = false;
  garantirConcessoesCarregadas().then(function (porId) {
    var opcoes = Object.keys(porId).map(function (id) { return porId[id]; })
      .sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
    // Achado ao vivo (2026-08-27, "Via Araucária não plota"): 22 das 81
    // concessionárias não têm geojson (21 da lista manual ANTT, que nunca
    // teve traçado, + 1 da própria ABCR sem trecho em ROADS) -- marcar e
    // não acontecer nada era silencioso demais. Sem geojson, o checkbox
    // fica desabilitado e o rótulo ganha "(sem traçado)", pra não parecer
    // que o clique não funcionou.
    var listaHtml = opcoes.length
      ? opcoes.map(function (c) {
          var marcado = ESTADO_RODOVIAS.ordem.indexOf(c.id) !== -1 ? ' checked' : '';
          var semTracado = !c.geojson;
          var disabled = semTracado ? ' disabled' : '';
          var classe = semTracado ? ' filtro-multi-item-sem-tracado' : '';
          var sufixo = semTracado ? ' <span class="filtro-multi-item-nota">(sem traçado)</span>' : '';
          return '<label class="filtro-multi-item' + classe + '"><input type="checkbox" value="' + RenderAbaAlocacao.escapeHtml(c.id) + '"' + marcado + disabled + '>' + RenderAbaAlocacao.escapeHtml(c.nome) + sufixo + '</label>';
        }).join('')
      : '<div class="filtro-multi-vazio">Nenhuma rodovia encontrada</div>';
    // Caixa de busca (achado Important 2 da revisão final): mesma marcação e
    // handler que montarFiltroMulti (tools/comum/render-shell.js) já usa nos
    // outros filtro-multi da página -- 60 concessionárias num painel de
    // max-height:320px deixavam ~50 escondidas atrás de scroll, sem jeito de
    // digitar o nome. normalizarBusca vem de SCRIPT_CLIENTE_FILTROS
    // (scriptFiltros(), concatenado ANTES deste script na mesma <script> tag
    // -- ver o comentário de scriptFiltros logo abaixo de SCRIPT_CLIENTE_ALOCACAO),
    // não precisa ser duplicada aqui.
    painel.innerHTML = (opcoes.length ? '<input type="text" class="filtro-multi-busca" placeholder="Buscar..." autocomplete="off">' : '')
      + listaHtml
      + '<div class="filtro-multi-vazio filtro-multi-vazio-busca" hidden>Nenhum resultado</div>';
    // Os checkboxes NÃO recebem listener próprio aqui -- o 'change' delegado
    // em inicializarSeletorRodovias (abaixo) cobre qualquer checkbox dentro de
    // #filtro-rodovias, mesmo estes recém-inseridos por innerHTML.
    var busca = painel.querySelector('.filtro-multi-busca');
    if (busca) {
      busca.addEventListener('input', function () {
        var termo = normalizarBusca(busca.value);
        var algumVisivel = false;
        painel.querySelectorAll('.filtro-multi-item').forEach(function (item) {
          var combina = normalizarBusca(item.textContent).indexOf(termo) !== -1;
          item.style.display = combina ? '' : 'none';
          if (combina) algumVisivel = true;
        });
        painel.querySelector('.filtro-multi-vazio-busca').hidden = algumVisivel || termo === '';
      });
    }
  });
}

// FIX (achado ao planejar): #filtro-rodovias só passa a existir no DOM depois
// do 1º montarMapaAlocacao() -- o script de cliente roda este wireup no load
// da página, ANTES de qualquer roster/senha ter chegado, então um
// addEventListener ligado DIRETO no trigger (document.querySelector(...)
// naquele instante) nunca acharia o elemento e o botão 'Rodovias' ficaria
// morto pra sempre. Por isso, igual a inicializarInteracaoAlocacao (que tem o
// MESMO problema com as células/pinos, que também só existem depois do 1º
// desenho), a ligação é por DELEGAÇÃO no container ESTÁVEL #secao-mapa-alocacao
// (existe desde o load, mesmo vazio) -- funciona não importa quando
// #filtro-rodovias for inserido dentro dele.
function inicializarSeletorRodovias() {
  var secaoMapa = document.getElementById('secao-mapa-alocacao');
  if (!secaoMapa) return;

  secaoMapa.addEventListener('click', function (evento) {
    var alvo = evento.target;
    var trigger = alvo.closest ? alvo.closest('#filtro-rodovias .filtro-multi-trigger') : null;
    if (trigger) {
      evento.stopPropagation();
      abrirOuFecharSeletorRodovias();
      return;
    }
    var painel = alvo.closest ? alvo.closest('#filtro-rodovias .filtro-multi-painel') : null;
    if (painel) evento.stopPropagation();
  });

  secaoMapa.addEventListener('change', function (evento) {
    var checkbox = evento.target.closest ? evento.target.closest('#filtro-rodovias input[type="checkbox"]') : null;
    if (!checkbox) return;
    aoMudarSeletorRodovias(checkbox.value, checkbox.checked);
  });
}

// Redesenho de 2026-08-28 (pedido do usuário: "a visualização não ficou
// boa"): a aba Mapa deixa de usar pino + cartão flutuante por SUP
// (coordenadasPorSup/desenharPinosMapa/desenharEquipesNoMapa, removidos) e
// passa a desenhar a PRÓPRIA linha da rodovia da concessionária do SUP,
// vinculada via VinculoSupConcessionaria (tomador × nome da concessão).
// Nenhum pino sobrevive -- a linha é a única representação visual do SUP no
// mapa, colorida pela leitura mais crítica entre os SUPs daquela rodovia
// (uma rodovia pode servir mais de um SUP, ex. "Pantanal").

// Ordem de severidade pra decidir a cor de uma rodovia com 2+ SUPs -- número
// MENOR vence (mais urgente). 'falta-equipe'/'sem-equipe' empatados no topo
// porque os dois já são a mesma cor vermelha em CORES_LEITURA_PINO; as
// demais seguem a leitura natural do semáforo (âmbar > azul > verde >
// cinza). Decisão do usuário (2026-08-28): nunca esconder um SUP com
// problema atrás de outro tranquilo na mesma rodovia.
var SEVERIDADE_LEITURA = {
  'falta-equipe': 0, 'sem-equipe': 0,
  'parado-com-carteira': 1,
  antecipar: 2,
  absorvido: 3,
  'sem-demanda': 4,
};

// Função PURA -- decide só a leitura vencedora, nunca mexe em cor/DOM (isso
// é desenharSupsComoRodovias). leituras: array de strings de leitura (uma
// por SUP da mesma rodovia). Leitura desconhecida cai no mesmo nível de
// 'sem-demanda' (a mais neutra), nunca trava.
function leituraMaisCriticaEntre(leituras) {
  var melhor = null;
  var melhorSeveridade = Infinity;
  (leituras || []).forEach(function (l) {
    var severidade = SEVERIDADE_LEITURA[l];
    if (severidade === undefined) severidade = SEVERIDADE_LEITURA['sem-demanda'];
    if (severidade < melhorSeveridade) { melhorSeveridade = severidade; melhor = l; }
  });
  return melhor || 'sem-demanda';
}

// Separa resumo.porSup em quem tem rodovia vinculada (agrupado por
// concessaoId -- uma rodovia pode ter 2+ SUPs) e quem não tem (painel "sem
// rodovia vinculada"). Função PURA -- não mexe no mapa nem no DOM, só
// decide. vinculo: o retorno de VinculoSupConcessionaria.vincularSupsAConcessoes.
function prepararRodoviasDoMapa(porSup, vinculo) {
  var concessaoIdPorSup = (vinculo && vinculo.concessaoIdPorSup) || {};
  var porConcessao = {};
  var semRodovia = [];
  (porSup || []).forEach(function (s) {
    var concessaoId = concessaoIdPorSup[s.sup];
    if (!concessaoId) { semRodovia.push(s); return; }
    if (!porConcessao[concessaoId]) porConcessao[concessaoId] = [];
    porConcessao[concessaoId].push(s);
  });
  return { porConcessao: porConcessao, semRodovia: semRodovia };
}

// Conteúdo do popup ao passar o mouse na rodovia -- por SUP daquela rodovia
// (tendência/capacidade/saldo/carteira, o mesmo resumo agregado que o antigo
// popup do pino já mostrava) mais uma lista de equipes alocadas AGRUPADA
// POR TIPOLOGIA (coluna), combinando todos os SUPs daquela rodovia -- pedido
// explícito do usuário em 2026-08-28. supsResumo: entradas de
// dados.resumo.porSup só dos SUPs desta rodovia. porEquipe/equipesPorId: os
// mesmos de dados.resumo.porEquipe/dados.equipesPorId, sem filtrar -- a
// filtragem por SUP acontece aqui dentro.
function popupHtmlDaRodovia(nomeRodovia, supsResumo, porEquipe, equipesPorId) {
  var supsDaRodovia = {};
  var blocosSup = (supsResumo || []).map(function (s) {
    supsDaRodovia[s.sup] = true;
    return '<div class="popup-rodovia-sup">'
      + '<p class="popup-subtitulo">' + RenderAbaAlocacao.escapeHtml(s.sup)
      + (s.tomador ? ' — ' + RenderAbaAlocacao.escapeHtml(s.tomador) : '') + '</p>'
      + '<p>Tendência: ' + s.tendencia.toFixed(1) + ' · Capacidade alocada: ' + s.capacidadeAlocada.toFixed(1) + '</p>'
      + '<p>Saldo: ' + s.saldo.toFixed(1) + ' · Carteira: ' + s.carteira.toFixed(0) + '</p>'
      + '</div>';
  }).join('');

  var porTipologia = {};
  (porEquipe || []).forEach(function (re) {
    if (!re.sup || !supsDaRodovia[re.sup]) return;
    var coluna = re.coluna || '—';
    if (!porTipologia[coluna]) porTipologia[coluna] = [];
    var equipe = (equipesPorId || {})[re.id];
    porTipologia[coluna].push((equipe ? equipe.lider : re.id) + ' (' + re.id + ' · ' + re.sup + ')');
  });
  var colunas = Object.keys(porTipologia).sort();
  var blocosEquipe = colunas.length
    ? colunas.map(function (coluna) {
      return '<p><strong>' + RenderAbaAlocacao.escapeHtml(coluna) + ':</strong> '
        + porTipologia[coluna].map(RenderAbaAlocacao.escapeHtml).join(', ') + '</p>';
    }).join('')
    : '<p>Sem equipe alocada</p>';

  return '<div class="popup-rodovia-alocacao">'
    + '<p class="popup-titulo">' + RenderAbaAlocacao.escapeHtml(nomeRodovia) + '</p>'
    + blocosSup
    + '<p class="popup-equipes-titulo">Equipes por tipologia</p>'
    + blocosEquipe
    + '</div>';
}

// Estende bounds com toda coordenada de um FeatureCollection LineString/
// MultiLineString -- mesma necessidade que o antigo fitBounds por pino
// tinha, só que agora a geometria vem do TRAÇADO da rodovia, não de um
// ponto só.
function estenderBoundsPorGeojson(bounds, geojson) {
  ((geojson && geojson.features) || []).forEach(function (f) {
    var geom = f.geometry;
    if (!geom) return;
    if (geom.type === 'LineString') {
      geom.coordinates.forEach(function (c) { bounds.extend(c); });
    } else if (geom.type === 'MultiLineString') {
      geom.coordinates.forEach(function (linha) { linha.forEach(function (c) { bounds.extend(c); }); });
    }
  });
}

// Prefixo das camadas desenhadas por SUP -- namespace PRÓPRIO, distinto de
// 'rodovia-' (o seletor manual "Rodovias" de referência, decisão 2026-08-27,
// que continua existindo e independente disto: um é dado da alocação, o
// outro é a lista das 81 concessionárias pra consulta livre). Nunca
// colidem, então as duas camadas de uma mesma concessionária (se o usuário
// também a marcar no seletor manual) convivem sem conflito de id.
var PREFIXO_CAMADA_SUP_RODOVIA = 'sup-rodovia-';

function limparCamadasSupRodoviaDoMapa(mapa) {
  (MAPA_ALOCACAO.camadasSupRodovia || []).forEach(function (id) {
    if (mapa.getLayer(id)) mapa.removeLayer(id);
    if (mapa.getSource(id)) mapa.removeSource(id);
  });
  MAPA_ALOCACAO.camadasSupRodovia = [];
}

// Redesenha as rodovias do zero a cada chamada -- redesenhar inteiro é
// simples e barato o bastante pra no máximo algumas dezenas de SUPs por
// semana. dados: o
// retorno de RenderAbaAlocacao.prepararDadosAlocacao (não nulo).
//
// Assíncrona (depende de garantirConcessoesCarregadas, o MESMO fetch/cache
// que o seletor manual de rodovias já usa -- nenhuma requisição nova) --
// por isso guarda dados em MAPA_ALOCACAO.ultimosDados ANTES do fetch: se
// um redesenho mais novo chegar enquanto este ainda busca o JSON (usuário
// trocou de semana rápido, por exemplo), o callback usa o dado MAIS FRESCO
// na hora de desenhar, nunca o congelado no momento da chamada.
function desenharSupsComoRodovias(dados) {
  if (!MAPA_ALOCACAO.instancia) return;
  var mapa = MAPA_ALOCACAO.instancia;
  MAPA_ALOCACAO.ultimosDados = dados;
  limparCamadasSupRodoviaDoMapa(mapa);

  garantirConcessoesCarregadas().then(function (concessoesPorId) {
    var dadosAtuais = MAPA_ALOCACAO.ultimosDados;
    if (!MAPA_ALOCACAO.instancia || !dadosAtuais) return;

    var concessoesLista = Object.keys(concessoesPorId).map(function (id) { return concessoesPorId[id]; });
    var vinculo = VinculoSupConcessionaria.vincularSupsAConcessoes(window.__REGISTROS__, concessoesLista);
    MAPA_ALOCACAO.vinculoSupConcessao = vinculo;

    var preparado = prepararRodoviasDoMapa(dadosAtuais.resumo.porSup, vinculo);

    var bounds = new maplibregl.LngLatBounds();
    var teveGeometria = false;
    Object.keys(preparado.porConcessao).forEach(function (concessaoId) {
      var concessao = concessoesPorId[concessaoId];
      if (!concessao || !concessao.geojson) return;
      var supsResumo = preparado.porConcessao[concessaoId];
      var leitura = leituraMaisCriticaEntre(supsResumo.map(function (s) { return s.leitura; }));
      var cor = CORES_LEITURA_PINO[leitura] || CORES_LEITURA_PINO['sem-demanda'];
      var camadaId = PREFIXO_CAMADA_SUP_RODOVIA + concessaoId;
      mapa.addSource(camadaId, { type: 'geojson', data: concessao.geojson });
      mapa.addLayer({
        id: camadaId, type: 'line', source: camadaId,
        paint: { 'line-color': cor, 'line-width': 6, 'line-opacity': 0.95 },
      });
      MAPA_ALOCACAO.camadasSupRodovia.push(camadaId);
      estenderBoundsPorGeojson(bounds, concessao.geojson);
      teveGeometria = true;
    });

    // Guardado por enquadrouUmaVez pra rodar só no PRIMEIRO desenho com pelo
    // menos uma rodovia -- desenharSupsComoRodovias é chamada a cada
    // redesenho (arrasto, troca de filtro/semana/mês, "Atualizar dados"), e
    // reenquadrar toda vez brigaria com o usuário ter panado/dado zoom por
    // conta própria (mesma cautela que o antigo fitBounds por pino já tinha).
    if (teveGeometria && !MAPA_ALOCACAO.enquadrouUmaVez) {
      mapa.fitBounds(bounds, { padding: 40, maxZoom: 12 });
      MAPA_ALOCACAO.enquadrouUmaVez = true;
    }

    var painelSemRodovia = document.getElementById('mapa-alocacao-sem-localizacao');
    if (painelSemRodovia) {
      if (!preparado.semRodovia.length) {
        painelSemRodovia.innerHTML = '';
      } else {
        painelSemRodovia.innerHTML = '<strong>' + preparado.semRodovia.length
          + ' SUP(s) sem rodovia vinculada</strong><ul>'
          + preparado.semRodovia.map(function (s) {
            return '<li>' + RenderAbaAlocacao.escapeHtml(s.sup) + ' — ' + RenderAbaAlocacao.escapeHtml(s.tomador || '—') + '</li>';
          }).join('') + '</ul>';
      }
    }
  });
}

// Popup de hover -- UMA instância reaproveitada (não uma por rodovia),
// reposicionada/reescrita a cada 'mousemove' -- ligado UMA VEZ por instância
// do mapa (inicializarMapaAlocacao), nunca a cada redesenho (uma camada WebGL
// não tem elemento DOM por feature pra prender um listener; queryRenderedFeatures
// no nível do MAPA, não da camada, é o que permite reaproveitar o mesmo
// listener não importa quantas rodovias existam a cada redesenho).
function mostrarPopupHoverRodovia(camadaId, lngLat) {
  var mapa = MAPA_ALOCACAO.instancia;
  var dados = MAPA_ALOCACAO.ultimosDados;
  if (!mapa || !dados) return;
  var concessaoId = camadaId.slice(PREFIXO_CAMADA_SUP_RODOVIA.length);
  var concessao = (ESTADO_RODOVIAS.concessoesPorId || {})[concessaoId];
  var sups = ((MAPA_ALOCACAO.vinculoSupConcessao || {}).supsPorConcessaoId || {})[concessaoId] || [];
  if (!concessao || !sups.length) return;

  var porSupMap = {};
  (dados.resumo.porSup || []).forEach(function (s) { porSupMap[s.sup] = s; });
  var supsResumo = sups.map(function (sup) { return porSupMap[sup]; }).filter(Boolean);
  if (!supsResumo.length) return;

  var html = popupHtmlDaRodovia(concessao.nome, supsResumo, dados.resumo.porEquipe, dados.equipesPorId);
  if (!MAPA_ALOCACAO.popupHoverRodovia) {
    MAPA_ALOCACAO.popupHoverRodovia = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
  }
  MAPA_ALOCACAO.popupHoverRodovia.setLngLat(lngLat).setHTML(html);
  if (!MAPA_ALOCACAO.popupHoverRodovia.isOpen()) MAPA_ALOCACAO.popupHoverRodovia.addTo(mapa);
}

function esconderPopupHoverRodovia() {
  if (MAPA_ALOCACAO.popupHoverRodovia) MAPA_ALOCACAO.popupHoverRodovia.remove();
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
  // A rodovia no mapa (redesenho de 2026-08-28): não existe mais pino nem
  // cartão flutuante -- o SUP é representado pela PRÓPRIA linha da rodovia,
  // desenhada em WebGL (uma camada MapLibre, não um elemento DOM por
  // feature). document.elementFromPoint só acha o <canvas> do mapa aqui, sem
  // saber QUAL feature está sob o ponto -- por isso este ramo, diferente dos
  // de cima, precisa de mapa.queryRenderedFeatures em vez de .closest().
  var alvoRodovia = resolverAlvoRodoviaNoMapa(e, sob);
  if (alvoRodovia) return alvoRodovia;
  return null;
}

// Hit-test contra as camadas de rodovia dos SUPs (MAPA_ALOCACAO.camadasSupRodovia,
// ver desenharSupsComoRodovias) -- separado de resolverAlvoAlocacao só pra
// isolar a parte que depende de mapa.queryRenderedFeatures/getContainer
// (não dá pra simular num DOM falso sem MapLibre de verdade; a prova FUNCIONAL
// deste caminho é resolverAlvoRodoviaDeFeatures logo abaixo, que é pura).
// sob: o elemento devolvido por elementFromPoint (ou e.target) -- precisa
// estar DENTRO do container do mapa pra este ramo disparar.
function resolverAlvoRodoviaNoMapa(e, sob) {
  var mapa = MAPA_ALOCACAO.instancia;
  var camadas = MAPA_ALOCACAO.camadasSupRodovia || [];
  if (!mapa || !camadas.length || typeof mapa.queryRenderedFeatures !== 'function') return null;
  if (typeof e.clientX !== 'number') return null;
  var container = mapa.getContainer();
  if (!container) return null;
  var dentroDoMapa = sob === container || (typeof container.contains === 'function' && container.contains(sob));
  if (!dentroDoMapa) return null;

  var retangulo = container.getBoundingClientRect();
  var px = e.clientX - retangulo.left;
  var py = e.clientY - retangulo.top;
  // Tolerância de alguns pixels ao redor do ponto -- a linha é fina (6px de
  // largura na tela), soltar em cima do TRAÇO exato seria pouco tolerante
  // pro dedo num tablet.
  var TOLERANCIA_PX = 4;
  var features = mapa.queryRenderedFeatures(
    [[px - TOLERANCIA_PX, py - TOLERANCIA_PX], [px + TOLERANCIA_PX, py + TOLERANCIA_PX]],
    { layers: camadas }
  );
  return resolverAlvoRodoviaDeFeatures(features, MAPA_ALOCACAO.vinculoSupConcessao, mapa.unproject([px, py]));
}

// Função PURA -- decide o alvo a partir do resultado JÁ QUERIDO do MapLibre,
// sem tocar mapa/DOM. Testável isoladamente com uma lista de features falsa
// (só precisa de .layer.id, o único campo que este código lê).
function resolverAlvoRodoviaDeFeatures(features, vinculoSupConcessao, lngLat) {
  if (!features || !features.length) return null;
  var camadaId = features[0].layer.id;
  var concessaoId = camadaId.slice(PREFIXO_CAMADA_SUP_RODOVIA.length);
  var sups = ((vinculoSupConcessao || {}).supsPorConcessaoId || {})[concessaoId] || [];
  if (!sups.length) return null;
  return { tipo: 'rodovia', sups: sups, lngLat: lngLat };
}

// Resolve a coluna automaticamente (ComputeAlocacao.escolherColunaAutomatica,
// Task 3) e delega pra aplicarMovimento -- o MESMO caminho que a célula da
// tabela já usa. NENHUMA regra nova de negócio mora aqui: eligibilidade, trava
// de veículo e persistência continuam só em aplicarMovimento/destinoDoGrupo;
// esta função só decide QUAL coluna passar pra ele, porque um pino representa
// o SUP inteiro, não uma célula SUP×coluna.
//
// equipeId: a equipe sendo solta. sup: o SUP do pino onde ela foi solta.
//
// SUP sem linha em ultimaGrade (não deveria acontecer na prática -- ver o
// comentário em ESTADO_ALOCACAO.ultimaGrade -- mas não é validado aqui, de
// propósito: validar existência do SUP seria uma regra nova, e o funil já
// existente é quem decide o que é válido): celulasDaLinha cai pra {}, e
// escolherColunaAutomatica cai no PRÓPRIO fallback dela (Task 3) -- a
// primeira coluna da equipe, nunca null -- então o movimento ainda é
// tentado, com essa coluna de fallback. Não lança, não trava.
function aplicarMovimentoNoPino(equipeId, sup) {
  var equipe = equipeAlocavelPeloId(equipeId);
  if (!equipe) return false;
  var linha = null;
  for (var i = 0; i < ESTADO_ALOCACAO.ultimaGrade.linhas.length; i++) {
    if (ESTADO_ALOCACAO.ultimaGrade.linhas[i].sup === sup) { linha = ESTADO_ALOCACAO.ultimaGrade.linhas[i]; break; }
  }
  var celulasDaLinha = linha ? linha.celulas : {};
  var coluna = ComputeAlocacao.escolherColunaAutomatica(equipe.colunas || [], celulasDaLinha);
  if (!coluna) return false;
  return aplicarMovimento(equipeId, sup, coluna);
}

// Miniseletor (2026-08-28): quando a rodovia onde a equipe foi solta tem 2+
// SUPs (ex. "Pantanal"), não dá pra saber sozinho qual deles o usuário quis
// -- decisão do usuário: perguntar na hora, em vez de adivinhar pelo maior
// déficit. Um popup do MapLibre com um botão por SUP candidato, ancorado no
// ponto onde a equipe foi solta. O clique no botão (delegado no MESMO
// listener de #secao-mapa-alocacao, via [data-sup-escolha]) chama
// aplicarMovimentoNoPino de verdade -- este popup só APRESENTA a escolha,
// não decide nada por conta própria.
function abrirEscolhaDeSupNaRodovia(equipeId, sups, lngLat) {
  var mapa = MAPA_ALOCACAO.instancia;
  if (!mapa) return;
  if (MAPA_ALOCACAO.popupEscolhaSup) MAPA_ALOCACAO.popupEscolhaSup.remove();

  var container = document.createElement('div');
  container.className = 'popup-escolha-sup-rodovia';
  container.innerHTML = '<p class="popup-titulo">Alocar em qual SUP?</p>'
    + sups.map(function (sup) {
      return '<button type="button" class="botao-escolha-sup-rodovia"'
        + ' data-equipe-escolha="' + RenderAbaAlocacao.escapeHtml(equipeId) + '"'
        + ' data-sup-escolha="' + RenderAbaAlocacao.escapeHtml(sup) + '">'
        + RenderAbaAlocacao.escapeHtml(sup) + '</button>';
    }).join('');

  MAPA_ALOCACAO.popupEscolhaSup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, offset: 8 })
    .setLngLat(lngLat)
    .setDOMContent(container)
    .addTo(mapa);
}

// Um único listener delegado por SEÇÃO, montado UMA VEZ (a seção nunca é
// recriada -- mesmo padrão do listener do Balanço, ver
// inicializarTooltipBalanco acima). As duas seções existem no HTML estático
// desde o load (ver renderAlocacaoPagina), então este wireup pode rodar
// incondicionalmente, antes até da senha ser digitada -- só reage a eventos
// que, na prática, só acontecem depois que montarAbaAlocacao() já desenhou
// algo lá dentro.
//
// Renomeada de #secao-alocacao pra #secao-kanban-alocacao na Task 9
// (2026-08-26), quando a nav Kanban/Mapa dividiu a seção única em duas.
// PARAMETRIZADA na Task 14 (mesmo dia): o gesto de arrasto passou a existir
// TAMBÉM na aba Mapa (soltar a equipe sobre o pino do SUP, ver
// aplicarMovimentoNoPino), e os pinos vivem dentro de #secao-mapa-alocacao --
// fora da árvore de #secao-kanban-alocacao, então o listener do Kanban nunca
// os veria. Chamada uma vez por seção no wireup do fim do script.
//
// O ESTADO DO GESTO (ARRASTO_ALOCACAO/SELECAO_ALOCACAO/
// SUPRIMIR_PROXIMO_CLICK_ALOCACAO) é de MÓDULO, compartilhado pelas duas
// chamadas de propósito: é "o gesto em andamento na página", não "o gesto
// desta seção". As duas seções são mutuamente exclusivas em display (a nav
// mostra uma e esconde a outra), então não há gesto que comece numa e termine
// na outra -- e, se um dia houvesse, o estado único é o que garante que a aba
// continua movendo UMA equipe por vez, em vez de dois arrastos paralelos
// disputando a mesma alocação.
function inicializarInteracaoAlocacao(idSecao) {
  var secao = document.getElementById(idSecao);

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
    } else if (alvo && alvo.tipo === 'rodovia') {
      if (alvo.sups.length === 1) {
        aplicarMovimentoNoPino(equipeId, alvo.sups[0]);
      } else {
        abrirEscolhaDeSupNaRodovia(equipeId, alvo.sups, alvo.lngLat);
      }
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

    // Botão do miniseletor "Alocar em qual SUP?" (2026-08-28,
    // abrirEscolhaDeSupNaRodovia) -- resolve a ambiguidade de uma rodovia
    // com 2+ SUPs. Checado ANTES de [data-acao]/[data-equipe] porque o botão
    // não carrega nenhum dos dois.
    var botaoEscolhaSup = e.target && e.target.closest ? e.target.closest('[data-sup-escolha]') : null;
    if (botaoEscolhaSup) {
      var equipeDaEscolha = botaoEscolhaSup.getAttribute('data-equipe-escolha');
      var supDaEscolha = botaoEscolhaSup.getAttribute('data-sup-escolha');
      if (MAPA_ALOCACAO.popupEscolhaSup) {
        MAPA_ALOCACAO.popupEscolhaSup.remove();
        MAPA_ALOCACAO.popupEscolhaSup = null;
      }
      aplicarMovimentoNoPino(equipeDaEscolha, supDaEscolha);
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
      } else if (nome === 'salvar-alocacao') {
        salvarAlocacao();
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
      } else if (alvoClique && alvoClique.tipo === 'rodovia') {
        if (alvoClique.sups.length === 1) {
          aplicarMovimentoNoPino(equipeIdSelecionado, alvoClique.sups[0]);
        } else {
          abrirEscolhaDeSupNaRodovia(equipeIdSelecionado, alvoClique.sups, alvoClique.lngLat);
        }
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
// cabeçalho de tools/semanal/live-refresh.js. Esta página passa só as 7
// fontes que a Alocação de fato lê (matriz/avancos/lab/eq/demandasSondagem/
// demandasLab/pessoas) e config.rosterAlocacao: true -- liga os 4 campos
// exclusivos dela (equipesCsv/osParaSup/equipesRosterPeriodo/pessoasCsv).
// producao/roster (Link 6+7) e config.modulos ficam de fora de propósito: os
// dois só alimentam equipesPorDia/equipesNaoProdutivas (Realizado de
// Equipes), que esta página nunca lê -- a Tendência dela é sempre 'volume'
// (compute-alocacao.js), e volume não toca nenhum dos dois campos.
// pessoas (2026-08-28): URL_ESPELHO_PESSOAS_SEMANAL ainda é o placeholder
// PENDENTE-PUBLICAR-PESSOAS até a aba PESSOAS ser publicada como CSV no
// Google Sheets (ver o comentário dela em live-refresh.js) -- até lá, o
// fetch é pulado (RE_URL_PENDENTE) e "Atualizar dados" preserva o
// pessoasCsv que o build embutiu na página, sem apagá-lo (o bug de
// 2026-08-28 que isto substitui).
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
      pessoas: LiveRefresh.URLS_PADRAO.pessoas,
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

// Wireup incondicional, no load do script -- as duas seções já existem no
// HTML estático (ver renderAlocacaoPagina), e os listeners delegados não
// dependem de senha nem de a aba já ter sido desenhada.
//
// DUAS chamadas (Task 14): a aba Mapa também aceita arrasto, e as rodovias
// (camadas MapLibre dentro de #mapa-alocacao-canvas) ficam dentro de
// #secao-mapa-alocacao -- fora da árvore do Kanban, então o listener dele
// nunca as alcançaria.
inicializarInteracaoAlocacao('secao-kanban-alocacao');
inicializarInteracaoAlocacao('secao-mapa-alocacao');

// Com o envio ao Sheet represado até o clique em "Salvar alocação" (ver
// ESTADO_ALOCACAO.filaSalvar), fechar a aba com movimentos não salvos os
// perderia DO SHEET (continuam no localStorage desta máquina, mas outro
// navegador nunca os veria) sem aviso nenhum. O aviso do navegador é
// genérico -- não há como customizar o texto -- mas é melhor que nada.
if (window.addEventListener) {
  window.addEventListener('beforeunload', function (e) {
    if (!contarNaoSalvos()) return;
    e.preventDefault();
    e.returnValue = '';
  });
}

// Task 6: wireup do seletor de rodovias (busca lazy, camadas MapLibre, legenda).
// #secao-mapa-alocacao já existe no HTML estático desde o load da página, então
// a delegação dentro de inicializarSeletorRodovias funciona mesmo chamada antes
// de #filtro-rodovias existir no DOM (só aparece depois do 1º montarMapaAlocacao()).
inicializarSeletorRodovias();

// FIX (revisão final, achado Critical 1): a nav Kanban/Mapa vive em
// '<div class="abas-visualizacao">', IRMÃ das duas seções -- um clique nos
// botões nunca borbulha para dentro de #secao-kanban-alocacao nem de
// #secao-mapa-alocacao, então os dois listeners delegados de
// inicializarInteracaoAlocacao (acima) nunca veem esse clique. Sem isto, um
// gesto de seleção por clique-clique (SELECAO_ALOCACAO.equipeId) iniciado
// numa aba sobrevivia à troca de aba, e o PRIMEIRO clique dentro da OUTRA
// seção -- mesmo um clique qualquer, só pra ler um cartão, sem nenhum pino
// envolvido -- era tratado como o 2º passo daquele gesto abandonado. Um
// clique no pool da aba Mapa com uma seleção "órfã" da aba Kanban chegava a
// aplicarMovimento(equipeId, '', ''), que DEVOLVE a equipe (e o grupo de
// veículo inteiro, destinoDoGrupo) ao pool -- de-alocando em silêncio, sem
// confirmação, e gravando a remoção na Sheet. A direção oposta (selecionar
// no Mapa, clicar numa célula do Kanban) aloca em vez de devolver -- mesma
// causa raiz.
//
// Fix: as DUAS trocas de aba encerram qualquer gesto em andamento ANTES de
// trocar o display -- zera SELECAO_ALOCACAO/SUPRIMIR_PROXIMO_CLICK_ALOCACAO
// (estado de módulo, compartilhado pelas duas seções, ver o comentário
// grande em inicializarInteracaoAlocacao) e limpa os destaques das DUAS
// seções, não só da que está saindo de cena: limparDestaquesAlocacao(secao)
// só limpa a seção CORRENTE (raiz escopada, achado Important 3 da revisão
// do Task 9) -- sem limpar a outra também, a seção abandonada no meio de um
// arrasto ficava presa em "arrastando" (celula-alvo/celula-inerte/
// cartao-companheiro acesos) até um F5. Ver o teste
// 'trocar de aba encerra uma seleção pendente' em
// test/semanal-alocacao-interacao.test.js -- RED antes desta correção
// (nenhum teste cobria os handlers de troca de aba até aqui), GREEN depois.
function encerrarGestosAoTrocarDeAba() {
  encerrarArrastoAlocacao(document.getElementById('secao-kanban-alocacao'));
  SELECAO_ALOCACAO.equipeId = null;
  SUPRIMIR_PROXIMO_CLICK_ALOCACAO = false;
  limparDestaquesAlocacao(document.getElementById('secao-kanban-alocacao'));
  limparDestaquesAlocacao(document.getElementById('secao-mapa-alocacao'));
}

// Nav Kanban/Mapa -- markupAbas() (tools/comum/render-shell.js) já desenha
// o <div class="abas-visualizacao"> com os dois <button>; aqui só liga o
// clique. Lazy-init do MapLibre no primeiro clique na aba Mapa (Task 11) --
// aqui só troca o display e redesenha; a inicialização do mapa em si mora
// em inicializarMapaAlocacao(), chamada por este mesmo handler quando ainda
// não existir instância.
document.getElementById('aba-kanban-alocacao').addEventListener('click', function () {
  encerrarGestosAoTrocarDeAba();
  document.getElementById('aba-kanban-alocacao').classList.add('aba-ativa');
  document.getElementById('aba-mapa-alocacao').classList.remove('aba-ativa');
  document.getElementById('secao-kanban-alocacao').style.display = '';
  document.getElementById('secao-mapa-alocacao').style.display = 'none';
});
document.getElementById('aba-mapa-alocacao').addEventListener('click', function () {
  encerrarGestosAoTrocarDeAba();
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
  #secao-mapa-alocacao #mapa-alocacao-rodovias { position: relative; margin: 0 0 12px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  #secao-mapa-alocacao #mapa-alocacao-rodovias .filtro-multi-painel { max-height: 320px; overflow-y: auto; }
  #secao-mapa-alocacao .mapa-alocacao-rodovias-legenda { display: flex; gap: 10px; flex-wrap: wrap; }
  #secao-mapa-alocacao .legenda-rodovia-item { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--mapa-texto); }
  #secao-mapa-alocacao .legenda-rodovia-cor { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
  #secao-mapa-alocacao .filtro-multi-item-sem-tracado { opacity: 0.5; cursor: not-allowed; }
  #secao-mapa-alocacao .filtro-multi-item-nota { font-size: 11px; font-style: italic; }
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
  #secao-mapa-alocacao .maplibregl-popup-content { color: #1a1d24; max-width: 320px; }
  /* Popup de hover na rodovia (redesenho de 2026-08-28) -- por SUP daquela
     rodovia (tendência/capacidade/saldo/carteira) mais a lista de equipes
     por tipologia, ver popupHtmlDaRodovia. */
  #secao-mapa-alocacao .popup-rodovia-alocacao { font-family: "Poppins", sans-serif; font-size: 13px; }
  #secao-mapa-alocacao .popup-rodovia-alocacao .popup-titulo { font-weight: 700; margin: 0 0 6px; color: #1a1d24; }
  #secao-mapa-alocacao .popup-rodovia-sup {
    padding: 6px 0; border-top: 1px solid rgba(0,0,0,0.12);
  }
  #secao-mapa-alocacao .popup-rodovia-sup:first-of-type { border-top: none; }
  #secao-mapa-alocacao .popup-rodovia-sup .popup-subtitulo { font-weight: 600; margin: 0 0 2px; color: #1a1d24; }
  #secao-mapa-alocacao .popup-equipes-titulo {
    font-weight: 600; margin: 8px 0 4px; padding-top: 6px;
    border-top: 1px solid rgba(0,0,0,0.12); color: #1a1d24;
  }
  /* Miniseletor "Alocar em qual SUP?" (abrirEscolhaDeSupNaRodovia) -- só
     aparece quando a rodovia solta tem 2+ SUPs. */
  #secao-mapa-alocacao .popup-escolha-sup-rodovia { font-family: "Poppins", sans-serif; font-size: 13px; }
  #secao-mapa-alocacao .popup-escolha-sup-rodovia .popup-titulo { font-weight: 700; margin: 0 0 6px; color: #1a1d24; }
  #secao-mapa-alocacao .botao-escolha-sup-rodovia {
    display: block; width: 100%; margin-bottom: 4px; padding: 6px 8px;
    border: 1px solid var(--border); border-radius: 6px; background: var(--surface-1);
    color: var(--text-primary); font-size: 12px; cursor: pointer; text-align: left;
  }
  #secao-mapa-alocacao .botao-escolha-sup-rodovia:hover { background: var(--mapa-acento); color: var(--mapa-acento-contraste); }
  `;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>ALOCAÇÃO EQUIPES</title>
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css">
<!-- Poppins (Decisão 9 do spec, tipografia de corpo da aba Mapa) -- achado
     Important 4 da revisão final: as 3 regras font-family: "Poppins" abaixo
     (cssMapaAlocacao) nunca tiveram fonte nenhuma carregada, e caíam sempre
     no fallback do sistema, em silêncio. O ideal seria embutir via
     loadDataUri, igual à Nimbus Sans Extd (assets/mapa-alocacao/) -- mas não
     existe um arquivo .otf/.ttf de Poppins neste repositório, e a instrução
     desta correção foi explícita: NÃO baixar um agora. Link do Google Fonts
     como solução de curto prazo -- é a única página deste projeto que
     depende de um host externo além do MapLibre/Esri, então trocar por
     embutida fica pendente pra quando o arquivo da fonte entrar em
     assets/mapa-alocacao/. -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;900&display=swap">
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
