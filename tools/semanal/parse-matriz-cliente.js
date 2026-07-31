'use strict';

// Réplica em JS, só pra semanal, do parsing de CSV/MATRIZ que
// tools/orcamento/render-dashboard.js já tem embutido no próprio JS de
// cliente (linhas 1552-1746) -- não um require cruzado, porque aquele texto
// vive dentro de um template literal, não de um módulo Node de verdade, e
// porque tocar em render-dashboard.js quebraria o golden byte-a-byte do
// orçamento (test/orcamento-html-inalterado.test.js). Dívida consciente,
// registrada em docs/superpowers/specs/2026-07-31-semanal-atualizar-dados-design.md
// ("Parsing do CSV da MATRIZ") -- se um dia parse-matriz.js ganhar
// fonteParaCliente(), troque esta réplica pela injeção.
//
// SEM NENHUM require de propósito: entra no bundle do navegador
// (buildBrowserBundle) sem precisar de nenhuma injeção de fonteParaCliente(),
// mesmo padrão de compute-semanal.js.

// Parser CSV RFC4180 simples (aspas duplas escapam aspas, vírgula/quebra de
// linha dentro de aspas não terminam o campo) -- suficiente pro que o
// Google Sheets exporta.
function parseCsvGrid(texto) {
  var linhas = [];
  var linha = [];
  var campo = '';
  var dentroAspas = false;
  for (var i = 0; i < texto.length; i++) {
    var c = texto[i];
    if (dentroAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; }
        else dentroAspas = false;
      } else {
        campo += c;
      }
    } else if (c === '"') {
      dentroAspas = true;
    } else if (c === ',') {
      linha.push(campo); campo = '';
    } else if (c === '\r') {
      // ignora -- o \n logo em seguida já fecha a linha
    } else if (c === '\n') {
      linha.push(campo); campo = '';
      linhas.push(linha); linha = [];
    } else {
      campo += c;
    }
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

// Converte uma célula do CSV pra número, ou null. Trata string vazia, erro
// de fórmula (#NAME?/#REF!/#VALUE!/#N/A) e "n/a" como "sem dado" -- nunca
// como 0.
function numeroPtBr(valor) {
  if (valor === undefined || valor === null) return null;
  var texto = String(valor).trim();
  if (texto === '' || texto.charAt(0) === '#' || texto.toLowerCase() === 'n/a') return null;
  var numero = parseFloat(texto.replace(/\./g, '').replace(',', '.'));
  return isNaN(numero) ? null : numero;
}

function celulaTexto(v) {
  var t = (v === undefined || v === null) ? '' : String(v).trim();
  return t === '' ? null : t;
}

// Réplica em JS de parse-matriz.js (locateColumns) -- acha cada coluna pelo
// próprio rótulo da linha de cabeçalho, nunca por posição fixa. Lançar erro
// cedo aqui evita ler dado desalinhado em silêncio se a Sheet espelho mudar
// de forma.
function acharColunaMatrizCliente(headerRow, rotulo) {
  for (var col = 0; col < headerRow.length; col++) {
    if (String(headerRow[col] || '').trim() === rotulo) return col;
  }
  throw new Error('Coluna "' + rotulo + '" não encontrada no cabeçalho do espelho ao vivo da MATRIZ');
}
function proximasNColunasMatrizCliente(colunaAncora, quantidade) {
  var cols = [];
  for (var i = 0; i < quantidade; i++) cols.push(colunaAncora + 1 + i);
  return cols;
}
function exigirRotuloMatrizCliente(headerRow, col, esperado) {
  var encontrado = String(headerRow[col] || '').trim();
  if (encontrado !== esperado) {
    throw new Error('Esperava a coluna "' + esperado + '" na posição ' + col + ' do espelho ao vivo da MATRIZ, encontrei "' + encontrado + '" -- a forma da planilha pode ter mudado');
  }
}
function locateColumnsMatrizCliente(headerRow) {
  var origem = acharColunaMatrizCliente(headerRow, 'ORIGEM');
  var grupo = acharColunaMatrizCliente(headerRow, 'GRUPO');
  var tomador = acharColunaMatrizCliente(headerRow, 'TOMADOR');
  var sup = acharColunaMatrizCliente(headerRow, 'SUP');
  var escopo = acharColunaMatrizCliente(headerRow, 'ESCOPO');
  var apoio = acharColunaMatrizCliente(headerRow, 'APOIO');
  var inicio = acharColunaMatrizCliente(headerRow, 'INICIO');
  var termino = acharColunaMatrizCliente(headerRow, 'TERMINO');
  var sondagem = acharColunaMatrizCliente(headerRow, 'SONDAGEM');
  var base = acharColunaMatrizCliente(headerRow, 'BASE');

  var equipesMeses = proximasNColunasMatrizCliente(base, 12);
  var pico = equipesMeses[11] + 1;
  exigirRotuloMatrizCliente(headerRow, pico, 'PICO');
  var media = pico + 1;
  exigirRotuloMatrizCliente(headerRow, media, 'MÉDIA');
  var prod = media + 1;
  exigirRotuloMatrizCliente(headerRow, prod, 'PROD.');
  var dias = prod + 1;
  exigirRotuloMatrizCliente(headerRow, dias, 'DIAS');

  var volumeMeses = proximasNColunasMatrizCliente(dias, 12);
  var volumeTotal = volumeMeses[11] + 1;
  exigirRotuloMatrizCliente(headerRow, volumeTotal, 'TOTAL');
  var volumeTotalInicial = volumeTotal + 1;
  var ticket = volumeTotalInicial + 1;
  exigirRotuloMatrizCliente(headerRow, ticket, 'TICKET');

  var financeiroMeses = proximasNColunasMatrizCliente(ticket, 12);
  var financeiroTotal = financeiroMeses[11] + 1;
  exigirRotuloMatrizCliente(headerRow, financeiroTotal, 'TOTAL');
  var financeiroTotalInicial = financeiroTotal + 1;

  return {
    origem: origem, grupo: grupo, tomador: tomador, sup: sup, escopo: escopo, apoio: apoio,
    inicio: inicio, termino: termino, sondagem: sondagem, base: base,
    equipesMeses: equipesMeses, equipesResumo: { pico: pico, media: media, prod: prod, dias: dias },
    volumeMeses: volumeMeses, volumeResumo: { total: volumeTotal, totalInicial: volumeTotalInicial, ticket: ticket },
    financeiroMeses: financeiroMeses, financeiroResumo: { total: financeiroTotal, totalInicial: financeiroTotalInicial },
    observacao: financeiroTotalInicial + 1,
  };
}

