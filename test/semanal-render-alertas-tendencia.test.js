'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  renderCorpoAlertasTendencia, renderCabecalhoAlertasTendencia, premissaProdutividadeDoGrupo,
} = require('../tools/semanal/render-alertas-tendencia.js');
const { semanasDoMes, diaEpoch } = require('../tools/semanal/compute-semanal.js');

const SEMANAS = semanasDoMes(2026, 6);
const HOJE = diaEpoch(new Date(Date.UTC(2026, 6, 15)));
const dia = (d) => diaEpoch(new Date(Date.UTC(2026, 6, d)));

function registro(sup, volumeMes, equipes, prod, tipologia) {
  const mensal = new Array(12).fill(0);
  mensal[6] = volumeMes;
  const eq = new Array(12).fill(0);
  eq[6] = equipes;
  return {
    sup: sup, tipologia: tipologia || 'SP.P', tomador: 'T1', grupo: 'G1', origem: 'O1',
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
  // A nota em si é um <tr> (ver render-alertas-tendencia.js) -- o que não pode
  // existir aqui é uma LINHA DE ALERTA, que é sempre marcada com data-search.
  assert.strictEqual(html.indexOf('data-search='), -1, 'nenhuma linha de alerta fora de Volume');
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
  assert.ok(html.indexOf('Avaliar movimentação de equipe') === -1);
  assert.ok(html.indexOf('Equipes com pouco recurso') === -1);
});

