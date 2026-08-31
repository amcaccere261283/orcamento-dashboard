'use strict';
const test = require('node:test');
const assert = require('node:assert');
const ComputeRelatorioSemanal = require('../tools/semanal/compute-relatorio-semanal.js');
const { semanasDoMes, diaEpoch, indiceSemanaAtual } = require('../tools/semanal/compute-semanal.js');
const RenderAbaSemanal = require('../tools/semanal/render-aba-semanal.js');
const RenderAbaAlertas = require('../tools/semanal/render-aba-alertas.js');

const ANO = 2026;

// totalVolume (linha T do orçamento pra Volume): 0 por padrão, "T ausente" --
// só os testes que precisam de uma Tendência não-nula (pra distinguir duas
// semanas, por exemplo) passam um valor.
function registro({ sup, tipologia = 'ST', grupo = 'Grupo-A', tomador = 'Tomador-A', mesIdx, volume = 0, equipesTotal = 2, totalVolume = 0 }) {
  const zeros = () => new Array(12).fill(0);
  const mk = (v) => { const a = zeros(); a[mesIdx] = v; return a; };
  const mkEquipes = (v) => { const a = zeros(); a[mesIdx] = v; return a; };
  return {
    sup, tipologia, grupo, tomador, origem: 'CONTRATO VIGENTE',
    previsto: { volume: mk(volume), financeiro: zeros(), equipes: mkEquipes(2), equipesResumo: { prod: 8 }, volumeResumo: { ticket: 1 } },
    realizado: { volume: zeros(), financeiro: zeros(), equipes: zeros(), equipesResumo: {}, volumeResumo: {} },
    total: { volume: mk(totalVolume), financeiro: zeros(), equipes: mkEquipes(equipesTotal), equipesResumo: {}, volumeResumo: {} },
  };
}

function demandasCom(eventosPorChave) {
  const porRegistroEventos = {};
  Object.keys(eventosPorChave).forEach((chave) => {
    porRegistroEventos[chave] = { chegada: [], saidaEstoque: [], sondagemRealizada: eventosPorChave[chave] };
  });
  return { porRegistroEventos };
}

test('semanaAnterior da 1ª semana de agosto devolve a última semana de julho, no mesmo ano', () => {
  const AGOSTO = 7;
  const semanasAgo = semanasDoMes(ANO, AGOSTO);
  const alvo = ComputeRelatorioSemanal.semanaAnterior(ANO, AGOSTO, semanasAgo, 0);
  const semanasJul = semanasDoMes(ANO, 6);
  assert.strictEqual(alvo.mesIdx, 6);
  assert.deepStrictEqual(alvo.semana, semanasJul[semanasJul.length - 1]);
  assert.strictEqual(alvo.semana.fim, diaEpoch(new Date(Date.UTC(ANO, AGOSTO, 1))) - 1, 'a última semana de julho termina no dia anterior a 01/08');
});

test('serieDaSemana: Previsto/Tendência ficam sem dado fora dos 12 meses carregados, mas Realizado (por data) continua correto', () => {
  const AGOSTO = 7;
  const semanasAgo = semanasDoMes(ANO, AGOSTO);
  const reg = registro({ sup: 'SUP-A', mesIdx: AGOSTO, volume: 100 });
  const alvo = ComputeRelatorioSemanal.semanaAnterior(ANO, AGOSTO, semanasAgo, 0); // cai em julho, mesIdx 6 -- ainda dentro do ano, sem furo nele
  // Força o alvo para FORA do ano (dezembro anterior), simulando a 1ª semana de janeiro:
  const semanasJan = semanasDoMes(ANO, 0);
  const alvoForaDoAno = ComputeRelatorioSemanal.semanaAnterior(ANO, 0, semanasJan, 0);
  assert.strictEqual(alvoForaDoAno.mesIdx, -1);

  const demandas = demandasCom({ 'SUP-A||ST': [alvoForaDoAno.semana.inicio] }); // 1 furo realizado dentro da semana-alvo
  const ctx = { hojeEpoch: alvoForaDoAno.semana.fim + 10, demandas, temSemanasReais: true };
  const serie = ComputeRelatorioSemanal.serieDaSemana([reg], [0], 'volume', alvoForaDoAno, ctx);

  assert.strictEqual(serie.previsto, null, 'previsto[-1] é undefined -- calcularSeriesSemanaisDimensao devolve null, não 0');
  assert.strictEqual(serie.realizado, 1, 'o furo é contado por DATA, independente do índice de mês estar fora de [0,11]');
});

