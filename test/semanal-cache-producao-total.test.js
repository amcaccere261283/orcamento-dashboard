'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { mesesParaBuscar } = require('../tools/semanal/atualizar-avancos-online.js');
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
