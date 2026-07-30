'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  computeDemandas, SERIES, SERIE_ESTOQUE, reconciliarSups,
} = require('../tools/semanal/compute-demandas.js');

const PERIODOS_2026 = Array.from({ length: 12 }, (_, mes) => new Date(Date.UTC(2026, mes, 1)));
const d = (ano, mes, dia) => new Date(Date.UTC(ano, mes - 1, dia));

function furo(over = {}) {
  return Object.assign({
    sup: 'SUP-0001-24', tipologia: 'SP', status: 'CONCLUIDO',
    criacaoOS: d(2026, 1, 10), terminoSondagem: d(2026, 2, 10),
    conclusao: d(2026, 3, 10), atualizado: d(2026, 3, 12),
  }, over);
}

function serieDe(saida, tipologia, serie) {
  const bloco = saida.tipologias.find(t => t.tipologia === tipologia);
  assert.ok(bloco, `tipologia "${tipologia}" ausente na saída`);
  return bloco.series[serie];
}

test('as 5 séries existem, na ordem, e pendentes é a marcada como estoque', () => {
  assert.deepStrictEqual(SERIES, ['chegadas', 'sondagemRealizada', 'relatorioConcluido', 'canceladas', 'pendentes']);
  assert.strictEqual(SERIE_ESTOQUE, 'pendentes');
});

test('cada série cai no mês da SUA data: chegada em jan, sondagem em fev, relatório em mar', () => {
  const saida = computeDemandas([furo()], PERIODOS_2026);
  assert.strictEqual(serieDe(saida, 'SP', 'chegadas')[0], 1);
  assert.strictEqual(serieDe(saida, 'SP', 'sondagemRealizada')[1], 1);
  assert.strictEqual(serieDe(saida, 'SP', 'relatorioConcluido')[2], 1);
  assert.strictEqual(serieDe(saida, 'SP', 'chegadas')[1], 0, 'chegada não se repete em fevereiro');
});

test('chegadas conta TODOS os status, inclusive a que foi cancelada depois', () => {
  const saida = computeDemandas([
    furo({ status: 'CANCELADO', terminoSondagem: null, conclusao: null }),
    furo({ status: 'PENDENTE', terminoSondagem: null, conclusao: null }),
  ], PERIODOS_2026);
  assert.strictEqual(serieDe(saida, 'SP', 'chegadas')[0], 2);
});

test('sondagem realizada exige o status: PENDENTE com data de término não conta', () => {
  const saida = computeDemandas([furo({ status: 'PENDENTE' })], PERIODOS_2026);
  assert.strictEqual(serieDe(saida, 'SP', 'sondagemRealizada')[1], 0);
});

test('EXECUTADO conta como sondagem realizada -- campo feito, relatório pendente', () => {
  const saida = computeDemandas([furo({ status: 'EXECUTADO' })], PERIODOS_2026);
  assert.strictEqual(serieDe(saida, 'SP', 'sondagemRealizada')[1], 1);
});

test('relatório concluído exige status CONCLUIDO: 798 das 811 linhas EXECUTADO têm data de Conclusão preenchida e NÃO podem contar', () => {
  const saida = computeDemandas([furo({ status: 'EXECUTADO' })], PERIODOS_2026);
  assert.strictEqual(serieDe(saida, 'SP', 'relatorioConcluido')[2], 0);
});

test('canceladas ancoram em Atualizado, a única data que existe nelas', () => {
  const saida = computeDemandas([
    furo({ status: 'CANCELADO', terminoSondagem: null, conclusao: null, atualizado: d(2026, 5, 20) }),
  ], PERIODOS_2026);
  assert.strictEqual(serieDe(saida, 'SP', 'canceladas')[4], 1);
});

test('cancelada NÃO entra no estoque de pendentes, em nenhum mês', () => {
  const saida = computeDemandas([
    furo({ status: 'CANCELADO', terminoSondagem: null, conclusao: null, atualizado: d(2026, 5, 20) }),
  ], PERIODOS_2026);
  assert.deepStrictEqual(serieDe(saida, 'SP', 'pendentes'), new Array(12).fill(0));
});

test('estoque é SALDO: o furo aberto em janeiro conta em todo mês até o término', () => {
  const saida = computeDemandas([
    furo({ status: 'PENDENTE', criacaoOS: d(2026, 1, 10), terminoSondagem: null, conclusao: null }),
  ], PERIODOS_2026);
  assert.deepStrictEqual(serieDe(saida, 'SP', 'pendentes'), new Array(12).fill(1));
});

test('o furo sai do estoque no mês em que a sondagem termina, não antes nem depois', () => {
  const saida = computeDemandas([
    furo({ criacaoOS: d(2026, 1, 10), terminoSondagem: d(2026, 3, 20) }),
  ], PERIODOS_2026);
  const pendentes = serieDe(saida, 'SP', 'pendentes');
  assert.deepStrictEqual(pendentes.slice(0, 4), [1, 1, 0, 0],
    'março é o mês do término: ao FIM de março o furo já não está aberto');
});

test('furo que chegou antes do ano (legado) entra no estoque desde janeiro, mas não em chegadas', () => {
  const saida = computeDemandas([
    furo({ status: 'PENDENTE', criacaoOS: d(2025, 11, 3), terminoSondagem: null, conclusao: null }),
  ], PERIODOS_2026);
  assert.strictEqual(serieDe(saida, 'SP', 'chegadas')[0], 0);
  assert.strictEqual(serieDe(saida, 'SP', 'pendentes')[0], 1);
});

