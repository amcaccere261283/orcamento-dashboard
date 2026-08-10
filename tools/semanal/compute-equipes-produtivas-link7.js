'use strict';

// Equipes PRODUTIVAS por (SUP, tipologia) e por dia, direto do Link 7
// (campo/sondagens) -- sem depender do roster do Link 6. Pedido do dono do
// projeto em 2026-08-09: "adiciona as equipes produtivas mesmo, você
// encontra no link 7" -- o casamento por nome com o roster (compute-
// equipes-fracao.js, que só cobria ~20% por causa da inconsistência de
// nomes) ficou pra trás; a discussão de Equipes ATIVAS (quem está no
// roster mas não necessariamente produziu) fica pra depois.
//
// O ID da EQUIPE é a chave de agrupamento (a coluna "Nº Equipe" do Link 7,
// chamada "ID Sondador" até a renomeação de 2026-08-10) -- diferente do
// link por nome que
// compute-equipes-fracao.js precisava (pra casar com o roster do Link 6),
// aqui o ID só precisa ser consistente DENTRO do próprio Link 7 (mesma
// pessoa, mesmo ID, em todas as linhas dela), o que já é garantido pela
// fonte.
//
// Fração: sondador que produziu em N combinações SUP+Tipo distintas no
// mesmo dia conta 1/N em cada uma (mesma regra de compute-equipes-fracao.js
// -- múltiplas linhas na MESMA combinação não inflam o denominador, porque
// agrupamos por Set('sup||tipo') antes de fracionar).
function agregarEquipesProdutivas(linhasLink7) {
  const porEquipeDia = new Map(); // idEquipe -> Map(diaEpoch -> Set('sup||tipo'))

  for (const l of linhasLink7 || []) {
    if (!l.idEquipe) continue;
    if (!porEquipeDia.has(l.idEquipe)) porEquipeDia.set(l.idEquipe, new Map());
    const porDiaEquipe = porEquipeDia.get(l.idEquipe);
    if (!porDiaEquipe.has(l.diaEpoch)) porDiaEquipe.set(l.diaEpoch, new Set());
    porDiaEquipe.get(l.diaEpoch).add(l.sup + '||' + l.tipo);
  }

  const porDia = {};
  function somar(sup, tipo, dia, fracao) {
    const chave = sup + '||' + tipo;
    if (!porDia[chave]) porDia[chave] = {};
    porDia[chave][dia] = (porDia[chave][dia] || 0) + fracao;
  }

  for (const diasDaEquipe of porEquipeDia.values()) {
    for (const [dia, combinacoes] of diasDaEquipe) {
      const fracao = 1 / combinacoes.size;
      for (const combinacao of combinacoes) {
        const [sup, tipo] = combinacao.split('||');
        somar(sup, tipo, dia, fracao);
      }
    }
  }

  return { porDia };
}

module.exports = { agregarEquipesProdutivas };
