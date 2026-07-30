'use strict';

// A aba Avanços do Avanço Sond.xlsx usa 21 rótulos de tipologia; a MATRIZ,
// que manda no resto do dashboard, usa 10. Este mapa é a tradução, definida
// pelo dono do projeto em 2026-07-29 (ver o spec
// docs/superpowers/specs/2026-07-29-base-demandas-realizado-design.md).
//
// Duas decisões que parecem erro de digitação e NÃO são:
// - SM.A não entra em 'SM / SM.F / SR', e SP.F não entra em 'SP'. São
//   serviços tratados de forma independente, com rótulo próprio.
// - SEG.A e SEG.V ficam separadas e só aparecem na tela quando houver
//   acionamento no período (ver SO_QUANDO_ACIONADA) -- são serviços sob
//   demanda, e uma linha de zeros permanente só faria ruído.
const MAPA_TIPOLOGIAS = {
  SP: 'SP',
  ST: 'ST',
  PI: 'PI',
  BL: 'BL',
  SH: 'SH',
  VT: 'VT',
  CPTU: 'CPTu',
  SM: 'SM / SM.F / SR',
  'SM.F': 'SM / SM.F / SR',
  SR: 'SM / SM.F / SR',
  'SP.F': 'SP.F',
  'SM.A': 'SM.A',
  'SEG.A': 'SEG.A',
  'SEG.V': 'SEG.V',
  BQ: 'Especiais',
  SN: 'Especiais',
  DN: 'Especiais',
  'PZ.SP': 'Especiais',
  'PZ.SM': 'Especiais',
  INA: 'Especiais',
};

// Ordem de exibição: primeiro as 10 da MATRIZ (mesma ordem que o orçamento
// usa), depois as independentes, depois as de acionamento, e Especiais no
// fim. LAB.C e LAB.E entram mesmo sem nenhuma linha no Avanços --
// laboratório tem fonte própria, e omitir os dois rótulos faria a grade
// parecer completa quando não está.
const ORDEM_TIPOLOGIAS = [
  'SP', 'SM / SM.F / SR', 'ST', 'PI', 'BL', 'CPTu', 'SH', 'VT', 'LAB.C', 'LAB.E',
  'SP.F', 'SM.A', 'SEG.A', 'SEG.V', 'Especiais',
];

const SO_QUANDO_ACIONADA = ['SEG.A', 'SEG.V'];

// Rótulo fora do mapa LANÇA, de propósito: cair calado em 'Especiais'
// contabilizaria uma tipologia nova no lugar errado por meses sem ninguém
// perceber. Falhar o build é barato -- acrescentar uma linha no mapa acima.
function rotularTipologia(crua) {
  const chave = String(crua === null || crua === undefined ? '' : crua).trim().toUpperCase();
  if (!chave) {
    throw new Error('rotularTipologia recebeu tipologia vazia -- linha sem "Tipo" deve ser descartada em parse-avancos.js, não rotulada.');
  }
  const destino = MAPA_TIPOLOGIAS[chave];
  if (!destino) {
    throw new Error(`Tipologia desconhecida na aba Avanços: "${crua}". Acrescente em MAPA_TIPOLOGIAS (tools/comum/tipologias-avancos.js) decidindo se ela é rótulo próprio ou entra em "Especiais" -- não deixe cair em Especiais por omissão.`);
  }
  return destino;
}

module.exports = { MAPA_TIPOLOGIAS, ORDEM_TIPOLOGIAS, SO_QUANDO_ACIONADA, rotularTipologia };
