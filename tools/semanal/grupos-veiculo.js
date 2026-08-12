'use strict';

// Este módulo roda no Node (build/testes) e no navegador (bundle) -- por isso
// 'var'/'function'. Não consome nenhum outro módulo.
//
// EQUIPES QUE DIVIDEM VEÍCULO
// ===========================================================================
// Ver docs/superpowers/specs/2026-08-12-alocacao-trava-veiculo-design.md.
//
// A coluna 'Veículo' da aba EQ carrega quatro tipos de conteúdo, e só dois
// criam vínculo entre equipes: uma PLACA (a mesma placa em duas linhas) e uma
// CARONA ('Carona ID N', que aponta para outra equipe). O resto -- 'Próprio'
// (16 equipes), vazio (10), 'afastado', 'D?', 'Suporte' -- não vincula NADA.
//
// A regra é uma lista de PERMISSÃO de propósito. Com lista de exclusão, no dia
// em que alguém digitasse uma palavra nova em duas linhas as duas equipes
// ficariam travadas uma na outra, sem nada na tela explicando por quê. Assim,
// texto desconhecido apenas não trava -- o modo de falhar é a ausência da
// trava, nunca uma trava fantasma.

// Placa antiga (SUH-6F44, EYX 4G65) e Mercosul (UFY1G30): 3 letras + 4
// alfanuméricos começando por dígito, com separador opcional. O descritivo
// entre parênteses -- '(D, 9p)' vs '(D, 9 p)' -- fica de fora: três grupos
// REAIS só aparecem porque ele não conta.
var RE_PLACA = /^([A-Za-z]{3})[ -]?([0-9][A-Za-z0-9]{3})/;
// 'Carona ID 171', 'carona ID 463', 'Carona  ID 477' (espaço duplo) -- as três
// grafias existem na planilha.
var RE_CARONA = /^carona\s+id\s*(\d+)/i;

function normalizarVeiculo(texto) {
  var t = String(texto === null || texto === undefined ? '' : texto).trim();
  if (!t) return { tipo: 'nenhum', chave: null };
  var carona = RE_CARONA.exec(t);
  if (carona) return { tipo: 'carona', chave: carona[1] };
  var placa = RE_PLACA.exec(t);
  if (placa) return { tipo: 'placa', chave: (placa[1] + placa[2]).toUpperCase() };
  return { tipo: 'nenhum', chave: null };
}

// Ordem numérica quando os dois lados são numéricos (todo ID da aba EQ é), com
// queda para ordem de texto -- um ID não numérico não pode quebrar a ordenação.
function compararIds(a, b) {
  var na = parseInt(a, 10);
  var nb = parseInt(b, 10);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  return a < b ? -1 : (a > b ? 1 : 0);
}

// linhas: [{ id, veiculo }] -- o roster INTEIRO da aba EQ, incluindo as equipes
// que ficam fora do quadro (Lab/TST/SN). Duas equipes alocáveis podem se ligar
// através da carona numa terceira que não é alocável: o veículo é o mesmo de
// qualquer forma, e quem filtra o que aparece na tela é quem chama.
function agruparPorVeiculo(linhas) {
  var lista = linhas || [];
  var pai = {};
  lista.forEach(function (l) { pai[String(l.id)] = String(l.id); });

  function raiz(x) {
    var atual = x;
    while (pai[atual] && pai[atual] !== atual) {
      pai[atual] = pai[pai[atual]];
      atual = pai[atual];
    }
    return atual;
  }
  function unir(a, b) {
    var ra = raiz(a);
    var rb = raiz(b);
    if (ra !== rb) pai[ra] = rb;
  }

  var porPlaca = {};
  var placaDoId = {};
  lista.forEach(function (l) {
    var id = String(l.id);
    var v = normalizarVeiculo(l.veiculo);
    if (v.tipo === 'carona') {
      // Alvo que não existe no roster não cria aresta (medido: 'Carona ID 10'
      // e 'Carona ID 477' apontam para IDs ausentes). Auto-referência também
      // não -- uniria a equipe a si mesma, sem efeito, mas o guarda deixa a
      // intenção explícita.
      if (Object.prototype.hasOwnProperty.call(pai, v.chave) && v.chave !== id) unir(id, v.chave);
      return;
    }
    if (v.tipo === 'placa') {
      placaDoId[id] = v.chave;
      if (!porPlaca[v.chave]) porPlaca[v.chave] = [];
      porPlaca[v.chave].push(id);
    }
  });
  Object.keys(porPlaca).forEach(function (placa) {
    var ids = porPlaca[placa];
    for (var i = 1; i < ids.length; i++) unir(ids[0], ids[i]);
  });

  // A raiz do union-find é arbitrária (depende da ordem das uniões), então ela
  // NÃO serve de chave estável. A chave sai do conteúdo: a menor placa do
  // grupo, ou o menor ID quando o grupo não tem placa nenhuma (caso real
  // {322, 635, 666}, em que a 322 tem veículo vazio e as outras a caroneiam).
  var membrosPorRaiz = {};
  Object.keys(pai).forEach(function (id) {
    var r = raiz(id);
    if (!membrosPorRaiz[r]) membrosPorRaiz[r] = [];
    membrosPorRaiz[r].push(id);
  });

  var grupoPorId = {};
  var membrosDoGrupo = {};
  var rotuloDoGrupo = {};
  Object.keys(membrosPorRaiz).forEach(function (r) {
    var membros = membrosPorRaiz[r].slice().sort(compararIds);
    var placas = membros.map(function (id) { return placaDoId[id]; })
      .filter(function (p) { return !!p; }).sort();
    var chave = placas.length ? 'PLACA:' + placas[0] : 'CARONA:' + membros[0];
    membrosDoGrupo[chave] = membros;
    rotuloDoGrupo[chave] = placas.length ? placas[0] : 'Carona ID ' + membros[0];
    membros.forEach(function (id) { grupoPorId[id] = chave; });
  });

  return { grupoPorId: grupoPorId, membrosDoGrupo: membrosDoGrupo, rotuloDoGrupo: rotuloDoGrupo };
}

