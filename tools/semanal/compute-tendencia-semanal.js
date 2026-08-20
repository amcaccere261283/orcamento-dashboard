'use strict';
const { diasNaSemana } = require('./compute-semanal.js');

// Tendência semanal ANCORADA NA LINHA T DO ORÇAMENTO -- pedido do dono do
// projeto em 2026-08-20. Volume/Financeiro projetavam o mês a partir de um
// algoritmo automático por RAMO (igual/acima/abaixo, comparando Realizado x
// Previsto -- ver docs/superpowers/specs/2026-08-04-semanal-tendencia-regras-
// e-alertas-design.md e a evolução em 2026-08-17,
// docs/superpowers/specs/2026-08-17-semanal-tendencia-ramo-acima-design.md).
// Agora a curva projetada (o array 'semanas' devolvido) fecha sempre no valor
// que o usuário digita na linha T da MATRIZ pro mês selecionado -- a MESMA
// fonte que Equipes já lê via somaMesVigente(..., 'total', ...)
// (render-aba-semanal.js) e que o dashboard MENSAL de orçamento usa como
// Tendência (SERIE_LABELS, render-dashboard.js): o que falta pra chegar em T
// é repartido pelos dias que restam do mês. T em branco conta como ZERO --
// "não executar nada naquele local", nunca cai de volta no automático por
// ritmo/Previsto.
//
// O RAMO/DIAGNÓSTICO continuam sendo calculados exatamente como antes,
// comparando Realizado x Previsto (P): é sobre estar no ritmo do PLANO
// original, pergunta que uma reestimativa manual (T) não responde, e a aba
// Alertas depende desses dois campos (inclusive o novo 'realizadoVigente',
// 2026-08-17) pra decidir qual alerta disparar. Só o array 'semanas' (a
// curva/número exibido) mudou de fonte.

// Igualdade exata em ponto flutuante nunca acontece -- sem tolerância, o ramo
// "mantém o P" seria código morto. 1% do Previsto acumulado.
var TOLERANCIA_IGUAL = 0.01;

// 'igual' quando a diferença cabe na tolerância; isso inclui o caso
// previsto=0 e realizado=0 (mês inteiramente no futuro, ou plano zerado).
// previsto=0 com realizado>0 cai em 'acima', que é a leitura certa: produziu
// o que não estava planejado.
function escolherRamo(realizadoAcumulado, previstoAcumulado) {
  var diferenca = realizadoAcumulado - previstoAcumulado;
  if (Math.abs(diferenca) <= Math.abs(previstoAcumulado) * TOLERANCIA_IGUAL) return 'igual';
  return diferenca > 0 ? 'acima' : 'abaixo';
}

function numero(v) { return (v === null || v === undefined) ? 0 : v; }

