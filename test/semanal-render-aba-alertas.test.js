'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  renderCorpoAlertas, renderCabecalhoAlertas, classificarSemaforo, colunasAlertas,
  agruparIndicesAlertas, tomadorDoGrupo, periodosDisponiveis, janelaDoPeriodo,
  agregarFatias, semanasElapsadas, indexarBaseline,
  PERIODO_ACUMULADO, PERIODO_MES,
} = require('../tools/semanal/render-aba-alertas.js');
const { semanasDoMes, diaEpoch } = require('../tools/semanal/compute-semanal.js');

const ANO = 2026;
const JULHO = 6; // 5 semanas reais: [5,7,7,7,5] dias
const SEMANAS_JULHO = semanasDoMes(ANO, JULHO);

function diaJul(dia) { return diaEpoch(new Date(Date.UTC(ANO, JULHO, dia))); }

function registro({ sup, tipologia = 'ST', grupo = 'Grupo-A', tomador = 'Tomador-A', origem = 'CONTRATO VIGENTE', previstoVol = 0, ticket = 1 }) {
  const zeros = () => new Array(12).fill(0);
  const vol = zeros(); vol[JULHO] = previstoVol;
  const bloco = (volume) => ({
    equipes: zeros(), volume, financeiro: zeros(),
    equipesResumo: { prod: 8 }, volumeResumo: { ticket },
  });
  return {
    sup, tipologia, grupo, tomador, origem,
    previsto: bloco(vol), realizado: bloco(zeros()), total: bloco(zeros()),
  };
}

function demandasCom(eventosPorChave) {
  const porRegistroEventos = {};
  Object.keys(eventosPorChave).forEach((chave) => {
    porRegistroEventos[chave] = {
      chegada: [], saidaEstoque: [], sondagemRealizada: eventosPorChave[chave],
    };
  });
  return { porRegistroEventos };
}

// --- Semáforo: cópia literal do orçamento, é o pedido ("mesmo status") ----

test('o semáforo tem as mesmas 5 faixas, hex e rótulos do orçamento', () => {
  assert.deepStrictEqual(classificarSemaforo(1.2), { cor: '#1414CC', indicador: 'Excelente' });
  assert.deepStrictEqual(classificarSemaforo(1.10), { cor: '#128A3E', indicador: 'Dentro da meta' });
  assert.deepStrictEqual(classificarSemaforo(0.90), { cor: '#128A3E', indicador: 'Dentro da meta' });
  assert.deepStrictEqual(classificarSemaforo(0.8999), { cor: '#F5A700', indicador: 'Atenção' });
  assert.deepStrictEqual(classificarSemaforo(0.70), { cor: '#F5A700', indicador: 'Atenção' });
  assert.deepStrictEqual(classificarSemaforo(0.6999), { cor: '#D32020', indicador: 'Crítico' });
  assert.deepStrictEqual(classificarSemaforo(null), { cor: '#6E7580', indicador: 'Sem dado' });
});

// --- Períodos semanais (a única mudança de lógica em relação ao orçamento) --

test('as opções de período são as semanas REAIS do mês, com o intervalo de datas, mais os dois acumulados', () => {
  const opcoes = periodosDisponiveis(SEMANAS_JULHO);
  assert.deepStrictEqual(opcoes.map((o) => o.valor), ['s1', 's2', 's3', 's4', 's5', PERIODO_ACUMULADO, PERIODO_MES]);
  assert.strictEqual(opcoes[0].rotulo, 'S1 (01/07 a 05/07)');
  assert.strictEqual(opcoes[6].rotulo, 'Mês inteiro');
});

test('agosto de 2026 tem 6 semanas -- a lista de períodos acompanha o mês, não é fixa', () => {
  assert.strictEqual(periodosDisponiveis(semanasDoMes(ANO, 7)).length, 8); // 6 semanas + 2 acumulados
});

test('janelaDoPeriodo: "s3" é só a terceira semana; o mês inteiro é todas', () => {
  assert.deepStrictEqual(janelaDoPeriodo('s3', 5, 3), [2, 3]);
  assert.deepStrictEqual(janelaDoPeriodo(PERIODO_MES, 5, 3), [0, 5]);
});

test('janelaDoPeriodo: o acumulado vai até a semana em curso, inclusive', () => {
  assert.deepStrictEqual(janelaDoPeriodo(PERIODO_ACUMULADO, 5, 3), [0, 3]);
});

test('janelaDoPeriodo: num mês que ainda não começou o acumulado é janela VAZIA (vira "Sem dado"), nunca o mês inteiro', () => {
  assert.deepStrictEqual(janelaDoPeriodo(PERIODO_ACUMULADO, 5, 0), [0, 0]);
  assert.strictEqual(agregarFatias([10, 10, 10, 10, 10], 'volume', [0, 0]), null);
});

test('janelaDoPeriodo: um "s6" que sobrou de um mês de 6 semanas devolve null num mês de 5 -- coluna sem dado, nunca o mês todo por engano', () => {
  assert.strictEqual(janelaDoPeriodo('s6', 5, 5), null);
  assert.strictEqual(agregarFatias([10, 10, 10, 10, 10], 'volume', null), null);
});

