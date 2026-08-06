'use strict';
const { classificarDiaEquipe } = require('./classificar-dia-equipe.js');

// EQUIPES NÃO PRODUTIVAS (2026-08-05)
// ============================================================================
// Mesma fonte que equipes ativas (aba EQ, via parseAbaEq -- já buscada hoje
// pelo build, nenhuma busca nova aqui). "Não produtiva" = campoSemFuro (em
// campo, sem furo aquele dia) OU fora (férias/baixada/afastada/desligada) --
// os dois estados que classificar-dia-equipe.js já reconhece.
// mobilizada (produtiva) e naoEquipe (não é equipe de campo) ficam de fora.
//
// Sem quebra por (SUP, tipologia): uma equipe de férias não tem contrato
// associado naquele dia -- só o total por dia, separado por motivo.

function agregarEquipesNaoProdutivas(opcoes) {
  const o = opcoes || {};
  const equipes = o.equipes || [];
  const ano = o.ano;
  const mes = o.mes;

  const porDiaPorMotivo = {};

  equipes.forEach((equipe) => {
    (equipe.dias || []).forEach((d) => {
      const classe = classificarDiaEquipe(d.texto);
      if (!classe) return;
      if (classe.estado !== 'campoSemFuro' && classe.estado !== 'fora') return;

      const diaEpoch = Math.floor(Date.UTC(ano, mes - 1, d.dia) / 86400000);
      if (!porDiaPorMotivo[diaEpoch]) porDiaPorMotivo[diaEpoch] = { campoSemFuro: 0, fora: 0 };
      porDiaPorMotivo[diaEpoch][classe.estado] += 1;
    });
  });

  return { porDiaPorMotivo };
}

module.exports = { agregarEquipesNaoProdutivas };
