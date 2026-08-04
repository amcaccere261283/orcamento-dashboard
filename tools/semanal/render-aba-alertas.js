'use strict';
const { fecharMes, dividirEmSemanasInteiras, indiceSemanaAtual } = require('./compute-semanal.js');
const { calcularSeriesSemanaisDimensao, formatarIntervaloSemana } = require('./render-aba-semanal.js');

// Aba Alertas da página semanal -- porte da aba Alertas do orçamento
// (tools/orcamento/render-dashboard.js), a pedido do dono do projeto em
// 2026-08-03: "mantendo a mesma logica, identidade visual e status".
//
// O que é IDÊNTICO ao orçamento, de propósito (é o pedido):
//
//   - o semáforo: mesmas 4 faixas + "Sem dado", mesmos hex, mesmos rótulos
//     (ver classificarSemaforo abaixo, cópia literal);
//   - as 7 colunas da tabela (Agrupamento/Tomador/Combinação/Referência/
//     Pesquisado/Desvio/Status) e o círculo cheio de status;
//   - a montagem de colunas por Período x Numérico x Baseline em ordem
//     canônica fixa, nunca na ordem em que a pessoa marcou;
//   - o filtro de Status, que ESCONDE linhas (os outros decidem que colunas e
//     que grupos existem);
//   - a busca textual sobre as linhas já renderizadas.
//
// O que MUDOU, e por quê: os PERÍODOS. No orçamento eles são mensais
// (Mês Vigente, M+1..M+3, acumulados). Aqui são as semanas reais do mês
// selecionado (S1..Sn, ver semanasDoMes), mais "Acumulado até a semana atual"
// e "Mês inteiro" -- decisão do dono do projeto ao portar. Consequência
// estrutural: a lista de períodos NÃO é fixa (um mês de 2026 tem 5 ou 6
// semanas), então quem monta o filtro precisa reconstruí-la a cada troca de
// mês -- ver FILTROS_ALERTAS_CONFIG_SEMANAL em render-semanal.js.
//
// Os números NÃO são recalculados aqui: numerador e denominador saem de
// calcularSeriesSemanaisDimensao (render-aba-semanal.js), a MESMA função que
// desenha a Tabela Semanal e a aba Gráficos. É o que garante que as três abas
// nunca discordem sobre "o que a semana tal produziu" -- um segundo cálculo
// próprio aqui seria a origem óbvia dessa divergência.
//
// Este módulo roda tanto no Node (testes) quanto embrulhado no navegador via
// buildBrowserBundle -- por isso 'var'/'function', não 'const'/arrow, e só
// require de módulos do PRÓPRIO diretório (um '../comum/...' seria REMOVIDO
// pelo bundler e o nome viraria undefined em produção, com os testes em Node
// passando -- ver transformaModulo em tools/comum/browser-bundle.js).

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatarNumero(v, casasDecimais) {
  if (v === null || v === undefined) return '—';
  var casas = casasDecimais === undefined ? 2 : casasDecimais;
  var fator = Math.pow(10, casas);
  return (Math.round(v * fator) / fator).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

// normalizarBusca e categoriaTipologia são cópias das de scriptFiltros()
// (tools/comum/render-shell.js), duplicadas de propósito -- mesma razão já
// documentada em chaveDemandas (compute-balanco.js) e escapeHtml (todos os
// módulos do bundle): este arquivo vai pro bundle do navegador, onde um
// require de '../comum/' é apagado, e depender do global que scriptFiltros
// define daria um módulo que passa no Node e quebra (ou pior: funciona por
// acidente de ordem de <script>) em produção.
function normalizarBusca(texto) {
  var normalizado = (texto || '').toString().toLowerCase().normalize('NFD');
  var resultado = '';
  for (var i = 0; i < normalizado.length; i++) {
    var codigo = normalizado.charCodeAt(i);
    if (codigo < 768 || codigo > 879) resultado += normalizado[i];
  }
  return resultado;
}

var TIPOLOGIAS_SONDAGEM_ESPECIAL = { CPTU: true, BL: true, SH: true, VT: true };
function categoriaTipologia(tipologia) {
  var key = String(tipologia || '').trim().toUpperCase();
  if (key === 'LAB.C') return 'labConvencional';
  if (key === 'LAB.E') return 'labEspecial';
  if (TIPOLOGIAS_SONDAGEM_ESPECIAL[key]) return 'sondagemEspecial';
  return 'sondagemConvencional';
}

// Cópia literal de classificarSemaforo (tools/orcamento/render-dashboard.js),
// incluindo os hex: "mesma identidade visual e status" foi o pedido. Faixas
// fixas (spec 2026-07-23) -- mesma regra pra todas as dimensões, já que
// Financeiro aqui é receita bruta (não custo): maior é sempre melhor, sem
// inversão. >110% azul; 90%-110% (inclusive nas duas pontas) verde; 70%-90%
// (70 inclusive, 90 exclusivo) amarelo; <70% vermelho; sem dado cinza.
function classificarSemaforo(desvio) {
  if (desvio === null || desvio === undefined) return { cor: '#6E7580', indicador: 'Sem dado' };
  if (desvio > 1.10) return { cor: '#1414CC', indicador: 'Excelente' };
  if (desvio >= 0.90) return { cor: '#128A3E', indicador: 'Dentro da meta' };
  if (desvio >= 0.70) return { cor: '#F5A700', indicador: 'Atenção' };
  return { cor: '#D32020', indicador: 'Crítico' };
}

var STATUS_ORDEM = ['Excelente', 'Dentro da meta', 'Atenção', 'Crítico', 'Sem dado'];

// 'total' é o identificador da Tendência em todo o projeto (mesmo nome do
// campo no registro da MATRIZ) -- o rótulo de tela é "Tendência". Mantido
// igual ao orçamento para que os dois dashboards falem a mesma língua.
var SERIE_LABELS = { previsto: 'Previsto', previstoInicial: 'Previsto Inicial', realizado: 'Realizado', total: 'Tendência' };
var NUMERICO_ORDEM = ['realizado', 'total'];
var BASELINE_ORDEM = ['previsto', 'previstoInicial'];

var AGRUPAR_POR_ROTULO = { sup: 'SUP', tipologia: 'Tipologia', grupo: 'Grupo', categoria: 'Categoria', origem: 'Origem' };
var DIMENSOES_ROTULO = { equipes: 'Equipes', volume: 'Volume', financeiro: 'Financeiro' };

var PERIODO_ACUMULADO = 'acumuladoAteSemanaAtual';
var PERIODO_MES = 'mesInteiro';

// Quantas semanas do mês JÁ COMEÇARAM (fechadas + a em curso). Mês inteiro no
// passado devolve todas; mês que ainda não começou devolve 0. Calculada aqui,
// e não lida de calcularSeriesSemanaisDimensao.semanasElapsadas, porque lá ela
// só é preenchida no ramo de volume/financeiro -- os períodos desta aba
// precisam do mesmo recorte em QUALQUER dimensão, inclusive Equipes.
//
// NÃO confundir com indiceSemanaAtual (compute-semanal.js), que é a semana que
// CONTÉM hoje. Os dois coincidem no mês vigente e divergem em qualquer outro:
// num mês passado esta função devolve numSemanas (todas começaram) e aquela
// devolve -1 (nenhuma contém hoje). Usar `elapsadas - 1` como "semana em curso"
// para alimentar o cálculo fazia a última semana de um mês PASSADO ser contada
// de seu início até hoje -- ou seja, engolindo todos os meses seguintes (ver o
// teste "mês passado" em test/semanal-render-aba-alertas.test.js). Aqui
// 'elapsadas' serve só para recortar a janela do acumulado; quem diz qual
// semana está em curso é indiceSemanaAtual.
function semanasElapsadas(semanas, hojeEpoch) {
  if (!Array.isArray(semanas) || typeof hojeEpoch !== 'number') return 0;
  var n = 0;
  for (var i = 0; i < semanas.length; i++) {
    if (semanas[i].inicio <= hojeEpoch) n++;
  }
  return n;
}

// As opções do seletor de Período, nesta ordem: uma por semana real do mês,
// depois os dois acumulados. Os rótulos das semanas carregam o intervalo de
// datas ("S1 (01/07 a 05/07)"), mesma forma que o cabeçalho da Tabela Semanal
// já usa -- sem isso, "S1" de julho e "S1" de agosto pareceriam a mesma coisa.
function periodosDisponiveis(semanas) {
  var opcoes = (semanas || []).map(function (semana, i) {
    return { valor: 's' + (i + 1), rotulo: 'S' + (i + 1) + ' (' + formatarIntervaloSemana(semana.inicio, semana.fim) + ')' };
  });
  opcoes.push({ valor: PERIODO_ACUMULADO, rotulo: 'Acumulado até a semana atual' });
  opcoes.push({ valor: PERIODO_MES, rotulo: 'Mês inteiro' });
  return opcoes;
}

// Período -> [inicio, fim) em índices de semana. null quando o período não
// existe neste mês (um 's6' que ficou marcado e o usuário trocou pra um mês de
// 5 semanas) -- quem chama trata como coluna sem dado, nunca como o mês todo.
//
// PERIODO_ACUMULADO num mês que ainda não começou devolve [0,0), ou seja, uma
// janela VAZIA -- que vira "Sem dado", e não o mês inteiro: não há nada
// acumulado num mês futuro, e mostrar o mês todo ali seria uma afirmação
// falsa com cara de dado.
function janelaDoPeriodo(periodo, numSemanas, elapsadas) {
  if (periodo === PERIODO_MES) return [0, numSemanas];
  if (periodo === PERIODO_ACUMULADO) return [0, Math.min(elapsadas, numSemanas)];
  var n = parseInt(String(periodo).replace(/^s/, ''), 10);
  if (!(n >= 1 && n <= numSemanas)) return null;
  return [n - 1, n];
}

// Agrega as fatias semanais de UMA série dentro da janela. Soma pra volume/
// financeiro; MÉDIA pra equipes, que é foto e não fluxo -- a mesma regra que
// fecharMes (compute-semanal.js) já aplica na coluna de fechamento da Tabela
// Semanal, reaproveitada aqui em vez de reescrita. null quando a janela não
// tem nenhuma semana com valor: "não reportado" nunca vira zero.
function agregarFatias(fatias, dimensao, janela) {
  if (!janela || !Array.isArray(fatias)) return null;
  var validos = [];
  for (var i = janela[0]; i < janela[1] && i < fatias.length; i++) {
    if (fatias[i] === null || fatias[i] === undefined) continue;
    validos.push(fatias[i]);
  }
  if (!validos.length) return null;
  return fecharMes(validos, dimensao);
}

// Mesma expressão de chaveMatriz (tools/comum/linha-base.js), duplicada pelo
// mesmo motivo do resto do bundle.
function chaveBaseline(sup, tipologia) {
  return sup + '||' + tipologia;
}

// A linha de base ("Previsto Inicial") repartida nas semanas do mês, na mesma
// aritmética do Previsto: soma o mês dos registros do grupo e passa por
// dividirEmSemanasInteiras. Sem isso a coluna "÷ Previsto Inicial" precisaria
// de uma segunda regra de repartição, e as duas bases responderiam a perguntas
// com granularidades diferentes.
//
// 'baselinePorChave' é o array de baselineParaCliente já indexado por chave
// (ver indexarBaseline) -- indexar aqui, dentro do laço de grupos, refaria o
// mesmo mapa uma vez por grupo.
function previstoInicialNasSemanas(registros, indices, baselinePorChave, dimensao, mesIdx, numSemanas, semanas) {
  var soma = null;
  (indices || []).forEach(function (i) {
    var registro = registros[i];
    if (!registro) return;
    var entrada = baselinePorChave[chaveBaseline(registro.sup, registro.tipologia)];
    var mensal = entrada && entrada[dimensao];
    if (!Array.isArray(mensal)) return;
    var v = mensal[mesIdx];
    if (v === null || v === undefined) return;
    soma = (soma === null ? 0 : soma) + v;
  });
  return dividirEmSemanasInteiras(soma, dimensao, numSemanas, semanas);
}

function indexarBaseline(baseline) {
  var porChave = {};
  (baseline || []).forEach(function (entrada) {
    if (entrada && entrada.chave) porChave[entrada.chave] = entrada;
  });
  return porChave;
}

// Uma célula: numerador ÷ denominador dentro da janela do período. Mesma
// regra de "sem dado" do orçamento (calcularCelulaAlerta): denominador 0 ou
// null, ou numerador null, devolvem desvio null -- e null vira o status cinza,
// nunca 0%.
// 'elapsadas' existe aqui por uma razão só: uma janela INTEIRAMENTE no futuro
// tem de virar "Sem dado", não "Crítico 0%". calcularSeriesSemanaisDimensao
// devolve 0 (não null) nas semanas futuras -- decisão deliberada dela, que a
// aba Gráficos depende para desenhar a curva -- e somar zeros aqui produziria
// um desvio de 0%, ou seja, vermelho crítico numa semana que ainda não
// aconteceu. É exatamente o "ausência vira zero" que o resto do projeto
// combate, e também quebra a paridade com o orçamento, onde um período futuro
// (M+1, M+2) devolve null e aparece cinza.
//
// A correção mora AQUI, e não em calcularSeriesSemanaisDimensao: os outros
// consumidores daquela função precisam do 0.
//
// Janela que ATRAVESSA o presente (o caso de "Mês inteiro") continua somando os
// zeros futuros de propósito -- ali o Realizado parcial contra o Previsto
// cheio é a leitura pretendida, a mesma que "Total Ano" tem no orçamento.
function calcularCelulaAlerta(series, semanasPrevistoInicial, coluna, dimensao, janela, elapsadas) {
  var fatiasNumerico = coluna.numerico === 'realizado' ? series.semanasRealizado : series.semanasTendenciaCompleta;
  var fatiasBaseline = coluna.baseline === 'previsto' ? series.semanasPrevisto : semanasPrevistoInicial;
  var inteiramenteNoFuturo = !!janela && janela[1] > janela[0] && janela[0] >= (elapsadas || 0);
  var numerador = inteiramenteNoFuturo ? null : agregarFatias(fatiasNumerico, dimensao, janela);
  var denominador = agregarFatias(fatiasBaseline, dimensao, janela);
  var desvio = (numerador === null || !denominador) ? null : numerador / denominador;
  return { desvio: desvio, numerador: numerador, denominador: denominador };
}

function emOrdemCanonica(ordem, selecionados) {
  return ordem.filter(function (v) { return selecionados.indexOf(v) !== -1; });
}

// Uma coluna por combinação marcada de Período x Numérico x Baseline, na ordem
// fixa Período -> Numérico -> Baseline -- igual ao orçamento, nunca a ordem em
// que a pessoa marcou os checkboxes. 'periodosOrdenados' já vem na ordem de
// periodosDisponiveis (S1..Sn, depois os acumulados), que é a ordem canônica
// desta página.
function colunasAlertas(numericos, baselines, periodos, rotulosPeriodo) {
  var colunas = [];
  var numericosOrdenados = emOrdemCanonica(NUMERICO_ORDEM, numericos);
  var baselinesOrdenadas = emOrdemCanonica(BASELINE_ORDEM, baselines);
  periodos.forEach(function (periodo) {
    numericosOrdenados.forEach(function (numerico) {
      baselinesOrdenadas.forEach(function (baseline) {
        colunas.push({
          numerico: numerico, baseline: baseline, periodo: periodo,
          rotulo: SERIE_LABELS[numerico] + ' ÷ ' + SERIE_LABELS[baseline] + ' — ' + (rotulosPeriodo[periodo] || periodo),
        });
      });
    });
  });
  return colunas;
}

// O '—' cobre registro sem o campo de agrupamento (grupo/origem em branco na
// MATRIZ): sem ele o grupo aparecia rotulado "undefined" na tela, que parece
// defeito de software e não célula vazia da planilha.
function campoAgrupamento(registro, agruparPor) {
  if (agruparPor === 'categoria') return categoriaTipologia(registro.tipologia);
  var valor = registro && registro[agruparPor];
  return (valor === null || valor === undefined || valor === '') ? '—' : valor;
}

function agruparIndicesAlertas(registros, indices, agruparPor) {
  var porChave = {};
  var ordem = [];
  (indices || []).forEach(function (idx) {
    var chave = campoAgrupamento(registros[idx], agruparPor);
    if (!porChave[chave]) { porChave[chave] = []; ordem.push(chave); }
    porChave[chave].push(idx);
  });
  ordem.sort();
  return ordem.map(function (chave) { return { chave: chave, indices: porChave[chave] }; });
}

// Tomador do grupo -- só é um valor único de verdade quando agruparPor é
// "sup" (1 SUP = 1 tomador sempre). Agrupando por tipologia/categoria/grupo/
// origem, ou na linha TOTAL GERAL, o grupo quase sempre cruza vários
// tomadores; "Vários" deixa isso explícito em vez de mostrar só o 1º
// encontrado, que pareceria (errado) que só existe aquele.
function tomadorDoGrupo(registros, indices) {
  var tomadores = [];
  (indices || []).forEach(function (idx) {
    var t = registros[idx] && registros[idx].tomador;
    if (t && tomadores.indexOf(t) === -1) tomadores.push(t);
  });
  if (tomadores.length === 0) return '—';
  if (tomadores.length === 1) return tomadores[0];
  return 'Vários';
}

function renderCabecalhoAlertas(agruparPorRotulo, dimensaoRotulo) {
  return '<tr><th>' + escapeHtml(agruparPorRotulo) + '</th><th>Tomador</th><th>Combinação</th>'
    + '<th>Referência (' + escapeHtml(dimensaoRotulo) + ')</th>'
    + '<th>Pesquisado (' + escapeHtml(dimensaoRotulo) + ')</th>'
    + '<th>Desvio</th><th>Status</th></tr>';
}

// statusFiltro (array dos rótulos marcados) omite a linha inteira quando o
// status calculado não bate -- array vazio mostra tudo, mesma convenção dos
// filtros de recorte da barra de cima.
function renderLinhaAlerta(rotuloGrupo, tomadorGrupo, series, semanasPrevistoInicial, coluna, dimensao, janela, statusFiltro, elapsadas) {
  var celula = calcularCelulaAlerta(series, semanasPrevistoInicial, coluna, dimensao, janela, elapsadas);
  var classe = classificarSemaforo(celula.desvio);
  if (statusFiltro && statusFiltro.length > 0 && statusFiltro.indexOf(classe.indicador) === -1) return '';
  var desvioTexto = celula.desvio === null ? '—' : Math.round(celula.desvio * 100) + '%';
  // Equipes em 2 casas (é média ponderada, "3 equipes" e "3,4 equipes" são
  // coisas diferentes); volume/financeiro inteiros, como no orçamento.
  var casas = dimensao === 'equipes' ? 2 : 0;
  var busca = normalizarBusca(rotuloGrupo + ' ' + tomadorGrupo + ' ' + coluna.rotulo);
  return '<tr data-search="' + escapeHtml(busca) + '">'
    + '<td>' + escapeHtml(rotuloGrupo) + '</td>'
    + '<td>' + escapeHtml(tomadorGrupo) + '</td>'
    + '<td>' + escapeHtml(coluna.rotulo) + '</td>'
    + '<td class="num">' + formatarNumero(celula.denominador, casas) + '</td>'
    + '<td class="num">' + formatarNumero(celula.numerador, casas) + '</td>'
    + '<td class="num">' + desvioTexto + '</td>'
    + '<td><span class="status-circulo" style="background:' + classe.cor + '"></span>' + escapeHtml(classe.indicador) + '</td>'
    + '</tr>';
}

// As séries semanais do grupo são calculadas UMA vez e reaproveitadas por
// todas as colunas dele -- as colunas só diferem em qual série e que janela
// de semanas olham, e recalcular por coluna multiplicaria por 2x2xN o trabalho
// mais caro da aba (contar eventos de furo através dos registros do grupo).
function renderLinhasGrupoAlerta(rotuloGrupo, registros, indices, colunas, ctx) {
  var tomadorGrupo = tomadorDoGrupo(registros, indices);
  var series = calcularSeriesSemanaisDimensao(
    registros, indices, ctx.dimensao, ctx.mesIdx, ctx.semanas, ctx.numSemanas,
    ctx.temSemanasReais, ctx.indiceAtual, ctx.demandas, ctx.hojeEpoch
  );
  var semanasPrevistoInicial = previstoInicialNasSemanas(
    registros, indices, ctx.baselinePorChave, ctx.dimensao, ctx.mesIdx, ctx.numSemanas, ctx.semanas
  );
  return colunas.map(function (coluna) {
    return renderLinhaAlerta(
      rotuloGrupo, tomadorGrupo, series, semanasPrevistoInicial, coluna,
      ctx.dimensao, janelaDoPeriodo(coluna.periodo, ctx.numSemanas, ctx.elapsadas), ctx.statusFiltro,
      ctx.elapsadas
    );
  }).join('');
}

// opcoes: { agruparPor, dimensao, numericos, baselines, periodos, statusFiltro,
//   mesIdx, ano, semanas, demandas, hojeEpoch, baseline }.
// Devolve só o <tbody> -- o cabeçalho sai de renderCabecalhoAlertas, como no
// orçamento (os dois têm elementos próprios na página e são substituídos
// juntos a cada recálculo).
function renderCorpoAlertas(registros, indices, opcoes) {
  var o = opcoes || {};
  var semanas = o.semanas || [];
  var numSemanas = semanas.length;
  var rotulosPeriodo = {};
  periodosDisponiveis(semanas).forEach(function (p) { rotulosPeriodo[p.valor] = p.rotulo; });
  var colunas = colunasAlertas(o.numericos || [], o.baselines || [], o.periodos || [], rotulosPeriodo);

  var temDemandas = !!(o.demandas && o.demandas.porRegistroEventos && typeof o.hojeEpoch === 'number');
  var elapsadas = semanasElapsadas(semanas, o.hojeEpoch);
  var ctx = {
    dimensao: o.dimensao || 'financeiro',
    mesIdx: o.mesIdx,
    semanas: semanas,
    numSemanas: numSemanas,
    temSemanasReais: numSemanas > 0 && temDemandas,
    // A MESMA função que a Tabela Semanal usa (renderAbaSemanal) -- é o que
    // garante que as duas abas nunca discordem sobre o que a semana tal
    // produziu. Ver o comentário de semanasElapsadas sobre por que
    // `elapsadas - 1` NÃO serve aqui.
    indiceAtual: numSemanas > 0 && typeof o.hojeEpoch === 'number' ? indiceSemanaAtual(semanas, o.hojeEpoch) : -1,
    elapsadas: elapsadas,
    demandas: o.demandas,
    hojeEpoch: o.hojeEpoch,
    baselinePorChave: indexarBaseline(o.baseline),
    statusFiltro: o.statusFiltro || [],
  };

  var grupos = agruparIndicesAlertas(registros, indices, o.agruparPor || 'sup');
  var linhas = grupos.map(function (g) { return renderLinhasGrupoAlerta(g.chave, registros, g.indices, colunas, ctx); });
  linhas.push(renderLinhasGrupoAlerta('TOTAL GERAL', registros, indices, colunas, ctx));
  return linhas.join('');
}

module.exports = {
  renderCorpoAlertas, renderCabecalhoAlertas, classificarSemaforo, colunasAlertas,
  agruparIndicesAlertas, tomadorDoGrupo, periodosDisponiveis, janelaDoPeriodo,
  agregarFatias, semanasElapsadas, calcularCelulaAlerta, previstoInicialNasSemanas,
  indexarBaseline, normalizarBusca,
  AGRUPAR_POR_ROTULO, DIMENSOES_ROTULO, SERIE_LABELS, STATUS_ORDEM,
  NUMERICO_ORDEM, BASELINE_ORDEM, PERIODO_ACUMULADO, PERIODO_MES,
};
