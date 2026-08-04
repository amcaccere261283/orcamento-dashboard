'use strict';

// "SUP ativo no período" -- a MESMA definição que o Balanço de massa já usava
// no seu checkbox próprio (compute-balanco.js: previsto positivo OU realizado
// positivo), extraída aqui em 2026-08-04 para virar filtro da página inteira.
//
// A atividade é medida no MÊS selecionado, nunca na semana: por semana, uma
// linha apareceria e sumiria a cada troca de semana, o que lê como defeito e
// não como filtro.
//
// Este módulo NÃO entra em indicesFiltrados (tools/comum/render-shell.js): os
// filtros de lá recortam por propriedade do registro (origem, categoria,
// tipologia, grupo, SUP) e não conhecem período nenhum. "Ativo" depende do mês
// que a aba está mostrando, então é estado compartilhado aplicado POR ABA.

function ehPositivo(v) { return typeof v === 'number' && v > 0; }

function valorDoMes(bloco, dimensao, mesIdx) {
  var mensal = bloco && bloco[dimensao];
  if (!Array.isArray(mensal)) return null;
  var v = mensal[mesIdx];
  return (v === null || v === undefined) ? null : v;
}

// Houve furo executado deste registro dentro do intervalo? É o que torna
// ativo um registro cuja linha na MATRIZ está zerada mas que produziu de fato
// -- o mesmo Avanço Sond que alimenta o Realizado das outras abas.
function teveFuroNoIntervalo(registro, demandas, intervaloEpoch) {
  if (!demandas || !demandas.porRegistroEventos || !intervaloEpoch) return false;
  var entrada = demandas.porRegistroEventos[registro.sup + '||' + registro.tipologia];
  var dias = entrada && entrada.sondagemRealizada;
  if (!Array.isArray(dias)) return false;
  for (var i = 0; i < dias.length; i++) {
    if (dias[i] >= intervaloEpoch.inicio && dias[i] <= intervaloEpoch.fim) return true;
  }
  return false;
}

function registroAtivo(registro, dimensao, mesIdx, demandas, intervaloEpoch) {
  if (!registro) return false;
  if (ehPositivo(valorDoMes(registro.previsto, dimensao, mesIdx))) return true;
  if (ehPositivo(valorDoMes(registro.realizado, dimensao, mesIdx))) return true;
  return teveFuroNoIntervalo(registro, demandas, intervaloEpoch);
}

function indicesAtivos(registros, indices, dimensao, mesIdx, demandas, intervaloEpoch) {
  return (indices || []).filter(function (i) {
    return registroAtivo(registros[i], dimensao, mesIdx, demandas, intervaloEpoch);
  });
}

module.exports = { indicesAtivos, registroAtivo };