test('serieAcumulada usa exatamente a mesma janela "Acumulado até a semana atual" que a aba Alertas expõe', () => {
  const JULHO = 6;
  const semanas = semanasDoMes(ANO, JULHO);
  const reg = registro({ sup: 'SUP-A', mesIdx: JULHO, volume: 70 });
  const diaComFuro = semanas[0].inicio;
  const demandas = demandasCom({ 'SUP-A||ST': [diaComFuro] });
  const hojeEpoch = semanas[1].inicio; // início da 2ª semana -- a 1ª já fechou
  const indiceAtual = indiceSemanaAtual(semanas, hojeEpoch);
  const ctx = {
    ano: ANO, mesIdx: JULHO, semanas: semanas, indiceAtual: indiceAtual,
    demandas: demandas, hojeEpoch: hojeEpoch, temSemanasReais: true,
  };

  const obtido = ComputeRelatorioSemanal.serieAcumulada([reg], [0], 'volume', ctx);

  const elapsadas = RenderAbaAlertas.semanasElapsadas(semanas, hojeEpoch);
  const series = RenderAbaSemanal.calcularSeriesSemanaisDimensao([reg], [0], 'volume', JULHO, semanas, semanas.length, true, indiceAtual, demandas, hojeEpoch);
  const janela = RenderAbaAlertas.janelaDoPeriodo(RenderAbaAlertas.PERIODO_ACUMULADO, semanas.length, elapsadas);
  const esperadoRealizado = RenderAbaAlertas.agregarFatias(series.semanasRealizado, 'volume', janela);

  assert.strictEqual(obtido.realizado, esperadoRealizado);
  assert.strictEqual(obtido.realizado, 1, 'o furo do dia 1 da S1 conta no acumulado, já que a S1 encerrou');
});

test('janelasDoGrupo traz a SEMANA VIGENTE (semanas[indiceAtual]), não a semana seguinte', () => {
  const JULHO = 6;
  const semanas = semanasDoMes(ANO, JULHO);
  // totalVolume = volume (T = Previsto) só pra ter uma Tendência que reparte
  // o saldo pelos dias restantes e por isso DIFERE entre semanas -- sem T, a
  // Tendência de ambas as semanas cai pra zero e o teste não provaria que
  // pegou a semana certa (previsto/realizado por si só coincidem aqui).
  const reg = registro({ sup: 'SUP-A', mesIdx: JULHO, volume: 70, totalVolume: 70 });
  const hojeEpoch = semanas[1].inicio; // início da 2ª semana -- a vigente é semanas[1]
  const indiceAtual = indiceSemanaAtual(semanas, hojeEpoch);
  const ctx = {
    ano: ANO, mesIdx: JULHO, semanas: semanas, indiceAtual: indiceAtual,
    demandas: demandasCom({}), hojeEpoch: hojeEpoch, temSemanasReais: true,
  };

  const janelas = ComputeRelatorioSemanal.janelasDoGrupo([reg], [0], 'volume', ctx);

  const esperadoVigente = ComputeRelatorioSemanal.serieDaSemana(
    [reg], [0], 'volume',
    { semana: semanas[1], mesIdx: JULHO, semanasDoMesAlvo: semanas, indiceNoMes: 1 },
    ctx
  );
  assert.deepStrictEqual(janelas.semanaVigente, esperadoVigente, 'semanaVigente precisa ser a série da semana[indiceAtual] (semanas[1]), não de semanas[2]');
  assert.notDeepStrictEqual(
    janelas.semanaVigente,
    ComputeRelatorioSemanal.serieDaSemana([reg], [0], 'volume', { semana: semanas[2], mesIdx: JULHO, semanasDoMesAlvo: semanas, indiceNoMes: 2 }, ctx),
    'não pode coincidir com a série da semana seguinte (semanas[2]) -- garante que o antigo comportamento "semana que vem" não voltou'
  );
});

