// tools/semanal/config-demandas.js
'use strict';

// Fonte da base de demandas e realizado -- uma planilha de EXECUÇÃO (uma
// linha por furo, com datas reais), diferente das duas fontes mensais que o
// orçamento já lê. Fica em arquivo próprio, e não em tools/orcamento/
// config.js, porque nada do orçamento depende dela: se este caminho quebrar,
// só a aba Demandas cai.
module.exports = {
  caminhoArquivo: 'G:\\Meu Drive\\PMO\\06 - Orçamento\\OR26 - Rev 01 - Frcst 6+6\\Dados e extratos\\Extratos Sond\\Avanço Sond.xlsx',
  nomeAba: 'Avanços',
};
