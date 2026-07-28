// tools/orcamento/zip-reader.js
'use strict';
const zlib = require('node:zlib');

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const EOCD_MIN_SIZE = 22;

function findEndOfCentralDirectory(buffer) {
  const maxCommentLength = 65535;
  const searchStart = Math.max(0, buffer.length - EOCD_MIN_SIZE - maxCommentLength);
  for (let offset = buffer.length - EOCD_MIN_SIZE; offset >= searchStart; offset--) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw new Error('Not a valid zip file: end of central directory record not found');
}

// Retorna um Map nome -> metadados (sem descomprimir ainda) -- lido a partir
// do diretório central, nunca varrendo os cabeçalhos locais sequencialmente
// (o diretório central é a fonte confiável de tamanho/offset de cada
// entrada).
function listZipEntries(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);

  const entries = new Map();
  let offset = centralDirOffset;
  for (let i = 0; i < totalEntries; i++) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== CENTRAL_DIR_SIGNATURE) {
      throw new Error(`Not a valid zip file: bad central directory signature at offset ${offset}`);
    }
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    entries.set(name, { compressionMethod, compressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipEntry(buffer, entry) {
  const nameLength = buffer.readUInt16LE(entry.localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localHeaderOffset + 28);
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.compressionMethod === 0) return Buffer.from(compressed);
  if (entry.compressionMethod === 8) return zlib.inflateRawSync(compressed);
  throw new Error(`Unsupported zip compression method: ${entry.compressionMethod}`);
}

module.exports = { listZipEntries, readZipEntry };
