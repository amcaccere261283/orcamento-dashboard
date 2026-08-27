'use strict';
const { parseAbaEq, linhasDaAbaEq } = require('./compute-equipes-ativas.js');
const { classificarDiaEquipe, contaComoAtiva } = require('./classificar-dia-equipe.js');
const { agruparPorVeiculo } = require('./grupos-veiculo.js');
const { parsePessoasAtivas } = require('./pessoas-ativas.js');

// Este módulo roda no Node (build/testes) e no navegador (bundle) -- por isso
// 'var'/'function' e os requires acima na forma EXATA que transformaModulo
// (tools/comum/browser-bundle.js) reconhece.
//
// DO ROSTER DA ABA EQ PARA AS EQUIPES DO QUADRO
// ===========================================================================
// Ver docs/superpowers/specs/2026-08-10-semanal-alocacao-equipes-design.md,
// Decisão 1.

// As colunas do quadro são GRUPOS DE TIPOLOGIA DE EQUIPE, não as 10 tipologias
// cruas da MATRIZ. 'Especiais' junta CPTu+SH+VT (decisão do dono do projeto);
// BL fica em coluna própria porque quem a atende são as equipes 'ST | PI | BL',
// e enfiá-la em Especiais criaria uma coluna que as equipes dela não servem.
var COLUNAS_ALOCACAO = [
  { id: 'SP', rotulo: 'SP', tipologias: ['SP'] },
  { id: 'SM / SM.F / SR', rotulo: 'SM / SM.F / SR', tipologias: ['SM / SM.F / SR'] },
  { id: 'ST', rotulo: 'ST', tipologias: ['ST'] },
  { id: 'PI', rotulo: 'PI', tipologias: ['PI'] },
  { id: 'BL', rotulo: 'BL', tipologias: ['BL'] },
  { id: 'Especiais', rotulo: 'Especiais', tipologias: ['CPTu', 'SH', 'VT'] },
];

// Os 9 valores distintos da coluna 'Serviços' medidos na aba EQ em 2026-08-10,
// mais 'BL' e 'SN' por completude. Array com MAIS DE UMA coluna = polivalente:
// a equipe pode ser solta em qualquer uma delas, e quem decide é quem arrasta
// (ver spec, Decisão 1 -- substitui a heurística casarSondador, que falha em
// 25 das 117 equipes).
var COLUNAS_POR_SERVICO = {
  SM: ['SM / SM.F / SR'],
  SP: ['SP'],
  ST: ['ST'],
  PI: ['PI'],
  BL: ['BL'],
  'CPTu | VT | SH': ['Especiais'],
  'ST | PI | BL': ['ST', 'PI', 'BL'],
  'SP/SM': ['SP', 'SM / SM.F / SR'],
};

// Serviços que existem na planilha e NÃO entram no quadro, com o motivo que
// aparece na lista "fora do quadro".
var FORA_DO_QUADRO = {
  Lab: 'Laboratório tem fonte própria e não é equipe de campo de sondagem',
  TST: 'Serviço de teste, sem demanda correspondente na MATRIZ',
  SN: 'Sem demanda correspondente na MATRIZ',
};

// Serviço desconhecido NÃO lança, ao contrário de rotularTipologia
// (tools/comum/tipologias-avancos.js): um texto novo digitado na planilha de
// equipes não pode derrubar a página inteira. Mas também não some -- a equipe
// vai para a lista "fora do quadro" com o texto cru no motivo, visível na tela.
function colunasDaEquipe(servicos) {
  var s = String(servicos === null || servicos === undefined ? '' : servicos).trim();
  if (!s) return { colunas: [], motivoFora: 'Sem serviço preenchido na aba EQ' };
  if (Object.prototype.hasOwnProperty.call(COLUNAS_POR_SERVICO, s)) {
    return { colunas: COLUNAS_POR_SERVICO[s].slice(), motivoFora: null };
  }
  if (Object.prototype.hasOwnProperty.call(FORA_DO_QUADRO, s)) {
    return { colunas: [], motivoFora: FORA_DO_QUADRO[s] };
  }
  return { colunas: [], motivoFora: 'Serviço não catalogado: "' + s + '"' };
}

var COL_LIDER = 4;
var COL_HABILITACAO = 2;
var COL_VEICULO = 5;
var COL_PROPRIETARIO = 6;
var COL_EQUIPAMENTO = [7, 8, 9, 10, 11];
var COL_TENDA = 12;
var COL_TOMADOR = 13;
var COL_SINALIZACAO = 14;

