'use strict';
const { semanasDoMes, indiceSemanaAtual, dividirEmSemanasInteiras, dividirEmSemanas, fecharMes, diasNaSemana } = require('./compute-semanal.js');
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

// Soma, através dos registros em 'indices', um campo do mês vigente numa
// dimensão -- mesma soma-através-de-registros que somarArraysMensais faz no
// orçamento (tools/orcamento/render-dashboard.js), inclusive pra 'equipes':
// somar equipes de CONTRATOS DIFERENTES no mesmo mês é válido (times
// simultâneos se somam); o que NÃO se soma é equipes ao longo do TEMPO
// (semanas), que é o que dividirEmSemanas/fecharMes tratam à parte. null só
// quando NENHUM registro contribuinte tem valor no mês vigente -- inclusive
// quando vigenteIdx está fora de [0,11] (mensal[vigenteIdx] é undefined).
// 'campo' ('previsto' ou 'total') escolhe QUAL linha física da MATRIZ somar
// -- 'total' é a linha BASE=T ("Total"), a mesma que o dashboard de
// Orçamento já lê como Tendência (SERIE_LABELS, render-dashboard.js).
function somaMesVigente(registros, indices, campo, dimensao, vigenteIdx) {
  var soma = null;
  (indices || []).forEach(function (i) {
    var registro = registros[i];
    var serie = registro && registro[campo];
    var mensal = serie && serie[dimensao];
    if (!Array.isArray(mensal)) return;
    var v = mensal[vigenteIdx];
    if (v === null || v === undefined) return;
    soma = (soma === null ? 0 : soma) + v;
  });
  return soma;
}
function previstoMesVigente(registros, indices, dimensao, vigenteIdx) {
  return somaMesVigente(registros, indices, 'previsto', dimensao, vigenteIdx);
}

// Mesma expressão de chaveMatriz (tools/comum/linha-base.js) -- duplicada de
// propósito porque este módulo entra no bundle do navegador
// (as dependências externas são removidas, não reescritas -- mesmo
// motivo já documentado em chaveBaseline, tools/semanal/compute-balanco.js).
function chaveDemandas(sup, tipologia) {
  return sup + '||' + tipologia;
}

// A UNIDADE DE PROJEÇÃO da Tendência: (SUP, grupo de tipologia).
//
// É a MESMA célula que a aba Alocação usa (indicesPorCelula, compute-alocacao.js
// -> COLUNAS_ALOCACAO), e é de propósito: as duas abas projetam nas mesmas
// unidades, então o total de uma é a soma das células da outra por construção.
//
// Os grupos NÃO são as 10 tipologias cruas -- 'Especiais' junta CPTu+SH+VT numa
// unidade só. Dividir mais do que isso decompõe demais e infla o total (cada
// pedaço escolhe o próprio ramo): medido no SUP 7133-24, por tipologia crua dava
// 210 contra os 165 da Alocação.
//
// A tabela está DUPLICADA aqui, e não importada de equipes-alocaveis.js, por
// causa da ordem de BUNDLE_ARQUIVOS: este módulo entra na posição 711 e
// equipes-alocaveis.js na 776, então o require leria undefined no navegador.
// test/semanal-render-aba-semanal.test.js trava as duas juntas -- se
// COLUNAS_ALOCACAO mudar e esta não, o teste quebra.
var GRUPOS_TIPOLOGIA_TENDENCIA = [
  { id: 'SP', tipologias: ['SP'] },
  { id: 'SM / SM.F / SR', tipologias: ['SM / SM.F / SR'] },
  { id: 'ST', tipologias: ['ST'] },
  { id: 'PI', tipologias: ['PI'] },
  { id: 'BL', tipologias: ['BL'] },
  { id: 'Especiais', tipologias: ['CPTu', 'SH', 'VT'] },
];

