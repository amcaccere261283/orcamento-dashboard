'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  computeDemandas, SERIES, SERIE_ESTOQUE, reconciliarSups, chegadasMensaisPorRegistro,
  saldoAberturaPorRegistro,
} = require('../tools/semanal/compute-demandas.js');
const { diaEpoch } = require('../tools/comum/datas.js');

const PERIODOS_2026 = Array.from({ length: 12 }, (_, mes) => new Date(Date.UTC(2026, mes, 1)));
const d = (ano, mes, dia) => new Date(Date.UTC(ano, mes - 1, dia));

function furo(over = {}) {
  return Object.assign({
    sup: 'SUP-0001-24', tipologia: 'SP', status: 'CONCLUIDO',
    criacaoOS: d(2026, 1, 10), executadoDia: d(2026, 2, 10),
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
    furo({ status: 'CANCELADO', executadoDia: null, conclusao: null }),
    furo({ status: 'PENDENTE', executadoDia: null, conclusao: null }),
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
    furo({ status: 'CANCELADO', executadoDia: null, conclusao: null,
           cancelamento: d(2026, 2, 20), atualizado: d(2026, 11, 30) }),
  ], PERIODOS_2026);
  assert.strictEqual(serieDe(saida, 'SP', 'canceladas')[1], 1, 'fevereiro, o mês do cancelamento');
  assert.strictEqual(serieDe(saida, 'SP', 'canceladas')[11], 0, 'dezembro é só a última alteração da linha');
});

test('cancelada sem data legível fica fora da série de canceladas', () => {
  const saida = computeDemandas([
    furo({ status: 'CANCELADO', executadoDia: null, conclusao: null, cancelamento: null }),
  ], PERIODOS_2026);
  assert.deepStrictEqual(serieDe(saida, 'SP', 'canceladas'), new Array(12).fill(0));
});

// --- saída do estoque: só a EXECUÇÃO ---------------------------------------
//
// Regra do dono do projeto, 2026-08-10: "na data de referência, o que eu
// tenho onde a data de pendência é menor ou igual a ela e a data de execução
// foi após ela". O cancelamento deixou de participar -- e não por descuido:
// a fonte atual (Link 1) não traz data de cancelamento nenhuma, então a
// regra anterior (min entre início e cancelamento) só existia no papel.

test('cancelada SEM execução permanece no estoque -- é dívida conhecida, não bug', () => {
  // O Link 1 não traz data de cancelamento, então um furo cancelado nunca
  // ganha data de execução e nunca sai do estoque. São poucos (29 em 47.809
  // medidos em 2026-08-10), mas inflam a demanda de todo mês futuro. O
  // tratamento (usar "Data Status Atual" como saída quando o status é
  // CANCELADO) está registrado como pendência junto com a aba Demandas.
  const saida = computeDemandas([
    furo({ status: 'CANCELADO', criacaoOS: d(2026, 1, 10), executadoDia: null,
           conclusao: null, cancelamento: d(2026, 4, 15) }),
  ], PERIODOS_2026);
  assert.deepStrictEqual(serieDe(saida, 'SP', 'pendentes'), new Array(12).fill(1),
    'a data de cancelamento NÃO tira mais do estoque -- só a execução tira');
});

test('cancelada que chegou a ser executada sai do estoque na execução, como qualquer furo', () => {
  const saida = computeDemandas([
    furo({ status: 'CANCELADO', criacaoOS: d(2026, 1, 5), executadoDia: d(2026, 2, 10),
           conclusao: null, cancelamento: d(2026, 6, 1) }),
  ], PERIODOS_2026);
  assert.deepStrictEqual(serieDe(saida, 'SP', 'pendentes').slice(0, 4), [1, 0, 0, 0],
    'a data de cancelamento posterior é irrelevante: quem manda é a execução');
});

test('furo criado antes do ano e nunca executado conta no estoque de todos os meses', () => {
  const saida = computeDemandas([
    furo({ status: 'PENDENTE', criacaoOS: d(2025, 6, 1), executadoDia: null, conclusao: null }),
  ], PERIODOS_2026);
  assert.deepStrictEqual(serieDe(saida, 'SP', 'pendentes'), new Array(12).fill(1));
});

test('estoque é SALDO: o furo aberto em janeiro conta em todo mês até ser executado', () => {
  const saida = computeDemandas([
    furo({ status: 'PENDENTE', criacaoOS: d(2026, 1, 10), executadoDia: null, conclusao: null }),
  ], PERIODOS_2026);
  assert.deepStrictEqual(serieDe(saida, 'SP', 'pendentes'), new Array(12).fill(1));
});

