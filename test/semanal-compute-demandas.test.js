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
    conclusao: d(2026, 3, 10), cancelamento: null, atualizado: d(2026, 3, 12),
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

test('relatório concluído exige status CONCLUIDO: medido em 2026-07-30, 0 das 811 linhas EXECUTADO têm Conclusão preenchida -- mas o filtro é por status mesmo assim, porque é o status que carrega o significado da etapa, e a planilha pode passar a preencher Conclusão em linha EXECUTADO sem avisar', () => {
  const saida = computeDemandas([furo({ status: 'EXECUTADO' })], PERIODOS_2026);
  assert.strictEqual(serieDe(saida, 'SP', 'relatorioConcluido')[2], 0);
});

test('canceladas ancoram em cancelamento (coluna P), não em atualizado (coluna Q)', () => {
  const saida = computeDemandas([
    furo({ status: 'CANCELADO', terminoSondagem: null, conclusao: null,
           cancelamento: d(2026, 2, 20), atualizado: d(2026, 11, 30) }),
  ], PERIODOS_2026);
  assert.strictEqual(serieDe(saida, 'SP', 'canceladas')[1], 1, 'fevereiro, o mês do cancelamento');
  assert.strictEqual(serieDe(saida, 'SP', 'canceladas')[11], 0, 'dezembro é só a última alteração da linha');
});

test('cancelada sem data legível fica fora da série de canceladas', () => {
  const saida = computeDemandas([
    furo({ status: 'CANCELADO', terminoSondagem: null, conclusao: null, cancelamento: null }),
  ], PERIODOS_2026);
  assert.deepStrictEqual(serieDe(saida, 'SP', 'canceladas'), new Array(12).fill(0));
});

test('cancelada NÃO entra no estoque de pendentes, em nenhum mês', () => {
  const saida = computeDemandas([
    furo({ status: 'CANCELADO', terminoSondagem: null, conclusao: null, cancelamento: d(2026, 1, 5) }),
  ], PERIODOS_2026);
  assert.deepStrictEqual(serieDe(saida, 'SP', 'pendentes'), new Array(12).fill(0));
});

test('cancelada sai do estoque NO MÊS do cancelamento -- estava aberta antes disso', () => {
  const saida = computeDemandas([
    furo({ status: 'CANCELADO', criacaoOS: d(2026, 1, 10), terminoSondagem: null,
           conclusao: null, cancelamento: d(2026, 4, 15) }),
  ], PERIODOS_2026);
  assert.deepStrictEqual(serieDe(saida, 'SP', 'pendentes').slice(0, 6), [1, 1, 1, 0, 0, 0],
    'aberta jan-mar, fora a partir de abril');
});

test('cancelada SEM data legível continua no estoque -- "não sei quando saiu" não é "saiu no começo"', () => {
  const saida = computeDemandas([
    furo({ status: 'CANCELADO', criacaoOS: d(2026, 1, 10), terminoSondagem: null,
           conclusao: null, cancelamento: null }),
  ], PERIODOS_2026);
  assert.deepStrictEqual(serieDe(saida, 'SP', 'pendentes'), new Array(12).fill(1));
});

test('cancelada cujo cancelamento é anterior ao ano nunca entra no estoque de 2026', () => {
  const saida = computeDemandas([
    furo({ status: 'CANCELADO', criacaoOS: d(2025, 6, 1), terminoSondagem: null,
           conclusao: null, cancelamento: d(2025, 8, 1) }),
  ], PERIODOS_2026);
  assert.deepStrictEqual(serieDe(saida, 'SP', 'pendentes'), new Array(12).fill(0));
});

