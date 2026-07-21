'use strict';

// Época do Excel ajustada pro bug histórico de achar que 1900 foi bissexto
// -- serial 25569 = 1970-01-01 UTC, o offset padrão usado por qualquer
// leitor de xlsx real.
function excelSerialParaData(serial) {
  const milissegundos = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(milissegundos);
}

const MESES_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function formatarMesAno(data) {
  return `${MESES_PT[data.getUTCMonth()]}/${data.getUTCFullYear()}`;
}

module.exports = { excelSerialParaData, formatarMesAno };
