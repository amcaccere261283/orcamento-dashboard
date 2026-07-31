'use strict';
const { semanasDoMes, indiceSemanaAtual, dividirEmSemanas, fecharMes } = require('./compute-semanal.js');

// Rótulo de exibição de cada dimensão -- só as 3 que a barra de filtros da
// semanal expõe (ver FILTROS_CONFIG_SEMANAL/DIMENSOES_CONFIG_SEMANAL em
// render-semanal.js); "produtividade"/"ticketMedio" do orçamento não têm
// equivalente aqui.
var DIMENSOES_ROTULO_SEMANAL = { equipes: 'Equipes', volume: 'Volume', financeiro: 'Financeiro' };

// Este módulo roda tanto no Node (testes) quanto embrulhado no navegador via
// buildBrowserBundle -- por isso 'var'/'function', não 'const'/arrow. A
// linha de import acima segue a forma EXATA que a reescrita de transformaModulo
// reconhece: const + chaves sem espaço antes delas + nomes destrutrados + módulo
// relativo (ex.: `const { X, Y } = <modulo>` no padrão esperado). Ver o
// comentário no topo de transformaModulo lá.

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
// quando NENHUM registro contribuinte tem valor no mês vigente -- inclusive
// quando vigenteIdx está fora de [0,11] (mensal[vigenteIdx] é undefined).
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
// (as dependências externas são removidas, não reescritas -- mesmo
// motivo já documentado em chaveBaseline, tools/semanal/compute-balanco.js).
function chaveDemandas(sup, tipologia) {
  return sup + '||' + tipologia;
}

// Soma, através dos registros em 'indices', quantos eventos de uma série de
// porRegistroEventos (compute-demandas.js) caem em [inicioEpoch, fimEpoch]
// (inclusive nos dois extremos). Ausência de (sup, tipologia) em
// porRegistroEventos, ou nenhum evento no intervalo, conta 0 -- mesma
// convenção "ausência = zero" de sempre (Avanço Sond é listagem completa).
// pesoPorRegistro (opcional): função registro -> peso, aplicada à contagem
// de CADA registro antes de somar (nunca à soma final) -- Financeiro usa
// isso pra multiplicar o volume realizado de cada registro pelo TICKET
// médio DAQUELE registro antes de somar em R$, já que registros diferentes
// no mesmo recorte podem ter tickets diferentes (somar volumes primeiro e
// multiplicar por uma média depois daria um número errado, exceto quando
// todos têm o mesmo ticket). Volume não passa peso nenhum (padrão 1,
// contagem pura de furos).
function contarEventosNoIntervalo(registros, indices, demandas, serie, inicioEpoch, fimEpoch, pesoPorRegistro) {
  var total = 0;
  (indices || []).forEach(function (i) {
    var registro = registros[i];
    if (!registro) return;
    var entrada = demandas.porRegistroEventos[chaveDemandas(registro.sup, registro.tipologia)];
    if (!entrada || !Array.isArray(entrada[serie])) return;
    var peso = pesoPorRegistro ? pesoPorRegistro(registro) : 1;
    if (!peso) return;
    var conta = 0;
    entrada[serie].forEach(function (dia) {
      if (dia >= inicioEpoch && dia <= fimEpoch) conta += 1;
    });
    total += conta * peso;
  });
  return total;
}

// TICKET médio (R$ por furo) do registro -- premissa do Previsto, lida
// direto da MATRIZ (coluna TICKET, ver tools/orcamento/parse-matriz.js), a
// MESMA premissa que o orçamento já usa pra calcular ticketMedio do
// Previsto (tools/orcamento/compute-orcamento.js, calcularDimensaoPrevisto).
// Um valor fixo pro ano inteiro, por (sup, tipologia) -- não muda semana a
// semana. Registro sem TICKET cadastrado na planilha conta 0 (mesma regra
// do orçamento): sem premissa de preço, sem R$ atribuído aos furos dele.
function ticketMedio(registro) {
  return (registro && registro.previsto && registro.previsto.volumeResumo && registro.previsto.volumeResumo.ticket) || 0;
}

// Saldo de furos em aberto na data 'dataEpoch' (inclusive), através dos
// registros em 'indices': chegou até ali, e ainda não saiu do estoque até
// ali. saidaEstoque já é o menor entre término e cancelamento, calculado
// por furo em compute-demandas.js -- ver o comentário lá sobre por que não
// dá pra subtrair as duas listas independentes.
function pendentesNaData(registros, indices, demandas, dataEpoch) {
  var total = 0;
  (indices || []).forEach(function (i) {
    var registro = registros[i];
    if (!registro) return;
    var entrada = demandas.porRegistroEventos[chaveDemandas(registro.sup, registro.tipologia)];
    if (!entrada) return;
    (entrada.chegada || []).forEach(function (dia) { if (dia <= dataEpoch) total += 1; });
    (entrada.saidaEstoque || []).forEach(function (dia) { if (dia <= dataEpoch) total -= 1; });
  });
  return total;
}

