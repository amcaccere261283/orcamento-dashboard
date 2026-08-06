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
//
// TEXTO NO DEFAULT NÃO CONTA COMO "EM CAMPO SEM FURO" (correção de 2026-08-05).
// classificarDiaEquipe devolve {estado:'campoSemFuro', noDefault:true} para todo
// texto que não casou nenhuma das duas listas de exceção -- e isso é deliberado
// lá, porque o jeito de escrever "trabalhando" é cauda infinita (nome de
// rodovia, de tomador, de lugar: "CCR RioSP", "Via Mineira", "Em São Pedro" --
// 572 equipe-dia em 70 textos medidos em julho+agosto de 2026). Para "equipes
// ATIVAS" isso é inócuo: mobilizada e campoSemFuro contam como ativa dos dois
// jeitos. Aqui NÃO é: contar esses dias como "em campo sem furo" inflaria a
// não-produtividade com equipe que estava justamente produzindo.
//
// Só o campoSemFuro CATALOGADO (noDefault:false -- mobilização, veículo
// quebrado, chuva, parada de segurança, treinamento...) conta. O outro lado,
// 'fora' (férias/baixada/afastada/desligada), casa uma regex EXPLÍCITA e nunca
// é noDefault, então continua contando como sempre.

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
      // Ver o bloco "TEXTO NO DEFAULT" no topo: só 'campoSemFuro' catalogado
      // conta. 'fora' nunca é noDefault (regex explícita), mas o teste do
      // estado deixa a intenção óbvia em vez de depender disso.
      if (classe.estado === 'campoSemFuro' && classe.noDefault === true) return;

      const diaEpoch = Math.floor(Date.UTC(ano, mes - 1, d.dia) / 86400000);
      if (!porDiaPorMotivo[diaEpoch]) porDiaPorMotivo[diaEpoch] = { campoSemFuro: 0, fora: 0 };
      porDiaPorMotivo[diaEpoch][classe.estado] += 1;
    });
  });

  return { porDiaPorMotivo };
}

module.exports = { agregarEquipesNaoProdutivas };
