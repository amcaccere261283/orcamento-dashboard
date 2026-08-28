'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { normalizarNomeConcessao, vincularSupsAConcessoes } = require('../tools/semanal/vinculo-sup-concessionaria.js');

test('normalizarNomeConcessao ignora maiúscula, acento, espaço e sufixo de razão social', () => {
  assert.strictEqual(normalizarNomeConcessao('AutoBan'), normalizarNomeConcessao('Autoban'));
  assert.strictEqual(normalizarNomeConcessao('EPR Triângulo'), normalizarNomeConcessao('EPR Triangulo'));
  assert.strictEqual(normalizarNomeConcessao('Via Sul'), normalizarNomeConcessao('ViaSul'));
  assert.strictEqual(normalizarNomeConcessao('Via Araucária S.A'), normalizarNomeConcessao('Via Araucária'));
});

test('normalizarNomeConcessao NÃO junta nomes diferentes por prefixo/substring', () => {
  assert.notStrictEqual(normalizarNomeConcessao('Rota Sorocabana'), normalizarNomeConcessao('Sorocabana'));
  assert.notStrictEqual(normalizarNomeConcessao('Autopista Litoral Sul'), normalizarNomeConcessao('Litoral Sul'));
});

function concessao(id, nome, comTracado) {
  return { id: id, nome: nome, geojson: comTracado === false ? null : { type: 'FeatureCollection', features: [] } };
}

test('vincularSupsAConcessoes casa por igualdade exata normalizada', () => {
  const registros = [
    { sup: 'SUP-6806-23', tomador: 'Pantanal' },
    { sup: 'SUP-8187-25', tomador: 'Pantanal' },
    { sup: 'SUP-8224-25 (AB)', tomador: 'AutoBan' },
  ];
  const concessoes = [concessao('50', 'Pantanal'), concessao('10', 'Autoban')];
  const resultado = vincularSupsAConcessoes(registros, concessoes);
  assert.deepStrictEqual(resultado.concessaoIdPorSup, {
    'SUP-6806-23': '50', 'SUP-8187-25': '50', 'SUP-8224-25 (AB)': '10',
  });
  assert.deepStrictEqual(resultado.supsPorConcessaoId, {
    '50': ['SUP-6806-23', 'SUP-8187-25'], '10': ['SUP-8224-25 (AB)'],
  });
});

test('vincularSupsAConcessoes deixa de fora tomador sem correspondência -- nunca por aproximação', () => {
  const registros = [{ sup: 'SUP-8272-25', tomador: 'Engecorps' }];
  const concessoes = [concessao('10', 'Autoban')];
  const resultado = vincularSupsAConcessoes(registros, concessoes);
  assert.deepStrictEqual(resultado.concessaoIdPorSup, {});
  assert.deepStrictEqual(resultado.supsPorConcessaoId, {});
});

test('vincularSupsAConcessoes ignora concessionária sem traçado (geojson null)', () => {
  const registros = [{ sup: 'SUP-A', tomador: 'Sem Traçado' }];
  const concessoes = [concessao('1', 'Sem Traçado', false)];
  assert.deepStrictEqual(vincularSupsAConcessoes(registros, concessoes).concessaoIdPorSup, {});
});

test('vincularSupsAConcessoes usa o PRIMEIRO tomador não vazio do SUP, ignora repetições', () => {
  const registros = [
    { sup: 'SUP-A', tomador: 'Autoban' },
    { sup: 'SUP-A', tomador: 'Outro Nome Qualquer' },
  ];
  const concessoes = [concessao('10', 'Autoban'), concessao('99', 'Outro Nome Qualquer')];
  const resultado = vincularSupsAConcessoes(registros, concessoes);
  assert.deepStrictEqual(resultado.concessaoIdPorSup, { 'SUP-A': '10' });
});

test('vincularSupsAConcessoes com registros/concessoes vazios ou ausentes nunca lança', () => {
  assert.deepStrictEqual(vincularSupsAConcessoes([], []), { concessaoIdPorSup: {}, supsPorConcessaoId: {} });
  assert.deepStrictEqual(vincularSupsAConcessoes(null, null), { concessaoIdPorSup: {}, supsPorConcessaoId: {} });
});

test('vincularSupsAConcessoes resolve "Rota Sorocabana" -> "Sorocabana" via sinônimo confirmado (2026-08-28)', () => {
  const registros = [{ sup: 'SUP-8370-25', tomador: 'Rota Sorocabana' }];
  const concessoes = [concessao('15', 'Sorocabana')];
  const resultado = vincularSupsAConcessoes(registros, concessoes);
  assert.deepStrictEqual(resultado.concessaoIdPorSup, { 'SUP-8370-25': '15' });
});

test('vincularSupsAConcessoes usa o override confirmado por SUP (RioSP separada por rodovia, 2026-08-28), com prioridade sobre o tomador', () => {
  const registros = [
    { sup: 'SUP-7285-24', tomador: 'RioSP' },
    { sup: 'SUP-6498-23', tomador: 'RioSP' },
    { sup: 'SUP-6830-23', tomador: 'RioSP' },
    { sup: 'SUP-OUTRO', tomador: 'RioSP' }, // sem override -- cai na RioSP genérica
  ];
  const concessoes = [
    concessao('13', 'RioSP'),
    concessao('riosp-br-101', 'RioSP (BR-101)'),
    concessao('riosp-br-116', 'RioSP (BR-116)'),
  ];
  const resultado = vincularSupsAConcessoes(registros, concessoes);
  assert.deepStrictEqual(resultado.concessaoIdPorSup, {
    'SUP-7285-24': 'riosp-br-116',
    'SUP-6498-23': 'riosp-br-101',
    'SUP-6830-23': 'riosp-br-101',
    'SUP-OUTRO': '13',
  });
  assert.deepStrictEqual(
    resultado.supsPorConcessaoId['riosp-br-101'].sort(),
    ['SUP-6498-23', 'SUP-6830-23']
  );
});

test('vincularSupsAConcessoes ignora registro sem SUP', () => {
  const registros = [{ sup: '', tomador: 'Autoban' }, { sup: null, tomador: 'Autoban' }];
  const concessoes = [concessao('10', 'Autoban')];
  assert.deepStrictEqual(vincularSupsAConcessoes(registros, concessoes).concessaoIdPorSup, {});
});
