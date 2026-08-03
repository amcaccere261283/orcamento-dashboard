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
// uma linha por SUP. Privacidade: SUP, Tomador e tipologia SÃO renderizados
// neste SVG -- não é um vazamento porque este módulo só roda no navegador,
// DEPOIS da decifragem (nunca durante o build de render-semanal.js) -- mesmo
// contrato que render-aba-semanal.js já segue para SUP/Tomador.
//
// ============================================================================
// A ANATOMIA (redesenho de 2026-08-02) -- por que DOIS plots, lado a lado
// ============================================================================
// Até aqui as duas séries (desvio de valor e desvio de equipes) divergiam do
// MESMO eixo central, com escalas independentes, uma desenhada por cima da
// outra. Três defeitos se somavam:
//
//   1. A barra de equipes (desenhada depois) COBRIA a barra de valor -- a
//      série principal do gráfico ficava escondida atrás da secundária.
//   2. Duas escalas diferentes no mesmo eixo é o clássico "gráfico de eixo
//      duplo": a régua de uma série não vale para a outra, então comprimentos
//      vizinhos inventam uma correlação que não existe no dado.
//   3. Sem régua nenhuma (nem tick, nem gridline), o comprimento das barras
//      não era legível em número nenhum -- e o rótulo na ponta mostrava o
//      REALIZADO numa barra cujo comprimento é o DESVIO: dois números
//      diferentes no mesmo lugar.
//
// Agora são dois plots separados na mesma faixa horizontal, cada um com o seu
// próprio zero e a sua própria escala:
//
//   [ SUP — Tomador ][ desvio de valor -- eixo com ticks ][ Δ equipes ]
//
// A escala independente por série continua sendo a decisão certa (equipes anda
// em unidades, valor em centenas de milhares -- numa régua só, 10 equipes ao
// lado de 100.000 vira um traço de 1 pixel), mas agora ela mora em plots
// separados, então não há mais como ler um comprimento contra a régua errada.
// Só o plot de valor ganha ticks/gridlines: é a série principal e a única
// cujo eixo tem números redondos com significado.
//
// CORES -- os três tons (#7fd858 acima, #e0684f abaixo, #f6b53f equipes) são
// os mesmos do resto dos dois dashboards e foram mantidos de propósito. O
// validador de paleta do skill dataviz reprova a "faixa de luminosidade" deles
// (regra de paleta CATEGÓRICA), mas aqui verde/vermelho são um par DIVERGENTE
// (polaridade, não identidade) e o âmbar é o acento da marca, já usado nas
// abas, no checkbox e no foco. O que importa nesse caso -- separação sob
// daltonismo -- passa folgado (ΔE 13,5 deuteranopia, alvo >= 8), e a
// polaridade ainda é codificada de forma redundante pela DIREÇÃO da barra e
// pelo sinal do rótulo, nunca só pela cor. Todas as alternativas testadas
// pioravam o ΔE.

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

// Formata o que aparece NO gráfico (tick do eixo, rótulo na ponta da barra) --
// em milhares quando o recorte é grande o bastante. MESMA regra do orçamento
// (formatarValorGrafico, em tools/orcamento/render-dashboard.js): o tooltip
// nunca passa por aqui, ele mostra o número exato, porque hover é onde a
// pessoa vai quando quer o valor completo e não o arredondado.
function formatarValorGrafico(valor, usarMilhares, casasDecimais) {
  if (valor === null || valor === undefined) return '—';
  var casas = casasDecimais === undefined ? 0 : casasDecimais;
  return formatarNumero(usarMilhares ? valor / 1000 : valor, casas);
}

// Rótulo de um desvio: sempre com sinal explícito, porque o número sozinho
// não diz de que lado do zero ele está quando o rótulo cai FORA da barra.
// Usa o sinal de menos tipográfico (U+2212), não o hífen -- alinha com os
// dígitos em fonte tabular, o hífen não.
function formatarDesvio(valor, usarMilhares, casasDecimais) {
  if (valor === null || valor === undefined) return '—';
  var casas = casasDecimais === undefined ? 0 : casasDecimais;
  var texto = formatarValorGrafico(Math.abs(valor), usarMilhares, casas);

  // O sinal é decidido sobre o número JÁ ARREDONDADO, não sobre o bruto: um
  // desvio de -0,04 equipe arredonda para "0,0" e sairia como "−0,0", que
  // parece defeito de formatação. Quem arredonda para zero não tem sinal.
  var fator = Math.pow(10, casas);
  var arredondado = Math.round((usarMilhares ? valor / 1000 : valor) * fator) / fator;
  if (arredondado > 0) return '+' + texto;
  if (arredondado < 0) return '−' + texto;
  return texto;
}

// Corta um texto que não caberia na calha de rótulos. O nome inteiro continua
// no tooltip da linha, então nada se perde -- e um rótulo cortado é melhor que
// um rótulo atravessando o plot.
function truncar(texto, maxCaracteres) {
  var t = String(texto || '');
  return t.length > maxCaracteres ? t.slice(0, maxCaracteres - 1) + '…' : t;
}

