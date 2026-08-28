'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parsePessoasAtivas, detalhesPessoasAtivas } = require('../tools/semanal/pessoas-ativas.js');

// Cabeçalho real da aba PESSOAS (medido em 2026-08-27, mesma planilha da EQ,
// gid 1744884054): ID | ATV | COLABORADOR | LÍDER | SERVIÇO | CARGO |
// ADMISSÃO | CNH | BAIXADA | DESLIGADO | EXP 30 | EXP 90 | AÇÃO. Uma linha por
// pessoa -- só a do líder tem ID/ATV preenchidos; auxiliares seguem com ID
// vazio.
const CSV_PESSOAS = [
  'ID,ATV,COLABORADOR,LÍDER,SERVIÇO,CARGO,ADMISSÃO,CNH,BAIXADA,DESLIGADO,EXP 30,EXP 90,AÇÃO',
  '4,FALSE,José Ildomar Pereira do Amaral,AMARAL,SM,Sondador SM,02/03/2026,06/08/2032 - D,01 mês x 05 dias,,-,-,Ok',
  '79,TRUE,Leonardo da Silva Marques,LEONARDO,SM,Sondador SM,21/11/2019,29/05/2033 - D,03 meses x 15 dias,,-,-,Ok',
  ',,José Fabio Pereira da Silva ,,,Auxiliar de Sondagem SM,15/01/2025,-,03 meses x 15 dias,,-,-,Ok',
  '88,TRUE,Edy Inacio Gomes,EDY,ST | PI | BL (ST),Sondador ST,10/01/2020,-,-,,-,-,Ok',
].join('\n');

test('parsePessoasAtivas devolve só os ids com ATV=TRUE', () => {
  const ativos = parsePessoasAtivas(CSV_PESSOAS);
  assert.strictEqual(ativos.has('79'), true);
  assert.strictEqual(ativos.has('88'), true);
  assert.strictEqual(ativos.has('4'), false, 'ATV=FALSE não entra');
});

test('linha de auxiliar (ID vazio) não vira id ativo nenhum', () => {
  const ativos = parsePessoasAtivas(CSV_PESSOAS);
  assert.strictEqual(ativos.has(''), false);
  assert.strictEqual(ativos.size, 2);
});

test('CSV vazio devolve conjunto vazio, nunca lança', () => {
  const ativos = parsePessoasAtivas('');
  assert.strictEqual(ativos.size, 0);
});

test('detalhesPessoasAtivas devolve colaborador/líder/serviço só dos ATV=TRUE', () => {
  const detalhes = detalhesPessoasAtivas(CSV_PESSOAS);
  assert.strictEqual(detalhes.has('4'), false, 'ATV=FALSE não entra');
  assert.deepStrictEqual(detalhes.get('79'), { colaborador: 'Leonardo da Silva Marques', lider: 'LEONARDO', servico: 'SM' });
  assert.deepStrictEqual(detalhes.get('88'), { colaborador: 'Edy Inacio Gomes', lider: 'EDY', servico: 'ST | PI | BL (ST)' });
});

test('detalhesPessoasAtivas de CSV vazio devolve Map vazio, nunca lança', () => {
  const detalhes = detalhesPessoasAtivas('');
  assert.strictEqual(detalhes.size, 0);
});
