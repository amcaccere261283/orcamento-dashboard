'use strict';
const { excelSerialParaData } = require('../comum/datas.js');
const { classificarEnsaioLab } = require('../comum/tipologias-lab.js');
// Same-dir: este require SOBREVIVE ao bundle (vira MODULOS['parse-avancos.js'],
// ver transformaModulo) -- parse-avancos.js já vem antes de parse-lab.js em
// BUNDLE_ARQUIVOS, então a entrada existe quando esta IIFE roda.
const { dataDeTexto } = require('./parse-avancos.js');

// Lê a aba "Lab Concluido" do Avanço Sond.xlsx: uma linha por ensaio de
// laboratório JÁ CONCLUÍDO. Ao contrário de Avanços, esta aba não tem
// status nem coluna de cancelamento -- só o que terminou, sem visibilidade
// do que ainda está pendente. Por isso alimenta só Realizado/Tendência de
// LAB.C/LAB.E na Tabela Semanal, nunca uma linha de Demandas Pendentes
// (decisão do dono do projeto, 2026-07-31 -- ele pretende trazer a
// demanda de laboratório pra planilha depois; até lá, fica de fora).
//
// Roda tanto no Node (build/testes) quanto no navegador: este arquivo ESTÁ em
// BUNDLE_ARQUIVOS (tools/semanal/render-semanal.js), porque o botão "Atualizar
// dados" reparseia o espelho de Lab Concluido ao vivo. Os dois requires
// '../comum/' acima são de FORA do diretório que buildBrowserBundle concatena,
// então transformaModulo (tools/comum/browser-bundle.js) REMOVE as linhas em
// vez de reescrevê-las pra MODULOS -- assume-se que `excelSerialParaData` e
// `classificarEnsaioLab` já existem como globais quando este código roda. Quem
// garante isso é renderSemanal(), que injeta fonteParaCliente() de
// tools/comum/datas.js e tools/comum/tipologias-lab.js num <script> ANTES do
// bundle (mesmo mecanismo já documentado em compute-balanco.js e
// compute-demandas.js). No Node o require funciona normalmente, sem depender
// de nada disso -- quem cobre a versão bundlada é
// test/comum-browser-bundle.test.js.
//
// Colunas usadas, com o nome EXATO da planilha (medido em 2026-07-31):
// ID Contrato · Concluído Dia · Tipo de Ensaio.

// Mesma janela de sanidade de parse-avancos.js -- a planilha só tem
// operação a partir de 2023, qualquer serial fora daqui é lixo.
const SERIAL_MIN = 44927; // 2023-01-01
const SERIAL_MAX = 46388; // 2027-01-01

const COLUNAS_OBRIGATORIAS = {
  sup: 'ID Contrato',
  concluidoDia: 'Concluído Dia',
  tipoEnsaio: 'Tipo de Ensaio',
};

function texto(valor) {
  return String(valor === null || valor === undefined ? '' : valor).trim();
}

function locateColunasLab(headerRow) {
  const linha = headerRow || [];
  const cols = {};
  for (const [campo, rotulo] of Object.entries(COLUNAS_OBRIGATORIAS)) {
    let achou = -1;
    for (let col = 0; col < linha.length; col++) {
      if (texto(linha[col]) === rotulo) { achou = col; break; }
    }
    if (achou === -1) {
      throw new Error(`Coluna "${rotulo}" não encontrada no cabeçalho da aba Lab Concluido -- o layout da planilha pode ter mudado.`);
    }
    cols[campo] = achou;
  }
  return cols;
}

// Serial fora da janela, vazio ou não-numérico vira null.
//
// Mesmo fallback pra dataDeTexto (dd/MM/yyyy) de parse-avancos.js, pelo mesmo
// motivo: a Sheet ESPELHO que alimenta o botão "Atualizar dados" pode publicar
// a data como texto já formatado em vez de serial, e sem o fallback isso
// viraria null em silêncio (Realizado/Tendência de LAB.C/LAB.E zerados, com o
// botão reportando "Atualizado"). Continua devolvendo null quando não é nem
// serial na janela nem dd/MM/yyyy válido.
function dataSaneada(valor) {
  const serial = Number(valor);
  if (Number.isFinite(serial) && serial >= SERIAL_MIN && serial <= SERIAL_MAX) return excelSerialParaData(serial);
  return dataDeTexto(valor);
}

function parseLab(grid) {
  const cols = locateColunasLab(grid[1]);
  const ensaios = [];
  let descartadas = 0;

  for (let r = 2; r < grid.length; r++) {
    const linha = grid[r];
    if (!linha) continue;
    const sup = texto(linha[cols.sup]);
    const tipoCru = texto(linha[cols.tipoEnsaio]);

    // Linha genuinamente vazia (não medida na planilha real, mas o mesmo
    // cuidado de parse-avancos.js). "TESTE" é lixo de planilha (176 linhas
    // medidas em 2026-07-31), não um SUP real. SUPs fora do padrão
    // SUP-XXXX-YY (ex.: SUP-EPR_Ametista, 456 linhas) são MANTIDOS: são
    // contratos reais fora do padrão comum, não lixo -- mesmo raciocínio de
    // "nada é descartado por não casar com a MATRIZ" em compute-demandas.js.
    if (!sup && !tipoCru) { descartadas++; continue; }
    if (sup.toUpperCase() === 'TESTE') { descartadas++; continue; }

    let tipologia;
    try {
      tipologia = classificarEnsaioLab(tipoCru);
    } catch (err) {
      throw new Error(`${err.message} (linha ${r} da aba Lab Concluido)`);
    }

    ensaios.push({
      sup,
      tipologia,
      concluido: dataSaneada(linha[cols.concluidoDia]),
    });
  }

  return { ensaios, descartadas };
}

module.exports = { parseLab, locateColunasLab, SERIAL_MIN, SERIAL_MAX };
