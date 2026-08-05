'use strict';

// Serializa uma grade (array de arrays de string) pra texto CSV, no mesmo
// dialeto que parseCsvGrid (tools/semanal/parse-matriz-cliente.js) já lê --
// aspas quando o valor tem vírgula, aspas ou quebra de linha; aspas internas
// dobradas. Usado pra publicar o CSV combinado de Avanços (ver
// tools/semanal/atualizar-avancos-online.js) no mesmo formato que o CSV
// publicado pela Sheet espelho antiga, pra não precisar mudar quem consome
// (parseCsvGrid + parseAvancos, tanto no build quanto no botão "Atualizar
// dados").
const RE_PRECISA_ASPAS = /[",\n]/;

function celulaCsv(valor) {
  const texto = valor === null || valor === undefined ? '' : String(valor);
  if (!RE_PRECISA_ASPAS.test(texto)) return texto;
  return '"' + texto.replace(/"/g, '""') + '"';
}

function gridParaCsv(grid) {
  return grid.map((linha) => linha.map(celulaCsv).join(',')).join('\n') + '\n';
}

module.exports = { gridParaCsv };