function calcularTendenciaSemanal(entrada) {
  var e = entrada || {};
  var semanasRealizado = e.semanasRealizado || [];
  var semanasPrevisto = e.semanasPrevisto || [];
  var semanas = e.semanas;
  var previstoMes = e.previstoMes;
  // Linha T do orçamento pro mês selecionado (somaMesVigente(...,'total',...),
  // render-aba-semanal.js) -- null/undefined (T em branco) é tratado como
  // zero logo abaixo, em saldoTendencia.
  var tendenciaMes = e.tendenciaMes;
  var hojeEpoch = e.hojeEpoch;
  var numSemanas = semanasRealizado.length;

  var nulos = [];
  for (var n = 0; n < numSemanas; n++) nulos.push(null);
  var semDado = { semanas: nulos, ramo: 'sem-dado', diagnostico: null };

  if (previstoMes === null || previstoMes === undefined) return semDado;
  if (typeof hojeEpoch !== 'number') return semDado;
  if (!Array.isArray(semanas) || semanas.length !== numSemanas || numSemanas === 0) return semDado;

  // Regra 2.1: mês inteiramente no passado não tem futuro a projetar, e a
  // Tendência ali só repetiria o Realizado -- que é exatamente a duplicação
  // que o pedido veio eliminar. Vale para as células E para o fechamento:
  // quem chama transforma este retorno em fechamento null.
  if (semanas[numSemanas - 1].fim < hojeEpoch) return semDado;

  var fechadas = 0;
  for (var i = 0; i < numSemanas; i++) { if (semanas[i].fim < hojeEpoch) fechadas++; }

  // A semana em curso é a primeira NÃO fechada que já começou. Fica -1 quando
  // o mês inteiro ainda está no futuro.
  var indiceVigente = (fechadas < numSemanas && semanas[fechadas].inicio <= hojeEpoch) ? fechadas : -1;

  var realizadoAcumulado = 0;
  var previstoAcumulado = 0;
  var diasFechados = 0;
  for (var f = 0; f < fechadas; f++) {
    realizadoAcumulado += numero(semanasRealizado[f]);
    previstoAcumulado += numero(semanasPrevisto[f]);
    diasFechados += diasNaSemana(semanas[f]);
  }

  // A semana em curso fica FORA da comparação que escolhe o ramo: meia semana
  // de Realizado contra um Previsto de semana inteira acusaria déficit toda
  // segunda-feira, e o mês seria projetado a partir de um buraco que não
  // existe. O Realizado parcial dela entra só no saldo e na própria célula.
  var realizadoVigente = indiceVigente >= 0 ? numero(semanasRealizado[indiceVigente]) : 0;

  // Hoje já aconteceu: os dias que faltam da vigente são os DEPOIS de hoje.
  var diasRestantesVigente = indiceVigente >= 0 ? (semanas[indiceVigente].fim - hojeEpoch) : 0;
  var diasRestantesMes = diasRestantesVigente;
  var primeiraFutura = indiceVigente >= 0 ? indiceVigente + 1 : fechadas;
  for (var fu = primeiraFutura; fu < numSemanas; fu++) diasRestantesMes += diasNaSemana(semanas[fu]);

  // Ramo/diagnóstico: continuam comparando Realizado x Previsto (P) -- não
  // decidem mais o valor de 'saida' abaixo. Continuam existindo porque a aba
  // Alertas lê os dois (inclusive 'realizadoVigente', pro alerta de
  // movimentação de equipe).
  var ramo = escolherRamo(realizadoAcumulado, previstoAcumulado);
  var ritmoPorDia = diasFechados > 0 ? realizadoAcumulado / diasFechados : 0;
  var saldo = previstoMes - realizadoAcumulado - realizadoVigente;

  // O que falta pra fechar o mês no T do orçamento, repartido pelos dias que
  // restam. max(0, ...) cobre os dois casos em que não há mais nada a
  // projetar: T em branco (numero() já devolveu 0) e T já superado pelo
  // Realizado -- nenhum dos dois pode gerar produção negativa.
  var saldoTendencia = Math.max(0, numero(tendenciaMes) - realizadoAcumulado - realizadoVigente);

  var saida = [];
  for (var k = 0; k < numSemanas; k++) {
    if (k < fechadas) { saida.push(numero(semanasRealizado[k])); continue; }
    var ehVigente = (k === indiceVigente);
    var diasDaFatia = ehVigente ? diasRestantesVigente : diasNaSemana(semanas[k]);
    var base = ehVigente ? realizadoVigente : 0;
    saida.push(diasRestantesMes > 0 ? base + saldoTendencia * diasDaFatia / diasRestantesMes : base);
  }

  return {
    semanas: saida,
    ramo: ramo,
    diagnostico: {
      realizadoAcumulado: realizadoAcumulado,
      previstoAcumulado: previstoAcumulado,
      semanasFechadas: fechadas,
      indiceVigente: indiceVigente,
      // Consumido pelo alerta de movimentação de equipe (ramo 'acima' com a
      // vigente zerada) -- ver compute-alertas-tendencia.js.
      realizadoVigente: realizadoVigente,
      saldo: saldo,
      ritmoPorDia: ritmoPorDia,
      diasRestantesMes: diasRestantesMes,
    },
  };
}

module.exports = { calcularTendenciaSemanal, escolherRamo, TOLERANCIA_IGUAL };
