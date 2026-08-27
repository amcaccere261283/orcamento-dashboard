'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  simplificarCoordenadas, extrairConcessoesRodovias,
  mesclarConcessionariasExtras, CONCESSIONARIAS_EXTRA_ANTT,
} = require('../tools/semanal/concessoes-rodovias.js');

test('simplificarCoordenadas arredonda coordenadas de um LineString a 5 casas', () => {
  const fc = {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: {
      type: 'LineString',
      coordinates: [[-46.720280999999999949, -23.508509000000000099], [-46.736414, -23.488526]],
    } }],
  };
  const resultado = simplificarCoordenadas(fc, 5);
  assert.deepStrictEqual(resultado.features[0].geometry.coordinates, [[-46.72028, -23.50851], [-46.73641, -23.48853]]);
});

test('simplificarCoordenadas não muta o objeto de entrada', () => {
  const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-46.123456, -23.654321]] } }] };
  const original = JSON.parse(JSON.stringify(fc));
  simplificarCoordenadas(fc, 5);
  assert.deepStrictEqual(fc, original);
});

test('simplificarCoordenadas trata MultiLineString', () => {
  const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: {
    type: 'MultiLineString',
    coordinates: [[[-46.123456, -23.654321]], [[-47.111111, -24.222222]]],
  } }] };
  const resultado = simplificarCoordenadas(fc, 3);
  assert.deepStrictEqual(resultado.features[0].geometry.coordinates, [[[-46.123, -23.654]], [[-47.111, -24.222]]]);
});

test('simplificarCoordenadas com entrada nula devolve nulo, nunca lança', () => {
  assert.strictEqual(simplificarCoordenadas(null, 5), null);
  assert.strictEqual(simplificarCoordenadas(undefined, 5), null);
});

function htmlFixture() {
  // Réplica MÍNIMA e válida da estrutura real (confirmada ao vivo em 2026-08-27
  // via curl + Playwright contra melhoresrodovias.org.br/mapa-de-concessoes/):
  // dois literais JS `const CONCESS = [...]` e `const ROADS = [...]` dentro de um
  // <script> inline, sem nenhum fetch/endpoint separado. `geojson` em ROADS é uma
  // STRING (o site serializa o FeatureCollection como JSON dentro do JSON).
  const concess = JSON.stringify([
    { id: '10', nome: 'Autoban', slug: 'autoban', cor: '#662d91' },
    { id: '15', nome: 'Sorocabana', slug: 'sorocabana', cor: '#662d91' },
    { id: '99', nome: 'Sem Trecho LTDA', slug: 'sem-trecho', cor: '#000000' },
  ]);
  const geojsonAutoban1 = JSON.stringify({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: [], geometry: { type: 'LineString', coordinates: [[-46.720280999999999949, -23.508509000000000099]] } }],
  });
  const geojsonAutoban2 = JSON.stringify({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: [], geometry: { type: 'LineString', coordinates: [[-46.111111111, -23.222222222]] } }],
  });
  const roads = JSON.stringify([
    { id: '8', nome: 'Trecho 1', slug: 'trecho-1', concessionaria_id: '10', geojson: geojsonAutoban1 },
    { id: '9', nome: 'Trecho 2', slug: 'trecho-2', concessionaria_id: '10', geojson: geojsonAutoban2 },
  ]).slice(1, -1); // vira os DOIS objetos "soltos" pra montar o array combinado abaixo
  return `<html><body><script>
    const CONCESS = ${concess};
    const ROADS = [${roads}];
  </script></body></html>`;
}

test('extrairConcessoesRodovias monta uma entrada por concessionária, mesclando trechos', () => {
  const resultado = extrairConcessoesRodovias(htmlFixture());
  assert.strictEqual(resultado.length, 3);
  const autoban = resultado.find((c) => c.id === '10');
  assert.strictEqual(autoban.nome, 'Autoban');
  assert.strictEqual(autoban.geojson.features.length, 2, 'dois trechos de ROADS mesclados num FeatureCollection só');
  assert.deepStrictEqual(autoban.geojson.features[0].geometry.coordinates, [[-46.72028, -23.50851]]);
});

test('extrairConcessoesRodovias devolve geojson null pra concessionária sem trecho em ROADS', () => {
  const resultado = extrairConcessoesRodovias(htmlFixture());
  const semTrecho = resultado.find((c) => c.id === '99');
  assert.strictEqual(semTrecho.geojson, null);
});

test('extrairConcessoesRodovias ordena por nome (localeCompare pt-BR)', () => {
  const resultado = extrairConcessoesRodovias(htmlFixture());
  assert.deepStrictEqual(resultado.map((c) => c.nome), ['Autoban', 'Sem Trecho LTDA', 'Sorocabana']);
});

test('extrairConcessoesRodovias lança com mensagem clara se CONCESS não existir no HTML', () => {
  assert.throws(() => extrairConcessoesRodovias('<html><body>nada aqui</body></html>'), /CONCESS/);
});

