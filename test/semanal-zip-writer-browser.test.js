'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { createZip, crc32 } = require('../tools/semanal/zip-writer-browser.js');

test('crc32 bate byte a byte com zlib.crc32 do Node, para o mesmo conteúdo', () => {
  const bytes = new TextEncoder().encode('conteudo de teste,com virgula\n');
  const esperado = zlib.crc32(Buffer.from(bytes)) >>> 0;
  assert.strictEqual(crc32(bytes), esperado);
});

test('crc32 de bytes vazios é 0 (mesma convenção de zlib.crc32)', () => {
  assert.strictEqual(crc32(new Uint8Array(0)), 0);
});

test('createZip produz um .zip de verdade, extraível por unzip, com os bytes originais preservados', () => {
  const entradas = [
    { name: 'a.txt', data: new TextEncoder().encode('primeiro arquivo') },
    { name: 'pasta/b.txt', data: new TextEncoder().encode('segundo arquivo, um pouco maior que o primeiro') },
  ];
  const bytes = createZip(entradas);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-writer-browser-test-'));
  const zipPath = path.join(tmpDir, 'test.zip');
  fs.writeFileSync(zipPath, Buffer.from(bytes));
  const outDir = path.join(tmpDir, 'out');
  execFileSync('unzip', ['-q', zipPath, '-d', outDir]);
  assert.strictEqual(fs.readFileSync(path.join(outDir, 'a.txt'), 'utf8'), 'primeiro arquivo');
  assert.strictEqual(fs.readFileSync(path.join(outDir, 'pasta', 'b.txt'), 'utf8'), 'segundo arquivo, um pouco maior que o primeiro');
});

test('createZip com zero entradas produz um .zip vazio válido (só o EOCD)', () => {
  const bytes = createZip([]);
  assert.strictEqual(bytes.length, 22);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.strictEqual(view.getUint32(0, true), 0x06054b50); // assinatura EOCD
  assert.strictEqual(view.getUint16(8, true), 0);  // entradas neste disco
  assert.strictEqual(view.getUint16(10, true), 0); // entradas totais
  assert.strictEqual(view.getUint32(12, true), 0); // tamanho do diretório central
  assert.strictEqual(view.getUint32(16, true), 0); // offset do diretório central
});
