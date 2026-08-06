'use strict';
const { ORDEM_TIPOLOGIAS, SO_QUANDO_ACIONADA } = require('../comum/tipologias-avancos.js');
const { chaveMatriz } = require('../comum/linha-base.js');
const { diaEpoch } = require('./compute-semanal.js');

// Agrega os furos de parse-avancos.js em (tipologia, mês) x 5 séries, em
// QUANTIDADE DE FUROS. Roda no BUILD, em Node -- o navegador recebe só o
// agregado, já dentro do blob cifrado (ver render-semanal.js). O require
// '../comum/linha-base.js' acima passa a viajar dentro do bundle a partir
// da Task 8 -- ver docs/superpowers/plans/2026-07-31-semanal-atualizar-dados.md
// e docs/superpowers/specs/2026-07-31-semanal-atualizar-dados-design.md.
//
// As 4 primeiras séries são FLUXOS (eventos datados, acumulam por soma
// corrida). 'pendentes' é ESTOQUE: o saldo aberto no fim de cada mês. Somar
// saldos de meses diferentes daria um número crescente e sem significado --
// mesma armadilha que mediaEquipesPonderada (tools/comum/calculo-equipes.js)
// e dividirEmSemanas (./compute-semanal.js) já documentam para equipes. Quem
// acumula é render-aba-demandas.js, e ele respeita SERIE_ESTOQUE.

const SERIES = ['chegadas', 'sondagemRealizada', 'relatorioConcluido', 'canceladas', 'pendentes'];
const SERIE_ESTOQUE = 'pendentes';

const STATUS_REALIZADO = ['CONCLUIDO', 'EXECUTADO'];

function zeros12(quantidade) {
  return new Array(quantidade).fill(0);
}

// Índice do mês (0-11) dentro de periodos, ou -1 se a data está fora do ano
// da planilha. Compara ano+mês, não intervalo, porque periodos é sempre
// Jan..Dez de um único ano (mesma garantia que o resto do projeto assume --
// ver calcularVigenteIdx em tools/comum/datas.js).
function indiceDoMes(data, periodos) {
  if (!data) return -1;
  for (let i = 0; i < periodos.length; i++) {
    if (periodos[i].getUTCFullYear() === data.getUTCFullYear()
      && periodos[i].getUTCMonth() === data.getUTCMonth()) return i;
  }
  return -1;
}

// Último instante do mês de um período. Date.UTC(ano, mes + 1, 0) é o último
// dia do mês 'mes' -- a virada de mês do próprio Date, sem tabela de dias.
function fimDoMes(periodo) {
  return new Date(Date.UTC(periodo.getUTCFullYear(), periodo.getUTCMonth() + 1, 0, 23, 59, 59));
}

function serieVazia(quantidade) {
  const series = {};
  for (const nome of SERIES) series[nome] = zeros12(quantidade);
  return series;
}

// Eventos brutos por (sup, tipologia), em dias-desde-época (diaEpoch) --
// substitui, de propósito, um valor pré-somado por mês: a Tabela semanal
// (Tarefa 3 do plano do calendário ISO) precisa recortar Realizado/
// Pendentes por semana real, inclusive "até hoje" na semana em curso, algo
// que uma granularidade fixa (mês ou semana) não serve -- ver
// docs/superpowers/specs/2026-07-30-semanal-calendario-iso-design.md,
// seção "Fonte de dados".
function entradaEventosVazia() {
  return { chegada: [], sondagemRealizada: [], saidaEstoque: [] };
}

