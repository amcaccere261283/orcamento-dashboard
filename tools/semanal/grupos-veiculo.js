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

module.exports = { normalizarVeiculo, agruparPorVeiculo };
