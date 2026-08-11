'use strict';
const { DIAS_PREMISSA_MES } = require('../comum/calculo-equipes.js');
const { COLUNAS_ALOCACAO } = require('./equipes-alocaveis.js');
const { calcularSeriesSemanaisDimensao, pendentesNaData } = require('./render-aba-semanal.js');
const { premissaProdutividadeDoGrupo } = require('./render-alertas-tendencia.js');
const { diasNaSemana, indiceSemanaAtual } = require('./compute-semanal.js');

// Módulo dual (Node + navegador). O require de '../comum/' acima é REMOVIDO
// pelo bundler (transformaModulo, tools/comum/browser-bundle.js): no navegador
// DIAS_PREMISSA_MES chega como global pelo <script> de fonteParaCliente(), que
// já é injetado ANTES do bundle. No Node o require resolve normalmente.
//
// A CONTA DA ALOCAÇÃO
// ===========================================================================
// Ver docs/superpowers/specs/2026-08-10-semanal-alocacao-equipes-design.md,
// Decisão 3.

var FAIXA_OCUPACAO = { folga: 0.85, sobrecarga: 1.05 };

// A premissa de dias úteis do mês (30, ou 15 em Jan/Dez) recortada na fração
// da semana que a equipe está disponível. Dias de CALENDÁRIO aqui fariam esta
// conta discordar da coluna "Produtividade média esperada" do Consolidado, que
// é a mesma premissa vista de outro ângulo -- mesmo raciocínio de
// diasPremissaRestantes (compute-alertas-tendencia.js).
//
// diasDoMes é a soma de diasNaSemana sobre as semanas do mês (o mesmo
// diasDoMesNasSemanas de render-alertas-tendencia.js), NÃO os dias do
// calendário: as semanas são sempre cortadas dentro do mês, e os dois só
// coincidem por acidente.
function diasPremissaDaSemana(mesIdx, diasDisponiveis, diasDoMes) {
  var premissa = DIAS_PREMISSA_MES[mesIdx];
  if (!premissa || !diasDoMes || !diasDisponiveis) return 0;
  return premissa * diasDisponiveis / diasDoMes;
}

// null (não zero) quando não há premissa de produtividade: zero leria como
// "esta equipe não produz", e a verdade é "não sei". A tela mostra "sem dado".
function capacidadeDaEquipe(equipe, premissaProd, mesIdx, diasDoMes) {
  if (premissaProd === null || premissaProd === undefined) return null;
  var dias = diasPremissaDaSemana(mesIdx, (equipe && equipe.diasDisponiveis) || 0, diasDoMes);
  return premissaProd * dias;
}

// Reparte a demanda da célula entre as equipes que estão nela, PROPORCIONAL à
// capacidade de cada uma. Com todo mundo inteiro na semana as capacidades são
// iguais (mesma célula => mesma premissa) e isto degenera em divisão igual,
// como deve; com uma equipe de 3 de 5 dias, ela puxa menos.
function ratearCarga(tendencia, capacidades) {
  var lista = capacidades || [];
  var total = 0;
  var i;
  for (i = 0; i < lista.length; i++) total += lista[i] || 0;
  if (!total) return lista.map(function () { return 0; });
  return lista.map(function (c) { return tendencia * (c || 0) / total; });
}

function classificarOcupacao(ocupacao) {
  if (ocupacao === null || ocupacao === undefined || ocupacao <= 0) return 'livre';
  if (ocupacao < FAIXA_OCUPACAO.folga) return 'folga';
  if (ocupacao <= FAIXA_OCUPACAO.sobrecarga) return 'equilibrada';
  return 'sobrecarregada';
}

// A data-âncora da semana. Semana já começada: o INÍCIO dela -- é o que
// congela a Tendência (calcularSeriesSemanaisDimensao recomputada com
// hojeEpoch = semana.inicio faz aquela semana virar a vigente, devolvendo a
// projeção que se fazia para ela inteira ao começar; mesmo mecanismo da aba
// Consolidado). Semana futura: não há nada a congelar, usa hoje.
//
// A CARTEIRA usa a MESMA âncora. Tendência de segunda-feira somada a carteira
// de hoje daria um saldo que não fecha com nada.
function ancoraDaSemana(semana, hojeEpoch) {
  if (!semana || typeof hojeEpoch !== 'number') return hojeEpoch;
  return semana.inicio <= hojeEpoch ? semana.inicio : hojeEpoch;
}

