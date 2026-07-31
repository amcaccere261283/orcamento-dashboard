'use strict';

// A aba Avanços do Avanço Sond.xlsx usa 21 rótulos de tipologia; a MATRIZ,
// que manda no resto do dashboard, usa 10. Este mapa é a tradução, definida
// pelo dono do projeto em 2026-07-29 (ver o spec
// docs/superpowers/specs/2026-07-29-base-demandas-realizado-design.md).
//
// Decisão que parece erro de digitação e NÃO é:
// - SEG.A e SEG.V ficam separadas e só aparecem na tela quando houver
//   acionamento no período (ver SO_QUANDO_ACIONADA) -- são serviços sob
//   demanda, e uma linha de zeros permanente só faria ruído.
//
// Sete reclassificações feitas em 2026-08-01, a pedido do dono do
// projeto -- SP.F, SM.A, BQ, DN, PZ.SP, PZ.SM e INA tinham rótulo próprio
// (ou caíam em 'Especiais') e passam a contar dentro de uma das 10
// tipologias da MATRIZ:
// - SP.F passa a contar em 'SP' (antes era rótulo próprio -- decidido
//   depois de SM.A, ao notar que a mesma exceção não fazia mais sentido
//   mantida só pra SP.F).
// - SM.A passa a contar em 'SM / SM.F / SR' (antes era rótulo próprio).
// - BQ passa a contar em 'PI' (antes caía em 'Especiais').
// - DN passa a contar em 'SH' (antes caía em 'Especiais'; investigado e
//   sem qualquer vínculo nos dados com CPTU -- OS e identificação próprios,
//   "DN-"/"DEN-", nunca compartilhados com uma linha CPTU).
// - PZ.SP passa a contar em 'SP' (antes caía em 'Especiais').
// - PZ.SM e INA passam a contar em 'SM / SM.F / SR' (antes caíam em
//   'Especiais').
//
// SEG.A, SEG.V e SN ficam de fora dessa rodada -- decisão explícita do
// dono do projeto de NÃO contá-los por enquanto ("a princípio"). SEG.A e
// SEG.V continuam com rótulo próprio (ver SO_QUANDO_ACIONADA acima); SN é
// o único rótulo que sobra em 'Especiais'.
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
  'SM.A': 'SM / SM.F / SR',
  'PZ.SM': 'SM / SM.F / SR',
  INA: 'SM / SM.F / SR',
  'SP.F': 'SP',
  'PZ.SP': 'SP',
  'SEG.A': 'SEG.A',
  'SEG.V': 'SEG.V',
  BQ: 'PI',
  DN: 'SH',
  SN: 'Especiais',
};

// Ordem de exibição: primeiro as 10 da MATRIZ (mesma ordem que o orçamento
// usa), depois as de acionamento, e Especiais no fim. LAB.C e LAB.E entram
// mesmo sem nenhuma linha no Avanços -- laboratório tem fonte própria, e
// omitir os dois rótulos faria a grade parecer completa quando não está.
const ORDEM_TIPOLOGIAS = [
  'SP', 'SM / SM.F / SR', 'ST', 'PI', 'BL', 'CPTu', 'SH', 'VT', 'LAB.C', 'LAB.E',
  'SEG.A', 'SEG.V', 'Especiais',
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
