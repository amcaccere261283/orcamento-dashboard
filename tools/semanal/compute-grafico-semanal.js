'use strict';

// Este módulo roda tanto no Node (testes) quanto embrulhado no navegador via
// buildBrowserBundle -- por isso 'var'/'function', não 'const'/arrow (mesmo
// aviso em compute-semanal.js/compute-balanco.js). Sem require nenhum: só
// matemática pura, independente de calendário (funciona igual pra 5 ou 6
// semanas, ou pros 12 meses do orçamento, se algum dia precisar).

// Soma corrida (semana 0 até a semana i) -- mesma convenção de
// somarIntervalo (compute-balanco.js) / somarArraysMensais (orçamento):
// null é "sem dado nessa semana", não zero -- não contribui pra soma, mas
// também não reseta o acumulado das semanas seguintes (o acumulado só fica
// null enquanto NENHUMA semana até ali teve dado real). Diferente do
// calcularAcumulado do orçamento (que trata null como 0 e nunca devolve
// null): lá o "mês sem dado" é um artefato de relatório ainda não lançado
// no meio do ano; aqui Previsto/Realizado/Tendência semanais nunca têm essa
// lacuna no meio -- ou a série inteira tem dado, ou nenhuma semana tem (ver
// calcularSeriesSemanaisDimensao, render-aba-semanal.js) -- e "sem dado
// nenhum" deve continuar null, não virar uma linha de zeros.
function calcularAcumulado(valores) {
  var soma = null;
  return (valores || []).map(function (v) {
    if (v !== null && v !== undefined) soma = (soma === null ? 0 : soma) + v;
    return soma;
  });
}

// --- Recorte das curvas acumuladas (2026-08-03) ----------------------------
// Porte do par calcularAcumuladoAposRealizado/cortarAcumuladoNoUltimoDado do
// orçamento (tools/orcamento/render-dashboard.js), com UMA diferença que vale
// registrar: lá o ponto de corte é DESCOBERTO nos valores (ultimoIndiceComDado
// mais removerZerosFinaisNaoReportados), porque a MATRIZ escreve 0 em mês não
// reportado e não existe jeito de distinguir isso de um zero real. Aqui existe
// calendário -- a semana em curso é a última elapsada, e nenhuma semana depois
// dela pode ter Realizado -- então o corte vem de `semanasElapsadas`, não de
// olhar o dado. Isso deixa passar ileso o caso real de uma semana já fechada
// ter terminado em 0 furos, que a heurística do orçamento cortaria fora.

// O acumulado de Realizado não continua reto até o fim do mês depois da última
// semana com dado: dali em diante é null. Uma linha horizontal ali diz "o
// total parou de crescer", quando o que houve foi só o mês ainda não ter
// chegado lá -- e semanasRealizado traz 0 (não null) nas semanas futuras de
// propósito, então sem este corte o acumulado ficaria mesmo flat.
function cortarAcumuladoNasElapsadas(acumulado, semanasElapsadas) {
  return (acumulado || []).map(function (v, i) { return i < semanasElapsadas ? v : null; });
}

// Acumulado da Tendência: em vez de correr desde a semana 1 por cima do
// Realizado (as semanas elapsadas da série completa SÃO o Realizado, ver
// calcularTendenciaSemanal), a curva nasce no ponto onde o Realizado parou e
// só sobe a partir da primeira semana ainda não começada. O ponto de junção --
// índice semanasElapsadas-1, a semana em curso -- recebe o acumulado da
// própria série completa até ali (soma de semanasCompletas[0..ancora]), NÃO o
// acumulado do Realizado bruto (achado de 2026-08-03, ver Tendência da semana
// vigente em render-aba-semanal.js): desde que a semana vigente passou a
// projetar seu PRÓPRIO total (Realizado parcial dela + ritmo nos dias que
// faltam, em vez de só o Realizado parcial), o valor de semanasCompletas no
// índice-âncora pode ser MAIOR que o Realizado bruto ali -- somar a partir do
// Realizado bruto, como antes, perderia essa parcela e o fim da curva ficava
// menor que o Fechamento da Tabela Semanal (quebra do invariante abaixo).
// Nas semanas TOTALMENTE fechadas antes da âncora, semanasCompletas já é
// idêntico ao Realizado bruto -- por isso este cálculo não muda nada quando
// não há projeção nenhuma acontecendo na semana vigente (ex.: hoje é o último
// dia dela, sem dias restantes pra projetar).
//
// O ponto final não muda com esse recorte: a soma de TODA a série completa é,
// por construção (calcularTendenciaSemanal), sempre o previstoMes do mês --
// o mesmo número da coluna Total da Tabela Semanal, invariante travado pela
// revisão de 2026-08-02 e por teste.
//
// Mês inteiramente futuro (semanasElapsadas 0): não há de onde partir, a série
// acumula sozinha desde a primeira semana, do jeito usual.
function calcularAcumuladoAposElapsadas(semanasCompletas, semanasElapsadas) {
  var valores = semanasCompletas || [];
  var ancora = semanasElapsadas - 1;
  if (ancora < 0) return calcularAcumulado(valores);

  var resultado = new Array(valores.length).fill(null);
  var soma = 0;
  for (var s = 0; s <= ancora; s++) soma += valores[s] || 0;
  resultado[ancora] = soma;
  for (var i = ancora + 1; i < valores.length; i++) {
    soma += valores[i] || 0;
    resultado[i] = soma;
  }
  return resultado;
}

// Arredonda o teto do eixo Y pro próximo degrau "limpo" -- MESMA função do
// orçamento (tools/orcamento/render-dashboard.js, calcularEscalaEixo),
// portada sem nenhuma mudança: é matemática pura sobre um valor máximo, não
// depende de quantos meses/semanas o gráfico tem. Ver o comentário lá sobre
// por que os degraus intermediários (1,5/2,5/3/4/6/8) existem, não só
// 1/2/5/10.
var GRAFICO_NUM_TICKS = 4;
var GRAFICO_DEGRAUS_ESCALA = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
function calcularEscalaEixo(valorMax) {
  if (!valorMax || valorMax <= 0) return { max: 1, passo: 0.25 };
  var passoBruto = valorMax / GRAFICO_NUM_TICKS;
  var magnitude = Math.pow(10, Math.floor(Math.log10(passoBruto)));
  var normalizado = passoBruto / magnitude;
  var passoNormalizado = GRAFICO_DEGRAUS_ESCALA.find(function (degrau) { return normalizado <= degrau; }) || 10;
  var passo = passoNormalizado * magnitude;
  return { max: passo * GRAFICO_NUM_TICKS, passo: passo };
}

module.exports = {
  calcularAcumulado, calcularEscalaEixo, GRAFICO_NUM_TICKS,
  cortarAcumuladoNasElapsadas, calcularAcumuladoAposElapsadas,
};
