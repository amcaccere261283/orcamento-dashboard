'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  agregarEquipesPorDia, equipesEquivalentes,
} = require('../tools/semanal/compute-equipes-mobilizadas.js');
const { diaEpoch } = require('../tools/semanal/compute-semanal.js');

const dia = (d) => diaEpoch(new Date(Date.UTC(2026, 6, d))); // julho/2026

function furo({ sup = 'SUP-0001-24', tipologia = 'ST', sondador = 'Fulano', ini, fim }) {
  return { sup, tipologia, sondador, inicioSondagem: ini, terminoSondagem: fim };
}

test('a equipe ocupa TODOS os dias do furo, não só o dia em que terminou', () => {
  // Um furo de 01 a 03/07 é uma equipe ocupada em três dias. Contar só o
  // término subestimaria a ocupação em furos longos, que são justamente os
  // que mais consomem equipe.
  const porDia = agregarEquipesPorDia([furo({ ini: dia(1), fim: dia(3) })]);
  assert.deepStrictEqual(porDia['SUP-0001-24||ST'], {
    [dia(1)]: 1, [dia(2)]: 1, [dia(3)]: 1,
  });
});

test('dois sondadores no mesmo dia e SUP contam 2; o mesmo sondador em dois furos conta 1', () => {
  const porDia = agregarEquipesPorDia([
    furo({ sondador: 'Ana', ini: dia(1), fim: dia(1) }),
    furo({ sondador: 'Bruno', ini: dia(1), fim: dia(1) }),
    // Mesmo sondador, outro furo no mesmo dia -- é a mesma equipe, não duas.
    furo({ sondador: 'Ana', ini: dia(1), fim: dia(1) }),
  ]);
  assert.strictEqual(porDia['SUP-0001-24||ST'][dia(1)], 2);
});

test('o mesmo sondador em dois SUPs no mesmo dia conta em cada um -- é assim que a ocupação some entre contratos', () => {
  // Aqui está a diferença que separa esta métrica da contagem ingênua: por
  // par (SUP, tipologia) ele aparece nos dois, mas como cada par vira uma
  // MÉDIA sobre os dias do período, a soma continua fazendo sentido -- ao
  // contrário de "sondadores distintos no mês", que inflava 95 pessoas em
  // 185 equipes (medido em julho/2026).
  const porDia = agregarEquipesPorDia([
    furo({ sup: 'SUP-A', sondador: 'Ana', ini: dia(1), fim: dia(1) }),
    furo({ sup: 'SUP-B', sondador: 'Ana', ini: dia(1), fim: dia(1) }),
  ]);
  assert.strictEqual(porDia['SUP-A||ST'][dia(1)], 1);
  assert.strictEqual(porDia['SUP-B||ST'][dia(1)], 1);
});

// Furo sem sondador é PENDENTE ou CANCELADO na planilha real (medido em
// 2026-08-03: CONCLUIDO/EXECUTADO têm ZERO vazios) -- ninguém executou, então
// não ocupou equipe. Ignorar é o comportamento certo, não uma perda.
test('furo sem sondador não entra na conta', () => {
  const porDia = agregarEquipesPorDia([
    furo({ sondador: '', ini: dia(1), fim: dia(1) }),
    furo({ sondador: '   ', ini: dia(2), fim: dia(2) }),
  ]);
  assert.deepStrictEqual(porDia, {});
});

test('furo sem data de início não entra; sem término, ocupa só o dia de início', () => {
  const porDia = agregarEquipesPorDia([
    furo({ sondador: 'Ana', ini: null, fim: dia(3) }),
    furo({ sup: 'SUP-B', sondador: 'Bruno', ini: dia(5), fim: null }),
  ]);
  assert.strictEqual(porDia['SUP-0001-24||ST'], undefined, 'sem início não dá para saber quando ocupou');
  assert.deepStrictEqual(porDia['SUP-B||ST'], { [dia(5)]: 1 });
});

test('término anterior ao início (dado invertido) não gera intervalo negativo nem laço infinito', () => {
  const porDia = agregarEquipesPorDia([furo({ sondador: 'Ana', ini: dia(10), fim: dia(3) })]);
  assert.deepStrictEqual(porDia['SUP-0001-24||ST'], { [dia(10)]: 1 },
    'cai no comportamento de "sem término": ocupa só o dia de início');
});

// --- equipesEquivalentes ---------------------------------------------------