// parseAbaEq (compute-equipes-ativas.js) já devolve id/nome/servicos/dias, mas
// não os campos do popup nem a coluna Líderes -- então esta função lê a grade
// de novo para eles. Não vale mudar parseAbaEq: ela alimenta o Balanço, e
// acrescentar campos lá aumentaria o payload de todo mundo por causa de uma aba.
function camposDoPopup(linha) {
  var equipamentos = [];
  for (var i = 0; i < COL_EQUIPAMENTO.length; i++) {
    var valor = String(linha[COL_EQUIPAMENTO[i]] || '').trim();
    if (valor && valor.toUpperCase() !== 'N/A') equipamentos.push(valor);
  }
  return {
    habilitacao: String(linha[COL_HABILITACAO] || '').trim(),
    veiculo: String(linha[COL_VEICULO] || '').trim(),
    proprietario: String(linha[COL_PROPRIETARIO] || '').trim(),
    equipamentos: equipamentos,
    tenda: String(linha[COL_TENDA] || '').trim(),
    tomador: String(linha[COL_TOMADOR] || '').trim(),
    sinalizacao3p: String(linha[COL_SINALIZACAO] || '').trim(),
  };
}

function diaEpochDoDia(ano, mes, dia) {
  return Math.floor(Date.UTC(ano, mes - 1, dia) / 86400000);
}

// A coluna em que uma equipe POLIVALENTE cai ao ser semeada pelo realizado:
// entre as colunas dela, a primeira (ordem canônica de COLUNAS_ALOCACAO) que
// tenha demanda naquele SUP. Sem nenhuma, a primeira da lista dela. Nunca
// devolve coluna fora do conjunto da equipe.
function colunaSemeada(colunas, sup, temDemanda) {
  if (!colunas.length) return null;
  for (var i = 0; i < COLUNAS_ALOCACAO.length; i++) {
    var id = COLUNAS_ALOCACAO[i].id;
    if (colunas.indexOf(id) === -1) continue;
    if (temDemanda && temDemanda(sup, id)) return id;
  }
  return colunas[0];
}

// Indexa producaoOnline (Link 7, dist/equipes-online.csv --
// "IdEquipe,SUP,Tipo,DiaEpoch", raspado de sond.com.br/campo/sondagens por
// atualizar-equipes-online.js) por idEquipe -- histórico ordenado por
// diaEpoch. Mesmo formato de entrada que compute-equipes-realizado-alocado.js
// já consome para o Realizado da Tabela Semanal, mas indexado à parte aqui:
// lá o carry-forward tem janela de 45 dias; aqui é literalmente "a última
// sondagem que a equipe executou", sem janela nenhuma -- ver
// docs/superpowers/specs/2026-08-26-realizado-alocacao-via-producao-sond-design.md.
function indexarProducaoOnline(producaoOnline) {
  var porEquipe = {};
  (producaoOnline || []).forEach(function (l) {
    if (!l || !l.idEquipe) return;
    if (!porEquipe[l.idEquipe]) porEquipe[l.idEquipe] = [];
    porEquipe[l.idEquipe].push(l);
  });
  Object.keys(porEquipe).forEach(function (id) {
    porEquipe[id].sort(function (a, b) { return a.diaEpoch - b.diaEpoch; });
  });
  return porEquipe;
}

// Último registro do histórico (ordenado) com diaEpoch <= diaAlvo. null se não
// achar -- equipe sem produção nenhuma até aquele dia nasce no pool, nunca
// chutada (mesma garantia de quando a fonte era o texto da Sheet EQ).
function ultimoRealizadoAte(historico, diaAlvo) {
  var melhor = null;
  (historico || []).forEach(function (item) {
    if (item.diaEpoch > diaAlvo) return;
    melhor = item;
  });
  return melhor;
}

