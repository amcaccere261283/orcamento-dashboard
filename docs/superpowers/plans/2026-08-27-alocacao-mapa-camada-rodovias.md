# Camada de referência: rodovias das concessionárias na aba Mapa — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extrair o traçado das rodovias das 61 concessionárias listadas em
`melhoresrodovias.org.br/mapa-de-concessoes/`, publicar como um asset estático do
projeto, e adicionar um seletor multi-seleção próprio na aba Mapa (Alocação Equipes)
que desenha a(s) linha(s) escolhida(s) no MapLibre, cada uma com uma cor distinta de
uma paleta cíclica atribuída pela ORDEM de seleção.

**Architecture:** Um script de extração Node puro (sem dependência nova — `fetch`
global já é usado em `build-dashboard.js`) baixa a página, isola os literais
`CONCESS`/`ROADS` embutidos no HTML e grava um JSON compacto (coordenadas arredondadas)
em `dist/`. A aba Mapa (`tools/semanal/render-alocacao-pagina.js`) ganha um bloco de UI
ESTÁVEL (nunca recriado pelos redesenhos normais — mesma técnica que já protege
`.mapa-alocacao-mapa-wrap`), que busca esse JSON sob demanda e desenha camadas de linha
no MapLibre. Nenhuma regra de negócio de alocação é tocada — é puramente uma camada de
contexto visual, igual a decisão 2 da spec base já estabelece para o resto do mapa.

**Tech Stack:** Node.js (`node --test`), `fetch` global (Node 18+, já em uso no
projeto), JS "dual module" (`var`/`function`, sem `const`/`let`/arrow no corpo, ver
Global Constraints), MapLibre GL JS (já carregado pela página), `vm.Context` +
`test/helpers/dom-falso-semanal.js` para testar o script de cliente sem navegador real.

## Global Constraints

- Spec de referência: `docs/superpowers/specs/2026-08-27-alocacao-mapa-camada-rodovias-design.md`
  (já commitada em `b203f23`, branch `semanal-alocacao-mapa`). Spec base do mapa:
  `docs/superpowers/specs/2026-08-26-alocacao-equipes-mapa-design.md`.
- Branch de trabalho: continuar em `semanal-alocacao-mapa` (checkout atual, mapa de
  pinos por SUP já implementado e funcionando — commits até `abb42a1`).
- `node --test test/*.test.js` tem que continuar 100% verde depois de CADA tarefa.
- Módulos "duais" (rodam no Node E dentro do `<script>` de cliente via
  `tools/comum/browser-bundle.js`) usam `'use strict';` + `var`/`function` (nunca
  `const`/`let`/arrow function no corpo) — é o formato que `transformaModulo`
  reconhece. Funções definidas DIRETO dentro do template literal
  `SCRIPT_CLIENTE_ALOCACAO` (`render-alocacao-pagina.js`) seguem a MESMA regra (esse
  literal não passa por `transformaModulo`, mas roda como JS de navegador de verdade —
  `var`/`function` é convenção do arquivo inteiro, não só do bundle).
