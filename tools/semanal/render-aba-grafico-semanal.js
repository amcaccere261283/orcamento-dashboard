'use strict';
const { semanasDoMes, indiceSemanaAtual } = require('./compute-semanal.js');
const { calcularSeriesSemanaisDimensao, formatarIntervaloSemana } = require('./render-aba-semanal.js');
const { calcularAcumulado, calcularEscalaEixo, GRAFICO_NUM_TICKS } = require('./compute-grafico-semanal.js');

// Este módulo roda tanto no Node (testes) quanto embrulhado no navegador via
// buildBrowserBundle -- por isso 'var'/'function', não 'const'/arrow, e os
// requires acima na forma EXATA que a reescrita de tools/comum/browser-bundle.js
// reconhece (mesmo diretório, './arquivo.js' -- ver o mesmo aviso em
// render-aba-semanal.js/render-aba-balanco.js).
//
// Aba Gráficos: gráfico de barras (Previsto/Realizado/Tendência por semana)
// + curva S (acumulado no mês), um par por dimensão marcada -- MESMOS dois
// tipos de gráfico do Dashboard Orçamento (tools/orcamento/render-dashboard.js),
// portados aqui com o eixo X trocado de "12 meses do ano" pra "N semanas do
// mês vigente" (5 ou 6, nunca 4 -- ver compute-semanal.js). Não é uma fonte
// de dado própria: os números vêm de calcularSeriesSemanaisDimensao
// (render-aba-semanal.js), a MESMA função que a Tabela Semanal usa pra
// preencher as linhas Previsto/Realizado/Tendência -- os dois nunca podem
// divergir sobre "o que a semana tal produziu".
//
// Simplificações reais em relação ao orçamento (não são "menos completo",
// são porque a origem do dado semanal não tem os mesmos problemas que a
// origem mensal tem):
// - Sem Previsto Inicial nem "Realizado + Previsto Inicial": esse
//   comparativo já existe na aba Balanço de Massa desta mesma página
//   (compute-balanco.js), que trabalha por SUP -- duplicar aqui, agregado,
//   ficaria redundante. Só Previsto/Realizado/Tendência.
// - Sem "conector"/"zeros finais não reportados"/"acumulado que não
//   recomeça do zero": esses cuidados existem no orçamento porque a coluna
//   Realizado da MATRIZ é lançada manualmente, mês a mês, e fica com
//   lacunas no meio do ano até ser preenchida. As séries semanais
//   (calcularSeriesSemanaisDimensao) nunca têm essa lacuna no meio -- ou a
//   série inteira tem dado (todas as N semanas), ou nenhuma tem (mesma
//   regra de sempre: sem mês vigente válido ou sem demandas).
// - Sem dimensões-razão (Produtividade/Ticket médio): a barra de filtros da
//   semanal não expõe essas duas (ver DIMENSOES_ROTULO_SEMANAL em
//   render-aba-semanal.js), então o Gráfico também não precisa.
// - Sem filtro de série (checkbox previsto/realizado/tendência): a Tabela
//   Semanal já mostra as 3 sempre juntas, sem opção de esconder -- o
//   Gráfico segue o mesmo comportamento, por consistência dentro da mesma
//   aba.

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Mesmo formatador do resto do projeto (render-aba-semanal.js/
// render-aba-balanco.js/orçamento): 2 casas por padrão, '—' pra ausência.
// Só usado no tooltip (valor exato) -- o rótulo/eixo usa formatarValorGrafico,
// que pode arredondar pra milhares.
function formatarNumero(v, casasDecimais) {
  if (v === null || v === undefined) return '—';
  var casas = casasDecimais === undefined ? 2 : casasDecimais;
  var fator = Math.pow(10, casas);
  return (Math.round(v * fator) / fator).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

// Mesmo mapa de render-aba-semanal.js, duplicado de propósito (módulo
// bundlado no navegador -- mesmo motivo já documentado em chaveDemandas/
// chaveBaseline).
var DIMENSOES_ROTULO_SEMANAL = { equipes: 'Equipes', volume: 'Volume', financeiro: 'Financeiro' };

// Mesmas cores/tracejados do orçamento pras 3 séries que sobrevivem aqui --
// são as MESMAS cores que .linha-previsto/.linha-realizado (cssBase(),
// tools/comum/render-shell.js) e .linha-tendencia (CSS_SEMANAL,
// render-semanal.js) já usam nas linhas da Tabela Semanal: a cor de
// "Previsto" tem que ser a mesma em toda a página, tabela ou gráfico.
var SERIE_COR = { previsto: '#2f6ad0', realizado: '#7fd858', tendencia: '#f6b53f' };
var SERIE_TRACEJADO = { previsto: '', realizado: '1,5', tendencia: '9,5' };
var SERIE_LABELS = { previsto: 'Previsto', realizado: 'Realizado', tendencia: 'Tendência' };
var ORDEM_SERIES_GRAFICO = ['previsto', 'realizado', 'tendencia'];

var GRAFICO_LARGURA = 1000;
var GRAFICO_ALTURA_BARRAS = 320;
var GRAFICO_ALTURA_LINHA = 280;
var GRAFICO_MARGEM_BARRAS = { topo: 36, baixo: 36, esquerda: 68, direita: 28 };
var GRAFICO_MARGEM_LINHA = { topo: 36, baixo: 36, esquerda: 68, direita: 36 };
var GRAFICO_BARRA_MAX = 24;
var GRAFICO_BARRA_GAP = 2;
var GRAFICO_LIMIAR_MILHARES = 1000;

function escalaLinear(valor, valorMax, pixelMax) {
  if (!valorMax) return 0;
  return (valor / valorMax) * pixelMax;
}

// Formata um valor pro que aparece NO gráfico (eixo, rótulo de coluna/linha)
// -- em milhares quando o recorte é grande o bastante. O tooltip usa
// formatarNumero puro (valor exato), nunca esta função.
function formatarValorGrafico(valor, usarMilhares, casasDecimais) {
  if (valor === null || valor === undefined) return '—';
  var base = usarMilhares ? valor / 1000 : valor;
  var casas = casasDecimais === undefined ? 2 : casasDecimais;
  var fator = Math.pow(10, casas);
  return (Math.round(base * fator) / fator).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

// Rótulo curto do eixo X ("S1") -- o intervalo de datas completo (usado no
// tooltip) vem de formatarIntervaloSemana (render-aba-semanal.js), a MESMA
// função que o cabeçalho da Tabela Semanal já usa ("S1 (01/07 a 05/07)").
function rotuloSemanaCurto(i) { return 'S' + (i + 1); }
function rotuloSemanaTooltip(i, semanas) {
  var semana = semanas && semanas[i];
  return semana ? (rotuloSemanaCurto(i) + ' (' + formatarIntervaloSemana(semana.inicio, semana.fim) + ')') : rotuloSemanaCurto(i);
}

function construirEixoXSvg(larguraSemana, alturaPlot, margem, numSemanas) {
  var svg = '';
  for (var i = 0; i < numSemanas; i++) {
    var x = margem.esquerda + i * larguraSemana + larguraSemana / 2;
    var y = margem.topo + alturaPlot + 20;
    svg += '<text class="grafico-eixo-texto" x="' + x.toFixed(1) + '" y="' + y + '" text-anchor="middle">' + rotuloSemanaCurto(i) + '</text>';
  }
  return svg;
}

// Sem 'ladoDireita' (o orçamento tem esse parâmetro, mas só pra reservar
// espaço -- comentário lá mesmo confirma que não existe mais um 2º eixo do
// lado direito, ver GRAFICO_MARGEM_BARRAS): aqui nunca teve, não precisa.
function construirEixoYSvg(escala, alturaPlot, margem, usarMilhares, casasDecimais) {
  var svg = '';
  for (var i = 0; i <= GRAFICO_NUM_TICKS; i++) {
    var valor = i * escala.passo;
    var y = margem.topo + alturaPlot - (valor / escala.max) * alturaPlot;
    var x = margem.esquerda - 10;
    svg += '<text class="grafico-eixo-texto" x="' + x + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end">' + formatarValorGrafico(valor, usarMilhares, casasDecimais) + '</text>';
    svg += '<line class="grafico-gridline" x1="' + margem.esquerda + '" y1="' + y.toFixed(1) + '" x2="' + (GRAFICO_LARGURA - margem.direita) + '" y2="' + y.toFixed(1) + '"/>';
  }
  return svg;
}

// Legenda só entra com 2+ séries -- com Equipes (só Previsto) o título do
// painel já diz o que é.
function construirLegendaSvg(dadosPorSerie, margem) {
  if (dadosPorSerie.length < 2) return '';
  var svg = '';
  var y = 14;
  dadosPorSerie.forEach(function (d, i) {
    var x = margem.esquerda + i * 140;
    var traco = SERIE_TRACEJADO[d.serie] ? ' stroke-dasharray="' + SERIE_TRACEJADO[d.serie] + '"' : '';
    svg += '<line x1="' + x + '" y1="' + y + '" x2="' + (x + 20) + '" y2="' + y + '" stroke="' + SERIE_COR[d.serie] + '" stroke-width="3" stroke-linecap="round"' + traco + '/>';
    svg += '<text class="grafico-eixo-texto" x="' + (x + 28) + '" y="' + (y + 4) + '" text-anchor="start">' + SERIE_LABELS[d.serie] + '</text>';
  });
  return svg;
}

// Barra com topo arredondado (4px) e base quadrada -- mesma função do
// orçamento, sem nenhuma mudança (não depende de mês/semana).
function desenharBarraArredondada(x, y, w, h, cor) {
  if (h <= 0) return '';
  var r = Math.min(4, w / 2, h);
  var d = 'M' + x.toFixed(1) + ',' + (y + h).toFixed(1) +
    ' L' + x.toFixed(1) + ',' + (y + r).toFixed(1) +
    ' Q' + x.toFixed(1) + ',' + y.toFixed(1) + ' ' + (x + r).toFixed(1) + ',' + y.toFixed(1) +
    ' L' + (x + w - r).toFixed(1) + ',' + y.toFixed(1) +
    ' Q' + (x + w).toFixed(1) + ',' + y.toFixed(1) + ' ' + (x + w).toFixed(1) + ',' + (y + r).toFixed(1) +
    ' L' + (x + w).toFixed(1) + ',' + (y + h).toFixed(1) + ' Z';
  return '<path class="grafico-barra" d="' + d + '" fill="' + cor + '"/>';
}

// Empurra rótulos que colidem pra baixo do que colidiram -- mesma função do
// orçamento, sem nenhuma mudança (só geometria de texto).
function resolverColisoesRotulos(rotulos) {
  rotulos.sort(function (a, b) { return a.y - b.y; });
  var posicionados = [];
  rotulos.forEach(function (r) {
    var largura = r.texto.length * 6.5 + 6;
    var y = r.y;
    var tentativas = 0;
    var colidiu = true;
    while (colidiu && tentativas < 60) {
      colidiu = posicionados.some(function (p) {
        return Math.abs(p.x - r.x) < (largura + p.largura) / 2 && Math.abs(p.y - y) < 13;
      });
      if (colidiu) { y += 2; tentativas++; }
    }
    posicionados.push({ x: r.x, y: y, largura: largura });
    r.y = y;
  });
  return rotulos;
}

// Colunas agrupadas por semana -- mesma lógica de largura/gap do orçamento
// (construirColunasSvg), só trocando "mês" por "semana" no loop e nos
// rótulos. null = semana sem dado (nunca acontece de verdade pra
// Previsto/Realizado/Tendência semanais -- ver o comentário no topo do
// arquivo -- mas o código não assume isso, trata igual ao orçamento: não
// desenha nada, em vez de uma coluna fantasma na base do eixo).
function construirColunasSvg(dadosPorSerie, escala, alturaPlot, larguraSemana, margem, usarMilhares, rotulos, casasDecimais, numSemanas, semanas) {
  var svg = '';
  var numSeries = dadosPorSerie.length;
  var slot = larguraSemana * 0.72;
  var larguraColuna = Math.min(GRAFICO_BARRA_MAX, (slot - GRAFICO_BARRA_GAP * (numSeries - 1)) / numSeries);
  var slotOcupado = larguraColuna * numSeries + GRAFICO_BARRA_GAP * (numSeries - 1);

  for (var i = 0; i < numSemanas; i++) {
    var inicioSlot = margem.esquerda + i * larguraSemana + (larguraSemana - slotOcupado) / 2;
    dadosPorSerie.forEach(function (d, si) {
      var valor = d.valores[i];
      if (valor === null || valor === undefined) return;
      var alturaColuna = escalaLinear(valor, escala.max, alturaPlot);
      var x = inicioSlot + si * (larguraColuna + GRAFICO_BARRA_GAP);
      var y = margem.topo + alturaPlot - alturaColuna;
      svg += desenharBarraArredondada(x, y, larguraColuna, alturaColuna, SERIE_COR[d.serie]);
      svg += '<rect class="grafico-hit" data-tooltip="' + rotuloSemanaTooltip(i, semanas) + ' · ' + SERIE_LABELS[d.serie] + ': ' + formatarNumero(valor, casasDecimais) + '" x="' + x.toFixed(1) + '" y="' + margem.topo + '" width="' + Math.max(larguraColuna, GRAFICO_BARRA_GAP).toFixed(1) + '" height="' + alturaPlot + '" fill="transparent"/>';
      if (valor) {
        rotulos.push({ x: x + larguraColuna / 2, y: y - 6, texto: formatarValorGrafico(valor, usarMilhares, casasDecimais), classe: 'grafico-rotulo' });
      }
    });
  }
  return svg;
}

// Linhas (usadas só pro Acumulado aqui -- o orçamento também usa pras
// dimensões-razão, que não existem nesta página). Um valor null quebra a
// linha em vez de "cair" até a base -- desenha um <polyline> por trecho
// contínuo, não um só ligando todos os pontos. Sem 'indiceConector' (o
// orçamento usa pra séries "pós-Realizado" que não existem aqui -- ver o
// comentário no topo do arquivo).
function construirLinhasSvg(dadosPorSerie, campo, escala, alturaPlot, larguraSemana, margem, usarMilhares, rotulos, casasDecimais, semanas) {
  var svg = '';
  dadosPorSerie.forEach(function (d) {
    var traco = SERIE_TRACEJADO[d.serie] ? ' stroke-dasharray="' + SERIE_TRACEJADO[d.serie] + '"' : '';
    var trecho = [];
    function fecharTrecho() {
      if (trecho.length > 1) {
        var pontosStr = trecho.map(function (p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
        svg += '<polyline class="grafico-linha" points="' + pontosStr + '" fill="none" stroke="' + SERIE_COR[d.serie] + '" stroke-width="2"' + traco + '/>';
      }
      trecho = [];
    }
    d[campo].forEach(function (valor, i) {
      if (valor === null || valor === undefined) { fecharTrecho(); return; }
      var x = margem.esquerda + i * larguraSemana + larguraSemana / 2;
      var y = margem.topo + alturaPlot - escalaLinear(valor, escala.max, alturaPlot);
      trecho.push({ x: x, y: y });
      svg += '<circle class="grafico-marcador" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="4" fill="' + SERIE_COR[d.serie] + '" stroke="var(--surface-1)" stroke-width="2"/>';
      svg += '<circle class="grafico-hit" data-tooltip="' + rotuloSemanaTooltip(i, semanas) + ' · ' + SERIE_LABELS[d.serie] + ': ' + formatarNumero(valor, casasDecimais) + '" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="10" fill="transparent"/>';
      if (valor) {
        rotulos.push({ x: x, y: y - 10, texto: formatarValorGrafico(valor, usarMilhares, casasDecimais), classe: 'grafico-rotulo-final' });
      }
    });
    fecharTrecho();
  });
  return svg;
}

function finalizarPainelSvg(svgMarcas, rotulos, altura) {
  var svg = svgMarcas;
  resolverColisoesRotulos(rotulos).forEach(function (r) {
    svg += '<text class="' + r.classe + '" x="' + r.x.toFixed(1) + '" y="' + r.y.toFixed(1) + '" text-anchor="middle">' + r.texto + '</text>';
  });
  return '<svg viewBox="0 0 ' + GRAFICO_LARGURA + ' ' + altura + '" class="grafico-svg">' + svg + '</svg>';
}

// dadosPorSerie: [{ serie, valores: number[]|null[] (N semanas) }].
function construirGraficoSemanalSvg(dadosPorSerie, casasDecimais, numSemanas, semanas) {
  var margem = GRAFICO_MARGEM_BARRAS;
  var altura = GRAFICO_ALTURA_BARRAS;
  var larguraPlot = GRAFICO_LARGURA - margem.esquerda - margem.direita;
  var alturaPlot = altura - margem.topo - margem.baixo;
  var larguraSemana = larguraPlot / numSemanas;

  var maxSemanal = 0;
  dadosPorSerie.forEach(function (d) { d.valores.forEach(function (v) { if (v > maxSemanal) maxSemanal = v; }); });
  var escala = calcularEscalaEixo(maxSemanal);
  var usarMilhares = maxSemanal >= GRAFICO_LIMIAR_MILHARES;

  var svg = '';
  svg += construirEixoYSvg(escala, alturaPlot, margem, usarMilhares, casasDecimais);
  svg += construirEixoXSvg(larguraSemana, alturaPlot, margem, numSemanas);

  var rotulos = [];
  svg += construirColunasSvg(dadosPorSerie, escala, alturaPlot, larguraSemana, margem, usarMilhares, rotulos, casasDecimais, numSemanas, semanas);
  svg += construirLegendaSvg(dadosPorSerie, margem);

  return { svg: finalizarPainelSvg(svg, rotulos, altura), milhares: usarMilhares };
}

// Painel separado, eixo único, pro acumulado no mês -- semanal e acumulado
// nunca compartilham escala (mesmo motivo do orçamento: a última semana
// acumulada pode ser várias vezes uma semana típica).
function construirGraficoAcumuladoSemanalSvg(dadosPorSerie, casasDecimais, numSemanas, semanas) {
  var margem = GRAFICO_MARGEM_LINHA;
  var altura = GRAFICO_ALTURA_LINHA;
  var larguraPlot = GRAFICO_LARGURA - margem.esquerda - margem.direita;
  var alturaPlot = altura - margem.topo - margem.baixo;
  var larguraSemana = larguraPlot / numSemanas;

  var maxAcumulado = 0;
  dadosPorSerie.forEach(function (d) { d.acumulado.forEach(function (v) { if (v > maxAcumulado) maxAcumulado = v; }); });
  var escala = calcularEscalaEixo(maxAcumulado);
  var usarMilhares = maxAcumulado >= GRAFICO_LIMIAR_MILHARES;

  var svg = '';
  svg += construirEixoYSvg(escala, alturaPlot, margem, usarMilhares, casasDecimais);
  svg += construirEixoXSvg(larguraSemana, alturaPlot, margem, numSemanas);

  var rotulos = [];
  svg += construirLinhasSvg(dadosPorSerie, 'acumulado', escala, alturaPlot, larguraSemana, margem, usarMilhares, rotulos, casasDecimais, semanas);
  svg += construirLegendaSvg(dadosPorSerie, margem);

  return { svg: finalizarPainelSvg(svg, rotulos, altura), milhares: usarMilhares };
}

// Monta o par Semanal + Acumulado de UMA dimensão -- é uma SEGUNDA leitura
// (visual) dos mesmos números que a Tabela Semanal (renderAbaSemanal,
// render-aba-semanal.js) já mostra em tabela pra essa dimensão, nunca uma
// fonte de dado própria (mesmo espírito do Gráfico no orçamento).
function construirPainelGraficoSemanalHtml(registros, indices, dimensao, vigenteIdx, semanas, numSemanas, temSemanasReais, indiceAtual, demandas, hojeEpoch) {
  var series = calcularSeriesSemanaisDimensao(
    registros, indices, dimensao, vigenteIdx, semanas, numSemanas, temSemanasReais, indiceAtual, demandas, hojeEpoch
  );

  // Equipes é uma FOTO (ver compute-semanal.js): só o Previsto entra --
  // Realizado/Tendência semanais não existem pra Equipes (mesma regra que
  // a Tabela Semanal já segue, calcularSeriesSemanaisDimensao devolve
  // sem-dado pros dois nesse caso).
  var seriesVisiveis = dimensao === 'equipes' ? ['previsto'] : ORDEM_SERIES_GRAFICO;
  var valoresPorSerie = { previsto: series.semanasPrevisto, realizado: series.semanasRealizado, tendencia: series.semanasTendencia };
  // O Acumulado de Tendência usa a versão COMPLETA (semanasTendenciaCompleta,
  // sem a supressão das semanas elapsadas -- ver render-aba-semanal.js) --
  // achado da revisão final: calcularAcumulado trata null como "ainda não
  // começou a acumular" (contrato documentado em compute-grafico-semanal.js),
  // então acumular a versão SUPRIMIDA faria a curva recomeçar do zero na
  // primeira semana futura, perdendo o que já foi realizado -- o ponto final
  // divergiria do Fechamento que a Tabela Semanal mostra (calculado a partir
  // da versão completa). O painel Semanal (barras) continua usando a versão
  // suprimida em 'valores', que é o que decide se desenha barra/tooltip.
  var valoresParaAcumuladoPorSerie = { previsto: series.semanasPrevisto, realizado: series.semanasRealizado, tendencia: series.semanasTendenciaCompleta };
  var dadosPorSerie = seriesVisiveis.map(function (serie) {
    return { serie: serie, valores: valoresPorSerie[serie], acumulado: calcularAcumulado(valoresParaAcumuladoPorSerie[serie]) };
  });

  var rotuloDimensao = DIMENSOES_ROTULO_SEMANAL[dimensao] || '';
  var casasDecimais = 0; // Volume/Financeiro/Equipes semanais sempre inteiro -- sem dimensão-razão nesta página.

  var semanalResultado = construirGraficoSemanalSvg(dadosPorSerie, casasDecimais, numSemanas, semanas);
  var tituloSemanal = 'Semanal — ' + rotuloDimensao + (semanalResultado.milhares ? ' (em milhares)' : '');
  var html = '<div class="grafico-painel"><div class="grafico-titulo">' + escapeHtml(tituloSemanal) + '</div><div>' + semanalResultado.svg + '</div></div>';

  // Acumulado de Equipes não tem leitura de negócio (é uma foto por
  // semana, não um fluxo) -- mesma razão que o orçamento já usa pra
  // excluir Equipes do Acumulado no ano (render-dashboard.js).
  if (dimensao !== 'equipes') {
    var acumuladoResultado = construirGraficoAcumuladoSemanalSvg(dadosPorSerie, casasDecimais, numSemanas, semanas);
    var tituloAcumulado = 'Acumulado no mês — ' + rotuloDimensao + (acumuladoResultado.milhares ? ' (em milhares)' : '');
    html += '<div class="grafico-painel"><div class="grafico-titulo">' + escapeHtml(tituloAcumulado) + '</div><div>' + acumuladoResultado.svg + '</div></div>';
  }
  return html;
}

// Monta a aba inteira: um bloco (Semanal + Acumulado) por dimensão marcada,
// um abaixo do outro -- nunca somadas entre si (mesmo princípio da Tabela
// Semanal e do Gráfico do orçamento). opcoes: { vigenteIdx, ano, demandas,
// hojeEpoch } -- vigenteIdx/ano SEMPRE vêm de quem chama (sem default
// sensato, mesmo contrato de renderAbaSemanal/renderAbaBalanco);
// demandas/hojeEpoch são opcionais (sem eles, Realizado/Tendência somem dos
// painéis, só Previsto aparece).
function renderAbaGraficoSemanal(registros, indices, dimensoes, opcoes) {
  var opts = opcoes || {};
  var vigenteIdx = opts.vigenteIdx;
  var ano = opts.ano;
  var demandas = opts.demandas;
  var hojeEpoch = opts.hojeEpoch;

  var mesValido = vigenteIdx >= 0 && vigenteIdx <= 11;
  // Sem mês vigente válido não há semana real nenhuma pra desenhar (ao
  // contrário da Tabela Semanal, que ainda tem a linha Demandas Pendentes
  // pra mostrar independente do mês) -- mensagem explícita em vez de um
  // gráfico vazio ou com colunas fantasmas.
  if (!mesValido) {
    return '<p class="aviso-sem-dado">Sem mês vigente válido -- nenhum gráfico pra mostrar.</p>';
  }

  var semanas = semanasDoMes(ano, vigenteIdx);
  var numSemanas = semanas.length;
  var temDemandas = !!(demandas && demandas.porRegistroEventos && typeof hojeEpoch === 'number');
  var indiceAtual = temDemandas ? indiceSemanaAtual(semanas, hojeEpoch) : -1;

  return dimensoes.map(function (dimensao) {
    return '<div class="grafico-bloco-dimensao">' + construirPainelGraficoSemanalHtml(
      registros, indices, dimensao, vigenteIdx, semanas, numSemanas, temDemandas, indiceAtual, demandas, hojeEpoch
    ) + '</div>';
  }).join('');
}

module.exports = {
  renderAbaGraficoSemanal, construirPainelGraficoSemanalHtml,
  construirGraficoSemanalSvg, construirGraficoAcumuladoSemanalSvg,
};
