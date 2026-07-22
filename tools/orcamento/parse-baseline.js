'use strict';

// Lê a aba "PROJ. GERAL - 110MM" do estudo original de linha de base
// ("Estudo remobilização Equipes - 2026 AC 04.A.xlsx") -- uma foto única do
// que foi previsto no início do projeto, por isso o layout NÃO tem a coluna
// BASE (P/R/T) que a MATRIZ viva usa: cada linha real já é uma combinação
// (SUP, tipologia) só, com os 12 meses de equipes/volume/financeiro
// direto. Confirmado com o usuário: somando financeiro de todas as linhas
// reais (excluindo os blocos-resumo MENSAL/ACUMULADO no topo) bate R$
// 110.014.410,00 -- o "110MM" do nome da aba -- e é essa soma que
// build-dashboard usa como conferência ao montar o dashboard.

function rotuloEm(headerRow, col) {
  return String(headerRow[col] ?? '').trim();
}

function acharColuna(headerRow, rotulo) {
  for (let col = 0; col < headerRow.length; col++) {
    if (rotuloEm(headerRow, col) === rotulo) return col;
  }
  throw new Error(`Coluna "${rotulo}" não encontrada no cabeçalho da linha de base`);
}

function proximasNColunas(colunaAncora, quantidade) {
  const cols = [];
  for (let i = 0; i < quantidade; i++) cols.push(colunaAncora + 1 + i);
  return cols;
}

function exigirRotulo(headerRow, col, esperado) {
  const encontrado = rotuloEm(headerRow, col);
  if (encontrado !== esperado) {
    throw new Error(`Esperava a coluna "${esperado}" na posição ${col} da linha de base, encontrei "${encontrado}" -- o layout da planilha pode ter mudado`);
  }
}

// SONDAGEM é a âncora dos 3 blocos de 12 meses aqui (não BASE, que não
// existe nesta aba). O rótulo da coluna PICO+1 é "FRENTES" nesta planilha
// (não "MÉDIA" como na MATRIZ) -- só pula essa validação específica, o
// resto seria idêntico.
function locateColumns(headerRow) {
  const sup = acharColuna(headerRow, 'SUP');
  const grupo = acharColuna(headerRow, 'GRUPO');
  const sondagem = acharColuna(headerRow, 'SONDAGEM');

  const equipesMeses = proximasNColunas(sondagem, 12);
  const pico = equipesMeses[11] + 1;
  const frentes = pico + 1;
  const prod = frentes + 1;
  exigirRotulo(headerRow, prod, 'PROD.');
  const dias = prod + 1;
  exigirRotulo(headerRow, dias, 'DIAS');

  const volumeMeses = proximasNColunas(dias, 12);
  const volumeTotal = volumeMeses[11] + 1;
  exigirRotulo(headerRow, volumeTotal, 'TOTAL');
  const ticket = volumeTotal + 1;
  exigirRotulo(headerRow, ticket, 'TICKET');

  const financeiroMeses = proximasNColunas(ticket, 12);
  const financeiroTotal = financeiroMeses[11] + 1;
  exigirRotulo(headerRow, financeiroTotal, 'TOTAL');

  return { sup, grupo, sondagem, equipesMeses, volumeMeses, financeiroMeses, pico, frentes, prod, dias, ticket };
}

const TIPOLOGIAS_RESUMO = new Set(['MENSAL', 'ACUMULADO']);

// SUP + tipologia -> { equipes, volume, financeiro } (arrays de 12 meses,
// null onde a célula de origem estava em branco -- mesma convenção da
// MATRIZ). Também devolve a soma de financeiro do ano inteiro através de
// TODAS as linhas reais, pra build-dashboard conferir contra os ~110MM.
function parseBaseline(grid) {
  const headerRow = grid[2];
  if (!headerRow) throw new Error('Linha de cabeçalho (linha 2) da linha de base está vazia');
  const columns = locateColumns(headerRow);

  const porChave = new Map();
  let somaFinanceiroConferencia = 0;

  for (let rowNum = 3; rowNum < grid.length; rowNum++) {
    const row = grid[rowNum];
    if (!row) continue;
    const sup = row[columns.sup];
    const grupo = row[columns.grupo];
    const tipologia = row[columns.sondagem];
    if (sup == null || !grupo || !tipologia || TIPOLOGIAS_RESUMO.has(tipologia)) continue;

    const equipes = columns.equipesMeses.map(col => row[col] ?? null);
    const volume = columns.volumeMeses.map(col => row[col] ?? null);
    const financeiro = columns.financeiroMeses.map(col => row[col] ?? null);
    financeiro.forEach(v => { somaFinanceiroConferencia += v || 0; });

    porChave.set(`${sup}||${tipologia}`, { equipes, volume, financeiro });
  }

  return { porChave, somaFinanceiroConferencia };
}

module.exports = { parseBaseline, locateColumns };
