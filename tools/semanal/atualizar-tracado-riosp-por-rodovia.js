'use strict';

// Resolve o traçado da RioSP SEPARADO por rodovia (BR-101 x BR-116) --
// pedido do usuário em 2026-08-28: a RioSP tem SUPs em duas rodovias
// diferentes (SUP-7285-24 na BR-116; SUP-6498-23/SUP-6830-23 na BR-101), mas
// o geojson único raspado da ABCR mistura as duas linhas sem nenhuma
// propriedade por feature que diga qual é qual -- não dá pra separar o
// existente, só resolver de novo, cada rodovia isolada, via DNIT/WFS (mesma
// técnica de atualizar-tracado-antt-dnit.js).
//
// Faixas de km: CSV oficial da ANTT (trecho-concedido, mesmo usado em
// 2026-08-27 pro handoff das 21 rodovias) -- RIOSP;BR-101;73;380.8;598.6,
// RIOSP;BR-101;74;0.0;52.59, RIOSP;BR-116;73;169.0;339.482,
// RIOSP;BR-116;74;0.0;231.947 (73=RJ, 74=SP, ver UF_ANTT_PARA_SIGLA em
// tracado-antt-dnit-fonte.js).
//
// Roda manualmente (mesmo padrão dos outros atualizar-tracado-*.js):
//   node tools/semanal/atualizar-tracado-riosp-por-rodovia.js
//
// Grava tracado-riosp-por-rodovia-resolvido.json -- consumido em
// atualizar-concessoes-rodovias.js, que injeta duas concessionárias
// SINTÉTICAS ("riosp-br-101"/"riosp-br-116") na lista final, e em
// vinculo-sup-concessionaria.js, que aponta os 3 SUPs confirmados pra elas
// em vez da RioSP genérica (id "13").

const fs = require('fs');
const path = require('path');
const { buscarTrecho, simplificarGeometria } = require('./atualizar-tracado-antt-dnit.js');
const { simplificarCoordenadas } = require('./concessoes-rodovias.js');

const TRECHOS = {
  'riosp-br-101': [
    { br: '101', uf: 'RJ', kmInicial: 380.8, kmFinal: 598.6 },
    { br: '101', uf: 'SP', kmInicial: 0, kmFinal: 52.59 },
  ],
  'riosp-br-116': [
    { br: '116', uf: 'RJ', kmInicial: 169.0, kmFinal: 339.482 },
    { br: '116', uf: 'SP', kmInicial: 0, kmFinal: 231.947 },
  ],
};

async function resolverTrechos(trechos) {
  var features = [];
  for (var i = 0; i < trechos.length; i++) {
    var t = trechos[i];
    var fc = await buscarTrecho(t.br, t.uf, t.kmInicial, t.kmFinal);
    (fc.features || []).forEach(function (f) {
      features.push(simplificarGeometria({ type: 'Feature', properties: {}, geometry: f.geometry }));
    });
  }
  return simplificarCoordenadas({ type: 'FeatureCollection', features: features }, 5);
}

async function main() {
  var resolvido = {};
  var ids = Object.keys(TRECHOS);
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    process.stdout.write('Resolvendo ' + id + '... ');
    var geojson = await resolverTrechos(TRECHOS[id]);
    resolvido[id] = geojson;
    console.log(geojson.features.length + ' feature(s)');
  }
  var destino = path.join(__dirname, 'tracado-riosp-por-rodovia-resolvido.json');
  fs.writeFileSync(destino, JSON.stringify(resolvido, null, 2) + '\n');
  console.log('Gravado em ' + destino);
}

if (require.main === module) {
  main().catch(function (e) { console.error(e); process.exitCode = 1; });
}

module.exports = { TRECHOS, resolverTrechos };
