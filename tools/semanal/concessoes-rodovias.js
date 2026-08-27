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

// Concessionárias coletadas manualmente em 2026-08-27 do filtro "Concessionária"
// do relatório ANTT "Mapa das Concessões" (Power BI):
// https://app.powerbi.com/view?r=eyJrIjoiMzc2OGVkZjYtY2JhNC00MzhhLTg4OTItY2JkM2E2NDljN2ZjIiwidCI6Ijg3YmJlOWRlLWE4OTItNGNkZS1hNDY2LTg4Zjk4MmZiYzQ5MCJ9
// Sem coordenada nenhuma -- o Power BI serve os dados num formato interno
// comprimido (DSR, com dicionário de valores + RLE) que não vale decifrar só
// pra uma lista de nomes; a lista foi lida rolando o filtro manualmente (35
// itens, duas varreduras consecutivas confirmaram estabilidade). Decisão do
// dono do projeto (2026-08-27): lista fixa, sem tentar casar contra CONCESS
// (várias parecem o mesmo grupo com nome atualizado -- ex. "Fluminense" na
// ABCR vira "Autopista Fluminense" na ANTT, "RioSP" vira "Motiva RioSP",
// rebrand real da Motiva/CCR em 2024 -- mas confirmar qual é qual sem fonte
// oficial de correspondência arriscaria fundir duas empresas diferentes por
// engano). Entram como concessionária a mais no seletor, `geojson: null`
// (mesmo tratamento que qualquer concessionária sem trecho em ROADS já
// recebe) -- nunca desenham linha, só ficam disponíveis pra escolher.
// `id` prefixado com "antt-" pra nunca colidir com os ids numéricos de
// CONCESS (que vêm do site da ABCR, faixa 1-99).
var CONCESSIONARIAS_EXTRA_ANTT = [
  'Autopista Fluminense', 'Autopista Litoral Sul', 'Autopista Planalto Sul',
  'Autopista Regis Bittencourt', 'EPR Iguaçu', 'EPR Litoral Pioneiro',
  'EPR Paraná', 'EPR Via Mineira', 'Ecovias Araguaia', 'Ecovias Capixaba',
  'Ecovias Cerrado', 'Ecovias Minas Goiás', 'Ecovias Ponte', 'Ecovias Rio Minas',
  'Ecovias das Gerais', 'Elovias', 'Motiva Minas SP', 'Motiva Pantanal',
  'Motiva Paraná', 'Motiva RioSP', 'Motiva ViaCosteira', 'Motiva ViaSul',
  'Nova 364', 'Nova 381', 'Nova Rota do Oeste', 'Rota Verde Goiás',
  'Triunfo Concebra', 'Triunfo Transbrasiliana', 'Via Araucária',
  'Via Brasil BR-163', 'Via Campo', 'Via Cristais', 'Way-153', 'Way-262',
  'Way-364',
].map(function (nome) {
  return {
    id: 'antt-' + nome.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
      .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
    nome: nome, slug: null, cor: null, geojson: null,
  };
});

// Junta o resultado de extrairConcessoesRodovias com CONCESSIONARIAS_EXTRA_ANTT
// (ou outra lista de extras equivalente) e reordena por nome -- função PURA,
// separada de extrairConcessoesRodovias pra continuar testável com uma
// fixture pequena, sem precisar simular o HTML inteiro da ABCR de novo.
// Nunca deduplica: cada entrada de `extras` sempre entra, mesmo que já exista
// uma concessionária com nome parecido em `lista` -- ver o comentário de
// CONCESSIONARIAS_EXTRA_ANTT sobre por que casar os dois automaticamente
// seria arriscado.
function mesclarConcessionariasExtras(lista, extras) {
  var combinado = (lista || []).concat(extras || []);
  combinado.sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
  return combinado;
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

module.exports = {
  simplificarCoordenadas, extrairConcessoesRodovias,
  mesclarConcessionariasExtras, CONCESSIONARIAS_EXTRA_ANTT,
};
