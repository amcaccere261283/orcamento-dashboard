'use strict';

// <<< INICIO CLIENTE
var SEMANAS = 4;

// Volume e financeiro são FLUXOS: o mês se reparte em 4 fatias nominais e a
// soma delas reconstrói o mês. Equipes é uma FOTO: 2 equipes mobilizadas no
// mês são 2 equipes em cada semana, não 0,5 -- dividir produziria número
// errado em silêncio e discordaria do orçamento, que mostra a média. Mesma
// premissa de mediaEquipesPonderada em tools/comum/calculo-equipes.js.
function dividirEmSemanas(valorMensal, dimensao) {
  var saida = [];
  for (var i = 0; i < SEMANAS; i++) {
    if (valorMensal === null || valorMensal === undefined) { saida.push(null); continue; }
    saida.push(dimensao === 'equipes' ? valorMensal : valorMensal / SEMANAS);
  }
  return saida;
}

function fecharMes(semanas, dimensao) {
  var validos = (semanas || []).filter(function (v) { return v !== null && v !== undefined; });
  if (!validos.length) return null;
  var soma = validos.reduce(function (a, b) { return a + b; }, 0);
  return dimensao === 'equipes' ? soma / validos.length : soma;
}

// diaDoMes: 1-31. diasNoMes: total de dias do mês vigente (28-31). Devolve
// 1-4 -- qual fatia nominal do mês "hoje" cai dentro, com a MESMA divisão em
// 4 partes iguais que dividirEmSemanas já aplica ao VALOR mensal, agora
// aplicada ao CALENDÁRIO -- não semanas ISO, mesmo espírito do resto deste
// arquivo. Math.min/max travam o resultado em [1,4] mesmo quando as fatias
// não fecham em número inteiro de dias (ex.: mês de 31 dias, 31/4 = 7.75).
function semanaAtual(diaDoMes, diasNoMes) {
  var semana = Math.ceil(diaDoMes / (diasNoMes / SEMANAS));
  return Math.min(SEMANAS, Math.max(1, semana));
}
// FIM CLIENTE >>>

module.exports = { SEMANAS, dividirEmSemanas, fecharMes, semanaAtual };
