'use strict';
const { parseAbaEq, linhasDaAbaEq } = require('./compute-equipes-ativas.js');
const { classificarDiaEquipe, contaComoAtiva } = require('./classificar-dia-equipe.js');
const { agruparPorVeiculo } = require('./grupos-veiculo.js');
const { parsePessoasAtivas, detalhesPessoasAtivas } = require('./pessoas-ativas.js');

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
// "IdEquipe,SUP,Tipo,DiaEpoch,UltimaFotoEpoch", raspado de
// sond.com.br/campo/sondagens por atualizar-equipes-online.js) por idEquipe
// -- histórico ordenado por (diaEpoch, ultimaFotoEpoch). Mesmo formato de
// entrada que compute-equipes-realizado-alocado.js já consome para o
// Realizado da Tabela Semanal, mas indexado à parte aqui: lá o
// carry-forward tem janela de 45 dias; aqui é literalmente "a última
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
    // Ordena por (diaEpoch, ultimaFotoEpoch) por legibilidade -- ultimoRealizadoAte
    // (abaixo) já varre o histórico INTEIRO comparando diaEfetivoRealizado
    // explicitamente, então a ordem aqui não é mais estritamente necessária
    // pra correção (uma OS velha com Última Foto recente fica cedo no array
    // por diaEpoch, mas ultimoRealizadoAte compara certo mesmo assim -- ver o
    // comentário de 2026-08-28 lá).
    porEquipe[id].sort(function (a, b) {
      if (a.diaEpoch !== b.diaEpoch) return a.diaEpoch - b.diaEpoch;
      return (a.ultimaFotoEpoch || 0) - (b.ultimaFotoEpoch || 0);
    });
  });
  return porEquipe;
}

// Janela máxima de carry-forward do "último realizado": se a última produção
// da equipe for mais antiga que isso em relação ao diaAlvo, ela nasce no pool
// em vez de ficar presa a um SUP de dias atrás.
var JANELA_ULTIMO_REALIZADO_DIAS = 3;

// ACHADO AO VIVO em 2026-08-28 (relatado pelo dono do projeto, equipes 216 e
// 337 sumindo do "Repor o realizado" apesar de foto de HOJE): uma linha do
// Link 7 é a OS INTEIRA, não um dia isolado -- "Primeira Foto" é quando a OS
// abriu, "Última Foto" é a atividade mais recente NELA, e as duas podem
// distar dias ou semanas (medido: OS aberta 15/08, ainda com foto 28/08).
// diaEpoch (que vem da Primeira Foto, ver CABECALHO_PRODUCAO em
// atualizar-equipes-online.js) é o campo ERRADO pra medir "há quanto tempo a
// equipe foi vista" -- ele fica preso ao dia de ABERTURA da OS, e uma OS
// aberta há 13 dias mas ativa hoje caía fora da janela de 3 dias em silêncio.
// diaEfetivo usa o DIA da Última Foto pra essa conta -- diaEpoch continua
// intocado (é a fonte de OUTROS consumidores do mesmo CSV, como o Realizado
// da Tabela Semanal, que atribuem a produção ao dia que a OS foi aberta, e
// mudar esse significado ali está fora do escopo desta correção).
function diaEfetivoRealizado(item) {
  return item.ultimaFotoEpoch != null ? Math.floor(item.ultimaFotoEpoch / 1440) : item.diaEpoch;
}

// Registro do histórico com o MAIOR diaEfetivo (desempatado pelo
// ultimaFotoEpoch em minutos, quando dois caem no mesmo dia) que satisfaça
// diaEfetivo <= diaAlvo e diaAlvo - diaEfetivo <= JANELA_ULTIMO_REALIZADO_DIAS.
// null se não achar -- equipe sem produção recente até aquele dia nasce no
// pool, nunca chutada (mesma garantia de quando a fonte era o texto da Sheet
// EQ). Varre o histórico INTEIRO (não depende mais da ordem de
// indexarProducaoOnline) porque diaEfetivo pode discordar da ordem por
// diaEpoch -- uma OS velha (diaEpoch baixo) com Última Foto de hoje
// (diaEfetivo alto) fica cedo no array ordenado por diaEpoch, mas é ela quem
// tem que ganhar.
function ultimoRealizadoAte(historico, diaAlvo) {
  var melhor = null;
  var melhorDiaEfetivo = null;
  (historico || []).forEach(function (item) {
    var diaEfetivo = diaEfetivoRealizado(item);
    if (diaEfetivo > diaAlvo) return;
    if (diaAlvo - diaEfetivo > JANELA_ULTIMO_REALIZADO_DIAS) return;
    if (melhor === null || diaEfetivo > melhorDiaEfetivo
      || (diaEfetivo === melhorDiaEfetivo && (item.ultimaFotoEpoch || 0) > (melhor.ultimaFotoEpoch || 0))) {
      melhor = item;
      melhorDiaEfetivo = diaEfetivo;
    }
  });
  return melhor;
}

// SUP sintético para onde uma equipe é semeada quando o SUP resolvido pela
// produção online NÃO bate com nenhum SUP conhecido da Matriz (2026-08-28) --
// texto de OS mal formatado, contrato encerrado que já saiu da Matriz, etc.
// Sem isto, montarGradeAlocacao (compute-alocacao.js) cria uma linha AVULSA
// pra cada SUP desconhecido distinto -- lixo espalhado pela grade em vez de
// consolidado num só lugar previsível.
var SUP_DESCONHECIDO = 'Diversos';

