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

// Script cliente completo da página: estado, filtros, arrasto, live-refresh
// (atualizarDadosAoVivoSemanal) e a montagem da grade de Alocação.
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
      autor: (window.__ALOCACAO_AUTOR__ || 'dashboard'),
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

// Recomputa o roster da semana (equipesDoQuadro, Task 1 -- disponibilidade e
// vínculo com o SUP mudam a cada semana, mesmo sem novo build) e redesenha
// #secao-alocacao inteira com o estado atual de ESTADO_ALOCACAO.alocacao. NÃO
// mexe em persistência -- quem muda o que está alocado é
// aplicarMovimento/semearDoRealizado/limparAlocacao/selecionarSemanaAlocacao,
// cada um decidindo por si quando ler ou gravar; esta função só desenha o que
// já está em ESTADO_ALOCACAO.
//
// 'indices' sai de indicesFiltrados, NÃO de indicesDaAba: o filtro de ativos
// esconderia justamente as linhas "Parado c/ carteira", que são o motivo de
// a aba existir (um SUP inativo em Volume ainda pode ter carteira parada e
// merecer uma equipe).
//
// osParaSup (Task 10) agora viaja no payload cifrado, dentro de
// window.__DEMANDAS__ (build-dashboard.js/montarEquipesAtivas e o
// live-refresh, ver atualizarDadosAoVivoSemanal) -- sem ele,
// supRealizado/colunaRealizada ficam sempre null e "Repor o realizado" não
// tem o que semear. O fallback '|| {}' continua como default seguro para HTML
// de um build anterior a esta task (degrada para "pool vazio de sugestão",
// nunca quebra).
function montarAbaAlocacao() {
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
    osParaSup: demandas.osParaSup || {},
  });
  ESTADO_ALOCACAO.equipes = roster.equipes;
  ESTADO_ALOCACAO.foraDoQuadro = roster.foraDoQuadro;

  var indices = indicesFiltrados(
    window.__REGISTROS__,
    filtrosSelecionadosSemanal.tipologia, filtrosSelecionadosSemanal.categoria,
    filtrosSelecionadosSemanal.grupo, filtrosSelecionadosSemanal.sup, filtrosSelecionadosSemanal.origem
  );

  var cliente = clienteAlocacao();
  document.getElementById('secao-alocacao').innerHTML = RenderAbaAlocacao.renderAbaAlocacao(
    window.__REGISTROS__, indices, {
      mesIdx: mesSelecionadoIdx, ano: window.__ANO__,
      semanas: semanas, semana: semana,
      demandas: window.__DEMANDAS__,
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
    }
  );

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
  var chaveDaSemana = semana ? AlocacaoSheet.chaveSemana(window.__ANO__, semana.inicio) : null;
  if (chaveDaSemana && chaveDaSemana !== ESTADO_ALOCACAO.semanaCarregada && !semRoster) {
    ESTADO_ALOCACAO.semanaCarregada = chaveDaSemana;
    ESTADO_ALOCACAO.geracaoAlocacao++;
    carregarAlocacaoDaSemana(chaveDaSemana);
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
function destacarCelulasCompativeis(colunas, podeDevolver, companheiros) {
  var celulas = document.querySelectorAll('.celula-alocacao');
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
  var todosOsCartoes = document.querySelectorAll('[data-equipe]');
  (companheiros || []).forEach(function (idBruto) {
    var id = String(idBruto);
    for (var j = 0; j < todosOsCartoes.length; j++) {
      if (todosOsCartoes[j].getAttribute('data-equipe') === id) {
        todosOsCartoes[j].classList.add('cartao-companheiro');
      }
    }
  });
  if (!podeDevolver) return;
  var pool = document.querySelector('.pool-alocacao');
  if (pool) pool.classList.add('pool-alvo');
}

// Chamava-se limparDestaqueCelulas, e o nome virou mentira em 2026-08-11,
// quando o pool passou a acender junto -- e mais ainda em 2026-08-12, com as
// companheiras de veículo. É chamada dos CINCO pontos que encerram um gesto, e
// todos querem a limpeza COMPLETA: limpar qualquer uma dessas marcas em outro
// lugar a deixaria acesa para sempre em pelo menos um dos quatro caminhos de
// saída do arrasto (soltura aceita, recusada, pointercancel, ou solta fora de
// tudo). Ver o comentário de encerrarArrastoAlocacao.
function limparDestaquesAlocacao() {
  var celulas = document.querySelectorAll('.celula-alocacao');
  for (var i = 0; i < celulas.length; i++) {
    celulas[i].classList.remove('celula-alvo');
    celulas[i].classList.remove('celula-inerte');
  }
  var companheiros = document.querySelectorAll('.cartao-companheiro');
  for (var j = 0; j < companheiros.length; j++) {
    companheiros[j].classList.remove('cartao-companheiro');
  }
  var pool = document.querySelector('.pool-alocacao');
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
function encerrarArrastoAlocacao() {
  if (ARRASTO_ALOCACAO.cartao && ARRASTO_ALOCACAO.pointerId !== null
    && typeof ARRASTO_ALOCACAO.cartao.releasePointerCapture === 'function') {
    try { ARRASTO_ALOCACAO.cartao.releasePointerCapture(ARRASTO_ALOCACAO.pointerId); } catch (err) { /* já liberada, ou o alvo sumiu do DOM -- sem problema */ }
  }
  removerFantasmaArrasto();
  ARRASTO_ALOCACAO.pointerId = null;
  ARRASTO_ALOCACAO.cartao = null;
  ARRASTO_ALOCACAO.equipeId = null;
  ARRASTO_ALOCACAO.moveu = false;
  limparDestaquesAlocacao();
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

// Um único listener delegado em #secao-alocacao, montado UMA VEZ (a seção
// nunca é recriada -- mesmo padrão do listener do Balanço, ver
// inicializarTooltipBalanco acima). #secao-alocacao existe no HTML estático
// desde o load (ver renderSemanal), então este wireup pode rodar
// incondicionalmente, antes até da senha ser digitada -- só reage a eventos
// que, na prática, só acontecem depois que montarAbaAlocacao() já desenhou
// algo lá dentro.
function inicializarInteracaoAlocacao() {
  var secao = document.getElementById('secao-alocacao');

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
    limparDestaquesAlocacao();

    ARRASTO_ALOCACAO.pointerId = e.pointerId;
    ARRASTO_ALOCACAO.cartao = cartao;
    ARRASTO_ALOCACAO.equipeId = equipeId;
    ARRASTO_ALOCACAO.moveu = false;
    ARRASTO_ALOCACAO.fantasma = criarFantasmaArrasto(equipeId);
    posicionarFantasmaArrasto(ARRASTO_ALOCACAO.fantasma, e.clientX, e.clientY);
    destacarCelulasCompativeis(equipe.colunas || [], podeDevolverGrupo(equipeId, equipe.companheiros), equipe.companheiros || []);

    // FIX (revisão do Task 9, achado Critical 2): captura o ponteiro no
    // cartão -- garante que pointermove/pointerup/pointercancel CONTINUAM
    // chegando a este elemento (e, por bolha, em #secao-alocacao, que é
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
  secao.addEventListener('input', function (e) {
    var campo = e.target && e.target.id === 'busca-equipe' ? e.target : null;
    if (!campo) return;
    ESTADO_ALOCACAO.busca = campo.value || '';
    montarAbaAlocacao();
    var novo = document.getElementById('busca-equipe');
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
    encerrarArrastoAlocacao();

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
    encerrarArrastoAlocacao();
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
      limparDestaquesAlocacao();
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
    destacarCelulasCompativeis(equipeClicada.colunas || [], podeDevolverGrupo(equipeIdClicado, equipeClicada.companheiros), equipeClicada.companheiros || []);
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

var URL_ESPELHO_MATRIZ_SEMANAL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRaOjGxPYWKj-as9RwErptIND7PE_zxsND19PReV1MdOup1ZY3iAu_DGrQ0gatPyYFEy3hg-LWE2esw/pub?gid=609773455&single=true&output=csv';
// 2026-08-05: trocado do espelho da Sheet (Apps Script copiando o .xlsx do
// Drive) pro CSV combinado publicado junto com a própria página -- gerado
// por tools/semanal/atualizar-avancos-online.js (roda à parte, não a cada
// build). Caminho relativo: mesmo domínio do GitHub Pages, sem CORS, e sem
// depender de um Apps Script rodando em outra conta. Ver
// docs/superpowers/specs/2026-08-05-avancos-online-design.md.
var URL_ESPELHO_AVANCOS_SEMANAL = 'avancos-online.csv';
var URL_ESPELHO_EQ_SEMANAL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ7SaAZI8VwQaZD0nPxtOyw56b1XmKfqDTC6qSkj-1PAQr4A8ihTY4vZCOhF4PuMNIYm_-hN_CNdNrX/pub?gid=199381651&single=true&output=csv';
// 2026-08-05: trocado do espelho da Sheet (Apps Script) pro CSV publicado
// junto com a própria página -- mesmo padrão de URL_ESPELHO_AVANCOS_SEMANAL.
// Ver docs/superpowers/specs/2026-08-05-lab-e-equipes-online-design.md.
var URL_ESPELHO_LAB_SEMANAL = 'lab-online.csv';
// 2026-08-10 (recuperado e reintegrado em 2026-08-11): produção CRUA do
// Link 7 -- "IdEquipe,SUP,Tipo,DiaEpoch", uma linha por (equipe, dia,
// contrato). Substitui o pré-agregado "SUP,Tipo,DiaEpoch,Fracao" de
// 2026-08-08 (Task 12/equipes FRACIONADAS): a fração agora é calculada no
// cruzamento com o roster (ComputeEquipesRealizadoAlocado.agregarEquipesRealizadoAlocado),
// MESMA lógica que build-dashboard.js (montarEquipesRealizado) já faz --
// os dois nunca podem divergir. Mesmo nome de arquivo/padrão de publicação
// relativa dos outros dois -- só o formato do conteúdo mudou.
var URL_ESPELHO_EQUIPES_SEMANAL = 'equipes-online.csv';
// Roster (Link 6, multi-mês, já classificado por Estado) -- publicado junto
// com equipes-online.csv por atualizar-equipes-online.js. Ver o comentário
// acima e compute-equipes-realizado-alocado.js.
var URL_ESPELHO_EQUIPES_ROSTER_SEMANAL = 'equipes-roster-online.csv';
// 2026-08-10: os dois arquivos de BACKLOG (furos/ensaios ainda não
// executados), que até então só alimentavam o build a partir de dist/ --
// o botão nunca os buscava, e por isso zerava Demandas Pendentes a cada
// clique (5.493 furos + 12.781 ensaios pendentes, medidos em 2026-08-10,
// desapareciam com o status mostrando "Atualizado" em verde). Publicados
// junto com a própria página, mesmo padrão relativo dos CSVs de cima.
var URL_ESPELHO_DEMANDAS_SONDAGEM_SEMANAL = 'demandas-sondagem-online.csv';
var URL_ESPELHO_DEMANDAS_LAB_SEMANAL = 'demandas-lab-online.json';

function definirStatusAtualizacaoSemanal(texto, ehErro) {
  var el = document.getElementById('status-atualizacao');
  if (!el) return;
  el.textContent = texto;
  el.classList.toggle('status-erro', !!ehErro);
}

function periodosDoAnoSemanal() {
  var periodos = [];
  for (var i = 0; i < 12; i++) periodos.push(new Date(Date.UTC(window.__ANO__, i, 1)));
  return periodos;
}

function buscarCsvSemanal(url) {
  var comCacheBust = url + (url.indexOf('?') === -1 ? '?' : '&') + '_=' + Date.now();
  return fetch(comCacheBust).then(function (resposta) {
    if (!resposta.ok) throw new Error('HTTP ' + resposta.status + ' ao buscar ' + url);
    return resposta.text();
  });
}

// parseAvancos/parseLab consomem a grade 1-INDEXADA de readXlsxSheet
// (tools/comum/xlsx-reader.js): grid[0] é sempre um buraco vazio, grid[1] é o
// cabeçalho, o dado começa em grid[2]. parseCsvGrid devolve uma grade
// 0-INDEXADA normal (grid[0] = cabeçalho, já que um CSV publicado não tem a
// linha 0 vazia que o .xlsx real tem). Sem este deslocamento, os dois parsers
// procurariam o cabeçalho na primeira linha de DADO e ou lançariam "Coluna não
// encontrada" ou desalinhariam tudo em silêncio.
//
// parseMatrizCliente NÃO passa por aqui de propósito: ele já foi escrito pra
// consumir a grade 0-indexada de parseCsvGrid direto (ver o comentário sobre
// grid[0] em parse-matriz-cliente.js).
function gridCsvComoXlsx(texto) {
  var g = ParseMatrizCliente.parseCsvGrid(texto);
  g.unshift(null);
  return g;
}

// RE_URL_PENDENTE reconhece uma URL_ESPELHO_* ainda no literal placeholder
// "PENDENTE-..." (ver o comentário delas acima) e degrada com graça em vez
// de falhar tudo: enquanto QUALQUER uma das duas (Avanços/Lab) continuar
// placeholder, o botão atualiza só a MATRIZ (Previsto/ticket médio) e deixa
// window.__DEMANDAS__ como estava. URL_ESPELHO_AVANCOS_SEMANAL não bate mais
// nesse padrão desde 2026-08-05 (é sempre um caminho relativo real,
// 'avancos-online.csv') -- na prática só URL_ESPELHO_LAB_SEMANAL ainda pode
// estar pendente hoje, mas o mecanismo continua genérico pras duas.
var RE_URL_PENDENTE = /^PENDENTE-/;

// ATENÇÃO -- esta função existe DUPLICADA em tools/semanal/render-semanal.js
// (mesmo nome, cópia independente desde a extração desta página própria em
// 2026-08-25). As duas já nasceram diferentes (a semanal manteve
// csvEq/periodoEq só para equipesNaoProdutivas; esta manteve o bloco
// osParaSup inteiro) -- não são mantidas em sincronia automática. O contrato
// de índices posicionais textos[N] do Promise.all abaixo e a regra de
// "escrever por ÚLTIMO em demandasNovas" (nunca sobrescrever um campo já
// preenchido por engano) valem nas duas cópias: mexeu aqui, confira a outra.
// Não refatorar para compartilhar sem uma rodada dedicada a isso.
//
// Tudo-ou-nada, mas só ENTRE as fontes que este refresh de fato tentou
// atualizar: nenhum window.__REGISTROS__/window.__DEMANDAS__ é sobrescrito
// antes de todos os fetches tentados E de todo o parsing terminarem com
// sucesso -- uma falha parcial (ex.: MATRIZ ok, Avanços fora do ar) não pode
// deixar os dois globais referindo momentos diferentes. baseline
// (window.__BASELINE__) nunca é tocado aqui -- ver "Estado atual" no spec.
function atualizarDadosAoVivoSemanal() {
  definirStatusAtualizacaoSemanal('Atualizando…', false);
  var avancosLabConfigurados = !RE_URL_PENDENTE.test(URL_ESPELHO_AVANCOS_SEMANAL)
    && !RE_URL_PENDENTE.test(URL_ESPELHO_LAB_SEMANAL);

  Promise.all([
    buscarCsvSemanal(URL_ESPELHO_MATRIZ_SEMANAL),
    avancosLabConfigurados ? buscarCsvSemanal(URL_ESPELHO_AVANCOS_SEMANAL) : Promise.resolve(null),
    avancosLabConfigurados ? buscarCsvSemanal(URL_ESPELHO_LAB_SEMANAL) : Promise.resolve(null),
    // Espelho da aba EQ (equipes ATIVAS). Falha sozinha: se esta única fonte
    // cair, o refresh continua atualizando MATRIZ/Avanços/Lab e o Δ equipes
    // fica com o dado do build -- em vez de o botão inteiro dar erro por causa
    // da série secundária.
    buscarCsvSemanal(URL_ESPELHO_EQ_SEMANAL).catch(function () { return null; }),
    // Equipes FRACIONADAS (2026-08-08, Task 12 -- antes "produtivas"). Gated
    // pelo MESMO avancosLabConfigurados dos dois de cima: o parse+soma abaixo
    // roda depois de furos/ensaios estarem prontos, igual ao build.
    //
    // Falha sozinha, igual à aba EQ acima: este CSV é publicado à parte
    // (cp dist/equipes-online.csv docs/), então um 404 por cópia esquecida é
    // o modo de falha ESPERADO -- e sem o .catch ele derrubava o botão
    // INTEIRO ("Falha ao atualizar: HTTP 404"), levando MATRIZ e Avanços com
    // ele. Sem fracionadas o Δ equipes só volta pra reserva
    // (ativas/mobilizadas), que é como era antes desta branch.
    avancosLabConfigurados
      ? buscarCsvSemanal(URL_ESPELHO_EQUIPES_SEMANAL).catch(function () { return null; })
      : Promise.resolve(null),
    // "Ativas (total)" do dashboard Matriz (historico.json, 2026-08-06) foi
    // REMOVIDO em 2026-08-21: desde a troca do Realizado de Equipes pra
    // roster+produção (Link 6+7, 2026-08-10) nada mais consumia esse fetch --
    // ver o histórico da mudança e compute-equipes-ativo-matriz.js (module
    // ainda existe, só não é mais chamado daqui). Removê-lo tirou um índice
    // do array: os textos[6]/[7]/[8] de antes viraram [5]/[6]/[7] abaixo.
    // Demandas pendentes de sondagem/lab (2026-08-10) -- OPCIONAIS, mesmo
    // espírito de robustez que equipes/aba EQ: sem elas, Demandas Pendentes
    // volta a ficar sem o backlog (como sempre foi até aqui), mas o resto do
    // refresh conclui normalmente. Gated por avancosLabConfigurados: fazem
    // sentido só quando furos/ensaios também estão sendo recalculados.
    avancosLabConfigurados
      ? buscarCsvSemanal(URL_ESPELHO_DEMANDAS_SONDAGEM_SEMANAL).catch(function () { return null; })
      : Promise.resolve(null),
    avancosLabConfigurados
      ? fetch(URL_ESPELHO_DEMANDAS_LAB_SEMANAL).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).catch(function () { return null; })
      : Promise.resolve(null),
    // Roster (Link 6, textos[7]) -- entra por ÚLTIMO no array de propósito,
    // pra não deslocar os índices textos[4..6] já em uso por baixo. Gated
    // pelo MESMO avancosLabConfigurados dos demais de equipes: o cruzamento
    // com a produção (textos[4]) só roda depois de furos/registros prontos.
    // Falha sozinha, mesmo padrão de todos os outros CSVs opcionais deste
    // Promise.all -- sem roster, o Δ equipes fica sem dado (2026-08-21: sem
    // fonte de reserva -- ver o comentário acima de fonteEquipes em
    // build-dashboard.js), nunca derruba o botão inteiro.
    avancosLabConfigurados
      ? buscarCsvSemanal(URL_ESPELHO_EQUIPES_ROSTER_SEMANAL).catch(function () { return null; })
      : Promise.resolve(null),
  ]).then(function (textos) {
    var registrosNovos = ParseMatrizCliente.parseMatrizCliente(ParseMatrizCliente.parseCsvGrid(textos[0]));
    if (!registrosNovos.length) throw new Error('nenhum registro encontrado no espelho da MATRIZ -- confira se o Apps Script já rodou pelo menos uma vez');

    var demandasNovas = window.__DEMANDAS__;

    if (avancosLabConfigurados) {
      // Demandas pendentes de sondagem (textos[5], OPCIONAL): mesmo tratamento
      // que build-dashboard.js -- as linhas de dado são anexadas ao grid de
      // Avanços ANTES do parse (mesmo formato de 10 colunas, HEADER_SAIDA),
      // então parseAvancos as lê como furos PENDENTE normais, sem precisar de
      // um caminho de código à parte.
      var gridAvancosCliente = ParseMatrizCliente.parseCsvGrid(textos[1]);
      if (textos[5]) {
        var gridPendentesCliente = ParseMatrizCliente.parseCsvGrid(textos[5]);
        for (var iP = 1; iP < gridPendentesCliente.length; iP++) gridAvancosCliente.push(gridPendentesCliente[iP]);
      }
      gridAvancosCliente.unshift(null);
      var furosLidos = ParseAvancos.parseAvancos(gridAvancosCliente).furos;
      var ensaiosLidos = ParseLab.parseLab(gridCsvComoXlsx(textos[2])).ensaios;
      // Demandas pendentes de lab (textos[6], OPCIONAL): já chega no shape
      // que parseLab produz ({sup, tipologia, concluido, criacao}) -- só
      // reidrata 'criacao' de ISO string pra Date, mesmo que
      // atualizar-demandas-lab-online.js grava. 'concluido' já vem null.
      if (textos[6]) {
        for (var iL = 0; iL < textos[6].length; iL++) {
          var pend = textos[6][iL];
          ensaiosLidos.push({
            sup: pend.sup, tipologia: pend.tipologia, concluido: null,
            criacao: pend.criacao ? new Date(pend.criacao) : null,
          });
        }
      }

      var furos = ComputeDemandas.redirecionarSupsDesconhecidos(furosLidos, registrosNovos).itens;
      var ensaios = ComputeDemandas.redirecionarSupsDesconhecidos(ensaiosLidos, registrosNovos).itens;

      // Falha alto em vez de reportar sucesso vazio: se vieram furos mas NENHUM
      // deles tem uma única data legível, o formato de data do espelho mudou de
      // um jeito que nem o serial nem o fallback dd/MM/yyyy de dataSaneada
      // reconhecem -- e computeDemandas devolveria zeros em todas as séries com
      // o status dizendo "Atualizado". Erro antes de qualquer atribuição, pra
      // manter a atomicidade tudo-ou-nada.
      var algumaData = furos.some(function (f) { return f.criacaoOS || f.executadoDia; });
      if (furos.length > 0 && !algumaData) {
        throw new Error('nenhuma data legível encontrada nos furos do espelho de Avanços -- confira se o formato de data mudou (serial vs texto)');
      }

      demandasNovas = ComputeDemandas.computeDemandas(furos, periodosDoAnoSemanal(), ensaios);
      // Mesma agregação que o build faz (build-dashboard.js), sobre os MESMOS
      // furos já redirecionados -- sem isso o refresh atualizaria volume e
      // financeiro do Balanço e deixaria o Δ equipes preso ao dado do build.
      // equipesPorDia (Realizado) só vem do bloco REALIZADO (Link 6+7,
      // logo abaixo) desde 2026-08-21 -- sem cascata de mobilizadas/ATIVAS
      // mais. equipesPeriodo (cobertura do Realizado, lida por
      // compute-balanco.js) fica null até o bloco REALIZADO decidir; sem
      // Link 6+7 utilizável, o refresh preserva o que já estava em
      // window.__DEMANDAS__ (mesmo padrão dos outros campos opcionais deste
      // Promise.all -- nunca apaga dado bom por falha de uma fonte só).
      demandasNovas.equipesPorDia = window.__DEMANDAS__.equipesPorDia;
      demandasNovas.equipesPeriodo = window.__DEMANDAS__.equipesPeriodo;

      // Equipes ATIVAS (Sheet espelho da aba EQ): mesma montagem que o build
      // faz (build-dashboard.js, montarEquipesAtivas), sobre os MESMOS furos
      // já redirecionados. Alimenta só equipesCsv/osParaSup/
      // equipesRosterPeriodo (consumidos pela aba Alocação Equipes) --
      // NUNCA mais o Realizado da Tabela Semanal (equipesPorDia), que é
      // exclusividade do bloco REALIZADO abaixo desde 2026-08-21.
      var csvEq = textos[3];
      var periodoEq = csvEq ? ComputeEquipesAtivas.mesDaAbaEq(csvEq) : null;
      // A aba Alocação Equipes recomputa o roster a partir deste CSV a cada
      // troca de semana -- sem atualizá-lo aqui, o quadro continuaria
      // mostrando o roster do momento do build depois de um "Atualizar
      // dados".
      // Ao contrário de montarEquipesAtivas (build-dashboard.js, que roda no
      // build e não tem valor anterior pra preservar), aqui PRESERVA o que já
      // estava em window.__DEMANDAS__ por padrão -- mesma simetria de
      // equipesPorDia/equipesPeriodo acima: esta é a ÚNICA página que consome
      // estes 3 campos, e escrever null zeraria a grade inteira de Alocação
      // com o status mostrando "Atualizado" em verde caso a Sheet EQ falhe
      // (csvEq null). Só sobrescreve com o dado novo dentro do bloco
      // if (periodoEq) abaixo.
      demandasNovas.equipesCsv = window.__DEMANDAS__.equipesCsv;
      // osParaSup segue a mesma regra de preservação.
      demandasNovas.osParaSup = window.__DEMANDAS__.osParaSup;
      // equipesRosterPeriodo (2026-08-21): cobertura da Sheet EQ, separada
      // de equipesPeriodo (cobertura do Realizado/Link 6+7) -- ver o
      // comentário longo em build-dashboard.js sobre por que os dois campos
      // não podem mais compartilhar o mesmo nome. Preservado pela mesma regra
      // acima.
      demandasNovas.equipesRosterPeriodo = window.__DEMANDAS__.equipesRosterPeriodo;

      // osParaSup: só depende de 'furos', usado pela aba Alocação Equipes
      // (equipesDoQuadro resolve supRealizado/colunaRealizada a partir dele).
      // 'var' fora do if (periodoEq) de propósito (escopo de FUNÇÃO): com
      // periodoEq falso ele ainda precisa existir para a atribuição
      // condicional abaixo não lançar ReferenceError.
      //
      // tipologiaPorSondador/agregarEquipesAtivas (que só serviam pra montar
      // equipesPorDia a partir da Sheet ATIVAS) saíram em 2026-08-21 --
      // equipesPorDia é exclusividade do bloco REALIZADO (Link 6+7) agora, e
      // a Sheet ATIVAS só alimenta equipesCsv/equipesRosterPeriodo/
      // osParaSup pra Alocação (ver comentário acima da declaração de csvEq).
      var osParaSup = {};
      furos.forEach(function (f) {
        if (f.os && f.sup && !osParaSup[f.os]) osParaSup[f.os] = f.sup;
      });

      if (periodoEq) {
        demandasNovas.equipesRosterPeriodo = periodoEq;
        demandasNovas.equipesCsv = csvEq;
        demandasNovas.osParaSup = osParaSup;
      }

      // Δ equipes REALIZADO (2026-08-10, recuperado e reintegrado em
      // 2026-08-11 depois de um git reset --hard ter descartado esta branch
      // -- ver docs/superpowers/specs/2026-08-10-equipes-realizado-roster-link6-link7-design.md
      // e docs/superpowers/plans/2026-08-10-equipes-realizado-roster-link6-link7.md).
      // Única fonte de equipesPorDia (Realizado) desde 2026-08-21 -- se
      // roster (textos[7]) + produção (textos[4]) não responderem ou o
      // cruzamento não produzir nenhum par utilizável, equipesPorDia/
      // equipesPeriodo ficam com o valor já preservado de window.__DEMANDAS__
      // (setado logo no início deste bloco 'if (avancosLabConfigurados)'),
      // nunca uma fonte alternativa. Substitui o bloco de equipes FRACIONADAS
      // (2026-08-08): o CSV de produção deixou de vir pré-agregado
      // ("SUP,Tipo,DiaEpoch,Fracao") -- agora é CRU ("IdEquipe,SUP,Tipo,
      // DiaEpoch") e precisa ser cruzado com o roster aqui, via
      // ComputeEquipesRealizadoAlocado.agregarEquipesRealizadoAlocado
      // (carry-forward de 45 dias) -- MESMA função pura que
      // build-dashboard.js (montarEquipesRealizado) chama; os dois caminhos
      // nunca podem divergir sobre o número.
      if (textos[4] && textos[7]) {
        var rosterOnlineCliente = [];
        textos[7].trim().split('\\n').slice(1).forEach(function (linha) {
          if (!linha) return;
          var p = linha.split(',');
          var d = Number(p[1]);
          if (!isFinite(d)) return;
          rosterOnlineCliente.push({ idEquipe: p[0], diaEpoch: d, estado: p[2] });
        });
        var producaoOnlineCliente = [];
        textos[4].trim().split('\\n').slice(1).forEach(function (linha) {
          if (!linha) return;
          var p2 = linha.split(',');
          var d2 = Number(p2[3]);
          if (!isFinite(d2)) return;
          producaoOnlineCliente.push({ idEquipe: p2[0], sup: p2[1], tipo: p2[2], diaEpoch: d2 });
        });
        var resultadoRealizadoCliente = ComputeEquipesRealizadoAlocado.agregarEquipesRealizadoAlocado({
          roster: rosterOnlineCliente, producao: producaoOnlineCliente,
        });
        if (Object.keys(resultadoRealizadoCliente.porDia).length) {
          // MESMO redirecionamento que furos/ensaios levam nas duas linhas do
          // topo deste bloco: par (contrato, tipologia) que a MATRIZ não
          // conhece vira "Diversos" em vez de sumir do Δ equipes -- e
          // REALIZADO é a fonte PRIMÁRIA dele. Ver o gêmeo em
          // build-dashboard.js (montarEquipesRealizado). resolverSup
          // construída UMA VEZ fora do loop, mesmo achado da revisão final
          // de branch, 2026-08-08.
          var resolverSupRealizado = ComputeDemandas.resolverSupConhecido(registrosNovos);
          var porDiaRealizadoCliente = {};
          Object.keys(resultadoRealizadoCliente.porDia).forEach(function (chave) {
            var partes = chave.split('||');
            var chaveResolvida = resolverSupRealizado(partes[0], partes[1]) + '||' + partes[1];
            if (!porDiaRealizadoCliente[chaveResolvida]) porDiaRealizadoCliente[chaveResolvida] = {};
            var mapaDia = resultadoRealizadoCliente.porDia[chave];
            Object.keys(mapaDia).forEach(function (dia) {
              porDiaRealizadoCliente[chaveResolvida][dia] = (porDiaRealizadoCliente[chaveResolvida][dia] || 0) + mapaDia[dia];
            });
          });
          demandasNovas.equipesPorDia = porDiaRealizadoCliente;
          // Roster cobre múltiplos meses (backfill anual) -- declarar um mês
          // só aqui apagaria o Δ equipes de todos os outros, mesma regra que
          // build-dashboard.js (montarEquipesRealizado) já documenta.
          demandasNovas.equipesPeriodo = null;
        }
      }

      // Equipes NÃO produtivas (2026-08-05): reusa o MESMO csvEq/periodoEq já
      // obtidos acima para ativas -- nenhuma busca nova. Informação separada,
      // nunca somada em equipesPorDia.
      if (csvEq && periodoEq) {
        demandasNovas.equipesNaoProdutivas = ComputeEquipesNaoProdutivas.agregarEquipesNaoProdutivas({
          equipes: ComputeEquipesAtivas.parseAbaEq(csvEq), ano: periodoEq.ano, mes: periodoEq.mes,
        }).porDiaPorMotivo;
      }
    }

    window.__REGISTROS__ = registrosNovos;
    window.__DEMANDAS__ = demandasNovas;
    montarTodosFiltrosMultiSemanal(window.__REGISTROS__);
    montarAbaAlocacao();

    var agora = new Date();
    var horario = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    var statusTexto = avancosLabConfigurados
      ? 'Atualizado às ' + horario
      : 'Atualizado (só MATRIZ) às ' + horario + ' -- Avanços/Lab pendente de configuração do Apps Script';
    definirStatusAtualizacaoSemanal(statusTexto, false);
  }).catch(function (erro) {
    definirStatusAtualizacaoSemanal('Falha ao atualizar: ' + erro.message, true);
  });
}

document.getElementById('atualizar-dashboard').addEventListener('click', atualizarDadosAoVivoSemanal);

// Wireup incondicional, no load do script -- #secao-alocacao já existe no
// HTML estático (ver renderAlocacaoPagina), e o listener delegado não depende
// de senha nem de a aba já ter sido desenhada.
inicializarInteracaoAlocacao();
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