// Tendência semanal (Volume): semanas já fechadas ou em curso usam o
// Realizado REAL daquela semana (já é fato, não precisa projetar); semanas
// futuras distribuem igualmente o que falta pra bater o Previsto do mês.
// Quando o Realizado até agora já bateu ou passou o Previsto (saldo <= 0),
// as semanas futuras continuam no mesmo ritmo médio já realizado em vez de
// projetar um valor negativo. indiceAtual === -1 (nenhuma semana do mês
// começou ainda -- dias de fronteira entre meses) conta como "nenhuma
// semana elapsada": todas as semanas do mês são futuras, e a Tendência
// mostra previstoMes/numSemanas igualmente em todas.
function calcularTendenciaSemanal(previstoMes, semanasRealizado, indiceAtual) {
  var numSemanas = semanasRealizado.length;
  if (previstoMes === null) return semanasRealizado.map(function () { return null; });

  var semanasElapsadas = indiceAtual + 1; // 0 quando indiceAtual === -1
  var realizadoAteAgora = 0;
  for (var s = 0; s < semanasElapsadas; s++) realizadoAteAgora += semanasRealizado[s];

  var semanasFuturas = numSemanas - semanasElapsadas;
  var saldoRestante = previstoMes - realizadoAteAgora;
  var ritmoRealizado = semanasElapsadas > 0 ? realizadoAteAgora / semanasElapsadas : previstoMes / numSemanas;
  var tendenciaFutura = semanasFuturas > 0
    ? (saldoRestante > 0 ? saldoRestante / semanasFuturas : ritmoRealizado)
    : 0;

  var saida = [];
  for (var i = 0; i < numSemanas; i++) {
    saida.push(i < semanasElapsadas ? semanasRealizado[i] : tendenciaFutura);
  }
  return saida;
}

// '05' em vez de '5' -- sem toLocaleString/padStart (o resto deste módulo já
// evita depender deles fora do formatador de número principal), só divisão
// inteira manual.
function doisDigitos(n) { return (n < 10 ? '0' : '') + n; }

// 'dd/MM a dd/MM' a partir de um par inicio/fim em diaEpoch (mesma unidade
// de compute-semanal.js). Reconstrói o Date multiplicando de volta por
// 86400000 -- como diaEpoch nunca ajusta fuso, cai exatamente na meia-noite
// UTC daquele dia, então lê com getUTC* (mesma convenção do resto do
// arquivo, nunca Date local).
function formatarIntervaloSemana(inicioEpoch, fimEpoch) {
  var i = new Date(inicioEpoch * 86400000);
  var f = new Date(fimEpoch * 86400000);
  return doisDigitos(i.getUTCDate()) + '/' + doisDigitos(i.getUTCMonth() + 1)
    + ' a ' + doisDigitos(f.getUTCDate()) + '/' + doisDigitos(f.getUTCMonth() + 1);
}

// 'semanas' (opcional) são as semanas reais do mês vigente (ver
// compute-semanal.js), na mesma ordem das colunas -- cada rótulo "Sn" ganha
// o intervalo de datas ao lado ("S1 (01/07 a 05/07)"). Sem mês vigente
// válido (semanas ausente ou vazio, ver renderAbaSemanal abaixo) os rótulos
// caem no fallback "Sn" puro -- não há semana real pra descrever.
function renderCabecalho(dimensao, numSemanas, semanas) {
  var colunasSemana = '';
  for (var i = 1; i <= numSemanas; i++) {
    var semana = semanas && semanas[i - 1];
    var rotulo = semana ? ('S' + i + ' (' + formatarIntervaloSemana(semana.inicio, semana.fim) + ')') : ('S' + i);
    colunasSemana += '<th>' + escapeHtml(rotulo) + '</th>';
  }
  return '<thead><tr><th></th>' + colunasSemana + '<th>' + escapeHtml(rotuloColunaFechamento(dimensao)) + '</th></tr></thead>';
}

// 'semanas' são os N valores por semana (ou null); 'fechamento' é o valor já
// fechado (fecharMes) pra a coluna final. null em qualquer um vira a classe
// sem-dado.
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

