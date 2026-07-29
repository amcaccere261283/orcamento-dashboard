'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildBrowserBundle } = require('../tools/comum/browser-bundle.js');

test('concatena na ordem e resolve require entre módulos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'));
  fs.writeFileSync(path.join(dir, 'a.js'), "'use strict';\nfunction dobro(n){return n*2;}\nmodule.exports = { dobro };\n");
  fs.writeFileSync(path.join(dir, 'b.js'), "'use strict';\nconst { dobro } = require('./a.js');\nfunction quadruplo(n){return dobro(dobro(n));}\nmodule.exports = { quadruplo };\n");

  const bundle = buildBrowserBundle(dir, ['a.js', 'b.js']);
  assert.doesNotMatch(bundle, /require\(/, 'nenhum require pode sobrar');
  assert.doesNotMatch(bundle, /module\.exports/, 'nenhum module.exports pode sobrar');

  const quadruplo = new Function(bundle + '; return MODULOS["b.js"].quadruplo;')();
  assert.strictEqual(quadruplo(3), 12);
});

test('arquivosEmOrdem é parâmetro -- duas chamadas com listas diferentes não vazam módulo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'));
  fs.writeFileSync(path.join(dir, 'a.js'), "'use strict';\nfunction dobro(n){return n*2;}\nmodule.exports = { dobro };\n");
  fs.writeFileSync(path.join(dir, 'c.js'), "'use strict';\nfunction triplo(n){return n*3;}\nmodule.exports = { triplo };\n");

  const bundleSoA = buildBrowserBundle(dir, ['a.js']);
  assert.doesNotMatch(bundleSoA, /triplo/, 'c.js não foi pedido, não pode aparecer');

  const bundleSoC = buildBrowserBundle(dir, ['c.js']);
  assert.doesNotMatch(bundleSoC, /dobro/, 'a.js não foi pedido, não pode aparecer');
});

// fs.readFileSync não normaliza quebra de linha, e este repositório roda
// com core.autocrlf=true -- sem normalizar, um bundle construído a partir
// de um checkout Windows (arquivo em CRLF no disco) sairia diferente de um
// construído a partir de um checkout Linux (LF), e o HTML publicado
// passaria a depender de como o repositório foi clonado. Mesmo raciocínio
// de test/comum-calculo-equipes.test.js: materializa a condição gravando
// uma cópia do arquivo-fonte em CRLF antes de bundlar.
test('bundle não carrega CR mesmo com o arquivo-fonte em CRLF no disco (clone Windows)', () => {
  const conteudoLF = "'use strict';\nfunction dobro(n) {\n  return n * 2;\n}\nmodule.exports = { dobro };\n";

  const dirCRLF = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-crlf-'));
  const arquivoCRLF = path.join(dirCRLF, 'a.js');
  fs.writeFileSync(arquivoCRLF, conteudoLF.replace(/\n/g, '\r\n'));
  // Sem isto o teste viraria vácuo caso o fixture deixasse de estar em CRLF.
  assert.match(fs.readFileSync(arquivoCRLF, 'utf8'), /\r\n/, 'o fixture precisava estar em CRLF');

  const bundleDeCRLF = buildBrowserBundle(dirCRLF, ['a.js']);
  assert.doesNotMatch(bundleDeCRLF, /\r/, 'nenhum CR pode sobrar no bundle');

  const dirLF = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-lf-'));
  fs.writeFileSync(path.join(dirLF, 'a.js'), conteudoLF);
  const bundleDeLF = buildBrowserBundle(dirLF, ['a.js']);

  // E o texto tem que ser o MESMO do bundle construído a partir da fonte em
  // LF, não só livre de CR -- prova que é normalização, não truncamento.
  assert.strictEqual(bundleDeCRLF, bundleDeLF);
});

test('dir omitido usa __dirname do módulo (tools/comum)', () => {
  // buildBrowserBundle(undefined, []) não deve lançar por falta de dir --
  // com lista vazia, nenhum arquivo é lido, só exercita o fallback.
  const bundle = buildBrowserBundle(undefined, []);
  assert.match(bundle, /var MODULOS = \{\};/);
});

test('protege </script literal dentro de um módulo bundlado', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'));
  fs.writeFileSync(path.join(dir, 'a.js'), "'use strict';\nfunction html(){return '<div></script>';}\nmodule.exports = { html };\n");

  const bundle = buildBrowserBundle(dir, ['a.js']);
  assert.doesNotMatch(bundle, /<\/script/i, 'a tag real de fechamento não pode sobrar sem escape');
  assert.match(bundle, /<\\\/script/i);
});
