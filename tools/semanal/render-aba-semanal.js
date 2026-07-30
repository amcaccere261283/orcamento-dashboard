'use strict';
const { SEMANAS, dividirEmSemanas, fecharMes, semanaAtual } = require('./compute-semanal.js');

// Rótulo de exibição de cada dimensão -- só as 3 que a barra de filtros da
// semanal expõe (ver FILTROS_CONFIG_SEMANAL/DIMENSOES_CONFIG_SEMANAL em
// render-semanal.js); "produtividade"/"ticketMedio" do orçamento não têm
// equivalente aqui.
var DIMENSOES_ROTULO_SEMANAL = { equipes: 'Equipes', volume: 'Volume', financeiro: 'Financeiro' };

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

// Mesma expressão de chaveMatriz (tools/comum/linha-base.js) -- duplicada de
// propósito porque este módulo entra no bundle do navegador
// (buildBrowserBundle remove require('../comum/...'), não reescreve -- mesmo
// motivo já documentado em chaveBaseline, tools/semanal/compute-balanco.js).
function chaveDemandas(sup, tipologia) {
  return sup + '||' + tipologia;
}

// Soma, através dos registros em 'indices', uma série de demandas.porRegistro
// (Task 1, compute-demandas.js) no mês vigente -- mesmo padrão de
// soma-através-de-registros que previstoMesVigente já usa, só que a fonte é
// 'demandas' (Avanço Sond), não registro.previsto. Ausência de (sup,
// tipologia) em porRegistro significa ZERO furos para aquele par -- não "sem
// dado reportado" (null): o Avanço Sond é uma listagem completa de furos, uma
// combinação ausente é uma contagem real de zero. null só quando 'indices'
// está vazio (nenhum registro selecionado) -- mesma regra de
// previstoMesVigente.
//
// Assume (sup, tipologia) único por registro selecionado -- se a MATRIZ um
// dia tiver 2 linhas com a mesma combinação ambas somariam o mesmo balde de
// porRegistro, dobrando o Realizado/Pendentes. Não verificado neste código;
// parse-matriz.js documenta 3 linhas físicas por combinação hoje.
//
// Também assume que registro.tipologia (MATRIZ) é a mesma etiqueta que
// chega em furo.tipologia (Avanços, já mapeada por rotularTipologia) -- só
// as tipologias que a MATRIZ conhece aparecem aqui. Tipologias que só
// existem nos Avanços (ex.: SEG.A/SEG.V, acionadas sob demanda) nunca
// contribuem pra Realizado/Pendentes na Tabela Semanal -- mesmo escopo que
// o Previsto já tem hoje, não é uma lacuna nova desta task.
function demandasMesVigente(registros, indices, demandas, serie, vigenteIdx) {
  if (!indices || !indices.length) return null;
  // vigenteIdx pode vir fora do intervalo do ano da planilha (12 = ano
  // inteiro no passado, -1 = ano inteiro no futuro -- calcularVigenteIdx em
  // tools/comum/datas.js). Nesse caso não existe "mês vigente" real: sem
  // este guard, entrada[serie][vigenteIdx] vira undefined pra TODO registro
  // e "|| 0" transformaria isso num 0,00 real -- indistinguível de "mês
  // vigente existe e teve zero furos". demandas.totais[serie] tem o mesmo
  // comprimento de periodos (sempre presente, mesmo com porRegistro vazio),
  // então serve de fonte confiável do tamanho do ano sem precisar de um
  // parâmetro novo.
  var totalSerie = demandas.totais && demandas.totais[serie];
  if (!Array.isArray(totalSerie) || vigenteIdx < 0 || vigenteIdx >= totalSerie.length) return null;
  var soma = 0;
  indices.forEach(function (i) {
    var registro = registros[i];
    if (!registro) return;
    var entrada = demandas.porRegistro[chaveDemandas(registro.sup, registro.tipologia)];
    if (entrada && Array.isArray(entrada[serie])) soma += (entrada[serie][vigenteIdx] || 0);
  });
  return soma;
}

