'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  parseCsvGrid, numeroPtBr, celulaTexto, parseMatrizCliente,
} = require('../tools/semanal/parse-matriz-cliente.js');

test('parseCsvGrid separa uma linha simples em campos, e mantém vírgula dentro de aspas sem quebrar o campo', () => {
  const grid = parseCsvGrid('a,b,c\n"1,5",d,"has ""quotes"" inside"\n');
  assert.deepStrictEqual(grid, [['a', 'b', 'c'], ['1,5', 'd', 'has "quotes" inside']]);
});

test('parseCsvGrid trata \\r\\n e a última linha sem quebra final', () => {
  const grid = parseCsvGrid('a,b\r\nc,d');
  assert.deepStrictEqual(grid, [['a', 'b'], ['c', 'd']]);
});

test('numeroPtBr converte formato pt-BR (milhar com ponto, decimal com vírgula) e trata erro de fórmula/vazio/n-a como null, nunca 0', () => {
  assert.strictEqual(numeroPtBr('1.234,5'), 1234.5);
  assert.strictEqual(numeroPtBr(''), null);
  assert.strictEqual(numeroPtBr('#REF!'), null);
  assert.strictEqual(numeroPtBr('n/a'), null);
  assert.strictEqual(numeroPtBr(undefined), null);
  assert.strictEqual(numeroPtBr('0'), 0);
});

test('celulaTexto normaliza string vazia/whitespace pra null', () => {
  assert.strictEqual(celulaTexto('  '), null);
  assert.strictEqual(celulaTexto(''), null);
  assert.strictEqual(celulaTexto('SUP-0001-24'), 'SUP-0001-24');
});

// Grid sintético no formato real do espelho ao vivo -- cabeçalho + um trio
// P/R/T pra um único registro, com TICKET preenchido (é o dado que motivou
// esta feature inteira -- ver o pedido do usuário no spec).
function gridMatrizSintetico(ticket) {
  const header = ['ORIGEM', 'GRUPO', 'TOMADOR', 'SUP', 'ESCOPO', 'APOIO', 'INICIO', 'TERMINO', 'SONDAGEM', 'BASE',
    ...Array(12).fill('mes'), 'PICO', 'MÉDIA', 'PROD.', 'DIAS',
    ...Array(12).fill('mes'), 'TOTAL', 'TOTAL INICIAL', 'TICKET',
    ...Array(12).fill('mes'), 'TOTAL', 'TOTAL INICIAL', 'OBS'];
  const zeros12 = () => Array(12).fill('0');
  const linhaP = ['Origem-A', 'Grupo-A', 'Tomador-A', 'SUP-0001-24', 'Escopo', 'Apoio', '01/2026', '12/2026', 'SP', 'P',
    ...zeros12(), '2', '2', '8', '25',
    ...zeros12(), '100', '100', String(ticket),
    ...zeros12(), '100', '100', ''];
  const linhaR = [...linhaP]; linhaR[9] = 'R';
  const linhaT = [...linhaP]; linhaT[9] = 'T';
  return [header, linhaP, linhaR, linhaT];
}

test('parseMatrizCliente parseia um grid sintético no formato do espelho ao vivo, incluindo TICKET (a coluna que motivou esta feature)', () => {
  const registros = parseMatrizCliente(gridMatrizSintetico(1500));
  assert.strictEqual(registros.length, 1);
  assert.strictEqual(registros[0].sup, 'SUP-0001-24');
  assert.strictEqual(registros[0].tipologia, 'SP');
  assert.strictEqual(registros[0].previsto.volumeResumo.ticket, 1500);
});

test('parseMatrizCliente lança erro claro se a coluna TICKET não existir (planilha mudou de forma)', () => {
  const grid = gridMatrizSintetico(1500);
  grid[0] = grid[0].map((rotulo) => (rotulo === 'TICKET' ? 'OUTRA-COISA' : rotulo));
  assert.throws(() => parseMatrizCliente(grid), /Esperava a coluna "TICKET"/);
});
