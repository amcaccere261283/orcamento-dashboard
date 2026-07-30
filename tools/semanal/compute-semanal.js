'use strict';

// <<< INICIO CLIENTE
var SEMANAS = 4;

// Volume e financeiro são FLUXOS: o mês se reparte em N fatias nominais e a
// soma delas reconstrói o mês. Equipes é uma FOTO: 2 equipes mobilizadas no
// mês são 2 equipes em cada semana, não valorMensal/N -- dividir produziria
// número errado em silêncio e discordaria do orçamento, que mostra a média.
// Mesma premissa de mediaEquipesPonderada em tools/comum/calculo-equipes.js.
// numSemanas é OBRIGATÓRIO: o calendário ISO abaixo mostra que um mês tem 4
// ou 5 semanas reais, nunca sempre 4 -- ver
// docs/superpowers/specs/2026-07-30-semanal-calendario-iso-design.md.
function dividirEmSemanas(valorMensal, dimensao, numSemanas) {
  var saida = [];
  for (var i = 0; i < numSemanas; i++) {
    if (valorMensal === null || valorMensal === undefined) { saida.push(null); continue; }
    saida.push(dimensao === 'equipes' ? valorMensal : valorMensal / numSemanas);
  }
  return saida;
}

function fecharMes(semanas, dimensao) {
  var validos = (semanas || []).filter(function (v) { return v !== null && v !== undefined; });
  if (!validos.length) return null;
  var soma = validos.reduce(function (a, b) { return a + b; }, 0);
  return dimensao === 'equipes' ? soma / validos.length : soma;
}

// OBSOLETO a partir do calendário ISO abaixo (ver
// docs/superpowers/specs/2026-07-30-semanal-calendario-iso-design.md) --
// mantido só até a Tarefa 3 deste plano trocar render-aba-semanal.js pelas
// semanas reais (semanasDoMes/indiceSemanaAtual). Não usar em código novo.
function semanaAtual(diaDoMes, diasNoMes) {
  var semana = Math.ceil(diaDoMes / (diasNoMes / SEMANAS));
  return Math.min(SEMANAS, Math.max(1, semana));
}

// ============================================================
// Calendário ISO 8601 de semanas reais (segunda a domingo) -- ver
// docs/superpowers/specs/2026-07-30-semanal-calendario-iso-design.md. Cada
// semana pertence ao mês que contém a MAIORIA dos seus 7 dias -- como 7 é
// ímpar, nunca há empate, e uma semana de 7 dias nunca toca 3 meses (nem
// fevereiro, o mês mais curto, tem menos de 7 dias).
// ============================================================

// Dia inteiro desde a época Unix (1970-01-01), a partir de QUALQUER
// instante de um Date -- só um floor, sem ajuste de fuso: quem constrói o
// Date decide se quer o dia civil local (new Date(ano,mes,dia), meia-noite
// local) ou outro instante. Mesma unidade usada nos eventos de furos
// (chegada/sondagemRealizada/saidaEstoque, ver compute-demandas.js) --
// permite comparar datas como inteiros simples, sem reconstruir Date.
function diaEpoch(data) {
  return Math.floor(data.getTime() / 86400000);
}

// Dado o início (segunda) de uma semana ISO, decide qual (ano, mês) tem a
// maioria dos seus 7 dias.
function mesDaSemana(segunda) {
  var contagem = {};
  var melhorChave = null;
  var melhorContagem = 0;
  for (var i = 0; i < 7; i++) {
    var d = new Date(segunda.getFullYear(), segunda.getMonth(), segunda.getDate() + i);
    var chave = d.getFullYear() + '-' + d.getMonth();
    contagem[chave] = (contagem[chave] || 0) + 1;
    if (contagem[chave] > melhorContagem) {
      melhorContagem = contagem[chave];
      melhorChave = chave;
    }
  }
  var partes = melhorChave.split('-');
  return { ano: Number(partes[0]), mes: Number(partes[1]) };
}

// Semanas ISO (segunda a domingo) cuja maioria dos dias cai em (ano,
// mesIndex) -- 4 ou 5 semanas, na ordem do calendário. inicio/fim de cada
// semana já vêm em diaEpoch, prontos pra comparar com datas de furos sem
// reconstruir Date. Varre a partir de uma semana antes do 1º dia do mês
// (cobre o caso da 1ª semana do mês pertencer, pela regra da maioria, ao
// mês anterior) e avança semana a semana -- no máximo 5 semanas próprias +
// as 2 de fronteira cabem com folga em 8 iterações.
function semanasDoMes(ano, mesIndex) {
  var primeiroDia = new Date(ano, mesIndex, 1);
  var deslocamento = (primeiroDia.getDay() + 6) % 7; // 0=segunda..6=domingo
  var cursor = new Date(ano, mesIndex, 1 - deslocamento - 7);
  var semanas = [];
  for (var i = 0; i < 8; i++) {
    var segunda = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
    var domingo = new Date(segunda.getFullYear(), segunda.getMonth(), segunda.getDate() + 6);
    var dono = mesDaSemana(segunda);
    if (dono.ano === ano && dono.mes === mesIndex) {
      semanas.push({ inicio: diaEpoch(segunda), fim: diaEpoch(domingo) });
    }
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7);
  }
  return semanas;
}

// Índice (0-based) da semana, dentro de semanasDoMes, que contém hojeEpoch
// -- ou -1 se nenhuma contém (dias de fronteira entre meses: a semana ISO
// que cobre esses dias pode pertencer ao mês anterior pela regra da
// maioria -- ver spec).
function indiceSemanaAtual(semanas, hojeEpoch) {
  for (var i = 0; i < semanas.length; i++) {
    if (hojeEpoch >= semanas[i].inicio && hojeEpoch <= semanas[i].fim) return i;
  }
  return -1;
}
// FIM CLIENTE >>>

module.exports = {
  SEMANAS, dividirEmSemanas, fecharMes, semanaAtual,
  diaEpoch, semanasDoMes, indiceSemanaAtual,
};