// csvEq: o texto CSV da Sheet espelho da aba EQ.
// opcoes: { ano, mes, semana: {inicio, fim}, producaoOnline, temDemanda }
//   producaoOnline: [{idEquipe, sup, tipo, diaEpoch}, ...] -- produção crua do
//   Link 7 (dist/equipes-online.csv). Fonte de supRealizado/colunaRealizada
//   desde 2026-08-26 (antes vinha do texto da Sheet EQ + osParaSup).
//   temDemanda(sup, colunaId) -> bool, OPCIONAL, só para desempatar a coluna
//   de uma equipe polivalente semeada pelo realizado.
function equipesDoQuadro(csvEq, opcoes) {
  var o = opcoes || {};
  var roster = parseAbaEq(csvEq || '');
  var grade = linhasDaAbaEq(csvEq || '');
  var producaoPorEquipe = indexarProducaoOnline(o.producaoOnline);
  var equipes = [];
  var foraDoQuadro = [];
  var diasDaSemana = o.semana ? (o.semana.fim - o.semana.inicio + 1) : 0;
  // Filtro de ATIVAS na aba PESSOAS (2026-08-27, pedido do dono do projeto) --
  // PESSOAS decide só QUEM aparece no quadro; líder/serviços/veículo/popup/
  // disponibilidade da semana continuam vindo da EQ, como sempre. o.pessoasCsv
  // OMITIDO (undefined/null) preserva o comportamento de antes desta mudança
  // -- ninguém é filtrado por PESSOAS até essa fonte existir no build/refresh.
  var idsAtivos = (o.pessoasCsv !== undefined && o.pessoasCsv !== null)
    ? parsePessoasAtivas(o.pessoasCsv) : null;

  // Os grupos saem do roster INTEIRO -- incluindo o que vai para foraDoQuadro.
  // Duas equipes alocáveis podem se ligar pela carona numa Lab, e o veículo é o
  // mesmo. `roster` e `grade` são index-alinhados (é o que a leitura de
  // camposDoPopup já assume logo abaixo).
  var grupos = agruparPorVeiculo(roster.map(function (bruta, indice) {
    return { id: bruta.id, veiculo: String((grade[indice] || [])[COL_VEICULO] || '').trim() };
  }));

  roster.forEach(function (bruta, indice) {
    var linha = grade[indice] || [];
    var lider = String(linha[COL_LIDER] || '').trim() || bruta.nome;

    if (idsAtivos && !idsAtivos.has(String(bruta.id))) {
      foraDoQuadro.push({
        id: bruta.id, lider: lider, servicos: bruta.servicos, motivo: 'Inativa na planilha PESSOAS (ATV=FALSE)',
      });
      return;
    }

    var resolvido = colunasDaEquipe(bruta.servicos);

    if (!resolvido.colunas.length) {
      foraDoQuadro.push({
        id: bruta.id, lider: lider, servicos: bruta.servicos, motivo: resolvido.motivoFora,
      });
      return;
    }

    // Disponibilidade continua vindo do roster da Sheet EQ (Link 6) -- só os
    // dias da semana em tela. O vínculo com o SUP (ultimoSup) NÃO depende mais
    // desse varrimento -- vem direto da produção real do sond (Link 7,
    // producaoPorEquipe), até o fim da semana em tela.
    var diasDisponiveis = 0;
    bruta.dias.forEach(function (d) {
      var epoch = diaEpochDoDia(o.ano, o.mes, d.dia);
      if (o.semana && epoch > o.semana.fim) return;
      var classe = classificarDiaEquipe(d.texto);
      if (!classe) return;
      if (!contaComoAtiva(classe.estado)) return;
      if (o.semana && epoch >= o.semana.inicio) diasDisponiveis += 1;
    });
    var diaAlvoRealizado = o.semana ? o.semana.fim : Infinity;
    var ultimoRealizado = ultimoRealizadoAte(producaoPorEquipe[bruta.id], diaAlvoRealizado);
    var ultimoSup = ultimoRealizado ? ultimoRealizado.sup : null;

    equipes.push({
      id: bruta.id,
      lider: lider,
      nome: bruta.nome,
      servicos: bruta.servicos,
      colunas: resolvido.colunas,
      polivalente: resolvido.colunas.length > 1,
      diasDisponiveis: diasDisponiveis,
      diasDaSemana: diasDaSemana,
      disponivel: diasDisponiveis > 0,
      supRealizado: ultimoSup,
      colunaRealizada: ultimoSup ? colunaSemeada(resolvido.colunas, ultimoSup, o.temDemanda) : null,
      popup: camposDoPopup(linha),
      veiculoGrupo: grupos.grupoPorId[String(bruta.id)] || null,
      veiculoRotulo: grupos.rotuloDoGrupo[grupos.grupoPorId[String(bruta.id)]] || null,
    });
  });

  // companheiros só pode ser calculado depois do laço: é o grupo do veículo
  // podado para quem ficou ALOCÁVEL. A equipe que serviu de ponte (Lab, TST)
  // some daqui de propósito -- ela não vira cartão em lugar nenhum.
  var alocaveis = {};
  equipes.forEach(function (e) { alocaveis[String(e.id)] = true; });
  equipes.forEach(function (e) {
    var membros = grupos.membrosDoGrupo[e.veiculoGrupo] || [];
    e.companheiros = membros.filter(function (id) {
      return id !== String(e.id) && alocaveis[id];
    });
  });

  return { equipes: equipes, foraDoQuadro: foraDoQuadro };
}

module.exports = {
  COLUNAS_ALOCACAO, COLUNAS_POR_SERVICO, colunasDaEquipe, equipesDoQuadro,
};