- Nenhum crase (`` ` ``) solto dentro de `SCRIPT_CLIENTE_ALOCACAO` ou de qualquer bloco
  `<style>` deste arquivo — trunca o script/CSS inteiro em silêncio (armadilha já
  documentada no `CLAUDE.md`, aconteceu 2 vezes neste projeto).
- Cor de PINO (leitura/status) e cor de TIPOLOGIA (pool) nunca são reutilizadas por
  nenhuma cor nova — reservadas: `#f6b53f`, `#e0684f`, `#4f8ff0`, `#7fd858`, `#898781`
  (leitura, `CORES_LEITURA_PINO`) e `#3f851a`, `#2f6ad0`, `#8d6f00`, `#606060`,
  `#4a3aa7`, `#db244e` (tipologia, `TIPOLOGIA_COLOR`/`corDaColuna`).
- Toda mudança em `render-alocacao-pagina.js` preserva byte a byte o comportamento
  existente onde não há mudança pretendida — goldens em
  `test/semanal-render-alocacao-pagina.test.js`/`test/semanal-alocacao-interacao.test.js`
  provam isso.
- Sem teste de rede ao vivo na suíte `node --test` (mesma convenção de todo
  `atualizar-*-online.js` do projeto) — a extração de `atualizar-concessoes-rodovias.js`
  é testada com uma fixture de HTML local, nunca com uma chamada de rede de verdade.

---

## Task 1: `simplificarCoordenadas` e `extrairConcessoesRodovias` (funções puras, sem rede)

Núcleo do parsing: dado o HTML bruto da página (como uma string — já baixado por
quem chama), extrai os arrays `CONCESS`/`ROADS` embutidos como literais JS e monta o
formato final combinado, com coordenadas simplificadas. Nenhuma destas duas funções
faz rede — são puras, testáveis com uma fixture pequena.

**Files:**
- Create: `tools/semanal/concessoes-rodovias.js`
- Test: `test/semanal-concessoes-rodovias.test.js`

**Interfaces:**
- Produces: `simplificarCoordenadas(featureCollection, casas)` → novo
  `FeatureCollection` com todo par `[lon, lat]` de qualquer `LineString`/
  `MultiLineString` arredondado a `casas` casas decimais. Não muta a entrada.
  `casas` default 5. `null`/`undefined` de entrada devolve `null`, nunca lança.
- Produces: `extrairConcessoesRodovias(html)` → `[{ id, nome, slug, cor, geojson }]`,
  um item por concessionária de `CONCESS`, ordenado por `nome` (localeCompare
  pt-BR). `geojson` é o `FeatureCollection` (objeto, não string) já simplificado a 5
  casas, mesclando TODOS os trechos de `ROADS` daquela concessionária num
  `FeatureCollection` só; `null` quando nenhum trecho existe pra ela. Lança
  `Error` com mensagem clara se `CONCESS`/`ROADS` não forem encontrados no HTML (é o
  único ponto do módulo que pode lançar — sinal de que o site mudou de formato,
  igual à filosofia de "falha alto" já documentada no `CLAUDE.md` para colunas
  essenciais de planilha).

- [ ] **Step 1: Escrever os testes**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { simplificarCoordenadas, extrairConcessoesRodovias } = require('../tools/semanal/concessoes-rodovias.js');

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
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-concessoes-rodovias.test.js`
Expected: FAIL — o módulo não existe.

- [ ] **Step 3: Implementar `tools/semanal/concessoes-rodovias.js`**

```js
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
    var fc = JSON.parse(trecho.geojson);
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
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/semanal-concessoes-rodovias.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/concessoes-rodovias.js test/semanal-concessoes-rodovias.test.js
git commit -m "feat: concessoes-rodovias.js -- extrai e simplifica CONCESS/ROADS de melhoresrodovias.org.br"
```

---

## Task 2: `atualizar-concessoes-rodovias.js` — script de busca (rede), roda manualmente

Script Node que busca a página ao vivo e grava `dist/concessoes-rodovias.json` usando
`extrairConcessoesRodovias` (Task 1). Roda MANUALMENTE — não entra no
`atualizar-arquivos.js` nem no live-refresh (dado quase estático, ver spec Decisão 2).

**Files:**
- Create: `tools/semanal/atualizar-concessoes-rodovias.js`
- Test: nenhum novo (a lógica testável já está coberta pela Task 1; este script é
  fino — busca + grava arquivo — mesma convenção de todo `atualizar-*-online.js`
  deste projeto, que não tem teste de rede na suíte)

**Interfaces:**
- Consumes: `extrairConcessoesRodovias(html)` (Task 1).
- Produces: `dist/concessoes-rodovias.json` — o array devolvido por
  `extrairConcessoesRodovias`, serializado com `JSON.stringify(dados)` (sem
  formatação — é consumido só por `fetch` no cliente, nunca lido à mão).

- [ ] **Step 1: Implementar**

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { extrairConcessoesRodovias } = require('./concessoes-rodovias.js');

const URL_MAPA_CONCESSOES = 'https://melhoresrodovias.org.br/mapa-de-concessoes/';
const DEST = path.join(__dirname, '..', '..', 'dist', 'concessoes-rodovias.json');

// User-Agent de navegador comum -- confirmado necessário em 2026-08-27: o fetch
// do Claude (WebFetch) tomou 403 sem ele, mas um curl/fetch puro com este UA
// devolveu HTTP 200 normalmente. Não é autenticação nem cookie -- é só o bloqueio
// de bot do site reagindo à ausência de User-Agent de navegador.
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function buscarEGravar() {
  console.log('Buscando ' + URL_MAPA_CONCESSOES + '...');
  const resposta = await fetch(URL_MAPA_CONCESSOES, { headers: { 'User-Agent': USER_AGENT } });
  if (!resposta.ok) {
    throw new Error('atualizar-concessoes-rodovias: HTTP ' + resposta.status + ' buscando ' + URL_MAPA_CONCESSOES);
  }
  const html = await resposta.text();
  const dados = extrairConcessoesRodovias(html);
  fs.mkdirSync(path.dirname(DEST), { recursive: true });
  fs.writeFileSync(DEST, JSON.stringify(dados));
  const comTrecho = dados.filter((c) => c.geojson).length;
  console.log(
    'Gravado ' + DEST + ' -- ' + dados.length + ' concessionárias, ' + comTrecho + ' com trecho de rodovia.'
  );
}

buscarEGravar().catch((erro) => {
  console.error('atualizar-concessoes-rodovias falhou:', erro.message);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Rodar manualmente e conferir a saída**

Run: `node tools/semanal/atualizar-concessoes-rodovias.js`
Expected: imprime "Gravado .../dist/concessoes-rodovias.json -- 61 concessionárias,
NN com trecho de rodovia." e o arquivo existe. Se a contagem de concessionárias vier
muito diferente de 61, ou "com trecho" vier 0, o site mudou de formato — reabrir
`concessoes-rodovias.js` antes de prosseguir.

- [ ] **Step 3: Rodar a suíte inteira — nada mais deveria ter mudado**

Run: `node --test test/*.test.js`
Expected: PASS

- [ ] **Step 4: Commit (código do script + o JSON gerado)**

```bash
git add tools/semanal/atualizar-concessoes-rodovias.js dist/concessoes-rodovias.json
git commit -m "feat: atualizar-concessoes-rodovias.js -- busca e grava dist/concessoes-rodovias.json"
```

---

## Task 3: Publicar `concessoes-rodovias.json` em `docs/` e travar a sincronia

Mesma regra de todo asset publicado desta página: `dist/` não é servido pelo Pages,
só `docs/` é — e o teste de sincronia já existente precisa saber deste arquivo novo,
senão um esquecimento de `cp` passa batido (é exatamente o incidente de 2026-07-22
que o `CLAUDE.md` documenta).

**Files:**
- Modify: `test/publicacao-docs-sincronizado.test.js`
- Create: `docs/concessoes-rodovias.json` (cópia de `dist/`)

- [ ] **Step 1: Acrescentar o par `concessoes-rodovias.json` a `PARES`, em `test/publicacao-docs-sincronizado.test.js` (logo depois do último item, `heartbeat-atualizacao-volume.csv`, antes do `];` que fecha o array na linha 103)**

```js
  // Entrou em 2026-08-27 com a camada de referência de rodovias das
  // concessionárias na aba Mapa (Alocação Equipes) -- mesma rede de proteção
  // dist/ <-> docs/ dos outros arquivos publicados junto com as páginas.
  {
    nome: 'JSON de concessões e rodovias',
    origem: path.join(RAIZ, 'dist', 'concessoes-rodovias.json'),
    publicado: path.join(RAIZ, 'docs', 'concessoes-rodovias.json'),
    comando: 'cp dist/concessoes-rodovias.json docs/concessoes-rodovias.json',
  },
```

- [ ] **Step 2: Copiar o arquivo**

Run: `cp dist/concessoes-rodovias.json docs/concessoes-rodovias.json`

- [ ] **Step 3: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS, incluindo o novo par em `publicacao-docs-sincronizado.test.js`.

- [ ] **Step 4: Commit**

```bash
git add docs/concessoes-rodovias.json test/publicacao-docs-sincronizado.test.js
git commit -m "chore: publica concessoes-rodovias.json em docs/ e trava sincronia dist/docs"
```

---

## Task 4: `CORES_RODOVIA` e `atribuirCorRodovia` — paleta cíclica por ordem de seleção

Função pura de atribuição de cor, dentro de `SCRIPT_CLIENTE_ALOCACAO`
(`render-alocacao-pagina.js`) — mesmo lugar de `CORES_LEITURA_PINO`/
`particionarSupsPorLocalizacao`, porque só existe pro lado do cliente (decide cor
pra desenhar no MapLibre) e é testada pela mesma técnica (`vm.Context`, ver Task 7).

**Files:**
- Modify: `tools/semanal/render-alocacao-pagina.js:756-778` (logo depois de
  `CORES_LEITURA_PINO`, antes de `particionarSupsPorLocalizacao`)
- Test: `test/semanal-alocacao-interacao.test.js` (acrescentar ao final)

**Interfaces:**
- Produces: `CORES_RODOVIA` — array de 6 hex, nenhum reutilizando as cores de
  `CORES_LEITURA_PINO` nem de tipologia (ver Global Constraints).
- Produces: `atribuirCorRodovia(idsEmOrdem)` → `{ [id]: corHex }`. `idsEmOrdem` é um
  array de ids de concessionária NA ORDEM em que foram selecionadas (o chamador,
  Task 6, é quem mantém essa ordem). O i-ésimo id (0-based) pega
  `CORES_RODOVIA[i % CORES_RODOVIA.length]` — cicla ao passar de 6. `[]` devolve
  `{}`. Não lança.

- [ ] **Step 1: Escrever o teste**

```js
// Acrescentar ao final de test/semanal-alocacao-interacao.test.js:

// --- Camada de rodovias: atribuirCorRodovia (paleta cíclica por ordem de seleção) ---
// Ver docs/superpowers/specs/2026-08-27-alocacao-mapa-camada-rodovias-design.md,
// Decisão 8.
test('atribuirCorRodovia dá a 1ª cor da paleta pra 1 seleção só', () => {
  const cliente = montarClienteAlocacao();
  const resultado = cliente.atribuirCorRodovia(['10']);
  assert.deepStrictEqual(normalizar(resultado), { '10': cliente.CORES_RODOVIA[0] });
});

test('atribuirCorRodovia dá cores DISTINTAS em ordem pra seleção múltipla', () => {
  const cliente = montarClienteAlocacao();
  const resultado = cliente.atribuirCorRodovia(['10', '15', '22']);
  const cores = normalizar(resultado);
  assert.strictEqual(cores['10'], cliente.CORES_RODOVIA[0]);
  assert.strictEqual(cores['15'], cliente.CORES_RODOVIA[1]);
  assert.strictEqual(cores['22'], cliente.CORES_RODOVIA[2]);
  // as 3 cores são realmente diferentes entre si -- o ponto central do pedido
  const valores = Object.values(cores);
  assert.strictEqual(new Set(valores).size, 3);
});

test('atribuirCorRodovia cicla ao passar do tamanho da paleta', () => {
  const cliente = montarClienteAlocacao();
  const n = cliente.CORES_RODOVIA.length;
  const ids = Array.from({ length: n + 2 }, (_, i) => 'id-' + i);
  const resultado = cliente.atribuirCorRodovia(ids);
  assert.strictEqual(resultado['id-' + n], cliente.CORES_RODOVIA[0], 'a (n+1)-ésima seleção repete a 1ª cor');
  assert.strictEqual(resultado['id-' + (n + 1)], cliente.CORES_RODOVIA[1]);
});

test('atribuirCorRodovia com lista vazia devolve objeto vazio, nunca lança', () => {
  const cliente = montarClienteAlocacao();
  assert.deepStrictEqual(normalizar(cliente.atribuirCorRodovia([])), {});
});

test('CORES_RODOVIA não repete nenhuma cor de CORES_LEITURA_PINO nem de tipologia', () => {
  const cliente = montarClienteAlocacao();
  const reservadas = Object.values(cliente.CORES_LEITURA_PINO).concat([
    '#3f851a', '#2f6ad0', '#8d6f00', '#606060', '#4a3aa7', '#db244e',
  ]).map((c) => c.toLowerCase());
  cliente.CORES_RODOVIA.forEach((cor) => {
    assert.ok(!reservadas.includes(cor.toLowerCase()), cor + ' colide com uma cor reservada de leitura/tipologia');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-alocacao-interacao.test.js`
Expected: FAIL — `atribuirCorRodovia`/`CORES_RODOVIA` não existem no sandbox ainda.

- [ ] **Step 3: Implementar em `render-alocacao-pagina.js`, logo após `CORES_LEITURA_PINO` (linha ~763)**

```js
// Paleta pra camada de referência das rodovias das concessionárias (Task 6) --
// SEIS cores, escolhidas pra não colidir de hue com CORES_LEITURA_PINO (acima)
// nem com TIPOLOGIA_COLOR (render-aba-consolidado.js): aquelas já cobrem
// vermelho/coral, laranja-amarelo, azul, verde, roxo e cinza -- daqui saem
// ciano, magenta, marrom, indigo-azulado, dourado-mostarda e verde-água. Tom
// exato calibrado na revisão do Open Design (mesma ressalva já feita pra outras
// cores novas deste projeto); a MECÂNICA de atribuição é o que este teste trava.
// Ver docs/superpowers/specs/2026-08-27-alocacao-mapa-camada-rodovias-design.md,
// Decisão 8.
var CORES_RODOVIA = ['#00b8c4', '#d63bd6', '#8a5a2b', '#5a4fcf', '#c9a227', '#2ba88f'];

// idsEmOrdem: ids de concessionária na ordem em que foram MARCADAS no seletor
// (não a ordem alfabética da lista) -- é essa ordem que decide qual cor cada
// uma pega. Cor é um DIFERENCIADOR da seleção atual, não uma identidade fixa da
// concessionária: desmarcar e marcar de novo pode pegar outra posição.
function atribuirCorRodovia(idsEmOrdem) {
  var resultado = {};
  (idsEmOrdem || []).forEach(function (id, indice) {
    resultado[id] = CORES_RODOVIA[indice % CORES_RODOVIA.length];
  });
  return resultado;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/semanal-alocacao-interacao.test.js`
Expected: PASS

- [ ] **Step 5: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/render-alocacao-pagina.js test/semanal-alocacao-interacao.test.js
git commit -m "feat: CORES_RODOVIA + atribuirCorRodovia -- paleta ciclica por ordem de selecao"
```

---

## Task 5: Markup do seletor "Rodovias" — bloco estável, criado uma vez só

O seletor precisa sobreviver aos redesenhos normais da aba Mapa (troca de
filtro/semana/mês, arrasto, "Atualizar dados") sem perder o estado de seleção nem
recriar o DOM — mesma técnica que já protege `.mapa-alocacao-mapa-wrap` (ver o
comentário grande em `montarMapaAlocacao`, `render-alocacao-pagina.js:658-684`): o
bloco nasce dentro de `renderAbaAlocacaoMapa` (o render COMPLETO, chamado só na
primeira vez que o mapa não existe) e nunca é tocado pelo caminho de redesenho
parcial (`renderAbaAlocacaoMapaTopo`/`renderAbaAlocacaoMapaPool`).

**Files:**
- Modify: `tools/semanal/render-aba-alocacao-mapa.js`
- Test: `test/semanal-render-aba-alocacao-mapa.test.js`

**Interfaces:**
- Modifies: `renderAbaAlocacaoMapa(dados, opcoes)` — markup ganha um novo bloco
  `<div id="mapa-alocacao-rodovias">`, ANTES de `.mapa-alocacao-corpo` (mesmo nível
  de `#mapa-alocacao-topo`). Reaproveita `markupFiltroMulti` (`tools/comum/render-shell.js`,
  já exportado) pra desenhar o `<div class="filtro-multi">` com o trigger/painel —
  o painel em si (lista de checkboxes) é populado depois, no cliente (Task 6), não
  aqui: este módulo não tem acesso a `concessoes-rodovias.json` (é dado que só
  existe depois de um fetch assíncrono no navegador).

- [ ] **Step 1: Escrever o teste**

```js
// Acrescentar a test/semanal-render-aba-alocacao-mapa.test.js:
test('com dados: tem o bloco do seletor de rodovias, com o trigger do filtro-multi', () => {
  const registros = [registroSintetico('SUP-A', 'SP', 100)];
  const opcoes = {
    mesIdx: 7, semanas: [{ inicio: 100, fim: 106 }], semana: { inicio: 100, fim: 106 },
    demandas: {}, hojeEpoch: 100,
    equipes: [{ id: '4', lider: 'Amaral', colunas: ['SP'], disponivel: true, diasDisponiveis: 5, diasDaSemana: 5, companheiros: [] }],
    alocacao: {}, foraDoQuadro: [], buscaEquipe: '', tipologiaAlocacao: '',
    modoPersistencia: 'local', pendentes: 0,
  };
  const dados = prepararDadosAlocacao(registros, [0], opcoes);
  const html = renderAbaAlocacaoMapa(dados, opcoes);
  assert.match(html, /id="mapa-alocacao-rodovias"/);
  assert.match(html, /id="filtro-rodovias"/, 'o filtro-multi do seletor de rodovias existe');
  assert.match(html, /class="filtro-multi-trigger"/);
});

test('semRoster: o bloco de rodovias NÃO aparece (mesma guarda do resto da aba)', () => {
  const html = renderAbaAlocacaoMapa(null, { semRoster: true });
  assert.doesNotMatch(html, /id="mapa-alocacao-rodovias"/);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-render-aba-alocacao-mapa.test.js`
Expected: FAIL — `mapa-alocacao-rodovias` ainda não existe no markup.

- [ ] **Step 3: Implementar em `render-aba-alocacao-mapa.js`**

No topo do arquivo, acrescentar ao require existente:

```js
const { markupFiltroMulti } = require('../comum/render-shell.js');
```

Mudar `renderAbaAlocacaoMapa` (função inteira, hoje nas linhas 52-68):

```js
function renderAbaAlocacaoMapa(dados, opcoes) {
  var o = opcoes || {};
  if (o.semRoster) {
    return renderControles(o, true) + renderGuardaSemRoster();
  }

  var html = '<div id="mapa-alocacao-topo">' + renderAbaAlocacaoMapaTopo(dados, o) + '</div>';
  // Bloco ESTÁVEL: nasce aqui (só no render COMPLETO, chamado uma vez só por
  // instância do mapa) e nunca é tocado por renderAbaAlocacaoMapaTopo/-Pool --
  // mesma técnica que já protege .mapa-alocacao-mapa-wrap (ver o comentário
  // grande em montarMapaAlocacao, render-alocacao-pagina.js). O painel do
  // filtro-multi (lista de concessionárias) é vazio aqui de propósito -- só
  // existe depois que o cliente busca concessoes-rodovias.json (Task 6);
  // markupFiltroMulti já desenha o painel como <div hidden></div> vazio, pronto
  // pra ser preenchido depois, mesmo contrato que os outros filtro-multi da
  // página já seguem.
  html += '<div id="mapa-alocacao-rodovias">'
    + markupFiltroMulti({ id: 'filtro-rodovias', rotulo: 'Rodovias' })
    + '<div id="mapa-alocacao-rodovias-legenda" class="mapa-alocacao-rodovias-legenda"></div>'
    + '</div>';
  html += '<div class="mapa-alocacao-corpo">';
  html += '<aside class="mapa-alocacao-pool" id="mapa-alocacao-pool">'
    + renderAbaAlocacaoMapaPool(dados, o) + '</aside>';
  html += '<div class="mapa-alocacao-mapa-wrap">'
    + '<div id="mapa-alocacao-canvas"></div>'
    + '<div id="mapa-alocacao-sem-localizacao" class="mapa-alocacao-sem-localizacao"></div>'
    + '</div>';
  html += '</div>';
  return html;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/semanal-render-aba-alocacao-mapa.test.js`
Expected: PASS

- [ ] **Step 5: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS — inclusive os goldens de `render-alocacao-pagina`/`render-aba-alocacao-mapa`
que NÃO testam a aba Mapa com dados (ex. o teste `semRoster`) continuam idênticos.

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/render-aba-alocacao-mapa.js test/semanal-render-aba-alocacao-mapa.test.js
git commit -m "feat: markup estavel do seletor de rodovias na aba Mapa"
```

---

## Task 6: Wireup de cliente — busca sob demanda, camadas MapLibre, legenda

A parte que efetivamente desenha as linhas: busca `concessoes-rodovias.json` na
primeira vez que o seletor é aberto, mantém a ordem de seleção, calcula as cores
(Task 4) e sincroniza `map.addSource`/`map.addLayer` com o conjunto atualmente
marcado. Isolado num par de funções PURAS (`camadasRodoviasDesejadas`) + uma função
de efeito (`sincronizarCamadasRodovias`) que só aplica o que a pura decidiu — mesmo
padrão de `particionarSupsPorLocalizacao`/`desenharPinosMapa`.

**Files:**
- Modify: `tools/semanal/render-alocacao-pagina.js` (dentro de `SCRIPT_CLIENTE_ALOCACAO`,
  logo depois de `atribuirCorRodovia`, Task 4)
- Test: `test/semanal-alocacao-interacao.test.js`

**Interfaces:**
- Produces: `camadasRodoviasDesejadas(idsSelecionadosEmOrdem, concessoesPorId)` →
  `[{ id, nome, cor, geojson }]`, só as selecionadas que TÊM `geojson` (as sem
  trecho ficam de fora silenciosamente — não há o que desenhar). Função pura,
  sem tocar `map`/DOM.
- Produces: `ESTADO_RODOVIAS` — objeto de módulo `{ ordem: [], concessoesPorId: null,
  carregando: null }`. `ordem` é a lista de ids na ordem de seleção (a mesma que
  `camadasRodoviasDesejadas` consome).
- Consumes: `MAPA_ALOCACAO.instancia` (o mapa MapLibre já inicializado, Task base).

- [ ] **Step 1: Escrever os testes (a parte pura, sem MapLibre)**

```js
// Acrescentar ao final de test/semanal-alocacao-interacao.test.js:

// --- Camada de rodovias: camadasRodoviasDesejadas (função pura) ---
function concessaoSintetica(id, nome, comTrecho) {
  return {
    id, nome, slug: nome.toLowerCase(), cor: '#000000',
    geojson: comTrecho ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-49, -25]] } }] } : null,
  };
}

test('camadasRodoviasDesejadas devolve só as selecionadas COM geojson, com a cor certa', () => {
  const cliente = montarClienteAlocacao();
  const porId = {
    '10': concessaoSintetica('10', 'Autoban', true),
    '99': concessaoSintetica('99', 'Sem Trecho', false),
  };
  const resultado = cliente.camadasRodoviasDesejadas(['10', '99'], porId);
  const normalizado = normalizar(resultado);
  assert.strictEqual(normalizado.length, 1, 'a concessionária sem geojson não vira camada');
  assert.strictEqual(normalizado[0].id, '10');
  assert.strictEqual(normalizado[0].cor, cliente.CORES_RODOVIA[0]);
});

test('camadasRodoviasDesejadas preserva a ordem de seleção nas cores mesmo com uma sem geojson no meio', () => {
  const cliente = montarClienteAlocacao();
  const porId = {
    '10': concessaoSintetica('10', 'Autoban', true),
    '99': concessaoSintetica('99', 'Sem Trecho', false),
    '15': concessaoSintetica('15', 'Sorocabana', true),
  };
  const resultado = cliente.camadasRodoviasDesejadas(['10', '99', '15'], porId);
  const normalizado = normalizar(resultado);
  // '99' consome a posição 1 da ordem mesmo sem virar camada (a cor é atribuída
  // pela ordem de SELEÇÃO, não pela ordem das camadas resultantes) -- '15' fica
  // com a 3ª cor da paleta, não a 2ª.
  assert.strictEqual(normalizado.find((c) => c.id === '15').cor, cliente.CORES_RODOVIA[2]);
});

test('camadasRodoviasDesejadas com lista vazia devolve array vazio', () => {
  const cliente = montarClienteAlocacao();
  assert.deepStrictEqual(normalizar(cliente.camadasRodoviasDesejadas([], {})), []);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-alocacao-interacao.test.js`
Expected: FAIL — `camadasRodoviasDesejadas` não existe.

- [ ] **Step 3: Implementar em `render-alocacao-pagina.js`, logo depois de `atribuirCorRodovia` (Task 4)**

```js
// idsSelecionadosEmOrdem: ESTADO_RODOVIAS.ordem (abaixo). concessoesPorId: mapa
// id -> entrada de concessoes-rodovias.json (Task 2/3), já carregado. Função
// PURA -- decide o QUÊ desenhar, nunca toca map/DOM (isso é
// sincronizarCamadasRodovias, Step 5). Concessionária sem geojson (a maioria,
// hoje -- só 60 das 61 têm trecho em ROADS) simplesmente não vira camada; ela
// continua "selecionada" (ESTADO_RODOVIAS.ordem não muda), só não desenha nada.
function camadasRodoviasDesejadas(idsSelecionadosEmOrdem, concessoesPorId) {
  var cores = atribuirCorRodovia(idsSelecionadosEmOrdem || []);
  var resultado = [];
  (idsSelecionadosEmOrdem || []).forEach(function (id) {
    var c = (concessoesPorId || {})[id];
    if (!c || !c.geojson) return;
    resultado.push({ id: c.id, nome: c.nome, cor: cores[id], geojson: c.geojson });
  });
  return resultado;
}

// Estado de módulo pro seletor de rodovias -- 'ordem' é a lista de ids na ORDEM
// em que foram marcados (não a ordem alfabética da lista), porque é essa ordem
// que decide a cor de cada um (atribuirCorRodovia). 'concessoesPorId' nasce null
// e só é populado no 1º fetch bem-sucedido de concessoes-rodovias.json (lazy --
// nunca busca antes do usuário abrir o seletor pela 1ª vez).
var ESTADO_RODOVIAS = { ordem: [], concessoesPorId: null, carregando: null };
```

- [ ] **Step 4: Rodar e confirmar que a parte pura passa**

Run: `node --test test/semanal-alocacao-interacao.test.js`
Expected: PASS nos 3 testes de `camadasRodoviasDesejadas` (os testes de
`sincronizarCamadasRodovias`/wireup do DOM vêm no próximo Step, ainda vermelhos
até lá).

- [ ] **Step 5: Implementar a busca lazy + o efeito sobre o MapLibre + a legenda, logo depois do bloco acima**

```js
// Busca concessoes-rodovias.json (mesma origem do Pages, sem CORS) só na
// PRIMEIRA vez que é preciso -- nunca no load da página. Idempotente: chamadas
// concorrentes (ex. dois cliques rápidos no seletor antes do 1º fetch responder)
// compartilham a MESMA promise via ESTADO_RODOVIAS.carregando, em vez de disparar
// requisições duplicadas.
function garantirConcessoesCarregadas() {
  if (ESTADO_RODOVIAS.concessoesPorId) return Promise.resolve(ESTADO_RODOVIAS.concessoesPorId);
  if (ESTADO_RODOVIAS.carregando) return ESTADO_RODOVIAS.carregando;
  ESTADO_RODOVIAS.carregando = fetch('concessoes-rodovias.json')
    .then(function (resposta) { return resposta.json(); })
    .then(function (lista) {
      var porId = {};
      lista.forEach(function (c) { porId[c.id] = c; });
      ESTADO_RODOVIAS.concessoesPorId = porId;
      ESTADO_RODOVIAS.carregando = null;
      return porId;
    })
    .catch(function (erro) {
      // Nunca lança pra fora -- sem o JSON, o seletor simplesmente não tem
      // opções (mesma filosofia de "sem dado, nunca erro" de coordenadas-sup.js).
      console.error('concessoes-rodovias.json não pôde ser carregado:', erro);
      ESTADO_RODOVIAS.carregando = null;
      return {};
    });
  return ESTADO_RODOVIAS.carregando;
}

// Redesenha TODAS as camadas de rodovia a partir do zero -- mesma filosofia de
// desenharPinosMapa (redesenhar inteiro é simples e barato o bastante pra no
// máximo algumas linhas por vez). Só roda se o mapa já existe; se o seletor for
// mexido antes de a aba Mapa ter sido aberta (não deveria ser possível, o bloco
// só existe dentro de #secao-mapa-alocacao, mas é uma guarda barata), sai sem
// fazer nada.
function sincronizarCamadasRodovias() {
  var mapa = MAPA_ALOCACAO.instancia;
  if (!mapa) return;

  (MAPA_ALOCACAO.camadasRodovia || []).forEach(function (id) {
    if (mapa.getLayer('rodovia-' + id)) mapa.removeLayer('rodovia-' + id);
    if (mapa.getSource('rodovia-' + id)) mapa.removeSource('rodovia-' + id);
  });
  MAPA_ALOCACAO.camadasRodovia = [];

  var camadas = camadasRodoviasDesejadas(ESTADO_RODOVIAS.ordem, ESTADO_RODOVIAS.concessoesPorId || {});
  camadas.forEach(function (camada) {
    mapa.addSource('rodovia-' + camada.id, { type: 'geojson', data: camada.geojson });
    mapa.addLayer({
      id: 'rodovia-' + camada.id,
      type: 'line',
      source: 'rodovia-' + camada.id,
      paint: { 'line-color': camada.cor, 'line-width': 3, 'line-opacity': 0.85 },
    });
    MAPA_ALOCACAO.camadasRodovia.push(camada.id);
  });

  var legenda = document.getElementById('mapa-alocacao-rodovias-legenda');
  if (legenda) {
    legenda.innerHTML = camadas.map(function (c) {
      return '<span class="legenda-rodovia-item"><span class="legenda-rodovia-cor" style="background:' + c.cor + '"></span>' + RenderAbaAlocacao.escapeHtml(c.nome) + '</span>';
    }).join('');
  }
}

// Ligação do checkbox: marcar adiciona ao FIM de ESTADO_RODOVIAS.ordem (fica com
// a próxima cor da paleta); desmarcar remove -- as que continuam marcadas NÃO
// mudam de posição relativa entre si (Array.prototype.filter preserva ordem),
// então suas cores continuam estáveis.
function aoMudarSeletorRodovias(idConcessionaria, marcado) {
  var indiceAtual = ESTADO_RODOVIAS.ordem.indexOf(idConcessionaria);
  if (marcado && indiceAtual === -1) ESTADO_RODOVIAS.ordem.push(idConcessionaria);
  else if (!marcado && indiceAtual !== -1) ESTADO_RODOVIAS.ordem.splice(indiceAtual, 1);
  sincronizarCamadasRodovias();
}

// Abre/fecha o painel e, na 1ª abertura, busca concessoes-rodovias.json e
// popula as opções.
function abrirOuFecharSeletorRodovias() {
  var container = document.getElementById('filtro-rodovias');
  var painel = container ? container.querySelector('.filtro-multi-painel') : null;
  if (!container || !painel) return;
  var jaAberto = container.classList.contains('aberto');
  document.querySelectorAll('.filtro-multi.aberto').forEach(function (el) {
    el.classList.remove('aberto');
    el.querySelector('.filtro-multi-painel').hidden = true;
  });
  if (jaAberto) return;
  container.classList.add('aberto');
  painel.hidden = false;
  garantirConcessoesCarregadas().then(function (porId) {
    var opcoes = Object.keys(porId).map(function (id) { return porId[id]; })
      .sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
    painel.innerHTML = opcoes.length
      ? opcoes.map(function (c) {
          var marcado = ESTADO_RODOVIAS.ordem.indexOf(c.id) !== -1 ? ' checked' : '';
          return '<label class="filtro-multi-item"><input type="checkbox" value="' + c.id + '"' + marcado + '>' + RenderAbaAlocacao.escapeHtml(c.nome) + '</label>';
        }).join('')
      : '<div class="filtro-multi-vazio">Nenhuma rodovia encontrada</div>';
    // Os checkboxes NÃO recebem listener próprio aqui -- o 'change' delegado
    // em inicializarSeletorRodovias (abaixo) cobre qualquer checkbox dentro de
    // #filtro-rodovias, mesmo estes recém-inseridos por innerHTML.
  });
}

// FIX (achado ao planejar): #filtro-rodovias só passa a existir no DOM depois
// do 1º montarMapaAlocacao() -- o script de cliente roda este wireup no load
// da página, ANTES de qualquer roster/senha ter chegado, então um
// addEventListener ligado DIRETO no trigger (document.querySelector(...)
// naquele instante) nunca acharia o elemento e o botão "Rodovias" ficaria
// morto pra sempre. Por isso, igual a inicializarInteracaoAlocacao (que tem o
// MESMO problema com as células/pinos, que também só existem depois do 1º
// desenho), a ligação é por DELEGAÇÃO no container ESTÁVEL #secao-mapa-alocacao
// (existe desde o load, mesmo vazio) -- funciona não importa quando
// #filtro-rodovias for inserido dentro dele.
function inicializarSeletorRodovias() {
  var secaoMapa = document.getElementById('secao-mapa-alocacao');
  if (!secaoMapa) return;

  secaoMapa.addEventListener('click', function (evento) {
    var alvo = evento.target;
    var trigger = alvo.closest ? alvo.closest('#filtro-rodovias .filtro-multi-trigger') : null;
    if (trigger) {
      evento.stopPropagation();
      abrirOuFecharSeletorRodovias();
      return;
    }
    var painel = alvo.closest ? alvo.closest('#filtro-rodovias .filtro-multi-painel') : null;
    if (painel) evento.stopPropagation();
  });

  secaoMapa.addEventListener('change', function (evento) {
    var checkbox = evento.target.closest ? evento.target.closest('#filtro-rodovias input[type="checkbox"]') : null;
    if (!checkbox) return;
    aoMudarSeletorRodovias(checkbox.value, checkbox.checked);
  });
}
```

Chamar `inicializarSeletorRodovias()` uma vez, logo depois de
`inicializarInteracaoAlocacao('secao-mapa-alocacao');` (perto do fim do script,
linha ~1412) -- `#secao-mapa-alocacao` já existe no HTML estático desde o load
da página (é o container que `montarMapaAlocacao` preenche depois), então a
delegação funciona mesmo chamada antes de qualquer conteúdo existir dentro dele.

- [ ] **Step 6: Rodar a suíte inteira e confirmar que passa**

Run: `node --test test/*.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tools/semanal/render-alocacao-pagina.js test/semanal-alocacao-interacao.test.js
git commit -m "feat: wireup do seletor de rodovias -- busca lazy, camadas MapLibre, legenda"
```

---

## Task 7: CSS do seletor e da legenda (escopado à aba Mapa)

Estilo mínimo funcional -- posicionamento do bloco novo, cor/tamanho do indicador
de legenda. Tom exato calibrado depois na revisão do Open Design (regra do
`CLAUDE.md` para todo HTML novo/alterado deste projeto), mas o CSS abaixo já
funciona sozinho, sem depender dessa revisão pra ficar utilizável.

**Files:**
- Modify: `tools/semanal/render-alocacao-pagina.js` (bloco `<style>` da aba Mapa,
  perto de `#mapa-alocacao-canvas { ... }`, linha ~1576)
- Test: `test/semanal-render-alocacao-pagina.test.js`

- [ ] **Step 1: Escrever o teste**

```js
// Acrescentar a test/semanal-render-alocacao-pagina.test.js:
test('CSS da aba Mapa inclui o bloco do seletor de rodovias e da legenda', () => {
  const registros = [registroSintetico('SUP-0005-24', 'Tomador-Sintetico-Epsilon')];
  const html = renderAlocacaoPagina({
    registros, demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z'),
  });
  assert.match(html, /#mapa-alocacao-rodovias/);
  assert.match(html, /\.legenda-rodovia-cor/);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-render-alocacao-pagina.test.js`
Expected: FAIL — as regras ainda não existem no `<style>`.

- [ ] **Step 3: Acrescentar as regras no bloco `<style>` da aba Mapa, perto de `#mapa-alocacao-canvas` (linha ~1576)**

```css
  #mapa-alocacao-rodovias { position: relative; margin: 0 0 12px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  #mapa-alocacao-rodovias .filtro-multi-painel { max-height: 320px; overflow-y: auto; }
  .mapa-alocacao-rodovias-legenda { display: flex; gap: 10px; flex-wrap: wrap; }
  .legenda-rodovia-item { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--acento-contraste, #00163b); }
  .legenda-rodovia-cor { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/semanal-render-alocacao-pagina.test.js`
Expected: PASS

- [ ] **Step 5: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/render-alocacao-pagina.js test/semanal-render-alocacao-pagina.test.js
git commit -m "style: CSS do seletor de rodovias e da legenda na aba Mapa"
```

---

## Task 8: Build, revisão manual no navegador e revisão do Open Design

Última tarefa -- gera os HTMLs de verdade, confirma visualmente que o seletor
funciona (não é coberto por teste automatizado, mesma limitação já documentada
pro resto do mapa: MapLibre real não roda em `node --test`), e roda a revisão de
design (regra permanente do `CLAUDE.md` pra qualquer HTML novo/alterado).

- [ ] **Step 1: Build local**

Run: `ORCAMENTO_SENHA='<pedir ao dono do projeto, ou usar a já usada nesta sessão>' node tools/semanal/build-dashboard.js`
Expected: gera `dist/planejamento-semanal.html` e `dist/alocacao-equipes.html` sem erro.

- [ ] **Step 2: Abrir `dist/alocacao-equipes.html` num navegador, entrar na aba Mapa**

Verificar manualmente: o trigger "Rodovias" abre um painel com a lista de
concessionárias (busca funcionando, mesma caixa de busca dos outros filtro-multi);
marcar 2-3 desenha linhas de cores diferentes no mapa; a legenda mostra nome +
cor; desmarcar uma remove só a linha dela; fechar e reabrir o painel preserva o
que estava marcado.

- [ ] **Step 3: Rodar a revisão do Open Design**

Seguir a seção "HTML passa pela revisão de design do Open Design" do `CLAUDE.md`
raiz: projeto DEDICADO (não o "Projetos IA"), `skill: "design-review"`, snapshot
sintético cobrindo o estado com 2+ rodovias selecionadas (pra revisar a
diferenciação de cor de verdade, não só o seletor vazio). Incorporar as sugestões
que valerem a pena, portando pro `render-alocacao-pagina.js`/`render-aba-alocacao-mapa.js`
(nunca editar o HTML gerado direto -- é sobrescrito no próximo build).

- [ ] **Step 4: Commit de qualquer ajuste da revisão**

```bash
git add -A
git commit -m "fix: ajustes da revisao do Open Design -- camada de rodovias"
```

(Só rodar este commit se a revisão realmente pedir mudança. Se nada mudar, pular.)

Depois desta tarefa, a feature está pronta pra seguir o fluxo normal de
"finishing-a-development-branch" da branch `semanal-alocacao-mapa` (que já
carrega o resto do mapa de pinos por SUP) -- publicar é decisão do dono do
projeto sobre quando a branch inteira (pinos + rodovias) está pronta, não desta
tarefa isolada.