test('semanasElapsadas conta as semanas que já começaram: todas num mês passado, nenhuma num mês futuro', () => {
  assert.strictEqual(semanasElapsadas(SEMANAS_JULHO, diaJul(15)), 3, '15/07 está na 3ª semana');
  assert.strictEqual(semanasElapsadas(SEMANAS_JULHO, diaEpoch(new Date(Date.UTC(ANO, 11, 31)))), 5);
  assert.strictEqual(semanasElapsadas(SEMANAS_JULHO, diaEpoch(new Date(Date.UTC(ANO, 0, 1)))), 0);
});

// --- Agregação: soma pra fluxo, média pra equipes ------------------------

test('agregarFatias soma volume/financeiro e tira a MÉDIA de equipes -- equipes é foto, não fluxo', () => {
  assert.strictEqual(agregarFatias([10, 20, 30, 0, 0], 'volume', [0, 3]), 60);
  assert.strictEqual(agregarFatias([2, 2, 2, 2, 2], 'equipes', [0, 3]), 2);
});

test('agregarFatias devolve null quando a janela inteira está sem dado -- "não reportado" nunca vira zero', () => {
  assert.strictEqual(agregarFatias([null, null, null], 'volume', [0, 3]), null);
});

// --- Colunas: ordem canônica, nunca a ordem em que a pessoa marcou --------

test('as colunas saem em Período -> Numérico -> Baseline, na ordem canônica', () => {
  const rotulos = { s1: 'S1', [PERIODO_MES]: 'Mês inteiro' };
  const colunas = colunasAlertas(['total', 'realizado'], ['previstoInicial', 'previsto'], ['s1', PERIODO_MES], rotulos);
  assert.deepStrictEqual(colunas.map((c) => c.rotulo), [
    'Realizado ÷ Previsto — S1',
    'Realizado ÷ Previsto Inicial — S1',
    'Tendência ÷ Previsto — S1',
    'Tendência ÷ Previsto Inicial — S1',
    'Realizado ÷ Previsto — Mês inteiro',
    'Realizado ÷ Previsto Inicial — Mês inteiro',
    'Tendência ÷ Previsto — Mês inteiro',
    'Tendência ÷ Previsto Inicial — Mês inteiro',
  ]);
});

// --- Agrupamento -----------------------------------------------------------

test('agrupa por qualquer um dos 5 campos, em ordem alfabética de chave, somando TODOS os índices do grupo', () => {
  const registros = [
    registro({ sup: 'SUP-2', tipologia: 'ST' }),
    registro({ sup: 'SUP-1', tipologia: 'CPTU' }),
    registro({ sup: 'SUP-1', tipologia: 'ST' }),
  ];
  assert.deepStrictEqual(
    agruparIndicesAlertas(registros, [0, 1, 2], 'sup').map((g) => [g.chave, g.indices]),
    [['SUP-1', [1, 2]], ['SUP-2', [0]]]
  );
  // categoria é derivada da tipologia, nunca guardada no registro -- mesma
  // regra do filtro de categoria da barra.
  assert.deepStrictEqual(
    agruparIndicesAlertas(registros, [0, 1, 2], 'categoria').map((g) => g.chave),
    ['sondagemConvencional', 'sondagemEspecial']
  );
});

test('o tomador do grupo vira "Vários" quando o grupo cruza mais de um', () => {
  const registros = [registro({ sup: 'A', tomador: 'T1' }), registro({ sup: 'B', tomador: 'T2' })];
  assert.strictEqual(tomadorDoGrupo(registros, [0]), 'T1');
  assert.strictEqual(tomadorDoGrupo(registros, [0, 1]), 'Vários');
  assert.strictEqual(tomadorDoGrupo(registros, []), '—');
});

// --- Corpo da tabela: os números batem com a Tabela Semanal ---------------

