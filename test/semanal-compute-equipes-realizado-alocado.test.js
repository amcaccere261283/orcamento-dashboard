'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { agregarEquipesRealizadoAlocado } = require('../tools/semanal/compute-equipes-realizado-alocado.js');

test('ativa e produziu no dia: fraciona 1/N entre as combinações (SUP,tipo) do dia', () => {
  const roster = [{ idEquipe: '1', diaEpoch: 100, estado: 'mobilizada' }];
  const producao = [
    { idEquipe: '1', sup: 'SUP-A', tipo: 'SP', diaEpoch: 100 },
    { idEquipe: '1', sup: 'SUP-B', tipo: 'SM', diaEpoch: 100 },
  ];
  const { porDia } = agregarEquipesRealizadoAlocado({ roster, producao });
  assert.equal(porDia['SUP-A||SP'][100], 0.5);
  assert.equal(porDia['SUP-B||SM'][100], 0.5);
});

test('duas linhas de produção na MESMA combinação (SUP,tipo) no mesmo dia não inflam o denominador', () => {
  const roster = [{ idEquipe: '1', diaEpoch: 100, estado: 'mobilizada' }];
  const producao = [
    { idEquipe: '1', sup: 'SUP-A', tipo: 'SP', diaEpoch: 100 },
    { idEquipe: '1', sup: 'SUP-A', tipo: 'SP', diaEpoch: 100 }, // segunda foto, mesma combinação
  ];
  const { porDia } = agregarEquipesRealizadoAlocado({ roster, producao });
  assert.equal(porDia['SUP-A||SP'][100], 1);
});

test('ativa sem produção no dia, com produção dentro de 45 dias: carry-forward pro último (SUP,tipo)', () => {
  const roster = [{ idEquipe: '1', diaEpoch: 140, estado: 'campoSemFuro' }];
  const producao = [
    { idEquipe: '1', sup: 'SUP-A', tipo: 'SP', diaEpoch: 100 }, // 40 dias antes
  ];
  const { porDia } = agregarEquipesRealizadoAlocado({ roster, producao });
  assert.equal(porDia['SUP-A||SP'][140], 1);
});

test('ativa sem produção, última produção a MAIS de 45 dias: fica fora da conta', () => {
  const roster = [{ idEquipe: '1', diaEpoch: 200, estado: 'mobilizada' }];
  const producao = [{ idEquipe: '1', sup: 'SUP-A', tipo: 'SP', diaEpoch: 100 }]; // 100 dias antes
  const { porDia, foraDaJanela } = agregarEquipesRealizadoAlocado({ roster, producao });
  assert.deepEqual(porDia, {});
  assert.equal(foraDaJanela, 1);
});

test('ativa sem NENHUMA produção histórica: fica fora da conta', () => {
  const roster = [{ idEquipe: '1', diaEpoch: 100, estado: 'mobilizada' }];
  const { porDia, foraDaJanela } = agregarEquipesRealizadoAlocado({ roster, producao: [] });
  assert.deepEqual(porDia, {});
  assert.equal(foraDaJanela, 1);
});

test('estado "fora" nunca entra na conta, mesmo com produção no mesmo dia', () => {
  const roster = [{ idEquipe: '1', diaEpoch: 100, estado: 'fora' }];
  const producao = [{ idEquipe: '1', sup: 'SUP-A', tipo: 'SP', diaEpoch: 100 }];
  const { porDia, ativos } = agregarEquipesRealizadoAlocado({ roster, producao });
  assert.deepEqual(porDia, {});
  assert.equal(ativos, 0);
});

test('estado "naoEquipe" (encarregado, auxiliar, contratação...) NÃO conta como ativa -- pedido do dono do projeto em 2026-08-17 pra tirar encarregado da conta', () => {
  const roster = [{ idEquipe: '1', diaEpoch: 100, estado: 'naoEquipe' }];
  const producao = [{ idEquipe: '1', sup: 'SUP-A', tipo: 'SP', diaEpoch: 100 }];
  const { porDia, ativos } = agregarEquipesRealizadoAlocado({ roster, producao });
  assert.deepEqual(porDia, {});
  assert.equal(ativos, 0);
});

