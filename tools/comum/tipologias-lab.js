'use strict';
const fs = require('node:fs');

// <<< INICIO CLIENTE
// A aba "Lab Concluido" do Avanço Sond.xlsx usa 60 rótulos de "Tipo de
// Ensaio"; a MATRIZ só conhece 2 tipologias de laboratório -- LAB.C
// (Convencional) e LAB.E (Especial). Este mapa é a tradução.
//
// RASCUNHO baseado em prática usual de mecânica dos solos (ensaios de
// caracterização básica = Convencional; ensaios mecânicos/avançados =
// Especial), proposto ao dono do projeto em 2026-07-31 e aprovado com a
// ressalva explícita de que pode precisar de ajuste depois. Três rótulos
// (EQ.A, E.CAN, IND.F.P) ficaram sem classificação confiável -- por
// decisão do usuário, entram em Especial por padrão (mais conservador:
// ensaio desconhecido não deveria contar como rotina). Ver
// docs/superpowers/specs/2026-07-31-semanal-lab-ensaios-design.md.
const MAPA_TIPO_ENSAIO_LAB = {
  // Convencional -- caracterização básica, rotina.
  'UMID.N.L': 'LAB.C',
  LL: 'LAB.C',
  LP: 'LAB.C',
  SED: 'LAB.C',
  'M.ESP': 'LAB.C',
  'M.ESP.A': 'LAB.C',
  PEN: 'LAB.C',
  'COMP.EI.5': 'LAB.C',
  'COMP.EN.5': 'LAB.C',
  'COMP.EM.5': 'LAB.C',
  'COMP.D.3': 'LAB.C',
  'COMP.R': 'LAB.C',
  'CBR.5': 'LAB.C',
  'CBR.3': 'LAB.C',
  'MCT.P': 'LAB.C',
  'MCT.C': 'LAB.C',
  DP: 'LAB.C',
  PH: 'LAB.C',
  'T.ORG': 'LAB.C',

  // Especial -- ensaios mecânicos/avançados (triaxiais, adensamento,
  // permeabilidade, resiliência, compactação com cura, etc.).
  'MR.C': 'LAB.E',
  'MR.S': 'LAB.E',
  'MR.A': 'LAB.E',
  'MR.G': 'LAB.E',
  // TRI.UU (sem número de estágio) -- achado de 2026-08-02, 2 linhas na
  // planilha real, mesma família de TRI2.UU/TRI3.UU/TRI4.UU abaixo
  // (triaxial UU), classificado igual por decisão do dono do projeto.
  'TRI.UU': 'LAB.E',
  'TRI2.UU': 'LAB.E',
  'TRI2.CD': 'LAB.E',
  'TRI3.CU': 'LAB.E',
  'TRI3.CD': 'LAB.E',
  'TRI3.UU': 'LAB.E',
  'TRI4.UU': 'LAB.E',
  'TRI4.CU': 'LAB.E',
  'TRI4.CD': 'LAB.E',
  'TRI5.CU': 'LAB.E',
  'TRI5.CD': 'LAB.E',
  'CD3.IN': 'LAB.E',
  'CD3.NAT': 'LAB.E',
  'CD4.IN': 'LAB.E',
  'CD4.NAT': 'LAB.E',
  'ADENS.I.9': 'LAB.E',
  'ADENS.N.9': 'LAB.E',
  'ADENS.PE': 'LAB.E',
  'PERM.V': 'LAB.E',
  DURAB: 'LAB.E',
  'ABR.LA': 'LAB.E',
  'DOSAG.': 'LAB.E',
  'LOAD.TEST': 'LAB.E',
  'IND.VAZ': 'LAB.E',
  'COMP.S.7D.3': 'LAB.E',
  'COMP.D.7D.3': 'LAB.E',
  'COMP.S.28D.3': 'LAB.E',
  'COMP.D.28D.3': 'LAB.E',
  'COMP.D.14D': 'LAB.E',
  'COMP.S.14D': 'LAB.E',
  'COMP.S.28D.2': 'LAB.E',
  'COMP.D.28D.2': 'LAB.E',
  'COMP.S.7D.2': 'LAB.E',
  'COMP.D.7D.2': 'LAB.E',
  'COMP.EM.3': 'LAB.E',
  // 2026-08-06: apareceu pela primeira vez na planilha real. Mesmo padrão de
  // COMP.EM.3 acima -- variante ".3" (3 pontos) é Especial neste laboratório,
  // diferente da variante ".5" (COMP.EI.5/COMP.EN.5/COMP.EM.5, Convencional).
  // Confirmado com o dono do projeto.
  'COMP.EN.3': 'LAB.E',

  // Sem classificação confiável -- Especial por padrão (ver comentário acima).
  'EQ.A': 'LAB.E',
  'E.CAN': 'LAB.E',
  'IND.F.P': 'LAB.E',
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
