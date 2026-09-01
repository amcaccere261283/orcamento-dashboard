'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularSnapshotSemanaAlvo, proximaSegunda, fragmentosDaSemanaAlvo, segundaDaSemana } = require('../tools/semanal/congelar-tendencia-semanal.js');

// 2026-08-28 é uma SEXTA. A semana seguinte começa em 2026-08-31.
// 2026-08-31 é uma SEGUNDA. A semana seguinte a ela começa em 2026-09-07.
test('proximaSegunda devolve sempre a segunda ESTRITAMENTE depois de hoje', () => {
  const dia = (ano, mes1, d) => Date.UTC(ano, mes1 - 1, d) / 86400000;
  assert.equal(proximaSegunda(dia(2026, 8, 28)), '2026-08-31'); // sexta
  assert.equal(proximaSegunda(dia(2026, 8, 29)), '2026-08-31'); // sábado
  assert.equal(proximaSegunda(dia(2026, 8, 30)), '2026-08-31'); // domingo
  assert.equal(proximaSegunda(dia(2026, 8, 31)), '2026-09-07'); // SEGUNDA -> a seguinte
  assert.equal(proximaSegunda(dia(2026, 9, 1)), '2026-09-07');  // terça
  assert.equal(proximaSegunda(dia(2026, 9, 2)), '2026-09-07');  // quarta
  assert.equal(proximaSegunda(dia(2026, 9, 3)), '2026-09-07');  // quinta
});

test('calcularSnapshotSemanaAlvo emite uma linha por (fragmento x registro), com as 4 tendencias', () => {
  const registros = [
    { sup: 'SUP-1', tipologia: 'SP', tomador: 'X',
      previsto: { volume: Array(12).fill(100) }, total: { equipes: Array(12).fill(2) } },
  ];
  const demandas = { porRegistroEventos: {} };
  const hojeEpoch = Date.UTC(2026, 7, 28) / 86400000; // sexta 28/08
  const snapshot = calcularSnapshotSemanaAlvo(registros, demandas, hojeEpoch, '2026-08-31');

  assert.equal(snapshot.chaveSegunda, '2026-08-31');
  // 1 registro x 2 fragmentos (31/08 e 01/09) = 2 linhas.
  assert.equal(snapshot.linhas.length, 2);
  assert.deepEqual(snapshot.linhas.map((l) => l.chave).sort(), ['2026-08-31', '2026-09-01']);
  snapshot.linhas.forEach((linha) => {
    assert.equal(linha.chaveMatriz, 'SUP-1||SP');
    assert.equal(typeof linha.volume, 'number');
    assert.equal(typeof linha.equipe, 'number');
    assert.equal(linha.produtividadeMedia, linha.volume / linha.equipe);
  });
});

test('calcularSnapshotSemanaAlvo devolve produtividadeMedia null quando equipe e 0', () => {
  const registros = [
    { sup: 'SUP-2', tipologia: 'ST', tomador: 'Y',
      previsto: { volume: Array(12).fill(50) }, total: { equipes: Array(12).fill(0) } },
  ];
  const hojeEpoch = Date.UTC(2026, 8, 4) / 86400000; // sexta 04/09
  const snapshot = calcularSnapshotSemanaAlvo(registros, { porRegistroEventos: {} }, hojeEpoch, '2026-09-07');
  assert.equal(snapshot.linhas[0].produtividadeMedia, null);
});

// A semana de 31/08 a 06/09 CRUZA a virada do mês. semanasDoMes corta semanas
// dentro do mês, então ela existe como DOIS fragmentos: o toco [31/08, 31/08]
// em agosto e [01/09, 06/09] em setembro. O leitor do Consolidado procura pelo
// INÍCIO do fragmento -- 2026-09-01, uma terça -- então gravar só sob a segunda
// deixaria essa semana sem congelado.
test('fragmentosDaSemanaAlvo devolve os DOIS fragmentos de uma semana que cruza a virada do mês', () => {
  const frags = fragmentosDaSemanaAlvo('2026-08-31');
  assert.equal(frags.length, 2);
  assert.deepEqual(frags.map((f) => f.chave), ['2026-08-31', '2026-09-01']);
  assert.equal(frags[0].mesIdx, 7); // agosto
  assert.equal(frags[1].mesIdx, 8); // setembro
});

test('fragmentosDaSemanaAlvo devolve UM fragmento para semana inteira dentro do mês', () => {
  const frags = fragmentosDaSemanaAlvo('2026-09-07'); // 07/09 a 13/09, tudo em setembro
  assert.equal(frags.length, 1);
  assert.equal(frags[0].chave, '2026-09-07');
});

test('segundaDaSemana anda pra TRAS ate a segunda, incluindo o proprio dia quando ja e segunda', () => {
  const dia = (ano, mes1, d) => Date.UTC(ano, mes1 - 1, d) / 86400000;
  assert.equal(segundaDaSemana(dia(2026, 8, 31)), '2026-08-31'); // segunda -> ela mesma
  assert.equal(segundaDaSemana(dia(2026, 9, 1)), '2026-08-31');  // terça -> segunda anterior
  assert.equal(segundaDaSemana(dia(2026, 9, 2)), '2026-08-31');  // quarta
  assert.equal(segundaDaSemana(dia(2026, 9, 3)), '2026-08-31');  // quinta
  assert.equal(segundaDaSemana(dia(2026, 9, 4)), '2026-08-31');  // sexta
  assert.equal(segundaDaSemana(dia(2026, 9, 5)), '2026-08-31');  // sábado
  assert.equal(segundaDaSemana(dia(2026, 9, 6)), '2026-08-31');  // domingo
});

test('segundaDaSemana achando o inicio de um fragmento truncado (virada de mes) devolve a MESMA segunda que fragmentosDaSemanaAlvo espera', () => {
  // O fragmento de setembro da semana 31/08-06/09 começa em 2026-09-01 (terça,
  // não segunda) -- exatamente o caso que motivou esta função.
  const dia = Date.UTC(2026, 8, 1) / 86400000; // 2026-09-01
  assert.equal(segundaDaSemana(dia), '2026-08-31');
});