test('a célula é Realizado da semana ÷ Previsto da semana, com o status do semáforo', () => {
  // Previsto do mês 310 furos -> 310/31 dias = 10/dia -> S1 (5 dias) = 50.
  // 45 furos concluídos dentro de S1 => 45/50 = 90% => "Dentro da meta".
  const registros = [registro({ sup: 'SUP-0001-24', previstoVol: 310 })];
  const eventos = [];
  for (let i = 0; i < 45; i++) eventos.push(diaJul(1 + (i % 5)));
  const html = renderCorpoAlertas(registros, [0], {
    agruparPor: 'sup', dimensao: 'volume',
    numericos: ['realizado'], baselines: ['previsto'], periodos: ['s1'],
    mesIdx: JULHO, semanas: SEMANAS_JULHO,
    demandas: demandasCom({ 'SUP-0001-24||ST': eventos }),
    hojeEpoch: diaJul(31), baseline: [],
  });
  const linhaSup = html.match(/<tr data-search="[^"]*sup-0001-24[^"]*">[\s\S]*?<\/tr>/)[0];
  assert.match(linhaSup, /<td class="num">50<\/td>/, 'Referência = Previsto da S1');
  assert.match(linhaSup, /<td class="num">45<\/td>/, 'Pesquisado = Realizado da S1');
  assert.match(linhaSup, /<td class="num">90%<\/td>/);
  assert.match(linhaSup, /background:#128A3E"><\/span>Dentro da meta/);
});

test('a linha TOTAL GERAL soma todos os índices, mesmo agrupando por SUP', () => {
  const registros = [
    registro({ sup: 'SUP-A', previstoVol: 310 }),
    registro({ sup: 'SUP-B', previstoVol: 310 }),
  ];
  const html = renderCorpoAlertas(registros, [0, 1], {
    agruparPor: 'sup', dimensao: 'volume',
    numericos: ['realizado'], baselines: ['previsto'], periodos: [PERIODO_MES],
    mesIdx: JULHO, semanas: SEMANAS_JULHO,
    demandas: demandasCom({}), hojeEpoch: diaJul(31), baseline: [],
  });
  const linhaTotal = html.match(/<tr data-search="[^"]*total geral[^"]*">[\s\S]*?<\/tr>/)[0];
  assert.match(linhaTotal, /<td class="num">620<\/td>/, '310 + 310 previstos no mês inteiro');
});

test('o filtro de Status esconde a linha inteira quando o status calculado não bate; vazio mostra tudo', () => {
  const registros = [registro({ sup: 'SUP-0001-24', previstoVol: 310 })];
  const base = {
    agruparPor: 'sup', dimensao: 'volume',
    numericos: ['realizado'], baselines: ['previsto'], periodos: [PERIODO_MES],
    mesIdx: JULHO, semanas: SEMANAS_JULHO,
    demandas: demandasCom({ 'SUP-0001-24||ST': [] }), // zero realizado => Crítico
    hojeEpoch: diaJul(31), baseline: [],
  };
  assert.match(renderCorpoAlertas(registros, [0], base), /Crítico/);
  assert.match(renderCorpoAlertas(registros, [0], Object.assign({}, base, { statusFiltro: ['Crítico'] })), /Crítico/);
  assert.strictEqual(renderCorpoAlertas(registros, [0], Object.assign({}, base, { statusFiltro: ['Excelente'] })), '');
});

test('base "Previsto Inicial" sai da linha de base repartida nas mesmas semanas, e some (sem dado) quando o SUP não tem chave lá', () => {
  const registros = [registro({ sup: 'SUP-0001-24', previstoVol: 310 })];
  const baseMes = new Array(12).fill(0); baseMes[JULHO] = 620;
  const comum = {
    agruparPor: 'sup', dimensao: 'volume',
    numericos: ['realizado'], baselines: ['previstoInicial'], periodos: [PERIODO_MES],
    mesIdx: JULHO, semanas: SEMANAS_JULHO,
    demandas: demandasCom({ 'SUP-0001-24||ST': [diaJul(2)] }),
    hojeEpoch: diaJul(31),
  };
  const comBase = renderCorpoAlertas(registros, [0], Object.assign({}, comum, {
    baseline: [{ chave: 'SUP-0001-24||ST', volume: baseMes, equipes: new Array(12).fill(0), financeiro: new Array(12).fill(0) }],
  }));
  assert.match(comBase, /<td class="num">620<\/td>/, 'Referência = Previsto Inicial do mês');

  const semBase = renderCorpoAlertas(registros, [0], Object.assign({}, comum, { baseline: [] }));
  assert.match(semBase, /Sem dado/, 'sem chave na linha de base a célula fica sem dado, nunca 0%');
});

test('indexarBaseline ignora entradas sem chave em vez de quebrar', () => {
  assert.deepStrictEqual(Object.keys(indexarBaseline([null, {}, { chave: 'A||ST' }])), ['A||ST']);
});

test('o cabeçalho nomeia o agrupamento e a dimensão nas duas colunas de valor', () => {
  assert.strictEqual(
    renderCabecalhoAlertas('SUP', 'Volume'),
    '<tr><th>SUP</th><th>Tomador</th><th>Combinação</th><th>Referência (Volume)</th><th>Pesquisado (Volume)</th><th>Desvio</th><th>Status</th></tr>'
  );
});

test('o data-search de cada linha é normalizado (sem acento, minúsculo) -- é o que a busca textual compara', () => {
  const registros = [registro({ sup: 'SUP-0001-24', tomador: 'Concessionária Exemplo' })];
  const html = renderCorpoAlertas(registros, [0], {
    agruparPor: 'sup', dimensao: 'volume',
    numericos: ['realizado'], baselines: ['previsto'], periodos: [PERIODO_MES],
    mesIdx: JULHO, semanas: SEMANAS_JULHO,
    demandas: demandasCom({}), hojeEpoch: diaJul(31), baseline: [],
  });
  assert.match(html, /data-search="[^"]*concessionaria exemplo[^"]*"/);
});