function computeDemandas(furos, periodos, ensaiosLab) {
  const n = periodos.length;
  const fins = periodos.map(fimDoMes);
  const porTipologia = new Map();
  for (const rotulo of ORDEM_TIPOLOGIAS) porTipologia.set(rotulo, serieVazia(n));
  const porRegistroEventos = new Map();

  for (const f of furos || []) {
    // Tipologia fora de ORDEM_TIPOLOGIAS não deveria existir (rotularTipologia
    // já lançou em parse-avancos.js), mas se existir é melhor aparecer do que
    // sumir: cria o bucket na hora, no fim da ordem.
    if (!porTipologia.has(f.tipologia)) porTipologia.set(f.tipologia, serieVazia(n));
    const series = porTipologia.get(f.tipologia);
    const cancelado = f.status === 'CANCELADO';

    const chaveRegistro = chaveMatriz(f.sup, f.tipologia);

    if (!porRegistroEventos.has(chaveRegistro)) porRegistroEventos.set(chaveRegistro, entradaEventosVazia());
    const eventosRegistro = porRegistroEventos.get(chaveRegistro);

    if (f.criacaoOS) eventosRegistro.chegada.push(diaEpoch(f.criacaoOS));

    if (STATUS_REALIZADO.indexOf(f.status) !== -1 && f.terminoSondagem) {
      eventosRegistro.sondagemRealizada.push(diaEpoch(f.terminoSondagem));
    }

    // saidaEstoque: o MENOR entre término (qualquer status) e cancelamento
    // -- nunca os dois independentes, pra não contar duas vezes os furos
    // CANCELADO que também têm data de término preenchida (16 na planilha
    // real, ver spec). Só entra se pelo menos um dos dois existir; sem
    // nenhum, o furo nunca sai do estoque (mesma regra da série 'pendentes' abaixo).
    const candidatosSaida = [];
    if (f.terminoSondagem) candidatosSaida.push(diaEpoch(f.terminoSondagem));
    if (cancelado && f.cancelamento) candidatosSaida.push(diaEpoch(f.cancelamento));
    if (candidatosSaida.length) eventosRegistro.saidaEstoque.push(Math.min.apply(null, candidatosSaida));

    const iChegada = indiceDoMes(f.criacaoOS, periodos);
    if (iChegada >= 0) series.chegadas[iChegada] += 1;

    if (STATUS_REALIZADO.indexOf(f.status) !== -1) {
      const iSondagem = indiceDoMes(f.terminoSondagem, periodos);
      if (iSondagem >= 0) { series.sondagemRealizada[iSondagem] += 1; }
    }

    if (f.status === 'CONCLUIDO') {
      const iRelatorio = indiceDoMes(f.conclusao, periodos);
      if (iRelatorio >= 0) series.relatorioConcluido[iRelatorio] += 1;
    }

    if (cancelado) {
      const iCancel = indiceDoMes(f.cancelamento, periodos);
      if (iCancel >= 0) series.canceladas[iCancel] += 1;
    }

    // Estoque: aberto no fim do mês = chegou até ali, e nem a sondagem terminou
    // nem o cancelamento ocorreu até ali. Cancelada sai pela DATA (coluna P), não
    // por status: um furo cancelado em julho estava de fato aberto em janeiro, e o
    // saldo de janeiro tem que dizer isso. Cancelada sem data legível permanece no
    // estoque de propósito -- "não sei quando saiu" é mais honesto que "saiu no
    // começo", e o build reporta a contagem.
    if (f.criacaoOS) {
      for (let i = 0; i < n; i++) {
        if (f.criacaoOS > fins[i]) continue;
        const terminou = f.terminoSondagem && f.terminoSondagem <= fins[i];
        const cancelou = f.cancelamento && f.cancelamento <= fins[i];
        if (!terminou && !cancelou) { series.pendentes[i] += 1; }
      }
    }
  }

  // Ensaios de laboratório (parse-lab.js, aba "Lab Concluido") -- SÓ
  // alimentam porRegistroEventos.sondagemRealizada, pro acompanhamento
  // semanal de LAB.C/LAB.E na Tabela Semanal (mesma série que os furos
  // acima usam, reaproveitada -- render-aba-semanal.js não precisa saber
  // se o "volume" é furo ou ensaio). NÃO entram em tipologias/totais: a
  // aba Demandas (mensal) continua exclusiva de Sondagem/Avanços, fora de
  // escopo deste ajuste -- "LAB.C/LAB.E zerados" ali continua sendo o
  // sinal de "sem fonte", não um bug. Sem chegada/saidaEstoque (a aba Lab
  // Concluido só mostra o que já terminou, sem visibilidade de backlog),
  // então Demandas Pendentes continua sem-dado pra LAB.C/LAB.E, mesmo
  // com Realizado/Tendência já ativos -- decisão do dono do projeto,
  // 2026-07-31: ele pretende trazer a demanda de laboratório pra
  // planilha depois.
  for (const e of ensaiosLab || []) {
    const chaveRegistro = chaveMatriz(e.sup, e.tipologia);
    if (!porRegistroEventos.has(chaveRegistro)) porRegistroEventos.set(chaveRegistro, entradaEventosVazia());
    if (e.concluido) porRegistroEventos.get(chaveRegistro).sondagemRealizada.push(diaEpoch(e.concluido));
  }

  const tipologias = [];
  for (const [rotulo, series] of porTipologia) {
    // SEG.A/SEG.V são serviços acionados sob demanda: sem acionamento no
    // período, a linha de zeros é só ruído. Qualquer outra tipologia aparece
    // mesmo zerada (a grade densa é informação: LAB.C/LAB.E zerados dizem
    // "laboratório tem fonte própria", não "não houve serviço").
    if (SO_QUANDO_ACIONADA.indexOf(rotulo) !== -1) {
      const temAlgum = SERIES.some(nome => series[nome].some(v => v > 0));
      if (!temAlgum) continue;
    }
    tipologias.push({ tipologia: rotulo, series });
  }

  const totais = serieVazia(n);
  for (const bloco of tipologias) {
    for (const nome of SERIES) {
      for (let i = 0; i < n; i++) totais[nome][i] += bloco.series[nome][i];
    }
  }

  return { tipologias, totais, porRegistroEventos: Object.fromEntries(porRegistroEventos) };
}

