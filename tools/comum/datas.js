'use strict';
const fs = require('node:fs');

// <<< INICIO CLIENTE
// Época do Excel ajustada pro bug histórico de achar que 1900 foi bissexto
// -- serial 25569 = 1970-01-01 UTC, o offset padrão usado por qualquer
// leitor de xlsx real.
function excelSerialParaData(serial) {
  const milissegundos = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(milissegundos);
}
// FIM CLIENTE >>>

const MESES_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function formatarMesAno(data) {
  return `${MESES_PT[data.getUTCMonth()]}/${data.getUTCFullYear()}`;
}

// vigenteIdx (índice 0=Jan..11=Dez do "mês vigente") nunca existiu no
// pipeline real antes desta função -- compute-orcamento.js já tinha
// calcularJanelas(mensal, vigenteIdx) testado, mas build-dashboard.js nunca
// o chamava, e o client nunca recebia nenhuma data (só os rótulos <th> já
// formatados como texto). periodos é sempre Jan..Dez de um único ano
// (mesma garantia já assumida pelo resto do projeto) -- por isso comparar
// só o ano de generatedAt contra o ano de periodos[0] basta pra decidir
// entre "mês real dentro do ano" e os dois extremos (ano inteiro ainda no
// futuro / ano inteiro já no passado).
function calcularVigenteIdx(periodos, generatedAt) {
  const anoPeriodos = periodos[0].getUTCFullYear();
  const anoGerado = generatedAt.getUTCFullYear();
  if (anoGerado < anoPeriodos) return -1;
  if (anoGerado > anoPeriodos) return 12;
  return generatedAt.getUTCMonth();
}

// Dia inteiro desde a época Unix (1970-01-01) -- mesma função de
// tools/semanal/compute-semanal.js (duplicada lá de propósito: aquele
// arquivo entra no bundle do navegador e não tem require nenhum; esta é a
// versão canônica, usada em Node). Ver
// docs/superpowers/specs/2026-07-30-semanal-calendario-iso-design.md.
function diaEpoch(data) {
  return Math.floor(data.getTime() / 86400000);
}

function trechosParaCliente() {
  const src = fs.readFileSync(__filename, 'utf8').replace(/\r\n/g, '\n');
  const padrao = /\/\/ <<< INICIO CLIENTE([\s\S]*?)\/\/ FIM CLIENTE >>>/g;
  const trechos = [];
  let achado;
  while ((achado = padrao.exec(src)) !== null) trechos.push(achado[1]);
  return trechos;
}

function fonteParaCliente() {
  return trechosParaCliente().join('');
}

module.exports = { excelSerialParaData, formatarMesAno, calcularVigenteIdx, diaEpoch, trechosParaCliente, fonteParaCliente };
