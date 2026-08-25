'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderAlocacaoPagina } = require('../tools/semanal/render-alocacao-pagina.js');

const SENHA_FAKE = 'senha-fake-de-teste-e2e-nao-e-a-real';
const PERIODOS_2026 = Array.from({ length: 12 }, (_, mes) => new Date(Date.UTC(2026, mes, 1)));
const DEMANDAS_VAZIAS = { tipologias: [], totais: {}, porRegistroEventos: {}, equipesCsv: null, osParaSup: null, equipesRosterPeriodo: null };

function registroSintetico(sup, tomador) {
  const zeros = new Array(12).fill(0);
  const bloco = () => ({ equipes: zeros, volume: zeros, financeiro: zeros });
  return { sup, grupo: 'Grupo-Sintetico', tomador, tipologia: 'ST', previsto: bloco(), realizado: bloco(), total: bloco() };
}

test('renderAlocacaoPagina exige senha e periodos', () => {
  assert.throws(() => renderAlocacaoPagina({ registros: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: '', geradoEm: new Date() }));
  assert.throws(() => renderAlocacaoPagina({ registros: [], demandas: DEMANDAS_VAZIAS, periodos: [], senha: SENHA_FAKE, geradoEm: new Date() }));
});

test('o HTML cru tem #secao-alocacao vazia e nenhum dado de registro em texto puro', () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa')];
  const html = renderAlocacaoPagina({ registros, demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z') });
  assert.match(html, /<div id="secao-alocacao"><\/div>/);
  assert.doesNotMatch(html, /Tomador-Sintetico-Alfa/);
  assert.match(html, /<title>ALOCAÇÃO EQUIPES<\/title>/);
});

test('não tem markup das outras 6 abas', () => {
  const registros = [registroSintetico('SUP-0002-24', 'Tomador-Sintetico-Beta')];
  const html = renderAlocacaoPagina({ registros, demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z') });
  assert.doesNotMatch(html, /id="secao-semanal"/);
  assert.doesNotMatch(html, /id="secao-consolidado"/);
});
