'use strict';
const path = require('node:path');
const { formatarMesAno, calcularVigenteIdx, fonteParaCliente: fonteParaClienteDatas } = require('../comum/datas.js');
const { cifrarComSenha } = require('../comum/criptografia.js');
const {
  cssBase, markupCabecalho, markupFiltros, markupAbas, scriptDesbloqueio, scriptFiltros,
} = require('../comum/render-shell.js');
const { trechosParaCliente } = require('../comum/calculo-equipes.js');
const { buildBrowserBundle } = require('../comum/browser-bundle.js');
const { fonteParaCliente: fonteParaClienteTipologiasAvancos } = require('../comum/tipologias-avancos.js');
const { fonteParaCliente: fonteParaClienteTipologiasLab } = require('../comum/tipologias-lab.js');
const { fonteParaCliente: fonteParaClienteLinhaBase } = require('../comum/linha-base.js');

// O cálculo de equipes (DIAS_PREMISSA_MES, mediaEquipesPonderada e
// somarIntervaloEquipeDias) mora em ../comum/calculo-equipes.js, onde é um
// módulo Node de verdade, coberto por teste -- daqui ele volta pro JS de
// cliente como TEXTO, inlinado nas mesmas posições em que as definições
// estavam. Cada trecho já vem com quebra de linha nas duas pontas, então a
// interpolação ocupa uma linha sozinha e reproduz o espaçamento de antes
// (o HTML emitido continua byte-a-byte idêntico -- ver
// test/orcamento-html-inalterado.test.js).
const [TRECHO_DIAS_PREMISSA, TRECHO_EQUIPES] = trechosParaCliente();

// Bundle de navegador (mesmo mecanismo que tools/semanal/render-semanal.js
// já usa em produção) pro botão "Atualizar dados" poder recalcular Demandas
// no cliente sem duplicar as regras de parse-avancos.js/parse-lab.js/
// compute-demandas.js à mão -- ver
// docs/superpowers/specs/2026-08-13-orcamento-atualizar-demandas-design.md.
// compute-semanal.js entra só porque compute-demandas.js consome diaEpoch
// dele via require('./compute-semanal.js'), same-dir -- precisa vir ANTES
// dele na lista (mesma ordem que BUNDLE_ARQUIVOS usa na semanal).
const BUNDLE_DEMANDAS = buildBrowserBundle(
  path.join(__dirname, '..', 'semanal'),
  ['compute-semanal.js', 'parse-avancos.js', 'parse-lab.js', 'compute-demandas.js']
);

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderCabecalhoMeses(periodos) {
  return periodos.map(data => `<th>${formatarMesAno(data)}</th>`).join('');
}

// A página roda dois scripts, montados como um só: primeiro o gate de
// senha, que SEMPRE roda (não depende de senha) e só destrava a página, e
// depois o SCRIPT_CLIENTE_TABELA abaixo, que faz o trabalho de fato. O gate
// virou casca compartilhada e mora em ../comum/render-shell.js
// (scriptDesbloqueio); daqui ele entra pela chamada lá embaixo, no <script>.

