'use strict';
const { linhaExcluida } = require('../comum/exclusoes.js');

// Transforma linhas cruas do Link 1 (sond.com.br/extrato-producao-total),
// já em objetos {coluna: valor} via cdp.linhasComoObjetos, no layout de
// colunas que parse-avancos.js consome. Ver
// docs/superpowers/specs/2026-08-08-troca-origem-realizado-demandas-equipes-design.md,
// seção "Link 1".
//
// REESCRITO EM 2026-08-10 pelas decisões do dono do projeto. Duas regras
// novas mandam aqui:
//
// 1. "Não alterar nenhuma informação que venha dos links." A versão anterior
//    gravava o MESMO "Executado Dia" em duas colunas de saída, uma delas
//    batizada "Inicio Sondagem" -- uma coluna que o Link 1 não tem. Isso
//    fazia parecer que existiam duas datas distintas (e o CLAUDE.md chegou a
//    documentar uma regra de negócio inteira em cima dessa distinção
//    fantasma). Confirmado pelo dono em 2026-08-10: início e execução são o
//    MESMO campo. Agora existe uma coluna só, "Executado Dia", com o nome
//    que o link usa.
//
// 2. Deslocamento vem da COLUNA "Deslocamento" do próprio Link 1, não de um
//    regex sobre o texto livre de "Observações de campo". Medido ao vivo em
//    julho/2026 (2.053 linhas): a coluna acusa 82 deslocamentos, o regex
//    acusava 185 -- os dois concordavam em 74, o regex derrubava 111 furos
//    legítimos e deixava passar 8 deslocamentos reais. O regex dependia da
//    grafia livre ("Deslocamento A", "Foram executados deslocamentos A e B")
//    e bastava a palavra aparecer numa observação qualquer pra matar o furo.
//
// Colunas do Link 1 confirmadas ao vivo (21, em 2026-08-08 e reconfirmadas
// em 2026-08-10):
//   Tomador, ID Contrato, Sondador, Tipo, OS, Criação da OS, Identificação,
//   Obra, Observações de campo, Deslocamento, Solo c/SPT (m), Solo s/SPT (m),
//   Rocha (m), Pavimento (m), Água (m), Total (m), Executado Dia,
//   Tags de Serviço, Status Atual, Data Status Atual, Ações
//
// "Cancelamento" e "Conclusão" não existem nesta fonte e por isso não são
// mais fabricadas como colunas vazias -- o Link 1 é relatório de PRODUÇÃO e
// só traz o que foi executado (medido: só CONCLUIDO e EXECUTADO).
const COLUNAS_LINK1 = [
  'Tomador', 'ID Contrato', 'Sondador', 'Tipo', 'OS', 'Criação da OS',
  'Identificação', 'Obra', 'Observações de campo', 'Deslocamento',
  'Solo c/SPT (m)', 'Solo s/SPT (m)', 'Rocha (m)', 'Pavimento (m)',
  'Água (m)', 'Total (m)', 'Executado Dia', 'Tags de Serviço',
  'Status Atual', 'Data Status Atual',
];

const HEADER_SAIDA = [
  'Contrato', 'Criação da OS', 'Tipo', 'Status', 'Executado Dia',
  'Deslocamento', 'Total (m)', 'Observações de Campo', 'OS', 'Sondador',
];

function texto(valor) {
  return String(valor === null || valor === undefined ? '' : valor).trim();
}

function mapearProducaoTotal(linhas) {
  const rows = [];
  let excluidos = 0;
  for (const linha of linhas || []) {
    const tipo = texto(linha['Tipo']);
    // Exclusão de auto-consumo interno (Tomador "Suporte Sondagens - Filial
    // Lapa" e tipos SEG/SN), agora numa implementação só -- ver
    // tools/comum/exclusoes.js. HEADER_SAIDA não carrega Tomador
    // (parse-avancos não a conhece), então a exclusão TEM que acontecer aqui,
    // antes de a linha de saída existir.
    if (linhaExcluida(linha, tipo)) {
      excluidos++;
      continue;
    }
    rows.push([
      texto(linha['ID Contrato']),
      texto(linha['Criação da OS']),
      tipo,
      texto(linha['Status Atual']),
      texto(linha['Executado Dia']),
      texto(linha['Deslocamento']),
      // "Total (m)" volta ao layout em 2026-08-10: o valor 0,01 marca furo
      // que não produziu metragem e sai do Realizado (ver parse-avancos.js).
      // Medido em jun+jul/2026: 92 linhas em 4.103.
      texto(linha['Total (m)']),
      texto(linha['Observações de campo']),
      texto(linha['OS']),
      texto(linha['Sondador']),
    ]);
  }
  return { header: HEADER_SAIDA, rows, excluidos };
}

module.exports = { mapearProducaoTotal, COLUNAS_LINK1, HEADER_SAIDA };
