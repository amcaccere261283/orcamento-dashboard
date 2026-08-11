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

test('estado "naoEquipe" CONTA como ativa -- definição nova de 2026-08-10, diferente de contaComoAtiva', () => {
  const roster = [{ idEquipe: '1', diaEpoch: 100, estado: 'naoEquipe' }];
  const producao = [{ idEquipe: '1', sup: 'SUP-A', tipo: 'SP', diaEpoch: 100 }];
  const { porDia, ativos } = agregarEquipesRealizadoAlocado({ roster, producao });
  assert.equal(porDia['SUP-A||SP'][100], 1);
  assert.equal(ativos, 1);
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

test('janelaFallbackDias é configurável (default 45)', () => {
  const roster = [{ idEquipe: '1', diaEpoch: 130, estado: 'mobilizada' }];
  const producao = [{ idEquipe: '1', sup: 'SUP-A', tipo: 'SP', diaEpoch: 100 }]; // 30 dias antes
  const comJanelaCurta = agregarEquipesRealizadoAlocado({ roster, producao, janelaFallbackDias: 20 });
  assert.deepEqual(comJanelaCurta.porDia, {});
  const comJanelaPadrao = agregarEquipesRealizadoAlocado({ roster, producao });
  assert.equal(comJanelaPadrao.porDia['SUP-A||SP'][130], 1);
});