// A coluna em que uma companheira aterrissa no SUP de destino. Preferência, em
// ordem: a coluna em que ela JÁ estava (se serve), a coluna do gesto (se
// serve), a primeira que ela serve. A trava é sobre SUP -- mudar a tipologia de
// quem só está pegando carona seria uma decisão que ninguém pediu.
function colunaDaCompanheira(equipe, atual, colunaDoGesto) {
  var colunas = equipe.colunas || [];
  if (atual && atual.coluna && colunas.indexOf(atual.coluna) !== -1) return atual.coluna;
  if (colunas.indexOf(colunaDoGesto) !== -1) return colunaDoGesto;
  return colunas[0];
}

// A TRAVA. Recebe o gesto (equipe arrastada + destino) e devolve a lista de
// movimentos a aplicar, com o grupo do veículo junto. Não toca em estado nem no
// DOM: quem aplica é aplicarMovimento (render-semanal.js).
//
// Lista VAZIA significa gesto RECUSADO -- e recusado move ZERO equipes, nem a
// arrastada. As duas recusas são as mesmas de antes da trava (equipe
// indisponível; coluna fora do conjunto dela), avaliadas antes de qualquer
// efeito.
//
// sup vazio = devolução ao pool, e ela também vale para o grupo: 'andam juntas'
// nos dois sentidos, senão tirar só uma do quadro recriaria o plano impossível
// ao contrário.
//
// A companheira INDISPONÍVEL nunca entra na lista. Não há deslocamento a
// coordenar com quem não vai a campo, e a trava não pode virar a porta dos
// fundos que aloca quem aplicarMovimento recusaria individualmente.
function destinoDoGrupo(equipes, alocacao, equipeId, sup, coluna) {
  var lista = equipes || [];
  var aloc = alocacao || {};
  var porId = {};
  lista.forEach(function (e) { porId[String(e.id)] = e; });

  var alvo = porId[String(equipeId)];
  if (!alvo || !alvo.disponivel) return [];
  if (sup && (alvo.colunas || []).indexOf(coluna) === -1) return [];

  var movimentos = [{
    id: String(equipeId),
    sup: sup || '',
    coluna: sup ? coluna : '',
  }];

  (alvo.companheiros || []).forEach(function (idBruto) {
    var id = String(idBruto);
    var companheira = porId[id];
    if (!companheira || !companheira.disponivel) return;
    var atual = aloc[id];
    if (!sup) {
      if (atual && atual.sup) movimentos.push({ id: id, sup: '', coluna: '' });
      return;
    }
    if (atual && atual.sup === sup) return;
    movimentos.push({ id: id, sup: sup, coluna: colunaDaCompanheira(companheira, atual, coluna) });
  });

  return movimentos;
}

// Grupos que JÁ estão espalhados em mais de um SUP -- só podem ter entrado pela
// semeadura do realizado ou por uma alocação salva antes desta versão, porque a
// trava impede que um movimento crie um. Marcar, nunca corrigir: a semeadura é
// o retrato de onde as equipes estiveram de fato (Decisão 4 do spec).
//
// Equipe no pool NUNCA é conflito: conflito é estar em SUPs diferentes, e pool
// não é SUP. (Isto é independente da trava mover companheira do pool -- lá é
// coordenar deslocamento, aqui é acusar um plano impossível.)
function conflitosDeVeiculo(equipes, alocacao) {
  var aloc = alocacao || {};
  var conflitos = {};
  (equipes || []).forEach(function (e) {
    var meu = aloc[String(e.id)];
    if (!meu || !meu.sup) return;
    var outros = [];
    (e.companheiros || []).forEach(function (idBruto) {
      var destino = aloc[String(idBruto)];
      if (destino && destino.sup && destino.sup !== meu.sup) {
        outros.push({ id: String(idBruto), sup: destino.sup });
      }
    });
    if (outros.length) conflitos[String(e.id)] = outros;
  });
  return conflitos;
}

module.exports = {
  normalizarVeiculo, agruparPorVeiculo, destinoDoGrupo, conflitosDeVeiculo,
};
