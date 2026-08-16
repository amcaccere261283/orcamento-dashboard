'use strict';

// Porte de tools/lib/zip-writer.js (repositório matriz-equipes-source,
// usado por tools/matriz/gerar-historico-excel.js) para rodar sem Node:
// Buffer/DataView do Node trocados por Uint8Array/DataView puros, e
// zlib.crc32 trocado por uma tabela CRC32 calculada em JS -- mesmo
// algoritmo (IEEE 802.3), mesmo resultado bit a bit. ZIP sem compressão
// (método STORE, 0): xlsx-writer-browser.js grava pouco texto, e
// implementar deflate não vale a complexidade extra aqui.

var CRC_TABLE = (function () {
  var tabela = [];
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    tabela[n] = c >>> 0;
  }
  return tabela;
})();

function crc32(bytes) {
  var crc = 0xFFFFFFFF;
  for (var i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function textoParaBytes(texto) {
  return new TextEncoder().encode(texto);
}

function concatBytes(partes) {
  var total = 0;
  for (var i = 0; i < partes.length; i++) total += partes[i].length;
  var saida = new Uint8Array(total);
  var offset = 0;
  for (var j = 0; j < partes.length; j++) { saida.set(partes[j], offset); offset += partes[j].length; }
  return saida;
}

function dosDateTime(date) {
  var time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f);
  var day = (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0xf) << 5) | (date.getDate() & 0x1f);
  return { time: time, day: day };
}

function bloco30(crc, size, nomeLen, time, day) {
  var buf = new ArrayBuffer(30);
  var view = new DataView(buf);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, time, true);
  view.setUint16(12, day, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, nomeLen, true);
  view.setUint16(28, 0, true);
  return new Uint8Array(buf);
}

function blocoCentral46(crc, size, nomeLen, time, day, offset) {
  var buf = new ArrayBuffer(46);
  var view = new DataView(buf);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, time, true);
  view.setUint16(14, day, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, nomeLen, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, offset, true);
  return new Uint8Array(buf);
}

function blocoEocd(numEntradas, tamanhoCentral, offsetCentral) {
  var buf = new ArrayBuffer(22);
  var view = new DataView(buf);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, numEntradas, true);
  view.setUint16(10, numEntradas, true);
  view.setUint32(12, tamanhoCentral, true);
  view.setUint32(16, offsetCentral, true);
  view.setUint16(20, 0, true);
  return new Uint8Array(buf);
}

// entries: [{ name: string, data: Uint8Array }] -> Uint8Array (.zip completo)
function createZip(entries) {
  var localPartes = [];
  var centralPartes = [];
  var offset = 0;
  var dt = dosDateTime(new Date());

  entries.forEach(function (entrada) {
    var nomeBytes = textoParaBytes(entrada.name);
    var crc = crc32(entrada.data);
    var size = entrada.data.length;

    localPartes.push(bloco30(crc, size, nomeBytes.length, dt.time, dt.day), nomeBytes, entrada.data);
    centralPartes.push(blocoCentral46(crc, size, nomeBytes.length, dt.time, dt.day, offset), nomeBytes);

    offset += 30 + nomeBytes.length + entrada.data.length;
  });

  var centralOffset = offset;
  var central = concatBytes(centralPartes);
  var eocd = blocoEocd(entries.length, central.length, centralOffset);

  return concatBytes(localPartes.concat([central, eocd]));
}

module.exports = { createZip, crc32 };
