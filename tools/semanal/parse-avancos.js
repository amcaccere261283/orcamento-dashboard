'use strict';
const { excelSerialParaData } = require('../comum/datas.js');
const { rotularTipologia } = require('../comum/tipologias-avancos.js');

// Lê a aba "Avanços" do Avanço Sond.xlsx: 61.927 linhas, uma por furo. Só
// leitura e saneamento -- nenhuma agregação (isso é compute-demandas.js).
//
// Node-only: NUNCA entra no bundle do navegador. As dependências externas acima
// seriam REMOVIDAS por transformaModulo (tools/comum/browser-bundle.js),
// e as funções virariam undefined em produção com os testes passando.
//
// Colunas usadas, com o nome EXATO da planilha (medido em 2026-07-29):
// Contrato(A) · Criação da OS(I) · Tipo(J) · Status(L) · Termino Sondagem(N,
// sem acento em "Termino") · Conclusão(O) · Cancelamento(P) · Atualizado(Q) ·
// Observações de Campo(AB).
//
// Uma coluna de propósito NÃO usada:
// - Inicio Sondagem(M): 3.929 das 61.927 linhas têm data fora de 2023-2027
//   (de 1901 a 2078). Nenhuma série ancora nela.

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
  cancelamento: 'Cancelamento',
  atualizado: 'Atualizado',
  observacoesCampo: 'Observações de Campo',
};

function texto(valor) {
  return String(valor === null || valor === undefined ? '' : valor).trim();
}

// Ponto de "deslocamento" (novo furo aberto ao lado de um impenetrável) não é
// demanda nova -- é o mesmo furo original, reposicionado. Fica marcado só na
// Observações de Campo, em texto livre ("Deslocamento A", "Foram executados
// deslocamentos A e B" etc.) -- decisão do dono do projeto, 2026-08-01: 10.407
// linhas na planilha real levam a palavra, e nenhuma delas deve contar em
// nenhuma série. Regex insensível a maiúsculas: a grafia varia entre linhas.
const RE_DESLOCAMENTO = /deslocamento/i;

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

// A coluna Cancelamento é a ÚNICA data desta aba gravada como texto
// (dd/MM/yyyy), não como serial Excel. Medido em 2026-07-30: as 4.331 linhas
// CANCELADO têm valor e todas as 4.331 parseiam. Number() num "27/02/2025"
// devolve NaN -- foi assim que uma sondagem anterior concluiu, errado, que a
// coluna estava vazia, e o spec chegou a declarar Q (Atualizado) como âncora
// proxy das canceladas. Ver o bloco "Correção de 2026-07-30" no spec.
//
// Valida os componentes DEPOIS de montar a data: `new Date(Date.UTC(2025, 30, 31))`
// não é Invalid Date, é uma data deslocada para outro mês. Um Invalid Date
// solto seria pior que null -- ele compara `false` contra qualquer data, então
// o furo sairia da série de canceladas E do estoque, sem erro nenhum.
function dataDeTexto(valor) {
  const bruto = texto(valor);
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(bruto);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const ano = Number(m[3]);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia) return null;
  return data;
}

function parseAvancos(grid) {
  const cols = locateColunasAvancos(grid[1]);
  const furos = [];
  let descartadas = 0;
  let semDataTermino = 0;
  let cancelamentoIlegivel = 0;
  let deslocamentos = 0;

  for (let r = 2; r < grid.length; r++) {
    const linha = grid[r];
    if (!linha) continue;
    const sup = texto(linha[cols.sup]);
    const tipoCru = texto(linha[cols.tipo]);
    // 21 linhas da planilha real não têm SUP, tipo nem profundidade -- são
    // resto de edição. Descartadas e contadas, nunca rotuladas (rotular
    // lançaria por tipologia vazia).
    if (!sup && !tipoCru) { descartadas++; continue; }

    // Deslocamento: descartada ANTES de rotular (não precisa de tipologia
    // válida pra ser excluída) -- ver RE_DESLOCAMENTO acima.
    if (RE_DESLOCAMENTO.test(texto(linha[cols.observacoesCampo]))) { deslocamentos++; continue; }

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

    const cancelamento = dataDeTexto(linha[cols.cancelamento]);
    // Só é anomalia quando a linha ESTÁ cancelada: nas outras a coluna é
    // legitimamente vazia. Uma cancelada sem data legível fica fora da série de
    // canceladas e, de propósito, DENTRO do estoque -- "não sei quando saiu" é
    // mais honesto que "saiu no começo".
    if (status === 'CANCELADO' && cancelamento === null) cancelamentoIlegivel++;

    furos.push({
      sup,
      tipologia,
      status,
      criacaoOS: dataSaneada(linha[cols.criacaoOS]),
      terminoSondagem,
      conclusao: dataSaneada(linha[cols.conclusao]),
      cancelamento,
      atualizado: dataSaneada(linha[cols.atualizado]),
    });
  }

  return { furos, descartadas, semDataTermino, cancelamentoIlegivel, deslocamentos };
}

module.exports = {
  parseAvancos, locateColunasAvancos, dataDeTexto, SERIAL_MIN, SERIAL_MAX,
};