test('montarLinhasDimensao produz TOTAL GERAL, uma linha por tipologia, e por SUP um registro + TOTAL <SUP>', () => {
  const JULHO = 6;
  const semanas = semanasDoMes(ANO, JULHO);
  const registros = [
    registro({ sup: 'SUP-A', tipologia: 'ST', mesIdx: JULHO, volume: 10 }),
    registro({ sup: 'SUP-B', tipologia: 'SP', mesIdx: JULHO, volume: 20 }),
  ];
  const hojeEpoch = semanas[0].inicio;
  const ctx = {
    ano: ANO, mesIdx: JULHO, semanas: semanas, indiceAtual: indiceSemanaAtual(semanas, hojeEpoch),
    demandas: demandasCom({}), hojeEpoch: hojeEpoch, temSemanasReais: true,
  };
  const linhas = ComputeRelatorioSemanal.montarLinhasDimensao(registros, [0, 1], 'volume', ctx);
  const tipos = linhas.map((l) => l.tipo);
  assert.deepStrictEqual(tipos, [
    'total-geral', 'total-geral-tipologia', 'total-geral-tipologia',
    'registro', 'total-sup', 'registro', 'total-sup',
  ]);
  const linhaRegistroA = linhas.find((l) => l.tipo === 'registro' && l.sup === 'SUP-A');
  assert.strictEqual(linhaRegistroA.contrato, 'SUP-A', 'o contrato É o SUP -- cada registro é (SUP, tipologia)');
});

function linhaSintetica(tipo, extras, janelas) {
  return Object.assign({ tipo: tipo, sup: 'SUP-X', tomador: 'Tomador-X', tipologia: 'ST', contrato: 'SUP-X' }, extras, { janelas: janelas });
}

test('extrairDesvios só inclui linhas Crítico ou Atenção -- Dentro da meta/Excelente/Sem dado ficam de fora', () => {
  const linhas = [
    linhaSintetica('total-geral-tipologia', {}, {
      semanaAnterior: { previsto: 100, realizado: 50, tendencia: 50 }, // 50% -> Crítico
      acumulado: { previsto: 100, realizado: 95, tendencia: 95 }, // 95% -> Dentro da meta
      semanaVigente: { previsto: 100, realizado: 30, tendencia: 80 }, // 80% (por Tendência) -> Atenção
    }),
  ];
  const desvios = ComputeRelatorioSemanal.extrairDesvios(linhas, 'volume');
  assert.strictEqual(desvios.length, 2, 'só semanaAnterior (Crítico) e semanaVigente (Atenção) entram -- acumulado (Dentro da meta) fica de fora');
  assert.deepStrictEqual(desvios.map((d) => d.janela).sort(), ['Semana anterior', 'Semana vigente']);
  assert.strictEqual(desvios.find((d) => d.janela === 'Semana anterior').status, 'Crítico');
  assert.strictEqual(desvios.find((d) => d.janela === 'Semana vigente').status, 'Atenção');
});

test('extrairDesvios: "semana vigente" usa Tendência (não o Realizado parcial, que ainda não fechou a semana) como numerador', () => {
  const linhas = [
    linhaSintetica('registro', {}, {
      semanaAnterior: { previsto: null, realizado: null, tendencia: null },
      acumulado: { previsto: null, realizado: null, tendencia: null },
      semanaVigente: { previsto: 100, realizado: 10, tendencia: 40 }, // 40% (por Tendência) -> Crítico
    }),
  ];
  const desvios = ComputeRelatorioSemanal.extrairDesvios(linhas, 'equipes');
  assert.strictEqual(desvios.length, 1);
  assert.strictEqual(desvios[0].numerador, 40);
  assert.strictEqual(desvios[0].status, 'Crítico');
});

test('montarDesvios separa por tipo de linha (tipologia vs contrato) e cruza volume + equipes', () => {
  const linhasVolume = [
    linhaSintetica('total-geral-tipologia', { tipologia: 'ST' }, {
      semanaAnterior: { previsto: 100, realizado: 40, tendencia: 40 }, acumulado: { previsto: null, realizado: null, tendencia: null }, semanaVigente: { previsto: null, realizado: null, tendencia: null },
    }),
    linhaSintetica('registro', { sup: 'SUP-A', contrato: 'SUP-A' }, {
      semanaAnterior: { previsto: null, realizado: null, tendencia: null }, acumulado: { previsto: 100, realizado: 40, tendencia: 40 }, semanaVigente: { previsto: null, realizado: null, tendencia: null },
    }),
  ];
  const linhasEquipes = [];
  const desvios = ComputeRelatorioSemanal.montarDesvios({ volume: linhasVolume, equipes: linhasEquipes });
  assert.strictEqual(desvios.porTipologia.length, 1);
  assert.strictEqual(desvios.porContrato.length, 1);
  assert.strictEqual(desvios.porTipologia[0].dimensao, 'Volume');
});

