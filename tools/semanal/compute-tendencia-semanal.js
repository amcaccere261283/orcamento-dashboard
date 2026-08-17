'use strict';
const { diasNaSemana } = require('./compute-semanal.js');

// Tendência semanal por RAMO -- pedido do dono do projeto em 2026-08-04, ver
// docs/superpowers/specs/2026-08-04-semanal-tendencia-regras-e-alertas-design.md.
// Substitui a calcularTendenciaSemanal que morava em render-aba-semanal.js e
// tinha só DOIS ramos (saldo positivo / saldo não positivo).
//
// A projeção e o DIAGNÓSTICO saem da mesma função de propósito: os dois
// alertas novos da aba Alertas precisam saber em que ramo o grupo caiu e com
// que números, e recalcular isso lá abriria a porta para a Tabela projetar por
// um ramo enquanto o alerta acusa outro, sem nada quebrar.

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

  var ramo = escolherRamo(realizadoAcumulado, previstoAcumulado);
  var ritmoPorDia = diasFechados > 0 ? realizadoAcumulado / diasFechados : 0;
  var saldo = previstoMes - realizadoAcumulado - realizadoVigente;

  var saida = [];
  for (var k = 0; k < numSemanas; k++) {
    if (k < fechadas) { saida.push(numero(semanasRealizado[k])); continue; }
    var ehVigente = (k === indiceVigente);

    // Ramo 'acima' passou a mirar o Previsto de cada semana, igual ao ramo
    // 'igual' -- pedido de 2026-08-17: estender o ritmo que já bateu o plano
    // inflava a leitura da semana fechada e escondia semana vigente parada.
    // Ver docs/superpowers/specs/2026-08-17-semanal-tendencia-ramo-acima-design.md.
    if (ramo === 'igual' || ramo === 'acima') {
      // "mantém o P na T": a fatia INTEIRA que a linha Previsto exibe, para as
      // duas linhas mostrarem o mesmo número. Na vigente, nunca abaixo do que
      // já é fato.
      var previstoDaSemana = numero(semanasPrevisto[k]);
      saida.push(ehVigente ? Math.max(previstoDaSemana, realizadoVigente) : previstoDaSemana);
      continue;
    }

    // Só o ramo 'abaixo' chega aqui.
    var diasDaFatia = ehVigente ? diasRestantesVigente : diasNaSemana(semanas[k]);
    var base = ehVigente ? realizadoVigente : 0;

    // saldo <= 0 dentro do ramo 'abaixo' acontece quando o Realizado parcial
    // da vigente já cobriu sozinho o que faltava do mês -- seguir a fórmula do
    // saldo ali produziria projeção NEGATIVA.
    if (saldo <= 0) {
      saida.push(base + ritmoPorDia * diasDaFatia);
      continue;
    }
    saida.push(diasRestantesMes > 0 ? base + saldo * diasDaFatia / diasRestantesMes : base);
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
