'use strict';

// Cruza roster (Link 6) + produção crua (Link 7) para o Realizado de
// Equipes da Tabela Semanal. Regra fechada com o dono do projeto em
// 2026-08-10 -- ver a spec
// docs/superpowers/specs/2026-08-10-equipes-realizado-roster-link6-link7-design.md.
//
// Bundle-safe (var/function): roda tanto no build (Node) quanto no
// live-refresh (navegador, via browser-bundle.js) -- mesmo padrão de
// compute-equipes-ativas.js.
var JANELA_FALLBACK_PADRAO = 45;

// "Ativa" = tudo exceto 'fora' (férias/baixada/folga) -- INCLUI 'naoEquipe'
// (contratação, admissão, encarregado, auxiliar), diferente de
// contaComoAtiva() em classificar-dia-equipe.js (que só conta mobilizada +
// campoSemFuro, e continua servindo Equipes Ativas/Não-produtivas sem
// mudar). Duas definições de "ativa" coexistem de propósito -- não
// unificar sem decisão do dono do projeto.
function ativaNaDefinicaoNova(estado) {
  return estado !== 'fora';
}

// producao -> { idEquipe -> { porDia: Map(diaEpoch -> Set('sup||tipo')), historico: [{diaEpoch,sup,tipo}] ordenado } }
function indexarProducao(producao) {
  var porEquipe = new Map();
  (producao || []).forEach(function (l) {
    if (!l.idEquipe) return;
    if (!porEquipe.has(l.idEquipe)) porEquipe.set(l.idEquipe, { porDia: new Map(), historico: [] });
    var entrada = porEquipe.get(l.idEquipe);
    if (!entrada.porDia.has(l.diaEpoch)) entrada.porDia.set(l.diaEpoch, new Set());
    entrada.porDia.get(l.diaEpoch).add(l.sup + '||' + l.tipo);
    entrada.historico.push({ diaEpoch: l.diaEpoch, sup: l.sup, tipo: l.tipo });
  });
  porEquipe.forEach(function (entrada) {
    entrada.historico.sort(function (a, b) { return a.diaEpoch - b.diaEpoch; });
  });
  return porEquipe;
}

// Último registro do histórico com diaEpoch < diaAlvo e dentro da janela.
// null se não achar. Assume histórico ORDENADO (indexarProducao garante).
function ultimoDentroDaJanela(historico, diaAlvo, janelaDias) {
  var melhor = null;
  for (var i = 0; i < (historico || []).length; i++) {
    var item = historico[i];
    if (item.diaEpoch >= diaAlvo) break;
    if (diaAlvo - item.diaEpoch <= janelaDias) melhor = item;
  }
  return melhor;
}

// opcoes.roster: [{idEquipe, diaEpoch, estado}]
// opcoes.producao: [{idEquipe, sup, tipo, diaEpoch}]
// opcoes.janelaFallbackDias: default 45
//
// Devolve { porDia, foraDaJanela, ativos }. porDia no MESMO formato que
// demandas.equipesPorDia já usa hoje: 'SUP||Tipo' -> {diaEpoch: fração}.
//
// Equipe ativa sem SUP nenhum pra alocar (nem produção hoje, nem
// carry-forward dentro da janela) NÃO é descartada: sua fração é
// redistribuída, no MESMO dia, proporcionalmente entre as combinações
// (SUP,tipo) que já têm alocação naquele dia -- decisão do dono do
// projeto em 2026-08-13, pra que o total do dia feche exatamente no total
// de ativas. Sem nenhuma combinação alocada naquele dia (todas as ativas do
// dia caíram fora da janela), não há onde redistribuir -- o dia fica sem
// registro nenhum, igual ao comportamento anterior. `foraDaJanela` continua
// contando quantas equipe-dia passaram por essa redistribuição.
function agregarEquipesRealizadoAlocado(opcoes) {
  var o = opcoes || {};
  var janela = typeof o.janelaFallbackDias === 'number' ? o.janelaFallbackDias : JANELA_FALLBACK_PADRAO;
  var porEquipeProducao = indexarProducao(o.producao);

  var porDia = {};
  function somar(sup, tipo, dia, fracao) {
    var chave = sup + '||' + tipo;
    if (!porDia[chave]) porDia[chave] = {};
    porDia[chave][dia] = (porDia[chave][dia] || 0) + fracao;
  }

  var ativos = 0;
  var foraDaJanela = 0;
  var semAlocacaoPorDia = new Map(); // diaEpoch -> quantidade de equipes sem SUP

  (o.roster || []).forEach(function (item) {
    if (!ativaNaDefinicaoNova(item.estado)) return;
    ativos++;

    var entradaEquipe = porEquipeProducao.get(item.idEquipe);
    var combinacoesHoje = entradaEquipe && entradaEquipe.porDia.get(item.diaEpoch);

    if (combinacoesHoje && combinacoesHoje.size) {
      var fracao = 1 / combinacoesHoje.size;
      combinacoesHoje.forEach(function (combinacao) {
        var partes = combinacao.split('||');
        somar(partes[0], partes[1], item.diaEpoch, fracao);
      });
      return;
    }

    var historico = entradaEquipe ? entradaEquipe.historico : [];
    var ultimo = ultimoDentroDaJanela(historico, item.diaEpoch, janela);
    if (ultimo) {
      somar(ultimo.sup, ultimo.tipo, item.diaEpoch, 1);
    } else {
      foraDaJanela++;
      semAlocacaoPorDia.set(item.diaEpoch, (semAlocacaoPorDia.get(item.diaEpoch) || 0) + 1);
    }
  });

  semAlocacaoPorDia.forEach(function (falta, dia) {
    var somaDia = 0;
    var chavesDoDia = [];
    Object.keys(porDia).forEach(function (chave) {
      if (porDia[chave][dia]) {
        somaDia += porDia[chave][dia];
        chavesDoDia.push(chave);
      }
    });
    if (somaDia <= 0) return; // nada alocado nesse dia -- nada onde redistribuir
    chavesDoDia.forEach(function (chave) {
      porDia[chave][dia] += falta * (porDia[chave][dia] / somaDia);
    });
  });

  return { porDia: porDia, foraDaJanela: foraDaJanela, ativos: ativos };
}

module.exports = { agregarEquipesRealizadoAlocado, ativaNaDefinicaoNova, JANELA_FALLBACK_PADRAO };
