'use strict';

// Extração PURA (sem rede) dos dados de rodovias/concessionárias embutidos na
// página https://melhoresrodovias.org.br/mapa-de-concessoes/ -- ver
// docs/superpowers/specs/2026-08-27-alocacao-mapa-camada-rodovias-design.md.
// A busca de rede em si (fetch da página) mora em
// atualizar-concessoes-rodovias.js (Task 2); este módulo só sabe extrair de um
// HTML já em mãos, e por isso é testável com uma fixture pequena, sem rede.
//
// Confirmado ao vivo em 2026-08-27 (curl com User-Agent de navegador comum, HTTP
// 200): os dados NÃO vêm de um endpoint JSON/KML separado -- estão embutidos como
// literais JS dentro de um <script> inline, já no HTML servido pelo servidor
// (aparecem mesmo sem JavaScript rodando). Duas estruturas:
//   const CONCESS = [{ id, nome, slug, cor }, ...]              -- concessionárias
//   const ROADS   = [{ id, concessionaria_id, geojson, ... }]   -- geojson é uma
//                                                                  STRING (JSON
//                                                                  dentro do JSON)

function extrairArrayLiteral(html, nomeVar) {
  var marcador = 'const ' + nomeVar + ' = ';
  var inicio = html.indexOf(marcador);
  if (inicio === -1) {
    throw new Error('extrairConcessoesRodovias: "' + marcador + '" não encontrado no HTML -- o site mudou de formato?');
  }
  var cursor = inicio + marcador.length;
  if (html[cursor] !== '[') {
    throw new Error('extrairConcessoesRodovias: esperava "[" logo após "' + marcador + '"');
  }
  // Varre respeitando aspas (pra não contar colchetes dentro de strings, como o
  // próprio geojson de ROADS, que é JSON serializado dentro de uma string).
  var profundidade = 0;
  var dentroDeString = false;
  var escapando = false;
  for (var i = cursor; i < html.length; i++) {
    var ch = html[i];
    if (escapando) { escapando = false; continue; }
    if (ch === '\\') { escapando = true; continue; }
    if (ch === '"') { dentroDeString = !dentroDeString; continue; }
    if (dentroDeString) continue;
    if (ch === '[') profundidade++;
    else if (ch === ']') {
      profundidade--;
      if (profundidade === 0) return JSON.parse(html.slice(cursor, i + 1));
    }
  }
  throw new Error('extrairConcessoesRodovias: array "' + nomeVar + '" nunca fechou -- HTML truncado?');
}

function arredondar(numero, casas) {
  var fator = Math.pow(10, casas);
  return Math.round(numero * fator) / fator;
}

function simplificarCoordPar(par, casas) {
  return [arredondar(par[0], casas), arredondar(par[1], casas)];
}

// Aceita LineString/MultiLineString (os dois tipos vistos em ROADS real) --
// qualquer outro tipo de geometria passa por cópia profunda sem arredondar
// (nunca lança por tipo desconhecido).
function simplificarCoordenadas(featureCollection, casas) {
  if (!featureCollection) return null;
  var c = casas === undefined ? 5 : casas;
  var copia = JSON.parse(JSON.stringify(featureCollection));
  if (!copia.features) return copia;
  copia.features.forEach(function (feature) {
    var geom = feature.geometry;
    if (!geom) return;
    if (geom.type === 'LineString') {
      geom.coordinates = geom.coordinates.map(function (par) { return simplificarCoordPar(par, c); });
    } else if (geom.type === 'MultiLineString') {
      geom.coordinates = geom.coordinates.map(function (linha) {
        return linha.map(function (par) { return simplificarCoordPar(par, c); });
      });
    }
  });
  return copia;
}

function extrairConcessoesRodovias(html) {
  var concess = extrairArrayLiteral(html, 'CONCESS');
  var roads = extrairArrayLiteral(html, 'ROADS');

  var featuresPorConcessionaria = {};
  roads.forEach(function (trecho) {
    if (!trecho.geojson) return;
    var fc;
    try {
      fc = JSON.parse(trecho.geojson);
    } catch (e) {
      // Geojson malformado: trata como se estivesse ausente, pula o trecho
      return;
    }
    var id = trecho.concessionaria_id;
    if (!featuresPorConcessionaria[id]) featuresPorConcessionaria[id] = [];
    featuresPorConcessionaria[id] = featuresPorConcessionaria[id].concat(fc.features || []);
  });

  var resultado = concess.map(function (c) {
    var features = featuresPorConcessionaria[c.id];
    var geojson = features
      ? simplificarCoordenadas({ type: 'FeatureCollection', features: features }, 5)
      : null;
    return { id: c.id, nome: c.nome, slug: c.slug, cor: c.cor, geojson: geojson };
  });

  resultado.sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
  return resultado;
}

module.exports = { simplificarCoordenadas, extrairConcessoesRodovias };
