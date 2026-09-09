// test/orcamento-calibrar-saldo-abertura-lab.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calibrarSaldoAberturaLab } = require('../tools/orcamento/build-dashboard.js');

function periodos2026() {
  return Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2026, i, 1)));
}

const REGISTROS = [
  { sup: 'SUP-1', tipologia: 'LAB.C' },
  { sup: 'SUP-2', tipologia: 'LAB.E' },
  { sup: 'Diversos', tipologia: 'LAB.C' },
  { sup: 'Diversos', tipologia: 'LAB.E' },
  { sup: 'SUP-3', tipologia: 'SP' }, // outra tipologia, não deve ser tocada
];

test('soma a diferença ao saldo de abertura de Diversos, proporcional ao saldo que cada tipologia já tinha', () => {
  const chegadasMensais = {
    'SUP-1||LAB.C': [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 0, 0, 0, 0],
    'SUP-2||LAB.E': [200, 200, 200, 200, 200, 200, 200, 200, 0, 0, 0, 0],
  };
  const saldoAbertura = {
    'SUP-1||LAB.C': 8000, // 80% do saldo LAB.C+LAB.E
    'SUP-2||LAB.E': 2000, // 20%
  };

  // Acumulado atual em agosto/2026 (índice 7, jan..ago inclusive):
  // saldo (10000) + 8 meses de chegadas (1000+200)*8 = 10000 + 9600 = 19600.
  // O alvo é fixo no módulo (129058, o número real medido pelo dono do
  // projeto em 31/08/2026 -- ver o comentário em build-dashboard.js) --
  // diferença = 129058 - 19600 = 109458, repartida 80/20.
  const original = JSON.parse(JSON.stringify(saldoAbertura));
  const calibrado = calibrarSaldoAberturaLab({
    registros: REGISTROS, periodos: periodos2026(), chegadasMensais, saldoAbertura,
  });

  assert.deepStrictEqual(saldoAbertura, original, 'não deve mutar o saldoAbertura recebido');
  assert.strictEqual(calibrado['Diversos||LAB.C'], 87566, '80% de 109458 (arredondado), proporcional ao saldo que LAB.C já tinha');
  assert.strictEqual(calibrado['Diversos||LAB.E'], 21892, 'resto da divisão (último da lista) -- soma exata com LAB.C');
});

test('sem diferença (acumulado já bate com o alvo real do projeto), devolve o mesmo objeto sem criar chaves novas', () => {
  const chegadasMensais = { 'SUP-1||LAB.C': new Array(12).fill(0) };
  const saldoAbertura = { 'SUP-1||LAB.C': 129058 }; // já fecha em agosto/2026 com o alvo exato
  const calibrado = calibrarSaldoAberturaLab({
    registros: [{ sup: 'SUP-1', tipologia: 'LAB.C' }, { sup: 'Diversos', tipologia: 'LAB.E' }],
    periodos: periodos2026(), chegadasMensais, saldoAbertura,
  });
  assert.strictEqual(calibrado, saldoAbertura, 'diferença zero devolve o mesmo objeto, sem cópia nem chave nova');
});

test('ano diferente do calibrado (2027) não aplica nenhum ajuste', () => {
  const periodos2027 = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2027, i, 1)));
  const saldoAbertura = { 'SUP-1||LAB.C': 10 };
  const calibrado = calibrarSaldoAberturaLab({
    registros: REGISTROS, periodos: periodos2027, chegadasMensais: {}, saldoAbertura,
  });
  assert.strictEqual(calibrado, saldoAbertura, 'ano fora do alvo devolve o mesmo objeto, sem cópia nem ajuste');
});

test('nenhuma tipologia LAB.C/LAB.E tem saldo de abertura: divide a diferença igualmente entre as duas', () => {
  const chegadasMensais = {};
  const saldoAbertura = {};
  const calibrado = calibrarSaldoAberturaLab({
    registros: REGISTROS, periodos: periodos2026(), chegadasMensais, saldoAbertura,
  });
  // Acumulado atual = 0; alvo real do projeto (129058) vira a diferença inteira.
  assert.strictEqual(calibrado['Diversos||LAB.C'] + calibrado['Diversos||LAB.E'], 129058);
  // Metade pra cada, com o resto (número ímpar) no último da lista (LAB.E).
  assert.strictEqual(calibrado['Diversos||LAB.C'], 64529);
  assert.strictEqual(calibrado['Diversos||LAB.E'], 64529);
});