test('término vence cancelamento posterior: quem terminou a sondagem saiu do estoque ali', () => {
  const saida = computeDemandas([
    furo({ status: 'CANCELADO', criacaoOS: d(2026, 1, 5), terminoSondagem: d(2026, 2, 10),
           conclusao: null, cancelamento: d(2026, 6, 1) }),
  ], PERIODOS_2026);
  assert.deepStrictEqual(serieDe(saida, 'SP', 'pendentes').slice(0, 4), [1, 0, 0, 0]);
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

test('canceladas exige status CANCELADO: não-cancelados com cancelamento válido NÃO contam', () => {
  const saida = computeDemandas([
    furo({ status: 'CONCLUIDO', cancelamento: d(2026, 3, 12) }),
    furo({ status: 'EXECUTADO', cancelamento: d(2026, 4, 15) }),
    furo({ status: 'PENDENTE', cancelamento: d(2026, 2, 20) }),
  ], PERIODOS_2026);
  assert.deepStrictEqual(serieDe(saida, 'SP', 'canceladas'), new Array(12).fill(0),
    'guard protege: o if(cancelado) é essencial');
  assert.deepStrictEqual(saida.totais.canceladas, new Array(12).fill(0),
    'totais.canceladas também fica zerado para não-cancelados');
});

test('porRegistro agrega sondagemRealizada e pendentes por (sup, tipologia), na mesma passada que o agregado por tipologia', () => {
  const furos = [
    // 2 furos do mesmo SUP+tipologia, sondagem terminada em meses diferentes.
    { sup: 'SUP-0001-24', tipologia: 'ST', status: 'CONCLUIDO', criacaoOS: new Date(Date.UTC(2026, 0, 5)), terminoSondagem: new Date(Date.UTC(2026, 1, 10)), conclusao: new Date(Date.UTC(2026, 1, 15)), cancelamento: null },
    { sup: 'SUP-0001-24', tipologia: 'ST', status: 'EXECUTADO', criacaoOS: new Date(Date.UTC(2026, 0, 6)), terminoSondagem: new Date(Date.UTC(2026, 2, 1)), conclusao: null, cancelamento: null },
    // Outro SUP, mesma tipologia -- não pode se misturar com o de cima.
    { sup: 'SUP-0002-24', tipologia: 'ST', status: 'CONCLUIDO', criacaoOS: new Date(Date.UTC(2026, 0, 1)), terminoSondagem: new Date(Date.UTC(2026, 1, 20)), conclusao: new Date(Date.UTC(2026, 1, 25)), cancelamento: null },
  ];
  const periodos = Array.from({ length: 12 }, (_, m) => new Date(Date.UTC(2026, m, 1)));
  const { porRegistro } = computeDemandas(furos, periodos);

  assert.deepStrictEqual(porRegistro['SUP-0001-24||ST'].sondagemRealizada[1], 1, 'só o furo CONCLUIDO terminou sondagem em fevereiro (índice 1)');
  assert.deepStrictEqual(porRegistro['SUP-0001-24||ST'].sondagemRealizada[2], 1, 'o furo EXECUTADO terminou sondagem em março (índice 2)');
  assert.deepStrictEqual(porRegistro['SUP-0002-24||ST'].sondagemRealizada[1], 1, 'SUP diferente não pode somar no bucket do SUP-0001-24');
  assert.strictEqual(porRegistro['SUP-0001-24||ST'].sondagemRealizada.reduce((a, b) => a + b, 0), 2, 'total de sondagens realizadas do SUP-0001-24/ST no ano');
});

test('par (sup, tipologia) sem nenhum furo fica AUSENTE de porRegistro, não aparece com zeros', () => {
  const furos = [
    { sup: 'SUP-0001-24', tipologia: 'ST', status: 'CONCLUIDO', criacaoOS: new Date(Date.UTC(2026, 0, 1)), terminoSondagem: new Date(Date.UTC(2026, 0, 15)), conclusao: new Date(Date.UTC(2026, 0, 20)), cancelamento: null },
  ];
  const periodos = Array.from({ length: 12 }, (_, m) => new Date(Date.UTC(2026, m, 1)));
  const { porRegistro } = computeDemandas(furos, periodos);
  assert.strictEqual('SUP-9999-99||ST' in porRegistro, false, 'quem lê porRegistro trata ausência como zero -- este teste garante que a ausência é real, não uma entrada zerada');
});

test('pendentes em porRegistro fecha com o mesmo saldo por (sup, tipologia) que o agregado geral fecharia se só houvesse esse par', () => {
  const furos = [
    { sup: 'SUP-0001-24', tipologia: 'ST', status: 'PENDENTE', criacaoOS: new Date(Date.UTC(2026, 0, 10)), terminoSondagem: null, conclusao: null, cancelamento: null },
  ];
  const periodos = Array.from({ length: 12 }, (_, m) => new Date(Date.UTC(2026, m, 1)));
  const { porRegistro, totais } = computeDemandas(furos, periodos);
  assert.deepStrictEqual(porRegistro['SUP-0001-24||ST'].pendentes, totais.pendentes, 'com um único (sup, tipologia) na planilha, o saldo por registro tem que bater com o saldo total');
});
