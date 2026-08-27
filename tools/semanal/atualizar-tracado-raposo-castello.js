'use strict';

// Resolve o traçado de "Ecovias Raposo Castello" (id "40" na lista da ABCR,
// concessoes-rodovias.js) -- a ÚNICA concessionária do seletor "Rodovias"
// que fica de fora do DNIT/SNV por natureza, não por falta de dado: as suas
// quatro vias (SP-270 Raposo Tavares, SP-280 Castello Branco, SP-029 Cel.
// Nelson Tranchesi, mais uma ligação municipal Cotia-Embu) são ESTADUAIS de
// São Paulo, sob a ARTESP -- confirmado em 2026-08-27 (a própria página da
// ABCR já lista essa concessionária com geojson null; o problema não é o
// scraper). A ARTESP tem dataset aberto de malha rodoviária
// (dadosabertos.artesp.sp.gov.br/dataset/malha-rodoviaria, 19 KMZ por
// concessionária) mas SEM WFS/API e SEM arquivo pra essa concessão (recente
// demais, iniciou operação em 2025-03-27, não está nos 19 KMZ publicados).
//
// Fonte usada: OpenStreetMap (Overpass API), que já tem essas rodovias
// mapeadas com boa geometria via `ref` (SP-270/SP-280/SP-029). Km oficiais
// de cada trecho (fonte: reportagens sobre a outorga, 2026-08-27 --
// ver docs/superpowers/specs/2026-08-27-tracado-rodovias-antt-dnit-handoff.md):
//   SP-270 (Raposo Tavares): km 10,9 (São Paulo) a km 34 (Cotia)
//   SP-280 (Castello Branco): km 13,2 (São Paulo) a km 54,1 (Araçariguama)
//   SP-029 (Cel. PM Nelson Tranchesi): km 34,5 (Jandira) a km 43,7 (Cotia)
// O OSM não carrega km de rodovia estadual como atributo -- **a faixa de
// longitude abaixo é uma APROXIMAÇÃO geográfica** dessas faixas de km
// (não um recorte exato por km), calibrada com os municípios de origem/fim
// de cada trecho (geocodificados via Nominatim) -- documentado por trecho
// abaixo. Roda manualmente, mesmo padrão de atualizar-tracado-antt-dnit.js.

const https = require('https');
const fs = require('fs');
const path = require('path');
const { simplificarCoordenadas } = require('./concessoes-rodovias.js');
const { douglasPeucker } = require('./atualizar-tracado-antt-dnit.js');

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const TOLERANCIA_SIMPLIFICACAO_GRAUS = 0.0005; // mesma tolerância do módulo ANTT/DNIT

// { ref, bbox: [sul, oeste, norte, leste], lonMin, lonMax } -- bbox restringe
// a consulta à região metropolitana de SP (evita trazer a rodovia inteira,
// que segue bem além); lonMin/lonMax recorta pro trecho da concessão dentro
// dessa região (rodovias correm ~leste->oeste aqui, então longitude aproxima
// posição ao longo da via).
const TRECHOS_OSM = [
  {
    ref: 'SP-270', bbox: [-23.7, -47.05, -23.45, -46.7],
    // km 10,9 (SP) a km 34 (Cotia) -- limite oeste no centro de Cotia
    // (-46.9189, geocodificado), limite leste ~2km a mais que o km0 puro
    // pra aproximar o início em km10,9 sem precisar de referência linear.
    lonMin: -46.92, lonMax: -46.80,
  },
  {
    ref: 'SP-280', bbox: [-23.65, -47.15, -23.35, -46.7],
    // km 13,2 (SP) a km 54,1 (Araçariguama) -- limite oeste perto do centro
    // de Araçariguama (-47.0613, geocodificado), limite leste análogo ao de
    // cima.
    lonMin: -47.06, lonMax: -46.80,
  },
  {
    ref: 'SP-029', bbox: [-23.65, -47.0, -23.45, -46.75],
    // km 34,5 (Jandira) a km 43,7 (Cotia) -- os dois municípios são
    // pequenos e vizinhos; usa o bbox inteiro sem recorte extra de
    // longitude, risco de imprecisão aceito (via curta, ~9 km).
    lonMin: null, lonMax: null,
  },
];

function buscarOverpass(query) {
  return new Promise((resolve, reject) => {
    var body = query;
    var req = https.request(OVERPASS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'orcamento-dashboard-tracado-raposo-castello/1.0',
      },
      timeout: 90000,
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('Overpass respondeu ' + res.statusCode));
        return;
      }
      var chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (e) {
          reject(new Error('Overpass devolveu JSON inválido: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', function () { this.destroy(new Error('timeout Overpass')); });
    req.write(body);
    req.end();
  });
}

function montarQuery(ref, bbox) {
  var b = bbox.join(',');
  return '[out:json][timeout:60];(way["ref"~"' + ref + '"]["highway"](' + b + '););out geom;';
}

async function buscarOverpassComRetentativa(query, tentativas) {
  var n = tentativas || 3;
  for (var i = 0; i < n; i++) {
    try {
      return await buscarOverpass(query);
    } catch (e) {
      if (i === n - 1) throw e;
      console.warn('  (falha, tentando de novo em 15s: ' + e.message + ')');
      await new Promise((r) => setTimeout(r, 15000));
    }
  }
}

async function resolverTrecho(trecho) {
  var resposta = await buscarOverpassComRetentativa(montarQuery(trecho.ref, trecho.bbox));
  var linhas = [];
  (resposta.elements || []).forEach(function (el) {
    if (!el.geometry) return;
    var coords = el.geometry.map(function (pt) { return [pt.lon, pt.lat]; });
    if (trecho.lonMin != null) {
      coords = coords.filter(function (c) { return c[0] >= trecho.lonMin && c[0] <= trecho.lonMax; });
    }
    if (coords.length >= 2) linhas.push(douglasPeucker(coords, TOLERANCIA_SIMPLIFICACAO_GRAUS));
  });
  return linhas;
}

async function main() {
  var todasAsLinhas = [];
  for (var i = 0; i < TRECHOS_OSM.length; i++) {
    var t = TRECHOS_OSM[i];
    process.stdout.write('Resolvendo ' + t.ref + '... ');
    var linhas = await resolverTrecho(t);
    console.log(linhas.length + ' segmento(s)');
    todasAsLinhas = todasAsLinhas.concat(linhas);
    // Overpass tem rate-limit por IP -- pausa entre consultas evita 429.
    if (i < TRECHOS_OSM.length - 1) await new Promise((r) => setTimeout(r, 15000));
  }
  if (todasAsLinhas.length === 0) {
    console.error('Nenhum segmento resolvido -- não grava nada.');
    process.exitCode = 1;
    return;
  }
  var geojson = simplificarCoordenadas({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: todasAsLinhas } }],
  }, 5);
  var destino = path.join(__dirname, 'tracado-raposo-castello-resolvido.json');
  fs.writeFileSync(destino, JSON.stringify(geojson, null, 2) + '\n');
  console.log('Gravado em ' + destino);
}

if (require.main === module) {
  main().catch(function (e) { console.error(e); process.exitCode = 1; });
}

module.exports = { resolverTrecho, montarQuery, TRECHOS_OSM };
