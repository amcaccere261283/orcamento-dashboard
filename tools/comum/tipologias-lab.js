'use strict';
const fs = require('node:fs');

// <<< INICIO CLIENTE
// A aba "Lab Concluido" do Avanço Sond.xlsx usa rótulos de "Tipo de
// Ensaio"; a MATRIZ só conhece 2 tipologias de laboratório -- LAB.C
// (Convencional) e LAB.E (Especial). Este mapa é a tradução.
//
// Consolidado em 2026-08-08 com a tabela "Mapa Tipo SONDAGEM" do
// Frcst Novo 2.xlsx (Desktop, 125 pares, fonte 2026-07-30) -- onde os dois
// mapas divergiam (9 rótulos), decidido com o usuário que o Frcst prevalece
// (mais recente e mais completo). Ver
// docs/superpowers/specs/2026-08-08-troca-origem-realizado-demandas-equipes-design.md.
const MAPA_TIPO_ENSAIO_LAB = {
  'ABR.LA': 'LAB.E', ABSOR: 'LAB.E', 'ADENS.CD': 'LAB.E', 'ADENS.CS': 'LAB.E',
  'ADENS.I.9': 'LAB.E', 'ADENS.N.9': 'LAB.E', 'ADENS.PE': 'LAB.E', 'ADES.A': 'LAB.E',
  'APR.P': 'LAB.E', 'AV.DURAB': 'LAB.E',
  'CBR.1': 'LAB.C', 'CBR.3': 'LAB.C', 'CBR.5': 'LAB.C',
  'CD.IN': 'LAB.E', 'CD.NAT': 'LAB.E', 'CD3.IN': 'LAB.E', 'CD3.NAT': 'LAB.E',
  'CD4.IN': 'LAB.E', 'CD4.NAT': 'LAB.E', 'CD5.IN': 'LAB.E', 'CD5.NAT': 'LAB.E', 'CDA.IN': 'LAB.E',
  'COMP.D': 'LAB.E', 'COMP.D.14D': 'LAB.E', 'COMP.D.28d': 'LAB.E', 'COMP.D.28D.2': 'LAB.E',
  'COMP.D.28D.3': 'LAB.E', 'COMP.D.3': 'LAB.E', 'COMP.D.7d': 'LAB.E', 'COMP.D.7D.2': 'LAB.E',
  'COMP.D.7D.3': 'LAB.E', 'COMP.DIA': 'LAB.E',
  'COMP.EI.3': 'LAB.C', 'COMP.EI.5': 'LAB.C', 'COMP.EM.3': 'LAB.C', 'COMP.EM.5': 'LAB.C',
  'COMP.EN.3': 'LAB.C', 'COMP.EN.5': 'LAB.C',
  'COMP.NC': 'LAB.E', 'COMP.R': 'LAB.E', 'COMP.S': 'LAB.E', 'COMP.S.14D': 'LAB.E',
  'COMP.S.28d': 'LAB.E', 'COMP.S.28D.2': 'LAB.E', 'COMP.S.28D.3': 'LAB.E', 'COMP.S.3d': 'LAB.E',
  'COMP.S.3d.2': 'LAB.E', 'COMP.S.3d.3': 'LAB.E', 'COMP.S.7d': 'LAB.E', 'COMP.S.7D.2': 'LAB.E',
  'COMP.S.7D.3': 'LAB.E',
  'D.HILF': 'LAB.C', 'D.NAT.L': 'LAB.E', DISSIP: 'LAB.E', 'DOSAG.': 'LAB.E', DP: 'LAB.E',
  DRX: 'LAB.E', DSS: 'LAB.E', DUR: 'LAB.E', DURAB: 'LAB.E',
  'E.CAN': 'LAB.E', 'EQ.A': 'LAB.E',
  'IND.F.P': 'LAB.E', 'IND.VAZ': 'LAB.E',
  LL: 'LAB.C', 'LOAD.TEST': 'LAB.E', LP: 'LAB.C', LWD: 'LAB.E',
  'M.ESP': 'LAB.C', 'M.ESP.A': 'LAB.E', 'MCT.C': 'LAB.E', 'MCT.P': 'LAB.C', 'MOLD.CP': 'LAB.C',
  // Achado ao vivo em 2026-08-08 (Link 5, detalhes-ensaios-programados),
  // ausente da tabela do Frcst. Decidido com o usuário: mesma família de
  // MCT.C (Especial), não de MCT.P (Convencional).
  'MCT-INFILT': 'LAB.E',
  'MR.A': 'LAB.E', 'MR.C': 'LAB.E', 'MR.G': 'LAB.E', 'MR.S': 'LAB.E',
  PEN: 'LAB.C', 'PERM.C': 'LAB.E', 'PERM.V': 'LAB.E', PH: 'LAB.E',
  'RES.COMP.SIM': 'LAB.E',
  SED: 'LAB.C',
  'T.ARG': 'LAB.E', 'T.ORG': 'LAB.E',
  'TRI.CD': 'LAB.E', 'TRI.CD4': 'LAB.E', 'TRI.CU': 'LAB.E', 'TRI.CU4': 'LAB.E',
  'TRI.PN': 'LAB.E', 'TRI.UU': 'LAB.E',
  'TRI2.CD': 'LAB.E', 'TRI2.CU': 'LAB.E', 'TRI2.UU': 'LAB.E',
  'TRI3. CU': 'LAB.E', 'TRI3.CD': 'LAB.E', 'TRI3.CU': 'LAB.E', 'TRI3.UU': 'LAB.E',
  'TRI4.CD': 'LAB.E', 'TRI4.CU': 'LAB.E', 'TRI4.UU': 'LAB.E',
  'TRI5.CD': 'LAB.E', 'TRI5.CU': 'LAB.E', 'TRI5.UU': 'LAB.E',
  'UMID.N': 'LAB.C', 'UMID.N.L': 'LAB.C',
};

