'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  renderAbaConsolidado, renderControles, renderCabecalho, colunasExtras,
  produtividadeEsperada, ticketMedioPrevisto, somarPrevistoMes,
  blocosPorSup, tipologiasPresentes,
} = require('../tools/semanal/render-aba-consolidado.js');
const { semanasDoMes, diaEpoch } = require('../tools/semanal/compute-semanal.js');
const { DIAS_PREMISSA_MES } = require('../tools/comum/calculo-equipes.js');

const ANO = 2026;
const JULHO = 6; // 5 semanas reais, [5,7,7,7,5] dias de 31
const SEMANAS = semanasDoMes(ANO, JULHO);

function diaJul(dia) { return diaEpoch(new Date(Date.UTC(ANO, JULHO, dia))); }

function registro({ sup, tipologia = 'ST', grupo = 'Grupo-A', tomador = 'Tomador-A', volume = 0, financeiro = 0, equipes = 0, prod = null, ticket = null }) {
  const zeros = () => new Array(12).fill(0);
  const mk = (v) => { const a = zeros(); a[JULHO] = v; return a; };
  return {
    sup, tipologia, grupo, tomador, origem: 'CONTRATO VIGENTE',
    previsto: {
      volume: mk(volume), financeiro: mk(financeiro), equipes: mk(equipes),
      equipesResumo: { prod }, volumeResumo: { ticket },
    },
    realizado: { volume: zeros(), financeiro: zeros(), equipes: zeros(), equipesResumo: {}, volumeResumo: {} },
    total: { volume: zeros(), financeiro: zeros(), equipes: zeros(), equipesResumo: {}, volumeResumo: {} },
  };
}

function demandasCom(eventosPorChave) {
  const porRegistroEventos = {};
  Object.keys(eventosPorChave).forEach((chave) => {
    porRegistroEventos[chave] = { chegada: [], saidaEstoque: [], sondagemRealizada: eventosPorChave[chave] };
  });
  return { porRegistroEventos };
}

function opcoes(extra) {
  return Object.assign({
    semanaIdx: 0, dimensao: 'volume', mesIdx: JULHO, semanas: SEMANAS,
    demandas: demandasCom({}), hojeEpoch: diaJul(31),
  }, extra || {});
}

