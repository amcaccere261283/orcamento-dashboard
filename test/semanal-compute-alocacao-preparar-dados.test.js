'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { prepararDadosAlocacao } = require('../tools/semanal/render-aba-alocacao.js');

function registroSintetico(sup, tipologia, previstoAgosto) {
  const volume = new Array(12).fill(0);
  volume[7] = previstoAgosto;
  return { sup, tomador: 'Tomador Teste', tipologia, previsto: { volume, equipesResumo: { prod: 2 } } };
}

function equipeSintetica(id, colunas) {
  return { id, lider: 'Líder ' + id, colunas, disponivel: true, diasDisponiveis: 5, diasDaSemana: 5, companheiros: [], polivalente: colunas.length > 1 };
}

test('prepararDadosAlocacao devolve null quando semRoster', () => {
  const resultado = prepararDadosAlocacao([], [], { semRoster: true });
  assert.strictEqual(resultado, null);
});

test('prepararDadosAlocacao devolve grade/resumo/equipes coerentes com uma equipe alocada', () => {
  const registros = [registroSintetico('SUP-A', 'SP', 100)];
  const opcoes = {
    mesIdx: 7, semanas: [{ inicio: 100, fim: 106 }], semana: { inicio: 100, fim: 106 },
    demandas: { porRegistroEventos: {} }, hojeEpoch: 100,
    equipes: [equipeSintetica('4', ['SP'])],
    alocacao: { 4: { sup: 'SUP-A', coluna: 'SP' } },
  };
  const dados = prepararDadosAlocacao(registros, [0], opcoes);
  assert.ok(dados);
  assert.strictEqual(dados.grade.linhas.length, 1);
  assert.strictEqual(dados.grade.linhas[0].sup, 'SUP-A');
  assert.strictEqual(dados.equipesPorId['4'].id, '4');
  assert.strictEqual(dados.resumo.porSup[0].sup, 'SUP-A');
  assert.strictEqual(dados.porEquipeMap['4'].sup, 'SUP-A');
});