// Uma escala POR SÉRIE, não uma régua comum -- ver a nota sobre a anatomia no
// topo do arquivo. Continua sendo usada pela série de equipes, que vive no seu
// próprio plot e não tem eixo numerado (o rótulo em cada barra carrega o
// valor). O plot de valor usa calcularEscalaAncorada, abaixo, porque ele TEM
// eixo e um eixo precisa cair em números redondos.
function escalaIndependente(valores, larguraMax) {
  var maximo = 0;
  for (var i = 0; i < valores.length; i++) {
    var v = Math.abs(valores[i] || 0);
    if (v > maximo) maximo = v;
  }
  if (!maximo) return function () { return 0; };
  return function (valor) { return Math.abs(valor || 0) / maximo * larguraMax; };
}

// MESMOS degraus de GRAFICO_DEGRAUS_ESCALA (tools/orcamento/render-dashboard.js):
// 1/1,5/2/2,5/3/4/5/6/8/10, não só 1/2/2,5/5/10 -- com os degraus
// intermediários o pior caso de eixo sobrando cai de ~100% pra ~50%. Copiado
// e não importado de propósito: render-dashboard.js é um módulo de BUILD (ele
// emite o HTML do orçamento), enquanto este aqui vai inteiro pro navegador
// dentro do bundle; importar de lá arrastaria o renderizador do orçamento
// junto pra dentro da página semanal.
var DEGRAUS_ESCALA = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

// Arredonda um passo bruto para o próximo degrau "limpo" da lista acima.
function passoBonito(passoBruto) {
  if (!(passoBruto > 0)) return 0;
  var magnitude = Math.pow(10, Math.floor(Math.log10(passoBruto)));
  var normalizado = passoBruto / magnitude;
  for (var i = 0; i < DEGRAUS_ESCALA.length; i++) {
    if (normalizado <= DEGRAUS_ESCALA[i]) return DEGRAUS_ESCALA[i] * magnitude;
  }
  return 10 * magnitude;
}

// Como a largura do plot de valor se reparte entre o lado negativo e o
// positivo. Decidido UMA vez para a aba inteira, a partir dos extremos de
// TODOS os painéis -- é isso que faz a linha do zero cair sempre no mesmo x.
//
// Por que isso importa: cada painel continua com o seu próprio domínio (o
// eixo do SP vai a -600 e o do SM a -2.000, e está certo assim), mas antes
// disso a CONTAGEM de intervalos também variava -- um painel só-negativo
// tinha 4 intervalos à esquerda e 0 à direita, um misto tinha 4 e 1. Com
// isso o zero pulava de x=693,6 para x=802 entre painéis vizinhos. Numa
// coluna de 10 painéis empilhados o zero é a única âncora vertical possível,
// e ele era justamente o que se mexia. Fixar a contagem (não os valores)
// resolve sem tirar de nenhum painel o domínio próprio.
//
// A repartição sai do formato do dado da VISÃO atual em vez de ser um 4:1
// fixo: com quase tudo abaixo da base o lado negativo leva quase tudo, mas
// numa visão majoritariamente positiva (Volumetria com base Previsto Inicial,
// por exemplo) a proporção se inverte sozinha. Um 4:1 cravado deixaria 80% da
// largura vazia nesse caso.
function calcularDivisaoTicks(minGlobal, maxGlobal, nTotal) {
  var neg = Math.abs(Math.min(0, minGlobal || 0));
  var pos = Math.max(0, maxGlobal || 0);
  if (!(neg > 0) && !(pos > 0)) return null;
  if (!(pos > 0)) return { nNeg: nTotal, nPos: 0 };
  if (!(neg > 0)) return { nNeg: 0, nPos: nTotal };

  var fracaoNeg = neg / (neg + pos);
  var nNeg = Math.round(fracaoNeg * nTotal);
  // Nenhum lado com dado pode ficar sem NENHUM intervalo, senão as barras
  // daquele lado não teriam para onde crescer.
  if (nNeg < 1) nNeg = 1;
  if (nNeg > nTotal - 1) nNeg = nTotal - 1;
  return { nNeg: nNeg, nPos: nTotal - nNeg };
}

// Eixo de UM painel, com a contagem de intervalos já fixada por
// calcularDivisaoTicks. Cada painel escolhe o próprio 'passo' (é o que
// preserva o domínio local), mas todos usam a mesma repartição, então o zero
// cai no mesmo x em todos.
//
// Devolve { passo, min, max } com min <= 0 <= max. null quando não há nenhum
// desvio comparável -- quem chama usa isso para não desenhar régua nenhuma
// (um eixo "0 / 0,25 / 0,5" sobre um gráfico sem dado nenhum é pior que
// nenhum eixo).
function calcularEscalaAncorada(minDesvio, maxDesvio, divisao) {
  if (!divisao) return null;
  var min = Math.min(0, minDesvio || 0);
  var max = Math.max(0, maxDesvio || 0);
  if (!(max - min > 0)) return null;

  var candidatos = [];
  if (divisao.nNeg > 0) candidatos.push(Math.abs(min) / divisao.nNeg);
  if (divisao.nPos > 0) candidatos.push(max / divisao.nPos);
  var passo = passoBonito(Math.max.apply(null, candidatos));
  if (!(passo > 0)) return null;

  return { passo: passo, min: -divisao.nNeg * passo, max: divisao.nPos * passo };
}