function chaveUnidadeTendencia(registro) {
  for (var i = 0; i < GRUPOS_TIPOLOGIA_TENDENCIA.length; i++) {
    if (GRUPOS_TIPOLOGIA_TENDENCIA[i].tipologias.indexOf(registro.tipologia) !== -1) {
      return registro.sup + '||' + GRUPOS_TIPOLOGIA_TENDENCIA[i].id;
    }
  }
  // Tipologia fora dos grupos (LAB.C/LAB.E): unidade própria, pelo nome cru.
  return registro.sup + '||' + registro.tipologia;
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

// Substitui a antiga mediaEquipesNoIntervalo (achado do dono do projeto, 2026-08-08:
// "troquei o ID Contrato no filtro e o Realizado de Equipes não mudou" --
// era o número FIXO da empresa inteira, igual em toda linha, porque
// equipesAtivoPorDia nunca olhava pra 'registros'/'indices'). Agora soma,
// dia a dia, demandas.equipesPorDia[chaveDemandas(sup,tipologia)] através dos
// registros em 'indices' -- MESMO raciocínio de somaMesVigente (linha 42-43
// acima): equipes de contratos DIFERENTES no mesmo dia se somam (times
// simultâneos), só não se soma equipes ao longo do TEMPO -- por isso soma por
// dia, depois MÉDIA sobre os dias da janela (é foto, não flui).
//
// Não precisa checar "cobertura do mês" explicitamente (ao contrário de
// foraDaCoberturaDeEquipes em compute-balanco.js): um dia fora do que
// equipesPorDia cobre simplesmente não tem chave nenhuma no mapa pra nenhum
// registro, então 'achouAlgumaChave' fica false e a função devolve null
// (sem dado) sozinha -- diaEpoch é uma contagem absoluta de dias, nunca
// colide entre meses diferentes.
// Dias da semana [inicioEpoch, fimEpoch] que NÃO são domingo -- domingo sai
// da conta (2026-08-10, decisão do dono do projeto: semana cheia = segunda
// a sábado, 6 dias). Se o recorte cair inteiro num domingo (acontece na
// borda do mês, quando a "semana" do calendário real tem só esse dia),
// esse domingo é contado sozinho em vez de dar denominador zero.
function diasUteisNoIntervalo(inicioEpoch, fimEpoch) {
  var dias = 0;
  var apenasDomingo = 0;
  for (var dia = inicioEpoch; dia <= fimEpoch; dia++) {
    var diaSemana = new Date(dia * 86400000).getUTCDay(); // 0 = domingo
    if (diaSemana === 0) { apenasDomingo++; continue; }
    dias++;
  }
  return dias > 0 ? dias : apenasDomingo;
}

function somarEquipesNoIntervalo(registros, indices, demandas, inicioEpoch, fimEpoch) {
  var equipesPorDia = demandas && demandas.equipesPorDia;
  if (!equipesPorDia || fimEpoch < inicioEpoch) return null;
  var totalDias = diasUteisNoIntervalo(inicioEpoch, fimEpoch);
  var somaTotal = 0;
  var achouAlgumaChave = false;
  for (var dia = inicioEpoch; dia <= fimEpoch; dia++) {
    if (new Date(dia * 86400000).getUTCDay() === 0 && totalDias > 0 && fimEpoch > inicioEpoch) continue; // domingo não soma quando há outro dia na semana
    (indices || []).forEach(function (i) {
      var registro = registros[i];
      if (!registro) return;
      var porDiaRegistro = equipesPorDia[chaveDemandas(registro.sup, registro.tipologia)];
      if (porDiaRegistro && typeof porDiaRegistro[dia] === 'number') {
        somaTotal += porDiaRegistro[dia];
        achouAlgumaChave = true;
      }
    });
  }
  if (!achouAlgumaChave) return null;
  // Mesmo arredondamento conservador de mediaEquipesNoIntervalo acima.
  return Math.ceil(somaTotal / totalDias);
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
// 'mesAtualReal' (opcional, último parâmetro): o índice do mês REAL de hoje
// (0-11), distinto de 'vigenteIdx' -- que aqui é o mês SELECIONADO na barra,
// podendo ser qualquer mês do ano. Só quem precisa distinguir "mês
// selecionado é um mês JÁ FECHADO" o passa (ver Financeiro/Realizado
// abaixo); Consolidado e Alertas não passam, e o comportamento pra eles
// fica idêntico ao de antes (undefined nunca é < vigenteIdx).
function calcularSeriesSemanaisDimensao(registros, indices, dimensao, vigenteIdx, semanas, numSemanas, temSemanasReais, indiceAtual, demandas, hojeEpoch, mesAtualReal, opcoesInternas) {
  // O REALIZADO para em d-1, nunca em hoje -- regra do dono do projeto,
  // 2026-08-10 ("realizado sempre considerar até o dia anterior ao atual").
  // O dia corrente está incompleto por construção: o extrato do sond.com.br
  // é alimentado ao longo do dia, então contá-lo faz a semana em curso
  // parecer em queda até virar a meia-noite, e faz a Tendência escolher o
  // ramo "R < P" por um déficit que é só do relógio.
  //
  // Só o Realizado usa este corte. 'hojeEpoch' continua sendo HOJE para todo
  // o resto -- qual é a semana em curso, o saldo de Demandas Pendentes, o
  // congelamento do Consolidado -- porque essas perguntas são sobre o
  // calendário, não sobre dado que ainda vai chegar.
  var realizadoAteEpoch = hojeEpoch - 1;
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

    // Financeiro num mês JÁ FECHADO (2026-08-10, pedido do dono do projeto):
    // não conta mais eventos do Avanço Sond -- usa o valor de
    // 'realizado.financeiro' da própria MATRIZ, repartido PROPORCIONALMENTE
    // entre as semanas (dividirEmSemanas, fracionária -- a mesma que
    // baseNasSemanas/Tendência já usam, não a "inteira" de Previsto).
    // Confirmado com exemplo: julho/2026 a página mostrava 9.832 (furos x
    // ticket médio) contra 9.408 na MATRIZ -- o 9.408 é o valor certo.
    // Só Financeiro: Volume continua contando furos reais em qualquer mês,
    // porque não há "valor mensal único" comparável pra ele na MATRIZ (furo
    // é grandeza discreta, R$ é agregado). Só quando mesAtualReal é
    // conhecido E o mês selecionado vem ANTES dele -- no mês vigente e em
    // qualquer mês futuro (sem dado mesmo) segue o cálculo de sempre.
    var mesFechado = dimensao === 'financeiro' && typeof mesAtualReal === 'number' && vigenteIdx < mesAtualReal;
    if (mesFechado) {
      var realizadoMatriz = somaMesVigente(registros, indices, 'realizado', dimensao, vigenteIdx);
      semanasRealizado = dividirEmSemanas(realizadoMatriz, dimensao, numSemanas, semanas);
    } else {
      semanasRealizado = semanas.map(function (semana, i) {
        // Semana em curso: conta só até d-1. Se a semana começou HOJE,
        // realizadoAteEpoch < semana.inicio e o intervalo fica vazio -- 0, que
        // é a resposta certa (ainda não há dia fechado nesta semana).
        if (i === indiceAtual) return contarEventosNoIntervalo(registros, indices, demandas, 'sondagemRealizada', semana.inicio, realizadoAteEpoch, pesoPorRegistro);
        // Semana já encerrada: o intervalo inteiro dela já é <= d-1.
        if (semana.fim < hojeEpoch) return contarEventosNoIntervalo(registros, indices, demandas, 'sondagemRealizada', semana.inicio, semana.fim, pesoPorRegistro);
        return 0; // semana futura -- nada aconteceu ainda
      });
    }
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

  // Realizado de Equipes: soma demandas.equipesPorDia POR SUP através de
  // 'indices' (ver somarEquipesNoIntervalo acima) -- decomponível por SUP
  // desde 2026-08-08, quando o link Equipes ganhou a fonte fracionada
  // (Link 6 + 7). Substitui a versão de 2026-08-06 (equipesAtivoPorDia, um
  // número FIXO da empresa inteira, igual em toda linha -- era o motivo de
  // "filtrei por ID Contrato e o número não mudou", achado ao vivo pelo dono
  // do projeto). É FOTO de roster, não fluxo -- por isso média e não soma
  // sobre os dias (mesma convenção de Previsto, dividirEmSemanas). A janela
  // corta em hojeEpoch, igual ao Δ equipes do Balanço (compute-balanco.js):
  // sem isso, a semana em curso diluiria a média com dias que ainda não
  // aconteceram, e uma semana inteiramente futura mostraria uma "média" de
  // puro zero em vez de sem-dado. Fechamento usa fecharMes, que já sabe
  // fazer MÉDIA das semanas (não soma) quando dimensao === 'equipes' --
  // mesmo tratamento que a linha Previsto já recebe.
  if (dimensao === 'equipes' && temSemanasReais) {
    semanasRealizado = semanas.map(function (semana) {
      // Mesmo corte em d-1 do Realizado de Volume/Financeiro acima: o dia
      // corrente ainda está sendo alimentado no Link 7, e incluí-lo dilui a
      // média com um dia parcial.
      if (semana.inicio > realizadoAteEpoch) return null; // semana futura, ou começou hoje
      var fim = Math.min(semana.fim, realizadoAteEpoch);
      return somarEquipesNoIntervalo(registros, indices, demandas, semana.inicio, fim);
    });
    fechamentoRealizado = fecharMes(semanasRealizado, dimensao);

    // Tendência de Equipes (2026-08-07, pedido do dono do projeto): não vem
    // de ritmo de furos como Volume/Financeiro (Equipes é foto, não fluxo --
    // não há ritmo pra projetar). Vem direto da própria MATRIZ, linha
    // BASE=T ("Total") -- a MESMA fonte que o dashboard de Orçamento já usa
    // como Tendência de Equipes (SERIE_LABELS: total -> 'Tendência',
    // tools/orcamento/render-dashboard.js). dividirEmSemanasInteiras com
    // dimensao='equipes' só REPETE o valor do mês em cada semana (é foto,
    // não se reparte por dia) -- mesmo tratamento que a linha Previsto já
    // recebe duas linhas acima.
    var tendenciaMesVigente = somaMesVigente(registros, indices, 'total', dimensao, vigenteIdx);
    var semanasTendenciaEquipes = dividirEmSemanasInteiras(tendenciaMesVigente, dimensao, numSemanas, semanas);
    semanasTendenciaCompleta = semanasTendenciaEquipes;
    // Some nas semanas já ENCERRADAS (2026-08-10, pedido do dono do projeto):
    // "buscar o que está na planilha, porém nas semanas que já estão
    // finalizadas, esse valor deve desaparecer". Diferente de Volume/
    // Financeiro, onde a Tendência é projeção mesmo no passado -- aqui é
    // premissa/plano do mês, e uma vez que a semana fechou não faz sentido
    // mostrar "quanto se planejava" ao lado do Realizado medido daquela
    // mesma semana. Só a EXIBIÇÃO muda: semanasTendenciaCompleta continua
    // com o valor repetido em toda semana, para quem precisar do mês
    // inteiro (ex. o Gráfico não usa Completa para Equipes hoje, mas o
    // Consolidado coage Equipes pra Volume antes de chegar aqui).
    semanasTendencia = semanasTendenciaEquipes.map(function (v, i) {
      return semanas[i].fim < hojeEpoch ? null : v;
    });
    fechamentoTendencia = fecharMes(semanasTendencia, dimensao);
  }

  // A TENDÊNCIA DE UM GRUPO É A SOMA DAS TIPOLOGIAS (2026-08-11).
  //
  // escolherRamo (compute-tendencia-semanal.js) decide UM ramo por chamada --
  // 'acima', 'abaixo' ou 'igual' -- comparando realizado e previsto acumulados.
  // Isso torna a projeção NÃO-LINEAR: com duas tipologias em ramos opostos, a
  // projeção do agregado não é a soma das projeções. Relatado pelo dono do
  // projeto: filtrando duas tipologias juntas o total dava 121, e somando uma a
  // uma dava 165. Medido numa reprodução: SP sozinho 100,0 (ramo 'acima') e
  // CPTu sozinho 41,6 (ramo 'abaixo') somam 141,6, contra 106,4 do agregado.
  //
  // O ramo codifica realidade FÍSICA por tipologia -- uma rodando acima do
  // plano tem ritmo, outra abaixo tem represamento. Um ramo só para as duas
  // produz um número que não descreve nenhuma delas. Decisão do dono do
  // projeto: somar por tipologia. É também o que a aba Alocação sempre fez
  // (ela calcula célula a célula, SUP × tipologia), e era essa a origem da
  // divergência entre as duas abas.
  //
  // SÓ A TENDÊNCIA muda. Previsto continua agregado de propósito:
  // dividirEmSemanasInteiras também é não-linear (maior resto com Math.floor
  // por chamada), e reparti-lo por tipologia mudaria um número que ninguém
  // pediu -- o CLAUDE.md documenta esse arredondamento como deliberado.
  // Realizado é linear (contagem de eventos), então tanto faz.
  //
  // ramoTendencia/diagnosticoTendencia continuam vindo do AGREGADO, intactos:
  // quem os consome é a aba Alertas, que pergunta sobre o GRUPO ("este SUP está
  // acima ou abaixo do plano?"), não sobre cada tipologia. Mexer neles mudaria
  // em silêncio quais alertas disparam.
  //
  // opcoesInternas.umaTipologia é a guarda de recursão.
  if (!opcoesInternas || !opcoesInternas.umaTipologia) {
    var porUnidade = {};
    (indices || []).forEach(function (i) {
      var reg = registros[i];
      if (!reg) return;
      var chave = chaveUnidadeTendencia(reg);
      if (!porUnidade[chave]) porUnidade[chave] = [];
      porUnidade[chave].push(i);
    });
    var unidades = Object.keys(porUnidade);
    if (unidades.length > 1) {
      var somaSemanas = new Array(numSemanas).fill(null);
      var somaCompleta = new Array(numSemanas).fill(null);
      var somaFechamento = null;
      unidades.forEach(function (t) {
        var parcial = calcularSeriesSemanaisDimensao(
          registros, porUnidade[t], dimensao, vigenteIdx, semanas, numSemanas,
          temSemanasReais, indiceAtual, demandas, hojeEpoch, mesAtualReal,
          { umaTipologia: true }
        );
        for (var k = 0; k < numSemanas; k++) {
          var a = parcial.semanasTendencia[k];
          if (a !== null && a !== undefined) somaSemanas[k] = (somaSemanas[k] || 0) + a;
          var c = parcial.semanasTendenciaCompleta[k];
          if (c !== null && c !== undefined) somaCompleta[k] = (somaCompleta[k] || 0) + c;
        }
        if (parcial.fechamentoTendencia !== null && parcial.fechamentoTendencia !== undefined) {
          somaFechamento = (somaFechamento || 0) + parcial.fechamentoTendencia;
        }
      });
      semanasTendencia = somaSemanas;
      semanasTendenciaCompleta = somaCompleta;
      fechamentoTendencia = somaFechamento;
    }
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
  // O mês REAL de hoje (0-11), pra distinguir do 'vigenteIdx' que aqui é o
  // mês SELECIONADO na barra -- ver o comentário em
  // calcularSeriesSemanaisDimensao. -1/12 (ano inteiro no futuro/passado)
  // nunca é > nem < um vigenteIdx válido no jeito que precisamos, então usar
  // undefined nesses casos é seguro: mesFechado exige typeof === 'number'.
  var mesAtualReal;
  if (typeof opts.hojeEpoch === 'number') {
    var hojeData = new Date(opts.hojeEpoch * 86400000);
    if (hojeData.getUTCFullYear() === ano) mesAtualReal = hojeData.getUTCMonth();
  }

  return dimensoes.map(function (dimensao) {
    var series = calcularSeriesSemanaisDimensao(
      registros, indices, dimensao, vigenteIdx, semanas, numSemanas, temSemanasReais, indiceAtual,
      opts.demandas, opts.hojeEpoch, mesAtualReal
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
      // somarEquipesNoIntervalo (Math.ceil embutido ali); os outros valores
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
  GRUPOS_TIPOLOGIA_TENDENCIA, chaveUnidadeTendencia,
  renderAbaSemanal, rotuloColunaFechamento, calcularSeriesSemanaisDimensao, formatarIntervaloSemana, pendentesNaData,
  formatarFinanceiroMilhares,
};