function diasDoMesNasSemanas(semanas) {
  var total = 0;
  for (var i = 0; i < (semanas || []).length; i++) total += diasNaSemana(semanas[i]);
  return total;
}

// Índices de registros por (sup, coluna) -- a coluna cobre 1 ou 3 tipologias
// da MATRIZ (ver COLUNAS_ALOCACAO).
function indicesPorCelula(registros, indices) {
  var mapa = {};
  (indices || []).forEach(function (i) {
    var r = registros[i];
    if (!r || !r.sup) return;
    for (var c = 0; c < COLUNAS_ALOCACAO.length; c++) {
      if (COLUNAS_ALOCACAO[c].tipologias.indexOf(r.tipologia) === -1) continue;
      var chave = r.sup + '||' + COLUNAS_ALOCACAO[c].id;
      if (!mapa[chave]) mapa[chave] = [];
      mapa[chave].push(i);
      break;
    }
  });
  return mapa;
}

// A tendência da célula naquela semana, já travada pela âncora.
function tendenciaDaCelula(registros, indicesCelula, o, ancoraEpoch) {
  if (!indicesCelula || !indicesCelula.length) return 0;
  var series = calcularSeriesSemanaisDimensao(
    registros, indicesCelula, 'volume', o.mesIdx, o.semanas, o.semanas.length,
    true, indiceSemanaAtual(o.semanas, ancoraEpoch), o.demandas, ancoraEpoch
  );
  var idx = o.semanas.indexOf(o.semana);
  var valor = series.semanasTendenciaCompleta && series.semanasTendenciaCompleta[idx];
  return valor === null || valor === undefined ? 0 : valor;
}

