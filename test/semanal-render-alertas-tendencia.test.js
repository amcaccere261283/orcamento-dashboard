'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderCorpoAlertasTendencia, renderCabecalhoAlertasTendencia } = require('../tools/semanal/render-alertas-tendencia.js');
const { semanasDoMes, diaEpoch } = require('../tools/semanal/compute-semanal.js');

const SEMANAS = semanasDoMes(2026, 6);
const HOJE = diaEpoch(new Date(Date.UTC(2026, 6, 15)));
const dia = (d) => diaEpoch(new Date(Date.UTC(2026, 6, d)));

function registro(sup, volumeMes, equipes, prod) {
  const mensal = new Array(12).fill(0);
  mensal[6] = volumeMes;
  const eq = new Array(12).fill(0);
  eq[6] = equipes;
  return {
    sup: sup, tipologia: 'SP.P', tomador: 'T1', grupo: 'G1', origem: 'O1',
    previsto: { volume: mensal, financeiro: new Array(12).fill(0), equipes: eq, equipesResumo: { prod: prod }, volumeResumo: { ticket: 100 } },
  };
}

// A chave de demandas é sempre `<sup>||<tipologia>` (ver chaveDemandas em
// render-aba-semanal.js) -- com a tipologia 'SP.P' fixada acima, muda só o SUP.
function demandasDe(sup, chegadas, realizadas) {
  const eventos = { chegada: chegadas, sondagemRealizada: realizadas, saidaEstoque: realizadas };
  const porRegistroEventos = {};
  porRegistroEventos[sup + '||SP.P'] = eventos;
  return { porRegistroEventos: porRegistroEventos };
}

test('cabecalho traz as sete colunas do bloco', () => {
  const html = renderCabecalhoAlertasTendencia('SUP');
  ['SUP', 'Tomador', 'Alerta', 'Realizado acum.', 'Previsto acum.', 'Evidência', 'Status']
    .forEach((c) => assert.ok(html.indexOf(c) !== -1, 'falta a coluna ' + c));
});

test('dimensao diferente de volume nao monta tabela, explica por que', () => {
  const html = renderCorpoAlertasTendencia([registro('A', 100, 1, 1)], [0], {
    agruparPor: 'sup', dimensao: 'financeiro', mesIdx: 6, semanas: SEMANAS, demandas: demandasDe('A', [], []), hojeEpoch: HOJE,
  });
  assert.ok(/Volume/.test(html), 'a nota tem de dizer que o bloco so vale em Volume');
  assert.ok(html.indexOf('<tr') === -1, 'nenhuma linha de alerta fora de Volume');
});

test('grupo sem alerta nenhum nao vira linha', () => {
  // Realizado batendo o previsto -> ramo igual -> nenhum alerta.
  const chegadas = []; const realizadas = [];
  for (let d = 1; d <= 12; d++) { chegadas.push(dia(d)); realizadas.push(dia(d)); }
  const html = renderCorpoAlertasTendencia([registro('A', 31, 1, 1)], [0], {
    agruparPor: 'sup', dimensao: 'volume', mesIdx: 6, semanas: SEMANAS,
    demandas: demandasDe('A', chegadas, realizadas),
    hojeEpoch: HOJE,
  });
  assert.ok(html.indexOf('Avaliar equipe e demanda') === -1);
  assert.ok(html.indexOf('Equipes com pouco recurso') === -1);
});

test('mes inteiramente no passado nao gera alerta nenhum', () => {
  const chegadas = [dia(1)]; const realizadas = [dia(1)];
  const html = renderCorpoAlertasTendencia([registro('A', 500, 1, 0.1)], [0], {
    agruparPor: 'sup', dimensao: 'volume', mesIdx: 6, semanas: SEMANAS,
    demandas: demandasDe('A', chegadas, realizadas),
    hojeEpoch: diaEpoch(new Date(Date.UTC(2026, 7, 20))),
  });
  assert.strictEqual(html.indexOf('<tr'), -1);
});

test('deficit grande com uma equipe improdutiva vira a linha de equipes', () => {
  // Previsto 500 no mes, quase nada realizado nas semanas fechadas, 1 equipe
  // com produtividade prevista de 0,1 furo/equipe-dia -> exigida >> esperada.
  const html = renderCorpoAlertasTendencia([registro('A', 500, 1, 0.1)], [0], {
    agruparPor: 'sup', dimensao: 'volume', mesIdx: 6, semanas: SEMANAS,
    demandas: demandasDe('A', [dia(1)], [dia(1)]),
    hojeEpoch: HOJE,
  });
  assert.ok(html.indexOf('Equipes com pouco recurso ou improdutividade') !== -1);
  assert.ok(/data-search=/.test(html), 'a linha precisa do data-search para a busca da aba');
});

test('sem demandas carregadas o bloco diz sem dado, nao "tudo certo"', () => {
  const html = renderCorpoAlertasTendencia([registro('A', 500, 1, 0.1)], [0], {
    agruparPor: 'sup', dimensao: 'volume', mesIdx: 6, semanas: SEMANAS, demandas: null, hojeEpoch: HOJE,
  });
  assert.ok(/Sem dado/.test(html));
});
