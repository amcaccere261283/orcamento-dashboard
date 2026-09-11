const test = require('node:test');
const assert = require('node:assert/strict');
const { montarBacklog2026, gerarBacklog2026Online } = require('../tools/orcamento/compute-backlog-2026.js');

const PERIODOS_2026 = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2026, i, 1)));
const HOJE_SET = new Date(Date.UTC(2026, 8, 11)); // vigente = setembro (índice 8)
const registro = (sup, realizado, total, tomador = 'Cliente') => ({
  sup, tomador, tipologia: 'SP',
  realizado: realizado ? { financeiro: realizado } : null,
  total: total ? { financeiro: total } : null,
});

test('soma as tipologias do mesmo SUP: realizado até o mês vigente e tendência = Total fechado - realizado', () => {
  // A: realizado 8x10 + 5 (set) = 85. Total fechado: jan-ago = realizado (80),
  // set = 5 + 20 = 25, out-dez = 90 -> 195. Tendência 110.
  // B (sem série R): Total fechado = 0 em set + 3x10 = 30. Tendência 30.
  const linhas = montarBacklog2026({
    registros: [
      registro('SUP-1-26', [10, 10, 10, 10, 10, 10, 10, 10, 5, 0, 0, 0], [1, 1, 1, 1, 1, 1, 1, 1, 20, 30, 30, 30]),
      registro('SUP-1-26', null, [null, null, null, null, null, null, null, null, 0, 10, 10, 10]),
    ],
    periodos: PERIODOS_2026, today: HOJE_SET,
  });
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].sup, 'SUP-1-26');
  assert.equal(linhas[0].realizado2026, 85);
  assert.equal(linhas[0].tendenciaRestante2026, 140);
});

test('zero de fim de série (mês ainda não reportado) não apaga a tendência daquele mês', () => {
  // Último mês reportado = jul. Ago e set têm 0 artificial no Realizado ->
  // valem pela linha T (9 cada), igual à Tabela do orçamento.
  const [l] = montarBacklog2026({
    registros: [registro('SUP-2-26', [5, 5, 5, 5, 5, 5, 5, 0, 0, 0, 0, 0], new Array(12).fill(9))],
    periodos: PERIODOS_2026, today: HOJE_SET,
  });
  assert.equal(l.realizado2026, 35);
  assert.equal(l.tendenciaRestante2026, 45); // Total 80 - realizado 35
});

test('registro sem SUP fica de fora; ano de 2026 ainda no futuro devolve lista vazia', () => {
  const registros = [registro(null, [1], [1]), registro('SUP-3-26', new Array(12).fill(1), new Array(12).fill(1))];
  assert.deepEqual(montarBacklog2026({ registros, periodos: PERIODOS_2026, today: HOJE_SET }).map((l) => l.sup), ['SUP-3-26']);
  assert.deepEqual(montarBacklog2026({ registros, periodos: PERIODOS_2026, today: new Date(Date.UTC(2025, 11, 31)) }), []);
});

test('gerarBacklog2026Online: cabeçalho fixo, centavos com ponto decimal, tomador com vírgula escapado', () => {
  const csv = gerarBacklog2026Online([{ sup: 'SUP-1-24', tomador: 'Empresa, Ltda', realizado2026: 1234.567, tendenciaRestante2026: 10 }]);
  assert.equal(csv, 'Cliente,Contrato,Realizado2026,TendenciaRestante2026\n"Empresa, Ltda",SUP-1-24,1234.57,10\n');
  assert.equal(gerarBacklog2026Online([]), 'Cliente,Contrato,Realizado2026,TendenciaRestante2026\n');
});
