'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cifrarComSenha, decifrarComSenha } = require('../tools/orcamento/criptografia.js');

test('cifrarComSenha + decifrarComSenha round-trips the original text with the correct password', () => {
  const original = JSON.stringify([{ sup: 'SUP-1', grupo: 'X', tomador: 'Y' }]);
  const pacote = cifrarComSenha(original, 'senha-fake-de-teste-987');
  assert.equal(decifrarComSenha(pacote, 'senha-fake-de-teste-987'), original);
});

test('decifrarComSenha throws (auth tag mismatch) when the password is wrong -- never silently returns garbage', () => {
  const pacote = cifrarComSenha('conteúdo secreto', 'senha-certa');
  assert.throws(() => decifrarComSenha(pacote, 'senha-errada'));
});

test('cifrarComSenha produces a different salt/iv (and therefore different ciphertext) on every call, even for the same plaintext and password', () => {
  const p1 = cifrarComSenha('mesmo texto', 'mesma-senha');
  const p2 = cifrarComSenha('mesmo texto', 'mesma-senha');
  assert.notEqual(p1.salt, p2.salt);
  assert.notEqual(p1.dados, p2.dados);
});

test('cifrarComSenha embeds the iteration count used, so decryption never depends on a hardcoded constant matching between build and browser', () => {
  const pacote = cifrarComSenha('x', 'y');
  assert.equal(typeof pacote.iteracoes, 'number');
  assert.ok(pacote.iteracoes >= 100000);
});

test('cifrarComSenha round-trips a large realistic payload (many registros) without truncation', () => {
  const registros = Array.from({ length: 400 }, (_, i) => ({
    sup: 'SUP-' + i, grupo: 'Grupo ' + i, tomador: 'Tomador ' + i, tipologia: 'SM',
    previsto: { equipes: Array(12).fill(i), equipesResumo: { pico: 0, media: 0, prod: 1.5, dias: 25 } },
  }));
  const original = JSON.stringify(registros);
  const pacote = cifrarComSenha(original, 'senha-fake-de-teste-987');
  const decifrado = decifrarComSenha(pacote, 'senha-fake-de-teste-987');
  assert.equal(decifrado, original);
  assert.deepEqual(JSON.parse(decifrado), registros);
});