// O agregado é por TIPOLOGIA, não por SUP -- mas nada é descartado por SUP:
// os 36 SUPs do Avanços contribuem para a tipologia deles, inclusive os 13
// que a MATRIZ não conhece. Esta função só RELATA o desencontro, para o build
// imprimir. Silenciar é o que produziu o Critical da Fase 1 em linha-base.js:
// linha sem correspondência ficava indistinguível de linha legitimamente
// ausente.
function reconciliarSups(furos, registros) {
  const noAvancos = new Set((furos || []).map(f => f.sup).filter(Boolean));
  const naMatriz = new Set((registros || []).map(r => r.sup).filter(Boolean));
  const soNoAvancos = [...noAvancos].filter(s => !naMatriz.has(s));
  const soNaMatriz = [...naMatriz].filter(s => !noAvancos.has(s));
  const furosSemSupNaMatriz = (furos || []).filter(f => f.sup && !naMatriz.has(f.sup)).length;
  return { soNoAvancos, soNaMatriz, furosSemSupNaMatriz };
}

// Furo/ensaio cuja combinação (sup, tipologia) não existe como registro na
// MATRIZ não tem "onde" contar -- ficaria fora do Realizado/Demandas
// Pendentes da Tabela Semanal em silêncio, mesmo sendo trabalho real. A
// MATRIZ sempre tem um registro "Diversos" com Previsto próprio pra cada
// uma das suas 10 tipologias -- SUP não cadastrado SEMPRE redireciona pra
// Diversos, sem exceção, em vez de ser descartado. Função pura e agnóstica
// ao tipo de item (funciona pra ensaios de laboratório E furos de
// Sondagem/Avanços -- os dois só precisam de 'sup'/'tipologia'). Movida de
// build-dashboard.js pra cá: usa chaveMatriz, que só é seguro chamar aqui
// dentro (módulo dual Node/navegador) -- ver
// docs/superpowers/specs/2026-07-31-semanal-atualizar-dados-design.md.
function redirecionarSupsDesconhecidos(itens, registros) {
  const chavesConhecidas = new Set(registros.map(r => chaveMatriz(r.sup, r.tipologia)));
  let redirecionados = 0;
  const saida = itens.map(item => {
    if (chavesConhecidas.has(chaveMatriz(item.sup, item.tipologia))) return item;
    redirecionados++;
    return Object.assign({}, item, { sup: 'Diversos' });
  });
  return { itens: saida, redirecionados };
}

// A MESMA regra de redirecionarSupsDesconhecidos, exposta como consulta por
// PAR em vez de por lista de itens (2026-08-05). Existe porque equipes
// produtivas (compute-equipes-produtivas.js) precisa redirecionar ANTES de
// agregar -- ela conta sondador DISTINTO por dia, e redirecionar depois somaria
// contagens já fechadas, contando duas vezes o sondador que trabalhou em dois
// contratos desconhecidos no mesmo dia. Uma só implementação da regra, para os
// dois caminhos: um par desconhecido vira "Diversos" aqui exatamente como
// viraria lá.
function resolverSupConhecido(registros) {
  const chavesConhecidas = new Set((registros || []).map(r => chaveMatriz(r.sup, r.tipologia)));
  return function (sup, tipologia) {
    return chavesConhecidas.has(chaveMatriz(sup, tipologia)) ? sup : 'Diversos';
  };
}

module.exports = { computeDemandas, reconciliarSups, redirecionarSupsDesconhecidos, resolverSupConhecido, SERIES, SERIE_ESTOQUE };