test('equipes equivalentes é a média diária no período, não a contagem de pessoas', () => {
  // 2 equipes em 2 dias de um período de 4 dias = 1,0 equipe equivalente.
  // É essa média que torna o número somável entre SUPs e comparável com o
  // Previsto da MATRIZ, que também é uma foto média do mês.
  const porDia = { [dia(1)]: 2, [dia(2)]: 2 };
  assert.strictEqual(equipesEquivalentes(porDia, [{ inicio: dia(1), fim: dia(4) }]), 1);
});

test('equipes equivalentes só conta os dias DENTRO das janelas pedidas', () => {
  const porDia = { [dia(1)]: 3, [dia(9)]: 3 };
  // Janela de 01 a 03: só o primeiro dia conta -> 3/3 = 1.
  assert.strictEqual(equipesEquivalentes(porDia, [{ inicio: dia(1), fim: dia(3) }]), 1);
});

test('equipes equivalentes soma várias janelas -- é o que faz o recorte por semana funcionar', () => {
  // S1 (01-02) com 2 equipes/dia e S3 (10-11) sem nada: 4 equipe-dia em 4
  // dias de janela = 1,0.
  const porDia = { [dia(1)]: 2, [dia(2)]: 2 };
  const janelas = [{ inicio: dia(1), fim: dia(2) }, { inicio: dia(10), fim: dia(11) }];
  assert.strictEqual(equipesEquivalentes(porDia, janelas), 1);
});

test('sem janela, ou janela de tamanho zero, devolve null -- nunca 0', () => {
  // "Não dá para calcular" e "havia zero equipe" são coisas diferentes, e o
  // Balanço trata null como sem-dado (não desenha barra) -- mesma convenção
  // de somarIntervalo em compute-balanco.js.
  assert.strictEqual(equipesEquivalentes({ [dia(1)]: 2 }, []), null);
  assert.strictEqual(equipesEquivalentes({ [dia(1)]: 2 }, null), null);
});

test('período sem nenhuma equipe devolve 0, não null -- ausência no Avanço Sond é zero real', () => {
  // Mesma convenção que realizadoDoAvancos já segue: a planilha é listagem
  // completa, então "nenhum furo" é uma contagem de zero, não falta de dado.
  assert.strictEqual(equipesEquivalentes({}, [{ inicio: dia(1), fim: dia(4) }]), 0);
});

// --- O tipo que o dado REAL tem -------------------------------------------
// parseAvancos entrega Date (dataSaneada -> excelSerialParaData), não número
// de dias. Os testes acima passam número, e foi justamente por isso que a
// primeira versão deste módulo passou verde e travou o build na planilha real:
// o laço por dia iterava de milissegundo em milissegundo sobre um Date, o que
// dava 2,87 trilhões de iterações. Estes dois testes prendem o tipo real.

test('aceita Date (o que parseAvancos realmente entrega), não só dia-desde-época', () => {
  const d1 = new Date(Date.UTC(2026, 6, 1));
  const d3 = new Date(Date.UTC(2026, 6, 3));
  const porDia = agregarEquipesPorDia([
    { sup: 'SUP-0001-24', tipologia: 'ST', sondador: 'Ana', inicioSondagem: d1, terminoSondagem: d3 },
  ]);
  assert.deepStrictEqual(porDia['SUP-0001-24||ST'], { [dia(1)]: 1, [dia(2)]: 1, [dia(3)]: 1 });
});

test('Date e número produzem exatamente o mesmo resultado', () => {
  const comDate = agregarEquipesPorDia([
    { sup: 'S', tipologia: 'T', sondador: 'Ana', inicioSondagem: new Date(Date.UTC(2026, 6, 5)), terminoSondagem: new Date(Date.UTC(2026, 6, 6)) },
  ]);
  const comNumero = agregarEquipesPorDia([
    { sup: 'S', tipologia: 'T', sondador: 'Ana', inicioSondagem: dia(5), terminoSondagem: dia(6) },
  ]);
  assert.deepStrictEqual(comDate, comNumero);
});

test('Date inválido não vira intervalo gigante -- entra como ausente', () => {
  const porDia = agregarEquipesPorDia([
    { sup: 'S', tipologia: 'T', sondador: 'Ana', inicioSondagem: new Date('nada'), terminoSondagem: dia(6) },
  ]);
  assert.deepStrictEqual(porDia, {});
});
