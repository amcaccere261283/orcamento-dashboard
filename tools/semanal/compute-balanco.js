'use strict';
const { mediaEquipesPonderada } = require('../comum/calculo-equipes.js');

// Este módulo roda tanto no Node (testes) quanto embrulhado no navegador via
// buildBrowserBundle -- por isso 'var'/'function', não 'const'/arrow (ver o
// mesmo aviso em render-aba-semanal.js). O require acima está na forma que o
// Node resolve sem problema, mas ATENÇÃO pra quem ligar este módulo ao bundle
// (Task 10): a regex de transformaModulo em tools/comum/browser-bundle.js só
// reescreve `require('./arquivo.js')` (mesmo diretório); `../comum/...` não
// bate no padrão e ficaria um `require` literal no navegador -- ReferenceError
// em produção. Duas saídas possíveis: estender a regex pra aceitar `../`, ou
// reaproveitar o padrão de fonteParaCliente()/trechosParaCliente() que
// render-dashboard.js já usa pra injetar mediaEquipesPonderada como global
// antes deste módulo rodar (mesmo mecanismo, sem passar por MODULOS).

// Gráfico Balanço de massa: um gráfico por tipologia, uma linha por SUP. A
// base (linha central) é 'previsto' ou 'previstoInicial' -- Tendência NÃO
// entra, foi descartada explicitamente pelo dono do projeto. dimensao é
// 'volume' | 'financeiro' (a dimensão do desvio principal; equipes sempre
// entra à parte, como a barra laranja).

// mesVigente: só o mês vigenteIdx. acumuladoAteMes: de janeiro (0) até
// vigenteIdx, INCLUSIVE -- "acumulado até o mês" inclui o próprio mês
// corrente, mesma leitura que o resto do projeto já usa pra acumulados.
// s1..s4 devolvem null: a planilha semanal ainda não existe (mesma situação
// de Realizado/Tendência em render-aba-semanal.js) -- quando existir, esta
// função ganha os casos correspondentes.
function periodoParaIntervalo(periodo, vigenteIdx) {
  if (periodo === 'mesVigente') return { inicio: vigenteIdx, fim: vigenteIdx + 1 };
  if (periodo === 'acumuladoAteMes') return { inicio: 0, fim: vigenteIdx + 1 };
  return null;
}

// Soma um array mensal (12 posições, null onde a planilha de origem estava
// em branco) dentro de [intervalo.inicio, intervalo.fim). null quando não há
// intervalo (períodos s1..s4, ver periodoParaIntervalo) ou quando 'mensal'
// não é um array (dimensão ausente na linha de base -- ver achaBaseline).
function somarIntervalo(mensal, intervalo) {
  if (!intervalo || !Array.isArray(mensal)) return null;
  var soma = null;
  var ini = Math.max(0, intervalo.inicio), lim = Math.min(mensal.length, intervalo.fim);
  for (var i = ini; i < lim; i++) {
    if (mensal[i] === null || mensal[i] === undefined) continue;
    soma = (soma === null ? 0 : soma) + mensal[i];
  }
  return soma;
}

// Equipes é uma foto, não um fluxo -- média ponderada por dias
// (mediaEquipesPonderada, Task 4), nunca soma, mesma premissa em todo o
// projeto. null quando não há intervalo ou o array de equipes não existe.
function equipesNoIntervalo(mensal, intervalo) {
  if (!intervalo || !Array.isArray(mensal)) return null;
  return mediaEquipesPonderada(mensal, intervalo.inicio, intervalo.fim);
}

// Previsto Inicial é uma foto do início do projeto: procura por (sup,
// tipologia) exatos, não por índice de registro -- contratos que entraram
// depois simplesmente não têm entrada aqui (ver a regra de semBase abaixo).
function achaBaseline(baseline, sup, tipologia) {
  var lista = baseline || [];
  for (var i = 0; i < lista.length; i++) {
    var item = lista[i];
    if (item && item.sup === sup && item.tipologia === tipologia) return item;
  }
  return null;
}

function ehPositivo(v) {
  return typeof v === 'number' && v > 0;
}