// registros/indices: os de sempre. opcoes:
//   { mesIdx, ano, semanas, semana, demandas, equipes, alocacao, hojeEpoch }
//   alocacao: { equipeId: { sup, coluna } }
function montarGradeAlocacao(registros, indices, opcoes) {
  var o = opcoes || {};
  var ancoraEpoch = ancoraDaSemana(o.semana, o.hojeEpoch);
  var diasDoMes = diasDoMesNasSemanas(o.semanas);
  var porCelula = indicesPorCelula(registros, indices);
  var alocacao = o.alocacao || {};
  var equipesPorId = {};
  (o.equipes || []).forEach(function (e) { equipesPorId[e.id] = e; });

  // Equipes alocadas, por célula.
  var equipesNaCelula = {};
  Object.keys(alocacao).forEach(function (id) {
    var destino = alocacao[id];
    if (!destino || !destino.sup || !destino.coluna) return;
    var chave = destino.sup + '||' + destino.coluna;
    if (!equipesNaCelula[chave]) equipesNaCelula[chave] = [];
    equipesNaCelula[chave].push(id);
  });

  var supsComAlgo = {};
  var colunasComAlgo = {};
  var celulas = {};

  var chavesCandidatas = {};
  Object.keys(porCelula).forEach(function (k) { chavesCandidatas[k] = true; });
  Object.keys(equipesNaCelula).forEach(function (k) { chavesCandidatas[k] = true; });

  Object.keys(chavesCandidatas).forEach(function (chave) {
    var partes = chave.split('||');
    var sup = partes[0];
    var coluna = partes[1];
    var indicesCelula = porCelula[chave] || [];
    var tendencia = tendenciaDaCelula(registros, indicesCelula, o, ancoraEpoch);
    var carteira = indicesCelula.length
      ? pendentesNaData(registros, indicesCelula, o.demandas, ancoraEpoch) : 0;
    var ids = equipesNaCelula[chave] || [];
    var premissaProd = indicesCelula.length
      ? premissaProdutividadeDoGrupo(registros, indicesCelula, o.mesIdx) : null;

    var capacidades = ids.map(function (id) {
      return capacidadeDaEquipe(equipesPorId[id] || { diasDisponiveis: 0 }, premissaProd, o.mesIdx, diasDoMes) || 0;
    });
    var capacidadeAlocada = capacidades.reduce(function (a, b) { return a + b; }, 0);

    // Célula sem tendência, sem carteira e sem equipe não existe.
    if (!tendencia && !carteira && !ids.length) return;

    celulas[chave] = {
      sup: sup, coluna: coluna, indices: indicesCelula,
      tendencia: tendencia, carteira: carteira,
      equipes: ids, capacidades: capacidades,
      capacidadeAlocada: capacidadeAlocada,
      saldo: capacidadeAlocada - tendencia,
      premissaProd: premissaProd,
    };
    supsComAlgo[sup] = true;
    colunasComAlgo[coluna] = true;
  });

  var colunas = COLUNAS_ALOCACAO.filter(function (c) { return colunasComAlgo[c.id]; });

  // O diagnóstico do SUP INTEIRO -- é ele que decide a ordem, e ele NÃO
  // depende da alocação: por isso as linhas não pulam durante o arrasto.
  var linhas = Object.keys(supsComAlgo).map(function (sup) {
    var indicesSup = (indices || []).filter(function (i) {
      return registros[i] && registros[i].sup === sup;
    });
    var series = indicesSup.length ? calcularSeriesSemanaisDimensao(
      registros, indicesSup, 'volume', o.mesIdx, o.semanas, o.semanas.length,
      true, indiceSemanaAtual(o.semanas, ancoraEpoch), o.demandas, ancoraEpoch
    ) : null;
    var minhasCelulas = {};
    colunas.forEach(function (c) {
      var celula = celulas[sup + '||' + c.id];
      if (celula) minhasCelulas[c.id] = celula;
    });
    var tendenciaSup = 0;
    Object.keys(minhasCelulas).forEach(function (k) { tendenciaSup += minhasCelulas[k].tendencia; });
    var registroDoSup = registros[indicesSup[0]];
    return {
      sup: sup,
      tomador: (registroDoSup && registroDoSup.tomador) || '',
      ramo: (series && series.ramoTendencia) || 'sem-dado',
      diagnostico: (series && series.diagnosticoTendencia) || null,
      tendencia: tendenciaSup,
      celulas: minhasCelulas,
    };
  });

  // Ordem: R<P (por saldo decrescente) -> R≈P -> R>P -> sem tendência.
  var PESO_RAMO = { abaixo: 0, igual: 1, acima: 2 };
  linhas.sort(function (a, b) {
    var semA = a.tendencia > 0 ? 0 : 1;
    var semB = b.tendencia > 0 ? 0 : 1;
    if (semA !== semB) return semA - semB;
    var pa = PESO_RAMO[a.ramo] === undefined ? 3 : PESO_RAMO[a.ramo];
    var pb = PESO_RAMO[b.ramo] === undefined ? 3 : PESO_RAMO[b.ramo];
    if (pa !== pb) return pa - pb;
    var sa = (a.diagnostico && a.diagnostico.saldo) || 0;
    var sb = (b.diagnostico && b.diagnostico.saldo) || 0;
    if (sa !== sb) return sb - sa;
    return a.sup < b.sup ? -1 : (a.sup > b.sup ? 1 : 0);
  });
  linhas.forEach(function (l, i) { l.ordem = i + 1; });

  return { colunas: colunas, linhas: linhas, ancoraEpoch: ancoraEpoch, diasDoMes: diasDoMes };
}

// As seis leituras por SUP, na ordem em que são avaliadas -- a PRIMEIRA que
// casa vence. Sem a ordem explícita, um SUP com tendência 0, carteira alta e
// uma equipe solta ali casaria com duas ao mesmo tempo.
//
// 'sem-demanda' é a 6ª, acrescentada depois da leitura original de 5 (ver
// docs/superpowers/specs/2026-08-10-semanal-alocacao-equipes-design.md): a
// linha só existe no quadro por causa de uma equipe alocada (ver
// montarGradeAlocacao, `!tendencia && !carteira && !ids.length` poda a
// célula), então tendência = 0 e carteira = 0 juntas SEMPRE significam
// "equipe parada aqui, sem nada pra fazer" -- nunca "absorvido" (que promete
// demanda sendo atendida) nem uma linha que não deveria existir.
var LEITURAS_SUP = [
  'parado-com-carteira', 'sem-equipe', 'falta-equipe', 'antecipar', 'absorvido', 'sem-demanda',
];

function leituraDoSup(tendencia, carteira, capacidadeAlocada, temEquipe) {
  var saldo = capacidadeAlocada - tendencia;
  if (!tendencia && carteira > 0) return 'parado-com-carteira';
  if (tendencia > 0 && !temEquipe) return 'sem-equipe';
  if (saldo < 0) return 'falta-equipe';
  if (saldo > 0 && carteira > 0) return 'antecipar';
  // 'absorvido' promete tendência sendo coberta -- sem tendência não há o
  // que absorver. A guarda `tendencia > 0` foi a correção do bug: antes
  // disso, tendência = 0 E carteira = 0 (com equipe alocada, único jeito da
  // linha existir -- ex.: célula "hatched" sem registro na MATRIZ que uma
  // rodada de auto-seed ocupou) caía aqui e lia verde por engano.
  if (tendencia > 0) return 'absorvido';
  return 'sem-demanda';
}

