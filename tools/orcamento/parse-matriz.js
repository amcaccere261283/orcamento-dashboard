'use strict';

function rotuloEm(headerRow, col) {
  return String(headerRow[col] ?? '').trim();
}

function acharColuna(headerRow, rotulo) {
  for (let col = 0; col < headerRow.length; col++) {
    if (rotuloEm(headerRow, col) === rotulo) return col;
  }
  throw new Error(`Coluna "${rotulo}" não encontrada na linha de cabeçalho da MATRIZ`);
}

function proximasNColunas(colunaAncora, quantidade) {
  const cols = [];
  for (let i = 0; i < quantidade; i++) cols.push(colunaAncora + 1 + i);
  return cols;
}

function exigirRotulo(headerRow, col, esperado) {
  const encontrado = rotuloEm(headerRow, col);
  if (encontrado !== esperado) {
    throw new Error(`Esperava a coluna "${esperado}" na posição ${col} da MATRIZ, encontrei "${encontrado}" -- o layout da planilha pode ter mudado`);
  }
}

// Acha cada coluna pelo próprio rótulo da linha 1 (nunca por posição fixa),
// pra sobreviver a pequenas mudanças de layout entre revisões do modelo --
// mas os 3 blocos de 12 meses continuam assumidos como blocos fixos de 12
// colunas fechados por rótulos conhecidos (PICO/MÉDIA/PROD./DIAS,
// TOTAL/TOTAL INICIAL/TICKET, TOTAL/TOTAL INICIAL). Se a forma mudar (menos
// de 12 meses, blocos reordenados), lança erro em vez de ler dado errado
// em silêncio.
function locateColumns(grid) {
  const headerRow = grid[1];
  if (!headerRow) throw new Error('Linha de cabeçalho (linha 1) da MATRIZ está vazia');

  const origem = acharColuna(headerRow, 'ORIGEM');
  const grupo = acharColuna(headerRow, 'GRUPO');
  const tomador = acharColuna(headerRow, 'TOMADOR');
  const sup = acharColuna(headerRow, 'SUP');
  const escopo = acharColuna(headerRow, 'ESCOPO');
  const apoio = acharColuna(headerRow, 'APOIO');
  const inicio = acharColuna(headerRow, 'INICIO');
  const termino = acharColuna(headerRow, 'TERMINO');
  const sondagem = acharColuna(headerRow, 'SONDAGEM');
  const base = acharColuna(headerRow, 'BASE');

  const equipesMeses = proximasNColunas(base, 12);
  const pico = equipesMeses[11] + 1;
  exigirRotulo(headerRow, pico, 'PICO');
  const media = pico + 1;
  exigirRotulo(headerRow, media, 'MÉDIA');
  const prod = media + 1;
  exigirRotulo(headerRow, prod, 'PROD.');
  const dias = prod + 1;
  exigirRotulo(headerRow, dias, 'DIAS');

  const volumeMeses = proximasNColunas(dias, 12);
  const volumeTotal = volumeMeses[11] + 1;
  exigirRotulo(headerRow, volumeTotal, 'TOTAL');
  const volumeTotalInicial = volumeTotal + 1;
  const ticket = volumeTotalInicial + 1;
  exigirRotulo(headerRow, ticket, 'TICKET');

  const financeiroMeses = proximasNColunas(ticket, 12);
  const financeiroTotal = financeiroMeses[11] + 1;
  exigirRotulo(headerRow, financeiroTotal, 'TOTAL');
  const financeiroTotalInicial = financeiroTotal + 1;

  const observacao = financeiroTotalInicial + 1;

  return {
    origem, grupo, tomador, sup, escopo, apoio, inicio, termino, sondagem, base,
    equipesMeses, equipesResumo: { pico, media, prod, dias },
    volumeMeses, volumeResumo: { total: volumeTotal, totalInicial: volumeTotalInicial, ticket },
    financeiroMeses, financeiroResumo: { total: financeiroTotal, totalInicial: financeiroTotalInicial },
    observacao,
  };
}

