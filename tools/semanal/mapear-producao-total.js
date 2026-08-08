'use strict';

// Transforma linhas cruas do Link 1 (sond.com.br/extrato-producao-total),
// já em objetos {coluna: valor} via cdp.linhasComoObjetos, no MESMO layout
// de colunas que parse-avancos.js já exige -- assim parseAvancos() roda
// sem nenhuma mudança sobre este grid. Ver
// docs/superpowers/specs/2026-08-08-troca-origem-realizado-demandas-equipes-design.md,
// seção "Link 1".
//
// Duas repurposições deliberadas, confirmadas com o usuário:
// - "Executado Dia" alimenta TANTO "Termino Sondagem" (evento sondagem
//   realizada) QUANTO "Inicio Sondagem" (que compute-demandas.js usa como
//   evento de SAÍDA do estoque de pendentes desde 2026-08-06) -- o Link 1
//   só tem uma data de execução, não duas.
// - "Cancelamento"/"Conclusão"/"Atualizado" ficam vazios: o Link 1 (relatório
//   de PRODUÇÃO) não distingue essas datas. Furo cancelado não aparece nesta
//   tela (nada foi produzido) -- limitação conhecida, não bug.
const COLUNAS_LINK1 = [
  'Tomador', 'ID Contrato', 'Sondador', 'Tipo', 'OS', 'Criação da OS',
  'Identificação', 'Obra', 'Observações de campo', 'Executado Dia',
  'Tags de Serviço', 'Status Atual', 'Data Status Atual',
];

const HEADER_SAIDA = [
  'Contrato', 'Criação da OS', 'Tipo', 'Status', 'Inicio Sondagem',
  'Termino Sondagem', 'Conclusão', 'Cancelamento', 'Atualizado',
  'Observações de Campo', 'OS', 'Sondador',
];

function texto(valor) {
  return String(valor === null || valor === undefined ? '' : valor).trim();
}

function mapearProducaoTotal(linhas) {
  const rows = (linhas || []).map((linha) => {
    const executadoDia = texto(linha['Executado Dia']);
    return [
      texto(linha['ID Contrato']),
      texto(linha['Criação da OS']),
      texto(linha['Tipo']),
      texto(linha['Status Atual']),
      executadoDia,
      executadoDia,
      '',
      '',
      texto(linha['Data Status Atual']),
      texto(linha['Observações de campo']),
      texto(linha['OS']),
      texto(linha['Sondador']),
    ];
  });
  return { header: HEADER_SAIDA, rows };
}

module.exports = { mapearProducaoTotal, COLUNAS_LINK1, HEADER_SAIDA };
