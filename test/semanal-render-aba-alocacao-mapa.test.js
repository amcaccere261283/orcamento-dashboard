'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderAbaAlocacaoMapa } = require('../tools/semanal/render-aba-alocacao-mapa.js');
const { prepararDadosAlocacao } = require('../tools/semanal/render-aba-alocacao.js');

function registroSintetico(sup, tipologia, previstoAgosto) {
  const volume = new Array(12).fill(0);
  volume[7] = previstoAgosto;
  return { sup, tomador: 'Tomador Teste', tipologia, previsto: { volume, equipesResumo: { prod: 2 } } };
}

test('semRoster: mostra a guarda, sem container de mapa', () => {
  const html = renderAbaAlocacaoMapa(null, { semRoster: true });
  assert.match(html, /alocacao-guarda-erro/);
  assert.doesNotMatch(html, /mapa-alocacao-canvas/);
});

test('com dados: tem o container do mapa, o painel "sem localização" e reaproveita o pool', () => {
  const registros = [registroSintetico('SUP-A', 'SP', 100)];
  const opcoes = {
    mesIdx: 7, semanas: [{ inicio: 100, fim: 106 }], semana: { inicio: 100, fim: 106 },
    demandas: { porRegistroEventos: { 'SUP-A||SP': { chegada: [], sondagemRealizada: [], saidaEstoque: [] } } }, hojeEpoch: 100,
    equipes: [{ id: '4', lider: 'Amaral', servicos: 'SP', colunas: ['SP'], disponivel: true, diasDisponiveis: 5, diasDaSemana: 5, companheiros: [], polivalente: false, supRealizado: null, colunaRealizada: null }],
    alocacao: {}, foraDoQuadro: [], buscaEquipe: '', tipologiaAlocacao: '',
    modoPersistencia: 'local', pendentes: 0,
  };
  const dados = prepararDadosAlocacao(registros, [0], opcoes);
  const html = renderAbaAlocacaoMapa(dados, opcoes);
  assert.match(html, /id="mapa-alocacao-canvas"/);
  assert.match(html, /id="mapa-alocacao-sem-localizacao"/);
  assert.match(html, /pool-alocacao/); // renderPool reaproveitado
  assert.match(html, /faixa-alocacao/); // renderFaixaAlocacao reaproveitado
  assert.match(html, /data-equipe="4"/); // cartão de equipe existe (mesmo cartão do Kanban)
});

test('com dados: tem o bloco do seletor de rodovias, com o trigger do filtro-multi', () => {
  const registros = [registroSintetico('SUP-A', 'SP', 100)];
  const opcoes = {
    mesIdx: 7, semanas: [{ inicio: 100, fim: 106 }], semana: { inicio: 100, fim: 106 },
    demandas: { porRegistroEventos: {} }, hojeEpoch: 100,
    equipes: [{ id: '4', lider: 'Amaral', colunas: ['SP'], disponivel: true, diasDisponiveis: 5, diasDaSemana: 5, companheiros: [] }],
    alocacao: {}, foraDoQuadro: [], buscaEquipe: '', tipologiaAlocacao: '',
    modoPersistencia: 'local', pendentes: 0,
  };
  const dados = prepararDadosAlocacao(registros, [0], opcoes);
  const html = renderAbaAlocacaoMapa(dados, opcoes);
  assert.match(html, /id="mapa-alocacao-rodovias"/);
  assert.match(html, /id="filtro-rodovias"/, 'o filtro-multi do seletor de rodovias existe');
  assert.match(html, /class="filtro-multi-trigger"/);
});

test('semRoster: o bloco de rodovias NÃO aparece (mesma guarda do resto da aba)', () => {
  const html = renderAbaAlocacaoMapa(null, { semRoster: true });
  assert.doesNotMatch(html, /id="mapa-alocacao-rodovias"/);
});
