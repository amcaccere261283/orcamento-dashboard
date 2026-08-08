'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  computeDemandas, SERIES, SERIE_ESTOQUE, reconciliarSups,
} = require('../tools/semanal/compute-demandas.js');
const { diaEpoch } = require('../tools/comum/datas.js');

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

test('início vence cancelamento posterior: quem começou a sondagem saiu do estoque ali', () => {
  const saida = computeDemandas([
    furo({ status: 'CANCELADO', criacaoOS: d(2026, 1, 5), inicioSondagem: d(2026, 2, 10),
           terminoSondagem: null, conclusao: null, cancelamento: d(2026, 6, 1) }),
  ], PERIODOS_2026);
  assert.deepStrictEqual(serieDe(saida, 'SP', 'pendentes').slice(0, 4), [1, 0, 0, 0]);
});

test('estoque é SALDO: o furo aberto em janeiro conta em todo mês até o término', () => {
  const saida = computeDemandas([
    furo({ status: 'PENDENTE', criacaoOS: d(2026, 1, 10), terminoSondagem: null, conclusao: null }),
  ], PERIODOS_2026);
  assert.deepStrictEqual(serieDe(saida, 'SP', 'pendentes'), new Array(12).fill(1));
});

test('o furo sai do estoque no mês em que a sondagem começa, não antes nem depois', () => {
  const saida = computeDemandas([
    furo({ criacaoOS: d(2026, 1, 10), inicioSondagem: d(2026, 3, 20) }),
  ], PERIODOS_2026);
  const pendentes = serieDe(saida, 'SP', 'pendentes');
  assert.deepStrictEqual(pendentes.slice(0, 4), [1, 1, 0, 0],
    'março é o mês do início: ao FIM de março o furo já não está aberto');
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

test('porRegistroEventos: chegada tem um dia por furo (qualquer status), sondagemRealizada só CONCLUIDO/EXECUTADO', () => {
  const saida = computeDemandas([
    furo({ status: 'CONCLUIDO', criacaoOS: d(2026, 1, 5), terminoSondagem: d(2026, 2, 10) }),
    furo({ status: 'PENDENTE', criacaoOS: d(2026, 1, 6), terminoSondagem: null, conclusao: null }),
  ], PERIODOS_2026);
  const entrada = saida.porRegistroEventos['SUP-0001-24||SP'];
  assert.strictEqual(entrada.chegada.length, 2, 'os 2 furos têm criacaoOS, PENDENTE inclusive');
  assert.strictEqual(entrada.sondagemRealizada.length, 1, 'só o CONCLUIDO conta pro fluxo Realizado');
});

test('porRegistroEventos: saidaEstoque é o MENOR entre início e cancelamento, nunca os dois separados -- furos CANCELADO com início preenchido existem na planilha real', () => {
  const saida = computeDemandas([
    furo({ status: 'CANCELADO', criacaoOS: d(2026, 1, 1), inicioSondagem: d(2026, 2, 1),
           terminoSondagem: null, cancelamento: d(2026, 3, 1), conclusao: null }),
  ], PERIODOS_2026);
  const entrada = saida.porRegistroEventos['SUP-0001-24||SP'];
  assert.strictEqual(entrada.saidaEstoque.length, 1, 'um furo só sai do estoque uma vez, mesmo com 2 datas candidatas');
  assert.strictEqual(entrada.saidaEstoque[0], diaEpoch(d(2026, 2, 1)), 'usa a data mais cedo (início), não o cancelamento');
});

test('porRegistroEventos: cancelamento antes do início também usa o menor (o cancelamento)', () => {
  const saida = computeDemandas([
    furo({ status: 'CANCELADO', criacaoOS: d(2026, 1, 1), inicioSondagem: d(2026, 5, 1),
           terminoSondagem: null, cancelamento: d(2026, 2, 1), conclusao: null }),
  ], PERIODOS_2026);
  const entrada = saida.porRegistroEventos['SUP-0001-24||SP'];
  assert.strictEqual(entrada.saidaEstoque.length, 1);
  assert.strictEqual(entrada.saidaEstoque[0], diaEpoch(d(2026, 2, 1)));
});

test('porRegistroEventos: furo sem término nem cancelamento nunca aparece em saidaEstoque (nunca sai do estoque)', () => {
  const saida = computeDemandas([
    furo({ status: 'PENDENTE', criacaoOS: d(2026, 1, 1), terminoSondagem: null, cancelamento: null, conclusao: null }),
  ], PERIODOS_2026);
  const entrada = saida.porRegistroEventos['SUP-0001-24||SP'];
  assert.deepStrictEqual(entrada.saidaEstoque, []);
});

test('porRegistroEventos: reconstrói o saldo mensal correto, contando chegada/saidaEstoque até o fim de cada mês', () => {
  const furos = [
    furo({ status: 'CONCLUIDO', criacaoOS: d(2026, 1, 10), inicioSondagem: d(2026, 3, 20), terminoSondagem: null }),
    furo({ status: 'PENDENTE', criacaoOS: d(2026, 2, 5), terminoSondagem: null, conclusao: null }),
  ];
  const saida = computeDemandas(furos, PERIODOS_2026);
  const eventos = saida.porRegistroEventos['SUP-0001-24||SP'];
  const fimDoMes1Based = (ano, mesUm) => diaEpoch(new Date(Date.UTC(ano, mesUm, 0, 23, 59, 59)));
  const saldoEm = (corte) =>
    eventos.chegada.filter(dia => dia <= corte).length - eventos.saidaEstoque.filter(dia => dia <= corte).length;
  // Furo 1: chega jan/10, sai (começa) mar/20 -> aberto no fim de jan e fev, fechado a
  // partir do fim de mar. Furo 2: chega fev/5, nunca sai -> aberto do fim de fev em diante.
  // fim-jan: só furo1 (1). fim-fev: os dois (2). fim-mar em diante: só furo2 (1).
  const esperado = [1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  for (let mes = 0; mes < 12; mes++) {
    assert.strictEqual(saldoEm(fimDoMes1Based(2026, mes + 1)), esperado[mes], `mês ${mes}`);
  }
});

test('porRegistroEventos: par (sup, tipologia) sem nenhum furo fica ausente, não aparece com arrays vazios "à toa"', () => {
  const saida = computeDemandas([furo()], PERIODOS_2026);
  assert.strictEqual('SUP-9999-99||SP' in saida.porRegistroEventos, false);
});

test('a saída sobrevive a JSON.stringify com porRegistroEventos também', () => {
  const saida = computeDemandas([furo()], PERIODOS_2026);
  const voltou = JSON.parse(JSON.stringify(saida));
  assert.deepStrictEqual(voltou.porRegistroEventos, saida.porRegistroEventos);
});

// --- Ensaios de laboratório (parse-lab.js, aba "Lab Concluido") ------------

function ensaioLab(over = {}) {
  return Object.assign({
    sup: 'SUP-0001-24', tipologia: 'LAB.C', concluido: d(2026, 2, 10),
  }, over);
}

test('ensaiosLab alimenta sondagemRealizada em porRegistroEventos, chaveado por (sup, LAB.C/LAB.E)', () => {
  const saida = computeDemandas([], PERIODOS_2026, [
    ensaioLab({ tipologia: 'LAB.C' }),
    ensaioLab({ tipologia: 'LAB.E' }),
    ensaioLab({ tipologia: 'LAB.C' }),
  ]);
  assert.strictEqual(saida.porRegistroEventos['SUP-0001-24||LAB.C'].sondagemRealizada.length, 2);
  assert.strictEqual(saida.porRegistroEventos['SUP-0001-24||LAB.E'].sondagemRealizada.length, 1);
  assert.strictEqual(
    saida.porRegistroEventos['SUP-0001-24||LAB.C'].sondagemRealizada[0],
    diaEpoch(d(2026, 2, 10)),
  );
});

test('furos e ensaiosLab convivem em porRegistroEventos sem se misturar -- chaves diferentes (tipologia diferente), mesmo SUP', () => {
  const saida = computeDemandas([furo({ sup: 'SUP-0001-24', tipologia: 'SP' })], PERIODOS_2026, [
    ensaioLab({ sup: 'SUP-0001-24', tipologia: 'LAB.C' }),
  ]);
  assert.strictEqual(saida.porRegistroEventos['SUP-0001-24||SP'].sondagemRealizada.length, 1, 'o furo');
  assert.strictEqual(saida.porRegistroEventos['SUP-0001-24||LAB.C'].sondagemRealizada.length, 1, 'o ensaio');
});

test('ensaiosLab omitido não quebra nada -- computeDemandas(furos, periodos) continua funcionando como antes', () => {
  assert.doesNotThrow(() => computeDemandas([furo()], PERIODOS_2026));
  const saida = computeDemandas([furo()], PERIODOS_2026);
  assert.ok(saida.porRegistroEventos);
});

test('ensaio sem data de conclusão (concluido: null) não entra em sondagemRealizada', () => {
  const saida = computeDemandas([], PERIODOS_2026, [ensaioLab({ concluido: null })]);
  assert.strictEqual(saida.porRegistroEventos['SUP-0001-24||LAB.C'].sondagemRealizada.length, 0);
});

test('ensaiosLab SEM "criacao" continua com tipologias/totais zerados e sem chegada/saidaEstoque -- compatibilidade com quem ainda não tem a fonte de backlog (2026-08-08: Lab Realizado sem Data Programada, caso raro)', () => {
  const saida = computeDemandas([], PERIODOS_2026, [ensaioLab({ tipologia: 'LAB.C', criacao: undefined })]);
  const blocoLabC = saida.tipologias.find(t => t.tipologia === 'LAB.C');
  assert.deepStrictEqual(blocoLabC.series.chegadas, new Array(12).fill(0));
  assert.deepStrictEqual(saida.porRegistroEventos['SUP-0001-24||LAB.C'].chegada, []);
  assert.deepStrictEqual(saida.porRegistroEventos['SUP-0001-24||LAB.C'].saidaEstoque, []);
});

test('ensaiosLab COM "criacao" (Data Programada, Link 4/5) alimenta chegada/pendentes de LAB.C/LAB.E em tipologias/totais -- ligado em 2026-08-08 (antes ficava zerado por falta de fonte de backlog)', () => {
  const saida = computeDemandas([], PERIODOS_2026, [
    ensaioLab({ tipologia: 'LAB.C', criacao: d(2026, 1, 10), concluido: d(2026, 2, 5) }),
  ]);
  const blocoLabC = saida.tipologias.find(t => t.tipologia === 'LAB.C');
  assert.strictEqual(blocoLabC.series.chegadas[0], 1, 'chegada em janeiro');
  assert.strictEqual(blocoLabC.series.sondagemRealizada[1], 1, 'concluído em fevereiro');
  assert.deepStrictEqual(blocoLabC.series.pendentes.slice(0, 3), [1, 0, 0], 'aberto em jan, fechado a partir de fev (concluído)');
});

test('ensaio ainda pendente (concluido null, criacao presente) fica no estoque indefinidamente -- mesma regra de furo sem data de saída', () => {
  const saida = computeDemandas([], PERIODOS_2026, [
    ensaioLab({ tipologia: 'LAB.E', criacao: d(2026, 3, 1), concluido: null }),
  ]);
  const blocoLabE = saida.tipologias.find(t => t.tipologia === 'LAB.E');
  assert.deepStrictEqual(blocoLabE.series.pendentes.slice(2, 12), new Array(10).fill(1));
});

test('porRegistroEventos de LAB ganha chegada/saidaEstoque quando criacao está presente', () => {
  const saida = computeDemandas([], PERIODOS_2026, [
    ensaioLab({ sup: 'SUP-0001-24', tipologia: 'LAB.C', criacao: d(2026, 1, 10), concluido: d(2026, 2, 5) }),
  ]);
  const entrada = saida.porRegistroEventos['SUP-0001-24||LAB.C'];
  assert.strictEqual(entrada.chegada.length, 1);
  assert.strictEqual(entrada.saidaEstoque.length, 1, 'concluído também sai do estoque -- lab não tem "início" separado de "conclusão"');
});