// csvEq: o texto CSV da Sheet espelho da aba EQ.
// opcoes: { ano, mes, semana: {inicio, fim}, producaoOnline, temDemanda,
//           supsConhecidos, hoje }
//   hoje: diaEpoch do dia atual, OPCIONAL -- limita diaAlvoRealizado a não
//   ultrapassar hoje numa semana ainda em curso (ver comentário acima de
//   diaAlvoRealizado). Omitido preserva o comportamento antigo (usa sempre
//   o fim da semana).
//   producaoOnline: [{idEquipe, sup, tipo, diaEpoch, ultimaFotoEpoch}, ...] --
//   produção crua do Link 7 (dist/equipes-online.csv). Fonte de
//   supRealizado/colunaRealizada desde 2026-08-26 (antes vinha do texto da
//   Sheet EQ + osParaSup).
//   temDemanda(sup, colunaId) -> bool, OPCIONAL, só para desempatar a coluna
//   de uma equipe polivalente semeada pelo realizado.
//   supsConhecidos: { [sup]: true, ... }, OPCIONAL -- os SUPs que existem na
//   Matriz do período em tela. Quando presente, um supRealizado que não bate
//   com nenhuma chave dele é redirecionado para SUP_DESCONHECIDO ('Diversos')
//   -- o valor original fica em equipe.supReal, pro cartão mostrar de onde
//   veio (ver renderCartaoEquipe). Omitido preserva o comportamento antigo
//   (nunca redireciona) -- mesma convenção de pessoasCsv/temDemanda acima.
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
  // detalhesAtivos: só para o aviso abaixo (id 658 sumiu sem rastro até
  // 2026-08-27 -- ativo na PESSOAS, sem NENHUMA linha na EQ, então nem
  // roster.forEach nem o motivo 'Inativa' o alcançavam; ninguém via o
  // problema até contar os cartões um por um). idsAtivos continua sendo o
  // Set usado no filtro de fato, por clareza -- este Map é só pra nomear o
  // aviso.
  var detalhesAtivos = (o.pessoasCsv !== undefined && o.pessoasCsv !== null)
    ? detalhesPessoasAtivas(o.pessoasCsv) : null;

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
    // diaAlvoRealizado: nunca no futuro. Numa semana ainda em curso,
    // o.semana.fim é um dia que ainda não aconteceu -- não existe (nem pode
    // existir) produção depois de hoje, então usar o fim da semana como alvo
    // faz a janela de 3 dias "vencer" antes mesmo de alcançar a produção real
    // de ontem/anteontem, e a equipe nasce no pool sem nunca ter ficado
    // realmente sem trabalho. min(fim da semana, hoje) resolve: semanas já
    // fechadas continuam usando o fim (hoje >= fim), semanas em curso usam
    // hoje.
    var diaAlvoRealizado = o.semana
      ? (o.hoje != null ? Math.min(o.semana.fim, o.hoje) : o.semana.fim)
      : Infinity;
    var ultimoRealizado = ultimoRealizadoAte(producaoPorEquipe[bruta.id], diaAlvoRealizado);
    var ultimoSupBruto = ultimoRealizado ? ultimoRealizado.sup : null;
    // Redireciona pra SUP_DESCONHECIDO só quando dá pra CONFERIR (o chamador
    // passou supsConhecidos) e o SUP não bate com nenhum -- sem
    // supsConhecidos, mantém o comportamento antigo (usa o SUP cru, mesmo que
    // seja lixo). supReal só é preenchido no caso redirecionado: é o que o
    // cartão usa pra saber que tem algo a mostrar no tooltip (ver
    // renderCartaoEquipe) -- null nos outros casos, não string vazia, pra não
    // precisar de um segundo booleano.
    var redirecionado = !!(ultimoSupBruto && o.supsConhecidos && !o.supsConhecidos[ultimoSupBruto]);
    var ultimoSup = redirecionado ? SUP_DESCONHECIDO : ultimoSupBruto;

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
      supReal: redirecionado ? ultimoSupBruto : null,
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

  // Ativo na PESSOAS mas SEM NENHUMA linha na EQ (id não bate) -- diferente de
  // 'Inativa na planilha PESSOAS', que é uma linha da EQ excluída pelo
  // filtro. Aqui a linha da EQ nem existe: sem líder/serviço/dias, não dá pra
  // montar cartão nenhum, então o aviso é o único jeito da equipe aparecer em
  // algum lugar da tela em vez de sumir muda.
  if (idsAtivos) {
    var idsNaEq = {};
    roster.forEach(function (bruta) { idsNaEq[String(bruta.id)] = true; });
    idsAtivos.forEach(function (id) {
      if (idsNaEq[id]) return;
      var detalhe = detalhesAtivos ? detalhesAtivos.get(id) : null;
      foraDoQuadro.push({
        id: id,
        lider: (detalhe && (detalhe.lider || detalhe.colaborador)) || '',
        servicos: (detalhe && detalhe.servico) || '',
        motivo: 'Ativa na planilha PESSOAS (ATV=TRUE), mas sem nenhuma linha correspondente na aba EQ -- confira o ID',
      });
    });
  }

  return { equipes: equipes, foraDoQuadro: foraDoQuadro };
}

module.exports = {
  COLUNAS_ALOCACAO, COLUNAS_POR_SERVICO, colunasDaEquipe, equipesDoQuadro, SUP_DESCONHECIDO,
};
