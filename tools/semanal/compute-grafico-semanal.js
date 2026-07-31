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

module.exports = { calcularAcumulado, calcularEscalaEixo, GRAFICO_NUM_TICKS };
