'use strict';
const { classificarDiaEquipe, contaComoAtiva } = require('./classificar-dia-equipe.js');
const { diaEpoch } = require('./compute-semanal.js');
const { casarSondador } = require('./compute-equipes-ativas.js');

// SEM CONSUMIDOR a partir de 2026-08-09 -- não remover, ver por quê.
// `atualizar-equipes-online.js` parou de chamar este módulo: o dono do
// projeto pediu equipes PRODUTIVAS direto do Link 7 (sem roster), porque o
// casamento por nome daqui (Equipe do Link 6 vs Líder do Link 7) só cobria
// ~20% do roster -- ver compute-equipes-produtivas-link7.js, que substituiu
// este módulo nessa função. Este arquivo fica guardado porque a lógica de
// ROSTER (quem está ativo no mês, mesmo sem produzir -- férias/baixada/
// exclusão de dia via classificarDiaEquipe) é exatamente o que "Equipes
// ATIVAS" vai precisar quando essa conversa for retomada com o usuário.
//
// Equipes produtivas por (SUP, tipologia) e por dia, a partir de:
//   - Link 6 (planilha "Equipes", aba "AAAA - MÊS (EQ)"): roster do mês +
//     exclusão de dia (férias/baixada/desligada/afastada/atestado), via
//     classificarDiaEquipe/contaComoAtiva -- MESMA fonte e MESMA
//     classificação que compute-equipes-ativas.js já usa pra outro fim.
//   - Link 7 (campo/sondagens): quem produziu, em qual SUP+Tipo, cada dia.
// Ver docs/superpowers/specs/2026-08-08-troca-origem-realizado-demandas-equipes-design.md,
// seção "Equipes -- algoritmo".
//
// LINK POR NOME, NÃO POR ID (achado rodando o pipeline de verdade em
// 2026-08-08): a coluna "ID" do Link 6 é um ID de EQUIPE (números pequenos,
// "4", "59"...), e "ID Sondador" do Link 7 é um ID de PESSOA (números bem
// maiores, "3275", "1390"...) -- são dois sistemas de ID diferentes, com
// interseção de 1 em 105 IDs medida ao vivo. O dono do projeto pediu pra
// casar pelo NOME em vez disso: o nome da equipe (coluna "Equipe" do Link 6,
// que é o nome do líder) contra o nome do "Líder" de cada linha do Link 7 --
// reaproveitando casarSondador (compute-equipes-ativas.js), que já resolve
// exatamente esse tipo de casamento (nome curto vs nome completo) pra outra
// fonte. Ajuste temporário, o dono do projeto sinalizou que vai revisar esse
// link depois.
const JANELA_FALLBACK_PADRAO = 45;

// linhasLink7 -> { [lider]: { [diaEpoch]: Set('SUP||Tipo') } } e
// { [lider]: [{ diaEpoch, sup, tipo }] ordenado por diaEpoch, pra achar
// "o último antes de X" no fallback. Também devolve a lista de nomes de
// líder distintos, pra casarSondador ter candidatos.
function indexarLink7(linhasLink7) {
  const porSondadorDia = new Map(); // lider -> Map(diaEpoch -> Set('sup||tipo'))
  const historicoPorSondador = new Map(); // lider -> [{diaEpoch, sup, tipo}], ordenado
  const lideresDistintos = new Set();

  for (const l of linhasLink7 || []) {
    if (!l.lider) continue;
    lideresDistintos.add(l.lider);
    if (!porSondadorDia.has(l.lider)) porSondadorDia.set(l.lider, new Map());
    const porDia = porSondadorDia.get(l.lider);
    if (!porDia.has(l.diaEpoch)) porDia.set(l.diaEpoch, new Set());
    porDia.get(l.diaEpoch).add(l.sup + '||' + l.tipo);

    if (!historicoPorSondador.has(l.lider)) historicoPorSondador.set(l.lider, []);
    historicoPorSondador.get(l.lider).push({ diaEpoch: l.diaEpoch, sup: l.sup, tipo: l.tipo });
  }
  for (const lista of historicoPorSondador.values()) lista.sort((a, b) => a.diaEpoch - b.diaEpoch);

  return { porSondadorDia, historicoPorSondador, lideresDistintos: [...lideresDistintos] };
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
  const { porSondadorDia, historicoPorSondador, lideresDistintos } = indexarLink7(o.linhasLink7);

  const porDia = {};
  let semLink7 = 0;
  let semNomeCasado = 0;
  const diasPorEstado = { mobilizada: 0, campoSemFuro: 0, fora: 0, naoEquipe: 0 };
  const textosNoDefault = {};

  function somar(sup, tipo, dia, fracao) {
    const chave = resolverSup(sup, tipo) + '||' + tipo;
    if (!porDia[chave]) porDia[chave] = {};
    porDia[chave][dia] = (porDia[chave][dia] || 0) + fracao;
  }

  for (const equipe of equipes) {
    // Casamento por NOME (não por ID -- ver comentário no topo do arquivo):
    // o nome da equipe (líder) é comparado contra os nomes de "Líder" que
    // aparecem no Link 7. null quando não acha ou acha mais de um -- essa
    // equipe cai no mesmo tratamento de "sem produção" (fallback, depois
    // fora da conta), sem inventar um casamento ambíguo.
    const nomeResolvido = casarSondador(equipe.nome, lideresDistintos);
    if (!nomeResolvido) semNomeCasado += 1;
    const historico = nomeResolvido ? (historicoPorSondador.get(nomeResolvido) || []) : [];
    for (const d of equipe.dias) {
      const classe = classificarDiaEquipe(d.texto);
      if (!classe) continue;
      diasPorEstado[classe.estado] += 1;
      if (classe.noDefault) textosNoDefault[d.texto] = (textosNoDefault[d.texto] || 0) + 1;
      if (!contaComoAtiva(classe.estado)) continue;

      const dia = diaEpoch(new Date(Date.UTC(ano, mes - 1, d.dia)));
      const combinacoesHoje = nomeResolvido
        ? (porSondadorDia.get(nomeResolvido) || new Map()).get(dia)
        : undefined;

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

  return { porDia, semLink7, semNomeCasado, diasPorEstado, textosNoDefault };
}

module.exports = { agregarEquipesFracao, JANELA_FALLBACK_PADRAO };
