'use strict';

// Este módulo roda tanto no Node (testes/build) quanto embrulhado no
// navegador via buildBrowserBundle -- por isso 'var'/'function', não
// 'const'/arrow (mesmo aviso em compute-balanco.js/compute-semanal.js).
//
// EQUIPES MOBILIZADAS a partir do Avanço Sond (2026-08-03)
// ============================================================================
// O Previsto de equipes vem da MATRIZ. O Realizado vinha da coluna Realizado
// da MATRIZ também -- que só é preenchida depois que o mês fecha, e que no mês
// corrente traz 0 (não vazio): o Balanço desenhava, para todo SUP, um déficit
// igual ao previsto inteiro, como se as equipes tivessem sumido. Medido em
// 2026-08-03: 349 dos 350 registros com 0 em agosto, e 350 de 350 vazios em
// julho.
//
// A fonte que existe em tempo real é o Avanço Sond, onde cada furo traz, na
// MESMA linha, o SUP, a tipologia, as datas e o Sondador (coluna Y). Sondador
// distinto é o proxy de equipe: uma equipe de campo é 1 sondador mais
// auxiliares, então dois sondadores no mesmo dia e contrato são duas equipes.
//
// A UNIDADE É "EQUIPE EQUIVALENTE", NÃO "PESSOAS DISTINTAS NO PERÍODO
// ------------------------------------------------------------------
// Contar sondadores distintos por (SUP, tipologia) no mês parece o caminho
// natural e está errado: o mesmo sondador atende vários contratos ao longo do
// mês e seria contado INTEIRO em cada um. Medido em julho/2026: 95 pessoas
// tocaram algum furo, mas a soma dos "distintos por par" dava 185 -- quase o
// dobro do efetivo real, e portanto incomparável com o Previsto, que é uma
// alocação.
//
// Aqui a conta é equipe-dia dividido pelos dias do período. Cada dia de cada
// par conta os sondadores distintos DAQUELE dia; a média sobre o período é
// aditiva entre SUPs e tem a mesma natureza do Previsto da MATRIZ, que também
// é uma foto média do mês (ver mediaEquipesPonderada em
// tools/comum/calculo-equipes.js). Em julho a mesma base dá 54,4 equipes
// equivalentes -- número que cabe dentro das 95 pessoas, como tem de ser.
//
// A ocupação é o INTERVALO do furo (Inicio..Termino Sondagem), não o dia do
// término: um furo de cinco dias ocupa a equipe cinco dias, e furos longos são
// justamente os que mais consomem equipe.

// Normaliza para dia-desde-época (a unidade que compute-semanal.js usa em
// semanas[i].inicio/fim e que o Balanço já fala).
//
// Aceita os DOIS tipos de propósito: parseAvancos entrega Date (dataSaneada
// devolve excelSerialParaData), enquanto o resto do módulo -- e os testes --
// trabalha em número de dias. Assumir só o número custou caro: o laço por dia
// passou a iterar de milissegundo em milissegundo sobre um Date, o que dava
// 2,87 TRILHÕES de iterações na planilha real e travava o build. Os testes
// sintéticos não pegaram porque passavam número, que é justamente o tipo que
// o dado real NÃO tem.
function paraDiaEpoch(valor) {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor.getTime === 'function') {
    var ms = valor.getTime();
    return Number.isFinite(ms) ? Math.floor(ms / 86400000) : null;
  }
  return null;
}

// { 'sup||tipologia': { epochDoDia: nSondadoresDistintos } }
//
// Guarda a CONTAGEM por dia, não a lista de nomes: o objeto vai embutido no
// HTML publicado e nome de sondador é dado pessoal que não precisa viajar para
// o navegador -- a contagem responde tudo que o Balanço pergunta. (SUP,
// Tomador e tipologia já são renderizados na página, nomes de pessoas não.)
function agregarEquipesPorDia(furos) {
  var porDiaSets = {};
  (furos || []).forEach(function (furo) {
    if (!furo) return;
    var sondador = String(furo.sondador === null || furo.sondador === undefined ? '' : furo.sondador).trim();
    if (!sondador) return;
    var inicio = paraDiaEpoch(furo.inicioSondagem);
    if (inicio === null) return;
    // Término ausente OU anterior ao início (dado invertido, existe na
    // planilha): ocupa só o dia de início. Nunca extrapola para trás nem
    // deixa o laço abaixo sem fim.
    var fim = paraDiaEpoch(furo.terminoSondagem);
    if (fim === null || fim < inicio) fim = inicio;

    var chave = furo.sup + '||' + furo.tipologia;
    if (!porDiaSets[chave]) porDiaSets[chave] = {};
    for (var d = inicio; d <= fim; d++) {
      if (!porDiaSets[chave][d]) porDiaSets[chave][d] = {};
      porDiaSets[chave][d][sondador] = true;
    }
  });

  var saida = {};
  Object.keys(porDiaSets).forEach(function (chave) {
    saida[chave] = {};
    Object.keys(porDiaSets[chave]).forEach(function (dia) {
      saida[chave][dia] = Object.keys(porDiaSets[chave][dia]).length;
    });
  });
  return saida;
}

// porDia: { epochDoDia: nSondadores } de UM par (sup, tipologia).
// janelas: [{ inicio, fim }] em epoch de dia, fechadas nas duas pontas -- uma
// só (o mês) no caso normal, ou uma por semana marcada no recorte semanal.
//
// null quando não há janela nenhuma ("não dá para calcular"), 0 quando há
// janela e nenhum furo dentro dela ("ninguém trabalhou aqui") -- a mesma
// distinção que o resto do Balanço faz entre sem-dado e zero real.
function equipesEquivalentes(porDia, janelas) {
  if (!Array.isArray(janelas) || !janelas.length) return null;
  var totalDias = 0;
  var equipeDias = 0;
  for (var j = 0; j < janelas.length; j++) {
    var ini = janelas[j].inicio, fim = janelas[j].fim;
    if (typeof ini !== 'number' || typeof fim !== 'number' || fim < ini) continue;
    totalDias += (fim - ini + 1);
    for (var d = ini; d <= fim; d++) {
      var n = porDia ? porDia[d] : 0;
      if (n) equipeDias += n;
    }
  }
  if (!totalDias) return null;
  return equipeDias / totalDias;
}

module.exports = { agregarEquipesPorDia, equipesEquivalentes };
