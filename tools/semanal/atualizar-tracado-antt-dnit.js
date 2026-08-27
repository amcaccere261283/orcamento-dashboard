'use strict';

// Resolve o traçado real (LineString/MultiLineString) das 20 concessionárias
// "extra ANTT" (de concessoes-rodovias.js) que só tinham nome, cruzando os
// trechos federais de tracado-antt-dnit-fonte.js contra a malha física do
// DNIT (SNV) via WFS -- ver
// docs/superpowers/specs/2026-08-27-tracado-rodovias-antt-dnit-handoff.md.
//
// Roda manualmente (rodovia concedida muda raríssimas vezes -- mesmo padrão
// de atualizar-concessoes-rodovias.js, fora do live-refresh e de
// atualizar-arquivos.js):
//
//   node tools/semanal/atualizar-tracado-antt-dnit.js
//
// Grava tools/semanal/tracado-antt-dnit-resolvido.json -- um módulo de DADOS
// versionado no git, separado de tracado-antt-dnit-fonte.js (a lista de
// trechos a consultar) e de concessoes-rodovias.js (que MESCLA esse
// resolvido em CONCESSIONARIAS_EXTRA_ANTT, ver o comentário lá). Rodar
// atualizar-concessoes-rodovias.js de novo NÃO apaga este arquivo -- são
// pipelines independentes que só se encontram na mesclagem final.

const https = require('https');
const fs = require('fs');
const path = require('path');
const { simplificarCoordenadas } = require('./concessoes-rodovias.js');
const { UF_ANTT_PARA_SIGLA, TRECHOS_FEDERAIS_POR_CONCESSIONARIA } = require('./tracado-antt-dnit-fonte.js');

const WFS_URL = 'https://geoservicos.inde.gov.br/geoserver/DNIT/ows';

// A malha do SNV vem com densidade de levantamento GPS (~1 ponto a cada
// poucos metros) -- sem redução de PONTOS (só arredondar casas decimais,
// como simplificarCoordenadas já faz), as 20 concessionárias juntas geravam
// 46 MB de JSON (~500 mil pontos), inviável pra uma página estática. Douglas-
// Peucker com tolerância de ~0,0005 grau (~50 m no equador, mais que
// suficiente pra uma linha de REFERÊNCIA visual, não navegação) derruba isso
// pra low-digit MB sem distorcer o traçado a olho nu.
var TOLERANCIA_SIMPLIFICACAO_GRAUS = 0.0005;

function distanciaPontoSegmento(p, a, b) {
  var dx = b[0] - a[0], dy = b[1] - a[1];
  if (dx === 0 && dy === 0) {
    dx = p[0] - a[0]; dy = p[1] - a[1];
    return Math.sqrt(dx * dx + dy * dy);
  }
  var t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  var px = a[0] + t * dx, py = a[1] + t * dy;
  var ddx = p[0] - px, ddy = p[1] - py;
  return Math.sqrt(ddx * ddx + ddy * ddy);
}

function douglasPeucker(pontos, tolerancia) {
  if (pontos.length < 3) return pontos.slice();
  var maiorDist = 0, indice = 0;
  var a = pontos[0], b = pontos[pontos.length - 1];
  for (var i = 1; i < pontos.length - 1; i++) {
    var d = distanciaPontoSegmento(pontos[i], a, b);
    if (d > maiorDist) { maiorDist = d; indice = i; }
  }
  if (maiorDist > tolerancia) {
    var esquerda = douglasPeucker(pontos.slice(0, indice + 1), tolerancia);
    var direita = douglasPeucker(pontos.slice(indice), tolerancia);
    return esquerda.slice(0, -1).concat(direita);
  }
  return [a, b];
}

function simplificarGeometria(feature) {
  var geom = feature.geometry;
  if (!geom) return feature;
  if (geom.type === 'LineString') {
    geom.coordinates = douglasPeucker(geom.coordinates, TOLERANCIA_SIMPLIFICACAO_GRAUS);
  } else if (geom.type === 'MultiLineString') {
    geom.coordinates = geom.coordinates.map(function (linha) {
      return douglasPeucker(linha, TOLERANCIA_SIMPLIFICACAO_GRAUS);
    });
  }
  return feature;
}

function buscarJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('WFS respondeu ' + res.statusCode + ' para ' + url));
        return;
      }
      var chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (e) {
          reject(new Error('WFS devolveu JSON inválido: ' + e.message));
        }
      });
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('timeout WFS')); });
  });
}

// Sobreposição de faixas de km -- o SNV pode segmentar diferente do trecho
// concedido, então busca qualquer feature do WFS que toque o intervalo
// pedido, não uma igualdade exata.
// A camada snv_202507a guarda vl_br com 3 dígitos, zero à esquerda incluído
// (ex. "040", não "40") -- achado ao investigar por que BR-40 (Elovias)
// devolvia 0 features enquanto BR-101/BR-116 (já com 3 dígitos) funcionavam.
function padBr(br) {
  return String(br).padStart(3, '0');
}

function montarUrlWfs(br, uf, kmInicial, kmFinal) {
  var filtro = "vl_br='" + padBr(br) + "' AND sg_uf='" + uf + "'" +
    ' AND NOT (vl_km_fina<' + kmInicial + ' OR vl_km_inic>' + kmFinal + ')';
  return WFS_URL + '?service=WFS&version=2.0.0&request=GetFeature' +
    '&typeNames=DNIT:snv_202507a&outputFormat=application/json' +
    '&CQL_FILTER=' + encodeURIComponent(filtro);
}

function buscarTrecho(br, uf, kmInicial, kmFinal) {
  var url = montarUrlWfs(br, uf, kmInicial, kmFinal);
  return buscarJson(url);
}

async function resolverConcessionaria(id, trechos) {
  var features = [];
  for (var i = 0; i < trechos.length; i++) {
    var t = trechos[i];
    var uf = UF_ANTT_PARA_SIGLA[t.ufAntt];
    if (!uf) {
      console.warn('[' + id + '] código de UF ' + t.ufAntt + ' sem sigla mapeada -- trecho BR-' + t.br + ' pulado');
      continue;
    }
    var fc;
    try {
      fc = await buscarTrecho(t.br, uf, t.kmInicial, t.kmFinal);
    } catch (e) {
      console.warn('[' + id + '] falha buscando BR-' + t.br + '/' + uf + ': ' + e.message);
      continue;
    }
    (fc.features || []).forEach(function (f) {
      features.push(simplificarGeometria({ type: 'Feature', properties: {}, geometry: f.geometry }));
    });
  }
  if (features.length === 0) return null;
  return simplificarCoordenadas({ type: 'FeatureCollection', features: features }, 5);
}

async function main() {
  var resolvido = {};
  var ids = Object.keys(TRECHOS_FEDERAIS_POR_CONCESSIONARIA);
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    process.stdout.write('Resolvendo ' + id + '... ');
    var geojson = await resolverConcessionaria(id, TRECHOS_FEDERAIS_POR_CONCESSIONARIA[id]);
    resolvido[id] = geojson;
    console.log(geojson ? geojson.features.length + ' feature(s)' : 'SEM RESULTADO');
  }
  var destino = path.join(__dirname, 'tracado-antt-dnit-resolvido.json');
  fs.writeFileSync(destino, JSON.stringify(resolvido, null, 2) + '\n');
  console.log('Gravado em ' + destino);
}

if (require.main === module) {
  main().catch(function (e) { console.error(e); process.exitCode = 1; });
}

module.exports = {
  buscarTrecho, resolverConcessionaria, padBr, montarUrlWfs, douglasPeucker, simplificarGeometria,
};
