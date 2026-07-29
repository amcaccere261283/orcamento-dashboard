'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { mediaEquipesPonderada, somarIntervaloEquipeDias, DIAS_PREMISSA_MES } = require('../tools/comum/calculo-equipes.js');

test('um único mês devolve o próprio valor do mês', () => {
  const mensal = [0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  assert.strictEqual(mediaEquipesPonderada(mensal, 1, 2), 2);
});

test('vários meses fazem média ponderada por dias, não soma', () => {
  const mensal = new Array(12).fill(0);
  mensal[0] = 2; mensal[1] = 4;
  const esperado = (2 * DIAS_PREMISSA_MES[0] + 4 * DIAS_PREMISSA_MES[1])
                 / (DIAS_PREMISSA_MES[0] + DIAS_PREMISSA_MES[1]);
  assert.strictEqual(mediaEquipesPonderada(mensal, 0, 2), esperado);
  assert.ok(mediaEquipesPonderada(mensal, 0, 2) < 6, 'não pode ser a soma');
});

test('meses sem dado não entram no denominador', () => {
  const mensal = new Array(12).fill(null);
  mensal[3] = 5;
  assert.strictEqual(mediaEquipesPonderada(mensal, 0, 12), 5);
});

test('intervalo totalmente vazio devolve null', () => {
  assert.strictEqual(mediaEquipesPonderada(new Array(12).fill(null), 0, 12), null);
});

test('equipe-dias soma, ao contrário da média', () => {
  const mensal = new Array(12).fill(0);
  mensal[0] = 1;
  assert.strictEqual(somarIntervaloEquipeDias(mensal, 0, 1), DIAS_PREMISSA_MES[0]);
});
