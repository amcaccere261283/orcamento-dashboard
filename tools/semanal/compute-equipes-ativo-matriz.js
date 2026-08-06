'use strict';

// EQUIPES ATIVAS (headcount do roster) via o dashboard Matriz de Controle
// ============================================================================
// 2026-08-06, pedido do dono do projeto: o Realizado de Equipes da Tabela
// Semanal precisa bater com o "Ativas (total)" que o OUTRO dashboard deste
// repositório-mãe (tools/matriz/, publicado em suporte-infra-matriz-dashboard)
// já calcula -- não com produtivas/campoSemFuro (medida de atividade em
// campo, um conceito diferente: "quantas equipes trabalharam hoje" vs
// "quantas equipes a empresa tem ativas hoje", que é o que este número mede).
// Confirmado ao vivo: bate exato com https://.../historico.xlsx, "Ativas
// (total)" -- 85 em 01-02/08, 83,75 de média em 03-06/08.
//
// "Ativas (total)" vem de tools/matriz/compute-matriz.js (computeResumo,
// bucket 'atual') -- uma contagem de ROSTER baseada em data de admissão e
// flag mobilizada/desmobilizado, NÃO nas células de texto por dia da aba EQ
// que compute-equipes-ativas.js (deste projeto) já parseia -- por isso não
// dá pra reproduzir aqui sem reimplementar aquele pipeline inteiro (com o
// risco real de divergir dele em silêncio). Em vez disso, este módulo lê
// DIRETO o retrato diário que o Matriz já publica, sem CDP nem login -- é
// um JSON público, sem autenticação:
// https://amcaccere261283.github.io/suporte-infra-matriz-dashboard/historico.json
//
// Mesma redução de granularidade fina (~1 ponto a cada 2h) pra 1 valor por
// dia que tools/matriz/gerar-historico-excel.js já faz (pontosPorDia +
// dataLocalBrasilia) -- duplicada aqui de propósito: é pouca lógica, e um
// require cruzando pra fora de orcamento-dashboard seria mais frágil que
// replicar essas poucas linhas (mesmo raciocínio de chaveDemandas/
// chaveMatriz, já duplicados em vários módulos deste projeto).

// Desloca pro fuso de Brasília (UTC-3, sem horário de verão desde 2019) --
// um ponto às 02:00 UTC já é dia anterior em horário local.
function diaEpochDeIso(isoString) {
  const data = new Date(isoString);
  const local = new Date(data.getTime() - 3 * 60 * 60 * 1000);
  return Math.floor(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) / 86400000);
}

// historico: array de pontos { data: isoString, ativo: number, ... } --
// mesmo formato do historico.json publicado. Pega o ÚLTIMO ponto de cada
// dia (retrato de fim de dia), igual ao Matriz -- pra nunca divergir do
// "Ativas (total)" que aparece no historico.xlsx dele (o histórico chega em
// ordem cronológica, então o último ponto de cada dia sobrescreve os
// anteriores do mesmo dia).
//
// Devolve { diaEpoch: ativo }.
function agregarEquipesAtivoPorDia(historico) {
  const porDia = {};
  for (const ponto of historico || []) {
    if (!ponto || !ponto.data || typeof ponto.ativo !== 'number') continue;
    porDia[diaEpochDeIso(ponto.data)] = ponto.ativo;
  }
  return porDia;
}

module.exports = { agregarEquipesAtivoPorDia, diaEpochDeIso };