// { registros, indices, tipologia, base, dimensao, periodo, vigenteIdx, baseline }
// -> uma linha por SUP presente em 'indices' cuja tipologia bate com
// 'tipologia'. A grade de origem é densa (todo SUP tem linha em toda
// tipologia, a maioria zerada) -- por isso NÃO existe agrupamento por SUP
// aqui: cada (SUP, tipologia) já é um registro só na MATRIZ.
function calcularLinhas({ registros, indices, tipologia, base, dimensao, periodo, vigenteIdx, baseline }) {
  var intervalo = periodoParaIntervalo(periodo, vigenteIdx);
  var linhas = [];

  (indices || []).forEach(function (i) {
    var registro = registros[i];
    if (!registro || registro.tipologia !== tipologia) return;

    var mensalPrevisto = registro.previsto && registro.previsto[dimensao];
    var mensalRealizado = registro.realizado && registro.realizado[dimensao];

    var previstoPeriodo = somarIntervalo(mensalPrevisto, intervalo);
    var realizadoPeriodo = somarIntervalo(mensalRealizado, intervalo);

    // Atividade é por (SUP, tipologia), sempre sobre Previsto/Realizado da
    // MATRIZ (nunca sobre a base escolhida) -- é o que faz o gráfico mostrar
    // só as linhas com movimento de verdade, em vez de 34 SUPs com barra de
    // comprimento zero. As colunas inicio/termino do registro (janela
    // contratual) NÃO servem pra isso, não dizem se houve movimento nesta
    // tipologia especificamente.
    var ativo = ehPositivo(previstoPeriodo) || ehPositivo(realizadoPeriodo);

    var valorBase = null, equipesBase = null, semBase = false;

    if (base === 'previstoInicial') {
      var entradaBaseline = achaBaseline(baseline, registro.sup, tipologia);
      if (!entradaBaseline) {
        // Base ausente NUNCA vira desvio zero: "não havia base" e "o
        // realizado bateu exatamente a base" são coisas opostas que
        // apareceriam idênticas se ambas virassem zero.
        semBase = true;
      } else {
        valorBase = somarIntervalo(entradaBaseline[dimensao], intervalo);
        equipesBase = equipesNoIntervalo(entradaBaseline.equipes, intervalo);
        if (valorBase === null) semBase = true;
      }
    } else {
      valorBase = previstoPeriodo;
      equipesBase = equipesNoIntervalo(registro.previsto && registro.previsto.equipes, intervalo);
    }

    var valorRealizado = realizadoPeriodo;
    var equipesRealizado = equipesNoIntervalo(registro.realizado && registro.realizado.equipes, intervalo);

    var desvio = (semBase || valorBase === null || valorRealizado === null) ? null : (valorRealizado - valorBase);
    var desvioEquipes = (semBase || equipesBase === null || equipesRealizado === null) ? null : (equipesRealizado - equipesBase);

    linhas.push({
      sup: registro.sup,
      valorBase: semBase ? null : valorBase,
      valorRealizado: valorRealizado,
      desvio: desvio,
      equipesBase: semBase ? null : equipesBase,
      equipesRealizado: equipesRealizado,
      desvioEquipes: desvioEquipes,
      ativo: ativo,
      semBase: semBase,
    });
  });

  return linhas;
}

// Decrescente pelo desvio COM SINAL: +100, +70, +15, -50, -72.
// Isso satisfaz as duas exigências ao mesmo tempo (do maior para o menor,
// positivos antes dos negativos) sem precisar particionar por sinal. Note
// que entre negativos o menos negativo vem primeiro -- ordenar por módulo
// aqui inverteria essa parte e contrariaria o combinado.
function ordenarPorDesvio(linhas) {
  return linhas.slice().sort(function (a, b) {
    if (a.desvio === null && b.desvio === null) return 0;
    if (a.desvio === null) return 1;   // sem base vai pro fim
    if (b.desvio === null) return -1;
    return b.desvio - a.desvio;
  });
}

module.exports = { calcularLinhas, ordenarPorDesvio };