test('carry-forward usa a produção mais RECENTE dentro da janela, não a mais antiga', () => {
  const roster = [{ idEquipe: '1', diaEpoch: 150, estado: 'mobilizada' }];
  const producao = [
    { idEquipe: '1', sup: 'SUP-VELHO', tipo: 'SP', diaEpoch: 100 },
    { idEquipe: '1', sup: 'SUP-NOVO', tipo: 'SM', diaEpoch: 120 },
  ];
  const { porDia } = agregarEquipesRealizadoAlocado({ roster, producao });
  assert.equal(porDia['SUP-NOVO||SM'][150], 1);
  assert.equal(porDia['SUP-VELHO||SP'], undefined);
});

test('equipe sem SUP nenhum é redistribuída proporcionalmente entre as combinações do mesmo dia', () => {
  const roster = [
    { idEquipe: '1', diaEpoch: 100, estado: 'mobilizada' }, // SUP-A: 1
    { idEquipe: '2', diaEpoch: 100, estado: 'mobilizada' }, // SUP-B: 3 (peso maior)
    { idEquipe: '2b', diaEpoch: 100, estado: 'mobilizada' },
    { idEquipe: '2c', diaEpoch: 100, estado: 'mobilizada' },
    { idEquipe: '3', diaEpoch: 100, estado: 'mobilizada' }, // sem produção nenhuma
  ];
  const producao = [
    { idEquipe: '1', sup: 'SUP-A', tipo: 'SP', diaEpoch: 100 },
    { idEquipe: '2', sup: 'SUP-B', tipo: 'SM', diaEpoch: 100 },
    { idEquipe: '2b', sup: 'SUP-B', tipo: 'SM', diaEpoch: 100 },
    { idEquipe: '2c', sup: 'SUP-B', tipo: 'SM', diaEpoch: 100 },
  ];
  const { porDia, ativos, foraDaJanela } = agregarEquipesRealizadoAlocado({ roster, producao });
  assert.equal(ativos, 5);
  assert.equal(foraDaJanela, 1);
  // falta = 1, dividida proporcionalmente entre SUP-A (peso 1/4) e SUP-B (peso 3/4)
  assert.equal(porDia['SUP-A||SP'][100], 1 + 1 * (1 / 4));
  assert.equal(porDia['SUP-B||SM'][100], 3 + 1 * (3 / 4));
  // o total do dia fecha exatamente no total de ativas
  const totalDia = porDia['SUP-A||SP'][100] + porDia['SUP-B||SM'][100];
  assert.equal(totalDia, 5);
});

test('sem NENHUMA combinação alocada no dia, não há onde redistribuir: dia fica vazio (comportamento anterior)', () => {
  const roster = [
    { idEquipe: '1', diaEpoch: 100, estado: 'mobilizada' },
    { idEquipe: '2', diaEpoch: 100, estado: 'mobilizada' },
  ];
  const { porDia, foraDaJanela } = agregarEquipesRealizadoAlocado({ roster, producao: [] });
  assert.deepEqual(porDia, {});
  assert.equal(foraDaJanela, 2);
});

test('janelaFallbackDias é configurável (default 45)', () => {
  const roster = [{ idEquipe: '1', diaEpoch: 130, estado: 'mobilizada' }];
  const producao = [{ idEquipe: '1', sup: 'SUP-A', tipo: 'SP', diaEpoch: 100 }]; // 30 dias antes
  const comJanelaCurta = agregarEquipesRealizadoAlocado({ roster, producao, janelaFallbackDias: 20 });
  assert.deepEqual(comJanelaCurta.porDia, {});
  const comJanelaPadrao = agregarEquipesRealizadoAlocado({ roster, producao });
  assert.equal(comJanelaPadrao.porDia['SUP-A||SP'][130], 1);
});