test('furo concluído sem data de término válida nunca sai do estoque -- limitação conhecida, não bug', () => {
  const saida = computeDemandas([
    furo({ status: 'CONCLUIDO', criacaoOS: d(2026, 1, 5), terminoSondagem: null, conclusao: null }),
  ], PERIODOS_2026);
  assert.deepStrictEqual(serieDe(saida, 'SP', 'pendentes'), new Array(12).fill(1));
});

test('data fora dos 12 períodos não vira mês nenhum, e não estoura o array', () => {
  const saida = computeDemandas([
    furo({ criacaoOS: d(2027, 2, 1), terminoSondagem: d(2027, 3, 1), conclusao: d(2027, 4, 1) }),
  ], PERIODOS_2026);
  assert.deepStrictEqual(serieDe(saida, 'SP', 'chegadas'), new Array(12).fill(0));
  assert.strictEqual(serieDe(saida, 'SP', 'chegadas').length, 12);
});

test('data nula é ignorada sem quebrar', () => {
  const saida = computeDemandas([
    furo({ criacaoOS: null, terminoSondagem: null, conclusao: null, atualizado: null }),
  ], PERIODOS_2026);
  assert.deepStrictEqual(serieDe(saida, 'SP', 'chegadas'), new Array(12).fill(0));
});

test('tipologias saem na ordem de ORDEM_TIPOLOGIAS, com LAB.C/LAB.E zerados', () => {
  const saida = computeDemandas([furo({ tipologia: 'ST' }), furo({ tipologia: 'SP' })], PERIODOS_2026);
  const rotulos = saida.tipologias.map(t => t.tipologia);
  assert.ok(rotulos.indexOf('SP') < rotulos.indexOf('ST'), 'SP vem antes de ST');
  assert.deepStrictEqual(serieDe(saida, 'LAB.C', 'chegadas'), new Array(12).fill(0));
});

test('SEG.A e SEG.V só aparecem quando há acionamento no período', () => {
  const semSeg = computeDemandas([furo()], PERIODOS_2026);
  assert.strictEqual(semSeg.tipologias.some(t => t.tipologia === 'SEG.A'), false);

  const comSeg = computeDemandas([furo(), furo({ tipologia: 'SEG.A' })], PERIODOS_2026);
  assert.strictEqual(comSeg.tipologias.some(t => t.tipologia === 'SEG.A'), true);
  assert.strictEqual(comSeg.tipologias.some(t => t.tipologia === 'SEG.V'), false,
    'SEG.V sem acionamento continua fora, mesmo com SEG.A presente');
});

test('totais somam as tipologias mês a mês; pendentes também soma (saldos do MESMO mês se somam)', () => {
  const saida = computeDemandas([
    furo({ tipologia: 'SP', status: 'PENDENTE', criacaoOS: d(2026, 1, 5), terminoSondagem: null, conclusao: null }),
    furo({ tipologia: 'ST', status: 'PENDENTE', criacaoOS: d(2026, 1, 6), terminoSondagem: null, conclusao: null }),
  ], PERIODOS_2026);
  assert.strictEqual(saida.totais.chegadas[0], 2);
  assert.strictEqual(saida.totais.pendentes[0], 2);
});

test('a saída sobrevive a JSON.stringify -- nenhum Map no payload cifrado', () => {
  const saida = computeDemandas([furo()], PERIODOS_2026);
  const voltou = JSON.parse(JSON.stringify(saida));
  assert.deepStrictEqual(voltou.tipologias[0].series.chegadas, saida.tipologias[0].series.chegadas);
  assert.ok(voltou.tipologias.length > 0);
});

test('reconciliarSups relata os dois lados do desencontro, sem descartar ninguém', () => {
  const furos = [furo({ sup: 'SUP-0001-24' }), furo({ sup: 'SUP-6785-23 (SO)' }), furo({ sup: 'SUP-6785-23 (SO)' })];
  const registros = [{ sup: 'SUP-0001-24' }, { sup: 'SUP-8511-26' }];
  const r = reconciliarSups(furos, registros);
  assert.deepStrictEqual(r.soNoAvancos, ['SUP-6785-23 (SO)']);
  assert.deepStrictEqual(r.soNaMatriz, ['SUP-8511-26']);
  assert.strictEqual(r.furosSemSupNaMatriz, 2, 'conta FUROS, não SUPs -- é o tamanho real do desencontro');
});

test('reconciliarSups não muda o agregado: SUP fora da MATRIZ continua contando na sua tipologia', () => {
  const saida = computeDemandas([furo({ sup: 'SUP-INEXISTENTE-99' })], PERIODOS_2026);
  assert.strictEqual(serieDe(saida, 'SP', 'chegadas')[0], 1,
    'nada é descartado por não casar com a MATRIZ -- foi o Critical da Fase 1');
});

test('canceladas exige status CANCELADO: não-cancelados com atualizado válido NÃO contam', () => {
  const saida = computeDemandas([
    furo({ status: 'CONCLUIDO', atualizado: d(2026, 3, 12) }),
    furo({ status: 'EXECUTADO', atualizado: d(2026, 4, 15) }),
    furo({ status: 'PENDENTE', atualizado: d(2026, 2, 20) }),
  ], PERIODOS_2026);
  assert.deepStrictEqual(serieDe(saida, 'SP', 'canceladas'), new Array(12).fill(0),
    'guard protege: o if(cancelado) é essencial');
  assert.deepStrictEqual(saida.totais.canceladas, new Array(12).fill(0),
    'totais.canceladas também fica zerado para não-cancelados');
});
