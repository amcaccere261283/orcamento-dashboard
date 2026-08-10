'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { mesesParaBuscar, cacheUtilizavel } = require('../tools/semanal/atualizar-avancos-online.js');
const { HEADER_SAIDA } = require('../tools/semanal/mapear-producao-total.js');
const { gridParaCsv } = require('../tools/semanal/csv-writer-avancos.js');
const { parseCsvGrid } = require('../tools/semanal/parse-matriz-cliente.js');

test('cobre de 2025-01 até o mês de hoje, inclusive', () => {
  const meses = mesesParaBuscar(new Date(Date.UTC(2026, 7, 8))); // agosto/2026
  assert.strictEqual(meses.length, 20); // jan/2025 .. ago/2026
  assert.deepStrictEqual(meses[0], { ano: 2025, mes: 1, ehMesCorrente: false });
  assert.deepStrictEqual(meses[meses.length - 1], { ano: 2026, mes: 8, ehMesCorrente: true });
});

test('só o último mês da lista é o mês corrente', () => {
  const meses = mesesParaBuscar(new Date(Date.UTC(2026, 0, 15))); // janeiro/2026
  assert.strictEqual(meses.filter(m => m.ehMesCorrente).length, 1);
  assert.strictEqual(meses[meses.length - 1].ehMesCorrente, true);
});

test('roda em janeiro/2025 (o próprio mês de início) sem devolver lista vazia nem negativa', () => {
  const meses = mesesParaBuscar(new Date(Date.UTC(2025, 0, 10)));
  assert.strictEqual(meses.length, 1);
  assert.deepStrictEqual(meses[0], { ano: 2025, mes: 1, ehMesCorrente: true });
});

// Regressão: concatenar meses como GRIDS (arrays de arrays) -- e não como
// texto CSV já serializado cortado por '\n' -- pra um campo com quebra de
// linha interna (ex. "Observações de campo") não corromper a contagem de
// linhas do grid combinado. Simula o que main() faz em
// tools/semanal/atualizar-avancos-online.js: concatena grids, serializa com
// gridParaCsv só UMA VEZ no final.
test('grid combinado preserva campo com \\n interno sem virar linha falsa', () => {
  const header = ['Contrato', 'Observações de Campo', 'OS'];
  const gridMes1 = [
    header,
    ['C1', 'linha unica', 'OS-1'],
    ['C2', 'primeira linha\nsegunda linha\nterceira linha', 'OS-2'],
  ];
  const gridMes2 = [
    header,
    ['C3', 'outra observação normal', 'OS-3'],
  ];

  // Mesma lógica de main(): cabeçalho do primeiro + linhas de dado de todos.
  const linhasDado = [gridMes1, gridMes2].flatMap((grid) => grid.slice(1));
  const gridFinal = [header, ...linhasDado];

  assert.strictEqual(gridFinal.length, 4); // header + 3 linhas de dado (não mais, por causa dos \n internos)

  const csv = gridParaCsv(gridFinal);
  const reparsed = parseCsvGrid(csv);

  assert.strictEqual(reparsed.length, 4);
  assert.deepStrictEqual(reparsed[0], header);
  assert.strictEqual(reparsed[2][1], 'primeira linha\nsegunda linha\nterceira linha');
  assert.strictEqual(reparsed[3][0], 'C3');
});

// --- guard de formato do cache (2026-08-10) --------------------------------
//
// HEADER_SAIDA encolheu de 12 para 9 colunas quando o mapeador parou de
// fabricar "Inicio Sondagem"/"Conclusão"/"Cancelamento"/"Atualizado" e passou
// a carregar "Deslocamento". Meses FECHADOS vêm do cache em disco na maioria
// das execuções, então sem um guard o histórico inteiro voltaria no formato
// velho enquanto o mês corrente viria no novo -- e main() usa o cabeçalho do
// PRIMEIRO grid para todos, deslocando as colunas de ~19 meses em silêncio.

test('cacheUtilizavel aceita um cache no formato atual', () => {
  const grid = [HEADER_SAIDA.slice(), ['SUP-1', '10/03/2026', 'SP', 'CONCLUIDO', '12/03/2026', 'Não', '', '1-26', 'Ana']];
  assert.strictEqual(cacheUtilizavel(grid), true);
});

test('cacheUtilizavel REJEITA o cabeçalho antigo de 12 colunas', () => {
  const antigo = ['Contrato', 'Criação da OS', 'Tipo', 'Status', 'Inicio Sondagem',
    'Termino Sondagem', 'Conclusão', 'Cancelamento', 'Atualizado',
    'Observações de Campo', 'OS', 'Sondador'];
  assert.strictEqual(cacheUtilizavel([antigo]), false);
});

test('cacheUtilizavel rejeita cache vazio ou sem cabeçalho', () => {
  assert.strictEqual(cacheUtilizavel([]), false);
  assert.strictEqual(cacheUtilizavel(null), false);
});

test('cacheUtilizavel rejeita cabeçalho com as colunas certas em ordem trocada', () => {
  const trocado = HEADER_SAIDA.slice();
  [trocado[0], trocado[1]] = [trocado[1], trocado[0]];
  assert.strictEqual(cacheUtilizavel([trocado]), false);
});