// grade: o retorno de montarGradeAlocacao. opcoes: { equipes, mesIdx }
function resumirAlocacao(grade, opcoes) {
  var o = opcoes || {};
  var equipes = o.equipes || [];
  var diasDoMes = grade.diasDoMes;
  var equipesPorId = {};
  equipes.forEach(function (e) { equipesPorId[e.id] = e; });

  // --- carga por equipe, célula a célula ---
  var cargaPorEquipe = {};
  var celulaPorEquipe = {};
  var capacidadePorEquipe = {};
  grade.linhas.forEach(function (linha) {
    Object.keys(linha.celulas).forEach(function (colunaId) {
      var celula = linha.celulas[colunaId];
      var partes = ratearCarga(celula.tendencia, celula.capacidades);
      var semRegistro = celula.premissaProd === null || celula.premissaProd === undefined;
      celula.equipes.forEach(function (id, i) {
        cargaPorEquipe[id] = (cargaPorEquipe[id] || 0) + partes[i];
        // Correção: célula sem registro na MATRIZ (hatched, "antecipar
        // carteira") tem premissaProd null, e montarGradeAlocacao já
        // mascarou celula.capacidades[i] em 0 (capacidadeDaEquipe(...) || 0)
        // porque não tem premissa nenhuma para multiplicar. Herdar esse 0
        // aqui reportaria "capacidade zero" para uma equipe que só não tem
        // registro de referência -- usa a capacidade de referência dela.
        capacidadePorEquipe[id] = semRegistro
          ? capacidadeDeReferencia(grade, equipesPorId[id] || {}, o.mesIdx, diasDoMes)
          : celula.capacidades[i];
        celulaPorEquipe[id] = { sup: celula.sup, coluna: celula.coluna };
      });
    });
  });

  var porEquipe = equipes.map(function (e) {
    if (!e.disponivel) {
      return {
        id: e.id, lider: e.lider, colunas: e.colunas, sup: null, coluna: null,
        carga: null, capacidade: null, ocupacao: null, situacao: 'fora',
      };
    }
    var destino = celulaPorEquipe[e.id] || null;
    var capacidade = capacidadePorEquipe[e.id];
    if (capacidade === undefined || capacidade === null) {
      // Não alocada: a capacidade de referência sai da premissa MÉDIA das
      // colunas dela na grade, para a tabela não mostrar '—' em toda equipe
      // livre. Sem nenhuma célula da coluna dela na grade, fica null.
      capacidade = capacidadeDeReferencia(grade, e, o.mesIdx, diasDoMes);
    }
    var carga = cargaPorEquipe[e.id] || 0;
    var ocupacao = capacidade ? carga / capacidade : null;
    // Correção: equipe COM destino nunca reporta 'livre' -- numa célula
    // hatched a tendência é 0, a carga rateada é 0 e classificarOcupacao(0)
    // devolveria 'livre', que é falso para quem está alocada. 'livre' fica
    // reservado a quem não tem destino nenhum; o mínimo de quem tem é 'folga'.
    var situacaoBruta = classificarOcupacao(ocupacao);
    var situacao = destino
      ? (situacaoBruta === 'livre' ? 'folga' : situacaoBruta)
      : 'livre';
    return {
      id: e.id, lider: e.lider, colunas: e.colunas,
      sup: destino ? destino.sup : null,
      coluna: destino ? destino.coluna : null,
      carga: carga, capacidade: capacidade, ocupacao: ocupacao,
      situacao: situacao,
    };
  });

  // --- avisos por célula, com a condição ---
  // Uma coluna tem "equipe livre" quando existe equipe DISPONÍVEL daquela
  // coluna com ocupação abaixo de 100% (no pool ou alocada com folga).
  var temLivrePorColuna = {};
  porEquipe.forEach(function (e) {
    if (e.situacao === 'fora') return;
    if (e.ocupacao !== null && e.ocupacao >= 1) return;
    (e.colunas || []).forEach(function (c) { temLivrePorColuna[c] = true; });
  });

  var avisos = {};
  grade.linhas.forEach(function (linha) {
    Object.keys(linha.celulas).forEach(function (colunaId) {
      var celula = linha.celulas[colunaId];
      if (!(celula.carteira > 0)) return;
      if (celula.saldo < 0) return;
      avisos[celula.sup + '||' + colunaId] = temLivrePorColuna[colunaId] ? 'aceso' : 'mudo';
    });
  });

  // --- resumo por SUP ---
  var porSup = grade.linhas.map(function (linha) {
    var tendencia = 0;
    var carteira = 0;
    var capacidadeAlocada = 0;
    var temEquipe = false;
    Object.keys(linha.celulas).forEach(function (k) {
      var c = linha.celulas[k];
      tendencia += c.tendencia;
      carteira += c.carteira;
      capacidadeAlocada += c.capacidadeAlocada;
      if (c.equipes.length) temEquipe = true;
    });
    return {
      sup: linha.sup, tomador: linha.tomador, ramo: linha.ramo, ordem: linha.ordem,
      tendencia: tendencia, carteira: carteira,
      capacidadeAlocada: capacidadeAlocada,
      saldo: capacidadeAlocada - tendencia,
      cobertura: tendencia ? capacidadeAlocada / tendencia : null,
      // Sem tendência não há ritmo, e sem ritmo não há prazo: null, nunca 0
      // (0 leria como "a carteira seca esta semana", o oposto da verdade).
      semanasDeCarteira: tendencia ? carteira / tendencia : null,
      leitura: leituraDoSup(tendencia, carteira, capacidadeAlocada, temEquipe),
    };
  });

  // --- totais (a faixa do topo) ---
  var totais = { tendencia: 0, capacidadeAlocada: 0, carteira: 0, capacidadeOciosa: 0, equipesAlocadas: 0 };
  porSup.forEach(function (s) {
    totais.tendencia += s.tendencia;
    totais.capacidadeAlocada += s.capacidadeAlocada;
    totais.carteira += s.carteira;
  });
  porEquipe.forEach(function (e) {
    if (e.situacao === 'fora') return;
    // Contar como "alocada" só depende de ter destino -- não de a capacidade
    // ser conhecida. Uma equipe posta numa coluna sem NENHUM registro na
    // MATRIZ (capacidadeDeReferencia sem nada pra ponderar) tem
    // capacidade null, mas ela TEM sup e coluna: sumir da contagem do topo
    // seria a página dizer "0 equipes alocadas" com uma equipe visivelmente
    // arrastada pra dentro do quadro.
    if (e.sup) totais.equipesAlocadas += 1;
    // capacidadeOciosa é outra conta: não dá pra somar folga de uma
    // capacidade que não se conhece, então essa parte SIM pula quando
    // capacidade é null.
    if (e.capacidade === null) return;
    // Equipe sobrecarregada contribui ZERO, nunca negativo: a folga de umas
    // mascararia o excesso de outras e o número do topo mentiria.
    var folga = e.capacidade - e.carga;
    if (folga > 0) totais.capacidadeOciosa += folga;
  });
  totais.saldo = totais.capacidadeAlocada - totais.tendencia;

  return { porSup: porSup, porEquipe: porEquipe, avisos: avisos, totais: totais };
}

// A premissa média das colunas da equipe entre as células da grade, ponderada
// pela tendência -- só para dar uma capacidade de referência à equipe que ainda
// não foi alocada.
function capacidadeDeReferencia(grade, equipe, mesIdx, diasDoMes) {
  var somaPeso = 0;
  var somaPonderada = 0;
  grade.linhas.forEach(function (linha) {
    Object.keys(linha.celulas).forEach(function (colunaId) {
      if ((equipe.colunas || []).indexOf(colunaId) === -1) return;
      var celula = linha.celulas[colunaId];
      if (celula.premissaProd === null || celula.premissaProd === undefined) return;
      var peso = celula.tendencia || 1;
      somaPeso += peso;
      somaPonderada += peso * celula.premissaProd;
    });
  });
  if (!somaPeso) return null;
  return capacidadeDaEquipe(equipe, somaPonderada / somaPeso, mesIdx, diasDoMes);
}

module.exports = {
  FAIXA_OCUPACAO, diasPremissaDaSemana, capacidadeDaEquipe, ratearCarga, classificarOcupacao,
  montarGradeAlocacao, ancoraDaSemana,
  resumirAlocacao, leituraDoSup, LEITURAS_SUP,
};
