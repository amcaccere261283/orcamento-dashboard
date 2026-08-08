'use strict';
const { classificarDiaEquipe, contaComoAtiva } = require('./classificar-dia-equipe.js');
const { diaEpoch } = require('./compute-semanal.js');

// Equipes produtivas por (SUP, tipologia) e por dia, a partir de:
//   - Link 6 (planilha "Equipes", aba "AAAA - MÊS (EQ)"): roster do mês +
//     exclusão de dia (férias/baixada/desligada/afastada/atestado), via
//     classificarDiaEquipe/contaComoAtiva -- MESMA fonte e MESMA
//     classificação que compute-equipes-ativas.js já usa pra outro fim.
//   - Link 7 (campo/sondagens): quem produziu, em qual SUP+Tipo, cada dia.
// Ver docs/superpowers/specs/2026-08-08-troca-origem-realizado-demandas-equipes-design.md,
// seção "Equipes -- algoritmo".
const JANELA_FALLBACK_PADRAO = 45;

// linhasLink7 -> { [idSondador]: { [diaEpoch]: Set('SUP||Tipo') } } e
// { [idSondador]: [{ diaEpoch, sup, tipo }] ordenado por diaEpoch, pra achar
// "o último antes de X" no fallback.
function indexarLink7(linhasLink7) {
  const porSondadorDia = new Map(); // idSondador -> Map(diaEpoch -> Set('sup||tipo'))
  const historicoPorSondador = new Map(); // idSondador -> [{diaEpoch, sup, tipo}], ordenado

  for (const l of linhasLink7 || []) {
    if (!porSondadorDia.has(l.idSondador)) porSondadorDia.set(l.idSondador, new Map());
    const porDia = porSondadorDia.get(l.idSondador);
    if (!porDia.has(l.diaEpoch)) porDia.set(l.diaEpoch, new Set());
    porDia.get(l.diaEpoch).add(l.sup + '||' + l.tipo);

    if (!historicoPorSondador.has(l.idSondador)) historicoPorSondador.set(l.idSondador, []);
    historicoPorSondador.get(l.idSondador).push({ diaEpoch: l.diaEpoch, sup: l.sup, tipo: l.tipo });
  }
  for (const lista of historicoPorSondador.values()) lista.sort((a, b) => a.diaEpoch - b.diaEpoch);

  return { porSondadorDia, historicoPorSondador };
}

// Último registro do sondador com diaEpoch < diaAlvo e diaAlvo - diaEpoch <=
// janela (em dias). null se não achar nenhum.
function ultimoDentroDaJanela(historico, diaAlvo, janelaDias) {
  let melhor = null;
  for (const item of historico || []) {
    if (item.diaEpoch >= diaAlvo) break; // ordenado -- pode parar
    if (diaAlvo - item.diaEpoch <= janelaDias) melhor = item;
  }
  return melhor;
}

function agregarEquipesFracao(opcoes) {
  const o = opcoes || {};
  const equipes = o.equipes || [];
  const ano = o.ano;
  const mes = o.mes;
  const resolverSup = o.resolverSup || ((sup) => sup);
  const janelaFallbackDias = o.janelaFallbackDias || JANELA_FALLBACK_PADRAO;
  const { porSondadorDia, historicoPorSondador } = indexarLink7(o.linhasLink7);

  const porDia = {};
  let semLink7 = 0;
  const diasPorEstado = { mobilizada: 0, campoSemFuro: 0, fora: 0, naoEquipe: 0 };
  const textosNoDefault = {};

  function somar(sup, tipo, dia, fracao) {
    const chave = resolverSup(sup, tipo) + '||' + tipo;
    if (!porDia[chave]) porDia[chave] = {};
    porDia[chave][dia] = (porDia[chave][dia] || 0) + fracao;
  }

  for (const equipe of equipes) {
    const historico = historicoPorSondador.get(equipe.id) || [];
    for (const d of equipe.dias) {
      const classe = classificarDiaEquipe(d.texto);
      if (!classe) continue;
      diasPorEstado[classe.estado] += 1;
      if (classe.noDefault) textosNoDefault[d.texto] = (textosNoDefault[d.texto] || 0) + 1;
      if (!contaComoAtiva(classe.estado)) continue;

      const dia = diaEpoch(new Date(Date.UTC(ano, mes - 1, d.dia)));
      const combinacoesHoje = (porSondadorDia.get(equipe.id) || new Map()).get(dia);

      if (combinacoesHoje && combinacoesHoje.size) {
        const fracao = 1 / combinacoesHoje.size;
        for (const combinacao of combinacoesHoje) {
          const [sup, tipo] = combinacao.split('||');
          somar(sup, tipo, dia, fracao);
        }
        continue;
      }

      const ultimo = ultimoDentroDaJanela(historico, dia, janelaFallbackDias);
      if (ultimo) {
        somar(ultimo.sup, ultimo.tipo, dia, 1);
      } else {
        semLink7 += 1;
      }
    }
  }

  return { porDia, semLink7, diasPorEstado, textosNoDefault };
}

module.exports = { agregarEquipesFracao, JANELA_FALLBACK_PADRAO };