test('resumoDesvios conta só porContrato (nível mais fino), não duplica com porTipologia', () => {
  const desvios = {
    porTipologia: [{ status: 'Crítico', dimensao: 'Volume' }, { status: 'Atenção', dimensao: 'Volume' }, { status: 'Crítico', dimensao: 'Volume' }],
    porContrato: [{ status: 'Crítico', dimensao: 'Volume' }, { status: 'Atenção', dimensao: 'Volume' }],
  };
  const resumo = ComputeRelatorioSemanal.resumoDesvios(desvios);
  assert.strictEqual(resumo.critico, 1);
  assert.strictEqual(resumo.atencao, 1);
});

function fixtureTendenciaExterna() {
  const JULHO = 6;
  const semanas = semanasDoMes(ANO, JULHO);
  const registros = [registro({ sup: 'SUP-A', mesIdx: JULHO, volume: 70, totalVolume: 70 })];
  const hojeEpoch = semanas[1].inicio; // início da 2ª semana -- a vigente é semanas[1]
  const indiceAtual = indiceSemanaAtual(semanas, hojeEpoch);
  const ctxBase = {
    ano: ANO, mesIdx: JULHO, semanas: semanas, indiceAtual: indiceAtual,
    demandas: demandasCom({}), hojeEpoch: hojeEpoch, temSemanasReais: true,
  };
  const alvoSemanaVigente = { semana: semanas[indiceAtual], mesIdx: JULHO, semanasDoMesAlvo: semanas, indiceNoMes: indiceAtual };
  return { registros, ctxBase, alvoSemanaVigente };
}

test('serieDaSemana usa ctx.tendenciaExterna quando fornecida, ignorando o recalculo', () => {
  const { registros, ctxBase, alvoSemanaVigente } = fixtureTendenciaExterna();
  const ctx = { ...ctxBase, tendenciaExterna: () => 999 }; // ctxBase = a fixture já existente do arquivo
  const resultado = ComputeRelatorioSemanal.serieDaSemana(registros, [0], 'volume', alvoSemanaVigente, ctx); // alvoSemanaVigente = a mesma fixture de alvo já usada nos testes existentes
  assert.equal(resultado.tendencia, 999);
});

test('serieDaSemana sem ctx.tendenciaExterna continua recalculando como antes (regressao)', () => {
  const { registros, ctxBase, alvoSemanaVigente } = fixtureTendenciaExterna();
  const ctx = { ...ctxBase }; // sem tendenciaExterna
  const resultado = ComputeRelatorioSemanal.serieDaSemana(registros, [0], 'volume', alvoSemanaVigente, ctx);
  assert.notEqual(resultado.tendencia, 999); // não é o valor mockado -- é o valor calculado de verdade
});

test('resumoDesvios.porDimensao quebra Crítico/Atenção corretamente entre Volume e Equipes', () => {
  const desvios = {
    porTipologia: [],
    porContrato: [
      { status: 'Crítico', dimensao: 'Volume' },
      { status: 'Crítico', dimensao: 'Volume' },
      { status: 'Atenção', dimensao: 'Volume' },
      { status: 'Crítico', dimensao: 'Equipes' },
      { status: 'Atenção', dimensao: 'Equipes' },
      { status: 'Atenção', dimensao: 'Equipes' },
      { status: 'Dentro da meta', dimensao: 'Volume' }, // não conta em nenhum lado
    ],
  };
  const resumo = ComputeRelatorioSemanal.resumoDesvios(desvios);
  assert.strictEqual(resumo.critico, 3, 'total crítico: 2 Volume + 1 Equipes');
  assert.strictEqual(resumo.atencao, 3, 'total atenção: 1 Volume + 2 Equipes');
  assert.deepStrictEqual(resumo.porDimensao, {
    Volume: { critico: 2, atencao: 1 },
    Equipes: { critico: 1, atencao: 2 },
  });
});
