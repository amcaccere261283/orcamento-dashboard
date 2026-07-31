// tools/semanal/config-lab.js
'use strict';

// MESMO arquivo de Avanço Sond.xlsx que config-demandas.js usa -- o
// workbook tem 3 abas (Avanços, Ensaios Campo, Lab Concluido), cada config
// aponta pra uma. Reaproveita o caminho de config-demandas.js em vez de
// duplicar a string: são o MESMO arquivo, então se o caminho mudar um dia,
// muda nos dois configs juntos, sem risco de um ficar desatualizado.
const configDemandas = require('./config-demandas.js');

module.exports = {
  caminhoArquivo: configDemandas.caminhoArquivo,
  nomeAba: 'Lab Concluido',
};