function linhasDe(html) {
  return (html.match(/<tr class="[^"]*">[\s\S]*?<\/tr>/g) || []);
}

function celulasDe(linha) {
  return (linha.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || []).map((td) => td.replace(/<[^>]*>/g, ''));
}

// --- Abertura de linhas: a hierarquia da Tabela do orçamento --------------

test('a tabela abre nas mesmas 4 aberturas do orçamento: TOTAL GERAL, total por tipologia, cada registro do SUP e o TOTAL do SUP', () => {
  const registros = [
    registro({ sup: 'SUP-A', tipologia: 'ST', volume: 310 }),
    registro({ sup: 'SUP-A', tipologia: 'PI', volume: 62 }),
    registro({ sup: 'SUP-B', tipologia: 'ST', volume: 155 }),
  ];
  const html = renderAbaConsolidado(registros, [0, 1, 2], opcoes());
  const rotulos = linhasDe(html).map((l) => celulasDe(l).slice(0, 4).join('|'));
  assert.deepStrictEqual(rotulos, [
    '—|Todos|Todos|TOTAL GERAL',
    '—|Todos|Todos|PI',            // totais por tipologia, alfabéticos
    '—|Todos|Todos|ST',
    'SUP-A|Grupo-A|Tomador-A|ST',  // registros do SUP-A, na ordem da MATRIZ
    'SUP-A|Grupo-A|Tomador-A|PI',
    'SUP-A|Grupo-A|Tomador-A|TOTAL',
    'SUP-B|Grupo-A|Tomador-A|ST',
    'SUP-B|Grupo-A|Tomador-A|TOTAL',
  ]);
});

test('blocosPorSup preserva a ordem em que os SUPs aparecem na MATRIZ; tipologiasPresentes ordena alfabeticamente', () => {
  const registros = [registro({ sup: 'SUP-Z', tipologia: 'ST' }), registro({ sup: 'SUP-A', tipologia: 'BL' })];
  assert.deepStrictEqual(blocosPorSup(registros, [0, 1]).map((b) => b.sup), ['SUP-Z', 'SUP-A']);
  assert.deepStrictEqual(tipologiasPresentes(registros, [0, 1]).map((b) => b.tipologia), ['BL', 'ST']);
});

test('as linhas de total carregam as MESMAS classes que o CSS compartilhado já estiliza no orçamento', () => {
  const registros = [registro({ sup: 'SUP-A', volume: 310 })];
  const html = renderAbaConsolidado(registros, [0], opcoes());
  assert.match(html, /<tr class="linha-total-geral">/);
  assert.match(html, /<tr class="linha-total-geral linha-total-geral-tipologia">/);
  assert.match(html, /<tr class="linha-total-sup">/);
  assert.match(html, /tipologia-chip-total chip-total-geral/);
});

// --- Só a semana selecionada -----------------------------------------------

test('as colunas Previsto/Realizado/Tendência são da SEMANA escolhida, não do mês', () => {
  // 310 furos em 31 dias = 10/dia. S1 tem 5 dias -> 50; S2 tem 7 -> 70.
  const registros = [registro({ sup: 'SUP-A', volume: 310 })];
  const html = (semanaIdx) => renderAbaConsolidado(registros, [0], opcoes({ semanaIdx }));
  const previstoDe = (h) => celulasDe(linhasDe(h)[0])[4];
  assert.strictEqual(previstoDe(html(0)), '50');
  assert.strictEqual(previstoDe(html(1)), '70');
});

test('o Realizado da semana conta só os furos concluídos DENTRO dela', () => {
  const registros = [registro({ sup: 'SUP-A', tipologia: 'ST', volume: 310 })];
  const eventos = [diaJul(2), diaJul(3), diaJul(4), diaJul(20)]; // 3 em S1, 1 em S3
  const html = renderAbaConsolidado(registros, [0], opcoes({
    semanaIdx: 0, demandas: demandasCom({ 'SUP-A||ST': eventos }),
  }));
  assert.strictEqual(celulasDe(linhasDe(html)[0])[5], '3');
});

test('o seletor de semana lista S1..Sn com as datas reais e marca a escolhida', () => {
  const html = renderControles({ semanas: SEMANAS, semanaIdx: 2, dimensao: 'volume' });
  assert.match(html, /<option value="0">S1 \(01\/07 a 05\/07\)<\/option>/);
  assert.match(html, /<option value="2" selected>S3 \(13\/07 a 19\/07\)<\/option>/);
  assert.strictEqual((html.match(/<option value="\d"/g) || []).length, 5);
});

test('semanaIdx fora da faixa é clampado em vez de produzir coluna vazia', () => {
  const registros = [registro({ sup: 'SUP-A', volume: 310 })];
  const html = renderAbaConsolidado(registros, [0], opcoes({ semanaIdx: 99 }));
  assert.strictEqual(celulasDe(linhasDe(html)[0])[4], '50', 'clampa na última semana (S5, 5 dias)');
});

// --- Volume x Financeiro: nunca misturados ---------------------------------

test('em Volume as colunas extras são Equipes previstas e Produtividade média esperada -- ticket não aparece', () => {
  assert.deepStrictEqual(colunasExtras('volume').map((c) => c.chave), ['equipes', 'produtividade']);
  const html = renderCabecalho('volume', SEMANAS[0]);
  assert.match(html, /<th class="num">Equipes previstas<\/th>/);
  assert.match(html, /<th class="num">Produtividade média esperada<\/th>/);
  assert.doesNotMatch(html, /Ticket/);
});

test('em Financeiro a única coluna extra é o Ticket médio -- equipes e produtividade não aparecem', () => {
  assert.deepStrictEqual(colunasExtras('financeiro').map((c) => c.chave), ['ticket']);
  const html = renderCabecalho('financeiro', SEMANAS[0]);
  assert.match(html, /<th class="num">Ticket médio previsto \(R\$\/furo\)<\/th>/);
  assert.doesNotMatch(html, /Equipes previstas/);
  assert.doesNotMatch(html, /Produtividade/);
});

test('o cabeçalho carrega o intervalo de datas da semana nas 3 colunas de série', () => {
  const html = renderCabecalho('volume', SEMANAS[0]);
  assert.match(html, /Previsto \(01\/07 a 05\/07\)/);
  assert.match(html, /Realizado \(01\/07 a 05\/07\)/);
  assert.match(html, /Tendência \(01\/07 a 05\/07\)/);
});

test('a nota da aba diz, na tela, que as premissas são do mês e as séries são da semana', () => {
  const registros = [registro({ sup: 'SUP-A', volume: 310 })];
  assert.match(renderAbaConsolidado(registros, [0], opcoes()), /Equipes previstas são a foto do mês|equipes previstas são a foto do mês/i);
  assert.match(renderAbaConsolidado(registros, [0], opcoes({ dimensao: 'financeiro' })), /ticket médio previsto é a premissa TICKET/i);
});

// --- As premissas: mesma regra de dois ramos do orçamento ------------------

test('equipes previstas somam através dos registros do grupo (times simultâneos se somam) e não se repartem por semana', () => {
  const registros = [registro({ sup: 'SUP-A', equipes: 2 }), registro({ sup: 'SUP-B', equipes: 3 })];
  assert.strictEqual(somarPrevistoMes(registros, [0, 1], 'equipes', JULHO), 5);
  const html = (semanaIdx) => renderAbaConsolidado(registros, [0, 1], opcoes({ semanaIdx }));
  const equipesDe = (h) => celulasDe(linhasDe(h)[0])[7];
  assert.strictEqual(equipesDe(html(0)), '5,00');
  assert.strictEqual(equipesDe(html(3)), '5,00', 'a foto do mês é a mesma em qualquer semana');
});

test('produtividade de UM registro é a premissa PROD. da planilha, lida direto', () => {
  const registros = [registro({ sup: 'SUP-A', volume: 310, equipes: 2, prod: 8.5 })];
  assert.strictEqual(produtividadeEsperada(registros, [0], JULHO), 8.5);
});

test('produtividade de um AGREGADO recalcula volume ÷ (equipes x dias-premissa) -- a média das premissas não é a premissa da soma', () => {
  const registros = [
    registro({ sup: 'SUP-A', volume: 600, equipes: 1, prod: 20 }),
    registro({ sup: 'SUP-B', volume: 600, equipes: 3, prod: 6.67 }),
  ];
  const esperado = 1200 / (4 * DIAS_PREMISSA_MES[JULHO]);
  assert.ok(Math.abs(produtividadeEsperada(registros, [0, 1], JULHO) - esperado) < 1e-9);
  assert.strictEqual(DIAS_PREMISSA_MES[JULHO], 30, 'pré-condição: julho usa a premissa de 30 dias, não os 31 do calendário');
});

test('ticket de UM registro é a premissa TICKET; de um agregado, financeiro ÷ volume', () => {
  const registros = [
    registro({ sup: 'SUP-A', volume: 100, financeiro: 50000, ticket: 500 }),
    registro({ sup: 'SUP-B', volume: 100, financeiro: 30000, ticket: 300 }),
  ];
  assert.strictEqual(ticketMedioPrevisto(registros, [0], JULHO), 500);
  assert.strictEqual(ticketMedioPrevisto(registros, [0, 1], JULHO), 400); // 80000 / 200
});

test('premissa ausente vira "—", nunca zero -- sem PROD./TICKET cadastrado não há premissa a mostrar', () => {
  const registros = [registro({ sup: 'SUP-A', volume: 310, equipes: 2 })]; // prod/ticket null
  assert.strictEqual(produtividadeEsperada(registros, [0], JULHO), null);
  assert.strictEqual(ticketMedioPrevisto(registros, [0], JULHO), null);
  assert.match(renderAbaConsolidado(registros, [0], opcoes()), /<td class="num celula-premissa">—<\/td>/);
});

test('agregado sem equipes lançadas não vira divisão por zero -- devolve sem dado', () => {
  const registros = [registro({ sup: 'SUP-A', volume: 310 }), registro({ sup: 'SUP-B', volume: 310 })];
  assert.strictEqual(produtividadeEsperada(registros, [0, 1], JULHO), null);
});

// --- Bordas ----------------------------------------------------------------

test('mês sem semanas devolve os controles e um aviso, em vez de uma tabela vazia sem explicação', () => {
  const html = renderAbaConsolidado([], [], opcoes({ semanas: [] }));
  assert.match(html, /nada a consolidar/);
  assert.doesNotMatch(html, /<table/);
});

test('recorte vazio (todos os registros filtrados fora) rende só o TOTAL GERAL, sem quebrar', () => {
  const html = renderAbaConsolidado([registro({ sup: 'SUP-A', volume: 310 })], [], opcoes());
  assert.strictEqual(linhasDe(html).length, 1);
  assert.match(html, /TOTAL GERAL/);
});