// 1000 é a MESMA largura de viewBox que GRAFICO_LARGURA usa no orçamento --
// os dois dashboards passam a desenhar no mesmo sistema de coordenadas, então
// 11px de fonte tem o mesmo tamanho aparente nas duas abas.
var LARGURA_SVG = 1000;
// esquerda: a calha de "SUP — Tomador". baixo: a faixa dos ticks do eixo.
var MARGEM = { topo: 24, baixo: 34, esquerda: 260, direita: 12 };
var ALTURA_LINHA = 34;
var ALTURA_BARRA = 14;          // <= 24px (teto de espessura de barra do sistema)
var ALTURA_BARRA_EQUIPES = 9;   // série subordinada: mais fina que a principal
var RAIO_BARRA = 3;
// Em quantos intervalos o eixo do plot de valor é repartido, somando os dois
// lados do zero. 5 intervalos = 6 ticks: denso o bastante para ler, esparso o
// bastante para os rótulos não colidirem. A repartição entre negativo e
// positivo é decidida por calcularDivisaoTicks, uma vez para a aba inteira.
var INTERVALOS_EIXO = 5;

// Comprimento mínimo de uma barra com valor diferente de zero. Sem isso um
// desvio pequeno numa escala grande renderiza com menos de 1 unidade e some --
// visualmente idêntico a "não há dado", que é justamente a distinção que o
// resto deste módulo se esforça para preservar.
var COMPRIMENTO_MINIMO_BARRA = 2;

// Acima desse desvio bruto o plot de valor passa a exibir em milhares (mesmo
// GRAFICO_LIMIAR_MILHARES do orçamento) -- assim um recorte pequeno não vira
// "0" depois de dividido, e o título do painel ganha "(em milhares)".
var LIMIAR_MILHARES = 1000;

// Quantos caracteres cabem na calha de rótulo (MARGEM.esquerda menos o respiro
// de cada lado, a ~6,2px por caractere em 11px). O nome inteiro fica no
// tooltip -- ver truncar().
var MAX_CARACTERES_ROTULO = 40;

// --- Geometria dos dois plots (constante: não depende dos dados) ------------
// Exportada porque os testes precisam saber onde cada plot começa e termina
// para provar que as duas séries usam réguas separadas -- sem isso o teste
// teria que repetir os números à mão e sairia de sincronia no primeiro ajuste.
var LARGURA_COLUNA_EQUIPES = 150;
var GAP_ENTRE_PLOTS = 36;

var PLOT_EQUIPES_FIM = LARGURA_SVG - MARGEM.direita;
var PLOT_EQUIPES_INI = PLOT_EQUIPES_FIM - LARGURA_COLUNA_EQUIPES;
var CENTRO_EQUIPES = (PLOT_EQUIPES_INI + PLOT_EQUIPES_FIM) / 2;
// A barra de equipes não pode encostar na borda do próprio plot: o rótulo
// ("+0,2") fica FORA da ponta e precisa do que sobra de cada lado.
var MEIA_LARGURA_EQUIPES = 40;

var PLOT_VALOR_INI = MARGEM.esquerda;
var PLOT_VALOR_FIM = PLOT_EQUIPES_INI - GAP_ENTRE_PLOTS;
var LARGURA_PLOT_VALOR = PLOT_VALOR_FIM - PLOT_VALOR_INI;

// Mapeador valor -> x dentro do plot de valor. Com eixo assimétrico o zero não
// é mais uma constante do módulo: ele depende da escala do painel, então quem
// desenha pede a função e pergunta por xDe(0).
function projetorValor(escala) {
  return function (valor) {
    return PLOT_VALOR_INI + ((valor - escala.min) / (escala.max - escala.min)) * LARGURA_PLOT_VALOR;
  };
}

var GEOMETRIA = {
  larguraSvg: LARGURA_SVG,
  alturaLinha: ALTURA_LINHA,
  margem: MARGEM,
  intervalosEixo: INTERVALOS_EIXO,
  valor: { inicio: PLOT_VALOR_INI, fim: PLOT_VALOR_FIM, largura: LARGURA_PLOT_VALOR },
  equipes: { inicio: PLOT_EQUIPES_INI, fim: PLOT_EQUIPES_FIM, centro: CENTRO_EQUIPES, meiaLargura: MEIA_LARGURA_EQUIPES },
};

var COR_ACIMA = '#7fd858';   // mesmo verde de .linha-realizado no orçamento
var COR_ABAIXO = '#e0684f';  // mesmo vermelho de .status-erro
var COR_EQUIPES = '#f6b53f'; // mesmo laranja/dourado do resto da UI

var ROTULO_DIMENSAO = { financeiro: 'Desvio financeiro', volume: 'Desvio de volume' };

// Largura aproximada de um texto em px, para decidir se o rótulo cabe DENTRO
// da barra ou tem que ir para fora dela. Não precisa ser exata -- precisa
// errar para MAIS, porque o custo de errar para menos é um rótulo estourando
// a própria barra (o modo de falha da versão anterior: número branco por cima
// da barra âmbar, ilegível).
function larguraAproximadaTexto(texto, tamanhoFonte) {
  return String(texto).length * tamanhoFonte * 0.62;
}

