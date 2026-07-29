'use strict';
const { mediaEquipesPonderada } = require('../comum/calculo-equipes.js');

// Este módulo roda tanto no Node (testes) quanto embrulhado no navegador via
// buildBrowserBundle -- por isso 'var'/'function', não 'const'/arrow (ver o
// mesmo aviso em render-aba-semanal.js).
//
// O require acima é de um arquivo FORA do diretório que buildBrowserBundle
// concatena (tools/comum/, não tools/semanal/) -- a regex de transformaModulo
// em tools/comum/browser-bundle.js foi estendida pra reconhecer esse padrão e
// simplesmente REMOVER a linha no bundle (não vira MODULOS['...']: calculo-
// equipes.js não pode ser bundlado como um MODULOS comum porque importa o
// módulo node:fs no próprio topo, usado só por trechosParaCliente()/
// fonteParaCliente() -- ver o comentário de transformaModulo). Quem monta a
// página (Task 10, em render-semanal.js) precisa injetar fonteParaCliente()
// (mesmo mecanismo que tools/orcamento/render-dashboard.js já usa pra este
// MESMO módulo) num <script> ANTES do bundle que contém compute-balanco.js,
// pra que `mediaEquipesPonderada` já exista como função global quando este
// código rodar. No Node (testes) o require funciona normalmente, sem
// depender de nada disso -- ver a prova em
// test/comum-browser-bundle.test.js ("compute-balanco.js bundlado...").

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

// Previsto Inicial é uma foto do início do projeto: procura por uma "chave"
// exata (sup + '||' + tipologia) -- MESMA convenção de
// tools/orcamento/parse-baseline.js (`${sup}||${tipologia}` como chave do
// Map) e de baselineParaCliente em tools/semanal/build-dashboard.js, que
// serializa esse Map como `{ chave, equipes, volume, financeiro }` (porque
// JSON.stringify não sabe serializar Map -- ver o comentário lá). Contratos
// que entraram depois do estudo original simplesmente não têm chave aqui
// (ver a regra de semBase abaixo).
function chaveBaseline(sup, tipologia) {
  return sup + '||' + tipologia;
}

function achaBaseline(baseline, sup, tipologia) {
  var chave = chaveBaseline(sup, tipologia);
  var lista = baseline || [];
  for (var i = 0; i < lista.length; i++) {
    var item = lista[i];
    if (item && item.chave === chave) return item;
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