// Tendência semanal (Volume): semanas já passadas (<= semanaAtualNum) usam o
// Realizado nominal daquela semana; semanas futuras distribuem igualmente o
// que falta pra bater o Previsto do mês -- ver "Semana atual e Tendência" no
// spec (docs/superpowers/specs/2026-07-30-semanal-realizado-tendencia-balanco-visual-design.md).
// Por construção, a soma das 4 semanas bate com previstoMes quando há
// semana(s) futura(s) -- "mantido o resto do plano, o mês fecha como
// planejado". null (as 4 semanas) quando previstoMes ou realizadoMes for
// null.
function calcularTendenciaSemanal(previstoMes, realizadoMes, semanasRealizado, semanaAtualNum) {
  if (previstoMes === null || realizadoMes === null) return new Array(SEMANAS).fill(null);
  var realizadoAteAgora = (realizadoMes / SEMANAS) * semanaAtualNum;
  var semanasRestantes = SEMANAS - semanaAtualNum;
  var saldoRestante = previstoMes - realizadoAteAgora;
  // Realizado já bateu (ou passou) o Previsto do mês até a semana atual:
  // saldoRestante fica <= 0, e dividir isso pelas semanas futuras projetaria
  // furos NEGATIVOS -- sem sentido. Nesse caso a Tendência passa a seguir o
  // mesmo ritmo já realizado (realizadoMes/SEMANAS) em vez do saldo, então o
  // mês fecha em realizadoMes (o que já foi feito), não seria coerente
  // fechar em algo menor que o já realizado.
  var tendenciaFutura = semanasRestantes > 0
    ? (saldoRestante > 0 ? saldoRestante / semanasRestantes : realizadoMes / SEMANAS)
    : 0;
  var saida = [];
  for (var s = 1; s <= SEMANAS; s++) {
    saida.push(s <= semanaAtualNum ? semanasRealizado[s - 1] : tendenciaFutura);
  }
  return saida;
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

// registros/indices/dimensoes/vigenteIdx: mesmos parâmetros de sempre (ver
// comentário original abaixo). 'realizado' é um 5º parâmetro OPCIONAL --
// { demandas, diaDoMes, diasNoMes } -- que ativa Realizado/Tendência/
// Demandas Pendentes só no bloco Volume, quando demandas.porRegistro existe
// (Task 1). Omitido, ou com porRegistro ausente/vazio, o HTML produzido é
// IDÊNTICO ao de antes desta tarefa -- nenhuma chamada existente precisa
// mudar.
//
// Previsto vem de dividirEmSemanas aplicado à soma do Previsto do mês
// vigente através dos registros selecionados. diaDoMes/diasNoMes vêm do
// relógio de quem está vendo a página (render-semanal.js calcula com
// `new Date()` a cada recálculo) -- esta função nunca chama new Date()
// internamente, fica pura e testável em Node com qualquer combinação.
function renderAbaSemanal(registros, indices, dimensoes, vigenteIdx, realizado) {
  var opts = realizado || {};
  var temDadosDemandas = !!(opts.demandas && opts.demandas.porRegistro && opts.diaDoMes && opts.diasNoMes);

  return dimensoes.map(function (dimensao) {
    var mesVigente = previstoMesVigente(registros, indices, dimensao, vigenteIdx);
    var semanasPrevisto = dividirEmSemanas(mesVigente, dimensao, SEMANAS); // ponte temporária -- Tarefa 3 troca por numSemanas real
    var fechamentoPrevisto = fecharMes(semanasPrevisto, dimensao);
    var semanasSemDado = new Array(SEMANAS).fill(null);

    var semanasRealizado = semanasSemDado;
    var fechamentoRealizado = null;
    var semanasTendencia = semanasSemDado;
    var fechamentoTendencia = null;
    var linhaPendentes = '';

    if (dimensao === 'volume' && temDadosDemandas) {
      var realizadoMes = demandasMesVigente(registros, indices, opts.demandas, 'sondagemRealizada', vigenteIdx);
      semanasRealizado = dividirEmSemanas(realizadoMes, 'volume', SEMANAS); // ponte temporária -- Tarefa 3 troca por numSemanas real
      fechamentoRealizado = fecharMes(semanasRealizado, 'volume');

      var semanaAtualNum = semanaAtual(opts.diaDoMes, opts.diasNoMes);
      semanasTendencia = calcularTendenciaSemanal(mesVigente, realizadoMes, semanasRealizado, semanaAtualNum);
      fechamentoTendencia = fecharMes(semanasTendencia, 'volume');

      var pendentesMes = demandasMesVigente(registros, indices, opts.demandas, 'pendentes', vigenteIdx);
      linhaPendentes = renderLinhaSerie('Demandas Pendentes', 'pendentes-demandas', semanasSemDado, pendentesMes);
    }

    return '<div class="bloco-dimensao-semanal">'
      + '<div class="tabela-semanal-titulo">' + escapeHtml(DIMENSOES_ROTULO_SEMANAL[dimensao] || dimensao) + '</div>'
      + '<table class="tabela-semanal">'
      + renderCabecalho(dimensao)
      + '<tbody>'
      + renderLinhaSerie('Previsto', 'previsto', semanasPrevisto, fechamentoPrevisto)
      + renderLinhaSerie('Realizado', 'realizado', semanasRealizado, fechamentoRealizado)
      + renderLinhaSerie('Tendência', 'tendencia', semanasTendencia, fechamentoTendencia)
      + linhaPendentes
      + '</tbody></table></div>';
  }).join('');
}

module.exports = { renderAbaSemanal, rotuloColunaFechamento };
