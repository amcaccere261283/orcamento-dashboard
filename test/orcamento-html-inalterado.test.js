'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { construirHtmlGolden, normalizarVolatil, SENHA_FIXA } = require('./helpers/golden-orcamento.js');
const { decifrarComSenha } = require('../tools/orcamento/criptografia.js');

const GOLDEN = path.join(__dirname, 'fixtures', 'orcamento-golden.html');

// normalizarVolatil joga fora o blob __DADOS_CIFRADOS__ inteiro (precisa,
// porque salt/iv são sorteados a cada build) -- então a comparação
// byte-idêntica acima tem cobertura ZERO do que está DENTRO do blob. Essa
// extração + decifra + deepStrictEqual é o complemento: prova que o
// conteúdo cifrado (sup/grupo/tomador/escopo/tipologia/origem/previsto/
// realizado/total de cada registro) não mudou, mesmo com salt/iv diferentes
// a cada execução.
function extrairPacoteCifrado(html) {
  const match = html.match(/window\.__DADOS_CIFRADOS__\s*=\s*(\{[^}]*\})/);
  if (!match) throw new Error('window.__DADOS_CIFRADOS__ não encontrado no HTML');
  return JSON.parse(match[1]);
}

function decifrarRegistros(html) {
  const pacote = extrairPacoteCifrado(html);
  return JSON.parse(decifrarComSenha(pacote, SENHA_FIXA));
}

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

test('os registros cifrados (sup/grupo/tomador/escopo/tipologia/origem/previsto/realizado/total) continuam os mesmos do golden, decifrados', () => {
  const registrosAtual = decifrarRegistros(construirHtmlGolden());
  const registrosGolden = decifrarRegistros(fs.readFileSync(GOLDEN, 'utf8'));
  assert.deepStrictEqual(registrosAtual, registrosGolden);
});
