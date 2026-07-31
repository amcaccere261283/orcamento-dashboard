'use strict';
const { calcularLinhas, ordenarPorDesvio } = require('./compute-balanco.js');

// Este módulo roda tanto no Node (testes) quanto embrulhado no navegador via
// buildBrowserBundle -- por isso 'var'/'function', não 'const'/arrow (mesmo
// aviso em render-aba-semanal.js), e o require acima na forma EXATA que a
// reescrita de tools/comum/browser-bundle.js reconhece (mesmo diretório,
// './arquivo.js').
//
// compute-balanco.js, por sua vez, requer '../comum/calculo-equipes.js' --
// esse require É REMOVIDO pelo bundle (browser-bundle.js só reescreve
// './arquivo.js' do MESMO diretório; '../' é removido, não resolvido). Quem
// monta a página (render-semanal.js) precisa ter injetado fonteParaCliente()
// (mediaEquipesPonderada como global) num <script> ANTES do bundle que
// contém compute-balanco.js, senão calcularLinhas() quebra com
// ReferenceError assim que roda no navegador -- ver o mesmo aviso no topo
// de compute-balanco.js e a prova em
// test/semanal-render-aba-balanco-wireup.test.js.

// Gráfico Balanço de massa: barras divergentes, um gráfico por tipologia,
// uma linha por SUP. Privacidade: SUP e tipologia SÃO renderizados neste
// SVG -- não é um vazamento porque este módulo só roda no navegador, DEPOIS
// da decifragem (nunca durante o build de render-semanal.js) -- mesmo
// contrato que render-aba-semanal.js já segue para SUP/Tomador.

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Mesmo formatador de render-aba-semanal.js / render-dashboard.js (orçamento):
// '—' pra ausência de valor, N casas decimais (default 2).
function formatarNumero(v, casasDecimais) {
  if (v === null || v === undefined) return '—';
  var casas = casasDecimais === undefined ? 2 : casasDecimais;
  var fator = Math.pow(10, casas);
  return (Math.round(v * fator) / fator).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

// id de <pattern> só pode ter [A-Za-z0-9_-] -- tipologia pode trazer espaço,
// acento etc. Não precisa ser reversível, só estável e sem colisão entre
// gráficos da MESMA página (cada tipologia aparece uma vez só).
function slug(texto) {
  return String(texto || '').replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase();
}

// Uma escala POR SÉRIE, não uma régua comum. Equipes andam em unidades e
// volume em centenas ou milhares; numa régua só, 10 equipes ao lado de 100
// de volume viraria um traço de 1 pixel. Cada série usa toda a largura
// disponível, então os comprimentos são comparáveis DENTRO da série e
// nunca entre séries -- por isso os rótulos numéricos são obrigatórios.
function escalaIndependente(valores, larguraMax) {
  var maximo = 0;
  for (var i = 0; i < valores.length; i++) {
    var v = Math.abs(valores[i] || 0);
    if (v > maximo) maximo = v;
  }
  if (!maximo) return function () { return 0; };
  return function (valor) { return Math.abs(valor || 0) / maximo * larguraMax; };
}

var LARGURA_SVG = 900;
var CENTRO_X = 460;
var LARGURA_BARRA_MAX = 280;
var ALTURA_CABECALHO = 36;
var ALTURA_LINHA = 46;
var ALTURA_RODAPE = 14;

var COR_ACIMA = '#7fd858';   // mesmo verde de .linha-realizado no orçamento
var COR_ABAIXO = '#e0684f';  // mesmo vermelho de .status-erro
var COR_EQUIPES = '#f6b53f'; // mesmo laranja/dourado do resto da UI
var COR_TEXTO_SECUNDARIO = '#c3c2b7';
var COR_TEXTO = '#ffffff';
var COR_EIXO = '#2c2c2a';
var COR_DIVISORIA = 'rgba(255,255,255,0.10)'; // mesmo valor de --border em cssBase()

// tipologia: string (cabeçalho do gráfico). linhas: array no formato que
// calcularLinhas() (compute-balanco.js) produz -- consumido diretamente,
// não reimplementado. opcoes.somenteAtivos: default true (mesmo default da
// aba -- ver comentário no topo de render-semanal.js sobre a grade densa:
// sem o filtro, toda tipologia mostraria 34 SUPs, a maioria com barra de
// comprimento zero).
function renderGraficoTipologia(tipologia, linhas, opcoes) {
  var opts = opcoes || {};
  var somenteAtivos = opts.somenteAtivos === undefined ? true : opts.somenteAtivos;

  var linhasFiltradas = (linhas || []).filter(function (linha) {
    return somenteAtivos ? !!linha.ativo : true;
  });
  var linhasOrdenadas = ordenarPorDesvio(linhasFiltradas);

  // Cada série (valor principal / equipes) normaliza pelo PRÓPRIO maior
  // valor absoluto -- linhas semBase não têm desvio numérico e não entram
  // no cálculo do teto (ficam de fora da conta, não viram zero espúrio
  // porque o filtro abaixo as ignora de qualquer forma).
  var desvios = linhasOrdenadas.filter(function (l) { return !l.semBase; }).map(function (l) { return l.desvio || 0; });
  var desviosEquipes = linhasOrdenadas.filter(function (l) { return !l.semBase; }).map(function (l) { return l.desvioEquipes || 0; });
  var escalaValor = escalaIndependente(desvios, LARGURA_BARRA_MAX);
  var escalaEquipes = escalaIndependente(desviosEquipes, LARGURA_BARRA_MAX);

  var altura = ALTURA_CABECALHO + Math.max(linhasOrdenadas.length, 1) * ALTURA_LINHA + ALTURA_RODAPE;
  var patternId = 'hachura-equipes-' + slug(tipologia);

  // 'grafico-svg' é a classe que cssBase() (casca compartilhada com o
  // orçamento) já estiliza (width:100%; height:auto; display:block;) --
  // reaproveitada aqui de propósito, em vez de duplicar a regra numa folha
  // à parte. 'grafico-balanco' é só o gancho específico deste gráfico
  // (nenhuma regra própria hoje).
  var svg = '<svg class="grafico-svg grafico-balanco" viewBox="0 0 ' + LARGURA_SVG + ' ' + altura + '" width="100%" height="' + altura + '" role="img" aria-label="Balanço de massa -- ' + escapeHtml(tipologia) + '">';

  svg += '<defs><pattern id="' + patternId + '" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">'
    + '<rect width="6" height="6" fill="' + COR_EQUIPES + '"></rect>'
    + '<line x1="0" y1="0" x2="0" y2="6" stroke="#000000" stroke-opacity="0.35" stroke-width="2"></line>'
    + '</pattern></defs>';

  svg += '<text x="' + CENTRO_X + '" y="20" text-anchor="middle" fill="' + COR_TEXTO + '" font-size="13" font-weight="600">' + escapeHtml(tipologia) + '</text>';
  svg += '<line x1="' + CENTRO_X + '" y1="' + ALTURA_CABECALHO + '" x2="' + CENTRO_X + '" y2="' + (altura - ALTURA_RODAPE) + '" stroke="' + COR_EIXO + '" stroke-width="1"></line>';

  if (!linhasOrdenadas.length) {
    svg += '<text x="' + CENTRO_X + '" y="' + (ALTURA_CABECALHO + ALTURA_LINHA / 2) + '" text-anchor="middle" fill="' + COR_TEXTO_SECUNDARIO + '" font-size="12">nenhum SUP ativo neste período</text>';
    svg += '</svg>';
    return svg;
  }

  linhasOrdenadas.forEach(function (linha, i) {
    var y = ALTURA_CABECALHO + i * ALTURA_LINHA + ALTURA_LINHA / 2;

    // Divisória entre linhas -- nunca antes da primeira (o eixo/cabeçalho já
    // marca esse limite). Facilita a leitura com muitos SUPs na tela.
    if (i > 0) {
      var yDivisoria = ALTURA_CABECALHO + i * ALTURA_LINHA;
      svg += '<line x1="0" y1="' + yDivisoria + '" x2="' + LARGURA_SVG + '" y2="' + yDivisoria + '" stroke="' + COR_DIVISORIA + '" stroke-width="1"></line>';
    }

    // Fonte menor (era 12) pra caber o Tomador na mesma linha sem espremer.
    // <tspan> em vez de escapeHtml simples porque SUP e Tomador têm cores
    // diferentes (SUP em destaque, Tomador em cor secundária) dentro do
    // MESMO <text> -- é assim que SVG mistura estilo numa linha só.
    // "Facilita a leitura quando o filtro estiver sem SUP específico
    // selecionado" (dono do projeto) -- com muitas linhas visíveis de uma
    // vez, o tomador ajuda a identificar rápido de quem é cada uma.
    svg += '<text x="8" y="' + (y + 4) + '" font-size="11">'
      + '<tspan fill="' + COR_TEXTO + '">' + escapeHtml(linha.sup) + '</tspan>'
      + (linha.tomador ? '<tspan fill="' + COR_TEXTO_SECUNDARIO + '"> — ' + escapeHtml(linha.tomador) + '</tspan>' : '')
      + '</text>';

    if (linha.semBase) {
      // "Não havia base" e "o realizado bateu a base" são opostos -- por
      // isso NENHUMA barra é desenhada aqui, só o rótulo "sem base" preso à
      // linha central, em vez de um desvio 0 que pareceria "bateu certinho".
      svg += '<text x="' + CENTRO_X + '" y="' + (y + 4) + '" text-anchor="middle" fill="' + COR_TEXTO_SECUNDARIO + '" font-size="11" font-style="italic">sem base</text>';
      return;
    }

    // Rótulo da base, junto à linha central -- sempre aparece a partir daqui
    // (linha.semBase já teria retornado acima; valorBase existe).
    svg += '<text x="' + CENTRO_X + '" y="' + (y - 12) + '" text-anchor="middle" fill="' + COR_TEXTO_SECUNDARIO + '" font-size="10">' + formatarNumero(linha.valorBase, 0) + '</text>';

    if (linha.desvio === null) {
      // Mesmo cuidado que "sem base" (linha.semBase acima), mas pro outro
      // lado do desvio: havia base, mas o Realizado ainda não existe --
      // "não lançado" e "bateu exatamente a base" são coisas opostas que
      // apareceriam idênticas se ambas virassem uma barra de comprimento
      // zero. Acontece pra Acumulado até o mês quando a coluna Realizado da
      // MATRIZ está em branco pro período (achado de 2026-08-01; Mês
      // Vigente não cai mais aqui, ver realizadoDoAvancos em
      // compute-balanco.js -- furos reais nunca são "sem dado", só zero).
      svg += '<text x="' + CENTRO_X + '" y="' + (y + 4) + '" text-anchor="middle" fill="' + COR_TEXTO_SECUNDARIO + '" font-size="11" font-style="italic">Realizado não lançado</text>';
    } else {
      var desvio = linha.desvio;
      var comprimento = escalaValor(desvio);
      var paraDireita = desvio >= 0;
      var classeCor = paraDireita ? 'barra-acima' : 'barra-abaixo';
      var cor = paraDireita ? COR_ACIMA : COR_ABAIXO;
      var xBarra = paraDireita ? CENTRO_X : CENTRO_X - comprimento;

      svg += '<rect class="' + classeCor + '" x="' + xBarra + '" y="' + (y - 9) + '" width="' + comprimento + '" height="18" fill="' + cor + '"></rect>';

      // Rótulo do realizado, na ponta da barra.
      var xPonta = paraDireita ? (CENTRO_X + comprimento + 6) : (CENTRO_X - comprimento - 6);
      var ancoraPonta = paraDireita ? 'start' : 'end';
      svg += '<text x="' + xPonta + '" y="' + (y + 4) + '" text-anchor="' + ancoraPonta + '" fill="' + COR_TEXTO + '" font-size="11" font-weight="600">' + formatarNumero(linha.valorRealizado, 0) + '</text>';
    }

    // Barra de equipes: SEMPRE lida da MATRIZ (Avanço Sond não rastreia
    // equipes por furo -- ver compute-balanco.js), então pode ficar "sem
    // dado" mesmo quando o desvio principal (acima) já tem valor. Mesmo
    // cuidado: null não vira barra de comprimento zero, só não desenha.
    if (linha.desvioEquipes !== null) {
      var desvioEq = linha.desvioEquipes;
      var comprimentoEq = escalaEquipes(desvioEq);
      var paraDireitaEq = desvioEq >= 0;
      var xEq = paraDireitaEq ? CENTRO_X : CENTRO_X - comprimentoEq;

      svg += '<rect class="barra-equipes" x="' + xEq + '" y="' + (y - 5) + '" width="' + comprimentoEq + '" height="10" fill="url(#' + patternId + ')" stroke="' + COR_EQUIPES + '" stroke-width="0.5"></rect>';

      // Rótulo das equipes, em laranja, na ponta da barra de equipes.
      var xPontaEq = paraDireitaEq ? (CENTRO_X + comprimentoEq + 6) : (CENTRO_X - comprimentoEq - 6);
      var ancoraEq = paraDireitaEq ? 'start' : 'end';
      var sinalEq = desvioEq > 0 ? '+' : '';
      svg += '<text x="' + xPontaEq + '" y="' + (y + 15) + '" text-anchor="' + ancoraEq + '" fill="' + COR_EQUIPES + '" font-size="10">' + sinalEq + formatarNumero(desvioEq, 1) + ' eq.</text>';
    }
  });

  svg += '</svg>';
  return svg;
}

// Junta as tipologias distintas presentes em 'indices', na ordem em que
// aparecem pela primeira vez -- não ordena alfabético nem por volume, só
// deduplica.
function listarTipologias(registros, indices) {
  var vistos = {};
  var lista = [];
  (indices || []).forEach(function (i) {
    var registro = registros[i];
    var tipologia = registro && registro.tipologia;
    if (!tipologia || vistos[tipologia]) return;
    vistos[tipologia] = true;
    lista.push(tipologia);
  });
  return lista;
}

// Controles da aba: período, base, dimensão e o check "somente SUPs ativos
// no período" (ligado por padrão). Puro markup -- quem liga o comportamento
// (recalcular e redesenhar ao trocar) é o JS de cliente em render-semanal.js
// (SCRIPT_CLIENTE_SEMANAL), pelos ids abaixo.
function renderControles(estado) {
  var e = estado || {};
  var periodo = e.periodo || 'mesVigente';
  var base = e.base || 'previsto';
  var dimensao = e.dimensao || 'financeiro';
  var somenteAtivos = e.somenteAtivos === undefined ? true : e.somenteAtivos;

  function opcao(valor, rotulo, atual) {
    return '<option value="' + valor + '"' + (valor === atual ? ' selected' : '') + '>' + escapeHtml(rotulo) + '</option>';
  }

  var html = '<div class="controles-balanco">';
  html += '<label class="controle-balanco">Período'
    + '<select id="balanco-periodo">'
    + opcao('mesVigente', 'Mês vigente', periodo)
    + opcao('acumuladoAteMes', 'Acumulado até o mês', periodo)
    + '</select></label>';
  html += '<label class="controle-balanco">Base'
    + '<select id="balanco-base">'
    + opcao('previsto', 'Previsto', base)
    + opcao('previstoInicial', 'Previsto Inicial', base)
    + '</select></label>';
  html += '<label class="controle-balanco">Dimensão'
    + '<select id="balanco-dimensao">'
    + opcao('financeiro', 'Financeiro', dimensao)
    + opcao('volume', 'Volumetria', dimensao)
    + '</select></label>';
  html += '<label class="controle-balanco controle-balanco-check">'
    + '<input type="checkbox" id="balanco-somente-ativos"' + (somenteAtivos ? ' checked' : '') + '>'
    + ' Somente SUPs ativos no período</label>';
  html += '</div>';
  return html;
}

// Monta a aba inteira: controles + um <div class="grafico-painel"> por
// tipologia presente em 'indices'. registros/indices: mesmo par que o resto
// do projeto usa (registros: array completo da MATRIZ; indices: quais
// entram). opcoes: { periodo, base, dimensao, somenteAtivos, vigenteIdx,
// baseline, demandas, ano } -- os 4 primeiros têm default (mesmos da aba:
// mês vigente, Previsto, financeiro, somente ativos ligado); vigenteIdx e
// baseline não têm default sensato e vêm de quem chama (render-semanal.js).
// demandas/ano (opcionais, achado de 2026-08-01): ativam o Realizado do
// Avanço Sond só pra Mês Vigente -- ver o comentário de calcularLinhas em
// compute-balanco.js.
function renderAbaBalanco(registros, indices, opcoes) {
  var opts = opcoes || {};
  var periodo = opts.periodo || 'mesVigente';
  var base = opts.base || 'previsto';
  var dimensao = opts.dimensao || 'financeiro';
  var somenteAtivos = opts.somenteAtivos === undefined ? true : opts.somenteAtivos;
  var vigenteIdx = opts.vigenteIdx;
  var baseline = opts.baseline || [];
  var demandas = opts.demandas;
  var ano = opts.ano;

  var tipologias = listarTipologias(registros, indices);

  var graficos = tipologias.map(function (tipologia) {
    var linhas = calcularLinhas({
      registros: registros, indices: indices, tipologia: tipologia,
      base: base, dimensao: dimensao, periodo: periodo,
      vigenteIdx: vigenteIdx, baseline: baseline, demandas: demandas, ano: ano,
    });
    return '<div class="grafico-painel">' + renderGraficoTipologia(tipologia, linhas, { somenteAtivos: somenteAtivos }) + '</div>';
  }).join('');

  return renderControles({ periodo: periodo, base: base, dimensao: dimensao, somenteAtivos: somenteAtivos })
    + '<div class="graficos-balanco">' + graficos + '</div>';
}

module.exports = { renderGraficoTipologia, escalaIndependente, renderAbaBalanco, renderControles, listarTipologias };
