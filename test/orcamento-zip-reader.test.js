// test/orcamento-zip-reader.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { listZipEntries, readZipEntry } = require('../tools/orcamento/zip-reader.js');
const { buildMinimalZip } = require('./helpers/build-zip.js');

test('listZipEntries finds a stored (uncompressed) entry with its metadata', () => {
  const zip = buildMinimalZip([{ name: 'hello.txt', data: Buffer.from('Hello, zip!'), method: 0 }]);
  const entries = listZipEntries(zip);
  assert.equal(entries.size, 1);
  assert.ok(entries.has('hello.txt'));
  assert.equal(entries.get('hello.txt').compressionMethod, 0);
});

test('readZipEntry returns the original bytes for a stored entry', () => {
  const zip = buildMinimalZip([{ name: 'hello.txt', data: Buffer.from('Hello, zip!'), method: 0 }]);
  const entries = listZipEntries(zip);
  const content = readZipEntry(zip, entries.get('hello.txt'));
  assert.equal(content.toString('utf8'), 'Hello, zip!');
});

test('readZipEntry inflates a deflated (compression method 8) entry back to the original bytes', () => {
  const original = Buffer.from('Some longer repeated text. '.repeat(50));
  const zip = buildMinimalZip([{ name: 'big.xml', data: original, method: 8 }]);
  const entries = listZipEntries(zip);
  const content = readZipEntry(zip, entries.get('big.xml'));
  assert.equal(content.toString('utf8'), original.toString('utf8'));
});

test('listZipEntries finds multiple entries with correct byte offsets', () => {
  const zip = buildMinimalZip([
    { name: 'a.xml', data: Buffer.from('<a/>'), method: 0 },
    { name: 'b.xml', data: Buffer.from('<b>'.repeat(30)), method: 8 },
  ]);
  const entries = listZipEntries(zip);
  assert.deepEqual([...entries.keys()], ['a.xml', 'b.xml']);
  assert.equal(readZipEntry(zip, entries.get('a.xml')).toString('utf8'), '<a/>');
  assert.equal(readZipEntry(zip, entries.get('b.xml')).toString('utf8'), '<b>'.repeat(30));
});

test('listZipEntries throws a clear error on a non-zip buffer', () => {
  assert.throws(() => listZipEntries(Buffer.from('not a zip file')), /end of central directory/);
});