// Previsto/Realizado/Tendência por semana, JÁ FECHADOS (fecharMes), pra UMA
// dimensão -- puro cálculo numérico, sem HTML. Extraído do corpo de
// renderAbaSemanal (achado de 2026-08-01, ao criar a aba Gráficos) pra
// nunca haver dois lugares calculando "o que a semana tal produziu": a
// Tabela Semanal (renderLinhaSerie, abaixo) e a aba Gráficos
// (render-aba-grafico-semanal.js) chamam esta mesma função e nunca podem
// divergir sobre o número.
//
// temSemanasReais (= mesValido && temDemandas, calculado uma vez só por
// quem chama, pros vários dimensoes.map(...) não recalcularem à toa):
// sem isso, Realizado/Tendência ficam nos arrays de numSemanas nulls
// (mesmo comportamento de sempre -- sem mês vigente válido ou sem
// 'demandas', não tem como saber o que aconteceu em cada semana).
// indiceAtual/demandas/hojeEpoch: mesmos parâmetros que
// contarEventosNoIntervalo/calcularTendenciaSemanal já usavam inline.
function calcularSeriesSemanaisDimensao(registros, indices, dimensao, vigenteIdx, semanas, numSemanas, temSemanasReais, indiceAtual, demandas, hojeEpoch) {
  var mesVigente = previstoMesVigente(registros, indices, dimensao, vigenteIdx);
  var semanasPrevisto = dividirEmSemanas(mesVigente, dimensao, numSemanas);
  var fechamentoPrevisto = fecharMes(semanasPrevisto, dimensao);
  var semanasSemDado = new Array(numSemanas).fill(null);

  var semanasRealizado = semanasSemDado;
  var fechamentoRealizado = null;
  var semanasTendencia = semanasSemDado;
  var fechamentoTendencia = null;

  // Realizado/Tendência: Volume conta furos reais; Financeiro pega o MESMO
  // furo real e multiplica pelo ticket médio do registro dono daquele furo
  // antes de somar (pesoPorRegistro) -- é o "acompanhamento do produzido"
  // em R$, na mesma lógica semanal do Volume, sem precisar de outra fonte
  // de dado (o ticket já vem na MATRIZ, junto do resto do registro).
  // Equipes nunca entra aqui (não é fluxo de furo, é foto -- ver
  // compute-semanal.js): fica só com o Previsto acima, repetido igual em
  // cada semana.
  if ((dimensao === 'volume' || dimensao === 'financeiro') && temSemanasReais) {
    var pesoPorRegistro = dimensao === 'financeiro' ? ticketMedio : null;

    semanasRealizado = semanas.map(function (semana, i) {
      if (i === indiceAtual) return contarEventosNoIntervalo(registros, indices, demandas, 'sondagemRealizada', semana.inicio, hojeEpoch, pesoPorRegistro);
      if (semana.fim < hojeEpoch) return contarEventosNoIntervalo(registros, indices, demandas, 'sondagemRealizada', semana.inicio, semana.fim, pesoPorRegistro);
      return 0; // semana futura -- nada aconteceu ainda
    });
    fechamentoRealizado = fecharMes(semanasRealizado, dimensao);

    // Mesma contagem direta pelas datas que renderAbaSemanal já usava --
    // ver o comentário original em calcularTendenciaSemanal sobre por que
    // não usar indiceAtual aqui.
    var semanasElapsadas = 0;
    for (var se = 0; se < semanas.length; se++) {
      if (semanas[se].inicio <= hojeEpoch) semanasElapsadas++;
    }
    semanasTendencia = calcularTendenciaSemanal(mesVigente, semanasRealizado, semanasElapsadas - 1);
    fechamentoTendencia = fecharMes(semanasTendencia, dimensao);
  }

  return {
    mesVigente: mesVigente,
    semanasPrevisto: semanasPrevisto, fechamentoPrevisto: fechamentoPrevisto,
    semanasRealizado: semanasRealizado, fechamentoRealizado: fechamentoRealizado,
    semanasTendencia: semanasTendencia, fechamentoTendencia: fechamentoTendencia,
  };
}

