'use strict';
const { semanasDoMes, indiceSemanaAtual, dividirEmSemanasInteiras, fecharMes, diasNaSemana } = require('./compute-semanal.js');
const { calcularTendenciaSemanal } = require('./compute-tendencia-semanal.js');

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

// Média diária de equipes ATIVAS (headcount do roster, não atividade de
// campo) num intervalo [inicioEpoch, fimEpoch] (inclusive nos dois
// extremos) -- pra Realizado da dimensão Equipes na Tabela Semanal
// (2026-08-06). equipesAtivoPorDia (demandas.equipesAtivoPorDia) vem do
// "Ativas (total)" que o dashboard Matriz já publica (ver
// compute-equipes-ativo-matriz.js) -- um número da EMPRESA INTEIRA por dia,
// não por (SUP, tipologia), e por isso esta função NÃO recebe registros/
// indices: filtrar por SUP na barra de cima não muda esta linha, porque a
// fonte não é decomponível por contrato (é roster, não produção).
//
// Um dia SEM retrato (ninguém publicou historico.json aquele dia -- gap,
// não zero) fica de fora do denominador, ao contrário de outras médias
// deste arquivo: aqui ausência É ausência de medição, não "zero equipes"
// (a empresa não zera o quadro de um dia pro outro). Denominador só conta
// os dias com dado real.
//
// null quando não sobra nenhum dia com dado no intervalo -- "sem fonte
// ainda" é diferente de "zero equipes", e renderLinhaSerie já sabe desenhar
// null como sem-dado.
function mediaEquipesNoIntervalo(equipesAtivoPorDia, inicioEpoch, fimEpoch) {
  if (!equipesAtivoPorDia || fimEpoch < inicioEpoch) return null;
  var soma = 0;
  var diasComDado = 0;
  for (var dia = inicioEpoch; dia <= fimEpoch; dia++) {
    if (typeof equipesAtivoPorDia[dia] === 'number') { soma += equipesAtivoPorDia[dia]; diasComDado++; }
  }
  if (!diasComDado) return null;
  // Arredonda pra CIMA, nunca pro mais próximo (pedido do dono do projeto,
  // 2026-08-06): a média diária quase sempre sai quebrada (85+85+83+.../N), e
  // pra "quantas equipes trabalharam" a leitura conservadora é a de cima --
  // 83,75 nunca é lido como "83 equipes e um pouco", é "84 no pior dia".
  return Math.ceil(soma / diasComDado);
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

// Financeiro em milhares, sem sufixo (pedido do dono do projeto, 2026-08-07,
// substitui os milhões com "M" de 2026-08-06 -- exemplo confirmado antes de
// implementar: R$ 12.345.648 -> "12.345"). Math.floor, não Math.round: é o
// que faz R$ 12.345.648 (12345,648 milhares) virar "12.345" e não "12.346" --
// o exemplo dado pelo dono do projeto só bate com truncamento.
function formatarFinanceiroMilhares(v) {
  if (v === null || v === undefined) return '—';
  return formatarNumero(Math.floor(v / 1000), 0);
}

// 'semanas' são os N valores por semana (ou null); 'fechamento' é o valor já
// fechado (fecharMes) pra a coluna final. null em qualquer um vira a classe
// sem-dado. 'casasOuFormatador' (opcional, padrão 2 casas) aceita ou um
// número de casas decimais (via formatarNumero) ou uma função v => string
// pronta -- usada pelo Financeiro pra plugar formatarFinanceiroMilhares sem
// essa linha genérica precisar conhecer a regra dos milhares.
function renderLinhaSerie(rotulo, classeSerie, semanas, fechamento, casasOuFormatador) {
  var formatar = typeof casasOuFormatador === 'function'
    ? casasOuFormatador
    : function (v) { return formatarNumero(v, casasOuFormatador); };
  var celulasSemana = semanas.map(function (v) {
    if (v === null || v === undefined) return '<td class="num sem-dado"></td>';
    return '<td class="num">' + formatar(v) + '</td>';
  }).join('');
  var celulaFechamento = (fechamento === null || fechamento === undefined)
    ? '<td class="num celula-total-linha sem-dado"></td>'
    : '<td class="num celula-total-linha">' + formatar(fechamento) + '</td>';
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
  // INTEIRAS desde 2026-08-03 (pedido do dono do projeto): a soma das semanas
  // é exatamente Math.floor(mesVigente) -- nunca supera o total do mês, e o
  // Fechamento abaixo passa a ser essa soma, então a linha fecha na conta que
  // está na tela. Ver dividirEmSemanasInteiras em compute-semanal.js.
  var semanasPrevisto = dividirEmSemanasInteiras(mesVigente, dimensao, numSemanas, semanas);
  var fechamentoPrevisto = fecharMes(semanasPrevisto, dimensao);
  var semanasSemDado = new Array(numSemanas).fill(null);

  var semanasRealizado = semanasSemDado;
  var fechamentoRealizado = null;
  var semanasTendencia = semanasSemDado;
  var fechamentoTendencia = null;
  // Versão SEM a supressão de semanas elapsadas -- só existe pra alimentar
  // o Acumulado da aba Gráficos (ver render-aba-grafico-semanal.js), que
  // precisa somar a partir do que já foi realizado, não recomeçar do zero
  // na primeira semana futura (achado da revisão final: sem isso, o ponto
  // final da curva Acumulada de Tendência divergia do Fechamento da
  // Tabela Semanal, que É calculado a partir desta versão completa).
  var semanasTendenciaCompleta = semanasSemDado;
  // Quantas semanas do mês já começaram (fechadas + a em curso). Sai daqui
  // pra fora porque o painel Acumulado da aba Gráficos recorta as duas curvas
  // por ELE, e não olhando os valores -- ver cortarAcumuladoNasElapsadas em
  // compute-grafico-semanal.js. Fica 0 quando não há Realizado nenhum
  // (dimensão Equipes, mês inválido, sem demandas), que é exatamente o que o
  // recorte espera nesse caso: nada a mostrar de Realizado.
  var semanasElapsadas = 0;
  var ramoTendencia = 'sem-dado';
  var diagnosticoTendencia = null;

  // Realizado/Tendência: Volume conta furos reais; Financeiro pega o MESMO
  // furo real e multiplica pelo ticket médio do registro dono daquele furo
  // antes de somar (pesoPorRegistro) -- é o "acompanhamento do produzido"
  // em R$, na mesma lógica semanal do Volume, sem precisar de outra fonte
  // de dado (o ticket já vem na MATRIZ, junto do resto do registro).
  // Equipes NUNCA tem Tendência (não é fluxo de furo pra projetar -- ver
  // compute-semanal.js), mas ganhou Realizado em 2026-08-06 -- ver o bloco
  // dedicado logo abaixo, fora deste if (a fonte e o cálculo são outros).
  if ((dimensao === 'volume' || dimensao === 'financeiro') && temSemanasReais) {
    var pesoPorRegistro = dimensao === 'financeiro' ? ticketMedio : null;

    semanasRealizado = semanas.map(function (semana, i) {
      if (i === indiceAtual) return contarEventosNoIntervalo(registros, indices, demandas, 'sondagemRealizada', semana.inicio, hojeEpoch, pesoPorRegistro);
      if (semana.fim < hojeEpoch) return contarEventosNoIntervalo(registros, indices, demandas, 'sondagemRealizada', semana.inicio, semana.fim, pesoPorRegistro);
      return 0; // semana futura -- nada aconteceu ainda
    });
    fechamentoRealizado = fecharMes(semanasRealizado, dimensao);

    // Contagem direta pelas DATAS, e não a partir de indiceAtual: são duas
    // perguntas diferentes. indiceAtual é a semana EM CURSO (uma só, e -1
    // quando o mês inteiro está no futuro ou no passado); aqui queremos
    // quantas semanas já COMEÇARAM, que é fechadas + a em curso -- e no mês
    // inteiramente passado isso tem de dar o total das semanas, não 0. Somar
    // 1 a indiceAtual acertaria só o mês corrente e mentiria nos outros dois.
    for (var se = 0; se < semanas.length; se++) {
      if (semanas[se].inicio <= hojeEpoch) semanasElapsadas++;
    }
    // A projeção e o ramo saem da MESMA chamada -- ver
    // tools/semanal/compute-tendencia-semanal.js. 'ramo' e 'diagnostico'
    // sobem no retorno porque a aba Alertas monta os dois alertas novos em
    // cima deles, e recalcular a comparação lá deixaria as duas telas
    // discordarem sobre em que ramo o grupo caiu.
    var tendencia = calcularTendenciaSemanal({
      previstoMes: mesVigente,
      semanasPrevisto: semanasPrevisto,
      semanasRealizado: semanasRealizado,
      semanas: semanas,
      hojeEpoch: hojeEpoch,
    });
    ramoTendencia = tendencia.ramo;
    diagnosticoTendencia = tendencia.diagnostico;
    semanasTendenciaCompleta = tendencia.semanas;
    // 'sem-dado' é o mês inteiramente no passado (regra 2.1): a série já vem
    // toda nula, e o fechamento tem de acompanhar -- fecharMes devolveria
    // null sozinho, mas deixar explícito impede que uma mudança futura em
    // fecharMes ressuscite o número que este pedido veio eliminar.
    fechamentoTendencia = tendencia.ramo === 'sem-dado' ? null : fecharMes(semanasTendenciaCompleta, dimensao);

    // A fronteira das semanas fechadas sai do DIAGNÓSTICO, não de um laço
    // próprio: recalculá-la aqui criaria duas definições da mesma fronteira,
    // que passariam a divergir em silêncio se a projeção mudasse de critério.
    // No ramo 'sem-dado' o diagnóstico é null -- e ali não há fronteira a
    // aplicar, porque a série já vem toda nula.
    semanasTendencia = tendencia.ramo === 'sem-dado'
      ? semanasTendenciaCompleta
      : semanasTendenciaCompleta.map(function (v, i) {
        return i < tendencia.diagnostico.semanasFechadas ? null : v;
      });
  }

  // Realizado de Equipes (2026-08-06, pedido do dono do projeto -- calibrado
  // contra historico.xlsx do Matriz depois de uma primeira versão errada):
  // média diária de equipesAtivoPorDia (o "Ativas total" que o dashboard
  // Matriz já publica, ver compute-equipes-ativo-matriz.js) em cada semana
  // -- é FOTO de roster, não fluxo, por isso média e não soma (mesma
  // convenção de Previsto, dividirEmSemanas). Número da EMPRESA INTEIRA,
  // não decomponível por SUP -- não usa 'registros'/'indices' de propósito.
  // A janela corta em hojeEpoch, igual ao Δ equipes do Balanço (compute-
  // balanco.js): sem isso, a semana em curso diluiria a média com dias que
  // ainda não aconteceram, e uma semana inteiramente futura mostraria uma
  // "média" de puro zero em vez de sem-dado. Fechamento usa fecharMes, que
  // já sabe fazer MÉDIA das semanas (não soma) quando dimensao === 'equipes'
  // -- mesmo tratamento que a linha Previsto já recebe.
  if (dimensao === 'equipes' && temSemanasReais) {
    semanasRealizado = semanas.map(function (semana) {
      if (semana.inicio > hojeEpoch) return null; // semana futura -- nada aconteceu ainda
      var fim = Math.min(semana.fim, hojeEpoch);
      return mediaEquipesNoIntervalo(demandas.equipesAtivoPorDia, semana.inicio, fim);
    });
    fechamentoRealizado = fecharMes(semanasRealizado, dimensao);
  }

  return {
    mesVigente: mesVigente,
    semanasPrevisto: semanasPrevisto, fechamentoPrevisto: fechamentoPrevisto,
    semanasRealizado: semanasRealizado, fechamentoRealizado: fechamentoRealizado,
    semanasTendencia: semanasTendencia, fechamentoTendencia: fechamentoTendencia,
    semanasTendenciaCompleta: semanasTendenciaCompleta,
    semanasElapsadas: semanasElapsadas,
    ramoTendencia: ramoTendencia,
    diagnosticoTendencia: diagnosticoTendencia,
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
      // Cada semana mostra o saldo pendente apurado no seu PRIMEIRO dia, e
      // esse valor fica fixo dali em diante -- não é o saldo de hoje
      // recalculado, nem o saldo do domingo de fechamento (dono do projeto,
      // 2026-08-06). Ao começar a próxima semana, ela ganha o próprio
      // instantâneo no início dela; a semana anterior não muda mais. Semana
      // que ainda não começou (início no futuro) não tem instantâneo ainda
      // -- sem-dado, não projeta estoque futuro.
      var semanasPendentes = temSemanasReais
        ? semanas.map(function (semana) {
            if (semana.inicio > opts.hojeEpoch) return null;
            return pendentesNaData(registros, indices, opts.demandas, semana.inicio);
          })
        : semanasSemDado;
      // Fechamento SEMPRE o saldo de hoje, calculado direto e independente
      // da quebra semanal -- "quantas demandas estão pendentes agora" não
      // depende de qual das N semanas está em curso, nem de haver semana
      // válida nenhuma. Diferente das células por semana (instantâneo fixo
      // no início): o fechamento é sempre o saldo AO VIVO.
      var fechamentoPendentes = pendentesNaData(registros, indices, opts.demandas, opts.hojeEpoch);
      // Estoque de FUROS -- já é inteiro por natureza (não existe 0,5 furo);
      // 0 casas aqui só remove o ",00" decorativo que formatarNumero adiciona
      // por padrão.
      linhaPendentes = renderLinhaSerie('Demandas Pendentes', 'pendentes-demandas', semanasPendentes, fechamentoPendentes, 0);
    }

    // Sufixo "(mil R$)" só em Financeiro (2026-08-07, pedido do dono do
    // projeto): sem ele, uma célula de Financeiro ("123") e uma de Volume
    // ("123") pareceriam a mesma grandeza -- Financeiro é a única dimensão
    // em escala diferente da exibida (ver formatarFinanceiroMilhares).
    var tituloDimensao = DIMENSOES_ROTULO_SEMANAL[dimensao] || dimensao;
    if (dimensao === 'financeiro') tituloDimensao += ' (mil R$)';
    return '<div class="bloco-dimensao-semanal">'
      + '<div class="tabela-semanal-titulo">' + escapeHtml(tituloDimensao) + '</div>'
      + '<table class="tabela-semanal">'
      + renderCabecalho(dimensao, numSemanas, semanas)
      + '<tbody>'
      // Sem casa decimal em Equipes/Volume (pedido do dono do projeto,
      // 2026-08-06, substitui a regra anterior que mantinha as duas com 2
      // casas). formatarNumero(v, 0) já agrupa milhar em pt-BR via
      // toLocaleString ("4.415"). Equipes Realizado chega já inteiro de
      // mediaEquipesNoIntervalo (Math.ceil embutido ali); os outros valores
      // fracionários (Tendência de Volume, médias) são só arredondados pro
      // inteiro mais próximo aqui, não pra cima.
      // Financeiro usa formatarFinanceiroMilhares em vez de casas fixas --
      // mesmo pedido, mas em milhares ("12.345"), sem sufixo, truncado.
      + renderLinhaSerie('Previsto', 'previsto', series.semanasPrevisto, series.fechamentoPrevisto, dimensao === 'financeiro' ? formatarFinanceiroMilhares : 0)
      + renderLinhaSerie('Realizado', 'realizado', series.semanasRealizado, series.fechamentoRealizado, dimensao === 'financeiro' ? formatarFinanceiroMilhares : 0)
      + renderLinhaSerie('Tendência', 'tendencia', series.semanasTendencia, series.fechamentoTendencia, dimensao === 'financeiro' ? formatarFinanceiroMilhares : 0)
      + linhaPendentes
      + '</tbody></table></div>';
  }).join('');
}

module.exports = {
  renderAbaSemanal, rotuloColunaFechamento, calcularSeriesSemanaisDimensao, formatarIntervaloSemana, pendentesNaData,
  formatarFinanceiroMilhares,
};
