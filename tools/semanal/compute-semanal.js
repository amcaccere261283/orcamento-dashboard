'use strict';

// <<< INICIO CLIENTE
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

// ============================================================
// Calendário ISO 8601 de semanas reais (segunda a domingo) -- ver
// docs/superpowers/specs/2026-07-30-semanal-calendario-iso-design.md. Cada
// semana pertence ao mês que contém a MAIORIA dos seus 7 dias -- como 7 é
// ímpar, nunca há empate, e uma semana de 7 dias nunca toca 3 meses (nem
// fevereiro, o mês mais curto, tem menos de 7 dias).
// ============================================================

// Dia inteiro desde a época Unix (1970-01-01), a partir de QUALQUER
// instante de um Date -- só um floor, sem ajuste de fuso próprio. Mesma
// unidade usada nos eventos de furos (chegada/sondagemRealizada/
// saidaEstoque, ver compute-demandas.js) -- permite comparar datas como
// inteiros simples, sem reconstruir Date. Como esta função em si não ajusta
// fuso nenhum, quem chama precisa entregar um Date já ancorado em UTC
// (new Date(Date.UTC(ano,mes,dia)), meia-noite UTC) -- é assim que
// excelSerialParaData (tools/comum/datas.js) já produz as datas de furos, e
// é assim que semanasDoMes constrói os limites de semana abaixo. "hoje" no
// cliente segue a mesma regra: pega o dia civil LOCAL de quem está vendo a
// página (new Date().getFullYear()/getMonth()/getDate() -- isso É
// timezone-dependente de propósito, é o dia que a pessoa vê no relógio
// dela) e só DEPOIS ancora esse (ano,mês,dia) em UTC antes de chamar
// diaEpoch -- ver render-semanal.js. Passar um Date construído local (new
// Date(ano,mes,dia), sem Date.UTC) faria o número discordar do resto do
// sistema em qualquer fuso diferente de UTC+0 (achado da revisão final).
function diaEpoch(data) {
  return Math.floor(data.getTime() / 86400000);
}

// Dado o início (segunda) de uma semana ISO, decide qual (ano, mês) tem a
// maioria dos seus 7 dias. Trabalha inteiramente em UTC (getUTC*/Date.UTC)
// -- mesma convenção que excelSerialParaData/indiceDoMes/calcularVigenteIdx
// já usam no resto do projeto -- de propósito: os eventos de furos (Tarefa
// 2, compute-demandas.js) vêm de excelSerialParaData, que produz meia-noite
// UTC. Se este cálculo usasse Date local, diaEpoch(segunda) dependeria do
// fuso da máquina rodando o build/navegador -- em fusos à frente de UTC
// (ex.: Europe/Berlin), a semana inteira deslizaria um dia pra trás e um
// furo terminado no domingo cairia na semana errada, em silêncio (achado da
// revisão final da branch).
function mesDaSemana(segunda) {
  var contagem = {};
  var melhorChave = null;
  var melhorContagem = 0;
  for (var i = 0; i < 7; i++) {
    var d = new Date(Date.UTC(segunda.getUTCFullYear(), segunda.getUTCMonth(), segunda.getUTCDate() + i));
    var chave = d.getUTCFullYear() + '-' + d.getUTCMonth();
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
// as 2 de fronteira cabem com folga em 8 iterações. UTC em toda a
// aritmética (ver o comentário de mesDaSemana acima).
function semanasDoMes(ano, mesIndex) {
  var primeiroDia = new Date(Date.UTC(ano, mesIndex, 1));
  var deslocamento = (primeiroDia.getUTCDay() + 6) % 7; // 0=segunda..6=domingo
  var cursor = new Date(Date.UTC(ano, mesIndex, 1 - deslocamento - 7));
  var semanas = [];
  for (var i = 0; i < 8; i++) {
    var segunda = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate()));
    var domingo = new Date(Date.UTC(segunda.getUTCFullYear(), segunda.getUTCMonth(), segunda.getUTCDate() + 6));
    var dono = mesDaSemana(segunda);
    if (dono.ano === ano && dono.mes === mesIndex) {
      semanas.push({ inicio: diaEpoch(segunda), fim: diaEpoch(domingo) });
    }
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() + 7));
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

module.exports = { dividirEmSemanas, fecharMes, diaEpoch, semanasDoMes, indiceSemanaAtual };
