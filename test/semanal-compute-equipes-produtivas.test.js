'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { agregarEquipesProdutivas } = require('../tools/semanal/compute-equipes-produtivas.js');

// Linhas modeladas a partir da tabela real de campo/fotos (capturada ao
// vivo em 2026-08-05) -- só os campos que a função lê.
const LINHAS_FIXTURE = [
  { 'Contrato Financeiro': 'SUP-7722-24', Data: '01/08/2026', Sondador: 'Evamar Fernandes de Macedo' },
  { 'Contrato Financeiro': 'SUP-7722-24', Data: '01/08/2026', Sondador: 'Evamar Fernandes de Macedo' }, // 2ª foto, mesmo dia/sondador -- não duplica
  { 'Contrato Financeiro': 'SUP-7722-24', Data: '01/08/2026', Sondador: 'Filipe Cosme Araujo Cunha' },
  { 'Contrato Financeiro': 'SUP-7722-24', Data: '02/08/2026', Sondador: 'Evamar Fernandes de Macedo' },
];

const TIPOLOGIA_POR_SONDADOR = {
  'Evamar Fernandes de Macedo': 'SP',
  'Filipe Cosme Araujo Cunha': 'SP',
};

test('agregarEquipesProdutivas conta Sondador distinto por dia e por (SUP, tipologia)', () => {
  const { porDia, semTipologia } = agregarEquipesProdutivas({
    linhas: LINHAS_FIXTURE,
    tipologiaPorSondador: TIPOLOGIA_POR_SONDADOR,
  });
  const chave = 'SUP-7722-24||SP';
  assert.ok(porDia[chave], 'chave SUP-7722-24||SP deveria existir');
  // 01/08/2026 -> dia-desde-epoca
  const dia1 = Math.floor(Date.UTC(2026, 7, 1) / 86400000);
  const dia2 = Math.floor(Date.UTC(2026, 7, 2) / 86400000);
  assert.equal(porDia[chave][dia1], 2, '01/08: Evamar + Filipe, sem duplicar Evamar (2 fotos)');
  assert.equal(porDia[chave][dia2], 1, '02/08: só Evamar');
  assert.equal(semTipologia, 0);
});

test('agregarEquipesProdutivas conta em semTipologia quando o sondador não tem tipologia conhecida', () => {
  const { porDia, semTipologia } = agregarEquipesProdutivas({
    linhas: [{ 'Contrato Financeiro': 'SUP-1', Data: '01/08/2026', Sondador: 'Alguem Desconhecido' }],
    tipologiaPorSondador: {},
  });
  assert.deepEqual(porDia, {});
  assert.equal(semTipologia, 1);
});

test('agregarEquipesProdutivas ignora linhas sem contrato, sem data ou sem sondador', () => {
  const { porDia, semTipologia } = agregarEquipesProdutivas({
    linhas: [
      { 'Contrato Financeiro': '', Data: '01/08/2026', Sondador: 'Alguem' },
      { 'Contrato Financeiro': 'SUP-1', Data: '', Sondador: 'Alguem' },
      { 'Contrato Financeiro': 'SUP-1', Data: '01/08/2026', Sondador: '' },
    ],
    tipologiaPorSondador: { Alguem: 'SP' },
  });
  assert.deepEqual(porDia, {});
  assert.equal(semTipologia, 0);
});

test('agregarEquipesProdutivas aplica rotularTipologia quando fornecida', () => {
  const { porDia } = agregarEquipesProdutivas({
    linhas: [{ 'Contrato Financeiro': 'SUP-1', Data: '01/08/2026', Sondador: 'Alguem' }],
    tipologiaPorSondador: { Alguem: 'SM' },
    rotularTipologia: (t) => (t === 'SM' ? 'SM / SM.F / SR' : t),
  });
  const dia1 = Math.floor(Date.UTC(2026, 7, 1) / 86400000);
  assert.equal(porDia['SUP-1||SM / SM.F / SR'][dia1], 1);
});