// Rótulo fora do mapa LANÇA, de propósito -- mesmo raciocínio de
// rotularTipologia (tools/comum/tipologias-avancos.js): um ensaio novo,
// não classificado, não pode virar Convencional ou Especial em silêncio.
function classificarEnsaioLab(tipoEnsaioCru) {
  const chave = String(tipoEnsaioCru === null || tipoEnsaioCru === undefined ? '' : tipoEnsaioCru).trim().toUpperCase();
  if (!chave) {
    throw new Error('classificarEnsaioLab recebeu Tipo de Ensaio vazio -- linha sem "Tipo de Ensaio" deve ser descartada em parse-lab.js, não classificada.');
  }
  const destino = MAPA_TIPO_ENSAIO_LAB[chave];
  if (!destino) {
    throw new Error(`Tipo de Ensaio desconhecido na aba Lab Concluido: "${tipoEnsaioCru}". Acrescente em MAPA_TIPO_ENSAIO_LAB (tools/comum/tipologias-lab.js) decidindo se é Convencional (LAB.C) ou Especial (LAB.E) -- não deixe cair em nenhum por omissão.`);
  }
  return destino;
}
// FIM CLIENTE >>>

// Recorta os blocos marcados para inlinar no navegador exatamente o mesmo
// código que o Node testou. A regex escapa as barras, então o próprio
// padrão não casa consigo mesmo e não vira um bloco fantasma.
//
// O \r\n vira \n na leitura porque é isso que o resto do HTML já faz: o JS
// de cliente do orçamento mora em template literal, e a linguagem normaliza
// a quebra de linha do literal pra \n mesmo quando o .js está em CRLF no
// disco. fs.readFileSync não normaliza nada, então sem esse replace o
// trecho injetado sairia em CRLF num checkout Windows (core.autocrlf=true) e
// em LF num checkout Linux -- o HTML publicado passaria a depender de como o
// repositório foi clonado.
function trechosParaCliente() {
  const src = fs.readFileSync(__filename, 'utf8').replace(/\r\n/g, '\n');
  const padrao = /\/\/ <<< INICIO CLIENTE([\s\S]*?)\/\/ FIM CLIENTE >>>/g;
  const trechos = [];
  let achado;
  while ((achado = padrao.exec(src)) !== null) trechos.push(achado[1]);
  return trechos;
}

// Os trechos já começam e terminam em quebra de linha, então concatenar
// direto reproduz o espaçamento natural entre eles.
function fonteParaCliente() {
  return trechosParaCliente().join('');
}

module.exports = { MAPA_TIPO_ENSAIO_LAB, classificarEnsaioLab, trechosParaCliente, fonteParaCliente };
