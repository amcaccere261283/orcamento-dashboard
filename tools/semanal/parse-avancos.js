'use strict';
const { excelSerialParaData } = require('../comum/datas.js');
const { rotularTipologia } = require('../comum/tipologias-avancos.js');

// Lê a aba "Avanços" do Avanço Sond.xlsx: 61.927 linhas, uma por furo. Só
// leitura e saneamento -- nenhuma agregação (isso é compute-demandas.js).
//
// Node-only: NUNCA entra no bundle do navegador. Os requires '../comum/'
// acima seriam REMOVIDOS por transformaModulo (tools/comum/browser-bundle.js),
// e as funções virariam undefined em produção com os testes passando.
//
// Colunas usadas, com o nome EXATO da planilha (medido em 2026-07-29):
// Contrato(A) · Criação da OS(I) · Tipo(J) · Status(L) · Termino Sondagem(N,
// sem acento em "Termino") · Conclusão(O) · Atualizado(Q).
//
// Duas colunas de propósito NÃO usadas:
// - Inicio Sondagem(M): 3.929 das 61.927 linhas têm data fora de 2023-2027
//   (de 1901 a 2078). Nenhuma série ancora nela.
// - Cancelamento(P): apesar do nome, está VAZIA em todas as 4.331 linhas
//   CANCELADO e PREENCHIDA em todas as 50.662 CONCLUIDO, tipicamente cerca de
//   um ano depois da conclusão -- comporta-se como prazo contratual, não como
//   data de evento. É por isso que canceladas ancoram em Atualizado(Q).

// Janela de sanidade de data. A planilha só tem operação a partir de
// 2023-02; qualquer serial fora daqui é lixo (a coluna Inicio Sondagem tem
// de 1901 a 2078) e é tratado como ausente, nunca como data.
const SERIAL_MIN = 44927; // 2023-01-01
const SERIAL_MAX = 46388; // 2027-01-01

const COLUNAS_OBRIGATORIAS = {
  sup: 'Contrato',
  criacaoOS: 'Criação da OS',
  tipo: 'Tipo',
  status: 'Status',
  terminoSondagem: 'Termino Sondagem',
  conclusao: 'Conclusão',
  atualizado: 'Atualizado',
};

function texto(valor) {
  return String(valor === null || valor === undefined ? '' : valor).trim();
}

function locateColunasAvancos(headerRow) {
  const linha = headerRow || [];
  const cols = {};
  for (const [campo, rotulo] of Object.entries(COLUNAS_OBRIGATORIAS)) {
    let achou = -1;
    for (let col = 0; col < linha.length; col++) {
      if (texto(linha[col]) === rotulo) { achou = col; break; }
    }
    if (achou === -1) {
      throw new Error(`Coluna "${rotulo}" não encontrada no cabeçalho da aba Avanços -- o layout da planilha pode ter mudado.`);
    }
    cols[campo] = achou;
  }
  return cols;
}

// Serial fora da janela, vazio ou não-numérico vira null. Sem isso, célula
// vazia viraria 1899-12-30 e entraria como mês válido em alguma série.
function dataSaneada(valor) {
  const serial = Number(valor);
  if (!Number.isFinite(serial) || serial < SERIAL_MIN || serial > SERIAL_MAX) return null;
  return excelSerialParaData(serial);
}

function parseAvancos(grid) {
  const cols = locateColunasAvancos(grid[1]);
  const furos = [];
  let descartadas = 0;
  let semDataTermino = 0;

  for (let r = 2; r < grid.length; r++) {
    const linha = grid[r];
    if (!linha) continue;
    const sup = texto(linha[cols.sup]);
    const tipoCru = texto(linha[cols.tipo]);
    // 21 linhas da planilha real não têm SUP, tipo nem profundidade -- são
    // resto de edição. Descartadas e contadas, nunca rotuladas (rotular
    // lançaria por tipologia vazia).
    if (!sup && !tipoCru) { descartadas++; continue; }

    let tipologia;
    try {
      tipologia = rotularTipologia(tipoCru);
    } catch (err) {
      throw new Error(`${err.message} (linha ${r} da aba Avanços)`);
    }

    const status = texto(linha[cols.status]).toUpperCase();
    const terminoSondagem = dataSaneada(linha[cols.terminoSondagem]);
    if ((status === 'CONCLUIDO' || status === 'EXECUTADO') && terminoSondagem === null) {
      semDataTermino++;
    }

    furos.push({
      sup,
      tipologia,
      status,
      criacaoOS: dataSaneada(linha[cols.criacaoOS]),
      terminoSondagem,
      conclusao: dataSaneada(linha[cols.conclusao]),
      atualizado: dataSaneada(linha[cols.atualizado]),
    });
  }

  return { furos, descartadas, semDataTermino };
}

module.exports = { parseAvancos, locateColunasAvancos, SERIAL_MIN, SERIAL_MAX };