// registros/indices/dimensoes/vigenteIdx: mesmos parâmetros de sempre. 'ano'
// (novo, obrigatório) é o ano civil da planilha (periodos[0].getUTCFullYear())
// -- necessário pra semanasDoMes saber quantas semanas (5 ou 6, nunca 4 --
// ver compute-semanal.js) o mês vigente tem, mesmo quando 'realizado' não é
// passado (Previsto/Equipes/
// Financeiro precisam da contagem certa de colunas independente de haver
// dado de demandas). 'realizado' é um 6º parâmetro OPCIONAL --
// { demandas, hojeEpoch } -- que ativa Realizado/Tendência nos blocos
// Volume e Financeiro (Financeiro pesa cada furo pelo TICKET médio do
// registro dono dele -- ver ticketMedio/pesoPorRegistro acima) e Demandas
// Pendentes só no bloco Volume (estoque de furos, sem análogo em R$),
// quando demandas.porRegistroEventos existe
// (Tarefa 2) e hojeEpoch é um número (dia-desde-época de "hoje", calculado
// pelo relógio de quem está vendo a página -- render-semanal.js calcula
// com diaEpoch(new Date(...)) a cada recálculo; esta função nunca chama
// new Date() internamente, fica pura e testável em Node com qualquer
// combinação).
//
// Duas coisas continuam válidas mesmo sem mês vigente válido (vigenteIdx
// fora de [0,11] -- ano inteiro no passado/futuro): a linha Demandas
// Pendentes ainda aparece (com as 4 semanas de fallback sem-dado, mas o
// fechamento mostra o saldo de hoje calculado direto) -- "quantas demandas
// estão pendentes agora" não depende de qual mês a tabela está exibindo.
function renderAbaSemanal(registros, indices, dimensoes, vigenteIdx, ano, realizado) {
  var opts = realizado || {};
  var mesValido = vigenteIdx >= 0 && vigenteIdx <= 11;
  var semanas = mesValido ? semanasDoMes(ano, vigenteIdx) : [];
  var numSemanas = mesValido ? semanas.length : 4;
  var temDemandas = !!(opts.demandas && opts.demandas.porRegistroEventos && typeof opts.hojeEpoch === 'number');
  var temSemanasReais = mesValido && temDemandas;
  var indiceAtual = temSemanasReais ? indiceSemanaAtual(semanas, opts.hojeEpoch) : -1;

  return dimensoes.map(function (dimensao) {
    var series = calcularSeriesSemanaisDimensao(
      registros, indices, dimensao, vigenteIdx, semanas, numSemanas, temSemanasReais, indiceAtual,
      opts.demandas, opts.hojeEpoch
    );
    var semanasSemDado = new Array(numSemanas).fill(null);
    var linhaPendentes = '';

    // Demandas Pendentes é estoque de FUROS -- não tem análogo em R$ que a
    // spec tenha pedido, fica exclusivo do Volume (e fora de
    // calcularSeriesSemanaisDimensao: a aba Gráficos, único outro
    // consumidor daquela função, não tem painel de estoque -- ver
    // render-aba-grafico-semanal.js).
    if (dimensao === 'volume' && temDemandas) {
      var semanasPendentes = temSemanasReais
        ? semanas.map(function (semana, i) {
            if (i === indiceAtual) return pendentesNaData(registros, indices, opts.demandas, opts.hojeEpoch);
            if (semana.fim < opts.hojeEpoch) return pendentesNaData(registros, indices, opts.demandas, semana.fim);
            return null; // semana futura -- sem-dado, não projeta estoque futuro
          })
        : semanasSemDado;
      // Fechamento SEMPRE o saldo de hoje, calculado direto e independente
      // da quebra semanal -- "quantas demandas estão pendentes agora" não
      // depende de qual das N semanas está em curso, nem de haver semana
      // válida nenhuma.
      var fechamentoPendentes = pendentesNaData(registros, indices, opts.demandas, opts.hojeEpoch);
      linhaPendentes = renderLinhaSerie('Demandas Pendentes', 'pendentes-demandas', semanasPendentes, fechamentoPendentes);
    }

    return '<div class="bloco-dimensao-semanal">'
      + '<div class="tabela-semanal-titulo">' + escapeHtml(DIMENSOES_ROTULO_SEMANAL[dimensao] || dimensao) + '</div>'
      + '<table class="tabela-semanal">'
      + renderCabecalho(dimensao, numSemanas, semanas)
      + '<tbody>'
      + renderLinhaSerie('Previsto', 'previsto', series.semanasPrevisto, series.fechamentoPrevisto)
      + renderLinhaSerie('Realizado', 'realizado', series.semanasRealizado, series.fechamentoRealizado)
      + renderLinhaSerie('Tendência', 'tendencia', series.semanasTendencia, series.fechamentoTendencia)
      + linhaPendentes
      + '</tbody></table></div>';
  }).join('');
}

module.exports = { renderAbaSemanal, rotuloColunaFechamento, calcularSeriesSemanaisDimensao, formatarIntervaloSemana };
