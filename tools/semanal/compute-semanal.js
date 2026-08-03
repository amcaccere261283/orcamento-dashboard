'use strict';

// <<< INICIO CLIENTE
// Quantidade de dias que uma semana (ver semanasDoMes) cobre, inclusive nos
// dois extremos -- mesma convenção de diaEpoch. Não confundir com
// diaDaSemana (abaixo): esta conta DIAS DENTRO de um intervalo {inicio,fim},
// aquela devolve o dia-da-semana (0=segunda..6=domingo) de um dia isolado.
function diasNaSemana(semana) {
  return semana.fim - semana.inicio + 1;
}

// Volume e financeiro são FLUXOS: o mês se reparte PROPORCIONALMENTE AOS
// DIAS de cada semana -- uma semana de 7 dias produz o dobro de uma de 3-4
// dias, não a mesma fatia. Achado de 2026-08-01: dividir em N fatias iguais
// (por número de semana, não por dia) superestimava as semanas de borda
// curtas -- agosto/2026 tem S1 com 2 dias e S6 com 1 dia, e ambas recebiam
// a MESMA fatia que uma semana cheia de 7 dias, inflando o ritmo esperado
// nelas e reduzindo o das semanas cheias. Equipes é uma FOTO: 2 equipes
// mobilizadas no mês são 2 equipes em cada semana, não valorMensal
// repartido de nenhuma forma -- dividir (por semana OU por dia) produziria
// número errado em silêncio e discordaria do orçamento, que mostra a
// média. Mesma premissa de mediaEquipesPonderada em
// tools/comum/calculo-equipes.js.
// 'semanas' (opcional): as semanas reais do mês (ver semanasDoMes) --
// necessárias pra pesar por dia. Sem elas, ou com comprimento diferente de
// numSemanas (não deveria acontecer no fluxo real: quem chama sempre tem as
// semanas reais à mão), cai na divisão igual antiga como fallback
// defensivo, em vez de dividir por uma contagem de dias que não bate com o
// número de fatias pedido.
function dividirEmSemanas(valorMensal, dimensao, numSemanas, semanas) {
  var semanasValidas = Array.isArray(semanas) && semanas.length === numSemanas;
  var diasTotal = 0;
  if (semanasValidas) {
    for (var d = 0; d < numSemanas; d++) diasTotal += diasNaSemana(semanas[d]);
  }
  var saida = [];
  for (var i = 0; i < numSemanas; i++) {
    if (valorMensal === null || valorMensal === undefined) { saida.push(null); continue; }
    if (dimensao === 'equipes') { saida.push(valorMensal); continue; }
    saida.push(semanasValidas && diasTotal > 0
      ? valorMensal * diasNaSemana(semanas[i]) / diasTotal
      : valorMensal / numSemanas);
  }
  return saida;
}

// A MESMA repartição de dividirEmSemanas, só que em números INTEIROS --
// pedido do dono do projeto em 2026-08-03: a linha Previsto da Tabela
// Semanal não mostra fração de furo nem centavo repartido, e a soma das
// semanas NUNCA pode estourar o total do mês.
//
// Método do maior resto (Hare-Niemeyer), com o teto em Math.floor(valorMensal):
// cada semana leva o piso da sua fatia proporcional aos dias, e as unidades
// que sobram até fechar o teto vão, uma a uma, pras semanas de maior parte
// fracionária (empate desempatado pelo menor índice, para ser determinístico).
// Duas garantias que valem por construção, não por tolerância:
//
//   - a soma das fatias é EXATAMENTE Math.floor(valorMensal) -- nunca passa do
//     mês, e nunca fica mais de 1 unidade abaixo dele;
//   - arredondar cada semana isoladamente (Math.round) NÃO daria isso: as
//     bordas para cima somariam mais que o mês, que é justamente o que este
//     pedido veio impedir.
//
// Duas dimensões saem pelo caminho de sempre, sem arredondar:
//
//   - equipes, que é FOTO e não fluxo (ver dividirEmSemanas): "2,5 equipes"
//     é uma média ponderada real, não meia unidade repartida, e arredondar
//     faria a Tabela discordar do Balanço de massa sobre o mesmo número;
//   - valor negativo, que não existe em Previsto: Math.floor afastaria do
//     zero (-3,2 -> -4) e a "soma que não supera o mês" viraria o oposto.
function dividirEmSemanasInteiras(valorMensal, dimensao, numSemanas, semanas) {
  var bruto = dividirEmSemanas(valorMensal, dimensao, numSemanas, semanas);
  if (dimensao === 'equipes') return bruto;
  if (valorMensal === null || valorMensal === undefined || valorMensal < 0) return bruto;

  var pisos = [];
  var restos = [];
  var somaPisos = 0;
  for (var i = 0; i < numSemanas; i++) {
    var v = bruto[i] === null || bruto[i] === undefined ? 0 : bruto[i];
    var piso = Math.floor(v);
    pisos.push(piso);
    restos.push({ indice: i, resto: v - piso });
    somaPisos += piso;
  }

  var sobra = Math.floor(valorMensal) - somaPisos;
  restos.sort(function (a, b) { return b.resto - a.resto || a.indice - b.indice; });
  for (var s = 0; s < sobra && s < restos.length; s++) pisos[restos[s].indice] += 1;
  return pisos;
}