function extrairValoresLinhaMatrizCliente(row, columns) {
  return {
    equipes: columns.equipesMeses.map(function (col) { return numeroPtBr(row[col]); }),
    equipesResumo: {
      pico: numeroPtBr(row[columns.equipesResumo.pico]) || 0,
      media: numeroPtBr(row[columns.equipesResumo.media]) || 0,
      prod: numeroPtBr(row[columns.equipesResumo.prod]) || 0,
      dias: numeroPtBr(row[columns.equipesResumo.dias]) || 0,
    },
    volume: columns.volumeMeses.map(function (col) { return numeroPtBr(row[col]); }),
    volumeResumo: {
      total: numeroPtBr(row[columns.volumeResumo.total]) || 0,
      totalInicial: numeroPtBr(row[columns.volumeResumo.totalInicial]) || 0,
      ticket: numeroPtBr(row[columns.volumeResumo.ticket]) || 0,
    },
    financeiro: columns.financeiroMeses.map(function (col) { return numeroPtBr(row[col]); }),
    financeiroResumo: {
      total: numeroPtBr(row[columns.financeiroResumo.total]) || 0,
      totalInicial: numeroPtBr(row[columns.financeiroResumo.totalInicial]) || 0,
    },
  };
}

var TIPOLOGIAS_RESUMO_MATRIZ_CLIENTE = { MENSAL: true, ACUMULADO: true };
function deveIncluirMatrizCliente(registro) {
  if (!registro.grupo || registro.grupo === 'Todos') return false;
  if (!registro.tipologia || TIPOLOGIAS_RESUMO_MATRIZ_CLIENTE[registro.tipologia]) return false;
  return true;
}

// Réplica em JS de parse-matriz.js (parseMatriz) -- mesmo esquema de 3
// linhas físicas por combinação (contrato, tipologia) identificadas pela
// coluna BASE (P/R/T) e preenchimento "sticky" dos campos identificadores.
// grid[0] é o cabeçalho (a exportação CSV não tem a linha 0 vazia que o
// .xlsx real tem antes da linha 1).
function parseMatrizCliente(grid) {
  var columns = locateColumnsMatrizCliente(grid[0]);
  var registros = [];
  var estado = {
    origem: null, grupo: null, tomador: null, sup: null, escopo: null,
    apoio: null, inicio: null, termino: null, tipologia: null,
  };
  var atual = null;

  for (var rowNum = 1; rowNum < grid.length; rowNum++) {
    var row = grid[rowNum];
    if (!row) continue;
    var base = celulaTexto(row[columns.base]);
    if (base === null) continue;

    estado.origem = celulaTexto(row[columns.origem]) || estado.origem;
    estado.grupo = celulaTexto(row[columns.grupo]) || estado.grupo;
    estado.tomador = celulaTexto(row[columns.tomador]) || estado.tomador;
    estado.sup = celulaTexto(row[columns.sup]) || estado.sup;
    estado.escopo = celulaTexto(row[columns.escopo]) || estado.escopo;
    estado.apoio = celulaTexto(row[columns.apoio]) || estado.apoio;
    estado.inicio = celulaTexto(row[columns.inicio]) || estado.inicio;
    estado.termino = celulaTexto(row[columns.termino]) || estado.termino;
    estado.tipologia = celulaTexto(row[columns.sondagem]) || estado.tipologia;

    if (base === 'P') {
      atual = {
        origem: estado.origem, grupo: estado.grupo, tomador: estado.tomador, sup: estado.sup,
        escopo: estado.escopo, apoio: estado.apoio, inicio: estado.inicio, termino: estado.termino,
        tipologia: estado.tipologia, observacao: null,
        previsto: extrairValoresLinhaMatrizCliente(row, columns), realizado: null, total: null,
      };
    } else if (base === 'R' && atual) {
      atual.realizado = extrairValoresLinhaMatrizCliente(row, columns);
    } else if (base === 'T' && atual) {
      atual.total = extrairValoresLinhaMatrizCliente(row, columns);
      atual.observacao = celulaTexto(row[columns.observacao]);
      if (deveIncluirMatrizCliente(atual)) registros.push(atual);
      atual = null;
    }
  }
  return registros;
}

module.exports = {
  parseCsvGrid, numeroPtBr, celulaTexto,
  locateColumnsMatrizCliente, extrairValoresLinhaMatrizCliente, parseMatrizCliente,
};