// Uma barra divergente, arredondada SÓ na ponta do dado -- a ponta ancorada
// no zero fica reta.
//
// Antes isto era um <rect rx="3">, que arredonda os quatro cantos, com dois
// efeitos ruins: a barra descolava da linha do zero (a referência contra a
// qual ela está sendo medida) e, em barras curtas, o SVG clampa o raio em
// width/2 e o retângulo vira um losango -- a barra de 3,4 unidades do painel
// SM era literalmente um ponto. Um <path> resolve os dois de uma vez.
//
// 'xZero' é a borda colada no eixo e 'comprimento' é sempre positivo; o lado
// sai de 'paraDireita'. data-largura repete o comprimento desenhado porque a
// largura deixou de ser um atributo legível (está dentro do 'd') e os testes
// de escala precisam dela -- ver a nota em test/semanal-render-aba-balanco.test.js.
function barraDivergente(xZero, comprimento, yCentro, altura, classe, cor, paraDireita) {
  if (!(comprimento > 0)) return '';
  var r = Math.min(RAIO_BARRA, comprimento, altura / 2);
  var y = yCentro - altura / 2;
  var w = comprimento;
  var d = paraDireita
    ? 'M' + xZero.toFixed(1) + ',' + y.toFixed(1)
      + ' h' + (w - r).toFixed(1)
      + ' a' + r + ',' + r + ' 0 0 1 ' + r + ',' + r
      + ' v' + (altura - 2 * r).toFixed(1)
      + ' a' + r + ',' + r + ' 0 0 1 ' + (-r) + ',' + r
      + ' h' + (-(w - r)).toFixed(1) + ' z'
    : 'M' + xZero.toFixed(1) + ',' + y.toFixed(1)
      + ' h' + (-(w - r)).toFixed(1)
      + ' a' + r + ',' + r + ' 0 0 0 ' + (-r) + ',' + r
      + ' v' + (altura - 2 * r).toFixed(1)
      + ' a' + r + ',' + r + ' 0 0 0 ' + r + ',' + r
      + ' h' + (w - r).toFixed(1) + ' z';
  return '<path class="' + classe + '" data-largura="' + comprimento.toFixed(1)
    + '" d="' + d + '" fill="' + cor + '"></path>';
}