test('extrairConcessoesRodovias trata geojson malformado sem lançar, pulando o trecho', () => {
  const concess = JSON.stringify([
    { id: '10', nome: 'Autoban', slug: 'autoban', cor: '#662d91' },
    { id: '15', nome: 'Sorocabana', slug: 'sorocabana', cor: '#662d91' },
  ]);
  const geojsonValido = JSON.stringify({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: [], geometry: { type: 'LineString', coordinates: [[-46.720280999999999949, -23.508509000000000099]] } }],
  });
  const geojsonMalformado = '{quebrado'; // JSON inválido
  const roads = JSON.stringify([
    { id: '8', nome: 'Trecho 1', slug: 'trecho-1', concessionaria_id: '10', geojson: geojsonMalformado },
    { id: '9', nome: 'Trecho 2', slug: 'trecho-2', concessionaria_id: '15', geojson: geojsonValido },
  ]).slice(1, -1);
  const html = `<html><body><script>
    const CONCESS = ${concess};
    const ROADS = [${roads}];
  </script></body></html>`;

  const resultado = extrairConcessoesRodovias(html);
  assert.strictEqual(resultado.length, 2);
  const autoban = resultado.find((c) => c.id === '10');
  assert.strictEqual(autoban.geojson, null, 'concessionária com só trecho malformado tem geojson null');
  const sorocabana = resultado.find((c) => c.id === '15');
  assert.strictEqual(sorocabana.geojson.features.length, 1, 'trecho válido de outra concessionária permanece');
});

// --- mesclarConcessionariasExtras (lista manual coletada da ANTT, 2026-08-27) ---

test('mesclarConcessionariasExtras junta as duas listas e reordena por nome', () => {
  const lista = [{ id: '10', nome: 'Sorocabana', slug: 's', cor: '#000', geojson: null }];
  const extras = [{ id: 'antt-autopista-fluminense', nome: 'Autopista Fluminense', slug: null, cor: null, geojson: null }];
  const resultado = mesclarConcessionariasExtras(lista, extras);
  assert.deepStrictEqual(resultado.map((c) => c.nome), ['Autopista Fluminense', 'Sorocabana']);
});

test('mesclarConcessionariasExtras não deduplica nomes PARECIDOS (só idênticos) -- as duas convivem', () => {
  const lista = [{ id: '22', nome: 'Fluminense', slug: 'fluminense', cor: '#000', geojson: null }];
  const extras = [{ id: 'antt-autopista-fluminense', nome: 'Autopista Fluminense', slug: null, cor: null, geojson: null }];
  const resultado = mesclarConcessionariasExtras(lista, extras);
  assert.strictEqual(resultado.length, 2, 'as duas entram, mesmo sendo (provavelmente) o mesmo grupo com nome diferente');
});

test('mesclarConcessionariasExtras deduplica nome IDÊNTICO -- a extra é descartada, a de lista (que pode ter geojson) vence', () => {
  const lista = [{ id: '10', nome: 'Ecovias Araguaia', slug: 'ecovias-araguaia', cor: '#007a3d', geojson: { type: 'FeatureCollection', features: [] } }];
  const extras = [{ id: 'antt-ecovias-araguaia', nome: 'Ecovias Araguaia', slug: null, cor: null, geojson: null }];
  const resultado = mesclarConcessionariasExtras(lista, extras);
  assert.strictEqual(resultado.length, 1, 'nome idêntico -- a extra some, não duplica');
  assert.strictEqual(resultado[0].id, '10', 'sobrevive a entrada original (com geojson), não a extra sem geojson');
});

test('mesclarConcessionariasExtras com extras vazio/ausente devolve só a lista original, reordenada', () => {
  const lista = [
    { id: '2', nome: 'Zeta', slug: 'z', cor: '#000', geojson: null },
    { id: '1', nome: 'Alfa', slug: 'a', cor: '#000', geojson: null },
  ];
  assert.deepStrictEqual(mesclarConcessionariasExtras(lista).map((c) => c.nome), ['Alfa', 'Zeta']);
  assert.deepStrictEqual(mesclarConcessionariasExtras(lista, []).map((c) => c.nome), ['Alfa', 'Zeta']);
});

test('CONCESSIONARIAS_EXTRA_ANTT tem 35 entradas, todas com geojson null e id prefixado antt-', () => {
  assert.strictEqual(CONCESSIONARIAS_EXTRA_ANTT.length, 35);
  CONCESSIONARIAS_EXTRA_ANTT.forEach((c) => {
    assert.strictEqual(c.geojson, null);
    assert.match(c.id, /^antt-[a-z0-9-]+$/);
    assert.ok(c.nome && c.nome.length > 0);
  });
  const ids = CONCESSIONARIAS_EXTRA_ANTT.map((c) => c.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'nenhum id repetido dentro da lista extra');
});
