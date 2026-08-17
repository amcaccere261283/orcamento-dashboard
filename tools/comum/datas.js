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

// Fuso de referência do projeto, decidido pelo dono em 2026-08-10:
// "considerar o utc-3 sempre". O Brasil não tem horário de verão desde 2019,
// então UTC-3 é fixo o ano inteiro e um deslocamento constante é exato --
// nada de Intl/tabela de fuso, que traria dependência de ICU pra resolver um
// offset que não varia.
//
// Antes disso havia TRÊS relógios no pipeline: atualizar-avancos-online.js e
// atualizar-equipes-online.js liam getUTC*, enquanto atualizar-lab-online.js
// e atualizar-equipes-produtivas-online.js liam a hora LOCAL da máquina. Nas
// últimas 3h de cada mês os dois grupos discordavam sobre qual é o "mês
// corrente" -- e atualizar-avancos-online.js aborta a gravação inteira se o
// mês corrente falhar, o que nessa janela seria um mês que ainda não começou.
const OFFSET_PROJETO_MS = 3 * 60 * 60 * 1000;

// O instante 'agora' deslocado pra UTC-3, pra que os getters getUTC* devolvam
// os componentes de data do fuso do projeto. O Date resultante NÃO representa
// o mesmo instante -- é um portador de componentes, e só deve ser lido com
// getUTC*, nunca comparado com outro Date de instante real.
function agoraNoFusoProjeto(agora = new Date()) {
  return new Date(agora.getTime() - OFFSET_PROJETO_MS);
}

// { ano, mes (1-12), dia } de hoje no fuso do projeto.
function hojeNoFusoProjeto(agora = new Date()) {
  const d = agoraNoFusoProjeto(agora);
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate() };
}

// Dia-desde-época de HOJE, no fuso do projeto. Até 2026-08-17 esta função era
// 'diaEpochDeOntem' e devolvia d-1, pela regra de que o dia corrente estava
// incompleto. A atualização passou a rodar às 8h diariamente e o Realizado
// passou a contar até D -- ver
// docs/superpowers/specs/2026-08-17-realizado-ate-hoje-design.md.
function diaEpochDeHoje(agora = new Date()) {
  return diaEpoch(agoraNoFusoProjeto(agora));
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

module.exports = {
  excelSerialParaData, formatarMesAno, calcularVigenteIdx, diaEpoch,
  OFFSET_PROJETO_MS, agoraNoFusoProjeto, hojeNoFusoProjeto, diaEpochDeHoje,
  trechosParaCliente, fonteParaCliente,
};