// Roda só DEPOIS que a senha certa decifra os registros (chamado por
// montarDashboard, no fim do gate em ../comum/render-shell.js). Reimplementa
// em JS de navegador (sem require, HTML estático sem bundler) a mesma
// montagem de linhas/cores/filtros que antes rodava no servidor em
// tools/orcamento/render-dashboard.js -- precisa ser assim porque os
// PRÓPRIOS valores de SUP/Grupo/Tomador/Tipologia (não só os números
// mensais) são dados protegidos pela senha; se a tabela viesse pronta do
// servidor, esses nomes apareceriam em texto puro no código-fonte da
// página mesmo sem a senha certa.
const SCRIPT_CLIENTE_TABELA = `
var ParseAvancos = MODULOS['parse-avancos.js'];
var ParseLab = MODULOS['parse-lab.js'];
var ComputeDemandas = MODULOS['compute-demandas.js'];

// casasDecimais default 2 (mantém o comportamento de sempre pra quem já
// chama sem o argumento) -- Equipes usa 0 (arredonda pra inteiro: "número
// de equipes" não existe fracionado na prática, mesmo a planilha de origem
// tendo médias/frações internamente).
function formatarNumero(v, casasDecimais) {
  if (v === null || v === undefined) return '—';
  var casas = casasDecimais === undefined ? 2 : casasDecimais;
  var fator = Math.pow(10, casas);
  // min/maxFractionDigits força SEMPRE exatamente essa quantidade de casas
  // (ex. "10,00", não "10") -- toLocaleString sozinho, sem essas opções,
  // descarta zero à direita ("10,00" viraria "10"), o que pareceria "sem
  // decimais" pra quem olha, mesmo a rodagem em si já estando certa.
  return (Math.round(v * fator) / fator).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}
function somar(array) { return (array || []).reduce(function (a, b) { return a + (b || 0); }, 0); }
// null num mês = nenhum registro que contribui pra essa soma tem dado
// digitado ali ainda (ver render-dashboard: R/P ficam em branco, não 0,
// quando a planilha de origem não tinha valor pro mês) -- soma[i] só vira
// número quando ALGUM dos arrays tem valor real naquele mês; um contribuinte
// em branco simplesmente não participa da soma, não vira 0 nela.
function somarArraysMensais(arrays) {
  var soma = new Array(12).fill(null);
  arrays.forEach(function (arr) {
    if (!arr) return;
    for (var i = 0; i < 12; i++) {
      if (arr[i] === null || arr[i] === undefined) continue;
      soma[i] = (soma[i] || 0) + arr[i];
    }
  });
  return soma;
}

var CAMPOS_RATIO = {
  produtividade: { numerador: 'volume', denominador: 'equipes' },
  ticketMedio: { numerador: 'financeiro', denominador: 'volume' },
};
${TRECHO_DIAS_PREMISSA}
// Fecha a Tendência (série "total") do mês vigente combinando o Realizado
// parcial já ocorrido com a projeção da própria linha T da planilha pra
// completar o mês -- meses já fechados (antes do vigente) passam a valer
// pelo Realizado (fato, não projeção); meses futuros continuam com o valor
// cru da linha T. Financeiro/Volume são fluxos do mês (o que já rodou + o
// que falta pra fechar = soma); Equipes é uma foto (headcount), somar
// contaria equipe em dobro -- usa o maior dos dois em vez de somar.
// Confirmado com o usuário (2026-07-27): vale pro dashboard inteiro
// (Tabela/Gráfico/Alertas), aplicado uma vez nos 2 pontos onde
// window.__REGISTROS__ é definido (gate de senha e live-refresh) -- nunca
// dentro de calcularMensal/bucketPeriodo/calcularTotalAno.
function fecharValorMesVigenteFluxo(totalMes, realizadoMes) {
  if ((totalMes === null || totalMes === undefined) && (realizadoMes === null || realizadoMes === undefined)) return null;
  return (realizadoMes || 0) + (totalMes || 0);
}
function fecharValorMesVigenteEquipes(totalMes, realizadoMes) {
  if ((totalMes === null || totalMes === undefined) && (realizadoMes === null || realizadoMes === undefined)) return null;
  return Math.max(realizadoMes || 0, totalMes || 0);
}
var CAMPOS_FECHAMENTO_VIGENTE = { equipes: fecharValorMesVigenteEquipes, volume: fecharValorMesVigenteFluxo, financeiro: fecharValorMesVigenteFluxo };

function fecharSerieMensal(totalMensal, realizadoMensal, vigenteIdx, fechar) {
  return totalMensal.map(function (v, i) {
    if (i < vigenteIdx) {
      var r = realizadoMensal ? realizadoMensal[i] : null;
      return (r === null || r === undefined) ? v : r;
    }
    if (i === vigenteIdx) return fechar(v, realizadoMensal ? realizadoMensal[i] : null);
    return v;
  });
}

// Não é idempotente -- chamar 2x sobre o mesmo resultado dobraria o mês
// vigente (Financeiro/Volume somam, então a 2ª chamada somaria de novo).
// Os 2 pontos de chamada reais sempre passam um array recém-atribuído
// (JSON.parse ou o resultado de um novo fetch), nunca o retorno desta
// própria função -- mantenha essa invariante se adicionar um 3º ponto.
// dados: o que o gate acabou de JSON.parse -- {registros, demandasChegadasMensais,
// demandasSaldoAbertura} (ver renderDashboard). Guarda os dois campos de
// Demandas em window.__DEMANDAS_MENSAIS__/__DEMANDAS_SALDO_ABERTURA__ SÓ
// quando presentes -- atualizarDadosAoVivo chama esta mesma função de novo
// com um array puro (a MATRIZ espelho não tem Demandas), e sobrescrever
// incondicionalmente apagaria as Demandas do build a cada "Atualizar dados
// ao vivo". Mesmo espírito de window.__DEMANDAS__ em
// tools/semanal/render-semanal.js, com a exceção condicional documentada
// acima.
function fecharTendenciaVigente(dados, vigenteIdx) {
  if (dados && dados.demandasChegadasMensais) window.__DEMANDAS_MENSAIS__ = dados.demandasChegadasMensais;
  if (dados && dados.demandasSaldoAbertura) window.__DEMANDAS_SALDO_ABERTURA__ = dados.demandasSaldoAbertura;
  var registros = (dados && dados.registros) ? dados.registros : dados;
  if (vigenteIdx < 0 || vigenteIdx > 11) return registros; // fora do ano coberto -- nada a fechar
  return registros.map(function (registro) {
    if (!registro.total) return registro;
    var realizado = registro.realizado;
    var totalFechado = Object.assign({}, registro.total);
    ['equipes', 'volume', 'financeiro'].forEach(function (campo) {
      if (!Array.isArray(registro.total[campo])) return;
      // Realizado pode ter zeros artificiais de "mês ainda não reportado"
      // (ver removerZerosFinaisNaoReportados) -- sem tratar isso aqui, esse
      // 0 falso passaria por "dado real" e sobrescreveria a projeção de
      // verdade da linha T naquele mês, recriando o mesmo problema que esta
      // função existe pra resolver.
      var realizadoCampo = realizado && Array.isArray(realizado[campo]) ? removerZerosFinaisNaoReportados(realizado[campo]) : null;
      totalFechado[campo] = fecharSerieMensal(registro.total[campo], realizadoCampo, vigenteIdx, CAMPOS_FECHAMENTO_VIGENTE[campo]);
    });
    return Object.assign({}, registro, { total: totalFechado });
  });
}

// valoresLista: array de "valores" de UMA série (previsto/realizado/total),
// um item por registro agregado (lista de 1 item no caso normal de uma
// única tipologia; vários itens nas linhas de total por SUP/geral). Devolve
// os 12 valores mensais na dimensão escolhida. Previsto de produtividade/
// ticketMedio, quando é UMA ÚNICA tipologia, usa a premissa fixa da
// planilha (PROD./TICKET, nunca recalculada); quando agrega várias
// tipologias, não existe premissa própria do agregado, então usa a mesma
// razão-a-partir-da-soma que Realizado/Tendência (produtividade = Σvolume ÷
// (Σequipes × dias do mês), ticketMedio = Σfinanceiro ÷ Σvolume -- fórmulas
// confirmadas com o usuário, estendidas aqui pra somar através das
// tipologias, não só dos meses).
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
    return numeradorMensal.map(function (v, i) {
      if (v === null || v === undefined || !denominadorMensal[i]) return null;
      var denominador = dimensao === 'produtividade' ? denominadorMensal[i] * DIAS_PREMISSA_MES[i] : denominadorMensal[i];
      return v / denominador;
    });
  }
  return somarArraysMensais(lista.map(function (v) { return v[dimensao]; }));
}

// Coluna "Total" (ano inteiro) da mesma linha -- soma os 12 meses pras
// dimensões-fluxo (Financeiro/Volume); Equipes usa média ponderada por dias
// (mediaEquipesPonderada, não soma -- é uma foto por mês, não um fluxo);
// produtividade/ticketMedio recalculam a razão a partir da soma do
// numerador/denominador do ANO INTEIRO, nunca a soma das razões mensais
// (somar "R$/m³" de 12 meses não seria um número válido).
function calcularTotalAno(valoresLista, serie, dimensao) {
  var lista = valoresLista.filter(Boolean);
  if (!lista.length) return null;
  var ratio = CAMPOS_RATIO[dimensao];
  if (ratio) {
    if (serie === 'previsto' && lista.length === 1) {
      return dimensao === 'produtividade' ? lista[0].equipesResumo.prod : lista[0].volumeResumo.ticket;
    }
    var numeradorTotal = somar(lista.map(function (v) { return somar(v[ratio.numerador]); }));
    var denominadorTotal;
    if (dimensao === 'produtividade') {
      // Soma equipe-dias do ano (não só equipes) -- consistente com o mês a
      // mês de calcularMensal: um total anual "por equipe-mês" misturaria
      // meses de 15 e 30 dias com o mesmo peso, o que não bate com a soma
      // dos meses individuais.
      denominadorTotal = somar(lista.map(function (v) {
        return somar((v[ratio.denominador] || []).map(function (equipesMes, i) { return (equipesMes || 0) * DIAS_PREMISSA_MES[i]; }));
      }));
    } else {
      denominadorTotal = somar(lista.map(function (v) { return somar(v[ratio.denominador]); }));
    }
    return denominadorTotal ? numeradorTotal / denominadorTotal : null;
  }
  if (dimensao === 'equipes') return mediaEquipesPonderada(somarArraysMensais(lista.map(function (v) { return v[dimensao]; })), 0, 12);
  return somar(lista.map(function (v) { return somar(v[dimensao]); }));
}

// Buckets de período pra aba Alertas -- [inicio, fimExclusivo) de meses,
// no mesmo array de 12 posições que calcularMensal já usa. mesVigente/
// m1/m2/m3 são um mês só; os outros somam uma faixa. Fora do range 0..11
// (vigenteIdx pode ser -1 ou 12, ver calcularVigenteIdx em datas.js) o
// próprio somarIntervaloMensal já clampa e devolve null/0 corretamente.
var PERIODOS_ALERTAS_INTERVALO = {
  acumuladoAnterior: function (v) { return [0, v]; },
  mesVigente: function (v) { return [v, v + 1]; },
  m1: function (v) { return [v + 1, v + 2]; },
  m2: function (v) { return [v + 2, v + 3]; },
  m3: function (v) { return [v + 3, v + 4]; },
  acumuladoFuturo: function (v) { return [v + 4, 12]; },
  acumuladoAteVigente: function (v) { return [0, v + 1]; },
  totalAno: function () { return [0, 12]; },
};

// Soma só os meses [inicio, fim) -- null quando NENHUM mês do intervalo tem
// dado (nada foi reportado ainda nessa janela inteira), senão soma o que
// tem tratando um mês individual em branco dentro do intervalo como 0
// (mesma convenção de somarArraysMensais, generalizada de "vários
// registros no mesmo mês" pra "vários meses no mesmo intervalo").
function somarIntervaloMensal(mensal, inicio, fim) {
  var soma = null;
  var ini = Math.max(0, inicio), lim = Math.min(mensal.length, fim);
  for (var i = ini; i < lim; i++) {
    if (mensal[i] === null || mensal[i] === undefined) continue;
    soma = (soma === null ? 0 : soma) + mensal[i];
  }
  return soma;
}
${TRECHO_EQUIPES}
// Valor de UMA série (previsto/realizado/total), pra UMA dimensão, bucketado
// num intervalo [inicio, fim) arbitrário -- generaliza calcularMensal/
// calcularTotalAno (que só sabem fazer "todos os 12 meses" ou "1 mês").
// Dimensões de razão NUNCA fazem média das razões mensais -- somam
// numerador/denominador brutos no intervalo e só então dividem (exatamente
// como calcularTotalAno já faz pro ano inteiro), exceto a premissa fixa do
// Previsto de uma única tipologia, que independe do período (mesmo caso
// especial de calcularMensal/calcularTotalAno). (Exceção: dimensão Equipes
// nunca soma através de vários meses -- usa mediaEquipesPonderada, ver o
// final da função.) Extraída de bucketPeriodo (aba Alertas) pra também
// servir o Total do ano da Tendência na Tabela (ver preencherLinha), que
// soma só do mês vigente em diante, não os 12 meses inteiros.
function bucketIntervalo(valoresLista, serie, dimensao, inicio, fim) {
  var lista = valoresLista.filter(Boolean);
  if (!lista.length) return null;
  var ratio = CAMPOS_RATIO[dimensao];
  if (ratio) {
    if (serie === 'previsto' && lista.length === 1) {
      var premissa = dimensao === 'produtividade' ? lista[0].equipesResumo.prod : lista[0].volumeResumo.ticket;
      return (premissa === null || premissa === undefined) ? null : premissa;
    }
    var numeradorMensal = somarArraysMensais(lista.map(function (v) { return v[ratio.numerador]; }));
    var denominadorMensal = somarArraysMensais(lista.map(function (v) { return v[ratio.denominador]; }));
    var numeradorBucket = somarIntervaloMensal(numeradorMensal, inicio, fim);
    var denominadorBucket = dimensao === 'produtividade'
      ? somarIntervaloEquipeDias(denominadorMensal, inicio, fim)
      : somarIntervaloMensal(denominadorMensal, inicio, fim);
    if (numeradorBucket === null || !denominadorBucket) return null;
    return numeradorBucket / denominadorBucket;
  }
  var mensal = somarArraysMensais(lista.map(function (v) { return v[dimensao]; }));
  return dimensao === 'equipes' ? mediaEquipesPonderada(mensal, inicio, fim) : somarIntervaloMensal(mensal, inicio, fim);
}

// Aba Alertas: mesmo bucketIntervalo acima, só resolvendo o [inicio, fim)
// a partir de um dos períodos fixos (acumuladoAnterior/mesVigente/M+1..3/
// acumuladoFuturo/acumuladoAteVigente/totalAno, ver PERIODOS_ALERTAS_INTERVALO).
function bucketPeriodo(valoresLista, serie, dimensao, periodo, vigenteIdx) {
  var intervalo = PERIODOS_ALERTAS_INTERVALO[periodo](vigenteIdx);
  return bucketIntervalo(valoresLista, serie, dimensao, intervalo[0], intervalo[1]);
}

// Faixas fixas do semáforo (spec 2026-07-23) -- mesma regra pra todas as
// dimensões, já que Financeiro aqui é receita bruta (não custo): maior é
// sempre melhor, sem inversão. Limites: >110% azul; 90%-110% (inclusive
// nas duas pontas) verde; 70%-90% (70 inclusive, 90 exclusivo) amarelo;
// <70% vermelho; sem dado (desvio null) cinza.
function classificarSemaforo(desvio) {
  if (desvio === null || desvio === undefined) return { cor: '#6E7580', indicador: 'Sem dado' };
  if (desvio > 1.10) return { cor: '#1414CC', indicador: 'Excelente' };
  if (desvio >= 0.90) return { cor: '#128A3E', indicador: 'Dentro da meta' };
  if (desvio >= 0.70) return { cor: '#F5A700', indicador: 'Atenção' };
  return { cor: '#D32020', indicador: 'Crítico' };
}

// Uma coluna por combinação marcada de Período×Numérico×Baseline, na
// ordem fixa Período -> Numérico -> Baseline (spec 2026-07-23) -- nunca a
// ordem em que a pessoa marcou os checkboxes.
function colunasAlertas(numericos, baselines, periodos) {
  var colunas = [];
  // Ordena por ordem canônica, não pela ordem que o usuário marcou
  var numericosOrdenados = emOrdemCanonica(NUMERICO_ORDEM, new Set(numericos));
  var baselinesOrdenadas = emOrdemCanonica(BASELINE_ORDEM, new Set(baselines));
  var periodosOrdenados = emOrdemCanonica(PERIODO_ORDEM, new Set(periodos));
  periodosOrdenados.forEach(function (periodo) {
    numericosOrdenados.forEach(function (numerico) {
      baselinesOrdenadas.forEach(function (baseline) {
        colunas.push({
          numerico: numerico, baseline: baseline, periodo: periodo,
          rotulo: SERIE_LABELS[numerico] + ' ÷ ' + SERIE_LABELS[baseline] + ' — ' + PERIODO_LABELS[periodo],
        });
      });
    });
  });
  return colunas;
}

// Bucketa numérico e baseline pro grupo de índices dado (soma os
// registros do grupo, ver bucketPeriodo) e divide -- null (sem dado)
// quando o denominador bucketado é 0/null, ou quando o numerador vier
// null (nada reportado ainda nesse intervalo).
function calcularCelulaAlerta(registros, indices, coluna, dimensao, vigenteIdx) {
  var valoresNumerico = indices.map(function (i) { return registros[i][coluna.numerico]; });
  var valoresBaseline = indices.map(function (i) { return registros[i][coluna.baseline]; });
  var numerador = bucketPeriodo(valoresNumerico, coluna.numerico, dimensao, coluna.periodo, vigenteIdx);
  var denominador = bucketPeriodo(valoresBaseline, coluna.baseline, dimensao, coluna.periodo, vigenteIdx);
  var desvio = (numerador === null || !denominador) ? null : numerador / denominador;
  return { desvio: desvio, numerador: numerador, denominador: denominador };
}

var AGRUPAR_POR_ROTULO = { sup: 'SUP', tipologia: 'Tipologia', grupo: 'Grupo', categoria: 'Categoria', origem: 'Origem' };

function renderCabecalhoAlertas(agruparPorRotulo, dimensaoRotulo) {
  return '<tr><th>' + escapeHtml(agruparPorRotulo) + '</th><th>Tomador</th><th>Combinação</th><th>Referência (' + escapeHtml(dimensaoRotulo) + ')</th><th>Pesquisado (' + escapeHtml(dimensaoRotulo) + ')</th><th>Desvio</th><th>Status</th></tr>';
}

// Tomador do grupo -- só é um valor único de verdade quando agruparPor é
// "sup" (1 SUP = 1 tomador sempre). Agrupando por tipologia/categoria/
// grupo/origem, ou na linha TOTAL GERAL, o grupo quase sempre cruza vários
// tomadores diferentes -- "Vários" deixa isso explícito em vez de mostrar
// só o 1º encontrado, que pareceria (errado) que só existe aquele tomador.
function tomadorDoGrupo(registros, indices) {
  var tomadores = [];
  indices.forEach(function (idx) {
    var t = registros[idx].tomador;
    if (t && tomadores.indexOf(t) === -1) tomadores.push(t);
  });
  if (tomadores.length === 0) return '—';
  if (tomadores.length === 1) return tomadores[0];
  return 'Vários';
}

// Uma linha por (grupo, combinação) -- Referência/Pesquisado são os
// valores absolutos que antes só apareciam no tooltip (feedback do
// usuário: queria conferir o dado, não só confiar na %). Status é um
// círculo cheio (não um badge com borda, nem fundo de célula colorido --
// pedido explícito) seguido do rótulo por extenso. statusFiltro (Set dos
// rótulos marcados no filtro dedicado de Status, ver FILTROS_ALERTAS_CONFIG)
// omite a linha inteira quando marcado e o status calculado não bate --
// Set vazio/undefined mostra tudo, mesma convenção dos filtros de recorte.
function renderLinhaAlerta(rotuloGrupo, tomadorGrupo, registros, indices, coluna, dimensao, vigenteIdx, statusFiltro) {
  var celula = calcularCelulaAlerta(registros, indices, coluna, dimensao, vigenteIdx);
  var classe = classificarSemaforo(celula.desvio);
  if (statusFiltro && statusFiltro.size > 0 && !statusFiltro.has(classe.indicador)) return '';
  var desvioTexto = celula.desvio === null ? '—' : Math.round(celula.desvio * 100) + '%';
  // Produtividade sempre em 2 casas decimais (pedido explícito), igual à
  // tabela principal (ver preencherLinha) -- resto das dimensões continua inteiro.
  var casasDecimaisAlerta = dimensao === 'produtividade' ? 2 : 0;
  var referencia = formatarNumero(celula.denominador, casasDecimaisAlerta);
  var pesquisado = formatarNumero(celula.numerador, casasDecimaisAlerta);
  var busca = normalizarBusca(rotuloGrupo + ' ' + tomadorGrupo + ' ' + coluna.rotulo);
  return '<tr data-search="' + escapeHtml(busca) + '">' +
    '<td>' + escapeHtml(rotuloGrupo) + '</td>' +
    '<td>' + escapeHtml(tomadorGrupo) + '</td>' +
    '<td>' + escapeHtml(coluna.rotulo) + '</td>' +
    '<td class="num">' + referencia + '</td>' +
    '<td class="num">' + pesquisado + '</td>' +
    '<td class="num">' + desvioTexto + '</td>' +
    '<td><span class="status-circulo" style="background:' + classe.cor + '"></span>' + escapeHtml(classe.indicador) + '</td>' +
    '</tr>';
}

function renderLinhasGrupoAlerta(rotuloGrupo, registros, indices, colunas, dimensao, vigenteIdx, statusFiltro) {
  var tomadorGrupo = tomadorDoGrupo(registros, indices);
  return colunas.map(function (c) { return renderLinhaAlerta(rotuloGrupo, tomadorGrupo, registros, indices, c, dimensao, vigenteIdx, statusFiltro); }).join('');
}

function renderCorpoAlertas(registros, indices, agruparPor, dimensao, numericos, baselines, periodos, vigenteIdx, statusFiltro) {
  var colunas = colunasAlertas(numericos, baselines, periodos);
  var grupos = agruparIndicesAlertas(registros, indices, agruparPor);
  var linhas = grupos.map(function (g) { return renderLinhasGrupoAlerta(g.chave, registros, g.indices, colunas, dimensao, vigenteIdx, statusFiltro); });
  linhas.push(renderLinhasGrupoAlerta('TOTAL GERAL', registros, indices, colunas, dimensao, vigenteIdx, statusFiltro));
  return linhas.join('');
}

// Soma corrida mês a mês -- acumulado[i] = mensal[0]+...+mensal[i]. Trata
// null/undefined como 0 (não dá pra "acumular" um mês sem dado, mas
// também não pode quebrar a soma corrida dos meses seguintes).
function calcularAcumulado(mensal) {
  var soma = 0;
  return mensal.map(function (v) {
    soma += v || 0;
    return soma;
  });
}

// Índice (0=Jan..11=Dez) do último mês com dado real em \`mensal\` -- -1 se
// nenhum mês tem dado. Usado pra achar onde Realizado "parou" de ser
// reportado, tanto pra parar de desenhar Realizado dali em diante quanto
// pra saber onde a Tendência deve começar (ver construirPainelGraficoHtml).
function ultimoIndiceComDado(mensal) {
  for (var i = mensal.length - 1; i >= 0; i--) {
    if (mensal[i] !== null && mensal[i] !== undefined) return i;
  }
  return -1;
}

// Acumulado de uma série "pós-Realizado" (Tendência, ou Realizado +
// Previsto Inicial) nunca recomeça do zero em Jan -- a SOMA interna
// continua exatamente de onde o acumulado de Realizado parou, pra o
// primeiro mês futuro somar em cima do total real já reportado. O PONTO
// de conexão (o último mês de Realizado) TEM valor aqui -- igual ao
// acumulado real de Realizado ali -- pra existir um ponto de onde a linha
// da série futura possa partir (ver construirLinhasSvg/indiceConector: é o
// desenho SVG, não esta função, quem decide não duplicar marcador/rótulo
// nesse mês, já que Realizado desenha os dois ali). Sem nenhum mês de
// Realizado (ultimoMesRealizado -1), a série futura acumula sozinha desde
// Jan, do jeito usual.
function calcularAcumuladoAposRealizado(mensalFutura, acumuladoRealizado, ultimoMesRealizado) {
  if (ultimoMesRealizado === -1) return calcularAcumulado(mensalFutura);
  var resultado = new Array(mensalFutura.length).fill(null);
  var acumuladoAntes = ultimoMesRealizado > 0 ? (acumuladoRealizado[ultimoMesRealizado - 1] || 0) : 0;
  // No mês de conexão, mensalFutura já pode trazer o valor FECHADO da
  // Tendência (Realizado do mês + o que a própria linha T projeta pra
  // completar o mês, ver fecharTendenciaVigente) -- usa esse valor
  // diretamente em vez de só herdar o acumulado puro de Realizado, senão o
  // Acumulado deste painel fecha o ano com um número menor que o da Tabela/
  // Alertas (que somam registro.total direto, já fechado).
  var valorConector = (mensalFutura[ultimoMesRealizado] === null || mensalFutura[ultimoMesRealizado] === undefined)
    ? (acumuladoRealizado[ultimoMesRealizado] || 0) - acumuladoAntes
    : mensalFutura[ultimoMesRealizado];
  var soma = acumuladoAntes + valorConector;
  resultado[ultimoMesRealizado] = soma;
  for (var i = ultimoMesRealizado + 1; i < mensalFutura.length; i++) {
    soma += mensalFutura[i] || 0;
    resultado[i] = soma;
  }
  return resultado;
}

// Alguns blocos de mês da MATRIZ (achado real: Financeiro do Realizado)
// usam uma fórmula que devolve 0 pro mês ainda não reportado, em vez de
// deixar a célula em branco -- Equipes/Volume do mesmo mês corretamente
// ficam null, só Financeiro tem esse artefato. Sem tratar isso, esse 0
// artificial passa pro resto do código como se fosse "mês reportado":
// ultimoIndiceComDado acha esse mês como o último Realizado quando não tem
// dado nenhum, e a Tendência perde de vez a contribuição real desse mês (o
// acumulado "gruda" no valor do mês anterior em vez de somar a Tendência
// dali em diante -- o mês parece ter "efeito zero"). Varre do fim pro
// começo pulando zeros E nulls (o artefato de fim de série mistura os
// dois, ver caso real acima) até achar um mês com dado de verdade
// (não-zero) -- só então zera qualquer 0 exato encontrado depois desse
// ponto. Não mexe num zero seguido de outro mês com dado real (não é
// "final da série", é um zero real no meio de meses já reportados).
function removerZerosFinaisNaoReportados(mensal) {
  var resultado = mensal.slice();
  var i = resultado.length - 1;
  while (i >= 0 && (resultado[i] === 0 || resultado[i] === null || resultado[i] === undefined)) i--;
  for (var j = i + 1; j < resultado.length; j++) {
    if (resultado[j] === 0) resultado[j] = null;
  }
  return resultado;
}

// Acumulado de Realizado não continua reto (flat) até dezembro depois do
// último mês reportado -- corta ali (null dali em diante), igual ao painel
// Mensal, pra não parecer que o total "parou de crescer" já sabendo de
// verdade, quando na real é só que ainda não tem dado. É a partir desse
// mesmo ponto de corte que calcularAcumuladoAposRealizado continua a linha.
function cortarAcumuladoNoUltimoDado(acumulado, mensal) {
  var ultimo = ultimoIndiceComDado(mensal);
  return acumulado.map(function (v, i) { return i <= ultimo ? v : null; });
}

// Mesmo cinza claro usado na linha "Previsto Inicial" da tabela (.linha-previsto-inicial),
// pra não inventar uma cor nova pra mesma série. 6 entradas ao todo (só do
// Gráfico, ver ORDEM_SERIES_GRAFICO): 4 hues distintas (cinza/azul/verde/
// âmbar) mais 2 roxos -- realizadoPrevistoInicial no lilás claro (#a78bfa) e
// demandas, o mais novo, num roxo mais saturado (#9700DA) pra não se
// confundir com o primeiro.
var SERIE_COR = { previstoInicial: '#8b8a82', previsto: '#2f6ad0', realizado: '#7fd858', total: '#f6b53f', realizadoPrevistoInicial: '#a78bfa', demandas: '#9700DA' };
// Tracejado por série além da cor -- segunda camada de identidade (não só
// hue) pra sobreviver a daltonismo/impressão P&B: previsto inicial pontilhado
// esparso (mais discreto, é a referência de fundo), previsto sólido,
// realizado pontilhado fino, tendência tracejado longo, realizado+previsto
// inicial dash-dot (distinto dos outros 4 traços), demandas tracejado médio
// (distinto dos outros 5).
var SERIE_TRACEJADO = { previstoInicial: '2,4', previsto: '', realizado: '1,5', total: '9,5', realizadoPrevistoInicial: '6,3,1,3', demandas: '4,2' };
var DIMENSOES_RAZAO = ['produtividade', 'ticketMedio'];
var MESES_ABREVIADOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

var GRAFICO_LARGURA = 1000;
var GRAFICO_ALTURA_BARRAS = 320;
var GRAFICO_ALTURA_LINHA = 280;
// Dois painéis, eixo único cada -- direita só precisa de espaço pro rótulo
// do último mês não vazar da borda (não tem mais 2º eixo do lado direito).
var GRAFICO_MARGEM_BARRAS = { topo: 36, baixo: 36, esquerda: 68, direita: 28 };
var GRAFICO_MARGEM_LINHA = { topo: 36, baixo: 36, esquerda: 68, direita: 36 };
var GRAFICO_NUM_TICKS = 4;
var GRAFICO_BARRA_MAX = 24;
var GRAFICO_BARRA_GAP = 2;
// Acima desse valor bruto (não escalado) o gráfico passa a exibir em
// milhares -- assim um recorte pequeno (poucas centenas) não vira "0"
// depois de dividido, e o eixo/rótulos ganham "(em milhares)" no título.
var GRAFICO_LIMIAR_MILHARES = 1000;

// Mapeia um valor pra uma distância em pixels dentro de [0, pixelMax],
// proporcional a valorMax -- 0 quando valorMax é 0 (evita divisão por
// zero quando não há nenhum dado no recorte filtrado).
function escalaLinear(valor, valorMax, pixelMax) {
  if (!valorMax) return 0;
  return (valor / valorMax) * pixelMax;
}

// Arredonda o teto do eixo Y pro próximo passo "limpo" (degrau x 10^n), do
// jeito que uma pessoa desenharia à mão -- os ticks caem em números
// redondos (0 / 500 / 1.000...) em vez de frações arbitrárias do máximo.
// Degraus 1/1,5/2/2,5/3/4/5/6/8/10 (não só 1/2/2,5/5/10): o salto de 2,5
// direto pra 5 sobrava até quase 2x o teto real (achado no gráfico
// Acumulado — dezembro fechava em ~110.000 e o eixo ia até 200.000, mais
// da metade do painel vazia); com os degraus intermediários, o pior caso
// de sobra cai de ~100% pra ~50%, mantendo o mesmo espírito de número
// redondo.
var GRAFICO_DEGRAUS_ESCALA = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
function calcularEscalaEixo(valorMax) {
  if (!valorMax || valorMax <= 0) return { max: 1, passo: 0.25 };
  var passoBruto = valorMax / GRAFICO_NUM_TICKS;
  var magnitude = Math.pow(10, Math.floor(Math.log10(passoBruto)));
  var normalizado = passoBruto / magnitude;
  var passoNormalizado = GRAFICO_DEGRAUS_ESCALA.find(function (degrau) { return normalizado <= degrau; }) || 10;
  var passo = passoNormalizado * magnitude;
  return { max: passo * GRAFICO_NUM_TICKS, passo: passo };
}

// Formata um valor pro que aparece NO gráfico (eixo, rótulo de coluna/linha)
// -- em milhares quando o recorte é grande o bastante pra fazer sentido.
// O tooltip usa formatarNumero puro (valor exato), nunca esta função: hover
// é onde a pessoa vai quando quer o número completo, não o arredondado.
function formatarValorGrafico(valor, usarMilhares, casasDecimais) {
  if (valor === null || valor === undefined) return '—';
  var base = usarMilhares ? valor / 1000 : valor;
  var casas = casasDecimais === undefined ? 2 : casasDecimais;
  var fator = Math.pow(10, casas);
  return (Math.round(base * fator) / fator).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function construirEixoXSvg(larguraMes, alturaPlot, margem) {
  var svg = '';
  for (var mes = 0; mes < 12; mes++) {
    var x = margem.esquerda + mes * larguraMes + larguraMes / 2;
    var y = margem.topo + alturaPlot + 20;
    svg += '<text class="grafico-eixo-texto" x="' + x.toFixed(1) + '" y="' + y + '" text-anchor="middle">' + MESES_ABREVIADOS[mes] + '</text>';
  }
  return svg;
}

function construirEixoYSvg(escala, alturaPlot, margem, ladoDireita, usarMilhares, casasDecimais) {
  var svg = '';
  for (var i = 0; i <= GRAFICO_NUM_TICKS; i++) {
    var valor = i * escala.passo;
    var y = margem.topo + alturaPlot - (valor / escala.max) * alturaPlot;
    var x = ladoDireita ? (GRAFICO_LARGURA - margem.direita + 10) : (margem.esquerda - 10);
    var ancora = ladoDireita ? 'start' : 'end';
    svg += '<text class="grafico-eixo-texto" x="' + x + '" y="' + (y + 4).toFixed(1) + '" text-anchor="' + ancora + '">' + formatarValorGrafico(valor, usarMilhares, casasDecimais) + '</text>';
    if (!ladoDireita) {
      svg += '<line class="grafico-gridline" x1="' + margem.esquerda + '" y1="' + y.toFixed(1) + '" x2="' + (GRAFICO_LARGURA - margem.direita) + '" y2="' + y.toFixed(1) + '"/>';
    }
  }
  return svg;
}

// Legenda só entra com 2+ séries -- com uma série só, o título do painel já
// diz o que é. O traço da legenda repete o tracejado da série, então o
// canal secundário (não só a cor) já aparece ali.
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

// Desenha uma barra/coluna com topo arredondado (4px) e base quadrada,
// ancorada na baseline -- nunca um <rect> puro com cantos vivos nos 4 lados.
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

// Empurra rótulos que colidem (caixa estimada pela largura do texto) pra
// baixo do que colidiram, na ordem de cima pra baixo -- usado tanto pros
// rótulos de coluna quanto de linha JUNTOS, porque num eixo duplo os dois
// grupos têm escalas diferentes e podem convergir na mesma faixa vertical
// num mês onde ambas as séries estão perto do teto do seu próprio eixo
// (ex.: o último mês, que costuma ser o maior tanto no valor do mês quanto
// no acumulado). Empurrar só dentro do próprio grupo não pega esse caso.
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

// Colunas agrupadas por mês, largura travada em <=24px com um respiro de
// 2px entre colunas vizinhas (nunca encostadas). Rótulo sempre visível em
// cada coluna (a pedido) -- fica denso com 3 séries, mas o valor exato
// também mora no tooltip (hover/foco) e na aba Tabela. Os candidatos a
// rótulo são só ACUMULADOS em \`rotulos\` -- desenhados depois, junto com os
// da linha, numa única passada de anti-colisão (ver construirGraficoSvg).
function construirColunasSvg(dadosPorSerie, escala, alturaPlot, larguraMes, margem, usarMilhares, rotulos, casasDecimais) {
  var svg = '';
  var numSeries = dadosPorSerie.length;
  var slot = larguraMes * 0.72;
  var larguraColuna = Math.min(GRAFICO_BARRA_MAX, (slot - GRAFICO_BARRA_GAP * (numSeries - 1)) / numSeries);
  var slotOcupado = larguraColuna * numSeries + GRAFICO_BARRA_GAP * (numSeries - 1);

  for (var mes = 0; mes < 12; mes++) {
    var inicioSlot = margem.esquerda + mes * larguraMes + (larguraMes - slotOcupado) / 2;
    dadosPorSerie.forEach(function (d, i) {
      var valor = d.mensal[mes];
      // null = mês sem dado reportado ainda (nunca 0 -- ver
      // somarArraysMensais) -- não desenha nada pra essa série nesse mês,
      // em vez de uma coluna fantasma na base do eixo.
      if (valor === null || valor === undefined) return;
      var alturaColuna = escalaLinear(valor, escala.max, alturaPlot);
      var x = inicioSlot + i * (larguraColuna + GRAFICO_BARRA_GAP);
      var y = margem.topo + alturaPlot - alturaColuna;
      svg += desenharBarraArredondada(x, y, larguraColuna, alturaColuna, SERIE_COR[d.serie]);
      svg += '<rect class="grafico-hit" data-tooltip="' + MESES_ABREVIADOS[mes] + ' · ' + SERIE_LABELS[d.serie] + ': ' + formatarNumero(valor, casasDecimais) + '" x="' + x.toFixed(1) + '" y="' + margem.topo + '" width="' + Math.max(larguraColuna, GRAFICO_BARRA_GAP).toFixed(1) + '" height="' + alturaPlot + '" fill="transparent"/>';
      if (valor) {
        rotulos.push({ x: x + larguraColuna / 2, y: y - 6, texto: formatarValorGrafico(valor, usarMilhares, casasDecimais), classe: 'grafico-rotulo' });
      }
    });
  }
  return svg;
}

// Linhas (usadas pro acumulado, e pro mensal das dimensões-razão) --
// marcador de 8px com anel na cor da superfície (fica legível cruzando
// outra linha ou uma coluna). Rótulo em CADA ponto (a pedido), também só
// acumulado em \`rotulos\` -- ver construirColunasSvg acima pro porquê.
// Um mês null (sem dado reportado ainda, ver somarArraysMensais) quebra a
// linha em vez de "cair" até a base -- desenha um <polyline> por trecho
// contínuo de meses com dado, não um só ligando os 12 pontos.
// indiceConector (opcional, em cada item de dadosPorSerie): o mês onde uma
// série "pós-Realizado" (Tendência, Realizado+Previsto Inicial) herda o
// ponto de partida de Realizado -- ver calcularAcumuladoAposRealizado e
// construirPainelGraficoHtml. Esse mês PRECISA entrar no trecho da
// polyline (fecha o hiato visual entre o último mês de Realizado e o
// primeiro mês próprio da série futura, desenhando o segmento na cor/
// tracejado da série futura), mas NÃO desenha marcador/hit/rótulo -- quem
// já desenhou os três ali foi a própria série Realizado, no mesmo x,y.
function construirLinhasSvg(dadosPorSerie, campo, escala, alturaPlot, larguraMes, margem, usarMilhares, rotulos, casasDecimais) {
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
    d[campo].forEach(function (valor, mes) {
      if (valor === null || valor === undefined) { fecharTrecho(); return; }
      var x = margem.esquerda + mes * larguraMes + larguraMes / 2;
      var y = margem.topo + alturaPlot - escalaLinear(valor, escala.max, alturaPlot);
      trecho.push({ x: x, y: y });
      var ehConector = d.indiceConector !== null && d.indiceConector !== undefined && mes === d.indiceConector;
      if (!ehConector) {
        svg += '<circle class="grafico-marcador" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="4" fill="' + SERIE_COR[d.serie] + '" stroke="var(--surface-1)" stroke-width="2"/>';
        svg += '<circle class="grafico-hit" data-tooltip="' + MESES_ABREVIADOS[mes] + ' · ' + SERIE_LABELS[d.serie] + ': ' + formatarNumero(valor, casasDecimais) + '" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="10" fill="transparent"/>';
        if (valor) {
          rotulos.push({ x: x, y: y - 10, texto: formatarValorGrafico(valor, usarMilhares, casasDecimais), classe: 'grafico-rotulo-final' });
        }
      }
    });
    fecharTrecho();
  });
  return svg;
}

// Monta o SVG final de um painel a partir das marcas (colunas OU linhas,
// já em \`svgMarcas\`) + candidatos a rótulo acumulados em \`rotulos\` --
// resolve a colisão uma vez, no conjunto inteiro do painel, e desenha os
// <text> por último (por cima de tudo, incluindo o halo).
function finalizarPainelSvg(svgMarcas, rotulos, altura) {
  var svg = svgMarcas;
  resolverColisoesRotulos(rotulos).forEach(function (r) {
    svg += '<text class="' + r.classe + '" x="' + r.x.toFixed(1) + '" y="' + r.y.toFixed(1) + '" text-anchor="middle">' + r.texto + '</text>';
  });
  return '<svg viewBox="0 0 ' + GRAFICO_LARGURA + ' ' + altura + '" class="grafico-svg">' + svg + '</svg>';
}

// dadosPorSerie: [{ serie, mensal: number[12], acumulado: number[12]|null }],
// já filtrado só com as séries visíveis (respeita filtro-serie) e com
// valores mensais nunca-nulos (null já virou 0 antes de chegar aqui -- ver
// construirPainelGraficoHtml). ehRazao=true pras dimensões Produtividade/Ticket médio:
// nesse caso não faz sentido "acumular" uma razão, então só a linha do
// valor mensal aparece (painel único, sem colunas).
// semMilhares (opcional): quando true, NUNCA divide por mil, mesmo que o
// maior valor visível passe de GRAFICO_LIMIAR_MILHARES -- pedido do dono do
// projeto em 2026-08-13 pra dimensão Volume, cujos valores são menores e
// ficam difíceis de ler divididos (ainda mais com a série Demandas, que
// tende a ser bem maior que Volume e empurrava o painel inteiro pra
// milhares). Mesmo padrão já usado em tools/semanal/render-aba-grafico-semanal.js
// (GRAFICO_LIMIAR_MILHARES lá também tem as duas atribuições de usarMilhares
// hardcoded pra false, por pedido anterior do dono do projeto -- ver CLAUDE.md).
function construirGraficoMensalSvg(dadosPorSerie, ehRazao, casasDecimais, semMilhares) {
  var margem = ehRazao ? GRAFICO_MARGEM_LINHA : GRAFICO_MARGEM_BARRAS;
  var altura = ehRazao ? GRAFICO_ALTURA_LINHA : GRAFICO_ALTURA_BARRAS;
  var larguraPlot = GRAFICO_LARGURA - margem.esquerda - margem.direita;
  var alturaPlot = altura - margem.topo - margem.baixo;
  var larguraMes = larguraPlot / 12;

  var maxMensal = 0;
  dadosPorSerie.forEach(function (d) { d.mensal.forEach(function (v) { if (v > maxMensal) maxMensal = v; }); });
  var escala = calcularEscalaEixo(maxMensal);
  var usarMilhares = !semMilhares && maxMensal >= GRAFICO_LIMIAR_MILHARES;

  var svg = '';
  svg += construirEixoYSvg(escala, alturaPlot, margem, false, usarMilhares, casasDecimais);
  svg += construirEixoXSvg(larguraMes, alturaPlot, margem);

  var rotulos = [];
  svg += ehRazao
    ? construirLinhasSvg(dadosPorSerie, 'mensal', escala, alturaPlot, larguraMes, margem, usarMilhares, rotulos, casasDecimais)
    : construirColunasSvg(dadosPorSerie, escala, alturaPlot, larguraMes, margem, usarMilhares, rotulos, casasDecimais);
  svg += construirLegendaSvg(dadosPorSerie, margem);

  return { svg: finalizarPainelSvg(svg, rotulos, altura), milhares: usarMilhares };
}

// Painel separado, eixo único, pro acumulado no ano -- mensal e acumulado
// nunca compartilham escala (dezembro acumulado é ~12x um mês típico), um
// eixo duplo no mesmo plot inventaria uma correlação visual que não existe.
function construirGraficoAcumuladoSvg(dadosPorSerie, casasDecimais, semMilhares) {
  var margem = GRAFICO_MARGEM_LINHA;
  var altura = GRAFICO_ALTURA_LINHA;
  var larguraPlot = GRAFICO_LARGURA - margem.esquerda - margem.direita;
  var alturaPlot = altura - margem.topo - margem.baixo;
  var larguraMes = larguraPlot / 12;

  var maxAcumulado = 0;
  dadosPorSerie.forEach(function (d) { d.acumulado.forEach(function (v) { if (v > maxAcumulado) maxAcumulado = v; }); });
  var escala = calcularEscalaEixo(maxAcumulado);
  var usarMilhares = !semMilhares && maxAcumulado >= GRAFICO_LIMIAR_MILHARES;

  var svg = '';
  svg += construirEixoYSvg(escala, alturaPlot, margem, false, usarMilhares, casasDecimais);
  svg += construirEixoXSvg(larguraMes, alturaPlot, margem);

  var rotulos = [];
  svg += construirLinhasSvg(dadosPorSerie, 'acumulado', escala, alturaPlot, larguraMes, margem, usarMilhares, rotulos, casasDecimais);
  svg += construirLegendaSvg(dadosPorSerie, margem);

  return { svg: finalizarPainelSvg(svg, rotulos, altura), milhares: usarMilhares };
}

// Soma, mês a mês, os arrays de demandasMensais (window.__DEMANDAS_MENSAIS__,
// {chaveMatriz: [12 chegadas]} montado no build -- ver
// tools/orcamento/build-dashboard.js:montarDemandasChegadasMensais) das
// chaves (sup||tipologia) dos registros que passaram no filtro atual.
// Mesma chave de tools/comum/linha-base.js:chaveMatriz -- que, a partir
// desta branch, JÁ é um global de verdade neste <script> (fonteParaCliente()
// injeta a função inteira via fonteParaClienteLinhaBase(), ver renderDashboard
// mais abaixo), mas a expressão aqui continua com a concatenação simples
// equivalente em vez de chamar chaveMatriz(...) -- refatorar pra chamar o
// global fica pra outra passada, não é necessário pra corrigir esta nota.
function demandasMensaisPorIndices(indices, registros, demandasMensais) {
  var mensal = new Array(12).fill(0);
  if (!demandasMensais) return mensal;
  indices.forEach(function (idx) {
    var registro = registros[idx];
    var chave = registro.sup + '||' + registro.tipologia;
    var porMes = demandasMensais[chave];
    if (!porMes) return;
    for (var i = 0; i < 12; i++) mensal[i] += porMes[i] || 0;
  });
  return mensal;
}

// Soma o saldo de demandas em aberto em 31/12 do ano ANTERIOR ao exibido
// (window.__DEMANDAS_SALDO_ABERTURA__, montado no build -- ver
// tools/semanal/compute-demandas.js:saldoAberturaPorRegistro) pelas chaves
// (sup||tipologia) dos registros filtrados -- é UM NÚMERO, não um array de
// 12: é o ponto de partida único da linha Acumulado de Demandas, somado uma
// vez só, não repetido mês a mês.
function demandasSaldoAberturaPorIndices(indices, registros, saldoAbertura) {
  var soma = 0;
  if (!saldoAbertura) return soma;
  indices.forEach(function (idx) {
    var registro = registros[idx];
    var chave = registro.sup + '||' + registro.tipologia;
    soma += saldoAbertura[chave] || 0;
  });
  return soma;
}

// Monta o par Mensal + Acumulado de UMA dimensão (HTML pronto, não toca o
// DOM diretamente) -- reaproveitado por montarGraficos pra cada dimensão
// marcada, uma abaixo da outra. As dimensões nunca se somam entre si (não
// faz sentido somar Equipes com Financeiro): cada uma sempre ganha seu
// próprio par de painéis, "sobrepostos" na página em vez de combinados num
// único número -- o mesmo princípio já usado nas linhas da tabela.
function construirPainelGraficoHtml(registros, indices, filtroSerie, dimensao) {
  var seriesVisiveis = ORDEM_SERIES_GRAFICO.filter(function (s) { return !filtroExclui(filtroSerie, s); });
  var ehRazao = DIMENSOES_RAZAO.indexOf(dimensao) !== -1;

  function mensalBruto(serie) {
    var valoresLista = indices.map(function (idx) { return registros[idx][serie]; });
    return calcularMensal(valoresLista, serie, dimensao) || new Array(12).fill(null);
  }

  // Realizado e Previsto Inicial SEMPRE calculados, mesmo se não
  // estiverem marcados no filtro de série -- Tendência e "Realizado +
  // Previsto Inicial" dependem dos dois pra achar onde o Realizado parou
  // (ultimoMesRealizado) e montar a parte futura, mesmo quando nenhum dos
  // dois está marcado pra aparecer no gráfico (efeito colateral bom: antes
  // dessa mudança, desmarcar "Realizado" no filtro fazia a Tendência
  // "esquecer" o total real acumulado e recomeçar sozinha do zero -- não
  // acontece mais).
  var mensalRealizado = removerZerosFinaisNaoReportados(mensalBruto('realizado'));
  var mensalPrevistoInicial = mensalBruto('previstoInicial');
  var ultimoMesRealizado = ultimoIndiceComDado(mensalRealizado);
  var acumuladoRealizado = calcularAcumulado(mensalRealizado);

  // Só pro painel Mensal em LINHA (razão -- Produtividade/Ticket Médio):
  // injeta o valor do próprio Realizado no mês de conexão pra série
  // futura ter um ponto ali (fecha o hiato dessa linha também) -- nunca
  // sobrescreve um valor que já exista (a MATRIZ pode, em tese, ter o
  // próprio T ali) e NUNCA roda pro painel Mensal em BARRA (soma), que
  // continua sem nenhum ponto/barra da série futura no mês de conexão.
  function comConectorSeRazao(mensal) {
    if (!ehRazao || ultimoMesRealizado === -1) return mensal;
    var resultado = mensal.slice();
    if (resultado[ultimoMesRealizado] === null || resultado[ultimoMesRealizado] === undefined) {
      resultado[ultimoMesRealizado] = mensalRealizado[ultimoMesRealizado];
    }
    return resultado;
  }

  var mensalPorSerie = { realizado: mensalRealizado, previstoInicial: mensalPrevistoInicial };
  seriesVisiveis.forEach(function (serie) {
    if (mensalPorSerie[serie] || serie === 'realizadoPrevistoInicial') return;
    mensalPorSerie[serie] = mensalBruto(serie);
  });
  if (mensalPorSerie.total) mensalPorSerie.total = comConectorSeRazao(mensalPorSerie.total);
  // "Realizado + Previsto Inicial": null em todo mês que já tem Realizado
  // (mesma regra da Tendência -- um mês com Realizado nunca mostra outra
  // série de projeção junto), Previsto Inicial do próprio mês dali em
  // diante (não Previsto atual, não a Tendência da MATRIZ).
  mensalPorSerie.realizadoPrevistoInicial = comConectorSeRazao(mensalPrevistoInicial.map(function (v, i) {
    return i <= ultimoMesRealizado ? null : v;
  }));

  var dadosPorSerie = seriesVisiveis.map(function (serie) {
    var mensal = mensalPorSerie[serie];
    var acumulado = null;
    if (!ehRazao) {
      if (serie === 'total' || serie === 'realizadoPrevistoInicial') {
        acumulado = calcularAcumuladoAposRealizado(mensal, acumuladoRealizado, ultimoMesRealizado);
      } else if (serie === 'realizado') {
        acumulado = cortarAcumuladoNoUltimoDado(calcularAcumulado(mensal), mensal);
      } else {
        acumulado = calcularAcumulado(mensal);
      }
    }
    // Tendência: um mês que já tem Realizado nunca desenha barra de
    // projeção nele (mesma regra de "Realizado + Previsto Inicial" acima)
    // -- só o painel Mensal em BARRA (soma) precisa disso; em razão (linha)
    // o próprio comConectorSeRazao já cuida da continuidade, e o Acumulado
    // usa "mensal" sem esse corte (calculado acima), pra não perder a
    // contribuição real do mês de conexão (ver calcularAcumuladoAposRealizado).
    var mensalParaDesenho = (serie === 'total' && !ehRazao)
      ? mensal.map(function (v, i) { return i <= ultimoMesRealizado ? null : v; })
      : mensal;
    // indiceConector: só pras séries "pós-Realizado", e só quando existe
    // de fato um mês de Realizado pra herdar (ultimoMesRealizado !== -1)
    // -- ver construirLinhasSvg. Vale tanto pro painel Mensal em linha
    // (razão) quanto pro Acumulado; o painel Mensal em BARRA (soma) não
    // usa esse campo (construirColunasSvg não olha pra ele).
    var indiceConector = (serie === 'total' || serie === 'realizadoPrevistoInicial') && ultimoMesRealizado !== -1
      ? ultimoMesRealizado
      : null;
    return { serie: serie, mensal: mensalParaDesenho, acumulado: acumulado, indiceConector: indiceConector };
  });

  // Demandas (chegadas -- furos de sondagem + ensaios de laboratório) só
  // faz sentido em Volume: é uma contagem física, sem equivalente em R$
  // (Financeiro) nem headcount (Equipes), e Produtividade/Ticket médio são
  // razões que não admitem uma 5ª série somada. Sempre visível quando a
  // dimensão é Volume -- não passa pelo filtro-serie (Previsto Inicial/
  // Previsto/Realizado/Total), decisão explícita do dono do projeto em
  // 2026-08-13 (ver o spec).
  //
  // O Acumulado NÃO é só a soma corrida das chegadas do ano -- nasce do
  // saldo de demandas que já estava em aberto em 31/12 do ano anterior
  // (demandasSaldoAberturaPorIndices). Achado ao vivo em 2026-08-13
  // filtrando SUP-8370-25 (Rota Sorocabana): sem esse saldo de abertura,
  // 55% dos furos executados em 2026 (chegados em 2025 ou antes) ficavam de
  // fora da contagem, e o Acumulado de Demandas aparecia ABAIXO do
  // Acumulado de Realizado -- o que parece impossível (não dá pra executar
  // mais do que chegou), mas era só a janela do ano escondendo o saldo
  // anterior. A barra MENSAL continua mostrando só as chegadas de cada mês
  // do ano exibido, sem o saldo -- só o Acumulado muda.
  if (dimensao === 'volume') {
    var demandasMensal = demandasMensaisPorIndices(indices, registros, window.__DEMANDAS_MENSAIS__);
    var demandasSaldoAbertura = demandasSaldoAberturaPorIndices(indices, registros, window.__DEMANDAS_SALDO_ABERTURA__);
    var demandasAcumulado = calcularAcumulado(demandasMensal).map(function (v) { return v + demandasSaldoAbertura; });
    dadosPorSerie = dadosPorSerie.concat([{ serie: 'demandas', mensal: demandasMensal, acumulado: demandasAcumulado, indiceConector: null }]);
  }

  var rotuloDimensao = DIMENSOES_ROTULO[dimensao] || '';
  // Todo gráfico mostra número inteiro, sem casa decimal -- exceto
  // Produtividade/Ticket médio, que são razões (m³ por equipe-dia, R$ por
  // m³) e perderiam precisão útil arredondadas pra inteiro.
  var casasDecimais = ehRazao ? 2 : 0;

  // Volume nunca divide por mil -- ver o comentário de construirGraficoMensalSvg.
  var semMilhares = dimensao === 'volume';

  var mensalResultado = construirGraficoMensalSvg(dadosPorSerie, ehRazao, casasDecimais, semMilhares);
  var tituloMensal = (ehRazao ? 'Evolução mensal — ' : 'Mensal — ') + rotuloDimensao + (mensalResultado.milhares ? ' (em milhares)' : '');
  var html = '<div class="grafico-painel"><div class="grafico-titulo">' + escapeHtml(tituloMensal) + '</div><div>' + mensalResultado.svg + '</div></div>';

  // Acumulado de Equipes não tem leitura de negócio (não existe "total de
  // equipes acumulado no ano") -- some junto com as dimensões-razão, que já
  // não mostravam esse painel por um motivo parecido.
  if (!(ehRazao || dimensao === 'equipes')) {
    var acumuladoResultado = construirGraficoAcumuladoSvg(dadosPorSerie, casasDecimais, semMilhares);
    var tituloAcumulado = 'Acumulado no ano — ' + rotuloDimensao + (acumuladoResultado.milhares ? ' (em milhares)' : '');
    html += '<div class="grafico-painel"><div class="grafico-titulo">' + escapeHtml(tituloAcumulado) + '</div><div>' + acumuladoResultado.svg + '</div></div>';
  }
  return html;
}

// Recalcula e redesenha os gráficos a partir dos MESMOS filtros/dimensões da
// tabela -- chamado toda vez que recalcularTabela roda, então nunca fica
// desatualizado mesmo se o usuário estiver na aba Tabela quando muda um
// filtro e só depois troca pra aba Gráfico. Uma dimensão marcada = um par
// de painéis; várias marcadas = vários pares, um abaixo do outro (nunca
// somados entre si).
function montarGraficos(registros, filtroTipologia, filtroCategoria, filtroGrupo, filtroSup, filtroOrigem, filtroSerie, dimensoes) {
  var indices = indicesFiltrados(registros, filtroTipologia, filtroCategoria, filtroGrupo, filtroSup, filtroOrigem);
  var html = dimensoes.map(function (dimensao) {
    return '<div class="grafico-bloco-dimensao">' + construirPainelGraficoHtml(registros, indices, filtroSerie, dimensao) + '</div>';
  }).join('');
  document.getElementById('graficos-container').innerHTML = html;
}

// Sempre reconstrói cabeçalho + corpo inteiros (sem estado incremental,
// mesma filosofia do resto do script) -- muito mais simples que a Tabela
// porque aqui NUNCA existe uma distinção "estrutura vs valor": qualquer
// mudança (recorte OU um dos 4 seletores próprios) muda linhas E colunas
// ao mesmo tempo, então não vale a pena ter dois caminhos.
function recalcularAlertas() {
  var indices = indicesFiltrados(
    window.__REGISTROS__, filtrosSelecionados.tipologia, filtrosSelecionados.categoria,
    filtrosSelecionados.grupo, filtrosSelecionados.sup, filtrosSelecionados.origem
  );
  var agruparPor = filtrosAlertas.agruparPor.values().next().value;
  var dimensao = dimensoesEmOrdem(filtrosSelecionados.dimensao)[0];
  var numericos = emOrdemCanonica(NUMERICO_ORDEM, filtrosAlertas.numerico);
  var baselines = emOrdemCanonica(BASELINE_ORDEM, filtrosAlertas.baseline);
  var periodos = emOrdemCanonica(PERIODO_ORDEM, filtrosAlertas.periodo);
  var colunas = colunasAlertas(numericos, baselines, periodos);
  document.getElementById('cabecalho-alertas').innerHTML = renderCabecalhoAlertas(AGRUPAR_POR_ROTULO[agruparPor], DIMENSOES_ROTULO[dimensao]);
  document.getElementById('corpo-alertas').innerHTML = renderCorpoAlertas(
    window.__REGISTROS__, indices, agruparPor, dimensao, numericos, baselines, periodos, window.__VIGENTE_IDX__,
    filtrosAlertas.status
  );
  aplicarBuscaAlertas();
}

// Filtra as linhas JÁ renderizadas da tabela de Alertas por texto --
// nunca refaz a busca de dados (bucketPeriodo etc.), só esconde/mostra
// <tr> pelo data-search que renderLinhaAlerta já embutiu. Termo vazio
// mostra tudo (mesma convenção do campo de busca dentro de cada
// filtro-multi, ver montarFiltroMulti, agora em tools/comum/render-shell.js).
function aplicarBuscaAlertas() {
  var termo = normalizarBusca(document.getElementById('busca-alertas').value);
  document.querySelectorAll('#tabela-alertas tbody tr').forEach(function (tr) {
    var combina = termo === '' || (tr.dataset.search || '').indexOf(termo) !== -1;
    tr.style.display = combina ? '' : 'none';
  });
}

// Tooltip único, delegado (os SVGs são recriados via innerHTML a cada
// recalcularTabela, então um listener por elemento seria descartado toda
// hora) -- qualquer elemento com [data-tooltip] dentro da seção de
// gráficos aciona o balão, com foco/teclado cobrindo o mesmo caso via
// mouseover que já borbulha de um :focus programático.
function inicializarTooltipGrafico() {
  var secao = document.getElementById('secao-grafico');
  var tooltip = document.getElementById('grafico-tooltip');
  secao.addEventListener('mousemove', function (e) {
    var alvo = e.target.closest ? e.target.closest('[data-tooltip]') : null;
    if (!alvo) { tooltip.style.display = 'none'; return; }
    var rectSecao = secao.getBoundingClientRect();
    tooltip.textContent = alvo.getAttribute('data-tooltip');
    tooltip.style.display = 'block';
    tooltip.style.left = (e.clientX - rectSecao.left + 14) + 'px';
    tooltip.style.top = (e.clientY - rectSecao.top - 12) + 'px';
  });
  secao.addEventListener('mouseleave', function () { tooltip.style.display = 'none'; });
}

function alternarAba(aba) {
  document.getElementById('secao-tabela').style.display = aba === 'tabela' ? '' : 'none';
  document.getElementById('secao-grafico').style.display = aba === 'grafico' ? '' : 'none';
  document.getElementById('secao-alertas').style.display = aba === 'alertas' ? '' : 'none';
  document.getElementById('aba-tabela').classList.toggle('aba-ativa', aba === 'tabela');
  document.getElementById('aba-grafico').classList.toggle('aba-ativa', aba === 'grafico');
  document.getElementById('aba-alertas').classList.toggle('aba-ativa', aba === 'alertas');
}

function preencherLinha(linha, valoresLista, serie, dimensao, valoresListaRealizado) {
  // Toda a tabela principal mostra número inteiro, sem vírgula, em
  // qualquer dimensão -- diferente do gráfico, que continua com 2 casas
  // pra Financeiro/Volume/Produtividade/Ticket médio (só Equipes já tinha 0
  // lá, por não existir "meia equipe" -- na tabela isso agora vale igual
  // pra todas). Produtividade é a única exceção (pedido explícito): sempre
  // 2 casas decimais, aqui e em qualquer outro lugar que mostre esse
  // número (ver também renderLinhaAlerta).
  var casasDecimais = dimensao === 'produtividade' ? 2 : 0;
  var mensal = calcularMensal(valoresLista, serie, dimensao);
  // Tendência (série "total") nunca mostra um mês que a linha Realizado já
  // tenha -- mesma regra de ultimoMesRealizado que o Gráfico (painel Mensal
  // em barra, ver construirPainelGraficoHtml) já usa pra não desenhar
  // projeção em cima de fato. Confirmado com o usuário em 2026-08-06,
  // substitui a regra antiga (esconder só ANTES de window.__VIGENTE_IDX__):
  // aquela deixava o próprio mês vigente escapar da máscara quando ele já
  // tinha Realizado preenchido -- exatamente o caso real que motivou a
  // troca (Julho/2026 mostrava a Tendência igual ao Realizado por causa
  // disso). A regra agora é dirigida pelo DADO que a planilha já reportou,
  // não pelo calendário -- as duas coincidem quando o Realizado está em
  // dia, mas não quando ele atrasa. O valor já FECHADO com o Realizado
  // (fecharTendenciaVigente) continua existindo por baixo pros cálculos
  // agregados de Alertas e pro conector do Acumulado no Gráfico -- só a
  // célula mensal (e o Total do ano logo abaixo) escondem os meses já
  // realizados aqui, não o dado em si.
  var ultimoMesRealizado = -1;
  if (serie === 'total') {
    var mensalRealizado = removerZerosFinaisNaoReportados(calcularMensal(valoresListaRealizado || [], 'realizado', dimensao) || new Array(12).fill(null));
    ultimoMesRealizado = ultimoIndiceComDado(mensalRealizado);
    if (mensal) mensal = mensal.map(function (v, idx) { return idx <= ultimoMesRealizado ? null : v; });
  }
  var celulasMes = linha.querySelectorAll('.celula-mes');
  celulasMes.forEach(function (celula, idx) {
    celula.textContent = formatarNumero(mensal ? mensal[idx] : null, casasDecimais);
  });
  var celulaTotal = linha.querySelector('.celula-total-linha');
  // Total do ano da Tendência soma só do que ainda não foi realizado (mesmo
  // corte do mensal acima) -- incluir os meses já cobertos pelo Realizado
  // dobraria a contagem (já aparecem no Total do ano da linha Realizado) e
  // infla o Total muito além do que ainda falta projetar (bug real:
  // SUP-6498-23, ver teste de regressão).
  var totalAno = (serie === 'total')
    ? bucketIntervalo(valoresLista, serie, dimensao, ultimoMesRealizado + 1, 12)
    : calcularTotalAno(valoresLista, serie, dimensao);
  if (celulaTotal) celulaTotal.textContent = formatarNumero(totalAno, casasDecimais);
}

// Dado um array de valores (na ordem das linhas visíveis de UMA coluna),
// devolve um array {valor, repetido} do mesmo tamanho -- repetido=true
// quando o valor é igual ao da linha visível anterior. O texto continua
// sempre visível (nunca vira '') -- quem decide como exibir isso (esmaecido
// quando repetido) é mesclarColunasRepetidas, não esta função. Função pura
// (sem DOM) pra poder testar sozinha.
function mesclarConsecutivos(valores) {
  var resultado = [];
  var anterior = null;
  valores.forEach(function (valor, i) {
    resultado.push({ valor: valor, repetido: i > 0 && valor === anterior });
    anterior = valor;
  });
  return resultado;
}

// Nunca reescreve o conteúdo da célula (só a classe que esmaece) -- a coluna
// Tipologia guarda um <span class="tipologia-chip"> colorido, e sobrescrever
// com textContent destruiria esse HTML. Pro mesmo motivo, sup/grupo/tomador
// também pararam de ter o conteúdo reescrito (era sempre o mesmo valor já
// presente, um no-op).
function mesclarColunasRepetidas() {
  var linhasVisiveis = Array.prototype.filter.call(
    document.querySelectorAll('#tabela-orcamento tbody tr'),
    function (tr) { return tr.style.display !== 'none'; }
  );

  // SUP > Grupo > Tomador é uma hierarquia, não 3 colunas independentes --
  // Grupo só pode contar como repetido se o SUP acima também não tiver
  // mudado (senão um SUP novo que por coincidência tem o mesmo Grupo do
  // anterior ficaria com o nome apagado, escondendo que um bloco novo
  // começou; mesmo raciocínio pra Tomador exigir Grupo+SUP inalterados).
  // Por isso cada nível usa uma CHAVE que inclui todos os níveis acima, não
  // só seu próprio texto -- reaproveita mesclarConsecutivos (já testada)
  // aplicando-a a essas chaves compostas em vez do texto puro.
  var celulasSup = linhasVisiveis.map(function (tr) { return tr.querySelector('.col-sup'); });
  var celulasGrupo = linhasVisiveis.map(function (tr) { return tr.querySelector('.col-grupo'); });
  var celulasTomador = linhasVisiveis.map(function (tr) { return tr.querySelector('.col-tomador'); });
  var valoresSup = celulasSup.map(function (c) { return c.getAttribute('data-valor'); });
  var valoresGrupo = celulasGrupo.map(function (c) { return c.getAttribute('data-valor'); });
  var valoresTomador = celulasTomador.map(function (c) { return c.getAttribute('data-valor'); });
  // Chave = array [niveis acima..., proprio valor] serializado em JSON, em
  // vez de uma string concatenada com separador -- evita qualquer risco de
  // colisao entre valores que por acaso contenham o proprio separador.
  var chavesGrupo = valoresSup.map(function (sup, i) { return JSON.stringify([sup, valoresGrupo[i]]); });
  var chavesTomador = valoresSup.map(function (sup, i) { return JSON.stringify([sup, valoresGrupo[i], valoresTomador[i]]); });

  var mescladosSup = mesclarConsecutivos(valoresSup);
  var mescladosGrupo = mesclarConsecutivos(chavesGrupo);
  var mescladosTomador = mesclarConsecutivos(chavesTomador);
  celulasSup.forEach(function (c, i) { c.classList.toggle('valor-repetido', mescladosSup[i].repetido); });
  celulasGrupo.forEach(function (c, i) { c.classList.toggle('valor-repetido', mescladosGrupo[i].repetido); });
  celulasTomador.forEach(function (c, i) { c.classList.toggle('valor-repetido', mescladosTomador[i].repetido); });

  // Tipologia (e os selos TOTAL/TOTAL GERAL) mesclam por GRUPO de linha
  // (as 3 linhas P/R/T de um mesmo bloco compartilham o mesmo
  // data-registro-indices), não por valor de texto -- se comparasse por
  // texto, duas tipologias iguais vindas de blocos diferentes (ex.: dois
  // SUPs distintos, ambos "SM") se mesclariam entre si, o que nunca foi o
  // comportamento pretendido.
  var celulasTipologia = linhasVisiveis.map(function (tr) { return tr.querySelector('.col-tipologia'); }).filter(Boolean);
  var chavesTipologia = linhasVisiveis.map(function (tr) { return tr.dataset.registroIndices; });
  var mescladosTipologia = mesclarConsecutivos(chavesTipologia);
  celulasTipologia.forEach(function (c, i) { c.classList.toggle('valor-repetido', mescladosTipologia[i].repetido); });
}

// Mesmo mapeamento de cores por tipologia da matriz de equipes
// (tools/matriz/render-dashboard.js's tipologiaColor), reimplementado aqui
// em JS de navegador pelo mesmo motivo do resto deste script: a própria
// tipologia é dado protegido por senha, não pode vir pronta do servidor.
var TIPOLOGIA_COLOR = {
  SP: '#3f851a', SM: '#2f6ad0', ST: '#8d6f00', PI: '#606060',
  BL: '#4a3aa7', CPTU: '#db244e', SH: '#e87ba4', VT: '#eda100',
  'SEGURANÇA': '#2775b8', ESPECIAIS: '#db244e', SSMA: '#2775b8',
};
var TIPOLOGIA_COMPOSTA_COLOR = {
  'CPTU / VT / SH': TIPOLOGIA_COLOR.CPTU,
  'SP/SM': TIPOLOGIA_COLOR.SP,
};
function tipologiaColor(tipologia) {
  var raw = String(tipologia || '').trim();
  var key = raw.toUpperCase();
  if (TIPOLOGIA_COLOR[key]) return TIPOLOGIA_COLOR[key];
  if (TIPOLOGIA_COMPOSTA_COLOR[key]) return TIPOLOGIA_COMPOSTA_COLOR[key];
  var parenMatch = raw.match(/\\(([^)]+)\\)\\s*$/);
  if (parenMatch) {
    var viaParen = TIPOLOGIA_COLOR[parenMatch[1].trim().toUpperCase()];
    if (viaParen) return viaParen;
  }
  var primeiroToken = key.split('/')[0].trim();
  if (TIPOLOGIA_COLOR[primeiroToken]) return TIPOLOGIA_COLOR[primeiroToken];
  return '#898781';
}

var SERIE_LABELS = { previstoInicial: 'Previsto Inicial', previsto: 'Previsto', realizado: 'Realizado', total: 'Tendência', realizadoPrevistoInicial: 'Realizado + Previsto Inicial', demandas: 'Demandas' };
// ORDEM_SERIES gera as linhas por registro da TABELA (renderBlocosDimensao)
// -- fica só com as 4 séries originais de propósito. ORDEM_SERIES_GRAFICO
// é a versão usada SÓ pelo Gráfico (construirPainelGraficoHtml), com a 5ª
// série "Realizado + Previsto Inicial" -- confirmado com o usuário que
// essa série não faz sentido como uma 5ª linha da Tabela.
var ORDEM_SERIES = ['previstoInicial', 'previsto', 'realizado', 'total'];
var ORDEM_SERIES_GRAFICO = ORDEM_SERIES.concat(['realizadoPrevistoInicial']);
var CLASSE_SERIE = { previstoInicial: 'previsto-inicial', previsto: 'previsto', realizado: 'realizado', total: 'total' };
// Estado inicial do filtro de série: Previsto Inicial começa DESMARCADO (é
// a referência de fundo, não o dado do dia a dia) -- as outras 3 começam
// marcadas. Precisa ser um Set não-vazio logo de cara pra excluir Previsto
// Inicial (Set vazio = "sem filtro" = mostra tudo, ver filtroExclui, que
// agora mora em tools/comum/render-shell.js).
var SERIES_PADRAO_ATIVAS = ['previsto', 'realizado', 'total'];

// Ordem fixa e canônica das dimensões -- quando várias estão marcadas, os
// blocos na tabela sempre aparecem nesta ordem, não na ordem que a pessoa
// marcou os checkboxes (previsibilidade).
var DIMENSOES_CONFIG = [
  { valor: 'equipes', rotulo: 'Equipes' },
  { valor: 'volume', rotulo: 'Volume' },
  { valor: 'financeiro', rotulo: 'Financeiro' },
  { valor: 'produtividade', rotulo: 'Produtividade' },
  { valor: 'ticketMedio', rotulo: 'Ticket médio' },
];
var DIMENSOES_ROTULO = {};
DIMENSOES_CONFIG.forEach(function (d) { DIMENSOES_ROTULO[d.valor] = d.rotulo; });

// Devolve as dimensões marcadas (Set), na ordem canônica -- nunca vazio na
// prática (o checkbox de dimensão nunca deixa desmarcar a última, ver
// montarFiltroMulti, agora em tools/comum/render-shell.js), mas cai pra
// Financeiro se por algum motivo estiver.
function dimensoesEmOrdem(selecionadas) {
  var ordenadas = DIMENSOES_CONFIG.filter(function (d) { return selecionadas.has(d.valor); }).map(function (d) { return d.valor; });
  return ordenadas.length ? ordenadas : ['financeiro'];
}

// Generaliza dimensoesEmOrdem pra qualquer lista de valores canônicos --
// devolve só os que estão em selecionadas, na ordem de ordemCanonica
// (nunca na ordem em que a pessoa marcou os checkboxes).
function emOrdemCanonica(ordemCanonica, selecionadas) {
  return ordemCanonica.filter(function (v) { return selecionadas.has(v); });
}

var NUMERICO_ORDEM = ['realizado', 'total'];
var BASELINE_ORDEM = ['previsto', 'previstoInicial'];
var PERIODO_ORDEM = ['acumuladoAnterior', 'mesVigente', 'm1', 'm2', 'm3', 'acumuladoFuturo', 'acumuladoAteVigente', 'totalAno'];
var PERIODO_LABELS = {
  acumuladoAnterior: 'Acumulado Anterior', mesVigente: 'Mês Vigente',
  m1: 'M+1', m2: 'M+2', m3: 'M+3', acumuladoFuturo: 'Acumulado Futuro',
  acumuladoAteVigente: 'Acumulado até Vigente', totalAno: 'Total Ano',
};

// "Agrupar por" precisa ler categoria (derivada de tipologia, nunca
// guardada no registro) do mesmo jeito que indicesFiltrados/opcoesFiltro
// (ambas agora em tools/comum/render-shell.js) já fazem pro filtro de
// categoria -- generalizado aqui pra qualquer campo de agrupamento, não só
// os campos que existem direto no registro.
function campoAgrupamento(registro, agruparPor) {
  return agruparPor === 'categoria' ? categoriaTipologia(registro.tipologia) : registro[agruparPor];
}

// Agrupa só os indices recebidos (já filtrados pelo recorte atual) por
// campoAgrupamento, em ordem alfabética de chave -- cada grupo soma TODOS
// os índices que caem nele, não só o primeiro visto.
function agruparIndicesAlertas(registros, indices, agruparPor) {
  var porChave = {};
  var ordem = [];
  indices.forEach(function (idx) {
    var chave = campoAgrupamento(registros[idx], agruparPor);
    if (!porChave[chave]) { porChave[chave] = []; ordem.push(chave); }
    porChave[chave].push(idx);
  });
  ordem.sort();
  return ordem.map(function (chave) { return { chave: chave, indices: porChave[chave] }; });
}

function celulasMesVazias() {
  var html = '';
  for (var i = 0; i < 12; i++) html += '<td class="celula-mes num"></td>';
  return html;
}

// Gera o bloco de 4 linhas (Previsto Inicial/Previsto/Realizado/Tendência)
// pra CADA dimensão marcada, reaproveitando as mesmas células fixas
// (SUP/Grupo/Tomador/Tipologia) em todos os blocos -- só o rótulo da série
// ganha o nome da dimensão junto (" — Financeiro" etc.), pra diferenciar
// os blocos quando várias dimensões estão marcadas ao mesmo tempo. Usado
// pelos 4 tipos de linha (registro normal, total por SUP, total geral,
// total geral por tipologia), que só diferem nas células fixas em si.
function renderBlocosDimensao(classesExtra, dataAttrsBase, celulaSup, celulaGrupo, celulaTomador, celulaTipologia, dimensoes) {
  var sufixoClasse = classesExtra ? ' ' + classesExtra : '';
  var celulaTotalLinha = '<td class="celula-total-linha num"></td>';
  var html = '';
  dimensoes.forEach(function (dim) {
    var rotuloDim = DIMENSOES_ROTULO[dim];
    var dataAttrs = dataAttrsBase + ' data-dimensao="' + dim + '"';
    ORDEM_SERIES.forEach(function (serie) {
      html += '<tr class="linha-serie linha-' + CLASSE_SERIE[serie] + sufixoClasse + '" data-serie="' + serie + '" ' + dataAttrs + '>' +
          celulaSup + celulaGrupo + celulaTomador + celulaTipologia +
          '<td class="serie-label">' + SERIE_LABELS[serie] + ' — ' + rotuloDim + '</td>' +
          celulasMesVazias() + celulaTotalLinha +
        '</tr>';
    });
  });
  return html;
}

function renderLinhaTabela(registro, indice, dimensoes) {
  var chipColor = tipologiaColor(registro.tipologia);
  var dataAttrsBase = 'data-tipologia="' + escapeHtml(registro.tipologia) + '" data-categoria="' + categoriaTipologia(registro.tipologia) + '" data-grupo="' + escapeHtml(registro.grupo) + '" data-sup="' + escapeHtml(registro.sup) + '" data-origem="' + escapeHtml(registro.origem) + '" data-registro-indices="' + indice + '"';
  var celulaSup = '<td class="col-mesclavel col-sup" data-valor="' + escapeHtml(registro.sup) + '">' + escapeHtml(registro.sup) + '</td>';
  var celulaGrupo = '<td class="col-mesclavel col-grupo" data-valor="' + escapeHtml(registro.grupo) + '">' + escapeHtml(registro.grupo) + '</td>';
  var celulaTomador = '<td class="col-mesclavel col-tomador" data-valor="' + escapeHtml(registro.tomador) + '">' + escapeHtml(registro.tomador) + '</td>';
  var celulaTipologia = '<td class="col-mesclavel col-tipologia"><span class="tipologia-chip" style="--chip-color:' + chipColor + '">' + escapeHtml(registro.tipologia) + '</span></td>';
  return renderBlocosDimensao('', dataAttrsBase, celulaSup, celulaGrupo, celulaTomador, celulaTipologia, dimensoes);
}

// origem: sempre uniforme dentro de um SUP (confirmado contra a MATRIZ
// real -- nenhum SUP mistura CONTRATO VIGENTE e NOVOS NEGÓCIOS entre suas
// tipologias), então o total do SUP pode levar um único data-origem sem
// risco de esconder/mostrar errado quando o filtro de Origem for aplicado.
function renderLinhaTotalSup(sup, grupo, tomador, origem, indices, dimensoes) {
  var dataAttrsBase = 'data-grupo="' + escapeHtml(grupo) + '" data-sup="' + escapeHtml(sup) + '" data-origem="' + escapeHtml(origem) + '" data-registro-indices="' + indices.join(',') + '" data-total-sup="1"';
  var celulaSup = '<td class="col-mesclavel col-sup" data-valor="' + escapeHtml(sup) + '">' + escapeHtml(sup) + '</td>';
  var celulaGrupo = '<td class="col-mesclavel col-grupo" data-valor="' + escapeHtml(grupo) + '">' + escapeHtml(grupo) + '</td>';
  var celulaTomador = '<td class="col-mesclavel col-tomador" data-valor="' + escapeHtml(tomador) + '">' + escapeHtml(tomador) + '</td>';
  var celulaTipologia = '<td class="col-mesclavel col-tipologia"><span class="tipologia-chip tipologia-chip-total">TOTAL</span></td>';
  return renderBlocosDimensao('linha-total-sup', dataAttrsBase, celulaSup, celulaGrupo, celulaTomador, celulaTipologia, dimensoes);
}

// O bloco do topo da tabela -- ao contrário de TOTAL SUP/TOTAL GERAL POR
// TIPOLOGIA (que somem quando um filtro de recorte estreita os dados,
// porque os índices que eles somam foram fixados na hora da montagem),
// este NUNCA some: recalcularTabela recalcula os índices a cada chamada a
// partir dos filtros atuais (ver indicesFiltrados, agora em
// tools/comum/render-shell.js), então o "TOTAL GERAL"
// vira "SUBTOTAL" (rótulo trocado em tempo real, ver .chip-total-geral) e
// mostra a soma exata do que está filtrado no momento -- sempre visível,
// sempre correto, no topo da tabela onde é mais fácil de achar.
function renderLinhaTotalGeral(totalRegistros, dimensoes) {
  var todosIndices = [];
  for (var i = 0; i < totalRegistros; i++) todosIndices.push(i);
  var dataAttrsBase = 'data-registro-indices="' + todosIndices.join(',') + '" data-total-geral="1"';
  var celulaVazia = function (classe) { return '<td class="col-mesclavel ' + classe + '" data-valor="">—</td>'; };
  var celulaTodos = function (classe) { return '<td class="col-mesclavel ' + classe + '" data-valor="Todos">Todos</td>'; };
  var celulaTipologia = '<td class="col-mesclavel col-tipologia"><span class="tipologia-chip tipologia-chip-total chip-total-geral">TOTAL GERAL</span></td>';
  return renderBlocosDimensao('linha-total-geral', dataAttrsBase, celulaVazia('col-sup'), celulaTodos('col-grupo'), celulaTodos('col-tomador'), celulaTipologia, dimensoes);
}

// Total geral de UMA tipologia (soma através de TODOS os grupos/SUPs que
// têm essa tipologia, não só um) -- SUP fica em branco (como o total
// geral), Grupo/Tomador mostram "Todos" (não há um grupo/tomador único pra
// exibir aqui), mas a Tipologia aparece de verdade e colorida, pra
// distinguir qual bloco é qual quando vários aparecem juntos no topo.
function renderLinhaTotalGeralTipologia(tipologia, indices, dimensoes) {
  var chipColor = tipologiaColor(tipologia);
  var dataAttrsBase = 'data-tipologia="' + escapeHtml(tipologia) + '" data-categoria="' + categoriaTipologia(tipologia) + '" data-registro-indices="' + indices.join(',') + '" data-total-geral-tipologia="1"';
  var celulaVazia = function (classe) { return '<td class="col-mesclavel ' + classe + '" data-valor="">—</td>'; };
  var celulaTodos = function (classe) { return '<td class="col-mesclavel ' + classe + '" data-valor="Todos">Todos</td>'; };
  var celulaTipologia = '<td class="col-mesclavel col-tipologia"><span class="tipologia-chip" style="--chip-color:' + chipColor + '">' + escapeHtml(tipologia) + '</span></td>';
  return renderBlocosDimensao('linha-total-geral linha-total-geral-tipologia', dataAttrsBase, celulaVazia('col-sup'), celulaTodos('col-grupo'), celulaTodos('col-tomador'), celulaTipologia, dimensoes);
}

function renderCorpoTabela(registros, dimensoes) {
  dimensoes = dimensoes && dimensoes.length ? dimensoes : ['financeiro'];
  var html = renderLinhaTotalGeral(registros.length, dimensoes);

  // Um total geral por tipologia, logo depois do total geral -- agrega
  // todos os registros daquela tipologia através de TODOS os SUPs (não só
  // do bloco de um contrato), em ordem alfabética (mesma ordem do filtro de
  // tipologia).
  var indicesPorTipologia = {};
  var ordemTipologias = [];
  registros.forEach(function (registro, indice) {
    if (!registro.tipologia) return;
    if (!indicesPorTipologia[registro.tipologia]) {
      indicesPorTipologia[registro.tipologia] = [];
      ordemTipologias.push(registro.tipologia);
    }
    indicesPorTipologia[registro.tipologia].push(indice);
  });
  ordemTipologias.sort();
  ordemTipologias.forEach(function (tipologia) {
    html += renderLinhaTotalGeralTipologia(tipologia, indicesPorTipologia[tipologia], dimensoes);
  });

  var supAtual = null;
  var grupoAtual = null;
  var tomadorAtual = null;
  var origemAtual = null;
  var indicesGrupoAtual = [];

  function fecharGrupo() {
    if (indicesGrupoAtual.length) {
      html += renderLinhaTotalSup(supAtual, grupoAtual, tomadorAtual, origemAtual, indicesGrupoAtual, dimensoes);
    }
  }

  registros.forEach(function (registro, indice) {
    if (supAtual !== null && registro.sup !== supAtual) {
      fecharGrupo();
      indicesGrupoAtual = [];
    }
    supAtual = registro.sup;
    grupoAtual = registro.grupo;
    tomadorAtual = registro.tomador;
    origemAtual = registro.origem;
    indicesGrupoAtual.push(indice);
    html += renderLinhaTabela(registro, indice, dimensoes);
  });
  fecharGrupo();
  return html;
}

// Os filtros (Origem/Tipologia/Categoria/Grupo/SUP/Série) são todos seleção
// múltipla, num dropdown de checkboxes -- Origem/Tipologia/Grupo/SUP têm
// opções dinâmicas (dependem dos registros decifrados); Categoria/Série têm
// opções fixas (rótulos genéricos, sem dado protegido, podem ir hardcoded).
var FILTROS_CONFIG = [
  // Origem vem direto da coluna ORIGEM da MATRIZ (CONTRATO VIGENTE /
  // NOVOS NEGÓCIOS hoje) -- dinâmico como tipologia/grupo/SUP, não fixo
  // como categoria/série, porque é texto cru da planilha, não uma
  // classificação computada pelo dashboard (ver capitalizarPalavras, agora
  // em tools/comum/render-shell.js, pro rótulo bonito; o VALOR do checkbox
  // continua sendo o texto original, já que é isso que os registros
  // carregam).
  { id: 'filtro-origem', chave: 'origem', rotuloPadrao: 'Todas as origens', campo: 'origem', rotuloCapitalizado: true },
  { id: 'filtro-categoria', chave: 'categoria', rotuloPadrao: 'Todas as categorias', opcoesFixas: [
    { valor: 'labConvencional', rotulo: 'Lab. Convencional' },
    { valor: 'labEspecial', rotulo: 'Lab. Especial' },
    { valor: 'sondagemConvencional', rotulo: 'Sondagem Convencional' },
    { valor: 'sondagemEspecial', rotulo: 'Sondagem Especial' },
  ] },
  // Em cascata com Categoria -- só lista as tipologias que pertencem à(s)
  // categoria(s) marcada(s) (ver opcoesFiltro, agora em
  // tools/comum/render-shell.js), pra não deixar escolher uma combinação
  // impossível (ex.: categoria=Lab. Especial + tipologia=SP).
  { id: 'filtro-tipologia', chave: 'tipologia', rotuloPadrao: 'Todas as tipologias', campo: 'tipologia' },
  { id: 'filtro-grupo', chave: 'grupo', rotuloPadrao: 'Todos os grupos', campo: 'grupo' },
  // Rótulo de cada opção traz Tomador/Escopo junto do código (o código
  // sozinho não é identificável de cabeça) -- o VALOR do checkbox continua
  // sendo só o código do SUP, já que é isso que os registros carregam.
  { id: 'filtro-sup', chave: 'sup', rotuloPadrao: 'Todos os SUP', campo: 'sup', rotuloComposto: true },
  { id: 'filtro-serie', chave: 'serie', rotuloPadrao: 'Todas as séries', opcoesFixas: [
    { valor: 'previstoInicial', rotulo: 'Previsto Inicial' },
    { valor: 'previsto', rotulo: 'Previsto' },
    { valor: 'realizado', rotulo: 'Realizado' },
    { valor: 'total', rotulo: 'Tendência' },
    // Só existe no Gráfico (ORDEM_SERIES_GRAFICO) -- nenhuma <tr> da
    // Tabela tem data-serie="realizadoPrevistoInicial", então marcar essa
    // opção aqui não tem efeito na Tabela, só filtra o Gráfico.
    { valor: 'realizadoPrevistoInicial', rotulo: 'Realizado + Previsto Inicial' },
  ] },
  // Diferente dos outros -- não é um FILTRO que estreita quais linhas
  // aparecem, decide qual(is) valor(es) elas mostram, então nunca pode
  // ficar vazio (ver montarFiltroMulti, agora em tools/comum/render-shell.js,
  // que trava a última desmarcação) e começa com Financeiro já marcado, não
  // vazio como os demais.
  { id: 'seletor-dimensao', chave: 'dimensao', rotuloPadrao: 'Selecione ao menos 1', opcoesFixas: DIMENSOES_CONFIG, minimoUm: true },
];

// Config dos 4 seletores próprios da aba Alertas -- mesmo componente
// visual (filtro-multi) dos filtros de recorte, mas com estado PRÓPRIO
// (filtrosAlertas, não filtrosSelecionados) e, pra Agrupar por/Dimensão,
// exclusivo:true (single-choice, ver montarFiltroMulti, agora em
// tools/comum/render-shell.js). Toda mudança em QUALQUER filtro (este ou um
// de recorte) recalcula Tabela E Alertas incondicionalmente -- quem decide
// isso é aoMudarFiltroOrcamento (logo abaixo), o callback que esta página
// passa pra montarFiltroMulti chamar ao final de toda mudança de checkbox,
// não mais um handler hardcoded dentro dela -- bug real corrigido aqui:
// antes só estes 5 tinham um mecanismo próprio que acionava
// recalcularAlertas, então filtrar por SUP na barra de cima nunca
// atualizava a aba Alertas.
var FILTROS_ALERTAS_CONFIG = [
  { id: 'filtro-alertas-agrupar-por', chave: 'agruparPor', rotuloPadrao: 'Agrupar por', exclusivo: true, opcoesFixas: [
    { valor: 'sup', rotulo: 'SUP' },
    { valor: 'tipologia', rotulo: 'Tipologia' },
    { valor: 'grupo', rotulo: 'Grupo' },
    { valor: 'categoria', rotulo: 'Categoria' },
    { valor: 'origem', rotulo: 'Origem' },
  ] },
  { id: 'filtro-alertas-numerico', chave: 'numerico', rotuloPadrao: 'Selecione ao menos 1', minimoUm: true, opcoesFixas: [
    { valor: 'realizado', rotulo: 'Realizado' },
    { valor: 'total', rotulo: 'Tendência' },
  ] },
  { id: 'filtro-alertas-baseline', chave: 'baseline', rotuloPadrao: 'Selecione ao menos 1', minimoUm: true, opcoesFixas: [
    { valor: 'previsto', rotulo: 'Previsto' },
    { valor: 'previstoInicial', rotulo: 'Previsto Inicial' },
  ] },
  { id: 'filtro-alertas-periodo', chave: 'periodo', rotuloPadrao: 'Selecione ao menos 1', minimoUm: true, opcoesFixas: PERIODO_ORDEM.map(function (p) { return { valor: p, rotulo: PERIODO_LABELS[p] }; }) },
  // Único dos 6 que FILTRA linhas (os outros 5 decidem que colunas/grupos
  // aparecem) -- por isso sem minimoUm/exclusivo: Set vazio mostra tudo,
  // igual aos filtros de recorte da barra de cima. O valor de cada opção é
  // o próprio rótulo que classificarSemaforo devolve (ver renderLinhaAlerta).
  { id: 'filtro-alertas-status', chave: 'status', rotuloPadrao: 'Status', opcoesFixas: [
    { valor: 'Excelente', rotulo: 'Excelente' },
    { valor: 'Dentro da meta', rotulo: 'Dentro da meta' },
    { valor: 'Atenção', rotulo: 'Atenção' },
    { valor: 'Crítico', rotulo: 'Crítico' },
    { valor: 'Sem dado', rotulo: 'Sem dado' },
  ] },
];

var filtrosAlertas = {};
FILTROS_ALERTAS_CONFIG.forEach(function (cfg) { filtrosAlertas[cfg.chave] = new Set(); });
filtrosAlertas.agruparPor.add('sup');
filtrosAlertas.numerico.add('realizado');
filtrosAlertas.numerico.add('total');
filtrosAlertas.baseline.add('previsto');
filtrosAlertas.periodo.add('acumuladoAteVigente');
filtrosAlertas.periodo.add('totalAno');

// chave -> Set dos valores marcados -- Set vazio tem a MESMA semântica que
// o <select> de valor único tinha com "" (nenhum filtro, mostra tudo) --
// exceto "dimensao" (começa com Financeiro marcado, ver FILTROS_CONFIG) e
// "serie" (começa com tudo MENOS Previsto Inicial marcado, ver SERIES_PADRAO_ATIVAS).
var filtrosSelecionados = {};
FILTROS_CONFIG.forEach(function (cfg) { filtrosSelecionados[cfg.chave] = new Set(); });
filtrosSelecionados.dimensao.add('financeiro');
SERIES_PADRAO_ATIVAS.forEach(function (s) { filtrosSelecionados.serie.add(s); });

// Reproduz exatamente o que o final de montarFiltroMulti fazia hardcoded
// antes da extração pra tools/comum/render-shell.js: cascata de
// categoria->tipologia, rebuild da estrutura da tabela quando a dimensão
// muda, e recálculo incondicional de Tabela + Alertas. Serve tanto pros
// filtros de recorte (FILTROS_CONFIG) quanto pros da aba Alertas
// (FILTROS_ALERTAS_CONFIG) -- pra estes últimos as duas condições de cima
// nunca batem (nenhum cfg de Alertas tem chave 'categoria' nem id
// 'seletor-dimensao'), então só o recálculo final roda, igual sempre foi.
function aoMudarFiltroOrcamento(cfg) {
  if (cfg.chave === 'categoria') {
    var cfgTipologia = FILTROS_CONFIG.filter(function (c) { return c.chave === 'tipologia'; })[0];
    montarFiltroMulti(cfgTipologia, window.__REGISTROS__, filtrosSelecionados, aoMudarFiltroOrcamento);
  }
  if (cfg.id === 'seletor-dimensao') {
    document.getElementById('corpo-tabela').innerHTML = renderCorpoTabela(window.__REGISTROS__, dimensoesEmOrdem(filtrosSelecionados.dimensao));
  }
  recalcularTabela();
  recalcularAlertas();
}

function montarTodosFiltrosMulti(registros) {
  FILTROS_CONFIG.forEach(function (cfg) { montarFiltroMulti(cfg, registros, filtrosSelecionados, aoMudarFiltroOrcamento); });
}

function recalcularTabela() {
  var notaPremissa = document.getElementById('nota-premissa-produtividade');
  notaPremissa.style.display = filtrosSelecionados.dimensao.has('produtividade') ? '' : 'none';
  var filtroTipologia = filtrosSelecionados.tipologia;
  var filtroCategoria = filtrosSelecionados.categoria;
  var filtroGrupo = filtrosSelecionados.grupo;
  var filtroSup = filtrosSelecionados.sup;
  var filtroOrigem = filtrosSelecionados.origem;
  var filtroSerie = filtrosSelecionados.serie;
  // O bloco TOTAL GERAL/SUBTOTAL nunca some -- recalcula sempre a partir do
  // recorte atual (mesma função que o gráfico usa) em vez de usar os
  // índices fixados na hora da montagem, então continua correto qualquer
  // que seja a combinação de filtros marcada. Vira "SUBTOTAL" (rótulo
  // trocado abaixo) assim que QUALQUER filtro que recorta linhas -- não
  // Série/Dimensão, que só escolhem o que aparece, não o que é somado --
  // estiver ativo.
  var indicesSubtotal = indicesFiltrados(window.__REGISTROS__, filtroTipologia, filtroCategoria, filtroGrupo, filtroSup, filtroOrigem);
  var algumFiltroDeRecorteAtivo = filtroTipologia.size > 0 || filtroCategoria.size > 0 || filtroGrupo.size > 0 || filtroSup.size > 0 || filtroOrigem.size > 0;
  document.querySelectorAll('.chip-total-geral').forEach(function (chip) {
    chip.textContent = algumFiltroDeRecorteAtivo ? 'SUBTOTAL' : 'TOTAL GERAL';
  });
  var linhas = document.querySelectorAll('#tabela-orcamento tbody tr');
  linhas.forEach(function (linha) {
    var combinaSerie = !filtroExclui(filtroSerie, linha.dataset.serie);
    // Origem nunca mistura dentro de um SUP (ver renderLinhaTotalSup), então
    // entra no mesmo grupo de combinação que Grupo/SUP -- filtrar por ela é
    // equivalente a escolher um subconjunto de SUPs.
    var combinaGrupoSup = !filtroExclui(filtroGrupo, linha.dataset.grupo) &&
      !filtroExclui(filtroSup, linha.dataset.sup) &&
      !filtroExclui(filtroOrigem, linha.dataset.origem);
    var combinaTipologiaCategoria = !filtroExclui(filtroTipologia, linha.dataset.tipologia) &&
      !filtroExclui(filtroCategoria, linha.dataset.categoria);
    var ehTotalGeral = linha.dataset.totalGeral === '1';
    var ehTotalGeralTipologia = linha.dataset.totalGeralTipologia === '1';
    var ehTotalSup = linha.dataset.totalSup === '1';
    var indices = ehTotalGeral ? indicesSubtotal : linha.dataset.registroIndices.split(',').map(Number);
    var mostra;
    if (ehTotalGeral) {
      mostra = combinaSerie;
    } else if (ehTotalGeralTipologia) {
      // Total de UMA tipologia através de TODOS os grupos/SUPs/origens --
      // mesma regra do total geral (some com filtro de grupo/SUP/origem,
      // já que uma tipologia pode aparecer em SUPs de origens diferentes,
      // ao contrário do total por SUP), mas os filtros de tipologia/
      // categoria escolhem QUAIS blocos aparecem em vez de escondê-los.
      mostra = filtroGrupo.size === 0 && filtroSup.size === 0 && filtroOrigem.size === 0 && combinaTipologiaCategoria && combinaSerie;
    } else if (ehTotalSup) {
      mostra = combinaGrupoSup && filtroTipologia.size === 0 && filtroCategoria.size === 0 && combinaSerie;
    } else {
      mostra = combinaGrupoSup && combinaTipologiaCategoria && combinaSerie;
    }
    linha.style.display = mostra ? '' : 'none';
    if (mostra) {
      var valoresLista = indices.map(function (idx) { return window.__REGISTROS__[idx][linha.dataset.serie]; });
      var valoresListaRealizado = indices.map(function (idx) { return window.__REGISTROS__[idx].realizado; });
      preencherLinha(linha, valoresLista, linha.dataset.serie, linha.dataset.dimensao, valoresListaRealizado);
    }
  });
  mesclarColunasRepetidas();
  // Cada painel só entende UMA dimensão por vez (eixos/escala não fazem
  // sentido misturando, por exemplo, Equipes e Financeiro no mesmo
  // painel) -- mas com várias marcadas, monta um par de painéis POR
  // dimensão, na ordem canônica, em vez de somar ou descartar as demais.
  montarGraficos(window.__REGISTROS__, filtroTipologia, filtroCategoria, filtroGrupo, filtroSup, filtroOrigem, filtroSerie, dimensoesEmOrdem(filtrosSelecionados.dimensao));
}

function limparFiltros() {
  FILTROS_CONFIG.forEach(function (cfg) {
    filtrosSelecionados[cfg.chave].clear();
  });
  filtrosSelecionados.dimensao.add('financeiro');
  SERIES_PADRAO_ATIVAS.forEach(function (s) { filtrosSelecionados.serie.add(s); });
  montarTodosFiltrosMulti(window.__REGISTROS__);
  document.getElementById('corpo-tabela').innerHTML = renderCorpoTabela(window.__REGISTROS__, dimensoesEmOrdem(filtrosSelecionados.dimensao));
  recalcularTabela();
  recalcularAlertas();
}

// Chamado uma vez, pelo gate de senha, assim que a senha certa decifra os
// registros -- monta a tabela inteira e liga os filtros/botões.
function montarDashboard(registros) {
  montarTodosFiltrosMulti(registros);
  FILTROS_ALERTAS_CONFIG.forEach(function (cfg) { montarFiltroMulti(cfg, registros, filtrosAlertas, aoMudarFiltroOrcamento); });
  configurarAberturaFiltrosMulti();
  document.getElementById('corpo-tabela').innerHTML = renderCorpoTabela(registros, dimensoesEmOrdem(filtrosSelecionados.dimensao));
  document.getElementById('limpar-filtros').addEventListener('click', limparFiltros);
  document.getElementById('aba-tabela').addEventListener('click', function () { alternarAba('tabela'); });
  document.getElementById('aba-grafico').addEventListener('click', function () { alternarAba('grafico'); });
  document.getElementById('aba-alertas').addEventListener('click', function () { alternarAba('alertas'); });
  document.getElementById('busca-alertas').addEventListener('input', aplicarBuscaAlertas);
  inicializarTooltipGrafico();
  recalcularTabela();
  recalcularAlertas();
}

// ---- Atualização ao vivo (busca a Sheet espelho publicada, sem tocar no
// .xlsx original) ----------------------------------------------------------
// A Sheet espelho é mantida em dia por um Apps Script separado (ver
// tools/orcamento/apps-script-espelho-matriz.gs) que roda a cada 30 min:
// converte o .xlsx real numa cópia Sheets temporária pra ler os valores
// calculados, copia a aba MATRIZ pra dentro da própria Sheet espelho, e
// apaga a cópia. O botão aqui só busca o CSV publicado dessa Sheet -- o
// arquivo .xlsx que você edita nunca é tocado por este fluxo.
var URL_ESPELHO_MATRIZ = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRaOjGxPYWKj-as9RwErptIND7PE_zxsND19PReV1MdOup1ZY3iAu_DGrQ0gatPyYFEy3hg-LWE2esw/pub?gid=609773455&single=true&output=csv';

// Os 4 arquivos que o build já usa pra Demandas (ver
// tools/orcamento/build-dashboard.js, montarDemandasChegadasMensais) --
// publicados em texto puro junto com a própria página (mesmo domínio do
// GitHub Pages, sem CORS), exatamente como a página semanal já busca os
// mesmos 4 arquivos pro próprio live-refresh.
var URL_ESPELHO_AVANCOS = 'avancos-online.csv';
var URL_ESPELHO_LAB = 'lab-online.csv';
var URL_ESPELHO_DEMANDAS_SONDAGEM = 'demandas-sondagem-online.csv';
var URL_ESPELHO_DEMANDAS_LAB = 'demandas-lab-online.json';

// Réplica cliente de periodosDoAnoSemanal() (tools/semanal/render-
// semanal.js) -- chegadasMensaisPorRegistro/saldoAberturaPorRegistro só
// precisam do ano de periodos[0] (12 meses janeiro-dezembro consecutivos),
// baked em window.__ANO_ORCAMENTO__ pelo build (ver renderDashboard) em vez
// de recalculado a partir do cabeçalho do espelho ao vivo -- evitaria um
// parsing de data novo (serial Excel vs texto formatado do Google Sheets)
// sem necessidade.
function periodosDoAnoOrcamento() {
  var periodos = [];
  for (var i = 0; i < 12; i++) periodos.push(new Date(Date.UTC(window.__ANO_ORCAMENTO__, i, 1)));
  return periodos;
}

function buscarCsvOrcamento(url) {
  var comCacheBust = url + (url.indexOf('?') === -1 ? '?' : '&') + '_=' + Date.now();
  return fetch(comCacheBust).then(function (resposta) {
    if (!resposta.ok) throw new Error('HTTP ' + resposta.status + ' ao buscar ' + url);
    return resposta.text();
  });
}

function buscarJsonOrcamento(url) {
  var comCacheBust = url + (url.indexOf('?') === -1 ? '?' : '&') + '_=' + Date.now();
  return fetch(comCacheBust).then(function (resposta) {
    if (!resposta.ok) throw new Error('HTTP ' + resposta.status + ' ao buscar ' + url);
    return resposta.json();
  });
}

// parseAvancos/parseLab consomem a grade 1-INDEXADA de readXlsxSheet:
// grid[0] é um buraco vazio, grid[1] é o cabeçalho. parseCsvGrid devolve
// 0-indexada (grid[0] = cabeçalho) -- mesmo deslocamento que
// tools/semanal/render-semanal.js (gridCsvComoXlsx) já precisa fazer.
function gridCsvComoXlsxOrcamento(texto) {
  var g = parseCsvGrid(texto);
  g.unshift(null);
  return g;
}

// Mesmo pipeline que tools/orcamento/build-dashboard.js
// (montarDemandasChegadasMensais) roda no build, rodando no cliente com o
// bundle da Task 2 (ParseAvancos/ParseLab/ComputeDemandas, globals expostas
// por ele) -- os dois NUNCA podem divergir, senão um live-refresh mostraria
// um número diferente do que o próximo build vai gerar.
// textoDemandasSondagem/demandasLabJson podem vir null (pendentes são
// opcionais, mesma regra do build).
function recalcularDemandasAoVivo(textoAvancos, textoLab, textoDemandasSondagem, demandasLabJson, registrosNovos) {
  var gridAvancos = parseCsvGrid(textoAvancos);
  if (textoDemandasSondagem) {
    var gridPendentes = parseCsvGrid(textoDemandasSondagem);
    for (var i = 1; i < gridPendentes.length; i++) gridAvancos.push(gridPendentes[i]);
  }
  gridAvancos.unshift(null);
  var furosLidos = ParseAvancos.parseAvancos(gridAvancos).furos;
  var ensaiosLidos = ParseLab.parseLab(gridCsvComoXlsxOrcamento(textoLab)).ensaios;
  if (demandasLabJson) {
    for (var j = 0; j < demandasLabJson.length; j++) {
      var pend = demandasLabJson[j];
      ensaiosLidos.push({ sup: pend.sup, tipologia: pend.tipologia, concluido: null, criacao: pend.criacao ? new Date(pend.criacao) : null });
    }
  }
  var furos = ComputeDemandas.redirecionarSupsDesconhecidos(furosLidos, registrosNovos).itens;
  var ensaios = ComputeDemandas.redirecionarSupsDesconhecidos(ensaiosLidos, registrosNovos).itens;
  var periodos = periodosDoAnoOrcamento();
  return {
    chegadasMensais: ComputeDemandas.chegadasMensaisPorRegistro(furos, ensaios, periodos),
    saldoAbertura: ComputeDemandas.saldoAberturaPorRegistro(furos, ensaios, periodos),
  };
}

// Parser CSV RFC4180 simples (aspas duplicadas escapam aspas, vírgula/quebra
// de linha dentro de aspas não terminam o campo) -- suficiente pro que o
// Google Sheets exporta, sem precisar de nenhuma lib externa.
function parseCsvGrid(texto) {
  var linhas = [];
  var linha = [];
  var campo = '';
  var dentroAspas = false;
  for (var i = 0; i < texto.length; i++) {
    var c = texto[i];
    if (dentroAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; }
        else dentroAspas = false;
      } else {
        campo += c;
      }
    } else if (c === '"') {
      dentroAspas = true;
    } else if (c === ',') {
      linha.push(campo); campo = '';
    } else if (c === '\\r') {
      // ignora -- o \\n logo em seguida já fecha a linha
    } else if (c === '\\n') {
      linha.push(campo); campo = '';
      linhas.push(linha); linha = [];
    } else {
      campo += c;
    }
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

// Converte uma célula do CSV pra número, ou null. Trata string vazia, erro
// de fórmula (#NAME?/#REF!/#VALUE!/#N/A, que aparecem quando o Apps Script
// converte o .xlsx pro formato Sheets e alguma fórmula específica do Excel
// não tem equivalente direto lá) e "n/a" como "sem dado" -- nunca como 0,
// pelo mesmo motivo de somarArraysMensais não confundir os dois.
function numeroPtBr(valor) {
  if (valor === undefined || valor === null) return null;
  var texto = String(valor).trim();
  if (texto === '' || texto.charAt(0) === '#' || texto.toLowerCase() === 'n/a') return null;
  var numero = parseFloat(texto.replace(/\\./g, '').replace(',', '.'));
  return isNaN(numero) ? null : numero;
}

function celulaTexto(v) {
  var t = (v === undefined || v === null) ? '' : String(v).trim();
  return t === '' ? null : t;
}

// Réplica em JS de parse-matriz.js (locateColumns) -- acha cada coluna pelo
// próprio rótulo da linha de cabeçalho, nunca por posição fixa, igual ao
// lado servidor. Lançar erro cedo aqui evita ler dado desalinhado em
// silêncio se a Sheet espelho mudar de forma.
function acharColunaClient(headerRow, rotulo) {
  for (var col = 0; col < headerRow.length; col++) {
    if (String(headerRow[col] || '').trim() === rotulo) return col;
  }
  throw new Error('Coluna "' + rotulo + '" não encontrada no cabeçalho do espelho ao vivo');
}
function proximasNColunasClient(colunaAncora, quantidade) {
  var cols = [];
  for (var i = 0; i < quantidade; i++) cols.push(colunaAncora + 1 + i);
  return cols;
}
function exigirRotuloClient(headerRow, col, esperado) {
  var encontrado = String(headerRow[col] || '').trim();
  if (encontrado !== esperado) {
    throw new Error('Esperava a coluna "' + esperado + '" na posição ' + col + ' do espelho ao vivo, encontrei "' + encontrado + '" -- a forma da planilha pode ter mudado');
  }
}
function locateColumnsClient(headerRow) {
  var origem = acharColunaClient(headerRow, 'ORIGEM');
  var grupo = acharColunaClient(headerRow, 'GRUPO');
  var tomador = acharColunaClient(headerRow, 'TOMADOR');
  var sup = acharColunaClient(headerRow, 'SUP');
  var escopo = acharColunaClient(headerRow, 'ESCOPO');
  var apoio = acharColunaClient(headerRow, 'APOIO');
  var inicio = acharColunaClient(headerRow, 'INICIO');
  var termino = acharColunaClient(headerRow, 'TERMINO');
  var sondagem = acharColunaClient(headerRow, 'SONDAGEM');
  var base = acharColunaClient(headerRow, 'BASE');

  var equipesMeses = proximasNColunasClient(base, 12);
  var pico = equipesMeses[11] + 1;
  exigirRotuloClient(headerRow, pico, 'PICO');
  var media = pico + 1;
  exigirRotuloClient(headerRow, media, 'MÉDIA');
  var prod = media + 1;
  exigirRotuloClient(headerRow, prod, 'PROD.');
  var dias = prod + 1;
  exigirRotuloClient(headerRow, dias, 'DIAS');

  var volumeMeses = proximasNColunasClient(dias, 12);
  var volumeTotal = volumeMeses[11] + 1;
  exigirRotuloClient(headerRow, volumeTotal, 'TOTAL');
  var volumeTotalInicial = volumeTotal + 1;
  var ticket = volumeTotalInicial + 1;
  exigirRotuloClient(headerRow, ticket, 'TICKET');

  var financeiroMeses = proximasNColunasClient(ticket, 12);
  var financeiroTotal = financeiroMeses[11] + 1;
  exigirRotuloClient(headerRow, financeiroTotal, 'TOTAL');
  var financeiroTotalInicial = financeiroTotal + 1;

  return {
    origem: origem, grupo: grupo, tomador: tomador, sup: sup, escopo: escopo, apoio: apoio,
    inicio: inicio, termino: termino, sondagem: sondagem, base: base,
    equipesMeses: equipesMeses, equipesResumo: { pico: pico, media: media, prod: prod, dias: dias },
    volumeMeses: volumeMeses, volumeResumo: { total: volumeTotal, totalInicial: volumeTotalInicial, ticket: ticket },
    financeiroMeses: financeiroMeses, financeiroResumo: { total: financeiroTotal, totalInicial: financeiroTotalInicial },
    observacao: financeiroTotalInicial + 1,
  };
}

function extrairValoresLinhaClient(row, columns) {
  return {
    equipes: columns.equipesMeses.map(function (col) { return numeroPtBr(row[col]); }),
    equipesResumo: {
      pico: numeroPtBr(row[columns.equipesResumo.pico]) || 0,
      media: numeroPtBr(row[columns.equipesResumo.media]) || 0,
      prod: numeroPtBr(row[columns.equipesResumo.prod]) || 0,
      dias: numeroPtBr(row[columns.equipesResumo.dias]) || 0,
    },
    volume: columns.volumeMeses.map(function (col) { return numeroPtBr(row[col]); }),
    volumeResumo: {
      total: numeroPtBr(row[columns.volumeResumo.total]) || 0,
      totalInicial: numeroPtBr(row[columns.volumeResumo.totalInicial]) || 0,
      ticket: numeroPtBr(row[columns.volumeResumo.ticket]) || 0,
    },
    financeiro: columns.financeiroMeses.map(function (col) { return numeroPtBr(row[col]); }),
    financeiroResumo: {
      total: numeroPtBr(row[columns.financeiroResumo.total]) || 0,
      totalInicial: numeroPtBr(row[columns.financeiroResumo.totalInicial]) || 0,
    },
  };
}

var TIPOLOGIAS_RESUMO_CLIENTE = { MENSAL: true, ACUMULADO: true };
function deveIncluirClient(registro) {
  if (!registro.grupo || registro.grupo === 'Todos') return false;
  if (!registro.tipologia || TIPOLOGIAS_RESUMO_CLIENTE[registro.tipologia]) return false;
  return true;
}

// Réplica em JS de parse-matriz.js (parseMatriz) -- mesmo esquema de 3
// linhas físicas por combinação (contrato, tipologia) identificadas pela
// coluna BASE (P/R/T) e preenchimento "sticky" dos campos identificadores.
// grid[0] é o cabeçalho (a exportação CSV não tem a linha 0 vazia que o
// .xlsx real tem antes da linha 1).
function parseMatrizClient(grid) {
  var columns = locateColumnsClient(grid[0]);
  var registros = [];
  var estado = {
    origem: null, grupo: null, tomador: null, sup: null, escopo: null,
    apoio: null, inicio: null, termino: null, tipologia: null,
  };
  var atual = null;

  for (var rowNum = 1; rowNum < grid.length; rowNum++) {
    var row = grid[rowNum];
    if (!row) continue;
    var base = celulaTexto(row[columns.base]);
    if (base === null) continue;

    estado.origem = celulaTexto(row[columns.origem]) || estado.origem;
    estado.grupo = celulaTexto(row[columns.grupo]) || estado.grupo;
    estado.tomador = celulaTexto(row[columns.tomador]) || estado.tomador;
    estado.sup = celulaTexto(row[columns.sup]) || estado.sup;
    estado.escopo = celulaTexto(row[columns.escopo]) || estado.escopo;
    estado.apoio = celulaTexto(row[columns.apoio]) || estado.apoio;
    estado.inicio = celulaTexto(row[columns.inicio]) || estado.inicio;
    estado.termino = celulaTexto(row[columns.termino]) || estado.termino;
    estado.tipologia = celulaTexto(row[columns.sondagem]) || estado.tipologia;

    if (base === 'P') {
      atual = {
        origem: estado.origem, grupo: estado.grupo, tomador: estado.tomador, sup: estado.sup,
        escopo: estado.escopo, apoio: estado.apoio, inicio: estado.inicio, termino: estado.termino,
        tipologia: estado.tipologia, observacao: null,
        previsto: extrairValoresLinhaClient(row, columns), realizado: null, total: null,
      };
    } else if (base === 'R' && atual) {
      atual.realizado = extrairValoresLinhaClient(row, columns);
    } else if (base === 'T' && atual) {
      atual.total = extrairValoresLinhaClient(row, columns);
      atual.observacao = celulaTexto(row[columns.observacao]);
      if (deveIncluirClient(atual)) registros.push(atual);
      atual = null;
    }
  }
  return registros;
}

function definirStatusAtualizacao(texto, ehErro) {
  var el = document.getElementById('status-atualizacao');
  if (!el) return;
  el.textContent = texto;
  el.classList.toggle('status-erro', !!ehErro);
}

// previstoInicial vem de um arquivo separado (o estudo original de linha
// de base), lido só no build no servidor -- nunca da Sheet espelho/CSV que
// o refresh ao vivo busca, e não tem por quê: é uma foto fixa, não muda
// junto com a MATRIZ viva. Sem isso, os registros recém-buscados vêm sem
// o campo (não zerado -- AUSENTE), e a linha Previsto Inicial ficaria em
// branco a cada "Atualizar dados". Em vez de tentar rebuscar algo que não
// muda, simplesmente transplanta o previstoInicial que os registros
// ANTIGOS já tinham pros novos, casando por SUP+tipologia (mesma chave de
// sempre) -- um SUP/tipologia novo que ainda não existia fica zerado, do
// jeito que build-dashboard.js já zera quando não acha na linha de base.
function preservarPrevistoInicial(registrosAntigos, registrosNovos) {
  var zero12 = function () { return Array(12).fill(0); };
  var zeroPadrao = {
    equipes: zero12(), equipesResumo: { pico: 0, media: 0, prod: 0, dias: 0 },
    volume: zero12(), volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
    financeiro: zero12(), financeiroResumo: { total: 0, totalInicial: 0 },
  };
  var porChave = {};
  registrosAntigos.forEach(function (r) {
    if (r.previstoInicial) porChave[r.sup + '||' + r.tipologia] = r.previstoInicial;
  });
  registrosNovos.forEach(function (r) {
    r.previstoInicial = porChave[r.sup + '||' + r.tipologia] || zeroPadrao;
  });
}

function atualizarDadosAoVivo() {
  definirStatusAtualizacao('Atualizando…', false);
  Promise.all([
    buscarCsvOrcamento(URL_ESPELHO_MATRIZ),
    buscarCsvOrcamento(URL_ESPELHO_AVANCOS).catch(function () { return null; }),
    buscarCsvOrcamento(URL_ESPELHO_LAB).catch(function () { return null; }),
    buscarCsvOrcamento(URL_ESPELHO_DEMANDAS_SONDAGEM).catch(function () { return null; }),
    buscarJsonOrcamento(URL_ESPELHO_DEMANDAS_LAB).catch(function () { return null; }),
  ])
    .then(function (textos) {
      var grid = parseCsvGrid(textos[0]);
      var registrosNovos = parseMatrizClient(grid);
      if (!registrosNovos.length) throw new Error('nenhum registro encontrado no espelho -- confira se o Apps Script já rodou pelo menos uma vez');

      // Demandas é uma 5ª série opcional (só na dimensão Volume) -- ao
      // contrário da MATRIZ, uma falha em avancos/lab nunca pode derrubar o
      // resto do botão. Cada fetch acima já degrada com .catch(() => null);
      // aqui o try/catch cobre também um erro de PARSING (formato mudou),
      // que aconteceria DEPOIS do fetch já ter tido sucesso.
      if (textos[1] && textos[2]) {
        try {
          var demandas = recalcularDemandasAoVivo(textos[1], textos[2], textos[3], textos[4], registrosNovos);
          window.__DEMANDAS_MENSAIS__ = demandas.chegadasMensais;
          window.__DEMANDAS_SALDO_ABERTURA__ = demandas.saldoAbertura;
        } catch (erroDemandas) {
          console.warn('Não foi possível recalcular Demandas: ' + erroDemandas.message);
        }
      }

      preservarPrevistoInicial(window.__REGISTROS__, registrosNovos);
      window.__REGISTROS__ = registrosNovos;
      window.__REGISTROS__ = fecharTendenciaVigente(window.__REGISTROS__, window.__VIGENTE_IDX__);
      montarTodosFiltrosMulti(window.__REGISTROS__);
      document.getElementById('corpo-tabela').innerHTML = renderCorpoTabela(window.__REGISTROS__, dimensoesEmOrdem(filtrosSelecionados.dimensao));
      recalcularTabela();
      recalcularAlertas();

      var agora = new Date();
      definirStatusAtualizacao('Atualizado às ' + agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), false);
    })
    .catch(function (erro) {
      definirStatusAtualizacao('Falha ao atualizar: ' + erro.message, true);
    });
}

document.getElementById('atualizar-dashboard').addEventListener('click', atualizarDadosAoVivo);
`;