function fecharMes(semanas, dimensao) {
  var validos = (semanas || []).filter(function (v) { return v !== null && v !== undefined; });
  if (!validos.length) return null;
  var soma = validos.reduce(function (a, b) { return a + b; }, 0);
  return dimensao === 'equipes' ? soma / validos.length : soma;
}

// ============================================================
// Calendário de semanas reais (segunda a domingo), cortadas SEMPRE dentro do
// mês -- ver docs/superpowers/specs/2026-07-30-semanal-calendario-iso-design.md
// (substituído em 2026-08-01: a versão anterior usava a "regra da maioria" do
// ISO 8601, que deixava dias de um mês contarem no acompanhamento do mês
// vizinho -- ex.: 29-30/06 entravam no Realizado de julho. Isso é inaceitável
// pra quem acompanha o produzido mensal: cada dia tem que contar SÓ no mês
// dele). A 1ª e a última semana de cada mês ficam curtas (1 a 7 dias) sempre
// que o mês não começa numa segunda ou não termina num domingo; as do meio
// são semana cheia (segunda a domingo). Nenhum mês de 2026 tem exatamente 4
// -- a contagem real varia de 5 a 6.
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

// Dia da semana de um dia-desde-época, na convenção 0=segunda..6=domingo
// (não a convenção nativa de Date, que é 0=domingo..6=sábado) -- mesma
// convenção usada no resto do arquivo. Reconstrói o Date multiplicando de
// volta por 86400000: como diaEpoch nunca ajusta fuso (só floor), o produto
// cai exatamente na meia-noite UTC daquele dia -- mesma garantia de UTC em
// toda a aritmética que o resto do arquivo já documenta (achado da revisão
// final da branch anterior: Date local aqui deslizaria a semana em fusos
// diferentes de UTC+0).
function diaDaSemana(diaEp) {
  var d = new Date(diaEp * 86400000);
  return (d.getUTCDay() + 6) % 7;
}

// Semanas (segunda a domingo) do mês (ano, mesIndex), cortadas SEMPRE dentro
// do mês -- nunca uma semana atravessa a virada de mês. Anda dia a dia desde
// o 1º dia do mês: cada semana vai até o primeiro domingo que encontrar, ou
// até o fim do mês, o que vier primeiro -- por isso a 1ª e a última semana
// costumam ficar curtas (1 a 7 dias), e as do meio são sempre cheias (7
// dias). inicio/fim de cada semana já vêm em diaEpoch, prontos pra comparar
// com datas de furos sem reconstruir Date.
function semanasDoMes(ano, mesIndex) {
  var cursor = diaEpoch(new Date(Date.UTC(ano, mesIndex, 1)));
  var fimMes = diaEpoch(new Date(Date.UTC(ano, mesIndex + 1, 0)));
  var semanas = [];
  while (cursor <= fimMes) {
    var diasAteDomingo = 6 - diaDaSemana(cursor);
    var fimSemana = Math.min(cursor + diasAteDomingo, fimMes);
    semanas.push({ inicio: cursor, fim: fimSemana });
    cursor = fimSemana + 1;
  }
  return semanas;
}

// Índice (0-based) da semana, dentro de semanasDoMes, que contém hojeEpoch
// -- ou -1 se nenhuma contém. Com o corte sempre dentro do mês, as semanas
// de um mês cobrem TODOS os seus dias sem lacuna nenhuma -- -1 só acontece
// se hojeEpoch estiver fora do mês vigente sendo exibido (chamador passou
// hoje/vigenteIdx inconsistentes entre si; nunca acontece no fluxo real,
// onde os dois vêm do mesmo "hoje" -- ver render-semanal.js).
function indiceSemanaAtual(semanas, hojeEpoch) {
  for (var i = 0; i < semanas.length; i++) {
    if (hojeEpoch >= semanas[i].inicio && hojeEpoch <= semanas[i].fim) return i;
  }
  return -1;
}
// FIM CLIENTE >>>

module.exports = { dividirEmSemanas, dividirEmSemanasInteiras, fecharMes, diaEpoch, semanasDoMes, indiceSemanaAtual, diasNaSemana };