test('o furo sai do estoque no mês em que é EXECUTADO, não antes nem depois', () => {
  const saida = computeDemandas([
    furo({ criacaoOS: d(2026, 1, 10), executadoDia: d(2026, 3, 20) }),
  ], PERIODOS_2026);
  assert.deepStrictEqual(serieDe(saida, 'SP', 'pendentes').slice(0, 4), [1, 1, 0, 0],
    'março é o mês da execução: ao FIM de março o furo já não está aberto');
});

test('execução EXATAMENTE no último dia do mês já tira do estoque daquele mês', () => {
  // "a data de execução foi APÓS o dia D" -- execução == D já não é demanda
  // em D. Confirmado com o dono do projeto em 2026-08-10.
  const saida = computeDemandas([
    furo({ criacaoOS: d(2026, 1, 10), executadoDia: d(2026, 1, 31) }),
  ], PERIODOS_2026);
  assert.deepStrictEqual(serieDe(saida, 'SP', 'pendentes').slice(0, 2), [0, 0]);
});

test('furo que chegou antes do ano (legado) entra no estoque desde janeiro, mas não em chegadas', () => {
  const saida = computeDemandas([
    furo({ status: 'PENDENTE', criacaoOS: d(2025, 11, 3), executadoDia: null, conclusao: null }),
  ], PERIODOS_2026);
  assert.strictEqual(serieDe(saida, 'SP', 'chegadas')[0], 0);
  assert.strictEqual(serieDe(saida, 'SP', 'pendentes')[0], 1);
});

test('furo concluído sem data de término válida nunca sai do estoque -- limitação conhecida, não bug', () => {
  const saida = computeDemandas([
    furo({ status: 'CONCLUIDO', criacaoOS: d(2026, 1, 5), executadoDia: null, conclusao: null }),
  ], PERIODOS_2026);
  assert.deepStrictEqual(serieDe(saida, 'SP', 'pendentes'), new Array(12).fill(1));
});

test('data fora dos 12 períodos não vira mês nenhum, e não estoura o array', () => {
  const saida = computeDemandas([
    furo({ criacaoOS: d(2027, 2, 1), executadoDia: d(2027, 3, 1), conclusao: d(2027, 4, 1) }),
  ], PERIODOS_2026);
  assert.deepStrictEqual(serieDe(saida, 'SP', 'chegadas'), new Array(12).fill(0));
  assert.strictEqual(serieDe(saida, 'SP', 'chegadas').length, 12);
});

test('data nula é ignorada sem quebrar', () => {
  const saida = computeDemandas([
    furo({ criacaoOS: null, executadoDia: null, conclusao: null, atualizado: null }),
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
    furo({ tipologia: 'SP', status: 'PENDENTE', criacaoOS: d(2026, 1, 5), executadoDia: null, conclusao: null }),
    furo({ tipologia: 'ST', status: 'PENDENTE', criacaoOS: d(2026, 1, 6), executadoDia: null, conclusao: null }),
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
    furo({ status: 'CONCLUIDO', criacaoOS: d(2026, 1, 5), executadoDia: d(2026, 2, 10) }),
    furo({ status: 'PENDENTE', criacaoOS: d(2026, 1, 6), executadoDia: null, conclusao: null }),
  ], PERIODOS_2026);
  const entrada = saida.porRegistroEventos['SUP-0001-24||SP'];
  assert.strictEqual(entrada.chegada.length, 2, 'os 2 furos têm criacaoOS, PENDENTE inclusive');
  assert.strictEqual(entrada.sondagemRealizada.length, 1, 'só o CONCLUIDO conta pro fluxo Realizado');
});

test('porRegistroEventos: saidaEstoque é a data de EXECUÇÃO, uma só por furo', () => {
  const saida = computeDemandas([
    furo({ status: 'CONCLUIDO', criacaoOS: d(2026, 1, 1), executadoDia: d(2026, 2, 1), conclusao: null }),
  ], PERIODOS_2026);
  const entrada = saida.porRegistroEventos['SUP-0001-24||SP'];
  assert.strictEqual(entrada.saidaEstoque.length, 1);
  assert.strictEqual(entrada.saidaEstoque[0], diaEpoch(d(2026, 2, 1)));
});

test('porRegistroEventos: a data de cancelamento NÃO gera saída de estoque', () => {
  // Antes de 2026-08-10 o cancelamento competia com o início pelo "menor".
  // Agora ele é ignorado: a saída é a execução, e só ela.
  const saida = computeDemandas([
    furo({ status: 'CANCELADO', criacaoOS: d(2026, 1, 1), executadoDia: null,
           cancelamento: d(2026, 2, 1), conclusao: null }),
  ], PERIODOS_2026);
  const entrada = saida.porRegistroEventos['SUP-0001-24||SP'];
  assert.deepStrictEqual(entrada.saidaEstoque, []);
});