test('mes inteiramente no passado nao gera alerta nenhum', () => {
  const chegadas = [dia(1)]; const realizadas = [dia(1)];
  const html = renderCorpoAlertasTendencia([registro('A', 500, 1, 0.1)], [0], {
    agruparPor: 'sup', dimensao: 'volume', mesIdx: 6, semanas: SEMANAS,
    demandas: demandasDe('A', chegadas, realizadas),
    hojeEpoch: diaEpoch(new Date(Date.UTC(2026, 7, 20))),
  });
  // Mês todo no passado -> nenhuma linha de alerta, marcada por data-search.
  assert.strictEqual(html.indexOf('data-search='), -1);
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

test('R>P com a semana vigente zerada gera a linha "Avaliar movimentacao de equipe"', () => {
  // Previsto do mes 62 -> semanas [10,14,14,14,10] (2/dia). S1+S2 previsto=24;
  // 30 furos realizados nelas (15 no dia 1, 15 no dia 6) -> ramo acima.
  // Nenhum furo realizado em S3 (13..19) ate hoje (15/07) -> a
  // vigente fica zerada e o alerta dispara.
  const realizadas = [];
  for (let i = 0; i < 15; i++) { realizadas.push(dia(1)); realizadas.push(dia(6)); }
  const html = renderCorpoAlertasTendencia([registro('A', 62, 1, 1)], [0], {
    agruparPor: 'sup', dimensao: 'volume', mesIdx: 6, semanas: SEMANAS,
    demandas: demandasDe('A', [], realizadas),
    hojeEpoch: HOJE,
  });
  assert.ok(html.indexOf('Avaliar movimentação de equipe') !== -1);
  assert.ok(/data-search=/.test(html), 'a linha precisa do data-search para a busca da aba');
  // Pina a evidência (ritmoAnterior, que atravessa compute-alertas-tendencia.js
  // -> render-alertas-tendencia.js): sem isto, um typo tipo 'alerta.ritmoPorDia'
  // (o nome usado do OUTRO lado dessa fronteira) renderizaria '—' e passaria
  // batido, porque formatarNumero(undefined) devolve '—' em vez de lançar.
  // Semanas fechadas S1+S2 = 5+7 = 12 dias; realizadoAcumulado = 30 furos
  // (15 no dia 1 + 15 no dia 6) -> ritmoPorDia = 30/12 = 2,5 -> "2,50".
  assert.ok(
    html.indexOf('Ritmo médio nas semanas fechadas 2,50 furos/dia · nenhum avanço registrado na semana em curso') !== -1,
    'a evidência precisa trazer o ritmo formatado, não so o rotulo'
  );
});

test('R>P com avanco na vigente, mesmo pequeno, nao alerta', () => {
  const realizadas = [];
  for (let i = 0; i < 15; i++) { realizadas.push(dia(1)); realizadas.push(dia(6)); }
  realizadas.push(dia(13)); // 1 furo na vigente, antes do corte de hoje-1 (14/07)
  const html = renderCorpoAlertasTendencia([registro('A', 62, 1, 1)], [0], {
    agruparPor: 'sup', dimensao: 'volume', mesIdx: 6, semanas: SEMANAS,
    demandas: demandasDe('A', [], realizadas),
    hojeEpoch: HOJE,
  });
  assert.strictEqual(html.indexOf('Avaliar movimentação de equipe'), -1);
  assert.strictEqual(html.indexOf('data-search='), -1, 'nenhum alerta dispara nesse grupo');
});

test('sem demandas carregadas o bloco diz sem dado, nao "tudo certo"', () => {
  const html = renderCorpoAlertasTendencia([registro('A', 500, 1, 0.1)], [0], {
    agruparPor: 'sup', dimensao: 'volume', mesIdx: 6, semanas: SEMANAS, demandas: null, hojeEpoch: HOJE,
  });
  assert.ok(/Sem dado/.test(html));
});

// --- Limpeza 7 da revisao final: o bypass de "sem base de demandas" nao pode
// falar nos meses onde nem com a base carregada haveria alerta.
test('sem demandas carregadas, mes fechado ou mes futuro nao emitem nem "Sem dado"', () => {
  const opcoesBase = { agruparPor: 'sup', dimensao: 'volume', mesIdx: 6, semanas: SEMANAS, demandas: null };
  const passado = renderCorpoAlertasTendencia([registro('A', 500, 1, 0.1)], [0],
    Object.assign({ hojeEpoch: diaEpoch(new Date(Date.UTC(2026, 7, 20))) }, opcoesBase));
  assert.strictEqual(passado, '', 'mes inteiramente no passado nao tem futuro a projetar');
  const futuro = renderCorpoAlertasTendencia([registro('A', 500, 1, 0.1)], [0],
    Object.assign({ hojeEpoch: diaEpoch(new Date(Date.UTC(2026, 5, 10))) }, opcoesBase));
  assert.strictEqual(futuro, '', 'mes inteiramente no futuro nao tem passado a julgar');
});

// --- Correcao 1 da revisao final: a referencia do Alerta B e a premissa PROD.
// da planilha, ponderada pelo volume previsto -- nao a razao V/(E*D)
// recalculada, em que o E se cancelava com o E da produtividade exigida.
test('a premissa do grupo e a media das PROD. ponderada pelo volume previsto do mes', () => {
  const registros = [
    registro('A', 300, 5, 2, 'SP.P'),
    registro('A', 100, 9, 6, 'SP.C'),
  ];
  // (300*2 + 100*6) / (300+100) = 1200/400 = 3. Nada disso olha 'equipes'.
  assert.ok(Math.abs(premissaProdutividadeDoGrupo(registros, [0, 1], 6) - 3) < 1e-9);
  // Com um registro so, devolve o proprio prod dele -- sem caso especial.
  assert.strictEqual(premissaProdutividadeDoGrupo(registros, [1], 6), 6);
});

test('registro sem PROD. ou com volume zero fica fora dos dois somatorios', () => {
  const semProd = registro('A', 999, 1, null, 'SP.C');
  const volumeZero = registro('A', 0, 1, 42, 'SP.M');
  const bom = registro('A', 200, 1, 1.5, 'SP.P');
  assert.strictEqual(premissaProdutividadeDoGrupo([semProd, volumeZero, bom], [0, 1, 2], 6), 1.5);
  // Ninguem contribui -> null, que o avaliador transforma em 'sem-dado'.
  assert.strictEqual(premissaProdutividadeDoGrupo([semProd, volumeZero], [0, 1], 6), null);
});

// A REGRESSAO que motivou a correcao: com a razao recalculada, os dois lados da
// comparacao dividiam pelo MESMO 'equipes x dias', ele se cancelava, e o alerta
// que promete responder "as equipes previstas dao conta do saldo?" disparava
// igual com 2 ou com 200.000 equipes previstas.
test('mudar SO o numero de equipes previstas muda o resultado do Alerta B', () => {
  // Duas tipologias no mesmo SUP -> grupo AGREGADO (era so no agregado que a
  // formula degenerava; com um registro so a premissa da planilha ja era usada).
  const comEquipes = (e) => [
    registro('A', 250, e, 0.1, 'SP.P'),
    registro('A', 250, e, 0.1, 'SP.C'),
  ];
  const demandas = { porRegistroEventos: { 'A||SP.P': { chegada: [dia(1)], sondagemRealizada: [dia(1)], saidaEstoque: [dia(1)] } } };
  const opcoes = (registros) => [registros, [0, 1], {
    agruparPor: 'sup', dimensao: 'volume', mesIdx: 6, semanas: SEMANAS, demandas: demandas, hojeEpoch: HOJE,
  }];

  const poucas = renderCorpoAlertasTendencia(...opcoes(comEquipes(1)));
  assert.ok(poucas.indexOf('Equipes com pouco recurso ou improdutividade') !== -1,
    '2 equipes previstas para um saldo de ~499 furos nao dao conta: tem de alertar');

  const muitas = renderCorpoAlertasTendencia(...opcoes(comEquipes(100000)));
  assert.strictEqual(muitas.indexOf('Equipes com pouco recurso ou improdutividade'), -1,
    '200.000 equipes previstas dao conta de sobra: nao pode alertar');
  assert.strictEqual(muitas.indexOf('data-search='), -1, 'e nao pode sobrar nenhuma linha');
});
