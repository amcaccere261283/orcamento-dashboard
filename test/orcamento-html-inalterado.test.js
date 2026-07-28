'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { construirHtmlGolden, normalizarVolatil, SENHA_FIXA } = require('./helpers/golden-orcamento.js');

const GOLDEN = path.join(__dirname, 'fixtures', 'orcamento-golden.html');

test('o HTML do orçamento continua byte-idêntico ao golden', () => {
  const atual = normalizarVolatil(construirHtmlGolden());
  const golden = normalizarVolatil(fs.readFileSync(GOLDEN, 'utf8'));
  assert.strictEqual(atual, golden);
});

test('a normalização não engole o conteúdo que o golden protege', () => {
  const html = normalizarVolatil(construirHtmlGolden());
  assert.match(html, /abas-visualizacao/);
  assert.match(html, /--text-primary/);
  assert.match(html, /NORMALIZADO/);
});

test('dois builds seguidos do mesmo código normalizam para o mesmo texto', () => {
  assert.strictEqual(
    normalizarVolatil(construirHtmlGolden()),
    normalizarVolatil(construirHtmlGolden()));
});

test('a senha fictícia não vaza no HTML', () => {
  assert.doesNotMatch(construirHtmlGolden(), new RegExp(SENHA_FIXA));
});