// tipologia: string (vira o título do painel, FORA do SVG). linhas: array no
// formato que calcularLinhas() (compute-balanco.js) produz -- consumido
// diretamente, não reimplementado. opcoes.somenteAtivos: default true (mesmo
// default da aba -- sem o filtro, toda tipologia mostraria 34 SUPs, a maioria
// com barra de comprimento zero). opcoes.dimensao só alimenta o título.
//
// Devolve o painel INTEIRO (título + svg), não só o <svg>: o título saiu de
// dentro do desenho e virou um <div class="grafico-titulo">, o mesmo elemento
// que a aba Gráfico do orçamento usa. Além de ficar consistente, o título
// agora é texto de verdade (selecionável, lido por leitor de tela, e no
// tamanho real da página em vez de escalado junto com o viewBox) e é onde
// cabe o sufixo "(em milhares)", que depende dos dados.
function renderGraficoTipologia(tipologia, linhas, opcoes) {
  var opts = opcoes || {};
  var somenteAtivos = opts.somenteAtivos === undefined ? true : opts.somenteAtivos;
  var dimensao = opts.dimensao || 'financeiro';

  var linhasFiltradas = (linhas || []).filter(function (linha) {
    return somenteAtivos ? !!linha.ativo : true;
  });
  var linhasOrdenadas = ordenarPorDesvio(linhasFiltradas);

  function temDesvio(linha) {
    return !linha.semBase && linha.desvio !== null && linha.desvio !== undefined;
  }

  // As pontas do eixo saem só das linhas COMPARÁVEIS. 'sem base' (nunca houve
  // base) e 'Realizado não lançado' (o período ainda não fechou) não têm
  // desvio numérico e não podem virar zero espúrio na conta das pontas.
  var minDesvio = 0, maxDesvio = 0, maxAbsoluto = 0;
  linhasOrdenadas.forEach(function (linha) {
    if (!temDesvio(linha)) return;
    if (linha.desvio < minDesvio) minDesvio = linha.desvio;
    if (linha.desvio > maxDesvio) maxDesvio = linha.desvio;
    if (Math.abs(linha.desvio) > maxAbsoluto) maxAbsoluto = Math.abs(linha.desvio);
  });
  // 'divisao' vem de quem chama (renderAbaBalanco), calculada uma vez para a
  // aba inteira -- é o que ancora o zero no mesmo x em todos os painéis.
  var divisao = opts.divisao || calcularDivisaoTicks(minDesvio, maxDesvio, INTERVALOS_EIXO);
  var escala = calcularEscalaAncorada(minDesvio, maxDesvio, divisao);
  var xDe = escala ? projetorValor(escala) : null;
  // Mesmo sem escala o zero precisa cair onde cairia nos outros painéis, senão
  // os rótulos de "sem base"/"não lançado" desalinham da coluna do zero.
  var fracaoZero = divisao ? divisao.nNeg / (divisao.nNeg + divisao.nPos) : 0.5;
  var xZero = escala ? xDe(0) : (PLOT_VALOR_INI + fracaoZero * LARGURA_PLOT_VALOR);
  var usarMilhares = maxAbsoluto >= LIMIAR_MILHARES;

  var desviosEquipes = linhasOrdenadas
    .filter(function (l) { return l.desvioEquipes !== null && l.desvioEquipes !== undefined; })
    .map(function (l) { return l.desvioEquipes; });
  // A escala de equipes é GLOBAL da aba (maxEquipesGlobal), não do painel.
  // Antes era por painel, e o efeito era grave: a barra âmbar mais longa media
  // 40 unidades nos três painéis do recorte, valendo -6 equipes num, -15 no
  // outro e -3 no terceiro. Mesma cor, mesmo x, mesmo cabeçalho, painéis
  // empilhados -- e, ao contrário do plot de valor, sem tick nenhum que
  // denunciasse a troca de régua. Com a escala global, comprimento igual passa
  // a significar número igual em toda a página.
  //
  // Não vira "blocos unitários contáveis" (uma alternativa considerada) porque
  // Δ equipes NÃO é inteiro: em "Acumulado até o mês" 49 das 340 linhas são
  // fracionárias (mediaEquipesPonderada é média por dia), e lá o máximo global
  // é 3,2 -- arredondar para contar blocos apagaria um -0,4 inteiro.
  var maxEquipes = opts.maxEquipesGlobal;
  var escalaEquipes = (maxEquipes > 0)
    ? function (valor) { return Math.abs(valor || 0) / maxEquipes * MEIA_LARGURA_EQUIPES; }
    : escalaIndependente(desviosEquipes, MEIA_LARGURA_EQUIPES);
  var temAlgumaEquipe = desviosEquipes.length > 0;

  var numLinhas = Math.max(linhasOrdenadas.length, 1);
  var yBaseLinhas = MARGEM.topo;
  var yFimLinhas = yBaseLinhas + numLinhas * ALTURA_LINHA;
  var altura = yFimLinhas + MARGEM.baixo;

  var tituloTexto = tipologia + ' — ' + (ROTULO_DIMENSAO[dimensao] || 'Desvio')
    + (usarMilhares ? ' (em milhares)' : '');

  // 'grafico-svg' é a classe que cssBase() (casca compartilhada com o
  // orçamento) já estiliza (width:100%; height:auto; display:block;) --
  // reaproveitada aqui de propósito. Sem width/height fixos no atributo: só
  // viewBox, exatamente como finalizarPainelSvg() faz no orçamento, senão o
  // height do atributo briga com o height:auto do CSS.
  var svg = '<svg class="grafico-svg grafico-balanco" viewBox="0 0 ' + LARGURA_SVG + ' ' + altura
    + '" role="img" aria-label="' + escapeHtml(tituloTexto) + '">';

  // --- Régua do plot de valor: gridlines primeiro, tudo o mais por cima -----
  // Os ticks são todos os múltiplos de 'passo' entre min e max, inclusive --
  // com o eixo assimétrico não dá para contar "n por lado", porque cada lado
  // tem a sua própria quantidade de passos.
  var ticks = [];
  if (escala) {
    for (var v = escala.min; v <= escala.max + escala.passo / 2; v += escala.passo) {
      // Arredonda o acumulador: somar passo repetidamente acumula erro de
      // ponto flutuante e um tick sairia como "-1,0000000000000002".
      ticks.push(Math.round(v / escala.passo) * escala.passo);
    }
    ticks.forEach(function (valorTick) {
      if (valorTick === 0) return; // o zero é o eixo, desenhado à parte e mais forte
      var xGrid = xDe(valorTick);
      svg += '<line class="grafico-gridline" x1="' + xGrid.toFixed(1) + '" y1="' + yBaseLinhas
        + '" x2="' + xGrid.toFixed(1) + '" y2="' + yFimLinhas + '"></line>';
    });
  }

  // Os dois zeros. O do plot de valor é a "base" contra a qual todo desvio é
  // medido -- por isso é mais forte que uma gridline comum. Só existe se
  // houver ao menos um desvio numérico: num painel inteiro de "Realizado não
  // lançado" uma linha vertical solta prometeria um eixo que não está lá.
  var temAlgumDesvio = linhasOrdenadas.some(temDesvio);
  if (temAlgumDesvio) {
    svg += '<line class="balanco-eixo-zero" x1="' + xZero.toFixed(1) + '" y1="' + yBaseLinhas
      + '" x2="' + xZero.toFixed(1) + '" y2="' + yFimLinhas + '"></line>';
  }
  if (temAlgumaEquipe) {
    svg += '<line class="balanco-eixo-zero" x1="' + CENTRO_EQUIPES + '" y1="' + yBaseLinhas
      + '" x2="' + CENTRO_EQUIPES + '" y2="' + yFimLinhas + '"></line>';
    svg += '<text class="balanco-cabecalho-coluna" x="' + CENTRO_EQUIPES + '" y="' + (yBaseLinhas - 9)
      + '" text-anchor="middle">Δ equipes</text>';
  }

  if (!linhasOrdenadas.length) {
    svg += '<text class="balanco-vazio" x="' + xZero.toFixed(1) + '" y="' + (yBaseLinhas + ALTURA_LINHA / 2 + 4)
      + '" text-anchor="middle">nenhum SUP ativo neste período</text>';
    svg += '</svg>';
    return '<div class="grafico-titulo">' + escapeHtml(tituloTexto) + '</div>' + svg;
  }

  // Rótulos e áreas de hover são acumulados e emitidos DEPOIS de todas as
  // barras, numa passada só: rótulo por cima de qualquer barra vizinha (com
  // halo), e área de hover por cima da barra mas por baixo do rótulo (que é
  // pointer-events:none no CSS, então não abre buraco no hover).
  var marcas = '';
  var alvos = '';
  var rotulos = '';

  linhasOrdenadas.forEach(function (linha, i) {
    var y = yBaseLinhas + i * ALTURA_LINHA + ALTURA_LINHA / 2;

    // Divisória entre linhas -- nunca antes da primeira (o cabeçalho já marca
    // esse limite). Facilita a leitura com muitos SUPs na tela.
    if (i > 0) {
      var yDivisoria = yBaseLinhas + i * ALTURA_LINHA;
      svg += '<line class="balanco-divisoria" x1="0" y1="' + yDivisoria + '" x2="' + LARGURA_SVG
        + '" y2="' + yDivisoria + '"></line>';
    }

    // SUP e Tomador na MESMA linha, em cores diferentes, dentro de um <text>
    // só -- é assim que SVG mistura estilo numa linha (<tspan>). "Facilita a
    // leitura quando o filtro estiver sem SUP específico selecionado" (dono
    // do projeto): com muitas linhas visíveis de uma vez, o tomador ajuda a
    // identificar rápido de quem é cada uma. Truncado para não invadir o
    // plot -- o nome inteiro está no tooltip da linha.
    var sufixoTomador = linha.tomador ? ' — ' + linha.tomador : '';
    var espacoTomador = Math.max(0, MAX_CARACTERES_ROTULO - String(linha.sup || '').length);
    rotulos += '<text class="balanco-sup" x="8" y="' + (y + 4) + '">'
      + '<tspan>' + escapeHtml(linha.sup) + '</tspan>'
      + (sufixoTomador ? '<tspan class="balanco-tomador">' + escapeHtml(truncar(sufixoTomador, espacoTomador)) + '</tspan>' : '')
      + '</text>';

    // --- Série principal: o desvio de valor -------------------------------
    if (linha.semBase) {
      // "Não havia base" e "o realizado bateu a base" são opostos -- por isso
      // NENHUMA barra é desenhada, só o rótulo preso ao zero, em vez de um
      // desvio 0 que pareceria "bateu certinho".
      rotulos += '<text class="balanco-vazio" x="' + xZero.toFixed(1) + '" y="' + (y + 4)
        + '" text-anchor="middle">sem base</text>';
    } else if (linha.desvio === null || linha.desvio === undefined) {
      // Mesmo cuidado que "sem base", mas do outro lado do desvio: havia
      // base, mas o Realizado ainda não existe. "Não lançado" e "bateu
      // exatamente a base" são opostos que apareceriam idênticos se ambos
      // virassem uma barra de comprimento zero. Acontece em Acumulado até o
      // mês quando a coluna Realizado da MATRIZ está em branco pro período
      // (achado de 2026-08-01; Mês Vigente não cai mais aqui, ver
      // realizadoDoAvancos em compute-balanco.js -- furos reais nunca são
      // "sem dado", só zero).
      rotulos += '<text class="balanco-vazio" x="' + xZero.toFixed(1) + '" y="' + (y + 4)
        + '" text-anchor="middle">Realizado não lançado</text>';
    } else {
      var desvio = linha.desvio;
      // Sem escala (calcularEscalaAncorada devolveu null) TODOS os desvios
      // comparáveis desta tipologia são exatamente zero -- o caso real de um
      // mês fechado em que a MATRIZ copia Realizado = Previsto linha a linha.
      // Esses zeros continuam sendo linhas legítimas ("bateu a base"), então
      // caem aqui e não no ramo de "não lançado": ficam presos ao eixo, sem
      // barra, com o rótulo "0". Sem esta guarda, xDe é null e a aba inteira
      // quebrava com "xDe is not a function".
      var paraDireita = desvio >= 0;
      var comprimentoCru = xDe ? Math.abs(xDe(desvio) - xZero) : 0;
      // Piso de comprimento: desvio diferente de zero nunca pode renderizar
      // como nada. Desvio EXATAMENTE zero continua sem barra (o rótulo "0"
      // encostado no eixo é que diz "bateu a base").
      var comprimento = desvio === 0 ? 0 : Math.max(COMPRIMENTO_MINIMO_BARRA, comprimentoCru);
      var xPonta = paraDireita ? (xZero + comprimento) : (xZero - comprimento);
      var classeCor = paraDireita ? 'barra-acima' : 'barra-abaixo';

      marcas += barraDivergente(xZero, comprimento, y, ALTURA_BARRA, classeCor,
        paraDireita ? COR_ACIMA : COR_ABAIXO, paraDireita);

      // O rótulo mostra o DESVIO -- que é o que o comprimento da barra
      // codifica. A versão anterior mostrava o Realizado na ponta de uma
      // barra cujo comprimento era o desvio: dois números diferentes no
      // mesmo lugar. Base e Realizado passaram para o tooltip.
      var textoDesvio = formatarDesvio(desvio, usarMilhares, 0);
      var larguraTexto = larguraAproximadaTexto(textoDesvio, 10);
      var cabeDentro = comprimento >= larguraTexto + 14;
      var xRotulo, ancora, classeRotulo;
      if (cabeDentro) {
        xRotulo = paraDireita ? (xPonta - 7) : (xPonta + 7);
        ancora = paraDireita ? 'end' : 'start';
        classeRotulo = 'balanco-rotulo-dentro';
      } else {
        xRotulo = paraDireita ? (xPonta + 7) : (xPonta - 7);
        ancora = paraDireita ? 'start' : 'end';
        // Classe própria em vez de .grafico-rotulo-final: aquela é 11px e esta
        // precisa ser 10px, igual à de dentro da barra. É o MESMO número, com
        // a mesma importância -- só muda se coube ou não na barra, e o corpo
        // do texto não pode carregar essa diferença (numa coluna só, as
        // primeiras linhas saíam em 11px e as demais em 10px). O halo também
        // é diferente: ver .balanco-rotulo-fora no CSS.
        classeRotulo = 'balanco-rotulo-fora';
      }
      rotulos += '<text class="' + classeRotulo + '" x="' + xRotulo.toFixed(1) + '" y="' + (y + 4)
        + '" text-anchor="' + ancora + '">' + textoDesvio + '</text>';
    }

    // Área de hover da linha inteira do plot de valor -- 34px de alto, bem
    // acima do mínimo de alvo de toque, em vez de exigir que a pessoa acerte
    // uma barra de 14px. O tooltip carrega os números EXATOS (sem milhares),
    // mesma regra do orçamento, e o Tomador INTEIRO (o rótulo pode estar
    // truncado).
    var tipValor = escapeHtml(linha.sup) + (linha.tomador ? ' — ' + escapeHtml(linha.tomador) : '')
      + ' · Base ' + formatarNumero(linha.valorBase, 0)
      + ' · Realizado ' + formatarNumero(linha.valorRealizado, 0)
      + ' · Desvio ' + formatarDesvio(linha.desvio, false, 0);
    alvos += '<rect class="grafico-hit" data-tooltip="' + tipValor + '" x="0"'
      + ' y="' + (y - ALTURA_LINHA / 2) + '" width="' + PLOT_VALOR_FIM
      + '" height="' + ALTURA_LINHA + '" fill="transparent"></rect>';

    // --- Série secundária: o desvio de equipes, no plot próprio -----------
    // SEMPRE lido da MATRIZ (Avanço Sond não rastreia equipes por furo -- ver
    // compute-balanco.js), então pode ficar "sem dado" mesmo quando o desvio
    // principal já tem valor. Mesmo cuidado: null não vira barra de
    // comprimento zero, só não desenha.
    if (linha.desvioEquipes === null || linha.desvioEquipes === undefined) return;

    var desvioEq = linha.desvioEquipes;
    var paraDireitaEq = desvioEq >= 0;
    var comprimentoEqCru = escalaEquipes(desvioEq);
    var comprimentoEq = desvioEq === 0 ? 0 : Math.max(COMPRIMENTO_MINIMO_BARRA, comprimentoEqCru);

    marcas += barraDivergente(CENTRO_EQUIPES, comprimentoEq, y, ALTURA_BARRA_EQUIPES,
      'barra-equipes', COR_EQUIPES, paraDireitaEq);

    // Rótulo SEMPRE fora da barra (ela é fina demais para conter texto) e em
    // tinta de texto, não em âmbar: quem carrega a identidade da série é a
    // barra colorida ao lado, não o número. Em âmbar sobre fundo escuro o
    // número ficava com contraste pior que o resto da página.
    var xRotuloEq = paraDireitaEq ? (CENTRO_EQUIPES + comprimentoEq + 7) : (CENTRO_EQUIPES - comprimentoEq - 7);
    rotulos += '<text class="balanco-rotulo-equipes" x="' + xRotuloEq.toFixed(1) + '" y="' + (y + 4)
      + '" text-anchor="' + (paraDireitaEq ? 'start' : 'end') + '">'
      + formatarDesvio(desvioEq, false, 1) + '</text>';

    var tipEquipes = escapeHtml(linha.sup) + ' · Equipes base ' + formatarNumero(linha.equipesBase, 1)
      + ' · Realizado ' + formatarNumero(linha.equipesRealizado, 1)
      + ' · Δ ' + formatarDesvio(desvioEq, false, 1);
    alvos += '<rect class="grafico-hit" data-tooltip="' + tipEquipes + '" x="' + PLOT_VALOR_FIM
      + '" y="' + (y - ALTURA_LINHA / 2) + '" width="' + (LARGURA_SVG - PLOT_VALOR_FIM)
      + '" height="' + ALTURA_LINHA + '" fill="transparent"></rect>';
  });

  svg += marcas + alvos + rotulos;

  // --- Ticks do eixo de valor, embaixo -------------------------------------
  // Só existem quando existe escala (ou seja, quando há pelo menos um desvio
  // comparável). Sem isso um gráfico inteiro de "Realizado não lançado"
  // ganharia uma régua "0 / 0,25 / 0,5" inventada do nada.
  if (escala) {
    var yTicks = yFimLinhas + 18;
    ticks.forEach(function (valorTick) {
      svg += '<text class="grafico-eixo-texto" x="' + xDe(valorTick).toFixed(1) + '" y="' + yTicks
        + '" text-anchor="middle">' + formatarDesvio(valorTick, usarMilhares, 0) + '</text>';
    });
  }

  svg += '</svg>';
  return '<div class="grafico-titulo">' + escapeHtml(tituloTexto) + '</div>' + svg;
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

// Legenda ÚNICA para a aba inteira, não uma por painel: são as mesmas três
// séries em todos os gráficos, e repetir a legenda 10 vezes seria só ruído.
// Em HTML e não em SVG porque assim ela não escala junto com o viewBox e o
// texto fica no tamanho real da página.
function renderLegenda() {
  function item(cor, rotulo) {
    return '<span class="legenda-item"><span class="legenda-swatch" style="background:' + cor + '"></span>'
      + escapeHtml(rotulo) + '</span>';
  }
  return '<div class="legenda-balanco">'
    + item(COR_ACIMA, 'Acima da base')
    + item(COR_ABAIXO, 'Abaixo da base')
    // "escala própria" sozinho ficou contando a história pela metade depois
    // que a escala virou global: ela continua sendo própria em relação ao eixo
    // financeiro (é o que o texto sempre quis dizer), mas agora é a MESMA nos
    // 10 painéis -- e é essa segunda metade que autoriza comparar o
    // comprimento de uma barra âmbar com a do painel de cima.
    + item(COR_EQUIPES, 'Δ equipes (escala própria, igual em todos os painéis)')
    + '<span class="legenda-item legenda-nota">sem base / não lançado: nenhuma barra</span>'
    + '</div>';
}

// Monta a aba inteira: controles + legenda + um <div class="grafico-painel">
// por tipologia presente em 'indices' + o balão de tooltip (posicionado por
// inicializarTooltipBalanco, em render-semanal.js). registros/indices: mesmo
// par que o resto do projeto usa (registros: array completo da MATRIZ;
// indices: quais entram). opcoes: { periodo, base, dimensao, somenteAtivos,
// vigenteIdx, baseline, demandas, ano } -- os 4 primeiros têm default (mesmos
// da aba: mês vigente, Previsto, financeiro, somente ativos ligado);
// vigenteIdx e baseline não têm default sensato e vêm de quem chama
// (render-semanal.js). demandas/ano (opcionais, achado de 2026-08-01): ativam
// o Realizado do Avanço Sond só pra Mês Vigente -- ver o comentário de
// calcularLinhas em compute-balanco.js.
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

  // DUAS passadas de propósito. A primeira só calcula as linhas de cada
  // tipologia; a segunda desenha. No meio ficam as duas grandezas que
  // precisam valer para a aba INTEIRA e que nenhum painel sozinho conhece:
  //
  //   - maxEquipesGlobal: o teto da coluna "Δ equipes", para que comprimento
  //     igual signifique número igual em todos os painéis;
  //   - divisao: como o eixo de valor se reparte entre negativo e positivo,
  //     para que a linha do zero caia sempre no mesmo x.
  //
  // Nenhuma das duas pode ser calculada dentro de renderGraficoTipologia, que
  // só enxerga uma tipologia -- era exatamente essa a origem dos dois
  // problemas que elas corrigem.
  var porTipologia = tipologias.map(function (tipologia) {
    return {
      tipologia: tipologia,
      linhas: calcularLinhas({
        registros: registros, indices: indices, tipologia: tipologia,
        base: base, dimensao: dimensao, periodo: periodo,
        vigenteIdx: vigenteIdx, baseline: baseline, demandas: demandas, ano: ano,
      }),
    };
  });

  // Os globais saem só das linhas que de fato vão aparecer -- o filtro
  // "somente ativos" é aplicado aqui também, senão uma linha escondida
  // esticaria a escala de todo mundo sem nunca ser desenhada.
  function visiveis(linhas) {
    return linhas.filter(function (l) { return somenteAtivos ? !!l.ativo : true; });
  }

  var maxEquipesGlobal = 0;
  var minDesvioGlobal = 0;
  var maxDesvioGlobal = 0;
  var algumDesvio = false;
  porTipologia.forEach(function (item) {
    visiveis(item.linhas).forEach(function (linha) {
      if (linha.desvioEquipes !== null && linha.desvioEquipes !== undefined) {
        var eq = Math.abs(linha.desvioEquipes);
        if (eq > maxEquipesGlobal) maxEquipesGlobal = eq;
      }
      if (linha.semBase || linha.desvio === null || linha.desvio === undefined) return;
      algumDesvio = true;
      if (linha.desvio < minDesvioGlobal) minDesvioGlobal = linha.desvio;
      if (linha.desvio > maxDesvioGlobal) maxDesvioGlobal = linha.desvio;
    });
  });
  var divisao = calcularDivisaoTicks(minDesvioGlobal, maxDesvioGlobal, INTERVALOS_EIXO);

  var graficos = porTipologia.map(function (item) {
    return '<div class="grafico-painel">'
      + renderGraficoTipologia(item.tipologia, item.linhas, {
        somenteAtivos: somenteAtivos, dimensao: dimensao,
        maxEquipesGlobal: maxEquipesGlobal, divisao: divisao,
      })
      + '</div>';
  }).join('');

  var aviso = (tipologias.length && !algumDesvio)
    ? '<p class="aviso-balanco">Nenhum SUP tem Realizado lançado no período selecionado — só a coluna'
      + ' <strong>Δ equipes</strong> tem dado. Troque o Período para comparar contra a base.</p>'
    : '';

  return renderControles({ periodo: periodo, base: base, dimensao: dimensao, somenteAtivos: somenteAtivos })
    + renderLegenda()
    + aviso
    + '<div class="graficos-balanco">' + graficos + '</div>'
    + '<div id="balanco-tooltip" class="grafico-tooltip" style="display:none"></div>';
}

module.exports = {
  renderGraficoTipologia, escalaIndependente, calcularEscalaAncorada, calcularDivisaoTicks, passoBonito,
  renderAbaBalanco, renderControles, renderLegenda, listarTipologias, GEOMETRIA,
};