// Os sete filtros multi-select da barra principal e os cinco da aba
// Alertas: só id e rótulo inicial, porque as opções de cada um são
// montadas no cliente a partir dos registros decifrados.
const FILTROS_PRINCIPAIS = [
  { id: 'filtro-origem', rotulo: 'Todas as origens' },
  { id: 'filtro-categoria', rotulo: 'Todas as categorias' },
  { id: 'filtro-tipologia', rotulo: 'Todas as tipologias' },
  { id: 'filtro-grupo', rotulo: 'Todos os grupos' },
  { id: 'filtro-sup', rotulo: 'Todos os SUP' },
  { id: 'filtro-serie', rotulo: 'Todas as séries' },
  { id: 'seletor-dimensao', rotulo: 'Financeiro' },
];

const FILTROS_ALERTAS = [
  { id: 'filtro-alertas-agrupar-por', rotulo: 'SUP' },
  { id: 'filtro-alertas-numerico', rotulo: '2 selecionadas' },
  { id: 'filtro-alertas-baseline', rotulo: 'Previsto' },
  { id: 'filtro-alertas-periodo', rotulo: '2 selecionadas' },
  { id: 'filtro-alertas-status', rotulo: 'Status' },
];

// As três abas de visualização, na ordem em que aparecem; Tabela abre
// selecionada.
const ABAS_VISUALIZACAO = [
  { id: 'aba-tabela', rotulo: 'Tabela', ativa: true,
    svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>' },
  { id: 'aba-grafico', rotulo: 'Gráfico', ativa: false,
    svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M12 20V4M20 20v-7"/></svg>' },
  { id: 'aba-alertas', rotulo: 'Alertas', ativa: false,
    svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.29 3.86l-8.18 14.18A2 2 0 0 0 3.9 21h16.2a2 2 0 0 0 1.79-2.96L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>' },
];

// A faixa de ações da barra principal e a nota de premissa: markup pronto,
// já com o recuo que tinham antes, porque são conteúdo do orçamento e não
// da casca -- markupFiltros só encaixa os dois onde estavam.
const MARKUP_ACOES = `      <div class="filtros-acoes">
${markupAbas(ABAS_VISUALIZACAO, '        ')}
        <button id="limpar-filtros" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>Limpar filtros</button>
        <button id="atualizar-dashboard" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16M3 21v-5h5"/></svg>Atualizar dados</button>
        <span id="status-atualizacao" class="status-atualizacao"></span>
      </div>`;

const MARKUP_NOTA_PREMISSA = `      <div id="nota-premissa-produtividade" class="nota-premissa" style="display:none">Premissa: Produtividade = Volume ÷ (Equipes × dias do mês) — dias = 15 em Janeiro e Dezembro, 30 nos demais meses.</div>`;

function renderDashboard({ registros, periodos, generatedAt, logoDataUri, iconDataUri, senha, demandasChegadasMensais = {}, demandasSaldoAbertura = {} }) {
  if (!senha) {
    throw new Error('renderDashboard requer "senha" -- o conteúdo (SUP/Grupo/Tomador/Tipologia/valores) é cifrado com ela antes de ir pro HTML.');
  }
  const vigenteIdx = calcularVigenteIdx(periodos, generatedAt);
  const registrosJson = JSON.stringify({
    registros: registros.map(r => ({
      sup: r.sup, grupo: r.grupo, tomador: r.tomador, escopo: r.escopo, tipologia: r.tipologia, origem: r.origem,
      previstoInicial: r.previstoInicial, previsto: r.previsto, realizado: r.realizado, total: r.total,
    })),
    demandasChegadasMensais,
    demandasSaldoAbertura,
  });
  const dadosCifrados = cifrarComSenha(registrosJson, senha);
  const dadosCifradosJson = JSON.stringify(dadosCifrados).replace(/<\/script/gi, '<\\/script');

  const logoImg = logoDataUri ? `<img src="${logoDataUri}" alt="Suporte Infra">` : '';
  const watermarkImg = iconDataUri ? `<img class="watermark" src="${iconDataUri}" alt="">` : '';

  // Mesmo sistema visual (tema escuro, header com logo, chips, tabela) da
  // matriz de equipes (tools/matriz/render-dashboard.js) -- cores, fonte e
  // classes principais copiadas de lá pra manter os dois dashboards
  // consistentes entre si. Diferença deliberada: o fundo da tabela aqui é
  // translúcido, pra a marca d'água central aparecer por trás -- pedido
  // explícito do usuário, a matriz de equipes não faz isso.
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>ORÇAMENTO — MATRIZ</title>
<style>
${cssBase()}
</style>
</head>
<body>
  ${watermarkImg}
  <main>
${markupCabecalho({
    titulo: 'ORÇAMENTO — Previsto x Realizado x Tendência',
    subtitulo: `Gerado em ${escapeHtml(generatedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))}`,
    logo: logoImg,
    recuo: '  ',
  })}

  <div id="gate-senha" class="gate-senha">
    <div class="gate-senha-box">
      <h2>Digite a senha para abrir o dashboard</h2>
      <input type="password" id="campo-senha" autocomplete="off" placeholder="Senha">
      <button id="btn-desbloquear" type="button">Abrir</button>
      <div id="gate-senha-erro" class="gate-senha-erro" style="display:none"></div>
    </div>
  </div>

  <div id="conteudo-protegido" style="display:none">
${markupFiltros(FILTROS_PRINCIPAIS, {
      recuo: '    ', acoes: MARKUP_ACOES, extra: MARKUP_NOTA_PREMISSA,
    })}
    <div id="secao-tabela">
    <div class="table-scroll">
    <table id="tabela-orcamento">
      <thead><tr><th>SUP</th><th>Grupo</th><th>Tomador</th><th>Tipologia</th><th>Série</th>${renderCabecalhoMeses(periodos)}<th>Total</th></tr></thead>
      <tbody id="corpo-tabela"></tbody>
    </table>
    </div>
    </div>
    <div id="secao-grafico" style="display:none">
      <div id="graficos-container"></div>
      <div id="grafico-tooltip" class="grafico-tooltip" style="display:none"></div>
    </div>
    <div id="secao-alertas" style="display:none">
${markupFiltros(FILTROS_ALERTAS, { recuo: '      ', classes: 'filtros-alertas' })}
      <input id="busca-alertas" type="text" class="busca-alertas" placeholder="Buscar..." autocomplete="off">
      <div class="table-scroll">
      <table id="tabela-alertas">
        <thead id="cabecalho-alertas"></thead>
        <tbody id="corpo-alertas"></tbody>
      </table>
      </div>
    </div>
  </div>
  </main>
  <script>window.__VIGENTE_IDX__ = ${vigenteIdx}; window.__ANO_ORCAMENTO__ = ${periodos[0].getUTCFullYear()};</script>
  <script>window.__DADOS_CIFRADOS__ = ${dadosCifradosJson};</script>
  <script>${scriptDesbloqueio()}</script>
  <script>${fonteParaClienteTipologiasAvancos()}${fonteParaClienteTipologiasLab()}${fonteParaClienteDatas()}${fonteParaClienteLinhaBase()}</script>
  <script>${BUNDLE_DEMANDAS}</script>
  <script>${scriptFiltros()}${SCRIPT_CLIENTE_TABELA}</script>
</body>
</html>`;
}

module.exports = { renderDashboard };