test('porRegistroEventos: furo sem execução nunca aparece em saidaEstoque (nunca sai do estoque)', () => {
  const saida = computeDemandas([
    furo({ status: 'PENDENTE', criacaoOS: d(2026, 1, 1), executadoDia: null, cancelamento: null, conclusao: null }),
  ], PERIODOS_2026);
  const entrada = saida.porRegistroEventos['SUP-0001-24||SP'];
  assert.deepStrictEqual(entrada.saidaEstoque, []);
});

test('porRegistroEventos: reconstrói o saldo mensal correto, contando chegada/saidaEstoque até o fim de cada mês', () => {
  const furos = [
    furo({ status: 'CONCLUIDO', criacaoOS: d(2026, 1, 10), executadoDia: d(2026, 3, 20) }),
    furo({ status: 'PENDENTE', criacaoOS: d(2026, 2, 5), executadoDia: null, conclusao: null }),
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

test('chegadasMensaisPorRegistro: bucketiza por (sup,tipologia), não por tipologia -- dois SUPs da mesma tipologia ficam em chaves separadas', () => {
  const furos = [
    furo({ sup: 'SUP-0001-24', tipologia: 'SP', criacaoOS: d(2026, 1, 10) }),
    furo({ sup: 'SUP-0002-24', tipologia: 'SP', criacaoOS: d(2026, 1, 15) }),
  ];
  const resultado = chegadasMensaisPorRegistro(furos, [], PERIODOS_2026);
  assert.deepStrictEqual(Object.keys(resultado).sort(), ['SUP-0001-24||SP', 'SUP-0002-24||SP']);
  assert.strictEqual(resultado['SUP-0001-24||SP'][0], 1);
  assert.strictEqual(resultado['SUP-0002-24||SP'][0], 1);
});

test('chegadasMensaisPorRegistro: ensaios de laboratório também contam, pelo evento "criacao" (Data Programada)', () => {
  const ensaios = [{ sup: 'SUP-0003-24', tipologia: 'LAB.C', criacao: d(2026, 3, 1), concluido: null }];
  const resultado = chegadasMensaisPorRegistro([], ensaios, PERIODOS_2026);
  assert.strictEqual(resultado['SUP-0003-24||LAB.C'][2], 1);
});

test('chegadasMensaisPorRegistro: furo sem criacaoOS não entra em nenhum mês, e não cria chave nenhuma', () => {
  const furos = [furo({ criacaoOS: null })];
  const resultado = chegadasMensaisPorRegistro(furos, [], PERIODOS_2026);
  assert.deepStrictEqual(resultado, {});
});

test('chegadasMensaisPorRegistro: sem furos nem ensaios devolve objeto vazio, não lança', () => {
  assert.deepStrictEqual(chegadasMensaisPorRegistro([], [], PERIODOS_2026), {});
  assert.deepStrictEqual(chegadasMensaisPorRegistro(undefined, undefined, PERIODOS_2026), {});
});

test('chegadasMensaisPorRegistro: a soma por mês, agregada de novo por tipologia, bate com demandas.totais.chegadas de computeDemandas -- duas leituras do MESMO conjunto de furos (por registro vs. por tipologia) não podem divergir', () => {
  const furos = [
    furo({ sup: 'SUP-0001-24', tipologia: 'SP', criacaoOS: d(2026, 1, 10) }),
    furo({ sup: 'SUP-0002-24', tipologia: 'SP', criacaoOS: d(2026, 2, 5) }),
    furo({ sup: 'SUP-0001-24', tipologia: 'ST', criacaoOS: d(2026, 1, 20) }),
  ];
  const porRegistro = chegadasMensaisPorRegistro(furos, [], PERIODOS_2026);
  const porTipologia = computeDemandas(furos, PERIODOS_2026, []);

  const somaSP = new Array(12).fill(0);
  ['SUP-0001-24||SP', 'SUP-0002-24||SP'].forEach((chave) => {
    (porRegistro[chave] || new Array(12).fill(0)).forEach((v, i) => { somaSP[i] += v; });
  });
  const blocoSP = porTipologia.tipologias.find((t) => t.tipologia === 'SP');
  assert.deepStrictEqual(somaSP, blocoSP.series.chegadas);
});

test('saldoAberturaPorRegistro: furo que chegou no ano anterior e ainda não foi executado até 31/12 conta no saldo de abertura', () => {
  const furos = [
    furo({ sup: 'SUP-0001-24', tipologia: 'SP', criacaoOS: d(2025, 6, 1), executadoDia: null, status: 'PENDENTE' }),
  ];
  const resultado = saldoAberturaPorRegistro(furos, [], PERIODOS_2026);
  assert.strictEqual(resultado['SUP-0001-24||SP'], 1);
});

test('saldoAberturaPorRegistro: furo do ano anterior JÁ executado até 31/12 não conta -- já saiu do estoque antes do corte', () => {
  const furos = [
    furo({ sup: 'SUP-0001-24', tipologia: 'SP', criacaoOS: d(2025, 3, 1), executadoDia: d(2025, 5, 1), status: 'CONCLUIDO' }),
  ];
  const resultado = saldoAberturaPorRegistro(furos, [], PERIODOS_2026);
  assert.strictEqual(resultado['SUP-0001-24||SP'], undefined, 'não deveria criar chave nenhuma para um SUP sem saldo em aberto');
});

test('saldoAberturaPorRegistro: furo que chegou DENTRO do ano exibido (2026) não conta -- isso é chegada do ano, não saldo de abertura', () => {
  const furos = [
    furo({ sup: 'SUP-0001-24', tipologia: 'SP', criacaoOS: d(2026, 1, 10), executadoDia: null, status: 'PENDENTE' }),
  ];
  const resultado = saldoAberturaPorRegistro(furos, [], PERIODOS_2026);
  assert.strictEqual(resultado['SUP-0001-24||SP'], undefined);
});

test('saldoAberturaPorRegistro: executado EXATAMENTE no corte (31/12 23:59:59 do ano anterior) já saiu do estoque -- mesma regra de fronteira que pendentesNaData/saidaEstoque já usam', () => {
  const furos = [
    furo({
      sup: 'SUP-0001-24', tipologia: 'SP', criacaoOS: d(2025, 1, 1),
      executadoDia: new Date(Date.UTC(2025, 11, 31, 23, 59, 59)), status: 'CONCLUIDO',
    }),
  ];
  const resultado = saldoAberturaPorRegistro(furos, [], PERIODOS_2026);
  assert.strictEqual(resultado['SUP-0001-24||SP'], undefined);
});

test('saldoAberturaPorRegistro: ensaios de laboratório também contam, pelo evento "criacao" -- mesma regra de furos', () => {
  const ensaios = [ensaioLab({ sup: 'SUP-0003-24', tipologia: 'LAB.C', criacao: d(2025, 8, 1), concluido: null })];
  const resultado = saldoAberturaPorRegistro([], ensaios, PERIODOS_2026);
  assert.strictEqual(resultado['SUP-0003-24||LAB.C'], 1);
});

test('saldoAberturaPorRegistro: duas chaves diferentes somam separadamente, e várias ocorrências da mesma chave se acumulam', () => {
  const furos = [
    furo({ sup: 'SUP-0001-24', tipologia: 'SP', criacaoOS: d(2025, 1, 1), executadoDia: null, status: 'PENDENTE' }),
    furo({ sup: 'SUP-0001-24', tipologia: 'SP', criacaoOS: d(2025, 2, 1), executadoDia: null, status: 'PENDENTE' }),
    furo({ sup: 'SUP-0002-24', tipologia: 'ST', criacaoOS: d(2024, 1, 1), executadoDia: null, status: 'PENDENTE' }),
  ];
  const resultado = saldoAberturaPorRegistro(furos, [], PERIODOS_2026);
  assert.strictEqual(resultado['SUP-0001-24||SP'], 2);
  assert.strictEqual(resultado['SUP-0002-24||ST'], 1);
});

test('saldoAberturaPorRegistro: sem furos nem ensaios devolve objeto vazio, não lança', () => {
  assert.deepStrictEqual(saldoAberturaPorRegistro([], [], PERIODOS_2026), {});
  assert.deepStrictEqual(saldoAberturaPorRegistro(undefined, undefined, PERIODOS_2026), {});
});

test('saldoAberturaPorRegistro: bate com o cálculo equivalente de pendentesNaData (mesma regra de estoque, corte fixo em vez de mês a mês) para o mesmo conjunto de furos', () => {
  const furos = [
    furo({ sup: 'SUP-0001-24', tipologia: 'SP', criacaoOS: d(2024, 6, 1), executadoDia: null, status: 'PENDENTE' }),
    furo({ sup: 'SUP-0001-24', tipologia: 'SP', criacaoOS: d(2025, 3, 1), executadoDia: d(2025, 4, 1), status: 'CONCLUIDO' }),
    furo({ sup: 'SUP-0001-24', tipologia: 'SP', criacaoOS: d(2025, 11, 1), executadoDia: null, status: 'PENDENTE' }),
    furo({ sup: 'SUP-0001-24', tipologia: 'SP', criacaoOS: d(2026, 1, 5), executadoDia: null, status: 'PENDENTE' }),
  ];
  // Só o 1º e o 3º furo (chegaram antes de 2026, ainda não executados até 31/12/2025)
  // deveriam contar -- o 2º já saiu do estoque em 2025, o 4º chegou em 2026 (é chegada do ano).
  const resultado = saldoAberturaPorRegistro(furos, [], PERIODOS_2026);
  assert.strictEqual(resultado['SUP-0001-24||SP'], 2);
});