function extrairValoresLinha(row, columns) {
  return {
    // Meses ficam null (não 0) quando a célula da MATRIZ está em branco --
    // "sem dado reportado ainda" é diferente de "reportado como zero", e o
    // dashboard (tabela e gráfico) precisa distinguir os dois (ver
    // somarArraysMensais em render-dashboard.js). Os campos-resumo abaixo
    // (pico/média/total/ticket etc.) continuam 0 por padrão -- são valores
    // anuais/agregados já calculados pela própria planilha, não a série
    // mês a mês que motivou essa distinção.
    equipes: columns.equipesMeses.map(col => row[col] ?? null),
    equipesResumo: {
      pico: row[columns.equipesResumo.pico] ?? 0,
      media: row[columns.equipesResumo.media] ?? 0,
      prod: row[columns.equipesResumo.prod] ?? 0,
      dias: row[columns.equipesResumo.dias] ?? 0,
    },
    volume: columns.volumeMeses.map(col => row[col] ?? null),
    volumeResumo: {
      total: row[columns.volumeResumo.total] ?? 0,
      totalInicial: row[columns.volumeResumo.totalInicial] ?? 0,
      ticket: row[columns.volumeResumo.ticket] ?? 0,
    },
    financeiro: columns.financeiroMeses.map(col => row[col] ?? null),
    financeiroResumo: {
      total: row[columns.financeiroResumo.total] ?? 0,
      totalInicial: row[columns.financeiroResumo.totalInicial] ?? 0,
    },
  };
}

// Linhas de resumo pré-calculadas pelo Excel (total geral com GRUPO="Todos"
// no topo da aba, e os totais MENSAL/ACUMULADO no fim de cada contrato) não
// são dados reais de contrato -- confirmado com o usuário, o dashboard
// recalcula os mesmos totais a partir dos registros reais.
const TIPOLOGIAS_RESUMO = new Set(['MENSAL', 'ACUMULADO']);
function deveIncluir(registro) {
  if (!registro.grupo || registro.grupo === 'Todos') return false;
  if (!registro.tipologia || TIPOLOGIAS_RESUMO.has(registro.tipologia)) return false;
  return true;
}

// Cada combinação (contrato, tipologia) ocupa 3 linhas físicas na planilha:
// P (Previsto), R (Realizado), T (Total) -- identificadas pela coluna BASE,
// nunca por posição relativa. Campos identificadores (ORIGEM..TERMINO,
// SONDAGEM) usam preenchimento "sticky": adota o valor da própria linha
// quando presente, senão mantém o último valor visto -- isso cobre os dois
// estilos de preenchimento reais vistos na planilha (em branco depois da
// primeira linha do grupo, ou repetido em toda linha).
function parseMatriz(grid) {
  const columns = locateColumns(grid);
  const registros = [];
  const estado = {
    origem: null, grupo: null, tomador: null, sup: null, escopo: null,
    apoio: null, inicio: null, termino: null, tipologia: null,
  };
  let atual = null;

  for (let rowNum = 2; rowNum < grid.length; rowNum++) {
    const row = grid[rowNum];
    if (!row) continue;
    const base = row[columns.base];
    if (base == null) continue;

    estado.origem = row[columns.origem] ?? estado.origem;
    estado.grupo = row[columns.grupo] ?? estado.grupo;
    estado.tomador = row[columns.tomador] ?? estado.tomador;
    estado.sup = row[columns.sup] ?? estado.sup;
    estado.escopo = row[columns.escopo] ?? estado.escopo;
    estado.apoio = row[columns.apoio] ?? estado.apoio;
    estado.inicio = row[columns.inicio] ?? estado.inicio;
    estado.termino = row[columns.termino] ?? estado.termino;
    estado.tipologia = row[columns.sondagem] ?? estado.tipologia;

    if (base === 'P') {
      atual = {
        origem: estado.origem, grupo: estado.grupo, tomador: estado.tomador, sup: estado.sup,
        escopo: estado.escopo, apoio: estado.apoio, inicio: estado.inicio, termino: estado.termino,
        tipologia: estado.tipologia, observacao: null,
        previsto: extrairValoresLinha(row, columns), realizado: null, total: null,
      };
    } else if (base === 'R' && atual) {
      atual.realizado = extrairValoresLinha(row, columns);
    } else if (base === 'T' && atual) {
      atual.total = extrairValoresLinha(row, columns);
      atual.observacao = row[columns.observacao] ?? null;
      if (deveIncluir(atual)) registros.push(atual);
      atual = null;
    }
  }
  return registros;
}

module.exports = { parseMatriz, locateColumns };
